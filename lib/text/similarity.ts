/**
 * Offline text similarity: TF-IDF over character n-grams (word-bounded, 3..5),
 * L2-normalised, compared with cosine. Works without any model and is robust to
 * small rewordings; dense embeddings (bge-m3 via Ollama) can replace it when available.
 */
import { normalizeForMatching } from "./normalize";

export type SparseVector = Map<string, number>;

export interface TfidfOptions {
  nMin?: number;
  nMax?: number;
  /** Drop n-grams that occur in more than this fraction of documents. */
  maxDf?: number;
}

/** Character n-grams inside word boundaries (like scikit-learn's "char_wb"). */
export function charNgrams(text: string, nMin = 3, nMax = 5): string[] {
  const grams: string[] = [];
  for (const word of text.split(" ")) {
    if (!word) continue;
    const w = ` ${word} `;
    for (let n = nMin; n <= nMax; n++) {
      if (w.length < n) continue;
      for (let i = 0; i + n <= w.length; i++) grams.push(w.slice(i, i + n));
    }
  }
  return grams;
}

function l2normalize(v: SparseVector): SparseVector {
  let sum = 0;
  for (const x of v.values()) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm > 0) for (const [k, x] of v) v.set(k, x / norm);
  return v;
}

export interface TfidfModel {
  idf: Map<string, number>;
  docCount: number;
  options: Required<TfidfOptions>;
  transform(text: string): SparseVector;
}

/** Fits IDF on a corpus (normalised internally) and returns a transformer. */
export function fitTfidf(corpus: string[], options: TfidfOptions = {}): TfidfModel {
  const opts: Required<TfidfOptions> = { nMin: 3, nMax: 5, maxDf: 1, ...options };
  const df = new Map<string, number>();
  for (const doc of corpus) {
    const grams = new Set(charNgrams(normalizeForMatching(doc), opts.nMin, opts.nMax));
    for (const g of grams) df.set(g, (df.get(g) ?? 0) + 1);
  }
  const n = corpus.length;
  const idf = new Map<string, number>();
  for (const [g, d] of df) {
    if (n > 2 && d / n > opts.maxDf) continue;
    idf.set(g, Math.log((1 + n) / (1 + d)) + 1);
  }
  const transform = (text: string): SparseVector => {
    const tf = new Map<string, number>();
    for (const g of charNgrams(normalizeForMatching(text), opts.nMin, opts.nMax)) {
      tf.set(g, (tf.get(g) ?? 0) + 1);
    }
    const v: SparseVector = new Map();
    for (const [g, count] of tf) {
      // Unseen n-grams get the maximum idf (rare by definition).
      const w = idf.get(g) ?? Math.log((1 + n) / 1) + 1;
      v.set(g, (1 + Math.log(count)) * w);
    }
    return l2normalize(v);
  };
  return { idf, docCount: n, options: opts, transform };
}

export function tfidfVectors(texts: string[], options: TfidfOptions = {}): SparseVector[] {
  const model = fitTfidf(texts, options);
  return texts.map((t) => model.transform(t));
}

export function cosineSparse(a: SparseVector, b: SparseVector): number {
  if (a.size > b.size) [a, b] = [b, a];
  let dot = 0;
  for (const [k, x] of a) {
    const y = b.get(k);
    if (y !== undefined) dot += x * y;
  }
  return Math.max(0, Math.min(1, dot));
}

export function cosineDense(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error(`vector length mismatch ${a.length} vs ${b.length}`);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

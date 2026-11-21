/**
 * Rarity of the first names in blocks of fake comments. The block key is the whole author set, so one
 * or two shared names never tie two pages; but a block made of the commonest first names (Anna, Jan,
 * Piotr) is easier to meet by chance in unrelated templates than one with rare or misspelled names
 * copied from a single source. The block pivot is weighed down by how common its first names are.
 */

/**
 * Weight factor of each comment block, in [floor, 1]: the mean inverse frequency of its distinct first
 * names (first word of the normalised author name) across all blocks of the dataset, ln(B / df) / ln(B)
 * for B blocks, so a name of one block scores 1 and a name of every block 0. `blocks`: block id ->
 * normalised authors. With fewer than `minBlocks` blocks every factor is 1 (too few to tell common names).
 */
export function commentNameFactors(blocks: Record<string, string[]>, rules: { minBlocks: number; floor: number }): Map<string, number> {
  const firstNames = new Map(Object.entries(blocks).map(([id, authors]) => [id, new Set(authors.map((a) => a.split(" ")[0]).filter(Boolean))]));
  const total = firstNames.size;
  const out = new Map<string, number>();
  if (total < rules.minBlocks) {
    for (const id of firstNames.keys()) out.set(id, 1);
    return out;
  }
  const df = new Map<string, number>();
  for (const names of firstNames.values()) for (const n of names) df.set(n, (df.get(n) ?? 0) + 1);
  for (const [id, names] of firstNames) {
    const idf = [...names].map((n) => Math.log(total / df.get(n)!) / Math.log(total));
    const mean = idf.length ? idf.reduce((s, x) => s + x, 0) / idf.length : 1;
    out.set(id, Math.max(rules.floor, Math.round(mean * 1000) / 1000));
  }
  return out;
}

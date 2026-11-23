/**
 * bun run voice:eval -- --work-dir <folder outside the repository> [--index data/voices/index.json]
 *
 * Measures the voice rule on the windows saved by scripts/py/build_voice_index.py: held-out
 * recordings of people on the list (leave-one-recording-out), recordings of strangers and, when
 * the folder has a `fakes` set, the fake ads. Prints the rates for a grid of thresholds and
 * margins, the cosines between the patterns of the people, and the spans of every fake.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_VOICE_CONFIG, matchVoiceWindows, speakerSimilarity, voiceIndexFile, type VoiceIndex, type VoiceWindow } from "../lib/media/speaker";
import { evaluateRule, type GalleryRecording, type OtherRecording } from "../lib/media/voiceEval";
import { cli, main } from "./_cli";

const args = cli(
  { "work-dir": { type: "string" }, index: { type: "string" } } as const,
  "Usage: bun run voice:eval -- --work-dir <folder outside the repository with gallery/, strangers/, fakes/> [--index data/voices/index.json]",
);

/** Reads the windows saved by build_voice_index.py (`<recording>.windows.json`). */
const readWindows = (file: string): VoiceWindow[] => JSON.parse(readFileSync(file, "utf8")) as VoiceWindow[];

/** Recordings of one set (`strangers`, `fakes`): every `<set>/<person>/<key>.windows.json`. */
function loadSet(work: string, set: string): OtherRecording[] {
  const dir = path.join(work, set);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((person) =>
    readdirSync(path.join(dir, person))
      .filter((f) => f.endsWith(".windows.json"))
      .map((f) => ({ key: `${person}/${f.replace(".windows.json", "")}`, windows: readWindows(path.join(dir, person, f)) })),
  );
}

/** "n/total (xx.x%)" for a rate, "-" when there is nothing to divide by. */
const pct = (r: { n: number; total: number }) => `${r.n}/${r.total} (${r.total ? ((100 * r.n) / r.total).toFixed(1) : "-"}%)`;

void main(() => {
  const work = args["work-dir"];
  if (!work) throw new Error("no --work-dir");
  const index = JSON.parse(readFileSync(args.index ?? voiceIndexFile(), "utf8")) as VoiceIndex;
  const meta = JSON.parse(readFileSync(path.join(work, "gallery.json"), "utf8")) as Record<string, Array<{ key: string; used: boolean }>>;
  const gallery: GalleryRecording[] = [];
  for (const [person, recs] of Object.entries(meta)) {
    recs.filter((r) => r.used).forEach((r, i) => gallery.push({ person, key: r.key, vector: index.persons[person][i], windows: readWindows(path.join(work, "gallery", person, `${r.key}.windows.json`)) }));
  }
  const strangers = loadSet(work, "strangers");
  const fakes = loadSet(work, "fakes");
  console.log(`gallery: ${Object.keys(index.persons).length} people, ${gallery.length} recordings; strangers: ${strangers.length} recordings; fakes: ${fakes.length} clips`);

  const people = Object.keys(index.persons);
  const mean = (vs: number[][]) => {
    const s = vs[0].map((_, i) => vs.reduce((a, v) => a + v[i], 0));
    const n = Math.sqrt(s.reduce((a, x) => a + x * x, 0));
    return s.map((x) => x / n);
  };
  console.log("\ncosine of the people's patterns (mean of the recordings):");
  for (const a of people) console.log(`${a.padEnd(22)} ${people.map((b) => speakerSimilarity(mean(index.persons[a]), mean(index.persons[b])).toFixed(2)).join(" ")}`);

  console.log("\nthr   margin    win  | same person (hit / other person)       | strangers: recordings / windows with a persona");
  for (const minSimilarity of [0.45, 0.5, 0.55, 0.6]) {
    for (const minMargin of [0.1, 0.15, 0.2]) {
      for (const minWindows of [1, 2, 3]) {
        const r = evaluateRule(gallery, strangers, { ...DEFAULT_VOICE_CONFIG, minSimilarity, minMargin, minWindows });
        console.log(`${minSimilarity.toFixed(2)}  ${minMargin.toFixed(2)}      ${minWindows}   | ${pct(r.sameHit)} / ${pct(r.sameWrong)} | ${pct(r.strangerHit)} / ${pct(r.strangerWindows)}`);
      }
    }
  }

  const full: VoiceIndex = index;
  console.log("\nstrangers with a persona at the default settings:");
  for (const o of strangers) {
    const named = matchVoiceWindows(o.windows, index).filter((sp) => sp.persona);
    if (named.length) console.log(`${o.key}: ${named.map((sp) => `${sp.persona} ${sp.start}-${sp.end}s (${sp.similarity?.toFixed(2)})`).join("; ")}`);
  }

  console.log(`\nfakes (threshold ${DEFAULT_VOICE_CONFIG.minSimilarity}, margin ${DEFAULT_VOICE_CONFIG.minMargin}):`);
  for (const f of fakes) {
    const spans = matchVoiceWindows(f.windows, full).filter((s) => s.persona);
    console.log(`${f.key}: ${spans.length ? spans.map((s) => `${s.persona} ${s.start}-${s.end}s (${s.similarity?.toFixed(2)})`).join("; ") : "no persona"}`);
  }
});

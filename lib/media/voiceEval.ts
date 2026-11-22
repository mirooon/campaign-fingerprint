/**
 * Measurement of the voice rule (`matchVoiceWindows`): how often a recording of a person on the
 * list is named correctly, how often it is named as somebody else, and how often a recording of a
 * stranger (a person outside the list) gets a persona at all. Pure functions over windows
 * and gallery vectors; the script scripts/voice-eval.ts reads them from the folder outside the
 * repository. Used to choose the threshold and the margin of DEFAULT_VOICE_CONFIG
 * (docs/TECHNICAL.md, "Persona z głosu").
 */
import { matchVoiceWindows, type VoiceConfig, type VoiceIndex, type VoiceWindow } from "./speaker";

/** A recording of a person of the gallery: its reference vector (as in the index) and its windows. */
export interface GalleryRecording {
  person: string;
  key: string;
  vector: number[];
  windows: VoiceWindow[];
}

/** A recording outside the gallery (a stranger, a fake ad): only windows. */
export interface OtherRecording {
  key: string;
  windows: VoiceWindow[];
}

export interface VoiceRates {
  /** Held-out recordings of a person (leave-one-recording-out) with a span naming that person. */
  sameHit: { n: number; total: number };
  /** Held-out recordings with a span naming somebody else. */
  sameWrong: { n: number; total: number };
  /** Recordings of strangers with a span naming anybody (the false hits). */
  strangerHit: { n: number; total: number };
  /** The same at the level of windows: speech windows of strangers inside a span with a persona. */
  strangerWindows: { n: number; total: number };
}

/** Index of the gallery without one recording (the held-out one): a person left without vectors drops out. */
function indexWithout(recordings: GalleryRecording[], leaveOut: GalleryRecording | null): VoiceIndex {
  const persons: Record<string, number[][]> = {};
  for (const r of recordings) if (r !== leaveOut) (persons[r.person] ??= []).push(r.vector);
  return { model: "measurement", persons };
}

/** Number of windows of a recording that pass the level and speech filters of the rule (the denominator of window rates). */
function speechWindows(windows: VoiceWindow[], config: VoiceConfig): number {
  return windows.filter((w) => w.levelDb >= config.minLevelDb && w.speech >= config.minSpeech).length;
}

/**
 * Runs the rule on the recordings: gallery recordings are held out one at a time against an index
 * without them (so the person's other recordings are the pattern, as for a new recording), the
 * strangers against the full index.
 * @param gallery recordings of the people on the list, with the vectors used in the index
 * @param strangers recordings of people outside the list
 */
export function evaluateRule(gallery: GalleryRecording[], strangers: OtherRecording[], config: VoiceConfig): VoiceRates {
  const rates: VoiceRates = { sameHit: { n: 0, total: 0 }, sameWrong: { n: 0, total: 0 }, strangerHit: { n: 0, total: 0 }, strangerWindows: { n: 0, total: 0 } };
  for (const rec of gallery) {
    const index = indexWithout(gallery, rec);
    if (!index.persons[rec.person]) continue;
    const named = matchVoiceWindows(rec.windows, index, config).flatMap((s) => (s.persona ? [s.persona] : []));
    rates.sameHit.total++;
    rates.sameWrong.total++;
    if (named.includes(rec.person)) rates.sameHit.n++;
    if (named.some((p) => p !== rec.person)) rates.sameWrong.n++;
  }
  const full = indexWithout(gallery, null);
  for (const rec of strangers) {
    const spans = matchVoiceWindows(rec.windows, full, config);
    rates.strangerHit.total++;
    if (spans.some((s) => s.persona)) rates.strangerHit.n++;
    rates.strangerWindows.total += speechWindows(rec.windows, config);
    const named = spans.filter((s) => s.persona);
    rates.strangerWindows.n += rec.windows.filter((w) => named.some((s) => w.start >= s.start && w.end <= s.end)).length;
  }
  return rates;
}

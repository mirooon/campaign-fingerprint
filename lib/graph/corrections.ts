/**
 * Analyst corrections (B-281): instead of editing the graph by hand, the analyst records decisions in
 * `corrections.json` and `build-graph` applies them on its next run.
 *
 * - must-link: two ads belong to one campaign; a strong link carrying the premise "decyzja analityka" joins them.
 * - cannot-link: two ads must not share a campaign ("to połączenie jest błędne"); their direct link is cut and,
 *   when other links still put them in one campaign, the links between the two sides of that campaign are cut
 *   (each member goes to the side it is nearest to) until clustering keeps them apart. Cannot-link wins over
 *   must-link.
 * - disabled pivots: a shared trace (a pivot node id such as `domain:example.test`) stops counting as evidence.
 *
 * Every link the analyst changed stays in the written graph with an extra premise "decyzja analityka: …",
 * and every campaign touched by a decision lists it in `analystNotes`.
 */
import { existsSync, readFileSync } from "node:fs";
import { clusterCampaigns, type ClusterResult } from "./cluster";
import type { LinkConfig } from "./config";
import type { EvidenceGraph, ItemLink, PairEvidence } from "./model";
import { combineScores } from "./weights";

/** One pair decision of the analyst. */
export interface CorrectionPair {
  a: string;
  b: string;
  note?: string;
  at?: string;
}

/** One disabled pivot (node id of a shared trace). */
export interface DisabledPivot {
  pivot: string;
  note?: string;
  at?: string;
}

/** Content of `corrections.json`. */
export interface CorrectionsFile {
  version: 1;
  mustLink: CorrectionPair[];
  cannotLink: CorrectionPair[];
  disabledPivots: DisabledPivot[];
}

/** Label of the premise added to every link an analyst decision changed. */
export const ANALYST_PREMISE = "decyzja analityka";

/** An empty corrections file. */
export function emptyCorrections(): CorrectionsFile {
  return { version: 1, mustLink: [], cannotLink: [], disabledPivots: [] };
}

/** Whether the file holds no decision at all. */
export function correctionsEmpty(c: CorrectionsFile): boolean {
  return !c.mustLink.length && !c.cannotLink.length && !c.disabledPivots.length;
}

/**
 * Validates parsed JSON as a corrections file: missing lists become empty, a disabled pivot may be a bare
 * string, a pair needs two different non-empty ids. Throws with a Polish message on anything else.
 */
export function parseCorrections(raw: unknown): CorrectionsFile {
  if (typeof raw !== "object" || raw === null) throw new Error("plik korekt nie jest obiektem JSON");
  const o = raw as Record<string, unknown>;
  if (o.version !== undefined && o.version !== 1) throw new Error(`nieznana wersja pliku korekt: ${String(o.version)}`);
  const pairs = (key: string): CorrectionPair[] => {
    const list = o[key] ?? [];
    if (!Array.isArray(list)) throw new Error(`${key}: oczekiwano listy`);
    return list.map((p, i) => {
      const pair = (Array.isArray(p) ? { a: p[0], b: p[1] } : p) as Record<string, unknown>;
      if (typeof pair?.a !== "string" || typeof pair?.b !== "string" || !pair.a || !pair.b || pair.a === pair.b) throw new Error(`${key}[${i}]: potrzebne dwa różne identyfikatory reklam`);
      return { a: pair.a, b: pair.b, ...(typeof pair.note === "string" ? { note: pair.note } : {}), ...(typeof pair.at === "string" ? { at: pair.at } : {}) };
    });
  };
  const pivotsRaw = o.disabledPivots ?? [];
  if (!Array.isArray(pivotsRaw)) throw new Error("disabledPivots: oczekiwano listy");
  const disabledPivots = pivotsRaw.map((p, i) => {
    const d = (typeof p === "string" ? { pivot: p } : p) as Record<string, unknown>;
    if (typeof d?.pivot !== "string" || !d.pivot) throw new Error(`disabledPivots[${i}]: brak identyfikatora śladu`);
    return { pivot: d.pivot, ...(typeof d.note === "string" ? { note: d.note } : {}), ...(typeof d.at === "string" ? { at: d.at } : {}) };
  });
  return { version: 1, mustLink: pairs("mustLink"), cannotLink: pairs("cannotLink"), disabledPivots };
}

/** Reads `file`; a missing file (or no path) means no corrections. A broken file throws with the reason. */
export function loadCorrections(file: string | undefined | null): CorrectionsFile {
  if (!file || !existsSync(file)) return emptyCorrections();
  try {
    return parseCorrections(JSON.parse(readFileSync(file, "utf8")));
  } catch (e) {
    throw new Error(`Nie udało się odczytać pliku korekt ${file}: ${(e as Error).message}`);
  }
}

/** Order-independent key of an item pair. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** A premise "decyzja analityka: …" (weight 1 and strong for a must-link, weight 0 for a cut). */
function analystEvidence(a: string, b: string, text: string, join: boolean): PairEvidence {
  return {
    kind: "pivot",
    pivot: `analyst:${pairKey(a, b)}`,
    pivotType: null,
    edgeType: null,
    weight: join ? 1 : 0,
    strong: join,
    discounted: false,
    evidence: `${ANALYST_PREMISE}: ${text}`,
    pathA: [],
    pathB: [],
  };
}

/** Splits the links by `shouldCut`: returns the kept links and the cut ones. */
function cutLinks(links: ItemLink[], shouldCut: (l: ItemLink) => boolean): { kept: ItemLink[]; cut: ItemLink[] } {
  const kept: ItemLink[] = [];
  const cut: ItemLink[] = [];
  for (const l of links) (shouldCut(l) ? cut : kept).push(l);
  return { kept, cut };
}

/**
 * Splits `members` into the side nearest to `a` and the side nearest to `b` (multi-source BFS over the links
 * inside the members; ties and unreached members go to `a`). Returns the set of `b`'s side.
 */
function sideOfB(members: string[], links: ItemLink[], a: string, b: string): Set<string> {
  const set = new Set(members);
  const adj = new Map<string, string[]>();
  for (const l of links) {
    if (!set.has(l.a) || !set.has(l.b)) continue;
    adj.set(l.a, [...(adj.get(l.a) ?? []), l.b]);
    adj.set(l.b, [...(adj.get(l.b) ?? []), l.a]);
  }
  const side = new Map<string, "a" | "b">([
    [a, "a"],
    [b, "b"],
  ]);
  let frontier = [a, b];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of (adj.get(id) ?? []).slice().sort()) {
        if (side.has(n)) continue;
        side.set(n, side.get(id)!);
        next.push(n);
      }
    }
    frontier = next;
  }
  return new Set([...side.entries()].filter(([, s]) => s === "b").map(([id]) => id));
}

/** Result of `clusterWithCorrections`: the clustering plus what the decisions changed. */
export interface CorrectedClusterResult extends ClusterResult {
  /** Number of links the decisions changed (added, cut, or stripped of a pivot). */
  changedLinks: number;
}

/**
 * Clusters the graph with the analyst's corrections applied (rules in the header of this file). Without
 * corrections it is exactly `clusterCampaigns`.
 */
export function clusterWithCorrections(
  graph: EvidenceGraph,
  corrections: CorrectionsFile,
  options: { config?: LinkConfig; now?: () => Date } = {},
): CorrectedClusterResult {
  if (correctionsEmpty(corrections)) return { ...clusterCampaigns(graph, options), changedLinks: 0 };
  const disabled = new Map(corrections.disabledPivots.map((d) => [d.pivot, d]));
  const cannot = new Map(corrections.cannotLink.map((p) => [pairKey(p.a, p.b), p]));
  const must = new Map(corrections.mustLink.filter((p) => !cannot.has(pairKey(p.a, p.b))).map((p) => [pairKey(p.a, p.b), p]));
  /** Links shown in the written graph in place of the clustering ones (key → annotated link). */
  const shown = new Map<string, ItemLink>();
  const note = (l: ItemLink, ev: PairEvidence) => {
    const key = pairKey(l.a, l.b);
    const prev = shown.get(key) ?? { ...l, evidence: [...l.evidence] };
    prev.evidence.push(ev);
    shown.set(key, prev);
  };

  // 1. disabled pivots stop counting
  let links: ItemLink[] = [];
  for (const l of graph.links) {
    const kept = l.evidence.filter((e) => !(e.pivot && disabled.has(e.pivot)));
    if (kept.length === l.evidence.length) {
      links.push(l);
      continue;
    }
    const stripped: ItemLink = kept.length ? { ...l, evidence: kept, score: combineScores(kept.map((e) => e.weight)), strong: kept.some((e) => e.strong) } : { ...l, evidence: [], score: 0, strong: false };
    for (const e of l.evidence.filter((x) => x.pivot && disabled.has(x.pivot))) note(stripped, analystEvidence(l.a, l.b, `wyłączony ślad ${e.pivot}`, false));
    if (kept.length) links.push(stripped);
  }
  // 2. cannot-link cuts the direct link
  const direct = cutLinks(links, (l) => cannot.has(pairKey(l.a, l.b)));
  links = direct.kept;
  for (const l of direct.cut) note(l, analystEvidence(l.a, l.b, "to połączenie jest błędne (rozdzielone)", false));
  // 3. must-link adds a strong link
  const items = new Set(graph.nodes.filter((n) => n.type === "item").map((n) => n.key));
  for (const [key, p] of must) {
    if (!items.has(p.a) || !items.has(p.b)) continue;
    const ev = analystEvidence(p.a, p.b, `połączone${p.note ? ` (${p.note})` : ""}`, true);
    const idx = links.findIndex((l) => pairKey(l.a, l.b) === key);
    if (idx >= 0) links[idx] = { ...links[idx], evidence: [...links[idx].evidence, ev], score: 1, strong: true };
    else links.push({ a: p.a < p.b ? p.a : p.b, b: p.a < p.b ? p.b : p.a, score: 1, strong: true, evidence: [ev] });
    shown.delete(key);
  }

  // 4. cluster; cut between the sides of every campaign still holding a cannot-link pair
  let work: EvidenceGraph = { ...graph, links };
  let result = clusterCampaigns(work, options);
  for (let round = 0; round < 50; round++) {
    const violated = [...cannot.values()].filter((p) => result.campaigns.assignments[p.a] && result.campaigns.assignments[p.a] === result.campaigns.assignments[p.b]);
    if (!violated.length) break;
    for (const p of violated) {
      const campaign = result.campaigns.campaigns.find((c) => c.id === result.campaigns.assignments[p.a]);
      if (!campaign) continue;
      const bSide = sideOfB(campaign.members, work.links, p.a, p.b);
      const members = new Set(campaign.members);
      const crossing = cutLinks(work.links, (l) => members.has(l.a) && members.has(l.b) && bSide.has(l.a) !== bSide.has(l.b));
      for (const l of crossing.cut) note(l, analystEvidence(l.a, l.b, `rozdzielone, bo ${p.a} i ${p.b} to różne kampanie`, false));
      work = { ...work, links: crossing.kept };
    }
    result = clusterCampaigns(work, options);
  }

  // 5. written graph: clustering links plus the cut ones with their premise (never strong any more)
  const workKeys = new Set(work.links.map((l) => pairKey(l.a, l.b)));
  const extra = [...shown.entries()].filter(([k]) => !workKeys.has(k)).map(([, l]) => ({ ...l, strong: false }));
  const outLinks = [...result.graph.links.map((l) => shown.get(pairKey(l.a, l.b)) ?? l), ...extra];
  result.graph = { ...result.graph, links: outLinks };

  // 6. campaign notes
  const assignments = result.campaigns.assignments;
  const notesOf = new Map<string, string[]>();
  const addNote = (item: string, text: string) => {
    const c = assignments[item];
    if (!c) return;
    const list = notesOf.get(c) ?? [];
    if (!list.includes(text)) list.push(text);
    notesOf.set(c, list);
  };
  for (const p of must.values()) {
    if (assignments[p.a] && assignments[p.a] === assignments[p.b]) addNote(p.a, `${ANALYST_PREMISE}: połączono ${p.a} i ${p.b}${p.note ? ` (${p.note})` : ""}`);
  }
  for (const p of cannot.values()) {
    const text = `${ANALYST_PREMISE}: ${p.a} i ${p.b} rozdzielone (to połączenie jest błędne)${p.note ? ` (${p.note})` : ""}`;
    addNote(p.a, text);
    addNote(p.b, text);
  }
  for (const l of shown.values()) {
    for (const e of l.evidence) {
      if (!e.evidence.startsWith(`${ANALYST_PREMISE}: wyłączony ślad`)) continue;
      addNote(l.a, e.evidence);
      addNote(l.b, e.evidence);
    }
  }
  for (const c of result.campaigns.campaigns) {
    const notes = notesOf.get(c.id);
    if (notes?.length) c.analystNotes = notes;
  }
  result.campaigns.method.rules = [
    ...(result.campaigns.method.rules ?? []),
    `${ANALYST_PREMISE}: połączone pary ${must.size}, rozdzielone pary ${cannot.size}, wyłączone ślady ${disabled.size} (corrections.json; rozdzielenie wygrywa z połączeniem)`,
  ];
  return { ...result, changedLinks: shown.size + must.size };
}

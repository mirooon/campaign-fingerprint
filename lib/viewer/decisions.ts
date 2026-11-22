/**
 * Analyst's decision per campaign (B-282): "do zgłoszenia", "zgłoszone", "odrzucone", "do weryfikacji". The tool
 * proposes, the human decides: the decision is kept locally (next to the base, never in the repository) and only
 * gates the export of the evidence pack. Pure functions over the decisions file; reading and writing it is in
 * `decisionsFile.ts`.
 */
import path from "node:path";

export type Decision = "to_report" | "reported" | "rejected" | "to_verify";

export const DECISION_LABEL: Record<Decision, string> = {
  to_report: "do zgłoszenia",
  reported: "zgłoszone",
  rejected: "odrzucone",
  to_verify: "do weryfikacji",
};

export const DECISIONS = Object.keys(DECISION_LABEL) as Decision[];

export interface DecisionRecord {
  status: Decision;
  /** When the analyst decided (ISO). */
  decidedAt: string;
}

export interface DecisionsFile {
  version: 1;
  /** Campaign id (K01) → decision. */
  decisions: Record<string, DecisionRecord>;
}

/** Decisions with `campaign` set to `status` (null removes the decision); the input is not changed. */
export function setDecision(file: DecisionsFile, campaign: string, status: Decision | null, now: Date = new Date()): DecisionsFile {
  const decisions = { ...file.decisions };
  if (status === null) delete decisions[campaign];
  else decisions[campaign] = { status, decidedAt: now.toISOString() };
  return { version: 1, decisions };
}

/**
 * Message that blocks the export of the evidence pack of a campaign, or null when it may be exported. A campaign
 * the analyst rejected or still has to verify gets no pack; "do zgłoszenia", "zgłoszone" and no decision pass.
 */
export function exportBlockReason(file: DecisionsFile, campaign: string): string | null {
  const status = file.decisions[campaign]?.status;
  if (status === "rejected") return `Kampania ${campaign} jest oznaczona jako „${DECISION_LABEL.rejected}”: paczka dowodów nie powstanie. Zmień decyzję, jeśli to pomyłka.`;
  if (status === "to_verify") return `Kampania ${campaign} jest oznaczona jako „${DECISION_LABEL.to_verify}”: najpierw ją zweryfikuj, potem pobierz paczkę dowodów.`;
  return null;
}

/** File of the decisions: `decyzje.json` in the base's folder; for the bundled sample (inside the repository) a file in the work folder, so the repository is never written. */
export function decisionsFilePath(o: { dataDir: string; sampleBase: boolean; workRoot: string }): string {
  return o.sampleBase ? path.join(o.workRoot, "decyzje-probka.json") : path.join(o.dataDir, "decyzje.json");
}

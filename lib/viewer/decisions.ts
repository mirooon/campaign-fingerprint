/**
 * Analyst's decision per campaign (B-282): "to report", "reported", "rejected", "to verify". The tool
 * proposes, the human decides: the decision is kept locally (next to the base, never in the repository) and only
 * gates the export of the evidence pack. Pure functions over the decisions file; reading and writing it is in
 * `decisionsFile.ts`.
 */
import path from "node:path";

export type Decision = "to_report" | "reported" | "rejected" | "to_verify";

export const DECISION_LABEL: Record<Decision, string> = {
  to_report: "to report",
  reported: "reported",
  rejected: "rejected",
  to_verify: "to verify",
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
 * the analyst rejected or still has to verify gets no pack; "to report", "reported" and no decision pass.
 */
export function exportBlockReason(file: DecisionsFile, campaign: string): string | null {
  const status = file.decisions[campaign]?.status;
  if (status === "rejected") return `Campaign ${campaign} is marked “${DECISION_LABEL.rejected}”: no evidence pack will be made. Change the decision if this is a mistake.`;
  if (status === "to_verify") return `Campaign ${campaign} is marked “${DECISION_LABEL.to_verify}”: verify it first, then download the evidence pack.`;
  return null;
}

/** File of the decisions: `decyzje.json` in the base's folder; for the bundled sample (inside the repository) a file in the work folder, so the repository is never written. */
export function decisionsFilePath(o: { dataDir: string; sampleBase: boolean; workRoot: string }): string {
  return o.sampleBase ? path.join(o.workRoot, "decyzje-probka.json") : path.join(o.dataDir, "decyzje.json");
}

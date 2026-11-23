/**
 * Periodic report for an institution as Markdown: new campaigns, impersonated persons, domains seen
 * in CT logs, the share of ads taken down and reports without a reaction. Pure function: the script
 * reads graph.json, campaigns.json, the CT feed and the optional file of reports and prints the text.
 */
import type { CtFeedRecord } from "../ct/feed";
import type { CampaignsFile, EvidenceGraph } from "../graph/model";

/** A report the institution sent about a material, and the reaction it got (null = none). */
export interface ReportRecord {
  id: string;
  /** ISO 8601 date of the report. */
  reportedAt: string;
  reaction: string | null;
}

export interface PeriodReportInput {
  graph: EvidenceGraph;
  campaigns: CampaignsFile;
  since: Date;
  until: Date;
  ctRecords: CtFeedRecord[];
  /** Reports sent by the institution; null when the tool has none (it keeps no register of reports). */
  reports: ReportRecord[] | null;
}

const UNITS: Record<string, number> = { h: 3_600_000, d: 86_400_000 };

/** Start of the period from "7d" or "36h" (days or hours back from `now`); throws on any other text. */
export function parseSince(text: string, now: Date): Date {
  const m = /^(\d+)([dh])$/.exec(text.trim());
  if (!m) throw new Error(`unknown period "${text}" (give e.g. 7d or 36h)`);
  return new Date(now.getTime() - Number(m[1]) * UNITS[m[2]]);
}

/** True when the ISO date lies in [since, until]; a missing or unreadable date is outside. */
const inPeriod = (iso: string | null | undefined, since: Date, until: Date): boolean => {
  const t = iso ? Date.parse(iso) : NaN;
  return !Number.isNaN(t) && t >= since.getTime() && t <= until.getTime();
};

/**
 * Report text. A campaign is new when its first ad was seen in the period. Persons are counted over the
 * ads of those campaigns. The share of taken-down ads counts ads that have an ad-library record. A report
 * is without reaction when it was sent in the period (or earlier) and has no reaction. A section without
 * data stays in the report with the reason.
 */
export function periodReport(input: PeriodReportInput): string {
  const { graph, campaigns, since, until } = input;
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const fresh = campaigns.campaigns.filter((c) => inPeriod(c.firstSeen, since, until));
  const freshIds = new Set(fresh.map((c) => c.id));
  const items = graph.nodes.filter((n) => n.type === "item");

  const persons = new Map<string, { ads: number; campaigns: Set<string> }>();
  for (const n of items) {
    if (!n.campaignId || !freshIds.has(n.campaignId)) continue;
    for (const p of (n.data.personas as string[] | undefined) ?? []) {
      const row = persons.get(p) ?? { ads: 0, campaigns: new Set<string>() };
      row.ads += 1;
      row.campaigns.add(n.campaignId);
      persons.set(p, row);
    }
  }

  const domains = [...new Set(input.ctRecords.filter((r) => inPeriod(r.observed_utc, since, until)).map((r) => r.domain))].sort();

  const withLibrary = items.filter((n) => Array.isArray(n.data.adLibrary) && (n.data.adLibrary as unknown[]).length > 0);
  const takenDown = withLibrary.filter((n) => n.data.adTakenDown === true).length;

  const silent = input.reports?.filter((r) => r.reaction === null && Date.parse(r.reportedAt) <= until.getTime()) ?? [];

  const samples = (n: number) => `${n} ${n === 1 ? "sample" : "samples"}`;
  const lines = [`# Period report ${day(since)} – ${day(until)}`, "", `Samples in the base: ${items.length}; campaigns: ${campaigns.campaigns.length}.`, ""];
  lines.push("## New campaigns", "");
  lines.push(...(fresh.length ? fresh.map((c) => `- ${c.id}: ${samples(c.size)}, from ${c.firstSeen?.slice(0, 10)}; ${c.topEvidence[0]?.label ?? "no shared evidence"}`) : ["No new campaigns in the period."]), "");
  lines.push("## People", "");
  lines.push(...(persons.size ? [...persons].sort((a, b) => b[1].ads - a[1].ads).map(([p, r]) => `- ${p}: ${samples(r.ads)} in ${r.campaigns.size} new ${r.campaigns.size === 1 ? "campaign" : "campaigns"}`) : ["No recognized people in new campaigns."]), "");
  lines.push("## Domains from CT", "");
  lines.push(...(domains.length ? domains.map((d) => `- ${d}`) : ["No new domains from CT in the period."]), "");
  lines.push("## Taken-down ads", "");
  lines.push(withLibrary.length ? `${takenDown} of ${withLibrary.length} (${Math.round((100 * takenDown) / withLibrary.length)}%) samples with an ad-library record were taken down.` : "No samples with an ad-library record (the --ad-library step).", "");
  lines.push("## Reports without reaction", "");
  if (input.reports === null) lines.push("The tool keeps no register of reports: no data on reports (give a --reports file).");
  else lines.push(...(silent.length ? silent.map((r) => `- ${r.id}: reported ${r.reportedAt.slice(0, 10)}, no reaction`) : ["All reports have a reaction."]));
  return `${lines.join("\n")}\n`;
}

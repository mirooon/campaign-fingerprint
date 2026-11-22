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
  if (!m) throw new Error(`nieznany okres "${text}" (podaj np. 7d albo 36h)`);
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

  const lines = [`# Raport okresowy ${day(since)} – ${day(until)}`, "", `Materiałów w bazie: ${items.length}; kampanii: ${campaigns.campaigns.length}.`, ""];
  lines.push("## Nowe kampanie", "");
  lines.push(...(fresh.length ? fresh.map((c) => `- ${c.id}: ${c.size} mat., od ${c.firstSeen?.slice(0, 10)}; ${c.topEvidence[0]?.label ?? "bez dowodu wspólnego"}`) : ["Brak nowych kampanii w okresie."]), "");
  lines.push("## Osoby", "");
  lines.push(...(persons.size ? [...persons].sort((a, b) => b[1].ads - a[1].ads).map(([p, r]) => `- ${p}: ${r.ads} mat. w ${r.campaigns.size} nowych kampaniach`) : ["Brak rozpoznanych osób w nowych kampaniach."]), "");
  lines.push("## Domeny z CT", "");
  lines.push(...(domains.length ? domains.map((d) => `- ${d}`) : ["Brak nowych domen z CT w okresie."]), "");
  lines.push("## Zdjęte reklamy", "");
  lines.push(withLibrary.length ? `${takenDown} z ${withLibrary.length} (${Math.round((100 * takenDown) / withLibrary.length)}%) materiałów z wpisem w bibliotece reklam zostało zdjętych.` : "Brak materiałów z wpisem w bibliotece reklam (krok --ad-library).", "");
  lines.push("## Zgłoszenia bez reakcji", "");
  if (input.reports === null) lines.push("Narzędzie nie prowadzi rejestru zgłoszeń: brak danych o zgłoszeniach (podaj plik --reports).");
  else lines.push(...(silent.length ? silent.map((r) => `- ${r.id}: zgłoszono ${r.reportedAt.slice(0, 10)}, bez reakcji`) : ["Wszystkie zgłoszenia mają reakcję."]));
  return `${lines.join("\n")}\n`;
}

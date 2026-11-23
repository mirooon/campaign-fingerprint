/**
 * Periodic report for an institution (Markdown): new campaigns, persons, CT domains, share of ads taken
 * down, reports without a reaction. Synthetic run, no network.
 */
import { describe, expect, it } from "vitest";
import { clusterCampaigns } from "../lib/graph/cluster";
import { buildEvidenceGraph } from "../lib/graph/link";
import { makeDataset } from "../lib/graph/testkit";
import { emptyAdLibraryInfo } from "../lib/osint/adLibrary";
import type { CtFeedRecord } from "../lib/ct/feed";
import { parseSince, periodReport } from "../lib/pipeline/periodReport";

const NOW = new Date("2026-11-20T12:00:00Z");
const lib = (id: string, takenDown: boolean) => ({ ...emptyAdLibraryInfo(id, null), takenDown });

function run() {
  const ds = makeDataset([
    { id: "a", url: "https://nowa-oferta.test/1", firstSeen: "2026-11-18T10:00:00Z", personas: ["Jan Testowy"], trackers: [{ kind: "ga4", id: "G-NOWA111111" }], adLibrary: [lib("1000000000000001", true)] },
    { id: "b", url: "https://nowa-oferta.test/2", firstSeen: "2026-11-19T10:00:00Z", personas: ["Jan Testowy"], trackers: [{ kind: "ga4", id: "G-NOWA111111" }], adLibrary: [lib("1000000000000002", false)] },
    { id: "c", url: "https://stara-oferta.test/", firstSeen: "2026-09-01T10:00:00Z", personas: ["Ewa Fikcyjna"] },
  ]);
  return clusterCampaigns(buildEvidenceGraph(ds, { textMethod: "none" }));
}

const ctRecord = (domain: string, observed: string): CtFeedRecord =>
  ({ v: 1, type: "ct_candidate", observed_utc: observed, source: "replay", stream: null, domain, names: [domain], cert: { issuer: null, not_before: null, not_after: null, fingerprint: null, serial: null, log: null, log_url: null, cert_index: null, crtsh_id: null, seen_utc: null }, candidate: { campaign_id: "K01", campaign_label: "", score: 0.8, kind: "template", template: null, similar_domains: [], tokens: [], evidence: [] }, enrichment: null, status: "candidate", note: "" }) as CtFeedRecord;

describe("parseSince", () => {
  it("reads days and hours back from now", () => {
    expect(parseSince("7d", NOW).toISOString()).toBe("2026-11-13T12:00:00.000Z");
    expect(parseSince("36h", NOW).toISOString()).toBe("2026-11-19T00:00:00.000Z");
    expect(() => parseSince("tydzień", NOW)).toThrow();
  });
});

describe("periodReport", () => {
  it("has every section and counts only what falls in the period", () => {
    const { graph, campaigns } = run();
    const md = periodReport({
      graph,
      campaigns,
      since: parseSince("7d", NOW),
      until: NOW,
      ctRecords: [ctRecord("swieza-domena.test", "2026-11-19T00:00:00Z"), ctRecord("dawna-domena.test", "2026-10-01T00:00:00Z")],
      reports: [
        { id: "a", reportedAt: "2026-11-15T00:00:00Z", reaction: null },
        { id: "b", reportedAt: "2026-11-15T00:00:00Z", reaction: "ad removed" },
      ],
    });
    for (const heading of ["## New campaigns", "## People", "## Domains from CT", "## Taken-down ads", "## Reports without reaction"]) expect(md).toContain(heading);
    expect(md).toContain("Jan Testowy");
    expect(md).not.toContain("Ewa Fikcyjna");
    expect(md).toContain("swieza-domena.test");
    expect(md).not.toContain("dawna-domena.test");
    expect(md).toMatch(/1 of 2 \(50%\)/);
    expect(md).toMatch(/Reports without reaction[\s\S]*\ba\b/);
  });

  it("says so when there is no data for a section instead of dropping it", () => {
    const { graph, campaigns } = run();
    const md = periodReport({ graph, campaigns, since: parseSince("7d", NOW), until: NOW, ctRecords: [], reports: null });
    expect(md).toContain("no data on reports");
    expect(md).toContain("## Domains from CT");
  });
});

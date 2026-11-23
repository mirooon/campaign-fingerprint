/** bun run report -- [--since 7d] [--data <run folder>] [--ct-feed <file>] [--reports <file.json>] [--out report.md] */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_FEED_FILE, readFeedTail } from "../lib/ct/feed";
import type { CampaignsFile, EvidenceGraph } from "../lib/graph/model";
import { parseSince, periodReport, type ReportRecord } from "../lib/pipeline/periodReport";
import { readJson } from "../lib/pipeline/steps";
import { cli, main } from "./_cli";

const args = cli(
  {
    since: { type: "string" },
    data: { type: "string" },
    "ct-feed": { type: "string" },
    reports: { type: "string" },
    out: { type: "string" },
  } as const,
  `Usage: bun run report -- [--since 7d] [--data <run folder>] [--ct-feed <file>] [--reports <file.json>] [--out report.md]
Period report for an institution (Markdown): new campaigns, people, domains from CT, share of taken-down ads, reports without reaction.
--since: period back from now (7d, 36h). --data: folder with graph.json and campaigns.json (default VIEWER_DATA_DIR or data/).
--ct-feed: JSONL file of the CT watcher (default ${DEFAULT_FEED_FILE}). --reports: JSON [{"id","reportedAt","reaction"}] with the institution's reports (the tool keeps no register of them).
--out: result file (default standard output).`,
);

void main(() => {
  const dataDir = path.resolve(args.data ?? process.env.VIEWER_DATA_DIR ?? "data");
  const until = new Date();
  const text = periodReport({
    graph: readJson<EvidenceGraph>(path.join(dataDir, "graph.json")),
    campaigns: readJson<CampaignsFile>(path.join(dataDir, "campaigns.json")),
    since: parseSince(args.since ?? "7d", until),
    until,
    ctRecords: readFeedTail(path.resolve(args["ct-feed"] ?? DEFAULT_FEED_FILE), Number.MAX_SAFE_INTEGER),
    reports: args.reports ? readJson<ReportRecord[]>(path.resolve(args.reports)) : null,
  });
  if (args.out) writeFileSync(args.out, text, "utf8");
  else console.log(text);
});

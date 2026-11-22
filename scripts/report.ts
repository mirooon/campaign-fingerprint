/** bun run report -- [--since 7d] [--data <katalog przebiegu>] [--ct-feed <plik>] [--reports <plik.json>] [--out raport.md] */
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
  `Użycie: bun run report -- [--since 7d] [--data <katalog przebiegu>] [--ct-feed <plik>] [--reports <plik.json>] [--out raport.md]
Raport okresowy dla instytucji (Markdown): nowe kampanie, osoby, domeny z CT, odsetek zdjętych reklam, zgłoszenia bez reakcji.
--since: okres wstecz od teraz (7d, 36h). --data: katalog z graph.json i campaigns.json (domyślnie VIEWER_DATA_DIR albo data/).
--ct-feed: plik JSONL watchera CT (domyślnie ${DEFAULT_FEED_FILE}). --reports: JSON [{"id","reportedAt","reaction"}] ze zgłoszeniami instytucji (narzędzie nie prowadzi ich rejestru).
--out: plik wyniku (domyślnie standardowe wyjście).`,
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

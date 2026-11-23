/**
 * bun run backtest:ct -- --list <action log of the CERT List (NDJSON)> (--mode lead | --mode fingerprints) [options]
 * (1) lead: how much earlier a certificate appeared in the CT logs than the domain on the CERT List (crt.sh or a recording).
 * (2) fingerprints: fingerprints of the campaigns known up to day D, matched to certificates after D, recall at an alert budget.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BACKTEST_CONFIG, appearanceTime, backtestFingerprints, campaignsKnownBefore, parseCertActions, parseSightings, summarizeLeads, withRetry } from "../lib/ct/backtest";
import { buildFingerprints } from "../lib/ct/fingerprint";
import type { CampaignsFile } from "../lib/graph/model";
import { findEnriched } from "../lib/pipeline/analyzeMaterial";
import type { EnrichedDataset } from "../lib/pipeline/types";
import { lookupCt } from "../lib/osint/ct";
import { loadCtConfig } from "../lib/ct/config";
import { DEFAULTS, readJson } from "../lib/pipeline/steps";
import { cli, main } from "./_cli";

const args = cli(
  {
    list: { type: "string" },
    mode: { type: "string" },
    certs: { type: "string" },
    "save-certs": { type: "string" },
    sample: { type: "string" },
    seed: { type: "string" },
    data: { type: "string" },
    since: { type: "string" },
    budgets: { type: "string" },
    lexicon: { type: "string" },
    out: { type: "string" },
  } as const,
  `Usage: bun run backtest:ct -- --list actions_2026.log --mode lead [--certs recording.jsonl | (crt.sh)] [--sample 200 --seed 1] [--save-certs recording.jsonl] [--out result.json]
       bun run backtest:ct -- --list actions_2026.log --mode fingerprints --data <base> --since 2026-10-10T00:00:00Z --certs recording.jsonl [--budgets 10,50,100]
--certs: recorded certificates, JSON rows {"names": [...], "entry_timestamp": ..., "not_before": ...}; without it the lead mode asks crt.sh (with retries; --save-certs saves the answers to a recording).
Time a certificate appeared: the log entry time (SCT), and without it not_before + ${BACKTEST_CONFIG.notBeforeBackdateHours} h (CAs backdate the start of validity).
The fingerprints mode uses only certificates after day D and fingerprints from records seen up to D (no leak from the future).`,
);

void main(async () => {
  if (!args.list || !args.mode) throw new Error("required: --list and --mode lead|fingerprints (see --help)");
  const listed = parseCertActions(readFileSync(args.list, "utf8"));
  if (args.mode === "lead") {
    // seeded generator (LCG): the same --seed gives the same sample
    const rng = (() => {
      let x = Number(args.seed ?? 1) >>> 0 || 1;
      return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    })();
    const sample = [...listed].sort(() => rng() - 0.5).slice(0, Number(args.sample ?? 200));
    const recorded = args.certs ? parseSightings(readFileSync(args.certs, "utf8")) : null;
    const rows: Array<{ domain: string; listedUtc: string; appearedUtc: string | null; error?: string }> = [];
    for (const e of sample) {
      if (recorded) {
        rows.push({ ...e, appearedUtc: recorded.find((s) => s.domain === e.domain)?.seenUtc ?? null });
        continue;
      }
      try {
        const res = await withRetry(
          async () => {
            const r = await lookupCt(e.domain, { retries: 0 });
            if (!r) throw new Error("crt.sh did not answer");
            return r;
          },
          { attempts: BACKTEST_CONFIG.queryAttempts, delayMs: BACKTEST_CONFIG.retryDelayMs },
        );
        const times = res.certs.map((c) => appearanceTime({ entryTimestamp: c.entryTimestamp, notBefore: c.notBefore })).filter((t): t is string => !!t).sort();
        if (args["save-certs"]) for (const c of res.certs) appendFileSync(args["save-certs"], `${JSON.stringify({ names: c.sanDomains, entry_timestamp: c.entryTimestamp, not_before: c.notBefore })}\n`);
        rows.push({ ...e, appearedUtc: times[0] ?? null });
      } catch (err) {
        rows.push({ ...e, appearedUtc: null, error: (err as Error).message });
      }
    }
    const result = { mode: "lead", summary: summarizeLeads(rows), errors: rows.filter((r) => r.error).length, rows };
    if (args.out) writeFileSync(args.out, JSON.stringify(result, null, 1));
    console.log(JSON.stringify({ ...result, rows: undefined }, null, 1));
    return;
  }
  if (args.mode !== "fingerprints") throw new Error("--mode: lead or fingerprints");
  if (!args.data || !args.since || !args.certs) throw new Error("the fingerprints mode needs --data, --since and --certs");
  const dataDir = path.resolve(args.data);
  const enriched = findEnriched(dataDir);
  if (!enriched) throw new Error(`no enriched.json in ${dataDir}`);
  const known = campaignsKnownBefore(readJson<CampaignsFile>(path.join(dataDir, "campaigns.json")), readJson<EnrichedDataset>(enriched), args.since);
  const set = buildFingerprints(known, { config: loadCtConfig(args.lexicon ?? DEFAULTS.ctLexicon) });
  const out = backtestFingerprints({
    set,
    since: args.since,
    sightings: parseSightings(readFileSync(args.certs, "utf8")),
    listed: new Map(listed.map((e) => [e.domain, e.listedUtc])),
    budgets: (args.budgets ?? BACKTEST_CONFIG.alertBudgets.join(",")).split(",").map(Number),
  });
  console.log(`[backtest] campaigns known up to ${args.since}: ${known.campaigns.length}; alerts: ${out.alerts.length}; domains on the list after D: ${out.positives}`);
  for (const b of out.byBudget) console.log(`  budget ${b.budget}: alerts ${b.alerts}, hits ${b.hits}, recall ${b.recall === null ? "—" : b.recall.toFixed(2)}, median lead ${b.medianLeadHours === null ? "—" : `${b.medianLeadHours.toFixed(1)} h`}`);
  if (args.out) writeFileSync(args.out, JSON.stringify(out, null, 1));
});

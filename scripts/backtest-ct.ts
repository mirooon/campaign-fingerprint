/**
 * bun run backtest:ct -- --list <log akcji Listy CERT (NDJSON)> (--mode lead | --mode fingerprints) [opcje]
 * (1) lead: o ile wcześniej certyfikat pojawił się w logach CT niż domena na Liście CERT (crt.sh albo nagranie).
 * (2) fingerprints: odciski kampanii znanych do dnia D, dopasowanie do certyfikatów po D, recall przy budżecie alertów.
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
  `Użycie: bun run backtest:ct -- --list actions_2026.log --mode lead [--certs nagranie.jsonl | (crt.sh)] [--sample 200 --seed 1] [--save-certs nagranie.jsonl] [--out wynik.json]
       bun run backtest:ct -- --list actions_2026.log --mode fingerprints --data <baza> --since 2026-10-10T00:00:00Z --certs nagranie.jsonl [--budgets 10,50,100]
--certs: nagrane certyfikaty, wiersze JSON {"names": [...], "entry_timestamp": ..., "not_before": ...}; bez niego tryb lead pyta crt.sh (z ponowieniami; --save-certs zapisuje odpowiedzi do nagrania).
Czas pojawienia się certyfikatu: czas wpisu w logu (SCT), a bez niego not_before + ${BACKTEST_CONFIG.notBeforeBackdateHours} h (CA cofa początek ważności).
Tryb fingerprints używa tylko certyfikatów po dniu D i odcisków z rekordów widzianych do D (bez przecieku z przyszłości).`,
);

void main(async () => {
  if (!args.list || !args.mode) throw new Error("wymagane: --list i --mode lead|fingerprints (zob. --help)");
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
            if (!r) throw new Error("crt.sh nie odpowiedział");
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
  if (args.mode !== "fingerprints") throw new Error("--mode: lead albo fingerprints");
  if (!args.data || !args.since || !args.certs) throw new Error("tryb fingerprints wymaga --data, --since i --certs");
  const dataDir = path.resolve(args.data);
  const enriched = findEnriched(dataDir);
  if (!enriched) throw new Error(`brak enriched.json w ${dataDir}`);
  const known = campaignsKnownBefore(readJson<CampaignsFile>(path.join(dataDir, "campaigns.json")), readJson<EnrichedDataset>(enriched), args.since);
  const set = buildFingerprints(known, { config: loadCtConfig(args.lexicon ?? DEFAULTS.ctLexicon) });
  const out = backtestFingerprints({
    set,
    since: args.since,
    sightings: parseSightings(readFileSync(args.certs, "utf8")),
    listed: new Map(listed.map((e) => [e.domain, e.listedUtc])),
    budgets: (args.budgets ?? BACKTEST_CONFIG.alertBudgets.join(",")).split(",").map(Number),
  });
  console.log(`[backtest] kampanie znane do ${args.since}: ${known.campaigns.length}; alerty: ${out.alerts.length}; domen na liście po D: ${out.positives}`);
  for (const b of out.byBudget) console.log(`  budżet ${b.budget}: alerty ${b.alerts}, trafienia ${b.hits}, recall ${b.recall === null ? "—" : b.recall.toFixed(2)}, mediana wyprzedzenia ${b.medianLeadHours === null ? "—" : `${b.medianLeadHours.toFixed(1)} h`}`);
  if (args.out) writeFileSync(args.out, JSON.stringify(out, null, 1));
});

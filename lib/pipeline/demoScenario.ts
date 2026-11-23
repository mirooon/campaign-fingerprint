/**
 * Demo scenario (`bun run demo`): a synthetic base and a batch of eight new materials covering every
 * outcome the analysis can give, built from `data/sample` and analysed offline. The batch holds a known
 * campaign, a group of similar campaigns, a duplicate, material with too little data, a dead page (only a
 * screenshot with the address in the bar) and three materials of one campaign whose pages changed face
 * and domain while the back end stayed. Reads and writes files; the pure checks live in the tests.
 */
import { copyFileSync, cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { encodeXid } from "../osint/clickIds";
import { compileWatchlist, loadWatchlist } from "../text/persona";
import { analyzeMaterial, type MaterialResult } from "./analyzeMaterial";
import { runBase, type BaseResult, type MediaAvailability } from "./base";
import { materialCsv } from "./materialCsv";
import { savedPage, writeSampleCases, type SampleCaseSpec } from "./sampleCases";
import { fixtureSources } from "./sources";
import { detectOcr } from "../media/ocr";

/** Sample ads whose cases make up the demo base (two or more per campaign, so that campaigns exist). */
export const DEMO_BASE_CASES: SampleCaseSpec[] = [
  { name: "base-c1-a", itemId: "c1-01" },
  { name: "base-c1-b", itemId: "c1-02" },
  { name: "base-c1-c", itemId: "c1-04" },
  { name: "base-c1-d", itemId: "c1-07" },
  { name: "base-c2-a", itemId: "c2-01" },
  { name: "base-c2-b", itemId: "c2-04" },
  { name: "base-c2-c", itemId: "c2-05" },
  { name: "base-c3-a", itemId: "c3-01" },
  { name: "base-c3-b", itemId: "c3-03" },
  { name: "base-c3-c", itemId: "c3-05" },
  { name: "base-c4-a", itemId: "c4-01" },
  { name: "base-c4-b", itemId: "c4-02" },
];

/** Address of the dead page of the demo (the same as in `data/sample/demo/zrzut-martwa-strona.png`). */
export const DEAD_PAGE_HOST = "martwa-oferta.example.com";

/** Fictional backend of the evolving campaign: tracker machine, platform account and form client. */
const EVOLUTION = {
  trackerMachine: "a1b2c3",
  platformAccount: "3c9e5a71-2d4b-4f68-9a0c-7e1d5b3f8a26",
  formClient: "d4e5f6a7-b8c9-4d0e-a1f2-3b4c5d6e7f80",
  cdn: "https://cdn.example/landing-cdn",
  formService: "https://leads.example/api/v1/lead",
};

/** The three pages of the evolving campaign: another domain and another face each time, the same back end. */
const EVOLUTION_STEPS = [
  { name: "evolution-1", host: "zdrowy-sekret.test", persona: "Adam Testowy", pid: 40111, counter: 1200, day: "2026-09-02", title: "Lekarz ujawnia domowy sposób" },
  { name: "evolution-2", host: "dieta-cud-tydzien.test", persona: "Zofia Wymyślona", pid: 40377, counter: 8841, day: "2026-09-19", title: "Dietetyczka zdradza prosty trik" },
  { name: "evolution-3", host: "vitalis-oferta.test", persona: "Kamil Demonstracyjny", pid: 40590, counter: 15320, day: "2026-10-07", title: "Znany youtuber poleca suplement" },
] as const;

/** HTML of one page of the evolving campaign (a saved page with the back end in its scripts and form). */
function evolutionPage(step: (typeof EVOLUTION_STEPS)[number]): string {
  const clickId = encodeXid({ time: `${step.day}T12:00:00Z`, machine: EVOLUTION.trackerMachine, pid: step.pid, counter: step.counter });
  const url = `https://${step.host}/oferta?clickid=${clickId}`;
  const html = `<html><head><title>${step.title}</title><script src="${EVOLUTION.cdn}/${EVOLUTION.platformAccount}/app.js"></script></head><body>
<h1>${step.title}</h1>
<p>${step.persona} opowiada w nagraniu, jak w kilka tygodni poprawił samopoczucie. Zamów dziś, liczba opakowań jest ograniczona.</p>
<form action="${EVOLUTION.formService}/${EVOLUTION.formClient}" method="post"><input name="phone" placeholder="Numer telefonu"></form>
</body></html>`;
  return savedPage(url, html);
}

/** What the demo reads from the sample and where it writes. */
export interface DemoPaths {
  /** Cases the base is built from. */
  baseCases: string;
  /** The base (graph.json, campaigns.json, enriched.json ...). */
  base: string;
  /** The batch: one folder per case. */
  batch: string;
  /** Recorded responses (sample fixtures plus the demo's own RDAP, CT and DNS answers). */
  fixtures: string;
  /** Result of the analysis: wynik.json and wynik.csv. */
  result: string;
}

/** Paths of a demo run under `outDir`. */
export function demoPaths(outDir: string): DemoPaths {
  const root = path.resolve(outDir);
  return { baseCases: path.join(root, "sprawy-bazy"), base: path.join(root, "baza"), batch: path.join(root, "partia"), fixtures: path.join(root, "nagrane-odpowiedzi"), result: path.join(root, "wynik") };
}

/** Recorded answers for the demo's fictional domains: RDAP, crt.sh and DNS of the dead page's domain, added to the sample's. */
function writeDemoFixtures(sampleDir: string, target: string): void {
  rmSync(target, { recursive: true, force: true });
  cpSync(path.join(sampleDir, "fixtures"), target, { recursive: true });
  const domain = "example.com";
  mkdirSync(path.join(target, "rdap"), { recursive: true });
  mkdirSync(path.join(target, "crtsh"), { recursive: true });
  writeFileSync(
    path.join(target, "rdap", `${domain}.json`),
    JSON.stringify({
      objectClassName: "domain",
      ldhName: domain.toUpperCase(),
      events: [{ eventAction: "registration", eventDate: "2026-09-25T08:00:00Z" }],
      nameservers: [{ objectClassName: "nameserver", ldhName: "NS1.DEMO-DNS.EXAMPLE" }],
      entities: [{ objectClassName: "entity", roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text", "Demo Registrar"]]] }],
    }),
  );
  writeFileSync(
    path.join(target, "crtsh", `${domain}.json`),
    JSON.stringify([
      { issuer_ca_id: 1, issuer_name: "C=US, O=Demo CA, CN=Demo CA R1", common_name: DEAD_PAGE_HOST, name_value: DEAD_PAGE_HOST, id: 1, entry_timestamp: "2026-09-25T09:00:00.000", not_before: "2026-09-25T09:00:00", not_after: "2026-12-24T09:00:00", serial_number: "01" },
    ]),
  );
  const dnsFile = path.join(target, "dns.json");
  const dns = JSON.parse(readFileSync(dnsFile, "utf8")) as Record<string, Record<string, string[]>>;
  dns[DEAD_PAGE_HOST] = { A: ["192.0.2.77"], AAAA: [], CNAME: [], NS: ["ns1.demo-dns.example"], MX: [], TXT: [] };
  writeFileSync(dnsFile, JSON.stringify(dns));
}

/** Writes the demo's inputs (base cases, batch, recorded responses) under `outDir`; returns the paths. */
export function buildDemoInputs(sampleDir: string, outDir: string): DemoPaths {
  const p = demoPaths(outDir);
  for (const dir of [p.baseCases, p.batch]) rmSync(dir, { recursive: true, force: true });
  writeSampleCases(sampleDir, p.baseCases, DEMO_BASE_CASES);
  writeSampleCases(sampleDir, p.batch, [
    { name: "1-known-campaign", itemId: "c1-03" },
    { name: "2-similar-campaigns", itemId: "c4-05" },
  ]);
  // a copy of a case of the base: the same page and the same picture
  cpSync(path.join(p.baseCases, "base-c2-a"), path.join(p.batch, "3-duplicate"), { recursive: true });
  // too little data: a bare picture of an ad, no address, no page
  mkdirSync(path.join(p.batch, "4-insufficient-data"), { recursive: true });
  copyFileSync(path.join(sampleDir, "images", "n4.png"), path.join(p.batch, "4-insufficient-data", "zrzut.png"));
  // dead page: no HTML, only the screenshot with the address in the bar
  mkdirSync(path.join(p.batch, "5-dead-page"), { recursive: true });
  copyFileSync(path.join(sampleDir, "demo", "zrzut-martwa-strona.png"), path.join(p.batch, "5-dead-page", "zrzut.png"));
  for (const step of EVOLUTION_STEPS) {
    const dir = path.join(p.batch, `6-${step.name}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "strona.html"), evolutionPage(step));
  }
  writeDemoFixtures(sampleDir, p.fixtures);
  return p;
}

/** Media of the demo: OCR when tesseract is there; ASR, audio and CLIP are off (no models in the demo), with the reason. */
async function demoMedia(): Promise<MediaAvailability> {
  const ocr = await detectOcr();
  const off = { available: false, reason: "turned off in the demo (no models in the container image)" };
  return { ocr: { available: ocr.available, reason: ocr.reason }, asr: off, audio: off, clip: off };
}

/** Builds the inputs, the base and analyses the batch offline; writes wynik.json and wynik.csv. */
export async function runDemo(sampleDir: string, outDir: string, log: (m: string) => void = () => undefined): Promise<{ paths: DemoPaths; base: BaseResult; result: MaterialResult }> {
  const paths = buildDemoInputs(sampleDir, outDir);
  const base = await runBase({ casesDir: paths.baseCases, outDir: paths.base, offline: true, detect: demoMedia, log });
  const recorded = fixtureSources(paths.fixtures);
  const result = await analyzeMaterial(
    { caseDirs: readBatchCases(paths.batch) },
    {
      dataDir: paths.base,
      workDir: path.join(outDir, "praca"),
      fixtures: paths.fixtures,
      live: recorded,
      personas: compileWatchlist(loadWatchlist(path.join(sampleDir, "personas.json"))),
      media: { ocr: true },
      log,
    },
  );
  mkdirSync(paths.result, { recursive: true });
  writeFileSync(path.join(paths.result, "wynik.json"), JSON.stringify(result, null, 1));
  writeFileSync(path.join(paths.result, "wynik.csv"), materialCsv(result));
  return { paths, base, result };
}

/** Case folders of the batch in name order (the folders are numbered, so the order is fixed). */
function readBatchCases(batch: string): string[] {
  return readdirSync(batch).sort().map((n) => path.join(batch, n));
}

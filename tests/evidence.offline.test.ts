/**
 * Evidence pack export (section 5 of the legal report) on the synthetic sample.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportEvidencePack, GOOD_FAITH_STATEMENT } from "../lib/evidence/pack";
import { runSample } from "./sampleRun";

let tmp: string;
let run: Awaited<ReturnType<typeof runSample>>;

beforeAll(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), "evidence-test-"));
  run = await runSample({ enrich: { archiveDir: path.join(tmp, "archive") } });
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function pack(memberId: string, name: string) {
  const res = exportEvidencePack({
    campaignId: run.campaigns.assignments[memberId],
    graph: run.graph,
    campaigns: run.campaigns,
    enriched: run.ds,
    config: run.config,
    outDir: path.join(tmp, name),
    submitter: { name: "Analityk Testowy", email: "analityk@example.org" },
    packageId: "00000000-0000-4000-8000-000000000001",
    now: () => new Date("2026-11-19T12:00:00Z"),
    toolVersion: { name: "starter-test", version: "0.0.0", gitCommit: null },
  });
  const read = (f: string) => readFileSync(path.join(res.outDir, f), "utf8");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ...res, read, json: JSON.parse(read("evidence.json")) as any };
}

describe("evidence pack", () => {
  it("writes the header fields and keeps facts apart from model outputs", () => {
    const { json } = pack("c1-01", "c1");
    expect(json).toMatchObject({
      package_id: "00000000-0000-4000-8000-000000000001",
      created_utc: "2026-11-19T12:00:00.000Z",
      tlp: "TLP:AMBER",
      good_faith_statement: GOOD_FAITH_STATEMENT,
      submitter: { name: "Analityk Testowy", email: "analityk@example.org" },
    });
    expect(json.submitter.address).toMatch(/^\[UZUPEŁNIJ/);
    expect(json.tool_version.name).toBe("starter-test");
    expect(json.legal_assessment.note).toMatch(/^\(wniosek\)/);
    expect(Object.keys(json.observations)).toEqual(expect.arrayContaining(["ads", "domains", "accounts", "shared_identifiers"]));
    expect(json.analysis.note).toMatch(/wskazówki/);
    expect(json.analysis.link_scores.length).toBeGreaterThan(0);
    // model outputs (scores, LLM text) never appear among the observations
    expect(JSON.stringify(json.observations)).not.toMatch(/"score"|deepfake|llm/i);
  });

  it("carries the ad-library record: library address, payer and the advertiser account with its attributes", () => {
    const campaignId = run.campaigns.assignments["c1-01"];
    const members = run.campaigns.campaigns.find((c) => c.id === campaignId)!.members;
    const libraryColumns = { ad_platform: "google", ad_id: "CR1", ad_library_url: "https://atc.example/creative/CR1", advertiser_id: "AR0001", advertiser_legal_name: "Fikcyjna Firma Sp. z o.o.", advertiser_location: "PL", advertiser_verified: "true", ad_payers: "Fundator Testowy" };
    const enriched = { ...run.ds, items: run.ds.items.map((it) => (it.id === "c1-01" ? { ...it, extra: { ...it.extra, ...libraryColumns } } : it)) };
    const res = exportEvidencePack({
      campaignId, graph: run.graph, campaigns: run.campaigns, enriched, config: run.config, outDir: path.join(tmp, "c1-lib"),
      submitter: { name: "Analityk Testowy", email: "analityk@example.org" }, packageId: "00000000-0000-4000-8000-000000000002",
      now: () => new Date("2026-11-19T12:00:00Z"), toolVersion: { name: "starter-test", version: "0.0.0", gitCommit: null },
    });
    expect(members).toContain("c1-01");
    const json = JSON.parse(readFileSync(path.join(res.outDir, "evidence.json"), "utf8"));
    const ad = json.observations.ads.find((a: { item_id: string }) => a.item_id === "c1-01");
    expect(ad).toMatchObject({ repository_record: "https://atc.example/creative/CR1", payer_displayed: "Fundator Testowy" });
    const account = json.observations.accounts.find((a: { library_account: unknown }) => a.library_account);
    expect(account.library_account).toEqual({ platform: "google", advertiser_id: "AR0001", legal_name: "Fikcyjna Firma Sp. z o.o.", location: "PL", verified: true });
    expect(readFileSync(path.join(res.outDir, "evidence.md"), "utf8")).toContain("Fikcyjna Firma Sp. z o.o.");
  });

  it("lists every ad with IDs, URLs and UTC timestamps, and the domains with registration data", () => {
    const { json } = pack("c1-01", "c1-ads");
    expect(json.observations.ads).toHaveLength(9);
    for (const ad of json.observations.ads) {
      expect(ad.ad_ids.ad_id).toBe(ad.item_id);
      expect(ad.first_seen_utc).toMatch(/^2026-\d\d-\d\dT00:00:00\.000Z$/);
    }
    const redirected = json.observations.ads.find((a: { item_id: string }) => a.item_id === "c1-09");
    expect(redirected.landing_chain.map((h: { url: string }) => h.url)).toEqual(["https://kz-ai-start.test/", "https://kryptozysk-ai.example/start?src=kz"]);
    const domain = json.observations.domains.find((d: { domain_fqdn: string }) => d.domain_fqdn === "kryptozysk-ai.example");
    expect(domain.registration_data.registrar).toBe("NameCheap, Inc.");
    expect(domain.primary_purpose_evidence.form_backends).toContain("leads-gate.test/api/v1/submit/<uuid>/");
    expect(json.observations.accounts.map((a: { advertiser_displayed: string }) => a.advertiser_displayed)).toContain("Finanse Dziś Demo");
  });

  it("names the impersonated person without any biometric template", () => {
    const { json } = pack("c1-01", "c1-persona");
    expect(json.impersonated_person).toHaveLength(1);
    const p = json.impersonated_person[0];
    expect(p.impersonated_person).toBe("Adam Testowy");
    expect(p.match_basis.join(" ")).toMatch(/DROZD/);
    expect(p.biometric_data).toMatch(/^brak/);
    expect(p.synthetic_media_assessment.scores).toEqual(
      expect.arrayContaining([
        { item_id: "c1-01", score: 0.93 },
        { item_id: "c1-04", score: 0.88 },
      ]),
    );
    expect(JSON.stringify(json)).not.toMatch(/embedding|landmark|faceprint|voiceprint|"vector"/i);
  });

  it("hashes archived HTML and creatives; every manifest line verifies", () => {
    const res = pack("c1-01", "c1-hash");
    const lines = res.read("manifest.sha256").trim().split("\n");
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) {
      const [sha, file] = line.split("  ");
      expect(createHash("sha256").update(readFileSync(path.join(res.outDir, file))).digest("hex"), file).toBe(sha);
    }
    const files = lines.map((l) => l.split("  ")[1]);
    expect(files.filter((f) => f.startsWith("files/html/"))).toHaveLength(2);
    expect(files.filter((f) => f.startsWith("files/creatives/"))).toHaveLength(9);
    // archived HTML is the page body as fetched: its hash equals the recorded body SHA-256
    const page = res.json.observations.domains.find((d: { domain_fqdn: string }) => d.domain_fqdn === "kryptozysk-ai.example").pages[0];
    expect(page.archive_file).toBe(`files/html/${page.body_sha256_raw}.html`);
    expect(res.json.integrity.manifest_sha256).toBe(createHash("sha256").update(res.read("manifest.sha256")).digest("hex"));
  });

  it("writes a plain CERT domain list without shorteners or platforms", () => {
    const c1 = pack("c1-01", "c1-cert");
    expect(c1.read("cert-domains.txt")).toBe("kryptozysk-ai.example\nkz-ai-start.test\nzysk-ai-platforma.example\n");
    const c5 = pack("c5-01", "c5-cert");
    expect(c5.read("cert-domains.txt")).toBe("wygrana-demo.example\n");
    expect(c5.json.integrity.excluded_from_cert_list.map((e: { domain: string }) => e.domain)).toEqual(["krotki.test"]);
  });

  it("proposes actions per recipient and fills the DSA Art. 16 notice template", () => {
    const res = pack("c3-01", "c3");
    expect(res.json.requested_action.map((a: { recipient: string }) => a.recipient)).toEqual(["D", "C", "K", "U", "P", "S", "E"]);
    expect(res.json.requested_action.every((a: { status: string }) => a.status === "propozycja")).toBe(true);
    const notice = res.read("dsa-art16-notice.md");
    for (const section of ["## (a)", "## (b)", "## (c)", "## (d)"]) expect(notice).toContain(section);
    expect(notice).toContain(GOOD_FAITH_STATEMENT);
    expect(notice).toContain("Analityk Testowy");
    expect(notice).toContain("analityk@example.org");
    expect(notice).toContain("https://wiadomosci-demo.test/artykul/marek-fikcyjny-wywiad?src=fb1");
    expect(notice).toContain("https://lp.oferta-fikcyjna.example/rejestracja?src=fb1&sub1=mb_kowal&offer_id=771304");
    expect(res.read("evidence.md")).toContain("## Obserwacje (fakty)");
    expect(res.read("evidence.md")).toContain("## Analiza (wyniki modeli i heurystyk — wskazówki)");
  });
});

/**
 * Evidence pack export (section 5 of the legal report) on the synthetic sample.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportEvidencePack, GOOD_FAITH_STATEMENT, type EvidenceOptions } from "../lib/evidence/pack";
import { parseCertList } from "../lib/evidence/certList";
import { hashCaseFiles } from "../lib/pipeline/caseFiles";
import { runSample, SAMPLE } from "./sampleRun";

let tmp: string;
let run: Awaited<ReturnType<typeof runSample>>;

beforeAll(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), "evidence-test-"));
  run = await runSample({ enrich: { archiveDir: path.join(tmp, "archive") } });
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function pack(memberId: string, name: string, extra: Partial<EvidenceOptions> = {}) {
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
    ...extra,
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
    expect(ad).toMatchObject({ payer_displayed: "Fundator Testowy" });
    expect(ad.ad_urls).toContain("https://atc.example/creative/CR1");
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
    expect(res.read("dsa-art16-notice.md")).toContain("dsa-art16-facebook.md");
    const notice = res.read("dsa-art16-facebook.md");
    for (const section of ["## (a)", "## (b)", "## (c)", "## (d)"]) expect(notice).toContain(section);
    expect(notice).toContain(GOOD_FAITH_STATEMENT);
    expect(notice).toContain("Analityk Testowy");
    expect(notice).toContain("analityk@example.org");
    expect(notice).toContain("https://wiadomosci-demo.test/artykul/marek-fikcyjny-wywiad?src=fb1");
    expect(notice).toContain("https://lp.oferta-fikcyjna.example/rejestracja?src=fb1&sub1=mb_kowal&offer_id=771304");
    expect(res.read("evidence.md")).toContain("## Obserwacje (fakty)");
    expect(res.read("evidence.md")).toContain("## Analiza (wyniki modeli i heurystyk — wskazówki)");
  });

  it("writes no embedding vector into any file of the pack, even when the enrichment holds them", () => {
    const marker = 0.123456789;
    const member = run.campaigns.assignments["c1-01"];
    const enr = run.ds.perItem["c1-01"];
    const saved = { image: enr.imageEmbedding, video: enr.videoEmbedding, speaker: enr.speakerEmbedding };
    enr.imageEmbedding = [marker, 0.5];
    enr.videoEmbedding = [marker, 0.25];
    enr.speakerEmbedding = [marker, 0.75];
    try {
      const res = pack("c1-01", "c1-vectors");
      expect(member).toBeTruthy();
      for (const f of readdirSync(res.outDir, { recursive: true, withFileTypes: true })) {
        if (!f.isFile() || /\.(png|jpe?g|webp|gif|mp4|wav|mp3)$/i.test(f.name)) continue;
        expect(readFileSync(path.join(f.parentPath, f.name), "utf8"), f.name).not.toContain(String(marker));
      }
    } finally {
      enr.imageEmbedding = saved.image;
      enr.videoEmbedding = saved.video;
      enr.speakerEmbedding = saved.speaker;
    }
  });

  it("adds the views for providers, KNF and the prosecutor, and a DSA justification without placeholders", () => {
    const res = pack("c1-01", "c1-views");
    for (const f of ["preservation-request.md", "knf-notification.md", "prosecutor-notification.md"]) expect(res.files, f).toContain(f);
    expect(res.read("preservation-request.md")).toContain("kryptozysk-ai.example");
    const dsa = res.read("dsa-art16-facebook.md");
    expect(dsa.split("## (b)")[0]).not.toContain("[UZUPEŁNIJ");
    expect(dsa).toMatch(/Adam Testowy/);
  });

  it("writes indicator files per recipient with the registrar's abuse contact and IANA ID", () => {
    const res = pack("c1-01", "c1-recipients");
    expect(res.files).toEqual(expect.arrayContaining(["wskazniki/rejestrator.csv", "wskazniki/hosting.csv", "wskazniki/platforma.csv", "odbiorcy.md"]));
    expect(res.read("wskazniki/rejestrator.csv")).toContain('kryptozysk-ai.example,"NameCheap, Inc."');
    const domain = res.json.observations.domains.find((d: { domain_fqdn: string }) => d.domain_fqdn === "kryptozysk-ai.example");
    expect(domain.registration_data).toHaveProperty("registrar_iana_id");
    expect(domain.registration_data).toHaveProperty("abuse_email");
    expect(domain.registration_data.rdap_query_note).toMatch(/czas zapytania/);
  });

  it("states the retention from the configuration instead of a placeholder", () => {
    const { json } = pack("c1-01", "c1-retention");
    const text = JSON.stringify(json.integrity.personal_data_inventory);
    expect(text).not.toContain("UZUPEŁNIJ");
    expect(text).toMatch(/do zakończenia sprawy/);
    expect(text).toMatch(/RDAP 7 dni/);
  });

  it("writes evidence.md in plain words: Polish trace names, the reason per ad, readable dates, sections that were only in JSON", () => {
    const { read, json } = pack("c1-01", "c1-readable");
    const md = read("evidence.md");
    const summary = md.split("## Streszczenie faktów")[1].split("##")[0];
    expect(summary).not.toMatch(/\b(nameserver|utm_campaign|asn|campaign_param|platform_account)\b/);
    expect(md).toContain("| Dlaczego w kampanii |");
    expect(md).toMatch(/\| Rodzaj śladu \| Wartość \| Reklamy \|/);
    expect(md).toContain("## Dane osobowe w paczce");
    expect(md).toContain("## Łańcuch przechowywania");
    expect(md).toContain("#### Tekst reklam");
    expect(md).not.toMatch(/T\d\d:\d\d:\d\d\.\d+Z \|/); // no raw ISO timestamps in the tables of ads and files
    for (const a of json.observations.ads) expect(typeof a.why_in_campaign).toBe("string");
    expect(Object.keys(json.analysis.similarity_methods).every((k) => ["image", "text", "dom", "audio"].includes(k))).toBe(true);
  });

  it("keeps a chain of custody of at least three entries and a null time stamp with its reason when no TSA was used", () => {
    const { json } = pack("c1-01", "c1-custody");
    expect(json.integrity.custody_log.length).toBeGreaterThanOrEqual(3);
    expect(json.integrity.custody_log.map((e: { actor: string }) => e.actor)).toEqual(expect.arrayContaining(["starter (wzbogacanie)", "starter (eksport paczki)"]));
    expect(json.integrity.timestamp_token).toBeNull();
    expect(json.integrity.timestamp_note).toMatch(/--tsa/);
  });

  it("writes a STIX 2.1 bundle with the campaign, indicators and relationships", () => {
    const res = pack("c1-01", "c1-stix");
    const bundle = JSON.parse(res.read("stix-bundle.json")) as { type: string; objects: Array<{ type: string }> };
    const types = new Set(bundle.objects.map((o) => o.type));
    expect(bundle.type).toBe("bundle");
    for (const t of ["campaign", "indicator", "relationship", "marking-definition"]) expect(types.has(t), t).toBe(true);
    expect(res.json.integrity.manifest.map((m: { file: string }) => m.file)).toContain("stix-bundle.json");
  });

  it("takes the register of earlier reports: date and status per recipient, the waiting list and ads after the first report", () => {
    const campaignId = run.campaigns.assignments["c1-01"];
    const prior = [
      { campaign_id: campaignId, recipient: "facebook (art. 16 DSA)", reported_utc: "2026-09-10T00:00:00.000Z", category: "podszywanie się", status: "wysłane", response_utc: null, reference: null },
      { campaign_id: "K999", recipient: "inna kampania", reported_utc: "2026-09-10T00:00:00.000Z", category: "oszustwo", status: "wysłane", response_utc: null, reference: null },
    ];
    const { json } = pack("c1-01", "c1-prior", { priorReports: prior });
    expect(json.prior_reports).toEqual([prior[0]]);
    expect(json.reports_register.waiting).toEqual([{ recipient: "facebook (art. 16 DSA)", reported_utc: "2026-09-10T00:00:00.000Z", days_waiting: 70 }]);
    expect(json.harm_and_victims.continuation_after_notice.first_report_utc).toBe("2026-09-10T00:00:00.000Z");
    expect(json.harm_and_victims.continuation_after_notice.ads_first_seen_after.length).toBeGreaterThan(0);
    expect(pack("c1-01", "c1-noprior").json.harm_and_victims.continuation_after_notice).toBeNull();
  });

  it("copies creatives whose imagePath is absolute (case-directory import)", () => {
    const abs = path.join(SAMPLE, "images", readdirSync(path.join(SAMPLE, "images"))[0]);
    const memberId = "c1-01";
    const ds = structuredClone(run.ds);
    const item = ds.items.find((it) => it.id === memberId)!;
    item.imagePath = abs;
    const res = exportEvidencePack({
      campaignId: run.campaigns.assignments[memberId],
      graph: run.graph,
      campaigns: run.campaigns,
      enriched: ds,
      config: run.config,
      outDir: path.join(tmp, "abs"),
      packageId: "00000000-0000-4000-8000-000000000001",
      now: () => new Date("2026-11-19T12:00:00Z"),
    });
    const ad = (res.record.observations as { ads: Array<{ item_id: string; creative_files: Array<{ file: string; sha256: string | null }> }> }).ads.find((a) => a.item_id === memberId)!;
    expect(ad.creative_files).toHaveLength(1);
    expect(ad.creative_files[0].file).toBe(`files/creatives/${path.basename(abs)}`);
    const manifest = readFileSync(path.join(res.outDir, "manifest.sha256"), "utf8");
    expect(manifest).toContain(`${ad.creative_files[0].sha256}  ${ad.creative_files[0].file}`);
  });

  it("takes the CERT list status from a local copy and leaves domains already on the list out of cert-domains.txt", () => {
    const certList = {
      copyUtc: "2026-11-18T06:00:00.000Z",
      entries: parseCertList(
        JSON.stringify([
          { RegisterPositionId: 4711, DomainAddress: "kryptozysk-ai.example", InsertDate: "2026-11-10T09:30:00Z", DeleteDate: null },
          { RegisterPositionId: 4000, DomainAddress: "zysk-ai-platforma.example", InsertDate: "2026-01-10T09:30:00Z", DeleteDate: "2026-06-10T09:30:00Z" },
        ]),
      ),
    };
    const res = pack("c1-01", "c1-certlist", { certList });
    const domains = res.json.observations.domains as Array<{ domain_fqdn: string; cert_warning_list_status: Record<string, unknown> }>;
    const listed = domains.find((d) => d.domain_fqdn === "kryptozysk-ai.example")!;
    expect(listed.cert_warning_list_status).toMatchObject({ checked: true, status: "active", register_position_id: 4711, insert_date: "2026-11-10T09:30:00.000Z", delete_date: null, list_copy_utc: "2026-11-18T06:00:00.000Z" });
    expect(domains.find((d) => d.domain_fqdn === "zysk-ai-platforma.example")!.cert_warning_list_status).toMatchObject({ status: "removed", register_position_id: 4000 });
    expect(domains.find((d) => d.domain_fqdn === "kz-ai-start.test")!.cert_warning_list_status).toMatchObject({ status: "absent" });
    expect(res.read("cert-domains.txt")).toBe("kz-ai-start.test\nzysk-ai-platforma.example\n");
    const reasons = res.read("cert-domains-uzasadnienie.md");
    expect(reasons).toContain("kz-ai-start.test");
    expect(reasons).toMatch(/kryptozysk-ai\.example.*już na liście.*4711/);
    expect(res.json.observations.ads_to_listed_domains).toBeGreaterThan(0);
  });

  it("says the CERT status was not checked when there is no local copy of the list", () => {
    const res = pack("c1-01", "c1-nocert", { certListNote: "brak pliku listy" });
    const d = res.json.observations.domains[0];
    expect(d.cert_warning_list_status).toMatchObject({ checked: false, status: "unchecked" });
    expect(d.cert_warning_list_status.note).toMatch(/brak pliku listy/);
  });

  it("says what kind the declared payer is and what company data the page gives, as hints", () => {
    const ds = structuredClone(run.ds);
    ds.perItem["c1-01"].adLibrary = [
      { id: "1000000000000101", payers: ["Jan Testowy"], beneficiaries: ["Jan Testowy"], takenDown: false, violations: [], euReach: null, ageMin: null, ageMax: null, gender: null, locations: [], pageId: null, pageName: null, pageDeleted: null, pageVerification: null, fetchedAt: null, rawSha256: null, error: null },
    ];
    const pageKey = ds.perItem["c1-01"].pageKey!;
    ds.pages[pageKey].extract!.companyIds = [{ kind: "nip", value: "1234563219", valid: false, check: "checksum", source: "text", quote: "NIP 123-456-32-19" }];
    ds.pages[pageKey].extract!.legalEntities = ["Fikcyjny Sklep Sp. z o.o."];
    const res = pack("c1-01", "c1-payer", { enriched: ds });
    const ad = res.json.observations.ads.find((a: { item_id: string }) => a.item_id === "c1-01");
    expect(ad).toMatchObject({ payer_kinds: ["person"], payer_equals_beneficiary: true, payer_suspicious: false });
    expect(ad.payer_notes.join(" ")).toMatch(/identity theft/);
    expect(ad.company_identifiers).toEqual([{ kind: "nip", value: "1234563219", checksum_valid: false, check: "checksum", source: "text", quote: "NIP 123-456-32-19" }]);
    expect(ad.legal_entities).toEqual(["Fikcyjny Sklep Sp. z o.o."]);
    const md = res.read("evidence.md");
    expect(md).toMatch(/płatnik zadeklarowany w repozytorium reklam: osoba prywatna/);
    expect(md).toMatch(/suma kontrolna błędna/);
    expect(md).toMatch(/nie dowód, kto płacił/);
    // an ad without a declared payer says nothing about one
    expect(res.json.observations.ads.find((a: { item_id: string }) => a.item_id === "c1-04").payer_kinds).toBeNull();
  });

  it("puts the ad-library record (payer, removal, reach, page, response SHA-256) and the library link with filters into the pack", () => {
    const ds = structuredClone(run.ds);
    const sha = "ab".repeat(32);
    ds.perItem["c1-01"].adLibrary = [
      {
        id: "1000000000000101", payers: ["Testowa Spolka Platnik"], beneficiaries: ["Testowa Spolka Beneficjent"], takenDown: true, violations: ["Prohibited Commercial Practices"],
        euReach: 123456, ageMin: 35, ageMax: 64, gender: "All", locations: ["Poland"], pageId: "5550001", pageName: "Finanse Dziś Demo", pageDeleted: false, pageVerification: null,
        fetchedAt: "2026-11-18T10:00:00.000Z", rawSha256: sha, error: null,
      },
    ];
    const res = pack("c1-01", "c1-adlib", { enriched: ds });
    const ad = res.json.observations.ads.find((a: { item_id: string }) => a.item_id === "c1-01");
    expect(ad.payer_displayed).toBe("Testowa Spolka Platnik");
    expect(ad.beneficiary_displayed).toBe("Testowa Spolka Beneficjent");
    expect(ad.ad_ids.ad_library_id).toBe("1000000000000101");
    expect(ad.ad_urls).toContain("https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&id=1000000000000101");
    expect(ad.repository_record).toEqual([
      expect.objectContaining({ id: "1000000000000101", taken_down: true, violations: ["Prohibited Commercial Practices"], eu_reach: 123456, page_id: "5550001", page_name: "Finanse Dziś Demo", fetched_utc: "2026-11-18T10:00:00.000Z", response_sha256: sha }),
    ]);
    const account = res.json.observations.accounts.find((a: { advertiser_displayed: string }) => a.advertiser_displayed === "Finanse Dziś Demo");
    expect(account).toMatchObject({ page_ids: ["5550001"], page_urls: ["https://www.facebook.com/5550001"] });
    expect(res.json.integrity.limitations.join(" ")).not.toMatch(/nie są pobierane/);
    // an ad without a library record still says so
    expect(res.json.observations.ads.find((a: { item_id: string }) => a.item_id === "c1-04").repository_record).toBeNull();
    expect(res.json.integrity.limitations.join(" ")).toMatch(/--ad-library/);
  });

  it("writes a DSA notice per platform; point (b) starts with the ad's place on the platform", () => {
    const ds = structuredClone(run.ds);
    ds.perItem["c1-01"].adLibrary = [
      { id: "1000000000000101", payers: [], beneficiaries: [], takenDown: null, violations: [], euReach: null, ageMin: null, ageMax: null, gender: null, locations: [], pageId: "5550001", pageName: null, pageDeleted: null, pageVerification: null, error: null },
    ];
    const res = pack("c1-01", "c1-dsa-platforms", { enriched: ds });
    const platforms = [...new Set((res.json.observations.ads as Array<{ platform: string }>).map((a) => a.platform))];
    expect(platforms.length).toBeGreaterThanOrEqual(2);
    for (const p of platforms) expect(res.files).toContain(`dsa-art16-${p}.md`);
    const fb = res.read("dsa-art16-facebook.md");
    const b = fb.split("## (b)")[1];
    expect(b.indexOf("id=1000000000000101")).toBeGreaterThan(-1);
    expect(b.indexOf("id=1000000000000101")).toBeLessThan(b.indexOf("Strony docelowe"));
    const ig = res.read("dsa-art16-instagram.md");
    expect(ig).not.toContain("id=1000000000000101");
    expect(fb).toMatch(/Kategoria zgłoszenia: podszywanie się/);
  });

  it("lists all undiscounted shared traces (not only the top six) and the discounted ones apart", () => {
    const { json } = pack("c1-01", "c1-traces");
    const shared = json.observations.shared_identifiers as Array<{ type: string; value: string; ads: string[]; ads_with_identifier: number }>;
    expect(shared.length).toBeGreaterThan(6);
    const utm = shared.find((s) => s.type === "campaign_param" && s.value.startsWith("utm_campaign="));
    expect(utm?.ads_with_identifier).toBe(3);
    expect(utm?.ads).toHaveLength(3);
    const context = json.observations.shared_context_not_linking.traces as Array<{ type: string; label: string; discount_reasons: string[] }>;
    expect(context.some((t) => t.type === "registrar" && /registration burst/.test(t.label))).toBe(true);
    expect(context.some((t) => t.type === "nameserver" && t.discount_reasons.length > 0)).toBe(true);
    expect(shared.some((s) => s.type === "nameserver")).toBe(false);
  });

  it("records the SHA-256 and acquisition time of each input file of the case and copies screenshots and the description", () => {
    const dir = path.join(tmp, "case-files");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "zrzut.png"), "PNG-1");
    writeFileSync(path.join(dir, "opis.info.json"), "{\"id\":1}");
    writeFileSync(path.join(dir, "ruch.har"), "{\"log\":{\"entries\":[]}}");
    const files = hashCaseFiles([
      { role: "more_screenshot", file: path.join(dir, "zrzut.png") },
      { role: "info_json", file: path.join(dir, "opis.info.json") },
      { role: "har", file: path.join(dir, "ruch.har") },
    ]);
    const res = pack("c1-01", "c1-source", { provenance: { generatedAt: "2026-11-18T08:00:00.000Z", cases: [{ id: "c1-01", importedAt: "2026-11-18T08:00:00.000Z", files }] } });
    const ad = res.json.observations.ads.find((a: { item_id: string }) => a.item_id === "c1-01");
    expect(ad.source_files).toHaveLength(3);
    for (const f of files) expect(ad.source_files.find((x: { sha256: string }) => x.sha256 === f.sha256), f.role).toBeTruthy();
    expect(ad.source_files.every((f: { imported_utc: string }) => f.imported_utc === "2026-11-18T08:00:00.000Z")).toBe(true);
    const manifest = res.read("manifest.sha256");
    expect(manifest).toContain(`${files[0].sha256}  files/screenshots/zrzut.png`);
    expect(manifest).toContain(`${files[1].sha256}  files/info/opis.info.json`);
    const har = ad.source_files.find((f: { role: string }) => f.role === "har");
    // the HAR goes in only as a redacted copy; its sha256 stays the original's
    expect(har.in_pack).toBe("files/har/ruch.har");
    expect(har.sha256).toBe(files.find((f) => f.role === "har")!.sha256);
    expect(res.json.integrity.manifest.find((m: { file: string }) => m.file === "files/har/ruch.har").derived_from_sha256).toBe(har.sha256);
  });

  it("takes the financial offer from the narrative of the ads, with a quote marked as a conclusion", () => {
    const c1 = pack("c1-01", "c1-knf");
    expect(c1.json.requested_action.find((a: { recipient: string }) => a.recipient === "K").action).toContain("usługi inwestycyjne");
    const offered = c1.json.observations.domains.map((d: { financial_service_offered: string | null }) => d.financial_service_offered).filter(Boolean);
    expect(offered.length).toBeGreaterThan(0);
    expect(offered[0]).toContain("(wniosek");
    const c5 = pack("c5-01", "c5-knf");
    expect(c5.json.requested_action.find((a: { recipient: string }) => a.recipient === "K").action).toBe("informacja (jeśli oferta dotyczy usług finansowych)");
  });
});

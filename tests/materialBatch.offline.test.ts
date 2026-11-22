/**
 * A batch of new materials against an existing run (synthetic sample, no network): one import and
 * one graph for all cases, duplicates of known and of batch materials, campaigns of new materials
 * only (N1 ...), and materials with nothing to compare them by.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeMaterial, type MaterialProgress, type MaterialResult } from "../lib/pipeline/analyzeMaterial";
import { materialCsv } from "../lib/pipeline/materialCsv";
import { compileWatchlist, loadWatchlist } from "../lib/text/persona";
import { batchSummary } from "../lib/viewer/materialView";
import { runSample, SAMPLE, sampleItems } from "./sampleRun";

const IMAGES = path.join(SAMPLE, "images");
let root: string;
let run: Awaited<ReturnType<typeof runSample>>;
/** Sample record whose creative is c1_A.png (in the run). */
let originalId: string;
let originalCampaign: string;

/** Variants of one creative made the way scripts/gen-sample.ts makes them (sticker without text: no fonts needed). */
async function variants(dir: string) {
  const png = await sharp(readFileSync(path.join(IMAGES, "c1_A.png"))).flatten({ background: "#ffffff" }).png().toBuffer();
  const crop = await sharp(png).extract({ left: 14, top: 10, width: 372, height: 376 }).resize(400, 400, { fit: "fill" }).jpeg({ quality: 82 }).toBuffer();
  const sticker = await sharp({ create: { width: 110, height: 36, channels: 3, background: "#e63946" } }).png().toBuffer();
  const badge = await sharp(png).composite([{ input: sticker, top: 12, left: 278 }]).png().toBuffer();
  writeFileSync(path.join(dir, "c1_A_crop.jpg"), crop);
  writeFileSync(path.join(dir, "c1_A_badge.png"), badge);
}

function caseWith(name: string, files: Record<string, string | Buffer>): string {
  const dir = path.join(root, "sprawy", name);
  mkdirSync(dir, { recursive: true });
  for (const [f, body] of Object.entries(files)) writeFileSync(path.join(dir, f), body);
  return dir;
}

function caseWithImage(name: string, src: string): string {
  const dir = path.join(root, "sprawy", name);
  mkdirSync(dir, { recursive: true });
  copyFileSync(src, path.join(dir, `zrzut${path.extname(src)}`));
  return dir;
}

const page = (url: string, title: string, body: string) =>
  `<!-- saved from url=(${String(url.length).padStart(4, "0")})${url} -->\n<html><head><title>${title}</title></head><body>${body}</body></html>`;

const ctx = (work: string) => ({
  dataDir: path.join(root, "run"),
  workDir: path.join(root, work),
  fixtures: path.join(SAMPLE, "fixtures"),
  config: run.config,
  personas: compileWatchlist(loadWatchlist(path.join(SAMPLE, "personas.json"))),
  media: { ocr: false },
});

beforeAll(async () => {
  const all = sampleItems().items;
  // the run holds c1_A.png but not its re-compressed copy (c1_A_jpeg.jpg)
  const copy = all.find((it) => it.imagePath === "images/c1_A_jpeg.jpg")!;
  originalId = all.find((it) => it.imagePath === "images/c1_A.png")!.id;
  run = await runSample({ only: all.filter((it) => it.id !== copy.id).map((it) => it.id) });
  originalCampaign = run.campaigns.assignments[originalId];
  root = mkdtempSync(path.join(os.tmpdir(), "material-batch-"));
  const data = path.join(root, "run");
  mkdirSync(data);
  writeFileSync(path.join(data, "enriched.json"), JSON.stringify(run.ds));
  writeFileSync(path.join(data, "campaigns.json"), JSON.stringify(run.campaigns));
  writeFileSync(path.join(data, "graph.json"), JSON.stringify(run.graph));
  mkdirSync(path.join(root, "obrazy"));
  await variants(path.join(root, "obrazy"));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("analyzeMaterial: duplicates", () => {
  let res: MaterialResult;
  beforeAll(async () => {
    res = await analyzeMaterial(
      {
        caseDirs: [
          caseWithImage("kopia-jpeg", path.join(IMAGES, "c1_A_jpeg.jpg")),
          caseWithImage("wariant-naklejka", path.join(root, "obrazy", "c1_A_badge.png")),
          caseWithImage("wariant-przyciety", path.join(root, "obrazy", "c1_A_crop.jpg")),
          caseWithImage("wariant-naklejka-kopia", path.join(root, "obrazy", "c1_A_badge.png")),
        ],
      },
      ctx("w-dup"),
    );
  }, 60_000);
  const item = (id: string) => res.items.find((i) => i.id === id)!;

  it("gives every record its case", () => {
    expect(res.items.map((i) => [i.id, i.caseId])).toEqual([
      ["kopia-jpeg", "kopia-jpeg"],
      ["wariant-naklejka", "wariant-naklejka"],
      ["wariant-naklejka-kopia", "wariant-naklejka-kopia"],
      ["wariant-przyciety", "wariant-przyciety"],
    ]);
  });

  it("marks a re-compressed copy of a known creative as its duplicate, in the original's campaign", () => {
    const it = item("kopia-jpeg");
    expect(it.verdict).toBe("duplicate");
    expect(it.duplicateOf?.id).toBe(originalId);
    expect(it.duplicateOf?.reason).toContain("identyczny obraz");
    expect(it.campaign).toBe(originalCampaign);
    expect(it.verdictText).toContain(originalId);
  });

  it("puts variants (sticker, crop) into the original's campaign without calling them copies", () => {
    // a variant without an address has nothing to contradict the creative, which is nearly identical to
    // the creatives of one campaign only: it joins that campaign as a variant (campaignRules.contentVariant)
    for (const id of ["wariant-naklejka", "wariant-przyciety"]) {
      const it = item(id);
      expect(it.verdict, id).toBe("known_campaign");
      expect(it.campaign, id).toBe(originalCampaign);
      expect(it.campaignBasis, id).toBe("content_variant");
      expect(it.duplicateOf, id).toBeUndefined();
    }
  });

  it("finds a copy of another material of the same batch and gives it that material's result", () => {
    const it = item("wariant-naklejka-kopia");
    expect(it.verdict).toBe("duplicate");
    expect(it.duplicateOf?.id).toBe("wariant-naklejka");
    expect(it.campaign).toBe(item("wariant-naklejka").campaign);
  });
});

describe("analyzeMaterial: batch of cases", () => {
  it("compares new materials with each other and names campaigns of new materials only", async () => {
    const res = await analyzeMaterial(
      {
        caseDirs: [
          caseWith("lejek-1", { "Strona.html": page("https://nowy-lejek.example/krok-1", "Krok pierwszy", "<form action='/zapis'><input name='imie'></form><p>Zapisz się na webinar o oszczędzaniu.</p>") }),
          caseWith("lejek-2", { "Strona.html": page("https://nowy-lejek.example/krok-2", "Krok drugi", "<p>Dziękujemy, doradca oddzwoni w ciągu godziny.</p>") }),
          caseWith("inna", { "Strona.html": page("https://zupelnie-inna-oferta.example/lp", "Rowery miejskie", "<p>Promocja na rowery i darmowa dostawa przez cały miesiąc.</p>") }),
        ],
      },
      ctx("w-batch"),
    );
    const by = Object.fromEntries(res.items.map((i) => [i.id, i]));
    expect(by["lejek-1"].verdict).toBe("new_campaign");
    expect(by["lejek-1"].newCampaign).toBe("N1");
    expect(by["lejek-2"].newCampaign).toBe("N1");
    expect(by["lejek-1"].withNew).toEqual(["lejek-2"]);
    expect(by["inna"].newCampaign).toBeNull();
    expect(res.newCampaigns).toHaveLength(1);
    expect(res.newCampaigns![0]).toMatchObject({ id: "N1", members: ["lejek-1", "lejek-2"] });
    expect(res.newCampaigns![0].evidence.length).toBeGreaterThan(0);
    // different pages of one site are not copies of each other
    expect(res.items.some((i) => i.verdict === "duplicate")).toBe(false);
  }, 60_000);

  it("treats the same page saved in two cases as one ad collected twice", async () => {
    // enough tags for a DOM simhash (>= 25)
    const rows = Array.from({ length: 12 }, (_, i) => `<li><span>Pytanie ${i + 1}</span><em>odpowiedź</em></li>`).join("");
    const html = page("https://nowy-lejek.example/oferta?utm_source=fb&fbclid=IwAR0abc", "Oferta", `<div><h1>Oferta</h1><p>Lokata na 9% w skali roku.</p><ul>${rows}</ul></div>`);
    const res = await analyzeMaterial({ caseDirs: [caseWith("zapis-a", { "Strona.html": html }), caseWith("zapis-b", { "Strona.html": html })] }, ctx("w-same-page"));
    const b = res.items.find((i) => i.id === "zapis-b")!;
    expect(b.verdict).toBe("duplicate");
    expect(b.duplicateOf).toEqual({ id: "zapis-a", reason: "ten sam adres strony z identyczną strukturą (simhash DOM) i identyczna treść strony (SHA-256)" });
    expect(b.newCampaign).toBe("N1");
  }, 60_000);

  it("treats an identical page body in another folder as a copy, also without a DOM simhash", async () => {
    // too few tags for a DOM simhash: only the SHA-256 of the body ties the two
    const html = page("https://maly-lejek.example/lp", "Oferta", "<p>Lokata na 9% w skali roku, zapisz się dziś.</p>");
    const res = await analyzeMaterial({ caseDirs: [caseWith("tresc-a", { "page.html": html }), caseWith(path.join("inny-katalog", "tresc-b"), { "page.html": html })] }, ctx("w-same-body"));
    const b = res.items.find((i) => i.id === "tresc-b")!;
    expect(b.verdict).toBe("duplicate");
    expect(b.duplicateOf?.id).toBe("tresc-a");
    expect(b.duplicateOf?.reason).toContain("identyczna treść strony (SHA-256)");
  }, 60_000);

  it("takes the same report submitted 47 times as one material and 46 duplicates, and the funnel adds up", async () => {
    const html = page("https://zgloszenie.example/lp", "Zgłoszenie", "<p>Inwestuj z Janem Przykładowym, zysk 30% miesięcznie.</p>");
    const dirs = Array.from({ length: 47 }, (_, i) => caseWith(`kopia-${String(i + 1).padStart(2, "0")}`, { "page.html": html }));
    const res = await analyzeMaterial({ caseDirs: dirs }, ctx("w-47"));
    const s = batchSummary(res, 47);
    expect(s.materials).toBe(47);
    expect(s.duplicates).toBe(46);
    expect(s.duplicates + s.known + s.fresh + s.insufficient).toBe(47);
    expect(new Set(res.items.filter((i) => i.verdict === "duplicate").map((i) => i.duplicateOf?.id))).toEqual(new Set(["kopia-01"]));
  }, 120_000);

  it("takes a case whose files are all in an earlier case, even when that one has more files", async () => {
    const html = page("https://podzbior.example/lp", "Oferta", "<p>Kurs walut bez prowizji przez cały rok.</p>");
    const shot = readFileSync(path.join(IMAGES, "c2_E.png"));
    const res = await analyzeMaterial(
      { caseDirs: [caseWith("pelna", { "page.html": html, "zrzut.png": shot, "notatka.txt": "zgłoszenie od Jana" }), caseWith("podzbior", { "page.html": html, "notatka.txt": "inna notatka" })] },
      ctx("w-subset"),
    );
    const b = res.items.find((i) => i.caseId === "podzbior")!;
    expect(b.verdict).toBe("duplicate");
    expect(b.duplicateOf?.id).toBe(res.items.find((i) => i.caseId === "pelna")!.id);
  }, 60_000);

  it("takes the same video file in two cases as one ad collected twice", async () => {
    // the bytes are never decoded (no ASR, CLIP or audio here): only their SHA-256 counts
    const mp4 = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37) % 256));
    const res = await analyzeMaterial({ caseDirs: [caseWith("wideo-a", { "reklama.mp4": mp4 }), caseWith("wideo-b", { "nagranie.mp4": mp4 })] }, ctx("w-video"));
    const b = res.items.find((i) => i.id === "wideo-b")!;
    expect(b.verdict).toBe("duplicate");
    expect(b.duplicateOf?.id).toBe("wideo-a");
    expect(b.duplicateOf?.reason).toContain("ten sam plik wideo (SHA-256)");
  }, 60_000);
});

describe("analyzeMaterial: case the importer cannot read", () => {
  it("keeps a case of only unreadable files in the batch result: skipped with a reason and an insufficient CSV row", async () => {
    const res = await analyzeMaterial(
      {
        caseDirs: [
          caseWith("czytelna", { "Strona.html": page("https://czytelna-oferta.example/lp", "Oferta", "<p>Zapisz się na webinar o oszczędzaniu w kryzysie.</p>") }),
          caseWith("tylko-notatka", { "notatka.docx": "nie jest to strona, zrzut ani wideo" }),
        ],
      },
      ctx("w-unreadable"),
    );
    expect(res.items.map((i) => i.id)).toEqual(["czytelna"]);
    expect(res.skipped).toEqual([{ id: "tylko-notatka", reason: expect.stringContaining("brak strony, zrzutu ani wideo") }]);
    const rows = materialCsv(res).trim().split("\n");
    expect(rows).toHaveLength(3);
    expect(rows[2].startsWith("tylko-notatka,tylko-notatka,insufficient,,,,,uncertain,,,")).toBe(true);
    expect(rows[2]).toContain("brak strony, zrzutu ani wideo"); // the reason sits quoted in missing_data
  }, 60_000);
});

describe("analyzeMaterial: not enough to compare", () => {
  it("asks for a link or an address-bar screenshot when a material holds only interface labels", async () => {
    const res = await analyzeMaterial({ text: "Sponsorowane · Lubię to! · Komentarz · Udostępnij" }, ctx("w-empty"));
    const [it] = res.items;
    expect(it.verdict).toBe("insufficient");
    expect(it.campaign).toBeNull();
    expect(it.missing).toEqual(expect.arrayContaining(["link do reklamy albo strony docelowej", "zrzut z widocznym paskiem adresu"]));
    expect(it.verdictText).toContain("Za mało danych");
  });

  it("asks a lead-form ad without a landing page for the ad-library ID", async () => {
    const res = await analyzeMaterial({ text: "Sponsorowane · Wyślij formularz" }, ctx("w-lead-form"));
    const [it] = res.items;
    expect(it.verdict).toBe("insufficient");
    expect(it.features.leadAd).toBe(true);
    expect(it.missing?.join("; ")).toContain("identyfikator biblioteki reklam");
  });

  it("lets a link over the threshold decide even for a material without an address", async () => {
    // a known creative alone: no address and no text, but the picture ties it to a known campaign
    // (as a variant: the creative is nearly identical to the creatives of one campaign only)
    const res = await analyzeMaterial({ caseDir: caseWithImage("sam-obraz", path.join(root, "obrazy", "c1_A_crop.jpg")) }, ctx("w-image-only"));
    expect(res.items[0].verdict).toBe("known_campaign");
    expect(res.items[0].missing).toBeUndefined();
  });
});

describe("analyzeMaterial: page techniques", () => {
  const comment = (author: string, text: string) =>
    `<div class="comment"><span class="comment-author">${author}</span><p class="comment-text">${text}</p><span>Lubię to · Odpowiedz · 3 godz. temu</span></div>`;
  const block = [comment("Jan Przykładowy", "Działa!"), comment("Anna Testowa", "Wypłata po 3 dniach."), comment("Piotr Fikcyjny", "Gdzie się zapisać?")].join("");
  const trap = `<script>for (var i = 0; i < 10; i++) history.pushState(null, "", location.href); window.onpopstate = function () { location.reload(); };</script>`;

  it("reports the comment block, its repeats in other materials and the techniques", async () => {
    const res = await analyzeMaterial(
      {
        caseDirs: [
          caseWith("komentarze-1", { "Strona.html": page("https://pierwsza-gazeta.example/artykul", "Wywiad", `<article><p>Wywiad o inwestycji.</p></article>${block}${trap}`) }),
          caseWith("komentarze-2", { "Strona.html": page("https://druga-gazeta.test/news", "Rozmowa", `<article><p>Inna rozmowa.</p></article>${block}`) }),
        ],
      },
      ctx("w-techniques"),
    );
    const [a, b] = res.items;
    expect(a.fakeComments).toEqual({ count: 3, repeatedInOtherItems: 1 });
    expect(b.fakeComments).toEqual({ count: 3, repeatedInOtherItems: 1 });
    expect(a.techniques).toEqual(["back_trap", "fake_comments"]);
    expect(b.techniques).toEqual(["fake_comments"]);
    expect(a.features.techniques).toEqual(["back_trap", "fake_comments"]);
  }, 60_000);
});

describe("analyzeMaterial: dataset file", () => {
  it("turns every row into a material through the ingest mapping, with paths relative to the file", async () => {
    const dir = path.join(root, "zbior");
    mkdirSync(path.join(dir, "obrazy"), { recursive: true });
    copyFileSync(path.join(IMAGES, "c1_A_jpeg.jpg"), path.join(dir, "obrazy", "kopia.jpg"));
    writeFileSync(
      path.join(dir, "materialy.csv"),
      [
        "ad_id,tresc,link,zrzut,case",
        "w1,,,obrazy/kopia.jpg,zgloszenie-1",
        "w2,Sponsorowane · Lubię to! · Komentarz · Udostępnij,,,zgloszenie-2",
        "w3,,,,",
      ].join("\n"),
    );
    const res = await analyzeMaterial({ datasetFile: path.join(dir, "materialy.csv") }, ctx("w-dataset"));
    const by = Object.fromEntries(res.items.map((i) => [i.id, i]));
    expect(by.w1.caseId).toBe("zgloszenie-1");
    expect(by.w1.verdict).toBe("duplicate");
    expect(by.w1.duplicateOf?.id).toBe(originalId);
    expect(by.w2.caseId).toBe("zgloszenie-2");
    expect(by.w2.verdict).toBe("insufficient");
    expect(by.w3.caseId).toBe("w3");
  }, 60_000);
});

describe("analyzeMaterial: progress", () => {
  it("reports every step of every case, with the reason of a skipped step", async () => {
    const events: MaterialProgress[] = [];
    await analyzeMaterial(
      {
        caseDirs: [
          caseWithImage("postep-obraz", path.join(IMAGES, "c2_E.png")),
          caseWith("postep-strona", { "Strona.html": page("https://postep.example/lp", "Oferta", "<p>Oferta testowa na rower.</p>") }),
          caseWith("postep-pusta", { "notatka.txt": "tylko notatka" }),
        ],
      },
      { ...ctx("w-progress"), media: { ocr: false }, onProgress: (e) => events.push(e) },
    );
    const of = (c: string, step: string) => events.filter((e) => e.caseId === c && e.step === step).map((e) => e.status + (e.detail ? `: ${e.detail}` : ""));
    expect(of("postep-obraz", "import")).toEqual(["start", "done: 1 rekord(y)"]);
    expect(of("postep-pusta", "import")[1]).toMatch(/^skipped: /);
    expect(of("postep-obraz", "ocr")).toEqual(["skipped: OCR wyłączony"]);
    expect(of("postep-strona", "asr")).toEqual(["skipped: transkrypcja wyłączona"]);
    expect(of("postep-strona", "lookups")).toEqual(["skipped: tryb offline: bez zapytań sieciowych, tylko strony z materiału"]);
    for (const step of ["features", "compare"]) expect(of("postep-strona", step)).toEqual(["start", "done"]);
    expect(of("postep-strona", "group")[0]).toBe("start");
    expect(of("postep-strona", "group")[1]).toMatch(/^done: /);
    // no events for a case without records after the import
    expect(of("postep-pusta", "features")).toEqual([]);
  }, 60_000);

  it("names the missing medium when a step does not apply", async () => {
    const events: MaterialProgress[] = [];
    await analyzeMaterial({ text: "Jan Przykładowy poleca lokatę 9% rocznie w Banku Testowym, zapisz się dziś." }, { ...ctx("w-progress-2"), media: { ocr: true, asr: true }, onProgress: (e) => events.push(e) });
    const st = (step: string) => events.filter((e) => e.step === step).map((e) => `${e.status}${e.detail ? `: ${e.detail}` : ""}`);
    expect(st("ocr")).toEqual(["skipped: brak obrazu"]);
    expect(st("asr")).toEqual(["skipped: brak wideo"]);
    expect(events.every((e) => e.caseId === "nowa-reklama")).toBe(true);
  }, 60_000);
});

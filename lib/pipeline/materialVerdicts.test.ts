import { describe, expect, it } from "vitest";
import { contentWords } from "../text/uiChrome";
import { caseFileDuplicates, DuplicateFinder, duplicateTraits, isInsufficient, isLeadAd, missingData, type DuplicateMedia, type Sufficiency } from "./materialVerdicts";

const H = "8084ac1a1e0ca1a4";
const t = (id: string, data: Record<string, unknown>, url: string | null = null, media: DuplicateMedia = {}) => duplicateTraits(id, data, url, null, media);
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
/** Unit vector at an angle (radians) from the first axis: the cosine of two of them is cos(difference). */
const vec = (angle: number) => [Math.cos(angle), Math.sin(angle), 0];
/** Synthetic audio fingerprint of n values (deterministic, no structure). */
const fp = (n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => {
    let x = Math.imul(i + 1 + seed * 100003, 2654435761);
    x ^= x >>> 15;
    x = Math.imul(x, 2246822519);
    return (x ^ (x >>> 13)) >>> 0;
  });

describe("DuplicateFinder (no picture files: only an identical dHash counts)", () => {
  const f = new DuplicateFinder();

  it("takes an identical picture, and adds the page address when it matches too", async () => {
    const m = await f.compare(t("a", { dhash: H }, "https://oferta.example/lp?utm_source=x"), t("b", { dhash: H }, "https://oferta.example/lp"));
    expect(m?.reasons).toEqual(["identyczny obraz", "ten sam adres strony"]);
  });

  it("does not take a near picture without the pixel check, nor an ad-library view or a blank picture", async () => {
    expect(await f.compare(t("a", { dhash: H }), t("b", { dhash: "8084ac1a1e0ca1a5" }))).toBeNull();
    expect(await f.compare(t("a", { dhash: H, uiView: "ad_library" }), t("b", { dhash: H }))).toBeNull();
    expect(await f.compare(t("a", { dhash: "0000000000000000" }), t("b", { dhash: "0000000000000000" }))).toBeNull();
  });

  it("rules out a picture shared by two different pages or two different ads", async () => {
    expect(await f.compare(t("a", { dhash: H }, "https://oferta.example/a"), t("b", { dhash: H }, "https://oferta.example/b"))).toBeNull();
    expect(await f.compare(t("a", { dhash: H, metaAdId: "120200000000000001" }), t("b", { dhash: H, metaAdId: "120200000000000002" }))).toBeNull();
  });

  it("takes the same ad ID, and the same page only with an identical DOM simhash", async () => {
    expect((await f.compare(t("a", { metaAdId: "120200000000000001" }), t("b", { metaAdId: "120200000000000001" })))?.reasons).toEqual(["ta sama reklama w Mecie (identyfikator z fbclid)"]);
    expect((await f.compare(t("a", { adLibraryIds: ["1234567890123"] }), t("b", { adLibraryIds: ["1234567890123"] })))?.reasons).toEqual(["ten sam identyfikator w bibliotece reklam"]);
    const page = "https://oferta.example/lp";
    expect(await f.compare(t("a", { domSimhash: "ffff000000000000" }, page), t("b", { domSimhash: "ffff000000000001" }, page))).toBeNull();
    expect((await f.compare(t("a", { domSimhash: "ffff000000000000" }, page), t("b", { domSimhash: "ffff000000000000" }, page)))?.reasons).toEqual([
      "ten sam adres strony z identyczną strukturą (simhash DOM)",
    ]);
  });

  it("does not take one page with two different pictures (two ads of one campaign)", async () => {
    const page = "https://oferta.example/lp";
    const dom = { domSimhash: "ffff000000000000" };
    expect(await f.compare(t("a", { ...dom, dhash: H }, page), t("b", { ...dom, dhash: "7f7b53e5e1f35e5b" }, page))).toBeNull();
    // a picture on one side only says nothing against it
    expect((await f.compare(t("a", { ...dom, dhash: H }, page), t("b", dom, page)))?.reasons).toEqual(["ten sam adres strony z identyczną strukturą (simhash DOM)"]);
  });

  it("points a copy of a copy at the first original and prefers records of the run", async () => {
    const run = [t("stara", { dhash: H })];
    const batch = [t("n1", { dhash: H }), t("n2", { dhash: H })];
    const out = await f.find(batch, run);
    expect(out.get("n1")?.id).toBe("stara");
    expect(out.get("n2")?.id).toBe("stara");
    const onlyBatch = await f.find(batch, []);
    expect(onlyBatch.get("n1")).toBeUndefined();
    expect(onlyBatch.get("n2")?.id).toBe("n1");
  });
});

describe("DuplicateFinder: identical page content", () => {
  const f = new DuplicateFinder();

  it("takes the same page body (SHA-256) even without a DOM simhash", async () => {
    const m = await f.compare(t("a", {}, "https://oferta.example/lp", { pageSha256: SHA_A }), t("b", {}, "https://oferta.example/lp", { pageSha256: SHA_A }));
    expect(m?.reasons).toEqual(["identyczna treść strony (SHA-256)", "ten sam adres strony"]);
    expect(f.candidate(t("a", {}, null, { pageSha256: SHA_A }), t("b", {}, null, { pageSha256: SHA_A }))).toBe(true);
  });

  it("does not take a different body, the same body under two different pages, or two different pictures", async () => {
    expect(await f.compare(t("a", {}, null, { pageSha256: SHA_A }), t("b", {}, null, { pageSha256: SHA_B }))).toBeNull();
    expect(await f.compare(t("a", {}, "https://oferta.example/a", { pageSha256: SHA_A }), t("b", {}, "https://inna.test/b", { pageSha256: SHA_A }))).toBeNull();
    expect(await f.compare(t("a", { dhash: H }, null, { pageSha256: SHA_A }), t("b", { dhash: "7f7b53e5e1f35e5b" }, null, { pageSha256: SHA_A }))).toBeNull();
  });
});

describe("DuplicateFinder: video", () => {
  const f = new DuplicateFinder();
  const audio = fp(240, 1);

  it("takes the same video file (SHA-256)", async () => {
    const m = await f.compare(t("a", {}, null, { videoSha256: SHA_A }), t("b", {}, null, { videoSha256: SHA_A }));
    expect(m?.reasons).toEqual(["ten sam plik wideo (SHA-256)"]);
    expect(await f.compare(t("a", {}, null, { videoSha256: SHA_A }), t("b", {}, null, { videoSha256: SHA_B }))).toBeNull();
  });

  it("takes video frames with CLIP >= 0.97 together with the same audio fingerprint", async () => {
    const a = t("a", {}, null, { videoSha256: SHA_A, videoEmbedding: vec(0), audioFingerprint: audio, audioDuration: 30 });
    const b = t("b", {}, null, { videoSha256: SHA_B, videoEmbedding: vec(0.1), audioFingerprint: [...audio], audioDuration: 30.2 });
    expect(f.candidate(a, b)).toBe(true);
    expect((await f.compare(a, b))?.reasons).toEqual(["to samo wideo (klatki CLIP 0,995, ten sam odcisk audio)"]);
  });

  it("does not take the same video with another intro (a variant), nor near frames without the audio", async () => {
    // a new 3-second intro: other sound at the start and a longer recording, frames still close
    const intro = [...fp(24, 7), ...audio];
    const a = t("a", {}, null, { videoSha256: SHA_A, videoEmbedding: vec(0), audioFingerprint: audio, audioDuration: 30 });
    const b = t("b", {}, null, { videoSha256: SHA_B, videoEmbedding: vec(0.15), audioFingerprint: intro, audioDuration: 33 });
    expect(await f.compare(a, b)).toBeNull();
    // the same length, the intro over the first seconds
    const over = [...fp(24, 7), ...audio.slice(24)];
    expect(await f.compare(a, t("c", {}, null, { videoSha256: SHA_B, videoEmbedding: vec(0.15), audioFingerprint: over, audioDuration: 30 }))).toBeNull();
    expect(await f.compare(a, t("d", {}, null, { videoSha256: SHA_B, videoEmbedding: vec(0.05) }))).toBeNull();
    // frames below the threshold, the same sound
    expect(await f.compare(a, t("e", {}, null, { videoSha256: SHA_B, videoEmbedding: vec(0.3), audioFingerprint: audio, audioDuration: 30 }))).toBeNull();
  });
});

describe("caseFileDuplicates", () => {
  const files = (...shas: string[]) => shas.map((sha256, i) => ({ name: `plik-${i}`, sha256 }));

  it("takes a later case whose files are all in an earlier case, even when that one has more", () => {
    const out = caseFileDuplicates([
      { caseId: "a", files: files("1", "2", "3") },
      { caseId: "b", files: files("2", "3") },
      { caseId: "c", files: files("1", "2", "3") },
      { caseId: "d", files: files("3", "4") },
      { caseId: "e", files: [] },
    ]);
    expect(out.get("b")).toEqual({ caseId: "a", files: 2 });
    expect(out.get("c")).toEqual({ caseId: "a", files: 3 });
    expect(out.has("d")).toBe(false);
    expect(out.has("e")).toBe(false);
    expect(out.has("a")).toBe(false);
  });

  it("never points an earlier case at a later one", () => {
    const out = caseFileDuplicates([
      { caseId: "a", files: files("1") },
      { caseId: "b", files: files("1", "2") },
    ]);
    expect(out.size).toBe(0);
  });
});

describe("contentWords", () => {
  it("drops the labels and buttons of a post", () => {
    expect(contentWords("Sponsorowane · Lubię to! · Komentarz · Udostępnij")).toEqual([]);
    expect(contentWords("Sponsored · Like · Comment · Share · Learn more")).toEqual([]);
    expect(contentWords("Sponsorowane\nJan Przykładowy poleca nową lokatę 9% rocznie. Dowiedz się więcej")).toEqual(["Jan", "Przykładowy", "poleca", "nową", "lokatę", "rocznie"]);
  });
});

describe("isLeadAd", () => {
  it("recognises a lead form of the platform in the ad text or OCR", () => {
    expect(isLeadAd("Sponsorowane · Wyślij formularz")).toBe(true);
    expect(isLeadAd("Lead form · Get quote")).toBe(true);
    expect(isLeadAd("Instant Form: podaj numer telefonu")).toBe(true);
    expect(isLeadAd("Wypełnij formularz, oddzwonimy")).toBe(true);
    expect(isLeadAd("Wyślij")).toBe(true);
  });
  it("does not take a Messenger button or an ordinary post", () => {
    expect(isLeadAd("Sponsorowane · Wyślij wiadomość")).toBe(false);
    expect(isLeadAd("Send message")).toBe(false);
    expect(isLeadAd("Jan Przykładowy poleca lokatę")).toBe(false);
    expect(isLeadAd(null)).toBe(false);
  });
});

describe("insufficient", () => {
  const empty: Sufficiency = { hasAddress: false, hasIdentifier: false, contentWords: 0, hasImage: false, hasVideo: false, hasPage: false, linked: false };
  it("needs no address, no identifier, under 5 words and no link over the threshold", () => {
    expect(isInsufficient(empty)).toBe(true);
    expect(isInsufficient({ ...empty, contentWords: 4, hasImage: true })).toBe(true);
    expect(isInsufficient({ ...empty, contentWords: 5 })).toBe(false);
    expect(isInsufficient({ ...empty, hasAddress: true })).toBe(false);
    expect(isInsufficient({ ...empty, hasIdentifier: true })).toBe(false);
    expect(isInsufficient({ ...empty, linked: true })).toBe(false);
  });
  it("takes a bare address as too little when the archive step found no copy of the dead page", () => {
    const dead: Sufficiency = { ...empty, hasAddress: true, archiveNone: true };
    expect(isInsufficient(dead)).toBe(true);
    expect(isInsufficient({ ...dead, archiveNone: false })).toBe(false);
    expect(isInsufficient({ ...dead, hasPage: true })).toBe(false);
    expect(isInsufficient({ ...dead, contentWords: 5 })).toBe(false);
    expect(isInsufficient({ ...dead, hasIdentifier: true })).toBe(false);
    expect(missingData(dead)).toContain("zapisana strona (plik HTML albo HAR): adres nie odpowiada na żywo i nie ma kopii w archiwach");
  });
  it("says what to add", () => {
    expect(missingData(empty)).toEqual([
      "link do reklamy albo strony docelowej",
      "zrzut z widocznym paskiem adresu",
      "plik HAR z wizyty na stronie",
      "zrzut ekranu reklamy",
      "pełna treść reklamy (tekst posta albo czytelny zrzut)",
    ]);
    expect(missingData({ ...empty, hasAddress: true, hasPage: true, hasImage: true, contentWords: 9 })).toEqual([]);
  });
  it("asks for the HAR when the page was saved without one, but not when it is not known whether one came", () => {
    const withPage: Sufficiency = { ...empty, hasAddress: true, hasPage: true, hasImage: true, contentWords: 9 };
    expect(missingData({ ...withPage, hasHar: false })).toEqual(["plik HAR z wizyty na stronie"]);
    expect(missingData({ ...withPage, hasHar: true })).toEqual([]);
    expect(missingData(withPage)).toEqual([]);
    // without the page the HAR is asked for once, whatever is known about the case files
    expect(missingData({ ...withPage, hasPage: false, hasHar: false }).filter((m) => m.includes("HAR"))).toEqual(["plik HAR z wizyty na stronie"]);
  });
  it("asks a platform lead form without a landing page for the ad-library ID or a screenshot of the form", () => {
    const m = missingData({ ...empty, hasImage: true, leadAd: true });
    expect(m[0]).toBe("identyfikator biblioteki reklam (ID z Biblioteki Reklam) albo link do strony reklamodawcy");
    expect(m).toContain("zrzut formularza reklamy");
    expect(m).not.toContain("plik HAR z wizyty na stronie");
    // with an address the form is not the problem
    expect(missingData({ ...empty, hasAddress: true, hasPage: true, hasImage: true, contentWords: 9, leadAd: true })).toEqual([]);
  });

});

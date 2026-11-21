import { describe, expect, it } from "vitest";
import { contentWords } from "../text/uiChrome";
import { DuplicateFinder, duplicateTraits, isInsufficient, missingData, type Sufficiency } from "./materialVerdicts";

const H = "8084ac1a1e0ca1a4";
const t = (id: string, data: Record<string, unknown>, url: string | null = null) => duplicateTraits(id, data, url, null);

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

describe("contentWords", () => {
  it("drops the labels and buttons of a post", () => {
    expect(contentWords("Sponsorowane · Lubię to! · Komentarz · Udostępnij")).toEqual([]);
    expect(contentWords("Sponsored · Like · Comment · Share · Learn more")).toEqual([]);
    expect(contentWords("Sponsorowane\nJan Przykładowy poleca nową lokatę 9% rocznie. Dowiedz się więcej")).toEqual(["Jan", "Przykładowy", "poleca", "nową", "lokatę", "rocznie"]);
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
});

import { describe, expect, it } from "vitest";
import { detectLang, foreignPersona, foreignSegments, residueOf } from "./residue";

const IT = "Questo servizio non è garantito e tutti i risultati sono solo un esempio per gli utenti della pagina.";
const PL = "To jest przykładowa strona, na której opisujemy usługę dla klientów oraz warunki, które są ważne od dziś.";

describe("residueOf", () => {
  it("keeps a commented-out paragraph and drops a licence and code", () => {
    const old = "stary akapit artykułu o tym jak zwykły człowiek zarobił pieniądze na przykładowej platformie testowej";
    const r = residueOf([old, "licensed under the mit license see the file for the full text of the licence terms", "if (a == b) { run(); } else { stop(); } var x = 1; // nine words of code here"]);
    expect(r?.count).toBe(1);
    expect(r?.sample).toContain("stary akapit");
    expect(residueOf(["krótki komentarz do kodu"])).toBeNull();
  });
});

describe("foreignSegments", () => {
  it("finds an Italian paragraph in a Polish page and ignores a country list", () => {
    const seg = foreignSegments({ page: `${PL}\n${PL}\n${IT}\nPolska, Niemcy, Włochy, Francja, Hiszpania, Czechy` });
    expect(seg.map((s) => [s.lang, s.where])).toEqual([["it", "page"]]);
    expect(seg[0].sample).toContain("Questo");
  });
  it("tells scripts apart and reports the place", () => {
    const seg = foreignSegments({ page: `${PL}\n${PL}`, comments: ["пока что тест не работает и мы это скоро исправим"], scripts: ["Дякуємо, ваша заявка прийнята і ми зателефонуємо"] });
    expect(seg.map((s) => `${s.lang}:${s.where}`).sort()).toEqual(["ru:comment", "uk:script"]);
    expect(detectLang("ঠিক আছে আমরা শীঘ্রই যোগাযোগ করব")).toBe("bn");
  });
  it("gives nothing for a single-language page", () => {
    expect(foreignSegments({ page: `${PL}\n${PL}` })).toEqual([]);
  });
});

describe("foreignPersona", () => {
  it("finds a Czech title in a Polish ad name", () => {
    expect(foreignPersona([["ad_name", "X/PL/MUDr. Jan Testovač"]])).toEqual([{ title: "MUDr.", lang: "cs", param: "ad_name" }]);
    expect(foreignPersona([["adset_name", "X/PL/Jan Řezník"]])[0]).toMatchObject({ lang: "cs" });
  });
  it("ignores a plain Polish ad name and other markets", () => {
    expect(foreignPersona([["ad_name", "X/PL/Jan Kowalski wywiad"]])).toEqual([]);
    expect(foreignPersona([["ad_name", "X/CZ/MUDr. Jan Testovač"]])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { extractPageKit } from "./pagekit";
import { isMaskedScript, kitStringsOf, localizedUiLanguages, normalizeKitString } from "./kitStrings";

// Developer messages of a page kit (I25) on synthetic scripts: invented messages, reserved domains only.

const kitJs = `
  function trap() {
    console.log("Moduł testowy: start!");
    console.warn("Pułapka wstecz zostala uzbrojona...");
    if (!ok) console.error("Nie udalo sie wyslac formularza fikcyjnego:");
    var sel = ".btn-primary > span";
    var url = "https://api.przyklad.example/v1/lead";
    var cls = "col-md-6 col-sm-12";
  }`;

describe("developer messages of a kit script (kit_string)", () => {
  it("keeps console messages, drops selectors, URLs and class lists", () => {
    const keys = kitStringsOf([kitJs]).map((s) => s.key);
    expect(keys).toEqual(["moduł testowy: start!", "pułapka wstecz zostala uzbrojona...", "nie udalo sie wyslac formularza fikcyjnego:"]);
  });

  it("normalises case, spaces and digits", () => {
    expect(normalizeKitString("  Krok 12   z 30  GOTOWE! ")).toBe("krok # z # gotowe!");
  });

  it("a string without a developer marker (UI text with no punctuation, not in a log call) is no kit string", () => {
    expect(kitStringsOf([`var label = "Wpisz swoje imie tutaj";`])).toEqual([]);
  });

  it("keeps the oddity flag of a word mixing alphabets", () => {
    const s = kitStringsOf([`console.log("Модуль zaladowany poprawnie teraz!");`, `console.log("Mоduł zaladowany poprawnie teraz!");`]);
    expect(s.find((x) => x.key.startsWith("mоduł"))?.oddity).toBe("mixed_script");
  });
});

describe("text mask of the page platform (textBoilerplate)", () => {
  it("SDK and framework bundle paths and known libraries are masked", () => {
    expect(isMaskedScript("https://cdn.platforma.example/aio-static/sdk/main.js")).toBe(true);
    expect(isMaskedScript("https://alpha.example/_next/static/chunks/framework-0a1b2c3d4e5f.js")).toBe(true);
    expect(isMaskedScript("https://alpha.example/js/jquery-3.7.1.min.js")).toBe(true);
    expect(isMaskedScript("https://alpha.example/strona_files/swiper-bundle.min.js.pobrane")).toBe(true);
    expect(isMaskedScript("https://alpha.example/js/trap.js")).toBe(false);
  });

  it("a dictionary of one message in six languages is interface localisation", () => {
    const dict = `var i18n = { "en": { close: "Close the window now!" }, "pl": { close: "Zamknij okno teraz!" }, "de": { close: "Fenster jetzt schliessen!" },
      "fr": { close: "Fermer la fenetre maintenant!" }, "it": { close: "Chiudi la finestra ora!" }, "es": { close: "Cierra la ventana ahora!" } };`;
    expect(localizedUiLanguages(dict)).toEqual(["de", "en", "es", "fr", "it", "pl"]);
    const kit = extractPageKit(`<html><body><p>x</p><script>${dict}</script></body></html>`, "https://alpha.example/");
    expect(kit.localizedUi).toEqual(["de", "en", "es", "fr", "it", "pl"]);
    expect(kit.kitStrings ?? []).toEqual([]);
  });

  it("two language keys are no dictionary", () => {
    expect(localizedUiLanguages(`var t = { en: "Close!", pl: "Zamknij!" };`)).toEqual([]);
  });
});

describe("external own scripts in the page kit", () => {
  const html = `<html><head><script src="/js/trap.js"></script><script src="/aio-static/sdk/sdk.js"></script></head><body><p>x</p></body></html>`;
  it("an own external script is read like an inline one; an SDK script is masked", () => {
    const kit = extractPageKit(html, "https://alpha.example/", {
      scripts: [
        { url: "https://alpha.example/js/trap.js", body: kitJs },
        { url: "https://alpha.example/aio-static/sdk/sdk.js", body: `console.log("Komunikat platformy dla wszystkich kont!");` },
      ],
    });
    const keys = (kit.kitStrings ?? []).map((s) => s.key);
    expect(keys).toContain("moduł testowy: start!");
    expect(keys.some((k) => k.includes("platformy"))).toBe(false);
    const inline = extractPageKit(`<html><body><script>${kitJs}</script></body></html>`, "https://alpha.example/");
    expect((inline.kitStrings ?? []).map((s) => s.key)).toEqual(keys);
  });
});

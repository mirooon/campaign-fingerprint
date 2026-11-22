import { describe, expect, it } from "vitest";
import { normalizePhrase, templatePhrases } from "./templatePhrases";

// Synthetic page text: fictional brand and people.
describe("sentences of a page template (template_phrase)", () => {
  it("keeps sentences of at least 6 words, normalised, digits as #", () => {
    const got = templatePhrases("Zarabiaj z nami. Ponad 1200 osób zarobiło już pierwsze pieniądze w tym miesiącu! Krótko.", []);
    expect(got.map((p) => p.key)).toEqual(["ponad # osób zarobiło już pierwsze pieniądze w tym miesiącu"]);
    expect(got[0].source).toBe("text");
  });

  it("reads the thank-you message from the scripts (success handler, innerHTML, alert)", () => {
    const script = `form.onsubmit = function () {
      fetch("/api/lead").then(function () {
        box.innerHTML = "<p>Dziękujemy! Nasz opiekun klienta zadzwoni do Ciebie w ciągu 24 godzin.</p>";
      });
      var cfg = { color: "red", label: "To jest zwykły napis bez znaczenia dla formularza" };
    };`;
    const got = templatePhrases("", [script]);
    expect(got.map((p) => p.key)).toEqual(["nasz opiekun klienta zadzwoni do ciebie w ciągu # godzin"]);
    expect(got[0].source).toBe("script");
  });

  it("drops consent, cookie and legal boilerplate", () => {
    const text = "Wyrażam zgodę na przetwarzanie moich danych osobowych przez administratora danych. Ta strona używa plików cookies w celu poprawy działania serwisu.";
    expect(templatePhrases(text, [])).toEqual([]);
  });

  it("marks a doubled run of three words and a word mixing Latin and Cyrillic as an oddity", () => {
    const doubled = templatePhrases("Nasz menedżer zadzwoni do ciebie i zapozna cię z zapozna cię z naszą platformą.", []);
    expect(doubled[0].oddity).toBe("repeat");
    const mixed = templatePhrases("Nasza platfоrma pomaga zarabiać każdego dnia bez wysiłku.", []); // Cyrillic "о" in the second word
    expect(mixed[0].oddity).toBe("mixed_script");
    const plain = templatePhrases("Nasz menedżer zadzwoni do ciebie i przedstawi naszą platformę.", []);
    expect(plain[0].oddity).toBeUndefined();
  });

  it("normalisation ignores case, punctuation and the exact numbers", () => {
    expect(normalizePhrase("Zarobiłem 3 000 zł, w 2 dni!")).toBe(normalizePhrase("zarobiłem 5000 zł w 7 dni"));
  });
});

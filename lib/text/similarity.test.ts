import { describe, expect, it } from "vitest";
import { foldDiacritics, normalizeForMatching } from "./normalize";
import { charNgrams, cosineDense, cosineSparse, fitTfidf, tfidfVectors } from "./similarity";

describe("normalizeForMatching", () => {
  it("folds diacritics, homoglyphs and leetspeak but keeps numbers", () => {
    expect(foldDiacritics("Zażółć gęślą jaźń")).toBe("Zazolc gesla jazn");
    // Cyrillic "а" and "о" disguised as Latin letters:
    expect(normalizeForMatching("Zаrаbiаj z bоtem")).toBe("zarabiaj z botem");
    expect(normalizeForMatching("Z4R4BI4J 5000 zł dziennie!")).toBe("zarabiaj 5000 zl dziennie");
    expect(normalizeForMatching("Odbierz 100zl w 24h")).toBe("odbierz 100zl w 24h");
  });

  it("drops URLs and e-mails (they are pivots, not text)", () => {
    expect(normalizeForMatching("Wejdź na https://a.example/x albo napisz: kontakt@a.example")).toBe(
      "wejdz na albo napisz",
    );
  });
});

describe("TF-IDF char n-grams", () => {
  it("produces word-bounded n-grams", () => {
    expect(charNgrams("ab cd", 3, 3)).toEqual([" ab", "ab ", " cd", "cd "]);
  });

  it("scores reworded variants above unrelated texts", () => {
    const corpus = [
      "Adam Testowy zdradził sekret: platforma krypto zarabia 5000 zł dziennie. Zarejestruj się dziś!",
      "Sekret Adama Testowego: ta platforma kryptowalut zarabia nawet 5000 zł dziennie. Zarejestruj się teraz!",
      "Rowery miejskie w promocji, darmowa dostawa do końca miesiąca.",
      "Pyszna pizza na telefon, druga za pół ceny w każdy wtorek.",
    ];
    const [a, b, c, d] = tfidfVectors(corpus);
    const same = cosineSparse(a, b);
    const diff = cosineSparse(a, c);
    expect(same).toBeGreaterThan(0.45);
    expect(diff).toBeLessThan(0.1);
    expect(cosineSparse(c, d)).toBeLessThan(0.15);
    expect(cosineSparse(a, a)).toBeCloseTo(1, 6);
  });

  it("transforms unseen documents with the fitted model", () => {
    const model = fitTfidf(["platforma krypto zarabia", "pizza na telefon"]);
    const v = model.transform("platforma kryptowalut zarabia");
    expect(cosineSparse(v, model.transform("platforma krypto zarabia"))).toBeGreaterThan(0.5);
  });
});

describe("cosineDense", () => {
  it("computes cosine and rejects mismatched lengths", () => {
    expect(cosineDense([1, 0], [1, 0])).toBe(1);
    expect(cosineDense([1, 0], [0, 1])).toBe(0);
    expect(cosineDense([1, 1], [2, 2])).toBeCloseTo(1, 10);
    expect(() => cosineDense([1], [1, 2])).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { translationArtifacts, typographyDiffers, typographyOf } from "./typography";

const BODY = "Zwykły tekst testowy o niczym ważnym, który służy tylko do sprawdzenia profilu typografii w danym materiale. ".repeat(3);

describe("typographyOf", () => {
  it("separates guillemets from straight quotes", () => {
    const a = typographyOf(`${BODY} «cytat jeden» i «cytat dwa» za 1 000 zł`);
    const b = typographyOf(`${BODY} "cytat jeden" i "cytat dwa" za 1.000 zł`);
    expect(a?.quoteStyle).toBe("guillemets");
    expect(b?.quoteStyle).toBe("straight");
    expect(a?.per1000.guillemets).toBeGreaterThan(0);
    expect(typographyDiffers(a, b)).toBe(true);
    expect(typographyDiffers(a, a)).toBe(false);
  });
  it("gives no profile for a short text", () => {
    expect(typographyOf("krótko «tak»")).toBeNull();
  });
});

describe("translationArtifacts", () => {
  it("finds each type with a count", () => {
    const text = "Tu ty masz szansę, ty możesz, ty chcesz, a wy macie, wy możecie, wy chcecie. a mieszkanka miasta Warszawa zarobiła. Słowo prоsto.";
    const r = translationArtifacts(text, "zarobiłem dwa tysiące, potem trzysta, potem sto złotych");
    expect(r).toMatchObject({ mixed_alphabet: 1, calque: 1 });
    expect(r?.spelled_numbers).toBeGreaterThanOrEqual(3);
  });
  it("gives nothing for a correct text", () => {
    expect(translationArtifacts("Zwykły poprawny tekst, w którym mieszkanka miasta Warszawy opowiada o zakupach.", "krótki napis")).toBeNull();
  });
});

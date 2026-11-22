import { describe, expect, it } from "vitest";
import { languageErrors } from "./languageErrors";

describe("languageErrors (B-325)", () => {
  it("reports a long foreign paragraph in the page body and mixed-alphabet words", () => {
    expect(languageErrors([{ lang: "en", where: "page", chars: 120, sample: "x" }], { mixed_alphabet: 2 })).toEqual({ foreignParagraphLangs: ["en"], mixedWords: 2 });
    expect(languageErrors([], { mixed_alphabet: 1 })).toEqual({ foreignParagraphLangs: [], mixedWords: 1 });
  });

  it("ignores short blocks, scripts and comments, and artifacts other than mixed alphabets", () => {
    expect(languageErrors([{ lang: "en", where: "page", chars: 20, sample: "x" }, { lang: "ru", where: "script", chars: 500, sample: "y" }], { calque: 3, form_switch: 1 })).toBeNull();
    expect(languageErrors(null, null)).toBeNull();
  });
});

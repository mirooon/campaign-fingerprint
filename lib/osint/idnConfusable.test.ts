import { describe, expect, it } from "vitest";
import { idnConfusable, idnConfusableInUrl } from "./idnConfusable";

describe("idnConfusable (host that looks like another host)", () => {
  it("finds a character that passes for a slash and shows how the host looks to the eye", () => {
    for (const ch of ["∕", "／", "ノ"]) {
      const r = idnConfusable(`bank-przyklad.example${ch}logowanie.zlosliwa.test`)!;
      expect(r.kind).toBe("lookalike_char");
      expect(r.position).toBe("bank-przyklad.example".length);
      expect(r.looksLike).toBe("bank-przyklad.example/logowanie.zlosliwa.test");
      expect(r.char).toBe(`U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);
    }
  });

  it("finds a one dot leader that passes for a dot", () => {
    const r = idnConfusable("login․bank-przyklad.test")!;
    expect(r).toMatchObject({ kind: "lookalike_char", position: 5, looksLike: "login.bank-przyklad.test" });
  });

  it("finds a label that mixes Latin with Cyrillic letters and gives the Latin look", () => {
    const r = idnConfusable("sklеp-przyklad.test")!;
    expect(r).toMatchObject({ kind: "mixed_script", label: "sklеp-przyklad", position: 3, looksLike: "sklep-przyklad.test" });
  });

  it("does not flag plain hosts, Polish letters or a label written entirely in one script", () => {
    expect(idnConfusable("sklep-przyklad.test")).toBeNull();
    expect(idnConfusable("zażółć-gęślą.test")).toBeNull();
    expect(idnConfusable("пример.test")).toBeNull();
  });

  it("reads the host of a raw address, where a look-alike of the slash is still part of the host", () => {
    const r = idnConfusableInUrl("https://bank-przyklad.example∕logowanie.zlosliwa.test/start?x=1")!;
    expect(r.looksLike).toBe("bank-przyklad.example/logowanie.zlosliwa.test");
    expect(idnConfusableInUrl("https://sklep-przyklad.test/a∕b")).toBeNull();
    expect(idnConfusableInUrl("https://xn--sklp-przyklad-qfd.test/")).toBeNull();
  });
});

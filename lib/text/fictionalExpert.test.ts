import { describe, expect, it } from "vitest";
import { canonicalExperts, findExpertNames, isPublicPerson, loadPublicPersonForms, publicPersonForms } from "./fictionalExpert";

describe("fictional experts (B-313)", () => {
  it("reads a title and a two-word name, in any inflection", () => {
    expect(findExpertNames("Poleca dr Jan Testowy, specjalista.").map((e) => e.key)).toEqual(["dr:jan testow"]);
    expect(findExpertNames("według prof. Anny Przykładowej z uniwersytetu").map((e) => e.key)).toEqual(["prof:ann przykladow"]);
    expect(findExpertNames("Prof. dr hab. Piotr Wymyślony").map((e) => e.title)).toEqual(["prof"]);
  });
  it("ignores brands, lower-case words and a title without a surname", () => {
    expect(findExpertNames("Buty Dr. Martens Shoes i dr Kowal, drzewo Jan Nowak")).toEqual([]);
  });
  it("a name of the public list is a real person, a made-up one is not", () => {
    const forms = publicPersonForms([{ name: "Adam Testowy", aliases: ["Adama Testowego"] }]);
    expect(isPublicPerson("prof:adam testow", forms)).toBe(true);
    expect(isPublicPerson("dr:jan testow", forms)).toBe(false);
    expect(Array.isArray(loadPublicPersonForms())).toBe(true);
  });
  it("merges one-edit typos into the most frequent variant, keeps different titles apart", () => {
    const m = canonicalExperts(new Map([["dr:jan testow", 3], ["dr:jan testowy", 1], ["prof:jan testow", 1], ["dr:ewa inna", 1]]));
    expect(m.get("dr:jan testowy")).toBe("dr:jan testow");
    expect(m.get("prof:jan testow")).toBe("prof:jan testow");
    expect(m.get("dr:ewa inna")).toBe("dr:ewa inna");
  });
});

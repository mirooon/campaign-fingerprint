import { describe, expect, it } from "vitest";
import { classifyPayer, summarizePayers } from "./payerKind";

const pl = { pageName: null, polishAd: true };
const kind = (name: string, ctx: Parameters<typeof classifyPayer>[1] = pl) => classifyPayer(name, ctx).kind;

describe("classifyPayer", () => {
  it("reads a very short or stock placeholder as placeholder", () => {
    expect(kind("Test")).toBe("placeholder");
    expect(kind("XYZ")).toBe("placeholder");
    expect(kind("ab")).toBe("placeholder");
    expect(kind("n/a")).toBe("placeholder");
    expect(kind("-")).toBe("placeholder");
    expect(kind("123")).toBe("placeholder");
    expect(kind("brak")).toBe("placeholder");
  });

  it("reads keyboard noise as gibberish", () => {
    expect(kind("qwe9f8sd7f6")).toBe("gibberish");
    expect(kind("qwertyuiop")).toBe("gibberish");
    expect(kind("sdfghjklzx")).toBe("gibberish");
    expect(kind("kjhgfdsa")).toBe("gibberish");
  });

  it("does not read an ordinary one-word brand as gibberish", () => {
    expect(kind("Fikcyjnolandia")).not.toBe("gibberish");
    expect(kind("Przykladowo")).not.toBe("gibberish");
  });

  it("reads a name in a non-Latin or Vietnamese script on a Polish ad as person_foreign_script", () => {
    expect(kind("Иван Петров")).toBe("person_foreign_script");
    expect(kind("Nguyễn Văn A")).toBe("person_foreign_script");
    expect(kind("Γιώργος Παπαδόπουλος")).toBe("person_foreign_script");
    expect(kind("محمد علي")).toBe("person_foreign_script");
    expect(kind("王 小明")).toBe("person_foreign_script");
  });

  it("does not call a foreign-script name suspicious on an ad that is not Polish", () => {
    expect(kind("Иван Петров", { pageName: null, polishAd: false })).toBe("person");
  });

  it("reads two or three capitalised Latin words as person", () => {
    expect(kind("Jan Kowalski")).toBe("person");
    expect(kind("Anna Maria Nowak")).toBe("person");
  });

  it("reads only generic company words as generic_corp", () => {
    expect(kind("Global Media Corp")).toBe("generic_corp");
    expect(kind("Digital Marketing Group")).toBe("generic_corp");
    expect(kind("Studio Ltd")).toBe("generic_corp");
  });

  it("reads a made-up word with a generic ending as generic_corp, unless a registration number is given", () => {
    expect(kind("Fikcyjna Corp")).toBe("generic_corp");
    expect(kind("Przykladowy Media")).toBe("generic_corp");
    expect(kind("Przykladowy Trading Ltd")).toBe("generic_corp");
    expect(kind("Przykladowy Ltd 12345678")).toBe("registered_form");
    expect(kind("Przykladowy Zielony Duzy Media")).toBe("other");
  });

  it("reads a payer equal to the advertiser's page name as matches_page", () => {
    expect(kind("Sklep Przykladowy", { pageName: "sklep  przykładowy", polishAd: true })).toBe("matches_page");
  });

  it("reads a name with a legal form as registered_form", () => {
    expect(kind("Przykład sp. z o.o.")).toBe("registered_form");
    expect(kind("Beispiel GmbH")).toBe("registered_form");
    expect(kind("Priklad s.r.o.")).toBe("registered_form");
    expect(kind("Fikcyjna Spółka S.A.")).toBe("registered_form");
  });

  it("falls back to other and explains the reason", () => {
    const r = classifyPayer("Fundacja Zielona Dolina", pl);
    expect(r.kind).toBe("other");
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(classifyPayer("Test", pl).reasons.join(" ")).toMatch(/placeholder/);
  });

  it("checks the kinds in order: a placeholder is not also gibberish", () => {
    expect(kind("aaa")).toBe("placeholder");
    expect(kind("asdf")).toBe("placeholder");
  });
});

describe("summarizePayers", () => {
  it("lists kinds, equality with the beneficiary and suspicion", () => {
    const s = summarizePayers({ payers: ["Test"], beneficiaries: ["test"] }, pl)!;
    expect(s.payerKinds).toEqual(["placeholder"]);
    expect(s.payerEqualsBeneficiary).toBe(true);
    expect(s.payerSuspicious).toBe(true);
  });

  it("is not suspicious for registered and generic names and differs from a different beneficiary", () => {
    const s = summarizePayers({ payers: ["Przykład sp. z o.o."], beneficiaries: ["Inna Firma sp. z o.o."] }, pl)!;
    expect(s.payerKinds).toEqual(["registered_form"]);
    expect(s.payerEqualsBeneficiary).toBe(false);
    expect(s.payerSuspicious).toBe(false);
  });

  it("returns null for an ad without a declared payer", () => {
    expect(summarizePayers({ payers: [], beneficiaries: [] }, pl)).toBeNull();
  });
});

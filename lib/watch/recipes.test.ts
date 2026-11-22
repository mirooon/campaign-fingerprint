import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { confirmByRegistration, extractFeature, loadRecipes, parseRecipes } from "./recipes";

const EXAMPLE = path.join(process.cwd(), "data", "examples", "watch-przepisy.example.json");

describe("przykład przepisów (syntetyczny)", () => {
  it("wczytuje się, a każde źródło harmonogramu ma w nim przepis", () => {
    const recipes = loadRecipes(EXAMPLE);
    expect(new Set(recipes.map((r) => r.source))).toEqual(new Set(["urlscan", "certlist", "ct", "adlibrary"]));
  });

  it("nie zawiera wartości prawdziwych kampanii: tylko domeny .test/.example i wymyślone identyfikatory", () => {
    const text = readFileSync(EXAMPLE, "utf8");
    const hosts = [...text.matchAll(/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|pro|life|site|info|click|live|cyou|buzz)\b/gi)].map((m) => m[0]);
    expect(hosts).toEqual([]);
    expect(text).not.toMatch(/[0-9a-f]{64}/);
  });
});

describe("confirmByRegistration (filtr RDAP/NS)", () => {
  const rule = {
    registrars: ["Registrar Przykladowy"],
    nameserverPairs: [["ns1.dns-przyklad.test", "ns2.dns-przyklad.test"]],
    registeredHoursUtc: { from: 18, to: 19 },
  };
  const facts = { registrar: "Registrar Przykladowy Inc.", created: "2026-11-21T18:20:00Z", nameservers: ["NS1.DNS-PRZYKLAD.TEST.", "ns2.dns-przyklad.test"] };

  it("potwierdza domenę, która spełnia wszystkie warunki, i opisuje każdy", () => {
    const r = confirmByRegistration(rule, facts);
    expect(r.ok).toBe(true);
    expect(r.confirmations).toHaveLength(3);
  });

  it("odrzuca domenę innego rejestratora, gdy reguła wymaga wszystkich warunków", () => {
    expect(confirmByRegistration(rule, { ...facts, registrar: "Inny Rejestrator" }).ok).toBe(false);
  });

  it("minMatches pozwala na część warunków, ale reguła bez warunków nigdy nie potwierdza", () => {
    expect(confirmByRegistration({ ...rule, minMatches: 2 }, { ...facts, registrar: "Inny" }).ok).toBe(true);
    expect(confirmByRegistration({ ...rule, minMatches: 2 }, { ...facts, registrar: "Inny", nameservers: [] }).ok).toBe(false);
    expect(confirmByRegistration({}, facts).ok).toBe(false);
  });

  it("okno godzin przechodzi przez północ i brak daty rejestracji nie potwierdza godziny", () => {
    const night = { registeredHoursUtc: { from: 23, to: 1 } };
    expect(confirmByRegistration(night, { ...facts, created: "2026-11-21T00:30:00Z" }).ok).toBe(true);
    expect(confirmByRegistration(night, { ...facts, created: "2026-11-21T12:00:00Z" }).ok).toBe(false);
    expect(confirmByRegistration(night, { ...facts, created: null }).ok).toBe(false);
  });
});

describe("extractFeature", () => {
  const [recipe] = parseRecipes([{ id: "r", source: "urlscan", query: "x", feature: { name: "najemca", regex: "landing-cdn/([0-9a-f-]+)/", alarm: ["AAA-1"] } }]);

  it("czyta pierwszą grupę z adresów żądań i sprawdza listę alarmową bez względu na wielkość liter", () => {
    expect(extractFeature(recipe, ["https://x.test/a.js", "https://cdn.test/landing-cdn/aaa-1/main.js"])).toEqual({ value: "aaa-1", alarm: true });
    expect(extractFeature(recipe, ["https://cdn.test/landing-cdn/bbb-2/main.js"])).toEqual({ value: "bbb-2", alarm: false });
    expect(extractFeature(recipe, ["https://x.test/a.js"])).toBeNull();
  });

  it("wpis z gwiazdką na końcu listy alarmowej pasuje do wartości zaczynających się od niego", () => {
    const [r] = parseRecipes([{ id: "r", source: "urlscan", query: "x", feature: { name: "najemca", regex: "tenant/([0-9a-f-]+)/", alarm: ["abc1*"] } }]);
    expect(extractFeature(r, ["https://c.test/tenant/abc1-2222/x.js"])?.alarm).toBe(true);
    expect(extractFeature(r, ["https://c.test/tenant/abd1-2222/x.js"])?.alarm).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { extractFromHtml } from "../osint/extract";
import { extractPageKit } from "../osint/pagekit";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { endpointRef, makeDataset, type TestInfra, type TestItemSpec } from "./testkit";

// Lead-company traces (I23) on synthetic pages: fictional numbers and keys, reserved domains only.

function run(specs: TestItemSpec[], infra: TestInfra = {}) {
  const graph = buildEvidenceGraph(makeDataset(specs, infra), { textMethod: "none" });
  return clusterCampaigns(graph);
}
const same = (res: ReturnType<typeof run>, a: string, b: string) => res.campaigns.assignments[a] === res.campaigns.assignments[b];

/** A spec whose contacts come from extractFromHtml, as enrich would store them. */
function pageSpec(id: string, url: string, html: string): TestItemSpec {
  const ex = extractFromHtml(html, url);
  return { id, url, phones: ex.phones, phoneExamples: ex.phoneExamples };
}

describe("example number of a form template (3b)", () => {
  const form = `<form action="/api/lead"><input type="tel" name="phone" placeholder="+48 601 234 567"><small>np. 601 234 567</small></form>`;

  it("two sites on different domains with the same example number are not one campaign", () => {
    const res = run([pageSpec("a", "https://alpha.example/", form), pageSpec("b", "https://beta.test/", form)]);
    expect(res.graph.nodes.some((n) => n.type === "phone")).toBe(false);
    const tpl = res.graph.nodes.find((n) => n.type === "page_template");
    expect(tpl?.key).toBe("phone_example:+48601234567");
    expect(same(res, "a", "b")).toBe(false);
  });

  it("the same number as a contact in the footer is a phone pivot as before", () => {
    const footer = `<footer>Zadzwoń: 601 234 567</footer>`;
    const res = run([pageSpec("a", "https://alpha.example/", footer), pageSpec("b", "https://beta.test/", footer)]);
    expect(res.graph.nodes.find((n) => n.type === "phone")?.key).toBe("+48601234567");
    expect(same(res, "a", "b")).toBe(true);
  });
});

/** A spec whose page kit comes from extractPageKit, as enrich would store it. */
function kitSpec(id: string, url: string, html: string, over: Partial<TestItemSpec> = {}): TestItemSpec {
  return { id, url, kit: extractPageKit(html, url), ...over };
}
const evidenceOf = (res: ReturnType<typeof run>, a: string, b: string) =>
  res.graph.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))?.evidence ?? [];

describe("affiliate network and CRM traces (1)", () => {
  const hidden = (aff: string) => `<form action="/send"><input type="hidden" name="aff_id" value="${aff}"><input name="phone"></form>`;

  it("the same aff_id in a hidden field on two domains makes one campaign (campaign_param from the form)", () => {
    const res = run([kitSpec("a", "https://alpha.example/", hidden("aff-58213")), kitSpec("b", "https://beta.test/", hidden("aff-58213"))]);
    expect(same(res, "a", "b")).toBe(true);
    const ev = evidenceOf(res, "a", "b").find((e) => e.pivotType === "campaign_param");
    expect(ev?.evidence).toContain("z formularza");
  });

  it("aff_id=1 on two pages links nothing", () => {
    const res = run([kitSpec("a", "https://alpha.example/", hidden("1")), kitSpec("b", "https://beta.test/", hidden("1"))]);
    expect(same(res, "a", "b")).toBe(false);
  });

  it("the same API key in the scripts of two pages is a crm_key; only its preview and hash leave the extractor", () => {
    const key = "Zx81QpL0vT6mWc3RyB9n";
    const html = `<script>fetch("https://crm.example/api/lead", { method: "POST", headers: { "x-api-key": "${key}" } });</script>`;
    const res = run([kitSpec("a", "https://alpha.example/", html), kitSpec("b", "https://beta.test/", html)]);
    const node = res.graph.nodes.find((n) => n.type === "crm_key");
    expect(node?.label).toContain("Zx81…yB9n");
    expect(node?.data.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(res.graph)).not.toContain(key);
    expect(same(res, "a", "b")).toBe(true);
  });

  it("a shared reCAPTCHA site key is no crm_key", () => {
    const html = `<div class="g-recaptcha" data-sitekey="6LcTestKeyAbCdEfGhIjKlMnOpQrStUvWxYz012345"></div><script>grecaptcha.render("x", { sitekey: "6LcTestKeyAbCdEfGhIjKlMnOpQrStUvWxYz012345" });</script>`;
    const res = run([kitSpec("a", "https://alpha.example/", html), kitSpec("b", "https://beta.test/", html)]);
    expect(res.graph.nodes.some((n) => n.type === "crm_key")).toBe(false);
    expect(same(res, "a", "b")).toBe(false);
  });

  it("a per-click aff_click_id is no pivot between materials", () => {
    const res = run([
      { id: "a", url: "https://alpha.example/?aff_click_id=c8f1e2d3a4b5c6d7", params: [{ name: "click_id", value: "c8f1e2d3a4b5c6d7" }] },
      { id: "b", url: "https://beta.test/?aff_click_id=c8f1e2d3a4b5c6d7", params: [{ name: "click_id", value: "c8f1e2d3a4b5c6d7" }] },
    ]);
    expect(res.graph.nodes.some((n) => n.type === "campaign_param")).toBe(false);
    expect(same(res, "a", "b")).toBe(false);
  });
});

describe("template sentences (2a, 2b)", () => {
  const thanks = `<p>Oferta dla nowych klientów.</p><script>form.onsubmit = function () { box.innerHTML = "Dziękujemy! Nasz opiekun klienta zadzwoni do Ciebie i przedstawi platformę inwestycyjną."; };</script>`;

  it("the same rare thank-you sentence on two domains and nothing else gives no campaign", () => {
    const res = run([kitSpec("a", "https://alpha.example/", thanks), kitSpec("b", "https://beta.test/", thanks)]);
    expect(res.graph.nodes.find((n) => n.type === "template_phrase")?.data.source).toBe("script");
    expect(same(res, "a", "b")).toBe(false);
  });

  it("with a second trace of the operator it is a premise of the campaign", () => {
    const infra: TestInfra = { ns: { "alpha.example": ["ns1.dns-operatora.test"], "beta.test": ["ns1.dns-operatora.test"] } };
    const res = run([kitSpec("a", "https://alpha.example/", thanks), kitSpec("b", "https://beta.test/", thanks)], infra);
    expect(same(res, "a", "b")).toBe(true);
    expect(evidenceOf(res, "a", "b").some((e) => e.pivotType === "template_phrase")).toBe(true);
  });

  it("a consent sentence shared by ten pages is no pivot", () => {
    const consent = `<p>Wyrażam zgodę na przetwarzanie moich danych osobowych w celu kontaktu telefonicznego.</p>`;
    const specs = Array.from({ length: 10 }, (_, i) => kitSpec(`p${i}`, `https://strona${i}.example/`, consent));
    const res = run(specs);
    expect(res.graph.nodes.some((n) => n.type === "template_phrase")).toBe(false);
  });

  it("a sentence on one domain only is no pivot (a site repeats its own text)", () => {
    const res = run([kitSpec("a", "https://alpha.example/a", thanks), kitSpec("b", "https://alpha.example/b", thanks)]);
    expect(res.graph.nodes.some((n) => n.type === "template_phrase")).toBe(false);
  });

  it("a shared copying error weighs more, still below the strong threshold", () => {
    const odd = `<p>Nasz menedżer zadzwoni do ciebie i zapozna cię z zapozna cię z naszą platformą.</p>`;
    const res = run([kitSpec("a", "https://alpha.example/", odd), kitSpec("b", "https://beta.test/", odd), kitSpec("c", "https://gamma.example/", thanks), kitSpec("d", "https://delta.test/", thanks)]);
    const oddNode = res.graph.nodes.find((n) => n.type === "template_phrase" && n.data.oddity === "repeat")!;
    const plainNode = res.graph.nodes.find((n) => n.type === "template_phrase" && !n.data.oddity)!;
    const w = (a: string, b: string) => evidenceOf(res, a, b).find((e) => e.pivotType === "template_phrase")!.weight;
    expect(oddNode).toBeDefined();
    expect(plainNode).toBeDefined();
    expect(w("a", "b")).toBeGreaterThan(w("c", "d"));
    expect(w("a", "b")).toBeLessThan(0.7);
  });
});

describe("taken-over ad accounts and face rotation (3)", () => {
  const investText = "Inwestuj w kryptowaluty z platformą AI i zarabiaj codziennie bez wysiłku.";

  it("an investment ad from an account named like a guest house is marked and its name links nothing", () => {
    const res = run([
      { id: "a", text: investText, advertiser: "Pensjonat Pod Testową Górą" },
      { id: "b", text: `${investText} Sprawdź sam.`, advertiser: "Pensjonat Pod Testową Górą" },
    ]);
    const a = res.graph.nodes.find((n) => n.type === "item" && n.key === "a")!;
    expect(a.data.advertiserMismatch).toBe(true);
    expect(a.data.advertiserMismatchKind).toBe("business");
    expect(evidenceOf(res, "a", "b").some((e) => e.pivotType === "advertiser")).toBe(false);
  });

  it("the same advertiser name with non-investment content still links as before", () => {
    const res = run([
      { id: "a", text: "Zapraszamy na weekend w górach, śniadania w cenie.", advertiser: "Pensjonat Pod Testową Górą" },
      { id: "b", text: "Wolne pokoje na ferie, rezerwuj już dziś.", advertiser: "Pensjonat Pod Testową Górą" },
    ]);
    expect(evidenceOf(res, "a", "b").some((e) => e.pivotType === "advertiser")).toBe(true);
  });

  const backend = (page: string) => endpointRef("https://leads-api.test/api/v1/submit/0b9a5c3e-1d2f-4a6b-9c8d-7e6f5a4b3c2d/", page);

  it("two different personas with the same form backend are one campaign (A/B test of faces)", () => {
    const res = run([
      { id: "a", url: "https://alpha.example/", personas: ["Adam Testowy"], kit: { endpoints: [backend("https://alpha.example/")] } },
      { id: "b", url: "https://beta.test/", personas: ["Ewa Przykładowa"], kit: { endpoints: [backend("https://beta.test/")] } },
    ]);
    expect(same(res, "a", "b")).toBe(true);
  });

  it("the same persona on different infrastructure gives two campaigns, at most one group", () => {
    const res = run([
      { id: "a", url: "https://alpha.example/", personas: ["Adam Testowy"], kit: { endpoints: [endpointRef("https://leads-a.test/api/lead/11111111-2222-4333-8444-555555555555/", "https://alpha.example/")] } },
      { id: "b", url: "https://beta.test/", personas: ["Adam Testowy"], kit: { endpoints: [endpointRef("https://leads-b.test/api/lead/66666666-7777-4888-9999-aaaaaaaaaaaa/", "https://beta.test/")] } },
    ]);
    expect(same(res, "a", "b")).toBe(false);
    expect((res.campaigns.families ?? []).length).toBeLessThanOrEqual(1);
  });
});

describe("profit claims (2c)", () => {
  it("the same amounts and periods are an attribute and a group trace, never a campaign", () => {
    const text = "Nastolatek zarobił 3 tys. w ciągu dnia, a sąsiad 4 tys. w ciągu tygodnia.";
    const res = run([
      { id: "a", url: "https://alpha.example/", text },
      { id: "b", url: "https://beta.test/", text: `${text} Dołącz dziś.` },
    ]);
    const a = res.graph.nodes.find((n) => n.type === "item" && n.key === "a")!;
    expect(a.data.profitClaims).toEqual([
      { amount: 3000, currency: null, period: "day", quote: "3 tys. w ciągu dnia" },
      { amount: 4000, currency: null, period: "week", quote: "4 tys. w ciągu tygodnia" },
    ]);
    expect(res.graph.nodes.find((n) => n.type === "profit_claim")?.key).toBe("3000/day|4000/week");
    expect(same(res, "a", "b")).toBe(false);
  });

  it("a standard deposit is no pivot", () => {
    const res = run([
      { id: "a", text: "Minimalny depozyt to 250 USD." },
      { id: "b", text: "Minimalny depozyt to 250 USD, zacznij teraz." },
    ]);
    expect(res.graph.nodes.some((n) => n.type === "profit_claim")).toBe(false);
  });
});

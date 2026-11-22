import { describe, expect, it } from "vitest";
import { extractPageKit, type PageScript } from "../osint/pagekit";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { makeDataset, type TestInfra, type TestItemSpec } from "./testkit";

// Text fingerprint of a page kit (I25) on synthetic pages: invented messages, reserved domains only.

function run(specs: TestItemSpec[], infra: TestInfra = {}) {
  return clusterCampaigns(buildEvidenceGraph(makeDataset(specs, infra), { textMethod: "none" }));
}
const same = (res: ReturnType<typeof run>, a: string, b: string) => res.campaigns.assignments[a] === res.campaigns.assignments[b];
const evidenceOf = (res: ReturnType<typeof run>, a: string, b: string) =>
  res.graph.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))?.evidence ?? [];

/** The landing-page platform's config of an account (window.aio with owner_uuid). */
const aio = (owner: string) => `<script>window.aio = ${JSON.stringify({ campaign: { uuid: "6e2d4b80-93a1-4c57-b8e2-1f4a7c9d03be", owner_uuid: owner } })};</script>`;
const owner = (n: number) => `5a1e0c3d-7b42-4f19-9c6e-2d8b41f07a1${n}`;

function page(id: string, url: string, body: string, scripts: PageScript[] = []): TestItemSpec {
  return { id, url, kit: extractPageKit(`<html><head></head><body><p>Oferta.</p>${body}</body></html>`, url, { scripts }) };
}

const kitJs = `console.log("Moduł testowy: start!"); console.warn("Pułapka wstecz uzbrojona..."); console.error("Formularz fikcyjny nie wyslany:");`;
const sdkMsg = `console.log("Komunikat platformy fikcyjnej dla kont!"); console.log("Drugi komunikat platformy fikcyjnej!");`;
const ns: TestInfra = { ns: { "alpha.example": ["ns1.dns-operatora.test"], "beta.test": ["ns1.dns-operatora.test"] } };

describe("text mask of the page platform (I25, 1)", () => {
  it("three pages of three platform accounts with the same SDK script: no text pivot", () => {
    const specs = [1, 2, 3].map((n) =>
      page(`p${n}`, `https://site${n}.example/`, aio(owner(n)), [{ url: `https://site${n}.example/aio-static/sdk/sdk.js`, body: sdkMsg }]),
    );
    const res = run(specs);
    expect(res.graph.nodes.some((n) => n.type === "kit_string" || n.type === "template_phrase")).toBe(false);
  });

  it("a message on pages of five platform accounts is the platform's text, not a pivot", () => {
    const specs = [1, 2, 3, 4, 5].map((n) => page(`p${n}`, `https://site${n}.example/`, `${aio(owner(n))}<script>${sdkMsg}</script>`));
    expect(run(specs).graph.nodes.some((n) => n.type === "kit_string")).toBe(false);
  });

  it("the same messages in the own scripts of two domains of one account are a pivot", () => {
    const specs = [1, 2].map((n) => page(`p${n}`, `https://site${n}.example/`, aio(owner(1)), [{ url: `https://site${n}.example/js/app.js`, body: kitJs }]));
    expect(run(specs).graph.nodes.some((n) => n.type === "kit_string")).toBe(true);
  });

  it("a script with one message in six languages gives localizedUi and no pivot", () => {
    const dict = `var t = { en: { c: "Close the window now!" }, pl: { c: "Zamknij okno teraz!" }, de: { c: "Fenster jetzt schliessen!" }, fr: { c: "Fermer la fenetre!" }, it: { c: "Chiudi la finestra!" }, es: { c: "Cierra la ventana!" } };`;
    const res = run([page("a", "https://alpha.example/", `<script>${dict}</script>`), page("b", "https://beta.test/", `<script>${dict}</script>`)]);
    expect(res.graph.nodes.find((n) => n.id === "item:a")?.data.localizedUi).toEqual(["de", "en", "es", "fr", "it", "pl"]);
    expect(res.graph.nodes.some((n) => n.type === "kit_string" || n.type === "template_phrase")).toBe(false);
  });
});

describe("developer messages of the kit (kit_string, I25, 2)", () => {
  const own = (host: string): PageScript[] => [{ url: `https://${host}/js/trap.js`, body: kitJs }];

  it("two domains with the same own script: one kit_string premise, no campaign alone", () => {
    const res = run([page("a", "https://alpha.example/", "", own("alpha.example")), page("b", "https://beta.test/", "", own("beta.test"))]);
    const ev = evidenceOf(res, "a", "b").filter((e) => e.pivotType === "kit_string");
    expect(ev).toHaveLength(1);
    expect(same(res, "a", "b")).toBe(false);
  });

  it("with a second trace of the operator it is a premise of the campaign", () => {
    const res = run([page("a", "https://alpha.example/", "", own("alpha.example")), page("b", "https://beta.test/", "", own("beta.test"))], ns);
    expect(same(res, "a", "b")).toBe(true);
    expect(evidenceOf(res, "a", "b").some((e) => e.pivotType === "kit_string")).toBe(true);
  });

  it("one shared short message is not enough; one message of five words is", () => {
    const one = (msg: string) => (host: string): PageScript[] => [{ url: `https://${host}/js/x.js`, body: `console.log("${msg}");` }];
    const short = one("Moduł testowy uruchomiony!");
    const long = one("Moduł testowy pułapki wstecz uruchomiony poprawnie!");
    const r1 = run([page("a", "https://alpha.example/", "", short("alpha.example")), page("b", "https://beta.test/", "", short("beta.test"))]);
    expect(evidenceOf(r1, "a", "b").some((e) => e.pivotType === "kit_string")).toBe(false);
    const r2 = run([page("a", "https://alpha.example/", "", long("alpha.example")), page("b", "https://beta.test/", "", long("beta.test"))]);
    expect(evidenceOf(r2, "a", "b").some((e) => e.pivotType === "kit_string")).toBe(true);
  });

  it("messages of a library file or of the SDK path link nothing", () => {
    const lib = (host: string): PageScript[] => [
      { url: `https://${host}/js/jquery.min.js`, body: kitJs },
      { url: `https://${host}/aio-static/sdk/sdk.js`, body: sdkMsg },
    ];
    const res = run([page("a", "https://alpha.example/", "", lib("alpha.example")), page("b", "https://beta.test/", "", lib("beta.test"))]);
    expect(res.graph.nodes.some((n) => n.type === "kit_string")).toBe(false);
  });
});

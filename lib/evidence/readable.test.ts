import { describe, expect, it } from "vitest";
import { methodsWithPremises, sharedInfrastructureNote, traceTypeName, traceTypeNameInText, whyInCampaign } from "./readable";
import type { SharedTrace } from "./traces";

const trace = (over: Partial<SharedTrace> & { ads: string[] }): SharedTrace => ({ type: "domain", value: "x.example", label: "x.example", ads_with_identifier: over.ads.length, weight: 0.9, strong: true, discount_reasons: [], ...over });

describe("traceTypeName", () => {
  it("names a trace type in plain Polish and falls back to the raw type", () => {
    expect(traceTypeName("domain")).toBe("Domena");
    expect(traceTypeName("nieznany_typ")).toBe("nieznany_typ");
  });
  it("puts the name in lower case for the middle of a sentence, but keeps an abbreviation", () => {
    expect(traceTypeNameInText("Unknown_type")).toBe("unknown_type");
    expect(traceTypeNameInText("IP_type")).toBe("IP_type");
  });
});

describe("whyInCampaign", () => {
  it("gives the first (strongest) shared trace of the ad", () => {
    const traces = [trace({ type: "domain", value: "a.example", ads: ["a1", "a2"] }), trace({ type: "ip", value: "192.0.2.10", ads: ["a2", "a3"] })];
    expect(whyInCampaign("a2", traces)).toBe("Domena: a.example (+1 trace)");
    expect(whyInCampaign("a3", traces)).toBe("Adres IP: 192.0.2.10");
  });
  it("says so when the ad holds no shared trace of its own", () => {
    expect(whyInCampaign("zz", [trace({ ads: ["a1", "a2"] })])).toMatch(/no trace shared/);
  });
});

describe("methodsWithPremises", () => {
  it("keeps only the similarity methods that produced a premise, with words instead of keys", () => {
    const methods = { image: "dHash 64 bit, próg Hamminga 10", text: "tfidf, próg 0.5", dom: "simhash, próg 3", audio: "Chromaprint" };
    const out = methodsWithPremises(methods, ["similar_text", "similar_dom"]);
    expect(Object.keys(out)).toEqual(["text", "dom"]);
    expect(out.text).toMatch(/podobny tekst/i);
  });
});

describe("sharedInfrastructureNote", () => {
  it("marks Cloudflare name servers and addresses as shared by many independent sites", () => {
    expect(sharedInfrastructureNote("ns1.ns.cloudflare.com")).toMatch(/does not link/);
    expect(sharedInfrastructureNote("CLOUDFLARENET - Cloudflare, Inc., US")).toMatch(/shared by many independent sites/);
    expect(sharedInfrastructureNote("ns1.hosting.example")).toBeNull();
  });
});

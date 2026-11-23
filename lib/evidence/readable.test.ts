import { describe, expect, it } from "vitest";
import { methodsWithPremises, sharedInfrastructureNote, traceTypeName, whyInCampaign } from "./readable";
import type { SharedTrace } from "./traces";

const trace = (over: Partial<SharedTrace> & { ads: string[] }): SharedTrace => ({ type: "domain", value: "x.example", label: "x.example", ads_with_identifier: over.ads.length, weight: 0.9, strong: true, discount_reasons: [], ...over });

describe("traceTypeName", () => {
  it("names a trace type in plain Polish and falls back to the raw type", () => {
    expect(traceTypeName("domain")).toBe("Domain");
    expect(traceTypeName("nieznany_typ")).toBe("nieznany_typ");
  });
});

describe("whyInCampaign", () => {
  it("gives the first (strongest) shared trace of the ad", () => {
    const traces = [trace({ type: "domain", value: "a.example", ads: ["a1", "a2"] }), trace({ type: "ip", value: "192.0.2.10", ads: ["a2", "a3"] })];
    expect(whyInCampaign("a2", traces)).toBe("Domain: a.example (+1 ślad)");
    expect(whyInCampaign("a3", traces)).toBe("IP address: 192.0.2.10");
  });
  it("says so when the ad holds no shared trace of its own", () => {
    expect(whyInCampaign("zz", [trace({ ads: ["a1", "a2"] })])).toMatch(/brak wspólnego śladu/);
  });
});

describe("methodsWithPremises", () => {
  it("keeps only the similarity methods that produced a premise, with words instead of keys", () => {
    const methods = { image: "dHash 64 bit, próg Hamminga 10", text: "tfidf, próg 0.5", dom: "simhash, próg 3", audio: "Chromaprint" };
    const out = methodsWithPremises(methods, ["similar_text", "similar_dom"]);
    expect(Object.keys(out)).toEqual(["text", "dom"]);
    expect(out.text).toMatch(/similar text/i);
  });
});

describe("sharedInfrastructureNote", () => {
  it("marks Cloudflare name servers and addresses as shared by many independent sites", () => {
    expect(sharedInfrastructureNote("ns1.ns.cloudflare.com")).toMatch(/nie łączy/);
    expect(sharedInfrastructureNote("CLOUDFLARENET - Cloudflare, Inc., US")).toMatch(/wspólne dla wielu niezależnych stron/);
    expect(sharedInfrastructureNote("ns1.hosting.example")).toBeNull();
  });
});

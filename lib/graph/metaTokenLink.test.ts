/**
 * Meta access token as a pivot (B-144): the same token on two pages is one node that holds only its hash, and the
 * raw token appears nowhere in the serialized graph. Synthetic tokens only (made-up characters, .example/.test hosts).
 */
import { describe, expect, it } from "vitest";
import { metaTokenKey, metaTokenKeysIn } from "../osint/metaToken";
import { maskUrl } from "../osint/redact";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { makeDataset, type TestItemSpec } from "./testkit";

/** A made-up token: "EAAtest" and letters, 100 characters. */
const TOKEN = `EAAtest${"Qx7Lm2Zp".repeat(12)}`.slice(0, 100);
const OTHER = `EAAtest${"Rn4Vb9Kd".repeat(12)}`.slice(0, 100);

/** Runs the graph and clustering on synthetic items. */
function run(specs: TestItemSpec[]) {
  return clusterCampaigns(buildEvidenceGraph(makeDataset(specs), { textMethod: "none" }));
}
const tokenLinks = (res: ReturnType<typeof run>) => res.graph.links.filter((l) => l.evidence.some((e) => e.pivotType === "meta_token"));

describe("meta_token (B-144)", () => {
  it("finds a token in code, in token= and in fb_capi_token, raw or masked, and returns only keys", () => {
    const keys = metaTokenKeysIn([`<script>var x="${TOKEN}"</script>`, `https://api.example.test/p?token=${TOKEN}`, `{"fb_capi_token":"${TOKEN}"}`, `u?token=${maskUrl(`?token=${TOKEN}`).slice(7)}`]);
    expect(keys).toEqual([metaTokenKey(TOKEN)]);
    expect(JSON.stringify(keys)).not.toContain(TOKEN);
    expect(metaTokenKeysIn([`EAAB${"x".repeat(10)}`, "plain text"])).toEqual([]);
  });

  it("links two pages by the same token and keeps the raw token out of the graph", () => {
    const res = run([
      { id: "a", url: `https://sklep-alfa.test/?token=${TOKEN}` },
      { id: "b", url: "https://sklep-beta.example/", kit: { metaTokens: metaTokenKeysIn([`window.aio = {"fb_capi_token":"${TOKEN}"}`]) } },
      { id: "c", url: `https://sklep-gamma.example/?token=${OTHER}` },
    ]);
    const nodes = res.graph.nodes.filter((n) => n.type === "meta_token");
    expect(nodes.map((n) => n.key).sort()).toEqual([metaTokenKey(TOKEN), metaTokenKey(OTHER)].sort());
    const link = res.graph.links.find((l) => l.a === "a" && l.b === "b");
    expect(link?.evidence.map((e) => e.pivotType)).toContain("meta_token");
    expect(tokenLinks(res)).toHaveLength(1);
    const json = JSON.stringify(res.graph);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain(OTHER);
    expect(json).toContain(metaTokenKey(TOKEN));
  });
});

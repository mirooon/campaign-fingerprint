import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LINK_CONFIG } from "@/lib/graph/config";
import { HIGHLIGHTS_ANCHOR, HIGHLIGHTS_HEADING, collectCatalog, renderCatalog } from "@/lib/docs/featuresCatalog";
import { FEATURE_HIGHLIGHTS, type FeatureHighlight } from "@/lib/docs/featureHighlights";
import { DEFAULT_NARRATIVE_CONFIG } from "@/lib/text/narrative";

const root = path.resolve(__dirname, "..");

describe("features catalog", () => {
  it("lists every pivot type of the config in the output", () => {
    const data = collectCatalog(root);
    const md = renderCatalog(data, DEFAULT_LINK_CONFIG, "2000-01-01", "abc1234");
    for (const type of Object.keys(DEFAULT_LINK_CONFIG.typeWeights).filter((t) => t !== "item")) expect(md).toContain(`\`${type}\``);
    expect(md).toContain("Generated file: `bun run features:catalog`. Do not edit by hand.");
    expect(md).toContain("## No description");
    expect(md).toContain("abc1234");
  });

  it("puts the highlighted traces first, links them from section 1 and stars their types", () => {
    const data = collectCatalog(root);
    const md = renderCatalog(data, DEFAULT_LINK_CONFIG, "2000-01-01", "abc1234");
    const top = md.indexOf(`## ${HIGHLIGHTS_HEADING}`);
    expect(top).toBeGreaterThan(-1);
    expect(top).toBeLessThan(md.indexOf("## 1. Linking traces"));
    for (const h of FEATURE_HIGHLIGHTS) expect(md).toContain(`### ${h.title}`);
    expect(md).toContain(`(#${HIGHLIGHTS_ANCHOR})`);
    expect(md).toContain("| Type | Name | Weight | Level | Source | Why | Example |");
    for (const p of data.pivots.filter((p) => p.highlighted && p.label)) expect(md).toMatch(new RegExp(`\\| \`${p.type}\` \\| [^|]*★ \\|`));
    expect(data.undescribed.filter((u) => u.startsWith("highlighted"))).toEqual([]);
  });

  it("reports a highlighted key that is not in the registries", () => {
    const bogus: FeatureHighlight = { id: "x", title: "Test", types: ["no_such_type"], attributes: ["noSuchAttribute"], how: "", missed: "", sample: "" };
    const data = collectCatalog(root, DEFAULT_LINK_CONFIG, DEFAULT_NARRATIVE_CONFIG, [bogus]);
    expect(data.undescribed).toContain("highlighted trace “Test”: no_such_type (no trace type or no entry in TYPE_INFO)");
    expect(data.undescribed).toContain("highlighted trace “Test”: noSuchAttribute (no entry in FEATURE_INFO)");
  });
});

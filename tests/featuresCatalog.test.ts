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
    expect(md).toContain("Plik generowany: `bun run features:catalog`. Nie edytuj ręcznie.");
    expect(md).toContain("## Bez opisu");
    expect(md).toContain("abc1234");
  });

  it("puts the highlighted traces first, links them from section 1 and stars their types", () => {
    const data = collectCatalog(root);
    const md = renderCatalog(data, DEFAULT_LINK_CONFIG, "2000-01-01", "abc1234");
    const top = md.indexOf(`## ${HIGHLIGHTS_HEADING}`);
    expect(top).toBeGreaterThan(-1);
    expect(top).toBeLessThan(md.indexOf("## 1. Ślady łączące"));
    for (const h of FEATURE_HIGHLIGHTS) expect(md).toContain(`### ${h.title}`);
    expect(md).toContain(`(#${HIGHLIGHTS_ANCHOR})`);
    expect(md).toContain("| Typ | Nazwa | Waga | Poziom | Skąd | Po co | Przykład |");
    for (const p of data.pivots.filter((p) => p.highlighted && p.label)) expect(md).toMatch(new RegExp(`\\| \`${p.type}\` \\| [^|]*★ \\|`));
    expect(data.undescribed.filter((u) => u.startsWith("wyróżniony"))).toEqual([]);
  });

  it("reports a highlighted key that is not in the registries", () => {
    const bogus: FeatureHighlight = { id: "x", title: "Test", types: ["no_such_type"], attributes: ["noSuchAttribute"], how: "", missed: "", sample: "" };
    const data = collectCatalog(root, DEFAULT_LINK_CONFIG, DEFAULT_NARRATIVE_CONFIG, [bogus]);
    expect(data.undescribed).toContain("wyróżniony ślad „Test”: no_such_type (brak typu śladu albo wpisu w TYPE_INFO)");
    expect(data.undescribed).toContain("wyróżniony ślad „Test”: noSuchAttribute (brak wpisu w FEATURE_INFO)");
  });
});

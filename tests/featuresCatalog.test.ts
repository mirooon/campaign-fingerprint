import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LINK_CONFIG } from "@/lib/graph/config";
import { collectCatalog, renderCatalog } from "@/lib/docs/featuresCatalog";

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
});

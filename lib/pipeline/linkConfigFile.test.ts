import { describe, expect, it } from "vitest";
import { buildGraphConfigFile, resolveLinkConfigFile } from "./linkConfigFile";

const has = (...files: string[]) => (f: string) => files.includes(f);

describe("resolveLinkConfigFile", () => {
  it("explicit file and LINK_CONFIG win over everything", () => {
    expect(resolveLinkConfigFile({ explicit: "a.json", env: "b.json", dataDir: "/d/baza", exists: has() })).toBe("a.json");
    expect(resolveLinkConfigFile({ env: "b.json", dataDir: "/d/baza", exists: has() })).toBe("b.json");
  });

  it("takes the config stored next to the data, then the one above it", () => {
    expect(resolveLinkConfigFile({ dataDir: "/d/baza", exists: has("/d/baza/linking.json", "/d/linking-default.json") })).toBe("/d/baza/linking.json");
    expect(resolveLinkConfigFile({ dataDir: "/d/baza", exists: has("/d/linking-default.json") })).toBe("/d/linking-default.json");
  });

  it("does not fall back to the sample config for data outside the sample", () => {
    expect(resolveLinkConfigFile({ dataDir: "/d/baza", exists: has("/app/data/sample/linking.json") })).toBeNull();
  });

  it("falls back to the sample config only when the caller says the data is the sample", () => {
    expect(resolveLinkConfigFile({ dataDir: "/app/data", sampleConfig: "/app/data/sample/linking.json", exists: has("/app/data/sample/linking.json") })).toBe("/app/data/sample/linking.json");
  });
});

describe("buildGraphConfigFile", () => {
  it("uses the sample config only for the default (sample) work files", () => {
    expect(buildGraphConfigFile(undefined, "data/work/enriched.json")).toBe("data/sample/linking.json");
    expect(buildGraphConfigFile(undefined, "/dane/baza/enriched.json")).toBeUndefined();
  });

  it("keeps an explicit file", () => {
    expect(buildGraphConfigFile("moje.json", "/dane/baza/enriched.json")).toBe("moje.json");
  });
});

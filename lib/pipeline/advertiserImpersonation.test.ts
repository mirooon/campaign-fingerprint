import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildEvidenceGraph } from "../graph/link";
import { compileWatchlist } from "../text/persona";
import { enrichItems } from "./enrich";
import { fixtureSources } from "./sources";
import type { Item } from "./types";

const item = (id: string, advertiser: string | null): Item => ({ id, platform: null, advertiser, text: null, imageUrl: null, imagePath: null, landingUrl: null, firstSeen: null, lastSeen: null, label: null, persona: null, deepfakeScore: null, videoPath: null, extra: {} });
// a pseudonym (one word) and a full name with its inflected forms, as in the list of public persons
const personas = compileWatchlist([{ id: "friz", name: "Friz" }, { id: "adam-testowy", name: "Adam Testowy" }]);
const sources = fixtureSources(path.join(process.cwd(), "data", "sample", "fixtures"));

describe("advertiser that impersonates a listed person (B-298)", () => {
  it("marks an advertiser whose name holds a pseudonym or a name from the list, and not one that does not", async () => {
    const ds = await enrichItems([item("a", "Friz Official"), item("b", "Adam Testowy - oficjalny profil"), item("c", "Sklep z rowerami"), item("d", null)], { sources, baseDir: ".", personas });
    expect(ds.perItem.a.advertiserImpersonates).toEqual({ id: "friz", name: "Friz" });
    expect(ds.perItem.b.advertiserImpersonates).toEqual({ id: "adam-testowy", name: "Adam Testowy" });
    expect(ds.perItem.c.advertiserImpersonates).toBeUndefined();
    expect(ds.perItem.d.advertiserImpersonates).toBeUndefined();
  });

  it("is an attribute of the material, not a link: two advertisers imitating one person are not joined by it", async () => {
    const ds = await enrichItems([item("a", "Friz Official"), item("b", "Friz TV")], { sources, baseDir: ".", personas });
    const graph = buildEvidenceGraph(ds, { textMethod: "none" });
    expect(graph.nodes.find((n) => n.id === "item:a")!.data).toMatchObject({ advertiserImpersonates: "friz", advertiserImpersonatesName: "Friz" });
    expect(graph.links.some((l) => (l.a === "a" && l.b === "b") || (l.a === "b" && l.b === "a"))).toBe(false);
  });
});

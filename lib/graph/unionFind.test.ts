import { describe, expect, it } from "vitest";
import { UnionFind } from "./unionFind";

describe("UnionFind", () => {
  it("unions, finds and reports components", () => {
    const uf = new UnionFind(["a", "b", "c", "d", "e"]);
    expect(uf.union("a", "b")).toBe(true);
    expect(uf.union("b", "a")).toBe(false);
    uf.union("c", "d");
    uf.union("d", "b");
    expect(uf.connected("a", "c")).toBe(true);
    expect(uf.connected("a", "e")).toBe(false);
    expect(uf.setSize("d")).toBe(4);
    const comps = uf.components().map((c) => c.sort().join(""));
    expect(comps.sort()).toEqual(["abcd", "e"]);
  });

  it("adds unknown elements lazily and compresses long chains", () => {
    const uf = new UnionFind<number>();
    for (let i = 0; i < 1000; i++) uf.union(i, i + 1);
    expect(uf.connected(0, 1000)).toBe(true);
    expect(uf.setSize(500)).toBe(1001);
    expect(uf.has(2000)).toBe(false);
    expect(uf.find(2000)).toBe(2000);
    expect(uf.has(2000)).toBe(true);
  });
});

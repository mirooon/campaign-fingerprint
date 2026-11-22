/**
 * Connected parts of a Louvain community (B-121): Louvain can return a community of two parts with no link
 * between them; each part must become its own campaign. Synthetic links only.
 */
import { describe, expect, it } from "vitest";
import { splitDisconnected } from "./cluster";
import type { ItemLink } from "./model";

const link = (a: string, b: string): ItemLink => ({ a, b, score: 0.5, strong: false, evidence: [] });

describe("splitting communities into connected parts", () => {
  it("makes two groups of a community whose two halves share no joining link", () => {
    expect(splitDisconnected([["a", "b", "c", "d"]], [link("a", "b"), link("c", "d")])).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("keeps a connected community whole and ignores links to members of other groups", () => {
    expect(splitDisconnected([["a", "b", "c"], ["x"]], [link("a", "b"), link("b", "c"), link("c", "x")])).toEqual([["a", "b", "c"], ["x"]]);
  });
});

import { describe, expect, it } from "vitest";
import { commentNameFactors } from "./commentNames";

const rules = { minBlocks: 5, floor: 0.3 };

describe("commentNameFactors", () => {
  // first names "anna", "jan", "piotr" recur in the blocks of many pages; the last block has rare, misspelled ones
  const blocks: Record<string, string[]> = {
    pospolity: ["anna testowa", "jan przykładowy", "piotr fikcyjny"],
    b2: ["anna zmyślona", "jan wymyślony", "ewa nieistniejąca"],
    b3: ["anna próbna", "piotr wzorcowy", "olga testowa"],
    b4: ["jan próbny", "piotr zmyślony", "marek fikcyjny"],
    b5: ["anna wzorcowa", "jan testowy", "piotr przykładowy"],
    rzadki: ["krzystof nowakk", "grażynka testowska", "zbyszko fikcyjnny"],
  };

  it("weighs a block of rare first names fully and a block of common ones less", () => {
    const f = commentNameFactors(blocks, rules);
    expect(f.get("rzadki")).toBe(1);
    expect(f.get("pospolity")!).toBeLessThan(0.6);
    expect(f.get("pospolity")!).toBeGreaterThanOrEqual(rules.floor);
    expect(f.get("pospolity")!).toBeLessThan(f.get("b2")!);
  });

  it("leaves every block whole when there are too few blocks to tell common names", () => {
    const few = Object.fromEntries(Object.entries(blocks).slice(0, 4));
    expect([...commentNameFactors(few, rules).values()].every((v) => v === 1)).toBe(true);
  });
});

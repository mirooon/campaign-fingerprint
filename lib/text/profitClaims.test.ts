import { describe, expect, it } from "vitest";
import { profitClaimKey, profitClaims } from "./profitClaims";

// Synthetic copy: fictional people and amounts.
describe("profit claims: amount + unit + period", () => {
  it("reads Polish thousands, currencies before and after, and the period", () => {
    const got = profitClaims("Nastolatek zarobił 3 tys. w ciągu dnia, a jego mama 4000 zł tygodniowo. Inni: €250 dziennie i 1 200 PLN/dzień.");
    expect(got.map(({ amount, currency, period }) => ({ amount, currency, period }))).toEqual([
      { amount: 3000, currency: null, period: "day" },
      { amount: 4000, currency: "PLN", period: "week" },
      { amount: 250, currency: "EUR", period: "day" },
      { amount: 1200, currency: "PLN", period: "day" },
    ]);
    expect(got[0].quote).toBe("3 tys. w ciągu dnia");
  });

  it("keeps a standard deposit in the attribute but out of the pivot key", () => {
    const got = profitClaims("Minimalny depozyt to 250 USD, a zysk 4 tys. w ciągu tygodnia.");
    expect(got.map((c) => [c.amount, c.currency, c.period, c.standard])).toEqual([
      [250, "USD", null, true],
      [4000, null, "week", false],
    ]);
    expect(profitClaimKey(got)).toBe("4000/week");
    expect(profitClaimKey(profitClaims("Wpłać tylko 250 USD i zacznij."))).toBeNull();
  });

  it("an amount without a period or a deposit is no claim", () => {
    expect(profitClaims("Cena 49 zł, dostawa 2 dni.")).toEqual([]);
    expect(profitClaims("Oddzwonimy w ciągu 24 godziny.")).toEqual([]);
  });
});

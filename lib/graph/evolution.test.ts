import { describe, expect, it } from "vitest";
import { campaignEvolution } from "./evolution";
import type { ItemPivot } from "./link";
import type { EntityType } from "./model";

const fact = (type: EntityType, key: string, relation = 1): ItemPivot => ({ pivot: `${type}:${key}`, type, path: [], relation, how: "" });

describe("campaignEvolution", () => {
  // three materials of one campaign: the same tracker and backend, three domains, two personas
  const pivots: Record<string, ItemPivot[]> = {
    m1: [fact("tracker", "ga4:G-TEST1"), fact("endpoint", "api.backend.test/lead"), fact("domain", "pierwsza.example"), fact("persona", "jan-przykladowy")],
    m2: [fact("tracker", "ga4:G-TEST1"), fact("endpoint", "api.backend.test/lead"), fact("domain", "druga.example"), fact("persona", "jan-przykladowy"), fact("domain", "wiki.example", 0.3)],
    m3: [fact("tracker", "ga4:G-TEST1"), fact("endpoint", "api.backend.test/lead"), fact("domain", "trzecia.test"), fact("persona", "anna-testowa")],
  };
  const firstSeen: Record<string, string | null> = { m1: "2026-03-01", m2: "2026-03-10", m3: "2026-04-02" };
  const label = (id: string) => id.slice(id.indexOf(":") + 1);

  it("splits the traits into ones shared by every material and ones that change, with the date of each new value", () => {
    const ev = campaignEvolution(["m1", "m2", "m3"], pivots, firstSeen, label);
    expect(ev.stable.map((g) => g.type)).toEqual(["endpoint", "tracker"]);
    expect(ev.changing.map((g) => [g.type, g.values.length])).toEqual([
      ["domain", 3],
      ["persona", 2],
    ]);
    expect(ev.changing[0].values.map((v) => [v.label, v.firstSeen, v.items])).toEqual([
      ["pierwsza.example", "2026-03-01", 1],
      ["druga.example", "2026-03-10", 1],
      ["trzecia.test", "2026-04-02", 1],
    ]);
    expect(ev.changing[1].values.map((v) => [v.label, v.firstSeen, v.items])).toEqual([
      ["jan-przykladowy", "2026-03-01", 2],
      ["anna-testowa", "2026-04-02", 1],
    ]);
    expect(ev.stable[1].values).toEqual([{ id: "tracker:ga4:G-TEST1", label: "ga4:G-TEST1", firstSeen: "2026-03-01", items: 3 }]);
  });

  it("leaves out indirect relations (an outbound link is not a trait of the campaign)", () => {
    const ev = campaignEvolution(["m1", "m2", "m3"], pivots, firstSeen, label);
    expect(ev.changing.flatMap((g) => g.values.map((v) => v.label))).not.toContain("wiki.example");
  });
});

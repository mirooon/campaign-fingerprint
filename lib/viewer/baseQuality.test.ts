import { describe, expect, it } from "vitest";
import type { GraphNode } from "@/lib/graph/model";
import type { CaseProvenance } from "./completeness";
import { baseQuality, QUALITY_CHECKS } from "./baseQuality";

const item = (key: string, data: Record<string, unknown> = {}, campaignId: string | null = null): GraphNode => ({ id: `item:${key}`, type: "item", key, label: key, df: 0, weight: null, strong: false, discounts: [], data, campaignId });

const withHar: CaseProvenance = { id: "a", caseId: "a", landingUrl: "https://a.example/", bodySource: "har", har: "ruch.har", screenshot: "z.png" };
const noHar: CaseProvenance = { id: "b", caseId: "b", landingUrl: "https://b.example/", bodySource: "saved-html", savedHtml: "s.html", screenshot: "z.png", har: null };
const noPage: CaseProvenance = { id: "c", caseId: "c", landingUrl: "https://c.example/", bodySource: "none", screenshot: "z.png", har: null };

describe("baseQuality", () => {
  it("liczy braki w całej bazie: sprawy bez HAR i bez strony", () => {
    const q = baseQuality({ provenance: [withHar, noHar, noPage], nodes: [item("a", {}, "K01"), item("b", {}, "K01"), item("c")] });
    expect(q.total).toBe(3);
    const by = Object.fromEntries(q.counts.map((c) => [c.check, c]));
    expect(by.har.missing).toBe(2);
    expect(by.page.missing).toBe(1);
    expect(by.screenshot.missing).toBe(0);
    expect(q.note).toBeNull();
  });
  it("wiersz ma pięć komórek ze stanem i tekstem „powód · skutek”", () => {
    const q = baseQuality({ provenance: [noPage], nodes: [item("c")] });
    expect(q.rows[0].cells.map((c) => c.check)).toEqual([...QUALITY_CHECKS]);
    const page = q.rows[0].cells.find((c) => c.check === "page")!;
    expect(page.status).toBe("missing");
    expect(page.text).toContain("Brak zapisanej strony");
    expect(q.rows[0].complete).toBe(false);
  });
  it("brak HAR przy zapisanej stronie jest opcjonalny i nie psuje kompletności", () => {
    const q = baseQuality({ provenance: [noHar], nodes: [item("b", { landingUrl: "https://b.example/" })] });
    const har = q.rows[0].cells.find((c) => c.check === "har")!;
    expect(har.status).toBe("missing");
    expect(har.optional).toBe(true);
  });
  it("baza bez provenance.json: oceniamy po danych materiałów i mówimy, czego brakuje do pełnej oceny", () => {
    const q = baseQuality({ provenance: null, nodes: [item("a", { landingUrl: "https://a.example/", domSimhash: "ab", imagePath: "x.png" })] });
    expect(q.total).toBe(1);
    expect(q.note).toContain("provenance.json");
    expect(q.rows[0].cells.find((c) => c.check === "screenshot")?.status).toBe("ok");
    expect(q.rows[0].cells.find((c) => c.check === "har")?.status).toBe("unknown");
  });
  it("sprawy niekompletne są na górze listy", () => {
    const q = baseQuality({ provenance: [withHar, noPage], nodes: [item("a"), item("c")] });
    expect(q.rows.map((r) => r.id)).toEqual(["c", "a"]);
  });
});

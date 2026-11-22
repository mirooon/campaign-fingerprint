import { describe, expect, it } from "vitest";
import type { EdgeType, EntityType, EvidenceGraph, GraphEdge, GraphNode } from "@/lib/graph/model";
import { campaignTimeline, evolutionRows, evolutionSentence, traitMatrix } from "./evolution";

type G = Pick<EvidenceGraph, "nodes" | "edges">;

function node(type: EntityType, key: string, over: Partial<GraphNode> = {}): GraphNode {
  return { id: `${type}:${key}`, type, key, label: key, df: 0, weight: 0.5, strong: false, discounts: [], data: {}, campaignId: null, ...over };
}
function edge(source: string, target: string, type: EdgeType): GraphEdge {
  return { id: `${type}|${source}|${target}`, source, target, type, weight: 1, evidence: "" };
}

/** Item with a landing page on `domain`, a tracker and optionally a persona: the way the backend wires them (item → url → host → domain, url → tracker, item → persona). */
function wire(nodes: GraphNode[], edges: GraphEdge[], id: string, firstSeen: string, domain: string, persona: string | null, tracker: string) {
  nodes.push(node("item", id, { data: { firstSeen } }));
  for (const n of [node("url", `https://${domain}/${id}`), node("host", domain)]) if (!nodes.some((x) => x.id === n.id)) nodes.push(n);
  for (const n of [node("domain", domain), node("tracker", tracker), ...(persona ? [node("persona", persona)] : [])]) if (!nodes.some((x) => x.id === n.id)) nodes.push(n);
  edges.push(edge(`item:${id}`, `url:https://${domain}/${id}`, "landing"), edge(`url:https://${domain}/${id}`, `host:${domain}`, "on_host"), edge(`host:${domain}`, `domain:${domain}`, "in_domain"), edge(`url:https://${domain}/${id}`, `tracker:${tracker}`, "uses_tracker"));
  if (persona) edges.push(edge(`item:${id}`, `persona:${persona}`, "mentions_persona"));
}

/** Three materials of one campaign: the domain and the person change with each, the tracker stays. */
function threeMaterials(): G {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  wire(nodes, edges, "m1", "2026-09-01T00:00:00.000Z", "pierwsza.test", "adam-testowy", "GA-1");
  wire(nodes, edges, "m2", "2026-09-05T00:00:00.000Z", "druga.test", "ewa-przykladowa", "GA-1");
  wire(nodes, edges, "m3", "2026-09-09T00:00:00.000Z", "trzecia.test", "jan-wymyslony", "GA-1");
  return { nodes, edges };
}

describe("evolutionRows", () => {
  it("pierwszy materiał otwiera kampanię, kolejne pokazują, co się zmieniło, a co zostało", () => {
    const rows = evolutionRows({ members: ["m3", "m1", "m2"] }, threeMaterials());
    expect(rows.map((r) => r.id)).toEqual(["m1", "m2", "m3"]);
    expect(rows[0].first).toBe(true);
    expect(rows[1].changed.map((c) => c.kind)).toEqual(["domena", "osoba"]);
    expect(rows[1].kept).toEqual(["tracker"]);
    expect(evolutionSentence(rows[1])).toBe("zmieniło się: domena, osoba; zostało: tracker");
    expect(evolutionSentence(rows[0])).toBe("początek kampanii");
  });
  it("zmiana niesie nową wartość, nie całą listę", () => {
    const rows = evolutionRows({ members: ["m1", "m2"] }, threeMaterials());
    expect(rows[1].changed[0]).toEqual({ kind: "domena", added: ["druga.test"] });
  });
  it("wartość znana z wcześniejszego materiału (nie tylko poprzedniego) nie jest zmianą", () => {
    const g = threeMaterials();
    wire(g.nodes, g.edges, "m4", "2026-09-12T00:00:00.000Z", "pierwsza.test", "adam-testowy", "GA-1");
    const row = evolutionRows({ members: ["m1", "m2", "m3", "m4"] }, g)[3];
    expect(row.changed).toEqual([]);
    expect(row.kept).toEqual(["domena", "osoba", "tracker"]);
    expect(evolutionSentence(row)).toBe("bez zmian; zostało: domena, osoba, tracker");
  });
  it("narracja z węzła materiału liczy się jak cecha", () => {
    const g = threeMaterials();
    const topic = (id: string) => ({ topics: [{ id, score: 2, terms: [] }], hooks: [] });
    g.nodes.find((n) => n.id === "item:m1")!.data.narrative = topic("investment");
    g.nodes.find((n) => n.id === "item:m2")!.data.narrative = topic("subsidy");
    const row = evolutionRows({ members: ["m1", "m2"] }, g)[1];
    expect(row.changed.map((c) => c.kind)).toContain("narracja");
    expect(row.changed.find((c) => c.kind === "narracja")?.added).toEqual(["dotacje i świadczenia"]);
  });
  it("łącze wychodzące (links_to) nie jest cechą kampanii", () => {
    const g = threeMaterials();
    g.nodes.push(node("domain", "cudza.test"));
    g.edges.push(edge("url:https://druga.test/m2", "domain:cudza.test", "links_to"));
    const row = evolutionRows({ members: ["m1", "m2"] }, g)[1];
    expect(row.changed[0].added).toEqual(["druga.test"]);
  });
  it("materiały bez daty idą na koniec", () => {
    const g = threeMaterials();
    g.nodes.find((n) => n.id === "item:m1")!.data.firstSeen = null;
    expect(evolutionRows({ members: ["m1", "m2", "m3"] }, g).map((r) => r.id)).toEqual(["m2", "m3", "m1"]);
  });
});

describe("campaignTimeline", () => {
  it("składa emisje, rejestracje domen i certyfikaty po kolei, z wiekiem domeny względem reklamy", () => {
    const g = threeMaterials();
    g.nodes.find((n) => n.id === "domain:druga.test")!.data.created = "2026-09-01T00:00:00.000Z";
    g.nodes.push(node("cert", "abc", { label: "cert", data: { notBefore: "2026-09-02T00:00:00.000Z", issuer: "Testowy CA" } }));
    g.edges.push(edge("domain:druga.test", "cert:abc", "has_cert"));
    const events = campaignTimeline({ members: ["m1", "m2", "m3"] }, g);
    expect(events.map((e) => e.kind)).toEqual(["registered", "ad", "cert", "ad", "ad"]);
    const reg = events.find((e) => e.kind === "registered")!;
    expect(reg.text).toContain("druga.test");
    expect(reg.text).toContain("domena zarejestrowana 4 dni przed emisją");
    expect(events.find((e) => e.kind === "cert")!.text).toContain("Testowy CA");
  });
  it("domena bez daty rejestracji nie daje zdarzenia", () => {
    expect(campaignTimeline({ members: ["m1"] }, threeMaterials()).map((e) => e.kind)).toEqual(["ad"]);
  });
});

describe("traitMatrix", () => {
  it("kolumny to ślady wspólne dla co najmniej dwóch materiałów, od najsilniejszych", () => {
    const g = threeMaterials();
    const tracker = g.nodes.find((n) => n.id === "tracker:GA-1")!;
    tracker.weight = 0.6;
    wire(g.nodes, g.edges, "m4", "2026-09-12T00:00:00.000Z", "druga.test", "ewa-przykladowa", "GA-1");
    g.nodes.find((n) => n.id === "domain:druga.test")!.weight = 0.9;
    g.nodes.find((n) => n.id === "domain:druga.test")!.strong = true;
    const m = traitMatrix({ members: ["m1", "m2", "m3", "m4"] }, g);
    expect(m.columns.map((c) => c.id)).toEqual(["domain:druga.test", "tracker:GA-1", "persona:ewa-przykladowa"]);
    expect(m.columns[0].count).toBe(2);
    expect(m.rows.find((r) => r.id === "m2")!.has).toEqual([true, true, true]);
    expect(m.rows.find((r) => r.id === "m1")!.has).toEqual([false, true, false]);
  });
  it("ogranicza liczbę kolumn i mówi, ile pominięto", () => {
    const m = traitMatrix({ members: ["m1", "m2", "m3"] }, threeMaterials(), 0);
    expect(m.columns).toEqual([]);
    expect(m.hidden).toBe(1);
  });
});

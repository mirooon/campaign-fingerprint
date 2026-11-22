/**
 * Traces shared by the ads of a campaign, for the facts of the evidence pack. The campaign record
 * keeps only its few strongest premises (`topEvidence`); an evidence pack needs all of them: a UTM
 * campaign shared by three ads or a series of domain registrations decides whether the institution
 * believes the campaign is one operator. Traces the weights discounted (a CDN's nameservers, a big
 * registrar) are listed apart with the reason, as "shared by many independent sites, does not link".
 * Pure functions over the link evidence of the graph.
 */
import type { EntityType, GraphNode, ItemLink } from "../graph/model";

export interface SharedTrace {
  type: EntityType;
  /** Raw value (domain, account, parameter=value ...). */
  value: string;
  /** Human-readable name as the graph shows it. */
  label: string;
  ads_with_identifier: number;
  /** The campaign's ads that hold the trace, sorted. */
  ads: string[];
  weight: number | null;
  strong: boolean;
  discount_reasons: string[];
}

export interface SharedTraces {
  /** Undiscounted traces shared by at least two ads: facts that link the ads. */
  identifiers: SharedTrace[];
  /** Discounted traces shared by at least two ads: shown for completeness, they do not link. */
  context: SharedTrace[];
}

/** Traces of the ads of one campaign shared by at least two of them, from the link evidence inside the campaign. */
export function sharedTraces(internal: ItemLink[], nodeById: Map<string, GraphNode>): SharedTraces {
  const holders = new Map<string, Set<string>>();
  const discounted = new Map<string, boolean>();
  for (const l of internal) {
    for (const ev of l.evidence) {
      if (ev.kind !== "pivot" || !ev.pivot) continue;
      const set = holders.get(ev.pivot) ?? new Set<string>();
      set.add(l.a);
      set.add(l.b);
      holders.set(ev.pivot, set);
      discounted.set(ev.pivot, (discounted.get(ev.pivot) ?? true) && ev.discounted);
    }
  }
  const members = new Set<string>();
  for (const l of internal) {
    members.add(l.a);
    members.add(l.b);
  }
  const all: Array<{ trace: SharedTrace; discounted: boolean }> = [];
  for (const [pivot, set] of holders) {
    const node = nodeById.get(pivot);
    if (!node || node.type === "item") continue;
    // an apex host repeats its registrable domain: keep the domain only
    if (node.type === "host" && holders.get(`domain:${node.key}`)?.size === set.size) continue;
    all.push({
      trace: {
        type: node.type,
        value: node.key,
        label: node.label,
        ads_with_identifier: set.size,
        ads: [...set].sort(),
        weight: node.weight,
        strong: node.strong,
        discount_reasons: node.discounts.map((d) => `${d.reason} (×${d.factor})`),
      },
      discounted: discounted.get(pivot) ?? false,
    });
  }
  const size = Math.max(1, members.size);
  const rank = (t: SharedTrace) => (t.ads_with_identifier / size) * (t.weight ?? 0);
  const sorted = all.sort((x, y) => rank(y.trace) - rank(x.trace) || x.trace.label.localeCompare(y.trace.label));
  return { identifiers: sorted.filter((t) => !t.discounted).map((t) => t.trace), context: sorted.filter((t) => t.discounted).map((t) => t.trace) };
}

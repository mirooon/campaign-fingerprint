/**
 * Confirmation of a CT candidate by the infrastructure of the campaign it resembles. A name that fits a campaign's
 * naming pattern is only a candidate; when its NS pair, registration hour, IP or page content are also the campaign's,
 * it is `confirmed`. Evidence is infrastructure only: the page title is not used (a title is easy to copy, and many
 * unrelated pages share one). Pure: the base data and the enrichment come in as arguments.
 */
import type { CampaignsFile } from "../graph/model";
import type { EnrichedDataset } from "../pipeline/types";
import { registrableDomain } from "../osint/urls";
import { CT_CONFIRM_CONFIG } from "./config";
import type { CandidateEnrichment } from "./feed";

/** What a campaign's domains in the base have in common, and that no other campaign's domains have. */
export interface CampaignInfra {
  campaignId: string;
  /** Pairs of name servers, sorted and joined by `|`. */
  nsPairs: string[];
  registrars: string[];
  /** Hours (UTC) in which the campaign's domains were registered; null when they spread too wide or are too few. */
  registrationHours: { from: number; to: number } | null;
  ips: string[];
  /** SHA-256 of the bodies of the campaign's pages. */
  pageHashes: string[];
}

/** Name server in comparison form: lower case, no trailing dot. */
const normNs = (n: string) => n.toLowerCase().replace(/\.$/, "");
/** One key for a set of name servers: normalised, de-duplicated, sorted, joined by `|`. */
const nsKey = (ns: string[]) => [...new Set(ns.map(normNs))].sort().join("|");

/**
 * Infrastructure of every campaign of the base: values (NS pair, registrar, IP, page hash) held by one campaign only,
 * and the window of registration hours of its domains. A value shared with another campaign (a registrar's default
 * name servers, a hosting IP) says nothing about the operator and is left out.
 */
export function buildCampaignInfra(ds: EnrichedDataset, campaigns: CampaignsFile): Map<string, CampaignInfra> {
  const perCampaign = campaigns.campaigns.map((c) => {
    const domains = new Set(c.domains);
    const ns = new Set<string>();
    const registrars = new Set<string>();
    const ips = new Set<string>();
    const hashes = new Set<string>();
    const hours: number[] = [];
    for (const d of domains) {
      const info = ds.domains[d];
      if (info?.ns.length) ns.add(nsKey(info.ns));
      if (info?.rdap?.registrar) registrars.add(info.rdap.registrar);
      const created = info?.rdap?.created ? Date.parse(info.rdap.created) : NaN;
      if (Number.isFinite(created)) hours.push(new Date(created).getUTCHours());
    }
    for (const h of Object.values(ds.hosts)) if (h.registrableDomain && domains.has(h.registrableDomain)) for (const ip of h.ips) ips.add(ip);
    for (const p of Object.values(ds.pages)) {
      const d = registrableDomain(p.requestedUrl);
      if (d && domains.has(d) && p.fetch.bodySha256) hashes.add(p.fetch.bodySha256);
    }
    return { id: c.id, ns, registrars, ips, hashes, hours };
  });
  /** True when another campaign holds the value. */
  const held = (pick: (c: (typeof perCampaign)[number]) => Set<string>, value: string, own: string) => perCampaign.some((c) => c.id !== own && pick(c).has(value));
  return new Map(
    perCampaign.map((c) => {
      /** Values of the campaign that no other campaign holds. */
      const only = (pick: (x: typeof c) => Set<string>) => [...pick(c)].filter((v) => !held(pick, v, c.id)).sort();
      const sorted = [...c.hours].sort((a, b) => a - b);
      const window = sorted.length >= 2 && sorted[sorted.length - 1] - sorted[0] <= CT_CONFIRM_CONFIG.maxHourSpan ? { from: sorted[0], to: sorted[sorted.length - 1] } : null;
      const infra: CampaignInfra = {
        campaignId: c.id,
        nsPairs: only((x) => x.ns),
        registrars: only((x) => x.registrars),
        registrationHours: window,
        ips: only((x) => x.ips),
        pageHashes: only((x) => x.hashes),
      };
      return [c.id, infra];
    }),
  );
}

/**
 * Which infrastructure of the campaign a candidate shares, as readable confirmations. `confirmed` when at least
 * `CT_CONFIRM_CONFIG.minKinds` different kinds match (one kind may be chance: a registrar, an hour). A candidate whose
 * lookups failed (null DNS, RDAP) simply has fewer kinds to match.
 */
export function confirmCandidate(e: CandidateEnrichment, infra: CampaignInfra): { confirmations: string[]; confirmed: boolean } {
  const confirmations: string[] = [];
  if (e.dns?.ns.length && infra.nsPairs.includes(nsKey(e.dns.ns))) confirmations.push(`same name server pair (${[...new Set(e.dns.ns.map(normNs))].sort().join(", ")})`);
  if (e.rdap?.registrar && infra.registrars.includes(e.rdap.registrar)) confirmations.push(`same registrar (${e.rdap.registrar})`);
  const created = e.rdap?.created ? Date.parse(e.rdap.created) : NaN;
  if (Number.isFinite(created) && infra.registrationHours) {
    const hour = new Date(created).getUTCHours();
    const lo = infra.registrationHours.from - CT_CONFIRM_CONFIG.hourMargin;
    const hi = infra.registrationHours.to + CT_CONFIRM_CONFIG.hourMargin;
    if (hour >= lo && hour <= hi) confirmations.push(`registered at ${hour}:00 UTC, within the campaign hour window (${lo}–${hi})`);
  }
  const ip = e.dns?.a.find((a) => infra.ips.includes(a));
  if (ip) confirmations.push(`same IP address (${ip})`);
  if (e.page?.body_sha256 && infra.pageHashes.includes(e.page.body_sha256)) confirmations.push("same page body hash (SHA-256)");
  return { confirmations, confirmed: confirmations.length >= CT_CONFIRM_CONFIG.minKinds };
}

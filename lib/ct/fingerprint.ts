/**
 * "Campaign fingerprints" for the Certificate Transparency watcher and the matcher that scores
 * a newly certified domain against them (early warning: a campaign's next domain often gets a
 * TLS certificate before any ad runs).
 *
 * Fingerprints per campaign, built from campaigns.json (and graph.json for ad texts):
 * - domain-name templates of the campaign's domains, TLD-specific and TLD-agnostic
 *   (`zwrot<n>-<lorem><n>.example`, `zwrot<n>-<lorem><n>.*`), see lib/osint/domainPattern.ts;
 * - the Lorem-style naming kit behind those templates (`<w><n>-<lorem><n>`), which catches the
 *   same generator used with a different anchor word;
 * - lexicon brands found in the campaign's domains or ads, and lexicon media names found in
 *   its domains;
 * - the campaign's distinctive domain words (words no other campaign uses).
 *
 * A candidate always needs a pattern: a template, the naming kit, a brand with campaign context
 * or a media name with a campaign word. A single common token never suffices. Pure functions.
 */
import { parse as parseDomain } from "tldts";
import type { CampaignsFile, EvidenceGraph } from "../graph/model";
import { domainTemplate, LOREM_WORDS, type DomainTemplate } from "../osint/domainPattern";
import { registrableDomain, toUnicodeHost } from "../osint/urls";
import { stemPolish } from "../text/persona";
import type { CtWatchConfig } from "./config";
import type { CtMatchKind } from "./labels";

export { MATCH_KIND_LABELS, type CtMatchKind } from "./labels";

export interface TemplateFingerprint {
  template: string;
  agnostic: boolean;
  /** Template with literal words replaced by <w>, e.g. "<w><n>-<lorem><n>.sbs". */
  skeleton: string;
  /** Contains both <lorem> and <n> (a Lorem-style naming kit). */
  lorem: boolean;
  domains: string[];
}

export interface CampaignFingerprint {
  campaignId: string;
  /** Short description for the feed and the UI (personas or first domains). */
  label: string;
  size: number;
  lastSeen: string | null;
  domains: string[];
  tlds: string[];
  templates: TemplateFingerprint[];
  /** Lexicon brands (normalised) used in the campaign's domains, ads or advertiser names. */
  brands: string[];
  /** Lexicon media names (normalised) present in the campaign's domain names. */
  media: string[];
  /** Domain words used by this campaign only. */
  tokens: string[];
  /** All words of the campaign's domain names. */
  labelWords: string[];
}

export interface FingerprintSet {
  config: CtWatchConfig;
  campaigns: CampaignFingerprint[];
  /** Domains of fingerprinted campaigns (already known, never reported). */
  knownDomains: Set<string>;
  /** Campaign domains left out of fingerprints (platforms, shorteners, public services). */
  excluded: string[];
  index: {
    specific: Map<string, Array<[CampaignFingerprint, TemplateFingerprint]>>;
    agnostic: Map<string, Array<[CampaignFingerprint, TemplateFingerprint]>>;
    skeletonSpecific: Map<string, Array<[CampaignFingerprint, TemplateFingerprint]>>;
    skeletonAgnostic: Map<string, Array<[CampaignFingerprint, TemplateFingerprint]>>;
    brands: Array<{ token: string; campaigns: CampaignFingerprint[] }>;
    media: Array<{ token: string; campaigns: CampaignFingerprint[] }>;
  };
}

export interface CtMatch {
  domain: string;
  campaignId: string;
  campaignLabel: string;
  score: number;
  kind: CtMatchKind;
  template: string | null;
  /** Campaign domains behind the matched fingerprint. */
  similarDomains: string[];
  /** Supporting tokens (lexicon words, campaign words). */
  tokens: string[];
  evidence: string[];
}

const KIND_RANK: Record<CtMatchKind, number> = { template: 5, template_other_tld: 4, brand: 3, media: 2, lorem_kit: 1 };

/** Higher score, then stronger kind, then more campaign domains behind it, then larger campaign. */
function isBetter(a: CtMatch, sizeA: number, b: CtMatch, sizeB: number): boolean {
  if (a.score !== b.score) return a.score > b.score;
  if (KIND_RANK[a.kind] !== KIND_RANK[b.kind]) return KIND_RANK[a.kind] > KIND_RANK[b.kind];
  if (a.similarDomains.length !== b.similarDomains.length) return a.similarDomains.length > b.similarDomains.length;
  return sizeA > sizeB;
}

/** Lower-case ASCII letters and digits only (diacritics folded, ł -> l). */
export function normalizeToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

function words(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-z]+/)
    .filter(Boolean);
}

/** True when the brand's words occur in a row in the text, tolerating Polish inflection ("Bałtycką Energię"). */
export function brandInText(brand: string, text: string): boolean {
  const stems = words(brand).map(stemPolish);
  if (!stems.length) return false;
  const tw = words(text);
  outer: for (let i = 0; i + stems.length <= tw.length; i++) {
    for (let j = 0; j < stems.length; j++) if (!tw[i + j].startsWith(stems[j])) continue outer;
    return true;
  }
  return false;
}

/** Replaces literal words of a template label with <w>; placeholders and separators stay. */
export function templateSkeleton(template: string): string {
  return template.replace(/<n>|<lorem>|\.\*$|[a-z]+/g, (m) => (m === "<n>" || m === "<lorem>" || m === ".*" ? m : "<w>"));
}

function skeletonOf(t: DomainTemplate): { specific: string; agnostic: string } {
  const labelTemplate = t.agnostic.slice(0, -2);
  const sk = templateSkeleton(labelTemplate);
  return { specific: `${sk}.${t.suffix}`, agnostic: `${sk}.*` };
}

function isLoremKit(template: string): boolean {
  return template.includes("<lorem>") && template.includes("<n>");
}

function listDomains(domains: string[], max = 3): string {
  return domains.length > max ? `${domains.slice(0, max).join(", ")} i ${domains.length - max} inne` : domains.join(", ");
}

export interface BuildFingerprintOptions {
  config: CtWatchConfig;
  /** Graph with item texts (optional): used to find lexicon brands in ad texts. */
  graph?: EvidenceGraph | null;
  /** Domains that are platforms/shorteners/public services (not campaign-owned). */
  isExcludedDomain?: (domain: string) => boolean;
  /** Minimum campaign size (singletons are unrelated ads). Default 2. */
  minSize?: number;
}

export function buildFingerprints(campaignsFile: CampaignsFile, opts: BuildFingerprintOptions): FingerprintSet {
  const cfg = opts.config;
  const stop = new Set(cfg.stopTokens.map(normalizeToken));
  const minSize = opts.minSize ?? 2;
  const excludedAll = new Set<string>();
  const textsByItem = new Map<string, string>();
  for (const n of opts.graph?.nodes ?? []) {
    if (n.type === "item" && typeof n.data.text === "string") textsByItem.set(n.key, n.data.text);
  }
  const brands = [...new Map(cfg.lexicon.brands.map((b) => [normalizeToken(b), b] as const)).entries()].filter(([token]) => token.length >= cfg.minBrandLength);
  const brandTokens = brands.map(([token]) => token);
  const mediaTokens = [...new Set(cfg.lexicon.media.map(normalizeToken).filter((m) => m.length >= 3))];

  const campaigns: CampaignFingerprint[] = [];
  for (const c of campaignsFile.campaigns) {
    if (c.size < minSize) continue;
    const domains = (c.domains ?? []).filter((d) => {
      const excluded = opts.isExcludedDomain?.(d) ?? false;
      if (excluded) excludedAll.add(d);
      return !excluded;
    });
    if (!domains.length) continue;
    const templates = new Map<string, TemplateFingerprint>();
    const tlds = new Set<string>();
    const labelWords = new Set<string>();
    const normLabels: string[] = [];
    for (const d of domains) {
      const parsed = parseDomain(d, { allowPrivateDomains: true });
      if (parsed.publicSuffix) tlds.add(parsed.publicSuffix);
      const label = parsed.domainWithoutSuffix ?? "";
      normLabels.push(normalizeToken(toUnicodeHost(label)));
      for (const w of words(toUnicodeHost(label))) labelWords.add(w);
      const t = domainTemplate(d);
      if (!t || t.literalChars < cfg.minTemplateLiteralChars) continue;
      const sk = skeletonOf(t);
      for (const [template, agnostic, skeleton] of [
        [t.specific, false, sk.specific],
        [t.agnostic, true, sk.agnostic],
      ] as const) {
        const cur = templates.get(template) ?? { template, agnostic, skeleton, lorem: isLoremKit(template), domains: [] };
        if (!cur.domains.includes(d)) cur.domains.push(d);
        templates.set(template, cur);
      }
    }
    // brands: in domain names (letters joined) or, inflected, in ad texts and advertiser names
    const texts = [...(c.advertisers ?? []), ...c.members.map((m) => textsByItem.get(m) ?? "")].join(" \n ");
    const personas = c.attributes?.personas?.map((p) => p.name) ?? [];
    campaigns.push({
      campaignId: c.id,
      label: personas.length ? personas.join(", ") : listDomains(domains, 2),
      size: c.size,
      lastSeen: c.lastSeen,
      domains,
      tlds: [...tlds].sort(),
      templates: [...templates.values()].map((t) => ({ ...t, domains: t.domains.sort() })),
      brands: brands.filter(([token, raw]) => normLabels.some((l) => l.includes(token)) || brandInText(raw, texts)).map(([token]) => token),
      media: mediaTokens.filter((m) => normLabels.some((l) => l.includes(m))),
      tokens: [],
      labelWords: [...labelWords].sort(),
    });
  }
  // distinctive words: used by exactly one fingerprinted campaign
  const owners = new Map<string, number>();
  for (const fp of campaigns) {
    for (const w of fp.labelWords) owners.set(w, (owners.get(w) ?? 0) + 1);
  }
  for (const fp of campaigns) {
    fp.tokens = fp.labelWords.filter((w) => owners.get(w) === 1 && w.length >= cfg.minCampaignTokenLength && !stop.has(w) && !LOREM_WORDS.has(w));
  }

  const index: FingerprintSet["index"] = {
    specific: new Map(),
    agnostic: new Map(),
    skeletonSpecific: new Map(),
    skeletonAgnostic: new Map(),
    brands: [],
    media: [],
  };
  const push = (m: Map<string, Array<[CampaignFingerprint, TemplateFingerprint]>>, key: string, v: [CampaignFingerprint, TemplateFingerprint]) => {
    const arr = m.get(key) ?? [];
    arr.push(v);
    m.set(key, arr);
  };
  for (const fp of campaigns) {
    for (const t of fp.templates) {
      push(t.agnostic ? index.agnostic : index.specific, t.template, [fp, t]);
      if (t.lorem) push(t.agnostic ? index.skeletonAgnostic : index.skeletonSpecific, t.skeleton, [fp, t]);
    }
  }
  for (const token of brandTokens) {
    const owners2 = campaigns.filter((fp) => fp.brands.includes(token));
    if (owners2.length) index.brands.push({ token, campaigns: owners2 });
  }
  for (const token of mediaTokens) {
    const owners2 = campaigns.filter((fp) => fp.media.includes(token));
    if (owners2.length) index.media.push({ token, campaigns: owners2 });
  }
  return {
    config: cfg,
    campaigns,
    knownDomains: new Set(campaigns.flatMap((fp) => fp.domains)),
    excluded: [...excludedAll].sort(),
    index,
  };
}

/** Registrable domain of a certificate name ("*.www.a.example." -> "a.example"); null for IPs. */
export function registrableOfName(name: string): string | null {
  const host = name.trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
  if (!host || host.includes("*")) return null;
  return registrableDomain(host);
}

interface DomainView {
  domain: string;
  t: DomainTemplate | null;
  label: string;
  suffix: string;
  norm: string;
  words: string[];
}

export interface MatchOptions {
  /** Return the best pattern match even when its score is below the threshold. */
  includeBelowThreshold?: boolean;
}

/** Scores one certificate name against the fingerprints; null when no pattern matches. */
export function matchDomain(name: string, set: FingerprintSet, opts: MatchOptions = {}): CtMatch | null {
  const cfg = set.config;
  const domain = registrableOfName(name);
  if (!domain || set.knownDomains.has(domain) || cfg.ignoreDomains.includes(domain)) return null;
  const parsed = parseDomain(domain, { allowPrivateDomains: true });
  const rawLabel = parsed.domainWithoutSuffix ?? "";
  if (!rawLabel || !parsed.publicSuffix) return null;
  const label = toUnicodeHost(rawLabel);
  const view: DomainView = { domain, t: domainTemplate(domain), label, suffix: parsed.publicSuffix, norm: normalizeToken(label), words: words(label) };

  const candidates = new Set<CampaignFingerprint>();
  if (view.t) {
    const sk = skeletonOf(view.t);
    for (const [m, key] of [
      [set.index.specific, view.t.specific],
      [set.index.agnostic, view.t.agnostic],
      [set.index.skeletonSpecific, sk.specific],
      [set.index.skeletonAgnostic, sk.agnostic],
    ] as const) {
      for (const [fp] of m.get(key) ?? []) candidates.add(fp);
    }
  }
  for (const b of set.index.brands) if (view.norm.includes(b.token)) b.campaigns.forEach((fp) => candidates.add(fp));
  for (const m of set.index.media) if (view.norm.includes(m.token)) m.campaigns.forEach((fp) => candidates.add(fp));

  let best: CtMatch | null = null;
  let bestSize = 0;
  for (const fp of candidates) {
    const m = scoreCampaign(fp, view, set);
    if (m && (!best || isBetter(m, fp.size, best, bestSize))) {
      best = m;
      bestSize = fp.size;
    }
  }
  if (!best) return null;
  return best.score >= cfg.threshold || opts.includeBelowThreshold ? best : null;
}

function scoreCampaign(fp: CampaignFingerprint, d: DomainView, set: FingerprintSet): CtMatch | null {
  const cfg = set.config;
  const s = cfg.scores;
  let base = 0;
  let kind: CtMatchKind | null = null;
  let template: string | null = null;
  let similar: string[] = [];
  const evidence: string[] = [];
  const used = new Set<string>();

  if (d.t) {
    const spec = fp.templates.find((x) => !x.agnostic && x.template === d.t!.specific);
    const agn = fp.templates.find((x) => x.agnostic && x.template === d.t!.agnostic);
    if (spec) {
      base = s.template + (spec.domains.length >= 2 ? s.supportBonus : 0);
      kind = "template";
      template = spec.template;
      similar = spec.domains;
      evidence.push(`nazwa pasuje do szablonu ${spec.template} kampanii ${fp.campaignId} (${listDomains(spec.domains)})`);
    } else if (agn) {
      base = s.templateOtherTld + (agn.domains.length >= 2 ? s.supportBonus : 0);
      kind = "template_other_tld";
      template = agn.template;
      similar = agn.domains;
      evidence.push(`ten sam szablon nazwy ${agn.template} w innej domenie najwyższego poziomu (.${d.suffix}); kampania ${fp.campaignId}: ${listDomains(agn.domains)}`);
    } else if (isLoremKit(d.t.specific) && d.t.literalChars >= cfg.minTemplateLiteralChars) {
      const sk = skeletonOf(d.t);
      const same = fp.templates.find((x) => x.lorem && !x.agnostic && x.skeleton === sk.specific);
      const other = fp.templates.find((x) => x.lorem && x.agnostic && x.skeleton === sk.agnostic);
      const hit = same ?? other;
      if (hit) {
        base = same ? s.loremKit : s.loremKitOtherTld;
        kind = "lorem_kit";
        template = hit.template;
        similar = hit.domains;
        evidence.push(`ten sam generator nazw (${same ? sk.specific : sk.agnostic}) co szablon ${hit.template} kampanii ${fp.campaignId}, inne słowo kotwicy (${listDomains(hit.domains)})`);
      }
    }
    // literal words of a matched template are part of the pattern, not extra support
    if (kind) for (const w of words(d.t.specific.replace(/<n>|<lorem>/g, " "))) used.add(w);
  }

  if (base < s.brand) {
    for (const b of fp.brands) {
      if (!d.norm.includes(b)) continue;
      const rest = d.norm.split(b).join(" ");
      const restWords = rest.split(/[^a-z]+/).filter(Boolean);
      const variantOnly = restWords.every((w) => fp.labelWords.includes(w));
      const campaignWord = d.words.find((w) => !b.includes(w) && fp.tokens.includes(w));
      const sameTld = fp.tlds.includes(d.suffix);
      const why = variantOnly
        ? "reszta nazwy to cyfry lub słowa z domen kampanii"
        : campaignWord
          ? `zawiera też słowo kampanii „${campaignWord}”`
          : sameTld
            ? `ta sama domena najwyższego poziomu (.${d.suffix})`
            : null;
      if (!why) continue;
      base = s.brand;
      kind = "brand";
      template = null;
      similar = fp.domains.filter((x) => normalizeToken(x).includes(b));
      evidence.length = 0;
      evidence.push(`nazwa zawiera markę z leksykonu „${b}”, używaną przez kampanię ${fp.campaignId}; ${why}`);
      used.add(b);
      if (campaignWord) used.add(campaignWord);
      break;
    }
  }

  if (base < s.media) {
    for (const m of fp.media) {
      if (!d.norm.includes(m)) continue;
      const campaignWord = d.words.find((w) => !m.includes(w) && !w.includes(m) && fp.tokens.includes(w));
      if (!campaignWord) continue;
      base = s.media;
      kind = "media";
      template = null;
      similar = fp.domains.filter((x) => normalizeToken(x).includes(m));
      evidence.length = 0;
      evidence.push(`nazwa podszywa się pod medium „${m}” (jak ${listDomains(similar)}) i zawiera słowo kampanii ${fp.campaignId} „${campaignWord}”`);
      used.add(m);
      used.add(campaignWord);
      break;
    }
  }

  if (!kind) return null;
  const lexiconTokens = [...cfg.lexicon.lures, ...cfg.lexicon.institutions, ...cfg.lexicon.media].map(normalizeToken).filter((t) => t.length >= 3);
  const support = [
    ...new Set([...lexiconTokens.filter((t) => d.norm.includes(t)), ...d.words.filter((w) => fp.tokens.includes(w))]),
  ].filter((t) => ![...used].some((u) => u.includes(t) || t.includes(u)));
  const tokens = support.slice(0, 2);
  if (tokens.length) evidence.push(`słowa wspierające: ${tokens.join(", ")}`);
  return {
    domain: d.domain,
    campaignId: fp.campaignId,
    campaignLabel: fp.label,
    score: Math.min(0.99, Math.round((base + tokens.length * s.tokenBonus) * 100) / 100),
    kind,
    template,
    similarDomains: similar,
    tokens,
    evidence,
  };
}

/**
 * crt.sh search patterns derived from the fingerprints' templates: the literal prefix plus "%"
 * ("zwrot<n>-<lorem><n>.example" -> "zwrot%"). crt.sh does not accept "%" in the middle of a
 * pattern, so the TLD and the rest of the template are checked locally by the matcher.
 */
export function backfillPatterns(set: FingerprintSet): string[] {
  const out = new Set<string>();
  for (const fp of set.campaigns) {
    for (const t of fp.templates) {
      const anchor = t.template.match(/^[a-z][a-z0-9-]*?(?=<|\.)/)?.[0]?.replace(/-+$/, "");
      if (!anchor || anchor.replace(/-/g, "").length < Math.max(3, set.config.minTemplateLiteralChars)) continue;
      out.add(`${anchor}%`);
    }
  }
  return [...out].sort();
}

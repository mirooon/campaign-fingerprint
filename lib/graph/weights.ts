/**
 * Pivot weighting: prior specificity of the entity type, deny/weak list factors
 * for ubiquitous infrastructure, and an inverse-frequency (IDF) factor.
 *
 *   weight(e) = typeWeight(type) x min(listFactors(e)) x idf(df(e), N)
 *   strong(e) = typeWeight x listFactor >= strongThreshold  and  df <= min(maxStrongDfRatio x N, maxStrongDf)
 *
 * Only strong pivots feed union-find; everything else is a weighted edge for Louvain.
 */
import { CidrList } from "../osint/ip";
import { registrableDomain } from "../osint/urls";
import type { LinkConfig, ListRule } from "./config";
import type { Discount, EntityType } from "./model";

export interface PivotDescriptor {
  type: EntityType;
  key: string;
  id: string;
  data: Record<string, unknown>;
}

function suffixMatch(value: string, suffix: string): boolean {
  const v = value.toLowerCase();
  const s = suffix.toLowerCase().replace(/^\./, "");
  return v === s || v.endsWith(`.${s}`) || (!s.includes(".") && v.includes(s));
}

function firstRule(rules: ListRule[], test: (r: ListRule) => boolean): ListRule | null {
  let best: ListRule | null = null;
  for (const r of rules) if (test(r) && (!best || r.factor < best.factor)) best = r;
  return best;
}

function compileRules(rules: ListRule[]): Array<{ rule: ListRule; re: RegExp }> {
  return rules.map((rule) => ({ rule, re: new RegExp(rule.match, "iu") }));
}

function firstRegexRule(rules: Array<{ rule: ListRule; re: RegExp }>, value: string): ListRule | null {
  let best: ListRule | null = null;
  for (const { rule, re } of rules) if (re.test(value) && (!best || rule.factor < best.factor)) best = rule;
  return best;
}

export class Discounter {
  private cidrs: CidrList<{ factor: number; reason: string }>;
  private parking: RegExp[];
  private assetRules: Array<{ rule: ListRule; re: RegExp }>;
  private commentRules: Array<{ rule: ListRule; re: RegExp }>;
  private hiddenGeneric: Set<string>;

  constructor(private config: LinkConfig) {
    this.cidrs = new CidrList(config.lists.ipCidrs.map((r) => ({ cidr: r.cidr, data: { factor: r.factor, reason: r.reason } })));
    this.parking = config.lists.parkingPatterns.map((p) => new RegExp(p, "i"));
    this.assetRules = compileRules(config.lists.assetLibraries);
    this.commentRules = compileRules(config.lists.commentPatterns);
    this.hiddenGeneric = new Set(config.lists.hiddenFieldGeneric.map((n) => n.toLowerCase()));
  }

  /** Hidden input names that are not generic (CSRF tokens, form-service keys ...). */
  specificHiddenFields(names: string[]): string[] {
    return [...new Set(names.map((n) => n.toLowerCase()))].filter((n) => !this.hiddenGeneric.has(n)).sort();
  }

  /**
   * Discount for a registrable domain: platforms, shorteners, CDNs (lists.domains) and public
   * form/analytics/geolocation services (lists.endpointHosts) — the most restrictive rule wins.
   */
  domainDiscount(domain: string | null | undefined): Discount | null {
    if (!domain) return null;
    const rule = firstRule(this.config.lists.domains, (r) => suffixMatch(domain, r.match));
    const service = firstRule(this.config.lists.endpointHosts, (r) => suffixMatch(domain, r.match));
    if (rule && (!service || rule.factor <= service.factor)) return { reason: rule.reason, factor: rule.factor, rule: `domains:${rule.match}` };
    if (service) return { reason: service.reason, factor: service.factor, rule: `endpointHosts:${service.match}` };
    return null;
  }

  /**
   * Rule of `lists.accountSiteSuffixes` for a host that is one account's site on a free hosting platform
   * ("lib-x.netlify.app"), or null (also for the platform's own apex, which is not an account's site).
   */
  accountSite(host: string): ListRule | null {
    const h = host.toLowerCase();
    return firstRule(this.config.lists.accountSiteSuffixes ?? [], (r) => h !== r.match.toLowerCase() && suffixMatch(h, r.match));
  }

  /** Rule of `lists.browserHosts` for a host the browser or its extensions contact on their own, or null. */
  browserHost(host: string): ListRule | null {
    return firstRule(this.config.lists.browserHosts ?? [], (r) => suffixMatch(host, r.match));
  }

  ipDiscounts(ip: string, asns: number[]): Discount[] {
    const out: Discount[] = [];
    const hit = this.cidrs.match(ip);
    if (hit) out.push({ reason: hit.data.reason, factor: hit.data.factor, rule: `ipCidrs:${hit.cidr}` });
    for (const asn of asns) {
      const r = this.config.lists.asns.find((a) => a.asn === asn);
      if (r && r.ipFactor < 1) out.push({ reason: r.reason, factor: r.ipFactor, rule: `asns:${asn}` });
    }
    return out;
  }

  isParked(texts: Array<string | null | undefined>): boolean {
    const blob = texts.filter(Boolean).join(" \n ").slice(0, 4000);
    return blob.length > 0 && this.parking.some((re) => re.test(blob));
  }

  /** All list-based discounts for a pivot entity. */
  discountsFor(p: PivotDescriptor): Discount[] {
    const out: Discount[] = [];
    const lists = this.config.lists;
    const exact = lists.pivots.find((r) => r.match === p.id || r.match === p.key);
    if (exact) out.push({ reason: exact.reason, factor: exact.factor, rule: `pivots:${exact.match}` });

    switch (p.type) {
      case "url":
      case "host":
      case "domain": {
        const d = this.domainDiscount((p.data.registrableDomain as string | null) ?? (p.type === "domain" ? p.key : null));
        if (d) out.push(d);
        break;
      }
      case "ip":
        out.push(...this.ipDiscounts(p.key, (p.data.asns as number[] | undefined) ?? []));
        break;
      case "asn": {
        const asn = Number(p.key.replace(/^AS/i, ""));
        const r = lists.asns.find((a) => a.asn === asn);
        if (r) out.push({ reason: r.reason, factor: r.factor, rule: `asns:${asn}` });
        break;
      }
      case "nameserver": {
        const hosts = (p.data.nameservers as string[] | undefined) ?? p.key.split(" + ");
        const matches = hosts.map((h) => firstRule(lists.nameserverSuffixes, (r) => suffixMatch(h, r.match)));
        // Only when every NS of the set is a mass provider: a custom NS stays specific.
        if (matches.length && matches.every((m) => m)) {
          const loosest = matches.reduce((a, b) => (a!.factor >= b!.factor ? a : b))!;
          out.push({ reason: loosest.reason, factor: loosest.factor, rule: `nameserverSuffixes:${loosest.match}` });
        }
        break;
      }
      case "mx": {
        const hosts = (p.data.mx as string[] | undefined) ?? p.key.split(" + ");
        const matches = hosts.map((h) => firstRule(lists.mxSuffixes ?? [], (r) => suffixMatch(h, r.match)));
        // Only when every MX of the set is a shared provider: an own mail server stays specific.
        if (matches.length && matches.every((m) => m)) {
          const loosest = matches.reduce((a, b) => (a!.factor >= b!.factor ? a : b))!;
          out.push({ reason: loosest.reason, factor: loosest.factor, rule: `mxSuffixes:${loosest.match}` });
        }
        break;
      }
      case "registrar": {
        const name = String(p.data.registrar ?? p.key).toLowerCase();
        const r = firstRule(lists.registrars, (rule) => name.includes(rule.match.toLowerCase()));
        if (r) out.push({ reason: r.reason, factor: r.factor, rule: `registrars:${r.match}` });
        break;
      }
      case "cert": {
        const issuer = String(p.data.issuer ?? "").toLowerCase();
        const r = firstRule(lists.certIssuers, (rule) => issuer.includes(rule.match.toLowerCase()));
        if (r) out.push({ reason: r.reason, factor: r.factor, rule: `certIssuers:${r.match}` });
        const sans = (p.data.sanDomains as string[] | undefined) ?? [];
        const marker = firstRule(lists.certSanMarkers, (rule) => sans.some((s) => suffixMatch(s, rule.match)));
        if (marker) out.push({ reason: marker.reason, factor: marker.factor, rule: `certSanMarkers:${marker.match}` });
        const domainCount = Number(p.data.sanRegistrableCount ?? 0);
        if (domainCount > this.config.maxCertDomains) {
          out.push({
            reason: `certyfikat obejmuje ${domainCount} różnych domen (współdzielony)`,
            factor: 0.05,
            rule: "maxCertDomains",
          });
        }
        break;
      }
      case "endpoint": {
        const host = String(p.data.host ?? "");
        const hasClient = typeof p.data.clientId === "string" && p.data.clientId !== "";
        // One client of a shared service (form ID, account key, bot ID) names that client, whatever the
        // host: the host-level discounts (form services, platforms, multi-client services) do not apply.
        if (!hasClient) {
          const svc = firstRule(lists.endpointHosts, (r) => suffixMatch(host, r.match));
          if (svc) out.push({ reason: svc.reason, factor: svc.factor, rule: `endpointHosts:${svc.match}` });
          const d = this.domainDiscount(registrableDomain(host));
          if (d) out.push(d);
          if (p.data.sameOrigin !== true) {
            const mt = firstRule(lists.multiTenantBackends ?? [], (r) => suffixMatch(host, r.match));
            if (mt) out.push({ reason: mt.reason, factor: mt.factor, rule: `multiTenantBackends:${mt.match}` });
          }
        }
        const pathTemplate = String(p.data.pathTemplate ?? "");
        const sdk = platformPathRule(lists.endpointPlatformPaths, pathTemplate);
        if (sdk) out.push({ reason: sdk.reason, factor: sdk.factor, rule: `endpointPlatformPaths:${sdk.match}` });
        if (p.data.sameOrigin === true) {
          out.push({
            reason: "ścieżka na tej samej domenie co strona (odcisk szablonu, nie osobny backend)",
            factor: this.config.kit.sameOriginEndpointFactor,
            rule: "kit.sameOriginEndpointFactor",
          });
          const generic = lists.endpointGenericPaths.find((r) => r.match === pathTemplate);
          if (generic) out.push({ reason: generic.reason, factor: generic.factor, rule: `endpointGenericPaths:${generic.match}` });
          else if (pathTemplate.split("/").filter(Boolean).length <= 2) {
            out.push({
              reason: "krótka ścieżka względna (mało charakterystyczna)",
              factor: this.config.kit.shortEndpointPathFactor,
              rule: "kit.shortEndpointPathFactor",
            });
          }
        }
        break;
      }
      case "asset": {
        const lib = firstRegexRule(this.assetRules, String(p.data.basename ?? ""));
        if (lib) out.push({ reason: lib.reason, factor: lib.factor, rule: `assetLibraries:${lib.match}` });
        const sdk = platformPathRule(lists.endpointPlatformPaths, String(p.data.path ?? ""));
        if (sdk) out.push({ reason: sdk.reason, factor: sdk.factor, rule: `endpointPlatformPaths:${sdk.match}` });
        if (p.data.sameOrigin !== true) {
          const d = this.domainDiscount(registrableDomain(String(p.data.host ?? "")));
          if (d) out.push(d);
          const mt = firstRule(lists.multiTenantBackends ?? [], (r) => suffixMatch(String(p.data.host ?? ""), r.match));
          if (mt) out.push({ reason: mt.reason, factor: mt.factor, rule: `multiTenantBackends:${mt.match}` });
        }
        break;
      }
      case "favicon": {
        const brand = p.data.impersonatedBrand;
        if (typeof brand === "string" && brand) {
          out.push({
            reason: `favicon podrabianej marki „${brand}” (cecha marki, pod którą się podszywają, nie operatora)`,
            factor: this.config.kit.brandAssetFactor,
            rule: "kit.brandAssetFactor",
          });
        }
        break;
      }
      case "comment": {
        const rule = firstRegexRule(this.commentRules, String(p.data.text ?? p.key));
        if (rule) out.push({ reason: rule.reason, factor: rule.factor, rule: `commentPatterns:${rule.match}` });
        break;
      }
      case "domain_pattern": {
        if (Number(p.data.literalChars ?? Number.POSITIVE_INFINITY) < this.config.kit.domainPatternMinLiteralChars) {
          out.push({
            reason: "wzorzec bez rdzenia literowego (np. <lorem>-<lorem>.top): generator nazw platformy stron, wspólny dla jej najemców, i łatwa przypadkowa zbieżność",
            factor: this.config.kit.domainPatternNoAnchorFactor,
            rule: "kit.domainPatternMinLiteralChars",
          });
        }
        if (p.data.agnostic === true) {
          out.push({ reason: "wariant wzorca bez TLD (słabszy)", factor: this.config.kit.domainPatternAgnosticFactor, rule: "kit.domainPatternAgnosticFactor" });
        }
        break;
      }
      case "cname_target": {
        const targets = [p.key, ...((p.data.targets as string[] | undefined) ?? [])];
        const rule = firstRule(lists.cnameTargets, (r) => targets.some((t) => suffixMatch(t, r.match)));
        if (rule) out.push({ reason: rule.reason, factor: rule.factor, rule: `cnameTargets:${rule.match}` });
        const d = this.domainDiscount(p.key);
        if (d) out.push(d);
        break;
      }
      case "path_id": {
        const prefix = String(p.data.prefix ?? "").toLowerCase();
        const rule = firstRule(lists.pathIdSharedPrefixes ?? [], (r) => prefix.startsWith(r.match.toLowerCase()));
        if (rule) out.push({ reason: rule.reason, factor: rule.factor, rule: `pathIdSharedPrefixes:${rule.match}` });
        break;
      }
      case "company_id":
      case "bank_account": {
        // an intermediary (payment operator, courier, shop platform) named in the footers of many unrelated shops
        const rule = firstRule(lists.companyIdIntermediaries ?? [], (r) => r.match === p.key);
        if (rule) out.push({ reason: rule.reason, factor: rule.factor, rule: `companyIdIntermediaries:${rule.match}` });
        break;
      }
      case "postal_address": {
        // a virtual office or an intermediary that gives its address to many unrelated shops
        const rule = firstRule(lists.postalAddressExclusions ?? [], (r) => r.match === p.key);
        if (rule) out.push({ reason: rule.reason, factor: rule.factor, rule: `postalAddressExclusions:${rule.match}` });
        break;
      }
      case "param_schema": {
        // The link format of a tracker product (e.g. "/click?key=<32 hex>"): a trait of the platform type
        const parts = String(p.data.schema ?? p.key).split("|");
        const rule = firstRule(lists.paramSchemaPlatformParts ?? [], (r) => parts.includes(r.match));
        if (rule) out.push({ reason: rule.reason, factor: rule.factor, rule: `paramSchemaPlatformParts:${rule.match}` });
        break;
      }
      case "campaign_param": {
        if (p.data.scamBrand === true) {
          // the scam's own brand: only the list of generic platform names applies, not the parameter-value rules
          const key = String(p.data.key ?? p.key.replace(/^scam_brand=/, ""));
          const rule = firstRule(lists.genericScamBrands ?? [], (r) => (r.match.endsWith("*") ? key.startsWith(r.match.slice(0, -1)) : key === r.match));
          if (rule) out.push({ reason: rule.reason, factor: rule.factor, rule: `genericScamBrands:${key}` });
          break;
        }
        const name = String(p.data.canonicalName ?? "");
        const value = String(p.data.value ?? "").trim().toLowerCase();
        // a number scoped by the tracker server (kit.machineScopedParams) is no coincidence, however short
        const byMachine = typeof p.data.machine === "string";
        if (lists.campaignParamGenericValues.includes(value)) {
          out.push({ reason: `ogólna wartość parametru („${value}”)`, factor: 0.05, rule: "campaignParamGenericValues" });
        } else if (value.length < 3 && !byMachine) {
          out.push({ reason: "zbyt krótka wartość parametru", factor: 0.05, rule: "campaignParam:short" });
        } else if (/^\d{1,4}$/.test(value) && !byMachine) {
          out.push({ reason: "krótka wartość liczbowa (np. 1, 42)", factor: 0.1, rule: "campaignParam:smallNumber" });
        } else if (p.data.macro === true) {
          out.push({ reason: "nierozwinięte makro szablonu (wspólne dla wielu reklamodawców)", factor: 0.1, rule: "campaignParam:macro" });
        } else if (/^\p{L}[\p{L} -]{2,24}$/u.test(value)) {
          out.push({
            reason: "wartość słowna (może się powtarzać u niezwiązanych reklamodawców)",
            factor: this.config.kit.campaignParamWordFactor,
            rule: "kit.campaignParamWordFactor",
          });
        }
        const weak = lists.campaignParamWeakNames.find((r) => r.match === name);
        if (weak) out.push({ reason: weak.reason, factor: weak.factor, rule: `campaignParamWeakNames:${weak.match}` });
        break;
      }
      default:
        break;
    }
    // Several rules can say the same thing (e.g. Cloudflare by CIDR and by ASN): keep one per reason.
    const byReason = new Map<string, Discount>();
    for (const d of out) {
      const cur = byReason.get(d.reason);
      if (!cur || d.factor < cur.factor) byReason.set(d.reason, cur ? { ...d, rule: `${cur.rule}, ${d.rule}` } : d);
    }
    return [...byReason.values()];
  }
}

/**
 * Rule of `lists.endpointPlatformPaths` matching a path: a rule ending in "/" is a prefix, any other
 * rule matches the path itself or a path below it ("/click" matches "/click" and "/click/x", not "/clicks").
 */
export function platformPathRule(rules: ListRule[], path: string): ListRule | null {
  const p = path.toLowerCase();
  return firstRule(rules, (r) => {
    const m = r.match.toLowerCase();
    return m.endsWith("/") ? p.startsWith(m) : p === m || p.startsWith(`${m}/`);
  });
}

export function listFactor(discounts: Discount[]): number {
  return discounts.reduce((m, d) => Math.min(m, d.factor), 1);
}

/**
 * Smoothed inverse document frequency normalised so that df = 2 gives 1 and
 * df = N gives the floor: (1 + ln(N/df)) / (1 + ln(N/2)).
 */
export function idfFactor(df: number, n: number, floor = 0.2): number {
  if (n <= 2 || df <= 2) return 1;
  const v = (1 + Math.log(n / df)) / (1 + Math.log(n / 2));
  return Math.max(floor, Math.min(1, v));
}

/**
 * Penalty for entities present in most items: 1 up to `start` (share of items), then linear
 * down to 0.1 at 100%. Not applied to small datasets (< minItems).
 */
export function ubiquityFactor(df: number, n: number, start = 0.5, minItems = 10): number {
  if (n < minItems || n === 0) return 1;
  const ratio = df / n;
  if (ratio <= start) return 1;
  return Math.max(0.1, (1 - ratio) / (1 - start));
}

export interface PivotWeight {
  base: number;
  listFactor: number;
  idf: number;
  ubiquity: number;
  weight: number;
  strong: boolean;
}

/**
 * Weight of a pivot shared by `df` of `n` items: base (type weight or override) × list factor × IDF ×
 * ubiquity, and whether it is strong (feeds union-find): base × list factor reaches strongThreshold and df
 * stays within both the share limit (maxStrongDfRatio × n) and the absolute limit (maxStrongDf).
 */
export function pivotWeight(
  type: EntityType,
  discounts: Discount[],
  df: number,
  n: number,
  config: LinkConfig,
  baseOverride?: number,
): PivotWeight {
  const base = baseOverride ?? config.typeWeights[type] ?? 0;
  const lf = listFactor(discounts);
  const idf = config.idf.enabled ? idfFactor(df, n, config.idf.floor) : 1;
  const ubiquity = config.idf.enabled ? ubiquityFactor(df, n, config.idf.ubiquityStart, config.idf.ubiquityMinItems) : 1;
  const weight = base * lf * idf * ubiquity;
  const byRatio = Math.max(2, Math.floor(config.maxStrongDfRatio * n));
  const maxStrongDf = config.maxStrongDf ? Math.min(byRatio, Math.max(2, config.maxStrongDf)) : byRatio;
  const strong = base * lf >= config.strongThreshold && df <= maxStrongDf && !(config.nonStrongTypes ?? []).includes(type);
  return { base, listFactor: lf, idf, ubiquity, weight, strong };
}

/** Noisy-OR combination of independent evidence weights. */
export function combineScores(weights: number[]): number {
  let p = 1;
  for (const w of weights) p *= 1 - Math.max(0, Math.min(1, w));
  return 1 - p;
}

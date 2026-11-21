/**
 * Builds the evidence graph from enriched items.
 *
 * For every item we walk its enrichment (landing URL -> redirect chain -> hosts ->
 * IPs -> ASNs; domains -> NS set / registrar / certificates; page -> trackers,
 * favicon, contacts, wallets; ad copy -> contacts, wallets; image -> dHash) and
 * record each reachable entity as a "pivot" together with the node path that leads
 * to it. Items sharing a pivot get pair evidence weighted by weights.ts; image and
 * text similarity add item-item evidence. Pair evidence is combined (noisy-OR)
 * into ItemLinks that clustering consumes.
 */
import { fingerprintSimilarity } from "../media/audioFp";
import { speakerSimilarity } from "../media/speaker";
import { hammingDistance } from "../media/imageHash";
import { paramSchema } from "../osint/campaignParams";
import { clickIdsFromUrls } from "../osint/clickIds";
import { stripUiChrome } from "../text/uiChrome";
import { domainTemplate, type DomainTemplate } from "../osint/domainPattern";
import { simhashDistance } from "../osint/pagekit";
import { normalizeUrl, registrableDomain, toUnicodeHost } from "../osint/urls";
import type { EnrichedDataset, Item } from "../pipeline/types";
import { cosineDense, cosineSparse, fitTfidf, type SparseVector } from "../text/similarity";
import { DEFAULT_LINK_CONFIG, type LinkConfig } from "./config";
import {
  CREATIVE_FILE_PREFIX,
  ENTITY_TYPES,
  nodeId,
  type EdgeType,
  type EntityType,
  type EvidenceGraph,
  type GraphEdge,
  type GraphNode,
  type ItemLink,
  type PairEvidence,
  type SimilarityEdgeType,
} from "./model";
import { combineScores, Discounter, pivotWeight } from "./weights";

export interface BuildGraphOptions {
  config?: LinkConfig;
  /** Dense embeddings per item id; when given, used instead of TF-IDF. */
  embeddings?: Record<string, number[]>;
  /** Disable text similarity entirely. */
  textMethod?: "tfidf" | "embedding" | "none";
  /** Also return each item's reachable pivots (used by the live "analyze" endpoint). */
  includeItemPivots?: boolean;
  now?: () => Date;
}

export interface ItemPivot {
  pivot: string;
  type: EntityType;
  path: string[];
  relation: number;
  how: string;
}

/** Relation multiplier: 1 for hosting/direct, lower for outbound links or parked pages. */
type Fact = ItemPivot;

const TRACKER_LABELS: Record<string, string> = {
  ga4: "Google Analytics 4",
  ua: "Universal Analytics",
  gtm: "Google Tag Manager",
  google_ads: "Google Ads",
  meta_pixel: "Meta Pixel",
  tiktok_pixel: "TikTok Pixel",
  yandex_metrica: "Yandex Metrica",
};

const TECHNIQUE_LABELS: Record<string, string> = {
  fake_app_store: "udawany sklep z aplikacjami",
  back_trap: "pułapka przycisku „wstecz”",
  fake_social_post: "udawany post z serwisu społecznościowego",
  fake_comments: "fałszywe komentarze wpisane w stronę",
};

function shortUrl(url: string, max = 64): string {
  const s = url.replace(/^https?:\/\//, "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function normAdvertiser(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function shortAddr(a: string): string {
  return a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}

class GraphBuilder {
  nodes = new Map<string, GraphNode>();
  edges = new Map<string, GraphEdge>();

  node(type: EntityType, key: string, label: string, data: Record<string, unknown> = {}): string {
    const id = nodeId(type, key);
    const existing = this.nodes.get(id);
    if (existing) {
      Object.assign(existing.data, data);
      return id;
    }
    this.nodes.set(id, { id, type, key, label, df: 0, weight: null, strong: false, discounts: [], data, campaignId: null });
    return id;
  }

  edge(source: string, target: string, type: EdgeType, evidence: string, weight = 1): void {
    if (source === target) return;
    const id = `${type}|${source}|${target}`;
    if (!this.edges.has(id)) this.edges.set(id, { id, source, target, type, weight, evidence });
  }
}

/** Builds the evidence graph (nodes, edges, item links). Pure and deterministic. */
export function buildEvidenceGraph(
  dataset: EnrichedDataset,
  options: BuildGraphOptions = {},
): EvidenceGraph & { itemPivots?: Record<string, ItemPivot[]> } {
  const config = options.config ?? DEFAULT_LINK_CONFIG;
  const discounter = new Discounter(config);
  const g = new GraphBuilder();
  const factsByItem = new Map<string, Fact[]>();
  const items = dataset.items;
  const n = items.length;

  // Domain-name templates (e.g. "finance<n>-<lorem><n>.sbs") shared by >= N distinct domains.
  const templateOf = new Map<string, DomainTemplate>();
  const templateDomains = new Map<string, Set<string>>();
  for (const h of Object.values(dataset.hosts)) {
    const d = h.registrableDomain;
    if (!d || templateOf.has(d) || discounter.domainDiscount(d)) continue;
    const t = domainTemplate(d);
    if (!t) continue;
    templateOf.set(d, t);
    for (const key of [t.specific, t.agnostic]) {
      if (!templateDomains.has(key)) templateDomains.set(key, new Set());
      templateDomains.get(key)!.add(d);
    }
  }
  const templateShared = (key: string) => (templateDomains.get(key)?.size ?? 0) >= config.kit.domainPatternMinDomains;

  /** Items whose creative is a screenshot of an ad-library view: mostly interface, so the picture is not compared. */
  const libraryViews = new Set<string>();

  // Tenants of the landing-page platform (landing-cdn/<uuid>) seen together with an owner_uuid: a page
  // that has only the tenant (no page code) is then attributed to that account. A tenant seen with two
  // different owners is ambiguous and not mapped.
  const tenantOwner = new Map<string, string | null>();
  for (const item of items) {
    const e = dataset.perItem[item.id];
    const kit = e?.pageKey ? dataset.pages[e.pageKey]?.kit : null;
    const owner = kit?.lander?.ownerId;
    if (!owner) continue;
    for (const t of kit?.platformTenants ?? []) {
      if (t === owner) continue;
      const cur = tenantOwner.get(t);
      tenantOwner.set(t, cur === undefined || cur === owner ? owner : null);
    }
  }

  for (const item of items) {
    const facts: Fact[] = [];
    const add = (pivot: string, type: EntityType, path: string[], relation: number, how: string) => {
      if (relation > 0) facts.push({ pivot, type, path, relation, how });
    };
    const enr = dataset.perItem[item.id];
    const advertiser = item.advertiser ?? enr?.advertiserOcr ?? null;
    const itemNode = g.node("item", item.id, advertiser ? `${item.id} · ${advertiser}` : item.id, {
      platform: item.platform,
      advertiser,
      text: item.text ? item.text.slice(0, 600) : null,
      landingUrl: item.landingUrl,
      imageUrl: item.imageUrl,
      imagePath: item.imagePath,
      firstSeen: item.firstSeen,
      lastSeen: item.lastSeen,
      label: item.label,
      deepfakeScore: item.deepfakeScore,
      personas: [...new Set((enr?.personas ?? []).map((p) => p.name))],
      ocrText: enr?.ocrText ? enr.ocrText.slice(0, 600) : null,
      asrText: enr?.asrText ? enr.asrText.slice(0, 600) : null,
    });
    const itemData = g.nodes.get(itemNode)!.data;

    // Screenshot of the ad: kind of platform view and the ad-library ID read by OCR
    const ui = enr?.ocrText ? stripUiChrome(enr.ocrText) : null;
    if (ui?.view) itemData.uiView = ui.view;
    if (ui?.view === "ad_library") libraryViews.add(item.id);
    // The library ID also comes from the further screenshots of the case and from the input (e.g. a yt-dlp description of the ad)
    const libraryIds = [
      ...new Set([
        ...(ui?.adLibraryIds ?? []),
        ...(enr?.extraOcrText ? stripUiChrome(enr.extraOcrText).adLibraryIds : []),
        ...(/^\d{12,20}$/.test(item.extra.ad_library_id ?? "") ? [item.extra.ad_library_id] : []),
      ]),
    ];
    const fromInput = (libId: string) => item.extra.ad_library_id === libId && !ui?.adLibraryIds.includes(libId);
    if (libraryIds.length) itemData.adLibraryIds = libraryIds;
    for (const libId of libraryIds) {
      const id = g.node("campaign_param", `ad_library_id=${libId}`, `ad_library_id=${libId}`, {
        canonicalName: "ad_library_id",
        name: fromInput(libId) ? "identyfikator biblioteki reklam (z opisu materiału)" : "identyfikator biblioteki reklam (OCR)",
        value: libId,
        cyrillic: false,
        macro: false,
        // without these filters the library lists only active ads and a removed ad is not shown
        sourceUrl: `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&id=${libId}`,
      });
      g.edge(itemNode, id, "carries_param", fromInput(libId) ? "identyfikator biblioteki reklam z opisu materiału" : "identyfikator biblioteki reklam odczytany ze zrzutu ekranu (OCR)");
      add(id, "campaign_param", [itemNode, id], 1, `ten sam identyfikator w bibliotece reklam (${libId}): ta sama reklama`);
    }

    // Meta Ad Library details (opt-in): DSA payer/beneficiary as a pivot, takedown and reach on the item
    const lib = (enr?.adLibrary ?? []).filter((r) => !r.error);
    if (lib.length) {
      itemData.adLibrary = lib.map((r) => ({
        id: r.id,
        payers: r.payers,
        beneficiaries: r.beneficiaries,
        takenDown: r.takenDown,
        violations: r.violations,
        euReach: r.euReach,
        audience: r.ageMin !== null || r.ageMax !== null ? `${r.ageMin ?? "?"}–${r.ageMax ?? "?"} lat${r.gender && r.gender !== "All" ? `, ${r.gender}` : ""}` : null,
        locations: r.locations,
        pageName: r.pageName,
      }));
      if (lib.some((r) => r.takenDown)) itemData.adTakenDown = true;
      const names = new Map<string, { label: string; roles: Set<string> }>();
      for (const r of lib) {
        for (const [role, list] of [["płatnik", r.payers], ["beneficjent", r.beneficiaries]] as const) {
          for (const n of list) {
            const key = normAdvertiser(n);
            if (!key) continue;
            const e = names.get(key) ?? { label: n, roles: new Set<string>() };
            e.roles.add(role);
            names.set(key, e);
          }
        }
      }
      for (const [key, { label, roles }] of names) {
        const prev = (g.nodes.get(nodeId("ad_payer", key))?.data.adLibraryIds as string[] | undefined) ?? [];
        const id = g.node("ad_payer", key, label, { name: label, adLibraryIds: [...new Set([...prev, ...lib.map((r) => r.id)])] });
        const roleTxt = [...roles].join(" i ");
        g.edge(itemNode, id, "paid_by", `${roleTxt} reklamy według biblioteki reklam Mety (przejrzystość DSA)`);
        add(id, "ad_payer", [itemNode, id], 1, `ten sam ${roleTxt} reklamy w bibliotece reklam („${label}”)`);
      }
    }

    if (advertiser) {
      const a = g.node("advertiser", normAdvertiser(advertiser), advertiser);
      g.edge(itemNode, a, "posted_by", "reklamodawca podany w danych reklamy");
      add(a, "advertiser", [itemNode, a], 1, `ten sam reklamodawca „${advertiser}”`);
    }

    if (enr?.image) {
      const ih = g.node("imagehash", enr.image.dhash, `obraz ${enr.image.dhash}`, {
        dhash: enr.image.dhash,
        ahash: enr.image.ahash,
        width: enr.image.width,
        height: enr.image.height,
      });
      g.node("item", item.id, "", { dhash: enr.image.dhash });
      g.edge(itemNode, ih, "has_image", "dHash kreacji reklamy");
      // an ad-library view is mostly interface: two different ads can hash identically
      if (ui?.view !== "ad_library") add(ih, "imagehash", [itemNode, ih], 1, `identyczny obraz (dHash ${enr.image.dhash})`);
    }
    // The same creative file (SHA-256 of the bytes): a node of the image-hash type keyed "sha256:<hex>"
    const creativeFiles: Array<{ sha: string; media: "image" | "video" }> = [];
    if (enr?.image?.sha256) creativeFiles.push({ sha: enr.image.sha256, media: "image" });
    if (enr?.videoSha256) creativeFiles.push({ sha: enr.videoSha256, media: "video" });
    for (const f of creativeFiles) {
      const what = f.media === "video" ? "plik wideo" : "plik obrazu";
      const id = g.node("imagehash", `${CREATIVE_FILE_PREFIX}${f.sha}`, `${what} kreacji ${f.sha.slice(0, 12)}…`, { sha256: f.sha, media: f.media, exactFile: true });
      g.edge(itemNode, id, "has_image", `SHA-256 pliku kreacji (${what})`);
      add(id, "imagehash", [itemNode, id], 1, `ten sam plik kreacji (${what}, SHA-256 ${f.sha.slice(0, 16)}…)`);
    }

    const addContacts = (
      from: string,
      basePath: string[],
      src: { emails?: string[]; phones?: string[]; telegram?: string[]; whatsapp?: string[]; wallets?: Array<{ kind: string; address: string }> } | null | undefined,
      where: string,
      relation: number,
    ) => {
      if (!src) return;
      for (const e of src.emails ?? []) {
        const id = g.node("email", e, e);
        g.edge(from, id, "mentions", `adres e-mail ${where}`);
        add(id, "email", [...basePath, id], relation, `ten sam e-mail ${e}`);
      }
      for (const p of src.phones ?? []) {
        const id = g.node("phone", p, p);
        g.edge(from, id, "mentions", `numer telefonu ${where}`);
        add(id, "phone", [...basePath, id], relation, `ten sam numer telefonu ${p}`);
      }
      for (const w of src.whatsapp ?? []) {
        const isPhone = w.startsWith("+");
        const id = isPhone ? g.node("phone", w, w, { whatsapp: true }) : g.node("telegram", w, w, { whatsappGroup: true });
        g.edge(from, id, "mentions", `kontakt WhatsApp ${where}`);
        add(id, isPhone ? "phone" : "telegram", [...basePath, id], relation, `ten sam kontakt WhatsApp ${w}`);
      }
      for (const t of src.telegram ?? []) {
        const id = g.node("telegram", t, t);
        g.edge(from, id, "mentions", `kontakt Telegram ${where}`);
        add(id, "telegram", [...basePath, id], relation, `ten sam kontakt Telegram ${t}`);
      }
      for (const w of src.wallets ?? []) {
        const id = g.node("wallet", `${w.kind}:${w.address}`, `${w.kind.toUpperCase()} ${shortAddr(w.address)}`, {
          kind: w.kind,
          address: w.address,
        });
        g.edge(from, id, "mentions", `adres portfela ${where}`);
        add(id, "wallet", [...basePath, id], relation, `ten sam portfel ${w.kind.toUpperCase()} ${w.address}`);
      }
    };

    addContacts(itemNode, [itemNode], enr?.text, "w treści reklamy", 1);

    /** Adds url -> host -> domain (+ ip/asn, ns, registrar, certs) and returns the url node. */
    const addUrlInfra = (url: string, path: string[], relation: number, infraRelation = relation): string | null => {
      const nu = normalizeUrl(url);
      if (!nu) return null;
      // Hosting of a deny-listed platform/shortener says nothing about the advertiser:
      // its IPs, NS, registrar and certificates are scaled by the domain's list factor.
      const platform = discounter.domainDiscount(nu.registrableDomain);
      const hostingRel = infraRelation * (platform ? platform.factor : 1);
      const domainInfraRel = relation * (platform ? platform.factor : 1);
      const urlNode = g.node("url", nu.url, shortUrl(nu.url), { url: nu.url, registrableDomain: nu.registrableDomain });
      const urlPath = [...path, urlNode];
      add(urlNode, "url", urlPath, relation, `ten sam URL ${shortUrl(nu.url)}`);
      const hostLabel = nu.isIdn ? `${toUnicodeHost(nu.host)} (${nu.host})` : nu.host;
      const hostNode = g.node("host", nu.host, hostLabel, { registrableDomain: nu.registrableDomain, isIdn: nu.isIdn });
      g.edge(urlNode, hostNode, "on_host", "host adresu URL");
      const hostPath = [...urlPath, hostNode];
      add(hostNode, "host", hostPath, relation, `ten sam host ${hostLabel}`);

      const hostInfo = dataset.hosts[nu.host];
      // CNAME chain: the registrable domain of each target (operator TDS domains survive label rotation)
      const seenTargets = new Set<string>();
      for (const target of hostInfo?.cnameChain ?? []) {
        const td = registrableDomain(target) ?? target;
        if (seenTargets.has(td) || td === nu.registrableDomain) continue;
        seenTargets.add(td);
        const cnNode = g.node("cname_target", td, `CNAME → ${td}`, { registrableDomain: td });
        const cnData = g.nodes.get(cnNode)!.data;
        const targets = (cnData.targets as string[] | undefined) ?? [];
        if (!targets.includes(target)) targets.push(target);
        cnData.targets = targets.sort();
        g.edge(hostNode, cnNode, "cname_to", `rekord CNAME: ${nu.host} → ${target}`);
        add(cnNode, "cname_target", [...hostPath, cnNode], hostingRel, `wspólny cel CNAME ${td}`);
      }
      for (const ip of hostInfo?.ips ?? []) {
        const asn = dataset.ips[ip];
        const ipNode = g.node("ip", ip, ip, {
          asns: asn?.asns ?? (asn?.asn ? [asn.asn] : []),
          asName: asn?.asName ?? null,
          prefix: asn?.prefix ?? null,
          country: asn?.country ?? null,
        });
        g.edge(hostNode, ipNode, "resolves_to", "rekord DNS A/AAAA");
        const ipPath = [...hostPath, ipNode];
        add(ipNode, "ip", ipPath, hostingRel, `wspólny adres IP ${ip}`);
        if (asn?.asn) {
          const asnNode = g.node("asn", `AS${asn.asn}`, `AS${asn.asn}${asn.asName ? ` ${asn.asName.split(" ")[0]}` : ""}`, {
            asn: asn.asn,
            asName: asn.asName,
            country: asn.country,
            registry: asn.registry,
          });
          g.edge(ipNode, asnNode, "announced_by", `prefiks ${asn.prefix ?? "?"} ogłaszany przez AS${asn.asn}`);
          add(asnNode, "asn", [...ipPath, asnNode], hostingRel, `ten sam system autonomiczny AS${asn.asn}`);
        }
      }

      const domain = nu.registrableDomain;
      if (domain) {
        const di = dataset.domains[domain];
        const domainNode = g.node("domain", domain, nu.isIdn ? `${toUnicodeHost(domain)} (${domain})` : domain, {
          registrableDomain: domain,
          registrar: di?.rdap?.registrar ?? null,
          created: di?.rdap?.created ?? null,
          expires: di?.rdap?.expires ?? null,
          status: di?.rdap?.status ?? [],
          nameservers: di?.ns ?? [],
          mx: di?.mx ?? [],
          certCount: di?.ct?.certs.length ?? null,
        });
        g.edge(hostNode, domainNode, "in_domain", "domena rejestrowalna (eTLD+1)");
        const domainPath = [...hostPath, domainNode];
        add(domainNode, "domain", domainPath, relation, `ta sama domena ${domain}`);
        const tpl = templateOf.get(domain);
        if (tpl) {
          for (const [key, agnostic] of [
            [tpl.specific, false],
            [tpl.agnostic, true],
          ] as const) {
            if (!templateShared(key)) continue;
            const domainsWithTpl = [...(templateDomains.get(key) ?? [])].sort();
            const pNode = g.node("domain_pattern", key, `wzorzec ${key}`, {
              template: key,
              agnostic,
              literalChars: tpl.literalChars,
              domains: domainsWithTpl.slice(0, 50),
              domainCount: domainsWithTpl.length,
            });
            g.edge(domainNode, pNode, "matches_pattern", `nazwa ${domain} pasuje do wzorca ${key}`);
            add(pNode, "domain_pattern", [...domainPath, pNode], relation, `ten sam wzorzec nazw domen ${key}`);
          }
        }
        if (di) {
          if (di.ns.length) {
            const nsList = [...di.ns].sort();
            const nsKey = nsList.join(" + ");
            const nsNode = g.node("nameserver", nsKey, nsList.join(", "), { nameservers: nsList });
            g.edge(domainNode, nsNode, "uses_ns", "rekordy NS domeny");
            add(nsNode, "nameserver", [...domainPath, nsNode], Math.min(hostingRel, domainInfraRel), `te same serwery NS (${nsList.join(", ")})`);
          }
          if (di.rdap?.registrar) {
            const reg = di.rdap.registrar;
            const regNode = g.node("registrar", reg.toLowerCase(), reg, { registrar: reg });
            g.edge(domainNode, regNode, "registered_with", `RDAP: rejestrator${di.rdap.created ? `, utworzona ${di.rdap.created.slice(0, 10)}` : ""}`);
            add(regNode, "registrar", [...domainPath, regNode], domainInfraRel, `ten sam rejestrator ${reg}`);
          }
          for (const cert of di.ct?.certs ?? []) {
            const regDomains = new Set(cert.sanDomains.map((s) => registrableDomain(s)).filter((d): d is string => !!d));
            if (regDomains.size < 2) continue; // only certificates that can link different domains
            const key = cert.serial ?? cert.id;
            const certNode = g.node("cert", key, `cert ${cert.issuer} ${cert.notBefore?.slice(0, 10) ?? ""} (${regDomains.size} domen)`, {
              crtshId: cert.id,
              serial: cert.serial,
              issuer: cert.issuer,
              notBefore: cert.notBefore,
              notAfter: cert.notAfter,
              sanDomains: cert.sanDomains.slice(0, 50),
              sanCount: cert.sanDomains.length,
              sanRegistrableCount: regDomains.size,
            });
            g.edge(domainNode, certNode, "has_cert", "CT log: domena w SAN certyfikatu");
            add(certNode, "cert", [...domainPath, certNode], domainInfraRel, `wspólny certyfikat TLS (${cert.issuer}), SAN obejmuje obie domeny`);
          }
        }
      }
      return urlNode;
    };

    // Landing URL and its redirect chain
    if (enr?.landing) {
      const page = enr.pageKey ? dataset.pages[enr.pageKey] : undefined;
      const ex = page?.extract;
      // A parked final page means its hosting (IP, ASN, NS) belongs to a parking provider.
      const parked = !!ex && discounter.isParked([ex.title, ex.description, ex.visibleText]);
      const pageRel = parked ? config.lists.parkingFactor : 1;
      const chain: Array<{ url: string; status: number | null; kind: string | null }> = [];
      if (page) {
        for (const hop of page.fetch.redirectChain) chain.push({ url: hop.url, status: hop.status, kind: hop.kind });
        chain.push({ url: page.fetch.finalUrl, status: page.fetch.status, kind: null });
      } else chain.push({ url: enr.landing.url, status: null, kind: null });

      let path = [itemNode];
      let prev: string | null = null;
      let prevHop: { status: number | null; kind: string | null } | null = null;
      chain.forEach((hop, idx) => {
        const isFinal = idx === chain.length - 1;
        const urlNode = addUrlInfra(hop.url, path, 1, isFinal ? pageRel : 1);
        if (!urlNode) return;
        if (prev === null) g.edge(itemNode, urlNode, "landing", "link docelowy reklamy");
        else if (prev !== urlNode) {
          g.edge(prev, urlNode, "redirect", prevHop?.kind === "meta-refresh" ? "przekierowanie meta refresh" : `przekierowanie HTTP ${prevHop?.status ?? ""}`.trim());
        }
        if (prev !== urlNode) path = [...path, urlNode];
        prev = urlNode;
        prevHop = hop;
      });

      const finalUrlNode: string | null = prev;
      if (finalUrlNode && ex) {
        const rel = pageRel;
        if (parked) g.node("url", g.nodes.get(finalUrlNode)!.key, "", { parked: true });
        const finalPath = path;
        for (const t of ex.trackers) {
          const label = `${TRACKER_LABELS[t.kind] ?? t.kind} ${t.id}`;
          const id = g.node("tracker", `${t.kind}:${t.id}`, label, { kind: t.kind, trackerId: t.id });
          g.edge(finalUrlNode, id, "uses_tracker", "identyfikator trackera w kodzie strony");
          add(id, "tracker", [...finalPath, id], rel, `ten sam identyfikator ${label}`);
        }
        const fav = page?.favicon;
        if (fav?.hashes) {
          // A clone of a news site carries that site's favicon: a trait of the impersonated brand, not of the operator.
          const brand = impersonatedBrand(ex.title, page?.fetch.finalUrl ?? enr.landing.url);
          if (brand) itemData.impersonatedBrand = brand;
          const id = g.node("favicon", `mmh3:${fav.hashes.mmh3}`, `favicon ${fav.hashes.mmh3}`, {
            url: fav.url,
            mmh3: fav.hashes.mmh3,
            sha256: fav.hashes.sha256,
            dhash: fav.hashes.dhash,
            ...(brand ? { impersonatedBrand: brand } : {}),
          });
          g.edge(finalUrlNode, id, "has_favicon", "favicon strony (hash Shodan mmh3)");
          add(id, "favicon", [...finalPath, id], rel, `identyczny favicon (mmh3 ${fav.hashes.mmh3})`);
        }
        addContacts(finalUrlNode, finalPath, ex, "na stronie docelowej", rel);
        for (const d of ex.outboundDomains) {
          const disc = discounter.domainDiscount(d);
          if (disc && disc.factor === 0) continue;
          const id = g.node("domain", d, d, { registrableDomain: d });
          g.edge(finalUrlNode, id, "links_to", "strona docelowa linkuje do tej domeny");
          add(id, "domain", [...finalPath, id], rel * config.outboundLinkFactor, `strona linkuje do domeny ${d}`);
        }
      }

      // Page kit: form/API backends, hidden fields, own assets, code comments, DOM structure
      const kit = page?.kit;
      if (finalUrlNode && kit) {
        const rel = pageRel;
        const finalPath = path;
        for (const ep of kit.endpoints) {
          const client = ep.clientId ? ` (klient ${ep.clientId.length > 16 ? `${ep.clientId.slice(0, 15)}…` : ep.clientId})` : "";
          const label = ep.sameOrigin ? `backend ${ep.pathTemplate} (ta sama domena)` : `backend ${ep.host}${ep.pathTemplate}${client}`;
          const id = g.node("endpoint", ep.key, label, {
            host: ep.host,
            pathTemplate: ep.pathTemplate,
            sameOrigin: ep.sameOrigin,
            method: ep.method,
            via: ep.via,
            registrableDomain: registrableDomain(ep.host),
            ...(ep.clientId ? { clientId: ep.clientId, clientIdSource: ep.clientIdSource ?? null } : {}),
          });
          g.edge(finalUrlNode, id, "posts_to", `strona wysyła dane (${ep.via}${ep.method ? `, ${ep.method}` : ""}) do ${ep.raw}`);
          const how = ep.sameOrigin
            ? `ten sam backend formularza *${ep.pathTemplate}`
            : ep.clientId
              ? `ten sam backend formularza z tym samym identyfikatorem klienta (${ep.host}${ep.pathTemplate}, ${ep.clientIdSource ?? "identyfikator"} ${ep.clientId})`
              : `ten sam backend formularza ${ep.host}${ep.pathTemplate}`;
          add(id, "endpoint", [...finalPath, id], rel, how);
        }
        const hidden = discounter.specificHiddenFields(kit.hiddenFields);
        if (hidden.length >= config.kit.minHiddenFields) {
          const key = hidden.join(",");
          const id = g.node("hidden_fields", key, `ukryte pola: ${hidden.join(", ")}`, { fields: hidden });
          g.edge(finalUrlNode, id, "has_hidden_fields", "zestaw ukrytych pól formularza");
          add(id, "hidden_fields", [...finalPath, id], rel, `ten sam zestaw ukrytych pól (${hidden.join(", ")})`);
        }
        for (const asset of kit.assets) {
          if (!asset.sameOrigin) {
            const disc = discounter.domainDiscount(registrableDomain(asset.host));
            if (disc && disc.factor === 0) continue; // public CDN or library host
          }
          const id = g.node("asset", asset.key, `${asset.kind.toUpperCase()} ${asset.sameOrigin ? asset.path : `${asset.host}${asset.path}`}`, {
            url: asset.url,
            host: asset.host,
            path: asset.path,
            basename: asset.basename,
            kind: asset.kind,
            sameOrigin: asset.sameOrigin,
          });
          g.edge(finalUrlNode, id, "loads_asset", `strona ładuje ${asset.kind.toUpperCase()} ${asset.url}`);
          add(id, "asset", [...finalPath, id], rel, `ten sam plik ${asset.kind.toUpperCase()} ${asset.basename}`);
        }
        for (const text of kit.comments) {
          const cyr = /[\u0400-\u04FF]/.test(text);
          const id = g.node("comment", text, `„${text.length > 60 ? `${text.slice(0, 59)}…` : text}”`, { text, cyrillic: cyr });
          g.edge(finalUrlNode, id, "has_comment", "komentarz w kodzie strony");
          add(id, "comment", [...finalPath, id], rel, `ten sam komentarz w kodzie („${text.length > 80 ? `${text.slice(0, 79)}…` : text}”)`);
        }
        for (const pid of kit.pathIds ?? []) {
          const id = g.node("path_id", pid.id, `konto ${pid.id.slice(0, 8)}… w ścieżkach zasobów`, { pathId: pid.id, prefix: pid.prefix });
          g.edge(finalUrlNode, id, "uses_path_id", `identyfikator (UUID) w ścieżkach zasobów ładowanych z domeny strony: ${pid.prefix}${pid.id}/…`);
          add(id, "path_id", [...finalPath, id], rel, `ten sam identyfikator w ścieżkach zasobów (${pid.prefix}${pid.id})`);
        }
        // Records of the landing-page platform (window.aio): account, campaign, template, traffic source
        const lc = kit.lander;
        const tenants = kit.platformTenants ?? [];
        if (tenants.length) itemData.platformTenants = tenants;
        if (lc?.ownerId && tenants.length && !tenants.includes(lc.ownerId)) {
          itemData.platformAccountWarning = `najemca landing-cdn (${tenants.join(", ")}) różni się od owner_uuid (${lc.ownerId}) z window.${lc.platform}: konto przypisane według owner_uuid`;
        }
        if (!lc?.ownerId && tenants.length) {
          // No page code with the owner (a HAR or a scan's request list): the tenant stands in for the account
          itemData.landerPlatform ??= lc?.platform ?? "aio";
          for (const t of tenants) {
            const mapped = tenantOwner.get(t) ?? null;
            const account = mapped ?? t;
            const id = g.node("platform_account", account, `konto ${account.slice(0, 8)}… na platformie stron`, {
              ownerId: mapped ?? (g.nodes.get(nodeId("platform_account", account))?.data.ownerId as string | undefined) ?? null,
              tenantId: t,
              platform: lc?.platform ?? "aio",
            });
            g.edge(finalUrlNode, id, "built_on", `pliki strony leżą w katalogu najemcy platformy stron (landing-cdn/${t})${mapped ? `; ten sam najemca ma konto owner_uuid ${mapped}` : ""}`);
            add(id, "platform_account", [...finalPath, id], rel, `to samo konto na platformie stron (najemca landing-cdn ${t}${mapped ? ` = owner_uuid ${mapped}` : ""})`);
          }
          const first = tenants[0];
          const mapped = tenantOwner.get(first) ?? null;
          itemData.platformAccount = mapped ?? first;
          itemData.platformAccountSource = mapped ? "tenant→owner_uuid" : "tenant";
        }
        if (lc) {
          itemData.landerPlatform = lc.platform;
          if (lc.ownerId) {
            itemData.platformAccount = lc.ownerId;
            itemData.platformAccountSource = "owner_uuid";
          }
          if (lc.campaignName) itemData.platformCampaignName = lc.campaignName;
          if (lc.landingName) itemData.landingName = lc.landingName;
          if (lc.sourceName) itemData.trafficSource = lc.sourceName;
          if (lc.sourceName && /cloak/i.test(lc.sourceName)) itemData.cloakerInSource = true;
          if (lc.ownerId) {
            const prevTenants = (g.nodes.get(nodeId("platform_account", lc.ownerId))?.data.tenants as string[] | undefined) ?? [];
            const tenantsOfOwner = [...new Set([...prevTenants, ...tenants.filter((t) => t !== lc.ownerId)])].sort();
            const id = g.node("platform_account", lc.ownerId, `konto ${lc.ownerId.slice(0, 8)}… na platformie stron`, {
              ownerId: lc.ownerId,
              platform: lc.platform,
              ...(tenantsOfOwner.length ? { tenants: tenantsOfOwner } : {}),
            });
            g.edge(finalUrlNode, id, "built_on", `strona zapisuje w kodzie konto właściciela na platformie stron (window.${lc.platform}, owner_uuid ${lc.ownerId})`);
            add(id, "platform_account", [...finalPath, id], rel, `to samo konto na platformie stron (owner_uuid ${lc.ownerId})`);
          }
          if (lc.campaignId) {
            const name = lc.campaignName ? `„${lc.campaignName}”` : lc.campaignId.slice(0, 8);
            const id = g.node("platform_campaign", lc.campaignId, `kampania ${name}`, { campaignId: lc.campaignId, name: lc.campaignName, number: lc.campaignNumber, ownerId: lc.ownerId });
            g.edge(finalUrlNode, id, "built_on", `strona należy do kampanii ${name} na platformie stron (${lc.campaignId}${lc.campaignNumber ? `, nr ${lc.campaignNumber}` : ""})`);
            add(id, "platform_campaign", [...finalPath, id], rel, `ta sama kampania na platformie stron (${name}, ${lc.campaignId})`);
          }
          if (lc.templateId) {
            const id = g.node("page_template", lc.templateId, `szablon strony ${lc.templateId.slice(0, 8)}…`, { templateId: lc.templateId, landerTypeId: lc.landerTypeId });
            g.edge(finalUrlNode, id, "built_on", `strona zbudowana na szablonie platformy (lander_template_uuid ${lc.templateId})`);
            add(id, "page_template", [...finalPath, id], rel, `ten sam szablon strony na platformie (lander_template_uuid ${lc.templateId})`);
          }
        }
        if (kit.domSimhash) itemData.domSimhash = kit.domSimhash;
        if (kit.cyrillicComments) itemData.cyrillic = true;
        // Comments written into the page: the set of authors is part of the template
        const cb = kit.commentBlock;
        if (cb) {
          const who = `${cb.authors.slice(0, 3).join(", ")}${cb.authors.length > 3 ? "…" : ""}`;
          const id = g.node("comment_block", cb.key, `blok ${cb.count} komentarzy (${who})`, { authors: cb.authors, count: cb.count, samples: cb.samples });
          g.edge(finalUrlNode, id, "has_comment_block", `sekcja komentarzy wpisana w kod strony, bez wtyczki serwisu (${cb.count} komentarzy, ${cb.authors.length} autorów)`);
          add(id, "comment_block", [...finalPath, id], rel, `ten sam blok fałszywych komentarzy (${cb.authors.length} autorów: ${who})`);
          itemData.commentBlock = id;
          itemData.fakeCommentCount = Math.max(Number(itemData.fakeCommentCount ?? 0), cb.count);
        }
        // Techniques: the same modus operandi (second level only, campaignRules.familyOnlyKinds)
        for (const t of kit.techniques ?? []) {
          const id = g.node("technique", t, TECHNIQUE_LABELS[t] ?? t, { technique: t });
          g.edge(finalUrlNode, id, "uses_technique", `technika strony: ${TECHNIQUE_LABELS[t] ?? t}`);
          add(id, "technique", [...finalPath, id], rel, `ta sama technika strony (${TECHNIQUE_LABELS[t] ?? t}): podobny sposób działania`);
          const list = (itemData.techniques as string[] | undefined) ?? [];
          if (!list.includes(t)) itemData.techniques = [...list, t];
        }
      }
      if (page?.cloaking) {
        itemData.cloakingSuspected = page.cloaking.suspected;
        if (page.cloaking.suspected) itemData.cloakingReasons = page.cloaking.reasons;
      }
      if (page) itemData.finalUrl = page.fetch.finalUrl;
    }

    // Campaign parameters leaking into URLs (UTM, sub1-5, click/offer/campaign/ad/pixel IDs)
    for (const cp of enr?.campaignParams ?? []) {
      const value = cp.value.trim();
      const key = `${cp.canonicalName}=${value.toLowerCase()}`;
      const id = g.node("campaign_param", key, `${cp.canonicalName}=${value.length > 40 ? `${value.slice(0, 39)}…` : value}`, {
        canonicalName: cp.canonicalName,
        name: cp.name,
        value,
        cyrillic: cp.cyrillic,
        macro: cp.macro,
        sourceUrl: cp.sourceUrl,
      });
      g.edge(itemNode, id, "carries_param", `parametr ${cp.name} w URL ${cp.sourceUrl}`);
      add(id, "campaign_param", [itemNode, id], 1, `ten sam parametr kampanii ${cp.canonicalName}=${value}`);
      if (cp.cyrillic) itemData.cyrillic = true;
    }

    // Click IDs that carry more than a token: the tracker server (xid) and the clicked Meta ad (fbclid)
    const landingPage = enr?.pageKey ? dataset.pages[enr.pageKey] : undefined;
    const clickIds = clickIdsFromUrls([item.landingUrl, ...(landingPage?.fetch.redirectChain.map((h) => h.url) ?? []), landingPage?.fetch.finalUrl]);
    for (const x of clickIds.xids) {
      // Keyed by the machine only: the "process ID" of this tracker product is one constant on many
      // installations (a trait of the platform, not of one server), so it stays a detail of the node.
      const prevPids = (g.nodes.get(nodeId("click_server", x.machine))?.data.pids as number[] | undefined) ?? [];
      const id = g.node("click_server", x.machine, `serwer trackera ${x.machine}`, { machine: x.machine, pids: [...new Set([...prevPids, x.pid])].sort((p, q) => p - q) });
      g.edge(itemNode, id, "routed_by", `identyfikator kliknięcia ${x.param}=${x.value} w formacie xid: wydany ${x.time}, maszyna ${x.machine}, proces ${x.pid} (stała instalacji platformy), licznik ${x.counter}`);
      add(id, "click_server", [itemNode, id], 1, `ten sam serwer trackera (clickid w formacie xid: maszyna ${x.machine})`);
      itemData.clickTime ??= x.time;
      itemData.clickCounter ??= x.counter;
    }
    for (const f of clickIds.fbclids) {
      if (f.appId) itemData.metaAppId ??= f.appId;
      if (!f.adId) continue;
      itemData.metaAdId ??= f.adId;
      const id = g.node("meta_ad", f.adId, `reklama Meta ${f.adId}`, { adId: f.adId, appId: f.appId });
      g.edge(itemNode, id, "clicked_ad", `fbclid w linku zawiera identyfikator klikniętej reklamy ${f.adId}${f.appId ? ` (app_id ${f.appId})` : ""}`);
      add(id, "meta_ad", [itemNode, id], 1, `ta sama reklama w Mecie (identyfikator ${f.adId} odczytany z fbclid)`);
    }

    // Template of the tracking link (parameter names + value shapes): the traffic-distribution system
    const schema = paramSchema(item.landingUrl);
    if (schema) {
      const id = g.node("param_schema", schema.key, `szablon linku: ${schema.names.join(", ")}`, { schema: schema.key, names: schema.names });
      g.edge(itemNode, id, "follows_schema", "nazwy parametrów linku docelowego i rodzaj ich wartości");
      add(id, "param_schema", [itemNode, id], 1, `ten sam szablon linku śledzącego (${schema.names.join(", ")}; wartości losowe)`);
    }

    // Personas (impersonated people): weak signal, mainly for filtering and triage
    // One edge per persona; every way it was found is kept in the edge evidence ("; "-separated).
    const personaHows = new Map<string, { name: string; role: string | null; hows: string[] }>();
    for (const pm of enr?.personas ?? []) {
      const how = pm.source === "ingest" ? "z kolumny danych wejściowych" : pm.source === "ner" ? "z NER (model językowy)" : pm.source === "face" ? `z twarzy (podobna twarz${pm.similarity !== undefined ? `, ${pm.similarity.toFixed(2)}` : ""}; do przeglądu przez człowieka)` : pm.fuzzy ? "z OCR/ASR (dopasowanie przybliżone)" : "z listy obserwowanych nazwisk";
      const cur = personaHows.get(pm.id) ?? { name: pm.name, role: pm.role, hows: [] };
      if (!cur.hows.includes(how)) cur.hows.push(how);
      cur.role ??= pm.role;
      personaHows.set(pm.id, cur);
    }
    for (const [pid, p] of personaHows) {
      const id = g.node("persona", pid, p.name, { name: p.name, role: p.role });
      g.edge(itemNode, id, "mentions_persona", `persona ${p.hows.join("; ")}`);
      add(id, "persona", [itemNode, id], 1, `ta sama persona: ${p.name}`);
    }

    // Addresses seen in the browser address bar of screenshots and recordings
    const observedUrls = enr?.observedUrls ?? [];
    if (observedUrls.length) {
      itemData.observedUrls = [
        ...new Set(observedUrls.map((o) => `${o.host}${o.frameTime !== undefined ? ` (nagranie ${o.frameTime} s)` : ""}${o.platform ? " (strona platformy)" : ""}`)),
      ];
      const inApp = observedUrls.find((o) => o.inAppBrowser)?.inAppBrowser;
      if (inApp) itemData.inAppBrowser = inApp;
    }
    if (enr?.landingSource) itemData.landingSource = enr.landingSource;
    if (enr?.landing?.fragment && !enr.landing.fragment.startsWith("capture=")) itemData.landingFragment = enr.landing.fragment;
    for (const o of observedUrls) {
      if (o.platform) continue;
      if (enr?.landing && normalizeUrl(o.url)?.host === enr.landing.host) continue; // the landing page itself
      const urlNode = addUrlInfra(o.url, [itemNode], 1);
      if (urlNode) {
        const where = o.source === "address_bar_video" ? `nagraniu ekranu (${o.frameTime} s)` : "zrzucie ekranu";
        g.edge(itemNode, urlNode, "mentions", `adres w pasku przeglądarki na ${where}${o.inAppBrowser ? `, przeglądarka w aplikacji ${o.inAppBrowser}` : ""}`);
      }
    }

    // URLs mentioned in the ad copy (other than the landing URL)
    for (const u of enr?.text?.urls ?? []) {
      if (enr?.landing && normalizeUrl(u)?.url === enr.landing.url) continue;
      const urlNode = addUrlInfra(u, [itemNode], 1);
      if (urlNode) g.edge(itemNode, urlNode, "mentions", "URL w treści reklamy");
    }

    factsByItem.set(item.id, dedupeFacts(facts));
  }

  addRegistrationBursts(dataset, g, factsByItem, config);

  // Document frequency and weights
  const pivotItems = new Map<string, Array<{ itemId: string; fact: Fact }>>();
  for (const [itemId, facts] of factsByItem) {
    for (const fact of facts) {
      const list = pivotItems.get(fact.pivot) ?? [];
      list.push({ itemId, fact });
      pivotItems.set(fact.pivot, list);
    }
  }
  for (const node of g.nodes.values()) {
    if (node.type === "item") continue;
    node.df = pivotItems.get(node.id)?.length ?? 0;
    node.discounts = discounter.discountsFor({ type: node.type, key: node.key, id: node.id, data: node.data });
    const base = node.data.burst ? config.registrationBurstWeight : node.data.exactFile ? (config.creativeFileWeight ?? 0.95) : undefined;
    const w = pivotWeight(node.type, node.discounts, node.df, n, config, base);
    node.weight = round(w.weight);
    // the same creative file joins by the campaign rules, not by union-find: a platform-account conflict wins over it
    node.strong = w.strong && !node.data.exactFile;
    node.data.weightParts = { base: w.base, listFactor: w.listFactor, idf: round(w.idf), ubiquity: round(w.ubiquity) };
  }

  // Infrastructure of each ad (addresses, hosting, backends, platform records, identifiers): decides
  // whether content similarity may join it (campaignRules.contentKinds)
  const infraKinds = new Set(config.campaignRules.infrastructureKinds ?? []);
  const infraMin = config.campaignRules.infrastructureMinWeight ?? 0.3;
  for (const [itemId, facts] of factsByItem) {
    const types = new Set<string>();
    for (const f of facts) {
      if (!infraKinds.has(f.type)) continue;
      const node = g.nodes.get(f.pivot);
      const parts = node?.data.weightParts as { base: number; listFactor: number } | undefined;
      if (parts && parts.base * parts.listFactor * f.relation >= infraMin) types.add(f.type);
    }
    g.nodes.get(nodeId("item", itemId))!.data.infrastructure = [...types].sort();
  }

  // Pair evidence from shared pivots
  const pairs = new Map<string, PairEvidence[]>();
  const pushPair = (a: string, b: string, ev: PairEvidence) => {
    const [x, y] = a < b ? [a, b] : [b, a];
    const key = `${x}\u0000${y}`;
    const list = pairs.get(key) ?? [];
    list.push(ev);
    pairs.set(key, list);
  };
  const pivotsOf = new Map<string, Set<string>>();
  for (const [itemId, facts] of factsByItem) pivotsOf.set(itemId, new Set(facts.map((f) => f.pivot)));
  for (const [pivot, holders] of pivotItems) {
    if (holders.length < 2 || holders.length > config.maxPivotDf) continue;
    const node = g.nodes.get(pivot)!;
    if (!node.weight || node.weight <= 0) continue;
    // The TLD-agnostic template ("T.*") only adds evidence for pairs that do not already share a
    // TLD-specific variant of the same template ("T.sbs").
    const specificPrefix = node.type === "domain_pattern" && node.data.agnostic === true ? `${pivot.slice(0, -1)}` : null;
    const sharesSpecific = (a: string, b: string) => {
      if (!specificPrefix) return false;
      const mine = [...(pivotsOf.get(a) ?? [])].filter((p) => p.startsWith(specificPrefix) && p !== pivot);
      return mine.some((p) => pivotsOf.get(b)?.has(p));
    };
    const discountText = node.discounts.length
      ? ` — zdyskontowane: ${node.discounts.map((d) => `${d.reason} (×${d.factor})`).join("; ")}`
      : "";
    for (let i = 0; i < holders.length; i++) {
      for (let j = i + 1; j < holders.length; j++) {
        const A = holders[i];
        const B = holders[j];
        if (A.itemId === B.itemId) continue;
        if (sharesSpecific(A.itemId, B.itemId)) continue;
        const rel = Math.min(A.fact.relation, B.fact.relation);
        const weight = node.weight * rel;
        const how = A.fact.relation <= B.fact.relation ? A.fact.how : B.fact.how;
        const [first, second] = A.itemId < B.itemId ? [A, B] : [B, A];
        pushPair(A.itemId, B.itemId, {
          kind: "pivot",
          pivot,
          pivotType: node.type,
          edgeType: null,
          weight: round(weight),
          strong: node.strong && rel >= 1,
          discounted: node.discounts.length > 0 || rel < 1,
          evidence: `${how}${discountText}${rel < 1 ? ` (relacja pośrednia ×${round(rel)})` : ""}`,
          pathA: first.fact.path,
          pathB: second.fact.path,
        });
      }
    }
  }

  // Image similarity (near-duplicates; exact duplicates are covered by the imagehash pivot)
  const withImage = items.filter((it) => dataset.perItem[it.id]?.image && !libraryViews.has(it.id));
  const thr = config.similarity.imageHamming;
  for (let i = 0; i < withImage.length; i++) {
    for (let j = i + 1; j < withImage.length; j++) {
      const a = dataset.perItem[withImage[i].id].image!;
      const b = dataset.perItem[withImage[j].id].image!;
      const d = hammingDistance(a.dhash, b.dhash);
      if (d === 0 || d > thr) continue;
      const weight = config.similarity.imageWeight * (1 - (0.5 * d) / Math.max(1, thr));
      const ev = `prawie identyczna kreacja (dHash, odległość Hamminga ${d}/64)`;
      pushPair(withImage[i].id, withImage[j].id, simEvidence("similar_image", weight, ev, 1 - d / 64));
      g.edge(nodeId("item", withImage[i].id), nodeId("item", withImage[j].id), "similar_image", ev, round(weight));
    }
  }

  // Semantic image similarity (CLIP; opt-in): variants of one creative template that dHash misses
  // Video creatives use the frame-mean embedding, images the image embedding; both live in one CLIP space.
  const creativeEmb = (id: string) => {
    const e = dataset.perItem[id];
    return e?.videoEmbedding?.length ? { v: e.videoEmbedding, video: true } : e?.imageEmbedding?.length ? { v: e.imageEmbedding, video: false } : null;
  };
  const withEmb = items.filter((it) => creativeEmb(it.id) !== null && !libraryViews.has(it.id));
  const sem = config.similarity.imageSemantic;
  for (let i = 0; i < withEmb.length; i++) {
    for (let j = i + 1; j < withEmb.length; j++) {
      const ea = dataset.perItem[withEmb[i].id];
      const eb = dataset.perItem[withEmb[j].id];
      if (ea.image && eb.image && hammingDistance(ea.image.dhash, eb.image.dhash) <= thr) continue; // already a (near-)duplicate
      const ca = creativeEmb(withEmb[i].id)!;
      const cb = creativeEmb(withEmb[j].id)!;
      const c = cosineDense(ca.v, cb.v);
      if (c < sem.minCosine) continue;
      const weight = sem.weight * (0.5 + (0.5 * (c - sem.minCosine)) / Math.max(1e-9, 1 - sem.minCosine));
      const ev = `ten sam szablon kreacji (CLIP${ca.video || cb.video ? ", klatki wideo" : ""}, cosinus ${c.toFixed(2)})`;
      pushPair(withEmb[i].id, withEmb[j].id, simEvidence("similar_image_semantic", weight, ev, c));
      g.edge(nodeId("item", withEmb[i].id), nodeId("item", withEmb[j].id), "similar_image_semantic", ev, round(weight));
    }
  }

  // DOM structure similarity of landing pages (page kit reused on different domains)
  const finalUrlOf = (it: Item) => {
    const enr = dataset.perItem[it.id];
    return enr?.pageKey ? (dataset.pages[enr.pageKey]?.fetch.finalUrl ?? null) : null;
  };
  const withDom = items.filter((it) => typeof g.nodes.get(nodeId("item", it.id))?.data.domSimhash === "string");
  const domThr = config.similarity.dom.hamming;
  for (let i = 0; i < withDom.length; i++) {
    for (let j = i + 1; j < withDom.length; j++) {
      const fa = finalUrlOf(withDom[i]);
      if (fa && fa === finalUrlOf(withDom[j])) continue; // same page: already linked by URL/host
      const a = String(g.nodes.get(nodeId("item", withDom[i].id))!.data.domSimhash);
      const b = String(g.nodes.get(nodeId("item", withDom[j].id))!.data.domSimhash);
      const d = simhashDistance(a, b);
      if (d > domThr) continue;
      const weight = config.similarity.dom.weight * (1 - (0.5 * d) / Math.max(1, domThr));
      const ev = `ta sama struktura strony docelowej (simhash DOM, odległość ${d}/64)`;
      pushPair(withDom[i].id, withDom[j].id, simEvidence("similar_dom", weight, ev, 1 - d / 64));
      g.edge(nodeId("item", withDom[i].id), nodeId("item", withDom[j].id), "similar_dom", ev, round(weight));
    }
  }

  // Audio fingerprint similarity (same voice-over or music track; opt-in enrichment)
  const withAudio = items.filter((it) => (dataset.perItem[it.id]?.audioFp?.fingerprint.length ?? 0) > 0);
  for (let i = 0; i < withAudio.length; i++) {
    for (let j = i + 1; j < withAudio.length; j++) {
      const sim = fingerprintSimilarity(dataset.perItem[withAudio[i].id].audioFp!.fingerprint, dataset.perItem[withAudio[j].id].audioFp!.fingerprint);
      if (sim < config.similarity.audio.minSimilarity) continue;
      const span = Math.max(1e-9, 1 - config.similarity.audio.minSimilarity);
      const weight = config.similarity.audio.weight * (0.5 + (0.5 * (sim - config.similarity.audio.minSimilarity)) / span);
      const ev = `ta sama ścieżka dźwiękowa (Chromaprint, podobieństwo ${sim.toFixed(2)})`;
      pushPair(withAudio[i].id, withAudio[j].id, simEvidence("similar_audio", weight, ev, sim));
      g.edge(nodeId("item", withAudio[i].id), nodeId("item", withAudio[j].id), "similar_audio", ev, round(weight));
    }
  }

  // Speaker similarity (SpeechBrain ECAPA; opt-in): the same voice, also in a different recording.
  // A cloned voice of one public figure matches across unrelated operators, so it never links alone.
  const withVoice = items.filter((it) => (dataset.perItem[it.id]?.speakerEmbedding?.length ?? 0) > 0);
  const voice = config.similarity.voice;
  for (let i = 0; i < withVoice.length; i++) {
    for (let j = i + 1; j < withVoice.length; j++) {
      const ea = dataset.perItem[withVoice[i].id];
      const eb = dataset.perItem[withVoice[j].id];
      if (ea.audioFp?.fingerprint.length && eb.audioFp?.fingerprint.length && fingerprintSimilarity(ea.audioFp.fingerprint, eb.audioFp.fingerprint) >= config.similarity.audio.minSimilarity) continue; // same recording: similar_audio covers it
      const c = speakerSimilarity(ea.speakerEmbedding!, eb.speakerEmbedding!);
      if (c < voice.minCosine) continue;
      const weight = voice.weight * (0.5 + (0.5 * (c - voice.minCosine)) / Math.max(1e-9, 1 - voice.minCosine));
      const ev = `ten sam głos mówcy (SpeechBrain ECAPA, cosinus ${c.toFixed(2)}; także sklonowany głos tej samej osoby)`;
      pushPair(withVoice[i].id, withVoice[j].id, simEvidence("similar_voice", weight, ev, c));
      g.edge(nodeId("item", withVoice[i].id), nodeId("item", withVoice[j].id), "similar_voice", ev, round(weight));
    }
  }

  // Text similarity
  const textMethod = options.textMethod ?? (options.embeddings ? "embedding" : "tfidf");
  if (textMethod !== "none") {
    const texts = items.map((it) => textOf(it, dataset));
    const eligible = items
      .map((it, idx) => ({ it, idx }))
      .filter(({ idx }) => texts[idx].length >= config.similarity.text.minChars);
    let sim: (i: number, j: number) => number;
    let threshold: number;
    if (textMethod === "embedding" && options.embeddings) {
      const emb = options.embeddings;
      sim = (i, j) => {
        const a = emb[items[i].id];
        const b = emb[items[j].id];
        return a && b ? cosineDense(a, b) : 0;
      };
      threshold = config.similarity.text.embeddingThreshold;
    } else {
      const model = fitTfidf(texts);
      const vecs: SparseVector[] = texts.map((t) => model.transform(t));
      sim = (i, j) => cosineSparse(vecs[i], vecs[j]);
      threshold = config.similarity.text.tfidfThreshold;
    }
    for (let x = 0; x < eligible.length; x++) {
      for (let y = x + 1; y < eligible.length; y++) {
        const i = eligible[x].idx;
        const j = eligible[y].idx;
        const c = sim(i, j);
        if (c < threshold) continue;
        const weight = config.similarity.text.weight * (0.5 + (0.5 * (c - threshold)) / Math.max(1e-9, 1 - threshold));
        const ev = `podobna treść reklamy (cosinus ${c.toFixed(2)}, ${textMethod === "embedding" ? "embeddingi" : "TF-IDF n-gramów"})`;
        pushPair(items[i].id, items[j].id, simEvidence("similar_text", weight, ev, c));
        g.edge(nodeId("item", items[i].id), nodeId("item", items[j].id), "similar_text", ev, round(weight));
      }
    }
  }

  // Aggregate pair evidence into links
  const links: ItemLink[] = [];
  for (const [key, evidence] of pairs) {
    const [a, b] = key.split("\u0000");
    evidence.sort((x, y) => y.weight - x.weight);
    const score = combineScores(evidence.map((e) => e.weight));
    const strong = evidence.some((e) => e.strong);
    if (score < 0.05 && !strong) continue; // keep the graph light: only negligible (discounted) pairs are dropped
    links.push({ a, b, score: round(score), strong, evidence });
  }
  links.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));

  const nodes = [...g.nodes.values()].sort((x, y) => x.id.localeCompare(y.id));
  const edges = [...g.edges.values()].sort((x, y) => x.id.localeCompare(y.id));
  const byType: Partial<Record<EntityType, number>> = {};
  for (const t of ENTITY_TYPES) {
    const c = nodes.filter((nd) => nd.type === t).length;
    if (c) byType[t] = c;
  }
  return {
    version: 1,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    mode: dataset.mode,
    baseDir: dataset.baseDir,
    textMethod: textMethod === "embedding" && !options.embeddings ? "tfidf" : textMethod,
    stats: {
      items: n,
      nodes: nodes.length,
      edges: edges.length,
      links: links.length,
      strongLinks: links.filter((l) => l.strong).length,
      byType,
    },
    nodes,
    edges,
    links,
    ...(options.includeItemPivots ? { itemPivots: Object.fromEntries(factsByItem) } : {}),
  };
}

function simEvidence(edgeType: SimilarityEdgeType, weight: number, evidence: string, similarity?: number): PairEvidence {
  return {
    kind: "similarity",
    pivot: null,
    pivotType: null,
    edgeType,
    weight: round(weight),
    strong: false,
    discounted: false,
    evidence,
    ...(similarity !== undefined ? { similarity: round(similarity) } : {}),
    pathA: [],
    pathB: [],
  };
}

/** Text used for similarity: ad copy, falling back to the landing page title/description. */
export function textOf(item: Item, dataset: EnrichedDataset): string {
  const enr = dataset.perItem[item.id];
  // OCR of a screenshot: without the platform's interface labels, which every ad shares
  const ocr = enr?.ocrText ? stripUiChrome(enr.ocrText).text : null;
  const own = [item.text, ocr, enr?.asrText].filter((t): t is string => !!t && t.trim().length > 0).join("\n");
  if (own) return own;
  const ex = enr?.pageKey ? dataset.pages[enr.pageKey]?.extract : null;
  return [ex?.title, ex?.description].filter(Boolean).join(". ");
}

function dedupeFacts(facts: Fact[]): Fact[] {
  const best = new Map<string, Fact>();
  for (const f of facts) {
    const cur = best.get(f.pivot);
    if (!cur || f.relation > cur.relation || (f.relation === cur.relation && f.path.length < cur.path.length)) best.set(f.pivot, f);
  }
  return [...best.values()];
}

/**
 * Domains registered at the same registrar within N hours form a "registration burst" pivot.
 * Registrars are grouped by IANA ID when RDAP gives one: registries spell the same registrar
 * differently ("Example Inc" in one TLD, "Example, LLC" in another).
 */
function addRegistrationBursts(
  dataset: EnrichedDataset,
  g: GraphBuilder,
  factsByItem: Map<string, Fact[]>,
  config: LinkConfig,
): void {
  const windowMs = config.registrationBurstHours * 3_600_000;
  const byRegistrar = new Map<string, Array<{ domain: string; created: number }>>();
  for (const d of Object.values(dataset.domains)) {
    const reg = d.rdap?.registrar;
    const created = d.rdap?.created ? Date.parse(d.rdap.created) : NaN;
    if (!reg || Number.isNaN(created)) continue;
    const groupKey = d.rdap?.registrarIanaId != null ? `iana:${d.rdap.registrarIanaId}` : reg.toLowerCase();
    const list = byRegistrar.get(groupKey) ?? [];
    list.push({ domain: d.domain, created });
    byRegistrar.set(groupKey, list);
  }
  const burstOf = new Map<string, string>();
  for (const [groupKey, list] of byRegistrar) {
    list.sort((a, b) => a.created - b.created);
    let group: typeof list = [];
    const flush = () => {
      if (group.length >= 2) {
        const first = new Date(group[0].created).toISOString().slice(0, 10);
        const spanH = Math.round((group[group.length - 1].created - group[0].created) / 3_600_000);
        const regName = dataset.domains[group[0].domain]?.rdap?.registrar ?? "";
        const id = g.node("registrar", `${groupKey}|${first}`, `seria rejestracji: ${regName}, ${first} (${group.length} domen w ${spanH} h)`, {
          registrar: regName,
          burst: true,
          domains: group.map((x) => x.domain),
        });
        for (const x of group) {
          g.edge(nodeId("domain", x.domain), id, "registration_burst", `zarejestrowana ${new Date(x.created).toISOString().slice(0, 16).replace("T", " ")}`);
          burstOf.set(x.domain, id);
        }
      }
      group = [];
    };
    for (const entry of list) {
      if (group.length && entry.created - group[group.length - 1].created > windowMs) flush();
      group.push(entry);
    }
    flush();
  }
  if (!burstOf.size) return;
  for (const facts of factsByItem.values()) {
    const extra: Fact[] = [];
    for (const f of facts) {
      if (f.type !== "domain" || f.relation < 1) continue;
      const burst = burstOf.get(f.pivot.slice("domain:".length));
      if (!burst) continue;
      const label = g.nodes.get(burst)!;
      extra.push({
        pivot: burst,
        type: "registrar",
        path: [...f.path, burst],
        relation: 1,
        how: `domeny zarejestrowane seryjnie (${label.data.registrar}, w odstępie ≤ ${config.registrationBurstHours} h)`,
      });
    }
    facts.push(...dedupeFacts(extra).filter((e) => !facts.some((f) => f.pivot === e.pivot)));
  }
}

/**
 * Brand a page impersonates: the last part of its title after a dash or a bar ("… — Kurier Testowy"),
 * when the page's own domain does not carry that name. Null when the title names no such brand.
 */
export function impersonatedBrand(title: string | null | undefined, pageUrl: string | null | undefined): string | null {
  const parts = (title ?? "").split(/\s[—–|-]\s/);
  if (parts.length < 2) return null;
  const brand = parts[parts.length - 1].trim();
  if (brand.length < 3 || brand.length > 30 || brand.split(/\s+/).length > 3 || !/\p{L}/u.test(brand)) return null;
  const token = brand.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (token.length < 3) return null;
  let host = "";
  try {
    host = new URL(String(pageUrl ?? "")).hostname.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  } catch {
    return null;
  }
  return host.includes(token) || token.includes(host) ? null : brand;
}

function round(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

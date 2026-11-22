/**
 * Helpers for building small enriched datasets in unit tests (no network).
 */
import type { AdLibraryInfo } from "../osint/adLibrary";
import type { CampaignParam, CampaignParamName } from "../osint/campaignParams";
import type { ContactIds } from "../osint/contactIds";
import type { PageExtract, TrackerId } from "../osint/extract";
import { normalizeEndpointPath, type EndpointRef, type PageKit } from "../osint/pagekit";
import { normalizeUrl, registrableDomain } from "../osint/urls";
import { personaSlug, type PersonaMatch } from "../text/persona";
import type { EnrichedDataset, Item, PageInfo } from "../pipeline/types";

export interface TestItemSpec {
  id: string;
  url?: string;
  text?: string;
  advertiser?: string;
  /** Unmapped input columns (`Item.extra`), e.g. the columns of an ad-library record. */
  extra?: Record<string, string>;
  label?: string;
  firstSeen?: string;
  dhash?: string;
  /** CLIP image embedding (any length; compared by cosine). */
  imageEmbedding?: number[];
  /** CLIP video embedding (frame mean). */
  videoEmbedding?: number[];
  trackers?: TrackerId[];
  pageTitle?: string;
  pageText?: string;
  outboundDomains?: string[];
  /** Links of the landing page (CTA hrefs and others), as the page extract keeps them. */
  outboundUrls?: string[];
  emails?: string[];
  phones?: string[];
  /** Example numbers of the lead form (placeholder, "np. …" help text), as the page extract keeps them. */
  phoneExamples?: string[];
  wallets?: Array<{ kind: "btc" | "eth" | "tron"; address: string }>;
  /** Shared documents, onion addresses and messenger invitations of the landing page (I28), as the page extract keeps them. */
  contactIds?: Partial<ContactIds>;
  redirects?: string[];
  persona?: string;
  deepfakeScore?: number;
  /** Persona names found in text (watchlist matches). */
  personas?: string[];
  /** Group of the public list for the personas by name (e.g. { "Adam Testowy": "Dziennikarze" }); a persona without an entry has none. */
  personaCategories?: Record<string, string>;
  params?: Array<{ name: CampaignParamName; value: string }>;
  kit?: Partial<PageKit>;
  /** Raw OCR text of the creative (e.g. a screenshot of the ad). */
  ocrText?: string;
  /** Transcript of the video creative (ASR). */
  asrText?: string;
  /** SpeechBrain speaker embedding (compared by dot product). */
  speakerEmbedding?: number[];
  /** Meta Ad Library records of the item. */
  adLibrary?: AdLibraryInfo[];
  /** SHA-256 of the image file of the creative (needs dhash). */
  imageSha256?: string;
  /** SHA-256 of the video file of the creative. */
  videoSha256?: string;
  /** Chromaprint values of the video/audio creative. */
  audioFingerprint?: number[];
  /** Shodan mmh3 hash of the landing page's favicon (the other hashes are derived from it). */
  faviconMmh3?: number;
  /** Brand recognised on the creative (CLIP zero-shot), as enrich would store it. */
  creativeBrand?: { id: string; name: string; kind: string; probability: number };
}

export function emptyKit(over: Partial<PageKit> = {}): PageKit {
  return { endpoints: [], domSimhash: null, tagCount: 0, hiddenFields: [], assets: [], comments: [], cyrillicComments: false, pathIds: [], ...over };
}

/** Builds an EndpointRef as the page-kit extractor would for `url` found on a page at `pageUrl`. */
export function endpointRef(url: string, pageUrl: string, via: EndpointRef["via"] = "form"): EndpointRef {
  const u = new URL(url, pageUrl);
  const pageHost = new URL(pageUrl).hostname;
  const pathTemplate = normalizeEndpointPath(u.pathname);
  const sameOrigin = u.hostname === pageHost;
  return { key: sameOrigin ? `*${pathTemplate}` : `${u.hostname}${pathTemplate}`, host: u.hostname, pathTemplate, sameOrigin, method: "POST", via, raw: url };
}

export interface TestInfra {
  /** host -> IPs */
  hosts?: Record<string, string[]>;
  /** ip -> asn, asName */
  asns?: Record<string, { asn: number; asName: string }>;
  /** domain -> NS list */
  ns?: Record<string, string[]>;
  /** domain -> TXT records */
  txt?: Record<string, string[]>;
  /** domain -> registrar/created, RDAP status (e.g. "client hold") */
  rdap?: Record<string, { registrar: string; created: string; ianaId?: string; status?: string[] }>;
  /** domain -> certs */
  certs?: Record<string, Array<{ id: string; issuer: string; sanDomains: string[]; notBefore?: string }>>;
  /** host -> CNAME chain */
  cname?: Record<string, string[]>;
}

export function emptyExtract(over: Partial<PageExtract> = {}): PageExtract {
  return {
    title: null,
    description: null,
    canonical: null,
    ogTitle: null,
    ogDescription: null,
    ogImage: null,
    ogSiteName: null,
    trackers: [],
    faviconUrl: null,
    outboundDomains: [],
    outboundUrls: [],
    emails: [],
    phones: [],
    telegram: [],
    whatsapp: [],
    wallets: [],
    metaRefresh: null,
    jsRedirects: [],
    visibleText: "",
    generator: null,
    ...over,
  };
}

/**
 * Builds an enriched dataset from test specs without network: one item (and page, when it has a URL) per
 * spec, plus hosts, IPs, NS, RDAP (registrar, creation date, status) and certificates from `infra`.
 */
export function makeDataset(specs: TestItemSpec[], infra: TestInfra = {}): EnrichedDataset {
  const ds: EnrichedDataset = {
    version: 1,
    generatedAt: "2026-11-01T00:00:00.000Z",
    mode: "offline",
    baseDir: ".",
    items: [],
    perItem: {},
    pages: {},
    hosts: {},
    domains: {},
    ips: {},
  };
  for (const s of specs) {
    const item: Item = {
      id: s.id,
      platform: "test",
      advertiser: s.advertiser ?? null,
      text: s.text ?? null,
      imageUrl: null,
      imagePath: null,
      landingUrl: s.url ?? null,
      firstSeen: s.firstSeen ?? "2026-10-01T00:00:00.000Z",
      lastSeen: null,
      label: s.label ?? null,
      persona: s.persona ?? null,
      deepfakeScore: s.deepfakeScore ?? null,
      videoPath: null,
      extra: s.extra ?? {},
    };
    ds.items.push(item);
    const landing = s.url ? normalizeUrl(s.url) : null;
    let pageKey: string | null = null;
    if (landing) {
      pageKey = landing.url;
      const chainUrls = [landing.url, ...(s.redirects ?? [])];
      const finalUrl = chainUrls[chainUrls.length - 1];
      const page: PageInfo = {
        requestedUrl: landing.url,
        fetch: {
          requestedUrl: landing.url,
          finalUrl,
          status: 200,
          ok: true,
          redirectChain: chainUrls.slice(0, -1).map((u, i) => ({ url: u, status: 302, location: chainUrls[i + 1], kind: "http" as const })),
          contentType: "text/html",
          headers: {},
          bytes: 100,
          truncated: false,
          bodySha256: null,
          userAgent: "test",
          remoteAddress: null,
          error: null,
          errorCode: null,
          fetchedAt: "2026-11-01T00:00:00.000Z",
          durationMs: 1,
        },
        extract: emptyExtract({
          title: s.pageTitle ?? null,
          visibleText: s.pageText ?? "",
          trackers: s.trackers ?? [],
          outboundDomains: s.outboundDomains ?? [],
          outboundUrls: s.outboundUrls ?? [],
          emails: s.emails ?? [],
          phones: s.phones ?? [],
          phoneExamples: s.phoneExamples ?? [],
          wallets: s.wallets ?? [],
          ...s.contactIds,
        }),
        favicon:
          s.faviconMmh3 === undefined
            ? null
            : { url: new URL("/favicon.ico", landing.url).toString(), hashes: { mmh3: s.faviconMmh3, sha256: `sha-${s.faviconMmh3}`, dhash: null, ahash: null, format: "ico" }, error: null },
        kit: emptyKit(s.kit),
        archiveFile: null,
        cloaking: null,
      };
      ds.pages[pageKey] = page;
      for (const u of chainUrls) {
        const nu = normalizeUrl(u)!;
        const ips = infra.hosts?.[nu.host] ?? [];
        ds.hosts[nu.host] = { host: nu.host, registrableDomain: nu.registrableDomain, dns: null, ips, cnameChain: infra.cname?.[nu.host] ?? [] };
        for (const ip of ips) {
          const a = infra.asns?.[ip];
          ds.ips[ip] = a
            ? { ip, asn: a.asn, asns: [a.asn], prefix: null, country: null, registry: null, allocated: null, asName: a.asName }
            : null;
        }
        const d = registrableDomain(nu.host);
        if (d && !ds.domains[d]) {
          const r = infra.rdap?.[d];
          ds.domains[d] = {
            domain: d,
            ns: infra.ns?.[d] ?? [],
            mx: [],
            txt: infra.txt?.[d] ?? [],
            rdap: r
              ? { domain: d, registrar: r.registrar, registrarIanaId: r.ianaId ?? null, created: r.created, expires: null, updated: null, status: r.status ?? [], nameservers: [], abuseEmail: null, source: null }
              : null,
            ct: infra.certs?.[d]
              ? {
                  domain: d,
                  truncated: false,
                  certs: infra.certs[d].map((c) => ({
                    id: c.id,
                    serial: c.id,
                    issuer: c.issuer,
                    issuerName: `O=${c.issuer}`,
                    commonName: c.sanDomains[0],
                    sanDomains: c.sanDomains,
                    notBefore: c.notBefore ?? "2026-09-01T00:00:00",
                    notAfter: "2026-12-01T00:00:00",
                    entryTimestamp: null,
                  })),
                }
              : null,
          };
        }
      }
    }
    ds.perItem[s.id] = {
      itemId: s.id,
      landing,
      pageKey,
      text: null,
      image: s.dhash ? { dhash: s.dhash, ahash: s.dhash, width: 100, height: 100, format: "png", source: "test", ...(s.imageSha256 ? { sha256: s.imageSha256 } : {}) } : null,
      personas: (s.personas ?? []).map((name): PersonaMatch => ({ id: personaSlug(name), name, matched: name.toLowerCase(), source: "watchlist", role: null, category: s.personaCategories?.[name] ?? null })),
      campaignParams: (s.params ?? []).map(
        (p): CampaignParam => ({ name: p.name, canonicalName: p.name, value: p.value, sourceUrl: s.url ?? "", cyrillic: /[\u0400-\u04FF]/.test(p.value), macro: false }),
      ),
      ocrText: s.ocrText ?? null,
      asrText: s.asrText ?? null,
      audioFp: s.audioFingerprint ? { duration: s.audioFingerprint.length / 8, fingerprint: s.audioFingerprint } : null,
      ...(s.videoSha256 ? { videoSha256: s.videoSha256 } : {}),
      ...(s.imageEmbedding ? { imageEmbedding: s.imageEmbedding } : {}),
      ...(s.videoEmbedding ? { videoEmbedding: s.videoEmbedding } : {}),
      ...(s.speakerEmbedding ? { speakerEmbedding: s.speakerEmbedding } : {}),
      ...(s.adLibrary ? { adLibrary: s.adLibrary } : {}),
      ...(s.creativeBrand ? { creativeBrand: s.creativeBrand } : {}),
      errors: [],
    };
  }
  return ds;
}

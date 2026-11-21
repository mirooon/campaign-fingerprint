/**
 * Linking configuration: entity type weights, thresholds and the deny/weak lists
 * for ubiquitous infrastructure. Everything here can be overridden with a JSON
 * file (see loadLinkConfig / mergeConfig) so the hackathon dataset can be tuned
 * without code changes.
 */
import type { EntityType } from "./model";

export interface ListRule {
  /** Exact value, suffix (".example.com") or substring depending on the list. */
  match: string;
  factor: number;
  reason: string;
}

export interface AsnRule {
  asn: number;
  /** Factor for the ASN pivot itself. */
  factor: number;
  /** Factor applied to IPs announced by this ASN (shared CDN/proxy IPs). */
  ipFactor: number;
  reason: string;
}

export interface CidrRule {
  cidr: string;
  factor: number;
  reason: string;
}

export interface LinkConfig {
  typeWeights: Record<EntityType, number>;
  /** Pivot weight (type x list factor) needed for union-find (merging) evidence. */
  strongThreshold: number;
  /** An entity shared by more than this fraction of all items is never strong. */
  maxStrongDfRatio: number;
  /** Entities shared by more items than this are not expanded into item pairs. */
  maxPivotDf: number;
  /**
   * Inverse-frequency weighting. `ubiquityStart`: beyond this share of all items an entity is
   * penalised linearly down to 0.1 at 100% (only when the dataset has >= `ubiquityMinItems` items):
   * something present on almost every page is a shared template or infrastructure, not a campaign.
   */
  idf: { enabled: boolean; floor: number; ubiquityStart: number; ubiquityMinItems: number };
  /** Minimum combined pair score for an edge in the clustering graph. */
  minLinkScore: number;
  /**
   * Which non-strong links may join two ads into one campaign (first level). A link must carry
   * evidence of at least `minEvidenceKinds` different kinds (discounted evidence does not count).
   * One kind is enough unless it is in `notAloneKinds` (page-kit traits that are sold and reused
   * across operators, and personas); such a kind alone needs `singleKindMinScore`. Discounted
   * evidence counts only when its weight after the discount is still `discountedMinWeight`. With `accountConflict`, ads on the same
   * landing-page platform under different accounts are never joined by non-strong evidence:
   * a shared kit then makes them similar campaigns (second level), not one campaign.
   */
  campaignRules: {
    minEvidenceKinds: number;
    singleKindMinScore: number;
    notAloneKinds: string[];
    accountConflict: boolean;
    discountedMinWeight: number;
    /** Evidence kinds that never count for a campaign (score, kinds, clustering weight), only for groups of similar campaigns. */
    familyOnlyKinds?: string[];
    /**
     * Content evidence (similar copy, picture, recording, voice): copies of one lander or creative are
     * reused by unrelated operators. Between two ads without infrastructure a campaign needs
     * `minContentKinds` different content kinds; when either ad has infrastructure, content counts as
     * one kind that never joins alone.
     */
    contentKinds?: string[];
    minContentKinds?: number;
    /**
     * Content kinds that join a content-only link when either ad has infrastructure. null (default):
     * never, content then only corroborates other evidence. 2 restores the older reading in which a
     * picture plus copy similar to an ad with an address joins it (e.g. a screenshot without a URL).
     */
    contentKindsWithInfrastructure?: number | null;
    /**
     * Pivot types that are infrastructure of an ad (addresses, hosting, backends, platform account and
     * campaign, tracker server, ad and campaign identifiers, trackers). An ad has infrastructure when it
     * holds such a pivot with weight (type x list factor x relation) >= `infrastructureMinWeight`.
     */
    infrastructureKinds?: string[];
    infrastructureMinWeight?: number;
    /**
     * The same creative file joins alone (unless the accounts conflict): an identical SHA-256 of the image
     * or video ("creative_sha256"), or video frames with CLIP cosine >= `clipMinCosine` plus the same audio.
     */
    sameCreative?: { clipMinCosine: number };
    /**
     * Variant of a known creative (a screenshot with a sticker, a crop): a campaign with no
     * infrastructure, joined by content only (usually one material), joins the only campaign with
     * infrastructure whose creatives its own nearly repeat. Nearly repeat: the same dHash, the same
     * file, dHash within `imageHamming` bits, or CLIP cosine >= `clipMinCosine`. This attaches, never
     * merges: it is a step after the campaigns are built, and a creative near those of two or more
     * campaigns attaches nowhere. Similar copy never attaches (text templates travel between operators).
     * null switches the step off.
     */
    contentVariant?: { imageHamming: number; clipMinCosine: number } | null;
  };
  /** Base weight of the "same creative file" pivot (SHA-256 of the image or video file). */
  creativeFileWeight?: number;
  /** Minimum score (non-discounted evidence only) of a link that puts two campaigns in one family. */
  familyMinScore: number;
  similarity: {
    imageHamming: number;
    imageWeight: number;
    /** CLIP embedding cosine of creatives (opt-in enrichment): same template, different variant. */
    imageSemantic: { minCosine: number; weight: number };
    text: {
      tfidfThreshold: number;
      embeddingThreshold: number;
      weight: number;
      minChars: number;
    };
    /** DOM tag-structure simhash of landing pages (page-kit similarity). */
    dom: { hamming: number; weight: number };
    /** Chromaprint audio fingerprints of video/audio creatives (opt-in enrichment). */
    audio: { minSimilarity: number; weight: number };
    /** SpeechBrain ECAPA speaker embeddings (opt-in): the same voice, possibly a clone of one public figure. */
    voice: { minCosine: number; weight: number };
  };
  /** Page-kit and campaign-metadata pivots. */
  kit: {
    /** Multiplier for endpoints on the page's own host (path template = kit fingerprint, not a backend). */
    sameOriginEndpointFactor: number;
    /** Extra multiplier for same-origin endpoint paths with at most 2 segments ("/api/x", "/send"). */
    shortEndpointPathFactor: number;
    /** Minimum number of non-generic hidden input names to form a pivot. */
    minHiddenFields: number;
    /** A domain-name template becomes a pivot only when this many distinct domains share it. */
    domainPatternMinDomains: number;
    /** Templates with fewer literal letters than this are weakly anchored. */
    domainPatternMinLiteralChars: number;
    domainPatternNoAnchorFactor: number;
    /** Multiplier for the TLD-agnostic template (e.g. "finance<n>-<lorem><n>.*"). */
    domainPatternAgnosticFactor: number;
    /** Multiplier for campaign-parameter values that are plain words (may coincide across actors). */
    campaignParamWordFactor: number;
    /** Multiplier for a favicon of a brand the page impersonates (title names a brand its domain does not carry). */
    brandAssetFactor: number;
  };
  /** Multiplier for pivots reached through an outbound link rather than hosting. */
  outboundLinkFactor: number;
  registrationBurstHours: number;
  /** Base weight of a "registration burst" pivot (same registrar within the window). */
  registrationBurstWeight: number;
  /** Certificates spanning more registrable domains than this are treated as shared. */
  maxCertDomains: number;
  louvain: { resolution: number; seed: number };
  lists: {
    asns: AsnRule[];
    ipCidrs: CidrRule[];
    /** Suffix match on each nameserver host. */
    nameserverSuffixes: ListRule[];
    /** Case-insensitive substring match on the issuer. */
    certIssuers: ListRule[];
    /** Suffix match on SAN names: marks CDN-shared certificates. */
    certSanMarkers: ListRule[];
    /** Case-insensitive substring match on the registrar name. */
    registrars: ListRule[];
    /** Registrable domains that are platforms, shorteners or CDNs (suffix match). */
    domains: ListRule[];
    /** Exact pivot keys to discount, e.g. "tracker:ga4:G-XXXX", "favicon:mmh3:123". */
    pivots: ListRule[];
    /** Regexes (case-insensitive) on page title/text that indicate a parked domain. */
    parkingPatterns: string[];
    parkingFactor: number;
    /** Suffix match on the endpoint host: public form, analytics and geolocation services. */
    endpointHosts: ListRule[];
    /** Exact match on a same-origin endpoint path template ("/submit", "/contact.php" ...). */
    endpointGenericPaths: ListRule[];
    /**
     * Paths of a platform used by many operators (SDK of a landing-page platform, script of a tracker
     * product), shared by all its accounts or installations: applied to endpoint paths (any origin) and
     * asset paths. A rule ending in "/" is a prefix, otherwise the path itself or a path below it.
     */
    endpointPlatformPaths: ListRule[];
    /**
     * Suffix match on the host of a cross-origin backend (or script) without a client identifier:
     * services of many clients (form handlers, lead collectors, webhook relays, CRMs). A backend there
     * is a trait of the service, not of one operator; with a client ID in the key it stays strong.
     */
    multiTenantBackends?: ListRule[];
    /** Exact `name:shape` part of a link template (param_schema) that is the link format of a tracker product. */
    paramSchemaPlatformParts?: ListRule[];
    /** Hidden input names ignored when building the hidden-field set (CSRF, form-service keys ...). */
    hiddenFieldGeneric: string[];
    /** Case-insensitive regex on the asset basename: well-known libraries and generic file names. */
    assetLibraries: ListRule[];
    /** Case-insensitive regex on the normalised comment: tracker snippets and CMS boilerplate. */
    commentPatterns: ListRule[];
    /** Suffix match on CNAME targets: CDNs and hosting platforms. */
    cnameTargets: ListRule[];
    /** Prefix match on the path before a path_id: platforms where that UUID names an app or theme, not a customer. */
    pathIdSharedPrefixes: ListRule[];
    /** Exact (lower-case) campaign-parameter values that are generic. */
    campaignParamGenericValues: string[];
    /** Canonical parameter names whose values are rarely specific (utm_source, utm_medium). */
    campaignParamWeakNames: ListRule[];
  };
}

const CF = "Cloudflare (współdzielony anycast/proxy CDN)";

export const DEFAULT_LINK_CONFIG: LinkConfig = {
  typeWeights: {
    item: 0,
    url: 1.0,
    host: 0.95,
    domain: 0.95,
    tracker: 1.0,
    wallet: 1.0,
    email: 0.9,
    phone: 0.9,
    telegram: 0.9,
    cert: 0.8,
    imagehash: 0.65,
    advertiser: 0.6,
    ip: 0.6,
    favicon: 0.5,
    nameserver: 0.35,
    registrar: 0.05,
    asn: 0.05,
    // Research ranking (backend > kit > domain pattern > CNAME > campaign metadata > ... > persona)
    endpoint: 0.95,
    campaign_param: 0.8,
    cname_target: 0.65,
    hidden_fields: 0.6,
    comment: 0.6,
    domain_pattern: 0.6,
    asset: 0.55,
    // One celebrity appears in many unrelated campaigns: below minLinkScore on its own.
    persona: 0.1,
    // A random UUID shared by resource paths on different domains: one page-builder account.
    path_id: 0.85,
    // The link template identifies a traffic-distribution system, which many operators may rent:
    // corroborates other evidence, stays below minLinkScore on its own.
    param_schema: 0.12,
    // Explicit records of a landing-page platform: the account and the campaign name the operator,
    // the template names a kit that several accounts may use.
    platform_account: 0.9,
    platform_campaign: 0.95,
    page_template: 0.35,
    // Same tracker process (machine + PID in the xid click ID): shared click routing, not proof of one buyer.
    click_server: 0.6,
    // Same clicked ad (ad ID inside fbclid).
    meta_ad: 0.95,
    // The payer declared to Meta under the DSA (one paying account behind several ads);
    // a free-text name, so generic names are damped by IDF like any other pivot.
    ad_payer: 0.7,
    // The same set of comment authors written into pages on different domains: one page template.
    // A template trace like page_template: it needs a second kind of evidence to join a campaign.
    comment_block: 0.45,
    // Technique of the page (fake app store, back trap, fake social post, fake comments): the same
    // modus operandi, counted only for groups of similar campaigns (campaignRules.familyOnlyKinds).
    technique: 0.2,
  },
  strongThreshold: 0.7,
  maxStrongDfRatio: 0.5,
  maxPivotDf: 400,
  idf: { enabled: true, floor: 0.2, ubiquityStart: 0.5, ubiquityMinItems: 10 },
  minLinkScore: 0.15,
  campaignRules: {
    minEvidenceKinds: 2,
    singleKindMinScore: 0.5,
    notAloneKinds: ["similar_dom", "comment", "asset", "hidden_fields", "page_template", "favicon", "endpoint", "param_schema", "comment_block"],
    // a persona (impersonated public figure) appears in campaigns of many unrelated operators
    familyOnlyKinds: ["technique", "persona"],
    accountConflict: true,
    discountedMinWeight: 0.3,
    contentKinds: ["similar_text", "similar_image", "similar_image_semantic", "similar_audio", "similar_voice", "imagehash"],
    minContentKinds: 2,
    contentKindsWithInfrastructure: null,
    infrastructureKinds: [
      "url",
      "host",
      "domain",
      "ip",
      "nameserver",
      "cert",
      "cname_target",
      "endpoint",
      "platform_account",
      "platform_campaign",
      "click_server",
      "meta_ad",
      "campaign_param",
      "path_id",
      "tracker",
    ],
    infrastructureMinWeight: 0.3,
    sameCreative: { clipMinCosine: 0.97 },
    // duplicate <= 4 bits, similar picture <= 10; on the sample stickers move 2-5 bits, crops 5-6,
    // different creatives >= 16. CLIP: template 0.9, the same video file 0.97 with the same audio.
    contentVariant: { imageHamming: 6, clipMinCosine: 0.95 },
  },
  creativeFileWeight: 0.95,
  familyMinScore: 0.3,
  similarity: {
    imageHamming: 10,
    imageWeight: 0.6,
    imageSemantic: { minCosine: 0.9, weight: 0.45 },
    text: { tfidfThreshold: 0.5, embeddingThreshold: 0.86, weight: 0.5, minChars: 25 },
    dom: { hamming: 6, weight: 0.45 },
    audio: { minSimilarity: 0.85, weight: 0.5 },
    // same speaker 0.86-0.93, different speakers <= 0.34 on test recordings
    voice: { minCosine: 0.6, weight: 0.4 },
  },
  kit: {
    sameOriginEndpointFactor: 0.4,
    shortEndpointPathFactor: 0.5,
    minHiddenFields: 2,
    domainPatternMinDomains: 2,
    domainPatternMinLiteralChars: 3,
    domainPatternNoAnchorFactor: 0.3,
    domainPatternAgnosticFactor: 0.85,
    campaignParamWordFactor: 0.75,
    brandAssetFactor: 0.1,
  },
  outboundLinkFactor: 0.4,
  registrationBurstHours: 48,
  registrationBurstWeight: 0.3,
  maxCertDomains: 25,
  louvain: { resolution: 1.0, seed: 42 },
  lists: {
    asns: [
      { asn: 13335, factor: 0.02, ipFactor: 0.02, reason: CF },
      { asn: 209242, factor: 0.02, ipFactor: 0.02, reason: CF },
      { asn: 20940, factor: 0.05, ipFactor: 0.05, reason: "Akamai (CDN)" },
      { asn: 16625, factor: 0.05, ipFactor: 0.05, reason: "Akamai (CDN)" },
      { asn: 54113, factor: 0.05, ipFactor: 0.05, reason: "Fastly (CDN)" },
      { asn: 19551, factor: 0.05, ipFactor: 0.05, reason: "Imperva/Incapsula (proxy)" },
      { asn: 30148, factor: 0.05, ipFactor: 0.05, reason: "Sucuri (proxy)" },
      { asn: 60068, factor: 0.1, ipFactor: 0.1, reason: "CDN77/Datacamp (CDN)" },
      { asn: 199524, factor: 0.1, ipFactor: 0.1, reason: "G-Core (CDN)" },
      { asn: 15169, factor: 0.05, ipFactor: 0.2, reason: "Google (współdzielona infrastruktura)" },
      { asn: 396982, factor: 0.05, ipFactor: 0.5, reason: "Google Cloud" },
      { asn: 16509, factor: 0.05, ipFactor: 0.3, reason: "Amazon AWS (w tym CloudFront)" },
      { asn: 14618, factor: 0.05, ipFactor: 0.3, reason: "Amazon AWS" },
      { asn: 8075, factor: 0.05, ipFactor: 0.3, reason: "Microsoft/Azure" },
      { asn: 32934, factor: 0.05, ipFactor: 0.1, reason: "Meta (infrastruktura platformy)" },
      { asn: 46606, factor: 0.1, ipFactor: 0.3, reason: "Unified Layer (hosting współdzielony)" },
      { asn: 26496, factor: 0.1, ipFactor: 0.3, reason: "GoDaddy (hosting współdzielony)" },
      { asn: 47583, factor: 0.1, ipFactor: 0.3, reason: "Hostinger (hosting współdzielony)" },
    ],
    ipCidrs: [
      ...[
        "173.245.48.0/20",
        "103.21.244.0/22",
        "103.22.200.0/22",
        "103.31.4.0/22",
        "141.101.64.0/18",
        "108.162.192.0/18",
        "190.93.240.0/20",
        "188.114.96.0/20",
        "197.234.240.0/22",
        "198.41.128.0/17",
        "162.158.0.0/15",
        "104.16.0.0/13",
        "104.24.0.0/14",
        "172.64.0.0/13",
        "131.0.72.0/22",
        "2400:cb00::/32",
        "2606:4700::/32",
        "2803:f800::/32",
        "2405:b500::/32",
        "2405:8100::/32",
        "2a06:98c0::/29",
        "2c0f:f248::/32",
      ].map((cidr) => ({ cidr, factor: 0.02, reason: CF })),
      { cidr: "151.101.0.0/16", factor: 0.05, reason: "Fastly (CDN)" },
      { cidr: "76.76.21.0/24", factor: 0.05, reason: "Vercel (anycast platformy)" },
      { cidr: "75.2.60.5/32", factor: 0.05, reason: "Netlify (load balancer platformy)" },
      { cidr: "185.199.108.0/22", factor: 0.05, reason: "GitHub Pages" },
      { cidr: "199.36.158.100/32", factor: 0.05, reason: "Firebase Hosting" },
    ],
    nameserverSuffixes: [
      { match: "ns.cloudflare.com", factor: 0.1, reason: "NS Cloudflare (masowo współdzielone)" },
      { match: "awsdns", factor: 0.1, reason: "Amazon Route 53" },
      { match: "domaincontrol.com", factor: 0.1, reason: "NS GoDaddy" },
      { match: "registrar-servers.com", factor: 0.1, reason: "NS Namecheap" },
      { match: "googledomains.com", factor: 0.1, reason: "NS Google/Squarespace" },
      { match: "azure-dns.com", factor: 0.1, reason: "Azure DNS" },
      { match: "nsone.net", factor: 0.1, reason: "NS1" },
      { match: "dnsmadeeasy.com", factor: 0.1, reason: "DNS Made Easy" },
      { match: "ultradns.net", factor: 0.1, reason: "UltraDNS" },
      { match: "akam.net", factor: 0.1, reason: "Akamai DNS" },
      { match: "name-services.com", factor: 0.1, reason: "NS eNom" },
      { match: "worldnic.com", factor: 0.1, reason: "NS Network Solutions" },
      { match: "dnsowl.com", factor: 0.1, reason: "NS NameSilo" },
      { match: "porkbun.com", factor: 0.1, reason: "NS Porkbun" },
      { match: "ovh.net", factor: 0.1, reason: "NS OVH" },
      { match: "wixdns.net", factor: 0.1, reason: "NS Wix" },
      { match: "vercel-dns.com", factor: 0.1, reason: "NS Vercel" },
      { match: "digitalocean.com", factor: 0.1, reason: "NS DigitalOcean" },
      { match: "linode.com", factor: 0.1, reason: "NS Linode" },
      { match: "home.pl", factor: 0.1, reason: "NS home.pl" },
      { match: "nazwa.pl", factor: 0.1, reason: "NS nazwa.pl" },
      { match: "sedoparking.com", factor: 0.05, reason: "NS parkingu domen (Sedo)" },
      { match: "parkingcrew.net", factor: 0.05, reason: "NS parkingu domen (ParkingCrew)" },
      { match: "bodis.com", factor: 0.05, reason: "NS parkingu domen (Bodis)" },
      { match: "above.com", factor: 0.05, reason: "NS parkingu domen (Above)" },
      { match: "dns-parking.com", factor: 0.05, reason: "NS parkingu/hostingu (Hostinger)" },
      { match: "afternic.com", factor: 0.05, reason: "NS parkingu domen (Afternic)" },
      { match: "dan.com", factor: 0.05, reason: "NS parkingu domen (Dan.com)" },
    ],
    certIssuers: [
      { match: "let's encrypt", factor: 0.6, reason: "darmowy CA (Let's Encrypt)" },
      { match: "zerossl", factor: 0.6, reason: "darmowy CA (ZeroSSL)" },
      { match: "google trust services", factor: 0.6, reason: "darmowy/automatyczny CA (Google Trust Services)" },
      { match: "cloudflare", factor: 0.5, reason: "certyfikat wystawiony dla proxy Cloudflare" },
      { match: "cpanel", factor: 0.6, reason: "automatyczny CA hostingu (cPanel)" },
      { match: "buypass", factor: 0.6, reason: "darmowy CA (Buypass Go)" },
    ],
    certSanMarkers: [
      { match: "cloudflaressl.com", factor: 0.02, reason: "współdzielony certyfikat Cloudflare" },
      { match: "incapsula.com", factor: 0.02, reason: "współdzielony certyfikat Imperva" },
      { match: "edgecastcdn.net", factor: 0.05, reason: "współdzielony certyfikat CDN" },
    ],
    registrars: [
      "godaddy",
      "namecheap",
      "namesilo",
      "tucows",
      "public domain registry",
      "hostinger",
      "ovh",
      "gandi",
      "porkbun",
      "cloudflare",
      "squarespace",
      "google",
      "dynadot",
      "alibaba",
      "hichina",
      "reg.ru",
      "enom",
      "network solutions",
      "ionos",
      "key-systems",
      "epik",
      "home.pl",
      "nazwa.pl",
      "cyber_folks",
    ].map((match) => ({ match, factor: 0.6, reason: `popularny rejestrator (${match})` })),
    domains: [
      ...[
        "facebook.com",
        "fb.com",
        "fb.me",
        "instagram.com",
        "messenger.com",
        "whatsapp.com",
        "wa.me",
        "t.me",
        "telegram.org",
        "telegram.me",
        "google.com",
        "goo.gl",
        "g.co",
        "youtube.com",
        "youtu.be",
        "tiktok.com",
        "twitter.com",
        "x.com",
        "t.co",
        "linkedin.com",
        "lnkd.in",
        "apple.com",
        "microsoft.com",
        "wikipedia.org",
        "yandex.ru",
        "yandex.com",
      ].map((match) => ({ match, factor: 0, reason: "duża platforma (nie świadczy o powiązaniu)" })),
      ...[
        "bit.ly",
        "bitly.com",
        "tinyurl.com",
        "ow.ly",
        "buff.ly",
        "is.gd",
        "cutt.ly",
        "rebrand.ly",
        "shorturl.at",
        "rb.gy",
        "linktr.ee",
      ].map((match) => ({ match, factor: 0, reason: "skracacz linków (liczy się pełny URL, nie domena)" })),
      ...[
        "cloudflare.com",
        "googleapis.com",
        "gstatic.com",
        "googletagmanager.com",
        "google-analytics.com",
        "doubleclick.net",
        "googlesyndication.com",
        "facebook.net",
        "fbcdn.net",
        "jsdelivr.net",
        "unpkg.com",
        "bootstrapcdn.com",
        "jquery.com",
        "fontawesome.com",
        "gravatar.com",
        "wp.com",
        "wordpress.org",
        "wordpress.com",
        "w3.org",
        "schema.org",
        "cloudfront.net",
        "amazonaws.com",
        "akamaihd.net",
        "tiktokcdn.com",
      ].map((match) => ({ match, factor: 0, reason: "CDN/biblioteka/usługa współdzielona" })),
      ...["onet.pl", "wp.pl", "interia.pl", "gazeta.pl", "o2.pl", "money.pl", "bankier.pl", "tvn24.pl", "polsatnews.pl", "rmf24.pl"].map(
        (match) => ({ match, factor: 0, reason: "popularny portal (linki dla uwiarygodnienia)" }),
      ),
    ],
    pivots: [],
    parkingPatterns: [
      "domain (is|may be) for sale",
      "buy this domain",
      "this domain is parked",
      "parked (free|domain)",
      "domain parking",
      "sedo",
      "parkingcrew",
      "domena (jest )?na sprzeda[zż]",
      "domena (jest )?zaparkowana",
      "ta domena mo[zż]e by[cć] na sprzeda[zż]",
    ],
    parkingFactor: 0.05,
    endpointHosts: [
      ...[
        "web3forms.com",
        "formspree.io",
        "formsubmit.co",
        "getform.io",
        "formcarry.com",
        "usebasin.com",
        "staticforms.xyz",
        "jotform.com",
        "typeform.com",
        "wufoo.com",
        "cognitoforms.com",
        "paperform.co",
        "tally.so",
        "hsforms.com",
        "hsforms.net",
        "hubspot.com",
        "list-manage.com",
        "mailchimp.com",
        "sendinblue.com",
        "brevo.com",
        "emailjs.com",
        "zoho.com",
        "airtable.com",
        "netlify.com",
      ].map((match) => ({ match, factor: 0.05, reason: "publiczny serwis formularzy (współdzielony przez wiele stron)" })),
      ...[
        "google-analytics.com",
        "analytics.google.com",
        "googletagmanager.com",
        "doubleclick.net",
        "facebook.com",
        "facebook.net",
        "analytics.tiktok.com",
        "mc.yandex.ru",
        "yandex.ru",
        "bat.bing.com",
        "clarity.ms",
        "hotjar.com",
        "segment.io",
        "mixpanel.com",
        "amplitude.com",
        "sentry.io",
        "cloudflareinsights.com",
        "recaptcha.net",
        "hcaptcha.com",
      ].map((match) => ({ match, factor: 0.05, reason: "analityka/antyspam (współdzielone przez wiele stron)" })),
      ...["ipinfo.io", "ipgeolocation.io", "ip-api.com", "ipapi.co", "ipify.org", "geojs.io"].map((match) => ({
        match,
        factor: 0.05,
        reason: "publiczna usługa geolokalizacji IP (część kitów, ale współdzielona)",
      })),
    ],
    endpointPlatformPaths: [
      { match: "/api/v1/trigger/", factor: 0.1, reason: "ścieżka SDK platformy stron (window.aio), wspólna dla wszystkich jej kont" },
      { match: "/api/v1/agent/", factor: 0.1, reason: "ścieżka SDK platformy stron (window.aio), wspólna dla wszystkich jej kont" },
      // public scans: the same script on landers of many unrelated operators in many countries
      { match: "/include/events-stat.js", factor: 0.1, reason: "skrypt zdarzeń platformy trackera (Binom), wspólny dla wszystkich jej instalacji" },
      { match: "/click", factor: 0.1, reason: "ścieżka linku kampanii platformy trackera (/click?key=…), wspólna dla wszystkich jej instalacji" },
    ],
    multiTenantBackends: [
      ...[
        // form handlers (the ones not already in endpointHosts)
        "submit-form.com",
        "formspark.io",
        "formbold.com",
        "formkeep.com",
        "pageclip.co",
        "kwes.io",
        "99inbound.com",
        "fabform.io",
        "getsimpleform.com",
        "formester.com",
        // webhook relays and no-code automation
        "hooks.zapier.com",
        "zapier.com",
        "make.com",
        "integromat.com",
        "pabbly.com",
        "webhook.site",
        "sheetdb.io",
        "sheetbest.com",
        "sheet.best",
        "nocodeapi.com",
        "script.google.com",
        // lead collectors, CRMs and affiliate networks with one host for all clients
        "api.telegram.org",
        "salesforce.com",
        "pipedrive.com",
        "getresponse.com",
        "klaviyo.com",
        "convertkit.com",
        "mailerlite.com",
        "sendpulse.com",
        "leadsquared.com",
        "keycrm.app",
        "lp-crm.biz",
      ].map((match) => ({ match, factor: 0.1, reason: "usługa wielu klientów (formularze, zbieranie leadów, webhooki, CRM): bez identyfikatora klienta cecha usługi, nie operatora" })),
      // public scans (urlscan, 44 scans of unrelated sites in many sectors): one script for many clients
      { match: "afrdtech.com", factor: 0.1, reason: "publiczna usługa wielu klientów (skrypt na stronach wielu niezwiązanych branż w publicznych skanach)" },
    ],
    paramSchemaPlatformParts: [
      { match: "key:hex", factor: 0.1, reason: "format linku kampanii platformy trackera (key=<32 hex>), cecha typu platformy, nie operatora" },
    ],
    endpointGenericPaths: [
      "/",
      "/submit",
      "/send",
      "/contact",
      "/register",
      "/login",
      "/search",
      "/subscribe",
      "/api",
      "/api/",
      "/send.php",
      "/mail.php",
      "/contact.php",
      "/submit.php",
      "/order.php",
      "/wp-admin/admin-ajax.php",
      "/wp-json/contact-form-7/v1/contact-forms/<n>/feedback",
      "/form",
      "/order",
      "/lead",
      "/leads",
      "/thanks",
      "/thank-you",
      "/success",
      "/callback",
      "/postback",
      "/api/lead",
      "/api/leads",
      "/api/submit",
      "/api/register",
      "/api/contact",
      "/api/form",
      "/api/send",
      "/api/subscribe",
      "/api/order",
      "/api/v1/lead",
      "/api/v1/leads",
      "/lead.php",
      "/form.php",
      "/register.php",
      "/api.php",
      "/handler.php",
      "/process.php",
    ].map((match) => ({ match, factor: 0.05, reason: "ogólna ścieżka formularza (występuje na niezwiązanych stronach)" })),
    hiddenFieldGeneric: [
      "csrf",
      "csrf_token",
      "csrfmiddlewaretoken",
      "_token",
      "token",
      "authenticity_token",
      "__requestverificationtoken",
      "__viewstate",
      "__viewstategenerator",
      "__eventvalidation",
      "__eventtarget",
      "__eventargument",
      "_wpnonce",
      "_wp_http_referer",
      "form_id",
      "form_build_id",
      "action",
      "redirect",
      "redirect_url",
      "return_url",
      "lang",
      "locale",
      "access_key",
      "subject",
      "_next",
      "_subject",
      "_captcha",
      "_replyto",
      "_template",
      "_honey",
      "botcheck",
      "g-recaptcha-response",
      "h-captcha-response",
    ],
    assetLibraries: [
      ...[
        "^jquery([.-][\\w.]+)?(\\.min)?\\.js$",
        "^bootstrap(\\.bundle)?(\\.min)?\\.(js|css)$",
        "^popper(\\.min)?\\.js$",
        "^(swiper|slick|owl\\.carousel|lightbox|fancybox|aos|wow|gsap|lodash|underscore|moment|axios|vue|react|react-dom|alpine)([.-][\\w.]+)?(\\.min)?\\.(js|css)$",
        "^(font-?awesome|all|animate|normalize|reset)(\\.min)?\\.css$",
        "^(intl-tel-input|intltelinput|utils|imask|inputmask|jquery\\.mask|cleave)(\\.min)?\\.(js|css)$",
      ].map((match) => ({ match, factor: 0.05, reason: "popularna biblioteka JS/CSS" })),
      ...["^(style|styles|main|app|script|scripts|index|common|custom|global|site|theme|bundle|vendor)(\\.min)?\\.(js|css)$"].map(
        (match) => ({ match, factor: 0.1, reason: "ogólna nazwa pliku (style.css, main.js ...)" }),
      ),
    ],
    commentPatterns: [
      "google tag manager",
      "global site tag",
      "gtag\\.js",
      "google analytics",
      "meta pixel",
      "facebook pixel",
      "yandex\\.?metri[ck]a",
      "tiktok pixel",
      "hotjar",
      "^/?wp:",
      "yoast seo",
      "wordpress",
      "end of",
      "^(begin|end)\\b",
      "cookie(bot| consent| banner)",
      "^(header|footer|navigation|nav|sidebar|main content|content|wrapper|container)( (start|end))?$",
    ].map((match) => ({ match, factor: 0.05, reason: "standardowy komentarz (snippet trackera lub szablonu CMS)" })),
    pathIdSharedPrefixes: ["/cdn/shop/", "/cdn/extensions/"].map((match) => ({
      match,
      factor: 0.05,
      reason: "platforma sklepowa: identyfikator aplikacji lub motywu, wspólny dla wielu sklepów",
    })),
    cnameTargets: [
      ...[
        "cloudfront.net",
        "akamaiedge.net",
        "akamai.net",
        "akamaized.net",
        "edgekey.net",
        "edgesuite.net",
        "fastly.net",
        "fastlylb.net",
        "cdn.cloudflare.net",
        "cloudflare.net",
        "azureedge.net",
        "azurefd.net",
        "trafficmanager.net",
        "b-cdn.net",
        "cdn77.org",
        "kxcdn.com",
        "stackpathdns.com",
        "incapdns.net",
        "sucuri.net",
        "edgecastcdn.net",
      ].map((match) => ({ match, factor: 0.02, reason: "CDN (cel CNAME współdzielony przez tysiące niezwiązanych stron)" })),
      ...[
        "azurewebsites.net",
        "herokuapp.com",
        "herokudns.com",
        "github.io",
        "netlify.app",
        "netlify.com",
        "vercel-dns.com",
        "vercel.app",
        "pages.dev",
        "workers.dev",
        "web.app",
        "firebaseapp.com",
        "googlehosted.com",
        "ghs.google.com",
        "wpengine.com",
        "myshopify.com",
        "shops.myshopify.com",
        "squarespace.com",
        "wixdns.net",
        "webflow.io",
        "hubspot.net",
        "zendesk.com",
        "elasticbeanstalk.com",
        "amazonaws.com",
        "godaddysites.com",
        "weebly.com",
        "blogspot.com",
      ].map((match) => ({ match, factor: 0.05, reason: "platforma hostingowa (cel CNAME współdzielony)" })),
    ],
    campaignParamGenericValues: [
      "facebook",
      "fb",
      "ig",
      "instagram",
      "meta",
      "messenger",
      "an",
      "audience_network",
      "google",
      "youtube",
      "yt",
      "tiktok",
      "tt",
      "twitter",
      "x",
      "telegram",
      "push",
      "native",
      "taboola",
      "outbrain",
      "cpc",
      "cpm",
      "cpa",
      "ppc",
      "paid",
      "paid_social",
      "paidsocial",
      "social",
      "email",
      "newsletter",
      "organic",
      "referral",
      "display",
      "banner",
      "ad",
      "ads",
      "video",
      "story",
      "stories",
      "feed",
      "reels",
      "search",
      "sms",
      "test",
      "none",
      "null",
      "undefined",
      "true",
      "false",
      "default",
      "(not set)",
      "{{campaign.name}}",
      "{{adset.name}}",
      "{{ad.name}}",
      "{{campaign.id}}",
      "{{adset.id}}",
      "{{ad.id}}",
      "{{site_source_name}}",
      "{{placement}}",
    ],
    campaignParamWeakNames: [
      { match: "utm_source", factor: 0.2, reason: "utm_source zwykle wskazuje tylko platformę" },
      { match: "utm_medium", factor: 0.2, reason: "utm_medium zwykle wskazuje tylko typ ruchu" },
    ],
  },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends Array<infer U> ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

export type LinkConfigOverride = DeepPartial<LinkConfig> & {
  /** Arrays in `lists` are appended to the defaults unless this is true. */
  replaceLists?: boolean;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge(base: unknown, over: unknown, appendArrays: boolean): unknown {
  if (Array.isArray(base) && Array.isArray(over)) return appendArrays ? [...base, ...over] : [...over];
  if (isPlainObject(base) && isPlainObject(over)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v, appendArrays) : v;
    return out;
  }
  return over === undefined ? base : over;
}

/** Merges an override into the defaults. List arrays are appended (rules are additive). */
export function mergeConfig(override: LinkConfigOverride | null | undefined, base: LinkConfig = DEFAULT_LINK_CONFIG): LinkConfig {
  if (!override) return structuredClone(base);
  const { replaceLists, lists, ...rest } = override;
  const merged = deepMerge(structuredClone(base), rest, false) as LinkConfig;
  if (lists) merged.lists = deepMerge(merged.lists, lists, !replaceLists) as LinkConfig["lists"];
  return merged;
}

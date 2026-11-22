/**
 * Shared data shapes of the pipeline: ingest -> enrich -> build-graph.
 * Kept free of runtime code so the viewer can import them too.
 */
import type { AsnInfo } from "../osint/asn";
import type { CtResult } from "../osint/ct";
import type { DnsRecords } from "../osint/dns";
import type { PageExtract, TextExtract } from "../osint/extract";
import type { FetchPageResult } from "../osint/fetchPage";
import type { RdapInfo } from "../osint/rdap";
import type { NormalizedUrl } from "../osint/urls";
import type { FaviconHashes, ImageHashes } from "../media/imageHash";
import type { AudioFingerprint } from "../media/audioFp";
import type { AdLibraryInfo } from "../osint/adLibrary";
import type { PageArchive } from "../osint/archive/types";
import type { ObservedAddress } from "../media/addressBar";
import type { CampaignParam } from "../osint/campaignParams";
import type { PageKit } from "../osint/pagekit";
import type { FaceHit } from "../media/face";
import type { VoiceSpan } from "../media/speaker";
import type { PersonaMatch } from "../text/persona";

/** Normalised ad record (output of ingest). */
export interface Item {
  id: string;
  platform: string | null;
  advertiser: string | null;
  text: string | null;
  imageUrl: string | null;
  /** Path relative to the dataset directory (or absolute). */
  imagePath: string | null;
  landingUrl: string | null;
  /** ISO 8601 */
  firstSeen: string | null;
  lastSeen: string | null;
  /** Optional ground-truth campaign label (used only by evaluate). */
  label: string | null;
  /** Persona supplied by the input data (e.g. a DROZD identity id or name; several separated by ; or |). */
  persona: string | null;
  /** Deepfake score supplied by the input data (e.g. DROZD), normalised to 0..1. A model output, not a fact. */
  deepfakeScore: number | null;
  /** Local video/audio creative (relative to the dataset directory) for optional ASR and audio fingerprints. */
  videoPath: string | null;
  /** Further screenshots of the same case (ad details in the ad library, the page on a phone): read by OCR only. */
  extraImagePaths?: string[];
  /** Unmapped source columns, kept for display. */
  extra: Record<string, string>;
}

export interface ItemsFile {
  version: 1;
  generatedAt: string;
  source: string;
  /** Directory against which relative imagePath values are resolved. */
  baseDir: string;
  items: Item[];
  warnings: string[];
}

export interface HostInfo {
  host: string;
  registrableDomain: string | null;
  dns: DnsRecords | null;
  /** Canonical IPs from A/AAAA (or the host itself when it is an IP literal). */
  ips: string[];
  /** CNAME chain starting at the host (targets in order, max 4 hops). */
  cnameChain: string[];
}

export interface DomainInfo {
  domain: string;
  ns: string[];
  mx: string[];
  txt: string[];
  rdap: RdapInfo | null;
  ct: CtResult | null;
  /** An archived copy of a page of this domain predates its registration in RDAP: the domain was registered again (the old content is not the current operator's). */
  reRegistered?: boolean;
}

export interface FaviconInfo {
  url: string;
  hashes: FaviconHashes | null;
  error: string | null;
}

export interface PageInfo {
  requestedUrl: string;
  fetch: Omit<FetchPageResult, "body">;
  extract: PageExtract | null;
  favicon: FaviconInfo | null;
  /** Page-kit fingerprint (form backends, DOM simhash, hidden fields, assets, comments). */
  kit: PageKit | null;
  /** Archived decoded HTML (path relative to the project root), named by the raw-body SHA-256. */
  archiveFile: string | null;
  /** Optional cloaking check (two extra GETs with a crawler and a mobile User-Agent). */
  cloaking: CloakingCheck | null;
  /** Where `extract` and `kit` came from when the live page was dead and an archived copy stood in: never set for a page fetched live. */
  bodySource?: "urlscan" | "wayback";
  /** Provenance of the archived copy found for this page (used, or found but rejected); without the body. */
  archive?: PageArchive;
}

export interface CloakingVariant {
  userAgent: string;
  finalUrl: string | null;
  status: number | null;
  domSimhash: string | null;
  bodySha256: string | null;
  /** The response was an anti-bot challenge page (403/503 "Just a moment…", cf-chl): the fetch was blocked (B-117). */
  botChallenge?: boolean;
  error: string | null;
}

export interface CloakingCheck {
  crawler: CloakingVariant;
  mobile: CloakingVariant;
  finalUrlDiffers: boolean;
  domDistance: number | null;
  suspected: boolean;
  reasons: string[];
  /** "bot_challenge": a variant was stopped by anti-bot protection, so nothing can be said about cloaking (B-117). */
  state?: "checked" | "bot_challenge";
}

export interface ImageInfo extends ImageHashes {
  source: string;
}

export interface ItemEnrichment {
  itemId: string;
  landing: NormalizedUrl | null;
  /** Key into EnrichedDataset.pages (normalised landing URL). */
  pageKey: string | null;
  /** Contacts/wallets/URLs found in the ad copy itself. */
  text: TextExtract | null;
  image: ImageInfo | null;
  /** Personas found in ad text, page text, OCR/ASR text, the input column or NER. */
  personas: PersonaMatch[];
  /** Campaign parameters from the landing URL, redirect chain and final URL. */
  campaignParams: CampaignParam[];
  /** Text recognised in the creative image (opt-in OCR). A phone screenshot is cut down to the sponsored post. */
  ocrText: string | null;
  /** Text recognised in the further screenshots of the case (opt-in OCR). */
  extraOcrText?: string | null;
  /** Addresses read from the browser address bar of screenshots and screen recordings (opt-in OCR). */
  observedUrls?: ObservedAddress[];
  /** Where the landing URL came from: the input, a URL in the ad text or the address bar of a screenshot. */
  landingSource?: "input" | "ad_text" | "address_bar" | null;
  /** Advertiser name read from the screenshot (the line above "Sponsored"), when the input gives none. */
  advertiserOcr?: string | null;
  /**
   * The advertiser's name (input, library or screenshot) holds a name or a pseudonym of a person from the
   * list: a possible fake profile of that person. An attribute, not evidence of a campaign.
   */
  advertiserImpersonates?: { id: string; name: string };
  /** Transcript of the video/audio creative (opt-in ASR). */
  asrText: string | null;
  /** Chromaprint fingerprint of the video/audio creative (opt-in). */
  audioFp: AudioFingerprint | null;
  /** L2-normalised CLIP embedding of the creative image (opt-in). */
  imageEmbedding?: number[];
  /** Brand of a portal, bank or institution recognised on the creative (CLIP zero-shot, opt-in with CLIP): an attribute, never a link. */
  creativeBrand?: { id: string; name: string; kind: string; probability: number };
  /** CLIP embedding of the video creative: mean over interior frames (opt-in). */
  videoEmbedding?: number[];
  /** SHA-256 of the video creative file: the same file, not just a similar recording. */
  videoSha256?: string;
  /** L2-normalised SpeechBrain ECAPA speaker embedding of the video/audio creative (opt-in). */
  speakerEmbedding?: number[];
  /** Faces in the creative image, the further screenshots and the video frames (opt-in): box, and for a face similar to someone on the closed list of public figures the persona id and similarity. No vectors. */
  faces?: FaceHit[];
  /** Stretches of speech in the video/audio creative (opt-in `speaker`, needs the gallery data/voices): seconds from the start, and for a voice similar to someone on the closed list the persona id and cosine. No vectors. */
  voices?: VoiceSpan[];
  /** Meta Ad Library details for the ad-library IDs of this item (opt-in, live mode). */
  adLibrary?: AdLibraryInfo[];
  /** Outcome of the archive step for the landing page (opt-in); absent when the page was fetched live or the step is off. */
  archive?: { status: "used" | "rejected" | "none" | "skipped"; detail: string };
  errors: string[];
}

export interface EnrichedDataset {
  version: 1;
  generatedAt: string;
  mode: "live" | "offline";
  baseDir: string;
  items: Item[];
  perItem: Record<string, ItemEnrichment>;
  pages: Record<string, PageInfo>;
  hosts: Record<string, HostInfo>;
  domains: Record<string, DomainInfo>;
  /** ASN data keyed by canonical IP. */
  ips: Record<string, AsnInfo | null>;
}

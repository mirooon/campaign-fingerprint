/**
 * Generates the SYNTHETIC offline sample in data/sample/:
 *  - ads.csv (43 ads: 5 campaigns + 5 unrelated ads) with a ground-truth column,
 *    deliberately non-standard Polish column names (see mapping.json)
 *  - images/ (generated creatives with near-duplicate variants; abstract avatars only)
 *  - fixtures/ recorded RAW responses: http.json + pages/*.html (redirect chains),
 *    dns.json, rdap/*.json (raw RDAP), crtsh/*.json (raw crt.sh), cymru.json (raw TXT)
 *  - linking.json: sample-specific additions to the deny/weak lists
 *  - demo/: material of `bun run demo` (a phone screenshot of a dead page with its address in the bar)
 *
 * Everything is fictional: people ("Adam Testowy"...), brands, reserved domains
 * (.example/.test), documentation IP ranges (192.0.2/24, 198.51.100/24, 203.0.113/24)
 * and private-use ASNs (6450x), UK Ofcom drama phone numbers (+44 7700 900xxx), and
 * checksum-valid but random crypto addresses. The only real-world values are public
 * infrastructure identifiers needed for the hard cases: Cloudflare's anycast ranges,
 * AS13335 and *.ns.cloudflare.com, ParkingCrew NS names, common registrar/CA names.
 *
 * Deterministic: re-running produces the same files (on the same sharp/libvips build).
 */
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { dHash, hammingDistance } from "../lib/media/imageHash";
import { domSimhash, simhashDistance } from "../lib/osint/pagekit";
import { cymruAsNameQuery, cymruOriginQuery } from "../lib/osint/asn";
import { toEip55 } from "../lib/osint/crypto";
import { normalizeUrl } from "../lib/osint/urls";

const ROOT = path.join(process.cwd(), "data", "sample");
const IMG = path.join(ROOT, "images");

// ---------------------------------------------------------------- helpers
const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest();
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58check(payload: Buffer): string {
  const full = Buffer.concat([payload, sha256(sha256(payload)).subarray(0, 4)]);
  let n = BigInt(`0x${full.toString("hex")}`);
  let out = "";
  while (n > BigInt(0)) {
    out = B58[Number(n % BigInt(58))] + out;
    n /= BigInt(58);
  }
  for (const byte of full) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}
const seed20 = (s: string) => sha256(`starter-sample:${s}`).subarray(0, 20);
const tronAddr = (s: string) => base58check(Buffer.concat([Buffer.from([0x41]), seed20(s)]));
const btcAddr = (s: string) => base58check(Buffer.concat([Buffer.from([0x00]), seed20(s)]));
const ethAddr = (s: string) => toEip55(`0x${seed20(s).toString("hex")}`)!;

const W = {
  tronC1: tronAddr("tron:C1"),
  ethC5: ethAddr("eth:C5"),
  btcC5: btcAddr("btc:C5"),
  btcN5: btcAddr("btc:N5"),
};

const PHONE_C2 = "+447700900123"; // Ofcom drama range
const WA_C4 = "447700900456"; // Ofcom drama range

function writeFile(rel: string, data: string | Buffer) {
  const file = path.join(ROOT, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
}
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const u = (s: string) => new URL(s).toString();

// ---------------------------------------------------------------- infrastructure
const CF_IPS = ["104.21.32.15", "172.67.141.88"];
const CF_NS = ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"];
const NS_C3 = ["ns1.dns-ukryty.test", "ns2.dns-ukryty.test"];
const NS_TANI = ["ns1.tani-dns.test", "ns2.tani-dns.test"];
const NS_VPS = ["ns1.vps-demo.test", "ns2.vps-demo.test"];
const NS_PARK = ["ns1.parkingcrew.net", "ns2.parkingcrew.net"];

interface CertSpec {
  serial: string;
  issuer: "LE" | "GTS" | "ZEROSSL";
  names: string[];
  notBefore: string;
}
interface DomainSpec {
  ns: string[];
  registrar: string;
  created: string;
  certs: CertSpec[];
  mx?: string[];
  abuse?: string;
}

const ISSUERS: Record<CertSpec["issuer"], { name: string; caId: number }> = {
  LE: { name: "C=US, O=Let's Encrypt, CN=R11", caId: 295815 },
  GTS: { name: "C=US, O=Google Trust Services, CN=WE1", caId: 183283 },
  ZEROSSL: { name: "C=AT, O=ZeroSSL, CN=ZeroSSL RSA Domain Secure Site CA", caId: 105487 },
};

const single = (d: string, issuer: CertSpec["issuer"], notBefore: string, serialSeed = d): CertSpec[] => [
  { serial: sha256(`serial:${serialSeed}`).toString("hex").slice(0, 32), issuer, names: [d, `www.${d}`], notBefore },
];

const C3_MULTI: CertSpec = {
  serial: sha256("serial:c3-multi").toString("hex").slice(0, 32),
  issuer: "LE",
  names: ["oferta-fikcyjna.example", "lp.oferta-fikcyjna.example", "szybki-zysk-teraz.example", "fakt-dnia-demo.example"],
  notBefore: "2026-10-02T12:00:00",
};
const C4_MULTI: CertSpec = {
  serial: sha256("serial:c4-multi").toString("hex").slice(0, 32),
  issuer: "ZEROSSL",
  names: ["zwrot-nadplaty.example", "epodatki-zwrot.test", "zwrot37-voluptas12.example", "zwrot88-praesentium40.example"],
  notBefore: "2026-09-13T00:00:00",
};

const DOMAINS: Record<string, DomainSpec> = {
  // C1 — Cloudflare, registration burst at a common registrar
  "kryptozysk-ai.example": { ns: CF_NS, registrar: "NameCheap, Inc.", created: "2026-09-02T08:14:00Z", certs: single("kryptozysk-ai.example", "GTS", "2026-09-02T09:00:00") },
  "zysk-ai-platforma.example": { ns: CF_NS, registrar: "NameCheap, Inc.", created: "2026-09-02T19:40:00Z", certs: single("zysk-ai-platforma.example", "LE", "2026-09-03T10:00:00") },
  "kz-ai-start.test": { ns: CF_NS, registrar: "NameCheap, Inc.", created: "2026-09-03T03:05:00Z", certs: single("kz-ai-start.test", "GTS", "2026-09-03T05:00:00") },
  // C2 — Cloudflare with the SAME anycast IPs and NS pair as C1 (hard negative)
  "baltycka-energia-inwestycje.example": { ns: CF_NS, registrar: "Tucows Domains Inc.", created: "2026-08-11T10:00:00Z", certs: single("baltycka-energia-inwestycje.example", "LE", "2026-08-12T00:00:00"), mx: ["mx.baltycka-energia-inwestycje.example"] },
  "energia-dywidenda.test": { ns: CF_NS, registrar: "Tucows Domains Inc.", created: "2026-09-01T12:00:00Z", certs: single("energia-dywidenda.test", "GTS", "2026-09-01T13:00:00") },
  // C3 — dedicated hosting, custom NS, registration burst, multi-domain certificate
  "wiadomosci-demo.test": { ns: NS_C3, registrar: "Registrar Demo Ltd.", created: "2026-10-01T06:00:00Z", certs: single("wiadomosci-demo.test", "LE", "2026-10-01T07:00:00"), abuse: "abuse@registrar-demo.example" },
  "oferta-fikcyjna.example": { ns: NS_C3, registrar: "Registrar Demo Ltd.", created: "2026-10-01T14:30:00Z", certs: [C3_MULTI], abuse: "abuse@registrar-demo.example" },
  "fakt-dnia-demo.example": { ns: NS_C3, registrar: "Registrar Demo Ltd.", created: "2026-10-01T22:10:00Z", certs: [C3_MULTI], abuse: "abuse@registrar-demo.example" },
  "szybki-zysk-teraz.example": { ns: NS_C3, registrar: "Registrar Demo Ltd.", created: "2026-10-02T11:45:00Z", certs: [C3_MULTI], abuse: "abuse@registrar-demo.example" },
  // C4 — domain rotation; linked by WhatsApp in ad copy, a ZeroSSL multi-SAN cert, favicon, IP, images, text
  "doplata-gov-pl.example": { ns: NS_TANI, registrar: "NameSilo, LLC", created: "2026-09-05T09:00:00Z", certs: single("doplata-gov-pl.example", "LE", "2026-09-05T10:00:00") },
  "zwrot-nadplaty.example": { ns: NS_TANI, registrar: "NameSilo, LLC", created: "2026-09-12T09:00:00Z", certs: [C4_MULTI] },
  "epodatki-zwrot.test": { ns: NS_TANI, registrar: "NameSilo, LLC", created: "2026-09-19T09:00:00Z", certs: [C4_MULTI] },
  "bank-przyklad-zwrot.example": { ns: NS_TANI, registrar: "NameSilo, LLC", created: "2026-09-26T09:00:00Z", certs: single("bank-przyklad-zwrot.example", "LE", "2026-09-26T10:00:00") },
  "zwrot24-dolorem51.test": { ns: NS_VPS, registrar: "NameSilo, LLC", created: "2026-10-03T09:00:00Z", certs: single("zwrot24-dolorem51.test", "LE", "2026-10-03T10:00:00") },
  "zwrot37-voluptas12.example": { ns: NS_VPS, registrar: "NameSilo, LLC", created: "2026-10-10T09:00:00Z", certs: [C4_MULTI] },
  "zwrot88-praesentium40.example": { ns: NS_VPS, registrar: "NameSilo, LLC", created: "2026-10-17T09:00:00Z", certs: [C4_MULTI] },
  // C5 — fictional URL shortener in front of one landing domain
  "krotki.test": { ns: ["ns1.krotki.test", "ns2.krotki.test"], registrar: "Tucows Domains Inc.", created: "2023-01-10T00:00:00Z", certs: single("krotki.test", "LE", "2026-08-01T00:00:00") },
  "wygrana-demo.example": { ns: NS_VPS, registrar: "Dynadot Inc", created: "2026-10-18T16:00:00Z", certs: single("wygrana-demo.example", "LE", "2026-10-18T17:00:00") },
  // Unrelated ads
  "sklep-rowerowy.example": { ns: CF_NS, registrar: "NameCheap, Inc.", created: "2025-03-10T10:00:00Z", certs: single("sklep-rowerowy.example", "GTS", "2026-08-20T00:00:00"), mx: ["mx.sklep-rowerowy.example"] },
  "kurs-jezykowy.test": { ns: CF_NS, registrar: "Tucows Domains Inc.", created: "2024-06-01T10:00:00Z", certs: single("kurs-jezykowy.test", "LE", "2026-09-01T00:00:00") },
  "zysk-szybki.example": { ns: NS_PARK, registrar: "Dynadot Inc", created: "2026-05-14T10:00:00Z", certs: [] },
  "inwestycje-premium.test": { ns: NS_PARK, registrar: "Dynadot Inc", created: "2026-06-02T10:00:00Z", certs: [] },
  "robot-btc-solo.example": { ns: ["ns1.solo-host.test", "ns2.solo-host.test"], registrar: "Registrar Demo Ltd.", created: "2026-08-01T10:00:00Z", certs: single("robot-btc-solo.example", "LE", "2026-08-01T11:00:00"), abuse: "abuse@registrar-demo.example" },
};

const HOST_IPS: Record<string, string[]> = {
  "kryptozysk-ai.example": CF_IPS,
  "zysk-ai-platforma.example": CF_IPS,
  "kz-ai-start.test": CF_IPS,
  "baltycka-energia-inwestycje.example": CF_IPS,
  "energia-dywidenda.test": CF_IPS,
  "wiadomosci-demo.test": ["198.51.100.23"],
  "lp.oferta-fikcyjna.example": ["198.51.100.23"],
  "oferta-fikcyjna.example": ["198.51.100.23"],
  "fakt-dnia-demo.example": ["198.51.100.24"],
  "szybki-zysk-teraz.example": ["198.51.100.24"],
  "doplata-gov-pl.example": ["203.0.113.77"],
  "zwrot-nadplaty.example": ["203.0.113.78"],
  "epodatki-zwrot.test": ["203.0.113.79"],
  "bank-przyklad-zwrot.example": ["203.0.113.77"],
  "zwrot24-dolorem51.test": ["203.0.113.80"],
  "zwrot37-voluptas12.example": ["203.0.113.77"],
  "zwrot88-praesentium40.example": ["203.0.113.81"],
  "krotki.test": ["198.51.100.200"],
  "wygrana-demo.example": ["203.0.113.140"],
  "sklep-rowerowy.example": CF_IPS,
  "kurs-jezykowy.test": CF_IPS,
  "zysk-szybki.example": ["192.0.2.80"],
  "inwestycje-premium.test": ["192.0.2.80"],
  "robot-btc-solo.example": ["192.0.2.10"],
};

/** CNAME records: an operator TDS domain (C3) and a shared CDN edge hostname (C5 and N5, hard negative). */
const CNAMES: Record<string, string> = {
  "fakt-dnia-demo.example": "land2.tds-cname.test",
  "szybki-zysk-teraz.example": "prx7.tds-cname.test",
  "wygrana-demo.example": "dualstack.j.sni.global.fastly.net",
  "robot-btc-solo.example": "dualstack.j.sni.global.fastly.net",
};

const ASN_OF: Record<string, { asn: number; prefix: string; cc: string; registry: string; allocated: string }> = {
  "104.21.32.15": { asn: 13335, prefix: "104.16.0.0/13", cc: "US", registry: "arin", allocated: "2014-03-28" },
  "172.67.141.88": { asn: 13335, prefix: "172.64.0.0/13", cc: "US", registry: "arin", allocated: "2015-02-25" },
  "198.51.100.23": { asn: 64501, prefix: "198.51.100.0/24", cc: "ZZ", registry: "other", allocated: "2026-01-01" },
  "198.51.100.24": { asn: 64501, prefix: "198.51.100.0/24", cc: "ZZ", registry: "other", allocated: "2026-01-01" },
  "198.51.100.200": { asn: 64505, prefix: "198.51.100.0/24", cc: "ZZ", registry: "other", allocated: "2026-01-01" },
  "203.0.113.77": { asn: 64502, prefix: "203.0.113.0/24", cc: "ZZ", registry: "other", allocated: "2026-01-01" },
  "203.0.113.78": { asn: 64502, prefix: "203.0.113.0/24", cc: "ZZ", registry: "other", allocated: "2026-01-01" },
  "203.0.113.79": { asn: 64502, prefix: "203.0.113.0/24", cc: "ZZ", registry: "other", allocated: "2026-01-01" },
  "203.0.113.80": { asn: 64502, prefix: "203.0.113.0/24", cc: "ZZ", registry: "other", allocated: "2026-01-01" },
  "203.0.113.81": { asn: 64502, prefix: "203.0.113.0/24", cc: "ZZ", registry: "other", allocated: "2026-01-01" },
  "203.0.113.140": { asn: 64502, prefix: "203.0.113.0/24", cc: "ZZ", registry: "other", allocated: "2026-01-01" },
  "192.0.2.80": { asn: 64503, prefix: "192.0.2.0/24", cc: "ZZ", registry: "other", allocated: "2026-01-01" },
  "192.0.2.10": { asn: 64504, prefix: "192.0.2.0/24", cc: "ZZ", registry: "other", allocated: "2026-01-01" },
};

const AS_NAMES: Record<number, string> = {
  13335: "13335 | US | arin | 2010-07-14 | CLOUDFLARENET - Cloudflare, Inc., US",
  64501: "64501 | ZZ | other | 2026-01-01 | DEMO-HOSTING-A - fikcyjny hosting (AS do dokumentacji), ZZ",
  64502: "64502 | ZZ | other | 2026-01-01 | DEMO-VPS-B - fikcyjny dostawca VPS, ZZ",
  64503: "64503 | ZZ | other | 2026-01-01 | DEMO-PARKING - fikcyjny parking domen, ZZ",
  64504: "64504 | ZZ | other | 2026-01-01 | DEMO-CLOUD-C - fikcyjna chmura, ZZ",
  64505: "64505 | ZZ | other | 2026-01-01 | DEMO-SHORT - fikcyjny skracacz linków, ZZ",
};

// ---------------------------------------------------------------- ads
interface Ad {
  id: string;
  label: string;
  platform: string;
  advertiser: string;
  text: string;
  image: string;
  url: string;
  first: string;
  last: string;
  /** DROZD-style columns (persona id/name and deepfake score), empty when not supplied. */
  persona?: string;
  score?: string;
  /** Local audio/video creative (relative to data/sample). */
  video?: string;
}

const CYR_CAMPAIGN = "пл_инвест_лиды_07"; // synthetic Cyrillic campaign name (media-buyer naming habit)

const ADS: Ad[] = [
  // C1: Adam Testowy — krypto "KryptoZysk AI"
  { id: "c1-01", label: "C1", platform: "facebook", advertiser: "Finanse Dziś Demo", text: "Adam Testowy ujawnia w wywiadzie: platforma KryptoZysk AI zarabia za mnie nawet 4 800 zł dziennie. Zarejestruj się dziś, liczba miejsc ograniczona!", image: "c1_A.png", url: `https://kryptozysk-ai.example/start?utm_source=facebook&utm_campaign=${CYR_CAMPAIGN}&fbclid=IwAR0aBc1`, first: "2026-09-05", last: "19.09.2026", persona: "Adam Testowy", score: "0,93" },
  { id: "c1-02", label: "C1", platform: "facebook", advertiser: "Finanse Dziś Demo", text: "Adam Testowy zdradził sekret: KryptoZysk AI pozwala zarabiać do 4 800 zł dziennie. Zarejestruj się jeszcze dziś – miejsca są ograniczone!", image: "c1_A_v2.png", url: `https://kryptozysk-ai.example/start?utm_source=facebook&utm_campaign=${CYR_CAMPAIGN}`, first: "2026-09-07", last: "21.09.2026" },
  { id: "c1-03", label: "C1", platform: "instagram", advertiser: "Inwestor PL Test", text: "Sekret Adama Testowego: KryptoZysk AI zarabia nawet 4800 zł dziennie bez żadnej wiedzy. Rejestracja tylko dziś, liczba miejsc ograniczona.", image: "c1_A_bright.png", url: "https://kryptozysk-ai.example/oferta", first: "2026-09-10", last: "25.09.2026" },
  { id: "c1-04", label: "C1", platform: "facebook", advertiser: "Rynek i Ty Demo", text: "Adam Testowy: „Dzięki KryptoZysk AI zarabiam 4 800 zł dziennie”. Zarejestruj się dziś, zanim zamkną rejestrację!", image: "c1_B.png", url: "https://zysk-ai-platforma.example/", first: "2026-09-15", last: "01.10.2026", persona: "Adam Testowy", score: "88%" },
  { id: "c1-05", label: "C1", platform: "facebook", advertiser: "Rynek i Ty Demo", text: "Zаrаbiаj jak Adam Testowy! KryptoZysk AI – nawet 4 800 zł dziennie. Zarejestruj się dziś, liczba miejsc ograniczona.", image: "c1_B_crop.jpg", url: `https://zysk-ai-platforma.example/rejestracja?utm_source=facebook&utm_campaign=${CYR_CAMPAIGN}`, first: "2026-09-18", last: "05.10.2026" },
  { id: "c1-06", label: "C1", platform: "instagram", advertiser: "Inwestor PL Test", text: "Adam Testowy poleca: bot KryptoZysk AI handluje za Ciebie i zarabia do 4 800 zł dziennie. Dołącz dziś – miejsca ograniczone.", image: "c1_B_badge.png", url: "https://zysk-ai-platforma.example/?ref=ig", first: "2026-09-22", last: "08.10.2026" },
  { id: "c1-07", label: "C1", platform: "youtube", advertiser: "Nowe Technologie Demo", text: "Wywiad z Adamem Testowym: platforma KryptoZysk AI przynosi mu 4 800 zł dziennie. Zarejestruj się dziś!", image: "c1_C.png", url: "https://kryptozysk-ai.example/wywiad", first: "2026-09-25", last: "12.10.2026" },
  { id: "c1-08", label: "C1", platform: "facebook", advertiser: "Finanse Dziś Demo", text: "Adam Testowy ujawnia: KryptoZysk AI zarabia nawet 4 800 zł dziennie. Napisz na Telegramie t.me/kryptozysk_vip i odbierz bonus powitalny.", image: "c1_A_jpeg.jpg", url: "", first: "2026-10-01", last: "15.10.2026" },
  { id: "c1-09", label: "C1", platform: "tiktok", advertiser: "Kryptowaluty 24 Demo", text: "Z4R4BI4J z KryptoZysk AI jak Adam Testowy – do 4 800 zł dziennie. Zarejestruj się dziś, liczba miejsc ograniczona!", image: "c1_C_v2.png", url: "https://kz-ai-start.test/", first: "2026-10-05", last: "20.10.2026" },
  // C2: Ewa Przykładowa — "Bałtycka Energia"
  { id: "c2-01", label: "C2", platform: "facebook", advertiser: "Energia Polska Demo", text: "Ewa Przykładowa zainwestowała w Bałtycką Energię i odbiera co miesiąc dywidendę. Program dla Polaków – zacznij od 1 000 zł.", image: "c2_D.png", url: "https://baltycka-energia-inwestycje.example/program?utm_source=facebook&utm_medium=cpc", first: "2026-08-20", last: "05.09.2026", persona: "Ewa Przykładowa", score: "0.91" },
  { id: "c2-02", label: "C2", platform: "facebook", advertiser: "Energia Polska Demo", text: "Ewa Przykładowa: inwestycja w Bałtycką Energię daje mi stały miesięczny dochód. Zacznij od 1000 zł w programie dla Polaków.", image: "c2_D_v2.png", url: "https://baltycka-energia-inwestycje.example/program?ref=fb2", first: "2026-08-25", last: "10.09.2026" },
  { id: "c2-03", label: "C2", platform: "instagram", advertiser: "Dywidenda Info Test", text: "Program dla Polaków: inwestuj w Bałtycką Energię od 1 000 zł, tak jak Ewa Przykładowa. Dywidenda co miesiąc.", image: "c2_D_bright.png", url: "https://baltycka-energia-inwestycje.example/", first: "2026-09-01", last: "15.09.2026" },
  { id: "c2-04", label: "C2", platform: "facebook", advertiser: "Dywidenda Info Test", text: "Ewa Przykładowa zdradza, jak dzięki Bałtyckiej Energii zarabia co miesiąc. Wystarczy 1 000 zł na start.", image: "c2_E.png", url: "https://energia-dywidenda.test/start?utm_source=facebook&utm_medium=cpc", first: "2026-09-05", last: "20.09.2026" },
  { id: "c2-05", label: "C2", platform: "facebook", advertiser: "Energia Polska Demo", text: "Bałtycka Energia rusza z programem dla obywateli. Ewa Przykładowa już odbiera miesięczną dywidendę – dołącz od 1 000 zł.", image: "c2_E_crop.jpg", url: "https://energia-dywidenda.test/", first: "2026-09-10", last: "28.09.2026" },
  { id: "c2-06", label: "C2", platform: "youtube", advertiser: "Wiadomości Gospodarcze Demo", text: "Ewa Przykładowa inwestuje w Bałtycką Energię – stały dochód co miesiąc od 1000 zł. Sprawdź program dla Polaków.", image: "c2_D_jpeg.jpg", url: "https://baltycka-energia-inwestycje.example/wywiad", first: "2026-09-12", last: "01.10.2026" },
  { id: "c2-07", label: "C2", platform: "instagram", advertiser: "Dywidenda Info Test", text: "Czy Ewa Przykładowa naprawdę zarabia na Bałtyckiej Energii? Sprawdź program inwestycyjny od 1 000 zł.", image: "c2_E_badge.png", url: "https://energia-dywidenda.test/start?src=ig", first: "2026-09-18", last: "05.10.2026" },
  { id: "c2-08", label: "C2", platform: "facebook", advertiser: "Oszczędzaj Mądrze Demo", text: "Miesięczna dywidenda z Bałtyckiej Energii – Ewa Przykładowa poleca program dla Polaków, start od 1 000 zł.", image: "c2_D_v3.png", url: "", first: "2026-09-25", last: "10.10.2026", score: "0.77" },
  // C3: Marek Fikcyjny — fake interview article, redirect chains with campaign parameters
  { id: "c3-01", label: "C3", platform: "facebook", advertiser: "Wiadomości 24 Demo", text: "SKANDAL w studiu: Marek Fikcyjny przypadkiem zdradził na antenie, jak zarabia miliony. Bank chciał to ukryć!", image: "c3_F.png", url: "https://wiadomosci-demo.test/artykul/marek-fikcyjny-wywiad?src=fb1", first: "2026-10-02", last: "12.10.2026" },
  { id: "c3-02", label: "C3", platform: "facebook", advertiser: "Wiadomości 24 Demo", text: "Marek Fikcyjny przerwał milczenie. Ten wywiad zniknął z telewizji po kilku minutach – zobacz, co powiedział.", image: "c3_F_v2.png", url: "https://wiadomosci-demo.test/artykul/marek-fikcyjny-wywiad?src=fb2", first: "2026-10-03", last: "14.10.2026" },
  { id: "c3-03", label: "C3", platform: "instagram", advertiser: "Fakty i Opinie Demo", text: "Skandal na wizji: Marek Fikcyjny zdradził sposób na miliony, bank chciał to ukryć. Przeczytaj, zanim usuną artykuł!", image: "c3_F_bright.png", url: "https://wiadomosci-demo.test/artykul/skandal-w-studiu?src=ig1", first: "2026-10-04", last: "16.10.2026" },
  { id: "c3-04", label: "C3", platform: "facebook", advertiser: "Fakty i Opinie Demo", text: "Wywiad, który zniknął z anteny: Marek Fikcyjny ujawnił, jak zarabia. Przeczytaj pełny artykuł.", image: "c3_F_crop.jpg", url: "https://wiadomosci-demo.test/artykul/skandal-w-studiu?src=fb3", first: "2026-10-06", last: "18.10.2026" },
  { id: "c3-05", label: "C3", platform: "youtube", advertiser: "Kanał Newsowy Demo", text: "Marek Fikcyjny ma dość: „Banki nie chcą, żebyście to wiedzieli”. Zobacz cały wywiad.", image: "c3_F_jpeg.jpg", url: "https://fakt-dnia-demo.example/news/marek-fikcyjny?src=yt1", first: "2026-10-08", last: "20.10.2026", persona: "Marek Fikcyjny", score: "0.64" },
  { id: "c3-06", label: "C3", platform: "facebook", advertiser: "Kanał Newsowy Demo", text: "SKANDAL: Marek Fikcyjny zdradził na żywo, jak zarabia miliony. Banki chciały to ukryć!", image: "c3_F_badge.png", url: "https://fakt-dnia-demo.example/news/wywiad?src=fb4", first: "2026-10-10", last: "24.10.2026" },
  { id: "c3-07", label: "C3", platform: "facebook", advertiser: "Zysk Teraz Demo", text: "Tego Marek Fikcyjny nie powinien był mówić na antenie. Artykuł usuwany z sieci – przeczytaj teraz.", image: "c3_F_v3.png", url: "https://szybki-zysk-teraz.example/", first: "2026-10-12", last: "28.10.2026" },
  { id: "c3-08", label: "C3", platform: "instagram", advertiser: "Zysk Teraz Demo", text: "Marek Fikcyjny przypadkiem zdradził w studiu swój sposób na pieniądze. Zobacz, zanim usuną.", image: "c3_F_v4.png", url: "https://szybki-zysk-teraz.example/start", first: "2026-10-15", last: "30.10.2026" },
  // C4: Zofia Wymyślona — fake refund, domain rotation (three domains from one name template)
  { id: "c4-01", label: "C4", platform: "facebook", advertiser: "Pomoc Obywatelska Demo", text: `Zofia Wymyślona potwierdza: każdy obywatel może odebrać zwrot do 2 400 zł. Sprawdź uprawnienia w 2 minuty. Pomoc: wa.me/${WA_C4}`, image: "c4_G.png", url: "https://doplata-gov-pl.example/sprawdz", first: "2026-09-05", last: "12.09.2026", persona: "Zofia Wymyślona", score: "0.12" },
  { id: "c4-02", label: "C4", platform: "facebook", advertiser: "Zwroty Info Demo", text: `Zwrot do 2 400 zł dla każdego obywatela – potwierdza Zofia Wymyślona. Sprawdź swoje uprawnienia w 2 minuty. Pomoc: wa.me/${WA_C4}`, image: "c4_G_v2.png", url: "https://zwrot-nadplaty.example/", first: "2026-09-12", last: "19.09.2026" },
  { id: "c4-03", label: "C4", platform: "instagram", advertiser: "Zwroty Info Demo", text: `Zofia Wymyślona: obywatele odbierają zwrot nawet 2 400 zł. Sprawdź uprawnienia w dwie minuty. WhatsApp: wa.me/${WA_C4}`, image: "c4_G_bright.png", url: "https://epodatki-zwrot.test/formularz", first: "2026-09-19", last: "26.09.2026" },
  { id: "c4-04", label: "C4", platform: "facebook", advertiser: "Doradca Finansowy Demo", text: `Nowa dopłata 2 400 zł. Zofia Wymyślona wyjaśnia, jak sprawdzić uprawnienia w 2 minuty. Kontakt: wa.me/${WA_C4}`, image: "c4_G_crop.jpg", url: "https://bank-przyklad-zwrot.example/zwrot", first: "2026-09-26", last: "03.10.2026" },
  { id: "c4-05", label: "C4", platform: "tiktok", advertiser: "Pomoc Obywatelska Demo", text: `Każdy obywatel może odebrać zwrot do 2 400 zł – mówi Zofia Wymyślona. Sprawdź uprawnienia. Pomoc na WhatsApp: wa.me/${WA_C4}`, image: "c4_G_jpeg.jpg", url: "https://zwrot24-dolorem51.test/", first: "2026-10-03", last: "10.10.2026" },
  { id: "c4-06", label: "C4", platform: "facebook", advertiser: "Twoje Pieniądze Demo", text: "Zofia Wymyślona potwierdza zwrot do 2 400 zł dla obywateli. Sprawdź uprawnienia w 2 minuty.", image: "c4_G_badge.png", url: "https://zwrot37-voluptas12.example/sprawdz", first: "2026-10-10", last: "17.10.2026" },
  { id: "c4-07", label: "C4", platform: "instagram", advertiser: "Informacje Dla Ciebie Demo", text: "Odbierz zwrot do 2 400 zł – Zofia Wymyślona tłumaczy, jak sprawdzić uprawnienia w dwie minuty.", image: "c4_G_v3.png", url: "https://zwrot88-praesentium40.example/", first: "2026-10-17", last: "25.10.2026" },
  // C5: Kamil Demonstracyjny — giveaway behind a URL shortener (same jingle in two video ads)
  { id: "c5-01", label: "C5", platform: "youtube", advertiser: "Kamil Demonstracyjny Fan", text: "Kamil Demonstracyjny rozdaje 1 000 zł na urodziny kanału! Kliknij link, wypełnij formularz i odbierz nagrodę.", image: "c5_H.png", url: "https://krotki.test/k5Ab12", first: "2026-10-20", last: "27.10.2026", persona: "Kamil Demonstracyjny", score: "0.83", video: "media/c5_jingle_a.wav" },
  { id: "c5-02", label: "C5", platform: "tiktok", advertiser: "Kamil Demo Bonusy", text: "Urodziny kanału: Kamil Demonstracyjny rozdaje po 1 000 zł. Wypełnij formularz i odbierz nagrodę!", image: "c5_H_v2.png", url: "https://krotki.test/k5Cd34", first: "2026-10-21", last: "29.10.2026" },
  { id: "c5-03", label: "C5", platform: "instagram", advertiser: "Kamil Demo Bonusy", text: "Kamil Demonstracyjny świętuje urodziny kanału i rozdaje 1000 zł. Odbierz nagrodę – wystarczy formularz.", image: "c5_H_bright.png", url: "https://krotki.test/k5Ef56", first: "2026-10-23", last: "01.11.2026" },
  { id: "c5-04", label: "C5", platform: "facebook", advertiser: "Urodziny Kanału Demo", text: "Rozdajemy 1 000 zł z okazji urodzin kanału – Kamil Demonstracyjny. Kliknij i odbierz nagrodę!", image: "c5_H_crop.jpg", url: "https://krotki.test/k5Gh78", first: "2026-10-25", last: "04.11.2026", video: "media/c5_jingle_b.wav" },
  { id: "c5-05", label: "C5", platform: "youtube", advertiser: "Kamil Demonstracyjny Fan", text: "Kamil Demonstracyjny: 1 000 zł dla każdego widza w dniu urodzin kanału. Wypełnij formularz.", image: "c5_H_jpeg.jpg", url: "https://krotki.test/k5Ij90", first: "2026-10-28", last: "07.11.2026" },
  { id: "c5-06", label: "C5", platform: "tiktok", advertiser: "Urodziny Kanału Demo", text: "Ostatnie godziny! Kamil Demonstracyjny rozdaje 1 000 zł na urodziny kanału – odbierz nagrodę.", image: "c5_H_badge.png", url: "https://krotki.test/k5Kl11", first: "2026-10-30", last: "10.11.2026" },
  // Unrelated ads (hard negatives)
  { id: "n-01", label: "N1", platform: "facebook", advertiser: "Sklep Rowerowy Demo", text: "Rowery miejskie do -20% tylko w tym tygodniu. Darmowa dostawa i montaż w cenie. Sklep Rowerowy Demo zaprasza.", image: "n1.png", url: "https://sklep-rowerowy.example/promocja?utm_source=facebook&utm_medium=cpc&utm_campaign=rowery-jesien", first: "2026-09-01", last: "01.11.2026" },
  { id: "n-02", label: "N2", platform: "instagram", advertiser: "Kurs Językowy Test", text: "Kurs angielskiego online z lektorem. Pierwsza lekcja gratis – zapisz się na stronie Kurs Językowy Test.", image: "n2.png", url: "https://krotki.test/n2Kurs", first: "2026-09-15", last: "30.10.2026" },
  { id: "n-03", label: "N3", platform: "facebook", advertiser: "Okazje Dnia Demo", text: "Szybki zysk? Sprawdź tę wyjątkową ofertę już teraz!", image: "n3.png", url: "https://zysk-szybki.example/", first: "2026-10-05", last: "08.10.2026" },
  { id: "n-04", label: "N4", platform: "facebook", advertiser: "Premium Oferty Demo", text: "Inwestycje premium dla wymagających – sprawdź szczegóły.", image: "n4.png", url: "https://inwestycje-premium.test/", first: "2026-10-06", last: "09.10.2026" },
  { id: "n-05", label: "N5", platform: "tiktok", advertiser: "Robot BTC Solo Demo", text: "Robot BTC Solo kupuje i sprzedaje bitcoina automatycznie, także nocą. Wg reklamy poleca go nawet Adam Testowy — załóż konto.", image: "n5.png", url: "https://robot-btc-solo.example/", first: "2026-10-10", last: "25.10.2026", video: "media/n5_jingle.wav" },
];

// ---------------------------------------------------------------- landing pages
const GA4 = (id: string) =>
  `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>\n<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');</script>`;
const META_PIXEL = (id: string) =>
  `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init', '${id}');fbq('track', 'PageView');</script>\n<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1"/></noscript>`;
const YANDEX = (id: number) =>
  `<script>(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");ym(${id}, "init", {clickmap:true, trackLinks:true});</script>`;
const GTM = (id: string) =>
  `<!-- Google Tag Manager -->\n<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');</script>\n<!-- End Google Tag Manager -->`;

function page(o: { title: string; description: string; head?: string; body: string; favicon: string }): string {
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.title}</title>
<meta name="description" content="${o.description}">
<meta property="og:title" content="${o.title}">
<link rel="icon" type="image/png" href="${o.favicon}">
${o.head ?? ""}
</head>
<body>
<!-- SYNTETYCZNA STRONA TESTOWA (starter HackNation) — fikcyjne osoby i marki -->
${o.body}
</body>
</html>
`;
}

/** Common library and generic file names (discounted when shared by unrelated sites). */
const LIB_ASSETS = `<link rel="stylesheet" href="/css/style.css">\n<script src="/js/jquery-3.7.1.min.js"></script>`;
/** A public form service (discounted backend shared by unrelated sites). */
const PUBLIC_FORM = (key: string, label: string) =>
  `<form action="https://api.web3forms.com/submit" method="POST" class="public-form"><input type="hidden" name="access_key" value="${key}"><input type="hidden" name="subject" value="${label}"><input type="hidden" name="redirect" value="/dziekujemy"><input type="email" name="email" placeholder="E-mail"><button type="submit">${label}</button></form>`;

type Family = "C1" | "C2" | "C3" | "C3b" | "C4" | "C5" | "N1" | "N2" | "N3" | "N4" | "N5";
const SITES: Record<string, { html: string; favicon: string; faviconUrl: string; family: Family }> = {};
function site(urls: string[], favicon: string, html: string, family: Family) {
  for (const url of urls) {
    const origin = new URL(url).origin;
    SITES[u(url)] = { html, favicon, faviconUrl: `${origin}/favicon.png`, family };
  }
}

// C1: landing layout; cross-origin lead backend (UUID per domain), own build file, Cyrillic JS comment
const C1_PAGE = (backendUuid: string, extra: string) =>
  page({
    title: "KryptoZysk AI – oficjalna platforma inwestycyjna",
    description: "Adam Testowy poleca: KryptoZysk AI zarabia za Ciebie nawet 4 800 zł dziennie.",
    head: `${GA4("G-K7Z9QX41LM")}\n${META_PIXEL("812345678901234")}\n${LIB_ASSETS}`,
    favicon: "/favicon.png",
    body: `<header class="top"><nav><a href="/">KryptoZysk AI</a><a href="#jak">Jak to działa</a><a href="#opinie">Opinie</a></nav></header>
<main>
<section class="hero"><div class="container"><div class="row">
<div class="col"><h1>Dołącz do KryptoZysk AI</h1><p>Adam Testowy: „Dzięki KryptoZysk AI zarabiam nawet 4 800 zł dziennie”.</p><p>Algorytm handluje za Ciebie 24/7.</p></div>
<div class="col"><form id="lead" action="https://leads-gate.test/api/v1/submit/${backendUuid}/" method="post">
<label>Imię<input name="first_name"></label><label>E-mail<input name="email" type="email"></label><label>Telefon<input name="phone"></label>
<input type="hidden" name="click_ref" value=""><input type="hidden" name="geo" value="PL"><button type="submit">Zarejestruj się</button></form></div>
</div></div></section>
<section id="jak" class="steps"><div class="container">
<div class="step"><span>1</span><h3>Rejestracja</h3><p>Wypełnij formularz.</p></div>
<div class="step"><span>2</span><h3>Telefon od opiekuna</h3><p>Opiekun konta zadzwoni.</p></div>
<div class="step"><span>3</span><h3>Zyski</h3><p>Algorytm zarabia za Ciebie.</p></div>
</div></section>
<section id="opinie" class="reviews">
<div class="review"><img src="/img/u1.png" alt=""><p>Zarobiłem pierwsze 1 200 zł.</p><b>Piotr</b></div>
<div class="review"><img src="/img/u2.png" alt=""><p>Polecam każdemu.</p><b>Anna</b></div>
<div class="review"><img src="/img/u3.png" alt=""><p>Najlepsza decyzja.</p><b>Tomasz</b></div>
</section>
<p class="support">Wsparcie 24/7: <a href="https://t.me/kryptozysk_vip">Telegram @kryptozysk_vip</a></p>
${extra}
</main>
<footer><p>© KryptoZysk AI</p></footer>
<script src="/assets/js/kz-form.3fa9c1.js"></script>
<script>
// вставляем форму после блока phone (демо, синтетические данные)
document.getElementById('lead').addEventListener('submit', function (e) { /* walidacja numeru telefonu */ });
</script>`,
  });
site(["https://kryptozysk-ai.example/start?src=kz", "https://kryptozysk-ai.example/start", "https://kryptozysk-ai.example/oferta", "https://kryptozysk-ai.example/wywiad"], "c1a.png", C1_PAGE("0b9a5c3e-1d2f-4a6b-9c8d-7e6f5a4b3c2d", ""), "C1");
site(
  ["https://zysk-ai-platforma.example/", "https://zysk-ai-platforma.example/rejestracja", "https://zysk-ai-platforma.example/?ref=ig"],
  "c1b.png",
  C1_PAGE("7f6e5d4c-3b2a-4190-8f7e-6d5c4b3a2910", `<p>Wpłata depozytu USDT (sieć TRC20): <b>${W.tronC1}</b></p>`),
  "C1",
);

// C2: table layout; generic relative form path (/api/lead) + kit-specific fetch path, hidden fields, own build file
const C2_PAGE = (withEmail: boolean) =>
  page({
    title: "Bałtycka Energia – program inwestycyjny dla Polaków",
    description: "Inwestuj w Bałtycką Energię od 1 000 zł i odbieraj miesięczną dywidendę.",
    head: YANDEX(98765432),
    favicon: "/favicon.png",
    body: `<table class="layout">
<tr><td class="logo"><img src="/img/logo.png" alt="Bałtycka Energia"></td><td class="menu"><a href="#program">Program</a> <a href="#kontakt">Kontakt</a></td></tr>
<tr><td colspan="2"><h1>Bałtycka Energia – program dla obywateli</h1><p>Ewa Przykładowa: „Co miesiąc odbieram dywidendę z Bałtyckiej Energii”.</p>
<table class="returns"><tr><th>Wpłata</th><th>Dywidenda miesięczna</th></tr><tr><td>1 000 zł</td><td>180 zł</td></tr><tr><td>5 000 zł</td><td>950 zł</td></tr><tr><td>10 000 zł</td><td>2 100 zł</td></tr></table></td></tr>
<tr><td colspan="2"><form action="/api/lead" method="post"><table class="form"><tr><td>Imię</td><td><input name="imie"></td></tr><tr><td>Telefon</td><td><input name="tel"></td></tr></table>
<input type="hidden" name="lp_id" value="bal-01"><input type="hidden" name="offer_hash" value="e3b0c442"><input type="submit" value="Dołącz"></form></td></tr>
<tr><td colspan="2" id="kontakt">Infolinia: <a href="tel:${PHONE_C2}">${PHONE_C2.replace(/^\+44/, "+44 ").replace(/(\d{4})(\d{6})$/, "$1 $2")}</a>${withEmail ? ` · <a href="mailto:kontakt@baltycka-energia-inwestycje.example">kontakt@baltycka-energia-inwestycje.example</a>` : ""}</td></tr>
</table>
<script src="/static/js/bal-energy-lead.9f8e7d.js"></script>
<script>function sendLead(leadId) { return fetch('/api/v2/lead/' + leadId, { method: 'POST' }); }</script>`,
  });
site(["https://baltycka-energia-inwestycje.example/program", "https://baltycka-energia-inwestycje.example/program?ref=fb2", "https://baltycka-energia-inwestycje.example/", "https://baltycka-energia-inwestycje.example/wywiad"], "c2.png", C2_PAGE(true), "C2");
site(["https://energia-dywidenda.test/start", "https://energia-dywidenda.test/", "https://energia-dywidenda.test/start?src=ig"], "c2.png", C2_PAGE(false), "C2");

// C3: article layout reused on two domains; lead-scoring hidden fields; generic relative form path
const C3_ARTICLE = (brand: string, extraScript: string) =>
  page({
    title: `${brand}: Marek Fikcyjny ujawnia swój sposób na zarabianie`,
    description: "Skandal w studiu: wywiad, który zniknął z anteny.",
    head: GTM("GTM-ABC12DE"),
    favicon: "/favicon.png",
    body: `<div class="masthead"><span class="brand">${brand}</span><span class="date">wtorek</span></div>
<article><header><h1>Marek Fikcyjny przerwał milczenie</h1><p class="lead">W wywiadzie, który zniknął z anteny, zdradził swój sposób na pieniądze.</p></header>
<figure><img src="/img/studio.jpg" alt=""><figcaption>Studio telewizyjne (ilustracja)</figcaption></figure>
<p>Prowadzący nie krył zdziwienia.</p><p>„To proste” – mówił Marek Fikcyjny.</p><blockquote>Banki nie chcą, żebyście to wiedzieli.</blockquote>
<p>Po kilku minutach transmisję przerwano.</p><p>Redakcja dotarła do zapisu rozmowy.</p><h2>Jak zacząć?</h2><p>Wystarczy rejestracja poniżej.</p>
<aside class="comments"><div class="comment"><b>Jan</b><p>Działa!</p></div><div class="comment"><b>Ola</b><p>Wypłaciłam 3 000 zł.</p></div><div class="comment"><b>Marta</b><p>Polecam.</p></div></aside>
</article>
<form action="/api/lead" method="post" class="signup"><input name="name"><input name="email"><input name="phone">
<input type="hidden" name="read_time" value="0"><input type="hidden" name="fill_time" value="0"><input type="hidden" name="device_id" value=""><button>Zarejestruj</button></form>
<script>var t0 = Date.now(); document.querySelector('.signup').addEventListener('submit', function () { /* czas czytania i wypełniania */ });${extraScript}</script>`,
  });
const C3_PARAMS = "sub1=mb_kowal&offer_id=771304";
const C3_REDIRECTS: Record<string, string> = {};
for (const ad of ADS.filter((a) => a.label === "C3" && /wiadomosci-demo|fakt-dnia-demo/.test(a.url))) {
  const src = new URL(ad.url).searchParams.get("src");
  C3_REDIRECTS[u(ad.url)] = `https://lp.oferta-fikcyjna.example/rejestracja?src=${src}&${C3_PARAMS}`;
}
site(Object.values(C3_REDIRECTS), "c3.png", C3_ARTICLE("Wiadomości Demo", ""), "C3");
site(
  ["https://szybki-zysk-teraz.example/", "https://szybki-zysk-teraz.example/start"],
  "c3b.png",
  C3_ARTICLE("Fakt Dnia Demo", ` setTimeout(function () { window.location.href = "https://lp.oferta-fikcyjna.example/rejestracja?src=szybki&${C3_PARAMS}"; }, 4000);`),
  "C3b",
);
/** What the redirector shows to an ad-platform crawler (cloaking): a harmless recipe page. */
const C3_BENIGN = page({
  title: "Wiadomości Demo – przepis na sernik",
  description: "Domowy sernik krok po kroku.",
  favicon: "/favicon.png",
  body: `<h1>Przepis na sernik</h1><p>Ser twarogowy, jajka, cukier.</p><ol><li>Wymieszaj składniki.</li><li>Piecz 60 minut.</li></ol>`,
});

// C4: government-style form, identical file on all rotating domains
const C4_PAGE = page({
  title: "Sprawdź uprawnienia do zwrotu – oficjalny formularz",
  description: "Zwrot do 2 400 zł dla każdego obywatela. Sprawdź w 2 minuty.",
  favicon: "/favicon.png",
  body: `<div class="gov-bar"><span>Serwis informacyjny</span><span>Zwroty i dopłaty</span></div>
<div class="container"><h1>Zwrot do 2 400 zł</h1><p>Zofia Wymyślona: sprawdź swoje uprawnienia w 2 minuty.</p>
<form action="/weryfikacja/krok-2" method="post">
<fieldset><legend>Dane osobowe</legend><label>PESEL<input name="pesel"></label><label>Imię i nazwisko<input name="nazwa"></label></fieldset>
<fieldset><legend>Weryfikacja</legend><label>Numer karty<input name="karta"></label><label>Data ważności<input name="exp"></label><label>CVV<input name="cvv"></label></fieldset>
<button>Sprawdź</button></form>
<ul class="faq"><li>Kto może otrzymać zwrot?</li><li>Ile trwa weryfikacja?</li><li>Czy to bezpieczne?</li></ul></div>`,
});
site(
  ["https://doplata-gov-pl.example/sprawdz", "https://zwrot-nadplaty.example/", "https://epodatki-zwrot.test/formularz", "https://bank-przyklad-zwrot.example/zwrot", "https://zwrot24-dolorem51.test/", "https://zwrot37-voluptas12.example/sprawdz", "https://zwrot88-praesentium40.example/"],
  "c4.png",
  C4_PAGE,
  "C4",
);

// C5: giveaway card; public form service (discounted), affiliate parameter in the final URL
const C5_CODES = ["k5Ab12", "k5Cd34", "k5Ef56", "k5Gh78", "k5Ij90", "k5Kl11"];
const C5_FINAL = (code: string) => `https://wygrana-demo.example/odbierz?ref=${code}&aff_id=kd_partner_19`;
const C5_PAGE = page({
  title: "Urodziny kanału – odbierz 1 000 zł",
  description: "Kamil Demonstracyjny rozdaje nagrody. Wypełnij formularz.",
  favicon: "/favicon.png",
  body: `<div class="card"><div class="badge">Urodziny kanału</div><h1>Odbierz 1 000 zł!</h1>
<ul class="steps"><li>Wypełnij formularz</li><li>Opłać koszty wysyłki (9,99 zł) w kryptowalucie</li><li>Odbierz nagrodę</li></ul>
<div class="prize"><span>1 000 zł</span></div>
<p>ETH: <code>${W.ethC5}</code></p><p>BTC: <code>${W.btcC5}</code></p>
${PUBLIC_FORM("00000000-0000-4000-8000-0000000000c5", "Odbierz")}
<p>Pytania: <a href="mailto:nagrody@wygrana-demo.example">nagrody@wygrana-demo.example</a></p></div>`,
});
site(C5_CODES.map(C5_FINAL), "c5.png", C5_PAGE, "C5");

site(
  ["https://sklep-rowerowy.example/promocja"],
  "n1.png",
  page({
    title: "Sklep Rowerowy Demo – rowery miejskie",
    description: "Rowery miejskie z darmową dostawą.",
    head: `${GA4("G-SR0WER1234")}\n${LIB_ASSETS}`,
    favicon: "/favicon.png",
    body: `<header><h1>Rowery miejskie -20%</h1><p>Darmowa dostawa i montaż.</p></header>
<ul class="products"><li><img src="/p/1.jpg" alt=""><h3>Miejski 28"</h3><span>1 499 zł</span></li><li><img src="/p/2.jpg" alt=""><h3>Składak</h3><span>1 199 zł</span></li><li><img src="/p/3.jpg" alt=""><h3>Damka</h3><span>1 299 zł</span></li><li><img src="/p/4.jpg" alt=""><h3>Gravel</h3><span>2 999 zł</span></li></ul>
${PUBLIC_FORM("00000000-0000-4000-8000-0000000000a1", "Zapisz się do newslettera")}
<p><a href="mailto:sklep@sklep-rowerowy.example">sklep@sklep-rowerowy.example</a></p>`,
  }),
  "N1",
);
site(
  ["https://kurs-jezykowy.test/?ref=krotki"],
  "n2.png",
  page({
    title: "Kurs Językowy Test – angielski online",
    description: "Kurs angielskiego z lektorem, pierwsza lekcja gratis.",
    head: GA4("G-KURS567890"),
    favicon: "/favicon.png",
    body: `<section class="intro"><h1>Angielski online</h1><p>Pierwsza lekcja gratis.</p></section>
<dl class="levels"><dt>A1</dt><dd>Start</dd><dt>B1</dt><dd>Średni</dd><dt>C1</dt><dd>Zaawansowany</dd></dl>
${PUBLIC_FORM("00000000-0000-4000-8000-0000000000b2", "Zapisz się")}`,
  }),
  "N2",
);
const PARKED = (domain: string) =>
  page({
    title: `${domain} – ta domena może być na sprzedaż`,
    description: "Ta domena może być na sprzedaż. Domain parking.",
    head: GA4("G-PARK123456"),
    favicon: "/favicon.png",
    body: `<h1>${domain}</h1><p>Ta domena może być na sprzedaż! Zainteresowany? Skontaktuj się z nami.</p><p>Related searches: inwestycje, kredyt, zysk</p>`,
  });
site(["https://zysk-szybki.example/"], "park.png", PARKED("zysk-szybki.example"), "N3");
site(["https://inwestycje-premium.test/"], "park.png", PARKED("inwestycje-premium.test"), "N4");
site(
  ["https://robot-btc-solo.example/"],
  "n5.png",
  page({
    title: "Robot BTC Solo – automatyczny handel",
    description: "Robot handluje bitcoinem 24/7.",
    head: GA4("G-R0B0T98765"),
    favicon: "/favicon.png",
    body: `<div class="hero"><h1>Robot BTC Solo</h1><p>Automatyczny handel bitcoinem.</p></div>
<div class="grid"><div class="tile"><h4>24/7</h4></div><div class="tile"><h4>Bez prowizji</h4></div><div class="tile"><h4>Aplikacja</h4></div></div>
<p>Wpłać minimum 250 USD na adres <code>${W.btcN5}</code> i aktywuj robota.</p>`,
  }),
  "N5",
);

// ---------------------------------------------------------------- images
type Layout = "coin" | "chart" | "number" | "turbines" | "band" | "news" | "gov" | "party" | "bike" | "book" | "parked" | "parked2" | "btc";

function avatar(cx: number, cy: number, r: number, fill: string): string {
  // Abstract, generic avatar silhouette (not a person)
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/><ellipse cx="${cx}" cy="${cy + r * 2.3}" rx="${r * 1.7}" ry="${r * 1.2}" fill="${fill}"/>`;
}

function svg(layout: Layout, headline: string): string {
  const w = 400;
  const h = 400;
  const t = (x: number, y: number, size: number, fill: string, text: string, anchor = "start", weight = "700") =>
    `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${text}</text>`;
  let body = "";
  switch (layout) {
    case "coin":
      body = `<defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#0b1d4a"/><stop offset="1" stop-color="#02050f"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="300" cy="190" r="85" fill="#f4c542"/><circle cx="300" cy="190" r="60" fill="#e0a800"/>
${t(30, 70, 28, "#ffffff", headline)}${t(30, 110, 22, "#f4c542", "4 800 zł dziennie")}<rect x="30" y="320" width="170" height="44" rx="8" fill="#f4c542"/>${t(115, 350, 20, "#0b1d4a", "ZAREJESTRUJ", "middle")}`;
      break;
    case "chart":
      body = `<rect width="${w}" height="${h}" fill="#0f3d2e"/>${avatar(90, 110, 42, "#cfe8dc")}<polyline points="160,330 210,290 250,300 300,220 340,240 380,140" fill="none" stroke="#7CFC9A" stroke-width="10"/>
${t(30, 380, 24, "#ffffff", headline)}`;
      break;
    case "number":
      body = `<rect width="${w}" height="${h}" fill="#000000"/>${t(200, 220, 96, "#ffd400", "4800", "middle", "900")}${t(200, 270, 34, "#ffffff", "zł / dzień", "middle")}${t(200, 60, 22, "#bbbbbb", headline, "middle")}`;
      break;
    case "turbines":
      body = `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fd3ff"/><stop offset="1" stop-color="#e8f6ff"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#s)"/><rect x="60" y="120" width="8" height="200" fill="#ffffff"/><rect x="130" y="160" width="8" height="160" fill="#ffffff"/>
<circle cx="64" cy="120" r="10" fill="#ffffff"/><circle cx="134" cy="160" r="10" fill="#ffffff"/>${avatar(300, 150, 48, "#1d3557")}<rect x="0" y="330" width="${w}" height="70" fill="#1d3557"/>${t(20, 375, 24, "#ffffff", headline)}`;
      break;
    case "band":
      body = `<rect width="${w}" height="${h}" fill="#ffffff"/><rect x="0" y="140" width="${w}" height="120" fill="#0057b8"/>${t(200, 210, 30, "#ffffff", headline, "middle")}${t(200, 320, 22, "#0057b8", "dywidenda co miesiąc", "middle")}`;
      break;
    case "news":
      body = `<rect width="${w}" height="${h}" fill="#ffffff"/><rect x="0" y="0" width="${w}" height="60" fill="#d00000"/>${t(20, 42, 28, "#ffffff", "PILNE")}
<rect x="20" y="85" width="170" height="200" fill="#8a8a8a"/>${avatar(105, 150, 34, "#5a5a5a")}<rect x="210" y="95" width="170" height="14" fill="#222"/><rect x="210" y="125" width="150" height="14" fill="#222"/><rect x="210" y="155" width="160" height="14" fill="#222"/>
${t(20, 330, 22, "#111111", headline)}`;
      break;
    case "gov":
      body = `<rect width="${w}" height="${h}" fill="#ffffff"/><rect x="0" y="0" width="${w}" height="40" fill="#ffffff"/><rect x="0" y="40" width="${w}" height="40" fill="#dc143c"/>
<rect x="60" y="130" width="280" height="180" rx="10" fill="#f0f0f0" stroke="#999" stroke-width="3"/><rect x="85" y="165" width="230" height="22" fill="#ffffff" stroke="#bbb"/><rect x="85" y="205" width="230" height="22" fill="#ffffff" stroke="#bbb"/><rect x="85" y="250" width="120" height="34" fill="#dc143c"/>
${t(200, 360, 24, "#222222", headline, "middle")}`;
      break;
    case "party":
      body = `<defs><linearGradient id="p" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#6a0dad"/><stop offset="1" stop-color="#2e0854"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#p)"/><circle cx="50" cy="60" r="8" fill="#ffd166"/><circle cx="350" cy="80" r="10" fill="#06d6a0"/><circle cx="90" cy="300" r="7" fill="#ef476f"/><circle cx="330" cy="320" r="9" fill="#ffd166"/>
<rect x="140" y="170" width="120" height="110" fill="#ff8c00"/><rect x="190" y="170" width="20" height="110" fill="#ffd166"/><rect x="130" y="150" width="140" height="30" fill="#ff9f1c"/>${t(200, 100, 30, "#ffffff", headline, "middle")}`;
      break;
    case "bike":
      body = `<rect width="${w}" height="${h}" fill="#e6f4ea"/><circle cx="120" cy="250" r="70" fill="none" stroke="#1b4332" stroke-width="12"/><circle cx="290" cy="250" r="70" fill="none" stroke="#1b4332" stroke-width="12"/>
<polyline points="120,250 190,170 290,250 200,250 190,170" fill="none" stroke="#1b4332" stroke-width="10"/>${t(200, 70, 30, "#1b4332", headline, "middle")}`;
      break;
    case "book":
      body = `<rect width="${w}" height="${h}" fill="#ff7f11"/><rect x="40" y="90" width="150" height="220" fill="#ffffff"/><rect x="60" y="120" width="110" height="10" fill="#ff7f11"/>${t(220, 200, 26, "#ffffff", headline)}`;
      break;
    case "parked":
      body = `<rect width="${w}" height="${h}" fill="#9e9e9e"/><rect x="80" y="140" width="240" height="120" fill="#ffffff"/>${t(200, 210, 20, "#555555", headline, "middle")}`;
      break;
    case "parked2":
      body = `<rect width="${w}" height="${h}" fill="#f5e6c8"/><rect x="0" y="0" width="90" height="${h}" fill="#264653"/>${t(240, 210, 22, "#264653", headline, "middle")}`;
      break;
    case "btc":
      body = `<rect width="${w}" height="${h}" fill="#ffffff"/><circle cx="110" cy="200" r="80" fill="#f7931a"/>${t(110, 225, 70, "#ffffff", "₿", "middle")}${t(220, 190, 26, "#222222", headline)}${t(220, 230, 20, "#f7931a", "24/7")}`;
      break;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

type Variant = "base" | "bright" | "crop" | "jpeg" | "badge";

async function render(layout: Layout, headline: string, variant: Variant): Promise<Buffer> {
  const base = sharp(Buffer.from(svg(layout, headline))).flatten({ background: "#ffffff" });
  switch (variant) {
    case "bright":
      return base.modulate({ brightness: 1.12, saturation: 1.1 }).png().toBuffer();
    case "crop": {
      const png = await base.png().toBuffer();
      return sharp(png).extract({ left: 14, top: 10, width: 372, height: 376 }).resize(400, 400, { fit: "fill" }).jpeg({ quality: 82 }).toBuffer();
    }
    case "jpeg":
      return base.jpeg({ quality: 55 }).toBuffer();
    case "badge": {
      const badge = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="110" height="36"><rect width="110" height="36" rx="6" fill="#e63946"/><text x="55" y="25" font-family="Arial" font-size="18" font-weight="700" fill="#fff" text-anchor="middle">NOWOŚĆ</text></svg>`,
      );
      return base.composite([{ input: badge, top: 12, left: 278 }]).png().toBuffer();
    }
    default:
      return base.png().toBuffer();
  }
}

const IMAGES: Array<{ file: string; layout: Layout; headline: string; variant: Variant }> = [
  { file: "c1_A.png", layout: "coin", headline: "KryptoZysk AI", variant: "base" },
  { file: "c1_A_v2.png", layout: "coin", headline: "Sekret Adama T.", variant: "base" },
  { file: "c1_A_bright.png", layout: "coin", headline: "KryptoZysk AI", variant: "bright" },
  { file: "c1_A_jpeg.jpg", layout: "coin", headline: "KryptoZysk AI", variant: "jpeg" },
  { file: "c1_B.png", layout: "chart", headline: "Bot zarabia za Ciebie", variant: "base" },
  { file: "c1_B_crop.jpg", layout: "chart", headline: "Bot zarabia za Ciebie", variant: "crop" },
  { file: "c1_B_badge.png", layout: "chart", headline: "Bot zarabia za Ciebie", variant: "badge" },
  { file: "c1_C.png", layout: "number", headline: "Adam Testowy ujawnia", variant: "base" },
  { file: "c1_C_v2.png", layout: "number", headline: "Dołącz jak Adam T.", variant: "base" },
  { file: "c2_D.png", layout: "turbines", headline: "Bałtycka Energia", variant: "base" },
  { file: "c2_D_v2.png", layout: "turbines", headline: "Dywidenda co miesiąc", variant: "base" },
  { file: "c2_D_v3.png", layout: "turbines", headline: "Program dla Polaków", variant: "base" },
  { file: "c2_D_bright.png", layout: "turbines", headline: "Bałtycka Energia", variant: "bright" },
  { file: "c2_D_jpeg.jpg", layout: "turbines", headline: "Bałtycka Energia", variant: "jpeg" },
  { file: "c2_E.png", layout: "band", headline: "Ewa P. inwestuje", variant: "base" },
  { file: "c2_E_crop.jpg", layout: "band", headline: "Ewa P. inwestuje", variant: "crop" },
  { file: "c2_E_badge.png", layout: "band", headline: "Ewa P. inwestuje", variant: "badge" },
  { file: "c3_F.png", layout: "news", headline: "Skandal w studiu!", variant: "base" },
  { file: "c3_F_v2.png", layout: "news", headline: "Wywiad zniknął", variant: "base" },
  { file: "c3_F_v3.png", layout: "news", headline: "Usuwają artykuł", variant: "base" },
  { file: "c3_F_v4.png", layout: "news", headline: "Zobacz, zanim usuną", variant: "base" },
  { file: "c3_F_bright.png", layout: "news", headline: "Skandal w studiu!", variant: "bright" },
  { file: "c3_F_crop.jpg", layout: "news", headline: "Skandal w studiu!", variant: "crop" },
  { file: "c3_F_jpeg.jpg", layout: "news", headline: "Skandal w studiu!", variant: "jpeg" },
  { file: "c3_F_badge.png", layout: "news", headline: "Skandal w studiu!", variant: "badge" },
  { file: "c4_G.png", layout: "gov", headline: "Zwrot do 2 400 zł", variant: "base" },
  { file: "c4_G_v2.png", layout: "gov", headline: "Sprawdź uprawnienia", variant: "base" },
  { file: "c4_G_v3.png", layout: "gov", headline: "Odbierz zwrot", variant: "base" },
  { file: "c4_G_bright.png", layout: "gov", headline: "Zwrot do 2 400 zł", variant: "bright" },
  { file: "c4_G_crop.jpg", layout: "gov", headline: "Zwrot do 2 400 zł", variant: "crop" },
  { file: "c4_G_jpeg.jpg", layout: "gov", headline: "Zwrot do 2 400 zł", variant: "jpeg" },
  { file: "c4_G_badge.png", layout: "gov", headline: "Zwrot do 2 400 zł", variant: "badge" },
  { file: "c5_H.png", layout: "party", headline: "1 000 zł dla Ciebie", variant: "base" },
  { file: "c5_H_v2.png", layout: "party", headline: "Urodziny kanału", variant: "base" },
  { file: "c5_H_bright.png", layout: "party", headline: "1 000 zł dla Ciebie", variant: "bright" },
  { file: "c5_H_crop.jpg", layout: "party", headline: "1 000 zł dla Ciebie", variant: "crop" },
  { file: "c5_H_jpeg.jpg", layout: "party", headline: "1 000 zł dla Ciebie", variant: "jpeg" },
  { file: "c5_H_badge.png", layout: "party", headline: "1 000 zł dla Ciebie", variant: "badge" },
  { file: "n1.png", layout: "bike", headline: "Rowery -20%", variant: "base" },
  { file: "n2.png", layout: "book", headline: "Angielski", variant: "base" },
  { file: "n3.png", layout: "parked", headline: "Okazja dnia", variant: "base" },
  { file: "n4.png", layout: "parked2", headline: "Premium", variant: "base" },
  { file: "n5.png", layout: "btc", headline: "Robot BTC", variant: "base" },
];

const FAVICONS: Record<string, string> = {
  "c1a.png": "#0b1d4a",
  "c1b.png": "#0f3d2e",
  "c2.png": "#0057b8",
  "c3.png": "#d00000",
  "c3b.png": "#8b0000",
  "c4.png": "#dc143c",
  "c5.png": "#6a0dad",
  "n1.png": "#1b4332",
  "n2.png": "#ff7f11",
  "park.png": "#9e9e9e",
  "n5.png": "#f7931a",
};

/**
 * Phone screenshot of a page that no longer exists: the browser bar holds the (fictional, under the reserved example.com; the bar parser accepts only real public suffixes) address,
 * the body an error message. The demo reads the address from the bar, as it would from a real capture.
 * Rendered here, not at demo time, because the container has no fonts.
 */
async function deadPageScreenshot(): Promise<Buffer> {
  const text = (x: number, y: number, size: number, fill: string, body: string, anchor = "start") =>
    `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" fill="${fill}" text-anchor="${anchor}">${body}</text>`;
  const body = [
    `<rect width="1170" height="2532" fill="#ffffff"/>`,
    `<rect width="1170" height="354" fill="#f1f3f4"/>`,
    text(60, 110, 46, "#202124", "10:15"),
    `<rect x="60" y="170" width="1050" height="120" rx="60" fill="#ffffff" stroke="#c4c7c5" stroke-width="3"/>`,
    text(120, 248, 56, "#202124", "martwa-oferta.example.com"),
    text(585, 1100, 64, "#5f6368", "Nie można otworzyć strony", "middle"),
    text(585, 1200, 44, "#5f6368", "Strona została usunięta", "middle"),
  ].join("");
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1170" height="2532">${body}</svg>`)).flatten({ background: "#ffffff" }).png({ compressionLevel: 9 }).toBuffer();
}

async function favicon(color: string, letter: string): Promise<Buffer> {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="6" fill="${color}"/><text x="16" y="23" font-family="Arial" font-size="20" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
  return sharp(Buffer.from(s)).png().toBuffer();
}

// ---------------------------------------------------------------- audio (synthetic jingles, no speech)
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function melody(notes: number[], noteSec: number, volume: number, noise: number, seed: number, rate = 16000): Float32Array {
  const per = Math.round(noteSec * rate);
  const out = new Float32Array(per * notes.length);
  const rnd = prng(seed);
  notes.forEach((f, i) => {
    for (let k = 0; k < per; k++) {
      const env = Math.min(1, k / 400, (per - k) / 400);
      const t = k / rate;
      const v = Math.sin(2 * Math.PI * f * t) * 0.6 + Math.sin(2 * Math.PI * f * 2 * t) * 0.2;
      out[i * per + k] = volume * env * v + noise * (rnd() * 2 - 1);
    }
  });
  return out;
}

function wav(samples: Float32Array, rate = 16000): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((x, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x * 32767))), i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const JINGLE_C5 = [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25, 523.25, 392.0, 440.0, 523.25, 587.33, 698.46];
const JINGLE_N5 = [329.63, 311.13, 293.66, 277.18, 261.63, 293.66, 329.63, 349.23, 392.0, 415.3, 369.99, 246.94];
const JINGLE_RATE = 8000; // 12 s of 8 kHz mono PCM keeps the files small; Chromaprint resamples anyway

// ---------------------------------------------------------------- CT stream replay (early-warning demo)
/** Synthetic CertStream messages (fictional CA, CT log and domains) for `bun run ct:watch -- --replay`. */
function ctStreamLines(): string[] {
  const t0 = Date.parse("2026-11-18T08:00:00Z") / 1000;
  const hex = (s: string) => createHash("sha256").update(s).digest("hex").toUpperCase();
  let i = 0;
  const cert = (domains: string[]) => {
    const t = t0 + 60 * ++i;
    const h = hex(domains.join(","));
    return {
      message_type: "certificate_update",
      data: {
        update_type: "PrecertLogEntry",
        cert_index: 900_000 + i,
        cert_link: `https://ct.example/log/ct/v1/get-entries?start=${900_000 + i}&end=${900_000 + i}`,
        seen: t + 0.5,
        source: { name: "Demo CT Log 2026 (fikcyjny)", url: "https://ct.example/log/" },
        leaf_cert: {
          all_domains: domains,
          not_before: t - 60,
          not_after: t + 90 * 86_400,
          serial_number: h.slice(0, 36),
          sha256: h.match(/../g)!.join(":"),
          issuer: { C: "PL", CN: "Demo CA R1", O: "Demo CA (fikcyjny)", aggregated: "/C=PL/CN=Demo CA R1/O=Demo CA (fikcyjny)" },
          subject: { CN: domains[0], aggregated: `/CN=${domains[0]}` },
        },
      },
    };
  };
  const dnsOnly = (domains: string[]) => {
    i++;
    return { message_type: "dns_entries", data: domains };
  };
  return [
    { message_type: "heartbeat", timestamp: t0 },
    cert(["shop-rowery.example", "www.shop-rowery.example"]),
    dnsOnly(["api.dev-portal.example"]),
    cert(["zwrot51-dolores33.invalid", "www.zwrot51-dolores33.invalid"]), // C4 name template, other TLD
    cert(["wiadomosci24.example"]), // a media word alone: not enough
    cert(["zwrot-podatku.example"]), // no template, single word: not enough
    dnsOnly(["zwrot64-quia17.example", "lp.zwrot64-quia17.example"]), // C4 name template, same TLD
    cert(["kryptozysk-ai24.test"]), // C1 brand from the lexicon + C1 domain word
    cert(["energia24.example"]), // a lure word alone
    cert(["lorem-ipsum.example"]), // Lorem words without the naming kit
    cert(["fakt-dnia-24.example", "www.fakt-dnia-24.example"]), // C3 media name + C3 word
    cert(["finance23-voluptas94.invalid"]), // C4 naming kit, other anchor and TLD: below threshold
    cert(["zwrot37-voluptas12.example"]), // already a campaign domain
    cert(["pomoc77-dolorem12.example"]), // C4 naming kit, other anchor, same TLD
    "to nie jest JSON",
    cert(["mail.firma-demo.test", "firma-demo.test"]),
    cert(["*.zwrot51-dolores33.invalid"]), // reported already
  ].map((m) => (typeof m === "string" ? m : JSON.stringify(m)));
}

// ---------------------------------------------------------------- fixtures
function crtshRows(certs: CertSpec[]): unknown[] {
  const rows: unknown[] = [];
  certs.forEach((c, i) => {
    const iss = ISSUERS[c.issuer];
    const nb = new Date(`${c.notBefore}Z`);
    const na = new Date(nb.getTime() + 90 * 86_400_000);
    const base = Number.parseInt(sha256(`id:${c.serial}`).toString("hex").slice(0, 7), 16);
    // crt.sh lists the precertificate and the leaf certificate separately (same serial).
    for (const [k, id] of [base + i * 10, base + i * 10 + 1].entries()) {
      rows.push({
        issuer_ca_id: iss.caId,
        issuer_name: iss.name,
        common_name: c.names[0],
        name_value: c.names.join("\n"),
        id: 15_000_000_000 + id,
        entry_timestamp: new Date(nb.getTime() + (k + 1) * 600_000).toISOString().replace("Z", ""),
        not_before: nb.toISOString().slice(0, 19),
        not_after: na.toISOString().slice(0, 19),
        serial_number: c.serial,
        result_count: c.names.length,
      });
    }
  });
  return rows;
}

function rdapJson(domain: string, d: DomainSpec): unknown {
  const created = new Date(d.created);
  const expires = new Date(created.getTime() + 365 * 86_400_000);
  const registrarEntity: Record<string, unknown> = {
    objectClassName: "entity",
    roles: ["registrar"],
    vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", d.registrar]]],
  };
  if (d.abuse) {
    registrarEntity.entities = [
      { objectClassName: "entity", roles: ["abuse"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Abuse Contact"], ["email", {}, "text", d.abuse]]] },
    ];
  }
  return {
    objectClassName: "domain",
    ldhName: domain.toUpperCase(),
    handle: `D${sha256(domain).toString("hex").slice(0, 10)}-DEMO`,
    status: ["client transfer prohibited"],
    events: [
      { eventAction: "registration", eventDate: created.toISOString().replace(".000", "") },
      { eventAction: "expiration", eventDate: expires.toISOString().replace(".000", "") },
      { eventAction: "last changed", eventDate: created.toISOString().replace(".000", "") },
    ],
    nameservers: d.ns.map((n) => ({ objectClassName: "nameserver", ldhName: n.toUpperCase() })),
    secureDNS: { delegationSigned: false },
    entities: [registrarEntity],
    links: [{ rel: "self", href: `https://rdap.registry.example/domain/${domain}`, type: "application/rdap+json" }],
    notices: [{ title: "SYNTETYCZNE DANE", description: ["Fikcyjny rekord RDAP dla danych przykładowych startera."] }],
  };
}

async function main() {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(IMG, { recursive: true });

  // ads.csv with non-standard column names
  const header = ["ad_id", "platforma", "reklamodawca", "tresc", "obraz", "link", "pierwsze_wyswietlenie", "ostatnie_wyswietlenie", "kampania_prawda", "osoba_drozd", "wynik_deepfake", "wideo"];
  const esc = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [header.join(",")];
  for (const a of ADS) {
    lines.push([a.id, a.platform, a.advertiser, a.text, `images/${a.image}`, a.url, a.first, a.last, a.label, a.persona ?? "", a.score ?? "", a.video ?? ""].map(esc).join(","));
  }
  writeFile("ads.csv", `${lines.join("\n")}\n`);
  writeFile(
    "mapping.json",
    json({
      id: "ad_id",
      platform: "platforma",
      advertiser: "reklamodawca",
      text: "tresc",
      imagePath: "obraz",
      landingUrl: "link",
      firstSeen: "pierwsze_wyswietlenie",
      lastSeen: "ostatnie_wyswietlenie",
      label: "kampania_prawda",
      persona: "osoba_drozd",
      deepfakeScore: "wynik_deepfake",
      videoPath: "wideo",
    }),
  );
  writeFile(
    "linking.json",
    json({
      lists: {
        domains: [{ match: "krotki.test", factor: 0, reason: "skracacz linków (fikcyjny — przykład wpisu w konfiguracji)" }],
        nameserverSuffixes: [{ match: "vps-demo.test", factor: 0.1, reason: "domyślne NS dostawcy VPS (fikcyjny — przykład wpisu w konfiguracji)" }],
        commentPatterns: [{ match: "syntetyczna strona testowa", factor: 0, reason: "znacznik generatora danych przykładowych" }],
      },
    }),
  );
  writeFile("ct-stream.jsonl", `${ctStreamLines().join("\n")}\n`);
  writeFile(
    "ct-lexicon.json",
    json({
      _comment: "Leksykon watchera CT dla danych przykładowych (fikcyjne marki i media). Listy rozszerzają domyślne z lib/ct/config.ts.",
      lexicon: { brands: ["KryptoZysk", "Bałtycka Energia"], media: ["fakt", "wiadomosci"] },
    }),
  );
  writeFile(
    "personas.json",
    json([
      { name: "Adam Testowy", role: "fikcyjny prezenter (dane syntetyczne)" },
      { name: "Ewa Przykładowa", role: "fikcyjna inwestorka (dane syntetyczne)" },
      { name: "Marek Fikcyjny", role: "fikcyjny biznesmen (dane syntetyczne)" },
      { name: "Zofia Wymyślona", role: "fikcyjna urzędniczka (dane syntetyczne)" },
      { name: "Kamil Demonstracyjny", role: "fikcyjny youtuber (dane syntetyczne)" },
    ]),
  );
  // synthetic jingles (music only, no speech): the same track in two C5 video ads, another in N5
  writeFile("media/c5_jingle_a.wav", wav(melody(JINGLE_C5, 1, 0.8, 0, 1, JINGLE_RATE), JINGLE_RATE));
  writeFile("media/c5_jingle_b.wav", wav(melody(JINGLE_C5, 1, 0.55, 0.01, 2, JINGLE_RATE), JINGLE_RATE));
  writeFile("media/n5_jingle.wav", wav(melody(JINGLE_N5, 1, 0.8, 0, 3, JINGLE_RATE), JINGLE_RATE));

  // images
  const hashes = new Map<string, string>();
  for (const im of IMAGES) {
    const buf = await render(im.layout, im.headline, im.variant);
    writeFile(`images/${im.file}`, buf);
    hashes.set(im.file, await dHash(buf));
  }
  for (const [file, color] of Object.entries(FAVICONS)) {
    writeFile(`fixtures/favicons/${file}`, await favicon(color, file[0].toUpperCase()));
  }

  // http.json: redirects + pages + favicons
  const http: Record<string, unknown> = {};
  const pageFiles = new Map<string, string>();
  for (const [url, s] of Object.entries(SITES)) {
    let file = pageFiles.get(s.html);
    if (!file) {
      file = `pages/${new URL(url).hostname}-${sha256(s.html).toString("hex").slice(0, 8)}.html`;
      pageFiles.set(s.html, file);
      writeFile(`fixtures/${file}`, s.html);
    }
    http[url] = { status: 200, headers: { "content-type": "text/html; charset=utf-8", server: "nginx" }, bodyFile: file };
    http[u(s.faviconUrl)] = { status: 200, headers: { "content-type": "image/png" }, bodyFile: `favicons/${s.favicon}` };
  }
  http[u("https://kz-ai-start.test/")] = { status: 302, headers: { location: "https://kryptozysk-ai.example/start?src=kz" } };
  writeFile("fixtures/pages/benign-recipe.html", C3_BENIGN);
  for (const [from, to] of Object.entries(C3_REDIRECTS)) {
    http[from] = {
      status: 302,
      headers: { location: to },
      // Cloaking: an ad-platform crawler gets a harmless page instead of the redirect (two-UA check, opt-in)
      variants: [{ uaContains: "facebookexternalhit", status: 200, headers: { "content-type": "text/html; charset=utf-8" }, bodyFile: "pages/benign-recipe.html" }],
    };
  }
  for (const code of C5_CODES) http[u(`https://krotki.test/${code}`)] = { status: 301, headers: { location: C5_FINAL(code) } };
  http[u("https://krotki.test/n2Kurs")] = { status: 301, headers: { location: "https://kurs-jezykowy.test/?ref=krotki" } };
  // Sanity: every ad's normalised landing URL must be answered by the fixtures
  for (const a of ADS) {
    const key = a.url ? normalizeUrl(a.url)?.url : null;
    if (key && !http[key]) throw new Error(`fixture missing for ${a.id}: ${key}`);
  }
  writeFile("fixtures/http.json", json(Object.fromEntries(Object.entries(http).sort(([x], [y]) => x.localeCompare(y)))));

  // dns.json
  const dns: Record<string, Record<string, string[]>> = {};
  for (const [host, ips] of Object.entries(HOST_IPS)) {
    dns[host] = { ...(dns[host] ?? {}), A: ips, AAAA: [], CNAME: CNAMES[host] ? [CNAMES[host]] : [] };
  }
  for (const [domain, d] of Object.entries(DOMAINS)) {
    dns[domain] = { ...(dns[domain] ?? {}), NS: d.ns, MX: d.mx ?? [], TXT: ["v=spf1 -all"] };
  }
  writeFile("fixtures/dns.json", json(Object.fromEntries(Object.entries(dns).sort(([x], [y]) => x.localeCompare(y)))));

  // rdap/*.json and crtsh/*.json
  for (const [domain, d] of Object.entries(DOMAINS)) {
    writeFile(`fixtures/rdap/${domain}.json`, json(rdapJson(domain, d)));
    writeFile(`fixtures/crtsh/${domain}.json`, json(crtshRows(d.certs)));
  }

  // cymru.json
  const cymru: Record<string, string[]> = {};
  for (const [ip, a] of Object.entries(ASN_OF)) {
    cymru[cymruOriginQuery(ip)!] = [`${a.asn} | ${a.prefix} | ${a.cc} | ${a.registry} | ${a.allocated}`];
    cymru[cymruAsNameQuery(a.asn)] = [AS_NAMES[a.asn]];
  }
  writeFile("fixtures/cymru.json", json(Object.fromEntries(Object.entries(cymru).sort(([x], [y]) => x.localeCompare(y)))));

  // Report image hash separation (within family vs across campaigns)
  const family = (f: string) => f.replace(/(_v\d|_bright|_crop|_jpeg|_badge)?\.(png|jpg)$/, "");
  let maxWithin = 0;
  let minAcross = 64;
  let minAcrossPair = "";
  const files = [...hashes.keys()];
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const d = hammingDistance(hashes.get(files[i])!, hashes.get(files[j])!);
      if (family(files[i]) === family(files[j])) maxWithin = Math.max(maxWithin, d);
      else if (d < minAcross) {
        minAcross = d;
        minAcrossPair = `${files[i]} ~ ${files[j]}`;
      }
    }
  }
  writeFile("demo/zrzut-martwa-strona.png", await deadPageScreenshot());
  console.log(`[sample] ${ADS.length} reklam, ${IMAGES.length} obrazów, ${Object.keys(DOMAINS).length} domen, ${Object.keys(http).length} odpowiedzi HTTP w fixtures`);
  console.log(`[sample] dHash: max odległość w rodzinie kreacji = ${maxWithin}, min odległość między różnymi kreacjami = ${minAcross} (${minAcrossPair})`);
  console.log(`[sample] portfele: TRON ${W.tronC1}, ETH ${W.ethC5}, BTC ${W.btcC5}, BTC ${W.btcN5}`);
  // DOM simhash separation of landing-page templates (same campaign vs different campaigns)
  const campaignOf = (f: Family) => (f === "C3b" ? "C3" : f);
  const doms: Array<{ family: Family; hash: string }> = [];
  for (const site of new Map(Object.values(SITES).map((x) => [x.html, x])).values()) {
    const h = domSimhash(site.html).simhash;
    if (h) doms.push({ family: site.family, hash: h });
  }
  let domWithin = 0;
  let domAcross = 64;
  let domAcrossPair = "";
  for (let i = 0; i < doms.length; i++) {
    for (let j = i + 1; j < doms.length; j++) {
      const d = simhashDistance(doms[i].hash, doms[j].hash);
      if (campaignOf(doms[i].family) === campaignOf(doms[j].family)) domWithin = Math.max(domWithin, d);
      else if (d < domAcross) {
        domAcross = d;
        domAcrossPair = `${doms[i].family} ~ ${doms[j].family}`;
      }
    }
  }
  console.log(`[sample] simhash DOM: ${doms.length} szablonów, max odległość w kampanii = ${domWithin}, min między kampaniami = ${domAcross} (${domAcrossPair})`);
}

void main();

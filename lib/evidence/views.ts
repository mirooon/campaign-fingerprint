/**
 * Views of one campaign record for the institutions that act on it: the data-preservation request
 * to providers (E), the notice to the financial supervisor (K) and the notice to the prosecutor (P).
 * All three are drafted from the same facts as evidence.json (lib/evidence/facts.ts), so they cannot
 * disagree with it; a human checks and files them, the tool sends nothing. Pure functions.
 */
import type { CampaignFacts, FactDomain } from "./facts";
import { formatRange, formatUtc } from "./format";

const SIGNATURE = "Szkic przygotowany automatycznie z paczki dowodów; do weryfikacji i podpisu przez człowieka.";

/** Domains that name an operator: shared infrastructure (CDN, large host) is left out because its provider holds data about thousands of unrelated sites. */
const operatorDomains = (f: CampaignFacts): FactDomain[] => f.domains.filter((d) => !d.shared_infrastructure);

/** Platforms of the ads of a campaign with the time range of the ads on each, in the order they first appear. */
function platformRanges(f: CampaignFacts): Array<{ platform: string; from: string | null; to: string | null; ids: string[] }> {
  const by = new Map<string, { platform: string; from: string | null; to: string | null; ids: string[] }>();
  for (const a of f.ads) {
    const key = (a.platform ?? "nieznana platforma").toLowerCase();
    const cur = by.get(key) ?? { platform: a.platform ?? "nieznana platforma", from: null, to: null, ids: [] };
    const first = a.first_seen_utc;
    const last = a.last_seen_utc ?? a.first_seen_utc;
    if (first && (!cur.from || first < cur.from)) cur.from = first;
    if (last && (!cur.to || last > cur.to)) cur.to = last;
    cur.ids.push(a.ad_ids.ad_library_id ?? a.ad_ids.ad_id ?? a.item_id);
    by.set(key, cur);
  }
  return [...by.values()];
}

/** Sentence on the CERT Warning List status of a domain, for documents addressed to people. */
function certSentence(d: FactDomain): string {
  if (d.cert_status === "active") return `na Liście Ostrzeżeń CERT od ${formatUtc(d.cert_insert_date)}`;
  if (d.cert_status === "removed") return "był na Liście Ostrzeżeń CERT (wpis wygasł)";
  if (d.cert_status === "absent") return "nie ma jej na Liście Ostrzeżeń CERT (wg lokalnej kopii)";
  return "status na Liście Ostrzeżeń CERT niesprawdzony";
}

/**
 * Request to preserve data (art. 218a k.p.k. / e-evidence style) addressed to the providers: per
 * platform the ads and the time range to preserve, per domain the registrar and hosting with the
 * contact, and the categories of data to keep. The ranges are the times the ads and pages were
 * observed, in UTC; the provider decides what it holds.
 */
export function renderPreservationRequest(f: CampaignFacts): string {
  const platforms = platformRanges(f);
  const domains = operatorDomains(f);
  return `# Wniosek o zabezpieczenie danych — kampania ${f.campaignId}

Paczka \`${f.packageId}\`, ${formatUtc(f.createdUtc)}. ${SIGNATURE}

Prośba o zachowanie danych (bez ich ujawniania do czasu decyzji uprawnionego organu) dotyczących reklam i domen opisanych w paczce.

## Platformy reklamowe

${platforms.map((p) => `- **${p.platform}**: reklamy ${p.ids.join(", ")}; okres do zabezpieczenia ${formatRange(p.from, p.to)} (UTC); kategorie danych: dane konta reklamodawcy i jego zmiany, dane płatnika i metody płatności, historia emisji i edycji reklam, dane o zasięgu, logowania i adresy IP administratorów konta, wcześniejsze zgłoszenia i decyzje moderacji.`).join("\n") || "- brak reklam"}

## Domeny: rejestratorzy i hosting

${domains
  .map(
    (d) =>
      `- **${d.domain}** (zarejestrowana ${formatUtc(d.created_utc)}; reklam w kampanii: ${d.ads})\n  - rejestrator: ${d.registrar ?? "nieustalony"}${d.registrar_iana_id ? ` (IANA ${d.registrar_iana_id})` : ""}, kontakt abuse: ${d.abuse_email ?? "brak w RDAP"}; kategorie danych: dane rejestranta i kontaktowe, historia zmian, płatności za domenę i usługi, logi panelu\n  - hosting: ${d.ips.map((i) => `${i.ip}${i.asn ? ` (AS${i.asn}${i.as_name ? `, ${i.as_name}` : ""})` : ""}`).join(", ") || "brak danych"}; kategorie danych: dane abonenta, logi dostępu i panelu, kopie zawartości, płatności; okres ${formatRange(f.firstSeenUtc, f.lastSeenUtc)} (UTC)`,
  )
  .join("\n") || "- brak domen"}

Domeny na wspólnej infrastrukturze (CDN i duzi dostawcy) pominięto: ich dostawca obsługuje tysiące niezależnych stron i nie wskazuje operatora kampanii.

## Zakres czasu

Pierwsza obserwacja ${formatUtc(f.firstSeenUtc)}, ostatnia ${formatUtc(f.lastSeenUtc)} (UTC). Dane są potrzebne za okres od pierwszej obserwacji do dnia wniosku.
`;
}

/**
 * Notice to the financial supervisor (KNF): the brands and persons used, the domains with the date of
 * registration, the offer, payment identifiers and the scale. Null when the ads hold no financial
 * offer, because the supervisor has no remit over other frauds.
 */
export function renderKnfNotice(f: CampaignFacts): string | null {
  if (!f.financialOffer) return null;
  const domains = operatorDomains(f);
  const payments = [...new Set(domains.flatMap((d) => d.payment_identifiers))];
  return `# Informacja dla KNF — kampania ${f.campaignId}

Paczka \`${f.packageId}\`, ${formatUtc(f.createdUtc)}. ${SIGNATURE}

W okresie ${formatRange(f.firstSeenUtc, f.lastSeenUtc)} (UTC) zarejestrowano ${f.ads.length} reklam z ofertą usług finansowych (inwestycje, kryptowaluty lub podobne), kierujących do ${domains.length} domen.

## Wykorzystane marki i osoby

${f.personas.map((p) => `- ${p} (wizerunek w reklamach)`).join("\n") || "- brak wskazanych osób"}

## Domeny oferty

${domains.map((d) => `- ${d.domain}: zarejestrowana ${formatUtc(d.created_utc)}, reklam ${d.ads}; ${certSentence(d)}`).join("\n") || "- brak"}

## Płatności

${payments.map((p) => `- ${p}`).join("\n") || "- w paczce nie ma identyfikatorów płatności"}

## Skala

${f.ads.length} reklam na platformach: ${[...new Set(f.ads.map((a) => a.platform ?? "nieznana"))].join(", ")}. Dane o zasięgu pochodzą z bibliotek reklam, jeśli zostały pobrane (evidence.json).

Prośba o rozważenie wpisu na listę ostrzeżeń publicznych i ustalenie, czy podmiot ma zezwolenie na oferowane usługi.
`;
}

/**
 * Notice to the prosecutor: the grounds of the campaign (fraud always; impersonation only when a
 * person is named), the dates, the CERT status, and who may file (the person whose image was used
 * has the standing to press charges for impersonation). The legal qualification is a proposal.
 */
export function renderProsecutorNotice(f: CampaignFacts): string {
  const domains = operatorDomains(f);
  return `# Zawiadomienie o możliwości popełnienia przestępstwa — kampania ${f.campaignId}

Paczka \`${f.packageId}\`, ${formatUtc(f.createdUtc)}. ${SIGNATURE}

## Przesłanki

- art. 286 k.k. (oszustwo): ${f.ads.length} reklam w okresie ${formatRange(f.firstSeenUtc, f.lastSeenUtc)} (UTC) kieruje do ${domains.length} domen z ofertą, którą narzędzie wiąże w jedną kampanię wspólnymi śladami (evidence.json, \`observations.shared_identifiers\`).
${f.personas.length ? `- art. 190a § 2 k.k. (podszywanie się): w reklamach użyto wizerunku lub nazwiska: ${f.personas.join(", ")}.\n` : ""}${f.deepfake ? "- materiał może być syntetyczny (wynik modelu: wskazówka, nie dowód).\n" : ""}
Kwalifikacja prawna jest propozycją do weryfikacji.

## Domeny

${domains.map((d) => `- ${d.domain}: zarejestrowana ${formatUtc(d.created_utc)}; ${certSentence(d)}`).join("\n") || "- brak"}

## Kto może złożyć zawiadomienie

${f.personas.length ? "Zawiadomienie może złożyć każdy; w sprawie podszywania się wniosek o ściganie składa osoba pokrzywdzona (osoba, której wizerunek użyto) lub jej pełnomocnik: to ona potwierdza brak zgody." : "Zawiadomienie może złożyć każdy; pokrzywdzonych (osoby, które wpłaciły środki) paczka nie wskazuje."}

## Załączniki

Pełna paczka: evidence.json, manifest.sha256, kopie plików sprawy z sumami SHA-256.
`;
}

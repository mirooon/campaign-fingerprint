# Dokumentacja techniczna startera

Opisuje to, co kod robi **teraz**. Numery linii (`plik:linia`) dotyczą kodu z commitu `e132a5d` (19.11.2026). Commit z tym dokumentem zmienia tylko `docs/TECHNICAL.md` i `README.md`. Jeśli edytujesz pliki, numery się przesuną: szukaj wtedy po nazwie funkcji.

## Spis treści

1. [Cel i zakres](#1-cel-i-zakres)
2. [Przepływ danych](#2-przepływ-danych)
3. [Moduły](#3-moduły)
4. [Model grafu](#4-model-grafu)
5. [Klastrowanie](#5-klastrowanie)
6. [Ewaluacja](#6-ewaluacja)
7. [LLM](#7-llm)
8. [API](#8-api)
9. [CLI](#9-cli)
10. [Konfiguracja](#10-konfiguracja)
11. [Bezpieczeństwo](#11-bezpieczeństwo)
12. [Testy](#12-testy)
13. [Jak dostosować w sobotę do danych NASK](#13-jak-dostosować-w-sobotę-do-danych-nask)
14. [Znane ograniczenia](#14-znane-ograniczenia)
15. [Paczka dowodów](#15-paczka-dowodów)
16. [Watcher Certificate Transparency (wczesne ostrzeganie)](#16-watcher-certificate-transparency-wczesne-ostrzeganie)

---

## 1. Cel i zakres

Starter zamienia listę reklam (CSV/JSON, jeden wiersz = jedna reklama) w graf dowodów i podział na kampanie. Dla każdej reklamy zbiera ślady: link docelowy z łańcuchem przekierowań, hosty z łańcuchem CNAME, domeny, IP/ASN, NS, RDAP, certyfikaty z CT, trackery, favicon, kontakty, portfele, hash obrazu i treść. Ze strony docelowej bierze też odcisk „kitu”: backend formularza, zestaw ukrytych pól, własne pliki JS/CSS, komentarze w kodzie i simhash struktury DOM. Dochodzą wzorce nazw domen, parametry kampanii z URL-i (UTM, sub1–5, identyfikatory kliknięć, ofert i reklam) oraz persona, czyli osoba, pod którą podszywa się reklama, rozpoznana z tekstu (bez biometrii, słaby sygnał). Opcjonalnie, domyślnie wyłączone: OCR kreacji, transkrypcja (ASR) i odcisk audio wideo oraz test cloakingu dwoma zwykłymi pobraniami.

Pary reklam dostają wagę z ważenia wspólnych encji i podobieństwa obrazu, tekstu, struktury strony i dźwięku. Union-find łączy silne dowody, a Louvain grupuje resztę. Wyniki przegląda się w przeglądarce Next.js (z porównaniem dwóch reklam), mierzy na etykietach (pairwise/B-cubed F1, ARI), eksportuje jako paczkę dowodów kampanii (§15), a watcher CT dopasowuje nowe domeny z certyfikatów TLS do kampanii, zanim ruszy reklama (§16). W kodzie nie ma logiki pod konkretne zadanie. Jedyne założenie o danych to mapowanie kolumn na pola `Item`.

## 2. Przepływ danych

```
 dane.csv|.tsv|.json|.jsonl
        │  ingest  (lib/pipeline/ingest.ts, scripts/ingest.ts)
        ▼
 data/work/items.json ............ ItemsFile
        │  enrich  (lib/pipeline/enrich.ts, źródła: lib/pipeline/sources.ts)
        │    live:    1×GET na stronę/przekierowanie, DNS z łańcuchem CNAME, RDAP, crt.sh, Team Cymru (cache .cache/)
        │    offline: data/sample/fixtures (nagrane surowe odpowiedzi)
        │    opcjonalnie: lista person, NER (LLM), test cloakingu (2 dodatkowe GET-y), OCR, ASR, odcisk audio
        │    archiwum zdekodowanego HTML: data/work/archive/<sha256 surowej odpowiedzi>.html
        ▼
 data/work/enriched.json ......... EnrichedDataset
        │  build-graph  (lib/graph/link.ts → lib/graph/cluster.ts → lib/graph/prune.ts)
        │    [opcjonalnie embeddingi bge-m3 przez Ollamę, cache .cache/embed]
        ▼
 data/graph.json ................. EvidenceGraph (kompaktowy JSON, top-12 powiązań na reklamę)
 data/campaigns.json ............. CampaignsFile
        │
        ├── evaluate     (lib/graph/eval.ts)              → metryki na stdout
        ├── summarize    (scripts/summarize.ts, LLM)       → data/summaries.json
        ├── evidence     (lib/evidence/pack.ts)            → data/evidence/<kampania>/ (§15)
        ├── ct:watch, ct:backfill (lib/ct/*)               → data/ct-watch.jsonl (§16)
        ├── viewer       (app/page.tsx, components/viewer/*) czyta graph/campaigns/summaries; feed CT przez /api/ct-feed
        └── /api/analyze (lib/pipeline/analyze.ts)        dopasowuje nową reklamę do graph.json
```

Domyślne ścieżki są w `lib/pipeline/steps.ts:22-37` (także lista person, archiwum, katalog paczek dowodów, feed, leksykon i plik demo watchera CT). `.cache/`, `data/work/`, `data/evidence/` i `data/ct-watch.jsonl` są w `.gitignore` (`.gitignore:47-52`). `data/graph.json`, `data/campaigns.json` i `data/summaries.json` są commitowane, żeby przeglądarka budowała się bez uruchamiania pipeline'u.

### 2.1 `items.json` — `ItemsFile` (`lib/pipeline/types.ts:43`)

| Pole | Typ | Uwagi |
|---|---|---|
| `version` | `1` | |
| `generatedAt` | ISO | |
| `source` | string | ścieżka wejścia |
| `baseDir` | string | katalog, względem którego rozwiązywane są `imagePath` i `videoPath` (domyślnie katalog pliku wejściowego, `steps.ts:68`) |
| `items` | `Item[]` | niżej |
| `warnings` | string[] | brakujące kolumny, duplikaty id, nieparsowalne daty i wyniki deepfake, puste wiersze |

`Item` (`types.ts:19`): `id`, `platform`, `advertiser`, `text`, `imageUrl` (tylko http(s)), `imagePath`, `landingUrl`, `firstSeen`, `lastSeen` (ISO 8601 UTC), `label` (prawda do ewaluacji), `persona` (osoba z danych wejściowych, np. z DROZD; kilka rozdzielonych `;` lub `|`, `types.ts:34`), `deepfakeScore` (0..1, wynik modelu z danych wejściowych, nie fakt, `:36`), `videoPath` (plik wideo/audio dla opcjonalnego ASR i odcisku audio, `:38`), `extra` (niezmapowane kolumny, wartości ucięte do 500 znaków, `ingest.ts:246`). Pola tekstowe poza `id` i `extra` są `string | null`.

### 2.2 `enriched.json` — `EnrichedDataset` (`types.ts:134`)

| Pole | Typ | Klucz |
|---|---|---|
| `version`, `generatedAt`, `mode` (`live`/`offline`), `baseDir` | | |
| `items` | `Item[]` | kopia wejścia |
| `perItem` | `Record<itemId, ItemEnrichment>` | id reklamy |
| `pages` | `Record<url, PageInfo>` | znormalizowany URL docelowy |
| `hosts` | `Record<host, HostInfo>` | host ASCII (punycode) |
| `domains` | `Record<domena, DomainInfo>` | domena rejestrowalna (eTLD+1) |
| `ips` | `Record<ip, AsnInfo \| null>` | IP kanoniczny (IPv6 w pełnej postaci) |

- `ItemEnrichment` (`types.ts:113`): `itemId`, `landing: NormalizedUrl|null`, `pageKey` (klucz do `pages`), `text: TextExtract|null` (kontakty/portfele/URL-e z treści reklamy, OCR i ASR), `image: ImageInfo|null`, `personas: PersonaMatch[]` (`:122`), `campaignParams: CampaignParam[]` (`:124`), `ocrText` (`:126`), `asrText` (`:128`), `audioFp: AudioFingerprint|null` (`:130`), `errors: string[]`.
- `PageInfo` (`types.ts:78`): `requestedUrl`, `fetch` (= `FetchPageResult` bez `body`), `extract: PageExtract|null`, `favicon: {url, hashes: FaviconHashes|null, error}|null`, `kit: PageKit|null` (`:84`), `archiveFile` (ścieżka zdekodowanego HTML w archiwum, `:86`), `cloaking: CloakingCheck|null` (`:88`).
- `CloakingCheck` (`types.ts:100`): `crawler` i `mobile` (`CloakingVariant`, `:91`: `userAgent`, `finalUrl`, `status`, `domSimhash`, `bodySha256`, `error`), `finalUrlDiffers`, `domDistance`, `suspected`, `reasons[]`.
- `HostInfo` (`types.ts:53`): `host`, `registrableDomain`, `dns: DnsRecords|null`, `ips: string[]`, `cnameChain: string[]` (cele CNAME po kolei, maks. 4 skoki, `:60`).
- `DomainInfo` (`types.ts:63`): `domain`, `ns[]`, `mx[]`, `txt[]`, `rdap: RdapInfo|null`, `ct: CtResult|null`.
- `NormalizedUrl` (`lib/osint/urls.ts:16`): `input`, `url`, `scheme`, `host`, `hostUnicode`, `port`, `path`, `query`, `registrableDomain`, `publicSuffix`, `subdomain`, `isIp`, `isIdn`, `removedParams`.
- `FetchPageResult` (`lib/osint/fetchPage.ts:41`): `requestedUrl`, `finalUrl`, `status`, `ok`, `redirectChain[{url,status,location,kind:"http"|"meta-refresh"}]`, `contentType`, `headers` (tylko wybrane, `fetchPage.ts:119`), `bytes`, `truncated`, `body`, `bodySha256` (SHA-256 surowych bajtów odpowiedzi po dekompresji, `:54`), `userAgent` (`:56`), `remoteAddress`, `error`, `errorCode` (`invalid-url|blocked|timeout|too-many-redirects|network|tls`), `fetchedAt`, `durationMs`.
- `PageExtract` (`lib/osint/extract.ts:33`): `title`, `description`, `canonical`, `ogTitle`, `ogDescription`, `ogImage`, `ogSiteName`, `trackers[{kind,id}]`, `faviconUrl`, `outboundDomains[]`, `outboundUrls[]`, `emails[]`, `phones[]`, `telegram[]`, `whatsapp[]`, `wallets[{kind,address}]`, `metaRefresh`, `jsRedirects[]`, `visibleText` (≤ 5000 znaków), `generator`.
- `PageKit` (`lib/osint/pagekit.ts:50`): `endpoints: EndpointRef[]` (`pagekit.ts:21`: `key`, `host`, `pathTemplate`, `sameOrigin`, `method`, `via` = `form|fetch|xhr|axios|jquery|literal`, `raw`), `domSimhash`, `tagCount`, `hiddenFields[]`, `assets: AssetRef[]` (`:36`), `comments[]`, `cyrillicComments`.
- `TextExtract` (`extract.ts:56`): `urls`, `emails`, `phones`, `telegram`, `whatsapp`, `wallets`.
- `CampaignParam` (`lib/osint/campaignParams.ts:34`): `name` (jak w URL), `canonicalName`, `value` (≤ 120 znaków), `sourceUrl`, `cyrillic`, `macro`.
- `PersonaMatch` (`lib/text/persona.ts:29`): `id` (slug), `name`, `matched`, `source` (`watchlist|ingest|ner`), `role`, `fuzzy?`, `distance?`.
- `AudioFingerprint` (`lib/media/audioFp.ts:11`): `duration`, `fingerprint` (surowe liczby Chromaprint).
- `DnsRecords` (`lib/osint/dns.ts:17`): `name`, `a`, `aaaa`, `cname`, `ns`, `mx`, `txt`, `errors`.
- `RdapInfo` (`lib/osint/rdap.ts:10`): `domain`, `registrar`, `registrarIanaId`, `created`, `expires`, `updated`, `status[]`, `nameservers[]`, `abuseEmail`, `source`.
- `CtResult` / `CertInfo` (`lib/osint/ct.ts:27`, `:12`): `{domain, certs, truncated}`; cert: `id`, `serial`, `issuer` (wartość O= lub CN=), `issuerName`, `commonName`, `sanDomains[]`, `notBefore`, `notAfter`, `entryTimestamp`.
- `AsnInfo` (`lib/osint/asn.ts:11`): `ip`, `asn`, `asns[]`, `prefix`, `country`, `registry`, `allocated`, `asName`.
- `ImageInfo` = `ImageHashes` (`lib/media/imageHash.ts:15`: `dhash`, `ahash` — 16 hex = 64 bity, `width`, `height`, `format`) + `source`.
- `FaviconHashes` (`imageHash.ts:25`): `mmh3` (hash zgodny z Shodan `http.favicon.hash`), `sha256`, `dhash|null`, `ahash|null`, `format`.

### 2.3 `graph.json` — `EvidenceGraph` (`lib/graph/model.ts:173`)

| Pole | Opis |
|---|---|
| `version`, `generatedAt`, `mode`, `baseDir` | `baseDir` służy `/api/image` do rozwiązywania obrazów |
| `textMethod` | `tfidf` / `embedding` / `none` |
| `stats` | `items`, `nodes`, `edges`, `links`, `strongLinks`, `byType` (`model.ts:164`); po przycięciu wartości `edges`/`links` dotyczą zapisanego pliku |
| `nodes: GraphNode[]` | `id` (`<typ>:<klucz>`), `type`, `key`, `label`, `df`, `weight`, `strong`, `discounts[{reason,factor,rule}]`, `data` (szczegóły zależne od typu, w tym `weightParts {base, listFactor, idf, ubiquity}`), `campaignId` (tylko reklamy) — `model.ts:111` |
| `edges: GraphEdge[]` | `id`, `source`, `target`, `type`, `weight` (1 dla krawędzi strukturalnych, waga podobieństwa dla `similar_*`), `evidence` (tekst PL) — `model.ts:129` |
| `links: ItemLink[]` | `a`, `b`, `score` (noisy-OR), `strong`, `evidence: PairEvidence[]` — `model.ts:155` |

`PairEvidence` (`model.ts:139`): `kind` (`pivot`/`similarity`), `pivot` (id węzła), `pivotType`, `edgeType` (`similar_image`/`similar_text`/`similar_dom`/`similar_audio`, lista w `model.ts:97`), `weight`, `strong`, `discounted`, `evidence`, `pathA`, `pathB` (ścieżki id węzłów od reklamy do encji).

Dane węzła reklamy (`lib/graph/link.ts:135-150`) zawierają oprócz pól `Item` także `deepfakeScore`, `personas` (imiona i nazwiska), `ocrText` i `asrText` (≤ 600 znaków), a po przetworzeniu strony `domSimhash`, `cyrillic`, `cloakingSuspected`, `cloakingReasons` i `finalUrl` (`link.ts:446-453`, `:470`).

### 2.4 `campaigns.json` — `CampaignsFile` (`model.ts:224`)

- `method`: `unionFind` (opis progu), `louvain {resolution, seed, modularity}`, `minLinkScore`.
- `campaigns: Campaign[]` (`model.ts:196`): `id` (`K01`…), `size`, `members[]`, `firstSeen`, `lastSeen`, `topEvidence[{key,type,label,count,weight}]` (≤ 6), `domains[]`, `advertisers[]`, `cohesion`, `strongComponents`, `attributes`.
- `attributes` (`CampaignAttributes`, `model.ts:213`): `personas[{id,name,count}]`, `cyrillic` (reklamy z cyrylicą w komentarzach strony lub parametrach kampanii), `cloakingSuspected` (reklamy z podejrzeniem cloakingu), `deepfakeScoreMax` (najwyższy wynik deepfake z danych wejściowych). To atrybuty do filtrowania i priorytetów, nie dowody łączące.
- `assignments: Record<itemId, campaignId>` — wszystkie reklamy, również pojedyncze (kampania 1-elementowa).

`data/summaries.json` (`scripts/summarize.ts:75`): `{generatedAt, provider, model, summaries: Record<campaignId, CampaignSummary>}`; schemat w `lib/pipeline/summary.ts:7`: `persona`, `narrative`, `infrastructure`, `timeSpan`, `riskNotes` oraz `campaignId`, `model`, `generatedAt`.

---

## 3. Moduły

### 3.1 `lib/osint/*`

| Moduł | Co robi | Wejście → wyjście | Decyzje i limity |
|---|---|---|---|
| `ip.ts` | parsowanie IPv4/IPv6, CIDR, klasyfikacja publiczne/niepubliczne | string → `{public, reason}` | zakresy niepubliczne `ip.ts:179` (v4) i `:197` (v6); IPv4 osadzone w IPv6 (mapped, NAT64, 6to4) sprawdzane rekurencyjnie (`ip.ts:234`); IPv4 z wiodącymi zerami odrzucane (`ip.ts:22`) |
| `urls.ts` | normalizacja URL, refang, IDN, eTLD+1 | string → `NormalizedUrl \| null` | domyślny schemat `https` (`urls.ts:158`); usuwa parametry kliknięć (`utm_*`, `fbclid`, `gclid`…, lista `urls.ts:44`), sortuje pozostałe (`:191`); `tldts` z `allowPrivateDomains: true` (`:204`), więc `x.github.io`, `x.pages.dev` to osobne domeny; brak obsługi schematów innych niż http(s). Parametry kampanii są czytane z surowych URL-i przed normalizacją (`campaignParams.ts`) |
| `fetchPage.ts` | jeden GET na skok, ręczne przekierowania, ochrona SSRF | URL (+ opcjonalny `userAgent`) → `FetchPageResult` (nigdy nie rzuca dla błędów sieci) | budżet czasu 8 s na cały łańcuch (`fetchPage.ts:347`), limit 2 MiB **po dekompresji** (`:348`, `:248`), maks. 8 przekierowań i wykrywanie pętli (`:349`, `:441`), meta refresh śledzony przy opóźnieniu ≤ 10 s (`:433`), gzip/deflate/br (`:240-242`), wykrywanie kodowania znaków: nagłówek → BOM → `<meta charset>` w pierwszych 4 KB (`:283`), UA przeglądarki (`:23`) albo podany (`:355`), `accept-language` pl (`:357`); SHA-256 surowej odpowiedzi do dowodów (`:455`); `fetchBinary` bez meta refresh, limit 5 MiB (`:476`); szczegóły SSRF w §11 |
| `extract.ts` | ekstrakcja z HTML i tekstu, bez parsera HTML (tokenizer regex) | HTML + baseUrl → `PageExtract`; tekst → `TextExtract` | trackery `extract.ts:295-345` (GA4 w kontekście 4–15 znaków albo goły `G-` + 10 znaków z cyfrą i literą, UA, GTM 4–9, AW 9–11 cyfr, piksel Meta 10–20 cyfr, TikTok 15–25, Yandex 5–10 cyfr); e-maile bez TLD plikowych (`:350`); telefony PL: z `+48/0048`, bez prefiksu tylko w formacie 3-3-3 lub stacjonarnym z poprawnym prefiksem (`:372-387`, regexy `:426-430`), odrzuca końcówki `000000` i liczby przed walutą (`:381`, `:423`); inne kraje tylko z `tel:`; Telegram, WhatsApp (`:475-530`); `visibleText` ≤ 5000 (`:65`), `outboundUrls` ≤ 300 (`:66`); `jsRedirects` wyciągane statycznie (`:608`), **niewykorzystywane w grafie** |
| `pagekit.ts` | odcisk kitu strony, statycznie (JS nie jest wykonywany) | HTML + URL strony → `PageKit` (`pagekit.ts:683`) | backendy: `<form action>` (z `<base href>`), `fetch`, `XMLHttpRequest.open`, axios, `$.ajax/$.post/$.get` i literały wyglądające na API (`/api/`, `submit`, `lead`, `register`, `postback`…, `pagekit.ts:375`) w skryptach inline; ścieżka normalizowana (`normalizeEndpointPath`, `:401`): UUID → `<uuid>`, liczby → `<n>`, ≥ 16 hex → `<hex>`, ≥ 16 znaków litery+cyfry → `<id>`; klucz `host+ścieżka` albo `*ścieżka` dla tej samej domeny (`:436-438`); simhash DOM: nazwy tagów otwierających w kolejności, shingle po 4, md5, 64 bity, `null` poniżej 25 tagów (`:583-628`); komentarze HTML i JS normalizowane (`normalizeComment`, `:643`: ≥ 12 znaków, z literą, bez komentarzy warunkowych); flaga cyrylicy (`:82`); limity: 50 backendów, 100 plików, 100 ukrytych pól, 50 komentarzy (`:66-69`) |
| `domainPattern.ts` | szablon nazwy domeny | domena → `DomainTemplate \| null` (`domainPattern.ts:70`) | etykieta dzielona na litery, cyfry i separatory; cyfry → `<n>`, słowa Lorem Ipsum ≥ 4 znaki (ok. 330 słów, `domainPattern.ts:43`) → `<lorem>`; dwa warianty: z TLD (`finance<n>-<lorem><n>.sbs`) i bez (`finance<n>-<lorem><n>.*`); `null` bez placeholdera, dla IP i etykiet punycode |
| `campaignParams.ts` | parametry kampanii z URL-i | lista URL-i → `CampaignParam[]` (`campaignParams.ts:142`) | nazwy kanoniczne: `utm_*`, `sub1`–`sub5`, `aff_id`, `click_id`, `offer_id`, `campaign_id/name`, `adset_id/name`, `ad_id/name`, `pixel_id` z aliasami (`subid`, `aff_sub3`, `ClickID`, `cmp`, `crid`, `fb_pixel`…, `campaignParams.ts:50`); czyta też fragment `#…` (`:127`); flagi cyrylicy (`:113`) i nierozwiniętych makr `{{…}}` (`:114`); deduplikacja po nazwie i wartości bez rozróżniania wielkości liter; wartość ≤ 120 znaków (`:48`) |
| `crypto.ts` | portfele z walidacją sum kontrolnych | tekst → `WalletMatch[]` | BTC Base58Check (wersja 0x00/0x05), bech32/bech32m (BIP-173/350), ETH (EIP-55 dla mieszanej wielkości liter, keccak z `@noble/hashes`), TRON (Base58Check, 0x41); regexy z granicami `crypto.ts:213-217`; adresy-zaślepki ETH odrzucane (`:220`) |
| `dns.ts` | A/AAAA/CNAME/NS/MX/TXT przez `node:dns/promises` | nazwa → `DnsRecords` | limit 5000 ms na zapytanie (`dns.ts:50`), `tries: 1` (`:74`), ENODATA/NXDOMAIN → pusta lista (`:53`), resolvery z `DNS_SERVERS` (`:62`); cache 1 dzień (`:57`), nie zapisuje wyniku, gdy wszystkie zapytania padły (`:213`) |
| `rdap.ts` | RDAP przez bootstrap `https://rdap.org/domain/` (`rdap.ts:43`) | domena → `RdapInfo \| null` | limit 10 s (`:203`), 404 → `null` (`:211`), parsowanie rejestratora/zdarzeń/NS/abuse (`:115-180`); cache 7 dni (`:191`) |
| `ct.ts` | crt.sh JSON: wyszukiwanie domeny (`lookupCt`, `ct.ts:197`) i wzorca z `%` (`searchCt`, `:223`) | domena lub wzorzec → `CtResult \| null` | wspólna pętla zapytań `queryCrtSh` (`:232`): limit 30 s (`:235`), 3 ponowienia (`:236`), backoff `2 s·2^próba + jitter ≤ 0,5 s`, `Retry-After` ≤ 60 s (`:52`); ponawia przy 429/5xx, błędzie sieci i odpowiedzi nie-JSON; inne 4xx → `null`; scala precert/leaf po numerze seryjnym; ≤ 200 certyfikatów (`:238`), dla wzorca ≤ 1000 i `exclude=expired` (`:229`); wzorzec: `%` tylko na początku lub końcu (`:213`), strona crt.sh „Unsupported use of '%'” kończy zapytanie bez ponowień (`CrtShQueryError`, `:216`, `:259`); cache 1 dzień, tylko wyniki nie-null |
| `asn.ts` | Team Cymru przez DNS TXT | IP → `AsnInfo \| null` | zapytania `<odwrócone IP>.origin.asn.cymru.com` / `origin6` i `AS<n>.asn.cymru.com` (`asn.ts:49-61`); nazwa AS w osobnym wpisie cache (`:160`); cache 7 dni (`:133`) |

### 3.2 `lib/media/*`

`imageHash.ts`:
- dHash: skala szarości, miniatura 9×8 (`fit: fill`), bit = `piksel[x] < piksel[x+1]`, 64 bity (`imageHash.ts:64`). aHash: 8×8, bit = `piksel > średnia` (`imageHash.ts:76`).
- Przed hashowaniem: `autoOrient` (EXIF), tło białe pod przezroczystością (`imageHash.ts:38`, `:52`). Limit `limitInputPixels` 50 Mpx chroni przed bombą dekompresyjną (`imageHash.ts:35`).
- `hammingDistance` porównuje ciągi hex (`imageHash.ts:97`). `shodanFaviconHash` liczy MurmurHash3 x86_32 z base64 w liniach po 76 znaków, jak Python `base64.encodebytes` (`imageHash.ts:149-160`).
- Favicon ICO: brany jest największy osadzony PNG (`imageHash.ts:178`). ICO zawierający tylko BMP daje `dhash = null`, ale `mmh3` i `sha256` są liczone. `hashFavicon` nie rzuca wyjątków (`imageHash.ts:211`).

Adaptery narzędzi zewnętrznych (opcjonalne, domyślnie wyłączone). Każde narzędzie jest wykrywane raz na przebieg; gdy go brakuje, krok jest cicho pomijany z jedną linią w logu (`lib/pipeline/enrich.ts:116-133`). Procesy uruchamia `execFile` bez powłoki, z limitem czasu i `SIGKILL` (`lib/media/tools.ts:29`). Nic nie jest pobierane z sieci.

| Plik | Narzędzie i wywołanie | Wynik | Limity |
|---|---|---|---|
| `ocr.ts` | `tesseract <plik> stdout -l pol --psm 3` (`ocr.ts:46`); wykrycie wersji i pakietu `pol` (`ocr.ts:18`) | tekst z kreacji, białe znaki scalone | 60 s na obraz |
| `asr.ts` | `whisper-cli` (whisper.cpp) z modelem `WHISPER_MODEL`, domyślnie `~/models/whisper/ggml-large-v3-turbo.bin` (`asr.ts:26`); wejście inne niż WAV 16 kHz mono jest najpierw konwertowane przez `ffmpeg -ac 1 -ar 16000 -c:a pcm_s16le` (`asr.ts:75-87`); bez whisper-cli `mlx_whisper`, ale tylko z modelem już lokalnym, żeby nie było pobierania (`asr.ts:42-49`) | transkrypcja po polsku, bez znaczników czasu (`asr.ts:119`) | 10 min na plik (`asr.ts:151`), pliki tymczasowe w katalogu systemowym, sprzątane |
| `audioFp.ts` | `fpcalc -raw -json -length 120` (Chromaprint, `audioFp.ts:26`) | surowy odcisk; podobieństwo = najlepsze `1 − błąd bitowy` po przesunięciach ±40, przy nakładce ≥ 20 wartości (`audioFp.ts:60-75`) | 60 s na plik |

Teksty z OCR i ASR trafiają do ekstrakcji kontaktów i URL-i, do dopasowania person w trybie przybliżonym (§4.8) i do podobieństwa tekstu (`textOf`, `lib/graph/link.ts:706`). `scripts/media-smoke.ts` uruchamia każdy adapter na syntetycznym wejściu (§9).

### 3.3 `lib/cache.ts`

Plik `<CACHE_DIR>/<namespace>/<h[0:2]>/<sha256(klucz)>.json` z zawartością `{key, createdAt, expiresAt, value}`.
- Ochrona przed kolizją hashy (`cache.ts:81`) i sprawdzanie TTL (`cache.ts:82`).
- Zapis atomowy przez plik tymczasowy i `rename` (`cache.ts:94`). Równoległe wywołania tego samego klucza są deduplikowane (`cache.ts:102-115`).
- `null` jest cache'owany jako poprawna wartość (wynik negatywny), `undefined` nie jest.
- `CACHE=off|0|false|no` wyłącza cache (`cache.ts:59`).

| Przestrzeń nazw | TTL | Gdzie |
|---|---|---|
| `page` | 1 dzień, bez błędów `timeout`/`network`; klucz zawiera User-Agent (test cloakingu) | `lib/pipeline/sources.ts:46`, `:52` |
| `dns` | 1 dzień | `dns.ts:57` |
| `rdap` | 7 dni | `rdap.ts:191` |
| `ct` | 1 dzień | `ct.ts:179` |
| `ct-search` | 1 godzina (backfill watchera CT) | `scripts/ct-backfill.ts:48` |
| `asn` | 7 dni | `asn.ts:133` |
| `imagehash` | 7 dni (tylko live, obrazy z URL) | `lib/pipeline/enrich.ts:111` |
| `ner` | 28 dni (klucz: dostawca, model, sha256 tekstu) | `lib/pipeline/enrich.ts:112` |
| `embed` | 28 dni | `lib/pipeline/steps.ts:155` |

### 3.4 `lib/text/*`

- `normalize.ts:37` `normalizeForMatching`, kolejne kroki:
  1. NFKC i małe litery.
  2. Usunięcie URL-i (też `hxxp`) i e-maili.
  3. Zdjęcie diakrytyków i zamiana homoglifów cyrylica/greka (`normalize.ts:9`).
  4. De-leet (`normalize.ts:20`) tylko w tokenach mieszających litery z cyframi, `@` lub `$`, z wyjątkiem wzorca `^\d+[a-z]{1,3}$` (np. `100zl`, `24h`, `normalize.ts:32`).
  5. Wycięcie znaków innych niż litery i cyfry.
- `similarity.ts`: n-gramy znakowe 3–5 w granicach słów (`similarity.ts:18`). `idf = ln((1+n)/(1+df)) + 1` (`similarity.ts:58`), `tf = 1 + ln(count)` (`similarity.ts:69`), wektory normalizowane L2, cosinus przycięty do [0,1] (`similarity.ts:81`). N-gram nieznany modelowi dostaje maksymalne idf. Domyślnie `maxDf = 1`, czyli bez odcinania częstych n-gramów (`similarity.ts:48`).
- `persona.ts`: persona z tekstu, bez biometrii (§4.8).

### 3.5 `lib/graph/*`

| Plik | Rola |
|---|---|
| `model.ts` | typy grafu, `ENTITY_TYPES` (`model.ts:7`), etykiety PL (`model.ts:38`), `nodeId = "<typ>:<klucz>"`, typy podobieństwa (`model.ts:97`) |
| `config.ts` | wagi, progi, ustawienia kitu, listy infrastruktury współdzielonej, `mergeConfig` (`lib/graph/config.ts:698`) — §4, §10 |
| `weights.ts` | zniżki z list (`Discounter`), IDF, kara za powszechność, waga encji, noisy-OR — §4.3 |
| `link.ts` | budowa grafu, pivoty, pary, podobieństwo — §4 |
| `cluster.ts` | union-find + Louvain, kampanie i ich atrybuty — §5 |
| `explain.ts` | `explain(a, b)` i najsilniejsza ścieżka — §4.6 |
| `prune.ts` | przycięcie zapisywanego grafu — §5.4 |
| `eval.ts` | metryki — §6 |
| `unionFind.ts` | union-find (kompresja ścieżek, łączenie wg rozmiaru) |
| `testkit.ts` | budowanie małych zbiorów `EnrichedDataset` w testach (także kit, persony, parametry, CNAME) |

### 3.6 `lib/llm/*`

`ollama.ts` (czat, structured, embeddingi), `anthropic.ts` (Claude), `index.ts` (wybór przez `LLM_PROVIDER`, `embed()` zawsze przez Ollamę), `types.ts` (`LlmProvider`, `LlmError` z podpowiedzią). Szczegóły w §7.

### 3.7 `lib/pipeline/*`

| Plik | Rola i limity |
|---|---|
| `ingest.ts` | CSV/TSV/JSON/JSONL → `Item[]`. Separator wykrywany z `, ; \t \|` (`ingest.ts:94`). JSON: tablica albo obiekt z `items/data/ads/records/results` (`ingest.ts:121`). Mapowanie jawne ma pierwszeństwo, a automatyczne uzupełnia tylko niezmapowane pola kolumnami, których jawne nie zajęło (`ingest.ts:183-192`); synonimy w `ingest.ts:51`, w tym kolumny w stylu DROZD: persona, wynik deepfake i plik wideo (`ingest.ts:62-64`). Wynik deepfake: `0,91`, `0.91`, `91` i `91%` dają 0.91 (`normalizeScore`, `ingest.ts:166`); wartość nieczytelna daje ostrzeżenie (`ingest.ts:241`). Brak id → `h` + 12 znaków sha256 (`ingest.ts:220`). Duplikat id → `id__2` z ostrzeżeniem (`ingest.ts:228`). Wartość z kolumny obrazu bez `http(s)` trafia do `imagePath` (`ingest.ts:215`). Daty (`ingest.ts:149`): epoch s/ms, `dd.mm.rrrr[ hh:mm[:ss]]` (też z `/` i `-`, traktowane jako UTC), sama data ISO (UTC); wynik zawsze jako ISO UTC, ale ISO z godziną bez strefy (`2026-09-05 10:00`) jest interpretowane w czasie lokalnym maszyny. |
| `sources.ts` | `liveSources()` (`sources.ts:45`) i `fixtureSources(dir)` (`sources.ts:85`) za wspólnym interfejsem. Offline: `http.json` (URL → status/nagłówki/plik, opcjonalne warianty zależne od User-Agent, `sources.ts:97`), `dns.json`, `cymru.json`, `rdap/<domena>.json`, `crtsh/<domena>.json`. Nieznany URL → 404 „not in fixtures” (`sources.ts:94`). W trybie offline działają prawdziwe parsery i logika przekierowań. |
| `enrich.ts` | (1) dla każdej reklamy, współbieżnie po 4 (`enrich.ts:101`): obraz i opcjonalnie OCR, wideo z ASR i odciskiem audio, ekstrakcja z treści reklamy, OCR i ASR, landing (`landingUrl` albo pierwszy URL z treści), strona deduplikowana po URL z ekstrakcją, kitem, archiwum HTML, faviconem i opcjonalnym testem cloakingu (`enrich.ts:170-212`), persony (`enrich.ts:302-316`), parametry kampanii z linku, łańcucha, strony końcowej i URL-i z treści (`enrich.ts:318-323`); (2) DNS A/AAAA/CNAME hostów z linku, łańcucha, strony końcowej i URL-i z treści (limit 8, `enrich.ts:102`) i łańcuch CNAME do 4 skoków (`enrich.ts:370-378`); (3) dla domen NS/MX/TXT, RDAP (limit 2, `enrich.ts:103`), CT (limit 1, `enrich.ts:104`); (4) ASN dla IP (limit 8), w trybie live pomijane dla IP niepublicznych (`enrich.ts:440`). NER przez LLM po jednym wywołaniu naraz (`enrich.ts:105`), adaptery mediów po dwa (`enrich.ts:106`). Flagi `skip`: `page, favicon, image, dns, rdap, ct, asn`. Błędy trafiają do `errors`, nic nie przerywa przebiegu. |
| `steps.ts` | kroki CLI i zapis JSON. `runEnrich` wczytuje listę person i NER (`steps.ts:105-121`). `graph.json` jest zapisywany bez wcięć (`steps.ts:196`). Embeddingi z cache i powrotem do TF-IDF przy błędzie (`steps.ts:154-193`). Ewaluacja czyta etykiety z węzłów reklam (`steps.ts:229`). |
| `analyze.ts` | dopasowanie nowej reklamy (§8.1) |
| `summary.ts` | schemat zod streszczenia (§7) |
| `types.ts` | typy plików pośrednich (§2) |

### 3.8 `scripts/*`

Cienkie nakładki CLI na `steps.ts` i moduły (§9). `_cli.ts` używa `node:util parseArgs` w trybie `strict`: nieznana flaga kończy się kodem 2. `gen-sample.ts` generuje syntetyczną próbkę, a na starcie **usuwa cały `data/sample/`** (`scripts/gen-sample.ts:844`). Oprócz reklam, obrazów i fixtures zapisuje listę person (`personas.json`), syntetyczne dżingle WAV bez mowy (`media/`), leksykon i plik demo watchera CT (`ct-lexicon.json`, `ct-stream.jsonl`). `llm-smoke.ts` i `summarize.ts` korzystają z LLM. `evidence.ts` eksportuje paczkę dowodów (§15). `ct-watch.ts`, `ct-backfill.ts` i wspólny `_ct.ts` obsługują watcher CT (§16). `media-smoke.ts` sprawdza adaptery mediów na żywo.

### 3.9 `app/*`, `components/viewer/*`

- `app/page.tsx` renderuje się statycznie. Dane czyta `lib/viewer/data.ts:21` przez `readFileSync`. Produkcyjny build wkleja `data/*.json` w czasie budowania, więc po ponownym pipeline trzeba zrobić `bun run build`. `bun run dev` czyta pliki przy każdym żądaniu (sprawdzone).
- `components/viewer/Viewer.tsx`: stan filtrów i zaznaczenia oraz linki przez `useSearchParams` w `Suspense` (`Viewer.tsx:48`): `?k=K01&n=item:c1-08` (kampania i węzeł), `?a=c1-01&b=c1-04` (porównanie), `?p=adam-testowy` (persona), `?panel=ct` (nowe domeny z watchera CT, `Viewer.tsx:64`). Wybór użytkownika ma pierwszeństwo przed linkiem (stan pochodny, bez efektów).
- Domyślne ustawienia widoku (`Viewer.tsx:68-70`): kolor wg kampanii, „tylko współdzielone encje”, „ukryj niepowiązane reklamy”.
- Panel boczny ma zakładki „Szczegóły | Porównaj reklamy | Nowa reklama | Nowe domeny” (`Viewer.tsx:26-31`).
- `graphView.ts:44` definiuje encję „użyteczną”: `df ≥ 2` albo leżącą na ścieżce do takiej encji. Filtr persony pokazuje tylko kampanie z daną personą (`graphView.ts:80-81`).
- `GraphCanvas.tsx`: Cytoscape i fcose, ładowane dynamicznie w przeglądarce; Shift+klik w reklamę dodaje ją do porównania (`GraphCanvas.tsx:97-98`).
- `DetailsPanel.tsx`: rozkład wagi z czynnikiem powszechności (`DetailsPanel.tsx:283-285`), zniżki, ≤ 12 powiązań reklamy z ≤ 4 dowodami każde, ścieżki dowodu (`DetailsPanel.tsx:217`, `:318`, `:339`). Dla reklamy sekcja „Atrybuty (do filtrowania, nie dowody łączące)” (`DetailsPanel.tsx:115-128`): persony ze źródłem, wynik deepfake opisany jako wynik modelu, cyrylica, werdykt cloakingu z powodami, URL końcowy, simhash DOM, fragmenty OCR i ASR. Dla nowych typów encji polskie etykiety pól i krótkie objaśnienie (`DetailsPanel.tsx:67`, `:88`).
- `ComparePanel.tsx`: dwie reklamy (wyszukiwarki pogrupowane po kampaniach, Shift+klik, przyciski w szczegółach), wynik `explain(a, b)` (`ComparePanel.tsx:117`): ta sama kampania czy nie, zapisane powiązanie z wagami i zniżkami, najsilniejszy łańcuch przez inne reklamy oraz „Wspólne encje” (`compare.ts:73`), także zdyskontowane. Wyjaśnia to brak scalenia, którego `graph.json` nie pokazuje, bo powiązania < 0.05 są odrzucane. Przycisk „Kopiuj link”.
- `CampaignList.tsx`: na kampanii chipy person, liczby reklam z cyrylicą i z podejrzeniem cloakingu, najwyższy wynik deepfake; filtr persony (`CampaignList.tsx:74-79`). Starszy `campaigns.json` bez `attributes` też się renderuje (`compare.ts:140`).
- `CtFeedPanel.tsx`: zakładka „Nowe domeny” (§16.7).
- `next.config.ts`: `cacheComponents` (`next.config.ts:4`), `output: "standalone"` (`next.config.ts:7`), `outputFileTracingIncludes` dla `data/` (`next.config.ts:9`), `serverExternalPackages: ["sharp"]` (`next.config.ts:15`). Fonty systemowe, więc build działa bez sieci.

### 3.10 Opcjonalne kroki wzbogacania

Wszystkie są domyślnie wyłączone i włączane flagami `enrich`/`pipeline` (§9).

| Krok | Co robi | Gdzie |
|---|---|---|
| test cloakingu (`--cloaking`) | Dla każdej strony docelowej **dwa zwykłe GET-y** tym samym pobieraczem co reszta (ochrona SSRF, limity czasu, bajtów i przekierowań bez zmian): z User-Agentem crawlera platformy reklamowej (`facebookexternalhit/1.1`) i przeglądarki mobilnej (iPhone Safari) (`enrich.ts:48-50`). Podejrzenie, gdy różnią się adresy końcowe, simhash DOM różni się o więcej niż 12 bitów albo tylko jeden wariant kończy się kodem 2xx (`enrich.ts:157-168`). Wynik w `PageInfo.cloaking` i atrybucie `cloakingSuspected`; nie jest dowodem łączącym. Nie wykrywa cloakingu po IP, geolokalizacji ani JS. | `enrich.ts:140-168`, `:207` |
| archiwum HTML (domyślnie włączone w CLI, `--no-archive` wyłącza) | zdekodowany HTML (UTF-8) każdej pobranej strony w `data/work/archive/<sha256 surowej odpowiedzi>.html`; ścieżka trafia do `PageInfo.archiveFile`, a paczka dowodów kopiuje plik i liczy jego SHA-256 | `enrich.ts:186-193` |
| lista person (`--personas plik.json`; z próbką domyślnie `data/sample/personas.json`) | dopasowanie nazwisk z odmianą w treści reklamy i strony, przybliżone w tekście z OCR/ASR | `enrich.ts:302-309`, §4.8 |
| NER (`--ner`) | imiona i nazwiska osób z tekstu przez skonfigurowany LLM, wynik w cache `ner` | `enrich.ts:252-259`, `persona.ts:303` |
| OCR (`--ocr`), ASR (`--asr`), odcisk audio (`--audio`) | adaptery z §3.2; ASR i odcisk tylko dla reklam z `videoPath` | `enrich.ts:269-284` |
| Głos mówcy (`--speaker`) | SpeechBrain ECAPA-TDNN (VoxCeleb) przez `scripts/py/speaker_embed.py` w venv `.venv-speaker` (`scripts/py/setup-speaker.sh`, env `SPEAKER_PYTHON`, `SPEAKER_MODEL_DIR`); jeden proces na całą partię, cache `.cache/speaker`. Krawędź `similar_voice` przy cosinusie ≥ 0,6 (ten sam mówca 0,86–0,93, różni ≤ 0,34 na nagraniach testowych); para z tą samą ścieżką (Chromaprint) jest pomijana. W `notAloneKinds`: sklonowany głos jednej osoby publicznej pasuje między niezależnymi operatorami | `lib/media/speaker.ts`, `adLibraryVoice.test.ts` |
| Biblioteka reklam Mety (`--ad-library`, tylko live) | MetaAdsCollector (`uv tool install meta-ads-collector`, env `META_ADS_PYTHON`) przez `scripts/py/ad_library.py`: zapytanie „Zobacz szczegóły reklamy” po samym identyfikatorze biblioteki, bez klucza API, działa też dla zdjętych reklam. Identyfikatory z kolumny `ad_library_id` i z OCR zrzutów. Zwraca płatnika i beneficjenta (DSA), `is_ad_taken_down`, naruszone zasady, zasięg w UE i grupę docelową; cache `.cache/adlibrary` (1 dzień). Płatnik to pivot `ad_payer` (waga 0,7, krawędź `paid_by`); dane trafiają do węzła reklamy (`adLibrary`, `adTakenDown`). Endpoint publicznej strony biblioteki: może przestać działać po zmianach u Mety | `lib/osint/adLibrary.ts`, `adLibraryVoice.test.ts` |

---

## 4. Model grafu

### 4.1 Encje

Klucz węzła to `<typ>:<klucz>`. Waga typu z `lib/graph/config.ts:127-155`. „Może być silny” oznacza, że `waga typu × czynnik listy ≥ strongThreshold (0.7)` przy czynniku 1.

| Typ | Klucz | Skąd (`link.ts`) | Waga typu | Może być silny |
|---|---|---|---|---|
| `item` | id reklamy | `:135` | — | — |
| `url` | znormalizowany URL (link, każdy skok, strona końcowa, URL-e z treści) | `addUrlInfra :212` | 1.0 | tak |
| `host` | host ASCII | `:212` | 0.95 | tak |
| `domain` | eTLD+1 (też domeny z linków wychodzących) | `:212`, `:390` | 0.95 | tak |
| `tracker` | `<rodzaj>:<id>` | `:374` | 1.0 | tak |
| `wallet` | `<btc\|eth\|tron>:<adres>` | `addContacts :170` | 1.0 | tak |
| `email` | e-mail małymi literami | `:170` | 0.9 | tak |
| `phone` | E.164 (też WhatsApp `wa.me`) | `:170` | 0.9 | tak |
| `telegram` | `t.me/<nazwa>` lub zaproszenie; **zaproszenia do grup WhatsApp też trafiają tu** (`:190`) | `:170` | 0.9 | tak |
| `endpoint` | backend formularza: `host+szablon ścieżki` (`leads-gate.test/api/v1/submit/<uuid>/`) albo `*szablon` dla ścieżki na tej samej domenie (`*/api/lead`) | `:406` | 0.95 | tak dla innej domeny bez zniżki; ścieżka na tej samej domenie dostaje ×0.4, więc nigdy |
| `campaign_param` | `nazwa_kanoniczna=wartość` (wartość małymi literami) | `:460` | 0.8 | tak, gdy wartość nie jest zdyskontowana |
| `cert` | numer seryjny (lub id crt.sh), tylko certyfikaty, których SAN obejmuje ≥ 2 różne eTLD+1 (`:318`) | `:320` | 0.8 | tak, ale darmowy CA daje ×0.6 → 0.48 |
| `imagehash` | dHash hex (identyczny obraz) | `:159` | 0.65 | nie |
| `cname_target` | domena rejestrowalna celu CNAME; cel na sufiksie prywatnym PSL (np. `d123.cloudfront.net`) daje osobny węzeł na klienta, ale lista `cnameTargets` i tak go dyskontuje | `:236` | 0.65 | nie |
| `advertiser` | nazwa reklamodawcy (NFKC, małe litery) | `:153` | 0.6 | nie |
| `ip` | IP kanoniczny | `:246` | 0.6 | nie |
| `hidden_fields` | posortowane nazwy ukrytych pól po odrzuceniu ogólnych, tylko gdy zostają ≥ 2 | `:420` | 0.6 | nie |
| `comment` | znormalizowany komentarz HTML/JS | `:442` | 0.6 | nie |
| `domain_pattern` | szablon nazwy domeny (`zwrot<n>-<lorem><n>.example`) i wariant bez TLD (`….*`), tylko gdy obejmuje ≥ 2 domeny | `:291` | 0.6; wariant `.*` ×0.85 | nie |
| `asset` | własny plik JS/CSS: ścieżka (ta sama domena) albo host+ścieżka | `:429` | 0.55 | nie |
| `favicon` | `mmh3:<int>` | `:380` | 0.5 | nie |
| `nameserver` | **zbiór** NS domeny, posortowany i złączony ` + ` | `:306` | 0.35 | nie |
| `persona` | slug imienia i nazwiska (`adam-testowy`) | `:484` | 0.1 | nie (zawsze poniżej `minLinkScore`, §4.8) |
| `registrar` | nazwa małymi literami; seria rejestracji: `<rejestrator>\|<data pierwszej>` | `:312`, `:724-785` | 0.05; seria 0.3 (`config.ts:180`) | nie |
| `asn` | `AS<n>` | `link.ts:256` | 0.05 | nie |

### 4.2 Krawędzie (`model.ts:66`)

| Typ | Od → do | Kiedy |
|---|---|---|
| `landing` | reklama → pierwszy URL | `link.ts:358` |
| `redirect` | URL → URL | kolejne skoki `redirectChain`, z opisem „HTTP 30x” albo „meta refresh” (`link.ts:360`) |
| `on_host`, `in_domain` | URL → host → domena | zawsze |
| `cname_to` | host → cel CNAME | z łańcucha CNAME hosta (`link.ts:241`) |
| `resolves_to`, `announced_by` | host → IP → ASN | z DNS A/AAAA i Team Cymru |
| `uses_ns`, `registered_with`, `has_cert`, `registration_burst`, `matches_pattern` | domena → NS / rejestrator / cert / seria / wzorzec nazwy | z DNS, RDAP, CT i szablonu nazwy (`link.ts:298`) |
| `uses_tracker`, `has_favicon`, `links_to` | URL końcowy → tracker / favicon / domena | z `PageExtract` strony końcowej |
| `posts_to`, `has_hidden_fields`, `loads_asset`, `has_comment` | URL końcowy → backend / ukryte pola / plik / komentarz | z `PageKit` strony końcowej (`link.ts:414`, `:421`, `:437`, `:443`) |
| `mentions` | reklama lub URL końcowy → kontakt/portfel; reklama → URL z treści | treść reklamy lub strony |
| `carries_param` | reklama → parametr kampanii | `link.ts:468` |
| `mentions_persona` | reklama → persona | jedna krawędź na personę; wszystkie źródła w `evidence`, rozdzielone „; ” (`link.ts:475-487`) |
| `posted_by`, `has_image` | reklama → reklamodawca / hash obrazu | |
| `similar_image`, `similar_text`, `similar_dom`, `similar_audio`, `similar_voice` | reklama → reklama | §4.5 |

### 4.3 Pivot i waga

**Pivot** to każda encja (nie reklama), do której prowadzi ścieżka od reklamy. Funkcja `add` w `link.ts:131` zapisuje `{pivot, type, path, relation, how}`. Fakty z relacją 0 są odrzucane (`link.ts:132`), a duplikaty łączone przez zachowanie najwyższej relacji i najkrótszej ścieżki (`link.ts:714`). `df(e)` to liczba reklam z danym pivotem (`link.ts:512`).

Waga encji (`weights.ts:279-295`):

```
waga(e)   = waga_typu(typ) × czynnik_listy(e) × idf(df, N) × powszechność(df, N)
silny(e)  = waga_typu × czynnik_listy ≥ 0.7   ORAZ   df ≤ max(2, floor(0.5 · N))
idf(df,N) = 1                                   gdy N ≤ 2 lub df ≤ 2
          = clamp( (1 + ln(N/df)) / (1 + ln(N/2)), 0.2, 1 )   w pozostałych przypadkach   (weights.ts:253-257)
powszechność(df,N) = 1                          gdy N < 10 lub df/N ≤ 0.5
          = max(0.1, (1 − df/N) / 0.5)          w pozostałych przypadkach   (weights.ts:263-268)
czynnik_listy(e) = min(factor) ze wszystkich pasujących reguł, 1 gdy brak   (weights.ts:245)
```

Przykłady z próbki (N = 43):
- IP Cloudflare współdzielone przez 17 reklam: idf = (1+ln(43/17))/(1+ln(21,5)) = 0,4739, powszechność 1, waga = 0,6 × 0,02 × 0,4739 = 0,0057.
- Komentarz-znacznik generatora próbki jest na 41 stronach: idf 0,2575, powszechność 0,1. Nawet bez reguły w `data/sample/linking.json` (która daje ×0) waga wyniosłaby 0,6 × 0,2575 × 0,1 = 0,015. Kara za powszechność tłumi encje obecne niemal wszędzie, których nie ma na żadnej liście.

**Waga pary** dla wspólnego pivotu `e` (`link.ts:532-568`):
- pary są tworzone tylko gdy `2 ≤ df ≤ maxPivotDf (400)` i `waga > 0` (`link.ts:532`);
- wariant szablonu bez TLD (`….*`) nie dodaje dowodu parze, która ma już wspólny wariant z TLD tego samego szablonu (`link.ts:537-551`), więc ten sam wzorzec nie liczy się dwa razy;
- `w = waga(e) × min(relacja_A, relacja_B)` (`link.ts:553`);
- dowód jest silny, gdy `silny(e)` i `min(relacja) ≥ 1` (`link.ts:562`).

**Relacje** (mnożniki ścieżki):

| Sytuacja | Relacja | Gdzie |
|---|---|---|
| zwykła ścieżka (hosting, treść, parametry kampanii, persona) | 1 | `link.ts:469`, `:486` |
| domena z linku wychodzącego strony | 0.4 (`outboundLinkFactor`) | `link.ts:395`, `config.ts:178` |
| strona końcowa zaparkowana: jej trackery, favicon, kontakty, linki, **kit strony oraz IP/ASN/NS hosta końcowego** | ×0.05 (`parkingFactor`) | `link.ts:343-344`, `:356`, `:402`, `config.ts:389` |
| URL na domenie z listy `domains` lub `endpointHosts` (platforma, skracacz, CDN, publiczny serwis): IP/ASN/NS/rejestrator/cert/cel CNAME tej domeny | × czynnik reguły (0 = całkowicie pomijane) | `link.ts:217-219`, `:242` |
| domena wychodząca albo plik JS/CSS z innej domeny, której czynnik listy to 0 | węzeł w ogóle nie powstaje | `link.ts:392`, `:427` |

Strona jest uznawana za zaparkowaną, gdy regex z `parkingPatterns` (`config.ts:377`) pasuje do pierwszych 4000 znaków tytułu, opisu i `visibleText` (`weights.ts:88`).

### 4.4 Listy infrastruktury współdzielonej (`lib/graph/config.ts`)

Kolumna „Linie” wskazuje `lib/graph/config.ts`, kolumna „Dopasowanie” — `lib/graph/weights.ts`.

| Lista | Linie | Dopasowanie | Domyślnie |
|---|---|---|---|
| `asns` | `config.ts:184-203` | numer ASN; `factor` dla węzła ASN, `ipFactor` dla IP ogłaszanych przez ten AS (`weights.ts:77-86`) | Cloudflare 13335/209242 (0.02/0.02), Akamai, Fastly, Imperva, Sucuri (0.05), CDN77, G-Core (0.1), Google/Amazon/Microsoft/Meta (IP 0.1–0.5), hostingi współdzielone (IP 0.3) |
| `ipCidrs` | `config.ts:204-234` | najbardziej szczegółowy CIDR (`weights.ts:79`) | opublikowane zakresy Cloudflare v4/v6 (0.02), Fastly 151.101/16, Vercel 76.76.21/24, Netlify 75.2.60.5, GitHub Pages 185.199.108/22, Firebase 199.36.158.100 (0.05) |
| `nameserverSuffixes` | `config.ts:235-264` | sufiks; zniżka tylko gdy **każdy** NS ze zbioru pasuje, brany najłagodniejszy czynnik (`weights.ts:117-126`) | Cloudflare, Route 53, GoDaddy, Namecheap, Google, Azure, NS1… (0.1); parkingi Sedo, ParkingCrew, Bodis, Above, Hostinger, Afternic, Dan (0.05) |
| `certIssuers` | `config.ts:265-272` | podciąg w `issuer` | Let's Encrypt, ZeroSSL, Google Trust Services, cPanel, Buypass (0.6), Cloudflare (0.5) |
| `certSanMarkers` | `config.ts:273-277` | sufiks dowolnej nazwy z SAN | `cloudflaressl.com`, `incapsula.com` (0.02), `edgecastcdn.net` (0.05) |
| (reguła wbudowana) | — | SAN obejmuje > `maxCertDomains` (25) różnych eTLD+1 (`weights.ts:141-147`) | 0.05 |
| `registrars` | `config.ts:278-303` | podciąg w nazwie | 24 popularnych rejestratorów (0.6) |
| `domains` | `config.ts:304-375` | eTLD+1 równe regule lub jej subdomena; reguła bez kropki działa jako podciąg (`weights.ts:22-26`) | duże platformy, skracacze, CDN/biblioteki, popularne portale PL (0) |
| `pivots` | `config.ts:376` | dokładne id lub klucz węzła | pusta |
| `parkingPatterns`, `parkingFactor` | `config.ts:377-389` | regex (bez rozróżniania wielkości liter) | „domain for sale”, „buy this domain”, „domena na sprzedaż”…; relacja 0.05 |
| `endpointHosts` | `config.ts:390-443` | host backendu (sufiks); **ta sama lista dyskontuje domenę z linku wychodzącego i cel zasobu** (`domainDiscount`, `weights.ts:64-75`) | publiczne serwisy formularzy (web3forms, Formspree, FormSubmit, Getform, Jotform, Typeform, HubSpot, Mailchimp, EmailJS…), analityka i antyspam (Google Analytics/GTM, Meta, TikTok, Yandex, Clarity, Hotjar, reCAPTCHA, hCaptcha…), geolokalizacja IP (ipinfo.io, ip-api.com, ipify…), wszystkie 0.05 |
| `endpointGenericPaths` | `config.ts:444-488` | dokładny szablon ścieżki na tej samej domenie (`weights.ts:162-164`) | `/`, `/submit`, `/send`, `/api/lead`, `/contact.php`, `/register.php`, `/handler.php`… (0.05) |
| `hiddenFieldGeneric` | `config.ts:489-523` | nazwa pola (odrzucana przed złożeniem klucza, `weights.ts:60-62`) | tokeny CSRF i `__VIEWSTATE`, `_wpnonce`, `redirect`, `lang`, pola serwisów formularzy (`access_key`, `subject`, `_next`, `_honey`), `g-recaptcha-response`… |
| `assetLibraries` | `config.ts:524-536` | regex na nazwie pliku (`weights.ts:175-183`) | jQuery, Bootstrap, Popper, Swiper, GSAP, Vue, React, Font Awesome, intl-tel-input, Inputmask… (0.05); nazwy ogólne `style.css`, `main.js`, `app.js`, `bundle.js`… (0.1) |
| `commentPatterns` | `config.ts:537-554` | regex na komentarzu (`weights.ts:184-188`) | snippety trackerów (GTM, gtag, Meta Pixel, Yandex Metrika, Hotjar), WordPress/Yoast, „end of …”, banery cookies, nazwy sekcji szablonu (0.05) |
| `cnameTargets` | `config.ts:555-607` | sufiks celu (`weights.ts:202-209`) | CDN: CloudFront, Akamai, Fastly, Cloudflare, Azure CDN/Front Door, Bunny, CDN77, KeyCDN, StackPath, Imperva, Sucuri, Edgecast (0.02); hostingi: Azure Websites, Heroku, GitHub Pages, Netlify, Vercel, Cloudflare Pages/Workers, Firebase, Google, WP Engine, Shopify, Squarespace, Wix, Webflow, HubSpot, Zendesk, Elastic Beanstalk, AWS, GoDaddy Sites, Weebly, Blogspot (0.05) |
| `campaignParamGenericValues` | `config.ts:608-668` | dokładna wartość (`weights.ts:213-215`) | nazwy platform i kanałów (`facebook`, `fb`, `ig`, `google`, `tiktok`, `cpc`, `paid_social`, `email`…), wartości puste (`none`, `null`, `(not set)`) i makra Meta (`{{campaign.name}}`, `{{ad.id}}`…), czynnik 0.05 |
| `campaignParamWeakNames` | `config.ts:669-672` | nazwa parametru (`weights.ts:228-229`) | `utm_source`, `utm_medium` (0.2) |

Parametry kampanii mają też reguły wbudowane (`weights.ts:213-227`): wartość krótsza niż 3 znaki ×0.05, liczba 1–4 cyfrowa ×0.1, nierozwinięte makro ×0.1, wartość słowna (same litery, 3–25 znaków) ×0.75 (`kit.campaignParamWordFactor`). Wzorce nazw domen: szablon bez rdzenia literowego (< 3 litery, np. `<lorem><n>`) ×0.3, wariant bez TLD ×0.85 (`weights.ts:189-201`). Backend na tej samej domenie co strona: ×0.4, a krótka ścieżka (≤ 2 segmenty) dodatkowo ×0.5 (`weights.ts:150-173`).

Gdy kilka reguł podaje ten sam powód (np. Cloudflare przez CIDR i przez ASN), zostaje jedna zniżka (`weights.ts:236-241`).

### 4.5 Podobieństwo

| Sygnał | Warunek | Waga dowodu | Gdzie |
|---|---|---|---|
| obraz (dHash) | `1 ≤ Hamming ≤ imageHamming (10)`; `d = 0` jest pomijane, bo pokrywa je pivot `imagehash` | `0.6 × (1 − 0.5·d/10)`, czyli 0.57…0.30 | `link.ts:572-586`, `config.ts:162-163` |
| struktura strony (simhash DOM) | `Hamming ≤ dom.hamming (6)`; pary z tym samym URL-em końcowym są pomijane, bo łączy je już URL/host | `0.45 × (1 − 0.5·d/6)`, czyli 0.45…0.225 | `link.ts:588-608`, `config.ts:165` |
| ścieżka dźwiękowa (Chromaprint) | podobieństwo ≥ `audio.minSimilarity (0.85)` | `0.5 × (0.5 + 0.5·(sim−0.85)/0.15)`, czyli 0.25…0.50 | `link.ts:610-622`, `config.ts:166` |
| tekst TF-IDF | cosinus ≥ 0.5; tekst ≥ 25 znaków | `0.5 × (0.5 + 0.5·(cos−próg)/(1−próg))`, czyli 0.25…0.50 | `link.ts:624-659`, `config.ts:164` |
| tekst, embeddingi | cosinus ≥ 0.86 | jak wyżej | `link.ts:633-640` |

Tekst do porównania to treść reklamy z tekstem z OCR i ASR, a gdy ich brak, tytuł i opis strony docelowej (`textOf`, `link.ts:706`). Porównywane są wszystkie pary, czyli O(n²). Na próbce simhash DOM różni się w obrębie kampanii o ≤ 5 bitów, a między kampaniami o ≥ 22 (pomiar `gen-sample`). Niezwiązane nagrania mają podobieństwo ok. 0,5–0,7, więc próg 0,85 jest z zapasem (`lib/media/audioFp.test.ts`).

**Powiązanie pary** (`link.ts:662-671`): `score = 1 − Π(1 − w_i)` po wszystkich dowodach (noisy-OR, `weights.ts:298`). Silne, gdy którykolwiek dowód jest silny. Powiązania z `score < 0.05`, które nie są silne, są odrzucane (`link.ts:668`). Ich encje zostają w węzłach i krawędziach.

### 4.6 `explain(a, b)` (`lib/graph/explain.ts:32`)

1. `sameCampaign`: oba węzły mają ten sam `campaignId`.
2. Dowody bezpośrednie: `evidence` powiązania (a, b), jeśli istnieje. Każdy dowód typu pivot ma `pathA` i `pathB`, czyli listy id węzłów od reklamy do wspólnej encji (np. `item:c1-01 → url:… → host:… → ip:…`).
3. Gdy powiązania nie ma albo `score < minLinkScore`, Dijkstra na wagach `−ln(score)` po powiązaniach z `score ≥ minLinkScore` lub silnych (`strongestPath`, `explain.ts:53-91`). Maksymalizuje to iloczyn wyników. Każdy krok zawiera ≤ 3 najsilniejsze dowody.
4. `summary`: tekst PL.

`explain` działa na grafie, który dostanie. Po przycięciu (§5.4) może nie znaleźć słabszych par bezpośrednio. Przeglądarka używa go w panelu porównania (`ComparePanel.tsx:117`) i uzupełnia listą wszystkich wspólnych encji, również tych, których para nie dostała w `graph.json` (§3.9). `lib/graph/cluster.ts:30` reeksportuje `explain` dla zgodności.

### 4.7 Kit strony, wzorce nazw, CNAME i parametry kampanii

Te pivoty wynikają z notatek badawczych (ranking sygnałów: backend formularza > szablon strony > wzorzec nazw domen > cel CNAME > metadane kampanii w URL). Każdy ma zniżkę dla infrastruktury współdzielonej, żeby nie scalał niezwiązanych kampanii tak, jak zrobiłyby to adresy Cloudflare.

| Pivot | Skąd | Zniżki i progi | Przykład z próbki |
|---|---|---|---|
| `endpoint` | `PageKit.endpoints` strony końcowej (`link.ts:404-416`) | publiczny serwis formularzy, analityka i geolokalizacja (`endpointHosts`) 0.05; ścieżka na tej samej domenie ×0.4; ścieżka ogólna 0.05; krótka ścieżka ×0.5 (`weights.ts:150-173`) | `leads-gate.test/api/v1/submit/<uuid>/` na dwóch domenach C1 (inne UUID) jest silny; `api.web3forms.com/submit` u C5, N1 i N2 ma wagę 0,031 i ich nie łączy |
| `hidden_fields` | `PageKit.hiddenFields` bez nazw ogólnych, ≥ 2 pola (`kit.minHiddenFields`, `link.ts:417-423`) | lista `hiddenFieldGeneric` odrzuca pola przed złożeniem klucza | `device_id,fill_time,read_time` (C3) |
| `asset` | `PageKit.assets`; pliki z domen o czynniku listy 0 (publiczne CDN) są pomijane (`link.ts:424-438`) | biblioteki 0.05, nazwy ogólne 0.1 | `/assets/js/kz-form.3fa9c1.js` (C1); `jquery-3.7.1.min.js` i `style.css` u C1 i N1 mają wagę < 0,05 |
| `comment` | `PageKit.comments` (`link.ts:440-445`) | snippety trackerów i CMS 0.05; kara za powszechność | komentarz po rosyjsku w kodzie C1 (flaga cyrylicy) |
| `domain_pattern` | szablony domen ze zbioru (bez domen z list), tylko szablony obecne w ≥ 2 różnych domenach (`kit.domainPatternMinDomains`, `link.ts:113-127`, `:283-301`) | bez rdzenia literowego ×0.3; wariant bez TLD ×0.85; brak podwójnego liczenia (§4.3) | `zwrot<n>-<lorem><n>.example` (2 domeny C4) i `zwrot<n>-<lorem><n>.*` (3 domeny w dwóch TLD) |
| `cname_target` | łańcuch CNAME hosta (`HostInfo.cnameChain`, do 4 skoków), klucz = domena rejestrowalna celu (`link.ts:229-243`) | CDN 0.02, hostingi 0.05 (`cnameTargets`); relacja hostingu jak IP | `tds-cname.test` (dwie domeny C3, różne etykiety celu); `fastly.net` u C5 i N5 ma wagę 0,009 |
| `campaign_param` | URL-e reklamy, łańcucha, strony końcowej i treści (`link.ts:456-471`) | wartości ogólne i makra, wartości krótkie i liczbowe, słowne, słabe nazwy (§4.4) | `sub1=mb_kowal`, `offer_id=771304` (C3), `aff_id=kd_partner_19` (C5), `utm_campaign=пл_инвест_лиды_07` (C1, cyrylica) są silne; `utm_source=facebook` u C1, C2 i N1 ma wagę 0,029 |

Cyrylica w komentarzach strony lub w wartości parametru ustawia atrybut `cyrillic` reklamy (`link.ts:447`, `:470`) i liczbę reklam z cyrylicą w kampanii. To atrybut, nie krawędź.

### 4.8 Persona (osoba, pod którą podszywa się reklama)

Persona pochodzi wyłącznie z tekstu albo z danych wejściowych. Starter nie przetwarza twarzy ani głosu i nie przechowuje wzorców biometrycznych.

- **Lista obserwowanych osób** (`lib/text/persona.ts`, plik JSON `[{name, role?, aliases?}]`, schemat `persona.ts:19`): każde słowo nazwiska dostaje wzorzec prostej odmiany polskiej (`inflectionPattern`, `persona.ts:90`), np. „Adama Testowego”, „Ewie Przykładowej”, na tekście po `normalizeForMatching` (diakrytyki, homoglify, wielkość liter). Dopasowanie w treści reklamy i strony docelowej (`matchPersonas`, `persona.ts:221`).
- **Tryb przybliżony dla OCR/ASR** (`fuzzyMatch`, `persona.ts:195`): imię musi pasować dokładnie (z odmianą), a temat nazwiska po zdjęciu końcówki (`stemPolish`, `persona.ts:124`) może różnić się o odległość edycyjną zależną od długości: ≤ 4 znaki 0, 5–7 znaków 1, ≥ 8 znaków 2 (`maxSurnameDistance`, `persona.ts:149`). Przypadek z transkrypcji whispera „Inwestuj z Rafałem Brzosku” (powiedziano „Brzoską”) pasuje do „Rafał Brzoska” tylko w tym trybie (`lib/text/persona.test.ts:109-119`). Tryb przybliżony działa tylko na tekście z OCR i ASR (`lib/pipeline/enrich.ts:307-308`).
- **Kolumna wejściowa** (np. identyfikator lub nazwisko z DROZD): `personasFromIngest` (`persona.ts:276`), kilka wartości rozdzielonych `;`, `|` lub `,`.
- **NER przez LLM** (opcjonalnie, `--ner`): `extractPersonsNer` (`persona.ts:303`); prompt każe traktować tekst jako dane i nie opisywać wyglądu.
- **W grafie** persona ma wagę typu 0.1 (`config.ts:154`), więc sama nigdy nie przekracza `minLinkScore` (0.15) i nie łączy kampanii (ta sama osoba występuje w wielu kampaniach). Na reklamę i personę jest jedna krawędź `mentions_persona` ze wszystkimi źródłami (§4.2). Kampania dostaje atrybut `personas[{id,name,count}]` (`cluster.ts:237`), a przeglądarka filtr persony.

### 4.9 Pivoty i reguły dodane 20.11.2026 wieczorem

Powstały po uruchomieniu startera na 15 zarchiwizowanych stronach docelowych z publicznej zajawki zadania. Odwołania `plik:linia` w starszych rozdziałach nie były po tych zmianach aktualizowane.

| Element | Skąd | Waga i zniżki | Test |
|---|---|---|---|
| `path_id` | `PageKit.pathIds` (`extractPageKit`): UUID będący segmentem ścieżki co najmniej dwóch zasobów ładowanych z domeny strony (`src` dowolnego znacznika, `link[href]`), maks. 10. Linki nawigacyjne i zasoby z innych hostów są pomijane | waga typu 0.85, czyli silny dowód: losowy UUID wspólny dla różnych domen to jedno konto kreatora stron. Każdy identyfikator niesie ścieżkę przed UUID (`prefix`). Na platformach sklepowych UUID oznacza zainstalowaną aplikację albo motyw, więc `lists.pathIdSharedPrefixes` (domyślnie `/cdn/shop/`, `/cdn/extensions/`) daje czynnik 0.05. Pojedynczy identyfikator zdyskontujesz przez `lists.pivots` (`path_id:<uuid>`) | `pagekit.test.ts`, `kitLink.test.ts` |
| `param_schema` | `paramSchema(landingUrl)` w `lib/osint/campaignParams.ts`: posortowane pary `nazwa:kształt` (`uuid`, `hex`, `tok`, `num`, `word`), bez identyfikatorów kliknięć dopisywanych przez platformy. Powstaje tylko dla linków z ≥ 3 parametrami, z których ≥ 2 mają wartości losowe | waga typu 0.12, poniżej `minLinkScore`: szablon wskazuje system kierowania ruchem, który może mieć wielu klientów. Wzmacnia inne dowody. Podniesienie wagi w konfiguracji grupuje kampanie według platformy | `campaignParams.test.ts`, `kitLink.test.ts` |
| Etykiety interfejsu w OCR | `stripUiChrome` w `lib/text/uiChrome.ts` (PL i EN): usuwa „Sponsorowane”, przyciski wezwania do działania i panele biblioteki reklam, rozpoznaje widok (`ad_library`, `sponsored_post`) | `textOf` porównuje tekst OCR bez etykiet. Dla widoku `ad_library` obraz nie tworzy pivotu `imagehash` ani podobieństwa `similar_image` / `similar_image_semantic`, bo zrzut to głównie interfejs | `uiChrome.test.ts`, `screenshotLink.test.ts` |
| `ad_library_id` | „Identyfikator biblioteki” / „Library ID” z OCR, jako `campaign_param` z `sourceUrl` wskazującym bibliotekę reklam | silny (0.8): ten sam identyfikator to ta sama reklama zgłoszona dwa razy. Węzeł reklamy dostaje `uiView` i `adLibraryIds` | `screenshotLink.test.ts` |
| Seria rejestracji | `addRegistrationBursts` grupuje po `registrarIanaId`, gdy RDAP go podaje; inaczej po nazwie | bez zmian (0.3 przed zniżkami). Rejestry zapisują nazwę tego samego rejestratora różnie w różnych TLD | `link.test.ts` |

Import katalogów spraw (`lib/pipeline/caseImport.ts`, `scripts/import-cases.ts`, test `caseImport.test.ts`): każdy podkatalog z plikiem `.html`/`.htm` lub `.har` to sprawa, a nazwa katalogu to jej identyfikator. Adres strony pochodzi z komentarza „saved from url” albo z pierwszego dokumentu w HAR. Treść strony to dokument z HAR pod tym adresem (nie osadzone ramki), a gdy go nie ma, zapisana strona z usuniętym dopiskiem `.pobrane`/`.download`. Obrazy z HAR i z folderu `<nazwa>_files` trafiają do fixtures, żeby dało się policzyć hash faviconu. Rekordy A/AAAA pochodzą z HAR. `--lookups` dopisuje NS/MX/TXT/CNAME, surowy RDAP i odpowiedzi Team Cymru, a `--ct` surowy wynik crt.sh; `failedLookups` wymienia domeny bez odpowiedzi. Czas `first_seen` to najwcześniejszy wpis HAR, a bez HAR czas z nazwy zrzutu ekranu (strefa czasowa maszyny).

### 4.10 Dowody dodane 21.11.2026 (próbka organizatora)

| Element | Skąd | Waga i zniżki | Test |
|---|---|---|---|
| `platform_account`, `platform_campaign`, `page_template` | `extractLanderConfig` (`lib/osint/landerConfig.ts`), wołane z `extractPageKit` jako `PageKit.lander`: rekord `window.aio = JSON.parse('…')` platformy stron (konto `campaign.owner_uuid`, kampania `campaign.uuid` i nazwa, strona `landing.uuid` i nazwa, szablon `landing.lander_template_uuid`, źródło ruchu `source.name`) | konto 0.9 i kampania 0.95 to silne dowody (jawne identyfikatory operatora). Szablon 0.35: zestaw stron, z którego może korzystać wiele kont. Węzeł reklamy dostaje `platformAccount`, `platformCampaignName`, `landingName`, `trafficSource` i `cloakerInSource` (gdy nazwa źródła zawiera „cloak”) | `landerConfig.test.ts`, `levels.test.ts` |
| `click_server` | `clickIdsFromUrls` (`lib/osint/clickIds.ts`) na linku docelowym i przekierowaniach: wartość parametru o nazwie typu `clickid`/`subid`/`visit` w formacie xid (20 znaków base32hex) z czasem 2016–2040. Klucz to maszyna i proces | 0.6, średni: ten sam proces trackera kieruje ruch do obu stron, co nie dowodzi jednego kupującego. Węzeł reklamy dostaje `clickTime` i `clickCounter` | `clickIds.test.ts`, `levels.test.ts` |
| `meta_ad` | nowy format `fbclid` („PA…”): pole `adid` (8 bajtów) i `app_id` | 0.95, silny: ta sama kliknięta reklama. To identyfikator z Marketing API, nie z Biblioteki Reklam | `clickIds.test.ts`, `levels.test.ts` |
| Favicon podrabianej marki | `impersonatedBrand(title, url)` w `link.ts`: ostatni człon tytułu po myślniku lub kresce („… — Nazwa Portalu”), gdy domena strony go nie zawiera | czynnik `kit.brandAssetFactor` (0.1): favicon klonu serwisu to cecha marki, nie operatora | `levels.test.ts` |

---

### 4.11 Techniki strony i blok fałszywych komentarzy (`lib/osint/pageTechniques.ts`, od 21.11.2026)

`extractPageKit` dopisuje do `PageKit` pola `commentBlock` i `techniques` (`detectPageTechniques`, jeden liniowy przebieg po tagach, do 3 mln znaków i 200 tys. tagów; ten sam test odporności co reszta kitu).

- **Blok komentarzy** (`comment_block`): elementy z klasą komentarza (`comment`, `fb-comment`, `reply`, `comment-item`…, bez liczby mnogiej kontenera), w każdym pierwszy element z klasą autora (`author`, `name`, `user`, `nick`) i tekstu (`text`, `body`, `content`, `message`). Autor normalizowany (NFKC, małe litery, bez miejscowości po „·”), co najmniej 3 różnych autorów (`MIN_COMMENT_AUTHORS`). Klucz węzła to SHA-256 posortowanego zbioru autorów (16 znaków hex). Treści komentarzy zostają w danych węzła (`samples`), ale nie wchodzą do klucza: ten sam szablon na różnych domenach ma te same osoby, a w treści podmienia markę i kwoty. Strona z prawdziwą wtyczką komentarzy Facebooka (`facebook.com/plugins/comments.php` albo `fb-comments` z `data-href` i SDK) nie dostaje bloku. Waga typu 0,45; typ jest w `notAloneKinds`, więc sam blok (jak inne ślady szablonu) wymaga drugiego rodzaju dowodu, żeby połączyć kampanię. Krawędź `has_comment_block` od strony docelowej; w danych reklamy `commentBlock` (id węzła) i `fakeCommentCount`.
- **Techniki** (`technique`, węzeł na każdą technikę): `fake_app_store` (tytuł z „App Store”/„Google Play” albo klasy przycisku instalacji sklepu i napisy w rodzaju „Wybór redakcji”, „Zakupy w aplikacji”, oceny, na hoście innym niż `apple.com`/`google.com`), `back_trap` (co najmniej dwa `history.pushState` albo pętla z nim oraz obsługa `popstate`, albo skrypt `back-nav.js` i podobne), `fake_social_post` (klasy `x-post`, `tweet`, `fb-post`, `ig-post`… albo notatka autora `<!-- X-POST`, bez skryptu platformy i bez `blockquote.twitter-tweet`/`instagram-media`), `fake_comments` (jest blok komentarzy). W danych reklamy `techniques: string[]`. Waga typu 0,2, typ w `campaignRules.familyOnlyKinds`: przesłanki tego rodzaju nie liczą się do wyniku pary na poziomie kampanii (`campaignScore`), do liczby rodzajów dowodów ani do wagi w Louvainie, a liczą się do grupy podobnych kampanii (ten sam sposób działania).

## 5. Klastrowanie

`clusterCampaigns` (`cluster.ts:54`) działa na **pełnych** powiązaniach, przed przycięciem.

### 5.1 Silne dowody (union-find)

Każde powiązanie `strong` łączy obie reklamy (`cluster.ts:61-62`). Dowód jest silny, gdy encja spełnia `waga_typu × czynnik_listy ≥ 0.7` oraz `df ≤ max(2, ⌊0.5·N⌋)`, a obie ścieżki mają relację 1 (§4.3). Przy domyślnych wagach silne mogą być: url, host, domain, tracker, wallet, email, phone, telegram, endpoint z innej domeny, parametr kampanii i cert bez zniżki. Nigdy silne: ip, imagehash, cname_target, advertiser, hidden_fields, comment, domain_pattern, asset, favicon, NS, rejestrator, seria rejestracji, ASN, persona oraz podobieństwo obrazu, tekstu, DOM i dźwięku.

### 5.2 Louvain

- Graf nieskierowany, bez pętli (`cluster.ts:65`). Krawędź dostaje każde powiązanie z `score ≥ minLinkScore (0.15)` lub silne (`cluster.ts:67`). Waga to `score`, a dla silnych `max(score, 0.7)` (`cluster.ts:71`).
- `graphology-communities-louvain.detailed` z `getEdgeWeight: "weight"`, `resolution: 1.0`, `rng: mulberry32(42)`, więc wynik jest deterministyczny (`cluster.ts:77-81`, `config.ts:182`).
- Pusty graf pomija Louvaina; `modularity` jest wtedy `null`.

### 5.3 Kampanie

1. Każda składowa union-find trafia w całości do społeczności Louvaina, w której ma najwięcej członków (`cluster.ts:88-99`). Reklamy spoza grafu Louvaina tworzą własną grupę (`S<korzeń>`, `cluster.ts:91`).
2. Grupy są sortowane: rozmiar malejąco, `firstSeen` rosnąco, pierwszy członek (`cluster.ts:121`). Id to `K` + numer co najmniej dwucyfrowy (`cluster.ts:130`).
3. Atrybuty:
   - `firstSeen` = najmniejsza data, `lastSeen` = największa z `lastSeen ?? firstSeen` (porównanie ciągów ISO);
   - `cohesion` = średni `score` powiązań wewnętrznych (`cluster.ts:154`);
   - `strongComponents` = liczba składowych union-find (`cluster.ts:118`);
   - `domains` = eTLD+1 linków docelowych członków oraz domeny-pivoty z powiązań wewnętrznych;
   - `advertisers` z krawędzi `posted_by`;
   - `topEvidence` (`cluster.ts:190-223`): ≤ 6 pozycji, ranking `pokrycie × waga`, gdzie pokrycie to `członkowie z pivotem / rozmiar`, a dla podobieństwa (każdego typu `similar_*`, etykiety w `cluster.ts:225`) `min(1, pary / rozmiar)`; host apex o tych samych członkach co jego domena jest pomijany (`cluster.ts:215`);
   - `attributes` (`campaignAttributes`, `cluster.ts:237-260`): persony z liczbą reklam, liczba reklam z cyrylicą i z podejrzeniem cloakingu, najwyższy wynik deepfake.
4. Reklama bez żadnych powiązań staje się kampanią 1-elementową i też ma przydział w `assignments`.

### 5.3a Reguły kampanii i grupy podobnych kampanii (od 21.11.2026)

Opis zadania mówi o grupowaniu „w kampanie lub grupy podobnych kampanii”, więc wynik ma dwa poziomy. `campaignLinkVerdict` (`cluster.ts`) decyduje, które powiązania wchodzą do grafu Louvaina:

1. Silne powiązanie zawsze wchodzi.
2. Powiązanie poniżej `minLinkScore` nie wchodzi.
3. **Różne konta tej samej platformy stron** (`platformAccount` obu reklam, `campaignRules.accountConflict`) nie łączą się bez silnego dowodu. Wspólny zestaw stron u różnych kont to kampanie podobne, a nie jedna kampania.
4. Liczą się dowody niezdyskontowane, a zdyskontowane tylko z wagą po zniżce ≥ `campaignRules.discountedMinWeight` (0.3). Dowody co najmniej dwóch rodzajów (`minEvidenceKinds`) wystarczają. Jeden rodzaj wystarcza, chyba że należy do `notAloneKinds`: cechy zestawu stron, które sprzedaje się i używa u wielu operatorów (`similar_dom`, `comment`, `asset`, `hidden_fields`, `page_template`, `favicon`, `endpoint`, `param_schema`), oraz persona. Taki rodzaj sam musi dać wynik ≥ `singleKindMinScore` (0.5).

Grupy podobnych kampanii (`families`, identyfikatory `R01…`) to składowe spójne kampanii połączonych powiązaniami, które reguły zatrzymały, o wyniku (z dowodów liczonych jak wyżej) ≥ `familyMinScore` (0.3). Każda grupa ma `topEvidence` z powiązań między kampaniami i `apart`, czyli powód rozdzielenia (różne konta, jeden rodzaj dowodu). Kampania dostaje `familyId`. `campaigns.json` opisuje reguły w `method.rules`.

### 5.3b Duplikaty i „za mało danych” w analizie materiału (`lib/pipeline/materialVerdicts.ts`, od 21.11.2026)

Oba werdykty wylicza `analyzeMaterial` po regułach kampanii, na tym samym grafie.

**Duplikat** to ta sama reklama zebrana ponownie. Nowy rekord porównuje się z rekordami przebiegu i z wcześniejszymi rekordami tej samej paczki. Wystarczy jeden warunek:

1. **ten sam obraz**: dHash (64 bity) różni się o ≤ 4 bity (`DUPLICATE_RULES.dhashMax`) i obrazy przechodzą próbę pikselową: miniatury 64×64 w skali szarości, piksel „różny”, gdy poziom szarości zmienia się o > 40, kopia ma ≤ 0,25% różnych pikseli. Sam dHash nie wystarcza: na próbce kopia JPEG ma odległość 1, ale wariant z naklejką 2, przycięty 4, a kreacja z innym nagłówkiem 3. Próba pikselowa rozdziela je wyraźnie (kopie JPEG i rozjaśnienie: 0%, warianty: od 0,7% do 12%). Gdy któregoś pliku nie da się odczytać, liczy się tylko identyczny dHash (ten sam węzeł `imagehash`). Nie porównuje się zrzutów widoku biblioteki reklam (to głównie interfejs) ani obrazów bez struktury (dHash z ≤ 2 albo ≥ 62 jedynkami);
2. **ten sam identyfikator reklamy**: wspólny `metaAdId` (z fbclid) albo identyfikator biblioteki reklam;
3. **ta sama strona**: ten sam adres po normalizacji (bez parametrów śledzenia, `normalizeUrl`) i identyczny `domSimhash`.

Weto: para z różnymi identyfikatorami reklamy (oba znane) nie jest duplikatem z warunków 1 i 3; para z różnym hostem lub ścieżką adresu strony (oba znane) nie jest duplikatem z warunku 1; para z obrazami, które na pewno się różnią (oba są, dHash > 4 albo próba pikselowa nie przechodzi), nie jest duplikatem z warunku 3. Ten sam obraz pod innym adresem i dwie różne kreacje na tej samej stronie to dwie reklamy tej samej kampanii, nie kopia. Wyszukiwanie najpierw odsiewa pary tanim filtrem (wspólny identyfikator, ta sama strona, dHash ≤ 4), a próbę pikselową robi tylko dla kandydatów (miniatury w pamięci podręcznej). Gdy pasuje kilka oryginałów, wygrywa ten z największą liczbą warunków, potem rekord przebiegu, potem mniejsza odległość dHash, potem identyfikator. Kopia kopii wskazuje pierwszy oryginał. `reason` łączy spełnione warunki po polsku, np. „identyczny obraz i ten sam adres strony” (adres dopisuje się, gdy pasuje obok innego warunku). Duplikat dostaje kampanię oryginału (`campaign`), a przy oryginale z paczki także jego `similarCampaigns` i `newCampaign`.

**Duplikaty w przebiegu wsadowym** (`markDuplicates` w `lib/pipeline/steps.ts`, wywoływane przez `build-graph` i `pipeline` przed przycięciem grafu): te same warunki w obrębie całego zbioru. Rekordy idą w kolejności pierwszego wyświetlenia (data, potem identyfikator), każdy porównany z wcześniejszymi; kopia dostaje w danych węzła reklamy `duplicateOf: { id, reason }`, gdzie `id` to najwcześniejszy oryginał. Przeglądarka może po tym składać kopie w stosy. Na próbce syntetycznej: `c1_A_jpeg.jpg` (bez linku) jest kopią `c1_A.png`; `c1_A_bright.png` nie (inna ścieżka adresu), `c1_A_v2.png` też nie (ta sama strona, inna kreacja).

**Za mało danych** (`insufficient`), gdy jednocześnie:

- brak adresu i domeny: ani linku z danych, ani adresu z paska przeglądarki, ani URL w treści, ani zapisanej strony;
- brak identyfikatora: kontaktu, portfela, identyfikatora reklamy, konta platformy stron;
- mniej niż 5 słów treści (`MIN_CONTENT_WORDS`) w tekście, OCR i ASR po usunięciu elementów interfejsu (`contentWords` w `lib/text/uiChrome.ts`: etykiety „Sponsorowane”, przyciski wezwania do działania, „Lubię to!”, „Komentarz”, „Udostępnij” i angielskie odpowiedniki, same liczby);
- rekord nie ma powiązania ponad progiem: jest sam w swojej kampanii i nie należy do grupy podobnych kampanii.

Obraz sam nie chroni przed tym werdyktem, ale gdy połączy rekord z kampanią (np. wariant znanej kreacji), werdykt wynika z powiązania. `missing` podpowiada, co dorzucić: link do reklamy albo strony docelowej i zrzut z widocznym paskiem adresu (brak adresu), plik HAR z wizyty na stronie (brak zapisanej strony), zrzut ekranu reklamy (brak obrazu i wideo), pełną treść reklamy (mniej niż 5 słów).

### 5.4 Przycięcie `graph.json` (`lib/graph/prune.ts`)

Zapisywany jest graf przycięty (`steps.ts:195`):
- dla każdej reklamy zostaje 12 najsilniejszych powiązań (`prune.ts:16`, `prune.ts:29`), a plik zawiera sumę tych zbiorów;
- każde powiązanie ma ≤ 6 dowodów (`prune.ts:17`);
- krawędzie podobieństwa (wszystkie typy `similar_*`) zostają tylko dla zachowanych par (`prune.ts:37`), krawędzie encji zawsze;
- `stats.edges/links/strongLinks` są przeliczane.

`campaigns.json` (przydziały, `topEvidence`, `cohesion`, `attributes`) powstaje z grafu nieprzyciętego.

---

## 6. Ewaluacja

`evaluateClustering(predicted, truth)` (`lib/graph/eval.ts:51`) ocenia tylko reklamy obecne w obu mapach. Oznaczenia: n_ij to liczność przecięcia przewidzianej kampanii i i prawdziwej j, a_i to rozmiary kampanii przewidzianych, b_j prawdziwych, `C(k,2) = k(k−1)/2`.

| Metryka | Wzór | Kod |
|---|---|---|
| Pairwise | `TP = Σ C(n_ij,2)`, `P = TP / Σ C(a_i,2)` (1 gdy brak par), `R = TP / Σ C(b_j,2)` (1 gdy brak par), `F1 = 2PR/(P+R)`; `FP = Σ C(a_i,2) − TP`, `FN = Σ C(b_j,2) − TP` | `eval.ts:80-88` |
| B-cubed | `P = (1/n) Σ_x \|C(x)∩L(x)\| / \|C(x)\|`, `R = (1/n) Σ_x \|C(x)∩L(x)\| / \|L(x)\|`, F1 jak wyżej | `eval.ts:91-101` |
| ARI (Hubert–Arabie) | `E = Σ C(a_i,2)·Σ C(b_j,2) / C(n,2)`, `M = (Σ C(a_i,2) + Σ C(b_j,2)) / 2`, `ARI = (TP − E)/(M − E)`; 1 gdy mianownik 0 lub n < 2 | `eval.ts:104-112` |

Wartości są sprawdzone na przykładzie liczonym ręcznie (`eval.test.ts`). ARI zgadza się ze scikit-learn: 1/6 dla tego przykładu i 0 dla przypadku „wszystko w jednej kampanii”.

**Etykiety.** Kolumnę prawdy mapujesz na pole `label` w `ingest` (np. `"label": "kampania_prawda"`). Trafia do `item.data.label` w `graph.json`, skąd `runEvaluate` ją czyta (`steps.ts:229`). Reklamy z pustą etykietą **nie są oceniane**. Reklamy spoza kampanii muszą mieć **unikalne** etykiety (np. `N1`, `N2`), bo wspólna etykieta „brak” oznacza jedną dużą kampanię. `bun run evaluate` wypisuje też rozkład: prawdziwa kampania → kampanie przewidziane. Rozbicie jednej prawdziwej kampanii na kilka to FN, a scalenie różnych to FP.

---

## 7. LLM

LLM nie bierze udziału w wagach grafu ani w klastrowaniu. Korzystają z niego `summarize`, `build-graph --text embedding`, `llm:smoke` i opcjonalny NER person w `enrich --ner` (§4.8).

| | Ollama (domyślnie) | Anthropic |
|---|---|---|
| Wybór | `LLM_PROVIDER=ollama` (`lib/llm/index.ts:17`) | `LLM_PROVIDER=anthropic` |
| Model | `OLLAMA_MODEL`, domyślnie PLLuM `hf.co/mradermacher/PLLuM-12B-instruct-2512-GGUF:Q5_K_M` (`ollama.ts:8`); Bielik `SpeakLeash/bielik-11b-v3.0-instruct:Q5_K_M` (`ollama.ts:9`) | `ANTHROPIC_MODEL`, domyślnie `claude-opus-5-5` (`anthropic.ts:12`) |
| Czat | `POST /api/chat`, `stream:false`, `temperature` 0.2, `num_predict` przy `maxTokens` (`ollama.ts:85-96`) | `client.beta.messages.create`, `max_tokens` 16000, `output_config.effort` z `ANTHROPIC_EFFORT` (domyślnie `medium`, `anthropic.ts:70`) |
| Structured output | `format` = `z.toJSONSchema(schema)` bez `$schema`, schemat dodatkowo w wiadomości systemowej, `temperature` 0, walidacja zod, maks. 2 próby z informacją o błędzie (`ollama.ts:100-128`) | `client.beta.messages.parse` z `betaZodOutputFormat(schema)` (`anthropic.ts:104-129`); `parsed_output == null` → `LlmError` |
| Fallbacki | brak | `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"` (`anthropic.ts:13`, `:85`, `:112`); `stop_reason: "refusal"` → `LlmError` |
| Timeout | `LLM_TIMEOUT_MS` (domyślnie 180000) przez `AbortSignal.timeout` (`ollama.ts:47`, `:58`) | `timeout` klienta = `LLM_TIMEOUT_MS`, `maxRetries: 2` (`anthropic.ts:74`) |
| Błędy | `LlmError` z podpowiedzią: serwer nie odpowiada, model nie pobrany (`ollama pull …`), timeout (`ollama.ts:51-82`) | klasy SDK mapowane na `LlmError` (`anthropic.ts:34-60`) |
| Testy | mock `fetch` + **przebieg na żywo** (18.11.2026: czat, structured, embed, `summarize` dla 5 kampanii) | **wyłącznie mock** (SDK z wstrzykniętym `fetch`, `llm.test.ts`); prawdziwego API nie wywołano |

**Embeddingi.** `embed()` zawsze używa Ollamy, bo Anthropic nie ma endpointu embeddingów (`index.ts:42`). `POST /api/embed`, model `OLLAMA_EMBED_MODEL` (domyślnie `bge-m3`), partie po 32, `truncate:true`, limit 120 s na partię, sprawdzana liczba wektorów (`ollama.ts:131-148`). `build-graph --text embedding` liczy wektory raz i zapisuje je w cache (`embed`, 28 dni, klucz `model:sha256(tekst)`). Gdy embeddingi zawiodą, wraca do TF-IDF z ostrzeżeniem (`steps.ts:182-189`).

**Pomiar z 18.11.2026 na M4 Max** (pojedynczy przebieg, orientacyjnie):
- PLLuM: czat 0,3 s, structured 1,3 s;
- Bielik: czat 3,0 s (zimny start), structured 1,4 s;
- bge-m3: wymiar 1024, cos(parafraza) = 0,953, cos(inny temat) = 0,362;
- `summarize`: 5 kampanii w 41 s.

**Streszczenia** (`scripts/summarize.ts`) dostają treści reklam w znacznikach `<reklamy>`, a prompt systemowy każe traktować je jako dane, nie polecenia. NER dostaje tekst w znacznikach `<tekst>` z tym samym zastrzeżeniem (`persona.ts:295`). To ogranicza prompt injection, ale go nie wyklucza.

---

## 8. API

### 8.0 `POST /api/analyze-material` (`app/api/analyze-material/route.ts`, `lib/pipeline/analyzeMaterial.ts`)

Pliki z formularza trafiają do `.cache/uploads/<znacznik>/nowa-<czas>/` (ścieżki względne bez `..`, zip rozpakowany przez `unzip`, pojedynczy katalog najwyższego poziomu spłaszczony). Trasa uruchamia `bun scripts/analyze-material.ts` w osobnym procesie (narzędzia mediów i modele natywne zostają poza paczką serwera, limit 10 min). `analyzeMaterial`:

1. importuje sprawę (`importCases` na katalogu z dowiązaniem tylko do tej sprawy); bez plików tworzy jeden rekord z `url`/`text`;
2. wzbogaca tylko nowe rekordy: strony i obrazy z materiału, a przy `live` pozostałe zapytania pasywne (`hybridSources`: rekordy A/AAAA z HAR mają pierwszeństwo jako stan z chwili zapisu); OCR domyślnie włączony, ASR, odcisk audio i CLIP na życzenie;
3. scala z `enriched.json` przebiegu, buduje jeden graf i stosuje reguły kampanii (§5.3a);
4. dla każdego nowego rekordu: kampania z przebiegu, do której trafił (większość członków), albo grupa podobnych kampanii, albo nowa kampania; do tego ≤ 10 powiązań ze znanymi reklamami z regułą (`campaign`, `single_kind`, `account_conflict`, `below`), cechy odczytane z materiału i inne nowe rekordy tej samej kampanii (np. strony jednego lejka).

Adres z paska przeglądarki (`lib/media/addressBar.ts`, `lib/text/addressBar.ts`): górne 14% zrzutu (małe zrzuty powiększone ×2) czytane osobno przez tesseract (`--psm 6`) przed przycięciem OCR do posta; domena musi mieć sufiks z listy publicznej (tldts). Pewność `high`, gdy przed nią stoi odczytana kłódka albo pod nią nazwa przeglądarki w aplikacji (Instagram, Facebook…). Strony platform (facebook.com, instagram.com…) są zapisywane, ale nie stają się adresem strony. Nagranie ekranu w pionie: klatka co 4 s (ffmpeg, maks. 120), kolejne zmiany adresu z czasem w sekundach. Adres strony bierze się z danych wejściowych, potem z tekstu reklamy, potem z paska (`landingSource`). Fragment adresu (`#tickets`) zostaje w `NormalizedUrl.fragment`.

### 8.0a Pola wyniku `analyzeMaterial` dla przeglądarki (od 21.11.2026)

Wszystkie pola z tej listy są opcjonalne: przeglądarka działa także na wyniku bez nich.

- `MaterialLink.evidence[]`: oprócz `evidence`, `weight`, `strong`, `discounted` każda przesłanka ma `kind` (`pivot` albo `similarity`), `pivotType` (typ wspólnego węzła, np. `domain`, `page_template`), `edgeType` (np. `similar_image`, `similar_text`) i `pivot` (identyfikator węzła, np. `domain:przyklad.test`), tak jak `PairEvidence` w `graph.json`. Dzięki temu przeglądarka odróżnia sam szablon strony od mocnego śladu infrastruktury.

- `MaterialInput.caseDirs?: string[]`: paczka spraw. Wszystkie idą przez jeden import (`importCases` na katalogu z dowiązaniami; powtórzona nazwa katalogu dostaje `-2`) i jeden graf, więc nowe materiały porównują się także między sobą. `caseDir` działa jak dotąd (paczka z jedną sprawą). `url` i `text` przy jednej sprawie uzupełniają jej rekordy, przy kilku stają się osobnym rekordem `nowa-reklama`.
- `MaterialItemResult.caseId`: nazwa katalogu sprawy, z której pochodzi rekord (dla samego linku lub tekstu: identyfikator rekordu).
- `MaterialResult.newCampaigns?: Array<{ id, members, evidence }>` i `MaterialItemResult.newCampaign`: kampanie złożone wyłącznie z nowych rekordów (co najmniej dwóch), numerowane `N1`, `N2`… w kolejności rekordów. `evidence` to etykiety `topEvidence` tej kampanii. Pojedynczy nowy rekord bez powiązań nie dostaje numeru (`newCampaign: null`).
- `MaterialVerdict` ma dwa nowe stany: `duplicate` (pole `duplicateOf: { id, reason }`, `campaign` jak u oryginału) i `insufficient` (pole `missing: string[]`). Reguły w §5.3b. `missing` dostaje też werdykt `new_campaign`, gdy czegoś brakuje (np. adresu strony).

- Wynik partii w CSV (`lib/pipeline/materialCsv.ts`, `--csv` w `analyze-material`). Kolumny w stałej kolejności (ten sam format eksportuje przeglądarka): `material_id, case, verdict, campaign_id, similar_campaigns, new_campaign_id, duplicate_of, confidence, score, top_premise, missing_data`. Listy w komórce rozdziela `;` (`similar_campaigns`) albo `; ` (`missing_data`). `score` i `top_premise` pochodzą z najlepszego powiązania z kampanią rekordu (przy `similar_campaigns` z którąś z podobnych kampanii); u duplikatu `top_premise` to „duplikat <id>: <powód>”. `confidence`: `certain`, gdy to powiązanie ma przesłankę silną albo o wadze ≥ 0,7 (duplikat z kampanią też jest `certain`, bo to ta sama reklama), `likely` przy wyniku powiązania ≥ 0,5, `uncertain` w pozostałych przypadkach, także bez kampanii (`new_campaign`, `insufficient`). Flaga `--json` przyjmuje teraz ścieżkę pliku (dawniej przełącznik wypisujący wynik na stdout; to samo daje `--json -`).

- `MaterialItemResult.fakeComments?: { count, repeatedInOtherItems }`: liczba komentarzy w bloku na stronie i liczba innych rekordów (przebiegu i paczki) z tym samym blokiem (`df` węzła `comment_block` minus 1). `MaterialItemResult.techniques?: string[]` (także w `features.techniques`): techniki strony z §4.11.

- `MaterialInput.datasetFile?: string` (i `datasetMapping?: string`): plik zbioru `.csv`, `.tsv`, `.json` albo `.jsonl`. Każdy wiersz staje się materiałem przez `loadRecords` i `normalizeRecords` z `lib/pipeline/ingest.ts` (to samo mapowanie kolumn co `bun run ingest`: automatyczne albo z pliku mapowania). Względne ścieżki obrazów, wideo i dodatkowych zrzutów są rozwiązywane względem katalogu pliku; wartość kolumny obrazu, która nie jest adresem http(s), traktowana jest jak ścieżka. `caseId` wiersza to kolumna `case`, a bez niej identyfikator wiersza. Plik zbioru można łączyć ze sprawami (`caseDirs`) w jednym przebiegu.

- `MaterialItemResult.pivots?: Array<{ id, type, label, weight, strong, discounted, discountReasons, df, sharedWith, data }>`: cechy rekordu, czyli pivoty z `buildEvidenceGraph(..., { includeItemPivots: true })`, posortowane: silne, potem waga. `weight`, `strong` i rabaty pochodzą z węzła grafu scalonego (przebieg + paczka); `strong` i `discounted` uwzględniają też relację pośrednią (np. link wychodzący ×0,5, opisany w `discountReasons`). `df` i `sharedWith` liczone są tylko względem bazy: ile rekordów przebiegu ma tę cechę i które to są (`sharedWith` do 100 identyfikatorów, `df` pełna liczba). `data` to dane węzła bez `weightParts`; dla domen zawiera `created` (data rejestracji z RDAP).

- `MaterialContext.onProgress?: (e: { caseId, step, status, detail? }) => void`: postęp na sprawę. Kroki: `import`, `ocr`, `address_bar`, `asr`, `audio`, `clip`, `lookups`, `features` (budowa grafu), `compare` (reguły kampanii), `group` (kampanie nowych rekordów, duplikaty, „za mało danych”). Import zgłasza `start` przed `importCases` i `done` (liczba rekordów) albo `skipped` (powód z importera) po nim. Kroki mediów i zapytań zgłaszają `start` przed wzbogacaniem całej paczki, a wynik po nim, na podstawie tego, co wzbogacanie dało: `skipped` z powodem („OCR wyłączony”, „brak obrazu”, „brak wideo”, „tryb offline: bez zapytań sieciowych…”, niedostępne narzędzie), `error` z komunikatem, `done` (ze szczegółem, gdy krok niczego nie znalazł, np. „brak paska adresu na zrzutach”). `features`, `compare` i `group` zgłaszają `start` i `done` dla każdej sprawy (`group` z listą werdyktów). Sprawa bez rekordów po imporcie nie dostaje dalszych zdarzeń. Wyjątek w słuchaczu nie przerywa analizy.
- `MaterialItemResult.faces?` (typ zarezerwowany pod wykrywanie twarzy: `{ image, x, y, w, h, persona?, similarity? }`): w potoku nie ma jeszcze wykrywania twarzy, więc pole nie jest wypełniane.

### 8.1 `POST /api/analyze` (`app/api/analyze/route.ts`)

Wejście (zod, `app/api/analyze/route.ts:13-20`): `{ url?: string ≤ 2048, text?: string ≤ 5000, imageUrl?: string ≤ 2048, offline?: boolean }`. Wymagane jest co najmniej jedno z `url`, `text`, `imageUrl`. Błąd walidacji → 400, brak `graph.json` → 503, wyjątek → 500.

Przebieg (`lib/pipeline/analyze.ts:91`):
1. Źródła: `offline` (albo `ANALYZE_OFFLINE=1`) korzysta z `data/sample/fixtures`, w przeciwnym razie `liveSources({skipCt:true})`, czyli bez crt.sh (`app/api/analyze/route.ts:36-37`). Konfiguracja wag pochodzi z `LINK_CONFIG` albo `data/sample/linking.json` (`app/api/analyze/route.ts:38`).
2. `enrichItems` dla jednej reklamy o id `nowa-reklama`, potem `buildEvidenceGraph(..., includeItemPivots)` (`analyze.ts:114`). Nowe pivoty (backend, kit, parametry kampanii, CNAME) są porównywane tak samo jak pozostałe, po id węzła; listy person, OCR, ASR i test cloakingu nie są tu uruchamiane.
3. Dla każdego pivotu, który istnieje w `graph.json` (to samo id węzła), wszystkie reklamy z tym węzłem dostają dowód o wadze `waga_zapisanego_węzła × relacja_nowej` (`analyze.ts:132`). Relacja drugiej reklamy jest ignorowana, a idf pochodzi z oryginalnego zbioru. To przybliżenie.
4. Obraz: Hamming do `data.dhash` reklam, ten sam próg i wzór co w §4.5 (`analyze.ts:142-149`). Simhash DOM nie jest porównywany.
5. Tekst: TF-IDF dopasowany do tekstów reklam z grafu (ucięte do 600 znaków, `link.ts:138`) plus nowy tekst (`analyze.ts:150-162`).
6. Wynik pary to noisy-OR, wynik kampanii to najlepsza para, czyli najbliższy sąsiad (`analyze.ts:164-176`). Kandydaci z `score ≥ 0.05` lub silni, maks. 5 (`analyze.ts:194-196`). `best` to pierwszy silny kandydat albo pierwszy z `score ≥ minLinkScore` (`analyze.ts:197`).

Wyjście `AnalyzeResult` (`analyze.ts:41`):
- `input`, `mode`;
- `enrichment {landingUrl, finalUrl, redirectChain[], status, title, trackers[], ips[], domains[], contacts[], wallets[], imageDhash, errors[]}`;
- `best`, `candidates[{campaignId, size, score, strong, nearestItem, evidence[{evidence, weight, strong, discounted, items[]}] (≤ 8)}]`;
- `verdict` (tekst PL).

### 8.2 `GET /api/image?id=<itemId>` (`app/api/image/route.ts`)

Szuka reklamy w `graph.json` i rozwiązuje `data.imagePath` względem `graph.baseDir`. Obsługuje tylko pliki wewnątrz `baseDir` (`app/api/image/route.ts:22`) z rozszerzeniami png/jpg/jpeg/gif/webp (`app/api/image/route.ts:9`). Odpowiedzi: 400 bez `id`, 404 dla nieznanej reklamy lub braku pliku, 403 poza katalogiem lub dla innego typu, `cache-control: public, max-age=3600`.

### 8.3 `GET /api/ct-feed?limit=50` (`app/api/ct-feed/route.ts`)

Zwraca `{feed, records, updatedAt}`: najnowsze wpisy feedu watchera CT (§16.6), najnowsze pierwsze. `limit` 1–500, domyślnie 50 (`app/api/ct-feed/route.ts:10`). Plik: `CT_FEED_FILE` albo `data/ct-watch.jsonl`, czytany przy każdym żądaniu (`app/api/ct-feed/route.ts:11-16`), z końca pliku, maks. 4 MiB (`lib/ct/feed.ts:81`). Brak pliku albo pusty plik daje `records: []`, błąd odczytu też `records: []` z polem `error`. `cache-control: no-store`.

### 8.4 Ochrona i jej braki

- W trybie live `/api/analyze` pobiera adresy od użytkownika przez `fetchPage` i `fetchBinary` z ochroną SSRF (§11).
- **Nie ma limitowania zapytań, uwierzytelniania ani kolejki.** Każde żądanie live wykonuje zapytania DNS/RDAP/ASN i GET-y. Przed publicznym wdrożeniem trzeba dodać rate limit albo ustawić `ANALYZE_OFFLINE=1`.
- `/api/ct-feed` tylko czyta lokalny plik i niczego nie pobiera z sieci.

---

## 9. CLI

Uruchomienie: `bun run <skrypt> [--flagi]` lub `bun run <skrypt> -- --flagi`; obie formy działają. Skrypty z flagami (wszystkie poza `llm:smoke`, `media:smoke` i `sample:generate`) mają `--help`.

| Skrypt | Flagi (domyślnie) | Przykład |
|---|---|---|
| `import-cases` | `--cases` (katalog spraw, wymagane), `--out` (katalog roboczy, wymagane), `--lookups` (pasywne DNS, RDAP, ASN dla domen stron), `--ct` (także crt.sh) | `bun run import-cases -- --cases sprawy/ --out praca/ --lookups` |
| `ingest` | `--input` (`data/sample/ads.csv`), `--mapping` (`data/sample/mapping.json` tylko bez `--input`; z `--input` mapowanie automatyczne), `--out` (`data/work/items.json`), `--base-dir` (katalog pliku) | `bun run ingest -- --input nask.csv --mapping nask-mapping.json --base-dir ./nask` |
| `enrich` | `--items`, `--out` (`data/work/enriched.json`), `--offline`, `--fixtures` (`data/sample/fixtures`), `--concurrency` (4), `--skip` (lista: `page,favicon,image,dns,rdap,ct,asn`), `--personas` (bez `--items`: `data/sample/personas.json`), `--ner`, `--cloaking`, `--ocr`, `--asr`, `--audio`, `--archive` (`data/work/archive`) / `--no-archive` | `bun run enrich -- --skip ct` · `bun run enrich -- --offline --cloaking --ocr --audio` |
| `build-graph` | `--enriched`, `--graph` (`data/graph.json`), `--campaigns` (`data/campaigns.json`), `--config` (**domyślnie `data/sample/linking.json`**), `--text` (`tfidf`; też `TEXT_SIMILARITY`) | `bun run build-graph -- --config recall.json --text embedding` |
| `evaluate` | `--graph`, `--campaigns`, `--json` | `bun run evaluate -- --json > metryki.json` |
| `pipeline` | `--input`, `--mapping`, `--offline`, `--fixtures`, `--config` (z próbką: `data/sample/linking.json`; z `--input`: domyślne), `--text`, `--concurrency`, `--skip`, `--personas` (z próbką: `data/sample/personas.json`), `--ner`, `--cloaking`, `--ocr`, `--asr`, `--audio`; archiwum HTML zawsze w `data/work/archive` | `bun run pipeline --offline` · `bun run pipeline -- --input nask.csv --mapping m.json --skip ct` |
| `summarize` | `--graph`, `--campaigns`, `--out` (`data/summaries.json`), `--campaign K01`, `--limit N`, `--all` (też kampanie 1-elementowe) | `LLM_PROVIDER=ollama bun run summarize -- --limit 10` |
| `evidence` | `--campaign` (wymagane), `--out` (`data/evidence/<kampania>`), `--graph`, `--campaigns`, `--enriched` (`data/work/enriched.json`), `--config`, `--tlp` (`TLP:AMBER`), `--submitter-name`, `--submitter-email`, `--submitter-address`, `--submitter-role` | `bun run evidence -- --campaign K01 --submitter-name "…" --submitter-email "…"` |
| `ct:watch` | `--campaigns`, `--graph`, `--lexicon` (`data/sample/ct-lexicon.json`), `--config`, `--url` (`ws://127.0.0.1:8181/,wss://certstream.calidog.io/`; też `CT_STREAM_URL`), `--duration` (s), `--threshold` (0.6), `--feed` (`data/ct-watch.jsonl`; też `CT_FEED_FILE`), `--no-enrich`, `--fetch-page`, `--offline`, `--dry-run`, `--max-enrich-per-min` (30), `--replay plik.jsonl` | `bun run ct:watch -- --duration 300` · `bun run ct:watch -- --replay data/sample/ct-stream.jsonl` |
| `ct:backfill` | `--pattern` (lista; bez niej z szablonów kampanii), `--since` (7 dni), `--campaigns`, `--graph`, `--lexicon`, `--config`, `--threshold`, `--feed`, `--include-expired`, `--no-enrich`, `--fetch-page`, `--offline`, `--dry-run` | `bun run ct:backfill -- --pattern 'zwrot%' --no-enrich` |
| `analyze-material` | jedno lub kilka z: `--case` (katalog sprawy), `--cases` (katalog partii: każdy podkatalog to sprawa; `--each-file`: także każdy luźny plik jako osobna sprawa), `--dataset` (plik zbioru `.csv`/`.tsv`/`.json`/`.jsonl`, wiersz = materiał; `--mapping` jak w `ingest`), `--url`, `--text`; `--data` (`VIEWER_DATA_DIR` albo `data/`), `--csv` (wiersz na rekord), `--json` (pełny `MaterialResult`; `-` = stdout), `--out` (to samo, używa przeglądarka), `--work`, `--config`, `--personas`, `--fixtures`, `--live`, `--asr`, `--audio`, `--clip`, `--speaker`, `--ad-library` | `bun run analyze-material -- --cases partia/ --csv wynik.csv --json wynik.json` |
| `llm:smoke` | brak | `OLLAMA_MODEL=SpeakLeash/bielik-11b-v3.0-instruct:Q5_K_M bun run llm:smoke` |
| `media:smoke` | brak; OCR obrazu z polskim tekstem, ASR mowy z `say -v Zosia` (macOS) po konwersji do WAV 16 kHz, odciski Chromaprint; brakujące narzędzia są zgłaszane i pomijane, kod wyjścia zawsze 0 | `bun run media:smoke` |
| `sample:generate` | brak; **kasuje i odtwarza `data/sample/`** | `bun run sample:generate && bun run pipeline --offline` |
| `test` / `test:watch` | vitest | `bun run test` |
| `lint`, `typecheck`, `build`, `dev`, `start` | standard Next.js | `PORT=3001 bun run start` |

`pipeline` zawsze zapisuje do domyślnych ścieżek z `steps.ts:22-37`, więc nadpisuje `data/graph.json` i `data/campaigns.json`. Eksperymenty kieruj przez `build-graph --graph/--campaigns` do innych plików. `ct:watch` kończy się kodem 2, gdy żaden strumień CT nie przysłał danych (`scripts/ct-watch.ts:94`), a `ct:backfill`, gdy żaden wzorzec nie dał odpowiedzi (`scripts/ct-backfill.ts:69`).

---

## 10. Konfiguracja

### 10.1 Zmienne środowiskowe (wszystkie odczyty w kodzie)

| Zmienna | Domyślnie | Odczyt | Działanie |
|---|---|---|---|
| `LLM_PROVIDER` | `ollama` | `lib/llm/index.ts:17` | `ollama` / `anthropic` (inna wartość → błąd) |
| `OLLAMA_HOST` | `http://localhost:11434` | `ollama.ts:32` | |
| `OLLAMA_MODEL` | PLLuM | `ollama.ts:45` | |
| `OLLAMA_EMBED_MODEL` | `bge-m3` | `ollama.ts:46`, `steps.ts:156` | |
| `LLM_TIMEOUT_MS` | 180000 | `ollama.ts:47`, `anthropic.ts:74` | |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | `anthropic.ts:69` | |
| `ANTHROPIC_EFFORT` | `medium` | `anthropic.ts:70` | `low`…`max` |
| `ANTHROPIC_API_KEY` | — | SDK | albo `ANTHROPIC_AUTH_TOKEN` / profil `ant auth login` |
| `TEXT_SIMILARITY` | `tfidf` | `scripts/build-graph.ts:17`, `scripts/pipeline.ts:54` | gdy brak `--text` |
| `CACHE_DIR` | `./.cache` | `cache.ts:56` | |
| `CACHE` | włączony | `cache.ts:60` | `off/0/false/no` wyłącza |
| `CT` | włączony | `sources.ts:47` | `off/0/false/no` pomija crt.sh |
| `DNS_SERVERS` | systemowe | `dns.ts:62` | lista IP po przecinku |
| `FETCH_INSECURE_TLS` | `0` | `fetchPage.ts:197` | `1` akceptuje nieważne certyfikaty TLS |
| `ANALYZE_OFFLINE` | `0` | `app/api/analyze/route.ts:36` | `1` = `/api/analyze` tylko z fixtures |
| `LINK_CONFIG` | `data/sample/linking.json` | `app/api/analyze/route.ts:38` | konfiguracja wag dla `/api/analyze` |
| `WHISPER_MODEL` | `~/models/whisper/ggml-large-v3-turbo.bin` | `lib/media/asr.ts:26` | model whisper.cpp dla ASR |
| `MLX_WHISPER_MODEL` | `mlx-community/whisper-large-v3-turbo` | `asr.ts:30` | tylko gdy brak whisper-cli i model jest już lokalnie |
| `HF_HUB_CACHE` / `HF_HOME` | `~/.cache/huggingface` | `asr.ts:45` | gdzie szukać lokalnego modelu mlx |
| `CT_STREAM_URL` | `ws://127.0.0.1:8181/,wss://certstream.calidog.io/` | `scripts/ct-watch.ts:52` | strumienie CT w kolejności prób |
| `CT_FEED_FILE` | `data/ct-watch.jsonl` | `scripts/ct-watch.ts:47`, `scripts/ct-backfill.ts:46`, `app/api/ct-feed/route.ts:11` | feed kandydatów |

`.env.example` opisuje zmienne LLM, grafu, wzbogacania, API, adapterów mediów (`WHISPER_MODEL`, `MLX_WHISPER_MODEL`) i watchera CT (`CT_STREAM_URL`, `CT_FEED_FILE`).

### 10.2 Plik konfiguracji linkowania (`--config plik.json`)

`mergeConfig` (`lib/graph/config.ts:698`) łączy obiekty rekurencyjnie i podmienia wartości proste. Tablice w `lists` są **dopisywane** do domyślnych, chyba że ustawisz `"replaceLists": true` (`config.ts:700-702`). Inne tablice są podmieniane. Bez `--config` w `pipeline` z `--input` obowiązują same wartości domyślne.

| Parametr | Domyślnie | `config.ts` | Efekt podniesienia |
|---|---|---|---|
| `typeWeights.<typ>` | §4.1 | `config.ts:127-155` | większy wpływ typu; ≥ 0.7 robi typ silnym |
| `strongThreshold` | 0.7 | `config.ts:156` | mniej silnych dowodów, mniej scaleń przez union-find |
| `maxStrongDfRatio` | 0.5 | `config.ts:157` | encja w większym odsetku reklam nadal może być silna |
| `maxPivotDf` | 400 | `config.ts:158` | encje o większym df nadal tworzą pary (koszt O(df²)) |
| `idf.enabled` / `idf.floor` | true / 0.2 | `config.ts:159` | podłoga ogranicza karę za częstość; `enabled: false` wyłącza też karę za powszechność |
| `idf.ubiquityStart` / `idf.ubiquityMinItems` | 0.5 / 10 | `config.ts:159` | od jakiego odsetka reklam i od jakiej wielkości zbioru działa kara za powszechność |
| `minLinkScore` | 0.15 | `config.ts:160` | słabsze powiązania nie wchodzą do Louvaina: mniej FP, więcej FN |
| `similarity.imageHamming` | 10 | `config.ts:162` | więcej par obrazów: więcej TP i FP |
| `similarity.imageWeight` | 0.6 | `config.ts:163` | |
| `similarity.text.tfidfThreshold` | 0.5 | `config.ts:164` | mniej par tekstów |
| `similarity.text.embeddingThreshold` | 0.86 | `config.ts:164` | |
| `similarity.text.weight` / `minChars` | 0.5 / 25 | `config.ts:164` | |
| `similarity.dom.hamming` / `weight` | 6 / 0.45 | `config.ts:165` | więcej par stron o podobnym szablonie |
| `similarity.audio.minSimilarity` / `weight` | 0.85 / 0.5 | `config.ts:166` | wyższy próg = tylko prawie identyczne nagrania |
| `kit.sameOriginEndpointFactor` / `shortEndpointPathFactor` | 0.4 / 0.5 | `config.ts:169-170` | większy wpływ ścieżek backendu na tej samej domenie |
| `kit.minHiddenFields` | 2 | `config.ts:171` | ile specyficznych ukrytych pól tworzy pivot |
| `kit.domainPatternMinDomains` / `domainPatternMinLiteralChars` | 2 / 3 | `config.ts:172-173` | ile domen musi dzielić szablon; ile liter musi mieć rdzeń |
| `kit.domainPatternNoAnchorFactor` / `domainPatternAgnosticFactor` | 0.3 / 0.85 | `config.ts:174-175` | |
| `kit.campaignParamWordFactor` | 0.75 | `config.ts:176` | zniżka wartości słownych parametrów kampanii |
| `outboundLinkFactor` | 0.4 | `config.ts:178` | |
| `registrationBurstHours` / `registrationBurstWeight` | 48 / 0.3 | `config.ts:179-180` | |
| `maxCertDomains` | 25 | `config.ts:181` | |
| `louvain.resolution` / `seed` | 1.0 / 42 | `config.ts:182` | wyższa rozdzielczość = mniejsze kampanie |
| `lists.*` | §4.4 | `config.ts:183-673` | |

Przykład próbki: `data/sample/linking.json` dopisuje fikcyjny skracacz `krotki.test` (factor 0), NS `vps-demo.test` (0.1) i komentarz-znacznik generatora próbki (0). Bez tego pliku pairwise F1 na próbce wynosi 0.977 zamiast 1.0 (sprawdzone 19.11.2026; decyduje wpis skracacza, sam znacznik tłumi już kara za powszechność).

### 10.3 Stałe w kodzie (bez pliku konfiguracji)

| Stała | Wartość | Miejsce |
|---|---|---|
| budżet czasu / limit bajtów / przekierowania strony | 8 s / 2 MiB / 8 | `fetchPage.ts:347-349` |
| limit pliku binarnego (obraz, favicon) | 5 MiB | `fetchPage.ts:476` |
| meta refresh śledzony do | 10 s | `fetchPage.ts:433` |
| timeout DNS / RDAP / CT | 5 s / 10 s / 30 s | `dns.ts:50`, `rdap.ts:203`, `ct.ts:235` |
| ponowienia CT / opóźnienie bazowe / maks. Retry-After / maks. certyfikatów | 3 / 2 s / 60 s / 200 (wzorzec: 1000) | `ct.ts:236-238`, `ct.ts:52`, `ct.ts:229` |
| współbieżność: reklamy / DNS i ASN / RDAP / CT / NER / media | 4 / 8 / 2 / 1 / 1 / 2 | `enrich.ts:101-106` |
| łańcuch CNAME | maks. 4 skoki | `enrich.ts:373` |
| User-Agenty testu cloakingu / próg simhash DOM | crawler Meta, iPhone Safari / 12 bitów | `enrich.ts:48-50`, `enrich.ts:113` |
| limity czasu OCR / ASR / fpcalc / ffmpeg | 60 s / 10 min / 60 s / 120 s | `ocr.ts:52`, `asr.ts:151`, `audioFp.ts:31`, `asr.ts:84` |
| kit strony: backendy / pliki / ukryte pola / komentarze / min. tagów simhash | 50 / 100 / 100 / 50 / 25 | `pagekit.ts:66-75` |
| TTL cache | §3.3 | |
| maks. pikseli obrazu | 50 Mpx | `imageHash.ts:35` |
| `visibleText` / `outboundUrls` | 5000 znaków / 300 | `extract.ts:65-66` |
| odrzucanie słabych powiązań | `score < 0.05` | `link.ts:668` |
| przycięcie zapisu: powiązania / dowody | 12 / 6 | `prune.ts:16-17` |
| `topEvidence` kampanii | 6 | `cluster.ts:222` |
| `/api/analyze`: kandydaci / dowody / limity wejścia | 5 / 8 / 2048·5000·2048 znaków | `analyze.ts:190-196`, `app/api/analyze/route.ts:15-17` |
| tekst reklamy, OCR i ASR zapisany w węźle | 600 znaków | `link.ts:138` |
| paczka dowodów: domen na jedno zgłoszenie do CERT | 50 | `lib/evidence/pack.ts:406` |
| watcher CT | §16.8 | |

### 10.4 Konfiguracja watchera CT (`--lexicon plik.json`)

`lib/ct/config.ts` ma własny plik konfiguracji, niezależny od `linking.json`. `mergeCtConfig` (`lib/ct/config.ts:117`) waliduje go zod. Listy leksykonu są dopisywane do domyślnych, chyba że `"replaceDefaultLexicon": true` (`lib/ct/config.ts:123`). Brak pliku daje wartości domyślne (`lib/ct/config.ts:138`).

| Parametr | Domyślnie | `lib/ct/config.ts` | Znaczenie |
|---|---|---|---|
| `threshold` | 0.6 | `lib/ct/config.ts:59` | minimalny wynik kandydata |
| `scores.template` / `templateOtherTld` | 0.9 / 0.8 | `lib/ct/config.ts:61-62` | ten sam szablon nazwy z tym samym / innym TLD |
| `scores.brand` / `media` | 0.7 / 0.65 | `lib/ct/config.ts:63-64` | marka z leksykonu / medium z leksykonu w kontekście kampanii |
| `scores.loremKit` / `loremKitOtherTld` | 0.6 / 0.5 | `lib/ct/config.ts:65-66` | ten sam generator nazw z innym słowem kotwicy |
| `scores.supportBonus` / `tokenBonus` | 0.05 / 0.05 | `lib/ct/config.ts:67-68` | szablon z ≥ 2 domen kampanii; słowo wspierające (maks. 2) |
| `minTemplateLiteralChars` / `minBrandLength` / `minCampaignTokenLength` | 3 / 5 / 4 | `lib/ct/config.ts:70-72` | |
| `lexicon.brands` | pusta | `lib/ct/config.ts:74` | marki wymyślone lub podrabiane przez kampanie (ustawiane na zbiór) |
| `lexicon.media` / `institutions` / `lures` | ogólne słowa PL | `lib/ct/config.ts:75-77` | media (`wiadomosci`, `fakty`, `news`…), instytucje (`gov`, `zus`, `knf`, `bank`…), przynęty (`inwest`, `zysk`, `krypto`, `zwrot`, `doplat`…) |
| `stopTokens` / `ignoreDomains` | słowa zbyt ogólne / pusta | `lib/ct/config.ts:79` | |

Próbka: `data/sample/ct-lexicon.json` dodaje fikcyjne marki „KryptoZysk” i „Bałtycka Energia” oraz media „fakt” i „wiadomosci”.

---

## 11. Bezpieczeństwo

| Obszar | Co jest zaimplementowane | Gdzie |
|---|---|---|
| Tylko pasywne zapytania | DNS (z łańcuchem CNAME), RDAP, crt.sh, Team Cymru (DNS TXT), jeden GET na stronę i każde przekierowanie, GET faviconu i obrazu. Test cloakingu to dwa dodatkowe zwykłe GET-y na stronę, tylko z flagą `--cloaking`. Watcher CT czyta strumień logów CT i crt.sh, a stronę pobiera tylko z `--fetch-page`. Bez skanowania portów, bez sond, bez wysyłania formularzy. | `lib/pipeline/sources.ts:45-63`, `lib/pipeline/enrich.ts:157-168`, `lib/ct/enrich.ts:63` |
| Schematy | tylko http(s), sprawdzane na każdym skoku; przekierowanie na `file:`/`ftp:` → `blocked` | `fetchPage.ts:399` |
| SSRF: literały IP | IP prywatne, loopback, link-local (z metadata 169.254.169.254), CGNAT, dokumentacyjne, multicast i zarezerwowane, w tym IPv6 i IPv4 osadzone w IPv6, blokowane przed połączeniem | `fetchPage.ts:140-150`, `ip.ts:179-253` |
| SSRF: nazwy | `localhost`, `*.local`, `*.internal` blokowane; zwykły DNS zastąpiony w gnieździe `lookup` sprawdzającym **wszystkie** zwrócone adresy, więc odpowiedź DNS-rebinding nie wejdzie między sprawdzenie a połączenie; `agent: false` wymusza nowe połączenie przez strażnika na każdym żądaniu. Te same zabezpieczenia obowiązują GET-y testu cloakingu i `--fetch-page` watchera CT | `fetchPage.ts:157-190`, `fetchPage.ts:224-225` |
| Wyjątek testowy | `unsafeAllowPrivateNetworks` wyłącza strażnika; używają go tylko testy, nie jest dostępny przez CLI ani API | `fetchPage.ts:99`, `fetchPage.ts:353` |
| Bez wykonywania JS | strona to tekst; meta refresh i `jsRedirects` wykrywane regexem, kit strony statycznym skanerem; `jsRedirects` nie są śledzone ani używane | `fetchPage.ts:304`, `extract.ts:608`, `pagekit.ts:1-14` |
| Narzędzia zewnętrzne | tesseract, whisper-cli, ffmpeg i fpcalc działają lokalnie przez `execFile` bez powłoki, z limitem czasu; modele muszą już być na dysku (nic nie jest pobierane) | `lib/media/tools.ts:29-61`, `lib/media/asr.ts:42-49` |
| Lokalny serwer CT | `certstream-server-go` w Dockerze publikuje port tylko na `127.0.0.1:8181`; `recovery` wyłączone, żeby nie pobierać historii logów od indeksu 0 | `docker-compose.yml:36-43`, `docker/certstream/config.yaml:36-37` |
| Limity | czas, bajty po dekompresji (bomba gzip), liczba przekierowań, piksele obrazu, wielkość wejścia API, limity kitu strony, limit wzbogaceń watchera na minutę | §10.3 |
| TLS | domyślnie weryfikacja certyfikatów; `FETCH_INSECURE_TLS=1` ją wyłącza | `fetchPage.ts:197`, `fetchPage.ts:226` |
| Prywatność | live nie wysyła IP niepublicznych do Team Cymru; nic nie trafia do innych usług niż wymienione i skonfigurowany LLM (streszczenia, embeddingi, opcjonalny NER) | `enrich.ts:440` |
| Biometria | brak: persona tylko z tekstu i danych wejściowych; paczka dowodów nie zawiera wzorców twarzy ani głosu | §4.8, §15 |
| Pliki | `/api/image` serwuje tylko obrazy wewnątrz `baseDir` (ochrona przed path traversal) | `app/api/image/route.ts:20-22` |
| Dane | `.cache/` zawiera surowe HTML pobranych stron i wyniki zapytań, `data/work/` pełne wzbogacenie i archiwum HTML, `data/evidence/` paczki dowodów, `data/ct-watch.jsonl` feed; wszystkie w `.gitignore`, `.env*` też (poza `.env.example`) | `.gitignore` |
| Braki | brak rate limitu i uwierzytelnienia w API (§8.4); prompt injection w streszczeniach i NER tylko ograniczone (§7) | |

---

## 12. Testy

`bun run test`: 32 pliki, 392 testy, wszystkie przechodzą (stan z commitu `e132a5d`, 19.11.2026). Testy nie korzystają z sieci (`vitest.config.mts` ustawia `CACHE=off`). Wyjątek: lokalny serwer HTTP na 127.0.0.1 w `fetchPage.test.ts`. Trzy testy uruchamiają lokalne narzędzia (tesseract, fpcalc) i są pomijane, gdy narzędzia nie ma (`it.skipIf`); na maszynie z narzędziami przechodzą wszystkie.

| Plik | Testy | Pokrycie |
|---|---|---|
| `lib/osint/extract.test.ts` | 40 | trackery (pozytywne i negatywne), encje HTML, e-maile, telefony PL, Telegram, WhatsApp, realistyczna strona, przypadki brzegowe (w tym 2 MB patologicznego HTML w czasie liniowym) |
| `lib/text/persona.test.ts` | 30 | odmiana polska, slug, lista obserwowanych, tryb przybliżony („Rafałem Brzosku” → „Rafał Brzoska”, bez nadmiernych dopasowań), kolumna wejściowa, NER z mockiem LLM |
| `lib/osint/pagekit.test.ts` | 28 | form/fetch/XHR/axios/jQuery i literały API, `<base href>`, normalizacja ścieżek, simhash DOM, ukryte pola, pliki, komentarze i cyrylica, odporność na zepsuty HTML |
| `lib/osint/campaignParams.test.ts` | 25 | aliasy nazw, cyrylica, makra, deduplikacja w łańcuchu, fragmenty URL |
| `lib/osint/ip.test.ts` | 23 | parsowanie v4/v6, CIDR, klasyfikacja zakresów SSRF, odwracanie adresów |
| `lib/osint/crypto.test.ts` | 20 | wektory BTC/bech32/bech32m/EIP-55/TRON (poprawne i z błędną sumą), `findWallets` |
| `lib/osint/fetchPage.test.ts` | 20 | łańcuchy 301/302, meta refresh, pętle, limit przekierowań, blokada schematów, windows-1250; SSRF dla literałów, DNS prywatnego i odpowiedzi mieszanej; lokalny serwer: gzip, limit bajtów, bomba gzip, timeout, binaria |
| `lib/graph/kitLink.test.ts` | 15 | nowe pivoty i ich zniżki: silny backend z innej domeny; publiczny serwis formularzy (także link wychodzący) **nie scala**; ścieżki ogólne i specyficzne; ukryte pola; biblioteki i własne pliki; komentarze i cyrylica; simhash DOM; wzorzec nazw ponad TLD bez podwójnego liczenia; CNAME operatora vs Fastly; parametry specyficzne vs ogólne; persona jako atrybut; kara za powszechność |
| `tests/pipeline.offline.test.ts` | 15 | pełny pipeline offline na próbce: parsowanie fixtures, F1/ARI ≥ 0.95, recall = 1, Cloudflare, parking, skracacz, `explain` reklamy bez linku, nowe pivoty, trudne przypadki (web3forms, Fastly, jQuery/`style.css`, `utm_source=facebook`, `/api/lead`, persona w niezwiązanej reklamie), simhash DOM tylko w obrębie kampanii, kolumny DROZD i atrybuty, test cloakingu, odcisk audio (gdy jest fpcalc) |
| `lib/graph/link.test.ts` | 14 | IDF, zniżki Cloudflare (CIDR+ASN), NS, noisy-OR; **Cloudflare nie scala kampanii** i przypadek kontrolny (dedykowane IP scala); tracker silny; parking; linki wychodzące do platform; łańcuch TDS; certyfikat SAN; seria rejestracji; podobieństwo obrazu i tekstu; `explain` |
| `lib/media/imageHash.test.ts` | 13 | dHash gradientów (`fff…`/`000…`), odporność na jasność, skalowanie i JPEG, Hamming, mmh3 i hash Shodan (wektory z Pythona), ICO z PNG, śmieci na wejściu |
| `lib/ct/fingerprint.test.ts` | 12 | dopasowanie szablonu `finance23-voluptas94.sbs` i wariantu `.pro`, nazwy z certyfikatów (subdomeny, wildcard), **11 łagodnych sobowtórów bez dopasowania**, generator nazw z innym słowem kotwicy, marki i media z leksykonu (także odmienione w treści reklam), domeny platform pominięte, wzorce dla crt.sh |
| `lib/osint/urls.test.ts` | 12 | refang, normalizacja, parametry śledzące, IDN, sufiksy prywatne PSL, IP, odrzucanie schematów, URL-e w tekście |
| `lib/pipeline/ingest.test.ts` | 12 | synonimy kolumn, CSV z `;` i BOM, daty, pierwszeństwo mapowania, duplikaty id, JSON/JSONL |
| `lib/osint/ct.test.ts` | 10 | parsery i ponowienia crt.sh; `searchCt`: walidacja wzorca, zapytanie z `exclude=expired`, brak ponowień po „Unsupported use of '%'” |
| `lib/media/asr.test.ts` | 9 | wybór whisper-cli/mlx_whisper bez pobierania modeli, konwersja ffmpeg do WAV 16 kHz mono, czyszczenie transkrypcji i plików tymczasowych (mock procesu) |
| `components/viewer/compare.test.ts` | 8 | wybór reklam, wspólne encje (także zdyskontowane), źródła person, filtr persony, stare `campaigns.json`, wzór wagi z powszechnością, polskie liczebniki |
| `lib/ct/stream.test.ts` | 8 | parsowanie `certificate_update`/`dns_entries`, heartbeat i śmieci, odtwarzanie; klient: niedostępny strumień → status `unavailable` bez wyjątku, cichy strumień, przejście do kolejnego URL-a, pingi, ponowne łączenie, przerwanie |
| `lib/graph/eval.test.ts` | 7 | wartości liczone ręcznie (pairwise, B-cubed, ARI), przypadki brzegowe |
| `lib/llm/llm.test.ts` | 7 | Ollama (czat, structured z ponowieniem, błędy, embeddingi) i Anthropic (SDK z mock `fetch`: model, fallbacki, `output_config`, odmowa, 401) |
| `lib/osint/asn.test.ts`, `dns.test.ts` | 7 / 7 | parsery, limit czasu DNS (wstrzyknięty resolver) |
| `lib/media/audioFp.test.ts`, `lib/osint/domainPattern.test.ts`, `lib/text/similarity.test.ts`, `tests/evidence.offline.test.ts` | 6 / 6 / 6 / 6 | podobieństwo Chromaprint (też na żywo z fpcalc); szablony nazw domen; homoglify, leet, TF-IDF; paczka dowodów: nagłówek, fakty oddzielone od analizy, reklamy z UTC, persona bez biometrii, manifest SHA-256 weryfikowalny, lista CERT bez skracacza, zgłoszenie DSA |
| `lib/cache.test.ts`, `lib/media/ocr.test.ts`, `lib/osint/rdap.test.ts`, `tests/ct.offline.test.ts` | 5 / 5 / 5 / 5 | TTL, deduplikacja, `null`; tesseract (mock i na żywo); parser RDAP; watcher CT na próbce: odtworzenie strumienia, kandydaci przypięci do właściwych kampanii, brak pobrania strony bez flagi, deduplikacja po restarcie, limit wzbogaceń, backfill |
| `lib/ct/feed.test.ts` | 4 | dopisywanie bez nadpisywania, odczyt końca pliku, uszkodzone linie, brak pliku |
| `lib/graph/unionFind.test.ts` | 2 | |

**Czego testy nie obejmują:**
- prawdziwych zapytań sieciowych (DNS, RDAP, crt.sh, Cymru, HTTP, strumień CT); live sprawdzone ręcznie (§16.9);
- prawdziwego API Anthropic;
- UI przeglądarki (brak testów komponentów i E2E; logika porównania w `compare.ts` ma testy jednostkowe, widoki sprawdzane przez `next dev` i HTML);
- tras `/api/*` (sprawdzane ręcznie przez `curl`);
- parsowania flag CLI, Dockera (zbudowany i uruchomiony ręcznie), deterministyczności `gen-sample` (sprawdzana ręcznie przez `git status` po ponownym wygenerowaniu), ścieżki embeddingów (uruchomiona ręcznie: F1 1.0 na próbce);
- ASR na żywo w testach (sprawdzany ręcznie przez `bun run media:smoke`);
- wydajności na dużych zbiorach;
- regexów ekstrakcji na prawdziwych stronach oszustów (tylko syntetyczne fragmenty).

**Próbka** (`data/sample/`, generator `scripts/gen-sample.ts`): 43 reklamy, 5 kampanii (C1–C5) i 5 reklam niezwiązanych (N1–N5). Każdy nowy pivot ma w niej przypadek pozytywny i trudny negatyw: publiczny serwis formularzy u C5, N1 i N2; CNAME do Fastly u C5 i N5; jQuery i `style.css` u C1 i N1; `utm_source=facebook`/`utm_medium=cpc` u C1, C2 i N1; ścieżka `/api/lead` u C2 i C3; persona C1 wymieniona w reklamie N5. Dochodzą kolumny w stylu DROZD (persona, wynik deepfake), warianty odpowiedzi dla crawlera (cloaking w C3), dżingle WAV (ten sam w dwóch reklamach C5, inny w N5) i plik demo strumienia CT. Wynik: pairwise F1 = B-cubed F1 = ARI = 1.0.

---

## 13. Jak dostosować w sobotę do danych NASK

### 13.1 Wczytanie danych

1. Obejrzyj dane: nazwy kolumn, kilka wierszy, gdzie są obrazy i wideo (URL czy pliki), czy jest kolumna etykiet, czy są kolumny z DROZD (persona, wynik deepfake).
2. Napisz `nask-mapping.json`. Pola: `id, platform, advertiser, text, imageUrl, imagePath, landingUrl, firstSeen, lastSeen, label, persona, deepfakeScore, videoPath`. `text` może być tablicą kolumn, łączonych znakiem nowej linii.
   ```json
   { "id": "ad_id", "advertiser": "page_id", "text": ["headline", "body"], "imageUrl": "image", "landingUrl": "url",
     "firstSeen": "start", "label": "campaign", "persona": "drozd_identity", "deepfakeScore": "drozd_score" }
   ```
3. `bun run ingest -- --input nask.csv --mapping nask-mapping.json --base-dir <katalog_obrazów>`. Przejrzyj `warnings` w `data/work/items.json`. Niezmapowane kolumny trafiają do `extra`. Nie są pokazywane w UI ani używane w grafie, dopóki nie dodasz ich w `link.ts:135-150` (dane węzła reklamy).
4. Etykiety: reklamy spoza kampanii muszą mieć unikalne etykiety (§6). Jeśli NASK oznacza je wspólnie, np. „0” albo „brak”, zamień je przed ingestem na `N<id>`.
5. Persony: przygotuj listę obserwowanych osób (`[{ "name": "…", "role": "…" }]`) i podaj ją przez `--personas`. Bez listy zostają persony z kolumny wejściowej i z NER (`--ner`).

### 13.2 Live czy offline

- Bazowy przebieg bez sieci: `bun run enrich -- --skip page,favicon,dns,rdap,ct,asn`. Zostają pivoty z treści (kontakty, portfele, URL/host/domena z linków, parametry kampanii z linków), reklamodawca, persony oraz podobieństwo obrazu (pliki lokalne) i tekstu. Przy `imageUrl` obrazy wymagają sieci. Dodaj wtedy `image` do `--skip` albo pobierz pliki wcześniej.
- `--offline` działa **tylko** z fixtures w formacie `data/sample/fixtures`. Narzędzia do zamiany `.cache/` na fixtures nie ma. Fixtures z katalogów spraw (zapisana strona, HAR, zrzut ekranu) buduje `import-cases` (§4.9).
- Artefaktem offline jest `data/work/enriched.json` (z archiwum HTML w `data/work/archive`). Po jednym przebiegu live (tam, gdzie wolno) `build-graph`, `evaluate`, `summarize`, `evidence` i przeglądarka nie potrzebują już sieci. Zachowaj oba.
- Cache wygasa: strony, DNS i CT po 1 dniu, RDAP i ASN po 7 dniach. Przy kolejnym `enrich` przeterminowane wpisy są pobierane od nowa. TTL zmienisz w `sources.ts:46`, `dns.ts:57`, `ct.ts:179`, `rdap.ts:191`, `asn.ts:133`.
- crt.sh jest wolny i zawodny: zaczynaj od `--skip ct`.
- OCR, ASR i odcisk audio uruchamiaj tylko wtedy, gdy dane zawierają kreacje z tekstem lub wideo; `--cloaking` podwaja liczbę GET-ów na stronę.

### 13.3 Strojenie pod F1 z naciskiem na recall

NASK w 2025 karał fałszywe negatywy. W klastrowaniu FN to rozbicie prawdziwej kampanii na części, widoczne w rozkładzie `bun run evaluate` i w `FN=` linii Pairwise. Kolejność działań:

| Krok | Zmiana | Ryzyko |
|---|---|---|
| 1 | `minLinkScore` 0.15 → 0.10…0.12 (`config.ts:160`): więcej średnich powiązań w Louvainie | scalanie przez pojedynczy średni dowód (§14) |
| 2 | `similarity.imageHamming` 10 → 12…14 (`config.ts:162`); w próbce różne rodziny kreacji miały odległość ≥ 15 | wspólne szablony graficzne różnych oszustów |
| 3 | `tfidfThreshold` 0.5 → 0.40…0.45 albo `--text embedding` z `embeddingThreshold` 0.82…0.84 (`config.ts:164`) | wspólne szablony tekstów („kity”) |
| 4 | `similarity.dom.hamming` 6 → 8…10 (`config.ts:165`), gdy kampanie lekko modyfikują szablon strony | gotowe szablony landingów kupowane przez różnych oszustów |
| 5 | `louvain.resolution` 1.0 → 0.7…0.9 (`config.ts:182`): większe społeczności | scalanie sąsiednich kampanii |
| 6 | podnieś wagi typów, które w danych NASK okażą się specyficzne (np. `advertiser` → 0.75, wtedy jest silny) | jeden błędny silny pivot scala całe kampanie (union-find jest przechodni) |

Nie obniżaj `strongThreshold` poniżej 0.65 bez sprawdzenia. Przy 0.6 IP, reklamodawca, ukryte pola i komentarze stają się silne, a IP hostingu współdzielonego zacznie scalać kampanie. Listy Cloudflare i innych nadal działają, bo czynnik listy mnoży wagę.

Przykład `recall.json`:

```json
{ "minLinkScore": 0.1, "similarity": { "imageHamming": 12, "text": { "tfidfThreshold": 0.42 } }, "louvain": { "resolution": 0.85 } }
```

Przegląd siatki parametrów (tylko na danych z etykietami, nie na zbiorze testowym):

```bash
for m in 0.08 0.10 0.12 0.15; do
  echo "{\"minLinkScore\": $m}" > /tmp/cfg.json
  bun run build-graph -- --config /tmp/cfg.json --graph /tmp/g.json --campaigns /tmp/c.json > /dev/null
  echo "minLinkScore=$m"; bun run evaluate -- --graph /tmp/g.json --campaigns /tmp/c.json | grep -E "Pairwise|B-cubed|ARI"
done
```

Domyślne wartości dobrano na syntetycznej próbce przygotowanej razem ze starterem. Na danych NASK trzeba je zmierzyć od nowa.

### 13.4 Nowy typ encji

Wzorem są typy dodane 19.11.2026 (np. `endpoint`, `campaign_param`, `persona`):

1. `lib/graph/model.ts:7`: dopisz typ do `ENTITY_TYPES` i etykietę w `ENTITY_LABELS_PL` (`model.ts:38`). Nowy rodzaj krawędzi dodaj do `EdgeType` (`model.ts:66`).
2. `lib/graph/config.ts:127`: waga w `typeWeights`. TypeScript wymusi wpis, bo to `Record<EntityType, number>`.
3. `components/viewer/palette.ts`: kolor w `TYPE_COLORS` (też wymuszone przez typ).
4. `lib/graph/link.ts`: w pętli po reklamach utwórz `g.node(typ, klucz, etykieta, data)`, `g.edge(...)` i `add(id, typ, ścieżka, relacja, opis)`. Dane z reklamy obok parametrów kampanii i person (`link.ts:456-487`), dane ze strony obok kitu strony (`link.ts:399-453`).
5. Jeśli wartość pochodzi ze wzbogacenia: pole w `lib/pipeline/types.ts` (`ItemEnrichment` `types.ts:113` lub `PageInfo` `types.ts:78`) i obliczenie w `lib/pipeline/enrich.ts` (etap dla każdej reklamy, `enrich.ts:261-340`) albo w ekstraktorze w `lib/osint/`.
6. **Zniżka dla infrastruktury współdzielonej**: nowy `case` w `Discounter.discountsFor` (`weights.ts:94`) i lista w `lists` (§4.4). Bez tego nowy pivot może scalać niezwiązane kampanie tak jak adresy Cloudflare. Opcjonalnie etykiety pól w `DetailsPanel.tsx` (`DATA_LABELS_BY_TYPE`, `TYPE_NOTES`).
7. Test w `lib/graph/kitLink.test.ts` lub `link.test.ts` z `makeDataset` (`lib/graph/testkit.ts`), w tym trudny negatyw: dwie niezwiązane reklamy z tą samą ogólną wartością nie mogą trafić do jednej kampanii.

`/api/analyze` obsłuży nowy pivot bez zmian, bo porównuje id węzłów.

Typ, który ma tylko opisywać reklamy, a nie je łączyć (jak persona), dostaje wagę poniżej `minLinkScore` i trafia do atrybutów kampanii (`campaignAttributes`, `cluster.ts:237`).

### 13.5 Sygnały obrazu i deepfake'ów (DROZD)

| Sygnał | Gdzie wpiąć |
|---|---|
| wynik lub etykieta deepfake per reklama (kolumna od NASK/DROZD) | **obsłużone**: zmapuj na `deepfakeScore` (synonimy w `ingest.ts:63`); wynik trafia do danych węzła reklamy, atrybutu `deepfakeScoreMax` kampanii, panelu szczegółów i paczki dowodów jako wynik modelu, nie fakt |
| identyfikator lub nazwisko osoby z DROZD | **obsłużone**: zmapuj na `persona` (`ingest.ts:62`); persona jest atrybutem i filtrem (§4.8) |
| embedding twarzy/obrazu (np. z modelu DROZD lub CLIP) | policz w `enrich.ts` w `loadImage` (`enrich.ts:217-237`), zapisz w `ImageInfo` (`types.ts:109`); w `link.ts` dodaj pętlę podobieństwa wzorowaną na obrazie lub DOM (`link.ts:572-608`) z własnym progiem i wagą w `config.similarity`; analogicznie w `analyze.ts:142-149`. Uwaga: dopasowanie twarzy 1:N to przetwarzanie danych biometrycznych; starter tego nie robi |
| identyfikator klastra twarzy, modelu syntezy lub głosu | nowy typ encji (§13.4) |
| lepszy hash percepcyjny (pHash, wycinek twarzy) | `lib/media/imageHash.ts` obok `dHash`; porównanie w `link.ts:572-586` |

Wywołanie zewnętrznego systemu (DROZD) z pipeline'u to nowe wyjście danych. Sprawdź w regulaminie zadania, czy jest dozwolone. Obecnie dane trafiają tylko do zapytań pasywnych i skonfigurowanego LLM.

---

## 14. Znane ograniczenia

- **Złożoność O(n²).** Podobieństwo obrazów, tekstów, DOM i dźwięku liczy wszystkie pary (`link.ts:572-659`). Pivoty tworzą `df²/2` par, z limitem `df ≤ 400`. Przy dziesiątkach tysięcy reklam potrzebny jest indeks (BK-tree, LSH).
- **Louvain scala izolowane pary.** Dwie reklamy połączone tylko jedną krawędzią `≥ minLinkScore` lądują w jednej kampanii niezależnie od tego, jak słaba jest ta krawędź (modularność nie zależy od skali w obrębie składowej). Przed tym chroni tylko próg `minLinkScore`.
- **Union-find jest przechodni.** Jeden błędny silny pivot (np. tracker szablonu albo backend sprzedawanego kitu używany przez różnych oszustów) scala całe kampanie. Taki identyfikator dopisz do `lists.pivots`.
- **Listy są statyczne.** Nie ma danych passive DNS (ile domen ma dane IP). Nieznany ubiquitous hosting jest tłumiony tylko przez IDF (podłoga 0.2), karę za powszechność (od 50% reklam, zbiory ≥ 10) i `maxStrongDfRatio`.
- **IDF przy małych zbiorach** karze też duże prawdziwe kampanie, choć łagodnie (podłoga 0.2).
- **`jsRedirects` nie są używane** do łączenia, są tylko zapisywane w `enriched.json`. Hosty z linków wychodzących i z przekierowań JS nie są rozwiązywane w DNS.
- **Bez wykonywania JS.** Strony SPA dają pustą treść i pusty kit. Backendy składane dynamicznie (np. z kilku zmiennych) nie zawsze są widoczne dla statycznego skanera.
- **Test cloakingu** rozpoznaje tylko różnicę po User-Agencie. Cloaking po IP, geolokalizacji, odcisku przeglądarki albo JS nie jest wykrywany; wynik negatywny nie dowodzi braku cloakingu.
- **Persona w trybie przybliżonym** może dopasować inne nazwisko o podobnym temacie (to wskazówka do sprawdzenia). Odmiana polska jest uproszczona; nietypowe formy wymagają aliasów na liście.
- **OCR i ASR** mylą się (przykład „Brzosku” zamiast „Brzoską”); tekst maszynowy jest używany tylko jako wskazówka i do podobieństwa tekstu.
- **Ekstrakcja z tekstu:** telefony tylko polskie (inne kraje wyłącznie z `tel:`/`wa.me`); zaproszenia do grup WhatsApp są węzłami typu `telegram`; ICO zawierające tylko BMP nie mają dHash.
- **TF-IDF** nie łapie pełnych parafraz. Embeddingi wymagają Ollamy z `bge-m3`.
- **`/api/analyze`** używa przybliżenia: waga węzła z oryginalnego zbioru × relacja nowej reklamy; tekst porównuje z tekstami uciętymi do 600 znaków; nie porównuje simhash DOM ani dźwięku; domyślnie korzysta z `data/sample/linking.json` (ustaw `LINK_CONFIG`). Brak rate limitu.
- **`graph.json`** ma tylko top-12 powiązań na reklamę, więc `explain` na pliku może nie widzieć słabszych par bezpośrednio (panel porównania pokazuje wtedy wspólne encje).
- **Przeglądarka** przekazuje cały graf jako props: 43 reklamy dają `graph.json` ok. 750 KB. Przy tysiącach reklam stanie się ciężka; trzeba będzie stronicować albo ładować graf przez API. Build produkcyjny ma dane z czasu budowania (§3.9); feed CT jest czytany na bieżąco przez API.
- **Paczka dowodów** nie zawiera WARC, zrzutów ekranu, znacznika czasu RFC 3161 ani rekordów z repozytorium reklam; status na Liście Ostrzeżeń CERT nie jest sprawdzany (§15).
- **Watcher CT** zależy od lokalnego `certstream-server-go` (publiczny CertStream nie przysyłał danych), a backfill od crt.sh, który często odrzuca lub nie kończy zapytań z `%` (§16.9).
- **Wyniki na próbce** (F1 = ARI = 1.0) dotyczą danych syntetycznych zaprojektowanych pod trudne przypadki, a progi dobrano na nich. Nie są prognozą dla danych NASK.
- **Anthropic** jest przetestowany tylko na mockach.
- **Seria rejestracji** wymaga daty `created` z RDAP. Część rejestrów (np. niektóre ccTLD) jej nie podaje.

---

## 15. Paczka dowodów

`bun run evidence -- --campaign K01` (`scripts/evidence.ts`, `lib/evidence/pack.ts:124`) zapisuje w `data/evidence/<kampania>/` paczkę zgodną z sekcją 5 raportu „Prawo i dowody” z notatek badawczych. Narzędzie proponuje; człowiek weryfikuje treść i decyduje o zgłoszeniu.

**Wejście:** `data/graph.json`, `data/campaigns.json`, `data/work/enriched.json` (z tego samego zbioru), opcjonalnie `data/summaries.json` i archiwum HTML z `enrich`.

**Pliki:**

| Plik | Zawartość |
|---|---|
| `evidence.json` | pełny rekord (niżej) |
| `evidence.md` | ten sam rekord czytelnie: nagłówek, streszczenie faktów, osoba, obserwacje, analiza, działania, pliki z SHA-256 (`pack.ts:491`) |
| `cert-domains.txt` | domeny i hosty do zgłoszenia na Listę Ostrzeżeń CERT, jedna na linię, bez platform, skracaczy i serwisów publicznych (`domainDiscount`, `pack.ts:223`, `:278`); przy ponad 50 dodatkowo `cert-domains-<n>.txt` po 50 (`pack.ts:405-408`) |
| `dsa-art16-notice.md` | szablon zgłoszenia z art. 16 ust. 2 DSA (`pack.ts:450`): (a) wyjaśnienie z faktów i proponowanymi podstawami prawnymi plus miejsce na uzasadnienie, (b) dokładne URL-e (link, każdy skok, strona końcowa) i identyfikatory reklam, (c) imię, nazwisko i e-mail zgłaszającego, (d) oświadczenie o dobrej wierze (`pack.ts:19`) |
| `files/html/<sha256>.html`, `files/creatives/…`, `files/media/…` | kopie archiwum HTML stron, kreacji i plików audio/wideo |
| `manifest.sha256` | SHA-256 każdego pliku w formacie `shasum -a 256 -c` (`pack.ts:416`) |

**Rekord `evidence.json`** (`pack.ts:358-444`):
- nagłówek: `package_id` (UUID), `version`, `created_utc`, `tool_version` (nazwa, wersja, commit git, progi linkowania), `submitter` (pola niepodane mają znacznik `[UZUPEŁNIJ: …]`), `good_faith_statement`, `tlp` (domyślnie `TLP:AMBER`), `pap`, `summary_facts`;
- `legal_assessment`: oznaczone „(wniosek)” propozycje podstaw prawnych do weryfikacji przez prawnika, bez rozstrzygania o nielegalności;
- `requested_action`: propozycje dla odbiorców D (platforma, art. 16 DSA), C (CSIRT NASK, Lista Ostrzeżeń CERT), K (KNF), U (UODO), P (prokuratura/Policja), S (Prezes UKE), E (zabezpieczenie danych) ze statusem „propozycja” (`pack.ts:94-121`);
- `impersonated_person`: imię i nazwisko, rola publiczna, podstawa wskazania (kolumna wejściowa, lista, OCR/ASR przybliżony, NER), status zgody („nieustalone”), `biometric_data: "brak…"` i wyniki deepfake z danych wejściowych opisane jako wynik modelu (`pack.ts:280-310`);
- `observations` (fakty): wspólne identyfikatory, reklamy (ID, platforma, reklamodawca, daty UTC, treść, link z łańcuchem, User-Agent i czas pobrania, parametry kampanii, pliki kreacji z SHA-256), domeny (hosty, rejestracja z RDAP, NS, MX, IP z ASN, łańcuchy CNAME, certyfikaty, strony z `body_sha256_raw` i plikiem archiwum, wynik testu cloakingu, fakty o „podstawowym celu” strony: backendy formularzy, ukryte pola, kontakty, trackery, portfele), konta reklamodawców (`pack.ts:155-317`);
- `analysis` (wyniki modeli i heurystyk, oddzielone od faktów): przypisanie do kampanii, wyniki powiązań z dowodami, metody i progi podobieństwa, użycie NER, wyniki deepfake, streszczenie LLM (`pack.ts:338-356`);
- `integrity`: manifest, `manifest_sha256`, polecenie weryfikacji, `timestamp_token: null`, `custody_log`, inwentarz danych osobowych z podstawą „(wniosek)” i polem retencji do uzupełnienia, domeny wyłączone z listy CERT, ograniczenia (`pack.ts:418-441`).

Osoby nie są identyfikowane z twarzy ani głosu, a paczka nie zawiera wzorców biometrycznych. Test `tests/evidence.offline.test.ts` sprawdza m.in., że obserwacje nie zawierają wyników modeli i że każda linia manifestu się weryfikuje.

**Czego paczka nie robi:** nie zapisuje WARC (ISO 28500) ani zrzutów ekranu, tylko zdekodowany HTML i SHA-256 surowej odpowiedzi; nie ma znacznika czasu RFC 3161 ani pieczęci (art. 41 eIDAS); nie pobiera rekordów z repozytoriów reklam (art. 39 DSA); nie sprawdza statusu domen na Liście Ostrzeżeń CERT (`pack.ts:436-440`). Te kroki trzeba wykonać przed zgłoszeniem.

---

## 16. Watcher Certificate Transparency (wczesne ostrzeganie)

Kampanie rotują domeny, a nowa domena zwykle dostaje certyfikat TLS, zanim ruszy reklama. Watcher porównuje nazwy z nowych certyfikatów z „odciskami kampanii” zbudowanymi z `campaigns.json` i zapisuje dopasowania jako kandydatów przypiętych do najbliższej kampanii.

### 16.1 Odciski kampanii (`lib/ct/fingerprint.ts`)

`buildFingerprints` (`fingerprint.ts:159`) bierze kampanie z ≥ 2 reklamami i ich domeny bez platform, skracaczy i serwisów publicznych (`isExcludedDomain` z `domainDiscount`, `scripts/_ct.ts:32`). Dla każdej kampanii:
- szablony nazw domen z wariantem z TLD i bez (`domainTemplate`, §4.7), gdy rdzeń ma ≥ 3 litery;
- szkielet generatora nazw: szablon z literalnymi słowami zamienionymi na `<w>` (`templateSkeleton`, `fingerprint.ts:131`), np. `<w><n>-<lorem><n>.sbs`;
- marki z leksykonu znalezione w domenach kampanii albo, z polską odmianą, w treściach reklam i nazwach reklamodawców (`brandInText`, `fingerprint.ts:119`);
- media z leksykonu obecne w domenach kampanii;
- słowa domen używane tylko przez tę kampanię (`fingerprint.ts:226`).

### 16.2 Dopasowanie (`matchDomain`, `fingerprint.ts:287`)

Nazwa z certyfikatu jest sprowadzana do domeny rejestrowalnej (`*.`, subdomeny i kropka końcowa znikają, `fingerprint.ts:266`). Domeny już należące do kampanii i z `ignoreDomains` są pomijane. Kandydat **zawsze wymaga wzorca**; pojedyncze popularne słowo nigdy nie wystarcza (`scoreCampaign`, `fingerprint.ts:325`):

| Rodzaj | Warunek | Wynik |
|---|---|---|
| `template` | ten sam szablon co domena kampanii, ten sam TLD | 0.9 (+0.05, gdy szablon ma ≥ 2 domeny kampanii) |
| `template_other_tld` | ten sam szablon, inny TLD | 0.8 (+0.05) |
| `brand` | marka z leksykonu używana przez kampanię i kontekst: reszta nazwy to cyfry i słowa z domen kampanii, słowo wyłączne kampanii albo ten sam TLD (`fingerprint.ts:367-393`) | 0.7 |
| `media` | medium z leksykonu obecne w domenach kampanii **i** słowo wyłączne tej kampanii (`fingerprint.ts:395-410`) | 0.65 |
| `lorem_kit` | ten sam szkielet generatora z innym słowem kotwicy (szablon z `<lorem>` i `<n>`) | 0.6 na tym samym TLD, 0.5 na innym |

Słowa z leksykonu (przynęty, instytucje, media) i słowa kampanii dodają po 0.05 (maks. dwa) i trafiają do uzasadnienia, ale same niczego nie dopasowują (`fingerprint.ts:413-423`). Wynik ≥ `threshold` (0.6) to kandydat; przy kilku kampaniach wygrywa wyższy wynik, potem silniejszy rodzaj, więcej domen za wzorcem i większa kampania (`isBetter`, `fingerprint.ts:91`).

Przykłady z testów (`lib/ct/fingerprint.test.ts`, kampania z `finance12-dolorem51.sbs` i `finance88-quia40.sbs`): `finance23-voluptas94.sbs` → `template`, 0,95; `finance23-voluptas94.pro` → `template_other_tld`, 0,85. Bez dopasowania: `finance.sbs`, `finance23.sbs`, `finance-news.pro`, `yahoo-finance.com`, `personal-finance23.pro`, `finance23-news94.sbs`, `voluptas94.pro`, `lorem-ipsum.com`, `dolorem-ipsum.sbs`, `financeplus-voluptas.pro` i `finance23-voluptas94.sbs.evil.example`.

### 16.3 Źródła strumienia (`lib/ct/stream.ts`)

- Klient protokołu CertStream przez WebSocket (`runCtStream`, `stream.ts:140`) czyta wiadomości `certificate_update` (strumień pełny i „lite”) oraz `dns_entries` (tylko domeny); heartbeat i nieznane typy są pomijane (`parseCertstreamMessage`, `stream.ts:39`). Wysyła tylko pingi WebSocket, których wymaga certstream-server-go (`stream.ts:191`).
- Kolejność prób: `CT_STREAM_URL` albo `--url`, domyślnie lokalny `ws://127.0.0.1:8181/`, potem publiczny `wss://certstream.calidog.io/` (`scripts/ct-watch.ts:16-17`, `:52`).
- Strumień jest niedostępny, gdy połączenie nie powstanie w 10 s albo po otwarciu przez 20 s nie przyjdą dane; działający strumień, który ucichnie na 60 s, jest łączony ponownie, z backoffem do 30 s i maks. 20 razy (`stream.ts:143-147`, `:253`). Gdy żaden URL nie da danych, wynik ma status `unavailable` (bez wyjątku), CLI wypisuje próby, podpowiada uruchomienie serwera, backfill albo demo i kończy się kodem 2.
- **Lokalny serwer:** `docker compose --profile ct up -d certstream` uruchamia `0rickyy0/certstream-server-go:v1.10.1` (obraz dla `linux/arm64` i `linux/amd64`) z portem tylko na `127.0.0.1:8181` (`docker-compose.yml:36-43`). Konfiguracja `docker/certstream/config.yaml`: pusta biała lista klientów (port i tak jest lokalny), bez Prometheusa, `recovery.enabled: false`, żeby serwer nie pobierał logów od indeksu 0 (`docker/certstream/config.yaml:36-37`). Serwer potrzebuje wyjścia do internetu (lista logów Google i same logi CT).
- **Demo offline:** `bun run ct:watch -- --replay data/sample/ct-stream.jsonl` odtwarza zapisane wiadomości (`replayCertstream`, `stream.ts:258`) bez sieci; wzbogacenie korzysta wtedy z fixtures (`scripts/ct-watch.ts:49-50`).

### 16.4 Backfill z crt.sh

`bun run ct:backfill` (`scripts/ct-backfill.ts`, `runBackfill` w `lib/ct/watch.ts:166`) pyta crt.sh o wzorce (`searchCt`, §3.1, wspólne ponowienia i cache, przestrzeń `ct-search` z TTL 1 h), bierze certyfikaty z ostatnich `--since` dni (data wpisu albo `notBefore`) i przepuszcza ich nazwy przez ten sam watcher. Bez `--pattern` wzorce powstają z rdzeni szablonów kampanii, np. `zwrot<n>-<lorem><n>.example` → `zwrot%` (`backfillPatterns`, `fingerprint.ts:437`), bo crt.sh nie przyjmuje `%` w środku wzorca; TLD i resztę szablonu sprawdza lokalnie matcher. Wzorzec bez odpowiedzi ma status `unavailable`, a błędny `error`; pozostałe wzorce są przetwarzane dalej.

### 16.5 Po dopasowaniu (`lib/ct/watch.ts`, `lib/ct/enrich.ts`)

`CtWatcher.handle` (`watch.ts:41`) grupuje nazwy certyfikatu po domenie rejestrowalnej, każdą domenę sprawdza raz (zbiór sprawdzonych do 500 000 wpisów, `watch.ts:68`) i zgłasza raz; domeny już obecne w feedzie są pomijane po restarcie (`watch.ts:50`). Dopasowanie jest synchroniczne, a wzbogacenie i zapis biegną w tle, po dwa naraz.

Wzbogacenie jest wyłącznie pasywne (`enrichCandidate`, `lib/ct/enrich.ts:17`): DNS A/AAAA/CNAME/NS/MX domeny, A/CNAME do dwóch dodatkowych hostów z certyfikatu, RDAP i historia z crt.sh. **Strona nie jest pobierana**, chyba że podasz `--fetch-page`; wtedy jest to jeden GET `https://<domena>/` przez pobieracz z ochroną SSRF (`lib/ct/enrich.ts:63-77`). Domyślnie maks. 30 wzbogaceń na minutę; ponad limit kandydat jest zapisywany bez wzbogacenia z polem `skipped` (`watch.ts:96-98`). `--no-enrich` wyłącza wzbogacenie.

### 16.6 Feed (`lib/ct/feed.ts`)

`data/ct-watch.jsonl` (albo `CT_FEED_FILE`) to plik tylko do dopisywania: jeden obiekt JSON na linię, nigdy nie przepisywany (`appendFeed`, `feed.ts:61`). Rekord `CtFeedRecord` (`feed.ts:24`):
- `v`, `type: "ct_candidate"`, `observed_utc`, `source` (`certstream` / `crtsh-backfill` / `replay`), `stream` (URL, wzorce albo plik);
- `domain`, `names` (nazwy z certyfikatu pod tą domeną);
- `cert`: `issuer`, `not_before`, `not_after`, `fingerprint`, `serial`, `log`, `log_url`, `cert_index`, `crtsh_id`, `seen_utc`;
- `candidate`: `campaign_id`, `campaign_label`, `score`, `kind`, `template`, `similar_domains`, `tokens`, `evidence` (tekst PL);
- `enrichment`: `dns`, `hosts`, `rdap`, `ct`, `page` (tylko z `--fetch-page`), `errors`, `skipped`;
- `status: "candidate"` i `note`: „kandydat do weryfikacji przez człowieka: dopasowanie nazwy domeny do odcisku kampanii, nie dowód” (`watch.ts:15`).

`readFeedTail` (`feed.ts:81`) czyta tylko koniec pliku (domyślnie 4 MiB), odrzuca niepełną pierwszą linię i uszkodzone wpisy.

### 16.7 Panel w przeglądarce

Zakładka „Nowe domeny” (`components/viewer/CtFeedPanel.tsx`) co 15 s czyta `/api/ct-feed` (`CtFeedPanel.tsx:16-22`, §8.3) i pokazuje kandydatów od najnowszych: domenę, przycisk kampanii (zaznacza ją w grafie), wynik, rodzaj dopasowania, uzasadnienie, dane certyfikatu, DNS i RDAP. Przy pustym lub brakującym feedzie pokazuje polecenia uruchomienia watchera, backfillu i demo (`CtFeedPanel.tsx:132`). Liczba kandydatów jest na zakładce, a `?panel=ct` otwiera ją od razu.

### 16.8 Stałe

| Stała | Wartość | Miejsce |
|---|---|---|
| połączenie / pierwsza wiadomość / cisza / ping / ponowne połączenia | 10 s / 20 s / 60 s / 30 s / 20 | `lib/ct/stream.ts:143-147` |
| wzbogacenia na minutę / współbieżność | 30 / 2 | `lib/ct/watch.ts:96`, `:51` |
| zbiór sprawdzonych domen | 500 000 | `lib/ct/watch.ts:68` |
| odczyt końca feedu | 4 MiB | `lib/ct/feed.ts:81` |
| backfill: okno / ponowienia crt.sh | 7 dni / 2 | `scripts/ct-backfill.ts:45`, `:62` |

### 16.9 Stan na 19.11.2026 (pomiary z tej maszyny)

- Lokalny `certstream-server-go` v1.10.1 w Dockerze (arm64) działał: `ct:watch` odebrał 224 963 wiadomości w 75 s i sprawdził 33 602 nowe domeny rejestrowalne. Z odciskami próbki i testowym odciskiem `finance<n>-<lorem><n>.*` nie było kandydatów, czego należało się spodziewać przy fikcyjnych domenach i krótkim oknie.
- Sonda z odciskiem `bbcsports<n>.ph` (rodzina szablonowych domen zauważona w strumieniu) dała 22 kandydatów w 50 s; pierwszych pięciu wzbogaconych (wspólny adres A, brak RDAP dla `.ph`), reszta zapisana bez wzbogacenia z powodu limitu ustawionego na 5 na minutę.
- Publiczny CertStream (`wss://certstream.calidog.io/`) przyjął połączenie WebSocket, ale nie przysłał żadnych danych w 12–20 s; watcher traktuje go jako niedostępny.
- crt.sh: wzorzec z `%` w środku (`bbcsports%.ph`) zwrócił stronę „Unsupported use of '%'”, a wzorzec prefiksowy (`bbcsports%`) odpowiedź 502 po ok. 80 s. Backfill jest więc „best effort”; zapytania o pojedyncze domeny działały (ok. 20 s).
- Demo offline (`--replay data/sample/ct-stream.jsonl`): 17 wiadomości, 5 kandydatów (`zwrot51-dolores33.invalid` i `zwrot64-quia17.example` z szablonu C4, `kryptozysk-ai24.test` z marki C1, `fakt-dnia-24.example` z medium C3, `pomoc77-dolorem12.example` z generatora nazw C4); łagodne sobowtóry, domeny znane i powtórzone zostały pominięte.

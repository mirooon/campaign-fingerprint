# Dokumentacja techniczna: Odcisk kampanii

Opisuje to, co kod robi w wersji oddanej (stan na 22.11.2026, HEAD gałęzi `main`; liczby oznaczone datą 21.11.2026 pochodzą z pomiarów z tego dnia). Odwołania do kodu wskazują plik; funkcję lub stałą znajdziesz wyszukiwaniem po nazwie z tekstu, bo numery linii szybko się przesuwają. Osobne dokumenty: [../README.md](../README.md) (uruchomienie), [METODYKA.md](METODYKA.md) (metodyka dla osoby oceniającej), [../LICENCJE.md](../LICENCJE.md) (licencje), [GUI.md](GUI.md) (interfejs), [ZGODNOSC.md](ZGODNOSC.md) (AI Act, RODO, DSA). Sekcje o uruchomieniu, trybie live, bibliotekach i pochodzeniu danych, które stały w README do 21.11.2026, są w §17.

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
13. [Dostosowanie do nowego zbioru](#13-dostosowanie-do-nowego-zbioru)
14. [Znane ograniczenia](#14-znane-ograniczenia)
15. [Paczka dowodów](#15-paczka-dowodów)
16. [Watcher Certificate Transparency (wczesne ostrzeganie)](#16-watcher-certificate-transparency-wczesne-ostrzeganie)
17. [Treści przeniesione z README](#17-treści-przeniesione-z-readme-21112026-zadanie-i8)
18. [Harmonogram skanów i „baza rośnie”](#18-harmonogram-skanów-i-baza-rośnie-22112026-zadanie-i11)

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
 data/graph.json ................. EvidenceGraph (kompaktowy JSON, top-12 powiązań na reklamę i wszystkie wewnątrz kampanii)
 data/campaigns.json ............. CampaignsFile
        │
        ├── evaluate     (lib/graph/eval.ts)              → metryki na stdout
        ├── summarize    (scripts/summarize.ts, LLM)       → data/summaries.json
        ├── evidence     (lib/evidence/pack.ts)            → data/evidence/<kampania>/ (§15)
        ├── ct:watch, ct:backfill (lib/ct/*)               → data/ct-watch.jsonl (§16)
        ├── viewer       (app/page.tsx, components/viewer/*) czyta graph/campaigns/summaries; feed CT przez /api/ct-feed
        └── /api/analyze (lib/pipeline/analyze.ts)        dopasowuje nową reklamę do graph.json
```

Domyślne ścieżki są w `lib/pipeline/steps.ts` (także lista person, archiwum, katalog paczek dowodów, feed, leksykon i plik demo watchera CT). `.cache/`, `data/work/`, `data/evidence/` i `data/ct-watch.jsonl` są w `.gitignore` (`.gitignore:47-52`). `data/graph.json`, `data/campaigns.json` i `data/summaries.json` są commitowane, żeby przeglądarka budowała się bez uruchamiania pipeline'u.

### 2.1 `items.json` — `ItemsFile` (`lib/pipeline/types.ts`)

| Pole | Typ | Uwagi |
|---|---|---|
| `version` | `1` | |
| `generatedAt` | ISO | |
| `source` | string | ścieżka wejścia |
| `baseDir` | string | katalog, względem którego rozwiązywane są `imagePath` i `videoPath` (domyślnie katalog pliku wejściowego, `steps.ts`) |
| `items` | `Item[]` | niżej |
| `warnings` | string[] | brakujące kolumny, duplikaty id, nieparsowalne daty i wyniki deepfake, puste wiersze |

`Item` (`types.ts`): `id`, `platform`, `advertiser`, `text`, `imageUrl` (tylko http(s)), `imagePath`, `landingUrl`, `firstSeen`, `lastSeen` (ISO 8601 UTC), `label` (prawda do ewaluacji), `persona` (osoba z danych wejściowych, np. z DROZD; kilka rozdzielonych `;` lub `|`, `types.ts`), `deepfakeScore` (0..1, wynik modelu z danych wejściowych, nie fakt), `videoPath` (plik wideo/audio dla opcjonalnego ASR i odcisku audio), `extra` (niezmapowane kolumny, wartości ucięte do 500 znaków, `ingest.ts`). Pola tekstowe poza `id` i `extra` są `string | null`.

### 2.2 `enriched.json` — `EnrichedDataset` (`types.ts`)

| Pole | Typ | Klucz |
|---|---|---|
| `version`, `generatedAt`, `mode` (`live`/`offline`), `baseDir` | | |
| `items` | `Item[]` | kopia wejścia |
| `perItem` | `Record<itemId, ItemEnrichment>` | id reklamy |
| `pages` | `Record<url, PageInfo>` | znormalizowany URL docelowy |
| `hosts` | `Record<host, HostInfo>` | host ASCII (punycode) |
| `domains` | `Record<domena, DomainInfo>` | domena rejestrowalna (eTLD+1) |
| `ips` | `Record<ip, AsnInfo \| null>` | IP kanoniczny (IPv6 w pełnej postaci) |

- `ItemEnrichment` (`types.ts`): `itemId`, `landing: NormalizedUrl|null`, `pageKey` (klucz do `pages`), `text: TextExtract|null` (kontakty/portfele/URL-e z treści reklamy, OCR i ASR), `image: ImageInfo|null`, `personas: PersonaMatch[]`, `campaignParams: CampaignParam[]`, `ocrText`, `asrText`, `audioFp: AudioFingerprint|null`, `errors: string[]`.
- `ItemEnrichment.faces` (opcjonalne, `--faces`): `FaceHit[]` (`image`, `x`, `y`, `w`, `h`, i dla podobnej twarzy `persona` oraz `similarity`). Brak wektorów. `image` to ścieżka obrazu albo `wideo#kadrN`. Persona z twarzy trafia też do `personas` (`source: "face"`, `similarity`).
- `PageInfo` (`types.ts`): `requestedUrl`, `fetch` (= `FetchPageResult` bez `body`), `extract: PageExtract|null`, `favicon: {url, hashes: FaviconHashes|null, error}|null`, `kit: PageKit|null`, `archiveFile` (ścieżka zdekodowanego HTML w archiwum), `cloaking: CloakingCheck|null`.
- `CloakingCheck` (`types.ts`): `crawler` i `mobile` (`CloakingVariant`, : `userAgent`, `finalUrl`, `status`, `domSimhash`, `bodySha256`, `error`), `finalUrlDiffers`, `domDistance`, `suspected`, `reasons[]`.
- `HostInfo` (`types.ts`): `host`, `registrableDomain`, `dns: DnsRecords|null`, `ips: string[]`, `cnameChain: string[]` (cele CNAME po kolei, maks. 4 skoki).
- `DomainInfo` (`types.ts`): `domain`, `ns[]`, `mx[]`, `txt[]`, `rdap: RdapInfo|null`, `ct: CtResult|null`.
- `NormalizedUrl` (`lib/osint/urls.ts`): `input`, `url`, `scheme`, `host`, `hostUnicode`, `port`, `path`, `query`, `registrableDomain`, `publicSuffix`, `subdomain`, `isIp`, `isIdn`, `removedParams`.
- `FetchPageResult` (`lib/osint/fetchPage.ts`): `requestedUrl`, `finalUrl`, `status`, `ok`, `redirectChain[{url,status,location,kind:"http"|"meta-refresh"}]`, `contentType`, `headers` (tylko wybrane, `fetchPage.ts`), `bytes`, `truncated`, `body`, `bodySha256` (SHA-256 surowych bajtów odpowiedzi po dekompresji), `userAgent`, `remoteAddress`, `error`, `errorCode` (`invalid-url|blocked|timeout|too-many-redirects|network|tls`), `fetchedAt`, `durationMs`.
- `PageExtract` (`lib/osint/extract.ts`): `title`, `description`, `canonical`, `ogTitle`, `ogDescription`, `ogImage`, `ogSiteName`, `trackers[{kind,id}]`, `faviconUrl`, `outboundDomains[]`, `outboundUrls[]`, `emails[]`, `phones[]`, `telegram[]`, `whatsapp[]`, `wallets[{kind,address}]`, `metaRefresh`, `jsRedirects[]`, `visibleText` (≤ 5000 znaków), `generator`.
- `PageKit` (`lib/osint/pagekit.ts`): `endpoints: EndpointRef[]` (`pagekit.ts`: `key`, `host`, `pathTemplate`, `sameOrigin`, `method`, `via` = `form|fetch|xhr|axios|jquery|literal`, `raw`), `domSimhash`, `tagCount`, `hiddenFields[]`, `assets: AssetRef[]`, `comments[]`, `cyrillicComments`.
- `TextExtract` (`extract.ts`): `urls`, `emails`, `phones`, `telegram`, `whatsapp`, `wallets`.
- `CampaignParam` (`lib/osint/campaignParams.ts`): `name` (jak w URL), `canonicalName`, `value` (≤ 120 znaków), `sourceUrl`, `cyrillic`, `macro`.
- `PersonaMatch` (`lib/text/persona.ts`): `id` (slug), `name`, `matched`, `source` (`watchlist|ingest|ner`), `role`, `fuzzy?`, `distance?`.
- `AudioFingerprint` (`lib/media/audioFp.ts`): `duration`, `fingerprint` (surowe liczby Chromaprint).
- `DnsRecords` (`lib/osint/dns.ts`): `name`, `a`, `aaaa`, `cname`, `ns`, `mx`, `txt`, `errors`.
- `RdapInfo` (`lib/osint/rdap.ts`): `domain`, `registrar`, `registrarIanaId`, `created`, `expires`, `updated`, `status[]`, `nameservers[]`, `abuseEmail`, `source`.
- `CtResult` / `CertInfo` (`lib/osint/ct.ts`): `{domain, certs, truncated}`; cert: `id`, `serial`, `issuer` (wartość O= lub CN=), `issuerName`, `commonName`, `sanDomains[]`, `notBefore`, `notAfter`, `entryTimestamp`.
- `AsnInfo` (`lib/osint/asn.ts`): `ip`, `asn`, `asns[]`, `prefix`, `country`, `registry`, `allocated`, `asName`.
- `ImageInfo` = `ImageHashes` (`lib/media/imageHash.ts`: `dhash`, `ahash` — 16 hex = 64 bity, `width`, `height`, `format`) + `source`.
- `FaviconHashes` (`imageHash.ts`): `mmh3` (hash zgodny z Shodan `http.favicon.hash`), `sha256`, `dhash|null`, `ahash|null`, `format`.

### 2.3 `graph.json` — `EvidenceGraph` (`lib/graph/model.ts`)

| Pole | Opis |
|---|---|
| `version`, `generatedAt`, `mode`, `baseDir` | `baseDir` służy `/api/image` do rozwiązywania obrazów |
| `textMethod` | `tfidf` / `embedding` / `none` |
| `stats` | `items`, `nodes`, `edges`, `links`, `strongLinks`, `byType` (`model.ts`); po przycięciu wartości `edges`/`links` dotyczą zapisanego pliku |
| `nodes: GraphNode[]` | `id` (`<typ>:<klucz>`), `type`, `key`, `label`, `df`, `weight`, `strong`, `discounts[{reason,factor,rule}]`, `data` (szczegóły zależne od typu, w tym `weightParts {base, listFactor, idf, ubiquity}`), `campaignId` (tylko reklamy) — `model.ts` |
| `edges: GraphEdge[]` | `id`, `source`, `target`, `type`, `weight` (1 dla krawędzi strukturalnych, waga podobieństwa dla `similar_*`), `evidence` (tekst PL) — `model.ts` |
| `links: ItemLink[]` | `a`, `b`, `score` (noisy-OR), `strong`, `evidence: PairEvidence[]` — `model.ts` |

`PairEvidence` (`model.ts`): `kind` (`pivot`/`similarity`), `pivot` (id węzła), `pivotType`, `edgeType` (`similar_image`/`similar_text`/`similar_dom`/`similar_audio`, lista w `model.ts`), `weight`, `strong`, `discounted`, `evidence`, `pathA`, `pathB` (ścieżki id węzłów od reklamy do encji).

Dane węzła reklamy (`lib/graph/link.ts`) zawierają oprócz pól `Item` także `deepfakeScore`, `personas` (imiona i nazwiska), `ocrText` i `asrText` (≤ 600 znaków), a po przetworzeniu strony `domSimhash`, `cyrillic`, `cloakingSuspected`, `cloakingReasons` i `finalUrl` (`link.ts`).

### 2.4 `campaigns.json` — `CampaignsFile` (`model.ts`)

- `method`: `unionFind` (opis progu), `louvain {resolution, seed, modularity}`, `minLinkScore`.
- `campaigns: Campaign[]` (`model.ts`): `id` (`K01`…), `size`, `members[]`, `firstSeen`, `lastSeen`, `topEvidence[{key,type,label,count,weight}]` (≤ 6), `domains[]`, `advertisers[]`, `cohesion`, `strongComponents`, `attributes`.
- `attributes` (`CampaignAttributes`, `model.ts`): `personas[{id,name,count}]`, `cyrillic` (reklamy z cyrylicą w komentarzach strony lub parametrach kampanii), `cloakingSuspected` (reklamy z podejrzeniem cloakingu), `deepfakeScoreMax` (najwyższy wynik deepfake z danych wejściowych). To atrybuty do filtrowania i priorytetów, nie dowody łączące.
- `evolution?` (opcjonalne, od zadania i1fix, `CampaignEvolution` w `model.ts`, liczone w `runBuildGraph` przez `campaignEvolution` z `lib/graph/evolution.ts`; tylko kampanie z ≥ 2 reklamami): `{ stable: CampaignTraitGroup[], changing: CampaignTraitGroup[] }`, gdzie `CampaignTraitGroup = { type, values: [{ id, label, firstSeen, items }] }`. `stable`: typy śladu z wartościami wspólnymi dla wszystkich reklam kampanii (podane tylko te wartości), `changing`: typy, w których jakaś wartość nie występuje we wszystkich reklamach (wszystkie wartości typu, w kolejności `firstSeen` = data pierwszej reklamy z tą wartością; pierwsza to start, każda następna to zmiana). Typ ze wspólną wartością i dodatkową jest w obu listach. Liczą się tylko relacje bezpośrednie (`relation = 1`): link wychodzący albo strona zaparkowana wskazuje cudzą stronę, nie ślad kampanii. Pole służy widokowi „Ewolucja kampanii”; przeglądarka może policzyć to samo z `graph.json` i działa bez pola. Przykład z testu (`evolution.test.ts`): trzy materiały z tym samym trackerem i backendem, trzema domenami i dwiema personami → `stable: [endpoint, tracker]`, `changing: [domain (3), persona (2)]`.
- `assignments: Record<itemId, campaignId>` — wszystkie reklamy, również pojedyncze (kampania 1-elementowa).

`near-misses.json` (`NearMissesFile`, `model.ts`; obok `campaigns.json`, każdy `build-graph` go zapisuje): format w §5.6.

`data/summaries.json` (`scripts/summarize.ts`): `{generatedAt, provider, model, summaries: Record<campaignId, CampaignSummary>}`; schemat w `lib/pipeline/summary.ts`: `persona`, `narrative`, `infrastructure`, `timeSpan`, `riskNotes` oraz `campaignId`, `model`, `generatedAt`.

---

## 3. Moduły

### 3.1 `lib/osint/*`

| Moduł | Co robi | Wejście → wyjście | Decyzje i limity |
|---|---|---|---|
| `ip.ts` | parsowanie IPv4/IPv6, CIDR, klasyfikacja publiczne/niepubliczne | string → `{public, reason}` | zakresy niepubliczne `ip.ts` (v4) i  (v6); IPv4 osadzone w IPv6 (mapped, NAT64, 6to4) sprawdzane rekurencyjnie (`ip.ts`); IPv4 z wiodącymi zerami odrzucane (`ip.ts`) |
| `urls.ts` | normalizacja URL, refang, IDN, eTLD+1 | string → `NormalizedUrl \| null` | domyślny schemat `https` (`urls.ts`); usuwa parametry kliknięć (`utm_*`, `fbclid`, `gclid`…, lista `urls.ts`), sortuje pozostałe; `tldts` z `allowPrivateDomains: true`, więc `x.github.io`, `x.pages.dev` to osobne domeny; brak obsługi schematów innych niż http(s). Parametry kampanii są czytane z surowych URL-i przed normalizacją (`campaignParams.ts`) |
| `fetchPage.ts` | jeden GET na skok, ręczne przekierowania, ochrona SSRF | URL (+ opcjonalny `userAgent`) → `FetchPageResult` (nigdy nie rzuca dla błędów sieci) | budżet czasu 8 s na cały łańcuch (`fetchPage.ts`), limit 2 MiB **po dekompresji**, maks. 8 przekierowań i wykrywanie pętli, meta refresh śledzony przy opóźnieniu ≤ 10 s, gzip/deflate/br, wykrywanie kodowania znaków: nagłówek → BOM → `<meta charset>` w pierwszych 4 KB, UA przeglądarki albo podany, `accept-language` pl; SHA-256 surowej odpowiedzi do dowodów; `fetchBinary` bez meta refresh, limit 5 MiB; szczegóły SSRF w §11 |
| `extract.ts` | ekstrakcja z HTML i tekstu, bez parsera HTML (tokenizer regex) | HTML + baseUrl → `PageExtract`; tekst → `TextExtract` | trackery `extract.ts` (GA4 w kontekście 4–15 znaków albo goły `G-` + 10 znaków z cyfrą i literą, UA, GTM 4–9, AW 9–11 cyfr, piksel Meta 10–20 cyfr, TikTok 15–25, Yandex 5–10 cyfr); e-maile bez TLD plikowych; telefony PL: z `+48/0048`, bez prefiksu tylko w formacie 3-3-3 lub stacjonarnym z poprawnym prefiksem (regexy ), odrzuca końcówki `000000` i liczby przed walutą; inne kraje tylko z `tel:`; Telegram, WhatsApp; `visibleText` ≤ 5000, `outboundUrls` ≤ 300; `jsRedirects` wyciągane statycznie, **niewykorzystywane w grafie** |
| `pagekit.ts` | odcisk kitu strony, statycznie (JS nie jest wykonywany) | HTML + URL strony → `PageKit` (`pagekit.ts`) | backendy: `<form action>` (z `<base href>`), `fetch`, `XMLHttpRequest.open`, axios, `$.ajax/$.post/$.get` i literały wyglądające na API (`/api/`, `submit`, `lead`, `register`, `postback`…, `pagekit.ts`) w skryptach inline; ścieżka normalizowana (`normalizeEndpointPath`): UUID → `<uuid>`, liczby → `<n>`, ≥ 16 hex → `<hex>`, ≥ 16 znaków litery+cyfry → `<id>`; klucz `host+ścieżka` albo `*ścieżka` dla tej samej domeny; simhash DOM: nazwy tagów otwierających w kolejności, shingle po 4, md5, 64 bity, `null` poniżej 25 tagów; komentarze HTML i JS normalizowane (`normalizeComment`, : ≥ 12 znaków, z literą, bez komentarzy warunkowych); flaga cyrylicy; limity: 50 backendów, 100 plików, 100 ukrytych pól, 50 komentarzy |
| `domainPattern.ts` | szablon nazwy domeny | domena → `DomainTemplate \| null` (`domainPattern.ts`) | etykieta dzielona na litery, cyfry i separatory; cyfry → `<n>`, słowa Lorem Ipsum ≥ 4 znaki (ok. 330 słów, `domainPattern.ts`) → `<lorem>`; dwa warianty: z TLD (`finance<n>-<lorem><n>.sbs`) i bez (`finance<n>-<lorem><n>.*`); `null` bez placeholdera, dla IP i etykiet punycode |
| `campaignParams.ts` | parametry kampanii z URL-i | lista URL-i → `CampaignParam[]` (`campaignParams.ts`) | nazwy kanoniczne: `utm_*`, `sub1`–`sub5`, `aff_id`, `click_id`, `offer_id`, `campaign_id/name`, `adset_id/name`, `ad_id/name`, `pixel_id` z aliasami (`subid`, `aff_sub3`, `ClickID`, `cmp`, `crid`, `fb_pixel`…, `campaignParams.ts`); czyta też fragment `#…`; flagi cyrylicy i nierozwiniętych makr `{{…}}`; deduplikacja po nazwie i wartości bez rozróżniania wielkości liter; wartość ≤ 120 znaków |
| `crypto.ts` | portfele z walidacją sum kontrolnych | tekst → `WalletMatch[]` | BTC Base58Check (wersja 0x00/0x05), bech32/bech32m (BIP-173/350), ETH (EIP-55 dla mieszanej wielkości liter, keccak z `@noble/hashes`), TRON (Base58Check, 0x41); regexy z granicami `crypto.ts`; adresy-zaślepki ETH odrzucane |
| `dns.ts` | A/AAAA/CNAME/NS/MX/TXT przez `node:dns/promises` | nazwa → `DnsRecords` | limit 5000 ms na zapytanie (`dns.ts`), `tries: 1`, ENODATA/NXDOMAIN → pusta lista, resolvery z `DNS_SERVERS`; cache 1 dzień, nie zapisuje wyniku, gdy wszystkie zapytania padły |
| `rdap.ts` | RDAP przez bootstrap `https://rdap.org/domain/` (`rdap.ts`) | domena → `RdapInfo \| null` | limit 10 s, 404 → `null`, parsowanie rejestratora/zdarzeń/NS/abuse; cache 7 dni |
| `ct.ts` | crt.sh JSON: wyszukiwanie domeny (`lookupCt`, `ct.ts`) i wzorca z `%` (`searchCt`) | domena lub wzorzec → `CtResult \| null` | wspólna pętla zapytań `queryCrtSh`: limit 30 s, 3 ponowienia, backoff `2 s·2^próba + jitter ≤ 0,5 s`, `Retry-After` ≤ 60 s; ponawia przy 429/5xx, błędzie sieci i odpowiedzi nie-JSON; inne 4xx → `null`; scala precert/leaf po numerze seryjnym; ≤ 200 certyfikatów, dla wzorca ≤ 1000 i `exclude=expired`; wzorzec: `%` tylko na początku lub końcu, strona crt.sh „Unsupported use of '%'” kończy zapytanie bez ponowień (`CrtShQueryError`); cache 1 dzień, tylko wyniki nie-null |
| `asn.ts` | Team Cymru przez DNS TXT | IP → `AsnInfo \| null` | zapytania `<odwrócone IP>.origin.asn.cymru.com` / `origin6` i `AS<n>.asn.cymru.com` (`asn.ts`); nazwa AS w osobnym wpisie cache; cache 7 dni |
| `archive/` | kopie martwych stron: `wayback.ts` (CDX + wariant `id_`), `urlscan.ts` (wyszukiwanie skanów, strona wyniku), `index.ts` (wybór i ocena kopii), `http.ts`, `config.ts` | adres (+ `before`/`after`) → `ArchivedCopy[]` (`source`, `url`, `sourceUrl`, `capturedAt`, `fetchedAt`, `html?`, `requests?`, `screenshotPath?`, `meta?`, `rejected?`, `notes?`) | zob. §3.2 |
| `payerKind.ts` | rodzaj płatnika i beneficjenta z biblioteki reklam (`classifyPayer`, `summarizePayers`, `isPolishAd`) | nazwa + kontekst reklamy → `{kind, reasons}`; reklama → `payerKinds`, `payerEqualsBeneficiary`, `payerSuspicious` | kolejność rodzajów: `placeholder`, `gibberish`, `person_foreign_script`, `person`, `generic_corp`, `matches_page`, `registered_form`, `other` (pierwszy pasujący wygrywa); słowniki w `DEFAULT_PAYER_KIND_CONFIG`, ogólne, nie z napisów ze spraw; płatnik to samodeklaracja (§4.22) |

### 3.2 Krok archiwalny (`lib/osint/archive/*`, `lib/pipeline/archiveContext.ts`, od 22.11.2026, zadanie i22)

Pasywny, opcjonalny krok: dla strony docelowej, której pobranie się nie udało (błąd sieci, NXDOMAIN, 4xx/5xx) albo która pokazuje planszę blokady lub parkingu (te same wzorce co `lists.parkingPatterns`), `enrichItems` (opcja `archive`) pyta źródła o publiczną kopię i zasila cechy strony z kopii tą samą ścieżką co zapisana strona (HTML → `extract`/`kit`, `requests` → zasoby jak żądania z HAR). Pobranie na żywo zostaje w `PageInfo.fetch` (z błędem); kopia jest w `PageInfo.bodySource` (`urlscan`/`wayback`) i `PageInfo.archive` (pochodzenie bez treści, `used`); wynik kroku per rekord w `ItemEnrichment.archive` (`used`/`rejected`/`none`/`skipped` + powód). Pominięte są adresy odrzucone przez fetcher (`blocked`, `invalid-url`).

- **Źródła** (interfejs `ArchiveSource`: `available()`, `lookup(url, {before, after})`; `before` to czas, do którego kopia ma być najbliższa, `after` najwcześniejszy dopuszczony). Kolejność: urlscan, Wayback; kopia bez treści strony ustępuje kopii z treścią z kolejnego źródła. Błąd usługi to `ArchiveLookupError` z powodem (nigdy cichy `catch`); powód trafia do kroku `archive` w raporcie kroków i do `ArchiveOutcome.tried`.
- **Wayback**: CDX (`filter=statuscode:200`, `sort=closest`, `fl=timestamp,original`), wybór kopii najbliższej `before`, pobranie `…/web/<ts>id_/<adres>`, dekompresja po sygnaturze bajtów (gzip, zstd przez `node:zlib`, limit rozmiaru po dekompresji), limit czasu 45 s i jedno ponowienie przy timeoucie, błędzie sieci i 5xx (504); 429 bez ponowienia. `capturedAt` z timestampu CDX.
- **urlscan**: wyszukiwanie `page.url:"<pełny adres>"`, potem `page.domain:` (przy ≥ 100 wynikach okna dat ≤ 4 dni, najbliższe `before` najpierw, najwyżej 8 okien); skan pasuje, gdy host i ścieżka są takie same (adres z innym zapytaniem to ta sama strona; inna ścieżka domeny to inna strona). Dla najlepszej kopii: strona wyniku → lista żądań z hashami zasobów (`requests[]`, port `usres2har.py`), zrzut (gdy podano katalog), DOM z `/dom/<id>/` tylko z `URLSCAN_API_KEY`. Jedna kolejka z przerwą 2,5 s; 429 ustawia pauzę do `Retry-After` (domyślnie 1080 s), w której źródło nie wysyła nic, a `available()` podaje powód i `howToGetAccess`. Nigdy nie zleca skanu.
- **Cache** (`withCache`, namespace `archive`): 7 dni dla znalezionych kopii, 6 godzin dla braku; błędy nie są cache'owane.
- **Ocena kopii** (`judgeCopy`, czysta funkcja): odrzuca kopię z `capturedAt` < RDAP `created` („kopia sprzed rejestracji domeny”; bez `created` próg to najstarszy certyfikat z CT) i kopię starszą od `firstSeen` o więcej niż `archiveMaxAgeDays` (30). Gdy źródło daje tylko odrzucone kopie, pyta jeszcze raz z `after` = `earliestAcceptable` (kopia obecnego właściciela). Odrzucona kopia zostaje w `PageInfo.archive` (`used: false`, `rejected.reason`), nie zasila cech. Przy porównaniu z RDAP `DomainInfo.reRegistered = true`, a węzeł `domain` ma `data.reRegistered`. RDAP do tej kontroli: `sources.rdap`, a gdy brak rekordu (przebieg na zapisanych plikach), `archive.rdap` (`lookupRdap`, pasywnie, cache 7 dni).
- **Włączanie** (`archiveStepOptions`): `analyze-material --archive`, `enrich`/`pipeline --archive-lookup` (`--archive` w `enrich` to katalog z HTML stron), zmienna `ARCHIVE_SOURCES` (`urlscan,wayback`; sama włącza krok), `RunnerSpec.archive` w GUI. `ANALYZE_OFFLINE=1` albo `--offline` pomija krok z powodem „tryb offline”; bez sieci zapytania kończą się powodem w kroku `archive`. Bez flagi nic się nie zmienia (próbka i 25 spraw dają ten sam graf i kampanie).
- **Wynik `analyzeMaterial`**: krok `archive` w `steps` („kopia z wayback z 2026-10-18” albo powód pominięcia), `MaterialItemResult.archive` (status, powód, pochodzenie kopii), `bodySource`, `features.bodySource`. Martwy adres bez kopii, treści i identyfikatorów: `insufficient` z powodem „brak strony i brak kopii archiwalnej” (`Sufficiency.archiveNone`; bez kroku archiwalnego adres nadal liczy się jako adres).
- **Pomiar** (22.11.2026, dwa materiały z kopią w Wayback, baza 25 spraw): kopia Wayback dała 20/20 i 22/22 pivotów z katalogu (te same rodzaje, te same silne, ten sam werdykt); kopia urlscan bez klucza 4 z 20 i 13 z 22 (brak `comment`, `endpoint`, `hidden_fields`); 6 z 8 martwych adresów bez materiału nie miało kopii w żadnym archiwum (`insufficient`). Testy: `lib/osint/archive/*.test.ts` (nagrane, zsyntetyzowane odpowiedzi w `tests/fixtures/archive/`), `lib/pipeline/enrich.test.ts`, `lib/pipeline/archiveRules.test.ts`, `tests/archiveMaterial.offline.test.ts`.

### 3.3 `lib/media/*`

`imageHash.ts`:
- dHash: skala szarości, miniatura 9×8 (`fit: fill`), bit = `piksel[x] < piksel[x+1]`, 64 bity (`imageHash.ts`). aHash: 8×8, bit = `piksel > średnia` (`imageHash.ts`).
- Przed hashowaniem: `autoOrient` (EXIF), tło białe pod przezroczystością (`imageHash.ts`). Limit `limitInputPixels` 50 Mpx chroni przed bombą dekompresyjną (`imageHash.ts`).
- `hammingDistance` porównuje ciągi hex (`imageHash.ts`). `shodanFaviconHash` liczy MurmurHash3 x86_32 z base64 w liniach po 76 znaków, jak Python `base64.encodebytes` (`imageHash.ts`).
- Favicon ICO: brany jest największy osadzony PNG (`imageHash.ts`). ICO zawierający tylko BMP daje `dhash = null`, ale `mmh3` i `sha256` są liczone. `hashFavicon` nie rzuca wyjątków (`imageHash.ts`).

Adaptery narzędzi zewnętrznych (opcjonalne, domyślnie wyłączone). Każde narzędzie jest wykrywane raz na przebieg; gdy go brakuje, krok jest cicho pomijany z jedną linią w logu (`lib/pipeline/enrich.ts`). Procesy uruchamia `execFile` bez powłoki, z limitem czasu i `SIGKILL` (`lib/media/tools.ts`). Nic nie jest pobierane z sieci.

| Plik | Narzędzie i wywołanie | Wynik | Limity |
|---|---|---|---|
| `ocr.ts` | `tesseract <plik> stdout -l pol --psm 3` (`ocr.ts`); wykrycie wersji i pakietu `pol` (`ocr.ts`) | tekst z kreacji, białe znaki scalone | 60 s na obraz |
| `asr.ts` | `whisper-cli` (whisper.cpp) z modelem `WHISPER_MODEL`, domyślnie `~/models/whisper/ggml-large-v3-turbo.bin` (`asr.ts`); wejście inne niż WAV 16 kHz mono jest najpierw konwertowane przez `ffmpeg -ac 1 -ar 16000 -c:a pcm_s16le` (`asr.ts`); bez whisper-cli `mlx_whisper`, ale tylko z modelem już lokalnym, żeby nie było pobierania (`asr.ts`) | transkrypcja po polsku, bez znaczników czasu (`asr.ts`) | 10 min na plik (`asr.ts`), pliki tymczasowe w katalogu systemowym, sprzątane |
| `audioFp.ts` | `fpcalc -raw -json -length 120` (Chromaprint, `audioFp.ts`) | surowy odcisk; podobieństwo = najlepsze `1 − błąd bitowy` po przesunięciach ±40, przy nakładce ≥ 20 wartości (`audioFp.ts`) | 60 s na plik |

Teksty z OCR i ASR trafiają do ekstrakcji kontaktów i URL-i, do dopasowania person w trybie przybliżonym (§4.8) i do podobieństwa tekstu (`textOf`, `lib/graph/link.ts`). `scripts/media-smoke.ts` uruchamia każdy adapter na syntetycznym wejściu (§9).

### 3.4 `lib/cache.ts`

Plik `<CACHE_DIR>/<namespace>/<h[0:2]>/<sha256(klucz)>.json` z zawartością `{key, createdAt, expiresAt, value}`.
- Ochrona przed kolizją hashy (`cache.ts`) i sprawdzanie TTL (`cache.ts`).
- Zapis atomowy przez plik tymczasowy i `rename` (`cache.ts`). Równoległe wywołania tego samego klucza są deduplikowane (`cache.ts`).
- `null` jest cache'owany jako poprawna wartość (wynik negatywny), `undefined` nie jest.
- `CACHE=off|0|false|no` wyłącza cache (`cache.ts`).

| Przestrzeń nazw | TTL | Gdzie |
|---|---|---|
| `page` | 1 dzień, bez błędów `timeout`/`network`; klucz zawiera User-Agent (test cloakingu) | `lib/pipeline/sources.ts`,  |
| `dns` | 1 dzień | `dns.ts` |
| `rdap` | 7 dni | `rdap.ts` |
| `ct` | 1 dzień | `ct.ts` |
| `ct-search` | 1 godzina (backfill watchera CT) | `scripts/ct-backfill.ts` |
| `asn` | 7 dni | `asn.ts` |
| `imagehash` | 7 dni (tylko live, obrazy z URL) | `lib/pipeline/enrich.ts` |
| `ner` | 28 dni (klucz: dostawca, model, sha256 tekstu) | `lib/pipeline/enrich.ts` |
| `embed` | 28 dni | `lib/pipeline/steps.ts` |

### 3.5 `lib/text/*`

- `companyIds.ts` `extractCompanyIds`, `companyIdsOfMaterial`: NIP, REGON, KRS, IBAN i NRB, unijny VAT, numer spółki w UK, LEI i nazwy podmiotów z formą prawną z tekstu, kodu (jednoprzebiegowy `splitMarkup`: bez regexów po całym HTML, bo strony są niezaufane), JSON-LD i OCR; sumy kontrolne (§4.22). Wynik `CompanyId = { kind, value, valid, check, source, quote }`, `check` mówi, czy `valid` to suma kontrolna, czy tylko format.
- `normalize.ts` `normalizeForMatching`, kolejne kroki:
  1. NFKC i małe litery.
  2. Usunięcie URL-i (też `hxxp`) i e-maili.
  3. Zdjęcie diakrytyków i zamiana homoglifów cyrylica/greka (`normalize.ts`).
  4. De-leet (`normalize.ts`) tylko w tokenach mieszających litery z cyframi, `@` lub `$`, z wyjątkiem wzorca `^\d+[a-z]{1,3}$` (np. `100zl`, `24h`, `normalize.ts`).
  5. Wycięcie znaków innych niż litery i cyfry.
- `similarity.ts`: n-gramy znakowe 3–5 w granicach słów (`similarity.ts`). `idf = ln((1+n)/(1+df)) + 1` (`similarity.ts`), `tf = 1 + ln(count)` (`similarity.ts`), wektory normalizowane L2, cosinus przycięty do [0,1] (`similarity.ts`). N-gram nieznany modelowi dostaje maksymalne idf. Domyślnie `maxDf = 1`, czyli bez odcinania częstych n-gramów (`similarity.ts`).
- `persona.ts`: persona z tekstu, bez biometrii (§4.8).

### 3.6 `lib/graph/*`

| Plik | Rola |
|---|---|
| `model.ts` | typy grafu, `ENTITY_TYPES` (`model.ts`), etykiety PL (`model.ts`), `nodeId = "<typ>:<klucz>"`, typy podobieństwa (`model.ts`) |
| `config.ts` | wagi, progi, ustawienia kitu, listy infrastruktury współdzielonej, `mergeConfig` (`lib/graph/config.ts`) — §4, §10 |
| `weights.ts` | zniżki z list (`Discounter`), IDF, kara za powszechność, waga encji, noisy-OR — §4.3 |
| `link.ts` | budowa grafu, pivoty, pary, podobieństwo — §4 |
| `cluster.ts` | union-find + Louvain, kampanie i ich atrybuty — §5 |
| `explain.ts` | `explain(a, b)` i najsilniejsza ścieżka — §4.6 |
| `prune.ts` | przycięcie zapisywanego grafu — §5.7 |
| `eval.ts` | metryki — §6 |
| `unionFind.ts` | union-find (kompresja ścieżek, łączenie wg rozmiaru) |
| `testkit.ts` | budowanie małych zbiorów `EnrichedDataset` w testach (także kit, persony, parametry, CNAME) |

### 3.7 Biblioteki reklam (`lib/adlib/*`, `scripts/adlib.ts`, `scripts/py/google_atc.py`, `scripts/py/ad_library_search.py`, od 22.11.2026, zadanie i13)

Wspólny interfejs do publicznych bibliotek reklam: wyszukiwanie po frazie, reklamodawcy, kraju i dacie oraz zamiana rekordu biblioteki (`AdRecord`) na materiał do analizy. Zakres według decyzji właściciela: Google i Meta; adaptery TikTok i X (P2) są i działają na syntetycznych danych, ale formaty ich odpowiedzi nie były sprawdzone na żywo ([ZRODLA-METADANYCH.md](ZRODLA-METADANYCH.md)).

| Plik | Rola |
|---|---|
| `types.ts` | `AdRecord`, `AdSearchQuery`, `AdLibrarySource` (`available`, `search`, `getAd`) |
| `index.ts` | `createSources`, `searchSources` (źródło niedostępne trafia na listę `skipped` z powodem; błąd jednego źródła nie zatrzymuje reszty), `defaultQueries` (domyślne frazy z `config.ts` i nazwiska z listy osób) |
| `meta.ts` | Meta: `search` przez `ad_library_search.py` (MetaAdsCollector, bez klucza), `getAd` przez istniejący `lib/osint/adLibrary.ts`, opcjonalnie kreacja z yt-dlp (`ytdlp.ts`) |
| `google.ts`, `scripts/py/google_atc.py` | Google: publiczny zbiór BigQuery; limit bajtów, poziomy szczegółowości, pamięć podręczna wyniku per zapytanie (`lib/cache.ts`, TTL 24 h); bez poświadczeń `available() = false` z instrukcją |
| `tiktok.ts` | TikTok: token klienta z kluczy aplikacji i zapytanie do API biblioteki; bez kluczy `available() = false` z instrukcją wniosku; format niesprawdzony na żywo |
| `x.ts` | X: import pliku CSV z repozytorium reklam (`X_ADS_FILE`, `--x-file`); kolumny dopasowane luźno, niesprawdzone na prawdziwym eksporcie |
| `toItem.ts` | rekord → kolumny → `Item` (przez `normalizeRecords`, bez drugiego parsera) |
| `caseDir.ts` | `adRecordToCaseDir`: folder sprawy z `adlib.json` i lokalnymi kreacjami, czytany przez `caseImport.ts` (adres docelowy z rekordu, kolumny `ad_*` i `advertiser_*` w `input.json`) |
| `record.ts` | wczytanie `AdRecord` z JSON-a |
| `config.ts` | limity, listy i domyślne frazy (bez liczb w kodzie adapterów) |
| `testkit.ts` | ścieżka nagranych odpowiedzi: `data/examples/adlib/` (poza `data/sample/`, które `sample:generate` kasuje i buduje od nowa) |

**Graf: wybór bez nowego typu węzła.** `meta_ad` to identyfikator reklamy z `fbclid` (Marketing API), a nie identyfikator biblioteki, więc go nie rozszerzamy. Identyfikator reklamy w bibliotece już jest `campaign_param` `ad_library_id=<id>` (Meta, z OCR zrzutu); inne platformy dostają ten sam typ z platformą w kluczu: `ad_library_id=google:CR…` (ten sam identyfikator na jednej platformie to duplikat, ten sam ciąg na dwóch platformach to dwie różne reklamy). Reklamodawca ma stały klucz `<platforma>:<id konta>` (u Google `AR…`) zamiast nazwy; nazwy wyświetlane zbierają się w `names`, a `legalName`, `location`, `verified` są atrybutami węzła, widocznymi w GUI jako cechy materiału (`adAdvertiser*`) i w paczce dowodów (`observations.accounts[].library_account`). Płatnik z biblioteki zasila `ad_payer`: Meta bez zmian (klucz = nazwa), inne platformy z prefiksem platformy; `ad_payer` jest w `notAloneKinds`, więc nie łączy kampanii sam. Wagi bez zmian (`advertiser` 0,6; `ad_payer` 0,65). Nowych typów węzłów nie ma, więc słowniki GUI (etykiety, kolory) nie wymagały wpisów; nowe cechy materiału mają etykiety w `lib/viewer/plain.ts`, `lib/viewer/families.ts` i `components/viewer/AnalyzeForm.tsx`.

**Google: koszt.** BigQuery liczy całe kolumny, więc skrypt wybiera najbogatszy poziom szczegółowości (`dates`, `regions`, `identity`, `lean`), który według próbnego uruchomienia (dry run, bez kosztu) mieści się w `ADLIB_BQ_MAX_BYTES` (domyślnie 10 GiB), i uruchamia zapytanie z `maximum_bytes_billed` równym temu limitowi. Gdy nie mieści się nawet `lean`, kończy komunikatem z szacunkiem. Pomiary i rozmiary kolumn: [ZRODLA-METADANYCH.md](ZRODLA-METADANYCH.md). Domyślne zapytania (`adlib search` bez `--keyword` i `--advertiser`) omijają Google.

**Dodatki (P2).** B-062: reklamodawca z biblioteki ma klucz po identyfikatorze strony (`meta:<page_id>`: z `--ad-library`, z `uploader_id` pliku `.info.json` yt-dlp albo z rekordu), więc zmiana nazwy strony go nie rozdziela; atrybuty węzła: `names`, `pageDeleted` (strona wyłączona = konto jednorazowe), `adsTakenDown` (liczba zdjętych reklam). B-298: gdy nazwa reklamodawcy zawiera imię i nazwisko albo pseudonim z listy osób, materiał dostaje atrybut `advertiserImpersonates` (id osoby; w GUI cecha „Reklamodawca podszywa się pod osobę”): atrybut, nie dowód kampanii, bez wpływu na łączenie (`ItemEnrichment.advertiserImpersonates`, `enrich.ts`). B-064: daty emisji z biblioteki są w `AdRecord.firstSeen/lastSeen` i w kolumnach `ad_first_shown`/`ad_last_shown` (cechy `adFirstShown`/`adLastShown`, osobno od daty zgłoszenia; start z yt-dlp dla reklamy znalezionej po identyfikatorze). B-063: `googleRpc.ts` (nieoficjalne RPC, domyślnie wyłączone) i `expand.ts`/`adlib expand`.

**Testy:** `lib/adlib/*.test.ts` (nagrane odpowiedzi w `data/examples/adlib/`), `lib/adlib/python.test.ts` (uruchamia `unittest` skryptów Pythona), `lib/graph/adLibraryTraces.test.ts`, `tests/adlibCrossPlatform.test.ts` (rekordy Mety i Google w jednej kampanii przez wspólną infrastrukturę), `tests/adlibPipeline.offline.test.ts` (wyszukiwanie → sprawy → `analyze-material`).

### 3.8 `lib/llm/*`

`ollama.ts` (czat, structured, embeddingi), `anthropic.ts` (Claude), `index.ts` (wybór przez `LLM_PROVIDER`, `embed()` zawsze przez Ollamę), `types.ts` (`LlmProvider`, `LlmError` z podpowiedzią). Szczegóły w §7.

### 3.9 `lib/pipeline/*`

| Plik | Rola i limity |
|---|---|
| `ingest.ts` | CSV/TSV/JSON/JSONL → `Item[]`. Separator wykrywany z `, ; \t \|` (`ingest.ts`). JSON: tablica albo obiekt z `items/data/ads/records/results` (`ingest.ts`). Mapowanie jawne ma pierwszeństwo, a automatyczne uzupełnia tylko niezmapowane pola kolumnami, których jawne nie zajęło (`ingest.ts`); synonimy w `ingest.ts`, w tym kolumny w stylu DROZD: persona, wynik deepfake i plik wideo (`ingest.ts`). Wynik deepfake: `0,91`, `0.91`, `91` i `91%` dają 0.91 (`normalizeScore`, `ingest.ts`); wartość nieczytelna daje ostrzeżenie (`ingest.ts`). Brak id → `h` + 12 znaków sha256 (`ingest.ts`). Duplikat id → `id__2` z ostrzeżeniem (`ingest.ts`). Wartość z kolumny obrazu bez `http(s)` trafia do `imagePath` (`ingest.ts`). Daty (`ingest.ts`): epoch s/ms, `dd.mm.rrrr[ hh:mm[:ss]]` (też z `/` i `-`, traktowane jako UTC), sama data ISO (UTC); wynik zawsze jako ISO UTC, ale ISO z godziną bez strefy (`2026-09-05 10:00`) jest interpretowane w czasie lokalnym maszyny. |
| `sources.ts` | `liveSources()` i `fixtureSources(dir)` za wspólnym interfejsem. Offline: `http.json` (URL → status/nagłówki/plik, opcjonalne warianty zależne od User-Agent, `sources.ts`), `dns.json`, `cymru.json`, `rdap/<domena>.json`, `crtsh/<domena>.json`. Nieznany URL → 404 „not in fixtures” (`sources.ts`). W trybie offline działają prawdziwe parsery i logika przekierowań. |
| `enrich.ts` | (1) dla każdej reklamy, współbieżnie po 4 (`enrich.ts`): obraz i opcjonalnie OCR, wideo z ASR i odciskiem audio, ekstrakcja z treści reklamy, OCR i ASR, landing (`landingUrl` albo pierwszy URL z treści), strona deduplikowana po URL z ekstrakcją, kitem, archiwum HTML, faviconem i opcjonalnym testem cloakingu (`enrich.ts`), persony (`enrich.ts`), parametry kampanii z linku, łańcucha, strony końcowej i URL-i z treści (`enrich.ts`); (2) DNS A/AAAA/CNAME hostów z linku, łańcucha, strony końcowej i URL-i z treści (limit 8, `enrich.ts`) i łańcuch CNAME do 4 skoków (`enrich.ts`); (3) dla domen NS/MX/TXT, RDAP (limit 2, `enrich.ts`), CT (limit 1, `enrich.ts`); (4) ASN dla IP (limit 8), w trybie live pomijane dla IP niepublicznych (`enrich.ts`). NER przez LLM po jednym wywołaniu naraz (`enrich.ts`), adaptery mediów po dwa (`enrich.ts`). Flagi `skip`: `page, favicon, image, dns, rdap, ct, asn`. Błędy trafiają do `errors`, nic nie przerywa przebiegu. |
| `steps.ts` | kroki CLI i zapis JSON. `runEnrich` wczytuje listę person i NER (`steps.ts`). `graph.json` jest zapisywany bez wcięć (`steps.ts`). Embeddingi z cache i powrotem do TF-IDF przy błędzie (`steps.ts`). Ewaluacja czyta etykiety z węzłów reklam (`steps.ts`). |
| `analyze.ts` | dopasowanie nowej reklamy (§8.3) |
| `summary.ts` | schemat zod streszczenia (§7) |
| `types.ts` | typy plików pośrednich (§2) |

### 3.10 `scripts/*`

Cienkie nakładki CLI na `steps.ts` i moduły (§9). `_cli.ts` używa `node:util parseArgs` w trybie `strict`: nieznana flaga kończy się kodem 2. `gen-sample.ts` generuje syntetyczną próbkę, a na starcie **usuwa cały `data/sample/`** (`scripts/gen-sample.ts`). Oprócz reklam, obrazów i fixtures zapisuje listę person (`personas.json`), syntetyczne dżingle WAV bez mowy (`media/`), leksykon i plik demo watchera CT (`ct-lexicon.json`, `ct-stream.jsonl`). `llm-smoke.ts` i `summarize.ts` korzystają z LLM. `evidence.ts` eksportuje paczkę dowodów (§15). `ct-watch.ts`, `ct-backfill.ts` i wspólny `_ct.ts` obsługują watcher CT (§16). `media-smoke.ts` sprawdza adaptery mediów na żywo.

### 3.11 `app/*`, `components/viewer/*`

- `app/page.tsx` **nie jest statyczny**: dane (`graph.json`, `campaigns.json`, katalog `VIEWER_DATA_DIR`) czyta przy każdym żądaniu przez `lib/viewer/data.ts`, więc po `bun run base` albo `pipeline` wystarczy odświeżyć stronę (bez ponownego `bun run build`). Bez bazy strona działa i podpowiada uruchomienie `bun run base`. Interfejs ma zakładki „Analizuj materiał”, „Kampanie”, „Graf powiązań”, „Porównaj”, „Jak to działa” i „Tryb eksperta” (`components/viewer/Shell.tsx`, opis: [GUI.md](GUI.md)); API zadań to `POST /api/material`, `GET /api/material/[job]` i `.../image`.
- **Widoki z zadania i2fix** (opis dla użytkownika: [GUI.md](GUI.md)). Logika to czyste funkcje w `lib/viewer/`, komponenty tylko ją rysują:
  - `fields.ts` tłumaczy nowe pola backendu na zdania: źródło konta platformy (`platformAccountSource`) i ostrzeżenie najemcy, „podobna twarz do X” i „głos podobny do X” (`faces`, `voices`; nigdy „to jest X”), narracja (`NARRATIVE_TOPIC_LABEL`), most (`Campaign.bridge`), najsłabsze ogniwo (`minInternalScore`, `weakestMember`), wiek domeny i certyfikatu względem emisji, podrabiana marka, etykieta łącza `variant` i węzła pliku kreacji (`exactFile`). `plain.ts` nazywa przesłankę „ten sam plik reklamy” po prefiksie `sha256:` węzła.
  - `evolution.ts`: `evolutionRows` (per materiał: co zmieniło się względem wszystkich wcześniejszych, a co zostało; rodzaje cech w `TRAIT_KINDS`; materiały wg `firstSeen`), `campaignTimeline` (emisje, rejestracje domen z „N dni przed emisją”, certyfikaty), `traitMatrix` (materiały × wspólne ślady, od najsilniejszych, limit `MATRIX_MAX_COLUMNS`). Liczone z `graph.json` (krawędzie skierowane od materiału, bez `links_to`); `Campaign.evolution` z backendu to agregat per typ i GUI go nie potrzebuje. Komponent: `CampaignEvolution.tsx` w karcie kampanii.
  - `clickRoute.ts` + `clickRouteFile.ts` + `GET /api/click-route?id=[&job=]`: łańcuch reklama → link śledzący → przekierowania → przynęta/formularz/sklep z `enriched.json` (bazy albo `<zadanie>/praca/pakiet/`), status z `fetch`, wiek domeny z RDAP `created` (świeża: do `RECENT_DOMAIN_DAYS` = 30 dni przed emisją), ostrzeżenie o cloakingu. Komponent: `ClickRoute.tsx`.
  - `addToBaseJob.ts` + `addToBaseView.ts` + `POST /api/add-to-base { jobId, ids, force? }`: runner (`materialRunner.ts`) zapisuje `<praca>/dodaj/analiza.json` (`onAnalyzed`), trasa woła `addToBase` (`lib/pipeline/addToBase.ts`, źródło `gui`) i zwraca `messages` (co dodano, czego nie i dlaczego). Baza przykładowa i wynik „Wczytaj przykład” są tylko do odczytu (403 / przycisk wyłączony), pisanie wymaga `VIEWER_DATA_DIR` na kopii. Test: `tests/addToBaseApi.offline.test.ts`. Komponent: `AddToBaseButton.tsx` (po sukcesie `router.refresh()`).
  - Dalsze (P2): `scale.ts` (skala werdyktu, `nearestCampaignOf`, próg grupy z opisu reguł), `compareView.ts` (udział rodzin, `markShared`), `authorNotes.ts`, `ctLead.ts`, `recognized.ts` + `recognizedFile.ts` (`GET /api/recognized`, tylko liczby), `baseQuality.ts` (`GET /api/base-quality`), `decisions.ts` + `decisionsFile.ts` (`/api/decisions`, blokada w `POST /api/evidence`), `thresholdPreview.ts` (`GET /api/threshold-preview`, `clusterCampaigns` z innym `minLinkScore`), `reducedGraph.ts` (graf zredukowany, `reducedToElements` w `graphView.ts`).
- `components/viewer/Shell.tsx` trzyma stan w adresie: `?tab=analyze|campaigns|graph|compare|how|expert|ct|people|quality`, `?job=<id>` (wynik analizy), `?a=<id>&b=<id>` (porównanie dwóch materiałów), `?k=K01` (kampania), `?panel=ct` (nowe domeny z watchera CT). Starsze linki z `?n=` i `?p=` otwierają graf. Widok eksperta (`Viewer.tsx`, `?tab=expert`) zachowuje stary układ z filtrami i grafem Cytoscape.
- Domyślne ustawienia widoku (`Viewer.tsx`): kolor wg kampanii, „tylko współdzielone encje”, „ukryj niepowiązane reklamy”.
- Panel boczny ma zakładki „Szczegóły | Porównaj reklamy | Nowa reklama | Nowe domeny” (`Viewer.tsx`).
- `graphView.ts` definiuje encję „użyteczną”: `df ≥ 2` albo leżącą na ścieżce do takiej encji. Filtr persony pokazuje tylko kampanie z daną personą (`graphView.ts`).
- `GraphCanvas.tsx`: Cytoscape i fcose, ładowane dynamicznie w przeglądarce; Shift+klik w reklamę dodaje ją do porównania (`GraphCanvas.tsx`).
- `DetailsPanel.tsx`: rozkład wagi z czynnikiem powszechności (`DetailsPanel.tsx`), zniżki, ≤ 12 powiązań reklamy z ≤ 4 dowodami każde, ścieżki dowodu (`DetailsPanel.tsx`). Dla reklamy sekcja „Atrybuty (do filtrowania, nie dowody łączące)” (`DetailsPanel.tsx`): persony ze źródłem, wynik deepfake opisany jako wynik modelu, cyrylica, werdykt cloakingu z powodami, URL końcowy, simhash DOM, fragmenty OCR i ASR. Dla nowych typów encji polskie etykiety pól i krótkie objaśnienie (`DetailsPanel.tsx`).
- `ComparePanel.tsx`: dwie reklamy (wyszukiwarki pogrupowane po kampaniach, Shift+klik, przyciski w szczegółach), wynik `explain(a, b)` (`ComparePanel.tsx`): ta sama kampania czy nie, zapisane powiązanie z wagami i zniżkami, najsilniejszy łańcuch przez inne reklamy oraz „Wspólne encje” (`compare.ts`), także zdyskontowane. Wyjaśnia to brak scalenia, którego `graph.json` nie pokazuje, bo powiązania < 0.05 są odrzucane. Przycisk „Kopiuj link”.
- `CampaignList.tsx`: na kampanii chipy person, liczby reklam z cyrylicą i z podejrzeniem cloakingu, najwyższy wynik deepfake; filtr persony (`CampaignList.tsx`). Starszy `campaigns.json` bez `attributes` też się renderuje (`compare.ts`).
- `CtFeedPanel.tsx`: zakładka „Nowe domeny” (§16.7).
- `next.config.ts`: `cacheComponents` (`next.config.ts`), `output: "standalone"` (`next.config.ts`), `outputFileTracingIncludes` dla `data/` (`next.config.ts`), `serverExternalPackages: ["sharp"]` (`next.config.ts`). Fonty systemowe, więc build działa bez sieci.

### 3.12 Opcjonalne kroki wzbogacania

Wszystkie są domyślnie wyłączone i włączane flagami `enrich`/`pipeline` (§9).

| Krok | Co robi | Gdzie |
|---|---|---|
| test cloakingu (`--cloaking`) | Dla każdej strony docelowej **dwa zwykłe GET-y** tym samym pobieraczem co reszta (ochrona SSRF, limity czasu, bajtów i przekierowań bez zmian): z User-Agentem crawlera platformy reklamowej (`facebookexternalhit/1.1`) i przeglądarki mobilnej (iPhone Safari) (`enrich.ts`). Podejrzenie, gdy różnią się adresy końcowe, simhash DOM różni się o więcej niż 12 bitów albo tylko jeden wariant kończy się kodem 2xx (`enrich.ts`). Wynik w `PageInfo.cloaking` i atrybucie `cloakingSuspected`; nie jest dowodem łączącym. Nie wykrywa cloakingu po IP, geolokalizacji ani JS. | `enrich.ts`,  |
| archiwum HTML (domyślnie włączone w CLI, `--no-archive` wyłącza) | zdekodowany HTML (UTF-8) każdej pobranej strony w `data/work/archive/<sha256 surowej odpowiedzi>.html`; ścieżka trafia do `PageInfo.archiveFile`, a paczka dowodów kopiuje plik i liczy jego SHA-256 | `enrich.ts` |
| lista person (`--personas plik.json`; z próbką domyślnie `data/sample/personas.json`) | dopasowanie nazwisk z odmianą w treści reklamy i strony, przybliżone w tekście z OCR/ASR | `enrich.ts`, §4.8 |
| NER (`--ner`) | imiona i nazwiska osób z tekstu przez skonfigurowany LLM, wynik w cache `ner` | `enrich.ts`, `persona.ts` |
| OCR (`--ocr`), ASR (`--asr`), odcisk audio (`--audio`) | adaptery z §3.3; ASR i odcisk tylko dla reklam z `videoPath` | `enrich.ts` |
| Głos mówcy (`--speaker`; galeria osób: §4.16) | SpeechBrain ECAPA-TDNN (VoxCeleb) i VAD przez `scripts/py/speaker_embed.py` w venv `.venv-speaker` (`scripts/py/setup-speaker.sh`, env `SPEAKER_PYTHON`, `SPEAKER_MODEL_DIR`); jeden proces na całą partię, cache `.cache/speaker`. Krawędź `similar_voice` przy cosinusie ≥ 0,6 (ten sam mówca 0,86–0,93, różni ≤ 0,34 na nagraniach testowych); para z tą samą ścieżką (Chromaprint) jest pomijana. Rodzaj treści (`campaignRules.contentKinds`, §5.4 pkt 5): sklonowany głos jednej osoby publicznej pasuje między niezależnymi operatorami, więc sam nie łączy | `lib/media/speaker.ts`, `adLibraryVoice.test.ts` |
| Twarze (`--faces`) | OpenCV YuNet (wykrywanie) i SFace (wektor 128 liczb) przez `scripts/py/face_embed.py` w venv `.venv-face` (`scripts/py/setup-face.sh`, env `FACE_PYTHON`, `FACE_MODEL_DIR`); jeden proces na całą partię, bez cache. Dopasowanie w TS (`matchFaces`) tylko do zamkniętej listy 31 osób publicznych (`data/faces/index.json`, zdjęcia z Wikimedia Commons); wynik to ramka i, dla podobnej twarzy, id osoby i podobieństwo. Szczegóły i próg z pomiaru: §4.14 | `lib/media/face.ts`, `face.test.ts`, `tests/faceGroup.offline.test.ts` |
| Biblioteka reklam Mety (`--ad-library`, tylko live) | MetaAdsCollector (`uv tool install meta-ads-collector`, env `META_ADS_PYTHON`) przez `scripts/py/ad_library.py`: zapytanie „Zobacz szczegóły reklamy” po samym identyfikatorze biblioteki, bez klucza API, działa też dla zdjętych reklam. Identyfikatory z kolumny `ad_library_id` i z OCR zrzutów. Zwraca płatnika i beneficjenta (DSA), `is_ad_taken_down`, naruszone zasady, zasięg w UE i grupę docelową; cache `.cache/adlibrary` (1 dzień). Płatnik to pivot `ad_payer` (waga 0,65, krawędź `paid_by`; w `notAloneKinds`, więc sam nie łączy kampanii, §4.12); dane trafiają do węzła reklamy (`adLibrary`, `adTakenDown`). Endpoint publicznej strony biblioteki: może przestać działać po zmianach u Mety | `lib/osint/adLibrary.ts`, `adLibraryVoice.test.ts` |

---

## 4. Model grafu

### 4.1 Encje

Klucz węzła to `<typ>:<klucz>`. Waga typu z `lib/graph/config.ts`. „Może być silny” oznacza, że `waga typu × czynnik listy ≥ strongThreshold (0.7)` przy czynniku 1.

| Typ | Klucz | Skąd (`link.ts`) | Waga typu | Może być silny |
|---|---|---|---|---|
| `item` | id reklamy |  | — | — |
| `url` | znormalizowany URL (link, każdy skok, strona końcowa, URL-e z treści) | `addUrlInfra :212` | 1.0 | tak |
| `host` | host ASCII |  | 0.95 | tak |
| `domain` | eTLD+1 (też domeny z linków wychodzących) | ,  | 0.95 | tak |
| `tracker` | `<rodzaj>:<id>` |  | 1.0 | tak |
| `wallet` | `<btc\|eth\|tron>:<adres>` | `addContacts :170` | 1.0 | tak |
| `email` | e-mail małymi literami |  | 0.9 | tak |
| `phone` | E.164 (też WhatsApp `wa.me`) |  | 0.9 | tak |
| `telegram` | `t.me/<nazwa>` lub zaproszenie; **zaproszenia do grup WhatsApp też trafiają tu** |  | 0.9 | tak |
| `endpoint` | backend formularza: `host+szablon ścieżki` (`leads-gate.test/api/v1/submit/<uuid>/`) albo `*szablon` dla ścieżki na tej samej domenie (`*/api/lead`) |  | 0.95 | tak dla innej domeny bez zniżki; ścieżka na tej samej domenie dostaje ×0.4, więc nigdy |
| `campaign_param` | `nazwa_kanoniczna=wartość` (wartość małymi literami); identyfikator reklamy w bibliotece: `ad_library_id=<id>` (Meta) albo `ad_library_id=<platforma>:<id>` (§3.7) |  | 0.8 | tak, gdy wartość nie jest zdyskontowana |
| `cert` | numer seryjny (lub id crt.sh), tylko certyfikaty, których SAN obejmuje ≥ 2 różne eTLD+1 |  | 0.8 | tak, ale darmowy CA daje ×0.6 → 0.48 |
| `imagehash` | dHash hex (identyczny obraz) |  | 0.65 | nie |
| `cname_target` | domena rejestrowalna celu CNAME; cel na sufiksie prywatnym PSL (np. `d123.cloudfront.net`) daje osobny węzeł na klienta, ale lista `cnameTargets` i tak go dyskontuje |  | 0.65 | nie |
| `advertiser` | nazwa reklamodawcy (NFKC, małe litery); dla rekordu biblioteki reklam z identyfikatorem konta `<platforma>:<id>` (np. `google:AR…`), stały mimo zmiany nazwy; atrybuty `legalName`, `location`, `verified`, `names` (§3.7) |  | 0.6 | nie |
| `ip` | IP kanoniczny |  | 0.6 | nie |
| `hidden_fields` | posortowane nazwy ukrytych pól po odrzuceniu ogólnych, tylko gdy zostają ≥ 2 |  | 0.6 | nie |
| `comment` | znormalizowany komentarz HTML/JS |  | 0.6 | nie |
| `domain_pattern` | szablon nazwy domeny (`zwrot<n>-<lorem><n>.example`) i wariant bez TLD (`….*`), tylko gdy obejmuje ≥ 2 domeny |  | 0.6; wariant `.*` ×0.85 | nie |
| `asset` | własny plik JS/CSS: ścieżka (ta sama domena) albo host+ścieżka |  | 0.55 | nie |
| `favicon` | `mmh3:<int>` |  | 0.5 | nie |
| `company_id` | `<rodzaj>:<numer>` (`nip:1234563218`; VAT z prefiksem PL to `nip`, inne kraje `vat:DE…`, `krs`, `regon`, `uk_company`, `lei`), numer znormalizowany; także z błędną sumą kontrolną | `link.ts` (cechy strony i OCR) | 0.5 | nie (§4.22) |
| `bank_account` | IBAN wielkimi literami bez spacji (polski NRB jako `PL` + 26 cyfr) | `link.ts` | 0.8 | nie: `nonStrongTypes` (§4.22) |
| `postal_address` | `<ulica bez rodzaju> <numer>\|<kod, same cyfry>\|<miasto>` małymi literami bez polskich znaków (`przykladowa 1\|00001\|miasto`); numer lokalu poza kluczem; tylko adres pełny (§4.23) | `link.ts` | 0.5 | nie: `notAloneKinds` |
| `nameserver` | **zbiór** NS domeny, posortowany i złączony ` + ` |  | 0.35 | nie |
| `persona` | slug imienia i nazwiska (`adam-testowy`) |  | 0.1 | nie (zawsze poniżej `minLinkScore`, §4.8) |
| `registrar` | nazwa małymi literami; seria rejestracji: `<rejestrator>\|<data pierwszej>` | ,  | 0.05; seria 0.3 (`config.ts`) | nie |
| `asn` | `AS<n>` | `link.ts` | 0.05 | nie |
| `crm_key` | sha256 klucza API CRM / sieci afiliacyjnej (etykieta: skrót `abcd…wxyz`, §4.18) | `lib/osint/crmKey.ts` | 0.95 | tak |
| `template_phrase` | znormalizowane zdanie szablonu, tylko gdy ≥ 2 domeny (§4.18) | `lib/text/templatePhrases.ts` | 0.45; z `oddity` ×1,3, maks. 0,65 | nie (`notAloneKinds`) |
| `kit_string` | znormalizowany komunikat programisty ze skryptu strony, tylko gdy ≥ 2 domeny (§4.19) | `lib/osint/kitStrings.ts` | 0.5; jedna przesłanka na parę: ≥ 2 wspólne albo 1 z ≥ 5 słów | nie (`notAloneKinds`) |
| `shared_doc` | klucz `usługa:id` dokumentu, formularza lub udostępnionego czatu z modelem językowym (§4.21) | `lib/osint/contactIds.ts` | 0.9 | tak |
| `onion` | adres .onion v3 (56 znaków) (§4.21) | `lib/osint/contactIds.ts` | 0.9 | tak |
| `fictional_expert` | klucz `tytuł:imię nazwisko` zmyślonego eksperta (B-313) | `lib/text/fictionalExpert.ts` | 0.75 | tak |
| `c2_host` | nazwa hosta serwera C2 trojana w skrypcie zestawu strony (B-333) | `lib/osint/stealerKit.ts` | 0.95 | tak |
| `messenger_invite` | klucz `usługa:id` zaproszenia lub konta (discord, signal, signal_group, viber, line) (§4.21) | `lib/osint/contactIds.ts` | 0.9 | tak |
| `cloaker_account` | `<cl_domain>/<cl_sid>` z `window.aio.visit.fields` (usługa cloakingu, §4.20); sam sid albo sama domena to atrybut | `lib/osint/landerConfig.ts`, `link.ts` | 0.9 | tak |
| `meta_token` | Token dostępu Meta (`EAA…`) z `token=`, `fb_capi_token` lub kodu strony (B-144), klucz = 12 znaków sha256; surowy token nigdy w grafie, paczce ani eksporcie (`lib/osint/metaToken.ts`, maska w `link.ts` i `pack.ts`) | `metaToken.ts`, `pagekit.ts`, `link.ts` | 0.95 | tak |
| `launcher_account` | UUID `visit.fields.launcher` / `visit.launcher`, tylko gdy różny od `owner_uuid` (§4.20) | `lib/osint/landerConfig.ts`, `link.ts` | 0.9 | tak |
| `affiliate_account` | klucz `team\|stream\|offer_uuid:host_sieci:wartość` (B-330, §4.21) | `lib/osint/affiliateIds.ts` | 0.9 | tak; para team/user ×0,7, reguła `affiliate_team` w `notAloneKinds` |
| `profit_claim` | posortowane pary `kwota/okres` (`3000/day\|4000/week`, §4.18) | `lib/text/profitClaims.ts` | 0.2 | nie (`familyOnlyKinds`) |

### 4.2 Krawędzie (`model.ts`)

| Typ | Od → do | Kiedy |
|---|---|---|
| `landing` | reklama → pierwszy URL | `link.ts` |
| `redirect` | URL → URL | kolejne skoki `redirectChain`, z opisem „HTTP 30x” albo „meta refresh” (`link.ts`) |
| `on_host`, `in_domain` | URL → host → domena | zawsze |
| `cname_to` | host → cel CNAME | z łańcucha CNAME hosta (`link.ts`) |
| `resolves_to`, `announced_by` | host → IP → ASN | z DNS A/AAAA i Team Cymru |
| `uses_ns`, `registered_with`, `has_cert`, `registration_burst`, `matches_pattern` | domena → NS / rejestrator / cert / seria / wzorzec nazwy | z DNS, RDAP, CT i szablonu nazwy (`link.ts`) |
| `uses_tracker`, `has_favicon`, `links_to` | URL końcowy → tracker / favicon / domena | z `PageExtract` strony końcowej |
| `posts_to`, `has_hidden_fields`, `loads_asset`, `has_comment` | URL końcowy → backend / ukryte pola / plik / komentarz | z `PageKit` strony końcowej (`link.ts`) |
| `mentions` | reklama lub URL końcowy → kontakt/portfel; reklama → URL z treści | treść reklamy lub strony |
| `carries_param` | reklama → parametr kampanii | `link.ts` |
| `mentions_persona` | reklama → persona | jedna krawędź na personę; wszystkie źródła w `evidence`, rozdzielone „; ” (`link.ts`) |
| `posted_by`, `has_image` | reklama → reklamodawca / hash obrazu | |
| `similar_image`, `similar_text`, `similar_dom`, `similar_audio`, `similar_voice` | reklama → reklama | §4.5 |

### 4.3 Pivot i waga

**Pivot** to każda encja (nie reklama), do której prowadzi ścieżka od reklamy. Funkcja `add` w `link.ts` zapisuje `{pivot, type, path, relation, how}`. Fakty z relacją 0 są odrzucane (`link.ts`), a duplikaty łączone przez zachowanie najwyższej relacji i najkrótszej ścieżki (`link.ts`). `df(e)` to liczba reklam z danym pivotem (`link.ts`).

Waga encji (`weights.ts`):

```
waga(e)   = waga_typu(typ) × czynnik_listy(e) × idf(df, N) × powszechność(df, N)
silny(e)  = waga_typu × czynnik_listy ≥ 0.7   ORAZ   df ≤ max(2, floor(0.5 · N))
idf(df,N) = 1                                   gdy N ≤ 2 lub df ≤ 2
          = clamp( (1 + ln(N/df)) / (1 + ln(N/2)), 0.2, 1 )   w pozostałych przypadkach   (weights.ts)
powszechność(df,N) = 1                          gdy N < 10 lub df/N ≤ 0.5
          = max(0.1, (1 − df/N) / 0.5)          w pozostałych przypadkach   (weights.ts)
czynnik_listy(e) = min(factor) ze wszystkich pasujących reguł, 1 gdy brak   (weights.ts)
```

Przykłady z próbki (N = 43):
- IP Cloudflare współdzielone przez 17 reklam: idf = (1+ln(43/17))/(1+ln(21,5)) = 0,4739, powszechność 1, waga = 0,6 × 0,02 × 0,4739 = 0,0057.
- Komentarz-znacznik generatora próbki jest na 41 stronach: idf 0,2575, powszechność 0,1. Nawet bez reguły w `data/sample/linking.json` (która daje ×0) waga wyniosłaby 0,6 × 0,2575 × 0,1 = 0,015. Kara za powszechność tłumi encje obecne niemal wszędzie, których nie ma na żadnej liście.

**Waga pary** dla wspólnego pivotu `e` (`link.ts`):
- pary są tworzone tylko gdy `2 ≤ df ≤ maxPivotDf (400)` i `waga > 0` (`link.ts`);
- wariant szablonu bez TLD (`….*`) nie dodaje dowodu parze, która ma już wspólny wariant z TLD tego samego szablonu (`link.ts`), więc ten sam wzorzec nie liczy się dwa razy;
- `w = waga(e) × min(relacja_A, relacja_B)` (`link.ts`);
- dowód jest silny, gdy `silny(e)` i `min(relacja) ≥ 1` (`link.ts`).

**Relacje** (mnożniki ścieżki):

| Sytuacja | Relacja | Gdzie |
|---|---|---|
| zwykła ścieżka (hosting, treść, parametry kampanii, persona) | 1 | `link.ts`,  |
| domena z linku wychodzącego strony | 0.4 (`outboundLinkFactor`) | `link.ts`, `config.ts` |
| strona końcowa zaparkowana: jej trackery, favicon, kontakty, linki, **kit strony oraz IP/ASN/NS hosta końcowego** | ×0.05 (`parkingFactor`) | `link.ts`, `config.ts` |
| URL na domenie z listy `domains` lub `endpointHosts` (platforma, skracacz, CDN, publiczny serwis): IP/ASN/NS/rejestrator/cert/cel CNAME tej domeny | × czynnik reguły (0 = całkowicie pomijane) | `link.ts`,  |
| domena wychodząca albo plik JS/CSS z innej domeny, której czynnik listy to 0 | węzeł w ogóle nie powstaje | `link.ts`,  |

Strona jest uznawana za zaparkowaną, gdy regex z `parkingPatterns` (`config.ts`) pasuje do pierwszych 4000 znaków tytułu, opisu i `visibleText` (`weights.ts`).

### 4.4 Listy infrastruktury współdzielonej (`lib/graph/config.ts`)

Kolumna „Linie” wskazuje `lib/graph/config.ts`, kolumna „Dopasowanie” — `lib/graph/weights.ts`.

| Lista | Linie | Dopasowanie | Domyślnie |
|---|---|---|---|
| `asns` | `config.ts` | numer ASN; `factor` dla węzła ASN, `ipFactor` dla IP ogłaszanych przez ten AS (`weights.ts`) | Cloudflare 13335/209242 (0.02/0.02), Akamai, Fastly, Imperva, Sucuri (0.05), CDN77, G-Core (0.1), Google/Amazon/Microsoft/Meta (IP 0.1–0.5), hostingi współdzielone (IP 0.3) |
| `ipCidrs` | `config.ts` | najbardziej szczegółowy CIDR (`weights.ts`) | opublikowane zakresy Cloudflare v4/v6 (0.02), Fastly 151.101/16, Vercel 76.76.21/24, Netlify 75.2.60.5, GitHub Pages 185.199.108/22, Firebase 199.36.158.100 (0.05), 1.1.1.0/24 (0.02, adres zastępczy zawieszonej domeny, §4.12) |
| `nameserverSuffixes` | `config.ts` | sufiks; zniżka tylko gdy **każdy** NS ze zbioru pasuje, brany najłagodniejszy czynnik (`weights.ts`) | Cloudflare, Route 53, GoDaddy, Namecheap, Google, Azure, NS1… (0.1); parkingi Sedo, ParkingCrew, Bodis, Above, Hostinger, Afternic, Dan (0.05); NS zawieszenia domen rejestratora `dyna-ns.net` (0.02, §4.12) |
| `certIssuers` | `config.ts` | podciąg w `issuer` | Let's Encrypt, ZeroSSL, Google Trust Services, cPanel, Buypass (0.6), Cloudflare (0.5) |
| `certSanMarkers` | `config.ts` | sufiks dowolnej nazwy z SAN | `cloudflaressl.com`, `incapsula.com` (0.02), `edgecastcdn.net` (0.05) |
| (reguła wbudowana) | — | SAN obejmuje > `maxCertDomains` (25) różnych eTLD+1 (`weights.ts`) | 0.05 |
| `registrars` | `config.ts` | podciąg w nazwie | 24 popularnych rejestratorów (0.6) |
| `domains` | `config.ts` | eTLD+1 równe regule lub jej subdomena; reguła bez kropki działa jako podciąg (`weights.ts`) | duże platformy, skracacze, CDN/biblioteki, popularne portale PL (0) |
| `pivots` | `config.ts` | dokładne id lub klucz węzła | pusta |
| `parkingPatterns`, `parkingFactor` | `config.ts` | regex (bez rozróżniania wielkości liter) | „domain for sale”, „buy this domain”, „domena na sprzedaż”…; relacja 0.05 |
| `endpointHosts` | `config.ts` | host backendu (sufiks); **ta sama lista dyskontuje domenę z linku wychodzącego i cel zasobu** (`domainDiscount`, `weights.ts`) | publiczne serwisy formularzy (web3forms, Formspree, FormSubmit, Getform, Jotform, Typeform, HubSpot, Mailchimp, EmailJS…), analityka i antyspam (Google Analytics/GTM, Meta, TikTok, Yandex, Clarity, Hotjar, reCAPTCHA, hCaptcha…), geolokalizacja IP (ipinfo.io, ip-api.com, ipify…), wszystkie 0.05 |
| `endpointGenericPaths` | `config.ts` | dokładny szablon ścieżki na tej samej domenie (`weights.ts`) | `/`, `/submit`, `/send`, `/api/lead`, `/contact.php`, `/register.php`, `/handler.php`… (0.05) |
| `hiddenFieldGeneric` | `config.ts` | nazwa pola (odrzucana przed złożeniem klucza, `weights.ts`) | tokeny CSRF i `__VIEWSTATE`, `_wpnonce`, `redirect`, `lang`, pola serwisów formularzy (`access_key`, `subject`, `_next`, `_honey`), `g-recaptcha-response`… |
| `assetLibraries` | `config.ts` | regex na nazwie pliku (`weights.ts`) | jQuery, Bootstrap, Popper, Swiper, GSAP, Vue, React, Font Awesome, intl-tel-input, Inputmask… (0.05); nazwy ogólne `style.css`, `main.js`, `app.js`, `bundle.js`… (0.1) |
| `commentPatterns` | `config.ts` | regex na komentarzu (`weights.ts`) | snippety trackerów (GTM, gtag, Meta Pixel, Yandex Metrika, Hotjar), WordPress/Yoast, „end of …”, banery cookies, nazwy sekcji szablonu (0.05) |
| `cnameTargets` | `config.ts` | sufiks celu (`weights.ts`) | CDN: CloudFront, Akamai, Fastly, Cloudflare, Azure CDN/Front Door, Bunny, CDN77, KeyCDN, StackPath, Imperva, Sucuri, Edgecast (0.02); hostingi: Azure Websites, Heroku, GitHub Pages, Netlify, Vercel, Cloudflare Pages/Workers, Firebase, Google, WP Engine, Shopify, Squarespace, Wix, Webflow, HubSpot, Zendesk, Elastic Beanstalk, AWS, GoDaddy Sites, Weebly, Blogspot (0.05) |
| `campaignParamGenericValues` | `config.ts` | dokładna wartość (`weights.ts`) | nazwy platform i kanałów (`facebook`, `fb`, `ig`, `google`, `tiktok`, `cpc`, `paid_social`, `email`…), wartości puste (`none`, `null`, `(not set)`) i makra Meta (`{{campaign.name}}`, `{{ad.id}}`…), czynnik 0.05 |
| `campaignParamWeakNames` | `config.ts` | nazwa parametru (`weights.ts`) | `utm_source`, `utm_medium` (0.2) |

Parametry kampanii mają też reguły wbudowane (`weights.ts`): wartość krótsza niż 3 znaki ×0.05, liczba 1–4 cyfrowa ×0.1, nierozwinięte makro ×0.1, wartość słowna (same litery, 3–25 znaków) ×0.75 (`kit.campaignParamWordFactor`). Wzorce nazw domen: szablon bez rdzenia literowego (< 3 litery, np. `<lorem><n>`) ×0.1 (od i14fix, §4.12; wcześniej 0.3), wariant bez TLD ×0.85 (`weights.ts`). Backend na tej samej domenie co strona: ×0.4; krótka ścieżka (≤ 2 segmenty) ma czynnik 0.5, ale zniżki się nie mnożą (wygrywa najmniejsza, `listFactor` w `weights.ts`), więc przy obecnych wartościach zostaje ×0.4.

Gdy kilka reguł podaje ten sam powód (np. Cloudflare przez CIDR i przez ASN), zostaje jedna zniżka (`weights.ts`).

### 4.5 Podobieństwo

| Sygnał | Warunek | Waga dowodu | Gdzie |
|---|---|---|---|
| obraz (dHash) | `1 ≤ Hamming ≤ imageHamming (10)`; `d = 0` jest pomijane, bo pokrywa je pivot `imagehash` | `0.6 × (1 − 0.5·d/10)`, czyli 0.57…0.30 | `link.ts`, `config.ts` |
| struktura strony (simhash DOM) | `Hamming ≤ dom.hamming (6)`; pary z tym samym URL-em końcowym są pomijane, bo łączy je już URL/host | `0.45 × (1 − 0.5·d/6)`, czyli 0.45…0.225 | `link.ts`, `config.ts` |
| ścieżka dźwiękowa (Chromaprint) | podobieństwo ≥ `audio.minSimilarity (0.85)` | `0.5 × (0.5 + 0.5·(sim−0.85)/0.15)`, czyli 0.25…0.50 | `link.ts`, `config.ts` |
| tekst TF-IDF | cosinus ≥ 0.5; tekst ≥ 25 znaków | `0.5 × (0.5 + 0.5·(cos−próg)/(1−próg))`, czyli 0.25…0.50 | `link.ts`, `config.ts` |
| tekst, embeddingi | cosinus ≥ 0.86 | jak wyżej | `link.ts` |

Tekst do porównania to treść reklamy z tekstem z OCR i ASR, a gdy ich brak, tytuł i opis strony docelowej (`textOf`, `link.ts`). Porównywane są wszystkie pary, czyli O(n²). Na próbce simhash DOM różni się w obrębie kampanii o ≤ 5 bitów, a między kampaniami o ≥ 22 (pomiar `gen-sample`). Niezwiązane nagrania mają podobieństwo ok. 0,5–0,7, więc próg 0,85 jest z zapasem (`lib/media/audioFp.test.ts`).

**Powiązanie pary** (`link.ts`): `score = 1 − Π(1 − w_i)` po wszystkich dowodach (noisy-OR, `weights.ts`). Silne, gdy którykolwiek dowód jest silny. Powiązania z `score < 0.05`, które nie są silne, są odrzucane (`link.ts`). Ich encje zostają w węzłach i krawędziach.

### 4.6 `explain(a, b)` (`lib/graph/explain.ts`)

1. `sameCampaign`: oba węzły mają ten sam `campaignId`.
2. Dowody bezpośrednie: `evidence` powiązania (a, b), jeśli istnieje. Każdy dowód typu pivot ma `pathA` i `pathB`, czyli listy id węzłów od reklamy do wspólnej encji (np. `item:c1-01 → url:… → host:… → ip:…`).
3. Gdy powiązania nie ma albo `score < minLinkScore`, Dijkstra na wagach `−ln(score)` po powiązaniach z `score ≥ minLinkScore` lub silnych (`strongestPath`, `explain.ts`). Maksymalizuje to iloczyn wyników. Każdy krok zawiera ≤ 3 najsilniejsze dowody.
4. `summary`: tekst PL.

`explain` działa na grafie, który dostanie. Po przycięciu (§5.7) może nie znaleźć słabszych par bezpośrednio. Przeglądarka używa go w panelu porównania (`ComparePanel.tsx`) i uzupełnia listą wszystkich wspólnych encji, również tych, których para nie dostała w `graph.json` (§3.11). `lib/graph/cluster.ts` reeksportuje `explain` dla zgodności.

### 4.7 Kit strony, wzorce nazw, CNAME i parametry kampanii

Te pivoty wynikają z notatek badawczych (ranking sygnałów: backend formularza > szablon strony > wzorzec nazw domen > cel CNAME > metadane kampanii w URL). Każdy ma zniżkę dla infrastruktury współdzielonej, żeby nie scalał niezwiązanych kampanii tak, jak zrobiłyby to adresy Cloudflare.

| Pivot | Skąd | Zniżki i progi | Przykład z próbki |
|---|---|---|---|
| `endpoint` | `PageKit.endpoints` strony końcowej (`link.ts`) | publiczny serwis formularzy, analityka i geolokalizacja (`endpointHosts`) 0.05; ścieżka na tej samej domenie ×0.4; ścieżka ogólna 0.05; krótka ścieżka ×0.5 (`weights.ts`) | `leads-gate.test/api/v1/submit/<uuid>/` na dwóch domenach C1 (inne UUID) jest silny; `api.web3forms.com/submit` u C5, N1 i N2 ma wagę 0,031 i ich nie łączy |
| `hidden_fields` | `PageKit.hiddenFields` bez nazw ogólnych, ≥ 2 pola (`kit.minHiddenFields`, `link.ts`) | lista `hiddenFieldGeneric` odrzuca pola przed złożeniem klucza | `device_id,fill_time,read_time` (C3) |
| `asset` | `PageKit.assets`; pliki z domen o czynniku listy 0 (publiczne CDN) są pomijane (`link.ts`) | biblioteki 0.05, nazwy ogólne 0.1 | `/assets/js/kz-form.3fa9c1.js` (C1); `jquery-3.7.1.min.js` i `style.css` u C1 i N1 mają wagę < 0,05 |
| `comment` | `PageKit.comments` (`link.ts`) | snippety trackerów i CMS 0.05; kara za powszechność | komentarz po rosyjsku w kodzie C1 (flaga cyrylicy) |
| `domain_pattern` | szablony domen ze zbioru (bez domen z list), tylko szablony obecne w ≥ 2 różnych domenach (`kit.domainPatternMinDomains`, `link.ts`) | bez rdzenia literowego ×0.1; wariant bez TLD ×0.85; brak podwójnego liczenia (§4.3) | `zwrot<n>-<lorem><n>.example` (2 domeny C4) i `zwrot<n>-<lorem><n>.*` (3 domeny w dwóch TLD) |
| `cname_target` | łańcuch CNAME hosta (`HostInfo.cnameChain`, do 4 skoków), klucz = domena rejestrowalna celu (`link.ts`) | CDN 0.02, hostingi 0.05 (`cnameTargets`); relacja hostingu jak IP | `tds-cname.test` (dwie domeny C3, różne etykiety celu); `fastly.net` u C5 i N5 ma wagę 0,009 |
| `campaign_param` | URL-e reklamy, łańcucha, strony końcowej i treści (`link.ts`) | wartości ogólne i makra, wartości krótkie i liczbowe, słowne, słabe nazwy (§4.4) | `sub1=mb_kowal`, `offer_id=771304` (C3), `aff_id=kd_partner_19` (C5), `utm_campaign=пл_инвест_лиды_07` (C1, cyrylica) są silne; `utm_source=facebook` u C1, C2 i N1 ma wagę 0,029 |

Cyrylica w komentarzach strony lub w wartości parametru ustawia atrybut `cyrillic` reklamy (`link.ts`) i liczbę reklam z cyrylicą w kampanii. To atrybut, nie krawędź.

### 4.8 Persona (osoba, pod którą podszywa się reklama)

Persona pochodzi z tekstu, z danych wejściowych albo, opcjonalnie (`--faces`), z twarzy podobnej do osoby z zamkniętej listy (§4.14). Głos podobny do osoby z galerii (`--speaker`) też daje tę personę, jako cecha grupy (§4.16). Wektory głosu (`--speaker`) służą tylko do porównania materiałów, nie do wskazania osoby.

- **Lista obserwowanych osób** (`lib/text/persona.ts`, plik JSON `[{name, role?, aliases?}]`, schemat `persona.ts`): każde słowo nazwiska dostaje wzorzec prostej odmiany polskiej (`inflectionPattern`, `persona.ts`), np. „Adama Testowego”, „Ewie Przykładowej”, na tekście po `normalizeForMatching` (diakrytyki, homoglify, wielkość liter). Dopasowanie w treści reklamy i strony docelowej (`matchPersonas`, `persona.ts`).
- **Tryb przybliżony dla OCR/ASR** (`fuzzyMatch`, `persona.ts`): imię musi pasować dokładnie (z odmianą), a temat nazwiska po zdjęciu końcówki (`stemPolish`, `persona.ts`) może różnić się o odległość edycyjną zależną od długości: ≤ 4 znaki 0, 5–7 znaków 1, ≥ 8 znaków 2 (`maxSurnameDistance`, `persona.ts`). Przypadek z transkrypcji whispera „Inwestuj z Rafałem Brzosku” (powiedziano „Brzoską”) pasuje do „Rafał Brzoska” tylko w tym trybie (`lib/text/persona.test.ts`). Tryb przybliżony działa tylko na tekście z OCR i ASR (`lib/pipeline/enrich.ts`).
- **Kolumna wejściowa** (np. identyfikator lub nazwisko z DROZD): `personasFromIngest` (`persona.ts`), kilka wartości rozdzielonych `;`, `|` lub `,`.
- **NER przez LLM** (opcjonalnie, `--ner`): `extractPersonsNer` (`persona.ts`); prompt każe traktować tekst jako dane i nie opisywać wyglądu.
- **W grafie** persona ma wagę typu 0.1 (`config.ts`), więc sama nigdy nie przekracza `minLinkScore` (0.15) i nie łączy kampanii (ta sama osoba występuje w wielu kampaniach). Na reklamę i personę jest jedna krawędź `mentions_persona` ze wszystkimi źródłami (§4.2). Kampania dostaje atrybut `personas[{id,name,count}]` (`cluster.ts`), a przeglądarka filtr persony.

### 4.9 Pivoty i reguły dodane 20.11.2026 wieczorem

Powstały po uruchomieniu startera na 15 zarchiwizowanych stronach docelowych z publicznej zajawki zadania. Odwołania `plik:linia` w starszych rozdziałach nie były po tych zmianach aktualizowane.

| Element | Skąd | Waga i zniżki | Test |
|---|---|---|---|
| `path_id` | `PageKit.pathIds` (`extractPageKit`): UUID będący segmentem ścieżki co najmniej dwóch zasobów ładowanych z domeny strony (`src` dowolnego znacznika, `link[href]`), maks. 10. Linki nawigacyjne i zasoby z innych hostów są pomijane | waga typu 0.85, czyli silny dowód: losowy UUID wspólny dla różnych domen to jedno konto kreatora stron. Każdy identyfikator niesie ścieżkę przed UUID (`prefix`). Na platformach sklepowych UUID oznacza zainstalowaną aplikację albo motyw, więc `lists.pathIdSharedPrefixes` (domyślnie `/cdn/shop/`, `/cdn/extensions/`) daje czynnik 0.05. To samo dotyczy wspólnej biblioteki gotowych landerów platformy stron („666”: `/_cdn/production/landing-cdn/666/`, `/_cdn/production/action-files-test/666/`, od zadania i14c): korzysta z niej wiele kont, więc UUID landera z biblioteki nie wskazuje konta. Pojedynczy identyfikator zdyskontujesz przez `lists.pivots` (`path_id:<uuid>`) | `pagekit.test.ts`, `kitLink.test.ts` |
| `param_schema` | `paramSchema(landingUrl)` w `lib/osint/campaignParams.ts`: posortowane pary `nazwa:kształt` (`uuid`, `hex`, `tok`, `num`, `word`), bez identyfikatorów kliknięć dopisywanych przez platformy. Powstaje tylko dla linków z ≥ 3 parametrami, z których ≥ 2 mają wartości losowe | waga typu 0.12, poniżej `minLinkScore`: szablon wskazuje system kierowania ruchem, który może mieć wielu klientów. Wzmacnia inne dowody. Podniesienie wagi w konfiguracji grupuje kampanie według platformy | `campaignParams.test.ts`, `kitLink.test.ts` |
| Etykiety interfejsu w OCR | `stripUiChrome` w `lib/text/uiChrome.ts` (PL i EN): usuwa „Sponsorowane”, przyciski wezwania do działania i panele biblioteki reklam, rozpoznaje widok (`ad_library`, `sponsored_post`) | `textOf` porównuje tekst OCR bez etykiet. Dla widoku `ad_library` obraz nie tworzy pivotu `imagehash` ani podobieństwa `similar_image` / `similar_image_semantic`, bo zrzut to głównie interfejs | `uiChrome.test.ts`, `screenshotLink.test.ts` |
| `ad_library_id` | „Identyfikator biblioteki” / „Library ID” z OCR, jako `campaign_param` z `sourceUrl` wskazującym bibliotekę reklam | silny (0.8): ten sam identyfikator to ta sama reklama zgłoszona dwa razy. Węzeł reklamy dostaje `uiView` i `adLibraryIds` | `screenshotLink.test.ts` |
| Seria rejestracji | `addRegistrationBursts` grupuje po `registrarIanaId`, gdy RDAP go podaje; inaczej po nazwie | bez zmian (0.3 przed zniżkami). Rejestry zapisują nazwę tego samego rejestratora różnie w różnych TLD | `link.test.ts` |

Import katalogów spraw (`lib/pipeline/caseImport.ts`, `scripts/import-cases.ts`, test `caseImport.test.ts`): każdy podkatalog z plikiem `.html`/`.htm` lub `.har` to sprawa, a nazwa katalogu to jej identyfikator. Adres strony pochodzi z komentarza „saved from url” albo z pierwszego dokumentu w HAR. Treść strony to dokument z HAR pod tym adresem (nie osadzone ramki), a gdy go nie ma, zapisana strona z usuniętym dopiskiem `.pobrane`/`.download`. Obrazy z HAR i z folderu `<nazwa>_files` trafiają do fixtures, żeby dało się policzyć hash faviconu. Rekordy A/AAAA pochodzą z HAR. `--lookups` dopisuje NS/MX/TXT/CNAME, surowy RDAP i odpowiedzi Team Cymru, a `--ct` surowy wynik crt.sh; `failedLookups` wymienia domeny bez odpowiedzi. Czas `first_seen` to najwcześniejszy wpis HAR, a bez HAR czas z nazwy zrzutu ekranu (strefa czasowa maszyny). Błędy są osobne dla każdej sprawy: strona albo HAR, którego nie da się odczytać lub sparsować, trafia do `skipped` jako `<sprawa>/<plik>` z powodem („nie udało się odczytać pliku strona.html: …”, bez ścieżek serwera), a sprawa idzie dalej z pozostałymi plikami. Nieczytelny plik z folderu `_files` albo fragment wideo HLS jest pomijany z wpisem w logu. Sprawa, która zawiedzie w połowie importu, jest wycofywana (rekordy, fixtures, hosty do zapytań) i pomijana z powodem. Import przerywa tylko błąd całej partii: nie da się odczytać katalogu spraw albo zapisać wyniku importu.

Katalogi zebrane z publicznych źródeł (`lib/pipeline/collectedCase.ts`, rozpoznawane po pliku `zrodlo.json`) mają własne role plików. Skan serwisu skanowania: adres to `cel` z `zrodlo.json` (pełny, ze ścieżką i parametrami: `clickid`, `key=`, `fbclid`, `utm_*` zostają, bo strona oszustwa często odpowiada tylko na pełny adres), a bez niego pierwszy dokument w HAR; `urlscan_wynik.html` to strona serwisu, nie treść strony; HAR odtworzony z listy żądań (bez treści odpowiedzi) daje adresy IP i listę żądań, z której bez kodu strony powstają zasoby strony (`withRequestUrls`: pliki `.js`/`.css` jako `asset`, UUID w ścieżkach zasobów z domeny strony jako `path_id`, najemca platformy stron); `urlscan_rekord.json` daje metadane strony (`scan`) i AS adresu IP (odpowiedź Team Cymru offline, bez prefiksu); `zrzut_urlscan.png` to zrzut strony (`pageScreenshots`), bez OCR reklamy i bez `imagehash` kreacji. Kopia z archiwum (`wayback_<czas>.html`): treść bez przepisanych adresów i paska archiwum, `firstSeen` z nazwy pliku, `bodySource: "wayback"`. Katalog prasowy: obraz `reklama_*` to reklama, `lander_*`/`formularz_*` to strona, artykuł nie jest stroną docelową, a `rdap_dns.json` daje DNS i RDAP z chwili zebrania (pierwszeństwo przed `--lookups`). Pola etykiet z `zrodlo.json` (`rodzina`, `odcisk`, `pewnosc`, `uwagi`) nie są czytane. `provenance.json` importu ma dla każdej sprawy `sources` (adres, typ, daty wpisu i dostępu źródeł publicznych), `scan` i `pageScreenshots` obok dotychczasowych pól (`bodySource`, `har`, `savedHtml`, `firstSeen`, pominięte sprawy, `failedLookups`).

### 4.10 Dowody dodane 21.11.2026 (próbka organizatora)

| Element | Skąd | Waga i zniżki | Test |
|---|---|---|---|
| `platform_account`, `platform_campaign`, `page_template` | `extractLanderConfig` (`lib/osint/landerConfig.ts`), wołane z `extractPageKit` jako `PageKit.lander`: rekord `window.aio = JSON.parse('…')` platformy stron (konto `campaign.owner_uuid`, kampania `campaign.uuid` i nazwa, strona `landing.uuid` i nazwa, szablon `landing.lander_template_uuid`, źródło ruchu `source.name`) | konto 0.9 i kampania 0.95 to silne dowody (jawne identyfikatory operatora). Szablon 0.35: zestaw stron, z którego może korzystać wiele kont. Węzeł reklamy dostaje `platformAccount`, `platformCampaignName`, `landingName`, `trafficSource` i `cloakerInSource` (gdy nazwa źródła zawiera „cloak”) | `landerConfig.test.ts`, `levels.test.ts` |
| `click_server` | `clickIdsFromUrls` (`lib/osint/clickIds.ts`) na linku docelowym i przekierowaniach: wartość parametru o nazwie typu `clickid`/`subid`/`visit` w formacie xid (20 znaków base32hex) z czasem 2016–2040. Klucz to sama maszyna (3 bajty xid); od zadania i14 PID nie wchodzi do klucza (§4.12) | 0.6, średni: ten sam serwer trackera kieruje ruch do obu stron, co nie dowodzi jednego kupującego. Węzeł reklamy dostaje `clickTime` i `clickCounter`, węzeł serwera `pids` | `clickIds.test.ts`, `levels.test.ts`, `platformTraits.test.ts` |
| `meta_ad` | nowy format `fbclid` („PA…”): pole `adid` (8 bajtów) i `app_id` | 0.95, silny: ta sama kliknięta reklama. To identyfikator z Marketing API, nie z Biblioteki Reklam | `clickIds.test.ts`, `levels.test.ts` |
| Favicon podrabianej marki | `impersonatedBrand(title, url)` w `link.ts`: ostatni człon tytułu po myślniku lub kresce („… — Nazwa Portalu”), gdy domena strony go nie zawiera | czynnik `kit.brandAssetFactor` (0.1): favicon klonu serwisu to cecha marki, nie operatora | `levels.test.ts` |

---

### 4.11 Techniki strony i blok fałszywych komentarzy (`lib/osint/pageTechniques.ts`, od 21.11.2026)

`extractPageKit` dopisuje do `PageKit` pola `commentBlock` i `techniques` (`detectPageTechniques`, jeden liniowy przebieg po tagach, do 3 mln znaków i 200 tys. tagów; ten sam test odporności co reszta kitu).

- **Blok komentarzy** (`comment_block`): elementy z klasą komentarza (`comment`, `fb-comment`, `reply`, `comment-item`…, bez liczby mnogiej kontenera), w każdym pierwszy element z klasą autora (`author`, `name`, `user`, `nick`) i tekstu (`text`, `body`, `content`, `message`). Autor normalizowany (NFKC, małe litery, bez miejscowości po „·”), co najmniej 3 różnych autorów (`MIN_COMMENT_AUTHORS`). Klucz węzła to SHA-256 posortowanego zbioru autorów (16 znaków hex). Treści komentarzy zostają w danych węzła (`samples`), ale nie wchodzą do klucza: ten sam szablon na różnych domenach ma te same osoby, a w treści podmienia markę i kwoty. Strona z prawdziwą wtyczką komentarzy Facebooka (`facebook.com/plugins/comments.php` albo `fb-comments` z `data-href` i SDK) nie dostaje bloku. Waga typu 0,45; typ jest w `notAloneKinds`, więc blok (jak inne ślady szablonu) połączy kampanię tylko razem z dowodem spoza zestawu stron i treści (§5.4 pkt 4). Krawędź `has_comment_block` od strony docelowej; w danych reklamy `commentBlock` (id węzła) i `fakeCommentCount`.
- **Pospolite imiona w bloku** (od zadania i1fix, `commentNameFactors` w `lib/graph/commentNames.ts`, `commentBlockNames`): klucz bloku to nadal cały zbiór autorów, więc jedno albo dwa wspólne nazwiska nie łączą (testy negatywne w `pageTechniques.test.ts`, tak samo lista krajów z `<select>/<option>` formularza nie jest blokiem). Waga węzła bloku dostaje rabat `comment_names`: średnia z ln(B / df) / ln(B) po różnych imionach bloku (pierwsze słowo autora; B = liczba bloków w zbiorze, df = liczba bloków z tym imieniem), nie mniej niż 0,3, liczona od 5 bloków. Blok z rzadkimi albo błędnie zapisanymi imionami (skopiowany z jednego źródła) waży pełną wagę, blok z imionami spotykanymi w wielu innych blokach mniej, bo łatwiej o niego przypadkiem. Rabat łączy się z innymi jak każdy (`listFactor` bierze najmniejszy).
- **Techniki** (`technique`, węzeł na każdą technikę): `fake_app_store` (tytuł z „App Store”/„Google Play” albo klasy przycisku instalacji sklepu i napisy w rodzaju „Wybór redakcji”, „Zakupy w aplikacji”, oceny, na hoście innym niż `apple.com`/`google.com`), `back_trap` (co najmniej dwa `history.pushState` albo pętla z nim oraz obsługa `popstate`, albo skrypt `back-nav.js` i podobne), `fake_social_post` (klasy `x-post`, `tweet`, `fb-post`, `ig-post`… albo notatka autora `<!-- X-POST`, bez skryptu platformy i bez `blockquote.twitter-tweet`/`instagram-media`), `fake_comments` (jest blok komentarzy). W danych reklamy `techniques: string[]`. Waga typu 0,2, typ w `campaignRules.familyOnlyKinds`: przesłanki tego rodzaju nie liczą się do wyniku pary na poziomie kampanii (`campaignScore`), do liczby rodzajów dowodów ani do wagi w Louvainie, a liczą się do grupy podobnych kampanii (ten sam sposób działania).

### 4.12 Cechy platform a cechy operatora (21.11.2026, zadanie i14)

Badanie publicznych skanów (urlscan, RDAP; raport `10-rodzenstwo-w-sieci.md` poza repozytorium) pokazało, że część śladów, którym starter ufał, to cechy **platform** używanych przez wielu niezależnych operatorów (tracker typu Binom, platforma stron typu AIO, bramki Conversions API, usługi formularzy). Ślad platformy mówi „ten sam produkt”, nie „ten sam operator”, więc dostaje czynnik ok. 0,1 albo w ogóle nie łączy. Ślad jednej instancji albo jednego konta na platformie zostaje silny. Liczby z regresji: §4.13.

| Zmiana | Gdzie | Uzasadnienie |
|---|---|---|
| `click_server` po maszynie xid, bez PID w kluczu | `link.ts` (węzeł `click_server:<maszyna>`, PID w `data.pids` i opisie krawędzi), `clickIds.ts` (`encodeXid` do budowania syntetycznych identyfikatorów w testach) | Ten sam PID występuje w publicznych skanach przy 10 różnych maszynach xid: to stała instalacji produktu (np. kontener), a nie numer procesu. Instancję trackera wyznacza 3-bajtowa maszyna. **PID nie dostaje osobnego węzła** (np. `tracker_install`): przy czynniku 0,1 ważyłby ok. 0,06, czyli poniżej `discountedMinWeight` (0,3) i poniżej progu grupy, a „ten sam produkt trackera” opisują już szablon linku (`param_schema`) i plik zdarzeń; nowy typ węzła wymagałby też zmian w przeglądarce |
| `/include/events-stat.js` ×0,1 | `lists.endpointPlatformPaths`; lista działa teraz na ścieżki backendów (dowolnego pochodzenia) i **plików JS/CSS** (`weights.ts`, `platformPathRule`) | Skrypt zdarzeń tego trackera jest na landerach wielu niezwiązanych operatorów w wielu krajach (76 skanów): cecha platformy, nie operatora |
| `/click` (link `/click?key=<32 hex>`) ×0,1 i część szablonu linku `key:hex` ×0,1 | `lists.endpointPlatformPaths` (`/click` = ta ścieżka albo poddrzewo, nie `/clicks`), `lists.paramSchemaPlatformParts` (dokładna część `nazwa:kształt` w `param_schema`) | To format linku kampanii tej platformy: wspólny typ platformy. Sam klucz kampanii (wartość) od zadania i14fix łączy jako `tracker_campaign` (niżej) |
| Bramka konwersji (CAPI, `fallbackDomain`) | bez zmian | Sprawdzone: kod nie czyta `fallbackDomain` ani hostów bramek i nie robi z nich węzła. Bramki obsługują tysiące legalnych stron, więc nic nie dodano |
| Najemca `landing-cdn/<uuid>` = konto | `landingCdnTenants` (`landerConfig.ts`), `PageKit.platformTenants` (adresy zasobów strony i żądania z HAR, `withRequestUrls`), `link.ts` | Najemca jest widoczny bez kodu strony (HAR, lista żądań skanu) i znaczy to samo co `owner_uuid`: tworzy albo uzupełnia ten sam węzeł `platform_account`. Szczegóły niżej |
| Backend formularza z identyfikatorem klienta | `EndpointRef.clientId`/`clientIdSource` (`pagekit.ts`), klucz `host/ścieżka#klient=<id>` | Dwaj klienci jednej usługi to różne backendy. Szczegóły niżej |
| `lists.multiTenantBackends` ×0,1 | `config.ts`, `weights.ts` (backendy i skrypty spoza domeny strony, bez identyfikatora klienta) | Usługi formularzy, zbierania leadów, webhooków i CRM z jednym hostem dla wszystkich klientów. Z raportu dopisany tylko host opisany tam jako usługa wielu klientów na podstawie publicznych skanów (skrypt na stronach wielu niezwiązanych branż) |
| Reguły treści, ten sam plik kreacji, persona tylko w grupie, `attributes.basis` | `cluster.ts`, `config.ts` (`campaignRules`), §5.4 | Kopie tego samego landera i kreacji stawiają różni operatorzy; persona występuje w kampaniach wielu operatorów |
| Domena zawieszona: NS `dyna-ns.net` ×0,02, adres `1.1.1.0/24` ×0,02, atrybut `suspended` (i14fix, B-119) | `lists.nameserverSuffixes`, `lists.ipCidrs`, `lists.suspendedRdapStatuses` (`clienthold`, `serverhold`), `rdapSuspended` (`rdap.ts`), `link.ts` (węzeł domeny) | Rejestrator przepina zawieszone domeny na swoje NS i adres zastępczy: cecha usługi rejestratora, nie operatora. Para NS bez zniżki (0,35, poza `notAloneKinds`) sama sklejała zawieszone domeny różnych operatorów. `suspended` jest tylko informacją; A zapisane razem ze stroną (HAR) ma już pierwszeństwo przed żywym DNS (`caseImport.ts`). Regresja: dane referencyjne mają 2 domeny na tych NS (para NS 0,35 → 0,007), RDAP bez statusu wstrzymania, więc 0 domen `suspended`; partycja bez zmian |
| Wzorzec domeny bez rdzenia ×0,1 zamiast ×0,3 (i14fix, B-041) | `kit.domainPatternNoAnchorFactor` | `<lorem>-<lorem>-<lorem>.top` to domyślny generator nazw platformy stron (dokumentacja i domyślna domena SDK też są lorem), wspólny dla jej najemców. Przy ×0,3 waga 0,18 ≥ `minLinkScore` sama tworzyła kampanię, a skan bez kodu strony nie ma `owner_uuid` dla konfliktu kont. Teraz 0,06. Dopisanie `domain_pattern` do `notAloneKinds` odpadło, bo wyłączyłoby też wzorce z rdzeniem. Regresja: w danych referencyjnych brak wzorca bez rdzenia, 0 zmian |
| SDK platformy stron ×0,01: `/aio-static/`, `/aio-sw.js`, `/api/v1/pwa/manifest/`, `/api/v1/agent/` (też `pub-key-push-settings`), `/api/v1/trigger/` (wcześniej dwie ostatnie ×0,1); domyślny szablon linku `utm_visit:uuid` ×0,1 (i14fix, B-040) | `lists.endpointPlatformPaths`, `lists.paramSchemaPlatformParts` | Te same pliki SDK i ścieżki API leżą na domenie każdego najemcy, a `utm_visit=<UUIDv7>` z losowymi `utm_*` to domyślny link platformy: ślad „ten sam produkt”. Dwie strony na tym SDK pod różnymi kontami miały wynik pary ok. 0,27 z samych plików i szablonu, teraz ok. 0,04. **Lista hashy plików SDK pominięta**: w grafie nie ma węzła hasha treści zasobu. Wersja SDK (`main.js?v=…`) nie jest zapisywana (`AssetRef` nie trzyma zapytania). Regresja: dane referencyjne 118 → 89 par (znikają pary z samym szablonem linku i plikami SDK), partycja i grupy bez zmian |
| Płatnik z biblioteki reklam: waga 0,65 zamiast 0,7 i `ad_payer` w `notAloneKinds` (i14fix, B-114) | `typeWeights.ad_payer`, `campaignRules.notAloneKinds` | Konta reklamowe bywają wynajmowane albo przejęte (płatnik bywa ofiarą kradzieży tożsamości). Przy 0,7 = `strongThreshold` sama nazwa scalała kampanie w union-find; silne łącze omija `notAloneKinds` (`campaignLinkVerdict`), więc potrzebne są obie zmiany. Płatnik razem ze śladami zestawu stron to nadal jeden rodzaj; kampanię daje płatnik z dowodem operatora (np. serwer trackera). Sam płatnik: najwyżej grupa podobnych. Regresja: płatnik jest tylko przy `--ad-library` z siecią, w żadnym z trzech zbiorów go nie ma |
| Klucz kampanii trackera `tracker_campaign` (0,6) i numer kampanii z maszyną xid (i14fix, B-044) | `campaignParams.ts` (`key`, `f7nx2` tylko z wartością 32 hex), `link.ts`, `trackerCampaignWeight`, `kit.machineScopedParams` (`campaign_id`, `offer_id`), `weights.ts` | Format linku (`/click?key=`) jest cechą platformy (wyżej), ale wartość klucza to jedna kampania w trackerze: łączy, choć nie silnie, bo jedna instalacja może obsługiwać kilku kupujących. Wewnętrzny numer (`campaign_id=319`) każda instalacja liczy od 1, więc przy identyfikatorze xid klucz to `maszyna/numer` (bez zniżki krótkiej liczby), a ten sam numer na różnych maszynach nie tworzy wspólnego węzła. Bez nowego typu węzła: `campaign_param` z nazwą kanoniczną `tracker_campaign` (nowy typ wymagałby zmian w przeglądarce). Nie zrobione: `tsrv` jako czas wizyty, `tmsl`/`tmsla`/`eid` jako parametry trackera. Regresja: 1 węzeł `tracker_campaign` w danych referencyjnych (df 1), 0 zmian |
| Identyfikatory z linku platformy stron: `cuuid` → `platform_campaign`, `launcher` → `platform_account`, `suuid` → atrybut `platformSourceIds` (i14fix, B-141) | `platformLinkIds`, `mergePlatformLinkIds` (`landerConfig.ts`), `PageKit.platformLinks` (kod strony i żądania HAR, `withRequestUrls`), `link.ts` (też sam link i adres z OCR) | Te same węzły co z `window.aio`, także bez kodu strony. `launcher` ma wartość `owner_uuid`, więc trafia do przestrzeni kont, nie najemców `landing-cdn` (konflikt kont porównuje go z `owner_uuid`; `platformAccountSource: "launcher"`). `source_campaign_id` i `source_visit_id` nie są mapowane (identyfikator wizyty jest losowy). Regresja: 2 nowe węzły `platform_campaign` w danych referencyjnych (jeden łączy dwie reklamy tej samej kampanii), 3 reklamy z `platformSourceIds`, partycja bez zmian |

**Najemca platformy stron.** Z adresów `…/landing-cdn/<uuid>/…` (tylko UUID; wspólna biblioteka landerów o krótkiej nazwie, np. liczbowej, jest używana przez wiele kont i nie liczy się) powstaje `PageKit.platformTenants`. Źródła: każdy `src`/`href` strony (także z innego hosta, np. CDN) oraz żądania zapisane w HAR. `importCases` zapisuje adresy żądań HAR (do 1000) w `http.json` jako `requests`, a HAR bez treści dokumentu (np. odtworzony z listy żądań skanu) daje teraz stronę z pustym kodem i samymi żądaniami (wcześniej był pomijany); `fixtureSources.requestsFor(url)` je zwraca, `enrich` scala je z kitem. W grafie: gdy strona ma `owner_uuid`, konto jest jak dotąd z `owner_uuid`, a najemcy trafiają do `data.tenants` węzła konta; gdy najemca różni się od `owner_uuid`, reklama dostaje ostrzeżenie `platformAccountWarning` (w danych i w `features` wyniku analizy materiału). Gdy strona nie ma `owner_uuid`, najemca tworzy węzeł `platform_account`: jeśli ten sam najemca wystąpił w zbiorze przy jednym `owner_uuid`, węzeł to konto tego `owner_uuid` (`platformAccountSource: "tenant→owner_uuid"`), w przeciwnym razie klucz to sam najemca (`platformAccountSource: "tenant"`). Konflikt kont (`accountConflict`) porównuje tylko identyfikatory z tej samej przestrzeni (dwa `owner_uuid` albo dwóch niezmapowanych najemców), bo w zebranych danych najemca i `owner_uuid` jednego konta mają różne wartości.

**Backend formularza i identyfikator klienta.** Dla backendu z innej domeny niż strona `pagekit.ts` szuka identyfikatora klienta: pierwszy segment ścieżki będący UUID, ciągiem ≥ 16 znaków hex, liczbą ≥ 4 cyfr, losowym tokenem (≥ 16 znaków, ≥ 4 cyfry i ≥ 4 litery, najwyżej 2 separatory) albo identyfikatorem bota (`bot<cyfry>:…` → `bot<cyfry>`); potem wartość parametru zapytania (UUID i hex zawsze, liczba i token tylko pod nazwą typu `id`, `account`, `client`, `form`, `key`…); na końcu ukryte pole formularza `<form action>` o takiej wartości. Nazwy wartości jednorazowych (`click*`, `sub*`, `visit`, `session`, `csrf`, `nonce`, `captcha`, `utm_*`, `token`…) są pomijane. Identyfikator wchodzi do klucza (`#klient=<id>`) i do opisu przesłanki („ten sam backend formularza z tym samym identyfikatorem klienta”). Przy identyfikatorze nie działają zniżki hosta (`endpointHosts`, `lists.domains`, `multiTenantBackends`): ten sam klucz dostępu do usługi formularzy to ten sam klient; działa zniżka ścieżki platformy. Backend bez identyfikatora na hoście z `multiTenantBackends` dostaje ×0,1. Backend z tej samej domeny i krótkie ścieżki zostają jak dotąd (cecha szablonu, `notAloneKinds`). Uwaga: w próbce syntetycznej backend C1 ma inny UUID na każdej domenie, więc ten backend już ich nie łączy (C1 łączą inne dowody).

**Ten sam plik kreacji.** `hashImage` liczy SHA-256 pliku obrazu (`ImageHashes.sha256`), `enrich` SHA-256 pliku wideo (`ItemEnrichment.videoSha256`, zawsze, gdy jest `videoPath`). W grafie to węzeł typu `imagehash` z kluczem `sha256:<hex>` (`CREATIVE_FILE_PREFIX`, `data.exactFile`, `data.media`), waga `creativeFileWeight` (0,95). W regułach kampanii ma rodzaj `creative_sha256` (`evidenceKind` w `cluster.ts`). Osobny typ węzła wymagałby zmian w przeglądarce (słowniki typów w `lib/viewer`), której to zadanie nie dotyka. Węzeł nie jest silny w union-find, żeby konflikt kont na platformie mógł z nim wygrać (§5.4); poza konfliktem łączy sam.

### 4.13 Regresja po zmianach z §4.12

Przed = kod sprzed zadania (ten sam commit bez zmian z §4.12), po = obecny kod; te same dane wejściowe. Etykiety referencyjne są robocze.

| Zbiór | Przed | Po |
|---|---|---|
| Próbka syntetyczna (`bun run pipeline --offline`, `bun run evaluate`, 43 reklamy) | P = R = F1 = 1, ARI 1, 10 kampanii | P = 1, R = 0,945, F1 = 0,972 (B-cubed F1 0,979, ARI 0,967), 11 kampanii, 1 grupa podobnych |
| Dane referencyjne, 25 spraw (27 rekordów z etykietą) | P = R = F1 = 1, 14 kampanii, 2 grupy (2 kampanie i 10 rekordów; 2 i 4) | P = R = F1 = 1, 14 kampanii, 2 grupy (2 i 11; 2 i 4) |
| Te same sprawy, wszystkie rekordy | 27 rekordów | 28 rekordów: HAR bez treści dokumentu z paczki automatycznego archiwizatora jednej sprawy jest teraz czytany (same żądania) i trafia do kampanii tej samej domeny; nie ma etykiety, więc licząc go jako osobny P = 0,814, F1 = 0,897; z etykietą jego sprawy 43/0/0 par |
| Przypisanie nowych materiałów (10 spraw jury, 12 rekordów, `analyze-material --cases`) | werdykty jak w tabeli wersji 3 | 12/12 werdyktów bez zmian |

- Jedyna strata w próbce syntetycznej to reklama bez adresu (podobny obraz i tekst do kampanii z infrastrukturą): zgodnie z regułą treści (§5.4 pkt 5) jest osobną kampanią w grupie podobnych tej kampanii (`basis: "content"`). `campaignRules.contentKindsWithInfrastructure: 2` przywraca R = 1 (test `pipeline.offline.test.ts`). Od zadania i14b ta reklama wraca do swojej kampanii jako wariant kreacji (§5.4 pkt 7; obraz różni się o 3 bity dHash od kreacji kampanii): P = R = F1 = 1, ARI 1, 10 kampanii.
- Sprawa, której przypisanie do znanej kampanii stało częściowo na pliku `events-stat.js`: przesłanki przed zmianą to serwer trackera 0,6, plik 0,55, seria rejestracji 0,3, szablon linku 0,12 (wynik pary 0,918); po zmianie plik waży 0,055 (zdyskontowany, nie liczy się), zostają maszyna xid 0,6, seria rejestracji 0,3 i szablon linku 0,12 (0,827), co nadal daje kampanię (trzy rodzaje dowodów). Sprawa z inną maszyną xid nie ma żadnego powiązania z tą kampanią (najwyższe powiązanie z innymi kampaniami 0,092, poniżej progu).
- Wszystkie kampanie danych referencyjnych mają `basis: "infrastructure"`. 10 rekordów dostało ostrzeżenie `platformAccountWarning` (najemca `landing-cdn` ≠ `owner_uuid`): w tych danych to dwa różne identyfikatory jednego konta, dlatego konflikt kont porównuje tylko jedną przestrzeń.
- Przy imporcie z `--lookups` zapytania RDAP dały tym razem odpowiedź tylko dla 10 z 23 domen; przebiegi przed i po porównano na tych samych plikach RDAP (uzupełnionych z poprzedniego przebiegu), bo bez nich znika seria rejestracji.

**Po zmianach i14fix** (domena zawieszona, wzorzec lorem, SDK platformy stron, płatnik, klucz kampanii trackera, linki platformy; przed = kod sprzed i14fix):

| Zbiór | Przed | Po |
|---|---|---|
| Próbka syntetyczna, 43 reklamy | P = R = F1 = 1, B-cubed 1, ARI 1, 10 kampanii | to samo; 0 zmian wag węzłów i wyników 154 par |
| Dane referencyjne, 25 spraw, pełny przebieg (28 rekordów) | P = 0,814, R = 1, F1 = 0,897 (znany rekord bez etykiety), 14 kampanii, 2 grupy (2 i 11; 2 i 4) | to samo, partycja i grupy identyczne; par 118 → 89, par między różnymi etykietami 83 → 54, silnych między etykietami 2 → 2 |
| Przypisanie nowych materiałów (10 spraw, 12 rekordów) | znana kampania 3, nowa 7, duplikat 2 | to samo: 0 różnic werdyktu, kampanii i podobnych kampanii; przesłanki trzech przypisań do znanych kampanii bez zmian; łączy 62 → 31 (znikają łącza z samym szablonem linku, plikami i ścieżkami zestawu stron) |

### 4.14 Persona z twarzy (`lib/media/face.ts`, od 21.11.2026, zadanie I5)

**Co to jest.** Opcjonalny krok `--faces` (`enrich`, `pipeline`, `analyze-material`) szuka twarzy w obrazie reklamy, w dalszych zrzutach sprawy i w klatkach wideo (te same klatki co CLIP, `extractFrames`) i porównuje je z **zamkniętą listą osób publicznych** (od I5b 127 wpisów, 31 ze zdjęciami) (`data/osoby-publiczne.json`: `id`, `name`, `aliases`, `role`, `source` = publiczne ostrzeżenie, dla którego osoba jest na liście; 3–5 zdjęć każdej z Wikimedia Commons w `data/faces/<id>/`, autor i licencja w `data/faces/ZRODLA.md`, wektory w `data/faces/index.json`, budowane `face_embed.py --build-index data/faces`). Ta sama lista posłuży galerii głosów i personie z tekstu (`PUBLIC_PERSONS_FILE`; `analyze-material` bierze ją, gdy nie ma innej listy osób).

**Modele.** OpenCV YuNet (`face_detection_yunet_2023mar.onnx`, MIT) i SFace (`face_recognition_sface_2021dec.onnx`, Apache-2.0) z OpenCV Zoo, w `opencv-python-headless` (Apache-2.0). Modele leżą poza repozytorium (`FACE_MODEL_DIR`), w obrazie Dockera są pobierane przy budowie. Bez InsightFace, DeepFace z domyślnymi wagami i innych wag NC.

**Wynik.** „Podobna twarz do X (0,xx)”, nigdy „to jest X”. `FaceHit` ma ramkę i, tylko dla twarzy powyżej progu, `persona` (id osoby) oraz `similarity`. Twarz niedopasowana zostaje ramką bez persony. Wektory (dopasowanych i niedopasowanych) nie opuszczają `face.ts`: nie trafiają do `enriched.json`, cache, grafu, eksportu ani paczki dowodów.

**Wzór dopasowania.** Dla każdej osoby najwyższy cosinus do któregokolwiek jej zdjęcia, razy waga jakości twarzy; wygrywa osoba z najwyższym wynikiem, jeśli osiąga próg. Waga jakości (na wzór MagFace: słaba twarz daje niewiarygodny wektor, więc liczy się mniej) = `min(1, krótszy bok ramki / 80 px) × min(1, wynik detektora / 0,9)`; twarze o krótszym boku < 24 px nie są dopasowywane. Wartości w `DEFAULT_FACE_CONFIG` (`face.ts`).

**Persona z twarzy a graf (decyzja).** Jest to ten sam węzeł persony co z tekstu (`persona:<id>`), z opisem źródła „z twarzy (podobna twarz, 0,xx; do przeglądu przez człowieka)” na krawędzi `mentions_persona`. Osobny typ węzła nie jest potrzebny: osoba jest jedna, a nowy typ wymagałby wpisów w słownikach `lib/viewer` i `components/viewer`. Persona jest w `campaignRules.familyOnlyKinds`, więc **cecha twarzy działa tylko na poziomie grupy podobnych kampanii** (ta sama osoba jako przynęta u wielu operatorów) i nigdy nie łączy dwóch materiałów w kampanię. Test: `tests/faceGroup.offline.test.ts` (dwie kampanie z różną infrastrukturą, ta sama persona z tekstu i z twarzy, wspólna treść → dwie kampanie w jednej grupie).

**Brak adaptera.** Bez venv, modeli albo indeksu `detectFaces` zwraca `{ skipped: "brak adaptera twarzy (scripts/py/setup-face.sh)" }`; w `analyze-material` krok `faces` ma status `skipped` z tym powodem.

**Weryfikacja 1:1 (B-072).** `--faces --verify-person <id>`: porównanie tylko ze zdjęciami wskazanej osoby (`only` w `matchFaces`); nieznane id daje `skipped`.

**Pomiar progu (B-069, `scripts/py/face_threshold.py`).** Zbiór „obcych”: 62 zdjęcia (54 wykryte twarze, największa twarz ze zdjęcia) 26 innych polskich osób publicznych z Wikimedia Commons, **poza repozytorium** (`data/twarze-pomiar`). Ta sama osoba: 30 par typu leave-one-out między zdjęciami bazy (zdjęcie wobec pozostałych zdjęć tej samej osoby, wygrywa właściwa osoba). Wynik z wagą jakości jak w kodzie:

| Próg | Trafienia tej samej osoby (z 30) | Fałszywe trafienia na obcych (z 54) |
|---|---|---|
| 0,363 (zalecany dla SFace) | 96,7% | 9,3% (5 twarzy) |
| 0,40 | 96,7% | 1,9% (1 twarz) |
| **0,46 (przyjęty)** | **96,7%** | **0% (0 z 54; górna granica 95% ≈ 5,5%)** |
| 0,50 | 90,0% | 0% |
| 0,60 | 83,3% | 0% |

Przyjęty próg `matchThreshold` = 0,46: najniższy z zerem fałszywych trafień na tym zbiorze. Zalecany 0,363 dawał ok. co dziesiątą obcą twarz przypisaną do osoby z listy (najwyższe wyniki obcych: 0,44 politycy do dziennikarza z listy, 0,40 do byłego prezydenta), a błędna persona jest gorsza niż jej brak. Ograniczenia: mały zbiór (54 twarze, więc zero oznacza „poniżej ok. 5%”), zdjęcia z Commons są jakościowo lepsze niż zrzuty z reklam (na zrzutach trafień będzie mniej), pary leave-one-out są obciążone tym, że w bazie bywają zdjęcia z jednej sesji.

**Pomiar na danych poufnych** (poza repozytorium, `TWARZE.md` w katalogu danych): w jednej sprawie rozpoznana osoba z listy osób publicznych (0,57, twarz ok. 220×288 px), w drugiej 22 małe twarze bez trafienia.

**Rozszerzenie bazy (I5b, 22.11.2026).** Lista `data/osoby-publiczne.json` ma 127 wpisów: 35 osób z rolą (10 z I5/I15 i 25 nowych: tier 1 i 2 z badania podszywanych osób, lekarze z ustaloną tożsamością i źródłem, osoby wymienione w tych samych artykułach, Sekielski z wyjątku właściciela, dwoje sportowców wzmacniających słabą kategorię) oraz 92 osoby z zestawienia NASK z 12.07.2024 bez zdjęć. Nowe pola `category` (grupa z zestawienia NASK) i `voiceFake` (badanie dokumentuje podrobiony głos); `category` trafia do `PersonaMatch`, do węzła persony i do `features.personaCategories` w `analyze-material` (cecha grupy, nie dowód). Osoby z zestawienia NASK dopasowuje się wyłącznie po pełnym imieniu i nazwisku (z odmianą), bez samego nazwiska; nieregularne formy odmiany (celownik, miejscownik) są aliasami. Baza twarzy: 31 osób, 103 zdjęcia (Sołowow i Sutkowski nie mają zdjęcia na wolnej licencji o wystarczającej jakości, Torbicki i Friz mają po 1, Drzyzga 1). Kontrola: mediana kosinusa między zdjęciami tej samej osoby 0,62 (osoby poniżej progu 0,46: Brzoska 0,41 z powodu zdjęcia z profilu, Drzyzga 1 zdjęcie); najbliższa para różnych osób 0,43 (Domański–Sekielski), poniżej progu 0,46. Zdjęcie Drzyzgi z Prokopem usunięto po kontroli (detektor wziął twarz Prokopa, kosinus 0,76). Próg bez zmian.

**Zakres.** Bez crawlera twarzy i bez rozbudowy bazy z sieci poza listą osób ze źródłem podszycia (AI Act art. 5 ust. 1 lit. e); bez detektora deepfake i oceny „czy to prawdziwa osoba”. Uwagi prawne: `docs/ZGODNOSC.md`.

**Wynik i dodanie osoby.** Wynik to „podobna twarz do X (0,xx)” do przeglądu człowieka, a nie „to jest X”; trafia do pola `faces` materiału i do persony jako cecha **grupy** podobnych kampanii, nigdy jako dowód jednej kampanii. Wektory twarzy nie są zapisywane. Zmienne: `FACE_PYTHON` (interpreter venv, domyślnie `.venv-face/bin/python`), `FACE_MODEL_DIR` (domyślnie `~/models/opencv`). Własne osoby (np. instytucja, która chce rozpoznawać inne osoby ze swoich ostrzeżeń): dopisz wpis z `source` (publiczne ostrzeżenie) do `data/osoby-publiczne.json`, wrzuć 3–5 zdjęć z wolną licencją do `data/faces/<id>/` (id = nazwisko bez polskich znaków, małymi, z myślnikami), wpisz je do `data/faces/ZRODLA.md` i `LICENCJE.md`, po czym uruchom `python3 -I scripts/py/face_embed.py --build-index data/faces` (z `FACE_PYTHON`). Nie buduj bazy zdjęć z sieci hurtem (AI Act art. 5 ust. 1 lit. e).

### 4.15 Napisy w wideo (`lib/media/videoOcr.ts`, B-305)

Opcjonalny krok OCR (`--ocr`): `readVideoText` próbkuje klatki ffmpeg co `VIDEO_OCR_CONFIG.everySeconds` (2 s, max 30 klatek / 60 s, szerokość 960 px), czyta każdą tesseractem (`--psm 11`, `pol+eng`, a gdy brak `eng`: `pol`) i przepuszcza linie przez `filterVideoLines` (normalizacja, odrzucenie linii krótszych niż 5 liter i śmieci, napisów odtwarzacza, deduplikacja między klatkami). Wynik trafia do `EnrichedItem.videoOcrText` (cecha `videoOcrText`, rodzina `content`) i do tekstu maszynowego w `enrich.ts` (`combined`, `machineText`) oraz `link.ts` (narracja, `scamBrands`, `profitClaims`, `textOf`). Bez ffmpeg albo tesseract zwraca `null`; test akceptacyjny w `videoOcr.test.ts` jest wtedy pomijany.

### 4.16 Persona z głosu (`lib/media/speaker.ts`, od 21.11.2026, zadanie I15)

**Co to jest.** Opcjonalny krok `--speaker` (`enrich`, `pipeline`, `analyze-material`) tnie ścieżkę dźwiękową wideo na okna po 4 s (krok 2 s), porównuje każde okno ze **wzorcami osób z galerii głosów** i zapisuje w danych materiału `voices?: Array<{ start, end, persona?, similarity? }>` (sekundy od początku nagrania; `persona` i `similarity` tylko dla głosu podobnego do osoby z listy). Etykieta: **„głos podobny do X (0,57)”**, nigdy „to jest głos X”. Galeria to ta sama zamknięta lista osób publicznych co dla twarzy (`data/osoby-publiczne.json`, wpis ma publiczne ostrzeżenie w `source`), wzorce w `data/voices/index.json` (wektory 192 liczb, po jednym na nagranie; bez nagrań), źródła nagrań w `data/voices/ZRODLA.md`. Do listy dopisano Izabelę Leszczynę i Buddę (źródło: film NASK z kompilacją fałszywych reklam), więc głos ma 10 osób, a twarz 8 (dla dwóch dopisanych osób nie ma zdjęć).

**Model.** SpeechBrain ECAPA-TDNN (`speechbrain/spkrec-ecapa-voxceleb`, Apache-2.0, bez douczania) i SpeechBrain VAD (`speechbrain/vad-crdnn-libriparty`; odróżnia mowę od muzyki i szumu; **karta modelu nie podaje licencji wag**, a model trenowano z szumem z UrbanSound8K na licencji CC BY-NC, więc do potwierdzenia przed użyciem komercyjnym, patrz LICENCJE.md; kod SpeechBrain: Apache-2.0). Oba w venv `.venv-speaker` (`scripts/py/setup-speaker.sh`), modele poza repozytorium (`SPEAKER_MODEL_DIR`, `SPEAKER_VAD_DIR`). Demucs (rozdzielanie źródeł) nie jest użyty: VAD odrzuca okna z samą muzyką bez ciężkich zależności.

**Reguła (`matchVoiceWindows`, czysta funkcja, testy w `speaker.test.ts`).** (1) Okno cichsze niż −45 dBFS albo z prawdopodobieństwem mowy VAD < 0,5 jest odrzucone (cisza, samo tło lub sama muzyka). (2) Wzorzec osoby = znormalizowana średnia jej wektorów z nagrań. (3) Okno nazywa osobę, gdy kosinus do jej wzorca ≥ **0,5** **i** przewaga nad drugą osobą ≥ **0,15**. (4) Persona liczy się, gdy nazywa ją **co najmniej 2 sąsiednie okna** (6 s głosu): pojedyncze okno obcego bywało podobne do kogoś przypadkiem (0,51–0,53). (5) Sąsiednie okna tej samej osoby tworzą przedział `start`/`end`, `similarity` = średnia kosinusów okien. Wartości w `DEFAULT_VOICE_CONFIG`.

**Wzorzec osoby.** `scripts/py/build_voice_index.py`: dla każdej osoby 5–8 polskich nagrań z YouTube (yt-dlp, tylko fragment 90 s dźwięku, do katalogu poza repozytorium), okna, wektor nagrania = średnia okien **mówcy, który pasuje do pozostałych nagrań osoby** (rozmówca albo współprowadzący to druga grupa okien, nie wzorzec). Nagranie, w którym żaden mówca nie ma kosinusa ≥ 0,4 do pozostałych, jest odrzucane i opisane w `ZRODLA.md` (6 z 76).

**Dodanie osoby.** Wpis ze `source` w `data/osoby-publiczne.json`, 5–8 polskich nagrań tej osoby (wystąpienia, wywiady) w pliku źródeł (JSON: `set: "gallery"`, `person`, `url`, `start`, `seconds` 30–120), potem:

    .venv-speaker/bin/python -I scripts/py/build_voice_index.py --sources <plik> --work-dir <katalog poza repozytorium> \
      --model-dir ~/models/speechbrain/spkrec-ecapa-voxceleb --vad-dir ~/models/speechbrain/vad-crdnn-libriparty \
      --index data/voices/index.json --zrodla data/voices/ZRODLA.md --persons-file data/osoby-publiczne.json

Skrypt pobiera fragmenty przez yt-dlp, zapisuje wektory i listę źródeł; nagrania zostają w katalogu roboczym. Pomiar progu i fałszywych trafień: `bun run voice:eval -- --work-dir <katalog>`.

**Persona z głosu a graf (decyzja).** Ten sam węzeł persony co z tekstu i twarzy (`persona:<id>`), krawędź `mentions_persona` z opisem „z głosu (głos podobny do osoby, 0,xx; do przeglądu przez człowieka)”, `PersonaMatch.source = "voice"`. Persona jest w `familyOnlyKinds`: **cecha głosu działa tylko na poziomie grupy podobnych kampanii** (ta sama osoba jako przynęta u wielu operatorów), nigdy nie łączy materiałów w kampanię. Test: `tests/faceGroup.offline.test.ts` (druga część: dwie kampanie z różną infrastrukturą, wstrzyknięty wynik adaptera → dwie kampanie w jednej grupie). Wektory okien nie opuszczają `speaker.ts` (w `enriched.json` zostaje tylko całoplikowy `speakerEmbedding`, jak dotąd; nie ma go w grafie ani w eksporcie).

**Brak narzędzi.** Bez venv, modelu mowy albo galerii krok jest pominięty z powodem w logu („głos mówcy pominięty: …”), a w `analyze-material` krok `voice` ma status `skipped` z tym powodem; nic się nie wywraca.

**Pomiar (B-248, `bun run voice:eval -- --work-dir <katalog poza repo>`).** Galeria: 10 osób, 76 nagrań wybranych, 70 użytych (Brzoska 6, Olejnik 8, Glapiński 8, Tusk 8, Morawiecki 8, Stanowski 6, Lewandowski 6, Duda 7, Leszczyna 8, Budda 5). Kosinus między nagraniami tej samej osoby: średnio 0,66–0,86 (minimum 0,52); między wzorcami różnych osób ≤ 0,49 (najbliższe pary: Olejnik–Leszczyna, Glapiński–Brzoska i Morawiecki–Duda po 0,49). Zbiór „obcych”: 22 nagrania 11 innych polskich polityków (po 2, fragmenty 90 s) i 3 utwory muzyczne, wszystko poza repozytorium. Ta sama osoba: leave-one-recording-out (nagranie wobec indeksu bez niego). Dla wybranego ustawienia (0,5 / 0,15 / 2 okna):

| Miara | Wynik |
|---|---|
| nagranie osoby z listy nazwane właściwą osobą (co najmniej jeden przedział) | 70/70 |
| nagranie nazwane inną osobą z listy | 1/70 (1,4%) |
| nagranie obcego z personą (fałszywe trafienie) | 1/25 (4,0%) |
| okna obcych w przedziale z personą | 5/824 (0,6%) |
| utwory muzyczne z personą | 0/3 (VAD: 0–0,07 prawdopodobieństwa mowy; mowa 0,92–0,99) |

Jedyne „fałszywe” trafienie to nagranie z kanału Zero, w którym przez 14 s mówi głos podobny do Krzysztofa Stanowskiego (0,67–0,76; w tym fragmencie jest czytana zapowiedź sponsorów kanału), więc prawdopodobnie jest to naprawdę ten głos, a nie błąd; nie sprawdziłem tego na słuch. Bez tego nagrania 0/24. **Cel FPR ≤ 3,5% nie jest potwierdzony statystycznie**: 25 nagrań daje przy zerze błędów górną granicę 95% ok. 13%. Progi: przy 0,45 i 1 oknie fałszywych trafień było 7/25 (28%), przy 0,55–0,60 spada liczba trafień na osobie z listy (0,55 z 3 oknami: 68/70), więc 0,5 z minimalnie 2 oknami to najniższy próg bez fałszywych trafień poza przypadkiem Stanowskiego.

**Zbiór testowy fałszywek.** Film NASK z kompilacją 5 fałszywych reklam (YouTube `QKYthjXNn08`, 170 s; opis wymienia: Duda, Leszczyna, Lewandowski, Brzoska, Budda), pobrany poza repozytorium, nieużyty w galerii. Wynik (0,5 / 0,15 / 2 okna): **5/5 fałszywek nazwanych właściwą osobą**: Duda 0,69 (58 s), Lewandowski 0,65–0,66, Brzoska 0,60, Budda 0,56, Leszczyna 0,66; żadna inna osoba nie została nazwana. Zastrzeżenie: kolejność i granice fałszywek wzięte z kolejności w opisie filmu i z wyniku, nie z ręcznej etykiety czasów.

**Ograniczenia.** Model nie był trenowany na polskiej mowie (w pomiarze wstępnym wywiad PL 0,57 wobec przemowy EN 0,40–0,43); nagrania galerii to głównie wystąpienia i wywiady, a reklamy mają inną akustykę (kompresja, muzyka pod głosem; VAD przepuszcza mowę z muzyką w tle); lektor zamiast osoby w fałszywce nie da trafienia (jak w pomiarze wstępnym); zbiór obcych jest mały; jest to cecha grupy kampanii, nie detektor klonu głosu ani ocena autentyczności nagrania. Dane biometryczne: `docs/ZGODNOSC.md`.

### 4.17 Poprawki metody po walidacji (22.11.2026, zadanie I10)

Walidacja na materiałach spoza próbki (zadanie I4, publiczne skany) pokazała prawie wyłącznie rozbicia (precyzja ok. 0,99, czułość niska). Poprawki mają ogólne uzasadnienie i test syntetyczny; liczby przed i po są w Raporcie zadania (dane poufne poza repozytorium).

| Zmiana | Gdzie | Uzasadnienie |
|---|---|---|
| Ścieżki `/cdn-cgi/` ×0,02 (błąd walidacji 4) | `lists.endpointPlatformPaths` | CDN z proxy (Cloudflare) dopisuje własne skrypty (np. `email-decode.min.js`) każdej stronie za proxy: cecha CDN, nie operatora. W publicznych skanach ten plik był w kilkudziesięciu materiałach różnych rodzin, z pełną wagą zestawu stron |
| Plik ładowany z witryny jednego konta darmowego hostingu = hosting tego konta (błędy walidacji 1 i 6) | `lists.accountSiteSuffixes` (np. `netlify.app`, `pages.dev`, `github.io`, czynnik relacji 0,7), `Discounter.accountSite` (`weights.ts`), `link.ts` (węzeł `host` pliku spoza domeny strony, krawędź `on_host` od węzła pliku) | Na takiej platformie każda subdomena to witryna jednego konta. Strona, która ładuje swoje skrypty z cudzej witryny, korzysta z hostingu tego konta. Kupiec skopiowanego zestawu stron trzyma pliki na własnej domenie, a publiczne CDN mają zniżkę (`lists.domains`). Ślad liczy się jako hosting (`host`, waga 0,95 × 0,7, nie silny, bo relacja < 1, nie w `notAloneKinds`), więc razem z plikiem zestawu tworzy kampanię. Czynnik 0,7, a nie 0,4 jak link wychodzący: to prawie bezpośredni hosting, a przy 0,5 IDF dużej partii (ślad w 14% materiałów) zbijał wagę poniżej progu dowodu pośredniego (`discountedMinWeight` 0,3), więc ślad przestawał się liczyć (drugi przebieg walidacji). Host spoza listy platform hostingowych (sieć reklamowa, usługa statystyk) nie dostaje tego węzła: lista usług publicznych nigdy nie jest pełna. W walidacji wszystkie takie hosty należały do jednej rodziny |

**Narracja materiału (B-187, B-294, B-296, B-297; `lib/text/narrative.ts`).** `detectNarrative({ headline, body })` czyta temat (`investment`, `subsidy`, `health` z podkategoriami `joints`, `weight_loss`, `hypertension`, `vision`, `hearing`, `diabetes`, `miracle_cure`, `gambling`, `elections`, `ai_trading`, `gold_reserve`, `commodities_war`, `leaked_secret`, `testimonial_small_win`, `recovery`, `sport_event`, `inauguration`, `state_investment`, `adult_phishing`, `urgent_notice`, `petition`), formę przynęty (`hooks`: `sensation`, `endorsement`, `fake_interview`), obietnicę zysku i zaproszenie do grupy. Słownik `DEFAULT_NARRATIVE_CONFIG`: terminy po złożeniu tekstu (małe litery, bez znaków diakrytycznych), dopasowanie od początku słowa, „*” = rdzeń z dowolną polską końcówką („swiadczeni*” łapie „świadczenie”, nie „doświadczenie”). Nagłówek (tytuł strony, `og:title`, pierwsza linia reklamy) liczy się podwójnie (`headlineWeight`); ciało to treść reklamy, OCR bez interfejsu platformy, transkrypcja, opis i widoczny tekst strony (do `maxBodyChars`). Etykieta reguły IHC `celeb_bait_investment` (`celebBaitLabel`): persona z listy ORAZ (obietnica zysku ALBO zaproszenie do grupy ALBO podrobione medium, czyli `impersonatedBrand` lub `advertiserImpersonates`); to atrybut, nie wynik ryzyka. W grafie: `item.data.narrative` (`MaterialNarrative`: tematy z wynikiem i terminami, przynęty, etykieta, **data materiału**), `Campaign.attributes.narrative` i `CampaignFamily.narrative` (`NarrativeSummary`: główny temat każdego członka z liczbą i datami, przynęty, etykiety, `switches`: kolejni członkowie z różnym głównym tematem w odstępie ≤ `switchWindowDays` dni, czyli opis „ten sam operator, dwie narracje”), `CampaignFamily.personaCategories` (grupy osób z listy, np. „Dziennikarze”, z liczbą członków); w `analyze-material` pole `features.narrative`. **Narracja nie jest pivotem**: nie tworzy węzła, nie zmienia wyniku pary ani `campaignScore` (test `lib/graph/narrativeAttr.test.ts`), bo jeden operator zmienia temat za wiadomościami tygodnia, a ten sam temat mają niezwiązani operatorzy. Kwoty (np. 250 USD) nie są pivotem. W paczce dowodów `financial_service_offered` domeny to cytat zdania z tematem finansowym (`financialTopics`, `topicQuote`) z dopiskiem „(wniosek z narracji materiału: …)”, a działanie dla KNF zależy od tego atrybutu; wcześniejszy regex `hasFinancialOffer` łapał każde słowo „platforma”. Model językowy jako sędzia i bge-m3 do opisów kategorii nie weszły (opcjonalne w opisie pozycji).

**Para osób w jednym materiale (B-295).** Dwie osoby z listy w jednym materiale (np. fikcyjna rozmowa dwóch znanych osób) dają węzeł `persona:pair:<id1>+<id2>` (`data.pair`, krawędź `mentions`, żeby przeglądarka nie pokazywała pary jako osoby) z wagą `personaPairWeight` 0,35 zamiast 0,1. Para jest rzadsza niż jedna osoba, więc sama przekracza `familyMinScore` (0,3) i tworzy grupę podobnych kampanii, ale jak każda persona jest w `familyOnlyKinds`: nigdy nie łączy kampanii (test: ta sama para, różna infrastruktura → dwie kampanie w jednej grupie; jedna wspólna osoba → bez grupy).

**Most i najsłabsze ogniwo kampanii (B-123; `cluster.ts`: `bridgeOf`, `weakestLink`).** Pola opcjonalne w `campaigns.json` dla przeglądarki. `Campaign.bridge` (`pivot`, `type`, `label`, `parts`): pierwszy (po kluczu) silny pivot, po którego usunięciu z łączących powiązań kampania rozpada się na części po co najmniej `bridgeMinPartSize` (2) członków, bez innych wspólnych dowodów między częściami. GUI może to pokazać jako „kampania sklejona jednym śladem: X” i kandydata do `lists.pivots`: jeśli ten ślad to usługa wspólna albo pomyłka, części są osobnymi kampaniami. `minInternalScore` i `weakestMember` (`id`, `score`, `links`): najniższy spośród najlepszych łączących wyników członków, czyli członek, który wisi najbliżej progu (wcześniej była tylko średnia `cohesion`). Diagnoza, nie zmiana reguł: przydział do kampanii się nie zmienia.

**Podrabiana marka na kreacji (B-199, tani wariant; `lib/media/brand.ts`).** Przy `--clip` osadzenie obrazu kreacji jest porównywane (zero-shot) z osadzeniami tekstowymi CLIP (`embedTexts` w `imageEmbed.ts`, wieża tekstowa tego samego modelu) promptów 21 marek (`DEFAULT_BRAND_CONFIG`: portale i telewizje informacyjne, banki, NBP, ZUS, KNF, Orlen; szablony „the {name} logo”, „a screenshot of the {name} website”, „a news article from {name}”) i 5 promptów neutralnych (osoba, post, produkt, reklama z tekstem, klatka z mówiącą osobą). `matchBrand`: każda marka bierze najlepszy prompt, softmax ze skalą 100 po markach i promptach neutralnych; marka wygrywa, gdy ma ≥ `minProbability` (0,6), więc dwie podobne marki albo przewaga promptu neutralnego dają brak marki. Wynik `ItemEnrichment.creativeBrand` → `item.data.creativeBrand`, `Campaign.attributes.brands`, `CampaignFamily.brands`, `features.creativeBrand` w `analyze-material`; liczy się też jako „podrobione medium” w etykiecie IHC. **Cecha marki, nie operatora**: brak węzła i wpływu na wynik pary (test w `narrativeAttr.test.ts`). Bez modelu (np. `HF_HUB_OFFLINE=1` bez pobranej wieży tekstowej) krok zapisuje powód w `errors` materiału („marka (CLIP zero-shot): …”). Sprawdzenie na syntetycznych obrazach z napisem: TVN24 0,994, PKO BP 0,99, obraz bez marki: brak. Próg nie jest skalibrowany na prawdziwych kreacjach. Nie zrobione z opisu pozycji: domeny podobne (`lookalike_of`), Phishpedia, typosquat mediów, `og:site_name`.

**Halucynacje ASR i VAD (B-213; `lib/media/asr.ts`).** `stripHallucinations` usuwa w dowolnym miejscu transkrypcji zdania, które whisper dopisuje do muzyki i ciszy (podziękowania napisów: „Napisy stworzone przez społeczność Amara.org”, „Dziękuję za obejrzenie”, „Thanks for watching”), a gdy zostają same wypełniacze ciszy, transkrypcja jest pusta. Działa w `cleanTranscript` i przed `textOf` oraz narracją (także dla `asrText` zapisanych wcześniej). Whisper-cli dostaje `--vad -vm <model>`, gdy jest model Silero (`WHISPER_VAD_MODEL`, domyślnie `~/models/whisper/ggml-silero-v5.1.2.bin`, ok. 0,9 MB z `ggml-org/whisper-vad`); bez niego działa jak dotąd, a log `enrich` podaje powód („bez VAD: brak modelu Silero …”). Powód zmiany: dwa wideo z samą muzyką dostawały wspólną halucynację (`similar_text`) i podobny podkład (`similar_audio`), czyli dwa rodzaje treści, co bez infrastruktury tworzyło fałszywą kampanię z `basis: "content"`. Sprawdzenie na dżinglu z próbki: bez VAD „Dziękuje za oglądanie!”, z VAD pusta transkrypcja.

**Wpisy HAR z wcześniejszej strony sesji (B-211; `pageEntries` w `caseImport.ts`).** HAR zapisany po przeglądaniu zawiera żądania wcześniejszych stron tej samej sesji przeglądarki. Hosty, adresy IP, lista żądań (zasoby, najemcy, ścieżki) i obrazy strony powstają teraz tylko z wpisów jej strony: przy rekordach stron HAR z wpisów o tym samym `pageref` co dokument główny, bez nich z wpisów od chwili startu dokumentu, plus przekierowania (3xx), które do niego prowadzą (poprzedzają dokument, ale są częścią tej nawigacji). Wpisy bez czasu i HAR-y bez dokumentu (lista żądań skanu) zostają w całości. Powód: adres IP obcej strony (0,6, poza `notAloneKinds`) sam tworzył kampanię.

**Tokeny weryfikacji domeny (B-155; `verificationTokens`, `findTrackers` w `extract.ts`, `link.ts`).** `<meta name="facebook-domain-verification" | "google-site-verification" | "yandex-verification" content="…">` w kodzie strony i te same wpisy w rekordach TXT domeny (`DomainInfo.txt`, dotąd zbierane i nieużywane) dają węzeł typu `tracker` z rodzajem `meta_domain_verification`, `google_site_verification`, `yandex_verification` (bez nowego typu węzła, który wymagałby zmian w przeglądarce). Waga `verificationTokenWeight` 0,9 (silny): token należy do jednego konta Business Managera, Search Console albo Webmastera, które zweryfikowało obie domeny; trochę mniej niż identyfikator piksela, bo agencja może weryfikować domeny kilku klientów na jednym koncie. Wartości puste, za krótkie (< 8 znaków), zastępcze („XXXX”) i inne rekordy TXT (SPF, DKIM) są odrzucane.

**Wiek domeny i certyfikatu w dniu pierwszej obserwacji (B-191, B-206; `lib/osint/domainAge.ts`).** Dla domeny strony docelowej (końca łańcucha przekierowań) materiał dostaje `domainAgeDays` (pełne dni od `created` z RDAP do `firstSeen`) i `certAgeDays` (od najwcześniejszego `notBefore` certyfikatu z CT); wartość ujemna znaczy rejestrację po materiale (np. domena przejęta albo zarejestrowana ponownie). Węzeł domeny dostaje `leadDays` i `certLeadDays` (wyprzedzenie rejestracji i pierwszego certyfikatu względem najwcześniejszego materiału tej domeny) oraz `firstCertificate`; bez RDAP `created` zostaje sam wiek pierwszego certyfikatu (opisany jako „pierwszy certyfikat”, nie „rejestracja”). Pola widać w `features` (`analyze-material`) i w `pivots[].data` węzła domeny. Opis, nie wskaźnik ryzyka i nie pivot. Nie zrobione z opisu pozycji: `domainRole` (tracker sprzed lat vs lander sprzed doby) i porównanie z pierwszą kopią Wayback.

**Spójne części społeczności Louvaina (B-121; `splitDisconnected` w `cluster.ts`).** Po przydziale składowych silnych do społeczności każda grupa jest dzielona na spójne części grafu łączących powiązań (werdykt `campaign`). Louvain optymalizuje modularność i może zwrócić społeczność z części bez żadnego powiązania między nimi, co skleiłoby niezwiązane materiały w jedną kampanię. Leiden, który gwarantuje spójne społeczności, odpada przez licencję GPL implementacji referencyjnej (`leidenalg`).

**Marka oszustwa (B-139; `lib/text/scamBrand.ts`).** Nazwa produktu albo „platformy inwestycyjnej”, którą nadaje operator (nie marka, pod którą się podszywa), z treści reklamy, OCR, transkrypcji, tytułu, opisu i tekstu strony oraz z `landingName` platformy stron. Wzorce: nazwa CamelCase z opcjonalną wersją („TradeSynthIQ 4.7”), wyraz wielką literą z przyrostkiem produktu (Forte, Max, Pro, AI, Invest…), wyrazy przed formą prawną (S.A., Ltd…). Klucz znormalizowany (małe litery, bez znaków diakrytycznych, tylko litery i cyfry: „TradeSynthIQ 4.7” = „tradesynthiq47”). Odrzucane: marki podszywane i powszechne (banki, portale, platformy, płatności; `impersonated` w konfiguracji modułu), za krótkie klucze. W grafie węzeł `campaign_param:scam_brand=<klucz>` (bez nowego typu węzła), waga `scamBrandWeight` 0,45, rodzaj reguły `scam_brand` (`evidenceKind`) w `notAloneKinds`: marka przetrwa zmianę twarzy i domeny, ale jeden produkt sprzedaje wielu afiliantów, więc sama daje najwyżej grupę podobnych kampanii, a z dowodem operatora potwierdza kampanię. Nie liczy się do infrastruktury materiału. Ogólne nazwy platform (`lists.genericScamBrands`, np. `quantumai`, `immediate*`) ×0,2; poza tym IDF. Materiał z samą nazwą produktu (`analyze-material --text "<produkt>"`) dostaje dzięki temu grupę z kampanią tej marki, więc werdykt „podobne kampanie” zamiast „za mało danych”. Nie zrobione: tekst linków CTA osobno, domena wyświetlana w linku różna od `href` (`fake_display_url`), `displayDomain`/`displayMismatch` z podpisu reklamy.

**Ślady z żądań strony (B-158, B-116; `requestSignals` w `pagekit.ts`, `fromExtension` w `caseImport.ts`, `link.ts`).** Z listy żądań (HAR, skan) powstają: identyfikator piksela Mety z `facebook.com/tr?id=` i `connect.facebook.net/signals/config/<id>` (`requestTrackers` → węzeł `tracker`, jak piksel z kodu strony), identyfikator kliknięcia xid z adresów zdarzeń trackera (`upd_clickid=` i inne parametry, `requestClickUrls` → `click_server`) oraz hosty spoza domeny rejestrowalnej strony (`requestHosts` → węzeł `endpoint:tracker_host:<host>`, waga `trackerHostWeight` 0,25, rodzaj reguły `tracker_host` w `notAloneKinds`; hosty bez domeny rejestrowalnej pomijane). Host z list usług wspólnych (`lists.domains`, `lists.endpointHosts`) albo ruchu przeglądarki (`lists.browserHosts`: aktualizacje, telemetria, popularne rozszerzenia) nie dostaje węzła. Host nie jest silny i sam nie łączy, nawet w grupę (waga poniżej `familyMinScore`): lista usług publicznych (widżety, hosting zrzutów ekranu, sieci reklamowe, statystyki) nigdy nie jest pełna, więc host tylko potwierdza dowód operatora albo inne ślady zestawu. Przy wadze 0,5 drugi przebieg walidacji dał dwa negatywy z „podobnymi kampaniami” przez wspólną usługę zewnętrzną. Banki zdjęć (`unsplash.com`, `pexels.com` …) są na liście domen powszechnych (część B-125). Import pomija żądania uruchomione przez rozszerzenie przeglądarki osoby zapisującej HAR (`_initiator` albo dowolna ramka stosu inicjatora z `chrome-extension://`, `moz-extension://` …); żądanie skryptu strony do usługi zewnętrznej zostaje (klasyfikacja po łańcuchu inicjatorów, nie hurtem). Nie zrobione: konto hostingu wideo z nazwy hosta (B-165), piksel z nazwy pliku konfiguracji w `_files`, xid z pól formularzy.

**Bezwzględny limit `df` silnego dowodu (B-128; `maxStrongDf` 20, `pivotWeight`).** Silny pivot (union-find) musi mieć `df ≤ min(maxStrongDfRatio × N, maxStrongDf)`. Przy samym limicie względnym w dużej partii ślad wspólny dla setek materiałów nadal skleja je łańcuchowo w union-find; powyżej 20 materiałów łączy już tylko przez Louvaina i reguły kampanii (z IDF). Małe zbiory bez zmian (np. df 2 przy N 15). Największa kampania danych referencyjnych ma 8 materiałów, więc limit jej nie dotyka; wynik na walidacji: Raport zadania.

**Platforma strony jako atrybut (B-190).** Reguły list `endpointPlatformPaths` i `paramSchemaPlatformParts` mają opcjonalne pole `platform` (`aio` dla SDK i domyślnego linku platformy stron, `binom` dla skryptu zdarzeń, ścieżki `/click` i formatu `key=<32 hex>`). Materiał dostaje `pagePlatforms` (z tych ścieżek plików i backendów, z `window.aio`/najemcy `landing-cdn`, z `upd_clickid=` w żądaniach i z szablonu linku), kampania `attributes.platforms` z liczbą członków. **Bez łączenia, także w grupie**: odbiór pozycji przewidywał „dwie strony różnych kont → grupa”, ale to przeczy decyzji B-040 (i14fix: dwie strony na tym samym SDK pod różnymi kontami nie tworzą ani kampanii, ani grupy), bo platforma ma tysiące niezwiązanych najemców; grupa wszystkich najemców jednej platformy nic by nie mówiła. Do decyzji, jeśli platforma ma jednak tworzyć grupę. Nie zrobione z opisu: odciski Keitaro, Atomicat, `x-measure-*`, instancja platformy (serwer API, region magazynu).

**Kolumny wejścia spoza mapowania (B-214; `extraPivots`).** Kolumny danych wejściowych, których nie obejmuje mapowanie (`Item.extra`), trafiają do danych materiału jako `inputExtra` (najwyżej 30 kolumn, wartości do 200 znaków; w `analyze-material` pole `features.inputExtra`, „dane z wejścia”). Domyślnie nie łączą. Opcja konfiguracji `extraPivots` (np. `{"extraPivots": {"page_id": "advertiser"}}` w pliku `--config`) robi z wartości kolumny pivot wskazanego typu (klucz `extra:<kolumna>=<wartość>`), z wagą, zniżkami, IDF i regułami tego typu; nieznana kolumna ukrytego zbioru może więc łączyć bez zmiany kodu. Przykład pliku z nową listą zniżek i `extraPivots`: `docs/METODYKA.md`.

**Linki-opakowania platform (B-215; `unwrapPlatformUrl` w `urls.ts`).** Adres docelowy z `l.facebook.com/l.php?u=`, `lm.facebook.com`, `l.messenger.com`, `l.instagram.com/?u=`, `google.com/url?q=` albo `url=`, `googleadservices.com/pagead/aclk?…adurl=` i `ad.doubleclick.net/…;adurl=` jest dodawany jak adres z treści (URL, host, domena z infrastrukturą), z krawędzią „adres docelowy z linku-opakowania platformy”. Źródła: link reklamy, łańcuch przekierowań, pasek adresu (OCR) i adresy w treści. Domeny tych platform mają czynnik 0, więc bez rozwinięcia link w formie opakowania gubił domenę docelową, gdy nie było trybu live.

**Katalog landera platformy (B-164; `LANDER_DIR_PREFIXES` w `pagekit.ts`).** UUID bezpośrednio pod katalogiem landera platformy (`/landers/<uuid>/` trackera, `/_cdn/production/landing-cdn/<uuid>/` platformy stron) daje `path_id` już z jednego zasobu, z własnego adresu strony i z listy żądań HAR, także gdy kod strony jest znany (strona zapisana w przeglądarce ma zasoby przepisane na `./<nazwa>_files/`, zostaje jeden adres z oryginalną ścieżką). Pod innymi katalogami nadal trzeba dwóch zasobów. Wspólna biblioteka „666” ma własny prefiks i zniżkę jak dotąd. Cel: warianty z walidacji bez wspólnego śladu, które mają ten sam katalog landera na różnych domenach.

**Parametry i xid z linków wychodzących strony (B-154).** `extractCampaignParams` i `clickIdsFromUrls` czytają też `PageExtract.outboundUrls` (do 300 linków strony, np. CTA prelandera prowadzące przez tracker z `sub1=`, `offer_id`, `clickid`). Takie ślady dostają relację `outboundParamFactor` 0,8 (link operatora, ale nie sama wizyta), więc nie są silne; parametr, który jest też w linku reklamy, liczy się raz z relacją 1. Czas i licznik kliknięcia (`clickTime`, `clickCounter`) zostają z linku reklamy.

**Strona wyzwania antybotowego w teście cloakingu (B-117; `lib/osint/cloaking.ts`).** Odpowiedź 403/429/503 ze znacznikami strony wyzwania (`cf-chl`, `challenge-platform`, „Just a moment…”, „Checking your browser”) oznacza zablokowane pobranie (`CloakingVariant.botChallenge`), a test dostaje `state: "bot_challenge"` i `suspected: false` z powodem „pobranie zablokowane przez ochronę przed botami”. Wcześniej różny status wariantów dawał podejrzenie cloakingu. Logika porównania przeszła do czystej funkcji `cloakingVerdict` (bez zmiany reguł dla stron bez wyzwania). `--cloaking` zostaje wyłączone domyślnie.

**Frazy ogólnikowe reklam (B-137; `stripGenericPhrases` w `uiChrome.ts`).** Przed porównaniem tekstu (`textOf`) usuwane są stałe frazy polskich reklam („kliknij i dowiedz się więcej”, „ograniczona oferta”, „zarejestruj się teraz/dziś”, „tylko dziś”, „liczba miejsc ograniczona” …), obok etykiet interfejsu platformy. Używa ich każde oszustwo i wiele uczciwych reklam, więc dwa teksty wspólne tylko w tych frazach nie są podobne. Narracja i marka oszustwa czytają tekst bez tej zmiany.

**Aliasy parametrów trackera i TDS (B-140; `campaignParams.ts`).** `acc`, `_buyer`, `buyer` → `buyer_account` (konto kupującego ruch w trackerze: silny `campaign_param`), `_subid`, `sub_1` → `sub1`, `land_id`, `_camp_id` → `campaign_id`, `creo` → `ad_name`, `utm_code` → `utm_campaign`, `placement`, `utm_placement` → `placement` (wartość platformy: `campaignParamWeakNames` ×0,1, a „others”, „other”, „automatic” w wartościach ogólnych). Nie zrobione: `_trk` jako atrybut nazwy trackera, makro `{subid}` jako losowy identyfikator kliknięcia.

**Identyfikator reklamy Mety w parametrach (B-156) i kampania Google Ads (B-159).** Liczba 15–19 cyfr w `ad_id`, `utm_content` albo `utm_term` (szablony `{{ad.id}}`) daje ten sam węzeł `meta_ad` co `adid` odczytany z `fbclid`, więc link z parametrem i link z `fbclid` tej samej reklamy się łączą (kampania i zestaw reklam Mety nie mają osobnych węzłów: nowy typ wymagałby zmian w przeglądarce). `gad_campaignid` (dopisywany przez Google do linku reklamy) → `campaign_param` `google_campaign` (silny, bez zasięgu maszyny trackera). Nie zrobione: `meta_account` z `act`/`account_id`, dekodowanie czasu z `gclid`.

**Nowe trackery (B-162) i wydawca AdSense (B-178; `findTrackers`).** Microsoft Clarity (argument fragmentu kodu i `clarity.ms/tag/<id>`), Matomo (host z `setTrackerUrl` + `setSiteId`, bo każda instalacja liczy strony od 1), PostHog (`phc_…`) jako zwykłe identyfikatory trackera. AdSense `ca-pub-<16 cyfr>` jako tracker rodzaju `adsense` z wagą `adsensePublisherWeight` 0,5 i rodzajem reguły `adsense_publisher` w `notAloneKinds`: białe strony i przykrywki operatora bywają zmonetyzowane, ale identyfikatory wydawców bywają współdzielone przez niezwiązane serwisy (pooling), więc sam daje najwyżej grupę. Nie zrobione: `kmnrKey`, UTMify, pomijanie zapisanych konfiguracji piksela w skanie kluczy.

**Kwoty, zdjęte reklamy, zaproszenia WhatsApp (B-189, B-192, B-207).** Narracja materiału ma `amounts` (kwoty z walutą z nagłówka i treści, np. „od 1 000 zł” → 1000, „$300” → 300; liczby bez waluty, jak lata, nie są kwotami); to atrybut, kwota nigdy nie jest pivotem. Kampania ma `attributes.takenDownCount` (członkowie, których reklamę biblioteka reklam pokazuje jako zdjętą przez platformę). Zaproszenie do grupy WhatsApp (`chat.whatsapp.com/…`) ma etykietę „WhatsApp …” w węźle (bez nowego typu węzła), żeby przeglądarka nie pokazywała go jako Telegramu.

**Regresja po zmianach z §4.17** (przed = kod sprzed zadania I10, po = obecny; te same dane, bez sieci):

| Zbiór | Przed | Po |
|---|---|---|
| Próbka syntetyczna, 43 reklamy | P = R = F1 = 1, ARI 1, 10 kampanii | to samo (154 pary, 0 grup) |
| Dane referencyjne, 25 spraw (28 rekordów) | P = 0,814, R = 1, F1 = 0,897, 14 kampanii, 2 grupy (2 i 11; 2 i 4), 89 par | to samo, partycja i grupy identyczne; 91 par (2 nowe pary poniżej progu przez `campaign_param`) |
| Nowe materiały (10 spraw, 12 rekordów) | znana 3, nowa 7, duplikat 2 | to samo, 0 różnic |
| Walidacja, 212 materiałów | (a) 0/78, (b) 134/134, (b′) 0, (c) B-cubed F1 0,494, pary F1 0,224 | (a) 34/78, (b) 134/134, (b′) 0, (c) 0,494, pary F1 0,427 |

### 4.18 Ślady firmy leadowej (22.11.2026, zadanie I23)

Uzasadnienie metody: `docs/METODYKA.md`, punkt 5.2. Listy i progi ekstrakcji są w `lib/osint/leadConfig.ts` (`LEAD_CONFIG`), wagi i reguły grafu w `lib/graph/config.ts`.

**Nowe pola**

| Pole | Gdzie | Znaczenie |
|---|---|---|
| `CampaignParam.origin` | `lib/osint/campaignParams.ts`; `PageKit.pageParams` | `"url"` (brak pola = adres, jak przed I23), `"form"` (ukryte pole formularza), `"script"` (obiekt konfiguracji w skrypcie: `affiliateId`, `offerId`, `flowId`, `partnerId`, `landingId`, `source`). Węzeł grafu ten sam (`campaign_param`), etykieta dowodu „(z formularza)” / „(ze skryptu strony)”. |
| `PageKit.crmKeys` | `lib/osint/crmKey.ts` | `{ sha256, preview, name, via }`: klucz API z obiektu w skrypcie, nagłówka `fetch`/`XMLHttpRequest`/`$.ajax` (`x-api-key`, `Authorization: Bearer`) albo ukrytego pola. Pełny klucz nie jest zapisywany nigdzie. Wykluczenia: `LEAD_CONFIG.crmKey` (klucze map, reCAPTCHA, Stripe/Mapbox publiczne, identyfikatory analityki, tokeny CSRF, < 16 znaków, entropia < 3 bity na znak). |
| `PageKit.templatePhrases` | `lib/text/templatePhrases.ts` | `{ key, text, source, oddity? }`: zdania 6–40 słów z widocznego tekstu i z napisów w skryptach przy `success`, `thank`, `dziękujemy`, `zadzwoni`, `alert(`, `innerHTML =` (ta sama instrukcja). `oddity`: `"repeat"` (powtórzony ciąg ≥ 3 słów) albo `"mixed_script"` (łacinka z cyrylicą w jednym słowie). |
| `PageExtract.phoneExamples` | `lib/osint/extract.ts` | numery z `placeholder`, `value` pola `type=tel`, `<label>` i tekstu z „np.”, „na przykład”, „przykład”, „e.g.”, „format” do 40 znaków przed numerem. Węzeł `page_template` z kluczem `phone_example:<E.164>`, nie `phone`. Numery sztuczne (`isArtificialPhone`) odrzucane. |
| `profitClaims` (dane węzła reklamy, cecha materiału) | `lib/text/profitClaims.ts` | `{ amount, currency, period, quote }[]` z tekstu reklamy, OCR, ASR i strony; `currency` `null`, gdy brak; wpłaty i kwoty standardowe (250) poza kluczem węzła `profit_claim`. |
| `advertiserMismatch`, `advertiserMismatchKind` (dane węzła reklamy, cecha materiału) | `lib/text/advertiserMismatch.ts` | `true` i `"business"`/`"person"`, gdy narracja jest finansowa (`financialTopics` z I10), a nazwa reklamodawcy wygląda na lokalną firmę albo osobę prywatną. Paczka: `advertiser_note` „konto reklamowe prawdopodobnie przejęte (nazwa nie pasuje do treści)”. Pivot nazwy reklamodawcy takiej reklamy jest usuwany; konto z biblioteki reklam zostaje. |

**Reguły i konfiguracja**

- Aliasy parametrów: `pid`, `partner`, `partner_id`, `wm`, `wm_id`, `webmaster`, `webmaster_id` → `aff_id`; `stream`, `stream_id`, `flow`, `flow_id` → `flow_id`; `source_id`; `landing_id`, `lp_id` → `landing_id`; `buyer_id` → `buyer_account`; `aff_click_id` → `click_id`; `s1`–`s5` → `sub1`–`sub5`. Krótkie nazwy (`pid`, `partner`, `wm`, `flow`, `stream`, `s1`–`s5`, `source`, `landing`) wymagają wartości z cyfrą i ≥ 3 znakami (`NAME_VALUE_FORMAT`).
- `lists.campaignParamPerClickNames` (`["click_id"]`): parametr nowy przy każdym kliknięciu nie tworzy węzła (zostaje w `campaignParams` materiału).
- `templatePhrase: { minDomains: 2, oddityFactor: 1.3, maxWeight: 0.65 }` (`null` wyłącza ślad). Rzadkość: zwykłe IDF i `maxPivotDf`.
- Rodzaj reguły `advertiser_name` (`evidenceKind` w `cluster.ts`, `isAdvertiserAccountKey` w `adLibraryTraces.ts`): węzeł `advertiser` z kluczem nazwy (bez `platforma:` / `extra:`) jest w `campaignRules.notAloneKinds`; konto z biblioteki i `extraPivots` łączą jak dotąd.
- Adresy API leadów (`/api/lead`, `/leads`, `/v1/lead`, `/postback`) już wcześniej zasilały `endpoint` (`LITERAL_MARKERS` i wywołania `fetch`/XHR/`$.ajax` w `pagekit.ts`).

**Regresja.** Próbka syntetyczna: bez zmian (P = R = F1 = 1, 10 kampanii, 154 pary). 25 spraw: P = 0,814, R = 1, F1 = 0,897, 14 kampanii (bez zmian); grupy (2, 2) → (2, 3): jedna kampania dołącza do grupy przez wspólny przykładowy numer z szablonu formularza (`page_template`), wynik pary 0,316 przy różnych kontach platformy stron. `template_phrase`: 260 węzłów, wszystkie powiązania wewnątrz tych samych etykiet.

### 4.19 Odcisk tekstu: maska platformy i komunikaty skryptów (22.11.2026, zadanie I25)

| Pole | Moduł | Opis |
|---|---|---|
| `PageKit.kitStrings` | `lib/osint/kitStrings.ts` | `{ key, text, oddity? }`: literały z `lexJs` (skrypty wpisane i własne zewnętrzne) wyglądające na komunikat programisty: ≥ 3 słowa, 10–200 znaków, ≥ 70% liter i spacji, nie adres, selektor ani kod; w wywołaniu `console.*`/`log`/`alert`/`throw new Error` albo zakończone „!”, „...”, „:”. `key`: małe litery, spacje zwinięte, cyfry → `#`. `oddity` z detektora I23 (`phraseOddity`). Maks. 100 na stronę. |
| `PageKit.localizedUi` | `lib/osint/kitStrings.ts` (`localizedUiLanguages`) | posortowane kody języków słownika interfejsu (≥ 5 kluczy językowych w jednym skrypcie); skrypt nie zasila `templatePhrases` ani `kitStrings`. W grafie atrybut materiału `localizedUi`. |
| `PageKit.ownScripts` | `lib/pipeline/enrich.ts` (`withOwnScripts`) | `{ read, missing }`: ile własnych skryptów zewnętrznych przeczytano, a ilu nie było (fixtures albo GET); ślady tekstu przy `missing > 0` są niepełne. |

Konfiguracja:
- `lib/osint/textConfig.ts` (`TEXT_CONFIG`): `textBoilerplate.platformScriptPaths` (ścieżki SDK platform i paczek frameworków: `/aio-static/sdk/`, `/_next/static/chunks/`, `/_nuxt/`, paczki z hashem treści), `languageCodes`, `localizedUiMinLanguages: 5`; `kitStrings.libraries` (jquery, swiper, hls, video.js, gtm, fbevents, react, vue, lodash, sentry, …), progi komunikatu, `maxScriptsPerPage: 30`, `maxScriptBytes: 512 KB`.
- `lib/graph/config.ts`: `textBoilerplate: { minPlatformAccounts: 5, maxPageShare: 0.3, minPages: 10 }` (maska częstości dla `template_phrase` i `kit_string`; konto strony: `owner_uuid`, właściciel linków platformy albo najemca CDN), `kitString: { minShared: 2, longWords: 5, minDomains: 2 }`, `typeWeights.kit_string: 0.5`, `kit_string` w `campaignRules.notAloneKinds`. `null` wyłącza maskę albo ślad.

Import skryptów do fixtures (`caseImport.ts`): skrypty z folderu `<nazwa>_files` zapisanej strony (`.js`, `.mjs`, `.js.pobrane`, `.js.download`, `.pobierz`) pod adresem, do którego rozwiązuje się przepisany `src`, oraz odpowiedzi JS z HAR (GET, 200, ta sama domena rejestrowalna co strona) pod adresem bez zapytania. Limity jak wyżej; skrypty obcych domen nie trafiają do fixtures. Log importu podaje „skrypty własne: N”. Wzbogacenie (`enrich.ts`) czyta te pliki przez `sources.fetchBinary` (offline z fixtures, online GET z tej samej domeny, bez wykonywania) i liczy kit strony jeszcze raz z ich treścią.

**Regresja.** Próbka syntetyczna bez zmian (P = R = F1 = 1, 10 kampanii, 154 pary, 0 grup). 25 spraw: F1 0,897, 14 kampanii (bez zmian); `template_phrase` 17 → 17 powiązań (260 → 261 węzłów); `kit_string` 15 węzłów, 4 powiązania; grupy (2, 3) → (2, 3, 2): nowa grupa K07 + K13 tylko przez `kit_string` (wynik 0,50, obie sprawy bez pary w etykietach roboczych). Testy: `lib/osint/kitStrings.test.ts`, `lib/graph/textFingerprint.test.ts`, `lib/pipeline/caseImport.test.ts`.

### 4.20 Pola wizyty platformy stron: cloaker i launcher (22.11.2026, B-331, B-345)

`extractLanderConfig` (`lib/osint/landerConfig.ts`) czyta z `visit.fields` opcjonalne pola `LanderConfig`: `cloaker` (`{ sid, domain, did }` z `cl_sid`, `cl_domain` małymi literami, `cl_did`), `launcherId` (`fields.launcher`, w drugiej kolejności `visit.launcher`, tylko UUID) i `fbCampaignNameId` (16 cyfr w `fields.fb_campaign_name`). Redakcja (`redactPageHtml`) zostawia w `visit.fields` tylko klucze z `VISIT_FIELDS_KEEP_KEYS` (`launcher`, `cl_sid`, `cl_domain`, `cl_did`, `fb_campaign_name`); wcześniej całe `fields` było redagowane i te pola nie docierały do grafu. W `link.ts` (`addVisitFields`): węzeł `cloaker_account` z kluczem `cl_domain/cl_sid` tylko przy obu wartościach; `data.cloaker` i `cloakerInSource` materiału zawsze. Launcher równy `ownerId` → tylko `data.launcher` i `launcherSameAsOwner` (bez węzła, żeby nie liczyć tego samego dowodu dwa razy); bez `ownerId` → `platform_account` (źródło `launcher`); inny → węzeł `launcher_account`. `fbCampaignNameId` → `campaign_param` `fb_campaign_name_id=<id>`. Paczka dowodów: `platform_visit_fields` przy reklamie (host cloakera rozbrojony). Testy: `lib/graph/visitFieldsLink.test.ts`.
**Rejestry firm za flagą `--company-registry`** (22.11.2026, B-324 i krok 6 z I24; `lib/osint/companyRegistry.ts`). Domyślnie wyłączona, tylko `live`, w `enrich` i `pipeline`. Dla poprawnych (z sumą kontrolną) NIP i numerów KRS ze strony pyta białą listę VAT (`wl-api.mf.gov.pl/api/search/nip/{nip}`, bez klucza, limit 100 zapytań dziennie, więc cache `company-registry` na dobę) i odpis aktualny KRS (`api-krs.ms.gov.pl/api/krs/OdpisAktualny/{krs}?rejestr=P`); najwyżej 2 numery każdego rodzaju na materiał. Zapisuje tylko dane firmy (nazwa, adres siedziby, status, data wpisu i wykreślenia); reprezentacja, wspólnicy i inne dane osób są odrzucane przez parsery. Wynik: `perItem.companyRegistry`, w grafie atrybut `companyRegistry` (`records`, `flags`, `details`) z flagami `companyNameMismatch`, `companyAddressMismatch`, `companyRemoved`, `companyRecent` (wpis < 180 dni przed `firstSeen`), `companyYoungerThanDomain` (firma zarejestrowana > 30 dni po domenie), `domainYoungerThanCompany` (firma ≥ 5 lat, domena ≤ 90 dni). Flagi nie mają wagi i nie tworzą śladu. CEIDG pominięte (wymaga konta i tokenu; możliwość na później). **Nie uruchamiać na materiałach ze spraw bez zgody właściciela danych**: numery z materiałów trafiają do usługi zewnętrznej. Polecenie do ręcznego uruchomienia: `bun run enrich -- --live --company-registry` (albo `bun run pipeline -- --live --company-registry`). Testy tylko na nagranych, syntetycznych odpowiedziach (`companyRegistry.test.ts`, `enrich.test.ts`, `companyRegistryAttr.test.ts`).

### 4.21 Sygnały z praktyki śledczej (22.11.2026, zadanie I28)

Podcasty śledcze (OSINT Podcast, Fraud Forward) opisują lejek „pomocy technicznej”, ClickFix, udostępnione dokumenty i czaty. Prawie wszystko to atrybuty materiału; ślady łączące są tylko trzy (§4.1). Opis metody: `docs/METODYKA.md` §4d.

**Nowe ślady** (`lib/osint/contactIds.ts`, listy w `lib/osint/contactConfig.ts`): `findContactIds(tekst)` zwraca `{ sharedDocs, onion, onionV2, messengers }`. Źródła: `PageExtract` (tekst widoczny i atrybuty), `TextExtract` (tekst reklamy i OCR), `PageKit.requestContacts` (adresy żądań z HAR). W `link.ts` (`addContacts`) idą do węzłów `shared_doc`, `onion`, `messenger_invite` z wagą 0,9 jak `telegram`; IDF i `maxPivotDf` bez zmian. Identyfikatory przykładowe z dokumentacji i serwery społeczności platform są pomijane. `onionV2` trafia do danych materiału (`onionV2`), nie do grafu.

**Konto w sieci afiliacyjnej (B-330).** `lib/osint/affiliateIds.ts`: `affiliateIdsFromHtml(html, pageUrl)` (ukryte pola każdego formularza w zakresie hosta akcji, linki `<a href>` i akcje formularzy; zapis w `PageKit.affiliateIds`) i `affiliateIdsFromUrls(urls)` (adres reklamy, przekierowania, adres końcowy, linki wychodzące; parametr `referer` dekodowany z base64 do 2 poziomów). Rodzaje: `team_user` (`42/13`), `stream`, `offer_uuid`, `api_key` (tylko SHA-256; w `link.ts` idzie do węzła `crm_key`, bez podwójnego liczenia z kluczem z formularza). `stream_id` powiązany przez `affiliate_account` nie tworzy już globalnego `campaign_param` `flow_id`. `maskUrl` zamienia wartość `api_key=` na skrót. Paczka: `ads[].affiliate_accounts`.

**Nowe techniki strony** (`lib/osint/pageTechniques.ts`, słowniki w `lib/osint/techniqueConfig.ts`), dopisane do `techniques[]` (węzeł `technique`, 0,2, `familyOnlyKinds`): `fake_security_alert`, `remote_access_tool`, `clickfix_paste`. `detectPageTechniques` zwraca też `clickfix: { kind, sha256 } | null` (polecenie nigdy nie jest zapisywane; `PageKit.clickfix`, dane materiału `clickfix`). W kodzie nie ma atrybutu roli strony w lejku (`funnel_role`), więc „telefon zamiast formularza” jest tylko techniką.

**Pola materiału** (dane węzła `item`, `FEATURE_KEYS` w `analyzeMaterial.ts`): `displayedDomainMismatch { displayed, landing, source: "ocr" | "text", confidence }` i `displayedBrandDomain` (`lib/text/displayedDomain.ts`, lista marek `TEXT_CONFIG.displayedDomain`); `phoneLines [{ phone, lineType, country }]`, `phoneCountryMismatch`, `tollFreeOnAlert` (`lib/osint/phoneLine.ts`, rynek domyślny `PHONE_CONFIG.defaultMarket` = PL); `onionV2`; `clickfix`.

**P2 (B-357), atrybuty bez wagi:** `idnConfusable` (`lib/osint/idnConfusable.ts`, `hostConfig.ts`: znak podobny do `/`, `.`, `-` albo etykieta mieszająca łacinkę z cyrylicą lub greką; pozycja znaku i wersja „jak wygląda”; źródła: adres wejściowy, łańcuch przekierowań, pasek przeglądarki z OCR, linki strony); `adStartWeekday` (`lib/text/adStart.ts`: dzień tygodnia i godzina UTC z daty pierwszej emisji w bibliotece reklam) i `adStartWeekdays` kampanii (siedem liczb od poniedziałku, `cluster.ts`); `discordSnowflakes` (`discordSnowflakes` w `contactIds.ts`: data utworzenia serwera, kanału lub konta z 17–20 cyfr w linkach `discord.com/channels` i `discord.com/users`).

**Narracje** (`lib/text/narrative.ts`, ten sam słownik): tematy `tech_support`, `refund_overpayment`, `recovery_offer`, `job_offer`, `fake_authority`; haczyki `secrecy`, `withdrawal_fee`, `urgency_lock`. Polskie etykiety w `NARRATIVE_LABEL` (`lib/viewer/plain.ts`).

**GUI i paczka.** `plain.ts`: `TYPE_INFO` dla nowych rodzajów, `TECHNIQUE_INFO`, `FEATURE_INFO` z polem `format` (cechy-obiekty: pokazany jest tylko rodzaj i skrót polecenia ClickFix, dwie domeny rozbrojone, typ numeru). Paczka (`lib/evidence/pack.ts`): `ads[].page_techniques` (z miejscem odczytu), `clickfix_command` (rodzaj i SHA-256), `displayed_domain_mismatch` (domeny rozbrojone), `phone_lines`, `phone_flags` i sekcja „Sygnały materiałów” w raporcie.

**Zależność:** `libphonenumber-js` (MIT, metadane `libphonenumber-js/max`, działa bez sieci); `LICENCJE.md` odświeżone poleceniem `bun run licenses -- --write LICENCJE.md`.
### 4.22 Rodzaj płatnika i identyfikatory firm (22.11.2026, zadanie I24)

**Rodzaj płatnika** (`lib/osint/payerKind.ts`). Płatnik i beneficjent z biblioteki reklam (DSA art. 26 i 39) to samodeklaracja: reklamodawca wpisuje je sam, platforma ich nie weryfikuje. `classifyPayer(nazwa, {pageName, polishAd})` zwraca `{kind, reasons}`; rodzaje w kolejności sprawdzania: `placeholder` (≤ 3 znaki albo słowo ze słownika), `gibberish` (jedno słowo: sekwencja 5 klawiszy z jednego rzędu, litery wymieszane z cyframi, brak samogłosek, wysoka entropia przy małym udziale samogłosek), `person_foreign_script` (2–4 słowa imienia i nazwiska w innym alfabecie albo z pisownią wietnamską, tylko na reklamie po polsku), `person`, `generic_corp`, `matches_page`, `registered_form`, `other`. Imię i nazwisko w obcym alfabecie na reklamie nie po polsku to `person` (specyfikacja tego nie rozstrzyga). Reklama po polsku: region PL/Polska/Poland w rekordzie albo co najmniej 2 polskie litery w tekście (`isPolishAd`).

Atrybuty materiału (`itemData`, widoczne w GUI jako cechy i w paczce): `payerKinds`, `payerEqualsBeneficiary` (prawda tylko gdy oba są podane i równe), `payerSuspicious` (`placeholder`, `gibberish` albo `person_foreign_script`). Węzeł `ad_payer` ma `payerKind`, `payerKindReasons` i dla `person` `payerNote` (dopisek o możliwej kradzieży tożsamości). **Reguła pivota:** płatnik `placeholder` nie tworzy węzła `ad_payer` ani krawędzi `paid_by` (w obu miejscach `link.ts`: rekord biblioteki i `--ad-library`), bo tę samą zaślepkę wpisują niezwiązani reklamodawcy; rodzaj zostaje w atrybutach materiału. Pozostałe rodzaje bez zmian (`ad_payer` 0,65, `notAloneKinds`).

**Identyfikatory firm** (`lib/text/companyIds.ts`). Numer czytamy przy etykiecie w odległości do `labelGap` (16) znaków; bez etykiety tylko IBAN z poprawną sumą (z etykietą także błędny, jako `valid: false`). Sumy: NIP (wagi 6,5,7,2,3,4,5,6,7, mod 11, reszta 10 = błędny), REGON 9 i 14 cyfr (wagi 8,9,2,3,4,5,6,7 oraz 2,4,8,5,0,9,7,3,6,1,2,4,8; reszta 10 → 0), IBAN i NRB mod 97 z długością kraju, LEI mod 97. KRS, VAT poza Polską i numer UK tylko po formacie (`check: "format"`); VAT i numer UK wymagają etykiety. VAT z prefiksem PL zapisujemy jako `nip`. Źródła: `text` (widoczny tekst), `html` (to, czego tekst nie zawiera: ukryte elementy, komentarze), `jsonld` (`vatID`, `taxID`, `leiCode`, `identifier` jako PropertyValue, `legalName`), `ocr`; ten sam numer raz, pierwszeństwo w tej kolejności. Blok JSON-LD, który nie jest JSON, jest pominięty z powodem w `companyIdNotes`. `extractFromHtml` zapisuje wynik w `PageExtract` (`companyIds`, `legalEntities`, `companyIdNotes`, pola opcjonalne dla starszych plików), OCR dokłada `companyIdsOfMaterial` w `link.ts` i w paczce.

Graf: `company_id` (waga 0,5) i `bank_account` (0,8), oba w `campaignRules.notAloneKinds`. Rachunek waży 0,8 ≥ `strongThreshold`, a silny link omija `notAloneKinds` (`campaignLinkVerdict`, ta sama przyczyna co w §4.12 dla `ad_payer`), więc dodano `nonStrongTypes: ["bank_account"]` (`pivotWeight`: `strong = false`); waga i IDF działają jak dla innych śladów, `maxPivotDf` też. Lista wyłączeń `lists.companyIdIntermediaries` (czynnik 0, klucz węzła, np. `nip:7792308495`): operatorzy płatności i kurierzy, którzy stoją w stopkach wielu sklepów; ziarno z czterema numerami z publicznych rejestrów, sprawdzonymi sumą kontrolną, do uzupełnienia i weryfikacji w KRS przez właściciela danych. Zmyślony NIP z błędną sumą też tworzy węzeł (wspólny zmyślony numer to wspólny szablon), atrybut `companyIdInvalid`.

Paczka dowodów: przy reklamie `payer_kinds`, `payer_equals_beneficiary`, `payer_suspicious`, `payer_notes`, `company_identifiers` (z `checksum_valid`, `check`, `source`, `quote`) i `legal_entities`; `evidence.md` ma sekcję „Płatnik i dane firmy (wskazówki)”.

**Regresja.** Próbka syntetyczna: bez zmian (P = R = F1 = 1, 10 kampanii). 25 spraw bez `--ad-library`: F1 par 0,885, 14 kampanii, 2 grupy, przypisania identyczne jak przed zmianą; trafień identyfikatorów firm 0 (nazwy podmiotów z formą prawną znaleziono na 4 stronach z 22), płatnika w tym przebiegu nie ma (wymaga `--ad-library`).

### 4.23 Sygnały sklepu i adres jako ślad (22.11.2026, zadanie I26)

**Sygnały sklepu** (`lib/osint/shopSignals.ts`, słowniki i progi w `lib/osint/shopSignalsConfig.ts`): `extractShopSignals({ html, url, firstSeen, archiveFirstSeen, legalEntities })` zwraca `ShopSignals` albo `null`, gdy strona nie wygląda na sklep (brak `Product`/`Offer` w JSON-LD i brak ceny razem ze słowem koszyka). Wynik leży w `PageExtract.shopSignals` (ustawia `extractFromHtml`), a w grafie w `data.shopSignals` węzła materiału (`link.ts` dopisuje daty przez `applyShopContext`: rok w stopce względem `firstSeen`, staż względem migawki archiwum). Pola: `legalPages` i `legalPagesMissing`; `discounts` (`pricedItems`, `discountedShare`, `medianDiscountPct`, `maxDiscountPct`) i `sitewideDeepDiscount` (≥ 5 produktów, ≥ 70% z rabatem ≥ 50%); `omnibusMissing`; `techniques` (`recent_purchase_popup`, `low_stock_claim`, `countdown_timer`, `closing_down_story`, `crypto_discount`; dopisywane też do `techniques` materiału, ale bez węzłów `technique`: bez wagi); `paymentMethods`, `transferOnly`, `irreversibleOnly`, `paymentRecipientPerson`; `deliveryDays` i `deliveryWide`; `reviews` (`count`, `ratingDistribution`, `share5`, `windowDays`, `anonymousShare`, `source`) z flagami `reviewsAllPerfect`, `reviewsNarrowWindow`, `reviewsNone`; `footerBrand`, `footerBrandMismatch`, `footerYear`, `footerYearStale`; `claimedSince` i `claimedSinceContradicted`; `flags` (flagi, które zachodzą) i `details` (zdanie z liczbą albo cytatem na flagę). Żadna flaga nie ma wagi. Bez daty pierwszej migawki archiwum (zapis jej dziś nie niesie) `claimedSinceContradicted` jest zawsze fałszem.

**Kontakt** (`lib/osint/contact.ts`, `PageExtract.contact`): `emailDomains` (`free_mail`, `site`, `other_domain` na adres; lista darmowych dostawców w `DEFAULT_CONTACT_CONFIG`), `otherEmailDomains`, `address` (`completeness`: `full`, `city_only`, `po_box`, `none`; adresy pełne z kluczem) i `phoneAreaMismatch` (polski numer stacjonarny z kierunkowym innym niż miasto adresu; tabela kierunkowych w konfiguracji, miasto spoza tabeli nie daje werdyktu). W grafie atrybuty materiału: `emailDomainKinds`, `addressCompleteness`, `phoneAreaMismatch`. Domena adresu na innej domenie niż sklep dostaje węzeł `domain` i krawędź `links_to` z wagą `outboundLinkFactor` (jak domeny linkowane ze strony); enrichment dopisuje tę domenę do listy domen (`enrichItems`, MX/NS/TXT, RDAP, wiek), tylko gdy nie jest darmową skrzynką ani domeną sklepu.

**Adres** (`lib/text/postalAddress.ts`): `extractPostalAddresses({ text, jsonLd })` czyta polskie adresy w obu kolejnościach („ul. Przykładowa 1/2, 00-001 Miasto” i „00-001 Miasto, ul. Przykładowa 1”), niemieckie z członem „straße”/„gasse”, czeskie i słowackie z „ulice”/„nám.” oraz JSON-LD `PostalAddress`. `addressKey` zdejmuje rodzaj ulicy („ul.”, „ulica”, „al.”), polskie znaki, wielkość liter i myślnik w kodzie; numer lokalu nie wchodzi do klucza. Węzeł `postal_address` (waga 0,5, `campaignRules.notAloneKinds`, IDF i `maxPivotDf` jak inne ślady) powstaje tylko dla adresu pełnego. Wykluczenia: `lists.postalAddressExclusions` (czynnik 0, klucz węzła; w repozytorium tylko fikcyjny przykład).

**Infrastruktura i drobne atrybuty** (bez wag; wszystkie w `data` węzła materiału i w `features`): `lib/osint/tlsSignals.ts` (`tlsSignals`: `certIssuer`, `certMismatch`, `certExpired`; dane z `_securityDetails` wpisu HAR: `caseImport` zapisuje je w fixtures jako `tls`, `sources.tlsFor`, `PageInfo.tls`; bez tych pól nic się nie zmienia), `lib/osint/infraSignals.ts` (`brandInPath`, `detectCms` → dopisywane do `pagePlatforms`, `hostingOutsideEu` z `IpInfo.country`; listy marek, platform i krajów UE/EOG w `DEFAULT_INFRA_CONFIG`), `lib/osint/siteAttributes.ts` (`PageExtract.siteAttributes`: `tldRare`, `domainLangMismatch`, `privacyControllerMismatch`, `fakeCourierPayment` → technika `fake_courier_payment`), `RdapInfo.registrantHidden`, `DomainInfo.contactDomainDead` (`enrichItems`, tylko `mode: "live"`: jedno GET strony głównej domeny adresu kontaktowego, gdy ma MX), w `ShopSignals` także `catalogIncoherent`, `catalogCategories`, `reviewsNoSellerReply` oraz techniki `waitlist_upsell`, `trial_subscription`, `blik_via_messenger`. Reguła podrabianej marki z tytułu (`impersonatedBrand`) nie czyta ścieżki: `brandInPath` jest osobnym atrybutem.

Paczka dowodów: przy reklamie `shop_signals` (`lib/evidence/shopFacts.ts`: flagi z `detail`, techniki, metody płatności, rabaty, opinie, stopka, domeny e-mail i adres z cytatem) oraz sekcja „Sygnały sklepu (wyjaśnienia)” w `evidence.md`. Karta materiału w GUI ma sekcję „Sklep” (`ShopSection`), wpisy flag w `SHOP_FLAG_INFO` (`lib/viewer/plain.ts`).

### 4.24 Lejek leadów, montaż wideo i konto na hostingu wideo (22.11.2026, B-326 do B-342)

Wszystkie cztery rodzaje śladów (`lead_flow` 0,5; `overlay_template` i `reused_footage` 0,45; `hosting_account` 0,6) są w `campaignRules.notAloneKinds`: wspierają powiązanie, ale kampania potrzebuje drugiego, niezależnego rodzaju dowodu.

**Lejek leadów platformy stron** (B-332, `lib/osint/leadFlow.ts`). Z kodu strony czytamy `visit.form_uuid`, UUID pól formularza, `visit.flow_uuids` (bez własnego `flow_uuid`), `LANDING_ENCRYPTION_KEY_ID` i `LANDING_FORM_EVENT_BACKEND_DOMAIN`; `suuid` z linku showcase dochodzi jako `src:`. Każdy token to węzeł `lead_flow` (waga 0,5, `notAloneKinds`, rodzina „strona”): łączy grupę (sieć, ta sama oferta), nie kampanię; wartości wspólne dla całej platformy zdejmuje maska częstości. Atrybuty (`lib/osint/pageTraits.ts`): `backLib` (B-335), `svgScript` z adresami jako zwykłe węzły `url` (B-334), `spacedText` z sklejeniem liter w tekście OCR (B-337), `asSeenOn` (B-338).
**Montaż wideo (B-326, B-327, B-328, B-329)**: `lib/media/videoShots.ts` dzieli film na ujęcia (`ffmpeg select=gt(scene,0.3)`), liczy dHash klatki środkowej każdego ujęcia (`videoShots` w wzbogaceniu); dwa filmy ze wspólnym ujęciem (Hamming ≤ 6, bez klatek jednolitych) dostają krawędź `similar_image`, także gdy ujęcia są w innej kolejności. `lib/media/videoOverlay.ts` próbkuje klatki co 2 s: pas jednolity (biały lub czarny) albo rozmyty na dole kadru w ≥ 3 klatkach to atrybut `subtitleOverlay` i ślad `overlay_template` (rodzaj, kolor, położenie względem kadru), a tekst w rogu kadru (OCR, ≥ 2 klatki, bez znaków edytorów i platform) to atrybut `sourceWatermark` i ślad `reused_footage`. Oba ślady są w `campaignRules.notAloneKinds` (waga 0.45). Tytuł reklamy z yt-dlp (`title`, kolumna `ad_title`) w bezokoliczniku („Czytać”) trafia do atrybutu `translationArtifacts` (`infinitive_cta`, `lib/text/infinitiveCta.ts`).

**Konto na hostingu wideo** (`hosting_account`, B-342, waga 0,6): biblioteka wideo jednego klienta usługi hostingu wideo (adres hosta wideo z identyfikatorem biblioteki, w kodzie strony albo w żądaniach), klucz `usługa:identyfikator`; węzeł wiąże adres końcowy strony z kontem.

## 5. Klastrowanie

`clusterCampaigns` (`cluster.ts`) działa na **pełnych** powiązaniach, przed przycięciem.

### 5.1 Silne dowody (union-find)

Każde powiązanie `strong` łączy obie reklamy (`clusterCampaigns` w `cluster.ts`), chyba że reguła z §5.4 pkt 3 zatrzyma je przy konflikcie kont (silny dowód samego `path_id`). Dowód jest silny, gdy encja spełnia `waga_typu × czynnik_listy ≥ 0.7` oraz `df ≤ max(2, ⌊0.5·N⌋)`, a obie ścieżki mają relację 1 (§4.3). Przy domyślnych wagach silne mogą być: url, host, domain, tracker, wallet, email, phone, telegram, endpoint z innej domeny, parametr kampanii i cert bez zniżki. Nigdy silne: ip, imagehash (także ten sam plik kreacji `sha256:`, który łączy przez reguły z §5.4), cname_target, advertiser, hidden_fields, comment, domain_pattern, asset, favicon, NS, rejestrator, seria rejestracji, ASN, persona oraz podobieństwo obrazu, tekstu, DOM i dźwięku.

### 5.2 Louvain

- Graf nieskierowany, bez pętli (`cluster.ts`). Krawędź dostaje każde powiązanie z `score ≥ minLinkScore (0.15)` lub silne (`cluster.ts`). Waga to `score`, a dla silnych `max(score, 0.7)` (`cluster.ts`).
- `graphology-communities-louvain.detailed` z `getEdgeWeight: "weight"`, `resolution: 1.0`, `rng: mulberry32(42)`, więc wynik jest deterministyczny (`cluster.ts`, `config.ts`).
- Pusty graf pomija Louvaina; `modularity` jest wtedy `null`.

### 5.3 Kampanie

1. Każda składowa union-find trafia w całości do społeczności Louvaina, w której ma najwięcej członków (`cluster.ts`). Reklamy spoza grafu Louvaina tworzą własną grupę (`S<korzeń>`, `cluster.ts`).
2. Grupy są sortowane: rozmiar malejąco, `firstSeen` rosnąco, pierwszy członek (`cluster.ts`). Id to `K` + numer co najmniej dwucyfrowy (`cluster.ts`).
3. Atrybuty:
   - `firstSeen` = najmniejsza data, `lastSeen` = największa z `lastSeen ?? firstSeen` (porównanie ciągów ISO);
   - `cohesion` = średni `score` powiązań wewnętrznych (`cluster.ts`);
   - `strongComponents` = liczba składowych union-find (`cluster.ts`);
   - `domains` = eTLD+1 linków docelowych członków oraz domeny-pivoty z powiązań wewnętrznych;
   - `advertisers` z krawędzi `posted_by`;
   - `topEvidence` (`cluster.ts`): ≤ 6 pozycji, ranking `pokrycie × waga`, gdzie pokrycie to `członkowie z pivotem / rozmiar`, a dla podobieństwa (każdego typu `similar_*`, etykiety w `cluster.ts`) `min(1, pary / rozmiar)`; host apex o tych samych członkach co jego domena jest pomijany (`cluster.ts`);
   - `attributes` (`campaignAttributes`, `cluster.ts`): persony z liczbą reklam, liczba reklam z cyrylicą i z podejrzeniem cloakingu, najwyższy wynik deepfake.
4. Reklama bez żadnych powiązań staje się kampanią 1-elementową i też ma przydział w `assignments`.

### 5.4 Reguły kampanii i grupy podobnych kampanii (od 21.11.2026)

Opis zadania mówi o grupowaniu „w kampanie lub grupy podobnych kampanii”, więc wynik ma dwa poziomy. `campaignLinkVerdict` (`cluster.ts`) decyduje, które powiązania wchodzą do grafu Louvaina:

1. Silne powiązanie wchodzi (wyjątek w pkt 3).
2. Powiązanie poniżej `minLinkScore` nie wchodzi.
3. **Różne konta tej samej platformy stron** (`platformAccount` obu reklam, `campaignRules.accountConflict`) nie łączą się bez silnego dowodu. Wspólny zestaw stron u różnych kont to kampanie podobne, a nie jedna kampania. Od zadania i14c konflikt wygrywa też z silnym powiązaniem, którego wszystkie silne dowody są rodzaju z `campaignRules.accountConflictOverStrongKinds` (domyślnie `path_id`): UUID w ścieżkach zasobów może być landerem z biblioteki, którą platforma udostępnia wielu kontom, a nie kontem. Takie powiązanie nie łączy też w union-find (§5.1), a kampanie trafiają do jednej grupy podobnych z powodem „różne konta”.
4. Liczą się dowody niezdyskontowane, a zdyskontowane tylko z wagą po zniżce ≥ `campaignRules.discountedMinWeight` (0.3). **Ślady zestawu stron nie sumują się w kampanię** (od zadania i14c). Rodzaje z `notAloneKinds` (`similar_dom`, `comment`, `asset`, `hidden_fields`, `page_template`, `favicon`, `endpoint`, `param_schema`, `comment_block`) opisują zestaw stron: szablon, motyw platformy sklepowej, klon portalu. Taki zestaw kupuje się i używa u wielu różnych operatorów. Od zadania i14fix w tej liście jest też płatnik z biblioteki reklam (`ad_payer`): konta reklamowe bywają wynajmowane albo przejęte (§4.12). Dlatego kampania potrzebuje co najmniej jednego rodzaju dowodu spoza zestawu stron, persony i treści (np. konto platformy, serwer trackera, NS, kontakt). Ślady zestawu liczą się razem jako jeden rodzaj, nie łączą same, między sobą ani z treścią, i nie mają już furtki wyniku pojedynczego rodzaju (dawny `singleKindMinScore` 0,5 usunięty). Para z samymi takimi śladami dostaje werdykt `single_kind`, czyli najwyżej grupę podobnych kampanii. Z dowodem operatora wystarczą dowody `minEvidenceKinds` (2) rodzajów (zestaw stron i treść liczą się wtedy po jednym rodzaju) albo sam ten jeden rodzaj.
5. **Treść z infrastrukturą i bez niej** (od zadania i14). Rodzaje treści (`campaignRules.contentKinds`): `similar_text`, `similar_image`, `similar_image_semantic`, `similar_audio`, `similar_voice` oraz `imagehash` (identyczny dHash to podobny obraz z odległością 0). Ślady infrastruktury (`campaignRules.infrastructureKinds`): `url`, `host`, `domain`, `ip`, `nameserver`, `cert`, `cname_target`, `endpoint`, `platform_account`, `platform_campaign`, `click_server`, `meta_ad`, `campaign_param` (w tym identyfikator Biblioteki Reklam), `path_id`, `tracker`. Reklama ma infrastrukturę, gdy ma taki pivot z `waga_typu × czynnik_listy × relacja ≥ infrastructureMinWeight` (0,3; np. link do dużej platformy z czynnikiem 0 się nie liczy). Lista typów jest w danych reklamy (`data.infrastructure`). Reguły, w kolejności:
   - konflikt kont (pkt 3) wygrywa ze wszystkim, co nie jest silne, także z treścią i z tym samym plikiem kreacji;
   - **ten sam plik kreacji** łączy sam: identyczny SHA-256 obrazu albo wideo (`creative_sha256`, §4.12) albo klatki wideo z podobieństwem CLIP ≥ `campaignRules.sameCreative.clipMinCosine` (0,97) razem z tym samym odciskiem audio (`similar_audio`); podobieństwo jest zapisane w przesłance (`PairEvidence.similarity`);
   - powiązanie z samej treści między dwiema reklamami **bez infrastruktury** łączy, gdy ma co najmniej `minContentKinds` (2) różne rodzaje treści (np. ten sam dźwięk i te same klatki, obraz i tekst);
   - gdy **którakolwiek** reklama ma infrastrukturę, treść sama nie łączy; razem z dowodem operatora (pkt 4) liczy się jako jeden rodzaj „treść”, a ze śladami zestawu stron nie łączy wcale (np. dwa klony portalu z podobnym DOM i identycznym tekstem, ale własną infrastrukturą, to najwyżej grupa). `campaignRules.contentKindsWithInfrastructure` (domyślnie `null`) pozwala przywrócić łączenie samej treścią także wtedy, np. `2` = obraz i tekst wystarczą (§4.13).
6. **Persona** jest w `familyOnlyKinds` (razem z technikami strony): nie liczy się do wyniku kampanii ani do rodzajów dowodów, liczy się tylko do grupy podobnych kampanii.
7. **Wariant kreacji: dołączanie, nigdy scalanie** (od zadania i14b, `attachContentVariants` w `cluster.ts`, `campaignRules.contentVariant`). Wymaganie: rozpoznawać warianty tej samej kampanii (ten sam przekaz po drobnej zmianie kreacji) i odróżniać je od nowych kampanii podobnych do znanych. Zrzut kreacji z naklejką albo przycięty, bez linku i adresu, nie ma infrastruktury, więc nie ma czym zaprzeczyć przypisaniu, a pkt 5 nie pozwala mu dołączyć do oryginału z infrastrukturą. Dlatego po zbudowaniu kampanii (union-find, Louvain) jest osobny krok: kampania, w której żaden członek nie ma infrastruktury i której członków połączyła tylko treść (zwykle jeden materiał), dołącza do kampanii z infrastrukturą, gdy wszystkie jej powiązania typu „wariant” wskazują materiały **dokładnie jednej** takiej kampanii. Wariant to prawie identyczna kreacja (obraz albo wideo): ten sam dHash (`imagehash`) albo plik (`creative_sha256`), `similar_image` z odległością Hamminga ≤ `contentVariant.imageHamming` (6) albo `similar_image_semantic` z cosinusem CLIP ≥ `contentVariant.clipMinCosine` (0,95). Progi leżą między duplikatem (≤ 4 bity, §5.5) a zwykłym podobnym obrazem (≤ 10). W próbce naklejki zmieniają 2–5 bitów, kadry 5–6, a różne kreacje różnią się o ≥ 16. CLIP: szablon od 0,9, ten sam plik wideo od 0,97 razem z dźwiękiem. Zasady:
   - **nie scala**: cele liczy się na kampaniach sprzed dołączania, a kampania bez infrastruktury nigdy nie jest celem. Wariant nie może więc połączyć dwóch kampanii, także pośrednio. Gdy kreacja jest bliska kreacjom dwóch lub więcej kampanii, nic nie dołącza i zostaje grupa podobnych kampanii. Szablony kreacji krążą między operatorami, więc treść nigdy nie rozstrzyga między kampaniami i nigdy ich nie scala;
   - sam podobny tekst nigdy nie dołącza (szablony tekstów krążą między operatorami);
   - materiał z własną infrastrukturą zachowuje reguły z pkt 1–6: wariant na innej domenie łączy się przez wspólną infrastrukturę (tracker, konto, serwer), a nie przez treść; konflikt kont wygrywa jak dotąd; persona dalej łączy tylko grupę;
   - między dwoma materiałami bez infrastruktury zostaje reguła dwóch rodzajów treści (pkt 5);
   - działa tak samo w przebiegu (między sprawami) i w analizie nowego materiału (§8.2).
   Kampania ma wtedy `variants: [{ id, like, evidence, weight }]` (`Campaign.variants`: dołączony członek, najbliższy materiał kampanii, przesłanka i jej waga), a jej `basis` to `"mixed"`.

`campaigns.json` ma w `attributes.basis` (`CampaignAttributes.basis`) to, na czym stoi kampania: `"content"`, gdy każde powiązanie, które połączyło jej członków (werdykt `campaign`), stoi wyłącznie na treści (rodzaje z `contentKinds` i `creative_sha256`), a dla kampanii jednoelementowej, gdy reklama nie ma infrastruktury; `"infrastructure"`, gdy żadne takie powiązanie nie stoi na samej treści (albo reklama jednoelementowej kampanii ma infrastrukturę); `"mixed"` w pozostałych przypadkach (część członków dołączona samą treścią, także jako wariant kreacji z pkt 7). Przeglądarka powinna pokazać `"content"` jako „kampania z treści, bez infrastruktury”. W `apart` grupy powód „łączy je tylko treść” odróżnia się od „jeden rodzaj dowodu”.

Grupy podobnych kampanii (`families`, identyfikatory `R01…`) to składowe spójne kampanii połączonych powiązaniami, które reguły zatrzymały, o wyniku (z dowodów liczonych jak wyżej) ≥ `familyMinScore` (0.3). Każda grupa ma `topEvidence` z powiązań między kampaniami i `apart`, czyli powód rozdzielenia (różne konta, jeden rodzaj dowodu). Kampania dostaje `familyId`. `campaigns.json` opisuje reguły w `method.rules`.

### 5.5 Duplikaty i „za mało danych” w analizie materiału (`lib/pipeline/materialVerdicts.ts`, od 21.11.2026)

Oba werdykty wylicza `analyzeMaterial` po regułach kampanii, na tym samym grafie.

**Duplikat** to ta sama reklama zebrana ponownie. Nowy rekord porównuje się z rekordami przebiegu i z wcześniejszymi rekordami tej samej paczki. Wystarczy jeden warunek:

1. **ten sam obraz**: dHash (64 bity) różni się o ≤ 4 bity (`DUPLICATE_RULES.dhashMax`) i obrazy przechodzą próbę pikselową: miniatury 64×64 w skali szarości, piksel „różny”, gdy poziom szarości zmienia się o > 40, kopia ma ≤ 0,25% różnych pikseli. Sam dHash nie wystarcza: na próbce kopia JPEG ma odległość 1, ale wariant z naklejką 2, przycięty 4, a kreacja z innym nagłówkiem 3. Próba pikselowa rozdziela je wyraźnie (kopie JPEG i rozjaśnienie: 0%, warianty: od 0,7% do 12%). Gdy któregoś pliku nie da się odczytać, liczy się tylko identyczny dHash (ten sam węzeł `imagehash`). Nie porównuje się zrzutów widoku biblioteki reklam (to głównie interfejs) ani obrazów bez struktury (dHash z ≤ 2 albo ≥ 62 jedynkami);
2. **ten sam identyfikator reklamy**: wspólny `metaAdId` (z fbclid) albo identyfikator biblioteki reklam;
3. **ta sama strona**: ten sam adres po normalizacji (bez parametrów śledzenia, `normalizeUrl`) i identyczny `domSimhash`;
4. **identyczna treść strony** (od zadania i1fix): ten sam SHA-256 treści strony rekordu (`PageInfo.fetch.bodySha256`, czyli zdekodowany HTML z HAR albo zapisanej strony), także gdy strona jest za mała na `domSimhash`. Weto jak w warunku 3, a do tego różna ścieżka adresu: ten sam HTML pod dwoma adresami to lustro landera (cecha kampanii), nie ponowne zebranie;
5. **to samo wideo** (od zadania i1fix, `videoRelation`): ten sam SHA-256 pliku wideo (`videoSha256`) albo średni wektor CLIP klatek z cosinusem ≥ 0,97 (`DUPLICATE_RULES.videoClipMinCosine`, jak `campaignRules.sameCreative`) razem z tym samym dźwiękiem: odcisk Chromaprint ≥ 0,98 (`audioMinSimilarity`) przy przesunięciu ≤ 2 wartości (`audioMaxOffset`) i długości różnej o ≤ 1 s (`audioDurationTolerance`). Próg dźwięku jest ostrzejszy niż krawędź `similar_audio` (0,85), bo nowy 3-sekundowy wstęp w 30-sekundowym klipie daje około 0,95: to samo wideo z innym wstępem jest wariantem, nie duplikatem. Weto jak w warunku 1.

**Podzbiór plików sprawy** (od zadania i1fix, `caseFileDuplicates`): w paczce spraw (`caseDirs`) sprawa, której wszystkie pliki materiału (`isMaterialFile` w `caseImport.ts`: HAR, HTML, MHTML, zrzuty, wideo; notatki, manifesty i katalogi zasobów zapisanych stron się nie liczą) są we wcześniejszej sprawie z tym samym SHA-256, jest jej kopią, nawet gdy tamta ma pliki dodatkowe. Oryginałem może być tylko sprawa wcześniejsza w kolejności rekordów (tej samej, w której `find` porównuje rekordy), więc dwie sprawy nigdy nie wskazują siebie nawzajem; przy kilku wygrywa ta z największą liczbą plików. Rekord kopii wskazuje rekord oryginału z tą samą treścią strony, a bez niej pierwszy rekord sprawy; `reason`: „wszystkie pliki sprawy (N) są w sprawie A z tym samym SHA-256”. Reguła działa tylko w paczce: przebieg nie przechowuje list plików spraw bazy. Rekord, który jest już duplikatem z warunków 1–5, zostaje przy tamtym oryginale.

Weto: para z różnymi identyfikatorami reklamy (oba znane) nie jest duplikatem z warunków 1 i 3; para z różnym hostem lub ścieżką adresu strony (oba znane) nie jest duplikatem z warunku 1; para z obrazami, które na pewno się różnią (oba są, dHash > 4 albo próba pikselowa nie przechodzi), nie jest duplikatem z warunku 3. Ten sam obraz pod innym adresem i dwie różne kreacje na tej samej stronie to dwie reklamy tej samej kampanii, nie kopia. Wyszukiwanie najpierw odsiewa pary tanim filtrem (wspólny identyfikator, ta sama strona albo treść strony, ten sam plik wideo albo klatki CLIP ≥ 0,97, dHash ≤ 4), a próbę pikselową robi tylko dla kandydatów (miniatury w pamięci podręcznej). Gdy pasuje kilka oryginałów, wygrywa ten z największą liczbą warunków, potem rekord przebiegu, potem mniejsza odległość dHash, potem identyfikator. Kopia kopii wskazuje pierwszy oryginał. `reason` łączy spełnione warunki po polsku, np. „identyczny obraz i ten sam adres strony” (adres dopisuje się, gdy pasuje obok innego warunku). Duplikat dostaje kampanię oryginału (`campaign`), a przy oryginale z paczki także jego `similarCampaigns` i `newCampaign`.

**Duplikaty w przebiegu wsadowym** (`markDuplicates` w `lib/pipeline/steps.ts`, wywoływane przez `build-graph` i `pipeline` przed przycięciem grafu): te same warunki w obrębie całego zbioru. Rekordy idą w kolejności pierwszego wyświetlenia (data, potem identyfikator), każdy porównany z wcześniejszymi; kopia dostaje w danych węzła reklamy `duplicateOf: { id, reason }`, gdzie `id` to najwcześniejszy oryginał. Przeglądarka może po tym składać kopie w stosy. Na próbce syntetycznej: `c1_A_jpeg.jpg` (bez linku) jest kopią `c1_A.png`; `c1_A_bright.png` nie (inna ścieżka adresu), `c1_A_v2.png` też nie (ta sama strona, inna kreacja).

**Za mało danych** (`insufficient`), gdy jednocześnie:

- brak adresu i domeny: ani linku z danych, ani adresu z paska przeglądarki, ani URL w treści, ani zapisanej strony;
- brak identyfikatora: kontaktu, portfela, identyfikatora reklamy, konta platformy stron;
- mniej niż 5 słów treści (`MIN_CONTENT_WORDS`) w tekście, OCR i ASR po usunięciu elementów interfejsu (`contentWords` w `lib/text/uiChrome.ts`: etykiety „Sponsorowane”, przyciski wezwania do działania, „Lubię to!”, „Komentarz”, „Udostępnij” i angielskie odpowiedniki, same liczby);
- rekord nie ma powiązania ponad progiem: jest sam w swojej kampanii i nie należy do grupy podobnych kampanii.

Obraz sam nie chroni przed tym werdyktem, ale gdy połączy rekord z kampanią (np. wariant znanej kreacji), werdykt wynika z powiązania. `missing` podpowiada, co dorzucić: link do reklamy albo strony docelowej i zrzut z widocznym paskiem adresu (brak adresu), plik HAR z wizyty na stronie (brak zapisanej strony; od zadania I18 także wtedy, gdy strona jest, a w katalogu sprawy nie ma HAR: sam adres z linku albo z paska przeglądarki nie liczy się jako zapisana strona, `Sufficiency.hasPage` wymaga pobranej treści, a `Sufficiency.hasHar` jest znane tylko dla spraw z katalogu), zrzut ekranu reklamy (brak obrazu i wideo), pełną treść reklamy (mniej niż 5 słów). Reklama z formularzem platformy (od zadania i1fix, `isLeadAd`, wzorce `LEAD_AD_PATTERNS`: „formularz”, „Instant Form”, „Lead form”, „Wyślij”/„Send” bez następującego „wiadomość”/„message”, bo to przycisk Messengera zwykłej reklamy; szukane w tekście, OCR i ASR) dostaje w wyniku `features.leadAd: true`, a bez adresu zamiast linku i HAR prośbę o „identyfikator biblioteki reklam (ID z Biblioteki Reklam) albo link do strony reklamodawcy” i „zrzut formularza reklamy”: taka reklama nie ma strony docelowej do zapisania.

Sprawa złożona wyłącznie z obrazów w formatach, których import nie czyta jako zrzutu (HEIC, HEIF, GIF, AVIF, TIFF, BMP; czytane są PNG, JPEG, WEBP), jest pomijana: w partii dostaje w `steps` (krok `import`, `skipped`) powód z nazwą formatu, a analiza pojedynczej takiej sprawy kończy się błędem z tym samym dopiskiem (od zadania I18, `unreadImageFormats` w `lib/pipeline/caseImport.ts`).

### 5.6 Bliskie pary: `near-misses.json` (`lib/graph/nearMiss.ts`, od 22.11.2026, zadanie i20)

`campaignLinkDecision` (`cluster.ts`) to ta sama decyzja co `campaignLinkVerdict` (który ją opakowuje i zwraca tylko `verdict`), z dopisanym powodem odmowy: `{ verdict, rule }`. `rule` to jeden z identyfikatorów `NearMissRule` (`model.ts`): `below-min-score`, `family-only-kind`, `account-conflict`, `discounted-only`, `kit-only`, `content-only-with-infra`, `too-few-content-kinds`, `too-few-evidence-kinds`; dla powiązania, które reguły przepuściły, a które podział na kampanie rozdzielił: `split-by-clustering` (nadaje go `findNearMisses`). `clusterCampaigns` liczy decyzje raz dla wszystkich powiązań (pełna lista, przed przycięciem grafu do zapisu) i wywołuje czystą funkcję `findNearMisses`; wynik trafia do `ClusterResult.nearMisses`. Decyzje łączenia są te same co przed zadaniem (test: wyłączenie raportu, `nearMiss.maxPairs` 0, daje identyczne `campaigns.json`; porównanie `campaigns.json` z kodu sprzed zmiany na próbce i na 25 sprawach: bez różnic).

Wybór par: powiązanie, którego reklamy nie są w jednej kampanii i nie pochodzą z jednej sprawy (`data.case` węzła reklamy, z `Item.extra.case`), trafia na listę, gdy (a) `score ≥ nearMiss.minScoreRatio × minLinkScore`, (b) ma dowód zdyskontowany, którego typ ma wagę ≥ `strongThreshold`, albo (c) jego kampanie są w jednej grupie podobnych. Lista jest posortowana malejąco po `score` i obcięta do `nearMiss.maxPairs`.

`near-misses.json` (`NearMissesFile`): `version`, `generatedAt`, `minLinkScore`, `minScoreRatio`, `maxPairs`, `total` (pary spełniające warunki, przed obcięciem), `byRule` (to samo według reguły), `pairs[]`. Para (`NearMiss`): `a`, `b` (identyfikatory reklam), `score`, `rule`, `reason` (zdanie po polsku z liczbami), `sharedKinds[]` (rodzaje wszystkich wspólnych śladów, jak w `evidenceKind`), `discounted[{ kind, rule, factor }]` (dyskonta z węzłów wspólnych śladów), `selectedBy[]` (`score`, `discounted-strong`, `family`), `campaignA`, `campaignB`, `familyId`. Ścieżka: `build-graph --near-misses <plik>`, domyślnie `near-misses.json` w katalogu `--campaigns`. Konfiguracja: `nearMiss { minScoreRatio: 0.5, maxPairs: 200 }` w `LinkConfig` (§10.2); `maxPairs` 0 wyłącza listę.

Analiza materiału: `analyzeMaterial` liczy listę bez obcięcia i dla każdego nowego rekordu wybiera (`nearMissesOfMaterial`) po jednej, najsilniejszej parze z każdą znaną kampanią, pomijając kampanię, do której rekord dołączył, i pary z innymi nowymi rekordami: `MaterialItemResult.nearMisses?: Array<{ campaign, other, score, rule, reason, sharedKinds }>`. W CSV kolumna `blisko_bez_polaczenia` (np. `K03: account-conflict; K07: family-only-kind`, kolumna ostatnia). Widok: zakładka „Celowo nie połączone” (`components/viewer/NearMissesView.tsx`, `lib/viewer/nearMissView.ts`, opisy reguł prostym językiem w `NEAR_MISS_RULE_INFO` w `lib/viewer/plain.ts`) i linia „Blisko kampanii X, ale nie dołączony, bo …” w karcie nowego materiału; `loadViewerData` czyta `near-misses.json` (brak pliku: `null`, zakładka mówi, jak go zbudować).

### 5.7 Przycięcie `graph.json` (`lib/graph/prune.ts`)

Zapisywany jest graf przycięty (`steps.ts`):
- dla każdej reklamy zostaje `output.topKPerItem` (12) najsilniejszych powiązań, a plik zawiera sumę tych zbiorów;
- każde z nich ma ≤ `output.maxEvidence` (6) dowodów;
- od zadania i1fix zostają **wszystkie** powiązania między reklamami tej samej kampanii (`campaignId` węzłów reklam), z ≤ `output.campaignMaxEvidence` dowodami (domyślnie `null`, czyli wszystkie): karta kampanii i paczka dowodowa czytają `graph.json`, więc w kampanii większej niż limit znikały przesłanki. Na próbce syntetycznej liczba powiązań się nie zmieniła (154), liczba dowodów wzrosła z 818 do 2045, plik z 787 KB do 1,3 MB; `campaignMaxEvidence: 6` przywraca dawny rozmiar dowodów;
- krawędzie podobieństwa (wszystkie typy `similar_*`) zostają tylko dla zachowanych par (`prune.ts`), krawędzie encji zawsze;
- `stats.edges/links/strongLinks` są przeliczane.

`campaigns.json` (przydziały, `topEvidence`, `cohesion`, `attributes`, `evolution`) powstaje z grafu nieprzyciętego.

---

### 5.8 Korekty analityka (`lib/graph/corrections.ts`, `lib/viewer/correctionsFile.ts`, `app/api/corrections/route.ts`, B-281)

Zamiast ręcznej edycji grafu analityk zapisuje decyzje w `corrections.json` (`CorrectionsFile`: `version: 1`, `mustLink[]`, `cannotLink[]`, `disabledPivots[]`; para ma `a`, `b`, opcjonalnie `note` i `at`, wyłączony ślad ma `pivot`, czyli identyfikator węzła, np. `domain:<host>`, i może być zapisany jako goły napis). `build-graph` czyta plik z `--corrections` (domyślnie `corrections.json` obok `campaigns.json`; brak pliku znaczy brak korekt, uszkodzony plik kończy się błędem z powodem) i przepuszcza klasteryzację przez `clusterWithCorrections` (`steps.ts`).

- `mustLink`: powstaje silne powiązanie (waga 1) z przesłanką `ANALYST_PREMISE` („decyzja analityka”).
- `cannotLink`: bezpośrednie powiązanie pary jest cięte; gdy inne powiązania nadal trzymają ją w jednej kampanii, tną się powiązania między dwiema stronami kampanii (każdy członek dołącza do strony, do której ma najbliżej), aż klasteryzacja je rozdzieli. Rozdzielenie wygrywa z połączeniem.
- `disabledPivots`: węzeł przestaje liczyć się jako dowód (przesłanki z tego węzła są pomijane).

Każde zmienione powiązanie zostaje w `graph.json` z dopiskiem „decyzja analityka: …”, a kampania dotknięta decyzją wymienia ją w `analystNotes` (`CampaignsView`, `DetailsPanel`). API: `GET /api/corrections` zwraca `{ corrections, file }`; `POST` przyjmuje `{ action: "must" | "cannot", a, b, note? }`, `{ action: "disable-pivot", pivot, note? }` albo `{ action: "remove", a?, b?, pivot? }` (cofnięcie decyzji); 400 przy złym ciele albo parze z jednej reklamy, 500 przy błędzie odczytu lub zapisu (zapis przez plik tymczasowy). Przyciski: `CorrectionButtons.tsx`. Decyzja działa dopiero po ponownym `build-graph`. Uzasadnienie dla osoby oceniającej: [METODYKA.md, punkt 9.2](METODYKA.md#92-korekty-analityka-correctionsjson).

## 6. Ewaluacja

`evaluateClustering(predicted, truth)` (`lib/graph/eval.ts`) ocenia tylko reklamy obecne w obu mapach. Oznaczenia: n_ij to liczność przecięcia przewidzianej kampanii i i prawdziwej j, a_i to rozmiary kampanii przewidzianych, b_j prawdziwych, `C(k,2) = k(k−1)/2`.

| Metryka | Wzór | Kod |
|---|---|---|
| Pairwise | `TP = Σ C(n_ij,2)`, `P = TP / Σ C(a_i,2)` (1 gdy brak par), `R = TP / Σ C(b_j,2)` (1 gdy brak par), `F1 = 2PR/(P+R)`; `FP = Σ C(a_i,2) − TP`, `FN = Σ C(b_j,2) − TP` | `eval.ts` |
| B-cubed | `P = (1/n) Σ_x \|C(x)∩L(x)\| / \|C(x)\|`, `R = (1/n) Σ_x \|C(x)∩L(x)\| / \|L(x)\|`, F1 jak wyżej | `eval.ts` |
| ARI (Hubert–Arabie) | `E = Σ C(a_i,2)·Σ C(b_j,2) / C(n,2)`, `M = (Σ C(a_i,2) + Σ C(b_j,2)) / 2`, `ARI = (TP − E)/(M − E)`; 1 gdy mianownik 0 lub n < 2 | `eval.ts` |

Wartości są sprawdzone na przykładzie liczonym ręcznie (`eval.test.ts`). ARI zgadza się ze scikit-learn: 1/6 dla tego przykładu i 0 dla przypadku „wszystko w jednej kampanii”.

**Etykiety.** Kolumnę prawdy mapujesz na pole `label` w `ingest` (np. `"label": "kampania_prawda"`). Trafia do `item.data.label` w `graph.json`, skąd `runEvaluate` ją czyta (`steps.ts`). Reklamy z pustą etykietą **nie są oceniane**. Reklamy spoza kampanii muszą mieć **unikalne** etykiety (np. `N1`, `N2`), bo wspólna etykieta „brak” oznacza jedną dużą kampanię. `bun run evaluate` wypisuje też rozkład: prawdziwa kampania → kampanie przewidziane. Rozbicie jednej prawdziwej kampanii na kilka to FN, a scalenie różnych to FP.

**Partia z własnymi etykietami** (`lib/pipeline/materialEval.ts`, test `materialEval.test.ts`): `bun run evaluate -- --csv <partia.csv> --labels <etykiety.json>` ocenia CSV z `analyze-material`. Rekord trafia do `campaign_id`, a bez niej do `new_campaign_id`, duplikat do grupy rekordu z `duplicate_of`, reszta zostaje sama; „podobne kampanie” nie przypisują. Etykietę dopasowuje kolumna `case`, a potem `material_id`; rekordy bez etykiety są wypisane i pominięte. Wynik: pary, B-cubed, ARI i rozkład prawdziwa kampania → przewidziane.


### 6.1 Wrażliwość wag (`bun run sensitivity`, od 22.11.2026, zadanie i27)

Narzędzie **mierzy i raportuje, nie stroi**: pokazuje, czy wynik zależy od dokładnych liczb. Wagi nie są uczone na etykietach (powód w [METODYKA.md, „Odporność wag”](METODYKA.md#odporność-wag)). Kod: reguły i obliczenia w `lib/graph/sensitivity.ts` (czyste funkcje, test `sensitivity.test.ts`), tabele w `lib/pipeline/sensitivityReport.ts`, przebieg w `lib/pipeline/sensitivity.ts` (graf budowany w procesie tą samą funkcją co `build-graph`, `runBuildGraph`), CLI `scripts/sensitivity.ts`, test end-to-end `tests/sensitivity.offline.test.ts`.

**Które liczby są zaburzane (reguła po nazwach pól, bez listy).** Narzędzie przechodzi po konfiguracji (`LinkConfig`, po scaleniu z `--config`) i zbiera liczby:
- *wagi* (`weightPaths`): każdy wpis `typeWeights.<typ>` większy od 0 i każde pole liczbowe o nazwie `weight` albo kończącej się na `Weight` (np. `similarity.dom.weight`, `creativeFileWeight`, `registrationBurstWeight`), z wyjątkiem pól z `Min` w nazwie (`discountedMinWeight`, `infrastructureMinWeight`: to progi na wadze). Waga dodana do konfiguracji później jest więc objęta bez zmian w narzędziu;
- *progi* (`thresholdPaths`): `strongThreshold`, `minLinkScore` i pola `minCosine`, `clipMinCosine`, `minSimilarity`, `tfidfThreshold`, `embeddingThreshold`, `hamming`, `imageHamming` w dowolnym miejscu konfiguracji. Progi nie są zaburzane losowo, tylko osobno (C).
Listy infrastruktury (`lists.*`) i czynniki list nie są zaburzane.

**Eksperymenty.** Przebieg bazowy, potem:
- (A) dla każdego rozrzutu `s` z `--spread` po `--runs` przebiegów z ziarnami `seed … seed + runs − 1`: każda waga razy czynnik z rozkładu jednostajnego na [1 − s, 1 + s], obcięcie do [0, 1] (`perturbWeights`, generator z ziarnem: te same ziarno i rozrzut dają tę samą konfigurację). Tabela: min / mediana / maks precyzji, czułości i F1 par, B-cubed F1 i ARI; liczba przebiegów z podziałem identycznym z bazowym; maks. liczba par, które zmieniły stan „razem / osobno” (`partitionDistance`); liczba przebiegów z nowym sklejeniem dwóch etykiet prawdy (`newLabelMerges`);
- (B) jedna waga naraz razy każdy czynnik z `--one-at-a-time` (`scalePath`, obcięcie do [0, 1]). Tabela: waga, wartość, ΔF1 par względem bazy, zmienione pary; posortowana po wpływie, wagi bez wpływu w jednym wierszu. Czynnik, który nie zmienia wartości (np. 1,0 × 1,3 po obcięciu), nie jest uruchamiany;
- (C) ta sama tabela dla progów i czynników z `--thresholds` (odległości Hamminga zaokrąglane do całych bitów).

Etykiety prawdy: pole `label` reklam z `enriched.json`, uzupełnione i nadpisane plikiem `--labels` (format jak w `evaluate`). Konfiguracja bazowa jak w `build-graph` (`--config`, inaczej wbudowane wagi). Tabele i `sensitivity.json` powstają w `--out`.

**`sensitivity.json`:** `meta` (`commit`, `date`, `items`, `labeled`, `seconds`, `seed`, `runs`, `spreads`, `factors`, `thresholdFactors`), `base` (metryki bazowe), `random[]` (`spread`, `seed`, `metrics`, `distance`, `newMerges`, `identical`), `oneAtATime[]` i `thresholds[]` (`path`, `factor`, `from`, `to`, `metrics`, `deltaF1`, `distance`, `newMerges`). `metrics`: `precision`, `recall`, `f1` (pary), `bcubedF1`, `ari`, `clusters`. Każdy przebieg ma ziarno, więc można go odtworzyć: `bun run sensitivity -- --dump-config zab.json --spread 0.2 --seed 7` zapisuje pełną zaburzoną konfigurację (do użycia jako `--config` w `build-graph` i `analyze-material`).

**Próbka syntetyczna:**

```bash
bun run pipeline --offline        # data/work/enriched.json
bun run sensitivity -- --enriched data/work/enriched.json --runs 5 --out data/work/sensitivity
```

Pomiar na danych referencyjnych robi skrypt poza repozytorium (`data/wrazliwosc/run.sh`, także partia spoza próbki z zaburzoną konfiguracją); liczby: sekcja „Końcowy pomiar”.

---

## 7. LLM

LLM nie bierze udziału w wagach grafu ani w klastrowaniu. Korzystają z niego `summarize`, `build-graph --text embedding`, `llm:smoke` i opcjonalny NER person w `enrich --ner` (§4.8).

| | Ollama (domyślnie) | Anthropic |
|---|---|---|
| Wybór | `LLM_PROVIDER=ollama` (`lib/llm/index.ts`) | `LLM_PROVIDER=anthropic` |
| Model | `OLLAMA_MODEL`, domyślnie PLLuM `hf.co/mradermacher/PLLuM-12B-instruct-2512-GGUF:Q5_K_M` (`ollama.ts`); Bielik `SpeakLeash/bielik-11b-v3.0-instruct:Q5_K_M` (`ollama.ts`) | `ANTHROPIC_MODEL`, domyślnie `claude-opus-5-5` (`anthropic.ts`) |
| Czat | `POST /api/chat`, `stream:false`, `temperature` 0.2, `num_predict` przy `maxTokens` (`ollama.ts`) | `client.beta.messages.create`, `max_tokens` 16000, `output_config.effort` z `ANTHROPIC_EFFORT` (domyślnie `medium`, `anthropic.ts`) |
| Structured output | `format` = `z.toJSONSchema(schema)` bez `$schema`, schemat dodatkowo w wiadomości systemowej, `temperature` 0, walidacja zod, maks. 2 próby z informacją o błędzie (`ollama.ts`) | `client.beta.messages.parse` z `betaZodOutputFormat(schema)` (`anthropic.ts`); `parsed_output == null` → `LlmError` |
| Fallbacki | brak | `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"` (`anthropic.ts`); `stop_reason: "refusal"` → `LlmError` |
| Timeout | `LLM_TIMEOUT_MS` (domyślnie 180000) przez `AbortSignal.timeout` (`ollama.ts`) | `timeout` klienta = `LLM_TIMEOUT_MS`, `maxRetries: 2` (`anthropic.ts`) |
| Błędy | `LlmError` z podpowiedzią: serwer nie odpowiada, model nie pobrany (`ollama pull …`), timeout (`ollama.ts`) | klasy SDK mapowane na `LlmError` (`anthropic.ts`) |
| Testy | mock `fetch` + **przebieg na żywo** (18.11.2026: czat, structured, embed, `summarize` dla 5 kampanii) | **wyłącznie mock** (SDK z wstrzykniętym `fetch`, `llm.test.ts`); prawdziwego API nie wywołano |

**Embeddingi.** `embed()` zawsze używa Ollamy, bo Anthropic nie ma endpointu embeddingów (`index.ts`). `POST /api/embed`, model `OLLAMA_EMBED_MODEL` (domyślnie `bge-m3`), partie po 32, `truncate:true`, limit 120 s na partię, sprawdzana liczba wektorów (`ollama.ts`). `build-graph --text embedding` liczy wektory raz i zapisuje je w cache (`embed`, 28 dni, klucz `model:sha256(tekst)`). Gdy embeddingi zawiodą, wraca do TF-IDF z ostrzeżeniem (`steps.ts`).

**Pomiar z 18.11.2026 na M4 Max** (pojedynczy przebieg, orientacyjnie):
- PLLuM: czat 0,3 s, structured 1,3 s;
- Bielik: czat 3,0 s (zimny start), structured 1,4 s;
- bge-m3: wymiar 1024, cos(parafraza) = 0,953, cos(inny temat) = 0,362;
- `summarize`: 5 kampanii w 41 s.

**Streszczenia** (`scripts/summarize.ts`) dostają treści reklam w znacznikach `<reklamy>`, a prompt systemowy każe traktować je jako dane, nie polecenia. NER dostaje tekst w znacznikach `<tekst>` z tym samym zastrzeżeniem (`persona.ts`). To ogranicza prompt injection, ale go nie wyklucza.

---

## 8. API

### 8.1 `POST /api/analyze-material` (`app/api/analyze-material/route.ts`, `lib/pipeline/analyzeMaterial.ts`)

Pliki z formularza trafiają do `.cache/uploads/<znacznik>/nowa-<czas>/` (ścieżki względne bez `..`, zip rozpakowany przez `unzip`, pojedynczy katalog najwyższego poziomu spłaszczony). Trasa uruchamia `bun scripts/analyze-material.ts` w osobnym procesie (narzędzia mediów i modele natywne zostają poza paczką serwera, limit 10 min). `analyzeMaterial`:

1. importuje sprawę (`importCases` na katalogu z dowiązaniem tylko do tej sprawy); bez plików tworzy jeden rekord z `url`/`text`;
2. wzbogaca tylko nowe rekordy: strony i obrazy z materiału, a przy `live` pozostałe zapytania pasywne (`hybridSources`: rekordy A/AAAA z HAR mają pierwszeństwo jako stan z chwili zapisu); OCR domyślnie włączony, ASR, odcisk audio i CLIP na życzenie;
3. scala z `enriched.json` przebiegu, buduje jeden graf i stosuje reguły kampanii (§5.4);
4. dla każdego nowego rekordu: kampania z przebiegu, do której trafił (większość członków), albo grupa podobnych kampanii, albo nowa kampania; do tego ≤ 10 powiązań ze znanymi reklamami z regułą (`campaign`, `single_kind`, `account_conflict`, `below`), cechy odczytane z materiału i inne nowe rekordy tej samej kampanii (np. strony jednego lejka).

Adres z paska przeglądarki (`lib/media/addressBar.ts`, `lib/text/addressBar.ts`): górne 14% zrzutu (małe zrzuty powiększone ×2) czytane osobno przez tesseract (`--psm 6`) przed przycięciem OCR do posta; domena musi mieć sufiks z listy publicznej (tldts). Pewność `high`, gdy przed nią stoi odczytana kłódka albo pod nią nazwa przeglądarki w aplikacji (Instagram, Facebook…). Strony platform (facebook.com, instagram.com…) są zapisywane, ale nie stają się adresem strony. Nagranie ekranu w pionie: klatka co 4 s (ffmpeg, maks. 120), kolejne zmiany adresu z czasem w sekundach. Adres strony bierze się z danych wejściowych, potem z tekstu reklamy, potem z paska (`landingSource`). Fragment adresu (`#tickets`) zostaje w `NormalizedUrl.fragment`.

### 8.2 Pola wyniku `analyzeMaterial` dla przeglądarki (od 21.11.2026)

Wszystkie pola z tej listy są opcjonalne: przeglądarka działa także na wyniku bez nich.

- `MaterialLink.evidence[]`: oprócz `evidence`, `weight`, `strong`, `discounted` każda przesłanka ma `kind` (`pivot` albo `similarity`), `pivotType` (typ wspólnego węzła, np. `domain`, `page_template`), `edgeType` (np. `similar_image`, `similar_text`) i `pivot` (identyfikator węzła, np. `domain:przyklad.test`), tak jak `PairEvidence` w `graph.json`. Dzięki temu przeglądarka odróżnia sam szablon strony od mocnego śladu infrastruktury.

- `MaterialInput.caseDirs?: string[]`: paczka spraw. Wszystkie idą przez jeden import (`importCases` na katalogu z dowiązaniami; powtórzona nazwa katalogu dostaje `-2`) i jeden graf, więc nowe materiały porównują się także między sobą. `caseDir` działa jak dotąd (paczka z jedną sprawą). `url` i `text` przy jednej sprawie uzupełniają jej rekordy, przy kilku stają się osobnym rekordem `nowa-reklama`.
- `MaterialItemResult.campaignBasis?: "content_variant"` (od zadania i14b): rekord bez infrastruktury dołączył do kampanii jako wariant prawie identycznej kreacji (§5.4 pkt 7). Werdykt to `known_campaign` z kampanią oryginału, a `verdictText` mówi, że przypisanie opiera się tylko na kreacji i jest mniej pewne, oraz wskazuje najbliższy materiał. Powiązanie, które o tym zdecydowało, ma w `links` `variant: true` (`MaterialLink.variant`) i stoi na początku listy. Jego `rule` to nadal werdykt reguł pary (zwykle `single_kind`). Duplikat dostaje `campaignBasis` tylko od oryginału z tej samej paczki.
- `MaterialItemResult.caseId`: nazwa katalogu sprawy, z której pochodzi rekord (dla samego linku lub tekstu: identyfikator rekordu).
- `MaterialResult.newCampaigns?: Array<{ id, members, evidence }>` i `MaterialItemResult.newCampaign`: kampanie złożone wyłącznie z nowych rekordów (co najmniej dwóch), numerowane `N1`, `N2`… w kolejności rekordów. `evidence` to etykiety `topEvidence` tej kampanii. Pojedynczy nowy rekord bez powiązań nie dostaje numeru (`newCampaign: null`).
- `MaterialVerdict` ma dwa nowe stany: `duplicate` (pole `duplicateOf: { id, reason }`, `campaign` jak u oryginału) i `insufficient` (pole `missing: string[]`). Reguły w §5.5. `missing` dostaje też werdykt `new_campaign` i (od zadania I18) `similar_campaigns`, gdy czegoś brakuje (np. adresu strony albo HAR).

- Wynik partii w CSV (`lib/pipeline/materialCsv.ts`, `--csv` w `analyze-material`; sprawa pominięta przy imporcie dostaje wiersz `insufficient` z powodem w `missing_data`, `skippedCsvRows`). Kolumny w stałej kolejności (ten sam format eksportuje przeglądarka): `material_id, case, verdict, campaign_id, similar_campaigns, new_campaign_id, duplicate_of, confidence, score, top_premise, missing_data, blisko_bez_polaczenia`. Listy w komórce rozdziela `;` (`similar_campaigns`) albo `; ` (`missing_data`, `blisko_bez_polaczenia`: §5.6). `score` i `top_premise` pochodzą z najlepszego powiązania z kampanią rekordu (przy `similar_campaigns` z którąś z podobnych kampanii); u duplikatu `top_premise` to „duplikat <id>: <powód>”. `confidence`: `certain`, gdy to powiązanie ma przesłankę silną albo o wadze ≥ 0,7 (duplikat z kampanią też jest `certain`, bo to ta sama reklama), `likely` przy wyniku powiązania ≥ 0,5, `uncertain` w pozostałych przypadkach, także bez kampanii (`new_campaign`, `insufficient`). Flaga `--json` przyjmuje teraz ścieżkę pliku (dawniej przełącznik wypisujący wynik na stdout; to samo daje `--json -`).

- `MaterialItemResult.fakeComments?: { count, repeatedInOtherItems }`: liczba komentarzy w bloku na stronie i liczba innych rekordów (przebiegu i paczki) z tym samym blokiem (`df` węzła `comment_block` minus 1). `MaterialItemResult.techniques?: string[]` (także w `features.techniques`): techniki strony z §4.11.

- `MaterialInput.datasetFile?: string` (i `datasetMapping?: string`): plik zbioru `.csv`, `.tsv`, `.json` albo `.jsonl`. Każdy wiersz staje się materiałem przez `loadRecordsLenient` i `normalizeRecords` z `lib/pipeline/ingest.ts` (to samo mapowanie kolumn co `bun run ingest`: automatyczne albo z pliku mapowania). Względne ścieżki obrazów, wideo i dodatkowych zrzutów są rozwiązywane względem katalogu pliku; wartość kolumny obrazu, która nie jest adresem http(s), traktowana jest jak ścieżka. `caseId` wiersza to kolumna `case`, a bez niej identyfikator wiersza. Plik zbioru można łączyć ze sprawami (`caseDirs`) w jednym przebiegu. Uszkodzony wiersz JSONL (niepoprawny JSON albo nie obiekt) i element tablicy JSON, który nie jest obiektem, trafiają do `skipped` z powodem („nie udało się odczytać wiersza 2 pliku zgloszenia.jsonl: …”); identyfikator to wartość kolumny id odczytana z tekstu wiersza, a gdy jej nie ma, `<plik>:<nr wiersza>`. Reszta wierszy idzie dalej. Plik, którego nie da się odczytać w całości (także CSV z zepsutym cudzysłowem: od tego miejsca nie da się rozdzielić wierszy), przerywa analizę z komunikatem z nazwą pliku. Partia (`caseDirs` z więcej niż jedną sprawą albo plik zbioru), w której pominięto wszystko, zwraca wynik bez rekordów, ze `skipped` dla każdej sprawy; pojedyncza sprawa kończy się wtedy błędem z powodem.

- `MaterialItemResult.pivots?: Array<{ id, type, label, weight, strong, discounted, discountReasons, df, sharedWith, data }>`: cechy rekordu, czyli pivoty z `buildEvidenceGraph(..., { includeItemPivots: true })`, posortowane: silne, potem waga. `weight`, `strong` i rabaty pochodzą z węzła grafu scalonego (przebieg + paczka); `strong` i `discounted` uwzględniają też relację pośrednią (np. link wychodzący ×0,5, opisany w `discountReasons`). `df` i `sharedWith` liczone są tylko względem bazy: ile rekordów przebiegu ma tę cechę i które to są (`sharedWith` do 100 identyfikatorów, `df` pełna liczba). `data` to dane węzła bez `weightParts`; dla domen zawiera `created` (data rejestracji z RDAP).

- `MaterialContext.onProgress?: (e: { caseId, step, status, detail? }) => void`: postęp na sprawę. Kroki: `import`, `ocr`, `address_bar`, `asr`, `audio`, `clip`, `lookups`, `features` (budowa grafu), `compare` (reguły kampanii), `group` (kampanie nowych rekordów, duplikaty, „za mało danych”). Import zgłasza `start` przed `importCases` i `done` (liczba rekordów; z dopiskiem „pominięte: …”, gdy importer pominął któryś plik sprawy) albo `skipped` (powód z importera, np. plik, którego nie da się odczytać) po nim. `error` przy imporcie oznacza błąd całej partii („import partii przerwany …”); błąd jednej sprawy jest `skipped` tylko przy niej. Kroki mediów i zapytań zgłaszają `start` przed wzbogacaniem całej paczki, a wynik po nim, na podstawie tego, co wzbogacanie dało: `skipped` z powodem („OCR wyłączony”, „brak obrazu”, „brak wideo”, niedostępne narzędzie), `error` z komunikatem, `done` (ze szczegółem, gdy krok niczego nie znalazł, np. „brak paska adresu na zrzutach”). Krok `lookups` (RDAP i DNS domen, do których prowadzą adresy materiału) ma status z tego, co odpowiedziało (`lookupsOutcome` w `lib/pipeline/lookupFailures.ts`): bez `--live` albo przy `ANALYZE_OFFLINE=1` (domyślnie w kontenerze) `skipped` z powodem, który to mówi, a nie awaria; bez domeny `skipped` („brak domeny do sprawdzenia…”); `done` ze szczegółem „RDAP i DNS odpowiedziały dla 5 z 5 domen” albo z liczbą nieudanych („RDAP nie odpowiedział dla 2 z 5 domen: a.example, b.example”); `error` tylko wtedy, gdy ani RDAP, ani DNS nie odpowiedziały dla żadnej domeny (brak sieci). `features`, `compare` i `group` zgłaszają `start` i `done` dla każdej sprawy (`group` z listą werdyktów). Sprawa bez rekordów po imporcie nie dostaje dalszych zdarzeń. Wyjątek w słuchaczu nie przerywa analizy.
- Od zadania i1fix: duplikaty po treści strony, wideo i podzbiorze plików sprawy (§5.5, nowe `reason`: „identyczna treść strony (SHA-256)”, „ten sam plik wideo (SHA-256)”, „to samo wideo (klatki CLIP …, ten sam odcisk audio)”, „wszystkie pliki sprawy (N) są w sprawie A z tym samym SHA-256”); `features.leadAd?: true` przy reklamie z formularzem platformy; `confidence` w CSV dla `campaignBasis: "content_variant"` (także duplikatu takiego rekordu) najwyżej `likely`, bo przypisanie opiera się tylko na kreacji.
- Zapytania RDAP i DNS bez odpowiedzi (z `--live`): każdy rekord dostaje w `errors` wiersz z powodem po polsku („RDAP nie odpowiedział dla a.example: brak połączenia z siecią”, „DNS nie odpowiedział dla www.a.example: A, AAAA: brak odpowiedzi w limicie czasu”) dla domen i hostów swoich adresów (strona, przekierowania, adresy w treści i na pasku adresu, domeny adresów kontaktowych). Rejestr bez wpisu (HTTP 404) i nazwa, która nie istnieje w DNS, to dane, nie błąd. `MaterialResult.failedLookups` zbiera je w formacie importu (`rdap:<domena>`, `dns:<domena>`), a `ItemEnrichment.lookups` w `enriched.json` ma sprawdzone domeny rekordu i nieudane zapytania. W GUI zadanie łączy je z `failedLookups` importu (`jobFailedLookups` w `lib/viewer/jobs.ts`), a lista kompletności materiału pokazuje ostrzeżenie „Rejestr domen (RDAP) nie odpowiedział dla domeny …” albo „Serwery DNS nie odpowiedziały dla domeny …” z powodem, tylko dla domen tego materiału. CSV wyniku nie ma kolumny błędów, więc tego nie pokazuje.
- `MaterialItemResult.faces?` (`{ image, x, y, w, h, persona?, similarity? }`): twarze znalezione w obrazach rekordu, wypełniane przy opcji `faces` (`--faces`, krok `faces`; §4.14); bez niej pole jest puste.

### 8.3 `POST /api/analyze` (`app/api/analyze/route.ts`), trasa wycofywana

GUI jej nie wywołuje (zakładka „Analizuj materiał” używa `/api/material`, panel „Nowa reklama” w Trybie eksperta `/api/analyze-material`); została dla skryptów i testów limitów. Nie dokładaj do niej funkcji.

Wejście (zod, `app/api/analyze/route.ts`): `{ url?: string ≤ 2048, text?: string ≤ 5000, imageUrl?: string ≤ 2048, offline?: boolean }`. Wymagane jest co najmniej jedno z `url`, `text`, `imageUrl`. Błąd walidacji → 400, brak `graph.json` → 503, wyjątek → 500.

Przebieg (`lib/pipeline/analyze.ts`):
1. Źródła: `offline` (albo `ANALYZE_OFFLINE=1`) korzysta z `data/sample/fixtures`, w przeciwnym razie `liveSources({skipCt:true})`, czyli bez crt.sh (`app/api/analyze/route.ts`). Konfiguracja wag pochodzi z `LINK_CONFIG`, z `<VIEWER_DATA_DIR>/linking.json` albo `../linking-default.json`, a dla przebiegu próbki z `data/sample/linking.json` (`lib/pipeline/linkConfigFile.ts`); dla innych danych bez pliku są wagi wbudowane.
2. `enrichItems` dla jednej reklamy o id `nowa-reklama`, potem `buildEvidenceGraph(..., includeItemPivots)` (`analyze.ts`). Nowe pivoty (backend, kit, parametry kampanii, CNAME) są porównywane tak samo jak pozostałe, po id węzła; listy person, OCR, ASR i test cloakingu nie są tu uruchamiane.
3. Dla każdego pivotu, który istnieje w `graph.json` (to samo id węzła), wszystkie reklamy z tym węzłem dostają dowód o wadze `waga_zapisanego_węzła × relacja_nowej` (`analyze.ts`). Relacja drugiej reklamy jest ignorowana, a idf pochodzi z oryginalnego zbioru. To przybliżenie.
4. Obraz: Hamming do `data.dhash` reklam, ten sam próg i wzór co w §4.5 (`analyze.ts`). Simhash DOM nie jest porównywany.
5. Tekst: TF-IDF dopasowany do tekstów reklam z grafu (ucięte do 600 znaków, `link.ts`) plus nowy tekst (`analyze.ts`).
6. Wynik pary to noisy-OR, wynik kampanii to najlepsza para, czyli najbliższy sąsiad (`analyze.ts`). Kandydaci z `score ≥ 0.05` lub silni, maks. 5 (`analyze.ts`). `best` to pierwszy silny kandydat albo pierwszy z `score ≥ minLinkScore` (`analyze.ts`).

Wyjście `AnalyzeResult` (`analyze.ts`):
- `input`, `mode`;
- `enrichment {landingUrl, finalUrl, redirectChain[], status, title, trackers[], ips[], domains[], contacts[], wallets[], imageDhash, errors[]}`;
- `best`, `candidates[{campaignId, size, score, strong, nearestItem, evidence[{evidence, weight, strong, discounted, items[]}] (≤ 8)}]`;
- `verdict` (tekst PL).

### 8.4 `GET /api/image?id=<itemId>` (`app/api/image/route.ts`)

Szuka reklamy w `graph.json` i rozwiązuje `data.imagePath` względem `graph.baseDir`. Obsługuje tylko pliki wewnątrz `baseDir` (`app/api/image/route.ts`) z rozszerzeniami png/jpg/jpeg/gif/webp (`app/api/image/route.ts`). Odpowiedzi: 400 bez `id`, 404 dla nieznanej reklamy lub braku pliku, 403 poza katalogiem lub dla innego typu, `cache-control: public, max-age=3600`.

### 8.5 `GET /api/ct-feed?limit=50` (`app/api/ct-feed/route.ts`)

Zwraca `{feed, records, updatedAt}`: najnowsze wpisy feedu watchera CT (§16.6), najnowsze pierwsze. `limit` 1–500, domyślnie 50 (`app/api/ct-feed/route.ts`). Plik: `CT_FEED_FILE` albo `data/ct-watch.jsonl`, czytany przy każdym żądaniu (`app/api/ct-feed/route.ts`), z końca pliku, maks. 4 MiB (`lib/ct/feed.ts`). Brak pliku albo pusty plik daje `records: []`, błąd odczytu też `records: []` z polem `error`. `cache-control: no-store`. Od zadania I11 lista zawiera też wiersze harmonogramu skanów (`data/watch.jsonl` albo `WATCH_FILE`), które wskazują kampanię albo mają potwierdzenia (`source: "watch"`, `candidate.kind: "watch"`, przesłanki: źródło, przepis, werdykt analizy, potwierdzenia; §18).

### 8.6 Ochrona i jej braki

- W trybie live `/api/analyze` pobiera adresy od użytkownika przez `fetchPage` i `fetchBinary` z ochroną SSRF (§11).
- **Jest tylko prosty limit zapytań w pamięci procesu (`lib/viewer/rateLimit.ts`, `ANALYZE_RATE_LIMIT`), nie ma uwierzytelniania ani kolejki.** Każde żądanie live wykonuje zapytania DNS/RDAP/ASN i GET-y. Przed publicznym wdrożeniem trzeba dodać uwierzytelnianie albo ustawić `ANALYZE_OFFLINE=1`.
- `/api/ct-feed` tylko czyta lokalny plik i niczego nie pobiera z sieci.

---

## 9. CLI

Uruchomienie: `bun run <skrypt> [--flagi]` lub `bun run <skrypt> -- --flagi`; obie formy działają. Skrypty z flagami (wszystkie poza `llm:smoke`, `media:smoke` i `sample:generate`) mają `--help`.

| Skrypt | Flagi (domyślnie) | Przykład |
|---|---|---|
| `analyze-material` (archiwum) | `--archive` (kopie martwych stron z urlscan i Wayback); `enrich`/`pipeline`: `--archive-lookup` | `bun run analyze-material -- --url https://oferta.example/ --archive` |
| `adlib` | `search --platform <meta\|google\|tiktok\|x\|all>` z `--keyword`, `--advertiser`, `--from`, `--to`, `--country` (PL), `--limit`, `--personas` (lista osób do domyślnych zapytań), `--out` (katalog spraw, wymagane); `get --platform <p> --id <identyfikator> --out <katalog>`. Źródło bez dostępu jest wypisane z powodem i instrukcją, kod 0 (§3.7) | `bun run adlib -- search --platform all --keyword inwestycja --out dane/adlib` |
| `import-cases` | `--cases` (katalog spraw, wymagane), `--out` (katalog roboczy, wymagane), `--lookups` (pasywne DNS, RDAP, ASN dla domen stron), `--ct` (także crt.sh) | `bun run import-cases -- --cases sprawy/ --out praca/ --lookups` |
| `ingest` | `--input` (`data/sample/ads.csv`), `--mapping` (`data/sample/mapping.json` tylko bez `--input`; z `--input` mapowanie automatyczne), `--out` (`data/work/items.json`), `--base-dir` (katalog pliku) | `bun run ingest -- --input nask.csv --mapping nask-mapping.json --base-dir ./nask` |
| `enrich` | `--items`, `--out` (`data/work/enriched.json`), `--offline`, `--fixtures` (`data/sample/fixtures`), `--concurrency` (4), `--skip` (lista: `page,favicon,image,dns,rdap,ct,asn`), `--personas` (bez `--items`: `data/sample/personas.json`), `--ner`, `--cloaking`, `--ocr`, `--asr`, `--audio`, `--archive` (`data/work/archive`) / `--no-archive` | `bun run enrich -- --skip ct` · `bun run enrich -- --offline --cloaking --ocr --audio` |
| `build-graph` | `--enriched`, `--graph` (`data/graph.json`), `--campaigns` (`data/campaigns.json`), `--near-misses` (domyślnie `near-misses.json` obok `--campaigns`, §5.6), `--config` (domyślnie wagi wbudowane; dla domyślnego `data/work/enriched.json`, czyli przebiegu próbki, `data/sample/linking.json`), `--text` (`tfidf`; też `TEXT_SIMILARITY`) | `bun run build-graph -- --config recall.json --text embedding` |
| `base` | `--cases` (wymagane), `--out` (`VIEWER_DATA_DIR`, potem `data/`), `--offline` (domyślnie, gdy `ANALYZE_OFFLINE=1`), `--lookups` (wymusza DNS, RDAP, ASN), `--labels` (opcjonalne etykiety `{kampania: [id]}`), `--config` (domyślnie wagi wbudowane) | `bun run base -- --cases /dane/probka --out /dane/baza` |
| `cache:freeze` | `--out` (wymagane), `--cache` (`CACHE_DIR`, potem `.cache`) | `bun run cache:freeze -- --out dane/zamrozone && bun run enrich -- --offline --fixtures dane/zamrozone` |
| `demo` | `--out` (`DEMO_OUT`, potem `dane/demo`), `--sample` (`data/sample`) | `bun run demo` |
| `demo-batch` | `--out` (`dane`), `--cases-name` (`syntetyczne`), `--new-name` (`syntetyczne-nowe`), `--sample` | `bun run demo-batch -- --out dane --cases-name probka --new-name nowe` |
| `evaluate` | `--graph`, `--campaigns`, `--json`; albo `--csv` (partia `analyze-material`) z `--labels` (`{"kampania": ["sprawa", …]}` lub `{"sprawa": "kampania"}`) | `bun run evaluate -- --json > metryki.json`; `bun run evaluate -- --csv partia.csv --labels etykiety.json` |
| `sensitivity` | `--enriched`, `--labels` (etykiety prawdy, opcjonalne), `--config`, `--runs` (50), `--spread` (`0.1,0.2,0.3`), `--seed` (1), `--one-at-a-time` (`0.7,1.3`), `--thresholds` (`0.8,0.9,1.1,1.2`), `--out` (wymagane), `--text`; albo `--dump-config <plik>` z `--spread` i `--seed` (zapis jednej zaburzonej konfiguracji) | `bun run sensitivity -- --enriched data/work/enriched.json --runs 5 --out data/work/sensitivity` |
| `pipeline` | `--input`, `--mapping`, `--offline`, `--fixtures`, `--config` (z próbką: `data/sample/linking.json`; z `--input`: domyślne), `--text`, `--concurrency`, `--skip`, `--personas` (z próbką: `data/sample/personas.json`), `--ner`, `--cloaking`, `--ocr`, `--asr`, `--audio`; archiwum HTML zawsze w `data/work/archive` | `bun run pipeline --offline` · `bun run pipeline -- --input nask.csv --mapping m.json --skip ct` |
| `summarize` | `--graph`, `--campaigns`, `--out` (`data/summaries.json`), `--campaign K01`, `--limit N`, `--all` (też kampanie 1-elementowe) | `LLM_PROVIDER=ollama bun run summarize -- --limit 10` |
| `evidence` | `--campaign` (wymagane), `--out` (`data/evidence/<kampania>`), `--graph`, `--campaigns`, `--enriched` (`data/work/enriched.json`), `--config`, `--tlp` (`TLP:AMBER`), `--submitter-name`, `--submitter-email`, `--submitter-address`, `--submitter-role` | `bun run evidence -- --campaign K01 --submitter-name "…" --submitter-email "…"` |
| `watch` | `--data` (`VIEWER_DATA_DIR`), `--every` (30m), `--sources` (`ct,adlibrary,urlscan,certlist`), `--recipes` (też `WATCH_RECIPES`), `--once`, `--replay plik.jsonl`, `--offline`, `--file` (`data/watch.jsonl`; też `WATCH_FILE`), `--add-to-base`, `--add-verdicts` (`known_campaign`), `--seed-recipes plik.json`, `--url` | `bun run watch -- --data data --once --sources ct --replay data/sample/ct-stream.jsonl` |
| `backtest:ct` | `--list` (log akcji Listy CERT, NDJSON), `--mode lead|fingerprints`, `--certs` (nagranie certyfikatów JSONL), `--save-certs`, `--sample`, `--seed`, `--data`, `--since`, `--budgets` (10,50,100), `--out` | `bun run backtest:ct -- --list actions_2026.log --mode fingerprints --data dane/baza --since 2026-10-10T00:00:00Z --certs nagranie.jsonl` |
| `ct:watch` | `--campaigns`, `--graph`, `--lexicon` (`data/sample/ct-lexicon.json`), `--config`, `--url` (`ws://127.0.0.1:8181/,wss://certstream.calidog.io/`; też `CT_STREAM_URL`), `--duration` (s), `--threshold` (0.6), `--feed` (`data/ct-watch.jsonl`; też `CT_FEED_FILE`), `--no-enrich`, `--fetch-page`, `--offline`, `--dry-run`, `--max-enrich-per-min` (30), `--replay plik.jsonl` | `bun run ct:watch -- --duration 300` · `bun run ct:watch -- --replay data/sample/ct-stream.jsonl` |
| `ct:backfill` | `--pattern` (lista; bez niej z szablonów kampanii), `--since` (7 dni), `--campaigns`, `--graph`, `--lexicon`, `--config`, `--threshold`, `--feed`, `--include-expired`, `--no-enrich`, `--fetch-page`, `--offline`, `--dry-run` | `bun run ct:backfill -- --pattern 'zwrot%' --no-enrich` |
| `analyze-material` | jedno lub kilka z: `--case` (katalog sprawy), `--cases` (katalog partii: każdy podkatalog to sprawa; `--each-file`: także każdy luźny plik jako osobna sprawa), `--dataset` (plik zbioru `.csv`/`.tsv`/`.json`/`.jsonl`, wiersz = materiał; `--mapping` jak w `ingest`), `--url`, `--text`; `--data` (`VIEWER_DATA_DIR` albo `data/`), `--csv` (wiersz na rekord), `--json` (pełny `MaterialResult`; `-` = stdout), `--out` (to samo, używa przeglądarka), `--work`, `--config`, `--personas`, `--fixtures`, `--live`, `--asr`, `--audio`, `--clip`, `--speaker`, `--faces` (z `--verify-person <id>`), `--ad-library` | `bun run analyze-material -- --cases partia/ --csv wynik.csv --json wynik.json` |
| `llm:smoke` | brak | `OLLAMA_MODEL=SpeakLeash/bielik-11b-v3.0-instruct:Q5_K_M bun run llm:smoke` |
| `media:smoke` | brak; OCR obrazu z polskim tekstem, ASR mowy z `say -v Zosia` (macOS) po konwersji do WAV 16 kHz, odciski Chromaprint; brakujące narzędzia są zgłaszane i pomijane, kod wyjścia zawsze 0 | `bun run media:smoke` |
| `sample:generate` | brak; **kasuje i odtwarza `data/sample/`** | `bun run sample:generate && bun run pipeline --offline` |
| `test` / `test:watch` | vitest | `bun run test` |
| `lint`, `typecheck`, `build`, `dev`, `start` | standard Next.js | `PORT=3001 bun run start` |

`pipeline` zawsze zapisuje do domyślnych ścieżek z `steps.ts`, więc nadpisuje `data/graph.json` i `data/campaigns.json`. Eksperymenty kieruj przez `build-graph --graph/--campaigns` do innych plików. `ct:watch` kończy się kodem 2, gdy żaden strumień CT nie przysłał danych (`scripts/ct-watch.ts`), a `ct:backfill`, gdy żaden wzorzec nie dał odpowiedzi (`scripts/ct-backfill.ts`).

---

### 9.1 Kontener i CLI dla osób oceniających (od 21.11.2026, zadanie i7)

Obraz (`Dockerfile`, cel `run`) zawiera `bun` w wersji z `packageManager`, `node_modules`, zbudowane GUI, `scripts/`, `lib/`, `app/` i `data/sample` (żadnych innych danych: `.dockerignore` wyklucza `data/work`, `.cache`, `.env*`, uploady i `dane/`). Narzędzia: `tesseract-ocr` z językiem polskim, `ffmpeg` z `ffprobe`, `libchromaprint-tools` (`fpcalc`), `unzip` (wgrywanie ZIP w `/api/analyze-material`), Python 3 z venv `/opt/venv` i `scripts/py/requirements.txt` (klient BigQuery dla `scripts/py/google_atc.py` oraz `opencv-python-headless` i `numpy` dla twarzy; cięższe pakiety profilu `full` w `docker/requirements-full.txt`). Użytkownik `node`, wolumen `/dane`.

Szybki start (`docker compose`, katalog `./dane` na hoście to `/dane` w kontenerze):

```bash
docker compose up -d                                                # GUI na :3000
docker compose run --rm app bun run base -- --cases /dane/probka    # baza znanych kampanii z próbki
docker compose run --rm app bun run analyze-material -- --cases /dane/nowe --csv /dane/wynik.csv --each-file
docker compose run --rm app bun run demo                            # bez własnych danych: baza i partia syntetyczne
```

`base` zapisuje bazę w `VIEWER_DATA_DIR` (`/dane/baza`), skąd czyta ją i GUI, i `analyze-material` bez `--data`. Kroki: `import-cases`, `ingest`, `enrich` (zawsze z zapisanych odpowiedzi), `build-graph`; status każdego kroku jest w `<baza>/base.json`, a krok, który się nie wykonał (brak DNS/RDAP/ASN w trybie offline, brak whisper.cpp, odcisku audio, modelu CLIP), ma `status: "skipped"` i powód. Wagi: `DEFAULT_LINK_CONFIG`, nie plik próbki (próbka ma fikcyjny skracacz i znacznik generatora); `--config` kopiuje plik do `<baza>/linking.json`, żeby analiza używała tych samych wag. Wynik `analyze-material` (`--json`) ma pole `steps` z wynikiem każdego kroku per sprawa (`done`, `skipped` z powodem w `detail`, `error`).

Zmienne kontenera: `VIEWER_DATA_DIR=/dane/baza`, `DEMO_OUT=/dane/demo`, `MATERIAL_WORK_DIR=/dane/praca` (wgrania z GUI), `BUN_BIN=/usr/local/bin/bun` (runner analizy z GUI), `TZ=Europe/Warsaw` (bez niego `firstSeen` ze zrzutów przesuwa się o 2 h), `HF_HUB_OFFLINE=1` (CLIP tylko z modelu lokalnego: `allowRemoteModels=false`; bez modelu krok `clip` jest `skipped` z powodem, bez prób pobierania), `ANALYZE_OFFLINE=1`. Gdy w `VIEWER_DATA_DIR` nie ma bazy, GUI działa i pokazuje komunikat z poleceniem `base`.

Profile `docker compose`: domyślny (`app`) pomija ASR (brak whisper.cpp i modelu), głos (brak SpeechBrain), CLIP (brak modelu), LLM (brak Ollamy) i zapytania sieciowe; `full` (`app-full`, cel `full`) dodaje `whisper-cli` (whisper.cpp) i SpeechBrain na CPU; modele zostają na hoście i są montowane tylko do odczytu (`WHISPER_MODEL_DIR`, domyślnie `~/models/whisper`, `WHISPER_MODEL`; `SPEAKER_MODEL_HOST`, w kontenerze `SPEAKER_MODEL_DIR`); `llm` (`ollama`) i `ct` (`certstream`) są tylko w profilach. Gotowa baza z paczki niepublicznej: zakomentowany wolumen `/dane/baza:ro` w `docker-compose.yml`.

`bun run cache:freeze` (`lib/pipeline/freeze.ts`) zapisuje to, co przebieg z siecią zostawił w `.cache/` (strony, favicony i obrazy po adresie, DNS, RDAP, crt.sh, ASN), jako `<out>/frozen.json`; `fixtureSources` (czyli `--offline --fixtures <out>`, także w `analyze-material --fixtures`) odtwarza z niego przebieg bez sieci. Cache trzyma odpowiedzi sparsowane, dlatego to osobny format, nie surowe fixtures próbki. Odpowiedzi binarne trafiają do cache dopiero od tej wersji (`binaryCacheKey`). Test: `tests/cacheFreeze.offline.test.ts` (to samo wzbogacenie z zamrożonych odpowiedzi co z przebiegu źródłowego).

`bun run demo` (`lib/pipeline/demoScenario.ts', test `tests/demo.offline.test.ts`): buduje bazę z 12 spraw próbki i analizuje 8 materiałów: znana kampania, podobne kampanie, duplikat, za mało danych, martwa strona (tylko zrzut z adresem na pasku; adres `martwa-oferta.example.com`, bo parser paska przyjmuje tylko prawdziwe sufiksy, a `example.com` jest zarezerwowane; cechy z nagranych odpowiedzi RDAP, crt.sh i DNS, `missing` mówi, czego brakło) oraz trzy strony jednej kampanii ze zmienionymi domenami i twarzami i wspólnym zapleczem (serwer trackera, konto platformy, backend formularza z identyfikatorem klienta), czyli jedna nowa kampania N1. Wynik: `<out>/wynik/wynik.json` i `wynik.csv`.

### 9.2 Wiedza jako wynik (zadanie i9)

- `bun run export-dataset -- --data <baza> --out <katalog> [--csv]` (`lib/pipeline/exportDataset.ts`, test `tests/exportDataset.offline.test.ts`): wiersz na materiał z `graph.json` i `campaigns.json`; kolumny w stałej kolejności `material_id, campaign_id, family_id, features, top_premises, ad_library_url, basis, persona, deepfake_score`. `features` to liczba encji danego typu osiągalnych z materiału w grafie, `top_premises` to do 3 najmocniejszych przesłanek wobec reszty kampanii (`EXPORT_TOP_PREMISES`). Eksport nie czyta `enriched.json`, więc wektory głosu, twarzy i obrazu nie mogą do niego trafić (test sprawdza brak takich pól).
- `--neo4j <katalog>` (`lib/pipeline/exportNeo4j.ts`): `nodes.csv` (`id:ID`, `:LABEL`, …) i `edges.csv` (`:START_ID`, `:END_ID`, `:TYPE`, …) dla `neo4j-admin database import`; wiersz na węzeł i na krawędź grafu (powiązania par materiałów `graph.links` nie są krawędziami).
- `bun run source-stats -- <graph.json> [--json]` (`lib/pipeline/sourceStats.ts`): powiązania wewnątrz kampanii wg typu dowodu; podstawa liczb w `ZRODLA-METADANYCH.md`.
- `bun run report -- --since 7d [--data] [--ct-feed] [--reports plik.json] [--out]` (`lib/pipeline/periodReport.ts`): raport Markdown. Narzędzie nie ma rejestru zgłoszeń, więc sekcja „Zgłoszenia bez reakcji” czyta opcjonalny plik `[{id, reportedAt, reaction}]`; bez niego pisze, że danych brak.
- `bun run contract-schema` (`lib/pipeline/contract.ts`): schematy JSON kontraktu wejścia i wyjścia w `docs/schema/` (zod 4, `z.toJSONSchema`; test pilnuje zgodności plików z kodem). Opis: [INTEGRACJA.md](INTEGRACJA.md).
- Etykieta „znany backend leadów” (`lib/graph/knownBackends.ts`, dane `data/znane-backendy-leadow.json`): dopisek przy przesłance `endpoint`; waga bez zmian. Lista ma dwa wpisy z raportu badania; cztery backendy z phishdestroy.io do uzupełnienia po lekturze strony.
- Kontener bez sieci (sprawdzone na bazie syntetycznej z `demo-batch` i `base`, kod 0): `docker run --rm --network none -v "$PWD/dane:/dane" odcisk-kampanii:latest bun run export-dataset -- --data /dane/baza --out /dane/eksport --csv` (`docker compose run` nie przyjmuje `--network`; z siecią: `docker compose run --rm app bun run export-dataset -- …`).

## 10. Konfiguracja

### 10.1 Zmienne środowiskowe (wszystkie odczyty w kodzie)

| Zmienna | Domyślnie | Odczyt | Działanie |
|---|---|---|---|
| `LLM_PROVIDER` | `ollama` | `lib/llm/index.ts` | `ollama` / `anthropic` (inna wartość → błąd) |
| `OLLAMA_HOST` | `http://localhost:11434` | `ollama.ts` | |
| `OLLAMA_MODEL` | PLLuM | `ollama.ts` | |
| `OLLAMA_EMBED_MODEL` | `bge-m3` | `ollama.ts`, `steps.ts` | |
| `LLM_TIMEOUT_MS` | 180000 | `ollama.ts`, `anthropic.ts` | |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | `anthropic.ts` | |
| `ANTHROPIC_EFFORT` | `medium` | `anthropic.ts` | `low`…`max` |
| `ANTHROPIC_API_KEY` | — | SDK | albo `ANTHROPIC_AUTH_TOKEN` / profil `ant auth login` |
| `TEXT_SIMILARITY` | `tfidf` | `scripts/build-graph.ts`, `scripts/pipeline.ts` | gdy brak `--text` |
| `CACHE_DIR` | `./.cache` | `cache.ts` | |
| `CACHE` | włączony | `cache.ts` | `off/0/false/no` wyłącza |
| `CT` | włączony | `sources.ts` | `off/0/false/no` pomija crt.sh |
| `DNS_SERVERS` | systemowe | `dns.ts` | lista IP po przecinku |
| `FETCH_INSECURE_TLS` | `0` | `fetchPage.ts` | `1` akceptuje nieważne certyfikaty TLS |
| `ARCHIVE_SOURCES` | – (krok wyłączony) | `lib/pipeline/archiveContext.ts` | `urlscan,wayback`; sama włącza krok archiwalny (kopie martwych stron) |
| `URLSCAN_API_KEY` | – | `lib/osint/archive/urlscan.ts` | opcjonalny klucz urlscan: dokłada DOM zapisanych stron do kopii |
| `ANALYZE_OFFLINE` | `0` (w kontenerze `1`) | `app/api/analyze/route.ts`, `app/api/material/route.ts`, `scripts/base.ts` | `1` = `/api/analyze` tylko z fixtures, analiza z GUI bez zapytań sieciowych, `base` bez DNS/RDAP/ASN |
| `ANALYZE_RATE_LIMIT`, `ANALYZE_RATE_WINDOW_S` | wyłączony, 60 s | `lib/viewer/rateLimit.ts` | limit zapytań na klienta (nagłówek `X-Forwarded-For`/`X-Real-IP`) do `/api/analyze`, `/api/analyze-material`, `/api/material`; po przekroczeniu 429 z `Retry-After`. Przy publicznym adresie ustaw też `ANALYZE_OFFLINE=1` (wtedy żądanie nie może włączyć pobierania stron) i `MATERIAL_MAX_MB` (413) |
| `LINK_CONFIG` | `<VIEWER_DATA_DIR>/linking.json`, `<VIEWER_DATA_DIR>/../linking-default.json`; plik próbki tylko dla przebiegu próbki | `lib/pipeline/linkConfigFile.ts` | konfiguracja wag dla `/api/analyze` i analizy z GUI |
| `WHISPER_MODEL` | `~/models/whisper/ggml-large-v3-turbo.bin` | `lib/media/asr.ts` | model whisper.cpp dla ASR |
| `MLX_WHISPER_MODEL` | `mlx-community/whisper-large-v3-turbo` | `asr.ts` | tylko gdy brak whisper-cli i model jest już lokalnie |
| `HF_HUB_CACHE` / `HF_HOME` | `~/.cache/huggingface` | `asr.ts` | gdzie szukać lokalnego modelu mlx |
| `CT_STREAM_URL` | `ws://127.0.0.1:8181/,wss://certstream.calidog.io/` | `scripts/ct-watch.ts` | strumienie CT w kolejności prób |
| `WATCH_RECIPES`, `WATCH_FILE` | brak, `data/watch.jsonl` (w Dockerze `/dane/watch.jsonl`, `docker-compose.yml`) | `scripts/watch.ts`, `app/api/ct-feed/route.ts` | przepisy harmonogramu skanów, plik jego wierszy |
| `CT_FEED_FILE` | `data/ct-watch.jsonl` | `scripts/ct-watch.ts`, `scripts/ct-backfill.ts`, `app/api/ct-feed/route.ts` | feed kandydatów |
| `VIEWER_DATA_DIR` | `data/` | `lib/viewer/data.ts` | katalog z `graph.json`, `campaigns.json`, `enriched.json` (przebieg pokazywany w GUI i porównywany w `analyze-material`); `bun run base` zapisuje tu bazę. W kontenerze `/dane/baza` |
| `MATERIAL_WORK_DIR` | katalog tymczasowy systemu (`analiza-kampanii`) | `lib/viewer/jobs.ts` | pliki wgrane w GUI i wyniki zadań, poza repozytorium (w kontenerze `/dane/praca`) |
| `MATERIAL_TIMEOUT_MS` | `21600000` (6 h) | `lib/viewer/jobs.ts` | po tym czasie zadanie analizy z GUI jest przerywane; `0` wyłącza limit |
| `MATERIAL_MAX_MB` | bez limitu | `lib/viewer/upload.ts`, `lib/viewer/uploadSession.ts` | limit wgrywania w MB; powyżej: 413. GUI wysyła pliki pojedynczo (`POST /api/material/upload`, potem `PUT /api/material/upload/<id>` na plik) i serwer zapisuje je strumieniowo na dysk, więc partia wielu GB nie trafia do pamięci; ZIP-y powyżej 100 MB rozpakowuje strumieniowo Python (`zipfile`). Ustaw tylko przy publicznym adresie |
| `MATERIAL_MAX_FILES` | bez limitu | `lib/viewer/upload.ts` | limit liczby wgranych plików (analiza z GUI i budowa bazy); powyżej: błąd 400 |
| `PERSONAS` | `<katalog bazy>/personas.json`, potem katalog wyżej | `scripts/analyze-material.ts` | lista osób dla `analyze-material` (to samo co `--personas`) |
| `PERSONAS_FILE` | – | `app/api/material/route.ts` | lista osób dla zadań z GUI |
| `BUN_BIN` | `bun` z `PATH` | `lib/viewer/jobs.ts`, `app/api/analyze-material/route.ts` | binarium buna, którym GUI uruchamia analizę (w kontenerze `/usr/local/bin/bun`) |
| `DEMO_OUT` | `dane/demo` | `scripts/demo.ts` | katalog wyniku `bun run demo` (w kontenerze `/dane/demo`) |
| `CLIP_MODEL` | `Xenova/clip-vit-base-patch32` | `lib/media/imageEmbed.ts` | model CLIP dla `--clip` |
| `HF_HUB_OFFLINE` | `0` (w kontenerze `1`) | `lib/media/imageEmbed.ts` | `1`: tylko model już na dysku, bez pobierania; bez modelu CLIP jest `skipped` z powodem |
| `SPEAKER_PYTHON` | `.venv-speaker/bin/python` | `lib/media/speaker.ts` | interpreter z SpeechBrain dla `--speaker` |
| `SPEAKER_MODEL_DIR` | `~/models/speechbrain/spkrec-ecapa-voxceleb` | `lib/media/speaker.ts` | katalog modelu ECAPA |
| `SPEAKER_VAD_DIR` | `~/models/speechbrain/vad-crdnn-libriparty` | `lib/media/speaker.ts` | katalog modelu detekcji mowy (galeria głosów, §4.16) |
| `FACE_PYTHON` | `.venv-face/bin/python` (w obrazie `/opt/venv/bin/python`) | `lib/media/face.ts` | interpreter z `opencv-python-headless` dla `--faces` |
| `FACE_MODEL_DIR` | `~/models/opencv` (w obrazie `/opt/models/opencv`) | `lib/media/face.ts`, `scripts/py/face_embed.py` | katalog z `face_detection_yunet_2023mar.onnx` i `face_recognition_sface_2021dec.onnx` |
| `META_ADS_PYTHON` | interpreter z shebangu `meta-ads-collector` w `PATH` | `lib/osint/adLibrary.ts` | Python z MetaAdsCollector dla `--ad-library` |
| `ADLIB_BQ_MAX_BYTES` | 10 GiB (`lib/adlib/config.ts`) | `lib/adlib/config.ts` | limit bajtów jednego zapytania BigQuery (`20GB`, `512MB`, liczba bajtów); zob. §3.7 |
| `ADLIB_PYTHON` | `python3` | `lib/adlib/google.ts` | Python z `google-cloud-bigquery` dla `scripts/py/google_atc.py` |
| `GOOGLE_CLOUD_PROJECT` | projekt z `gcloud config` | `scripts/py/google_atc.py` | projekt BigQuery (sandbox) dla źródła Google |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | – | `lib/adlib/tiktok.ts` | klucze API TikTok Commercial Content Library |
| `X_ADS_FILE` | – | `lib/adlib/x.ts` | plik CSV z repozytorium reklam X |
| `ADLIB_GOOGLE_RPC` | wyłączone | `lib/adlib/googleRpc.ts` | `1` włącza nieoficjalne RPC Google (wyszukiwanie po domenie) |

`.env.example` opisuje zmienne LLM, grafu, wzbogacania, API, adapterów mediów (`WHISPER_MODEL`, `MLX_WHISPER_MODEL`) i watchera CT (`CT_STREAM_URL`, `CT_FEED_FILE`).

### 10.2 Plik konfiguracji linkowania (`--config plik.json`)

`mergeConfig` (`lib/graph/config.ts`) łączy obiekty rekurencyjnie i podmienia wartości proste. Tablice w `lists` są **dopisywane** do domyślnych, chyba że ustawisz `"replaceLists": true` (`config.ts`). Inne tablice są podmieniane. Bez `--config` w `pipeline` z `--input` obowiązują same wartości domyślne.

| Parametr | Domyślnie | `config.ts` | Efekt podniesienia |
|---|---|---|---|
| `typeWeights.<typ>` | §4.1 | `config.ts` | większy wpływ typu; ≥ 0.7 robi typ silnym |
| `strongThreshold` | 0.7 | `config.ts` | mniej silnych dowodów, mniej scaleń przez union-find |
| `maxStrongDfRatio` | 0.5 | `config.ts` | encja w większym odsetku reklam nadal może być silna |
| `maxPivotDf` | 400 | `config.ts` | encje o większym df nadal tworzą pary (koszt O(df²)) |
| `idf.enabled` / `idf.floor` | true / 0.2 | `config.ts` | podłoga ogranicza karę za częstość; `enabled: false` wyłącza też karę za powszechność |
| `idf.ubiquityStart` / `idf.ubiquityMinItems` | 0.5 / 10 | `config.ts` | od jakiego odsetka reklam i od jakiej wielkości zbioru działa kara za powszechność |
| `minLinkScore` | 0.15 | `config.ts` | słabsze powiązania nie wchodzą do Louvaina: mniej FP, więcej FN |
| `output` (`topKPerItem` / `maxEvidence` / `campaignMaxEvidence`) | 12 / 6 / `null` | `config.ts` | więcej powiązań i dowodów w `graph.json` (§5.7); powiązania wewnątrz kampanii zostają zawsze, `campaignMaxEvidence` ogranicza tylko ich dowody (`null` = wszystkie) |
| `commentBlockNames` (`minBlocks` / `floor`) | 5 / 0,3 | `config.ts` | rabat bloku komentarzy z pospolitymi imionami (§4.11): od `minBlocks` bloków w zbiorze waga bloku × średnie odwrotne częstości jego imion, nie mniej niż `floor`; `null` wyłącza |
| `similarity.imageHamming` | 10 | `config.ts` | więcej par obrazów: więcej TP i FP |
| `similarity.imageWeight` | 0.6 | `config.ts` | |
| `similarity.text.tfidfThreshold` | 0.5 | `config.ts` | mniej par tekstów |
| `similarity.text.embeddingThreshold` | 0.86 | `config.ts` | |
| `similarity.text.weight` / `minChars` | 0.5 / 25 | `config.ts` | |
| `similarity.dom.hamming` / `weight` | 6 / 0.45 | `config.ts` | więcej par stron o podobnym szablonie |
| `similarity.audio.minSimilarity` / `weight` | 0.85 / 0.5 | `config.ts` | wyższy próg = tylko prawie identyczne nagrania |
| `kit.sameOriginEndpointFactor` / `shortEndpointPathFactor` | 0.4 / 0.5 | `config.ts` | większy wpływ ścieżek backendu na tej samej domenie |
| `kit.minHiddenFields` | 2 | `config.ts` | ile specyficznych ukrytych pól tworzy pivot |
| `kit.domainPatternMinDomains` / `domainPatternMinLiteralChars` | 2 / 3 | `config.ts` | ile domen musi dzielić szablon; ile liter musi mieć rdzeń |
| `kit.domainPatternNoAnchorFactor` / `domainPatternAgnosticFactor` | 0.1 / 0.85 | `config.ts` | szablon bez rdzenia (generator nazw platformy stron) zostaje poniżej `minLinkScore` |
| `kit.machineScopedParams` | `campaign_id`, `offer_id` | `config.ts` | parametry, których liczbowa wartość przy identyfikatorze xid dostaje w kluczu maszynę trackera (§4.12) |
| `trackerCampaignWeight` | 0.6 | `config.ts` | waga kampanii w trackerze (`tracker_campaign`, numer kampanii z maszyną): łączy, ale nie jest silna |
| `kit.campaignParamWordFactor` | 0.75 | `config.ts` | zniżka wartości słownych parametrów kampanii |
| `outboundLinkFactor` | 0.4 | `config.ts` | |
| `registrationBurstHours` / `registrationBurstWeight` | 48 / 0.3 | `config.ts` | |
| `maxCertDomains` | 25 | `config.ts` | |
| `louvain.resolution` / `seed` | 1.0 / 42 | `config.ts` | wyższa rozdzielczość = mniejsze kampanie |
| `lists.*` | §4.4 | `config.ts` | |
| `lists.endpointPlatformPaths` / `paramSchemaPlatformParts` / `multiTenantBackends` | §4.12 | `config.ts` | cechy platform z czynnikiem ok. 0,1 (ścieżki backendów i plików, część szablonu linku, hosty usług wielu klientów); SDK platformy stron 0,01 |
| `lists.suspendedRdapStatuses` | `clienthold`, `serverhold` | `config.ts` | statusy RDAP domeny zawieszonej (atrybut `suspended` węzła domeny, §4.12) |
| `campaignRules.contentKinds` / `minContentKinds` / `contentKindsWithInfrastructure` | §5.4 pkt 5 / 2 / `null` | `config.ts` | które rodzaje są treścią, ile rodzajów treści łączy reklamy bez infrastruktury; liczba zamiast `null` pozwala treści łączyć także przy infrastrukturze |
| `campaignRules.infrastructureKinds` / `infrastructureMinWeight` | §5.4 pkt 5 / 0,3 | `config.ts` | co jest infrastrukturą reklamy i od jakiej wagi się liczy |
| `campaignRules.sameCreative.clipMinCosine` / `creativeFileWeight` | 0,97 / 0,95 | `config.ts` | próg „tych samych klatek” (razem z tym samym dźwiękiem) i waga tego samego pliku kreacji |
| `campaignRules.contentVariant` (`imageHamming` / `clipMinCosine`) | 6 / 0,95 | `config.ts` | wariant kreacji (§5.4 pkt 7): maks. odległość dHash i min. cosinus CLIP „prawie identycznej” kreacji; `null` wyłącza dołączanie wariantów |
| `campaignRules.familyOnlyKinds` | `technique`, `persona`, `profit_claim` | `config.ts` | rodzaje liczone tylko do grup podobnych kampanii |
| `campaignRules.notAloneKinds` / `minEvidenceKinds` | §5.4 pkt 4 / 2 | `config.ts` | ślady zestawu stron: jeden rodzaj razem, kampania wymaga dowodu spoza nich i spoza treści; ile rodzajów (z dowodem operatora) łączy |
| `campaignRules.accountConflictOverStrongKinds` | `path_id` | `config.ts` | silny dowód tych rodzajów nie łączy różnych kont platformy stron (§5.4 pkt 3) |
| `nearMiss` (`minScoreRatio` / `maxPairs`) | 0,5 / 200 | `config.ts` | raport bliskich par (§5.6): od jakiej części `minLinkScore` para trafia na listę i ile par zapisać (0 wyłącza listę); nie zmienia żadnej decyzji łączenia |

Przykład próbki: `data/sample/linking.json` dopisuje fikcyjny skracacz `krotki.test` (factor 0), NS `vps-demo.test` (0.1) i komentarz-znacznik generatora próbki (0). Bez tego pliku pairwise F1 na próbce wynosi 0.977 zamiast 1.0 (sprawdzone 19.11.2026; decyduje wpis skracacza, sam znacznik tłumi już kara za powszechność).

### 10.3 Stałe w kodzie (bez pliku konfiguracji)

| Stała | Wartość | Miejsce |
|---|---|---|
| budżet czasu / limit bajtów / przekierowania strony | 8 s / 2 MiB / 8 | `fetchPage.ts` |
| limit pliku binarnego (obraz, favicon) | 5 MiB | `fetchPage.ts` |
| meta refresh śledzony do | 10 s | `fetchPage.ts` |
| timeout DNS / RDAP / CT | 5 s / 10 s / 30 s | `dns.ts`, `rdap.ts`, `ct.ts` |
| ponowienia CT / opóźnienie bazowe / maks. Retry-After / maks. certyfikatów | 3 / 2 s / 60 s / 200 (wzorzec: 1000) | `ct.ts`, `ct.ts`, `ct.ts` |
| współbieżność: reklamy / DNS i ASN / RDAP / CT / NER / media | 4 / 8 / 2 / 1 / 1 / 2 | `enrich.ts` |
| łańcuch CNAME | maks. 4 skoki | `enrich.ts` |
| User-Agenty testu cloakingu / próg simhash DOM | crawler Meta, iPhone Safari / 12 bitów | `enrich.ts`, `enrich.ts` |
| limity czasu OCR / ASR / fpcalc / ffmpeg | 60 s / 10 min / 60 s / 120 s | `ocr.ts`, `asr.ts`, `audioFp.ts`, `asr.ts` |
| kit strony: backendy / pliki / ukryte pola / komentarze / min. tagów simhash | 50 / 100 / 100 / 50 / 25 | `pagekit.ts` |
| TTL cache | §3.4 | |
| maks. pikseli obrazu | 50 Mpx | `imageHash.ts` |
| `visibleText` / `outboundUrls` | 5000 znaków / 300 | `extract.ts` |
| odrzucanie słabych powiązań | `score < 0.05` | `link.ts` |
| przycięcie zapisu: powiązania / dowody | 12 / 6 | `prune.ts` |
| `topEvidence` kampanii | 6 | `cluster.ts` |
| `/api/analyze`: kandydaci / dowody / limity wejścia | 5 / 8 / 2048·5000·2048 znaków | `analyze.ts`, `app/api/analyze/route.ts` |
| tekst reklamy, OCR i ASR zapisany w węźle | 600 znaków | `link.ts` |
| paczka dowodów: domen na jedno zgłoszenie do CERT | 50 | `lib/evidence/pack.ts` |
| watcher CT | §16.8 | |

### 10.4 Konfiguracja watchera CT (`--lexicon plik.json`)

`lib/ct/config.ts` ma własny plik konfiguracji, niezależny od `linking.json`. `mergeCtConfig` (`lib/ct/config.ts`) waliduje go zod. Listy leksykonu są dopisywane do domyślnych, chyba że `"replaceDefaultLexicon": true` (`lib/ct/config.ts`). Brak pliku daje wartości domyślne (`lib/ct/config.ts`).

| Parametr | Domyślnie | `lib/ct/config.ts` | Znaczenie |
|---|---|---|---|
| `threshold` | 0.6 | `lib/ct/config.ts` | minimalny wynik kandydata |
| `scores.template` / `templateOtherTld` | 0.9 / 0.8 | `lib/ct/config.ts` | ten sam szablon nazwy z tym samym / innym TLD |
| `scores.brand` / `media` | 0.7 / 0.65 | `lib/ct/config.ts` | marka z leksykonu / medium z leksykonu w kontekście kampanii |
| `scores.loremKit` / `loremKitOtherTld` | 0.6 / 0.5 | `lib/ct/config.ts` | ten sam generator nazw z innym słowem kotwicy |
| `scores.supportBonus` / `tokenBonus` | 0.05 / 0.05 | `lib/ct/config.ts` | szablon z ≥ 2 domen kampanii; słowo wspierające (maks. 2) |
| `minTemplateLiteralChars` / `minBrandLength` / `minCampaignTokenLength` | 3 / 5 / 4 | `lib/ct/config.ts` | |
| `lexicon.brands` | pusta | `lib/ct/config.ts` | marki wymyślone lub podrabiane przez kampanie (ustawiane na zbiór) |
| `lexicon.media` / `institutions` / `lures` | ogólne słowa PL | `lib/ct/config.ts` | media (`wiadomosci`, `fakty`, `news`…), instytucje (`gov`, `zus`, `knf`, `bank`…), przynęty (`inwest`, `zysk`, `krypto`, `zwrot`, `doplat`…) |
| `stopTokens` / `ignoreDomains` | słowa zbyt ogólne / pusta | `lib/ct/config.ts` | |

Próbka: `data/sample/ct-lexicon.json` dodaje fikcyjne marki „KryptoZysk” i „Bałtycka Energia” oraz media „fakt” i „wiadomosci”.

---

## 11. Bezpieczeństwo

| Obszar | Co jest zaimplementowane | Gdzie |
|---|---|---|
| Tylko pasywne zapytania | DNS (z łańcuchem CNAME), RDAP, crt.sh, Team Cymru (DNS TXT), jeden GET na stronę i każde przekierowanie, GET faviconu i obrazu. Test cloakingu to dwa dodatkowe zwykłe GET-y na stronę, tylko z flagą `--cloaking`. Watcher CT czyta strumień logów CT i crt.sh, a stronę pobiera tylko z `--fetch-page`. Bez skanowania portów, bez sond, bez wysyłania formularzy. | `lib/pipeline/sources.ts`, `lib/pipeline/enrich.ts`, `lib/ct/enrich.ts` |
| Schematy | tylko http(s), sprawdzane na każdym skoku; przekierowanie na `file:`/`ftp:` → `blocked` | `fetchPage.ts` |
| SSRF: literały IP | IP prywatne, loopback, link-local (z metadata 169.254.169.254), CGNAT, dokumentacyjne, multicast i zarezerwowane, w tym IPv6 i IPv4 osadzone w IPv6, blokowane przed połączeniem | `fetchPage.ts`, `ip.ts` |
| SSRF: nazwy | `localhost`, `*.local`, `*.internal` blokowane; zwykły DNS zastąpiony w gnieździe `lookup` sprawdzającym **wszystkie** zwrócone adresy, więc odpowiedź DNS-rebinding nie wejdzie między sprawdzenie a połączenie; `agent: false` wymusza nowe połączenie przez strażnika na każdym żądaniu. Te same zabezpieczenia obowiązują GET-y testu cloakingu i `--fetch-page` watchera CT | `fetchPage.ts`, `fetchPage.ts` |
| Wyjątek testowy | `unsafeAllowPrivateNetworks` wyłącza strażnika; używają go tylko testy, nie jest dostępny przez CLI ani API | `fetchPage.ts`, `fetchPage.ts` |
| Bez wykonywania JS | strona to tekst; meta refresh i `jsRedirects` wykrywane regexem, kit strony statycznym skanerem; `jsRedirects` nie są śledzone ani używane | `fetchPage.ts`, `extract.ts`, `pagekit.ts` |
| Narzędzia zewnętrzne | tesseract, whisper-cli, ffmpeg i fpcalc działają lokalnie przez `execFile` bez powłoki, z limitem czasu; modele muszą już być na dysku (nic nie jest pobierane) | `lib/media/tools.ts`, `lib/media/asr.ts` |
| Lokalny serwer CT | `certstream-server-go` w Dockerze publikuje port tylko na `127.0.0.1:8181`; `recovery` wyłączone, żeby nie pobierać historii logów od indeksu 0 | `docker-compose.yml`, `docker/certstream/config.yaml` |
| Limity | czas, bajty po dekompresji (bomba gzip), liczba przekierowań, piksele obrazu, wielkość wejścia API, limity kitu strony, limit wzbogaceń watchera na minutę | §10.3 |
| TLS | domyślnie weryfikacja certyfikatów; `FETCH_INSECURE_TLS=1` ją wyłącza | `fetchPage.ts`, `fetchPage.ts` |
| Prywatność | live nie wysyła IP niepublicznych do Team Cymru; nic nie trafia do innych usług niż wymienione i skonfigurowany LLM (streszczenia, embeddingi, opcjonalny NER) | `enrich.ts` |
| Biometria | opcjonalna i lokalna: twarze (`--faces`, zamknięta lista osób publicznych) i głos (`--speaker`, galeria 10 osób); do paczki dowodów trafia wynik dopasowania (id osoby, podobieństwo), nie wzorce biometryczne | §4.14–4.16, §15 |
| Pliki | `/api/image` serwuje tylko obrazy wewnątrz `baseDir` (ochrona przed path traversal) | `app/api/image/route.ts` |
| Dane | `.cache/` zawiera surowe HTML pobranych stron i wyniki zapytań, `data/work/` pełne wzbogacenie i archiwum HTML, `data/evidence/` paczki dowodów, `data/ct-watch.jsonl` feed; wszystkie w `.gitignore`, `.env*` też (poza `.env.example`) | `.gitignore` |
| Braki | brak uwierzytelnienia w API, limit zapytań tylko prosty, w pamięci procesu (§8.6); prompt injection w streszczeniach i NER tylko ograniczone (§7) | |

---

## 12. Testy

`bun run test`: wszystkie testy muszą przechodzić; aktualną liczbę podaje wynik polecenia. Na 22.11.2026 jest ok. 1670 przypadków testowych w 244 plikach `*.test.ts` (liczba rośnie z każdym zadaniem); zadanie i5 dodało `lib/media/face.test.ts`, `tests/faceGroup.offline.test.ts` i testy aliasów `@handle` w `lib/text/persona.test.ts`). Testy nie korzystają z sieci (`vitest.config.mts` ustawia `CACHE=off`). Wyjątek: lokalny serwer HTTP na 127.0.0.1 w `fetchPage.test.ts`. Trzy testy uruchamiają lokalne narzędzia (tesseract, fpcalc) i są pomijane, gdy narzędzi brak. Tabela poniżej opisuje pokrycie z pierwotnego zestawu (liczby w kolumnie „Testy” z 19.11.2026 są orientacyjne); nowsze pliki testów leżą obok modułów (`*.test.ts`) i w `tests/`.

| Plik | Testy | Pokrycie |
|---|---|---|
| `lib/osint/payerKind.test.ts` | 14 | rodzaje płatnika (zaślepka, bełkot, obcy alfabet, osoba, ogólna firma, równy nazwie strony, forma prawna), kolejność sprawdzania, atrybuty reklamy |
| `lib/graph/payerKindTraits.test.ts` | 9 | zaślepka bez węzła `ad_payer` (Meta i rekord biblioteki), rzadki bełkot z drugim śladem łączy, osoba z dopiskiem, obcy alfabet tylko na reklamie po polsku |
| `lib/text/companyIds.test.ts` | 21 | sumy kontrolne NIP, REGON, IBAN; etykiety i formaty; VAT, numer UK, nazwy z formą prawną; JSON-LD, markup, OCR; liniowość na patologicznym HTML |
| `lib/graph/companyIdTraits.test.ts` | 11 | `company_id` i `bank_account`: nie łączą same, łączą z drugim śladem, lista pośredników, zmyślony NIP, OCR |
| `lib/osint/shopSignals.test.ts` | 27 | sklep bez regulaminu, rabat na cały sklep i brak frazy Omnibus, chwyty (popup, ostatnie sztuki, licznik, likwidacja, krypto), metody płatności, odbiorca-osoba, termin dostawy, opinie z JSON-LD, stopka (nazwa, rok), staż, artykuł → `null`, uczciwy sklep → zero flag |
| `lib/osint/contact.test.ts` | 6 | rodzaj domeny e-mail, zestaw kontaktu, kierunkowy a miasto |
| `lib/text/postalAddress.test.ts` | 9 | adres pełny w obu kolejnościach, JSON-LD, samo miasto, skrytka, klucz odporny na zapis |
| `lib/graph/postalAddressTraits.test.ts` | 6 | `postal_address`: nie łączy sam, łączy z drugim śladem, lista wykluczeń, atrybuty materiału |
| `lib/osint/tlsSignals.test.ts` | 6 | wystawca, SAN i wildcard, wygaśnięcie (ISO i sekundy epoki), brak danych |
| `lib/osint/infraSignals.test.ts` | 6 | marka w ścieżce, platforma z generatora i markupu, hosting poza UE |
| `lib/osint/siteAttributes.test.ts` | 10 | rzadki TLD, język strony i domeny, administrator danych, strona udająca kuriera |
| `lib/graph/shopAttributes.test.ts` | 3 | atrybuty certyfikatu, marki w ścieżce i hostingu w grafie, bez linków |
| `lib/evidence/shopFacts.test.ts` | 3 | fakty sklepu w paczce i ich opis |
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
| `lib/pipeline/ingest.test.ts` | 16 | synonimy kolumn, CSV z `;` i BOM, daty, pierwszeństwo mapowania, duplikaty id, JSON/JSONL, uszkodzone wiersze JSON/JSONL pomijane z powodem (`loadRecordsLenient`) |
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

## 13. Dostosowanie do nowego zbioru

Podrozdziały 13.1–13.5 powstały **przed 21.11.2026** (pod kodem sprzed zadań z 21.11) i opisują wczytanie zbioru CSV/JSON oraz strojenie. Od 21.11.2026 zbiór w formie katalogów spraw wczytuje się przez `import-cases` albo `bun run base`, a nowe materiały ocenia `analyze-material` (§9, §9.1, §8.1).

### 13.1 Wczytanie danych

1. Obejrzyj dane: nazwy kolumn, kilka wierszy, gdzie są obrazy i wideo (URL czy pliki), czy jest kolumna etykiet, czy są kolumny z DROZD (persona, wynik deepfake).
2. Napisz `nask-mapping.json`. Pola: `id, platform, advertiser, text, imageUrl, imagePath, landingUrl, firstSeen, lastSeen, label, persona, deepfakeScore, videoPath`. `text` może być tablicą kolumn, łączonych znakiem nowej linii.
   ```json
   { "id": "ad_id", "advertiser": "page_id", "text": ["headline", "body"], "imageUrl": "image", "landingUrl": "url",
     "firstSeen": "start", "label": "campaign", "persona": "drozd_identity", "deepfakeScore": "drozd_score" }
   ```
3. `bun run ingest -- --input nask.csv --mapping nask-mapping.json --base-dir <katalog_obrazów>`. Przejrzyj `warnings` w `data/work/items.json`. Niezmapowane kolumny trafiają do `extra`. Nie są pokazywane w UI ani używane w grafie, dopóki nie dodasz ich w `link.ts` (dane węzła reklamy).
4. Etykiety: reklamy spoza kampanii muszą mieć unikalne etykiety (§6). Jeśli NASK oznacza je wspólnie, np. „0” albo „brak”, zamień je przed ingestem na `N<id>`.
5. Persony: przygotuj listę obserwowanych osób (`[{ "name": "…", "role": "…" }]`) i podaj ją przez `--personas`. Bez listy zostają persony z kolumny wejściowej i z NER (`--ner`).

### 13.2 Live czy offline

- Bazowy przebieg bez sieci: `bun run enrich -- --skip page,favicon,dns,rdap,ct,asn`. Zostają pivoty z treści (kontakty, portfele, URL/host/domena z linków, parametry kampanii z linków), reklamodawca, persony oraz podobieństwo obrazu (pliki lokalne) i tekstu. Przy `imageUrl` obrazy wymagają sieci. Dodaj wtedy `image` do `--skip` albo pobierz pliki wcześniej.
- `--offline` działa **tylko** z fixtures w formacie `data/sample/fixtures`. Narzędzia do zamiany `.cache/` na fixtures nie ma. Fixtures z katalogów spraw (zapisana strona, HAR, zrzut ekranu) buduje `import-cases` (§4.9).
- Artefaktem offline jest `data/work/enriched.json` (z archiwum HTML w `data/work/archive`). Po jednym przebiegu live (tam, gdzie wolno) `build-graph`, `evaluate`, `summarize`, `evidence` i przeglądarka nie potrzebują już sieci. Zachowaj oba.
- Cache wygasa: strony, DNS i CT po 1 dniu, RDAP i ASN po 7 dniach. Przy kolejnym `enrich` przeterminowane wpisy są pobierane od nowa. TTL zmienisz w `sources.ts`, `dns.ts`, `ct.ts`, `rdap.ts`, `asn.ts`.
- crt.sh jest wolny i zawodny: zaczynaj od `--skip ct`.
- OCR, ASR i odcisk audio uruchamiaj tylko wtedy, gdy dane zawierają kreacje z tekstem lub wideo; `--cloaking` podwaja liczbę GET-ów na stronę.

### 13.3 Strojenie pod F1 z naciskiem na recall

NASK w 2025 karał fałszywe negatywy. W klastrowaniu FN to rozbicie prawdziwej kampanii na części, widoczne w rozkładzie `bun run evaluate` i w `FN=` linii Pairwise. Kolejność działań:

| Krok | Zmiana | Ryzyko |
|---|---|---|
| 1 | `minLinkScore` 0.15 → 0.10…0.12 (`config.ts`): więcej średnich powiązań w Louvainie | scalanie przez pojedynczy średni dowód (§14) |
| 2 | `similarity.imageHamming` 10 → 12…14 (`config.ts`); w próbce różne rodziny kreacji miały odległość ≥ 15 | wspólne szablony graficzne różnych oszustów |
| 3 | `tfidfThreshold` 0.5 → 0.40…0.45 albo `--text embedding` z `embeddingThreshold` 0.82…0.84 (`config.ts`) | wspólne szablony tekstów („kity”) |
| 4 | `similarity.dom.hamming` 6 → 8…10 (`config.ts`), gdy kampanie lekko modyfikują szablon strony | gotowe szablony landingów kupowane przez różnych oszustów |
| 5 | `louvain.resolution` 1.0 → 0.7…0.9 (`config.ts`): większe społeczności | scalanie sąsiednich kampanii |
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

Wzorem są typy `endpoint`, `campaign_param` i `persona`:

1. `lib/graph/model.ts`: dopisz typ do `ENTITY_TYPES` i etykietę w `ENTITY_LABELS_PL` (`model.ts`). Nowy rodzaj krawędzi dodaj do `EdgeType` (`model.ts`).
2. `lib/graph/config.ts`: waga w `typeWeights`. TypeScript wymusi wpis, bo to `Record<EntityType, number>`.
3. `components/viewer/palette.ts`: kolor w `TYPE_COLORS` (też wymuszone przez typ).
4. `lib/graph/link.ts`: w pętli po reklamach utwórz `g.node(typ, klucz, etykieta, data)`, `g.edge(...)` i `add(id, typ, ścieżka, relacja, opis)`. Dane z reklamy obok parametrów kampanii i person (`link.ts`), dane ze strony obok kitu strony (`link.ts`).
5. Jeśli wartość pochodzi ze wzbogacenia: pole w `lib/pipeline/types.ts` (`ItemEnrichment` `types.ts` lub `PageInfo` `types.ts`) i obliczenie w `lib/pipeline/enrich.ts` (etap dla każdej reklamy, `enrich.ts`) albo w ekstraktorze w `lib/osint/`.
6. **Zniżka dla infrastruktury współdzielonej**: nowy `case` w `Discounter.discountsFor` (`weights.ts`) i lista w `lists` (§4.4). Bez tego nowy pivot może scalać niezwiązane kampanie tak jak adresy Cloudflare. Opcjonalnie etykiety pól w `DetailsPanel.tsx` (`DATA_LABELS_BY_TYPE`, `TYPE_NOTES`).
7. Test w `lib/graph/kitLink.test.ts` lub `link.test.ts` z `makeDataset` (`lib/graph/testkit.ts`), w tym trudny negatyw: dwie niezwiązane reklamy z tą samą ogólną wartością nie mogą trafić do jednej kampanii.

`/api/analyze` obsłuży nowy pivot bez zmian, bo porównuje id węzłów.

Typ, który ma tylko opisywać reklamy, a nie je łączyć (jak persona), dostaje wagę poniżej `minLinkScore` i trafia do atrybutów kampanii (`campaignAttributes`, `cluster.ts`).

### 13.5 Sygnały obrazu i deepfake'ów (DROZD)

| Sygnał | Gdzie wpiąć |
|---|---|
| wynik lub etykieta deepfake per reklama (kolumna od NASK/DROZD) | **obsłużone**: zmapuj na `deepfakeScore` (synonimy w `ingest.ts`); wynik trafia do danych węzła reklamy, atrybutu `deepfakeScoreMax` kampanii, panelu szczegółów i paczki dowodów jako wynik modelu, nie fakt |
| identyfikator lub nazwisko osoby z DROZD | **obsłużone**: zmapuj na `persona` (`ingest.ts`); persona jest atrybutem i filtrem (§4.8) |
| embedding twarzy/obrazu (np. z modelu DROZD lub CLIP) | policz w `enrich.ts` w `loadImage` (`enrich.ts`), zapisz w `ImageInfo` (`types.ts`); w `link.ts` dodaj pętlę podobieństwa wzorowaną na obrazie lub DOM (`link.ts`) z własnym progiem i wagą w `config.similarity`; analogicznie w `analyze.ts`. Uwaga: dopasowanie twarzy 1:N to przetwarzanie danych biometrycznych; starter tego nie robi |
| identyfikator klastra twarzy, modelu syntezy lub głosu | nowy typ encji (§13.4) |
| lepszy hash percepcyjny (pHash, wycinek twarzy) | `lib/media/imageHash.ts` obok `dHash`; porównanie w `link.ts` |

Wywołanie zewnętrznego systemu (DROZD) z pipeline'u to nowe wyjście danych. Sprawdź w regulaminie zadania, czy jest dozwolone. Obecnie dane trafiają tylko do zapytań pasywnych i skonfigurowanego LLM.

---

## 14. Znane ograniczenia

- **Złożoność O(n²).** Podobieństwo obrazów, tekstów, DOM i dźwięku liczy wszystkie pary (`link.ts`). Pivoty tworzą `df²/2` par, z limitem `df ≤ 400`. Przy dziesiątkach tysięcy reklam potrzebny jest indeks (BK-tree, LSH).
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
- **Przeglądarka** przekazuje cały graf jako props: 43 reklamy dają `graph.json` ok. 750 KB. Przy tysiącach reklam stanie się ciężka; trzeba będzie stronicować albo ładować graf przez API. Build produkcyjny ma dane z czasu budowania (§3.11); feed CT jest czytany na bieżąco przez API.
- **Paczka dowodów** ma WARC tylko z HAR dostarczonego przez sprawę, znacznik RFC 3161 tylko z `--tsa` (openssl i sieć), rekordy z repozytorium reklam tylko po `--ad-library`, a status Listy CERT z lokalnej kopii (§15).
- **Watcher CT** zależy od lokalnego `certstream-server-go` (publiczny CertStream nie przysyłał danych), a backfill od crt.sh, który często odrzuca lub nie kończy zapytań z `%` (§16.9).
- **Wyniki na próbce** (F1 = ARI = 1.0) dotyczą danych syntetycznych zaprojektowanych pod trudne przypadki, a progi dobrano na nich. Nie są prognozą dla danych NASK.
- **Anthropic** jest przetestowany tylko na mockach.
- **Seria rejestracji** wymaga daty `created` z RDAP. Część rejestrów (np. niektóre ccTLD) jej nie podaje.

---

## 15. Paczka dowodów

`bun run evidence -- --campaign K01` (`scripts/evidence.ts`, `lib/evidence/pack.ts`) zapisuje w `data/evidence/<kampania>/` paczkę zgodną z sekcją 5 raportu „Prawo i dowody” z notatek badawczych. Narzędzie proponuje; człowiek weryfikuje treść i decyduje o zgłoszeniu.

**Wejście:** `data/graph.json`, `data/campaigns.json`, `data/work/enriched.json` (z tego samego zbioru), opcjonalnie `data/summaries.json` i archiwum HTML z `enrich`.

**Pliki:**

| Plik | Zawartość |
|---|---|
| `evidence.json` | pełny rekord (niżej) |
| `evidence.md` | ten sam rekord czytelnie: nagłówek, streszczenie faktów, osoba, obserwacje (typy po polsku ze słownika GUI `lib/viewer/plain.ts`, kolumna „Dlaczego w kampanii”, ślady wspólne dla wielu stron osobno), analiza (tylko metody podobieństwa, które dały przesłanki), działania, pliki z opisem i SHA-256, inwentarz danych osobowych, łańcuch przechowywania; adresy rozbrojone `hxxps://…[.]…` (`pack.ts`, `readable.ts`) |
| `cert-domains.txt`, `cert-domains-uzasadnienie.md` | domeny i hosty do zgłoszenia na Listę Ostrzeżeń CERT, jedna na linię, bez platform, skracaczy i serwisów publicznych (`domainDiscount`) i bez domen już aktywnych na liście; status z lokalnej kopii (`CERT_LIST_FILE` albo `--cert-list`, `lib/evidence/certList.ts`, bez zapytań online); przy ponad 50 dodatkowo `cert-domains-<n>.txt` po 50 |
| `dsa-art16-<platforma>.md`, `dsa-art16-notice.md` | osobne zgłoszenie z art. 16 ust. 2 DSA dla każdej platformy (`dsa.ts`): kategoria (podszywanie się albo oszustwo), (a) uzasadnienie złożone z faktów (liczba reklam, oferta finansowa i wynik deepfake tylko gdy wynikają z danych, wiek domen i status CERT), (b) lokalizacja reklamy na platformie (link do biblioteki z filtrami, identyfikator, strona reklamodawcy, adres posta), potem strony docelowe per reklama bez kopii różniących się parametrami śledzenia, (c) zgłaszający, (d) oświadczenie o dobrej wierze; `dsa-art16-notice.md` to spis plików |
| `preservation-request.md`, `knf-notification.md`, `prosecutor-notification.md` | widoki tego samego rekordu (`views.ts`): zabezpieczenie danych u platform, rejestratorów i hostingu z przedziałami UTC i kategoriami danych; informacja dla KNF (tylko przy ofercie finansowej); zawiadomienie dla prokuratury z przesłankami i informacją, kto może je złożyć |
| `odbiorcy.md`, `wskazniki/*.csv` | odbiorcy z powodem (UODO tylko przy personie, KNF tylko przy ofercie finansowej, UKE po wcześniejszym zgłoszeniu) i wskaźniki per odbiorca: `rejestrator.csv` (z kontaktem abuse z RDAP), `hosting.csv`, `platforma.csv`, `platnosci.csv`, `operator.csv`; pliki bez wierszy nie powstają (`recipients.ts`) |
| `stix-bundle.json` | kampania jako STIX 2.1: `campaign`, `infrastructure`, `indicator` (domena, URL, IP, portfel, numer, identyfikator biblioteki, dHash), `identity` osoby jako cel, `note` z wynikami modeli, TLP 2.0 na każdym obiekcie, pola `x_ad_library_id` i `x_cert_register_position_id` (`stix.ts`); własny zapis JSON, bez serwera MISP |
| `files/creatives/…`, `files/media/…`, `files/screenshots/…`, `files/info/…`, `files/html/…` | kreacje (ścieżki bezwzględne z importu spraw są rozwiązywane `path.resolve`), nagrania, zrzuty i `.info.json` ze sprawy z SHA-256 z importu, archiwum HTML stron |
| `files/har/…`, `files/html-source/…`, `files/warc/….warc.gz` | HAR i zapisane strony sprawy tylko jako kopie zredagowane z danych analityka (`lib/osint/redact.ts`); w manifeście `derived_from_sha256` to suma oryginału; WARC (ISO 28500) powstaje z zredagowanego HAR (`warc.ts`) |
| `manifest.sha256` | SHA-256 każdego pliku w formacie `shasum -a 256 -c`; `manifest.tsr` przy `--tsa` (RFC 3161, `tsa.ts`) |

**Redakcja (B-261):** import spraw czyta HAR i zapisane strony przez `redactHar` i `redactPageHtml`, więc pola odwiedzającego z `window.aio.visit` (IP, lokalizacja, ASN, odcisk przeglądarki, JA3/JA4, UA, kod pocztowy), `fingerprint` w POST, ciasteczka i nagłówki analityka oraz `ip=` w linkach nie trafiają do `graph.json`, GUI, eksportu ani paczki; tokeny Mety `EA…` są zastąpione przez `EA…[sha256:<12 znaków>]` i nie są pivotem. Suma oryginału zostaje w `provenance.json`.

**Pozostałe polecenia:** `bun run recheck -- --pack <katalog>` (pasywnie: DNS, lokalna lista CERT, biblioteka reklam; dopisuje do `custody_log` stan teraz obok stanu z chwili zgłoszenia, `recheck.ts`); `--prior <plik>` (dziennik zgłoszeń JSON lines, `reports.ts`: `prior_reports`, lista „czeka na reakcję” po `REPORT_WAIT_DAYS` dniach, reklamy po pierwszym zgłoszeniu); `--tsa <url>`. Eksport z GUI i API: `POST /api/evidence` (`app/api/evidence/route.ts`, `lib/viewer/evidenceExport.ts`) zwraca ZIP także dla kampanii `N1…` z analizy materiału (pliki w `workDir/pakiet/`); nieznane id daje komunikat, nie wyjątek. TTL cache są w jednym miejscu (`CACHE_TTL`, `lib/cache.ts`) i stąd retencja w inwentarzu danych osobowych (`retention.ts`).

**Rekord `evidence.json`** (`pack.ts`):
- nagłówek: `package_id` (UUID), `version`, `created_utc`, `tool_version` (nazwa, wersja, commit git, progi linkowania), `submitter` (pola niepodane mają znacznik `[UZUPEŁNIJ: …]`), `good_faith_statement`, `tlp` (domyślnie `TLP:AMBER`), `pap`, `summary_facts`;
- `legal_assessment`: oznaczone „(wniosek)” propozycje podstaw prawnych do weryfikacji przez prawnika, bez rozstrzygania o nielegalności;
- `requested_action`: propozycje dla odbiorców D (platforma, art. 16 DSA), C (CSIRT NASK, Lista Ostrzeżeń CERT), K (KNF), U (UODO), P (prokuratura/Policja), S (Prezes UKE), E (zabezpieczenie danych) ze statusem „propozycja” (`pack.ts`);
- `impersonated_person`: imię i nazwisko, rola publiczna, podstawa wskazania (kolumna wejściowa, lista, OCR/ASR przybliżony, NER), status zgody („nieustalone”), `biometric_data: "brak…"` i wyniki deepfake z danych wejściowych opisane jako wynik modelu (`pack.ts`);
- `observations` (fakty): wspólne identyfikatory, reklamy (ID, platforma, reklamodawca, daty UTC, treść, link z łańcuchem, User-Agent i czas pobrania, parametry kampanii, pliki kreacji z SHA-256), domeny (hosty, rejestracja z RDAP, NS, MX, IP z ASN, łańcuchy CNAME, certyfikaty, strony z `body_sha256_raw` i plikiem archiwum, wynik testu cloakingu, fakty o „podstawowym celu” strony: backendy formularzy, ukryte pola, kontakty, trackery, portfele), konta reklamodawców (`pack.ts`);
- `analysis` (wyniki modeli i heurystyk, oddzielone od faktów): przypisanie do kampanii, wyniki powiązań z dowodami, metody i progi podobieństwa, użycie NER, wyniki deepfake, streszczenie LLM (`pack.ts`);
- `integrity`: manifest (kopie zredagowane z `derived_from_sha256`), `manifest_sha256`, polecenie weryfikacji, `timestamp_token` (`null` z powodem bez `--tsa`), `custody_log` (import z sumami oryginałów, wzbogacanie z czasem, trybem i User-Agent, eksport; `custody.ts`), inwentarz danych osobowych z retencją z konfiguracji, domeny wyłączone z listy CERT, ograniczenia (`pack.ts`);
- `prior_reports`, `reports_register`, `harm_and_victims` (`continuation_after_notice` z dat zgłoszeń i `firstSeen` reklam; pola szkody zostają `[UZUPEŁNIJ]`: dane od ludzi, nie z narzędzia).

Osoby nie są identyfikowane z twarzy ani głosu, a paczka nie zawiera wzorców biometrycznych. Test `tests/evidence.offline.test.ts` sprawdza m.in., że obserwacje nie zawierają wyników modeli i że każda linia manifestu się weryfikuje.

**Czego paczka nie robi:** nie archiwizuje stron sama (WARC tylko z HAR ze sprawy; strony z cloakingiem nie są pobierane „z profilu ofiary”), a zrzuty ekranu są tylko te ze sprawy; znacznik RFC 3161 powstaje tylko z `--tsa` i nie ma mocy kwalifikowanej bez dostawcy kwalifikowanego (art. 41 eIDAS); rekordy z biblioteki reklam (art. 39 DSA) są tylko dla reklam wzbogaconych `--ad-library`; status CERT pochodzi z lokalnej kopii listy, która może być nieaktualna; nie koreluje się z DSA Transparency Database (B-273); wyniki twarzy i głosu (I5, I15) nie trafiają do paczki dowodów: są w `ItemEnrichment` (`faces`, `voices`) i w wyniku analizy, ale `lib/evidence` jeszcze ich nie czyta (B-264 otwarte). Czas zapytania RDAP nie jest zapisywany przez `enrich`. Te kroki trzeba wykonać przed zgłoszeniem.

---

## 16. Watcher Certificate Transparency (wczesne ostrzeganie)

Kampanie rotują domeny, a nowa domena zwykle dostaje certyfikat TLS, zanim ruszy reklama. Watcher porównuje nazwy z nowych certyfikatów z „odciskami kampanii” zbudowanymi z `campaigns.json` i zapisuje dopasowania jako kandydatów przypiętych do najbliższej kampanii.

### 16.1 Odciski kampanii (`lib/ct/fingerprint.ts`)

`buildFingerprints` (`fingerprint.ts`) bierze kampanie z ≥ 2 reklamami i ich domeny bez platform, skracaczy i serwisów publicznych (`isExcludedDomain` z `domainDiscount`, `scripts/_ct.ts`). Dla każdej kampanii:
- szablony nazw domen z wariantem z TLD i bez (`domainTemplate`, §4.7), gdy rdzeń ma ≥ 3 litery;
- szkielet generatora nazw: szablon z literalnymi słowami zamienionymi na `<w>` (`templateSkeleton`, `fingerprint.ts`), np. `<w><n>-<lorem><n>.sbs`;
- marki z leksykonu znalezione w domenach kampanii albo, z polską odmianą, w treściach reklam i nazwach reklamodawców (`brandInText`, `fingerprint.ts`);
- media z leksykonu obecne w domenach kampanii;
- słowa domen używane tylko przez tę kampanię (`fingerprint.ts`).

### 16.2 Dopasowanie (`matchDomain`, `fingerprint.ts`)

Nazwa z certyfikatu jest sprowadzana do domeny rejestrowalnej (`*.`, subdomeny i kropka końcowa znikają, `fingerprint.ts`). Domeny już należące do kampanii i z `ignoreDomains` są pomijane. Kandydat **zawsze wymaga wzorca**; pojedyncze popularne słowo nigdy nie wystarcza (`scoreCampaign`, `fingerprint.ts`):

| Rodzaj | Warunek | Wynik |
|---|---|---|
| `template` | ten sam szablon co domena kampanii, ten sam TLD | 0.9 (+0.05, gdy szablon ma ≥ 2 domeny kampanii) |
| `template_other_tld` | ten sam szablon, inny TLD | 0.8 (+0.05) |
| `brand` | marka z leksykonu używana przez kampanię i kontekst: reszta nazwy to cyfry i słowa z domen kampanii, słowo wyłączne kampanii albo ten sam TLD (`fingerprint.ts`) | 0.7 |
| `media` | medium z leksykonu obecne w domenach kampanii **i** słowo wyłączne tej kampanii (`fingerprint.ts`) | 0.65 |
| `lorem_kit` | ten sam szkielet generatora z innym słowem kotwicy (szablon z `<lorem>` i `<n>`) | 0.6 na tym samym TLD, 0.5 na innym |

Słowa z leksykonu (przynęty, instytucje, media) i słowa kampanii dodają po 0.05 (maks. dwa) i trafiają do uzasadnienia, ale same niczego nie dopasowują (`fingerprint.ts`). Wynik ≥ `threshold` (0.6) to kandydat; przy kilku kampaniach wygrywa wyższy wynik, potem silniejszy rodzaj, więcej domen za wzorcem i większa kampania (`isBetter`, `fingerprint.ts`).

Przykłady z testów (`lib/ct/fingerprint.test.ts`, kampania z `finance12-dolorem51.sbs` i `finance88-quia40.sbs`): `finance23-voluptas94.sbs` → `template`, 0,95; `finance23-voluptas94.pro` → `template_other_tld`, 0,85. Bez dopasowania: `finance.sbs`, `finance23.sbs`, `finance-news.pro`, `yahoo-finance.com`, `personal-finance23.pro`, `finance23-news94.sbs`, `voluptas94.pro`, `lorem-ipsum.com`, `dolorem-ipsum.sbs`, `financeplus-voluptas.pro` i `finance23-voluptas94.sbs.evil.example`.

### 16.3 Źródła strumienia (`lib/ct/stream.ts`)

- Klient protokołu CertStream przez WebSocket (`runCtStream`, `stream.ts`) czyta wiadomości `certificate_update` (strumień pełny i „lite”) oraz `dns_entries` (tylko domeny); heartbeat i nieznane typy są pomijane (`parseCertstreamMessage`, `stream.ts`). Wysyła tylko pingi WebSocket, których wymaga certstream-server-go (`stream.ts`).
- Kolejność prób: `CT_STREAM_URL` albo `--url`, domyślnie lokalny `ws://127.0.0.1:8181/`, potem publiczny `wss://certstream.calidog.io/` (`scripts/ct-watch.ts`).
- Strumień jest niedostępny, gdy połączenie nie powstanie w 10 s albo po otwarciu przez 20 s nie przyjdą dane; działający strumień, który ucichnie na 60 s, jest łączony ponownie, z backoffem do 30 s i maks. 20 razy (`stream.ts`). Gdy żaden URL nie da danych, wynik ma status `unavailable` (bez wyjątku), CLI wypisuje próby, podpowiada uruchomienie serwera, backfill albo demo i kończy się kodem 2.
- **Lokalny serwer:** `docker compose --profile ct up -d certstream` uruchamia `0rickyy0/certstream-server-go:v1.10.1` (obraz dla `linux/arm64` i `linux/amd64`) z portem tylko na `127.0.0.1:8181` (`docker-compose.yml`). Konfiguracja `docker/certstream/config.yaml`: pusta biała lista klientów (port i tak jest lokalny), bez Prometheusa, `recovery.enabled: false`, żeby serwer nie pobierał logów od indeksu 0 (`docker/certstream/config.yaml`). Serwer potrzebuje wyjścia do internetu (lista logów Google i same logi CT).
- **Demo offline:** `bun run ct:watch -- --replay data/sample/ct-stream.jsonl` odtwarza zapisane wiadomości (`replayCertstream`, `stream.ts`) bez sieci; wzbogacenie korzysta wtedy z fixtures (`scripts/ct-watch.ts`).

### 16.4 Backfill z crt.sh

`bun run ct:backfill` (`scripts/ct-backfill.ts`, `runBackfill` w `lib/ct/watch.ts`) pyta crt.sh o wzorce (`searchCt`, §3.1, wspólne ponowienia i cache, przestrzeń `ct-search` z TTL 1 h), bierze certyfikaty z ostatnich `--since` dni (data wpisu albo `notBefore`) i przepuszcza ich nazwy przez ten sam watcher. Bez `--pattern` wzorce powstają z rdzeni szablonów kampanii, np. `zwrot<n>-<lorem><n>.example` → `zwrot%` (`backfillPatterns`, `fingerprint.ts`), bo crt.sh nie przyjmuje `%` w środku wzorca; TLD i resztę szablonu sprawdza lokalnie matcher. Wzorzec bez odpowiedzi ma status `unavailable`, a błędny `error`; pozostałe wzorce są przetwarzane dalej.

### 16.5 Po dopasowaniu (`lib/ct/watch.ts`, `lib/ct/enrich.ts`)

`CtWatcher.handle` (`watch.ts`) grupuje nazwy certyfikatu po domenie rejestrowalnej, każdą domenę sprawdza raz (zbiór sprawdzonych do 500 000 wpisów, `watch.ts`) i zgłasza raz; domeny już obecne w feedzie są pomijane po restarcie (`watch.ts`). Dopasowanie jest synchroniczne, a wzbogacenie i zapis biegną w tle, po dwa naraz.

Wzbogacenie jest wyłącznie pasywne (`enrichCandidate`, `lib/ct/enrich.ts`): DNS A/AAAA/CNAME/NS/MX domeny, A/CNAME do dwóch dodatkowych hostów z certyfikatu, RDAP i historia z crt.sh. **Strona nie jest pobierana**, chyba że podasz `--fetch-page`; wtedy jest to jeden GET `https://<domena>/` przez pobieracz z ochroną SSRF (`lib/ct/enrich.ts`). Domyślnie maks. 30 wzbogaceń na minutę; ponad limit kandydat jest zapisywany bez wzbogacenia z polem `skipped` (`watch.ts`). `--no-enrich` wyłącza wzbogacenie.

### 16.6 Feed (`lib/ct/feed.ts`)

`data/ct-watch.jsonl` (albo `CT_FEED_FILE`) to plik tylko do dopisywania: jeden obiekt JSON na linię, nigdy nie przepisywany (`appendFeed`, `feed.ts`). Rekord `CtFeedRecord` (`feed.ts`):
- `v`, `type: "ct_candidate"`, `observed_utc`, `source` (`certstream` / `crtsh-backfill` / `replay`), `stream` (URL, wzorce albo plik);
- `domain`, `names` (nazwy z certyfikatu pod tą domeną);
- `cert`: `issuer`, `not_before`, `not_after`, `fingerprint`, `serial`, `log`, `log_url`, `cert_index`, `crtsh_id`, `seen_utc`;
- `candidate`: `campaign_id`, `campaign_label`, `score`, `kind`, `template`, `similar_domains`, `tokens`, `evidence` (tekst PL);
- `enrichment`: `dns`, `hosts`, `rdap`, `ct`, `page` (tylko z `--fetch-page`), `errors`, `skipped`;
- `status: "candidate"` i `note`: „kandydat do weryfikacji przez człowieka: dopasowanie nazwy domeny do odcisku kampanii, nie dowód” (`watch.ts`).

`readFeedTail` (`feed.ts`) czyta tylko koniec pliku (domyślnie 4 MiB), odrzuca niepełną pierwszą linię i uszkodzone wpisy.

### 16.7 Panel w przeglądarce

Zakładka „Nowe domeny” (`components/viewer/CtFeedPanel.tsx`) co 15 s czyta `/api/ct-feed` (`CtFeedPanel.tsx`, §8.5) i pokazuje kandydatów od najnowszych: domenę, przycisk kampanii (zaznacza ją w grafie), wynik, rodzaj dopasowania, uzasadnienie, dane certyfikatu, DNS i RDAP. Przy pustym lub brakującym feedzie pokazuje polecenia uruchomienia watchera, backfillu i demo (`CtFeedPanel.tsx`). Liczba kandydatów jest na zakładce, a `?panel=ct` otwiera ją od razu.

### 16.8 Stałe

| Stała | Wartość | Miejsce |
|---|---|---|
| połączenie / pierwsza wiadomość / cisza / ping / ponowne połączenia | 10 s / 20 s / 60 s / 30 s / 20 | `lib/ct/stream.ts` |
| wzbogacenia na minutę / współbieżność | 30 / 2 | `lib/ct/watch.ts`,  |
| zbiór sprawdzonych domen | 500 000 | `lib/ct/watch.ts` |
| odczyt końca feedu | 4 MiB | `lib/ct/feed.ts` |
| backfill: okno / ponowienia crt.sh | 7 dni / 2 | `scripts/ct-backfill.ts`,  |

### 16.9 Pomiary watchera CT z jednej maszyny (19.11.2026)

- Lokalny `certstream-server-go` v1.10.1 w Dockerze (arm64) działał: `ct:watch` odebrał 224 963 wiadomości w 75 s i sprawdził 33 602 nowe domeny rejestrowalne. Z odciskami próbki i testowym odciskiem `finance<n>-<lorem><n>.*` nie było kandydatów, czego należało się spodziewać przy fikcyjnych domenach i krótkim oknie.
- Sonda z odciskiem `bbcsports<n>.ph` (rodzina szablonowych domen zauważona w strumieniu) dała 22 kandydatów w 50 s; pierwszych pięciu wzbogaconych (wspólny adres A, brak RDAP dla `.ph`), reszta zapisana bez wzbogacenia z powodu limitu ustawionego na 5 na minutę.
- Publiczny CertStream (`wss://certstream.calidog.io/`) przyjął połączenie WebSocket, ale nie przysłał żadnych danych w 12–20 s; watcher traktuje go jako niedostępny.
- crt.sh: wzorzec z `%` w środku (`bbcsports%.ph`) zwrócił stronę „Unsupported use of '%'”, a wzorzec prefiksowy (`bbcsports%`) odpowiedź 502 po ok. 80 s. Backfill jest więc „best effort”; zapytania o pojedyncze domeny działały (ok. 20 s).
- Demo offline (`--replay data/sample/ct-stream.jsonl`): 17 wiadomości, 5 kandydatów (`zwrot51-dolores33.invalid` i `zwrot64-quia17.example` z szablonu C4, `kryptozysk-ai24.test` z marki C1, `fakt-dnia-24.example` z medium C3, `pomoc77-dolorem12.example` z generatora nazw C4); łagodne sobowtóry, domeny znane i powtórzone zostały pominięte.

### 16.10 Potwierdzenie kandydata, leksykon i backtesty (22.11.2026)

**Potwierdzenie kandydata CT** (`lib/ct/confirm.ts`, stałe `CT_CONFIRM_CONFIG` w `lib/ct/config.ts`): `buildCampaignInfra` wylicza z bazy cechy trzymane przez jedną kampanię (para NS, rejestrator, adres IP, skrót treści strony) i okno godzin rejestracji jej domen (od dwóch domen, rozrzut ≤ 6 h); `confirmCandidate` zwraca potwierdzenia, a `CtWatcher` ustawia `status: "confirmed"` przy co najmniej dwóch rodzajach. Tytuł strony nie jest potwierdzeniem.

**Leksykon watchera CT** (B-245). `data/ct/lexicon-pl.json`: leksykon startowy (marki z raportu CERT, media z domenami oficjalnymi w `ignoreDomains`, `minBrandLength: 3`, odnośniki do źródeł w `_sources`; wskazują strony główne instytucji, konkretne wpisy do uzupełnienia); `bun run ct:watch -- --lexicon data/ct/lexicon-pl.json`. `bun run base` zapisuje `<baza>/ct-lexicon.json` (`lib/ct/lexiconFromBase.ts`: podrabiane marki i nazwy landerów z rekordów, krok `ct-lexicon`), a `scripts/_ct.ts` (watch, ct:watch, ct:backfill) czyta go, gdy leży obok `campaigns.json` i nie podano `--lexicon`. Słowa wyłączne domen kampanii to `tokens` odcisków (`lib/ct/fingerprint.ts`), nie wchodzą do pliku.

**Backtesty CT** (B-241, `lib/ct/backtest.ts`, `scripts/backtest-ct.ts`). Tryb `lead`: wyprzedzenie certyfikatu względem wpisu na Liście CERT (czas pojawienia: wpis w logu, a bez niego `not_before` + 1 h; ponowienia zapytań crt.sh: `withRetry`). Tryb `fingerprints`: odciski z kampanii znanych do dnia D (`campaignsKnownBefore`: rekordy z `firstSeen` ≤ D), dopasowanie `matchDomain` do certyfikatów po D i recall przy budżecie alertów (`BACKTEST_CONFIG.alertBudgets`). Testy na wymyślonych fragmentach logu (`lib/ct/backtest.test.ts`); pomiaru na prawdziwych danych nie wykonano.

## 17. Treści przeniesione z README (21.11.2026, zadanie i8)

Poniższe sekcje stały w README do 21.11.2026. README opisuje teraz uruchomienie i metodykę dla osoby oceniającej ([README.md](../README.md), [METODYKA.md](METODYKA.md), [LICENCJE.md](../LICENCJE.md)), a opisy techniczne są tutaj bez zmian treści. Stan na dzień przeniesienia; część liczb (np. liczba testów, wersje narzędzi) mogła się zmienić, aktualne są w kodzie i w `LICENCJE.md`.

### 17.1 Opis techniczny

Dla każdej reklamy narzędzie zbiera ślady cyfrowe: link docelowy z pełnym łańcuchem przekierowań, hosty z łańcuchem CNAME, domeny, adresy IP i ASN, serwery NS, rejestratora z RDAP, certyfikaty z logów CT, identyfikatory trackerów, favicon, kontakty, portfele krypto, hash obrazu i treść. Ze strony docelowej bierze odcisk „kitu” (backend formularza, ukryte pola, własne pliki JS/CSS, komentarze w kodzie, struktura DOM), a z linków parametry kampanii (UTM, sub1–5, identyfikatory kliknięć i ofert). Dochodzą wzorce nazw domen i persona, czyli osoba, pod którą podszywa się reklama, rozpoznana z tekstu. Potem buduje z tego graf dowodów i wyznacza kampanie. Każde powiązanie ma opis „dlaczego połączone” i wagę. Wyniki można przejrzeć w przeglądarce (lista kampanii, graf Cytoscape, porównanie dwóch reklam), zmierzyć na etykietach (pairwise/B-cubed F1, ARI) i wyeksportować jako paczkę dowodów kampanii. Watcher Certificate Transparency dopasowuje nowe domeny z certyfikatów TLS do znanych kampanii, zanim ruszy reklama.


### 17.2 Dane przykładowe i testowe

Dane w `data/sample/` są w całości **syntetyczne**: fikcyjne osoby („Adam Testowy”, „Ewa Przykładowa”…), fikcyjne marki, zarezerwowane domeny `.example`/`.test`/`.invalid`, adresy IP z zakresów dokumentacyjnych (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24), prywatne numery ASN (6450x), brytyjskie numery telefonów z puli Ofcom przeznaczonej do fikcji (+44 7700 900xxx), losowe adresy portfeli z poprawną sumą kontrolną, dżingle WAV generowane w kodzie (muzyka, bez mowy) oraz fikcyjny urząd certyfikacji i log CT w pliku demo watchera. Prawdziwe są tylko identyfikatory publicznej infrastruktury potrzebne w trudnych przypadkach: zakresy anycast Cloudflare, AS13335, serwery `*.ns.cloudflare.com`, NS ParkingCrew, nazwy popularnych rejestratorów i urzędów certyfikacji, cel CNAME Fastly, host publicznego serwisu formularzy web3forms i User-Agent crawlera Meta. Poza próbką: testy dopasowania person (`lib/text/persona.test.ts`, `lib/graph/fictionalExpertLink.test.ts`) używają nazwisk osób publicznych wyłącznie jako ciągów znaków (m.in. przypadek błędu transkrypcji ASR); to nie są dane organizatora, a testy wzorców nazw domen używają przykładu `finance23-voluptas94.sbs` z publicznego komunikatu CSIRT KNF. Wartości w testach dodanych 20–21.11 też są syntetyczne: domeny `.example`/`.test` i poddomeny `example.com`, wymyślone UUID-y i identyfikatory reklam, identyfikatory kliknięć wygenerowane z fikcyjnego czasu, maszyny i procesu, fikcyjne tytuły i nazwy.

### 17.3 Architektura

Pipeline ma cztery kroki, a każdy zapisuje JSON, który można obejrzeć. `ingest` zamienia CSV/JSON z dowolnymi nazwami kolumn na znormalizowane `Item` (także kolumny w stylu DROZD: persona, wynik deepfake, plik wideo). `enrich` wykonuje wyłącznie pasywne zapytania (jeden GET na stronę/przekierowanie z ochroną SSRF, DNS z łańcuchem CNAME, RDAP, crt.sh, Team Cymru), z plikowym cache, limitem współbieżności i trybem offline z nagranych odpowiedzi. Opcjonalnie dopasowuje listę person, uruchamia NER przez LLM, OCR, ASR, odcisk audio i test cloakingu. `build-graph` z każdej reklamy wyprowadza „pivoty” (encje osiągalne ze ścieżką dowodu) i waży je czynnikami: priorytetem typu (np. backend formularza > tracker > IP > ASN), listami infrastruktury współdzielonej (Cloudflare i inne CDN, masowi dostawcy DNS, darmowe CA, popularni rejestratorzy, platformy i skracacze, publiczne serwisy formularzy i analityki, popularne biblioteki JS, strony parkingowe), odwrotną częstością i karą za powszechność. Dochodzi do tego podobieństwo obrazów (dHash, opcjonalnie CLIP dla wariantów tego samego szablonu), treści (TF-IDF albo embeddingi bge-m3), struktury strony (simhash DOM) i dźwięku (Chromaprint). Silne dowody łączy union-find, a resztę grupuje Louvain na grafie ważonym. Zdyskontowana infrastruktura, np. wspólne IP Cloudflare, nie trafia nawet do grafu klastrowania. Persona, cyrylica, podejrzenie cloakingu i wynik deepfake są atrybutami kampanii do filtrowania, a nie dowodami łączącymi. `evaluate` porównuje wynik z etykietami. Przeglądarka (Next.js) czyta tylko `data/graph.json` i `data/campaigns.json` (oraz feed CT przez API), więc buduje się i działa bez Ollamy i bez sieci.

```
data/*.csv|json ──ingest──► items.json ──enrich──► enriched.json ──build-graph──► graph.json + campaigns.json ──► viewer / evaluate / summarize / evidence
                              (live: DNS, RDAP, CT, ASN, 1×GET │ offline: data/sample/fixtures)
CT (certstream-server-go │ crt.sh) ──ct:watch / ct:backfill──► data/ct-watch.jsonl ──► viewer („Nowe domeny”)
```

### 17.4 Szybki start (dane przykładowe, offline)

Wymagania: bun ≥ 1.4, Node ≥ 20.

```bash
bun install
bun run pipeline --offline   # ingest → enrich z fixtures → graf → kampanie → ewaluacja
bun run evaluate             # metryki względem kolumny z etykietami
bun run dev                  # http://localhost:3000
```

Na danych przykładowych `bun run evaluate` daje pairwise F1 = B-cubed F1 = ARI = 1.0. **Te dane zaprojektowałem sam, więc wynik pokazuje, że pipeline działa od początku do końca, a nie jak dobrze zadziała na prawdziwych danych.** Trudne przypadki w próbce:
- kampanie K01, K02 i dwie niezwiązane reklamy stoją za tymi samymi adresami anycast Cloudflare i tymi samymi NS Cloudflare; nie łączą się, bo IP ma wagę 0.006 zamiast 0.6,
- dwie zaparkowane domeny mają wspólny tracker, favicon i IP dostawcy parkingu,
- reklama bez linku (c2-08) dołącza do kampanii tylko przez prawie identyczną kreację i podobny tekst,
- rotacja domen (K04) i serwisy połączone tylko średnimi dowodami (wspólny certyfikat SAN, IP, NS, seria rejestracji, wzorzec nazw `zwrot<n>-<lorem><n>` w dwóch TLD),
- każdy nowy pivot ma trudny negatyw: publiczny serwis formularzy (web3forms) u K05 i dwóch niezwiązanych reklam, CNAME do Fastly u K05 i niezwiązanej reklamy, jQuery i `style.css`, `utm_source=facebook`, ogólna ścieżka `/api/lead` oraz persona K01 wymieniona w niezwiązanej reklamie; żaden nie scala kampanii.

Bez wpisu o fikcyjnym skracaczu w `data/sample/linking.json` F1 spada do 0.977: niezwiązana reklama korzystająca z tego samego skracacza trafia do K05. Dlatego listy są konfigurowalne.

Linki do konkretnego przypadku (na demo): `http://localhost:3000/?k=K02&n=item:c2-08`, `http://localhost:3000/?n=ip:104.21.32.15`, porównanie `?a=c1-01&b=c1-04` (wspólny backend formularza) i `?a=c5-01&b=n-01` (dlaczego web3forms nie łączy), filtr persony `?p=adam-testowy`, nowe domeny z watchera CT `?panel=ct`.

### 17.5 Tryb live (prawdziwe dane)

```bash
bun run pipeline -- --input dane.csv --mapping mapping.json
# albo krok po kroku:
bun run ingest -- --input dane.csv --mapping mapping.json
bun run enrich -- --concurrency 4 --skip ct     # crt.sh jest wolny; bez --skip ct też działa (cache)
bun run build-graph -- --text embedding           # bge-m3 przez Ollamę; domyślnie tfidf
bun run evaluate
```

Formaty wejścia: `.csv` (separator `,` `;` tab lub `|` wykrywany automatycznie, BOM), `.tsv`, `.json` (tablica albo obiekt z `items`/`data`/`ads`/`records`), `.jsonl`. Mapowanie (`mapping.json`) wskazuje, która kolumna to które pole. Bez mapowania kolumny są rozpoznawane po synonimach PL/EN (np. `tresc`, `ad_creative_body`, `page_name`, `ad_delivery_start_time`, `wynik_deepfake`).

```json
{ "id": "ad_id", "platform": "platforma", "advertiser": "reklamodawca", "text": ["tytul", "tresc"],
  "imageUrl": "obraz", "landingUrl": "link", "firstSeen": "od", "lastSeen": "do", "label": "kampania",
  "persona": "osoba_drozd", "deepfakeScore": "wynik_deepfake", "videoPath": "wideo" }
```

`imageUrl` może być adresem http(s) albo ścieżką do pliku względną wobec katalogu danych. Daty: ISO, `dd.mm.rrrr [hh:mm]`, epoch s/ms. Wynik deepfake: `0,91`, `0.91`, `91` albo `91%`. Kolumna `label` jest opcjonalna i służy tylko do ewaluacji.

Wszystkie zapytania sieciowe są pasywne: DNS (A/AAAA/CNAME/NS/MX/TXT), RDAP przez rdap.org, crt.sh, Team Cymru przez DNS TXT i jeden GET na stronę oraz każde przekierowanie (ręcznie śledzone, maks. 8, z meta refresh). JavaScriptu nie wykonujemy: adresy przekierowań JS i backendy formularzy są wyciągane statycznie. Nie ma skanowania ani sondowania portów. Wyniki trafiają do `.cache/` (TTL: strony 1 dzień, DNS 1 dzień, RDAP/ASN 7 dni, CT 1 dzień), a zdekodowany HTML stron do `data/work/archive/`.

#### Sprawy z plików: zapisana strona, HAR, zrzut ekranu

Gdy dane przychodzą jako katalog na sprawę (strona zapisana z przeglądarki z folderem `<nazwa>_files`, plik HAR, zrzut ekranu reklamy; dowolny podzbiór), `import-cases` zamienia je na wejście i fixtures trybu offline. Stron docelowych nie pobiera: treść bierze z HAR (surowa odpowiedź serwera) albo z zapisanej strony, adresy IP z HAR.

```bash
bun run import-cases -- --cases sprawy/ --out praca/ --lookups   # --lookups: pasywne DNS, RDAP i ASN dla domen; --ct: także crt.sh
bun run ingest -- --input praca/input.json --mapping praca/mapping.json --out praca/items.json --base-dir praca
bun run enrich -- --items praca/items.json --out praca/enriched.json --offline --fixtures praca/fixtures --archive praca/archive --ocr --clip
bun run build-graph -- --enriched praca/enriched.json --graph praca/graph.json --campaigns praca/campaigns.json
```

Importer radzi sobie też z nieuporządkowanymi sprawami: zapisy w podkatalogach (paczka `dom.html` + `page.har` + `page.mhtml` + `manifest.json` jest scalana z ręczną kopią tej samej strony), kilka różnych stron jednej sprawy (osobne rekordy `<sprawa>_<podkatalog>`), ten sam adres zapisany z różną treścią (klucz `#capture=<id>`, typowe dla cloakingu), strona zapisana z dysku bez adresu (host z pozostałych zapisów sprawy), HAR włożony do katalogu innej sprawy, sprawa bez strony (wideo reklamy i opis `.info.json` z yt-dlp, z którego idą reklamodawca i identyfikator biblioteki reklam), wiele zrzutów (pierwszy to kreacja, pozostałe czyta OCR) i nagrania ekranu (ASR, odcisk audio, CLIP). Ścieżki mediów w `input.json` są bezwzględne. Szczegóły i przypadki brzegowe: `lib/pipeline/caseImport.ts`.

Zrzut ekranu reklamy trafia do pipeline'u jako kreacja. Z tekstu OCR znikają etykiety interfejsu („Sponsorowane”, „Dowiedz się więcej”, panele biblioteki reklam), a „Identyfikator biblioteki” staje się parametrem `ad_library_id` z linkiem do biblioteki reklam. Zrzut widoku biblioteki reklam to głównie interfejs, więc jego obraz nie jest porównywany z innymi. `import-cases` wypisuje domeny, dla których RDAP albo crt.sh nie odpowiedziały; ponowne uruchomienie pobiera tylko brakujące.

#### Opcjonalne kroki wzbogacania

Domyślnie wyłączone, włączane flagami `enrich` i `pipeline`:

```bash
bun run enrich -- --personas lista.json   # lista obserwowanych osób (z próbką: data/sample/personas.json)
bun run enrich -- --ner                   # nazwiska z tekstu przez skonfigurowany LLM
bun run enrich -- --cloaking              # dwa zwykłe GET-y: UA crawlera platformy i przeglądarki mobilnej
bun run enrich -- --ocr --asr --audio     # tesseract (pol), whisper-cli (+ffmpeg), fpcalc
bun run enrich -- --faces                  # twarze: podobna twarz do osoby z zamkniętej listy osób (OpenCV, scripts/py/setup-face.sh)
bun run enrich -- --speaker --ad-library  # głos mówcy (SpeechBrain, scripts/py/setup-speaker.sh), biblioteka reklam Mety (MetaAdsCollector)
bun run enrich -- --clip                  # embeddingi obrazów CLIP (lokalnie, ONNX)
bun run media:smoke                       # test adapterów na syntetycznym wejściu
```

OCR, ASR i odcisk audio działają tylko z zainstalowanymi narzędziami. Brak narzędzia jest wykrywany i krok jest cicho pomijany, więc build pozostaje przenośny. Model whispera wskazuje `WHISPER_MODEL` (domyślnie `~/models/whisper/ggml-large-v3-turbo.bin`); nic nie jest pobierane automatycznie. `--clip` liczy lokalnie embedding kreacji modelem CLIP ViT-B/32 (`CLIP_MODEL`, domyślnie `Xenova/clip-vit-base-patch32`, ok. 350 MB, pobierany raz przy pierwszym użyciu, potem działa offline). Dla wideo (`videoPath`) bierze 8 klatek równo rozłożonych w środku filmu (10–90% długości, bez intro i outro; potrzebne ffmpeg i ffprobe) i uśrednia ich embeddingi. Obraz i wideo są w tej samej przestrzeni CLIP, więc da się je porównywać między sobą. Daje krawędź `similar_image_semantic` dla par, których dHash nie uznał za duplikaty: inny kadr, tło albo twarz w tym samym szablonie. Próg i wagę ustawia `similarity.imageSemantic` (domyślnie cosinus ≥ 0,9, waga 0,45); na prawdziwych danych trzeba je dostroić. Persona pochodzi tylko z tekstu i danych wejściowych, bez biometrii; tekst z OCR i ASR jest dopasowywany w trybie tolerującym błędy transkrypcji.

#### Instalacja narzędzi opcjonalnych (macOS)

Rdzeń (graf, kampanie, przeglądarka) potrzebuje tylko bun. Poniższe narzędzia włączają kroki z flag `--ocr`, `--asr`, `--audio`, `--clip`, `--speaker` i `--ad-library`. Każde instaluje się osobno, a brak któregoś tylko wyłącza jego krok.

```bash
# OCR, ASR, odcisk audio, klatki wideo
brew install tesseract tesseract-lang ffmpeg chromaprint whisper.cpp
mkdir -p ~/models/whisper
# model ASR (ok. 1,5 GB): ggml-large-v3-turbo.bin z repozytorium modeli whisper.cpp na Hugging Face,
# np. skryptem models/download-ggml-model.sh large-v3-turbo z repozytorium whisper.cpp, zapisany do ~/models/whisper/

# LLM i embeddingi tekstu (tylko summarize, --ner, --text embedding)
brew install ollama && ollama serve &
ollama pull hf.co/mradermacher/PLLuM-12B-instruct-2512-GGUF:Q5_K_M
ollama pull bge-m3

# adaptery w Pythonie: głos mówcy (--speaker), twarze (bash scripts/py/setup-face.sh, --faces) i Biblioteka Reklam Mety (--ad-library); wymagają uv
bash scripts/py/setup-speaker.sh

bun run media:smoke   # sprawdza, które adaptery są dostępne
```

`scripts/py/setup-speaker.sh` tworzy w katalogu repozytorium środowisko `.venv-speaker` (Python 3.12: speechbrain, torch, torchaudio, soundfile), pobiera raz model `speechbrain/spkrec-ecapa-voxceleb` (ok. 85 MB) do `SPEAKER_MODEL_DIR` i instaluje `meta-ads-collector` przez `uv tool install`. Inne położenie interpretera albo modelu wskazują `SPEAKER_PYTHON`, `SPEAKER_MODEL_DIR` i `META_ADS_PYTHON`. Krok `--speaker` potrzebuje też ffmpeg (konwersja do WAV 16 kHz mono).

Sieć jest potrzebna tylko przy instalacji: modele CLIP, ECAPA, whisper i modele Ollamy pobiera się raz, potem wszystkie działają offline. Wyjątkiem jest `--ad-library`, który przy każdym użyciu odpytuje Bibliotekę Reklam Mety.

#### Konfiguracja wag i list

Domyślne wartości są w `lib/graph/config.ts`. Nadpisanie podajesz plikiem JSON (`--config plik.json`): reguły list są dopisywane do domyślnych, a pozostałe pola zastępowane. Przykład w `data/sample/linking.json`:

```json
{ "minLinkScore": 0.15, "similarity": { "imageHamming": 10 },
  "lists": { "domains": [{ "match": "krotki.test", "factor": 0, "reason": "skracacz linków" }],
             "pivots":  [{ "match": "tracker:ga4:G-XXXXXXXXXX", "factor": 0.05, "reason": "tracker szablonu" }] } }
```


### 17.6 Biblioteki, modele i źródła danych

Narzędzia zewnętrzne są opcjonalne, uruchamiane jako osobne procesy (albo kontener) i nie są dołączone do repozytorium ani do obrazu aplikacji.

| Składnik | Wersja | Licencja | Do czego |
|---|---|---|---|
| Next.js | 16.4.6 | MIT | aplikacja, API |
| React / React DOM | 19.3.0 | MIT | UI |
| TypeScript | 5.9 | Apache-2.0 | typy (strict) |
| Tailwind CSS | 4.3 | MIT | style |
| ESLint, eslint-config-next | 9 / 16.4.6 | MIT | lint |
| zod | 4.6.7 | MIT | walidacja, schematy structured output |
| graphology, graphology-communities-louvain, graphology-types | 0.26.0 / 2.0.2 / 0.24.8 | MIT | graf, Louvain |
| cytoscape, cytoscape-fcose | 3.35.0 / 2.2.0 | MIT | wizualizacja grafu |
| tldts | 7.5.4 | MIT (dane Public Suffix List: MPL-2.0) | domena rejestrowalna (eTLD+1) |
| libphonenumber-js | 1.13.17 | MIT | rodzaj i kraj numeru telefonu z metadanych `max`, bez sieci (§4.21) |
| sharp | 0.35.5 | Apache-2.0 (binaria libvips: LGPL-3.0-or-later) | dHash/aHash, favicon |
| p-limit | 7.3.3 | MIT | limit współbieżności |
| @huggingface/transformers | 3.7.6 | Apache-2.0 | opcjonalne embeddingi CLIP (ONNX Runtime) |
| CLIP ViT-B/32 (`Xenova/clip-vit-base-patch32`) | – | MIT (OpenAI CLIP) | model, pobierany przy pierwszym `--clip` |
| csv-parse | 7.0.3 | MIT | CSV |
| @anthropic-ai/sdk | 1.10.0 | Apache-2.0 | dostawca Anthropic |
| @noble/hashes | 2.4.0 | MIT | keccak-256 (suma kontrolna EIP-55) |
| vitest | 5.1.1 | MIT | testy |
| Ollama | 0.40 | MIT | lokalne uruchamianie modeli |
| PLLuM-12B-instruct-2512 (GGUF Q5_K_M, kwantyzacja mradermacher) | — | Apache-2.0 | domyślny LLM |
| Bielik-11B-v3.0-instruct (SpeakLeash, Q5_K_M) | — | Apache-2.0 | alternatywny LLM |
| bge-m3 (BAAI) | — | MIT | embeddingi |
| Claude `claude-opus-5-5` (Anthropic API) | — | warunki komercyjne Anthropic | opcjonalny LLM (testy tylko z mockami) |
| Tesseract OCR + dane `pol` (tessdata) | 5.5.3 | Apache-2.0 | opcjonalny OCR kreacji (proces zewnętrzny) |
| whisper.cpp (`whisper-cli`) + model `ggml-large-v3-turbo` (wagi Whisper, OpenAI) | 1.9.5 | MIT / MIT | opcjonalny ASR (proces zewnętrzny, model lokalny) |
| FFmpeg | 9.0.2 | LGPL-2.1-or-later; build Homebrew z `--enable-gpl --enable-version3`, czyli GPL-3.0-or-later | konwersja audio do WAV 16 kHz mono przed ASR (proces zewnętrzny) |
| Chromaprint (`fpcalc`) | 1.6.2 | LGPL-2.1-or-later | opcjonalny odcisk audio (proces zewnętrzny) |
| certstream-server-go (obraz `0rickyy0/certstream-server-go`) | 1.10.1 | MIT | opcjonalny lokalny strumień CT (kontener Docker) |
| mlx-whisper | 0.4.3 | MIT | zapasowy ASR na Apple Silicon, tylko z modelem już obecnym lokalnie (proces zewnętrzny) |
| SpeechBrain | 1.1.2 | Apache-2.0 | embedding głosu mówcy dla `--speaker` (Python, proces zewnętrzny) |
| model `speechbrain/spkrec-ecapa-voxceleb` (ECAPA-TDNN) | — | Apache-2.0 (trenowany na VoxCeleb) | wektor głosu (192 wymiary), pobierany raz przez `setup-speaker.sh`; nie był trenowany na polskiej mowie |
| model `speechbrain/vad-crdnn-libriparty` (CRDNN) | — | licencja wag niepodana na karcie (do potwierdzenia, LICENCJE.md) | detekcja mowy przed dopasowaniem głosu do galerii (`--speaker`), pobierany raz przez `setup-speaker.sh` |
| PyTorch / torchaudio | 2.15.0 / 2.11.1 | licencje liberalne według metadanych pakietów (PyTorch: Apache-2.0, BSD-2/3-Clause, MIT i in.; torchaudio: BSD) | środowisko wykonawcze SpeechBrain |
| soundfile, NumPy | 0.14.0 / 2.5.5 | BSD-3-Clause | odczyt WAV, wektory |
| MetaAdsCollector (`meta-ads-collector`) | 1.7.2 | MIT | dane przejrzystości DSA z Biblioteki Reklam Mety dla `--ad-library`: płatnik, beneficjent, usunięcie, zasięg w UE. Korzysta z publicznego endpointu strony, bez klucza API, więc może przestać działać po zmianie strony; automatyczne odpytywanie może naruszać regulamin Mety |
| uv | 0.12.15 | MIT OR Apache-2.0 | instalacja środowiska Pythona w `setup-speaker.sh` |
| rdap.org, crt.sh, Team Cymru IP-to-ASN, logi Certificate Transparency (lista logów Google), publiczny CertStream (calidog) | — | publiczne usługi bezpłatne | RDAP, logi CT, ASN, strumień CT |
| Biblioteka Reklam Mety (publiczna strona) | — | regulamin Mety | odpytywana tylko z `--ad-library`, przez MetaAdsCollector |
| Hugging Face Hub, rejestr Ollamy | — | licencje poszczególnych modeli (wyżej) | jednorazowe pobranie modeli CLIP, ECAPA, PLLuM/Bielik i bge-m3 |

#### Usługi wymagające autoryzacji

Aktualna lista usług z kluczami, sposób uzyskania dostępu i działanie bez nich: [README.md, „Usługi z kluczami”](JURY.md#usługi-z-kluczami).

### 17.7 Pochodzenie danych

| Dane | Źródło | Gdzie są | Do czego |
|---|---|---|---|
| Próbka `data/sample/`, testy, fixtures | wygenerowane (`scripts/gen-sample.ts`), w całości syntetyczne (szczegóły w [Dane przykładowe i testowe](#172-dane-przykładowe-i-testowe)) | w repozytorium | demo offline, testy, `bun run evaluate` |
| Materiały organizatora (sprawy z zapowiedzi zadania i paczka od jury) | organizator zadania | wyłącznie lokalnie, poza repozytorium i jego historią git | rozwój importera, dobór wag i progów, demo. Materiałów organizatora nie wolno rozpowszechniać, dlatego wartości z nich w testach zastąpiłem syntetycznymi (sekcja [Pochodzenie kodu](JURY.md#pochodzenie-kodu)) |
| Zbiór walidacyjny: 212 materiałów spoza próbki (z 298 kandydatów) | **urlscan.io** (publiczne wyniki wyszukiwania: zrzut strony, lista żądań odtworzona jako HAR z hashami zasobów, strona wyniku), **Lista Ostrzeżeń CERT Polska** (`hole.cert.pl/domains/v2/domains.json`) i **RDAP** (serie rejestracji), zrzuty z artykułu **Demagog**, kopia z **Internet Archive (Wayback Machine)**. Bez wyników sprawdzone: crt.sh, OpenPhish, URLhaus, ostrzeżenia KNF, Google Ads Transparency Center | poza repozytorium (treści oszukańczych stron); każdy materiał ma `zrodlo.json` z adresem źródła i datą dostępu (21.11.2026) | walidacja na danych spoza próbki: warianty znanych kampanii jako pozytywy, strony tej samej platformy albo narracji od innych operatorów jako trudne negatywy |
| Lista Ostrzeżeń CERT Polska 2024–2026 z logiem zmian API v2 | `hole.cert.pl` (publiczne API) | poza repozytorium | pilot wczesnego ostrzegania: o ile wcześniej domena pojawia się w logach CT niż na Liście |
| Przykład wzorca nazw domen `finance23-voluptas94.sbs` | publiczny komunikat CSIRT KNF | w testach | test wzorców nazw domen |
| Dane zbierane w działaniu (tryb live) | DNS, rdap.org, crt.sh, Team Cymru, jedno pobranie strony na adres, strumień CT, opcjonalnie Biblioteka Reklam Mety | `.cache/` i `data/work/` (w `.gitignore`) | wzbogacanie materiałów (sekcja [Tryb live](#175-tryb-live-prawdziwe-dane)) |

Lista obserwowanych osób (`--personas`) nie jest dołączona. W próbce są tylko fikcyjne osoby, a listę osób publicznych dostarcza użytkownik. Tryb `import-cases` nie pobiera stron docelowych: bierze treść z HAR i zapisanych stron, które przyszły z materiałem.

### 17.8 Struktura

```
lib/osint/      urls, ip, fetchPage (SSRF), extract, pagekit (kit strony), pageTechniques, landerConfig, clickIds,
                adLibrary, domainPattern, campaignParams, crypto, dns, rdap, ct, asn
lib/media/      imageHash (dHash/aHash, favicon mmh3), imageEmbed (CLIP), ocr, asr, audioFp, speaker, face (YuNet + SFace), addressBar, tools
lib/text/       normalizacja (homoglify, leet, diakrytyki), TF-IDF, cosinus, persona, uiChrome, addressBar
lib/graph/      model, config (wagi, progi i listy), weights, link, cluster (reguły kampanii, union-find, Louvain,
                warianty), explain, eval, prune
lib/llm/        ollama, anthropic, wybór dostawcy
lib/pipeline/   ingest, caseImport, sources (live/fixtures), enrich, steps, analyze, analyzeMaterial, materialVerdicts,
                materialCsv, base, demoScenario, freeze, summary
lib/viewer/     logika widoków (siła, kompletność, rozbrajanie adresów, widok kampanii i materiału, zadania, wgrywanie)
lib/evidence/   paczka dowodów (JSON, Markdown, lista CERT, zgłoszenie DSA, manifest)
lib/ct/         watcher CT: konfiguracja (leksykon), odciski, strumień, feed, wzbogacanie, potwierdzenie infrastrukturą
lib/adlib/      biblioteki reklam: wspólne typy i adaptery Meta, Google, TikTok, X (CLI `bun run adlib`)
lib/watch/      harmonogram skanów: przepisy, źródła (CT, biblioteki reklam, urlscan, lista CERT), cykl i wiersze watch.jsonl
lib/licenses.ts logika skryptu licencji pakietów
scripts/        base, demo, demo-batch, import-cases, ingest, enrich, build-graph, evaluate, pipeline, analyze-material,
                summarize, evidence, cache-freeze, ct-watch, ct-backfill, watch, backtest-ct, llm-smoke, media-smoke, gen-sample, licenses, adlib, export-dataset, report, source-stats, sensitivity,
                recheck, voice-eval, features-catalog, contract-schema, meta-id-suffix; py/ (adaptery Pythona)
app/, components/viewer/   przeglądarka i API (analiza z GUI: `/api/material` z zadaniami, postępem i CSV; ta sama analiza jednym żądaniem, używana przez panel „Nowa reklama” w Trybie eksperta: `/api/analyze-material`; karty: `/api/click-route`, `/api/add-to-base`, `/api/evidence`; `/api/image`, `/api/ct-feed`)
docker/         konfiguracja serwera CT i pakiety profilu `full`
data/sample/    syntetyczne reklamy, obrazy, dżingle, fixtures, linking.json, personas.json, ct-lexicon.json, ct-stream.jsonl
docs/           METODYKA.md, TECHNICAL.md, GUI.md, INTEGRACJA.md, CECHY.md, WZORCE-KAMPANII.md, ZRODLA-METADANYCH.md,
                ZGODNOSC.md, DANE-NIEPUBLICZNE.md; schema/ (JSON Schema wejścia i wyniku, przykład wejścia)
```

## 18. Harmonogram skanów i „baza rośnie” (22.11.2026, zadanie I11)

**Harmonogram** (`bun run watch`, `scripts/watch.ts`, `lib/watch/*`). `schedule.ts`: cykl (źródła → trafienia, których adresu nie ma jeszcze w `data/watch.jsonl` → `analyze` → wiersz `{ts, source, url, verdict, campaign}` plus opcjonalnie `recipe`, `confirmations`, `note`), pętla z wstrzykiwanym zegarem (`WatchClock`), przepis z własnym `every` pytany nie częściej; błąd analizy jednego trafienia to wiersz z werdyktem `error` i powodem w `note`, a źródło bez sieci, klucza albo strumienia kończy się `skipped` z powodem w raporcie cyklu (kod wyjścia 0). `sources.ts`: cztery źródła budowane z wstrzykiwanych części (CT: `CtWatcher` na zapisanych wiadomościach albo oknie strumienia, `ADLIB_CONFIG.defaultQueryPlatforms` dla przepisu bez platformy; urlscan: `searchScans` w `lib/osint/archive/urlscan.ts`, ta sama kolejka i limity co krok archiwalny; Lista CERT: różnica z poprzednim plikiem `watch-certlist.json` obok wierszy, pierwszy przebieg zapisuje tylko stan; filtr `confirmByRegistration` jest obowiązkowy). `recipes.ts`: format przepisu (zod; źródło, zapytanie, `every`, `feature` z listą alarmową, `confirm`), `extractFeature`, `confirmByRegistration`; `seed.ts`: przepisy z silnych cech bazy (`--seed-recipes`); `analyze.ts`: trafienie → `analyzeMaterial` (adres albo katalog sprawy z rekordu biblioteki reklam); `feedView.ts`: wiersze w feedzie CT. Stałe: `lib/watch/config.ts`. Przykład przepisów: `data/examples/watch-przepisy.example.json` (syntetyczny).

**Baza rośnie** (`lib/pipeline/addToBase.ts`, `lib/graph/stableIds.ts`). `analyzeMaterial` oddaje przez `ctx.onAnalyzed` rekordy i dane wzbogacone, których użyło porównanie; `addToBase(dataDir, {result, captured}, {source, verdicts?, force?})` dopisuje je do `enriched.json` (i `items.json`, jeśli leży obok), kopiuje pliki mediów do `<baza>/dodane/<id>/` (ścieżki względne), przebudowuje graf i kampanie offline (`runBuildGraph` w katalogu roboczym `.dodaj-<pid>`), nadaje kampaniom stare numery (`keepCampaignIds`: największe pokrycie rekordów, remis: młodszy numer; klaster bez poprzednika dostaje numer za największym dotychczasowym; to samo dla grup podobnych kampanii), zapisuje kopię poprzednich plików w `<baza>/historia/<czas>/`, zastępuje pliki przez zmianę nazwy pliku tymczasowego i dopisuje wpis do `<baza>/dodane.jsonl`. Nie dopisuje duplikatu (zwraca, czyim jest duplikatem) ani `insufficient` bez `force`. Nie przenosi katalogu `fixtures/` ani `input.json` bazy (graf nie czyta ich po wzbogaceniu), więc ponowne `bun run base` ze spraw odtwarza bazę bez dopisanych materiałów. Test: `tests/addToBase.offline.test.ts` (zawsze na kopii bazy w katalogu tymczasowym).

**B-168 (IBAN).** `bank_account` powstaje tylko z numeru z poprawną sumą mod-97 (PL i zagraniczne, klucz bez spacji); numer z błędną sumą zostaje cechą materiału (`companyIdInvalid`), bez węzła i powiązania. Konta znanych pośredników: `lists.companyIdIntermediaries` (zniżka 0). Nie zrobione: identyfikator merchanta bramki, `legal_id`, IBAN z ASR.

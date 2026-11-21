# Odcisk kampanii

Narzędzie, które łączy pojedyncze materiały o oszukańczych reklamach (zrzuty ekranu, zapisane strony, pliki HAR, nagrania, linki) w kampanie i grupy podobnych kampanii. Każde powiązanie ma listę przesłanek z ich siłą. Nowy materiał trafia do znanej kampanii albo jest oznaczany jako nowa kampania.

Projekt powstaje na HackNation 2026 (21–22.11.2026), zadanie „Kolekcjoner fejków”.

**Stan:** w budowie. Instrukcja uruchomienia jest niżej, szczegóły techniczne (formaty, wagi i progi z odwołaniami do kodu, CLI, konfiguracja) w [docs/TECHNICAL.md](docs/TECHNICAL.md).

**Dane:** repozytorium nie zawiera materiałów udostępnionych przez organizatora. Dane przykładowe i testowe są syntetyczne.

## Opis techniczny

Dla każdej reklamy narzędzie zbiera ślady cyfrowe: link docelowy z pełnym łańcuchem przekierowań, hosty z łańcuchem CNAME, domeny, adresy IP i ASN, serwery NS, rejestratora z RDAP, certyfikaty z logów CT, identyfikatory trackerów, favicon, kontakty, portfele krypto, hash obrazu i treść. Ze strony docelowej bierze odcisk „kitu” (backend formularza, ukryte pola, własne pliki JS/CSS, komentarze w kodzie, struktura DOM), a z linków parametry kampanii (UTM, sub1–5, identyfikatory kliknięć i ofert). Dochodzą wzorce nazw domen i persona, czyli osoba, pod którą podszywa się reklama, rozpoznana z tekstu. Potem buduje z tego graf dowodów i wyznacza kampanie. Każde powiązanie ma opis „dlaczego połączone” i wagę. Wyniki można przejrzeć w przeglądarce (lista kampanii, graf Cytoscape, porównanie dwóch reklam), zmierzyć na etykietach (pairwise/B-cubed F1, ARI) i wyeksportować jako paczkę dowodów kampanii. Watcher Certificate Transparency dopasowuje nowe domeny z certyfikatów TLS do znanych kampanii, zanim ruszy reklama.

## Pochodzenie kodu

Szkielet narzędzi OSINT i grafowych przygotowałem przed wydarzeniem, 18–20.11.2026, w osobnym prywatnym repozytorium. W trakcie wydarzenia (od 21.11.2026, 11:00) pracuję dalej.

Kod trafił do tego repozytorium bez historii git. Lokalne commity z 21.11 miały w testach wartości z materiałów organizatora (domeny, identyfikatory kliknięć i reklam, nazwy plików, tytuły stron, teksty ze zrzutów), a tych materiałów nie wolno rozpowszechniać. Tutaj zastąpiłem je wartościami syntetycznymi o tej samej strukturze, więc testy sprawdzają to samo co wcześniej.

### Przygotowane przed wydarzeniem

Stan z ostatniego commitu przed wydarzeniem (19.11.2026), 260 plików:

- katalog główny: `package.json`, `bun.lock`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.mts`, `next.config.ts`, `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.env.example`, `.gitignore`, `AGENTS.md`, README;
- `app/`: layout, strona, style, API `analyze`, `ct-feed`, `image`;
- `components/viewer/`: AnalyzeForm, CampaignList, ComparePanel, CtFeedPanel, DetailsPanel, GraphCanvas, Viewer, compare (z testem), graphView, palette;
- `lib/`: cache (z testem);
- `lib/osint/`: urls, ip, fetchPage, extract, pagekit, domainPattern, campaignParams, crypto, dns, rdap, ct, asn (każdy z testem);
- `lib/media/`: imageHash, ocr, asr, audioFp (z testami), tools;
- `lib/text/`: normalize, similarity, persona (z testami);
- `lib/graph/`: model, config, weights, link, cluster, unionFind, explain, eval, prune, testkit; testy link, kitLink, unionFind, eval;
- `lib/llm/`: ollama, anthropic, index, types (z testem);
- `lib/pipeline/`: ingest (z testem), sources, enrich, steps, analyze, summary, types;
- `lib/evidence/`: pack;
- `lib/ct/`: config, fingerprint, stream, feed, enrich, watch, labels (z testami);
- `lib/viewer/`: data;
- `scripts/`: _cli, _ct, ingest, enrich, build-graph, evaluate, pipeline, summarize, evidence, gen-sample, llm-smoke, media-smoke, ct-watch, ct-backfill;
- `tests/`: testy offline pipeline'u, paczki dowodów i watchera CT, `sampleRun.ts`;
- `types/cytoscape-fcose.d.ts`, `docker/certstream/config.yaml`, `docs/TECHNICAL.md`;
- `data/`: `graph.json`, `campaigns.json`, `summaries.json` i syntetyczna próbka `data/sample/` (ads.csv, mapping, linking, personas, leksykon i strumień CT, 43 obrazy, 3 dżingle WAV, fixtures DNS/HTTP/ASN, po 23 odpowiedzi RDAP i crt.sh, 14 stron, 11 faviconów).

W tym stanie były już: pivoty infrastruktury i kitu strony, persona z tekstu, adaptery OCR, ASR i odcisku audio, test cloakingu, paczka dowodów, porównanie reklam w przeglądarce i watcher CT.

### Powstałe lub zmienione później

Zmiany po tym commicie pochodzą z 20.11.2026 wieczorem (jeszcze przed wydarzeniem: embeddingi CLIP, import katalogów spraw, `path_id`, `param_schema`, usuwanie etykiet interfejsu z OCR, serie rejestracji po identyfikatorze IANA) i z 21.11.2026 w trakcie wydarzenia (nieuporządkowane katalogi spraw, konfiguracja platformy stron, identyfikatory kliknięć, favicon podrabianej marki, pasek adresu ze zrzutu, biblioteka reklam Mety, głos mówcy, analiza nowego materiału, dwa poziomy wyniku). Nie były commitowane osobno, więc poniższa lista obejmuje oba dni.

Nowe pliki (29):

- `app/api/analyze-material/route.ts`;
- `lib/pipeline/`: caseImport (z testem), analyzeMaterial;
- `lib/osint/`: clickIds, landerConfig, adLibrary (z testami);
- `lib/media/`: addressBar, imageEmbed, speaker (z testami);
- `lib/text/`: addressBar, uiChrome (z testami);
- `lib/graph/`: testy levels, screenshotLink, adLibraryVoice;
- `scripts/`: import-cases, analyze-material; `scripts/py/`: ad_library.py, speaker_embed.py, setup-speaker.sh;
- `tests/analyzeMaterial.offline.test.ts`.

Zmienione pliki (41; razem z nowymi śledzonymi `git diff --stat` daje 62 pliki, +4191/−147):

- katalog główny: `.dockerignore`, `.gitignore`, README, `package.json`, `bun.lock`;
- `app/`: `page.tsx`, `api/image/route.ts`;
- `components/viewer/`: AnalyzeForm, CampaignList, DetailsPanel, GraphCanvas, Viewer, compare, palette;
- `lib/graph/`: cluster, config, link, model, weights, testkit; testy kitLink, link;
- `lib/osint/`: campaignParams, pagekit, urls (z testami);
- `lib/media/`: asr (z testem), ocr;
- `lib/pipeline/`: enrich, ingest, steps, types;
- `lib/viewer/data.ts`, `scripts/enrich.ts`, `scripts/pipeline.ts`;
- `docs/TECHNICAL.md`, `data/graph.json`, `data/campaigns.json`.

Przy przenoszeniu zmieniłem tylko wartości w testach, komentarzach i dokumentacji. Wyczyściłem testy `lib/graph/levels.test.ts`, `lib/graph/adLibraryVoice.test.ts`, `lib/osint/clickIds.test.ts`, `lib/osint/landerConfig.test.ts`, `lib/osint/adLibrary.test.ts`, `lib/pipeline/caseImport.test.ts`, `lib/text/uiChrome.test.ts`, `lib/text/addressBar.test.ts`, `lib/media/addressBar.test.ts`, komentarze w `lib/text/addressBar.ts`, `lib/pipeline/caseImport.ts`, `lib/osint/landerConfig.ts`, `lib/graph/link.ts` i jeden przykład w `docs/TECHNICAL.md`. Logika aplikacji jest ta sama.

## Dane przykładowe i testowe

Dane w `data/sample/` są w całości **syntetyczne**: fikcyjne osoby („Adam Testowy”, „Ewa Przykładowa”…), fikcyjne marki, zarezerwowane domeny `.example`/`.test`/`.invalid`, adresy IP z zakresów dokumentacyjnych (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24), prywatne numery ASN (6450x), brytyjskie numery telefonów z puli Ofcom przeznaczonej do fikcji (+44 7700 900xxx), losowe adresy portfeli z poprawną sumą kontrolną, dżingle WAV generowane w kodzie (muzyka, bez mowy) oraz fikcyjny urząd certyfikacji i log CT w pliku demo watchera. Prawdziwe są tylko identyfikatory publicznej infrastruktury potrzebne w trudnych przypadkach: zakresy anycast Cloudflare, AS13335, serwery `*.ns.cloudflare.com`, NS ParkingCrew, nazwy popularnych rejestratorów i urzędów certyfikacji, cel CNAME Fastly, host publicznego serwisu formularzy web3forms i User-Agent crawlera Meta. Poza próbką: jeden test dopasowania person używa nazwiska osoby publicznej wyłącznie jako ciągu znaków (przypadek błędu transkrypcji ASR), a testy wzorców nazw domen używają przykładu `finance23-voluptas94.sbs` z publicznego komunikatu CSIRT KNF. Wartości w testach dodanych 20–21.11 też są syntetyczne: domeny `.example`/`.test` i poddomeny `example.com`, wymyślone UUID-y i identyfikatory reklam, identyfikatory kliknięć wygenerowane z fikcyjnego czasu, maszyny i procesu, fikcyjne tytuły i nazwy.

## Architektura

Pipeline ma cztery kroki, a każdy zapisuje JSON, który można obejrzeć. `ingest` zamienia CSV/JSON z dowolnymi nazwami kolumn na znormalizowane `Item` (także kolumny w stylu DROZD: persona, wynik deepfake, plik wideo). `enrich` wykonuje wyłącznie pasywne zapytania (jeden GET na stronę/przekierowanie z ochroną SSRF, DNS z łańcuchem CNAME, RDAP, crt.sh, Team Cymru), z plikowym cache, limitem współbieżności i trybem offline z nagranych odpowiedzi. Opcjonalnie dopasowuje listę person, uruchamia NER przez LLM, OCR, ASR, odcisk audio i test cloakingu. `build-graph` z każdej reklamy wyprowadza „pivoty” (encje osiągalne ze ścieżką dowodu) i waży je czynnikami: priorytetem typu (np. backend formularza > tracker > IP > ASN), listami infrastruktury współdzielonej (Cloudflare i inne CDN, masowi dostawcy DNS, darmowe CA, popularni rejestratorzy, platformy i skracacze, publiczne serwisy formularzy i analityki, popularne biblioteki JS, strony parkingowe), odwrotną częstością i karą za powszechność. Dochodzi do tego podobieństwo obrazów (dHash, opcjonalnie CLIP dla wariantów tego samego szablonu), treści (TF-IDF albo embeddingi bge-m3), struktury strony (simhash DOM) i dźwięku (Chromaprint). Silne dowody łączy union-find, a resztę grupuje Louvain na grafie ważonym. Zdyskontowana infrastruktura, np. wspólne IP Cloudflare, nie trafia nawet do grafu klastrowania. Persona, cyrylica, podejrzenie cloakingu i wynik deepfake są atrybutami kampanii do filtrowania, a nie dowodami łączącymi. `evaluate` porównuje wynik z etykietami. Przeglądarka (Next.js) czyta tylko `data/graph.json` i `data/campaigns.json` (oraz feed CT przez API), więc buduje się i działa bez Ollamy i bez sieci.

```
data/*.csv|json ──ingest──► items.json ──enrich──► enriched.json ──build-graph──► graph.json + campaigns.json ──► viewer / evaluate / summarize / evidence
                              (live: DNS, RDAP, CT, ASN, 1×GET │ offline: data/sample/fixtures)
CT (certstream-server-go │ crt.sh) ──ct:watch / ct:backfill──► data/ct-watch.jsonl ──► viewer („Nowe domeny”)
```

## Szybki start (dane przykładowe, offline)

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

## Tryb live (prawdziwe dane)

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

### Sprawy z plików: zapisana strona, HAR, zrzut ekranu

Gdy dane przychodzą jako katalog na sprawę (strona zapisana z przeglądarki z folderem `<nazwa>_files`, plik HAR, zrzut ekranu reklamy; dowolny podzbiór), `import-cases` zamienia je na wejście i fixtures trybu offline. Stron docelowych nie pobiera: treść bierze z HAR (surowa odpowiedź serwera) albo z zapisanej strony, adresy IP z HAR.

```bash
bun run import-cases -- --cases sprawy/ --out praca/ --lookups   # --lookups: pasywne DNS, RDAP i ASN dla domen; --ct: także crt.sh
bun run ingest -- --input praca/input.json --mapping praca/mapping.json --out praca/items.json --base-dir praca
bun run enrich -- --items praca/items.json --out praca/enriched.json --offline --fixtures praca/fixtures --archive praca/archive --ocr --clip
bun run build-graph -- --enriched praca/enriched.json --graph praca/graph.json --campaigns praca/campaigns.json
```

Importer radzi sobie też z nieuporządkowanymi sprawami: zapisy w podkatalogach (paczka `dom.html` + `page.har` + `page.mhtml` + `manifest.json` jest scalana z ręczną kopią tej samej strony), kilka różnych stron jednej sprawy (osobne rekordy `<sprawa>_<podkatalog>`), ten sam adres zapisany z różną treścią (klucz `#capture=<id>`, typowe dla cloakingu), strona zapisana z dysku bez adresu (host z pozostałych zapisów sprawy), HAR włożony do katalogu innej sprawy, sprawa bez strony (wideo reklamy i opis `.info.json` z yt-dlp, z którego idą reklamodawca i identyfikator biblioteki reklam), wiele zrzutów (pierwszy to kreacja, pozostałe czyta OCR) i nagrania ekranu (ASR, odcisk audio, CLIP). Ścieżki mediów w `input.json` są bezwzględne. Szczegóły i przypadki brzegowe: `lib/pipeline/caseImport.ts`.

Zrzut ekranu reklamy trafia do pipeline'u jako kreacja. Z tekstu OCR znikają etykiety interfejsu („Sponsorowane”, „Dowiedz się więcej”, panele biblioteki reklam), a „Identyfikator biblioteki” staje się parametrem `ad_library_id` z linkiem do biblioteki reklam. Zrzut widoku biblioteki reklam to głównie interfejs, więc jego obraz nie jest porównywany z innymi. `import-cases` wypisuje domeny, dla których RDAP albo crt.sh nie odpowiedziały; ponowne uruchomienie pobiera tylko brakujące.

### Opcjonalne kroki wzbogacania

Domyślnie wyłączone, włączane flagami `enrich` i `pipeline`:

```bash
bun run enrich -- --personas lista.json   # lista obserwowanych osób (z próbką: data/sample/personas.json)
bun run enrich -- --ner                   # nazwiska z tekstu przez skonfigurowany LLM
bun run enrich -- --cloaking              # dwa zwykłe GET-y: UA crawlera platformy i przeglądarki mobilnej
bun run enrich -- --ocr --asr --audio     # tesseract (pol), whisper-cli (+ffmpeg), fpcalc
bun run enrich -- --speaker --ad-library  # głos mówcy (SpeechBrain, scripts/py/setup-speaker.sh), biblioteka reklam Mety (MetaAdsCollector)
bun run enrich -- --clip                  # embeddingi obrazów CLIP (lokalnie, ONNX)
bun run media:smoke                       # test adapterów na syntetycznym wejściu
```

OCR, ASR i odcisk audio działają tylko z zainstalowanymi narzędziami. Brak narzędzia jest wykrywany i krok jest cicho pomijany, więc build pozostaje przenośny. Model whispera wskazuje `WHISPER_MODEL` (domyślnie `~/models/whisper/ggml-large-v3-turbo.bin`); nic nie jest pobierane automatycznie. `--clip` liczy lokalnie embedding kreacji modelem CLIP ViT-B/32 (`CLIP_MODEL`, domyślnie `Xenova/clip-vit-base-patch32`, ok. 350 MB, pobierany raz przy pierwszym użyciu, potem działa offline). Dla wideo (`videoPath`) bierze 8 klatek równo rozłożonych w środku filmu (10–90% długości, bez intro i outro; potrzebne ffmpeg i ffprobe) i uśrednia ich embeddingi. Obraz i wideo są w tej samej przestrzeni CLIP, więc da się je porównywać między sobą. Daje krawędź `similar_image_semantic` dla par, których dHash nie uznał za duplikaty: inny kadr, tło albo twarz w tym samym szablonie. Próg i wagę ustawia `similarity.imageSemantic` (domyślnie cosinus ≥ 0,9, waga 0,45); na prawdziwych danych trzeba je dostroić. Persona pochodzi tylko z tekstu i danych wejściowych, bez biometrii; tekst z OCR i ASR jest dopasowywany w trybie tolerującym błędy transkrypcji.

### Konfiguracja wag i list

Domyślne wartości są w `lib/graph/config.ts`. Nadpisanie podajesz plikiem JSON (`--config plik.json`): reguły list są dopisywane do domyślnych, a pozostałe pola zastępowane. Przykład w `data/sample/linking.json`:

```json
{ "minLinkScore": 0.15, "similarity": { "imageHamming": 10 },
  "lists": { "domains": [{ "match": "krotki.test", "factor": 0, "reason": "skracacz linków" }],
             "pivots":  [{ "match": "tracker:ga4:G-XXXXXXXXXX", "factor": 0.05, "reason": "tracker szablonu" }] } }
```

## Paczka dowodów

```bash
bun run evidence -- --campaign K01 --submitter-name "Imię Nazwisko" --submitter-email "adres@example.org"
(cd data/evidence/K01 && shasum -a 256 -c manifest.sha256)
```

W `data/evidence/<kampania>/` powstają `evidence.json` i `evidence.md` (nagłówek, osoba bez wzorców biometrycznych, reklamy, domeny i konta z identyfikatorami, URL-ami i czasem UTC, fakty oddzielone od wyników modeli, proponowane działania dla odbiorców), `cert-domains.txt` (domeny na Listę Ostrzeżeń CERT, bez platform i skracaczy), `dsa-art16-notice.md` (szablon zgłoszenia z art. 16 DSA), kopie archiwum HTML i kreacji oraz `manifest.sha256`. Paczka nie zawiera WARC, zrzutów ekranu ani znacznika czasu RFC 3161. Narzędzie proponuje, a decyzję o zgłoszeniu podejmuje człowiek.

## Watcher CT (wczesne ostrzeganie)

```bash
docker compose --profile ct up -d certstream           # lokalny certstream-server-go na 127.0.0.1:8181
bun run ct:watch -- --campaigns data/campaigns.json    # strumień CT → data/ct-watch.jsonl
bun run ct:backfill -- --pattern 'zwrot%'              # historia z crt.sh (best effort)
bun run ct:watch -- --replay data/sample/ct-stream.jsonl   # demo offline, bez sieci
```

Watcher buduje odciski kampanii (szablony nazw domen z wariantem bez TLD, marki i media z leksykonu `data/sample/ct-lexicon.json`, generator nazw w stylu Lorem) i porównuje z nimi nazwy z nowych certyfikatów. Kandydat wymaga wzorca, a nie pojedynczego popularnego słowa. Dopasowanie dostaje tylko pasywne wzbogacenie (DNS, CNAME, RDAP, crt.sh); stronę pobiera dopiero `--fetch-page`. Kandydaci trafiają do `data/ct-watch.jsonl` (tylko dopisywanie) i do zakładki „Nowe domeny” w przeglądarce, która działa też przy pustym feedzie. Na tej maszynie (19.11.2026) lokalny serwer działał (225 tys. wiadomości w 75 s), publiczny CertStream przyjmował połączenie, ale nie przysyłał danych, a crt.sh odrzucał lub nie kończył zapytań z `%`. Szczegóły: [docs/TECHNICAL.md §16](docs/TECHNICAL.md#16-watcher-certificate-transparency-wczesne-ostrzeganie).

## Dostawcy LLM

LLM nie jest potrzebny do grafu ani do przeglądarki. Używają go tylko `summarize` (streszczenia kampanii po polsku), `--text embedding`, opcjonalny NER person (`enrich --ner`) i `llm:smoke`.

| `LLM_PROVIDER` | Model | Uwagi |
|---|---|---|
| `ollama` (domyślnie) | `hf.co/mradermacher/PLLuM-12B-instruct-2512-GGUF:Q5_K_M` | lokalnie, offline; alternatywa: `OLLAMA_MODEL=SpeakLeash/bielik-11b-v3.0-instruct:Q5_K_M` |
| `anthropic` | `claude-opus-5-5` | tylko jeśli regulamin zadania pozwala na zewnętrzne API; structured output (zod) i serwerowe fallbacki przy odmowie (`fallbacks: "default"`); **przetestowane tylko na mockach** |
| embeddingi | `bge-m3` przez Ollama `/api/embed` | niezależnie od `LLM_PROVIDER` |

```bash
bun run llm:smoke            # chat + structured + embed na skonfigurowanym dostawcy
bun run summarize            # data/summaries.json (widoczne na liście kampanii)
LLM_PROVIDER=anthropic bun run summarize
```

## API

**Nowy materiał** (zakładka „Nowa reklama” w UI): `POST /api/analyze-material` przyjmuje `multipart/form-data` z plikami jednej sprawy (zrzuty, zapisana strona z folderem `_files`, HAR, nagranie, `.info.json` z yt-dlp albo zip z tym wszystkim; nazwa pliku może zawierać ścieżkę), opcjonalnie `url` i `text`, oraz flagi `live=1` (pasywne DNS, RDAP, ASN i jedno pobranie strony, której nie ma w materiale) i `asr=1` (transkrypcja i odcisk dźwięku). Materiał przechodzi ten sam import i wzbogacenie co cały zbiór, trafia do jednego grafu ze znanymi reklamami i dostaje werdykt na dwóch poziomach: znana kampania, nowa kampania podobna do znanych (ta sama grupa) albo nowa kampania, razem z najbliższymi reklamami i przesłankami. Porównanie idzie z przebiegiem, który pokazuje przeglądarka (`VIEWER_DATA_DIR`, potrzebny też `enriched.json`). Ten sam krok z wiersza poleceń:

```bash
bun run analyze-material -- --case sprawa/ --data ../praca/v1 [--live] [--asr] [--json]
curl -s localhost:3000/api/analyze-material -F files=@zrzut.png -F files=@strona.har
```

Zrzut bez strony też wystarcza: domena z paska adresu przeglądarki (górny pas zrzutu albo klatki nagrania ekranu) staje się adresem strony.

`POST /api/analyze` przyjmuje `{ url?, text?, imageUrl?, offline? }`. Wzbogaca jedną nową reklamę i zwraca najbliższą kampanię z dowodami. W UI to zakładka „Nowa reklama”.

```bash
curl -s localhost:3000/api/analyze -H 'content-type: application/json' \
  -d '{"url":"https://kz-ai-start.test/","text":"Adam Testowy zdradza…","offline":true}'
```

W trybie live endpoint pobiera adresy podane przez użytkownika. Ochrona SSRF blokuje adresy prywatne, loopback, link-local i metadata chmury, również po rozwiązaniu DNS. Limitowania zapytań nie ma; przed publicznym wdrożeniem trzeba je dodać albo ustawić `ANALYZE_OFFLINE=1`.

`GET /api/image?id=<id>` serwuje lokalne kreacje z katalogu danych, tylko pliki obrazów wewnątrz tego katalogu. `GET /api/ct-feed?limit=50` zwraca najnowszych kandydatów z feedu watchera CT (pusty feed daje pustą listę).

## Zmienne środowiskowe

Wszystkie zmienne z komentarzami są w `.env.example`, łącznie z adapterami mediów i watcherem CT.

| Zmienna | Domyślnie | Znaczenie |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | `ollama` albo `anthropic` |
| `OLLAMA_HOST` | `http://localhost:11434` | adres Ollamy |
| `OLLAMA_MODEL` | PLLuM (tag wyżej) | model czatu w Ollamie |
| `OLLAMA_EMBED_MODEL` | `bge-m3` | model embeddingów |
| `LLM_TIMEOUT_MS` | `180000` | limit czasu jednego wywołania LLM |
| `ANTHROPIC_API_KEY` | — | klucz (albo profil `ant auth login`) |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | model Claude |
| `ANTHROPIC_EFFORT` | `medium` | `low`…`max` |
| `TEXT_SIMILARITY` | `tfidf` | `tfidf`, `embedding` albo `none` w `build-graph` |
| `CACHE_DIR` / `CACHE` | `.cache` / włączony | `CACHE=off` wyłącza cache |
| `CT` | włączony | `CT=off` pomija crt.sh |
| `DNS_SERVERS` | systemowe | lista resolverów po przecinku |
| `FETCH_INSECURE_TLS` | `0` | `1` akceptuje nieważne certyfikaty przy pobieraniu stron |
| `ANALYZE_OFFLINE` | `0` | `1` sprawia, że `/api/analyze` korzysta tylko z fixtures |
| `LINK_CONFIG` | `data/sample/linking.json` | konfiguracja wag dla `/api/analyze` |
| `WHISPER_MODEL` | `~/models/whisper/ggml-large-v3-turbo.bin` | model whisper.cpp dla `--asr` |
| `MLX_WHISPER_MODEL` | `mlx-community/whisper-large-v3-turbo` | zapasowy ASR, tylko gdy model jest już lokalnie |
| `CT_STREAM_URL` | `ws://127.0.0.1:8181/,wss://certstream.calidog.io/` | strumienie CT w kolejności prób |
| `CT_FEED_FILE` | `data/ct-watch.jsonl` | feed kandydatów watchera CT (zapis i `/api/ct-feed`) |

## Testy i jakość

```bash
bun run test        # vitest, 474 testy w 45 plikach: URL/IDN, SSRF, ekstrakcja (regexy + sumy kontrolne portfeli),
                    # kit strony, parametry kampanii, wzorce nazw domen, persony (odmiana, błędy ASR),
                    # dHash/Hamming, mmh3 favicon, adaptery OCR/ASR/Chromaprint (mock i lokalne narzędzia),
                    # parsery DNS/RDAP/CT/ASN, cache, union-find, wagi i zniżki (w tym Cloudflare i trudne
                    # negatywy nowych pivotów), klastrowanie, explain, metryki (wartości liczone ręcznie),
                    # LLM (mock), paczka dowodów, watcher CT, pełny pipeline offline na próbce
bun run lint
bunx next typegen   # typy tras Next.js (next-env.d.ts, .next/types); bez nich typecheck zgłasza brak LayoutProps
bun run typecheck
bun run build
```

## Docker

```bash
docker compose up -d ollama && docker compose exec ollama ollama pull bge-m3
docker compose up --build app        # http://localhost:3000
docker compose --profile ct up -d certstream   # opcjonalny lokalny strumień CT dla bun run ct:watch
```

Na macOS lepiej użyć natywnej Ollamy (GPU Metal): `OLLAMA_HOST=http://host.docker.internal:11434 docker compose up --build --no-deps app`.

## Ograniczenia

- Podobieństwo obrazów, tekstów, struktury stron i dźwięku jest liczone parami, O(n²). Przy kilku tysiącach reklam to jeszcze działa, ale przy większych zbiorach trzeba dodać indeks (BK-tree, LSH).
- TF-IDF łapie przeredagowania z tymi samymi słowami. Pełne parafrazy wymagają embeddingów (`--text embedding`).
- Strony renderowane w JavaScripcie ograniczają ekstrakcję, bo celowo nie wykonujemy JS. Test cloakingu porównuje tylko dwa User-Agenty; cloakingu po IP, geolokalizacji czy JS nie wykryje.
- OCR i ASR mylą się; persona z tekstu maszynowego jest wskazówką do sprawdzenia, a persona w ogóle nie łączy kampanii (ta sama osoba występuje w wielu kampaniach).
- Infrastruktura za Cloudflare ukrywa origin. Wtedy pivotami zostają backend formularza, kit strony, trackery, kontakty, certyfikaty, favicon i treść.
- `graph.json` zawiera najsilniejsze powiązania każdej reklamy (top 12), a klastrowanie korzysta ze wszystkich par.
- Watcher CT zależy od lokalnego `certstream-server-go`; backfill z crt.sh jest zawodny.

## Biblioteki, modele i źródła danych

Rozszerzenie z 19.11.2026 nie dodało nowych bibliotek npm. Narzędzia zewnętrzne są opcjonalne, uruchamiane jako osobne procesy (albo kontener) i nie są dołączone do repozytorium ani do obrazu aplikacji.

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
| rdap.org, crt.sh, Team Cymru IP-to-ASN, logi Certificate Transparency (lista logów Google), publiczny CertStream (calidog) | — | publiczne usługi bezpłatne | RDAP, logi CT, ASN, strumień CT |

## Struktura

```
lib/osint/      urls, ip, fetchPage (SSRF), extract, pagekit (kit strony), domainPattern, campaignParams,
                crypto, dns, rdap, ct (lookupCt, searchCt), asn
lib/media/      imageHash (dHash/aHash, Hamming, favicon mmh3), imageEmbed (CLIP), tools, ocr, asr, audioFp
lib/text/       normalizacja (homoglify, leet, diakrytyki), TF-IDF, cosinus, persona
lib/graph/      model, config (wagi i listy), weights, link, cluster (union-find + Louvain), explain, eval, prune
lib/llm/        ollama, anthropic, wybór dostawcy
lib/pipeline/   ingest, sources (live/fixtures), enrich, steps, analyze, summary
lib/evidence/   paczka dowodów (JSON, Markdown, lista CERT, zgłoszenie DSA, manifest)
lib/ct/         watcher CT: config (leksykon), fingerprint (odciski i dopasowanie), stream, feed, enrich, watch
scripts/        ingest, enrich, build-graph, evaluate, pipeline, summarize, evidence, ct-watch, ct-backfill,
                llm-smoke, media-smoke, gen-sample
app/, components/viewer/   przeglądarka (porównanie reklam, zakładka „Nowe domeny”) i API
docker/certstream/         konfiguracja lokalnego serwera CT
data/sample/    syntetyczne reklamy, obrazy, dżingle, fixtures, linking.json, personas.json, ct-lexicon.json, ct-stream.jsonl
```

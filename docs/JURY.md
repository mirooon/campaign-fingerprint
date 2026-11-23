# Odcisk kampanii

> To jest instrukcja uruchomienia dla jury HackNation 2026 w stanie z 22.11.2026 i dotyczy wersji z tagiem [`hacknation-2026`](https://github.com/mirooon/odcisk-kampanii/tree/hacknation-2026) (polski interfejs); aktualny opis projektu po angielsku jest w [README.md](../README.md), po polsku w [README.pl.md](../README.pl.md). Paczka `odcisk-kampanii-sample-data-2026-11-22.zip` z bazą wyliczoną z danych organizatora nie jest publiczna, więc kroki z nią działają tylko dla jury.

Narzędzie łączy pojedyncze materiały o oszukańczych reklamach (zrzuty ekranu, zapisane strony, pliki HAR, nagrania, linki) w kampanie i grupy podobnych kampanii. Nowy materiał ocenia względem bazy znanych kampanii i przy każdym powiązaniu pokazuje przesłanki. Analiza działa bez internetu i bez kluczy (sprawdzone w kontenerze z `--network none`); internet jest potrzebny tylko przy pierwszej budowie obrazu.

Projekt powstał na HackNation 2026 (21–22.11.2026), zadanie „Kolekcjoner fejków”. Repozytorium nie zawiera materiałów organizatora; dane przykładowe i testowe są syntetyczne ([Pochodzenie danych](#pochodzenie-danych)).

## Uruchomienie dla jury

### Z paczką sample data (zalecane)

Potrzebujesz: Docker z Compose v2, Python 3, git, unzip, wolny port 3000 i internet przy pierwszej budowie obrazu. Paczka `odcisk-kampanii-sample-data-2026-11-22.zip` (49 MB) jest w materiałach dodatkowych formularza zgłoszenia. Zawiera bazę wyliczoną z 25 spraw organizatora, dlatego nie ma jej w repozytorium. Repozytorium na GitHubie jest prywatne: `git clone` zadziała z konta, któremu zespół nadał dostęp.

W katalogu z pobranym zipem:

```bash
git clone https://github.com/mirooon/odcisk-kampanii.git
unzip -q odcisk-kampanii-sample-data-2026-11-22.zip
sh odcisk-kampanii-sample-data/start.sh odcisk-kampanii
```

Skrypt wypisuje w terminalu cztery kroki (`== 1/4` … `== 4/4`):

1. Buduje obraz Dockera (za pierwszym razem 3–5 minut, zależnie od maszyny).
2. Analizuje 212 publicznych stron oszustw spoza próbki organizatora (skany urlscan, kopie Wayback, prasa) przeciw bazie z 25 spraw i porównuje wynik z etykietami zespołu.
3. Dopisuje te 212 stron do kopii bazy (`baza-gui/`; `baza/` zostaje bez zmian).
4. Uruchamia GUI na http://localhost:3000.

**Czego się spodziewać** (pomiar zespołu na kodzie `33c95e3`, z którego zbudowano paczkę):

| Co mierzymy | Wynik |
|---|---|
| Strony innych operatorów **niesklejone** ze znanymi kampaniami | **134 / 134** |
| Warianty znanych kampanii przypisane do właściwej kampanii | 34 / 78 |
| Warianty oznaczone jako „podobne” do właściwej kampanii | 11 / 78 |
| Czas analizy 212 materiałów | ok. 1,5 s |

Skrypt `start.sh` wypisuje przy wariantach „podobnych” liczbę mniejszą niż 11/78: `zbior-publiczny/sprawdz.py` w paczce dzieli listę kampanii po `|`, a CSV rozdziela je `;`, więc pomija wiersze z kilkoma podobnymi kampaniami. Poprawna liczba (11/78) jest w `zbior-publiczny/WALIDACJA.md` w paczce.

Pozostałe warianty dostają werdykt „nowa kampania”, bo publicznym skanom brakuje śladów z linku reklamy. Narzędzie woli nie połączyć, niż połączyć błędnie. Etykiety 212 stron nadał zespół, częściowo po tych samych śladach, których używa narzędzie, dlatego najbardziej miarodajny jest wynik 134/134 ([walidacja](METODYKA.md#walidacja-na-materiałach-spoza-próbki)).

**Co zobaczysz w GUI.** W nagłówku „Analiza kampanii” stoi rozmiar bazy: 240 materiałów (28 rekordów z 25 spraw i 212 stron publicznych). Zacznij od tych zakładek:

- **Kampanie**: lista kampanii; karta kampanii pokazuje wspólne ślady, ewolucję i oś czasu.
- **Analizuj materiał**: upuść pliki albo kliknij „Wczytaj przykład”; karta wyniku podaje werdykt i przesłanki („Dlaczego?”).
- **Porównaj**: dwa materiały obok siebie, ze wspólnymi śladami.
- **Celowo nie połączone**: pary podobne, których metoda nie połączyła, z regułą i powodem.

Pozostałe zakładki i przyciski: [docs/GUI.md](GUI.md).

Zatrzymanie GUI: `docker rm -f odcisk-gui`. Inny port: `PORT=3001 sh odcisk-kampanii-sample-data/start.sh odcisk-kampanii`. Logi kroków (`budowa.log`, `analiza.log`, `baza-gui.log`) leżą w katalogu paczki. Zrzuty spraw organizatora w GUI i skrypty pomiarów: `README.md` w paczce.

**Własne materiały przeciw bazie z paczki** (jeden podkatalog na sprawę), z katalogu nad paczką:

```bash
docker run --rm --network none -v "$PWD/odcisk-kampanii-sample-data":/dane -v "<katalog ze sprawami>":/nowe:ro \
  odcisk-kampanii:latest bun run analyze-material -- --cases /nowe --data /dane/baza --csv /dane/wynik-wlasne.csv
```

Wynik: `odcisk-kampanii-sample-data/wynik-wlasne.csv`, wiersz na materiał z werdyktem (znana kampania, podobne kampanie, nowa kampania, duplikat albo za mało danych) i przesłanką. Żeby zobaczyć te materiały w GUI, zamień `--data /dane/baza` na `--data /dane/baza-gui --add-to-base` i odśwież stronę. Możesz też wgrać folder w zakładce „Analizuj materiał”.

### Bez paczki: dane syntetyczne z repozytorium

Potrzebujesz Dockera z Compose v2, gita, dostępu do prywatnego repozytorium (zob. wyżej) i internetu przy pierwszej budowie.

```bash
git clone https://github.com/mirooon/odcisk-kampanii.git && cd odcisk-kampanii
mkdir -p dane                                          # katalog wymiany plików z kontenerem (/dane)
docker compose build app                               # pierwszy raz 3–5 minut
docker compose run --rm app bun run demo               # baza z 12 syntetycznych spraw i 8 materiałów do oceny
VIEWER_DATA_DIR=/dane/demo/baza docker compose up -d   # GUI z bazą demo na http://localhost:3000
```

`demo` wypisuje osiem materiałów z werdyktami `known_campaign`, `similar_campaigns`, `duplicate`, `insufficient` i `new_campaign`. Wśród nich jest martwa strona (sam zrzut z paskiem adresu, werdykt `new_campaign` z cechami z nagranych RDAP i DNS) i trzy strony jednej nowej kampanii ze zmienionymi domenami i twarzami. Wynik trafia do `./dane/demo/wynik/` (`wynik.json`, `wynik.csv`). Zatrzymanie: `docker compose down`.

Bez Dockera: [Bez Dockera](#bez-dockera).

### Gdy coś nie działa

| Objaw | Co zrobić |
|---|---|
| port 3000 zajęty | ze skryptem paczki: `PORT=3001 sh …/start.sh …`; z Compose: `PORT=3001 docker compose up -d` |
| `pominiętych: N` przy imporcie | to podstrony w sprawach bez adresu strony, a nie całe sprawy (liczba spraw jest podana obok) |
| komunikaty `[base] asr/clip/lookups: skipped …` | to oczekiwane: kontener działa bez sieci i bez dużych modeli, powód jest w wyniku |
| GUI pokazuje „Brak bazy znanych kampanii” | uruchom `demo`, potem GUI z `VIEWER_DATA_DIR=/dane/demo/baza` (wyżej) |
| budowa w `start.sh` się nie udała | zob. `budowa.log` w katalogu paczki |

## Jak działa metoda

Z każdego materiału narzędzie wyciąga ślady w pięciu rodzinach (tekst i osoby, wygląd, strona, infrastruktura, platforma i identyfikatory) i waży je ręcznie ustalonymi wagami, ze zniżką za infrastrukturę wspólną i za częstość w zbiorze; przesłanki jednej pary łączy wzorem noisy-OR. Kampanię (ten sam operator) tworzy silny dowód albo jeden rodzaj śladu operatora (np. konto platformy stron, serwer trackera, NS, kontakt), jeśli po zniżkach wynik pary przekracza próg; sam szablon strony, sama persona ani jeden rodzaj treści jej nie tworzą. Słabsze powiązania dają grupy podobnych kampanii (Louvain); każde połączenie ma jawną listę przesłanek. `confidence` i `score` w wyniku to siła przesłanek, nie prawdopodobieństwo.

- Opis na pięć minut: [Skrót w metodyce](METODYKA.md#skrót-jak-działa-łączenie); pełny: [docs/METODYKA.md](METODYKA.md).
- Katalog śladów i cech (generowany poleceniem `bun run features:catalog`): [docs/CECHY.md](CECHY.md). Zaczyna się od [śladów, których nie dają typowe narzędzia](CECHY.md#ślady-których-nie-dają-typowe-narzędzia), z wynikiem na próbce.
- Wzorce kampanii: [docs/WZORCE-KAMPANII.md](WZORCE-KAMPANII.md). Źródła metadanych i ich wartość: [docs/ZRODLA-METADANYCH.md](ZRODLA-METADANYCH.md).
- Formaty, wagi, CLI, konfiguracja: [docs/TECHNICAL.md](TECHNICAL.md). Kontrakt wejścia i wyjścia: [docs/INTEGRACJA.md](INTEGRACJA.md). AI Act, RODO, DSA: [docs/ZGODNOSC.md](ZGODNOSC.md).

## Kryteria oceny: gdzie to zobaczyć

| Kryterium | Funkcja | Polecenie albo ekran |
|---|---|---|
| Metoda korelacji i grupowania | wagi, reguły kampanii, union-find, Louvain, wyjaśnienie każdej krawędzi | [docs/METODYKA.md](METODYKA.md); `lib/graph/`; `bun run evaluate`; GUI: „Porównaj” |
| Cechy i źródła danych | pięć rodzin cech, ekstrakcja ze strony, HAR, zrzutu, nagrania; źródła publiczne; ślady spoza typowych narzędzi (rekord panelu platformy stron, token Mety w kodzie, serwer kliknięć z identyfikatora xid, trojan w zestawie stron, odcisk montażu wideo) | [docs/CECHY.md](CECHY.md), na początku [ślady, których nie dają typowe narzędzia](CECHY.md#ślady-których-nie-dają-typowe-narzędzia); `bun run enrich -- --help`; [Pochodzenie danych](#pochodzenie-danych); `lib/osint/`, `lib/media/` |
| Demonstrator end-to-end | baza → analiza nowego materiału → CSV i GUI | [Uruchomienie dla jury](#uruchomienie-dla-jury); GUI: „Analizuj materiał” (twarze, CLIP, audio, głosy i archiwum tylko z CLI) |
| Czytelność powiązań | przesłanki prostym językiem, siła, pewność, powód rozdzielenia | GUI: karta wyniku, „Porównaj”, „Celowo nie połączone”, „Jak to działa”; kolumna `top_premise` |
| Wdrożenie i przenośność | Docker bez sieci i kluczy, tryb lokalny, konfiguracja plikiem | [Instalacja i konfiguracja](#instalacja-i-konfiguracja); `docker-compose.yml`; `.env.example` |
| Wiedza | metodyka, wzorce kampanii, ocena źródeł metadanych z liczbami, wzbogacony zbiór danych, licencje | [docs/METODYKA.md](METODYKA.md), [docs/WZORCE-KAMPANII.md](WZORCE-KAMPANII.md), [docs/ZRODLA-METADANYCH.md](ZRODLA-METADANYCH.md), `bun run export-dataset`, [LICENCJE.md](../LICENCJE.md); w paczce: `wiedza/`, `zbior/`, `pomiary/` |

## Analiza własnych materiałów

### W przeglądarce

W zakładce „Analizuj materiał” upuść pliki, folder albo zip (zrzut, zapisana strona, HAR, wideo) albo wklej link lub tekst reklamy, sprawdź podział na sprawy i kliknij „Analizuj”. Duże zbiory (wiele GB) też: pliki idą pojedynczo i strumieniowo na dysk (`./dane/praca`), bez limitu rozmiaru i liczby plików, z paskiem postępu. Wynik to lejek werdyktów, tabela i karta wyniku z przesłankami i trasą kliknięcia, z eksportem CSV i JSON. „Dodaj do bazy” działa tylko na własnej bazie z `VIEWER_DATA_DIR`; baza przykładowa jest tylko do odczytu. Z przeglądarki analiza robi OCR, odczyt paska adresu, strony i HAR oraz zapytania DNS/RDAP. Twarze, CLIP, odcisk dźwięku, galerię głosów, transkrypcję mowy i archiwum uruchamiasz z wiersza poleceń. Opis zakładek i przycisków: [docs/GUI.md](GUI.md).

### W wierszu poleceń

W Dockerze poprzedź polecenie `docker compose run --rm app`.

```bash
bun run analyze-material -- --case sprawa/                         # jedna sprawa (katalog z plikami)
bun run analyze-material -- --cases partia/ --csv wynik.csv        # partia: każdy podkatalog to sprawa
bun run analyze-material -- --cases pliki/ --each-file             # każdy luźny plik to osobny materiał
bun run analyze-material -- --dataset zbior.csv --mapping m.json   # CSV/JSON/JSONL: wiersz to materiał
bun run analyze-material -- --url https://oferta.example/          # sam link (pobranie strony tylko z --live)
bun run analyze-material -- --url https://oferta.example/ --archive  # martwa strona: publiczna kopia z urlscan.io lub Internet Archive
bun run analyze-material -- --text "Ewa Przykładowa poleca…"      # sam tekst reklamy
```

Bazę znanych kampanii buduje `bun run base -- --cases <katalog spraw>` (opcje: `--out`, `--offline`, `--lookups`, `--labels`, `--config`). Najważniejsze opcje analizy: `--data <katalog bazy>` (domyślnie `VIEWER_DATA_DIR`), `--json wynik.json`, `--live` (pasywne DNS/RDAP/ASN i jedno pobranie strony), `--asr`, `--audio`, `--clip`, `--speaker`, `--faces`, `--ad-library`, `--add-to-base` (z `--force`). Pełna lista: `bun run analyze-material -- --help`. Sprawdzanie numerów firm w białej liście VAT i KRS (`--company-registry`, tylko `enrich` i `pipeline`, domyślnie wyłączone): docs/TECHNICAL.md §4.20.

**Wynik CSV** ma wiersz na materiał i stałą kolejność kolumn; to samo zwraca eksport z GUI. Sprawa, z której import nie zrobił rekordu (także gdy jej pliku nie da się odczytać), też ma wiersz (`insufficient` z powodem w `missing_data`); jeden uszkodzony plik nie przerywa partii. Znaczenie kolumn: [docs/INTEGRACJA.md](INTEGRACJA.md#wyjście).

**Martwe strony.** Z `--archive` narzędzie szuka publicznej kopii martwego adresu w urlscan.io i Internet Archive i dokłada ją do materiału ze źródłem, adresem kopii i datą. Krok jest pasywny; bez sieci albo przy `ANALYZE_OFFLINE=1` jest pomijany z powodem w wyniku. Kolejność źródeł i odrzucanie starych kopii: [docs/METODYKA.md](METODYKA.md#strony-niedostępne); zmienne `ARCHIVE_SOURCES` i `URLSCAN_API_KEY`: [Usługi z kluczami](#usługi-z-kluczami).

**Ocena na własnych etykietach** (plik `{"kampania": ["sprawa", …]}` albo `{"sprawa": "kampania"}`): F1 par i B-cubed jednym poleceniem.

```bash
bun run evaluate -- --csv wynik.csv --labels etykiety.json        # --json: wynik jako JSON
```

**Baza rośnie.** Z `--add-to-base` materiały po analizie wchodzą do bazy z `--data`, więc drugi materiał nowej kampanii znajduje pierwszy. Kampanie zachowują numery, duplikat nie jest dopisywany, a „za mało danych” tylko z `--force`. Szczegóły: [docs/METODYKA.md, punkt 9.1](METODYKA.md#91-harmonogram-skanów-i-baza-rośnie).

```bash
bun run analyze-material -- --case sprawa/ --data dane/baza --add-to-base
```

### Jak zebrać materiał

| Co masz | Jak zapisać | Co z tego narzędzie bierze |
|---|---|---|
| strona docelowa | w przeglądarce: „Zapisz jako… → Strona internetowa, kompletna” (powstaje plik i folder `<nazwa>_files`) | treść, formularze, skrypty, komentarze, kit strony |
| przebieg wizyty | DevTools → Network → „Save all as HAR with content”. Zapisuj HAR bez opcji „sanitized”, bo usuwa nagłówki i ciasteczka; otwarte DevTools zmieniają zachowanie niektórych stron | adresy IP, żądania, przekierowania, treść odpowiedzi |
| reklama | zrzut ekranu z **widocznym paskiem adresu** przeglądarki (domena z paska zastępuje brak linku) | kreacja, OCR, domena |
| nagranie | nagranie ekranu z dźwiękiem; opis `.info.json` (yt-dlp) | klatki, transkrypcja, odcisk dźwięku, reklamodawca |
| reklama z biblioteki reklam | link do reklamy i zrzut z widocznym „Identyfikatorem biblioteki” | identyfikator biblioteki, płatnik (z `--ad-library`) |

Podpowiedzi „Co dorzucić” w wyniku (`missing_data`) odpowiadają tym krokom: „link do reklamy albo strony docelowej” i „zrzut z widocznym paskiem adresu” (brak adresu), „plik HAR z wizyty na stronie” (brak zapisanej strony), „zrzut ekranu reklamy” (brak obrazu), „pełna treść reklamy” (mniej niż 5 słów). Zapisana strona (HTML albo HAR) zwykle wystarcza do przypisania do znanej kampanii, sam zrzut albo samo wideo zwykle nie ([pomiar](METODYKA.md#odporność-na-niepełne-zgłoszenia)). Obrazy HEIC import pomija i podaje to w powodzie: zapisz je jako PNG albo JPEG.

### Nowe materiały z bibliotek reklam i harmonogram skanów

`bun run adlib` szuka reklam w publicznych bibliotekach reklam i zapisuje wyniki jako sprawy dla `analyze-material`. Żadna biblioteka nie obiecuje trafień: wyszukiwanie w Google Ads Transparency nie dało materiałów dla rodzin kampanii z próbki. Źródło bez dostępu jest wypisane z powodem i instrukcją, a polecenie kończy się kodem 0 (także bez sieci i kluczy). Dostęp do bibliotek: [Biblioteki reklam: jak uzyskać dostęp](#biblioteki-reklam-jak-uzyskać-dostęp).

```bash
bun run adlib -- search --platform all --keyword "inwestycja" --country PL --out dane/adlib     # bez --keyword: domyślne frazy i nazwiska z listy osób
bun run adlib -- search --platform google --advertiser AR0123456789012345678 --out dane/adlib   # wszystkie reklamy tego reklamodawcy w EOG
bun run adlib -- get --platform meta --id <identyfikator biblioteki> --out dane/adlib          # jedna reklama (z kreacją, gdy jest yt-dlp)
bun run adlib -- expand --campaign K01 --data dane/baza --out dane/adlib                       # rozszerzenie znanej kampanii po kontach reklamodawców
bun run analyze-material -- --cases dane/adlib --csv wynik.csv
```

`expand` szuka po domenach kampanii tylko przez nieoficjalne RPC Google (`ADLIB_GOOGLE_RPC=1`, domyślnie wyłączone, ryzyko warunków serwisu: [docs/ZRODLA-METADANYCH.md](ZRODLA-METADANYCH.md)).

`bun run watch` co jakiś czas pyta publiczne źródła (logi CT, biblioteki reklam, urlscan, Lista Ostrzeżeń CERT) o nowe adresy, przepuszcza każdy przez analizę względem bazy i dopisuje wiersz `{ts, source, url, verdict, campaign}` do pliku wierszy (domyślnie `data/watch.jsonl`, widoczny w zakładce „Nowe domeny”). Źródło bez sieci albo klucza jest pomijane z powodem.

```bash
# demo bez internetu: zapisane wiadomości CertStream i przykładowe (syntetyczne) przepisy
bun run watch -- --data data --once --sources ct --replay data/sample/ct-stream.jsonl --recipes data/examples/watch-przepisy.example.json
# w kontenerze, bez sieci (baza z demo)
docker compose run --rm app bun run watch -- --data /dane/demo/baza --once --sources ct --replay data/sample/ct-stream.jsonl --file /dane/watch.jsonl
# na żywo, co 30 minut (potrzebny lokalny strumień: docker compose --profile ct up -d certstream)
bun run watch -- --data dane/baza --every 30m --recipes przepisy.json --add-to-base
```

Przepisy wyszukiwania (zapytanie, źródło, filtr potwierdzający, częstotliwość) to plik JSON z `--recipes` albo `WATCH_RECIPES`; format pokazuje `data/examples/watch-przepisy.example.json`. Przepisy z wartościami prawdziwych kampanii trzymaj poza repozytorium (`--seed-recipes plik.json` robi je z bazy). `--add-to-base` dopisuje do bazy tylko trafienia z werdyktem z `--add-verdicts` (domyślnie `known_campaign`). Szczegóły: [docs/TECHNICAL.md, punkt 18](TECHNICAL.md#18-harmonogram-skanów-i-baza-rośnie-22112026-zadanie-i11).

### Wyniki dla instytucji

- **Wzbogacony zbiór, graf dla Neo4j, raport okresowy, statystyki źródeł:** `bun run export-dataset`, `bun run report`, `bun run source-stats` ([docs/TECHNICAL.md, punkt 9.2](TECHNICAL.md#92-wiedza-jako-wynik-zadanie-i9)).
- **Paczka dowodów kampanii:** przycisk „Pobierz paczkę” w karcie kampanii (także dla nowej kampanii z wyniku analizy) albo `bun run evidence -- --campaign K01`. Zawiera fakty oddzielone od wyników modeli, listę domen dla CERT, zgłoszenia z art. 16 DSA, STIX 2.1 i sumy SHA-256. Narzędzie niczego nie wysyła; o zgłoszeniu decyduje człowiek ([docs/TECHNICAL.md, punkt 15](TECHNICAL.md#15-paczka-dowodów)).

## Instalacja i konfiguracja

Dla administratora i dewelopera: kontener z własnymi danymi, tryb lokalny, narzędzia opcjonalne, zmienne.

### Kontener: polecenia i praca bez sieci

Obraz `odcisk-kampanii:latest` ma ok. 3,3 GB na dysku i zawiera bun, zbudowany interfejs, tesseract (polski), ffmpeg, chromaprint, Pythona i modele twarzy (YuNet, SFace, ok. 40 MB). Kolejne budowy trwają ok. 40–50 sekund; gdy obraz już jest, `docker compose up -d` startuje od razu. Pliki wymieniasz z kontenerem przez katalog `./dane` (w kontenerze `/dane`); baza trafia do `./dane/baza`, a GUI czyta ją po odświeżeniu strony.

```bash
docker compose up -d                                                # GUI na http://localhost:3000
docker compose run --rm app bun run base -- --cases /dane/probka    # baza znanych kampanii z ./dane/probka
docker compose run --rm app bun run analyze-material -- --cases /dane/nowe --csv /dane/wynik.csv
```

`./dane/probka` to własna próbka znanych kampanii (podkatalog = sprawa: zapisana strona, HAR, zrzut), `./dane/nowe` to materiały do oceny; luźne pliki zamiast spraw: dopisz `--each-file`. Bez bazy GUI działa i podpowiada, żeby uruchomić `bun run base`. Te same kroki na syntetycznych sprawach z repozytorium:

```bash
docker compose run --rm app bun run demo-batch -- --out /dane       # ./dane/syntetyczne (4 sprawy) i ./dane/syntetyczne-nowe (luźne pliki)
docker compose run --rm app bun run base -- --cases /dane/syntetyczne
docker compose run --rm app bun run analyze-material -- --cases /dane/syntetyczne-nowe --each-file --csv /dane/wynik.csv
```

Bez sieci kontener pomija pobieranie stron, DNS i RDAP, a transkrypcja mowy, głos i CLIP są w wyniku oznaczone jako `skipped` z powodem. Modele twarzy są w obrazie, więc `--faces` działa też w kontenerze. Profil `full` (`docker compose --profile full up -d app-full`) dodaje whisper.cpp i SpeechBrain na CPU; modele zostają na hoście i są montowane tylko do odczytu (`WHISPER_MODEL_DIR`, `SPEAKER_MODEL_HOST`, zob. `docker-compose.yml`). `docker compose run` nie przyjmuje `--network`, dlatego polecenia z `--network none` używają `docker run`.

**Publiczny adres.** Przy udostępnianiu aplikacji ustaw `ANALYZE_OFFLINE=1`, `ANALYZE_RATE_LIMIT` (zapytań na klienta na okno; przekroczenie daje 429), `MATERIAL_MAX_MB` i `MATERIAL_MAX_FILES` (limity wgrania; domyślnie brak) oraz reverse proxy podające `X-Forwarded-For`.

### Bez Dockera

Rdzeń (graf, kampanie, przeglądarka) potrzebuje tylko buna ≥ 1.4 (Node ≥ 20 dla Next.js). Pozostałe narzędzia są opcjonalne: bez nich działa reszta, a odpowiedni krok jest w wyniku oznaczony jako `skipped` z powodem.

```bash
bun install
bun run pipeline --offline   # próbka syntetyczna: ingest → enrich z nagranych odpowiedzi → graf → kampanie → ewaluacja
bun run evaluate             # metryki względem etykiet próbki
bun run dev                  # GUI na http://localhost:3000
bun run test && bun run lint && bun run typecheck
```

| Narzędzie | macOS (`brew`) | Debian/Ubuntu (`apt`) | Bez niego |
|---|---|---|---|
| bun | `brew install oven-sh/bun/bun` | `curl -fsSL https://bun.sh/install \| bash` | nic nie działa |
| tesseract z polskim (OCR, `--ocr`) | `brew install tesseract tesseract-lang` | `sudo apt install tesseract-ocr tesseract-ocr-pol` | krok OCR `skipped`, tekst ze zrzutów niedostępny |
| ffmpeg i ffprobe (audio, klatki wideo) | `brew install ffmpeg` | `sudo apt install ffmpeg` | `--asr`, `--audio`, `--speaker`, klatki wideo dla `--clip` `skipped` |
| `fpcalc` (odcisk dźwięku, `--audio`) | `brew install chromaprint` | `sudo apt install libchromaprint-tools` | krok `--audio` `skipped` |
| whisper-cli i model (transkrypcja, `--asr`) | `brew install whisper-cpp`; model `ggml-large-v3-turbo.bin` (ok. 1,5 GB) do `~/models/whisper/`; opcjonalnie model VAD `ggml-silero-v5.1.2.bin` (ok. 0,9 MB, [ggml-org/whisper-vad](https://huggingface.co/ggml-org/whisper-vad)) do tego samego katalogu albo `WHISPER_VAD_MODEL`: bez niego muzyka bywa transkrybowana jako „Dziękuję za oglądanie” | zbuduj [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (`cmake`); ten sam model | krok `--asr` `skipped` |
| SpeechBrain i modele głosu (`--speaker`) | `brew install uv`, potem `bash scripts/py/setup-speaker.sh` (venv `.venv-speaker`, modele ECAPA ok. 85 MB i VAD ok. 0,5 MB do `~/models/speechbrain`) | `curl -LsSf https://astral.sh/uv/install.sh \| sh`, potem `bash scripts/py/setup-speaker.sh` | krok `--speaker` `skipped` |
| OpenCV, YuNet i SFace (twarze, `--faces`) | `brew install uv`, potem `bash scripts/py/setup-face.sh` (venv `.venv-face`, modele ok. 40 MB do `~/models/opencv`; `FACE_VENV=.venv-speaker` dopisuje pakiety do istniejącego venv) | `curl -LsSf https://astral.sh/uv/install.sh \| sh`, potem `bash scripts/py/setup-face.sh` | krok `--faces` `skipped` z powodem „brak adaptera twarzy” |
| MetaAdsCollector (biblioteka reklam, `--ad-library`, `adlib`) | `uv tool install meta-ads-collector` | to samo | krok `--ad-library` `skipped`, `adlib` wypisuje Metę jako niedostępną |
| yt-dlp (kreacja reklamy z biblioteki Mety, `--ad-library`, `adlib get`) | `brew install yt-dlp` | `pipx install yt-dlp` | rekord bez kreacji, powód w wyniku |
| `google-cloud-bigquery` i konto Google (Google Ads Transparency, `adlib`) | `pip install google-cloud-bigquery` (w obrazie Dockera jest) oraz `gcloud auth application-default login` | to samo | źródło Google niedostępne, instrukcja w wyniku |
| model CLIP (`--clip`) | pobierany raz przy pierwszym użyciu (`Xenova/clip-vit-base-patch32`, ok. 350 MB) | to samo | krok `--clip` `skipped` (w Dockerze brak modelu) |
| Ollama (streszczenia, NER, `--text embedding`) | `brew install ollama`, `ollama pull hf.co/mradermacher/PLLuM-12B-instruct-2512-GGUF:Q5_K_M`, `ollama pull bge-m3` | [ollama.com/download](https://ollama.com/download) | `summarize` i `--ner` kończą się błędem połączenia; graf działa bez LLM |

`bun run media:smoke` sprawdza, które adaptery są dostępne. Zmienne środowiskowe (modele, ścieżki, limity): `.env.example` i [docs/TECHNICAL.md, punkt 10](TECHNICAL.md#10-konfiguracja). Zależności bibliotek: `package.json`; licencje: [LICENCJE.md](../LICENCJE.md).

**Twarze i głos.** `--faces` porównuje twarze z zamkniętą listą osób publicznych (127 wpisów w `data/osoby-publiczne.json`, 31 ze zdjęciami; źródła zdjęć w `data/faces/ZRODLA.md`), a `--speaker` dopasowuje głos do zamkniętej galerii 10 osób (w repozytorium tylko wektory `data/voices/index.json` i źródła nagrań `data/voices/ZRODLA.md`). Wynik to „podobna twarz do X (0,xx)” albo „głos podobny do X (0,xx)” do przeglądu przez człowieka, nigdy „to jest X”, i działa tylko jako cecha grupy podobnych kampanii. Wektory twarzy nie są zapisywane. Progi, zmienne i dodawanie osób: [docs/TECHNICAL.md, punkty 4.14 i 4.16](TECHNICAL.md#414-persona-z-twarzy-libmediafacets-od-21112026-zadanie-i5).

## Usługi z kluczami

Wszystkie opcjonalne. Domyślna konfiguracja nie wymaga żadnego klucza ani konta i nie wysyła zapytań.

| Usługa | Jak zdobyć dostęp | Zmienna | Bez niej |
|---|---|---|---|
| **Anthropic API** (dostawca LLM) | konto na [console.anthropic.com](https://console.anthropic.com) → „API keys” → utwórz klucz | `ANTHROPIC_API_KEY` w `.env` (albo `LLM_PROVIDER=anthropic` z profilem `ant auth login`) | LLM domyślnie lokalny (Ollama); bez żadnego LLM działa wszystko poza streszczeniami i `--ner`. Używaj tylko wtedy, gdy wolno wysyłać dane na zewnątrz |
| **urlscan.io** (kopie martwych stron, `--archive`, `watch`) | darmowe konto na [urlscan.io](https://urlscan.io) → profil → „API Keys”; wyszukiwanie anonimowe obejmuje 30 dni i ok. 100 zapytań na godzinę | `URLSCAN_API_KEY` w `.env` | wyszukiwanie działa, ale bez kodu (DOM) zapisanych stron: kopia daje wtedy adresy i hashe zasobów, a kod strony bierze się z Wayback, jeśli tam jest |
| **Internet Archive (Wayback)** (`--archive`) | bez klucza i konta | – | – |
| DNS, RDAP (`rdap.org`), crt.sh, Team Cymru, logi CT | bez klucza i konta | – | zapytania tylko z `--live` / `--lookups`; bez nich cechy sieciowe pochodzą z zapisów w materiale |
| Ollama, modele Hugging Face | bez klucza (modele publiczne) | `OLLAMA_HOST`, `CLIP_MODEL` | zob. [Bez Dockera](#bez-dockera) |

Klucze trzymaj w `.env` (jest w `.gitignore`). W repozytorium jest tylko `.env.example` bez wartości.

### Biblioteki reklam: jak uzyskać dostęp

Publiczne biblioteki reklam (repozytoria wymagane przez DSA) dają identyfikator reklamy, reklamodawcę, daty emisji i kreacje.

| Biblioteka | Jak uzyskać dostęp | Uwagi |
|---|---|---|
| **Meta Ad Library** | bez klucza: `uv tool install meta-ads-collector` (MetaAdsCollector, nieoficjalny publiczny endpoint, ryzyko opisane w [LICENCJE.md](../LICENCJE.md)). Oficjalne Ad Library API (weryfikacja tożsamości na [facebook.com/id](https://www.facebook.com/id), aplikacja na [developers.facebook.com](https://developers.facebook.com), token) nie jest używane w kodzie | wyszukiwanie po frazie, stronie, kraju i dacie; `get` po identyfikatorze biblioteki |
| **Google Ads Transparency Center** | konto Google i projekt z sandboxem BigQuery: `gcloud auth application-default login` i `gcloud config set project <projekt>`; bez ADC działa CLI `bq` (`gcloud auth login`) | publiczny zbiór BigQuery (EOG i Turcja), bez scrapingu; każde zapytanie ma limit `ADLIB_BQ_MAX_BYTES` (domyślnie 10 GiB); zbiór nie ma domeny docelowej ani tekstu reklamy. Koszt i rozmiary kolumn: [docs/ZRODLA-METADANYCH.md](ZRODLA-METADANYCH.md) |
| **TikTok Commercial Content Library** | wniosek o dostęp do API (odpowiedź do 2 dni roboczych, możliwe tylko dla badaczy); potem `TIKTOK_CLIENT_KEY` i `TIKTOK_CLIENT_SECRET` w `.env` | adapter na syntetycznych odpowiedziach, nie sprawdzony na żywo |
| **X (repozytorium reklam DSA)** | ręcznie pobierz eksport CSV z repozytorium reklam X (konto, kraj, zakres dat; opis: [docs/ZRODLA-METADANYCH.md](ZRODLA-METADANYCH.md)) i podaj plik: `--x-file eksport.csv` albo `X_ADS_FILE` | program niczego nie pobiera z X; kolumn eksportu nie sprawdzono na prawdziwym pliku |

## Bezpieczeństwo i dane

- **Przetwarzanie lokalne.** Materiały nie opuszczają komputera. Wyjątek: dostawca Anthropic (opt-in, klucz) wysyła teksty do zewnętrznego API.
- **Zapytania wychodzące tylko na wyraźne żądanie:** `--live` (jedno pobranie strony, której nie ma w materiale, oraz DNS, RDAP, ASN), `--lookups` (DNS, RDAP, ASN przy imporcie spraw; `--ct` dodaje crt.sh), `--archive` (urlscan.io, Internet Archive), `--ad-library` (biblioteka reklam Mety, kreacja przez yt-dlp), `adlib` (biblioteki reklam: Meta przez MetaAdsCollector, Google przez publiczny zbiór BigQuery), `--cloaking` (dwa dodatkowe pobrania z różnymi User-Agentami; domyślnie wyłączone, nie jest metodą wykrywania, zob. metodyka). Obraz Dockera ma `ANALYZE_OFFLINE=1`, a żądania z przeglądarki nie mogą tego wyłączyć.
- **Nie renderujemy stron i nie wykonujemy JavaScriptu.** Adresy przekierowań i backendy są czytane statycznie. Pobieranie stron ma ochronę SSRF (blokada adresów prywatnych, loopback, metadanych chmury).
- **Rozbrojone adresy.** Adresy z materiałów są w interfejsie pokazywane w formie nieklikalnej (`hxxps://oferta[.]example`), żeby przypadkowe kliknięcie nie otworzyło strony.
- **Gdzie leżą pliki:** `./dane` (wejście, baza, wyniki, `./dane/praca` z wgraniami z GUI), `.cache/` (odpowiedzi sieciowe i wektory głosu, TTL od 1 dnia do 28 dni), `data/work/` (archiwum stron). Usunięcie: `rm -rf dane/praca .cache data/work`; wektory głosu: `rm -rf .cache/speaker`.

## Czego narzędzie nie robi

- Nie loguje się na cudze konta i nie obchodzi zabezpieczeń (art. 267 k.k.); nie sonduje hostów aktywnie.
- Przestrzega warunków korzystania ze źródeł (np. nieoficjalny endpoint biblioteki reklam jest opcją z opisanym ryzykiem).
- Nie wydaje nakazów ani decyzji: proponuje powiązania, o zgłoszeniu decyduje człowiek.
- Nie renderuje stron i nie wykonuje ich JavaScriptu.
- Nie rozpoznaje twarzy ani głosu spoza zamkniętych list osób publicznych (31 dla twarzy, 10 dla głosu) i nie ocenia, czy twarz lub głos są prawdziwe; nie ocenia pojedynczej reklamy jako fałszywej ani nie wykrywa klonów głosu (uzasadnienie: [docs/METODYKA.md, punkt 13](METODYKA.md#13-czego-nie-robimy-i-dlaczego)).

## Pochodzenie danych

| Dane | Skąd | Czy trafia do repozytorium |
|---|---|---|
| Próbka `data/sample/`, testy, fixtures | wygenerowane skryptem `scripts/gen-sample.ts`, w całości syntetyczne (fikcyjne osoby, domeny `.example`/`.test`, adresy IP z puli dokumentacyjnej) | tak |
| Próbka organizatora (sprawy z zapowiedzi zadania, sprawy od organizatora) | organizator zadania | **nie**: tylko lokalnie, poza repozytorium i jego historią; wartości z niej w testach zastąpiono syntetycznymi |
| Skany **urlscan.io** (zrzut, lista żądań odtworzona jako HAR, strona wyniku) | publiczne wyniki wyszukiwania | nie; każdy materiał zebrany z sieci ma plik `zrodlo.json` z adresem źródła i datą dostępu |
| **Certificate Transparency** (crt.sh, strumień CT) | publiczne logi | nie (tylko `.cache/` i `data/work/`, poza repozytorium) |
| **RDAP** (`rdap.org`) i **DNS**, Team Cymru (ASN) | publiczne zapytania pasywne | nie (`.cache/`); w trybie importu spraw odpowiedzi zapisuje `provenance.json` (data, czy były zapytania, domeny bez odpowiedzi) |
| **Lista Ostrzeżeń CERT Polska** (`hole.cert.pl`) | publiczne API | nie |
| **Biblioteki reklam** (Meta, `--ad-library`) | publiczna strona, przez MetaAdsCollector | nie (`.cache/`) |
| Przykład wzorca nazw domen z publicznego komunikatu CSIRT KNF | publiczny komunikat | tak, w jednym teście |

Każdy materiał zebrany z sieci przez narzędzia zbierające ma w `zrodlo.json` źródło (adres i datę dostępu), a import spraw zapisuje `provenance.json` obok wyniku. Lista obserwowanych osób nie jest dołączona (w próbce są tylko fikcyjne). Gotową bazę i wiedzę z danych poufnych opisuje [docs/DANE-NIEPUBLICZNE.md](DANE-NIEPUBLICZNE.md). Walidacja na materiałach spoza próbki: [docs/METODYKA.md](METODYKA.md#walidacja-na-materiałach-spoza-próbki).

## Licencje

Kod: MIT ([LICENSE](../LICENSE)). Licencje wszystkich bibliotek, modeli, narzędzi i usług, z kontrolą składników niekomercyjnych: [LICENCJE.md](../LICENCJE.md).

## Pochodzenie kodu

Szkielet narzędzi OSINT i grafowych autor przygotował przed wydarzeniem, 18–20.11.2026, w osobnym prywatnym repozytorium. W trakcie wydarzenia (od 21.11.2026, 11:00) prace trwały dalej. Kod trafił do tego repozytorium bez wcześniejszej historii git, bo lokalne commity z 21.11 miały w testach wartości z materiałów organizatora; tutaj zastąpiono je wartościami syntetycznymi o tej samej strukturze, więc testy sprawdzają to samo. Lista plików sprzed wydarzenia, zmian z 20–21.11 i funkcji z 21–22.11: [docs/POCHODZENIE-KODU.md](POCHODZENIE-KODU.md).

Mapa katalogów i modułów: [docs/TECHNICAL.md, punkt 3](TECHNICAL.md#3-moduły).

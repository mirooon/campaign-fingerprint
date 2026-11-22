# Odcisk kampanii

Narzędzie, które łączy pojedyncze materiały o oszukańczych reklamach (zrzuty ekranu, zapisane strony, pliki HAR, nagrania, linki) w kampanie i grupy podobnych kampanii, a nowy materiał ocenia względem bazy znanych kampanii. Działa bez internetu i bez kluczy (sprawdzone w kontenerze z `--network none`).

Projekt powstaje na HackNation 2026 (21–22.11.2026), zadanie „Kolekcjoner fejków”.

**Dane:** repozytorium nie zawiera materiałów udostępnionych przez organizatora. Dane przykładowe i testowe są syntetyczne. Skąd pochodzą dane i z jakich źródeł narzędzie korzysta: [Pochodzenie danych](#pochodzenie-danych).

**Dokumenty:** [docs/METODYKA.md](docs/METODYKA.md) (jak łączymy materiały, dla osoby oceniającej) · [LICENCJE.md](LICENCJE.md) (licencje bibliotek, modeli, narzędzi i usług) · [docs/TECHNICAL.md](docs/TECHNICAL.md) (formaty, wagi, CLI, konfiguracja) · [docs/GUI.md](docs/GUI.md) (jak przeprowadzić analizę w przeglądarce) · [docs/ZGODNOSC.md](docs/ZGODNOSC.md) (AI Act, RODO, DSA).

## 1. Szybki start w Dockerze

Wymagania: Docker z Compose v2. Pierwsza budowa obrazu trwa 2,5–3 minuty (pomiar z I7), kolejne ok. 40–50 sekund; gdy obraz już jest, `up -d` startuje od razu. Obraz `odcisk-kampanii:latest` ma 2,7 GB na dysku (670 MB skompresowany) i zawiera bun, zbudowany interfejs, tesseract (polski), ffmpeg, chromaprint i Pythona. Pliki wymieniasz z kontenerem przez katalog `./dane` (w kontenerze `/dane`).

```bash
docker compose up -d                                                # GUI na http://localhost:3000
docker compose run --rm app bun run base -- --cases /dane/probka    # baza znanych kampanii z próbki (./dane/probka)
docker compose run --rm app bun run analyze-material -- --cases /dane/nowe --csv /dane/wynik.csv
```

Katalog `./dane/probka` to Twoja próbka znanych kampanii: każdy podkatalog to jedna sprawa (zapisana strona, HAR, zrzut). `./dane/nowe` to materiały do oceny; luźne pliki zamiast spraw: dopisz `--each-file`. Baza trafia do `./dane/baza`, a GUI czyta ją po odświeżeniu strony. Bez bazy GUI działa i podpowiada, żeby uruchomić `bun run base`.

**Bez własnych danych** (syntetyczne przykłady z repozytorium):

```bash
docker compose run --rm app bun run demo                            # baza + 8 materiałów, wynik w ./dane/demo/wynik/
docker compose run --rm app bun run demo-batch -- --out /dane       # ./dane/syntetyczne (4 sprawy) i ./dane/syntetyczne-nowe (luźne pliki)
docker compose run --rm app bun run base -- --cases /dane/syntetyczne
docker compose run --rm app bun run analyze-material -- --cases /dane/syntetyczne-nowe --each-file --csv /dane/wynik.csv
```

`demo` pokazuje werdykty `known_campaign`, `similar_campaigns`, `duplicate`, `insufficient` i `new_campaign`, m.in. martwą stronę (tylko zrzut z paskiem adresu; ma werdykt `new_campaign` z cechami z nagranych RDAP/DNS) i trzy strony jednej nowej kampanii ze zmienionymi domenami i twarzami. Bazę z `demo` obejrzysz w GUI: `VIEWER_DATA_DIR=/dane/demo/baza docker compose up -d`.

Kontener działa bez sieci: pomija pobieranie stron, DNS i RDAP, a kroki wymagające modeli (transkrypcja mowy, głos, CLIP) są w wyniku oznaczone jako `skipped` z powodem. Modele twarzy (YuNet, SFace, ok. 40 MB) są w obrazie, więc `--faces` działa też w kontenerze. Komunikaty `[base] asr/clip/lookups: skipped …` podczas `base` są więc oczekiwane, to nie błąd (np. CLIP: brak lokalnego modelu). Profil `full` (`docker compose --profile full up -d app-full`) dodaje whisper.cpp i SpeechBrain na CPU; modele zostają na hoście i są montowane tylko do odczytu (zmienne `WHISPER_MODEL_DIR`, `SPEAKER_MODEL_HOST`, zob. `docker-compose.yml`).

### Wynik: kolumny CSV

Jeden wiersz na materiał (kolejność kolumn jest stała; to samo zwraca eksport z GUI):

| Kolumna | Znaczenie |
|---|---|
| `material_id` | identyfikator materiału (nazwa sprawy albo pliku) |
| `case` | sprawa, z której pochodzi materiał (przy `--each-file` zwykle to samo co `material_id`) |
| `verdict` | `known_campaign`, `similar_campaigns`, `new_campaign`, `duplicate` albo `insufficient` |
| `campaign_id` | kampania z bazy (`K01`…), do której materiał należy; przy `duplicate` to kampania oryginału; puste, gdy nie ma |
| `similar_campaigns` | kampanie z bazy podobne do materiału, rozdzielone `;` |
| `new_campaign_id` | numer nowej kampanii (`N1`…) w tej partii; materiały z jednej partii mogą tworzyć wspólną nową kampanię |
| `duplicate_of` | gdy `duplicate`: materiał, którego kopią jest ten wiersz |
| `confidence` | `certain`, `likely` albo `uncertain`: siła przesłanek, **nie prawdopodobieństwo** |
| `score` | wynik najlepszego powiązania, 0–1: siła przesłanek, nie prawdopodobieństwo; puste przy `insufficient` i `new_campaign` bez powiązań (wtedy `top_premise` też jest puste) |
| `top_premise` | najsilniejsza przesłanka prostym językiem (np. „ten sam serwer trackera”) |
| `missing_data` | gdy `insufficient`: co dorzucić do materiału (lista rozdzielona `;`) |

## 2. Jak przeanalizować własne materiały

**Przeglądarka** (`http://localhost:3000`, zakładka „Analizuj materiał”): upuść pliki, folder albo zip (zrzut, zapisana strona, HAR, wideo) albo wklej link lub tekst reklamy; sprawdź podział na sprawy; „Analizuj”. Wynik to lejek werdyktów, tabela z sortowaniem i karta wyniku z przesłankami; eksport CSV i JSON. Zakładka „Kampanie” pokazuje bazę, „Porównaj” dwa materiały obok siebie, „Graf powiązań” i „Tryb eksperta” pełny graf. Opis kroków: [docs/GUI.md](docs/GUI.md).

**Wiersz poleceń** (`analyze-material`; w Dockerze poprzedź `docker compose run --rm app`):

```bash
bun run analyze-material -- --case sprawa/                      # jedna sprawa (katalog z plikami)
bun run analyze-material -- --cases partia/ --csv wynik.csv     # partia: każdy podkatalog to sprawa
bun run analyze-material -- --cases pliki/ --each-file          # każdy luźny plik to osobny materiał
bun run analyze-material -- --dataset zbior.csv --mapping m.json  # CSV/JSON/JSONL: wiersz to materiał
bun run analyze-material -- --url https://oferta.example/       # sam link (pobranie strony tylko z --live)
bun run analyze-material -- --url https://oferta.example/ --archive  # martwa strona: publiczna kopia z urlscan.io lub Internet Archive
bun run analyze-material -- --text "Ewa Przykładowa poleca…"   # sam tekst reklamy
```

**Strony, które już nie odpowiadają.** Z `--archive` narzędzie dla martwego adresu (bez odpowiedzi albo z planszą blokady) szuka publicznej kopii strony w urlscan.io (istniejące skany) i w Internet Archive (Wayback) i dokłada ją do materiału z podaniem źródła, adresu kopii i jej daty. Krok jest opcjonalny i pasywny (nie zleca skanów, nie zapisuje stron do archiwum); źródła wybiera `ARCHIVE_SOURCES` (domyślnie `urlscan,wayback`), klucz urlscan (`URLSCAN_API_KEY`, darmowe konto, sekcja 6) jest opcjonalny i dokłada kod zapisanej strony. Bez sieci lub przy `ANALYZE_OFFLINE=1` krok jest pomijany z powodem w wyniku.

Ocena partii na własnych etykietach (plik `{"kampania": ["sprawa", …]}` albo `{"sprawa": "kampania"}`): F1 par i B-cubed jednym poleceniem.

```bash
bun run evaluate -- --csv wynik.csv --labels etykiety.json        # --json: wynik jako JSON
```

Minimum plików (pomiar na 111 wariantach 25 spraw, [docs/METODYKA.md](docs/METODYKA.md#odporność-na-niepełne-zgłoszenia)): zapisana strona (HTML albo HAR) wystarcza do przypisania do znanej kampanii; sam zrzut albo samo wideo bez strony zwykle nie, i wtedy narzędzie zgłasza brak danych (`insufficient`, „podobne kampanie” albo „nowa kampania”) z listą braków w `missing_data` (link do strony, plik HAR, zrzut reklamy) zamiast zgadywać; żaden wariant nie trafił do cudzej kampanii. Obrazy w formacie HEIC import pomija i podaje to w powodzie: zapisz je jako PNG albo JPEG.

Dodatkowe opcje: `--data <katalog bazy>` (domyślnie `VIEWER_DATA_DIR`), `--json wynik.json`, `--live` (pasywne DNS/RDAP/ASN i jedno pobranie strony), `--asr`, `--audio`, `--clip`, `--speaker`, `--faces`, `--ad-library`, `--add-to-base` (z `--force`). Pełna lista: `bun run analyze-material -- --help`. Bazę buduje `bun run base -- --cases <katalog spraw>` (opcje: `--out`, `--offline`, `--lookups`, `--labels`, `--config`). Nowy materiał trafia do jednego grafu ze znanymi i dostaje werdykt; reguły i progi: [docs/METODYKA.md](docs/METODYKA.md).

**Baza rośnie.** Z `--add-to-base` po analizie materiały wchodzą do bazy z `--data` (rekordy i dane z porównania, graf i kampanie przebudowane offline, bez sieci), więc drugi materiał nowej kampanii znajduje pierwszy. Istniejące kampanie zachowują numery, nowe dostają kolejne. Duplikat nie jest dopisywany, „za mało danych” tylko z `--force`. Poprzednie pliki bazy: `<baza>/historia/<czas>/`, wpisy: `<baza>/dodane.jsonl`.

```bash
bun run analyze-material -- --case sprawa/ --data dane/baza --add-to-base
```

### Harmonogram skanów: nowe domeny i reklamy znanych kampanii

`bun run watch` co jakiś czas pyta publiczne źródła (logi CT, biblioteki reklam, urlscan, Lista Ostrzeżeń CERT) o nowe adresy, każdy przepuszcza przez analizę względem bazy i dopisuje wiersz `{ts, source, url, verdict, campaign}` do `data/watch.jsonl` (widoczny w zakładce feedu CT). Źródło bez sieci albo klucza jest pomijane z powodem, reszta działa dalej.

```bash
# demo bez internetu: zapisane wiadomości CertStream i przykładowe (syntetyczne) przepisy
bun run watch -- --data data --once --sources ct --replay data/sample/ct-stream.jsonl --recipes data/examples/watch-przepisy.example.json
# w kontenerze, bez sieci
docker compose run --rm app bun run watch -- --data /dane/baza --once --sources ct --replay /dane/ct-stream.jsonl
# na żywo, co 30 minut (potrzebny lokalny strumień: docker compose --profile ct up -d certstream)
bun run watch -- --data dane/baza --every 30m --recipes przepisy.json --add-to-base
```

Klucz urlscan (`URLSCAN_API_KEY`, darmowe konto, sekcja 6) jest opcjonalny. Przepisy wyszukiwania (zapytanie, źródło, filtr potwierdzający, częstotliwość) to plik JSON wskazany `--recipes` albo `WATCH_RECIPES`; format pokazuje `data/examples/watch-przepisy.example.json`, a przepisy z wartościami prawdziwych kampanii trzymaj poza repozytorium (`--seed-recipes plik.json` robi je z bazy). `--add-to-base` dopisuje do bazy tylko trafienia z werdyktem z `--add-verdicts` (domyślnie `known_campaign`).

### Jak zebrać materiał

| Co masz | Jak zapisać | Co z tego narzędzie bierze |
|---|---|---|
| strona docelowa | w przeglądarce: „Zapisz jako… → Strona internetowa, kompletna” (powstaje plik i folder `<nazwa>_files`) | treść, formularze, skrypty, komentarze, kit strony |
| przebieg wizyty | DevTools → Network → „Save all as HAR with content”. Uwaga: opcja „sanitized” usuwa nagłówki i ciasteczka, a otwarte DevTools zmienia zachowanie niektórych stron; zapisuj HAR bez „sanitized” | adresy IP, żądania, przekierowania, treść odpowiedzi |
| reklama | zrzut ekranu z **widocznym paskiem adresu** przeglądarki (domena z paska zastępuje brak linku) | kreacja, OCR, domena |
| nagranie | nagranie ekranu z dźwiękiem; opis `.info.json` (yt-dlp) | klatki, transkrypcja, odcisk dźwięku, reklamodawca |
| reklama z biblioteki reklam | link do reklamy i zrzut z widocznym „Identyfikatorem biblioteki” | identyfikator biblioteki, płatnik (z `--ad-library`) |

Podpowiedzi „Co dorzucić” w wyniku (`missing_data`) odpowiadają tym krokom: „link do reklamy albo strony docelowej” i „zrzut z widocznym paskiem adresu” (brak adresu), „plik HAR z wizyty na stronie” (brak zapisanej strony), „zrzut ekranu reklamy” (brak obrazu), „pełna treść reklamy” (mniej niż 5 słów).

## 3. Metodyka w 10 zdaniach

1. Z każdego materiału wyciągamy ślady w pięciu rodzinach: tekst i osoby, wygląd, strona, infrastruktura, platforma i identyfikatory.
2. Każdy ślad ma wagę zależną od rodzaju (backend formularza waży więcej niż IP).
3. Waga maleje, gdy ślad jest wspólny dla wielu niezwiązanych stron: Cloudflare, platformy, skracacze, biblioteki (zniżka) i gdy występuje w dużej części zbioru (odwrotna częstość).
4. Cechy platformy, a nie operatora (identyfikator maszyny, pliki platformy stron) dostają ×0,1.
5. Przesłanki jednej pary łączymy wzorem noisy-OR: dwie niezależne po 0,5 dają 0,75.
6. Kampanię tworzą silne dowody (union-find) albo kilka różnych rodzajów dowodów; sam szablon strony, sam tekst albo sama persona kampanii nie tworzą.
7. Słabsze powiązania dają grupy podobnych kampanii (Louvain na grafie ważonym).
8. Wybraliśmy jawne reguły zamiast grupowania bez nadzoru, bo każde połączenie ma się dać wyjaśnić.
9. Nowy materiał trafia do znanej kampanii, do nowej kampanii podobnej do znanych albo jest nową kampanią; duplikat i „za mało danych” to osobne werdykty.
10. `confidence` i `score` mówią o sile przesłanek, nie o prawdopodobieństwie; progi dobraliśmy na 25 sprawach próbki, a etykiety są nasze (rozdział „Walidacja i ograniczenia” w metodyce).

Pełny opis: [docs/METODYKA.md](docs/METODYKA.md).

## 4. Kryteria oceny: gdzie to zobaczyć

| Kryterium | Funkcja | Polecenie albo ekran |
|---|---|---|
| Metoda korelacji i grupowania | wagi, reguły kampanii, union-find, Louvain, wyjaśnienie każdej krawędzi | [docs/METODYKA.md](docs/METODYKA.md); `lib/graph/`; `bun run evaluate`; GUI: „Porównaj” |
| Cechy i źródła danych | pięć rodzin cech, ekstrakcja ze strony, HAR, zrzutu, nagrania; źródła publiczne | `bun run enrich -- --help`; sekcja [Pochodzenie danych](#pochodzenie-danych); `lib/osint/`, `lib/media/` |
| Demonstrator end-to-end | baza → analiza nowego materiału → CSV i GUI | `docker compose run --rm app bun run demo`; GUI: „Analizuj materiał” |
| Czytelność powiązań | przesłanki prostym językiem, siła, pewność, powód rozdzielenia | GUI: karta wyniku, „Porównaj”, „Jak to działa”; kolumna `top_premise` |
| Wdrożenie i przenośność | Docker bez sieci i kluczy, tryb lokalny, konfiguracja plikiem | sekcje 1 i 5; `docker-compose.yml`; `.env.example` |
| Wiedza | metodyka, licencje, dokumentacja techniczna, pochodzenie kodu | `docs/METODYKA.md`, `LICENCJE.md`, `docs/TECHNICAL.md` |

## 5. Tryb lokalny bez Dockera

Rdzeń (graf, kampanie, przeglądarka) potrzebuje tylko buna ≥ 1.4 (Node ≥ 20 dla Next.js). Pozostałe narzędzia są opcjonalne: bez żadnego z nich działa reszta, a odpowiedni krok jest w wyniku oznaczony jako `skipped` z powodem.

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
| whisper-cli i model (transkrypcja, `--asr`) | `brew install whisper-cpp`; model `ggml-large-v3-turbo.bin` (ok. 1,5 GB) do `~/models/whisper/` | zbuduj [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (`cmake`); ten sam model | krok `--asr` `skipped` |
| SpeechBrain i modele głosu (`--speaker`: wektor mówcy, galeria osób, detekcja mowy) | `brew install uv`, potem `bash scripts/py/setup-speaker.sh` (venv `.venv-speaker`, modele ECAPA ok. 85 MB i VAD ok. 0,5 MB do `~/models/speechbrain`) | `curl -LsSf https://astral.sh/uv/install.sh \| sh`, potem `bash scripts/py/setup-speaker.sh` | krok `--speaker` `skipped` |
| OpenCV, YuNet i SFace (twarze, `--faces`) | `brew install uv`, potem `bash scripts/py/setup-face.sh` (venv `.venv-face`, modele ok. 40 MB do `~/models/opencv`; `FACE_VENV=.venv-speaker` dopisuje pakiety do istniejącego venv) | `curl -LsSf https://astral.sh/uv/install.sh \| sh`, potem `bash scripts/py/setup-face.sh` | krok `--faces` `skipped` z powodem „brak adaptera twarzy” |
| MetaAdsCollector (biblioteka reklam, `--ad-library`, `adlib`) | `uv tool install meta-ads-collector` | to samo | krok `--ad-library` `skipped`, `adlib` wypisuje Metę jako niedostępną |
| yt-dlp (kreacja reklamy z biblioteki Mety, `--ad-library`, `adlib get`) | `brew install yt-dlp` | `pipx install yt-dlp` | rekord bez kreacji, powód w wyniku |
| `google-cloud-bigquery` i konto Google (Google Ads Transparency, `adlib`) | `pip install google-cloud-bigquery` (w obrazie Dockera jest) oraz `gcloud auth application-default login` | to samo | źródło Google niedostępne, instrukcja w wyniku |
| model CLIP (`--clip`) | pobierany raz przy pierwszym użyciu (`Xenova/clip-vit-base-patch32`, ok. 350 MB) | to samo | krok `--clip` `skipped` (w Dockerze brak modelu) |
| Ollama (streszczenia, NER, `--text embedding`) | `brew install ollama`, `ollama pull hf.co/mradermacher/PLLuM-12B-instruct-2512-GGUF:Q5_K_M`, `ollama pull bge-m3` | [ollama.com/download](https://ollama.com/download) | `summarize` i `--ner` kończą się błędem połączenia; graf działa bez LLM |

**Twarze (`--faces`).** Krok szuka twarzy w obrazie reklamy, zrzutach i klatkach wideo (tych samych, które bierze CLIP) i porównuje je z **zamkniętą listą osób publicznych** (127 wpisów w `data/osoby-publiczne.json`, z czego 31 ze zdjęciami twarzy; reszta tylko jako persona z tekstu; zdjęcia ze źródłem, autorem i licencją w `data/faces/ZRODLA.md`). Wynik to „podobna twarz do X (0,xx)” do przeglądu człowieka, a nie „to jest X”; trafia do pola `faces` materiału i do persony jako cecha **grupy** podobnych kampanii, nigdy jako dowód jednej kampanii. Wektory twarzy nie są zapisywane. Zmienne: `FACE_PYTHON` (interpreter venv, domyślnie `.venv-face/bin/python`), `FACE_MODEL_DIR` (domyślnie `~/models/opencv`). Własne osoby (np. instytucja, która chce rozpoznawać inne osoby ze swoich ostrzeżeń): dopisz wpis z `source` (publiczne ostrzeżenie) do `data/osoby-publiczne.json`, wrzuć 3–5 zdjęć z wolną licencją do `data/faces/<id>/` (id = nazwisko bez polskich znaków, małymi, z myślnikami), wpisz je do `data/faces/ZRODLA.md` i `LICENCJE.md`, po czym `python3 -I scripts/py/face_embed.py --build-index data/faces` (z `FACE_PYTHON`). Nie buduj bazy zdjęć z sieci hurtem (AI Act art. 5 ust. 1 lit. e).

**Głos (`--speaker`).** Krok liczy wektor mówcy z wideo (łączenie materiałów z tym samym głosem) i dopasowuje okna dźwięku (4 s, krok 2 s) do **zamkniętej galerii 10 osób publicznych** (ta sama lista co dla twarzy, `data/osoby-publiczne.json`; w repozytorium tylko wektory `data/voices/index.json` i źródła nagrań `data/voices/ZRODLA.md`, nagrań nie ma). Wynik to **„głos podobny do X (0,57)”**, nigdy „to jest głos X”: pole `voices` materiału (przedziały `start`/`end` w sekundach, `persona`, `similarity`) i persona jako cecha **grupy** podobnych kampanii, nie dowód jednej kampanii. Reguła: kosinus ≥ 0,5, przewaga ≥ 0,15 nad drugą osobą, co najmniej 2 sąsiednie okna; ciche okna i z samą muzyką są odrzucane (docs/METODYKA.md). Bez venv albo modeli krok jest `skipped` z powodem (w Dockerze tylko profil `full`). Zmienne: `SPEAKER_PYTHON`, `SPEAKER_MODEL_DIR`, `SPEAKER_VAD_DIR`. Detektora klonu głosu nie ma. **Dodanie osoby:** wpis ze `source` w `data/osoby-publiczne.json`, 5–8 polskich nagrań tej osoby (wystąpienia, wywiady) w pliku źródeł (JSON: `set: "gallery"`, `person`, `url`, `start`, `seconds` 30–120), potem `.venv-speaker/bin/python -I scripts/py/build_voice_index.py --sources <plik> --work-dir <katalog poza repozytorium> --model-dir ~/models/speechbrain/spkrec-ecapa-voxceleb --vad-dir ~/models/speechbrain/vad-crdnn-libriparty --index data/voices/index.json --zrodla data/voices/ZRODLA.md --persons-file data/osoby-publiczne.json` (pobiera fragmenty yt-dlp, zapisuje wektory i listę źródeł; nagrania zostają w katalogu roboczym). Pomiar progu i fałszywych trafień: `bun run voice:eval -- --work-dir <katalog>`.

`bun run media:smoke` sprawdza, które adaptery są dostępne. Zmienne środowiskowe (modele, ścieżki, limity): `.env.example` i [docs/TECHNICAL.md §10](docs/TECHNICAL.md#10-konfiguracja). Zależności bibliotek: `package.json`, licencje: [LICENCJE.md](LICENCJE.md).

## 6. Usługi z kluczami

Wszystkie opcjonalne. Domyślna konfiguracja nie wymaga żadnego klucza ani konta i nie wysyła zapytań.

| Usługa | Jak zdobyć dostęp | Zmienna | Bez niej |
|---|---|---|---|
| **Anthropic API** (dostawca LLM) | konto na [console.anthropic.com](https://console.anthropic.com) → „API keys” → utwórz klucz | `ANTHROPIC_API_KEY` w `.env` (albo `LLM_PROVIDER=anthropic` z profilem `ant auth login`) | LLM domyślnie lokalny (Ollama); bez żadnego LLM działa wszystko poza streszczeniami i `--ner`. Używaj tylko wtedy, gdy wolno wysyłać dane na zewnątrz |
| **urlscan.io** (kopie martwych stron, `--archive`) | darmowe konto na [urlscan.io](https://urlscan.io) → profil → „API Keys”; wyszukiwanie anonimowe obejmuje 30 dni i ok. 100 zapytań na godzinę | `URLSCAN_API_KEY` w `.env` | wyszukiwanie działa, ale bez kodu (DOM) zapisanych stron: kopia daje wtedy adresy i hashe zasobów, a kod strony bierze się z Wayback, jeśli tam jest |
| **Internet Archive (Wayback)** (`--archive`) | bez klucza i konta | – | – |
| **Oficjalne Ad Library API Mety** | weryfikacja tożsamości na [facebook.com/id](https://www.facebook.com/id) i aplikacja na [developers.facebook.com](https://developers.facebook.com); token dostępu | – (nieużywane w kodzie; zastąpiłoby nieoficjalny endpoint MetaAdsCollector) | `--ad-library` używa MetaAdsCollector bez klucza (z ryzykiem opisanym w [LICENCJE.md](LICENCJE.md)) |
| DNS, RDAP (`rdap.org`), crt.sh, Team Cymru, logi CT | bez klucza i konta | – | zapytania tylko z `--live` / `--lookups`; bez nich cechy sieciowe pochodzą z zapisów w materiale |
| Ollama, modele Hugging Face | bez klucza (modele publiczne) | `OLLAMA_HOST`, `CLIP_MODEL` | zob. sekcja 5 |

Klucze trzymaj w `.env` (jest w `.gitignore`). W repozytorium jest tylko `.env.example` bez wartości.

### Biblioteki reklam: jak uzyskać dostęp

Publiczne biblioteki reklam (repozytoria wymagane przez DSA) dają identyfikator reklamy, reklamodawcę, daty emisji i kreacje. Polecenie `adlib` szuka w nich i zapisuje wyniki jako sprawy dla `analyze-material`, więc reklamy z różnych platform łączą się w kampanie po infrastrukturze, a wyszukiwanie daje nowe materiały do sprawdzenia. **Żadna z bibliotek nie obiecuje trafień:** wyszukiwanie w Google Ads Transparency nie dało materiałów dla rodzin kampanii z próbki.

```bash
bun run adlib -- search --platform all --keyword "inwestycja" --country PL --out dane/adlib   # bez --keyword: domyślne frazy i nazwiska z listy osób
bun run adlib -- search --platform google --advertiser AR0123456789012345678 --out dane/adlib   # wszystkie reklamy tego reklamodawcy w EOG
bun run adlib -- get --platform meta --id <identyfikator biblioteki> --out dane/adlib          # jedna reklama (z kreacją, gdy jest yt-dlp)
bun run analyze-material -- --cases dane/adlib --csv wynik.csv
```

Źródło bez dostępu jest wypisane z powodem i instrukcją, a polecenie kończy się kodem 0 (też bez sieci i bez kluczy).

Rozszerzanie znanej kampanii: `bun run adlib -- expand --campaign K01 --data dane/baza --out dane/adlib` szuka po kontach reklamodawców z bibliotek reklam, a po domenach kampanii tylko przez nieoficjalne RPC Google (`ADLIB_GOOGLE_RPC=1`, domyślnie wyłączone, ryzyko warunków serwisu: [docs/ZRODLA-METADANYCH.md](docs/ZRODLA-METADANYCH.md)).

| Biblioteka | Jak uzyskać dostęp | Uwagi |
|---|---|---|
| **Meta Ad Library** | bez klucza: `uv tool install meta-ads-collector` (MetaAdsCollector, nieoficjalny publiczny endpoint, ryzyko opisane w [LICENCJE.md](LICENCJE.md)); albo token oficjalnego API (weryfikacja tożsamości na facebook.com/id; nieużywany w kodzie) | wyszukiwanie po frazie, stronie, kraju i dacie; `get` po identyfikatorze biblioteki |
| **Google Ads Transparency Center** | konto Google i projekt z sandboxem BigQuery: `gcloud auth application-default login` i `gcloud config set project <projekt>`; bez ADC działa CLI `bq` (`gcloud auth login`) | publiczny zbiór BigQuery (EOG i Turcja), bez scrapingu; sandbox: 1 TiB miesięcznie; zapytanie jest liczone za przetworzone kolumny, więc każde ma limit `ADLIB_BQ_MAX_BYTES` (domyślnie 10 GiB; szczegóły i rozmiary kolumn: [docs/ZRODLA-METADANYCH.md](docs/ZRODLA-METADANYCH.md)). Zbiór nie ma domeny docelowej ani tekstu reklamy |
| **TikTok Commercial Content Library** | wniosek o dostęp do API (odpowiedź do 2 dni roboczych, możliwe tylko dla badaczy); potem `TIKTOK_CLIENT_KEY` i `TIKTOK_CLIENT_SECRET` w `.env` | adapter na syntetycznych odpowiedziach, nie sprawdzony na żywo ([docs/ZRODLA-METADANYCH.md](docs/ZRODLA-METADANYCH.md)) |
| **X (repozytorium reklam DSA)** | ręcznie pobierz eksport CSV z repozytorium reklam X (konto, kraj, zakres dat; opis: [docs/ZRODLA-METADANYCH.md](docs/ZRODLA-METADANYCH.md)) i podaj plik: `--x-file eksport.csv` albo `X_ADS_FILE` | program niczego nie pobiera z X; kolumny eksportu nie sprawdzono na prawdziwym pliku |

## 7. Bezpieczeństwo i dane

- **Przetwarzanie lokalne.** Materiały nie opuszczają komputera. Wyjątek: dostawca Anthropic (opt-in, klucz) wysyła teksty do zewnętrznego API.
- **Zapytania wychodzące tylko na wyraźne żądanie:** `--live` (jedno pobranie strony, której nie ma w materiale, oraz DNS, RDAP, ASN), `--lookups` (DNS, RDAP, ASN przy imporcie spraw; `--ct` dodaje crt.sh), `--ad-library` (biblioteka reklam Mety, kreacja przez yt-dlp), `adlib` (biblioteki reklam: Meta przez MetaAdsCollector, Google przez publiczny zbiór BigQuery), `--cloaking` (dwa dodatkowe pobrania z różnymi User-Agentami; domyślnie wyłączone, nie jest metodą wykrywania, zob. metodyka). Obraz Dockera ma `ANALYZE_OFFLINE=1`, a żądania z przeglądarki nie mogą tego wyłączyć.
- **Nie renderujemy stron i nie wykonujemy JavaScriptu.** Adresy przekierowań i backendy są czytane statycznie. Pobieranie stron ma ochronę SSRF (blokada adresów prywatnych, loopback, metadanych chmury).
- **Rozbrojone adresy.** Adresy z materiałów są w interfejsie pokazywane w formie nieklikalnej (`hxxps://oferta[.]example`), żeby przypadkowe kliknięcie nie otworzyło strony.
- **Gdzie leżą pliki:** `./dane` (wejście, baza, wyniki, `./dane/praca` z wgraniami z GUI), `.cache/` (odpowiedzi sieciowe i wektory głosu, TTL od 1 dnia do 28 dni), `data/work/` (archiwum stron). Usunięcie: `rm -rf dane/praca .cache data/work`; wektory głosu: `rm -rf .cache/speaker`.
- **Publiczny adres.** Przy udostępnianiu aplikacji ustaw `ANALYZE_OFFLINE=1`, `ANALYZE_RATE_LIMIT` (zapytań na klienta na okno; przekroczenie daje 429) i `MATERIAL_MAX_MB` (limit wgrania, 413) oraz reverse proxy podające `X-Forwarded-For`.

## 8. Czego narzędzie nie robi

- Nie loguje się na cudze konta i nie obchodzi zabezpieczeń (art. 267 k.k.); nie sonduje hostów aktywnie.
- Przestrzega warunków korzystania ze źródeł (np. nieoficjalny endpoint biblioteki reklam jest opcją z opisanym ryzykiem).
- Nie wydaje nakazów ani decyzji: proponuje powiązania, o zgłoszeniu decyduje człowiek.
- Nie renderuje stron i nie wykonuje ich JavaScriptu.
- Nie rozpoznaje twarzy ani głosu spoza zamkniętych list osób publicznych (31 dla twarzy, 10 dla głosu) i nie ocenia, czy twarz lub głos są prawdziwe; nie ocenia pojedynczej reklamy jako fałszywej ani nie wykrywa klonów głosu (uzasadnienie: [docs/METODYKA.md](docs/METODYKA.md#10-czego-nie-robimy-i-dlaczego)).

## Pochodzenie danych

| Dane | Skąd | Czy trafia do repozytorium |
|---|---|---|
| Próbka `data/sample/`, testy, fixtures | wygenerowane skryptem `scripts/gen-sample.ts`, w całości syntetyczne (fikcyjne osoby, domeny `.example`/`.test`, adresy IP z puli dokumentacyjnej) | tak |
| Próbka dostarczona przez właściciela danych (sprawy z zapowiedzi zadania, paczka od jury) | organizator zadania | **nie**: tylko lokalnie, poza repozytorium i jego historią; wartości z niej w testach zastąpiono syntetycznymi |
| Skany **urlscan.io** (zrzut, lista żądań odtworzona jako HAR, strona wyniku) | publiczne wyniki wyszukiwania | nie; każdy materiał zebrany z sieci ma plik `zrodlo.json` z adresem źródła i datą dostępu |
| **Certificate Transparency** (crt.sh, strumień CT) | publiczne logi | nie (tylko `.cache/` i `data/work/`, poza repozytorium) |
| **RDAP** (`rdap.org`) i **DNS**, Team Cymru (ASN) | publiczne zapytania pasywne | nie (`.cache/`); w trybie importu spraw odpowiedzi zapisuje `provenance.json` (data, czy były zapytania, domeny bez odpowiedzi) |
| **Lista Ostrzeżeń CERT Polska** (`hole.cert.pl`) | publiczne API | nie |
| **Biblioteki reklam** (Meta, `--ad-library`) | publiczna strona, przez MetaAdsCollector | nie (`.cache/`) |
| Przykład wzorca nazw domen z publicznego komunikatu CSIRT KNF | publiczny komunikat | tak, w jednym teście |

Każdy materiał zebrany z sieci przez narzędzia zbierające ma w `zrodlo.json` pole ze źródłem (adres i datę dostępu), a import spraw zapisuje `provenance.json` obok wyniku. Lista obserwowanych osób nie jest dołączona (w próbce są tylko fikcyjne). Gotową bazę i wiedzę z danych poufnych opisuje [docs/DANE-NIEPUBLICZNE.md](docs/DANE-NIEPUBLICZNE.md) (osobna paczka niepubliczna; plik doda późniejsze zadanie). Walidacja na materiałach spoza próbki: [docs/METODYKA.md](docs/METODYKA.md#walidacja-na-materiałach-spoza-próbki).

## Licencje

Kod: MIT ([LICENSE](LICENSE)). Licencje wszystkich bibliotek, modeli, narzędzi i usług, z kontrolą składników niekomercyjnych: [LICENCJE.md](LICENCJE.md).

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
- `lib/media/`: addressBar, imageEmbed, speaker (galeria głosów), voiceEval, face (z testami);
- `lib/text/`: addressBar, uiChrome (z testami);
- `lib/graph/`: testy levels, screenshotLink, adLibraryVoice;
- `scripts/`: import-cases, analyze-material; `scripts/py/`: ad_library.py, speaker_embed.py, build_voice_index.py, setup-speaker.sh, face_embed.py, face_threshold.py, setup-face.sh;
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

### Funkcje powstałe 21–22.11.2026 (w trakcie wydarzenia)

Źródło: historia git tego repozytorium (commity kontrolne po zadaniach; wcześniejsza historia nie została przeniesiona, zob. wyżej) i raporty zadań. Wszystkie z datą 21.11.2026, bo po tej dacie nie ma jeszcze commitów (stan z 21.11.2026).

| Zadanie | Co powstało |
|---|---|
| m0 | start repozytorium bez historii: przeniesienie kodu z prywatnego repozytorium (README i `.gitignore` jako pierwszy commit), dane syntetyczne |
| i1 | analiza nowego materiału: werdykty `duplicate` i `insufficient`, partie (`--cases`, `--each-file`, `--dataset`), eksport CSV z ustaloną kolejnością kolumn, pewność `certain/likely/uncertain`, techniki stron i blok fałszywych komentarzy, `onProgress` |
| i14 | cechy platform zamiast cech operatora (serwer trackera po maszynie, najemca platformy, backend z identyfikatorem klienta, zniżki ×0,1), reguły treści i pole `basis` |
| i14b | wariant kreacji: dołączanie, nigdy scalanie (`attachContentVariants`) |
| i14c | ślady zestawu stron nie sumują się w kampanię, biblioteka landerów „666”, konflikt kont wygrywa z silnym `path_id` |
| i2 | nowy interfejs: zakładki „Analizuj materiał”, „Kampanie”, „Porównaj”, „Graf powiązań”, „Jak to działa”, API zadań (`/api/material`), moduły `lib/viewer`, dymki pomocy |
| i16 | rozszerzenie skanera wycieków danych poufnych (narzędzie poza repozytorium) |
| i15 | galeria głosów osób publicznych: `--speaker` z dopasowaniem okien (`voices`), `data/voices`, `scripts/py/build_voice_index.py`, `bun run voice:eval`, próg z pomiaru |
| i5 | persona z twarzy: `--faces` (OpenCV YuNet + SFace), zamknięta lista osób publicznych (`data/osoby-publiczne.json`, 31 osób ze zdjęciami w `data/faces`), `scripts/py/face_embed.py`, `setup-face.sh`, próg z pomiaru |
| i7 | `bun run base`, `bun run demo`, obraz Dockera z narzędziami do mediów, profile `full`/`llm`/`ct`, limity API (`ANALYZE_RATE_LIMIT`, `MATERIAL_MAX_MB`), `cache:freeze` |
| i8 | dokumentacja: README, `docs/METODYKA.md`, `LICENCJE.md`, `LICENSE`, `bun run licenses` |

Przeniesienie kodu do tego repozytorium nastąpiło bez historii (opis wyżej): commity sprzed 21.11.2026 11:00 są w prywatnym repozytorium.

## Struktura

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
lib/watch/      harmonogram skanów: przepisy, źródła (CT, biblioteki reklam, urlscan, lista CERT), cykl i wiersze watch.jsonl
lib/licenses.ts logika skryptu licencji pakietów
scripts/        base, demo, demo-batch, import-cases, ingest, enrich, build-graph, evaluate, pipeline, analyze-material,
                summarize, evidence, cache-freeze, ct-watch, ct-backfill, watch, backtest-ct, llm-smoke, media-smoke, gen-sample, licenses; py/ (adaptery Pythona)
app/, components/viewer/   przeglądarka i API (`/api/analyze-material`, `/api/material`, `/api/analyze`, `/api/image`, `/api/ct-feed`)
docker/         konfiguracja serwera CT i pakiety profilu `full`
data/sample/    syntetyczne reklamy, obrazy, dżingle, fixtures, linking.json, personas.json, ct-lexicon.json, ct-stream.jsonl
docs/           METODYKA.md, TECHNICAL.md, GUI.md
```

Pozostałe opisy techniczne (architektura potoku, tryb live, formaty wejścia, opcjonalne kroki wzbogacania, paczka dowodów, watcher CT, dostawcy LLM, API, zmienne środowiskowe, testy, ograniczenia): [docs/TECHNICAL.md](docs/TECHNICAL.md).

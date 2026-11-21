# Licencje składników

Kod tego repozytorium: MIT ([LICENSE](LICENSE)). Poniżej licencje bibliotek, modeli, narzędzi i usług, z których narzędzie korzysta. Pole „Sposób użycia” mówi, czy składnik działa jako biblioteka w procesie aplikacji, czy jako osobny proces (wywołanie programu, kontener). Dla licencji copyleft ma to znaczenie: osobny proces nie czyni kodu repozytorium dziełem pochodnym.

Stan na 21.11.2026. Wersje bibliotek npm pochodzą z zainstalowanego `node_modules`, wersje narzędzi z obrazu Dockera (`odcisk-kampanii:latest`) albo z kart modeli. Wiersze dla funkcji, których jeszcze nie ma w kodzie (twarze, galeria głosów, inne biblioteki reklam), dopisze zadanie, które je wprowadzi.

## 1. Pakiety produkcyjne (npm)

Tabela jest wygenerowana poleceniem `bun run licenses -- --write LICENCJE.md` (skrypt `scripts/licenses.ts`, logika `lib/licenses.ts`). Skrypt czyta pole `license` z `node_modules/<pakiet>/package.json` dla `dependencies` z `package.json` i ich zależności przechodnich; pakiet bez pola jest oznaczony „BRAK POLA license”. Zależności deweloperskie (`devDependencies`: eslint, vitest, typescript, tailwind) nie wchodzą do tabeli i nie trafiają do działającej aplikacji. Wersja z Dockera ma też binaria platformy `linux`, a tabela z macOS pokazuje `darwin`; licencje tych binariów są takie same (rodzina `@img/sharp-*`: Apache-2.0, `@img/sharp-libvips-*`: LGPL-3.0-or-later, `@next/swc-*`: MIT).

<!-- npm:start -->
| Składnik | Wersja | Licencja | Rola | Sposób użycia | Źródło |
|---|---|---|---|---|---|
| @anthropic-ai/sdk | 1.10.0 | Apache-2.0 | bezpośrednia | biblioteka w procesie | npm |
| @babel/runtime | 7.29.14 | MIT | przechodnia | biblioteka w procesie | npm |
| @huggingface/jinja | 0.5.13 | MIT | przechodnia | biblioteka w procesie | npm |
| @huggingface/transformers | 3.7.6 | Apache-2.0 | bezpośrednia | biblioteka w procesie | npm |
| @img/colour | 1.1.0 | MIT | przechodnia | biblioteka w procesie | npm |
| @img/sharp-darwin-arm64 | 0.35.5 | Apache-2.0 | przechodnia | biblioteka w procesie | npm |
| @img/sharp-libvips-darwin-arm64 | 1.3.4 | LGPL-3.0-or-later | przechodnia | biblioteka w procesie | npm |
| @isaacs/fs-minipass | 4.0.1 | ISC | przechodnia | biblioteka w procesie | npm |
| @next/env | 16.4.6 | MIT | przechodnia | biblioteka w procesie | npm |
| @next/swc-darwin-arm64 | 16.4.6 | MIT | przechodnia | biblioteka w procesie | npm |
| @noble/hashes | 2.4.0 | MIT | bezpośrednia | biblioteka w procesie | npm |
| @opentelemetry/api | 1.10.0 | Apache-2.0 | przechodnia | biblioteka w procesie | npm |
| @protobufjs/aspromise | 1.1.2 | BSD-3-Clause | przechodnia | biblioteka w procesie | npm |
| @protobufjs/base64 | 1.1.2 | BSD-3-Clause | przechodnia | biblioteka w procesie | npm |
| @protobufjs/codegen | 2.0.5 | BSD-3-Clause | przechodnia | biblioteka w procesie | npm |
| @protobufjs/eventemitter | 1.1.1 | BSD-3-Clause | przechodnia | biblioteka w procesie | npm |
| @protobufjs/fetch | 1.1.1 | BSD-3-Clause | przechodnia | biblioteka w procesie | npm |
| @protobufjs/float | 1.0.2 | BSD-3-Clause | przechodnia | biblioteka w procesie | npm |
| @protobufjs/path | 1.1.2 | BSD-3-Clause | przechodnia | biblioteka w procesie | npm |
| @protobufjs/pool | 1.1.0 | BSD-3-Clause | przechodnia | biblioteka w procesie | npm |
| @protobufjs/utf8 | 1.1.2 | BSD-3-Clause | przechodnia | biblioteka w procesie | npm |
| @stablelib/base64 | 1.0.1 | MIT | przechodnia | biblioteka w procesie | npm |
| @swc/helpers | 0.5.23 | Apache-2.0 | przechodnia | biblioteka w procesie | npm |
| @types/node | 20.19.43 | MIT | przechodnia | biblioteka w procesie | npm |
| baseline-browser-mapping | 2.11.38 | Apache-2.0 | przechodnia | biblioteka w procesie | npm |
| boolean | 3.2.0 | MIT | przechodnia | biblioteka w procesie | npm |
| caniuse-lite | 1.0.30001826 | CC-BY-4.0 | przechodnia | biblioteka w procesie | npm |
| chownr | 3.0.0 | BlueOak-1.0.0 | przechodnia | biblioteka w procesie | npm |
| client-only | 0.0.1 | MIT | przechodnia | biblioteka w procesie | npm |
| cose-base | 2.2.0 | MIT | przechodnia | biblioteka w procesie | npm |
| csv-parse | 7.0.3 | MIT | bezpośrednia | biblioteka w procesie | npm |
| cytoscape | 3.35.0 | MIT | bezpośrednia | biblioteka w procesie | npm |
| cytoscape-fcose | 2.2.0 | MIT | bezpośrednia | biblioteka w procesie | npm |
| define-data-property | 1.1.4 | MIT | przechodnia | biblioteka w procesie | npm |
| define-properties | 1.2.1 | MIT | przechodnia | biblioteka w procesie | npm |
| detect-libc | 2.1.2 | Apache-2.0 | przechodnia | biblioteka w procesie | npm |
| detect-node | 2.1.0 | MIT | przechodnia | biblioteka w procesie | npm |
| es-define-property | 1.0.1 | MIT | przechodnia | biblioteka w procesie | npm |
| es-errors | 1.3.0 | MIT | przechodnia | biblioteka w procesie | npm |
| es6-error | 4.1.1 | MIT | przechodnia | biblioteka w procesie | npm |
| escape-string-regexp | 4.0.0 | MIT | przechodnia | biblioteka w procesie | npm |
| events | 3.3.0 | MIT | przechodnia | biblioteka w procesie | npm |
| fast-sha256 | 1.3.0 | Unlicense | przechodnia | biblioteka w procesie | npm |
| fflate | 0.8.3 | MIT | bezpośrednia | biblioteka w procesie | npm |
| flatbuffers | 25.9.23 | Apache-2.0 | przechodnia | biblioteka w procesie | npm |
| global-agent | 3.0.0 | BSD-3-Clause | przechodnia | biblioteka w procesie | npm |
| globalthis | 1.0.4 | MIT | przechodnia | biblioteka w procesie | npm |
| gopd | 1.2.0 | MIT | przechodnia | biblioteka w procesie | npm |
| graphology | 0.26.0 | MIT | bezpośrednia | biblioteka w procesie | npm |
| graphology-communities-louvain | 2.0.2 | MIT | bezpośrednia | biblioteka w procesie | npm |
| graphology-indices | 0.17.1 | MIT | przechodnia | biblioteka w procesie | npm |
| graphology-types | 0.24.8 | MIT | bezpośrednia | biblioteka w procesie | npm |
| graphology-utils | 2.5.2 | MIT | przechodnia | biblioteka w procesie | npm |
| guid-typescript | 1.0.9 | ISC | przechodnia | biblioteka w procesie | npm |
| has-property-descriptors | 1.0.2 | MIT | przechodnia | biblioteka w procesie | npm |
| json-schema-to-ts | 3.1.1 | MIT | przechodnia | biblioteka w procesie | npm |
| json-stringify-safe | 5.0.1 | ISC | przechodnia | biblioteka w procesie | npm |
| layout-base | 2.0.1 | MIT | przechodnia | biblioteka w procesie | npm |
| long | 5.3.2 | Apache-2.0 | przechodnia | biblioteka w procesie | npm |
| lucide-react | 1.77.0 | ISC | bezpośrednia | biblioteka w procesie | npm |
| matcher | 3.0.0 | MIT | przechodnia | biblioteka w procesie | npm |
| minipass | 7.1.3 | BlueOak-1.0.0 | przechodnia | biblioteka w procesie | npm |
| minizlib | 3.1.0 | MIT | przechodnia | biblioteka w procesie | npm |
| mnemonist | 0.39.8 | MIT | przechodnia | biblioteka w procesie | npm |
| nanoid | 3.3.20 | MIT | przechodnia | biblioteka w procesie | npm |
| next | 16.4.6 | MIT | bezpośrednia | biblioteka w procesie | npm |
| object-keys | 1.1.1 | MIT | przechodnia | biblioteka w procesie | npm |
| obliterator | 2.0.5 | MIT | przechodnia | biblioteka w procesie | npm |
| onnxruntime-common | 1.21.0 | MIT | przechodnia | biblioteka w procesie | npm |
| onnxruntime-node | 1.21.0 | MIT | przechodnia | biblioteka w procesie | npm |
| onnxruntime-web | 1.22.0-dev.20250409-89f8206ba4 | MIT | przechodnia | biblioteka w procesie | npm |
| p-limit | 7.3.3 | MIT | bezpośrednia | biblioteka w procesie | npm |
| pandemonium | 2.4.1 | MIT | przechodnia | biblioteka w procesie | npm |
| picocolors | 1.1.1 | ISC | przechodnia | biblioteka w procesie | npm |
| platform | 1.3.6 | MIT | przechodnia | biblioteka w procesie | npm |
| postcss | 8.5.23 | MIT | przechodnia | biblioteka w procesie | npm |
| protobufjs | 7.6.6 | BSD-3-Clause | przechodnia | biblioteka w procesie | npm |
| react | 19.3.0 | MIT | bezpośrednia | biblioteka w procesie | npm |
| react-dom | 19.3.0 | MIT | bezpośrednia | biblioteka w procesie | npm |
| roarr | 2.15.4 | BSD-3-Clause | przechodnia | biblioteka w procesie | npm |
| scheduler | 0.28.0 | MIT | przechodnia | biblioteka w procesie | npm |
| semver | 7.8.6 | ISC | przechodnia | biblioteka w procesie | npm |
| semver-compare | 1.0.0 | MIT | przechodnia | biblioteka w procesie | npm |
| serialize-error | 7.0.1 | MIT | przechodnia | biblioteka w procesie | npm |
| sharp | 0.35.5 | Apache-2.0 | bezpośrednia | biblioteka w procesie | npm |
| source-map-js | 1.2.3 | BSD-3-Clause | przechodnia | biblioteka w procesie | npm |
| sprintf-js | 1.1.3 | BSD-3-Clause | przechodnia | biblioteka w procesie | npm |
| standardwebhooks | 1.3.0 | MIT | przechodnia | biblioteka w procesie | npm |
| styled-jsx | 5.1.6 | MIT | przechodnia | biblioteka w procesie | npm |
| tar | 7.5.23 | BlueOak-1.0.0 | przechodnia | biblioteka w procesie | npm |
| tldts | 7.5.4 | MIT | bezpośrednia | biblioteka w procesie | npm |
| tldts-core | 7.5.4 | MIT | przechodnia | biblioteka w procesie | npm |
| ts-algebra | 2.0.0 | MIT | przechodnia | biblioteka w procesie | npm |
| tslib | 2.9.1 | 0BSD | przechodnia | biblioteka w procesie | npm |
| type-fest | 0.13.1 | (MIT OR CC0-1.0) | przechodnia | biblioteka w procesie | npm |
| undici-types | 6.21.0 | MIT | przechodnia | biblioteka w procesie | npm |
| yallist | 5.0.0 | BlueOak-1.0.0 | przechodnia | biblioteka w procesie | npm |
| yocto-queue | 1.2.2 | MIT | przechodnia | biblioteka w procesie | npm |
| zod | 4.6.7 | MIT | bezpośrednia | biblioteka w procesie | npm |
<!-- npm:end -->

Uwagi do tabeli:

- `@img/sharp-libvips-*` (binarium libvips używane przez `sharp`) jest LGPL-3.0-or-later. Jest wczytywane dynamicznie jako moduł natywny i nie jest modyfikowane.
- `caniuse-lite` (dane, CC-BY-4.0) jest zależnością Next.js (dane o przeglądarkach do budowy), nie jest dołączane do wyniku analizy.
- `tldts` korzysta z listy Public Suffix List (MPL-2.0), dołączonej do pakietu jako dane.

## 2. Modele

| Składnik | Wersja | Licencja | Rola | Sposób użycia | Źródło |
|---|---|---|---|---|---|
| Whisper large-v3-turbo (wagi `ggml-large-v3-turbo.bin`) | large-v3-turbo | MIT | transkrypcja mowy (`--asr`), opcjonalna | model w pliku, czytany przez osobny proces `whisper-cli` | [openai/whisper-large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo), [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp) |
| CLIP ViT-B/32 w wariancie ONNX `Xenova/clip-vit-base-patch32` | – | MIT (karta modelu Xenova; oryginał OpenAI CLIP: MIT) | embedding kreacji i 8 klatek wideo (`--clip`): podobieństwo wyglądu, cosinus ≥ 0,9, waga 0,45; to cecha wyglądu, nie ocena fałszerstwa | biblioteka w procesie (`@huggingface/transformers`, ONNX Runtime), model lokalny, w obrazie Dockera nieobecny | [Xenova/clip-vit-base-patch32](https://huggingface.co/Xenova/clip-vit-base-patch32) |
| `speechbrain/spkrec-ecapa-voxceleb` (ECAPA-TDNN) | – | Apache-2.0 (trenowany na VoxCeleb; nie na polskiej mowie) | wektor głosu mówcy (192 liczby, `--speaker`), opcjonalny | osobny proces Pythona | [karta modelu](https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb) |
| PLLuM-12B-instruct-2512 (GGUF Q5_K_M, kwantyzacja mradermacher) | 2512 | Apache-2.0 | domyślny LLM (streszczenia, NER), opcjonalny | model uruchamiany przez Ollamę (osobny proces) | [CYFRAGOVPL/PLLuM-12B-instruct-2512](https://huggingface.co/CYFRAGOVPL/PLLuM-12B-instruct-2512), [GGUF](https://huggingface.co/mradermacher/PLLuM-12B-instruct-2512-GGUF) |
| Bielik-11B-v3.0-Instruct (SpeakLeash, Q5_K_M) | v3.0 | Apache-2.0 | alternatywny LLM, opcjonalny | Ollama (osobny proces) | [speakleash/Bielik-11B-v3.0-Instruct](https://huggingface.co/speakleash/Bielik-11B-v3.0-Instruct) |
| bge-m3 (BAAI) | – | MIT | embeddingi tekstu (`--text embedding`), opcjonalne | Ollama (osobny proces) | [BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3) |
| Claude `claude-opus-5-5` (Anthropic API) | – | warunki komercyjne Anthropic (usługa, nie wagi) | opcjonalny dostawca LLM (`LLM_PROVIDER=anthropic`, klucz); dane wychodzą na zewnątrz | zapytania do API | [anthropic.com](https://www.anthropic.com) |

Domyślnie (bez flag i kluczy) nie jest używany żaden model. Wszystkie modele są pobierane ręcznie lub przez Ollamę, nic nie jest pobierane automatycznie w trakcie analizy (`HF_HUB_OFFLINE=1` w obrazie).

## 3. Narzędzia zewnętrzne

| Składnik | Wersja | Licencja | Rola | Sposób użycia | Źródło |
|---|---|---|---|---|---|
| Tesseract OCR + dane `pol` | 5.3.0 (obraz Dockera) | Apache-2.0 | OCR zrzutów (`--ocr`) | osobny proces | [github.com/tesseract-ocr](https://github.com/tesseract-ocr/tesseract) |
| FFmpeg / ffprobe | 5.1.9 (Debian 12, obraz Dockera) | **GPL-2.0-or-later**: build Debiana z `--enable-gpl` (bez `--enable-version3` i `--enable-nonfree`; sprawdzone poleceniem `ffmpeg -version` w kontenerze). Kod FFmpeg bez opcji GPL jest LGPL-2.1-or-later | konwersja audio do WAV 16 kHz, klatki wideo, metadane | osobny proces; kod repozytorium go nie linkuje | [ffmpeg.org](https://ffmpeg.org) |
| Chromaprint (`fpcalc`) | 1.5.1 (obraz Dockera) | LGPL-2.1-or-later | odcisk dźwięku (`--audio`) | osobny proces | [acoustid.org/chromaprint](https://acoustid.org/chromaprint) |
| whisper.cpp (`whisper-cli`) | 1.7.6 (profil `full`) | MIT | transkrypcja (`--asr`) | osobny proces, budowany w obrazie `full` | [github.com/ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) |
| yt-dlp | – | Unlicense | **nieużywany przez kod**: narzędzie czyta tylko plik `.info.json`, który użytkownik sam wygenerował (reklamodawca, identyfikator biblioteki reklam) | – | [github.com/yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp) |
| Python | 3.11.2 (obraz), 3.12 (`setup-speaker.sh`) | PSF-2.0 | uruchomienie adapterów Pythona | osobny proces | [python.org](https://www.python.org) |
| Pakiety Pythona z `scripts/py/requirements.txt` | – | lista pusta w tej wersji | miejsce na lekkie pakiety późniejszych zadań | venv `/opt/venv` | – |
| SpeechBrain | 1.1.2 | Apache-2.0 | wektory głosu (profil `full`, `setup-speaker.sh`) | osobny proces Pythona | [speechbrain.github.io](https://speechbrain.github.io) |
| PyTorch / torchaudio (CPU) | 2.15.0 / 2.11.1 | BSD-3-Clause (PyTorch; pakiet zawiera też składniki na licencjach liberalnych: Apache-2.0, BSD-2, MIT) | środowisko wykonawcze SpeechBrain | osobny proces Pythona | [pytorch.org](https://pytorch.org) |
| soundfile, NumPy | 0.14.0 / 2.5.5 | BSD-3-Clause | odczyt WAV, wektory | osobny proces Pythona | pypi.org |
| MetaAdsCollector (`meta-ads-collector`) | 1.7.2 | MIT | dane przejrzystości DSA z biblioteki reklam Mety (`--ad-library`): płatnik, beneficjent, usunięcie, zasięg w UE. **Ryzyko:** korzysta z nieoficjalnego, publicznego endpointu strony (bez klucza API), więc może przestać działać po zmianie strony; automatyczne odpytywanie może naruszać regulamin serwisu; projekt ma jednego autora | osobny proces (instalacja `uv tool install meta-ads-collector`), skrypt `scripts/py/ad_library.py` | [pypi.org/project/meta-ads-collector](https://pypi.org/project/meta-ads-collector/) |
| uv | 0.12.15 | MIT OR Apache-2.0 | instalacja środowisk Pythona | osobny proces, tylko przy instalacji | [github.com/astral-sh/uv](https://github.com/astral-sh/uv) |
| Bun | 1.4.4 | MIT | środowisko uruchomieniowe, instalator pakietów | osobny proces | [bun.sh](https://bun.sh) |
| Node.js | 22 | MIT | serwer Next.js w obrazie | osobny proces | [nodejs.org](https://nodejs.org) |
| Ollama | 0.40 | MIT | lokalne uruchamianie modeli LLM (profil `llm`), opcjonalne | osobny proces (kontener `ollama/ollama`) | [github.com/ollama/ollama](https://github.com/ollama/ollama) |
| certstream-server-go (obraz `0rickyy0/certstream-server-go`) | 1.10.1 | MIT | lokalny strumień Certificate Transparency (profil `ct`), opcjonalny | kontener Docker, osobny proces | [github.com/d-Rickyy-b/certstream-server-go](https://github.com/d-Rickyy-b/certstream-server-go) |

## 4. Usługi opcjonalne

Domyślnie narzędzie nie wysyła żadnych zapytań (`ANALYZE_OFFLINE=1` w obrazie). Zapytania pojawiają się tylko z flagami `--live`, `--lookups`, `--ad-library`, `--cloaking` albo przy użyciu dostawcy Anthropic. Instrukcja zdobycia kluczy: [README.md](README.md#6-usługi-z-kluczami).

| Usługa | Licencja lub warunki | Rola | Sposób użycia | Źródło |
|---|---|---|---|---|
| DNS (resolver systemowy lub `DNS_SERVERS`) | usługa publiczna | rekordy A/AAAA/CNAME/NS/MX/TXT | zapytania pasywne | – |
| RDAP przez `rdap.org` | usługa publiczna, bezpłatna | rejestrator, daty rejestracji (seria rejestracji) | zapytania pasywne | [rdap.org](https://rdap.org) |
| crt.sh | usługa publiczna, bezpłatna | certyfikaty z logów CT | zapytania pasywne | [crt.sh](https://crt.sh) |
| urlscan.io (API wyszukiwania, strony wyników) | [warunki urlscan.io](https://urlscan.io/terms/); anonimowo ok. 100 zapytań na godzinę i 30 dni wstecz, 429 z `Retry-After` (reset po ok. 18 min); darmowy klucz `URLSCAN_API_KEY` (opcjonalny) dokłada DOM zapisanych stron | publiczne kopie martwych stron (adresy i hashe żądań, zrzut, DOM) z podanym źródłem | tylko istniejące skany, bez zlecania nowych; jedna kolejka z przerwą, bez ponowień w pętli | [urlscan.io](https://urlscan.io) |
| Internet Archive (Wayback Machine: CDX i kopie `id_`) | [warunki korzystania Internet Archive](https://archive.org/about/terms.php); usługa publiczna, bezpłatna, bez klucza | publiczne kopie martwych stron z podanym adresem kopii | tylko odczyt istniejących kopii (bez „Save Page Now”), limit czasu i jedno ponowienie przy 504 | [web.archive.org](https://web.archive.org) |
| Team Cymru IP-to-ASN | usługa publiczna, DNS TXT | numer systemu autonomicznego dla adresu IP | zapytania pasywne | [team-cymru.com](https://team-cymru.com/community-services/ip-asn-mapping/) |
| Logi Certificate Transparency, CertStream | publiczne | strumień nowych certyfikatów (watcher CT) | lokalny serwer albo publiczny strumień | – |
| urlscan.io | warunki serwisu; klucz do pełnego dostępu | tylko do zbierania danych walidacyjnych, **poza kodem narzędzia** | nieużywane w kodzie | [urlscan.io](https://urlscan.io) |
| Anthropic API | warunki komercyjne, klucz | opcjonalny LLM | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| Ollama (lokalna) | MIT | opcjonalny LLM i embeddingi | lokalny proces | patrz wyżej |
| Biblioteka reklam Mety (publiczna strona) | regulamin Mety | dane o płatniku i zasięgu reklamy | tylko `--ad-library`, przez MetaAdsCollector | [facebook.com/ads/library](https://www.facebook.com/ads/library/) |
| Hugging Face Hub, rejestr Ollamy | licencje poszczególnych modeli | jednorazowe pobranie modeli | ręcznie lub przez Ollamę | – |

## 5. Kontrola składników o licencjach niekomercyjnych (NC)

Sprawdzone `grep -rli 'deepface\|insightface\|buffalo' lib scripts app docker Dockerfile docker-compose.yml package.json` (bez trafień) i listą zależności z punktu 1: **żaden adapter nie pobiera ani nie używa komponentów o licencji niekomercyjnej** (np. DeepFace z domyślnym modelem, InsightFace). Żaden pakiet npm z punktu 1 nie ma licencji NC ani GPL. Składnik na licencji copyleft w obrazie to FFmpeg (GPL-2.0-or-later) jako osobny proces i `libvips` (LGPL-3.0-or-later) jako biblioteka dynamiczna `sharp`. Gdy późniejsze zadanie doda adapter (twarze, głos), powinno dopisać tu wynik takiej kontroli.


## 7. Oświadczenie o braku wad prawnych

- Repozytorium nie zawiera materiałów udostępnionych przez organizatora ani ich fragmentów; dane przykładowe i testowe są syntetyczne ([README.md](README.md#pochodzenie-danych)).
- Wszystkie składniki z punktów 1–3 są używane zgodnie z ich licencjami; składniki copyleft działają jako osobne procesy albo dynamicznie ładowane biblioteki.
- Zdjęcia i nagrania osób publicznych: gdy zostaną dołączone do repozytorium, każde z nich zostanie opisane tu przez źródło, autora i licencję. **Na dziś żadne nie jest dołączone**; zadanie, które je doda, dopisze wiersze do tabeli poniżej.

| Plik | Osoba | Źródło | Autor | Licencja |
|---|---|---|---|---|
| (brak) | | | | |

## 8. Czego nie używamy

| Składnik | Licencja | Powód |
|---|---|---|
| Baza odcisków technologii `webappanalyzer` (następca Wappalyzera) | GPL-3.0 | wymusiłaby GPL na kodzie, który ją dołącza; atrybut platformy powstaje z własnych wzorców (`lib/osint`, `lib/graph/config.ts`) |
| httpx (ProjectDiscovery) | MIT | licencja nie jest problemem; odrzucony, bo aktywne sondowanie hostów łamie zasadę pasywności narzędzia |
| DeepFace z domyślnym modelem, InsightFace | modele na licencjach niekomercyjnych | nie używane; ewentualny adapter twarzy musi mieć model o licencji pozwalającej na użycie |

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
| libphonenumber-js | 1.13.17 | MIT | bezpośrednia | biblioteka w procesie | npm |
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
| CLIP ViT-B/32 w wariancie ONNX `Xenova/clip-vit-base-patch32` | – | MIT (karta modelu Xenova; oryginał OpenAI CLIP: MIT) | embedding kreacji i 8 klatek wideo (`--clip`): podobieństwo wyglądu, cosinus ≥ 0,9, waga 0,45; to cecha wyglądu, nie ocena fałszerstwa; wieża tekstowa tego samego modelu (`text_model.onnx`) do rozpoznania podrabianej marki zero-shot (atrybut, nie dowód) | biblioteka w procesie (`@huggingface/transformers`, ONNX Runtime), model lokalny, w obrazie Dockera nieobecny | [Xenova/clip-vit-base-patch32](https://huggingface.co/Xenova/clip-vit-base-patch32) |
| Silero VAD v5.1.2 dla whisper.cpp (`ggml-silero-v5.1.2.bin`, ok. 0,9 MB) | 5.1.2 | MIT (Silero VAD; konwersja ggml z repozytorium whisper.cpp: MIT) | wykrywanie mowy przed transkrypcją (`--asr` z `whisper-cli --vad`): muzyka i cisza nie są transkrybowane, więc whisper nie dopisuje do nich halucynacji; opcjonalny | plik czytany przez proces `whisper-cli` (`WHISPER_VAD_MODEL`, domyślnie `~/models/whisper/`), poza repozytorium i obrazem | [ggml-org/whisper-vad](https://huggingface.co/ggml-org/whisper-vad), [snakers4/silero-vad](https://github.com/snakers4/silero-vad) |
| `speechbrain/spkrec-ecapa-voxceleb` (ECAPA-TDNN) | – | Apache-2.0 (trenowany na VoxCeleb; nie na polskiej mowie) | wektor głosu mówcy (192 liczby, `--speaker`), opcjonalny | osobny proces Pythona | [karta modelu](https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb) |
| `speechbrain/vad-crdnn-libriparty` (CRDNN) | – | **licencja wag niepodana na karcie modelu**; kod SpeechBrain: Apache-2.0; model trenowany na LibriParty z szumem UrbanSound8K (CC BY-NC) | detekcja mowy (odróżnia głos od muzyki) przed dopasowaniem głosu do galerii (`--speaker`), opcjonalna | osobny proces Pythona, model poza repozytorium i poza obrazem domyślnym (`SPEAKER_VAD_DIR`, profil `full`) | [karta modelu](https://huggingface.co/speechbrain/vad-crdnn-libriparty); **do potwierdzenia przed użyciem komercyjnym**, zastępnik: inny VAD o jasnej licencji |
| OpenCV YuNet `face_detection_yunet_2023mar.onnx` (OpenCV Zoo) | 2023mar | MIT | wykrywanie twarzy (`--faces`): ramka i wynik detektora | plik ONNX poza repozytorium (`FACE_MODEL_DIR`, w obrazie Dockera pobierany przy budowie), czytany przez osobny proces Pythona | [opencv_zoo/face_detection_yunet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) |
| OpenCV SFace `face_recognition_sface_2021dec.onnx` (OpenCV Zoo) | 2021dec | Apache-2.0 | wektor twarzy 128 liczb do porównania z zamkniętą listą osób publicznych (patrz `data/osoby-publiczne.json`) (`--faces`); wynik „podobna twarz do X (0,xx)” do przeglądu człowieka | jak wyżej | [opencv_zoo/face_recognition_sface](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) |
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
| yt-dlp | 2026.08.19 (lokalnie) | Unlicense | kreacja reklamy z biblioteki Mety na żądanie (`--ad-library`, `adlib get`): `yt-dlp --skip-download --dump-json --ignore-no-formats-error`, tylko metadane, bez pobierania plików; `scripts/py/build_voice_index.py` pobiera nim fragmenty dźwięku nagrań do galerii głosów (narzędzie deweloperskie, nie działa przy analizie materiału); poza tym kod czyta plik `.info.json`, który użytkownik sam wygenerował (reklamodawca, identyfikator biblioteki reklam). Korzysta z publicznej strony biblioteki (to samo ryzyko co MetaAdsCollector) | osobny proces, opcjonalny | [github.com/yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp) |
| Python | 3.11.2 (obraz), 3.12 (`setup-speaker.sh`, `setup-face.sh`) | PSF-2.0 | uruchomienie adapterów Pythona | osobny proces | [python.org](https://www.python.org) |
| `google-cloud-bigquery` (z `scripts/py/requirements.txt`) | >=3.25,<4 | Apache-2.0 | klient BigQuery dla `scripts/py/google_atc.py` (Google Ads Transparency Center, publiczny zbiór); wymaga poświadczeń ADC, bez nich skrypt używa CLI `bq` albo zgłasza brak dostępu | osobny proces Pythona, venv `/opt/venv` | [pypi.org/project/google-cloud-bigquery](https://pypi.org/project/google-cloud-bigquery/) |
| Google Cloud SDK (`bq`, `gcloud`) | – | Apache-2.0 (SDK); usługi: Google Cloud Terms | zapasowy dostęp do BigQuery bez ADC (`bq query` z limitem `--maximum_bytes_billed`), tylko na komputerze użytkownika | osobny proces, opcjonalny | [cloud.google.com/sdk](https://cloud.google.com/sdk) |
| `opencv-python-headless` (pakiet z `scripts/py/requirements.txt` i `setup-face.sh`) | 5.1.0.95 (sprawdzona lokalnie) | Apache-2.0 (kod OpenCV; koła PyPI zawierają też biblioteki o licencjach liberalnych) | detektor YuNet i rozpoznawanie SFace (`--faces`) | osobny proces Pythona, venv `/opt/venv` albo `.venv-face` | [pypi.org/project/opencv-python-headless](https://pypi.org/project/opencv-python-headless/) |
| SpeechBrain | 1.1.2 | Apache-2.0 | wektory głosu (profil `full`, `setup-speaker.sh`) | osobny proces Pythona | [speechbrain.github.io](https://speechbrain.github.io) |
| PyTorch / torchaudio (CPU) | 2.15.0 / 2.11.1 | BSD-3-Clause (PyTorch; pakiet zawiera też składniki na licencjach liberalnych: Apache-2.0, BSD-2, MIT) | środowisko wykonawcze SpeechBrain | osobny proces Pythona | [pytorch.org](https://pytorch.org) |
| soundfile, NumPy | 0.14.0 / 2.5.5 | BSD-3-Clause | odczyt WAV, wektory | osobny proces Pythona | pypi.org |
| MetaAdsCollector (`meta-ads-collector`) | 1.7.2 | MIT | dane przejrzystości DSA z biblioteki reklam Mety (`--ad-library`): płatnik, beneficjent, usunięcie, zasięg w UE; wyszukiwanie reklam po frazie, stronie, kraju i dacie (`adlib search`). **Ryzyko:** korzysta z nieoficjalnego, publicznego endpointu strony (bez klucza API), więc może przestać działać po zmianie strony; automatyczne odpytywanie może naruszać regulamin serwisu; projekt ma jednego autora | osobny proces (instalacja `uv tool install meta-ads-collector`), skrypt `scripts/py/ad_library.py` | [pypi.org/project/meta-ads-collector](https://pypi.org/project/meta-ads-collector/) |
| OpenSSL (`openssl ts`) | 3.0 (Debian 12, obraz Dockera) | Apache-2.0 | zapytanie o znacznik czasu RFC 3161 (`bun run evidence -- --tsa`), opcjonalne | osobny proces | [openssl.org](https://www.openssl.org) |
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
| urlscan.io (API wyszukiwania, strony wyników) | [warunki urlscan.io](https://urlscan.io/terms/); anonimowo ok. 100 zapytań na godzinę i 30 dni wstecz, 429 z `Retry-After` (reset po ok. 18 min); darmowy klucz `URLSCAN_API_KEY` (opcjonalny) dokłada DOM zapisanych stron | publiczne kopie martwych stron (adresy i hashe żądań, zrzut, DOM) z podanym źródłem | tylko istniejące skany, bez zlecania nowych; jedna kolejka z przerwą, bez ponowień w pętli; harmonogram skanów (`bun run watch`) używa tego samego adaptera do wyszukiwania po zapytaniu z przepisów (`searchScans`), z tymi samymi limitami i kolejką | [urlscan.io](https://urlscan.io) |
| Internet Archive (Wayback Machine: CDX i kopie `id_`) | [warunki korzystania Internet Archive](https://archive.org/about/terms.php); usługa publiczna, bezpłatna, bez klucza | publiczne kopie martwych stron z podanym adresem kopii | tylko odczyt istniejących kopii (bez „Save Page Now”), limit czasu i jedno ponowienie przy 504 | [web.archive.org](https://web.archive.org) |
| Lista Ostrzeżeń CERT Polska (`hole.cert.pl`, plik `domains.json`) | publiczna lista CERT Polska; warunki i licencja do sprawdzenia przez użytkownika przy pierwszym użyciu (nie analizowane w tym zadaniu) | dzienna różnica listy (nowe domeny) w harmonogramie skanów | `bun run watch` (źródło `certlist`), jedno pobranie pliku na cykl, tylko z przepisem i filtrem RDAP/NS | [cert.pl](https://cert.pl/) |
| Team Cymru IP-to-ASN | usługa publiczna, DNS TXT | numer systemu autonomicznego dla adresu IP | zapytania pasywne | [team-cymru.com](https://team-cymru.com/community-services/ip-asn-mapping/) |
| Logi Certificate Transparency, CertStream | publiczne | strumień nowych certyfikatów (watcher CT) | lokalny serwer albo publiczny strumień | – |
| Anthropic API | warunki komercyjne, klucz | opcjonalny LLM | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| Ollama (lokalna) | MIT | opcjonalny LLM i embeddingi | lokalny proces | patrz wyżej |
| Biblioteka reklam Mety (publiczna strona) | regulamin Mety | dane o płatniku i zasięgu reklamy; wyszukiwanie reklam | tylko `--ad-library` i `adlib`, przez MetaAdsCollector i yt-dlp | [facebook.com/ads/library](https://www.facebook.com/ads/library/) |
| Google BigQuery, publiczny zbiór `bigquery-public-data.google_ads_transparency_center` | Google Cloud Terms i warunki zbioru (do sprawdzenia przez użytkownika przy pierwszym użyciu; nie analizowane w tym zadaniu); sandbox 1 TiB zapytań miesięcznie, konto Google | reklamodawca (identyfikator, nazwa prawna, kraj, weryfikacja), płatnik, regiony i daty emisji reklam w Google | tylko `adlib` z własnym kontem użytkownika; każde zapytanie z limitem bajtów; bez scrapingu | [adstransparency.google.com](https://adstransparency.google.com/) |
| Google Ads Transparency Center, publiczne RPC strony (`lib/adlib/googleRpc.ts`) | **nieoficjalne**: brak umowy ani API; automatyczne odpytywanie może naruszać warunki serwisu Google | wyszukiwanie reklam po domenie, której zbiór BigQuery nie ma | tylko z `ADLIB_GOOGLE_RPC=1` (domyślnie wyłączone), bez logowania, jedno żądanie na zapytanie; format niesprawdzony na żywo | [adstransparency.google.com](https://adstransparency.google.com/) |
| TikTok Commercial Content Library (API) | wniosek o dostęp, dla badaczy; warunki programu | reklamy komercyjne w TikToku | `TIKTOK_CLIENT_KEY` i `TIKTOK_CLIENT_SECRET`; adapter zob. [docs/ZRODLA-METADANYCH.md](docs/ZRODLA-METADANYCH.md) | [developers.tiktok.com](https://developers.tiktok.com/) |
| X (repozytorium reklam DSA) | warunki serwisu X nie czytane (strona pomocy zwróciła 403); szczegóły: [docs/ZRODLA-METADANYCH.md](docs/ZRODLA-METADANYCH.md) | reklamy wyświetlane w UE | tylko import pliku CSV pobranego przez użytkownika (`--x-file`); program nie łączy się z X | [help.x.com](https://help.x.com/en/business-and-advertising/ads-transparency) |
| Hugging Face Hub, rejestr Ollamy | licencje poszczególnych modeli | jednorazowe pobranie modeli | ręcznie lub przez Ollamę | – |

## 5. Kontrola składników o licencjach niekomercyjnych (NC)

Sprawdzone `grep -rli 'deepface\|insightface\|buffalo' lib scripts app docker Dockerfile docker-compose.yml package.json` (bez trafień) i listą zależności z punktu 1: **żaden adapter nie pobiera ani nie używa komponentów o licencji niekomercyjnej** (np. DeepFace z domyślnym modelem, InsightFace); rozpoznawanie twarzy używa wyłącznie YuNet (MIT) i SFace (Apache-2.0) z OpenCV Zoo. Żaden pakiet npm z punktu 1 nie ma licencji NC ani GPL. Składnik na licencji copyleft w obrazie to FFmpeg (GPL-2.0-or-later) jako osobny proces i `libvips` (LGPL-3.0-or-later) jako biblioteka dynamiczna `sharp`. Gdy późniejsze zadanie doda adapter (twarze, głos), powinno dopisać tu wynik takiej kontroli.


## 7. Oświadczenie o braku wad prawnych

- Repozytorium nie zawiera materiałów udostępnionych przez organizatora ani ich fragmentów; dane przykładowe i testowe są syntetyczne ([README.md](README.md#pochodzenie-danych)).
- Wszystkie składniki z punktów 1–3 są używane zgodnie z ich licencjami; składniki copyleft działają jako osobne procesy albo dynamicznie ładowane biblioteki.
- Galeria głosów (`data/voices`, zamknięta lista 10 osób): **w repozytorium i w obrazie są tylko wektory cech głosu (192 liczby na nagranie) i lista źródeł [data/voices/ZRODLA.md](data/voices/ZRODLA.md)**: adres każdego nagrania (YouTube), kanał (autor), fragment, licencja filmu albo podstawa użycia (standardowa licencja YouTube: nagrania publicznych wystąpień służą wyłącznie do wyliczenia wektora, nie są przechowywane w repozytorium ani publikowane; 6 z 76 fragmentów ma licencję Creative Commons Attribution) i data pobrania. Nagrania leżą poza repozytorium i nie trafiają do obrazu. Wektor nie pozwala odtworzyć głosu. Demucs nie jest użyty. Brak wad prawnych oznacza tu zgodność z warunkami licencji; prawo do wykorzystania głosu jako danych biometrycznych: [docs/ZGODNOSC.md](docs/ZGODNOSC.md).
- Zdjęcia referencyjne osób publicznych (`data/faces`, zamknięta lista 31 osób ze zdjęciami do rozpoznawania twarzy (reszta listy to persona z tekstu bez twarzy)): każde pochodzi z Wikimedia Commons, z licencją pozwalającą na redystrybucję (CC BY, CC BY-SA, CC0, domena publiczna); poniżej źródło, autor i licencja każdego pliku (pełniejsza tabela z datą pobrania i datą zdjęcia: [data/faces/ZRODLA.md](data/faces/ZRODLA.md)). Pliki są przycięte do twarzy i zmniejszone; wiersze CC BY-SA dotyczą opracowań udostępnianych na tej samej licencji. Żadne zdjęcie nie pochodzi z materiałów spraw (sprawdza skaner `leak_scan.py`, także obrazy). Brak wad prawnych oznacza tu zgodność z warunkami tych licencji (autor, licencja, zmiany); nie jest to ocena prawa do wizerunku, patrz [docs/ZGODNOSC.md](docs/ZGODNOSC.md).

| Plik | Osoba | Źródło | Autor | Licencja |
|---|---|---|---|---|
| `data/faces/donald-tusk/01.jpg` | Donald Tusk | [Donald Tusk KPRM HQ 2023.jpg](https://commons.wikimedia.org/wiki/File:Donald_Tusk_KPRM_HQ_2023.jpg) | Chancellery of the Prime Minister of the Republic of Poland | CC BY 3.0 pl |
| `data/faces/donald-tusk/02.jpg` | Donald Tusk | [Donald Tusk attended the October 2024 session of the European Council Summit (2).jpg](https://commons.wikimedia.org/wiki/File:Donald_Tusk_attended_the_October_2024_session_of_the_European_Council_Summit_(2).jpg) | Chancellery of the Prime Minister of Poland | CC BY 3.0 pl |
| `data/faces/donald-tusk/03.jpg` | Donald Tusk | [Donald Tusk and Antony Blinken (2024).jpg](https://commons.wikimedia.org/wiki/File:Donald_Tusk_and_Antony_Blinken_(2024).jpg) | Chancellery of the Prime Minister of Poland | CC BY 3.0 pl |
| `data/faces/donald-tusk/04.jpg` | Donald Tusk | [Donald Tusk attended the 2024 NB8+Poland summit (1).jpg](https://commons.wikimedia.org/wiki/File:Donald_Tusk_attended_the_2024_NB8%2BPoland_summit_(1).jpg) | Chancellery of the Prime Minister of Poland | CC BY 3.0 pl |
| `data/faces/donald-tusk/05.jpg` | Donald Tusk | [Donald Tusk młody 1.jpg](https://commons.wikimedia.org/wiki/File:Donald_Tusk_m%C5%82ody_1.jpg) | nieznany/unknown | Public domain |
| `data/faces/robert-lewandowski/01.jpg` | Robert Lewandowski | [Robert Lewandowski Meisterfeier Dortmund 2011.jpg](https://commons.wikimedia.org/wiki/File:Robert_Lewandowski_Meisterfeier_Dortmund_2011.jpg) | pro2 | CC BY-SA 4.0 |
| `data/faces/robert-lewandowski/02.jpg` | Robert Lewandowski | [Robert Lewandowski Training FC Bayern München-1.jpg](https://commons.wikimedia.org/wiki/File:Robert_Lewandowski_Training_FC_Bayern_M%C3%BCnchen-1.jpg) | Rufus46 | CC BY-SA 3.0 |
| `data/faces/robert-lewandowski/03.jpg` | Robert Lewandowski | [Robert Lewandowski Training 2017-05 FC Bayern Muenchen-1.jpg](https://commons.wikimedia.org/wiki/File:Robert_Lewandowski_Training_2017-05_FC_Bayern_Muenchen-1.jpg) | Rufus46 | CC BY-SA 3.0 |
| `data/faces/robert-lewandowski/04.jpg` | Robert Lewandowski | [Robert Lewandowski 2018.jpg](https://commons.wikimedia.org/wiki/File:Robert_Lewandowski_2018.jpg) | Екатерина Лаут | CC BY-SA 3.0 |
| `data/faces/andrzej-duda/01.jpg` | Andrzej Duda | [Andrzej Duda Powązki 2025 IMG 2049.jpg](https://commons.wikimedia.org/wiki/File:Andrzej_Duda_Pow%C4%85zki_2025_IMG_2049.jpg) | W2k2 | CC BY 4.0 |
| `data/faces/andrzej-duda/02.jpg` | Andrzej Duda | [Prezydent RP Andrzej Duda (2017).jpg](https://commons.wikimedia.org/wiki/File:Prezydent_RP_Andrzej_Duda_(2017).jpg) | KG PSP | CC BY 2.0 |
| `data/faces/andrzej-duda/03.jpg` | Andrzej Duda | [Andrzej Duda, Візит Зеленського до інституцій ЄС і НАТО у Брюсселі, 2019, 34.jpg](https://commons.wikimedia.org/wiki/File:Andrzej_Duda,_%D0%92%D1%96%D0%B7%D0%B8%D1%82_%D0%97%D0%B5%D0%BB%D0%B5%D0%BD%D1%81%D1%8C%D0%BA%D0%BE%D0%B3%D0%BE_%D0%B4%D0%BE_%D1%96%D0%BD%D1%81%D1%82%D0%B8%D1%82%D1%83%D1%86%D1%96%D0%B9_%D0%84%D0%A1_%D1%96_%D0%9D%D0%90%D0%A2%D0%9E_%D1%83_%D0%91%D1%80%D1%8E%D1%81%D1%81%D0%B5%D0%BB%D1%96,_2019,_34.jpg) | Офіс Президента України | CC BY 4.0 |
| `data/faces/andrzej-duda/04.jpg` | Andrzej Duda | [Andrzej Duda Zgromadzenie Narodowe 6 sierpnia 2015 04 (cropped).JPG](https://commons.wikimedia.org/wiki/File:Andrzej_Duda_Zgromadzenie_Narodowe_6_sierpnia_2015_04_(cropped).JPG) | Original: Michał JózefaciukDerivative work: TharonXX | CC BY-SA 3.0 pl |
| `data/faces/krzysztof-stanowski/01.jpg` | Krzysztof Stanowski | [Krzysztof Stanowski (2025).jpg](https://commons.wikimedia.org/wiki/File:Krzysztof_Stanowski_(2025).jpg) | Tony Montana | CC0 |
| `data/faces/krzysztof-stanowski/02.jpg` | Krzysztof Stanowski | [Krzysztof Stanowski i Magdalena Biejat - 23.03.25 (54405349059) 01.jpg](https://commons.wikimedia.org/wiki/File:Krzysztof_Stanowski_i_Magdalena_Biejat_-_23.03.25_(54405349059)_01.jpg) | Monika Szafrańska (Klub Lewicy) | Public domain |
| `data/faces/krzysztof-stanowski/03.jpg` | Krzysztof Stanowski | [Krzysztof Stanowski i Magdalena Biejat - 23.03.25 (54405081606).jpg](https://commons.wikimedia.org/wiki/File:Krzysztof_Stanowski_i_Magdalena_Biejat_-_23.03.25_(54405081606).jpg) | Monika Szafrańska (Klub Lewicy) | Public domain |
| `data/faces/monika-olejnik/01.jpg` | Monika Olejnik | [Monika Olejnik.JPG](https://commons.wikimedia.org/wiki/File:Monika_Olejnik.JPG) | Ja Fryta | CC BY-SA 2.0 |
| `data/faces/monika-olejnik/02.jpg` | Monika Olejnik | [Monika.Olejnik.JPG](https://commons.wikimedia.org/wiki/File:Monika.Olejnik.JPG) | Fashion Post | CC BY 3.0 |
| `data/faces/monika-olejnik/03.jpg` | Monika Olejnik | [Energa Camerimage Festiwal 2025 Toruń.jpg](https://commons.wikimedia.org/wiki/File:Energa_Camerimage_Festiwal_2025_Toru%C5%84.jpg) | Aawiosnaa | CC BY-SA 4.0 |
| `data/faces/adam-glapinski/01.jpg` | Adam Glapiński | [Prof. Adam Glapinski, Nov 2015.jpg](https://commons.wikimedia.org/wiki/File:Prof._Adam_Glapinski,_Nov_2015.jpg) | Piotr Malecki, Narodowy Bank Polski (National Bank of Poland) | CC BY-SA 2.0 |
| `data/faces/adam-glapinski/02.jpg` | Adam Glapiński | [Adam Glapiński.JPG](https://commons.wikimedia.org/wiki/File:Adam_Glapi%C5%84ski.JPG) | Narodowy Bank Polski | CC BY-SA 2.0 |
| `data/faces/adam-glapinski/03.jpg` | Adam Glapiński | [Adam Glapiński NBP.jpg](https://commons.wikimedia.org/wiki/File:Adam_Glapi%C5%84ski_NBP.jpg) | www.marcinmizerski.com | CC0 |
| `data/faces/mateusz-morawiecki/01.jpg` | Mateusz Morawiecki | [Mateusz Morawiecki 2023.jpg](https://commons.wikimedia.org/wiki/File:Mateusz_Morawiecki_2023.jpg) | Kancelaria Premiera | Public domain |
| `data/faces/mateusz-morawiecki/02.jpg` | Mateusz Morawiecki | [Mateusz Morawiecki, Marcelo Rebelo de Sousa.jpg](https://commons.wikimedia.org/wiki/File:Mateusz_Morawiecki,_Marcelo_Rebelo_de_Sousa.jpg) | The Chancellery of the Prime Minister | CC BY 3.0 pl |
| `data/faces/mateusz-morawiecki/03.jpg` | Mateusz Morawiecki | [Mateusz Morawiecki Monument to Jan Olszewski was erected in front of the Prime Minister's Office.jpg](https://commons.wikimedia.org/wiki/File:Mateusz_Morawiecki_Monument_to_Jan_Olszewski_was_erected_in_front_of_the_Prime_Minister%27s_Office.jpg) | Chancellery of the Prime Minister of Poland | CC BY 3.0 pl |
| `data/faces/mateusz-morawiecki/04.jpg` | Mateusz Morawiecki | [Mateusz Morawiecki podczas szczytu klimatycznego COP26 (2021.11.01) 3.jpg](https://commons.wikimedia.org/wiki/File:Mateusz_Morawiecki_podczas_szczytu_klimatycznego_COP26_(2021.11.01)_3.jpg) | Krystian Maj | CC BY 3.0 pl |
| `data/faces/mateusz-morawiecki/05.jpg` | Mateusz Morawiecki | [Mateusz Morawiecki - action of solidarity with Ukraine.jpg](https://commons.wikimedia.org/wiki/File:Mateusz_Morawiecki_-_action_of_solidarity_with_Ukraine.jpg) | Tomasz Molina | CC BY-SA 4.0 |
| `data/faces/rafal-brzoska/01.jpg` | Rafał Brzóska | [Omenaa Mensah i Rafał Brzoska podczas gali Global Woman of Impact Award 2026.jpg](https://commons.wikimedia.org/wiki/File:Omenaa_Mensah_i_Rafa%C5%82_Brzoska_podczas_gali_Global_Woman_of_Impact_Award_2026.jpg) | Alexandra Dolny | CC BY 4.0 |
| `data/faces/rafal-brzoska/02.jpg` | Rafał Brzóska | [Prime minister Keir Starmer meets Poland PM Donald Tusk (54272116934).jpg](https://commons.wikimedia.org/wiki/File:Prime_minister_Keir_Starmer_meets_Poland_PM_Donald_Tusk_(54272116934).jpg) | Number 10 | CC BY 2.0 |
| `data/faces/rafal-brzoska/03.jpg` | Rafał Brzóska | [Prime minister Keir Starmer meets Poland PM Donald Tusk (54271923026).jpg](https://commons.wikimedia.org/wiki/File:Prime_minister_Keir_Starmer_meets_Poland_PM_Donald_Tusk_(54271923026).jpg) | Number 10 | CC BY 2.0 |
| `data/faces/rafal-brzoska/04.jpg` | Rafał Brzóska | [Rafał Brzoska.png](https://commons.wikimedia.org/wiki/File:Rafa%C5%82_Brzoska.png) | Warsaw PhotoProton Studio | [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) |
| `data/faces/karol-nawrocki/01.jpg` | Karol Nawrocki | [JKRUK 20220903 KAROL NAWROCKI MIELEC DSCN8323A.jpg](https://commons.wikimedia.org/wiki/File:JKRUK_20220903_KAROL_NAWROCKI_MIELEC_DSCN8323A.jpg) | Jarosław Roland Kruk (Jrkruk) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `data/faces/karol-nawrocki/02.jpg` | Karol Nawrocki | [Karol Nawrocki (2025) (cropped).jpg](https://commons.wikimedia.org/wiki/File:Karol_Nawrocki_(2025)_(cropped).jpg) | The White House | Public domain |
| `data/faces/karol-nawrocki/03.jpg` | Karol Nawrocki | [Karol Nawrocki cropped.jpg](https://commons.wikimedia.org/wiki/File:Karol_Nawrocki_cropped.jpg) | Artur Andrzej | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `data/faces/slawomir-mentzen/01.jpg` | Sławomir Mentzen | [Slawomir Mentzen 2023.jpg](https://commons.wikimedia.org/wiki/File:Slawomir_Mentzen_2023.jpg) | Tomasz Molina | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `data/faces/slawomir-mentzen/02.jpg` | Sławomir Mentzen | [Slawomir mentzen rabka.jpg](https://commons.wikimedia.org/wiki/File:Slawomir_mentzen_rabka.jpg) | Jan Majer Palikot | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) |
| `data/faces/slawomir-mentzen/03.jpg` | Sławomir Mentzen | [Sławomir Mentzen.jpg](https://commons.wikimedia.org/wiki/File:S%C5%82awomir_Mentzen.jpg) | Czarnecki Radosław | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `data/faces/slawomir-mentzen/04.jpg` | Sławomir Mentzen | [Sławomir Mentzen Sejm 2022.jpg](https://commons.wikimedia.org/wiki/File:S%C5%82awomir_Mentzen_Sejm_2022.jpg) | Adrian Grycuk | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `data/faces/elon-musk/01.jpg` | Elon Musk | [Elon Musk 2011 Shankbone.JPG](https://commons.wikimedia.org/wiki/File:Elon_Musk_2011_Shankbone.JPG) | David Shankbone | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0) |
| `data/faces/elon-musk/02.jpg` | Elon Musk | [Elon Musk 2015.jpg](https://commons.wikimedia.org/wiki/File:Elon_Musk_2015.jpg) | Steve Jurvetson | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) |
| `data/faces/elon-musk/03.jpg` | Elon Musk | [Elon Musk Colorado 2022 (cropped2).jpg](https://commons.wikimedia.org/wiki/File:Elon_Musk_Colorado_2022_(cropped2).jpg) | U.S. Air Force / Trevor Cokley | Public domain |
| `data/faces/elon-musk/04.jpg` | Elon Musk | [Elon Musk Royal Society (crop2).jpg](https://commons.wikimedia.org/wiki/File:Elon_Musk_Royal_Society_(crop2).jpg) | Debbie Rowe | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| `data/faces/iga-swiatek/01.jpg` | Iga Świątek | [Iga Swiatek, Rafael Nadal.jpg](https://commons.wikimedia.org/wiki/File:Iga_Swiatek,_Rafael_Nadal.jpg) | Both: si.robi | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0) |
| `data/faces/iga-swiatek/02.jpg` | Iga Świątek | [Iga Swiatek (50087761823).jpg](https://commons.wikimedia.org/wiki/File:Iga_Swiatek_(50087761823).jpg) | Carine06 from UK | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0) |
| `data/faces/iga-swiatek/03.jpg` | Iga Świątek | [Iga Swiatek 2023 Cropped + Retouched.jpg](https://commons.wikimedia.org/wiki/File:Iga_Swiatek_2023_Cropped_%2B_Retouched.jpg) | Hameltion | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `data/faces/iga-swiatek/04.jpg` | Iga Świątek | [Iga Swiatek Olympics (cropped).jpg](https://commons.wikimedia.org/wiki/File:Iga_Swiatek_Olympics_(cropped).jpg) | Gastón Cuello | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `data/faces/agata-kornhauser-duda/01.jpg` | Agata Kornhauser-Duda | [Agata Kornhauser-Duda 2022.jpg](https://commons.wikimedia.org/wiki/File:Agata_Kornhauser-Duda_2022.jpg) | Poljska v Sloveniji | [CC BY 3.0 pl](https://creativecommons.org/licenses/by/3.0/pl/deed.en) |
| `data/faces/agata-kornhauser-duda/02.jpg` | Agata Kornhauser-Duda | [Agata Kornhauser-Duda Sejm 2015.JPG](https://commons.wikimedia.org/wiki/File:Agata_Kornhauser-Duda_Sejm_2015.JPG) | Original: Michał JózefaciukDerivative work: TharonXX | [CC BY-SA 3.0 pl](https://creativecommons.org/licenses/by-sa/3.0/pl/deed.en) |
| `data/faces/agata-kornhauser-duda/03.jpg` | Agata Kornhauser-Duda | [Mike and Karen Pence greets by Andrzej and Agata Duda.jpg](https://commons.wikimedia.org/wiki/File:Mike_and_Karen_Pence_greets_by_Andrzej_and_Agata_Duda.jpg) | U.S. Embassy in Warsaw | Public domain |
| `data/faces/dorota-wellman/01.jpg` | Dorota Wellman | [2018 - Pol’and’Rock Festival - Dorota Wellman 01.jpg](https://commons.wikimedia.org/wiki/File:2018_-_Pol%E2%80%99and%E2%80%99Rock_Festival_-_Dorota_Wellman_01.jpg) | Ralf Lotys (Sicherlich) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) |
| `data/faces/dorota-wellman/02.jpg` | Dorota Wellman | [2018 - Pol’and’Rock Festival - Dorota Wellman 08.jpg](https://commons.wikimedia.org/wiki/File:2018_-_Pol%E2%80%99and%E2%80%99Rock_Festival_-_Dorota_Wellman_08.jpg) | Ralf Lotys (Sicherlich) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) |
| `data/faces/dorota-wellman/03.jpg` | Dorota Wellman | [DorotaWellman.jpg](https://commons.wikimedia.org/wiki/File:DorotaWellman.jpg) | Remigiusz Józefowicz | [CC BY-SA 2.5 pl](https://creativecommons.org/licenses/by-sa/2.5/pl/deed.en) |
| `data/faces/magda-gessler/01.jpg` | Magda Gessler | [Gessler Magda.JPG](https://commons.wikimedia.org/wiki/File:Gessler_Magda.JPG) | eSerwis | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0) |
| `data/faces/magda-gessler/02.jpg` | Magda Gessler | [Magda Gessler.JPG](https://commons.wikimedia.org/wiki/File:Magda_Gessler.JPG) | Artur Andrzej | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| `data/faces/magda-gessler/03.jpg` | Magda Gessler | [Magda Gessler (14505644410).jpg](https://commons.wikimedia.org/wiki/File:Magda_Gessler_(14505644410).jpg) | Fryta 73 | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0) |
| `data/faces/magda-gessler/04.jpg` | Magda Gessler | [Magda Gessler 2017.jpg](https://commons.wikimedia.org/wiki/File:Magda_Gessler_2017.jpg) | Serecki | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `data/faces/marek-belka/01.jpg` | Marek Belka | [Marek Belka.JPG](https://commons.wikimedia.org/wiki/File:Marek_Belka.JPG) | Klub Lewicy | Public domain |
| `data/faces/marek-belka/02.jpg` | Marek Belka | [Marek Belka 2016 AB.jpg](https://commons.wikimedia.org/wiki/File:Marek_Belka_2016_AB.jpg) | Template:Portraits | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `data/faces/marek-belka/03.jpg` | Marek Belka | [Marek Belka AB.JPG](https://commons.wikimedia.org/wiki/File:Marek_Belka_AB.JPG) | Chepry 💬 (Andrzej Barabasz) 📷 🇵🇱 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `data/faces/marek-belka/04.jpg` | Marek Belka | [Marek Belka NBP.jpg](https://commons.wikimedia.org/wiki/File:Marek_Belka_NBP.jpg) | NBP (Publication under CC License with the consent of NBP) | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0) |
| `data/faces/malgorzata-rozenek-majdan/01.jpg` | Małgorzata Rozenek-Majdan | [Małgorzata Rozenek-Majdan.jpg](https://commons.wikimedia.org/wiki/File:Ma%C5%82gorzata_Rozenek-Majdan.jpg) | Fryta 73 | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0) |
| `data/faces/malgorzata-rozenek-majdan/02.jpg` | Małgorzata Rozenek-Majdan | [Małgorzata Rozenek-Majdan - 20.01.2026 Komisja Nadzwyczajna do spraw ochrony zwierząt.jpg](https://commons.wikimedia.org/wiki/File:Ma%C5%82gorzata_Rozenek-Majdan_-_20.01.2026_Komisja_Nadzwyczajna_do_spraw_ochrony_zwierz%C4%85t.jpg) | Kancelaria Sejmu | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) |
| `data/faces/malgorzata-rozenek-majdan/03.jpg` | Małgorzata Rozenek-Majdan | [Małgorzata Rozenek 2014.jpg](https://commons.wikimedia.org/wiki/File:Ma%C5%82gorzata_Rozenek_2014.jpg) | Zorro2212 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `data/faces/sebastian-kulczyk/01.jpg` | Sebastian Kulczyk | [Sebastian Kulczyk.jpg](https://commons.wikimedia.org/wiki/File:Sebastian_Kulczyk.jpg) | Kulczyk Investments | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| `data/faces/sebastian-kulczyk/02.jpg` | Sebastian Kulczyk | [Sebastian Kulczyk - fot. Piotr Porebski.jpg](https://commons.wikimedia.org/wiki/File:Sebastian_Kulczyk_-_fot._Piotr_Porebski.jpg) | Piotr Porebski | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0) |
| `data/faces/ewa-drzyzga/01.jpg` | Ewa Drzyzga | [Ewa Drzyzga 2 (22267235788).jpg](https://commons.wikimedia.org/wiki/File:Ewa_Drzyzga_2_(22267235788).jpg) | Fryta 73 | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0) |
| `data/faces/rafal-trzaskowski/01.jpg` | Rafał Trzaskowski | [Rafał Trzaskowski Sejm 2016.JPG](https://commons.wikimedia.org/wiki/File:Rafa%C5%82_Trzaskowski_Sejm_2016.JPG) | Adrian Grycuk | [CC BY-SA 3.0 pl](https://creativecommons.org/licenses/by-sa/3.0/pl/deed.en) |
| `data/faces/rafal-trzaskowski/02.jpg` | Rafał Trzaskowski | [Rafał Trzaskowski 15 May 2020.jpg](https://commons.wikimedia.org/wiki/File:Rafa%C5%82_Trzaskowski_15_May_2020.jpg) | Platforma Obywatelska RP | [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) |
| `data/faces/rafal-trzaskowski/03.jpg` | Rafał Trzaskowski | [Rafał Trzaskowski 2024.jpg](https://commons.wikimedia.org/wiki/File:Rafa%C5%82_Trzaskowski_2024.jpg) | European People's Party | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) |
| `data/faces/rafal-trzaskowski/04.jpg` | Rafał Trzaskowski | [HiT happens - Rafal Trzaskowski.jpg](https://commons.wikimedia.org/wiki/File:HiT_happens_-_Rafal_Trzaskowski.jpg) | Tomasz Molina | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `data/faces/andrzej-domanski/01.jpg` | Andrzej Domański | [Andrzej Domański 2024.jpg](https://commons.wikimedia.org/wiki/File:Andrzej_Doma%C5%84ski_2024.jpg) | The Chancellery of the Prime Minister of the Republic of Poland | [CC BY 3.0 pl](https://creativecommons.org/licenses/by/3.0/pl/deed.en) |
| `data/faces/andrzej-domanski/02.jpg` | Andrzej Domański | [Andrzej Domański KPRM.jpg](https://commons.wikimedia.org/wiki/File:Andrzej_Doma%C5%84ski_KPRM.jpg) | The Chancellery of the Prime Minister of the Republic of Poland | [CC BY 3.0 pl](https://creativecommons.org/licenses/by/3.0/pl/deed.en) |
| `data/faces/andrzej-domanski/03.jpg` | Andrzej Domański | [Donald Tusk, Andrzej Domański – konferencja prasowa 03.09.2024 4.jpg](https://commons.wikimedia.org/wiki/File:Donald_Tusk,_Andrzej_Doma%C5%84ski_%E2%80%93_konferencja_prasowa_03.09.2024_4.jpg) | The Chancellery of the Prime Minister of the Republic of Poland | [CC BY 3.0 pl](https://creativecommons.org/licenses/by/3.0/pl/deed.en) |
| `data/faces/marek-kondrat/01.jpg` | Marek Kondrat | [2010-07 Marek Kondrat 1.jpg](https://commons.wikimedia.org/wiki/File:2010-07_Marek_Kondrat_1.jpg) | Ralf Lotys (Sicherlich) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0) |
| `data/faces/marek-kondrat/02.jpg` | Marek Kondrat | [Marek Kodrat.jpg](https://commons.wikimedia.org/wiki/File:Marek_Kodrat.jpg) | www.marcinmizerski.com | [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) |
| `data/faces/marek-kondrat/03.jpg` | Marek Kondrat | [Marek Kondrat.jpg](https://commons.wikimedia.org/wiki/File:Marek_Kondrat.jpg) | Ja Fryta from Strzegom | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0) |
| `data/faces/marek-kondrat/04.jpg` | Marek Kondrat | [Marek Kondrat1.jpg](https://commons.wikimedia.org/wiki/File:Marek_Kondrat1.jpg) | Piotr Pabiański, uploaded by Zureks | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0) |
| `data/faces/jerzy-szaflik/01.jpg` | Jerzy Szaflik | [Jerzy Szaflik.JPG](https://commons.wikimedia.org/wiki/File:Jerzy_Szaflik.JPG) | Katarzyna Czerwińska | [CC BY-SA 3.0 pl](https://creativecommons.org/licenses/by-sa/3.0/pl/deed.en) |
| `data/faces/jerzy-szaflik/02.jpg` | Jerzy Szaflik | [Jerzy Szaflik Konferencja Innowacyjność w medycynie Senat RP.JPG](https://commons.wikimedia.org/wiki/File:Jerzy_Szaflik_Konferencja_Innowacyjno%C5%9B%C4%87_w_medycynie_Senat_RP.JPG) | Katarzyna Czerwińska | [CC BY-SA 3.0 pl](https://creativecommons.org/licenses/by-sa/3.0/pl/deed.en) |
| `data/faces/adam-torbicki/01.jpg` | Adam Torbicki | [Adam Torbicki 2017.jpg](https://commons.wikimedia.org/wiki/File:Adam_Torbicki_2017.jpg) | Ida Strzelczyk | [CC BY-SA 3.0 pl](https://creativecommons.org/licenses/by-sa/3.0/pl/deed.en) |
| `data/faces/karol-friz-wisniewski/01.jpg` | Karol Wiśniewski | [KarolFrizWisniewski.png](https://commons.wikimedia.org/wiki/File:KarolFrizWisniewski.png) | Hi_5 | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0) |
| `data/faces/omenaa-mensah/01.jpg` | Omenaa Mensah | [Omenaa Mensah (2015).JPG](https://commons.wikimedia.org/wiki/File:Omenaa_Mensah_(2015).JPG) | Ja Fryta | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0) |
| `data/faces/omenaa-mensah/02.jpg` | Omenaa Mensah | [Omenaa Mensah 2018.jpg](https://commons.wikimedia.org/wiki/File:Omenaa_Mensah_2018.jpg) | Serecki | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `data/faces/omenaa-mensah/03.jpg` | Omenaa Mensah | [Omenaa Mensah Global Woman of Impact Award San Francisco 2026.jpg](https://commons.wikimedia.org/wiki/File:Omenaa_Mensah_Global_Woman_of_Impact_Award_San_Francisco_2026.jpg) | Alexandra Dolny | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) |
| `data/faces/julia-wieniawa/01.jpg` | Julia Wieniawa | [JuliaWieniawa.jpg](https://commons.wikimedia.org/wiki/File:JuliaWieniawa.jpg) | Fryta 73 | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0) |
| `data/faces/julia-wieniawa/02.jpg` | Julia Wieniawa | [Julia Wieniawa, Polsat Superhit Festival 2023 03.jpg](https://commons.wikimedia.org/wiki/File:Julia_Wieniawa,_Polsat_Superhit_Festival_2023_03.jpg) | Wojciech Pędzich | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) |
| `data/faces/julia-wieniawa/03.jpg` | Julia Wieniawa | [Julia Wieniawa (2026).jpg](https://commons.wikimedia.org/wiki/File:Julia_Wieniawa_(2026).jpg) | Serecki | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) |
| `data/faces/julia-wieniawa/04.jpg` | Julia Wieniawa | [Julia Wieniawa Narkiewicz.jpg](https://commons.wikimedia.org/wiki/File:Julia_Wieniawa_Narkiewicz.jpg) | Gary Muvaut | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0) |
| `data/faces/marcin-prokop/01.jpg` | Marcin Prokop | [Fryderyki 2024 089.jpg](https://commons.wikimedia.org/wiki/File:Fryderyki_2024_089.jpg) | Wojciech Pędzich | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) |
| `data/faces/marcin-prokop/02.jpg` | Marcin Prokop | [Marcin Prokop, Sopot Top of the Top Festival 2022, dzień 3 01.jpg](https://commons.wikimedia.org/wiki/File:Marcin_Prokop,_Sopot_Top_of_the_Top_Festival_2022,_dzie%C5%84_3_01.jpg) | Wojciech Pędzich | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) |
| `data/faces/marcin-prokop/03.jpg` | Marcin Prokop | [MarcinProkop.jpg](https://commons.wikimedia.org/wiki/File:MarcinProkop.jpg) | Remigiusz Józefowicz | [CC BY-SA 2.5 pl](https://creativecommons.org/licenses/by-sa/2.5/pl/deed.en) |
| `data/faces/marcin-prokop/04.jpg` | Marcin Prokop | [Marcin Prokop (16698016397).jpg](https://commons.wikimedia.org/wiki/File:Marcin_Prokop_(16698016397).jpg) | Fryta 73 | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0) |
| `data/faces/tomasz-sekielski/01.jpg` | Tomasz Sekielski | [Tomasz.Sekielski.JPG](https://commons.wikimedia.org/wiki/File:Tomasz.Sekielski.JPG) | #WybieramEuropę | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0) |
| `data/faces/tomasz-sekielski/02.jpg` | Tomasz Sekielski | [Tomasz Sekielski-tsekielski.jpg](https://commons.wikimedia.org/wiki/File:Tomasz_Sekielski-tsekielski.jpg) | Cezary p | [CC BY-SA 3.0](http://creativecommons.org/licenses/by-sa/3.0/) |
| `data/faces/tomasz-sekielski/03.jpg` | Tomasz Sekielski | [Tomasz Sekielski 2013.jpg](https://commons.wikimedia.org/wiki/File:Tomasz_Sekielski_2013.jpg) | Piotr Drabik from Poland | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) |
| `data/faces/bartosz-zmarzlik/01.jpg` | Bartosz Zmarzlik | [B.Zmarzlik.jpg](https://commons.wikimedia.org/wiki/File:B.Zmarzlik.jpg) | Staszek99 | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| `data/faces/bartosz-zmarzlik/02.jpg` | Bartosz Zmarzlik | [Bartek Zmarzlik.jpg](https://commons.wikimedia.org/wiki/File:Bartek_Zmarzlik.jpg) | Keraj1976 | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| `data/faces/bartosz-zmarzlik/03.jpg` | Bartosz Zmarzlik | [Bartosz Zmarzlik (2022).jpg](https://commons.wikimedia.org/wiki/File:Bartosz_Zmarzlik_(2022).jpg) | Hubczaj | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `data/faces/bartosz-zmarzlik/04.jpg` | Bartosz Zmarzlik | [Bartosz Zmarzlik (GP 2022).jpg](https://commons.wikimedia.org/wiki/File:Bartosz_Zmarzlik_(GP_2022).jpg) | Hubczaj | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `data/faces/robert-kubica/01.jpg` | Robert Kubica | [Robert Kubica 2007-08-14.jpg](https://commons.wikimedia.org/wiki/File:Robert_Kubica_2007-08-14.jpg) | Slawek | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0) |
| `data/faces/robert-kubica/02.jpg` | Robert Kubica | [Robert Kubica 2009 Australia.jpg](https://commons.wikimedia.org/wiki/File:Robert_Kubica_2009_Australia.jpg) | Ann64 | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0) |
| `data/faces/robert-kubica/03.jpg` | Robert Kubica | [Robert Kubica 2010 Malaysia.jpg](https://commons.wikimedia.org/wiki/File:Robert_Kubica_2010_Malaysia.jpg) | Morio | [CC BY-SA 3.0](http://creativecommons.org/licenses/by-sa/3.0/) |
| `data/faces/robert-kubica/04.jpg` | Robert Kubica | [Rajd Polski 2015 Robert Kubica 3.JPG](https://commons.wikimedia.org/wiki/File:Rajd_Polski_2015_Robert_Kubica_3.JPG) | Makary | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |

## 8. Czego nie używamy

| Składnik | Licencja | Powód |
|---|---|---|
| warcio | Apache-2.0 | licencja nie jest problemem; WARC (ISO 28500) z HAR zapisuje własny kod (`lib/evidence/warc.ts`), żeby nie dokładać Pythona do paczki; czytelność WARC sprawdza test własnym czytnikiem |
| browsertrix-crawler | AGPL-3.0 | AGPL; archiwizacja stron przez crawler to osobne narzędzie poza repozytorium, bez potwierdzonego arm64 |
| PyMISP, stix2, misp-stix | BSD-2-Clause / MIT | nie są potrzebne; STIX 2.1 zapisuje własny kod (`lib/evidence/stix.ts`) wprost jako JSON zgodnie ze specyfikacją OASIS |
| Baza odcisków technologii `webappanalyzer` (następca Wappalyzera) | GPL-3.0 | wymusiłaby GPL na kodzie, który ją dołącza; atrybut platformy powstaje z własnych wzorców (`lib/osint`, `lib/graph/config.ts`) |
| httpx (ProjectDiscovery) | MIT | licencja nie jest problemem; odrzucony, bo aktywne sondowanie hostów łamie zasadę pasywności narzędzia |
| DeepFace z domyślnym modelem, InsightFace | modele na licencjach niekomercyjnych | nie używane; ewentualny adapter twarzy musi mieć model o licencji pozwalającej na użycie |

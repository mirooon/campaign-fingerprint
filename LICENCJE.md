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
| `speechbrain/vad-crdnn-libriparty` (CRDNN) | – | **licencja wag niepodana na karcie modelu**; kod SpeechBrain: Apache-2.0; model trenowany na LibriParty z szumem UrbanSound8K (CC BY-NC) | detekcja mowy (odróżnia głos od muzyki) przed dopasowaniem głosu do galerii (`--speaker`), opcjonalna | osobny proces Pythona, model poza repozytorium i poza obrazem domyślnym (`SPEAKER_VAD_DIR`, profil `full`) | [karta modelu](https://huggingface.co/speechbrain/vad-crdnn-libriparty); **do potwierdzenia przed użyciem komercyjnym**, zastępnik: inny VAD o jasnej licencji |
| OpenCV YuNet `face_detection_yunet_2023mar.onnx` (OpenCV Zoo) | 2023mar | MIT | wykrywanie twarzy (`--faces`): ramka i wynik detektora | plik ONNX poza repozytorium (`FACE_MODEL_DIR`, w obrazie Dockera pobierany przy budowie), czytany przez osobny proces Pythona | [opencv_zoo/face_detection_yunet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) |
| OpenCV SFace `face_recognition_sface_2021dec.onnx` (OpenCV Zoo) | 2021dec | Apache-2.0 | wektor twarzy 128 liczb do porównania z zamkniętą listą 8 osób publicznych (`--faces`); wynik „podobna twarz do X (0,xx)” do przeglądu człowieka | jak wyżej | [opencv_zoo/face_recognition_sface](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) |
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
| yt-dlp | 2026.08.19 (lokalnie) | Unlicense | `scripts/py/build_voice_index.py` pobiera nim fragmenty dźwięku nagrań do galerii głosów (narzędzie deweloperskie, nie jest w obrazie ani nie działa przy analizie materiału); poza tym kod czyta tylko plik `.info.json`, który użytkownik sam wygenerował (reklamodawca, identyfikator biblioteki reklam) | osobny proces | [github.com/yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp) |
| Python | 3.11.2 (obraz), 3.12 (`setup-speaker.sh`, `setup-face.sh`) | PSF-2.0 | uruchomienie adapterów Pythona | osobny proces | [python.org](https://www.python.org) |
| `opencv-python-headless` (pakiet z `scripts/py/requirements.txt` i `setup-face.sh`) | 5.1.0.95 (sprawdzona lokalnie) | Apache-2.0 (kod OpenCV; koła PyPI zawierają też biblioteki o licencjach liberalnych) | detektor YuNet i rozpoznawanie SFace (`--faces`) | osobny proces Pythona, venv `/opt/venv` albo `.venv-face` | [pypi.org/project/opencv-python-headless](https://pypi.org/project/opencv-python-headless/) |
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
| Team Cymru IP-to-ASN | usługa publiczna, DNS TXT | numer systemu autonomicznego dla adresu IP | zapytania pasywne | [team-cymru.com](https://team-cymru.com/community-services/ip-asn-mapping/) |
| Logi Certificate Transparency, CertStream | publiczne | strumień nowych certyfikatów (watcher CT) | lokalny serwer albo publiczny strumień | – |
| urlscan.io | warunki serwisu; klucz do pełnego dostępu | tylko do zbierania danych walidacyjnych, **poza kodem narzędzia** | nieużywane w kodzie | [urlscan.io](https://urlscan.io) |
| Anthropic API | warunki komercyjne, klucz | opcjonalny LLM | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| Ollama (lokalna) | MIT | opcjonalny LLM i embeddingi | lokalny proces | patrz wyżej |
| Biblioteka reklam Mety (publiczna strona) | regulamin Mety | dane o płatniku i zasięgu reklamy | tylko `--ad-library`, przez MetaAdsCollector | [facebook.com/ads/library](https://www.facebook.com/ads/library/) |
| Hugging Face Hub, rejestr Ollamy | licencje poszczególnych modeli | jednorazowe pobranie modeli | ręcznie lub przez Ollamę | – |

## 5. Kontrola składników o licencjach niekomercyjnych (NC)

Sprawdzone `grep -rli 'deepface\|insightface\|buffalo' lib scripts app docker Dockerfile docker-compose.yml package.json` (bez trafień) i listą zależności z punktu 1: **żaden adapter nie pobiera ani nie używa komponentów o licencji niekomercyjnej** (np. DeepFace z domyślnym modelem, InsightFace); rozpoznawanie twarzy używa wyłącznie YuNet (MIT) i SFace (Apache-2.0) z OpenCV Zoo. Żaden pakiet npm z punktu 1 nie ma licencji NC ani GPL. Składnik na licencji copyleft w obrazie to FFmpeg (GPL-2.0-or-later) jako osobny proces i `libvips` (LGPL-3.0-or-later) jako biblioteka dynamiczna `sharp`. Gdy późniejsze zadanie doda adapter (twarze, głos), powinno dopisać tu wynik takiej kontroli.


## 7. Oświadczenie o braku wad prawnych

- Repozytorium nie zawiera materiałów udostępnionych przez organizatora ani ich fragmentów; dane przykładowe i testowe są syntetyczne ([README.md](README.md#pochodzenie-danych)).
- Wszystkie składniki z punktów 1–3 są używane zgodnie z ich licencjami; składniki copyleft działają jako osobne procesy albo dynamicznie ładowane biblioteki.
- Galeria głosów (`data/voices`, zamknięta lista 10 osób): **w repozytorium i w obrazie są tylko wektory cech głosu (192 liczby na nagranie) i lista źródeł [data/voices/ZRODLA.md](data/voices/ZRODLA.md)**: adres każdego nagrania (YouTube), kanał (autor), fragment, licencja filmu albo podstawa użycia (standardowa licencja YouTube: nagrania publicznych wystąpień służą wyłącznie do wyliczenia wektora, nie są przechowywane w repozytorium ani publikowane; 6 z 76 fragmentów ma licencję Creative Commons Attribution) i data pobrania. Nagrania leżą poza repozytorium i nie trafiają do obrazu. Wektor nie pozwala odtworzyć głosu. Demucs nie jest użyty. Brak wad prawnych oznacza tu zgodność z warunkami licencji; prawo do wykorzystania głosu jako danych biometrycznych: [docs/ZGODNOSC.md](docs/ZGODNOSC.md).
- Zdjęcia referencyjne osób publicznych (`data/faces`, zamknięta lista 8 osób do rozpoznawania twarzy): każde pochodzi z Wikimedia Commons, z licencją pozwalającą na redystrybucję (CC BY, CC BY-SA, CC0, domena publiczna); poniżej źródło, autor i licencja każdego pliku (pełniejsza tabela z datą pobrania i datą zdjęcia: [data/faces/ZRODLA.md](data/faces/ZRODLA.md)). Pliki są przycięte do twarzy i zmniejszone; wiersze CC BY-SA dotyczą opracowań udostępnianych na tej samej licencji. Żadne zdjęcie nie pochodzi z materiałów spraw (sprawdza skaner `leak_scan.py`, także obrazy). Brak wad prawnych oznacza tu zgodność z warunkami tych licencji (autor, licencja, zmiany); nie jest to ocena prawa do wizerunku, patrz [docs/ZGODNOSC.md](docs/ZGODNOSC.md).

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

## 8. Czego nie używamy

| Składnik | Licencja | Powód |
|---|---|---|
| Baza odcisków technologii `webappanalyzer` (następca Wappalyzera) | GPL-3.0 | wymusiłaby GPL na kodzie, który ją dołącza; atrybut platformy powstaje z własnych wzorców (`lib/osint`, `lib/graph/config.ts`) |
| httpx (ProjectDiscovery) | MIT | licencja nie jest problemem; odrzucony, bo aktywne sondowanie hostów łamie zasadę pasywności narzędzia |
| DeepFace z domyślnym modelem, InsightFace | modele na licencjach niekomercyjnych | nie używane; ewentualny adapter twarzy musi mieć model o licencji pozwalającej na użycie |

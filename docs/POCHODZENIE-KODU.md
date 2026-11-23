# Pochodzenie kodu

Szczegóły do skrótu w [JURY.md](JURY.md#pochodzenie-kodu) (sekcja „Pochodzenie kodu”; do 22.11.2026 w README). Kody w tabeli (m0, i1, i14…) to nazwy zadań z dziennika pracy zespołu; opis każdego zadania jest w kolumnie „Co powstało” i w komunikatach commitów.

Szkielet narzędzi OSINT i grafowych przygotowałem przed wydarzeniem, 18–20.11.2026, w osobnym prywatnym repozytorium. W trakcie wydarzenia (od 21.11.2026, 11:00) pracuję dalej.

Kod trafił do tego repozytorium bez historii git. Lokalne commity z 21.11 miały w testach wartości z materiałów organizatora (domeny, identyfikatory kliknięć i reklam, nazwy plików, tytuły stron, teksty ze zrzutów), a tych materiałów nie wolno rozpowszechniać. Tutaj zastąpiłem je wartościami syntetycznymi o tej samej strukturze, więc testy sprawdzają to samo co wcześniej.

### Przygotowane przed wydarzeniem

Stan z ostatniego commitu przed wydarzeniem (19.11.2026), 260 plików:

- katalog główny: `package.json`, `bun.lock`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.mts`, `next.config.ts`, `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.env.example`, `.gitignore`, `AGENTS.md`, README;
- `app/`: layout, strona, style, API `material`, `analyze-material`, `click-route`, `add-to-base`, `evidence`, `ct-feed`, `image`;
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

Źródło: historia git tego repozytorium (commity kontrolne po zadaniach, 21–22.11.2026; wcześniejsza historia nie została przeniesiona, zob. wyżej) i raporty zadań. Tabela wymienia zadania z pierwszej doby; późniejsze (22.11.2026) opisują komunikaty commitów w `git log`.

| Zadanie | Co powstało |
|---|---|
| m0 | start repozytorium bez historii: przeniesienie kodu z prywatnego repozytorium (README i `.gitignore` jako pierwszy commit), dane syntetyczne |
| i1 | analiza nowego materiału: werdykty `duplicate` i `insufficient`, partie (`--cases`, `--each-file`, `--dataset`), eksport CSV z ustaloną kolejnością kolumn, pewność `certain/likely/uncertain`, techniki stron i blok fałszywych komentarzy, `onProgress` |
| i14 | cechy platform zamiast cech operatora (serwer trackera po maszynie, najemca platformy, backend z identyfikatorem klienta, zniżki ×0,1), reguły treści i pole `basis` |
| i14b | wariant kreacji: dołączanie, nigdy scalanie (`attachContentVariants`) |
| i14c | ślady zestawu stron nie sumują się w kampanię, biblioteka landerów „666”, konflikt kont wygrywa z silnym `path_id` |
| i2 | nowy interfejs: zakładki „Analizuj materiał”, „Kampanie”, „Porównaj”, „Graf powiązań”, „Jak to działa”, API zadań (`/api/material`), moduły `lib/viewer`, dymki pomocy |
| i2fix | GUI po zmianach backendu: pola `basis`, wariantu, narracji, mostu, twarzy i głosów (`lib/viewer/fields.ts`), ewolucja kampanii z macierzą śladów i osią czasu (`lib/viewer/evolution.ts`), trasa kliknięcia (`/api/click-route`), „Dodaj do bazy” (`/api/add-to-base`), stara analiza tylko w Trybie eksperta |
| i16 | rozszerzenie skanera wycieków danych poufnych (narzędzie poza repozytorium) |
| i15 | galeria głosów osób publicznych: `--speaker` z dopasowaniem okien (`voices`), `data/voices`, `scripts/py/build_voice_index.py`, `bun run voice:eval`, próg z pomiaru |
| i5 | persona z twarzy: `--faces` (OpenCV YuNet + SFace), zamknięta lista osób publicznych (`data/osoby-publiczne.json`, 31 osób ze zdjęciami w `data/faces`), `scripts/py/face_embed.py`, `setup-face.sh`, próg z pomiaru |
| i7 | `bun run base`, `bun run demo`, obraz Dockera z narzędziami do mediów, profile `full`/`llm`/`ct`, limity API (`ANALYZE_RATE_LIMIT`, `MATERIAL_MAX_MB`), `cache:freeze` |
| i8 | dokumentacja: README, `docs/METODYKA.md`, `LICENCJE.md`, `LICENSE`, `bun run licenses` |
| i9 | wiedza jako wynik: `docs/WZORCE-KAMPANII.md`, `docs/ZRODLA-METADANYCH.md` (+ `bun run source-stats`), `bun run export-dataset` (JSON, CSV, Neo4j), `bun run report`, `docs/INTEGRACJA.md` i schematy JSON, etykieta „znany backend leadów” |

Przeniesienie kodu do tego repozytorium nastąpiło bez historii (opis wyżej): commity sprzed 21.11.2026 11:00 są w prywatnym repozytorium.

# Integracja z systemem instytucji

Kontrakt wejścia i wyjścia narzędzia, wersjonowany (obecnie **1.0**, `CONTRACT_VERSION` w `lib/pipeline/contract.ts`). Wersja rośnie, gdy pole znika albo zmienia znaczenie; dodanie pola opcjonalnego jej nie zmienia. Schematy JSON (draft 2020-12): [`schema/input-file.schema.json`](schema/input-file.schema.json) i [`schema/material-result.schema.json`](schema/material-result.schema.json), generowane z kodu poleceniem `bun run contract-schema` (test pilnuje, że pliki zgadzają się z kodem).

## Wejście

Trzy sposoby, wszystkie z tego samego rdzenia analizy:

| sposób | polecenie | uwagi |
|---|---|---|
| katalogi spraw | `bun run analyze-material -- --cases <katalog> --data <baza>` | podkatalog = sprawa (strona, HAR, zrzut, nagranie) |
| plik CSV, TSV, JSON albo JSONL | `bun run analyze-material -- --dataset zgloszenia.csv --data <baza>` | wiersz = materiał; kolumny w stylu systemów instytucji (`id`, `text`, `landing_url`, `first_seen`, `persona`, `deepfake_score`…); synonimy kolumn w `lib/pipeline/ingest.ts`, własne nazwy przez `--mapping m.json` |
| pojedynczy link lub tekst | `--url <link>`, `--text <treść>` | |

Rekord pliku (schemat `input-file`): `id` (wymagane), `platform`, `advertiser`, `text`, `imageUrl`, `imagePath` (względem pliku), `landingUrl`, `firstSeen`, `lastSeen` (ISO 8601), `persona` (osoba podszywana, kilka rozdzielonych `;` albo `|`), `deepfakeScore` (0..1, wynik zewnętrznego detektora: wynik modelu, nie fakt), `videoPath`. Przykład syntetyczny: [`schema/example-input.json`](schema/example-input.json). Nieznana kolumna w schemacie jest błędem; ingest przy imporcie CSV sam rozpoznaje synonimy, więc schemat opisuje postać kanoniczną (JSON).

## Wyjście

- **Wynik pełny:** `--json wynik.json` (albo `-` na standardowe wyjście): `MaterialResult` (schemat `material-result`): `items[]` z werdyktem (`known_campaign`, `similar_campaigns`, `new_campaign`, `duplicate`, `insufficient`), kampanią, podobnymi kampaniami, powiązaniami z przesłankami (`links[].evidence[]`: tekst, waga, siła), brakami (`missing`), błędami; `steps[]` (każdy krok z powodem pominięcia), `skipped[]`, `notes[]`. Szczegóły zagnieżdżone (cechy, przesłanki) są w schemacie opisane luźno: stabilna część kontraktu to werdykt, kampanie i przesłanki.
- **Partia CSV:** `--csv wynik.csv`, kolumny w stałej kolejności: `material_id, case, verdict, campaign_id, similar_campaigns, new_campaign_id, duplicate_of, confidence, score, top_premise, missing_data, blisko_bez_polaczenia` (`confidence`: `certain`, `likely`, `uncertain`; `blisko_bez_polaczenia`: znane kampanie, do których materiał był blisko, ale nie dołączył, z regułą). Sprawa, której import nie zamienił w rekord, też ma wiersz: `insufficient` z powodem importera w `missing_data`. Dotyczy to także sprawy z plikiem, którego nie da się odczytać ani sparsować, i uszkodzonego wiersza JSON/JSONL przy `--dataset`; reszta partii jest analizowana normalnie.

Znaczenie kolumn partii CSV (jeden wiersz na materiał, kolejność stała; to samo zwraca eksport z GUI):

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
| `blisko_bez_polaczenia` | znane kampanie, do których materiał był blisko, ale nie dołączył, z regułą (np. `K03: account-conflict`) |

- **Zbiór wzbogacony:** `bun run export-dataset -- --data <baza> --out <katalog> --csv` (kolumny: `material_id, campaign_id, family_id, features, top_premises, ad_library_url, basis, persona, deepfake_score`; bez wektorów głosu i twarzy) i `--neo4j <katalog>` (graf do `neo4j-admin database import`).

## Uruchomienie w kontenerze bez sieci

```bash
docker run --rm --network none -v "$PWD/dane:/dane" odcisk-kampanii:latest bun run analyze-material -- --dataset /dane/zgloszenia.csv --json /dane/wynik.json --csv /dane/wynik.csv
```

Baza znanych kampanii leży w `./dane/baza` (zob. README); obraz `odcisk-kampanii:latest` powstaje przez `docker compose build app`. `docker compose run` nie przyjmuje `--network`, więc bez sieci używamy `docker run`. Bez sieci krok niedostępny (DNS, RDAP, archiwa) jest pomijany z powodem w `steps[]`.

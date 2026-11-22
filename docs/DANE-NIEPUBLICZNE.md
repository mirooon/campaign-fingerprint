# Paczka danych niepublicznych

Repozytorium jest publiczne, więc nie ma w nim niczego, co wyliczono z poufnych spraw. Wszystko takie leży w osobnej **paczce niepublicznej**: folder na Dysku Google dostępny tylko dla osób, które dostarczyły dane i oceniają narzędzie. Poniżej opis, co jest w paczce, jak jej użyć i jak zamiast niej zbudować bazę samodzielnie. Ten dokument nie zawiera żadnych wartości z danych.

## Co jest w paczce

| Katalog | Zawartość |
|---|---|
| `baza/` | Gotowy przebieg na sprawach: `graph.json`, `campaigns.json`, `enriched.json` oraz wagi łączenia (`linking.json`) i lista osób (`personas.json`), jeśli istniały. Tego czyta GUI i `analyze-material --data`. |
| `zbior/` | Wzbogacony zbiór (JSON i CSV) z `bun run export-dataset`. |
| `wiedza/` | Wzorce kampanii z przykładami ze spraw, wyniki i metryki, walidacja, wnioski o twarzach, tekście, komentarzach i zrzutach. |
| `etykiety/` | Opcjonalnie: etykiety zespołu (nie właściciela danych), tylko gdy paczkę zbudowano z `--with-labels`. |
| `README.md` | Co jest w tej konkretnej paczce, skąd pochodzi i czego w niej brakuje. |
| `MANIFEST.json` | Lista plików z SHA-256 i rozmiarem, commit repozytorium, data i wersja przebiegu. |

Paczka nie zawiera plików spraw (odbiorca ma własną kopię), kluczy API, plików `.env` ani pamięci podręcznej.

## Dlaczego nie ma tego w repozytorium

Baza, wzorce z przykładami i wyniki wyliczono z prawdziwych oszustw. Nawet zagregowane wartości (domeny, identyfikatory, opisy) pozwalają odtworzyć, kogo i czego dotyczyły sprawy. W repozytorium są tylko kod, konfiguracja i dane syntetyczne (`data/sample`).

## Ścieżki do spraw

Wyniki przebiegu wskazują pliki spraw (zrzuty, wideo). W paczce te ścieżki są **względne**, np. `sprawy/<sprawa>/<plik>`. Własną kopię spraw podajesz zmienną `CASES_DIR`: katalog, w którym leży `sprawy/` (albo sam katalog `sprawy/`; narzędzie próbuje obu). Bez `CASES_DIR` wszystko działa, ale podgląd zrzutów w GUI zwraca komunikat o brakującej zmiennej, a porównanie obrazów z bazą (wykrywanie duplikatów po obrazie) jest pomijane z powodem w notatkach wyniku.

## Użycie lokalnie (bez kontenera)

Rozpakuj paczkę (`<paczka>`) i wskaż katalog `baza/`:

```
VIEWER_DATA_DIR=<paczka>/baza CASES_DIR=<katalog ze sprawami> bun run dev
bun run analyze-material -- --cases <nowe> --data <paczka>/baza --csv wynik.csv
```

Dla `analyze-material` zmienną `CASES_DIR` ustaw w środowisku (`CASES_DIR=<katalog ze sprawami> bun run analyze-material -- …`). GUI pod `http://localhost:3000` pokazuje bazę z paczki; zakładka „Analizuj materiał” porównuje nowe materiały z tą bazą.

## Użycie w kontenerze

`docker-compose.yml` czyta bazę z `/dane/baza` (`VIEWER_DATA_DIR`). Podłącz bazę z paczki zamiast tej budowanej w `./dane/baza` i, jeśli chcesz podgląd zrzutów, własne sprawy: w `docker-compose.yml` odkomentuj wolumeny w usłudze `app`, a zmienne ustaw w środowisku:

```
# docker-compose.yml, usługa app → volumes:
#   - /ścieżka/do/paczki/baza:/dane/baza:ro
#   - /ścieżka/do/spraw:/sprawy:ro
CASES_DIR=/sprawy docker compose up -d
CASES_DIR=/sprawy docker compose run --rm app bun run analyze-material -- --cases /dane/nowe --csv /dane/wynik.csv
```

Nowe materiały leżą w `./dane/nowe`, wynik trafia do `./dane/wynik.csv`.

## Zamiast paczki: własna baza

Jeśli masz własną kopię spraw, bazę zbudujesz sam, bez przeliczania cudzych wyników:

```
bun run base -- --cases <katalog spraw> --out <katalog bazy>
VIEWER_DATA_DIR=<katalog bazy> bun run dev
```

W kontenerze: `docker compose run --rm app bun run base -- --cases /dane/probka`. Szczegóły i opcje (`--offline`, `--lookups`, `--labels`, `--config`) opisuje `bun run base -- --help` oraz README. Baza zbudowana samodzielnie ma ścieżki bezwzględne do Twoich spraw, więc `CASES_DIR` nie jest jej potrzebne.

# Interfejs: jak przeprowadzić analizę

Uruchomienie: `bun run pipeline --offline` (baza przykładowa), potem `bun run dev` i adres `http://localhost:3000`.
Własna baza: `VIEWER_DATA_DIR=<katalog z graph.json, campaigns.json, enriched.json> bun run dev`.

## Analiza materiału (zakładka „Analizuj materiał”)

1. Upuść pliki, folder albo ZIP (zrzut, zapisana strona, HAR, wideo) albo wklej link lub tekst reklamy.
2. Sprawdź podział na sprawy. Domyślny podział jest podpowiedzią, zmienisz go w trzech opcjach: jedna sprawa, każdy podfolder to sprawa, każdy plik to osobny materiał.
3. Zostaw włączone „Dociągnij publiczne dane o domenach” albo wyłącz je, gdy pracujesz bez internetu.
4. „Analizuj”. Adres z `?job=` wraca do tego samego zadania po odświeżeniu.
5. Wynik: lejek liczb (kliknięcie filtruje tabelę), tabela materiałów i karta wyniku po rozwinięciu wiersza. Eksport: CSV i JSON, kolumny jak w `bun run analyze-material --csv`.

## Jak czytać werdykt

| Werdykt | Znaczy |
|---|---|
| Znana kampania | materiał ma wspólne ślady z kampanią z bazy powyżej progu łączenia |
| Nowa kampania, podobna do… | ten sam szablon, narracja albo persona, ale różni operatorzy; „Osobno, bo” podaje powód |
| Nowa kampania | żadne powiązanie nie przekracza progu |
| Duplikat | ta sama reklama zebrana ponownie; podany jest oryginał i jego kampania |
| Za mało danych | materiał nie ma cech do porównania; lista „Co dorzucić” mówi, czego brakuje |

Pewność: **pewne** (przesłanka o wysokiej sile), **prawdopodobne** (siła powiązania co najmniej 0,5), **niepewne**. Wariant przypisany po samej kreacji nigdy nie jest „pewny”. Kampania „z treści, bez infrastruktury” ma słabszą podstawę niż wspólne konto lub serwer.

Siła przesłanki: Wysoka (łączy samodzielnie) · Średnia (liczy się razem z innymi) · Wymaga potwierdzenia (potrzebny drugi rodzaj śladu) · Pominięta (ślad wspólny dla wielu niezależnych stron) · Opis, nie dowód. Każdy poziom ma słowo, ikonę i styl, nie tylko kolor.

Etykieta „dane syntetyczne” stoi w nagłówku, gdy baza to próbka dołączona do repozytorium, i przy wyniku „Wczytaj przykład”.

## Zmienne środowiskowe

`VIEWER_DATA_DIR`, `MATERIAL_WORK_DIR` (pliki zadań, domyślnie katalog tymczasowy), `MATERIAL_MAX_MB` (limit wgrywania, domyślnie 500), `MATERIAL_TIMEOUT_MS`, `LINK_CONFIG`, `PERSONAS_FILE`, `BUN_BIN`.

## Zależności dodane dla GUI

`lucide-react` (ISC, ikony), `fflate` (MIT, rozpakowanie ZIP na serwerze).

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

## Karta wyniku i karta kampanii

- **Trasa kliknięcia** (karta wyniku, a w karcie kampanii pod „Trasa kliknięcia pierwszego materiału”): ogniwa reklama → link śledzący → przekierowania → strona-przynęta albo formularz/sklep, każde z rolą, rozbrojonym adresem, statusem („przekierował”, „odpowiada”, „nie odpowiada”, „zablokowany”), wiekiem domeny względem emisji z RDAP („zarejestrowana 2 dni przed emisją”, pogrubione do 30 dni) i ostrzeżeniem o cloakingu. Dane: `enriched.json` bazy albo zadania (`/api/click-route`).
- **Macierz wspólnych śladów, ewolucja i oś czasu** (karta kampanii): kolumny od najsilniejszego śladu, przy każdym materiale „zmieniło się: domena, osoba; zostało: tracker” względem wszystkich wcześniejszych, oś z emisjami, rejestracjami domen i certyfikatami. Zapisów stron na osi nie ma (graf nie przechowuje daty zapisu).
- **Co rozpoznano**: „podobna twarz do X (0,57)” i „głos podobny do X (0,70)” (do sprawdzenia przez człowieka, nigdy „to jest X”), podrabiana marka, narracja, wiek domeny i certyfikatu. Kampania sklejona jednym śladem i najsłabsze ogniwo mają własne uwagi.
- **Dodaj do bazy**: przy wyniku (nowa lub znana kampania) i nad listą partii. Po dodaniu komunikat, co dodano, a czego nie i dlaczego (duplikat, za mało danych, id już w bazie), potem odświeżenie bazy. Baza przykładowa (`data/`) i wynik „Wczytaj przykład” są tylko do odczytu: przycisk jest wyłączony z opisem. Żeby dopisywać, skopiuj bazę i uruchom z `VIEWER_DATA_DIR=<kopia>`. Poprzednie pliki bazy lądują w `<baza>/historia/`.
- **Tryb eksperta** ma panel „Nowa reklama”: ta sama analiza jednym żądaniem (`/api/analyze-material`), bez zadań i postępu. Stara, przybliżona trasa `/api/analyze` (idf z oryginalnego zbioru, bez DOM i dźwięku, tekst ucięty do 600 znaków) nie ma już ścieżki w GUI; zostaje opisana w `docs/TECHNICAL.md` §8.1 jako wycofywana.

## Dalsze widoki (P2)

- **Skala werdyktu** (karta wyniku): pasek 0–1 z dwoma progami (kampania, grupa podobnych), strefy „nowy wzorzec · grupa podobnych · kampania” i zdanie, także gdy reguła zmieniła wynik; przy nowym wzorcu najbliższy znany materiał z wynikiem i przyciskiem „Porównaj”. Pojedyncze materiały na liście kampanii mówią, do której kampanii jest im najbliżej.
- **Filtry kampanii**: narracja, platforma stron, okres; nazwa kampanii zawiera główny temat. Wynik partii: „niepewne: do sprawdzenia”.
- **Porównaj**: udział rodzin cech w wyniku z procentami i zaznaczone wspólne fragmenty tekstu (co najmniej cztery słowa).
- **Notatki autora strony** (karta materiału): `COMMENT n: … — rola` i `X-POST: …` z kodu strony.
- **Nowe domeny tej kampanii** (karta kampanii): kandydaci z feedu CT z czasem certyfikatu względem pierwszej reklamy.
- **Kogo rozpoznajemy** (zakładka): lista osób z galerii twarzy i głosów z liczbą wzorców i źródłem wpisu; bez wektorów.
- **Jakość danych** (zakładka): ile materiałów bez zrzutu, strony, HAR, adresu, wideo; rząd pięciu ikon z dymkiem „powód · skutek”.
- **Decyzja analityka** (karta kampanii): „do zgłoszenia”, „zgłoszone”, „odrzucone”, „do weryfikacji”, zapis w `decyzje.json` obok bazy (dla bazy przykładowej w katalogu roboczym, nigdy w repozytorium). „Odrzucone” i „do weryfikacji” blokują paczkę dowodów (409 z komunikatem); brak decyzji nie blokuje.
- **Graf powiązań**: widok zredukowany (kampanie i wspólne ślady, reklamy zwinięte; kliknięcie rozwija kampanię do materiałów albo ślad do innych kampanii) i „rozwijaj graf od materiału”. Pełny graf: przełącznik „pełny” albo Tryb eksperta.
- **Progi** (Tryb eksperta, panel boczny): suwak progu łączenia z liczbą kampanii policzoną klasteryzacją backendu na zapisanych powiązaniach (przybliżenie: graf trzyma najsilniejsze powiązania każdej reklamy).

Etykieta „dane syntetyczne” stoi w nagłówku, gdy baza to próbka dołączona do repozytorium, i przy wyniku „Wczytaj przykład”.

## Zmienne środowiskowe

`VIEWER_DATA_DIR`, `MATERIAL_WORK_DIR` (pliki zadań, domyślnie katalog tymczasowy), `MATERIAL_MAX_MB` (limit wgrywania, domyślnie 500), `MATERIAL_TIMEOUT_MS`, `LINK_CONFIG`, `PERSONAS_FILE`, `BUN_BIN`.

## Zależności dodane dla GUI

`lucide-react` (ISC, ikony), `fflate` (MIT, rozpakowanie ZIP na serwerze).

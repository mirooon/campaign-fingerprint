# Interfejs: jak przeprowadzić analizę

Uruchomienie: `bun run pipeline --offline` (baza przykładowa), potem `bun run dev` i adres `http://localhost:3000`.
Własna baza: `VIEWER_DATA_DIR=<katalog z graph.json, campaigns.json, enriched.json> bun run dev`.

Zakładki u góry: Analizuj materiał (domyślna) · Kampanie · Graf powiązań · Porównaj · Celowo nie połączone · Jak to działa · Nowe domeny · Kogo rozpoznajemy · Jakość danych. Link „Tryb eksperta” obok nagłówka otwiera widok dla osób znających metodę (pełny graf, progi, panel „Nowa reklama”).

## Analiza materiału, krok po kroku

1. W zakładce „Analizuj materiał” upuść pliki, folder albo ZIP w ramkę, albo użyj „Wybierz folder” / „Wybierz pliki”. Możesz też wpisać **Link** albo **Tekst reklamy albo nazwę produktu** (osobno lub razem z plikami).
2. Zobacz podgląd wgrania. Tabela „Sprawa · Pliki · Uwagi” pokazuje, co narzędzie rozpoznało; przy każdej sprawie ikony rodzajów plików (tabela niżej) i uwagi, np. „HAR bez zapisanej strony”, „same zrzuty: adres odczytamy z paska przeglądarki”, „wideo ze strony (HLS): fragmenty skleimy w jedno nagranie”. Rodzaje, których analiza nie czyta samodzielnie, są zaznaczone na żółto. Odznacz sprawy, których nie chcesz analizować (sprawa bez plików do analizy jest wyłączona).
3. Sprawdź „Podział na sprawy”. Domyślny podział to podpowiedź (czasem z pytaniem w żółtej ramce). Zmienisz go: **jedna sprawa**, **każdy podfolder to sprawa**, **każdy plik to osobny materiał**. Pliki zapisanej strony (folder `*_files`, `resources/`, skrypty, style, obrazy, wideo ze strony) dołączają do swojej strony i nie są osobnymi sprawami.
4. Pole „Dociągnij publiczne dane o domenach (DNS, rejestr domen)” jest domyślnie włączone: pytamy publiczne rejestry o domeny z materiału, a stron oszustów nie otwieramy w przeglądarce. Wyłącz je, gdy pracujesz bez internetu.
5. „Analizuj (liczba spraw)”. Pod spodem pojawia się przebieg: licznik spraw i czas, stan każdej sprawy (czeka, w toku, gotowe, błąd) i zwinięty „Dziennik techniczny”. Adres z `?job=` wraca do tego samego zadania po odświeżeniu strony. „Nowa analiza” czyści widok.
6. Bez własnych plików możesz kliknąć „Wczytaj przykład”: wymyślona reklama, sprawdzana bez internetu.

| Ikona w podglądzie | Co z nią robimy |
|---|---|
| zrzut | tekst (OCR) i adres z paska przeglądarki |
| HAR | adresy, przekierowania, odpowiedzi serwerów |
| strona | budowa strony, formularz, skrypty; strony nie otwieramy |
| część strony | obrazy, skrypty, style, wideo i manifest zapisu: dołączane do strony |
| wideo, opis wideo | tekst z klatek i z paska; opis (np. z yt-dlp) daje tytuł, kanał, datę |
| wideo HLS | playlista `.m3u8` i segmenty `.ts` sklejamy w jedno nagranie i analizujemy jak wideo (klatki; mowa, twarze i głos tylko z wiersza poleceń, patrz niżej) |
| ZIP | rozpakowywany na serwerze |
| plik zbioru (CSV, JSON) | w interfejsie jeszcze nie analizowany; użyj `bun run analyze-material -- --dataset <plik>` |
| plik systemowy, nieobsługiwany | pomijane |

Limit wgrywania: 500 MB (`MATERIAL_MAX_MB`).

Co robi analiza uruchomiona z przeglądarki (`lib/viewer/materialRunner.ts`): OCR zrzutów i klatek, pasek adresu, odczyt stron i HAR, porównanie z bazą, a przy zaznaczonym polu z kroku 4 także DNS, RDAP i ASN. Transkrypcja (`--asr`), odcisk dźwięku (`--audio`), głos (`--speaker`), twarze (`--faces`), CLIP (`--clip`) i biblioteka reklam (`--ad-library`) są **poza przeglądarką**: włączasz je w `bun run analyze-material` albo przy budowie bazy. Wiersze „podobna twarz” i „głos podobny” w karcie wyniku pojawią się więc tylko dla wyniku z takiej analizy albo dla materiałów z bazy.

## Wynik

- **Lejek liczb**: Pliki · Materiały · Duplikaty · Powiązania z bazą · Znane kampanie · Nowe kampanie · Za mało danych. Kliknięcie liczby filtruje tabelę. Pod lejkiem pasek zdań („do znanych kampanii”, „nowe podobne”, „nowe”, „duplikaty”, „za mało danych”) działa tak samo.
- **Tabela materiałów**: miniatura zrzutu, werdykt, kampania, pewność, główna przesłanka, kompletność danych. Sortowanie „po werdykcie” albo „po pewności”, filtr „niepewne: do sprawdzenia”. Plusem na końcu wiersza rozwijasz **kartę wyniku** (przy jednym materiale jest od razu rozwinięta).
- **Nowe kampanie z tej paczki**: materiały bez dopasowania do bazy, które łączą się między sobą, z przyciskiem „Pobierz paczkę” (niżej).
- **Eksport**: przyciski CSV i JSON nad tabelą (kolumny jak w `bun run analyze-material --csv`).
- Znak „?” przy terminie otwiera objaśnienie ze słownika. Ten sam słownik, plus pięć etapów metody i skala siły przesłanek, jest w zakładce „Jak to działa”.

### Werdykt

| Werdykt | Znaczy |
|---|---|
| Znana kampania | materiał ma wspólne ślady z kampanią z bazy powyżej progu łączenia |
| Nowa kampania, podobna do… | ten sam szablon, narracja albo persona, ale różni operatorzy; „Osobno, bo” podaje powód |
| Nowa kampania | żadne powiązanie nie przekracza progu |
| Duplikat | ta sama reklama zebrana ponownie; podany jest oryginał i jego kampania |
| Za mało danych | materiał nie ma cech do porównania; lista „Co dorzucić” mówi, czego brakuje |

Pewność: **pewne** (przesłanka o wysokiej sile), **prawdopodobne** (siła powiązania co najmniej 0,5), **niepewne**. Wariant przypisany po samej kreacji nigdy nie jest „pewny”. Kampania „z treści, bez infrastruktury” ma słabszą podstawę niż wspólne konto lub serwer.

Siła przesłanki: Wysoka (łączy samodzielnie) · Średnia (liczy się razem z innymi) · Wymaga potwierdzenia (potrzebny drugi rodzaj śladu) · Pominięta (ślad wspólny dla wielu niezależnych stron) · Opis, nie dowód. Każdy poziom ma słowo, ikonę i styl, nie tylko kolor.

### Karta wyniku

Od góry: werdykt i jedno zdanie wyjaśnienia (przyciski „Pokaż kampanię”, „Porównaj z najbliższą”, „Dodaj do bazy”) · skala werdyktu z progami · „Dlaczego?” (przesłanki, domyślnie najmocniejsze) · „Dlaczego nie inna kampania?” (odrzucone kandydatki z powodem) · „Co rozpoznano” · **trasa kliknięcia** · **Cechy materiału** · „Sklep” (cechy sklepu tłumaczą, dlaczego wygląda podejrzanie, nie łączą kampanii) · „Kompletność danych”.

- **Cechy materiału** są pogrupowane w cztery rodziny z liczbą cech i liczbą wspólnych z bazą. Każdy wiersz ma nazwę, wartość, źródło i rolę cechy; cechy złożone (np. powiązania obiektów, trasa, konto platformy) są rozpisane czytelnie, nie jako surowy JSON. Adresy są rozbrojone. „Pokaż surowe dane” pokazuje pełne cechy materiału. W rodzinie strony stoją też techniki (w tym „chwyt sklepu”). Osobne ramki: ostrzeżenia o koncie platformy i „Notatki autora strony” (komentarze i teksty z kodu strony).
- **Trasa kliknięcia**: ogniwa reklama → link śledzący → przekierowania → strona docelowa, każde z rolą, statusem, wiekiem domeny względem emisji (RDAP) i ostrzeżeniem o cloakingu.
- **Co rozpoznano**: „podobna twarz do X (0,57)” i „głos podobny do X (0,70)” (gdy twarze i głos były włączone w wierszu poleceń): do sprawdzenia przez człowieka, nigdy „to jest X”. Także podrabiana marka, narracja, wiek domeny i certyfikatu.

## Co zrobić z wynikiem

- **Dodaj do bazy** (przy wyniku nowej lub znanej kampanii i nad tabelą partii): dopisuje materiał do bazy, żeby następna analiza go znalazła. Po dodaniu komunikat, co dodano, a czego nie i dlaczego (duplikat, za mało danych, identyfikator już w bazie), potem odświeżenie bazy. Baza przykładowa (`data/`) i wynik „Wczytaj przykład” są tylko do odczytu: przycisk jest wyłączony, a obok stoi powód. Żeby dopisywać, skopiuj bazę i uruchom z `VIEWER_DATA_DIR=<kopia>`. Poprzednie pliki bazy trafiają do `<baza>/historia/`.
- **Pobierz paczkę**: ZIP dowodów kampanii (`evidence.json`, lista dla CERT, szablon zgłoszenia DSA art. 16, manifest SHA-256). Wysłanie zgłoszenia to decyzja człowieka. Opis zawartości: [TECHNICAL.md](TECHNICAL.md).
- **Decyzja analityka** (karta kampanii, zakładka „Kampanie”): „do zgłoszenia”, „zgłoszone”, „odrzucone”, „do weryfikacji”, zapis w `decyzje.json` obok bazy. „Odrzucone” i „do weryfikacji” blokują paczkę dowodów (komunikat obok przycisku); brak decyzji nie blokuje. W kodzie nie ma przycisków do poprawiania werdyktu ani składu kampanii.

## Pozostałe widoki

- **Kampanie**: lista z filtrami (narracja, platforma stron, okres), karta kampanii z macierzą wspólnych śladów, ewolucją i osią czasu, trasą kliknięcia pierwszego materiału, „Nowymi domenami tej kampanii”, wydrukiem i paczką dowodów.
- **Graf powiązań**: widok zredukowany (kampanie i wspólne ślady; kliknięcie rozwija kampanię do materiałów albo ślad do innych kampanii). Pełny graf: przełącznik „pełny” albo Tryb eksperta.
- **Porównaj**: dwa materiały obok siebie, udział rodzin cech z procentami i wspólne fragmenty tekstu (co najmniej cztery słowa).
- **Celowo nie połączone**: pary, które wyglądają podobnie, ale metoda ich nie łączy, z powodem.
- **Nowe domeny**: kandydaci z feedu CT z czasem certyfikatu względem pierwszej reklamy.
- **Kogo rozpoznajemy**: osoby z galerii twarzy i głosów z liczbą wzorców i źródłem wpisu; bez wektorów.
- **Jakość danych**: ile materiałów bez zrzutu, strony, HAR, adresu, wideo.
- **Tryb eksperta**: panel „Nowa reklama” (ta sama analiza jednym żądaniem, `/api/analyze-material`, bez zadań i postępu), suwak progu łączenia z liczbą kampanii z klasteryzacji backendu (przybliżenie: graf trzyma najsilniejsze powiązania każdej reklamy). Stara trasa `/api/analyze` nie ma już ścieżki w GUI ([TECHNICAL.md](TECHNICAL.md) §8.1).

Etykieta „dane syntetyczne” stoi w nagłówku, gdy baza to próbka dołączona do repozytorium, i przy wyniku „Wczytaj przykład”.

## Zmienne środowiskowe

`VIEWER_DATA_DIR`, `MATERIAL_WORK_DIR` (pliki zadań, domyślnie katalog tymczasowy), `MATERIAL_MAX_MB` (limit wgrywania, domyślnie 500), `MATERIAL_TIMEOUT_MS`, `LINK_CONFIG`, `PERSONAS_FILE`, `BUN_BIN`.

## Zależności dodane dla GUI

`lucide-react` (ISC, ikony), `fflate` (MIT, rozpakowanie ZIP na serwerze). Pełna lista: [LICENCJE.md](../LICENCJE.md).

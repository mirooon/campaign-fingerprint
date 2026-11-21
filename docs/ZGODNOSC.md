# Zgodność z przepisami: zasady i klasyfikacja funkcji

Dokument opisuje, jak narzędzie podchodzi do AI Act, RODO i DSA oraz do kontaktu z organami. To zasady projektowe i orientacyjna klasyfikacja, **nie porada prawna**: instytucja, która wdroży narzędzie, powinna potwierdzić podstawę prawną z własnym inspektorem ochrony danych lub prawnikiem. Stan implementacji: **istnieje zamknięta lista 8 osób publicznych do porównania twarzy** (`--faces`, opcjonalnie); **galeria głosów jeszcze nie istnieje**. Zasady poniżej obowiązują obie od pierwszej wersji; stan galerii głosów dopisze zadanie, które ją wprowadzi.

## 1. Klasyfikacja funkcji według AI Act (rozporządzenie (UE) 2024/1689)

| Funkcja | Stan | Klasyfikacja | Uzasadnienie |
|---|---|---|---|
| Persona (osoba, pod którą podszywa się reklama) rozpoznana **z tekstu** (OCR, ASR, treść) i z danych wejściowych | jest | **nie jest biometrią** | dopasowanie nazwiska do listy po tekście, bez cech twarzy ani głosu; nie podlega regułom dla systemów biometrycznych |
| Wektor głosu mówcy (`--speaker`), użyty do łączenia materiałów | jest, opcjonalna, lokalnie | dane biometryczne w rozumieniu RODO, gdy służą do identyfikacji osoby; w narzędziu porównują tylko materiały między sobą i nie wskazują tożsamości | wektory zostają w lokalnym `enriched.json` i w lokalnej pamięci podręcznej; nie trafiają do grafu, paczki dowodów ani eksportu ([METODYKA.md](METODYKA.md#9-walidacja-i-ograniczenia)) |
| Zamknięta lista twarzy osób publicznych (`data/osoby-publiczne.json`, 8 osób, 30 zdjęć), porównanie 1:N | **jest, opcjonalna (`--faces`), lokalnie** | prawdopodobnie system zdalnej identyfikacji biometrycznej o wysokim ryzyku (załącznik III pkt 1 lit. a), choć wynik to „podobna twarz do X” do przeglądu człowieka, nie identyfikacja; ocena należy do administratora | środki łagodzące: lista zamknięta i krótka, każda osoba ze źródłem ostrzeżenia, zdjęcia tylko z wolnych licencji ze źródłem ([data/faces/ZRODLA.md](../data/faces/ZRODLA.md)), wektory niedopasowanych twarzy nie są zapisywane, wektory dopasowanych nie trafiają do grafu ani eksportu, wynik zawsze do przeglądu człowieka, persona z twarzy tylko jako cecha grupy kampanii |
| Galeria głosów osób publicznych, porównanie 1:N | **nie istnieje** | jeśli powstanie: **system zdalnej identyfikacji biometrycznej**, kategoria wysokiego ryzyka (załącznik III pkt 1 lit. a) | porównanie jednego wzorca z wieloma zapisanymi; wymaga m.in. zarządzania ryzykiem, jakości danych, dokumentacji, nadzoru człowieka |
| Weryfikacja 1:1 na wniosek osoby („czy to mój wizerunek?”) | **jest, opcjonalna** (`--faces --verify-person <id>`) | porównanie tylko ze zdjęciami wskazanej osoby z listy; systemy weryfikacji biometrycznej, których jedynym celem jest potwierdzenie, że dana osoba jest tą, za którą się podaje, są wyłączone z pkt 1 lit. a załącznika III | działa tylko dla osób z `data/osoby-publiczne.json`; osoba spoza listy wymaga dodania jej zdjęć z jej zgodą |
| Wykrywanie deepfake'a, wynik modelu | nie ma (wynik z danych wejściowych jest tylko opisany jako „wynik modelu”) | obowiązki przejrzystości (art. 50), gdy narzędzie zacznie generować lub oznaczać treści | metoda nie wydaje takich ocen ([METODYKA.md](METODYKA.md#10-czego-nie-robimy-i-dlaczego)) |

Praktyki zakazane (art. 5), których narzędzie nie robi i nie będzie robić: **nieukierunkowane pobieranie (scraping) wizerunków z internetu** do budowy baz rozpoznawania twarzy (art. 5 ust. 1 lit. e).

## 2. RODO

- **Podstawa dla galerii (art. 9 ust. 2).** Dane biometryczne przetwarzane w celu jednoznacznej identyfikacji osoby to szczególna kategoria danych (art. 9 ust. 1). Zakaz przetwarzania uchylają przesłanki z art. 9 ust. 2. Dla galerii osób publicznych kandydatami są: lit. g (ważny interes publiczny na podstawie prawa UE lub państwa członkowskiego, z odpowiednimi zabezpieczeniami) albo lit. a (wyraźna zgoda osoby, której wzorzec trafia do galerii). **Wybór podstawy należy do administratora** i musi mieć oparcie w konkretnym przepisie lub zgodzie; narzędzie nie przesądza go.
- **Zakaz scrapingu wizerunków.** Do galerii trafiają tylko wizerunki podane przez instytucję z udokumentowanym źródłem, autorem i licencją (tabela w [LICENCJE.md](../LICENCJE.md#7-oświadczenie-o-braku-wad-prawnych)). Narzędzie nie pobiera zdjęć ani nagrań osób z sieci na własną rękę.
- **Retencja.** Dane robocze (`.cache/`, `data/work/`, `dane/praca`) są lokalne. Odpowiedzi sieciowe mają w pamięci podręcznej TTL od 1 do 28 dni, wektory głosu 28 dni. Instytucja ustala okres przechowywania materiałów, wzorców i wyników i usuwa je po jego upływie (polecenia usuwania: [README.md](../README.md#7-bezpieczeństwo-i-dane)).
- **DPIA (art. 35) jako zalecenie.** Przed użyciem galerii twarzy lub głosów, a także przy przetwarzaniu na dużą skalę danych osobowych w materiałach, zalecana jest ocena skutków dla ochrony danych.
- **Minimalizacja.** Przetwarzanie lokalne; zapytania wychodzące tylko na żądanie ([README.md](../README.md#7-bezpieczeństwo-i-dane)).

## 3. DSA (rozporządzenie (UE) 2022/2065)

- **Art. 16 (mechanizm zgłaszania i działania).** Paczka dowodów zawiera szablon zgłoszenia (`dsa-art16-notice.md`): uzasadnienie, dokładne adresy, dane zgłaszającego, oświadczenie o dobrej wierze. Wysłanie zgłoszenia platformie jest decyzją człowieka.
- **Art. 39 (dodatkowa przejrzystość reklam internetowych).** Bardzo duże platformy muszą prowadzić publiczne repozytorium reklam; to jedno ze źródeł (biblioteka reklam Mety, opcja `--ad-library`). Dostęp do tych danych podlega regulaminowi serwisu; narzędzie nie obchodzi ograniczeń.
- **Zaufany podmiot sygnalizujący (art. 22).** Status przyznaje koordynator ds. usług cyfrowych, w Polsce Prezes UKE. Instytucja, która chce, by jej zgłoszenia miały pierwszeństwo, składa wniosek o ten status; narzędzie nie nadaje go.

## 4. Kontakt z organami

- **KNF:** zawiadomienie ma sens tylko przy podejrzeniu przestępstw z ustaw rynku finansowego (np. oferowanie usług finansowych bez zezwolenia). Inne oszustwa reklamowe: policja i prokuratura, CERT Polska (Lista Ostrzeżeń: cecha domeny, nie dowód o reklamie).
- **Nakazy i decyzje** wydają organy, nie narzędzie. Narzędzie proponuje powiązania i dowody; o zgłoszeniu decyduje człowiek ([README.md](../README.md#8-czego-narzędzie-nie-robi)).

## 5. Co dopiszą zadania wprowadzające galerię

Gdy powstanie galeria twarzy lub głosów, odpowiednie zadanie uzupełnia ten dokument o: stan funkcji, wybraną podstawę z art. 9 ust. 2, okres retencji, wynik oceny skutków, listę źródeł wizerunków z licencjami i wynik kontroli składników o licencjach niekomercyjnych ([LICENCJE.md](../LICENCJE.md#5-kontrola-składników-o-licencjach-niekomercyjnych-nc)).

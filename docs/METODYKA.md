# Metodyka: jak narzędzie łączy materiały w kampanie

Dokument dla osoby, która ocenia wynik, a nie pisze kod. Mówi, co narzędzie bierze z materiału, jak liczy podobieństwo, kiedy uznaje dwa materiały za jedną kampanię i czego nie potrafi. Szczegóły techniczne (pola plików, funkcje, parametry): [TECHNICAL.md](TECHNICAL.md). Uruchomienie: [../README.md](../README.md). Licencje składników: [../LICENCJE.md](../LICENCJE.md).

Wszystkie przykłady są wymyślone (domeny `.example`, fikcyjne osoby).

## 1. Wejście i formaty

Jednostką jest **materiał**: jedna reklama razem z tym, co o niej zebrano. Narzędzie przyjmuje:

| Wejście | Co z niego wynika |
|---|---|
| zapisana strona (HTML z folderem `<nazwa>_files`) | treść, formularze, skrypty, komentarze w kodzie, struktura strony |
| plik HAR | surowa odpowiedź serwera, lista żądań, adresy IP, nagłówki, łańcuch przekierowań |
| MHTML | jak zapisana strona, w jednym pliku |
| zrzut ekranu | kreacja (obraz), tekst z OCR, domena z paska adresu przeglądarki |
| nagranie z metadanymi (wideo, `.info.json`) | klatki, transkrypcja, odcisk dźwięku, reklamodawca i identyfikator biblioteki reklam |
| link albo sam tekst | adres do pasywnego sprawdzenia (tylko z `--live`) albo treść do porównania |
| CSV/JSON zbioru (`--dataset`) | każdy wiersz to materiał; kolumny mapowane po nazwach PL/EN albo plikiem mapowania |
| partia katalogów (`--cases`) | każdy podkatalog to sprawa, wszystkie idą przez jeden graf |
| zip | rozpakowywany na serwerze (z zabezpieczeniami przed ścieżkami spoza katalogu i bombami) |

Wystarczy dowolny podzbiór. Im mniej danych, tym mniej cech i niższa pewność (punkt 7).

## 2. Cechy w pięciu rodzinach

Cecha to ślad, który może się powtórzyć w innym materiale. Narzędzie nie ocenia, czy reklama jest fałszywa. Pyta tylko, czy dwa materiały mają wspólne ślady i jak rzadkie są te ślady.

| Rodzina | Przykłady cech | Przykład (syntetyczny) |
|---|---|---|
| **Tekst i osoby** | podobny tekst (TF-IDF, opcjonalnie embeddingi), persona rozpoznana w tekście albo z twarzy (zamknięta lista osób publicznych, patrz „Twarze” w punkcie 9), kontakty, portfele | dwie reklamy obiecują „zarobek po 5 minutach” słowami z jednego szablonu; w obu pojawia się fikcyjna „Ewa Przykładowa” |
| **Wygląd** | hash obrazu (dHash), ten sam plik kreacji (SHA-256), podobieństwo CLIP (opcjonalnie, także 8 klatek wideo), odcisk dźwięku (Chromaprint), głos mówcy (opcjonalnie) | dwa zrzuty różnią się naklejką: odległość dHash 3 z 64 bitów |
| **Strona** | backend formularza, ukryte pola, własne pliki JS/CSS, komentarze w kodzie, struktura DOM, techniki (fałszywy sklep z aplikacjami, blokada przycisku „wstecz”, fałszywe komentarze) | oba formularze wysyłają dane na `https://zbieracz.example/lead/ab12` |
| **Infrastruktura** | domena, host, IP, ASN, serwery NS, rejestrator i seria rejestracji (RDAP), certyfikat (CT), cel CNAME, tracker | dwie domeny `a-oferta.example` i `b-oferta.example` zarejestrowane w odstępie 20 minut u tego samego rejestratora |
| **Platforma i identyfikatory** | konto i kampania platformy stron, serwer trackera (maszyna w identyfikatorze kliknięcia), identyfikator reklamy w `fbclid`, identyfikator biblioteki reklam, płatnik z biblioteki reklam, parametry kampanii (UTM, sub1–5), szablon linku | dwa linki mają ten sam trzybajtowy identyfikator maszyny w `xid` |

**Które cechy działają dziś** (B-104): wszystkie wymienione, o ile materiał je zawiera. Cechy opcjonalne wymagają włączenia i narzędzi: OCR (`--ocr`, tesseract), transkrypcja (`--asr`), odcisk dźwięku (`--audio`), CLIP (`--clip`, wymaga modelu), głos (`--speaker`), twarze (`--faces`, OpenCV, wymaga venv z `scripts/py/setup-face.sh` i modeli ok. 40 MB), biblioteka reklam (`--ad-library`), zapytania sieciowe DNS/RDAP/ASN (`--lookups` albo `--live`). Brakujący krok jest oznaczony w wyniku jako `skipped` z powodem. Domyślny obraz Dockera ma modele twarzy (YuNet, SFace), ale nie ma modeli ASR, CLIP ani głosu, i nie wychodzi do sieci, więc te cechy są wtedy puste. Galeria głosów nie jest jeszcze zaimplementowana i nie występuje w tym dokumencie jako metoda.

## 3. Wagi

Każdy ślad (encja, np. konkretny tracker) dostaje wagę. Waga to iloczyn trzech rzeczy:

1. **Waga typu cechy** (tabela niżej): jak mocno ten rodzaj śladu wskazuje na jednego operatora.
2. **Zniżka za infrastrukturę wspólną i cechy platform** (czynnik 0–1 z list w konfiguracji): Cloudflare i inne CDN, masowi dostawcy DNS, darmowe urzędy certyfikacji, popularni rejestratorzy, skracacze, platformy stron, publiczne serwisy formularzy. Wspólne IP Cloudflare dzielą tysiące niezwiązanych stron, więc waży ok. 0,006 zamiast 0,6. **Cechy platformy, nie operatora** (identyfikator maszyny, plik `events-stat.js`, format linku `/click?key=`, biblioteki landerów) są mnożone przez 0,1, bo używa ich każdy klient danej usługi.
3. **Rzadkość (`df`, odwrotna częstość)**: im więcej materiałów w zbiorze ma ten sam ślad, tym mniej wart (do 0,2 wagi, a powszechny w prawie całym zbiorze nawet do 0,1).

Przesłanki jednej pary materiałów łączy się **noisy-OR**: `wynik = 1 − Π(1 − wᵢ)`. Dwie niezależne przesłanki po 0,5 dają 0,75. Wynik rośnie z każdą kolejną przesłanką, ale nigdy nie przekracza 1. Przesłanka o wadze ≥ 0,7, której ślad występuje w mniej niż połowie zbioru, jest **silna** (patrz punkt 4).

### Wagi typów (stan po zadaniu I14; źródło prawdy: `typeWeights` w `lib/graph/config.ts`)

| Typ | Waga | Typ | Waga |
|---|---|---|---|
| url, tracker, wallet | 1,0 | cname_target, imagehash | 0,65 |
| host, domain, endpoint (backend), meta_ad, platform_campaign | 0,95 | advertiser, ip, hidden_fields, comment, domain_pattern, click_server | 0,6 |
| email, phone, telegram, platform_account | 0,9 | asset | 0,55 |
| path_id | 0,85 | favicon | 0,5 |
| cert, campaign_param | 0,8 | comment_block | 0,45 |
| ad_payer | 0,7 | nameserver, page_template | 0,35 |
| | | technique | 0,2 |
| | | param_schema | 0,12 |
| | | persona | 0,1 |
| | | registrar, asn | 0,05 |

Wagi podobieństwa (obraz 0,6, obraz CLIP 0,45, tekst 0,5, struktura strony 0,45, dźwięk 0,5, głos 0,4) i ich progi też są w `config.ts`. Tabela jest przepisana ręcznie; przy rozbieżności wygrywa `config.ts`.

## 4. Kampania a grupa podobnych kampanii

Wynik ma dwa poziomy:

- **Kampania**: materiały, za którymi najpewniej stoi ten sam operator. Wymaga mocnych dowodów.
- **Grupa podobnych kampanii**: kampanie, które łączy coś słabszego (ten sam szablon strony, ta sama platforma, ta sama persona), ale nie na tyle, by uznać je za jednego operatora. Szablony i zestawy stron są kupowane i używane przez wielu operatorów, więc wspólny szablon to wskazówka, a nie dowód.

**Reguły kampanii** (`campaignLinkVerdict`, `lib/graph/cluster.ts`):

1. **Silny dowód** (np. ten sam tracker, ten sam adres kontaktowy, ten sam backend formularza z identyfikatorem klienta) łączy sam. Łączenie silnych dowodów robi union-find (jeśli A=B i B=C, to A=B=C).
2. Wynik pary poniżej `minLinkScore` (0,15) nie liczy się.
3. **Konflikt kont**: dwie reklamy na tej samej platformie stron, ale na różnych kontach, nie łączą się bez silnego dowodu. Ten rodzaj konfliktu wygrywa z treścią, z plikiem kreacji, a nawet z silnym dowodem opartym wyłącznie na identyfikatorze `path_id` (bywa on biblioteką landerów wspólną dla wielu kont).
4. **Ślady zestawu stron** (szablon, motyw, komentarze w kodzie, favicon, podobna struktura strony, format linku) liczą się razem jako jeden rodzaj i nie łączą kampanii same. Kampania potrzebuje co najmniej jednego rodzaju dowodu spoza zestawu stron, persony i treści (konto platformy, serwer trackera, NS, kontakt…). Z dowodem operatora wystarczą dwa różne rodzaje dowodów.
5. **Treść** (podobny tekst, obraz, dźwięk, głos): treść bez infrastruktury tworzy kampanię tylko z **co najmniej dwoma różnymi rodzajami treści** (np. obraz i tekst). Pole `basis` kampanii mówi, na czym stoi: `infrastructure`, `content` albo `mixed`. Gdy któryś materiał ma infrastrukturę, sama treść nie łączy.
6. **Wariant kreacji: dołączanie, nigdy scalanie.** Zrzut z naklejką, bez adresu, nie ma infrastruktury, więc nie wolno mu zaprzeczyć przypisaniu ani zbudować mostu między dwiema kampaniami. Po zbudowaniu kampanii taki materiał dołącza do kampanii z infrastrukturą, jeśli jego kreacja jest prawie identyczna (dHash ≤ 6 bitów albo CLIP ≥ 0,95) z kreacjami **dokładnie jednej** takiej kampanii. Przy dwóch lub więcej kandydatach nic nie dołącza i zostaje grupa podobnych. Wynik ma `basis: "mixed"` i niższą pewność.
7. **Persona działa tylko na poziomie grupy.** Ta sama osoba publiczna występuje w reklamach wielu niezwiązanych operatorów, więc nie łączy kampanii i nie liczy się do ich wyniku.

**Dlaczego jawne reguły, a nie HDBSCAN lub inne grupowanie bez nadzoru.** Każda krawędź musi dać się wyjaśnić osobie, która zdecyduje o zgłoszeniu: „te dwa materiały łączy tracker X (rzadki, waga 0,95) i serwer Y”. Metoda zbiorcza daje odległość w przestrzeni cech i parametr, którego nie da się obronić przed odbiorcą. Dlatego: reguły → union-find dla silnych dowodów; **Louvain** (grupowanie wspólnot na grafie ważonym) dla reszty; wszystko z jawną listą przesłanek.

## 5. Duplikaty i „za mało danych”

**Dokładny duplikat** to ta sama reklama zebrana drugi raz. Rozpoznajemy go **tylko** po: tym samym obrazie (dHash ≤ 4 bity i zgodna próba pikselowa), tym samym identyfikatorze reklamy albo tym samym adresie strony z identycznym szablonem. Ten sam tekst nie wystarcza. Duplikat dostaje kampanię oryginału.

**„Za mało danych”** (`insufficient`, w CSV pole `missing_data`) pojawia się, gdy materiał nie ma adresu, identyfikatora, co najmniej 5 słów treści ani powiązania ponad progiem. Wynik wymienia, co dorzucić (np. „zrzut z widocznym paskiem adresu”). Lepiej odmówić oceny, niż zgadywać.

## 6. Przypisanie nowego materiału i progi

Nowy materiał trafia do jednego grafu ze znanymi i dostaje jeden z werdyktów: `known_campaign`, `similar_campaigns` (nowa kampania podobna do znanych), `new_campaign`, `duplicate`, `insufficient`.

Progi (wszystkie w `config.ts`, domyślny profil to `DEFAULT_LINK_CONFIG`; plik `--config` tylko dopisuje listy i nadpisuje pola):

| Próg | Wartość | Uzasadnienie |
|---|---|---|
| `minLinkScore` | 0,15 | poniżej tego wynik pary to szum; sama persona (0,1) go nie przekracza |
| `strongThreshold` | 0,7 | dowód silny; poniżej 0,65 zaczęłyby scalać kampanie IP i reklamodawca |
| `familyMinScore` | 0,3 | grupa podobnych wymaga mocniejszego powiązania niż pojedynczy ślad |
| obraz, `imageHamming` | 10 bitów z 64 | duplikat ≤ 4, wariant ≤ 6, różne kreacje na próbce ≥ 16 |
| tekst, `tfidfThreshold` | 0,5 | przeredagowanie tych samych słów; pełne parafrazy wymagają embeddingów (0,86) |
| struktura strony, `dom.hamming` | 6 bitów | |
| obraz CLIP | cosinus ≥ 0,9; ten sam plik wideo ≥ 0,97 z tym samym dźwiękiem | próg nieskalibrowany na danych |
| twarz (persona, `--faces`) | ważony cosinus ≥ próg z pomiaru (docs/TECHNICAL.md), tylko cecha grupy | próg z pomiaru na zdjęciach osób spoza listy |
| głos (łączenie materiałów, `similar_voice`) | cosinus ≥ 0,6 | ten sam mówca 0,86–0,93, różni ≤ 0,34 na nagraniach testowych |
| głos (persona z galerii, `--speaker`) | cosinus okna ≥ 0,5, przewaga ≥ 0,15 nad drugą osobą, co najmniej 2 sąsiednie okna, tylko cecha grupy | próg z pomiaru na nagraniach 11 osób spoza listy (docs/TECHNICAL.md, „Persona z głosu”) |

Dawna „furtka” `singleKindMinScore` (0,5, pojedynczy rodzaj dowodu o dużym wyniku tworzył kampanię) została usunięta w I14c: pozwalała dwóm klonom portalu stać się jedną kampanią.

**`confidence` i `score` to siła przesłanek, nie prawdopodobieństwo.** `score` to wynik noisy-OR ze wzoru wyżej. `confidence` (`certain`, `likely`, `uncertain`) mówi: `certain`, gdy najlepsze powiązanie ma przesłankę silną (waga ≥ 0,7), `likely`, gdy wynik powiązania ≥ 0,5. Żaden z nich nie był skalibrowany na zbiorze z prawdziwymi etykietami, więc „0,8” nie znaczy „80% szans, że to ta sama kampania”.

## 7. Niekompletne dane

- **Martwa strona**: gdy jest tylko zrzut z paskiem adresu, domena z paska staje się adresem; cechy pochodzą z nagranych odpowiedzi DNS/RDAP (lub z zapytań, jeśli włączono `--lookups`).
- **Sam zrzut** bez adresu: zostają obraz, tekst z OCR i identyfikator biblioteki reklam, jeśli jest widoczny. Przypisanie opiera się wtedy na kreacji, więc werdykt to zwykle wariant (niższa pewność) albo „za mało danych”.
- **Brak RDAP**: znika seria rejestracji i data utworzenia domeny; reszta cech działa.
- **Kroki pominięte** (brak narzędzia, modelu, sieci, pliku) mają w wyniku status `skipped` i powód (`steps` w JSON, `base.json` w bazie). Nigdy nie są pomijane po cichu.

## 8. Cloaking

Metodą jest wyłącznie **wykrywanie pasywne po sygnaturach w zebranych danych**: analiza zapisanych stron i HAR pod kątem sygnatur skryptów cloakera w kodzie strony (cecha `cloakerInSource`) oraz tego samego adresu zapisanego z różną treścią (osobne zapisy `#capture`). Nie wysyłamy żadnych dodatkowych żądań.

Opcja `--cloaking` (dwa dodatkowe pobrania z różnymi User-Agentami: crawler platformy i przeglądarka mobilna) istnieje, ale jest **domyślnie wyłączona** i nie jest metodą. Test po User-Agencie nie dowodzi braku cloakingu po IP i geolokalizacji: różnica treści coś wskazuje, jej brak nic nie wyklucza.

## 9. Walidacja i ograniczenia

**Progi, reguła faviconu i lista person zostały dobrane na tych samych 25 sprawach próbki referencyjnej.** Wynik na tej próbce (po I14: precyzja i F1 par = 1,0, 14 kampanii, 2 grupy podobnych) pokazuje, że metoda jest spójna z naszym rozumieniem tych spraw, a nie że sprawdzi się na nowych. **Etykiety (które materiały należą do jednej kampanii) są nasze**: nie istnieją polskie zbiory z etykietami kampanii, z którymi dałoby się je porównać. Na danych syntetycznych wynik jest z założenia bliski 1,0: zbiór zaprojektowaliśmy sami.

### Walidacja na materiałach spoza próbki

Wynik dopisze zadanie walidacji.

### Ograniczenia znalezione w trakcie pracy

- **Tekst lub szablon strony sam nie łączy.** Szablony tekstów i stron krążą między operatorami.
- **Płatnik reklamy bywa ofiarą**: konto użyte bez wiedzy właściciela łączy niezwiązane kampanie (dlatego `ad_payer` ma 0,7 i jest tłumiony częstością).
- **Artefakty HAR analityka**: HAR zapisany z otwartymi DevTools albo „sanitized” zawiera lub pomija dane, których nie miał serwer; wspólny nagłówek analityka może wyglądać jak ślad operatora.
- **Strefa czasowa `first_seen`**: dane z różnych źródeł mogą podawać czas w różnych strefach (obraz Dockera ustawia `Europe/Warsaw`); przy zbiorze mieszanym kolejność materiałów i okna czasowe (np. seria rejestracji) mogą się przesunąć o godziny.
- **PID w identyfikatorze kliknięcia** to stała platformy, a nie operatora; liczy się maszyna (3 bajty), nie proces.
- **Nieoficjalny endpoint biblioteki reklam Mety** (przez MetaAdsCollector) może przestać działać po zmianie strony i jego użycie może naruszać regulamin serwisu.
- **Zależność od RDAP**: przy odpowiedzi tylko dla części domen seria rejestracji znika i część kampanii traci jeden z dowodów.
- **Seria rejestracji** to łańcuch: domeny zarejestrowane u tego samego rejestratora w odstępach ≤ 48 h łączą się przechodnio, więc długi łańcuch może objąć domeny odległe w czasie.
- **Twarze (`--faces`)**: zamknięta lista osób publicznych (`data/osoby-publiczne.json`; 127 osób na liście, z czego 31 ze zdjęciami (103 zdjęcia, po 1–5 na osobę, z Wikimedia Commons w `data/faces`); pozostałe są tylko personą z tekstu (pełne imię i nazwisko z odmianą, nigdy samo nazwisko). Dobór: osoby najczęściej podrabiane w polskich fałszywych reklamach według publicznych źródeł (zestawienie NASK z 12.07.2024 i artykuły fact-checkerów, CERT, prasy), tylko osoby ze źródłem, które wprost mówi o podszyciu się pod nią (jedyny wyjątek: wpis dodany decyzją właściciela, z adnotacją w polu `source`); lista jest zamknięta, każdy wpis ma `category` (grupa z zestawienia NASK, cecha grupy, nie dowód kampanii), wektory w `data/faces/index.json`). Wynik to „podobna twarz do X (0,xx)”, nigdy „to jest X”, i trafia do przeglądu człowieka. Dopasowanie tylko do osób z listy: twarz, która nikogo nie przypomina, zostaje ramką bez persony, a jej wektora nie zapisujemy (ani w `enriched.json`, ani w pamięci podręcznej, ani w paczce dowodów); wektory dopasowanych twarzy też nie trafiają do grafu ani eksportu (w wyniku jest ramka, identyfikator persony i podobieństwo). Persona z twarzy jest **cechą grupy podobnych kampanii** (ta sama osoba jako przynęta w wielu kampaniach różnych operatorów), nigdy dowodem, że dwa materiały są jedną kampanią. Waga dopasowania maleje z rozmiarem twarzy i wynikiem detektora (jakość twarzy, jak w MagFace). Próg 0,46 wybrano z pomiaru na zdjęciach 26 innych osób publicznych (0 fałszywych trafień na 54 twarzach, 96,7% trafień na parach tej samej osoby; zalecany dla SFace 0,363 dawał 9,3% fałszywych trafień): docs/TECHNICAL.md, „Persona z twarzy”. Nie budujemy bazy twarzy z sieci: zdjęcia referencyjne są wybrane ręcznie, ze źródłem, autorem i licencją ([data/faces/ZRODLA.md](../data/faces/ZRODLA.md)), a własne osoby dodaje instytucja (README, „Twarze”).
- **Głos osoby z listy (`--speaker`)**: galeria zamknięta, ta sama lista osób publicznych co dla twarzy (10 osób, `data/voices/index.json`: tylko wektory, po 5–8 polskich nagrań na osobę; źródła w [data/voices/ZRODLA.md](../data/voices/ZRODLA.md), nagrań nie ma w repozytorium ani w obrazie). Ścieżka jest cięta na okna po 4 s (krok 2 s); okna ciche i z samą muzyką (detekcja mowy SpeechBrain VAD) są odrzucane. Okno wskazuje osobę, gdy kosinus do jej wzorca (średnia z nagrań) jest ≥ 0,5 **i** wyprzedza drugą osobę o ≥ 0,15, a persona liczy się dopiero z co najmniej 2 sąsiednich okien (6 s). Wynik to „głos podobny do X (0,57)”, nigdy „to jest głos X”, do przeglądu człowieka. Jak twarz, persona z głosu jest **cechą grupy podobnych kampanii** (ta sama osoba jako przynęta u różnych operatorów), nigdy dowodem jednej kampanii. Pomiar (docs/TECHNICAL.md, „Persona z głosu”): ta sama osoba rozpoznana w 70 z 70 nagrań (leave-one-out), fałszywe trafienie na obcych 1 z 25 nagrań (4,0%; to jedno prawdopodobnie jest głosem Stanowskiego, więc 0/24 bez niego; cel ≤ 3,5% nie jest potwierdzony statystycznie przy 25 nagraniach), 5 z 5 fałszywek z publicznej kompilacji NASK nazwanych właściwą osobą. Model nie był trenowany na polskiej mowie, a reklamy mają inną akustykę niż wystąpienia z galerii, więc na reklamach trafień będzie mniej. **Detektor klonu głosu i ocena „czy to prawdziwy głos” są poza zakresem.**
- **Dane biometryczne głosu**: wektory głosu (SpeechBrain, 192 liczby) liczone tylko z `--speaker`, zapisywane wyłącznie w lokalnym `enriched.json` i w lokalnej pamięci podręcznej (TTL 28 dni, `.cache/speaker`); wektory okien używane do galerii nie są zapisywane nigdzie (w wyniku jest przedział, identyfikator persony i podobieństwo). Nie trafiają do `graph.json`, paczki dowodów ani eksportu CSV/JSON. Usunięcie: skasować `.cache/speaker` i pliki `enriched.json`.
- **Skala**: porównania są liczone parami, O(n²); przy dziesiątkach tysięcy materiałów potrzebny byłby indeks.
- **Strony renderowane w JavaScripcie**: nie wykonujemy JS, więc część treści i adresów jest niewidoczna.

## 10. Czego nie robimy i dlaczego

- **Nie oceniamy pojedynczej reklamy** (ani „ryzyka” reklamy). Lista Ostrzeżeń CERT to cecha domeny, nie dowód o reklamie; wskaźnik ryzyka bez etykiet byłby zgadywaniem.
- **Nie wykrywamy klonów głosu.** Wymagałoby to modeli typu XLS-R/wav2vec2 i dostrojenia. Błąd równych wskaźników (EER) detektorów audio na prawdziwych reklamach to 25–60%, więc wynik takiego detektora byłby wskazówką, a nie dowodem. Głos mówcy służy do łączenia materiałów (ten sam głos w dwóch reklamach), nie do orzekania o fałszerstwie.
- **Nie wykrywamy tekstu pisanego przez LLM.**
- **CLIP z klatek wideo** to u nas tylko cecha wyglądu (podobieństwo kreacji), nie ocena „deepfake”.
- **Nie rozpoznajemy twarzy spoza listy i nie oceniamy, czy twarz jest prawdziwa.** Rozpoznanie dotyczy osób publicznych z ostrzeżeń (31 dla twarzy, 10 dla głosu); nie jest identyfikacją („podobna twarz do X” to wskazówka do przeglądu), a wykrywanie deepfake’ów twarzy jest poza zakresem.
- **Czego nie używamy:** bazy odcisków technologii *webappanalyzer* (licencja GPL-3.0; atrybut platformy powstaje z własnych wzorców) oraz *httpx* (aktywne sondowanie hostów łamie zasadę pasywności).
- Nie logujemy się na cudze konta, nie obchodzimy zabezpieczeń, nie renderujemy stron, nie wydajemy nakazów. Decyzję o zgłoszeniu podejmuje człowiek.

## 11. Pochodzenie danych (skrót)

Próbka dostarczona przez właściciela danych nie trafia do repozytorium; w repozytorium są tylko dane syntetyczne. Dane z publicznych źródeł (skany urlscan, logi CT, RDAP i DNS, Lista Ostrzeżeń CERT, biblioteki reklam) zbierane w trybie live lądują w `.cache/` i `data/work/` poza repozytorium, a materiały zebrane z sieci mają w `zrodlo.json` adres źródła i datę dostępu. Pełna tabela: [README.md](../README.md#pochodzenie-danych).

## 12. Słownik pojęć

| Pojęcie | Znaczenie |
|---|---|
| **materiał** | jedna zebrana reklama wraz ze stroną, zrzutem, nagraniem lub linkiem |
| **kampania** | materiały, za którymi stoi prawdopodobnie jeden operator; połączone mocnymi dowodami |
| **grupa podobnych kampanii** | kampanie podobne (szablon, platforma, persona), ale bez dowodu jednego operatora |
| **wariant** | ta sama kreacja po drobnej zmianie (naklejka, kadr); dołącza do kampanii, nigdy jej nie scala |
| **dokładny duplikat** | ta sama reklama zebrana ponownie (ten sam obraz, identyfikator albo adres) |
| **wabik** | osoba publiczna, której wizerunek lub nazwisko użyto w reklamie (persona) |
| **grupa szablonu** | strony z tego samego zestawu (szablon, motyw, klon portalu), często u różnych operatorów |
| **przesłanka** | pojedynczy powód połączenia dwóch materiałów (np. wspólny tracker) z wagą |
| **siła** | waga przesłanki lub wynik powiązania (0–1); to nie prawdopodobieństwo |

Punkt odniesienia dla podobieństwa tekstu (kopiowanie z modyfikacjami): narzędzie D3lta (VIGINUM, francuska służba ochrony przed zagranicznymi manipulacjami informacją). Nasze podobieństwo tekstu (TF-IDF, opcjonalnie embeddingi) jest prostsze.

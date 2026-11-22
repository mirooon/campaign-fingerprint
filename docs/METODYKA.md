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

**Biblioteki reklam jako źródło.** Publiczne biblioteki reklam (Meta Ad Library, Google Ads Transparency Center; adaptery TikTok i X zob. [ZRODLA-METADANYCH.md](ZRODLA-METADANYCH.md)) dają identyfikator reklamy, reklamodawcę, płatnika, daty emisji i kreacje; `bun run adlib` zamienia rekord biblioteki na materiał, który idzie tą samą drogą co zrzut ze zgłoszenia. Identyfikator reklamy w bibliotece (z platformą w kluczu) jest dowodem silnym jak identyfikator reklamy w linku: ten sam identyfikator to ta sama reklama, czyli duplikat, a identyfikatory różnych bibliotek nigdy się nie mieszają. Reklamodawca jest śladem średnim, a nie silnym, bo konta reklamowe bywają wynajmowane i przejmowane: łączymy po stałym identyfikatorze konta (u Google `AR…`), nie po nazwie wyświetlanej, która się zmienia, a nazwa prawna, kraj i status weryfikacji są atrybutami konta, nie dowodem. Płatnik też nie łączy kampanii sam, bo bywa ofiarą kradzieży tożsamości (jak w tabeli wag). Wyszukiwanie w bibliotekach daje materiały do sprawdzenia; **nie obiecuje trafień** w znanych kampaniach (wyszukiwanie w Google Ads Transparency nie dało materiałów dla rodzin kampanii z próbki).

### Tożsamość reklamodawcy i firmy

**Płatnik z biblioteki reklam to samodeklaracja.** Pola płatnika i beneficjenta (przejrzystość DSA, art. 26 i 39; w Marketing API `dsa_payor` i `dsa_beneficiary`) wpisuje reklamodawca, a platforma ich nie weryfikuje ([AI Forensics, „Meta health ads”](https://www.aiforensics.org/work/meta-health-ads)). Sieć stron oszustw dało się powiązać po samym wspólnym napisie „paid for by” ([Tech Transparency Project](https://www.techtransparencyproject.org/articles/meta-hosts-sprawling-pro-trump-scam-ad-network-as-election-nears)), ale tak samo da się go wpisać u niezwiązanych reklamodawców. Dlatego nazwa płatnika jest tylko wskazówką, a nie dowodem, kto płacił, i nadal nie łączy kampanii sama (`ad_payer` w `notAloneKinds`). Narzędzie dodaje **rodzaj płatnika** (`lib/osint/payerKind.ts`), sprawdzany w tej kolejności, pierwszy pasujący wygrywa: zaślepka (do 3 znaków albo słowo ze słownika: „test”, „xyz”, „brak”…), bełkot (sekwencja klawiszy, litery wymieszane z cyframi, ciąg bez samogłosek), imię i nazwisko w obcym alfabecie albo z pisownią wietnamską na reklamie po polsku, osoba prywatna, ogólna nazwa firmowa („Global Media Corp”), nazwa równa nazwie strony reklamodawcy, nazwa z formą prawną, inny. Rodzaj wyjaśnia, dlaczego deklaracja budzi wątpliwości („płatnik to bełkot z klawiatury”), jest faktem do zgłoszenia i trafia do paczki dowodów jako wskazówka (`payer_kinds`, `payer_equals_beneficiary`, `payer_suspicious`). Dwie reguły: **zaślepka nie tworzy powiązania** (ta sama „Test” stoi u niezwiązanych reklamodawców, więc nie ma węzła `ad_payer`), a osoba prywatna jako płatnik zostaje śladem z dopiskiem, że może być ofiarą kradzieży tożsamości. Słowniki są ogólne (typowe zaślepki, rzędy klawiatury, słowa firmowe) i leżą w `DEFAULT_PAYER_KIND_CONFIG`; nie powstały z napisów z prawdziwych spraw.

**Identyfikatory firm i rachunki ze stron** (`lib/text/companyIds.ts`): NIP, REGON, KRS, IBAN i polski NRB, unijny numer VAT, numer spółki w UK, LEI oraz nazwa podmiotu z formą prawną, z widocznego tekstu, kodu strony (także ukrytych elementów i komentarzy), JSON-LD (`vatID`, `taxID`, `leiCode`, `identifier`) i OCR zrzutów. Numer czytamy tylko przy etykiecie („NIP”, „REGON”, „konto”…), bo dziesięć gołych cyfr to numer zamówienia; IBAN z poprawną sumą kontrolną nie potrzebuje etykiety. Sumę kontrolną sprawdzamy tam, gdzie numer ją ma (NIP, REGON, IBAN i NRB mod 97, LEI); numer z błędną sumą jest zmyślony albo przepisany z błędem i dostaje flagę `companyIdInvalid`, ale wspólny zmyślony numer na dwóch stronach nadal wskazuje wspólny szablon, więc też tworzy ślad. Ślady są **tylko wspierające**: dane firmy da się skopiować z cudzej strony (fałszywe sklepy podają dane prawdziwych firm), a rachunki „mułów” bywają wspólne dla różnych grup, dlatego `company_id` i `bank_account` są w `notAloneKinds`, a rachunek mimo wagi 0,8 nie jest „silny” (`nonStrongTypes`). Identyfikatory pośredników, którzy stoją w stopkach wielu niezwiązanych sklepów (operatorzy płatności, kurierzy, platformy sklepowe), są na liście wyłączeń `lists.companyIdIntermediaries` (waga ×0).

**Czego nie robimy.** Nie budujemy grafu osób z rejestrów: publiczne API KRS maskuje imiona, nazwiska i numery PESEL członków organów i wyszukuje tylko po numerze KRS, a narzędzia z grafem powiązań osobowych są płatne; dane osobowe z rejestrów nie byłyby też potrzebne do łączenia kampanii. Sprawdzenie numeru w rejestrze (biała lista VAT) wymagałoby wysłania numerów z materiałów do zewnętrznej usługi i nie jest wykonywane na danych spraw.

**Które cechy działają dziś** (B-104): wszystkie wymienione, o ile materiał je zawiera. Cechy opcjonalne wymagają włączenia i narzędzi: OCR (`--ocr`, tesseract), transkrypcja (`--asr`), odcisk dźwięku (`--audio`), CLIP (`--clip`, wymaga modelu), głos (`--speaker`), twarze (`--faces`, OpenCV, wymaga venv z `scripts/py/setup-face.sh` i modeli ok. 40 MB), biblioteka reklam (`--ad-library`), zapytania sieciowe DNS/RDAP/ASN (`--lookups` albo `--live`). Brakujący krok jest oznaczony w wyniku jako `skipped` z powodem. Domyślny obraz Dockera ma modele twarzy (YuNet, SFace), ale nie ma modeli ASR, CLIP ani głosu, i nie wychodzi do sieci, więc te cechy są wtedy puste. Galeria głosów nie jest jeszcze zaimplementowana i nie występuje w tym dokumencie jako metoda.

### Sygnały sklepu

Część reklam prowadzi do fałszywych sklepów. Analityk sprawdza je ręcznie w kilkanaście minut, więc narzędzie czyta to samo ze strony (`lib/osint/shopSignals.ts`, `lib/osint/contact.ts`): linki do regulaminu, zwrotów, polityki prywatności i kontaktu; ceny przekreślone i rabaty (udział produktów z rabatem, mediana, maksimum, rabat na cały sklep: co najmniej 70% produktów z rabatem co najmniej 50%); brak frazy o najniższej cenie z 30 dni (dyrektywa Omnibus, w Polsce od 1.01.2023); chwyty „ktoś właśnie kupił”, „ostatnie sztuki”, licznik czasu, historia o likwidacji sklepu i dodatkowy rabat za krypto; metody płatności (tylko przelew, tylko metody trudne do cofnięcia: krypto, BLIK, karty podarunkowe; odbiorca wpłaty jako osoba prywatna albo tytuł „prezent”); czas realizacji; opinie (rozkład ocen, okno dat, anonimowość; same 5/5, opinie z kilku dni, brak opinii); nazwa i rok w stopce; deklarowany staż; rodzaj domeny adresów e-mail (darmowa skrzynka, domena sklepu, inna domena) i kompletność adresu (pełny, samo miasto, skrytka).

**Te cechy wyjaśniają, nie łączą.** Uczciwe sklepy też bywają bez ceny z 30 dni, z samymi opiniami 5/5, z jedną metodą płatności albo z adresem na Gmailu, więc żadna z nich nie ma wagi w grafie i żadna nie jest dowodem. Pokazujemy je w karcie materiału („Sklep”) i w paczce dowodowej, z liczbą albo cytatem, na których się opierają. Słowniki fraz są ogólne i wielojęzyczne (PL, EN, DE, CS, SK, RO, HU) i leżą w `lib/osint/shopSignalsConfig.ts`. Deklarowanego stażu nie porównujemy z archiwum, dopóki zapis nie niesie daty pierwszej migawki (wtedy dojdzie flaga „staż sprzeczny z archiwum”).

**Jedyny nowy ślad łączący to adres.** Pełny adres (ulica, numer, kod pocztowy, miasto; zapis ujednolicony, bez numeru lokalu) tworzy węzeł `postal_address` o wadze 0,5. Ten sam adres na dwóch sklepach to wspólny szablon albo ta sama ręka, ale adres łatwo skopiować ze stopki cudzego sklepu, a biura wirtualne wynajmują go niezwiązanym firmom, więc łączy tylko z drugim rodzajem dowodu (`campaignRules.notAloneKinds`), a adresy takich pośredników trafiają na listę wykluczeń (`lists.postalAddressExclusions`, uzupełnianą ręcznie). Samo miasto i skrytka pocztowa nie są śladem.

**Atrybuty infrastruktury i domeny** (też bez wagi): wystawca certyfikatu TLS (darmowy certyfikat to tylko kontekst: kłódka nic nie mówi o sprzedawcy), certyfikat wystawiony na inną domenę albo wygasły (z HAR, `securityDetails`), znana marka w ścieżce adresu przy domenie bez tej marki (`/inpost/…`), platforma sklepu (WordPress, WooCommerce, Shopify, Shopline, PrestaShop…, dopisywana do atrybutu platformy strony), hosting poza UE i EOG (kraj z wzbogacenia ASN, bez nowych zapytań), rzadki TLD (słaby sygnał, tło z Listy CERT nie jest dołączone), nazwa domeny w innym języku niż strona, zasłonięty rejestrant w RDAP, administrator danych z polityki prywatności na innej domenie niż adresy kontaktowe, niespójny asortyment (≥ 3 niezwiązane kategorie w katalogu do 50 produktów albo towary spoza kategorii nazwy sklepu), opinie bez odpowiedzi sprzedawcy, strona udająca kuriera z polem karty i wyborem paczkomatu oraz domena adresu kontaktowego z rekordem MX, która nie odpowiada po HTTP(S) (tylko przebieg z siecią). Tekstu „wygenerowanego przez AI” nie oceniamy: detektory tekstu AI są zawodne, a metoda odrzuca detektory pojedynczego materiału.

**Rejestry firm.** Odpis z KRS (`api-krs.ms.gov.pl`, bez klucza) pozwoliłby porównać nazwę, siedzibę i datę wpisu firmy z danymi na stronie; nie jest zbudowany. CEIDG wymaga konta i tokenu, więc go pomijamy; to możliwość na później.

Źródła listy cech: szkolenie SekurakTV „Jak się nie dać oszukać? Sprawdzamy e-sklepy technikami OSINT-owymi” (szybki audyt e-sklepu: [youtube.com/watch?v=URdgnHObeXE](https://www.youtube.com/watch?v=URdgnHObeXE)) i SYNACK Time „Identifying SCAM Store Websites” ([youtube.com/watch?v=EfHzsg-MSJc](https://www.youtube.com/watch?v=EfHzsg-MSJc)).

## 3. Wagi

Każdy ślad (encja, np. konkretny tracker) dostaje wagę. Waga to iloczyn trzech rzeczy:

1. **Waga typu cechy** (tabela niżej): jak mocno ten rodzaj śladu wskazuje na jednego operatora.
2. **Zniżka za infrastrukturę wspólną i cechy platform** (czynnik 0–1 z list w konfiguracji): Cloudflare i inne CDN, masowi dostawcy DNS, darmowe urzędy certyfikacji, popularni rejestratorzy, skracacze, platformy stron, publiczne serwisy formularzy. Wspólne IP Cloudflare dzielą tysiące niezwiązanych stron, więc waży ok. 0,006 zamiast 0,6. **Cechy platformy, nie operatora** (identyfikator maszyny, plik `events-stat.js`, format linku `/click?key=`, biblioteki landerów) są mnożone przez 0,1, bo używa ich każdy klient danej usługi.
3. **Rzadkość (`df`, odwrotna częstość)**: im więcej materiałów w zbiorze ma ten sam ślad, tym mniej wart (do 0,2 wagi, a powszechny w prawie całym zbiorze nawet do 0,1).

Przesłanki jednej pary materiałów łączy się **noisy-OR**: `wynik = 1 − Π(1 − wᵢ)`. Dwie niezależne przesłanki po 0,5 dają 0,75. Wynik rośnie z każdą kolejną przesłanką, ale nigdy nie przekracza 1. Przesłanka o wadze ≥ 0,7, której ślad występuje w mniej niż połowie zbioru, jest **silna** (patrz punkt 4).

### Wagi typów (stan po zadaniu I28; źródło prawdy: `typeWeights` w `lib/graph/config.ts`)

| Typ | Waga | Typ | Waga |
|---|---|---|---|
| url, tracker, wallet | 1,0 | cname_target, imagehash | 0,65 |
| host, domain, endpoint (backend), crm_key, meta_ad, platform_campaign | 0,95 | advertiser, ip, hidden_fields, comment, domain_pattern, click_server | 0,6 |
| email, phone, telegram, shared_doc, onion, messenger_invite, platform_account | 0,9 (c2_host 0,95) | asset | 0,55 |
| path_id | 0,85 | favicon, kit_string | 0,5 |
| cert, campaign_param, bank_account (nie jest silny) | 0,8 | comment_block, template_phrase | 0,45 |
| ad_payer | 0,65 | nameserver, page_template | 0,35 |
| | | company_id (NIP, REGON, KRS, VAT), postal_address (adres sklepu) | 0,5 |
| | | technique, profit_claim | 0,2 |
| | | param_schema | 0,12 |
| | | persona | 0,1 |
| | | registrar, asn | 0,05 |

Wagi własne części węzłów (od zadania I10, nadpisują wagę typu): token weryfikacji domeny 0,9 (`tracker`), para osób 0,35 (`persona`, tylko grupa), marka oszustwa 0,45 (`campaign_param`, ślad zestawu stron), wydawca AdSense 0,5 (`tracker`, ślad zestawu stron), host z żądań strony 0,25 (`endpoint`, ślad zestawu stron). Wagi podobieństwa (obraz 0,6, obraz CLIP 0,45, tekst 0,5, struktura strony 0,45, dźwięk 0,5, głos 0,4) i ich progi też są w `config.ts`. Tabela jest przepisana ręcznie; przy rozbieżności wygrywa `config.ts`.

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

## 4a. Zmiany metody po walidacji (zadanie I10, 22.11.2026)

Walidacja na materiałach spoza próbki pokazała prawie wyłącznie rozbicia (wysoka precyzja, niska czułość). Zmiany mają ogólne uzasadnienie, test syntetyczny i opis w `docs/TECHNICAL.md` §4.16; liczby przed i po: punkt 9.

**Nowe i poprawione ślady łączące.**
- **Plik z witryny konta darmowego hostingu = hosting tego konta.** Gdy strona ładuje swoje skrypty z subdomeny platformy, na której każda subdomena to jedna witryna jednego konta (`netlify.app`, `pages.dev`, `github.io` …), host tej witryny liczy się jak hosting operatora (waga 0,95 × 0,7, nie silny). Kupiec skopiowanego zestawu stron trzyma pliki na własnej domenie, a publiczne CDN mają zniżkę. Host spoza tej listy (sieć reklamowa, statystyki) takiego śladu nie daje.
- **Skrypty dopisywane przez CDN** (`/cdn-cgi/…`, np. dekodowanie e-maili Cloudflare) mają zniżkę ×0,02: to cecha CDN, nie operatora.
- **Ślady z żądań strony (HAR, skan):** identyfikator piksela Mety z adresów wywołań, identyfikator kliknięcia trackera z wywołań zdarzeń, katalog landera platformy (`/landers/<uuid>/`) już z jednego adresu, parametry kampanii i identyfikator kliknięcia z linków CTA strony (relacja 0,8). Hosty spoza domeny strony (`tracker_host`, 0,25) są śladem zestawu stron: tylko potwierdzają, bo lista usług publicznych nigdy nie jest pełna. Żądania wcześniejszej strony tej samej sesji przeglądarki i żądania rozszerzeń przeglądarki osoby zapisującej HAR są pomijane.
- **Tokeny weryfikacji domeny** (Meta, Google, Yandex; z kodu strony i rekordów TXT) to ślad jednego konta Business Managera albo Search Console: silny (0,9).
- **Identyfikatory reklam i kampanii z linku:** identyfikator reklamy Mety w `utm_content`/`ad_id` łączy się z identyfikatorem z `fbclid`; `gad_campaignid` (Google Ads) i konto kupującego ruch (`acc=`, `_buyer=`) to silne parametry kampanii; miejsce wyświetlenia (`utm_placement`) jest słabe.
- **Marka oszustwa** (nazwa produktu albo „platformy”, np. „Fikcyjnol Forte”, „TradeSynthIQ 4.7”) przetrwa zmianę twarzy i domeny, ale jeden produkt sprzedaje wielu afiliantów: to ślad zestawu stron (0,45), sam daje najwyżej grupę; ogólne nazwy platform mają zniżkę. Wydawca AdSense (`ca-pub-…`) też jest śladem zestawu stron (identyfikatory wydawców bywają współdzielone).
- **Linki-opakowania platform** (`l.facebook.com/l.php?u=`, `google.com/url?q=`, `adurl=`) są rozwijane do adresu docelowego, bo domeny platform mają wagę 0.
- **Siatki bezpieczeństwa:** ślad wspólny dla więcej niż 20 materiałów nie jest silny niezależnie od wielkości zbioru (bez tego w dużej partii jeden powszechny ślad skleja łańcuchowo); społeczność Louvaina rozpadająca się na części bez powiązań jest dzielona na te części; stałe frazy reklam („dowiedz się więcej”, „tylko dziś”) i halucynacje transkrypcji („Napisy stworzone przez społeczność Amara.org”) nie liczą się do podobieństwa tekstu; transkrypcja może używać VAD (wykrywania mowy), żeby nie pisać tekstu do samej muzyki; strona wyzwania antybotowego to zablokowane pobranie, nie cloaking.

**Atrybuty materiału, kampanii i grupy (nigdy dowód kampanii, bez wyniku ryzyka).**
- **Narracja:** temat (inwestycja, dotacja, zdrowie z podkategoriami, hazard, wybory, „inwestycje dzięki AI”, złoto z NBP, wojna i surowce, „tajemnica”, „nastolatek zarobił”, odzyskanie środków, wydarzenia: mundial, zaprzysiężenie, „państwowa inwestycja”), forma przynęty (fałszywa sensacja, polecenie, fałszywy wywiad), kwoty, data materiału. Kampania i grupa mają podsumowanie narracji, a kampania na jednej infrastrukturze, która zmienia temat w ciągu tygodnia, dostaje opis „ten sam operator, dwie narracje”. Etykieta reguły IHC (`celeb_bait_investment`: osoba z listy oraz obietnica zysku, zaproszenie do grupy albo podrobione medium) jest atrybutem. Paczka dowodów bierze „usługę finansową” z narracji, z cytatem i dopiskiem „(wniosek)”.
- **Podrabiana marka na kreacji** (CLIP zero-shot na liście ok. 20 portali, banków i instytucji) i **grupy osób** z listy osób publicznych („Dziennikarze”) są cechami grupy. **Para osób** w jednym materiale (fikcyjna rozmowa dwóch znanych osób) jest rzadsza niż jedna osoba, więc sama tworzy grupę podobnych kampanii, ale nigdy kampanię.
- **Most i najsłabsze ogniwo:** kampania, którą trzyma razem jeden silny ślad między dwiema podgrupami, ma pole `bridge` („kampania sklejona jednym śladem: X”, kandydat do listy zniżek), a `minInternalScore` pokazuje członka, który wisi najbliżej progu.
- **Wiek domeny i pierwszego certyfikatu** w dniu pierwszej obserwacji materiału, **platforma strony** (np. platforma stron, tracker; tylko atrybut, bez grupy, bo platforma ma tysiące niezwiązanych klientów), **liczba reklam zdjętych przez platformę**, **kolumny wejścia spoza mapowania** („dane z wejścia”).

**Rozszerzalność bez zmiany kodu (`--config`).** Plik konfiguracji dopisuje listy zniżek (tablice w `lists` są dołączane do domyślnych) i może zrobić pivot z nieznanej kolumny wejścia:

```json
{
  "extraPivots": { "page_id": "advertiser" },
  "lists": {
    "domains": [{ "match": "cdn-uslugi.example", "factor": 0, "reason": "usługa współdzielona przez wiele stron" }],
    "genericScamBrands": [{ "match": "zyskomat*", "factor": 0.2, "reason": "ogólna nazwa platformy" }]
  }
}
```

Wartość kolumny `page_id` staje się wtedy węzłem typu `advertiser` (klucz `extra:page_id=<wartość>`) z wagą, zniżkami i regułami tego typu.

## 4b. Operator jako firma leadowa (zadanie I23, 22.11.2026)

Publiczne opisy branży (raport RIVSEC „Fałszywe inwestycje w internecie. Schematy działania i zaplecze przestępcze”, marzec 2026, omówiony w podcaście Techstorie #157, Wyborcza, 13.10.2026) pokazują operatora jak firmę, która kupuje i sprzedaje zgłoszenia (leady). Strona docelowa ma jeden interaktywny element, formularz (imię, nazwisko, telefon), a dane trafiają na żywo do CRM. Leady są pakowane według kraju i kanału, więc każde zgłoszenie niesie identyfikator źródła, a pośrodku stoi sieć afiliacyjna („manager do spraw afiliacji”). Z tego wynikają ślady i reguły:

- **Identyfikator afiliacyjny i klucz CRM łączą kampanię.** Identyfikator afiliacji, oferty i strumienia (`aff_id`, `pid`, `partner_id`, `wm_id`, `offer_id`, `flow_id`/`stream`, `landing_id`, `s1`–`s5`) siedzi w adresie, w ukrytych polach formularza i w obiektach konfiguracji skryptów strony. To ten sam węzeł `campaign_param` (0,8) z pochodzeniem „z adresu / z formularza / ze skryptu”, bo zgłoszenie idzie do CRM z tymi samymi identyfikatorami co link. Krótkie, pospolite nazwy (`pid`, `flow`, `s1`, `partner`) liczą się tylko z wartością przypominającą identyfikator (cyfra, co najmniej 3 znaki), więc `1`, `test`, `default` i makra nie łączą. Identyfikator kliknięcia (`click_id`, `aff_click_id`) jest nowy przy każdym kliknięciu i nie łączy materiałów. Tajny klucz API, z którym formularz wysyła zgłoszenie (`crm_key`, 0,95), należy do jednego konta odbiorcy leadów: jest tak mocny jak wspólny backend formularza. Narzędzie zapisuje z klucza tylko skrót (4 pierwsze i 4 ostatnie znaki oraz sha256), nigdy cały klucz, i pomija klucze usług publicznych (mapy, reCAPTCHA, analityka), tokeny CSRF oraz wartości krótkie lub mało losowe.
- **Zdanie szablonu tylko wspiera.** Rzadkie zdanie (≥ 6 słów) z tekstu strony albo z podziękowania zapisanego w skrypcie („Nasz opiekun zadzwoni do Ciebie …”) obecne w co najmniej dwóch domenach to `template_phrase` (0,45). Ten sam szablon kupuje wielu operatorów, więc jest w `notAloneKinds` jak szablon strony i blok komentarzy. Wspólna wpadka w zdaniu (powtórzony ciąg trzech słów, słowo z łacinką i cyrylicą) jest rzadsza niż poprawne zdanie i waży 1,3 raza więcej, ale poniżej progu silnego dowodu. Zgody RODO, cookies, stopki i ostrzeżenia o ryzyku są pomijane.
- **Przykładowy numer z formularza to szablon, nie telefon.** Numer z `placeholder`, z wartości pola telefonu, z etykiety albo z podpowiedzi „np. …”, „na przykład …”, „format …” jest kopiowany z szablonem na każdą stronę. Nie tworzy węzła `phone` (0,9), tylko ślad szablonu (`page_template`, klucz `phone_example:`). Numery oczywiście sztuczne (same powtórzenia, `123456789`) nie są ani telefonem, ani przykładem.
- **Nazwa konta reklamowego tylko wspiera.** Reklamy idą z przejętych kont opłacanych kartami wcześniejszych ofiar (np. konto pensjonatu), więc nazwa reklamodawcy często należy do ofiary. Nazwa bez konta z biblioteki reklam (rodzaj reguły `advertiser_name`) jest w `notAloneKinds`, jak płatnik reklamy. Stały identyfikator konta z biblioteki reklam łączy jak dotąd. Reklama inwestycyjna z konta nazwanego jak lokalna firma albo osoba prywatna dostaje atrybut „konto reklamowe prawdopodobnie przejęte (nazwa nie pasuje do treści)” i jej nazwa nie daje żadnego śladu.
- **Persona nie dzieli kampanii.** Operator robi testy A/B twarzy (aktor czy polityk, deepfake czy nie), więc w jednej kampanii persona się zmienia. Persona jest tylko cechą grupy: różne twarze przy tym samym backendzie formularza to jedna kampania, ta sama twarz na różnej infrastrukturze to dwie kampanie, najwyżej w jednej grupie.
- **Kwoty zysku opisują scenariusz.** Wiarygodne kwoty z okresem („3 tys. w ciągu dnia”, „4000 zł tygodniowo”) z tekstu, strony, OCR i transkrypcji są atrybutem `profitClaims`. Zestaw par kwota i okres (`profit_claim`, 0,2) łączy tylko w grupę (`familyOnlyKinds`). Standardowa wpłata (250 USD/EUR, „minimalny depozyt”) zostaje w atrybucie, ale nie w śladzie.

| Ślad | Waga | Reguła |
|---|---|---|
| `campaign_param` z formularza albo skryptu | 0,8 | jak parametr z adresu; `click_id` bez śladu |
| `crm_key` (skrót klucza API CRM) | 0,95 | łączy sam |
| `template_phrase` (zdanie szablonu, ≥ 2 domeny) | 0,45 (z wpadką ×1,3, maks. 0,65) | `notAloneKinds` |
| `page_template` z przykładowego numeru | 0,35 | `notAloneKinds` |
| `advertiser` z samej nazwy | 0,6 | `notAloneKinds` (`advertiser_name`) |
| `profit_claim` (kwota + okres) | 0,2 | `familyOnlyKinds` |

Na 25 sprawach jury F1 par się nie zmienił (0,897, 14 kampanii); jedna grupa podobnych kampanii urosła o kampanię, którą łączy z nią przykładowy numer z tego samego szablonu formularza (liczby: Raport I23).

## 4c. Odcisk tekstu (zadanie I25, 22.11.2026)

Teksty stron krążą między operatorami: te same zmyślone komentarze, ten sam pasek „powiązanych artykułów” i ten sam kod pułapek trafiają na strony różnych kont i trackerów. Tekst wskazuje więc dostawcę tekstów albo zestaw stron, czyli najwyżej grupę podobnych kampanii. Do kampanii zawsze potrzebny jest drugi, niezależny ślad operatora.

- **Komunikat ze skryptu zestawu (`kit_string`) łączy zestaw stron.** Skrypty zestawu niosą komunikaty programisty (log w konsoli, błąd, ostrzeżenie), często z literówką. Taki sam komunikat na stronach różnych produktów to odcisk narzędzia, prawie tak specyficzny jak skrót pliku. Narzędzia używa jednak wielu operatorów, więc `kit_string` (0,5) jest w `notAloneKinds` i liczy się do grup. Para stron dostaje jedną przesłankę, gdy dzieli co najmniej dwa komunikaty albo jeden długi (≥ 5 słów); każdy komunikat musi wystąpić w co najmniej dwóch domenach rejestrowalnych, a rzadkość liczy zwykłe IDF z `maxPivotDf`. Czytamy skrypty wpisane w stronę i własne skrypty zewnętrzne (ta sama domena rejestrowalna, z HAR albo z folderu `_files` zapisanej strony, w trybie online tylko GET bez wykonywania). Skryptów z obcych domen nie pobieramy.
- **Maska tekstu platformy.** Platforma stron dostarcza jeden plik SDK dla wszystkich kont, a framework ten sam kod uruchomieniowy na każdej stronie. Bez maski taki tekst skleiłby wszystkie strony platformy. Dlatego (a) napisy ze skryptów o ścieżkach SDK, paczek frameworków i znanych bibliotek nigdy nie są śladem tekstu; (b) zdanie szablonu albo komunikat obecny na stronach co najmniej 5 różnych kont platformy albo na co najmniej 30% stron zbioru (od 10 stron) to tekst platformy; (c) skrypt ze słownikiem tego samego komunikatu w co najmniej 5 językach to lokalizacja interfejsu: strona dostaje atrybut `localizedUi` (kody języków), a napisy z tego skryptu nie tworzą śladów.
- **Bez wniosków o autorze.** Język, typografia i ślady tłumaczenia mogą opisywać materiał, ale nie wskazują narodowości ani tożsamości autora: szablony są tłumaczone, kopiowane i poprawiane przez różne osoby, więc służą tylko jako opis.

| Ślad | Waga | Poziom |
|---|---|---|
| `kit_string` (≥ 2 wspólne komunikaty albo 1 z ≥ 5 słów, ≥ 2 domeny) | 0,5 | `notAloneKinds`: zestaw stron, do kampanii drugi ślad; sam łączy grupę |
| `template_phrase` po masce platformy | 0,45 (z wpadką maks. 0,65) | `notAloneKinds` |
| `localizedUi` | brak | atrybut |

Na 25 sprawach jury kampanie i F1 par się nie zmieniły (0,897, 14 kampanii). `kit_string` dał 4 powiązania; jedno z nich dodało trzecią grupę podobnych kampanii z dwóch spraw bez pary w etykietach roboczych. Liczba powiązań `template_phrase` po masce pozostała ta sama (17), bo zdania szablonu w tych sprawach pochodzą z tekstu stron, a nie z SDK.

## 4d. Sygnały z praktyki śledczej (zadanie I28, 22.11.2026)

Źródło: transkrypcje podcastów śledczych (OSINT Podcast https://www.youtube.com/@OSINTPodcast, Fraud Forward https://www.youtube.com/@FraudForward) i katalog cech z tych odcinków (`/Users/miron/Projects/deepfake-research/cechy/podcasty-osint-fraud-cechy.md`). Prawie wszystko stąd jest **atrybutem materiału**: tłumaczy w przeglądarce i w paczce dowodów, jaki to typ oszustwa i dlaczego, ale nikogo nie łączy. Łączą tylko identyfikatory kontaktowe i dokumenty.

**Co łączy** (rodzaje śladów z wagą jak Telegram, 0,9: wskazują konto albo zasób operatora; rzadkość przez IDF i `maxPivotDf` jak każdy inny ślad):

- `shared_doc`: dokument, arkusz, formularz (Google, Notion, Microsoft Forms, Typeform, Jotform) i udostępniona rozmowa z modelem językowym (usługa `llm_chat`: operator wkleja dane kampanii do czatu i udostępnia link). Klucz `usługa:identyfikator`. Identyfikatory przykładowe z dokumentacji dostawców i strony pomocy są pomijane (lista w `lib/osint/contactConfig.ts`).
- `onion`: adres .onion wersji 3. Adres wersji 2 wygasł w 2021 r., więc jest tylko atrybutem (`onionV2`).
- `fictional_expert` (B-313): tytuł `dr` lub `prof.` z imieniem i nazwiskiem spoza `data/osoby-publiczne.json` (tekst strony, reklamy, OCR, ASR). Klucz: tytuł i imię z nazwiskiem małymi literami, bez polskich znaków i końcówek fleksyjnych; literówki (odległość edycji ≤ 1, ≤ 2 dla długich nazw) są zlewane. Waga 0,75, rzadkość przez IDF i `maxPivotDf`. Zmyślonego eksperta wymyśla jeden operator, więc łączy.
- `c2_host` (B-333): host serwera, do którego skrypt skopiowanego zestawu strony (np. fałszywa biblioteka na darmowym hostingu lub w jsDelivr `gh/`) wysyła ciasteczka lub dane logowania z fałszywego panelu trackera. Wymagane razem: sprawdzenie ścieżki `/admin` lub `/panel` i wysyłka `document.cookie` albo pól hasła do obcego hosta; zwykła biblioteka nie daje nic. Atrybut materiału: `stealerKit` (które sygnały zadziałały). Waga 0,95.
- `messenger_invite`: zaproszenia i konta Discord, Signal, Viber i Line (`usługa:identyfikator`); numer z `wa.me` jest zwykłym telefonem. Serwery społeczności samych platform są pomijane.

Źródłem są tekst i atrybuty strony, tekst reklamy, OCR zrzutu i adresy żądań z HAR. Żaden z tych adresów nie jest otwierany: to zasoby operatora, narzędzie czyta tylko zapis.

**Co tylko wyjaśnia** (atrybuty, bez wagi; techniki liczą się wyłącznie przy grupach podobnych kampanii, jak inne techniki):

- Techniki strony: fałszywy alarm bezpieczeństwa z numerem telefonu (`fake_security_alert`: alarm + numer jako jedyne wyjście + mechanizm przytrzymania), program do zdalnego pulpitu (`remote_access_tool`), fałszywa weryfikacja z poleceniem do wklejenia (`clickfix_paste`). Z polecenia ClickFix zapisujemy tylko rodzaj i skrót SHA-256 (to ładunek złośliwego oprogramowania); skrót nie jest śladem łączącym, bo wśród rodzajów nie ma „zestawu” pasującego do polecenia.
- Domena pokazana w reklamie różna od strony docelowej (`displayedDomainMismatch`, z flagą znanej marki).
- Rodzaj numeru telefonu (`phoneLines`: komórkowy, stacjonarny, bezpłatny, o podwyższonej opłacie, VoIP) z lokalnych metadanych `libphonenumber-js`, bez wysyłania numeru do usług, oraz flagi `phoneCountryMismatch` i `tollFreeOnAlert`. **Waga numeru się nie zmienia**: numery VoIP i aplikacyjne bywają jednorazowe, dlatego waga telefonu opiera się na rzadkości numeru (IDF), a rodzaj jest tylko wyjaśnieniem.
- Adres, który udaje inny (`idnConfusable`: znak podobny do `/`, `.`, `-` albo mieszane alfabety w jednej etykiecie), dzień tygodnia i godzina startu reklamy z biblioteki reklam (rozkład w kampanii opisuje rytm operatora) i data utworzenia serwera lub konta Discord z identyfikatora w linku („zegar powstania”).
- Narracje i haczyki: tematy fałszywej pomocy technicznej, zwrotu nadpłaty, oferty odzyskania środków (wtórne oszustwo wobec ofiar), oferty pracy, udawanego organu; haczyki tajemnicy, opłaty przed wypłatą i groźby blokady konta.

**Zastrzeżenia ze źródeł.** Numer dzwoniącego i numer z formularza nie dowodzą tożsamości (podszywanie numeru, aplikacje). Wspólny zestaw albo platforma „fraud as a service” nie dowodzi jednego operatora. Brak literówek nie jest już sygnałem legalności, bo teksty piszą modele językowe. Zrzut salda z „platformy” nie dowodzi stanu konta (edycja DOM).

## 4e. Przypadki graniczne: celowo nie połączone (zadanie I20, 22.11.2026)

**Co to jest bliska para.** Para reklam, które są do siebie podobne, a metoda celowo nie połączyła ich w jedną kampanię. Każda taka para ma w zestawieniu regułę, która zablokowała połączenie, i opis tego, czego zabrakło. Zestawienie robi dwie rzeczy. Pokazuje, że metoda pilnuje fałszywych powiązań: wspólna osoba w reklamie, popularny szablon, wspólna platforma, CDN, rejestrator. I daje listę przypadków do przeglądu, gdy wynik pary leży blisko progu. Zestawienie tylko zapisuje decyzje, które metoda i tak podejmuje: nie zmienia wag, progów ani reguł, a kampanie i grupy wychodzą identyczne z tymi sprzed zadania (sprawdzone porównaniem `campaigns.json` na próbce syntetycznej i na 25 sprawach).

**Kiedy para trafia na listę.** Nie jest w jednej kampanii, nie pochodzi z jednej sprawy i spełnia co najmniej jeden warunek: wynik pary ≥ połowa progu łączenia; para ma wspólny ślad silnego typu, który został zdyskontowany (np. domena wspólnej sieci CDN); jej kampanie leżą w jednej grupie podobnych, a ona sama nie jest w kampanii. Połowa progu i limit liczby par (domyślnie 200, najwyższe wyniki) są w konfiguracji (`nearMiss`).

**Reguły (identyfikator, co znaczy):**

- `below-min-score`: wynik pary jest poniżej progu łączenia.
- `family-only-kind`: wynik pochodzi ze śladów, które łączą tylko w grupę (osoba w reklamie, technika strony); bez nich para jest poniżej progu.
- `account-conflict`: reklamy stoją na różnych kontach tej samej platformy stron; platforma daje swoje szablony i biblioteki wszystkim kontom.
- `discounted-only`: jedyne wspólne ślady to infrastruktura używana przez wiele stron (CDN, popularny rejestrator, platforma), po obniżeniu wagi nic nie zostaje.
- `kit-only`: łączy je tylko zestaw stron (szablon, motyw, komentarze, struktura), który kupuje i kopiuje wielu operatorów; brak śladu operatora.
- `content-only-with-infra`: łączy je tylko treść, a któraś reklama ma własną infrastrukturę, której druga nie dzieli.
- `too-few-content-kinds`: reklamy bez infrastruktury łączy jeden rodzaj treści, a kampania wymaga dwóch.
- `too-few-evidence-kinds`: wspólne ślady mają za mało różnych rodzajów, by uznać je za potwierdzone (domyślnie reguła nie występuje, bo wystarcza jeden rodzaj poza zestawem stron i treścią).
- `split-by-clustering`: reguły pozwalały połączyć reklamy, ale podział sieci powiązań na kampanie (Louvain) umieścił je w różnych kampaniach.

**Liczby z przebiegu na 25 sprawach (28 rekordów, 14 kampanii, 3 grupy podobnych; według reguły):** 52 bliskie pary, z tego `below-min-score` 37, `kit-only` 9, `account-conflict` 4, `family-only-kind` 1, `discounted-only` 1; pozostałe reguły 0. Pary, które etykiety zespołu mają w jednej kampanii, a metoda je rozdzieliła (kandydaci na fałszywe rozdzielenie): 0. Zgadza się to z recall pary równym 1,0 w ewaluacji tego przebiegu. Przy `kit-only` i `account-conflict` metoda zadziałała zgodnie z założeniem (wspólny zestaw stron albo konto platformy, nie operator). Pary `below-min-score` mają wyniki od 0,06 do 0,12 (próg 0,15) i łączą je głównie słabe ślady (sieć operatora, technika strony, układ linku śledzącego); do przeglądu warto brać najwyższe wyniki z tej reguły.

**Gdzie to zobaczyć.** `near-misses.json` obok `campaigns.json` (zapisuje go każdy `build-graph`), zakładka „Celowo nie połączone” w przeglądarce, pole `nearMisses` i kolumna `blisko_bez_polaczenia` w wyniku analizy nowego materiału. Format: `docs/TECHNICAL.md`, §5.3c.

Bliskie pary z tego przebiegu weszły do zbioru twardych negatywów z prawdziwych materiałów (punkt 4f), gdzie sprawdzamy, czy narzędzie nie skleja ich w kampanię.

## 4f. Twarde negatywy z prawdziwych materiałów (zadanie I21, 22.11.2026)

**Po co.** Najczęstszy błąd narzędzi tego typu to fałszywe sklejenie: dwa materiały różnych operacji w jednej kampanii, bo mają tę samą przynętę. Wcześniejsze testy twardych negatywów były tylko syntetyczne. Teraz mamy zbiór par z prawdziwych materiałów (25 spraw próbki i 212 materiałów walidacji) i stały test w repozytorium, że żadna z nich nie trafia do jednej kampanii. Grupa podobnych kampanii jest dozwolona.

**Sześć kategorii przynęty** (para może mieć kilka):

1. ta sama osoba w reklamie (z listy osób publicznych);
2. ten sam motyw lub narracja (inwestycja, wywiad w mediach, zdrowie, kasyno, oferta sklepu: słowa kluczowe);
3. podobny tekst albo obraz (krawędź podobieństwa w grafie, CLIP, pHash) bez wspólnej pełnowagowej infrastruktury;
4. wspólny ślad zdyskontowany (CDN, platforma, kreator, rejestrator, NS, biblioteka JS, ogólny parametr kampanii);
5. domeny zarejestrowane tego samego dnia albo podobne leksykalnie;
6. strona pusta, błąd pobierania, cloaking albo strona zaparkowana.

Do tego jako osobne źródło bliskie pary z punktu 4e.

**Metoda doboru.** Bierzemy pary z różnych kampanii według etykiet (etykiety zespołu dla 25 spraw, etykiety walidacji dla pozostałych) i zostawiamy te, które spełniają co najmniej jedną kategorię. Wybór idzie od najtrudniejszych, czyli od najwyższego wyniku pary w grafie, z limitem par na kategorię i na materiał oraz udziału jednego typu pary. **Etykieta „różne kampanie” musi mieć podstawę.** Jeśli obie reklamy mają wspólny pełnowagowy identyfikator operatora (konto platformy stron, serwer kliknięć, tracker albo zarejestrowaną domenę), to według definicji naszych etykiet jest to ta sama kampania. Wtedy para trafia do „niepewnych” i nie liczy się jako negatyw. Inaczej podstawą są różne identyfikatory tego samego typu („inne konta”, „inne domeny”) albo same różne etykiety. W kategoriach z mniej niż trzema parami prawdziwymi dokładamy pary **pochodne**: bierzemy prawdziwą sprawę i podmieniamy jedną warstwę tak, żeby powstała inna operacja z tą samą przynętą. Na przykład ta sama treść i osoba z innym backendem formularza i innym kontem albo ten sam kreator i CDN z inną treścią i innym trackerem. Pary pochodne liczymy osobno. Pomiar ma dwie części: wynik pary we wspólnym grafie (sklejone, tylko grupa, rozdzielone) i leave-one-out, czyli materiał A analizowany jako nowy względem bazy bez całej jego sprawy.

**Wynik (pary prawdziwe, kod po zadaniu I20; para z kilkoma kategoriami liczy się w każdej):**

| kategoria | pary | sklejone | tylko grupa | rozdzielone |
|---|---|---|---|---|
| ta sama osoba | 6 | 0 | 0 | 6 |
| ten sam motyw | 28 | 0 | 12 | 16 |
| podobny tekst lub obraz | 9 | 0 | 8 | 1 |
| wspólny ślad zdyskontowany | 65 | 0 | 20 | 45 |
| podobne domeny | 7 | 0 | 4 | 3 |
| pusta strona | 31 | 0 | 10 | 21 |
| bliskie pary (4e) | 52 | 0 | 12 | 40 |
| **razem (pary bez powtórzeń)** | **97** | **0 (0%)** | **25** | **72** |

Leave-one-out daje to samo: 0 sklejeń. Przed sprawdzeniem podstawy etykiet sklejonych było 25 z 104 wybranych par. Wszystkie 25 okazały się parami bez podstawy: wspólne konto platformy stron przy etykiecie walidacji, która mówi tylko „konto spoza znanych kampanii”, kopia archiwalna sprawy bez własnej etykiety, wariant znanej kampanii zapisany w innym zapisie etykiety, dwie podrodziny jednej domeny. Wśród 200 par bez podstawy narzędzie skleja 51, zawsze przez wspólne konto platformy albo wspólną domenę, czyli zgodnie z definicją kampanii.

**Pary pochodne:** 18 (po 3 w każdej kategorii), sklejone 5. Jedna to błąd generatora: wariant zachował wartość parametru kampanii w formularzu, a to silny ślad operatora. Tę parę wykluczamy z testu. Cztery to znane słabości metody:

- **podobny tekst + domena, do której strona tylko linkuje (1 para).** Kopia strony z tymi samymi zdaniami szablonu linkuje do tej samej domeny co oryginał (cel przycisku, kasa sprzedawcy oferty). Domena z odnośnika ma relację ×0,4 i po mnożeniu przekracza próg zdyskontowanego śladu, więc liczy się jako ślad operatora i razem z zestawem strony tworzy kampanię.
- **dwie puste strony na jednym adresie IP spoza list (3 pary).** Jeden rodzaj śladu operatora wystarcza do kampanii, a IP hostingu współdzielonego wygląda tak samo jak serwer jednego operatora.

**Proponowane poprawki sprawdzone bez zmiany kodu** (`--config`): relacja odnośnika ×0,3 usuwa pierwsze sklejenie, ale rozdziela parę jednej kampanii z 25 spraw, która stoi na tym samym wzorcu. IP i system autonomiczny jako ślady, które nie łączą same, usuwają sklejenia pustych stron, ale rozbijają 299 z 878 trafnych par walidacji. Sam system autonomiczny albo samo IP nie usuwają sklejeń. Żadna poprawka nie spełniła warunku „usuwa sklejenie i nie zmienia żadnego trafnego przypisania”, więc `lib/graph/config.ts` zostaje bez zmian. Cztery znane sklejenia są w teście oznaczone jako oczekiwany błąd (`it.fails`). Rozwiązanie wymaga nowych danych, nie wag: liczby domen na adresie IP z pasywnego DNS i rozróżnienia celu odnośnika (własny lander operatora czy usługa wielu klientów).

**Test w repozytorium.** `tests/hardNegatives.real.test.ts` z `tests/fixtures/hard-negatives-real.json`. Plik zawiera 114 par: 97 prawdziwych i 17 pochodnych. Z każdej pary zostaje tylko struktura: typy wspólnych śladów, waga, dyskonto, siła, podobieństwo, to, czy reklama ma infrastrukturę, i konto platformy zastąpione stałą. Domen, identyfikatorów, nazwisk ani tekstów w pliku nie ma (sprawdzone skanerem wycieków). Test sprawdza, że żadna para nie trafia do jednej kampanii, a pary, które grupę tworzą samym swoim powiązaniem (33), trafiają do jednej grupy podobnych. Zastrzeżenia: etykiety są nasze, kategorie motywu i pustej strony wykrywają proste reguły, a odsetek dotyczy wybranych, najtrudniejszych par, nie wszystkich możliwych.

## 5. Duplikaty i „za mało danych”

**Dokładny duplikat** to ta sama reklama zebrana drugi raz. Rozpoznajemy go **tylko** po: tym samym obrazie (dHash ≤ 4 bity i zgodna próba pikselowa), tym samym wideo (ten sam plik po SHA-256 albo klatki CLIP ≥ 0,97 razem z tym samym dźwiękiem na całej długości), tym samym identyfikatorze reklamy, tym samym adresie strony z identycznym szablonem albo identycznej treści strony (SHA-256 zapisanego HTML). Sprawa, której wszystkie pliki (HAR, HTML, zrzuty, wideo) są już we wcześniejszej sprawie tej samej paczki z tym samym SHA-256, też jest duplikatem, nawet gdy tamta ma pliki dodatkowe. Ten sam tekst nie wystarcza, a to samo wideo z innym wstępem to wariant, nie duplikat. Duplikat dostaje kampanię oryginału.

**„Za mało danych”** (`insufficient`, w CSV pole `missing_data`) pojawia się, gdy materiał nie ma adresu, identyfikatora, co najmniej 5 słów treści ani powiązania ponad progiem. Wynik wymienia, co dorzucić (np. „zrzut z widocznym paskiem adresu”). Reklama z formularzem platformy (Lead Ads, napisy „Formularz”, „Wyślij”, „Instant Form” w tekście lub OCR) nie ma strony docelowej, więc zamiast linku dostaje prośbę o identyfikator z Biblioteki Reklam albo link do strony reklamodawcy i zrzut formularza. Lepiej odmówić oceny, niż zgadywać.

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

## 6a. Harmonogram skanów i „baza rośnie”

**Harmonogram.** `bun run watch` co cykl pyta publiczne źródła (logi CT, biblioteki reklam, urlscan, Listę Ostrzeżeń CERT) o nowe adresy i każdy przepuszcza przez tę samą analizę, co ręcznie zgłoszony materiał (rozdział 6); wynik trafia do `data/watch.jsonl`. Przepisy wyszukiwania opierają się na silnych cechach znanych kampanii (najemca platformy stron, adres IP spoza CDN, identyfikator ścieżki, skrót zasobu, para serwerów nazw, rejestrator, pora rejestracji), a potwierdzenie kandydata idzie po infrastrukturze, nie po tytule strony ani samej nazwie domeny: kandydat z CT staje się `confirmed` dopiero przy co najmniej dwóch rodzajach wspólnej infrastruktury (ta sama para NS, godzina rejestracji w oknie kampanii, ten sam adres IP, ten sam skrót treści). Wartość widoczna w jednej kampanii i w innej (domyślne serwery nazw rejestratora, wspólny hosting) nie jest cechą żadnej z nich i nie potwierdza. Lista Ostrzeżeń CERT jest używana tylko z obowiązkowym filtrem RDAP/NS (rejestrator, pora rejestracji, para NS): sam wzorzec nazwy daje setki fałszywych trafień. Źródło, którego nie da się zapytać (brak sieci, klucza, strumienia), zostawia w raporcie cyklu powód pominięcia. Wiersz `campaign` przy werdykcie innym niż `known_campaign` to najbliższa kampania z odcisku nazw (podpowiedź źródła), nie wynik analizy.

**Baza rośnie.** Analiza niczego nie dopisuje do bazy; robi to dopiero `--add-to-base` (CLI), `watch --add-to-base` (harmonogram, domyślnie tylko `known_campaign`) i przycisk w przeglądarce. Dopisujemy rekord i dane wzbogacone, których użyło porównanie, bez ponownego liczenia cech; graf i kampanie przebudowujemy offline. Duplikatu nie dopisujemy, „za mało danych” tylko wymuszone (`--force`), bo materiał, którego nie da się porównać, nie pomaga następnym. Kampanie zachowują numery: nowy klaster dostaje numer starej kampanii, z którą dzieli najwięcej rekordów, a klaster bez poprzednika nowy numer; dzięki temu sprawa, raport czy odnośnik „K07” nie zmieniają znaczenia po dopisaniu materiału. Przed zapisem poprzednie pliki bazy trafiają do `<baza>/historia/<czas>/`, każde dopisanie ma wpis w `<baza>/dodane.jsonl` (czas, źródło `cli`/`watch`/`gui`, identyfikator, werdykt w chwili dodania), a pliki są zastępowane przez zmianę nazwy pliku tymczasowego. Automatyczne dopisywanie z harmonogramu ma jedną wadę: błędnie przypisany materiał zostaje w bazie i wpływa na kolejne wyniki, więc `historia/` pozwala wrócić do stanu sprzed zmiany.

## 7. Niekompletne dane

- **Martwa strona**: gdy jest tylko zrzut z paskiem adresu, domena z paska staje się adresem; cechy pochodzą z nagranych odpowiedzi DNS/RDAP (lub z zapytań, jeśli włączono `--lookups`).
- **Sam zrzut** bez adresu: zostają obraz, tekst z OCR i identyfikator biblioteki reklam, jeśli jest widoczny. Przypisanie opiera się wtedy na kreacji, więc werdykt to zwykle wariant (niższa pewność) albo „za mało danych”.
- **Brak RDAP**: znika seria rejestracji i data utworzenia domeny; reszta cech działa.
- **Kroki pominięte** (brak narzędzia, modelu, sieci, pliku) mają w wyniku status `skipped` i powód (`steps` w JSON, `base.json` w bazie). Nigdy nie są pomijane po cichu.

### Strony niedostępne

Dla adresu, którego strona nie odpowiada (błąd sieci, NXDOMAIN, 4xx/5xx albo plansza blokady lub parkingu), z opcją `--archive` narzędzie szuka publicznej kopii. Kolejność źródeł: **materiał** (zapisana strona, HAR) → **pobranie na żywo** (tylko z `--live`) → **urlscan.io** (istniejące skany tej samej strony) → **Internet Archive** (Wayback). Kopia bez kodu strony (urlscan bez klucza: lista żądań i hashe zasobów) ustępuje kopii z kodem z kolejnego źródła. Krok jest pasywny: nic nie zleca ani nie zapisuje, a bez sieci jest pomijany z powodem.

Każda kopia w wyniku ma źródło (`urlscan`/`wayback`), adres kopii, czas kopii i czas zapytania, a jej cechy są oznaczone `bodySource`; treść z archiwum nigdy nie udaje strony pobranej na żywo (lista kompletności pokazuje „kopia archiwalna” jako ostrzeżenie). **Kopię sprzed rejestracji domeny odrzucamy**: domeny oszustw bywają rejestrowane ponownie, więc kopia starsza niż data rejestracji z RDAP (a bez niej niż najstarszy znany certyfikat z CT) to dawna treść innego właściciela i nie może łączyć kampanii. Odrzucamy też kopię starszą od pierwszego wystąpienia materiału o więcej niż `archiveMaxAgeDays` (domyślnie 30; `lib/osint/archive/config.ts`). Odrzucona kopia zostaje w danych materiału jako informacja z powodem, nie wchodzi do cech, a przy porównaniu z RDAP domena dostaje atrybut `reRegistered`. **Kopia archiwalna nie zmienia wagi dowodów**: zasila te same cechy co zapisana strona (kod strony → szablon, backendy, zasoby; lista żądań → zasoby i hosty jak z HAR) z tymi samymi wagami i regułami. Martwy adres bez kopii w żadnym źródle, bez treści i identyfikatorów, daje „za mało danych” z powodem „brak strony i brak kopii archiwalnej”.

Na dwóch materiałach z kopią w Wayback wynik z samej kopii miał te same rodzaje pivotów i ten sam werdykt co wynik z katalogu; kopia urlscan bez klucza traciła pivoty z kodu strony (zob. TECHNICAL §3.1a).

## 8. Cloaking

Metodą jest wyłącznie **wykrywanie pasywne po sygnaturach w zebranych danych**: analiza zapisanych stron i HAR pod kątem sygnatur skryptów cloakera w kodzie strony (cecha `cloakerInSource`) oraz tego samego adresu zapisanego z różną treścią (osobne zapisy `#capture`). Nie wysyłamy żadnych dodatkowych żądań.

Opcja `--cloaking` (dwa dodatkowe pobrania z różnymi User-Agentami: crawler platformy i przeglądarka mobilna) istnieje, ale jest **domyślnie wyłączona** i nie jest metodą. Gdy jedno z tych pobrań trafi na stronę wyzwania antybotowego (np. „Just a moment…”), wynik to „pobranie zablokowane przez ochronę przed botami”, a nie podejrzenie cloakingu. Test po User-Agencie nie dowodzi braku cloakingu po IP i geolokalizacji: różnica treści coś wskazuje, jej brak nic nie wyklucza.

## 9. Walidacja i ograniczenia

**Progi, reguła faviconu i lista person zostały dobrane na tych samych 25 sprawach próbki referencyjnej.** Wynik na tej próbce (po I14: precyzja i F1 par = 1,0, 14 kampanii, 2 grupy podobnych) pokazuje, że metoda jest spójna z naszym rozumieniem tych spraw, a nie że sprawdzi się na nowych. **Etykiety (które materiały należą do jednej kampanii) są nasze**: nie istnieją polskie zbiory z etykietami kampanii, z którymi dałoby się je porównać. Na danych syntetycznych wynik jest z założenia bliski 1,0: zbiór zaprojektowaliśmy sami.

### Walidacja na materiałach spoza próbki

Materiały: 212 stron oszustw zebranych z publicznych źródeł (głównie publiczne skany serwisu skanowania stron, dwie kopie z archiwum internetu, jeden artykuł prasowy); pochodzenie każdego materiału jest w `provenance.json` importu. Etykiety: 78 wariantów czterech znanych kampanii z próbki, 134 negatywy (105 materiałów innych operatorów z tą samą narracją lub osobą, 29 stron innych kont tej samej platformy stron). Baza: 25 spraw próbki, kod i wagi po zadaniu I14. Przebieg partii bez sieci, OCR i ASR.

- **(b) trafne odrzucenia negatywów: 134/134 (100%)**; żaden materiał innego operatora ani innego konta tej samej platformy nie trafił do znanej kampanii, żaden nie dostał też „podobnych kampanii”.
- (a) warianty znanych kampanii: 0/78 przypisanych do właściwej kampanii, 32/78 (41%) jako „podobne kampanie” z właściwą kampanią (łączy je jeden rodzaj dowodu: te same pliki strony), 46/78 bez wspólnego śladu z kampanią. Rozstrzygający ślad części rodzin (identyfikator kliknięcia trackera) jest w zebranych danych tylko w 2 z 39 materiałów jednej rodziny.
- (c) spójność nowych kampanii (rodziny innych operatorów, B-cubed): precyzja 0,971, czułość 0,331; 3 z 29 nowych kampanii łączą dwie rodziny (dwie podrodziny jednej strony na wspólnym hoście). Pary na całej partii: precyzja 0,993, czułość 0,126.
- (d) duplikaty: 0. (e) czas partii 212 materiałów: 0,8 s, szczyt pamięci ok. 330 MB.
- Pokrycie: w 5 z 12 prawdziwych kampanii z co najmniej dwoma materiałami narzędzie znalazło ≥ 50% członków w jednej kampanii, w 1 z 12 wszystkich.

**Po poprawkach metody (zadanie I10, punkt 4a), ta sama partia i etykiety:** (a) 34/78 (43,6%) wariantów w właściwej znanej kampanii, 11/78 tylko „podobne”, 0 w złej; (b) nadal 134/134, a negatywów z „podobnymi kampaniami” 0; (c) bez zmian; pary na całej partii: precyzja 0,997, czułość 0,272 (F1 0,224 → 0,427); pokrycie 6 z 12 kampanii. Na 25 sprawach próbki partycja i grupy bez zmian.

Wniosek: na tych danych metoda jest ostrożna (wysoka precyzja, niska czułość). Główne źródła rozbić to reguła „jeden rodzaj dowodu nie tworzy kampanii” przy stronach znanych tylko z listy żądań (bez kodu strony) i brak w publicznych skanach śladów z linku reklamy. **Zastrzeżenie:** etykiety rodzin nadano częściowo po tych samych śladach infrastruktury, których używa narzędzie, więc (a) jest optymistyczna; miarodajne są przede wszystkim (b) i (c). Policzysz to samo na własnych etykietach: `bun run evaluate -- --csv <partia.csv> --labels <etykiety.json>`.

### Odporność na niepełne zgłoszenia

Zgłoszenie może mieć tylko część plików (samo wideo z biblioteki reklam, zrzuty z telefonu bez HAR, HTML bez zrzutu reklamy). Zmierzyliśmy, jak wynik zmienia się, gdy sprawie brakuje plików. **Metoda:** z każdej z 25 spraw próbki robimy warianty z usuniętymi plikami (dowiązania, bez kopii): bez HAR, bez HTML, same zrzuty, samo wideo, wideo bez metadanych, bez reklamy (sama strona), sama reklama (bez strony); 111 wariantów. Każdy wariant porównujemy z bazą **bez jego sprawy** (leave-one-out, baza przebudowana bez rekordów tej sprawy, inaczej wariant trafiłby w samego siebie jako duplikat) i z wynikiem **oryginału** tej samej sprawy z tą samą bazą (oryginał też bywa omylny, więc wariantu nie porównujemy wprost z etykietą). Każdy wariant analizujemy osobno, bo w jednej partii warianty jednej sprawy uznawałyby się wzajemnie za duplikaty.

Metryki (liczby wariantów; „z parą” = sprawa ma w próbce sprawę tej samej kampanii; (a) liczone dla spraw, których oryginał miał przypisanie do znanej kampanii, pozostałe oznaczone „=”):

| wariant | z parą | (a) przypisanie utrzymane | (b) uczciwy brak | (c) fałszywe sklejenie | (d) ciche rozdzielenie | (e) wyjątek | = | bez pary: (c) |
|---|---|---|---|---|---|---|---|---|
| bez HAR | 13 | 9 | 2 | 0 | 0 | 0 | 2 | 0 z 7 |
| bez HTML | 15 | 11 | 2 | 0 | 0 | 0 | 2 | 0 z 8 |
| same zrzuty | 14 | 4 | 8 | 0 | 0 | 0 | 2 | 0 z 7 |
| samo wideo | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 z 2 |
| wideo bez metadanych | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 z 1 |
| bez reklamy (sama strona) | 14 | 12 | 0 | 0 | 0 | 0 | 2 | 0 z 8 |
| sama reklama (bez strony) | 14 | 4 | 8 | 0 | 0 | 0 | 2 | 0 z 8 |
| **razem** | 70 | 40 | 20 | 0 | 0 | 0 | 10 | 0 z 41 |

Wnioski: (c) i (d) nie wystąpiły: ubytek plików nie dołączył żadnego wariantu do cudzej kampanii (także spraw bez pary) i nie rozdzielił po cichu żadnej przypisanej sprawy; gdy narzędzie traci przypisanie, mówi o tym: 20 z 20 takich wariantów dostało „za mało danych”, „podobne kampanie” albo „nową kampanię” z listą braków w `missing_data`, a po poprawce z zadania I18 lista wymienia każdy faktyczny brak (HAR, strona, reklama; przed poprawką brak HAR przy zapisanej stronie i brak strony przy adresie z paska przeglądarki nie były zgłaszane). Wariant nie miał nigdy wyższej pewności niż oryginał. Zapisana strona (HTML albo HAR) wystarcza do przypisania (sama strona: 12 z 12), sam zrzut albo sama reklama bez strony zwykle nie (4 z 12; to sprawy, których zrzut jest kopią albo prawie identycznym wariantem zrzutu innej sprawy tej samej kampanii). Ślady, których usunięcie najczęściej kasowało przypisanie, to komentarze pod reklamą i konto platformy stron (z kodu strony), identyfikatory ścieżek, kampania platformy stron i szablon linku (z HAR i kodu strony), zasoby i domena (z HAR): o ich zrzut albo plik narzędzie powinno prosić zgłaszającego. Zastrzeżenie: 25 spraw, jedna baza, osiem spraw z jednej kampanii wśród spraw z parą; brak (c) i (d) w próbce nie dowodzi, że na innych danych ich nie będzie.

### Odporność wag

Wagi są ustalone ręcznie jako priorytety z researchu i nie są uczone na etykietach, bo etykiet jest za mało, a część z nich nadano po tych samych śladach, których używa narzędzie, więc uczenie dopasowałoby wagi do własnego odbicia. Zamiast tego sprawdzamy, czy wynik zależy od dokładnych liczb (`bun run sensitivity`, szczegóły w [TECHNICAL.md, §6.1](TECHNICAL.md#61-wrażliwość-wag-bun-run-sensitivity-od-22112026-zadanie-i27)); pomiar niczego nie stroi. Liczymy trzy rzeczy: (A) losowe zaburzenie wszystkich wag naraz o ±10, ±20 i ±30% (po 50 przebiegów) i rozrzut precyzji, czułości, F1 par, B-cubed i ARI oraz liczbę przebiegów z identycznym podziałem na kampanie i z nowym sklejeniem dwóch kampanii prawdy; (B) zmianę jednej wagi naraz o ×0,7 i ×1,3 z tabelą ΔF1 i liczby zmienionych par; (C) to samo dla progów osobno (×0,8 … ×1,2). Wagi i progi znajdowane są po nazwach pól konfiguracji, więc pomiar obejmie też wagi dodane później.

Na próbce syntetycznej (43 reklamy, 10 kampanii, F1 par bazowo 1,0) żaden z 150 przebiegów (A) i żaden z 134 wpisów tabel B i C (pojedyncza waga lub próg) nie zmieniła podziału na kampanie. Ta próbka ma wyraźnie rozdzielone kampanie, więc to dowód, że narzędzie działa, a nie że wagi są odporne na prawdziwych danych; liczby na danych referencyjnych: sekcja „Końcowy pomiar”.

### Ograniczenia znalezione w trakcie pracy

- **Tekst lub szablon strony sam nie łączy.** Szablony tekstów i stron krążą między operatorami.
- **Płatnik reklamy bywa ofiarą**: konto użyte bez wiedzy właściciela łączy niezwiązane kampanie (dlatego `ad_payer` ma 0,65 i jest tłumiony częstością).
- **Artefakty HAR analityka**: HAR zapisany z otwartymi DevTools albo „sanitized” zawiera lub pomija dane, których nie miał serwer; wspólny nagłówek analityka może wyglądać jak ślad operatora.
- **Strefa czasowa `first_seen`**: dane z różnych źródeł mogą podawać czas w różnych strefach (obraz Dockera ustawia `Europe/Warsaw`); przy zbiorze mieszanym kolejność materiałów i okna czasowe (np. seria rejestracji) mogą się przesunąć o godziny.
- **PID w identyfikatorze kliknięcia** to stała platformy, a nie operatora; liczy się maszyna (3 bajty), nie proces.
- **Nieoficjalny endpoint biblioteki reklam Mety** (przez MetaAdsCollector) może przestać działać po zmianie strony i jego użycie może naruszać regulamin serwisu.
- **Zależność od RDAP**: przy odpowiedzi tylko dla części domen seria rejestracji znika i część kampanii traci jeden z dowodów.
- **Seria rejestracji** to łańcuch: domeny zarejestrowane u tego samego rejestratora w odstępach ≤ 48 h łączą się przechodnio, więc długi łańcuch może objąć domeny odległe w czasie.
- **Twarze (`--faces`)**: zamknięta lista osób publicznych (`data/osoby-publiczne.json`; 127 osób na liście, z czego 31 ze zdjęciami (103 zdjęcia, po 1–5 na osobę, z Wikimedia Commons w `data/faces`); pozostałe są tylko personą z tekstu (pełne imię i nazwisko z odmianą, nigdy samo nazwisko). Dobór: osoby najczęściej podrabiane w polskich fałszywych reklamach według publicznych źródeł (zestawienie NASK z 12.07.2024 i artykuły fact-checkerów, CERT, prasy), tylko osoby ze źródłem, które wprost mówi o podszyciu się pod nią (jedyny wyjątek: wpis dodany decyzją właściciela, z adnotacją w polu `source`); lista jest zamknięta, każdy wpis ma `category` (grupa z zestawienia NASK, cecha grupy, nie dowód kampanii), wektory w `data/faces/index.json`). Wynik to „podobna twarz do X (0,xx)”, nigdy „to jest X”, i trafia do przeglądu człowieka. Dopasowanie tylko do osób z listy: twarz, która nikogo nie przypomina, zostaje ramką bez persony, a jej wektora nie zapisujemy (ani w `enriched.json`, ani w pamięci podręcznej, ani w paczce dowodów); wektory dopasowanych twarzy też nie trafiają do grafu ani eksportu (w wyniku jest ramka, identyfikator persony i podobieństwo). Persona z twarzy jest **cechą grupy podobnych kampanii** (ta sama osoba jako przynęta w wielu kampaniach różnych operatorów), nigdy dowodem, że dwa materiały są jedną kampanią. Waga dopasowania maleje z rozmiarem twarzy i wynikiem detektora (jakość twarzy, jak w MagFace). Próg 0,46 wybrano z pomiaru na zdjęciach 26 innych osób publicznych (0 fałszywych trafień na 54 twarzach, 96,7% trafień na parach tej samej osoby; zalecany dla SFace 0,363 dawał 9,3% fałszywych trafień): docs/TECHNICAL.md, „Persona z twarzy”. Nie budujemy bazy twarzy z sieci: zdjęcia referencyjne są wybrane ręcznie, ze źródłem, autorem i licencją ([data/faces/ZRODLA.md](../data/faces/ZRODLA.md)), a własne osoby dodaje instytucja (README, „Twarze”).
- **Głos osoby z listy (`--speaker`)**: galeria zamknięta, ta sama lista osób publicznych co dla twarzy (10 osób, `data/voices/index.json`: tylko wektory, po 5–8 polskich nagrań na osobę; źródła w [data/voices/ZRODLA.md](../data/voices/ZRODLA.md), nagrań nie ma w repozytorium ani w obrazie). Ścieżka jest cięta na okna po 4 s (krok 2 s); okna ciche i z samą muzyką (detekcja mowy SpeechBrain VAD) są odrzucane. Okno wskazuje osobę, gdy kosinus do jej wzorca (średnia z nagrań) jest ≥ 0,5 **i** wyprzedza drugą osobę o ≥ 0,15, a persona liczy się dopiero z co najmniej 2 sąsiednich okien (6 s). Wynik to „głos podobny do X (0,57)”, nigdy „to jest głos X”, do przeglądu człowieka. Jak twarz, persona z głosu jest **cechą grupy podobnych kampanii** (ta sama osoba jako przynęta u różnych operatorów), nigdy dowodem jednej kampanii. Pomiar (docs/TECHNICAL.md, „Persona z głosu”): ta sama osoba rozpoznana w 70 z 70 nagrań (leave-one-out), fałszywe trafienie na obcych 1 z 25 nagrań (4,0%; to jedno prawdopodobnie jest głosem Stanowskiego, więc 0/24 bez niego; cel ≤ 3,5% nie jest potwierdzony statystycznie przy 25 nagraniach), 5 z 5 fałszywek z publicznej kompilacji NASK nazwanych właściwą osobą. Model nie był trenowany na polskiej mowie, a reklamy mają inną akustykę niż wystąpienia z galerii, więc na reklamach trafień będzie mniej. **Detektor klonu głosu i ocena „czy to prawdziwy głos” są poza zakresem.**
- **Dane biometryczne głosu**: wektory głosu (SpeechBrain, 192 liczby) liczone tylko z `--speaker`, zapisywane wyłącznie w lokalnym `enriched.json` i w lokalnej pamięci podręcznej (TTL 28 dni, `.cache/speaker`); wektory okien używane do galerii nie są zapisywane nigdzie (w wyniku jest przedział, identyfikator persony i podobieństwo). Nie trafiają do `graph.json`, paczki dowodów ani eksportu CSV/JSON. Usunięcie: skasować `.cache/speaker` i pliki `enriched.json`.
- **Paczka dowodów** zawiera HAR i zapisane strony tylko jako kopie zredagowane z danych analityka (IP, odcisk przeglądarki, ciasteczka, nagłówki, tokeny Mety), z sumą oryginału w manifeście, i nie zawiera wektorów biometrycznych; narzędzie niczego nie zgłasza, a „uniknięta strata” i skala po poprawce na zgłaszalność to tylko pomysł na pitch, nie wynik paczki.
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

## 10b. Wiedza

Wynik narzędzia to nie tylko werdykty, ale i wiedza do dalszej pracy. [WZORCE-KAMPANII.md](WZORCE-KAMPANII.md) opisuje, jak zbudowane są kampanie (platformy stron, trackery z identyfikatorem kliknięcia, cloakery, bramki konwersji, usługi wielu klientów, lejek, fałszywe komentarze i sklep z aplikacjami, serie rejestracji, narracje) i przy każdym wzorcu mówi, czy to cecha operatora, czy platformy oraz jaki typ węzła i jaką wagę mu nadaje narzędzie. [ZRODLA-METADANYCH.md](ZRODLA-METADANYCH.md) ocenia źródła liczbami: ile powiązań dał każdy typ śladu (`bun run source-stats` na dowolnym `graph.json`), czy działa na martwych stronach, ile kosztuje i czego wymaga. Wzbogacony zbiór danych (wiersz na materiał, bez wektorów głosu i twarzy) daje `bun run export-dataset`, a graf dla Neo4j opcja `--neo4j`. Kontrakt dla systemów instytucji: [INTEGRACJA.md](INTEGRACJA.md). Etykieta „znany backend leadów” przy przesłance pochodzi z publicznych raportów (`data/znane-backendy-leadow.json`, ze źródłem) i nie zmienia wag ani reguł łączenia.

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

# Źródła metadanych: co daje powiązania, a co nie

Ocena oparta na liczbach: ile powiązań wewnątrz kampanii dał każdy rodzaj śladu, czy działa na martwej stronie, ile kosztuje i czego wymaga. Dokument opisuje **źródła**; reguły i wagi łączenia są w [METODYKA.md](METODYKA.md), a wzorce, które te źródła pokazują, w [WZORCE-KAMPANII.md](WZORCE-KAMPANII.md).

## 1. Jak liczymy

`bun run source-stats -- <graph.json>` (kod: `lib/pipeline/sourceStats.ts`) działa na dowolnym `graph.json`. Dla każdego typu śladu liczy:

- **powiązania**: ile par materiałów z jednej kampanii (kampanie o ≥ 2 materiałach) ma ten typ wśród dowodów; jedna para może mieć kilka typów, więc sum po typach nie wolno dodawać;
- **kampanie**: w ilu kampaniach choć jedna para ma ten typ;
- **jedyny dowód**: pary, w których to jedyny typ (zawsze 0 przy obecnej regule „dwa rodzaje dowodu”; kolumna pokaże zmianę, jeśli reguła się zmieni);
- **mocne**: pary, w których ślad jest dowodem silnym (łączącym samodzielnie).

Dwa przebiegi (liczby zagregowane, bez domen i identyfikatorów):

| przebieg | materiałów | kampanii ≥ 2 | powiązań w kampaniach | co było dostępne |
|---|---|---|---|---|
| A. 25 spraw (dane niepubliczne; materiały z HAR, stron, zrzutów) | 28 | 6 | 42 | zapisane strony i HAR, OCR, wyszukiwania DNS/RDAP/ASN |
| B. 212 materiałów publicznych (skany urlscan, kopie, prasa), `base --offline` | 212 | 29 | 426 | tylko zapisana lista żądań (HAR) i kopie stron; bez DNS, RDAP, CT, OCR zrzutów |

Trzeci przebieg to **walidacja I4**: 212 materiałów publicznych jako nowa partia wobec bazy 25 spraw (`analyze-material`). Powiązania nowych materiałów ze znanymi kampaniami: 46 (45 z regułą „jeden rodzaj dowodu”, 1 poniżej progu); typy na tych powiązaniach: wspólny zasób `asset` 38, rejestrator 8, serwery nazw 6, podobny tekst 1, adres IP 1 (para może mieć kilka typów). **Żadne z nich nie przeszło reguły kampanii**, więc partia nie dała przypisań do znanych kampanii (0/78 wariantów; 32 trafiły do „podobnych kampanii”): same zasoby i rejestrator to za mało, a ślad, który mógłby je podeprzeć (konto platformy, backend formularza), w tych materiałach nie pasował do bazy.

Przebieg B jest powtarzalny na materiałach publicznych (`bun run base -- --cases <katalog> --offline`, potem `source-stats`). Wynik walidacji metody na tym zbiorze (precyzja, czułość) jest w [METODYKA.md, punkt 12](METODYKA.md); tu liczy się tylko, **skąd** biorą się powiązania. Uwaga o interpretacji: zbiór B składa się z kopii z jednego rodzaju źródła (urlscan), więc ślady z HAR są w nim nadreprezentowane, a ślady z zapytań sieciowych w ogóle nie występują.

## 2. Ranking źródeł

Liczby: powiązania w przebiegu A / B. „–” = nie występuje w tym przebiegu (brak źródła, nie brak wartości).

| źródło | co daje | A / B | martwa strona | koszt, klucz, limit |
|---|---|---|---|---|
| Lista żądań HAR (także z urlscan) | zasoby, ścieżki z identyfikatorem konta platformy, hosty, adresy IP, trackery, parametry kliknięcia | zasób `asset` 2 / 352; identyfikator konta w ścieżce `path_id` 26 / 107; konto platformy 28 / 48 | tak: HAR zapisano, gdy strona żyła | bez klucza; to zapisany plik |
| Kod strony (HTML) | szablon, DOM, formularze i backendy, ukryte pola, komentarze, blok fałszywych komentarzy, trackery | podobny DOM 15 / –; komentarz 29 / –; backend formularza 1 / 1 | tak, jeśli kopia jest | bez klucza; kopia z archiwum (zob. niżej) |
| Zrzut z OCR i paskiem adresu | tekst reklamy, osoby, adres docelowy z paska przeglądarki, ID z biblioteki reklam | tekst podobny 2 / 1; persona 1 / – | tak (to obraz) | tesseract lokalnie, bez klucza |
| Obraz (hash, CLIP) | ten sam lub podobny obraz reklamy | hash obrazu 6 / –; podobny obraz 1 / – | tak | lokalnie; CLIP wymaga modelu |
| Nagranie: ASR, odcisk audio, głos | transkrypcja do podobieństwa tekstu, ten sam dźwięk, ten sam głos | nie wystąpiło w obu przebiegach (brak nagrań w próbce) | tak | lokalnie; ASR i głos wymagają modeli (domyślny obraz Dockera ich nie ma) |
| DNS | adresy IP, serwery nazw, cel CNAME | IP –/ 246 (z HAR); serwery nazw 4 / – | nie: martwa domena nie odpowiada | pasywne zapytania, bez klucza; opóźnienie |
| RDAP | rejestrator, data i minuta rejestracji, status (np. zawieszenie) | rejestrator 6 / – | tak, dla domen jeszcze zarejestrowanych | publiczny; limit serwera, czasem wolny |
| CT (crt.sh) | certyfikaty, subdomeny, historia certyfikatów | – / – | tak | publiczny; częste błędy 502; brak `entry_timestamp` |
| ASN | operator sieci adresu IP | 6 / 387 | tak | pasywne zapytanie; **słaby** pivot (wspólny hosting) |
| urlscan.io | publiczne skany z listą żądań, zrzutem i adresem po przekierowaniach | źródło zbioru B (212 materiałów) | tak: to kopia z czasu skanu | anonimowo okno 30 dni i limit zapytań na godzinę; klucz w ustawieniach konta (`URLSCAN_API_KEY`) daje JSON wyniku i DOM |
| Wayback (Internet Archive) | kopia strony sprzed zamknięcia | 2 kopie na 212 materiałów | tak (jedyne źródło dla starych stron) | publiczny; CDX wolny, zdarzają się 504; domeny oszustów prawie bez zapisów |
| Lista Ostrzeżeń CERT Polska | domeny zablokowane, data wpisu: wzorce nazw i serie rejestracji | uzupełnia generator nazw: `domain_pattern` – / 1 | tak | bez klucza; ok. 126 tys. wpisów od 21.05.2026 (stan 21.11.2026), bez treści stron |
| Biblioteki reklam | płatnik i beneficjent (DSA), zdjęcie reklamy z bazy Mety, powody zdjęcia, zasięg w UE | pivot `ad_payer`: nie wystąpił w A i B (opt-in) | tak | zob. sekcja „Biblioteki reklam” |
| Twarze (opcjonalnie, `--faces`) | osoba z zamkniętej listy rozpoznana na zrzucie | osoba z twarzy to cecha grupy podobnych kampanii, nie kampanii | tak | lokalnie, modele z licencją dopuszczającą użycie; próg i dane w TECHNICAL §4.14 |

Wnioski z liczb:

1. **Najwięcej powiązań dają ślady z zapisanej strony i listy żądań**, nie z zapytań sieciowych: identyfikator konta w ścieżce zasobów platformy, wspólne zasoby i szablon. Mają jedną zaletę ważniejszą od liczby: **działają na martwych stronach**.
2. **ASN i adres IP rozdają najwięcej powiązań (387 i 246 w B), ale mają niską wagę**: dzielą je różni klienci jednego hostingu. Ich liczba mówi o szerokości, nie o jakości; stąd rozdzielenie „liczba powiązań” od „mocne” w tabeli.
3. **Mocne dowody (kolumna „mocne”)** pochodzą z konta platformy (`platform_account`, `path_id`, `platform_campaign`) i z adresu z parametrami kampanii. To ślady, których zmiana kosztuje operatora najwięcej.
4. **RDAP, serwery nazw i rejestrator** są tanie i dają powiązania serii rejestracji (ta sama minuta, ta sama para NS), ale wymagają żywej domeny albo zapisanej odpowiedzi.
5. **Z badania w sieci o rodzeństwie kampanii** (stan 21.11.2026, kilkanaście rodzin): najwięcej dały urlscan oraz Lista Ostrzeżeń CERT razem z RDAP; Wayback, crt.sh, OpenPhish i URLhaus nic nie dały dla tych rodzin.

## 3. Źródła po kolei

### HAR i skany urlscan

Lista żądań przeglądarki to najbogatsze źródło dla stron, które już nie odpowiadają: pokazuje hosty, ścieżki zasobów (w tym identyfikator konta platformy stron), parametry kliknięcia i skrypty trackerów. Ograniczenie: sam HAR nie zawiera kodu strony, więc DOM, formularze i komentarze trzeba brać z kopii. Gdy kodu brak, narzędzie używa zasobów z listy żądań (bez tego 209 z 212 materiałów publicznych miało tylko url, domenę, host, adres IP i ASN).

### HTML i kod strony

Daje szablon (DOM), backendy formularzy, ukryte pola, nazwy funkcji i bloki fałszywych komentarzy. Poziom: to cechy kitu, czyli raczej **platformy lub zestawu stron** niż operatora (zob. „cecha operatora czy platformy” w dokumencie o wzorcach).

### Zrzut ekranu: OCR i pasek adresu

Zrzut z telefonu często zawiera adres w pasku przeglądarki. Narzędzie czyta go osobno (przed przycięciem do posta sponsorowanego) i prowadzi do skanu strony. OCR czyta też identyfikator z podglądu w bibliotece reklam. Bez tesseract krok jest pomijany z powodem w wyniku.

### Nagranie

Transkrypcja (ASR) dopasowuje scenariusz, odcisk audio (Chromaprint) ten sam dźwięk, a odcisk głosu tego samego lektora. Odcisk głosu jest daną biometryczną: nie trafia do eksportu zbioru (`export-dataset`), a w grafie służy tylko do porównania.

### DNS, RDAP, CT, ASN

Pasywne zapytania (`--lookups` albo `--live`). Nie działają na zamkniętej domenie (DNS), poza RDAP, który pamięta rejestrację. CT (crt.sh) pomaga przy seriach domen z jednego konta oraz historii subdomen trackerów, ale ma częste błędy serwera i nie podaje czasu wpisu (`entry_timestamp`), więc nie służy do ustalania „kto pierwszy”.

### urlscan.io

Najważniejsze źródło materiałów publicznych. Anonimowo: wyszukiwanie obejmuje ostatnie 30 dni, maksymalnie 100 wyników na zapytanie, ok. 100 zapytań na godzinę; zapytania `filename:` wymagają dokładnej ścieżki. Darmowe konto daje klucz API, dostęp do JSON wyniku i DOM (a w nim identyfikatory konta platformy i piksele), dłuższą historię i wyższe limity. **To najbardziej opłacalne konto do zdobycia.**

### Wayback i inne kopie

Przydatne do starszych stron i do rozstrzygania, czy domena była kiedyś inną stroną (kopia sprzed rejestracji domeny jest odrzucana). Domeny oszustów mają w nim zwykle tylko odpowiedzi błędów. Kopia wchodzi do materiału z adresem, datą i źródłem.

### Lista Ostrzeżeń CERT Polska

Publiczny JSON z domenami zablokowanymi (adres w sekcji 6). Nie ma treści stron, ale ma **datę wpisu** i całe serie nazw, więc służy do zasilania wzorca nazw domen i monitoringu serii rejestracji.

### Biblioteki reklam

Biblioteka reklam Mety zwraca dla reklam z UE płatnika i beneficjenta (DSA), zasięg i powód zdjęcia reklamy. Dostęp: opcjonalny krok `--ad-library` (MetaAdsCollector, instalowany osobno); oficjalne Ad Library API wymaga tokenu i weryfikacji tożsamości, ale daje wyszukiwanie po stronie, haśle i kraju z datami emisji (dla UE także reklamy niepolityczne): **warto zdobyć**. Bez dostępu zostaje identyfikator reklamy odczytany ze zrzutu i link do biblioteki (kolumna `ad_library_url` w eksporcie zbioru). Rejestr bibliotek (dostęp, warunki, koszt zapytań): sekcja 8.

### Twarze

Rozpoznanie osoby z zamkniętej listy na zrzucie (próg i błędy: [TECHNICAL.md](TECHNICAL.md) §4.14). Wynik wchodzi do grafu jako persona, ale tylko na poziomie grupy podobnych kampanii: ta sama osoba w dwóch reklamach nie czyni z nich jednej kampanii.

## 4. Konta warte zdobycia

| konto | po co | co zmienia |
|---|---|---|
| urlscan.io (darmowe) | JSON wyniku, DOM, dłuższa historia, wyższe limity | DOM ujawnia identyfikator właściciela platformy stron, piksele i tokeny, których lista żądań nie pokazuje |
| Ad Library API Mety (token, weryfikacja tożsamości) | wyszukiwanie po stronie, haśle i kraju; daty emisji | zamiast czekać na zrzut od zgłaszającego, narzędzie samo znajduje kopie reklamy |
| Google Cloud (BigQuery) | zbiór Google Ads Transparency | opcjonalnie; w praktyce niska wartość (zob. sekcja 5) |

## 5. Źródła bez wyniku dla tych kampanii (nie warto powtarzać bez nowej przesłanki)

| źródło | wynik | powód |
|---|---|---|
| OpenPhish (feed) | 0 | tylko bieżący phishing logowania, nie reklamy |
| URLhaus | brak danych | pobieranie wymaga klucza; zbiór dotyczy malware |
| Lista ostrzeżeń KNF | brak danych | strona dynamiczna: lista jako HTML bez dat |
| DSA Transparency Database | 0 | uzasadnienia moderacji nie zawierają nazw ani domen |
| IOSCO I-SCAN | 0 | bez wyniku w badaniu |
| KADhosts (lista hostów) | 0 | bez wyniku w badaniu |
| Google Ads Transparency Center | brak kreacji | działa bez logowania, ale reklamy zawieszonych reklamodawców znikają; BigQuery obejmuje tylko EOG i Turcję |
| crt.sh | mało | bez `entry_timestamp`; częste błędy; pomaga tylko w seriach i historii subdomen |
| TikTok Ad Library, PhishTank | nie sprawdzono | do decyzji |

## 6. Publiczna dokumentacja, na której oparto rozpoznawanie

Dostęp do wszystkich adresów: 2026-11-21 (treść czytana jako tekst; część stron zwracała błąd 403 dla zautomatyzowanych zapytań, wtedy opieramy się wyłącznie na wynikach wyszukiwarki i oznaczamy to).

**Platforma stron i trackera z edytorem landerów (AIO).**
- Strona produktu i dokumentacja: <https://aio.tech/features>, <https://aio.tech/docs/create-sources/>, <https://aio.tech/docs/default-query/>, <https://aio.tech/docs/sdk-form/>.
- Parametry w adresie: `cuuid` (identyfikator kampanii u platformy), `suuid` (źródło), `launcher` (uruchomienie z platformy). Skrypt platformy `aio-static/sdk/main.js` ładuje się z domeny strony; zasoby landerów leżą pod ścieżką z identyfikatorem najemcy (`landing-cdn/<najemca>/<lander>/`). Narzędzie czyta ścieżkę jako identyfikator konta (`path_id`, `platform_account`), nie sam skrypt SDK.

**Bramki konwersji Mety (Conversions API Gateway).**
- Architektura bramek: <https://developers.facebook.com/documentation/ads-commerce/gateway-products/gateway-gcp/architecture>, <https://developers.facebook.com/documentation/ads-commerce/gateway-products/gateway-aws-ecs-express/architecture>.
- Instancja bramki to zwykła usługa chmurowa (z domyślną domeną nadaną przez dostawcę chmury) z zarządzaniem wieloma najemcami, więc **ta sama bramka widoczna w konfiguracji dwóch pikseli nie łączy operatorów**: obsługuje wielu reklamodawców, także legalnych. Narzędzie dyskontuje wspólny host takiej bramki do zera.

**Keitaro i podobne systemy TDS.**
- Alias kampanii: <https://docs.keitaro.io/en/campaigns/campaigns.html>; nadużycia: <https://www.infoblox.com/blog/threat-intelligence/inside-keitaro-abuse-a-persistent-stream-of-ai-driven-investment-scams/> i <https://blog.confiant.com/p/tracking-software-weaponized-by-criminals>.
- Żaden z tych raportów nie podaje ścieżek ani parametrów pozwalających rozpoznać instancję z zewnątrz; ślady, które narzędzie czyta, pochodzą z własnych obserwacji i są opisane w dokumencie o wzorcach.

**Biblioteka reklam Mety (API i słownik danych).**
- <https://developers.facebook.com/docs/graph-api/reference/ads_archive/>, <https://developers.facebook.com/docs/content-library-and-api/get-access>, <https://developers.facebook.com/docs/graph-api/reference/beneficiary-payer>.

**Lista Ostrzeżeń CERT Polska.** <https://cert.pl/lista-ostrzezen/>, dane: <https://hole.cert.pl/domains/v2/>.

## 7. Czego te liczby nie mówią

- Liczba powiązań nie jest jakością: ASN dał ich najwięcej i jest najsłabszym dowodem.
- Przebieg A ma tylko 6 kampanii o ≥ 2 materiałach, więc różnice między typami o 1–3 powiązania są w granicach szumu; wnioski opieramy na przebiegu B i na zgodności obu.
- Przebieg B nie zawiera zapytań sieciowych ani zrzutów, więc **brak RDAP, CT, DNS i obrazu w nim to brak źródła, nie dowód bezużyteczności**. Wartość RDAP i serwerów nazw widać w przebiegu A.
- Precyzję i czułość metody podaje [METODYKA.md, punkt 12](METODYKA.md); tu tylko pochodzenie powiązań.

## 8. Biblioteki reklam: dostęp, warunki, koszt

Każde źródło jest opcjonalne i domyślnie wyłączone: bez poświadczeń albo narzędzia wpisuje w wyniku powód pominięcia i instrukcję uzyskania dostępu.

Wspólny interfejs: `lib/adlib/` (typy `AdRecord`, `AdLibrarySource`; adaptery `meta.ts`, `google.ts`; CLI `bun run adlib`). Opis dla użytkownika: [README.md](JURY.md#biblioteki-reklam-jak-uzyskać-dostęp), opis techniczny: [TECHNICAL.md §3.11](TECHNICAL.md). Stan: 22.11.2026.

**Żadna z bibliotek nie daje obietnicy trafień.** Wyszukiwanie w Google Ads Transparency nie dało materiałów dla rodzin kampanii z próbki; adapter jest wartością samą w sobie (nowe materiały do sprawdzenia, rozszerzanie kampanii po reklamodawcy), nie sposobem na znalezienie znanej kampanii.

| Biblioteka | Adres | Dostęp | Warunki i ograniczenia | Sprawdzone |
|---|---|---|---|---|
| **Meta Ad Library** | https://www.facebook.com/ads/library/ | bez klucza przez MetaAdsCollector (MIT, nieoficjalny publiczny endpoint strony): wyszukiwanie po frazie, stronie, kraju i dacie oraz dane DSA po identyfikatorze (płatnik, beneficjent, zasięg w UE); oficjalne API wymaga weryfikacji tożsamości i tokenu (nieużywane w kodzie) | automatyczne odpytywanie strony może naruszać regulamin Mety; endpoint zmienia się bez zapowiedzi; jedno żądanie na sekundę; wyszukiwanie wymaga sieci | 22.11.2026: kod MetaAdsCollector 1.7.2 przeczytany lokalnie (pola `Ad`, `search`); zapytań do Mety nie wysyłano |
| **Google Ads Transparency Center** | https://adstransparency.google.com/; zbiór `bigquery-public-data.google_ads_transparency_center` (tabele `creative_stats`, `removed_creative_stats`) | brak oficjalnego API i bez scrapingu; publiczny zbiór BigQuery (EOG i Turcja); wymaga konta Google z projektem w sandboxie BigQuery (`gcloud auth application-default login`; bez ADC działa CLI `bq`) | zapytania liczone za przetworzone kolumny: sandbox 1 TiB miesięcznie; zbiór nie ma domeny docelowej ani tekstu reklamy, tylko adres strony reklamy w Transparency Center; `removed_creative_stats` nie ma reklamodawcy; warunki zbioru: strona zbioru w BigQuery i Google Cloud Terms (nie analizowane w tym zadaniu) | 22.11.2026: `bq show` (schemat), `bq query --dry_run` (rozmiary kolumn, bez kosztu); prawdziwych zapytań nie uruchamiano |
| **TikTok Commercial Content Library** | https://developers.tiktok.com/ | API na wniosek (odpowiedź do 2 dni roboczych, według opisu zadania możliwe tylko dla badaczy); po przyznaniu `TIKTOK_CLIENT_KEY` i `TIKTOK_CLIENT_SECRET`; adapter `lib/adlib/tiktok.ts` (token klienta, zapytanie z filtrami kraj, reklamodawca, daty, fraza) | warunki programu dla badaczy (nieczytane); **adres punktów końcowych i pola odpowiedzi z publicznych opisów, nie sprawdzone na żywo**; testy na syntetycznych odpowiedziach | niesprawdzone: w tym zadaniu sieć wolno było użyć tylko do stron X; informacje z opisu zadania |
| **X (repozytorium reklam DSA)** | strona pomocy: https://help.x.com/en/business-and-advertising/ads-transparency (strona zwróciła HTTP 403 przy automatycznym pobraniu, więc jej treści nie czytano) | według wyników wyszukiwania (22.11.2026): „Ads Repository”, uruchomione w 2023 jako centrum przejrzystości DSA; zapytanie po koncie, kraju i zakresie dat w interfejsie albo przez API, wynik to plik CSV (lista: reklamodawca, podmiot finansujący, główne parametry targetowania, wyświetlenia, zasięg, także reklamy zatrzymane; treść reklamy według analizy Mozilli tylko jako adres). **Adapter: import pobranego pliku CSV** (`X_ADS_FILE` albo `--x-file`, `lib/adlib/x.ts`); program niczego nie pobiera z X | tylko reklamy wyświetlane w UE; krytyka działania API i pustych plików CSV (Mozilla Foundation, grupa badawcza UFRJ); Komisja Europejska nałożyła na X karę (grudzień 2025) m.in. za przejrzystość repozytorium i przyjęła plan naprawczy (lipiec 2026) obejmujący dostęp przez API; nazwy kolumn eksportu nie sprawdzono, import dopasowuje je luźno (kilka pisowni na pole) | 22.11.2026: tylko wyszukiwanie (snippety wyników) i próba odczytu strony pomocy X (403); warunków serwisu X nie czytano |

### Google: wyszukiwanie po domenie przez publiczne RPC (B-063, nieoficjalne, domyślnie wyłączone)

Zbiór BigQuery nie ma domeny docelowej, więc wyszukiwanie po domenie jest możliwe tylko przez publiczne RPC strony Transparency Center (`SearchService/SearchCreatives`, `SearchSuggestions`, `https://adstransparency.google.com/anji/_/rpc/…`), bez logowania. Moduł: `lib/adlib/googleRpc.ts`; włączenie: `ADLIB_GOOGLE_RPC=1`; kraj `PL` = kod regionu 2616. **Ryzyka:** usługa jest przeznaczona dla strony, nie dla programów, więc automatyczne odpytywanie może naruszać warunki serwisu Google; format żądania i odpowiedzi może się zmienić albo zostać zablokowany bez zapowiedzi; **format zapisano z publicznych opisów klienta webowego i w tej wersji nie został sprawdzony na żywo** (testy używają syntetycznych odpowiedzi w tym kształcie). Odpowiedź nie niesie pełnego adresu docelowego, więc `landingUrl` rekordu to szukana domena. Rozszerzanie kampanii: `bun run adlib -- expand --campaign <id>` szuka po domenach kampanii (RPC) i po kontach reklamodawców z bibliotek reklam.

### Meta: zapasowe źródła (B-068)

Adapter Mety stoi na MetaAdsCollector (MIT). Zapasowe źródła na wypadek zmiany strony biblioteki, **bez kodu w tej wersji**: [athm793/meta-ads-scraper](https://github.com/athm793/meta-ads-scraper) (Apache-2.0 według opisu zadania; drugi scraper bez klucza, do wyboru konfiguracją po dopisaniu adaptera, który zwróci `AdRecord`; narzędzia nie instalowano i jego wyjścia nie sprawdzano) oraz [facebookresearch/Ad-Library-API-Script-Repository](https://github.com/facebookresearch/Ad-Library-API-Script-Repository) (licencja NOASSERTION): tylko jako wzór nazw pól oficjalnego API (`ad_delivery_start_time`, `ad_creation_time`, `page_id`, `page_name`, `bylines`), bez kopiowania kodu.

### Google: koszt zapytań (pomiar 22.11.2026, `bq query --dry_run`)

BigQuery liczy całe kolumny, nie wiersze, więc o koszcie decyduje lista kolumn, nie filtr. Rozmiary kolumn `creative_stats` (GB = 10⁹ bajtów): `advertiser_id` 3,9; `creative_id` 3,9; `creative_page_url` 16,8; `ad_format_type` 1,0; `advertiser_disclosed_name` 3,8; `advertiser_legal_name` 3,8; `advertiser_location` 0,7; `advertiser_verification_status` 1,7; `ad_funded_by` 0,8; `topic` 3,1; `region_code` 2,3; `first_shown` i `last_shown` po 6,3. Adres strony reklamy adapter składa z dwóch identyfikatorów zamiast czytać `creative_page_url`.

Poziomy szczegółowości (skrypt `scripts/py/google_atc.py` bierze najbogatszy, który mieści się w limicie `ADLIB_BQ_MAX_BYTES`, domyślnie 10 GiB):

| Poziom | Kolumny | Szacunek dla wszystkich reklam jednego `advertiser_id` |
|---|---|---|
| `lean` | identyfikatory, format, kraj reklamodawcy, `ad_funded_by` | 10,4 GB (9,7 GiB) |
| `identity` | + nazwa wyświetlana, nazwa prawna, status weryfikacji | 19,7 GB |
| `regions` | + regiony emisji | 21,9 GB |
| `dates` | + daty pierwszej i ostatniej emisji | 34,5 GB |

Przy domyślnym limicie rekord ma więc identyfikator reklamodawcy, kraj i płatnika, ale bez nazwy prawnej i statusu weryfikacji; żeby je dostać, ustaw `ADLIB_BQ_MAX_BYTES=20GB`. Wyszukiwanie po nazwie reklamodawcy albo frazie wymaga kolumn z nazwami (ok. 18 GB przy poziomie `lean`); zapytanie ponad limit kończy się komunikatem z szacunkiem, bez wykonania.

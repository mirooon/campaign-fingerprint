# Wzorce kampanii oszustw reklamowych (wersja ogólna)

Jak zbudowane są kampanie z wizerunkami znanych osób, co w nich jest cechą **operatora** (osoby lub grupy, która kampanię prowadzi), a co cechą **platformy** (narzędzia, które wynajmuje wielu klientów), i jak narzędzie każdy wzorzec rozpoznaje. Dokument jest ogólny: bez wartości z materiałów niepublicznych. Przykłady pochodzą wyłącznie z materiałów publicznych (skany urlscan, stan na 2026-11-21), z adresem źródła i datą; adresy skanów oglądamy jako tekst. Źródła metadanych i ich skuteczność: [ZRODLA-METADANYCH.md](ZRODLA-METADANYCH.md); reguły i wagi: [METODYKA.md](METODYKA.md).

**Dlaczego ta różnica jest najważniejsza.** Dwie reklamy na tej samej platformie stron albo za tą samą bramką konwersji nie są jedną kampanią: platformę wynajmuje wiele niepowiązanych kont. Błąd w tę stronę (sklejenie „bo ta sama platforma”) jest groźniejszy niż rozbicie kampanii, bo nakłada zgłoszenia na niewinnych albo na innych operatorów. Narzędzie dlatego traktuje ślad platformy jako dowód **grupy podobnych kampanii**, a nie kampanii (reguły: `campaignRules` w `lib/graph/config.ts`).

Skala w tabelach niżej: „waga” to waga typu węzła z `typeWeights` (0–1), „poziom” mówi, do czego ślad wystarcza: *kampania* (może łączyć materiały w jedną kampanię), *rodzina* (tylko grupa podobnych kampanii), *atrybut* (opis do oceny, nie łączy).

## 1. Platformy stron: konta i kampanie

**Wzorzec.** Gotowa platforma łączy tracker, edytor landerów, makra zdarzeń i zarządzanie zespołem. Lander (strona lądowania) jest wgrywany na konto najemcy i serwowany z jednego magazynu plików platformy. Skutek dla analizy:

- zasoby strony leżą pod ścieżką z **identyfikatorem najemcy** i identyfikatorem landera (`…/<najemca>/<lander>/…`): lista żądań przeglądarki ujawnia konto bez logowania i bez DOM;
- ten sam skrypt SDK platformy (`…/sdk/main.js`) ładuje się na stronach **wszystkich** najemców, więc sam skrypt nie łączy niczego;
- w parametrach adresu pojawiają się identyfikatory kampanii i źródła u platformy (`cuuid`, `suuid`, `launcher`);
- istnieje **wspólna biblioteka landerów** (w obserwowanych skanach pod nazwą „666”), z której korzysta wiele kont: ścieżka z identyfikatorem biblioteki łączy tylko z platformą, nie z kontem.

**Przykłady publiczne.** Skan strony z SDK platformy i najemcą innym niż w obserwowanych rodzinach: <https://urlscan.io/result/01a1746b-b50c-738a-8a90-011a466f8d34/> (2026-10-25). Skan z zasobami z biblioteki landerów „666” i żądaniem do hosta skryptu maskującego: <https://urlscan.io/result/01a178af-5a35-724d-890a-b67be44a3b38/> (2026-10-26). W wyszukiwaniu po ścieżce skryptu SDK z 30 dni (stan 21.11.2026) było ok. 320 skanów, z czego ok. 260 to strony „platforma tradingowa AI” w ok. 20 językach i kilkunastu różnych kontach: to zbiór **negatywny** (ta sama platforma, inni operatorzy) i narzędzie go tak traktuje.

**Jak rozpoznaje narzędzie.**

| ślad | typ węzła | waga | poziom | uwaga |
|---|---|---|---|---|
| identyfikator najemcy w ścieżce zasobów | `path_id` | 0,85 | kampania, ale ustępuje konfliktowi kont | UUID biblioteki wspólnej nie nazywa konta (`accountConflictOverStrongKinds`) |
| konto platformy (najemca z DOM, listy żądań albo adresu) | `platform_account` | 0,9 | kampania | różne konta na jednej platformie **nigdy** nie sklejają się słabszymi dowodami (`accountConflict`) |
| kampania na platformie (`cuuid` i podobne) | `platform_campaign` | 0,95 | kampania | |
| szablon strony platformy | `page_template` | 0,35 | rodzina (nie samodzielnie) | cecha platformy |
| skrypt SDK | wchodzi do szablonu | – | atrybut | ładuje się u wszystkich najemców |

**Czyja cecha:** konto i kampania na platformie są cechą **operatora** (kto płaci za konto); skrypt, biblioteka landerów i szablon są cechą **platformy**.

**Hipoteza do sprawdzenia (nie ustalenie).** Infoblox opisuje „aktora” rozpoznawanego po ścieżce `/api/v1/trigger/field/` w żądaniach strony. Taka ścieżka należy, według naszych obserwacji, do telemetrii SDK platformy stron, a więc może być śladem **najemcy wspólnej platformy**, a nie jednego aktora. Do sprawdzenia: czy ścieżka występuje u najemców z różnymi kontami reklamowymi i różnymi płatnikami w bibliotece reklam. Do czasu sprawdzenia nie wolno jej używać do łączenia.

## 2. Trackery z identyfikatorem kliknięcia (typ xid)

**Wzorzec.** Tracker reklamowy przypisuje każdemu kliknięciu identyfikator w formacie **xid** (20 znaków base32hex: 4 bajty czasu, 3 bajty identyfikatora maszyny, 2 bajty PID, 3 bajty licznika). Wynika z tego:

- **maszyna** (3 bajty) rozróżnia instancje trackera: ten sam identyfikator maszyny w kliknięciach z różnych stron to ten sam serwer trackera;
- **czas** w identyfikatorze to chwila kliknięcia, więc daje oś czasu bez dostępu do reklamy;
- **PID** bywa stały dla instalacji (np. gdy tracker działa w kontenerze), więc nie odróżnia instancji; liczy się maszyna;
- linki kampanii mają stały format (np. `/click?key=<32 znaki hex>`), skrypt zdarzeń leży pod stałą ścieżką (`/include/events-stat.js`), landery pod `/landers/<uuid>/`, a zdarzenia idą na subdomenę trackera przy domenie operatora.

**Przykłady publiczne.** Skan z identyfikatorem kliknięcia, skryptem zdarzeń i układem landerów typowym dla trackera tego typu: <https://urlscan.io/result/01a1647a-bffd-7365-b630-f60ed156279e/> (2026-10-22); skan z identyfikatorem kliknięcia innej maszyny: <https://urlscan.io/result/01a1e265-bbff-74ed-a686-175829759c29/> (2026-11-16).

| ślad | typ węzła | waga | poziom |
|---|---|---|---|
| serwer trackera z identyfikatora kliknięcia (maszyna) | `click_server` | 0,6 | kampania (z drugim rodzajem dowodu) |
| schemat linku śledzącego (`/click?key=`, nazwy parametrów) | `param_schema` | 0,12 | atrybut / rodzina |
| parametry kampanii w adresie | `campaign_param` | 0,8 | kampania |

**Czyja cecha:** identyfikator maszyny i konto trackera to cecha **operatora**; format linku i nazwa skryptu to cecha **produktu** (tracker).

## 3. Keitaro i inne trackery TDS (alias kampanii)

**Wzorzec (literatura).** Keitaro to tracker i system rozdzielania ruchu (TDS), który instaluje się samodzielnie w kilka minut. Adres kampanii to domena plus krótki alias; kampania może być „zaparkowana” na stronie głównej. Przestępcy używają go do **bramkowania**: oszustwo widzi tylko ofiara z właściwego kraju, urządzenia i parametrami z płatnej reklamy; reszta (w tym skaner) widzi białą stronę. Infoblox i Confiant (2026) opisują ok. 15,5 tys. domen w czterech miesiącach od 1.10.2025, z czego ok. 9 tys. zarejestrowano przed użyciem; po zgłoszeniu ponad 100 domen producent zamknął kilkanaście kont i wyłączył integracje z cloakerami, ale nielicencjonowane kopie działały dalej (adresy w sekcji 14).

**Co widać z zewnątrz.** Aliasy o stałej długości (np. 8 znaków) w ścieżce, parametr `_subid`, ciasteczka `_token`. Żaden z przejrzanych raportów nie podaje ścieżek ani nagłówków, po których da się rozpoznać instancję, więc narzędzie nie ma osobnego typu węzła dla Keitaro: ślad wchodzi jako schemat linku i parametry kampanii.

**Czyja cecha:** **produktu**; ten sam alias w dwóch domenach nie dowodzi jednego operatora.

## 4. Cloakery

**Wzorzec.** Skrypt (często usługa wielu klientów) sprawdza odwiedzającego i pokazuje stronę lub biel. Z zewnątrz widać różnicę treści między profilami (crawler kontra telefon z polskim adresem) oraz żądanie do hosta skryptu. Jedna z obserwowanych usług (nazwa handlowa usługi widoczna w konfiguracji strony; tu ją pomijamy) nie ma publicznych wyników w wyszukiwarce; obserwowalny ślad to żądanie do hosta „delivered” z błędem adresu względnego.

**Jak rozpoznaje narzędzie.** Opcjonalny test cloakingu (dwa dodatkowe pobrania strony: UA crawlera i UA mobilny) zapisuje, czy adres końcowy i DOM się różnią (`cloakingSuspected` w atrybutach kampanii). To **atrybut**, nie łącznik. Host skryptu cloakera należy do usług wielu klientów (sekcja 6) i nie łączy.

## 5. Bramki konwersji (Conversions API Gateway)

**Wzorzec.** Meta oferuje gotowe bramki do serwerowego wysyłania zdarzeń konwersji, uruchamiane jako usługa w chmurze reklamodawcy lub agencji, z obsługą wielu najemców. W konfiguracji piksela strona wskazuje adres bramki i adres zapasowy. Skutek: **ten sam host bramki** pojawia się w konfiguracjach pikseli niepowiązanych podmiotów, także legalnych sklepów (w obserwacjach: od ok. 200 do kilku tysięcy skanów legalnych stron na bramkę).

**Jak rozpoznaje narzędzie.** Piksel i token CAPI (jeśli widoczny) to cecha operatora (właściciel piksela). Host bramki jest dyskontowany do zera, bo jest wielodostępny; wspólny adres zapasowy bramki między dwiema niepowiązanymi kampaniami nie ma wartości dowodowej. Dokumentacja architektury: w sekcji 14.

## 6. Usługi wielu klientów

**Wzorzec.** Część infrastruktury kampanii to usługi używane przez wielu klientów z różnych branż: backendy formularzy i walidatory leadów, usługi antyfraudowe i cloakingowe, hosting obrazów, generatory stron AI, platformy edge (Pages, Workers), CDN skryptów. Przykład publiczny: skrypt usługi antyfraudowej obecny w kilkudziesięciu skanach różnych kampanii (kasyna, strony prasowe, rozrywka dla dorosłych): <https://urlscan.io/result/01a1fd4f-6403-768d-990a-b297370f8208/> (2026-11-21).

**Jak rozpoznaje narzędzie.** Lista hostów usług wielu klientów zmniejsza wagę wspólnego hosta (reguły dyskontowe w `lib/graph/config.ts`, zasada „wspólny CDN nie łączy, bo dzielą go różni operatorzy”). Jeżeli usługa wystawia identyfikator klienta w adresie (klucz konta w parametrze), to **klucz** może łączyć, a host nie. Backend leadów zwykle obsługuje setki domen i jest silnym pivotem kampanii, jeśli jest **własny** operatora, a słabym, jeśli to usługa komercyjna: rozróżnia to lista znanych usług z podanym źródłem.

## 7. Hosting wideo

**Wzorzec.** Wideo reklamy lub landera leży na hostingu strumieniowym (biblioteki wideo z identyfikatorem biblioteki w nazwie hosta, albo własne serwery HLS ze ścieżką `/videos/<id>/output.m3u8`). Identyfikator biblioteki wideo jest stały dla klienta usługi, więc **ten sam identyfikator** w dwóch kampaniach to wspólny klient; nazwa hosta z powtórzonymi literami to nawyk nazewniczy operatora, nie dowód.

**Jak rozpoznaje narzędzie.** Zasób wideo jest zasobem strony (`asset`, 0,55, nie samodzielnie); ten sam plik wideo (SHA-256) to dowód treści (`similar_*`), a identyfikator biblioteki wideo to atrybut.

## 8. Lejek: prelander, lander, zamówienie za pobraniem

**Wzorzec.** Reklama prowadzi do strony, która nie zawsze zbiera dane. Rola strony w lejku:

| rola | cechy | formularz |
|---|---|---|
| prelander (klon medium) | suwak kalkulatora zysków, dowody wypłat (zrzuty banków), prawie wszystkie linki do jednego celu, CTA „przejdź na oficjalną stronę”, martwa nawigacja klonu | zwykle brak |
| artykuł z rejestracją | formularz w treści, CTA „zarejestruj” | tak (kilka pól) |
| strona produktu za pobraniem (zdrowie) | CTA „zamów”, formularz imię + telefon, skrypt PHP zamówienia | 1–4 pola |
| fałszywy sklep z aplikacjami | zob. sekcja 10 | przycisk |

W obserwowanej próbce nie było bramki płatniczej: pieniądze idą poza stroną (płatność za pobraniem albo telefon „opiekuna konta” po zostawieniu danych). Brak formularza **nie wyklucza** oszustwa, ale jest cechą prelandera; reguła to „rola strony”, nie „artykuł = bez formularza”.

**Jak rozpoznaje narzędzie.** Rola, liczba formularzy i udział linków do jednego celu są atrybutami strony (widocznymi w GUI); nie łączą. Backend zamówienia (`endpoint`, 0,95, nie samodzielnie) i ukryte pola (`hidden_fields`, 0,6, nie samodzielnie) łączą w parze z innym rodzajem dowodu. Cecha **operatora czy platformy:** formularz i backend zwykle operatora lub sieci afiliacyjnej; szablon strony zamówienia to często produkt sieci afiliacyjnej, więc dotyczy grupy.

## 9. Fałszywe komentarze i posty

**Wzorzec.** Pod artykułem „Najnowsze komentarze” i osadzone „posty” z mediów społecznościowych to statyczny HTML albo skrypt, nie wtyczki platform. Rozpoznanie bez wychodzenia do sieci:

1. brak prawdziwej wtyczki komentarzy (iframe platformy, skrypt z jej domeny); klasy CSS udające wygląd to nie wtyczka;
2. komentarze wpisane na sztywno, często z notatkami autora strony w komentarzach HTML (scenariusz: sceptyk, a pod nim odpowiedź z „dowodem” wypłaty);
3. czas względny („2 godz. temu”) wpisany albo liczony od bieżącej daty, więc komentarz jest zawsze świeży;
4. martwe przyciski „lubię to” i „odpowiedz”, stała liczba polubień, awatary jako inicjały lub lokalne pliki;
5. treść powtarza obietnicę z artykułu (kwota, bank), a wśród „komentujących” jest konto marki;
6. fałszywy post z X: statyczny element zamiast osadzenia (brak skryptu widżetu i adresu `…/status/<id>`), awatar jako lokalny plik, znaczek weryfikacji jako wklejony SVG, data przepisywana skryptem przy każdej wizycie, tekst linku z inną domeną niż cel linku.

**Jak rozpoznaje narzędzie.** `comment_block`: odcisk bloku (znormalizowani autorzy i teksty); ten sam blok w wielu materiałach to ślad **szablonu**, nie samej platformy. Waga 0,45; nie łączy samodzielnie (kit), ale w parze z dowodem operatora tak. Techniki (`technique`, 0,2: `fake_comments`, `fake_social_post`, `fake_app_store`, `back_trap`) opisują modus operandi i liczą się tylko do grupy podobnych kampanii. Pojedyncze popularne nazwiska wśród autorów (powtórzone między kampaniami) są słabym dowodem i nie łączą. **Czyja cecha:** szablon i blok to cecha **zestawu stron** (często kupowanego i sprzedawanego dalej), więc łączy rodzinę, a kampanię tylko z dodatkowym dowodem.

## 10. Fałszywy sklep z aplikacjami

**Wzorzec.** Strona udaje sklep (przycisk „Zainstaluj”, „App Store” w tytule, logo sklepu, fałszywe oceny i „Wybór redakcji”, presja czasu), ale host nie jest domeną sklepu. Prawdziwy sklep nie instaluje aplikacji ze strony WWW: strona prowadzi do natywnej aplikacji sklepu albo do logowania. W fałszywce „instalacja” to:

- **PWA zamiast aplikacji** (manifest z trybem samodzielnym i service worker; na Androidzie powstaje pakiet WebAPK z ikoną),
- **ucieczka z wbudowanej przeglądarki aplikacji społecznościowej** do systemowej (specjalny schemat adresu, parametr przeglądarki),
- **pułapka „wstecz”**: wielokrotne `pushState` i obsługa `popstate`, przekierowująca na lejek zamiast wyjść ze strony,
- adresy lejka z identyfikatorem śledzenia (często identyfikator obiektu bazy, którego pierwsze 4 bajty to czas utworzenia) i identyfikatorem kliknięcia.

**Jak rozpoznaje narzędzie.** Technika `fake_app_store` i `back_trap` (atrybuty, poziom rodziny); identyfikator śledzenia w ścieżce to pivot kampanii (`path_id`), a adresy lejka i skrypty to odcisk kitu. Piksele i identyfikatory reklamy z parametrów (`campaign_param`, 0,8) łączą kampanię.

## 11. Seryjne rejestracje domen

**Wzorzec.** Operator rejestruje partię domen naraz: ten sam rejestrator, ta sama para serwerów nazw (często przydzielana kontu w CDN), ta sama minuta lub pora dnia, dzień do kilku dni **przed** emisją reklam. Domena żyje krótko (dni), potem trafia na listę ostrzeżeń lub zostaje zawieszona. Literatura: ok. 9 tys. z ok. 15,5 tys. domen Keitaro było zarejestrowanych przed użyciem; algorytmiczne domeny (RDGA) są wykrywalne w logach CT przed kampanią.

**Jak rozpoznaje narzędzie.** Rejestrator (`registrar`, 0,05) i serwery nazw (`nameserver`, 0,35) to słabe pojedyncze dowody; mocny jest **zestaw**: rejestrator + para NS + minuta rejestracji z RDAP (wzorzec serii rejestracji, krawędź `registration_burst`). Obserwacja z badania: operator rodziny rejestruje domeny partiami o stałej porze; para NS i pora to dobry odcisk do monitoringu nowych domen (`bun run ct:watch`). **Czyja cecha:** **operatora** (konto u rejestratora i w CDN), ale bez RDAP z żywej domeny śladu nie widać.

## 12. Wzorce nazw domen (generator bez rdzenia)

**Wzorzec.** Nazwy generuje program: seria o stałej strukturze bez wspólnego rdzenia (naprzemienne spółgłoski i samogłoski, `<słowo-akcji><słowo>`, `finance<nn>-<lorem><nn>`, prefiks kraju przed wspólnym rdzeniem). Zmiana TLD nie zmienia wzorca: ten sam schemat widziano najpierw w jednym TLD, potem w innym. Dlatego samo „podobne nazwy” bez wspólnej infrastruktury to **cecha generatora**, nie dowód jednego operatora; rośnie wartość, gdy wzorzec jest rzadki, a seria duża.

**Jak rozpoznaje narzędzie.** `domain_pattern` (0,6): szablon znormalizowanej nazwy (kształt, nie litery) i rzadkość kształtu w zbiorze; nie samodzielnie. Lista ostrzeżeń CERT zasila wzorce (sekcja źródeł).

## 13. Narracje i osoby

**Narracje (temat przynęty):** inwestycja („zarabiaj z X”, „platforma AI”), dotacja i zwrot podatku, zdrowie za pobraniem, hazard, nagroda, polityka i migranci. Ta sama narracja krąży w wielu językach i na wielu platformach (przykład: scenariusz „skandal w programie TV” zlokalizowany na kilkanaście krajów), więc **narracja nie jest odciskiem operatora**. Literatura: Bitdefender opisuje szablony („testament celebryty”, „banker mic-drop”, „ocenzurowany wywiad”) lokalizowane na ok. 25 krajów z wymianą nazwisk, waluty i redakcji.

**Osoby:** wizerunek osoby publicznej to najtańszy do wymiany element (`persona`, waga 0,1, tylko rodzina). Ta sama osoba występuje w kampaniach wielu niezależnych operatorów, więc służy do **filtrowania i rankingu**, nie do łączenia.

Ranking osób najczęściej użytych w obserwowanym zbiorze 25 spraw (28 materiałów; osoba rozpoznana z tekstu, OCR lub listy; liczby zagregowane):

- 13 z 28 materiałów ma rozpoznaną osobę (46%), razem 10 różnych osób;
- najczęstsza osoba: 7 materiałów w 2 kampaniach; druga: 6 materiałów w 1 kampanii; trzecia i czwarta: po 2 materiały w 1 kampanii; pozostałe sześć osób: po 1 materiale w 1 kampanii;
- dominuje więc kilka osób (dwie pokrywają 13 wystąpień), a „długi ogon” to pojedyncze wystąpienia.

Pełny ranking imienny na konkretnych sprawach jest w wersji niepublicznej. Literatura: w próbie Bitdefendera z 02–03.2026 Polska miała najwięcej kampanii (18–20%).

## 14. Co wiemy z literatury

- **Łączenie po metadanych reklam.** Bitdefender połączył 310 kampanii w 2–3 grupy operatorów po parametrach UTM i pikselach; to sygnały mało zmieniane, bo wynikają z codziennej pracy kupującego ruch.
- **Zgłoszenia wielu domen naraz.** W Australii 37 zgłoszeń dało ponad 1000 usunięć: skala zgłoszenia ma znaczenie, gdy kampanie są połączone.
- **Cloaking.** Domeny rejestrowane z wyprzedzeniem i bramkowane trackerem; obrońca widzi białą stronę, jeśli nie odtworzy kontekstu ofiary (polskie IP, telefon, parametry reklamy).
- **Sygnały odporne na obejście** (ranking z badania): backend leadów, kit strony (DOM, style, ukryte pola, ścieżki), wzorzec nazw i nawyki rejestracji, wspólna warstwa DNS, metadane kampanii w adresie, scenariusz kreacji, punkty wyjścia pieniędzy. Domeny, marki i nazwiska zmieniają się co kilka dni, więc są słabymi kluczami.
- **Źródła i daty dostępu (2026-11-21, o ile nie podano inaczej):**
  - Infoblox, Keitaro: <https://www.infoblox.com/blog/threat-intelligence/inside-keitaro-abuse-a-persistent-stream-of-ai-driven-investment-scams/>;
  - Confiant: <https://blog.confiant.com/p/tracking-software-weaponized-by-criminals>;
  - Bitdefender, sieć reklam Mety (2026): <https://www.bitdefender.com/en-us/blog/labs/global-investment-scam-network-using-meta-ads>;
  - Netcraft, klastry szablonów: <https://www.netcraft.com/blog/recent-cryptocurrency-investment-scam-campaigns-cloaking-ai-themes-and-the-industrialization-of-fraud>, reklamy zdrowotne: <https://www.netcraft.com/blog/health-product-scam-campaigns-abusing-cheap-tlds>;
  - Recorder.ro (sieć suplementów): <https://recorder.ro/?p=34542>;
  - CERT Polska, podsumowania miesięczne: <https://cert.pl/uploads/docs/Podsumowanie_CERT_Polska_2026_09.pdf> (wrzesień 2026; adres kolejnych miesięcy według tego samego wzoru, nie sprawdzano);
  - Lista Ostrzeżeń: <https://cert.pl/lista-ostrzezen/>;
  - CSIRT KNF, kampania z rotującymi domenami: <https://www.knf.gov.pl/knf/pl/komponenty/img/Raport_CSIRT_KNF_Masowa_Kampania_Wyludzen_99343.pdf>;
  - bramki konwersji Mety: <https://developers.facebook.com/documentation/ads-commerce/gateway-products/gateway-gcp/architecture>;
  - Keitaro, alias kampanii: <https://docs.keitaro.io/en/campaigns/campaigns.html>.

  Część tych serwisów blokuje automatyczne zapytania (403); wtedy opis opiera się na streszczeniu z wyszukiwarki i jest wtórny. Adresy Recorder.ro i Netcraft (reklamy zdrowotne) pochodzą z wyników wyszukiwarki, nie z lektury całej strony.

## 15. Rozpoznawanie: podsumowanie

| wzorzec | czyja cecha | typ węzła | poziom |
|---|---|---|---|
| konto i kampania na platformie stron | operator | `platform_account`, `platform_campaign`, `path_id` | kampania |
| SDK, biblioteka landerów, szablon platformy | platforma | `page_template` | rodzina |
| maszyna trackera (xid) | operator | `click_server` | kampania (z drugim dowodem) |
| format linku trackera, alias Keitaro | produkt | `param_schema` | atrybut / rodzina |
| cloaker | usługa | atrybut `cloakingSuspected` | atrybut |
| bramka CAPI | usługa wielu klientów | dyskontowana do zera | brak |
| backend formularza, ukryte pola | operator lub sieć afiliacyjna | `endpoint`, `hidden_fields` | kampania w parze z innym dowodem |
| komentarze i posty fałszywe | zestaw stron | `comment_block`, `technique` | rodzina (kampania z dowodem operatora) |
| fałszywy sklep z aplikacjami | zestaw stron | `technique` | rodzina |
| seria rejestracji (rejestrator, NS, minuta) | operator | `registrar`, `nameserver`, `registration_burst` | wspierający |
| generator nazw | generator | `domain_pattern` | wspierający |
| osoba, narracja | rynek | `persona` | rodzina / filtr |

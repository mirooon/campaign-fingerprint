# Katalog cech

Plik generowany: `bun run features:catalog`. Nie edytuj ręcznie.

Łączenie działa tak: każdy ślad ma wagę (typ × lista × częstość występowania), a materiały trafiają do jednej kampanii, gdy łączy je mocny ślad albo co najmniej jeden rodzaj śladu z poziomu „kampania” (wynik pary po zniżkach od 0.15); ślady „tylko z innym śladem” nie łączą samodzielnie, chyba że po zniżkach i rzadkości zostają mocne (od 0.7, np. backend formularza z identyfikatorem klienta), a ślady „grupy” łączą tylko podobne kampanie (szczegóły i progi w [METODYKA.md](METODYKA.md)).

## Ślady, których nie dają typowe narzędzia

Typowe narzędzia OSINT łączą strony po domenie, adresie IP, rekordach WHOIS i DNS, certyfikacie i hashu obrazu. Te ślady też zbieramy (sekcja 1), a poniżej są te, które odczytujemy sami z kodu strony, linków, identyfikatorów i nagrań. „Na próbce” podaje tylko liczby z przebiegu na 28 materiałach próbki organizatora (commit `b3ee946`), bez wartości; para to dwa materiały połączone tą przesłanką. W tabeli sekcji 1 te typy mają ★.

### Rekord panelu platformy stron

`path_id` · `platform_account` · `platform_campaign` · `cloaker_account` · `launcher_account` · `platformSourceIds` · `landingName` · `trafficSource`

- **Jak odczytujemy:** Kreator stron zapisuje w kodzie strony swój rekord konfiguracji. Czytamy z niego identyfikator właściciela konta, nazwę kampanii nadaną przez kupującego ruch, nazwę strony w panelu, źródło ruchu, numer klienta cloakera (cl_sid) i konto, z którego uruchomiono reklamy (launcher). Kreator nadaje też losowy identyfikator, który wraca w ścieżkach plików strony.
- **Czego nie widzą typowe narzędzia:** Domeny i adresy IP zmieniają się co kilka dni, a konto w panelu zostaje. WHOIS, DNS ani skan strony nie pokazują, kto w panelu kupił ruch i przez który cloaker go puścił.
- **Na próbce:** Konto platformy odczytane w 14 z 28 materiałów. Mocna przesłanka w parach: identyfikator w ścieżkach plików w 28 parach, konto w 30, kampania w panelu w 17. Klient cloakera i konto launchera wystąpiły po razie, bez pary w próbce, więc ich łączenie sprawdza test.

### Token dostępu Mety zostawiony w kodzie strony

`meta_token`

- **Jak odczytujemy:** Operatorzy wklejają do strony token konta reklamowego Mety, którym wysyłają zdarzenia konwersji: w adresie (token=), w rekordzie platformy stron (fb_capi_token) albo w skrypcie. Zapisujemy tylko początek skrótu sha256 (12 znaków), nigdy sam token.
- **Czego nie widzą typowe narzędzia:** Skanery stron widzą piksel Mety, a numer piksela bywa zmieniany i współdzielony. Token należy do jednego konta reklamowego i trafia na stronę przez nieuwagę operatora.
- **Na próbce:** 6 różnych tokenów, mocna przesłanka w 13 parach.

### Serwer kliknięć odczytany z identyfikatora kliknięcia

`click_server` · `clickTime` · `clickCounter`

- **Jak odczytujemy:** Identyfikator kliknięcia w formacie xid (12 bajtów) zawiera czas, identyfikator maszyny, numer procesu i licznik trackera. Dekodujemy go: ta sama maszyna i ten sam proces to ten sam serwer przekierowań, czas to chwila kliknięcia, a licznik rośnie z każdym identyfikatorem wydanym przez ten proces.
- **Czego nie widzą typowe narzędzia:** Tracker stoi za przekierowaniem i nie zostawia swojej domeny na stronie docelowej. Identyfikator kliknięcia wygląda jak losowy ciąg, więc narzędzia go pomijają.
- **Na próbce:** Czas i licznik odczytane w 3 materiałach. Jedna para: materiał z pierwszej paczki od organizatora połączył się z materiałem z drugiej paczki przez ten sam serwer trackera.

### Numer reklamy z linku i przybliżona data jej utworzenia

`meta_ad` · `metaAdId` · `metaAppId` · `adCreatedApprox`

- **Jak odczytujemy:** Nowy format parametru fbclid w linku niesie identyfikator klikniętej reklamy i aplikacji. Identyfikatory Mety rosną z czasem, więc z innych reklam o znanej dacie szacujemy, kiedy utworzono daną reklamę.
- **Czego nie widzą typowe narzędzia:** Biblioteka reklam szuka po własnym numerze, a link daje numer reklamy z panelu reklamodawcy. Bez dekodowania fbclid ten numer ginie w długim parametrze.
- **Na próbce:** Numer reklamy odczytany w 8 z 28 materiałów. Każdy z nich dotyczył innej reklamy, więc w próbce ślad nie łączył par. Służy do osi czasu i do rozpoznania kolejnej odsłony tej samej reklamy.

### Trojan w kradzionym zestawie stron

`c2_host` · `stealerKit`

- **Jak odczytujemy:** Część zestawów stron krąży z dopisanym trojanem. Fałszywa biblioteka (np. lazysizes albo jQuery z darmowego hostingu) sprawdza, czy przeglądarka jest w panelu trackera (/admin, /panel), i wysyła ciasteczka albo dane logowania na obcy serwer. Oznaczamy zestaw i zapisujemy adres serwera C2.
- **Czego nie widzą typowe narzędzia:** Skaner widzi znaną nazwę biblioteki i nie zagląda do środka. Tu oszuści okradają innych oszustów, a wszystkie kopie zestawu zgłaszają się do jednego serwera, więc jego adres łączy kopie.
- **Na próbce:** 1 materiał z takim zestawem, bez pary w próbce. Łączenie po serwerze C2 sprawdza test.

### Odcisk tekstu: komunikaty programisty i zdania szablonu

`kit_string` · `template_phrase`

- **Jak odczytujemy:** Ze skryptów strony bierzemy komunikaty programisty (log w konsoli, błąd, ostrzeżenie), często z literówką. Z tekstu strony i podziękowania po wysłaniu formularza bierzemy rzadkie zdania; zdanie z wpadką (powtórzone słowo, mieszane alfabety) waży więcej. Liczy się tylko tekst obecny w kilku domenach, a teksty platform, frameworków i znanych bibliotek są maskowane.
- **Czego nie widzą typowe narzędzia:** Hash strony zmienia się po każdej podmianie obrazka, ceny czy domeny. Literówka w logu i dziwne zdanie przechodzą z kopii na kopię bez zmian.
- **Na próbce:** Wspólny komunikat programisty w 4 parach, wspólne zdanie szablonu w 17 parach. Oba ślady łączą tylko razem z innym śladem.

### Fałszywe komentarze i wspólny lejek leadów

`comment_block` · `lead_flow`

- **Jak odczytujemy:** Komentarze „czytelników” są wpisane na stałe w kod strony. Zapisujemy zestaw autorów, a pospolite imiona, częste w blokach innych stron, ważą mniej. Z kodu stron jednej platformy bierzemy identyfikator formularza, listę przepływów i klucz zdarzeń lejka leadów.
- **Czego nie widzą typowe narzędzia:** Blok komentarzy wygląda jak wtyczka serwisu, a lejek zaczyna działać dopiero po wysłaniu formularza. Skan infrastruktury nie widzi żadnego z nich.
- **Na próbce:** Ten sam blok komentarzy w 15 parach. Wspólny lejek w 1 parze stron z różnych kont i różnych platform reklamowych: wynik to grupa podobnych kampanii z jednym dostawcą leadów.

### Odcisk montażu wideo

`overlay_template` · `reused_footage`

- **Jak odczytujemy:** W klatkach nagrania szukamy rozmytego albo zakrytego paska na dole cudzego filmu i napisów operatora. Zapisujemy rodzaj, kolor, położenie i rozmiar względem kadru, zaokrąglone do 5%. W rogach kadru czytamy znak studia albo stacji, z której wzięto nagranie; znaki edytorów i platform (CapCut, TikTok i inne) pomijamy.
- **Czego nie widzą typowe narzędzia:** Porównanie obrazów i hash klatek widzą inny film, bo operator za każdym razem bierze inne nagranie. Układ napisów i znak źródła zostają te same.
- **Na próbce:** Szablon napisów w 1 materiale, 2 różne znaki źródła; w próbce bez pary. Łączenie sprawdza test.

### Głos osoby publicznej z zamkniętej galerii

`similar_voice` · `personas` · `personaCategories`

- **Jak odczytujemy:** Ścieżkę dźwiękową tniemy na okna po 4 s, odrzucamy ciszę i samą muzykę, liczymy wektor mówcy (ECAPA) i porównujemy go z galerią 10 osób publicznych. Wynik to „głos podobny do X (0,57)” do przeglądu przez człowieka, a persona jest cechą grupy podobnych kampanii. Ten sam wektor łączy dwa nagrania z tym samym głosem.
- **Czego nie widzą typowe narzędzia:** Detektory fałszywego głosu oceniają, czy nagranie jest sztuczne, a ich błąd na prawdziwych reklamach (EER) wynosi 25–60%. Nam wystarcza odpowiedź, czyj głos udaje nagranie.
- **Na próbce:** Pomiar na nagraniach spoza próbki (docs/METODYKA.md): ta sama osoba rozpoznana w 70 z 70 nagrań, fałszywe trafienie w 1 z 25 nagrań obcych osób, a 5 z 5 fałszywek z publicznej kompilacji NASK przypisanych właściwej osobie.

### Zmyślony ekspert

`fictional_expert` · `fictionalExperts` · `expertNotInRegister`

- **Jak odczytujemy:** Szukamy tytułu „dr” lub „prof.” z imieniem i nazwiskiem, którego nie ma na liście osób publicznych, w reklamie, na zrzucie, w nagraniu i na stronie. Warianty pisowni scalamy w całym zbiorze. Opcjonalna wtyczka sprawdza nazwisko w rejestrze lekarzy i dodaje etykietę.
- **Czego nie widzą typowe narzędzia:** Rozpoznawanie osób szuka znanych twarzy i nazwisk. Zmyślony lekarz nie istnieje poza kampanią, więc jego nazwisko łączy jej materiały.
- **Na próbce:** 4 nazwiska w 2 materiałach, bez pary w próbce. Łączenie sprawdza test.

### Ślady w adresach i w kodzie: udawany adres, zegar Discorda, poprzednia wersja

`idnConfusable` · `discordSnowflakes` · `foreignPersona` · `residue`

- **Jak odczytujemy:** Oznaczamy adres, w którym znak udaje „/”, „.” lub „-” albo miesza alfabety. Z górnych bitów identyfikatora serwera lub konta Discord odczytujemy datę jego utworzenia. Persona z innego kraju w nazwie reklamy przy polskiej wersji i wykomentowany stary akapit w kodzie podpowiadają, że zestaw przeniesiono z innego rynku albo z wcześniejszej kampanii.
- **Czego nie widzą typowe narzędzia:** To cechy treści i identyfikatorów. Nie ma ich w rekordach domeny, w DNS ani w skanie infrastruktury.
- **Na próbce:** Wykomentowana stara wersja w 15 z 28 materiałów, persona z innego kraju w 1. Adresu udającego inny adres ani linku do Discorda w próbce nie było; działanie sprawdzają testy.

## 1. Ślady łączące

Próg mocnego śladu: 0.7; minimalny wynik krawędzi: 0.15; wspólny ślad występujący w więcej niż 400 materiałach jest pomijany (maxPivotDf). Poziom: **kampania** (może łączyć w jedną kampanię), **grupa** (tylko podobne kampanie), **tylko z innym śladem** (wspiera, nie łączy samodzielnie).

★ oznacza ślad opisany szerzej w sekcji [Ślady, których nie dają typowe narzędzia](#ślady-których-nie-dają-typowe-narzędzia).

| Typ | Nazwa | Waga | Poziom | Skąd | Po co | Przykład |
|---|---|---|---|---|---|---|
| `url` | Adres strony | 1 | kampania | Pełny adres strony, do której prowadzi reklama. | Ten sam adres w dwóch reklamach to niemal pewnie ten sam operator. | przyklad.test/start |
| `host` | Host | 0.95 | kampania | Nazwa serwera z adresu strony, razem z subdomeną. | Ta sama subdomena to zwykle ta sama strona i ten sam właściciel. | oferta.przyklad.test |
| `domain` | Domena | 0.95 | kampania | Adres strony, np. przyklad.test. Oszuści często rejestrują nowe domeny na kilka dni. | Wspólna domena łączy materiały samodzielnie, chyba że to duży serwis używany przez wielu. | przyklad.test |
| `ip` | Adres IP | 0.6 | kampania | Numer serwera, na którym działa strona. | Ten sam mały serwer może wskazywać jednego właściciela; wspólne adresy dużych firm hostingowych pomijamy. | 192.0.2.10 |
| `asn` | Sieć (ASN) | 0.05 | kampania | Numer sieci operatora, w której stoi serwer. | W jednej sieci są tysiące niezależnych stron, więc to słaby ślad. | AS64500 |
| `nameserver` | Serwery nazw (NS) | 0.35 | kampania | Serwery, które wskazują, gdzie działa domena. | Ta sama nietypowa para serwerów może łączyć domeny jednego właściciela. | ns1.dns-przyklad.test |
| `mx` | Serwer poczty (MX) | 0.4 | tylko z innym śladem | Serwer, który odbiera pocztę domeny. | Własny serwer poczty to ślad operatora; wspólne usługi (Google, Microsoft, Zoho, poczta rejestratora) pomijamy, a ślad nigdy nie łączy kampanii sam. | mail.poczta-przyklad.test |
| `registrar` | Rejestrator | 0.05 | kampania | Firma, w której kupiono domenę. | Popularny rejestrator mówi niewiele, rejestracje seriami mówią więcej. | Rejestrator Przykładowy |
| `cert` | Certyfikat HTTPS | 0.8 | kampania | Plik potrzebny stronie do działania przez https. Każdy certyfikat trafia do publicznego rejestru. | Jeden certyfikat na kilka domen zwykle wystawia jeden właściciel; darmowe urzędy certyfikacji pomijamy. | certyfikat dla a.test i b.test |
| `tracker` | Tracker, piksel | 1 | kampania | Kod firmy reklamowej albo analitycznej z identyfikatorem konta. | Ten sam identyfikator na dwóch stronach zwykle oznacza tego samego właściciela. | Meta Pixel 000000000000001 |
| `favicon` | Favicon | 0.5 | tylko z innym śladem | Mała ikona strony w karcie przeglądarki. | Ta sama ikona wskazuje ten sam zestaw stron; sama nie wystarcza. | ikona w kształcie logo |
| `imagehash` | Odcisk obrazu | 0.65 | tylko z innym śladem | Skrót obrazu reklamy, odporny na drobne zmiany. | Ta sama kreacja w dwóch reklamach to ta sama reklama albo jej wariant. | ta sama grafika z innym podpisem |
| `wallet` | Portfel kryptowalut | 1 | kampania | Adres portfela, na który strona każe wpłacać. | Ten sam portfel to te same pieniądze, więc ten sam operator. | adres portfela TRON |
| `email` | E-mail | 0.9 | kampania | Adres e-mail podany na stronie. | Ten sam kontakt na dwóch stronach to zwykle ten sam operator. | kontakt@przyklad.test |
| `phone` | Telefon | 0.9 | kampania | Numer telefonu podany na stronie. | Ten sam numer na dwóch stronach to zwykle ten sam operator. | +48 000 000 000 |
| `telegram` | Telegram | 0.9 | kampania | Kanał albo konto Telegram podane na stronie. | Ten sam kanał kontaktu to zwykle ten sam operator. | t.me/kanal_przyklad |
| `advertiser` | Reklamodawca | 0.6 | kampania | Nazwa profilu, który opublikował reklamę. Cecha materiału: Reklamodawca. | Ten sam profil to to samo konto reklamowe; nazwy bywają jednak ogólne i powtarzalne. | Wiadomości Dnia Demo |
| `endpoint` | Backend formularza | 0.95 | tylko z innym śladem | Adres, na który strona wysyła dane z formularza. | Wspólny backend na różnych domenach to mocny ślad; publiczne serwisy formularzy pomijamy. | zbieracz.test/api/zapis |
| `hidden_fields` | Ukryte pola formularza | 0.6 | tylko z innym śladem | Zestaw nazw niewidocznych pól w formularzu strony. | Ten sam zestaw wskazuje ten sam szablon strony; sam nie wystarcza. | lp_id, offer_hash |
| `asset` | Plik JS/CSS | 0.55 | tylko z innym śladem | Własny plik skryptu albo stylów strony. | Ten sam nietypowy plik wskazuje ten sam zestaw stron; popularne biblioteki pomijamy. | formularz-lead.9f8e.js |
| `comment` | Komentarz w kodzie | 0.6 | tylko z innym śladem | Notatka programisty zostawiona w kodzie strony. | Ten sam nietypowy komentarz wskazuje ten sam szablon; standardowe komentarze pomijamy. | „wstaw formularz po bloku telefonu” |
| `domain_pattern` | Wzorzec nazwy domeny | 0.6 | kampania | Powtarzalny schemat nazw domen, np. zwrot<liczba>-<słowo>.test. | Domeny z jednego schematu zwykle rejestruje jeden operator seriami. | zwrot12-abc.test, zwrot37-xyz.test |
| `cname_target` | Przekierowanie domeny (CNAME) | 0.65 | kampania | Wpis, który kieruje domenę na inny serwer. | Wspólny, nietypowy cel przekierowania wskazuje wspólną infrastrukturę; duże sieci CDN pomijamy. | ruch.przyklad.test |
| `campaign_param` | Parametr kampanii | 0.8 | kampania | Znacznik kampanii dopisany do linku reklamy (np. utm_campaign). | Ta sama nietypowa wartość to zwykle ta sama kampania reklamowa; ogólne wartości pomijamy. | utm_campaign=lato_07 |
| `persona` | Persona | 0.1 | grupa | Osoba, pod którą podszywa się reklama. | Ta sama osoba pojawia się w wielu niezależnych kampaniach, dlatego sama nie łączy materiałów. | Adam Testowy |
| `path_id` | Identyfikator konta w ścieżkach ★ | 0.85 | kampania | Losowy identyfikator w adresach plików strony, nadany przez kreator stron. | Ten sam identyfikator to to samo konto w kreatorze stron. | /a1b2c3d4-…/style.css |
| `param_schema` | Szablon linku śledzącego | 0.12 | tylko z innym śladem | Nazwy parametrów linku i rodzaj ich wartości. | Wskazuje system kierowania ruchem, z którego korzysta wielu klientów: ślad pomocniczy. | sub1, sub2, clickid |
| `platform_account` | Konto na platformie stron ★ | 0.9 | kampania | Identyfikator właściciela w narzędziu do budowy stron. Cecha materiału: Konto na platformie stron. | To samo konto to ten sam operator. Różne konta tej samej platformy nie trafiają do jednej kampanii bez silnej przesłanki. | konto 1a2b… |
| `platform_campaign` | Kampania na platformie stron ★ | 0.95 | kampania | Kampania w panelu platformy stron, nazwana przez kupującego ruch. | Te same strony puszcza ta sama kampania: silny ślad. | kampania „lato-pl” |
| `page_template` | Szablon strony na platformie | 0.35 | tylko z innym śladem | Gotowy szablon, z którego zbudowano stronę na platformie. | Ten sam szablon u różnych kont oznacza podobne kampanie, a nie jedną. | szablon „artykuł-wywiad” |
| `click_server` | Serwer kliknięć ★ | 0.6 | kampania | Serwer, który przekierował kliknięcie w reklamę (zapisany w identyfikatorze kliknięcia). | Ten sam serwer kieruje ruch do obu stron: wspólna infrastruktura, ślad średni. | serwer 0a1b w identyfikatorze kliknięcia |
| `meta_ad` | Identyfikator reklamy ★ | 0.95 | kampania | Numer klikniętej reklamy zapisany w linku. | Ten sam numer to ta sama reklama. | reklama 120200000000000 |
| `ad_payer` | Płatnik reklamy | 0.65 | tylko z innym śladem | Płatnik zadeklarowany platformie reklamowej (biblioteka reklam). | Ten sam płatnik to jedno konto płacące; ogólne nazwy łączą słabiej. | „Firma Przykład” |
| `comment_block` | Blok fałszywych komentarzy ★ | 0.45 | tylko z innym śladem | Zestaw zmyślonych komentarzy wpisany na stałe w stronę. | Ten sam zestaw autorów wskazuje ten sam szablon strony; sam nie wystarcza. | te same 8 komentarzy pod artykułem |
| `technique` | Technika strony | 0.2 | grupa | Sposób działania strony, np. fałszywy sklep z aplikacjami, pułapka „wstecz”, licznik presji, blokada narzędzi deweloperskich, kit formularza sieci CPA (kit:formFb). | Sposób działania łączy podobne kampanie, nie wskazuje operatora. | pułapka „wstecz” |
| `crm_key` | Klucz API CRM | 0.95 | kampania | Tajny klucz konta w CRM albo sieci afiliacyjnej, z którym formularz wysyła zgłoszenie. Pokazujemy tylko skrót (początek, koniec i sha256), nigdy cały klucz. | Jeden klucz należy do jednego konta odbiorcy leadów: dwie strony z tym samym kluczem wysyłają dane do tego samego kupca. Silny ślad, jak wspólny backend formularza. | klucz Zx81…yB9n |
| `template_phrase` | Zdanie szablonu ★ | 0.45 | tylko z innym śladem | Rzadkie zdanie z tekstu strony albo z podziękowania po wysłaniu formularza, takie samo na stronach w różnych domenach. Zdanie z wpadką (powtórzone słowa, mieszane alfabety) waży więcej. | Wskazuje ten sam szablon strony; ten sam szablon kupuje wielu operatorów, więc do kampanii potrzebny drugi rodzaj dowodu. | „nasz opiekun zadzwoni do ciebie i przedstawi platformę” |
| `profit_claim` | Obiecywany zysk | 0.2 | grupa | Kwota i okres obiecywanego zarobku z tekstu, zrzutu albo nagrania. | Ta sama obietnica pochodzi z tego samego scenariusza oszustwa, który kopiuje wielu operatorów: łączy tylko podobne kampanie w grupę. | 3000 zł w ciągu dnia |
| `kit_string` | Komunikat ze skryptu zestawu ★ | 0.5 | tylko z innym śladem | Komunikat programisty zapisany w skrypcie strony (log w konsoli, błąd, ostrzeżenie), często z literówką, taki sam na stronach w różnych domenach. Skrypty platformy stron (SDK), paczki frameworków i znane biblioteki są pomijane. | Wskazuje to samo narzędzie sieci, jak skrót pliku; narzędzia używa wielu operatorów, więc do kampanii potrzebny drugi rodzaj dowodu. Liczy się przy co najmniej dwóch wspólnych komunikatach albo jednym z pięciu słów. | „moduł testowy: start!” |
| `shared_doc` | Dokument, formularz lub czat udostępniony linkiem | 0.9 | kampania | Adres dokumentu, arkusza, formularza (Google, Notion, Microsoft Forms, Typeform, Jotform) albo udostępnionej rozmowy z modelem językowym, podany na stronie, w reklamie, na zrzucie albo w ruchu strony. | Taki zasób należy do jednego konta, więc ten sam identyfikator w dwóch materiałach wskazuje jednego operatora. Rozmowa z czatem AI bywa wklejonym planem kampanii. | formularz Google z tym samym identyfikatorem na dwóch stronach |
| `onion` | Adres .onion | 0.9 | kampania | Adres ukrytej usługi w sieci Tor (wersja 3, 56 znaków). | Ten sam adres to ten sam zasób operatora; adresów wersji 2 nie liczymy, bo wygasły. | 56 znaków i .onion |
| `messenger_invite` | Zaproszenie lub konto komunikatora | 0.9 | kampania | Zaproszenie na Discorda, konto albo grupa Signal, Viber lub Line podane na stronie, w reklamie albo na zrzucie. | To samo zaproszenie lub konto to zwykle ten sam operator (jak kanał Telegram). | discord.gg/kodprzyklad |
| `c2_host` | Serwer C2 trojana w zestawie strony ★ | 0.95 | kampania | Adres serwera, do którego skrypt skopiowanego zestawu strony (np. fałszywa biblioteka lazysizes) wysyła ciasteczka lub dane logowania z fałszywego panelu trackera. | Wszystkie kopie tego samego pobranego zestawu zgłaszają się do tego samego serwera, więc wspólny adres wskazuje jednego operatora zestawu. | c2.przyklad.test |
| `fictional_expert` | Zmyślony ekspert ★ | 0.75 | kampania | Tytuł „dr” lub „prof.” z imieniem i nazwiskiem, którego nie ma na liście osób publicznych (np. „dr Jan Testowy”), użyty na stronie, w reklamie lub na zrzucie jako autorytet. Cecha materiału: Zmyślony lekarz (prawdopodobnie AI). | Zmyśloną postać wymyśla jeden operator, więc to samo imię i nazwisko (także z literówką) na różnych domenach wskazuje jednego autora. Imię często powtarzane w zbiorze traci wagę. | dr Jan Testowy i dr Jan Testowyy |
| `lead_flow` | Lejek leadów platformy stron ★ | 0.5 | tylko z innym śladem | Ten sam formularz, lista przepływów albo klucz zdarzeń zapisane w kodzie stron z jednej platformy. | Strony korzystają z jednego lejka leadów: ta sama sieć lub oferta, niekoniecznie jeden kupujący. | formularz 7c3e91a4… |
| `overlay_template` | Szablon podmienionych napisów ★ | 0.45 | tylko z innym śladem | Układ montażu: rozmyty lub zakryty pasek na dole cudzego nagrania i własne napisy operatora (rodzaj, kolor, położenie i rozmiar względem kadru). | Ten sam układ w różnych filmach to to samo narzędzie lub ten sam montażysta; sam nie wystarcza, bo narzędzia są wspólne. | biały pas na dolnych 10% kadru |
| `reused_footage` | Znak źródła cudzego nagrania ★ | 0.45 | tylko z innym śladem | Nazwa lub logo studia albo stacji w rogu kadru: znak oryginału, z którego wzięto nagranie. Znaki edytorów i platform (CapCut, TikTok i inne) są pomijane. | Ten sam znak w reklamach różnych reklamodawców to wspólna biblioteka ukradzionych nagrań; sam nie wystarcza. | „Studio Test” w prawym górnym rogu |
| `company_id` | Identyfikator firmy na stronie | 0.5 | tylko z innym śladem | Numer firmy podany w stopce, regulaminie albo danych sprzedawcy: NIP, REGON, KRS, unijny numer VAT, numer spółki w Wielkiej Brytanii. | Ten sam numer na dwóch stronach to wspólny szablon albo wspólna ręka, ale dane firmy da się skopiować z cudzej strony, więc ślad sam nie łączy w kampanię. Numer z błędną sumą kontrolną jest zmyślony. | NIP 123-456-32-18 w stopce |
| `bank_account` | Rachunek bankowy na stronie | 0.8 | tylko z innym śladem | Numer rachunku (IBAN albo polski NRB) podany jako konto do wpłat. | Ten sam rachunek to wspólny odbiorca pieniędzy: silniejszy ślad niż numer firmy, ale rachunki podstawionych osób („słupów”) bywają wspólne dla różnych grup, więc sam nie łączy w kampanię. | PL61 1090 1014 0000 0712 1981 2874 |
| `postal_address` | Adres siedziby sklepu | 0.5 | tylko z innym śladem | Pełny adres podany na stronie: ulica, numer, kod pocztowy i miasto (zapis ujednolicony: „ul.” i „ulica”, kod z myślnikiem i bez to ten sam adres). | Ten sam adres na dwóch sklepach to wspólny szablon albo ta sama ręka, ale adres łatwo skopiować ze stopki cudzego sklepu, a biura wirtualne wynajmują ten sam adres niezwiązanym firmom, więc ślad sam nie łączy w kampanię. | ul. Przykładowa 1, 00-001 Miasto |
| `cloaker_account` | Konto klienta cloakera ★ | 0.9 | kampania | Numer klienta (cl_sid) w serwisie ukrywającym stronę przed moderacją, zapisany przez platformę stron razem z domeną cloakera (cl_domain). | Ten sam numer na tej samej domenie cloakera to jedno opłacone konto, czyli ten sam operator. Sam numer albo sama domena nie łączą. | konto 12345 na cloak.example.test |
| `launcher_account` | Konto narzędzia do uruchamiania reklam ★ | 0.9 | kampania | Identyfikator (launcher) konta, z którego uruchomiono reklamy, zapisany przez platformę stron, gdy różni się od właściciela strony. | To samo konto narzędzia to ten sam kupujący reklamy. Gdy launcher jest równy właścicielowi strony, liczy się raz, jako konto na platformie stron. | konto 1a2b… |
| `affiliate_account` | Konto w sieci afiliacyjnej | 0.9 | kampania | Identyfikatory partnera sieci afiliacyjnej w linku zamówienia, zakodowanym parametrze referer albo w ukrytych polach formularza: zespół i użytkownik (team_id, user_id), strumień (stream_id) albo oferta (offer_uuid), zawsze razem z adresem sieci. | Strumień i oferta w tej samej sieci należą do jednego partnera, który kupuje ruch. Para zespół i użytkownik to małe liczby, więc sama nie łączy w kampanię: potrzebny drugi ślad. | siec.example.test · team_id=42, user_id=13 |
| `meta_token` | Token dostępu Meta ★ | 0.95 | kampania | Tajny token dostępu do konta reklamowego Mety, zapisany w adresie (token=), w rekordzie platformy stron (fb_capi_token) albo w kodzie strony. Pokazujemy tylko skrót, nigdy sam token. | Token wydaje się jednemu kontu reklamowemu, więc ten sam token na dwóch stronach to ten sam operator. Tokenu nie sprawdzamy w żadnym wywołaniu do Mety. | skrót sha256 3f9a1c… |
| `hosting_account` | Konto na hostingu wideo lub kodu | 0.6 | tylko z innym śladem | Biblioteka wideo jednego klienta usługi hostingu (adres hosta wideo z identyfikatorem biblioteki) albo konto GitHuba, z którego jsDelivr serwuje pliki strony (`cdn.jsdelivr.net/gh/<konto>/…`). | Dwie strony z plikami z tej samej biblioteki lub tego samego konta korzystają z jednego konta, w przeciwieństwie do samej domeny CDN, którą dzielą tysiące niezwiązanych stron. Ślad wspiera powiązanie, nie łączy kampanii sam. | biblioteka 0a1b2c3d |
| `similar_image` | Podobna kreacja (podobieństwo dwóch materiałów) | 0.6 | tylko z innym śladem | Obrazy reklam różnią się tylko drobiazgami. | Ta sama grafika w wariantach to zwykle ta sama kampania. | ta sama grafika z innym napisem |
| `similar_image_semantic` | Podobny obraz (podobieństwo dwóch materiałów) | 0.45 | tylko z innym śladem | Obrazy przedstawiają to samo, choć nie są kopią. | Wskazuje ten sam szablon kreacji; razem z innymi śladami. | ta sama scena w innym kadrze |
| `similar_text` | Podobny tekst (podobieństwo dwóch materiałów) | 0.5 | tylko z innym śladem | Teksty reklam są do siebie bardzo podobne. | Ten sam tekst w wielu reklamach to często ta sama kampania albo ta sama narracja. | ten sam tekst z inną kwotą |
| `similar_dom` | Ten sam układ strony (podobieństwo dwóch materiałów) | 0.45 | tylko z innym śladem | Strony mają taką samą budowę kodu. | Ten sam układ wskazuje ten sam zestaw stron, który bywa sprzedawany wielu operatorom. | ta sama strona-artykuł na innej domenie |
| `similar_audio` | Ten sam podkład audio (podobieństwo dwóch materiałów) | 0.5 | tylko z innym śladem | Nagrania mają tę samą ścieżkę dźwiękową. | Ten sam podkład to zwykle ta sama kreacja. | ta sama muzyka i lektor |
| `similar_voice` | Ten sam głos (podobieństwo dwóch materiałów) ★ | 0.4 | tylko z innym śladem | W nagraniach mówi ten sam głos. | Ten sam głos może być podrobiony wiele razy, więc sam nie wystarcza. | ten sam lektor w dwóch nagraniach |

### Cechy materiału, które łączą albo pomagają

| Klucz | Nazwa | Rola | Skąd |
|---|---|---|---|
| `landingUrl` | Adres strony | łączy | z materiału |
| `finalUrl` | Adres końcowy (po przekierowaniach) | łączy | z HAR albo zapisu strony |
| `observedUrls` | Adres z paska przeglądarki | łączy | z OCR zrzutu |
| `advertiser` | Reklamodawca | pomaga | ze zrzutu albo opisu |
| `adLibraryIds` | Identyfikator biblioteki reklam | łączy | z OCR zrzutu |
| `adLibraryAdId` | Identyfikator reklamy w bibliotece | łączy | z rekordu biblioteki |
| `adAdvertiserId` | Identyfikator reklamodawcy w bibliotece | łączy | z rekordu biblioteki |
| `companyIds` | Identyfikatory firm i rachunki na stronie | łączy | z tekstu strony, kodu, JSON-LD albo zrzutu (OCR) |
| `platformCampaignName` | Kampania na platformie stron | łączy | z kodu strony |
| `platformAccount` | Konto na platformie stron | łączy | z kodu strony |
| `metaAdId` | Identyfikator reklamy | łączy | z linku (fbclid) |
| `ocrText` | Tekst ze zrzutu | pomaga | z OCR zrzutu |
| `videoOcrText` | Napisy w wideo | pomaga | z napisów w wideo (OCR klatek co 2 s) |
| `asrText` | Transkrypcja nagrania | pomaga | z nagrania (ASR) |
| `text` | Tekst reklamy | pomaga | z materiału |
| `dhash` | Odcisk obrazu | łączy | ze zrzutu |
| `domSimhash` | Odcisk budowy strony | pomaga | z HAR albo zapisu strony |
| `platformSourceIds` | Identyfikatory źródeł ruchu na platformie | łączy | z linków platformy stron (parametr suuid) |

## 2. Atrybuty materiału i kampanii

Opisują materiał, nie łączą go z innymi.

| Klucz | Nazwa | Skąd |
|---|---|---|
| `landingSource` | Skąd adres strony | z materiału |
| `landingFragment` | Fragment adresu (#…) | z adresu |
| `inAppBrowser` | Przeglądarka w aplikacji | z OCR zrzutu |
| `uiView` | Widok na zrzucie | z OCR zrzutu |
| `advertiserImpersonatesName` | Reklamodawca podszywa się pod osobę | z nazwy reklamodawcy i listy osób (atrybut, nie dowód kampanii) |
| `profitClaims` | Obiecywany zysk (kwota i okres) | z tekstu reklamy, strony, OCR albo transkrypcji (atrybut; łączy tylko podobne kampanie w grupę) |
| `fictionalExpert` | Zmyślony lekarz (prawdopodobnie AI) | z tytułu (dr, prof.) i nazwiska spoza listy osób publicznych w reklamie zdrowotnej (atrybut, nie dowód kampanii) |
| `expertNotInRegister` | Lekarz bez wpisu w rejestrze (prawdopodobnie zmyślony) | z nagranej odpowiedzi rejestru lekarzy (wtyczka opcjonalna, wyłączona domyślnie; etykieta, nie dowód kampanii) |
| `liveStream` | Fałszywa transmisja na żywo | z metadanych nagrania (yt-dlp: was_live, is_live; atrybut, nie dowód kampanii) |
| `aiImageMeta` | Obraz wygenerowany przez AI (znacznik w pliku) | z metadanych pliku obrazu: C2PA, IPTC, EXIF albo opis generatora (atrybut; bez metadanych brak wniosku) |
| `advertiserMismatch` | Konto reklamowe prawdopodobnie przejęte (nazwa nie pasuje do treści) | z nazwy reklamodawcy (lokalna firma albo osoba prywatna) i narracji inwestycyjnej (atrybut, nie dowód kampanii) |
| `displayedDomainMismatch` | Domena pokazana w reklamie różni się od strony docelowej | z OCR zrzutu albo tekstu reklamy i z łańcucha przekierowań (atrybut, nie dowód kampanii) |
| `displayedBrandDomain` | Pokazana domena należy do znanej marki (bank, portal, sklep) | z listy marek (atrybut) |
| `clickfix` | Polecenie kopiowane do schowka (ClickFix) | ze skryptu strony: tylko rodzaj i skrót SHA-256, samo polecenie jest ładunkiem złośliwego oprogramowania i nie jest zapisywane (atrybut) |
| `stealerKit` | Trojan w zestawie strony (kradzież ciasteczek lub haseł z fałszywego panelu trackera) | ze skryptów strony i pobranych bibliotek na darmowych hostingach: sprawdzenie ścieżki /admin lub /panel plus wysyłka ciasteczka lub danych logowania do obcego hosta (atrybut; sam host C2 jest śladem) |
| `idnConfusable` | Adres udaje inny adres (znak podobny do „/”, „.” lub „-” albo mieszane alfabety) | z adresu strony, przekierowań, paska przeglądarki na zrzucie i linków (atrybut: opisuje, jak adres wygląda dla oka) |
| `adStartWeekday` | Dzień tygodnia startu reklamy | z daty pierwszej emisji w bibliotece reklam, UTC (atrybut; rozkład w kampanii opisuje rytm operatora) |
| `discordSnowflakes` | Data utworzenia serwera lub konta Discord (z identyfikatora) | z linków discord.com/channels i discord.com/users: górne bity identyfikatora to czas utworzenia (atrybut: „zegar powstania”) |
| `onionV2` | Adres .onion wersji 2 (wygasły) | z tekstu strony (atrybut; nie łączy) |
| `phoneLines` | Rodzaj numeru telefonu | z lokalnych metadanych libphonenumber-js, bez wysyłania numeru do usług (atrybut: numery VoIP bywają jednorazowe, więc waga numeru zależy od jego rzadkości) |
| `phoneCountryMismatch` | Kraj numeru inny niż rynek reklamy | z numeru i rynku reklamy (atrybut) |
| `tollFreeOnAlert` | Numer bezpłatny na stronie z fałszywym alarmem | z numeru i techniki strony (atrybut) |
| `fictionalExperts` | Zmyśleni eksperci (dr, prof. spoza listy osób publicznych) | z tekstu strony, reklamy, zrzutu i nagrania (atrybut; imię i nazwisko jest też śladem) |
| `narrative` | Narracja i haczyki | z tekstu reklamy, strony, OCR i transkrypcji (atrybut; cecha grupy kampanii, nie dowód) |
| `localizedUi` | Słownik interfejsu w wielu językach | ze skryptu strony (kody języków; lokalizacja platformy stron, nie ślad tekstu, atrybut) |
| `residue` | Wykomentowana stara wersja | z komentarzy w kodzie strony (atrybut; ten sam stary akapit na dwóch stronach to ślad wspólnego szablonu, nie dowód) |
| `foreignSegments` | Ślad innej wersji (wstawka w innym języku) | z tekstu strony, skryptów, komentarzy lub nazw reklamy (atrybut; kampania może działać też w kraju tego języka, to podpowiedź, nie wniosek o autorze) |
| `foreignPersona` | Persona z innego kraju w nazwie reklamy | z parametrów reklamy (ad_name, adset_name, campaign_name) przy kodzie PL (atrybut) |
| `typography` | Typografia tekstu | z tekstu reklamy i strony (atrybut; ten sam tekst z inną typografią to inna redakcja szablonu, nie inny właściciel) |
| `translationArtifacts` | Ślady tłumaczenia | z tekstu strony i napisów (atrybut; mieszane alfabety, kalki, skoki ty/wy, liczebniki słownie; bez wniosków o narodowości) |
| `languageErrors` | Błędy językowe strony | z tekstu strony (atrybut bez wagi, B-325: akapity w innym języku niż reszta strony albo słowa z mieszanym alfabetem w zdaniu) |
| `brandStyle` | Styl nazwy marki | z nazwy reklamodawcy lub marki (pseudopolskie złożenie z rdzeniem finansowym, atrybut) |
| `advertiserNameKind` | Rodzaj nazwy reklamodawcy | z nazwy reklamodawcy (wygenerowana marka, osoba, lokalny biznes; atrybut) |
| `adPlatform` | Biblioteka reklam | z rekordu biblioteki |
| `adAdvertiserLegalName` | Nazwa prawna reklamodawcy | z rekordu biblioteki |
| `adAdvertiserLocation` | Kraj reklamodawcy | z rekordu biblioteki |
| `adAdvertiserVerified` | Reklamodawca zweryfikowany | z rekordu biblioteki |
| `adRegions` | Regiony emisji | z rekordu biblioteki |
| `adFirstShown` | Początek emisji reklamy | z biblioteki reklam |
| `adLastShown` | Koniec emisji reklamy | z biblioteki reklam |
| `payerKinds` | Rodzaj płatnika z biblioteki reklam | z nazwy płatnika i beneficjenta (samodeklaracja z DSA, platforma jej nie weryfikuje) |
| `payerSuspicious` | Podejrzany płatnik reklamy | z nazwy płatnika (zaślepka, bełkot z klawiatury albo imię i nazwisko w obcym alfabecie) |
| `payerEqualsBeneficiary` | Płatnik równy beneficjentowi | z biblioteki reklam |
| `companyRegistry` | Rejestry firm (biała lista VAT, KRS) | z rejestrów publicznych dla NIP i KRS ze strony (opcja --company-registry; nazwa, siedziba, status, data wpisu, bez danych osób); niezgodność nazwy lub adresu, wykreślenie, młoda firma i wiek firmy względem domeny to wyjaśnienia, nie dowód kampanii |
| `legalEntities` | Nazwy podmiotów z formą prawną | z tekstu strony, kodu, JSON-LD albo zrzutu (OCR) |
| `emailDomainKinds` | Rodzaj domeny adresów e-mail | z adresów e-mail na stronie (darmowa skrzynka, domena sklepu albo inna domena) |
| `addressCompleteness` | Kompletność adresu na stronie | z tekstu strony i JSON-LD (pełny, samo miasto, skrytka albo brak) |
| `certIssuer` | Wystawca certyfikatu TLS | z HAR (securityDetails); darmowy certyfikat to tylko kontekst, kłódka nic nie mówi o sprzedawcy |
| `certMismatch` | Certyfikat wystawiony na inną domenę | z HAR (securityDetails): żadna nazwa certyfikatu nie obejmuje hosta |
| `certExpired` | Certyfikat wygasły | z HAR (securityDetails): koniec ważności przed datą zapisu strony |
| `brandInPath` | Znana marka w ścieżce adresu | z adresu strony: marka w ścieżce, a nie w nazwie domeny (typowe dla klonów kurierów i serwisów ogłoszeń) |
| `hostingOutsideEu` | Hosting poza UE i EOG | z kraju adresu IP (wzbogacenie ASN); strony spoza UE trudniej zdjąć |
| `tldRare` | Rzadka końcówka domeny | z nazwy domeny (końcówka spoza listy typowych dla sklepów, np. .sbs, .top); słaba wskazówka |
| `domainLangMismatch` | Nazwa domeny w innym języku niż strona | z nazwy domeny i języka strony; słaba wskazówka |
| `privacyControllerMismatch` | Administrator danych inny niż sklep | z polityki prywatności: adres administratora na innej domenie niż adresy kontaktowe strony |
| `registrantHidden` | Dane rejestranta domeny zasłonięte | z RDAP (REDACTED albo usługa prywatności); większość rejestratorów tak robi, więc słaba wskazówka |
| `contactDomainDead` | Domena e-maila kontaktowego nie odpowiada | z wzbogacenia (tryb z siecią): domena ma rekord MX, a nie odpowiada po HTTP(S) |
| `phoneAreaMismatch` | Numer stacjonarny niezgodny z miastem adresu | z numeru telefonu i adresu na stronie |
| `companyIdInvalid` | Identyfikator firmy z błędną sumą kontrolną | z tekstu strony, kodu, JSON-LD albo zrzutu (OCR) |
| `personas` | Persona | z tekstu, transkrypcji albo OCR |
| `impersonatedBrand` | Podrabiana marka | z tytułu strony |
| `landingName` | Nazwa strony w panelu platformy | z kodu strony |
| `trafficSource` | Źródło ruchu | z kodu strony |
| `metaAppId` | Identyfikator aplikacji | z linku (fbclid) |
| `clickTime` | Czas kliknięcia | z identyfikatora kliknięcia |
| `clickCounter` | Licznik serwera kliknięć | z identyfikatora kliknięcia |
| `firstSeen` | Pierwsza obserwacja | z materiału |
| `cyrillic` | Cyrylica w kodzie strony | z kodu strony |
| `cloakingSuspected` | Podejrzenie cloakingu | z dwóch pobrań strony |
| `personaCategories` | Rodzaje osób w reklamie | z listy osób publicznych (np. polityk, prezenter, lekarz) dla osób rozpoznanych w materiale |
| `cloakerInSource` | Cloaker w kodzie strony | z kodu strony albo nazwy źródła ruchu: oznaczenie, że strona działa przez cloaker (atrybut, nie dowód kampanii) |
| `platformAccountSource` | Skąd wiadomo, które to konto platformy | z kodu strony: konto z adresu najemcy (tenant) albo z owner_uuid (atrybut) |
| `platformAccountWarning` | Ostrzeżenie o niespójnym koncie platformy | z kodu strony: najemca w adresie różni się od owner_uuid, więc przypisano konto według owner_uuid (atrybut) |
| `platformTenants` | Najemcy platformy w adresach plików strony | z adresów plików strony (landing-cdn): identyfikatory kont, na których stoi strona |
| `infrastructure` | Wspólna infrastruktura reklam (opis) | z podsumowania kampanii: domeny, trackery, IP, kontakty i portfele łączące reklamy (tylko opis) |
| `techniques` | Techniki strony | z kodu i treści strony: lista rozpoznanych technik oszustwa, np. fałszywe komentarze (atrybut, nie dowód kampanii) |
| `creativeBrand` | Marka rozpoznana na obrazie reklamy | z porównania obrazu reklamy ze wzorcami marek (atrybut, prawdopodobieństwo, nie dowód kampanii) |
| `domainAgeDays` | Wiek domeny w dniach | z daty rejestracji domeny (RDAP) i daty pierwszej obserwacji materiału; bardzo młoda domena to słaba wskazówka |
| `certAgeDays` | Wiek pierwszego certyfikatu w dniach | z dziennika certyfikatów (CT) i daty pierwszej obserwacji materiału; świeży certyfikat to słaba wskazówka |
| `pagePlatforms` | Platformy budowy strony | z kodu strony: rozpoznane platformy i narzędzia (np. aio, binom), na których zbudowano stronę (atrybut, nie dowód kampanii) |
| `inputExtra` | Dodatkowe kolumny z danych wejściowych | z kolumn pliku wejściowego spoza standardowego mapowania (łączą tylko kolumny wskazane w konfiguracji) |
| `namingMixedScript` | Nazwa z mieszanych alfabetów | z nazw w panelu platformy: litery łacińskie wymieszane z cyrylicą (słaba wskazówka) |
| `codeCommentLang` | Język komentarzy w kodzie strony | z komentarzy w kodzie strony: ukraiński albo rosyjski (atrybut, nie dowód kampanii) |
| `landerSlugStyle` | Styl ścieżki adresu strony | z ścieżki adresu: ciąg spółgłosek albo lista losowych słów (atrybut, nie dowód kampanii) |
| `advertiserNameStyle` | Styl nazwy reklamodawcy | z nazwy reklamodawcy: losowa „marka” albo zagraniczne imię i nazwisko (atrybut, nie dowód kampanii) |
| `adCreatedApprox` | Przybliżona data utworzenia reklamy | z identyfikatora reklamy Meta i innych reklam o znanych datach (szacunek, atrybut) |

## 3. Techniki manipulacji

Pole `techniques[]`. Atrybut i ślad grupy, nie dowód jednej kampanii. Techniki sklepowe tylko opisują stronę sklepu.

| Klucz | Nazwa | Opis |
|---|---|---|
| `spaced_text` | tekst rozstrzelony litera po literze | Podpis albo napis w reklamie zapisany literami oddzielonymi spacjami („P o b i e r z”). |
| `fake_security_alert` | fałszywy alarm bezpieczeństwa z numerem telefonu | Strona straszy wirusem, zablokowanym komputerem albo zhakowanym kontem, podaje numer telefonu jako jedyne wyjście i nie pozwala łatwo jej opuścić (pełny ekran, okna alertu, pułapka „wstecz”, dźwięk alarmu). |
| `remote_access_tool` | program do zdalnego pulpitu do pobrania | Link albo instrukcja pobrania programu do zdalnego pulpitu (np. AnyDesk, TeamViewer QuickSupport) z prośbą o podanie kodu dostępu. |
| `clickfix_paste` | fałszywa weryfikacja z poleceniem do wklejenia | Fałszywy CAPTCHA albo „weryfikacja, że nie jesteś robotem” każe nacisnąć skrót (np. Win+R) i wkleić polecenie, które strona skopiowała do schowka. |
| `fake_comments` | fałszywe komentarze | Pod artykułem albo reklamą jest sekcja komentarzy, w której rzekomi czytelnicy chwalą produkt albo pokazują zarobki, ale wpisano ją w kod strony, a nie pochodzi z prawdziwej wtyczki serwisu. |
| `fake_app_store` | fałszywy sklep z aplikacjami | Strona udaje sklep z aplikacjami (Google Play, App Store) z oceną, liczbą pobrań i przyciskiem „Zainstaluj”. |
| `back_trap` | pułapka „wstecz” | Strona przejmuje przycisk „wstecz” przeglądarki, więc po jego naciśnięciu zostajemy na niej albo trafiamy na kolejną stronę oszusta. |
| `fake_social_post` | udawany post w serwisie społecznościowym | Strona wygląda jak post z serwisu społecznościowego (Facebook, X) z polubieniami i komentarzami, choć jest zwykłą stroną oszusta. |
| `recent_purchase_popup` | wyskakujące „ktoś właśnie kupił” (sklep) | Na stronie wyskakują okienka, że ktoś przed chwilą kupił produkt („Anna z Poznania kupiła 2 min temu”). |
| `low_stock_claim` | „ostatnie sztuki” i „ogląda N osób” (sklep) | Strona twierdzi, że zostały ostatnie sztuki albo że produkt ogląda w tej chwili wiele osób. |
| `countdown_timer` | licznik czasu przy ofercie (sklep) | Przy ofercie widać licznik, który odlicza czas do końca promocji. |
| `closing_down_story` | historia o likwidacji sklepu (sklep) | Strona opowiada, że sklep się likwiduje, zamyka albo jest wyprzedaż przed zamknięciem, i dlatego ceny są bardzo niskie. |
| `crypto_discount` | dodatkowy rabat za płatność kryptowalutą (sklep) | Strona oferuje dodatkowy rabat za zapłatę kryptowalutą. |
| `waitlist_upsell` | rabat jako zapis na listę oczekujących z dopłatą (sklep) | Rabat jest przedstawiony jako zapis na listę oczekujących, a po zapisie pojawia się dopłata albo dodatkowa usługa. |
| `trial_subscription` | okres próbny z automatycznym odnowieniem subskrypcji (sklep) | Oferta „za 1 zł” albo darmowy okres próbny, po którym płatność odnawia się automatycznie jako droga subskrypcja. |
| `blik_via_messenger` | kod BLIK przez komunikator (sklep) | Strona każe podać kod BLIK albo zapłacić przez rozmowę w komunikatorze (np. Messenger). |
| `fake_courier_payment` | strona udająca kuriera z polem karty i wyborem paczkomatu (sklep) | Strona udaje kuriera (np. InPost, DHL): prosi o dopłatę do paczki, ma pole karty i wybór paczkomatu. |

## 4. Tematy i haczyki narracji

**Tematy** (o czym jest reklama; w nawiasie podkategorie):

- `investment`: inwestycje i zarobek
- `subsidy`: dotacje i świadczenia
- `health`: zdrowie (joints, weight_loss, hypertension, vision, hearing, diabetes, miracle_cure)
- `gambling`: hazard
- `elections`: wybory
- `ai_trading`: handel z użyciem AI
- `gold_reserve`: rezerwy złota
- `commodities_war`: surowce i wojna
- `leaked_secret`: ujawniona tajemnica
- `testimonial_small_win`: relacja o szybkim zysku
- `recovery`: odzyskiwanie środków
- `sport_event`: wydarzenie sportowe
- `inauguration`: zaprzysiężenie
- `state_investment`: inwestycje państwowe
- `adult_phishing`: treści 18+ i potwierdzenie wieku
- `urgent_notice`: pilne wezwanie
- `petition`: petycja
- `tech_support`: fałszywa pomoc techniczna (wirus, zablokowany komputer)
- `refund_overpayment`: zwrot nadpłaty („przelaliśmy za dużo”)
- `recovery_offer`: oferta odzyskania utraconych środków (wtórne oszustwo wobec ofiar)
- `job_offer`: oferta pracy (zdalna, oceny produktów za prowizję)
- `fake_authority`: udawany organ (policja, KNF, UODO, CERT, bank)

**Haczyki** (forma przekazu, niezależna od tematu):

- `sensation`: sensacja
- `endorsement`: polecenie przez znaną osobę
- `fake_interview`: udawany wywiad
- `secrecy`: tajemnica (nie mów bankowi ani rodzinie)
- `withdrawal_fee`: opłata lub podatek przed wypłatą
- `urgency_lock`: grożenie blokadą konta w terminie
- `nationwide`: „cała Polska” (powszechność)
- `millions_of_poles`: „miliony Polaków”
- `pharma_villain`: koncerny farmaceutyczne jako winowajca
- `state_program_pays`: program państwowy pokrywa koszty
- `custody`: kajdanki lub areszt
- `video_removed`: nagranie usunięto lub zablokowano

## Bez opisu

Wszystko w rejestrach ma polską nazwę i opis.

## 5. Podsumowanie

| Sekcja | Liczba |
|---|---|
| Wyróżnione ślady (sekcja na początku) | 11 |
| Ślady łączące (typy) | 61 (kampania: 32, grupa: 3, tylko z innym śladem: 26) |
| Cechy materiału łączące albo pomagające | 18 |
| Atrybuty materiału i kampanii | 86 |
| Techniki manipulacji | 17 |
| Tematy narracji | 22 |
| Haczyki narracji | 12 |
| Bez opisu | 0 |

Wygenerowano: 2026-11-22, commit `74d54de`.

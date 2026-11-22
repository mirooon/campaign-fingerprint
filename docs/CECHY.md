# Katalog cech

Plik generowany: `bun run features:catalog`. Nie edytuj ręcznie.

Łączenie działa tak: każdy ślad ma wagę (typ × lista × częstość występowania), a materiały trafiają do jednej kampanii, gdy łączy je mocny ślad albo co najmniej 2 różne rodzaje śladów; ślady „tylko z innym śladem” nigdy nie łączą samodzielnie, a ślady „grupy” łączą tylko podobne kampanie (szczegóły i progi w [METODYKA.md](METODYKA.md)).

## 1. Ślady łączące

Próg mocnego śladu: 0.7; minimalny wynik krawędzi: 0.15; wspólny ślad występujący w więcej niż 400 materiałach jest pomijany (maxPivotDf). Poziom: **kampania** (może łączyć w jedną kampanię), **grupa** (tylko podobne kampanie), **tylko z innym śladem** (wspiera, nie łączy samodzielnie).

| Typ | Nazwa | Waga | Poziom | Skąd |
|---|---|---|---|---|
| `url` | Adres strony | 1 | kampania | Pełny adres strony, do której prowadzi reklama. |
| `host` | Host | 0.95 | kampania | Nazwa serwera z adresu strony, razem z subdomeną. |
| `domain` | Domena | 0.95 | kampania | Adres strony, np. przyklad.test. Oszuści często rejestrują nowe domeny na kilka dni. |
| `ip` | Adres IP | 0.6 | kampania | Numer serwera, na którym działa strona. |
| `asn` | Sieć (ASN) | 0.05 | kampania | Numer sieci operatora, w której stoi serwer. |
| `nameserver` | Serwery nazw (NS) | 0.35 | kampania | Serwery, które wskazują, gdzie działa domena. |
| `registrar` | Rejestrator | 0.05 | kampania | Firma, w której kupiono domenę. |
| `cert` | Certyfikat HTTPS | 0.8 | kampania | Plik potrzebny stronie do działania przez https. Każdy certyfikat trafia do publicznego rejestru. |
| `tracker` | Tracker, piksel | 1 | kampania | Kod firmy reklamowej albo analitycznej z identyfikatorem konta. |
| `favicon` | Favicon | 0.5 | tylko z innym śladem | Mała ikona strony w karcie przeglądarki. |
| `imagehash` | Odcisk obrazu | 0.65 | tylko z innym śladem | Skrót obrazu reklamy, odporny na drobne zmiany. |
| `wallet` | Portfel kryptowalut | 1 | kampania | Adres portfela, na który strona każe wpłacać. |
| `email` | E-mail | 0.9 | kampania | Adres e-mail podany na stronie. |
| `phone` | Telefon | 0.9 | kampania | Numer telefonu podany na stronie. |
| `telegram` | Telegram | 0.9 | kampania | Kanał albo konto Telegram podane na stronie. |
| `advertiser` | Reklamodawca | 0.6 | kampania | Nazwa profilu, który opublikował reklamę. Cecha materiału: Reklamodawca. |
| `endpoint` | Backend formularza | 0.95 | tylko z innym śladem | Adres, na który strona wysyła dane z formularza. |
| `hidden_fields` | Ukryte pola formularza | 0.6 | tylko z innym śladem | Zestaw nazw niewidocznych pól w formularzu strony. |
| `asset` | Plik JS/CSS | 0.55 | tylko z innym śladem | Własny plik skryptu albo stylów strony. |
| `comment` | Komentarz w kodzie | 0.6 | tylko z innym śladem | Notatka programisty zostawiona w kodzie strony. |
| `domain_pattern` | Wzorzec nazwy domeny | 0.6 | kampania | Powtarzalny schemat nazw domen, np. zwrot<liczba>-<słowo>.test. |
| `cname_target` | Przekierowanie domeny (CNAME) | 0.65 | kampania | Wpis, który kieruje domenę na inny serwer. |
| `campaign_param` | Parametr kampanii | 0.8 | kampania | Znacznik kampanii dopisany do linku reklamy (np. utm_campaign). |
| `persona` | Persona | 0.1 | grupa | Osoba, pod którą podszywa się reklama. |
| `path_id` | Identyfikator konta w ścieżkach | 0.85 | kampania | Losowy identyfikator w adresach plików strony, nadany przez kreator stron. |
| `param_schema` | Szablon linku śledzącego | 0.12 | tylko z innym śladem | Nazwy parametrów linku i rodzaj ich wartości. |
| `platform_account` | Konto na platformie stron | 0.9 | kampania | Identyfikator właściciela w narzędziu do budowy stron. Cecha materiału: Konto na platformie stron. |
| `platform_campaign` | Kampania na platformie stron | 0.95 | kampania | Kampania w panelu platformy stron, nazwana przez kupującego ruch. |
| `page_template` | Szablon strony na platformie | 0.35 | tylko z innym śladem | Gotowy szablon, z którego zbudowano stronę na platformie. |
| `click_server` | Serwer kliknięć | 0.6 | kampania | Serwer, który przekierował kliknięcie w reklamę (zapisany w identyfikatorze kliknięcia). |
| `meta_ad` | Identyfikator reklamy | 0.95 | kampania | Numer klikniętej reklamy zapisany w linku. |
| `ad_payer` | Płatnik reklamy | 0.65 | tylko z innym śladem | Płatnik zadeklarowany platformie reklamowej (biblioteka reklam). |
| `comment_block` | Blok fałszywych komentarzy | 0.45 | tylko z innym śladem | Zestaw zmyślonych komentarzy wpisany na stałe w stronę. |
| `technique` | Technika strony | 0.2 | grupa | Sposób działania strony, np. fałszywy sklep z aplikacjami, pułapka „wstecz”, licznik presji, blokada narzędzi deweloperskich, kit formularza sieci CPA (kit:formFb). |
| `crm_key` | Klucz API CRM | 0.95 | kampania | Tajny klucz konta w CRM albo sieci afiliacyjnej, z którym formularz wysyła zgłoszenie. Pokazujemy tylko skrót (początek, koniec i sha256), nigdy cały klucz. |
| `template_phrase` | Zdanie szablonu | 0.45 | tylko z innym śladem | Rzadkie zdanie z tekstu strony albo z podziękowania po wysłaniu formularza, takie samo na stronach w różnych domenach. Zdanie z wpadką (powtórzone słowa, mieszane alfabety) waży więcej. |
| `profit_claim` | Obiecywany zysk | 0.2 | grupa | Kwota i okres obiecywanego zarobku z tekstu, zrzutu albo nagrania. |
| `kit_string` | Komunikat ze skryptu zestawu | 0.5 | tylko z innym śladem | Komunikat programisty zapisany w skrypcie strony (log w konsoli, błąd, ostrzeżenie), często z literówką, taki sam na stronach w różnych domenach. Skrypty platformy stron (SDK), paczki frameworków i znane biblioteki są pomijane. |
| `shared_doc` | Dokument, formularz lub czat udostępniony linkiem | 0.9 | kampania | Adres dokumentu, arkusza, formularza (Google, Notion, Microsoft Forms, Typeform, Jotform) albo udostępnionej rozmowy z modelem językowym, podany na stronie, w reklamie, na zrzucie albo w ruchu strony. |
| `onion` | Adres .onion | 0.9 | kampania | Adres ukrytej usługi w sieci Tor (wersja 3, 56 znaków). |
| `messenger_invite` | Zaproszenie lub konto komunikatora | 0.9 | kampania | Zaproszenie na Discorda, konto albo grupa Signal, Viber lub Line podane na stronie, w reklamie albo na zrzucie. |
| `c2_host` | Serwer C2 trojana w zestawie strony | 0.95 | kampania | Adres serwera, do którego skrypt skopiowanego zestawu strony (np. fałszywa biblioteka lazysizes) wysyła ciasteczka lub dane logowania z fałszywego panelu trackera. |
| `fictional_expert` | Zmyślony ekspert | 0.75 | kampania | Tytuł „dr” lub „prof.” z imieniem i nazwiskiem, którego nie ma na liście osób publicznych (np. „dr Jan Testowy”), użyty na stronie, w reklamie lub na zrzucie jako autorytet. Cecha materiału: Zmyślony lekarz (prawdopodobnie AI). |
| `lead_flow` | Lejek leadów platformy stron | 0.5 | tylko z innym śladem | Ten sam formularz, lista przepływów albo klucz zdarzeń zapisane w kodzie stron z jednej platformy. |
| `overlay_template` | Szablon podmienionych napisów | 0.45 | tylko z innym śladem | Układ montażu: rozmyty lub zakryty pasek na dole cudzego nagrania i własne napisy operatora (rodzaj, kolor, położenie i rozmiar względem kadru). |
| `reused_footage` | Znak źródła cudzego nagrania | 0.45 | tylko z innym śladem | Nazwa lub logo studia albo stacji w rogu kadru: znak oryginału, z którego wzięto nagranie. Znaki edytorów i platform (CapCut, TikTok i inne) są pomijane. |
| `company_id` | Identyfikator firmy na stronie | 0.5 | tylko z innym śladem | Numer firmy podany w stopce, regulaminie albo danych sprzedawcy: NIP, REGON, KRS, unijny numer VAT, numer spółki w Wielkiej Brytanii. |
| `bank_account` | Rachunek bankowy na stronie | 0.8 | tylko z innym śladem | Numer rachunku (IBAN albo polski NRB) podany jako konto do wpłat. |
| `postal_address` | Adres siedziby sklepu | 0.5 | tylko z innym śladem | Pełny adres podany na stronie: ulica, numer, kod pocztowy i miasto (zapis ujednolicony: „ul.” i „ulica”, kod z myślnikiem i bez to ten sam adres). |
| `cloaker_account` | Konto klienta cloakera | 0.9 | kampania | Numer klienta (cl_sid) w serwisie ukrywającym stronę przed moderacją, zapisany przez platformę stron razem z domeną cloakera (cl_domain). |
| `launcher_account` | Konto narzędzia do uruchamiania reklam | 0.9 | kampania | Identyfikator (launcher) konta, z którego uruchomiono reklamy, zapisany przez platformę stron, gdy różni się od właściciela strony. |
| `affiliate_account` | Konto w sieci afiliacyjnej | 0.9 | kampania | Identyfikatory partnera sieci afiliacyjnej w linku zamówienia, zakodowanym parametrze referer albo w ukrytych polach formularza: zespół i użytkownik (team_id, user_id), strumień (stream_id) albo oferta (offer_uuid), zawsze razem z adresem sieci. |
| `hosting_account` | Konto na hostingu wideo | 0.6 | tylko z innym śladem | Biblioteka wideo jednego klienta usługi hostingu (adres hosta wideo z identyfikatorem biblioteki). |
| `similar_image` | Podobna kreacja (podobieństwo dwóch materiałów) | 0.6 | tylko z innym śladem | Obrazy reklam różnią się tylko drobiazgami. |
| `similar_image_semantic` | Podobny obraz (podobieństwo dwóch materiałów) | 0.45 | tylko z innym śladem | Obrazy przedstawiają to samo, choć nie są kopią. |
| `similar_text` | Podobny tekst (podobieństwo dwóch materiałów) | 0.5 | tylko z innym śladem | Teksty reklam są do siebie bardzo podobne. |
| `similar_dom` | Ten sam układ strony (podobieństwo dwóch materiałów) | 0.45 | tylko z innym śladem | Strony mają taką samą budowę kodu. |
| `similar_audio` | Ten sam podkład audio (podobieństwo dwóch materiałów) | 0.5 | tylko z innym śladem | Nagrania mają tę samą ścieżkę dźwiękową. |
| `similar_voice` | Ten sam głos (podobieństwo dwóch materiałów) | 0.4 | tylko z innym śladem | W nagraniach mówi ten sam głos. |

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

## 3. Techniki manipulacji

Pole `techniques[]`. Atrybut i ślad grupy, nie dowód jednej kampanii. Techniki sklepowe tylko opisują stronę sklepu.

| Klucz | Nazwa | Opis |
|---|---|---|
| `fake_security_alert` | fałszywy alarm bezpieczeństwa z numerem telefonu | Strona straszy wirusem, zablokowanym komputerem albo zhakowanym kontem, podaje numer telefonu jako jedyne wyjście i nie pozwala łatwo jej opuścić (pełny ekran, okna alertu, pułapka „wstecz”, dźwięk alarmu). |
| `remote_access_tool` | program do zdalnego pulpitu do pobrania | Link albo instrukcja pobrania programu do zdalnego pulpitu (np. AnyDesk, TeamViewer QuickSupport) z prośbą o podanie kodu dostępu. |
| `clickfix_paste` | fałszywa weryfikacja z poleceniem do wklejenia | Fałszywy CAPTCHA albo „weryfikacja, że nie jesteś robotem” każe nacisnąć skrót (np. Win+R) i wkleić polecenie, które strona skopiowała do schowka. |
| `fake_comments` | fałszywe komentarze |  |
| `fake_app_store` | fałszywy sklep z aplikacjami |  |
| `back_trap` | pułapka „wstecz” |  |
| `fake_social_post` | udawany post w serwisie społecznościowym |  |
| `recent_purchase_popup` | wyskakujące „ktoś właśnie kupił” (sklep) |  |
| `low_stock_claim` | „ostatnie sztuki” i „ogląda N osób” (sklep) |  |
| `countdown_timer` | licznik czasu przy ofercie (sklep) |  |
| `closing_down_story` | historia o likwidacji sklepu (sklep) |  |
| `crypto_discount` | dodatkowy rabat za płatność kryptowalutą (sklep) |  |
| `waitlist_upsell` | rabat jako zapis na listę oczekujących z dopłatą (sklep) |  |
| `trial_subscription` | okres próbny z automatycznym odnowieniem subskrypcji (sklep) |  |
| `blik_via_messenger` | kod BLIK przez komunikator (sklep) |  |
| `fake_courier_payment` | strona udająca kuriera z polem karty i wyborem paczkomatu (sklep) |  |

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

- atrybut: personaCategories (jest w FEATURE_KEYS, brak wpisu w FEATURE_INFO)
- atrybut: platformSourceIds (jest w FEATURE_KEYS, brak wpisu w FEATURE_INFO)
- atrybut: cloakerInSource (jest w FEATURE_KEYS, brak wpisu w FEATURE_INFO)
- atrybut: platformAccountSource (jest w FEATURE_KEYS, brak wpisu w FEATURE_INFO)
- atrybut: platformAccountWarning (jest w FEATURE_KEYS, brak wpisu w FEATURE_INFO)
- atrybut: platformTenants (jest w FEATURE_KEYS, brak wpisu w FEATURE_INFO)
- atrybut: infrastructure (jest w FEATURE_KEYS, brak wpisu w FEATURE_INFO)
- atrybut: techniques (jest w FEATURE_KEYS, brak wpisu w FEATURE_INFO)
- atrybut: creativeBrand (jest w FEATURE_KEYS, brak wpisu w FEATURE_INFO)
- atrybut: domainAgeDays (jest w FEATURE_KEYS, brak wpisu w FEATURE_INFO)
- atrybut: certAgeDays (jest w FEATURE_KEYS, brak wpisu w FEATURE_INFO)
- atrybut: pagePlatforms (jest w FEATURE_KEYS, brak wpisu w FEATURE_INFO)
- atrybut: inputExtra (jest w FEATURE_KEYS, brak wpisu w FEATURE_INFO)
- atrybut: namingMixedScript (jest w FEATURE_KEYS, brak wpisu w FEATURE_INFO)
- atrybut: codeCommentLang (jest w FEATURE_KEYS, brak wpisu w FEATURE_INFO)
- atrybut: landerSlugStyle (jest w FEATURE_KEYS, brak wpisu w FEATURE_INFO)
- atrybut: advertiserNameStyle (jest w FEATURE_KEYS, brak wpisu w FEATURE_INFO)
- atrybut: adCreatedApprox (jest w FEATURE_KEYS, brak wpisu w FEATURE_INFO)
- technika: fake_comments (brak wpisu w TECHNIQUE_INFO)
- technika: fake_app_store (brak wpisu w TECHNIQUE_INFO)
- technika: back_trap (brak wpisu w TECHNIQUE_INFO)
- technika: fake_social_post (brak wpisu w TECHNIQUE_INFO)
- technika: recent_purchase_popup (brak wpisu w TECHNIQUE_INFO)
- technika: low_stock_claim (brak wpisu w TECHNIQUE_INFO)
- technika: countdown_timer (brak wpisu w TECHNIQUE_INFO)
- technika: closing_down_story (brak wpisu w TECHNIQUE_INFO)
- technika: crypto_discount (brak wpisu w TECHNIQUE_INFO)
- technika: waitlist_upsell (brak wpisu w TECHNIQUE_INFO)
- technika: trial_subscription (brak wpisu w TECHNIQUE_INFO)
- technika: blik_via_messenger (brak wpisu w TECHNIQUE_INFO)
- technika: fake_courier_payment (brak wpisu w TECHNIQUE_INFO)

## 5. Podsumowanie

| Sekcja | Liczba |
|---|---|
| Ślady łączące (typy) | 59 (kampania: 31, grupa: 3, tylko z innym śladem: 25) |
| Cechy materiału łączące albo pomagające | 17 |
| Atrybuty materiału i kampanii | 86 |
| Techniki manipulacji | 16 |
| Tematy narracji | 22 |
| Haczyki narracji | 12 |
| Bez opisu | 31 |

Wygenerowano: 2026-11-22, commit `4c01d2a`.

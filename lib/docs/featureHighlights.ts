/**
 * Registry of the highlighted traces of docs/CECHY.md: the traces that typical OSINT tools (WHOIS, DNS,
 * IP, urlscan, image hash) do not give, with how we read them and what they did on the organiser's
 * sample. Only aggregate counts of the sample run are written here, never its values (domains, IDs,
 * account or campaign names). Every key must exist in TYPE_INFO (pivot types) or FEATURE_INFO
 * (material attributes); collectCatalog reports a missing one under "Bez opisu".
 */

/** One highlighted trace or a group of traces read by the same mechanism. */
export interface FeatureHighlight {
  /** Stable id of the entry. */
  id: string;
  /** Heading of the entry (Polish). */
  title: string;
  /** Pivot types covered by the entry (keys of TYPE_INFO). */
  types: string[];
  /** Material attributes covered by the entry (keys of FEATURE_INFO). */
  attributes: string[];
  /** How the trace is read (the mechanism). */
  how: string;
  /** What typical tools (WHOIS, DNS, IP, page scanners, image hash) do not see. */
  missed: string;
  /** What the trace did on the organiser's sample: aggregate counts only. */
  sample: string;
}

/** The sample run the counts in `FeatureHighlight.sample` come from. */
export const HIGHLIGHTS_SAMPLE = { materials: 28, commit: "b3ee946" } as const;

/** Highlighted traces, in the order they appear in docs/CECHY.md. */
export const FEATURE_HIGHLIGHTS: FeatureHighlight[] = [
  {
    id: "platform-record",
    title: "Rekord panelu platformy stron",
    types: ["path_id", "platform_account", "platform_campaign", "cloaker_account", "launcher_account"],
    attributes: ["platformSourceIds", "landingName", "trafficSource"],
    how: "Kreator stron zapisuje w kodzie strony swój rekord konfiguracji. Czytamy z niego identyfikator właściciela konta, nazwę kampanii nadaną przez kupującego ruch, nazwę strony w panelu, źródło ruchu, numer klienta cloakera (cl_sid) i konto, z którego uruchomiono reklamy (launcher). Kreator nadaje też losowy identyfikator, który wraca w ścieżkach plików strony.",
    missed: "Domeny i adresy IP zmieniają się co kilka dni, a konto w panelu zostaje. WHOIS, DNS ani skan strony nie pokazują, kto w panelu kupił ruch i przez który cloaker go puścił.",
    sample: "Konto platformy odczytane w 14 z 28 materiałów. Mocna przesłanka w parach: identyfikator w ścieżkach plików w 28 parach, konto w 30, kampania w panelu w 17. Klient cloakera i konto launchera wystąpiły po razie, bez pary w próbce, więc ich łączenie sprawdza test.",
  },
  {
    id: "meta-token",
    title: "Token dostępu Mety zostawiony w kodzie strony",
    types: ["meta_token"],
    attributes: [],
    how: "Operatorzy wklejają do strony token konta reklamowego Mety, którym wysyłają zdarzenia konwersji: w adresie (token=), w rekordzie platformy stron (fb_capi_token) albo w skrypcie. Zapisujemy tylko początek skrótu sha256 (12 znaków), nigdy sam token.",
    missed: "Skanery stron widzą piksel Mety, a numer piksela bywa zmieniany i współdzielony. Token należy do jednego konta reklamowego i trafia na stronę przez nieuwagę operatora.",
    sample: "6 różnych tokenów, mocna przesłanka w 13 parach.",
  },
  {
    id: "click-server",
    title: "Serwer kliknięć odczytany z identyfikatora kliknięcia",
    types: ["click_server"],
    attributes: ["clickTime", "clickCounter"],
    how: "Identyfikator kliknięcia w formacie xid (12 bajtów) zawiera czas, identyfikator maszyny, numer procesu i licznik trackera. Dekodujemy go: ta sama maszyna i ten sam proces to ten sam serwer przekierowań, czas to chwila kliknięcia, a licznik rośnie z każdym identyfikatorem wydanym przez ten proces.",
    missed: "Tracker stoi za przekierowaniem i nie zostawia swojej domeny na stronie docelowej. Identyfikator kliknięcia wygląda jak losowy ciąg, więc narzędzia go pomijają.",
    sample: "Czas i licznik odczytane w 3 materiałach. Jedna para: materiał z pierwszej paczki od organizatora połączył się z materiałem z drugiej paczki przez ten sam serwer trackera.",
  },
  {
    id: "meta-ad",
    title: "Numer reklamy z linku i przybliżona data jej utworzenia",
    types: ["meta_ad"],
    attributes: ["metaAdId", "metaAppId", "adCreatedApprox"],
    how: "Nowy format parametru fbclid w linku niesie identyfikator klikniętej reklamy i aplikacji. Identyfikatory Mety rosną z czasem, więc z innych reklam o znanej dacie szacujemy, kiedy utworzono daną reklamę.",
    missed: "Biblioteka reklam szuka po własnym numerze, a link daje numer reklamy z panelu reklamodawcy. Bez dekodowania fbclid ten numer ginie w długim parametrze.",
    sample: "Numer reklamy odczytany w 8 z 28 materiałów. Każdy z nich dotyczył innej reklamy, więc w próbce ślad nie łączył par. Służy do osi czasu i do rozpoznania kolejnej odsłony tej samej reklamy.",
  },
  {
    id: "stealer-kit",
    title: "Trojan w kradzionym zestawie stron",
    types: ["c2_host"],
    attributes: ["stealerKit"],
    how: "Część zestawów stron krąży z dopisanym trojanem. Fałszywa biblioteka (np. lazysizes albo jQuery z darmowego hostingu) sprawdza, czy przeglądarka jest w panelu trackera (/admin, /panel), i wysyła ciasteczka albo dane logowania na obcy serwer. Oznaczamy zestaw i zapisujemy adres serwera C2.",
    missed: "Skaner widzi znaną nazwę biblioteki i nie zagląda do środka. Tu oszuści okradają innych oszustów, a wszystkie kopie zestawu zgłaszają się do jednego serwera, więc jego adres łączy kopie.",
    sample: "1 materiał z takim zestawem, bez pary w próbce. Łączenie po serwerze C2 sprawdza test.",
  },
  {
    id: "text-fingerprint",
    title: "Odcisk tekstu: komunikaty programisty i zdania szablonu",
    types: ["kit_string", "template_phrase"],
    attributes: [],
    how: "Ze skryptów strony bierzemy komunikaty programisty (log w konsoli, błąd, ostrzeżenie), często z literówką. Z tekstu strony i podziękowania po wysłaniu formularza bierzemy rzadkie zdania; zdanie z wpadką (powtórzone słowo, mieszane alfabety) waży więcej. Liczy się tylko tekst obecny w kilku domenach, a teksty platform, frameworków i znanych bibliotek są maskowane.",
    missed: "Hash strony zmienia się po każdej podmianie obrazka, ceny czy domeny. Literówka w logu i dziwne zdanie przechodzą z kopii na kopię bez zmian.",
    sample: "Wspólny komunikat programisty w 4 parach, wspólne zdanie szablonu w 17 parach. Oba ślady łączą tylko razem z innym śladem.",
  },
  {
    id: "comments-lead-flow",
    title: "Fałszywe komentarze i wspólny lejek leadów",
    types: ["comment_block", "lead_flow"],
    attributes: [],
    how: "Komentarze „czytelników” są wpisane na stałe w kod strony. Zapisujemy zestaw autorów, a pospolite imiona, częste w blokach innych stron, ważą mniej. Z kodu stron jednej platformy bierzemy identyfikator formularza, listę przepływów i klucz zdarzeń lejka leadów.",
    missed: "Blok komentarzy wygląda jak wtyczka serwisu, a lejek zaczyna działać dopiero po wysłaniu formularza. Skan infrastruktury nie widzi żadnego z nich.",
    sample: "Ten sam blok komentarzy w 15 parach. Wspólny lejek w 1 parze stron z różnych kont i różnych platform reklamowych: wynik to grupa podobnych kampanii z jednym dostawcą leadów.",
  },
  {
    id: "video-montage",
    title: "Odcisk montażu wideo",
    types: ["overlay_template", "reused_footage"],
    attributes: [],
    how: "W klatkach nagrania szukamy rozmytego albo zakrytego paska na dole cudzego filmu i napisów operatora. Zapisujemy rodzaj, kolor, położenie i rozmiar względem kadru, zaokrąglone do 5%. W rogach kadru czytamy znak studia albo stacji, z której wzięto nagranie; znaki edytorów i platform (CapCut, TikTok i inne) pomijamy.",
    missed: "Porównanie obrazów i hash klatek widzą inny film, bo operator za każdym razem bierze inne nagranie. Układ napisów i znak źródła zostają te same.",
    sample: "Szablon napisów w 1 materiale, 2 różne znaki źródła; w próbce bez pary. Łączenie sprawdza test.",
  },
  {
    id: "voice-gallery",
    title: "Głos osoby publicznej z zamkniętej galerii",
    types: ["similar_voice"],
    attributes: ["personas", "personaCategories"],
    how: "Ścieżkę dźwiękową tniemy na okna po 4 s, odrzucamy ciszę i samą muzykę, liczymy wektor mówcy (ECAPA) i porównujemy go z galerią 10 osób publicznych. Wynik to „głos podobny do X (0,57)” do przeglądu przez człowieka, a persona jest cechą grupy podobnych kampanii. Ten sam wektor łączy dwa nagrania z tym samym głosem.",
    missed: "Detektory fałszywego głosu oceniają, czy nagranie jest sztuczne, a ich błąd na prawdziwych reklamach (EER) wynosi 25–60%. Nam wystarcza odpowiedź, czyj głos udaje nagranie.",
    sample: "Pomiar na nagraniach spoza próbki (docs/METODYKA.md): ta sama osoba rozpoznana w 70 z 70 nagrań, fałszywe trafienie w 1 z 25 nagrań obcych osób, a 5 z 5 fałszywek z publicznej kompilacji NASK przypisanych właściwej osobie.",
  },
  {
    id: "fictional-expert",
    title: "Zmyślony ekspert",
    types: ["fictional_expert"],
    attributes: ["fictionalExperts", "expertNotInRegister"],
    how: "Szukamy tytułu „dr” lub „prof.” z imieniem i nazwiskiem, którego nie ma na liście osób publicznych, w reklamie, na zrzucie, w nagraniu i na stronie. Warianty pisowni scalamy w całym zbiorze. Opcjonalna wtyczka sprawdza nazwisko w rejestrze lekarzy i dodaje etykietę.",
    missed: "Rozpoznawanie osób szuka znanych twarzy i nazwisk. Zmyślony lekarz nie istnieje poza kampanią, więc jego nazwisko łączy jej materiały.",
    sample: "4 nazwiska w 2 materiałach, bez pary w próbce. Łączenie sprawdza test.",
  },
  {
    id: "origin-traces",
    title: "Ślady w adresach i w kodzie: udawany adres, zegar Discorda, poprzednia wersja",
    types: [],
    attributes: ["idnConfusable", "discordSnowflakes", "foreignPersona", "residue"],
    how: "Oznaczamy adres, w którym znak udaje „/”, „.” lub „-” albo miesza alfabety. Z górnych bitów identyfikatora serwera lub konta Discord odczytujemy datę jego utworzenia. Persona z innego kraju w nazwie reklamy przy polskiej wersji i wykomentowany stary akapit w kodzie podpowiadają, że zestaw przeniesiono z innego rynku albo z wcześniejszej kampanii.",
    missed: "To cechy treści i identyfikatorów. Nie ma ich w rekordach domeny, w DNS ani w skanie infrastruktury.",
    sample: "Wykomentowana stara wersja w 15 z 28 materiałów, persona z innego kraju w 1. Adresu udającego inny adres ani linku do Discorda w próbce nie było; działanie sprawdzają testy.",
  },
];

/** Pivot types marked with a star in the table of docs/CECHY.md section 1. */
export function highlightedTypes(highlights: FeatureHighlight[] = FEATURE_HIGHLIGHTS): Set<string> {
  return new Set(highlights.flatMap((h) => h.types));
}

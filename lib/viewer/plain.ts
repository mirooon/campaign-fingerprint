/**
 * Plain-Polish dictionary of the GUI: what every feature type is, why it matters for linking, an
 * example, and the sentence a premise of that type becomes. Also the glossary (§9) used by the "?"
 * bubbles and the Słowniczek page, and the help notes moved here from the expert DetailsPanel.
 */
import { CREATIVE_FILE_PREFIX, type EntityType, type NearMissRule, type SimilarityEdgeType } from "@/lib/graph/model";
import type { ShopFlag } from "@/lib/osint/shopSignals";
import { familyOf, type FeatureFamily } from "./families";

export interface TypeInfo {
  /** Name of the feature in the GUI. */
  name: string;
  /** What it is. */
  what: string;
  /** Why it matters when linking. */
  why: string;
  example: string;
  /** Sentence of a premise of this type ("Obie …"). */
  sentence: string;
}

type AnyType = EntityType | SimilarityEdgeType;

export const TYPE_INFO: Record<AnyType, TypeInfo> = {
  item: { name: "Materiał", what: "Jedna reklama razem z zebranymi plikami.", why: "Materiały łączymy po wspólnych śladach.", example: "zrzut reklamy z zapisaną stroną", sentence: "Ten sam materiał" },
  url: { name: "Adres strony", what: "Pełny adres strony, do której prowadzi reklama.", why: "Ten sam adres w dwóch reklamach to niemal pewnie ten sam operator.", example: "przyklad.test/start", sentence: "Obie reklamy prowadzą pod ten sam adres strony" },
  host: { name: "Host", what: "Nazwa serwera z adresu strony, razem z subdomeną.", why: "Ta sama subdomena to zwykle ta sama strona i ten sam właściciel.", example: "oferta.przyklad.test", sentence: "Obie reklamy prowadzą na ten sam serwer (host)" },
  domain: { name: "Domena", what: "Adres strony, np. przyklad.test. Oszuści często rejestrują nowe domeny na kilka dni.", why: "Wspólna domena łączy materiały samodzielnie, chyba że to duży serwis używany przez wielu.", example: "przyklad.test", sentence: "Obie reklamy prowadzą do tej samej domeny" },
  ip: { name: "Adres IP", what: "Numer serwera, na którym działa strona.", why: "Ten sam mały serwer może wskazywać jednego właściciela; wspólne adresy dużych firm hostingowych pomijamy.", example: "192.0.2.10", sentence: "Strony działają na tym samym adresie IP" },
  asn: { name: "Sieć (ASN)", what: "Numer sieci operatora, w której stoi serwer.", why: "W jednej sieci są tysiące niezależnych stron, więc to słaby ślad.", example: "AS64500", sentence: "Serwery stoją w tej samej sieci operatora" },
  nameserver: { name: "Serwery nazw (NS)", what: "Serwery, które wskazują, gdzie działa domena.", why: "Ta sama nietypowa para serwerów może łączyć domeny jednego właściciela.", example: "ns1.dns-przyklad.test", sentence: "Domeny korzystają z tych samych serwerów nazw" },
  registrar: { name: "Rejestrator", what: "Firma, w której kupiono domenę.", why: "Popularny rejestrator mówi niewiele, rejestracje seriami mówią więcej.", example: "Rejestrator Przykładowy", sentence: "Domeny kupiono u tego samego rejestratora" },
  cert: { name: "Certyfikat HTTPS", what: "Plik potrzebny stronie do działania przez https. Każdy certyfikat trafia do publicznego rejestru.", why: "Jeden certyfikat na kilka domen zwykle wystawia jeden właściciel; darmowe urzędy certyfikacji pomijamy.", example: "certyfikat dla a.test i b.test", sentence: "Domeny mają wspólny certyfikat HTTPS" },
  tracker: { name: "Tracker, piksel", what: "Kod firmy reklamowej albo analitycznej z identyfikatorem konta.", why: "Ten sam identyfikator na dwóch stronach zwykle oznacza tego samego właściciela.", example: "Meta Pixel 000000000000001", sentence: "Strony mają ten sam identyfikator trackera (konto analityczne lub reklamowe)" },
  favicon: { name: "Favicon", what: "Mała ikona strony w karcie przeglądarki.", why: "Ta sama ikona wskazuje ten sam zestaw stron; sama nie wystarcza.", example: "ikona w kształcie logo", sentence: "Strony mają identyczną ikonę (favicon)" },
  imagehash: { name: "Odcisk obrazu", what: "Skrót obrazu reklamy, odporny na drobne zmiany.", why: "Ta sama kreacja w dwóch reklamach to ta sama reklama albo jej wariant.", example: "ta sama grafika z innym podpisem", sentence: "Reklamy mają identyczny obraz" },
  wallet: { name: "Portfel kryptowalut", what: "Adres portfela, na który strona każe wpłacać.", why: "Ten sam portfel to te same pieniądze, więc ten sam operator.", example: "adres portfela TRON", sentence: "Strony podają ten sam portfel kryptowalut" },
  email: { name: "E-mail", what: "Adres e-mail podany na stronie.", why: "Ten sam kontakt na dwóch stronach to zwykle ten sam operator.", example: "kontakt@przyklad.test", sentence: "Strony podają ten sam adres e-mail" },
  phone: { name: "Telefon", what: "Numer telefonu podany na stronie.", why: "Ten sam numer na dwóch stronach to zwykle ten sam operator.", example: "+48 000 000 000", sentence: "Strony podają ten sam numer telefonu" },
  telegram: { name: "Telegram", what: "Kanał albo konto Telegram podane na stronie.", why: "Ten sam kanał kontaktu to zwykle ten sam operator.", example: "t.me/kanal_przyklad", sentence: "Strony kierują do tego samego kanału Telegram" },
  shared_doc: { name: "Dokument, formularz lub czat udostępniony linkiem", what: "Adres dokumentu, arkusza, formularza (Google, Notion, Microsoft Forms, Typeform, Jotform) albo udostępnionej rozmowy z modelem językowym, podany na stronie, w reklamie, na zrzucie albo w ruchu strony.", why: "Taki zasób należy do jednego konta, więc ten sam identyfikator w dwóch materiałach wskazuje jednego operatora. Rozmowa z czatem AI bywa wklejonym planem kampanii.", example: "formularz Google z tym samym identyfikatorem na dwóch stronach", sentence: "Materiały odsyłają do tego samego udostępnionego dokumentu, formularza lub czatu" },
  onion: { name: "Adres .onion", what: "Adres ukrytej usługi w sieci Tor (wersja 3, 56 znaków).", why: "Ten sam adres to ten sam zasób operatora; adresów wersji 2 nie liczymy, bo wygasły.", example: "56 znaków i .onion", sentence: "Materiały podają ten sam adres .onion" },
  c2_host: { name: "Serwer C2 trojana w zestawie strony", what: "Adres serwera, do którego skrypt skopiowanego zestawu strony (np. fałszywa biblioteka lazysizes) wysyła ciasteczka lub dane logowania z fałszywego panelu trackera.", why: "Wszystkie kopie tego samego pobranego zestawu zgłaszają się do tego samego serwera, więc wspólny adres wskazuje jednego operatora zestawu.", example: "c2.przyklad.test", sentence: "Skrypty tych stron wysyłają dane do tego samego serwera C2" },
  messenger_invite: { name: "Zaproszenie lub konto komunikatora", what: "Zaproszenie na Discorda, konto albo grupa Signal, Viber lub Line podane na stronie, w reklamie albo na zrzucie.", why: "To samo zaproszenie lub konto to zwykle ten sam operator (jak kanał Telegram).", example: "discord.gg/kodprzyklad", sentence: "Materiały kierują do tego samego zaproszenia lub konta komunikatora" },
  affiliate_account: { name: "Konto w sieci afiliacyjnej", what: "Identyfikatory partnera sieci afiliacyjnej w linku zamówienia, zakodowanym parametrze referer albo w ukrytych polach formularza: zespół i użytkownik (team_id, user_id), strumień (stream_id) albo oferta (offer_uuid), zawsze razem z adresem sieci.", why: "Strumień i oferta w tej samej sieci należą do jednego partnera, który kupuje ruch. Para zespół i użytkownik to małe liczby, więc sama nie łączy w kampanię: potrzebny drugi ślad.", example: "siec.example.test · team_id=42, user_id=13", sentence: "Materiały kierują leady na to samo konto w sieci afiliacyjnej" },
  advertiser: { name: "Reklamodawca", what: "Nazwa profilu, który opublikował reklamę.", why: "Ten sam profil to to samo konto reklamowe; nazwy bywają jednak ogólne i powtarzalne.", example: "Wiadomości Dnia Demo", sentence: "Reklamy opublikował ten sam reklamodawca" },
  endpoint: { name: "Backend formularza", what: "Adres, na który strona wysyła dane z formularza.", why: "Wspólny backend na różnych domenach to mocny ślad; publiczne serwisy formularzy pomijamy.", example: "zbieracz.test/api/zapis", sentence: "Formularze obu stron wysyłają dane pod ten sam adres" },
  hidden_fields: { name: "Ukryte pola formularza", what: "Zestaw nazw niewidocznych pól w formularzu strony.", why: "Ten sam zestaw wskazuje ten sam szablon strony; sam nie wystarcza.", example: "lp_id, offer_hash", sentence: "Formularze mają ten sam zestaw ukrytych pól" },
  asset: { name: "Plik JS/CSS", what: "Własny plik skryptu albo stylów strony.", why: "Ten sam nietypowy plik wskazuje ten sam zestaw stron; popularne biblioteki pomijamy.", example: "formularz-lead.9f8e.js", sentence: "Strony ładują ten sam własny plik skryptu lub stylów" },
  comment: { name: "Komentarz w kodzie", what: "Notatka programisty zostawiona w kodzie strony.", why: "Ten sam nietypowy komentarz wskazuje ten sam szablon; standardowe komentarze pomijamy.", example: "„wstaw formularz po bloku telefonu”", sentence: "W kodzie stron jest ten sam komentarz programisty" },
  domain_pattern: { name: "Wzorzec nazwy domeny", what: "Powtarzalny schemat nazw domen, np. zwrot<liczba>-<słowo>.test.", why: "Domeny z jednego schematu zwykle rejestruje jeden operator seriami.", example: "zwrot12-abc.test, zwrot37-xyz.test", sentence: "Domeny są zbudowane według tego samego wzorca nazw" },
  cname_target: { name: "Przekierowanie domeny (CNAME)", what: "Wpis, który kieruje domenę na inny serwer.", why: "Wspólny, nietypowy cel przekierowania wskazuje wspólną infrastrukturę; duże sieci CDN pomijamy.", example: "ruch.przyklad.test", sentence: "Domeny są przekierowane na ten sam serwer (CNAME)" },
  campaign_param: { name: "Parametr kampanii", what: "Znacznik kampanii dopisany do linku reklamy (np. utm_campaign).", why: "Ta sama nietypowa wartość to zwykle ta sama kampania reklamowa; ogólne wartości pomijamy.", example: "utm_campaign=lato_07", sentence: "Linki reklam mają ten sam parametr kampanii" },
  fictional_expert: { name: "Zmyślony ekspert", what: "Tytuł „dr” lub „prof.” z imieniem i nazwiskiem, którego nie ma na liście osób publicznych (np. „dr Jan Testowy”), użyty na stronie, w reklamie lub na zrzucie jako autorytet.", why: "Zmyśloną postać wymyśla jeden operator, więc to samo imię i nazwisko (także z literówką) na różnych domenach wskazuje jednego autora. Imię często powtarzane w zbiorze traci wagę.", example: "dr Jan Testowy i dr Jan Testowyy", sentence: "Materiały powołują się na tego samego zmyślonego eksperta" },
  persona: { name: "Persona", what: "Osoba, pod którą podszywa się reklama.", why: "Ta sama osoba pojawia się w wielu niezależnych kampaniach, dlatego sama nie łączy materiałów.", example: "Adam Testowy", sentence: "Reklamy wykorzystują wizerunek tej samej osoby" },
  path_id: { name: "Identyfikator konta w ścieżkach", what: "Losowy identyfikator w adresach plików strony, nadany przez kreator stron.", why: "Ten sam identyfikator to to samo konto w kreatorze stron.", example: "/a1b2c3d4-…/style.css", sentence: "Pliki stron leżą pod tym samym identyfikatorem konta w kreatorze stron" },
  param_schema: { name: "Szablon linku śledzącego", what: "Nazwy parametrów linku i rodzaj ich wartości.", why: "Wskazuje system kierowania ruchem, z którego korzysta wielu klientów: ślad pomocniczy.", example: "sub1, sub2, clickid", sentence: "Linki mają ten sam układ parametrów śledzących" },
  hosting_account: { name: "Konto na hostingu wideo", what: "Biblioteka wideo jednego klienta usługi hostingu (adres hosta wideo z identyfikatorem biblioteki).", why: "Dwie strony z filmami z tej samej biblioteki korzystają z jednego konta, w przeciwieństwie do samej domeny CDN, którą dzielą tysiące niezwiązanych stron. Ślad wspiera powiązanie, nie łączy kampanii sam.", example: "biblioteka 0a1b2c3d", sentence: "Obie strony odtwarzają filmy z tej samej biblioteki wideo" },
  platform_account: { name: "Konto na platformie stron", what: "Identyfikator właściciela w narzędziu do budowy stron.", why: "To samo konto to ten sam operator. Różne konta tej samej platformy nie trafiają do jednej kampanii bez silnej przesłanki.", example: "konto 1a2b…", sentence: "Obie strony należą do tego samego konta na platformie stron" },
  cloaker_account: { name: "Konto klienta cloakera", what: "Numer klienta (cl_sid) w serwisie ukrywającym stronę przed moderacją, zapisany przez platformę stron razem z domeną cloakera (cl_domain).", why: "Ten sam numer na tej samej domenie cloakera to jedno opłacone konto, czyli ten sam operator. Sam numer albo sama domena nie łączą.", example: "konto 12345 na cloak.example.test", sentence: "Obie strony ukrywa przed moderacją to samo konto klienta cloakera" },
  launcher_account: { name: "Konto narzędzia do uruchamiania reklam", what: "Identyfikator (launcher) konta, z którego uruchomiono reklamy, zapisany przez platformę stron, gdy różni się od właściciela strony.", why: "To samo konto narzędzia to ten sam kupujący reklamy. Gdy launcher jest równy właścicielowi strony, liczy się raz, jako konto na platformie stron.", example: "konto 1a2b…", sentence: "Reklamy uruchomiono z tego samego konta narzędzia" },
  platform_campaign: { name: "Kampania na platformie stron", what: "Kampania w panelu platformy stron, nazwana przez kupującego ruch.", why: "Te same strony puszcza ta sama kampania: silny ślad.", example: "kampania „lato-pl”", sentence: "Obie strony puszcza ta sama kampania na platformie stron" },
  page_template: { name: "Szablon strony na platformie", what: "Gotowy szablon, z którego zbudowano stronę na platformie.", why: "Ten sam szablon u różnych kont oznacza podobne kampanie, a nie jedną.", example: "szablon „artykuł-wywiad”", sentence: "Strony zbudowano z tego samego szablonu na platformie" },
  click_server: { name: "Serwer kliknięć", what: "Serwer, który przekierował kliknięcie w reklamę (zapisany w identyfikatorze kliknięcia).", why: "Ten sam serwer kieruje ruch do obu stron: wspólna infrastruktura, ślad średni.", example: "serwer 0a1b w identyfikatorze kliknięcia", sentence: "Kliknięcia przeszły przez ten sam serwer przekierowań" },
  meta_ad: { name: "Identyfikator reklamy", what: "Numer klikniętej reklamy zapisany w linku.", why: "Ten sam numer to ta sama reklama.", example: "reklama 120200000000000", sentence: "To ta sama reklama (ten sam identyfikator w linku)" },
  ad_payer: { name: "Płatnik reklamy", what: "Płatnik zadeklarowany platformie reklamowej (biblioteka reklam).", why: "Ten sam płatnik to jedno konto płacące; ogólne nazwy łączą słabiej.", example: "„Firma Przykład”", sentence: "Za reklamy płaci ten sam płatnik" },
  company_id: { name: "Identyfikator firmy na stronie", what: "Numer firmy podany w stopce, regulaminie albo danych sprzedawcy: NIP, REGON, KRS, unijny numer VAT, numer spółki w Wielkiej Brytanii.", why: "Ten sam numer na dwóch stronach to wspólny szablon albo wspólna ręka, ale dane firmy da się skopiować z cudzej strony, więc ślad sam nie łączy w kampanię. Numer z błędną sumą kontrolną jest zmyślony.", example: "NIP 123-456-32-18 w stopce", sentence: "Obie strony podają ten sam identyfikator firmy" },
  bank_account: { name: "Rachunek bankowy na stronie", what: "Numer rachunku (IBAN albo polski NRB) podany jako konto do wpłat.", why: "Ten sam rachunek to wspólny odbiorca pieniędzy: silniejszy ślad niż numer firmy, ale rachunki podstawionych osób („słupów”) bywają wspólne dla różnych grup, więc sam nie łączy w kampanię.", example: "PL61 1090 1014 0000 0712 1981 2874", sentence: "Obie strony każą wpłacać na ten sam rachunek bankowy" },
  postal_address: { name: "Adres siedziby sklepu", what: "Pełny adres podany na stronie: ulica, numer, kod pocztowy i miasto (zapis ujednolicony: „ul.” i „ulica”, kod z myślnikiem i bez to ten sam adres).", why: "Ten sam adres na dwóch sklepach to wspólny szablon albo ta sama ręka, ale adres łatwo skopiować ze stopki cudzego sklepu, a biura wirtualne wynajmują ten sam adres niezwiązanym firmom, więc ślad sam nie łączy w kampanię.", example: "ul. Przykładowa 1, 00-001 Miasto", sentence: "Obie strony podają ten sam adres siedziby" },
  comment_block: { name: "Blok fałszywych komentarzy", what: "Zestaw zmyślonych komentarzy wpisany na stałe w stronę.", why: "Ten sam zestaw autorów wskazuje ten sam szablon strony; sam nie wystarcza.", example: "te same 8 komentarzy pod artykułem", sentence: "Strony mają ten sam blok fałszywych komentarzy" },
  crm_key: { name: "Klucz API CRM", what: "Tajny klucz konta w CRM albo sieci afiliacyjnej, z którym formularz wysyła zgłoszenie. Pokazujemy tylko skrót (początek, koniec i sha256), nigdy cały klucz.", why: "Jeden klucz należy do jednego konta odbiorcy leadów: dwie strony z tym samym kluczem wysyłają dane do tego samego kupca. Silny ślad, jak wspólny backend formularza.", example: "klucz Zx81…yB9n", sentence: "Formularze obu stron wysyłają zgłoszenia z tym samym kluczem API CRM" },
  template_phrase: { name: "Zdanie szablonu", what: "Rzadkie zdanie z tekstu strony albo z podziękowania po wysłaniu formularza, takie samo na stronach w różnych domenach. Zdanie z wpadką (powtórzone słowa, mieszane alfabety) waży więcej.", why: "Wskazuje ten sam szablon strony; ten sam szablon kupuje wielu operatorów, więc do kampanii potrzebny drugi rodzaj dowodu.", example: "„nasz opiekun zadzwoni do ciebie i przedstawi platformę”", sentence: "Strony mają to samo rzadkie zdanie szablonu" },
  lead_flow: { name: "Lejek leadów platformy stron", what: "Ten sam formularz, lista przepływów albo klucz zdarzeń zapisane w kodzie stron z jednej platformy.", why: "Strony korzystają z jednego lejka leadów: ta sama sieć lub oferta, niekoniecznie jeden kupujący.", example: "formularz 2df7210b…", sentence: "Obie strony zasilają ten sam lejek leadów na platformie" },
  kit_string: { name: "Komunikat ze skryptu zestawu", what: "Komunikat programisty zapisany w skrypcie strony (log w konsoli, błąd, ostrzeżenie), często z literówką, taki sam na stronach w różnych domenach. Skrypty platformy stron (SDK), paczki frameworków i znane biblioteki są pomijane.", why: "Wskazuje to samo narzędzie sieci, jak skrót pliku; narzędzia używa wielu operatorów, więc do kampanii potrzebny drugi rodzaj dowodu. Liczy się przy co najmniej dwóch wspólnych komunikatach albo jednym z pięciu słów.", example: "„moduł testowy: start!”", sentence: "Skrypty stron mają te same komunikaty programisty" },
  profit_claim: { name: "Obiecywany zysk", what: "Kwota i okres obiecywanego zarobku z tekstu, zrzutu albo nagrania.", why: "Ta sama obietnica pochodzi z tego samego scenariusza oszustwa, który kopiuje wielu operatorów: łączy tylko podobne kampanie w grupę.", example: "3000 zł w ciągu dnia", sentence: "Reklamy obiecują ten sam zysk (kwota i okres)" },
  technique: { name: "Technika strony", what: "Sposób działania strony, np. fałszywy sklep z aplikacjami, pułapka „wstecz”, licznik presji, blokada narzędzi deweloperskich, kit formularza sieci CPA (kit:formFb).", why: "Sposób działania łączy podobne kampanie, nie wskazuje operatora.", example: "pułapka „wstecz”", sentence: "Strony stosują tę samą technikę (sposób działania)" },
  similar_image: { name: "Podobna kreacja", what: "Obrazy reklam różnią się tylko drobiazgami.", why: "Ta sama grafika w wariantach to zwykle ta sama kampania.", example: "ta sama grafika z innym napisem", sentence: "Reklamy mają prawie identyczny obraz" },
  similar_image_semantic: { name: "Podobny obraz", what: "Obrazy przedstawiają to samo, choć nie są kopią.", why: "Wskazuje ten sam szablon kreacji; razem z innymi śladami.", example: "ta sama scena w innym kadrze", sentence: "Obrazy reklam są zbudowane z tego samego szablonu" },
  similar_text: { name: "Podobny tekst", what: "Teksty reklam są do siebie bardzo podobne.", why: "Ten sam tekst w wielu reklamach to często ta sama kampania albo ta sama narracja.", example: "ten sam tekst z inną kwotą", sentence: "Reklamy mają bardzo podobny tekst" },
  similar_dom: { name: "Ten sam układ strony", what: "Strony mają taką samą budowę kodu.", why: "Ten sam układ wskazuje ten sam zestaw stron, który bywa sprzedawany wielu operatorom.", example: "ta sama strona-artykuł na innej domenie", sentence: "Strony docelowe mają taką samą budowę" },
  similar_audio: { name: "Ten sam podkład audio", what: "Nagrania mają tę samą ścieżkę dźwiękową.", why: "Ten sam podkład to zwykle ta sama kreacja.", example: "ta sama muzyka i lektor", sentence: "Nagrania mają ten sam podkład dźwiękowy" },
  similar_voice: { name: "Ten sam głos", what: "W nagraniach mówi ten sam głos.", why: "Ten sam głos może być podrobiony wiele razy, więc sam nie wystarcza.", example: "ten sam lektor w dwóch nagraniach", sentence: "W nagraniach mówi ten sam głos" },
};

export function typeInfo(type: string | null | undefined): TypeInfo | null {
  return type ? ((TYPE_INFO as Record<string, TypeInfo>)[type] ?? null) : null;
}

export interface EvidenceText {
  evidence: string;
  /** Id of the shared node (kind = pivot): tells the creative-file node from an ordinary image hash. */
  pivot?: string | null;
  pivotType?: string | null;
  edgeType?: string | null;
}

/** Evidence description without the technical tail ("— zdyskontowane: …", "(dHash …)", "(simhash …)"). */
export function cleanEvidence(text: string): string {
  return text
    .replace(/\s+—\s+zdyskontowane:.*$/i, "")
    .replace(/\s*\((?:dHash|simhash|mmh3|cosinus|odległość)[^)]*\)/gi, "")
    .trim();
}

/** Plain sentence of a premise: the type sentence, or the cleaned description for an unknown type. */
export function premiseSentence(ev: EvidenceText): string {
  if (ev.pivotType === "imagehash" && ev.pivot?.startsWith(`imagehash:${CREATIVE_FILE_PREFIX}`)) return "Reklamy mają ten sam plik reklamy (identyczny co do bajtu)";
  const info = typeInfo(ev.pivotType ?? ev.edgeType ?? null);
  if (info) return info.sentence;
  const t = cleanEvidence(ev.evidence);
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Wspólny ślad";
}

/** Family of a premise (null when the backend did not give the type). */
export function premiseFamily(ev: EvidenceText): FeatureFamily | null {
  return familyOf(ev.pivotType ?? ev.edgeType ?? null);
}

/** Help notes per type for the expert view (moved from DetailsPanel). */
export const TYPE_NOTES: Partial<Record<EntityType, string>> = {
  endpoint: "Backend, do którego strona wysyła dane z formularza. Wspólny backend na różnych domenach to jeden z najmocniejszych dowodów; publiczne serwisy formularzy i ogólne ścieżki są dyskontowane.",
  hidden_fields: "Zestaw nazw ukrytych pól formularza (bez ogólnych pól typu csrf/_token).",
  asset: "Własny plik JS/CSS strony. Popularne biblioteki i ogólne nazwy plików są dyskontowane.",
  comment: "Znormalizowany komentarz HTML/JS. Standardowe komentarze trackerów i CMS są dyskontowane.",
  domain_pattern: "Wzorzec nazwy domeny z zamiennikami <n> (cyfry) i <lorem> (słowo z lorem ipsum); powstaje tylko, gdy obejmuje co najmniej dwie domeny.",
  cname_target: "Wspólny cel rekordu CNAME. Duże CDN i platformy hostingowe są dyskontowane.",
  campaign_param: "Parametr kampanii z adresu URL (utm_*, sub1–5, aff_id, flow, pid…), z ukrytego pola formularza albo z konfiguracji w skrypcie strony (pochodzenie: „z formularza”, „ze skryptu”). Ogólne wartości (np. facebook, cpc) i niewypełnione makra są dyskontowane; identyfikator kliknięcia (clickid) nie łączy materiałów.",
  fictional_expert: "Klucz `tytuł:imię nazwisko` (małe litery, bez polskich znaków, końcówka fleksyjna obcięta) z tekstu strony, reklamy, zrzutu lub nagrania. Warianty z literówką (odległość edycji ≤ 1, ≤ 2 dla długich nazw) zlewane do najczęstszego. Pomijane są osoby z listy osób publicznych. Waga 0,75; rzadkość przez IDF i limit maxPivotDf.",
  persona: "Słaby sygnał: ta sama osoba bywa wykorzystywana w wielu kampaniach. Służy do filtrowania i priorytetów, nie do łączenia. Brak danych biometrycznych.",
  path_id: "Losowy identyfikator (UUID) w ścieżkach zasobów ładowanych z domeny strony: konto kreatora stron obsługującego wiele domen.",
  param_schema: "Nazwy parametrów linku i rodzaj ich wartości. Wskazuje system kierowania ruchem, który może mieć wielu klientów: dowód pomocniczy.",
  hosting_account: "Klucz `usługa:identyfikator` konta na hostingu wideo, dziś biblioteka Bunny Stream z hosta `vz-<8 hex>-<3 hex>.b-cdn.net`. Waga 0,6, w `notAloneKinds`.",
  platform_account: "Konto właściciela zapisane przez platformę stron w kodzie strony (window.aio, owner_uuid). To samo konto = ten sam operator; różne konta tej samej platformy nie są łączone słabszymi dowodami.",
  cloaker_account: "Klucz `cl_domain/cl_sid` z pól `visit.fields` rekordu window.aio (cloaker Cloakerson). Waga jak Telegram. Sam `cl_sid` albo sama domena to tylko atrybut; `cl_did` to identyfikator wizyty, nie łączy, a `cl_clid` (kliknięcie analityka) jest redagowany.",
  launcher_account: "UUID z `visit.fields.launcher` (albo `visit.launcher`). Zwykle równy owner_uuid i wtedy nie tworzy osobnego śladu (ten sam dowód co konto na platformie stron); osobny węzeł tylko przy innej wartości. Waga jak konto na platformie.",
  platform_campaign: "Kampania w panelu platformy stron (uuid i nazwa nadana przez kupującego ruch). Silny dowód: te same strony puszcza ta sama kampania.",
  page_template: "Szablon strony na platformie (lander_template_uuid). Ten sam szablon u różnych kont to ten sam zestaw, czyli kampanie podobne, a nie jedna kampania.",
  click_server: "Identyfikator kliknięcia w formacie xid zawiera identyfikator maszyny i procesu trackera. Ten sam serwer kieruje ruch do obu stron: wspólna infrastruktura, dowód średni.",
  ad_payer: "Płatnik i beneficjent zadeklarowani Mecie (przejrzystość DSA), odczytani z biblioteki reklam po identyfikatorze biblioteki. Ten sam płatnik na różnych reklamach = jedno konto płacące; nazwa jest wpisywana przez reklamodawcę i nikt jej nie weryfikuje. Zaślepki (np. „Test”, „xyz”) nie łączą wcale, bo wpisują je niezwiązani reklamodawcy; osoba prywatna jako płatnik może być ofiarą kradzieży tożsamości.",
  meta_ad: "Nowy format fbclid zawiera identyfikator klikniętej reklamy (ad ID z Marketing API, nie identyfikator Biblioteki Reklam). Ten sam = ta sama reklama.",
  comment_block: "Zestaw autorów zmyślonych komentarzy wpisanych w stronę. Ślad szablonu jak szablon strony: do kampanii potrzebny drugi rodzaj dowodu.",
  crm_key: "Klucz albo token API, z którym formularz wysyła zgłoszenie do CRM lub sieci afiliacyjnej (pole w skrypcie, nagłówek żądania, ukryte pole). W grafie tylko skrót: 4 pierwsze i 4 ostatnie znaki oraz sha256. Klucze publicznych usług (mapy, reCAPTCHA, analityka) są pomijane.",
  template_phrase: "Znormalizowane zdanie (≥ 6 słów) z tekstu strony albo z komunikatu po wysłaniu formularza w skrypcie. Liczy się tylko zdanie rzadkie i obecne w co najmniej dwóch domenach; zgody RODO, cookies i stopki są pomijane. Ślad szablonu: do kampanii potrzebny drugi rodzaj dowodu.",
  lead_flow: "Wspólny lejek leadów platformy stron: ten sam formularz (form_uuid), pola, lista przepływów (flow_uuids), klucz szyfrowania zdarzeń albo serwer zdarzeń formularza. Ślad sieci lub oferty, nie jednego kupującego: poziom grupy, do kampanii potrzebny drugi rodzaj dowodu.",
  kit_string: "Znormalizowany komunikat programisty (≥ 3 słowa, małe litery, liczby jako #) z własnych skryptów strony, wpisanych w stronę i zewnętrznych z tej samej domeny. Para stron dostaje jedną przesłankę: co najmniej dwa wspólne komunikaty albo jeden długi (≥ 5 słów). Maska: skrypty SDK platformy i frameworków, biblioteki, słowniki interfejsu w wielu językach, komunikaty ze stron ≥ 5 kont platformy. Ślad zestawu stron: do kampanii potrzebny drugi rodzaj dowodu.",
  shared_doc: "Klucz `usługa:identyfikator` dokumentu, arkusza, formularza (Google, Notion, Microsoft Forms, Typeform, Jotform) albo udostępnionej rozmowy z modelem językowym (usługa llm_chat). Waga jak Telegram, rzadkość przez IDF i limit maxPivotDf. Odpowiedniki z dokumentacji dostawców i strony pomocy platform są pomijane. Operator, który wkleja dane kampanii do czatu i udostępnia link, zostawia ślad tego samego czatu.",
  onion: "Adres .onion wersji 3 (56 znaków). Adresy wersji 2 (16 znaków) wygasły w 2021 r. i są tylko atrybutem materiału. Waga jak Telegram.",
  c2_host: "Nazwa hosta serwera C2, do którego trojan w skrypcie zestawu (ścieżka /admin lub /panel plus wysyłka ciasteczka lub danych logowania do obcego hosta) przesyła dane. Waga 0,95; rzadkość przez IDF i maxPivotDf.",
  messenger_invite: "Klucz `usługa:identyfikator` zaproszenia lub konta: discord, signal, signal_group, viber, line (numer wa.me trafia do telefonów). Serwery społeczności samych platform są pomijane. Waga jak Telegram.",
  affiliate_account: "Klucz `rodzaj:host_sieci:wartość` (B-330): para team_id/user_id, stream_id albo offer_uuid z linku zamówienia, zdekodowanego parametru referer (base64) lub ukrytych pól formularza; host to host linku albo akcji formularza. Bez hosta nic nie łączy. Para zespół/użytkownik to rodzaj reguły affiliate_team w notAloneKinds. api_key trafia do węzła crm_key wyłącznie jako sha256. sub1, sub2, x_id, sid, cid są tylko atrybutami.",
  profit_claim: "Para kwota i okres z obietnicy zysku (np. 3000 zł w ciągu dnia). Standardowe kwoty wpłaty (np. 250 USD) nie łączą. Liczy się tylko dla grup podobnych kampanii.",
  company_id: "NIP, REGON, KRS, unijny numer VAT albo numer spółki w UK odczytany z widocznego tekstu, kodu, JSON-LD i zrzutów (OCR). Sprawdzamy sumę kontrolną tam, gdzie numer ją ma (NIP, REGON): błędna suma wskazuje zmyślony numer, ale taki numer też łączy strony, które go współdzielą. Numery pośredników (operatorzy płatności, kurierzy) pomijamy. Sam nie łączy w kampanię: dane firmy można skopiować.",
  bank_account: "IBAN dowolnego kraju albo polski numer rachunku (NRB), sprawdzony sumą kontrolną (mod 97). Wspólny rachunek to wspólny odbiorca pieniędzy, ale rachunki „słupów” bywają wspólne dla różnych grup: nie łączy w kampanię sam.",
  postal_address: "Adres z ulicą, numerem, kodem pocztowym i miastem, odczytany z tekstu strony albo z JSON-LD (PostalAddress). Numer lokalu pomijamy: jeden budynek to jeden adres. Do kampanii potrzebny drugi rodzaj dowodu; adresy biur wirtualnych można wykluczyć listą w konfiguracji.",
  technique: "Technika strony (fałszywy sklep z aplikacjami, pułapka „wstecz”, udawany post, fałszywe komentarze). Liczy się tylko dla grup podobnych kampanii.",
};

/** Names of page techniques (MaterialItemResult.techniques). */
export const TECHNIQUE_LABEL: Record<string, string> = {
  fake_comments: "fałszywe komentarze",
  fake_app_store: "fałszywy sklep z aplikacjami",
  back_trap: "pułapka „wstecz”",
  fake_social_post: "udawany post w serwisie społecznościowym",
  fake_security_alert: "fałszywy alarm bezpieczeństwa z numerem telefonu",
  remote_access_tool: "program do zdalnego pulpitu do pobrania",
  clickfix_paste: "fałszywa weryfikacja z poleceniem do wklejenia",
  recent_purchase_popup: "wyskakujące „ktoś właśnie kupił”",
  low_stock_claim: "„ostatnie sztuki” i „ogląda N osób”",
  countdown_timer: "licznik czasu przy ofercie",
  closing_down_story: "historia o likwidacji sklepu",
  crypto_discount: "dodatkowy rabat za płatność kryptowalutą",
  waitlist_upsell: "rabat jako zapis na listę oczekujących z dopłatą",
  trial_subscription: "okres próbny z automatycznym odnowieniem subskrypcji",
  blik_via_messenger: "kod BLIK przez komunikator",
  fake_courier_payment: "strona udająca kuriera z polem karty i wyborem paczkomatu",
};

/** Techniques that only describe a shop page: they explain and never link (unlike the techniques of the second level). */
export const SHOP_TECHNIQUES: ReadonlySet<string> = new Set(["recent_purchase_popup", "low_stock_claim", "countdown_timer", "closing_down_story", "crypto_discount", "waitlist_upsell", "trial_subscription", "blik_via_messenger", "fake_courier_payment"]);

export interface ShopFlagInfo {
  name: string;
  what: string;
  why: string;
  example: string;
  /** Sentence shown next to the flag in the card. */
  sentence: string;
}

/**
 * Flags of a fake-shop page (MaterialItemResult.shop). Every one is an explanation for the analyst: honest
 * shops show them too (a small shop without the 30-day price, with one payment method, with five-star reviews),
 * so none links anything and none is a verdict.
 */
export const SHOP_FLAG_INFO: Record<ShopFlag, ShopFlagInfo> = {
  legalPagesMissing: {
    name: "Brak regulaminu, zwrotów lub polityki prywatności",
    what: "W menu i stopce nie ma linku do regulaminu, zwrotów i odstąpienia, polityki prywatności albo kontaktu.",
    why: "Sklep internetowy musi je mieć, a fałszywy często ich nie ma albo linki prowadzą donikąd. Mały uczciwy sklep może je mieć pod inną nazwą, więc to wskazówka, nie dowód.",
    example: "w stopce są tylko „O nas” i „Koszyk”",
    sentence: "Strona nie linkuje do regulaminu lub zwrotów: to częsta cecha fałszywych sklepów, choć nie przesądza.",
  },
  sitewideDeepDiscount: {
    name: "Rabat na cały sklep",
    what: "Co najmniej 70% produktów ma przekreśloną cenę i obniżkę o 50% lub więcej.",
    why: "Prawdziwe przeceny dotyczą wybranych kategorii. „-80% na wszystko” to typowy wabik fałszywych wyprzedaży, ale i likwidacje prawdziwych sklepów tak wyglądają.",
    example: "10 produktów z ceną 500 zł przekreśloną i 100 zł obok",
    sentence: "Rabat sięga 80% na cały sklep: typowe dla fałszywych wyprzedaży, choć nie przesądza.",
  },
  omnibusMissing: {
    name: "Brak najniższej ceny z 30 dni",
    what: "Strona pokazuje obniżki, a nigdzie nie podaje najniższej ceny z ostatnich 30 dni.",
    why: "Dyrektywa Omnibus (w Polsce od 2023 r.) wymaga tej informacji przy obniżce. Brak to słaba wskazówka, bo uczciwe sklepy też o niej zapominają.",
    example: "„-50%” bez wzmianki o cenie sprzed promocji",
    sentence: "Rabaty bez najniższej ceny z 30 dni: słaba wskazówka, nie dowód.",
  },
  transferOnly: {
    name: "Tylko przelew bankowy",
    what: "Jedyna znaleziona metoda płatności to przelew.",
    why: "Normalny sklep daje kilka form albo bramkę płatności. Przelew na konto sprzedawcy trudno cofnąć. Mały lokalny sklep może mieć tylko przelew.",
    example: "„Płatność: przelew tradycyjny”, bez Przelewy24 i karty",
    sentence: "Jedyna metoda płatności to przelew: trudniej odzyskać pieniądze, choć mały sklep też tak działa.",
  },
  irreversibleOnly: {
    name: "Tylko płatności trudne do cofnięcia",
    what: "Wszystkie znalezione metody to kryptowaluty, BLIK albo karty podarunkowe.",
    why: "Tych płatności prawie nie da się cofnąć, dlatego oszuści je wybierają.",
    example: "BLIK i Bitcoin, bez karty i bramki płatności",
    sentence: "Płacić można tylko w sposób trudny do cofnięcia (krypto, BLIK, karty podarunkowe).",
  },
  paymentRecipientPerson: {
    name: "Wpłata na osobę prywatną",
    what: "Instrukcja płatności wskazuje jako odbiorcę osobę fizyczną albo tytuł przelewu „prezent” lub „darowizna”.",
    why: "Sklep powinien przyjmować pieniądze na firmę. Tytuł „prezent” ma ukryć zakup przed bankiem. Małe firmy jednoosobowe też prowadzą konto na imię i nazwisko.",
    example: "„Odbiorca: Jan Kowalski, tytuł: prezent”",
    sentence: "Wpłata ma iść na osobę prywatną albo z tytułem „prezent”: tak ukrywa się zakup przed bankiem.",
  },
  deliveryWide: {
    name: "Rozstrzał terminu dostawy",
    what: "Deklarowany czas realizacji jest długi (od 21 dni) albo bardzo szeroki (górna granica co najmniej 5 razy większa od dolnej).",
    why: "Fałszywe sklepy podają „3–45 dni”, bo towar i tak nie przyjdzie. Zagraniczna wysyłka na zamówienie też bywa długa.",
    example: "„Czas realizacji: 3–45 dni roboczych”",
    sentence: "Czas dostawy 3–45 dni: szeroki rozstrzał, który zdarza się też przy zamówieniach z zagranicy.",
  },
  reviewsAllPerfect: {
    name: "Same opinie 5/5",
    what: "Co najmniej 10 opinii, 95% z nich ma 5 gwiazdek, nie ma ocen 1–2.",
    why: "Zdrowy rozkład ma kształt „odwróconego J”: dużo piątek, trochę środkowych i trochę jedynek. Same piątki sugerują kupione albo napisane opinie, ale młody uczciwy sklep też ma same piątki.",
    example: "30 opinii, wszystkie 5/5",
    sentence: "30 opinii i wszystkie 5/5: rozkład niepodobny do prawdziwego, choć nie przesądza.",
  },
  reviewsNarrowWindow: {
    name: "Opinie z kilku dni",
    what: "Co najmniej 10 opinii dodano w oknie nie dłuższym niż 21 dni.",
    why: "Prawdziwe opinie przybywają stopniowo. Paczka opinii z jednego tygodnia wskazuje hurtowe dodanie, ale nowy sklep po otwarciu też zbiera opinie szybko.",
    example: "30 opinii z 10 dni",
    sentence: "Wszystkie opinie z kilkunastu dni: wygląda na hurtowe dodanie, choć nowy sklep też tak zaczyna.",
  },
  reviewsNone: {
    name: "Brak opinii",
    what: "Sklep ma produkty z cenami, a na stronie nie ma żadnych opinii ani słowa o nich.",
    why: "Opinie często są na stronach produktów, więc to słaba wskazówka. Nowy sklep też ich jeszcze nie ma.",
    example: "lista produktów bez ocen i bez sekcji opinii",
    sentence: "Sklep bez żadnej opinii: może być nowy, może być fałszywy.",
  },
  footerBrandMismatch: {
    name: "Inna nazwa w stopce niż na stronie",
    what: "Nazwa w wierszu praw autorskich nie pasuje do nazwy strony ani do nazwy domeny.",
    why: "Fałszywe sklepy kopiują cudzy sklep razem ze stopką i nie poprawiają nazwy. Bywa, że prawdziwy sklep zmienił nazwę i nie poprawił stopki.",
    example: "„© 2019 Inny Sklep” na stronie domeny nowymarket.test",
    sentence: "Stopka podaje nazwę innego sklepu niż strona: ślad skopiowanego sklepu, choć bywa też zwykłym niedopatrzeniem.",
  },
  footerYearStale: {
    name: "Stary rok w stopce",
    what: "Rok w wierszu praw autorskich jest o co najmniej 2 lata wcześniejszy niż pierwszy zapis strony.",
    why: "Strona skopiowana ze starego sklepu zachowuje jego rok. Zaniedbana prawdziwa strona też go nie aktualizuje.",
    example: "„© 2019” na stronie zapisanej w 2026",
    sentence: "Rok w stopce sprzed co najmniej 2 lat: typowe dla skopiowanych sklepów, ale i dla zaniedbanych.",
  },
  claimedSinceContradicted: {
    name: "Deklarowany staż sprzeczny z archiwum",
    what: "Strona pisze „od 1998” albo „20 lat na rynku”, a pierwsza migawka w archiwum internetu jest o co najmniej 3 lata późniejsza.",
    why: "Młody sklep przypisuje sobie długi staż. Archiwum bywa niepełne, więc brak starych migawek to wskazówka.",
    example: "„od 1998 roku” i pierwsza migawka z 2026 r.",
    sentence: "Strona deklaruje staż, którego archiwum nie potwierdza.",
  },
  reviewsNoSellerReply: {
    name: "Opinie bez odpowiedzi sprzedawcy",
    what: "Widżet opinii ma co najmniej 20 opinii i ani jednej odpowiedzi sprzedawcy.",
    why: "Prawdziwe sklepy coraz częściej odpowiadają na opinie, także krytyczne. Brak odpowiedzi to słaba wskazówka, bo wielu uczciwych sprzedawców nie odpowiada.",
    example: "25 opinii bez żadnej odpowiedzi „Odpowiedź sklepu”",
    sentence: "Sklep nie odpowiada na żadną z opinii: słaba wskazówka.",
  },
  catalogIncoherent: {
    name: "Asortyment bez związku z profilem sklepu",
    what: "W małym katalogu są produkty z trzech lub więcej niezwiązanych kategorii (elektronika, zabawki, odzież…) albo z innej kategorii, niż wskazuje nazwa sklepu.",
    why: "Fałszywe sklepy sprzedają to, co modne: drony, iPady, klocki, bez związku z profilem. Duże sklepy wielobranżowe też mają różne działy.",
    example: "sklep z włóczkami z najnowszymi smartfonami",
    sentence: "Asortyment nie pasuje do nazwy sklepu: sklep z jednej branży oferuje towary z innej.",
  },
};

/** Words for the completeness of a postal address (`addressCompleteness`). */
export const ADDRESS_COMPLETENESS_LABEL: Record<string, string> = {
  full: "pełny (ulica, numer, kod, miasto)",
  city_only: "samo miasto, bez ulicy i numeru",
  po_box: "skrytka pocztowa",
  none: "brak adresu",
};

/** Words for the kind of an e-mail domain (`emailDomainKinds`). */
export const EMAIL_DOMAIN_KIND_LABEL: Record<string, string> = {
  free_mail: "darmowa skrzynka",
  site: "domena sklepu",
  other_domain: "inna domena niż sklep",
};

/** Polish names of the topics and hooks of the narrative (lib/text/narrative.ts). */
export const NARRATIVE_LABEL: Record<string, string> = {
  investment: "inwestycje i zarobek",
  subsidy: "dotacje i świadczenia",
  health: "zdrowie",
  gambling: "hazard",
  elections: "wybory",
  ai_trading: "handel z użyciem AI",
  gold_reserve: "rezerwy złota",
  commodities_war: "surowce i wojna",
  leaked_secret: "ujawniona tajemnica",
  testimonial_small_win: "relacja o szybkim zysku",
  recovery: "odzyskiwanie środków",
  sport_event: "wydarzenie sportowe",
  inauguration: "zaprzysiężenie",
  state_investment: "inwestycje państwowe",
  adult_phishing: "treści 18+ i potwierdzenie wieku",
  urgent_notice: "pilne wezwanie",
  petition: "petycja",
  tech_support: "fałszywa pomoc techniczna (wirus, zablokowany komputer)",
  refund_overpayment: "zwrot nadpłaty („przelaliśmy za dużo”)",
  recovery_offer: "oferta odzyskania utraconych środków (wtórne oszustwo wobec ofiar)",
  job_offer: "oferta pracy (zdalna, oceny produktów za prowizję)",
  fake_authority: "udawany organ (policja, KNF, UODO, CERT, bank)",
  sensation: "sensacja",
  endorsement: "polecenie przez znaną osobę",
  fake_interview: "udawany wywiad",
  secrecy: "tajemnica (nie mów bankowi ani rodzinie)",
  withdrawal_fee: "opłata lub podatek przed wypłatą",
  urgency_lock: "grożenie blokadą konta w terminie",
  nationwide: "„cała Polska” (powszechność)",
  millions_of_poles: "„miliony Polaków”",
  pharma_villain: "koncerny farmaceutyczne jako winowajca",
  state_program_pays: "program państwowy pokrywa koszty",
  custody: "kajdanki lub areszt",
  video_removed: "nagranie usunięto lub zablokowano",
};

/** Polish names of the weekdays, Monday first (the index of AdStart.weekday). */
export const WEEKDAY_LABEL = ["poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota", "niedziela"];

/** Polish names of the line types of a phone number (lib/osint/phoneLine.ts). */
export const LINE_TYPE_LABEL: Record<string, string> = {
  mobile: "komórkowy",
  fixed: "stacjonarny",
  toll_free: "bezpłatny",
  premium: "o podwyższonej opłacie",
  voip: "VoIP",
  shared_cost: "o współdzielonym koszcie",
  unknown: "nieznany rodzaj",
};

/**
 * What the new page techniques mean, in plain words (name, what, why, synthetic example, sentence of a
 * finding). Attributes of the scheme: they explain the kind of fraud and only count for groups of similar
 * campaigns.
 */
export const TECHNIQUE_INFO: Record<string, TypeInfo> = {
  fake_security_alert: {
    name: TECHNIQUE_LABEL.fake_security_alert,
    what: "Strona straszy wirusem, zablokowanym komputerem albo zhakowanym kontem, podaje numer telefonu jako jedyne wyjście i nie pozwala łatwo jej opuścić (pełny ekran, okna alertu, pułapka „wstecz”, dźwięk alarmu).",
    why: "To schemat fałszywej pomocy technicznej: oszust odbiera telefon i prosi potem o instalację programu do zdalnego pulpitu. Atrybut, nie ślad łączący.",
    example: "„Windows Defender: wykryto wirusa, zadzwoń +48 800 000 000” na pełnym ekranie",
    sentence: "Strona straszy wirusem i każe dzwonić pod numer: schemat fałszywej pomocy technicznej, w którym oszust prosi potem o instalację programu do zdalnego pulpitu",
  },
  remote_access_tool: {
    name: TECHNIQUE_LABEL.remote_access_tool,
    what: "Link albo instrukcja pobrania programu do zdalnego pulpitu (np. AnyDesk, TeamViewer QuickSupport) z prośbą o podanie kodu dostępu.",
    why: "Po zainstalowaniu oszust przejmuje komputer, a często także dostęp do bankowości. Atrybut, nie ślad łączący.",
    example: "„Pobierz program i podaj technikowi 9-cyfrowy kod”",
    sentence: "Strona każe pobrać program do zdalnego pulpitu: oszust chce przejąć komputer ofiary",
  },
  clickfix_paste: {
    name: TECHNIQUE_LABEL.clickfix_paste,
    what: "Fałszywy CAPTCHA albo „weryfikacja, że nie jesteś robotem” każe nacisnąć skrót (np. Win+R) i wkleić polecenie, które strona skopiowała do schowka.",
    why: "Wklejone polecenie instaluje złośliwe oprogramowanie. Zapisujemy tylko rodzaj polecenia i jego skrót SHA-256, nigdy samo polecenie.",
    example: "„Naciśnij Win+R, wklej (Ctrl+V) i Enter, aby potwierdzić, że nie jesteś robotem”",
    sentence: "Strona pod pozorem weryfikacji każe wkleić do systemu skopiowane polecenie (ClickFix): to droga do zainstalowania złośliwego oprogramowania",
  },
};

/**
 * What each rule that keeps similar ads out of one campaign means, in plain words (`term`, `text`, `why`,
 * `example` as in the glossary below). Shown in the "Celowo nie połączone" tab and in the card of a new
 * material; the rule ids are those of `NearMiss.rule`. The ids themselves stay out of the reader's way.
 */
export const NEAR_MISS_RULE_INFO: Record<NearMissRule, Term> = {
  "below-min-score": {
    term: "Wynik poniżej progu",
    text: "Reklamy mają coś wspólnego, ale wszystkie wspólne ślady razem są za słabe, żeby uznać je za jedną kampanię.",
    why: "Próg chroni przed łączeniem po przypadkowych drobiazgach. Pary tuż pod progiem warto obejrzeć ręcznie.",
    example: "dwa podobne teksty i żadnego innego wspólnego śladu",
  },
  "family-only-kind": {
    term: "Tylko ślad grupy",
    text: "Łączy je wyłącznie cecha, która wskazuje podobne kampanie, a nie jednego operatora: ta sama osoba w reklamie albo ta sama technika strony.",
    why: "Tę samą osobę czy technikę wykorzystuje wielu niezależnych oszustów, więc taki ślad tworzy grupę podobnych kampanii, nie kampanię.",
    example: "ten sam znany prezenter w reklamach dwóch niezależnych operatorów",
  },
  "account-conflict": {
    term: "Różne konta na platformie",
    text: "Strony stoją na tej samej platformie do budowy stron, ale na różnych kontach. Wspólny szablon albo plik nie wystarcza, żeby uznać je za jednego operatora.",
    why: "Platforma daje gotowe szablony i biblioteki stron wszystkim kontom, więc wspólny element nie mówi, kto za nim stoi.",
    example: "dwie strony z tego samego kreatora, każda na innym koncie",
  },
  "discounted-only": {
    term: "Tylko pominięty ślad",
    text: "Wspólny jest tylko ślad, z którego korzysta wiele niezależnych stron: duża sieć CDN, popularny rejestrator albo platforma. Po obniżeniu wagi nic nie zostaje.",
    why: "Bez tego wszystko łączyłoby się ze wszystkim przez popularne usługi.",
    example: "dwie strony za tym samym dużym CDN, bez innego wspólnego śladu",
  },
  "kit-only": {
    term: "Tylko zestaw stron",
    text: "Łączy je tylko szablon, motyw albo kod strony, który można kupić lub skopiować. Brakuje śladu samego operatora: wspólnego konta, domeny, trackera, portfela albo kontaktu.",
    why: "Zestawy stron kupuje wielu operatorów, więc taki ślad pokazuje podobne kampanie, a nie jedną.",
    example: "ten sam szablon artykułu na dwóch różnych domenach",
  },
  "content-only-with-infra": {
    term: "Tylko treść, a infrastruktura osobna",
    text: "Reklamy mają podobny tekst albo obraz, ale przynajmniej jedna ma własną infrastrukturę (domena, serwer, tracker), której druga nie dzieli.",
    why: "Treść łatwo skopiować, a infrastruktura wskazuje operatora. Sama treść nie łączy w kampanię.",
    example: "ta sama grafika w dwóch reklamach prowadzących na różne domeny",
  },
  "too-few-content-kinds": {
    term: "Za mało rodzajów treści",
    text: "Reklamy bez własnej infrastruktury łączy tylko jeden rodzaj treści, np. podobny tekst.",
    why: "Żeby uznać je za jedną kampanię, potrzeba co najmniej dwóch różnych rodzajów treści, np. tekstu i obrazu.",
    example: "dwa podobne teksty, ale zupełnie różne obrazy",
  },
  "too-few-evidence-kinds": {
    term: "Za mało rodzajów dowodów",
    text: "Wspólne ślady są tego samego rodzaju, a metoda wymaga potwierdzenia drugim, niezależnym rodzajem dowodu.",
    why: "Jeden rodzaj śladu może być przypadkiem. Dwa niezależne rzadko.",
    example: "wspólny adres IP bez żadnego innego śladu",
  },
  "split-by-clustering": {
    term: "Rozdzielone przy podziale",
    text: "Reguły pozwalały połączyć te reklamy, ale algorytm dzielący sieć powiązań na kampanie umieścił je w różnych kampaniach.",
    why: "Algorytm patrzy na całą sieć powiązań, nie na jedną parę, więc słabe powiązanie między dwiema gęstymi grupami nie wystarcza do ich złączenia.",
    example: "dwie grupy reklam połączone jednym słabym powiązaniem",
  },
};

export type FeatureRole = "links" | "helps" | "describes";

export const ROLE_LABEL: Record<FeatureRole, string> = {
  links: "łączy",
  helps: "pomaga",
  describes: "tylko opis",
};

export interface FeatureInfo {
  name: string;
  source: string;
  role: FeatureRole;
  /** Glossary term for the "?" next to the name. */
  term?: TermId;
  /** Value is an address: shown defanged. */
  url?: boolean;
  /** Reads an object value as the lines shown to the reader (a feature that is not a plain string or list). */
  format?: (value: unknown) => string[];
}

/** Features of a material (`MaterialItemResult.features`). */
export const FEATURE_INFO: Record<string, FeatureInfo> = {
  landingUrl: { name: "Adres strony", source: "z materiału", role: "links", term: "domena", url: true },
  finalUrl: { name: "Adres końcowy (po przekierowaniach)", source: "z HAR albo zapisu strony", role: "links", url: true },
  landingSource: { name: "Skąd adres strony", source: "z materiału", role: "describes" },
  landingFragment: { name: "Fragment adresu (#…)", source: "z adresu", role: "describes" },
  observedUrls: { name: "Adres z paska przeglądarki", source: "z OCR zrzutu", role: "links", term: "ocr", url: true },
  inAppBrowser: { name: "Przeglądarka w aplikacji", source: "z OCR zrzutu", role: "describes" },
  advertiser: { name: "Reklamodawca", source: "ze zrzutu albo opisu", role: "helps" },
  uiView: { name: "Widok na zrzucie", source: "z OCR zrzutu", role: "describes" },
  adLibraryIds: { name: "Identyfikator biblioteki reklam", source: "z OCR zrzutu", role: "links" },
  advertiserImpersonatesName: { name: "Reklamodawca podszywa się pod osobę", source: "z nazwy reklamodawcy i listy osób (atrybut, nie dowód kampanii)", role: "describes", term: "persona" },
  profitClaims: { name: "Obiecywany zysk (kwota i okres)", source: "z tekstu reklamy, strony, OCR albo transkrypcji (atrybut; łączy tylko podobne kampanie w grupę)", role: "describes" },
  advertiserMismatch: { name: "Konto reklamowe prawdopodobnie przejęte (nazwa nie pasuje do treści)", source: "z nazwy reklamodawcy (lokalna firma albo osoba prywatna) i narracji inwestycyjnej (atrybut, nie dowód kampanii)", role: "describes" },
  displayedDomainMismatch: {
    name: "Domena pokazana w reklamie różni się od strony docelowej",
    source: "z OCR zrzutu albo tekstu reklamy i z łańcucha przekierowań (atrybut, nie dowód kampanii)",
    role: "describes",
    url: true,
    format: (v) => {
      const m = v as { displayed?: string; landing?: string };
      return m.displayed && m.landing ? [m.displayed, m.landing] : [];
    },
  },
  displayedBrandDomain: { name: "Pokazana domena należy do znanej marki (bank, portal, sklep)", source: "z listy marek (atrybut)", role: "describes" },
  clickfix: {
    name: "Polecenie kopiowane do schowka (ClickFix)",
    source: "ze skryptu strony: tylko rodzaj i skrót SHA-256, samo polecenie jest ładunkiem złośliwego oprogramowania i nie jest zapisywane (atrybut)",
    role: "describes",
    format: (v) => {
      const c = v as { kind?: string; sha256?: string };
      return c.kind && c.sha256 ? [`rodzaj: ${c.kind}`, `SHA-256: ${c.sha256.slice(0, 16)}…`] : [];
    },
  },
  stealerKit: {
    name: "Trojan w zestawie strony (kradzież ciasteczek lub haseł z fałszywego panelu trackera)",
    source: "ze skryptów strony i pobranych bibliotek na darmowych hostingach: sprawdzenie ścieżki /admin lub /panel plus wysyłka ciasteczka lub danych logowania do obcego hosta (atrybut; sam host C2 jest śladem)",
    role: "describes",
    format: (v) => {
      const c = v as { signals?: string[]; c2Hosts?: string[] };
      return [...(c.signals?.length ? [`sygnały: ${c.signals.join(", ")}`] : []), ...(c.c2Hosts ?? []).map((h) => `C2: ${h}`)];
    },
  },
  idnConfusable: {
    name: "Adres udaje inny adres (znak podobny do „/”, „.” lub „-” albo mieszane alfabety)",
    source: "z adresu strony, przekierowań, paska przeglądarki na zrzucie i linków (atrybut: opisuje, jak adres wygląda dla oka)",
    role: "describes",
    format: (v) => {
      const c = v as { host?: string; char?: string; position?: number; looksLike?: string };
      return c.host ? [`znak ${c.char} na pozycji ${c.position}`, `wygląda jak: ${c.looksLike}`] : [];
    },
  },
  adStartWeekday: {
    name: "Dzień tygodnia startu reklamy",
    source: "z daty pierwszej emisji w bibliotece reklam, UTC (atrybut; rozkład w kampanii opisuje rytm operatora)",
    role: "describes",
    format: (v) => {
      const s = v as { weekday?: number; hour?: number | null };
      return typeof s.weekday === "number" ? [`${WEEKDAY_LABEL[s.weekday]}${typeof s.hour === "number" ? `, godz. ${s.hour} UTC` : ""}`] : [];
    },
  },
  discordSnowflakes: {
    name: "Data utworzenia serwera lub konta Discord (z identyfikatora)",
    source: "z linków discord.com/channels i discord.com/users: górne bity identyfikatora to czas utworzenia (atrybut: „zegar powstania”)",
    role: "describes",
    format: (v) => (v as Array<{ kind: string; createdAt: string }>).map((d) => `${d.kind === "user" ? "konto" : d.kind === "guild" ? "serwer" : "kanał"}: ${d.createdAt.slice(0, 10)}`),
  },
  onionV2: { name: "Adres .onion wersji 2 (wygasły)", source: "z tekstu strony (atrybut; nie łączy)", role: "describes" },
  phoneLines: {
    name: "Rodzaj numeru telefonu",
    source: "z lokalnych metadanych libphonenumber-js, bez wysyłania numeru do usług (atrybut: numery VoIP bywają jednorazowe, więc waga numeru zależy od jego rzadkości)",
    role: "describes",
    format: (v) => (v as Array<{ phone: string; lineType: string; country: string | null }>).map((l) => `${l.phone}: ${LINE_TYPE_LABEL[l.lineType] ?? l.lineType}${l.country ? `, ${l.country}` : ""}`),
  },
  phoneCountryMismatch: { name: "Kraj numeru inny niż rynek reklamy", source: "z numeru i rynku reklamy (atrybut)", role: "describes" },
  tollFreeOnAlert: { name: "Numer bezpłatny na stronie z fałszywym alarmem", source: "z numeru i techniki strony (atrybut)", role: "describes" },
  fictionalExperts: { name: "Zmyśleni eksperci (dr, prof. spoza listy osób publicznych)", source: "z tekstu strony, reklamy, zrzutu i nagrania (atrybut; imię i nazwisko jest też śladem)", role: "describes" },
  narrative: {
    name: "Narracja i haczyki",
    source: "z tekstu reklamy, strony, OCR i transkrypcji (atrybut; cecha grupy kampanii, nie dowód)",
    role: "describes",
    format: (v) => {
      const n = v as { topics?: Array<{ id: string }>; hooks?: string[] };
      return [...(n.topics ?? []).map((t) => `temat: ${NARRATIVE_LABEL[t.id] ?? t.id}`), ...(n.hooks ?? []).map((h) => `haczyk: ${NARRATIVE_LABEL[h] ?? h}`)];
    },
  },
  localizedUi: { name: "Słownik interfejsu w wielu językach", source: "ze skryptu strony (kody języków; lokalizacja platformy stron, nie ślad tekstu, atrybut)", role: "describes" },
  residue: {
    name: "Wykomentowana stara wersja",
    source: "z komentarzy w kodzie strony (atrybut; ten sam stary akapit na dwóch stronach to ślad wspólnego szablonu, nie dowód)",
    role: "describes",
    format: (v) => [`wykomentowane teksty: ${(v as { count?: number }).count ?? 0}`, `próbka: „${(v as { sample?: string }).sample ?? ""}”`],
  },
  foreignSegments: {
    name: "Ślad innej wersji (wstawka w innym języku)",
    source: "z tekstu strony, skryptów, komentarzy lub nazw reklamy (atrybut; kampania może działać też w kraju tego języka, to podpowiedź, nie wniosek o autorze)",
    role: "describes",
    format: (v) => (v as Array<{ lang: string; where: string; chars: number }>).map((s) => `język ${s.lang} (${{ page: "strona", script: "skrypt", comment: "komentarz", ad_param: "nazwa reklamy" }[s.where] ?? s.where}, ${s.chars} liter)`),
  },
  foreignPersona: {
    name: "Persona z innego kraju w nazwie reklamy",
    source: "z parametrów reklamy (ad_name, adset_name, campaign_name) przy kodzie PL (atrybut)",
    role: "describes",
    format: (v) => (v as Array<{ title: string; lang: string; param: string }>).map((p) => `${p.title} (${p.lang}) w ${p.param}`),
  },
  typography: {
    name: "Typografia tekstu",
    source: "z tekstu reklamy i strony (atrybut; ten sam tekst z inną typografią to inna redakcja szablonu, nie inny właściciel)",
    role: "describes",
    format: (v) => {
      const t = v as { quoteStyle?: string | null; per1000?: Record<string, number> };
      const marks = Object.entries(t.per1000 ?? {}).map(([k, n]) => `${k}: ${n}/1000`);
      return [...(t.quoteStyle ? [`cudzysłów: ${t.quoteStyle}`] : []), ...marks];
    },
  },
  translationArtifacts: {
    name: "Ślady tłumaczenia",
    source: "z tekstu strony i napisów (atrybut; mieszane alfabety, kalki, skoki ty/wy, liczebniki słownie; bez wniosków o narodowości)",
    role: "describes",
    format: (v) => Object.entries(v as Record<string, number>).map(([k, n]) => `${{ mixed_alphabet: "słowa z mieszanym alfabetem", calque: "kalki", form_switch: "przeskoki ty/wy", spelled_numbers: "liczebniki słownie w napisach" }[k] ?? k}: ${n}`),
  },
  brandStyle: { name: "Styl nazwy marki", source: "z nazwy reklamodawcy lub marki (pseudopolskie złożenie z rdzeniem finansowym, atrybut)", role: "describes" },
  advertiserNameKind: {
    name: "Rodzaj nazwy reklamodawcy",
    source: "z nazwy reklamodawcy (wygenerowana marka, osoba, lokalny biznes; atrybut)",
    role: "describes",
    format: (v) => [{ generated_brand: "wygenerowana marka", person: "nazwa osoby", business: "nazwa lokalnego biznesu" }[v as string] ?? String(v)],
  },
  adPlatform: { name: "Biblioteka reklam", source: "z rekordu biblioteki", role: "describes" },
  adLibraryAdId: { name: "Identyfikator reklamy w bibliotece", source: "z rekordu biblioteki", role: "links" },
  adAdvertiserId: { name: "Identyfikator reklamodawcy w bibliotece", source: "z rekordu biblioteki", role: "links" },
  adAdvertiserLegalName: { name: "Nazwa prawna reklamodawcy", source: "z rekordu biblioteki", role: "describes" },
  adAdvertiserLocation: { name: "Kraj reklamodawcy", source: "z rekordu biblioteki", role: "describes" },
  adAdvertiserVerified: { name: "Reklamodawca zweryfikowany", source: "z rekordu biblioteki", role: "describes" },
  adRegions: { name: "Regiony emisji", source: "z rekordu biblioteki", role: "describes" },
  adFirstShown: { name: "Początek emisji reklamy", source: "z biblioteki reklam", role: "describes" },
  adLastShown: { name: "Koniec emisji reklamy", source: "z biblioteki reklam", role: "describes" },
  payerKinds: { name: "Rodzaj płatnika z biblioteki reklam", source: "z nazwy płatnika i beneficjenta (samodeklaracja z DSA, platforma jej nie weryfikuje)", role: "describes" },
  payerSuspicious: { name: "Podejrzany płatnik reklamy", source: "z nazwy płatnika (zaślepka, bełkot z klawiatury albo imię i nazwisko w obcym alfabecie)", role: "describes" },
  payerEqualsBeneficiary: { name: "Płatnik równy beneficjentowi", source: "z biblioteki reklam", role: "describes" },
  companyRegistry: {
    name: "Rejestry firm (biała lista VAT, KRS)",
    source: "z rejestrów publicznych dla NIP i KRS ze strony (opcja --company-registry; nazwa, siedziba, status, data wpisu, bez danych osób); niezgodność nazwy lub adresu, wykreślenie, młoda firma i wiek firmy względem domeny to wyjaśnienia, nie dowód kampanii",
    role: "describes",
    format: (v) => {
      const c = v as { records?: Array<{ source: string; id: string; found: boolean; name: string | null; status: string | null; registeredAt: string | null; error: string | null }>; details?: Record<string, string> };
      const lines = (c.records ?? []).map((r) => `${r.source === "vat" ? "NIP" : "KRS"} ${r.id}: ${r.error ? `błąd zapytania (${r.error})` : r.found ? `${r.name ?? "bez nazwy"}, ${r.status ?? "brak statusu"}${r.registeredAt ? `, wpis ${r.registeredAt}` : ""}` : "brak w rejestrze"}`);
      const labels: Record<string, string> = { companyNameMismatch: "inna nazwa niż na stronie", companyAddressMismatch: "inna siedziba niż na stronie", companyRemoved: "firma wykreślona", companyRecent: "młoda firma", companyYoungerThanDomain: "firma młodsza niż domena", domainYoungerThanCompany: "stara firma, nowa domena" };
      return [...lines, ...Object.entries(c.details ?? {}).map(([k, d]) => `${labels[k] ?? k}: ${d}`)];
    },
  },
  companyIds: { name: "Identyfikatory firm i rachunki na stronie", source: "z tekstu strony, kodu, JSON-LD albo zrzutu (OCR)", role: "links" },
  legalEntities: { name: "Nazwy podmiotów z formą prawną", source: "z tekstu strony, kodu, JSON-LD albo zrzutu (OCR)", role: "describes" },
  emailDomainKinds: { name: "Rodzaj domeny adresów e-mail", source: "z adresów e-mail na stronie (darmowa skrzynka, domena sklepu albo inna domena)", role: "describes" },
  addressCompleteness: { name: "Kompletność adresu na stronie", source: "z tekstu strony i JSON-LD (pełny, samo miasto, skrytka albo brak)", role: "describes" },
  certIssuer: { name: "Wystawca certyfikatu TLS", source: "z HAR (securityDetails); darmowy certyfikat to tylko kontekst, kłódka nic nie mówi o sprzedawcy", role: "describes" },
  certMismatch: { name: "Certyfikat wystawiony na inną domenę", source: "z HAR (securityDetails): żadna nazwa certyfikatu nie obejmuje hosta", role: "describes" },
  certExpired: { name: "Certyfikat wygasły", source: "z HAR (securityDetails): koniec ważności przed datą zapisu strony", role: "describes" },
  brandInPath: { name: "Znana marka w ścieżce adresu", source: "z adresu strony: marka w ścieżce, a nie w nazwie domeny (typowe dla klonów kurierów i serwisów ogłoszeń)", role: "describes" },
  hostingOutsideEu: { name: "Hosting poza UE i EOG", source: "z kraju adresu IP (wzbogacenie ASN); strony spoza UE trudniej zdjąć", role: "describes" },
  tldRare: { name: "Rzadka końcówka domeny", source: "z nazwy domeny (końcówka spoza listy typowych dla sklepów, np. .sbs, .top); słaba wskazówka", role: "describes" },
  domainLangMismatch: { name: "Nazwa domeny w innym języku niż strona", source: "z nazwy domeny i języka strony; słaba wskazówka", role: "describes" },
  privacyControllerMismatch: { name: "Administrator danych inny niż sklep", source: "z polityki prywatności: adres administratora na innej domenie niż adresy kontaktowe strony", role: "describes" },
  registrantHidden: { name: "Dane rejestranta domeny zasłonięte", source: "z RDAP (REDACTED albo usługa prywatności); większość rejestratorów tak robi, więc słaba wskazówka", role: "describes" },
  contactDomainDead: { name: "Domena e-maila kontaktowego nie odpowiada", source: "z wzbogacenia (tryb z siecią): domena ma rekord MX, a nie odpowiada po HTTP(S)", role: "describes" },
  phoneAreaMismatch: { name: "Numer stacjonarny niezgodny z miastem adresu", source: "z numeru telefonu i adresu na stronie", role: "describes" },
  companyIdInvalid: { name: "Identyfikator firmy z błędną sumą kontrolną", source: "z tekstu strony, kodu, JSON-LD albo zrzutu (OCR)", role: "describes" },
  personas: { name: "Persona", source: "z tekstu, transkrypcji albo OCR", role: "describes", term: "persona" },
  impersonatedBrand: { name: "Podrabiana marka", source: "z tytułu strony", role: "describes" },
  platformCampaignName: { name: "Kampania na platformie stron", source: "z kodu strony", role: "links" },
  landingName: { name: "Nazwa strony w panelu platformy", source: "z kodu strony", role: "describes" },
  trafficSource: { name: "Źródło ruchu", source: "z kodu strony", role: "describes" },
  platformAccount: { name: "Konto na platformie stron", source: "z kodu strony", role: "links", term: "konto_platformy" },
  metaAdId: { name: "Identyfikator reklamy", source: "z linku (fbclid)", role: "links" },
  metaAppId: { name: "Identyfikator aplikacji", source: "z linku (fbclid)", role: "describes" },
  clickTime: { name: "Czas kliknięcia", source: "z identyfikatora kliknięcia", role: "describes", term: "clickid" },
  clickCounter: { name: "Licznik serwera kliknięć", source: "z identyfikatora kliknięcia", role: "describes", term: "clickid" },
  firstSeen: { name: "Pierwsza obserwacja", source: "z materiału", role: "describes" },
  cyrillic: { name: "Cyrylica w kodzie strony", source: "z kodu strony", role: "describes" },
  cloakingSuspected: { name: "Podejrzenie cloakingu", source: "z dwóch pobrań strony", role: "describes", term: "cloaking" },
  ocrText: { name: "Tekst ze zrzutu", source: "z OCR zrzutu", role: "helps", term: "ocr" },
  videoOcrText: { name: "Napisy w wideo", source: "z napisów w wideo (OCR klatek co 2 s)", role: "helps", term: "ocr" },
  asrText: { name: "Transkrypcja nagrania", source: "z nagrania (ASR)", role: "helps", term: "transkrypcja" },
  text: { name: "Tekst reklamy", source: "z materiału", role: "helps" },
  dhash: { name: "Odcisk obrazu", source: "ze zrzutu", role: "links", term: "odcisk_obrazu" },
  domSimhash: { name: "Odcisk budowy strony", source: "z HAR albo zapisu strony", role: "helps", term: "odcisk_budowy" },
};

export function featureInfo(key: string): FeatureInfo {
  return FEATURE_INFO[key] ?? { name: key, source: "z materiału", role: "describes" };
}

// ---------------------------------------------------------------- glossary (§9)

export type TermId =
  | "material"
  | "cecha"
  | "wspolny_slad"
  | "przeslanka"
  | "sila_powiazania"
  | "prog_laczenia"
  | "kampania"
  | "grupa_podobnych"
  | "duplikat"
  | "wariant"
  | "pominiety_slad"
  | "persona"
  | "domena"
  | "rejestrator"
  | "ns"
  | "certyfikat"
  | "har"
  | "ocr"
  | "tracker"
  | "clickid"
  | "szablon_strony"
  | "konto_platformy"
  | "cloaking"
  | "sila_przeslanki"
  | "pewnosc"
  | "za_malo_danych"
  | "baza"
  | "kompletnosc"
  | "sila_w_kampanii"
  | "trasa_klikniecia"
  | "sprawa"
  | "strona_przyneta"
  | "lejek"
  | "transkrypcja"
  | "biblioteka_reklam"
  | "baza_osob"
  | "rozbrojony_adres"
  | "znizka"
  | "odcisk_obrazu"
  | "odcisk_budowy";

export interface Term {
  term: string;
  text: string;
  why?: string;
  example?: string;
}

export const GLOSSARY: Record<TermId, Term> = {
  material: { term: "Materiał", text: "Jedna reklama razem z tym, co o niej zebrano: zrzut ekranu, zapisana strona, HAR, wideo, opis.", why: "Narzędzie porównuje materiały, nie pojedyncze pliki.", example: "zrzut reklamy + zapis strony, na którą prowadzi" },
  cecha: { term: "Cecha", text: "Pojedyncza informacja z materiału, np. domena, nazwisko w tekście, identyfikator trackera.", why: "Z cech powstają wspólne ślady, czyli podstawa każdego połączenia.", example: "domena przyklad.test" },
  wspolny_slad: { term: "Wspólny ślad", text: "Cecha, którą ma więcej niż jeden materiał. Tylko wspólne ślady mogą coś połączyć.", why: "Cecha widoczna tylko w jednym materiale niczego nie łączy.", example: "ten sam identyfikator trackera na dwóch stronach" },
  przeslanka: { term: "Przesłanka", text: "Wspólny ślad użyty do uzasadnienia połączenia, z oceną siły.", why: "Każde połączenie ma swoje przesłanki, więc można je sprawdzić.", example: "„obie strony należą do tego samego konta na platformie stron”" },
  sila_powiazania: { term: "Siła powiązania", text: "Liczba od 0 do 1, która sumuje wszystkie przesłanki pary materiałów. Im więcej niezależnych przesłanek, tym bliżej 1.", why: "Od niej zależy, czy para przekroczy próg łączenia.", example: "dwie przesłanki 0,5 i 0,5 dają razem 0,75" },
  prog_laczenia: { term: "Próg łączenia", text: "Minimalna siła, od której dwa materiały mogą trafić do jednej kampanii.", why: "Chroni przed łączeniem materiałów po przypadkowych drobiazgach.", example: "próg 0,15: para o sile 0,12 nie trafi do jednej kampanii" },
  kampania: { term: "Kampania", text: "Materiały jednego operatora. Łączy je to samo konto, ta sama infrastruktura albo kilka niezależnych przesłanek.", why: "To główny wynik narzędzia: kto stoi za reklamą.", example: "K03: 6 reklam z tym samym kontem na platformie stron" },
  grupa_podobnych: { term: "Grupa podobnych kampanii", text: "Kampanie różnych operatorów, które mają ten sam szablon strony, narrację albo personę.", why: "Pokazuje, że kilka kampanii korzysta z tego samego gotowego zestawu, choć prowadzą je różne osoby.", example: "K01 i K05: ten sam szablon artykułu, różne konta" },
  duplikat: { term: "Duplikat", text: "Ta sama reklama zebrana więcej niż raz.", why: "Duplikaty liczymy raz, żeby nie zawyżać wielkości kampanii.", example: "ten sam zrzut przesłany przez dwie osoby" },
  wariant: { term: "Wariant", text: "Inny materiał tej samej kampanii, np. ta sama strona na nowej domenie.", example: "ta sama strona przeniesiona na nową domenę" },
  pominiety_slad: { term: "Pominięty ślad", text: "Ślad wspólny dla wielu niezależnych stron (Cloudflare, popularny rejestrator, darmowy certyfikat). Nie wskazuje operatora, więc się nie liczy.", why: "Bez tego wszystko łączyłoby się ze wszystkim przez popularne usługi.", example: "dwie strony za Cloudflare" },
  persona: { term: "Persona", text: "Osoba, pod którą podszywa się reklama. Ta sama osoba pojawia się w wielu niezależnych kampaniach, dlatego sama nie łączy materiałów.", why: "Pomaga filtrować i szukać, ale nie wskazuje operatora.", example: "znany prezenter w fałszywym wywiadzie" },
  domena: { term: "Domena", text: "Adres strony, np. przyklad.test. Oszuści często rejestrują nowe domeny na kilka dni.", why: "Wspólna domena łączy materiały; młody wiek domeny bywa wskazówką.", example: "przyklad.test" },
  rejestrator: { term: "Rejestrator", text: "Firma, w której kupiono domenę. Popularny rejestrator mówi niewiele, rejestracje seriami mówią więcej." },
  ns: { term: "Serwery nazw (NS)", text: "Serwery, które wskazują, gdzie działa domena. Ta sama nietypowa para serwerów może łączyć domeny jednego właściciela." },
  certyfikat: { term: "Certyfikat HTTPS", text: "Plik potrzebny stronie do działania przez https. Każdy certyfikat trafia do publicznego rejestru, więc nowe domeny widać, zanim ruszy reklama." },
  har: { term: "HAR", text: "Zapis ruchu sieciowego z przeglądarki: jakie adresy strona wywołała i co odpowiedziały serwery.", why: "Z HAR odczytujemy stronę, przekierowania, formularze i trackery, nawet gdy strona już nie działa.", example: "plik wizyta.har zapisany w narzędziach deweloperskich" },
  ocr: { term: "OCR", text: "Odczyt tekstu z obrazu, np. ze zrzutu reklamy.", why: "Z OCR bierzemy tekst reklamy i adres z paska przeglądarki.", example: "adres strony odczytany z paska na zrzucie z telefonu" },
  tracker: { term: "Tracker, piksel", text: "Kod firmy reklamowej albo analitycznej z identyfikatorem konta. Ten sam identyfikator na dwóch stronach zwykle oznacza tego samego właściciela." },
  clickid: { term: "Identyfikator kliknięcia (clickid)", text: "Znacznik dopisywany do linku po kliknięciu reklamy. Niektóre formaty zdradzają serwer, który przekierował ruch." },
  szablon_strony: { term: "Szablon strony", text: "Wspólny układ i kod strony. Ten sam szablon u różnych kont oznacza podobne kampanie, a nie jedną." },
  konto_platformy: { term: "Konto na platformie stron", text: "Identyfikator właściciela w narzędziu do budowy stron. To samo konto to ten sam operator." },
  trasa_klikniecia: { term: "Trasa kliknięcia", text: "Droga od reklamy do strony oszusta: link śledzący, przekierowania, strona-przynęta, formularz albo sklep. Pokazuje, przez jakie adresy przechodzi ofiara. Domena zarejestrowana tuż przed emisją reklamy zwykle powstała na potrzeby kampanii, np. „zarejestrowana 2 dni przed emisją”." },
  sprawa: { term: "Sprawa", text: "Folder z plikami jednego zgłoszenia: zrzut reklamy, zapisana strona, HAR, wideo. Z jednej sprawy powstaje jeden materiał albo więcej, jeśli zawiera kilka reklam.", why: "Podział na sprawy decyduje, które pliki liczą się razem.", example: "folder „zgloszenie-12” z zrzutem i zapisem strony" },
  strona_przyneta: { term: "Strona-przynęta", text: "Strona, na którą trafia osoba po kliknięciu w reklamę: fałszywy artykuł, wywiad albo oferta. Jej zadaniem jest namówić do podania danych lub wpłaty.", why: "Zwykle to na niej zostają ślady operatora: tracker, formularz, szablon.", example: "artykuł „znana osoba ujawnia sposób na zarobek”" },
  lejek: { term: "Lejek", text: "Rząd liczb pokazujący, ile z wgranych plików stało się materiałami, ile z nich to duplikaty, a ile trafiło do znanych kampanii, nowych albo oznaczono „za mało danych”. Liczby się sumują.", example: "9 plików → 6 materiałów → 1 duplikat" },
  transkrypcja: { term: "Transkrypcja", text: "Tekst wypowiedzi z nagrania, odczytany automatycznie. Może zawierać błędy, więc służy do porównania treści, nie jest cytatem.", why: "Pozwala porównać treść nagrań, także gdy obrazy się różnią." },
  biblioteka_reklam: { term: "Biblioteka reklam", text: "Publiczny rejestr reklam, który prowadzą platformy (Meta, Google, TikTok) zgodnie z prawem o usługach cyfrowych. Podaje reklamodawcę, daty emisji i często płatnika.", why: "Daje stałe identyfikatory konta reklamowego, których nie da się podmienić w zrzucie.", example: "numer reklamy i nazwa płatnika" },
  baza_osob: { term: "Baza referencyjna osób", text: "Zamknięta lista osób publicznych, z którymi porównujemy twarze i głosy z materiałów. Dla każdej mamy kilka zdjęć lub fragmentów nagrań i źródło, które wskazało ją jako podszywaną.", why: "Wynik to „podobna twarz do X”, wskazówka do sprawdzenia, nigdy ustalenie tożsamości." },
  rozbrojony_adres: { term: "Rozbrojony adres", text: "Adres strony zapisany tak, żeby nie dało się go kliknąć przez pomyłkę: hxxps zamiast https i [.] w miejscu kropki. Kopiowanie kopiuje właśnie taką wersję.", example: "hxxps://przyklad[.]test/start" },
  znizka: { term: "Zniżka", text: "Obniżenie wagi śladu, który wygląda na wspólny, ale należy do wielu niezależnych stron (duża sieć, darmowy certyfikat, usługa wielu klientów). Ślad ze zniżką słabiej łączy albo wcale.", why: "Chroni przed łączeniem kampanii po infrastrukturze, z której korzystają wszyscy.", example: "wspólny serwer popularnego hostingu" },
  odcisk_obrazu: { term: "Odcisk obrazu", text: "Krótki skrót wyliczony z obrazu reklamy. Dwa podobne obrazy mają podobne odciski, więc wykrywamy tę samą grafikę z drobną zmianą (napis, kadr).", why: "Pozwala łączyć warianty tej samej kreacji bez porównywania obrazów piksel po pikselu." },
  odcisk_budowy: { term: "Odcisk budowy strony", text: "Skrót wyliczony z układu znaczników strony (bez treści). Strony zbudowane z tego samego zestawu mają podobny odcisk.", why: "Wskazuje ten sam zestaw stron, który bywa sprzedawany wielu operatorom, więc sam nie łączy w kampanię." },
  cloaking: { term: "Cloaking", text: "Strona pokazuje co innego robotowi platformy reklamowej, a co innego użytkownikowi, żeby przejść moderację." },
  sila_przeslanki: { term: "Siła przesłanki", text: "Jak mocno jedna przesłanka łączy dwa materiały. Wysoka łączy sama, średnia liczy się razem z innymi, „wymaga potwierdzenia” potrzebuje drugiego rodzaju śladu, pominięta się nie liczy.", why: "Od siły zależy, czy przesłanka wystarczy do połączenia.", example: "to samo konto na platformie stron: wysoka" },
  pewnosc: { term: "Pewność", text: "Jak bardzo ufamy werdyktowi: pewne, prawdopodobne albo niepewne. Niepewny werdykt warto sprawdzić ręcznie.", why: "Mówi, który wynik warto zweryfikować samodzielnie.", example: "pewne: najlepsze powiązanie ma przesłankę o wysokiej sile" },
  za_malo_danych: { term: "Za mało danych", text: "Materiał nie ma cech, po których da się go porównać, np. sam nieczytelny zrzut bez adresu. Narzędzie mówi to wprost i podpowiada, co dorzucić, zamiast zgadywać „nową kampanię”.", example: "zrzut bez paska adresu i bez czytelnego tekstu" },
  baza: { term: "Baza porównawcza", text: "Baza porównawcza to materiały przeanalizowane wcześniej. Nowe porównujemy z nimi." },
  kompletnosc: { term: "Kompletność danych", text: "Lista tego, co mamy i czego brakuje w materiale, ze skutkami braków dla porównania.", example: "brak zapisanej strony: nie porównamy szablonu" },
  sila_w_kampanii: { term: "Siła powiązań w kampanii", text: "Średnia siła powiązań między materiałami kampanii. Im wyższa, tym mocniej materiały trzymają się razem." },
};

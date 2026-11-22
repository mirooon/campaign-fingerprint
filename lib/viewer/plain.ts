/**
 * Plain-Polish dictionary of the GUI: what every feature type is, why it matters for linking, an
 * example, and the sentence a premise of that type becomes. Also the glossary (§9) used by the "?"
 * bubbles and the Słowniczek page, and the help notes moved here from the expert DetailsPanel.
 */
import type { EntityType, SimilarityEdgeType } from "@/lib/graph/model";
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
  advertiser: { name: "Reklamodawca", what: "Nazwa profilu, który opublikował reklamę.", why: "Ten sam profil to to samo konto reklamowe; nazwy bywają jednak ogólne i powtarzalne.", example: "Wiadomości Dnia Demo", sentence: "Reklamy opublikował ten sam reklamodawca" },
  endpoint: { name: "Backend formularza", what: "Adres, na który strona wysyła dane z formularza.", why: "Wspólny backend na różnych domenach to mocny ślad; publiczne serwisy formularzy pomijamy.", example: "zbieracz.test/api/zapis", sentence: "Formularze obu stron wysyłają dane pod ten sam adres" },
  hidden_fields: { name: "Ukryte pola formularza", what: "Zestaw nazw niewidocznych pól w formularzu strony.", why: "Ten sam zestaw wskazuje ten sam szablon strony; sam nie wystarcza.", example: "lp_id, offer_hash", sentence: "Formularze mają ten sam zestaw ukrytych pól" },
  asset: { name: "Plik JS/CSS", what: "Własny plik skryptu albo stylów strony.", why: "Ten sam nietypowy plik wskazuje ten sam zestaw stron; popularne biblioteki pomijamy.", example: "formularz-lead.9f8e.js", sentence: "Strony ładują ten sam własny plik skryptu lub stylów" },
  comment: { name: "Komentarz w kodzie", what: "Notatka programisty zostawiona w kodzie strony.", why: "Ten sam nietypowy komentarz wskazuje ten sam szablon; standardowe komentarze pomijamy.", example: "„wstaw formularz po bloku telefonu”", sentence: "W kodzie stron jest ten sam komentarz programisty" },
  domain_pattern: { name: "Wzorzec nazwy domeny", what: "Powtarzalny schemat nazw domen, np. zwrot<liczba>-<słowo>.test.", why: "Domeny z jednego schematu zwykle rejestruje jeden operator seriami.", example: "zwrot12-abc.test, zwrot37-xyz.test", sentence: "Domeny są zbudowane według tego samego wzorca nazw" },
  cname_target: { name: "Przekierowanie domeny (CNAME)", what: "Wpis, który kieruje domenę na inny serwer.", why: "Wspólny, nietypowy cel przekierowania wskazuje wspólną infrastrukturę; duże sieci CDN pomijamy.", example: "ruch.przyklad.test", sentence: "Domeny są przekierowane na ten sam serwer (CNAME)" },
  campaign_param: { name: "Parametr kampanii", what: "Znacznik kampanii dopisany do linku reklamy (np. utm_campaign).", why: "Ta sama nietypowa wartość to zwykle ta sama kampania reklamowa; ogólne wartości pomijamy.", example: "utm_campaign=lato_07", sentence: "Linki reklam mają ten sam parametr kampanii" },
  persona: { name: "Persona", what: "Osoba, pod którą podszywa się reklama.", why: "Ta sama osoba pojawia się w wielu niezależnych kampaniach, dlatego sama nie łączy materiałów.", example: "Adam Testowy", sentence: "Reklamy wykorzystują wizerunek tej samej osoby" },
  path_id: { name: "Identyfikator konta w ścieżkach", what: "Losowy identyfikator w adresach plików strony, nadany przez kreator stron.", why: "Ten sam identyfikator to to samo konto w kreatorze stron.", example: "/a1b2c3d4-…/style.css", sentence: "Pliki stron leżą pod tym samym identyfikatorem konta w kreatorze stron" },
  param_schema: { name: "Szablon linku śledzącego", what: "Nazwy parametrów linku i rodzaj ich wartości.", why: "Wskazuje system kierowania ruchem, z którego korzysta wielu klientów: ślad pomocniczy.", example: "sub1, sub2, clickid", sentence: "Linki mają ten sam układ parametrów śledzących" },
  platform_account: { name: "Konto na platformie stron", what: "Identyfikator właściciela w narzędziu do budowy stron.", why: "To samo konto to ten sam operator. Różne konta tej samej platformy nie trafiają do jednej kampanii bez silnej przesłanki.", example: "konto 1a2b…", sentence: "Obie strony należą do tego samego konta na platformie stron" },
  platform_campaign: { name: "Kampania na platformie stron", what: "Kampania w panelu platformy stron, nazwana przez kupującego ruch.", why: "Te same strony puszcza ta sama kampania: silny ślad.", example: "kampania „lato-pl”", sentence: "Obie strony puszcza ta sama kampania na platformie stron" },
  page_template: { name: "Szablon strony na platformie", what: "Gotowy szablon, z którego zbudowano stronę na platformie.", why: "Ten sam szablon u różnych kont oznacza podobne kampanie, a nie jedną.", example: "szablon „artykuł-wywiad”", sentence: "Strony zbudowano z tego samego szablonu na platformie" },
  click_server: { name: "Serwer kliknięć", what: "Serwer, który przekierował kliknięcie w reklamę (zapisany w identyfikatorze kliknięcia).", why: "Ten sam serwer kieruje ruch do obu stron: wspólna infrastruktura, ślad średni.", example: "serwer 0a1b w identyfikatorze kliknięcia", sentence: "Kliknięcia przeszły przez ten sam serwer przekierowań" },
  meta_ad: { name: "Identyfikator reklamy", what: "Numer klikniętej reklamy zapisany w linku.", why: "Ten sam numer to ta sama reklama.", example: "reklama 120200000000000", sentence: "To ta sama reklama (ten sam identyfikator w linku)" },
  ad_payer: { name: "Płatnik reklamy", what: "Płatnik zadeklarowany platformie reklamowej (biblioteka reklam).", why: "Ten sam płatnik to jedno konto płacące; ogólne nazwy łączą słabiej.", example: "„Firma Przykład”", sentence: "Za reklamy płaci ten sam płatnik" },
  comment_block: { name: "Blok fałszywych komentarzy", what: "Zestaw zmyślonych komentarzy wpisany na stałe w stronę.", why: "Ten sam zestaw autorów wskazuje ten sam szablon strony; sam nie wystarcza.", example: "te same 8 komentarzy pod artykułem", sentence: "Strony mają ten sam blok fałszywych komentarzy" },
  technique: { name: "Technika strony", what: "Sposób działania strony, np. fałszywy sklep z aplikacjami, pułapka „wstecz”.", why: "Sposób działania łączy podobne kampanie, nie wskazuje operatora.", example: "pułapka „wstecz”", sentence: "Strony stosują tę samą technikę (sposób działania)" },
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
  campaign_param: "Parametr kampanii z adresu URL (utm_*, sub1–5, aff_id, clickid…). Ogólne wartości (np. facebook, cpc) i niewypełnione makra są dyskontowane.",
  persona: "Słaby sygnał: ta sama osoba bywa wykorzystywana w wielu kampaniach. Służy do filtrowania i priorytetów, nie do łączenia. Brak danych biometrycznych.",
  path_id: "Losowy identyfikator (UUID) w ścieżkach zasobów ładowanych z domeny strony: konto kreatora stron obsługującego wiele domen.",
  param_schema: "Nazwy parametrów linku i rodzaj ich wartości. Wskazuje system kierowania ruchem, który może mieć wielu klientów: dowód pomocniczy.",
  platform_account: "Konto właściciela zapisane przez platformę stron w kodzie strony (window.aio, owner_uuid). To samo konto = ten sam operator; różne konta tej samej platformy nie są łączone słabszymi dowodami.",
  platform_campaign: "Kampania w panelu platformy stron (uuid i nazwa nadana przez kupującego ruch). Silny dowód: te same strony puszcza ta sama kampania.",
  page_template: "Szablon strony na platformie (lander_template_uuid). Ten sam szablon u różnych kont to ten sam zestaw, czyli kampanie podobne, a nie jedna kampania.",
  click_server: "Identyfikator kliknięcia w formacie xid zawiera identyfikator maszyny i procesu trackera. Ten sam serwer kieruje ruch do obu stron: wspólna infrastruktura, dowód średni.",
  ad_payer: "Płatnik i beneficjent zadeklarowani Mecie (przejrzystość DSA), odczytani z biblioteki reklam po identyfikatorze biblioteki. Ten sam płatnik na różnych reklamach = jedno konto płacące; nazwa jest wpisywana przez reklamodawcę, więc ogólne nazwy (np. „ABC”) łączą słabiej.",
  meta_ad: "Nowy format fbclid zawiera identyfikator klikniętej reklamy (ad ID z Marketing API, nie identyfikator Biblioteki Reklam). Ten sam = ta sama reklama.",
  comment_block: "Zestaw autorów zmyślonych komentarzy wpisanych w stronę. Ślad szablonu jak szablon strony: do kampanii potrzebny drugi rodzaj dowodu.",
  technique: "Technika strony (fałszywy sklep z aplikacjami, pułapka „wstecz”, udawany post, fałszywe komentarze). Liczy się tylko dla grup podobnych kampanii.",
};

/** Names of page techniques (MaterialItemResult.techniques). */
export const TECHNIQUE_LABEL: Record<string, string> = {
  fake_comments: "fałszywe komentarze",
  fake_app_store: "fałszywy sklep z aplikacjami",
  back_trap: "pułapka „wstecz”",
  fake_social_post: "udawany post w serwisie społecznościowym",
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
  adPlatform: { name: "Biblioteka reklam", source: "z rekordu biblioteki", role: "describes" },
  adLibraryAdId: { name: "Identyfikator reklamy w bibliotece", source: "z rekordu biblioteki", role: "links" },
  adAdvertiserId: { name: "Identyfikator reklamodawcy w bibliotece", source: "z rekordu biblioteki", role: "links" },
  adAdvertiserLegalName: { name: "Nazwa prawna reklamodawcy", source: "z rekordu biblioteki", role: "describes" },
  adAdvertiserLocation: { name: "Kraj reklamodawcy", source: "z rekordu biblioteki", role: "describes" },
  adAdvertiserVerified: { name: "Reklamodawca zweryfikowany", source: "z rekordu biblioteki", role: "describes" },
  adRegions: { name: "Regiony emisji", source: "z rekordu biblioteki", role: "describes" },
  adFirstShown: { name: "Początek emisji reklamy", source: "z biblioteki reklam", role: "describes" },
  adLastShown: { name: "Koniec emisji reklamy", source: "z biblioteki reklam", role: "describes" },
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
  asrText: { name: "Transkrypcja nagrania", source: "z nagrania (ASR)", role: "helps" },
  text: { name: "Tekst reklamy", source: "z materiału", role: "helps" },
  dhash: { name: "Odcisk obrazu", source: "ze zrzutu", role: "links" },
  domSimhash: { name: "Odcisk budowy strony", source: "z HAR albo zapisu strony", role: "helps" },
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
  | "sila_w_kampanii";

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
  cloaking: { term: "Cloaking", text: "Strona pokazuje co innego robotowi platformy reklamowej, a co innego użytkownikowi, żeby przejść moderację." },
  sila_przeslanki: { term: "Siła przesłanki", text: "Jak mocno jedna przesłanka łączy dwa materiały. Wysoka łączy sama, średnia liczy się razem z innymi, „wymaga potwierdzenia” potrzebuje drugiego rodzaju śladu, pominięta się nie liczy.", why: "Od siły zależy, czy przesłanka wystarczy do połączenia.", example: "to samo konto na platformie stron: wysoka" },
  pewnosc: { term: "Pewność", text: "Jak bardzo ufamy werdyktowi: pewne, prawdopodobne albo niepewne. Niepewny werdykt warto sprawdzić ręcznie.", why: "Mówi, który wynik warto zweryfikować samodzielnie.", example: "pewne: najlepsze powiązanie ma przesłankę o wysokiej sile" },
  za_malo_danych: { term: "Za mało danych", text: "Materiał nie ma cech, po których da się go porównać, np. sam nieczytelny zrzut bez adresu. Narzędzie mówi to wprost i podpowiada, co dorzucić, zamiast zgadywać „nową kampanię”.", example: "zrzut bez paska adresu i bez czytelnego tekstu" },
  baza: { term: "Baza porównawcza", text: "Baza porównawcza to materiały przeanalizowane wcześniej. Nowe porównujemy z nimi." },
  kompletnosc: { term: "Kompletność danych", text: "Lista tego, co mamy i czego brakuje w materiale, ze skutkami braków dla porównania.", example: "brak zapisanej strony: nie porównamy szablonu" },
  sila_w_kampanii: { term: "Siła powiązań w kampanii", text: "Średnia siła powiązań między materiałami kampanii. Im wyższa, tym mocniej materiały trzymają się razem." },
};

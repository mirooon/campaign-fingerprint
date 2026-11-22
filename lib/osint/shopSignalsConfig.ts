/**
 * Dictionaries and thresholds of the shop signals (lib/osint/shopSignals.ts, contact.ts, infraSignals.ts).
 *
 * The lists are general and multilingual (PL, EN, DE, CS, SK, RO, HU) and are not tuned to the wording of
 * any captured page. Every phrase is written in folded form: lower case, without diacritics (ą→a, ł→l,
 * č→c, ß→ss), because the matchers fold the page text the same way.
 */

export interface ShopSignalsConfig {
  /** Words of a shopping cart or a purchase button; a page with one of them and a price is a shop. */
  cartWords: string[];
  /** Currency markers next to an amount (folded). */
  currencies: string[];
  /** Per legal page: phrases in the link text and parts of the link path that name it. */
  legalPages: Record<"terms" | "returns" | "privacy" | "contact", { text: string[]; path: string[] }>;
  /** Class tokens (whole tokens, split on `-` and `_`) of an element that holds a struck-through, earlier price. */
  oldPriceClassTokens: string[];
  /** Class tokens of an element that holds a current price. */
  priceClassTokens: string[];
  /** Shop-wide deep discount: at least `minShare` of the products carry a discount of at least `minDiscountPct`. */
  sitewide: { minItems: number; minShare: number; minDiscountPct: number };
  /** "Lowest price of the last 30 days" (Omnibus directive): regular expression sources on folded text. */
  omnibusPhrases: string[];
  /** Regular expression sources on folded text, one list per technique. */
  techniquePhrases: Record<ShopTechniqueName, string[]>;
  /** Class or id tokens of a countdown element. */
  countdownTokens: string[];
  /** Payment method id → regular expression sources on folded text, image names and script URLs. */
  paymentMethods: Record<string, string[]>;
  /** Methods that cannot be reversed once paid. */
  irreversibleMethods: string[];
  /** Labels that introduce the recipient of a transfer (folded) and the words of a transfer title that read as a gift. */
  recipientLabels: string[];
  giftTitleWords: string[];
  /** Words in a recipient name that mark a firm, not a person (folded). */
  firmWords: string[];
  /** Labels of delivery time (folded) and the units of time that follow the number. */
  deliveryLabels: string[];
  deliveryUnits: string[];
  /** Delivery time is wide when its upper bound is at least `maxDays` days or `ratio` times the lower bound. */
  deliveryWide: { maxDays: number; ratio: number };
  /** Reviews: thresholds of the flags. */
  reviews: { minCount: number; perfectShare: number; narrowWindowDays: number; aggregatePerfectAvg: number };
  /** Words that name an author as anonymous (folded). */
  anonymousAuthors: string[];
  /** Words that mean "reviews" in the page language (folded); with none of them a shop with products has `reviewsNone`. */
  reviewWords: string[];
  /** Product categories by stems of folded product names (a name holds a stem as a substring). */
  catalog: { categories: Record<string, string[]>; maxProducts: number; minCategories: number; minProducts: number };
  /** Class tokens of a reply of the seller inside a review. */
  sellerReplyTokens: string[];
  /** The shop's reviews are read as a widget without seller replies only from this many opinions. */
  noReplyMinCount: number;
  /** The page is stale when the copyright year is at least this many years before the first sighting. */
  footerStaleYears: number;
  /** The claimed founding year is contradicted when the archive's first snapshot is at least this many years later. */
  claimedSinceGapYears: number;
  /** Phrases of a claimed seniority; group 1 is the year (`year`) or the number of years (`years`). */
  claimedSince: { year: string[]; years: string[] };
}

export type ShopTechniqueName =
  | "recent_purchase_popup"
  | "low_stock_claim"
  | "countdown_timer"
  | "closing_down_story"
  | "crypto_discount"
  | "waitlist_upsell"
  | "trial_subscription"
  | "blik_via_messenger"
  | "fake_courier_payment";

export const DEFAULT_SHOP_SIGNALS_CONFIG: ShopSignalsConfig = {
  cartWords: [
    "koszyk", "do koszyka", "add to cart", "add to basket", "shopping cart", "shopping basket", "basket", "checkout", "buy now",
    "kup teraz", "warenkorb", "in den warenkorb", "jetzt kaufen", "do kosiku", "kosik", "do kosika", "cos de cumparaturi", "adauga in cos",
    "kosarba", "kosar", "zamawiam",
  ],
  currencies: ["zl", "pln", "eur", "usd", "gbp", "czk", "kc", "ron", "lei", "huf", "ft", "chf", "€", "$", "£"],
  legalPages: {
    terms: {
      text: [
        "regulamin", "warunki sprzedazy", "warunki zakupu", "warunki korzystania", "ogolne warunki", "terms and conditions", "terms of service",
        "terms of use", "terms of sale", "terms & conditions", "conditions of sale", "t&c", "agb", "allgemeine geschaftsbedingungen",
        "obchodni podminky", "vseobecne obchodne podmienky", "termeni si conditii", "altalanos szerzodesi feltetelek", "aszf", "terms",
      ],
      path: ["regulamin", "terms", "tos", "agb", "conditions", "warunki", "podminky", "podmienky", "termeni", "aszf"],
    },
    returns: {
      text: [
        "zwrot", "odstapienie od umowy", "reklamacj", "return policy", "returns", "refund", "widerruf", "ruckgabe", "retoure", "vraceni zbozi",
        "reklamace", "vratenie tovaru", "returnare", "visszakuldes", "right of withdrawal",
      ],
      path: ["zwrot", "returns", "return", "refund", "widerruf", "ruckgabe", "retoure", "reklamac", "odstapienie", "vraceni", "returnare"],
    },
    privacy: {
      text: [
        "polityka prywatnosci", "prywatnosc", "privacy", "datenschutz", "ochrana osobnich udaju", "ochrana sukromia", "confidentialitate",
        "adatvedelem", "gdpr", "rodo",
      ],
      path: ["prywatnos", "privacy", "datenschutz", "rodo", "gdpr", "ochrana", "confidentialitate", "adatved"],
    },
    contact: {
      text: ["kontakt", "contact", "impressum", "kontaktujte", "contactati", "kapcsolat"],
      path: ["kontakt", "contact", "impressum", "kapcsolat", "contacte"],
    },
  },
  oldPriceClassTokens: ["old", "compare", "regular", "was", "before", "stara", "przekreslona", "strike", "crossed", "original", "msrp", "list"],
  priceClassTokens: ["price", "cena", "amount", "preis", "cenik", "pret", "ar"],
  sitewide: { minItems: 5, minShare: 0.7, minDiscountPct: 50 },
  omnibusPhrases: [
    "(?:najnizsz\\w*|lowest|niedrigst\\w*|nejnizsi|najnizsia|cel mai mic|legalacsonyabb)[^.\\n]{0,70}30\\s*(?:dni|days|tage|dnu|zile|nap)",
    "omnibus",
  ],
  techniquePhrases: {
    recent_purchase_popup: [
      "(?:kupil[aoi]?|zamowil[aoi]?|bought|purchased|ordered|kaufte|gekauft)[^.\\n]{0,50}(?:temu|ago|przed chwila|just now|gerade eben|vor \\d+)",
      "(?:wlasnie|just)\\s+(?:kupil[aoi]?|bought|purchased)",
      "\\b[a-z]+ (?:z|from|aus) [a-z]+ (?:kupil[aoi]?|bought|purchased|kaufte)\\b",
    ],
    low_stock_claim: [
      "ostatni\\w*\\s+(?:\\d+\\s+)?(?:sztuk\\w*|szt\\b)",
      "(?:tylko|only|nur noch)\\s+\\d+\\s+(?:szt\\w*|sztuk\\w*|left|in stock|na stanie|stuck|auf lager)",
      "\\d+\\s+(?:osob\\w*|people|persons|users|personen)\\s+(?:ogladaj\\w*|viewing|watching|looking|ansehen)",
      "last\\s+\\d+\\s+(?:items|pieces|units)",
      "only\\s+\\d+\\s+left",
    ],
    countdown_timer: ["(?:oferta|promocja|sale|offer|angebot)[^.\\n]{0,40}(?:konczy sie|ends|endet)[^.\\n]{0,30}\\b\\d{1,2}:\\d{2}:\\d{2}\\b"],
    closing_down_story: [
      "likwidacj(?!a danych)\\w*",
      "zamykamy\\s+(?:nasz\\s+)?sklep",
      "sklep sie zamyka",
      "wyprzedaz calego magazynu",
      "rodzinn\\w+\\s+(?:sklep|firma)[^.\\n]{0,40}zamyka",
      "closing down",
      "going out of business",
      "store (?:is )?closing",
      "liquidation sale",
      "family (?:business|store|shop)[^.\\n]{0,40}clos",
      "geschaftsaufgabe",
      "raumungsverkauf",
      "likvidace",
      "lichidare de stoc",
      "kiarusitas",
    ],
    crypto_discount: [
      "(?:dodatkow\\w*|extra|additional|zusatz\\w*|further)\\s+(?:\\d+\\s*%\\s*)?(?:rabat\\w*|discount|znizk\\w*|rabatt|sleva)[^.\\n]{0,80}(?:krypto\\w*|crypto\\w*|bitcoin|btc|usdt|blik|przelew)",
      "(?:krypto\\w*|crypto\\w*|bitcoin|btc|usdt)[^.\\n]{0,50}-\\s*\\d+\\s*%",
      "\\d+\\s*%[^.\\n]{0,40}(?:rabat\\w*|discount|off|taniej|znizk\\w*)[^.\\n]{0,40}(?:krypto\\w*|crypto\\w*|bitcoin|btc|usdt)",
    ],
    waitlist_upsell: ["list\\w* oczekujacych[^.\\n]{0,120}(?:doplat\\w*|oplat\\w*)", "waitlist[^.\\n]{0,100}(?:fee|surcharge|pay)", "(?:doplat\\w*|oplat\\w*)[^.\\n]{0,100}list\\w* oczekujacych"],
    trial_subscription: [
      "(?:okres probny|trial period|free trial|probezeitraum|testovaci obdobi)[^.\\n]{0,160}(?:automatyczn\\w+ odnowien\\w*|subskrypcj\\w*|subscription|auto[- ]?renew\\w*|abonnement|verlangert)",
      "(?:automatyczn\\w+ odnowien\\w*|auto[- ]?renew\\w*)[^.\\n]{0,120}(?:okres probny|trial)",
    ],
    blik_via_messenger: [
      "(?:kod|code)\\s+blik[^.\\n]{0,80}(?:messenger|whatsapp|telegram|czat|chat|komunikator)",
      "(?:messenger|whatsapp|telegram|czat|chat|komunikator)[^.\\n]{0,80}(?:kod|code)\\s+blik",
    ],
    fake_courier_payment: [],
  },
  countdownTokens: ["countdown", "count-down", "timer", "odliczanie", "odlicz", "flash-sale", "sale-timer"],
  paymentMethods: {
    card: ["\\bvisa\\b", "mastercard", "maestro", "karta platnicza", "karty platnicze", "karta kredytowa", "credit card", "debit card", "kreditkarte", "american express", "\\bamex\\b"],
    blik: ["\\bblik\\b"],
    transfer: ["przelew bankowy", "przelew tradycyjny", "przelewem tradycyjnym", "przelewem bankowym", "bank transfer", "wire transfer", "uberweisung", "ueberweisung", "vorkasse", "platba prevodem", "\\bprzelew\\b"],
    przelewy24: ["przelewy ?24", "\\bp24\\b"],
    payu: ["\\bpayu\\b"],
    paypal: ["paypal"],
    stripe: ["\\bstripe\\b"],
    tpay: ["\\btpay\\b", "dotpay"],
    apple_pay: ["apple ?pay"],
    google_pay: ["google ?pay", "gpay"],
    klarna: ["klarna"],
    cod: ["za pobraniem", "platba na dobirku", "cash on delivery", "\\bcod\\b", "nachnahme", "ramburs", "utanvet"],
    crypto: ["bitcoin", "\\bbtc\\b", "usdt", "ethereum", "kryptowalut\\w*", "\\bcrypto\\b", "\\bkrypto\\b"],
    gift_card: ["karta podarunkowa", "karty podarunkowe", "gift ?card", "paysafecard", "kod podarunkowy", "google play card"],
  },
  irreversibleMethods: ["crypto", "blik", "gift_card"],
  recipientLabels: ["odbiorca", "nazwa odbiorcy", "beneficjent", "wlasciciel konta", "recipient", "beneficiary", "account holder", "kontoinhaber", "empfanger", "dane odbiorcy"],
  giftTitleWords: ["prezent", "darowizna", "dar", "gift", "donation", "pozyczka", "geschenk", "spende"],
  firmWords: [
    "sklep", "shop", "store", "group", "grupa", "online", "market", "company", "firma", "bank", "studio", "handel", "service", "serwis",
    "trade", "trading", "centrum", "center", "centre", "marketplace", "moda", "fashion", "sport", "tech", "electronics",
  ],
  deliveryLabels: ["czas realizacji", "realizacja zamowienia", "czas dostawy", "dostawa", "wysylka", "delivery", "shipping", "lieferzeit", "lieferung", "dodani", "dorucenie", "livrare", "szallitas"],
  deliveryUnits: ["dni", "dnia", "dzien", "days", "day", "tage", "werktage", "dni roboczych", "dny", "dni", "zile", "nap"],
  deliveryWide: { maxDays: 21, ratio: 5 },
  reviews: { minCount: 10, perfectShare: 0.95, narrowWindowDays: 21, aggregatePerfectAvg: 4.95 },
  anonymousAuthors: ["anonim", "anonimowy", "anonymous", "gosc", "guest", "klient", "customer", "kunde", "uzytkownik", "user"],
  reviewWords: ["opinie", "opinii", "opinia", "recenzje", "recenzji", "reviews", "review", "bewertungen", "bewertung", "hodnoceni", "recenze", "recenzii", "ertekelesek", "ertekeles"],
  catalog: {
    categories: {
      elektronika: ["iphone", "ipad", "smartfon", "telefon", "laptop", "sluchawk", "dron", "telewizor", "konsol", "kamera", "tablet", "smartwatch", "playstation", "macbook", "airpods", "monitor", "procesor", "elektronik"],
      zabawki: ["klock", "lego", "zabawk", "lalk", "puzzle", "pluszak"],
      "odzież": ["koszulk", "spodnie", "kurtk", "buty", "sukienk", "bluza", "sweter", "plaszcz", "spodnic"],
      "narzędzia": ["wiertark", "mlotek", "szlifierk", "wkretark", "spawark", "pilark"],
      kosmetyki: ["krem ", "szminka", "perfum", "serum", "szampon", "puder", "balsam"],
      "robótki": ["wloczk", "kordonek", "szydelk", "druty", "robotek"],
      "ogród": ["kosiark", "donic", "nasion", "ogrodow"],
      meble: ["sofa", "fotel", "szafa", "biurko", "krzeslo"],
      sport: ["rower", "hantl", "bieznia", "namiot"],
      "zwierzęta": ["karma dla", "legowisko", "smycz"],
    },
    maxProducts: 50,
    minCategories: 3,
    minProducts: 3,
  },
  sellerReplyTokens: ["reply", "response", "odpowiedz", "answer", "owner", "seller"],
  noReplyMinCount: 20,
  footerStaleYears: 2,
  claimedSinceGapYears: 3,
  claimedSince: {
    year: ["\\bod\\s+(?:roku\\s+)?((?:19|20)\\d\\d)\\b", "\\bsince\\s+((?:19|20)\\d\\d)\\b", "\\bseit\\s+((?:19|20)\\d\\d)\\b", "\\b(?:established|founded|zalozon\\w*|zalozeno)\\s+(?:in\\s+|w\\s+(?:roku\\s+)?)?((?:19|20)\\d\\d)\\b", "\\bod\\s+((?:19|20)\\d\\d)\\s+roku\\b"],
    years: ["\\b(\\d{1,2})\\s+(?:lat|lata|years|jahre|let|rokov|ani|eve)\\s+(?:na rynku|doswiadczenia|on the market|of experience|erfahrung|na trhu|experienta|tapasztalat)"],
  },
};

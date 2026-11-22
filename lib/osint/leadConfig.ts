/**
 * Lists and thresholds of the lead-company traces (I23): what the page's lead form, its scripts and its
 * template text reveal about the operator. The extractors in lib/osint and lib/text read them from here,
 * so a change of a list does not need a change of code; the weights of the resulting pivots live in
 * lib/graph/config.ts.
 */

export const LEAD_CONFIG = {
  phoneExamples: {
    /**
     * Words that, just before a number, mark it as the example of a form field ("Na przykład: …",
     * "np. …", "format …"). Such a number is copied with the page template to every site built on it,
     * so it names the template, not the operator's phone line.
     */
    // the lookbehind keeps "example" of a domain or an e-mail address ("biuro@firma.example") out
    markers: /(?<![\w.@-])(?:np\.|na przyk[łl]ad|przyk[łl]ad|e\.\s?g\.|example|format|wz[óo]r)/i,
    /** How far before a number (characters of visible text) a marker still counts. */
    windowChars: 40,
    /**
     * Polish national numbers (9 digits) that no operator would publish: one digit repeated, an ascending
     * or descending run. They are dropped both as phones and as examples.
     */
    artificialNationals: [/^(\d)\1{8}$/, /^123456789$/, /^987654321$/, /^(\d{3})\1\1$/],
  },
  crmKey: {
    /** Names of a key or token field, lower-cased with "-" and "_" removed (apiKey = api_key = api-key). */
    names: ["apikey", "xapikey", "token", "accesskey", "accesstoken", "authtoken", "authkey", "leadkey", "crmkey"],
    /**
     * Field names that hold a per-session CSRF token or a public widget key, lower-cased as is: a new
     * value per visit or the same value for every client of the service, never one operator's account.
     */
    excludedNames: ["_token", "csrf", "csrf_token", "csrftoken", "_csrf", "authenticity_token", "__requestverificationtoken", "sitekey", "data-sitekey"],
    /**
     * Values of public keys that already are other traces or are shared by many sites: Google APIs and
     * Maps (AIza…), reCAPTCHA site keys (6L…), Stripe and Mapbox publishable keys, analytics IDs, pixel
     * numbers (digits only).
     */
    excludedValues: [/^AIza[0-9A-Za-z_-]{20,}$/, /^6L[0-9A-Za-z_-]{30,}$/, /^pk_(?:live|test)_/, /^pk\./, /^(?:G|UA|GTM|AW)-/, /^\d+$/],
    /** Shortest key that counts (characters): shorter values are form defaults or IDs, not secrets. */
    minLength: 16,
    maxLength: 200,
    /** Lowest Shannon entropy of the value (bits per character): "aaaa…" or "testtesttest…" is no key. */
    minEntropyBits: 3,
    /** Characters of the key kept at each end of the preview ("abcd…wxyz"); the rest is never stored. */
    previewChars: 4,
  },
  templatePhrase: {
    /** Shortest sentence that counts (words): shorter ones ("Zarejestruj się teraz") are on every page. */
    minWords: 6,
    /** Longest sentence kept (words): longer runs are lists or text without punctuation, not one sentence. */
    maxWords: 40,
    /** At most this many sentences per page (document order). */
    maxPerPage: 120,
    /** Characters of the original sentence kept for the reader. */
    maxQuoteChars: 200,
    /**
     * Consent, cookie, legal and risk-warning boilerplate: the same on pages of unrelated operators, so
     * it is never a template trace (case-insensitive, on the original sentence).
     */
    boilerplate: [
      /rodo|gdpr|dan(?:e|ych) osobow|przetwarzan|administrator(?:em)? danych|personal data/i,
      /cookie|ciasteczk|polityk[aięi] prywatno|privacy policy/i,
      /regulamin|terms (?:and|&) conditions|wszelkie prawa zastrze|all rights reserved|copyright/i,
      /wyra[żz]am zgod|zgod[aęy] na|consent/i,
      /kontrakty? cfd|cfds? are complex|ryzyk\w* utraty|risk warning/i,
    ],
    /**
     * Words of the message shown after the form is sent (success handler, thank-you text): a string
     * literal of a script counts when it holds one or follows one within `scriptContextChars`.
     */
    scriptMarkers: /success|thank|dzi[ęe]kuj|zadzwoni|skontaktuj|alert\s*\(|innerHTML\s*=|textContent\s*=|innerText\s*=/i,
    scriptContextChars: 160,
    /** Shortest repeated run of words that makes a sentence odd ("zapozna cię z zapozna cię z"). */
    repeatRunWords: 3,
  },
  advertiserMismatch: {
    /**
     * Words of a local business or a non-financial trade in the advertiser's name (folded: lower case,
     * no diacritics). An investment ad from such an account is most likely run from a stolen account
     * paid with a victim's card, so the name belongs to the victim, not to the operator.
     */
    businessWords: [
      "pensjonat", "hotel", "hostel", "apartament", "sklep", "salon", "fryzjer", "barber", "restauracj", "pizzeri", "kawiarni", "bistro",
      "kwiaciarni", "warsztat", "auto", "mechanik", "apteka", "przedszkol", "szkola jazdy", "piekarni", "cukierni", "kosmetyk", "fitness",
      "silowni", "weterynar", "stomatolog", "dentyst", "gabinet", "spa", "agroturyst", "domki", "noclegi", "zoolog", "meble",
    ],
    /** Words of a financial name ("Invest", "Kapitał", "Trading" …): such a name fits an investment ad. */
    financeWords: ["invest", "inwest", "kapital", "capital", "finans", "financ", "trad", "gield", "crypto", "krypto", "bitcoin", "fund", "bank", "broker", "forex", "zysk", "profit", "wealth", "money", "ai"],
    /** A private person's name: two or three capitalised words of letters ("Jan Kowalski", "Anna Nowak-Lis"). */
    personName: /^\p{Lu}\p{Ll}+(?:[ -]\p{Lu}\p{Ll}+){1,2}$/u,
    /**
     * Words of page and brand names that look like a person's name only by their shape ("Boss Stream",
     * "Daily Studio"): a name with one of them is no private person (folded, whole words).
     */
    brandWords: [
      "formal", "favorable", "boss", "stream", "group", "flow", "star", "media", "news", "global", "best", "top", "smart", "daily", "life",
      "style", "shop", "store", "official", "club", "team", "world", "digital", "online", "home", "service", "services", "solutions", "company",
      "agency", "marketing", "pro", "plus", "center", "centre", "hub", "lab", "labs", "studio", "tech", "network", "channel", "info", "portal",
      "house", "art", "design", "beauty", "fashion", "sport", "health", "academy", "events", "travel", "games", "zone", "point", "story",
    ],
  },
  profitClaims: {
    /**
     * Words just before an amount that make it a deposit ("minimalny depozyt", "wpłata", "wpłać"): kept in
     * the attribute with no period, never in the pivot (every scheme asks for about the same deposit).
     */
    depositContext: /(?:depozyt|wp[łl]at|wp[łl]a[cć]|deposit|inwestycj[aię] pocz[aą]tkow|na start)\S*\s*(?:\S+\s+){0,3}$/i,
    /** Characters before an amount searched for the deposit context. */
    contextChars: 50,
    /** Amounts that every scheme names (the standard 250 deposit): never part of the pivot key. */
    standardAmounts: [250],
  },
} as const;

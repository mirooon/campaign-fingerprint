/**
 * Lists and thresholds of the text fingerprint of a page kit (I25): which scripts are never read for text
 * traces (the page platform's SDK, framework bundles, public libraries), how an interface dictionary is
 * recognised and what a developer message of a kit script looks like. The extractors in lib/osint read
 * them from here; the weight of `kit_string` and the frequency mask of the graph live in lib/graph/config.ts.
 */

export const TEXT_CONFIG = {
  textBoilerplate: {
    /**
     * Paths of scripts served by a page platform or produced by a framework build: one file for every
     * account of the platform (its SDK) or the same runtime on every site of the framework, so a string
     * in it says nothing about the operator. Matched case-insensitively against the script address (path
     * and file name, also of a saved page's `_files`).
     */
    platformScriptPaths: [
      /\/aio-static\/sdk\//i,
      /\/_next\/static\/(?:chunks|runtime|[\w-]+\/_buildManifest)/i,
      /\/_nuxt\//i,
      /\/static\/js\/(?:main|runtime|vendors?|\d+)\.[0-9a-f]{8,}(?:\.chunk)?\.js/i,
      // content-hashed bundles of a framework runtime ("framework-<hash>.js", "chunk-vendors.<hash>.js")
      /(?:^|\/)(?:framework|webpack|polyfills|main-app|chunk-vendors|vendors?|runtime)[.-][0-9a-f]{8,}(?:\.min)?\.js/i,
    ],
    /**
     * ISO 639-1 codes recognised as keys of an interface dictionary (`{ en: {...}, pl: {...} }`). Codes that
     * are also common words or property names in code ("id", "is", "to", "no", "my", "he") are left out,
     * so `{ id: …, to: … }` is never mistaken for a translation.
     */
    languageCodes: [
      "en", "pl", "de", "fr", "it", "es", "pt", "nl", "sv", "da", "fi", "nb", "cs", "sk", "hu", "ro", "bg", "el", "ru", "uk", "tr", "ar",
      "ja", "ko", "zh", "hi", "bn", "vi", "th", "lt", "lv", "et", "sl", "hr", "sr", "ka", "hy", "ms", "fa", "ur", "sq", "mk", "kk", "az",
    ],
    /**
     * Distinct language keys in one script that make it a dictionary of interface messages: the platform
     * translates the same buttons into many languages, a kit for one market does not.
     */
    localizedUiMinLanguages: 5,
  },
  kitStrings: {
    /**
     * Public libraries by file name or path (case-insensitive): their log messages are on millions of
     * pages and never name a kit.
     */
    libraries: [
      /jquery/i, /swiper/i, /(?:^|[/.-])hls(?:\.light)?(?:\.min)?\.js/i, /video(?:\.js|js|-js)/i, /gtm\.js|googletagmanager|gtag/i,
      /fbevents|connect\.facebook/i, /react(?:-dom)?[.-]/i, /(?:^|\/)vue(?:\.runtime)?[.-]/i, /lodash|underscore/i, /sentry/i, /bootstrap/i,
      /slick/i, /owl\.carousel/i, /intl-?tel-?input|libphonenumber/i, /moment(?:\.min)?\.js/i, /axios/i, /polyfill/i,
      /recaptcha|hcaptcha|turnstile/i, /analytics|clarity|hotjar|matomo|yandex|metrika/i, /fancybox|lightbox|magnific/i, /aos(?:\.min)?\.js/i,
      /gsap|anime(?:\.min)?\.js|lottie/i, /plyr|wistia|vimeo|youtube/i, /cookie(?:consent|bot|law)/i, /mask(?:\.min)?\.js|inputmask|imask/i,
    ],
    /** Fewest words of a developer message ("Init done" is everywhere, "Trap module armed!" is a kit's). */
    minWords: 3,
    /** Shortest and longest literal looked at (characters). */
    minChars: 10,
    maxChars: 200,
    /** Lowest share of letters and spaces in the literal: below it the string is code, a selector or data. */
    minLetterShare: 0.7,
    /**
     * Code just before the literal (same statement) that makes it a developer message: a console or log
     * call, an error thrown, an alert.
     */
    messageContext: /(?:console\.\w+|\blog\w*|\bdebug\w*|\bwarn\w*|\balert|\bthrow\s+new\s+\w*Error|\bnew\s+\w*Error)\s*\(?\s*$/i,
    /** Endings that make a literal outside a log call a message too ("…armed!", "Loading...", "Error:"). */
    messageEnding: /(?:!|\.\.\.|…|:)\s*$/,
    /** Characters of code before a literal searched for the message context. */
    contextChars: 60,
    /** At most this many kit strings per page. */
    maxPerPage: 100,
    /** Characters of the original string kept for the reader. */
    maxQuoteChars: 120,
    /** Own scripts of a page read for text traces (import and live fetch): at most this many, each up to maxScriptBytes. */
    maxScriptsPerPage: 30,
    maxScriptBytes: 512 * 1024,
  },
} as const;

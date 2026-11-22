/**
 * Dictionaries of the contact identifiers read from a page, an ad text, an OCR of a screenshot or the
 * requests of a HAR (I28): shared documents and forms, shared chats with a language model, onion
 * addresses and invitations to messengers. The finders in lib/osint/contactIds.ts read them from here;
 * the weights of the resulting traces live in lib/graph/config.ts (the same as `telegram`).
 */

/** One way to write the address of a shared resource; `id` is the capture group that names the resource. */
export interface SharedDocPattern {
  /** Service in the key (`<service>:<id>`). */
  service: string;
  pattern: RegExp;
  /** Index of the capture group with the resource id. */
  group: number;
}

export const CONTACT_CONFIG = {
  sharedDocs: {
    /**
     * Addresses of documents, forms and chats an operator shares: the resource is one account's asset, so
     * the same id on two materials is a trace of the operator. A shared chat with a language model is the
     * operator pasting the campaign data into a chat and sharing the link.
     */
    patterns: [
      { service: "google_doc", pattern: /docs\.google\.com\/document\/(?:u\/\d+\/)?d\/(?:e\/)?([A-Za-z0-9_-]{20,})/gi, group: 1 },
      { service: "google_sheet", pattern: /docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/(?:e\/)?([A-Za-z0-9_-]{20,})/gi, group: 1 },
      { service: "google_slides", pattern: /docs\.google\.com\/presentation\/(?:u\/\d+\/)?d\/(?:e\/)?([A-Za-z0-9_-]{20,})/gi, group: 1 },
      { service: "google_form", pattern: /docs\.google\.com\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?([A-Za-z0-9_-]{20,})/gi, group: 1 },
      { service: "forms_gle", pattern: /(?<![\w.-])forms\.gle\/([A-Za-z0-9]{8,32})/gi, group: 1 },
      { service: "google_drive", pattern: /drive\.google\.com\/(?:file\/d\/|drive\/(?:u\/\d+\/)?folders\/|open\?(?:[^"'\s<>]*?&(?:amp;)?)?id=)([A-Za-z0-9_-]{20,})/gi, group: 1 },
      { service: "notion", pattern: /(?:[\w-]+\.)?notion\.(?:so|site)\/(?:[^"'\s<>?#]*-)?([0-9a-f]{32})(?![0-9a-z])/gi, group: 1 },
      // a workspace address without a page id; an address with an id is the "notion" pattern above
      { service: "notion_site", pattern: /(?<![\w.-])([a-z0-9][a-z0-9-]{1,40}\.notion\.site)(?![\w.-])(?!\/[^\s"'<>]*[0-9a-f]{32})/gi, group: 1 },
      { service: "ms_forms", pattern: /forms\.(?:office|microsoft)\.com\/r\/([A-Za-z0-9]{6,12})(?![\w])/gi, group: 1 },
      { service: "ms_forms", pattern: /forms\.(?:office|microsoft)\.com\/[^"'\s<>]*?[?&](?:amp;)?id=([A-Za-z0-9_-]{20,})/gi, group: 1 },
      { service: "typeform", pattern: /(?<![\w.-])[a-z0-9-]+\.typeform\.com\/to\/([A-Za-z0-9]{4,12})(?![\w])/gi, group: 1 },
      { service: "jotform", pattern: /(?:(?:[a-z]{2,3}\.)?form\.jotform\.com|jotform\.com\/form)\/(\d{10,20})(?!\d)/gi, group: 1 },
      { service: "llm_chat", pattern: /(?:chatgpt\.com|chat\.openai\.com)\/share\/(?:e\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi, group: 1 },
      { service: "llm_chat", pattern: /claude\.ai\/share\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi, group: 1 },
      { service: "llm_chat", pattern: /(?:g\.co\/gemini\/share|gemini\.google\.com\/share|grok\.com\/share|x\.com\/i\/grok\/share|poe\.com\/s|perplexity\.ai\/search)\/([A-Za-z0-9_.-]{6,120})/gi, group: 1 },
    ] satisfies SharedDocPattern[],
    /**
     * Ids that are not an operator's asset: the sample ids of the vendors' documentation. Compared
     * case-sensitively with the id captured from an address.
     */
    excludedIds: [
      // the sample spreadsheet of the Google Sheets API documentation
      "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
    ],
    /** Subdomains of notion.site that are the vendor's own pages, not a workspace of a customer. */
    excludedNotionSites: ["www", "help", "blog", "developers", "status", "templates"],
    /** Services whose id is not case-sensitive (UUIDs, hex ids, host names): lower-cased, so an OCR in capitals gives the same key. */
    caseInsensitiveServices: ["llm_chat", "notion", "notion_site"],
  },
  onion: {
    /** Version 3 onion address: 56 base32 characters. The label before the TLD, so "sub.<id>.onion" is read too. */
    v3: /(?<![a-z0-9-])([a-z2-7]{56})\.onion(?![a-z0-9-])/gi,
    /** Version 2 (16 characters): retired in 2021, kept only as an attribute of the material, never as a trace. */
    v2: /(?<![a-z0-9-])([a-z2-7]{16})\.onion(?![a-z0-9-])/gi,
  },
  discordSnowflake: {
    /** Links with a Discord id (17 to 20 digits): a server and channel in "channels/<server>/<channel>", a user in "users/<id>". */
    pattern: /discord(?:app)?\.com\/(?:channels\/(\d{17,20})(?:\/(\d{17,20}))?|users\/(\d{17,20}))/gi,
    /** Discord epoch (ms since 1970-01-01): the id's upper bits count milliseconds from it. */
    epochMs: 1420070400000,
    /** An id decoding to a date earlier than the service's start (2015-05-13) is not an id. */
    earliestMs: 1431475200000,
  },
  messengers: {
    discord: /(?<![\w.-])(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]{3,32})(?![A-Za-z0-9-])/gi,
    signalPerson: /signal\.me\/#p\/(\+?\d{8,15}|[A-Za-z0-9_]{3,32}\.\d{2})(?![\w.])/gi,
    signalGroup: /signal\.group\/#([A-Za-z0-9_-]{20,})/gi,
    viber: /viber:\/\/(?:chat|add)\?(?:[^"'\s<>]*?&(?:amp;)?)?number=(?:\+|%2B)?(\d{8,15})(?!\d)/gi,
    line: /(?:line\.me\/(?:R\/)?ti\/p\/|(?<![\w.-])lin\.ee\/)(~?@?[A-Za-z0-9._-]{3,40})(?![\w.-])/gi,
    /**
     * Invite codes of the platforms' own communities and support servers (Discord's developer and
     * townhall servers and the like): the same code on two pages names the platform, not an operator.
     * Lower-case, compared with the lower-cased code.
     */
    excludedCodes: ["discord", "discord-developers", "discord-api", "discord-townhall", "discordtesters", "discordapp", "discordstaff", "safety"],
  },
} as const;

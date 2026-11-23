/**
 * Plain-English dictionary of the GUI: what every feature type is, why it matters for linking, an
 * example, and the sentence a piece of evidence of that type becomes. Also the glossary (§9) used by the "?"
 * bubbles and the Glossary page, and the help notes moved here from the expert DetailsPanel.
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
  /** Sentence of a piece of evidence of this type ("Both …"). */
  sentence: string;
}

type AnyType = EntityType | SimilarityEdgeType;

export const TYPE_INFO: Record<AnyType, TypeInfo> = {
  item: { name: "Sample", what: "One ad together with the files collected for it.", why: "We link samples by their shared traces.", example: "a screenshot of an ad with the saved page", sentence: "The same sample" },
  url: { name: "Page URL", what: "The full address of the page the ad leads to.", why: "The same URL in two ads almost certainly means the same operator.", example: "example.test/start", sentence: "Both ads lead to the same page URL" },
  host: { name: "Host", what: "The server name from the page URL, including the subdomain.", why: "The same subdomain usually means the same site and the same owner.", example: "offer.example.test", sentence: "Both ads lead to the same server (host)" },
  domain: { name: "Domain", what: "The address of a site, e.g. example.test. Fraudsters often register new domains for just a few days.", why: "A shared domain links samples on its own, unless it is a large service used by many.", example: "example.test", sentence: "Both ads lead to the same domain" },
  ip: { name: "IP address", what: "The number of the server the page runs on.", why: "The same small server may point to one owner; we discount addresses shared by large hosting companies.", example: "192.0.2.10", sentence: "The pages run on the same IP address" },
  asn: { name: "Network (ASN)", what: "The number of the provider network the server sits in.", why: "One network holds thousands of unrelated sites, so this is a weak trace.", example: "AS64500", sentence: "The servers sit in the same provider network" },
  mx: { name: "Mail server (MX)", what: "The server that receives a domain's email.", why: "A self-hosted mail server is a trace of the operator; we discount shared services (Google, Microsoft, Zoho, the registrar's mail), and this trace never links a campaign on its own.", example: "mail.mail-example.test", sentence: "The domains share the same self-hosted mail server" },
  nameserver: { name: "Name servers (NS)", what: "Servers that tell where a domain runs.", why: "The same unusual pair of servers may link domains of one owner.", example: "ns1.dns-example.test", sentence: "The domains use the same name servers" },
  registrar: { name: "Registrar", what: "The company the domain was bought from.", why: "A popular registrar says little; registrations in batches say more.", example: "Example Registrar", sentence: "The domains were bought from the same registrar" },
  cert: { name: "HTTPS certificate", what: "A file a site needs to work over https. Every certificate goes into a public log.", why: "One certificate for several domains is usually issued to one owner; we discount free certificate authorities.", example: "a certificate for a.test and b.test", sentence: "The domains share an HTTPS certificate" },
  tracker: { name: "Tracker / pixel", what: "Code of an advertising or analytics company with an account ID.", why: "The same ID on two pages usually means the same owner.", example: "Meta Pixel 000000000000001", sentence: "The pages have the same tracker ID (analytics or ad account)" },
  favicon: { name: "Favicon", what: "The small site icon in the browser tab.", why: "The same icon points to the same page kit; it is not enough on its own.", example: "an icon shaped like a logo", sentence: "The pages have an identical icon (favicon)" },
  imagehash: { name: "Image fingerprint", what: "A hash of the ad image that survives small changes.", why: "The same creative in two ads means the same ad or a variant of it.", example: "the same picture with a different caption", sentence: "The ads have an identical image" },
  wallet: { name: "Crypto wallet", what: "The wallet address the page asks you to pay into.", why: "The same wallet means the same money, so the same operator.", example: "a TRON wallet address", sentence: "The pages give the same crypto wallet" },
  email: { name: "Email", what: "An email address given on the page.", why: "The same contact on two pages usually means the same operator.", example: "contact@example.test", sentence: "The pages give the same email address" },
  phone: { name: "Phone", what: "A phone number given on the page.", why: "The same number on two pages usually means the same operator.", example: "+48 000 000 000", sentence: "The pages give the same phone number" },
  telegram: { name: "Telegram", what: "A Telegram channel or account given on the page.", why: "The same contact channel usually means the same operator.", example: "t.me/example_channel", sentence: "The pages point to the same Telegram channel" },
  shared_doc: { name: "Document, form or chat shared by link", what: "The address of a document, spreadsheet or form (Google, Notion, Microsoft Forms, Typeform, Jotform) or of a shared conversation with a language model, found on the page, in the ad, in a screenshot or in the page's network traffic.", why: "Such a resource belongs to one account, so the same ID in two samples points to one operator. A shared AI chat is sometimes a pasted campaign plan.", example: "a Google form with the same ID on two pages", sentence: "The samples point to the same shared document, form or chat" },
  onion: { name: ".onion address", what: "The address of a hidden service on the Tor network (version 3, 56 characters).", why: "The same address means the same operator resource; we do not count version 2 addresses, because they have expired.", example: "56 characters and .onion", sentence: "The samples give the same .onion address" },
  c2_host: { name: "Trojan C2 server in the page kit", what: "The address of the server to which a script of a copied page kit (e.g. a fake lazysizes library) sends cookies or login details from a fake tracker panel.", why: "All copies of the same downloaded kit report to the same server, so a shared address points to one operator of the kit.", example: "c2.example.test", sentence: "The scripts of these pages send data to the same C2 server" },
  messenger_invite: { name: "Messenger invite or account", what: "A Discord invite, or a Signal, Viber or Line account or group, given on the page, in the ad or in a screenshot.", why: "The same invite or account usually means the same operator (like a Telegram channel).", example: "discord.gg/examplecode", sentence: "The samples point to the same messenger invite or account" },
  affiliate_account: { name: "Affiliate network account", what: "Partner IDs of an affiliate network in the order link, in an encoded referer parameter or in hidden form fields: team and user (team_id, user_id), stream (stream_id) or offer (offer_uuid), always together with the network's address.", why: "A stream and an offer in the same network belong to one partner who buys traffic. The team and user pair are small numbers, so the pair alone does not link a campaign: a second trace is needed.", example: "network.example.test · team_id=42, user_id=13", sentence: "The samples send leads to the same affiliate network account" },
  overlay_template: { name: "Replaced-caption template", what: "The editing layout: a blurred or covered bar at the bottom of someone else's footage and the operator's own captions (kind, color, position and size relative to the frame).", why: "The same layout in different videos means the same tool or the same editor; it is not enough on its own, because tools are shared.", example: "a white bar over the bottom 10% of the frame", sentence: "The videos have the same layout of replaced captions" },
  reused_footage: { name: "Source mark of reused footage", what: "The name or logo of a studio or TV station in the corner of the frame: the mark of the original the footage was taken from. Marks of editors and platforms (CapCut, TikTok and others) are ignored.", why: "The same mark in ads of different advertisers means a shared library of stolen footage; it is not enough on its own.", example: "“Studio Test” in the top right corner", sentence: "The samples use footage with the same source mark" },
  advertiser: { name: "Advertiser", what: "The name of the profile that published the ad.", why: "The same profile means the same ad account; names can be generic and repeated, though.", example: "Daily News Demo", sentence: "The ads were published by the same advertiser" },
  endpoint: { name: "Form backend", what: "The address the page sends form data to.", why: "A shared backend on different domains is a strong trace; we discount public form services.", example: "collector.test/api/save", sentence: "The forms on both pages send data to the same address" },
  hidden_fields: { name: "Hidden form fields", what: "The set of names of invisible fields in the page form.", why: "The same set points to the same page template; it is not enough on its own.", example: "lp_id, offer_hash", sentence: "The forms have the same set of hidden fields" },
  asset: { name: "JS/CSS file", what: "The site's own script or style file.", why: "The same unusual file points to the same page kit; we discount popular libraries.", example: "lead-form.9f8e.js", sentence: "The pages load the same own script or style file" },
  comment: { name: "Code comment", what: "A developer's note left in the page code.", why: "The same unusual comment points to the same template; we discount standard comments.", example: "“put the form after the phone block”", sentence: "The page code contains the same developer comment" },
  domain_pattern: { name: "Domain name pattern", what: "A repeated naming scheme of domains, e.g. refund<number>-<word>.test.", why: "Domains from one scheme are usually registered in batches by one operator.", example: "refund12-abc.test, refund37-xyz.test", sentence: "The domains follow the same naming pattern" },
  cname_target: { name: "Domain alias (CNAME)", what: "A record that points a domain to another server.", why: "A shared, unusual alias target points to shared infrastructure; we discount large CDNs.", example: "traffic.example.test", sentence: "The domains point to the same server (CNAME)" },
  campaign_param: { name: "Campaign parameter", what: "A campaign tag added to the ad link (e.g. utm_campaign).", why: "The same unusual value usually means the same ad campaign; we discount generic values.", example: "utm_campaign=summer_07", sentence: "The ad links have the same campaign parameter" },
  fictional_expert: { name: "Fictitious expert", what: "A “dr” or “prof.” title with a first and last name that is not on the list of public figures (e.g. “dr Jan Testowy”), used as an authority on the page, in the ad or in a screenshot.", why: "A made-up figure is invented by one operator, so the same name (even with a typo) on different domains points to one author. A name repeated often in the data set loses weight.", example: "dr Jan Testowy and dr Jan Testowyy", sentence: "The samples cite the same fictitious expert" },
  persona: { name: "Persona", what: "The person the ad impersonates.", why: "The same person appears in many unrelated campaigns, so on its own it does not link samples.", example: "Adam Testowy", sentence: "The ads use the likeness of the same person" },
  path_id: { name: "Account ID in file paths", what: "A random ID in the addresses of the page files, assigned by the page builder.", why: "The same ID means the same page-builder account.", example: "/a1b2c3d4-…/style.css", sentence: "The page files sit under the same page-builder account ID" },
  param_schema: { name: "Tracking-link template", what: "The names of the link parameters and the kind of their values.", why: "It points to a traffic-routing system used by many customers: a supporting trace.", example: "sub1, sub2, clickid", sentence: "The links have the same layout of tracking parameters" },
  hosting_account: { name: "Video or code hosting account", what: "The video library of one customer of a hosting service (video host address with the library ID) or a GitHub account from which jsDelivr serves the page files (`cdn.jsdelivr.net/gh/<account>/…`).", why: "Two pages with files from the same library or the same account use one account, unlike the CDN domain itself, which thousands of unrelated sites share. The trace supports a link but does not link a campaign on its own.", example: "library 0a1b2c3d", sentence: "Both pages play videos from the same video library" },
  platform_account: { name: "Page-builder account", what: "The owner ID in a page-building tool.", why: "The same account means the same operator. Different accounts on the same platform do not go into one campaign without strong evidence.", example: "account 1a2b…", sentence: "Both pages belong to the same page-builder account" },
  meta_token: { name: "Meta access token", what: "A secret access token to a Meta ad account, stored in the URL (token=), in the page-builder record (fb_capi_token) or in the page code. We show only a hash, never the token itself.", why: "A token is issued to one ad account, so the same token on two pages means the same operator. We never use the token in any call to Meta.", example: "sha256 hash 3f9a1c…", sentence: "Both pages contain the same Meta access token (compared by its sha256 hash)" },
  cloaker_account: { name: "Cloaker customer account", what: "The customer number (cl_sid) in a service that hides the page from moderation, stored by the page builder together with the cloaker domain (cl_domain).", why: "The same number on the same cloaker domain is one paid account, so the same operator. The number alone or the domain alone does not link.", example: "account 12345 at cloak.example.test", sentence: "Both pages are hidden from moderation by the same cloaker customer account" },
  launcher_account: { name: "Ad launcher account", what: "The ID (launcher) of the account the ads were launched from, stored by the page builder when it differs from the page owner.", why: "The same launcher account means the same ad buyer. When the launcher equals the page owner, it counts once, as the page-builder account.", example: "account 1a2b…", sentence: "The ads were launched from the same launcher account" },
  platform_campaign: { name: "Page-builder campaign", what: "A campaign in the page builder's panel, named by the traffic buyer.", why: "The same pages are run by the same campaign: a strong trace.", example: "campaign “summer-pl”", sentence: "Both pages are run by the same page-builder campaign" },
  page_template: { name: "Page template on the platform", what: "A ready-made template the page was built from on the platform.", why: "The same template used by different accounts means similar campaigns, not one.", example: "template “article-interview”", sentence: "The pages were built from the same template on the platform" },
  click_server: { name: "Click server", what: "The server that redirected the click on the ad (recorded in the click ID).", why: "The same server routes traffic to both pages: shared infrastructure, a medium trace.", example: "server 0a1b in the click ID", sentence: "The clicks went through the same redirect server" },
  meta_ad: { name: "Ad ID", what: "The number of the clicked ad, recorded in the link.", why: "The same number means the same ad.", example: "ad 120200000000000", sentence: "This is the same ad (the same ID in the link)" },
  ad_payer: { name: "Ad payer", what: "The payer declared to the ad platform (ad library).", why: "The same payer means one paying account; generic names link more weakly.", example: "“Example Company”", sentence: "The ads are paid for by the same payer" },
  company_id: { name: "Company ID on the page", what: "A company number given in the footer, the terms or the seller details: NIP, REGON, KRS (Polish company numbers), an EU VAT number, a UK company number.", why: "The same number on two pages means a shared template or the same hand, but company details can be copied from someone else's site, so the trace does not link a campaign on its own. A number with a wrong checksum is made up.", example: "NIP 123-456-32-18 in the footer", sentence: "Both pages give the same company ID" },
  bank_account: { name: "Bank account on the page", what: "An account number (IBAN or Polish NRB) given as the account to pay into.", why: "The same account means a shared recipient of the money: a stronger trace than a company number, but accounts of front people (“money mules”) are sometimes shared by different groups, so it does not link a campaign on its own.", example: "PL61 1090 1014 0000 0712 1981 2874", sentence: "Both pages ask for payment into the same bank account" },
  postal_address: { name: "Shop's registered address", what: "The full address given on the page: street, number, postcode and city (normalized: “ul.” and “ulica”, or a postcode with and without a hyphen, give the same address).", why: "The same address on two shops means a shared template or the same hand, but an address is easy to copy from another shop's footer, and virtual offices rent the same address to unrelated companies, so the trace does not link a campaign on its own.", example: "ul. Example 1, 00-001 Testville", sentence: "Both pages give the same registered address" },
  comment_block: { name: "Fake comment block", what: "A set of made-up comments hard-coded into the page.", why: "The same set of authors points to the same page template; it is not enough on its own.", example: "the same 8 comments under an article", sentence: "The pages have the same block of fake comments" },
  crm_key: { name: "CRM API key", what: "A secret key of a CRM or affiliate network account that the form sends the lead with. We show only a hash (start, end and sha256), never the whole key.", why: "One key belongs to one lead-buyer account: two pages with the same key send data to the same buyer. A strong trace, like a shared form backend.", example: "key Zx81…yB9n", sentence: "The forms on both pages send leads with the same CRM API key" },
  template_phrase: { name: "Template sentence", what: "A rare sentence from the page text or from the thank-you message after the form is sent, identical on pages on different domains. A sentence with a slip (repeated words, mixed alphabets) weighs more.", why: "It points to the same page template; many operators buy the same template, so a campaign needs a second kind of evidence.", example: "“our advisor will call you and present the platform”", sentence: "The pages have the same rare template sentence" },
  lead_flow: { name: "Page-builder lead funnel", what: "The same form, list of flows or event key stored in the code of pages from one platform.", why: "The pages feed one lead funnel: the same network or offer, not necessarily one buyer.", example: "form 7c3e91a4…", sentence: "Both pages feed the same lead funnel on the platform" },
  kit_string: { name: "Message from the kit script", what: "A developer message written in the page script (console log, error, warning), often with a typo, identical on pages on different domains. Page-builder scripts (SDK), framework bundles and known libraries are ignored.", why: "It points to the same network tool, like a file hash; many operators use the tool, so a campaign needs a second kind of evidence. It counts with at least two shared messages or one message of at least five words.", example: "“test module: start!”", sentence: "The page scripts have the same developer messages" },
  profit_claim: { name: "Promised profit", what: "The amount and period of the promised earnings from the text, a screenshot or a recording.", why: "The same promise comes from the same fraud script, which many operators copy: it only links similar campaigns into a group.", example: "PLN 3000 in a day", sentence: "The ads promise the same profit (amount and period)" },
  technique: { name: "Page technique", what: "How the page works, e.g. a fake app store, a “back” trap, a pressure countdown, blocking developer tools, a CPA network form kit (kit:formFb).", why: "The way of working links similar campaigns; it does not point to an operator.", example: "a “back” trap", sentence: "The pages use the same technique (way of working)" },
  similar_image: { name: "Similar creative", what: "The ad images differ only in small details.", why: "The same picture in variants usually means the same campaign.", example: "the same picture with a different caption", sentence: "The ads have an almost identical image" },
  similar_image_semantic: { name: "Similar image", what: "The images show the same thing, though one is not a copy of the other.", why: "It points to the same creative template; it counts together with other traces.", example: "the same scene in a different frame", sentence: "The ad images are built from the same template" },
  similar_text: { name: "Similar text", what: "The ad texts are very similar to each other.", why: "The same text in many ads often means the same campaign or the same narrative.", example: "the same text with a different amount", sentence: "The ads have very similar text" },
  similar_dom: { name: "Same page layout", what: "The pages have the same code structure.", why: "The same layout points to the same page kit, which is sometimes sold to many operators.", example: "the same article page on another domain", sentence: "The landing pages have the same structure" },
  similar_audio: { name: "Same audio track", what: "The recordings have the same soundtrack.", why: "The same soundtrack usually means the same creative.", example: "the same music and voice-over", sentence: "The recordings have the same soundtrack" },
  similar_voice: { name: "Same voice", what: "The same voice speaks in the recordings.", why: "The same voice can be faked many times, so it is not enough on its own.", example: "the same narrator in two recordings", sentence: "The same voice speaks in the recordings" },
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

/**
 * Evidence description without the technical tail ("— discounted: …", "(dHash …)", "(simhash …)"). The
 * patterns also match the Polish tails of bases built before the translation ("zdyskontowane", "cosinus",
 * "odległość").
 */
export function cleanEvidence(text: string): string {
  return text
    .replace(/\s+—\s+(?:zdyskontowane|discounted):.*$/i, "")
    .replace(/\s*\((?:dHash|simhash|mmh3|cosinus|cosine|odległość|distance|Hamming)[^)]*\)/gi, "")
    .trim();
}

/** Plain sentence of a piece of evidence: the type sentence, or the cleaned description for an unknown type. */
export function premiseSentence(ev: EvidenceText): string {
  if (ev.pivotType === "imagehash" && ev.pivot?.startsWith(`imagehash:${CREATIVE_FILE_PREFIX}`)) return "The ads have the same ad file (byte-for-byte identical)";
  const info = typeInfo(ev.pivotType ?? ev.edgeType ?? null);
  if (info) return info.sentence;
  const t = cleanEvidence(ev.evidence);
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Shared trace";
}

/** Family of a piece of evidence (null when the backend did not give the type). */
export function premiseFamily(ev: EvidenceText): FeatureFamily | null {
  return familyOf(ev.pivotType ?? ev.edgeType ?? null);
}

/** Help notes per type for the expert view (moved from DetailsPanel). */
export const TYPE_NOTES: Partial<Record<EntityType, string>> = {
  endpoint: "The backend the page sends form data to. A shared backend on different domains is one of the strongest pieces of evidence; public form services and generic paths are discounted.",
  hidden_fields: "The set of names of hidden form fields (without generic fields such as csrf/_token).",
  asset: "The site's own JS/CSS file. Popular libraries and generic file names are discounted.",
  comment: "A normalized HTML/JS comment. Standard comments of trackers and CMSs are discounted.",
  domain_pattern: "A domain name pattern with the placeholders <n> (digits) and <lorem> (a lorem ipsum word); it is created only when it covers at least two domains.",
  cname_target: "A shared CNAME record target. Large CDNs and hosting platforms are discounted.",
  campaign_param: "A campaign parameter from the URL (utm_*, sub1–5, aff_id, flow, pid…), from a hidden form field or from the configuration in the page script (origin: “from the form”, “from the script”). Generic values (e.g. facebook, cpc) and unfilled macros are discounted; the click ID (clickid) does not link samples.",
  fictional_expert: "Key `title:first last` (lower case, without Polish diacritics, inflection ending cut off) from the page text, the ad, a screenshot or a recording. Variants with a typo (edit distance ≤ 1, ≤ 2 for long names) are merged into the most frequent one. People on the list of public figures are skipped. Weight 0.75; rarity through IDF and the maxPivotDf limit.",
  persona: "A weak signal: the same person is used in many campaigns. Used for filtering and priorities, not for linking. No biometric data.",
  path_id: "A random ID (UUID) in the paths of resources loaded from the page's domain: an account of a page builder that serves many domains.",
  param_schema: "The names of the link parameters and the kind of their values. Points to a traffic-routing system that may have many customers: supporting evidence.",
  hosting_account: "Key `service:id` of a hosting account: a Bunny Stream library from the host `vz-<8 hex>-<3 hex>.b-cdn.net` or `gh:<account>` from jsDelivr `/gh/`. Weight 0.6, in `notAloneKinds`.",
  platform_account: "The owner account stored by the page builder in the page code (window.aio, owner_uuid). The same account = the same operator; different accounts on the same platform are not linked by weaker evidence.",
  meta_token: "Key = the first 12 characters of the sha256 of the Meta token (`EAA…`) from `token=` in the URL, `fb_capi_token` or the page code (B-144). The same value as the mask `EA…[sha256:…]` after redaction, so a raw and a redacted page give the same trace. We never display, export or use the token in calls. Weight 0.95.",
  cloaker_account: "Key `cl_domain/cl_sid` from the `visit.fields` of the window.aio record (a cloaking service that serves many sites). Weight as for Telegram. `cl_sid` alone or the domain alone is only an attribute; `cl_did` is a visit ID and does not link, and `cl_clid` (the analyst's click) is redacted.",
  launcher_account: "UUID from `visit.fields.launcher` (or `visit.launcher`). Usually equal to owner_uuid, and then it creates no separate trace (the same evidence as the page-builder account); a separate node only for a different value. Weight as for the page-builder account.",
  platform_campaign: "A campaign in the page builder's panel (uuid and the name given by the traffic buyer). Strong evidence: the same pages are run by the same campaign.",
  page_template: "A page template on the platform (lander_template_uuid). The same template used by different accounts is the same kit, so similar campaigns rather than one campaign.",
  click_server: "A click ID in the xid format contains the machine and process ID of the tracker. The same server routes traffic to both pages: shared infrastructure, medium evidence.",
  ad_payer: "Payer and beneficiary declared to Meta (DSA transparency), read from the ad library by the library ID. The same payer on different ads = one paying account; the name is typed in by the advertiser and nobody verifies it. Placeholders (e.g. “Test”, “xyz”) do not link at all, because unrelated advertisers type them in; a private person as the payer may be a victim of identity theft.",
  meta_ad: "The new fbclid format contains the ID of the clicked ad (the ad ID from the Marketing API, not the Ad Library ID). The same ID = the same ad.",
  comment_block: "The set of authors of made-up comments hard-coded into the page. A template trace like the page template: a campaign needs a second kind of evidence.",
  crm_key: "The API key or token the form uses to send the lead to a CRM or affiliate network (a field in the script, a request header, a hidden field). The graph only holds a hash: the first 4 and last 4 characters and the sha256. Keys of public services (maps, reCAPTCHA, analytics) are skipped.",
  template_phrase: "A normalized sentence (≥ 6 words) from the page text or from the message shown after the form is sent, found in the script. Only a rare sentence present on at least two domains counts; GDPR consents, cookie notices and footers are skipped. A template trace: a campaign needs a second kind of evidence.",
  lead_flow: "A shared lead funnel of a page builder: the same form (form_uuid), fields, list of flows (flow_uuids), event encryption key or form event server. A trace of a network or offer, not of one buyer: group level, a campaign needs a second kind of evidence.",
  kit_string: "A normalized developer message (≥ 3 words, lower case, numbers as #) from the page's own scripts, inline or external from the same domain. A pair of pages gets one piece of evidence: at least two shared messages or one long one (≥ 5 words). Mask: page-builder SDK and framework scripts, libraries, multilingual UI dictionaries, messages from pages of ≥ 5 platform accounts. A page-kit trace: a campaign needs a second kind of evidence.",
  shared_doc: "Key `service:id` of a document, spreadsheet or form (Google, Notion, Microsoft Forms, Typeform, Jotform) or of a shared conversation with a language model (service llm_chat). Weight as for Telegram, rarity through IDF and the maxPivotDf limit. Example links from vendor documentation and platform help pages are skipped. An operator who pastes campaign data into a chat and shares the link leaves a trace of that chat.",
  onion: "A version 3 .onion address (56 characters). Version 2 addresses (16 characters) expired in 2021 and are only an attribute of the sample. Weight as for Telegram.",
  c2_host: "The host name of the C2 server to which a trojan in the kit script (a check for an /admin or /panel path plus sending a cookie or login details to a foreign host) sends data. Weight 0.95; rarity through IDF and maxPivotDf.",
  messenger_invite: "Key `service:id` of an invite or account: discord, signal, signal_group, viber, line (a wa.me number goes to phones). Community servers of the platforms themselves are skipped. Weight as for Telegram.",
  affiliate_account: "Key `kind:network_host:value` (B-330): the team_id/user_id pair, stream_id or offer_uuid from the order link, the decoded referer parameter (base64) or hidden form fields; the host is the host of the link or of the form action. Without a host nothing links. The team/user pair is the affiliate_team kind of rule in notAloneKinds. api_key goes to the crm_key node only as sha256. sub1, sub2, x_id, sid and cid are only attributes.",
  overlay_template: "Fingerprint of the replaced-caption editing: kind (bar or blur), bar color, and position and size relative to the frame, rounded to 5%. A template trace: a campaign needs a second kind of evidence.",
  reused_footage: "Normalized text of the mark in the corner of the frame (OCR of the frame corners every 2 s, the same text in at least two frames). Marks of editors and platforms are masked. A template trace like a footage library: it does not link a campaign on its own.",
  profit_claim: "The amount and period pair from a profit promise (e.g. PLN 3000 in a day). Standard deposit amounts (e.g. 250 USD) do not link. Counts only for groups of similar campaigns.",
  company_id: "NIP, REGON, KRS, an EU VAT number or a UK company number read from the visible text, code, JSON-LD and screenshots (OCR). We check the checksum where the number has one (NIP, REGON): a wrong checksum points to a made-up number, but such a number still links the pages that share it. Numbers of intermediaries (payment operators, couriers) are skipped. It does not link a campaign on its own: company details can be copied.",
  bank_account: "An IBAN from any country or a Polish account number (NRB), verified by its checksum (mod 97). A shared account means a shared recipient of the money, but “money mule” accounts are sometimes shared by different groups: it does not link a campaign on its own.",
  postal_address: "An address with street, number, postcode and city, read from the page text or from JSON-LD (PostalAddress). We ignore the flat number: one building is one address. A campaign needs a second kind of evidence; virtual office addresses can be excluded with a list in the configuration.",
  technique: "A page technique (fake app store, “back” trap, fake post, fake comments). Counts only for groups of similar campaigns.",
};

/** Names of page techniques (MaterialItemResult.techniques). */
export const TECHNIQUE_LABEL: Record<string, string> = {
  fake_comments: "fake comments",
  fake_app_store: "fake app store",
  back_trap: "“back” trap",
  fake_social_post: "fake social media post",
  fake_security_alert: "fake security alert with a phone number",
  remote_access_tool: "remote desktop program to download",
  clickfix_paste: "fake verification with a command to paste",
  recent_purchase_popup: "“someone just bought” pop-ups",
  low_stock_claim: "“last items” and “N people viewing”",
  countdown_timer: "countdown timer next to the offer",
  closing_down_story: "shop closing-down story",
  crypto_discount: "extra discount for paying in crypto",
  waitlist_upsell: "discount as a waiting-list sign-up with a surcharge",
  trial_subscription: "trial period with automatic subscription renewal",
  blik_via_messenger: "BLIK code via a messenger",
  fake_courier_payment: "page posing as a courier with a card field and a parcel locker choice",
  spaced_text: "text spaced out letter by letter",
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
    name: "No terms, returns or privacy policy",
    what: "The menu and footer have no link to the terms, returns and withdrawal, privacy policy or contact page.",
    why: "An online shop must have them, and a fake one often lacks them or the links lead nowhere. A small honest shop may have them under another name, so this is a hint, not proof.",
    example: "the footer has only “About us” and “Cart”",
    sentence: "The page does not link to terms or returns: common in fake shops, though not conclusive.",
  },
  sitewideDeepDiscount: {
    name: "Discount on the whole shop",
    what: "At least 70% of products have a crossed-out price and a discount of 50% or more.",
    why: "Real sales cover selected categories. “-80% on everything” is a typical lure of fake sales, but real shops closing down look like this too.",
    example: "10 products with PLN 500 crossed out and PLN 100 next to it",
    sentence: "The discount reaches 80% across the shop: typical of fake sales, though not conclusive.",
  },
  omnibusMissing: {
    name: "No lowest price from the last 30 days",
    what: "The page shows discounts but nowhere gives the lowest price from the last 30 days.",
    why: "The Omnibus Directive (in Poland since 2023) requires this information with a discount. Its absence is a weak hint, because honest shops forget it too.",
    example: "“-50%” with no mention of the price before the sale",
    sentence: "Discounts without the lowest price from the last 30 days: a weak hint, not proof.",
  },
  transferOnly: {
    name: "Bank transfer only",
    what: "The only payment method found is a bank transfer.",
    why: "A normal shop offers several options or a payment gateway. A transfer to the seller's account is hard to reverse. A small local shop may accept only transfers.",
    example: "“Payment: traditional bank transfer”, without Przelewy24 or card",
    sentence: "The only payment method is a bank transfer: harder to get money back, though small shops work this way too.",
  },
  irreversibleOnly: {
    name: "Only payments that are hard to reverse",
    what: "All payment methods found are cryptocurrencies, BLIK or gift cards.",
    why: "These payments can hardly be reversed, which is why fraudsters choose them.",
    example: "BLIK and Bitcoin, without card or payment gateway",
    sentence: "Payment is possible only in ways that are hard to reverse (crypto, BLIK, gift cards).",
  },
  paymentRecipientPerson: {
    name: "Payment to a private person",
    what: "The payment instructions name a private individual as the recipient, or the transfer title is “gift” or “donation”.",
    why: "A shop should take money into a company account. The title “gift” is meant to hide the purchase from the bank. Small sole-trader businesses also keep accounts in the owner's name.",
    example: "“Recipient: Jan Kowalski, title: gift”",
    sentence: "The payment is to go to a private person or with the title “gift”: a way to hide the purchase from the bank.",
  },
  deliveryWide: {
    name: "Wide delivery time range",
    what: "The declared delivery time is long (from 21 days) or very wide (the upper limit at least 5 times the lower one).",
    why: "Fake shops give “3–45 days”, because the goods will never arrive anyway. Made-to-order shipping from abroad can also take long.",
    example: "“Delivery time: 3–45 business days”",
    sentence: "Delivery in 3–45 days: a wide range, which also happens with orders from abroad.",
  },
  reviewsAllPerfect: {
    name: "Only 5/5 reviews",
    what: "At least 10 reviews, 95% of them with 5 stars, and no 1–2 star ratings.",
    why: "A healthy distribution has the shape of a “reverse J”: many fives, some middle ratings and a few ones. Only fives suggest bought or self-written reviews, but a young honest shop may also have only fives.",
    example: "30 reviews, all 5/5",
    sentence: "30 reviews, all 5/5: a distribution unlike a real one, though not conclusive.",
  },
  reviewsNarrowWindow: {
    name: "Reviews from a few days",
    what: "At least 10 reviews were added within a window of no more than 21 days.",
    why: "Real reviews arrive gradually. A batch of reviews from a single week points to bulk posting, but a new shop also collects reviews quickly after opening.",
    example: "30 reviews from 10 days",
    sentence: "All reviews from a dozen or so days: looks like bulk posting, though a new shop starts like this too.",
  },
  reviewsNone: {
    name: "No reviews",
    what: "The shop has products with prices, but the page has no reviews and no mention of them.",
    why: "Reviews are often on product pages, so this is a weak hint. A new shop does not have any yet either.",
    example: "a product list without ratings and without a reviews section",
    sentence: "A shop without a single review: it may be new, it may be fake.",
  },
  footerBrandMismatch: {
    name: "Different name in the footer than on the page",
    what: "The name in the copyright line matches neither the site name nor the domain name.",
    why: "Fake shops copy someone else's shop together with the footer and do not fix the name. A real shop may also have changed its name and not updated the footer.",
    example: "“© 2019 Other Shop” on a page of the domain newmarket.test",
    sentence: "The footer gives the name of a different shop than the page: a trace of a copied shop, though it can also be a plain oversight.",
  },
  footerYearStale: {
    name: "Old year in the footer",
    what: "The year in the copyright line is at least 2 years earlier than the first record of the page.",
    why: "A page copied from an old shop keeps its year. A neglected real site does not update it either.",
    example: "“© 2019” on a page saved in 2026",
    sentence: "Footer year at least 2 years old: typical of copied shops, but also of neglected ones.",
  },
  claimedSinceContradicted: {
    name: "Claimed history contradicted by the archive",
    what: "The page says “since 1998” or “20 years on the market”, but the first snapshot in the web archive is at least 3 years later.",
    why: "A young shop claims a long history. The archive can be incomplete, so missing old snapshots are only a hint.",
    example: "“since 1998” and the first snapshot from 2026",
    sentence: "The page claims a history that the archive does not confirm.",
  },
  reviewsNoSellerReply: {
    name: "Reviews without seller replies",
    what: "The reviews widget has at least 20 reviews and not a single reply from the seller.",
    why: "Real shops increasingly reply to reviews, including critical ones. No replies is a weak hint, because many honest sellers do not reply.",
    example: "25 reviews without a single “Shop reply”",
    sentence: "The shop replies to none of the reviews: a weak hint.",
  },
  catalogIncoherent: {
    name: "Products unrelated to the shop's profile",
    what: "A small catalog contains products from three or more unrelated categories (electronics, toys, clothing…) or from a different category than the shop name suggests.",
    why: "Fake shops sell whatever is trendy: drones, iPads, building blocks, unrelated to their profile. Large general stores also have various departments.",
    example: "a yarn shop selling the latest smartphones",
    sentence: "The products do not match the shop name: a shop from one trade offers goods from another.",
  },
};

/** Words for the completeness of a postal address (`addressCompleteness`). */
export const ADDRESS_COMPLETENESS_LABEL: Record<string, string> = {
  full: "full (street, number, postcode, city)",
  city_only: "city only, without street and number",
  po_box: "PO box",
  none: "no address",
};

/** Words for the kind of an e-mail domain (`emailDomainKinds`). */
export const EMAIL_DOMAIN_KIND_LABEL: Record<string, string> = {
  free_mail: "free mailbox",
  site: "shop domain",
  other_domain: "a domain other than the shop's",
};

/** English names of the topics and hooks of the narrative (lib/text/narrative.ts). */
export const NARRATIVE_LABEL: Record<string, string> = {
  investment: "investment and earnings",
  subsidy: "subsidies and benefits",
  health: "health",
  gambling: "gambling",
  elections: "elections",
  ai_trading: "AI trading",
  gold_reserve: "gold reserves",
  commodities_war: "commodities and war",
  leaked_secret: "leaked secret",
  testimonial_small_win: "story of a quick profit",
  recovery: "fund recovery",
  sport_event: "sports event",
  inauguration: "inauguration",
  state_investment: "state investments",
  adult_phishing: "18+ content and age verification",
  urgent_notice: "urgent notice",
  petition: "petition",
  tech_support: "fake tech support (virus, locked computer)",
  refund_overpayment: "overpayment refund (“we sent you too much”)",
  recovery_offer: "offer to recover lost funds (repeat fraud against victims)",
  job_offer: "job offer (remote, product reviews for commission)",
  fake_authority: "fake authority (police, KNF, UODO, CERT, bank)",
  sensation: "sensation",
  endorsement: "endorsement by a well-known person",
  fake_interview: "fake interview",
  secrecy: "secrecy (don't tell the bank or your family)",
  withdrawal_fee: "fee or tax before withdrawal",
  urgency_lock: "threat of an account lock by a deadline",
  nationwide: "“all of Poland” (everyone is doing it)",
  millions_of_poles: "“millions of Poles”",
  pharma_villain: "drug companies as the villain",
  state_program_pays: "state program covers the costs",
  custody: "handcuffs or arrest",
  video_removed: "video removed or blocked",
};

/** English names of the weekdays, Monday first (the index of AdStart.weekday). */
export const WEEKDAY_LABEL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** English names of the line types of a phone number (lib/osint/phoneLine.ts). */
export const LINE_TYPE_LABEL: Record<string, string> = {
  mobile: "mobile",
  fixed: "landline",
  toll_free: "toll-free",
  premium: "premium rate",
  voip: "VoIP",
  shared_cost: "shared cost",
  unknown: "unknown type",
};

/**
 * What the new page techniques mean, in plain words (name, what, why, synthetic example, sentence of a
 * finding). Attributes of the scheme: they explain the kind of fraud and only count for groups of similar
 * campaigns.
 */
export const TECHNIQUE_INFO: Record<string, TypeInfo> = {
  spaced_text: {
    name: TECHNIQUE_LABEL.spaced_text,
    what: "A caption or text in the ad written with letters separated by spaces (“D o w n l o a d”).",
    why: "A trick against the platform's text filters: the keyword does not match the list of banned phrases. An attribute, not a linking trace.",
    example: "“S i g n  u p”",
    sentence: "The ad spaces out letters to get around the platform's text filters",
  },
  fake_security_alert: {
    name: TECHNIQUE_LABEL.fake_security_alert,
    what: "The page scares the user with a virus, a locked computer or a hacked account, gives a phone number as the only way out and is hard to leave (full screen, alert windows, a “back” trap, an alarm sound).",
    why: "This is the fake tech support scheme: the fraudster answers the phone and then asks the victim to install a remote desktop program. An attribute, not a linking trace.",
    example: "“Windows Defender: virus detected, call +48 800 000 000” in full screen",
    sentence: "The page scares the user with a virus and tells them to call a number: the fake tech support scheme, in which the fraudster then asks for a remote desktop program to be installed",
  },
  remote_access_tool: {
    name: TECHNIQUE_LABEL.remote_access_tool,
    what: "A link or instructions to download a remote desktop program (e.g. AnyDesk, TeamViewer QuickSupport) with a request for the access code.",
    why: "Once it is installed, the fraudster takes over the computer and often also access to online banking. An attribute, not a linking trace.",
    example: "“Download the program and give the technician the 9-digit code”",
    sentence: "The page tells the user to download a remote desktop program: the fraudster wants to take over the victim's computer",
  },
  clickfix_paste: {
    name: TECHNIQUE_LABEL.clickfix_paste,
    what: "A fake CAPTCHA or “verify you are not a robot” check tells the user to press a shortcut (e.g. Win+R) and paste a command that the page has copied to the clipboard.",
    why: "The pasted command installs malware. We store only the kind of command and its SHA-256 hash, never the command itself.",
    example: "“Press Win+R, paste (Ctrl+V) and press Enter to confirm you are not a robot”",
    sentence: "Under the guise of verification, the page tells the user to paste a copied command into the system (ClickFix): a way to install malware",
  },
  fake_comments: {
    name: TECHNIQUE_LABEL.fake_comments,
    what: "Under the article or ad there is a comment section where supposed readers praise the product or show their earnings, but it is written into the page code and does not come from the site's real comment plugin.",
    why: "This is trust fabricated by the fraudster. An attribute, not a linking trace (the same comment block links separately).",
    example: "“Marta K.: I deposited PLN 250, a week later I had 3 thousand.”",
    sentence: "The page shows fabricated reader comments meant to build trust in the offer",
  },
  fake_app_store: {
    name: TECHNIQUE_LABEL.fake_app_store,
    what: "The page poses as an app store (Google Play, App Store) with a rating, a download count and an “Install” button.",
    why: "It gives the appearance of a legitimate app, while the downloaded file may be malicious or lead to a payment. An attribute, not a linking trace.",
    example: "a fake app card with 4.8 stars and “1M downloads”",
    sentence: "The page poses as an app store to look like a legitimate app",
  },
  back_trap: {
    name: TECHNIQUE_LABEL.back_trap,
    what: "The page hijacks the browser's “back” button, so pressing it keeps the user on the page or sends them to another fraudster page.",
    why: "It makes leaving the page harder and keeps the victim in the scheme. An attribute, not a linking trace.",
    example: "the “back” button loads the same page or another offer",
    sentence: "The page blocks the “back” button so that it is hard to leave",
  },
  fake_social_post: {
    name: TECHNIQUE_LABEL.fake_social_post,
    what: "The page looks like a social media post (Facebook, X) with likes and comments, though it is an ordinary fraudster page.",
    why: "A familiar form lowers vigilance, and the “reactions” are fabricated. An attribute, not a linking trace.",
    example: "a post with an avatar, “2.3K likes” and comments",
    sentence: "The page poses as a social media post to look credible",
  },
  recent_purchase_popup: {
    name: TECHNIQUE_LABEL.recent_purchase_popup,
    what: "Pop-ups on the page say that someone has just bought the product (“Anna from Gdynia bought 2 min ago”).",
    why: "These are fake signs of popularity meant to rush the purchase. Honest shops do this too, so it is only a description.",
    example: "“Piotr from Lublin just bought 3 items”",
    sentence: "The page shows pop-ups about supposed purchases by other people to create a sense of urgency",
  },
  low_stock_claim: {
    name: TECHNIQUE_LABEL.low_stock_claim,
    what: "The page claims that only a few items are left or that many people are viewing the product right now.",
    why: "Scarcity pressure is meant to push a quick purchase without thinking. Many ordinary shops do the same, so it is only a description.",
    example: "“Only 3 items left, 27 people viewing”",
    sentence: "The page applies pressure with claims of last items and many viewers",
  },
  countdown_timer: {
    name: TECHNIQUE_LABEL.countdown_timer,
    what: "Next to the offer there is a timer counting down to the end of the promotion.",
    why: "The timer is meant to create urgency, and it often starts again after reaching zero. Only a description, because honest shops use it too.",
    example: "“Offer ends in 09:59”",
    sentence: "The page counts down to the end of the offer to rush the purchase",
  },
  closing_down_story: {
    name: TECHNIQUE_LABEL.closing_down_story,
    what: "The page claims that the shop is closing down or holding a closing-down sale, which is why prices are very low.",
    why: "It explains unrealistically low prices and the shop's lack of history. Typical of fake shops, but only a description.",
    example: "“We are closing the shop, everything up to -80%”",
    sentence: "The page explains the low prices by the shop closing down",
  },
  crypto_discount: {
    name: TECHNIQUE_LABEL.crypto_discount,
    what: "The page offers an extra discount for paying in cryptocurrency.",
    why: "A crypto payment is irreversible, so the fraudster does not risk a refund. Only a description.",
    example: "“Extra -15% when paying in USDT”",
    sentence: "The page uses a discount to push payment in cryptocurrency, which cannot be reversed",
  },
  waitlist_upsell: {
    name: TECHNIQUE_LABEL.waitlist_upsell,
    what: "The discount is presented as signing up for a waiting list, and after signing up a surcharge or an extra service appears.",
    why: "A way to extract money under the guise of a free deal. Only a description.",
    example: "“Join the list and get -70%, booking fee PLN 9.99”",
    sentence: "The page invites the user to join a waiting list and then demands a surcharge",
  },
  trial_subscription: {
    name: TECHNIQUE_LABEL.trial_subscription,
    what: "An offer “for PLN 1” or a free trial, after which the payment renews automatically as an expensive subscription.",
    why: "The victim does not notice agreeing to recurring card charges. Only a description.",
    example: "“Try it for PLN 1, then PLN 199 a month”",
    sentence: "The page offers a trial period after which the card is charged automatically",
  },
  blik_via_messenger: {
    name: TECHNIQUE_LABEL.blik_via_messenger,
    what: "The page asks for a BLIK code or for payment through a messenger chat (e.g. Messenger).",
    why: "A BLIK code given to the fraudster lets them withdraw money from the account at once. Only a description.",
    example: "“Message us on Messenger and give us the BLIK code”",
    sentence: "The page sends the user to a messenger where the BLIK code is to be given",
  },
  fake_courier_payment: {
    name: TECHNIQUE_LABEL.fake_courier_payment,
    what: "The page poses as a courier (e.g. InPost, DHL): it asks for an extra parcel fee, has a card field and a choice of parcel locker.",
    why: "Under the guise of a small fee it phishes card details. An attribute, not a linking trace.",
    example: "“Your parcel is waiting, pay PLN 1.99 and choose a parcel locker”",
    sentence: "The page poses as a courier and asks for card details on the pretext of an extra parcel fee",
  },
};

/**
 * What each rule that keeps similar ads out of one campaign means, in plain words (`term`, `text`, `why`,
 * `example` as in the glossary below). Shown in the "Deliberately not linked" tab and in the card of a new
 * sample; the rule ids are those of `NearMiss.rule`. The ids themselves stay out of the reader's way.
 */
export const NEAR_MISS_RULE_INFO: Record<NearMissRule, Term> = {
  "below-min-score": {
    term: "Score below threshold",
    text: "The ads have something in common, but all their shared traces together are too weak to treat them as one campaign.",
    why: "The threshold protects against linking by chance details. Pairs just below the threshold are worth a look by hand.",
    example: "two similar texts and no other shared trace",
  },
  "family-only-kind": {
    term: "Group trace only",
    text: "They are linked only by a feature that points to similar campaigns rather than one operator: the same person in the ad or the same page technique.",
    why: "The same person or technique is used by many unrelated fraudsters, so such a trace makes a group of similar campaigns, not a campaign.",
    example: "the same well-known presenter in ads of two unrelated operators",
  },
  "account-conflict": {
    term: "Different platform accounts",
    text: "The pages are on the same page-builder platform, but on different accounts. A shared template or file is not enough to treat them as one operator.",
    why: "The platform gives ready-made templates and page libraries to all accounts, so a shared element does not tell who is behind it.",
    example: "two pages from the same page builder, each on a different account",
  },
  "discounted-only": {
    term: "Discounted trace only",
    text: "The only shared trace is one that many unrelated sites use: a large CDN, a popular registrar or a platform. Once its weight is reduced, nothing is left.",
    why: "Without this, everything would link to everything through popular services.",
    example: "two pages behind the same large CDN, with no other shared trace",
  },
  "kit-only": {
    term: "Page kit only",
    text: "They are linked only by a template, theme or page code that can be bought or copied. A trace of the operator itself is missing: a shared account, domain, tracker, wallet or contact.",
    why: "Many operators buy page kits, so such a trace shows similar campaigns, not one.",
    example: "the same article template on two different domains",
  },
  "content-only-with-infra": {
    term: "Content only, separate infrastructure",
    text: "The ads have similar text or images, but at least one of them has its own infrastructure (domain, server, tracker) that the other does not share.",
    why: "Content is easy to copy, while infrastructure points to the operator. Content alone does not link a campaign.",
    example: "the same picture in two ads leading to different domains",
  },
  "too-few-content-kinds": {
    term: "Too few content types",
    text: "The ads without their own infrastructure are linked by only one type of content, e.g. similar text.",
    why: "To treat them as one campaign, at least two different types of content are needed, e.g. text and image.",
    example: "two similar texts but completely different images",
  },
  "too-few-evidence-kinds": {
    term: "Too few evidence types",
    text: "The shared traces are all of the same type, and the method requires corroboration by a second, independent type of evidence.",
    why: "One type of trace can be a coincidence. Two independent ones rarely are.",
    example: "a shared IP address and no other trace",
  },
  "split-by-clustering": {
    term: "Split apart",
    text: "The rules allowed these ads to be linked, but the algorithm that divides the link network into campaigns put them in different campaigns.",
    why: "The algorithm looks at the whole link network, not at one pair, so a weak link between two dense groups is not enough to merge them.",
    example: "two groups of ads joined by one weak link",
  },
};

export type FeatureRole = "links" | "helps" | "describes";

export const ROLE_LABEL: Record<FeatureRole, string> = {
  links: "links",
  helps: "helps",
  describes: "description only",
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

/** Features of a sample (`MaterialItemResult.features`). */
export const FEATURE_INFO: Record<string, FeatureInfo> = {
  landingUrl: { name: "Page URL", source: "from the sample", role: "links", term: "domena", url: true },
  finalUrl: { name: "Final URL (after redirects)", source: "from the HAR or saved page", role: "links", url: true },
  landingSource: { name: "Where the page URL comes from", source: "from the sample", role: "describes" },
  landingFragment: { name: "URL fragment (#…)", source: "from the URL", role: "describes" },
  observedUrls: { name: "URL from the address bar", source: "from screenshot OCR", role: "links", term: "ocr", url: true },
  inAppBrowser: { name: "In-app browser", source: "from screenshot OCR", role: "describes" },
  advertiser: { name: "Advertiser", source: "from the screenshot or description", role: "helps" },
  uiView: { name: "View in the screenshot", source: "from screenshot OCR", role: "describes" },
  adLibraryIds: { name: "Ad library ID", source: "from screenshot OCR", role: "links" },
  advertiserImpersonatesName: { name: "Advertiser impersonates a person", source: "from the advertiser name and the list of people (attribute, not campaign evidence)", role: "describes", term: "persona" },
  profitClaims: { name: "Promised profit (amount and period)", source: "from the ad text, page, OCR or transcript (attribute; links only similar campaigns into a group)", role: "describes" },
  fictionalExpert: { name: "Fictitious doctor (probably AI)", source: "from a title (dr, prof.) and a name not on the list of public figures in a health ad (attribute, not campaign evidence)", role: "describes" },
  expertNotInRegister: { name: "Doctor not in the register (probably made up)", source: "from a recorded response of the register of doctors (optional plugin, off by default; a label, not campaign evidence)", role: "describes" },
  liveStream: { name: "Fake live stream", source: "from the recording metadata (yt-dlp: was_live, is_live; attribute, not campaign evidence)", role: "describes" },
  aiImageMeta: { name: "AI-generated image (marker in the file)", source: "from the image file metadata: C2PA, IPTC, EXIF or the generator description (attribute; no conclusion without metadata)", role: "describes" },
  advertiserMismatch: { name: "Ad account probably hijacked (name does not match the content)", source: "from the advertiser name (local business or private person) and an investment narrative (attribute, not campaign evidence)", role: "describes" },
  displayedDomainMismatch: {
    name: "Domain shown in the ad differs from the landing page",
    source: "from screenshot OCR or the ad text and from the redirect chain (attribute, not campaign evidence)",
    role: "describes",
    url: true,
    format: (v) => {
      const m = v as { displayed?: string; landing?: string };
      return m.displayed && m.landing ? [m.displayed, m.landing] : [];
    },
  },
  displayedBrandDomain: { name: "Domain shown belongs to a well-known brand (bank, portal, shop)", source: "from the brand list (attribute)", role: "describes" },
  clickfix: {
    name: "Command copied to the clipboard (ClickFix)",
    source: "from the page script: only the kind and the SHA-256 hash; the command itself is a malware payload and is not stored (attribute)",
    role: "describes",
    format: (v) => {
      const c = v as { kind?: string; sha256?: string };
      return c.kind && c.sha256 ? [`kind: ${c.kind}`, `SHA-256: ${c.sha256.slice(0, 16)}…`] : [];
    },
  },
  stealerKit: {
    name: "Trojan in the page kit (steals cookies or passwords from a fake tracker panel)",
    source: "from the page scripts and downloaded libraries on free hosting: a check for an /admin or /panel path plus sending a cookie or login details to a foreign host (attribute; the C2 host itself is a trace)",
    role: "describes",
    format: (v) => {
      const c = v as { signals?: string[]; c2Hosts?: string[] };
      return [...(c.signals?.length ? [`signals: ${c.signals.join(", ")}`] : []), ...(c.c2Hosts ?? []).map((h) => `C2: ${h}`)];
    },
  },
  idnConfusable: {
    name: "The address imitates another address (a character resembling “/”, “.” or “-”, or mixed alphabets)",
    source: "from the page URL, redirects, the address bar in the screenshot and links (attribute: describes how the address looks to the eye)",
    role: "describes",
    format: (v) => {
      const c = v as { host?: string; char?: string; position?: number; looksLike?: string };
      return c.host ? [`character ${c.char} at position ${c.position}`, `looks like: ${c.looksLike}`] : [];
    },
  },
  adStartWeekday: {
    name: "Weekday the ad started",
    source: "from the date of first delivery in the ad library, UTC (attribute; the spread within a campaign describes the operator's rhythm)",
    role: "describes",
    format: (v) => {
      const s = v as { weekday?: number; hour?: number | null };
      return typeof s.weekday === "number" ? [`${WEEKDAY_LABEL[s.weekday]}${typeof s.hour === "number" ? `, ${s.hour}:00 UTC` : ""}`] : [];
    },
  },
  discordSnowflakes: {
    name: "Creation date of a Discord server or account (from the ID)",
    source: "from discord.com/channels and discord.com/users links: the top bits of the ID are the creation time (attribute: a “birth clock”)",
    role: "describes",
    format: (v) => (v as Array<{ kind: string; createdAt: string }>).map((d) => `${d.kind === "user" ? "account" : d.kind === "guild" ? "server" : "channel"}: ${d.createdAt.slice(0, 10)}`),
  },
  onionV2: { name: ".onion address, version 2 (expired)", source: "from the page text (attribute; does not link)", role: "describes" },
  phoneLines: {
    name: "Phone number type",
    source: "from local libphonenumber-js metadata, without sending the number to any service (attribute: VoIP numbers are sometimes disposable, so the weight of a number depends on its rarity)",
    role: "describes",
    format: (v) => (v as Array<{ phone: string; lineType: string; country: string | null }>).map((l) => `${l.phone}: ${LINE_TYPE_LABEL[l.lineType] ?? l.lineType}${l.country ? `, ${l.country}` : ""}`),
  },
  phoneCountryMismatch: { name: "Number's country differs from the ad's market", source: "from the number and the ad's market (attribute)", role: "describes" },
  tollFreeOnAlert: { name: "Toll-free number on a page with a fake alert", source: "from the number and the page technique (attribute)", role: "describes" },
  fictionalExperts: { name: "Fictitious experts (dr, prof. not on the list of public figures)", source: "from the page text, ad, screenshot and recording (attribute; the name is also a trace)", role: "describes" },
  narrative: {
    name: "Narrative and hooks",
    source: "from the ad text, page, OCR and transcript (attribute; a feature of a campaign group, not evidence)",
    role: "describes",
    format: (v) => {
      const n = v as { topics?: Array<{ id: string }>; hooks?: string[] };
      return [...(n.topics ?? []).map((t) => `topic: ${NARRATIVE_LABEL[t.id] ?? t.id}`), ...(n.hooks ?? []).map((h) => `hook: ${NARRATIVE_LABEL[h] ?? h}`)];
    },
  },
  localizedUi: { name: "Multilingual UI dictionary", source: "from the page script (language codes; localization of the page-builder platform, not a text trace; attribute)", role: "describes" },
  residue: {
    name: "Commented-out old version",
    source: "from comments in the page code (attribute; the same old paragraph on two pages is a trace of a shared template, not evidence)",
    role: "describes",
    format: (v) => [`commented-out texts: ${(v as { count?: number }).count ?? 0}`, `excerpt: “${(v as { sample?: string }).sample ?? ""}”`],
  },
  foreignSegments: {
    name: "Trace of another version (insert in another language)",
    source: "from the page text, scripts, comments or ad names (attribute; the campaign may also run in the country of that language; a hint, not a conclusion about the author)",
    role: "describes",
    format: (v) => (v as Array<{ lang: string; where: string; chars: number }>).map((s) => `language ${s.lang} (${{ page: "page", script: "script", comment: "comment", ad_param: "ad name" }[s.where] ?? s.where}, ${s.chars} letters)`),
  },
  foreignPersona: {
    name: "Persona from another country in the ad name",
    source: "from the ad parameters (ad_name, adset_name, campaign_name) with the PL code (attribute)",
    role: "describes",
    format: (v) => (v as Array<{ title: string; lang: string; param: string }>).map((p) => `${p.title} (${p.lang}) in ${p.param}`),
  },
  typography: {
    name: "Text typography",
    source: "from the ad and page text (attribute; the same text with different typography is a different edit of the template, not a different owner)",
    role: "describes",
    format: (v) => {
      const t = v as { quoteStyle?: string | null; per1000?: Record<string, number> };
      const marks = Object.entries(t.per1000 ?? {}).map(([k, n]) => `${k}: ${n}/1000`);
      return [...(t.quoteStyle ? [`quotes: ${t.quoteStyle}`] : []), ...marks];
    },
  },
  translationArtifacts: {
    name: "Translation traces",
    source: "from the page text and captions (attribute; mixed alphabets, calques, ty/wy switches between singular and plural “you”, numbers spelled out; no conclusions about nationality)",
    role: "describes",
    format: (v) => Object.entries(v as Record<string, number>).map(([k, n]) => `${{ mixed_alphabet: "words with mixed alphabets", calque: "calques", form_switch: "ty/wy switches", spelled_numbers: "numbers spelled out in captions" }[k] ?? k}: ${n}`),
  },
  languageErrors: {
    name: "Language errors on the page",
    source: "from the page text (attribute without weight, B-325: paragraphs in a different language than the rest of the page or words with mixed alphabets in a sentence)",
    role: "describes",
    format: (v) => {
      const e = v as { foreignParagraphLangs?: string[]; mixedWords?: number };
      return [...(e.foreignParagraphLangs?.length ? [`paragraphs in another language: ${e.foreignParagraphLangs.join(", ")}`] : []), ...(e.mixedWords ? [`words with mixed alphabets: ${e.mixedWords}`] : [])];
    },
  },
  brandStyle: { name: "Brand name style", source: "from the advertiser or brand name (pseudo-Polish compound with a financial stem, attribute)", role: "describes" },
  advertiserNameKind: {
    name: "Kind of advertiser name",
    source: "from the advertiser name (generated brand, person, local business; attribute)",
    role: "describes",
    format: (v) => [{ generated_brand: "generated brand", person: "person's name", business: "local business name" }[v as string] ?? String(v)],
  },
  adPlatform: { name: "Ad library", source: "from the library record", role: "describes" },
  adLibraryAdId: { name: "Ad ID in the library", source: "from the library record", role: "links" },
  adAdvertiserId: { name: "Advertiser ID in the library", source: "from the library record", role: "links" },
  adAdvertiserLegalName: { name: "Advertiser's legal name", source: "from the library record", role: "describes" },
  adAdvertiserLocation: { name: "Advertiser's country", source: "from the library record", role: "describes" },
  adAdvertiserVerified: { name: "Advertiser verified", source: "from the library record", role: "describes" },
  adRegions: { name: "Delivery regions", source: "from the library record", role: "describes" },
  adFirstShown: { name: "Ad delivery start", source: "from the ad library", role: "describes" },
  adLastShown: { name: "Ad delivery end", source: "from the ad library", role: "describes" },
  payerKinds: { name: "Payer type from the ad library", source: "from the payer and beneficiary names (DSA self-declaration; the platform does not verify it)", role: "describes" },
  payerSuspicious: { name: "Suspicious ad payer", source: "from the payer name (placeholder, keyboard mash or a name in a foreign alphabet)", role: "describes" },
  payerEqualsBeneficiary: { name: "Payer same as beneficiary", source: "from the ad library", role: "describes" },
  companyRegistry: {
    name: "Company registers (VAT white list, KRS)",
    source: "from public registers for the NIP and KRS numbers on the page (option --company-registry; name, registered address, status, registration date, no personal data); a name or address mismatch, removal from the register, a young company and the company's age relative to the domain are explanations, not campaign evidence",
    role: "describes",
    format: (v) => {
      const c = v as { records?: Array<{ source: string; id: string; found: boolean; name: string | null; status: string | null; registeredAt: string | null; error: string | null }>; details?: Record<string, string> };
      const lines = (c.records ?? []).map((r) => `${r.source === "vat" ? "NIP" : "KRS"} ${r.id}: ${r.error ? `query error (${r.error})` : r.found ? `${r.name ?? "no name"}, ${r.status ?? "no status"}${r.registeredAt ? `, registered ${r.registeredAt}` : ""}` : "not in the register"}`);
      const labels: Record<string, string> = { companyNameMismatch: "name differs from the page", companyAddressMismatch: "registered address differs from the page", companyRemoved: "company removed from the register", companyRecent: "young company", companyYoungerThanDomain: "company younger than the domain", domainYoungerThanCompany: "old company, new domain" };
      return [...lines, ...Object.entries(c.details ?? {}).map(([k, d]) => `${labels[k] ?? k}: ${d}`)];
    },
  },
  companyIds: { name: "Company IDs and bank accounts on the page", source: "from the page text, code, JSON-LD or screenshot (OCR)", role: "links" },
  legalEntities: { name: "Entity names with a legal form", source: "from the page text, code, JSON-LD or screenshot (OCR)", role: "describes" },
  emailDomainKinds: { name: "Kind of email address domain", source: "from the email addresses on the page (free mailbox, shop domain or another domain)", role: "describes" },
  addressCompleteness: { name: "Completeness of the address on the page", source: "from the page text and JSON-LD (full, city only, PO box or none)", role: "describes" },
  certIssuer: { name: "TLS certificate issuer", source: "from the HAR (securityDetails); a free certificate is only context, the padlock says nothing about the seller", role: "describes" },
  certMismatch: { name: "Certificate issued for another domain", source: "from the HAR (securityDetails): no name in the certificate covers the host", role: "describes" },
  certExpired: { name: "Expired certificate", source: "from the HAR (securityDetails): validity ended before the page was saved", role: "describes" },
  brandInPath: { name: "Well-known brand in the URL path", source: "from the page URL: the brand is in the path, not in the domain name (typical of courier and classifieds clones)", role: "describes" },
  hostingOutsideEu: { name: "Hosting outside the EU and EEA", source: "from the country of the IP address (ASN enrichment); sites outside the EU are harder to take down", role: "describes" },
  tldRare: { name: "Rare domain ending", source: "from the domain name (an ending not on the list typical of shops, e.g. .sbs, .top); a weak hint", role: "describes" },
  domainLangMismatch: { name: "Domain name in a different language than the page", source: "from the domain name and the page language; a weak hint", role: "describes" },
  privacyControllerMismatch: { name: "Data controller other than the shop", source: "from the privacy policy: the controller's address is on a different domain than the page's contact addresses", role: "describes" },
  registrantHidden: { name: "Domain registrant details hidden", source: "from RDAP (REDACTED or a privacy service); most registrars do this, so a weak hint", role: "describes" },
  contactDomainDead: { name: "Contact email domain does not respond", source: "from enrichment (network mode): the domain has an MX record but does not respond over HTTP(S)", role: "describes" },
  phoneAreaMismatch: { name: "Landline number does not match the address city", source: "from the phone number and the address on the page", role: "describes" },
  companyIdInvalid: { name: "Company ID with a wrong checksum", source: "from the page text, code, JSON-LD or screenshot (OCR)", role: "describes" },
  personas: { name: "Persona", source: "from the text, transcript or OCR", role: "describes", term: "persona" },
  impersonatedBrand: { name: "Impersonated brand", source: "from the page title", role: "describes" },
  platformCampaignName: { name: "Page-builder campaign", source: "from the page code", role: "links" },
  landingName: { name: "Page name in the platform panel", source: "from the page code", role: "describes" },
  trafficSource: { name: "Traffic source", source: "from the page code", role: "describes" },
  platformAccount: { name: "Page-builder account", source: "from the page code", role: "links", term: "konto_platformy" },
  metaAdId: { name: "Ad ID", source: "from the link (fbclid)", role: "links" },
  metaAppId: { name: "App ID", source: "from the link (fbclid)", role: "describes" },
  clickTime: { name: "Click time", source: "from the click ID", role: "describes", term: "clickid" },
  clickCounter: { name: "Click server counter", source: "from the click ID", role: "describes", term: "clickid" },
  firstSeen: { name: "First seen", source: "from the sample", role: "describes" },
  cyrillic: { name: "Cyrillic in the page code", source: "from the page code", role: "describes" },
  cloakingSuspected: { name: "Suspected cloaking", source: "from two fetches of the page", role: "describes", term: "cloaking" },
  ocrText: { name: "Text from screenshot", source: "from screenshot OCR", role: "helps", term: "ocr" },
  videoOcrText: { name: "Video captions", source: "from captions in the video (OCR of frames every 2 s)", role: "helps", term: "ocr" },
  asrText: { name: "Recording transcript", source: "from the recording (ASR)", role: "helps", term: "transkrypcja" },
  text: { name: "Ad text", source: "from the sample", role: "helps" },
  dhash: { name: "Image fingerprint", source: "from the screenshot", role: "links", term: "odcisk_obrazu" },
  domSimhash: { name: "Page-structure fingerprint", source: "from the HAR or saved page", role: "helps", term: "odcisk_budowy" },
  personaCategories: { name: "Kinds of people in the ad", source: "from the list of public figures (e.g. politician, presenter, doctor) for people recognized in the sample", role: "describes", format: (v) => (Array.isArray(v) ? v.map((p) => { const o = p as { name?: string; category?: string }; return o.name && o.category ? `${o.name}: ${o.category}` : ""; }).filter(Boolean) : []) },
  platformSourceIds: { name: "Traffic source IDs on the platform", source: "from page-builder links (suuid parameter)", role: "links" },
  cloakerInSource: { name: "Cloaker in the page code", source: "from the page code or the traffic source name: a marker that the page runs through a cloaker (attribute, not campaign evidence)", role: "describes", term: "cloaking" },
  platformAccountSource: { name: "How we know which platform account it is", source: "from the page code: the account from the tenant address or from owner_uuid (attribute)", role: "describes" },
  platformAccountWarning: { name: "Warning about an inconsistent platform account", source: "from the page code: the tenant in the address differs from owner_uuid, so the account was assigned by owner_uuid (attribute)", role: "describes" },
  platformTenants: { name: "Platform tenants in the page file addresses", source: "from the page file addresses (landing-cdn): IDs of the accounts the page sits on", role: "describes" },
  infrastructure: { name: "Shared ad infrastructure (description)", source: "from the campaign summary: domains, trackers, IPs, contacts and wallets linking the ads (description only)", role: "describes" },
  techniques: { name: "Page techniques", source: "from the page code and content: a list of recognized fraud techniques, e.g. fake comments (attribute, not campaign evidence)", role: "describes", format: (v) => (Array.isArray(v) ? v.map((t) => TECHNIQUE_LABEL[String(t)] ?? String(t)) : []) },
  creativeBrand: { name: "Brand recognized in the ad image", source: "from comparing the ad image with brand patterns (attribute, probability, not campaign evidence)", role: "describes", format: (v) => { const b = v as { name?: string; probability?: number }; return b.name ? [typeof b.probability === "number" ? `${b.name} (${Math.round(b.probability * 100)}%)` : b.name] : []; } },
  domainAgeDays: { name: "Domain age in days", source: "from the domain registration date (RDAP) and the date the sample was first seen; a very young domain is a weak hint", role: "describes" },
  certAgeDays: { name: "Age of the first certificate in days", source: "from the certificate log (CT) and the date the sample was first seen; a fresh certificate is a weak hint", role: "describes" },
  pagePlatforms: { name: "Page-building platforms", source: "from the page code: recognized platforms and tools (e.g. aio, binom) the page was built with (attribute, not campaign evidence)", role: "describes" },
  inputExtra: { name: "Extra columns from the input data", source: "from columns of the input file outside the standard mapping (only the columns named in the configuration link)", role: "describes", format: (v) => (v && typeof v === "object" ? Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${String(x)}`) : []) },
  namingMixedScript: { name: "Name with mixed alphabets", source: "from names in the platform panel: Latin letters mixed with Cyrillic (a weak hint)", role: "describes" },
  codeCommentLang: { name: "Language of comments in the page code", source: "from comments in the page code: Ukrainian or Russian (attribute, not campaign evidence)", role: "describes" },
  landerSlugStyle: { name: "Style of the page URL path", source: "from the URL path: a string of consonants or a list of random words (attribute, not campaign evidence)", role: "describes" },
  advertiserNameStyle: { name: "Style of the advertiser name", source: "from the advertiser name: a random “brand” or a foreign first and last name (attribute, not campaign evidence)", role: "describes" },
  adCreatedApprox: { name: "Approximate ad creation date", source: "from the Meta ad ID and other ads with known dates (estimate, attribute)", role: "describes" },
};

export function featureInfo(key: string): FeatureInfo {
  return FEATURE_INFO[key] ?? { name: key, source: "from the sample", role: "describes" };
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
  material: { term: "Sample", text: "One ad together with what was collected about it: a screenshot, the saved page, a HAR, a video, a description.", why: "The tool compares samples, not single files.", example: "a screenshot of the ad + the saved page it leads to" },
  cecha: { term: "Feature", text: "A single piece of information from a sample, e.g. a domain, a name in the text, a tracker ID.", why: "Features become shared traces, the basis of every link.", example: "the domain example.test" },
  wspolny_slad: { term: "Shared trace", text: "A feature that more than one sample has. Only shared traces can link anything.", why: "A feature seen in only one sample links nothing.", example: "the same tracker ID on two pages" },
  przeslanka: { term: "Evidence", text: "A shared trace used to justify a link, with its strength assessed.", why: "Every link has its evidence, so it can be checked.", example: "“both pages belong to the same page-builder account”" },
  sila_powiazania: { term: "Link strength", text: "A number from 0 to 1 that adds up all the evidence for a pair of samples. The more independent evidence, the closer to 1.", why: "It decides whether the pair crosses the linking threshold.", example: "two pieces of evidence of 0.5 and 0.5 give 0.75 together" },
  prog_laczenia: { term: "Linking threshold", text: "The minimum strength from which two samples can go into one campaign.", why: "It protects against linking samples by chance details.", example: "threshold 0.15: a pair with strength 0.12 does not go into one campaign" },
  kampania: { term: "Campaign", text: "Samples of one operator. They are linked by the same account, the same infrastructure or several independent pieces of evidence.", why: "This is the main result of the tool: who is behind an ad.", example: "K03: 6 ads with the same page-builder account" },
  grupa_podobnych: { term: "Group of similar campaigns", text: "Campaigns of different operators that share the same page template, narrative or persona.", why: "It shows that several campaigns use the same ready-made kit, although different people run them.", example: "K01 and K05: the same article template, different accounts" },
  duplikat: { term: "Duplicate", text: "The same ad collected more than once.", why: "We count duplicates once so as not to inflate the size of a campaign.", example: "the same screenshot sent in by two people" },
  wariant: { term: "Variant", text: "Another sample of the same campaign, e.g. the same page on a new domain.", example: "the same page moved to a new domain" },
  pominiety_slad: { term: "Discounted trace", text: "A trace shared by many unrelated sites (Cloudflare, a popular registrar, a free certificate). It does not point to an operator, so it does not count.", why: "Without this, everything would link to everything through popular services.", example: "two pages behind Cloudflare" },
  persona: { term: "Persona", text: "The person the ad impersonates. The same person appears in many unrelated campaigns, so on its own it does not link samples.", why: "It helps to filter and search, but does not point to an operator.", example: "a well-known presenter in a fake interview" },
  domena: { term: "Domain", text: "The address of a site, e.g. example.test. Fraudsters often register new domains for just a few days.", why: "A shared domain links samples; a young domain can be a hint.", example: "example.test" },
  rejestrator: { term: "Registrar", text: "The company the domain was bought from. A popular registrar says little; registrations in batches say more." },
  ns: { term: "Name servers (NS)", text: "Servers that tell where a domain runs. The same unusual pair of servers may link domains of one owner." },
  certyfikat: { term: "HTTPS certificate", text: "A file a site needs to work over https. Every certificate goes into a public log, so new domains are visible before the ad starts running." },
  har: { term: "HAR", text: "A record of the browser's network traffic: which addresses the page called and what the servers answered.", why: "From the HAR we read the page, redirects, forms and trackers, even when the page no longer works.", example: "a visit.har file saved in the browser's developer tools" },
  ocr: { term: "OCR", text: "Reading text from an image, e.g. from a screenshot of an ad.", why: "From OCR we take the ad text and the URL from the address bar.", example: "a page URL read from the address bar in a phone screenshot" },
  tracker: { term: "Tracker / pixel", text: "Code of an advertising or analytics company with an account ID. The same ID on two pages usually means the same owner." },
  clickid: { term: "Click ID (clickid)", text: "A tag added to the link after a click on an ad. Some formats reveal the server that redirected the traffic." },
  szablon_strony: { term: "Page template", text: "A shared layout and code of a page. The same template used by different accounts means similar campaigns, not one." },
  konto_platformy: { term: "Page-builder account", text: "The owner ID in a page-building tool. The same account means the same operator." },
  trasa_klikniecia: { term: "Click route", text: "The path from the ad to the fraudster's page: tracking link, redirects, lure page, form or shop. It shows which addresses the victim passes through. A domain registered just before the ad started running was usually created for the campaign, e.g. “registered 2 days before the ad ran”." },
  sprawa: { term: "Case", text: "A folder with the files of one report: a screenshot of the ad, the saved page, a HAR, a video. One case gives one sample, or more if it contains several ads.", why: "The split into cases decides which files count together.", example: "folder “report-12” with a screenshot and a saved page" },
  strona_przyneta: { term: "Lure page", text: "The page a person lands on after clicking the ad: a fake article, interview or offer. Its job is to persuade them to leave their details or pay.", why: "This is usually where the operator's traces stay: tracker, form, template.", example: "an article “celebrity reveals a way to make money”" },
  lejek: { term: "Funnel", text: "A row of numbers showing how many of the uploaded files became samples, how many of them are duplicates, and how many went to known campaigns or new ones or were marked “insufficient data”. The numbers add up.", example: "9 files → 6 samples → 1 duplicate" },
  transkrypcja: { term: "Transcript", text: "The text of speech in a recording, transcribed automatically. It may contain errors, so it is used to compare content, not as a quote.", why: "It lets us compare the content of recordings, even when the images differ." },
  biblioteka_reklam: { term: "Ad library", text: "A public register of ads that the platforms (Meta, Google, TikTok) keep under the Digital Services Act. It gives the advertiser, the delivery dates and often the payer.", why: "It gives fixed ad account IDs that cannot be swapped in a screenshot.", example: "ad number and payer name" },
  baza_osob: { term: "Reference set of people", text: "A closed list of public figures whose faces and voices we compare with those in the samples. For each person we have several photos or recording excerpts and the source that named them as impersonated.", why: "The result is “face similar to X”, a hint to check, never an identification." },
  rozbrojony_adres: { term: "Defanged URL", text: "A page URL written so that it cannot be clicked by mistake: hxxps instead of https and [.] in place of the dot. Copying copies exactly this version.", example: "hxxps://example[.]test/start" },
  znizka: { term: "Discount", text: "Lowering the weight of a trace that looks shared but belongs to many unrelated sites (a large network, a free certificate, a service with many customers). A discounted trace links more weakly or not at all.", why: "It protects against linking campaigns by infrastructure that everyone uses.", example: "a shared server of a popular hosting company" },
  odcisk_obrazu: { term: "Image fingerprint", text: "A short hash computed from the ad image. Two similar images have similar fingerprints, so we detect the same picture with a small change (caption, crop).", why: "It lets us link variants of the same creative without comparing images pixel by pixel." },
  odcisk_budowy: { term: "Page-structure fingerprint", text: "A hash computed from the page's tag layout (without content). Pages built from the same kit have similar fingerprints.", why: "It points to the same page kit, which is sometimes sold to many operators, so on its own it does not link a campaign." },
  cloaking: { term: "Cloaking", text: "The page shows one thing to the ad platform's robot and another to the user, to get past moderation." },
  sila_przeslanki: { term: "Evidence strength", text: "How strongly one piece of evidence links two samples. High links on its own, medium counts together with others, “needs corroboration” needs a second kind of trace, discounted does not count.", why: "The strength decides whether the evidence is enough for a link.", example: "the same page-builder account: high" },
  pewnosc: { term: "Confidence", text: "How much we trust the verdict: certain, likely or uncertain. An uncertain verdict is worth checking by hand. When a sample shares no trace with the base, you see “no shared traces” instead of a confidence level: there is no link to assess.", why: "It tells which result is worth verifying yourself.", example: "certain: the best link has a piece of evidence of high strength" },
  za_malo_danych: { term: "Insufficient data", text: "The sample has no features it can be compared by, e.g. a single unreadable screenshot without an address. The tool says so plainly and suggests what to add, instead of guessing “new campaign”.", example: "a screenshot without the address bar and without readable text" },
  baza: { term: "Reference base", text: "The reference base is the samples analyzed earlier. New ones are compared with them." },
  kompletnosc: { term: "Data completeness", text: "A list of what we have and what is missing in a sample, with the effects of the gaps on the comparison.", example: "no saved page: we cannot compare the template" },
  sila_w_kampanii: { term: "Campaign link strength", text: "The average link strength between the samples of a campaign. The higher it is, the more tightly the samples hold together." },
};

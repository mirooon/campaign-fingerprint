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
  persona: { name: "Persona", what: "The person the ad impersonates.", why: "The same person appears in many unrelated campaigns, so on its own it does not link samples.", example: "Adam Testowy", sentence: "The ads use the image of the same person" },
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
  fictionalExpert: { name: "Zmyślony lekarz (prawdopodobnie AI)", source: "z tytułu (dr, prof.) i nazwiska spoza listy osób publicznych w reklamie zdrowotnej (atrybut, nie dowód kampanii)", role: "describes" },
  expertNotInRegister: { name: "Lekarz bez wpisu w rejestrze (prawdopodobnie zmyślony)", source: "z nagranej odpowiedzi rejestru lekarzy (wtyczka opcjonalna, wyłączona domyślnie; etykieta, nie dowód kampanii)", role: "describes" },
  liveStream: { name: "Fałszywa transmisja na żywo", source: "z metadanych nagrania (yt-dlp: was_live, is_live; atrybut, nie dowód kampanii)", role: "describes" },
  aiImageMeta: { name: "Obraz wygenerowany przez AI (znacznik w pliku)", source: "z metadanych pliku obrazu: C2PA, IPTC, EXIF albo opis generatora (atrybut; bez metadanych brak wniosku)", role: "describes" },
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
  languageErrors: {
    name: "Błędy językowe strony",
    source: "z tekstu strony (atrybut bez wagi, B-325: akapity w innym języku niż reszta strony albo słowa z mieszanym alfabetem w zdaniu)",
    role: "describes",
    format: (v) => {
      const e = v as { foreignParagraphLangs?: string[]; mixedWords?: number };
      return [...(e.foreignParagraphLangs?.length ? [`akapity w innym języku: ${e.foreignParagraphLangs.join(", ")}`] : []), ...(e.mixedWords ? [`słowa z mieszanym alfabetem: ${e.mixedWords}`] : [])];
    },
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
  personaCategories: { name: "Rodzaje osób w reklamie", source: "z listy osób publicznych (np. polityk, prezenter, lekarz) dla osób rozpoznanych w materiale", role: "describes", format: (v) => (Array.isArray(v) ? v.map((p) => { const o = p as { name?: string; category?: string }; return o.name && o.category ? `${o.name}: ${o.category}` : ""; }).filter(Boolean) : []) },
  platformSourceIds: { name: "Identyfikatory źródeł ruchu na platformie", source: "z linków platformy stron (parametr suuid)", role: "links" },
  cloakerInSource: { name: "Cloaker w kodzie strony", source: "z kodu strony albo nazwy źródła ruchu: oznaczenie, że strona działa przez cloaker (atrybut, nie dowód kampanii)", role: "describes", term: "cloaking" },
  platformAccountSource: { name: "Skąd wiadomo, które to konto platformy", source: "z kodu strony: konto z adresu najemcy (tenant) albo z owner_uuid (atrybut)", role: "describes" },
  platformAccountWarning: { name: "Ostrzeżenie o niespójnym koncie platformy", source: "z kodu strony: najemca w adresie różni się od owner_uuid, więc przypisano konto według owner_uuid (atrybut)", role: "describes" },
  platformTenants: { name: "Najemcy platformy w adresach plików strony", source: "z adresów plików strony (landing-cdn): identyfikatory kont, na których stoi strona", role: "describes" },
  infrastructure: { name: "Wspólna infrastruktura reklam (opis)", source: "z podsumowania kampanii: domeny, trackery, IP, kontakty i portfele łączące reklamy (tylko opis)", role: "describes" },
  techniques: { name: "Techniki strony", source: "z kodu i treści strony: lista rozpoznanych technik oszustwa, np. fałszywe komentarze (atrybut, nie dowód kampanii)", role: "describes", format: (v) => (Array.isArray(v) ? v.map((t) => TECHNIQUE_LABEL[String(t)] ?? String(t)) : []) },
  creativeBrand: { name: "Marka rozpoznana na obrazie reklamy", source: "z porównania obrazu reklamy ze wzorcami marek (atrybut, prawdopodobieństwo, nie dowód kampanii)", role: "describes", format: (v) => { const b = v as { name?: string; probability?: number }; return b.name ? [typeof b.probability === "number" ? `${b.name} (${Math.round(b.probability * 100)}%)` : b.name] : []; } },
  domainAgeDays: { name: "Wiek domeny w dniach", source: "z daty rejestracji domeny (RDAP) i daty pierwszej obserwacji materiału; bardzo młoda domena to słaba wskazówka", role: "describes" },
  certAgeDays: { name: "Wiek pierwszego certyfikatu w dniach", source: "z dziennika certyfikatów (CT) i daty pierwszej obserwacji materiału; świeży certyfikat to słaba wskazówka", role: "describes" },
  pagePlatforms: { name: "Platformy budowy strony", source: "z kodu strony: rozpoznane platformy i narzędzia (np. aio, binom), na których zbudowano stronę (atrybut, nie dowód kampanii)", role: "describes" },
  inputExtra: { name: "Dodatkowe kolumny z danych wejściowych", source: "z kolumn pliku wejściowego spoza standardowego mapowania (łączą tylko kolumny wskazane w konfiguracji)", role: "describes", format: (v) => (v && typeof v === "object" ? Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${String(x)}`) : []) },
  namingMixedScript: { name: "Nazwa z mieszanych alfabetów", source: "z nazw w panelu platformy: litery łacińskie wymieszane z cyrylicą (słaba wskazówka)", role: "describes" },
  codeCommentLang: { name: "Język komentarzy w kodzie strony", source: "z komentarzy w kodzie strony: ukraiński albo rosyjski (atrybut, nie dowód kampanii)", role: "describes" },
  landerSlugStyle: { name: "Styl ścieżki adresu strony", source: "z ścieżki adresu: ciąg spółgłosek albo lista losowych słów (atrybut, nie dowód kampanii)", role: "describes" },
  advertiserNameStyle: { name: "Styl nazwy reklamodawcy", source: "z nazwy reklamodawcy: losowa „marka” albo zagraniczne imię i nazwisko (atrybut, nie dowód kampanii)", role: "describes" },
  adCreatedApprox: { name: "Przybliżona data utworzenia reklamy", source: "z identyfikatora reklamy Meta i innych reklam o znanych datach (szacunek, atrybut)", role: "describes" },
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
  pewnosc: { term: "Pewność", text: "Jak bardzo ufamy werdyktowi: pewne, prawdopodobne albo niepewne. Niepewny werdykt warto sprawdzić ręcznie. Gdy materiał nie ma żadnego wspólnego śladu z bazą, zamiast pewności widać „brak wspólnych śladów”: nie ma powiązania do oceny.", why: "Mówi, który wynik warto zweryfikować samodzielnie.", example: "pewne: najlepsze powiązanie ma przesłankę o wysokiej sile" },
  za_malo_danych: { term: "Za mało danych", text: "Materiał nie ma cech, po których da się go porównać, np. sam nieczytelny zrzut bez adresu. Narzędzie mówi to wprost i podpowiada, co dorzucić, zamiast zgadywać „nową kampanię”.", example: "zrzut bez paska adresu i bez czytelnego tekstu" },
  baza: { term: "Baza porównawcza", text: "Baza porównawcza to materiały przeanalizowane wcześniej. Nowe porównujemy z nimi." },
  kompletnosc: { term: "Kompletność danych", text: "Lista tego, co mamy i czego brakuje w materiale, ze skutkami braków dla porównania.", example: "brak zapisanej strony: nie porównamy szablonu" },
  sila_w_kampanii: { term: "Siła powiązań w kampanii", text: "Średnia siła powiązań między materiałami kampanii. Im wyższa, tym mocniej materiały trzymają się razem." },
};

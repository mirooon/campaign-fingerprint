# Feature catalog

Generated file: `bun run features:catalog`. Do not edit by hand.

Linking works like this: every trace has a weight (type × list × frequency), and samples go into one campaign when a strong trace links them or at least one kind of trace of the “campaign” level does (pair score after discounts from 0.15); “only with another trace” traces do not link on their own unless they stay strong after discounts and rarity (from 0.7, e.g. a form backend with a client ID), and “group” traces link only similar campaigns (details and thresholds in [METODYKA.md](METODYKA.md)).

## Traces that typical tools do not give

Typical OSINT tools link pages by domain, IP address, WHOIS and DNS records, certificate and image hash. We collect those traces too (section 1); below are the ones we read ourselves from the code of the page, links, identifiers and recordings. “On the sample” gives only counts from the run on 28 samples of the organiser's set (commit `b3ee946`), without values; a pair is two samples linked by that evidence. In the table of section 1 these types have ★.

### Record of the page-builder panel

`path_id` · `platform_account` · `platform_campaign` · `cloaker_account` · `launcher_account` · `platformSourceIds` · `landingName` · `trafficSource`

- **How we read it:** The page builder writes its configuration record into the code of the page. From it we read the account owner's ID, the campaign name given by the traffic buyer, the page name in the panel, the traffic source, the cloaker customer number (cl_sid) and the account the ads were launched from (launcher). The builder also assigns a random ID that comes back in the file paths of the page.
- **What typical tools miss:** Domains and IP addresses change every few days, but the panel account stays. Neither WHOIS, DNS nor a page scan shows who bought the traffic in the panel and which cloaker it went through.
- **On the sample:** Platform account read in 14 of 28 samples. Strong evidence in pairs: the ID in file paths in 28 pairs, the account in 30, the panel campaign in 17. The cloaker customer and the launcher account occurred once each, without a pair in the sample, so a test checks their linking.

### Meta access token left in the code of the page

`meta_token`

- **How we read it:** Operators paste into the page the token of the Meta ad account they send conversion events with: in the URL (token=), in the page-builder record (fb_capi_token) or in a script. We keep only the start of its sha256 hash (12 characters), never the token itself.
- **What typical tools miss:** Page scanners see the Meta pixel, and the pixel number gets changed and shared. The token belongs to one ad account and ends up on the page through the operator's carelessness.
- **On the sample:** 6 different tokens, strong evidence in 13 pairs.

### Click server read from the click ID

`click_server` · `clickTime` · `clickCounter`

- **How we read it:** A click ID in the xid format (12 bytes) holds the time, the machine ID, the process number and the counter of the tracker. We decode it: the same machine and the same process mean the same redirect server, the time is the moment of the click, and the counter grows with every ID that process issues.
- **What typical tools miss:** The tracker sits behind the redirect and leaves no domain of its own on the landing page. The click ID looks like a random string, so tools skip it.
- **On the sample:** Time and counter read in 3 samples. One pair: a sample from the organiser's first batch linked to a sample from the second batch through the same tracker server.

### Ad number from the link and the approximate date the ad was created

`meta_ad` · `metaAdId` · `metaAppId` · `adCreatedApprox`

- **How we read it:** The new format of the fbclid parameter in a link carries the ID of the clicked ad and of the app. Meta IDs grow over time, so from other ads with a known date we estimate when a given ad was created.
- **What typical tools miss:** The ad library searches by its own number, while the link gives the ad number from the advertiser's panel. Without decoding fbclid this number is lost in a long parameter.
- **On the sample:** Ad number read in 8 of 28 samples. Each concerned a different ad, so in the sample the trace linked no pairs. It serves the timeline and recognising another showing of the same ad.

### Trojan in a stolen page kit

`c2_host` · `stealerKit`

- **How we read it:** Some page kits circulate with a trojan added. A fake library (e.g. lazysizes or jQuery from free hosting) checks whether the browser is in the tracker panel (/admin, /panel) and sends cookies or login data to a foreign server. We flag the kit and record the address of the C2 server.
- **What typical tools miss:** A scanner sees a known library name and does not look inside. Here fraudsters rob other fraudsters, and all copies of the kit report to one server, so its address links the copies.
- **On the sample:** 1 sample with such a kit, without a pair in the sample. A test checks linking by the C2 server.

### Text fingerprint: developer messages and template sentences

`kit_string` · `template_phrase`

- **How we read it:** From the scripts of the page we take developer messages (console log, error, warning), often with a typo. From the page text and the thank-you note after the form is sent we take rare sentences; a sentence with a slip (a repeated word, mixed scripts) weighs more. Only text present on several domains counts, and the texts of platforms, frameworks and known libraries are masked.
- **What typical tools miss:** The page hash changes with every swapped image, price or domain. A typo in a log and an odd sentence pass from copy to copy unchanged.
- **On the sample:** Shared developer message in 4 pairs, shared template sentence in 17 pairs. Both traces link only together with another trace.

### Fake comments and a shared lead funnel

`comment_block` · `lead_flow`

- **How we read it:** The “readers’” comments are hard-coded into the page. We record the set of authors, and common first names, frequent in the blocks of other pages, weigh less. From the code of pages of one platform we take the form ID, the list of flows and the event key of the lead funnel.
- **What typical tools miss:** The comment block looks like a site plugin, and the funnel starts working only after the form is sent. An infrastructure scan sees neither.
- **On the sample:** The same comment block in 15 pairs. A shared funnel in 1 pair of pages from different accounts and different ad platforms: the result is a group of similar campaigns with one lead supplier.

### Video montage fingerprint

`overlay_template` · `reused_footage`

- **How we read it:** In the frames of the recording we look for a blurred or covered bar at the bottom of someone else's video and for the operator's captions. We record the kind, colour, position and size relative to the frame, rounded to 5%. In the corners of the frame we read the logo of the studio or channel the footage was taken from; logos of editors and platforms (CapCut, TikTok and others) are skipped.
- **What typical tools miss:** Image comparison and frame hashes see a different video, because the operator takes different footage each time. The caption layout and the source logo stay the same.
- **On the sample:** Caption template in 1 sample, 2 different source logos; no pair in the sample. A test checks the linking.

### Voice of a public figure from a closed gallery

`similar_voice` · `personas` · `personaCategories`

- **How we read it:** We cut the audio track into 4 s windows, drop silence and music alone, compute a speaker vector (ECAPA) and compare it with a gallery of 10 public figures. The result is “voice similar to X (0.57)” for a human to review, and the persona is a feature of a group of similar campaigns. The same vector links two recordings with the same voice.
- **What typical tools miss:** Fake-voice detectors judge whether a recording is synthetic, and their error on real ads (EER) is 25–60%. We only need to know whose voice the recording imitates.
- **On the sample:** Measured on recordings outside the sample (docs/METODYKA.md): the same person recognised in 70 of 70 recordings, a false hit in 1 of 25 recordings of other people, and 5 of 5 fakes from the public NASK compilation assigned to the right person.

### Fictitious expert

`fictional_expert` · `fictionalExperts` · `expertNotInRegister`

- **How we read it:** We look for the title “dr” or “prof.” with a full name that is not on the list of public figures, in the ad, the screenshot, the recording and on the page. Spelling variants are merged across the whole dataset. An optional plugin checks the name in the register of doctors and adds a label.
- **What typical tools miss:** People recognition looks for known faces and names. A fictitious doctor does not exist outside the campaign, so his name links its samples.
- **On the sample:** 4 names in 2 samples, without a pair in the sample. A test checks the linking.

### Traces in addresses and code: a fake address, the Discord clock, an earlier version

`idnConfusable` · `discordSnowflakes` · `foreignPersona` · `residue`

- **How we read it:** We flag an address in which a character imitates “/”, “.” or “-” or mixes scripts. From the upper bits of a Discord server or account ID we read the date it was created. A persona from another country in the ad name of a Polish version and an old paragraph commented out in the code suggest that the kit was moved from another market or from an earlier campaign.
- **What typical tools miss:** These are features of the content and the identifiers. They are not in the domain records, in DNS or in an infrastructure scan.
- **On the sample:** An old version commented out in 15 of 28 samples, a persona from another country in 1. The sample had no address imitating another and no Discord link; tests check how it works.

## 1. Linking traces

Strong trace threshold: 0.7; minimum edge score: 0.15; a shared trace found in more than 400 samples is skipped (maxPivotDf). Level: **campaign** (can link into one campaign), **group** (similar campaigns only), **only with another trace** (supports, does not link on its own).

★ marks a trace described in more detail in the section [Traces that typical tools do not give](#traces-that-typical-tools-do-not-give).

| Type | Name | Weight | Level | Source | Why | Example |
|---|---|---|---|---|---|---|
| `url` | Page URL | 1 | campaign | The full address of the page the ad leads to. | The same URL in two ads almost certainly means the same operator. | example.test/start |
| `host` | Host | 0.95 | campaign | The server name from the page URL, including the subdomain. | The same subdomain usually means the same site and the same owner. | offer.example.test |
| `domain` | Domain | 0.95 | campaign | The address of a site, e.g. example.test. Fraudsters often register new domains for just a few days. | A shared domain links samples on its own, unless it is a large service used by many. | example.test |
| `ip` | IP address | 0.6 | campaign | The number of the server the page runs on. | The same small server may point to one owner; we discount addresses shared by large hosting companies. | 192.0.2.10 |
| `asn` | Network (ASN) | 0.05 | campaign | The number of the provider network the server sits in. | One network holds thousands of unrelated sites, so this is a weak trace. | AS64500 |
| `nameserver` | Name servers (NS) | 0.35 | campaign | Servers that tell where a domain runs. | The same unusual pair of servers may link domains of one owner. | ns1.dns-example.test |
| `mx` | Mail server (MX) | 0.4 | only with another trace | The server that receives a domain's email. | A self-hosted mail server is a trace of the operator; we discount shared services (Google, Microsoft, Zoho, the registrar's mail), and this trace never links a campaign on its own. | mail.mail-example.test |
| `registrar` | Registrar | 0.05 | campaign | The company the domain was bought from. | A popular registrar says little; registrations in batches say more. | Example Registrar |
| `cert` | HTTPS certificate | 0.8 | campaign | A file a site needs to work over https. Every certificate goes into a public log. | One certificate for several domains is usually issued to one owner; we discount free certificate authorities. | a certificate for a.test and b.test |
| `tracker` | Tracker / pixel | 1 | campaign | Code of an advertising or analytics company with an account ID. | The same ID on two pages usually means the same owner. | Meta Pixel 000000000000001 |
| `favicon` | Favicon | 0.5 | only with another trace | The small site icon in the browser tab. | The same icon points to the same page kit; it is not enough on its own. | an icon shaped like a logo |
| `imagehash` | Image fingerprint | 0.65 | only with another trace | A hash of the ad image that survives small changes. | The same creative in two ads means the same ad or a variant of it. | the same picture with a different caption |
| `wallet` | Crypto wallet | 1 | campaign | The wallet address the page asks you to pay into. | The same wallet means the same money, so the same operator. | a TRON wallet address |
| `email` | Email | 0.9 | campaign | An email address given on the page. | The same contact on two pages usually means the same operator. | contact@example.test |
| `phone` | Phone | 0.9 | campaign | A phone number given on the page. | The same number on two pages usually means the same operator. | +48 000 000 000 |
| `telegram` | Telegram | 0.9 | campaign | A Telegram channel or account given on the page. | The same contact channel usually means the same operator. | t.me/example_channel |
| `advertiser` | Advertiser | 0.6 | campaign | The name of the profile that published the ad. Sample feature: Advertiser. | The same profile means the same ad account; names can be generic and repeated, though. | Daily News Demo |
| `endpoint` | Form backend | 0.95 | only with another trace | The address the page sends form data to. | A shared backend on different domains is a strong trace; we discount public form services. | collector.test/api/save |
| `hidden_fields` | Hidden form fields | 0.6 | only with another trace | The set of names of invisible fields in the page form. | The same set points to the same page template; it is not enough on its own. | lp_id, offer_hash |
| `asset` | JS/CSS file | 0.55 | only with another trace | The site's own script or style file. | The same unusual file points to the same page kit; we discount popular libraries. | lead-form.9f8e.js |
| `comment` | Code comment | 0.6 | only with another trace | A developer's note left in the page code. | The same unusual comment points to the same template; we discount standard comments. | “put the form after the phone block” |
| `domain_pattern` | Domain name pattern | 0.6 | campaign | A repeated naming scheme of domains, e.g. refund<number>-<word>.test. | Domains from one scheme are usually registered in batches by one operator. | refund12-abc.test, refund37-xyz.test |
| `cname_target` | Domain alias (CNAME) | 0.65 | campaign | A record that points a domain to another server. | A shared, unusual alias target points to shared infrastructure; we discount large CDNs. | traffic.example.test |
| `campaign_param` | Campaign parameter | 0.8 | campaign | A campaign tag added to the ad link (e.g. utm_campaign). | The same unusual value usually means the same ad campaign; we discount generic values. | utm_campaign=summer_07 |
| `persona` | Persona | 0.1 | group | The person the ad impersonates. | The same person appears in many unrelated campaigns, so on its own it does not link samples. | Adam Testowy |
| `path_id` | Account ID in file paths ★ | 0.85 | campaign | A random ID in the addresses of the page files, assigned by the page builder. | The same ID means the same page-builder account. | /a1b2c3d4-…/style.css |
| `param_schema` | Tracking-link template | 0.12 | only with another trace | The names of the link parameters and the kind of their values. | It points to a traffic-routing system used by many customers: a supporting trace. | sub1, sub2, clickid |
| `platform_account` | Page-builder account ★ | 0.9 | campaign | The owner ID in a page-building tool. Sample feature: Page-builder account. | The same account means the same operator. Different accounts on the same platform do not go into one campaign without strong evidence. | account 1a2b… |
| `platform_campaign` | Page-builder campaign ★ | 0.95 | campaign | A campaign in the page builder's panel, named by the traffic buyer. | The same pages are run by the same campaign: a strong trace. | campaign “summer-pl” |
| `page_template` | Page template on the platform | 0.35 | only with another trace | A ready-made template the page was built from on the platform. | The same template used by different accounts means similar campaigns, not one. | template “article-interview” |
| `click_server` | Click server ★ | 0.6 | campaign | The server that redirected the click on the ad (recorded in the click ID). | The same server routes traffic to both pages: shared infrastructure, a medium trace. | server 0a1b in the click ID |
| `meta_ad` | Ad ID ★ | 0.95 | campaign | The number of the clicked ad, recorded in the link. | The same number means the same ad. | ad 120200000000000 |
| `ad_payer` | Ad payer | 0.65 | only with another trace | The payer declared to the ad platform (ad library). | The same payer means one paying account; generic names link more weakly. | “Example Company” |
| `comment_block` | Fake comment block ★ | 0.45 | only with another trace | A set of made-up comments hard-coded into the page. | The same set of authors points to the same page template; it is not enough on its own. | the same 8 comments under an article |
| `technique` | Page technique | 0.2 | group | How the page works, e.g. a fake app store, a “back” trap, a pressure countdown, blocking developer tools, a CPA network form kit (kit:formFb). | The way of working links similar campaigns; it does not point to an operator. | a “back” trap |
| `crm_key` | CRM API key | 0.95 | campaign | A secret key of a CRM or affiliate network account that the form sends the lead with. We show only a hash (start, end and sha256), never the whole key. | One key belongs to one lead-buyer account: two pages with the same key send data to the same buyer. A strong trace, like a shared form backend. | key Zx81…yB9n |
| `template_phrase` | Template sentence ★ | 0.45 | only with another trace | A rare sentence from the page text or from the thank-you message after the form is sent, identical on pages on different domains. A sentence with a slip (repeated words, mixed alphabets) weighs more. | It points to the same page template; many operators buy the same template, so a campaign needs a second kind of evidence. | “our advisor will call you and present the platform” |
| `profit_claim` | Promised profit | 0.2 | group | The amount and period of the promised earnings from the text, a screenshot or a recording. | The same promise comes from the same fraud script, which many operators copy: it only links similar campaigns into a group. | PLN 3000 in a day |
| `kit_string` | Message from the kit script ★ | 0.5 | only with another trace | A developer message written in the page script (console log, error, warning), often with a typo, identical on pages on different domains. Page-builder scripts (SDK), framework bundles and known libraries are ignored. | It points to the same network tool, like a file hash; many operators use the tool, so a campaign needs a second kind of evidence. It counts with at least two shared messages or one message of at least five words. | “test module: start!” |
| `shared_doc` | Document, form or chat shared by link | 0.9 | campaign | The address of a document, spreadsheet or form (Google, Notion, Microsoft Forms, Typeform, Jotform) or of a shared conversation with a language model, found on the page, in the ad, in a screenshot or in the page's network traffic. | Such a resource belongs to one account, so the same ID in two samples points to one operator. A shared AI chat is sometimes a pasted campaign plan. | a Google form with the same ID on two pages |
| `onion` | .onion address | 0.9 | campaign | The address of a hidden service on the Tor network (version 3, 56 characters). | The same address means the same operator resource; we do not count version 2 addresses, because they have expired. | 56 characters and .onion |
| `messenger_invite` | Messenger invite or account | 0.9 | campaign | A Discord invite, or a Signal, Viber or Line account or group, given on the page, in the ad or in a screenshot. | The same invite or account usually means the same operator (like a Telegram channel). | discord.gg/examplecode |
| `c2_host` | Trojan C2 server in the page kit ★ | 0.95 | campaign | The address of the server to which a script of a copied page kit (e.g. a fake lazysizes library) sends cookies or login details from a fake tracker panel. | All copies of the same downloaded kit report to the same server, so a shared address points to one operator of the kit. | c2.example.test |
| `fictional_expert` | Fictitious expert ★ | 0.75 | campaign | A “dr” or “prof.” title with a first and last name that is not on the list of public figures (e.g. “dr Jan Testowy”), used as an authority on the page, in the ad or in a screenshot. Sample feature: Fictitious doctor (probably AI). | A made-up figure is invented by one operator, so the same name (even with a typo) on different domains points to one author. A name repeated often in the data set loses weight. | dr Jan Testowy and dr Jan Testowyy |
| `lead_flow` | Page-builder lead funnel ★ | 0.5 | only with another trace | The same form, list of flows or event key stored in the code of pages from one platform. | The pages feed one lead funnel: the same network or offer, not necessarily one buyer. | form 7c3e91a4… |
| `overlay_template` | Replaced-caption template ★ | 0.45 | only with another trace | The editing layout: a blurred or covered bar at the bottom of someone else's footage and the operator's own captions (kind, color, position and size relative to the frame). | The same layout in different videos means the same tool or the same editor; it is not enough on its own, because tools are shared. | a white bar over the bottom 10% of the frame |
| `reused_footage` | Source mark of reused footage ★ | 0.45 | only with another trace | The name or logo of a studio or TV station in the corner of the frame: the mark of the original the footage was taken from. Marks of editors and platforms (CapCut, TikTok and others) are ignored. | The same mark in ads of different advertisers means a shared library of stolen footage; it is not enough on its own. | “Studio Test” in the top right corner |
| `company_id` | Company ID on the page | 0.5 | only with another trace | A company number given in the footer, the terms or the seller details: NIP, REGON, KRS (Polish company numbers), an EU VAT number, a UK company number. | The same number on two pages means a shared template or the same hand, but company details can be copied from someone else's site, so the trace does not link a campaign on its own. A number with a wrong checksum is made up. | NIP 123-456-32-18 in the footer |
| `bank_account` | Bank account on the page | 0.8 | only with another trace | An account number (IBAN or Polish NRB) given as the account to pay into. | The same account means a shared recipient of the money: a stronger trace than a company number, but accounts of front people (“money mules”) are sometimes shared by different groups, so it does not link a campaign on its own. | PL61 1090 1014 0000 0712 1981 2874 |
| `postal_address` | Shop's registered address | 0.5 | only with another trace | The full address given on the page: street, number, postcode and city (normalized: “ul.” and “ulica”, or a postcode with and without a hyphen, give the same address). | The same address on two shops means a shared template or the same hand, but an address is easy to copy from another shop's footer, and virtual offices rent the same address to unrelated companies, so the trace does not link a campaign on its own. | ul. Example 1, 00-001 Testville |
| `cloaker_account` | Cloaker customer account ★ | 0.9 | campaign | The customer number (cl_sid) in a service that hides the page from moderation, stored by the page builder together with the cloaker domain (cl_domain). | The same number on the same cloaker domain is one paid account, so the same operator. The number alone or the domain alone does not link. | account 12345 at cloak.example.test |
| `launcher_account` | Ad launcher account ★ | 0.9 | campaign | The ID (launcher) of the account the ads were launched from, stored by the page builder when it differs from the page owner. | The same launcher account means the same ad buyer. When the launcher equals the page owner, it counts once, as the page-builder account. | account 1a2b… |
| `affiliate_account` | Affiliate network account | 0.9 | campaign | Partner IDs of an affiliate network in the order link, in an encoded referer parameter or in hidden form fields: team and user (team_id, user_id), stream (stream_id) or offer (offer_uuid), always together with the network's address. | A stream and an offer in the same network belong to one partner who buys traffic. The team and user pair are small numbers, so the pair alone does not link a campaign: a second trace is needed. | network.example.test · team_id=42, user_id=13 |
| `meta_token` | Meta access token ★ | 0.95 | campaign | A secret access token to a Meta ad account, stored in the URL (token=), in the page-builder record (fb_capi_token) or in the page code. We show only a hash, never the token itself. | A token is issued to one ad account, so the same token on two pages means the same operator. We never use the token in any call to Meta. | sha256 hash 3f9a1c… |
| `hosting_account` | Video or code hosting account | 0.6 | only with another trace | The video library of one customer of a hosting service (video host address with the library ID) or a GitHub account from which jsDelivr serves the page files (`cdn.jsdelivr.net/gh/<account>/…`). | Two pages with files from the same library or the same account use one account, unlike the CDN domain itself, which thousands of unrelated sites share. The trace supports a link but does not link a campaign on its own. | library 0a1b2c3d |
| `similar_image` | Similar creative (similarity of two samples) | 0.6 | only with another trace | The ad images differ only in small details. | The same picture in variants usually means the same campaign. | the same picture with a different caption |
| `similar_image_semantic` | Similar image (similarity of two samples) | 0.45 | only with another trace | The images show the same thing, though one is not a copy of the other. | It points to the same creative template; it counts together with other traces. | the same scene in a different frame |
| `similar_text` | Similar text (similarity of two samples) | 0.5 | only with another trace | The ad texts are very similar to each other. | The same text in many ads often means the same campaign or the same narrative. | the same text with a different amount |
| `similar_dom` | Same page layout (similarity of two samples) | 0.45 | only with another trace | The pages have the same code structure. | The same layout points to the same page kit, which is sometimes sold to many operators. | the same article page on another domain |
| `similar_audio` | Same audio track (similarity of two samples) | 0.5 | only with another trace | The recordings have the same soundtrack. | The same soundtrack usually means the same creative. | the same music and voice-over |
| `similar_voice` | Same voice (similarity of two samples) ★ | 0.4 | only with another trace | The same voice speaks in the recordings. | The same voice can be faked many times, so it is not enough on its own. | the same narrator in two recordings |

### Sample features that link or help

| Key | Name | Role | Source |
|---|---|---|---|
| `landingUrl` | Page URL | links | from the sample |
| `finalUrl` | Final URL (after redirects) | links | from the HAR or saved page |
| `observedUrls` | URL from the address bar | links | from screenshot OCR |
| `advertiser` | Advertiser | helps | from the screenshot or description |
| `adLibraryIds` | Ad library ID | links | from screenshot OCR |
| `adLibraryAdId` | Ad ID in the library | links | from the library record |
| `adAdvertiserId` | Advertiser ID in the library | links | from the library record |
| `companyIds` | Company IDs and bank accounts on the page | links | from the page text, code, JSON-LD or screenshot (OCR) |
| `platformCampaignName` | Page-builder campaign | links | from the page code |
| `platformAccount` | Page-builder account | links | from the page code |
| `metaAdId` | Ad ID | links | from the link (fbclid) |
| `ocrText` | Text from screenshot | helps | from screenshot OCR |
| `videoOcrText` | Video captions | helps | from captions in the video (OCR of frames every 2 s) |
| `asrText` | Recording transcript | helps | from the recording (ASR) |
| `text` | Ad text | helps | from the sample |
| `dhash` | Image fingerprint | links | from the screenshot |
| `domSimhash` | Page-structure fingerprint | helps | from the HAR or saved page |
| `platformSourceIds` | Traffic source IDs on the platform | links | from page-builder links (suuid parameter) |

## 2. Attributes of the sample and the campaign

They describe the sample and do not link it to others.

| Key | Name | Source |
|---|---|---|
| `landingSource` | Where the page URL comes from | from the sample |
| `landingFragment` | URL fragment (#…) | from the URL |
| `inAppBrowser` | In-app browser | from screenshot OCR |
| `uiView` | View in the screenshot | from screenshot OCR |
| `advertiserImpersonatesName` | Advertiser impersonates a person | from the advertiser name and the list of people (attribute, not campaign evidence) |
| `profitClaims` | Promised profit (amount and period) | from the ad text, page, OCR or transcript (attribute; links only similar campaigns into a group) |
| `fictionalExpert` | Fictitious doctor (probably AI) | from a title (dr, prof.) and a name not on the list of public figures in a health ad (attribute, not campaign evidence) |
| `expertNotInRegister` | Doctor not in the register (probably made up) | from a recorded response of the register of doctors (optional plugin, off by default; a label, not campaign evidence) |
| `liveStream` | Fake live stream | from the recording metadata (yt-dlp: was_live, is_live; attribute, not campaign evidence) |
| `aiImageMeta` | AI-generated image (marker in the file) | from the image file metadata: C2PA, IPTC, EXIF or the generator description (attribute; no conclusion without metadata) |
| `advertiserMismatch` | Ad account probably hijacked (name does not match the content) | from the advertiser name (local business or private person) and an investment narrative (attribute, not campaign evidence) |
| `displayedDomainMismatch` | Domain shown in the ad differs from the landing page | from screenshot OCR or the ad text and from the redirect chain (attribute, not campaign evidence) |
| `displayedBrandDomain` | Domain shown belongs to a well-known brand (bank, portal, shop) | from the brand list (attribute) |
| `clickfix` | Command copied to the clipboard (ClickFix) | from the page script: only the kind and the SHA-256 hash; the command itself is a malware payload and is not stored (attribute) |
| `stealerKit` | Trojan in the page kit (steals cookies or passwords from a fake tracker panel) | from the page scripts and downloaded libraries on free hosting: a check for an /admin or /panel path plus sending a cookie or login details to a foreign host (attribute; the C2 host itself is a trace) |
| `idnConfusable` | The address imitates another address (a character resembling “/”, “.” or “-”, or mixed alphabets) | from the page URL, redirects, the address bar in the screenshot and links (attribute: describes how the address looks to the eye) |
| `adStartWeekday` | Weekday the ad started | from the date of first delivery in the ad library, UTC (attribute; the spread within a campaign describes the operator's rhythm) |
| `discordSnowflakes` | Creation date of a Discord server or account (from the ID) | from discord.com/channels and discord.com/users links: the top bits of the ID are the creation time (attribute: a “birth clock”) |
| `onionV2` | .onion address, version 2 (expired) | from the page text (attribute; does not link) |
| `phoneLines` | Phone number type | from local libphonenumber-js metadata, without sending the number to any service (attribute: VoIP numbers are sometimes disposable, so the weight of a number depends on its rarity) |
| `phoneCountryMismatch` | Number's country differs from the ad's market | from the number and the ad's market (attribute) |
| `tollFreeOnAlert` | Toll-free number on a page with a fake alert | from the number and the page technique (attribute) |
| `fictionalExperts` | Fictitious experts (dr, prof. not on the list of public figures) | from the page text, ad, screenshot and recording (attribute; the name is also a trace) |
| `narrative` | Narrative and hooks | from the ad text, page, OCR and transcript (attribute; a feature of a campaign group, not evidence) |
| `localizedUi` | Multilingual UI dictionary | from the page script (language codes; localization of the page-builder platform, not a text trace; attribute) |
| `residue` | Commented-out old version | from comments in the page code (attribute; the same old paragraph on two pages is a trace of a shared template, not evidence) |
| `foreignSegments` | Trace of another version (insert in another language) | from the page text, scripts, comments or ad names (attribute; the campaign may also run in the country of that language; a hint, not a conclusion about the author) |
| `foreignPersona` | Persona from another country in the ad name | from the ad parameters (ad_name, adset_name, campaign_name) with the PL code (attribute) |
| `typography` | Text typography | from the ad and page text (attribute; the same text with different typography is a different edit of the template, not a different owner) |
| `translationArtifacts` | Translation traces | from the page text and captions (attribute; mixed alphabets, calques, ty/wy switches between singular and plural “you”, numbers spelled out; no conclusions about nationality) |
| `languageErrors` | Language errors on the page | from the page text (attribute without weight, B-325: paragraphs in a different language than the rest of the page or words with mixed alphabets in a sentence) |
| `brandStyle` | Brand name style | from the advertiser or brand name (pseudo-Polish compound with a financial stem, attribute) |
| `advertiserNameKind` | Kind of advertiser name | from the advertiser name (generated brand, person, local business; attribute) |
| `adPlatform` | Ad library | from the library record |
| `adAdvertiserLegalName` | Advertiser's legal name | from the library record |
| `adAdvertiserLocation` | Advertiser's country | from the library record |
| `adAdvertiserVerified` | Advertiser verified | from the library record |
| `adRegions` | Delivery regions | from the library record |
| `adFirstShown` | Ad delivery start | from the ad library |
| `adLastShown` | Ad delivery end | from the ad library |
| `payerKinds` | Payer type from the ad library | from the payer and beneficiary names (DSA self-declaration; the platform does not verify it) |
| `payerSuspicious` | Suspicious ad payer | from the payer name (placeholder, keyboard mash or a name in a foreign alphabet) |
| `payerEqualsBeneficiary` | Payer same as beneficiary | from the ad library |
| `companyRegistry` | Company registers (VAT white list, KRS) | from public registers for the NIP and KRS numbers on the page (option --company-registry; name, registered address, status, registration date, no personal data); a name or address mismatch, removal from the register, a young company and the company's age relative to the domain are explanations, not campaign evidence |
| `legalEntities` | Entity names with a legal form | from the page text, code, JSON-LD or screenshot (OCR) |
| `emailDomainKinds` | Kind of email address domain | from the email addresses on the page (free mailbox, shop domain or another domain) |
| `addressCompleteness` | Completeness of the address on the page | from the page text and JSON-LD (full, city only, PO box or none) |
| `certIssuer` | TLS certificate issuer | from the HAR (securityDetails); a free certificate is only context, the padlock says nothing about the seller |
| `certMismatch` | Certificate issued for another domain | from the HAR (securityDetails): no name in the certificate covers the host |
| `certExpired` | Expired certificate | from the HAR (securityDetails): validity ended before the page was saved |
| `brandInPath` | Well-known brand in the URL path | from the page URL: the brand is in the path, not in the domain name (typical of courier and classifieds clones) |
| `hostingOutsideEu` | Hosting outside the EU and EEA | from the country of the IP address (ASN enrichment); sites outside the EU are harder to take down |
| `tldRare` | Rare domain ending | from the domain name (an ending not on the list typical of shops, e.g. .sbs, .top); a weak hint |
| `domainLangMismatch` | Domain name in a different language than the page | from the domain name and the page language; a weak hint |
| `privacyControllerMismatch` | Data controller other than the shop | from the privacy policy: the controller's address is on a different domain than the page's contact addresses |
| `registrantHidden` | Domain registrant details hidden | from RDAP (REDACTED or a privacy service); most registrars do this, so a weak hint |
| `contactDomainDead` | Contact email domain does not respond | from enrichment (network mode): the domain has an MX record but does not respond over HTTP(S) |
| `phoneAreaMismatch` | Landline number does not match the address city | from the phone number and the address on the page |
| `companyIdInvalid` | Company ID with a wrong checksum | from the page text, code, JSON-LD or screenshot (OCR) |
| `personas` | Persona | from the text, transcript or OCR |
| `impersonatedBrand` | Impersonated brand | from the page title |
| `landingName` | Page name in the platform panel | from the page code |
| `trafficSource` | Traffic source | from the page code |
| `metaAppId` | App ID | from the link (fbclid) |
| `clickTime` | Click time | from the click ID |
| `clickCounter` | Click server counter | from the click ID |
| `firstSeen` | First seen | from the sample |
| `cyrillic` | Cyrillic in the page code | from the page code |
| `cloakingSuspected` | Suspected cloaking | from two fetches of the page |
| `personaCategories` | Kinds of people in the ad | from the list of public figures (e.g. politician, presenter, doctor) for people recognized in the sample |
| `cloakerInSource` | Cloaker in the page code | from the page code or the traffic source name: a marker that the page runs through a cloaker (attribute, not campaign evidence) |
| `platformAccountSource` | How we know which platform account it is | from the page code: the account from the tenant address or from owner_uuid (attribute) |
| `platformAccountWarning` | Warning about an inconsistent platform account | from the page code: the tenant in the address differs from owner_uuid, so the account was assigned by owner_uuid (attribute) |
| `platformTenants` | Platform tenants in the page file addresses | from the page file addresses (landing-cdn): IDs of the accounts the page sits on |
| `infrastructure` | Shared ad infrastructure (description) | from the campaign summary: domains, trackers, IPs, contacts and wallets linking the ads (description only) |
| `techniques` | Page techniques | from the page code and content: a list of recognized fraud techniques, e.g. fake comments (attribute, not campaign evidence) |
| `creativeBrand` | Brand recognized in the ad image | from comparing the ad image with brand patterns (attribute, probability, not campaign evidence) |
| `domainAgeDays` | Domain age in days | from the domain registration date (RDAP) and the date the sample was first seen; a very young domain is a weak hint |
| `certAgeDays` | Age of the first certificate in days | from the certificate log (CT) and the date the sample was first seen; a fresh certificate is a weak hint |
| `pagePlatforms` | Page-building platforms | from the page code: recognized platforms and tools (e.g. aio, binom) the page was built with (attribute, not campaign evidence) |
| `inputExtra` | Extra columns from the input data | from columns of the input file outside the standard mapping (only the columns named in the configuration link) |
| `namingMixedScript` | Name with mixed alphabets | from names in the platform panel: Latin letters mixed with Cyrillic (a weak hint) |
| `codeCommentLang` | Language of comments in the page code | from comments in the page code: Ukrainian or Russian (attribute, not campaign evidence) |
| `landerSlugStyle` | Style of the page URL path | from the URL path: a string of consonants or a list of random words (attribute, not campaign evidence) |
| `advertiserNameStyle` | Style of the advertiser name | from the advertiser name: a random “brand” or a foreign first and last name (attribute, not campaign evidence) |
| `adCreatedApprox` | Approximate ad creation date | from the Meta ad ID and other ads with known dates (estimate, attribute) |

## 3. Manipulation techniques

Field `techniques[]`. An attribute and a group trace, not proof of one campaign. Shop techniques only describe the shop page.

| Key | Name | Description |
|---|---|---|
| `spaced_text` | text spaced out letter by letter | A caption or text in the ad written with letters separated by spaces (“D o w n l o a d”). |
| `fake_security_alert` | fake security alert with a phone number | The page scares the user with a virus, a locked computer or a hacked account, gives a phone number as the only way out and is hard to leave (full screen, alert windows, a “back” trap, an alarm sound). |
| `remote_access_tool` | remote desktop program to download | A link or instructions to download a remote desktop program (e.g. AnyDesk, TeamViewer QuickSupport) with a request for the access code. |
| `clickfix_paste` | fake verification with a command to paste | A fake CAPTCHA or “verify you are not a robot” check tells the user to press a shortcut (e.g. Win+R) and paste a command that the page has copied to the clipboard. |
| `fake_comments` | fake comments | Under the article or ad there is a comment section where supposed readers praise the product or show their earnings, but it is written into the page code and does not come from the site's real comment plugin. |
| `fake_app_store` | fake app store | The page poses as an app store (Google Play, App Store) with a rating, a download count and an “Install” button. |
| `back_trap` | “back” trap | The page hijacks the browser's “back” button, so pressing it keeps the user on the page or sends them to another fraudster page. |
| `fake_social_post` | fake social media post | The page looks like a social media post (Facebook, X) with likes and comments, though it is an ordinary fraudster page. |
| `recent_purchase_popup` | “someone just bought” pop-ups (shop) | Pop-ups on the page say that someone has just bought the product (“Anna from Gdynia bought 2 min ago”). |
| `low_stock_claim` | “last items” and “N people viewing” (shop) | The page claims that only a few items are left or that many people are viewing the product right now. |
| `countdown_timer` | countdown timer next to the offer (shop) | Next to the offer there is a timer counting down to the end of the promotion. |
| `closing_down_story` | shop closing-down story (shop) | The page claims that the shop is closing down or holding a closing-down sale, which is why prices are very low. |
| `crypto_discount` | extra discount for paying in crypto (shop) | The page offers an extra discount for paying in cryptocurrency. |
| `waitlist_upsell` | discount as a waiting-list sign-up with a surcharge (shop) | The discount is presented as signing up for a waiting list, and after signing up a surcharge or an extra service appears. |
| `trial_subscription` | trial period with automatic subscription renewal (shop) | An offer “for PLN 1” or a free trial, after which the payment renews automatically as an expensive subscription. |
| `blik_via_messenger` | BLIK code via a messenger (shop) | The page asks for a BLIK code or for payment through a messenger chat (e.g. Messenger). |
| `fake_courier_payment` | page posing as a courier with a card field and a parcel locker choice (shop) | The page poses as a courier (e.g. InPost, DHL): it asks for an extra parcel fee, has a card field and a choice of parcel locker. |

## 4. Narrative topics and hooks

**Topics** (what the ad is about; subcategories in brackets):

- `investment`: investment and earnings
- `subsidy`: subsidies and benefits
- `health`: health (joints, weight_loss, hypertension, vision, hearing, diabetes, miracle_cure)
- `gambling`: gambling
- `elections`: elections
- `ai_trading`: AI trading
- `gold_reserve`: gold reserves
- `commodities_war`: commodities and war
- `leaked_secret`: leaked secret
- `testimonial_small_win`: story of a quick profit
- `recovery`: fund recovery
- `sport_event`: sports event
- `inauguration`: inauguration
- `state_investment`: state investments
- `adult_phishing`: 18+ content and age verification
- `urgent_notice`: urgent notice
- `petition`: petition
- `tech_support`: fake tech support (virus, locked computer)
- `refund_overpayment`: overpayment refund (“we sent you too much”)
- `recovery_offer`: offer to recover lost funds (repeat fraud against victims)
- `job_offer`: job offer (remote, product reviews for commission)
- `fake_authority`: fake authority (police, KNF, UODO, CERT, bank)

**Hooks** (form of the message, independent of the topic):

- `sensation`: sensation
- `endorsement`: endorsement by a well-known person
- `fake_interview`: fake interview
- `secrecy`: secrecy (don't tell the bank or your family)
- `withdrawal_fee`: fee or tax before withdrawal
- `urgency_lock`: threat of an account lock by a deadline
- `nationwide`: “all of Poland” (everyone is doing it)
- `millions_of_poles`: “millions of Poles”
- `pharma_villain`: drug companies as the villain
- `state_program_pays`: state program covers the costs
- `custody`: handcuffs or arrest
- `video_removed`: video removed or blocked

## No description

Everything in the registries has a name and a description.

## 5. Summary

| Section | Count |
|---|---|
| Highlighted traces (section at the start) | 11 |
| Linking traces (types) | 61 (campaign: 32, group: 3, only with another trace: 26) |
| Sample features that link or help | 18 |
| Attributes of the sample and the campaign | 86 |
| Manipulation techniques | 17 |
| Narrative topics | 22 |
| Narrative hooks | 12 |
| No description | 0 |

Generated: 2026-11-23, commit `045a506`.

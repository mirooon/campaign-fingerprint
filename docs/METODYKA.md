# Method: how the tool links samples into campaigns

*Polish version: tag `hacknation-2026`.*

This document is for a person who judges the result, not for someone who writes code. It explains what the tool takes from a sample, how it measures similarity, when it treats two samples as one campaign, and what it cannot do. Technical details (file fields, functions, parameters): [TECHNICAL.md](TECHNICAL.md) (Polish). How to run it: [../README.md](../README.md). Component licenses: [../LICENCJE.md](../LICENCJE.md) (Polish).

All examples are made up (`.example` domains, fictional people).

<a id="skrót-jak-działa-łączenie"></a>

## Summary: how linking works

For someone with five minutes. The rest of the document expands each step.

1. **Traces.** From each sample (ad, page, HAR, screenshot, recording) we extract traces that can recur in another sample: tracker, page-builder account, contact address, form backend, domain, server, creative file, a message from a script and others (section 2; full catalogue in `docs/CECHY.md`). We do not judge whether an ad is fake, only whether two samples share a trace.
2. **Weights.** Each kind of trace has a weight from 1.0 (tracker, wallet) to 0.05 (registrar, ASN), taken from one table in `lib/graph/config.ts` (section 3). The weights are set by hand, not learned.
3. **Discounts and rarity.** The weight of a specific trace is the type weight times a discount for shared infrastructure (CDN, free certificates, page-builder platforms: ×0.006 to ×0.1) times rarity (IDF): the more samples share the same trace, the less it is worth. The evidence for one pair is combined with noisy-OR, `1 − Π(1 − wᵢ)`.
4. **Campaign rules** (section 4). Strong evidence (weight ≥ 0.7, trace present in fewer than half of the set) links on its own. “Not alone” traces (page template, comments, favicon, payer, shop address, company number, bank account and others from the list in section 3) count only together with a second, independent kind of evidence. Two ads on different accounts of the same page-builder platform are not linked without strong evidence. Content (text, image, sound, voice) without infrastructure needs at least two kinds of content. Persona, page technique and profit amounts link only into a group.
5. **Campaigns and groups.** Strong evidence is joined with union-find, the rest with Louvain partitioning of the weighted graph. A **campaign** is the same operator; a **group of similar campaigns** is a shared template, platform or person without evidence of one operator. Every edge has an explicit list of evidence items (`explain`), and for close pairs that were deliberately not linked we record the rule that blocked the link (section 7).
6. **Analyst corrections.** An analyst can record a decision (these two samples are one campaign, these two are not, this trace does not count as evidence); `build-graph` applies it on the next run, and every link changed by hand carries the note “analyst decision” (section 9.2).

**Result on the 25 reference cases (28 records), commit `a407767`, built-in weights.** Its linking code is the same as in `74d54de` (the state at the deadline, 22 Nov, 10:54; the two differ only in comments). Expected links at the mandatory level (MUST): 28 of 28. At the “should” level (SHOULD): 18 of 24. Agreement with our labels: pair F1 0.8974, B-cubed F1 0.9672, ARI 0.8858. On the synthetic set, pair precision, recall and F1 are 1.0. The labels are ours and the thresholds were tuned on the same cases, so this is agreement with our own understanding of the cases, not proof of effectiveness on new data (section 12, which also has measurements on samples outside the reference set and a table with the commit behind each number).

## 1. Input and formats

The unit is a **sample**: one ad together with everything collected about it. The tool accepts:

| Input | What it yields |
|---|---|
| saved page (HTML with a `<name>_files` folder) | content, forms, scripts, code comments, page structure |
| HAR file | raw server response, request list, IP addresses, headers, redirect chain |
| MHTML | like a saved page, in one file |
| screenshot | creative (image), OCR text, domain from the browser address bar |
| recording with metadata (video, `.info.json`) | frames, transcript, audio fingerprint, advertiser and ad library ID |
| link or plain text | a URL for a passive check (only with `--live`) or content to compare |
| dataset CSV/JSON (`--dataset`) | each row is a sample; columns are mapped by PL/EN names or by a mapping file |
| batch of folders (`--cases`) | each subfolder is a case; all of them go through one graph |
| zip | unpacked on the server (with protection against paths outside the folder and against zip bombs) |

Any subset is enough. Less data means fewer features and lower confidence (section 10).

## 2. Features in five families

A feature is a trace that can recur in another sample. The tool does not judge whether an ad is fake. It only asks whether two samples share traces and how rare those traces are.

| Family | Example features | Example (synthetic) |
|---|---|---|
| **Text and people** | similar text (TF-IDF, optionally embeddings), persona recognized in the text or from a face (closed list of public figures, see “Faces” in section 12), contacts, wallets | two ads promise “earnings after 5 minutes” in words from one template; both feature the fictional “Ewa Przykładowa” |
| **Appearance** | image hash (dHash), the same creative file (SHA-256), CLIP similarity (optional, also on 8 video frames), audio fingerprint (Chromaprint), speaker voice (optional) | two screenshots differ by a sticker: dHash distance 3 out of 64 bits |
| **Page** | form backend, hidden fields, own JS/CSS files, code comments, DOM structure, techniques (fake app store, blocked “back” button, fake comments) | both forms send data to `https://zbieracz.example/lead/ab12` |
| **Infrastructure** | domain, host, IP, ASN, NS servers, registrar and registration series (RDAP), certificate (CT), CNAME target, tracker | two domains, `a-oferta.example` and `b-oferta.example`, registered 20 minutes apart at the same registrar |
| **Platform and identifiers** | page-builder account and campaign, tracker server (the machine in the click ID), ad ID in `fbclid`, ad library ID, payer from the ad library, campaign parameters (UTM, sub1–5), link template | two links have the same three-byte machine ID in `xid` |

**Ad libraries as a source.** Public ad libraries (Meta Ad Library, Google Ads Transparency Center; for the TikTok and X adapters see [ZRODLA-METADANYCH.md](ZRODLA-METADANYCH.md), Polish) provide the ad ID, advertiser, payer, run dates and creatives; `bun run adlib` turns a library record into a sample that goes the same way as a screenshot from a report. An ad ID from a library (with the platform in the key) is evidence as strong as an ad ID in a link: the same ID means the same ad, that is a duplicate, and IDs from different libraries never mix. The advertiser is a medium trace, not a strong one, because ad accounts get rented out and taken over: we link by the stable account ID (at Google `AR…`), not by the display name, which changes, and the legal name, country and verification status are attributes of the account, not evidence. The payer does not link campaigns on its own either, because the payer is sometimes a victim of identity theft (as in the weight table). Searching the libraries yields samples to check; **it does not promise hits** for known campaigns (a search in Google Ads Transparency found no samples for the campaign families in the reference set).

### Advertiser and company identity

**The payer in an ad library is self-declared.** The payer and beneficiary fields (DSA transparency, Articles 26 and 39; in the Marketing API `dsa_payor` and `dsa_beneficiary`) are filled in by the advertiser, and the platform does not verify them ([AI Forensics, “Meta health ads”](https://www.aiforensics.org/work/meta-health-ads)). A network of scam pages could be linked through the shared “paid for by” text alone ([Tech Transparency Project](https://www.techtransparencyproject.org/articles/meta-hosts-sprawling-pro-trump-scam-ad-network-as-election-nears)), but unrelated advertisers can type in the same text just as easily. So the payer name is only a hint, not proof of who paid, and it still does not link campaigns on its own (`ad_payer` in `notAloneKinds`). The tool adds a **payer kind** (`lib/osint/payerKind.ts`), checked in this order, first match wins: placeholder (up to 3 characters or a word from the dictionary: “test”, “xyz”, “brak” (“none”)…), gibberish (a keyboard sequence, letters mixed with digits, a string without vowels), a first and last name in a foreign alphabet or with Vietnamese spelling on a Polish-language ad, private person, generic company name (“Global Media Corp”), name equal to the name of the advertiser's page, name with a legal form, other. The kind explains why the declaration is doubtful (“the payer is keyboard gibberish”), is a fact worth reporting and goes into the evidence pack as a hint (`payer_kinds`, `payer_equals_beneficiary`, `payer_suspicious`). Two rules: **a placeholder does not create a link** (the same “Test” appears for unrelated advertisers, so there is no `ad_payer` node), and a private person as the payer stays a trace with a note that this person may be a victim of identity theft. The dictionaries are generic (typical placeholders, keyboard rows, company words) and live in `DEFAULT_PAYER_KIND_CONFIG`; they were not built from strings in real cases.

**Company identifiers and bank accounts from pages** (`lib/text/companyIds.ts`): NIP (Polish tax ID), REGON (business register number), KRS (National Court Register number), IBAN and the Polish NRB account number, EU VAT number, UK company number, LEI, and the entity name with a legal form, taken from visible text, page code (including hidden elements and comments), JSON-LD (`vatID`, `taxID`, `leiCode`, `identifier`) and screenshot OCR. We read a number only next to a label (“NIP”, “REGON”, “konto” (“account”)…), because ten bare digits are an order number; an IBAN with a valid checksum needs no label. We check the checksum where the number has one (NIP, REGON, IBAN and NRB mod 97, LEI); a number with a wrong checksum is made up or copied with a mistake and gets the `companyIdInvalid` flag, but the same made-up number on two pages still points to a shared template, so it creates a trace as well. These traces are **supporting only**: company details can be copied from someone else's page (fake shops show the details of real companies), and the accounts of money mules are sometimes shared by different groups, so `company_id` and `bank_account` are in `notAloneKinds`, and a bank account, despite its weight of 0.8, is not “strong” (`nonStrongTypes`). Identifiers of intermediaries that appear in the footers of many unrelated shops (payment operators, couriers, shop platforms) are on the exclusion list `lists.companyIdIntermediaries` (weight ×0).

**What we do not do.** We do not build a graph of people from registers: the public KRS API masks the first names, surnames and PESEL numbers (national ID numbers) of board members and searches only by KRS number, and tools with a graph of personal connections are paid; personal data from registers would not be needed to link campaigns anyway. Checking a number in a register (VAT white list, KRS extract) sends the numbers from the page to a public API, so it is off by default (`--company-registry`, live mode only; see “Company registers” in section 2); the result is an attribute, not a linking trace.

**Which features work today** (B-104): all of those listed, as long as the sample contains them. Optional features must be switched on and need tools: OCR (`--ocr`, tesseract), transcription (`--asr`), audio fingerprint (`--audio`), CLIP (`--clip`, needs a model), voice (`--speaker`), faces (`--faces`, OpenCV, needs the venv from `scripts/py/setup-face.sh` and about 40 MB of models), ad library (`--ad-library`), DNS/RDAP/ASN network queries (`--lookups` or `--live`). A missing step is marked in the result as `skipped` with a reason. The default Docker image has the face models (YuNet, SFace) but no ASR, CLIP or voice models, and it does not go out to the network, so those features are empty there. A gallery of public figures' voices exists (`--speaker`, closed list, group feature only; section 12, “Limitations found during the work”). Company registers (VAT white list and KRS extract) are optional (`--company-registry`, network only).

### Shop signals

Some ads lead to fake shops. An analyst checks them by hand in ten to twenty minutes, so the tool reads the same things from the page (`lib/osint/shopSignals.ts`, `lib/osint/contact.ts`): links to the terms, returns, privacy policy and contact pages; struck-through prices and discounts (share of discounted products, median, maximum, shop-wide discount: at least 70% of products discounted by at least 50%); no phrase about the lowest price in the last 30 days (Omnibus Directive, in force in Poland since 1 Jan 2023); pressure tricks such as “someone just bought”, “last items”, a countdown timer, a story about the shop closing down and an extra discount for paying in crypto; payment methods (bank transfer only, only methods that are hard to reverse: crypto, BLIK, gift cards; the payee is a private person or the transfer title is “gift”); delivery time; reviews (rating distribution, date window, anonymity; only 5/5, reviews from just a few days, no reviews); name and year in the footer; claimed years in business; the type of domain of the email addresses (free mailbox, shop domain, other domain) and the completeness of the postal address (full, city only, PO box).

**These features explain; they do not link.** Honest shops can also lack the 30-day price, show only 5/5 reviews, offer a single payment method or use a Gmail address, so none of these features has a weight in the graph and none is evidence. We show them in the sample card (“Shop”) and in the evidence pack, with the number or quote they rest on. The phrase dictionaries are generic and multilingual (PL, EN, DE, CS, SK, RO, HU) and live in `lib/osint/shopSignalsConfig.ts`. The claimed years in business are compared with the date of the first archive snapshot when the record carries it (archive step, section 10); a contradiction gives the flag “years in business contradict the archive”.

**The only new linking trace is the address.** A full address (street, number, postcode, city; normalized, without the flat number) creates a `postal_address` node with weight 0.5. The same address on two shops means a shared template or the same hand, but an address is easy to copy from another shop's footer, and virtual offices rent theirs to unrelated companies, so it links only together with a second kind of evidence (`campaignRules.notAloneKinds`), and the addresses of such intermediaries go on an exclusion list (`lists.postalAddressExclusions`, maintained by hand). A city alone or a PO box is not a trace.

**Infrastructure and domain attributes** (also without weight): TLS certificate issuer (a free certificate is only context: the padlock says nothing about the seller), a certificate issued for another domain or an expired one (from HAR, `securityDetails`), a known brand in the URL path on a domain without that brand (`/inpost/…`), shop platform (WordPress, WooCommerce, Shopify, Shopline, PrestaShop…, added to the page platform attribute), hosting outside the EU and EEA (country from the ASN enrichment, no new queries), rare TLD (a weak signal; a baseline from the CERT Polska warning list is not included), domain name in a different language than the page, redacted registrant in RDAP, a data controller in the privacy policy on a different domain than the contact addresses, inconsistent product range (≥ 3 unrelated categories in a catalogue of up to 50 products, or goods outside the category in the shop's name), reviews without seller replies, a page posing as a courier with a card field and a parcel-locker picker, and a contact-address domain with an MX record that does not answer over HTTP(S) (network run only). We do not score text as “AI-generated”: AI text detectors are unreliable, and the method rejects detectors that judge a single sample.

**Company registers** (`--company-registry`, off by default, live mode only). For valid NIP and KRS numbers from the page, the tool queries the VAT white list and the current KRS extract (`api-krs.ms.gov.pl`, no key needed) and compares the company's name, registered office, status and registration date with the data on the page (flags, e.g. name or address different from the page, company struck off the register, young company). We store only company data, no people. The result is an attribute without weight and links nothing. Numbers from the cases are then sent to an external service, so we do not run this on data whose owner has not agreed to such sending. CEIDG (the register of sole traders) requires an account and a token, so we skip it.

Sources for the feature list: the SekurakTV training “Jak się nie dać oszukać? Sprawdzamy e-sklepy technikami OSINT-owymi” (“How not to get scammed: checking online shops with OSINT techniques”; a quick online-shop audit: [youtube.com/watch?v=URdgnHObeXE](https://www.youtube.com/watch?v=URdgnHObeXE)) and SYNACK Time “Identifying SCAM Store Websites” ([youtube.com/watch?v=EfHzsg-MSJc](https://www.youtube.com/watch?v=EfHzsg-MSJc)).

## 3. Weights

Each trace (an entity, e.g. a specific tracker) gets a weight. The weight is the product of three things:

1. **Feature type weight** (table below): how strongly this kind of trace points to a single operator.
2. **Discount for shared infrastructure and platform features** (a factor from 0 to 1 taken from lists in the configuration): Cloudflare and other CDNs, mass DNS providers, free certificate authorities, popular registrars, URL shorteners, page-builder platforms, public form services. A Cloudflare IP is shared by thousands of unrelated sites, so it weighs about 0.006 instead of 0.6. **Platform features, not operator features** (the `events-stat.js` file, the `/click?key=` link format, lander libraries) are multiplied by 0.1, because every customer of that service uses them. The tracker server from the click ID (`click_server`, the machine in the xid) does not get this discount: it weighs 0.6 (medium evidence, because the same server can serve many buyers), and as the only shared kind of operator trace it is enough for a campaign (rule 4 below). When one trace has several discounts, the smallest factor applies; the factors are not multiplied.
3. **Rarity (`df`, inverse frequency)**: the more samples in the set share the same trace, the less it is worth (down to 0.2 of the weight, and for a trace common to almost the whole set even down to 0.1).

The evidence for one pair of samples is combined with **noisy-OR**: `score = 1 − Π(1 − wᵢ)`. Two independent evidence items of 0.5 each give 0.75. The score grows with each further evidence item but never exceeds 1. An evidence item with weight ≥ 0.7 whose trace occurs in fewer than half of the set is **strong** (see section 4).

### Type weights (source of truth: `typeWeights` in `lib/graph/config.ts`)

The table lists every trace type in the configuration (except `item`, weight 0). Descriptions of every trace are in `docs/CECHY.md` (generated from the code with `bun run features:catalog`).

| Weight | Types |
|---|---|
| 1.0 | `url`, `tracker`, `wallet` |
| 0.95 | `host`, `domain`, `endpoint` (form backend), `crm_key`, `meta_ad`, `platform_campaign`, `c2_host`, `meta_token` (Meta access token, SHA-256 hash only) |
| 0.9 | `email`, `phone`, `telegram`, `shared_doc`, `onion`, `messenger_invite`, `affiliate_account`, `platform_account`, `cloaker_account`, `launcher_account` |
| 0.85 | `path_id` |
| 0.8 | `cert`, `campaign_param`, `bank_account` (not strong: `nonStrongTypes`) |
| 0.75 | `fictional_expert` |
| 0.65 | `cname_target`, `imagehash`, `ad_payer` |
| 0.6 | `advertiser`, `ip`, `hidden_fields`, `comment`, `domain_pattern`, `click_server`, `hosting_account` (account on a video hosting service) |
| 0.55 | `asset` |
| 0.5 | `favicon`, `kit_string`, `company_id` (NIP, REGON, KRS, VAT), `postal_address` (shop address), `lead_flow` (page-builder lead funnel) |
| 0.45 | `comment_block`, `template_phrase`, `overlay_template` (layout of replaced captions in a video), `reused_footage` (source mark of someone else's recording) |
| 0.4 | `mx` (the domain's own mail server; mass mail providers are discounted) |
| 0.35 | `nameserver`, `page_template` |
| 0.2 | `technique`, `profit_claim` |
| 0.12 | `param_schema` |
| 0.1 | `persona` |
| 0.05 | `registrar`, `asn` |

**Strong evidence** is an evidence item with weight ≥ `strongThreshold` (0.7) whose trace occurs in fewer than half of the set and in at most 20 samples (`maxStrongDfRatio`, `maxStrongDf`). Exception: `bank_account` is not strong despite its weight of 0.8.

**Traces that do not link campaigns on their own** (`campaignRules.notAloneKinds`; the trace is an evidence item, but a campaign needs a second, independent kind of evidence): `similar_dom`, `comment`, `asset`, `hidden_fields`, `page_template`, `favicon`, `endpoint` (backend without a client ID), `param_schema`, `comment_block`, `ad_payer`, `scam_brand`, `tracker_host`, `adsense_publisher`, `template_phrase`, `advertiser_name` (advertiser name only), `kit_string`, `company_id`, `bank_account`, `postal_address`, `overlay_template`, `reused_footage`, `hosting_account`, `lead_flow`, `affiliate_team` (the `team_id`+`user_id` pair), `mx`. Names without a counterpart in the table are rule kinds, not node types.

**Traces that link only into a group of similar campaigns** (`campaignRules.familyOnlyKinds`): `technique`, `persona`, `profit_claim`.

Some nodes have their own weights (they override the type weight): domain verification token 0.9 (`tracker`), pair of people 0.35 (`persona`, group only), scam brand 0.45 (`campaign_param`, page-kit trace), AdSense publisher 0.5 (`tracker`, page-kit trace), host from page requests 0.25 (`endpoint`, page-kit trace), domain registration series 0.3. Similarity weights (image 0.6, CLIP image 0.45, text 0.5, page structure 0.45, sound 0.5, voice 0.4) and their thresholds are also in `config.ts`. The table is copied from the configuration; if the two differ, `config.ts` wins.

## 4. Campaign vs group of similar campaigns

The result has two levels:

- **Campaign**: samples most likely run by the same operator. Requires strong evidence.
- **Group of similar campaigns**: campaigns linked by something weaker (the same page template, the same platform, the same persona), but not strongly enough to treat them as one operator. Templates and page kits are bought and used by many operators, so a shared template is a hint, not proof.

**Campaign rules** (`campaignLinkVerdict`, `lib/graph/cluster.ts`):

1. **Strong evidence** (e.g. the same tracker, the same contact address, the same form backend with a client ID) links on its own. Strong evidence is joined with union-find (if A=B and B=C, then A=B=C).
2. A pair score below `minLinkScore` (0.15) does not count.
3. **Account conflict**: two ads on the same page-builder platform but on different accounts are not linked without strong evidence. This kind of conflict wins over content, over the creative file, and even over strong evidence based only on the `path_id` identifier (which is sometimes a lander library shared by many accounts).
4. **Page-kit traces** (template, theme, code comments, favicon, similar page structure, link format) count together as one kind and do not link campaigns on their own. A campaign needs at least one kind of evidence outside the page kit, persona and content (platform account, tracker server, NS, contact…). One such kind is enough if the pair score after discounts and rarity exceeds `minLinkScore` (0.15); `minEvidenceKinds` (2) blocks nothing in the current configuration, which is why the `too-few-evidence-kinds` rule never fires.
5. **Content** (similar text, image, sound, voice): content without infrastructure forms a campaign only with **at least two different kinds of content** (e.g. image and text). The campaign's `basis` field says what it rests on: `infrastructure`, `content` or `mixed`. When any of the samples has infrastructure, content alone does not link.
6. **Creative variant: attach, never merge.** A screenshot with a sticker and no URL has no infrastructure, so it must not contradict an assignment or build a bridge between two campaigns. After the campaigns are built, such a sample joins a campaign with infrastructure if its creative is nearly identical (dHash ≤ 6 bits or CLIP ≥ 0.95) to the creatives of **exactly one** such campaign. With two or more candidates nothing is attached and a group of similar campaigns remains. The result has `basis: "mixed"` and lower confidence. A shared video shot works the same way (a frame with dHash ≤ 6 to a shot from the campaign). **Limitation:** a shot copied from someone else's recording (e.g. a fragment of an interview) can therefore attach a video without infrastructure to a campaign if only one campaign has a similar shot.
7. **Persona works only at group level.** The same public figure appears in ads of many unrelated operators, so a persona does not link campaigns and does not count towards their score.

**Why explicit rules and not HDBSCAN or another unsupervised clustering.** Every edge must be explainable to the person who decides whether to report: “these two samples are linked by tracker X (rare, weight 0.95) and server Y”. A bulk method gives a distance in feature space and a parameter that cannot be defended in front of the recipient. Hence: rules → union-find for strong evidence; **Louvain** (community detection on a weighted graph) for the rest; everything with an explicit list of evidence items.

## 5. Linking traces added after validation (22 Nov 2026)

New kinds of traces that link samples (with a weight from section 3) or change how existing ones are counted. Those that only describe a sample and link nothing are in section 6.

### 5.1 Method fixes after validation (task I10)

Validation on samples outside the reference set showed almost only splits (high precision, low recall). Each change has a general justification, a synthetic test and a description in `docs/TECHNICAL.md` §4.17; numbers before and after: section 12.

**New and corrected linking traces.**
- **A file from the site of a free-hosting account = that account's hosting.** When a page loads its scripts from a subdomain of a platform where each subdomain is one site of one account (`netlify.app`, `pages.dev`, `github.io` …), the host of that site counts as the operator's hosting (weight 0.95 × 0.7, not strong). A buyer of a copied page kit keeps the files on their own domain, and public CDNs are discounted. A host outside this list (ad network, analytics) gives no such trace.
- **Scripts injected by a CDN** (`/cdn-cgi/…`, e.g. Cloudflare email decoding) get a ×0.02 discount: this is a feature of the CDN, not of the operator.
- **Traces from page requests (HAR, scan):** the Meta pixel ID from call URLs, the tracker click ID from event calls, the platform lander folder (`/landers/<uuid>/`) already from a single URL, campaign parameters and the click ID from the page's CTA links (relation 0.8). Hosts outside the page's domain (`tracker_host`, 0.25) are a page-kit trace: they only corroborate, because a list of public services is never complete. Requests of an earlier page in the same browser session and requests from browser extensions of the person who saved the HAR are skipped.
- **Domain verification tokens** (Meta, Google, Yandex; from page code and TXT records) are a trace of one Business Manager or Search Console account: strong (0.9).
- **Ad and campaign IDs from the link:** the Meta ad ID in `utm_content`/`ad_id` is matched with the ID from `fbclid`; `gad_campaignid` (Google Ads) and the traffic buyer's account (`acc=`, `_buyer=`) are strong campaign parameters; the placement (`utm_placement`) is weak.
- **Scam brand** (the name of a product or “platform”, e.g. “Fikcyjnol Forte”, “TradeSynthIQ 4.7”) survives a change of face and domain, but one product is sold by many affiliates: it is a page-kit trace (0.45) and on its own yields at most a group; generic platform names are discounted. The AdSense publisher (`ca-pub-…`) is also a page-kit trace (publisher IDs are sometimes shared).
- **Platform wrapper links** (`l.facebook.com/l.php?u=`, `google.com/url?q=`, `adurl=`) are unwrapped to the target URL, because platform domains have weight 0.
- **Safety nets:** a trace shared by more than 20 samples is not strong regardless of the size of the set (without this, one common trace chains a large batch together); a Louvain community that falls apart into parts without links is split into those parts; stock ad phrases (“dowiedz się więcej” (“learn more”), “tylko dziś” (“today only”)) and transcription hallucinations (“Napisy stworzone przez społeczność Amara.org”, i.e. “Subtitles by the Amara.org community”) do not count towards text similarity; transcription can use VAD (voice activity detection) so as not to write text over music alone; an anti-bot challenge page is a blocked download, not cloaking.

**Extensibility without code changes (`--config`).** A configuration file adds to the discount lists (arrays in `lists` are appended to the defaults) and can pivot on an unknown input column:

```json
{
  "extraPivots": { "page_id": "advertiser" },
  "lists": {
    "domains": [{ "match": "cdn-uslugi.example", "factor": 0, "reason": "service shared by many sites" }],
    "genericScamBrands": [{ "match": "zyskomat*", "factor": 0.2, "reason": "generic platform name" }]
  }
}
```

The value of the `page_id` column then becomes a node of type `advertiser` (key `extra:page_id=<value>`) with the weight, discounts and rules of that type.

### 5.2 The operator as a lead-generation business (task I23)

Public descriptions of the industry (the RIVSEC report “Fałszywe inwestycje w internecie. Schematy działania i zaplecze przestępcze” (“Fake investments on the internet: how the schemes work and the criminal back office”), March 2026, discussed in the Techstorie podcast #157, Wyborcza, 13 Oct 2026) show the operator as a business that buys and sells sign-ups (leads). The landing page has one interactive element, a form (first name, last name, phone), and the data goes live to a CRM. Leads are packaged by country and channel, so every sign-up carries a source ID, and an affiliate network sits in the middle (an “affiliate manager”). This gives the following traces and rules:

- **The affiliate ID and the CRM key link a campaign.** The affiliate, offer and stream ID (`aff_id`, `pid`, `partner_id`, `wm_id`, `offer_id`, `flow_id`/`stream`, `landing_id`, `s1`–`s5`) sits in the URL, in hidden form fields and in the configuration objects of the page's scripts. It is the same `campaign_param` node (0.8) with the origin “from URL / from form / from script”, because the sign-up goes to the CRM with the same IDs as the link. Short, common names (`pid`, `flow`, `s1`, `partner`) count only with a value that looks like an ID (a digit, at least 3 characters), so `1`, `test`, `default` and macros do not link. The click ID (`click_id`, `aff_click_id`) is new on every click and does not link samples. The secret API key with which the form sends the sign-up (`crm_key`, 0.95) belongs to one lead buyer's account: it is as strong as a shared form backend. The tool stores only a digest of the key (the first 4 and last 4 characters plus sha256), never the whole key, and skips keys of public services (maps, reCAPTCHA, analytics), CSRF tokens and short or low-randomness values.
- **A template sentence only supports.** A rare sentence (≥ 6 words) from the page text or from a thank-you message stored in a script (“Nasz opiekun zadzwoni do Ciebie …”, i.e. “Our adviser will call you …”) present on at least two domains is a `template_phrase` (0.45). The same template is bought by many operators, so it is in `notAloneKinds`, like the page template and the comment block. A shared slip in a sentence (a repeated three-word string, a word mixing Latin and Cyrillic letters) is rarer than a correct sentence and weighs 1.3 times more, but stays below the strong-evidence threshold. GDPR consents, cookie notices, footers and risk warnings are skipped.
- **An example number in a form is a template, not a phone.** A number from a `placeholder`, from the value of a phone field, from a label or from a hint such as “np. …”, “na przykład …”, “format …” (“e.g. …”, “for example …”, “format …”) is copied with the template onto every page. It does not create a `phone` node (0.9), only a template trace (`page_template`, key `phone_example:`). Obviously artificial numbers (only repetitions, `123456789`) are neither a phone nor an example.
- **The ad account name only supports.** Ads run from hijacked accounts paid with the cards of earlier victims (e.g. the account of a guesthouse), so the advertiser name often belongs to a victim. A name without an account from the ad library (rule kind `advertiser_name`) is in `notAloneKinds`, like the ad payer. A stable account ID from the ad library links as before. An investment ad from an account named like a local business or a private person gets the attribute “ad account probably hijacked (name does not match the content)”, and its name gives no trace.
- **A persona does not split a campaign.** The operator runs A/B tests of faces (actor or politician, deepfake or not), so the persona changes within one campaign. A persona is only a group feature: different faces with the same form backend are one campaign; the same face on different infrastructure is two campaigns, at most in one group.
- **Profit amounts describe the scenario.** Plausible amounts with a period (“3 tys. w ciągu dnia” (“3k in a day”), “4000 zł tygodniowo” (“4000 zł a week”)) from the text, page, OCR and transcript form the `profitClaims` attribute. The set of amount-and-period pairs (`profit_claim`, 0.2) links only into a group (`familyOnlyKinds`). The standard deposit (250 USD/EUR, “minimum deposit”) stays in the attribute but not in the trace.

| Trace | Weight | Rule |
|---|---|---|
| `campaign_param` from a form or script | 0.8 | like a URL parameter; `click_id` gives no trace |
| `crm_key` (digest of the CRM API key) | 0.95 | links on its own |
| `template_phrase` (template sentence, ≥ 2 domains) | 0.45 (with a slip ×1.3, max. 0.65) | `notAloneKinds` |
| `page_template` from an example number | 0.35 | `notAloneKinds` |
| `advertiser` from the name alone | 0.6 | `notAloneKinds` (`advertiser_name`) |
| `profit_claim` (amount + period) | 0.2 | `familyOnlyKinds` |

On the 25 reference cases the pair F1 did not change (0.897, 14 campaigns); one group of similar campaigns grew by a campaign linked to it through an example number from the same form template (numbers: I23 report).

### 5.3 Text fingerprint (task I25)

Page texts circulate between operators: the same made-up comments, the same “related articles” bar and the same trap code end up on pages of different accounts and trackers. So text points to a text supplier or a page kit, that is at most a group of similar campaigns. A campaign always needs a second, independent operator trace.

- **A message from a kit script (`kit_string`) links a page kit.** Kit scripts carry developer messages (console log, error, warning), often with a typo. The same message on pages of different products is a fingerprint of the tool, almost as specific as a file hash. But many operators use the tool, so `kit_string` (0.5) is in `notAloneKinds` and counts towards groups. A pair of pages gets one evidence item when it shares at least two messages or one long one (≥ 5 words); each message must occur on at least two registrable domains, and rarity uses the usual IDF with `maxPivotDf`. We read scripts inlined in the page and the page's own external scripts (the same registrable domain, from HAR or from the `_files` folder of a saved page; in online mode GET only, without execution). We do not fetch scripts from other domains.
- **Platform text mask.** A page-builder platform ships one SDK file for all accounts, and a framework ships the same runtime code on every page. Without a mask, such text would glue together all pages of the platform. Therefore (a) strings from scripts with SDK paths, framework bundles and known libraries are never a text trace; (b) a template sentence or message present on pages of at least 5 different platform accounts or on at least 30% of the pages in the set (from 10 pages up) is platform text; (c) a script with a dictionary of the same message in at least 5 languages is interface localization: the page gets the `localizedUi` attribute (language codes), and strings from that script create no traces.
- **Captions burned into video (B-305, `videoOcrText`).** A video frame is sampled every 2 s (up to 30 frames and 60 s) and read whole by OCR (`pol+eng`); unique lines are kept, without short junk and player captions. The text (“from video captions”) joins the sample's machine text: narrative, promised profit, people and text similarity. It is an attribute, not a separate linking trace.
- **No conclusions about the author.** Language, typography and traces of translation can describe a sample, but they do not indicate the author's nationality or identity: templates are translated, copied and corrected by different people, so they serve only as a description.

| Trace | Weight | Level |
|---|---|---|
| `kit_string` (≥ 2 shared messages or 1 with ≥ 5 words, ≥ 2 domains) | 0.5 | `notAloneKinds`: page kit, a campaign needs a second trace; links a group on its own |
| `template_phrase` after the platform mask | 0.45 (with a slip max. 0.65) | `notAloneKinds` |
| `localizedUi` | none | attribute |

On the 25 reference cases the campaigns and pair F1 did not change (0.897, 14 campaigns). `kit_string` gave 4 links; one of them added a third group of similar campaigns made of two cases that had no pair in the working labels. The number of `template_phrase` links after the mask stayed the same (17), because the template sentences in these cases come from page text, not from an SDK.

### 5.4 Page-builder record fields: cloaker and launcher (B-331, B-345)

The page-builder platform stores visit macros in `window.aio.visit.fields`. Some of them describe the operator, not the visitor:

- `cloaker_account` (weight 0.9, like Telegram): the `cl_domain` + `cl_sid` pair of a cloaking service that serves many pages. `cl_sid` is the cloaker's customer number, `cl_domain` is the cloaker host that serves it. The same pair is one paid customer account, i.e. one operator, as concrete as a contact channel. `cl_sid` alone does not link (numbers repeat across cloaker hosts), and neither does the domain alone (one host serves many customers): both values then go only into the sample's attributes. `cl_did` is a visit or device ID: an attribute, no weight. `cl_clid` (the analyst's click) is redacted together with the rest of the visit data.
- `launcher_account` (weight 0.9, like a page-builder account): the UUID from `visit.fields.launcher` (or `visit.launcher`). On 11 of the 12 pages with this field in the reference set, the launcher equals `owner_uuid`, i.e. it is the same evidence as `platform_account`. In that case no second trace is created (we do not count one piece of evidence twice), and the sample only gets the `launcherSameAsOwner` attribute. Without `owner_uuid` the launcher replaces the owner (`platform_account`, like the `launcher=` parameter in platform links). A separate node is created only when the launcher differs from the owner: that is the account from which the ads were launched, independent of the account that owns the pages.
- The 16-digit ID in `fb_campaign_name` (e.g. “PL(PL) - Name - 1234567890123456 - 2”) goes to `campaign_param` with the key `fb_campaign_name_id=<id>` (weight 0.8). The key is separate, not `campaign_id`, because it is not known whether it is a campaign ID or an ad account ID.

Limitation: a launcher that differs from the owner on one page and the same UUID as `owner_uuid` on another page are not linked through this node (different types). There is no such case in the reference set.

### 5.5 Contact identifiers and documents from investigative practice (task I28)

Source: transcripts of investigative podcasts (OSINT Podcast https://www.youtube.com/@OSINTPodcast, Fraud Forward https://www.youtube.com/@FraudForward) and the feature catalogue built from those episodes. Almost everything from there is a **sample attribute**: it explains in the browser and in the evidence pack what type of scam this is and why, but links nothing. Only contact identifiers and documents link.

**What links** (trace kinds weighted like Telegram, 0.9: they point to an operator's account or resource; rarity through IDF and `maxPivotDf` like any other trace):

- `shared_doc`: a document, spreadsheet or form (Google, Notion, Microsoft Forms, Typeform, Jotform) and a shared conversation with a language model (service `llm_chat`: the operator pastes campaign data into a chat and shares the link). Key `service:identifier`. Example IDs from provider documentation and help pages are skipped (list in `lib/osint/contactConfig.ts`).
- `onion`: a version 3 .onion address. Version 2 addresses expired in 2021, so they are only an attribute (`onionV2`).
- `fictional_expert` (B-313): a `dr` or `prof.` title with a first and last name not in `data/osoby-publiczne.json` (page text, ad, OCR, ASR). Key: the title and the first and last name in lower case, without Polish diacritics and inflectional endings; typos (edit distance ≤ 1, ≤ 2 for long names) are merged. Weight 0.75, rarity through IDF and `maxPivotDf`. A fictitious expert is invented by one operator, so it links.
- `c2_host` (B-333): the host of the server to which a script of a copied page kit (e.g. a fake library on free hosting or in jsDelivr `gh/`) sends cookies or login data from a fake tracker panel. Both are required together: a check of the `/admin` or `/panel` path and sending `document.cookie` or password fields to a foreign host; an ordinary library gives nothing. Sample attribute: `stealerKit` (which signals fired). Weight 0.95.
- `messenger_invite`: invitations and accounts on Discord, Signal, Viber and Line (`service:identifier`); a number from `wa.me` is an ordinary phone. Community servers of the platforms themselves are skipped.
- `affiliate_account` (B-330, weight 0.9): an affiliate network partner account from an order link (`click.php?team_id=…&user_id=…`), from the decoded `referer` parameter (base64) or from hidden form fields. The key is the kind, the network host (the link host or the form action host) and the value: `stream_id` and `offer_uuid` link on their own; the `team_id`+`user_id` pair consists of small numbers, so it has a relation of 0.7 (below the strong-evidence threshold) and the rule kind `affiliate_team` in `notAloneKinds`. Without a host nothing links. `api_key` goes to the `crm_key` node only as SHA-256. `sub1`, `sub2`, `x_id`, `sid`, `cid` are node attributes.

The sources are the page text and attributes, the ad text, screenshot OCR and request URLs from HAR. None of these addresses is opened: they are the operator's resources, and the tool only reads the record.

## 6. Attributes that do not link (22 Nov 2026)

These features appear in the sample card, in the campaign description and in the evidence pack, but they have no weight in the graph and link nothing. Shop and infrastructure attributes are in section 2 (“Shop signals”).

### 6.1 Narrative, brand on the creative, people and other attributes (task I10)

**Attributes of a sample, campaign and group (never campaign evidence, no risk score).**
- **Narrative:** topic (investment, subsidy, health with subcategories, gambling, elections, “AI-powered investing”, gold from the NBP (the Polish central bank), war and raw materials, “secret”, “teenager made a fortune”, fund recovery, events: World Cup, swearing-in, “state investment”), form of the lure (fake sensational news, recommendation, fake interview), amounts, date of the sample. Campaigns and groups have a narrative summary, and a campaign on one infrastructure that changes topic within a week gets the description “same operator, two narratives”. The IHC rule label (`celeb_bait_investment`: a person from the list plus a promise of profit, an invitation to a group or a fake media outlet) is an attribute. The evidence pack takes the “financial service” from the narrative, with a quote and the note “(inference)”.
- **Impersonated brand on the creative** (CLIP zero-shot on a list of about 20 portals, banks and institutions) and **groups of people** from the list of public figures (e.g. “Dziennikarze”, journalists) are group features. A **pair of people** in one sample (a fictional conversation between two well-known people) is rarer than one person, so on its own it creates a group of similar campaigns, but never a campaign.
- **Bridge and weakest link:** a campaign held together by a single strong trace between two subgroups has a `bridge` field (“campaign held together by a single trace: X”, a candidate for the discount list), and `minInternalScore` shows the member that hangs closest to the threshold.
- **Age of the domain and of its first certificate** on the day the sample was first seen, **page platform** (e.g. page-builder platform, tracker; an attribute only, with no group, because a platform has thousands of unrelated customers), **number of ads taken down by the platform**, **input columns outside the mapping** (“input data”).

### 6.2 Techniques, phone number types and narratives from investigative practice (task I28)

**What only explains** (attributes, no weight; techniques count only for groups of similar campaigns, like other techniques):

- Page techniques: fake security alert with a phone number (`fake_security_alert`: alert + number as the only way out + a mechanism that keeps the user on the page), remote desktop software (`remote_access_tool`), fake verification with a command to paste (`clickfix_paste`). From a ClickFix command we store only its kind and a SHA-256 hash (the command is a malware payload); the hash is not a linking trace, because no trace kind is a “kit” that would match the command.
- The domain shown in the ad differs from the landing page (`displayedDomainMismatch`, with a known-brand flag).
- Phone number type (`phoneLines`: mobile, landline, toll-free, premium-rate, VoIP) from the local `libphonenumber-js` metadata, without sending the number to any service, and the flags `phoneCountryMismatch` and `tollFreeOnAlert`. **The weight of the number does not change**: VoIP and app numbers are sometimes disposable, so the phone weight rests on the rarity of the number (IDF), and the type is only an explanation.
- An address that imitates another (`idnConfusable`: a character similar to `/`, `.`, `-` or mixed alphabets in one label), the weekday and hour at which the ad started, from the ad library (the distribution within a campaign describes the operator's rhythm), and the creation date of a Discord server or account from the ID in the link (“creation clock”).
- Narratives and hooks: topics of fake tech support, overpayment refunds, fund recovery offers (a secondary scam targeting victims), job offers, impersonated authorities; hooks of secrecy, a fee before payout and threats of account blocking.

**Caveats from the sources.** The caller's number and the number in a form do not prove identity (number spoofing, apps). A shared kit or a “fraud as a service” platform does not prove a single operator. The absence of typos is no longer a sign of legitimacy, because language models write the texts. A screenshot of a balance on a “platform” does not prove the account balance (DOM editing).

## 7. Borderline cases and hard negatives (22 Nov 2026)

These are two ways of checking that the tool does not glue campaigns together on similarity alone.

### 7.1 Borderline cases: deliberately not linked (task I20)

**What a near-miss pair is.** A pair of ads that are similar to each other, but which the method deliberately did not link into one campaign. Each such pair has, in the report, the rule that blocked the link and a description of what was missing. The report does two things. It shows that the method guards against false links: a shared person in the ad, a popular template, a shared platform, CDN, registrar. And it gives a list of cases to review when a pair's score lies close to the threshold. The report only records decisions that the method makes anyway: it does not change weights, thresholds or rules, and the campaigns and groups come out identical to those before the task (checked by comparing `campaigns.json` on the synthetic set and on the 25 cases).

**When a pair goes on the list.** It is not in one campaign, it does not come from one case, and it meets at least one condition: the pair score is ≥ half of the linking threshold; the pair has a shared trace of a strong type that was discounted (e.g. a domain of a shared CDN); its campaigns lie in one group of similar campaigns, while the pair itself is not in a campaign. The half-threshold and the limit on the number of pairs (200 by default, highest scores first) are in the configuration (`nearMiss`).

**Rules (identifier, meaning):**

- `below-min-score`: the pair score is below the linking threshold.
- `family-only-kind`: the score comes from traces that link only into a group (person in the ad, page technique); without them the pair is below the threshold.
- `account-conflict`: the ads are on different accounts of the same page-builder platform; the platform gives its templates and libraries to all accounts.
- `discounted-only`: the only shared traces are infrastructure used by many sites (CDN, popular registrar, platform); nothing is left once the weight is lowered.
- `kit-only`: the ads are linked only by a page kit (template, theme, comments, structure), which many operators buy and copy; there is no operator trace.
- `content-only-with-infra`: the ads are linked only by content, and one of them has its own infrastructure that the other does not share.
- `too-few-content-kinds`: ads without infrastructure are linked by one kind of content, and a campaign needs two.
- `too-few-evidence-kinds`: the shared traces have too few different kinds to count as corroborated (by default this rule never fires, because one kind outside the page kit and content is enough).
- `split-by-clustering`: the rules allowed the ads to be linked, but partitioning the link network into campaigns (Louvain) put them in different campaigns.

**Numbers from the run on the 25 cases (28 records, 14 campaigns, 3 groups of similar campaigns; by rule):** 52 near-miss pairs, of which `below-min-score` 37, `kit-only` 9, `account-conflict` 4, `family-only-kind` 1, `discounted-only` 1; other rules 0. Pairs that our labels put in one campaign but the method split apart (candidates for a false split): 0. This agrees with the pair recall of 1.0 in the evaluation of this run. For `kit-only` and `account-conflict` the method worked as intended (a shared page kit or platform account, not an operator). The `below-min-score` pairs have scores from 0.06 to 0.12 (threshold 0.15) and are linked mainly by weak traces (operator network, page technique, tracking-link layout); for review it is worth taking the highest scores under this rule.

**Where to see it.** `near-misses.json` next to `campaigns.json` (written by every `build-graph`), the “Deliberately not linked” tab in the browser, and the `nearMisses` field and the `blisko_bez_polaczenia` column in the result of analyzing a new sample. Format: `docs/TECHNICAL.md`, §5.6.

The near-miss pairs from this run went into the set of hard negatives from real samples (section 7.2), where we check that the tool does not glue them into a campaign.

### 7.2 Hard negatives from real samples (task I21)

**Why.** The most common error of tools of this type is a false merge: two samples from different operations end up in one campaign because they use the same lure. Earlier hard-negative tests were synthetic only. Now we have a set of pairs from real samples (the 25 reference cases and 212 validation samples) and a permanent test in the repository that none of them ends up in one campaign. A group of similar campaigns is allowed.

**Six lure categories** (a pair can have several):

1. the same person in the ad (from the list of public figures);
2. the same theme or narrative (investment, media interview, health, casino, shop offer: keywords);
3. similar text or image (a similarity edge in the graph, CLIP, pHash) without shared full-weight infrastructure;
4. a shared discounted trace (CDN, platform, site builder, registrar, NS, JS library, generic campaign parameter);
5. domains registered on the same day or lexically similar;
6. empty page, download error, cloaking or parked page.

In addition, as a separate source, the near-miss pairs from section 7.1.

**Selection method.** We take pairs from different campaigns according to the labels (our labels for the 25 cases, validation labels for the rest) and keep those that meet at least one category. Selection starts from the hardest, i.e. from the highest pair score in the graph, with a limit of pairs per category and per sample and a cap on the share of one pair type. **The label “different campaigns” must have a basis.** If both ads share a full-weight operator identifier (page-builder account, click server, tracker or registered domain), then by the definition of our labels it is the same campaign. Such a pair goes to “uncertain” and does not count as a negative. Otherwise the basis is different identifiers of the same type (“other accounts”, “other domains”) or just different labels. In categories with fewer than three real pairs we add **derived** pairs: we take a real case and swap one layer so that it becomes a different operation with the same lure. For example the same content and person with a different form backend and a different account, or the same site builder and CDN with different content and a different tracker. Derived pairs are counted separately. The measurement has two parts: the pair's outcome in the shared graph (merged, group only, separated) and leave-one-out, i.e. sample A analyzed as new against a base without its whole case.

**Result (real pairs, code after task I20; a pair with several categories counts in each):**

| category | pairs | merged | group only | separated |
|---|---|---|---|---|
| the same person | 6 | 0 | 0 | 6 |
| the same theme | 28 | 0 | 12 | 16 |
| similar text or image | 9 | 0 | 8 | 1 |
| shared discounted trace | 65 | 0 | 20 | 45 |
| similar domains | 7 | 0 | 4 | 3 |
| empty page | 31 | 0 | 10 | 21 |
| near-miss pairs (4e) | 52 | 0 | 12 | 40 |
| **total (unique pairs)** | **97** | **0 (0%)** | **25** | **72** |

Leave-one-out gives the same: 0 merges. Before the basis of the labels was checked, 25 of the 104 selected pairs were merged. All 25 turned out to be pairs without a basis: a shared page-builder account with a validation label that says only “account outside known campaigns”, an archive copy of a case without its own label, a variant of a known campaign recorded under a different label notation, two subfamilies of one domain. Among 200 pairs without a basis the tool merges 51, always through a shared platform account or a shared domain, i.e. in line with the definition of a campaign.

**Derived pairs:** 18 (3 in each category), 5 merged. One is a generator error: the variant kept the value of a campaign parameter in the form, and that is a strong operator trace. We exclude this pair from the test. Four are known weaknesses of the method:

- **similar text + a domain the page only links to (1 pair).** A copy of the page with the same template sentences links to the same domain as the original (button target, the offer seller's checkout). The domain from the link has a relation of ×0.4 and after multiplication exceeds the discounted-trace threshold, so it counts as an operator trace and, together with the page kit, forms a campaign.
- **two empty pages on one IP address that is not on any list (3 pairs).** One kind of operator trace is enough for a campaign, and a shared hosting IP looks the same as the server of a single operator.

**Repeated on commit `a407767`:** real pairs 100 (3 new near-miss pairs), merged 0, also in leave-one-out. Derived pairs: 11 of 18 merged. Six of them (persona, three from theme, two from domain) share a Meta access token: the derived-pair generator was written before this feature was added and does not swap the token, and a shared token is an operator identifier, so this is a generator artefact, not a tool error. Five are weaknesses of the method: the four described above (domain from a link, three empty pages on one IP) and one new one: two pages with the same **fictitious expert** and the same page-kit messages form a campaign (the fictitious expert has weight 0.75 and counts as an operator trace, but it may be a lure copied between operators). On this code, the generator already separates the pair with the campaign parameter in the form.

**Proposed fixes checked without code changes** (`--config`): a link relation of ×0.3 removes the first merge, but splits a pair of one campaign from the 25 cases that rests on the same pattern. IP and autonomous system as traces that do not link on their own remove the empty-page merges, but break 299 of 878 correct validation pairs. The autonomous system alone or the IP alone do not remove the merges. No fix met the condition “removes the merge and changes no correct assignment”, so `lib/graph/config.ts` stays unchanged. The four known merges are marked in the test as expected failures (`it.fails`). Solving them needs new data, not weights: the number of domains on an IP address from passive DNS, and telling link targets apart (the operator's own lander or a service with many customers).

**Test in the repository.** `tests/hardNegatives.real.test.ts` with `tests/fixtures/hard-negatives-real.json`. The file contains 114 pairs: 97 real and 17 derived. Only the structure of each pair remains: types of shared traces, weight, discount, strength, similarity, whether the ad has infrastructure, and the platform account replaced with a constant. There are no domains, IDs, names or texts in the file (checked with the leak scanner). The test checks that no pair ends up in one campaign, and that pairs that form a group through their own link alone (33) end up in one group of similar campaigns. Caveats: the labels are ours, the theme and empty-page categories are detected by simple rules, and the percentage refers to the selected, hardest pairs, not to all possible ones.

## 8. Duplicates and “insufficient data”

An **exact duplicate** is the same ad collected a second time. We recognize it **only** by: the same image (dHash ≤ 4 bits and a matching pixel sample), the same video (the same file by SHA-256, or CLIP frames ≥ 0.97 together with the same audio over the whole length), the same ad ID, the same page URL with an identical template, or identical page content (SHA-256 of the saved HTML). A case all of whose files (HAR, HTML, screenshots, video) are already in an earlier case of the same batch with the same SHA-256 is also a duplicate, even when that earlier case has additional files. The same text is not enough, and the same video with a different intro is a variant, not a duplicate. A duplicate gets the campaign of the original.

**“Insufficient data”** (`insufficient`, the `missing_data` field in CSV) appears when the sample has no URL, no ID, not even 5 words of content, and no link above the threshold. The result lists what to add (e.g. “a screenshot with the address bar visible”). An ad with a platform form (Lead Ads, the words “Formularz” (“Form”), “Wyślij” (“Send”), “Instant Form” in the text or OCR) has no landing page, so instead of a link it gets a request for the ID from the Ad Library, or for a link to the advertiser's page and a screenshot of the form. It is better to refuse an assessment than to guess.

## 9. Assigning a new sample, and thresholds

A new sample goes into one graph with the known ones and gets one of the verdicts: `known_campaign`, `similar_campaigns` (a new campaign similar to known ones), `new_campaign`, `duplicate`, `insufficient`.

Thresholds (all in `config.ts`; the default profile is `DEFAULT_LINK_CONFIG`; a `--config` file only appends to lists and overrides fields):

| Threshold | Value | Rationale |
|---|---|---|
| `minLinkScore` | 0.15 | below this a pair score is noise; a persona alone (0.1) does not exceed it |
| `strongThreshold` | 0.7 | strong evidence; below 0.65, IP and advertiser would start merging campaigns |
| `familyMinScore` | 0.3 | a group of similar campaigns needs a stronger link than a single trace |
| image, `imageHamming` | 10 bits out of 64 | duplicate ≤ 4, variant ≤ 6, different creatives in the reference set ≥ 16 |
| text, `tfidfThreshold` | 0.5 | rewording of the same words; full paraphrases need embeddings (0.86) |
| page structure, `dom.hamming` | 6 bits | |
| CLIP image | cosine ≥ 0.9; the same video file ≥ 0.97 with the same audio | threshold not calibrated on data |
| face (persona, `--faces`) | weighted cosine ≥ the measured threshold (docs/TECHNICAL.md), group feature only | threshold measured on photos of people not on the list |
| voice (linking samples, `similar_voice`) | cosine ≥ 0.6 | same speaker 0.86–0.93, different speakers ≤ 0.34 on test recordings |
| voice (persona from the gallery, `--speaker`) | window cosine ≥ 0.5, lead of ≥ 0.15 over the second person, at least 2 adjacent windows, group feature only | threshold measured on recordings of 11 people not on the list (docs/TECHNICAL.md, section “Persona z głosu”, persona from voice) |

The old “loophole” `singleKindMinScore` (0.5: a single kind of evidence with a high score formed a campaign) was removed in I14c: it let two clones of a portal become one campaign.

**`confidence` and `score` are evidence strength, not probability.** `score` is the noisy-OR result from the formula above. `confidence` (`certain`, `likely`, `uncertain`) means: `certain` when the best link has strong evidence (weight ≥ 0.7), `likely` when the link score is ≥ 0.5. Neither was calibrated on a set with true labels, so “0.8” does not mean “an 80% chance that this is the same campaign”.

<a id="91-harmonogram-skanów-i-baza-rośnie"></a>

### 9.1 Scan schedule and “the base grows”

**Schedule.** On every cycle `bun run watch` asks public sources (CT logs, ad libraries, urlscan, the CERT Polska warning list) for new URLs and runs each one through the same analysis as a manually reported sample (section 9); the result goes to `data/watch.jsonl`. The search recipes rely on strong features of known campaigns (page-builder tenant, IP address outside CDNs, path ID, asset hash, pair of name servers, registrar, registration time), and a candidate is confirmed by infrastructure, not by the page title or the domain name alone: a CT candidate becomes `confirmed` only with at least two kinds of shared infrastructure (the same NS pair, registration time within the campaign window, the same IP address, the same content hash). A value seen in one campaign and in another (a registrar's default name servers, shared hosting) is not a feature of either and confirms nothing. The CERT Polska warning list is used only with a mandatory RDAP/NS filter (registrar, registration time, NS pair): the name pattern alone gives hundreds of false hits. A source that cannot be queried (no network, key or stream) leaves the reason for skipping it in the cycle report. The `campaign` row for a verdict other than `known_campaign` is the nearest campaign by name fingerprint (a hint about the source), not an analysis result.

**The base grows.** Analysis adds nothing to the base; that is done only by `--add-to-base` (CLI), `watch --add-to-base` (schedule, by default only `known_campaign`) and the button in the browser. We append the record and the enriched data the comparison used, without recomputing features; the graph and campaigns are rebuilt offline. A duplicate is not appended, and “insufficient data” only when forced (`--force`), because a sample that cannot be compared does not help the next ones. Campaigns keep their numbers: a new cluster gets the number of the old campaign with which it shares the most records, and a cluster without a predecessor gets a new number; this way a case, a report or a reference to “K07” does not change meaning after a sample is added. Before saving, the previous base files go to `<base>/historia/<time>/`, every addition has an entry in `<base>/dodane.jsonl` (time, source `cli`/`watch`/`gui`, identifier, verdict at the moment of adding), and files are replaced by renaming a temporary file. Automatic adding from the schedule has one drawback: a wrongly assigned sample stays in the base and affects later results, so `historia/` lets you go back to the state before the change.

<a id="92-korekty-analityka-correctionsjson"></a>

### 9.2 Analyst corrections (`corrections.json`)

The analyst does not edit the graph by hand. They record decisions in the `corrections.json` file (by default next to `campaigns.json`, `build-graph --corrections file.json`; in the browser, the buttons next to a link and a trace write this file through `/api/corrections`), and `build-graph` applies them on the next run. Three kinds of decisions (`lib/graph/corrections.ts`):

- **Link (`mustLink`)**: two samples belong to one campaign. A strong link is created with the evidence item “analyst decision”.
- **Split (`cannotLink`)**: two samples must not be in one campaign. The direct link is cut, and if other links still hold them together, the links between the two sides of the campaign are cut (each member goes to the side it is closer to) until the split holds. A split wins over a link.
- **Disabled trace (`disabledPivots`)**: a shared trace (a node identifier, e.g. a domain) stops counting as evidence, e.g. when it turns out to be shared infrastructure.

Every link changed by a decision stays in the graph with the note “analyst decision: …”, and the campaign the decision concerns lists it in `analystNotes` (visible in the browser). File format and API route: `docs/TECHNICAL.md`, §5.8.

## 10. Niekompletne dane

- **Martwa strona**: gdy jest tylko zrzut z paskiem adresu, domena z paska staje się adresem; cechy pochodzą z nagranych odpowiedzi DNS/RDAP (lub z zapytań, jeśli włączono `--lookups`).
- **Sam zrzut** bez adresu: zostają obraz, tekst z OCR i identyfikator biblioteki reklam, jeśli jest widoczny. Przypisanie opiera się wtedy na kreacji, więc werdykt to zwykle wariant (niższa pewność) albo „za mało danych”.
- **Brak RDAP**: znika seria rejestracji i data utworzenia domeny; reszta cech działa.
- **Kroki pominięte** (brak narzędzia, modelu, sieci, pliku) mają w wyniku status `skipped` i powód (`steps` w JSON, `base.json` w bazie). Nigdy nie są pomijane po cichu. Dotyczy to także całej sprawy, której import nie zamienił w rekord (np. zapisana strona bez adresu, gdy żaden HAR nie pasuje, albo plik, którego nie da się odczytać lub sparsować, jak ucięty HAR): ma wpis `skipped` z powodem w JSON, a w CSV wiersz `insufficient` z tym powodem w `missing_data`, więc materiał nie znika z wyniku partii. To samo dotyczy uszkodzonego wiersza pliku JSON/JSONL przy `--dataset`. Jeden uszkodzony plik albo wiersz nie przerywa partii: pozostałe sprawy są analizowane normalnie.

### Strony niedostępne

Dla adresu, którego strona nie odpowiada (błąd sieci, NXDOMAIN, 4xx/5xx albo plansza blokady lub parkingu), z opcją `--archive` narzędzie szuka publicznej kopii. Kolejność źródeł: **materiał** (zapisana strona, HAR) → **pobranie na żywo** (tylko z `--live`) → **urlscan.io** (istniejące skany tej samej strony) → **Internet Archive** (Wayback). Kopia bez kodu strony (urlscan bez klucza: lista żądań i hashe zasobów) ustępuje kopii z kodem z kolejnego źródła. Krok jest pasywny: nic nie zleca ani nie zapisuje, a bez sieci jest pomijany z powodem.

Każda kopia w wyniku ma źródło (`urlscan`/`wayback`), adres kopii, czas kopii i czas zapytania, a jej cechy są oznaczone `bodySource`; treść z archiwum nigdy nie udaje strony pobranej na żywo (lista kompletności pokazuje „kopia archiwalna” jako ostrzeżenie). **Kopię sprzed rejestracji domeny odrzucamy**: domeny oszustw bywają rejestrowane ponownie, więc kopia starsza niż data rejestracji z RDAP (a bez niej niż najstarszy znany certyfikat z CT) to dawna treść innego właściciela i nie może łączyć kampanii. Odrzucamy też kopię starszą od pierwszego wystąpienia materiału o więcej niż `archiveMaxAgeDays` (domyślnie 30; `lib/osint/archive/config.ts`). Odrzucona kopia zostaje w danych materiału jako informacja z powodem, nie wchodzi do cech, a przy porównaniu z RDAP domena dostaje atrybut `reRegistered`. **Kopia archiwalna nie zmienia wagi dowodów**: zasila te same cechy co zapisana strona (kod strony → szablon, backendy, zasoby; lista żądań → zasoby i hosty jak z HAR) z tymi samymi wagami i regułami. Martwy adres bez kopii w żadnym źródle, bez treści i identyfikatorów, daje „za mało danych” z powodem „brak strony i brak kopii archiwalnej”.

Na dwóch materiałach z kopią w Wayback wynik z samej kopii miał te same rodzaje pivotów i ten sam werdykt co wynik z katalogu; kopia urlscan bez klucza traciła pivoty z kodu strony (zob. TECHNICAL §3.2).

## 11. Cloaking

Metodą jest wyłącznie **wykrywanie pasywne po sygnaturach w zebranych danych**: analiza zapisanych stron i HAR pod kątem sygnatur skryptów cloakera w kodzie strony (cecha `cloakerInSource`) oraz tego samego adresu zapisanego z różną treścią (osobne zapisy `#capture`). Nie wysyłamy żadnych dodatkowych żądań.

Opcja `--cloaking` (dwa dodatkowe pobrania z różnymi User-Agentami: crawler platformy i przeglądarka mobilna) istnieje, ale jest **domyślnie wyłączona** i nie jest metodą. Gdy jedno z tych pobrań trafi na stronę wyzwania antybotowego (np. „Just a moment…”), wynik to „pobranie zablokowane przez ochronę przed botami”, a nie podejrzenie cloakingu. Test po User-Agencie nie dowodzi braku cloakingu po IP i geolokalizacji: różnica treści coś wskazuje, jej brak nic nie wyklucza.

## 12. Walidacja i ograniczenia

**Progi, reguła faviconu i lista person zostały dobrane na tych samych 25 sprawach próbki referencyjnej.** Wynik na tej próbce (w chwili zadania I14: precyzja i F1 par = 1,0, 14 kampanii, 2 grupy podobnych; stan aktualny w ramce niżej) pokazuje, że metoda jest spójna z naszym rozumieniem tych spraw, a nie że sprawdzi się na nowych. **Stan aktualny:** wszystkie pomiary z tego punktu powtórzyliśmy jednym przebiegiem na commicie `a407767` (tabela niżej). Opisy etapów pośrednich zostają dla historii metody; przy rozbieżności obowiązuje tabela.

**Etykiety (które materiały należą do jednej kampanii) są nasze**: nie istnieją polskie zbiory z etykietami kampanii, z którymi dałoby się je porównać. Na danych syntetycznych wynik jest z założenia bliski 1,0: zbiór zaprojektowaliśmy sami.

### Na jakim kodzie, z jakimi wagami i na jakiej bazie

Jeden przebieg 22.11.2026, 11:20–11:44, bez sieci, na commicie **`a407767`**. Kod łączenia (`lib/graph`, `lib/osint`, `lib/pipeline`) jest w nim taki sam jak w `74d54de`, czyli w stanie repozytorium na termin (10:54); różnice między nimi to komentarze, przykłady w testach i opisy cech. Baza: 25 spraw próbki (28 rekordów) zbudowana od zera tym kodem (przebieg `v-a407767`; DNS, RDAP i ASN z zapisanych wyszukań, bez sieci). **Wagi:** wbudowane z `lib/graph/config.ts`. Skrypty pomiarów podają `--config linking-default.json`, ale ten plik to pusty obiekt `{}`, czyli brak nadpisań; leży w paczce danych niepublicznych w `pomiary/linking-default.json`. Skrypty i pełne raporty: paczka, katalog `pomiary/` (tabela „Które liczby skąd”).

| Pomiar | Wynik na `a407767` | Wcześniejszy pomiar (commit) |
|---|---|---|
| 25 spraw: F1 par / B-cubed F1 / ARI | 0,8974 / 0,9672 / 0,8858 (precyzja par 0,814, czułość 1,0; 14 kampanii) | to samo (cb7aedb, ecbcd35, 1efb3f4) |
| zgodność z ręcznym łączeniem MUSI / POWINNO | 28/28 / 18/24 | 28/28 / 12/24 (ecbcd35) |
| próbka syntetyczna: precyzja, czułość, F1 par | 1,0 | 1,0 (cb7aedb) |
| symulacja ukrytego zbioru (leave-one-out) | 23 z 25 trafnie (14 z 16 z parą, 9 z 9 bez pary), 0 w złej kampanii | 23/25 (ecbcd35, 1efb3f4); 20/25 (817f9bf, błąd importu) |
| celowe zmiany prawdziwych spraw | 137 wariantów, 0 fałszywych sklejeń | 134, 0 (817f9bf) |
| parafrazy treści | 36 z 36 zgodnych z oczekiwaniem | 36/36 (817f9bf) |
| walidacja spoza próbki: (b) negatywy odrzucone | 134/134 | 134/134 (de2c6a4) |
| walidacja spoza próbki: (a) warianty we właściwej kampanii / tylko „podobne” / w złej | 34/78 / 13/78 / 0/78 | 34 / 11 / 0 (de2c6a4) |
| walidacja spoza próbki: pary P / R / F1 | 0,997 / 0,272 / 0,427 | to samo (de2c6a4) |
| odporność na niepełne zgłoszenia (111 wariantów) | 40 utrzymanych, 20 uczciwych braków, 0 fałszywych sklejeń, 0 cichych rozdzieleń | to samo (e2b411e) |
| twarde negatywy: pary prawdziwe (graf / leave-one-out) | 100 par, 0 / 0 sklejeń | 97 par, 0 / 0 (0dd7ce6) |
| twarde negatywy: pary pochodne (syntetyczne) | 11 z 18 sklejonych (opis w punkcie 7.2) | 5 z 18 (0dd7ce6) |
| bliskie pary (celowo nie połączone) | 55 | 52 (0dd7ce6) |
| wrażliwość wag ±10% / ±20% / ±30%: podział jak bazowy | 50/50 / 47/50 / 39/50 | 50 / 46 / 32 (817f9bf) |

### Walidacja na materiałach spoza próbki

Materiały: 212 stron oszustw zebranych z publicznych źródeł (głównie publiczne skany serwisu skanowania stron, dwie kopie z archiwum internetu, jeden artykuł prasowy); pochodzenie każdego materiału jest w `provenance.json` importu. Etykiety: 78 wariantów czterech znanych kampanii z próbki, 134 negatywy (105 materiałów innych operatorów z tą samą narracją lub osobą, 29 stron innych kont tej samej platformy stron). Baza: 25 spraw próbki, kod i wagi po zadaniu I14. Przebieg partii bez sieci, OCR i ASR.

- **(b) trafne odrzucenia negatywów: 134/134 (100%)**; żaden materiał innego operatora ani innego konta tej samej platformy nie trafił do znanej kampanii, żaden nie dostał też „podobnych kampanii”.
- (a) warianty znanych kampanii: 0/78 przypisanych do właściwej kampanii, 32/78 (41%) jako „podobne kampanie” z właściwą kampanią (łączy je jeden rodzaj dowodu: te same pliki strony), 46/78 bez wspólnego śladu z kampanią. Rozstrzygający ślad części rodzin (identyfikator kliknięcia trackera) jest w zebranych danych tylko w 2 z 39 materiałów jednej rodziny.
- (c) spójność nowych kampanii (rodziny innych operatorów, B-cubed): precyzja 0,971, czułość 0,331; 3 z 29 nowych kampanii łączą dwie rodziny (dwie podrodziny jednej strony na wspólnym hoście). Pary na całej partii: precyzja 0,993, czułość 0,126.
- (d) duplikaty: 0. (e) czas partii 212 materiałów: 0,8 s, szczyt pamięci ok. 330 MB.
- Pokrycie: w 5 z 12 prawdziwych kampanii z co najmniej dwoma materiałami narzędzie znalazło ≥ 50% członków w jednej kampanii, w 1 z 12 wszystkich.

**Po poprawkach metody (zadanie I10, punkt 5.1), ta sama partia i etykiety:** (a) 34/78 (43,6%) wariantów w właściwej znanej kampanii, 11/78 tylko „podobne”, 0 w złej; (b) nadal 134/134, a negatywów z „podobnymi kampaniami” 0; (c) bez zmian; pary na całej partii: precyzja 0,997, czułość 0,272 (F1 0,224 → 0,427); pokrycie 6 z 12 kampanii. Na 25 sprawach próbki partycja i grupy bez zmian. **Na `a407767`:** to samo, poza „tylko podobne”: 13/78 zamiast 11/78.

Wniosek: na tych danych metoda jest ostrożna (wysoka precyzja, niska czułość). Główne źródła rozbić to reguła „jeden rodzaj dowodu nie tworzy kampanii” przy stronach znanych tylko z listy żądań (bez kodu strony) i brak w publicznych skanach śladów z linku reklamy. **Zastrzeżenie:** etykiety rodzin nadano częściowo po tych samych śladach infrastruktury, których używa narzędzie, więc (a) jest optymistyczna; miarodajne są przede wszystkim (b) i (c). Policzysz to samo na własnych etykietach: `bun run evaluate -- --csv <partia.csv> --labels <etykiety.json>`.

### Odporność na niepełne zgłoszenia

Zgłoszenie może mieć tylko część plików (samo wideo z biblioteki reklam, zrzuty z telefonu bez HAR, HTML bez zrzutu reklamy). Zmierzyliśmy, jak wynik zmienia się, gdy sprawie brakuje plików. **Metoda:** z każdej z 25 spraw próbki robimy warianty z usuniętymi plikami (dowiązania, bez kopii): bez HAR, bez HTML, same zrzuty, samo wideo, wideo bez metadanych, bez reklamy (sama strona), sama reklama (bez strony); 111 wariantów. Każdy wariant porównujemy z bazą **bez jego sprawy** (leave-one-out, baza przebudowana bez rekordów tej sprawy, inaczej wariant trafiłby w samego siebie jako duplikat) i z wynikiem **oryginału** tej samej sprawy z tą samą bazą (oryginał też bywa omylny, więc wariantu nie porównujemy wprost z etykietą). Każdy wariant analizujemy osobno, bo w jednej partii warianty jednej sprawy uznawałyby się wzajemnie za duplikaty.

Metryki (liczby wariantów; „z parą” = sprawa ma w próbce sprawę tej samej kampanii; (a) liczone dla spraw, których oryginał miał przypisanie do znanej kampanii, pozostałe oznaczone „=”):

| wariant | z parą | (a) przypisanie utrzymane | (b) uczciwy brak | (c) fałszywe sklejenie | (d) ciche rozdzielenie | (e) wyjątek | = | bez pary: (c) |
|---|---|---|---|---|---|---|---|---|
| bez HAR | 13 | 9 | 2 | 0 | 0 | 0 | 2 | 0 z 7 |
| bez HTML | 15 | 11 | 2 | 0 | 0 | 0 | 2 | 0 z 8 |
| same zrzuty | 14 | 4 | 8 | 0 | 0 | 0 | 2 | 0 z 7 |
| samo wideo | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 z 2 |
| wideo bez metadanych | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 z 1 |
| bez reklamy (sama strona) | 14 | 12 | 0 | 0 | 0 | 0 | 2 | 0 z 8 |
| sama reklama (bez strony) | 14 | 4 | 8 | 0 | 0 | 0 | 2 | 0 z 8 |
| **razem** | 70 | 40 | 20 | 0 | 0 | 0 | 10 | 0 z 41 |

Wnioski: (c) i (d) nie wystąpiły: ubytek plików nie dołączył żadnego wariantu do cudzej kampanii (także spraw bez pary) i nie rozdzielił po cichu żadnej przypisanej sprawy; gdy narzędzie traci przypisanie, mówi o tym: 20 z 20 takich wariantów dostało „za mało danych”, „podobne kampanie” albo „nową kampanię” z listą braków w `missing_data`, a po poprawce z zadania I18 lista wymienia każdy faktyczny brak (HAR, strona, reklama; przed poprawką brak HAR przy zapisanej stronie i brak strony przy adresie z paska przeglądarki nie były zgłaszane). Wariant nie miał nigdy wyższej pewności niż oryginał. Zapisana strona (HTML albo HAR) wystarcza do przypisania (sama strona: 12 z 12), sam zrzut albo sama reklama bez strony zwykle nie (4 z 12; to sprawy, których zrzut jest kopią albo prawie identycznym wariantem zrzutu innej sprawy tej samej kampanii). Ślady, których usunięcie najczęściej kasowało przypisanie, to komentarze pod reklamą i konto platformy stron (z kodu strony), identyfikatory ścieżek, kampania platformy stron i szablon linku (z HAR i kodu strony), zasoby i domena (z HAR): o ich zrzut albo plik narzędzie powinno prosić zgłaszającego. Zastrzeżenie: 25 spraw, jedna baza, osiem spraw z jednej kampanii wśród spraw z parą; brak (c) i (d) w próbce nie dowodzi, że na innych danych ich nie będzie.

### Odporność wag

Wagi są ustalone ręcznie jako priorytety z researchu i nie są uczone na etykietach, bo etykiet jest za mało, a część z nich nadano po tych samych śladach, których używa narzędzie, więc uczenie dopasowałoby wagi do własnego odbicia. Zamiast tego sprawdzamy, czy wynik zależy od dokładnych liczb (`bun run sensitivity`, szczegóły w [TECHNICAL.md, §6.1](TECHNICAL.md#61-wrażliwość-wag-bun-run-sensitivity-od-22112026-zadanie-i27)); pomiar niczego nie stroi. Liczymy trzy rzeczy: (A) losowe zaburzenie wszystkich wag naraz o ±10, ±20 i ±30% (po 50 przebiegów) i rozrzut precyzji, czułości, F1 par, B-cubed i ARI oraz liczbę przebiegów z identycznym podziałem na kampanie i z nowym sklejeniem dwóch kampanii prawdy; (B) zmianę jednej wagi naraz o ×0,7 i ×1,3 z tabelą ΔF1 i liczby zmienionych par; (C) to samo dla progów osobno (×0,8 … ×1,2). Wagi i progi znajdowane są po nazwach pól konfiguracji, więc pomiar obejmie też wagi dodane później.

Na próbce syntetycznej (43 reklamy, 10 kampanii, F1 par bazowo 1,0) żaden z 150 przebiegów (A) i żaden z 134 wpisów tabel B i C (pojedyncza waga lub próg) nie zmieniła podziału na kampanie. Ta próbka ma wyraźnie rozdzielone kampanie, więc to dowód, że narzędzie działa, a nie że wagi są odporne na prawdziwych danych.

Na danych referencyjnych (commit `a407767`, 25 spraw, F1 par bazowo 0,897, po 50 przebiegów na rozrzut): przy ±10% podział na kampanie jest identyczny z bazowym w 50 z 50 przebiegów. Przy ±20% jest tak w 47 z 50, a mediana F1 par równa się bazowej (najgorszy przebieg 0,864, nowe sklejenie dwóch kampanii prawdy w 3 z 50). Przy ±30% podział zostaje w 39 z 50 przebiegów, F1 par w najgorszym przebiegu wynosi 0,850, a nowe sklejenie pojawia się w 6 z 50 przebiegów. Pojedynczo (tabela B) wpływ mają tylko 2 z 70 wag: waga komentarza w kodzie strony ×1,3 (ΔF1 −0,03, jedno nowe sklejenie) i waga domeny ×0,7 (ΔF1 −0,01). Wśród progów wpływ ma tylko próg silnego śladu ×0,8 (ΔF1 −0,03). To one leżą najbliżej granicy. W partii 212 materiałów spoza próbki (134 negatywy) żaden negatyw nie trafił do znanej kampanii w żadnym z 40 przebiegów z zaburzonymi wagami (±20% i ±30%, po 20). Czułość jest tam mniej odporna: mediana trafionych wariantów znanych kampanii zostaje na 34 z 78, ale w najgorszym przebiegu spada do 2 z 78 (w najlepszym 45 z 78).

### Końcowy pomiar

Pomiar na kodzie oddanym do oceny: commit `a407767` (kod łączenia jak w `74d54de`, stan na termin), 22.11.2026, 11:20–11:44. Pierwszy przebieg tej bramki (zadanie I19, commit 817f9bf) złapał błąd importu opisany niżej; liczby poniżej są z przebiegu po poprawce. Przebiegi są bez sieci i odtwarza je jeden skrypt poza repozytorium (dane spraw są poufne). Metoda:

- **Symulacja ukrytego zbioru (leave-one-out):** dla każdej z 25 spraw budujemy bazę bez niej i analizujemy pełną sprawę jak nowy materiał. Sprawa z parą powinna trafić do kampanii pary, a sprawa bez pary nie powinna trafić do żadnej znanej kampanii. Ta sama sprawa przeciw pełnej bazie musi dać duplikat.
- **Celowe zmiany prawdziwych spraw:** skrypt zmienia jedną rzecz, a odpowiedź jest znana z góry. Rodzaje zmian: zrzut reklamy jako JPEG o niższej jakości, przycięcie z paskiem tekstu, podmiana domeny strony przy zachowanych identyfikatorach, zostawienie samej infrastruktury wspólnej dla całej platformy, usunięcie najsilniejszego śladu łączącego.
- **Parafrazy treści:** tekst reklamy i strony opisany innymi słowami, z fikcyjną osobą i produktem albo przetłumaczony na angielski. Wariant ma zachowaną infrastrukturę albo samą treść.
- **Dlaczego nie dane wymyślone przez model językowy:** model nie podrobi spójnie DNS, rejestracji domen, HAR, identyfikatorów kliknięć ani obrazów. Test sprawdzałby wtedy reguły na danych, które same je spełniają. Dlatego punktem wyjścia są prawdziwe sprawy zmieniane skryptem, a model pisze tylko parafrazy tekstu.

Wyniki:

- **Fałszywe sklejenia na prawdziwych materiałach: 0 we wszystkich miarach.** Dotyczy to symulacji ukrytego zbioru (0 z 25), 137 celowych zmian (w tym 0 z 20 przy samej infrastrukturze platformy i 0 z 44 przy zmianie domeny i formatu obrazu), 36 wariantów parafraz (0 sklejeń samą narracją przy innej osobie), walidacji spoza próbki (0 ze 134 negatywów) oraz twardych negatywów (0 ze 100 par prawdziwych, także w leave-one-out). Na parach syntetycznych sklejenia są (punkt 7.2).
- **Symulacja ukrytego zbioru:** 23 z 25 spraw ocenionych trafnie: 14 z 16 spraw z parą we właściwej kampanii, 9 z 9 spraw bez pary poza znanymi kampaniami. Dwa pominięcia (obie sprawy jednej kampanii) to uczciwy brak: „podobne kampanie” z przesłankami (komentarze, zdania szablonu, komunikaty zestawu), bez śladu operatora. Przeciw pełnej bazie duplikat dostaje 25 z 25 spraw.
- **Celowe zmiany:** zmiana domeny przy zachowanych identyfikatorach daje kampanię oryginału w 23 z 23 wariantów. Usunięcie najsilniejszego śladu w żadnym z 10 wariantów nie przenosi materiału do innej kampanii (oczekiwanie: kampania oryginału albo brak przypisania). Sama infrastruktura wspólna dla platformy nie daje przypisania w 20 z 20. Zrzut w JPEG przy zachowanej stronie daje kampanię oryginału w 21 z 21 (8 bez oczekiwanego werdyktu duplikatu). Sam zrzut bez strony to najsłabszy przypadek: JPEG samego zrzutu daje kampanię oryginału w 17 z 21; przycięty sam zrzut w 2 z 21, 12 dostaje uczciwy brak („za mało danych” albo „podobne”), a **7 dostaje „nową kampanię” bez wskazania braku** (ciche rozdzielenie, tak samo na 817f9bf). Po odcięciu interfejsu zostaje za mało tekstu, a narzędzie nie zawsze mówi, że to za mało.
- **Parafrazy:** 36 z 36 zgodnych z oczekiwaniem. Gdy zostaje infrastruktura, wynik to kampania oryginału. Sama treść daje co najwyżej „podobne”, a zamiana osoby i produktu nie skleja materiału ze znaną kampanią.
- **Regresja względem wcześniejszych pomiarów:** próbka syntetyczna i walidacja spoza próbki są bez zmian. Na 25 sprawach F1 par spadło z 0,897 do 0,885, a zgodność z ręcznym łączeniem na poziomie obowiązkowym z 28/28 do 26/28. Przyczyna: redakcja danych analityka przy imporcie (z gałęzi scalonej na końcu) usuwa też dane operatora z rekordu wizyty platformy stron, w tym adres strony i identyfikator konta. Przez to 2 z 25 spraw nie przechodzą importu, a warianty bez HAR tracą konto platformy. Bramka wskazała commit, który to wprowadził; poprawka redaguje tylko dane analityka, na sparsowanym obiekcie. Na `a407767` czerwonych flag nie ma: 28 rekordów, F1 par 0,8974, MUSI 28/28. Jedyne pogorszenie to szczyt pamięci partii 212 materiałów (353 → 556 MB, przyrost rozłożony na wiele commitów; czas partii bez zmian, ok. 1,3 s).

### Ograniczenia znalezione w trakcie pracy

- **Tekst lub szablon strony sam nie łączy.** Szablony tekstów i stron krążą między operatorami.
- **Płatnik reklamy bywa ofiarą**: konto użyte bez wiedzy właściciela łączy niezwiązane kampanie (dlatego `ad_payer` ma 0,65 i jest tłumiony częstością).
- **Artefakty HAR analityka**: HAR zapisany z otwartymi DevTools albo „sanitized” zawiera lub pomija dane, których nie miał serwer; wspólny nagłówek analityka może wyglądać jak ślad operatora.
- **Strefa czasowa `first_seen`**: dane z różnych źródeł mogą podawać czas w różnych strefach (obraz Dockera ustawia `Europe/Warsaw`); przy zbiorze mieszanym kolejność materiałów i okna czasowe (np. seria rejestracji) mogą się przesunąć o godziny.
- **PID w identyfikatorze kliknięcia** to stała platformy, a nie operatora; liczy się maszyna (3 bajty), nie proces.
- **Nieoficjalny endpoint biblioteki reklam Mety** (przez MetaAdsCollector) może przestać działać po zmianie strony i jego użycie może naruszać regulamin serwisu.
- **Zależność od RDAP**: przy odpowiedzi tylko dla części domen seria rejestracji znika i część kampanii traci jeden z dowodów.
- **Seria rejestracji** to łańcuch: domeny zarejestrowane u tego samego rejestratora w odstępach ≤ 48 h łączą się przechodnio, więc długi łańcuch może objąć domeny odległe w czasie.
- **Twarze (`--faces`)**: zamknięta lista osób publicznych (`data/osoby-publiczne.json`; 127 osób na liście, z czego 31 ze zdjęciami (103 zdjęcia, po 1–5 na osobę, z Wikimedia Commons w `data/faces`); pozostałe są tylko personą z tekstu (pełne imię i nazwisko z odmianą, nigdy samo nazwisko). Dobór: osoby najczęściej podrabiane w polskich fałszywych reklamach według publicznych źródeł (zestawienie NASK z 12.07.2024 i artykuły fact-checkerów, CERT, prasy), tylko osoby ze źródłem, które wprost mówi o podszyciu się pod nią (jedyny wyjątek: wpis dodany decyzją właściciela, z adnotacją w polu `source`); lista jest zamknięta, każdy wpis ma `category` (grupa z zestawienia NASK, cecha grupy, nie dowód kampanii), wektory w `data/faces/index.json`). Wynik to „podobna twarz do X (0,xx)”, nigdy „to jest X”, i trafia do przeglądu człowieka. Dopasowanie tylko do osób z listy: twarz, która nikogo nie przypomina, zostaje ramką bez persony, a jej wektora nie zapisujemy (ani w `enriched.json`, ani w pamięci podręcznej, ani w paczce dowodów); wektory dopasowanych twarzy też nie trafiają do grafu ani eksportu (w wyniku jest ramka, identyfikator persony i podobieństwo). Persona z twarzy jest **cechą grupy podobnych kampanii** (ta sama osoba jako przynęta w wielu kampaniach różnych operatorów), nigdy dowodem, że dwa materiały są jedną kampanią. Waga dopasowania maleje z rozmiarem twarzy i wynikiem detektora (jakość twarzy, jak w MagFace). Próg 0,46 wybrano z pomiaru na zdjęciach 26 innych osób publicznych (0 fałszywych trafień na 54 twarzach, 96,7% trafień na parach tej samej osoby; zalecany dla SFace 0,363 dawał 9,3% fałszywych trafień): docs/TECHNICAL.md, „Persona z twarzy”. Nie budujemy bazy twarzy z sieci: zdjęcia referencyjne są wybrane ręcznie, ze źródłem, autorem i licencją ([data/faces/ZRODLA.md](../data/faces/ZRODLA.md)), a własne osoby dodaje instytucja (README, „Twarze”).
- **Głos osoby z listy (`--speaker`)**: galeria zamknięta, ta sama lista osób publicznych co dla twarzy (10 osób, `data/voices/index.json`: tylko wektory, po 5–8 polskich nagrań na osobę; źródła w [data/voices/ZRODLA.md](../data/voices/ZRODLA.md), nagrań nie ma w repozytorium ani w obrazie). Ścieżka jest cięta na okna po 4 s (krok 2 s); okna ciche i z samą muzyką (detekcja mowy SpeechBrain VAD) są odrzucane. Okno wskazuje osobę, gdy kosinus do jej wzorca (średnia z nagrań) jest ≥ 0,5 **i** wyprzedza drugą osobę o ≥ 0,15, a persona liczy się dopiero z co najmniej 2 sąsiednich okien (6 s). Wynik to „głos podobny do X (0,57)”, nigdy „to jest głos X”, do przeglądu człowieka. Jak twarz, persona z głosu jest **cechą grupy podobnych kampanii** (ta sama osoba jako przynęta u różnych operatorów), nigdy dowodem jednej kampanii. Pomiar (docs/TECHNICAL.md, „Persona z głosu”): ta sama osoba rozpoznana w 70 z 70 nagrań (leave-one-out), fałszywe trafienie na obcych 1 z 25 nagrań (4,0%; to jedno prawdopodobnie jest głosem Stanowskiego, więc 0/24 bez niego; cel ≤ 3,5% nie jest potwierdzony statystycznie przy 25 nagraniach), 5 z 5 fałszywek z publicznej kompilacji NASK nazwanych właściwą osobą. Model nie był trenowany na polskiej mowie, a reklamy mają inną akustykę niż wystąpienia z galerii, więc na reklamach trafień będzie mniej. **Detektor klonu głosu i ocena „czy to prawdziwy głos” są poza zakresem.**
- **Dane biometryczne głosu**: wektory głosu (SpeechBrain, 192 liczby) liczone tylko z `--speaker`, zapisywane wyłącznie w lokalnym `enriched.json` i w lokalnej pamięci podręcznej (TTL 28 dni, `.cache/speaker`); wektory okien używane do galerii nie są zapisywane nigdzie (w wyniku jest przedział, identyfikator persony i podobieństwo). Nie trafiają do `graph.json`, paczki dowodów ani eksportu CSV/JSON. Usunięcie: skasować `.cache/speaker` i pliki `enriched.json`.
- **Paczka dowodów** zawiera HAR i zapisane strony tylko jako kopie zredagowane z danych analityka (IP, odcisk przeglądarki, ciasteczka, nagłówki, tokeny Mety), z sumą oryginału w manifeście, i nie zawiera wektorów biometrycznych; narzędzie niczego nie zgłasza, a „uniknięta strata” i skala po poprawce na zgłaszalność to tylko pomysł na pitch, nie wynik paczki.
- **Skala**: porównania są liczone parami, O(n²); przy dziesiątkach tysięcy materiałów potrzebny byłby indeks.
- **Strony renderowane w JavaScripcie**: nie wykonujemy JS, więc część treści i adresów jest niewidoczna.

## 13. Czego nie robimy i dlaczego

- **Nie oceniamy pojedynczej reklamy** (ani „ryzyka” reklamy). Lista Ostrzeżeń CERT to cecha domeny, nie dowód o reklamie; wskaźnik ryzyka bez etykiet byłby zgadywaniem.
- **Nie wykrywamy klonów głosu.** Wymagałoby to modeli typu XLS-R/wav2vec2 i dostrojenia. Błąd równych wskaźników (EER) detektorów audio na prawdziwych reklamach to 25–60%, więc wynik takiego detektora byłby wskazówką, a nie dowodem. Głos mówcy służy do łączenia materiałów (ten sam głos w dwóch reklamach), nie do orzekania o fałszerstwie.
- **Nie wykrywamy tekstu pisanego przez LLM.**
- **CLIP z klatek wideo** to u nas tylko cecha wyglądu (podobieństwo kreacji), nie ocena „deepfake”.
- **Nie rozpoznajemy twarzy spoza listy i nie oceniamy, czy twarz jest prawdziwa.** Rozpoznanie dotyczy osób publicznych z ostrzeżeń (31 dla twarzy, 10 dla głosu); nie jest identyfikacją („podobna twarz do X” to wskazówka do przeglądu), a wykrywanie deepfake’ów twarzy jest poza zakresem.
- **Czego nie używamy:** bazy odcisków technologii *webappanalyzer* (licencja GPL-3.0; atrybut platformy powstaje z własnych wzorców) oraz *httpx* (aktywne sondowanie hostów łamie zasadę pasywności).
- Nie logujemy się na cudze konta, nie obchodzimy zabezpieczeń, nie renderujemy stron, nie wydajemy nakazów. Decyzję o zgłoszeniu podejmuje człowiek.

## 14. Wiedza

Wynik narzędzia to nie tylko werdykty, ale i wiedza do dalszej pracy. [WZORCE-KAMPANII.md](WZORCE-KAMPANII.md) opisuje, jak zbudowane są kampanie (platformy stron, trackery z identyfikatorem kliknięcia, cloakery, bramki konwersji, usługi wielu klientów, lejek, fałszywe komentarze i sklep z aplikacjami, serie rejestracji, narracje) i przy każdym wzorcu mówi, czy to cecha operatora, czy platformy oraz jaki typ węzła i jaką wagę mu nadaje narzędzie. [ZRODLA-METADANYCH.md](ZRODLA-METADANYCH.md) ocenia źródła liczbami: ile powiązań dał każdy typ śladu (`bun run source-stats` na dowolnym `graph.json`), czy działa na martwych stronach, ile kosztuje i czego wymaga. Wzbogacony zbiór danych (wiersz na materiał, bez wektorów głosu i twarzy) daje `bun run export-dataset`, a graf dla Neo4j opcja `--neo4j`. Kontrakt dla systemów instytucji: [INTEGRACJA.md](INTEGRACJA.md). Etykieta „znany backend leadów” przy przesłance pochodzi z publicznych raportów (`data/znane-backendy-leadow.json`, ze źródłem) i nie zmienia wag ani reguł łączenia.

## 15. Pochodzenie danych (skrót)

Próbka dostarczona przez właściciela danych nie trafia do repozytorium; w repozytorium są tylko dane syntetyczne. Dane z publicznych źródeł (skany urlscan, logi CT, RDAP i DNS, Lista Ostrzeżeń CERT, biblioteki reklam) zbierane w trybie live lądują w `.cache/` i `data/work/` poza repozytorium, a materiały zebrane z sieci mają w `zrodlo.json` adres źródła i datę dostępu. Pełna tabela: [README.md](../README.md#pochodzenie-danych).

## 16. Słownik pojęć

| Pojęcie | Znaczenie |
|---|---|
| **materiał** | jedna zebrana reklama wraz ze stroną, zrzutem, nagraniem lub linkiem |
| **kampania** | materiały, za którymi stoi prawdopodobnie jeden operator; połączone mocnymi dowodami |
| **grupa podobnych kampanii** | kampanie podobne (szablon, platforma, persona), ale bez dowodu jednego operatora |
| **wariant** | ta sama kreacja po drobnej zmianie (naklejka, kadr); dołącza do kampanii, nigdy jej nie scala |
| **dokładny duplikat** | ta sama reklama zebrana ponownie (ten sam obraz, identyfikator albo adres) |
| **wabik** | osoba publiczna, której wizerunek lub nazwisko użyto w reklamie (persona) |
| **grupa szablonu** | strony z tego samego zestawu (szablon, motyw, klon portalu), często u różnych operatorów |
| **przesłanka** | pojedynczy powód połączenia dwóch materiałów (np. wspólny tracker) z wagą |
| **siła** | waga przesłanki lub wynik powiązania (0–1); to nie prawdopodobieństwo |

Punkt odniesienia dla podobieństwa tekstu (kopiowanie z modyfikacjami): narzędzie D3lta (VIGINUM, francuska służba ochrony przed zagranicznymi manipulacjami informacją). Nasze podobieństwo tekstu (TF-IDF, opcjonalnie embeddingi) jest prostsze.

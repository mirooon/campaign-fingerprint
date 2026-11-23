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

## 10. Incomplete data

- **Dead page**: when there is only a screenshot with the address bar, the domain from the bar becomes the URL; features come from recorded DNS/RDAP answers (or from live queries, if `--lookups` is on).
- **Screenshot alone** without a URL: what remains is the image, the OCR text and the ad library ID, if it is visible. The assignment then rests on the creative, so the verdict is usually a variant (lower confidence) or “insufficient data”.
- **No RDAP**: the registration series and the domain creation date disappear; the other features work.
- **Skipped steps** (no tool, model, network or file) have the status `skipped` and a reason in the result (`steps` in JSON, `base.json` in the base). They are never skipped silently. This also applies to a whole case that the import did not turn into a record (e.g. a saved page without a URL when no HAR matches, or a file that cannot be read or parsed, such as a truncated HAR): it has a `skipped` entry with the reason in JSON, and in CSV an `insufficient` row with this reason in `missing_data`, so the sample does not vanish from the batch result. The same applies to a damaged row of a JSON/JSONL file with `--dataset`. One damaged file or row does not stop the batch: the remaining cases are analyzed normally.

<a id="strony-niedostępne"></a>

### Unavailable pages

For a URL whose page does not respond (network error, NXDOMAIN, 4xx/5xx, or a block or parking page), with the `--archive` option the tool looks for a public copy. Order of sources: **sample** (saved page, HAR) → **live download** (only with `--live`) → **urlscan.io** (existing scans of the same page) → **Internet Archive** (Wayback). A copy without page code (urlscan without a key: request list and asset hashes) gives way to a copy with code from the next source. The step is passive: it orders nothing and saves nothing, and without a network it is skipped with a reason.

Every copy in the result has a source (`urlscan`/`wayback`), the copy URL, the copy time and the query time, and its features are marked with `bodySource`; content from an archive never pretends to be a page downloaded live (the completeness list shows “archive copy” as a warning). **We reject a copy from before the domain's registration**: scam domains are sometimes re-registered, so a copy older than the registration date from RDAP (or, without it, older than the oldest known certificate from CT) is old content of another owner and must not link campaigns. We also reject a copy older than the first occurrence of the sample by more than `archiveMaxAgeDays` (30 by default; `lib/osint/archive/config.ts`). A rejected copy stays in the sample data as information with a reason and does not enter the features, and when it is compared with RDAP the domain gets the `reRegistered` attribute. **An archive copy does not change the weight of evidence**: it feeds the same features as a saved page (page code → template, backends, assets; request list → assets and hosts, as from HAR) with the same weights and rules. A dead URL without a copy in any source, without content and identifiers, gives “insufficient data” with the reason “no page and no archive copy”.

On two samples with a copy in Wayback, the result from the copy alone had the same kinds of pivots and the same verdict as the result from the case folder; the urlscan copy without a key lost the pivots from page code (see TECHNICAL §3.2).

## 11. Cloaking

The method is solely **passive detection by signatures in the collected data**: analysis of saved pages and HAR for cloaker script signatures in the page code (feature `cloakerInSource`) and for the same URL saved with different content (separate `#capture` records). We send no additional requests.

The `--cloaking` option (two additional downloads with different User-Agents: a platform crawler and a mobile browser) exists, but it is **off by default** and is not part of the method. When one of these downloads hits an anti-bot challenge page (e.g. “Just a moment…”), the result is “download blocked by bot protection”, not a suspicion of cloaking. A User-Agent test does not prove the absence of cloaking by IP and geolocation: a difference in content indicates something, its absence rules nothing out.

## 12. Validation and limitations

**The thresholds, the favicon rule and the persona list were chosen on the same 25 cases of the reference set.** The result on this set (at the time of task I14: pair precision and F1 = 1.0, 14 campaigns, 2 groups of similar campaigns; the current state is in the table below) shows that the method is consistent with our understanding of these cases, not that it will work on new ones. **Current state:** we repeated all measurements from this section in one run on commit `a407767` (table below). Descriptions of intermediate stages remain for the history of the method; where they differ, the table applies.

**The labels (which samples belong to one campaign) are ours**: there are no Polish datasets with campaign labels to compare them with. On synthetic data the result is close to 1.0 by design: we designed the set ourselves.

### Which code, which weights, which base

One run on 22 Nov 2026, 11:20–11:44, without network, on commit **`a407767`**. Its linking code (`lib/graph`, `lib/osint`, `lib/pipeline`) is the same as in `74d54de`, i.e. the state of the repository at the deadline (10:54); the differences between the two are comments, examples in tests and feature descriptions. Base: the 25 reference cases (28 records), built from scratch with this code (run `v-a407767`; DNS, RDAP and ASN from saved lookups, without network). **Weights:** built-in, from `lib/graph/config.ts`. The measurement scripts pass `--config linking-default.json`, but this file is an empty object `{}`, i.e. no overrides; it is in the non-public data package at `pomiary/linking-default.json`. Scripts and full reports: the package, folder `pomiary/` (table “Które liczby skąd”, i.e. which numbers come from where).

| Measurement | Result on `a407767` | Earlier measurement (commit) |
|---|---|---|
| 25 cases: pair F1 / B-cubed F1 / ARI | 0.8974 / 0.9672 / 0.8858 (pair precision 0.814, recall 1.0; 14 campaigns) | the same (cb7aedb, ecbcd35, 1efb3f4) |
| agreement with manual linking MUST / SHOULD | 28/28 / 18/24 | 28/28 / 12/24 (ecbcd35) |
| synthetic set: pair precision, recall, F1 | 1.0 | 1.0 (cb7aedb) |
| hidden-set simulation (leave-one-out) | 23 of 25 correct (14 of 16 with a pair, 9 of 9 without a pair), 0 in the wrong campaign | 23/25 (ecbcd35, 1efb3f4); 20/25 (817f9bf, import bug) |
| deliberate changes to real cases | 137 variants, 0 false merges | 134, 0 (817f9bf) |
| content paraphrases | 36 of 36 as expected | 36/36 (817f9bf) |
| validation outside the reference set: (b) negatives rejected | 134/134 | 134/134 (de2c6a4) |
| validation outside the reference set: (a) variants in the right campaign / only “similar” / in the wrong one | 34/78 / 13/78 / 0/78 | 34 / 11 / 0 (de2c6a4) |
| validation outside the reference set: pairs P / R / F1 | 0.997 / 0.272 / 0.427 | the same (de2c6a4) |
| robustness to incomplete reports (111 variants) | 40 kept, 20 honest misses, 0 false merges, 0 silent splits | the same (e2b411e) |
| hard negatives: real pairs (graph / leave-one-out) | 100 pairs, 0 / 0 merges | 97 pairs, 0 / 0 (0dd7ce6) |
| hard negatives: derived pairs (synthetic) | 11 of 18 merged (described in section 7.2) | 5 of 18 (0dd7ce6) |
| near-miss pairs (deliberately not linked) | 55 | 52 (0dd7ce6) |
| weight sensitivity ±10% / ±20% / ±30%: partition same as baseline | 50/50 / 47/50 / 39/50 | 50 / 46 / 32 (817f9bf) |

<a id="walidacja-na-materiałach-spoza-próbki"></a>

### Validation on samples outside the reference set

Samples: 212 scam pages collected from public sources (mainly public scans from a page-scanning service, two copies from the internet archive, one press article); the origin of every sample is in the import's `provenance.json`. Labels: 78 variants of four known campaigns from the reference set, 134 negatives (105 samples of other operators with the same narrative or person, 29 pages of other accounts of the same page-builder platform). Base: the 25 reference cases, code and weights after task I14. Batch run without network, OCR and ASR.

- **(b) correct rejections of negatives: 134/134 (100%)**; no sample of another operator or of another account of the same platform ended up in a known campaign, and none got “similar campaigns” either.
- (a) variants of known campaigns: 0/78 assigned to the right campaign, 32/78 (41%) as “similar campaigns” with the right campaign (linked by one kind of evidence: the same page files), 46/78 without a shared trace with the campaign. The deciding trace of some families (the tracker click ID) is present in the collected data in only 2 of the 39 samples of one family.
- (c) cohesion of new campaigns (families of other operators, B-cubed): precision 0.971, recall 0.331; 3 of 29 new campaigns join two families (two subfamilies of one page on a shared host). Pairs over the whole batch: precision 0.993, recall 0.126.
- (d) duplicates: 0. (e) batch time for 212 samples: 0.8 s, peak memory about 330 MB.
- Coverage: in 5 of 12 real campaigns with at least two samples the tool found ≥ 50% of the members in one campaign, in 1 of 12 all of them.

**After the method fixes (task I10, section 5.1), same batch and labels:** (a) 34/78 (43.6%) of variants in the right known campaign, 11/78 only “similar”, 0 in the wrong one; (b) still 134/134, and 0 negatives with “similar campaigns”; (c) unchanged; pairs over the whole batch: precision 0.997, recall 0.272 (F1 0.224 → 0.427); coverage 6 of 12 campaigns. On the 25 reference cases the partition and groups are unchanged. **On `a407767`:** the same, except “only similar”: 13/78 instead of 11/78.

Conclusion: on this data the method is cautious (high precision, low recall). The main sources of splits are the rule “one kind of evidence does not form a campaign” for pages known only from the request list (without page code), and the absence of traces from the ad link in public scans. **Caveat:** the family labels were assigned partly by the same infrastructure traces the tool uses, so (a) is optimistic; (b) and (c) are the most reliable. You can compute the same on your own labels: `bun run evaluate -- --csv <batch.csv> --labels <labels.json>`.

<a id="odporność-na-niepełne-zgłoszenia"></a>

### Robustness to incomplete reports

A report may contain only some of the files (only a video from the ad library, phone screenshots without HAR, HTML without a screenshot of the ad). We measured how the result changes when a case is missing files. **Method:** from each of the 25 reference cases we make variants with files removed (symlinks, no copies): without HAR, without HTML, screenshots only, video only, video without metadata, without the ad (page only), ad only (without the page); 111 variants. Each variant is compared with a base **without its case** (leave-one-out: the base is rebuilt without the records of this case, otherwise the variant would hit itself as a duplicate) and with the result of the **original** of the same case against the same base (the original can be wrong too, so the variant is not compared with the label directly). Each variant is analyzed separately, because in one batch the variants of one case would recognize each other as duplicates.

Metrics (numbers of variants; “with a pair” = the reference set has another case of the same campaign; (a) is computed for cases whose original was assigned to a known campaign, the others are marked “=”):

| variant | with a pair | (a) assignment kept | (b) honest miss | (c) false merge | (d) silent split | (e) exception | = | without a pair: (c) |
|---|---|---|---|---|---|---|---|---|
| without HAR | 13 | 9 | 2 | 0 | 0 | 0 | 2 | 0 of 7 |
| without HTML | 15 | 11 | 2 | 0 | 0 | 0 | 2 | 0 of 8 |
| screenshots only | 14 | 4 | 8 | 0 | 0 | 0 | 2 | 0 of 7 |
| video only | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 of 2 |
| video without metadata | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 of 1 |
| without the ad (page only) | 14 | 12 | 0 | 0 | 0 | 0 | 2 | 0 of 8 |
| ad only (without the page) | 14 | 4 | 8 | 0 | 0 | 0 | 2 | 0 of 8 |
| **total** | 70 | 40 | 20 | 0 | 0 | 0 | 10 | 0 of 41 |

Conclusions: (c) and (d) did not occur: missing files did not attach any variant to someone else's campaign (including cases without a pair) and did not silently split any assigned case; when the tool loses an assignment, it says so: 20 of 20 such variants got “insufficient data”, “similar campaigns” or “new campaign” with a list of gaps in `missing_data`, and after the fix from task I18 the list names every actual gap (HAR, page, ad; before the fix, a missing HAR next to a saved page and a missing page next to a URL from the browser address bar were not reported). A variant never had higher confidence than the original. A saved page (HTML or HAR) is enough for an assignment (page only: 12 of 12); a screenshot alone or an ad alone without the page usually is not (4 of 12; these are cases whose screenshot is a copy or a nearly identical variant of a screenshot of another case of the same campaign). The traces whose removal most often wiped out the assignment are the comments under the ad and the page-builder account (from page code), path IDs, the page-builder campaign and the link template (from HAR and page code), assets and the domain (from HAR): the tool should ask the reporter for a screenshot or file that contains them. Caveat: 25 cases, one base, eight cases from one campaign among the cases with a pair; the absence of (c) and (d) in the reference set does not prove that they will not occur on other data.

<a id="odporność-wag"></a>

### Weight robustness

The weights are set by hand as priorities from research and are not learned from labels, because there are too few labels, and some of them were assigned by the same traces the tool uses, so learning would fit the weights to their own reflection. Instead we check whether the result depends on the exact numbers (`bun run sensitivity`, details in [TECHNICAL.md, §6.1](TECHNICAL.md#61-wrażliwość-wag-bun-run-sensitivity-od-22112026-zadanie-i27), Polish); the measurement tunes nothing. We compute three things: (A) random perturbation of all weights at once by ±10, ±20 and ±30% (50 runs each) and the spread of precision, recall, pair F1, B-cubed and ARI, plus the number of runs with a partition into campaigns identical to the baseline and with a new merge of two ground-truth campaigns; (B) changing one weight at a time by ×0.7 and ×1.3, with a table of ΔF1 and the number of changed pairs; (C) the same for thresholds separately (×0.8 … ×1.2). Weights and thresholds are found by configuration field names, so the measurement also covers weights added later.

On the synthetic set (43 ads, 10 campaigns, baseline pair F1 1.0), none of the 150 runs in (A) and none of the 134 entries of tables B and C (a single weight or threshold) changed the partition into campaigns. This set has clearly separated campaigns, so this proves that the tool works, not that the weights are robust on real data.

On the reference data (commit `a407767`, 25 cases, baseline pair F1 0.897, 50 runs per spread): at ±10% the partition into campaigns is identical to the baseline in 50 of 50 runs. At ±20% this holds in 47 of 50, and the median pair F1 equals the baseline (worst run 0.864, a new merge of two ground-truth campaigns in 3 of 50). At ±30% the partition holds in 39 of 50 runs, pair F1 in the worst run is 0.850, and a new merge appears in 6 of 50 runs. Individually (table B) only 2 of 70 weights have an effect: the page-code comment weight ×1.3 (ΔF1 −0.03, one new merge) and the domain weight ×0.7 (ΔF1 −0.01). Among the thresholds only the strong-trace threshold ×0.8 has an effect (ΔF1 −0.03). These lie closest to the boundary. In the batch of 212 samples outside the reference set (134 negatives), no negative ended up in a known campaign in any of the 40 runs with perturbed weights (±20% and ±30%, 20 each). Recall is less robust there: the median number of correctly assigned variants of known campaigns stays at 34 of 78, but in the worst run it drops to 2 of 78 (in the best, 45 of 78).

### Final measurement

Measurement on the code submitted for assessment: commit `a407767` (linking code as in `74d54de`, the state at the deadline), 22 Nov 2026, 11:20–11:44. The first run of this gate (task I19, commit 817f9bf) caught the import bug described below; the numbers below come from the run after the fix. The runs are offline and are reproduced by one script outside the repository (the case data is confidential). Method:

- **Hidden-set simulation (leave-one-out):** for each of the 25 cases we build a base without it and analyze the full case as a new sample. A case with a pair should land in its pair's campaign, and a case without a pair should not land in any known campaign. The same case against the full base must give a duplicate.
- **Deliberate changes to real cases:** a script changes one thing, and the answer is known in advance. Kinds of changes: the ad screenshot as a lower-quality JPEG, cropping with a text bar, swapping the page domain while keeping the identifiers, leaving only infrastructure shared by the whole platform, removing the strongest linking trace.
- **Content paraphrases:** the ad and page text described in other words, with a fictional person and product, or translated into English. The variant keeps either the infrastructure or only the content.
- **Why not data invented by a language model:** a model will not consistently fake DNS, domain registrations, HAR, click IDs or images. The test would then check the rules on data that satisfies them by construction. So the starting point is real cases changed by a script, and the model writes only text paraphrases.

Results:

- **False merges on real samples: 0 in all measures.** This covers the hidden-set simulation (0 of 25), 137 deliberate changes (including 0 of 20 with only the platform's infrastructure and 0 of 44 with a changed domain and image format), 36 paraphrase variants (0 merges on narrative alone with a different person), validation outside the reference set (0 of 134 negatives) and hard negatives (0 of 100 real pairs, also in leave-one-out). On synthetic pairs there are merges (section 7.2).
- **Hidden-set simulation:** 23 of 25 cases judged correctly: 14 of 16 cases with a pair in the right campaign, 9 of 9 cases without a pair outside known campaigns. The two misses (both cases of one campaign) are honest misses: “similar campaigns” with evidence (comments, template sentences, kit messages), without an operator trace. Against the full base, 25 of 25 cases get a duplicate.
- **Deliberate changes:** changing the domain while keeping the identifiers gives the original's campaign in 23 of 23 variants. Removing the strongest trace moves the sample to another campaign in none of the 10 variants (expectation: the original's campaign or no assignment). Infrastructure shared by the platform alone gives no assignment in 20 of 20. A JPEG screenshot with the page kept gives the original's campaign in 21 of 21 (8 without the expected duplicate verdict). A screenshot alone without the page is the weakest case: a JPEG of the screenshot alone gives the original's campaign in 17 of 21; a cropped screenshot alone in 2 of 21, 12 get an honest miss (“insufficient data” or “similar”), and **7 get “new campaign” without any gap reported** (a silent split, the same as on 817f9bf). Once the interface is cropped away, too little text remains, and the tool does not always say that it is too little.
- **Paraphrases:** 36 of 36 as expected. When the infrastructure remains, the result is the original's campaign. Content alone gives at most “similar”, and swapping the person and product does not merge the sample with a known campaign.
- **Regression against earlier measurements:** the synthetic set and the validation outside the reference set are unchanged. On the 25 cases pair F1 fell from 0.897 to 0.885, and agreement with manual linking at the mandatory level from 28/28 to 26/28. Cause: redaction of the analyst's data at import (from a branch merged at the end) also removed operator data from the page-builder visit record, including the page URL and the account ID. Because of that, 2 of the 25 cases did not pass import, and the variants without HAR lost the platform account. The gate pointed to the commit that introduced this; the fix redacts only the analyst's data, on the parsed object. On `a407767` there are no red flags: 28 records, pair F1 0.8974, MUST 28/28. The only deterioration is the peak memory of the 212-sample batch (353 → 556 MB, growth spread over many commits; batch time unchanged, about 1.3 s).

### Limitations found during the work

- **Text or a page template alone does not link.** Text and page templates circulate between operators.
- **The ad payer is sometimes a victim**: an account used without the owner's knowledge links unrelated campaigns (which is why `ad_payer` has 0.65 and is damped by frequency).
- **Analyst HAR artefacts**: a HAR saved with DevTools open, or a “sanitized” one, contains or omits data that the server did not have; a shared analyst header can look like an operator trace.
- **`first_seen` time zone**: data from different sources may give times in different zones (the Docker image sets `Europe/Warsaw`); in a mixed set, the order of samples and time windows (e.g. a registration series) may shift by hours.
- **The PID in the click ID** is a platform constant, not an operator one; what counts is the machine (3 bytes), not the process.
- **The unofficial Meta ad library endpoint** (via MetaAdsCollector) may stop working after a change to the site, and using it may violate the service's terms.
- **Dependence on RDAP**: when only some domains get an answer, the registration series disappears and some campaigns lose one piece of evidence.
- **The registration series** is a chain: domains registered at the same registrar at intervals of ≤ 48 h are linked transitively, so a long chain can cover domains far apart in time.
- **Faces (`--faces`)**: closed list of public figures (`data/osoby-publiczne.json`; 127 people on the list, 31 of them with photos (103 photos, 1–5 per person, from Wikimedia Commons in `data/faces`); the others are only a persona from text (full first and last name with inflection, never the surname alone). Selection: the people most often impersonated in Polish fake ads according to public sources (the NASK list of 12 Jul 2024 and articles by fact-checkers, CERT and the press), only people with a source that explicitly says they were impersonated (the only exception: an entry added by the owner's decision, with a note in the `source` field); the list is closed, each entry has a `category` (group from the NASK list; a group feature, not campaign evidence), vectors in `data/faces/index.json`). The result is “face similar to X (0.xx)”, never “this is X”, and it goes to human review. Matching only against people on the list: a face that resembles no one stays a frame without a persona, and its vector is not saved (neither in `enriched.json`, nor in the cache, nor in the evidence pack); the vectors of matched faces do not go into the graph or the export either (the result has a frame, a persona ID and the similarity). A persona from a face is a **feature of a group of similar campaigns** (the same person as a lure in many campaigns of different operators), never evidence that two samples are one campaign. The match weight decreases with face size and detector score (face quality, as in MagFace). The threshold of 0.46 was chosen from a measurement on photos of 26 other public figures (0 false hits on 54 faces, 96.7% hits on pairs of the same person; the threshold recommended for SFace, 0.363, gave 9.3% false hits): docs/TECHNICAL.md §4.14, “Persona z twarzy” (persona from a face). We do not build a face database from the web: the reference photos are chosen by hand, with source, author and license ([data/faces/ZRODLA.md](../data/faces/ZRODLA.md), Polish), and an institution adds its own people (jury instructions, docs/JURY.md, paragraph “Twarze i głos”, Polish).
- **Voice of a person on the list (`--speaker`)**: closed gallery, the same list of public figures as for faces (10 people, `data/voices/index.json`: vectors only, 5–8 Polish recordings per person; sources in [data/voices/ZRODLA.md](../data/voices/ZRODLA.md) (Polish); the recordings are not in the repository or in the image). The track is cut into 4 s windows (2 s step); silent windows and windows with music only (SpeechBrain VAD speech detection) are discarded. A window points to a person when the cosine to that person's template (mean over the recordings) is ≥ 0.5 **and** leads the second person by ≥ 0.15, and a persona counts only from at least 2 adjacent windows (6 s). The result is “voice similar to X (0.57)”, never “this is X's voice”, for human review. Like a face, a persona from a voice is a **feature of a group of similar campaigns** (the same person as a lure for different operators), never evidence of one campaign. Measurement (docs/TECHNICAL.md §4.16, “Persona z głosu”): the same person recognized in 70 of 70 recordings (leave-one-out), a false hit on strangers in 1 of 25 recordings (4.0%; that one is probably Stanowski's voice, so 0/24 without it; the target of ≤ 3.5% is not statistically confirmed with 25 recordings), 5 of 5 fakes from a public NASK compilation named as the right person. The model was not trained on Polish speech, and ads have different acoustics than the gallery recordings, so there will be fewer hits on ads. **A voice clone detector and judging “is this a real voice” are out of scope.**
- **Voice biometric data**: voice vectors (SpeechBrain, 192 numbers) are computed only with `--speaker` and saved only in the local `enriched.json` and in the local cache (TTL 28 days, `.cache/speaker`); the window vectors used for the gallery are not saved anywhere (the result has a time range, a persona ID and the similarity). They do not go into `graph.json`, the evidence pack or the CSV/JSON export. Deletion: remove `.cache/speaker` and the `enriched.json` files.
- **The evidence pack** contains HAR files and saved pages only as copies redacted of the analyst's data (IP, browser fingerprint, cookies, headers, Meta tokens), with a checksum of the original in the manifest, and contains no biometric vectors; the tool reports nothing by itself, and “avoided loss” and the scale after correcting for reportability are only an idea for the pitch, not a result of the pack.
- **Scale**: comparisons are computed pairwise, O(n²); tens of thousands of samples would need an index.
- **Pages rendered in JavaScript**: we do not execute JS, so part of the content and URLs is invisible.

<a id="13-czego-nie-robimy-i-dlaczego"></a>

## 13. What we do not do, and why

- **We do not judge a single ad** (nor an ad's “risk”). The CERT Polska warning list is a feature of a domain, not evidence about an ad; a risk score without labels would be guesswork.
- **We do not detect voice clones.** That would need models such as XLS-R/wav2vec2 and fine-tuning. The equal error rate (EER) of audio detectors on real ads is 25–60%, so such a detector's result would be a hint, not evidence. The speaker's voice is used to link samples (the same voice in two ads), not to rule on forgery.
- **We do not detect text written by an LLM.**
- **CLIP on video frames** is for us only an appearance feature (creative similarity), not a “deepfake” score.
- **We do not recognize faces outside the list and do not judge whether a face is real.** Recognition covers public figures named in warnings (31 for faces, 10 for voice); it is not identification (“face similar to X” is a hint for review), and deepfake face detection is out of scope.
- **What we do not use:** the *webappanalyzer* technology fingerprint database (GPL-3.0 license; the platform attribute is built from our own patterns) and *httpx* (active probing of hosts breaks the passivity principle).
- We do not log in to other people's accounts, do not bypass protections, do not render pages and do not issue orders. A human decides whether to report.

## 14. Knowledge

The tool's output is not only verdicts but also knowledge for further work. [WZORCE-KAMPANII.md](WZORCE-KAMPANII.md) (Polish) describes how campaigns are built (page-builder platforms, trackers with a click ID, cloakers, conversion gateways, multi-customer services, the funnel, fake comments and the app store, registration series, narratives) and for each pattern says whether it is a feature of the operator or of the platform, and which node type and weight the tool gives it. [ZRODLA-METADANYCH.md](ZRODLA-METADANYCH.md) (Polish) rates sources with numbers: how many links each trace type produced (`bun run source-stats` on any `graph.json`), whether it works on dead pages, how much it costs and what it needs. An enriched dataset (one row per sample, without voice and face vectors) is produced by `bun run export-dataset`, and a graph for Neo4j by the `--neo4j` option. The contract for institutional systems: [INTEGRACJA.md](INTEGRACJA.md) (Polish). The label “known lead backend” on an evidence item comes from public reports (`data/znane-backendy-leadow.json`, with a source) and changes neither the weights nor the linking rules.

## 15. Data provenance (summary)

The reference cases provided by the data owner do not go into the repository; the repository holds only synthetic data. Data from public sources (urlscan scans, CT logs, RDAP and DNS, the CERT Polska warning list, ad libraries) collected in live mode lands in `.cache/` and `data/work/` outside the repository, and samples collected from the web have the source URL and access date in `zrodlo.json`. Full table: [JURY.md](JURY.md#pochodzenie-danych) (jury instructions, Polish).

## 16. Glossary of terms

| Term | Meaning |
|---|---|
| **sample** | one collected ad together with its page, screenshot, recording or link |
| **campaign** | samples probably run by one operator; linked by strong evidence |
| **group of similar campaigns** | similar campaigns (template, platform, persona), but without evidence of one operator |
| **variant** | the same creative after a small change (sticker, crop); joins a campaign, never merges campaigns |
| **exact duplicate** | the same ad collected again (the same image, ID or URL) |
| **lure** | a public figure whose likeness or name was used in an ad (persona) |
| **template group** | pages from the same kit (template, theme, portal clone), often used by different operators |
| **evidence item** | a single reason for linking two samples (e.g. a shared tracker), with a weight |
| **strength** | the weight of an evidence item or the score of a link (0–1); not a probability |

Reference point for text similarity (copying with modifications): the D3lta tool (VIGINUM, the French service for protection against foreign information manipulation). Our text similarity (TF-IDF, optionally embeddings) is simpler.

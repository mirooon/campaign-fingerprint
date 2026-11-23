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

## 4. Kampania a grupa podobnych kampanii

Wynik ma dwa poziomy:

- **Kampania**: materiały, za którymi najpewniej stoi ten sam operator. Wymaga mocnych dowodów.
- **Grupa podobnych kampanii**: kampanie, które łączy coś słabszego (ten sam szablon strony, ta sama platforma, ta sama persona), ale nie na tyle, by uznać je za jednego operatora. Szablony i zestawy stron są kupowane i używane przez wielu operatorów, więc wspólny szablon to wskazówka, a nie dowód.

**Reguły kampanii** (`campaignLinkVerdict`, `lib/graph/cluster.ts`):

1. **Silny dowód** (np. ten sam tracker, ten sam adres kontaktowy, ten sam backend formularza z identyfikatorem klienta) łączy sam. Łączenie silnych dowodów robi union-find (jeśli A=B i B=C, to A=B=C).
2. Wynik pary poniżej `minLinkScore` (0,15) nie liczy się.
3. **Konflikt kont**: dwie reklamy na tej samej platformie stron, ale na różnych kontach, nie łączą się bez silnego dowodu. Ten rodzaj konfliktu wygrywa z treścią, z plikiem kreacji, a nawet z silnym dowodem opartym wyłącznie na identyfikatorze `path_id` (bywa on biblioteką landerów wspólną dla wielu kont).
4. **Ślady zestawu stron** (szablon, motyw, komentarze w kodzie, favicon, podobna struktura strony, format linku) liczą się razem jako jeden rodzaj i nie łączą kampanii same. Kampania potrzebuje co najmniej jednego rodzaju dowodu spoza zestawu stron, persony i treści (konto platformy, serwer trackera, NS, kontakt…). Jeden taki rodzaj wystarcza, jeśli wynik pary po zniżkach i rzadkości przekracza `minLinkScore` (0,15); `minEvidenceKinds` (2) przy obecnej konfiguracji niczego nie blokuje, dlatego reguła `too-few-evidence-kinds` nie występuje.
5. **Treść** (podobny tekst, obraz, dźwięk, głos): treść bez infrastruktury tworzy kampanię tylko z **co najmniej dwoma różnymi rodzajami treści** (np. obraz i tekst). Pole `basis` kampanii mówi, na czym stoi: `infrastructure`, `content` albo `mixed`. Gdy któryś materiał ma infrastrukturę, sama treść nie łączy.
6. **Wariant kreacji: dołączanie, nigdy scalanie.** Zrzut z naklejką, bez adresu, nie ma infrastruktury, więc nie wolno mu zaprzeczyć przypisaniu ani zbudować mostu między dwiema kampaniami. Po zbudowaniu kampanii taki materiał dołącza do kampanii z infrastrukturą, jeśli jego kreacja jest prawie identyczna (dHash ≤ 6 bitów albo CLIP ≥ 0,95) z kreacjami **dokładnie jednej** takiej kampanii. Przy dwóch lub więcej kandydatach nic nie dołącza i zostaje grupa podobnych. Wynik ma `basis: "mixed"` i niższą pewność. Tak samo działa wspólne ujęcie wideo (klatka z dHash ≤ 6 do ujęcia z kampanii). **Ograniczenie:** ujęcie skopiowane z cudzego nagrania (np. fragment wywiadu) może więc dołączyć wideo bez infrastruktury do kampanii, jeśli podobne ujęcie ma tylko jedna kampania.
7. **Persona działa tylko na poziomie grupy.** Ta sama osoba publiczna występuje w reklamach wielu niezwiązanych operatorów, więc nie łączy kampanii i nie liczy się do ich wyniku.

**Dlaczego jawne reguły, a nie HDBSCAN lub inne grupowanie bez nadzoru.** Każda krawędź musi dać się wyjaśnić osobie, która zdecyduje o zgłoszeniu: „te dwa materiały łączy tracker X (rzadki, waga 0,95) i serwer Y”. Metoda zbiorcza daje odległość w przestrzeni cech i parametr, którego nie da się obronić przed odbiorcą. Dlatego: reguły → union-find dla silnych dowodów; **Louvain** (grupowanie wspólnot na grafie ważonym) dla reszty; wszystko z jawną listą przesłanek.

## 5. Ślady łączące dodane po walidacji (22.11.2026)

Nowe rodzaje śladów, które łączą materiały (z wagą z punktu 3) albo zmieniają sposób liczenia istniejących. Te, które tylko opisują materiał i niczego nie łączą, są w punkcie 6.

### 5.1 Poprawki metody po walidacji (zadanie I10)

Walidacja na materiałach spoza próbki pokazała prawie wyłącznie rozbicia (wysoka precyzja, niska czułość). Zmiany mają ogólne uzasadnienie, test syntetyczny i opis w `docs/TECHNICAL.md` §4.17; liczby przed i po: punkt 12.

**Nowe i poprawione ślady łączące.**
- **Plik z witryny konta darmowego hostingu = hosting tego konta.** Gdy strona ładuje swoje skrypty z subdomeny platformy, na której każda subdomena to jedna witryna jednego konta (`netlify.app`, `pages.dev`, `github.io` …), host tej witryny liczy się jak hosting operatora (waga 0,95 × 0,7, nie silny). Kupiec skopiowanego zestawu stron trzyma pliki na własnej domenie, a publiczne CDN mają zniżkę. Host spoza tej listy (sieć reklamowa, statystyki) takiego śladu nie daje.
- **Skrypty dopisywane przez CDN** (`/cdn-cgi/…`, np. dekodowanie e-maili Cloudflare) mają zniżkę ×0,02: to cecha CDN, nie operatora.
- **Ślady z żądań strony (HAR, skan):** identyfikator piksela Mety z adresów wywołań, identyfikator kliknięcia trackera z wywołań zdarzeń, katalog landera platformy (`/landers/<uuid>/`) już z jednego adresu, parametry kampanii i identyfikator kliknięcia z linków CTA strony (relacja 0,8). Hosty spoza domeny strony (`tracker_host`, 0,25) są śladem zestawu stron: tylko potwierdzają, bo lista usług publicznych nigdy nie jest pełna. Żądania wcześniejszej strony tej samej sesji przeglądarki i żądania rozszerzeń przeglądarki osoby zapisującej HAR są pomijane.
- **Tokeny weryfikacji domeny** (Meta, Google, Yandex; z kodu strony i rekordów TXT) to ślad jednego konta Business Managera albo Search Console: silny (0,9).
- **Identyfikatory reklam i kampanii z linku:** identyfikator reklamy Mety w `utm_content`/`ad_id` łączy się z identyfikatorem z `fbclid`; `gad_campaignid` (Google Ads) i konto kupującego ruch (`acc=`, `_buyer=`) to silne parametry kampanii; miejsce wyświetlenia (`utm_placement`) jest słabe.
- **Marka oszustwa** (nazwa produktu albo „platformy”, np. „Fikcyjnol Forte”, „TradeSynthIQ 4.7”) przetrwa zmianę twarzy i domeny, ale jeden produkt sprzedaje wielu afiliantów: to ślad zestawu stron (0,45), sam daje najwyżej grupę; ogólne nazwy platform mają zniżkę. Wydawca AdSense (`ca-pub-…`) też jest śladem zestawu stron (identyfikatory wydawców bywają współdzielone).
- **Linki-opakowania platform** (`l.facebook.com/l.php?u=`, `google.com/url?q=`, `adurl=`) są rozwijane do adresu docelowego, bo domeny platform mają wagę 0.
- **Siatki bezpieczeństwa:** ślad wspólny dla więcej niż 20 materiałów nie jest silny niezależnie od wielkości zbioru (bez tego w dużej partii jeden powszechny ślad skleja łańcuchowo); społeczność Louvaina rozpadająca się na części bez powiązań jest dzielona na te części; stałe frazy reklam („dowiedz się więcej”, „tylko dziś”) i halucynacje transkrypcji („Napisy stworzone przez społeczność Amara.org”) nie liczą się do podobieństwa tekstu; transkrypcja może używać VAD (wykrywania mowy), żeby nie pisać tekstu do samej muzyki; strona wyzwania antybotowego to zablokowane pobranie, nie cloaking.

**Rozszerzalność bez zmiany kodu (`--config`).** Plik konfiguracji dopisuje listy zniżek (tablice w `lists` są dołączane do domyślnych) i może zrobić pivot z nieznanej kolumny wejścia:

```json
{
  "extraPivots": { "page_id": "advertiser" },
  "lists": {
    "domains": [{ "match": "cdn-uslugi.example", "factor": 0, "reason": "usługa współdzielona przez wiele stron" }],
    "genericScamBrands": [{ "match": "zyskomat*", "factor": 0.2, "reason": "ogólna nazwa platformy" }]
  }
}
```

Wartość kolumny `page_id` staje się wtedy węzłem typu `advertiser` (klucz `extra:page_id=<wartość>`) z wagą, zniżkami i regułami tego typu.

### 5.2 Operator jako firma leadowa (zadanie I23)

Publiczne opisy branży (raport RIVSEC „Fałszywe inwestycje w internecie. Schematy działania i zaplecze przestępcze”, marzec 2026, omówiony w podcaście Techstorie #157, Wyborcza, 13.10.2026) pokazują operatora jak firmę, która kupuje i sprzedaje zgłoszenia (leady). Strona docelowa ma jeden interaktywny element, formularz (imię, nazwisko, telefon), a dane trafiają na żywo do CRM. Leady są pakowane według kraju i kanału, więc każde zgłoszenie niesie identyfikator źródła, a pośrodku stoi sieć afiliacyjna („manager do spraw afiliacji”). Z tego wynikają ślady i reguły:

- **Identyfikator afiliacyjny i klucz CRM łączą kampanię.** Identyfikator afiliacji, oferty i strumienia (`aff_id`, `pid`, `partner_id`, `wm_id`, `offer_id`, `flow_id`/`stream`, `landing_id`, `s1`–`s5`) siedzi w adresie, w ukrytych polach formularza i w obiektach konfiguracji skryptów strony. To ten sam węzeł `campaign_param` (0,8) z pochodzeniem „z adresu / z formularza / ze skryptu”, bo zgłoszenie idzie do CRM z tymi samymi identyfikatorami co link. Krótkie, pospolite nazwy (`pid`, `flow`, `s1`, `partner`) liczą się tylko z wartością przypominającą identyfikator (cyfra, co najmniej 3 znaki), więc `1`, `test`, `default` i makra nie łączą. Identyfikator kliknięcia (`click_id`, `aff_click_id`) jest nowy przy każdym kliknięciu i nie łączy materiałów. Tajny klucz API, z którym formularz wysyła zgłoszenie (`crm_key`, 0,95), należy do jednego konta odbiorcy leadów: jest tak mocny jak wspólny backend formularza. Narzędzie zapisuje z klucza tylko skrót (4 pierwsze i 4 ostatnie znaki oraz sha256), nigdy cały klucz, i pomija klucze usług publicznych (mapy, reCAPTCHA, analityka), tokeny CSRF oraz wartości krótkie lub mało losowe.
- **Zdanie szablonu tylko wspiera.** Rzadkie zdanie (≥ 6 słów) z tekstu strony albo z podziękowania zapisanego w skrypcie („Nasz opiekun zadzwoni do Ciebie …”) obecne w co najmniej dwóch domenach to `template_phrase` (0,45). Ten sam szablon kupuje wielu operatorów, więc jest w `notAloneKinds` jak szablon strony i blok komentarzy. Wspólna wpadka w zdaniu (powtórzony ciąg trzech słów, słowo z łacinką i cyrylicą) jest rzadsza niż poprawne zdanie i waży 1,3 raza więcej, ale poniżej progu silnego dowodu. Zgody RODO, cookies, stopki i ostrzeżenia o ryzyku są pomijane.
- **Przykładowy numer z formularza to szablon, nie telefon.** Numer z `placeholder`, z wartości pola telefonu, z etykiety albo z podpowiedzi „np. …”, „na przykład …”, „format …” jest kopiowany z szablonem na każdą stronę. Nie tworzy węzła `phone` (0,9), tylko ślad szablonu (`page_template`, klucz `phone_example:`). Numery oczywiście sztuczne (same powtórzenia, `123456789`) nie są ani telefonem, ani przykładem.
- **Nazwa konta reklamowego tylko wspiera.** Reklamy idą z przejętych kont opłacanych kartami wcześniejszych ofiar (np. konto pensjonatu), więc nazwa reklamodawcy często należy do ofiary. Nazwa bez konta z biblioteki reklam (rodzaj reguły `advertiser_name`) jest w `notAloneKinds`, jak płatnik reklamy. Stały identyfikator konta z biblioteki reklam łączy jak dotąd. Reklama inwestycyjna z konta nazwanego jak lokalna firma albo osoba prywatna dostaje atrybut „konto reklamowe prawdopodobnie przejęte (nazwa nie pasuje do treści)” i jej nazwa nie daje żadnego śladu.
- **Persona nie dzieli kampanii.** Operator robi testy A/B twarzy (aktor czy polityk, deepfake czy nie), więc w jednej kampanii persona się zmienia. Persona jest tylko cechą grupy: różne twarze przy tym samym backendzie formularza to jedna kampania, ta sama twarz na różnej infrastrukturze to dwie kampanie, najwyżej w jednej grupie.
- **Kwoty zysku opisują scenariusz.** Wiarygodne kwoty z okresem („3 tys. w ciągu dnia”, „4000 zł tygodniowo”) z tekstu, strony, OCR i transkrypcji są atrybutem `profitClaims`. Zestaw par kwota i okres (`profit_claim`, 0,2) łączy tylko w grupę (`familyOnlyKinds`). Standardowa wpłata (250 USD/EUR, „minimalny depozyt”) zostaje w atrybucie, ale nie w śladzie.

| Ślad | Waga | Reguła |
|---|---|---|
| `campaign_param` z formularza albo skryptu | 0,8 | jak parametr z adresu; `click_id` bez śladu |
| `crm_key` (skrót klucza API CRM) | 0,95 | łączy sam |
| `template_phrase` (zdanie szablonu, ≥ 2 domeny) | 0,45 (z wpadką ×1,3, maks. 0,65) | `notAloneKinds` |
| `page_template` z przykładowego numeru | 0,35 | `notAloneKinds` |
| `advertiser` z samej nazwy | 0,6 | `notAloneKinds` (`advertiser_name`) |
| `profit_claim` (kwota + okres) | 0,2 | `familyOnlyKinds` |

Na 25 sprawach jury F1 par się nie zmienił (0,897, 14 kampanii); jedna grupa podobnych kampanii urosła o kampanię, którą łączy z nią przykładowy numer z tego samego szablonu formularza (liczby: Raport I23).

### 5.3 Odcisk tekstu (zadanie I25)

Teksty stron krążą między operatorami: te same zmyślone komentarze, ten sam pasek „powiązanych artykułów” i ten sam kod pułapek trafiają na strony różnych kont i trackerów. Tekst wskazuje więc dostawcę tekstów albo zestaw stron, czyli najwyżej grupę podobnych kampanii. Do kampanii zawsze potrzebny jest drugi, niezależny ślad operatora.

- **Komunikat ze skryptu zestawu (`kit_string`) łączy zestaw stron.** Skrypty zestawu niosą komunikaty programisty (log w konsoli, błąd, ostrzeżenie), często z literówką. Taki sam komunikat na stronach różnych produktów to odcisk narzędzia, prawie tak specyficzny jak skrót pliku. Narzędzia używa jednak wielu operatorów, więc `kit_string` (0,5) jest w `notAloneKinds` i liczy się do grup. Para stron dostaje jedną przesłankę, gdy dzieli co najmniej dwa komunikaty albo jeden długi (≥ 5 słów); każdy komunikat musi wystąpić w co najmniej dwóch domenach rejestrowalnych, a rzadkość liczy zwykłe IDF z `maxPivotDf`. Czytamy skrypty wpisane w stronę i własne skrypty zewnętrzne (ta sama domena rejestrowalna, z HAR albo z folderu `_files` zapisanej strony, w trybie online tylko GET bez wykonywania). Skryptów z obcych domen nie pobieramy.
- **Maska tekstu platformy.** Platforma stron dostarcza jeden plik SDK dla wszystkich kont, a framework ten sam kod uruchomieniowy na każdej stronie. Bez maski taki tekst skleiłby wszystkie strony platformy. Dlatego (a) napisy ze skryptów o ścieżkach SDK, paczek frameworków i znanych bibliotek nigdy nie są śladem tekstu; (b) zdanie szablonu albo komunikat obecny na stronach co najmniej 5 różnych kont platformy albo na co najmniej 30% stron zbioru (od 10 stron) to tekst platformy; (c) skrypt ze słownikiem tego samego komunikatu w co najmniej 5 językach to lokalizacja interfejsu: strona dostaje atrybut `localizedUi` (kody języków), a napisy z tego skryptu nie tworzą śladów.
- **Napisy wypalone w wideo (B-305, `videoOcrText`).** Co 2 s próbkowana jest klatka wideo (do 30 klatek i 60 s), czytana w całości przez OCR (`pol+eng`); zostają unikalne linie bez krótkich śmieci i napisów odtwarzacza. Tekst („z napisów w wideo”) dołącza do tekstu maszynowego materiału: narracji, obiecywanego zysku, osób i podobieństwa tekstu. Jest atrybutem, nie osobnym śladem łączącym.
- **Bez wniosków o autorze.** Język, typografia i ślady tłumaczenia mogą opisywać materiał, ale nie wskazują narodowości ani tożsamości autora: szablony są tłumaczone, kopiowane i poprawiane przez różne osoby, więc służą tylko jako opis.

| Ślad | Waga | Poziom |
|---|---|---|
| `kit_string` (≥ 2 wspólne komunikaty albo 1 z ≥ 5 słów, ≥ 2 domeny) | 0,5 | `notAloneKinds`: zestaw stron, do kampanii drugi ślad; sam łączy grupę |
| `template_phrase` po masce platformy | 0,45 (z wpadką maks. 0,65) | `notAloneKinds` |
| `localizedUi` | brak | atrybut |

Na 25 sprawach jury kampanie i F1 par się nie zmieniły (0,897, 14 kampanii). `kit_string` dał 4 powiązania; jedno z nich dodało trzecią grupę podobnych kampanii z dwóch spraw bez pary w etykietach roboczych. Liczba powiązań `template_phrase` po masce pozostała ta sama (17), bo zdania szablonu w tych sprawach pochodzą z tekstu stron, a nie z SDK.

### 5.4 Pola rekordu platformy stron: cloaker i launcher (B-331, B-345)

Platforma stron zapisuje w `window.aio.visit.fields` makra wizyty. Część z nich opisuje operatora, nie odwiedzającego:

- `cloaker_account` (waga 0,9, jak Telegram): para `cl_domain` + `cl_sid` usługi cloakingu, która obsługuje wiele stron. `cl_sid` to numer klienta cloakera, `cl_domain` to host cloakera, który go obsługuje. Ta sama para to jedno opłacone konto klienta, czyli jeden operator, tak samo konkretny jak kanał kontaktu. Sam `cl_sid` nie łączy (numery powtarzają się między hostami cloakerów), sama domena też nie (jeden host obsługuje wielu klientów): obie wartości trafiają wtedy tylko do atrybutów materiału. `cl_did` to identyfikator wizyty lub urządzenia: atrybut, bez wagi. `cl_clid` (kliknięcie analityka) jest redagowany razem z resztą danych wizyty.
- `launcher_account` (waga 0,9, jak konto na platformie stron): UUID z `visit.fields.launcher` (albo `visit.launcher`). Na 11 z 12 stron z tym polem w próbce launcher jest równy `owner_uuid`, czyli to ten sam dowód co `platform_account`. Wtedy nie powstaje drugi ślad (nie liczymy jednego dowodu dwa razy), a materiał dostaje tylko atrybut `launcherSameAsOwner`. Bez `owner_uuid` launcher zastępuje właściciela (`platform_account`, jak parametr `launcher=` w linkach platformy). Osobny węzeł powstaje tylko, gdy launcher różni się od właściciela: to konto, z którego uruchomiono reklamy, niezależne od konta stron.
- 16-cyfrowy identyfikator w `fb_campaign_name` (np. „PL(PL) - Nazwa - 1234567890123456 - 2”) trafia do `campaign_param` z kluczem `fb_campaign_name_id=<id>` (waga 0,8). Klucz jest osobny, a nie `campaign_id`, bo nie wiadomo, czy to identyfikator kampanii, czy konta reklamowego.

Ograniczenie: launcher różny od właściciela na jednej stronie i ten sam UUID jako `owner_uuid` na innej nie łączą się przez ten węzeł (różne typy). Na próbce takiego przypadku nie ma.

### 5.5 Identyfikatory kontaktowe i dokumenty z praktyki śledczej (zadanie I28)

Źródło: transkrypcje podcastów śledczych (OSINT Podcast https://www.youtube.com/@OSINTPodcast, Fraud Forward https://www.youtube.com/@FraudForward) i katalog cech z tych odcinków. Prawie wszystko stąd jest **atrybutem materiału**: tłumaczy w przeglądarce i w paczce dowodów, jaki to typ oszustwa i dlaczego, ale nikogo nie łączy. Łączą tylko identyfikatory kontaktowe i dokumenty.

**Co łączy** (rodzaje śladów z wagą jak Telegram, 0,9: wskazują konto albo zasób operatora; rzadkość przez IDF i `maxPivotDf` jak każdy inny ślad):

- `shared_doc`: dokument, arkusz, formularz (Google, Notion, Microsoft Forms, Typeform, Jotform) i udostępniona rozmowa z modelem językowym (usługa `llm_chat`: operator wkleja dane kampanii do czatu i udostępnia link). Klucz `usługa:identyfikator`. Identyfikatory przykładowe z dokumentacji dostawców i strony pomocy są pomijane (lista w `lib/osint/contactConfig.ts`).
- `onion`: adres .onion wersji 3. Adres wersji 2 wygasł w 2021 r., więc jest tylko atrybutem (`onionV2`).
- `fictional_expert` (B-313): tytuł `dr` lub `prof.` z imieniem i nazwiskiem spoza `data/osoby-publiczne.json` (tekst strony, reklamy, OCR, ASR). Klucz: tytuł i imię z nazwiskiem małymi literami, bez polskich znaków i końcówek fleksyjnych; literówki (odległość edycji ≤ 1, ≤ 2 dla długich nazw) są zlewane. Waga 0,75, rzadkość przez IDF i `maxPivotDf`. Zmyślonego eksperta wymyśla jeden operator, więc łączy.
- `c2_host` (B-333): host serwera, do którego skrypt skopiowanego zestawu strony (np. fałszywa biblioteka na darmowym hostingu lub w jsDelivr `gh/`) wysyła ciasteczka lub dane logowania z fałszywego panelu trackera. Wymagane razem: sprawdzenie ścieżki `/admin` lub `/panel` i wysyłka `document.cookie` albo pól hasła do obcego hosta; zwykła biblioteka nie daje nic. Atrybut materiału: `stealerKit` (które sygnały zadziałały). Waga 0,95.
- `messenger_invite`: zaproszenia i konta Discord, Signal, Viber i Line (`usługa:identyfikator`); numer z `wa.me` jest zwykłym telefonem. Serwery społeczności samych platform są pomijane.
- `affiliate_account` (B-330, waga 0,9): konto partnera sieci afiliacyjnej z linku zamówienia (`click.php?team_id=…&user_id=…`), zdekodowanego parametru `referer` (base64) albo ukrytych pól formularza. Klucz to rodzaj, host sieci (host linku albo akcji formularza) i wartość: `stream_id` i `offer_uuid` łączą same; para `team_id`+`user_id` to małe liczby, więc ma relację 0,7 (poniżej progu silnego dowodu) i rodzaj reguły `affiliate_team` w `notAloneKinds`. Bez hosta nic nie łączy. `api_key` trafia do węzła `crm_key` tylko jako SHA-256. `sub1`, `sub2`, `x_id`, `sid`, `cid` są atrybutami węzła.

Źródłem są tekst i atrybuty strony, tekst reklamy, OCR zrzutu i adresy żądań z HAR. Żaden z tych adresów nie jest otwierany: to zasoby operatora, narzędzie czyta tylko zapis.

## 6. Atrybuty, które nie łączą (22.11.2026)

Te cechy pojawiają się w karcie materiału, w opisie kampanii i w paczce dowodów, ale nie mają wagi w grafie i niczego nie łączą. Atrybuty sklepu i infrastruktury są w punkcie 2 („Sygnały sklepu”).

### 6.1 Narracja, marka na kreacji, osoby i inne atrybuty (zadanie I10)

**Atrybuty materiału, kampanii i grupy (nigdy dowód kampanii, bez wyniku ryzyka).**
- **Narracja:** temat (inwestycja, dotacja, zdrowie z podkategoriami, hazard, wybory, „inwestycje dzięki AI”, złoto z NBP, wojna i surowce, „tajemnica”, „nastolatek zarobił”, odzyskanie środków, wydarzenia: mundial, zaprzysiężenie, „państwowa inwestycja”), forma przynęty (fałszywa sensacja, polecenie, fałszywy wywiad), kwoty, data materiału. Kampania i grupa mają podsumowanie narracji, a kampania na jednej infrastrukturze, która zmienia temat w ciągu tygodnia, dostaje opis „ten sam operator, dwie narracje”. Etykieta reguły IHC (`celeb_bait_investment`: osoba z listy oraz obietnica zysku, zaproszenie do grupy albo podrobione medium) jest atrybutem. Paczka dowodów bierze „usługę finansową” z narracji, z cytatem i dopiskiem „(wniosek)”.
- **Podrabiana marka na kreacji** (CLIP zero-shot na liście ok. 20 portali, banków i instytucji) i **grupy osób** z listy osób publicznych („Dziennikarze”) są cechami grupy. **Para osób** w jednym materiale (fikcyjna rozmowa dwóch znanych osób) jest rzadsza niż jedna osoba, więc sama tworzy grupę podobnych kampanii, ale nigdy kampanię.
- **Most i najsłabsze ogniwo:** kampania, którą trzyma razem jeden silny ślad między dwiema podgrupami, ma pole `bridge` („kampania sklejona jednym śladem: X”, kandydat do listy zniżek), a `minInternalScore` pokazuje członka, który wisi najbliżej progu.
- **Wiek domeny i pierwszego certyfikatu** w dniu pierwszej obserwacji materiału, **platforma strony** (np. platforma stron, tracker; tylko atrybut, bez grupy, bo platforma ma tysiące niezwiązanych klientów), **liczba reklam zdjętych przez platformę**, **kolumny wejścia spoza mapowania** („dane z wejścia”).

### 6.2 Techniki, rodzaje numerów i narracje z praktyki śledczej (zadanie I28)

**Co tylko wyjaśnia** (atrybuty, bez wagi; techniki liczą się wyłącznie przy grupach podobnych kampanii, jak inne techniki):

- Techniki strony: fałszywy alarm bezpieczeństwa z numerem telefonu (`fake_security_alert`: alarm + numer jako jedyne wyjście + mechanizm przytrzymania), program do zdalnego pulpitu (`remote_access_tool`), fałszywa weryfikacja z poleceniem do wklejenia (`clickfix_paste`). Z polecenia ClickFix zapisujemy tylko rodzaj i skrót SHA-256 (to ładunek złośliwego oprogramowania); skrót nie jest śladem łączącym, bo wśród rodzajów nie ma „zestawu” pasującego do polecenia.
- Domena pokazana w reklamie różna od strony docelowej (`displayedDomainMismatch`, z flagą znanej marki).
- Rodzaj numeru telefonu (`phoneLines`: komórkowy, stacjonarny, bezpłatny, o podwyższonej opłacie, VoIP) z lokalnych metadanych `libphonenumber-js`, bez wysyłania numeru do usług, oraz flagi `phoneCountryMismatch` i `tollFreeOnAlert`. **Waga numeru się nie zmienia**: numery VoIP i aplikacyjne bywają jednorazowe, dlatego waga telefonu opiera się na rzadkości numeru (IDF), a rodzaj jest tylko wyjaśnieniem.
- Adres, który udaje inny (`idnConfusable`: znak podobny do `/`, `.`, `-` albo mieszane alfabety w jednej etykiecie), dzień tygodnia i godzina startu reklamy z biblioteki reklam (rozkład w kampanii opisuje rytm operatora) i data utworzenia serwera lub konta Discord z identyfikatora w linku („zegar powstania”).
- Narracje i haczyki: tematy fałszywej pomocy technicznej, zwrotu nadpłaty, oferty odzyskania środków (wtórne oszustwo wobec ofiar), oferty pracy, udawanego organu; haczyki tajemnicy, opłaty przed wypłatą i groźby blokady konta.

**Zastrzeżenia ze źródeł.** Numer dzwoniącego i numer z formularza nie dowodzą tożsamości (podszywanie numeru, aplikacje). Wspólny zestaw albo platforma „fraud as a service” nie dowodzi jednego operatora. Brak literówek nie jest już sygnałem legalności, bo teksty piszą modele językowe. Zrzut salda z „platformy” nie dowodzi stanu konta (edycja DOM).

## 7. Przypadki graniczne i twarde negatywy (22.11.2026)

To dwa sposoby sprawdzenia, że narzędzie nie skleja kampanii na podstawie samej podobieństwa.

### 7.1 Przypadki graniczne: celowo nie połączone (zadanie I20)

**Co to jest bliska para.** Para reklam, które są do siebie podobne, a metoda celowo nie połączyła ich w jedną kampanię. Każda taka para ma w zestawieniu regułę, która zablokowała połączenie, i opis tego, czego zabrakło. Zestawienie robi dwie rzeczy. Pokazuje, że metoda pilnuje fałszywych powiązań: wspólna osoba w reklamie, popularny szablon, wspólna platforma, CDN, rejestrator. I daje listę przypadków do przeglądu, gdy wynik pary leży blisko progu. Zestawienie tylko zapisuje decyzje, które metoda i tak podejmuje: nie zmienia wag, progów ani reguł, a kampanie i grupy wychodzą identyczne z tymi sprzed zadania (sprawdzone porównaniem `campaigns.json` na próbce syntetycznej i na 25 sprawach).

**Kiedy para trafia na listę.** Nie jest w jednej kampanii, nie pochodzi z jednej sprawy i spełnia co najmniej jeden warunek: wynik pary ≥ połowa progu łączenia; para ma wspólny ślad silnego typu, który został zdyskontowany (np. domena wspólnej sieci CDN); jej kampanie leżą w jednej grupie podobnych, a ona sama nie jest w kampanii. Połowa progu i limit liczby par (domyślnie 200, najwyższe wyniki) są w konfiguracji (`nearMiss`).

**Reguły (identyfikator, co znaczy):**

- `below-min-score`: wynik pary jest poniżej progu łączenia.
- `family-only-kind`: wynik pochodzi ze śladów, które łączą tylko w grupę (osoba w reklamie, technika strony); bez nich para jest poniżej progu.
- `account-conflict`: reklamy stoją na różnych kontach tej samej platformy stron; platforma daje swoje szablony i biblioteki wszystkim kontom.
- `discounted-only`: jedyne wspólne ślady to infrastruktura używana przez wiele stron (CDN, popularny rejestrator, platforma), po obniżeniu wagi nic nie zostaje.
- `kit-only`: łączy je tylko zestaw stron (szablon, motyw, komentarze, struktura), który kupuje i kopiuje wielu operatorów; brak śladu operatora.
- `content-only-with-infra`: łączy je tylko treść, a któraś reklama ma własną infrastrukturę, której druga nie dzieli.
- `too-few-content-kinds`: reklamy bez infrastruktury łączy jeden rodzaj treści, a kampania wymaga dwóch.
- `too-few-evidence-kinds`: wspólne ślady mają za mało różnych rodzajów, by uznać je za potwierdzone (domyślnie reguła nie występuje, bo wystarcza jeden rodzaj poza zestawem stron i treścią).
- `split-by-clustering`: reguły pozwalały połączyć reklamy, ale podział sieci powiązań na kampanie (Louvain) umieścił je w różnych kampaniach.

**Liczby z przebiegu na 25 sprawach (28 rekordów, 14 kampanii, 3 grupy podobnych; według reguły):** 52 bliskie pary, z tego `below-min-score` 37, `kit-only` 9, `account-conflict` 4, `family-only-kind` 1, `discounted-only` 1; pozostałe reguły 0. Pary, które etykiety zespołu mają w jednej kampanii, a metoda je rozdzieliła (kandydaci na fałszywe rozdzielenie): 0. Zgadza się to z recall pary równym 1,0 w ewaluacji tego przebiegu. Przy `kit-only` i `account-conflict` metoda zadziałała zgodnie z założeniem (wspólny zestaw stron albo konto platformy, nie operator). Pary `below-min-score` mają wyniki od 0,06 do 0,12 (próg 0,15) i łączą je głównie słabe ślady (sieć operatora, technika strony, układ linku śledzącego); do przeglądu warto brać najwyższe wyniki z tej reguły.

**Gdzie to zobaczyć.** `near-misses.json` obok `campaigns.json` (zapisuje go każdy `build-graph`), zakładka „Celowo nie połączone” w przeglądarce, pole `nearMisses` i kolumna `blisko_bez_polaczenia` w wyniku analizy nowego materiału. Format: `docs/TECHNICAL.md`, §5.6.

Bliskie pary z tego przebiegu weszły do zbioru twardych negatywów z prawdziwych materiałów (punkt 7.2), gdzie sprawdzamy, czy narzędzie nie skleja ich w kampanię.

### 7.2 Twarde negatywy z prawdziwych materiałów (zadanie I21)

**Po co.** Najczęstszy błąd narzędzi tego typu to fałszywe sklejenie: dwa materiały różnych operacji w jednej kampanii, bo mają tę samą przynętę. Wcześniejsze testy twardych negatywów były tylko syntetyczne. Teraz mamy zbiór par z prawdziwych materiałów (25 spraw próbki i 212 materiałów walidacji) i stały test w repozytorium, że żadna z nich nie trafia do jednej kampanii. Grupa podobnych kampanii jest dozwolona.

**Sześć kategorii przynęty** (para może mieć kilka):

1. ta sama osoba w reklamie (z listy osób publicznych);
2. ten sam motyw lub narracja (inwestycja, wywiad w mediach, zdrowie, kasyno, oferta sklepu: słowa kluczowe);
3. podobny tekst albo obraz (krawędź podobieństwa w grafie, CLIP, pHash) bez wspólnej pełnowagowej infrastruktury;
4. wspólny ślad zdyskontowany (CDN, platforma, kreator, rejestrator, NS, biblioteka JS, ogólny parametr kampanii);
5. domeny zarejestrowane tego samego dnia albo podobne leksykalnie;
6. strona pusta, błąd pobierania, cloaking albo strona zaparkowana.

Do tego jako osobne źródło bliskie pary z punktu 7.1.

**Metoda doboru.** Bierzemy pary z różnych kampanii według etykiet (etykiety zespołu dla 25 spraw, etykiety walidacji dla pozostałych) i zostawiamy te, które spełniają co najmniej jedną kategorię. Wybór idzie od najtrudniejszych, czyli od najwyższego wyniku pary w grafie, z limitem par na kategorię i na materiał oraz udziału jednego typu pary. **Etykieta „różne kampanie” musi mieć podstawę.** Jeśli obie reklamy mają wspólny pełnowagowy identyfikator operatora (konto platformy stron, serwer kliknięć, tracker albo zarejestrowaną domenę), to według definicji naszych etykiet jest to ta sama kampania. Wtedy para trafia do „niepewnych” i nie liczy się jako negatyw. Inaczej podstawą są różne identyfikatory tego samego typu („inne konta”, „inne domeny”) albo same różne etykiety. W kategoriach z mniej niż trzema parami prawdziwymi dokładamy pary **pochodne**: bierzemy prawdziwą sprawę i podmieniamy jedną warstwę tak, żeby powstała inna operacja z tą samą przynętą. Na przykład ta sama treść i osoba z innym backendem formularza i innym kontem albo ten sam kreator i CDN z inną treścią i innym trackerem. Pary pochodne liczymy osobno. Pomiar ma dwie części: wynik pary we wspólnym grafie (sklejone, tylko grupa, rozdzielone) i leave-one-out, czyli materiał A analizowany jako nowy względem bazy bez całej jego sprawy.

**Wynik (pary prawdziwe, kod po zadaniu I20; para z kilkoma kategoriami liczy się w każdej):**

| kategoria | pary | sklejone | tylko grupa | rozdzielone |
|---|---|---|---|---|
| ta sama osoba | 6 | 0 | 0 | 6 |
| ten sam motyw | 28 | 0 | 12 | 16 |
| podobny tekst lub obraz | 9 | 0 | 8 | 1 |
| wspólny ślad zdyskontowany | 65 | 0 | 20 | 45 |
| podobne domeny | 7 | 0 | 4 | 3 |
| pusta strona | 31 | 0 | 10 | 21 |
| bliskie pary (4e) | 52 | 0 | 12 | 40 |
| **razem (pary bez powtórzeń)** | **97** | **0 (0%)** | **25** | **72** |

Leave-one-out daje to samo: 0 sklejeń. Przed sprawdzeniem podstawy etykiet sklejonych było 25 z 104 wybranych par. Wszystkie 25 okazały się parami bez podstawy: wspólne konto platformy stron przy etykiecie walidacji, która mówi tylko „konto spoza znanych kampanii”, kopia archiwalna sprawy bez własnej etykiety, wariant znanej kampanii zapisany w innym zapisie etykiety, dwie podrodziny jednej domeny. Wśród 200 par bez podstawy narzędzie skleja 51, zawsze przez wspólne konto platformy albo wspólną domenę, czyli zgodnie z definicją kampanii.

**Pary pochodne:** 18 (po 3 w każdej kategorii), sklejone 5. Jedna to błąd generatora: wariant zachował wartość parametru kampanii w formularzu, a to silny ślad operatora. Tę parę wykluczamy z testu. Cztery to znane słabości metody:

- **podobny tekst + domena, do której strona tylko linkuje (1 para).** Kopia strony z tymi samymi zdaniami szablonu linkuje do tej samej domeny co oryginał (cel przycisku, kasa sprzedawcy oferty). Domena z odnośnika ma relację ×0,4 i po mnożeniu przekracza próg zdyskontowanego śladu, więc liczy się jako ślad operatora i razem z zestawem strony tworzy kampanię.
- **dwie puste strony na jednym adresie IP spoza list (3 pary).** Jeden rodzaj śladu operatora wystarcza do kampanii, a IP hostingu współdzielonego wygląda tak samo jak serwer jednego operatora.

**Powtórzenie na commicie `a407767`:** pary prawdziwe 100 (3 nowe bliskie pary), sklejone 0, także w leave-one-out. Pary pochodne: sklejonych 11 z 18. Sześć z nich (persona, trzy z motywu, dwie z domeny) ma wspólny token dostępu Meta: generator par pochodnych powstał przed dodaniem tej cechy i nie podmienia tokenu, a wspólny token to identyfikator operatora, więc to artefakt generatora, nie błąd narzędzia. Pięć to słabości metody: cztery opisane wyżej (domena z odnośnika, trzy puste strony na jednym IP) i jedna nowa: dwie strony z tym samym **zmyślonym ekspertem** i tymi samymi komunikatami zestawu strony tworzą kampanię (zmyślony ekspert ma wagę 0,75 i liczy się jako ślad operatora, a może być przynętą kopiowaną między operatorami). Parę z parametrem kampanii w formularzu generator na tym kodzie już rozdziela.

**Proponowane poprawki sprawdzone bez zmiany kodu** (`--config`): relacja odnośnika ×0,3 usuwa pierwsze sklejenie, ale rozdziela parę jednej kampanii z 25 spraw, która stoi na tym samym wzorcu. IP i system autonomiczny jako ślady, które nie łączą same, usuwają sklejenia pustych stron, ale rozbijają 299 z 878 trafnych par walidacji. Sam system autonomiczny albo samo IP nie usuwają sklejeń. Żadna poprawka nie spełniła warunku „usuwa sklejenie i nie zmienia żadnego trafnego przypisania”, więc `lib/graph/config.ts` zostaje bez zmian. Cztery znane sklejenia są w teście oznaczone jako oczekiwany błąd (`it.fails`). Rozwiązanie wymaga nowych danych, nie wag: liczby domen na adresie IP z pasywnego DNS i rozróżnienia celu odnośnika (własny lander operatora czy usługa wielu klientów).

**Test w repozytorium.** `tests/hardNegatives.real.test.ts` z `tests/fixtures/hard-negatives-real.json`. Plik zawiera 114 par: 97 prawdziwych i 17 pochodnych. Z każdej pary zostaje tylko struktura: typy wspólnych śladów, waga, dyskonto, siła, podobieństwo, to, czy reklama ma infrastrukturę, i konto platformy zastąpione stałą. Domen, identyfikatorów, nazwisk ani tekstów w pliku nie ma (sprawdzone skanerem wycieków). Test sprawdza, że żadna para nie trafia do jednej kampanii, a pary, które grupę tworzą samym swoim powiązaniem (33), trafiają do jednej grupy podobnych. Zastrzeżenia: etykiety są nasze, kategorie motywu i pustej strony wykrywają proste reguły, a odsetek dotyczy wybranych, najtrudniejszych par, nie wszystkich możliwych.

## 8. Duplikaty i „za mało danych”

**Dokładny duplikat** to ta sama reklama zebrana drugi raz. Rozpoznajemy go **tylko** po: tym samym obrazie (dHash ≤ 4 bity i zgodna próba pikselowa), tym samym wideo (ten sam plik po SHA-256 albo klatki CLIP ≥ 0,97 razem z tym samym dźwiękiem na całej długości), tym samym identyfikatorze reklamy, tym samym adresie strony z identycznym szablonem albo identycznej treści strony (SHA-256 zapisanego HTML). Sprawa, której wszystkie pliki (HAR, HTML, zrzuty, wideo) są już we wcześniejszej sprawie tej samej paczki z tym samym SHA-256, też jest duplikatem, nawet gdy tamta ma pliki dodatkowe. Ten sam tekst nie wystarcza, a to samo wideo z innym wstępem to wariant, nie duplikat. Duplikat dostaje kampanię oryginału.

**„Za mało danych”** (`insufficient`, w CSV pole `missing_data`) pojawia się, gdy materiał nie ma adresu, identyfikatora, co najmniej 5 słów treści ani powiązania ponad progiem. Wynik wymienia, co dorzucić (np. „zrzut z widocznym paskiem adresu”). Reklama z formularzem platformy (Lead Ads, napisy „Formularz”, „Wyślij”, „Instant Form” w tekście lub OCR) nie ma strony docelowej, więc zamiast linku dostaje prośbę o identyfikator z Biblioteki Reklam albo link do strony reklamodawcy i zrzut formularza. Lepiej odmówić oceny, niż zgadywać.

## 9. Przypisanie nowego materiału i progi

Nowy materiał trafia do jednego grafu ze znanymi i dostaje jeden z werdyktów: `known_campaign`, `similar_campaigns` (nowa kampania podobna do znanych), `new_campaign`, `duplicate`, `insufficient`.

Progi (wszystkie w `config.ts`, domyślny profil to `DEFAULT_LINK_CONFIG`; plik `--config` tylko dopisuje listy i nadpisuje pola):

| Próg | Wartość | Uzasadnienie |
|---|---|---|
| `minLinkScore` | 0,15 | poniżej tego wynik pary to szum; sama persona (0,1) go nie przekracza |
| `strongThreshold` | 0,7 | dowód silny; poniżej 0,65 zaczęłyby scalać kampanie IP i reklamodawca |
| `familyMinScore` | 0,3 | grupa podobnych wymaga mocniejszego powiązania niż pojedynczy ślad |
| obraz, `imageHamming` | 10 bitów z 64 | duplikat ≤ 4, wariant ≤ 6, różne kreacje na próbce ≥ 16 |
| tekst, `tfidfThreshold` | 0,5 | przeredagowanie tych samych słów; pełne parafrazy wymagają embeddingów (0,86) |
| struktura strony, `dom.hamming` | 6 bitów | |
| obraz CLIP | cosinus ≥ 0,9; ten sam plik wideo ≥ 0,97 z tym samym dźwiękiem | próg nieskalibrowany na danych |
| twarz (persona, `--faces`) | ważony cosinus ≥ próg z pomiaru (docs/TECHNICAL.md), tylko cecha grupy | próg z pomiaru na zdjęciach osób spoza listy |
| głos (łączenie materiałów, `similar_voice`) | cosinus ≥ 0,6 | ten sam mówca 0,86–0,93, różni ≤ 0,34 na nagraniach testowych |
| głos (persona z galerii, `--speaker`) | cosinus okna ≥ 0,5, przewaga ≥ 0,15 nad drugą osobą, co najmniej 2 sąsiednie okna, tylko cecha grupy | próg z pomiaru na nagraniach 11 osób spoza listy (docs/TECHNICAL.md, „Persona z głosu”) |

Dawna „furtka” `singleKindMinScore` (0,5, pojedynczy rodzaj dowodu o dużym wyniku tworzył kampanię) została usunięta w I14c: pozwalała dwóm klonom portalu stać się jedną kampanią.

**`confidence` i `score` to siła przesłanek, nie prawdopodobieństwo.** `score` to wynik noisy-OR ze wzoru wyżej. `confidence` (`certain`, `likely`, `uncertain`) mówi: `certain`, gdy najlepsze powiązanie ma przesłankę silną (waga ≥ 0,7), `likely`, gdy wynik powiązania ≥ 0,5. Żaden z nich nie był skalibrowany na zbiorze z prawdziwymi etykietami, więc „0,8” nie znaczy „80% szans, że to ta sama kampania”.

### 9.1 Harmonogram skanów i „baza rośnie”

**Harmonogram.** `bun run watch` co cykl pyta publiczne źródła (logi CT, biblioteki reklam, urlscan, Listę Ostrzeżeń CERT) o nowe adresy i każdy przepuszcza przez tę samą analizę, co ręcznie zgłoszony materiał (punkt 9); wynik trafia do `data/watch.jsonl`. Przepisy wyszukiwania opierają się na silnych cechach znanych kampanii (najemca platformy stron, adres IP spoza CDN, identyfikator ścieżki, skrót zasobu, para serwerów nazw, rejestrator, pora rejestracji), a potwierdzenie kandydata idzie po infrastrukturze, nie po tytule strony ani samej nazwie domeny: kandydat z CT staje się `confirmed` dopiero przy co najmniej dwóch rodzajach wspólnej infrastruktury (ta sama para NS, godzina rejestracji w oknie kampanii, ten sam adres IP, ten sam skrót treści). Wartość widoczna w jednej kampanii i w innej (domyślne serwery nazw rejestratora, wspólny hosting) nie jest cechą żadnej z nich i nie potwierdza. Lista Ostrzeżeń CERT jest używana tylko z obowiązkowym filtrem RDAP/NS (rejestrator, pora rejestracji, para NS): sam wzorzec nazwy daje setki fałszywych trafień. Źródło, którego nie da się zapytać (brak sieci, klucza, strumienia), zostawia w raporcie cyklu powód pominięcia. Wiersz `campaign` przy werdykcie innym niż `known_campaign` to najbliższa kampania z odcisku nazw (podpowiedź źródła), nie wynik analizy.

**Baza rośnie.** Analiza niczego nie dopisuje do bazy; robi to dopiero `--add-to-base` (CLI), `watch --add-to-base` (harmonogram, domyślnie tylko `known_campaign`) i przycisk w przeglądarce. Dopisujemy rekord i dane wzbogacone, których użyło porównanie, bez ponownego liczenia cech; graf i kampanie przebudowujemy offline. Duplikatu nie dopisujemy, „za mało danych” tylko wymuszone (`--force`), bo materiał, którego nie da się porównać, nie pomaga następnym. Kampanie zachowują numery: nowy klaster dostaje numer starej kampanii, z którą dzieli najwięcej rekordów, a klaster bez poprzednika nowy numer; dzięki temu sprawa, raport czy odnośnik „K07” nie zmieniają znaczenia po dopisaniu materiału. Przed zapisem poprzednie pliki bazy trafiają do `<baza>/historia/<czas>/`, każde dopisanie ma wpis w `<baza>/dodane.jsonl` (czas, źródło `cli`/`watch`/`gui`, identyfikator, werdykt w chwili dodania), a pliki są zastępowane przez zmianę nazwy pliku tymczasowego. Automatyczne dopisywanie z harmonogramu ma jedną wadę: błędnie przypisany materiał zostaje w bazie i wpływa na kolejne wyniki, więc `historia/` pozwala wrócić do stanu sprzed zmiany.

### 9.2 Korekty analityka (`corrections.json`)

Analityk nie edytuje grafu ręcznie. Zapisuje decyzje w pliku `corrections.json` (domyślnie obok `campaigns.json`, `build-graph --corrections plik.json`; w przeglądarce przyciski przy powiązaniu i śladzie zapisują ten plik przez `/api/corrections`), a `build-graph` stosuje je przy następnym przebiegu. Trzy rodzaje decyzji (`lib/graph/corrections.ts`):

- **Połączenie (`mustLink`)**: dwa materiały należą do jednej kampanii. Powstaje silne powiązanie z przesłanką „decyzja analityka”.
- **Rozdzielenie (`cannotLink`)**: dwa materiały nie mogą być w jednej kampanii. Bezpośrednie powiązanie jest cięte, a jeśli inne powiązania nadal trzymają je razem, tną się powiązania między dwiema stronami kampanii (każdy członek idzie do strony, której jest bliżej), aż podział się utrzyma. Rozdzielenie wygrywa z połączeniem.
- **Wyłączony ślad (`disabledPivots`)**: wspólny ślad (identyfikator węzła, np. domena) przestaje liczyć się jako dowód, np. gdy okazał się infrastrukturą wspólną.

Każde powiązanie zmienione decyzją zostaje w grafie z dopiskiem „decyzja analityka: …”, a kampania, której decyzja dotyczy, wymienia ją w `analystNotes` (widoczne w przeglądarce). Format pliku i trasa API: `docs/TECHNICAL.md`, §5.8.

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

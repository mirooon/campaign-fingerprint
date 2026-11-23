/**
 * Registry of the highlighted traces of docs/CECHY.md: the traces that typical OSINT tools (WHOIS, DNS,
 * IP, urlscan, image hash) do not give, with how we read them and what they did on the organiser's
 * sample. Only aggregate counts of the sample run are written here, never its values (domains, IDs,
 * account or campaign names). Every key must exist in TYPE_INFO (pivot types) or FEATURE_INFO
 * (material attributes); collectCatalog reports a missing one under "No description".
 */

/** One highlighted trace or a group of traces read by the same mechanism. */
export interface FeatureHighlight {
  /** Stable id of the entry. */
  id: string;
  /** Heading of the entry. */
  title: string;
  /** Pivot types covered by the entry (keys of TYPE_INFO). */
  types: string[];
  /** Material attributes covered by the entry (keys of FEATURE_INFO). */
  attributes: string[];
  /** How the trace is read (the mechanism). */
  how: string;
  /** What typical tools (WHOIS, DNS, IP, page scanners, image hash) do not see. */
  missed: string;
  /** What the trace did on the organiser's sample: aggregate counts only. */
  sample: string;
}

/** The sample run the counts in `FeatureHighlight.sample` come from. */
export const HIGHLIGHTS_SAMPLE = { materials: 28, commit: "1107e62" } as const;

/** Highlighted traces, in the order they appear in docs/CECHY.md. */
export const FEATURE_HIGHLIGHTS: FeatureHighlight[] = [
  {
    id: "platform-record",
    title: "Record of the page-builder panel",
    types: ["path_id", "platform_account", "platform_campaign", "cloaker_account", "launcher_account"],
    attributes: ["platformSourceIds", "landingName", "trafficSource"],
    how: "The page builder writes its configuration record into the code of the page. From it we read the account owner's ID, the campaign name given by the traffic buyer, the page name in the panel, the traffic source, the cloaker customer number (cl_sid) and the account the ads were launched from (launcher). The builder also assigns a random ID that comes back in the file paths of the page.",
    missed: "Domains and IP addresses change every few days, but the panel account stays. Neither WHOIS, DNS nor a page scan shows who bought the traffic in the panel and which cloaker it went through.",
    sample: "Platform account read in 14 of 28 samples. Strong evidence in pairs: the ID in file paths in 28 pairs, the account in 30, the panel campaign in 17. The cloaker customer and the launcher account occurred once each, without a pair in the sample, so a test checks their linking.",
  },
  {
    id: "meta-token",
    title: "Meta access token left in the code of the page",
    types: ["meta_token"],
    attributes: [],
    how: "Operators paste into the page the token of the Meta ad account they send conversion events with: in the URL (token=), in the page-builder record (fb_capi_token) or in a script. We keep only the start of its sha256 hash (12 characters), never the token itself.",
    missed: "Page scanners see the Meta pixel, and the pixel number gets changed and shared. The token belongs to one ad account and ends up on the page through the operator's carelessness.",
    sample: "6 different tokens, strong evidence in 13 pairs.",
  },
  {
    id: "click-server",
    title: "Click server read from the click ID",
    types: ["click_server"],
    attributes: ["clickTime", "clickCounter"],
    how: "A click ID in the xid format (12 bytes) holds the time, the machine ID, the process number and the counter of the tracker. We decode it: the same machine and the same process mean the same redirect server, the time is the moment of the click, and the counter grows with every ID that process issues.",
    missed: "The tracker sits behind the redirect and leaves no domain of its own on the landing page. The click ID looks like a random string, so tools skip it.",
    sample: "Time and counter read in 3 samples. One pair: a sample from the organiser's first batch linked to a sample from the second batch through the same tracker server.",
  },
  {
    id: "meta-ad",
    title: "Ad number from the link and the approximate date the ad was created",
    types: ["meta_ad"],
    attributes: ["metaAdId", "metaAppId", "adCreatedApprox"],
    how: "The new format of the fbclid parameter in a link carries the ID of the clicked ad and of the app. Meta IDs grow over time, so from other ads with a known date we estimate when a given ad was created.",
    missed: "The ad library searches by its own number, while the link gives the ad number from the advertiser's panel. Without decoding fbclid this number is lost in a long parameter.",
    sample: "Ad number read in 8 of 28 samples. Each concerned a different ad, so in the sample the trace linked no pairs. It serves the timeline and recognising another showing of the same ad.",
  },
  {
    id: "stealer-kit",
    title: "Trojan in a stolen page kit",
    types: ["c2_host"],
    attributes: ["stealerKit"],
    how: "Some page kits circulate with a trojan added. A fake library (e.g. lazysizes or jQuery from free hosting) checks whether the browser is in the tracker panel (/admin, /panel) and sends cookies or login data to a foreign server. We flag the kit and record the address of the C2 server.",
    missed: "A scanner sees a known library name and does not look inside. Here fraudsters rob other fraudsters, and all copies of the kit report to one server, so its address links the copies.",
    sample: "1 sample with such a kit, without a pair in the sample. A test checks linking by the C2 server.",
  },
  {
    id: "text-fingerprint",
    title: "Text fingerprint: developer messages and template sentences",
    types: ["kit_string", "template_phrase"],
    attributes: [],
    how: "From the scripts of the page we take developer messages (console log, error, warning), often with a typo. From the page text and the thank-you note after the form is sent we take rare sentences; a sentence with a slip (a repeated word, mixed scripts) weighs more. Only text present on several domains counts, and the texts of platforms, frameworks and known libraries are masked.",
    missed: "The page hash changes with every swapped image, price or domain. A typo in a log and an odd sentence pass from copy to copy unchanged.",
    sample: "Shared developer message in 4 pairs, shared template sentence in 17 pairs. Both traces link only together with another trace.",
  },
  {
    id: "comments-lead-flow",
    title: "Fake comments and a shared lead funnel",
    types: ["comment_block", "lead_flow"],
    attributes: [],
    how: "The “readers’” comments are hard-coded into the page. We record the set of authors, and common first names, frequent in the blocks of other pages, weigh less. From the code of pages of one platform we take the form ID, the list of flows and the event key of the lead funnel.",
    missed: "The comment block looks like a site plugin, and the funnel starts working only after the form is sent. An infrastructure scan sees neither.",
    sample: "The same comment block in 15 pairs. A shared funnel in 1 pair of pages from different accounts and different ad platforms: the result is a group of similar campaigns with one lead supplier.",
  },
  {
    id: "video-montage",
    title: "Video montage fingerprint",
    types: ["overlay_template", "reused_footage"],
    attributes: [],
    how: "In the frames of the recording we look for a blurred or covered bar at the bottom of someone else's video and for the operator's captions. We record the kind, colour, position and size relative to the frame, rounded to 5%. In the corners of the frame we read the logo of the studio or channel the footage was taken from; logos of editors and platforms (CapCut, TikTok and others) are skipped.",
    missed: "Image comparison and frame hashes see a different video, because the operator takes different footage each time. The caption layout and the source logo stay the same.",
    sample: "Caption template in 1 sample, 2 different source logos; no pair in the sample. A test checks the linking.",
  },
  {
    id: "voice-gallery",
    title: "Voice of a public figure from a closed gallery",
    types: ["similar_voice"],
    attributes: ["personas", "personaCategories"],
    how: "We cut the audio track into 4 s windows, drop silence and music alone, compute a speaker vector (ECAPA) and compare it with a gallery of 10 public figures. The result is “voice similar to X (0.57)” for a human to review, and the persona is a feature of a group of similar campaigns. The same vector links two recordings with the same voice.",
    missed: "Fake-voice detectors judge whether a recording is synthetic, and their error on real ads (EER) is 25–60%. We only need to know whose voice the recording imitates.",
    sample: "Measured on recordings outside the sample (docs/METODYKA.md): the same person recognised in 70 of 70 recordings, a false hit in 1 of 25 recordings of other people, and 5 of 5 fakes from the public NASK compilation assigned to the right person.",
  },
  {
    id: "fictional-expert",
    title: "Fictitious expert",
    types: ["fictional_expert"],
    attributes: ["fictionalExperts", "expertNotInRegister"],
    how: "We look for the title “dr” or “prof.” with a full name that is not on the list of public figures, in the ad, the screenshot, the recording and on the page. Spelling variants are merged across the whole dataset. An optional plugin checks the name in the register of doctors and adds a label.",
    missed: "People recognition looks for known faces and names. A fictitious doctor does not exist outside the campaign, so his name links its samples.",
    sample: "4 names in 2 samples, without a pair in the sample. A test checks the linking.",
  },
  {
    id: "origin-traces",
    title: "Traces in addresses and code: a fake address, the Discord clock, an earlier version",
    types: [],
    attributes: ["idnConfusable", "discordSnowflakes", "foreignPersona", "residue"],
    how: "We flag an address in which a character imitates “/”, “.” or “-” or mixes scripts. From the upper bits of a Discord server or account ID we read the date it was created. A persona from another country in the ad name of a Polish version and an old paragraph commented out in the code suggest that the kit was moved from another market or from an earlier campaign.",
    missed: "These are features of the content and the identifiers. They are not in the domain records, in DNS or in an infrastructure scan.",
    sample: "An old version commented out in 15 of 28 samples, a persona from another country in 1. The sample had no address imitating another and no Discord link; tests check how it works.",
  },
];

/** Pivot types marked with a star in the table of docs/CECHY.md section 1. */
export function highlightedTypes(highlights: FeatureHighlight[] = FEATURE_HIGHLIGHTS): Set<string> {
  return new Set(highlights.flatMap((h) => h.types));
}

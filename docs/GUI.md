# Interface: how to run an analysis

*Polish version: tag `hacknation-2026`.*

To run it: `bun run pipeline --offline` (example base), then `bun run dev` and open `http://localhost:3000`.
Your own base: `VIEWER_DATA_DIR=<folder with graph.json, campaigns.json, enriched.json> bun run dev`.

Tabs at the top: Analyze sample (default) · Campaigns · Link graph · Compare · Deliberately not linked · How it works · New domains · Recognized people · Data quality. The “Expert mode” link next to the header opens a view for people who know the method (full graph, thresholds, “New ad” panel).

## Analyzing a sample, step by step

1. In the “Analyze sample” tab, drop files, a folder or a ZIP into the frame, or use “Choose folder” / “Choose files”. You can also enter a **Link** or **Ad text or product name** (on their own or together with files).
2. Check the upload preview. The “Case · Files · Notes” table shows what the tool recognized; each case has icons of its file kinds (table below) and notes, e.g. “HAR without a saved page”, “screenshots only: we will read the URL from the browser address bar”, “video from the page (HLS): we will join the segments into one recording”. Kinds that the analysis does not read on their own are marked in yellow. Untick the cases you do not want to analyze (a case without files to analyze is disabled).
3. Check “Split into cases”. The default split is a suggestion (sometimes with a question in a yellow box). You can change it: **one case**, **each subfolder is a case**, **each file is a separate sample**. Files of a saved page (the `*_files` folder, `resources/`, scripts, styles, images, video from the page) join their page and are not separate cases. Several loose ZIPs with no other loose files give a separate case for each archive by default.
4. The “Fetch public domain data (DNS, domain registry)” box is ticked by default: we ask public registries about the domains in the sample, and we do not open scam pages in a browser. Untick it when you work without internet access.
5. “Analyze (number of cases)”. The run appears below: a counter of cases and elapsed time, the state of each case (waiting, running, done, error) and a collapsed “Technical log”. The URL with `?job=` returns to the same job after a page refresh. “New analysis” clears the view.
6. Without your own files you can click “Load example”: a made-up ad, checked without internet access.

| Icon in the preview | What we do with it |
|---|---|
| screenshot | text (OCR) and the URL from the browser address bar |
| HAR | URLs, redirects, server responses |
| page | page structure, form, scripts; we do not open the page |
| page part | images, scripts, styles, video and the save manifest: attached to the page |
| video, video description | text from the frames and from the address bar; the description (e.g. from yt-dlp) gives title, channel, date |
| HLS video | the `.m3u8` playlist and the `.ts` segments are joined into one recording and analyzed like a video (frames; speech, faces and voice only from the command line, see below) |
| ZIP | a case with only a ZIP can be analyzed too: the server unpacks the archive during the analysis (also when files are uploaded one by one), and all its content belongs to the case the ZIP is in; the preview does not look inside. An archive with many cases in subfolders: unpack it and upload it as a folder |
| dataset file (CSV, JSON) | not analyzed in the interface yet; use `bun run analyze-material -- --dataset <file>` |
| system file, unsupported | skipped |

Upload limit: none by default. Files go one at a time and are streamed to disk (progress bar in the upload step), so a batch of many GB does not end up in memory. On a public address, set `MATERIAL_MAX_MB` and `MATERIAL_MAX_FILES`.

What the analysis started from the browser does (`lib/viewer/materialRunner.ts`): OCR of screenshots and frames, the address bar, reading pages and HAR, comparison with the base, and, with the box from step 4 ticked, also DNS, RDAP and ASN. Transcription (`--asr`), audio fingerprint (`--audio`), voice (`--speaker`), faces (`--faces`), CLIP (`--clip`) and the ad library (`--ad-library`) are **outside the browser**: you switch them on in `bun run analyze-material` or when building the base. So the “face similar” and “voice similar” rows in the result card appear only for a result from such an analysis or for samples from the base.

## Result

- **Funnel**: Files · Samples · Duplicates · Links to the base · Known campaigns · New campaigns · Insufficient data. Clicking a number filters the table. The sentence bar below the funnel (“to known campaigns”, “new, similar”, “new”, “duplicates”, “insufficient data”) works the same way.
- **Sample table**: screenshot thumbnail, verdict, campaign, confidence, main evidence item, data completeness. Sorting “by verdict” or “by confidence”, filter “uncertain: to check”. The plus at the end of a row expands the **result card** (with a single sample it is expanded straight away).
- **New campaigns from this batch**: samples without a match in the base that link to each other, with the “Download evidence pack” button (see below).
- **Export**: CSV and JSON buttons above the table (columns as in `bun run analyze-material --csv`).
- The “?” sign next to a term opens its explanation from the glossary. The same glossary, plus the five stages of the method and the evidence strength scale, is in the “How it works” tab.

### Verdict

| Verdict | Meaning |
|---|---|
| Known campaign | the sample shares traces with a campaign from the base above the linking threshold |
| New campaign, similar to… | the same template, narrative or persona, but different operators; “Kept apart because” gives the reason |
| New campaign | no link crosses the threshold |
| Duplicate | the same ad collected again; the original and its campaign are shown |
| Insufficient data | the sample has no features to compare; the “What to add” list says what is missing |

Confidence: **certain** (an evidence item of high strength), **likely** (link strength at least 0.5), **uncertain**. A variant assigned on its creative alone is never “certain”. A campaign “based on content, without infrastructure” has a weaker basis than a shared account or server.

Evidence strength: High (links on its own) · Medium (counts together with others) · Needs corroboration (needs a second kind of trace) · Discounted (trace shared by many independent sites) · Description, not evidence. Each level has a word, an icon and a style, not only a colour.

### Result card

From the top: the verdict and one sentence of explanation (buttons “Show campaign”, “Compare with the closest sample”, “Add to base”) · the verdict scale with thresholds · “Why?” (evidence items, the strongest by default) · “Why not another campaign?” (rejected candidate campaigns with the reason) · “What we recognized” · **click route** · **Sample features** · “Shop” (shop features explain why the page looks suspicious; they do not link campaigns) · “Data completeness”.

- **Sample features** are grouped into four families, with the number of features and the number shared with the base. Each row has the feature's name, value, source and role; compound features (e.g. object links, route, platform account) are written out readably, not as raw JSON. URLs are defanged. “Show raw data” shows the full features of the sample. The page family also holds the techniques (including “shop trick”). Separate boxes: platform account warnings and “Page author's notes” (comments and texts from the page code).
- **Click route**: the steps ad → tracking link → redirects → landing page, each with its role, status, domain age relative to the ad run (RDAP) and a cloaking warning.
- **What we recognized**: “face similar to X (0.57)” and “voice similar to X (0.70)” (when faces and voice were switched on in the command line): for a human to check, never “this is X”. Also the impersonated brand, narrative, and domain and certificate age.

## What to do with the result

- **Add to base** (next to the result of a new or known campaign, and above the batch table): adds the sample to the base, so that the next analysis finds it. After adding, a message says what was added, what was not and why (duplicate, insufficient data, ID already in the base); then the base is refreshed. The example base (`data/`) and the “Load example” result are read-only: the button is disabled and the reason is shown next to it. To add samples, copy the base and run with `VIEWER_DATA_DIR=<copy>`. The previous base files go to `<base>/historia/`.
- **Download evidence pack**: a ZIP with the campaign's evidence (`evidence.json`, a list for CERT, a DSA Article 16 notice template, a SHA-256 manifest). Sending a report is a human decision. Contents: [TECHNICAL.md](TECHNICAL.md) (Polish).
- **Analyst decision** (campaign card, “Campaigns” tab): “to report”, “reported”, “rejected”, “to verify”, saved in `decyzje.json` next to the base. “Rejected” and “to verify” block the evidence pack (with a message next to the button); no decision does not block it. The code has no buttons for correcting a verdict or the make-up of a campaign.

## Other views

- **Campaigns**: a list with filters (narrative, page-builder platform, period), a campaign card with a matrix of shared traces, evolution and timeline, the click route of the first sample, “New domains of this campaign”, printing and the evidence pack.
- **Link graph**: reduced view (campaigns and shared traces; a click expands a campaign into its samples, or a trace into other campaigns). Full graph: the “full” toggle or Expert mode.
- **Compare**: two samples side by side, the share of feature families with percentages, and shared text fragments (at least four words).
- **Deliberately not linked**: pairs that look similar but that the method does not link, with the reason.
- **New domains**: candidates from the CT feed, with the certificate time relative to the first ad.
- **Recognized people**: people from the face and voice gallery, with the number of templates and the source of the entry; no vectors.
- **Data quality**: how many samples have no screenshot, page, HAR, URL or video.
- **Expert mode**: the “New ad” panel (the same analysis in a single request, `/api/analyze-material`, without jobs and progress), a linking threshold slider with the number of campaigns from the backend clustering (an approximation: the graph keeps the strongest links of each ad). The old `/api/analyze` route no longer has a path in the GUI ([TECHNICAL.md](TECHNICAL.md) §8.1).

The “synthetic data” label is shown in the header when the base is the example data shipped with the repository, and next to the “Load example” result.

## Environment variables

`VIEWER_DATA_DIR`, `MATERIAL_WORK_DIR` (job files, a temporary folder by default), `MATERIAL_MAX_MB` and `MATERIAL_MAX_FILES` (upload limit in MB and in number of files; no limit by default, files go one at a time and are streamed to disk), `MATERIAL_TIMEOUT_MS`, `LINK_CONFIG`, `PERSONAS_FILE`, `BUN_BIN`.

## Dependencies added for the GUI

`lucide-react` (ISC, icons), `fflate` (MIT, ZIP unpacking on the server). Full list: [LICENCJE.md](../LICENCJE.md) (Polish).

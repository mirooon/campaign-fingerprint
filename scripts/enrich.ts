/** bun run enrich -- [--offline] [--items data/work/items.json] [--out data/work/enriched.json] */
import { DEFAULTS, runEnrich } from "../lib/pipeline/steps";
import { cli, main } from "./_cli";

const args = cli(
  {
    items: { type: "string" },
    out: { type: "string" },
    offline: { type: "boolean" },
    fixtures: { type: "string" },
    concurrency: { type: "string" },
    skip: { type: "string" },
    personas: { type: "string" },
    ner: { type: "boolean" },
    cloaking: { type: "boolean" },
    ocr: { type: "boolean" },
    asr: { type: "boolean" },
    audio: { type: "boolean" },
    clip: { type: "boolean" },
    speaker: { type: "boolean" },
    faces: { type: "boolean" },
    "verify-person": { type: "string" },
    "ad-library": { type: "boolean" },
    "company-registry": { type: "boolean" },
    archive: { type: "string" },
    "no-archive": { type: "boolean" },
    "archive-lookup": { type: "boolean" },
  } as const,
  `Usage: bun run enrich -- [--offline] [--fixtures data/sample/fixtures] [--items ...] [--out ...] [--concurrency 4] [--skip ct,rdap,favicon,image,dns,asn,page]
  [--personas list.json] [--ner] [--cloaking] [--ocr] [--asr] [--audio] [--clip] [--speaker] [--faces [--verify-person <person id>]] [--ad-library] [--company-registry] [--archive data/work/archive | --no-archive] [--archive-lookup]
Live mode makes passive queries only (1 GET per page/redirect, DNS, RDAP, crt.sh, Team Cymru) with a cache in .cache/.
--cloaking: two extra plain GETs (UA of the platform crawler and of a mobile browser). --ocr/--asr/--audio work only with the tools installed. --clip: local CLIP model (~350 MB, downloaded on first use).
--speaker: speaker voice from the video (SpeechBrain ECAPA, venv from scripts/py/setup-speaker.sh, model ~85 MB on first use).
--verify-person <id>: 1:1 verification at the person's request, compared only with the photos of that person (id from data/osoby-publiczne.json).
--faces: faces in images, screenshots and video frames; "face similar to X (0.xx)" only for people in data/osoby-publiczne.json, for review (OpenCV YuNet + SFace, venv from scripts/py/setup-face.sh, models ~40 MB outside the repo).
--archive-lookup: for a page that does not respond, looks for a public copy in urlscan.io and the Internet Archive (Wayback) and adds it with its source and date; passive, it requests and saves nothing. Sources: ARCHIVE_SOURCES (default urlscan,wayback), optional key URLSCAN_API_KEY. (--archive is the folder with the saved HTML of the pages.)
--ad-library: ad details from the Meta ad library by library ID (MetaAdsCollector, no API key; live only).
--company-registry: the VAT white list (by NIP) and the current KRS extract (by KRS number) for numbers found on pages: name, registered address, status, entry date, no personal data; flags for a name or address mismatch, removal, company age vs domain age. Off by default, live only. Sends the numbers to external services: do not run on case samples without the data owner's consent.`,
);

void main(async () => {
  await runEnrich({
    items: args.items ?? DEFAULTS.items,
    out: args.out ?? DEFAULTS.enriched,
    offline: !!args.offline,
    fixtures: args.fixtures ?? DEFAULTS.fixtures,
    concurrency: args.concurrency ? Number(args.concurrency) : undefined,
    skip: args.skip ? args.skip.split(",") : [],
    personas: args.personas ?? (args.items ? undefined : DEFAULTS.personas),
    ner: !!args.ner,
    cloaking: !!args.cloaking,
    ocr: !!args.ocr,
    asr: !!args.asr,
    audio: !!args.audio,
    clip: !!args.clip,
    speaker: !!args.speaker,
    faces: !!args.faces,
    facesOnly: args["verify-person"],
    adLibrary: !!args["ad-library"],
    companyRegistry: !!args["company-registry"],
    archive: args["no-archive"] ? null : (args.archive ?? DEFAULTS.archive),
    archiveLookup: !!args["archive-lookup"],
  });
});

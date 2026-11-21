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
    "ad-library": { type: "boolean" },
    archive: { type: "string" },
    "no-archive": { type: "boolean" },
  } as const,
  `Użycie: bun run enrich -- [--offline] [--fixtures data/sample/fixtures] [--items ...] [--out ...] [--concurrency 4] [--skip ct,rdap,favicon,image,dns,asn,page]
  [--personas lista.json] [--ner] [--cloaking] [--ocr] [--asr] [--audio] [--clip] [--speaker] [--ad-library] [--archive data/work/archive | --no-archive]
Tryb live wykonuje wyłącznie pasywne zapytania (1 GET na stronę/przekierowanie, DNS, RDAP, crt.sh, Team Cymru) z cache w .cache/.
--cloaking: dwa dodatkowe zwykłe GET-y (UA crawlera platformy i przeglądarki mobilnej). --ocr/--asr/--audio działają tylko z zainstalowanymi narzędziami. --clip: lokalny model CLIP (~350 MB, pobierany przy pierwszym użyciu).
--speaker: głos mówcy z wideo (SpeechBrain ECAPA, venv z scripts/py/setup-speaker.sh, model ~85 MB przy pierwszym użyciu).
--ad-library: szczegóły reklamy z biblioteki reklam Mety po identyfikatorze biblioteki (MetaAdsCollector, bez klucza API; tylko live).`,
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
    adLibrary: !!args["ad-library"],
    archive: args["no-archive"] ? null : (args.archive ?? DEFAULTS.archive),
  });
});

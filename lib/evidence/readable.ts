/**
 * Plain-language pieces of evidence.md: names of trace types from the GUI dictionary, the main
 * reason an ad is in the campaign, the similarity methods that actually produced premises, and a
 * marker for infrastructure shared by many independent sites. Pure functions; the GUI dictionary
 * (lib/viewer/plain.ts) stays the one source of the names.
 */
import { typeInfo } from "../viewer/plain";
import type { SharedTrace } from "./traces";

/** Name of a trace type as the GUI shows it ("domain" → "Domena"); the raw type when the dictionary has none. */
export function traceTypeName(type: string): string {
  return typeInfo(type)?.name ?? type;
}

/**
 * Main reason an ad is in the campaign: the strongest trace it shares with another ad (`traces` is
 * ordered strongest first), with a count of the other shared traces; a sentence saying so when it
 * has none of its own (it was joined through other ads).
 */
export function whyInCampaign(adId: string, traces: SharedTrace[]): string {
  const own = traces.filter((t) => t.ads.includes(adId));
  if (!own.length) return "brak wspólnego śladu z innymi reklamami (połączona przez pośrednie ogniwa)";
  const rest = own.length - 1;
  return `${traceTypeName(own[0].type)}: ${own[0].value}${rest ? ` (+${rest} ${rest === 1 ? "ślad" : "ślady"})` : ""}`;
}

/** Method key of the pack (`similarity_methods`) that each similarity edge type belongs to. */
const METHOD_OF_EDGE: Record<string, string> = {
  similar_image: "image",
  similar_image_semantic: "image",
  similar_text: "text",
  similar_dom: "dom",
  similar_audio: "audio",
  similar_voice: "audio",
};

/** The similarity methods of the pack that gave at least one premise (edge types seen in the campaign's links), each described in words with its threshold. */
export function methodsWithPremises(methods: Record<string, string>, edgeTypes: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of edgeTypes) {
    const key = METHOD_OF_EDGE[e];
    if (key && methods[key] && !out[key]) out[key] = `${typeInfo(e)?.name ?? e}: ${methods[key]}`;
  }
  return out;
}

const SHARED_INFRA = /cloudflare/i;

/** Marker for a name server or network name of Cloudflare (many independent sites behind one name); null for any other. */
export function sharedInfrastructureNote(name: string): string | null {
  return SHARED_INFRA.test(name) ? "wspólne dla wielu niezależnych stron, nie łączy" : null;
}

/** Match kinds of the CT watcher with Polish labels (no dependencies: safe for client bundles). */
export type CtMatchKind = "template" | "template_other_tld" | "brand" | "media" | "lorem_kit";

/** Kind of a feed record: a CT match kind, or `watch` for a row of the scan scheduler. */
export type CtFeedKind = CtMatchKind | "watch";

export const MATCH_KIND_LABELS: Record<CtFeedKind, string> = {
  template: "ten sam szablon nazwy domeny",
  template_other_tld: "ten sam szablon nazwy, inna domena najwyższego poziomu",
  brand: "marka z leksykonu w kontekście kampanii",
  media: "podszycie pod medium + słowo kampanii",
  lorem_kit: "ten sam generator nazw (inne słowo kotwicy)",
  watch: "trafienie harmonogramu skanów (źródło, przepis i potwierdzenia niżej)",
};

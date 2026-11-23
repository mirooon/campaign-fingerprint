/** Match kinds of the CT watcher with readable labels (no dependencies: safe for client bundles). */
export type CtMatchKind = "template" | "template_other_tld" | "brand" | "media" | "lorem_kit";

/** Kind of a feed record: a CT match kind, or `watch` for a row of the scan scheduler. */
export type CtFeedKind = CtMatchKind | "watch";

export const MATCH_KIND_LABELS: Record<CtFeedKind, string> = {
  template: "same domain name template",
  template_other_tld: "same name template, different top-level domain",
  brand: "lexicon brand in a campaign context",
  media: "media impersonation + campaign word",
  lorem_kit: "same name generator (different anchor word)",
  watch: "scan scheduler hit (source, recipe and confirmations below)",
};

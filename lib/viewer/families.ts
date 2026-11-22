/**
 * The four families of features (§6.4): Treść, Wygląd, Strona, Infrastruktura.
 * One place that maps every entity type, similarity type and material feature key to a family.
 */
import type { EntityType, SimilarityEdgeType } from "@/lib/graph/model";

export type FeatureFamily = "content" | "look" | "page" | "infra";

export const FAMILY_ORDER: FeatureFamily[] = ["content", "look", "page", "infra"];

export const FAMILY_LABEL: Record<FeatureFamily, string> = {
  content: "Treść",
  look: "Wygląd",
  page: "Strona",
  infra: "Infrastruktura",
};

export const FAMILY_HINT: Record<FeatureFamily, string> = {
  content: "tekst reklamy, odczyt ze zrzutu, transkrypcja, persona, reklamodawca",
  look: "kreacja, podobny obraz, favicon, podrabiana marka",
  page: "szablon i kod strony, formularz, skrypty, komentarze, sposób działania",
  infra: "domena, rejestrator, serwery, certyfikat, trackery, konta i identyfikatory",
};

export const TYPE_FAMILY: Record<EntityType | SimilarityEdgeType, FeatureFamily | null> = {
  item: null,
  // Treść
  advertiser: "content",
  persona: "content",
  similar_text: "content",
  // Wygląd
  imagehash: "look",
  similar_image: "look",
  similar_image_semantic: "look",
  favicon: "look",
  similar_audio: "look",
  similar_voice: "look",
  // Strona
  similar_dom: "page",
  endpoint: "page",
  hidden_fields: "page",
  asset: "page",
  comment: "page",
  page_template: "page",
  comment_block: "page",
  technique: "page",
  // Infrastruktura
  url: "infra",
  host: "infra",
  domain: "infra",
  ip: "infra",
  asn: "infra",
  nameserver: "infra",
  registrar: "infra",
  cert: "infra",
  tracker: "infra",
  domain_pattern: "infra",
  cname_target: "infra",
  campaign_param: "infra",
  param_schema: "infra",
  company_id: "infra",
  bank_account: "infra",
  path_id: "infra",
  platform_account: "infra",
  platform_campaign: "infra",
  click_server: "infra",
  meta_ad: "infra",
  ad_payer: "infra",
  wallet: "infra",
  email: "infra",
  phone: "infra",
  telegram: "infra",
};

/** Feature keys of a material (`MaterialItemResult.features`, item node data) and their family. */
export const FEATURE_FAMILY: Record<string, FeatureFamily> = {
  text: "content",
  ocrText: "content",
  asrText: "content",
  advertiser: "content",
  personas: "content",
  adLibraryIds: "content",
  advertiserImpersonatesName: "content",
  adPlatform: "content",
  adLibraryAdId: "infra",
  adAdvertiserId: "infra",
  adAdvertiserLegalName: "content",
  adAdvertiserLocation: "content",
  adAdvertiserVerified: "content",
  adRegions: "content",
  adFirstShown: "content",
  adLastShown: "content",
  uiView: "content",
  impersonatedBrand: "look",
  imagePath: "look",
  dhash: "look",
  domSimhash: "page",
  techniques: "page",
  cyrillic: "page",
  cloakingSuspected: "page",
  landingUrl: "infra",
  finalUrl: "infra",
  landingSource: "infra",
  landingFragment: "infra",
  observedUrls: "infra",
  inAppBrowser: "infra",
  platformCampaignName: "infra",
  landingName: "infra",
  trafficSource: "infra",
  platformAccount: "infra",
  metaAdId: "infra",
  metaAppId: "infra",
  clickTime: "infra",
  clickCounter: "infra",
  firstSeen: "content",
};

/** Family of an evidence / pivot type; unknown types fall into Infrastruktura. */
export function familyOf(type: string | null | undefined): FeatureFamily | null {
  if (!type) return null;
  return (TYPE_FAMILY as Record<string, FeatureFamily | null>)[type] ?? "infra";
}

export function featureFamily(key: string): FeatureFamily {
  return FEATURE_FAMILY[key] ?? "content";
}

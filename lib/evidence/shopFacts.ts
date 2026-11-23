/**
 * Fake-shop signals and contact data of a landing page as facts of the evidence pack (evidence.json, evidence.md).
 *
 * Every flag comes with the figure or quote it rests on. They are explanations for the reader of the pack, not
 * proof and not a basis of the link between the ads: honest shops also lack the 30-day price, take one payment
 * method or show only five-star reviews. The postal address is the one trace: it only supports a link.
 * Pure functions.
 */
import type { PageExtract } from "../osint/extract";
import { applyShopContext } from "../osint/shopSignals";
import { ADDRESS_COMPLETENESS_LABEL, EMAIL_DOMAIN_KIND_LABEL, SHOP_FLAG_INFO, TECHNIQUE_LABEL } from "../viewer/plain";

export interface ShopFacts {
  flags: Array<{ flag: string; name: string; detail: string }>;
  techniques: string[];
  payment_methods: string[];
  discounts: { priced_items: number; discounted_share: number; median_discount_pct: number | null; max_discount_pct: number | null };
  delivery_days: { min: number; max: number } | null;
  reviews: { count: number; share_5: number | null; window_days: number | null; anonymous_share: number | null; source: string } | null;
  footer: { name: string | null; year: number | null };
  claimed_since: { year: number | null; quote: string } | null;
  /** Kind of the domain of each e-mail address (the domain, not the whole address). */
  email_domains: Array<{ domain: string; kind: string }>;
  address: { completeness: string; quote: string | null };
}

/**
 * Shop facts of a page, or null when the page is not a shop and has no contact data worth stating.
 * `firstSeen` (ISO) dates the footer-year check.
 */
export function shopFacts(extract: PageExtract | null | undefined, firstSeen: string | null | undefined): ShopFacts | null {
  const shop = extract?.shopSignals ? applyShopContext(extract.shopSignals, { firstSeen }) : null;
  if (!shop) return null;
  const contact = extract?.contact;
  return {
    flags: shop.flags.map((f) => ({ flag: f, name: SHOP_FLAG_INFO[f].name, detail: shop.details[f] ?? SHOP_FLAG_INFO[f].what })),
    techniques: shop.techniques,
    payment_methods: shop.paymentMethods,
    discounts: {
      priced_items: shop.discounts.pricedItems,
      discounted_share: shop.discounts.discountedShare,
      median_discount_pct: shop.discounts.medianDiscountPct,
      max_discount_pct: shop.discounts.maxDiscountPct,
    },
    delivery_days: shop.deliveryDays,
    reviews: shop.reviews
      ? { count: shop.reviews.count, share_5: shop.reviews.share5, window_days: shop.reviews.windowDays, anonymous_share: shop.reviews.anonymousShare, source: shop.reviews.source }
      : null,
    footer: { name: shop.footerBrand, year: shop.footerYear },
    claimed_since: shop.claimedSince ? { year: shop.claimedSince.year, quote: shop.claimedSince.quote } : null,
    email_domains: (contact?.emailDomains ?? []).map((e) => ({ domain: e.domain, kind: e.kind })),
    address: { completeness: contact?.address.completeness ?? "none", quote: contact?.address.quote ?? null },
  };
}

/** Markdown of the shop facts of the ads, one block per ad; empty when no ad has a shop page. */
export function renderShopSignals(ads: Array<Record<string, unknown>>): string {
  const blocks: string[] = [];
  for (const a of ads) {
    const f = a.shop_signals as ShopFacts | null | undefined;
    if (!f) continue;
    const lines = [`**${String(a.item_id)}**`];
    lines.push(...(f.flags.length ? f.flags.map((x) => `- ${x.name}: ${x.detail}`) : ["- none of the shop features occurred"]));
    if (f.techniques.length) lines.push(`- sales tricks: ${f.techniques.map((t) => TECHNIQUE_LABEL[t] ?? t).join(", ")}`);
    if (f.payment_methods.length) lines.push(`- payment methods: ${f.payment_methods.join(", ")}`);
    lines.push(`- address on the page: ${ADDRESS_COMPLETENESS_LABEL[f.address.completeness] ?? f.address.completeness}${f.address.quote ? ` (“${f.address.quote}”)` : ""}`);
    if (f.email_domains.length) lines.push(`- domains of e-mail addresses: ${f.email_domains.map((e) => `${e.domain} (${EMAIL_DOMAIN_KIND_LABEL[e.kind] ?? e.kind})`).join(", ")}`);
    blocks.push(lines.join("\n"));
  }
  return blocks.length
    ? `#### Shop signals (explanations)\n\n${blocks.join("\n\n")}\n\nThese features explain why the page looks like a fake shop. Honest shops also lack the lowest price of the last 30 days, take one payment method or show only 5/5 reviews, so they do not link the ads into a campaign and are not proof. The registered address only supports a link: it can be copied from someone else\'s page.\n\n`
    : "";
}

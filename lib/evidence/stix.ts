/**
 * Campaign as a STIX 2.1 bundle for the institutions' own tools (MISP imports STIX): the campaign,
 * infrastructure and indicators (domain, URL, IP, wallet, phone number, ad-library ID, image dHash),
 * the impersonated person as a target, model results as a note, TLP 2.0 marking on every object.
 * Written directly as JSON, no library and no server. Identifiers derive from the content, so the
 * same campaign gives the same bundle. Domains on shared infrastructure are left out: they are not
 * an indicator of one operator. Pure; writing the file stays with pack.ts.
 */
import { createHash } from "node:crypto";
import type { CampaignFacts } from "./facts";

/** TLP 2.0 marking definitions (OASIS cti-stix-common-objects), by the pack's TLP name. */
const TLP_MARKING: Record<string, string> = {
  "TLP:CLEAR": "marking-definition--94868c89-83c2-464b-929b-a1a8aa3c8487",
  "TLP:GREEN": "marking-definition--bab4a63c-aed9-4cf5-a766-dfca5abac2bb",
  "TLP:AMBER": "marking-definition--55d920b0-5e8b-4f79-9ee9-91f868d9b421",
  "TLP:AMBER+STRICT": "marking-definition--939a9414-2ddd-4d32-a0cd-375ea402b003",
  "TLP:RED": "marking-definition--5e57c739-391a-4eb3-b6be-7d15ca92d5ed",
};

export interface StixExtras {
  /** TLP of the pack; an unknown value falls back to TLP:AMBER, the pack's default. */
  tlp: string;
  /** Addresses of the landing pages, as observed (already redacted). */
  urls: string[];
  /** dHash of the creatives (hex). */
  imageHashes: string[];
  /** Model results as sentences ("model output, a hint"); they become one note. */
  modelNotes: string[];
  /** CERT register position id per domain, when the domain is on the list. */
  certRegisterIds: Record<string, string>;
}

type StixObject = Record<string, unknown> & { type: string; id: string };

/** Deterministic STIX id: `<type>--<uuid>` with the uuid taken from the SHA-256 of type and key (version 5 layout). */
function stixId(type: string, key: string): string {
  const h = createHash("sha256").update(`${type}|${key}`).digest("hex");
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${type}--${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/** A value inside a STIX pattern string: backslash and single quote escaped. */
const lit = (v: string): string => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** The bundle for one campaign. */
export function buildStixBundle(f: CampaignFacts, x: StixExtras): { type: "bundle"; id: string; objects: StixObject[] } {
  const marking = TLP_MARKING[x.tlp] ?? TLP_MARKING["TLP:AMBER"];
  const markingName = TLP_MARKING[x.tlp] ? x.tlp : "TLP:AMBER";
  const when = f.createdUtc;
  const base = (type: string, key: string): StixObject => ({ type, spec_version: "2.1", id: stixId(type, key), created: when, modified: when, object_marking_refs: [marking] });
  const domains = f.domains.filter((d) => !d.shared_infrastructure);

  const campaign: StixObject = {
    ...base("campaign", f.campaignId),
    name: `Campaign ${f.campaignId}`,
    description: `Campaign ${f.campaignId}: ${f.ads.length} ${f.ads.length === 1 ? "ad" : "ads"}, ${domains.length} ${domains.length === 1 ? "domain" : "domains"} (evidence pack ${f.packageId}). The link between the ads is a hint from the tool, for a human to verify.`,
    ...(f.firstSeenUtc ? { first_seen: f.firstSeenUtc } : {}),
    ...(f.lastSeenUtc ? { last_seen: f.lastSeenUtc } : {}),
  };
  const objects: StixObject[] = [{ type: "marking-definition", spec_version: "2.1", id: marking, created: "2022-10-01T00:00:00.000Z", name: markingName, definition_type: "tlp", definition: { tlp: markingName.slice(4).toLowerCase() } }, campaign];
  const relate = (type: string, source: StixObject, target: StixObject): void => {
    objects.push({ ...base("relationship", `${source.id}|${type}|${target.id}`), relationship_type: type, source_ref: source.id, target_ref: target.id });
  };
  const indicator = (name: string, pattern: string, extra: Record<string, unknown> = {}): void => {
    const ind: StixObject = { ...base("indicator", pattern), name, pattern, pattern_type: "stix", valid_from: f.firstSeenUtc ?? when, indicator_types: ["malicious-activity"], ...extra };
    objects.push(ind);
    relate("indicates", ind, campaign);
  };

  for (const d of domains) {
    const infra: StixObject = { ...base("infrastructure", d.domain), name: d.domain, infrastructure_types: ["phishing"] };
    objects.push(infra);
    relate("uses", campaign, infra);
    indicator(`Domain ${d.domain}`, `[domain-name:value = ${lit(d.domain)}]`, x.certRegisterIds[d.domain] ? { x_cert_register_position_id: x.certRegisterIds[d.domain] } : {});
    for (const ip of new Set(d.ips.map((i) => i.ip))) indicator(`IP address ${ip}`, `[${ip.includes(":") ? "ipv6-addr" : "ipv4-addr"}:value = ${lit(ip)}]`);
    for (const p of d.payment_identifiers) indicator(`Wallet ${p}`, `[x-cryptocurrency-wallet:address = ${lit(p.slice(p.indexOf(":") + 1))}]`);
    for (const c of d.contact_points.filter((c) => /^\+?[\d\s().-]{7,}$/.test(c))) indicator(`Phone ${c}`, `[x-phone-number:value = ${lit(c)}]`);
  }
  for (const u of new Set(x.urls)) indicator(`URL ${u}`, `[url:value = ${lit(u)}]`);
  for (const a of f.ads) if (a.ad_ids.ad_library_id) indicator(`Ad library ad ${a.ad_ids.ad_library_id}`, `[x-ad-library-record:id = ${lit(a.ad_ids.ad_library_id)}]`, { x_ad_library_id: a.ad_ids.ad_library_id });
  for (const h of new Set(x.imageHashes)) indicator(`Image dHash ${h}`, `[x-image-dhash:value = ${lit(h)}]`);
  for (const p of f.personas) {
    const person: StixObject = { ...base("identity", p), name: p, identity_class: "individual", description: "Person whose image or name was used in the ads (target of the impersonation)." };
    objects.push(person);
    relate("targets", campaign, person);
  }
  if (x.modelNotes.length) objects.push({ ...base("note", f.campaignId), abstract: "Model outputs (hints, not proof)", content: x.modelNotes.join("; "), object_refs: [campaign.id] });
  return { type: "bundle", id: stixId("bundle", f.packageId), objects };
}

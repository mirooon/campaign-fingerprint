/**
 * Contact identifiers beyond e-mail, phone, Telegram and WhatsApp (I28): shared documents and forms
 * (Google, Notion, Microsoft Forms, Typeform, Jotform), shared chats with a language model, onion addresses
 * and invitations to Discord, Signal, Viber and Line. Each names an account or an asset of the operator, so
 * the same identifier on two materials is a trace like a shared `t.me` account. Pure functions over text:
 * the caller feeds the visible text, attribute values, an OCR of a screenshot or the request addresses of a
 * HAR. Nothing here opens an address: these are the operator's resources, only the written form is read.
 */
import { CONTACT_CONFIG } from "./contactConfig";

export interface ContactIds {
  /** Keys `<service>:<id>` of shared documents, forms and chats (service `llm_chat` for a chat with a language model). */
  sharedDocs: string[];
  /** Version 3 onion addresses (56 characters, lower case, without ".onion"). */
  onion: string[];
  /** Version 2 onion addresses (16 characters): an attribute of the material, never a trace. */
  onionV2: string[];
  /** Keys `<service>:<id>` of messenger invitations and accounts: discord, signal, signal_group, viber, line. */
  messengers: string[];
}

/** Matches of one pattern as `{ index, value }`, the value taken from capture group `group`. */
function matchesOf(text: string, pattern: RegExp, group: number): Array<{ index: number; value: string }> {
  const out: Array<{ index: number; value: string }> = [];
  for (const m of text.matchAll(pattern)) if (m[group]) out.push({ index: m.index ?? 0, value: m[group] });
  return out;
}

/** Values in order of appearance in the text, each once. */
function inTextOrder(hits: Array<{ index: number; value: string }>): string[] {
  return [...new Set(hits.sort((a, b) => a.index - b.index).map((h) => h.value))];
}

/**
 * Keys of the shared documents, forms and chats written in the text, in order of appearance. The id of a
 * Notion or chat address is lower-cased (UUIDs, hex ids and host names are not case-sensitive, so an OCR in
 * capitals gives the same key); other ids keep their case. Sample ids of vendor documentation and the
 * vendors' own Notion pages are left out.
 */
function sharedDocsOf(text: string): string[] {
  const cfg = CONTACT_CONFIG.sharedDocs;
  const excluded = new Set<string>(cfg.excludedIds);
  const vendorSites = new Set<string>(cfg.excludedNotionSites);
  const lower = new Set<string>(cfg.caseInsensitiveServices);
  const hits: Array<{ index: number; value: string }> = [];
  for (const { service, pattern, group } of cfg.patterns) {
    for (const h of matchesOf(text, pattern, group)) {
      if (excluded.has(h.value)) continue;
      if (service === "notion_site" && vendorSites.has(h.value.split(".")[0].toLowerCase())) continue;
      hits.push({ index: h.index, value: `${service}:${lower.has(service) ? h.value.toLowerCase() : h.value}` });
    }
  }
  return inTextOrder(hits);
}

/** Keys of the messenger invitations written in the text, in order of appearance, without the platforms' own community servers. */
function messengersOf(text: string): string[] {
  const cfg = CONTACT_CONFIG.messengers;
  const officialCodes = new Set<string>(cfg.excludedCodes);
  const hits: Array<{ index: number; value: string }> = [];
  for (const h of matchesOf(text, cfg.discord, 1)) {
    if (!officialCodes.has(h.value.toLowerCase())) hits.push({ index: h.index, value: `discord:${h.value}` });
  }
  for (const h of matchesOf(text, cfg.signalPerson, 1)) hits.push({ index: h.index, value: `signal:${h.value}` });
  for (const h of matchesOf(text, cfg.signalGroup, 1)) hits.push({ index: h.index, value: `signal_group:${h.value}` });
  for (const h of matchesOf(text, cfg.viber, 1)) hits.push({ index: h.index, value: `viber:+${h.value}` });
  for (const h of matchesOf(text, cfg.line, 1)) hits.push({ index: h.index, value: `line:${h.value}` });
  return inTextOrder(hits);
}

/** Shared documents, onion addresses and messenger invitations written in `text` (empty lists for an empty text). */
export function findContactIds(text: string): ContactIds {
  if (!text) return { sharedDocs: [], onion: [], onionV2: [], messengers: [] };
  const lower = (v: string) => v.toLowerCase();
  const onion = (re: RegExp) => inTextOrder(matchesOf(text, re, 1).map((h) => ({ ...h, value: lower(h.value) })));
  return {
    sharedDocs: sharedDocsOf(text),
    onion: onion(CONTACT_CONFIG.onion.v3),
    onionV2: onion(CONTACT_CONFIG.onion.v2),
    messengers: messengersOf(text),
  };
}

export interface DiscordSnowflake {
  /** The id as written (17 to 20 digits). */
  id: string;
  kind: "guild" | "channel" | "user";
  /** UTC creation time decoded from the id (ISO 8601): the clock of the account or server. */
  createdAt: string;
}

/**
 * Creation dates of the Discord ids in links ("discord.com/channels/<server>/<channel>", "discord.com/users/<id>"):
 * the upper bits of an id count milliseconds since the Discord epoch, so a server or account created
 * shortly before a campaign says how fresh the operator's presence is. An attribute for the reviewer, never a
 * trace. Ids that decode to a date before the service existed or to the future are dropped.
 */
export function discordSnowflakes(text: string): DiscordSnowflake[] {
  if (!text) return [];
  const cfg = CONTACT_CONFIG.discordSnowflake;
  const out: DiscordSnowflake[] = [];
  const add = (id: string | undefined, kind: DiscordSnowflake["kind"]) => {
    if (!id || out.some((o) => o.id === id && o.kind === kind)) return;
    const ms = Number((BigInt(id) >> 22n) + BigInt(cfg.epochMs));
    if (ms >= cfg.earliestMs && ms <= Date.now()) out.push({ id, kind, createdAt: new Date(ms).toISOString() });
  };
  for (const m of text.matchAll(cfg.pattern)) {
    add(m[1], "guild");
    add(m[2], "channel");
    add(m[3], "user");
  }
  return out;
}

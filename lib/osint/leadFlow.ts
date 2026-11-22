/**
 * Lead funnel of a landing-page platform (B-332).
 *
 * Pages built on one platform write the form and the lead routing into the page: `visit.form_uuid`, the
 * UUIDs of the form fields, `visit.flow_uuids` (the funnels the visit may go to; the page's own
 * `flow_uuid` is a per-buyer value and is left out), the key id of the event encryption and the host the
 * form events are sent to. Two pages that share them use one lead funnel: a network or an offer, not
 * necessarily one buyer, so the trace is a page-kit trait (campaignRules.notAloneKinds). Values that
 * every account of the platform carries are removed by the frequency mask of the graph.
 * Pure functions, no network access.
 */

const UUID_SRC = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_G = new RegExp(UUID_SRC, "gi");
/** `form_uuid":"<uuid>"` in the page's JSON record (any quoting or escaping up to six characters). */
const FORM_UUID = new RegExp(`form_uuid\\W{1,6}(${UUID_SRC})`, "i");
const FLOW_UUID = new RegExp(`\\bflow_uuid\\W{1,6}(${UUID_SRC})`, "i");
/** `flow_uuids":"[a,b]"` or an array or an object: the UUIDs up to the closing bracket of the value. */
const FLOW_UUIDS = /flow_uuids\W{1,6}([^}\]]{0,400})/gi;
const FIELD_UUID = new RegExp(`["']?(email|phone|first_name|last_name|name|surname)(?:_uuid|_id)?["']?\\s*:\\s*["'](${UUID_SRC})["']`, "gi");
const ENC_KEY = /LANDING_ENCRYPTION_KEY_ID\s*[=:]\s*['"]([A-Za-z0-9_-]{3,40})['"]/;
const EVENT_HOST = /LANDING_FORM_EVENT_BACKEND_DOMAIN\s*[=:]\s*['"]([A-Za-z0-9.-]{3,100})['"]/;
const MAX_TOKENS = 16;

/**
 * Lead-funnel tokens of a page, sorted and unique: `form:<uuid>`, `field:<name>:<uuid>`, `flow:<uuid>`,
 * `key:<id>`, `evhost:<host>`. Empty when the page carries none (or only empty values).
 */
export function leadFlowTokens(html: string): string[] {
  const out = new Set<string>();
  // cheap gate: the platform record or its script constants must be there at all (keeps 2 MB inputs fast)
  const hasForm = html.includes("form_uuid");
  const hasFlows = html.includes("flow_uuids");
  const hasConst = html.includes("LANDING_");
  if (!hasForm && !hasFlows && !hasConst) return [];
  const form = hasForm ? FORM_UUID.exec(html) : null;
  if (form) out.add(`form:${form[1].toLowerCase()}`);
  for (const m of hasForm ? html.matchAll(FIELD_UUID) : []) out.add(`field:${m[1].toLowerCase()}:${m[2].toLowerCase()}`);
  const own = hasFlows ? FLOW_UUID.exec(html)?.[1].toLowerCase() : undefined;
  for (const m of hasFlows ? html.matchAll(FLOW_UUIDS) : []) {
    for (const u of m[1].match(UUID_G) ?? []) if (u.toLowerCase() !== own) out.add(`flow:${u.toLowerCase()}`);
  }
  const key = hasConst ? ENC_KEY.exec(html) : null;
  if (key) out.add(`key:${key[1]}`);
  const host = hasConst ? EVENT_HOST.exec(html) : null;
  if (host) out.add(`evhost:${host[1].toLowerCase()}`);
  return [...out].sort().slice(0, MAX_TOKENS);
}

/** Human-readable label of a lead-funnel token (Polish, for the graph). */
export function leadFlowLabel(token: string): string {
  const [kind, ...rest] = token.split(":");
  const v = rest.join(":");
  const short = (s: string) => `${s.slice(0, 8)}…`;
  switch (kind) {
    case "form":
      return `formularz ${short(v)}`;
    case "field":
      return `pole formularza ${v.split(":")[0]} ${short(v.split(":")[1] ?? "")}`;
    case "flow":
      return `lejek ${short(v)}`;
    case "key":
      return `klucz szyfrowania zdarzeń ${v}`;
    case "evhost":
      return `serwer zdarzeń formularza ${v}`;
    case "src":
      return `źródło ruchu ${short(v)}`;
    default:
      return token;
  }
}

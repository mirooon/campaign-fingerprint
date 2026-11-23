"use client";

import { nodeTypeLabel } from "@/lib/viewer/fields";
import { type EntityType, type GraphNode, type PairEvidence } from "@/lib/graph/model";
import { personaMentions, PERSONA_SOURCE_LABELS, weightFormula, weightPartsOf } from "./compare";
import { holdersOf, pathLabel, type GraphIndex } from "./graphView";
import { TYPE_COLORS } from "./palette";
import { DisablePivotButton, PairCorrection, WrongLinkButton } from "./CorrectionButtons";
import { ReadHow } from "./Guide";

/**
 * Premise written by an analyst decision (`ANALYST_PREMISE` of lib/graph/corrections.ts, which reads files and cannot be
 * imported here); the Polish prefix is still accepted for graphs built before the English labels.
 */
const isAnalystPremise = (ev: PairEvidence) => /^(?:analyst decision|decyzja analityka)/i.test(ev.evidence);

/** Analyst premises first, so a decision is never cut off by the evidence limit. */
const analystFirst = (evidence: PairEvidence[]) => [...evidence].sort((x, y) => Number(isAnalystPremise(y)) - Number(isAnalystPremise(x)));

export interface DetailsPanelProps {
  node: GraphNode | null;
  idx: GraphIndex;
  onSelect: (id: string) => void;
  /** Open the comparison panel with ad `a` (and optionally `b`). */
  onCompare?: (a: string, b?: string) => void;
}

const DATA_LABELS: Record<string, string> = {
  platform: "Platform",
  advertiser: "Advertiser",
  firstSeen: "First shown",
  lastSeen: "Last shown",
  landingUrl: "Landing URL",
  label: "Label (ground truth)",
  dhash: "Image dHash",
  registrar: "Registrar",
  created: "Created",
  expires: "Expires",
  nameservers: "Name servers (NS)",
  mx: "MX",
  certCount: "Certificates in CT",
  issuer: "Issuer",
  notBefore: "Valid from",
  notAfter: "Valid to",
  sanDomains: "Names in SAN",
  sanCount: "Number of names in SAN",
  asns: "ASN",
  asName: "Operator",
  prefix: "Prefix",
  country: "Country",
  kind: "Kind",
  trackerId: "ID",
  address: "Address",
  url: "URL",
  mmh3: "Hash Shodan (mmh3)",
  sha256: "SHA-256",
  domains: "Domains",
  parked: "Parked page",
  whatsapp: "WhatsApp",
  registrableDomain: "Domain (eTLD+1)",
  isIdn: "IDN (punycode)",
  host: "Host",
  pathTemplate: "Path (template)",
  sameOrigin: "On the page domain",
  method: "Method",
  via: "Detected in",
  fields: "Fields",
  path: "Path",
  basename: "File",
  cyrillic: "Cyrillic",
  template: "Pattern",
  agnostic: "Variant without TLD",
  literalChars: "Fixed characters",
  domainCount: "Number of domains",
  targets: "CNAME targets",
};

/** Labels that depend on the entity type (the same key means different things). */
const DATA_LABELS_BY_TYPE: Partial<Record<EntityType, Record<string, string>>> = {
  campaign_param: { name: "Parameter", canonicalName: "Canonical name", value: "Value", macro: "Unfilled macro", sourceUrl: "Example URL" },
  persona: { name: "Full name", role: "Public role" },
  asset: { kind: "File type" },
};

const VIA_LABELS: Record<string, string> = {
  form: "form (action)",
  fetch: "fetch()",
  xhr: "XMLHttpRequest",
  axios: "axios",
  jquery: "$.ajax / $.post",
  literal: "API path in the code",
};

const HIDDEN = new Set(["text", "imagePath", "imageUrl", "weightParts", "burst", "crtshId", "serial", "ahash", "width", "height", "status", "whatsappGroup"]);

/** Item attributes rendered in their own section (not in the generic table). */
const ITEM_ATTRIBUTE_KEYS = new Set([
  "personas", "deepfakeScore", "cyrillic", "cloakingSuspected", "cloakingReasons", "ocrText", "asrText", "finalUrl", "domSimhash",
  "observedUrls", "inAppBrowser", "landingSource", "landingFragment",
  "landerPlatform", "platformAccount", "platformCampaignName", "landingName", "trafficSource", "cloakerInSource", "impersonatedBrand", "clickTime", "clickCounter", "metaAdId", "metaAppId",
]);

/** Item facts read from the page and the link (platform records, decoded click IDs), label first. */
const ITEM_FACTS: Array<[string, string]> = [
  ["observedUrls", "URL from the address bar (OCR of screenshot / recording)"],
  ["inAppBrowser", "In-app browser"],
  ["landingSource", "Source of the page URL (input / ad text / address bar)"],
  ["landingFragment", "URL fragment (#…)"],
  ["platformCampaignName", "Page-builder campaign"],
  ["landingName", "Page name in the platform panel"],
  ["trafficSource", "Traffic source set by the buyer"],
  ["platformAccount", "Page-builder account (owner_uuid)"],
  ["impersonatedBrand", "Impersonated brand (from the page title)"],
  ["metaAdId", "Meta ad ID (from fbclid)"],
  ["metaAppId", "app_id from fbclid"],
  ["clickTime", "Click time (from xid clickid)"],
  ["clickCounter", "Tracker server counter (from xid clickid)"],
];

/** Short notes for the new pivot types: what sharing them means. */
const TYPE_NOTES: Partial<Record<EntityType, string>> = {
  endpoint: "Backend the page sends form data to. A shared backend on different domains is one of the strongest pieces of evidence; public form services and generic paths are discounted.",
  hidden_fields: "Set of hidden form field names (without generic fields such as csrf/_token).",
  asset: "The page's own JS/CSS file. Popular libraries and generic file names are discounted.",
  comment: "Normalized HTML/JS comment. Standard tracker and CMS comments are discounted.",
  domain_pattern: "Domain name pattern with placeholders <n> (digits) and <lorem> (a lorem ipsum word); created only when it covers at least two domains.",
  cname_target: "Shared CNAME record target. Large CDNs and hosting platforms are discounted.",
  campaign_param: "Campaign parameter from the URL (utm_*, sub1–5, aff_id, clickid…). Generic values (e.g. facebook, cpc) and unfilled macros are discounted.",
  persona: "Weak signal: the same person is often used in many campaigns. Used for filtering and priorities, not for linking. No biometric data.",
  path_id: "Random ID (UUID) in the paths of resources loaded from the page domain: an account of a page builder that serves many domains.",
  param_schema: "Link parameter names and the kind of their values. Points to a traffic routing system that may have many clients: supporting evidence.",
  platform_account: "Owner account written by the page-builder platform into the page code (window.aio, owner_uuid). Same account = same operator; different accounts of the same platform are not linked by weaker evidence.",
  platform_campaign: "Campaign in the page-builder panel (uuid and name given by the traffic buyer). Strong evidence: the same campaign runs the same pages.",
  page_template: "Page template on the platform (lander_template_uuid). The same template on different accounts is the same kit, so similar campaigns, not one campaign.",
  click_server: "A click ID in xid format holds the machine and process ID of the tracker. The same server routes traffic to both pages: shared infrastructure, medium evidence.",
  ad_payer: "Payer and beneficiary declared to Meta (DSA transparency), read from the ad library by the library ID. The same payer on different ads = one paying account; the advertiser types the name, so generic names (e.g. “ABC”) link more weakly.",
  meta_ad: "The new fbclid format holds the ID of the clicked ad (ad ID from the Marketing API, not the Ad Library ID). Same ID = same ad.",
};

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  const s = String(v);
  // ISO timestamps: date only at midnight, otherwise "YYYY-MM-DD HH:MM"
  if (/^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z?$/.test(s)) return s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 16).replace("T", " ");
  return s;
}

function fmtValue(type: EntityType, key: string, v: unknown): string {
  if (type === "endpoint" && key === "via" && typeof v === "string") return VIA_LABELS[v] ?? v;
  return fmt(v);
}

function ItemAttributes({ node, idx, onSelect }: { node: GraphNode; idx: GraphIndex; onSelect: (id: string) => void }) {
  const d = node.data;
  const personas = personaMentions(idx, node.key);
  const score = typeof d.deepfakeScore === "number" ? d.deepfakeScore : null;
  const reasons = Array.isArray(d.cloakingReasons) ? d.cloakingReasons.filter((r): r is string => typeof r === "string") : [];
  const ocr = typeof d.ocrText === "string" && d.ocrText ? d.ocrText : null;
  const asr = typeof d.asrText === "string" && d.asrText ? d.asrText : null;
  const finalUrl = typeof d.finalUrl === "string" && d.finalUrl ? d.finalUrl : null;
  const simhash = typeof d.domSimhash === "string" && d.domSimhash ? d.domSimhash : null;
  const facts = ITEM_FACTS.filter(([k]) => d[k] !== undefined && d[k] !== null && d[k] !== "");
  const hasAny = personas.length > 0 || score !== null || d.cyrillic === true || typeof d.cloakingSuspected === "boolean" || ocr || asr || finalUrl || simhash || facts.length > 0;
  if (!hasAny) return null;
  return (
    <section className="space-y-2 rounded-md border border-slate-200 p-2 text-xs">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Attributes (for filtering, not linking evidence)</h3>
      {personas.length > 0 && (
        <div>
          <div className="text-slate-500">Persona (likeness)</div>
          <ul className="mt-0.5 flex flex-wrap gap-1">
            {personas.map((p) => (
              <li key={p.nodeId ?? p.name}>
                <button
                  type="button"
                  disabled={!p.nodeId}
                  onClick={() => {
                    if (p.nodeId) onSelect(p.nodeId);
                  }}
                  className="rounded bg-fuchsia-50 px-1.5 py-0.5 text-left text-fuchsia-900 enabled:hover:bg-fuchsia-100"
                  title={p.sources.map((s) => PERSONA_SOURCE_LABELS[s]).join("; ") || "unknown source"}
                >
                  {p.name}
                  {p.sources.length > 0 && <span className="text-[10px] text-fuchsia-700"> · {p.sources.map((s) => PERSONA_SOURCE_LABELS[s]).join(", ")}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {score !== null && (
        <div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Deepfake score</span>
            <span className="h-1.5 w-20 overflow-hidden rounded bg-slate-200">
              <span className={`block h-full ${score >= 0.8 ? "bg-red-600" : score >= 0.5 ? "bg-amber-500" : "bg-slate-500"}`} style={{ width: `${Math.round(score * 100)}%` }} />
            </span>
            <span className="tabular-nums text-slate-800">{score.toFixed(2)}</span>
          </div>
          <p className="text-[10px] text-slate-500">Model score from the input data (e.g. DROZD): a hint, not evidence.</p>
        </div>
      )}
      {facts.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
          {facts.map(([k, label]) => (
            <div key={k} className="contents">
              <dt className="text-slate-500">{label}</dt>
              <dd className={`break-all ${k === "trafficSource" && d.cloakerInSource === true ? "font-medium text-red-700" : "text-slate-800"}`}>
                {fmt(d[k])}
                {k === "trafficSource" && d.cloakerInSource === true && <span className="font-normal"> (cloaker in the source name)</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {d.cyrillic === true && <div className="text-slate-800">Cyrillic in the page code or campaign parameters</div>}
      {typeof d.cloakingSuspected === "boolean" && (
        <div>
          <div className={d.cloakingSuspected ? "font-medium text-red-700" : "text-slate-700"}>
            {d.cloakingSuspected ? "Suspected cloaking" : "Cloaking: not detected"}
            <span className="font-normal text-slate-500"> (two plain fetches: platform crawler and mobile browser)</span>
          </div>
          {reasons.length > 0 && (
            <ul className="list-disc pl-4 text-[11px] text-slate-700">
              {reasons.map((r) => (
                <li key={r} className="break-all">
                  {r}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {finalUrl && (
        <div>
          <span className="text-slate-500">Final URL: </span>
          <span className="break-all text-slate-800">{finalUrl}</span>
        </div>
      )}
      {simhash && (
        <div>
          <span className="text-slate-500">Page DOM simhash: </span>
          <span className="font-mono text-slate-800">{simhash}</span>
        </div>
      )}
      {ocr && (
        <div>
          <div className="text-slate-500">Text from image (OCR)</div>
          <p className="mt-0.5 rounded bg-slate-50 p-1.5 text-slate-800">{ocr.length > 300 ? `${ocr.slice(0, 299)}…` : ocr}</p>
        </div>
      )}
      {asr && (
        <div>
          <div className="text-slate-500">Audio transcript (ASR)</div>
          <p className="mt-0.5 rounded bg-slate-50 p-1.5 text-slate-800">{asr.length > 300 ? `${asr.slice(0, 299)}…` : asr}</p>
        </div>
      )}
    </section>
  );
}

function Evidence({ ev, idx }: { ev: PairEvidence; idx: GraphIndex }) {
  return (
    <li className="text-xs leading-snug">
      <span className={ev.strong ? "font-semibold text-slate-900" : ev.discounted ? "text-slate-500" : "text-slate-700"}>{ev.evidence}</span>
      <span className="ml-1 text-[10px] text-slate-400">weight {ev.weight.toFixed(2)}{ev.strong ? " · strong" : ""}</span>
      {ev.kind === "pivot" && ev.pathA.length > 0 && (
        <div className="mt-0.5 font-mono text-[10px] text-slate-400" title="Evidence path in the graph">
          {pathLabel(idx, ev.pathA)} ⟷ {pathLabel(idx, ev.pathB.slice(0, -1).reverse())}
        </div>
      )}
    </li>
  );
}

/** Side panel of the selected node: an ad with its evidence and the analyst's corrections (B-281), or a shared entity. */
export default function DetailsPanel({ node, idx, onSelect, onCompare }: DetailsPanelProps) {
  if (!node) {
    return (
      <div className="space-y-3 text-sm text-slate-600">
        <p className="font-medium text-slate-900">Click a node in the graph</p>
        <p>An ad shows its text, creative and the list of evidence “why linked” with other ads. An entity (domain, IP, tracker, wallet…) shows how many ads share it and how it was weighted.</p>
        <p className="text-xs text-slate-500">Dashed frame = discounted infrastructure (e.g. shared Cloudflare IP, popular registrar, free CA). Bold frame = strong evidence (links ads into a campaign).</p>
      </div>
    );
  }
  const isItem = node.type === "item";
  const links = isItem ? (idx.linksByItem.get(node.key) ?? []) : [];
  const holders = isItem ? [] : holdersOf(idx, node.id);
  const parts = weightPartsOf(node);
  const note = TYPE_NOTES[node.type];
  const text = typeof node.data.text === "string" ? node.data.text : null;
  const hasImage = isItem && Boolean(node.data.imagePath || node.data.imageUrl);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLORS[node.type] }} aria-hidden />
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{nodeTypeLabel(node)}</span>
          {node.campaignId && <span className="ml-auto rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] text-white">{node.campaignId}</span>}
        </div>
        <h2 className="mt-1 break-words text-base font-semibold text-slate-900">{isItem ? `Ad ${node.key}` : node.label}</h2>
        {!isItem && <p className="break-all font-mono text-[11px] text-slate-500">{node.key}</p>}
        {isItem && onCompare && (
          <button type="button" onClick={() => onCompare(node.key)} className="mt-1.5 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:border-slate-500">
            Compare with another ad
          </button>
        )}
      </div>

      {hasImage && (
        // eslint-disable-next-line @next/next/no-img-element -- local dataset images are served by /api/image
        <img
          src={typeof node.data.imageUrl === "string" && node.data.imageUrl ? node.data.imageUrl : `/api/image?id=${encodeURIComponent(node.key)}`}
          alt={`Creative of ad ${node.key}`}
          className="w-full rounded-md border border-slate-200"
        />
      )}
      {text && (
        <div>
          {node.type === "comment" && <div className="mb-0.5 text-[11px] text-slate-500">Comment text (normalized)</div>}
          <p className="rounded-md bg-slate-50 p-2 text-sm text-slate-800">{text}</p>
        </div>
      )}
      {isItem && <ItemAttributes node={node} idx={idx} onSelect={onSelect} />}
      {isItem && <PairCorrection item={node.key} />}

      {!isItem && (
        <div className="rounded-md border border-slate-200 p-2 text-xs text-slate-700">
          <div>
            Shared by <b>{node.df}</b> {node.df === 1 ? "ad" : "ads"}
            {node.strong ? <span className="ml-1 rounded bg-slate-900 px-1 text-[10px] text-white">strong evidence</span> : null}
          </div>
          {node.weight !== null && parts && (
            <div className="mt-1 text-slate-500">
              weight {node.weight.toFixed(3)} = {weightFormula(parts)}
              {parts.ubiquity !== undefined && parts.ubiquity < 1 && (
                <div className="text-amber-700">ubiquity penalty: the entity occurs in more than half of the ads (×{parts.ubiquity})</div>
              )}
            </div>
          )}
          {note && <p className="mt-1 text-[11px] text-slate-500">{note}</p>}
          <div className="mt-1.5">
            <DisablePivotButton pivot={node.id} />
          </div>
          {node.discounts.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-amber-700">
              {node.discounts.map((d) => (
                <li key={d.rule}>
                  discounted: {d.reason} (×{d.factor})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {Object.entries(node.data)
          .filter(([k, v]) => !HIDDEN.has(k) && !(isItem && ITEM_ATTRIBUTE_KEYS.has(k)) && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-slate-500">{DATA_LABELS_BY_TYPE[node.type]?.[k] ?? DATA_LABELS[k] ?? k}</dt>
              <dd className="break-all text-slate-800">{fmtValue(node.type, k, v)}</dd>
            </div>
          ))}
      </dl>

      {isItem && (
        <section>
          <h3 className="text-sm font-semibold text-slate-900">Why linked</h3>
          <ReadHow id="strength" />
          {links.length === 0 && <p className="mt-1 text-xs text-slate-500">No evidence links this ad to others.</p>}
          <ul className="mt-2 space-y-3">
            {links.slice(0, 12).map((l) => {
              const other = l.a === node.key ? l.b : l.a;
              const otherNode = idx.nodeById.get(`item:${other}`);
              return (
                <li key={`${l.a}|${l.b}`} className="rounded-md border border-slate-200 p-2">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => onSelect(`item:${other}`)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <span className="font-mono text-xs font-semibold text-blue-700 underline-offset-2 hover:underline">{other}</span>
                      {otherNode?.campaignId && <span className="font-mono text-[10px] text-slate-400">{otherNode.campaignId}</span>}
                      <span className="ml-auto h-1.5 w-16 overflow-hidden rounded bg-slate-200" title={`score ${l.score.toFixed(2)}`}>
                        <span className="block h-full bg-slate-800" style={{ width: `${Math.round(l.score * 100)}%` }} />
                      </span>
                      <span className="w-8 text-right text-[11px] tabular-nums text-slate-500">{l.score.toFixed(2)}</span>
                    </button>
                    {onCompare && (
                      <button type="button" onClick={() => onCompare(node.key, other)} className="shrink-0 rounded border border-slate-200 px-1 text-[10px] text-slate-600 hover:border-slate-400" title={`Compare ${node.key} with ${other}`}>
                        compare
                      </button>
                    )}
                  </div>
                  <ul className="mt-1 space-y-1">
                    {analystFirst(l.evidence).slice(0, 4).map((ev, i) => (
                      <Evidence key={i} ev={ev} idx={idx} />
                    ))}
                  </ul>
                  <WrongLinkButton a={node.key} b={other} />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!isItem && holders.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-slate-900">Ads with this entity</h3>
          <ul className="mt-1 flex flex-wrap gap-1">
            {holders.slice(0, 60).map((h) => {
              const n = idx.nodeById.get(`item:${h}`);
              return (
                <li key={h}>
                  <button type="button" onClick={() => onSelect(`item:${h}`)} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 hover:bg-slate-200">
                    {h}
                    {n?.campaignId ? <span className="text-slate-400"> {n.campaignId}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

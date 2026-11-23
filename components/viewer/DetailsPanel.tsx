"use client";

import { nodeTypeLabel } from "@/lib/viewer/fields";
import { type EntityType, type GraphNode, type PairEvidence } from "@/lib/graph/model";
import { personaMentions, PERSONA_SOURCE_LABELS, weightFormula, weightPartsOf } from "./compare";
import { holdersOf, pathLabel, type GraphIndex } from "./graphView";
import { TYPE_COLORS } from "./palette";
import { DisablePivotButton, PairCorrection, WrongLinkButton } from "./CorrectionButtons";
import { ReadHow } from "./Guide";

/** Analyst premises first, so a decision is never cut off by the evidence limit. */
const analystFirst = (evidence: PairEvidence[]) => [...evidence].sort((x, y) => Number(y.evidence.startsWith("analyst decision")) - Number(x.evidence.startsWith("analyst decision")));

export interface DetailsPanelProps {
  node: GraphNode | null;
  idx: GraphIndex;
  onSelect: (id: string) => void;
  /** Open the comparison panel with ad `a` (and optionally `b`). */
  onCompare?: (a: string, b?: string) => void;
}

const DATA_LABELS: Record<string, string> = {
  platform: "Platforma",
  advertiser: "Reklamodawca",
  firstSeen: "Pierwsze wyświetlenie",
  lastSeen: "Ostatnie wyświetlenie",
  landingUrl: "Link docelowy",
  label: "Etykieta (prawda)",
  dhash: "dHash obrazu",
  registrar: "Rejestrator",
  created: "Utworzona",
  expires: "Wygasa",
  nameservers: "Serwery NS",
  mx: "MX",
  certCount: "Certyfikaty w CT",
  issuer: "Wystawca",
  notBefore: "Ważny od",
  notAfter: "Ważny do",
  sanDomains: "Nazwy w SAN",
  sanCount: "Liczba nazw w SAN",
  asns: "ASN",
  asName: "Operator",
  prefix: "Prefiks",
  country: "Kraj",
  kind: "Rodzaj",
  trackerId: "Identyfikator",
  address: "Adres",
  url: "URL",
  mmh3: "Hash Shodan (mmh3)",
  sha256: "SHA-256",
  domains: "Domeny",
  parked: "Strona zaparkowana",
  whatsapp: "WhatsApp",
  registrableDomain: "Domena (eTLD+1)",
  isIdn: "IDN (punycode)",
  host: "Host",
  pathTemplate: "Ścieżka (szablon)",
  sameOrigin: "Na domenie strony",
  method: "Metoda",
  via: "Wykryte w",
  fields: "Pola",
  path: "Ścieżka",
  basename: "Plik",
  cyrillic: "Cyrylica",
  template: "Wzorzec",
  agnostic: "Wariant bez TLD",
  literalChars: "Stałe znaki",
  domainCount: "Liczba domen",
  targets: "Cele CNAME",
};

/** Labels that depend on the entity type (the same key means different things). */
const DATA_LABELS_BY_TYPE: Partial<Record<EntityType, Record<string, string>>> = {
  campaign_param: { name: "Parametr", canonicalName: "Nazwa kanoniczna", value: "Wartość", macro: "Niewypełnione makro", sourceUrl: "Przykładowy URL" },
  persona: { name: "Imię i nazwisko", role: "Rola publiczna" },
  asset: { kind: "Typ pliku" },
};

const VIA_LABELS: Record<string, string> = {
  form: "formularz (action)",
  fetch: "fetch()",
  xhr: "XMLHttpRequest",
  axios: "axios",
  jquery: "$.ajax / $.post",
  literal: "ścieżka API w kodzie",
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
  ["observedUrls", "Adres w pasku przeglądarki (OCR zrzutu / nagrania)"],
  ["inAppBrowser", "Przeglądarka w aplikacji"],
  ["landingSource", "Skąd adres strony (input / tekst reklamy / pasek adresu)"],
  ["landingFragment", "Fragment adresu (#…)"],
  ["platformCampaignName", "Kampania na platformie stron"],
  ["landingName", "Nazwa strony w panelu platformy"],
  ["trafficSource", "Źródło ruchu ustawione przez kupującego"],
  ["platformAccount", "Konto na platformie (owner_uuid)"],
  ["impersonatedBrand", "Podrabiana marka (z tytułu strony)"],
  ["metaAdId", "Identyfikator reklamy w Mecie (z fbclid)"],
  ["metaAppId", "app_id z fbclid"],
  ["clickTime", "Czas kliknięcia (z clickid xid)"],
  ["clickCounter", "Licznik serwera trackera (z clickid xid)"],
];

/** Short notes for the new pivot types: what sharing them means. */
const TYPE_NOTES: Partial<Record<EntityType, string>> = {
  endpoint: "Backend, do którego strona wysyła dane z formularza. Wspólny backend na różnych domenach to jeden z najmocniejszych dowodów; publiczne serwisy formularzy i ogólne ścieżki są dyskontowane.",
  hidden_fields: "Zestaw nazw ukrytych pól formularza (bez ogólnych pól typu csrf/_token).",
  asset: "Własny plik JS/CSS strony. Popularne biblioteki i ogólne nazwy plików są dyskontowane.",
  comment: "Znormalizowany komentarz HTML/JS. Standardowe komentarze trackerów i CMS są dyskontowane.",
  domain_pattern: "Wzorzec nazwy domeny z zamiennikami <n> (cyfry) i <lorem> (słowo z lorem ipsum); powstaje tylko, gdy obejmuje co najmniej dwie domeny.",
  cname_target: "Wspólny cel rekordu CNAME. Duże CDN i platformy hostingowe są dyskontowane.",
  campaign_param: "Parametr kampanii z adresu URL (utm_*, sub1–5, aff_id, clickid…). Ogólne wartości (np. facebook, cpc) i niewypełnione makra są dyskontowane.",
  persona: "Słaby sygnał: ta sama osoba bywa wykorzystywana w wielu kampaniach. Służy do filtrowania i priorytetów, nie do łączenia. Brak danych biometrycznych.",
  path_id: "Losowy identyfikator (UUID) w ścieżkach zasobów ładowanych z domeny strony: konto kreatora stron obsługującego wiele domen.",
  param_schema: "Nazwy parametrów linku i rodzaj ich wartości. Wskazuje system kierowania ruchem, który może mieć wielu klientów: dowód pomocniczy.",
  platform_account: "Konto właściciela zapisane przez platformę stron w kodzie strony (window.aio, owner_uuid). To samo konto = ten sam operator; różne konta tej samej platformy nie są łączone słabszymi dowodami.",
  platform_campaign: "Kampania w panelu platformy stron (uuid i nazwa nadana przez kupującego ruch). Silny dowód: te same strony puszcza ta sama kampania.",
  page_template: "Szablon strony na platformie (lander_template_uuid). Ten sam szablon u różnych kont to ten sam zestaw, czyli kampanie podobne, a nie jedna kampania.",
  click_server: "Identyfikator kliknięcia w formacie xid zawiera identyfikator maszyny i procesu trackera. Ten sam serwer kieruje ruch do obu stron: wspólna infrastruktura, dowód średni.",
  ad_payer: "Płatnik i beneficjent zadeklarowani Mecie (przejrzystość DSA), odczytani z biblioteki reklam po identyfikatorze biblioteki. Ten sam płatnik na różnych reklamach = jedno konto płacące; nazwa jest wpisywana przez reklamodawcę, więc ogólne nazwy (np. „ABC”) łączą słabiej.",
  meta_ad: "Nowy format fbclid zawiera identyfikator klikniętej reklamy (ad ID z Marketing API, nie identyfikator Biblioteki Reklam). Ten sam = ta sama reklama.",
};

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "boolean") return v ? "tak" : "nie";
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
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Atrybuty (do filtrowania, nie dowody łączące)</h3>
      {personas.length > 0 && (
        <div>
          <div className="text-slate-500">Persona (wizerunek)</div>
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
                  title={p.sources.map((s) => PERSONA_SOURCE_LABELS[s]).join("; ") || "źródło nieznane"}
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
            <span className="text-slate-500">Wynik deepfake</span>
            <span className="h-1.5 w-20 overflow-hidden rounded bg-slate-200">
              <span className={`block h-full ${score >= 0.8 ? "bg-red-600" : score >= 0.5 ? "bg-amber-500" : "bg-slate-500"}`} style={{ width: `${Math.round(score * 100)}%` }} />
            </span>
            <span className="tabular-nums text-slate-800">{score.toFixed(2)}</span>
          </div>
          <p className="text-[10px] text-slate-500">Wynik modelu z danych wejściowych (np. DROZD): wskazówka, nie dowód.</p>
        </div>
      )}
      {facts.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
          {facts.map(([k, label]) => (
            <div key={k} className="contents">
              <dt className="text-slate-500">{label}</dt>
              <dd className={`break-all ${k === "trafficSource" && d.cloakerInSource === true ? "font-medium text-red-700" : "text-slate-800"}`}>
                {fmt(d[k])}
                {k === "trafficSource" && d.cloakerInSource === true && <span className="font-normal"> (cloaker w nazwie źródła)</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {d.cyrillic === true && <div className="text-slate-800">Cyrylica w kodzie strony lub parametrach kampanii</div>}
      {typeof d.cloakingSuspected === "boolean" && (
        <div>
          <div className={d.cloakingSuspected ? "font-medium text-red-700" : "text-slate-700"}>
            {d.cloakingSuspected ? "Podejrzenie cloakingu" : "Cloaking: nie wykryto"}
            <span className="font-normal text-slate-500"> (dwa zwykłe pobrania: crawler platformy i przeglądarka mobilna)</span>
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
          <span className="text-slate-500">Adres końcowy: </span>
          <span className="break-all text-slate-800">{finalUrl}</span>
        </div>
      )}
      {simhash && (
        <div>
          <span className="text-slate-500">Simhash DOM strony: </span>
          <span className="font-mono text-slate-800">{simhash}</span>
        </div>
      )}
      {ocr && (
        <div>
          <div className="text-slate-500">Tekst z obrazu (OCR)</div>
          <p className="mt-0.5 rounded bg-slate-50 p-1.5 text-slate-800">{ocr.length > 300 ? `${ocr.slice(0, 299)}…` : ocr}</p>
        </div>
      )}
      {asr && (
        <div>
          <div className="text-slate-500">Transkrypcja audio (ASR)</div>
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
      <span className="ml-1 text-[10px] text-slate-400">waga {ev.weight.toFixed(2)}{ev.strong ? " · silny" : ""}</span>
      {ev.kind === "pivot" && ev.pathA.length > 0 && (
        <div className="mt-0.5 font-mono text-[10px] text-slate-400" title="Ścieżka dowodu w grafie">
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
        <p className="font-medium text-slate-900">Kliknij węzeł w grafie</p>
        <p>Reklama pokaże treść, kreację i listę dowodów „dlaczego połączone” z innymi reklamami. Encja (domena, IP, tracker, portfel…) pokaże, ile reklam ją współdzieli i jak została zważona.</p>
        <p className="text-xs text-slate-500">Przerywana ramka = infrastruktura zdyskontowana (np. współdzielone IP Cloudflare, popularny rejestrator, darmowy CA). Pogrubiona ramka = silny dowód (łączy reklamy w kampanię).</p>
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
        <h2 className="mt-1 break-words text-base font-semibold text-slate-900">{isItem ? `Reklama ${node.key}` : node.label}</h2>
        {!isItem && <p className="break-all font-mono text-[11px] text-slate-500">{node.key}</p>}
        {isItem && onCompare && (
          <button type="button" onClick={() => onCompare(node.key)} className="mt-1.5 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:border-slate-500">
            Porównaj z inną reklamą
          </button>
        )}
      </div>

      {hasImage && (
        // eslint-disable-next-line @next/next/no-img-element -- local dataset images are served by /api/image
        <img
          src={typeof node.data.imageUrl === "string" && node.data.imageUrl ? node.data.imageUrl : `/api/image?id=${encodeURIComponent(node.key)}`}
          alt={`Kreacja reklamy ${node.key}`}
          className="w-full rounded-md border border-slate-200"
        />
      )}
      {text && (
        <div>
          {node.type === "comment" && <div className="mb-0.5 text-[11px] text-slate-500">Treść komentarza (znormalizowana)</div>}
          <p className="rounded-md bg-slate-50 p-2 text-sm text-slate-800">{text}</p>
        </div>
      )}
      {isItem && <ItemAttributes node={node} idx={idx} onSelect={onSelect} />}
      {isItem && <PairCorrection item={node.key} />}

      {!isItem && (
        <div className="rounded-md border border-slate-200 p-2 text-xs text-slate-700">
          <div>
            Współdzielone przez <b>{node.df}</b> {node.df === 1 ? "reklamę" : "reklam"}
            {node.strong ? <span className="ml-1 rounded bg-slate-900 px-1 text-[10px] text-white">silny dowód</span> : null}
          </div>
          {node.weight !== null && parts && (
            <div className="mt-1 text-slate-500">
              waga {node.weight.toFixed(3)} = {weightFormula(parts)}
              {parts.ubiquity !== undefined && parts.ubiquity < 1 && (
                <div className="text-amber-700">kara za powszechność: encja występuje w ponad połowie reklam (×{parts.ubiquity})</div>
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
                  zdyskontowane: {d.reason} (×{d.factor})
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
          <h3 className="text-sm font-semibold text-slate-900">Dlaczego połączone</h3>
          <ReadHow id="strength" />
          {links.length === 0 && <p className="mt-1 text-xs text-slate-500">Brak dowodów łączących tę reklamę z innymi.</p>}
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
                      <span className="ml-auto h-1.5 w-16 overflow-hidden rounded bg-slate-200" title={`wynik ${l.score.toFixed(2)}`}>
                        <span className="block h-full bg-slate-800" style={{ width: `${Math.round(l.score * 100)}%` }} />
                      </span>
                      <span className="w-8 text-right text-[11px] tabular-nums text-slate-500">{l.score.toFixed(2)}</span>
                    </button>
                    {onCompare && (
                      <button type="button" onClick={() => onCompare(node.key, other)} className="shrink-0 rounded border border-slate-200 px-1 text-[10px] text-slate-600 hover:border-slate-400" title={`Porównaj ${node.key} z ${other}`}>
                        porównaj
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
          <h3 className="text-sm font-semibold text-slate-900">Reklamy z tą encją</h3>
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

"use client";

import { useRef, useState, type FormEvent } from "react";
import type { MaterialItemResult, MaterialResult } from "@/lib/pipeline/analyzeMaterial";
import { linkRuleLabel } from "@/lib/viewer/fields";

export interface AnalyzeFormProps {
  onSelectCampaign: (id: string) => void;
}

const EXAMPLE = {
  url: "https://kz-ai-start.test/",
  text: "Adam Testowy zdradza: KryptoZysk AI zarabia nawet 4 800 zł dziennie. Zarejestruj się dziś!",
};

const VERDICT_STYLE: Record<MaterialItemResult["verdict"], string> = {
  known_campaign: "bg-emerald-50 text-emerald-900",
  similar_campaigns: "bg-violet-50 text-violet-900",
  new_campaign: "bg-slate-100 text-slate-800",
  duplicate: "bg-sky-50 text-sky-900",
  insufficient: "bg-slate-100 text-slate-700",
};

const VERDICT_LABEL: Record<MaterialItemResult["verdict"], string> = {
  known_campaign: "known campaign",
  similar_campaigns: "new campaign, similar to known ones",
  new_campaign: "new campaign",
  duplicate: "duplicate",
  insufficient: "insufficient data",
};

const FEATURE_LABEL: Record<string, string> = {
  landingUrl: "Page URL",
  finalUrl: "Final URL",
  landingSource: "URL source",
  landingFragment: "URL fragment",
  observedUrls: "Address bar (OCR)",
  inAppBrowser: "In-app browser",
  advertiser: "Advertiser",
  uiView: "View in screenshot",
  adLibraryIds: "Ad library ID",
  advertiserImpersonatesName: "Advertiser impersonates a person",
  advertiserMismatch: "Ad account probably hijacked (name does not match the content)",
  profitClaims: "Promised profit (amount and period)",
  adPlatform: "Ad library",
  adLibraryAdId: "Ad ID in the library",
  adAdvertiserId: "Advertiser ID",
  adAdvertiserLegalName: "Advertiser legal name",
  adAdvertiserLocation: "Advertiser country",
  adAdvertiserVerified: "Advertiser verified",
  adRegions: "Regions shown",
  adFirstShown: "Ad first shown",
  adLastShown: "Ad last shown",
  personas: "Personas",
  impersonatedBrand: "Impersonated brand",
  platformCampaignName: "Page-builder campaign",
  landingName: "Page in the platform panel",
  trafficSource: "Traffic source",
  platformAccount: "Page-builder account",
  metaAdId: "Meta ad (from fbclid)",
  clickTime: "Click time (clickid)",
  clickCounter: "Tracker server counter",
  firstSeen: "First seen",
  cyrillic: "Cyrillic",
  cloakingSuspected: "Suspected cloaking",
  ocrText: "Text from screenshot (OCR)",
  asrText: "Transcript (ASR)",
};

function fmt(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "yes" : "no";
  const s = String(v);
  return s.length > 300 ? `${s.slice(0, 299)}…` : s;
}

function ItemResult({ it, onSelectCampaign }: { it: MaterialItemResult; onSelectCampaign: (id: string) => void }) {
  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold">{it.id}</span>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${VERDICT_STYLE[it.verdict]}`}>{VERDICT_LABEL[it.verdict]}</span>
      </div>
      <p className={`rounded-md p-2 text-sm ${VERDICT_STYLE[it.verdict]}`}>{it.verdictText}</p>
      <div className="flex flex-wrap gap-2">
        {it.campaign && (
          <button type="button" onClick={() => onSelectCampaign(it.campaign!)} className="text-sm font-medium text-blue-700 hover:underline">
            Show campaign {it.campaign} →
          </button>
        )}
        {it.similarCampaigns.map((c) => (
          <button key={c} type="button" onClick={() => onSelectCampaign(c)} className="text-sm text-violet-700 hover:underline">
            similar: {c} →
          </button>
        ))}
      </div>
      {Object.keys(it.features).length > 0 && (
        <details open className="text-xs">
          <summary className="cursor-pointer font-medium text-slate-800">What we read from the sample</summary>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            {Object.entries(it.features).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-slate-500">{FEATURE_LABEL[k] ?? k}</dt>
                <dd className="break-all text-slate-800">{fmt(v)}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {it.links.length > 0 && (
        <details open className="text-xs">
          <summary className="cursor-pointer font-medium text-slate-800">Closest known ads and evidence</summary>
          <ul className="mt-1 space-y-1.5">
            {it.links.slice(0, 6).map((l) => (
              <li key={l.other} className="rounded border border-slate-100 p-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{l.other}</span>
                  {l.otherCampaign && <span className="text-slate-500">({l.otherCampaign})</span>}
                  <span className="text-slate-500">score {l.score.toFixed(2)}{l.strong ? " · strong" : ""}</span>
                  <span className="ml-auto rounded bg-slate-100 px-1 text-[10px] text-slate-600">{linkRuleLabel(l)}</span>
                </div>
                <ul className="mt-0.5 space-y-0.5">
                  {l.evidence.map((e, i) => (
                    <li key={i} className={e.strong ? "font-semibold text-slate-900" : e.discounted ? "text-slate-400" : "text-slate-700"}>
                      {e.evidence} <span className="text-[10px] font-normal text-slate-400">({e.weight.toFixed(2)})</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      )}
      {it.errors.length > 0 && <p className="break-all text-[11px] text-amber-800">Notes: {it.errors.slice(0, 4).join("; ")}</p>}
    </div>
  );
}

export default function AnalyzeForm({ onSelectCampaign }: AnalyzeFormProps) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [live, setLive] = useState(false);
  const [asr, setAsr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MaterialResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      for (const f of files) body.append("files", f, (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name);
      if (url) body.append("url", url);
      if (text) body.append("text", text);
      if (live) body.append("live", "1");
      if (asr) body.append("asr", "1");
      const res = await fetch("/api/analyze-material", { method: "POST", body });
      const json = (await res.json()) as MaterialResult & { error?: string };
      if (!res.ok || json.error) setError(json.error ?? `HTTP ${res.status}`);
      else setResult(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const totalMb = files.reduce((s, f) => s + f.size, 0) / 1e6;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">New sample: which campaign does it belong to?</h2>
        <p className="mt-1 text-xs text-slate-500">
          Screenshots, a saved page, HAR, a recording, a yt-dlp description or a ZIP with all of them. The sample goes through the same steps as the
          whole set (OCR, address bar, platform configuration, click IDs…) and joins one graph with the known ads.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => fileInput.current?.click()} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700">
            Choose files…
          </button>
          <button type="button" onClick={() => dirInput.current?.click()} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700">
            Choose case folder…
          </button>
          {files.length > 0 && (
            <button type="button" onClick={() => setFiles([])} className="text-xs text-slate-500 hover:underline">
              clear
            </button>
          )}
          <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
          <input
            ref={dirInput}
            type="file"
            multiple
            className="hidden"
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            onChange={(e) => setFiles([...(e.target.files ?? [])])}
          />
        </div>
        {files.length > 0 && (
          <p className="text-[11px] text-slate-600">
            {files.length} {files.length === 1 ? "file" : "files"}, {totalMb.toFixed(1)} MB: {files.slice(0, 4).map((f) => f.name).join(", ")}
            {files.length > 4 ? "…" : ""}
          </p>
        )}
        <label className="block text-xs font-medium text-slate-700">
          Link from the ad (optional)
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="block text-xs font-medium text-slate-700">
          Ad text (optional)
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="accent-slate-900" />
          passive lookups (DNS, RDAP, ASN) and one fetch of the page if the sample does not include it
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={asr} onChange={(e) => setAsr(e.target.checked)} className="accent-slate-900" />
          video transcript and audio fingerprint (slower)
        </label>
        <div className="flex gap-2">
          <button type="submit" disabled={busy || (!files.length && !url && !text)} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
            {busy ? "Analyzing…" : "Analyze"}
          </button>
          <button
            type="button"
            onClick={() => {
              setUrl(EXAMPLE.url);
              setText(EXAMPLE.text);
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          >
            Example
          </button>
        </div>
      </form>

      {error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-800">{error}</p>}

      {result && (
        <div className="space-y-3">
          {result.items.map((it) => (
            <ItemResult key={it.id} it={it} onSelectCampaign={onSelectCampaign} />
          ))}
          {result.skipped.length > 0 && <p className="text-[11px] text-amber-800">Skipped: {result.skipped.map((s) => `${s.id} (${s.reason})`).join("; ")}</p>}
          <p className="text-[11px] text-slate-500">Mode: {result.mode === "offline" ? "sample only, no network" : "sample + passive lookups"}</p>
        </div>
      )}
    </div>
  );
}

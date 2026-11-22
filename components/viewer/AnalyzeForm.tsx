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
  known_campaign: "znana kampania",
  similar_campaigns: "nowa kampania, podobna do znanych",
  new_campaign: "nowa kampania",
  duplicate: "duplikat",
  insufficient: "za mało danych",
};

const FEATURE_LABEL: Record<string, string> = {
  landingUrl: "Adres strony",
  finalUrl: "Adres końcowy",
  landingSource: "Skąd adres",
  landingFragment: "Fragment adresu",
  observedUrls: "Pasek adresu (OCR)",
  inAppBrowser: "Przeglądarka w aplikacji",
  advertiser: "Reklamodawca",
  uiView: "Widok na zrzucie",
  adLibraryIds: "Identyfikator biblioteki reklam",
  advertiserImpersonatesName: "Reklamodawca podszywa się pod osobę",
  advertiserMismatch: "Konto reklamowe prawdopodobnie przejęte (nazwa nie pasuje do treści)",
  profitClaims: "Obiecywany zysk (kwota i okres)",
  adPlatform: "Biblioteka reklam",
  adLibraryAdId: "Identyfikator reklamy w bibliotece",
  adAdvertiserId: "Identyfikator reklamodawcy",
  adAdvertiserLegalName: "Nazwa prawna reklamodawcy",
  adAdvertiserLocation: "Kraj reklamodawcy",
  adAdvertiserVerified: "Reklamodawca zweryfikowany",
  adRegions: "Regiony emisji",
  adFirstShown: "Początek emisji reklamy",
  adLastShown: "Koniec emisji reklamy",
  personas: "Persony",
  impersonatedBrand: "Podrabiana marka",
  platformCampaignName: "Kampania na platformie stron",
  landingName: "Strona w panelu platformy",
  trafficSource: "Źródło ruchu",
  platformAccount: "Konto na platformie",
  metaAdId: "Reklama w Mecie (fbclid)",
  clickTime: "Czas kliknięcia (clickid)",
  clickCounter: "Licznik serwera trackera",
  firstSeen: "Pierwsza obserwacja",
  cyrillic: "Cyrylica",
  cloakingSuspected: "Podejrzenie cloakingu",
  ocrText: "Tekst ze zrzutu (OCR)",
  asrText: "Transkrypcja (ASR)",
};

function fmt(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "tak" : "nie";
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
            Pokaż kampanię {it.campaign} →
          </button>
        )}
        {it.similarCampaigns.map((c) => (
          <button key={c} type="button" onClick={() => onSelectCampaign(c)} className="text-sm text-violet-700 hover:underline">
            podobna: {c} →
          </button>
        ))}
      </div>
      {Object.keys(it.features).length > 0 && (
        <details open className="text-xs">
          <summary className="cursor-pointer font-medium text-slate-800">Co odczytano z materiału</summary>
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
          <summary className="cursor-pointer font-medium text-slate-800">Najbliższe znane reklamy i przesłanki</summary>
          <ul className="mt-1 space-y-1.5">
            {it.links.slice(0, 6).map((l) => (
              <li key={l.other} className="rounded border border-slate-100 p-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{l.other}</span>
                  {l.otherCampaign && <span className="text-slate-500">({l.otherCampaign})</span>}
                  <span className="text-slate-500">wynik {l.score.toFixed(2)}{l.strong ? " · silny" : ""}</span>
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
      {it.errors.length > 0 && <p className="break-all text-[11px] text-amber-800">Uwagi: {it.errors.slice(0, 4).join("; ")}</p>}
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
        <h2 className="text-base font-semibold text-slate-900">Nowy materiał: do której kampanii należy?</h2>
        <p className="mt-1 text-xs text-slate-500">
          Zrzuty ekranu, zapisana strona, HAR, nagranie, opis z yt-dlp albo zip z tym wszystkim. Materiał przechodzi te same kroki co cały zbiór
          (OCR, pasek adresu, konfiguracja platformy, identyfikatory kliknięć…) i trafia do jednego grafu ze znanymi reklamami.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => fileInput.current?.click()} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700">
            Wybierz pliki…
          </button>
          <button type="button" onClick={() => dirInput.current?.click()} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700">
            Wybierz katalog sprawy…
          </button>
          {files.length > 0 && (
            <button type="button" onClick={() => setFiles([])} className="text-xs text-slate-500 hover:underline">
              wyczyść
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
            {files.length} plików, {totalMb.toFixed(1)} MB: {files.slice(0, 4).map((f) => f.name).join(", ")}
            {files.length > 4 ? "…" : ""}
          </p>
        )}
        <label className="block text-xs font-medium text-slate-700">
          Link z reklamy (opcjonalnie)
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="block text-xs font-medium text-slate-700">
          Treść reklamy (opcjonalnie)
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="accent-slate-900" />
          zapytania pasywne (DNS, RDAP, ASN) i jedno pobranie strony, której nie ma w materiale
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={asr} onChange={(e) => setAsr(e.target.checked)} className="accent-slate-900" />
          transkrypcja i odcisk dźwięku wideo (wolniej)
        </label>
        <div className="flex gap-2">
          <button type="submit" disabled={busy || (!files.length && !url && !text)} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
            {busy ? "Analizuję…" : "Analizuj"}
          </button>
          <button
            type="button"
            onClick={() => {
              setUrl(EXAMPLE.url);
              setText(EXAMPLE.text);
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          >
            Przykład
          </button>
        </div>
      </form>

      {error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-800">{error}</p>}

      {result && (
        <div className="space-y-3">
          {result.items.map((it) => (
            <ItemResult key={it.id} it={it} onSelectCampaign={onSelectCampaign} />
          ))}
          {result.skipped.length > 0 && <p className="text-[11px] text-amber-800">Pominięte: {result.skipped.map((s) => `${s.id} (${s.reason})`).join("; ")}</p>}
          <p className="text-[11px] text-slate-500">Tryb: {result.mode === "offline" ? "tylko materiał, bez sieci" : "materiał + zapytania pasywne"}</p>
        </div>
      )}
    </div>
  );
}

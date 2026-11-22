"use client";

import { Download, FolderOpen, Loader2, Upload } from "lucide-react";
import Image from "next/image";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Campaign } from "@/lib/graph/model";
import { materialCsv } from "@/lib/pipeline/materialCsv";
import type { CaseProvenance } from "@/lib/viewer/completeness";
import { defaultSplit, detectCases, FILE_KIND_INFO, SPLIT_LABEL, stripCommonTop, type FileKind, type InputFile, type SplitMode } from "@/lib/viewer/caseDetect";
import { CASE, count, fmtElapsed, FILE, MATERIAL } from "@/lib/viewer/format";
import { addToBaseRefusal } from "@/lib/viewer/addToBaseView";
import { familyThresholdFromRules } from "@/lib/viewer/scale";
import { batchSummary, filterItems, resultConfidence, resultRows, type ResultFilter } from "@/lib/viewer/materialView";
import { bestCampaignLink } from "@/lib/pipeline/materialCsv";
import { premiseSentence } from "@/lib/viewer/plain";
import { CONFIDENCE_INFO, kitOnlyFromRules, sortByStrength } from "@/lib/viewer/strength";
import type { PublicJob } from "@/lib/viewer/jobs";
import EvidenceButton from "./EvidenceButton";
import AddToBaseButton from "./AddToBaseButton";
import ResultCard, { itemCompleteness, provenanceOf, type ResultContext } from "./ResultCard";
import { Empty, Help, SyntheticBadge } from "./ui";
import BuildBasePanel from "./BuildBasePanel";

export interface AnalyzeViewProps {
  campaigns: Campaign[];
  minLinkScore: number;
  rules: string[];
  /** The comparison base is the sample (synthetic) one. */
  syntheticBase: boolean;
  jobId: string | null;
  onJob: (id: string | null) => void;
  onShowCampaign: (id: string) => void;
  onCompare: (a: string, b: string) => void;
}

interface Picked {
  file: File;
  path: string;
}

const VERDICT_WORD: Record<string, string> = {
  known_campaign: "znana kampania",
  similar_campaigns: "nowa, podobna do znanych",
  new_campaign: "nowa kampania",
  duplicate: "duplikat",
  insufficient: "za mało danych",
};

const EXAMPLE = {
  url: "https://kz-ai-start.test/",
  text: "Adam Testowy zdradza: KryptoZysk AI zarabia nawet 4 800 zł dziennie. Zarejestruj się dziś!",
};

/** Files from a drop, including folders (the browser hands them over as directory entries). */
async function readDropped(items: DataTransferItemList): Promise<Picked[]> {
  const out: Picked[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ file, path: `${prefix}${entry.name}` });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      }
    }
  };
  const entries = [...items].map((i) => i.webkitGetAsEntry()).filter((e): e is FileSystemEntry => !!e);
  for (const e of entries) await walk(e, "");
  return out;
}

/** Badges of file kinds of a case with their counts; kinds the analysis does not read are highlighted. */
function KindIcons({ counts }: { counts: Partial<Record<FileKind, number>> }) {
  return (
    <span className="flex flex-wrap gap-1">
      {Object.entries(counts).map(([k, n]) => (
        <span key={k} className={`rounded px-1.5 py-0.5 text-xs ${FILE_KIND_INFO[k as FileKind].analyzable ? "bg-slate-100 text-slate-800" : "bg-amber-50 text-amber-900"}`} title={FILE_KIND_INFO[k as FileKind].hint}>
          {FILE_KIND_INFO[k as FileKind].label} ×{n}
        </span>
      ))}
    </span>
  );
}

/** Saves text as a file in the browser (CSV and JSON export). */
function download(name: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** "Analizuj materiał": input (drop zone, link, text), case preview, run progress and the batch result. */
export default function AnalyzeView({ campaigns, minLinkScore, rules, syntheticBase, jobId, onJob, onShowCampaign, onCompare }: AnalyzeViewProps) {
  const [picked, setPicked] = useState<Picked[]>([]);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [live, setLive] = useState(true);
  const [modeChoice, setModeChoice] = useState<SplitMode | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<{ done: number; total: number; bytes: number; totalBytes: number } | null>(null);
  const [job, setJob] = useState<PublicJob | null>(null);
  const [filter, setFilter] = useState<ResultFilter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [example, setExample] = useState(false);
  const dirInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const inputFiles: InputFile[] = useMemo(() => picked.map((p) => ({ path: p.path, size: p.file.size })), [picked]);
  const split = useMemo(() => defaultSplit(inputFiles), [inputFiles]);
  const mode = modeChoice ?? split.mode;
  const cases = useMemo(() => detectCases(inputFiles, mode), [inputFiles, mode]);
  const campaignMap = useMemo(() => new Map(campaigns.map((c) => [c.id, c])), [campaigns]);
  const kitOnly = useMemo(() => kitOnlyFromRules(rules), [rules]);
  const familyMinScore = useMemo(() => familyThresholdFromRules(rules), [rules]);

  // Poll the job about once a second until it ends; `?job=` brings the same job back after a refresh.
  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/material/${jobId}`, { cache: "no-store" });
        const body = (await res.json()) as PublicJob & { error?: string };
        if (stop) return;
        if (!res.ok) {
          setError(body.error ?? "Nie udało się pobrać stanu zadania");
          setJob(null);
          return;
        }
        setJob(body);
        setNow(Date.now());
        if (body.status === "running") setTimeout(tick, 1000);
      } catch (e) {
        if (!stop) setError(`Brak połączenia z serwerem: ${(e as Error).message}`);
      }
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [jobId]);

  const addFiles = (list: Picked[]) => {
    setPicked((cur) => [...cur, ...list]);
    setModeChoice(null);
    setOff(new Set());
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = await readDropped(e.dataTransfer.items);
    addFiles(dropped.length ? dropped : [...e.dataTransfer.files].map((f) => ({ file: f, path: f.name })));
  };

  const start = useCallback(
    async (overrides?: { url: string; text: string; live: boolean }) => {
      setBusy(true);
      setError(null);
      const chosen = cases.filter((c) => !off.has(c.name) && c.analyzable);
      const byPath = new Map(picked.map((p) => [p.path, p.file]));
      const { top } = stripCommonTop(inputFiles);
      const queue: { file: File; path: string; caseName: string }[] = [];
      for (const c of chosen) {
        for (const f of c.files) {
          const file = byPath.get(f.path);
          if (!file) continue;
          queue.push({ file, path: top && f.path.startsWith(`${top}/`) ? f.path.slice(top.length + 1) : f.path, caseName: c.name });
        }
      }
      const form = new FormData();
      form.append("url", overrides?.url ?? url);
      form.append("text", overrides?.text ?? text);
      form.append("live", (overrides?.live ?? live) ? "1" : "0");
      try {
        if (queue.length) form.append("uploadId", await uploadFiles(queue, setUpload));
        const res = await fetch("/api/material", { method: "POST", body: form });
        const body = (await res.json()) as { jobId?: string; error?: string };
        if (!res.ok || !body.jobId) throw new Error(body.error ?? "Nie udało się rozpocząć analizy");
        setJob(null);
        setFilter("all");
        setOpen(null);
        onJob(body.jobId);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
        setUpload(null);
      }
    },
    [cases, off, picked, inputFiles, url, text, live, onJob],
  );

  const reset = () => {
    setPicked([]);
    setUrl("");
    setText("");
    setExample(false);
    setJob(null);
    onJob(null);
  };

  const loadExample = () => {
    setPicked([]);
    setUrl(EXAMPLE.url);
    setText(EXAMPLE.text);
    setExample(true);
    void start({ ...EXAMPLE, live: false });
  };

  const selectedCount = cases.filter((c) => !off.has(c.name) && c.analyzable).length;
  const canStart = !busy && (selectedCount > 0 || url.trim() || text.trim()) && !(cases.length && selectedCount === 0 && !url.trim() && !text.trim());

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Do której kampanii należy ten materiał?</h2>
        <p className="mt-1 text-sm text-slate-700">
          Wgraj zrzut reklamy, zapisaną stronę, HAR<Help term="har" />, nagranie, link albo tekst. Porównamy je z bazą porównawczą<Help term="baza" /> i pokażemy, gdzie trafił i dlaczego.
        </p>
      </div>

      {!jobId && (
        <section className="space-y-3" aria-label="Wejście">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-slate-400 bg-white p-8 text-center"
          >
            <Upload size={28} aria-hidden className="text-slate-600" />
            <p className="text-base font-medium">Upuść tutaj pliki, folder albo ZIP</p>
            <div className="flex flex-wrap justify-center gap-2 text-sm">
              <button type="button" className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-white" onClick={() => dirInput.current?.click()}>
                <FolderOpen size={15} aria-hidden />Wybierz folder
              </button>
              <button type="button" className="rounded-md border border-slate-400 bg-white px-3 py-1.5" onClick={() => fileInput.current?.click()}>Wybierz pliki</button>
            </div>
            <input ref={dirInput} type="file" className="hidden" multiple {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(e) => addFiles([...(e.target.files ?? [])].map((f) => ({ file: f, path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name })))} aria-label="Wybierz folder" />
            <input ref={fileInput} type="file" className="hidden" multiple onChange={(e) => addFiles([...(e.target.files ?? [])].map((f) => ({ file: f, path: f.name })))} aria-label="Wybierz pliki" />
            <ul className="max-w-2xl text-left text-xs text-slate-600">
              <li>Zrzut: odczytamy z niego tekst i adres z paska przeglądarki.</li>
              <li>HAR to zapis ruchu sieciowego z przeglądarki.</li>
              <li>Zapisana strona: porównamy jej budowę, nie otwieramy jej.</li>
              <li>Wideo: odczytamy tekst z klatek. Plik zbioru (CSV, JSON): na razie wczytaj poleceniem <code>bun run ingest</code>.</li>
            </ul>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="font-medium">Link</span>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5" />
            </label>
            <label className="text-sm">
              <span className="font-medium">Tekst reklamy albo nazwa produktu</span>
              <input value={text} onChange={(e) => setText(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5" />
            </label>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 accent-slate-900" checked={live} onChange={(e) => setLive(e.target.checked)} />
            <span>
              <b>Dociągnij publiczne dane o domenach (DNS, rejestr domen)</b>
              <span className="block text-xs text-slate-600">Pytamy publiczne rejestry o domeny z materiału. Strony oszustów nie otwieramy w Twojej przeglądarce. Wyłącz, jeśli pracujesz bez internetu.</span>
            </span>
          </label>

          {picked.length > 0 && (
            <div className="space-y-2 rounded-lg border border-slate-300 bg-white p-3">
              {split.question && mode === split.mode && <p className="rounded bg-amber-50 px-2 py-1.5 text-sm text-amber-900">{split.question}</p>}
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium">Podział na sprawy:</span>
                {(Object.keys(SPLIT_LABEL) as SplitMode[]).map((m) => (
                  <label key={m} className="flex items-center gap-1.5">
                    <input type="radio" name="split" className="accent-slate-900" checked={mode === m} onChange={() => { setModeChoice(m); setOff(new Set()); }} />
                    {SPLIT_LABEL[m]}
                  </label>
                ))}
                <button type="button" className="ml-auto text-xs underline" onClick={reset}>Wyczyść</button>
              </div>
              <p className="text-xs text-slate-600">Wykryto {count(cases.length, CASE)} z {count(picked.length, FILE)}.</p>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-600">
                  <tr><th className="w-8" /><th>Sprawa</th><th>Pliki</th><th>Uwagi</th></tr>
                </thead>
                <tbody>
                  {cases.map((c) => (
                    <tr key={c.name} className="border-t border-slate-100 align-top">
                      <td className="py-1.5"><input type="checkbox" className="accent-slate-900" aria-label={`Analizuj sprawę ${c.name}`} checked={!off.has(c.name) && c.analyzable} disabled={!c.analyzable} onChange={(e) => setOff((cur) => { const n = new Set(cur); if (e.target.checked) n.delete(c.name); else n.add(c.name); return n; })} /></td>
                      <td className="py-1.5 font-mono text-xs">{c.name}</td>
                      <td className="py-1.5"><KindIcons counts={c.counts} /></td>
                      <td className="py-1.5 text-xs text-slate-600">{c.notes.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={!canStart} onClick={() => void start()} className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
              {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
              {cases.length ? `Analizuj (${selectedCount})` : "Analizuj"}
            </button>
            <button type="button" onClick={loadExample} disabled={busy} className="rounded-md border border-slate-400 bg-white px-3 py-2 text-sm">Wczytaj przykład</button>
            <span className="text-xs text-slate-500">Przykład to wymyślona reklama, sprawdzana bez internetu.</span>
          </div>
          {upload && (
            <div className="space-y-1" role="status" aria-live="polite">
              <p className="text-sm text-slate-700">Wgrywanie: {upload.done} z {upload.total} plików ({fmtMb(upload.bytes)} z {fmtMb(upload.totalBytes)})</p>
              <div className="h-2 w-full max-w-md overflow-hidden rounded bg-slate-200">
                <div className="h-full bg-slate-900 transition-all" style={{ width: `${upload.totalBytes ? Math.round((upload.bytes / upload.totalBytes) * 100) : 0}%` }} />
              </div>
            </div>
          )}
          {error && <p role="alert" className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>}
        </section>
      )}

      {jobId && !job && !error && <p className="flex items-center gap-2 text-sm text-slate-600"><Loader2 size={15} className="animate-spin" aria-hidden />Wczytywanie zadania…</p>}
      {jobId && error && !job && (
        <div className="space-y-2">
          <p role="alert" className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
          <button type="button" className="rounded-md border border-slate-400 bg-white px-3 py-1.5 text-sm" onClick={reset}>Zacznij od nowa</button>
        </div>
      )}

      {job && (
        <Progress job={job} now={now} onReset={reset} />
      )}

      {!jobId && <BuildBasePanel />}

      {job?.status === "done" && job.result && (
        <BatchResult
          job={job}
          campaigns={campaignMap}
          minLinkScore={minLinkScore}
          familyMinScore={familyMinScore}
          kitOnly={kitOnly}
          filter={filter}
          setFilter={setFilter}
          open={open}
          setOpen={setOpen}
          synthetic={syntheticBase || example}
          syntheticBase={syntheticBase}
          example={example}
          onShowCampaign={onShowCampaign}
          onCompare={onCompare}
        />
      )}
    </div>
  );
}

const STATUS_WORD = { waiting: "czeka", running: "w toku", done: "gotowe", error: "błąd" } as const;

/** Run progress: overall count and elapsed time, one row per case with its state, one sentence about what happens, a folded log. */
function Progress({ job, now, onReset }: { job: PublicJob; now: number; onReset: () => void }) {
  const done = job.cases.filter((c) => c.status === "done" || c.status === "error").length;
  const elapsed = Math.max(0, (job.finishedAt ? Date.parse(job.finishedAt) : now) - Date.parse(job.startedAt ?? job.createdAt));
  return (
    <section className="space-y-2 rounded-lg border border-slate-300 bg-white p-3" aria-label="Przebieg" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold">
          {job.status === "running" ? <><Loader2 size={14} className="mr-1 inline animate-spin" aria-hidden />Analiza trwa</> : job.status === "done" ? "Analiza zakończona" : "Analiza nie powiodła się"}
        </h3>
        <span className="text-sm text-slate-700">{done}/{job.cases.length} {job.cases.length === 1 ? "sprawa" : "spraw"} · {fmtElapsed(elapsed)}</span>
        <button type="button" className="ml-auto rounded-md border border-slate-400 px-2.5 py-1 text-sm" onClick={onReset}>Nowa analiza</button>
      </div>
      <ul className="grid gap-1 text-sm md:grid-cols-2">
        {job.cases.map((c) => (
          <li key={c.name} className="flex items-center gap-2 rounded bg-slate-50 px-2 py-1">
            <span className="font-mono text-xs">{c.name}</span>
            <span className={`ml-auto text-xs ${c.status === "error" ? "font-medium text-rose-800" : "text-slate-600"}`}>{STATUS_WORD[c.status]}{c.detail ? `: ${c.detail}` : ""}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-600">Odczytujemy tekst ze zrzutów i nagrań, zbieramy dane o domenach, porównujemy z bazą i grupujemy.</p>
      {job.error && <p role="alert" className="rounded border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-sm text-rose-900">{job.error}</p>}
      {job.log.length > 0 && (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer">Dziennik techniczny</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-900 p-2 text-slate-100">{job.log.join("\n")}</pre>
        </details>
      )}
    </section>
  );
}

interface BatchResultProps {
  job: PublicJob;
  campaigns: Map<string, Campaign>;
  minLinkScore: number;
  /** Threshold of a group of similar campaigns. */
  familyMinScore: number;
  kitOnly: Set<string>;
  filter: ResultFilter;
  setFilter: (f: ResultFilter) => void;
  open: string | null;
  setOpen: (id: string | null) => void;
  synthetic: boolean;
  /** The base is the bundled sample (read-only). */
  syntheticBase: boolean;
  /** The result comes from "Wczytaj przykład". */
  example: boolean;
  onShowCampaign: (id: string) => void;
  onCompare: (a: string, b: string) => void;
}

/** Result of a batch: funnel, summary bar, table with expandable cards, new campaigns of the batch, export. */
function BatchResult({ job, campaigns, minLinkScore, familyMinScore, kitOnly, filter, setFilter, open, setOpen, synthetic, syntheticBase, example, onShowCampaign, onCompare }: BatchResultProps) {
  const result = job.result!;
  const sum = batchSummary(result, job.fileCount);
  const [sort, setSort] = useState<"verdict" | "confidence">("verdict");
  const ctx: ResultContext = useMemo(
    () => ({
      minLinkScore,
      kitOnly,
      campaigns,
      jobId: job.id,
      provenance: new Map((result.provenance ?? []).flatMap((p: CaseProvenance) => [p.caseId, p.id].filter((k): k is string => !!k).map((k) => [k, p] as const))),
      skipped: result.skipped,
      failedLookups: result.failedLookups ?? [],
      lookups: result.lookups,
      addToBaseDisabled: addToBaseRefusal(syntheticBase, example),
      familyMinScore,
    }),
    [minLinkScore, familyMinScore, kitOnly, campaigns, job.id, result, syntheticBase, example],
  );
  const single = result.items.length === 1;
  const rows = useMemo(() => {
    const list = filterItems(result.items, filter);
    const order = ["known_campaign", "similar_campaigns", "new_campaign", "duplicate", "insufficient"];
    return [...list].sort((a, b) =>
      sort === "verdict"
        ? order.indexOf(a.verdict) - order.indexOf(b.verdict)
        : (resultConfidence(a) ? CONFIDENCE_INFO[resultConfidence(a)!].rank : 9) - (resultConfidence(b) ? CONFIDENCE_INFO[resultConfidence(b)!].rank : 9),
    );
  }, [result.items, filter, sort]);
  const funnel: Array<{ label: string; n: number; f: ResultFilter | null; help?: boolean }> = [
    { label: "Pliki", n: sum.files, f: null },
    { label: "Materiały", n: sum.materials, f: "all" },
    { label: "Duplikaty", n: sum.duplicates, f: "duplicate" },
    { label: "Powiązania z bazą", n: sum.linkedToBase, f: null },
    { label: "Znane kampanie", n: sum.known, f: "known" },
    { label: "Nowe kampanie", n: sum.fresh, f: "fresh" },
    { label: "Za mało danych", n: sum.insufficient, f: "insufficient" },
  ];
  const bar: Array<{ n: number; text: string; f: ResultFilter }> = [
    { n: sum.known, text: "do znanych kampanii", f: "known" },
    { n: sum.similar, text: sum.similar === 1 ? "nowa podobna" : "nowe podobne", f: "similar" },
    { n: sum.brandNew, text: sum.brandNew === 1 ? "nowa" : "nowe", f: "new" },
    { n: sum.duplicates, text: sum.duplicates === 1 ? "duplikat" : "duplikaty", f: "duplicate" },
    { n: sum.insufficient, text: "za mało danych", f: "insufficient" },
  ];
  return (
    <section className="space-y-4" aria-label="Wynik">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold">Wynik: {count(sum.materials, MATERIAL)}</h3>
        {synthetic && <SyntheticBadge />}
        <span className="ml-auto"><AddToBaseButton jobId={job.id} ids={result.items.filter((i) => i.verdict !== "duplicate" && i.verdict !== "insufficient").map((i) => i.id)} label="Dodaj materiały do bazy" disabledReason={ctx.addToBaseDisabled} /></span>
      </div>

      {!job.together && sum.materials > 1 && (
        <p className="rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">Materiały z tej paczki nie są porównywane między sobą, tylko z bazą porównawczą.</p>
      )}

      <ol className="flex flex-wrap items-stretch gap-1.5" aria-label="Lejek liczb">
        <li className="self-center text-xs text-slate-600">Lejek<Help term="lejek" /></li>
        {funnel.map((s, i) => (
          <li key={s.label} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden className="text-slate-400">→</span>}
            {s.f ? (
              <button type="button" onClick={() => setFilter(s.f!)} aria-pressed={filter === s.f} className={`rounded-md border px-2.5 py-1 text-left ${filter === s.f ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white"}`}>
                <span className="block text-lg font-semibold leading-tight">{s.n}</span>
                <span className="text-xs">{s.label}</span>
              </button>
            ) : (
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1">
                <span className="block text-lg font-semibold leading-tight">{s.n}</span>
                <span className="text-xs text-slate-700">{s.label}</span>
              </span>
            )}
          </li>
        ))}
      </ol>

      <p className="text-sm text-slate-800">
        {count(sum.materials, MATERIAL)}:{" "}
        {bar.filter((b) => b.n > 0).map((b, i) => (
          <span key={b.f}>{i > 0 && " · "}<button type="button" className="underline decoration-dotted" onClick={() => setFilter(b.f)}>{b.n} {b.text}</button></span>
        ))}
        {" · "}{sum.withErrors} {sum.withErrors === 1 ? "błąd" : "błędów"}
      </p>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-600">Sortuj:</span>
        <button type="button" className={`rounded border px-2 py-0.5 ${sort === "verdict" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`} onClick={() => setSort("verdict")}>po werdykcie</button>
        <button type="button" className={`rounded border px-2 py-0.5 ${sort === "confidence" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`} onClick={() => setSort("confidence")}>po pewności</button>
        <button type="button" aria-pressed={filter === "uncertain"} className={`rounded border px-2 py-0.5 ${filter === "uncertain" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`} onClick={() => setFilter(filter === "uncertain" ? "all" : "uncertain")}>niepewne: do sprawdzenia ({filterItems(result.items, "uncertain").length})</button>
        {filter !== "all" && <button type="button" className="underline" onClick={() => setFilter("all")}>pokaż wszystkie</button>}
        <span className="ml-auto flex gap-2">
          <button type="button" className="inline-flex items-center gap-1 rounded border border-slate-400 px-2 py-0.5" onClick={() => download("wynik.csv", "text/csv", materialCsv(result))}><Download size={14} aria-hidden />CSV</button>
          <button type="button" className="inline-flex items-center gap-1 rounded border border-slate-400 px-2 py-0.5" onClick={() => download("wynik.json", "application/json", JSON.stringify(resultRows(result), null, 2))}><Download size={14} aria-hidden />JSON</button>
        </span>
      </div>

      {rows.length === 0 ? (
        <Empty>Żaden materiał nie pasuje do tego filtru. Wybierz „pokaż wszystkie”.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-600">
              <tr>
                <th className="px-2 py-1.5">Materiał</th><th>Miniatura</th><th>Werdykt</th><th>Kampania</th><th>Pewność<Help term="pewnosc" /></th><th>Główna przesłanka</th><th>Kompletność</th><th className="w-8"><span className="sr-only">Rozwiń</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((it) => {
                const isOpen = single || open === it.id;
                const conf = resultConfidence(it);
                const best = bestCampaignLink(it);
                const top = it.verdict === "duplicate" ? (it.duplicateOf?.reason ?? "") : best ? premiseSentence(sortByStrength(best.evidence, kitOnly)[0] ?? { evidence: "" }) : "—";
                const comp = itemCompleteness(ctx, it);
                const shot = provenanceOf(ctx, it)?.screenshot;
                return (
                  <Fragment key={it.id}>
                    <tr className="border-t border-slate-100 align-top">
                      <td className="px-2 py-1.5 font-mono text-xs">{it.id}</td>
                      <td className="py-1.5">{shot ? <ThumbImg jobId={job.id} path={shot} /> : <span className="text-xs text-slate-400">—</span>}</td>
                      <td className="py-1.5">{VERDICT_WORD[it.verdict]}</td>
                      <td className="py-1.5">{it.campaign ?? (it.similarCampaigns.length ? `podobna: ${it.similarCampaigns.join(", ")}` : (it.newCampaign ?? "—"))}</td>
                      <td className="py-1.5">{conf ? CONFIDENCE_INFO[conf].short : "—"}</td>
                      <td className="max-w-xs py-1.5 text-xs">{top}</td>
                      <td className="py-1.5 text-xs">{comp.complete ? "kompletne" : <span title={comp.summary}>dane niepełne</span>}</td>
                      <td className="py-1.5"><button type="button" className="px-1 text-lg leading-none" aria-expanded={isOpen} aria-label={`${isOpen ? "Zwiń" : "Rozwiń"} materiał ${it.id}`} onClick={() => !single && setOpen(isOpen ? null : it.id)}>{isOpen ? "▾" : "▸"}</button></td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t border-slate-100 bg-slate-50/50">
                        <td colSpan={8}><ResultCard item={it} ctx={ctx} onShowCampaign={onShowCampaign} onCompare={onCompare} /></td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(result.newCampaigns?.length ?? 0) > 0 && (
        <section aria-label="Nowe kampanie z tej paczki" className="space-y-1.5">
          <h4 className="text-sm font-semibold">Nowe kampanie z tej paczki<Help term="kampania" /></h4>
          <ul className="space-y-1.5 text-sm">
            {result.newCampaigns!.map((n) => (
              <li key={n.id} className="rounded border border-violet-300 bg-violet-50 px-3 py-1.5">
                <b>{n.id}</b>: {n.members.join(", ")}
                {n.evidence[0] && <span className="block text-xs text-slate-700">Łączy je: {n.evidence[0]}</span>}
                <span className="mt-1 block"><EvidenceButton campaignId={n.id} jobId={job.id} /></span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {result.notes.length > 0 && (
        <details className="text-xs text-slate-600"><summary className="cursor-pointer">Uwagi analizy ({result.notes.length})</summary><ul className="mt-1 list-disc pl-5">{result.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></details>
      )}
    </section>
  );
}

/** Thumbnail of a screenshot served by the job API (only from the job folder). */
function ThumbImg({ jobId, path }: { jobId: string; path: string }) {
  return <Image src={`/api/material/${jobId}/image?path=${encodeURIComponent(path)}`} alt="Miniatura zrzutu" width={48} height={48} unoptimized className="h-12 w-12 rounded border border-slate-200 object-cover" />;
}

/** Size in MB (or GB above 1024 MB) for the upload progress. */
function fmtMb(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/**
 * Sends the batch file by file (4 at a time) into an upload session, so the server streams each file
 * to disk and a batch of many GB never travels as one request. Returns the session id for /api/material.
 */
async function uploadFiles(
  queue: { file: File; path: string; caseName: string }[],
  onProgress: (p: { done: number; total: number; bytes: number; totalBytes: number }) => void,
): Promise<string> {
  const res = await fetch("/api/material/upload", { method: "POST" });
  const body = (await res.json()) as { uploadId?: string; error?: string };
  if (!res.ok || !body.uploadId) throw new Error(body.error ?? "Nie udało się rozpocząć wgrywania");
  const id = body.uploadId;
  const totalBytes = queue.reduce((s, q) => s + q.file.size, 0);
  let done = 0;
  let bytes = 0;
  let next = 0;
  onProgress({ done, total: queue.length, bytes, totalBytes });
  const worker = async () => {
    while (next < queue.length) {
      const q = queue[next++];
      const qs = new URLSearchParams({ case: q.caseName, path: q.path });
      const r = await fetch(`/api/material/upload/${id}?${qs}`, { method: "PUT", body: q.file });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `Nie udało się wgrać pliku ${q.path}`);
      }
      done += 1;
      bytes += q.file.size;
      onProgress({ done, total: queue.length, bytes, totalBytes });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  return id;
}

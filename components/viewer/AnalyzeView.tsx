"use client";

import { Download, FolderOpen, Loader2, Upload } from "lucide-react";
import Image from "next/image";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Campaign } from "@/lib/graph/model";
import { materialCsv } from "@/lib/pipeline/materialCsv";
import type { CaseProvenance } from "@/lib/viewer/completeness";
import { defaultSplit, detectCases, FILE_KIND_INFO, SPLIT_LABEL, stripCommonTop, type FileKind, type InputFile, type SplitMode } from "@/lib/viewer/caseDetect";
import { CASE, count, ERROR, fmtElapsed, FILE, MATERIAL } from "@/lib/viewer/format";
import { addToBaseRefusal } from "@/lib/viewer/addToBaseView";
import { familyThresholdFromRules } from "@/lib/viewer/scale";
import { batchSummary, filterItems, resultRows, shownConfidence, sortItems, unreadMaterials, unreadVisible, type ResultFilter, type UnreadMaterial } from "@/lib/viewer/materialView";
import { LIVE_CHOICE_KEY, liveChoiceValue, liveLookupsOption, parseLiveChoice } from "@/lib/viewer/liveLookups";
import { bestCampaignLink } from "@/lib/pipeline/materialCsv";
import { premiseSentence } from "@/lib/viewer/plain";
import { CONFIDENCE_INFO, kitOnlyFromRules, sortByStrength } from "@/lib/viewer/strength";
import type { PublicJob } from "@/lib/viewer/jobs";
import EvidenceButton from "./EvidenceButton";
import AddToBaseButton from "./AddToBaseButton";
import ResultCard, { itemCompleteness, provenanceOf, UnreadCard, type ResultContext } from "./ResultCard";
import { Empty, Help, SyntheticBadge } from "./ui";
import BuildBasePanel from "./BuildBasePanel";

export interface AnalyzeViewProps {
  campaigns: Campaign[];
  minLinkScore: number;
  rules: string[];
  /** The comparison base is the sample (synthetic) one. */
  syntheticBase: boolean;
  /** The server runs with ANALYZE_OFFLINE=1 and ignores the domain lookups option: it starts off and is locked. */
  serverOffline: boolean;
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
  known_campaign: "known campaign",
  similar_campaigns: "new, similar to known ones",
  new_campaign: "new campaign",
  duplicate: "duplicate",
  insufficient: "insufficient data",
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

/** Choice kept in memory when the session storage cannot be written (it then lasts until the page reloads). */
let liveChoiceMemory: boolean | null = null;
const liveChoiceListeners = new Set<() => void>();

/** Choice of the domain lookups made in this browser session, or null when none was made yet. */
function readLiveChoice(): boolean | null {
  try {
    return parseLiveChoice(window.sessionStorage.getItem(LIVE_CHOICE_KEY)) ?? liveChoiceMemory;
  } catch {
    return liveChoiceMemory;
  }
}

/** Subscribes to changes of the choice made in this tab. */
function subscribeLiveChoice(cb: () => void): () => void {
  liveChoiceListeners.add(cb);
  return () => {
    liveChoiceListeners.delete(cb);
  };
}

/** Choice of the domain lookups for this session: it survives switching tabs of the app, which unmounts the form; none on the server. */
function useLiveChoice(): [boolean | null, (on: boolean) => void] {
  const choice = useSyncExternalStore(subscribeLiveChoice, readLiveChoice, () => null);
  /** Remembers the choice and tells the subscribers. */
  const set = (on: boolean) => {
    liveChoiceMemory = on;
    try {
      window.sessionStorage.setItem(LIVE_CHOICE_KEY, liveChoiceValue(on));
    } catch {
      /* storage unavailable: the choice stays in memory */
    }
    for (const cb of liveChoiceListeners) cb();
  };
  return [choice, set];
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

/** "Analyze sample": input (drop zone, link, text), case preview, run progress and the batch result. */
export default function AnalyzeView({ campaigns, minLinkScore, rules, syntheticBase, serverOffline, jobId, onJob, onShowCampaign, onCompare }: AnalyzeViewProps) {
  const [picked, setPicked] = useState<Picked[]>([]);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [liveChoice, setLiveChoice] = useLiveChoice();
  const liveOption = liveLookupsOption(serverOffline, liveChoice);
  const live = liveOption.checked;
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
          setError(body.error ?? "Could not fetch the job status");
          setJob(null);
          return;
        }
        setJob(body);
        setNow(Date.now());
        if (body.status === "running") setTimeout(tick, 1000);
      } catch (e) {
        if (!stop) setError(`No connection to the server: ${(e as Error).message}`);
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
          let rel = top && f.path.startsWith(`${top}/`) ? f.path.slice(top.length + 1) : f.path;
          // a case found one level deeper (a folder of cases next to stray files): drop the folder above it
          const parts = rel.split("/");
          if (parts.length > 2 && parts[1] === c.name) rel = parts.slice(1).join("/");
          queue.push({ file, path: rel, caseName: c.name });
        }
      }
      const form = new FormData();
      form.append("url", overrides?.url ?? url);
      form.append("text", overrides?.text ?? text);
      form.append("live", liveChoiceValue(overrides?.live ?? live));
      try {
        if (queue.length) form.append("uploadId", await uploadFiles(queue, setUpload));
        const res = await fetch("/api/material", { method: "POST", body: form });
        const body = (await res.json()) as { jobId?: string; error?: string };
        if (!res.ok || !body.jobId) throw new Error(body.error ?? "Could not start the analysis");
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
        <h2 className="text-xl font-semibold text-slate-900">Which campaign does this sample belong to?</h2>
        <p className="mt-1 text-sm text-slate-700">
          Upload an ad screenshot, saved page, HAR<Help term="har" />, recording, link or text. We compare it with the reference base<Help term="baza" /> and show where it fits and why.
        </p>
      </div>

      {!jobId && (
        <section className="space-y-3" aria-label="Input">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-slate-400 bg-white p-8 text-center"
          >
            <Upload size={28} aria-hidden className="text-slate-600" />
            <p className="text-base font-medium">Drop files, a folder or a ZIP here</p>
            <div className="flex flex-wrap justify-center gap-2 text-sm">
              <button type="button" className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-white" onClick={() => dirInput.current?.click()}>
                <FolderOpen size={15} aria-hidden />Choose folder
              </button>
              <button type="button" className="rounded-md border border-slate-400 bg-white px-3 py-1.5" onClick={() => fileInput.current?.click()}>Choose files</button>
            </div>
            <input ref={dirInput} type="file" className="hidden" multiple {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(e) => addFiles([...(e.target.files ?? [])].map((f) => ({ file: f, path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name })))} aria-label="Choose folder" />
            <input ref={fileInput} type="file" className="hidden" multiple onChange={(e) => addFiles([...(e.target.files ?? [])].map((f) => ({ file: f, path: f.name })))} aria-label="Choose files" />
            <ul className="max-w-2xl text-left text-xs text-slate-600">
              <li>Screenshot: we read its text and the URL from the address bar.</li>
              <li>HAR is a recording of the browser&apos;s network traffic.</li>
              <li>Saved page: we compare its structure and never open it.</li>
              <li>Video: we read the text from its frames. Dataset file (CSV, JSON): for now, analyze it with <code>bun run analyze-material -- --dataset &lt;file&gt;</code>.</li>
            </ul>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="font-medium">Link</span>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5" />
            </label>
            <label className="text-sm">
              <span className="font-medium">Ad text or product name</span>
              <input value={text} onChange={(e) => setText(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5" />
            </label>
          </div>

          <label className={`flex items-start gap-2 text-sm ${liveOption.disabled ? "text-slate-500" : ""}`}>
            <input type="checkbox" className="mt-1 accent-slate-900" checked={liveOption.checked} disabled={liveOption.disabled} onChange={(e) => setLiveChoice(e.target.checked)} />
            <span>
              <b>Fetch public domain data (DNS, domain registry)</b>
              <span className="block text-xs text-slate-600">
                We ask public registries about the domains in the sample. We never open the scam pages in your browser.{" "}
                {liveOption.note ? <span className="font-medium text-slate-800">{liveOption.note}</span> : "Turn this off if you work without internet access."}
              </span>
            </span>
          </label>

          {picked.length > 0 && (
            <div className="space-y-2 rounded-lg border border-slate-300 bg-white p-3">
              {split.question && mode === split.mode && <p className="rounded bg-amber-50 px-2 py-1.5 text-sm text-amber-900">{split.question}</p>}
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium">Split into cases:</span>
                {(Object.keys(SPLIT_LABEL) as SplitMode[]).map((m) => (
                  <label key={m} className="flex items-center gap-1.5">
                    <input type="radio" name="split" className="accent-slate-900" checked={mode === m} onChange={() => { setModeChoice(m); setOff(new Set()); }} />
                    {SPLIT_LABEL[m]}
                  </label>
                ))}
                <button type="button" className="ml-auto text-xs underline" onClick={reset}>Clear</button>
              </div>
              <p className="text-xs text-slate-600">Found {count(cases.length, CASE)} in {count(picked.length, FILE)}.</p>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-600">
                  <tr><th className="w-8" /><th>Case</th><th>Files</th><th>Notes</th></tr>
                </thead>
                <tbody>
                  {cases.map((c) => (
                    <tr key={c.name} className="border-t border-slate-100 align-top">
                      <td className="py-1.5"><input type="checkbox" className="accent-slate-900" aria-label={`Analyze case ${c.name}`} checked={!off.has(c.name) && c.analyzable} disabled={!c.analyzable} onChange={(e) => setOff((cur) => { const n = new Set(cur); if (e.target.checked) n.delete(c.name); else n.add(c.name); return n; })} /></td>
                      <td className="break-all py-1.5 pr-2 font-mono text-xs">{c.name}</td>
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
              {cases.length ? `Analyze (${selectedCount})` : "Analyze"}
            </button>
            <button type="button" onClick={loadExample} disabled={busy} className="rounded-md border border-slate-400 bg-white px-3 py-2 text-sm">Load example</button>
            <span className="text-xs text-slate-500">The example is a made-up ad, checked without internet access.</span>
          </div>
          {upload && (
            <div className="space-y-1" role="status" aria-live="polite">
              <p className="text-sm text-slate-700">Uploading: {upload.done} of {upload.total} {upload.total === 1 ? "file" : "files"} ({fmtMb(upload.bytes)} of {fmtMb(upload.totalBytes)})</p>
              <div className="h-2 w-full max-w-md overflow-hidden rounded bg-slate-200">
                <div className="h-full bg-slate-900 transition-all" style={{ width: `${upload.totalBytes ? Math.round((upload.bytes / upload.totalBytes) * 100) : 0}%` }} />
              </div>
            </div>
          )}
          {error && <p role="alert" className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>}
        </section>
      )}

      {jobId && !job && !error && <p className="flex items-center gap-2 text-sm text-slate-600"><Loader2 size={15} className="animate-spin" aria-hidden />Loading the job…</p>}
      {jobId && error && !job && (
        <div className="space-y-2">
          <p role="alert" className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
          <button type="button" className="rounded-md border border-slate-400 bg-white px-3 py-1.5 text-sm" onClick={reset}>Start over</button>
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

const STATUS_WORD = { waiting: "waiting", running: "running", done: "done", error: "error" } as const;

/** Run progress: overall count and elapsed time, one row per case with its state, one sentence about what happens, a folded log. */
function Progress({ job, now, onReset }: { job: PublicJob; now: number; onReset: () => void }) {
  const done = job.cases.filter((c) => c.status === "done" || c.status === "error").length;
  const elapsed = Math.max(0, (job.finishedAt ? Date.parse(job.finishedAt) : now) - Date.parse(job.startedAt ?? job.createdAt));
  return (
    <section className="space-y-2 rounded-lg border border-slate-300 bg-white p-3" aria-label="Progress" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold">
          {job.status === "running" ? <><Loader2 size={14} className="mr-1 inline animate-spin" aria-hidden />Analysis running</> : job.status === "done" ? "Analysis finished" : "Analysis failed"}
        </h3>
        <span className="text-sm text-slate-700">{done}/{job.cases.length} {job.cases.length === 1 ? "case" : "cases"} · {fmtElapsed(elapsed)}</span>
        <button type="button" className="ml-auto rounded-md border border-slate-400 px-2.5 py-1 text-sm" onClick={onReset}>New analysis</button>
      </div>
      <ul className="grid gap-1 text-sm md:grid-cols-2">
        {job.cases.map((c) => (
          <li key={c.name} className="flex min-w-0 items-start gap-2 rounded bg-slate-50 px-2 py-1">
            <span className="min-w-0 break-all font-mono text-xs">{c.name}</span>
            <span className={`ml-auto min-w-0 text-right text-xs wrap-anywhere ${c.status === "error" ? "font-medium text-rose-800" : "text-slate-600"}`}>{STATUS_WORD[c.status]}{c.detail ? `: ${c.detail}` : ""}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-600">We read the text from screenshots and recordings, {job.live ? "collect domain data, " : ""}compare with the base and group.</p>
      {job.error && <p role="alert" className="rounded border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-sm text-rose-900">{job.error}</p>}
      {job.log.length > 0 && (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer">Technical log</summary>
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
  /** The result comes from "Load example". */
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
  const unread = useMemo(() => unreadMaterials(result), [result]);
  const single = result.items.length + unread.length === 1;
  const rows = useMemo(() => sortItems(filterItems(result.items, filter), sort), [result.items, filter, sort]);
  // cases the import could not read have neither verdict nor confidence: last in both orders, as in the CSV
  const unreadRows = unreadVisible(filter) ? unread : [];
  const funnel: Array<{ label: string; n: number; f: ResultFilter | null; help?: boolean }> = [
    { label: "Files", n: sum.files, f: null },
    { label: "Samples", n: sum.materials, f: "all" },
    { label: "Duplicates", n: sum.duplicates, f: "duplicate" },
    { label: "Links to the base", n: sum.linkedToBase, f: null },
    { label: "Known campaigns", n: sum.known, f: "known" },
    { label: "New campaigns", n: sum.fresh, f: "fresh" },
    { label: "Insufficient data", n: sum.insufficient, f: "insufficient" },
  ];
  const bar: Array<{ n: number; text: string; f: ResultFilter }> = [
    { n: sum.known, text: "to known campaigns", f: "known" },
    { n: sum.similar, text: "new, similar", f: "similar" },
    { n: sum.brandNew, text: "new", f: "new" },
    { n: sum.duplicates, text: sum.duplicates === 1 ? "duplicate" : "duplicates", f: "duplicate" },
    { n: sum.insufficient, text: "insufficient data", f: "insufficient" },
  ];
  return (
    <section className="space-y-4" aria-label="Result">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold">Result: {count(sum.materials, MATERIAL)}</h3>
        {synthetic && <SyntheticBadge />}
        <span className="ml-auto"><AddToBaseButton jobId={job.id} ids={result.items.filter((i) => i.verdict !== "duplicate" && i.verdict !== "insufficient").map((i) => i.id)} label="Add samples to base" disabledReason={ctx.addToBaseDisabled} /></span>
      </div>

      {!job.together && sum.materials > 1 && (
        <p className="rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">Samples in this batch are not compared with each other, only with the reference base.</p>
      )}

      <ol className="flex flex-wrap items-stretch gap-1.5" aria-label="Funnel">
        <li className="self-center text-xs text-slate-600">Funnel<Help term="lejek" /></li>
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
        {" · "}{count(sum.withErrors, ERROR)}
        {sum.unread > 0 && (
          <>
            {" "}(of which unread:{" "}
            <button type="button" className="underline decoration-dotted" onClick={() => setFilter("insufficient")}>{sum.unread}</button>)
          </>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-600">Sort:</span>
        <button type="button" className={`rounded border px-2 py-0.5 ${sort === "verdict" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`} onClick={() => setSort("verdict")}>by verdict</button>
        <button type="button" className={`rounded border px-2 py-0.5 ${sort === "confidence" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`} onClick={() => setSort("confidence")}>by confidence</button>
        <button type="button" aria-pressed={filter === "uncertain"} className={`rounded border px-2 py-0.5 ${filter === "uncertain" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`} onClick={() => setFilter(filter === "uncertain" ? "all" : "uncertain")}>uncertain: to check ({filterItems(result.items, "uncertain").length})</button>
        {filter !== "all" && <button type="button" className="underline" onClick={() => setFilter("all")}>show all</button>}
        <span className="ml-auto flex gap-2">
          <button type="button" className="inline-flex items-center gap-1 rounded border border-slate-400 px-2 py-0.5" onClick={() => download("result.csv", "text/csv", materialCsv(result))}><Download size={14} aria-hidden />CSV</button>
          <button type="button" className="inline-flex items-center gap-1 rounded border border-slate-400 px-2 py-0.5" onClick={() => download("result.json", "application/json", JSON.stringify(resultRows(result), null, 2))}><Download size={14} aria-hidden />JSON</button>
        </span>
      </div>

      {rows.length + unreadRows.length === 0 ? (
        <Empty>No sample matches this filter. Choose “show all”.</Empty>
      ) : (
        // Fixed column widths: a long sample id or address wraps inside its cell instead of widening the table,
        // and the expanded card gets the width of the table. Below the minimum width the table scrolls in its frame.
        <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white">
          <table className="w-full min-w-[56rem] table-fixed text-sm">
            <colgroup>
              <col className="w-40" />
              <col className="w-16" />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-32" />
              <col />
              <col className="w-24" />
              <col className="w-8" />
            </colgroup>
            <thead className="bg-slate-50 text-left text-xs text-slate-600">
              <tr>
                <th className="px-2 py-1.5">Sample</th><th className="px-2">Thumbnail</th><th className="px-2">Verdict</th><th className="px-2">Campaign</th><th className="px-2">Confidence<Help term="pewnosc" /></th><th className="px-2">Main evidence</th><th className="px-2">Completeness</th><th><span className="sr-only">Expand</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((it) => {
                const isOpen = single || open === it.id;
                const conf = shownConfidence(it);
                const best = bestCampaignLink(it);
                const top = it.verdict === "duplicate" ? (it.duplicateOf?.reason ?? "") : best ? premiseSentence(sortByStrength(best.evidence, kitOnly)[0] ?? { evidence: "" }) : "—";
                const comp = itemCompleteness(ctx, it);
                const shot = provenanceOf(ctx, it)?.screenshot;
                return (
                  <Fragment key={it.id}>
                    <tr className="border-t border-slate-100 align-top">
                      <td className="break-all px-2 py-1.5 font-mono text-xs">{it.id}</td>
                      <td className="px-2 py-1.5">{shot ? <ThumbImg jobId={job.id} path={shot} /> : <span className="text-xs text-slate-400">—</span>}</td>
                      <td className="px-2 py-1.5">{VERDICT_WORD[it.verdict]}</td>
                      <td className="px-2 py-1.5 wrap-anywhere">{it.campaign ?? (it.similarCampaigns.length ? `similar: ${it.similarCampaigns.join(", ")}` : (it.newCampaign ?? "—"))}</td>
                      <td className="px-2 py-1.5" title={conf ? CONFIDENCE_INFO[conf].help : undefined}>{conf ? CONFIDENCE_INFO[conf].short : "—"}</td>
                      <td className="px-2 py-1.5 text-xs wrap-anywhere">{top}</td>
                      <td className="px-2 py-1.5 text-xs">{comp.complete ? "complete" : <span title={comp.summary}>incomplete data</span>}</td>
                      <td className="py-1.5"><button type="button" className="px-1 text-lg leading-none" aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} sample ${it.id}`} onClick={() => !single && setOpen(isOpen ? null : it.id)}>{isOpen ? "▾" : "▸"}</button></td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t border-slate-100 bg-slate-50/50">
                        <td colSpan={8}><ResultCard item={it} ctx={ctx} onShowCampaign={onShowCampaign} onCompare={onCompare} /></td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {unreadRows.map((u) => (
                <UnreadRow key={`unread:${u.id}`} material={u} open={single || open === `unread:${u.id}`} onToggle={single ? undefined : () => setOpen(open === `unread:${u.id}` ? null : `unread:${u.id}`)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(result.newCampaigns?.length ?? 0) > 0 && (
        <section aria-label="New campaigns from this batch" className="space-y-1.5">
          <h4 className="text-sm font-semibold">New campaigns from this batch<Help term="kampania" /></h4>
          <ul className="space-y-1.5 text-sm">
            {result.newCampaigns!.map((n) => (
              <li key={n.id} className="rounded border border-violet-300 bg-violet-50 px-3 py-1.5 wrap-anywhere">
                <b>{n.id}</b>: {n.members.join(", ")}
                {n.evidence[0] && <span className="block text-xs text-slate-700">Linked by: {n.evidence[0]}</span>}
                <span className="mt-1 block"><EvidenceButton campaignId={n.id} jobId={job.id} /></span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {result.notes.length > 0 && (
        <details className="text-xs text-slate-600"><summary className="cursor-pointer">Analysis notes ({result.notes.length})</summary><ul className="mt-1 list-disc pl-5 wrap-anywhere">{result.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></details>
      )}
    </section>
  );
}

/**
 * Row of a case the import could not read (e.g. a saved page without its address): "insufficient data" with the
 * reason in the premise column, and when expanded the card with what to add. The CSV has the same row.
 */
function UnreadRow({ material, open, onToggle }: { material: UnreadMaterial; open: boolean; onToggle?: () => void }) {
  return (
    <>
      <tr className="border-t border-slate-100 align-top">
        <td className="break-all px-2 py-1.5 font-mono text-xs">{material.id}</td>
        <td className="px-2 py-1.5"><span className="text-xs text-slate-400">—</span></td>
        <td className="px-2 py-1.5">{VERDICT_WORD.insufficient}<span className="block text-xs font-medium text-rose-800">not read</span></td>
        <td className="px-2 py-1.5">—</td>
        <td className="px-2 py-1.5">—</td>
        <td className="px-2 py-1.5 text-xs wrap-anywhere">{material.reasons.join("; ")}</td>
        <td className="px-2 py-1.5 text-xs">incomplete data</td>
        <td className="py-1.5"><button type="button" className="px-1 text-lg leading-none" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} sample ${material.id}`} onClick={() => onToggle?.()}>{open ? "▾" : "▸"}</button></td>
      </tr>
      {open && (
        <tr className="border-t border-slate-100 bg-slate-50/50">
          <td colSpan={8}><UnreadCard material={material} /></td>
        </tr>
      )}
    </>
  );
}

/** Thumbnail of a screenshot served by the job API (only from the job folder). */
function ThumbImg({ jobId, path }: { jobId: string; path: string }) {
  return <Image src={`/api/material/${jobId}/image?path=${encodeURIComponent(path)}`} alt="Screenshot thumbnail" width={48} height={48} unoptimized className="h-12 w-12 rounded border border-slate-200 object-cover" />;
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
  if (!res.ok || !body.uploadId) throw new Error(body.error ?? "Could not start the upload");
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
        throw new Error(err.error ?? `Could not upload the file ${q.path}`);
      }
      done += 1;
      bytes += q.file.size;
      onProgress({ done, total: queue.length, bytes, totalBytes });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  return id;
}

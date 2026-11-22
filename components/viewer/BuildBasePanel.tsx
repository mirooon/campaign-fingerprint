"use client";

import { useRef, useState } from "react";

type Phase = { kind: "idle" } | { kind: "confirm"; question: string } | { kind: "building" } | { kind: "done"; text: string } | { kind: "error"; text: string };

/**
 * "Zbuduj nową bazę" (B-284): the analyst picks a folder of cases (one subfolder per case) and, after confirming the
 * replacement of the current base, the server builds a new base of known campaigns (`/api/build-base`). The previous
 * base is set aside, never deleted.
 */
export default function BuildBasePanel() {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Array<{ file: File; path: string }>>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const cases = new Set(files.map((f) => f.path.split("/").slice(0, -1).slice(0, 2).join("/"))).size;

  /** Asks the server for the current base and shows the replacement question (or the refusal). */
  async function ask() {
    try {
      const res = await fetch("/api/build-base", { cache: "no-store" });
      const body = (await res.json()) as { question: string; refusal: string | null };
      setPhase(body.refusal ? { kind: "error", text: body.refusal } : { kind: "confirm", question: body.question });
    } catch (e) {
      setPhase({ kind: "error", text: (e as Error).message });
    }
  }

  /** Uploads the cases with the confirmation and waits for the build. */
  async function build() {
    setPhase({ kind: "building" });
    const form = new FormData();
    for (const f of files) form.append("files", f.file, f.path);
    form.append("confirm", "1");
    try {
      const res = await fetch("/api/build-base", { method: "POST", body: form });
      const body = (await res.json()) as { error?: string; summary?: { campaigns: number; materials: number }; backup?: string | null };
      if (!res.ok || !body.summary) throw new Error(body.error ?? `Budowa bazy nie powiodła się (kod ${res.status})`);
      setPhase({ kind: "done", text: `Gotowe: nowa baza ma ${body.summary.campaigns} kampanii i ${body.summary.materials} materiałów.${body.backup ? ` Poprzednia baza leży w ${body.backup}.` : ""} Odśwież stronę, żeby ją zobaczyć.` });
    } catch (e) {
      setPhase({ kind: "error", text: (e as Error).message });
    }
  }

  return (
    <details className="rounded-lg border border-slate-300 bg-white p-3 text-sm">
      <summary className="cursor-pointer font-medium text-slate-900">Zbuduj nową bazę</summary>
      <p className="mt-2 text-slate-700">Zamiast dopisywać materiały, zbuduj bazę porównawczą od nowa z folderu spraw (jeden podfolder na sprawę: zrzut, zapisana strona, HAR, nagranie). Obecna baza zostanie zastąpiona po potwierdzeniu i odłożona, nie usunięta.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          className="hidden"
          multiple
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(e) => {
            setFiles([...(e.target.files ?? [])].map((f) => ({ file: f, path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name })));
            setPhase({ kind: "idle" });
          }}
          aria-label="Wybierz folder spraw"
        />
        <button type="button" onClick={() => input.current?.click()} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-800 hover:border-slate-500">
          Wybierz folder spraw
        </button>
        {files.length > 0 && <span className="text-xs text-slate-600">{files.length} plików, ok. {cases} {cases === 1 ? "sprawa" : "spraw"}</span>}
        <button type="button" disabled={!files.length || phase.kind === "building"} onClick={() => void ask()} className="rounded-md bg-slate-900 px-3 py-1 text-white disabled:opacity-40">
          Zbuduj nową bazę
        </button>
      </div>
      {phase.kind === "confirm" && (
        <div role="alertdialog" aria-label="Potwierdź zastąpienie bazy" className="mt-2 rounded-md border border-amber-400 bg-amber-50 p-2 text-amber-950">
          <p>{phase.question}</p>
          <div className="mt-1.5 flex gap-2">
            <button type="button" onClick={() => void build()} className="rounded-md bg-amber-700 px-2 py-0.5 text-white">Tak, zastąp bazę</button>
            <button type="button" onClick={() => setPhase({ kind: "idle" })} className="rounded-md border border-slate-300 bg-white px-2 py-0.5">Anuluj</button>
          </div>
        </div>
      )}
      {phase.kind === "building" && <p role="status" className="mt-2 text-slate-700">Buduję bazę (import spraw, wzbogacanie, graf). To może potrwać kilka minut…</p>}
      {phase.kind === "done" && <p role="status" className="mt-2 text-emerald-800">{phase.text}</p>}
      {phase.kind === "error" && <p role="alert" className="mt-2 text-red-800">{phase.text}</p>}
    </details>
  );
}

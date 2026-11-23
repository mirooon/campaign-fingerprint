"use client";

import { useEffect, useState } from "react";
import type { RecognizedPerson } from "@/lib/viewer/recognized";
import { Empty, Help } from "./ui";

type State = { status: "loading" } | { status: "ready"; people: RecognizedPerson[]; notes: string[] } | { status: "error"; message: string };

/**
 * "Recognized people" (B-025): transparency of the biometric step. Lists the closed set of people the tool compares
 * faces and voices with, how many reference samples each has and the public source that put them on the list.
 */
export default function RecognizedView() {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/recognized", { signal: ctl.signal })
      .then((r) => r.json() as Promise<{ people: RecognizedPerson[]; notes: string[] }>)
      .then((b) => setState({ status: "ready", people: b.people, notes: b.notes }))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setState({ status: "error", message: `Could not load the list: ${e.message}` });
      });
    return () => ctl.abort();
  }, []);
  return (
    <div className="mx-auto max-w-4xl space-y-3 p-4">
      <h2 className="text-xl font-semibold">Who do we recognize?<Help term="baza_osob" /></h2>
      <p className="text-sm text-slate-700">
        The tool compares faces and voices from a sample only with this closed list of people whose likeness is often impersonated in frauds. The result is “face similar to X” or “voice similar to X” with a number from 0 to 1: a hint for a person to check, never an identification. Face and voice templates stay on this computer.
      </p>
      {state.status === "loading" && <p className="text-sm text-slate-600">Loading the list…</p>}
      {state.status === "error" && <p className="text-sm text-slate-600">{state.message}</p>}
      {state.status === "ready" && (
        <>
          {state.people.length === 0 ? (
            <Empty>No face and voice gallery yet. Build it as the README describes (setup-face.sh, build_voice_index.py).</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">People on the recognition list with the number of face and voice templates and the source of the entry</caption>
                <thead>
                  <tr className="border-b border-slate-300 text-left text-xs text-slate-600">
                    <th scope="col" className="p-1.5 font-medium">Person</th>
                    <th scope="col" className="p-1.5 font-medium">Face (photos)</th>
                    <th scope="col" className="p-1.5 font-medium">Voice (clips)</th>
                    <th scope="col" className="p-1.5 font-medium">Source of the list entry</th>
                  </tr>
                </thead>
                <tbody>
                  {state.people.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100 align-top">
                      <th scope="row" className="p-1.5 text-left font-medium">
                        {p.name}
                        {(p.role || p.category) && <span className="block text-xs font-normal text-slate-600">{[p.role, p.category].filter(Boolean).join(" · ")}</span>}
                      </th>
                      <td className="p-1.5">{p.faces || "—"}</td>
                      <td className="p-1.5">{p.voices || "—"}</td>
                      <td className="max-w-md p-1.5 text-xs text-slate-700">{p.source ?? "no entry in the list of people"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {state.notes.length > 0 && <ul className="list-disc pl-5 text-xs text-slate-600">{state.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </>
      )}
    </div>
  );
}

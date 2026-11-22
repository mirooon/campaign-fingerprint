"use client";

import { useEffect, useState } from "react";
import type { RecognizedPerson } from "@/lib/viewer/recognized";
import { Empty, Help } from "./ui";

type State = { status: "loading" } | { status: "ready"; people: RecognizedPerson[]; notes: string[] } | { status: "error"; message: string };

/**
 * "Kogo rozpoznajemy?" (B-025): transparency of the biometric step. Lists the closed set of people the tool compares
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
        if (e.name !== "AbortError") setState({ status: "error", message: `Nie udało się wczytać listy: ${e.message}` });
      });
    return () => ctl.abort();
  }, []);
  return (
    <div className="mx-auto max-w-4xl space-y-3 p-4">
      <h2 className="text-xl font-semibold">Kogo rozpoznajemy?<Help term="baza_osob" /></h2>
      <p className="text-sm text-slate-700">
        Narzędzie porównuje twarze i głosy z materiału tylko z tą zamkniętą listą osób, których wizerunek bywa podszywany w oszustwach. Wynik to „podobna twarz do X” albo „głos podobny do X” z liczbą od 0 do 1: wskazówka do sprawdzenia przez człowieka, nigdy ustalenie tożsamości. Wzorce twarzy i głosu zostają na tym komputerze.
      </p>
      {state.status === "loading" && <p className="text-sm text-slate-600">Wczytywanie listy…</p>}
      {state.status === "error" && <p className="text-sm text-slate-600">{state.message}</p>}
      {state.status === "ready" && (
        <>
          {state.people.length === 0 ? (
            <Empty>Brak galerii twarzy i głosów. Zbuduj ją według README (setup-face.sh, build_voice_index.py).</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Osoby z listy rozpoznawania z liczbą wzorców twarzy i głosu oraz źródłem wpisu</caption>
                <thead>
                  <tr className="border-b border-slate-300 text-left text-xs text-slate-600">
                    <th scope="col" className="p-1.5 font-medium">Osoba</th>
                    <th scope="col" className="p-1.5 font-medium">Twarz (zdjęcia)</th>
                    <th scope="col" className="p-1.5 font-medium">Głos (fragmenty)</th>
                    <th scope="col" className="p-1.5 font-medium">Źródło wpisu na listę</th>
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
                      <td className="max-w-md p-1.5 text-xs text-slate-700">{p.source ?? "brak wpisu w liście osób"}</td>
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

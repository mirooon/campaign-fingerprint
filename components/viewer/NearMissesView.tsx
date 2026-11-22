"use client";

import type { NearMissesFile } from "@/lib/graph/model";
import { fmtNum } from "@/lib/viewer/format";
import { nearMissRows } from "@/lib/viewer/nearMissView";
import { NEAR_MISS_RULE_INFO } from "@/lib/viewer/plain";
import { Empty } from "./ui";

export interface NearMissesViewProps {
  /** `near-misses.json` of the run; null when the run was made before the report existed. */
  file: NearMissesFile | null;
  /** Open the comparison of the two materials of a pair. */
  onCompare: (a: string, b: string) => void;
}

/**
 * Tab "Celowo nie połączone": pairs of materials that look alike but that the method deliberately did not join
 * into one campaign, each with the rule that held it back. It shows that the method guards against false links
 * (one person in the ad, a popular template, a shared platform, CDN or registrar) and lists the cases to review
 * when the threshold is close.
 */
export default function NearMissesView({ file, onCompare }: NearMissesViewProps) {
  if (!file) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <Empty>Ten przebieg nie ma zestawienia „celowo nie połączone” (near-misses.json). Zbuduj bazę ponownie: bun run build-graph.</Empty>
      </div>
    );
  }
  const rows = nearMissRows(file);
  const byRule = Object.entries(file.byRule) as Array<[keyof typeof NEAR_MISS_RULE_INFO, number]>;
  return (
    <div className="mx-auto max-w-6xl space-y-3 p-4">
      <h2 className="text-xl font-semibold">Podobne, ale celowo nie połączone w jedną kampanię</h2>
      <p className="text-sm text-slate-700">
        Pary materiałów, które mają coś wspólnego, a metoda mimo to nie uznała ich za jedną kampanię. Przy każdej widać regułę, która to zablokowała, i czego zabrakło.
        Na liście są pary o wyniku co najmniej {fmtNum(file.minScoreRatio * file.minLinkScore)} (połowa progu łączenia {fmtNum(file.minLinkScore)}), z pominiętym śladem mocnego typu albo z jednej grupy podobnych kampanii.
      </p>
      {byRule.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-xs">
          {byRule.map(([rule, n]) => (
            <li key={rule} className="rounded bg-slate-100 px-2 py-1 text-slate-800" title={NEAR_MISS_RULE_INFO[rule].why}>
              {NEAR_MISS_RULE_INFO[rule].term}: <b>{n}</b>
            </li>
          ))}
        </ul>
      )}
      {rows.length === 0 ? (
        <Empty>Brak par, które byłyby blisko połączenia.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">Para</th>
                <th className="px-3 py-2 font-medium">Wynik</th>
                <th className="px-3 py-2 font-medium">Wspólne ślady</th>
                <th className="px-3 py-2 font-medium">Reguła</th>
                <th className="px-3 py-2 font-medium">Dlaczego nie połączone</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.a}|${r.b}`} className="border-t border-slate-200 align-top">
                  <td className="px-3 py-2">
                    <button type="button" className="underline" onClick={() => onCompare(r.a, r.b)} title="Porównaj te dwa materiały">
                      {r.a} i {r.b}
                    </button>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{fmtNum(r.score)}</td>
                  <td className="px-3 py-2">{r.traces.join("; ")}</td>
                  <td className="px-3 py-2 font-medium">{r.ruleName}</td>
                  <td className="px-3 py-2 text-slate-700">{r.reasonPlain}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {file.total > rows.length && <p className="text-xs text-slate-600">Pokazano {rows.length} z {file.total} par (najwyższe wyniki).</p>}
    </div>
  );
}

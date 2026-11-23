"use client";

import { usePathname, useRouter } from "next/navigation";
import { METHOD_ANCHOR, READ_HOW, type NextStep, type VisualId } from "@/lib/viewer/copy";

/** "How to read" caption under a visualisation (B-034). */
export function ReadHow({ id }: { id: VisualId }) {
  return (
    <p className="mt-1 text-[11px] leading-snug text-slate-600" data-caption={id}>
      <b className="font-medium text-slate-700">How to read: </b>
      {READ_HOW[id]}
    </p>
  );
}

/** "How did we compute this?" link: opens "How it works" at the methodology section (thresholds from the base's method). */
export function HowComputedLink({ className = "" }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <button type="button" data-no-print onClick={() => router.push(`${pathname}?tab=how#${METHOD_ANCHOR}`)} className={`text-xs text-blue-800 underline underline-offset-2 ${className}`}>
      How did we compute this?
    </button>
  );
}

/** "What next?" box with 1–3 actions; an action with a handler becomes a button, the others stay as sentences. */
export function NextSteps({ steps, on = {} }: { steps: NextStep[]; on?: Partial<Record<NextStep["id"], () => void>> }) {
  if (!steps.length) return null;
  return (
    <section aria-label="What next?" className="rounded-md border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-950" data-no-print>
      <b className="text-sm">What next?</b>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5">
        {steps.map((s) => (
          <li key={s.id}>
            {on[s.id] ? (
              <button type="button" onClick={on[s.id]} className="text-left underline underline-offset-2">
                {s.label}
              </button>
            ) : (
              s.label
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

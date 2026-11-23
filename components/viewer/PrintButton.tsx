"use client";

import { Printer } from "lucide-react";

/**
 * "Print card (PDF)": prints only the campaign card this button sits in (the browser's print dialog
 * also saves a PDF). The card is marked for the print stylesheet (app/globals.css) for the time of
 * printing; the stylesheet fits it to A4 without cutting tables.
 */
export default function PrintButton() {
  const print = (e: React.MouseEvent<HTMLButtonElement>) => {
    const card = e.currentTarget.closest("article");
    if (!card) return;
    card.setAttribute("data-print-target", "");
    window.addEventListener("afterprint", () => card.removeAttribute("data-print-target"), { once: true });
    window.print();
  };
  return (
    <button type="button" onClick={print} className="inline-flex items-center gap-1.5 rounded-md border border-slate-400 bg-white px-2.5 py-1 text-xs font-medium text-slate-900 hover:bg-slate-100" title="Print the campaign card on A4 or save it as PDF">
      <Printer size={13} aria-hidden />
      Print card (PDF)
    </button>
  );
}

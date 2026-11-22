/**
 * Guiding texts of the GUI (B-034): "Jak czytać" captions under every visualisation, the "Co dalej?" actions and the
 * anchor of the methodology section ("Jak to policzyliśmy?").
 */
import type { Campaign } from "@/lib/graph/model";
import type { Decision } from "./decisions";

/** Anchor of the methodology section in "Jak to działa". */
export const METHOD_ANCHOR = "jak-policzylismy";

/** Visualisations that carry a "Jak czytać" caption. */
export type VisualId = "graph" | "evolution" | "threshold" | "compare" | "strength";

/** "Jak czytać" caption of each visualisation: one or two plain sentences. */
export const READ_HOW: Record<VisualId, string> = {
  graph: "Kropki to materiały i wspólne ślady (domena, tracker, telefon…), linie pokazują, kto co współdzieli. Kolor obwódki to kampania; im grubsza linia, tym silniejsza przesłanka. Kliknij kropkę, żeby zobaczyć dowody.",
  evolution: "Oś czasu kampanii: każdy wiersz to ślad (domena, kreacja, konto), a pasek pokazuje, od kiedy do kiedy go widzieliśmy. Nowy pasek w połowie kampanii to zmiana infrastruktury albo kreacji przy tym samym operatorze.",
  threshold: "Liczby pokazują, ile kampanii powstałoby przy innym progu łączenia. Gdy wynik prawie się nie zmienia, podział jest stabilny; duży skok oznacza kampanie trzymające się na słabych przesłankach.",
  compare: "Dwa materiały obok siebie: na górze wspólne ślady z ich siłą, niżej cechy, które się różnią. Wspólny silny ślad wystarcza do połączenia; same słabe muszą razem przekroczyć próg.",
  strength: "Pasek to wynik pary od 0 do 1: łączy siłę wszystkich wspólnych śladów. Powyżej progu łączenia materiały mogą trafić do jednej kampanii.",
};

/** One action of the "Co dalej?" box. */
export interface NextStep {
  id: "decide" | "compare" | "weakest" | "evidence" | "analyze";
  label: string;
}

/**
 * The 1–3 actions of the "Co dalej?" box of an opened campaign: decide first when nothing is decided, check the weakest
 * link of a campaign standing on a bridge or a weak link, compare two materials, and download the evidence pack once the
 * campaign is marked for reporting.
 */
export function campaignNextSteps(c: Pick<Campaign, "size" | "bridge" | "minInternalScore">, decision: Decision | null, minLinkScore: number): NextStep[] {
  const out: NextStep[] = [];
  if (!decision) out.push({ id: "decide", label: "Oceń kampanię: wybierz „do zgłoszenia”, „do weryfikacji” albo „odrzucone” (Decyzja analityka poniżej)." });
  const weak = Boolean(c.bridge) || (typeof c.minInternalScore === "number" && c.minInternalScore < minLinkScore + 0.1);
  if (c.size > 1 && weak) out.push({ id: "weakest", label: "Sprawdź najsłabsze ogniwo: porównaj materiały połączone najsłabszą przesłanką, zanim zgłosisz całość." });
  if (c.size > 1) out.push({ id: "compare", label: "Porównaj dwa materiały z kampanii, żeby zobaczyć wspólne ślady obok siebie." });
  if (decision === "to_report" || decision === "reported") out.push({ id: "evidence", label: "Pobierz pakiet dowodów i dołącz go do zgłoszenia." });
  if (!out.length) out.push({ id: "analyze", label: "Wgraj kolejny materiał w „Analizuj materiał”, żeby sprawdzić, czy należy do tej kampanii." });
  return out.slice(0, 3);
}

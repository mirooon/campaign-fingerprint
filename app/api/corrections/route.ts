/**
 * GET /api/corrections → `{ corrections, file }`: the analyst's corrections of the base (B-281).
 * POST /api/corrections { action: "must" | "cannot", a, b, note? } | { action: "disable-pivot", pivot } | { action: "remove", a?, b?, pivot? }
 * records "link", "split" / "this link is wrong", a disabled trace, or undoes one. Kept in `corrections.json`
 * next to the base; `build-graph` applies it on the next run, with the premise "analyst decision".
 */
import { z } from "zod";
import { currentCorrectionsFile, loadCorrectionsFile, saveCorrectionAction, type CorrectionAction } from "@/lib/viewer/correctionsFile";

const Id = z.string().trim().min(1).max(200).regex(/^[^\s|]+$/, "Invalid ad ID");
const Pivot = z.string().trim().min(1).max(500);
const Note = z.string().trim().max(500).optional();
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("must"), a: Id, b: Id, note: Note }),
  z.object({ action: z.literal("cannot"), a: Id, b: Id, note: Note }),
  z.object({ action: z.literal("disable-pivot"), pivot: Pivot, note: Note }),
  z.object({ action: z.literal("remove"), a: Id.optional(), b: Id.optional(), pivot: Pivot.optional() }),
]);

/** GET /api/corrections: all corrections of the base; an unreadable file answers `{ error }` with 500. */
export async function GET(): Promise<Response> {
  const file = currentCorrectionsFile();
  const out = loadCorrectionsFile(file);
  return out.ok ? Response.json({ corrections: out.file, file }, { headers: { "cache-control": "no-store" } }) : Response.json({ error: out.error }, { status: 500 });
}

/** POST /api/corrections: applies one action; 400 for a bad body or a pair of one ad, 500 when the file cannot be read or written. */
export async function POST(request: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  const act = parsed.data as CorrectionAction;
  if ((act.action === "must" || act.action === "cannot") && act.a === act.b) return Response.json({ error: "Choose two different ads" }, { status: 400 });
  const file = currentCorrectionsFile();
  const out = saveCorrectionAction(file, act);
  return out.ok ? Response.json({ corrections: out.file, file }) : Response.json({ error: out.error }, { status: 500 });
}

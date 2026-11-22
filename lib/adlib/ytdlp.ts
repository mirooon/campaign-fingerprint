/**
 * Creative of a Meta Ad Library ad from its library page, through yt-dlp (metadata only, no download):
 * `yt-dlp --skip-download --dump-json --ignore-no-formats-error <library address>`. On request, as part
 * of `--ad-library` and of `adlib get`. It uses the public page like the browser does; it can stop working
 * when Meta changes the page, and every failure comes back as a reason, never as a thrown error.
 */
import type { EnvMap } from "../media/asr";
import { defaultRunner, which, type ToolRunner } from "../media/tools";
import { adLibraryUrl, type AdCreativeInfo } from "../osint/adLibrary";

/** Trimmed text, or null for a missing or blank value. */
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Creative from the JSON of `yt-dlp --dump-json`; throws when the text is not a JSON object. */
export function parseYtDlpAd(stdout: string): AdCreativeInfo {
  const start = stdout.indexOf("{");
  let j: Record<string, unknown>;
  try {
    j = start < 0 ? {} : JSON.parse(stdout.slice(start));
  } catch {
    throw new Error("niepoprawna odpowiedź yt-dlp");
  }
  if (!Object.keys(j).length) throw new Error("niepoprawna odpowiedź yt-dlp");
  return {
    text: str(j.description),
    title: str(j.title),
    imageUrl: str(j.thumbnail),
    videoUrl: str(j.url),
    uploader: str(j.uploader) ?? str(j.playlist_uploader),
    uploaderId: str(j.uploader_id),
    startedAt: typeof j.timestamp === "number" ? new Date(j.timestamp * 1000).toISOString() : null,
  };
}

/**
 * Asks yt-dlp for the creative of one library ad. `ytDlp` is the binary (null = known to be missing;
 * undefined = look it up on PATH). Returns the creative or the reason there is none.
 */
export async function fetchAdCreative(
  adId: string,
  opts: { run?: ToolRunner; ytDlp?: string | null; env?: EnvMap } = {},
): Promise<{ creative: AdCreativeInfo | null; error: string | null }> {
  const bin = opts.ytDlp === undefined ? await which("yt-dlp", opts.env ?? process.env) : opts.ytDlp;
  if (!bin) return { creative: null, error: "brak yt-dlp (brew install yt-dlp)" };
  const r = await (opts.run ?? defaultRunner)(bin, ["--skip-download", "--dump-json", "--ignore-no-formats-error", "--no-warnings", adLibraryUrl(adId)], { timeoutMs: 90_000 });
  if (r.timedOut) return { creative: null, error: "yt-dlp: przekroczony czas" };
  if (r.code !== 0) return { creative: null, error: `yt-dlp: ${(r.stderr.trim().split("\n").pop() ?? "błąd").slice(0, 200)}` };
  try {
    return { creative: parseYtDlpAd(r.stdout), error: null };
  } catch (e) {
    return { creative: null, error: (e as Error).message };
  }
}

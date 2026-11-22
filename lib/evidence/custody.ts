/**
 * Chain of custody and time stamp of the evidence pack. The chain has an entry for each stage the
 * material went through: import (paths' file names and SHA-256 taken before anything touched
 * them), enrichment (when, live or offline, which user agent), export (SHA-256 of the manifest).
 * The time stamp (RFC 3161) is optional and needs the network: without it the token is null and
 * the note says why. Pure functions; talking to the TSA stays in scripts/evidence.ts.
 */

export interface CustodyEntry {
  utc: string;
  actor: string;
  action: string;
  tool_version?: string;
  sha256_after?: string;
}

export interface CustodyInput {
  campaignId: string;
  exportUtc: string;
  tool: string;
  manifestSha256: string;
  /** Per case of the campaign, from provenance.json; empty when the import left none. */
  imports: Array<{ id: string; importedUtc: string | null; files: Array<{ role: string; name: string; sha256: string | null }> }>;
  enrich: { generatedUtc: string; mode: "live" | "offline"; fetchedFirstUtc: string | null; fetchedLastUtc: string | null; userAgents: string[] };
}

/** Entries of the chain in time order: import (or a note that there is no provenance), enrichment, export. */
export function buildCustodyLog(i: CustodyInput): CustodyEntry[] {
  const importedAt = i.imports.map((c) => c.importedUtc).filter((t): t is string => !!t).sort()[0] ?? i.enrich.generatedUtc;
  const files = i.imports.flatMap((c) => c.files.map((f) => `${c.id}/${f.name} [${f.role}] sha256 ${f.sha256 ?? "nieczytelny"}`));
  const importEntry: CustodyEntry = {
    utc: importedAt,
    actor: "starter (import spraw)",
    action: files.length ? `import plików sprawy, sumy SHA-256 oryginałów przed jakąkolwiek obróbką: ${files.join("; ")}` : "brak provenance.json: import bez sum plików wejściowych (zbiór nie pochodzi z importu spraw)",
  };
  const fetched = i.enrich.fetchedFirstUtc ? `; zapytania sieciowe ${i.enrich.fetchedFirstUtc} – ${i.enrich.fetchedLastUtc ?? i.enrich.fetchedFirstUtc}` : "";
  const enrichEntry: CustodyEntry = {
    utc: i.enrich.generatedUtc,
    actor: "starter (wzbogacanie)",
    action: `wzbogacenie danych w trybie ${i.enrich.mode}${fetched}; User-Agent: ${i.enrich.userAgents.join(", ") || "brak"}`,
  };
  const exportEntry: CustodyEntry = {
    utc: i.exportUtc,
    actor: "starter (eksport paczki)",
    action: `eksport paczki dla kampanii ${i.campaignId}`,
    tool_version: i.tool,
    sha256_after: i.manifestSha256,
  };
  return [importEntry, enrichEntry, exportEntry].sort((a, b) => a.utc.localeCompare(b.utc));
}

export interface TimestampToken {
  file: string;
  tsa: string;
  /** SHA-256 of the token file. */
  sha256: string;
  utc: string;
}

/** `timestamp_token` and `timestamp_note` of the pack: the token when there is one, otherwise null with the reason (`why`). */
export function timestampFields(token: TimestampToken | null, why: string | null): { timestamp_token: TimestampToken | null; timestamp_note: string } {
  if (token) return { timestamp_token: token, timestamp_note: "znacznik czasu RFC 3161 na sumie manifestu; dla pełnej mocy dowodowej użyj dostawcy kwalifikowanego (art. 41 eIDAS)" };
  return { timestamp_token: null, timestamp_note: `brak znacznika czasu RFC 3161 (${why ?? "nie podano --tsa"}); dla kluczowych paczek dodaj go u kwalifikowanego dostawcy (art. 41 eIDAS): bun run evidence -- --tsa <url>` };
}

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
  const files = i.imports.flatMap((c) => c.files.map((f) => `${c.id}/${f.name} [${f.role}] sha256 ${f.sha256 ?? "unreadable"}`));
  const importEntry: CustodyEntry = {
    utc: importedAt,
    actor: "starter (case import)",
    action: files.length ? `import of the case files, SHA-256 checksums of the originals before any processing: ${files.join("; ")}` : "no provenance.json: import without checksums of the input files (the dataset does not come from the case import)",
  };
  const fetched = i.enrich.fetchedFirstUtc ? `; network queries ${i.enrich.fetchedFirstUtc} – ${i.enrich.fetchedLastUtc ?? i.enrich.fetchedFirstUtc}` : "";
  const enrichEntry: CustodyEntry = {
    utc: i.enrich.generatedUtc,
    actor: "starter (enrichment)",
    action: `data enrichment in ${i.enrich.mode} mode${fetched}; User-Agent: ${i.enrich.userAgents.join(", ") || "none"}`,
  };
  const exportEntry: CustodyEntry = {
    utc: i.exportUtc,
    actor: "starter (pack export)",
    action: `pack export for campaign ${i.campaignId}`,
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
  if (token) return { timestamp_token: token, timestamp_note: "RFC 3161 timestamp on the manifest checksum; for full evidential weight use a qualified provider (Art. 41 eIDAS)" };
  return { timestamp_token: null, timestamp_note: `no RFC 3161 timestamp (${why ?? "--tsa not given"}); for key packs add one from a qualified provider (Art. 41 eIDAS): bun run evidence -- --tsa <url>` };
}

/**
 * Flexible ingest: CSV/TSV/JSON/JSONL with an explicit or auto-detected column
 * mapping -> normalised Item[]. No assumptions about the organiser's format beyond
 * "one ad per row".
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseCsvSync } from "csv-parse/sync";
import { z } from "zod";
import type { Item } from "./types";

export const ITEM_FIELDS = [
  "id",
  "platform",
  "advertiser",
  "text",
  "imageUrl",
  "imagePath",
  "landingUrl",
  "firstSeen",
  "lastSeen",
  "label",
  "persona",
  "deepfakeScore",
  "videoPath",
  "extraImagePaths",
  "extraVideoPaths",
] as const;
export type ItemField = (typeof ITEM_FIELDS)[number];

/** Field -> source column name (or several columns, joined, for text). */
export const ColumnMappingSchema = z
  .object({
    id: z.string(),
    platform: z.string(),
    advertiser: z.string(),
    text: z.union([z.string(), z.array(z.string())]),
    imageUrl: z.string(),
    imagePath: z.string(),
    landingUrl: z.string(),
    firstSeen: z.string(),
    lastSeen: z.string(),
    label: z.string(),
    persona: z.string(),
    deepfakeScore: z.string(),
    videoPath: z.string(),
    extraImagePaths: z.string(),
    extraVideoPaths: z.string(),
  })
  .partial()
  .strict();
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;

const SYNONYMS: Record<ItemField, string[]> = {
  id: ["id", "ad_id", "adid", "ad_archive_id", "archive_id", "identyfikator", "nr", "item_id", "uid"],
  platform: ["platform", "platforma", "publisher_platform", "publisher_platforms", "source", "zrodlo", "źródło", "network"],
  advertiser: ["advertiser", "page_name", "pagename", "reklamodawca", "nadawca", "account", "author", "page", "profile"],
  text: ["text", "body", "ad_text", "ad_creative_body", "ad_creative_bodies", "tresc", "treść", "content", "message", "caption", "copy", "description", "opis"],
  imageUrl: ["image_url", "imageurl", "image", "img", "img_url", "obraz", "picture", "thumbnail_url", "media_url"],
  imagePath: ["image_path", "imagepath", "image_file", "file", "plik", "screenshot", "zrzut"],
  landingUrl: ["landing_url", "landingurl", "url", "link", "link_url", "landing", "destination", "destination_url", "target_url", "ad_creative_link_url", "website"],
  firstSeen: ["first_seen", "firstseen", "ad_delivery_start_time", "start_date", "start", "date", "data", "created", "created_at", "ad_creation_time", "seen", "timestamp"],
  lastSeen: ["last_seen", "lastseen", "ad_delivery_stop_time", "end_date", "stop", "end", "updated_at"],
  label: ["label", "campaign", "campaign_id", "kampania", "cluster", "ground_truth", "gt", "group"],
  persona: ["persona", "persona_id", "persona_name", "celebrity", "impersonated", "impersonated_person", "osoba", "wizerunek", "drozd_persona", "drozd_identity"],
  deepfakeScore: ["deepfake_score", "deepfake", "drozd_score", "synthetic_score", "score_deepfake", "fake_score", "prawdopodobienstwo_deepfake", "wynik_deepfake"],
  videoPath: ["video_path", "videopath", "video", "video_file", "wideo", "film", "audio_path", "audio"],
  extraImagePaths: ["more_screenshots", "extra_images", "screenshots", "zrzuty"],
  extraVideoPaths: ["more_videos", "extra_videos", "page_videos", "wideo_strony"],
};

function canon(col: string): string {
  return col
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[\s\-.]+/g, "_");
}

/** Guesses a mapping from column names (Polish and English synonyms). */
export function autoMapping(columns: string[]): ColumnMapping {
  const byCanon = new Map(columns.map((c) => [canon(c), c]));
  const used = new Set<string>();
  const mapping: ColumnMapping = {};
  for (const field of ITEM_FIELDS) {
    for (const syn of SYNONYMS[field]) {
      const col = byCanon.get(canon(syn));
      if (col && !used.has(col)) {
        mapping[field] = col;
        used.add(col);
        break;
      }
    }
  }
  return mapping;
}

function detectDelimiter(firstLine: string): string {
  const counts = [",", ";", "\t", "|"].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

export function parseCsv(content: string, delimiter?: string): Array<Record<string, string>> {
  const firstLine = content.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  return parseCsvSync(content, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    trim: true,
    delimiter: delimiter ?? detectDelimiter(firstLine),
  }) as Array<Record<string, string>>;
}

/** The array of rows of a parsed .json dataset: the document itself, or its items/data/ads/records/results array. Throws for any other shape. */
function jsonRows(data: unknown, file: string): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const key of ["items", "data", "ads", "records", "results"]) {
      const v = (data as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v;
    }
  }
  throw new Error(`${file}: expected a JSON array or an object with items/data/ads/records`);
}

/** Loads raw records from .csv/.tsv/.json/.jsonl/.ndjson. */
export function loadRecords(file: string): Array<Record<string, unknown>> {
  const content = readFileSync(file, "utf8");
  const ext = path.extname(file).toLowerCase();
  if (ext === ".json") return jsonRows(JSON.parse(content), file) as Array<Record<string, unknown>>;
  if (ext === ".jsonl" || ext === ".ndjson") {
    return content
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  }
  return parseCsv(content, ext === ".tsv" ? "\t" : undefined);
}

/** A row `loadRecordsLenient` left out: its number (line of a JSONL file, element of a JSON array, from 1), its id when it can still be read, and why. */
export interface BadRow {
  row: number;
  id: string | null;
  reason: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Id of a JSONL line that is not valid JSON, read from its text: the value of the first id column found
 * (`idColumn` first, then the id synonyms of the automatic mapping), e.g. `"id": "w2"` in a truncated line. Null when none.
 */
function idOfBrokenLine(line: string, idColumn?: string): string | null {
  for (const col of [...(idColumn ? [idColumn] : []), ...SYNONYMS.id]) {
    const key = col.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`"${key}"\\s*:\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|(-?\\d+(?:\\.\\d+)?))`, "i").exec(line);
    const id = (m?.[1] ?? m?.[2])?.trim();
    if (id) return id;
  }
  return null;
}

/**
 * Like `loadRecords`, for a batch where one damaged row must not stop the rest: a JSONL line that is not valid
 * JSON or not an object, and a JSON array element that is not an object, are left out and listed in `bad`.
 * A file that cannot be read or parsed as a whole (also a CSV whose quoting breaks: from that point on the rows
 * cannot be told apart) still throws.
 */
export function loadRecordsLenient(file: string, opts: { idColumn?: string } = {}): { records: Array<Record<string, unknown>>; bad: BadRow[] } {
  const ext = path.extname(file).toLowerCase();
  if (ext !== ".json" && ext !== ".jsonl" && ext !== ".ndjson") return { records: loadRecords(file), bad: [] };
  const content = readFileSync(file, "utf8");
  const records: Array<Record<string, unknown>> = [];
  const bad: BadRow[] = [];
  if (ext === ".json") {
    jsonRows(JSON.parse(content), file).forEach((r, i) => {
      if (isRecord(r)) records.push(r);
      else bad.push({ row: i + 1, id: null, reason: "element tablicy nie jest obiektem JSON" });
    });
    return { records, bad };
  }
  content.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const r: unknown = JSON.parse(line);
      if (isRecord(r)) records.push(r);
      else bad.push({ row: i + 1, id: null, reason: "wiersz nie jest obiektem JSON" });
    } catch (e) {
      bad.push({ row: i + 1, id: idOfBrokenLine(line, opts.idColumn), reason: `niepoprawny JSON (${(e as Error).message})` });
    }
  });
  return { records, bad };
}

function cell(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) {
    const parts = v.map(cell).filter((x): x is string => !!x);
    return parts.length ? parts.join("\n") : null;
  }
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v).trim();
  return s === "" || /^(null|none|nan|n\/a)$/i.test(s) ? null : s;
}

/** Normalises many date notations to ISO 8601 (UTC). Returns null when unparseable. */
export function normalizeDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000).toISOString();
  if (/^\d{13}$/.test(s)) return new Date(Number(s)).toISOString();
  const pl = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (pl) {
    const [, d, m, y, hh = "0", mm = "0", ss = "0"] = pl;
    const t = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s.replace(" ", "T");
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Parses a model score ("0,91", "91", "91%") to 0..1; null when unparseable. A model output, not a fact. */
export function normalizeScore(input: string | null | undefined): number | null {
  if (!input) return null;
  const s = input.trim().replace(",", ".").replace(/%$/, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  let v = Number(s);
  if (input.trim().endsWith("%") || (v > 1 && v <= 100)) v /= 100;
  if (v < 0 || v > 1) return null;
  return Math.round(v * 1e4) / 1e4;
}

export interface NormalizeResult {
  items: Item[];
  warnings: string[];
  mapping: ColumnMapping;
}

/** Applies a mapping to raw records. Missing ids get a stable content hash. */
export function normalizeRecords(records: Array<Record<string, unknown>>, mapping?: ColumnMapping): NormalizeResult {
  const columns = [...new Set(records.flatMap((r) => Object.keys(r)))];
  // Explicit mapping wins; auto-detection only fills fields that are still unmapped,
  // using columns the explicit mapping did not claim.
  const explicit = mapping ?? {};
  const claimed = new Set(Object.values(explicit).flatMap((c) => (Array.isArray(c) ? c : [c])));
  const auto = autoMapping(columns.filter((c) => !claimed.has(c)));
  const map: ColumnMapping = { ...auto, ...explicit };
  const warnings: string[] = [];
  for (const [field, col] of Object.entries(map)) {
    const cols = Array.isArray(col) ? col : [col];
    for (const c of cols) if (!columns.includes(c)) warnings.push(`mapping ${field} -> "${c}": column not found`);
  }
  const mappedCols = new Set(Object.values(map).flatMap((c) => (Array.isArray(c) ? c : [c])));
  const seen = new Map<string, number>();
  const items: Item[] = [];
  records.forEach((rec, idx) => {
    const get = (field: ItemField): string | null => {
      const col = map[field];
      if (!col) return null;
      if (Array.isArray(col)) {
        const parts = col.map((c) => cell(rec[c])).filter((x): x is string => !!x);
        return parts.length ? parts.join("\n") : null;
      }
      return cell(rec[col]);
    };
    const text = get("text");
    const landingUrl = get("landingUrl");
    const imageUrl = get("imageUrl");
    let imagePath = get("imagePath");
    let imgUrl = imageUrl;
    if (imgUrl && !/^https?:\/\//i.test(imgUrl)) {
      imagePath = imagePath ?? imgUrl; // a local path given in the URL column
      imgUrl = null;
    }
    let id = get("id");
    if (!id) {
      id = `h${createHash("sha256")
        .update(JSON.stringify([text, landingUrl, imageUrl, imagePath, idx]))
        .digest("hex")
        .slice(0, 12)}`;
    }
    const dup = seen.get(id) ?? 0;
    seen.set(id, dup + 1);
    if (dup) {
      warnings.push(`row ${idx + 1}: duplicate id "${id}" renamed to "${id}__${dup + 1}"`);
      id = `${id}__${dup + 1}`;
    }
    const firstRaw = get("firstSeen");
    const lastRaw = get("lastSeen");
    const firstSeen = normalizeDate(firstRaw);
    const lastSeen = normalizeDate(lastRaw);
    if (firstRaw && !firstSeen) warnings.push(`row ${idx + 1}: unparseable firstSeen "${firstRaw}"`);
    if (lastRaw && !lastSeen) warnings.push(`row ${idx + 1}: unparseable lastSeen "${lastRaw}"`);
    const videoPath = get("videoPath");
    const extraImagePaths = (get("extraImagePaths") ?? "").split(/\n|\s\|\s/).map((x) => x.trim()).filter(Boolean);
    const extraVideoPaths = (get("extraVideoPaths") ?? "").split(/\n|\s\|\s/).map((x) => x.trim()).filter(Boolean);
    if (!text && !landingUrl && !imgUrl && !imagePath && !videoPath) warnings.push(`row ${idx + 1}: no text, URL, image or video`);
    const scoreRaw = get("deepfakeScore");
    const deepfakeScore = normalizeScore(scoreRaw);
    if (scoreRaw && deepfakeScore === null) warnings.push(`row ${idx + 1}: unparseable deepfakeScore "${scoreRaw}"`);
    const extra: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (mappedCols.has(k)) continue;
      const c = cell(v);
      if (c) extra[k] = c.length > 500 ? `${c.slice(0, 500)}…` : c;
    }
    items.push({
      id,
      platform: get("platform"),
      advertiser: get("advertiser"),
      text,
      imageUrl: imgUrl,
      imagePath,
      landingUrl,
      firstSeen,
      lastSeen,
      label: get("label"),
      persona: get("persona"),
      deepfakeScore,
      videoPath,
      ...(extraImagePaths.length ? { extraImagePaths } : {}),
      ...(extraVideoPaths.length ? { extraVideoPaths } : {}),
      extra,
    });
  });
  return { items, warnings, mapping: map };
}

export function loadMapping(file: string | undefined): ColumnMapping | undefined {
  if (!file) return undefined;
  return ColumnMappingSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

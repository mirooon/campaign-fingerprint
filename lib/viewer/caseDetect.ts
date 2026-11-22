/**
 * Cases in an uploaded folder (§7), computed in the browser for the preview. Three ways to split:
 * - "single": everything is one case;
 * - "folders": every sub-folder is a case; loose files of the top folder make one more case;
 * - "files": every loose file is a case of its own; sub-folders stay whole.
 * A page-save package (a folder with manifest.json and dom.html) and a `<name>_files` folder always
 * stay with their page. Like the importer (`walkCase` in caseImport.ts), everything inside a
 * `resources` or `<name>_files` folder is a part of a page, never material of its own.
 */

export type FileKind = "screenshot" | "har" | "page" | "page_part" | "video" | "video_info" | "dataset" | "zip" | "stream" | "system" | "unsupported";

export type SplitMode = "single" | "folders" | "files";

export interface InputFile {
  /** Path relative to the upload (folder upload keeps the folders), "/" separated. */
  path: string;
  size: number;
}

export interface FileKindInfo {
  label: string;
  hint: string;
  analyzable: boolean;
}

export const FILE_KIND_INFO: Record<FileKind, FileKindInfo> = {
  screenshot: { label: "zrzut", hint: "Zrzut ekranu reklamy albo strony: odczytamy z niego tekst i adres z paska przeglądarki.", analyzable: true },
  har: { label: "HAR", hint: "HAR to zapis ruchu sieciowego z przeglądarki: adresy, przekierowania i odpowiedzi serwerów.", analyzable: true },
  page: { label: "strona", hint: "Zapisana strona docelowa: porównamy jej budowę, formularz i skrypty (nie otwieramy jej).", analyzable: true },
  page_part: { label: "część strony", hint: "Pliki towarzyszące zapisanej stronie (obrazy, skrypty, style, wideo ze strony, manifest zapisu): dołączamy je do strony.", analyzable: false },
  video: { label: "wideo", hint: "Nagranie reklamy: odczytamy tekst z klatek i adres z paska.", analyzable: true },
  video_info: { label: "opis wideo", hint: "Opis nagrania (np. z yt-dlp): tytuł, kanał, data publikacji.", analyzable: false },
  dataset: { label: "plik zbioru", hint: "Plik zbioru: każdy wiersz stanie się materiałem.", analyzable: false },
  zip: { label: "ZIP", hint: "Archiwum: rozpakujemy je przed analizą.", analyzable: false },
  stream: { label: "wideo HLS", hint: "Fragmenty strumienia wideo (playlista .m3u8 i segmenty .ts): zachowamy je z materiałem, ale tekstu z nich nie odczytujemy. Do analizy nagrania zapisz je jako MP4.", analyzable: false },
  system: { label: "plik systemowy", hint: "Plik dodany przez system (np. .DS_Store): pomijamy go.", analyzable: false },
  unsupported: { label: "nieobsługiwany", hint: "Tego typu pliku nie analizujemy.", analyzable: false },
};

export const SPLIT_LABEL: Record<SplitMode, string> = {
  single: "jedna sprawa",
  folders: "każdy podfolder to sprawa",
  files: "każdy plik to osobny materiał",
};

const IMAGE = /\.(png|jpe?g|webp|gif|bmp|heic|heif|avif)$/i;
const VIDEO = /\.(mp4|webm|mov|m4v|mkv)$/i;
const PAGE = /\.(html?|mhtml?|xhtml)$/i;
/** HLS stream: playlist and MPEG-TS segments (a page's video player saves these). */
const STREAM = /\.(m3u8|ts|m2ts|mts)$/i;
/** Assets of a web page saved loose: scripts (also the browser's ".pobrane"/".download" names), styles, fonts, icons. */
const WEB_ASSET = /\.(m?js|css|map|svg|ico|woff2?|ttf|otf|eot|pobrane|download|pobierz)$/i;
/** Files the operating system adds to folders. */
const SYSTEM = /^(\.ds_store|thumbs\.db|desktop\.ini|\._.*|\.localized)$/i;

const segs = (p: string) => p.split("/").filter(Boolean);
const base = (p: string) => segs(p).at(-1) ?? p;
const dirOf = (p: string) => segs(p).slice(0, -1).join("/");

/** Kind of one file; `packageDirs` are folders holding a page-save package (manifest.json + dom.html). */
export function fileKind(path: string, packageDirs: Set<string> = new Set()): FileKind {
  const name = base(path);
  const parts = segs(path);
  const lower = name.toLowerCase();
  if (SYSTEM.test(lower)) return "system";
  if (parts.slice(0, -1).some((s) => /_files$/i.test(s) || s.toLowerCase() === "resources")) return "page_part";
  if (lower.endsWith(".info.json")) return "video_info";
  if (lower === "manifest.json" && packageDirs.has(dirOf(path))) return "page_part";
  if (IMAGE.test(name)) return packageDirs.has(dirOf(path)) ? "page_part" : "screenshot";
  if (/\.har$/i.test(name)) return "har";
  if (PAGE.test(name)) return "page";
  if (VIDEO.test(name)) return "video";
  if (/\.zip$/i.test(name)) return "zip";
  if (/\.(csv|tsv|jsonl|json)$/i.test(name)) return "dataset";
  if (STREAM.test(name)) return "stream";
  if (WEB_ASSET.test(name)) return "page_part";
  return "unsupported";
}

/** Folders that are a page-save package: manifest.json and dom.html side by side. */
export function packageDirsOf(files: InputFile[]): Set<string> {
  const byDir = new Map<string, Set<string>>();
  for (const f of files) {
    const d = dirOf(f.path);
    const s = byDir.get(d) ?? new Set<string>();
    s.add(base(f.path).toLowerCase());
    byDir.set(d, s);
  }
  const out = new Set<string>();
  for (const [d, names] of byDir) if (names.has("manifest.json") && names.has("dom.html")) out.add(d);
  return out;
}

/** Drops the one folder every path starts with (the folder the user picked); returns its name. */
export function stripCommonTop(files: InputFile[]): { files: InputFile[]; top: string | null } {
  if (!files.length) return { files, top: null };
  const first = segs(files[0].path)[0];
  const all = files.every((f) => segs(f.path).length > 1 && segs(f.path)[0] === first);
  if (!all || /_files$/i.test(first)) return { files, top: null };
  return { files: files.map((f) => ({ ...f, path: segs(f.path).slice(1).join("/") })), top: first };
}

export interface DetectedCase {
  name: string;
  files: InputFile[];
  counts: Partial<Record<FileKind, number>>;
  notes: string[];
  /** Has at least one file the analysis reads (screenshot, HAR, page, video). */
  analyzable: boolean;
}

function topFolder(path: string): string | null {
  const p = segs(path);
  return p.length > 1 ? p[0] : null;
}

/** "strona_files" -> "strona": the page a `_files` folder belongs to. */
function filesFolderOwner(folder: string): string {
  return folder.replace(/_files$/i, "");
}

function describe(name: string, files: InputFile[]): DetectedCase {
  const packageDirs = packageDirsOf(files);
  const counts: Partial<Record<FileKind, number>> = {};
  const notes: string[] = [];
  for (const f of files) {
    const k = fileKind(f.path, packageDirs);
    if (k !== "system") counts[k] = (counts[k] ?? 0) + 1;
  }
  const pkg = files.some((f) => packageDirs.has(dirOf(f.path)) && base(f.path).toLowerCase() === "dom.html");
  const analyzable = files.some((f) => FILE_KIND_INFO[fileKind(f.path, packageDirs)].analyzable) || pkg;
  if (!analyzable) notes.push("brak plików do analizy");
  if (counts.har && !counts.page && !pkg) notes.push("HAR bez zapisanej strony: treść strony weźmiemy z HAR");
  if (counts.screenshot && !counts.har && !counts.page && !pkg && !counts.video) notes.push("same zrzuty: adres strony odczytamy z paska przeglądarki, jeśli jest widoczny");
  if (counts.dataset) notes.push("plik zbioru: na razie wczytaj go poleceniem bun run analyze-material -- --dataset <plik>");
  if (counts.zip) notes.push("archiwum ZIP zostanie rozpakowane na serwerze");
  if (counts.stream) notes.push("wideo HLS (.m3u8/.ts): zachowamy je, ale nie analizujemy; nagranie zapisz jako MP4");
  const unsupported = files.filter((f) => fileKind(f.path, packageDirs) === "unsupported").map((f) => base(f.path));
  if (unsupported.length) notes.push(`nieobsługiwany plik: ${unsupported.slice(0, 3).join(", ")}${unsupported.length > 3 ? ` i ${unsupported.length - 3} innych` : ""}`);
  return { name, files, counts, notes, analyzable };
}

/** Loose files and folders of the (stripped) upload, with `_files` folders attached to their page. */
function layout(files: InputFile[]) {
  const loose: InputFile[] = [];
  const folders = new Map<string, InputFile[]>();
  for (const f of files) {
    const t = topFolder(f.path);
    if (!t) loose.push(f);
    else folders.set(t, [...(folders.get(t) ?? []), f]);
  }
  const looseNames = new Set(loose.map((f) => base(f.path).replace(/\.[^.]+$/, "").toLowerCase()));
  const attached = new Map<string, InputFile[]>(); // page base name -> its _files folder content
  for (const [t, list] of [...folders]) {
    if (/_files$/i.test(t)) {
      const owner = filesFolderOwner(t).toLowerCase();
      if (looseNames.has(owner)) {
        attached.set(owner, list);
        folders.delete(t);
      } else if (loose.length) {
        // a _files folder without its page in this upload still belongs to the loose files
        attached.set(`__${t}`, list);
        folders.delete(t);
      }
    }
  }
  return { loose, folders, attached };
}

/** Default split and the question shown above the preview. */
export function defaultSplit(input: InputFile[]): { mode: SplitMode; question: string | null } {
  const { files } = stripCommonTop(withoutSystemFiles(input));
  const packageDirs = packageDirsOf(files);
  const { loose, folders } = layout(files);
  const realFolders = [...folders.keys()].filter((t) => !packageDirs.has(t));
  if (!loose.length && folders.size > 0) return { mode: "folders", question: null };
  if (loose.length && realFolders.length >= 2) return { mode: "folders", question: null };
  const kinds = loose.map((f) => fileKind(f.path, packageDirs));
  const media = kinds.filter((k) => k === "screenshot" || k === "video").length;
  if (!folders.size && media >= 3 && media === kinds.length) {
    return { mode: "single", question: "To zrzuty jednej reklamy czy kilku różnych? Jeśli różnych, wybierz „każdy plik to osobny materiał”." };
  }
  return { mode: "single", question: null };
}

function uniqueName(name: string, used: Set<string>): string {
  const clean = name.trim() || "sprawa";
  let n = clean;
  for (let k = 2; used.has(n.toLowerCase()); k++) n = `${clean}-${k}`;
  used.add(n.toLowerCase());
  return n;
}

/** The upload without files the operating system adds (.DS_Store and the like): they are not sent. */
export function withoutSystemFiles(files: InputFile[]): InputFile[] {
  return files.filter((f) => fileKind(f.path) !== "system");
}

/** Cases of an upload for the chosen split. File paths stay as uploaded (unstripped); system files are left out. */
export function detectCases(all: InputFile[], mode: SplitMode, fallbackName = "sprawa"): DetectedCase[] {
  const input = withoutSystemFiles(all);
  if (!input.length) return [];
  const { files, top } = stripCommonTop(input);
  const original = new Map(files.map((f, i) => [f, input[i]]));
  const orig = (list: InputFile[]) => list.map((f) => original.get(f) ?? f);
  const packageDirs = packageDirsOf(files);
  const used = new Set<string>();
  const rootName = top ?? fallbackName;
  if (mode === "single") return [describe(uniqueName(rootName, used), orig(files))];

  const { loose, folders, attached } = layout(files);
  const out: DetectedCase[] = [];
  if (mode === "folders") {
    for (const [t, list] of folders) out.push(describe(uniqueName(t, used), orig(list)));
    if (loose.length) out.push(describe(uniqueName(top ? `${top} (luźne pliki)` : "luźne pliki", used), orig([...loose, ...[...attached.values()].flat()])));
  } else {
    const rest = [...attached.entries()].filter(([k]) => k.startsWith("__")).flatMap(([, v]) => v);
    // a page-save package lying loose in the top folder stays whole
    const rootPkg = packageDirs.has("");
    const pkgFiles = rootPkg ? loose.filter((f) => fileKind(f.path, packageDirs) === "page_part" || base(f.path).toLowerCase() === "dom.html") : [];
    if (pkgFiles.length) out.push(describe(uniqueName("zapis strony", used), orig(pkgFiles)));
    // a video description (x.info.json) goes with its video (x.mp4)
    const stemOf = (f: InputFile) => base(f.path).replace(/\.info\.json$/i, "").replace(/\.[^.]+$/, "");
    const videoStems = new Set(loose.filter((f) => fileKind(f.path, packageDirs) === "video").map(stemOf));
    // loose page assets and stream segments go with the only loose page, or together as "pliki strony"
    const isPart = (f: InputFile) => ["page_part", "stream"].includes(fileKind(f.path, packageDirs));
    const parts = loose.filter((f) => !pkgFiles.includes(f) && isPart(f));
    const loosePages = loose.filter((f) => fileKind(f.path, packageDirs) === "page");
    if (loosePages.length === 1) attached.set(stemOf(loosePages[0]).toLowerCase(), [...(attached.get(stemOf(loosePages[0]).toLowerCase()) ?? []), ...parts]);
    else rest.push(...parts);
    const groups = new Map<string, InputFile[]>();
    for (const f of loose) {
      if (pkgFiles.includes(f) || parts.includes(f)) continue;
      const info = fileKind(f.path, packageDirs) === "video_info" && videoStems.has(stemOf(f));
      const key = info ? `v:${stemOf(f)}` : fileKind(f.path, packageDirs) === "video" ? `v:${stemOf(f)}` : `f:${f.path}`;
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }
    for (const list of groups.values()) {
      const main = list.find((f) => fileKind(f.path, packageDirs) !== "video_info") ?? list[0];
      const stem = stemOf(main);
      const extra = attached.get(stem.toLowerCase()) ?? [];
      out.push(describe(uniqueName(stem, used), orig([...list, ...extra])));
    }
    if (rest.length) out.push(describe(uniqueName("pliki strony", used), orig(rest)));
    for (const [t, list] of folders) out.push(describe(uniqueName(t, used), orig(list)));
  }
  return out;
}

/** Case name safe as a folder name on the server (letters, digits, dot, dash, underscore, space). */
export function safeCaseName(name: string): string {
  const s = name
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "_")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, 80);
  return s || "sprawa";
}

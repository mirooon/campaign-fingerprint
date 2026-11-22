/**
 * Library record -> case folder for `analyze-material --cases`. Writes the file with the record
 * (`adlib.json`, read by `caseImport.ts`) and copies the creatives that are already on disk; remote
 * creative addresses stay in the record and are not downloaded here.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { adRecordItemId } from "./toItem";
import { AD_RECORD_FILE, type AdRecord } from "./types";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

/**
 * Creates `<outDir>/<platform>_<adId>/` with the record and the local image creatives (`reklama_N.<ext>`,
 * which the importer takes as screenshots of the ad). Returns the folder path. The raw library response
 * (`raw`) is left out: it can be large and the analysis does not read it.
 */
export async function adRecordToCaseDir(rec: AdRecord, outDir: string): Promise<string> {
  const dir = path.join(outDir, adRecordItemId(rec));
  mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const c of rec.creatives) {
    if (!c.localPath || !existsSync(c.localPath) || !IMAGE_EXT.test(c.localPath)) continue;
    n += 1;
    copyFileSync(c.localPath, path.join(dir, `reklama_${n}${path.extname(c.localPath).toLowerCase()}`));
  }
  const saved: AdRecord = { ...rec, raw: undefined, creatives: rec.creatives.map((c) => ({ kind: c.kind, url: c.url, text: c.text })) };
  writeFileSync(path.join(dir, AD_RECORD_FILE), JSON.stringify(saved, null, 1));
  return dir;
}

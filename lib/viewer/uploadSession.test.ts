import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maxBytes, maxFiles } from "./upload";
import { addUploadFile, createUploadSession, extractLargeZip, unpackZipOnDisk } from "./uploadSession";

const stream = (text: string) => new Response(text).body;

describe("upload session (file-by-file, streamed to disk)", () => {
  let work: string;
  beforeEach(() => {
    work = mkdtempSync(path.join(os.tmpdir(), "upl-"));
    vi.stubEnv("MATERIAL_WORK_DIR", work);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(work, { recursive: true, force: true });
  });

  it("has no size or file-count limit unless the env sets one", () => {
    vi.stubEnv("MATERIAL_MAX_MB", "");
    vi.stubEnv("MATERIAL_MAX_FILES", "");
    expect(maxBytes()).toBe(Number.POSITIVE_INFINITY);
    expect(maxFiles()).toBe(Number.POSITIVE_INFINITY);
    vi.stubEnv("MATERIAL_MAX_MB", "2");
    expect(maxBytes()).toBe(2 * 1024 * 1024);
  });

  it("streams files into their case folders and counts them", async () => {
    const s = await createUploadSession();
    await addUploadFile(s, "sprawa 1", "strona_files/a.txt", stream("abc"), 3);
    await addUploadFile(s, "sprawa 1", "zrzut.png", stream("12345"), 5);
    await addUploadFile(s, "sprawa 2", "x.har", stream("{}"), 2);
    expect(readFileSync(path.join(s.casesDir, "sprawa 1", "strona_files", "a.txt"), "utf8")).toBe("abc");
    expect(s.files).toBe(3);
    expect(s.bytes).toBe(10);
    expect([...s.counts.entries()]).toEqual([["sprawa 1", 2], ["sprawa 2", 1]]);
  });

  it("rejects unsafe paths and uploads over MATERIAL_MAX_MB", async () => {
    const s = await createUploadSession();
    await expect(addUploadFile(s, "a", "../poza.txt", stream("x"), 1)).rejects.toThrow(/path/);
    vi.stubEnv("MATERIAL_MAX_MB", "1");
    await expect(addUploadFile(s, "a", "duzy.bin", stream("x"), 2 * 1024 * 1024)).rejects.toThrow(/limit/);
  });

  it("unpacks a ZIP on disk in memory (small) and with the streaming extractor (large path)", async () => {
    const s = await createUploadSession();
    const zip = zipSync({ "folder/strona.html": strToU8("<html>"), "../uciekam.txt": strToU8("x") });
    await addUploadFile(s, "z", "paczka.zip", new Response(zip).body, zip.length);
    const caseDir = path.join(s.casesDir, "z");
    await unpackZipOnDisk(s.zips[0], caseDir, Number.POSITIVE_INFINITY);
    expect(readFileSync(path.join(caseDir, "paczka", "folder", "strona.html"), "utf8")).toBe("<html>");
    expect(existsSync(path.join(caseDir, "paczka.zip"))).toBe(false);
    expect(existsSync(path.join(s.casesDir, "uciekam.txt"))).toBe(false);

    const big = path.join(work, "big.zip");
    writeFileSync(big, zip);
    const out = path.join(work, "big");
    const n = await extractLargeZip(big, out, Number.POSITIVE_INFINITY);
    expect(n).toBe(7);
    expect(readFileSync(path.join(out, "folder", "strona.html"), "utf8")).toBe("<html>");
    expect(existsSync(path.join(work, "uciekam.txt"))).toBe(false);
  });

  it("a case made of a ZIP only: its content lands in the case folder; an empty archive leaves an empty folder", async () => {
    const s = await createUploadSession();
    const zip = zipSync({ "sprawa_03/zrzut.png": strToU8("png"), "sprawa_03/wizyta.har": strToU8("{}") });
    await addUploadFile(s, "sprawa_03", "sprawa_03.zip", new Response(zip).body, zip.length);
    expect(s.zips).toEqual([path.join(s.casesDir, "sprawa_03", "sprawa_03.zip")]);
    const caseDir = path.join(s.casesDir, "sprawa_03");
    await unpackZipOnDisk(s.zips[0], caseDir, Number.POSITIVE_INFINITY);
    expect(readdirSync(caseDir)).toEqual(["sprawa_03"]);
    expect(readdirSync(path.join(caseDir, "sprawa_03", "sprawa_03")).sort()).toEqual(["wizyta.har", "zrzut.png"]);

    const empty = zipSync({});
    await addUploadFile(s, "pusta", "pusta.zip", new Response(empty).body, empty.length);
    await unpackZipOnDisk(s.zips[1], path.join(s.casesDir, "pusta"), Number.POSITIVE_INFINITY);
    expect(readdirSync(path.join(s.casesDir, "pusta", "pusta"))).toEqual([]);
  });
});

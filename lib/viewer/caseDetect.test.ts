import { describe, expect, it } from "vitest";
import { defaultSplit, detectCases, fileKind, packageDirsOf, safeCaseName, stripCommonTop, type InputFile } from "./caseDetect";

const f = (...paths: string[]): InputFile[] => paths.map((path) => ({ path, size: 10 }));

describe("fileKind", () => {
  it("recognises the types of §7", () => {
    expect(fileKind("a/zrzut.PNG")).toBe("screenshot");
    expect(fileKind("wizyta.har")).toBe("har");
    expect(fileKind("strona.html")).toBe("page");
    expect(fileKind("strona.mhtml")).toBe("page");
    expect(fileKind("strona_files/app.js")).toBe("page_part");
    expect(fileKind("film.mp4")).toBe("video");
    expect(fileKind("film.info.json")).toBe("video_info");
    expect(fileKind("dane.csv")).toBe("dataset");
    expect(fileKind("dane.json")).toBe("dataset");
    expect(fileKind("notatka.txt")).toBe("unsupported");
  });
  it("files inside resources/ or _files/ are parts of the page, like the importer reads them", () => {
    const pkg = packageDirsOf(f("cap/manifest.json", "cap/dom.html"));
    expect(fileKind("cap/resources/image/logo_1.png", pkg)).toBe("page_part");
    expect(fileKind("cap/resources/document/index_1.html", pkg)).toBe("page_part");
    expect(fileKind("cap/resources/script/app_1.js", pkg)).toBe("page_part");
    expect(fileKind("cap/resources/media/output_000_1.ts", pkg)).toBe("page_part");
    expect(fileKind("strona_files/tv.png")).toBe("page_part");
  });
  it("HLS streams, loose web assets and system files", () => {
    expect(fileKind("output.m3u8")).toBe("stream");
    expect(fileKind("output_000.ts")).toBe("stream");
    expect(fileKind("app.js")).toBe("page_part");
    expect(fileKind("jquery.min.js.pobrane")).toBe("page_part");
    expect(fileKind("style.css")).toBe("page_part");
    expect(fileKind("a/.DS_Store")).toBe("system");
    expect(fileKind("._zrzut.png")).toBe("system");
  });
  it("manifest.json of a page-save package is part of the page", () => {
    const files = f("cap/manifest.json", "cap/dom.html", "cap/shot.png");
    const pkg = packageDirsOf(files);
    expect(fileKind("cap/manifest.json", pkg)).toBe("page_part");
    expect(fileKind("cap/shot.png", pkg)).toBe("page_part");
    expect(fileKind("inne/manifest.json", pkg)).toBe("dataset");
  });
});

describe("stripCommonTop", () => {
  it("drops the picked folder", () => {
    const r = stripCommonTop(f("partia/s1/a.png", "partia/s2/b.png"));
    expect(r.top).toBe("partia");
    expect(r.files.map((x) => x.path)).toEqual(["s1/a.png", "s2/b.png"]);
  });
});

describe("defaultSplit", () => {
  it("only sub-folders -> each sub-folder is a case", () => {
    expect(defaultSplit(f("partia/s1/a.png", "partia/s2/b.har", "partia/s3/c.html")).mode).toBe("folders");
  });
  it("loose files of different types -> one case", () => {
    expect(defaultSplit(f("sprawa/a.png", "sprawa/b.har", "sprawa/strona.html", "sprawa/strona_files/x.js"))).toEqual({ mode: "single", question: null });
  });
  it("3+ loose images and nothing else -> one case with a question", () => {
    const d = defaultSplit(f("a.png", "b.jpg", "c.png"));
    expect(d.mode).toBe("single");
    expect(d.question).toMatch(/one ad or of several different ones/);
  });
  it("one ZIP alone or a ZIP next to other material -> one case", () => {
    expect(defaultSplit(f("sprawa_03.zip"))).toEqual({ mode: "single", question: null });
    expect(defaultSplit(f("sprawa-7/zrzut.png", "sprawa-7/strona.zip"))).toEqual({ mode: "single", question: null });
  });
  it("2+ loose ZIPs and nothing else loose -> every ZIP is a case (asked), also next to case folders", () => {
    const d = defaultSplit(f("partia/a.zip", "partia/b.zip"));
    expect(d.mode).toBe("files");
    expect(d.question).toMatch(/Is each ZIP a separate case/);
    expect(defaultSplit(f("partia/s1/x.png", "partia/s2/y.har", "partia/a.zip", "partia/b.zip"))).toEqual({ mode: "files", question: null });
  });
});

describe("detectCases", () => {
  it("folders: three cases plus loose files as one more", () => {
    const cases = detectCases(f("partia/s1/a.png", "partia/s2/b.har", "partia/s3/c.html", "partia/luzny.png"), "folders");
    expect(cases.map((c) => c.name)).toEqual(["s1", "s2", "s3", "partia (loose files)"]);
    expect(cases[1].notes).toContain("HAR without a saved page: we take the page content from the HAR");
    // paths stay as uploaded
    expect(cases[0].files[0].path).toBe("partia/s1/a.png");
  });
  it("files: every loose file is a material, _files folder stays with its page, folders stay whole", () => {
    const cases = detectCases(f("z1.png", "z2.png", "z3.png", "strona.html", "strona_files/a.js", "pakiet/manifest.json", "pakiet/dom.html"), "files");
    expect(cases.map((c) => c.name)).toEqual(["z1", "z2", "z3", "strona", "pakiet"]);
    expect(cases.find((c) => c.name === "strona")?.files.length).toBe(2);
    expect(cases.find((c) => c.name === "pakiet")?.analyzable).toBe(true);
  });
  it("files: three loose screenshots give three materials", () => {
    expect(detectCases(f("zrzuty/a.png", "zrzuty/b.png", "zrzuty/c.png"), "files")).toHaveLength(3);
  });
  it("files: a video keeps its description", () => {
    const cases = detectCases(f("film.mp4", "film.info.json", "inny.png"), "files");
    expect(cases.map((c) => [c.name, c.files.length])).toEqual([["film", 2], ["inny", 1]]);
  });
  it("single: one case named after the folder; notes for unsupported and empty", () => {
    const [c] = detectCases(f("sprawa-7/notatka.txt"), "single");
    expect(c.name).toBe("sprawa-7");
    expect(c.analyzable).toBe(false);
    expect(c.notes).toContain("no files to analyze");
    expect(c.notes.some((n) => n.startsWith("unsupported file"))).toBe(true);
  });
  it("a capture bundle with an HLS video and .DS_Store has nothing unsupported", () => {
    const [c] = detectCases(
      f("14/.DS_Store", "14/nagranie.MP4", "14/IMG_1.PNG", "14/cap/cap/.DS_Store", "14/cap/cap/manifest.json", "14/cap/cap/dom.html", "14/cap/cap/page.har", "14/cap/cap/page.mhtml", "14/cap/cap/screenshot.png", "14/cap/cap/resources/image/a_1.png", "14/cap/cap/resources/media/output_000_1.ts", "14/cap/cap/resources/media/output_1.m3u8", "14/cap/cap/resources/script/app_1.js"),
      "single",
    );
    expect(c.counts.unsupported).toBeUndefined();
    expect(c.counts.screenshot).toBe(1);
    expect(c.files.some((x) => x.path.endsWith(".DS_Store"))).toBe(false);
    expect(c.notes.some((n) => n.startsWith("unsupported file"))).toBe(false);
  });
  it("files: loose page assets go with the only loose page; an HLS stream gets a note", () => {
    const cases = detectCases(f("strona.html", "app.js", "z.png"), "files");
    expect(cases.map((c) => [c.name, c.files.length])).toEqual([["strona", 2], ["z", 1]]);
    const [s] = detectCases(f("v/output.m3u8", "v/output_000.ts"), "single");
    expect(s.notes.some((n) => n.startsWith("video from the page (HLS)"))).toBe(true);
    expect(s.analyzable).toBe(true);
  });
  it("a case made of a ZIP only is analyzable, named after the archive, with a note that the server unpacks it", () => {
    const [c] = detectCases(f("sprawa_03.zip"), "single");
    expect(c.name).toBe("sprawa_03");
    expect(c.analyzable).toBe(true);
    expect(c.counts).toEqual({ zip: 1 });
    expect(c.notes).toContain("ZIP: unpacked on the server during the analysis, all its contents belong to this case");
    expect(c.notes).not.toContain("no files to analyze");
  });
  it("a ZIP inside a case folder makes that case analyzable; loose ZIPs split into cases of their own", () => {
    const folders = detectCases(f("partia/s1/material.zip", "partia/s2/notatka.txt"), "folders");
    expect(folders.map((c) => [c.name, c.analyzable])).toEqual([["s1", true], ["s2", false]]);
    const files = detectCases(f("partia/a.zip", "partia/b.zip"), "files");
    expect(files.map((c) => [c.name, c.files.map((x) => x.path), c.analyzable])).toEqual([
      ["a", ["partia/a.zip"], true],
      ["b", ["partia/b.zip"], true],
    ]);
  });
  it("folders: a folder of case folders next to stray files still splits into its sub-folders", () => {
    const cases = detectCases(
      f("BACKUP/p1/a.png", "BACKUP/p1/strona.html", "BACKUP/p1/strona_files/x.js", "BACKUP/p2/b.har", "BACKUP/p3/archive_x/screenshots/c.png", "Application Support/d.png", "Application Support/e.png"),
      "folders",
    );
    expect(cases.map((c) => c.name)).toEqual(["p1", "p2", "p3", "Application Support"]);
    expect(cases[0].files.map((x) => x.path)).toEqual(["BACKUP/p1/a.png", "BACKUP/p1/strona.html", "BACKUP/p1/strona_files/x.js"]);
  });
  it("folders: a case folder made of one page package and its _files folder stays whole", () => {
    expect(detectCases(f("s1/cap/manifest.json", "s1/cap/dom.html", "s1/strona_files/x.js", "s2/a.png"), "folders").map((c) => c.name)).toEqual(["s1", "s2"]);
  });
  it("unique names", () => {
    const cases = detectCases(f("a/x.png", "b/x.png", "x.png", "x.jpg"), "files");
    expect(new Set(cases.map((c) => c.name.toLowerCase())).size).toBe(cases.length);
  });
});

describe("safeCaseName", () => {
  it("removes path characters", () => {
    expect(safeCaseName("../../etc")).toBe("_.._etc");
    expect(safeCaseName("Sprawa 12 (zrzuty)")).toBe("Sprawa 12 _zrzuty_");
    expect(safeCaseName("")).toBe("case");
  });
});

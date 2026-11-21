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
    expect(d.question).toMatch(/jednej reklamy czy kilku różnych/);
  });
});

describe("detectCases", () => {
  it("folders: three cases plus loose files as one more", () => {
    const cases = detectCases(f("partia/s1/a.png", "partia/s2/b.har", "partia/s3/c.html", "partia/luzny.png"), "folders");
    expect(cases.map((c) => c.name)).toEqual(["s1", "s2", "s3", "partia (luźne pliki)"]);
    expect(cases[1].notes).toContain("HAR bez zapisanej strony: treść strony weźmiemy z HAR");
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
    expect(c.notes).toContain("brak plików do analizy");
    expect(c.notes.some((n) => n.startsWith("nieobsługiwany plik"))).toBe(true);
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
    expect(safeCaseName("")).toBe("sprawa");
  });
});

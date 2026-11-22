import { describe, expect, it } from "vitest";
import { resolveCasePath } from "./casePath";

const has = (...files: string[]) => (f: string) => files.includes(f);

describe("resolveCasePath", () => {
  it("keeps an existing absolute path", () => {
    expect(resolveCasePath("/a/b.png", { baseDir: "/base", exists: has("/a/b.png") })).toEqual({ file: "/a/b.png", reason: null });
  });

  it("resolves a relative path against the run folder first (sample data)", () => {
    expect(resolveCasePath("images/x.png", { baseDir: "/base", casesDir: "/cases", exists: has("/base/images/x.png", "/cases/images/x.png") })).toEqual({ file: "/base/images/x.png", reason: null });
  });

  it("resolves a relative path from a data pack against CASES_DIR", () => {
    expect(resolveCasePath("sprawy/s1/a.png", { baseDir: "/base", casesDir: "/moje", exists: has("/moje/sprawy/s1/a.png") })).toEqual({ file: "/moje/sprawy/s1/a.png", reason: null });
  });

  it("accepts CASES_DIR that points at the cases folder itself (path without the leading segment)", () => {
    expect(resolveCasePath("sprawy/s1/a.png", { baseDir: "/base", casesDir: "/moje/sprawy", exists: has("/moje/sprawy/s1/a.png") })).toEqual({ file: "/moje/sprawy/s1/a.png", reason: null });
  });

  it("says CASES_DIR is needed instead of throwing when it is not set", () => {
    const r = resolveCasePath("sprawy/s1/a.png", { baseDir: "/base", exists: has() });
    expect(r.file).toBeNull();
    expect(r.reason).toContain("CASES_DIR");
  });

  it("says the file is missing when CASES_DIR is set but the file is not there", () => {
    const r = resolveCasePath("sprawy/s1/a.png", { baseDir: "/base", casesDir: "/moje", exists: has() });
    expect(r.file).toBeNull();
    expect(r.reason).toContain("/moje");
  });

  it("reports a missing absolute path", () => {
    const r = resolveCasePath("/gone/a.png", { baseDir: "/base", exists: has() });
    expect(r.file).toBeNull();
    expect(r.reason).toContain("/gone/a.png");
  });
});

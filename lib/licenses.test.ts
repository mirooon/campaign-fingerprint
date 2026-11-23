import { describe, expect, it } from "vitest";
import { licenseOf, renderLicenseTable, replaceBetweenMarkers, resolveProductionPackages, type PackageJson } from "./licenses";

const pkgs: Record<string, PackageJson> = {
  app: { name: "app", version: "1.0.0", license: "MIT" },
  "lib-a": { name: "lib-a", version: "2.1.0", license: "MIT", dependencies: { "lib-b": "^1" }, optionalDependencies: { "bin-darwin": "1" } },
  "lib-b": { name: "lib-b", version: "1.4.0", licenses: [{ type: "BSD-3-Clause" }, { type: "MIT" }] },
  "bin-darwin": { name: "bin-darwin", version: "1.0.0", license: { type: "LGPL-3.0-or-later" } },
  "dev-only": { name: "dev-only", version: "9.0.0", license: "GPL-3.0" },
  "no-license": { name: "no-license", version: "0.1.0" },
};
const read = (name: string): PackageJson | null => pkgs[name] ?? null;

describe("licenseOf", () => {
  it("reads a string, an object, the legacy array and a missing field", () => {
    expect(licenseOf(pkgs["lib-a"])).toBe("MIT");
    expect(licenseOf(pkgs["bin-darwin"])).toBe("LGPL-3.0-or-later");
    expect(licenseOf(pkgs["lib-b"])).toBe("BSD-3-Clause OR MIT");
    expect(licenseOf(pkgs["no-license"])).toBe("NO license FIELD");
  });
});

describe("resolveProductionPackages", () => {
  it("follows dependencies and installed optional dependencies, skips what is not a production dependency", () => {
    const rows = resolveProductionPackages(["app", "lib-a"], read);
    expect(rows.map((r) => r.name)).toEqual(["app", "bin-darwin", "lib-a", "lib-b"]);
    expect(rows.find((r) => r.name === "dev-only")).toBeUndefined();
  });

  it("lists a dependency that is not installed instead of dropping it", () => {
    const rows = resolveProductionPackages(["lib-a", "ghost"], read);
    expect(rows.find((r) => r.name === "ghost")).toEqual({ name: "ghost", version: "?", license: "NOT INSTALLED", direct: true });
  });

  it("marks direct dependencies", () => {
    const rows = resolveProductionPackages(["lib-a"], read);
    expect(rows.find((r) => r.name === "lib-a")?.direct).toBe(true);
    expect(rows.find((r) => r.name === "lib-b")?.direct).toBe(false);
  });
});

describe("renderLicenseTable", () => {
  it("renders one Markdown row per package", () => {
    const md = renderLicenseTable([{ name: "lib-a", version: "2.1.0", license: "MIT", direct: true }]);
    expect(md).toContain("| lib-a | 2.1.0 | MIT | direct | in-process library | npm |");
  });
});

describe("replaceBetweenMarkers", () => {
  it("replaces only the text between the markers", () => {
    const out = replaceBetweenMarkers("a\n<!-- x:start -->\nold\n<!-- x:end -->\nb", "x", "new");
    expect(out).toBe("a\n<!-- x:start -->\nnew\n<!-- x:end -->\nb");
  });
  it("fails when a marker is missing", () => {
    expect(() => replaceBetweenMarkers("a", "x", "new")).toThrow(/x:start/);
  });
});

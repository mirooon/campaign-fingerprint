/**
 * Licenses of the production npm packages, for LICENCJE.md. Pure logic: the caller supplies a reader
 * of `package.json` files (the script reads `node_modules`), so the rules are testable without the disk.
 */

export interface PackageJson {
  name: string;
  version: string;
  license?: string | { type?: string };
  licenses?: Array<{ type?: string }>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface LicenseRow {
  name: string;
  version: string;
  license: string;
  /** true: listed in `dependencies` of the application, false: pulled in by another package. */
  direct: boolean;
}

/** Text shown in place of a license when `package.json` has none: the table must never hide the gap. */
const NO_LICENSE = "NO license FIELD";
/** Text shown for a dependency that `node_modules` does not contain (e.g. a platform binary of another OS). */
const NOT_INSTALLED = "NOT INSTALLED";

/**
 * Reads the license of a package from its `package.json`: the `license` field (string or `{type}`) or
 * the legacy `licenses` array, whose entries are alternatives (joined with OR).
 * Returns a visible placeholder when no field exists, never an empty string.
 */
export function licenseOf(pkg: PackageJson): string {
  const l = pkg.license;
  if (typeof l === "string" && l.trim()) return l.trim();
  if (l && typeof l === "object" && l.type) return l.type;
  const legacy = (pkg.licenses ?? []).map((x) => x.type).filter((x): x is string => !!x);
  return legacy.length ? legacy.join(" OR ") : NO_LICENSE;
}

/**
 * Walks the production dependency tree from the direct dependencies of the application.
 * `read(name)` returns the installed `package.json` or null. Optional dependencies count only when
 * installed (a platform binary exists on one OS only); a missing regular dependency is listed as such.
 * Returns the rows sorted by name; development dependencies never appear because only `dependencies`
 * and `optionalDependencies` are followed.
 */
export function resolveProductionPackages(direct: string[], read: (name: string) => PackageJson | null): LicenseRow[] {
  const rows = new Map<string, LicenseRow>();
  const queue: Array<{ name: string; optional: boolean }> = direct.map((name) => ({ name, optional: false }));
  const directSet = new Set(direct);
  while (queue.length) {
    const { name, optional } = queue.shift()!;
    if (rows.has(name)) continue;
    const pkg = read(name);
    if (!pkg) {
      if (!optional) rows.set(name, { name, version: "?", license: NOT_INSTALLED, direct: directSet.has(name) });
      continue;
    }
    rows.set(name, { name, version: pkg.version, license: licenseOf(pkg), direct: directSet.has(name) });
    for (const dep of Object.keys(pkg.dependencies ?? {})) queue.push({ name: dep, optional: false });
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) queue.push({ name: dep, optional: true });
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Markdown table of the packages (columns as in the other tables of LICENCJE.md). */
export function renderLicenseTable(rows: LicenseRow[]): string {
  const head = ["| Component | Version | License | Role | How it is used | Source |", "|---|---|---|---|---|---|"];
  const body = rows.map((r) => `| ${r.name} | ${r.version} | ${r.license} | ${r.direct ? "direct" : "transitive"} | in-process library | npm |`);
  return [...head, ...body].join("\n");
}

/**
 * Replaces the text between `<!-- id:start -->` and `<!-- id:end -->` so that a generated table can
 * be refreshed without touching the hand-written text around it. Throws when a marker is missing.
 */
export function replaceBetweenMarkers(text: string, id: string, replacement: string): string {
  const start = `<!-- ${id}:start -->`;
  const end = `<!-- ${id}:end -->`;
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a < 0 || b < a) throw new Error(`markers missing: ${start} / ${end}`);
  return `${text.slice(0, a + start.length)}\n${replacement}\n${text.slice(b)}`;
}

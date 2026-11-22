import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const hasPython = spawnSync("python3", ["--version"]).status === 0;

describe("Python helpers of the ad libraries (scripts/py)", () => {
  // Python 3.10+ (annotations like `str | None`) and the standard library only: the tests use recorded responses
  it.skipIf(!hasPython)("pass their unittest suites (recorded client responses, no network)", () => {
    const r = spawnSync("python3", ["-I", "-m", "unittest", "discover", "-s", path.join(process.cwd(), "scripts", "py"), "-p", "test_*.py"], { encoding: "utf8" });
    expect(r.stderr + r.stdout).toMatch(/OK/);
    expect(r.status).toBe(0);
  });
});

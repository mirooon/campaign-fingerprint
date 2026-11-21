import { describe, expect, it } from "vitest";
import { archiveStepOptions } from "./archiveContext";

describe("archiveStepOptions", () => {
  it("is off without the flag and without ARCHIVE_SOURCES", () => {
    expect(archiveStepOptions({ enabled: false, env: {} })).toBeNull();
  });

  it("asks both sources when the flag is on and no list is given", () => {
    const o = archiveStepOptions({ enabled: true, env: {} });
    expect(o?.sources.map((s) => s.name)).toEqual(["urlscan", "wayback"]);
    expect(o?.skipReason).toBeUndefined();
  });

  it("is switched on by ARCHIVE_SOURCES alone and takes only the named sources", () => {
    const o = archiveStepOptions({ enabled: false, env: { ARCHIVE_SOURCES: "wayback" } });
    expect(o?.sources.map((s) => s.name)).toEqual(["wayback"]);
  });

  it("skips the step with the reason when the run is offline, whatever the flag", () => {
    const o = archiveStepOptions({ enabled: true, env: { ANALYZE_OFFLINE: "1" } });
    expect(o?.sources).toEqual([]);
    expect(o?.skipReason).toMatch(/offline/);
  });

  it("rejects an unknown source name instead of ignoring it", () => {
    expect(() => archiveStepOptions({ enabled: true, env: { ARCHIVE_SOURCES: "urlscan,altavista" } })).toThrow(/altavista/);
  });
});

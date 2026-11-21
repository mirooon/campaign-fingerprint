import { describe, expect, it } from "vitest";
import { clickIdsFromUrls, decodeFbclid, decodeXid } from "./clickIds";

describe("decodeXid", () => {
  it("reads time, machine, process and counter of a tracker click ID", () => {
    expect(decodeXid("d6qjcrl1mb1h14gblns0")).toEqual({ time: "2026-03-14T10:20:30Z", machine: "a1b2c3", pid: 4242, counter: 765432 });
    expect(decodeXid("d6q8k5t1mb1h14galpgg")).toMatchObject({ machine: "a1b2c3", pid: 4242, counter: 700001 });
  });

  it("rejects values outside the format or with an implausible time", () => {
    expect(decodeXid("d6qjcrl1mb1h14gblns")).toBeNull();
    expect(decodeXid("d6qjcrl1mb1h14gblnsz")).toBeNull();
    expect(decodeXid("00000000000000000000")).toBeNull();
  });
});

describe("decodeFbclid", () => {
  it("reads the clicked ad ID and the app ID from the newer format", () => {
    const f =
      "PAYnJpZAECdGVzdC1jbGljay1yZWNvcmQAYWRpZAGrE2D2xQHHc3J0Y2FwcF9pZA8xMjM0NTAwMDAwNjc4OTAAAQ";
    expect(decodeFbclid(f)).toEqual({ adId: "120211122233344455", appId: "123450000067890" });
  });

  it("returns null for the older opaque format", () => {
    expect(decodeFbclid("IwAR3xYz0123456789abcdefghijk")).toBeNull();
  });
});

describe("clickIdsFromUrls", () => {
  it("finds xids only in click-like parameters and decodes fbclid", () => {
    const r = clickIdsFromUrls([
      "https://lp.test/L1/?clickid=d6qjcrl1mb1h14gblns0&key=d6qjcrl1mb1h14gblns0&lang=pl",
      "https://lp.test/?offer=d6q8k5t1mb1h14galpgg",
      "not a url",
    ]);
    expect(r.xids.map((x) => [x.param, x.machine])).toEqual([["clickid", "a1b2c3"]]);
    expect(r.fbclids).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { hostingAccounts } from "./hostingAccounts";

describe("hostingAccounts", () => {
  it("names the Bunny Stream library of a video host, once per library", () => {
    const html = `<video file="https://vz-0a1b2c3d-123.b-cdn.net/x/play.m3u8"></video><img src="//vz-0a1b2c3d-456.b-cdn.net/t.jpg">`;
    expect(hostingAccounts(html)).toEqual(["bunny_stream:0a1b2c3d"]);
  });

  it("ignores the plain CDN domain and other hosts", () => {
    expect(hostingAccounts(`<img src="https://site.b-cdn.net/a.jpg"><a href="https://vz-nothex-123.b-cdn.net/">`)).toEqual([]);
  });
});

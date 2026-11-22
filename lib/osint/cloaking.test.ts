/**
 * Verdict of the opt-in cloaking check (B-117): an anti-bot challenge page is a blocked fetch, not cloaking.
 * Synthetic responses only.
 */
import { describe, expect, it } from "vitest";
import { cloakingVerdict, isBotChallenge } from "./cloaking";

const variant = (over: Partial<Parameters<typeof cloakingVerdict>[0]> = {}) => ({ userAgent: "ua", finalUrl: "https://lp.example/", status: 200, domSimhash: "00000000000000ff", bodySha256: null, error: null, ...over });

describe("anti-bot challenge in the cloaking check", () => {
  it("recognises a 403 challenge page of a CDN by its markers", () => {
    expect(isBotChallenge(403, '<html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>')).toBe(true);
    expect(isBotChallenge(200, "<html><body>Oferta</body></html>")).toBe(false);
  });

  it("reports a blocked fetch, not suspected cloaking, when one variant got the challenge", () => {
    const v = cloakingVerdict(variant({ status: 403, botChallenge: true, domSimhash: "ffffffff00000000" }), variant(), 10);
    expect(v.suspected).toBe(false);
    expect(v.state).toBe("bot_challenge");
  });

  it("still suspects cloaking when both variants were served and differ", () => {
    const v = cloakingVerdict(variant({ finalUrl: "https://white.example/" }), variant(), 10);
    expect(v.suspected).toBe(true);
    expect(v.state).toBe("checked");
  });
});

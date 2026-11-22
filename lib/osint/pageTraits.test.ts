import { describe, expect, it } from "vitest";
import { asSeenOn, backLibs, despaceText, hasSpacedText, svgScriptInfo } from "./pageTraits";

describe("backLibs", () => {
  it("names the back-trap library", () => {
    expect(backLibs("<script>window.vitBack({url:'x'})</script>")).toEqual(["vitBack"]);
    expect(backLibs('<script src="/js/back-nav.js"></script>')).toEqual(["back-nav.js"]);
  });
  it("gives nothing for a page without one", () => {
    expect(backLibs("<p>hello backwards</p>")).toEqual([]);
  });
});

describe("spaced text", () => {
  it("glues spaced letters back into a word", () => {
    expect(hasSpacedText("Kliknij: Z a r e j e s t r u j teraz")).toBe(true);
    expect(despaceText("Kliknij: Z a r e j e s t r u j teraz")).toBe("Kliknij: Zarejestruj teraz");
  });
  it("leaves ordinary text with one-letter words alone", () => {
    const t = "Idę w a do domu i z nim";
    expect(hasSpacedText(t)).toBe(false);
    expect(despaceText(t)).toBe(t);
  });
});

describe("asSeenOn", () => {
  it("lists the outlets of a labelled strip", () => {
    expect(asSeenOn("Lekarze w szoku! Pokazano w: Fox News NBC CNN")).toEqual(["Fox News", "NBC", "CNN"]);
  });
  it("ignores a single outlet or a strip without a label", () => {
    expect(asSeenOn("Pokazano w: CNN")).toEqual([]);
    expect(asSeenOn("Fox News NBC CNN")).toEqual([]);
  });
});

describe("svgScriptInfo", () => {
  it("finds the address a script in an SVG loads", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script type="text/javascript" href="https://cdn.example.test/x.js"/><script><![CDATA[ location.href = "https://back.example.test/?showcase_id=1"; ]]></script></svg>`;
    expect(svgScriptInfo(svg)).toEqual({ urls: ["https://cdn.example.test/x.js", "https://back.example.test/?showcase_id=1"] });
  });
  it("gives null for an SVG without a script", () => {
    expect(svgScriptInfo('<svg><path d="M0 0"/></svg>')).toBeNull();
  });
});

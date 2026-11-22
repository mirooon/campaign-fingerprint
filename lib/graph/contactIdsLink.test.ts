import { describe, expect, it } from "vitest";
import { findContactIds } from "../osint/contactIds";
import { extractFromHtml, extractFromText } from "../osint/extract";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { makeDataset, type TestItemSpec } from "./testkit";

// Contact identifiers of I28 on synthetic pages: fictional ids, reserved domains only.

function run(specs: TestItemSpec[]) {
  return clusterCampaigns(buildEvidenceGraph(makeDataset(specs), { textMethod: "none" }));
}
const same = (res: ReturnType<typeof run>, a: string, b: string) => res.campaigns.assignments[a] === res.campaigns.assignments[b];
/** A spec whose contact identifiers come from extractFromHtml, as enrich would store them. */
function pageSpec(id: string, url: string, html: string): TestItemSpec {
  const ex = extractFromHtml(html, url);
  return { id, url, contactIds: { sharedDocs: ex.sharedDocs, onion: ex.onion, onionV2: ex.onionV2, messengers: ex.messengers } };
}
const FORM = "1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789";
const UUID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("shared documents, chats, onion and messengers as traces", () => {
  it("the same Google form on two pages is a shared trace that joins them", () => {
    const html = `<a href="https://docs.google.com/forms/d/${FORM}/viewform">Zapisz się</a>`;
    const res = run([pageSpec("a", "https://alpha.example/", html), pageSpec("b", "https://beta.test/", html)]);
    expect(res.graph.nodes.find((n) => n.type === "shared_doc")?.key).toBe(`google_form:${FORM}`);
    expect(same(res, "a", "b")).toBe(true);
  });

  it("the same shared chat with a language model is a shared trace, a different one is not", () => {
    const chat = (id: string) => `<a href="https://chatgpt.com/share/${id}">plan</a>`;
    const res = run([
      pageSpec("a", "https://alpha.example/", chat(UUID)),
      pageSpec("b", "https://beta.test/", chat(UUID)),
      pageSpec("c", "https://gamma.test/", chat(UUID.replace("0a1b", "ffff"))),
    ]);
    expect(res.graph.nodes.find((n) => n.key === `llm_chat:${UUID}`)?.type).toBe("shared_doc");
    expect(same(res, "a", "b")).toBe(true);
    expect(same(res, "a", "c")).toBe(false);
  });

  it("an onion address in the footer is a trace of the kind onion; a v2 address is only an attribute", () => {
    const v3 = "abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvwx";
    const html = `<footer>Tor: ${v3}.onion, stary: abcdefghij234567.onion</footer>`;
    const res = run([pageSpec("a", "https://alpha.example/", html), pageSpec("b", "https://beta.test/", html)]);
    expect(res.graph.nodes.find((n) => n.type === "onion")?.key).toBe(v3);
    expect(res.graph.nodes.some((n) => n.key.includes("abcdefghij234567"))).toBe(false);
    expect(same(res, "a", "b")).toBe(true);
  });

  it("a Discord invitation in the text of an OCR is read like a page link", () => {
    expect(extractFromText("Dołącz do nas: discord.gg/abcd").messengers).toEqual(["discord:abcd"]);
  });

  it("a link to the official help page of a platform gives no trace", () => {
    const html = `<a href="https://support.discord.com/hc/pl">Pomoc</a><a href="https://help.notion.site/">Notion</a><a href="https://discord.gg/discord-developers">API</a>`;
    expect(findContactIds(html)).toEqual({ sharedDocs: [], onion: [], onionV2: [], messengers: [] });
    const res = run([pageSpec("a", "https://alpha.example/", html), pageSpec("b", "https://beta.test/", html)]);
    expect(res.graph.nodes.some((n) => n.type === "shared_doc" || n.type === "messenger_invite")).toBe(false);
  });
});

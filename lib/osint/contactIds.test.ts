import { describe, expect, it } from "vitest";
import { discordSnowflakes, findContactIds } from "./contactIds";

const ID20 = "1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789";
const UUID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("findContactIds: shared documents and forms", () => {
  it("keys Google documents, forms and Drive files by service and id", () => {
    const text = [
      `https://docs.google.com/forms/d/${ID20}/viewform`,
      `https://docs.google.com/spreadsheets/d/${ID20}ab/edit#gid=0`,
      `https://docs.google.com/document/d/e/2PACX-${ID20}/pub`,
      `https://forms.gle/AbCd1234Xy`,
      `https://drive.google.com/file/d/${ID20}cd/view`,
    ].join("\n");
    expect(findContactIds(text).sharedDocs).toEqual([
      `google_form:${ID20}`,
      `google_sheet:${ID20}ab`,
      `google_doc:2PACX-${ID20}`,
      "forms_gle:AbCd1234Xy",
      `google_drive:${ID20}cd`,
    ]);
  });

  it("reads Notion, Microsoft Forms, Typeform and Jotform", () => {
    const hex = "0123456789abcdef0123456789abcdef";
    const text = [
      `https://acme-team.notion.site/Oferta-${hex}`,
      `https://www.notion.so/Strona-testowa-${hex}`,
      `https://team.notion.site/`,
      `https://forms.office.com/r/AbCdEf1234`,
      `https://forms.office.com/Pages/ResponsePage.aspx?id=${ID20}`,
      `https://przyklad.typeform.com/to/AbC123xy`,
      `https://form.jotform.com/2301234567890123456`,
    ].join("\n");
    expect(findContactIds(text).sharedDocs).toEqual([
      `notion:${hex}`,
      "notion_site:team.notion.site",
      "ms_forms:AbCdEf1234",
      `ms_forms:${ID20}`,
      "typeform:AbC123xy",
      "jotform:2301234567890123456",
    ]);
  });

  it("reads a shared chat with a language model under one service whatever the vendor", () => {
    const text = [
      `https://chatgpt.com/share/${UUID}`,
      `https://chat.openai.com/share/${UUID.toUpperCase()}`,
      `https://claude.ai/share/${UUID.replace("0a1b", "ffff")}`,
      `https://gemini.google.com/share/abc123def456`,
      `https://www.perplexity.ai/search/jak-to-zrobic-AbC123`,
    ].join(" ");
    expect(findContactIds(text).sharedDocs).toEqual([
      `llm_chat:${UUID}`,
      `llm_chat:${UUID.replace("0a1b", "ffff")}`,
      "llm_chat:abc123def456",
      "llm_chat:jak-to-zrobic-AbC123",
    ].map((k) => k.toLowerCase()));
  });

  it("leaves out the sample id of the vendor documentation, vendor pages and a link without an id", () => {
    const text = [
      "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit",
      "https://help.notion.site/",
      "https://docs.google.com/forms/",
      "https://chatgpt.com/share/not-a-uuid",
    ].join("\n");
    expect(findContactIds(text).sharedDocs).toEqual([]);
  });
});

describe("findContactIds: onion addresses", () => {
  const V3 = "abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvwx";
  it("reads a v3 address as a trace, a v2 address only as an attribute, and ignores other lengths", () => {
    expect(V3).toHaveLength(56);
    const r = findContactIds(`Kontakt: http://${V3}.onion/ oraz abcdefghij234567.onion i abcdefgh.onion`);
    expect(r.onion).toEqual([V3]);
    expect(r.onionV2).toEqual(["abcdefghij234567"]);
  });
});

describe("findContactIds: messenger invitations", () => {
  it("reads Discord, Signal, Viber and Line invitations with the service in the key", () => {
    const text = [
      "discord.gg/abcd",
      "https://discord.com/invite/Xy9-Zz",
      "https://signal.me/#p/+48500000001",
      `https://signal.group/#${"A".repeat(24)}`,
      "viber://chat?number=%2B48500000002",
      "https://line.me/ti/p/~przyklad_konto",
    ].join("\n");
    expect(findContactIds(text).messengers).toEqual([
      "discord:abcd",
      "discord:Xy9-Zz",
      "signal:+48500000001",
      `signal_group:${"A".repeat(24)}`,
      "viber:+48500000002",
      "line:~przyklad_konto",
    ]);
  });

  it("leaves out the platforms' own community servers and the same invitation written twice", () => {
    expect(findContactIds("https://discord.gg/discord-developers https://discord.gg/Dobra1 discord.gg/Dobra1").messengers).toEqual(["discord:Dobra1"]);
  });

  it("finds nothing in a link to the official help page of a platform", () => {
    const r = findContactIds("https://support.discord.com/hc/pl/articles/1 https://support.signal.org/ https://help.line.me/");
    expect(r).toEqual({ sharedDocs: [], onion: [], onionV2: [], messengers: [] });
  });
});

describe("discordSnowflakes (creation date from the id)", () => {
  // 175928847299117063 is the sample id of Discord's documentation: created 2016-04-30 11:18:25.796 UTC
  it("reads the creation date of an id in a channel or user link", () => {
    const r = discordSnowflakes("https://discord.com/channels/175928847299117063/175928847299117064 oraz https://discord.com/users/175928847299117063");
    expect(r).toEqual([
      { id: "175928847299117063", kind: "guild", createdAt: "2016-04-30T11:18:25.796Z" },
      { id: "175928847299117064", kind: "channel", createdAt: "2016-04-30T11:18:25.796Z" },
      { id: "175928847299117063", kind: "user", createdAt: "2016-04-30T11:18:25.796Z" },
    ]);
  });

  it("ignores a number that is not an id (too short, a date before Discord existed, no link)", () => {
    expect(discordSnowflakes("https://discord.com/channels/12345/678")).toEqual([]);
    expect(discordSnowflakes("https://discord.com/users/10000000000000000")).toEqual([]);
    expect(discordSnowflakes("numer 175928847299117063 bez linku")).toEqual([]);
  });
});

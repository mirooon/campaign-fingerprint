import { describe, expect, it } from "vitest";
import { extractLanderConfig, unescapeJsString } from "./landerConfig";

const cfg = {
  session: { uuid: "4c8e1f93-6a2b-4d70-9e14-b5a9c3d7e281" },
  campaign: { uuid: "6E2D4B80-93a1-4c57-b8e2-1f4a7c9d03be", name: "ZESPOL / PL / Kamp1", owner_uuid: "5a1e0c3d-7b42-4f19-9c6e-2d8b41f07a13" },
  landing: { uuid: "7d1b5a29-c84e-4f63-b0a7-e93f2c6d5148", name: "2041 | PL - Jan Testowy Afera 1 - Ślimakowo Zysk", lander_template_uuid: "1e6f3c58-b29d-4a04-87c1-d5a0e4b7f936", lander_type_uuid: "0a5d8e47-1fb3-4c96-a2d8-6c74b1e9f30d" },
  source: { uuid: "e3c97b10-48a6-4e2f-9b5d-07f8a1c6d4e9", name: "FB CAPI via TestCloaker [domyślne]" },
  visit: { campaign_human_id: 305128, uuid: "01a0c3e7-5b19-7d42-8e6a-3f9b2c15d7a8" },
};

describe("extractLanderConfig (window.aio)", () => {
  it("reads account, campaign, landing, template and traffic source from the JSON.parse form", () => {
    const literal = JSON.stringify(cfg).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/Ś/g, "\\u015a");
    const html = `<script>window.aioBus = window.aioBus || []\nwindow.aio = JSON.parse('${literal}')</script>`;
    expect(extractLanderConfig(html)).toEqual({
      platform: "aio",
      ownerId: "5a1e0c3d-7b42-4f19-9c6e-2d8b41f07a13",
      campaignId: "6e2d4b80-93a1-4c57-b8e2-1f4a7c9d03be",
      campaignName: "ZESPOL / PL / Kamp1",
      campaignNumber: "305128",
      landingId: "7d1b5a29-c84e-4f63-b0a7-e93f2c6d5148",
      landingName: "2041 | PL - Jan Testowy Afera 1 - Ślimakowo Zysk",
      templateId: "1e6f3c58-b29d-4a04-87c1-d5a0e4b7f936",
      landerTypeId: "0a5d8e47-1fb3-4c96-a2d8-6c74b1e9f30d",
      sourceId: "e3c97b10-48a6-4e2f-9b5d-07f8a1c6d4e9",
      sourceName: "FB CAPI via TestCloaker [domyślne]",
    });
  });

  it("reads the object-literal form and ignores pages without the record or with a broken one", () => {
    expect(extractLanderConfig(`<script>window.aio = ${JSON.stringify(cfg)};</script>`)?.ownerId).toBe("5a1e0c3d-7b42-4f19-9c6e-2d8b41f07a13");
    expect(extractLanderConfig("<html><body>nic</body></html>")).toBeNull();
    expect(extractLanderConfig("<script>window.aio = JSON.parse('{\"campaign\":')</script>")).toBeNull();
    expect(extractLanderConfig(`<script>window.aio = JSON.parse('{"session":{"uuid":"x"}}')</script>`)).toBeNull();
  });

  it("unescapes JavaScript string escapes", () => {
    expect(unescapeJsString("a\\'b\\\\c\\u0141\\x41\\n")).toBe("a'b\\cŁA\n");
  });
});

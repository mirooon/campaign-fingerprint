import { describe, expect, it } from "vitest";
import { leadFlowTokens } from "./leadFlow";

const FORM = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const FLOW = "1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OWN = "2a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("leadFlowTokens", () => {
  it("reads the form, the flow list, the key id and the event host, without the page's own flow_uuid", () => {
    const html = `<script>window.aio=JSON.parse('{"visit":{"form_uuid":"${FORM}","flow_uuid":"${OWN}","flow_uuids":"[${FLOW}]"}}');
      const LANDING_ENCRYPTION_KEY_ID = 'KEY-001'; const LANDING_FORM_EVENT_BACKEND_DOMAIN = 'events.example.test';</script>`;
    expect(leadFlowTokens(html)).toEqual([`flow:${FLOW}`, `form:${FORM}`, "evhost:events.example.test", "key:KEY-001"].sort());
  });

  it("gives nothing for an empty form_uuid or a page without the platform record", () => {
    expect(leadFlowTokens(`{"form_uuid":"","flow_uuid":"${OWN}"}`)).toEqual([]);
    expect(leadFlowTokens("<p>hello</p>")).toEqual([]);
  });
});

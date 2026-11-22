import { describe, expect, it } from "vitest";
import { findCrmKeys } from "./crmKey";

// Synthetic keys: made-up values, reserved domains only.
const KEY = "Zx81QpL0vT6mWc3RyB9n";

describe("CRM / lead API keys (crm_key)", () => {
  it("finds a key in a script config, a fetch header, an XHR header and a hidden field, never keeping it whole", () => {
    const html = `<form><input type="hidden" name="api_key" value="Hd72kQm1xPz08LwVt5sA"></form>
<script>
const cfg = { apiKey: "${KEY}", offerId: "off-1" };
fetch("https://crm.example/api/lead", { method: "POST", headers: { "x-api-key": "Mn4bV7cX1zL9kJ2hG5fD" } });
xhr.setRequestHeader("Authorization", "Bearer Qw3eR8tY1uI6oP0aS2dF");
</script>`;
    const keys = findCrmKeys(html);
    expect(keys.map((k) => k.preview).sort()).toEqual(["Hd72…t5sA", "Mn4b…G5fD", "Qw3e…S2dF", "Zx81…yB9n"].sort());
    for (const k of keys) {
      expect(k.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(k)).not.toContain(KEY);
    }
  });

  it("skips public keys, short or low-entropy values, macros and CSRF tokens", () => {
    const html = `<div class="g-recaptcha" data-sitekey="6LcTestKeyAbCdEfGhIjKlMnOpQrStUvWxYz012345"></div>
<form><input type="hidden" name="_token" value="Ab12Cd34Ef56Gh78Ij90Kl"><input type="hidden" name="token" value="short1"></form>
<script>
const maps = { apiKey: "AIzaSyTestKey0123456789abcdefghijklmnop" };
const recaptcha = { sitekey: "6LcTestKeyAbCdEfGhIjKlMnOpQrStUvWxYz012345" };
const a = { token: "aaaaaaaaaaaaaaaaaaaaaaaa" };
const b = { api_key: "{{API_KEY}}" , access_key: "\${ACCESS_KEY_FROM_ENV_X}" };
const stripe = { apiKey: "pk_live_TestPublishable0123456789" };
</script>`;
    expect(findCrmKeys(html)).toEqual([]);
  });
});

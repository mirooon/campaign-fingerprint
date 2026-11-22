import { describe, expect, it } from "vitest";
import { canonicalParamName, extractCampaignParams, paramSchema } from "./campaignParams";

describe("canonicalParamName", () => {
  it.each([
    ["utm_campaign", "utm_campaign"],
    ["UTM_Source", "utm_source"],
    ["subid", "sub1"],
    ["sub_id", "sub1"],
    ["sub_id4", "sub4"],
    ["aff_sub", "sub1"],
    ["aff_sub3", "sub3"],
    ["affid", "aff_id"],
    ["affiliate", "aff_id"],
    ["ClickID", "click_id"],
    ["offerid", "offer_id"],
    ["cmp", "campaign_id"],
    ["cmp_name", "campaign_name"],
    ["ad_set", "adset_id"],
    ["adset_name", "adset_name"],
    ["creative", "ad_id"],
    ["crid", "ad_id"],
    ["creative_name", "ad_name"],
    ["px", "pixel_id"],
    ["fb_pixel", "pixel_id"],
  ])("%s -> %s", (raw, expected) => {
    expect(canonicalParamName(raw)).toBe(expected);
  });

  it("ignores non-campaign parameters", () => {
    for (const raw of ["ref", "fbclid", "gclid", "utm_name", "page", "q"]) expect(canonicalParamName(raw)).toBeNull();
  });
});

describe("extractCampaignParams", () => {
  it("decodes values, flags Cyrillic names and keeps the original parameter name", () => {
    const params = extractCampaignParams([
      "https://lp.example/start?utm_source=facebook&utm_medium=cpc&utm_campaign=%D0%BF%D0%BB_%D0%B8%D0%BD%D0%B2%D0%B5%D1%81%D1%82&Sub1=mb+kowal&fbclid=xyz",
    ]);
    expect(params.map((p) => [p.canonicalName, p.value, p.cyrillic])).toEqual([
      ["utm_source", "facebook", false],
      ["utm_medium", "cpc", false],
      ["utm_campaign", "пл_инвест", true],
      ["sub1", "mb kowal", false],
    ]);
    expect(params[3].name).toBe("Sub1");
  });

  it("detects unresolved macros", () => {
    const params = extractCampaignParams([
      "https://a.example/?campaign_name={{campaign.name}}&adset_id={adset_id}&ad_id=[[ad.id]]&sub2=%25%25ad%25%25&sub3=real-value",
    ]);
    expect(params.filter((p) => p.macro).map((p) => p.canonicalName)).toEqual(["campaign_name", "adset_id", "ad_id", "sub2"]);
    expect(params.find((p) => p.canonicalName === "sub3")?.macro).toBe(false);
  });

  it("dedupes across a redirect chain (case-insensitive value), keeping the first URL", () => {
    const params = extractCampaignParams([
      "https://ad.example/r?offer_id=771&sub1=MB_Kowal",
      null,
      undefined,
      "not a url",
      "https://lp.example/rejestracja?offer=771&aff_sub=mb_kowal&adset_id=120208000000000001",
    ]);
    expect(params.map((p) => `${p.canonicalName}=${p.value}@${new URL(p.sourceUrl).hostname}`)).toEqual([
      "offer_id=771@ad.example",
      "sub1=MB_Kowal@ad.example",
      "adset_id=120208000000000001@lp.example",
    ]);
  });

  it("reads query-like fragments, skips empty values and caps long ones", () => {
    const long = "x".repeat(300);
    const params = extractCampaignParams([`https://a.example/p?utm_term=&utm_content=${long}#utm_campaign=wiosna_pl&sub5=k9`]);
    expect(params.map((p) => p.canonicalName)).toEqual(["utm_content", "utm_campaign", "sub5"]);
    expect(params[0].value).toHaveLength(120);
  });
});

describe("paramSchema (template of a machine-generated tracking link)", () => {
  it("describes parameter names and value shapes, ignoring click IDs added by ad platforms", () => {
    const url =
      "https://lp.example/?utm_id=aB4dE6gH8jK0mN2pQ4rS&utm_medium=Qw3rTy7UiO&utm_campaign=mKjHgFdSaP&utm_visit=0195C2AA-1111-7222-8333-444455556666&fbclid=IwAR0abcDEF123";
    expect(paramSchema(url)?.key).toBe("utm_campaign:tok|utm_id:tok|utm_medium:tok|utm_visit:uuid");
  });

  it("gives the same key for another click through the same template", () => {
    const a = paramSchema("https://one.example/?utm_id=aB4dE6gH8jK0mN2pQ4rS&utm_medium=Qw3rTy7UiO&utm_visit=0195c2aa-1111-7222-8333-444455556666");
    const b = paramSchema("https://two.test/x?utm_visit=0195c2bb-9999-7888-8777-666655554444&utm_medium=zX9cV8bN1m&utm_id=zY8xW6vU4tS2rQ0pN8mL");
    expect(a?.key).toBe("utm_id:tok|utm_medium:tok|utm_visit:uuid");
    expect(b?.key).toBe(a?.key);
  });

  it("returns null for a hand-written UTM set: readable words are not a template fingerprint", () => {
    expect(paramSchema("https://shop.example/?utm_source=facebook&utm_medium=cpc&utm_campaign=wiosna_2026&utm_content=Baner1")).toBeNull();
  });

  it("returns null when fewer than three parameters remain after dropping click IDs", () => {
    expect(paramSchema("https://lp.example/?a=Qw3rTy7UiO&b=zX9cV8bN1m&gclid=EAIaIQobChMI0123&fbclid=IwAR0abcDEF123")).toBeNull();
    expect(paramSchema("not a url")).toBeNull();
  });
});

describe("campaign key of a tracker product (tracker_campaign)", () => {
  const HEX = "0123456789abcdef0123456789abcdef";

  it("reads key= and its variant name f7nx2= with a 32-hex value", () => {
    const [a] = extractCampaignParams([`https://alfa.example/click?key=${HEX}&clickid=x1`]);
    expect(a).toMatchObject({ name: "key", canonicalName: "tracker_campaign", value: HEX });
    const [b] = extractCampaignParams([`https://beta.test/?f7nx2=${HEX.toUpperCase()}`]);
    expect(b).toMatchObject({ name: "f7nx2", canonicalName: "tracker_campaign" });
  });

  it("ignores key= with any other value (an API key, a short word)", () => {
    expect(extractCampaignParams(["https://alfa.example/?key=abc123", `https://alfa.example/?key=${HEX}ff`])).toEqual([]);
  });
});

describe("aliases of tracker and TDS parameters (B-140)", () => {
  it("maps the buyer account, TDS sub IDs, campaign IDs, creative names and placement", () => {
    const got = extractCampaignParams(["https://lp.example/?acc=zespol_7&_buyer=kupiec9&_subid=abc123x&land_id=4411&_camp_id=9921&creo=baner_zielony&utm_placement=Others"]);
    expect(got.map((p) => [p.name, p.canonicalName])).toEqual([
      ["acc", "buyer_account"],
      ["_buyer", "buyer_account"],
      ["_subid", "sub1"],
      ["land_id", "campaign_id"],
      ["_camp_id", "campaign_id"],
      ["creo", "ad_name"],
      ["utm_placement", "placement"],
    ]);
  });
});

describe("Google Ads campaign ID (B-159)", () => {
  it("reads gad_campaignid as the advertiser's Google campaign", () => {
    expect(extractCampaignParams(["https://lp.example/?gad_source=1&gad_campaignid=21987654321&gclid=Cj0KCQ"]).map((p) => [p.canonicalName, p.value])).toEqual([["google_campaign", "21987654321"]]);
  });
});

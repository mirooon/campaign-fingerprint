import { describe, expect, it } from "vitest";
import { advertiserNameStyle, commentLanguage, landerSlugStyle, mixedScriptName } from "./namingStyle";

describe("mixedScriptName", () => {
  it("flags a Cyrillic letter inside a Latin name", () => {
    expect(mixedScriptName("С" + "4 test")).toBe(true);
    expect(mixedScriptName("adset сс")).toBe(true);
    expect(mixedScriptName("plain name")).toBe(false);
    expect(mixedScriptName("назва")).toBe(false);
  });
});

describe("commentLanguage", () => {
  it("tells Ukrainian from Russian by letters", () => {
    expect(commentLanguage("Блокуємо клавішу F12")).toBe("uk");
    expect(commentLanguage("блокируем эту кнопку")).toBe("ru");
    expect(commentLanguage("block the key")).toBeNull();
  });
});

describe("landerSlugStyle", () => {
  it("recognises vowelless and wordlist slugs", () => {
    expect(landerSlugStyle("/krwst-pl-mnbvrtk-zdrfnn-x-qw/index.html")).toBe("consonant_slug");
    expect(landerSlugStyle("/wood_music_soda_treasure_reaction_skirt/")).toBe("wordlist_slug");
    expect(landerSlugStyle("/blog/how-to-lose-weight/")).toBeNull();
  });
});

describe("advertiserNameStyle", () => {
  const pl = "Odchudzanie bez wysiłku, to się sprawdza";
  it("flags a random brand and a foreign person name in a Polish ad", () => {
    expect(advertiserNameStyle("Velvet Studio", pl)).toBe("random_brand");
    expect(advertiserNameStyle("Linda Harper", pl)).toBe("foreign_person_name");
  });
  it("ignores English ads and names that occur in the ad", () => {
    expect(advertiserNameStyle("Velvet Studio", "Lose weight fast with this")).toBeNull();
    expect(advertiserNameStyle("Velvet Studio", `${pl} Velvet`)).toBeNull();
    expect(advertiserNameStyle("Jan Kowalski", pl)).toBeNull();
  });
});

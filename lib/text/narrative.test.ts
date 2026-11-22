/**
 * Narrative of a material (B-187, B-294, B-296, B-297): topic, form of the hook and the IHC rule label are
 * attributes read from the copy with Polish word forms and word boundaries; never evidence of a campaign.
 * Synthetic texts only (fictional people).
 */
import { describe, expect, it } from "vitest";
import { celebBaitLabel, detectNarrative, summarizeNarratives } from "./narrative";

const topics = (body: string, headline?: string) => detectNarrative({ body, headline })?.topics.map((t) => t.id) ?? [];

describe("topics with Polish forms and word boundaries", () => {
  it("does not read a subsidy in a word that only contains a subsidy stem („doświadczenie”)", () => {
    expect(topics("Mam wieloletnie doświadczenie w branży.")).not.toContain("subsidy");
  });

  it("reads a subsidy in „dopłata z ZUS” and in inflected forms", () => {
    expect(topics("Nowa dopłata z ZUS dla seniorów")).toContain("subsidy");
    expect(topics("Sprawdź, czy należy ci się dotacji zwrot")).toContain("subsidy");
  });

  it("reads an investment and an AI trading topic", () => {
    const t = topics("Platforma AI sama analizuje giełdę i inwestuje za ciebie");
    expect(t).toContain("investment");
    expect(t).toContain("ai_trading");
  });

  it("reads a health topic with its subcategory (B-297)", () => {
    const n = detectNarrative({ body: "Lek na stawy poleca Adam Testowy" })!;
    const health = n.topics.find((t) => t.id === "health")!;
    expect(health.subtopics).toContain("joints");
  });

  it("reads the topics of news hooks: gold reserve, war and commodities, elections, state investment (B-296)", () => {
    expect(topics("Złoto z NBP trafi do zwykłych ludzi")).toContain("gold_reserve");
    expect(topics("Przez wojnę ceny gazu i ropy podskoczyły")).toContain("commodities_war");
    expect(topics("Przed wyborami kandydaci obiecują")).toContain("elections");
    expect(topics("Spółka Skarbu Państwa otwiera państwową inwestycję dla obywateli")).toContain("state_investment");
    expect(topics("Mundial 2026: zarób na meczach")).toContain("sport_event");
  });

  it("does not take the currency (złoty, złotych) for gold", () => {
    expect(topics("Zapłać tylko 99 złotych")).not.toContain("gold_reserve");
  });

  it("ranks a topic in the headline above the same topic in the body", () => {
    const n = detectNarrative({ headline: "Kasyno online z bonusem", body: "Inwestycja w kasyno" })!;
    expect(n.topics[0].id).toBe("gambling");
  });

  it("returns null for a text without any narrative cue", () => {
    expect(detectNarrative({ body: "Dzień dobry, zapraszamy na stronę." })).toBeNull();
  });
});

describe("form of the hook (B-294)", () => {
  it("reads a false sensation about a person", () => {
    expect(detectNarrative({ body: "Ewa Przykładowa zwolniona po tym, co powiedziała na antenie" })!.hooks).toContain("sensation");
  });

  it("reads an endorsement", () => {
    expect(detectNarrative({ body: "Adam Testowy poleca platformę" })!.hooks).toContain("endorsement");
  });

  it("reads a fake interview", () => {
    expect(detectNarrative({ body: "W wywiadzie dla telewizji ujawnił swój sposób" })!.hooks).toContain("fake_interview");
  });
});

describe("label of the IHC rule (attribute, not a risk score)", () => {
  it("labels a persona with a promise of profit", () => {
    const n = detectNarrative({ body: "Adam Testowy: pasywny dochód dla każdego" });
    expect(celebBaitLabel(n, { persona: true, fakeMedia: false })).toBe("celeb_bait_investment");
  });

  it("labels a persona with an invitation to a group", () => {
    const n = detectNarrative({ body: "Dołącz do mojej darmowej grupy na Telegramie" });
    expect(n!.groupInvite.length).toBeGreaterThan(0);
    expect(celebBaitLabel(n, { persona: true, fakeMedia: false })).toBe("celeb_bait_investment");
  });

  it("gives no label to the same persona without a promise, an invitation or a forged medium", () => {
    const n = detectNarrative({ body: "Adam Testowy w szpitalu" });
    expect(celebBaitLabel(n, { persona: true, fakeMedia: false })).toBeNull();
  });

  it("gives no label without a persona", () => {
    const n = detectNarrative({ body: "Pasywny dochód dla każdego" });
    expect(celebBaitLabel(n, { persona: false, fakeMedia: false })).toBeNull();
  });
});

describe("narratives of a campaign: topics with dates and a switch of topic within a week", () => {
  const at = (body: string, date: string) => ({ ...detectNarrative({ body })!, date });

  it("counts main topics with their dates and describes a switch within the window as one operator, two narratives", () => {
    const s = summarizeNarratives([
      at("Inwestuj w platformę i zarabiaj", "2026-10-01T10:00:00Z"),
      at("Inwestycja dla każdego", "2026-10-02T10:00:00Z"),
      at("Złoto z NBP dla obywateli, rezerwy złota", "2026-10-05T10:00:00Z"),
      null,
    ])!;
    expect(s.topics.map((t) => [t.id, t.count])).toEqual([["investment", 2], ["gold_reserve", 1]]);
    expect(s.topics[0].firstSeen).toBe("2026-10-01T10:00:00Z");
    expect(s.switches).toEqual([{ from: "investment", to: "gold_reserve", fromDate: "2026-10-02T10:00:00Z", toDate: "2026-10-05T10:00:00Z", days: 3 }]);
  });

  it("does not call topics a month apart a switch", () => {
    const s = summarizeNarratives([at("Inwestuj teraz", "2026-09-01T00:00:00Z"), at("Kasyno z bonusem", "2026-10-15T00:00:00Z")])!;
    expect(s.switches).toEqual([]);
  });
});

describe("amounts of money in the copy (B-189)", () => {
  it("reads amounts with a currency, with thousands separated by spaces", () => {
    expect(detectNarrative({ body: "Zacznij od 1 000 zł" })!.amounts).toEqual([1000]);
    expect(detectNarrative({ body: "Depozyt 250 EUR, bonus 11 000 zł i $300" })!.amounts).toEqual([250, 11000, 300]);
  });

  it("does not take years or bare numbers for amounts", () => {
    expect(detectNarrative({ body: "Inwestycja w 2026 roku, 15 osób" })!.amounts).toEqual([]);
  });
});

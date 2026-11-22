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

describe("scam funnel topics and hooks from investigative sources (I28)", () => {
  const hooksOf = (body: string) => detectNarrative({ body })?.hooks ?? [];

  it.each([
    ["tech_support", "Na twoim komputerze wykryto wirusa, skontaktuj się z działem bezpieczeństwa.", "Nowa dopłata z ZUS dla seniorów"],
    ["tech_support", "Twój telefon jest zainfekowany, zadzwoń do pomocy technicznej.", "Zainfekowana rana wymaga opatrunku"],
    ["tech_support", "Your computer has been locked: call technical support for remote assistance.", "Our shop ships to every country"],
    ["refund_overpayment", "Przelaliśmy za dużo, prosimy o zwrot różnicy z powodu pomyłki w kwocie.", "Zwrot towaru w ciągu 14 dni"],
    ["refund_overpayment", "We sent too much money by mistake, please refund the difference.", "Thank you for your order"],
    ["recovery_offer", "Odzyskamy utracone kryptowaluty, kancelaria odzyskująca pobiera opłatę za odzyskanie.", "Kancelaria prowadzi sprawy rodzinne"],
    ["recovery_offer", "We recover lost funds and your crypto, a recovery fee applies.", "We recover from injuries quickly"],
    ["job_offer", "Praca zdalna, wysokie wynagrodzenie, łatwe zadania: oceniaj produkty.", "Praca magisterska z historii"],
    ["job_offer", "Work from home as a product rater: easy tasks, a recruiter will contact you.", "Our home office furniture is on sale"],
    ["fake_authority", "Sprawa została przekazana do policji, agent policji poda numer odznaki.", "Policja zatrzymała kierowcę w Poznaniu"],
    ["fake_authority", "Your case was forwarded to the police; the agent will give you a badge number.", "The police station is closed on Sunday"],
  ])("reads the topic %s in a synthetic sentence and not in an unrelated one", (id, positive, negative) => {
    expect(topics(positive)).toContain(id);
    expect(topics(negative)).not.toContain(id);
  });

  it.each([
    ["secrecy", "Nie mów nikomu, a bankowi powiedz, że to remont. Bank jest w zmowie.", "Powiedz nam, jak oceniasz nasz remont"],
    ["secrecy", "Do not tell your bank, keep this confidential.", "Tell us what you think of the bank's app"],
    ["withdrawal_fee", "Przed wypłatą zapłać podatek przed wypłatą i opłatę weryfikacyjną za odblokowanie środków.", "Wypłata następuje w ciągu dwóch dni"],
    ["withdrawal_fee", "Pay a verification fee to unlock your funds before the withdrawal.", "Free withdrawal at any ATM"],
    ["urgency_lock", "Twoje konto zostanie zablokowane w ciągu 24 godzin. To ostatnie ostrzeżenie.", "Konto oszczędnościowe z dobrym oprocentowaniem"],
    ["urgency_lock", "Your account will be locked within 24 hours. Final warning.", "Your account settings are saved"],
  ])("reads the hook %s in a synthetic sentence and not in an unrelated one", (id, positive, negative) => {
    expect(hooksOf(positive)).toContain(id);
    expect(hooksOf(negative)).not.toContain(id);
  });
});

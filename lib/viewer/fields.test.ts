import { describe, expect, it } from "vitest";
import type { Campaign } from "@/lib/graph/model";
import { bridgeNote, brandNote, domainAgeNote, exactFileLabel, linkRuleLabel, nodeTypeLabel, faceLines, narrativeLine, narrativeSwitchLines, platformAccountLines, voiceLines, weakestLinkNote } from "./fields";

const nameOf = (id: string) => (id === "adam-testowy" ? "Adam Testowy" : id);

function camp(over: Partial<Campaign> = {}): Campaign {
  return { id: "K01", size: 4, members: ["a", "b", "c", "d"], firstSeen: null, lastSeen: null, topEvidence: [], domains: [], advertisers: [], cohesion: 0.6, strongComponents: 1, attributes: { personas: [], cyrillic: 0, cloakingSuspected: 0, deepfakeScoreMax: null }, ...over };
}

describe("platformAccountLines", () => {
  it("ostrzeżenie i źródło konta to dwa zdania, ostrzeżenie pierwsze", () => {
    const lines = platformAccountLines({ platformAccountWarning: "najemca X różni się od Y", platformAccountSource: "tenant→owner_uuid" });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("najemca X różni się od Y");
    expect(lines[1]).toContain("najemc");
  });
  it("konto ustalone po samym najemcy jest opisane jako słabsze", () => {
    expect(platformAccountLines({ platformAccountSource: "tenant" })[0]).toContain("słabsza podstawa");
  });
  it("bez pól nie zwraca nic", () => {
    expect(platformAccountLines({})).toEqual([]);
  });
});

describe("exactFileLabel", () => {
  it("węzeł pliku kreacji dostaje etykietę „ten sam plik reklamy”", () => {
    expect(exactFileLabel({ exactFile: true })).toBe("ten sam plik reklamy");
  });
  it("zwykły odcisk obrazu nie dostaje etykiety", () => {
    expect(exactFileLabel({})).toBeNull();
  });
});

describe("faceLines i voiceLines", () => {
  it("twarz jest „podobna do”, nigdy „to jest”", () => {
    const lines = faceLines([{ image: "x.png", x: 0, y: 0, w: 5, h: 5, persona: "adam-testowy", similarity: 0.571 }, { image: "x.png", x: 9, y: 9, w: 5, h: 5 }], nameOf);
    expect(lines[0]).toBe("Podobna twarz do Adam Testowy (0,57), do sprawdzenia przez człowieka.");
    expect(lines.join(" ")).not.toMatch(/to jest/i);
    expect(lines[1]).toContain("2 twarze");
  });
  it("bez rozpoznanej osoby mówi tylko o liczbie twarzy", () => {
    expect(faceLines([{ image: "x.png", x: 0, y: 0, w: 5, h: 5 }], nameOf)).toEqual(["Znaleziono 1 twarz, żadna nie jest podobna do osoby z listy."]);
  });
  it("kilka twarzy tej samej osoby daje jedno zdanie z najwyższym wynikiem", () => {
    const lines = faceLines([{ image: "a", x: 0, y: 0, w: 1, h: 1, persona: "adam-testowy", similarity: 0.5 }, { image: "b", x: 0, y: 0, w: 1, h: 1, persona: "adam-testowy", similarity: 0.62 }], nameOf);
    expect(lines.filter((l) => l.startsWith("Podobna twarz"))).toEqual(["Podobna twarz do Adam Testowy (0,62), do sprawdzenia przez człowieka."]);
  });
  it("głos jest „podobny do”, z przedziałem czasu", () => {
    const lines = voiceLines([{ start: 3, end: 11, persona: "adam-testowy", similarity: 0.7 }], nameOf);
    expect(lines).toEqual(["Głos podobny do Adam Testowy (0,70) w sekundach 3–11, do sprawdzenia przez człowieka."]);
  });
  it("pusta lista nie daje zdań", () => {
    expect(faceLines(undefined, nameOf)).toEqual([]);
    expect(voiceLines([], nameOf)).toEqual([]);
  });
});

describe("narrativeLine", () => {
  it("nazywa temat i formę przekazu po polsku", () => {
    expect(narrativeLine({ topics: [{ id: "investment", score: 3, terms: [] }], hooks: ["fake_interview"], profitPromise: [], groupInvite: [], amounts: [], date: null })).toBe("Narracja: inwestycje; forma: fałszywy wywiad.");
  });
  it("podkategoria zdrowia jest dopisana", () => {
    expect(narrativeLine({ topics: [{ id: "health", score: 2, terms: [], subtopics: ["joints"] }], hooks: [], profitPromise: [], groupInvite: [], amounts: [], date: null })).toBe("Narracja: zdrowie (stawy).");
  });
  it("nieznany temat zostaje pod swoim id, a brak narracji to null", () => {
    expect(narrativeLine({ topics: [{ id: "nowy_temat", score: 1, terms: [] }], hooks: [], profitPromise: [], groupInvite: [], amounts: [], date: null })).toBe("Narracja: nowy_temat.");
    expect(narrativeLine(null)).toBeNull();
  });
});

describe("narrativeSwitchLines", () => {
  it("zmiana tematu w krótkim czasie to „ten sam operator, dwie narracje”", () => {
    const lines = narrativeSwitchLines({ topics: [], hooks: [], labels: [], switches: [{ from: "investment", to: "subsidy", fromDate: "2026-09-01", toDate: "2026-09-04", days: 3 }] });
    expect(lines).toEqual(["Ten sam operator, dwie narracje: inwestycje, potem dotacje i świadczenia (w ciągu 3 dni)."]);
  });
});

describe("bridgeNote", () => {
  it("opisuje ślad sklejający podgrupy", () => {
    const c = camp({ bridge: { pivot: "tracker:x", type: "tracker", label: "GA4 G-TEST", parts: [["a", "b"], ["c", "d", "e"]] } });
    expect(bridgeNote(c)).toBe("Kampania sklejona jednym śladem: GA4 G-TEST. Łączy 2 grupy, w nich materiałów: 2 i 3; gdy ślad jest wspólny dla wielu stron, kampania jest za szeroka.");
  });
  it("bez mostu null", () => {
    expect(bridgeNote(camp())).toBeNull();
  });
});

describe("weakestLinkNote", () => {
  it("najsłabsze ogniwo z wynikiem i progiem", () => {
    expect(weakestLinkNote(camp({ minInternalScore: 0.22, weakestMember: { id: "d", score: 0.22, links: 1 } }), 0.15)).toBe("Najsłabsze ogniwo: d, najlepsze powiązanie 0,22 (próg łączenia 0,15), 1 powiązanie.");
  });
  it("bez pola null", () => {
    expect(weakestLinkNote(camp(), 0.15)).toBeNull();
  });
});

describe("domainAgeNote", () => {
  it("domena zarejestrowana przed emisją", () => {
    expect(domainAgeNote(2, "domain")).toBe("domena zarejestrowana 2 dni przed emisją");
    expect(domainAgeNote(1, "domain")).toBe("domena zarejestrowana 1 dzień przed emisją");
  });
  it("ten sam dzień, po emisji, brak danych", () => {
    expect(domainAgeNote(0, "domain")).toBe("domena zarejestrowana w dniu emisji");
    expect(domainAgeNote(-5, "domain")).toBe("domena zarejestrowana 5 dni po emisji (możliwa ponowna rejestracja)");
    expect(domainAgeNote(null, "domain")).toBeNull();
  });
  it("certyfikat nazwany certyfikatem, nie rejestracją", () => {
    expect(domainAgeNote(3, "cert")).toBe("pierwszy certyfikat wystawiono 3 dni przed emisją");
  });
});

describe("brandNote", () => {
  it("marka rozpoznana na kreacji, z rodzajem i pewnością", () => {
    expect(brandNote({ name: "Portal Testowy", kind: "media", probability: 0.81 })).toBe("Podrabiana marka: Portal Testowy (portal informacyjny), rozpoznana na kreacji (0,81).");
  });
  it("bez marki null", () => {
    expect(brandNote(undefined)).toBeNull();
  });
});

describe("linkRuleLabel", () => {
  it("łącze wariantu nie nosi etykiety reguły pary, która przeczyłaby werdyktowi", () => {
    expect(linkRuleLabel({ rule: "single_kind", variant: true })).toBe("wariant: przypisanie po kreacji, niższa pewność");
  });
  it("zwykłe łącze zachowuje etykietę reguły", () => {
    expect(linkRuleLabel({ rule: "single_kind" })).toBe("jeden rodzaj dowodu: najwyżej podobne");
    expect(linkRuleLabel({ rule: "campaign" })).toBe("łączy w kampanię");
  });
});

describe("nodeTypeLabel", () => {
  it("węzeł pliku kreacji ma własną etykietę, reszta nazwę typu", () => {
    expect(nodeTypeLabel({ type: "imagehash", data: { exactFile: true } })).toBe("ten sam plik reklamy");
    expect(nodeTypeLabel({ type: "imagehash", data: {} })).toBe("Hash obrazu");
  });
});

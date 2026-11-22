import { describe, expect, it } from "vitest";
import type { AddToBaseResult } from "@/lib/pipeline/addToBase";
import { addMessages, addToBaseRefusal } from "./addToBaseView";

const empty: AddToBaseResult = { added: [], skipped: [], createdCampaigns: [], historyDir: null };

describe("addMessages", () => {
  it("mówi, co dodano i do jakiej kampanii, także nowo utworzonej", () => {
    const msgs = addMessages({ ...empty, added: [{ id: "n1", verdict: "new_campaign", campaign: "K11" }, { id: "n2", verdict: "known_campaign", campaign: "K03" }], createdCampaigns: ["K11"] });
    expect(msgs[0]).toBe("Dodano do bazy 2 materiały: n1 (nowa kampania K11), n2 (kampania K03).");
  });
  it("mówi, czego nie dodano i dlaczego, z oryginałem duplikatu", () => {
    const msgs = addMessages({ ...empty, skipped: [{ id: "n3", reason: "duplikat materiału już w bazie", duplicateOf: "c1-01" }, { id: "n4", reason: "za mało danych do porównania" }] });
    expect(msgs).toEqual(["Nic nie dodano do bazy.", "Nie dodano n3: duplikat materiału już w bazie (duplikat materiału c1-01).", "Nie dodano n4: za mało danych do porównania."]);
  });
  it("jeden dodany materiał to liczba pojedyncza", () => {
    expect(addMessages({ ...empty, added: [{ id: "n1", verdict: "new_campaign", campaign: null }] })[0]).toBe("Dodano do bazy 1 materiał: n1.");
  });
});

describe("addToBaseRefusal", () => {
  it("baza przykładowa jest tylko do odczytu i dostaje opis, jak dopisywać", () => {
    expect(addToBaseRefusal(true)).toContain("VIEWER_DATA_DIR");
    expect(addToBaseRefusal(false)).toBeNull();
  });
  it("wynik przykładu nie trafia do bazy, nawet własnej", () => {
    expect(addToBaseRefusal(false, true)).toContain("przykładu");
  });
});

import { describe, expect, it } from "vitest";
import { authorNotes } from "./authorNotes";

describe("authorNotes", () => {
  it("rozpoznaje komentarz scenariusza z numerem, tekstem i rolą", () => {
    expect(authorNotes(["COMMENT 3: świetna oferta, polecam — skeptic"])).toEqual([{ kind: "comment", label: "komentarz scenariusza nr 3 (rola: skeptic)", text: "świetna oferta, polecam" }]);
  });
  it("rozpoznaje notatkę o poście w serwisie społecznościowym", () => {
    expect(authorNotes(["X-POST: wywiad z osobą publiczną"])).toEqual([{ kind: "post", label: "scenariusz posta w serwisie społecznościowym", text: "wywiad z osobą publiczną" }]);
  });
  it("etykieta cechy w cudzysłowie i obcięta wielokropkiem nadal się rozpoznaje, a zwykły komentarz kodu nie", () => {
    expect(authorNotes(["„comment 2: dziękuję za radę — fan…”"])[0]).toMatchObject({ kind: "comment", text: "dziękuję za radę" });
    expect(authorNotes(["end google tag manager", "walidacja numeru telefonu"])).toEqual([]);
  });
  it("komentarz bez roli nie dopisuje jej", () => {
    expect(authorNotes(["comment 1: bez podpisu"])[0].label).toBe("komentarz scenariusza nr 1");
  });
});

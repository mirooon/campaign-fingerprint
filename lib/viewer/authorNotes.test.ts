import { describe, expect, it } from "vitest";
import { authorNotes } from "./authorNotes";

describe("authorNotes", () => {
  it("recognizes a script comment with its number, text and role", () => {
    expect(authorNotes(["COMMENT 3: świetna oferta, polecam — skeptic"])).toEqual([{ kind: "comment", label: "script comment no. 3 (role: skeptic)", text: "świetna oferta, polecam" }]);
  });
  it("recognizes a note about a social media post", () => {
    expect(authorNotes(["X-POST: wywiad z osobą publiczną"])).toEqual([{ kind: "post", label: "scripted social media post", text: "wywiad z osobą publiczną" }]);
  });
  it("a feature label in quotes and cut with an ellipsis is still recognized, an ordinary code comment is not", () => {
    expect(authorNotes(["„comment 2: dziękuję za radę — fan…”"])[0]).toMatchObject({ kind: "comment", text: "dziękuję za radę" });
    expect(authorNotes(["“comment 2: dziękuję za radę — fan…”"])[0]).toMatchObject({ kind: "comment", text: "dziękuję za radę" });
    expect(authorNotes(["end google tag manager", "walidacja numeru telefonu"])).toEqual([]);
  });
  it("a comment without a role does not add one", () => {
    expect(authorNotes(["comment 1: bez podpisu"])[0].label).toBe("script comment no. 1");
  });
});

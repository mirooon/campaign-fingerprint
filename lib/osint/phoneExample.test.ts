import { describe, expect, it } from "vitest";
import { extractFromHtml } from "./extract";

// Synthetic lead forms: fictional numbers, reserved domains only.
const formWithHint = (hint: string) => `<!DOCTYPE html><html><body>
<h1>Zarejestruj się</h1>
<form action="/api/lead" method="post">
  <label for="phone">Telefon</label>
  <input type="tel" id="phone" name="phone" placeholder="+48 501 234 567">
  <small class="hint">${hint}</small>
  <button>Wyślij</button>
</form>
</body></html>`;

describe("example phone numbers of a form template (phoneExamples)", () => {
  it("a number in the help text under the field is a template example, not a contact", () => {
    const ex = extractFromHtml(formWithHint("Na przykład: 501 234 567"), "https://alpha.example/");
    expect(ex.phones).toEqual([]);
    expect(ex.phoneExamples).toEqual(["+48501234567"]);
  });

  it("np., e.g. and format markers, a label and the value of a tel field are examples too", () => {
    for (const hint of ["np. 602 345 678", "e.g. +48 602 345 678", "Format: 602-345-678"]) {
      const ex = extractFromHtml(formWithHint(hint), "https://alpha.example/");
      expect(ex.phones, hint).toEqual([]);
      expect(ex.phoneExamples, hint).toContain("+48602345678");
    }
    const label = extractFromHtml(`<form><label>Telefon (602 345 678)</label><input type="tel" value="+48 603 456 789"></form>`, "https://alpha.example/");
    expect(label.phones).toEqual([]);
    expect([...(label.phoneExamples ?? [])].sort()).toEqual(["+48602345678", "+48603456789"]);
  });

  it("a contact number in the footer stays a phone", () => {
    const ex = extractFromHtml(`${formWithHint("Podaj numer komórki")}<footer>Zadzwoń: 501 234 567</footer>`, "https://alpha.example/");
    expect(ex.phones).toEqual(["+48501234567"]);
  });

  it("obviously artificial numbers are neither phones nor examples worth keeping as contacts", () => {
    const ex = extractFromHtml(`<footer>Infolinia: 123 456 789, 555 555 555, +48 500 000 000</footer>`, "https://alpha.example/");
    expect(ex.phones).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { infinitiveCta } from "./infinitiveCta";

describe("infinitiveCta", () => {
  it("flags a bare infinitive as a title or button", () => {
    expect(infinitiveCta("Czytać")).toBe("czytać");
    expect(infinitiveCta("Dowiedzieć się")).toBe("dowiedzieć się");
    expect(infinitiveCta("Kupować teraz!")).toBe("kupować teraz");
  });

  it("leaves the imperative and ordinary titles alone", () => {
    expect(infinitiveCta("Czytaj więcej")).toBeNull();
    expect(infinitiveCta("Kup teraz")).toBeNull();
    expect(infinitiveCta("Jak schudnąć szybko i bezpiecznie")).toBeNull();
    expect(infinitiveCta("Zdrowie")).toBeNull();
    expect(infinitiveCta(null)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { defangText, defangUrl, refang } from "./defang";

describe("defang", () => {
  it("defangs scheme and host dots only", () => {
    expect(defangUrl("https://oferta.przyklad.test/start?a=1.2")).toBe("hxxps://oferta[.]przyklad[.]test/start?a=1.2");
    expect(defangUrl("http://a.example")).toBe("hxxp://a[.]example");
    expect(defangUrl("przyklad.test")).toBe("przyklad[.]test");
  });
  it("defangs addresses inside text, not numbers", () => {
    expect(defangText("Wejdź na https://zysk.test/x lub zysk2.example, kwota 4.800 zł")).toBe("Wejdź na hxxps://zysk[.]test/x lub zysk2[.]example, kwota 4.800 zł");
    expect(defangText("IP 192.0.2.10")).toBe("IP 192.0.2.10");
  });
  it("refang restores the original", () => {
    expect(refang(defangUrl("https://a.b.test/p"))).toBe("https://a.b.test/p");
  });
});

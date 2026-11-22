import { describe, expect, it } from "vitest";
import { detectFictionalExperts } from "./fictionalExpertAttr";

const LIST = [{ name: "Anna Przykładowa", aliases: ["prof. Przykładowa"] }];

describe("detectFictionalExperts", () => {
  /** A title with a name that is not on the list is reported. */
  it("reports an unlisted doctor", () => {
    expect(detectFictionalExperts("dr Jan Testowy poleca lek na stawy", LIST)).toEqual([{ title: "dr", name: "Jan Testowy" }]);
  });
  /** A listed person, also in an inflected form, is a persona, not a fictional expert. */
  it("skips a person on the list, inflected too", () => {
    expect(detectFictionalExperts("prof. Anna Przykładowa radzi", LIST)).toEqual([]);
    expect(detectFictionalExperts("Zdaniem prof. Przykładowej lek działa", LIST)).toEqual([]);
    expect(detectFictionalExperts("według profesora Anny Przykładowej", LIST)).toEqual([]);
  });
  /** Dedupes, and ignores text without a title or with a non-name after it. */
  it("dedupes and ignores non-names", () => {
    expect(detectFictionalExperts("dr Jan Testowy. Dr Jan Testowy jeszcze raz", LIST)).toHaveLength(1);
    expect(detectFictionalExperts("Jan Testowy poleca", LIST)).toEqual([]);
    expect(detectFictionalExperts("dr n. med. Zofia Wymyślona", LIST)[0].name).toBe("Zofia Wymyślona");
    expect(detectFictionalExperts("", LIST)).toEqual([]);
  });
});

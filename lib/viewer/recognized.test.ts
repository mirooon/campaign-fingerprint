import { describe, expect, it } from "vitest";
import { recognizedPeople } from "./recognized";

const people = [
  { id: "ewa-przykladowa", name: "Ewa Przykładowa", role: "dziennikarka", category: "Dziennikarze", source: "Publiczne ostrzeżenie testowe" },
  { id: "adam-testowy", name: "Adam Testowy", role: "przedsiębiorca", category: "Przedsiębiorcy" },
];

describe("recognizedPeople", () => {
  it("joins faces, voices and person data, sorted by name", () => {
    const list = recognizedPeople({
      faces: { persons: { "ewa-przykladowa": [[0], [0], [0]], "adam-testowy": [[0]] } },
      voices: { persons: { "ewa-przykladowa": [[0], [0]] } },
      people,
    });
    expect(list.map((p) => p.name)).toEqual(["Adam Testowy", "Ewa Przykładowa"]);
    expect(list[1]).toEqual({ id: "ewa-przykladowa", name: "Ewa Przykładowa", role: "dziennikarka", category: "Dziennikarze", source: "Publiczne ostrzeżenie testowe", faces: 3, voices: 2 });
    expect(list[0]).toMatchObject({ faces: 1, voices: 0, source: null });
  });
  it("a person with a voice only, not on the list of people, gets a name from the ID and no source", () => {
    const list = recognizedPeople({ faces: null, voices: { persons: { "jan-wymyslony": [[0]] } }, people });
    expect(list).toEqual([{ id: "jan-wymyslony", name: "Jan Wymyslony", role: null, category: null, source: null, faces: 0, voices: 1 }]);
  });
  it("without any gallery the list is empty", () => {
    expect(recognizedPeople({ faces: null, voices: null, people })).toEqual([]);
  });
  it("does not pass vectors through: the result has only counts", () => {
    const list = recognizedPeople({ faces: { persons: { "adam-testowy": [[0.1, 0.2]] } }, voices: null, people });
    expect(JSON.stringify(list)).not.toContain("0.1");
  });
});

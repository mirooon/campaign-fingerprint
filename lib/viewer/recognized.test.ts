import { describe, expect, it } from "vitest";
import { recognizedPeople } from "./recognized";

const people = [
  { id: "ewa-przykladowa", name: "Ewa Przykładowa", role: "dziennikarka", category: "Dziennikarze", source: "Publiczne ostrzeżenie testowe" },
  { id: "adam-testowy", name: "Adam Testowy", role: "przedsiębiorca", category: "Przedsiębiorcy" },
];

describe("recognizedPeople", () => {
  it("łączy twarze, głosy i dane osoby, posortowane po nazwie", () => {
    const list = recognizedPeople({
      faces: { persons: { "ewa-przykladowa": [[0], [0], [0]], "adam-testowy": [[0]] } },
      voices: { persons: { "ewa-przykladowa": [[0], [0]] } },
      people,
    });
    expect(list.map((p) => p.name)).toEqual(["Adam Testowy", "Ewa Przykładowa"]);
    expect(list[1]).toEqual({ id: "ewa-przykladowa", name: "Ewa Przykładowa", role: "dziennikarka", category: "Dziennikarze", source: "Publiczne ostrzeżenie testowe", faces: 3, voices: 2 });
    expect(list[0]).toMatchObject({ faces: 1, voices: 0, source: null });
  });
  it("osoba tylko z głosem, spoza listy osób, dostaje nazwę z id i brak źródła", () => {
    const list = recognizedPeople({ faces: null, voices: { persons: { "jan-wymyslony": [[0]] } }, people });
    expect(list).toEqual([{ id: "jan-wymyslony", name: "Jan Wymyslony", role: null, category: null, source: null, faces: 0, voices: 1 }]);
  });
  it("bez żadnej bazy lista jest pusta", () => {
    expect(recognizedPeople({ faces: null, voices: null, people })).toEqual([]);
  });
  it("nie przepuszcza wektorów: wynik ma tylko liczby", () => {
    const list = recognizedPeople({ faces: { persons: { "adam-testowy": [[0.1, 0.2]] } }, voices: null, people });
    expect(JSON.stringify(list)).not.toContain("0.1");
  });
});

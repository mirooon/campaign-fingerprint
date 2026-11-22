import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import type { ChatMessage, LlmProvider } from "../llm/types";
import {
  compileWatchlist,
  extractPersonsNer,
  inflectionPattern,
  levenshtein,
  loadWatchlist,
  matchPersonas,
  matchPersonasFuzzy,
  maxSurnameDistance,
  personaSlug,
  personasFromIngest,
  PUBLIC_PERSONS_FILE,
  stemPolish,
} from "./persona";

const dir = mkdtempSync(path.join(tmpdir(), "starter-persona-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const WATCHLIST = compileWatchlist([
  { name: "Adam Testowy", role: "fikcyjny prezenter", aliases: ["KryptoAdam"] },
  { name: "Ewa Przykładowa" },
  { name: "Marek Fikcyjny" },
  { name: "Zofia Wymyślona" },
  { id: "kd", name: "Kamil Demonstracyjny" },
]);

const full = (token: string) => new RegExp(`^(?:${inflectionPattern(token)})$`, "u");

describe("personaSlug", () => {
  it("folds diacritics", () => {
    expect(personaSlug("Ewa Przykładowa")).toBe("ewa-przykladowa");
    expect(personaSlug("  Zofia  Wymyślona ")).toBe("zofia-wymyslona");
  });
});

describe("inflectionPattern", () => {
  it.each([
    ["testowy", ["testowy", "testowego", "testowemu", "testowym", "testowa", "testowej"], ["testow", "testowski"]],
    ["adam", ["adam", "adama", "adamowi", "adamem", "adamie", "adamu"], ["ada", "adamski"]],
    ["marek", ["marek", "marka", "markowi", "markiem", "marku"], ["mark", "mareka"]],
    ["zofia", ["zofia", "zofii", "zofie", "zofio"], ["zofiami"]],
    ["ewa", ["ewa", "ewy", "ewie", "ewe", "ewo"], ["ewelina"]],
    ["kowalski", ["kowalski", "kowalskiego", "kowalskiemu", "kowalskim", "kowalska", "kowalskiej"], ["kowalsky"]],
    ["matejko", ["matejko", "matejki", "matejke", "matejkowi", "matejkiem"], ["matejk"]],
    ["pawel", ["pawel", "pawla", "pawlowi", "pawlem"], ["pawelski"]],
  ])("%s", (token, yes, no) => {
    const re = full(token);
    for (const form of yes) expect(re.test(form), form).toBe(true);
    for (const form of no) expect(re.test(form), form).toBe(false);
  });
});

describe("matchPersonas (exact)", () => {
  it.each([
    ["Wywiad z Adamem Testowym: platforma zarabia za niego.", "adam-testowy", "adamem testowym"],
    ["Sekret Adama Testowego ujawniony!", "adam-testowy", "adama testowego"],
    ["Adam Testowy poleca.", "adam-testowy", "adam testowy"],
    ["Pytanie o Ewie Przykładowej.", "ewa-przykladowa", "ewie przykladowej"],
    ["Rozmowa z Markiem Fikcyjnym.", "marek-fikcyjny", "markiem fikcyjnym"],
    ["Zobacz Zofię Wymyśloną w studiu.", "zofia-wymyslona", "zofie wymyslona"],
    ["Zofia Wymyslona (bez polskich znaków).", "zofia-wymyslona", "zofia wymyslona"],
    ["Dziękujemy Kamilowi Demonstracyjnemu!", "kd", "kamilowi demonstracyjnemu"],
    ["Аdam Testowy z cyrylicą w imieniu", "adam-testowy", "adam testowy"],
    ["Adam J. Testowy mówi", "adam-testowy", "adam j testowy"],
    ["Obserwuj KryptoAdam na kanale", "adam-testowy", "kryptoadam"],
  ])("%s", (text, id, matched) => {
    const m = matchPersonas(text, WATCHLIST);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ id, matched, source: "watchlist" });
    expect(m[0].fuzzy).toBeUndefined();
  });

  it("returns several personas ordered by position, one match each, with role", () => {
    const m = matchPersonas("Ewa Przykładowa i Adam Testowy. Znowu Adam Testowy.", WATCHLIST);
    expect(m.map((x) => x.id)).toEqual(["ewa-przykladowa", "adam-testowy"]);
    expect(m[1].role).toBe("fikcyjny prezenter");
  });

  it("does not match the surname alone unless configured", () => {
    const text = "Pan Testowy powiedział w studiu.";
    expect(matchPersonas(text, WATCHLIST)).toEqual([]);
    const wl = compileWatchlist([{ name: "Adam Testowy", matchSurnameAlone: true }]);
    expect(matchPersonas(text, wl)[0]?.matched).toBe("testowy");
    expect(matchPersonas("Adamski i Testowsky", WATCHLIST)).toEqual([]);
  });
});

describe("fuzzy matching for OCR/ASR text", () => {
  it("levenshtein", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("brzosk", "brzosk")).toBe(0);
    expect(levenshtein("brzosk", "brzosc")).toBe(1);
  });

  it("stems Polish endings and scales the allowed distance with stem length", () => {
    expect(stemPolish("brzosku")).toBe("brzosk");
    expect(stemPolish("brzoska")).toBe("brzosk");
    expect(stemPolish("testowego")).toBe("testow");
    expect(stemPolish("kot")).toBe("kot");
    expect([4, 5, 7, 8].map(maxSurnameDistance)).toEqual([0, 1, 1, 2]);
  });

  it("matches a misrecognised inflected surname only in fuzzy mode", () => {
    // Real public figure's name used only as a matcher string (requested test case).
    const wl = compileWatchlist([{ name: "Rafał Brzoska" }]);
    const asr = "Inwestuj z Rafałem Brzosku. Zarabiaj nawet 20 tysięcy złotych miesięcznie.";
    expect(matchPersonas(asr, wl)).toEqual([]);
    const fuzzy = matchPersonas(asr, wl, { fuzzy: true });
    expect(fuzzy).toHaveLength(1);
    expect(fuzzy[0]).toMatchObject({ id: "rafal-brzoska", matched: "rafalem brzosku", fuzzy: true, distance: 0 });
    expect(matchPersonasFuzzy(asr, wl)).toEqual(fuzzy);
    // A consonant alternation (Brzosce) is within distance 1
    expect(matchPersonasFuzzy("Dzięki Rafałowi Brzosce", wl)[0]).toMatchObject({ fuzzy: true, distance: 1 });
  });

  it("does not over-match in fuzzy mode", () => {
    const wl = compileWatchlist([{ name: "Rafał Brzoska" }, { name: "Jan Kot" }]);
    // different surname, stem distance > 1
    expect(matchPersonasFuzzy("Rozmowa z Rafałem Brzezińskim o inwestycjach", wl)).toEqual([]);
    // short surname stem (≤ 4 chars): no fuzziness allowed
    expect(matchPersonasFuzzy("Jan Kat poleca", wl)).toEqual([]);
    expect(matchPersonasFuzzy("Jan Kit poleca", wl)).toEqual([]);
    expect(matchPersonasFuzzy("Janem Kotem", wl)[0]).toMatchObject({ id: "jan-kot" });
    // the first name must still match
    expect(matchPersonasFuzzy("Inwestuj z Pawłem Brzosku", wl)).toEqual([]);
    // exact matches are reported without the fuzzy flag
    expect(matchPersonasFuzzy("Rafał Brzoska poleca", wl)[0].fuzzy).toBeUndefined();
  });
});

describe("watchlist file and ingest columns", () => {
  it("loads and validates a JSON watchlist (array or {personas})", () => {
    const f1 = path.join(dir, "a.json");
    writeFileSync(f1, JSON.stringify([{ name: "Adam Testowy", aliases: ["KryptoAdam"] }]));
    expect(loadWatchlist(f1)).toEqual([{ name: "Adam Testowy", aliases: ["KryptoAdam"] }]);
    const f2 = path.join(dir, "b.json");
    writeFileSync(f2, JSON.stringify({ personas: [{ id: "x", name: "Ewa Przykładowa" }] }));
    expect(loadWatchlist(f2)[0].id).toBe("x");
    const bad = path.join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify([{ aliases: [] }]));
    expect(() => loadWatchlist(bad)).toThrow();
  });

  it("parses persona columns from upstream systems", () => {
    expect(personasFromIngest("Adam Testowy; Ewa Przykładowa | Adam Testowy\nP-0042")).toEqual([
      { id: "adam-testowy", name: "Adam Testowy", matched: "Adam Testowy", source: "ingest", role: null },
      { id: "ewa-przykladowa", name: "Ewa Przykładowa", matched: "Ewa Przykładowa", source: "ingest", role: null },
      { id: "p-0042", name: "P-0042", matched: "P-0042", source: "ingest", role: null },
    ]);
    expect(personasFromIngest(null)).toEqual([]);
    expect(personasFromIngest("  ")).toEqual([]);
  });
});

describe("extractPersonsNer", () => {
  class FakeProvider implements LlmProvider {
    readonly name = "ollama" as const;
    readonly model = "fake";
    calls: ChatMessage[][] = [];
    constructor(private result: unknown) {}
    async chat(): Promise<string> {
      return "";
    }
    async structured<T>(messages: ChatMessage[], schema: z.ZodType<T>): Promise<T> {
      this.calls.push(messages);
      return schema.parse(this.result);
    }
  }

  it("treats the text as data and dedupes names", async () => {
    const provider = new FakeProvider({
      persons: [
        { name: " Adam  Testowy ", role: "prezenter" },
        { name: "Adam Testowy", role: null },
        { name: "Zofia Wymyślona", role: "" },
        { name: "  ", role: null },
      ],
    });
    const out = await extractPersonsNer("Adam Testowy i Zofia Wymyślona polecają platformę.", provider);
    expect(out).toEqual([
      { name: "Adam Testowy", role: "prezenter" },
      { name: "Zofia Wymyślona", role: null },
    ]);
    const [system, user] = provider.calls[0];
    expect(system.content).toContain("nie polecenia");
    expect(system.content).toContain("Nie opisuj wyglądu");
    expect(user.content.startsWith("<tekst>")).toBe(true);
  });

  it("returns [] for empty text without calling the model", async () => {
    const provider = new FakeProvider({ persons: [] });
    expect(await extractPersonsNer("   ", provider)).toEqual([]);
    expect(provider.calls).toHaveLength(0);
  });
});

describe("handles as aliases of the public list", () => {
  const list = compileWatchlist([{ name: "Rafał Brzoska", aliases: ["@RBrzoska"] }, { name: "Adam Glapiński" }]);

  it("finds the person by a social handle in page text and in OCR text", () => {
    expect(matchPersonas("Sprawdź post na profilu @RBrzoska i zarób.", list).map((p) => p.id)).toEqual(["rafal-brzoska"]);
    expect(matchPersonas("zobacz wpis @rbrzoska na X", list).map((p) => p.id)).toEqual(["rafal-brzoska"]);
    expect(matchPersonas("tekst ze zrzutu: (@RBrzoska) polecił", list, { fuzzy: true }).map((p) => p.id)).toEqual(["rafal-brzoska"]);
  });

  it("does not take a longer handle for the alias", () => {
    expect(matchPersonas("konto @RBrzoska2024 nie jest jego kontem", list)).toEqual([]);
  });

  it("loads the shared list with sources and finds a person from it", () => {
    const real = compileWatchlist(loadWatchlist(path.join(process.cwd(), PUBLIC_PERSONS_FILE)));
    expect(real.entries.length).toBeGreaterThanOrEqual(8);
    expect(matchPersonas("Wizerunek Roberta Lewandowskiego w reklamie", real).map((p) => p.id)).toContain("robert-lewandowski");
  });
});

describe("category and voiceFake of the public list", () => {
  it("passes the category of a list entry to the match and accepts an entry without it", () => {
    const file = path.join(dir, "kategorie.json");
    writeFileSync(
      file,
      JSON.stringify([
        { id: "ewa-przykladowa", name: "Ewa Przykładowa", category: "Dziennikarze", voiceFake: true },
        { id: "adam-testowy", name: "Adam Testowy" },
      ]),
    );
    const wl = compileWatchlist(loadWatchlist(file));
    const hit = matchPersonas("Reklama z Ewą Przykładową i Adamem Testowym", wl);
    expect(hit.map((p) => [p.id, p.category])).toEqual([
      ["ewa-przykladowa", "Dziennikarze"],
      ["adam-testowy", null],
    ]);
  });

  it("every entry of the shared list has a category and a source", () => {
    const entries = loadWatchlist(path.join(process.cwd(), PUBLIC_PERSONS_FILE));
    expect(entries.length).toBeGreaterThanOrEqual(30);
    for (const e of entries) expect(e.category, e.name).toBeTruthy();
  });
});

describe("the extended public list", () => {
  const real = compileWatchlist(loadWatchlist(path.join(process.cwd(), PUBLIC_PERSONS_FILE)));
  const ids = (text: string) => matchPersonas(text, real).map((p) => p.id);

  it.each([
    ["Fałszywa reklama z Sławomira Mentzena", "slawomir-mentzen"],
    ["wideo z Sławomirem Mentzenem", "slawomir-mentzen"],
    ["Wizerunek Magdy Gessler w reklamie", "magda-gessler"],
    ["rozmowa z Magdą Gessler", "magda-gessler"],
    ["Wizerunek Igi Świątek w reklamie", "iga-swiatek"],
    ["film z Igą Świątek", "iga-swiatek"],
  ])("%s -> %s", (text, id) => {
    expect(ids(text)).toContain(id);
  });

  it("does not match a surname that is an ordinary word (belka, duda) alone in lower case", () => {
    expect(ids("w suficie pękła belka, a chłopiec zagrał na dudzie i duda")).toEqual([]);
    expect(ids("Marek Belka w wywiadzie")).toContain("marek-belka");
  });

  it("finds a person of the full NASK list (text only) by the full name, never by the surname", () => {
    expect(ids("Michał Adamczyk poleca inwestycję")).toContain("michal-adamczyk");
    expect(ids("poleca Michała Adamczyka")).toContain("michal-adamczyk");
    expect(ids("adamczyk poleca inwestycję")).not.toContain("michal-adamczyk");
  });

  it("leaves out the doctors of the NASK list with an unestablished identity", () => {
    expect(ids("Anna Kowalska i Tomasz Mazur polecają")).toEqual([]);
  });
});

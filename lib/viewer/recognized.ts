/**
 * "Recognized people" (B-025): the closed list of people the tool compares faces and voices with, with the number
 * of reference samples and the public source that put each person on the list. Pure: it takes the parsed index
 * files and returns counts only, so reference vectors never reach the browser.
 */
import { humanizeId } from "./fields";

export interface RecognizedPerson {
  id: string;
  name: string;
  role: string | null;
  category: string | null;
  /** Public source that put the person on the list (a warning about misuse of their image); null when the list gives none. */
  source: string | null;
  /** Reference photos (face vectors) in the gallery. */
  faces: number;
  /** Reference windows of the voice in the gallery. */
  voices: number;
}

/** A reference index (`data/faces/index.json`, `data/voices/index.json`): per person a list of vectors, of which only the count is used. */
export interface ReferenceIndex {
  persons: Record<string, unknown[]>;
}

export interface PublicPerson {
  id: string;
  name: string;
  role?: string;
  category?: string;
  source?: string;
}

/** People of the face and voice galleries joined with the public list of persons, sorted by name (Polish collation); without galleries the list is empty. */
export function recognizedPeople(input: { faces: ReferenceIndex | null; voices: ReferenceIndex | null; people: PublicPerson[] }): RecognizedPerson[] {
  const byId = new Map(input.people.map((p) => [p.id, p]));
  const ids = new Set([...Object.keys(input.faces?.persons ?? {}), ...Object.keys(input.voices?.persons ?? {})]);
  return [...ids]
    .map((id): RecognizedPerson => {
      const p = byId.get(id);
      return {
        id,
        name: p?.name ?? humanizeId(id),
        role: p?.role ?? null,
        category: p?.category ?? null,
        source: p?.source ?? null,
        faces: input.faces?.persons[id]?.length ?? 0,
        voices: input.voices?.persons[id]?.length ?? 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pl"));
}

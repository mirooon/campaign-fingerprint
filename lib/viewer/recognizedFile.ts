/**
 * Edge of "Kogo rozpoznajemy" (B-025): reads the face and voice galleries and the public list of persons from the
 * data folder and hands them to the pure `recognizedPeople`. A missing or broken file leaves a note with the reason
 * instead of failing the page.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { recognizedPeople, type PublicPerson, type RecognizedPerson, type ReferenceIndex } from "./recognized";

export interface RecognizedResult {
  people: RecognizedPerson[];
  /** Why a source of the list is missing or unreadable. */
  notes: string[];
}

/** Parsed JSON of `file` under `root`, or null with the reason added to `notes`. */
function readOptional<T>(root: string, file: string, notes: string[], missing: string): T | null {
  const full = path.join(root, file);
  if (!existsSync(full)) {
    notes.push(`${file}: ${missing}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(full, "utf8")) as T;
  } catch (e) {
    notes.push(`${file}: nie udało się odczytać (${(e as Error).message})`);
    return null;
  }
}

/** People of the closed list from the data folder `root` (faces/index.json, voices/index.json, osoby-publiczne.json). */
export function loadRecognized(root: string): RecognizedResult {
  const notes: string[] = [];
  const faces = readOptional<ReferenceIndex>(root, path.join("faces", "index.json"), notes, "brak galerii twarzy (scripts/py/setup-face.sh)");
  const voices = readOptional<ReferenceIndex>(root, path.join("voices", "index.json"), notes, "brak galerii głosów (scripts/py/build_voice_index.py)");
  const people = readOptional<PublicPerson[]>(root, "osoby-publiczne.json", notes, "brak listy osób, więc nazwy pochodzą z identyfikatorów") ?? [];
  return { people: recognizedPeople({ faces, voices, people }), notes };
}

/**
 * Retention periods quoted in the personal-data inventory of the evidence pack. The cache periods
 * come from CACHE_TTL (lib/cache.ts), the one place that sets them, so the pack states what the
 * tool does. The period of the case material itself is a decision of the controller, stated here as the
 * default of the method (kept until the case is closed).
 */
import { CACHE_TTL, TTL } from "../cache";

/** Days of a cache period, as text for a reader ("7 dni"). */
const days = (ms: number): string => `${Math.round(ms / TTL.day)} ${Math.round(ms / TTL.day) === 1 ? "dzień" : "dni"}`;

export interface RetentionPolicy {
  /** Case material and the pack itself. */
  caseMaterial: string;
  /** Network answers (RDAP, DNS, pages, library records): the shortest of their caches is the guarantee, the longest the bound. */
  network: string;
  /** Speaker and face models' caches hold derived vectors, not the material. */
  models: string;
}

/** Retention periods of the pack, from the cache configuration. */
export function retentionPolicy(): RetentionPolicy {
  return {
    caseMaterial: "do zakończenia sprawy; usunięcie na wniosek osoby, której dane dotyczą, lub po decyzji organu",
    network: `cache odpowiedzi sieciowych: RDAP ${days(CACHE_TTL.rdap)}, strony i DNS ${days(CACHE_TTL.page)}, biblioteka reklam ${days(CACHE_TTL.adlibrary)}`,
    models: `cache modeli (wektory, nie materiał): do ${days(CACHE_TTL.speaker)}; wektory nie trafiają do paczki`,
  };
}

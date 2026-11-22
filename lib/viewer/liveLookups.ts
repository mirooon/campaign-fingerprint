/**
 * The "Dociągnij publiczne dane o domenach" option of the analysis form (passive DNS and RDAP lookups). The server
 * started with ANALYZE_OFFLINE=1 (the container default) never asks public registries, whatever the form sends, so
 * the option starts off and is locked there; otherwise it follows the analyst's choice of this browser session.
 * Pure functions: the page reads the environment, the form keeps the choice.
 */

/** ANALYZE_OFFLINE=1: the server works without the internet and drops `live=1` of the form (`/api/material`). */
export function serverOffline(env: Record<string, string | undefined>): boolean {
  return env.ANALYZE_OFFLINE === "1";
}

export interface LiveLookupsOption {
  checked: boolean;
  /** The server ignores the option: the checkbox is locked and `note` says why. */
  disabled: boolean;
  note: string | null;
}

/** Note under a locked checkbox. */
export const OFFLINE_NOTE = "Serwer pracuje bez internetu (ANALYZE_OFFLINE=1), więc analiza korzysta tylko z wgranych materiałów.";

/**
 * State of the checkbox: off and locked with a note when the server works offline; otherwise the choice made in
 * this session (`null` = none yet), on by default.
 */
export function liveLookupsOption(offline: boolean, choice: boolean | null): LiveLookupsOption {
  if (offline) return { checked: false, disabled: true, note: OFFLINE_NOTE };
  return { checked: choice ?? true, disabled: false, note: null };
}

/** Key of the choice in the session storage of the browser. */
export const LIVE_CHOICE_KEY = "analiza-dociagnij-dane";

/** Choice read back from the session storage: "1" on, "0" off, anything else none. */
export function parseLiveChoice(raw: string | null): boolean | null {
  return raw === "1" ? true : raw === "0" ? false : null;
}

/** Choice as kept in the session storage and sent in the `live` field of the form. */
export function liveChoiceValue(on: boolean): "1" | "0" {
  return on ? "1" : "0";
}

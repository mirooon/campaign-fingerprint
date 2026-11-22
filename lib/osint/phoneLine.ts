/**
 * Line type and country of a phone number from the offline metadata of libphonenumber-js (the "max"
 * metadata, no network: a number is never sent to a lookup service). An attribute of the material that
 * explains what kind of number the scam gives (toll-free on a fake security alert, a number of another
 * country than the market of the page); it does not change the weight of a phone trace, because VoIP and
 * app numbers are cheap and often disposable, which is why the weight rests on how rare the number is
 * (IDF), not on its type. Pure functions.
 */
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { PHONE_CONFIG } from "./phoneConfig";

export type PhoneLineType = "mobile" | "fixed" | "toll_free" | "premium" | "voip" | "shared_cost" | "unknown";

export interface PhoneLineInfo {
  /** The number as given (E.164 in the extracts). */
  phone: string;
  lineType: PhoneLineType;
  /** ISO 3166-1 alpha-2 country of the number, null when the metadata cannot place it. */
  country: string | null;
}

export interface PhoneLineFlags {
  /** A number belongs to another country than the market of the ad or page. */
  phoneCountryMismatch: boolean;
  /** A toll-free number on a page with a fake security alert (the funnel that wants the victim to call). */
  tollFreeOnAlert: boolean;
}

/**
 * Line type and country of one number. "Fixed or mobile" (the number plan does not tell them apart) and
 * types the scam funnel does not care about (pager, voicemail, personal number) are `unknown`; a number
 * that does not parse is `unknown` with a null country.
 */
export function phoneLineInfo(phone: string): PhoneLineInfo {
  const parsed = parsePhoneNumberFromString(phone);
  if (!parsed) return { phone, lineType: "unknown", country: null };
  const type = parsed.getType();
  return { phone, lineType: (type && PHONE_CONFIG.lineTypes[type]) ?? "unknown", country: parsed.country ?? null };
}

/**
 * Flags of the numbers of one material. `market` is the country code of the ad's market (ISO alpha-2);
 * `securityAlert` says the landing page carries the fake_security_alert technique. A number with an
 * unknown country is never a mismatch: nothing is known about it.
 */
export function phoneLineFlags(lines: PhoneLineInfo[], ctx: { market: string; securityAlert: boolean }): PhoneLineFlags {
  return {
    phoneCountryMismatch: lines.some((l) => l.country !== null && l.country !== ctx.market),
    tollFreeOnAlert: ctx.securityAlert && lines.some((l) => l.lineType === "toll_free"),
  };
}

/**
 * Settings of the phone line type (I28): how the type names of libphonenumber-js map to the ones the tool
 * shows, and the market assumed for an ad when nothing says otherwise. Read by lib/osint/phoneLine.ts.
 */
import type { PhoneLineType } from "./phoneLine";

export const PHONE_CONFIG = {
  /** Types of libphonenumber-js -> types of the tool; a type missing here is "unknown". */
  lineTypes: {
    MOBILE: "mobile",
    FIXED_LINE: "fixed",
    TOLL_FREE: "toll_free",
    PREMIUM_RATE: "premium",
    VOIP: "voip",
    SHARED_COST: "shared_cost",
  } as Record<string, PhoneLineType>,
  /** Country of the market the ads are collected for (ISO alpha-2): the tool is built for Polish ads. */
  defaultMarket: "PL",
} as const;

/**
 * Defanged links: material addresses are shown as text that is not clickable and does not
 * auto-link (hxxps://domena[.]live/...), with a copy button for the original value.
 */

const SCHEME = /^(h)tt(ps?):\/\//i;

/** "https://a.b.test/x?y" -> "hxxps://a[.]b[.]test/x?y"; a bare host "a.test" -> "a[.]test". */
export function defangUrl(value: string): string {
  const s = value.trim();
  const m = SCHEME.exec(s);
  const rest = m ? s.slice(m[0].length) : s;
  const cut = rest.search(/[/?#]/);
  const host = cut === -1 ? rest : rest.slice(0, cut);
  const tail = cut === -1 ? "" : rest.slice(cut);
  const scheme = m ? `${m[1]}xx${m[2]}://` : "";
  return `${scheme}${host.replace(/\./g, "[.]")}${tail}`;
}

const URL_OR_DOMAIN = /\bhttps?:\/\/[^\s"'<>]+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,24}|xn--[a-z0-9-]{2,30})\b/gi;

/** Defangs every address and domain inside free text (OCR, evidence descriptions). */
export function defangText(text: string): string {
  return text.replace(URL_OR_DOMAIN, (m) => (/^https?:\/\//i.test(m) ? defangUrl(m) : m.includes(".") && !/^\d+(\.\d+)+$/.test(m) ? m.replace(/\./g, "[.]") : m));
}

/** Back to the original value (for copying). */
export function refang(value: string): string {
  return value.replace(/^hxxp/i, (m) => `${m[0]}ttp`).replace(/\[\.\]/g, ".");
}

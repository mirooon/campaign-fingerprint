/** Live (network) lookups for the case importer, shared by `import-cases` and `base`. */
import { resolveDns, resolveTxt } from "../osint/dns";
import type { CaseLookups } from "./caseImport";

const USER_AGENT = "hacknation-osint-starter/0.1 (passive lookup)";

/** GET of a JSON document with a timeout; null on a non-2xx answer or a non-JSON (HTML error) body. */
async function getJson(url: string, timeoutMs: number): Promise<unknown | null> {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/rdap+json, application/json", "user-agent": USER_AGENT } });
  if (!res.ok) return null;
  try {
    return JSON.parse(await res.text());
  } catch {
    return null; // an HTML error page
  }
}

/** Passive lookups for the case importer: DNS, RDAP through rdap.org, Team Cymru TXT and (with `withCt`) crt.sh. Network access; used only by the CLI steps. */
export function liveLookups(withCt: boolean): CaseLookups {
  return {
    dns: async (name, types) => {
      const r = await resolveDns(name, { types });
      return { A: r.a, AAAA: r.aaaa, CNAME: r.cname, NS: r.ns, MX: r.mx, TXT: r.txt };
    },
    rdapRaw: (domain) => getJson(`https://rdap.org/domain/${encodeURIComponent(domain)}`, 20_000),
    ...(withCt ? { ctRaw: (domain: string) => getJson(`https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`, 40_000) } : {}),
    txt: (name) => resolveTxt(name),
  };
}

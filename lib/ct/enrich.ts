/**
 * Passive enrichment of a CT candidate: DNS (A/AAAA/CNAME/NS/MX), RDAP and crt.sh history.
 * The landing page is NOT fetched unless explicitly requested (fetchPage: true), and then
 * with a single GET through the same SSRF-guarded fetcher as the pipeline.
 */
import type { EnrichmentSources } from "../pipeline/sources";
import type { CandidateEnrichment } from "./feed";

export interface EnrichCandidateOptions {
  fetchPage?: boolean;
  /** Extra certificate hosts to resolve (CNAME/A), at most this many. Default 2. */
  maxHosts?: number;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function enrichCandidate(
  domain: string,
  names: string[],
  sources: EnrichmentSources,
  opts: EnrichCandidateOptions = {},
): Promise<CandidateEnrichment> {
  const out: CandidateEnrichment = { dns: null, hosts: [], rdap: null, ct: null, page: null, errors: [], skipped: null };
  const hosts = [...new Set(names.map((n) => n.replace(/^\*\./, "").toLowerCase()))].filter((h) => h !== domain && h.endsWith(`.${domain}`)).slice(0, opts.maxHosts ?? 2);
  await Promise.all([
    (async () => {
      try {
        const d = await sources.dns(domain, ["A", "AAAA", "CNAME", "NS", "MX"]);
        out.dns = { a: d.a, aaaa: d.aaaa, cname: d.cname, ns: d.ns, mx: d.mx };
      } catch (e) {
        out.errors.push(`dns: ${msg(e)}`);
      }
    })(),
    ...hosts.map(async (host) => {
      try {
        const d = await sources.dns(host, ["A", "CNAME"]);
        out.hosts.push({ host, a: d.a, cname: d.cname });
      } catch (e) {
        out.errors.push(`dns ${host}: ${msg(e)}`);
      }
    }),
    (async () => {
      try {
        const r = await sources.rdap(domain);
        out.rdap = r ? { registrar: r.registrar, created: r.created, expires: r.expires, status: r.status, nameservers: r.nameservers } : null;
      } catch (e) {
        out.errors.push(`rdap: ${msg(e)}`);
      }
    })(),
    (async () => {
      try {
        const ct = await sources.ct(domain);
        if (ct) {
          const dates = ct.certs.map((c) => c.notBefore).filter((x): x is string => !!x).sort();
          out.ct = { certificates: ct.certs.length, first_seen: dates[0] ?? null, issuers: [...new Set(ct.certs.map((c) => c.issuer))].slice(0, 5) };
        }
      } catch (e) {
        out.errors.push(`ct: ${msg(e)}`);
      }
    })(),
  ]);
  out.hosts.sort((a, b) => a.host.localeCompare(b.host));
  if (opts.fetchPage) {
    const url = `https://${domain}/`;
    try {
      const p = await sources.fetchPage(url);
      out.page = {
        url,
        status: p.status,
        final_url: p.finalUrl,
        title: p.body?.match(/<title[^>]*>([^<]{0,300})<\/title>/i)?.[1]?.trim() ?? null,
        body_sha256: p.bodySha256,
        error: p.error,
      };
    } catch (e) {
      out.page = { url, status: null, final_url: null, title: null, body_sha256: null, error: msg(e) };
    }
  }
  return out;
}

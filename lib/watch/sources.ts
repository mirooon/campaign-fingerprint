/**
 * The sources of the scan scheduler: CT, ad libraries, urlscan and the CERT Warning List. Each is built from
 * injected parts (a searcher, a list fetcher, an RDAP lookup), so tests run on recorded answers; the real parts
 * are wired in `scripts/watch.ts`. A source that cannot be asked (no network, no key, no tool) answers
 * `skipped` with the reason and never throws for that.
 */
import { ADLIB_CONFIG } from "../adlib/config";
import type { AdLibrarySource, AdPlatform, AdSearchQuery } from "../adlib/types";
import { CtWatcher, type CtWatcherOptions } from "../ct/watch";
import type { CtStreamEvent } from "../ct/stream";
import type { CtFeedRecord } from "../ct/feed";
import { registrableOfName, type FingerprintSet } from "../ct/fingerprint";
import { ArchiveLookupError } from "../osint/archive/http";
import type { UrlscanSource } from "../osint/archive/urlscan";
import { WATCH_CONFIG } from "./config";
import { confirmByRegistration, extractFeature, type RegistrationFacts, type WatchRecipe } from "./recipes";
import type { WatchHit, WatchSource } from "./schedule";

/** Reason text of a failure: ArchiveLookupError carries its own, others their message. */
const reasonOf = (e: unknown): string => (e instanceof ArchiveLookupError ? e.reason : e instanceof Error ? e.message : String(e));

export interface UrlscanWatchOptions {
  searcher: Pick<UrlscanSource, "available" | "searchScans">;
}

/**
 * urlscan: each due recipe is one search query; each scan found is a hit (the scanned address). A recipe with a
 * `feature` reads it from the scan's request list and keeps only values on its alarm list, marking the hit with
 * what was found (the confirmation). One recipe's failure (limit) stops the recipes after it and is reported.
 */
export function createUrlscanWatchSource(o: UrlscanWatchOptions): WatchSource {
  return {
    name: "urlscan",
    async poll({ recipes }) {
      const mine = recipes.filter((r) => r.source === "urlscan");
      if (!mine.length) return { hits: [], skipped: "no urlscan recipes (give --recipes)" };
      const access = await o.searcher.available();
      if (!access.ok) return { hits: [], skipped: `${access.reason ?? "urlscan unavailable"}${access.howToGetAccess ? ` (${access.howToGetAccess})` : ""}` };
      const hits: WatchHit[] = [];
      for (const r of mine) {
        let scans;
        try {
          scans = await o.searcher.searchScans(r.query, { withRequests: !!r.feature, limit: r.limit ?? WATCH_CONFIG.maxHitsPerRecipe });
        } catch (e) {
          return { hits, skipped: `recipe ${r.id}: ${reasonOf(e)}` };
        }
        for (const scan of scans) {
          const feature = extractFeature(r, (scan.requests ?? []).map((q) => q.url));
          if (r.feature?.alarm && !feature?.alarm) continue;
          hits.push({
            source: "urlscan",
            url: scan.url,
            recipe: r.id,
            ...(feature ? { confirmations: [`${r.feature?.name}: ${feature.value}`] } : {}),
            note: scan.sourceUrl,
          });
        }
      }
      return { hits };
    },
  };
}

export interface CertlistWatchOptions {
  /** Domains of today's Lista Ostrzeżeń CERT; null when it could not be fetched (with the reason). */
  fetchList: () => Promise<{ domains: string[] } | { error: string }>;
  /** The list of the previous run (null at the first run); `save` stores today's. */
  snapshot: { load: () => Promise<Set<string> | null>; save: (domains: Set<string>) => Promise<void> };
  /** RDAP and NS facts of a domain; null when the lookup gave nothing. */
  facts: (domain: string) => Promise<RegistrationFacts | null>;
}

/**
 * Lista Ostrzeżeń CERT: the difference with the previous run, domains matching a recipe's pattern, and then the
 * mandatory registration filter (registrar, registration hour, NS pair). The pattern alone gives hundreds of false
 * hits, so a domain without facts or without the confirmation is dropped. The first run only stores the list.
 */
export function createCertlistWatchSource(o: CertlistWatchOptions): WatchSource {
  return {
    name: "certlist",
    async poll({ recipes }) {
      const mine = recipes.filter((r) => r.source === "certlist");
      if (!mine.length) return { hits: [], skipped: "no certlist recipes (give --recipes)" };
      const list = await o.fetchList();
      if ("error" in list) return { hits: [], skipped: list.error };
      const today = new Set(list.domains.map((d) => d.toLowerCase()));
      const before = await o.snapshot.load();
      await o.snapshot.save(today);
      if (!before) return { hits: [], skipped: `first run: list state saved (${today.size} domains), the next run gives the difference` };
      const added = [...today].filter((d) => !before.has(d));
      const hits: WatchHit[] = [];
      let checks = 0;
      for (const r of mine) {
        const re = new RegExp(r.query, "i");
        for (const domain of added.filter((d) => re.test(d))) {
          if (checks >= WATCH_CONFIG.certlistMaxChecks) return { hits, skipped: `limit of ${WATCH_CONFIG.certlistMaxChecks} RDAP checks per cycle; the rest in the next one` };
          checks++;
          const facts = await o.facts(domain);
          if (!facts) continue;
          const verdict = confirmByRegistration(r.confirm ?? {}, facts);
          if (verdict.ok) hits.push({ source: "certlist", url: `https://${domain}/`, recipe: r.id, confirmations: verdict.confirmations });
        }
      }
      return { hits };
    },
  };
}

export interface AdlibWatchOptions {
  sources: Partial<Record<AdPlatform, AdLibrarySource>>;
  /** Keywords searched when no ad-library recipe names one (e.g. names of impersonated persons). */
  defaultKeywords?: string[];
}

/**
 * Ad libraries: each due recipe is a keyword query on its platform (or on every available one); each ad is a hit,
 * addressed by its landing page, else by its library page. A platform that is unavailable is named in the reason
 * when no platform could be asked at all.
 */
export function createAdlibWatchSource(o: AdlibWatchOptions): WatchSource {
  return {
    name: "adlibrary",
    async poll({ recipes }) {
      const mine = recipes.filter((r) => r.source === "adlibrary");
      const queries: Array<{ recipe?: WatchRecipe; platform?: string; q: AdSearchQuery }> = mine.length
        ? mine.map((r) => ({ recipe: r, platform: r.platform, q: { keyword: r.query, limit: r.limit ?? WATCH_CONFIG.maxHitsPerRecipe } }))
        : (o.defaultKeywords ?? []).map((keyword) => ({ q: { keyword, limit: WATCH_CONFIG.maxHitsPerRecipe } }));
      if (!queries.length) return { hits: [], skipped: "no adlibrary recipes and no keywords" };
      const hits: WatchHit[] = [];
      const unavailable: string[] = [];
      let asked = 0;
      for (const [platform, source] of Object.entries(o.sources) as Array<[AdPlatform, AdLibrarySource]>) {
        const access = await source.available();
        if (!access.ok) {
          unavailable.push(`${platform}: ${access.reason ?? "unavailable"}`);
          continue;
        }
        for (const { recipe, platform: only, q } of queries) {
          // a platform that bills per query (Google) is asked only when the recipe names it
          if (only ? only !== platform : !ADLIB_CONFIG.defaultQueryPlatforms.includes(platform)) continue;
          asked++;
          for (const rec of await source.search(q)) {
            hits.push({ source: "adlibrary", url: rec.landingUrl ?? rec.libraryUrl, ...(recipe ? { recipe: recipe.id } : {}), adRecord: rec });
          }
        }
      }
      return asked ? { hits } : { hits: [], skipped: unavailable.join("; ") || "no ad library is configured" };
    },
  };
}

export interface CtWatchOptions {
  set: FingerprintSet;
  /** Certificates of this cycle: from a replay file or a stream window; `skipped` says why none could be read. */
  collect: () => Promise<{ events: CtStreamEvent[]; skipped?: string }>;
  source: CtFeedRecord["source"];
  /** Passive enrichment of candidates (DNS, RDAP); needed to confirm a candidate by infrastructure. */
  enrich?: NonNullable<CtWatcherOptions["enrich"]>;
  /** Infrastructure of the campaigns of the base (see lib/ct/confirm.ts). */
  infra?: CtWatcherOptions["infra"];
}

/**
 * CT: the certificates of the cycle go through the fingerprints of known campaigns (`CtWatcher`); a domain that
 * matches is a hit with the campaign it resembles as a hint and, with enrichment and `infra`, the infrastructure it shares. A CT recipe adds a pattern over registrable domains.
 */
export function createCtWatchSource(o: CtWatchOptions): WatchSource {
  return {
    name: "ct",
    async poll({ recipes }) {
      const got = await o.collect();
      if (got.skipped) return { hits: [], skipped: got.skipped };
      const candidates: CtFeedRecord[] = [];
      const watcher = new CtWatcher({ set: o.set, feedFile: null, source: o.source, enrich: o.enrich ?? null, infra: o.infra, onCandidate: (r) => candidates.push(r) });
      for (const e of got.events) watcher.handle(e);
      await watcher.flush();
      const hits: WatchHit[] = [];
      const taken = new Set<string>();
      for (const rec of candidates) {
        taken.add(rec.domain);
        const confirmations = rec.candidate.confirmations ?? [];
        hits.push({
          source: "ct",
          url: `https://${rec.domain}/`,
          campaignHint: rec.candidate.campaign_id,
          ...(confirmations.length ? { confirmations } : {}),
          note: `${rec.candidate.kind} ${rec.candidate.score.toFixed(2)}`,
        });
      }
      for (const r of recipes.filter((x) => x.source === "ct")) {
        const re = new RegExp(r.query, "i");
        for (const e of got.events)
          for (const name of e.domains) {
            const d = registrableOfName(name);
            if (d && !taken.has(d) && re.test(d)) {
              taken.add(d);
              hits.push({ source: "ct", url: `https://${d}/`, recipe: r.id });
            }
          }
      }
      return { hits };
    },
  };
}

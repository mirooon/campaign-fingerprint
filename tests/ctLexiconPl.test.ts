/** Starter lexicon of the CT watcher (data/ct/lexicon-pl.json): a synthetic certificate for a fake news site is a hit; official domains are not. */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadCtConfig } from "../lib/ct/config";
import { buildFingerprints, matchDomain } from "../lib/ct/fingerprint";
import type { CampaignsFile } from "../lib/graph/model";

const config = loadCtConfig(path.join(process.cwd(), "data", "ct", "lexicon-pl.json"));
const campaigns = {
  campaigns: [{ id: "K01", size: 2, members: [], domains: ["tvn24-wiadomosci-wideo.example", "tvn24-wiadomosci-film.example"], advertisers: [], attributes: { personas: [] } }],
  assignments: {},
} as unknown as CampaignsFile;
const set = buildFingerprints(campaigns, { config });

describe("leksykon startowy PL", () => {
  it("syntetyczny certyfikat dla tvn24-wiadomosci.test trafia do kampanii, która podszywa się pod to medium", () => {
    const m = matchDomain("tvn24-wiadomosci.test", set);
    expect(m).toMatchObject({ campaignId: "K01", kind: "media" });
  });

  it("oficjalna domena medium i domena bez związku z kampanią nie są kandydatami", () => {
    expect(matchDomain("tvn24.pl", set)).toBeNull();
    expect(matchDomain("kwiaciarnia-wiadomosci.test", set)).toBeNull();
  });

  it("zawiera marki z raportu CERT i obniża minimalną długość marki, żeby OLX i PGE się liczyły", () => {
    expect(config.lexicon.brands).toEqual(expect.arrayContaining(["OLX", "Allegro", "InPost", "Orlen", "PGE", "mObywatel"]));
    expect(config.minBrandLength).toBe(3);
  });
});

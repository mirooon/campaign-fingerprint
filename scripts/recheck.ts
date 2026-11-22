/**
 * bun run recheck -- --pack data/evidence/K01 [--cert-list domains.json] [--no-ad-library]
 * Passive re-check of a pack after the report: DNS of the domains, the local copy of the CERT list, the
 * ad-library record (`takenDown`). Appends the findings with the time to `integrity.custody_log` of
 * evidence.json; the files of the pack and manifest.sha256 stay as they were. No online queries to
 * the platforms' own services beyond the public ad library, and nothing is sent anywhere.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { certStatus } from "../lib/evidence/certList";
import { loadCertList } from "../lib/evidence/certListFile";
import { recheckEntries, type RecheckProbes, type RecheckRecord } from "../lib/evidence/recheck";
import { detectAdLibrary, lookupAdLibrary } from "../lib/osint/adLibrary";
import { resolveDns } from "../lib/osint/dns";
import { cli, main } from "./_cli";

const args = cli(
  {
    pack: { type: "string" },
    "cert-list": { type: "string" },
    "no-ad-library": { type: "boolean" },
  } as const,
  `Użycie: bun run recheck -- --pack data/evidence/K01 [--cert-list domains.json] [--no-ad-library]
Pasywne ponowne sprawdzenie paczki po zgłoszeniu (DNS, lokalna lista CERT, biblioteka reklam); wpisy trafiają do custody_log w evidence.json.`,
);

void main(async () => {
  if (!args.pack) throw new Error("podaj --pack (katalog paczki)");
  const file = path.join(args.pack, "evidence.json");
  if (!existsSync(file)) throw new Error(`brak ${file}`);
  const json = JSON.parse(readFileSync(file, "utf8")) as RecheckRecord & { integrity: { custody_log: unknown[] } };
  const cert = loadCertList(args["cert-list"]);
  const library = args["no-ad-library"] ? { available: false as const, python: null, reason: "wyłączono flagą --no-ad-library" } : await detectAdLibrary();
  if (!library.available) console.log(`[recheck] biblioteka reklam pominięta: ${library.reason}`);
  if (!cert.snapshot) console.log(`[recheck] lista CERT pominięta: ${cert.reason}`);
  const python = library.available ? library.python : null;
  const probes: RecheckProbes = {
    dns: async (domain) => {
      const r = await resolveDns(domain, { types: ["A"], cache: false });
      return { addresses: r.a, error: r.errors.A ?? null };
    },
    certStatus: cert.snapshot ? (domain) => certStatus(cert.snapshot, domain, new Date()) : null,
    adLibrary: python
      ? async (id) => {
          const info = (await lookupAdLibrary([id], { python }))[id];
          return { takenDown: info?.takenDown ?? null, error: info?.error ?? null };
        }
      : null,
  };
  const entries = await recheckEntries(json, probes);
  json.integrity.custody_log.push(...entries);
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
  console.log(`[recheck] dopisano ${entries.length} wpisów do custody_log w ${file}`);
});

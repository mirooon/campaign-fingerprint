/**
 * Which domains of a campaign go to the CERT Warning List and why: platforms and shorteners are
 * left out (the list protects against the operator's domains, not against the services they abuse),
 * and so are names already on the list (a repeated entry changes nothing). Pure; the status comes
 * from the local copy of the list (certList.ts), so it is as old as the copy.
 */
import { certStatus, type CertListSnapshot } from "./certList";

export interface CertDomainInput {
  domain: string;
  /** Hosts seen under the domain (may include the domain itself). */
  hosts: string[];
  /** Reason the domain is not reported at all (platform, shortener), null for an operator's domain. */
  excludedReason: string | null;
  /** Ads of the campaign whose chain leads through the domain. */
  ads: number;
  /** A landing page was fetched from the domain (it is not only a hop of a redirect). */
  landing: boolean;
}

export interface CertDomainLine {
  name: string;
  /** One-sentence justification for the person filling in the form. */
  reason: string;
}

export interface CertDomainPlan {
  /** Names to report, domain first, then its other hosts. */
  report: CertDomainLine[];
  /** Names left out because they are already on the list (with the entry). */
  alreadyListed: CertDomainLine[];
  /** Ads whose chain leads to a domain already on the list. */
  adsToListed: number;
}

/** Date part of an ISO time for a reader; "?" when missing. */
const day = (iso: string | null): string => (iso ? iso.slice(0, 10) : "?");

/** Plan of the CERT report for the domains of one campaign; `note` explains a missing copy of the list. */
export function planCertDomains(domains: CertDomainInput[], snapshot: CertListSnapshot | null, now: Date, note: string | null = null): CertDomainPlan {
  const plan: CertDomainPlan = { report: [], alreadyListed: [], adsToListed: 0 };
  for (const d of domains) {
    if (d.excludedReason) continue;
    const role = d.landing ? "strona docelowa" : "pośrednik w łańcuchu przekierowań";
    for (const name of [d.domain, ...d.hosts.filter((h) => h !== d.domain)]) {
      const st = certStatus(snapshot, name, now);
      if (st.status === "active") {
        plan.alreadyListed.push({ name, reason: `już na liście od ${day(st.insertDate)} (RegisterPositionId ${st.registerPositionId ?? "?"}, kopia z ${day(st.copyUtc)}): nie zgłaszać ponownie` });
        continue;
      }
      const listState =
        st.status === "removed"
          ? `wpis wygasł ${day(st.deleteDate)}, można zgłosić ponownie`
          : st.status === "absent"
            ? `brak wpisu w kopii listy z ${day(st.copyUtc)}`
            : `lista niesprawdzona (${note ?? "brak kopii"})`;
      plan.report.push({ name, reason: `${role}, ${d.ads} ${d.ads === 1 ? "reklama" : "reklam(y)"} kampanii; ${listState}` });
    }
    if (certStatus(snapshot, d.domain, now).status === "active") plan.adsToListed += d.ads;
  }
  return plan;
}

/** Markdown with the reason for every domain, next to the plain cert-domains.txt (the form takes plain names only). */
export function renderCertReasons(plan: CertDomainPlan, campaignId: string): string {
  const lines = (list: CertDomainLine[]) => list.map((l) => `- \`${l.name}\` — ${l.reason}`).join("\n") || "- brak";
  return `# Domeny do zgłoszenia na Listę Ostrzeżeń CERT — kampania ${campaignId}

Uzasadnienia do pliku \`cert-domains.txt\` (formularz przyjmuje do 50 domen na zgłoszenie). Status z lokalnej kopii listy, bez zapytań online.

## Do zgłoszenia

${lines(plan.report)}

## Pominięte: już na liście

${lines(plan.alreadyListed)}
`;
}

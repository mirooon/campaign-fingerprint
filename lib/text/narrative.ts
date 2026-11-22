/**
 * Narrative of a material (B-187): what the ad is about (topic: investment, subsidy, health ...), the
 * form of its hook (a false sensation, an endorsement, a fake interview) and the cues of the IHC rule
 * (promise of profit, invitation to a group). An attribute of the material and a trait of a group of
 * campaigns, never evidence of a campaign: one operator switches topics after the news of the week and
 * unrelated operators share them, so nothing here enters the graph's pivots or campaignScore. No risk
 * score either.
 *
 * Terms are folded (lower case, no diacritics) and matched at word starts: "swiadczeni*" finds
 * "świadczenie" but not "doświadczenie". A word ending in "*" is a stem (any Polish ending), any other
 * word must match whole; words of a phrase are separated by white space or punctuation.
 */
import { foldDiacritics } from "./normalize";

export interface NarrativeConfig {
  /** Topic id -> terms; `sub` names subcategories (e.g. health: joints, vision) with their own terms. */
  topics: Record<string, { terms: string[]; sub?: Record<string, string[]> }>;
  /** Form of the hook, independent of the topic (B-294). */
  hooks: Record<string, string[]>;
  /** Promise of profit (IHC rule; also the "investment" cue of the evidence pack). */
  profitPromise: string[];
  /** Invitation to a group or a messenger (IHC rule). */
  groupInvite: string[];
  /** A hit in the headline (page title, og:title, CTA, first line of the ad) counts this many times. */
  headlineWeight: number;
  /** Body text beyond this many characters is not read (long page texts: comments, footers). */
  maxBodyChars: number;
  /** Two members of one campaign whose main topics differ within this many days: "one operator, two narratives". */
  switchWindowDays: number;
  /** Topics that offer a financial service (the KNF action of the evidence pack). */
  financialTopics: string[];
}

export const DEFAULT_NARRATIVE_CONFIG: NarrativeConfig = {
  topics: {
    investment: {
      terms: ["inwestyc*", "inwestow*", "inwestuj*", "inwestor*", "zarob*", "zarabia*", "zysk*", "dywidend*", "kryptowalut*", "bitcoin*", "gield*", "gieldow*", "trader*", "trading*", "forex", "broker*", "pasywn* dochod*", "platform* inwestycyjn*"],
    },
    subsidy: { terms: ["dotacj*", "dofinansowan*", "doplat*", "swiadczeni*", "zasilek", "zasilk*", "rekompensat*", "zwrot* podatk*", "bon* energetyczn*"] },
    health: {
      terms: ["zdrowi*", "lekarz*", "lek", "leki", "lekow*", "kuracj*", "chorob*", "schorzen*", "suplement*", "doktor*", "kardiolog*", "ortoped*", "cudown* lek*"],
      sub: {
        joints: ["staw", "stawy", "stawow*", "stawach", "kolan*", "artretyzm*", "reumat*", "chrzastk*", "kregoslup*"],
        weight_loss: ["odchudz*", "schudn*", "schudl*", "nadwag*", "otylos*", "spalani* tluszcz*"],
        hypertension: ["nadcisnieni*", "cisnieni* krwi", "hipertensj*"],
        vision: ["wzrok*", "okulist*", "zacm*", "jaskr*", "dioptri*"],
        hearing: ["sluch*", "niedosluch*", "szum* w usz*"],
        diabetes: ["cukrzyc*", "insulin*", "glukoz*", "cukier we krwi"],
        miracle_cure: ["cudown* lek*", "cudown* srodek*", "przelom* w medycyn*", "lekarze nienawidz*"],
      },
    },
    gambling: { terms: ["kasyn*", "hazard*", "bukmacher*", "ruletk*", "jackpot*", "darmow* spin*", "free spin*", "automat* do gier"] },
    elections: { terms: ["wybory", "wyborach", "wyborami", "wyborow", "wyborc*", "kampani* wyborcz*", "kandydat*", "sondaz*", "glosowani*", "polityk*", "sejm*", "premier"] },
    ai_trading: { terms: ["sztuczn* inteligencj*", "ai", "platform* ai", "system* sam* analizuj*", "sam* analizuj* gield*", "algorytm*", "robot* inwestycyjn*", "bot* inwestycyjn*", "quantum"] },
    gold_reserve: { terms: ["zloto", "zlota", "zlotem", "zlocie", "rezerw* zlota", "sztabk*", "kruszc*"] },
    commodities_war: { terms: ["wojn*", "gaz", "gazu", "ropa", "ropy", "rope", "naft*", "surowc*", "podskoczyl*"] },
    leaked_secret: { terms: ["nie chca, by* ludzie wiedzieli", "nie chca, zeby*", "tajemnic*", "wyrwal* sie", "sekret*", "ukrywaj*", "zakazan*"] },
    testimonial_small_win: { terms: ["nastolat*", "zarobil* * tys*", "w ciagu dnia", "w jeden dzien", "pierwsz* wyplat*"] },
    recovery: { terms: ["odzyskan* srodk*", "odzyskaj*", "odzyska* pieniadz*", "kancelari*", "zwrot* srodk*", "oszukan*"] },
    sport_event: { terms: ["mundial*", "mistrzostw*", "olimpiad*", "turniej*"] },
    inauguration: { terms: ["zaprzysiez*", "objeci* urzedu", "objal* urzad"] },
    state_investment: { terms: ["baltic pipe", "orlen*", "pge", "spolk* skarbu panstwa", "inwestycj* panstwow*", "panstwow* inwestycj*"] },
    adult_phishing: { terms: ["18+", "dla doroslych", "potwierdzeni* wieku", "potwierdz* swoj* wiek"] },
    urgent_notice: { terms: ["pilne", "pilnie", "wezwani* do zaplaty"] },
    petition: { terms: ["petycj*"] },
    // funnels of the investigative sources (I28): terms in Polish, English and German, whole words where a stem
    // would hit another field ("wirusowe zapalenie", "police station")
    tech_support: {
      terms: [
        "wirus", "wirusa", "wirusem", "wirusy", "wirusow", "wirusie", "zainfekowan* komputer*", "zainfekowan* urzadzeni*", "zainfekowan* telefon*", "komputer* zainfekowan*", "urzadzeni* zainfekowan*", "telefon* zainfekowan*", "komputer* zablokowan*", "komputer* zostal* zablokowan*", "dzial* bezpieczenstwa", "zdaln* pomoc*", "zdaln* dostep*", "wsparci* technicz*", "pomoc* technicz*",
        "virus detected", "virus alert", "computer locked", "computer has been locked", "computer is locked", "pc infected", "technical support", "tech support", "remote assistance", "remote access", "security department", "malware*",
        "fernwartung*", "technischer support", "computer gesperrt",
      ],
    },
    refund_overpayment: {
      terms: ["zwrot* nadplat*", "nadplat*", "przelal* za duzo", "przelalismy za duzo", "przelalem za duzo", "pomylk* w kwocie", "zwrot* roznic*", "overpayment", "overpaid", "sent too much", "paid too much", "refund the difference", "zu viel ueberwiesen"],
    },
    recovery_offer: {
      terms: [
        "odzysk* utracon*", "odzyskamy", "odzyska* kryptowalut*", "odzyskuj* srodk*", "kancelari* odzyskuj*", "oplat* za odzyskan*", "odzyskan* utracon*",
        "recover* lost funds", "recover* your crypto*", "recover* stolen", "recovery fee", "fund recovery", "lost crypto*",
      ],
    },
    job_offer: {
      terms: [
        "prac* zdaln*", "rekruter*", "wysok* wynagrodzeni*", "latw* zadani*", "ocen* produkt*", "oceniaj* produkt*", "prowizj* za ocen*",
        "remote job", "work from home", "recruiter*", "easy tasks", "product rat*", "rate products", "nebenjob", "heimarbeit", "leicht* aufgaben", "hohes gehalt",
      ],
    },
    fake_authority: {
      terms: [
        "przekazan* do policji", "przekazan* do knf", "przekazan* do uodo", "przekazan* do cert*", "przekazan* do banku", "agent* policji", "agent* knf", "agent* fbi", "funkcjonariusz* policji", "numer* odznaki",
        "forwarded to the police", "transferred to the police", "forwarded to * bank", "special agent", "badge number", "polizeibeamt*", "dienstnummer",
      ],
    },
  },
  hooks: {
    sensation: ["zwolnion*", "zwolnil*", "w szpitalu", "postrzelon*", "aresztowan*", "zatrzyman*", "nie zyje", "zmarl*", "wpadk* na wizji", "powiedzial* za duzo", "skandal*", "pobit*", "smierc*"],
    endorsement: ["poleca", "polecil*", "namawia*", "zacheca*", "zdradzil* sposob*", "rekomend*"],
    fake_interview: ["wywiad*", "w rozmowie z", "rozmowa z", "w programie", "w studiu"],
    // pressure on the victim (I28): hide the scheme from the bank and family, pay a fee before the money is paid out, a lock deadline
    secrecy: [
      "nie mow* nikomu", "nie mow* bankowi", "nie mow* rodzin*", "nie informuj* banku", "nie informuj* rodziny", "to jest poufne", "to poufne", "bank* w zmowie", "powiedz* bankowi, ze*", "powiedz* bankowi ze*",
      "don't tell anyone", "do not tell anyone", "don't tell your bank", "do not tell your bank", "do not tell the bank", "keep this confidential", "bank is in on", "tell the bank it is",
    ],
    withdrawal_fee: [
      "podatek* przed wyplat*", "oplat* przed wyplat*", "oplat* za wyplat*", "odblokowan* srodk*", "oplat* weryfikacyjn*", "oplat* aktywacyjn*", "prowizj* od zysk*", "procent od zysk*",
      "tax before withdraw*", "withdrawal fee", "fee to unlock", "unlock your funds", "verification fee", "release fee", "pay a tax to withdraw",
    ],
    urgency_lock: [
      "konto* zostanie zablokowan*", "konto* bedzie zablokowan*", "zostanie zablokowan* w ciagu", "ostatnie ostrzezeni*", "ostateczne ostrzezeni*",
      "account will be locked", "account will be suspended", "will be blocked within", "final warning", "last warning",
    ],
  },
  profitPromise: ["zarob*", "zarabia*", "pasywn* dochod*", "x100", "x10", "zysk*", "tys* dziennie", "dziennie", "gwarantowan*", "podwoj*"],
  groupInvite: ["whatsapp*", "telegram*", "darmow* grup*", "moj* grup*", "dolacz* do grup*", "grup* inwestycyjn*", "kanal* na telegram*"],
  headlineWeight: 2,
  maxBodyChars: 20000,
  switchWindowDays: 7,
  financialTopics: ["investment", "ai_trading", "gold_reserve", "testimonial_small_win", "state_investment"],
};

export interface NarrativeText {
  /** Page title, og:title, CTA or the first line of the ad: hits count `headlineWeight` times. */
  headline?: string | null;
  /** Ad copy, OCR of the creative, transcript, visible page text. */
  body?: string | null;
}

export interface NarrativeTopic {
  id: string;
  /** Hits, headline hits counted `headlineWeight` times. */
  score: number;
  /** Folded terms that matched (for the reviewer: why this topic). */
  terms: string[];
  subtopics?: string[];
}

export interface Narrative {
  /** Topics with at least one hit, highest score first. */
  topics: NarrativeTopic[];
  /** Forms of the hook found (sensation, endorsement, fake_interview). */
  hooks: string[];
  /** Folded terms of a promise of profit. */
  profitPromise: string[];
  /** Folded terms of an invitation to a group or messenger. */
  groupInvite: string[];
  /** Amounts of money named with a currency ("od 1 000 zł", "250 EUR", "$300"), in text order (B-189); never a pivot. */
  amounts: number[];
}

type Compiled = { term: string; re: RegExp };
const cache = new WeakMap<NarrativeConfig, Map<string, Compiled[]>>();

/** Regex of one term: word start, stems ("abc*") take any letters, words joined by spaces or punctuation. */
function termRegex(term: string): RegExp {
  const words = term.split(/\s+/).map((w) => {
    if (w === "*") return "\\p{L}+";
    const stem = w.endsWith("*");
    const body = (stem ? w.slice(0, -1) : w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return stem ? `${body}\\p{L}*` : `${body}(?![\\p{L}\\p{N}])`;
  });
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.join("[\\s,.:;!?-]+")}`, "gu");
}

/** Compiled regexes of a list of terms, cached per config object. */
function compiled(config: NarrativeConfig, key: string, terms: string[]): Compiled[] {
  let byKey = cache.get(config);
  if (!byKey) cache.set(config, (byKey = new Map()));
  let list = byKey.get(key);
  if (!list) byKey.set(key, (list = terms.map((term) => ({ term, re: termRegex(foldDiacritics(term).toLowerCase()) }))));
  return list;
}

/** Hits of a term list in the headline and body (headline weighted) and the terms that matched. */
function hits(list: Compiled[], headline: string, body: string, weight: number): { score: number; terms: string[] } {
  let score = 0;
  const terms: string[] = [];
  for (const { term, re } of list) {
    const h = headline.match(re)?.length ?? 0;
    const b = body.match(re)?.length ?? 0;
    if (h + b === 0) continue;
    score += h * weight + b;
    terms.push(term);
  }
  return { score, terms };
}

const CURRENCY_AFTER = /(?<![\p{L}\p{N}])(\d{1,3}(?:[ \u00a0.]\d{3})+|\d+)(?:[.,]\d{1,2})?\s?(zl|zlotych|zlote|pln|eur|euro|usd|dolarow|€|\$)(?![\p{L}])/gu;
const CURRENCY_BEFORE = /(?<![\p{L}\p{N}])(?:\$|€)\s?(\d{1,3}(?:[ \u00a0,]\d{3})+|\d+)(?![\p{N}])/gu;

/** Amounts with a currency in folded text, in text order: "1 000 zl" → 1000, "$300" → 300. Bare numbers (years, counts) are not amounts. */
function moneyAmounts(folded: string): number[] {
  const found: Array<{ at: number; value: number }> = [];
  for (const m of folded.matchAll(CURRENCY_AFTER)) found.push({ at: m.index ?? 0, value: Number(m[1].replace(/[ \u00a0.]/g, "")) });
  for (const m of folded.matchAll(CURRENCY_BEFORE)) found.push({ at: m.index ?? 0, value: Number(m[1].replace(/[ \u00a0,]/g, "")) });
  return found.sort((a, b) => a.at - b.at).map((f) => f.value).filter((v) => Number.isFinite(v) && v > 0);
}

/**
 * Narrative of a material from its headline and body text (any may be missing). Returns null when no
 * topic, hook, promise or invitation is found. Pure; the result is an attribute, never a pivot.
 */
export function detectNarrative(text: NarrativeText, config: NarrativeConfig = DEFAULT_NARRATIVE_CONFIG): Narrative | null {
  const headline = foldDiacritics(text.headline ?? "").toLowerCase();
  const body = foldDiacritics((text.body ?? "").slice(0, config.maxBodyChars)).toLowerCase();
  if (!headline.trim() && !body.trim()) return null;
  const topics: NarrativeTopic[] = [];
  for (const [id, def] of Object.entries(config.topics)) {
    const main = hits(compiled(config, `t:${id}`, def.terms), headline, body, config.headlineWeight);
    const subtopics: string[] = [];
    let subScore = 0;
    for (const [sub, terms] of Object.entries(def.sub ?? {})) {
      const s = hits(compiled(config, `s:${id}:${sub}`, terms), headline, body, config.headlineWeight);
      if (s.score > 0) {
        subtopics.push(sub);
        subScore += s.score;
      }
    }
    if (main.score + subScore === 0) continue;
    topics.push({ id, score: main.score + subScore, terms: main.terms, ...(subtopics.length ? { subtopics } : {}) });
  }
  topics.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const hooks = Object.entries(config.hooks)
    .filter(([kind, terms]) => hits(compiled(config, `h:${kind}`, terms), headline, body, 1).score > 0)
    .map(([kind]) => kind);
  const profitPromise = hits(compiled(config, "profit", config.profitPromise), headline, body, 1).terms;
  const groupInvite = hits(compiled(config, "invite", config.groupInvite), headline, body, 1).terms;
  const amounts = moneyAmounts(`${headline}\n${body}`);
  if (!topics.length && !hooks.length && !profitPromise.length && !groupInvite.length && !amounts.length) return null;
  return { topics, hooks, profitPromise, groupInvite, amounts };
}

/**
 * Sentence of `text` (at most `maxLen` characters, in its original spelling) holding the first hit of a
 * topic's terms, for a quote next to a conclusion ("financial service offered"); null without a hit.
 */
export function topicQuote(text: string, topicId: string, config: NarrativeConfig = DEFAULT_NARRATIVE_CONFIG, maxLen = 200): string | null {
  const def = config.topics[topicId];
  if (!def) return null;
  const sentences = text.slice(0, config.maxBodyChars).split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const terms = compiled(config, `t:${topicId}`, def.terms);
  for (const sentence of sentences) {
    const folded = foldDiacritics(sentence).toLowerCase();
    if (terms.some(({ re }) => folded.match(re))) return sentence.length > maxLen ? `${sentence.slice(0, maxLen - 1)}…` : sentence;
  }
  return null;
}

/**
 * Label of the IHC rule, an attribute and not a risk score: a persona from the list AND (a promise of
 * profit OR an invitation to a group OR a forged medium, e.g. a cloned news portal) gives
 * "celeb_bait_investment"; anything less gives null.
 */
export function celebBaitLabel(narrative: Narrative | null, context: { persona: boolean; fakeMedia: boolean }): "celeb_bait_investment" | null {
  if (!context.persona) return null;
  const cue = (narrative?.profitPromise.length ?? 0) > 0 || (narrative?.groupInvite.length ?? 0) > 0 || context.fakeMedia;
  return cue ? "celeb_bait_investment" : null;
}

/** Narrative of one material as stored on its item node: the detection, the label and the material's date. */
export interface MaterialNarrative extends Narrative {
  label?: "celeb_bait_investment";
  /** Date of the material (first seen), so a group can show when its topics changed. */
  date: string | null;
}

/** Narratives of a campaign or a group of campaigns: counts per topic with dates, hooks, labels, topic switches. */
export interface NarrativeSummary {
  /** Main topic of each member (its highest-scoring topic), with member counts and the first and last date. */
  topics: Array<{ id: string; count: number; firstSeen: string | null; lastSeen: string | null; subtopics?: string[] }>;
  hooks: Array<{ id: string; count: number }>;
  labels: Array<{ id: string; count: number }>;
  /**
   * Consecutive members (by date) whose main topics differ within `switchWindowDays`: on one campaign's
   * infrastructure this reads "one operator, two narratives". A description, never evidence.
   */
  switches: Array<{ from: string; to: string; fromDate: string; toDate: string; days: number }>;
}

/** Counts of ids, highest first (ties by id). */
function countIds(ids: string[]): Array<{ id: string; count: number }> {
  const m = new Map<string, number>();
  for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
  return [...m.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

/**
 * Summary of the narratives of several materials (members of a campaign or of a group). Takes the stored
 * narratives (missing ones skipped) and returns null when none has a narrative. Dates are ISO strings.
 */
export function summarizeNarratives(narratives: Array<MaterialNarrative | null | undefined>, config: NarrativeConfig = DEFAULT_NARRATIVE_CONFIG): NarrativeSummary | null {
  const list = narratives.filter((n): n is MaterialNarrative => !!n);
  if (!list.length) return null;
  const byTopic = new Map<string, { count: number; dates: string[]; subtopics: Set<string> }>();
  for (const n of list) {
    const main = n.topics[0];
    if (!main) continue;
    const cur = byTopic.get(main.id) ?? { count: 0, dates: [], subtopics: new Set<string>() };
    cur.count++;
    if (n.date) cur.dates.push(n.date);
    for (const s of main.subtopics ?? []) cur.subtopics.add(s);
    byTopic.set(main.id, cur);
  }
  const topics = [...byTopic.entries()]
    .map(([id, v]) => {
      const dates = v.dates.sort();
      return { id, count: v.count, firstSeen: dates[0] ?? null, lastSeen: dates[dates.length - 1] ?? null, ...(v.subtopics.size ? { subtopics: [...v.subtopics].sort() } : {}) };
    })
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  const dated = list
    .filter((n) => n.topics[0] && n.date && !Number.isNaN(Date.parse(n.date)))
    .sort((a, b) => a.date!.localeCompare(b.date!));
  const switches: NarrativeSummary["switches"] = [];
  for (let i = 1; i < dated.length; i++) {
    const [p, q] = [dated[i - 1], dated[i]];
    if (p.topics[0].id === q.topics[0].id) continue;
    const days = Math.round((Date.parse(q.date!) - Date.parse(p.date!)) / 86_400_000);
    if (days <= config.switchWindowDays) switches.push({ from: p.topics[0].id, to: q.topics[0].id, fromDate: p.date!, toDate: q.date!, days });
  }
  return { topics, hooks: countIds(list.flatMap((n) => n.hooks)), labels: countIds(list.flatMap((n) => (n.label ? [n.label] : []))), switches };
}

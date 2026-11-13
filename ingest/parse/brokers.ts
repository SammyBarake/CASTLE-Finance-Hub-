/**
 * Each side's banks as the merger agreement states them: its "Brokers" representations, which a merger proxy reprints in
 * full as Annex A. The target's reads "Except for Centerview and TD Cowen, … neither the Company nor any Company Subsidiary
 * has employed any investment banker, broker or finder …"; the buyer's the same with "Parent". Releases and proxy stories
 * name banks loosely and sometimes on the wrong side (Tempus / Personalis credited Morgan Stanley, Tempus's bank, to
 * Personalis; Bowhead's buyer's bank KBW to Bowhead); the agreement is the parties' own word on whose bank is whose.
 */
import { findBanks } from "../../lib/banks";

export interface BrokerBanks {
  /** Banks the buyer's representation names (Parent, Purchaser, Buyer, Acquiror). */
  acquirer: string[];
  /** Banks the target's representation names (the Company). */
  target: string[];
}

// "Section 4.21 Brokers.", "3.22 Brokers and Finders.", "Section 5.18 Finders or Brokers.", "Section 4.24 Brokers' Fees.",
// "2.15. Brokers' and Advisors' Fees.", "Section 6.9 Brokerage Fees.", "Section 4.16 No Brokers.": a numbered heading, a
// few heading words, then its stop. The proxy's own summary ("Brokers" in a list of the representations) has no number.
const HEAD = /(?:\bSection\s+|(?<![\w.])\(?)\d{1,2}\.\d{1,2}(?:\([a-z]\))?\)?\s*\.?\s*(?:No\s+)?(?:Brokers?|Finders?|Brokerage)\b(?:['’]s?|['’])?(?:[ ,;&]+(?:and|or|Other|Fees?|Finders?|Brokers?|Advisors?|Investment|Bankers?|Commissions?|Expenses|Financial)(?:['’]s?|['’])?){0,5}\s*[.:;]/g;

const BUYER_TERMS = ["Parent", "Purchaser", "Buyer", "Acquiror", "Acquirer", "Bidder", "Holdco", "Merger Sub"];
/** The terms an agreement defines its target by: `Enable Midstream Partners, LP … (the "Partnership")`. */
const TARGET_TERMS = ["Company", "Partnership", "Trust", "REIT"];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alt = (terms: string[]) => terms.map((t) => esc(t).replace(/ /g, String.raw`\s+`)).join("|");

/**
 * A party's term as the agreement uses it: capitalised, and not the end of a firm's name ("Allen & Company", "Moelis &
 * Company LLC", "Keefe, Bruyette & Woods, Inc., a Stifel Company") nor the start of another defined term ("the Company
 * Financial Advisor", "the Company Board", "Company Disclosure Letter"), which either side's clause can name.
 */
const term = (terms: string[]) =>
  String.raw`(?<!\b(?!(?:The|Neither|Nor|None|No|Each|Either|Both|Other|Except|Unless|Any|All|Such|In|For|By|To)\s)[A-Z]\w*\s)(?<!&\s?)\b(?:${alt(terms)})\b(?!\s+(?:Financial\s+Advisors?|Board|Disclosure|Stockholders?|Shareholders?|Unitholders?|Equityholders?|Equity\s+Holders?|Holders?|Members?|Sellers?|Subsidiar(?:y|ies)\s+(?:has|have)\s+not)\b)`;
// "the Company Equityholder has not … other than Piper Sandler" is a holder's representation, not the company's (Lawson /
// TestEquity, where the record's buyer was that holder).

/**
 * Whose representation a clause is. First the words that say who engaged the bank: "based upon arrangements made by or on
 * behalf of Parent" (not "fees … from the Company" before it: Extra Space / Life Storage), "retained by or … on behalf of
 * Parent", "the engagement of Stephens Inc. by Parent", "neither the Company nor …", "which the Company has retained".
 * Phrases about the other side don't count ("a copy of whose engagement letter has been made available to Parent").
 * Then, with none of those, the first party named. Null when the clause names neither, or the cues disagree.
 */
function subjectOf(body: string, sides: { buyer: string[]; target: string[] }): "acquirer" | "target" | null {
  const opening = body.slice(0, 480);
  const B = term(sides.buyer);
  const T = term(sides.target);
  const either = String.raw`(?:the\s+)?(?:(${B})|(${T}))`;
  const cues = [
    String.raw`\b(?:arrangements?|agreements?|understandings?)\s+(?:made|entered\s+into)\s+by\s+(?:or\s+on\s+behalf\s+of\s+)?${either}`,
    String.raw`\b(?:retained|engaged|employed)\s+by\s+(?:or\s+(?:is\s+)?(?:authorized\s+to\s+act\s+)?on\s+behalf\s+of\s+)?${either}`,
    String.raw`\bengagement\s+(?:by\s+${either}\s+)?of\s+[^.]{0,120}?\bby\s+${either}`,
    String.raw`\b(?:acting|act)\s+(?:for|on\s+behalf\s+of)\s+${either}`,
    String.raw`\bneither\s+${either}`,
    String.raw`\bnone\s+of\s+${either}`,
    String.raw`${either}\s+(?:has\s+|have\s+)?(?:retained|engaged|employed)\b`,
  ];
  // The bank defined as one side's adviser settles it: `Morgan Stanley & Co. LLC (the "Parent Financial Advisor") … based
  // upon arrangements made by or on behalf of the Company` (Alumis / ACELYRIN: the agreement's own slip in the cue).
  const adviser = new RegExp(String.raw`\(\s*(?:the\s+)?["“”]\s*(?:(${alt(sides.buyer)})|(${alt(sides.target)}))\s+(?:Financial\s+Advis[eo]rs?|Advis[eo]rs?|Banker)\s*["“”]\s*\)`).exec(opening);
  if (adviser) return adviser[1] ? "acquirer" : "target";
  const votes = new Set<"acquirer" | "target">();
  const masked = opening
    .replace(new RegExp(String.raw`\b(?:made\s+available|provided|delivered|furnished|disclosed|shown)\s+(?:prior\s+to\s+the\s+date\s+(?:hereof|of\s+this\s+Agreement)\s+)?to\s+${either}`, "g"), " ")
    // "… from any of the Transferred Entities … for which Purchaser or any of its Affiliates would have any Liability": who is protected, not who engaged.
    .replace(new RegExp(String.raw`\bfor\s+which\s+${either}[^.]{0,120}?\b(?:would|will|shall|could|may)?\s*(?:have|has|be|become)\s+(?:any\s+)?(?:[Ll]iab|[Oo]blig|[Rr]espons)`, "g"), " ");
  for (const cue of cues) {
    for (const m of masked.matchAll(new RegExp(cue, "g"))) {
      // Groups come in pairs (buyer, target) per party slot; the last filled slot is the one the cue is about.
      const groups = m.slice(1);
      for (let i = groups.length - 2; i >= 0; i -= 2) {
        if (groups[i] !== undefined) { votes.add("acquirer"); break; }
        if (groups[i + 1] !== undefined) { votes.add("target"); break; }
      }
    }
  }
  if (votes.size === 1) return [...votes][0];
  if (votes.size > 1) return null;
  for (const m of masked.matchAll(new RegExp(String.raw`(${B})|(${T})`, "g"))) return m[1] ? "acquirer" : "target";
  return null;
}

/**
 * The banks each side's brokers representation names. Read only when the text defines the target itself as "the Company"
 * (or "the Partnership", or by its own name: `Umpqua Holdings Corporation ("Umpqua")`): otherwise the agreement may be
 * another deal's, or this record read the other way round, and its clauses say nothing about this record's sides. A buyer
 * the agreement calls by its own name counts when defined so too (`Columbia Banking System, Inc. ("Columbia")`).
 */
export function brokerBanks(text: string, opts: { targetName: string; acquirerName?: string }): BrokerBanks {
  const out: BrokerBanks = { acquirer: [], target: [] };
  const flat = text.replace(/\s+/g, " ");
  // Every term the text defines for the target: a proxy calls it "Spirit" in its own pages and the annexed agreement "the Company".
  const targetTerms = definedTerms(flat, opts.targetName, [...TARGET_TERMS, ...ownNames(opts.targetName)]);
  if (!targetTerms.length) return out;
  const buyerOwn = opts.acquirerName ? definedTerms(flat, opts.acquirerName, ownNames(opts.acquirerName)) : [];
  if (buyerOwn.some((t) => targetTerms.includes(t))) return out;
  // "based upon arrangements made by or on behalf of any Acquired Company" (Conformis).
  const sides = { buyer: [...BUYER_TERMS, ...buyerOwn], target: [...targetTerms, "Acquired Company", "Acquired Companies", "Target Company", "Target Companies"] };
  const conflict = new Set<string>();
  // A bank the proxy defines for a financing role is named in a clause for that ("the other transactions" took in Warburg
  // Pincus's investment in OceanFirst, whose "Placement Agent" was J.P. Morgan), not as an adviser on the merger.
  const financingRole = new Set<string>();
  for (const m of flat.matchAll(/["“”]\s*(?:Placement\s+Agents?|Underwriters?|Dealer\s+Managers?|(?:Lead\s+)?Arrangers?|Lenders?|Initial\s+Purchasers?)\s*["“”]\s*\)/g)) {
    findBanks(flat.slice(Math.max(0, m.index! - 160), m.index!)).forEach((b) => financingRole.add(b));
  }
  // Which party each "the Company" belongs to, in order: a clause is governed by the nearest definition before it.
  const companyDefs = definitions(flat, opts.targetName, TARGET_TERMS);
  for (const m of flat.matchAll(HEAD)) {
    const at = m.index! + m[0].length;
    // Another agreement's clause, whose "Company" is another party (Lawson's annex: TestEquity Acquisition, LLC).
    const governing = companyDefs.filter((d) => d.at < m.index!).at(-1);
    if (governing && !governing.ours) continue;
    // To the next numbered section; a contents line ("Section 3.22 Broker's Fees A-24 Section 3.23 …") has no body.
    // Nor across an article's heading ("SECTION 4 REPRESENTATIONS AND WARRANTIES OF PARENT …").
    const body = flat.slice(at, at + 900).split(/\s(?:Section\s+)?\d{1,2}\.\d{1,2}(?:\([a-z]\))?\.?\s+[A-Z]|\s(?:ARTICLE|SECTION)\s+(?:[IVX]+|\d+)\b|\bTABLE OF CONTENTS\b/)[0];
    if (body.length < 40 || !/\b(?:broker|finder|investment bank|financial advis)/i.test(body)) continue;
    const banks = findBanks(body.slice(0, 420)).filter((b) => !hiredByAPerson(body.slice(0, 420), b, [...sides.buyer, ...sides.target]) && !financingRole.has(b));
    if (!banks.length) continue;
    const side = subjectOf(body, sides);
    if (!side) continue;
    const other = side === "acquirer" ? "target" : "acquirer";
    for (const b of banks) {
      if (out[other].includes(b)) conflict.add(b);
      if (!out[side].includes(b)) out[side].push(b);
    }
  }
  // A bank both sides name (a proxy reprinting two agreements, a misread) is no evidence for either.
  return { acquirer: out.acquirer.filter((b) => !conflict.has(b)), target: out.target.filter((b) => !conflict.has(b)) };
}

/**
 * "Moelis & Company LLC, which has been retained by Pamela Lopker, the founder and President of the Company" (QAD): a bank a
 * person or holder hired is that person's, not the party's. A party, its board or a committee hiring it is the party's.
 */
function hiredByAPerson(clause: string, bank: string, parties: string[]): boolean {
  const at = findBanks(clause).indexOf(bank) < 0 ? -1 : clause.search(new RegExp(esc(bank.split(" ")[0]), "i"));
  if (at < 0) return false;
  const after = clause.slice(at, at + 140).split(/[;)]|\(i+\)|,\s+and\s+\(/)[0];
  const m = /\b(?:retained|engaged|employed)\s+by\s+(?:the\s+)?([A-Z][\w.&'’-]*(?:\s+[A-Z][\w.&'’-]*){0,3})/.exec(after);
  if (!m) return false;
  return !new RegExp(String.raw`^(?:${alt(parties)}|Special|Transaction|Conflicts|Independent|Board|Committee)\b`).test(m[1]);
}

const firstWord = (name: string) => name.replace(/^the\s+/i, "").split(/[\s,]+/)[0].replace(/[^\w&.-]/g, "");

/** A party's own name as an agreement may define it: its first one, two or three words ("Umpqua", "Green Dot", "Columbia"). */
function ownNames(name: string): string[] {
  const words = name.replace(/^the\s+/i, "").split(/[\s,]+/).map((w) => w.replace(/[^\w&.-]/g, "")).filter(Boolean);
  return [1, 2, 3].filter((n) => words.length >= n).map((n) => words.slice(0, n).join(" "));
}

/**
 * Where a party is defined, and by which of `terms`: `Personalis, Inc., a Delaware corporation (the "Company")`, `Enable
 * Midstream Partners, LP … (the "Partnership")`, `Umpqua Holdings Corporation, an Oregon corporation ("Umpqua")`. The
 * party's first word within 200 characters before the definition, with no other party's definition between: in "Lawson
 * Products, Inc. ("Parent"), … TestEquity Acquisition, LLC (the "Company")" the Company is TestEquity, not Lawson. The
 * text may space the quotes (`( the " Company " )`).
 */
export function definedTerms(flat: string, name: string, terms: string[]): string[] {
  return [...new Set(definitions(flat, name, terms).filter((d) => d.ours).map((d) => d.term))];
}

/**
 * Every definition of `terms` in the text, marked `ours` when it is this party's and not when another named party's
 * ("TestEquity Acquisition, LLC (the "Company")" in Lawson's annex; Crescent Energy Company in a management agreement).
 * A definition too far from any name counts as not ours.
 */
function definitions(flat: string, name: string, terms: string[]): { at: number; term: string; ours: boolean }[] {
  const word = firstWord(name).toLowerCase();
  const usable = terms.filter((t) => t.length >= 3 && /^[A-Z]/.test(t));
  if (word.length < 2 || !usable.length) return [];
  const named = new RegExp(String.raw`(?:^|[^\w])${esc(word)}(?![\w])`, "g");
  const def = new RegExp(String.raw`\(\s*(?:the\s+)?["“”]\s*(${alt(usable)})\s*["“”]\s*(?:\)|,|or\b)`, "g");
  const out: { at: number; term: string; ours: boolean }[] = [];
  for (const m of flat.matchAll(def)) {
    const before = flat.slice(Math.max(0, m.index! - 200), m.index!);
    const last = [...before.toLowerCase().matchAll(named)].at(-1);
    // Not ours is someone else's, or can't be told: either way a clause under it says nothing about this deal for sure.
    out.push({ at: m.index!, term: m[1], ours: !!last && !/\(\s*(?:the\s+)?["“”]/.test(before.slice(last.index!)) });
  }
  return out;
}

/** Whether the target is defined as "the Company" or another target term (for the scan scripts). */
export const companyDefinedAt = (flat: string, targetName: string) => definedTerms(flat, targetName, [...TARGET_TERMS, ...ownNames(targetName)]).length > 0;

/** Two readings of each side's banks together; a bank one puts on each side is left out. */
export function sidesAgreed(...readings: BrokerBanks[]): BrokerBanks {
  const a = [...new Set(readings.flatMap((r) => r.acquirer))], t = [...new Set(readings.flatMap((r) => r.target))];
  return { acquirer: a.filter((b) => !t.includes(b)), target: t.filter((b) => !a.includes(b)) };
}

/**
 * Put each bank on the side the agreement gives it: a bank its buyer's clause names (and the target's doesn't) leaves the
 * target's list for the buyer's, and the other way round; one the lists lack joins its side. Never against a fairness
 * opinion the bank gave the other side's board. Returns true when a list changed.
 */
export function applyAgreementBanks(
  d: { acquirerAdvisors: string[]; targetAdvisors: string[]; fairness?: { bank: string | null; side: "target" | "acquirer" }[] },
  b: BrokerBanks | null | undefined,
): boolean {
  if (!b || (!b.acquirer.length && !b.target.length)) return false;
  const before = JSON.stringify([d.acquirerAdvisors, d.targetAdvisors]);
  const opined = (bank: string, side: "target" | "acquirer") => (d.fairness ?? []).some((o) => o.bank === bank && o.side === side);
  for (const bank of b.acquirer) {
    if (b.target.includes(bank) || opined(bank, "target")) continue;
    d.targetAdvisors = d.targetAdvisors.filter((x) => x !== bank);
    if (!d.acquirerAdvisors.includes(bank)) d.acquirerAdvisors = [...d.acquirerAdvisors, bank];
  }
  for (const bank of b.target) {
    if (b.acquirer.includes(bank) || opined(bank, "acquirer")) continue;
    d.acquirerAdvisors = d.acquirerAdvisors.filter((x) => x !== bank);
    if (!d.targetAdvisors.includes(bank)) d.targetAdvisors = [...d.targetAdvisors, bank];
  }
  return JSON.stringify([d.acquirerAdvisors, d.targetAdvisors]) !== before;
}

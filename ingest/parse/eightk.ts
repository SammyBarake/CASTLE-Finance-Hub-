/**
 * Extract a merger from the legal "Item 1.01 Entry into a Material Definitive Agreement"
 * section of an 8-K. Catches deals announced without a press-release exhibit, and
 * names the parties through the agreement's defined terms ("Parent", "Merger Sub", "the Company").
 */
import { flatten } from "../text";
import type { Consideration } from "../../lib/types";
import { cleanPartyName, isPlausibleName, sameCompany } from "./names";
import { extractConsideration, extractValue, type ParsedPress, type PressContext } from "./press";

interface Entity {
  name: string;
  nick: string;
  /** Second defined term, e.g. (the "Company" or "Udemy"). */
  alias?: string;
  index: number;
}

/** The Item 1.01 section, or null if the 8-K doesn't describe a merger agreement. */
export function item101(text: string): string | null {
  const t = flatten(text);
  // "Item 1.01 Entry into…", "Item 1.01. Entry…", "Item 1.01 - Entry…"
  const start = t.search(/Item\s*1\.01[\s.:\-–—]*Entry into (?:a )?Material Definitive Agreement/i);
  if (start < 0) return null;
  const rest = t.slice(start + 20);
  const end = rest.search(/Item\s*(?:1\.02|2\.0\d|3\.0\d|5\.0\d|7\.01|8\.01|9\.01)\b/i);
  // EDGAR HTML often pads defined terms: (the " Company ") -> (the "Company").
  const section = t
    .slice(start, start + 20 + (end > 0 ? end : 12_000))
    .replace(/["“]\s+([A-Z][^"”]{0,39}?)\s+["”]/g, '"$1"')
    .replace(/(\w) \.(?=[\s,])/g, "$1.")
    // "Merger Sub will merge (the "Merger") with and into the Company": the defined term splits the verb from its object.
    .replace(/\b(merge[ds]?)\s*\([^()]{1,60}\)\s*(?=with\s+and\s+into)/gi, "$1 ")
    // "Magellan Midstream Partners, L.P. (NYSE: MMP), a Delaware limited partnership": a listing between a name and its
    // description hides the name from the defined-term pattern.
    .replace(/\s*\((?:NYSE|NASDAQ|Nasdaq|NYSE American|Cboe|CBOE)(?:\s?[A-Z]{1,3})?\s?:\s?[A-Z.]{1,6}\)/g, "");
  // UK / Irish targets are bought under a "Transaction Agreement" by a scheme of arrangement (Horizon, Nielsen).
  if (!/Agreement and Plan of Merger|Merger Agreement|Arrangement Agreement|Plan of Arrangement|Transaction Agreement|Implementation Agreement|scheme of arrangement/i.test(section)) return null;
  if (!/merge[ds]? with and into|merger of .{1,60} with and into|tender offer|exchange offer|plan of arrangement|scheme of arrangement|amalgamat|be acquired by|(?:will|shall) acquire\s+(?:all\s+of\s+)?(?:the\s+)?(?:issued\b|outstanding\b|[A-Z])/i.test(section)) return null;
  return section;
}

/** Legal phrasing that shows a capture is a clause, not a company name. */
const CLAUSE = /\b(?:will|shall|with and into|Merger Agreement|Pursuant|Section|approved|effective time|continuing|surviving|thereof|thereunder|commence|if any|converted|Act of)\b/i;

/**
 * Defined parties: `Acme Corp., a Delaware corporation ("Parent")`. The description may hold one short parenthesis:
 * `Just Eat Takeaway.com N.V., a public limited liability company (naamloze vennootschap) incorporated under the laws
 * of the Netherlands ("Parent")`, which used to leave "Netherlands" as the name.
 */
export function definedEntities(s: string): Entity[] {
  const out: Entity[] = [];
  // A name starts with a capital, or is a lower-case web name ("salesforce.com, inc.").
  const re = /([A-Z][A-Za-z0-9&.,'’\- ]{1,90}?|\b[a-z][\w-]*\.(?:com|net|io|ai)(?:,? inc\.?)?)(?:,\s*(?:an?|the)\s+(?:[^()"“]|\([^()"“]{1,40}\)){2,160}?)?\s*\(\s*(?:the\s+|each,\s+a\s+)?["“]([^"”]{1,40})["”](?:\s+or\s+(?:the\s+)?["“]([^"”]+)["”])?\s*\)/g;
  for (const m of s.matchAll(re)) {
    // "Eli Lilly and Company" is one name: keep its "and" away from the clause-word stripping below, which would
    // otherwise cut at it and leave just "Company".
    let name = m[1].trim().replace(/\s(and|&)\s(Company|Co\.?)(?=\W|$)/g, (_, join: string, co: string) => (join === "&" ? "\u0002" : "\u0001") + co);
    // Drop leading clause words captured before the name:
    // "Merger On December 1, 2025, Keystone" -> "Keystone"; "with Copart" -> "Copart"; "Company, GlaxoSmithKline LLC" -> "GlaxoSmithKline LLC".
    name = name.replace(/^.*\b(?:19|20)\d{2},\s+(?=[A-Z])/, "");
    name = name.replace(/^.*\b(?:Agreement|thereof|hereof|Offer),\s+(?=[A-Z])/, "");
    name = name.replace(/^(?:the\s+)?(?:Company|Parent|Purchaser|Merger Sub),\s+(?=[A-Z])/, "");
    // "dated February 4, 2021, by and among the Company, Celestial-Saturn Parent Inc." -> "Celestial-Saturn Parent Inc."
    name = name.replace(/^.*\b(?:among|between|with)\s+the\s+(?:Company|Partnership|Registrant|Trust)\s*,\s*(?:and\s+)?(?=[A-Z])/, "");
    name = name.replace(/^(?:.*\b(?:with|and|among|between|by|of|that is affiliated with|affiliated with|subsidiary of)\s+)(?=[A-Z]|[a-z][\w-]*\.(?:com|net|io|ai)\b)/, "");
    // "Soleno Therapeutics, Inc. a Delaware corporation" -> "Soleno Therapeutics, Inc."
    name = name.replace(/,?\s+an?\s+[A-Z][\w.]*(?:\s[\w.]+){0,3}\s+(?:corporation|company|limited liability company|limited partnership|partnership|trust|société anonyme|public limited company)$/i, "");
    name = cleanPartyName(name.replace(/,$/, "").replace(/\u0001/g, " and ").replace(/\u0002/g, " & "));
    // "by and among Perry Ellis, Feldenkreis Holdings LLC": an earlier party's defined term in front of this one's name.
    for (const prev of out) for (const term of [prev.nick, prev.alias]) if (term && name.startsWith(`${term}, `)) name = name.slice(term.length + 2);
    if (!isPlausibleName(name) || name.length > 70 || CLAUSE.test(name)) continue;
    if (/^(?:the )?(?:Company|Partnership|Registrant|Trust|Parent|Merger Sub|Purchaser|Board|Effective Time|Offer|Merger|Share|Delaware)$/i.test(name)) continue;
    // "RTB's certificate of incorporation", "the Company's common stock": a possessive then lowercase words is a
    // document or security, never a company.
    if (/['’]s\s+[a-z]/.test(name)) continue;
    // Defined securities are not parties: holders of RTB's preferred stock (the "RTB Preferred Stock").
    if (/\b(?:Stock|Shares|Notes|Warrants|Units|Securities|Options|Consideration|Price)$/i.test(m[2].trim())) continue;
    // Nor are defined terms for the deal itself: ... merge with and into RTB (the "Merger").
    if (/^(?:Mergers?|Transactions?|Offer|Closing|Effective Time|(?:Merger |Transaction |Arrangement |Implementation |Combination )?Agreement|Surviving Corporation|Scheme)$/i.test(m[2].trim())) continue;
    out.push({ name, nick: m[2].trim(), alias: m[3]?.trim(), index: m.index! });
  }
  return out;
}

/** The filer itself under its defined term: "the Company", or "the Partnership" / "the Registrant" / "the Trust" (MLPs, REITs). */
const SELF = /^(?:Company|Partnership|Registrant|Trust)$/i;
const SUB_NICK = /^(?:(?:Forward |Second |First )?Merger Sub(?:\s*(?:\d|I{1,3}))?|Purchaser|Merger Subsidiary|MergeCo|(?:Acquisition|Acquirer|Acquiror|Bidder) Sub|Bidco|BidCo|Sub)$/i;
const SHELL_NAME = /\b(?:Merger Sub|MergeCo|Merger (?:Corp|Co|LLC|Inc|Enterprises|Subsidiary)|Bidco|BidCo|Topco|Midco|Holdco|Purchaser|Acquisitions?,? (?:Corp|Co|LLC|Inc))\b/;
const BUYER_NICKS = ["Ultimate Parent", "Guarantor", "Parent", "Buyer", "Acquiror", "Acquirer", "Holdings", "Topco"];

/** Price per target share: "right to receive $42.15 in cash", "for $10.50 per share, net to the seller in cash". */
/** A contingent value right or milestone payment ("one CVR, which represents the right to receive up to $3.50"), not the price. */
export const CONTINGENT = /contingent value right|\bCVRs?\b|milestones?|earn-?out|\bup to\s*$/i;

export function extractMergerPrice(s: string): number | null {
  const found: { v: number; at: number }[] = [];
  const patterns = [
    /(?:right|entitled) to receive(?:[^$;.]{0,80}?)\$\s?(\d{1,4}(?:\.\d{1,4})?)\s*(?:in cash|per share|,? without interest|\(the)/gi,
    // "for (i) $8.50 per Share, net to the seller in cash"
    /(?:for|at a price of|offer price of)\s+(?:\([a-z0-9]{1,4}\)\s+)?\$\s?(\d{1,4}(?:\.\d{1,4})?)\s+per\s+share\b[^.;$]{0,80}?(?:net to the (?:seller|holder)|in cash)/gi,
  ];
  for (const re of patterns) {
    for (const m of s.matchAll(re)) {
      const dollar = m.index! + m[0].indexOf("$");
      if (CONTINGENT.test(s.slice(Math.max(0, dollar - 120), dollar))) continue;
      const v = Number(m[1]);
      if (v >= 0.05 && v < 10_000) found.push({ v, at: m.index! });
    }
  }
  // The first price stated is the headline price; later ones describe options, RSUs or CVR instalments.
  return found.sort((a, b) => a.at - b.at)[0]?.v ?? null;
}

/**
 * Which party disappears (the target) and which survives, from the merger mechanics:
 *  - "Merger Sub / Purchaser ... will (be) merge(d) with and into X"   -> target X
 *  - "the merger of Merger Sub with and into X"                          -> target X
 *  - "Y will merge with and into X" (Y a named party)                    -> target Y, acquirer X
 *  - "the Company will be acquired by X"                                  -> target Company, acquirer X
 */
function mechanics(section: string, entities: Entity[]): { target: string; acquirerHint?: string } | null {
  const ref = (s: string) => s.replace(/^the\s+/i, "").replace(/[.,;]+$/, "").trim();
  const terms = (e: Entity) => [e.nick, e.alias, e.name].filter((n): n is string => !!n);
  // The defined party written at `pos`, longest first: "Mr. Cooper", which the word pattern below would cut at its period.
  const partyAt = (pos: number) => {
    let best: string | null = null;
    for (const n of entities.flatMap(terms))
      if (section.startsWith(n, pos) && !/^[A-Za-z0-9]/.test(section.slice(pos + n.length, pos + n.length + 1)) && n.length > (best?.length ?? 0)) best = n;
    return best;
  };
  // The object of "… with and into (the) X": a defined party, else up to four capitalised words.
  const objectAt = (pos: number) => {
    const at = pos + (/^the\s+/.exec(section.slice(pos))?.[0].length ?? 0) + (section[pos] === '"' ? 1 : 0);
    return partyAt(at) ?? (/^"?([A-Z][\w&.'’\-]*(?:\s[A-Z][\w&.'’\-]*){0,3}?)"?(?=[\s,.(;])/.exec(section.slice(at))?.[1] ?? null);
  };
  // The defined party written last before `end`: the subject of "Sterling will merge with and into Webster".
  const subjectBefore = (end: number) => {
    const window = section.slice(Math.max(0, end - 140), end);
    let best: { e: Entity; at: number } | null = null;
    for (const e of entities)
      for (const n of terms(e)) {
        const at = window.lastIndexOf(n);
        if (at >= 0 && at + n.length > (best?.at ?? -1)) best = { e, at: at + n.length };
      }
    return best?.e ?? null;
  };
  const isSelf = (t: string) => SELF.test(t) || entities.some((e) => SELF.test(e.nick) && (e.alias === t || e.name === t)) || entities.some((e) => e.alias != null && SELF.test(e.alias) && (e.nick === t || e.name === t));

  // Several mergers can be described (an operating partnership first, then the company): prefer the one into the filer.
  const found: { target: string; acquirerHint?: string; weak?: boolean }[] = [];
  // "Seller would merge with and into the Company" (First Financial / Finward) as well as "will" / "shall", and with a
  // clause in between: "Southern States will, subject to the terms and conditions set forth in the Agreement, merge …".
  for (const m of section.matchAll(/\b(?:will|shall|would)(?:,[^,;.]{1,120},)?\s+(?:be\s+)?merge[ds]?\s+with\s+and\s+into\s+/g)) {
    const raw = objectAt(m.index! + m[0].length);
    if (!raw) continue;
    const into = ref(raw);
    const before = section.slice(Math.max(0, m.index! - 260), m.index!);
    // "the Company will merge with and into Corp Merger Sub": the Company merging into a merger subsidiary is the target.
    // "the First Surviving Company will merge with and into Merger Sub II" is the second step of a two-step merger; the
    // first step ("Merger Sub I will merge with and into Endeavor") names the target. Read as "the Company", it made
    // Diamondback the target of its own purchase of Endeavor.
    if (/\b(?:Surviving|Successor)\s+(?:Company|Corporation|Entity|Partnership|Corp)["”]?\s*$/i.test(before)) continue;
    const intoShell = /^\s*(?:Merger Sub(?:sidiary)?|Sub)\b/.test(section.slice(m.index! + m[0].length + raw.length)) || SHELL_NAME.test(into);
    // Not "the First Surviving Company will merge with and into Merger Sub II": the second step of a two-step merger, whose
    // first step merged a sub into the target (Diamondback / Endeavor read as Endeavor buying Diamondback).
    if (intoShell && /\b(?<!Surviving\s)(?<!Successor\s)(?:Company|Partnership|Registrant|Trust)["”]?\s*$/.test(before)) {
      found.push({ target: "Company" });
      continue;
    }
    // A named party (not a merger sub or a "Parent") written after the last mention of a merger sub is the one merging:
    // "… ("Merger Sub") … At the Effective Time, Valley will merge with and into Merger Sub" makes Valley the target.
    const subject = subjectBefore(m.index!);
    const subjectAt = subject ? Math.max(...terms(subject).map((n) => before.lastIndexOf(n))) : -1;
    const subAt = Math.max(...[...before.matchAll(/Merger Sub|Purchaser|MergeCo|Merger Subsidiary|Acquisition (?:Co|Corp|Sub)|Merger Corp/gi)].map((x) => x.index!), -1);
    const namedSubject = !!subject && !SUB_NICK.test(subject.nick) && !SHELL_NAME.test(subject.name) && !BUYER_NICKS.includes(subject.nick) && subjectAt > subAt;
    if (!namedSubject && subAt >= before.length - 160) {
      // Read only thanks to the clause ("Merger Sub 1 will, upon the terms …, merge with and into Media General"): another
      // merger described plainly wins (Media General / LIN, where a new holding company buys both).
      found.push({ target: into, weak: m[0].includes(",") });
      continue;
    }
    // A named party merging directly into another (bank mergers): the named party is the target.
    if (subject && !sameCompany(subject.name, into) && subject.nick !== into) found.push({ target: subject.nick, acquirerHint: into });
  }
  // Only clause-split ones (Delek / Alon: "Parent Merger Sub will, upon …, merge with and into Delek …, Astro Merger Sub
  // will, upon …, merge with and into Alon"): as with Media General / LIN, the second merger is the target's.
  const pick = found.find((f) => isSelf(f.target)) ?? found.find((f) => !f.weak) ?? found[found.length - 1];
  if (pick) return pick;
  const mergerOf = /[Mm]erger of (?:the\s+)?(?:Merger Sub(?:sidiary)?|Purchaser|[A-Z][\w ]{1,30}?Sub)\s+with\s+and\s+into\s+/.exec(section);
  const mergerInto = mergerOf && objectAt(mergerOf.index + mergerOf[0].length);
  if (mergerInto) return { target: ref(mergerInto) };
  const acquiredBy = /(?:the\s+)?(Company|[A-Z][\w&.'’\-]+)\s+will\s+be\s+acquired\s+by\s+([A-Z][^(,]{1,60}?)(?=\s*\(|,)/.exec(section);
  if (acquiredBy) return { target: ref(acquiredBy[1]), acquirerHint: acquiredBy[2].trim() };
  // "Acquirer Sub will acquire the Company … pursuant to a scheme of arrangement" (Horizon); "the Purchaser will acquire
  // the issued and to be issued ordinary share capital of the Company" (Nielsen); "Banco Santander will acquire Webster".
  for (const m of section.matchAll(/\b(?:will|shall|would)\s+acquire\s+(?:all\s+(?:of\s+)?)?(?:the\s+)?(?:(?:issued|outstanding)[\w\s,]{0,60}?\bof\s+)?/g)) {
    const raw = objectAt(m.index! + m[0].length);
    if (!raw) continue;
    const t = ref(raw);
    if (!isSelf(t) && !entities.some((e) => e.nick === t || e.alias === t)) continue;
    const subject = subjectBefore(m.index!);
    const hint = subject && !SUB_NICK.test(subject.nick) && !SHELL_NAME.test(subject.name) && !isSelf(subject.nick) ? subject.nick : undefined;
    return { target: t, ...(hint ? { acquirerHint: hint } : {}) };
  }
  if (/tender offer|exchange offer/i.test(section)) {
    // "...to acquire all of Bluebird's outstanding shares" / "...all of the outstanding shares of common stock ... of the Company"
    const owner =
      /(?:acquire|purchase)\s+(?:any and\s+)?all\s+(?:of\s+)?(?:the\s+)?(?:issued and\s+)?(?:outstanding\s+)?(?:shares\b[^.;]{0,120}?\bof\s+(?:the\s+)?)?"?([A-Z][\w&.'’\-]*(?:\s[A-Z][\w&.'’\-]*){0,3}?)(?:['’]s)?"?(?=[\s,.(;])/.exec(section);
    const t = owner ? ref(owner[1].replace(/['’]s$/, "")) : "";
    if (t && (SELF.test(t) || entities.some((e) => e.nick === t || e.alias === t || sameCompany(e.name, t)))) return { target: t };
    if (entities.some((e) => SELF.test(e.nick) || (e.alias != null && SELF.test(e.alias)))) return { target: "Company" };
  }
  return null;
}

export function parseMergerItem(text: string, ctx: PressContext): ParsedPress | null {
  const section = item101(text);
  if (!section) return null;
  const opening = section.slice(0, 3000);
  const entities = definedEntities(opening);
  const byRef = (ref: string) =>
    entities.find((e) => e.nick.toLowerCase() === ref.toLowerCase() || e.alias?.toLowerCase() === ref.toLowerCase()) ?? entities.find((e) => sameCompany(e.name, ref));

  const mech = mechanics(section, entities);
  if (!mech) return null;
  const companyEntity = entities.find((e) => SELF.test(e.nick) || (e.alias != null && SELF.test(e.alias)));
  let targetName = SELF.test(mech.target) ? (companyEntity?.name ?? ctx.filerName) : (byRef(mech.target)?.name ?? (isPlausibleName(mech.target) ? mech.target : null));
  if (!targetName) return null;
  // A merger subsidiary is never the target: the mechanics were read backwards, so the Company is.
  if (SHELL_NAME.test(targetName)) {
    targetName = companyEntity?.name ?? ctx.filerName;
    mech.acquirerHint = undefined;
    mech.target = "Company";
  }
  const isTarget = (e: Entity) =>
    sameCompany(e.name, targetName) || e.nick.toLowerCase() === mech.target.toLowerCase() || e.alias?.toLowerCase() === mech.target.toLowerCase();

  // Buyer: an explicit hint from the mechanics, else the entity defined as (Ultimate) Parent / Buyer,
  // else the first named party that isn't the target or a merger subsidiary, else the filer.
  let buyer: Entity | undefined;
  // "AvalonBay will merge with and into Merger Sub" (a subsidiary of Equity Residential): the buyer is the parent, found below.
  if (mech.acquirerHint && (SUB_NICK.test(mech.acquirerHint) || SHELL_NAME.test(mech.acquirerHint))) mech.acquirerHint = undefined;
  if (mech.acquirerHint) buyer = byRef(mech.acquirerHint) ?? { name: cleanPartyName(mech.acquirerHint), nick: mech.acquirerHint, index: 0 };
  for (const nick of BUYER_NICKS) {
    if (buyer) break;
    buyer = entities.find((e) => e.nick.toLowerCase() === nick.toLowerCase() && !isTarget(e));
  }
  // An "Investor" is buying shares, not the company (NovaGold's arrangement with Paulson as "the Investor").
  const investor = (e: Entity) => /^Investors?$/i.test(e.nick) || /^Investors?$/i.test(e.alias ?? "");
  buyer ??= entities.find((e) => !isTarget(e) && !SUB_NICK.test(e.nick) && !SHELL_NAME.test(e.name) && !SELF.test(e.nick) && !investor(e));
  if (!buyer && !sameCompany(ctx.filerName, targetName)) buyer = { name: ctx.filerName, nick: "Company", index: 0 };
  if (!buyer) return null;

  // Prefer an ultimate parent / named sponsor over a shell buyer ("Sword Purchaser, LLC ... affiliated with CD&R").
  let acquirerName = buyer.name;
  const ultimate = entities.find((e) => /^(?:Ultimate Parent|Guarantor)$/i.test(e.nick) && !isTarget(e));
  if (ultimate && ultimate !== buyer) acquirerName = ultimate.name;
  else if (
    SHELL_NAME.test(buyer.name) ||
    /^(?:[A-Z][A-Za-z\-]+ )+(?:Parent|Purchaser|Holdings|Buyer|Bidco|BidCo)\b/.test(buyer.name) ||
    // "Parent and Purchaser are newly-formed entities established by a consortium … led by funds affiliated with Elliott"
    new RegExp(`\\b${buyer.nick.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^.]{0,60}\\b(?:are|is) (?:a |an )?newly[- ]formed`).test(section)
  ) {
    const after = section.slice(buyer.index, buyer.index + 400);
    const leads = [
      /(?:affiliated with|an affiliate of|affiliates of|a (?:wholly owned )?subsidiary of|controlled by|formed by|owned by)\s+(?:(?:investment )?funds? (?:managed|advised) by\s+)?/.exec(after),
      /(?:investment )?funds? (?:managed|advised|sponsored) by\s+|funds? affiliated with\s+|(?:acquisition|purchase) of the Company by (?:affiliates of |funds (?:managed|advised) by )?(?=[A-Z])/.exec(section),
    ];
    // "a subsidiary of Parent" names a defined term, not a sponsor.
    const isTerm = (s: string) => /^(?:the\s+)?(?:Parent|Purchaser|Buyer|Company|Partnership|Registrant|Trust|Merger Sub)$/i.test(s.trim()) || entities.some((e) => e.nick === s.trim());
    for (const lead of leads) {
      if (!lead) continue;
      const rest = lead.input.slice(lead.index + lead[0].length);
      const sponsor = /^([A-Z][^()"“;]{1,80}?)\s*\(/.exec(rest) ?? /^([A-Z][A-Za-z0-9&.'’\- ]{1,80}?)(?=,|\.\s|;|\s(?:and|or)\s)/.exec(rest);
      // "the acquisition of the Company by Parent in an all cash transaction" names a defined term too.
      // ("Oracle Corporation" defined as "Oracle" is fine: it starts with its own name.)
      const startsWithTerm =
        (!!sponsor && entities.some((e) => sponsor[1].startsWith(`${e.nick} `) && !sponsor[1].startsWith(e.name))) || /^(?:Parent|Purchaser|Buyer|Merger Sub)\b/.test(sponsor?.[1] ?? "");
      const candidate = sponsor ? cleanPartyName(sponsor[1]) : "";
      if (sponsor && !CLAUSE.test(sponsor[1]) && !isTerm(sponsor[1]) && !startsWithTerm && isPlausibleName(candidate)) {
        acquirerName = candidate;
        break;
      }
    }
  }
  if (!isPlausibleName(acquirerName) || sameCompany(acquirerName, targetName) || /^(?:Parent|Purchaser|Buyer|Company|Partnership|Registrant|Trust|Merger Sub)$/i.test(acquirerName)) return null;

  // An amendment to an agreement already announced ("First Amendment to Agreement and Plan of Merger. As previously
  // announced, …") updates that deal and never creates one: Vista Outdoor's amendment listed Revelyst first, which
  // made a second deal with Revelyst as the buyer.
  // "As previously announced" alone is not enough: the signing 8-K itself, filed days after the press release, often
  // opens "As previously announced, on April 26, 2021, W. R. Grace & Co. … entered into an Agreement and Plan of Merger".
  const lead = section.slice(0, 400);
  const amendment = /\b(?:(?:First|Second|Third|\w+)\s+Amendment|Amendment\s+No\.?\s*\d+)\s+to\s+(?:the\s+)?(?:Agreement and Plan of Merger|Merger Agreement|Transaction Agreement|Arrangement Agreement)\b/i.test(lead);
  const signing = /\bentered\s+into\s+(?:an?|the)\s+(?:(?:Amended and Restated|definitive)\s+)?(?:Agreement and Plan of (?:Merger|Reorganization)|Merger Agreement|Transaction Agreement|Arrangement Agreement|Business Combination Agreement)\b/i.test(lead);
  // The restated signing date: a later 8-K restating it (an extension, a vote) is an update (applyParsed in deals.ts).
  // Without a date there is no telling, so it stays an update.
  const previously = /\bAs previously (?:announced|reported|disclosed)\b/i.test(lead);
  const signedText = signing && previously
    ? /\bon\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4})/.exec(lead)?.[1]
    : undefined;
  const signedMs = signedText ? Date.parse(`${signedText} UTC`) : NaN;
  const signedOn = Number.isNaN(signedMs) ? undefined : new Date(signedMs).toISOString().slice(0, 10);
  const kind = amendment || (previously && !signedOn) ? ("update" as const) : ("announcement" as const);
  const consideration: Consideration | null = extractConsideration(section.slice(0, 5000));
  const value = extractValue(section);
  return {
    kind,
    headline: `${acquirerName} to acquire ${targetName} (8-K Item 1.01)`,
    acquirer: { name: acquirerName, ticker: null, exchange: null },
    target: { name: targetName, ticker: null, exchange: null },
    pricePerShare: extractMergerPrice(section),
    premiumPct: null,
    valueUsd: value?.usd ?? null,
    valueKind: value?.kind ?? null,
    consideration,
    acquirerAdvisors: [],
    targetAdvisors: [],
    ...(signedOn ? { signedOn } : {}),
  };
}

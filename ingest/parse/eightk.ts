/**
 * Extract a merger from the legal "Item 1.01 Entry into a Material Definitive Agreement"
 * section of an 8-K. Catches deals announced without a press-release exhibit, and
 * names the parties through the agreement's defined terms ("Parent", "Merger Sub", "the Company").
 */
import { flatten } from "../text";
import type { Consideration } from "../../lib/types";
import { cleanPartyName, isPlaceholderBuyer, isPlausibleName, normalizeName, sameCompany } from "./names";
import { circularAbroad, datelinesOf, extractConsideration, extractValue, isCashLeg, otherDollar, type ParsedPress, type PressContext, buyInOf } from "./press";
import { buyerBehindParent, jointBuyers } from "./sponsor";

interface Entity {
  name: string;
  nick: string;
  /** Second defined term, e.g. (the "Company" or "Udemy"). */
  alias?: string;
  index: number;
}

/**
 * An 8-K Item 1.02 saying the merger agreement itself was terminated ("terminated the Merger Agreement", "the Merger
 * Agreement was terminated"), not another agreement ended "in connection with the Merger Agreement" at the closing,
 * nor a party's right to terminate it.
 */
export function saysMergerTerminated(text: string): boolean {
  // Rights and conditions are not events: "the right to terminate the Merger Agreement", "if the Merger Agreement is
  // terminated".
  // The forward-looking-statements boilerplate lists risks ("the right of Greenhill or Mizuho Americas to terminate the
  // Merger Agreement", "the termination of the Merger Agreement"), not events: cut it off.
  const t = text
    .split(/\bforward[- ]looking statements?\b|\bcautionary (?:statement|note)/i)[0]
    .replace(/\b(?:rights?|option|ability)\s+(?:of\s+[^.]{1,80}?\s+)?to\s+terminate\b/gi, "")
    .replace(/\b(?:if|in the event(?: that)?|upon|should|unless|until|whether)\s+(?:the\s+)?(?:merger|arrangement|combination|transaction) agreement[^.]{0,80}?terminated/gi, "");
  const deal = String.raw`(?:(?:merger|arrangement|combination|transaction) agreement|agreement and plan of (?:merger|arrangement))`;
  // Nothing else called an "agreement" between the merger agreement and "terminated" ("… in connection with the Merger
  // Agreement, all commitments under the Credit Agreement were terminated").
  return new RegExp(String.raw`terminat(?:e|ed|es|ing|ion of)\s+(?:the\s+)?(?:[\w-]+\s+){0,3}${deal}|${deal}(?:(?!agreement)[^.]){0,80}?\b(?:was|has been|have been|is|were|had been)\s+(?:validly\s+|mutually\s+)?terminated`, "i").test(t);
}

/**
 * The same 8-K's Item 1.02 reports that an earlier merger agreement ended: this signing tops it. RR Donnelley's Item 1.01
 * signs with "Chatham Delta Parent, Inc." and its Item 1.02 delivers "a written notice terminating the Atlas Merger Agreement".
 */
function endsEarlierAgreement(text: string): boolean {
  const t = flatten(text);
  const start = t.search(/Item\s*1\.02[\s.:\-–—]*Termination of (?:a )?Material Definitive Agreement/i);
  if (start < 0) return false;
  const rest = t.slice(start + 20, start + 4000);
  const end = rest.search(/Item\s*\d\.\d\d[\s.:\-–—]*[A-Z][a-z]/);
  return saysMergerTerminated(end > 0 ? rest.slice(0, end) : rest);
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
    // A list of terms is the first and the Company: `("TMRC", the "Company", "we", "us" or "our")` (Texas Mineral Resources).
    .replace(/\(\s*((?:the\s+)?["“][^"”()]{1,40}["”])((?:,\s*(?:the\s+)?["“][^"”()]{1,40}["”])+)(?:,?\s+(?:and|or)\s+(?:the\s+)?["“][^"”()]{1,40}["”])?\s*\)/g, (all: string, first: string) => {
      const self = /(?:the\s+)?["“](?:Company|Partnership|Registrant|Trust)["”]/.exec(all)?.[0];
      return self && !first.includes(self.replace(/^the\s+/, "")) ? `(${first} or ${/^the\s/.test(self) ? self : `the ${self}`})` : `(${first})`;
    })
    .replace(/(\w) \.(?=[\s,])/g, "$1.")
    // "Merger Sub will merge (the "Merger") with and into the Company": the defined term splits the verb from its object.
    .replace(/\b(merge[ds]?)\s*\([^()]{1,60}\)\s*(?=with\s+and\s+into)/gi, "$1 ")
    // "Magellan Midstream Partners, L.P. (NYSE: MMP), a Delaware limited partnership": a listing between a name and its
    // description hides the name from the defined-term pattern.
    .replace(/\s*\((?:NYSE|NASDAQ|Nasdaq|NYSE American|Cboe|CBOE)(?:\s?[A-Z]{1,3})?\s?:\s?[A-Z.]{1,6}\)/g, "");
  // UK / Irish targets are bought under a "Transaction Agreement" by a scheme of arrangement (Horizon, Nielsen).
  if (!/Agreement and Plan of Merger|Merger Agreement|Arrangement Agreement|Plan of Arrangement|Transaction Agreement|Implementation Agreement|scheme of arrangement/i.test(section)) return null;
  if (!/merge[ds]? with and into|merger of .{1,60} with and into|tender offer|exchange offer|plan of arrangement|scheme of arrangement|amalgamat|be acquired by|(?:will|shall) acquire\s+(?:all\s+of\s+)?(?:the\s+)?(?:issued\b|outstanding\b|[A-Z])/i.test(section)) return null;
  // An asset sale is not a takeover of the filer: when the first agreement the section says was entered into is an
  // asset purchase agreement ("entered into a definitive asset purchase agreement … under which Gallagher agreed to
  // purchase … Eastern Bank's insurance operations"), the merger described after it is another deal (Eastern buying
  // Cambridge, signed the same day) that the other party's filings report.
  const first = /\bentered\s+into\s+(?:an?|the)\s+(?:[\w-]+\s+){0,4}?(agreement and plan of (?:merger|reorganization)|merger agreement|transaction agreement|arrangement agreement|asset purchase agreement|purchase and sale agreement)\b/i.exec(section.slice(0, 2500));
  if (first && /asset purchase|purchase and sale/i.test(first[1])) return null;
  // One business dropped into the shell first: "will acquire all outstanding shares of common stock of the Company which, following the proposed reorganization, will hold the Company's Atlantic Aviation business" (KKR / Macquarie Infrastructure).
  if (/\bwill\s+acquire\b[^.]{0,120}\bwhich\b[^.]{0,80}\bwill\s+hold\b[^.]{0,80}\bbusiness\b/i.test(section.slice(0, 1200))) return null;
  return section;
}

/** A lower-case brand and its legal form: "argenx BV", "uniQure N.V.", "bluebird bio, Inc.", "eBay Inc." */
// (Not the end of an accented word or a number: "Dassault Systèmes SE" is no "mes SE", "23andMe, Inc." no "andMe, Inc.".)
const LOWER_BRAND = String.raw`(?<![A-Za-z0-9À-ÖØ-öø-ÿ])(?!(?:and|or|the|with|of|by|an?|its|their|into|to|from|between|among|each|other|bio)\b)[a-z][A-Za-z0-9-]{2,}(?:\sbio)?,?\s(?:B\.?V\.?|N\.?V\.?|SE|AG|S\.A\.?|plc|Inc\.?|Ltd\.?|LLC|Corp(?:oration)?\.?|Limited|GmbH|S\.p\.A\.?|AB|A\/S|ASA|Oyj)(?=[\s,(]|$)`;

/** Legal phrasing that shows a capture is a clause, not a company name. */
const CLAUSE = /\b(?:will|shall|with and into|Merger Agreement|Pursuant|Section|approved|effective time|continuing|surviving|thereof|thereunder|commence|if any|converted|Act of)\b/i;

/**
 * Defined parties: `Acme Corp., a Delaware corporation ("Parent")`. The description may hold one short parenthesis:
 * `Just Eat Takeaway.com N.V., a public limited liability company (naamloze vennootschap) incorporated under the laws
 * of the Netherlands ("Parent")`, which used to leave "Netherlands" as the name.
 */
export function definedEntities(s: string): Entity[] {
  const out: Entity[] = [];
  // A name starts with a capital, or is a lower-case web name ("salesforce.com, inc.") or brand with its legal form
  // ("argenx BV, a private company with limited liability", which left "BV"; "uniQure N.V.", "bluebird bio, Inc.").
  // The usual terms also count without quote marks: some filings print `(the Company)`, `(Parent)` (EQT / Equitrans),
  // or `(the Company or Icosavax)`. A description never runs on across another party's definition.
  // (A slash between letters belongs to the name: "RE/MAX Holdings, Inc., a Delaware corporation (the "Company")".)
  const re = new RegExp(String.raw`([A-Z](?:[A-Za-zÀ-ÖØ-öø-ÿ0-9&.,'’\- ]|\/(?=[A-Za-z])){1,90}?|\b[a-z][\w-]*\.(?:com|net|io|ai)(?:,? inc\.?)?|${LOWER_BRAND})(?:(?:,\s*(?:an?|the|incorporated|organized|existing)|(?<=\.)\s+an?(?=\s+(?:private|public)\s))\s+(?:[^()"“]|\((?!\s*(?:the\s+)?(?:Company|Parent|Merger Sub|Purchaser|Buyer)\b)[^()"“]{1,40}\)){2,160}?)?\s*\(\s*(?:the\s+|each,\s+a\s+)?(?:["“]([^"”]{1,40})["”]|(Company|Parent|Ultimate Parent|Merger Sub|Purchaser|Buyer|Acquir[eo]r|Partnership|Registrant|Guarantor))(?:\s+or\s+(?:the\s+)?(?:["“]([^"”]+)["”]|([A-Z][\w&.'’\-]*(?: [A-Z][\w&.'’\-]*){0,3})))?\s*\)`, "g");
  for (const m0 of s.matchAll(re)) {
    const m = [m0[0], m0[1], m0[2] ?? m0[3], m0[4] ?? m0[5]] as const;
    // "Eli Lilly and Company" is one name: keep its "and" away from the clause-word stripping below, which would
    // otherwise cut at it and leave just "Company" ("AstraZeneca Finance and Holdings Inc." left "Holdings Inc.").
    let name = m[1].trim().replace(/,?\s+an?\s+(?:[a-z-]+\s+){0,4}(?:company|corporation|partnership)\s+(?:incorporated|organized|formed|existing)\s+(?:in|under)\b.*$/, "").replace(/\s(and|&)\s(Company|Co\.?|Holdings|Partners|Sons)(?=\W|$)/g, (_, join: string, co: string) => (join === "&" ? "\u0002" : "\u0001") + co);
    // Drop leading clause words captured before the name:
    // "Merger On December 1, 2025, Keystone" -> "Keystone"; "with Copart" -> "Copart"; "Company, GlaxoSmithKline LLC" -> "GlaxoSmithKline LLC".
    name = name.replace(/^.*\b(?:19|20)\d{2},\s+(?=[A-Z])/, "");
    name = name.replace(/^.*\b(?:Agreement|thereof|hereof|Offer),\s+(?=[A-Z])/, "");
    name = name.replace(/^(?:the\s+)?(?:Company|Parent|Purchaser|Merger Sub),\s+(?=[A-Z])/, "");
    // "dated February 4, 2021, by and among the Company, Celestial-Saturn Parent Inc." -> "Celestial-Saturn Parent Inc."
    name = name.replace(/^.*\b(?:among|between|with)\s+the\s+(?:Company|Partnership|Registrant|Trust)\s*,\s*(?:and\s+)?(?=[A-Z])/, "");
    // ("of" only after a lower-case word or a document word: "holders of Acme", not "Spirit of Texas Bancshares", "Bank of Commerce Holdings".)
    name = name.replace(/^(?:.*\b(?:with|and|among|between|by|(?<=\b(?:[a-z]+|Plans?|State|Articles|Laws?|Court|Bench|Province|Commonwealth|Republic|Certificate|Agreement|Amendment|Terms|Merger|Founder|Chairman|President|CEO|Affiliates?|Funds?|Incorporation|Organization|Formation|Code)\s)of|that is affiliated with|affiliated with|subsidiary of)\s+)(?=[A-Z]|[a-z][\w-]*\.(?:com|net|io|ai)\b)/, "");
    // Clause words before a lower-case brand, which the steps above only strip before a capital: "the Company, argenx BV"
    // (not "IVERIC bio, Inc.", one name).
    const brand = new RegExp(String.raw`(?:,\s+|\b(?:with|and|among|between|by|of)\s+)(${LOWER_BRAND})$`).exec(name);
    if (brand) name = brand[1];
    // "Soleno Therapeutics, Inc. a Delaware corporation" -> "Soleno Therapeutics, Inc."
    name = name.replace(/,?\s+an?\s+[A-Z][\w.]*(?:\s[\w.]+){0,3}\s+(?:corporation|company|limited liability company|limited partnership|partnership|trust|société anonyme|public limited company)$/i, "");
    name = cleanPartyName(name.replace(/,$/, "").replace(/\u0001/g, " and ").replace(/\u0002/g, " & "));
    // "by and among Perry Ellis, Feldenkreis Holdings LLC": an earlier party's defined term in front of this one's name.
    // (Not a second company of the same name: "Columbia Financial, Inc., … ("Columbia Financial"), Columbia Financial, Inc., a newly-formed Maryland corporation (the "Holding Company")" left "Inc.".)
    for (const prev of out) for (const term of [prev.nick, prev.alias]) if (term && name.startsWith(`${term}, `) && prev.name !== name) name = name.slice(term.length + 2);
    if (!isPlausibleName(name) || name.length > 70 || CLAUSE.test(name)) continue;
    if (/^(?:the\s+)?(?:New York Stock Exchange|NYSE(?: American| MKT| Arca)?|Nasdaq(?: Stock Market| Global(?: Select)? Market| Capital Market)?(?: LLC)?|Toronto Stock Exchange|TSX(?: Venture Exchange)?|Securities and Exchange Commission)$/i.test(name)) continue;
    if (/^(?:the )?(?:Company|Partnership|Registrant|Trust|Parent|Merger Sub|Purchaser|Board|Effective Time|Offer|Merger|Share|Delaware)$/i.test(name)) continue;
    // "RTB's certificate of incorporation", "the Company's common stock": a possessive then lowercase words is a
    // document or security, never a company.
    if (/['’]s\s+[a-z]/.test(name)) continue;
    // Defined securities and holders are not parties: holders of RTB's preferred stock (the "RTB Preferred Stock"), the
    // holders of Tenax's membership interests (the "Tenax Members").
    if (/\b(?:Stock|Shares|Notes|Warrants|Units|Securities|Options|Consideration|Price|Members|Holders|Stockholders|Shareholders|Unitholders|Equityholders)$/i.test(m[2].trim())) continue;
    // Nor are the company's own bodies: "… a wholly owned subsidiary of Ithaca. The board of directors (the "Board")" gave
    // an "Ithaca" defined as the Board.
    if (/^(?:Board(?: of Directors)?|(?:Special |Transaction |Independent )?Committee)$/i.test(m[2].trim())) continue;
    // Nor are defined terms for the deal itself: ... merge with and into RTB (the "Merger").
    if (/^(?:Mergers?|Transactions?|Offer|Closing|Effective Time|(?:Merger |Transaction |Arrangement |Implementation |Combination )?Agreement|Surviving Corporation|Scheme)$/i.test(m[2].trim())) continue;
    // Nor meetings, plans or other paperwork: "… at a special meeting (the "Meeting")", "(the "Equity Plan")".
    if (/^(?:(?:Special |Company )?Meeting|(?:Equity |Incentive |Stock )?Plan|Plan of Conversion|(?:Permitted )?Leakage)$/i.test(m[2].trim())) continue;
    out.push({ name, nick: m[2].trim(), alias: m[3]?.trim(), index: m0.index! });
  }
  return out;
}

/** The filer itself under its defined term: "the Company", or "the Partnership" / "the Registrant" / "the Trust" (MLPs, REITs). */
const SELF = /^(?:Company|Partnership|Registrant|Trust)$/i;
const SUB_NICK = /^(?:(?:Forward |Second |First )?Merger Sub(?:\s*(?:\d|I{1,3}))?|Purchaser|Merger Subsidiary|MergeCo|(?:Acquisition|Acquirer|Acquiror|Bidder) Sub|Bidco|BidCo|Sub)$/i;
const SHELL_NAME = /\b(?:Merger Sub|MergeCo|MergerCo|AcquireCo|AcquisitionCo|Merger (?:Corp|Co|LLC|Inc|Enterprises|Subsidiary)|Bidco|BidCo|Topco|Midco|Holdco|Purchaser|Acquisitions?,? (?:Corp|Co|LLC|Inc)|Sub(?:sidiary)?,? (?:Corp|LLC|Inc))\b/;
const BUYER_NICKS = ["Ultimate Parent", "Guarantor", "Parent", "Buyer", "Acquiror", "Acquirer", "Holdings", "Topco"];

/** Price per target share: "right to receive $42.15 in cash", "for $10.50 per share, net to the seller in cash". */
/** A contingent value right or milestone payment ("one CVR, which represents the right to receive up to $3.50"), not the price. */
export const CONTINGENT = /contingent value right|\bCVRs?\b|milestones?|earn-?out|\bup to\s*$/i;

/**
 * The price an amendment raises the deal to: "increases the Merger Consideration … from $4.10 per share to $4.60 per share" (GSE),
 * "the Offer Price … was increased from $38.50 per share in cash to $47.00" (Servotronics), "shareholders will receive $16.99.
 * Prior to … the merger consideration … was $14.51" (Gray / Meredith), "Under the terms of Amendment No. 2, … for $56.00 per share"
 * (CIRCOR). Not a mixed deal's cash leg (Vista Outdoor's "Cash Consideration"), nor a fee ("from $8,000,000 to $12,000,000").
 */
/** A cut by amendment: "the Merger Consideration payable in the Merger is reduced from $66.00 per share … to $63.75 per share" (Anaplan). */
export function reducedPrice(section: string): number | null {
  const P = String.raw`\$\s?(\d{1,4}(?:\.\d{1,4})?)(?![,\d])`;
  const m = new RegExp(String.raw`\b(?:Offer Price|Per Share Price|per share (?:merger )?consideration|merger consideration|purchase price per share|price per share)\b[^.]{0,120}?\b(?:reduced|decreased|lowered)\s+from\s+${P}(?:[^.]|\.(?=\d)){0,200}?\bto\s+${P}`, "i").exec(section);
  if (m) return Number(m[2]) < Number(m[1]) ? Number(m[2]) : null;
  // The other way round: "agreed to reduce the merger consideration … to $51.75 in cash, without interest, from $61.00" (iRobot).
  const toFrom = new RegExp(String.raw`\breduce\s+the\s+(?:merger\s+consideration|offer\s+price|per\s+share\s+(?:merger\s+)?consideration|purchase\s+price)\b(?:[^.]|\.(?=\d)){0,200}?\bto\s+${P}(?:[^.]|\.(?=\d)){0,60}?\bfrom\s+${P}`, "i").exec(section);
  return toFrom && Number(toFrom[1]) < Number(toFrom[2]) ? Number(toFrom[1]) : null;
}

export function raisedPrice(section: string): number | null {
  const P = String.raw`\$\s?(\d{1,4}(?:\.\d{1,4})?)(?![,\d])`;
  const fromTo = new RegExp(String.raw`\b(?:Offer Price|Per Share Price|per share (?:merger )?consideration|merger consideration|purchase price per share|price per share)\b[^.]{0,200}?\bfrom\s+${P}[^.$]{0,40}?\bto\s+${P}`, "i").exec(section);
  if (fromTo && Number(fromTo[2]) > Number(fromTo[1])) return Number(fromTo[2]);
  // "increase the upfront cash consideration … from $47.50 to $65.60 in cash per share" (Pfizer / Metsera). Upfront: a mixed deal's plain "Cash Consideration" is a leg (Vista Outdoor).
  const upfront = new RegExp(String.raw`\bincreases?\s+the\s+upfront\s+cash\s+consideration\b(?:[^.]|\.(?=\d)){0,240}?\bfrom\s+${P}\s+to\s+${P}`, "i").exec(section);
  if (upfront && Number(upfront[2]) > Number(upfront[1])) return Number(upfront[2]);
  // "increase the cash consideration to be paid by Parent for each ordinary share, par value $1.50 per share, … from $49.00 to $52.00 per Share in cash" (Janus Henderson).
  const cash = new RegExp(String.raw`\bincrease\s+the\s+cash\s+consideration\b(?:[^.]|\.(?=\d)){0,320}?\bfrom\s+${P}\s+to\s+${P}\s+per\s+[Ss]hare\s+in\s+cash\b`).exec(section);
  if (cash && Number(cash[2]) > Number(cash[1])) return Number(cash[2]);
  const prior = new RegExp(String.raw`\b(?:will|shall)\s+(?:be\s+entitled\s+to\s+)?receive\s+${P}\.\s+Prior\s+to\s[^.]{0,120}?\bconsideration\b[^.]{0,120}?\bwas\s+${P}`, "i").exec(section);
  if (prior && Number(prior[1]) > Number(prior[2])) return Number(prior[1]);
  const terms = /\bUnder the terms of (?:the )?Amendment(?: No\.?\s*\d+)?\b(?:[^.$]|\.(?=\s?\d))*?\bfor\s+\$\s?(\d{1,4}(?:\.\d{1,4})?)\s+per\s+share\b/i.exec(section);
  return terms ? Number(terms[1]) : null;
}

export function extractMergerPrice(s: string): number | null {
  const found: { v: number; at: number }[] = [];
  const patterns = [
    /(?:right|entitled) to receive(?:[^$;.]{0,80}?)\$\s?(\d{1,4}(?:\.\d{1,4})?)\s*(?:in cash|per share|,? without interest|\(the)/gi,
    // "for (i) $8.50 per Share, net to the seller in cash", "for a purchase price of $95.00 per share, net to the holders
    // thereof in cash" (Cerner)
    /(?:for|at a price of|offer price of|(?:for|at) a (?:purchase |cash |offer )?price of|purchase price of)\s+(?:\([a-z0-9]{1,4}\)\s+)?\$\s?(\d{1,4}(?:\.\d{1,4})?)\s+per\s+share\b[^.;$]{0,80}?(?:net to the (?:seller|holder)|in cash)/gi,
    // "at a price per share of $4.35, in cash, net to the holder" (WhiteHawk / PHX)
    /\bat a (?:purchase |cash |offer )?price per share of\s+\$\s?(\d{1,4}(?:\.\d{1,4})?)\b[^.;$]{0,80}?(?:net to the (?:seller|holder)|in cash)/gi,
    // "at a price of $2.05 per Share (the "Offer Price")" (Castlight), "at a price per share of Company Common Stock of $17.00 (…), net to the seller" (Great Lakes).
    /\bat a (?:purchase |cash |offer )?price of\s+\$\s?(\d{1,4}(?:\.\d{1,4})?)\s+per\s+share\s*\(\s*(?:the\s*)?["“]?\s*Offer Price\b/gi,
    /\bat a (?:purchase |cash |offer )?price per share of (?:[A-Z][\w]*\s+){1,4}of\s+\$\s?(\d{1,4}(?:\.\d{1,4})?)\b[^.;$]{0,180}?(?:net to the (?:seller|holder)|in cash)/gi,
    // What a holder electing cash gets is worth the whole price: "(i) if a cash election … has been properly made …, $65.00 in cash" (DoorDash / Instacart).
    /\bif\s+a\s+cash\s+election\b[^$;]{0,260}?\$\s?(\d{1,4}(?:\.\d{1,4})?)\s+in\s+cash/gi,
  ];
  for (const re of patterns) {
    for (const m of s.matchAll(re)) {
      const dollar = m.index! + m[0].indexOf("$");
      if (CONTINGENT.test(s.slice(Math.max(0, dollar - 120), dollar))) continue;
      // A par value isn't a price ("for each share of FLIC's common stock, par value $0.10 per share, 0.5175 shares of …"),
      // nor a proposal the board turned down, quoted first ("an unsolicited, non-binding proposal from Mobix … for $3.80 per share in cash (the "Alternative Proposal")").
      if (/\bpar value(?: of)?\s*$/i.test(s.slice(Math.max(0, dollar - 14), dollar))) continue;
      if (/\bproposal\b/i.test(s.slice(Math.max(0, dollar - 200), dollar)) && /^[^.;]{0,60}\bProposal\b/.test(s.slice(dollar, dollar + 90).replace(/\d\.\d/g, ""))) continue;
      // "C$1.40" is not US$1.40.
      if (otherDollar(s, dollar)) continue;
      // Cash on top of shares is part of the price, not all of it: "the right to receive one ListCo Share and $5.00 in
      // cash" (WestRock) read as a $5.00 deal.
      if (/\b(?:one|two|three|\d+\.\d+|\d+)\s+(?:[A-Z][\w&.'’-]*\s+){0,4}(?:common\s+|ordinary\s+)?(?:[Ss]hares?|ADSs?|units?)\s+and\s*$/.test(m[0].slice(0, m[0].indexOf("$")))) continue;
      // …in either order: "the right to receive $26.45 in cash, without interest, from JHX … (the "Cash Consideration"),
      // and 1.0340 shares" (James Hardie / AZEK), "(i) one share of Parent Class A Common Stock … and (ii) $96.00 in cash".
      const amountEnd = s.indexOf(m[1], dollar) + m[1].length;
      if (isCashLeg(s.slice(Math.max(0, dollar - 320), dollar), s.slice(amountEnd, amountEnd + 320))) {
        found.push({ v: -1, at: m.index! });
        continue;
      }
      const v = Number(m[1]);
      if (v >= 0.05 && v < 10_000) found.push({ v, at: m.index! });
    }
  }
  // The first price stated is the headline price; later ones describe options, RSUs or CVR instalments.
  const firstPrice = found.sort((a, b) => a.at - b.at)[0];
  return firstPrice && firstPrice.v >= 0 ? firstPrice.v : null;
}

/**
 * An 8-K's own text read as a release (found by a release search, often refiled as a DEFA14A: Abbott / Exact Sciences)
 * states the price the 8-K way, "will be converted into … the right to receive $105.00 in cash", which the release
 * reader doesn't read: its Item 1.01 does. Public targets only.
 */
export function withItem101Price(parsed: ParsedPress | null, text: string): ParsedPress | null {
  if (!parsed || parsed.pricePerShare != null || parsed.privateTarget) return parsed;
  const section = item101(text);
  // A 425 wrapping an 8-K and its exhibits: the release sits past the 8-K's boilerplate, where `termsSection` stopped.
  const whole = section ? /\b(?:transaction|consideration)\s+(?:is\s+)?valued\s+at\s+(?:approximately\s+)?\$\s?(\d{1,4}(?:\.\d{1,4})?)\s+per\s+(?:[A-Z][\w&.'’-]*\s+){0,3}(?:common\s+)?share\b/.exec(flatten(text)) : null;
  const price = whole ? Number(whole[1]) : section ? extractMergerPrice(section) : null;
  return price == null ? parsed : { ...parsed, pricePerShare: price };
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
    // (A subject that is a subsidiary by name: "FC Subsidiary will merge with and into First Century".)
    if (!namedSubject && (subAt >= before.length - 160 || (!!subject && /\bSub(?:sidiary)?,? (?:Corp|LLC|Inc)\b/.test(subject.name)))) {
      // Read only thanks to the clause ("Merger Sub 1 will, upon the terms …, merge with and into Media General"): another
      // merger described plainly wins (Media General / LIN, where a new holding company buys both).
      found.push({ target: into, weak: m[0].includes(",") });
      continue;
    }
    // A named party merging directly into another (bank mergers): the named party is the target. Not the next step after it,
    // whose subject isn't the nearest name: "Grand will merge with and into Seacoast. Following the Merger, the Bank will merge
    // with and into SNB" is the banks' own merger, with Seacoast only the last name before it.
    const tail = before.trimEnd().replace(/\([^()]*\)$/, "").replace(/[\s,"”]+$/, "");
    if (subject && !terms(subject).some((n) => tail.endsWith(n)) && (/\b(?:following|after|subsequent(?:ly)? to|thereafter)\b[^.]{0,80}$/i.test(before) || /\bthe\s+(?:[A-Z][\w-]*\s+){1,2}$/.test(before))) continue;
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
    const hint = subject && !SUB_NICK.test(subject.nick) && !SHELL_NAME.test(subject.name) && (!isSelf(subject.nick) || !isSelf(t)) ? subject.nick : undefined;
    return { target: t, ...(hint ? { acquirerHint: hint } : {}) };
  }
  // (Not a warrant's boilerplate alone: "a purchase, tender or exchange offer …" in Tempus's securities purchase, which read
  // as Chart Acquisition Group buying Tempus.)
  if (/tender offer|exchange offer/i.test(section.replace(/\bpurchase,?\s+tender\s+or\s+exchange\s+offer\b/gi, " "))) {
    // "...to acquire all of Bluebird's outstanding shares" / "...all of the outstanding shares of common stock ... of the Company"
    const owner =
      /(?:acquire|purchase)\s+(?:any and\s+)?all\s+(?:of\s+)?(?:the\s+)?(?:issued and\s+)?(?:outstanding\s+)?(?:shares\b[^.;]{0,120}?\bof\s+(?:the\s+)?)?"?([A-Z][\w&.'’\-]*(?:\s[A-Z][\w&.'’\-]*){0,3}?)(?:['’]s)?"?(?=[\s,.(;])/.exec(section);
    const t = owner ? ref(owner[1].replace(/['’]s$/, "")) : "";
    if (t && (SELF.test(t) || entities.some((e) => e.nick === t || e.alias === t || sameCompany(e.name, t)))) return { target: t };
    if (entities.some((e) => SELF.test(e.nick) || (e.alias != null && SELF.test(e.alias)))) return { target: "Company" };
  }
  return null;
}

const isoDate = (s: string | undefined): string | undefined => {
  const ms = s ? Date.parse(`${s.replace(/\./g, "").replace(/\bSept\b/, "Sep")} UTC`) : NaN;
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString().slice(0, 10);
};
const RELEASE_DATE = String.raw`((?:January|February|March|April|May|June|July|August|September|October|November|December|Jan\.?|Feb\.?|Mar\.?|Apr\.?|Jun\.?|Jul\.?|Aug\.?|Sept?\.?|Oct\.?|Nov\.?|Dec\.?)\s+\d{1,2},\s*\d{4})`;
const OWN_RELEASE = [
  // "On March 13, 2023, the Company issued a press release announcing the Merger."
  new RegExp(String.raw`\bOn\s+${RELEASE_DATE},?[^.]{0,120}?\b(?:issued|released|published)\b[^.]{0,60}?press release[^.]{0,200}`, "g"),
  // "Joint Press Release, dated March 13, 2023, announcing the Merger", in the text or the exhibit list.
  new RegExp(String.raw`\bpress release[^.]{0,60}?\b(?:dated|issued on|issued|released on|on)\s+${RELEASE_DATE}[^.]{0,120}`, "gi"),
];
/**
 * The day the deal's release went out, when the 8-K says so: from the signing to ten days on, about the deal. Of 239
 * signing 8-Ks whose release other documents date too, 225 agreed.
 */
export function statedRelease(text: string, signedOn: string): string | undefined {
  const flat = flatten(text);
  const days: string[] = [];
  for (const re of OWN_RELEASE) {
    for (const m of flat.matchAll(re)) {
      const day = isoDate(m[1]);
      if (!day || day < signedOn || Date.parse(day) - Date.parse(signedOn) > 10 * 86_400_000) continue;
      if (/financial results|earnings|dividend|quarter ended|buy-?back|repurchase|divest|settlement/i.test(m[0])) continue;
      if (/merger|acquisition|acquire|combination|transaction|agreement|arrangement|offer|deal/i.test(m[0])) days.push(day);
    }
  }
  return days.sort()[0];
}

/**
 * The day a release says it went out, or its 8-K says it did, when that's within ten days before the filing: the exhibit can come days after the
 * release (Greif's 8-K on Ipackchem, six; Earthstone on Independence Resources, five; ProFrac on REV, one). Nothing else: the filing date stands.
 */
export function ownReleaseDay(text: string, fileDate: string): string | undefined {
  const floor = new Date(Date.parse(fileDate) - 10 * 86_400_000).toISOString().slice(0, 10);
  const stated = statedRelease(text, floor);
  // (Not an 8-K's cover: "Date of earliest event reported: May 15, 2014 (May 15, 2014)" is the signing. On the 8-K itself, only the release it says went out.)
  const cover = /\bFORM\s+8-K\b|\bDate of (?:Report|earliest event reported)\b/i.test(text.slice(0, 3000));
  return [...(cover ? [] : datelinesOf(text)), ...(stated ? [stated] : [])].find((d) => d >= floor && d <= fileDate);
}

/**
 * An Item 1.01 goes on to the deal's financing and its other agreements, whose amounts are not the deal: Switch's $300M Land
 * Purchase Agreement, Rallybio's concurrent financing, Hecla's silver stream, Turnstone's asset sale. A wrong value also
 * stops the search for the real one in the release. (Not an implied value "before giving effect to" a placement: Ambros.)
 */
const SIDE_MATTER = /\bwill\s+hold\b[^.]{0,80}\bbusiness\b|\bconcurrent\s+(?:financing|investment|private\s+placement)\b|\bprivate\s+placements?\b|\bdebt\s+(?:financing|commitment)\b|\bbackstop\s+(?:agreement|shares)\b|\btransferred\s+assets\b|\basset\s+purchase\s+agreement\b|\b(?:additional|exchangeable|convertible)\s+(?:[A-Z]\w+\s+){0,2}notes\b|\bstream(?:ing)?\b|\bpreferred\s+(?:stock|shares?)\b|\bpurchase\s+and\s+sale\s+agreement\b|\bland\s+purchase\b|\bletter\s+of\s+intent\b|\basset\s+sale\b|\bsubscri(?:bed\s+to\s+purchase|ption\s+agreement)\b/i;
export const withoutSideMatters = (section: string) =>
  section
    .split(/(?<!\b(?:Inc|Corp|Co|Ltd|L\.P|U\.S|No))\.\s+(?=[A-Z])/)
    .map((s) => {
      const at = s.search(SIDE_MATTER);
      const pipe = s.search(/\bPIPE\b/);
      const first = [at, pipe].filter((n) => n >= 0).sort((a, b) => a - b)[0];
      if (first == null) return s;
      if (/\bbefore\s+giving\s+effect\b/i.test(s) || /\b(?:enterprise|equity)\s+value\s+of\s+(?:(?:[A-Z][\w&.'’-]*\s+){1,4}of\s+)?(?:approximately\s+)?\$\s?\d/i.test(s)) return s;
      const head = s.slice(0, first);
      if (/\bcommon\s+(?:stock|shares?)\b[^;]{0,200}?\b(?:right to receive|aggregate\s+consideration)\b/i.test(head) && /\$\s?\d[\d.,]*\s*(?:million|billion)|\$\s?\d{1,3}(?:,\d{3}){2,}/.test(head)) return head;
      return "";
    })
    .filter(Boolean)
    .join(". ");

export function parseMergerItem(rawText: string, ctx: PressContext): ParsedPress | null {
  // "JTI (US) Holding Inc." is one name, not "Holding Inc." cut at a parenthesis.
  const text = rawText.replace(/\b([A-Z]{2,})\s\((US|USA|U\.S\.)\)\s/g, "$1 $2 ");
  const section = item101(text);
  if (!section) return null;
  const opening = section.slice(0, 3000);
  const entities = definedEntities(opening);
  const byRef = (ref: string) =>
    entities.find((e) => e.nick.toLowerCase() === ref.toLowerCase() || e.alias?.toLowerCase() === ref.toLowerCase()) ?? entities.find((e) => sameCompany(e.name, ref));

  const mech = mechanics(section, entities);
  if (!mech) return null;
  const companyEntity = entities.find((e) => SELF.test(e.nick) || (e.alias != null && SELF.test(e.alias)));
  // The filer's own name, whole, when the defined name is only its end: "Energy Alternatives, Inc." of Infrastructure and Energy Alternatives, Inc.
  const fullFiler = (n: string) => (ctx.filerName.length > n.length && ctx.filerName.toLowerCase().endsWith(` ${n.toLowerCase()}`) ? ctx.filerName : n);
  let targetName = SELF.test(mech.target) ? fullFiler(companyEntity?.name ?? ctx.filerName) : (byRef(mech.target)?.name ?? (isPlausibleName(mech.target) ? mech.target : null));
  if (!targetName) return null;
  // A merger subsidiary is never the target: the mechanics were read backwards, so the Company is.
  if (SHELL_NAME.test(targetName)) {
    targetName = companyEntity?.name ?? ctx.filerName;
    mech.acquirerHint = undefined;
    mech.target = "Company";
  }
  const isTarget = (e: Entity) =>
    sameCompany(e.name, targetName) || e.nick.toLowerCase() === mech.target.toLowerCase() || e.alias?.toLowerCase() === mech.target.toLowerCase();

  // A double merger under a new holding company: "all issued and outstanding common shares of Marvell … will be … converted into the right to receive one share of common stock of HoldCo". The side whose holders swap one for one is the buyer; the other is the target.
  {
    const holdco = entities.find((e) => /\bHoldCo\b/i.test(`${e.nick} ${e.name}`));
    const t = byRef(mech.target);
    if (holdco && t && !SELF.test(t.nick)) {
      const oneForOne = new RegExp(String.raw`\bshares\s+of\s+${t.nick.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\b[^.;]{0,220}?\bright to receive one (?:share|common share|ordinary share)\b[^.;]{0,40}?\b${holdco.nick.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\b`).test(section);
      const other = oneForOne ? entities.find((e) => e !== t && e !== holdco && !/\bSub\b/.test(e.nick) && !SUB_NICK.test(e.nick) && !SHELL_NAME.test(e.name)) : undefined;
      if (other) {
        mech.target = other.nick;
        targetName = other.name;
        mech.acquirerHint = t.nick;
      }
    }
  }
  // Buyer: an explicit hint from the mechanics, else the entity defined as (Ultimate) Parent / Buyer,
  // else the first named party that isn't the target or a merger subsidiary, else the filer.
  let buyer: Entity | undefined;
  // "AvalonBay will merge with and into Merger Sub" (a subsidiary of Equity Residential): the buyer is the parent, found below.
  if (mech.acquirerHint && (SUB_NICK.test(mech.acquirerHint) || SHELL_NAME.test(mech.acquirerHint))) mech.acquirerHint = undefined;
  // A defined term cut short: "will merge with and into the Holding Company" when nothing defines it.
  // (Defined or not, "the Arrangement" is no party: Quipt's "Plan of Arrangement (the "Arrangement")".)
  if (mech.acquirerHint && (/^Arrangement$/i.test(mech.acquirerHint) || (!byRef(mech.acquirerHint) && /^Holding(?: Company)?$/i.test(mech.acquirerHint)))) mech.acquirerHint = undefined;
  if (mech.acquirerHint) buyer = byRef(mech.acquirerHint) ?? { name: cleanPartyName(mech.acquirerHint), nick: mech.acquirerHint, index: 0 };
  for (const nick of BUYER_NICKS) {
    if (buyer) break;
    buyer = entities.find((e) => e.nick.toLowerCase() === nick.toLowerCase() && !isTarget(e));
  }
  // An "Investor" is buying shares, not the company (NovaGold's arrangement with Paulson as "the Investor").
  const investor = (e: Entity) => /^Investors?$/i.test(e.nick) || /^Investors?$/i.test(e.alias ?? "");
  // With no other party left, the merger subsidiaries' parent, a shell too ("Oak Merger Sub 1, Inc., … a wholly owned
  // subsidiary of Ithaca" with Ithaca Holdco, Inc.): a later release names who is behind it. Not before another party: a
  // chain of subsidiaries would stop at its middle (Bitfarms' US subsidiary, a first merger sub, an inversion's holdco).
  // Nor a blank-check company ("Hennessy Capital Acquisition Corp. IV", "Merida Merger Corp. I"): a de-SPAC.
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const vehicleOrSpac = (e: Entity) => /\bMerger\s?Sub(?:sidiary)?\b|\bMerge?Co\b|\bBidco\b|\bPurchaser\b|\b(?:Acquisition|Merger)\s+Corp(?:oration)?\.?(?:\s+[IVX]+\.?)?$/i.test(e.name);
  const parentOfSub = (e: Entity) => !vehicleOrSpac(e) && new RegExp(String.raw`\bsubsidiary of (?:the\s+)?(?:${esc(e.nick)}|${esc(e.name)})(?![\w-])`).test(opening);
  // Nor is the target's own operating partnership, named first in an Up-C deal ("Buzz Holdings L.P., ("Opco")": Bumble);
  // the buyer's is, when the merger sub is its subsidiary (Energy XXI Gulf Coast for EPL).
  // Nor the seller: "NewtekOne, Inc., a Maryland corporation and the sole stockholder of NTS" (Paltalk bought NTS); a parent selling its subsidiary to a named Purchaser (Tiptree / Fortegra).
  const soleOwner = (e: Entity) => new RegExp(String.raw`${esc(e.name)},[^()"“]{0,100}\bthe sole (?:stockholder|shareholder|member|equityholder|owner) of\b`).test(opening);
  const targetEntity = entities.find(isTarget);
  // (In the target's own description, right after its name: not "Qorvo, Inc., Comet Acquisition Corp., a … subsidiary of Skyworks", nor "into Starz, with Starz … becoming a subsidiary of Lions Gate".)
  const sellerNick = targetEntity ? new RegExp(String.raw`${esc(targetEntity.name)},\s+an?\s[^(),;]{0,100}\bsubsidiary of (${entities.filter((e) => e !== targetEntity).map((e) => esc(e.nick)).join("|") || "$^"})\b`).exec(opening)?.[1] : undefined;
  // Nor a party's own subsidiary, or what's being sold: "and its wholly owned subsidiary, Bank of Virginia (the "Bank")" (Cordia), "IGT's Global Gaming and PlayDigital businesses".
  const ownedSub = (e: Entity) => new RegExp(String.raw`\b(?:its|[A-Z][\w'’-]*['’]s)\s+(?:(?:direct|indirect|wholly[- ]owned|principal|banking|bank)\s+){0,3}subsidiary,?\s+(?:the\s+)?${esc(e.name)}`).test(opening);
  const whatIsSold = (e: Entity) => /\b(?:business|businesses|assets|operations)$/.test(e.name);
  const notBuyer = (e: Entity) => isTarget(e) || SUB_NICK.test(e.nick) || SELF.test(e.nick) || investor(e) || soleOwner(e) || e.nick === sellerNick || ownedSub(e) || whatIsSold(e) || (/^(?:Opco|OP|Operating Partnership)$/i.test(e.nick) && !parentOfSub(e));
  if (sellerNick) buyer ??= entities.find((e) => /^Purchaser$/i.test(e.nick) && !SHELL_NAME.test(e.name) && !isTarget(e));
  buyer ??= entities.find((e) => !notBuyer(e) && !SHELL_NAME.test(e.name)) ?? entities.find((e) => !notBuyer(e) && parentOfSub(e));
  // Last, a "Parent" named like the target is still the buyer's ("Winner Holding Limited ("Parent")" for Winner Medical
  // Group, owned by its chairman): who owns it is read below.
  buyer ??= entities.find(
    (e) => BUYER_NICKS.some((n) => n.toLowerCase() === e.nick.toLowerCase()) && e.nick.toLowerCase() !== mech.target.toLowerCase() && normalizeName(e.name) !== normalizeName(targetName),
  );
  // (The same company, not a shared first word: First Internet Bancorp buying First Century Bancorp.)
  if (!buyer && !(normalizeName(ctx.filerName) === normalizeName(targetName) || normalizeName(targetName).startsWith(`${normalizeName(ctx.filerName)} `) || normalizeName(ctx.filerName).startsWith(`${normalizeName(targetName)} `))) buyer = { name: ctx.filerName, nick: "Company", index: 0 };
  // What the 8-K says stands behind the "Parent", whatever it is called: Charlesbank behind CB Neptune Holdings (Quotient).
  // Also with no other party left to read: Quipt's only other defined party was its "Purchaser".
  const behind = buyerBehindParent(flatten(section), targetName);
  if (behind) buyer ??= { name: behind, nick: "Parent", index: 0 };
  if (!buyer) return null;

  // Prefer an ultimate parent / named sponsor over a shell buyer ("Sword Purchaser, LLC ... affiliated with CD&R").
  let acquirerName = buyer.name;
  const ultimate = entities.find((e) => /^(?:Ultimate Parent|Guarantor)$/i.test(e.nick) && !isTarget(e));
  if (ultimate && ultimate !== buyer) acquirerName = ultimate.name;
  // (The buyer's own name stays when the sentence only repeats it: "Tekelec … an affiliate of Siris Capital Group, LLC".)
  else if (behind && (isPlaceholderBuyer(buyer.name) || !sameCompany(behind, buyer.name))) acquirerName = behind;
  else if (
    SHELL_NAME.test(buyer.name) ||
    (BUYER_NICKS.includes(buyer.nick) && sameCompany(buyer.name, targetName)) ||
    /^(?:[A-Z][A-Za-z\-]+ )+(?:Parent|Purchaser|Holdings|Buyer|Bidco|BidCo)\b/.test(buyer.name) ||
    // "Jupiter Company Limited, a company incorporated in Jersey ("Parent")": Janus Henderson's buyer is named later on.
    isPlaceholderBuyer(buyer.name) ||
    // "Parent and Purchaser are newly-formed entities established by a consortium … led by funds affiliated with Elliott"
    new RegExp(`\\b${buyer.nick.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^.]{0,60}\\b(?:are|is) (?:a |an )?newly[- ]formed`).test(section)
  ) {
    const after = section.slice(buyer.index, buyer.index + 400);
    const leads = [
      /(?:affiliated with|an affiliate of|affiliates of|a (?:wholly owned )?subsidiary of|controlled by|formed by|owned by|investor\s+group\s+led\s+by|(?:investor\s+)?consortium\s+(?:comprised|composed|consisting)\s+of)\s+(?:(?:investment )?(?:funds?|vehicles?) (?:managed(?: or advised)?|advised) by\s+)?/.exec(after),
      // (A consortium is named before its members' funds: "an investor consortium comprised of The Public Investment Fund
      // ("PIF"), private investment funds affiliated with Silver Lake …": Electronic Arts.)
      // ("Parent is owned by a consortium comprised of investment funds advised by Apax Partners, and …": Kinetic Concepts.)
      /\b(?:investor\s+)?consortium\s+(?:comprised|composed|consisting)\s+of\s+(?:(?:private\s+)?(?:investment\s+)?funds?\s+(?:managed|advised|sponsored)\s+by\s+)?|(?:investment )?funds? (?:managed|advised|sponsored) by\s+|funds? affiliated with\s+|(?:acquisition|purchase) of the Company by (?:affiliates of |funds (?:managed|advised) by )?(?=[A-Z])/.exec(section),
      // After the above, whose last wording first finds the "acquisition of the Company by Parent": "Funds and investment vehicles
      // that are part of an investor group led by Trian Fund Management, L.P. and General Catalyst Group Management, LLC have provided
      // the Company with limited guarantees" (Janus Henderson).
      /\binvestor\s+group\s+led\s+by\s+(?=[A-Z])/.exec(section),
    ];
    // "a subsidiary of Parent" names a defined term, not a sponsor.
    const isTerm = (s: string) => /^(?:the\s+)?(?:Parent|Purchaser|Buyer|Company|Partnership|Registrant|Trust|Merger Sub)$/i.test(s.trim()) || entities.some((e) => e.nick === s.trim() || e.alias === s.trim());
    for (const [i, lead] of leads.entries()) {
      if (!lead) continue;
      // What a holder signed isn't the buyer: "certain funds affiliated with RA Capital Management, L.P. (collectively, the
      // "Supporting Stockholders")" agreed to tender into Roche's offer for 89bio.
      // Nor who lends the money: "funds managed by Blue Owl … have committed to provide debt financing" (Envestnet).
      if (i >= 1 && /\b(?:Support(?:ing)?\s+(?:Agreements?|Stockholders?|Shareholders?|Holders?)|Voting\s+(?:and\s+Support\s+)?Agreements?)\b/i.test(section.slice(lead.index, lead.index + 300))) continue;
      if (i >= 1 && !/\bequity\b[^.;]{0,80}$/i.test(section.slice(Math.max(0, lead.index - 100), lead.index)) && /\b(?:Lenders?|Debt\s+(?:Financing|Commitment)|committed\s+to\s+provide\s+debt)\b/i.test(section.slice(lead.index, lead.index + 300))) continue;
      const rest = lead.input.slice(lead.index + lead[0].length);
      // Up to a parenthesis, else up to a comma; in the buyer's own description also the comma when the text up to the
      // parenthesis is no name: "Mr. Jianquan Li, the chairman of the Company's board of directors (the …".
      const toParen = /^([A-Z][^()"“;]{1,80}?)\s*\(/.exec(rest);
      const toComma = /^([A-Z][A-Za-z0-9&.'’\- ]{1,80}?)(?=,|(?<!\b(?:Mr|Ms|Mrs|Dr|Jr|St))\.\s|;|\s(?:and|or)\s)/.exec(rest);
      const sponsor = (i === 0 ? [toParen, toComma] : [toParen ?? toComma]).find((s) => {
        if (!s) return false;
        // "the acquisition of the Company by Parent in an all cash transaction" names a defined term too.
        // ("Oracle Corporation" defined as "Oracle" is fine: it starts with its own name.)
        const startsWithTerm = entities.some((e) => s[1].startsWith(`${e.nick} `) && !s[1].startsWith(e.name)) || /^(?:Parent|Purchaser|Buyer|Merger Sub|Sponsors?)\b/.test(s[1]);
        if (/^,\s+the\s+[^,.]{0,60}\bthat\s+(?:indirectly\s+|directly\s+)?controls\b/.test(rest.slice(s[1].length))) return false;
        return !CLAUSE.test(s[1]) && !isTerm(s[1]) && !startsWithTerm && isPlausibleName(cleanPartyName(s[1]));
      });
      if (sponsor) {
        // Joint buyers: "affiliates of funds managed by Blackstone Inc. ("Blackstone") and TPG Capital ("TPG")" (Hologic).
        // (The buyer's own description is cut at 400 characters; the list may run past it.)
        const list = i === 0 ? section.slice(buyer.index + lead.index + lead[0].length) : rest;
        const joint = jointBuyers(list.slice(0, 500));
        acquirerName = joint && isPlausibleName(joint) ? joint : cleanPartyName(sponsor[1]);
        break;
      }
    }
  }
  // (Not by a shared first word when the buyer is the filer: First Internet Bancorp, First Century Bancorp.)
  if (!isPlausibleName(acquirerName) || (sameCompany(acquirerName, targetName) && !(acquirerName === ctx.filerName && normalizeName(acquirerName).split(" ")[0] === normalizeName(targetName).split(" ")[0] && normalizeName(acquirerName) !== normalizeName(targetName) && !normalizeName(targetName).startsWith(`${normalizeName(acquirerName)} `) && !normalizeName(acquirerName).startsWith(`${normalizeName(targetName)} `))) || /^(?:Parent|Purchaser|Buyer|Company|Partnership|Registrant|Trust|Merger Sub)$/i.test(acquirerName)) return null;

  // An amendment to an agreement already announced ("First Amendment to Agreement and Plan of Merger. As previously
  // announced, …") updates that deal and never creates one: Vista Outdoor's amendment listed Revelyst first, which
  // made a second deal with Revelyst as the buyer.
  // "As previously announced" alone is not enough: the signing 8-K itself, filed days after the press release, often
  // opens "As previously announced, on April 26, 2021, W. R. Grace & Co. … entered into an Agreement and Plan of Merger".
  const lead = section.slice(0, 400);
  const leadLong = section.slice(0, 900);
  const amendment = /\b(?:(?:First|Second|Third|\w+)\s+Amendment|Amendment\s+No\.?\s*\d+)\s*(?:\([^()]{0,80}\)\s*)?to\s+(?:the\s+|its\s+)?(?:previously\s+announced\s+)?(?:Agreement and Plan of Merger|Merger Agreement|Transaction Agreement|Arrangement Agreement)\b|(?<=\.\s)Amendment\s+to\s+(?:the\s+)?(?:Agreement and Plan of Merger|Merger Agreement)\b/i.test(leadLong);
  const signing = /\bentered\s+into\s+(?:an?|the)\s+(?:(?:Amended and Restated|definitive)\s+)?(?:Agreement and Plan of (?:Merger|Reorganization)|Merger Agreement|Transaction Agreement|Arrangement Agreement|Business Combination Agreement)\b/i.test(lead);
  // The restated signing date: a later 8-K restating it (an extension, a vote) is an update (applyParsed in deals.ts).
  // Without a date there is no telling, so it stays an update.
  const previously = /\bAs previously (?:announced|reported|disclosed)\b/i.test(lead);
  const signedText = signing && previously ? /\bon\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4})/.exec(lead)?.[1] : undefined;
  const kind = amendment || (previously && !isoDate(signedText)) ? ("update" as const) : ("announcement" as const);
  // The signing date it states: "On February 3, 2026, Webster Financial Corporation … entered into a Transaction
  // Agreement" (filed February 6). An amendment's lead says it too, with no "As previously" (Emeren's, months on).
  const onDate = signing ? /\bOn\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4})\s*,/.exec(lead)?.[1] : undefined;
  const signedOn = isoDate(signedText) ?? isoDate(onDate);
  // The release, when the 8-K says when it went out: the announcement, which the signing usually comes a day or a weekend
  // before.
  const announcedOn = signedOn ? statedRelease(text, signedOn) : null;
  const consideration: Consideration | null = extractConsideration(section.slice(0, 5000));
  const value = extractValue(withoutSideMatters(section), { agreement: true });
  return {
    kind,
    headline: `${acquirerName} to acquire ${targetName} (8-K Item 1.01)`,
    acquirer: { name: acquirerName, ticker: null, exchange: null },
    target: { name: targetName, ticker: null, exchange: null },
    pricePerShare: (amendment ? (reducedPrice(section) ?? raisedPrice(section)) : null) ?? extractMergerPrice(section),
    ...((amendment && reducedPrice(section) != null) || /\bamends and restates the Agreement and Plan of Merger\b|\bAmended and Restated (?:Agreement and Plan of Merger|Merger Agreement)\b/i.test(section.slice(0, 2500)) ? { priceCut: true } : {}),
    premiumPct: null,
    valueUsd: value?.usd ?? null,
    valueKind: value?.kind ?? null,
    consideration,
    acquirerAdvisors: [],
    targetAdvisors: [],
    item101: true,
    // A scheme of arrangement is how a listed foreign company is taken over (Newcrest on the ASX); a US-listed one has resolved as public before this matters (Horizon, Nielsen).
    // So is a circular the target files with a foreign exchange (Vitesse / Lucero, TSXV).
    ...(/\b(?:scheme of arrangement|Scheme Implementation)\b/i.test(section) || circularAbroad(flatten(text), targetName) ? { targetListedAbroad: true } : {}),
    // (Also an agreement restated at a higher price: Squarespace's, signed again at $46.50 under the same shell.)
    ...(amendment || /\bamends and restates the Agreement and Plan of Merger\b|\bAmended and Restated (?:Agreement and Plan of Merger|Merger Agreement|Transaction Agreement|Arrangement Agreement)\b/i.test(section.slice(0, 2500)) ? { amended: true } : {}),
    ...(signedOn ? { signedOn } : {}),
    ...(announcedOn ? { announcedOn } : {}),
    ...(buyInOf(section) != null ? { buyIn: buyInOf(section)! } : {}),
    ...(signing && kind === "announcement" && endsEarlierAgreement(text) ? { endsEarlierAgreement: true } : {}),
  };
}

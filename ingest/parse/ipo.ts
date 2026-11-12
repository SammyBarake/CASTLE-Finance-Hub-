/**
 * Extract IPO terms from registration statements (S-1 / F-1 and amendments)
 * and final prospectuses (424B4). Pure functions over plain text.
 */
import { findBanks } from "../../lib/banks";
import { flatten } from "../text";

const num = (s: string) => Number(s.replace(/,/g, ""));

/** Filing-fee table: "Maximum Aggregate Offering Price ... $100,000,000". */
export function extractMaxAggregate(text: string): number | null {
  const t = flatten(text);
  const re = /maximum\s+aggregate\s+offering\s+price[\s\S]{0,600}?\$\s?([\d,]{6,}(?:\.\d{2})?)/gi;
  let best: number | null = null;
  for (const m of t.matchAll(re)) {
    const v = num(m[1]);
    // Largest amount near the header is the total row.
    if (v >= 1e6 && v < 5e10 && (best == null || v > best)) best = v;
  }
  return best;
}

/**
 * "between $17.00 and $19.00 per share" -> 18. Also "between $21.00 and $24.00 per Class A ordinary share" (vVARDIS),
 * "between US$4.00 and US$6.00" (Green Solar), "Offering Price: $4 to $5 per Class A Ordinary Share" (Neucleus),
 * "in the range of $8.00 to $9.00", "US$[4] to US$[6]" (MediaOn's bracketed draft figures). A single expected price is a
 * range of one.
 */
export function extractPriceRange(text: string): { low: number; high: number } | null {
  const t = flatten(text.slice(0, 120_000)).replace(/\b(?:USD?|U\.S\.)\s?\$/g, "$").replace(/\$\s?\[\s?(\d{1,4}(?:\.\d{1,2})?)\s?\]/g, "$$$1");
  const P = String.raw`\$\s?(\d{1,4}(?:\.\d{1,2})?)`;
  const UNIT = String.raw`(?:share|ADS|American Depositary Share|unit|ordinary share|common share)\b`;
  const m =
    new RegExp(String.raw`between\s+${P}\s+and\s+${P}(?:\s+per\s+(?:[\w-]+\s+){0,4}?${UNIT}|\s*[.,;)])`, "i").exec(t) ??
    new RegExp(String.raw`(?:range of|price range of|Offering Price:?|offering price (?:is expected to be|will be)(?: between)?)\s+${P}\s+(?:to|-|–)\s+${P}(?:\s+per\s+(?:[\w-]+\s+){0,4}?${UNIT})?`, "i").exec(t) ??
    // Not a dilution sentence's "would increase from $4.10 to $4.35 per share".
    new RegExp(String.raw`(?<!\bfrom\s{1,3})${P}\s+(?:to|-|–)\s+${P}\s+per\s+(?:[\w-]+\s+){0,4}?${UNIT}`, "i").exec(t) ??
    // "the initial public offering price range of $4.00 and $5.00" (Gravity AI).
    new RegExp(String.raw`\brange of\s+${P}\s+and\s+${P}`, "i").exec(t);
  if (m) {
    const low = Number(m[1]);
    const high = Number(m[2]);
    return low > 0 && high >= low && high < 1000 ? { low, high } : null;
  }
  // A small IPO often states one expected price: "We anticipate that the initial public offering price of our shares will be
  // $10.00 per share" (Cortigent), "It is currently estimated that the initial public offering price per share will be US$4"
  // (Zensitive). Not a range's first figure, and not "between $[●] and $[●]".
  const one = new RegExp(String.raw`\b(?:anticipate|expect|estimated?)\b[^.$]{0,80}?\boffering price\b[^.$]{0,40}?\b(?:will be|to be|is)\s+${P}(?!\s*(?:to|and|-|–)\s*\$)`, "i").exec(t);
  const price = one ? Number(one[1]) : 0;
  return price > 0 && price < 1000 ? { low: price, high: price } : null;
}

/** Shares offered on the cover: "15,000,000 Shares" / "We are offering 10,000,000 shares". */
export function extractSharesOffered(text: string): number | null {
  const t = flatten(text.slice(0, 40_000));
  // A registration carrying a second, resale prospectus describes it first: "A prospectus to be used for the resale by
  // Selling Shareholders of 1,470,000 ordinary shares" is not the offering (Sin Lian Seng).
  const sentenceBefore = (i: number) => t.slice(Math.max(0, i - 120), i).split(/[.●•]\s/).at(-1)!;
  const first = (re: RegExp) => [...t.matchAll(re)].find((m) => !/\bresale\b|\bselling (?:share|stock|security)holders?\b/i.test(sentenceBefore(m.index!)));
  // One firm-commitment offering by the company and its holders: "We and the Selling Shareholders … are offering, on a firm
  // commitment basis, 3,000,000 Class A Ordinary Shares and 2,900,000 Class A Ordinary Shares, respectively" (MediaOn).
  const both = /\bwe and the selling (?:share|stock)holders\b[^.]{0,160}?\bare offering\b[^.]{0,120}?(\d{1,3}(?:,\d{3}){2,})[^.]{0,100}?\band\s+(\d{1,3}(?:,\d{3}){2,})[^.]{0,100}?\brespectively\b/i.exec(t);
  if (both) return num(both[1]) + num(both[2]);
  const m =
    // "15,000,000 Shares", "34,311,274 Ordinary Shares" (Klarna), "11,923,018 Class A Common Shares" (eToro).
    // "3,750,000 Class A Shares" (Green Solar).
    first(/(\d{1,3}(?:,\d{3}){2,})\s+(?:Class [A-C]\s+)?(?:(?:Ordinary|Common|ordinary|common)\s+)?(?:Shares|shares|American Depositary Shares|ADSs|Units|units)\b/g) ??
    first(/(\d{1,3}(?:,\d{3}){2,})\s+Shares\s+of\s+(?:Class [A-C]\s+)?Common Stock\b/gi) ??
    first(/(?:we are|are) offering\s+(\d{1,3}(?:,\d{3}){2,})\s+(?:(?:Class [A-C]\s+)?(?:ordinary|common)\s+)?(?:shares|American Depositary Shares|ADSs)/gi);
  if (!m) return null;
  const v = num(m[1]);
  return v >= 100_000 && v < 5e9 ? v : null;
}

/** Final offer price from a 424B4 cover. */
export function extractOfferPrice(text: string): number | null {
  // Foreign issuers write "US$": "The initial public offering price per ADS is US$22.00", "PRICE US$22.00 PER ADS"
  // (Londian Wason), "The initial public offering price of the ADSs is US$149.00 per ADS" (SK hynix).
  const t = flatten(text.slice(0, 60_000)).replace(/\b(?:USD?|U\.S\.)\s?\$/g, "$");
  const m =
    /(?:initial\s+)?public\s+offering\s+price\s+(?:is|of|per\s+(?:share|ADS))\s+\$\s?(\d{1,4}(?:\.\d{2}))/i.exec(t) ??
    /public\s+offering\s+price\s+of\s+(?:the|our)\s+(?:ADSs|shares|ordinary shares|common shares|common stock)\s+is\s+\$\s?(\d{1,4}\.\d{2})/i.exec(t) ??
    // "PRICE $23.00 A SHARE" and the fee table's "Price to Public … Per Share $23.00" (SailPoint).
    /\bPRICE\s+\$\s?(\d{1,4}\.\d{2})\s+(?:A|PER)\s+(?:SHARE|ADS)\b/i.exec(t) ??
    /Price to (?:the )?Public[^$]{0,250}?\bPer (?:Share|ADS)\s+\$\s?(\d{1,4}\.\d{2})/i.exec(t) ??
    // "The initial public offering price per share of our Class A common stock is $33.00" (Figma, Reddit, Navan).
    /public\s+offering\s+price\s+per\s+(?:share|ADS|ordinary share|common share)[^$.]{0,80}?\bis\s+\$\s?(\d{1,4}\.\d{2})/i.exec(t) ??
    /Public offering price\s+\$\s?(\d{1,4}(?:\.\d{2}))/i.exec(t) ??
    /at\s+\$\s?(\d{1,4}\.\d{2})\s+per\s+(?:share|ADS)/i.exec(t);
  if (!m) return null;
  const v = Number(m[1]);
  return v > 0 && v < 1000 ? v : null;
}

/** Bookrunners named on the prospectus cover (before the table of contents). */
export function extractUnderwriters(text: string): string[] {
  const t = text.slice(0, 80_000);
  const toc = t.search(/table of contents/i);
  // The cover usually ends at the first TOC; some covers repeat a TOC link at the top.
  const coverEnd = toc > 1500 ? toc : Math.min(t.length, 25_000);
  const cover = t.slice(0, coverEnd);
  // The fee table and legal boilerplate can mention banks in other roles; the cover
  // lists bookrunners near its end, so prefer the last ~6k characters.
  const tail = cover.slice(-6000);
  const banks = findBanks(tail);
  return banks.length ? banks : findBanks(cover);
}

/**
 * Every underwriter, from the "Underwriting" section's table ("Name  Number of Shares  Morgan Stanley & Co. LLC …"),
 * leads first. Covers that show the lead banks as logos (Figma, Reddit, Hinge Health) name only the co-managers in
 * text. The first such table naming a bank: compensation tables ("Name  Number of Shares Underlying RSUs") come earlier.
 */
export function extractUnderwritingTable(text: string): string[] {
  const t = flatten(text);
  for (const m of t.matchAll(/\b(?:Underwriters?|Name)\s+Number\s+of\s+(?:Shares|ADSs|Ordinary Shares|Class A|Common Shares|Units)\b/gi)) {
    // A large syndicate runs past 3,000 characters (SB Energy's 21 banks, Nscale's 23): read to the table's "Total" row.
    const seg = t.slice(m.index!, m.index! + 9000);
    const end = seg.search(/\bTotal\b/);
    const banks = findBanks(end >= 0 ? seg.slice(0, end) : seg.slice(0, 3000));
    if (banks.length) return banks;
  }
  return [];
}

/** First sentence of the prospectus summary "Overview". */
export function extractDescription(text: string): string | null {
  const t = text.slice(0, 700_000);
  const heads = [...t.matchAll(/\n\s*(?:Overview|Our Company|Our Business|Company Overview|Business Overview)\s*\n/gi)];
  for (const h of heads) {
    const after = t.slice(h.index! + h[0].length, h.index! + h[0].length + 1500);
    const para = flatten(after.split(/\n/).find((l) => l.trim().length > 80) ?? "");
    // Not "by Mr. Brindle as a specialty (re)insurance business and commenced underwriting in 2015." (TFP Group), nor
    // "Second Sight Medical Products, Inc. ("Second Sight"), is a pioneer" (Cortigent): a title never ends a sentence, and
    // none goes on in lower case or with a bracket. "… the holding company of AMATUHI Inc. We …" does end.
    const sentence = /^(.{40,260}?[a-z0-9)]\.(?<!\b(?:Mr|Ms|Mrs|Dr|No|St|Jr|Sr|Co)\.))(?:\s+(?![a-z(])|$)/.exec(para)?.[1];
    if (sentence && !/prospectus|forward-looking|this summary/i.test(sentence)) return sentence;
  }
  return null;
}

/**
 * Bump after changing these parsers: stored pipeline records are then re-read on the next ingest.
 * 5: US$ prices and the cover table's total (SK hynix, Londian Wason).
 * 8: underwriters added to the bank list (Vogenx, Londian Wason, Jersey Mike's), the priced date from the cover, a stored
 * placeholder raise cleared (Anthropic), second-step conversions dropped (Columbia Financial), whole descriptions (TFP Group).
 */
// 9: a registration's raise is the range midpoint × base shares (wider range wordings), never the fee-table maximum; its
// underwriters come from its own underwriting table, read to the "Total" row; a conversion's midpoint and selling agent; a
// year split in the text ("20 26"); a resale prospectus's share count skipped (November 11 2026 check of the live pipeline).
export const IPO_PARSER_VERSION = 9;

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const COVER_DATE = /(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.? (\d{1,2}) ?, ?(\d{4}|\d{2} \d{2}|\d{3} \d)/.source;

/**
 * The date on a final prospectus, if it falls within ten days before the filing: "The date of this prospectus is March 5,
 * 2015" and "Prospectus dated October 22, 2026" (Lycia), or a bare date closing the cover, right before the table of
 * contents (Orion180: "September 17, 2026 Table of contents"). The year may come apart in the text ("August 5, 20 26":
 * Braveheart; "September 29, 202 6": Accelevation). The 424B4 lands up to four days after pricing (Orion180,
 * ADARx). "Prospectus dated" and the bare date only on the cover: further in, either can be another document's date.
 */
export function prospectusDate(text: string, filedDate: string): string | null {
  const t = flatten(text.slice(0, 200_000));
  const cover = t.slice(0, 30_000);
  const m =
    new RegExp(`\\bdate of this prospectus is ${COVER_DATE}`, "i").exec(t) ??
    new RegExp(`\\b(?:Prospectus|PROSPECTUS) (?:dated|DATED) ${COVER_DATE}`).exec(cover) ??
    new RegExp(`\\b${COVER_DATE}\\.? (?:Table of Contents|Table of contents|TABLE OF CONTENTS)\\b`).exec(cover);
  const month = m && MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (!m || !month) return null;
  const iso = `${m[3].replace(/ /g, "")}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const days = (Date.parse(filedDate) - Date.parse(iso)) / 86_400_000;
  return days >= 0 && days <= 10 ? iso : null;
}

/**
 * A second-step conversion: a listed mid-tier holding company re-registers on a new CIK, so the already-public test finds
 * no earlier report, and sells the mutual holding company's stake while the public's shares are exchanged. Not a new
 * listing: Columbia Financial's S-1 ("The "second-step" conversion process that we are now undertaking …", "currently owned
 * by the public will be exchanged", "currently listed on the Nasdaq Global Select Market under the trading symbol "CLBK"").
 * The conversion wording alone isn't enough: a first-step minority offering can mention a later second step. A first-time
 * conversion stays (Hometown Financial: "the Plan of Conversion of Hometown Financial Group, MHC", "no current public or
 * private market").
 */
export function isSecondStepConversion(text: string): boolean {
  const head = flatten(text.slice(0, 80_000));
  if (!/\bplan of conversion and reorganization\b|\bsecond[- ]step\W{0,2}\s*(?:conversion|offering)\b/i.test(head)) return false;
  return /\b(?:owned|held) by (?:the )?public(?: (?:stock|share)holders)?\b[^.]{0,120}\bwill be exchanged\b/i.test(head) || /\bcommon stock is currently (?:listed|quoted|traded) on\b/i.test(head);
}

/**
 * A registration that isn't an IPO offering: a direct listing (holders resell on the exchange, nothing is sold or
 * underwritten: Advasa, Ionic Digital), or selling holders reselling with no underwriters after a SPAC merger
 * (Securitize, Suncrete). An underwritten IPO where only existing holders sell (Innio, sold entirely by its private-
 * equity owner) is still an IPO, so `underwriters` (the recognised bookrunners) keeps it.
 */
export function isResaleOnly(text: string, underwriters: string[] = []): boolean {
  const head = flatten(text.slice(0, 80_000));
  const cover = head.slice(0, 30_000);
  if (/\bdirect listing\b|\bRegistered (?:Stockholders|Shareholders)\b/i.test(cover)) return true;
  // "We are offering 10,000,000 shares", "Accelevation Holdings Corp. is offering", "we are selling", "shares offered
  // by us": the company sells shares (selling holders may sell alongside it). The prospectus cover can sit after a
  // long facing sheet, hence the wider window.
  const primary =
    [...head.matchAll(/([\w.]+)\s+(?:is|are)\s+(?:offering|selling|issuing)\b/gi)].some((m) => !/holders?$/i.test(m[1])) ||
    /\b(?:offered|sold|issued) by (?:us|the company)\b/i.test(head) ||
    // "We and the Selling Shareholders (as defined herein) are offering, on a firm commitment basis, …" (MediaOn)
    /\bwe and the selling (?:stock|share|security)holders\b[^.]{0,80}\bare offering\b/i.test(head) ||
    /(?<!\bnot\b[^.]{0,40})\bfirm[- ]commitment\b/i.test(cover);
  if (primary) return false;
  const noProceeds = /will not receive any (?:of the )?(?:net )?proceeds/i.test(cover) || /consummated (?:its|the) (?:previously announced )?business combination/i.test(cover);
  return noProceeds && underwriters.length === 0;
}

export interface IpoTerms {
  expectedRaiseUsd: number | null;
  offerPrice: number | null;
  underwriters: string[];
  description: string | null;
  /** The registration's fee-table maximum: not shown, only a size test (ingest/ipos.ts). */
  registeredMaxUsd?: number | null;
}

/**
 * Initial S-1s commonly register a round figure "for fee purposes" before any real sizing: usually $100,000,000, and
 * $1,000,000,000 for a very large company (Anthropic's S-1/A, with no price range yet). Real sizing is shares × price, and
 * never lands on a round multiple of $50M.
 */
export const isPlaceholderRaise = (usd: number | null) => usd != null && usd >= 100_000_000 && usd % 50_000_000 === 0;

/**
 * A mutual holding company's conversion sells at a fixed $10.00 within an appraisal range: "Minimum Midpoint Maximum
 * Adjusted Maximum … Gross offering proceeds $ 510,000,000 $ 600,000,000 …" (Hometown Financial). The midpoint.
 */
export function conversionMidpoint(text: string): number | null {
  const m = /\bMinimum\s+Midpoint\s+Maximum\b[\s\S]{0,600}?\bGross (?:offering )?proceeds\s+\$\s?([\d,]{7,})\s+\$\s?([\d,]{7,})/i.exec(flatten(text.slice(0, 120_000)));
  if (!m) return null;
  const v = num(m[2]);
  return v >= 1e6 && v < 5e10 && v > num(m[1]) ? v : null;
}

/**
 * The bank selling a conversion offering, which has no underwriting table: "a discussion of Keefe, Bruyette & Woods,
 * Inc.'s compensation" under "Selling Agent and Underwriter Compensation", "has engaged Piper Sandler … as marketing agent".
 */
export function sellingAgents(text: string): string[] {
  const t = flatten(text);
  const found: string[] = [];
  for (const m of t.matchAll(/\b(?:selling|marketing) agent\b/gi)) {
    for (const b of findBanks(t.slice(Math.max(0, m.index! - 250), m.index! + 250))) if (!found.includes(b)) found.push(b);
    if (found.length) break;
  }
  return found;
}

/**
 * Terms from a registration statement (pre-pricing). The expected raise is the price range's midpoint × the base shares on
 * the cover, else the conversion appraisal's midpoint. Never the fee table's "maximum aggregate offering price": it adds the
 * over-allotment at the top of the range, and sometimes the underwriters' warrants (Green Solar, Cafe Deco, Neucleus: about a
 * third above the cover's own figure), and an amendment without a range would keep the first filing's. That maximum is kept
 * apart (`registeredMaxUsd`), only to tell a tiny self-underwritten offering from a real one.
 */
export function parseRegistration(mainText: string, feeText: string | null): IpoTerms {
  const range = extractPriceRange(mainText);
  const shares = extractSharesOffered(mainText);
  const mid = range ? (range.low + range.high) / 2 : null;
  const fromRange = mid && shares ? mid * shares : mid ? extractOfferingTotal(mainText, mid) : null;
  const feeRaw = extractMaxAggregate(feeText ?? mainText);
  const table = extractUnderwritingTable(mainText);
  const underwriters = table.length ? table : extractUnderwriters(mainText);
  return {
    expectedRaiseUsd: fromRange ?? conversionMidpoint(mainText),
    registeredMaxUsd: isPlaceholderRaise(feeRaw) ? null : feeRaw,
    offerPrice: null,
    underwriters: underwriters.length ? underwriters : sellingAgents(mainText),
    description: extractDescription(mainText),
  };
}

/**
 * The cover table's total at the offer price: "Per ADS Total Public offering price US$ 149.0000 US$ 26,507,100,000".
 * SK hynix's cover counts "17,790,000 Common Shares Represented by American Depositary Shares" while the price is per
 * ADS (a tenth of a share), so price × cover shares was ten times too small. Only when the table's price is the offer
 * price.
 */
export function extractOfferingTotal(text: string, price: number): number | null {
  const t = flatten(text.slice(0, 60_000)).replace(/\b(?:USD?|U\.S\.)\s?\$/g, "$");
  const m = /Public offering price(?:\s?\(\d\))?\s+\$\s?(\d{1,4}(?:\.\d{1,4})?)\s+\$\s?(\d{1,3}(?:,\d{3}){2,}(?:\.\d{1,2})?)/i.exec(t);
  if (!m || Math.abs(Number(m[1]) - price) > 0.005) return null;
  // A best-efforts "Total Minimum Offering / Total Maximum Offering" table: the first total is the minimum.
  if (/minimum/i.test(t.slice(Math.max(0, m.index - 120), m.index))) return null;
  const v = num(m[2]);
  return v >= 1e6 && v < 1e11 ? v : null;
}

/** Terms from the final prospectus (424B4). */
export function parseFinalProspectus(text: string): IpoTerms {
  const price = extractOfferPrice(text);
  const shares = extractSharesOffered(text);
  return {
    expectedRaiseUsd: price ? (extractOfferingTotal(text, price) ?? (shares ? price * shares : null)) : null,
    offerPrice: price,
    underwriters: extractUnderwritingTable(text).length ? extractUnderwritingTable(text) : extractUnderwriters(text),
    description: extractDescription(text),
  };
}

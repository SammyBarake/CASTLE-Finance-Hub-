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

/** "between $17.00 and $19.00 per share" -> 18 */
export function extractPriceRange(text: string): { low: number; high: number } | null {
  const m = /between\s+\$\s?(\d{1,4}(?:\.\d{2})?)\s+and\s+\$\s?(\d{1,4}(?:\.\d{2})?)\s+per\s+(?:share|ADS|American Depositary Share|unit)/i.exec(flatten(text));
  if (!m) return null;
  const low = Number(m[1]);
  const high = Number(m[2]);
  return low > 0 && high >= low && high < 1000 ? { low, high } : null;
}

/** Shares offered on the cover: "15,000,000 Shares" / "We are offering 10,000,000 shares". */
export function extractSharesOffered(text: string): number | null {
  const t = flatten(text.slice(0, 40_000));
  const m =
    /(\d{1,3}(?:,\d{3}){2,})\s+(?:Shares|shares|American Depositary Shares|ADSs|Units)\b/.exec(t) ??
    /(?:we are|are) offering\s+(\d{1,3}(?:,\d{3}){2,})\s+(?:shares|American Depositary Shares|ADSs)/i.exec(t);
  if (!m) return null;
  const v = num(m[1]);
  return v >= 100_000 && v < 5e9 ? v : null;
}

/** Final offer price from a 424B4 cover. */
export function extractOfferPrice(text: string): number | null {
  const t = flatten(text.slice(0, 60_000));
  const m =
    /(?:initial\s+)?public\s+offering\s+price\s+(?:is|of|per\s+(?:share|ADS))\s+\$\s?(\d{1,4}(?:\.\d{2}))/i.exec(t) ??
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

/** First sentence of the prospectus summary "Overview". */
export function extractDescription(text: string): string | null {
  const t = text.slice(0, 700_000);
  const heads = [...t.matchAll(/\n\s*(?:Overview|Our Company|Our Business|Company Overview|Business Overview)\s*\n/gi)];
  for (const h of heads) {
    const after = t.slice(h.index! + h[0].length, h.index! + h[0].length + 1500);
    const para = flatten(after.split(/\n/).find((l) => l.trim().length > 80) ?? "");
    const sentence = /^(.{40,260}?[a-z)]\.)(?:\s|$)/.exec(para)?.[1];
    if (sentence && !/prospectus|forward-looking|this summary/i.test(sentence)) return sentence;
  }
  return null;
}

/** Bump after changing these parsers: stored pipeline records are then re-read on the next ingest. */
export const IPO_PARSER_VERSION = 2;

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
}

/** Terms from a registration statement (pre-pricing). */
/** Initial S-1s commonly register a round $100,000,000 "for fee purposes" before any real sizing. */
export const PLACEHOLDER_RAISE = 100_000_000;

export function parseRegistration(mainText: string, feeText: string | null): IpoTerms {
  const range = extractPriceRange(mainText);
  const shares = extractSharesOffered(mainText);
  const fromRange = range && shares ? ((range.low + range.high) / 2) * shares : null;
  const feeRaw = extractMaxAggregate(feeText ?? mainText);
  const fee = feeRaw === PLACEHOLDER_RAISE ? null : feeRaw;
  return {
    expectedRaiseUsd: fromRange ?? fee,
    offerPrice: null,
    underwriters: extractUnderwriters(mainText),
    description: extractDescription(mainText),
  };
}

/** Terms from the final prospectus (424B4). */
export function parseFinalProspectus(text: string): IpoTerms {
  const price = extractOfferPrice(text);
  const shares = extractSharesOffered(text);
  return {
    expectedRaiseUsd: price && shares ? price * shares : null,
    offerPrice: price,
    underwriters: extractUnderwriters(text),
    description: extractDescription(text),
  };
}

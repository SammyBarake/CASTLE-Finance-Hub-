/** Company-name helpers shared by the parsers. */

const SUFFIXES =
  /\b(the|inc|incorporated|corp|corporation|company|co|ltd|limited|plc|llc|l\.?l\.?c|lp|l\.?p|n\.?v|s\.?a|ag|se|holdings?|group|trust|bancorp|bancshares|technologies|international|enterprises?)\b\.?/gi;

/** "Copart, Inc." -> "copart"; "The Baldwin Group, Inc." -> "baldwin" */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]s\b/g, "")
    .replace(SUFFIXES, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Loose match between two company names (handles short forms like "ACV" vs "ACV Auctions Inc."). */
export function sameCompany(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const shorter = x.length <= y.length ? x : y;
  const longer = shorter === x ? y : x;
  if (shorter.length >= 3 && (longer.startsWith(shorter + " ") || longer === shorter)) return true;
  const fx = x.split(" ")[0];
  const fy = y.split(" ")[0];
  return fx.length >= 4 && fx === fy;
}

/** Strip leading qualifiers and trailing noise from a party name captured by a regex. */
export function cleanPartyName(raw: string): string {
  let s = raw
    .replace(/\s+/g, " ")
    .replace(/\((?:the )?"[^"]*"\)/g, "")
    .replace(/\((?:NYSE|NASDAQ|Nasdaq|TSX|TSXV|OTC)[^)]*\)/gi, "")
    .trim();
  s = s.replace(
    /^(?:certain |an? )?(?:affiliates? of|entities (?:affiliated with|managed by)|funds? (?:managed|advised) by|an? (?:newly formed )?entity (?:to be )?(?:formed|owned|controlled) by|an? subsidiary of|a wholly[- ]owned subsidiary of|an investor group led by|investment funds? (?:managed|advised) by)\s+/i,
    "",
  );
  // A name never spans sentences: cut at ". Capital" unless the period ends an abbreviation (Inc., Co., J.P., H.I.G.).
  const sentenceBreak = /(?<!\b(?:Inc|Corp|Co|Ltd|Bros|Mfg|Intl|L\.P|N\.V|S\.A|[A-Z]))\.\s+(?=[A-Z])/.exec(s);
  if (sentenceBreak) s = s.slice(0, sentenceBreak.index);
  // "AkzoNobel, that certain Joinder Agreement, dated ..." -> "AkzoNobel"
  s = s.replace(/,\s+(?:that certain|dated|pursuant|as amended)\b.*$/i, "");
  // "Delaware corporation, American Family Mutual" -> "American Family Mutual"
  s = s.replace(/^(?:an?\s+)?(?:[A-Z][a-z]+\s){1,2}(?:corporation|limited liability company|limited partnership|company),\s+(?=[A-Z])/, "");
  // "Investor Group Led by Chairman and CEO Thomas Priore" -> "Investor Group Led by Thomas Priore"
  s = s.replace(/\b(?:its |the Company's )?(?:(?:Co-)?Chairman|Chief Executive Officer|CEO|Founder|President)(?:,? and (?:(?:Co-)?Chairman|Chief Executive Officer|CEO|Founder|President))*\s+(?=[A-Z])/g, "");
  // A headline verb ends the name: "Mantle Therapeutics and Announces Multiple …", "Abiomed Broadens MedTech",
  // "Wavedash Leading Online Ticket Marketplace …", "Community Bancorporation Company Release".
  s = s.replace(/\s+and\s+(?:Announces?|Reports?|Provides?|Enters?|Completes?|Launch(?:es)?|Receives?|Expands?|Updates?|Unveils?|Appoints?|Strengthens?)\b.*$/i, "");
  s = s.replace(/\s+(?:Adds|Expands|Broadens|Announces|Strengthens|Bolsters|Extends|Enters|Launches|Completes|Acquires|Joins|Becomes|Unveils|Accelerates|Deepens|Enhances)\b.*$/, "");
  s = s.replace(/\s+(?:a\s+)?(?:Leading|Premier)\s+[A-Z].*$/, "");
  s = s.replace(/\s+Company\s+(?:Release|Has|Announces|Today)\b.*$/i, "");
  // "PRIVATELY HELD TENEOBIO", "UK-BASED CORETRAX", "family-owned Acme" -> the name itself
  s = s.replace(/^(?:privately[- ](?:held|owned)|family[- ]owned|[A-Za-z.]+-based)\s+(?=\S)/i, "");
  s = s.replace(/['’]s$/, "");
  s = s.replace(/[\s,;:\-–]+$/g, "").replace(/^["'\s]+|["'\s]+$/g, "");
  // Keep "Inc." / "Co." periods, drop a stray trailing sentence period otherwise.
  if (/\.$/.test(s) && !/\b(?:Inc|Corp|Co|Ltd|L\.P|N\.V|S\.A|[A-Z])\.$/.test(s)) s = s.slice(0, -1);
  return s;
}

// Shared with the site, which applies the same rules to records stored before they existed.
export { titleCaseCaps } from "../../lib/names";

/** Buyer names that are really acquisition vehicles or defined terms, to be replaced by a better name when one arrives. */
export const isPlaceholderBuyer = (name: string) =>
  /^(?:the\s+)?(?:Parent|Purchaser|Buyer|Acquir[eo]r|Merger Sub|Company|Investor Group|Consortium)$/i.test(name.trim()) ||
  /\b(?:Merger Sub|MergeCo|Bidco|BidCo|Topco|TopCo|Midco|Holdco|HoldCo|ParentCo|Purchaser|Acquisition (?:Corp|Co|LLC|Inc))\b/.test(name) ||
  /^(?:[A-Z][A-Za-z]+ )+(?:Parent|Buyer)(?:,? (?:Inc|LLC|L\.?P|Corp)\.?)?$/.test(name) ||
  /^Acquiror\b/.test(name);

export const isPlausibleName = (s: string | null | undefined): s is string =>
  !!s &&
  s.length >= 2 &&
  s.length <= 90 &&
  /[A-Za-z]/.test(s) &&
  !/^(it|we|the company|company|shareholders|stockholders)$/i.test(s) &&
  // Clause fragments, not names: "The board of directors of the Company", "Merger On August 1, 2026".
  !/\b(?:board of directors|that certain|special committee|net to the|without interest|per share|Exchange Commission|(?:closing )?stock price|closing price)\b/i.test(s) &&
  !/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(?:19|20)\d{2}\b/.test(s);

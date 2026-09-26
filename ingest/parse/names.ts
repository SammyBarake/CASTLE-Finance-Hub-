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
  // "Investor Group Led by Chairman and CEO Thomas Priore" -> "Investor Group Led by Thomas Priore"
  s = s.replace(/\b(?:its |the Company's )?(?:(?:Co-)?Chairman|Chief Executive Officer|CEO|Founder|President)(?:,? and (?:(?:Co-)?Chairman|Chief Executive Officer|CEO|Founder|President))*\s+(?=[A-Z])/g, "");
  s = s.replace(/['’]s$/, "");
  s = s.replace(/[\s,;:\-–]+$/g, "").replace(/^["'\s]+|["'\s]+$/g, "");
  // Keep "Inc." / "Co." periods, drop a stray trailing sentence period otherwise.
  if (/\.$/.test(s) && !/\b(?:Inc|Corp|Co|Ltd|L\.P|N\.V|S\.A|[A-Z])\.$/.test(s)) s = s.slice(0, -1);
  return s;
}

export const isPlausibleName = (s: string | null | undefined): s is string =>
  !!s && s.length >= 2 && s.length <= 90 && /[A-Za-z]/.test(s) && !/^(it|we|the company|company|shareholders|stockholders)$/i.test(s);

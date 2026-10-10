/**
 * The real buyer behind an acquisition vehicle ("Spaceship Purchaser, Inc." is Permira, "Sunshine Bidco Inc." is
 * DigitalBridge and IFM). Merger 8-Ks often name only the vehicle; the announcement release and the merger proxy
 * name the sponsor: "Squarespace to be Acquired by Permira", "Parent and Merger Sub are affiliates of investment funds
 * managed by Thoma Bravo". Pure text functions; the lookups live in ingest/deals.ts.
 */
import { flatten } from "../text";
import { cleanPartyName, isPlaceholderBuyer, isPlausibleName, namesCompany, sameCompany } from "./names";

const NAME = String.raw`([A-Z][A-Za-z0-9&.,'’\- ]{1,80}?)`;
// Where a sponsor's name ends: a parenthesis, a clause, "and" / "or" before a lower-case word, end of sentence.
const END = String.raw`(?=\s*\(|,\s+(?:a|an|the|which|who|one|together|collectively|L\.?P\.?\s*\(|and\s+its)\b|;|(?<!\b[A-Z])\.\s|\s+(?:and|or)\s+(?:its|their|certain|other|[a-z])|\s+(?:in|for|at|to|on|through|pursuant|under|with)\s+[a-z]|\s+(?:for|in)\s+(?:a\s+)?(?:US)?\$|\s+(?:For|In|At)\s+(?:US)?\$|$)`;
const FUNDS = String.raw`(?:(?:certain\s+)?(?:of\s+)?(?:the\s+)?(?:investment\s+|private\s+equity\s+|infrastructure\s+)?(?:funds?|vehicles?|entities|accounts)\s+(?:managed|advised|sponsored|controlled)(?:\s+or\s+advised)?\s+by\s+|affiliates?\s+of\s+|an?\s+affiliate\s+of\s+)?`;

const PATTERNS: RegExp[] = [
  // "Squarespace Enters into Definitive Agreement to Be Acquired by Permira"
  new RegExp(String.raw`\b[Tt]o\s+[Bb]e\s+(?:[Aa]cquired|[Tt]aken\s+[Pp]rivate)\s+[Bb]y\s+${FUNDS}${NAME}${END}`),
  // "Parent and Merger Sub are affiliates of investment funds managed by Thoma Bravo"
  new RegExp(String.raw`\b(?:Parent|Purchaser|Buyer|Holdings|Merger\s+Sub|Bidco)\b[^.]{0,140}?\b(?:(?:is|are)\s+(?:each\s+)?)?(?:an?\s+)?(?:affiliates?\s+of|controlled\s+by|(?:an?\s+)?(?:indirect\s+)?(?:wholly[- ]owned\s+)?subsidiar(?:y|ies)\s+of|formed\s+by|owned\s+by|sponsored\s+by)\s+${FUNDS}${NAME}${END}`),
  // "… an affiliate of funds managed by Apollo", "a portfolio company of Clearlake"
  new RegExp(String.raw`\b(?:funds?|vehicles?)\s+(?:managed|advised|sponsored)(?:\s+or\s+advised)?\s+by\s+(?:affiliates\s+of\s+)?${NAME}${END}`),
  new RegExp(String.raw`\bportfolio\s+company\s+of\s+${FUNDS}${NAME}${END}`),
  // "Permira to Acquire Squarespace", "… announced that Thoma Bravo has agreed to acquire …" (headline first)
  new RegExp(String.raw`^\s*${NAME}\s+(?:to\s+acquire|agrees?\s+to\s+acquire|has\s+agreed\s+to\s+acquire|will\s+acquire)\s`),
];

/** Words that make a capture a clause or a defined term, not a firm. */
const NOT_A_FIRM =
  /^(?:the\s+)?(?:Parent|Purchaser|Buyer|Company|Merger Sub|Holdings|Board|Sponsor|Sponsors|Investors?|Guarantors?|Equity Investors?|Merger|Transaction|Offer|Intermediate|Holdco|Topco|Midco)$|^(?:the\s+)?(?:Parent|Purchaser|Buyer|Merger Sub)\b|\b(?:Agreement|Merger|stockholders?|shareholders?|Company['’]s|Aggregator)\b/i;
/** A firm's name has no lower-case words but the joining ones ("Patient Square Capital", "Leonard Green & Partners"). */
const clauseWord = (name: string) => name.split(/\s+/).some((w) => /^[a-z]/.test(w) && !/^(?:and|of|the|de|la|du|von|van|der|di|e|y|&)$/.test(w));

/**
 * The sponsor or strategic buyer a text names for this deal, or null. `target` is the company being bought; `shell` is
 * the vehicle's name, which the answer must not be.
 */
export function sponsorFromText(text: string, target: string, shell: string): string | null {
  const flat = flatten(text).slice(0, 60_000);
  for (const re of PATTERNS) {
    for (const m of flat.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))) {
      let name = cleanPartyName(m[1].replace(/,\s*$/, "").trim());
      // "affiliates of Silver Lake and Sixth Street" keeps both; a trailing "and" alone goes.
      name = name.replace(/\s+(?:and|&)$/i, "");
      if (!isPlausibleName(name) || name.length < 3 || NOT_A_FIRM.test(name) || clauseWord(name) || isPlaceholderBuyer(name)) continue;
      if (namesCompany(name, target) || sameCompany(name, target) || sameCompany(name, shell)) continue;
      return name;
    }
  }
  return null;
}

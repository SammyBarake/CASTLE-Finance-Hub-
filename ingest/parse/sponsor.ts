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
// "a consortium of private investment firms composed of Elliott …" (Syneos); "funds managed by global investment firms
// Carlyle …" (bluebird).
const FUNDS = String.raw`(?:(?:certain\s+)?(?:of\s+)?(?:the\s+)?(?:investment\s+|private\s+equity\s+|infrastructure\s+)?(?:funds?|vehicles?|entities|accounts)\s+(?:managed|advised|sponsored|controlled)(?:\s+or\s+advised)?\s+by\s+|affiliates?\s+of\s+|an?\s+affiliate\s+of\s+|an?\s+(?:consortium|investor\s+group)\s+(?:of\s+(?:[a-z-]+\s+){1,4}?)?(?:composed\s+of|consisting\s+of|comprised\s+of|comprising|including)\s+)?(?:(?:global|leading|private|alternative)\s+){0,2}(?:(?:investment|private[- ]equity|asset\s+management)\s+firms?\s+)?`;

const PATTERNS: RegExp[] = [
  // "Squarespace Enters into Definitive Agreement to Be Acquired by Permira"
  new RegExp(String.raw`\b[Tt]o\s+[Bb]e\s+(?:[Aa]cquired|[Tt]aken\s+[Pp]rivate)\s+[Bb]y\s+${FUNDS}${NAME}${END}`),
  // "Parent and Merger Sub are affiliates of investment funds managed by Thoma Bravo"; "Parent, Intermediate and Merger
  // Sub were formed by, and are affiliated with, LKCM Headwater Investments, LLC" (Distribution Solutions Group)
  new RegExp(String.raw`\b(?:Parent|Purchaser|Buyer|Holdings|Merger\s+Sub|Bidco)\b[^.]{0,140}?\b(?:(?:is|are)\s+(?:each\s+)?)?(?:an?\s+)?(?:affiliates?\s+of|controlled\s+by|(?:an?\s+)?(?:indirect\s+)?(?:wholly[- ]owned\s+)?subsidiar(?:y|ies)\s+of|formed\s+by(?:,\s+and\s+(?:are|is)\s+affiliated\s+with,)?|affiliated\s+with|owned\s+by|sponsored\s+by)\s+${FUNDS}${NAME}${END}`),
  // "… an affiliate of funds managed by Apollo", "a portfolio company of Clearlake", "funds advised by each of Advent
  // International Corporation, Permira …" (McAfee)
  new RegExp(String.raw`\b(?:funds?|vehicles?)\s+(?:managed|advised|sponsored)(?:\s+or\s+advised)?\s+by\s+(?:affiliates\s+of\s+)?(?:each\s+of\s+)?${NAME}${END}`),
  // "to be acquired by an investor group led by Advent International"
  new RegExp(String.raw`\b(?:investor\s+group|group\s+of\s+investors|consortium|investor\s+consortium)\s+led\s+by\s+${FUNDS}${NAME}${END}`),
  new RegExp(String.raw`\bportfolio\s+company\s+of\s+${FUNDS}${NAME}${END}`),
  // "Pillartree Limited, a newly formed private limited company wholly owned by Amgen Inc." (Irish scheme offers);
  // "newly formed entities controlled by LKCM Headwater Investments, LLC"
  new RegExp(String.raw`\bnewly[- ](?:formed|incorporated)\b[^.;]{0,80}?\b(?:wholly[- ]owned\s+(?:indirect\s+)?(?:subsidiary\s+of|by)|owned\s+by|controlled\s+by|subsidiary\s+of)\s+${FUNDS}${NAME}${END}`),
  // "Permira to Acquire Squarespace", "… announced that Thoma Bravo has agreed to acquire …" (headline first)
  new RegExp(String.raw`^\s*${NAME}\s+(?:to\s+acquire|agrees?\s+to\s+acquire|has\s+agreed\s+to\s+acquire|will\s+acquire)\s`),
  // A headline in capitals, last so that the body's own spelling wins: "DISTRIBUTION SOLUTIONS GROUP TO BE TAKEN PRIVATE
  // BY AFFILIATES OF LKCM HEADWATER INVESTMENTS FOR $35.00 PER COMMON SHARE IN CASH".
  new RegExp(String.raw`\bTO\s+BE\s+(?:ACQUIRED|TAKEN\s+PRIVATE)\s+BY\s+(?:(?:CERTAIN\s+)?(?:AN?\s+)?AFFILIATES?\s+OF\s+|FUNDS\s+(?:MANAGED|ADVISED)\s+BY\s+)?([A-Z][A-Z0-9&.,'’\- ]{1,60}?)(?=\s+(?:FOR|IN|AT|THROUGH)\b|\s*[,;(]|$)`),
];

/**
 * A management buyout names no firm: "a consortium of investors led by Max Wygod, Chairman and Chief Executive Officer"
 * (Forian), "an acquisition group led by Chief Executive Officer Timothy Damadian", "a group of individuals led by the
 * Company's Chief Executive Officer, Timothy Damadian" (FONAR). The buyer is then the management group led by them.
 */
const TITLE = String.raw`(?:(?:Co-)?Founder|Chairman|Chairwoman|Chair|President|Chief Executive Officer|CEO|Executive Chairman)`;
const PERSON = String.raw`((?:Mr\.|Ms\.|Mrs\.|Dr\.)?\s?[A-Z][a-z]+(?:\s[A-Z]\.)?(?:\s[A-Z][a-z'’-]+){1,2})`;
const LED_BY = String.raw`\b(?:consortium|group)\s+(?:of\s+(?:investors|individuals|shareholders|stockholders)\s+)?led\s+by\s+`;
const MANAGEMENT = [
  new RegExp(String.raw`${LED_BY}(?:the\s+Company['’]s\s+|its\s+|our\s+)?${TITLE}(?:(?:,|\s+and)\s+${TITLE})*,?\s+${PERSON}(?![\w])`),
  new RegExp(String.raw`${LED_BY}${PERSON},\s+(?:the\s+Company['’]s\s+|its\s+|our\s+)?${TITLE}`),
];

/** The vehicle's own name, or its leading words ("Sunshine" for "Sunshine Bidco"), is never the answer. */
const plainWords = (s: string) => cleanPartyName(s).toLowerCase().replace(/[^a-z0-9& ]+/g, " ").split(/\s+/).filter((w) => w && !/^(?:inc|llc|corp|corporation|ltd|limited|lp|l|p|co)$/.test(w));
export function namesTheShell(name: string, shell: string): boolean {
  const a = plainWords(name);
  const b = plainWords(shell);
  return a.length > 0 && a.length <= b.length && a.every((w, i) => w === b[i]);
}

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
      // A name of its own that only starts like the vehicle's is the buyer: "Ithaca Holdings" behind "Ithaca Holdco, Inc."
      // (Bumble).
      if (namesCompany(name, target) || sameCompany(name, target) || namesTheShell(name, shell)) continue;
      return name;
    }
  }
  for (const re of MANAGEMENT) {
    const person = re.exec(flat)?.[1]?.replace(/^(?:Mr\.|Ms\.|Mrs\.|Dr\.)\s?/, "").trim();
    if (person && !sameCompany(person, target)) return `Management group led by ${person}`;
  }
  return null;
}

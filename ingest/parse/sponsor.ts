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
const FUNDS = String.raw`(?:(?:certain\s+)?(?:of\s+)?(?:the\s+)?(?:investment\s+|private\s+equity\s+|infrastructure\s+)?(?:funds?|vehicles?|entities|accounts)\s+(?:managed|advised|sponsored|controlled)(?:\s+or\s+advised)?\s+by\s+|affiliates?\s+of\s+|an?\s+affiliate\s+of\s+|an?\s+(?:consortium|investor\s+(?:group|consortium))\s+(?:of\s+(?:[a-z-]+\s+){1,4}?)?(?:composed\s+of|consisting\s+of|comprised\s+of|comprising|including)\s+)?(?:(?:global|leading|private|alternative)\s+){0,2}(?:(?:investment|private[- ]equity|asset\s+management)\s+firms?\s+)?`;

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

/** "Permira Advisers LLC" → "Permira", "Silver Lake Group, L.L.C." → "Silver Lake", "Temasek Holdings Limited" → "Temasek". */
function firmShortName(name: string): string {
  let s = name.replace(/\s+/g, " ").trim().replace(/^The\s+/, "");
  const SUFFIX = /[\s,]+(?:Inc|Corp|Corporation|Co|Ltd|Limited|LLC|L\.\s?L\.\s?C|LP|L\.\s?P|plc)\.?$/i;
  while (SUFFIX.test(s)) s = s.replace(SUFFIX, "");
  // The firm without its management company ("Francisco Partners Management"); not "Elliott Investment Management".
  while (/\s(?:Advis[eo]rs|Group|Holdings)$|\s(?:Partners|Capital)\sManagement$/.test(s)) s = s.replace(/\s\S+$/, "");
  return s;
}

/**
 * Joint buyers named one after another: "affiliates of funds managed by Blackstone Inc. ("Blackstone") and TPG Capital
 * ("TPG")" (Hologic), "funds affiliated with Permira Advisers LLC, Warburg Pincus LLC, Francisco Partners Management,
 * L.P. and Temasek Holdings (Private) Limited have committed …" (Clearwater), "an investor consortium comprised of The
 * Public Investment Fund ("PIF"), private investment funds affiliated with Silver Lake Group, L.L.C. ("Silver Lake") and
 * private investment funds affiliated with Affinity Partners ("Affinity," …)" (Electronic Arts). `list` starts at the
 * first firm's name. "Blackstone and TPG", "PIF, Silver Lake and Affinity Partners"; null when it names one firm.
 */
export function jointBuyers(list: string): string | null {
  const terms: string[] = [];
  // Defined terms become markers (an acronym is the better name: "PIF", "TPG"); other parentheses go ("(Private)").
  let s = list.replace(/\s+/g, " ").replace(/\s*\(([^()]*)\)/g, (_, inner: string) => {
    const term = /^\s*(?:the\s+)?["“]\s*([^"”]+?)\s*,?\s*["”]/.exec(inner)?.[1];
    if (!term) return "";
    terms.push(term);
    return ` #${terms.length - 1}#`;
  });
  // The list ends at the sentence's verb or end.
  s = s.split(/(?<!\b(?:Inc|Co|Ltd|Corp|[A-Z]))\.(?:\s|$)|;|\s(?:have|has|are|is|were|was|will|for|to|in|pursuant|on|as|that|which)\s/)[0];
  // A legal suffix after a comma belongs to the name: "Francisco Partners Management, L.P.". So do the commas of a name
  // joined by "&": "Clayton, Dubilier & Rice, LLC".
  s = s.replace(/,\s*(L\.\s?L\.\s?C\.?|L\.\s?P\.?|LLC|LP|Inc\.?|Ltd\.?|Limited)(?=[\s,]|$)/g, " $1");
  s = s.replace(/\b[A-Z][\w'’-]*(?:,\s+[A-Z][\w'’-]*)+\s+&\s+[A-Z][\w'’-]*/g, (x) => x.replace(/,/g, "~~"));
  const LEAD = /^(?:certain\s+)?(?:(?:private\s+)?(?:investment\s+|equity\s+)?(?:funds?|vehicles?|entities|affiliates)\s+(?:affiliated\s+with|managed\s+by|advised\s+by|of)|affiliates\s+of)\s+/i;
  const members: string[] = [];
  for (const piece of s.split(/\s*,\s*(?:and\s+)?|\s+and\s+/)) {
    const marker = /\s*#(\d+)#\s*$/.exec(piece);
    const name = piece.replace(/\s*#\d+#\s*$/, "").replace(LEAD, "").replace(/~~/g, ",").trim();
    // A founder named beside the firm is not another buyer: "Headwater Investments, LLC ("Headwater"), J. Bryan King and
    // their respective affiliates".
    if (/^(?:[A-Z]\.\s?)+[A-Z][a-z'’-]+(?:\s[A-Z][a-z'’-]+)?$/.test(name)) continue;
    // Not a vehicle or a person's title: "Gores Logistics Sub", "Tiger Acquisition" (Oracle's merger sub), "Chairman".
    if (!/^[A-Z]/.test(name) || !isPlausibleName(name) || NOT_A_FIRM.test(name) || clauseWord(name) || isPlaceholderBuyer(name)) break;
    if (/\b(?:Sub|Subsidiary|Acquisition|Acquisitions|Merger)\b/.test(name) || /^(?:Chairman|Chairwoman|Chair|Chief|CEO|President|Founder|Co-Founder|Management|Directors?|Officers?)\b/.test(name)) break;
    const term = marker ? terms[Number(marker[1])] : null;
    const short = firmShortName(name);
    // An acronym the firm goes by ("TPG" for TPG Capital, "PIF" for The Public Investment Fund); not one coined for the
    // filing ("FP" for Francisco Partners).
    const acronym = !!term && /^[A-Z]{2,5}$/.test(term) && (short.split(" ")[0] === term || short.split(" ").length >= 3);
    members.push(acronym ? term! : short);
  }
  if (members.length < 2) return null;
  return `${members.slice(0, -1).join(", ")} and ${members.at(-1)}`;
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
      // The firms it names together: "Electronic Arts to be Acquired by PIF, Silver Lake and Affinity Partners".
      const start = m.index! + m[0].length - m[1].length;
      const joint = jointBuyers(flat.slice(start, start + 500));
      return joint && !namesCompany(joint, target) ? joint : name;
    }
  }
  for (const re of MANAGEMENT) {
    const person = re.exec(flat)?.[1]?.replace(/^(?:Mr\.|Ms\.|Mrs\.|Dr\.)\s?/, "").trim();
    // "Management Group led by …": a name isPlausibleName accepts. "Management group led by" has two ordinary lower-case
    // words, which read as prose, and tidy then dropped the whole deal (FONAR, October 2026).
    const name = person ? `Management Group led by ${person}` : null;
    if (name && !sameCompany(person, target) && isPlausibleName(name)) return name;
  }
  return null;
}

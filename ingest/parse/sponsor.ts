/**
 * The real buyer behind an acquisition vehicle ("Spaceship Purchaser, Inc." is Permira, "Sunshine Bidco Inc." is
 * DigitalBridge and IFM). Merger 8-Ks often name only the vehicle; the announcement release and the merger proxy
 * name the sponsor: "Squarespace to be Acquired by Permira", "Parent and Merger Sub are affiliates of investment funds
 * managed by Thoma Bravo". Pure text functions; the lookups live in ingest/deals.ts.
 */
import { flatten } from "../text";
import { cleanPartyName, isPlaceholderBuyer, isPlausibleName, namesCompany, sameCompany } from "./names";
import { buyerType } from "../../lib/buyers";
import type { Deal } from "../../lib/types";

const NAME = String.raw`([A-Z][A-Za-z0-9&.,'’\- ]{1,80}?)`;
// Where a sponsor's name ends: a parenthesis, a clause, "and" / "or" before a lower-case word, end of sentence.
const END = String.raw`(?=\s*\(|,\s+(?:a|an|the|which|who|one|together|collectively|L\.?P\.?\s*\(|and\s+its)\b|;|(?<!\b[A-Z])\.\s|\s+(?:and|or)\s+(?:its|their|certain|other|[a-z])|\s+(?:in|for|at|to|on|through|pursuant|under|with|have|has|are|were|will)\s+[a-z]|\s+(?:for|in)\s+(?:a\s+)?(?:US)?\$|\s+(?:For|In|At)\s+(?:US)?\$|$)`;
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
function firmShortName(name: string, keepTheGroup = false): string {
  const the = keepTheGroup && /^\s*The\s+/.test(name);
  let s = name.replace(/\s+/g, " ").trim().replace(/^The\s+/, "");
  const SUFFIX = /[\s,]+(?:Inc|Corp|Corporation|Co|Ltd|Limited|LLC|L\.\s?L\.\s?C|LP|L\.\s?P|plc)\.?$/i;
  while (SUFFIX.test(s)) s = s.replace(SUFFIX, "");
  // The firm without its management company ("Francisco Partners Management"); not "Elliott Investment Management".
  while (/\s(?:Advis[eo]rs|Group|Holdings)$|\s(?:Partners|Capital)\sManagement$/.test(s)) {
    const next = s.replace(/\s\S+$/, "");
    // "The Column Group" is the firm's whole name: "Column" alone is a word (NGM Biopharmaceuticals' buyer). A sponsor
    // known by its one word stays that word ("The Blackstone Group" is Blackstone).
    if (the && /\sGroup$/.test(s) && !/\s/.test(next) && buyerType({ acquirer: { name: next, ticker: null, cik: null } } as Deal) !== "Private equity") {
      s = `The ${s}`;
      break;
    }
    s = next;
  }
  // "Trian Fund Management" is Trian, "General Catalyst Group Management" General Catalyst (Janus Henderson).
  return s.replace(/\s(?:Fund|Group)\sManagement$/, "");
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
  // A description between a firm and its term goes first, or its words end the list: "owned by Sumitomo Corporation, a Japanese
  // corporation ("Sumitomo"), SMBC Aviation Capital Limited, a company incorporated with limited liability in Ireland ("SMBC AC" …),
  // Apollo Capital Management, L.P. ("Apollo") and Brookfield Asset Management Ltd. ("Brookfield" …)" (Air Lease).
  // Defined terms become markers (an acronym is the better name: "PIF", "TPG"); other parentheses go ("(Private)").
  let s = list.replace(/\s+/g, " ").replace(/,\s+an?\s+[a-z]?[^(),;.]{3,80}?(?=\s*\(\s*(?:the\s+)?["“])/g, "").replace(/\s*\(([^()]*)\)/g, (_, inner: string) => {
    const term = /^\s*(?:the\s+)?["“]\s*([^"”]+?)\s*,?\s*["”]/.exec(inner)?.[1];
    if (!term) return "";
    terms.push(term);
    return ` #${terms.length - 1}#`;
  });
  // The list ends at the sentence's verb or end.
  // (And its "and" before that verb: "… SK Capital Partners ("SK Capital") and were formed by First Reserve" left "#1# and" in TPC Group's buyer.)
  s = s.split(/(?<!\b(?:Inc|Co|Ltd|Corp|[A-Z]))\.(?:\s|$)|;|\s(?:have|has|are|is|were|was|will|for|to|in|pursuant|on|as|that|which)\s/)[0].replace(/\s+and$/, "");
  // A legal suffix after a comma belongs to the name: "Francisco Partners Management, L.P.". So do the commas of a name
  // joined by "&": "Clayton, Dubilier & Rice, LLC".
  s = s.replace(/,\s*(L\.\s?L\.\s?C\.?|L\.\s?P\.?|LLC|LP|SCSp|SCSP|SCS|Inc\.?|Ltd\.?|Limited)(?=[\s,]|$)/g, " $1");
  s = s.replace(/\b[A-Z][\w'’-]*(?:,\s+[A-Z][\w'’-]*)+\s+&\s+[A-Z][\w'’-]*/g, (x) => x.replace(/,/g, "~~"));
  const LEAD = /^(?:certain\s+)?(?:(?:private\s+)?(?:investment\s+|equity\s+)?(?:funds?|vehicles?|entities|affiliates)\s+(?:affiliated\s+with|managed\s+by|advised\s+by|of)|affiliates\s+of)\s+/i;
  const members: string[] = [];
  for (const piece of s.split(/\s*,\s*(?:and\s+)?|\s+and\s+/)) {
    const marker = /\s*#(\d+)#\s*$/.exec(piece);
    const name = piece.replace(/\s*#\d+#\s*$/, "").replace(LEAD, "").replace(/~~/g, ",").trim();
    // What the 500-character cut leaves of a suffix: "L.".
    if (name.length < 3) continue;
    // A founder named beside the firm is not another buyer: "Headwater Investments, LLC ("Headwater"), J. Bryan King and
    // their respective affiliates"; nor a controlling person: "ABP Trust and Adam D. Portnoy" (AlerisLife).
    if (/^(?:[A-Z]\.\s?)+[A-Z][a-z'’-]+(?:\s[A-Z][a-z'’-]+)?$/.test(name) || /^[A-Z][a-z]+\s(?:[A-Z]\.\s)+[A-Z][a-z'’-]+$/.test(name)) continue;
    // Not a vehicle or a person's title: "Gores Logistics Sub", "Tiger Acquisition" (Oracle's merger sub), "Chairman".
    if (!/^[A-Z]/.test(name) || !isPlausibleName(name) || NOT_A_FIRM.test(name) || clauseWord(name) || isPlaceholderBuyer(name)) break;
    if (/\b(?:Sub|Subsidiary|Acquisition|Acquisitions|Merger|MergerSub)\b/.test(name) || /^(?:Chairman|Chairwoman|Chair|Chief|CEO|President|Founder|Co-Founder|Management|Directors?|Officers?)\b/.test(name)) break;
    const term = marker ? terms[Number(marker[1])] : null;
    // A party to the deal under a role ends the list: "an affiliate of Yucaipa ("Parent"), EH MergerSub Inc." (Soho House).
    if (term && /^(?:Parent|Purchaser|Buyer|Merger Sub|Sub)$/i.test(term)) {
      members.push(firmShortName(name));
      break;
    }
    const short = firmShortName(name);
    // An acronym the firm goes by ("TPG" for TPG Capital, "PIF" for The Public Investment Fund); not one coined for the
    // filing ("FP" for Francisco Partners).
    const acronym = !!term && /^[A-Z]{2,5}$/.test(term) && (short.split(" ")[0] === term || short.split(" ").length >= 3);
    members.push(acronym ? term! : short);
  }
  if (members.length < 2) return null;
  const firms = oneFundFamily(members);
  return firms.length === 1 ? firms[0] : `${firms.slice(0, -1).join(", ")} and ${firms.at(-1)}`;
}

/**
 * One sponsor's own funds aren't joint buyers: "affiliates of Thoma Bravo Fund XVI, L.P., Thoma Bravo Fund XVI-A, L.P.,
 * Thoma Bravo Executive Fund XVI …" made a 370-character name, which lost the whole of Dayforce. They collapse to what
 * they share, "Thoma Bravo". Not on a first word every other firm uses.
 */
const COMMON_FIRST_WORD = /^(?:First|National|American|General|Global|New|Capital|United|International|The|Silver|Golden|Stone|Lone|Blue|Sun|Bank|Red|Black|Green|White|North|South|East|West|Pacific|Atlantic)$/;
function oneFundFamily(members: string[]): string[] {
  const out: string[] = [];
  const collapsed = new Set<number>();
  for (const m of members) {
    const words = m.split(" ");
    const i = out.findIndex((o) => o.split(" ")[0] === words[0]);
    if (i < 0) {
      out.push(m);
      continue;
    }
    const seen = out[i].split(" ");
    let k = 0;
    while (k < seen.length && k < words.length && seen[k] === words[k]) k++;
    // (Two firms sharing an ordinary word: Golden Gate and GoldenTree-style pairs, Silver Lake's own funds share two words.)
    if (k === 1 && COMMON_FIRST_WORD.test(words[0])) {
      out.push(m);
      continue;
    }
    out[i] = seen.slice(0, k).join(" ");
    collapsed.add(i);
  }
  return out.map((m, i) => (collapsed.has(i) ? m.replace(/(?:\s(?:Funds?|Executive|Employee))+$/, "") : m));
}

const FIRM = String.raw`[A-Z][A-Za-z0-9&.'’\- ]{1,70}?(?:,\s(?:L\.\s?L\.\s?C\.?|L\.\s?P\.?|LLC|LP|Inc\.?|Ltd\.?|Limited))?`;
const FIRM_END = String.raw`(?=\s*\(|,\s|(?<!\b[A-Z])\.\s|\.$|;|\s+and\s)`;
const WHO_IS_BEHIND = new RegExp(
  String.raw`\b(?:Parent|Purchasers?|Buyer)(?:\s+and\s+(?:the\s+)?(?:Merger|Acquisition)\s+Sub)?\s+(?:are|is)\s+(?:(?:an?\s+)?affiliates?\s+of|affiliated\s+with|entities\s+affiliated\s+with)\s+(?:the\s+)?`,
);
// "… affiliated with certain members of the Nordstrom family and related trusts and family-controlled investment vehicles (the
// "Family Group") and El Puerto de Liverpool S.A.B. de C.V., a Mexican …" (the proxy); "the shares to be contributed to Parent by El
// Puerto de Liverpool S.A.B. de C.V. ("Liverpool") and certain members of the Nordstrom family" (the 8-K).
const FAMILY_THEN_FIRM = new RegExp(String.raw`^certain\s+members\s+of\s+the\s+([A-Z][a-z]+)\s+family\b[^()]{0,120}?\([^()]*\)\s+and\s+(${FIRM})(?=,|\s*\()`);
const ROLLOVER_FIRM_THEN_FAMILY = new RegExp(String.raw`\bcontributed\s+to\s+Parent\s+by\s+(${FIRM})\s*\([^()]*\)\s+and\s+certain\s+members\s+of\s+the\s+([A-Z][a-z]+)\s+family\b`);
/** (The company first: "The Nordstrom family and …" reads as Nordstrom itself to every name comparison, by its first word.) */
const familyBuyer = (firm: string, family: string) => `${firmShortName(firm).replace(/\s+S\.A\.B\..*$/, "")} and the ${family} family`;

/**
 * Who stands behind a buyer the text defines only as "Parent", whatever the vehicle is called: "Parent and Merger Sub are
 * affiliates of the Infrastructure Investments Fund, a private investment vehicle …" (South Jersey, NJ Boardwalk Holdings),
 * "… are affiliates of Charlesbank Capital Partners LLC" (Quotient), "Purchaser are entities affiliated with Kingswood Capital
 * Management, LP" (Quipt). One step along a chain: "… affiliates of TPG Cannes Aggregation, L.P., an affiliate of TPG Global, LLC
 * and the holder of a majority …" (Convey), "THL Agiliti LLC, an affiliate of Thomas H. Lee Partners, L.P." (Agiliti). Null when
 * the sentence names no firm (a defined term), or the target itself.
 */
export function buyerBehindParent(text: string, target: string): string | null {
  const rollover = ROLLOVER_FIRM_THEN_FAMILY.exec(text);
  if (rollover) return familyBuyer(rollover[1], rollover[2]);
  // Not the going-private boilerplate: "the holders of Axar Shares and Parent and Merger Sub are affiliates of the Company and,
  // therefore, are required to express their purposes …" (StoneMor's proxy) is the SEC's sense of affiliate, not an owner.
  const found = [...text.matchAll(new RegExp(WHO_IS_BEHIND.source, "g"))].filter(
    (x) => !/^(?:Company|Partnership|Registrant|Trust|Issuer|Corporation)\b/.test(text.slice(x.index + x[0].length, x.index + x[0].length + 40)),
  );
  // An owner that is a vehicle itself leads to the next such sentence: "Parent and Merger Sub are affiliates of Closing Parent
  // Holdco, L.P. ("Topco") … Topco, Parent and Merger Sub are affiliates of CB RE Closing Aggregator, L.P., … an affiliate
  // of Centerbridge Partners, L.P." (Doma).
  let vehicle: string | null = null;
  for (const m of found.slice(0, 3)) {
    const who = ownerAt(text, m, target);
    if (who && !isPlaceholderBuyer(who)) return who;
    vehicle ??= who;
  }
  return vehicle;
}

function ownerAt(text: string, m: RegExpExecArray | RegExpMatchArray, target: string): string | null {
  const rest = text.slice(m.index! + m[0].length, m.index! + m[0].length + 400);
  const family = FAMILY_THEN_FIRM.exec(rest);
  if (family) return familyBuyer(family[2], family[1]);
  const first = new RegExp(String.raw`^(${FIRM})${FIRM_END}`).exec(rest);
  if (!first) return null;
  const chain = CHAIN.exec(rest.slice(first[1].length));
  if (!chain) {
    // A list of firms, or one sponsor's funds ("affiliates of Thoma Bravo Fund XVI, L.P., Thoma Bravo Fund XVI-A, L.P. …": Dayforce).
    const joint = jointBuyers(rest.slice(0, 500));
    if (joint && isPlausibleName(joint) && !namesCompany(joint, target)) return plainFirm(joint);
  }
  const firm = plainFirm(firmShortName(chain?.[1] ?? first[1], true));
  if (firm.length < 3 || !isPlausibleName(firm) || NOT_A_FIRM.test(firm) || clauseWord(firm) || sameCompany(firm, target) || namesCompany(firm, target)) return null;
  // Not a lender: "an affiliate of Wells Fargo Bank, N.A., the lender".
  if (/,?\s+N\.\s?A\.?$/.test(firm)) return null;
  return plainFirm(firm.replace(/\s+SCSp$/, ""));
}

// The next link, in the same sentence: ", an affiliate of TPG Global, LLC", ", a private equity fund managed by Haveli Investments L.P."
// (ZeroFox), "(the "Significant Company Stockholder"), the holder of a majority of … and an affiliate of Apax Partners LLP" (Thoughtworks).
const CHAIN = new RegExp(String.raw`^(?:[^.]|\.(?!\s))*?\b(?:an\s+affiliate\s+of|funds?\s+managed\s+by|managed\s+by)\s+(?:(?:certain\s+)?(?:investment\s+)?funds?\s+(?:managed|advised)\s+by\s+)?(${FIRM})${FIRM_END}`);
/** The firm, not its numbered fund: "Carlyle Partners V", "Thoma Bravo Fund XV", "EQT Infrastructure II Limited Partnership". */
const plainFirm = (name: string) =>
  name
    .split(/\s+and\s+/)
    .map((n) => (/\bFund\b/.test(n) ? cleanPartyName(n) : n).replace(/\s+Limited Partnership$/, "").replace(/\s+[IVX]{1,4}$/, "").replace(/^TPG Global$/, "TPG"))
    .join(" and ");

/**
 * A name the text defines by a short form: "Authentic Brands Group LLC, a Delaware limited liability company ("Authentic")".
 * The sponsor sentence had only the term ("a wholly-owned subsidiary of Authentic": Guess).
 */
function definedFullName(term: string, flat: string): string | null {
  if (!/^[A-Z][a-z]+$/.test(term)) return null;
  const m = new RegExp(String.raw`\b(${term}\s[A-Z][\w&.'’ -]{1,60}?(?:,\s(?:L\.\s?P\.?|LLC|LP|Inc\.?|Incorporated|Ltd\.?))?)(?:,\s+an?\s+[^()"“”;]{1,80})?\s*\(\s*(?:the\s+)?["“]\s*${term}\s*["”]`).exec(flat);
  return m && isPlausibleName(m[1]) ? m[1] : null;
}

/**
 * A headline buyer that is only the vehicle's stem ("KONTRON TO ACQUIRE BSQUARE" beside "Kontron Merger Sub., Inc.") is the
 * buyer when the release defines it by a longer name of its own: `Kontron America, Incorporated ("Kontron")`. Null otherwise
 * ("Sunshine" for "Sunshine Bidco" stays a vehicle's code name).
 */
export function buyerTheShellIsNamedFor(headlineBuyer: string, shell: string, text: string): string | null {
  const term = headlineBuyer.trim().replace(/^[A-Z]+$/, (w) => w[0] + w.slice(1).toLowerCase());
  const full = definedFullName(term, flatten(text));
  return full && !namesTheShell(full, shell) && !isPlaceholderBuyer(full) ? full : null;
}

/** Words that make a capture a clause or a defined term, not a firm. */
const NOT_A_FIRM =
  /^(?:the\s+)?(?:Parent|Purchaser|Buyer|Company|Merger Sub|Holdings|Board|Sponsor|Sponsors|Sellers?|Holders?|Lenders?|Investors?|Guarantors?|Equity Investors?|Merger|Transaction|Offer|Intermediate|Holdco|Topco|Midco)$|^(?:the\s+)?(?:Parent|Purchaser|Buyer|Merger Sub)\b|\b(?:Agreement|Merger|stockholders?|shareholders?|Company['’]s|Aggregator)\b/i;
/** A firm's name has no lower-case words but the joining ones ("Patient Square Capital", "Leonard Green & Partners"). */
const clauseWord = (name: string) => name.split(/\s+/).some((w) => /^[a-z]/.test(w) && !/^(?:and|of|the|de|la|du|von|van|der|di|e|y|&)$/.test(w));

/**
 * The sponsor or strategic buyer a text names for this deal, or null. `target` is the company being bought; `shell` is
 * the vehicle's name, which the answer must not be.
 */
export function sponsorFromText(text: string, target: string, shell: string): string | null {
  const flat = flatten(text).slice(0, 60_000);
  const behind = buyerBehindParent(flat, target);
  // (The shell's own name, not its leading words: TPG behind TPG Cannes Aggregation is the answer.)
  if (behind && plainWords(behind).join(" ") !== plainWords(shell).join(" ")) return behind;
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
      return joint && isPlausibleName(joint) && !namesCompany(joint, target) ? joint : (definedFullName(name, flat) ?? name);
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

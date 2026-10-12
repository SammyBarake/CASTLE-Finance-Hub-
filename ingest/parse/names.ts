/** Company-name helpers shared by the parsers. */

const SUFFIXES =
  /\b(the|inc|incorporated|corp|corporation|company|co|ltd|limited|plc|llc|l\.?l\.?c|lp|l\.?p|n\.?v|s\.?a|ag|se|holdings?|group|trust|bancorp|bancshares|technologies|international|enterprises?)\b\.?/gi;

/** Short forms sponsors go by in releases, mapped to the full name so "H&F" and "Hellman & Friedman" match. */
const SHORT_FORMS: Record<string, string> = {
  "h and f": "hellman and friedman",
  "cd and r": "clayton dubilier and rice",
  "kohlberg kravis roberts": "kkr",
  "tpg capital": "tpg",
  "thoma bravo l p": "thoma bravo",
  "bain": "bain capital",
  "h i g": "h i g capital",
};

/** "Copart, Inc." -> "copart"; "The Baldwin Group, Inc." -> "baldwin" */
export function normalizeName(name: string): string {
  const n = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]s\b/g, "")
    .replace(SUFFIXES, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // "KKR & Co. Inc." -> "kkr" (the "& Co." suffix leaves a dangling "and")
    .replace(/\s+and$/, "");
  return SHORT_FORMS[n] ?? n;
}

/**
 * Stricter than `sameCompany` (no shared-first-word match, so "Global Payments" is not "Global Blue"): the same name,
 * or one name extending the other ("Lucid Group" / "Lucid Motors" share "lucid" but "Teledyne" / "Teledyne FLIR" too).
 */
export function identicalNames(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (x.length < 3 || y.length < 3) return false;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s === l || l.startsWith(s + " ");
}

/** One name shortening the other word by word: "Rotron Aero" / "Rotron Aerospace Ltd." (each word a prefix). */
export function namesExtend(a: string, b: string): boolean {
  const x = normalizeName(a).split(" ").filter(Boolean);
  const y = normalizeName(b).split(" ").filter(Boolean);
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (s.length < 2 || s.join(" ").length < 6) return false;
  return s.every((w, i) => !!l[i]?.startsWith(w));
}

/** A party written as another party's ticker: "UWMC" for UWM Holdings Corp (ticker UWMC). */
export function isTickerOf(name: string, party: { ticker?: string | null }): boolean {
  return !!party.ticker && party.ticker.length >= 2 && name.trim().toUpperCase() === party.ticker.toUpperCase();
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

/**
 * A release's short name for a company: `sameCompany`, or its initials ("EFI" for Electronics For Imaging,
 * "WBA" for Walgreens Boots Alliance). Only for contexts that already know which company is meant (the backstop's
 * filer), since initials alone are ambiguous.
 */
export function namesCompany(short: string, full: string): boolean {
  if (sameCompany(short, full)) return true;
  const s = short.trim();
  if (!/^[A-Z]{2,6}$/.test(s)) return false;
  const words = normalizeName(full).split(" ").filter((w) => w && w !== "and");
  return words.length >= 2 && words.map((w) => w[0]).join("") === s.toLowerCase();
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
  // A name never spans sentences: cut at ". Capital" unless the period ends an abbreviation (Inc., Co., J.P., H.I.G.,
  // Mr. Cooper, St. Joe).
  // (Lower-case initials too: "e.l.f. Beauty".)
  const sentenceBreak = /(?<!\b(?:Inc|Corp|Co|Ltd|Bros|Mfg|Intl|Mr|Mrs|Ms|Dr|St|Ft|Mt|L\.P|N\.V|S\.A|[A-Z])|\.[a-z])\.\s+(?=[A-Z])/.exec(s);
  if (sentenceBreak) s = s.slice(0, sentenceBreak.index);
  // "Standard General L.P., a Delaware limited partnership" -> "Standard General L.P."
  s = s.replace(/,\s+an?\s+(?:[A-Z][\w.]*\s+){1,3}(?:limited\s+(?:liability\s+)?(?:company|partnership)|(?:public\s+)?(?:limited\s+)?company|corporation|partnership|statutory trust|exempted company)\b.*$/, "");
  // "AkzoNobel, that certain Joinder Agreement, dated ..." -> "AkzoNobel"
  s = s.replace(/,\s+(?:that certain|dated|pursuant|as amended)\b.*$/i, "");
  // "Delaware corporation, American Family Mutual" -> "American Family Mutual"
  s = s.replace(/^(?:an?\s+)?(?:[A-Z][a-z]+\s){1,2}(?:corporation|limited liability company|limited partnership|company),\s+(?=[A-Z])/, "");
  // "Investor Group Led by Chairman and CEO Thomas Priore" -> "Investor Group Led by Thomas Priore"
  s = s.replace(/\b(?:its |the Company's )?(?:(?:Co-)?Chairman|Chief Executive Officer|CEO|Founder|President)(?:,? and (?:(?:Co-)?Chairman|Chief Executive Officer|CEO|Founder|President))*\s+(?=[A-Z])/g, "");
  // A headline verb ends the name: "Mantle Therapeutics and Announces Multiple …", "Abiomed Broadens MedTech",
  // "Wavedash Leading Online Ticket Marketplace …", "Community Bancorporation Company Release".
  s = s.replace(/\s+and\s+(?:Announces?|Reports?|Provides?|Enters?|Completes?|Launch(?:es)?|Receives?|Expands?|Updates?|Unveils?|Appoints?|Strengthens?)\b.*$/i, "");
  s = s.replace(/\s+(?:Adds|Expands|Broadens|Announces|Strengthens|Bolsters|Extends|Enters|Launches|Completes|Acquires|Joins|Becomes|Unveils|Accelerates|Deepens|Enhances|Executes|Executed|Signs|Signed)\b.*$/, "");
  // An adverb before the verb: "Amryt Successfully Completes Acquisition of Chiasma".
  s = s.replace(/\s+(?:Successfully|Officially|Formally)$/, "");
  // Two buyers take the plural verb: "SD Biosensor and SJL Partners Complete Transaction".
  s = s.replace(/\s+(?:Complete|Close|Finalize)\s+(?:the\s+)?(?:Transaction|Acquisition|Merger|Sale|Purchase)\b.*$/, "");
  // "BioLife Solutions Exhibit 99.2" -> "BioLife Solutions"
  s = s.replace(/\s+Exhibit\s+\d+(?:\.\d+)?\b.*$/i, "");
  // "Media & Investor Release Roche" -> "Roche"; "Press Release: Acme" -> "Acme"
  s = s.replace(/^(?:Joint\s+)?(?:Media\s*(?:&|and)\s*Investor|Media|Investor|Press|News)\s+Release:?\s+(?=[A-Z])/i, "");
  // "Ceautamed Worldwide the Owner of Greens First" -> "Ceautamed Worldwide"; "Sculptor Capital Management Together" -> "Sculptor Capital Management"
  s = s.replace(/,?\s+the\s+(?:owner|parent|operator|maker|developer)\s+of\b.*$/i, "").replace(/\s+Together$/i, "");
  // "A Joint Venture Between Affiliates Of Highgate And Cerberus …" -> "Highgate and Cerberus …"
  const jv = /^(?:an?\s+)?joint venture (?:between|of|formed by)\s+(?:affiliates of\s+)?/i;
  if (jv.test(s)) s = s.replace(jv, "").replace(/\s+And\s+(?:Affiliates Of\s+)?(?=[A-Z])/gi, " and ");
  // A description in front of the name: "Leading Loyalty Provider Punchh Inc." -> "Punchh Inc.",
  // "Leading Metal Roof Components Manufacturer LSI Group" -> "LSI Group".
  s = s.replace(
    /^(?:an?\s+)?(?:Leading|Premier)\s+(?:[A-Z][\w&.'-]*\s+(?:(?:and|&)\s+)?){0,6}?(?:Provider|Supplier|Manufacturer|Maker|Firm|Company|Developer|Distributor|Operator|Platform|Specialist|Leader)\s+(?=[A-Z])/,
    "",
  );
  // ("Premier" only after "a": Pacific Premier Bancorp is a name.)
  s = s.replace(/\s+(?:a\s+)?Leading\s+[A-Z].*$|\s+a\s+Premier\s+[A-Z].*$/, "");
  // "SHUSA via an all-cash tender offer" -> "SHUSA" (lower-case "via" only: ViaSat and Via Renewables are names).
  s = s.replace(/\s+via\s+.*$/, "");
  s = s.replace(/\s+Company\s+(?:Release|Has|Announces|Today)\b.*$/i, "");
  // A description glued in front of a one-word brand: "Antibody and Reagent Leader BioLegend" -> "BioLegend",
  // "Sports Betting Company Openbet" -> "Openbet", "Brazilian Collagen Producer Gelnex" -> "Gelnex".
  const described = /^(?:[A-Z][\w-]*\s+(?:(?:and|&)\s+)?){1,4}(?:Leader|Company|Provider|Maker|Developer|Specialist|Pioneer|Platform|Producer|Creator|Manufacturer|Supplier|Distributor)\s+([A-Z][\w.-]{2,})$/.exec(s);
  // Not when the "brand" is a bare acronym ("API Media Technology Provider API"): too ambiguous on its own.
  if (described && !/^[A-Z]{2,4}$/.test(described[1]) && !/^(?:Inc|Corp|LLC|Ltd|Holdings|Group|International|Europe|America|USA|Global|Release|Today)\.?$/i.test(described[1])) s = described[1];
  // "Blackstone Real Estate Income Trust All-Cash Transaction" -> "Blackstone Real Estate Income Trust"
  s = s.replace(/\s+(?:in\s+an?\s+)?(?:All[- ]Cash|All[- ]Stock|Cash[- ]and[- ]Stock|Cash|Stock)\s+(?:Transaction|Deal|Merger)\b.*$/i, "");
  // "PRIVATELY HELD TENEOBIO", "UK-BASED CORETRAX", "family-owned Acme" -> the name itself
  s = s.replace(/^(?:privately[- ](?:held|owned)|family[- ]owned|[A-Za-z.]+-based|(?:Nasdaq|NYSE|NYSE American|publicly)[- ](?:listed|traded))\s+(?=\S)/i, "");
  // An all-capitals headline run into the dateline's listing: "ROTRON AERO NASDAQ: ONDS" -> "ROTRON AERO".
  s = s.replace(/\s+(?:NASDAQ|NYSE|Nasdaq)$/, "");
  s = s.replace(/['’]s$/, "");
  // A connector left at the end: "Corlieve Therapeutics and" -> "Corlieve Therapeutics".
  s = s.replace(/\s+(?:and|&|of|for|with)$/i, "");
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
  /\b(?:Merger Sub|MergeCo|MergerCo|AcquireCo|AcquisitionCo|Bidco|BidCo|Topco|TopCo|Midco|Holdco|HoldCo|ParentCo|Purchaser|Acquisition (?:Corp|Co|LLC|Inc))\b/.test(name) ||
  /^(?:[A-Z][A-Za-z]+ )+(?:Parent|Buyer)(?:,? (?:Inc|LLC|L\.?P|Corp)\.?)?$/.test(name) ||
  /^Acquiror\b/.test(name) ||
  // "Denali Intermediate Holdings, Inc.", "Bullseye FinCo, Inc.", "Beacon Parent Holdings, L.P.", "Eclipse Parent
  // Acquisitions, LLC", "Project Hospitality Parent, LLC", "Buyer Group Led by Evercel"
  /\b(?:Intermediate(?: Holdings?| Holdco| Holding Corp\.?)?|FinCo|Finco|Parent (?:Holdings?|Acquisitions?|Corp(?:oration)?)|Buyer (?:Group|Corp\.?|Inc\.?))\b/.test(name) ||
  /^Project [A-Z]/.test(name);

/**
 * A deal's acquisition vehicle, never a real private target ("Zamboni MergerCo", "Balmoral Swan Merger Sub",
 * "TPG Growth Iceman Parent"): the release was read backwards. Holdco / Topco names are real legal entities
 * ("RSC Topco" is Accession), and a registrant's SEC name is always real ("Frontier Communications Parent").
 */
export const isMergerVehicle = (name: string) =>
  /\b(?:Merger ?Sub(?:sidiary)?|MergerCo|MergeCo|Bidco|BidCo|Purchaser)\b/i.test(name) || /^(?:[A-Z][\w&.'-]* )+Parent(?:,? (?:Inc|LLC|L\.?P|Corp)\.?)?$/.test(name);

export const isPlausibleName =(s: string | null | undefined): s is string =>
  !!s &&
  s.length >= 2 &&
  s.length <= 90 &&
  /[A-Za-z]/.test(s) &&
  !/^(it|we|the company|company|shareholders|stockholders|merger|the merger|transaction|the transaction|controlling|holdco|opco|pubco|newco)$/i.test(s) &&
  // A bare legal suffix ("Corp" cut from "Corp Merger Sub") once resolved to International Bancshares Corp.
  !/^(?:corp|corporation|inc|incorporated|co|llc|l\.l\.c|ltd|limited|lp|l\.p|plc|n\.v|s\.a|ag|gmbh)\.?$/i.test(s.trim()) &&
  // Filing structure: "Item 1.01", "Exhibit 99.1"; legal prose: "Delaware General Corporation Law",
  // "During the five-year period following the Closing".
  !/^(?:Item|Exhibit)\s+\d/i.test(s) &&
  !/^(?:During|Pursuant to|Following the|Upon|Prior to|In connection with)\b|\bGeneral Corporation Law\b|\bfollowing the Closing\b|\bAs previously reported\b/i.test(s) &&
  // Deal paperwork and structure, not parties: "Definitive Agreement", "Entry into a Material Definitive Agreement",
  // "Company through a reverse triangular merger …", "Members of Company Management".
  !/\b(?:definitive agreement|material definitive|reverse triangular|similar structure|members of (?:the )?company management)\b/i.test(s) &&
  // Securities, not companies: "RTB's preferred stock", "the Common Stock".
  !/\b(?:preferred|common|capital) stock\b|\b(?:preferred|common) shares\b|\bwarrants\b|\bconvertible notes\b/i.test(s) &&
  // Clause fragments, not names: "The board of directors of the Company", "Merger On August 1, 2026".
  !/\b(?:board of directors|that certain|special committee|net to the|without interest|per share|Exchange Commission|(?:closing )?stock price|closing price)\b/i.test(s) &&
  !/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(?:19|20)\d{2}\b/.test(s) &&
  !/^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:19|20)\d{2}$/i.test(s.trim()) &&
  // Other legal documents an 8-K describes: "Restated Credit Agreement", "Notes and the Indenture are jointly …".
  !/\b(?:credit agreement|loan agreement|security agreement|indenture|amendment no|amended and restated|restated credit|supplemental)\b|^(?:the )?notes\b/i.test(s) &&
  // Group structure and paperwork, not a party: "Cayman Islands and a wholly-owned subsidiary of the Company",
  // "Parent and its subsidiaries, including the General Partner", "Merger by and among the Company, …".
  !/\bwholly[- ]owned subsidiary\b|\bsubsidiary of the Company\b|\bits subsidiaries\b|\bincluding the\b|\bby and among\b/i.test(s) &&
  // A description, a place or a product, not a company: "Leading Social Media & Technology", "Texas-based",
  // "EnvisionTEC's Category-leading Product", "Non-operated Oil and Gas" (working interests).
  !/^Leading\s/.test(s) &&
  // Prose, not a name: "Additionally, all options to purchase Ordinary Shares", "The Company received the required …",
  // "Equify Financial, LLC, as lender", "Third Amendment". Names keep their small words to "of", "and", "the" …
  !/^(?:Additionally|In addition|Also|However|Further(?:more)?),?\s|^(?:First|Second|Third|Fourth|Fifth)\s+(?:Amendment|Merger|Effective Time|Closing)\b|^The Company\s+[a-z]|,\s*as\s+(?:lender|agent|administrative agent|collateral agent|trustee|borrower|guarantor)\b/.test(s) &&
  // A numbered company with its number cut off: "1501016 B.C. Ltd." read as "B.C. Ltd".
  !/^(?:B\.?\s?C\.?|Ontario|Alberta|Canada|Nova Scotia)\s+(?:Ltd|Inc|Corp|ULC|Limited)\.?$/i.test(s.trim()) &&
  // A date run into the name: "Thoma Bravo March 10"; a moment in the deal: "Tenax at the Closing".
  !/\s(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}$/.test(s.trim()) &&
  !/\sat\s+(?:the\s+)?(?:Closing|Effective Time)$/i.test(s.trim()) &&
  // A document or its heading: "Definitive Proxy Statement on Schedule 14A", "Transaction Details F5".
  !/\b(?:Proxy Statement|Information Statement|Schedule (?:14A|14C|TO|13E-3)|Form 8-K|Transaction Details)\b/i.test(s) &&
  // A lower-case brand is a name ("bluebird bio, Inc.", "eBay", "salesforce.com").
  (/^[a-z]/.test(s) || (s.match(/(?:^|\s)(?!(?:of|and|the|de|du|la|le|del|der|des|di|for|in|on|at|by|a|an|y|et|und|van|von|e|inc|corp|co|llc|ltd|plc|lp|com)\b)(?![a-z'’-]*\.[a-z])[a-z][a-z'’-]+\b/g) ?? []).length < 2) &&
  !/^(?:the\s+)?(?:U\.?S\.?\s+)?subsidiary(?:\s+of)?$/i.test(s.trim()) &&
  !/^[A-Za-z.]+-based$/i.test(s.trim()) &&
  !/\bProduct$/.test(s.trim()) &&
  !/^Non-operated\b/i.test(s) &&
  // A jurisdiction or a defined agreement term read as a party: "Florida", "Nevada corporation", "Luxembourg",
  // "Closing", "Amendment", "Business Combination Agreement", "Patent Sale Agreement".
  !new RegExp(`^(?:${PLACES})(?:,\\s*(?:Canada|USA|United States))?(?:\\s+(?:corporation|company|limited liability company|limited partnership|partnership|trust|bank))?$`, "i").test(s.trim()) &&
  !/^(?:the\s+)?(?:Closing|Amendment|Effective Time|Transactions?|Business Combination|General Partner|Limited Partners?|First|Second|Third)$/i.test(s.trim()) &&
  // "Directors of the Company", "Merger and certain related contributions"
  !/^(?:the\s+)?Directors\b|\bof the Company$|^(?:Mergers?|Transactions?)\s+(?:and|of|with)\b/i.test(s.trim()) &&
  // An agent named in an agreement: "American Stock Transfer & Trust Company, LLC, as Rights Agent".
  !/\bas (?:Rights|Exchange|Paying|Escrow|Depositary|Administrative) Agent\b/i.test(s) &&
  !/\bAgreement$/.test(s.trim());

const PLACES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois",
  "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri",
  "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma",
  "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
  "West Virginia", "Wisconsin", "Wyoming", "Puerto Rico", "U\\.?S\\.?A?\\.?", "United States", "Canada", "Ontario", "British Columbia", "Quebec",
  "Bermuda", "Cayman Islands", "Jersey", "Guernsey", "Ireland", "England(?: and Wales)?", "United Kingdom", "Luxembourg", "Netherlands", "Germany",
  "France", "Switzerland", "Israel", "Japan", "China", "Hong Kong", "Singapore", "Australia", "Thailand", "India", "Mexico", "Brazil",
].join("|");

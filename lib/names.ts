/** Company-name display rules shared by the ingest (when storing) and the site (when serving older records). */

/** A company's two-letter monogram: its capitals ("Hewlett Packard" -> "HP"), else its first two letters. */
export const initials = (name: string) => name.replace(/[^A-Z]/g, "").slice(0, 2) || name.slice(0, 2).toUpperCase();

/** Buyer names that are really acquisition vehicles or defined terms, to be replaced by a better name when one arrives. */
export const isPlaceholderBuyer = (name: string) =>
  /^(?:the\s+)?(?:Parent|Purchaser|Buyer|Acquir[eo]r|Merger Sub|Company|Investor Group|Consortium)$/i.test(name.trim()) ||
  // ("2025 Acquisition Company, LLC": Forian's vehicle, which "Acquisition Co" missed at the word boundary.)
  /\b(?:Merger ?Sub|MergeCo|MergerCo|AcquireCo|AcquisitionCo|Bidco|BidCo|Topco|TopCo|Midco|Holdco|HoldCo|ParentCo|Purchaser|Acquisition (?:Corp|Company|Co|LLC|Inc))\b/.test(name) ||
  /^(?:[A-Z][A-Za-z]+ )+(?:Parent|Buyer)(?:,? (?:Inc|LLC|L\.?P|Corp)\.?)?$/.test(name) ||
  // "Acquiror …", and "Acquirer Sub" (Amgen's vehicle in its scheme for Horizon).
  /^Acquir[eo]r\b/.test(name) ||
  // "Denali Intermediate Holdings, Inc.", "Bullseye FinCo, Inc.", "Beacon Parent Holdings, L.P.", "Eclipse Parent
  // Acquisitions, LLC", "Project Hospitality Parent, LLC", "Buyer Group Led by Evercel"
  /\b(?:Intermediate(?: Holdings?| Holdco| Holding Corp\.?)?|FinCo|Finco|Parent (?:Holdings?|Acquisitions?|Corp(?:oration)?)|Buyer (?:Group|Corp\.?|Inc\.?))\b/.test(name) ||
  /^Project [A-Z]/.test(name);

/**
 * Private-equity firms whose names collide with a listed company once `normalizeName` drops descriptors: "Advent
 * International" and "Advent Technologies Holdings" (a fuel-cell maker) both become "advent", which credited Advent's
 * buyouts of McAfee, Maxar, Heidrick & Struggles and Sapiens to the fuel-cell maker.
 */
export const COLLIDING_SPONSORS = [
  "Advent International", "Advent", "Bain Capital", "Vista Equity Partners", "Silver Lake", "Elliott", "Cerberus", "Searchlight",
  "Sycamore Partners", "Sycamore", "Platinum Equity", "Stone Point", "Lone Star", "Summit Partners", "Gores", "Clearlake", "Centerbridge",
  "Warburg Pincus", "Thoma Bravo", "Permira", "Hellman & Friedman", "Veritas Capital", "Genstar", "Insight Partners", "Francisco Partners",
  "Cinven", "CVC",
];
// Words a sponsor's own registered name may add ("Bain Capital, LP", "Elliott Investment Management L.P.").
const SPONSOR_FORM = new Set(["partners", "capital", "management", "investment", "investments", "group", "holdings", "holding", "global", "fund", "funds", "advisors", "advisers", "inc", "corp", "corporation", "co", "company", "lp", "llc", "ltd", "limited", "l", "p", "the", "and", "international", "equity"]);

/**
 * Buyout firms sharing their whole name with an unrelated listed company, so a registrant adding no words proves nothing:
 * only the registrant's own full name links to it. EQT AB's funds ("EQT", "EQT Infrastructure", "EQT Asia": Covanta,
 * Perficient) aren't the gas producer EQT Corporation, whose releases say "EQT Corporation ("EQT") (NYSE: EQT)". Hg
 * (OneStream) isn't HG Holdings, Inc., the former furniture maker.
 */
const NAMESAKES: { firm: RegExp; registrant: RegExp }[] = [
  { firm: /^EQT\b/i, registrant: /^EQT Corp/i },
  { firm: /^Hg(?:\b|Capital)/i, registrant: /^HG Holdings/i },
];

/**
 * A registrant is not the sponsor a document named when it adds words of its own: "Advent Technologies Holdings" is not
 * "Advent" or "Advent International", "Bain Capital Specialty Finance" (a listed lending fund) is not Bain Capital.
 * False for names that aren't a colliding sponsor ("Apollo" is Apollo Global Management).
 */
export function notTheSponsor(named: string, registrant: string): boolean {
  const namesake = NAMESAKES.find((n) => n.firm.test(named.trim()) && n.registrant.test(registrant.trim()));
  if (namesake) return !namesake.registrant.test(named.trim());
  const lower = named.toLowerCase().trim();
  const sponsor = COLLIDING_SPONSORS.find((s) => lower === s.toLowerCase() || lower.startsWith(`${s.toLowerCase()} `) || lower.startsWith(`${s.toLowerCase()},`));
  if (!sponsor) return false;
  const own = new Set(sponsor.toLowerCase().replace(/&/g, " ").match(/[a-z0-9]+/g) ?? []);
  // SEC state tags aside ("… /DE/").
  const words = registrant.replace(/\s*[\\/][A-Za-z]{2,4}[\\/]?\s*$/, "").toLowerCase().replace(/&/g, " ").match(/[a-z0-9]+/g) ?? [];
  return words.some((w) => !own.has(w) && !SPONSOR_FORM.has(w));
}

/** "Varonis Systems Inc" -> "Varonis Systems": a tombstone's name, set large, reads unfinished with its legal form. */
const LEGAL_FORM =
  /,?\s+(?:Public (?:Limited Company|Ltd Co)|Inc\.?|Incorporated|Corp\.?|Corporation|Ltd\.?|Limited|Pte\.?|LLC|L\.L\.C\.|LLP|plc\.?|PLC\.?|N\.V\.|N V|NV|B\.V\.|BV|S\.A\.S\.|SAS|S\.A\.|S A|SA|S\.p\.A\.|SpA|S\.E\.|SE|AG|A\/S|GmbH|L\.P\.|LP|PBC|(?<!&\s)Co\.?)$/;
export function withoutLegalForm(name: string): string {
  // Repeatedly: "Noble Corp plc", "Franklin Electric Co Inc", "Sapiens International Corp N V". A joint buyer's too:
  // "Elliott Investment Management L.P. and Brookfield Asset Management".
  let s = name.replace(/,?\s+(?:L\.P\.|LP|LLC|Inc\.?|Corp\.?)(?=,?\s+and\s)/g, "");
  for (let next = s.replace(LEGAL_FORM, ""); next !== s && next; next = s.replace(LEGAL_FORM, "")) s = next;
  return s || name;
}

const KEEP_CAPS = /^(?:LLC|LP|LLP|PLC|NV|SA|AG|SE|USA|US|UK|II|III|IV|AI|IT|HR|RF|TV|CW|[A-Z]{1,3}|[A-Z]+\d+\w*|[IVX]+-[IVX]+)$/;
const SUFFIX_CASE: Record<string, string> = { INC: "Inc", "INC.": "Inc.", CORP: "Corp", "CORP.": "Corp.", LTD: "Ltd", "LTD.": "Ltd.", CO: "Co", "CO.": "Co.", HOLDINGS: "Holdings", GROUP: "Group" };
// Short English words that are words, not acronyms, in an all-capitals name.
const MINOR = new Set(["OF", "AND", "FOR", "AT", "IN", "ON", "BY", "TO", "THE", "A", "AN"]);
const SHORT_WORDS = new Set(["AIR", "OIL", "GAS", "SEA", "SUN", "BAY", "CAR", "NEW", "ONE", "TWO", "BIG", "RED", "TOP", "WAY", "FOX", "KEY", "ART", "LAW", "PRO", "BIO", "ITS", "OLD", "ICE", "SKY", "BAR", "WAR", "LAB", "EYE", "DOG", "CAT", "BOX", "HUB", "LED", "RIO", "OWL", "DOT", "PET", "INN", "NET", "BOW"]);

const capWord = (w: string) =>
  w.replace(/[A-Z][A-Z'’&-]*/g, (t) => t[0] + t.slice(1).toLowerCase()).replace(/\b([A-Z])(['’])([a-z])/g, (_, a: string, q: string, c: string) => a + q + c.toUpperCase());
/** "Mckesson" -> "McKesson", "Mclennan" -> "McLennan": the letter after a "Mc" prefix is a capital. */
const fixMc = (s: string) => s.replace(/\bMc([a-z])/g, (_, c: string) => "Mc" + c.toUpperCase());

/**
 * "TETON FINANCIAL SERVICES" -> "Teton Financial Services"; "WTG MIDSTREAM" -> "WTG Midstream". Only names written
 * entirely in capitals with two or more words; short tokens (acronyms, "LLC") stay as they are. "IBM" and
 * "KKR" are untouched.
 */
export function titleCaseCaps(name: string): string {
  if (/[a-z]/.test(name) || name.trim().split(/\s+/).length < 2) return name;
  let first = true;
  return name
    .split(/(\s+)/)
    .map((w) => {
      if (/^\s+$/.test(w)) return w;
      const isFirst = first;
      first = false;
      if (MINOR.has(w)) return isFirst ? w[0] + w.slice(1).toLowerCase() : w.toLowerCase();
      if (SHORT_WORDS.has(w)) return w[0] + w.slice(1).toLowerCase();
      if (SUFFIX_CASE[w]) return SUFFIX_CASE[w];
      if (KEEP_CAPS.test(w.replace(/[,.]$/, "")) || /&|\d|\.[A-Z]/.test(w)) return w;
      return fixMc(capWord(w));
    })
    .join("");
}

/**
 * Brands written in mixed case, which no title-casing of an all-capitals SEC name can recover ("VMWARE, INC." ->
 * "Vmware, Inc."). Matched as whole words, case-insensitively.
 */
const BRANDS = new Map(
  [
    "VMware", "iRobot", "ConocoPhillips", "JetBlue", "PepsiCo", "BlackRock", "FedEx", "eBay", "PayPal", "HubSpot", "ServiceNow", "CrowdStrike",
    "DocuSign", "SolarWinds", "NextEra", "AbbVie", "BioNTech", "AstraZeneca", "GlaxoSmithKline", "LinkedIn", "YouTube", "iHeartMedia",
    "MicroStrategy", "CarMax", "DaVita", "AutoNation", "DoorDash", "GitLab", "HashiCorp", "CoreWeave", "DigitalOcean", "BioMarin", "NetApp",
    "RingCentral", "SailPoint", "SentinelOne", "TripAdvisor", "TrueBlue", "UnitedHealth", "WestRock", "ZoomInfo", "FirstEnergy", "NiSource",
    "CenterPoint", "PulteGroup", "MasTec", "MarketAxess", "LiveRamp", "DoubleVerify", "PubMatic", "AppLovin", "Cerner", "WillScot", "SmartRent",
    "SoundHound", "OneMain", "TransDigm", "BorgWarner", "PetIQ", "PetSmart", "eHealth", "NortonLifeLock", "GoDaddy", "WeWork", "SeaWorld",
    "AeroVironment", "AmerisourceBergen", "BankUnited", "BioCryst", "CareDx", "ChampionX", "ChargePoint", "DexCom", "EchoStar", "EnerSys",
    "FactSet", "FirstCash", "HealthEquity", "InterDigital", "IntriCon", "KnowBe4", "LendingTree", "LivePerson", "MoneyGram", "MongoDB",
    "NetScout", "NovoCure", "PacWest", "PagerDuty", "PowerSchool", "ProPetro", "QuidelOrtho", "RadNet", "SiriusXM", "StoneCo", "SunPower",
    "TaskUs", "TrueCar", "UiPath", "UniFirst", "VeriSign", "WebMD", "WideOpenWest", "WisdomTree", "ZipRecruiter", "eGain", "eMagin", "AtriCure",
    "ArcBest", "DuPont", "ExxonMobil", "GreenSky", "HomeStreet", "InfuSystem", "LeMaitre", "MaxLinear", "MicroVision", "OraSure", "RealPage",
    "SecureWorks", "SkyWest", "SpartanNash", "TriNet", "WesBanco", "ePlus", "iCAD", "iRhythm", "uniQure", "MarineMax", "FLIR", "ICON", "LegalZoom",
  ].map((b) => [b.toLowerCase(), b]),
);
const applyBrands = (s: string) =>
  s
    .replace(/\bAmazon[ .]Com\b/i, "Amazon.com")
    .replace(/\bKimberly Clark\b/i, "Kimberly-Clark")
    .replace(/\bEli Lilly\b/i, "Eli Lilly")
    .replace(/\bAir Lease\b/i, "Air Lease")
    .replace(/\b(Consortium|Group) Led by\b/, "$1 led by")
    // The name in use: "Maplebear Inc. d/b/a Instacart" announces itself as Instacart.
    .replace(/\bMaplebear\b/i, "Instacart")
    // "STAMPS.COM Inc" -> "Stamps.com Inc"
    .replace(/\b([A-Z])([A-Z]+)\.COM\b/g, (_, a: string, b: string) => a + b.toLowerCase() + ".com")
    .replace(/\b[A-Za-z][A-Za-z0-9]*\b/g, (w) => BRANDS.get(w.toLowerCase()) ?? w);

/**
 * A company name as the terminal shows it: SEC state tags dropped ("Lifecore Biomedical, Inc. \Del\",
 * "Acme Corp /DE/"), all-capitals names title-cased, and a capitalised run inside a mixed name too
 * ("PERDOCEO EDUCATION Corp" -> "Perdoceo Education Corp", "TransDigm Group INC" -> "TransDigm Group Inc").
 * A single capitalised brand ("NVIDIA Corp", "BIO-TECHNE Corp") is left alone.
 */
export function displayCompanyName(raw: string): string {
  let s = raw.replace(/\s*[\\/]\s*[A-Za-z]{2,4}\s*[\\/]?\s*$/, "").replace(/\s*[\\/]\s*$/, "").trim();
  if (!/[a-z]/.test(s)) return applyBrands(titleCaseCaps(s));
  s = s.replace(/\b(INC|CORP|LTD|CO)\b(\.?)/g, (_, w: string, dot: string) => (SUFFIX_CASE[w] ?? w) + dot);
  const caps = s.match(/\b[A-Z]{4,}\b/g) ?? [];
  // "CVS HEALTH Corp": a short acronym (no vowels) beside a capitalised word counts as a run too. "NVIDIA Corp" alone is a brand.
  if (caps.length >= 2 || /(?<![-.])\b[B-DF-HJ-NP-TV-Z]{3}\s+[A-Z]{4,}\b/.test(s)) s = s.replace(/\b[A-Z]{4,}\b/g, (w) => (SUFFIX_CASE[w] ?? capWord(w)));
  // A capitalised possessive brand: "CAMPBELL'S Co" -> "Campbell's Co", "DENNY'S Corp" -> "Denny's Corp".
  s = s.replace(/\b([A-Z])([A-Z]{2,})(['’])S\b/g, (_, a: string, b: string, q: string) => a + b.toLowerCase() + q + "s");
  // SEC names lose acronyms when title-cased ("TXNM ENERGY" -> "Txnm Energy"): a word with no vowels is an acronym.
  s = s.replace(/\b[B-DF-HJ-NP-TV-XZ][b-df-hj-np-tv-xz]{1,4}\b/g, (w) => (/^(?:St|Mr|Mrs|Dr|Ft|Mt|Jr|Sr|Ltd|Svcs|Hldgs|Mgmt|Grp|Intl|Natl|Mfg|Pty|Bhd)$/.test(w) ? w : w.toUpperCase()));
  // Small words inside a name: "Bank Of Hawaii" -> "Bank of Hawaii".
  s = s.replace(/(?<=\S\s)(Of|And|For|The|At|In|On)(?=\s)/g, (w) => w.toLowerCase());
  // Suffixes and numerals title-cased word by word: "Northstrive Fund Ii Lp" -> "Northstrive Fund II LP".
  s = s.replace(/\b(?:Lp|Llp|Llc|Ii|Iii)\b/g, (w) => w.toUpperCase());
  // Names stored title-cased before the "Mc" rule: "Mckesson Corp" -> "McKesson Corp".
  return applyBrands(fixMc(s));
}

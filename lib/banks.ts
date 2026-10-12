/**
 * Known investment banks (M&A advisors and IPO underwriters), with the
 * spellings they use in filings. Canonical names feed the league table.
 *
 * Order matters for overlapping names: more specific patterns come first.
 */

export interface Bank {
  name: string;
  short: string;
  pattern: RegExp;
}

const b = (name: string, short: string, pattern: RegExp): Bank => ({ name, short, pattern });

export const BANKS: Bank[] = [
  // Bulge bracket
  b("Goldman Sachs", "GS", /\bGoldman,? Sachs\b/),
  b("Morgan Stanley", "MS", /\bMorgan Stanley\b/),
  b("JPMorgan", "JPM", /\bJ\.?\s?P\.? ?Morgan\b|\bJPMorgan\b/),
  b("BofA Securities", "BofA", /\bBofA\b|\bBank of America\b|\bMerrill Lynch\b/),
  b("Citigroup", "C", /\bCiti(?:group(?: Global Markets)?)?\b(?! of)/),
  b("Barclays", "BARC", /\bBarclays\b/),
  b("Deutsche Bank", "DB", /\bDeutsche Bank\b/),
  b("UBS", "UBS", /\bUBS\b/),
  b("Wells Fargo", "WFC", /\bWells Fargo\b/),
  b("RBC Capital Markets", "RBC", /\bRBC\b|\bRoyal Bank of Canada\b/),
  b("BNP Paribas", "BNP", /\bBNP Paribas\b/),
  b("HSBC", "HSBC", /\bHSBC\b/),
  b("Mizuho", "MZ", /\bMizuho\b/),
  b("MUFG", "MUFG", /\bMUFG\b|\bMitsubishi UFJ\b/),
  b("SMBC Nikko", "SMBC", /\bSMBC\b|\bSumitomo Mitsui\b/),
  b("Nomura", "NMR", /\bNomura\b/),
  b("Jefferies", "JEF", /\bJefferies\b/),
  // Elite boutiques
  b("Evercore", "EVR", /\bEvercore\b/),
  b("Centerview", "CVP", /\bCenterview\b/),
  b("Lazard", "LAZ", /\bLazard\b/),
  b("PJT Partners", "PJT", /\bPJT\b/),
  b("Moelis", "MC", /\bMoelis\b/),
  b("Perella Weinberg", "PWP", /\bPerella Weinberg\b/),
  b("Guggenheim", "GUG", /\bGuggenheim Securities\b|\bGuggenheim Partners\b/),
  b("Qatalyst", "QTL", /\bQatalyst\b/),
  b("Allen & Company", "ALN", /\bAllen & Co(?:mpany|\.)\b/),
  b("LionTree", "LT", /\bLionTree\b/),
  b("Houlihan Lokey", "HLI", /\bHoulihan Lokey\b/),
  b("Ardea Partners", "ARD", /\bArdea Partners\b/),
  b("Greenhill", "GHL", /\bGreenhill\b/),
  b("Rothschild & Co", "ROTH", /\bRothschild\b/),
  b("Robey Warshaw", "RW", /\bRobey Warshaw\b/),
  b("Ducera", "DUC", /\bDucera\b/),
  b("Solomon Partners", "SOL", /\bSolomon Partners\b/),
  b("Tidal Partners", "TDL", /\bTidal Partners\b/),
  b("Wells Fargo", "WFC", /\bWells Fargo Securities\b/),
  // Middle market / regional
  b("William Blair", "WB", /\bWilliam Blair\b/),
  b("Baird", "RWB", /\bBaird\b/),
  b("Piper Sandler", "PIPR", /\bPiper Sandler\b/),
  b("Raymond James", "RJF", /\bRaymond James\b/),
  b("Stifel", "SF", /\bStifel\b|\bKeefe,? Bruyette\b|\bKBW\b/),
  b("Truist Securities", "TFC", /\bTruist\b/),
  b("KeyBanc Capital Markets", "KEY", /\bKeyBanc\b/),
  b("Citizens", "CFG", /\bCitizens (?:JMP|Capital Markets)\b|\bJMP Securities\b/),
  b("TD Cowen", "TD", /\bTD Cowen\b|\bTD Securities\b|\bCowen\b/),
  b("Leerink Partners", "LRNK", /\bLeerink\b|\bSVB Securities\b/),
  b("Cantor Fitzgerald", "CF", /\bCantor\b/),
  b("Needham", "NDHM", /\bNeedham\b/),
  b("Oppenheimer", "OPY", /\bOppenheimer\b/),
  b("B. Riley", "RILY", /\bB\. ?Riley\b/),
  b("Canaccord Genuity", "CG", /\bCanaccord\b/),
  b("Lake Street", "LKST", /\bLake Street Capital\b/),
  b("Roth Capital", "ROTH", /\bRoth Capital\b/),
  b("Guggenheim", "GUG", /\bGuggenheim\b/),
  b("Janney Montgomery Scott", "JMS", /\bJanney\b/),
  b("D.A. Davidson", "DAD", /\bD\.\s?A\. Davidson\b/),
  b("Hovde Group", "HOV", /\bHovde\b/),
  b("Performance Trust", "PTC", /\bPerformance Trust\b/),
  b("Morgan Keegan", "MK", /\bMorgan Keegan\b/),
  b("Texas Capital Securities", "TCBI", /\bTexas Capital Securities\b/),
  b("Tudor, Pickering, Holt", "TPH", /\bTudor,? Pickering\b/),
  b("Scotiabank", "BNS", /\bScotia(?:bank| Capital)\b/),
  b("BMO Capital Markets", "BMO", /\bBMO\b/),
  b("CIBC", "CIBC", /\bCIBC\b/),
  b("National Bank Financial", "NBF", /\bNational Bank Financial\b/),
  b("Macquarie", "MQG", /\bMacquarie\b/),
  b("Santander", "SAN", /\bSantander\b/),
  b("Société Générale", "GLE", /\bSoci[ée]t[ée] G[ée]n[ée]rale\b/),
  b("Credit Agricole", "ACA", /\bCr[ée]dit Agricole\b/),
  b("ING", "ING", /\bING Financial Markets\b/),
  b("Moelis", "MC", /\bMoelis & Company\b/),
  b("MarshBerry", "MB", /\bMarshBerry\b/),
  b("Centerview", "CVP", /\bCenterview Partners\b/),
  b("Wedbush", "WEDB", /\bWedbush\b/),
  b("Benchmark", "BMK", /\bThe Benchmark Company\b/),
  b("Loop Capital", "LOOP", /\bLoop Capital\b/),
  b("Academy Securities", "ACAD", /\bAcademy Securities\b/),
  b("Siebert Williams Shank", "SWS", /\bSiebert Williams\b/),
  b("Drexel Hamilton", "DH", /\bDrexel Hamilton\b/),
  b("Ramirez & Co", "RAM", /\bRamirez & Co\b/),
  b("Capital One Securities", "COF", /\bCapital One Securities\b/),
  b("Deutsche Bank", "DB", /\bDeutsche Bank Securities\b/),
  b("Clear Street", "CLST", /\bClear Street\b/),
  b("Maxim Group", "MAXM", /\bMaxim Group\b/),
  b("ThinkEquity", "THNK", /\bThinkEquity\b/),
  b("EF Hutton", "EFH", /\bEF Hutton\b/),
  b("Aegis Capital", "AEGS", /\bAegis Capital\b/),
  b("Univest Securities", "UNIV", /\bUnivest Securities\b/),
  b("Craig-Hallum", "CH", /\bCraig-Hallum\b/),
  b("BTIG", "BTIG", /\bBTIG\b/),
  b("Evercore", "EVR", /\bEvercore ISI\b/),
  // Small-cap underwriters: they lead most small IPOs, and covers often print them in capitals ("EDDID SECURITIES USA INC.").
  b("H.C. Wainwright", "HCW", /\bH\.\s?C\.\s?Wainwright\b/i),
  b("Ladenburg Thalmann", "LTS", /\bLadenburg Thalmann\b/i),
  b("Northland Capital Markets", "NLND", /\bNorthland (?:Capital Markets|Securities)\b/i),
  b("Chardan", "CHDN", /\bChardan Capital Markets\b/i),
  b("A.G.P.", "AGP", /\bA\.G\.P\.\/Alliance Global Partners\b|\bAlliance Global Partners\b/i),
  b("Laidlaw & Company", "LAID", /\bLaidlaw & Company\b/i),
  b("Rodman & Renshaw", "RODM", /\bRodman & Renshaw\b/i),
  b("D. Boral Capital", "DBRL", /\bD\.\s?Boral Capital\b/i),
  b("Kingswood Capital", "KWD", /\bKingswood Capital (?:Partners|Markets)\b/i),
  b("Eddid Securities", "EDD", /\bEddid Securities\b/i),
  b("Pacific Century Securities", "PCSC", /\bPacific Century Securities\b/i),
  b("R.F. Lafferty", "RFL", /\bR\.\s?F\.\s?Lafferty\b/i),
  b("Joseph Gunnar", "JGUN", /\bJoseph Gunnar\b/i),
  b("Joseph Stone Capital", "JSTN", /\bJoseph Stone Capital\b/i),
  b("Dominari Securities", "DOMS", /\bDominari Securities\b/i),
  b("Revere Securities", "RVRE", /\bRevere Securities\b/i),
  b("Spartan Capital", "SPRT", /\bSpartan Capital Securities\b/i),
  b("Boustead Securities", "BSTD", /\bBoustead Securities\b/i),
  b("Network 1 Financial", "NET1", /\bNetwork 1 Financial\b/i),
  b("Prime Number Capital", "PNCP", /\bPrime Number Capital\b/i),
  b("US Tiger Securities", "TIGR", /\bU\.?S\.? Tiger Securities\b/i),
  b("WestPark Capital", "WPRK", /\bWestPark Capital\b/i),
  b("Bancroft Capital", "BNCR", /\bBancroft Capital\b/i),
  b("Cathay Securities", "CATH", /\bCathay Securities\b/i),
  b("AC Sunshine Securities", "ACSS", /\bAC Sunshine Securities\b/i),
  b("Craft Capital Management", "CRFT", /\bCraft Capital Management\b/i),
  b("Lucid Capital Markets", "LUCD", /\bLucid Capital Markets\b/i),
  b("Brookline Capital Markets", "BRKL", /\bBrookline Capital Markets\b/i),
];

const BY_NAME = new Map<string, Bank>();
for (const bank of BANKS) if (!BY_NAME.has(bank.name)) BY_NAME.set(bank.name, bank);

export const bankShortName = (name: string) =>
  BY_NAME.get(name)?.short ??
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 4);

/** Canonical bank names found in `text`, in order of first appearance, de-duplicated. */
export function findBanks(text: string): string[] {
  const hits: { name: string; index: number }[] = [];
  for (const bank of BANKS) {
    const m = bank.pattern.exec(text);
    if (m) hits.push({ name: bank.name, index: m.index });
  }
  hits.sort((a, b2) => a.index - b2.index);
  const seen = new Set<string>();
  return hits.filter((h) => !seen.has(h.name) && seen.add(h.name)).map((h) => h.name);
}

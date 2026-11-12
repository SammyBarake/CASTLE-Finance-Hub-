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
  // Not an address: "Faegre Drinker Biddle & Reath LLP 2200 Wells Fargo Center" (counsel on Patriot Mobile's cover).
  b("Wells Fargo", "WFC", /\bWells Fargo\b(?! (?:Center|Plaza|Tower|Building|Place)\b)/),
  b("RBC Capital Markets", "RBC", /\bRBC\b|\bRoyal Bank of Canada\b/),
  b("BNP Paribas", "BNP", /\bBNP Paribas\b/),
  b("HSBC", "HSBC", /\bHSBC\b/),
  b("Mizuho", "MZ", /\bMizuho\b/),
  b("MUFG", "MUFG", /\bMUFG\b|\bMitsubishi UFJ\b/),
  // (Not "SMBC AC" or "SMBC Aviation Capital", a buyer of Air Lease, nor the banking group's leasing arm.)
  b("SMBC Nikko", "SMBC", /\bSMBC\b(?!\s+(?:AC\b|Aviation))|\bSumitomo Mitsui\b(?!\s+(?:Finance and Leasing|Financial Group))/),
  b("Nomura", "NMR", /\bNomura\b/),
  b("Jefferies", "JEF", /\bJefferies\b/),
  b("Credit Suisse", "CS", /\bCredit Suisse\b|\bCREDIT SUISSE\b/),
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
  // Not the law firm Fox Rothschild LLP, counsel on many registration covers (Starton read it as its underwriter).
  b("Rothschild & Co", "ROTH", /(?<!\bFox )\bRothschild\b(?! LLP)/),
  b("Robey Warshaw", "RW", /\bRobey Warshaw\b/),
  b("Ducera", "DUC", /\bDucera\b/),
  b("Solomon Partners", "SOL", /\bSolomon Partners\b|\bPeter J\. Solomon\b|\bPJ S(?:olomon|OLOMON)\b/),
  b("Tidal Partners", "TDL", /\bTidal Partners\b/),
  b("Wells Fargo", "WFC", /\bWells Fargo Securities\b/),
  // Middle market / regional
  b("William Blair", "WB", /\bWilliam Blair\b/),
  b("Baird", "RWB", /\bBaird\b/),
  b("Piper Sandler", "PIPR", /\bPiper Sandler\b|\bPiper Jaffray\b|\bSimmons & Company International\b/),
  b("Raymond James", "RJF", /\bRaymond James\b/),
  b("Stifel", "SF", /\bStifel\b|\bKeefe,? Bruyette\b|\bKBW\b/),
  b("Truist Securities", "TFC", /\bTruist\b|\bSunTrust Robinson Humphrey\b|\bBB&T Capital Markets\b/),
  b("KeyBanc Capital Markets", "KEY", /\bKeyBanc\b/),
  b("Citizens", "CFG", /\bCitizens (?:JMP|Capital Markets)\b|\bJMP Securities\b/),
  b("TD Cowen", "TD", /\bTD Cowen\b|\bTD Securities\b|\bCowen\b/),
  b("Leerink Partners", "LRNK", /\bLeerink\b|\bSVB Securities\b/),
  b("Cantor Fitzgerald", "CF", /\bCantor\b/),
  b("Needham", "NDHM", /\bNeedham\b/),
  b("Oppenheimer", "OPY", /\bOppenheimer\b/),
  b("B. Riley", "RILY", /\bB\. ?Riley\b|\bFBR Capital Markets\b/),
  b("Canaccord Genuity", "CG", /\bCanaccord\b/),
  b("Lake Street", "LKST", /\bLake Street Capital\b/),
  b("Roth Capital", "ROTH", /\bR(?:oth|OTH) Capital\b/),
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
  b("National Bank Financial", "NBF", /\bNational Bank Financial\b|\bNational Bank of Canada Financial\b/),
  b("Macquarie", "MQG", /\bMacquarie\b/),
  b("Santander", "SAN", /\bSantander\b/),
  b("Société Générale", "GLE", /\bSoci[ée]t[ée] G[ée]n[ée]rale\b|\bS ?G Americas Securities\b/),
  b("Credit Agricole", "ACA", /\bCr[ée]dit Agricole\b/),
  b("ING", "ING", /\bING Financial Markets\b/),
  b("Moelis", "MC", /\bMoelis & Company\b/),
  b("MarshBerry", "MB", /\bMarshBerry\b/),
  b("Centerview", "CVP", /\bCenterview Partners\b/),
  b("M. Klein and Company", "MKC", /\bM\. ?Klein (?:and|&) Company\b/),
  b("Eastdil Secured", "EDS", /\bEastdil Secured\b/),
  b("Olsen Palmer", "OP", /\bOlsen Palmer\b/),
  b("BDT & MSD Partners", "BDT", /\bBDT (?:&|and) (?:MSD|Company)\b/),
  b("TSB Capital Advisors", "TSB", /\bTSB Capital\b/),
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
  b("Chardan", "CHDN", /\bChardan Capital Markets\b|\bCHARDAN CAPITAL MARKETS\b|\bChardan\b(?!\s+(?:Healthcare|NexTech|China|Metropol|Acquisition|\d))/),
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
  // From the 26 priced IPOs' underwriting tables, November 2026 (Vogenx's sole bookrunner was JonesTrading, and the record
  // showed none). Whole names only: Blackstone and Brookfield are buyers and MDB a company name; these are their dealers.
  b("JonesTrading", "JONE", /\bJonesTrading\b/i),
  // LIS Technologies' cover: "Sole Bookrunner Titan Partners".
  b("Titan Partners", "TITN", /\bTitan Partners (?:Securities|Group)\b|(?<=\bBookrunners?\s+)Titan Partners\b/i),
  b("Rosenblatt Securities", "RSBT", /\bRosenblatt Securities\b/i),
  b("MDB Capital", "MDB", /\bMDB Capital\b/),
  b("Huatai Securities", "HTSC", /\bHuatai Securities\b/i),
  b("CMB International", "CMBI", /\bCMB International Capital\b/i),
  b("Fortune Securities", "FORT", /\bFortune \(HK\) Securities\b/i),
  b("BOCOM International", "BOCM", /\bBOCOM International Securities\b/i),
  b("VC Brokerage", "VCB", /\bVC Brokerage\b/),
  b("Telsey Advisory Group", "TLSY", /\bTelsey Advisory Group\b/i),
  b("Wolfe Research", "WOLF", /\bWR Securities\b|\bWolfe Research Securities\b/),
  b("PNC Capital Markets", "PNC", /\bPNC Capital Markets\b/),
  b("Brookfield Securities", "BAM", /\bBrookfield Securities\b/),
  b("Blackstone Securities Partners", "BXSP", /\bBlackstone Securities Partners\b/),
  b("Rabo Securities", "RABO", /\bRabo Securities\b/),
  b("Tigress Financial Partners", "TGRS", /\bTigress Financial Partners\b/i),
  b("Penserra Securities", "PENS", /\bPenserra Securities\b/i),
  b("Roberts & Ryan", "RYAN", /\bRoberts & Ryan\b/i),
  // From the pipeline's underwriting tables, November 11 2026 (SB Energy, Nscale, Starton). Dealers' own names:
  // "Huntington" and "Compass" alone are a bank holding company and many other firms.
  b("Natixis", "KN", /\bNatixis\b/),
  b("ABN AMRO", "ABN", /\bABN AMRO\b/),
  b("Huntington Securities", "HBAN", /\bHuntington Securities\b/),
  b("Compass Point", "CPRT", /\bCompass Point Research\b|\bCompass Point(?=\s+(?:DNB|Rosenblatt|SEB|\(|Research|&))/),
  b("DNB Carnegie", "DNB", /\bDNB Carnegie\b|\bDNB Markets\b/),
  b("SEB", "SEB", /\bSEB Securities\b|\bSkandinaviska Enskilda\b/),
  b("Sentinel Brokers", "SNTL", /\bSentinel Brokers\b/),
  // RegenLab's representative; the broker-dealer, not StoneX Group, the listed company.
  b("StoneX Financial", "SNEX", /\bStoneX Financial\b/),
  // The rest of those tables (Wella, Oura, SB Energy, TFP, Ambitious Entertainment): dealers' names, never the bare parent,
  // which buys companies (KKR, Robinhood, BBVA) or is an M&A party.
  b("KKR Capital Markets", "KCM", /\bKKR Capital Markets\b/),
  b("BBVA", "BBVA", /\bBBVA Securities\b/),
  b("Commerzbank", "CBK", /\bCommerz Markets\b|\bCommerzbank\b/),
  b("Intesa Sanpaolo", "ISP", /\bIntesa Sanpaolo IMI\b|\bIMI[- ]Intesa Sanpaolo\b/),
  b("UniCredit", "UCG", /\bUniCredit Capital Markets\b/),
  b("Raiffeisen Bank International", "RBI", /\bRB International Markets\b|\bRaiffeisen Bank International\b/),
  b("Daiwa Capital Markets", "DAIW", /\bDaiwa Capital Markets\b|\bDaiwa Securities\b/),
  b("Newmark Securities", "NMRK", /\bNewmark Securities\b/),
  b("Robinhood Securities", "HOOD", /\bRobinhood Securities\b/),
  b("Dowling & Partners", "DOWL", /\bDowling & Partners\b/),
  b("Alexander Capital", "ALXC", /\bAlexander Capital,? L\.?P\b/),
  // M&A advisers filings keep naming (a census of the "acting as financial advisor" position over cached releases, November
  // 2026: a real firm, at least 5 documents and more than one deal). Whole names only: a surname or a bare first word would
  // match people and other companies. "Stephens" alone counts only as the text's own first word before "served as" / "acted
  // as", or as the whole text ("Opinion of Stephens"): "Satterlee Stephens" is a law firm, Mr. Stephens a person.
  b("Stephens", "STEP", /\bStephens,? Inc\b|\bSTEPHENS,? INC\b|^\s*Stephens(?=\s+(?:served|acted|is serving|is acting)\s+as\b)|^\s*Stephens\s*$/),
  // Its own row until the 2020 merger with Piper Jaffray: the two often sat across the table (OceanFirst / Sun Bancorp).
  b("Sandler O'Neill", "SOP", /\bSandler O\s?['’]\s?Neill\b/),
  b("FT Partners", "FTP", /\bFT Partners\b|\bFinancial Technology Partners\b/),
  b("Harris Williams", "HW", /\bHarris Williams\b/),
  // (November 2026 census: 5 releases, 5 deals; "Deloitte Corporate Finance in Australia served as financial advisor to Rhino-Rack".)
  b("Deloitte Corporate Finance", "DELO", /\bDeloitte Corporate Finance\b/),
  b("Lincoln International", "LINC", /\bLincoln International\b/),
  b("MTS Health Partners", "MTS", /\bMTS Health Partners\b|\bMTS Securities\b/),
  b("Boenning & Scattergood", "BOEN", /\bBoenning (?:&|and) Scattergood\b/),
  b("Intrepid Partners", "INTR", /\bIntrepid Partners\b/),
  b("Griffin Financial Group", "GRIF", /\bGriffin Financial Group\b/),
  b("Banks Street Partners", "BSP", /\bBanks Street Partners\b/),
  b("Foros", "FORO", /\bForos\b/),
  b("Blackstone Advisory Partners", "BXAP", /\bBlackstone Advisory\b/),
  b("FIG Partners", "FIG", /\bFIG Partners\b/),
  b("Raine", "RAIN", /\bRaine (?:Group|Securities)\b/),
  b("FinPro", "FINP", /\bFinPro\b/),
  b("Cassel Salpeter", "CASL", /\bCassel Salpeter\b/),
  b("The Kafafian Group", "KAF", /\bKafafian Group\b/),
  b("Petrie Partners", "PETR", /\bPetrie Partners\b/),
  b("ProBank Austin", "PBA", /\bProBank Austin\b/),
  b("Panoramic Capital Advisors", "PANO", /\bPanoramic Capital Advisors\b/),
  b("Sterne Agee", "SAG", /\bSterne,? Agee\b/),
  b("Ambassador Financial Group", "AMBF", /\bAmbassador Financial Group\b/),
  b("Imperial Capital", "IMPC", /\bImperial Capital\b(?!\s+(?:Bancorp|Bank|Trust|Asset))/),
  b("Robert A. Stanger", "STGR", /\bRobert A\. Stanger\b/),
  b("Kroll", "KRL", /\bKroll,? (?:LLC|Securities)\b|\bDuff (?:&|and) Phelps\b/),
  b("GCA", "GCA", /\bGCA (?:Advisors|Savvian|Altium)\b/),
  b("North Point Advisors", "NPA", /\bNorth Point Advisors\b/),
  b("Aquilo Partners", "AQLO", /\bAquilo Partners\b/),
  b("The Bank Street Group", "BSG", /\bBank Street Group\b/),
  b("Tungsten Advisors", "TUNG", /\bTungsten Advisors\b/),
  b("Berenson & Company", "BERN", /\bBerenson & Co(?:mpany|\.)/),
  b("Gordon Dyal", "DYAL", /\bGordon Dyal\b/),
  b("Global Hunter Securities", "GHS", /\bGlobal Hunter Securities\b/),
  b("Union Square Advisors", "USQ", /\bUnion Square Advisors\b/),
  b("EarlyBirdCapital", "EBC", /\bEarlyBird ?Capital\b/),
  b("Willis Capital Markets", "WCMA", /\bWillis Capital Markets\b/),
  b("C.K. Cooper", "CKC", /\bC\. ?K\. Cooper\b/),
  b("J. Wood Capital Advisors", "JWC", /\bJ\. Wood Capital\b/),
  b("AGC Partners", "AGC", /\bAmerica['’]s Growth Capital\b|\bAGC Partners\b/),
  b("Sagent Advisors", "SAGT", /\bSagent Advisors\b/),
  b("Hyde Park Capital", "HYDE", /\bHyde Park Capital\b/),
  b("Locust Walk", "LOCW", /\bLocust Walk\b(?! Acquisition)/),
  b("RP Financial", "RPF", /\bRP Financial\b/),
  b("CS Capital Advisors", "CSCA", /\bCS Capital Advisors\b/),
  b("Stone Key", "STKY", /\bStone Key (?:Partners|Group|Securities)\b/),
  b("Atlas Technology Group", "ATG", /\bAtlas Technology Group\b/),
  b("Haywood Securities", "HAYW", /\bHaywood Securities\b/),
  b("Greentech Capital Advisors", "GTCA", /\bGreentech Capital\b/),
  b("I-Bankers Securities", "IBS", /\bI-Bankers Securities\b/),
  b("Gleacher & Company", "GLCH", /\bGleacher (?:&|and) Co|\bBroadpoint[. ]Gleacher\b|\bGleacher Partners\b/),
  b("Morgan Joseph TriArtisan", "MJT", /\bMorgan Joseph\b/),
  b("Vestra Advisors", "VEST", /\bVestra Advisors\b/),
  b("Berkshire Global Advisors", "BGA", /\bBerkshire Global Advisors\b/),
  b("DH Capital", "DHC", /\bDH Capital\b/),
  b("Covington Associates", "COVA", /\bCovington Associates\b/),
  b("Johnson Rice", "JR", /\bJohnson Rice\b/),
  b("KippsDeSanto", "KDS", /\bKippsDeSanto\b/),
  b("Alantra", "ALNT", /\bAlantra\b/),
  b("XMS Capital", "XMS", /\bXMS Capital\b/),
  b("Methuselah Advisors", "METH", /\bMethuselah Advisors\b/),
  b("Financo", "FNCO", /\bFinanco\b/),
  b("LifeSci Capital", "LFSC", /\bLifeSci Capital\b/),
  b("Broadhaven Capital", "BRDH", /\bBroadhaven Capital\b/),
  b("Hillworth Bank Partners", "HWBP", /\bHillworth Bank Partners\b/),
  b("Wunderlich Securities", "WUND", /\bWunderlich Securities\b/),
  b("P&M Corporate Finance", "PMCF", /\bP&M Corporate Finance\b/),
  b("Pickering Energy Partners", "PEP", /\bPickering Energy Partners\b/),
  // Bare "DBO" only as the whole text, a heading's name ("Opinion of DBO": Xilinx), as "Stephens" above.
  b("DBO Partners", "DBO", /\bDBO Partners\b|^\s*DBO\s*$/),
  b("MJC Partners", "MJC", /\bMJC Partners\b/),
  b("Sheshunoff", "SHES", /\bSheshunoff (?:&|and) Co\b/),
  b("Cain Brothers", "CAIN", /\bCain Brothers\b/),
  b("Brown Gibbons Lang", "BGL", /\bBrown Gibbons Lang\b/),
  b("INFOR Financial", "INFR", /\bINFOR Financial\b/),
  b("Edge Corporate Finance", "EDGE", /\bEdge Corporate Finance\b|\bEdge Healthcare Partners\b/),
  b("Southwest Securities", "SWST", /\bSouthwest Securities\b/),
  b("Brean Capital", "BREA", /\bBrean (?:Capital|Murray)\b/),
  b("Torreya Partners", "TORR", /\bTorreya (?:Capital|Partners)\b/),
  b("Cedar Hill Advisors", "CEDR", /\bCedar Hill Advisors\b/),
  b("Monocacy Financial Advisors", "MONO", /\bMonocacy Financial Advisors\b/),
  b("Howe Barnes Hoefer & Arnett", "HBHA", /\bHowe Barnes\b/),
  b("Cohen & Company Capital Markets", "COHN", /\bCohen & Company Capital Markets\b|\bJ\.V\.B\. Financial Group\b/),
  b("Scott & Stringfellow", "SCST", /\bScott & Stringfellow\b/),
  b("Thomas Weisel Partners", "TWP", /\bThomas Weisel Partners\b/),
  b("Mesirow Financial", "MESI", /\bMesirow Financial\b/),
  b("Commerce Street Capital", "CSTC", /\bCommerce Street Capital\b/),
  b("Mooreland Partners", "MOOR", /\bMooreland Partners\b/),
  b("Barrington Research", "BARR", /\bBarrington Research\b/),
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

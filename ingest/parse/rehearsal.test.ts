/**
 * What a rehearsed rebuild found, checked against the filings (November 2026). Fixtures are synthetic, in each filing's
 * wording; the deal each comes from is in its name.
 */
import { describe, expect, it } from "vitest";
import { closingNames } from "../deals";
import { displayCompanyName, isPlaceholderBuyer } from "../../lib/names";
import { findBanks } from "../../lib/banks";
import { extractMergerPrice, parseMergerItem } from "./eightk";
import { isPlausibleName } from "./names";
import { extractAdvisors, extractConsideration, extractPrice, extractValue, isCashLeg, parsePressRelease } from "./press";
import { premiumCandidates } from "./proxy";

const ctx = { filerName: "Northwind Corp", filerTickers: [] };

describe("the price: not one leg of it", () => {
  it("a cash leg before a number of shares (Netflix / WBD)", () => {
    expect(isCashLeg("the right to receive (A) ", " in cash and (B) a number of shares of Parent common stock equal to the Exchange Ratio")).toBe(true);
    expect(isCashLeg("the right to receive ", " in cash, without interest, plus (ii) such number of validly issued, fully paid and non-assessable shares of Parent Common Stock")).toBe(true);
  });

  it("a cash leg before a stock leg stated in dollars (Triton)", () => {
    expect(extractPrice("Holders will receive $68.50 per Share in cash and $16.50 per Share in Class A exchangeable subordinate voting shares of BIPC.")).toBeNull();
  });

  it("a cash election stays whole (J. Alexander's)", () => {
    expect(isCashLeg("either ", ' in cash (the "Cash Election"), or a combination of $3.00 in cash and one Class A Share')).toBe(false);
  });

  it("an election's cash is the price, in US dollars only (Globalstar; Capital Power's Cdn$)", () => {
    expect(extractPrice("Globalstar holders are entitled to elect to receive, for each share, either $90.00 in cash or 0.3210 shares of Amazon common stock.")).toBe(90);
    expect(extractPrice("Holders may elect to receive Cdn$19.40 in cash or 0.5 shares of Capital Power.")).toBeNull();
  });

  it("a stated value outranks the election's (QXO / TopBuild)", () => {
    expect(extractPrice("Holders may elect to receive $505.00 in cash or 2.5 shares of QXO. The transaction values each TopBuild share at $505.")).toBe(505);
  });

  it("not a reference close with its date (Vonage), nor an amount paid on top by a manager (Southern Realty)", () => {
    expect(extractPrice("The price represents a premium over the closing price on November 19, 2021 of $16.37 per share.")).toBeNull();
    expect(extractPrice("Each holder will receive (i) 1.45 shares of SUNS and (ii) from the manager, as additional consideration, $0.05 per share in cash.")).toBeNull();
  });

  it("not the value put on the buyer's shares (Genco)", () => {
    expect(extractPrice("Genco holders will receive $23.50 in cash and 1.5 Diana Shares Valued at $2.54 Per Share, for a total of $27.34 per share.")).toBe(27.34);
    expect(extractPrice("each Genco share will be exchanged for one Diana share valued at $2.54.")).toBeNull();
  });

  it("a tender's price per share of (PHX)", () => {
    expect(extractMergerPrice("Purchaser will commence a tender offer at a price per share of $4.35, in cash, net to the holder, without interest.")).toBe(4.35);
    expect(extractMergerPrice("the option has an exercise price per share of $4.35.")).toBeNull();
  });
});

describe("the value: not what's beside it", () => {
  const item = (rest: string) =>
    parseMergerItem(`Item 1.01 Entry into a Material Definitive Agreement. On May 1, 2026, Northwind Corp (the "Company") entered into an Agreement and Plan of Merger with Bluejay Parent, Inc. ("Parent") and Bluejay Merger Sub, Inc. ("Merger Sub"), pursuant to which Merger Sub will merge with and into the Company. ${rest}`, ctx);

  it("an Item 1.01's other agreements and financing (Switch, Rallybio, Hecla, Turnstone)", () => {
    expect(item("Concurrently, the Company entered into a Land Purchase Agreement for a purchase price of $300 million.")?.valueUsd).toBeNull();
    expect(item("In connection with the Concurrent Financing, investors will purchase shares with a total value of $505.5 million.")?.valueUsd).toBeNull();
    expect(item("Hecla will issue stock valued at $135 million to end the silver stream on the mine.")?.valueUsd).toBeNull();
    expect(item("Under the Asset Sale, the Company will receive a purchase price of $3 million.")?.valueUsd).toBeNull();
  });

  it("but not an implied value before giving effect to a placement (Ambros)", () => {
    expect(item("The merger implies a total value of $500 million, before giving effect to the private placement.")?.valueUsd).toBe(500_000_000);
  });

  it("an adjusted enterprise value, which counts leases (JetBlue / Spirit)", () => {
    expect(extractValue("JetBlue will acquire Spirit for an equity value of $3.8 billion and an adjusted enterprise value of $7.6 billion.")).toEqual({ usd: 3_800_000_000, kind: "equity" });
  });

  it("takes a stated contingent part off a total (ZT Systems, Novitium); without a figure there's nothing to take off", () => {
    expect(extractValue("a transaction valued at $4.9 billion, inclusive of a contingent payment of up to $400 million")).toEqual({ usd: 4_500_000_000, kind: "transaction" });
    expect(extractValue("a transaction valued at $14.5 million, including earnouts")).toBeNull();
  });

  it("reads across 'excluding' no contingent part (Resolute)", () => {
    expect(extractValue("a transaction value of $2.7 billion, excluding the Contingent Value Right")?.usd).toBe(2_700_000_000);
  });

  it("a cap on one leg (Harte Hanks)", () => {
    expect(extractValue("Cash elections are subject to a cap equal to 50% of the total transaction consideration, or approximately $19.2 million.")).toBeNull();
  });

  it("what's paid at closing under a ceiling, in the words releases use (Brigit, Purigen, Payix, Claros)", () => {
    expect(extractValue("to acquire Brigit for up to $460 million, comprised of $325 million payable at closing, $75 million deferred and an earnout")?.usd).toBe(325_000_000);
    expect(extractValue("to acquire Claros for up to approximately $232.8 million, with approximately $216.0 million to be paid at closing")?.usd).toBe(216_000_000);
    expect(extractValue("Surface will acquire it for up to $65 million, with $25 million of net cash at closing")).toBeNull();
  });

  it("a ceiling written on the per-share right (Chinook) and what's paid per share in total", () => {
    expect(extractValue("$40.00 per share in cash, or a total of $3.2 billion, and a CVR of up to $4.00 per share, for a total deal value of about $3.5 billion")?.usd).toBe(3_200_000_000);
    expect(extractValue("$18 per share in cash, or a total cash consideration of $125.1 million, plus a contingent value right")?.usd).toBe(125_100_000);
    expect(extractValue("a cash dividend of $0.30 per common share or $10.7 million")).toBeNull();
  });

  it("not another upfront payment in the release (Organon's divestiture, Assertio's sale of products)", () => {
    expect(extractValue("Organon recently closed on a divestiture for which it received an upfront payment of $440 million.")).toBeNull();
    expect(extractValue("to Cosette for an up-front payment of $35 million plus earnouts")).toBeNull();
  });

  it("an enterprise valuation, but not one a stake implies (Organon; CBRE / Industrious)", () => {
    expect(extractValue("for US$14.00 per share in an all-cash transaction with an enterprise valuation of US$ 11.75 billion")).toEqual({ usd: 11_750_000_000, kind: "enterprise" });
    expect(extractValue("CBRE will acquire the remaining equity stake for approximately $400 million, reflecting an implied enterprise valuation of approximately $800 million")).toEqual({ usd: 400_000_000, kind: "transaction" });
  });

  it("both legs in dollars make the price; one with a count of shares makes none (Bluejay; Greenscreens.ai)", () => {
    expect(extractValue("Mirum has agreed to acquire all outstanding shares of Bluejay for $250 million in cash and $370 million in Mirum common stock")?.usd).toBe(620_000_000);
    expect(extractValue("Triumph acquired Greenscreens.ai for $140 million in cash and 256,984 shares of TFIN common stock")).toBeNull();
  });

  it("a headline's transaction value the text gives as enterprise value (IEC)", () => {
    expect(extractValue("Transaction Valued at Approximately $167 Million. The merger represents an enterprise value of approximately $167 million.")).toEqual({ usd: 167_000_000, kind: "enterprise" });
  });

  it("a dotted name in the lead (Stamps.com), and a closing market price is no market (Fusion)", () => {
    expect(extractValue("the agreement values Stamps.com at approximately $6.6 billion")?.usd).toBe(6_600_000_000);
    expect(extractValue("values the company at approximately $2.0 billion, based on the closing market price of the shares")?.usd).toBe(2_000_000_000);
  });

  it("priced at, and a completed acquisition's price (Lanteris)", () => {
    expect(extractValue("The acquisition is priced at $800 million, being $450 million in cash and $350 million in stock.")?.usd).toBe(800_000_000);
    expect(extractValue("The acquisition, announced in November, was completed for $800 million.")?.usd).toBe(800_000_000);
  });
});

describe("cash, stock or mixed", () => {
  it("a target's own spin-off beside the cash is still cash (Biohaven), a real share of the merged company isn't (Green Dot)", () => {
    expect(extractConsideration("Pfizer will acquire Biohaven for $148.50 per share in cash. Biohaven shareholders will also receive 0.5 of a share of New Biohaven, a new publicly traded company that will retain its pipeline.")).toBe("Cash");
    expect(extractConsideration("Each share of Green Dot will be exchanged for $8.11 in cash and 0.2215 shares of the new publicly traded bank holding company that will own CommerceOne's existing business.")).toBe("Mixed");
  });

  it("an inc. doesn't end a holders' sentence (Bluerock's spin-off, American Equity's ratio)", () => {
    expect(extractConsideration("Each AEL shareholder will receive $55.00 per AEL share, consisting of $38.85 in cash and 0.49707 of a Brookfield Asset Management Ltd. class A limited voting share.")).toBe("Mixed");
  });

  it("the stock leg in dollars (Triton, NV5)", () => {
    expect(extractConsideration("Each holder will receive $10.00 in cash and $13.00 in shares of Acuren common stock.")).toBe("Mixed");
  });

  it("a holders' sentence that says all-stock means it (Tourmaline)", () => {
    expect(extractConsideration("Tourmaline will combine with Talaris in an all-stock transaction, with holders to receive shares; the combined company expects to have about $210 million of cash. Talaris holders will participate in a cash dividend.")).toBe("Stock");
  });

  it("a split in percentages, and cash stated as the price (Lemonaid, private purchases)", () => {
    expect(extractConsideration("the purchase price is $400 million, of which 25% will be paid in cash and 75% in shares of 23andMe Class A Common Stock")).toBe("Mixed");
    expect(extractConsideration("TransDigm has agreed to acquire Stellant for $960 million in cash.")).toBe("Cash");
    expect(extractConsideration("Mirum agreed to acquire all outstanding shares of Bluejay for $250 million in cash and $370 million in Mirum common stock.")).toBe("Mixed");
  });

  it("shares the bidder already owns aren't consideration (Decibel, Tribune)", () => {
    expect(extractConsideration("Regeneron will pay $4.00 per share in cash. Its affiliates owned 2,097,314 shares of Decibel common stock.")).toBe("Cash");
  });

  it("a funding clause between the legs (RE2), and the next sentence's leg (Sonoma-Cutrer)", () => {
    expect(extractConsideration("The consideration consists of $30 million of cash, which Sarcos expects to fund with cash on hand, and $70 million of Sarcos common stock.")).toBe("Mixed");
    expect(extractConsideration("Brown-Forman will receive 31.5 million shares of Duckhorn common stock. Brown-Forman will also receive cash consideration of approximately $50 million.")).toBe("Mixed");
  });
});

describe("the premium, from a proxy", () => {
  const top = (s: string) => premiumCandidates(s).sort((a, b) => b.score - a.score)[0]?.pct;

  it("an implied premium (TXNM), and a later item of a list (Cvent)", () => {
    expect(top("The merger consideration represents a 22.3% implied premium to the unaffected closing price of the shares on May 16, 2025.")).toBe(22.3);
    expect(top("The merger consideration represents a premium of approximately (a) 52% to the VWAP for the prior 90 days and (b) 15% to the closing share price on March 13.")).toBe(15);
  });

  it("not a banker's premium on a value that counts a contingent right (Avadel)", () => {
    expect(premiumCandidates("The Scheme Consideration NPV of $21.00 represented a premium of 23% to the closing price on the last trading day before the announcement.").length).toBe(0);
  });
});

describe("who advised whom", () => {
  const adv = (t: string, acq: string, tgt: string, issuer: "acquirer" | "target" | null = "target") => extractAdvisors(t, acq, tgt, issuer, null);

  it("financial and legal advisors, respectively (Duke Realty)", () => {
    expect(adv("Morgan Stanley and Hogan Lovells are serving as financial and legal advisors, respectively, to Duke Realty.", "Prologis, Inc.", "Duke Realty Corp").targetAdvisors).toEqual(["Morgan Stanley"]);
  });

  it("a list running on with no recipient of its own (Olink)", () => {
    const r = adv("For Olink, J.P. Morgan is serving as lead financial advisor, Goldman Sachs is serving as financial advisor and Baker McKenzie is serving as legal counsel.", "Thermo Fisher Scientific Inc.", "Olink Holding AB");
    expect(r.targetAdvisors.sort()).toEqual(["Goldman Sachs", "JPMorgan"]);
  });

  it("'its' is the party the sentence is about, and a possessive names the real buyer behind a vehicle (Horizon)", () => {
    const r = adv("Amgen's lead financial advisor for the transaction is PJT Partners and its financial advisor is Citigroup.", "Acquirer Sub", "Horizon Therapeutics plc");
    expect(r.acquirerAdvisors.sort()).toEqual(["Citigroup", "PJT Partners"]);
    expect(r.targetAdvisors).toEqual([]);
    expect(adv("the Company and its financial advisor, BofA Securities, have reviewed the offer", "Northwind Corp", "Bluebird Inc").targetAdvisors).toEqual(["BofA Securities"]);
  });

  it("the committee a release defines (Vital), else the target's (Zuora)", () => {
    expect(adv('A special committee of the board of Crescent Energy (the "Special Committee") oversaw it. Jefferies is serving as financial advisor to the Special Committee.', "Crescent Energy", "Vital Energy").acquirerAdvisors).toEqual(["Jefferies"]);
    expect(adv("Qatalyst is serving as financial advisor to the Special Committee.", "Silver Lake", "Zuora").targetAdvisors).toEqual(["Qatalyst"]);
  });

  it("the Company a buyer's own document defines (Smucker), not a merger agreement's (Roku)", () => {
    expect(adv('The J. M. Smucker Company (the "Company") announced the merger. RBC is acting as financial advisor to the Company.', "J M Smucker Co", "Hostess Brands, Inc.").acquirerAdvisors).toEqual(["RBC Capital Markets"]);
    expect(adv('FOX Corporation (the "Company") filed this. Bluebird Merger Sub ("Parent") … Qatalyst Partners is acting as financial advisor to the Company.', "FOX Corporation", "Roku, Inc.").targetAdvisors).toEqual(["Qatalyst"]);
  });

  it("not another mandate (Athene), and a recipient with a dot (Divvy)", () => {
    expect(adv("Perella Weinberg acted as financial advisor to the Conflicts Committee in connection with Apollo's corporate governance updates.", "Apollo Global Management", "Athene Holding").acquirerAdvisors).toEqual([]);
    expect(adv("Goldman Sachs is serving as financial advisor to Bill.com and Fenwick is serving as legal counsel.", "Bill.com", "Divvy").acquirerAdvisors).toEqual(["Goldman Sachs"]);
  });

  it("SMBC AC, a buyer of Air Lease, isn't SMBC Nikko", () => {
    expect(findBanks("SMBC AC and Apollo")).toEqual([]);
    expect(findBanks("SMBC Nikko Securities")).toEqual(["SMBC Nikko"]);
  });
});

describe("names that aren't buyers", () => {
  it("a sentence opener (U.S. Well Services' 'In addition')", () => {
    expect(isPlausibleName("In addition")).toBe(false);
    expect(isPlausibleName("Moreover")).toBe(false);
    expect(isPlausibleName("Additive Industries")).toBe(true);
  });

  it("the end of a word (restor3d read as 3d), and a vote solicitation is no new deal", () => {
    const p = parsePressRelease('ISS Recommends Conformis Stockholders Vote "FOR" the Pending Merger with restor3d\nGRAPEVINE, Texas, Aug. 21, 2023 - Conformis, Inc. (NASDAQ: CFMS) today announced that restor3d will acquire all outstanding shares of Conformis.', { filerName: "Conformis, Inc.", filerTickers: ["CFMS"] });
    expect(p?.acquirer.name ?? "").not.toBe("3d");
    if (p) expect(p.kind).toBe("update");
  });

  it("a named part of a company stays a deal, marked, so it tops nobody (IAC / Meredith, beside Gray)", () => {
    const p = parsePressRelease("IAC's Dotdash to Acquire Meredith Corporation's National Media Group\nNEW YORK, Oct. 7, 2021 - IAC announced that Dotdash will acquire the National Media Group of Meredith Corporation for $42.18 per share.", { filerName: "Meredith Corp", filerTickers: ["MDP"] });
    expect(p?.partOfTarget).toBe(true);
    expect(p?.pricePerShare).toBe(42.18);
  });

  it("one-word merger subs are vehicles", () => {
    expect(isPlaceholderBuyer("EH MergerSub Inc.")).toBe(true);
  });

  it("Hg stays Hg, HG Holdings and acronyms as they were", () => {
    expect(displayCompanyName("Hg")).toBe("Hg");
    expect(displayCompanyName("Txnm Energy")).toBe("TXNM Energy");
  });
});

describe("a target listed abroad", () => {
  const release = (body: string, name = "Northwind Energy Inc.") => parsePressRelease(body, { filerName: name, filerTickers: [] });

  it("in any case of its name, with words before the listing (exactEarth, HighGold, DS Smith)", () => {
    expect(release("Northwind to Acquire ExactEarth\nVIENNA, Va., Nov. 30, 2021 - Northwind Energy Inc. (NYSE: NWE) today announced a definitive agreement to acquire EXACTEARTH Ltd. (TSX: XCT) for about $161 million.")?.targetListedAbroad).toBe(true);
    expect(release('Northwind to Acquire HighGold\nJuly 10, 2024 - Northwind Energy Inc. (NYSE: NWE) today announced a definitive agreement to acquire HighGold Mining Inc. ("HighGold") (TSX-V: HIGH, OTCQX: HGMIF).')?.targetListedAbroad).toBe(true);
    expect(release('Northwind to Acquire DS Smith\nApril 16, 2024 - Northwind Energy Inc. (NYSE: NWE) today announced a definitive agreement to acquire DS Smith Plc (LSE: SMDS) for about $7 billion.')?.targetListedAbroad).toBe(true);
  });

  it("not its seller's listing (Main Event)", () => {
    expect(release("Northwind to Acquire Main Event\nJune 29, 2022 - Northwind Energy Inc. (NYSE: NWE) today announced a definitive agreement to acquire Main Event from Ardent Leisure Group (ASX: ALG) for about $835 million.")?.targetListedAbroad).toBeFalsy();
  });
});

describe("the 8-K that closes a private purchase", () => {
  const named = /\bXTI\b/i;

  it("names it in Item 2.01 or the Introductory Note, or in a past-tense sentence of Item 1.01", () => {
    expect(closingNames("Item 2.01 Completion of Acquisition. The Company completed the merger with XTI. Item 9.01 Exhibits.", named)).toBe(true);
    expect(closingNames("Introductory Note. On March 12, the Company completed its merger with XTI. Item 2.01 Completion of Acquisition. See the Introductory Note.", named)).toBe(true);
    expect(closingNames("Item 1.01 Entry into an Agreement. The merger with XTI was consummated today. Item 2.01 Completion of Acquisition. The information in Item 1.01 is incorporated.", named)).toBe(true);
  });

  it("not another deal's report that mentions it (Inpixon's spin-off of Grafiti)", () => {
    expect(closingNames("Item 1.01 Entry into an Agreement. The spin-off is a condition of the merger with XTI. Item 2.01 Completion of Acquisition. The Company completed the separation of Grafiti Holding. Item 9.01 Exhibits.", named)).toBe(false);
  });

  it("anywhere when the document has no such headings", () => {
    expect(closingNames("Northwind completed its purchase of XTI.", named)).toBe(true);
  });
});

describe("what the second review of the rehearsal found", () => {
  it("not what a tax benefit is worth (Lowe's / FBM, Valco), nor another deal's carrying value (NJOY)", () => {
    expect(extractValue("Graco will acquire Valco Melton for $447 million in cash, including the present value of approximately $40 million in expected tax benefits")?.usd).toBe(447_000_000);
    expect(extractValue("The carrying value of $250 million relates to its earlier stake.")).toBeNull();
    expect(extractValue("valued at a net present value (NPV) of approximately $805 million")?.usd).toBe(805_000_000);
  });

  it("one leg isn't the deal, and a total named beside it is (SpotX, Jet.com)", () => {
    expect(extractValue("Magnite will pay total consideration of $560 million in cash and 14 million shares of Magnite stock, for a total of $1.17 billion.")?.usd).toBe(1_170_000_000);
    expect(extractValue("Walmart will acquire Jet.com for $3 billion in cash, a portion of which will be paid over time, and $300 million of Walmart shares.")?.usd).toBe(3_300_000_000);
    expect(extractValue("upfront consideration of $18 million in cash and $9 million in AIRJ common stock")?.usd).toBe(27_000_000);
  });

  it("not a rate's revolver, a first instalment, or a financing (GTT, eTouch, Iasta)", () => {
    expect(extractValue("The term loan is priced at LIBOR + 525bps, as well as a five-year $50 million revolving line of credit.")).toBeNull();
    expect(extractValue("The purchase price will be paid in three tranches with $80.0 million paid at closing.")).toBeNull();
    expect(extractValue("As part of enabling the acquisition, a private placement transaction for approximately $7.5 million was announced.")).toBeNull();
  });

  it("keeps a stated total with its shares nearby (Masonite / PGT)", () => {
    expect(extractValue("The transaction has a total transaction value of $3.0 billion, including debt.")?.usd).toBe(3_000_000_000);
  });

  it("per-share totals say what they are (Redfin's equity value, Meredith's enterprise value)", () => {
    expect(extractValue("Each share is worth $12.50 per share, or $1.75 billion of equity value.")).toEqual({ usd: 1_750_000_000, kind: "equity" });
    expect(extractValue("$14.50 per share in cash, or $2.7 billion in total enterprise value")).toEqual({ usd: 2_700_000_000, kind: "enterprise" });
  });

  it("a value per the target's share in the buyer's stock is the price (Gibraltar), and a stated per-share consideration (VMware)", () => {
    expect(extractPrice("Each Gibraltar share converts into IBKC shares valued at approximately $158.29 per Gibraltar common share.")).toBe(158.29);
    expect(extractPrice("The total $138.23 per-share consideration represents a 44% premium.")).toBe(138.23);
  });

  it("not a listing rule's bid price, nor what a PIPE or a collar pays (Signal Genetics, Viridian, Boeing / Spirit)", () => {
    expect(extractPrice("The company must maintain a minimum bid price of $1.00 per share.")).toBeNull();
    expect(extractPrice("Investors in the PIPE will buy preferred stock at a price of $465.96 per share.")).toBeNull();
    expect(extractPrice("subject to a floor of $149.00 per share and a ceiling of $206.94 per share")).toBeNull();
  });

  it("cash stated as the price, but only its own sentence can confirm it (Caviar, Nexstar)", () => {
    expect(extractConsideration("DoorDash will acquire Caviar for $410 million in cash and DoorDash preferred stock.")).toBe("Mixed");
    expect(extractConsideration("Nexstar agreed to sell five stations for $115 million in cash.")).toBeNull();
    expect(extractConsideration("TransDigm has agreed to acquire Stellant for $960 million in cash, plus a potential earn-out.")).toBe("Cash");
  });

  it("an 8-K's price is not a cash leg it can't place (Reader's after-leg), and its side matters don't take the real value (Colfax / Victor)", () => {
    const item = (rest: string) =>
      parseMergerItem(`Item 1.01 Entry into a Material Definitive Agreement. On May 1, 2026, Northwind Corp (the "Company") entered into an Agreement and Plan of Merger with Bluejay Parent, Inc. ("Parent") and Bluejay Merger Sub, Inc. ("Merger Sub"), pursuant to which Merger Sub will merge with and into the Company. ${rest}`, ctx);
    expect(item("The transaction has an enterprise value of approximately $947.3 million, and holders of the preferred stock will be paid separately.")?.valueUsd).toBe(947_300_000);
  });

  it("KKR buying the shell that will hold one business is no takeover of Macquarie", () => {
    expect(
      parseMergerItem(
        'Item 1.01 Entry into a Material Definitive Agreement. On June 7, 2021, Macquarie Infrastructure Corp (the "Company") entered into an Agreement with Bluejay LLC ("Buyer"), an affiliate of KKR. Buyer will acquire all outstanding shares of common stock of the Company which, following the proposed reorganization, will hold the Company\u0027s Atlantic Aviation business.',
        { filerName: "Macquarie Infrastructure Corp", filerTickers: [] },
      ),
    ).toBeNull();
  });

  it("the proxy: a premium 'of' a closing price (eMagin), but not over a VWAP or on a bid with its rights (Two Harbors, 89bio)", () => {
    const top = (s: string) => premiumCandidates(s).sort((a, b) => b.score - a.score)[0]?.pct;
    expect(top("The merger consideration represents a premium of approximately 10% of the closing share price on the last trading day before the announcement.")).toBe(10);
    expect(top("The merger consideration represents a premium of approximately 21% to the 30-day volume-weighted average price of the shares.")).toBeUndefined();
  });

  it("a closing 8-K's mention of Item 2.01 before its heading, and an Introduction naming the merger (Dril-Quip)", () => {
    const named = /\bInnovex\b/;
    expect(closingNames("Introduction. On September 6, the merger with Innovex was completed. Item 2.01 Completion of Acquisition. See above. Item 9.01 Exhibits.", named)).toBe(true);
    expect(closingNames("Item 1.01. See Item 2.01 below. The merger with Innovex is a condition. Item 2.01 Completion of Acquisition. The Company completed the separation of Grafiti. Item 9.01 Exhibits.", named)).toBe(false);
  });
});

describe("a raised offer's words", () => {
  const ctx2 = { filerName: "Pluralsight, Inc.", filerTickers: ["PS"] };

  it("a release amending its agreement to increase the price (Pluralsight)", () => {
    const p = parsePressRelease("Pluralsight and Vista Equity Partners Amend Definitive Agreement to Increase Offer Price to $22.50 Per Share in Cash\nFARMINGTON, Utah, March 8, 2021 - Pluralsight, Inc. (NASDAQ: PS) and Vista Equity Partners today announced a revised definitive agreement under which Vista will acquire all outstanding shares of Pluralsight for $22.50 in cash.", ctx2);
    expect(p?.amended).toBe(true);
    expect(p?.pricePerShare).toBe(22.5);
  });

  it("an 8-K restating its merger agreement (Squarespace), and not an ordinary signing", () => {
    const item = (agreement: string) =>
      parseMergerItem(`Item 1.01 Entry into a Material Definitive Agreement. On September 9, 2024, Bluebird, Inc. (the "Company") entered into an ${agreement} with Bluejay Purchaser, Inc. ("Parent") and Bluejay MergerCo, Inc. ("Merger Sub"), pursuant to which Merger Sub will merge with and into the Company. Each share will be converted into the right to receive $46.50 in cash.`, { filerName: "Bluebird, Inc.", filerTickers: [] });
    expect(item("Amended and Restated Agreement and Plan of Merger")?.amended).toBe(true);
    expect(item("Agreement and Plan of Merger")?.amended).toBeUndefined();
  });
});

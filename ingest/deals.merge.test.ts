/**
 * How documents about one target join into deals (applyParsed), then tidy. RR Donnelley: Atlas signed on November 3 2021,
 * Chatham topped it on December 14 through a shell ("Chatham Delta Parent, Inc."), and Chatham closed in February.
 */
import { describe, expect, it } from "vitest";
import { applyParsed } from "./deals";
import type { FtsHit } from "./edgar";
import type { ParsedPress } from "./parse/press";
import type { State } from "./store";
import { tidyDeals } from "./tidy";

const RRD = "29669";
const target = { cik: RRD, ticker: "RRD", listedInUs: true };
const unlisted = { cik: null, ticker: null, listedInUs: false };

const emptyState = (): State => ({ deals: [], ipos: [], seen: new Set(), asOf: null, macro: null, activists: [] });

const hit = (fileDate: string, adsh: string): FtsHit => ({
  id: `${adsh}:doc.htm`,
  adsh,
  file: "doc.htm",
  form: "8-K",
  rootForm: "8-K",
  fileType: "8-K",
  fileDate,
  ciks: [RRD],
  displayNames: ["R. R. Donnelley & Sons Co (RRD) (CIK 0000029669)"],
  sics: ["2750"],
  items: [],
});

const parsed = (kind: ParsedPress["kind"], buyer: string, over: Partial<ParsedPress> = {}): ParsedPress => ({
  kind,
  headline: `${buyer} to acquire R. R. Donnelley & Sons Company`,
  acquirer: { name: buyer, ticker: null, exchange: null },
  target: { name: "R. R. Donnelley & Sons Company", ticker: null, exchange: null },
  pricePerShare: null,
  premiumPct: null,
  valueUsd: null,
  valueKind: null,
  consideration: "Cash",
  acquirerAdvisors: [],
  targetAdvisors: [],
  ...over,
});

const shell = "Chatham Delta Parent, Inc.";

function withAtlas() {
  const state = emptyState();
  applyParsed(state, parsed("announcement", "Atlas Holdings LLC", { pricePerShare: 8.52 }), hit("2021-11-03", "0001-21-1"), target, unlisted, false);
  return state;
}

describe("a topping bid signed through a shell", () => {
  it("is its own deal when its 8-K reports the earlier agreement ended", () => {
    const state = withAtlas();
    applyParsed(state, parsed("announcement", shell, { pricePerShare: 10.85, announcedOn: "2021-12-14", endsEarlierAgreement: true }), hit("2021-12-15", "0001-21-2"), target, unlisted, false);
    expect(state.deals.map((d) => [d.acquirer.name, d.pricePerShare])).toEqual([
      ["Atlas Holdings LLC", 8.52],
      [shell, 10.85],
    ]);
  });

  it("takes the sponsor's name from the closing release, and the earlier agreement reads Terminated", () => {
    const state = withAtlas();
    applyParsed(state, parsed("announcement", shell, { pricePerShare: 10.85, announcedOn: "2021-12-14", endsEarlierAgreement: true }), hit("2021-12-15", "0001-21-2"), target, unlisted, false);
    applyParsed(state, parsed("completion", "Chatham Asset Management"), hit("2022-02-25", "0001-22-3"), target, unlisted, false);
    tidyDeals(state.deals);
    const by = (name: string) => state.deals.find((d) => d.acquirer.name === name);
    expect(by("Atlas Holdings LLC")).toMatchObject({ status: "Terminated", statusDate: "2021-12-14", pricePerShare: 8.52 });
    expect(by("Chatham Asset Management")).toMatchObject({ status: "Closed", statusDate: "2022-02-25", pricePerShare: 10.85, announcedDate: "2021-12-14" });
  });

  it("joins the release of the same signing, read first, instead of making a second record", () => {
    const state = withAtlas();
    applyParsed(state, parsed("announcement", "Chatham Asset Management", { pricePerShare: 10.85 }), hit("2021-12-14", "0001-21-2"), target, unlisted, false);
    applyParsed(state, parsed("announcement", shell, { pricePerShare: 10.85, announcedOn: "2021-12-14", endsEarlierAgreement: true }), hit("2021-12-15", "0001-21-3"), target, unlisted, false);
    expect(state.deals.map((d) => d.acquirer.name)).toEqual(["Atlas Holdings LLC", "Chatham Asset Management"]);
  });

  it("doesn't fold into a rival signed days before, even inside the usual fortnight", () => {
    const state = withAtlas();
    applyParsed(state, parsed("announcement", shell, { announcedOn: "2021-11-12", endsEarlierAgreement: true }), hit("2021-11-12", "0001-21-2"), target, unlisted, false);
    expect(state.deals).toHaveLength(2);
  });

  it("joins the same buyer's record when it re-signs (Bluegreen and BFC's 2012 agreement)", () => {
    const state = withAtlas();
    applyParsed(state, parsed("announcement", "Atlas Holdings LLC", { announcedOn: "2022-01-10", endsEarlierAgreement: true }), hit("2022-01-11", "0001-22-2"), target, unlisted, false);
    expect(state.deals).toHaveLength(1);
  });
});

describe("a results report that mentions a deal (Veoneer's Q3 report: \"SSW and Qualcomm\", and Magna's $31.25)", () => {
  const report = parsed("announcement", "SSW and Qualcomm", { pricePerShare: 31.25, valueUsd: 4_500_000_000, valueKind: "equity", premiumPct: 85.6, resultsReport: true });

  it("makes no new deal beside two open ones", () => {
    const state = withAtlas();
    applyParsed(state, parsed("announcement", "Qualcomm Inc", { pricePerShare: 37, announcedOn: "2021-12-14", endsEarlierAgreement: true }), hit("2021-12-15", "0001-21-2"), target, unlisted, false);
    expect(applyParsed(state, report, hit("2022-01-10", "0001-22-3"), target, unlisted, false)).toBeNull();
    expect(state.deals.map((d) => [d.acquirer.name, d.pricePerShare])).toEqual([
      ["Atlas Holdings LLC", 8.52],
      ["Qualcomm Inc", 37],
    ]);
  });

  it("joins a sole open deal with its link only, none of its amounts", () => {
    const state = emptyState();
    applyParsed(state, parsed("announcement", "Atlas Holdings LLC", { consideration: null }), hit("2021-11-03", "0001-21-1"), target, unlisted, false);
    const deal = applyParsed(state, report, hit("2021-12-20", "0001-21-2"), target, unlisted, false);
    expect(deal).toMatchObject({ acquirer: { name: "Atlas Holdings LLC" }, pricePerShare: null, valueUsd: null, premiumPct: null, consideration: null });
    expect(deal?.sources).toHaveLength(2);
  });

  it("can still announce a deal when none is open", () => {
    const state = emptyState();
    const deal = applyParsed(state, parsed("announcement", "IBM", { pricePerShare: 35, resultsReport: true }), hit("2024-04-24", "0001-24-1"), target, unlisted, false);
    expect(deal).toMatchObject({ acquirer: { name: "IBM" }, pricePerShare: 35, status: "Announced" });
  });
});

describe("the announced date of a deal an Item 1.01 dates", () => {
  const item = (over: Partial<ParsedPress>) => parsed("announcement", "Atlas Holdings LLC", { item101: true, ...over });
  const dated = (over: Partial<ParsedPress>, filed: string) => applyParsed(emptyState(), item(over), hit(filed, "0001-26-1"), target, unlisted, false)?.announcedDate;

  it("is the filing, when it came the next business day: the signing usually comes before the release", () => {
    expect(dated({ signedOn: "2023-10-10" }, "2023-10-11")).toBe("2023-10-11"); // Tuesday, Wednesday
    expect(dated({ signedOn: "2025-09-28" }, "2025-09-29")).toBe("2025-09-29"); // Sunday, Monday
    expect(dated({ signedOn: "2025-01-10" }, "2025-01-13")).toBe("2025-01-13"); // Friday, Monday
  });

  it("is the signing when the 8-K came later, off a weekend", () => {
    expect(dated({ signedOn: "2026-02-03" }, "2026-02-06")).toBe("2026-02-03"); // Santander / Webster: Tuesday, Friday
    expect(dated({ signedOn: "2026-02-07" }, "2026-02-12")).toBe("2026-02-09"); // Saturday, Thursday: the Monday
  });

  it("is the release the 8-K states, over either", () => {
    expect(dated({ signedOn: "2021-04-11", announcedOn: "2021-04-12" }, "2021-04-16")).toBe("2021-04-12");
    expect(dated({ signedOn: "2021-04-11", announcedOn: "2021-04-16" }, "2021-04-16")).toBe("2021-04-16");
  });

  it("doesn't move back from a date a release gave", () => {
    const state = emptyState();
    applyParsed(state, parsed("announcement", "Atlas Holdings LLC", { pricePerShare: 10 }), hit("2026-03-09", "0001-26-1"), target, unlisted, false); // Monday's release
    applyParsed(state, item({ signedOn: "2026-03-06" }), hit("2026-03-11", "0001-26-2"), target, unlisted, false); // Friday's signing, in Wednesday's 8-K
    expect(state.deals[0].announcedDate).toBe("2026-03-09");
  });

  it("gives way to a release's date, later or earlier", () => {
    const later = emptyState();
    applyParsed(later, item({ signedOn: "2026-03-02" }), hit("2026-03-05", "0001-26-1"), target, unlisted, false); // Monday, read first
    expect(later.deals[0]).toMatchObject({ announcedDate: "2026-03-02", dateIsSigning: true });
    applyParsed(later, parsed("announcement", "Atlas Holdings LLC", { announcedOn: "2026-03-03" }), hit("2026-03-05", "0001-26-2"), target, unlisted, false);
    expect(later.deals[0].announcedDate).toBe("2026-03-03");
    expect(later.deals[0].dateIsSigning).toBeUndefined();
    const earlier = emptyState();
    applyParsed(earlier, item({ signedOn: "2026-03-02" }), hit("2026-03-05", "0001-26-1"), target, unlisted, false);
    applyParsed(earlier, parsed("announcement", "Atlas Holdings LLC", { announcedOn: "2026-02-27" }), hit("2026-03-05", "0001-26-2"), target, unlisted, false);
    expect(earlier.deals[0].announcedDate).toBe("2026-02-27");
  });

  it("isn't moved by an investor deck's dateline weeks on", () => {
    const state = emptyState();
    applyParsed(state, item({ signedOn: "2026-03-02" }), hit("2026-03-05", "0001-26-1"), target, unlisted, false);
    applyParsed(state, parsed("announcement", "Atlas Holdings LLC", { announcedOn: "2026-03-20" }), hit("2026-03-20", "0001-26-2"), target, unlisted, false);
    expect(state.deals[0].announcedDate).toBe("2026-03-02");
  });

  it("makes no second deal from an amendment filed months after its signing (Emeren)", () => {
    const state = withAtlas();
    applyParsed(state, parsed("announcement", "Rival Vitra Ltd.", { item101: true, signedOn: "2021-11-03" }), hit("2022-03-03", "0001-22-2"), target, unlisted, false);
    expect(state.deals.map((d) => d.acquirer.name)).toEqual(["Atlas Holdings LLC"]);
  });
});

describe("which document's terms stand", () => {
  const release = (price: number, over: Partial<ParsedPress> = {}) => parsed("announcement", "Atlas Holdings LLC", { pricePerShare: price, ...over });
  const item = (price: number | null, over: Partial<ParsedPress> = {}) => parsed("announcement", "Atlas Holdings LLC", { pricePerShare: price, item101: true, ...over });

  it("an Item 1.01 stating an earlier signing doesn't replace the release's total with its cash leg (Triton $85, not $68.50)", () => {
    const state = emptyState();
    applyParsed(state, release(85, { consideration: "Mixed" }), hit("2023-04-12", "0001-23-1"), target, unlisted, false);
    applyParsed(state, item(68.5, { consideration: "Cash", signedOn: "2023-04-07" }), hit("2023-04-14", "0001-23-2"), target, unlisted, false);
    expect(state.deals[0]).toMatchObject({ pricePerShare: 85, consideration: "Mixed", announcedDate: "2023-04-12" });
  });

  it("an Item 1.01 really filed before the deal's first document still replaces it (Denbury, read by the backstop)", () => {
    const state = emptyState();
    applyParsed(state, item(90, { signedOn: "2023-07-31" }), hit("2023-07-31", "0001-23-2"), target, unlisted, false);
    applyParsed(state, item(89, { signedOn: "2023-07-14" }), hit("2023-07-14", "0001-23-1"), target, unlisted, false);
    expect(state.deals[0]).toMatchObject({ pricePerShare: 89, announcedDate: "2023-07-14" });
  });

  it("a release dated earlier replaces an 8-K read first (CAI)", () => {
    const state = emptyState();
    applyParsed(state, item(25), hit("2021-06-21", "0001-21-1"), target, unlisted, false);
    applyParsed(state, release(56, { announcedOn: "2021-06-17" }), hit("2021-06-21", "0001-21-2"), target, unlisted, false);
    expect(state.deals[0]).toMatchObject({ pricePerShare: 56, announcedDate: "2021-06-17" });
  });

  it("a closing release fills a blank price only in a cash deal (AZEK's closing-day $54.18)", () => {
    const state = emptyState();
    applyParsed(state, item(null, { consideration: "Mixed" }), hit("2025-03-24", "0001-25-1"), target, unlisted, false);
    applyParsed(state, parsed("completion", "Atlas Holdings LLC", { pricePerShare: 54.18, consideration: "Mixed" }), hit("2025-07-01", "0001-25-2"), target, unlisted, false);
    expect(state.deals[0].pricePerShare).toBeNull();
    const cash = emptyState();
    applyParsed(cash, item(null, { consideration: "Cash" }), hit("2025-03-24", "0001-25-1"), target, unlisted, false);
    applyParsed(cash, parsed("completion", "Atlas Holdings LLC", { pricePerShare: 9.81, consideration: "Cash" }), hit("2025-07-01", "0001-25-2"), target, unlisted, false);
    expect(cash.deals[0].pricePerShare).toBe(9.81);
  });

  it("a results report filed with the deal's first documents is still its announcement (IEC's $15.35)", () => {
    const state = emptyState();
    applyParsed(state, item(null, { consideration: null }), hit("2021-08-12", "0001-21-1"), target, unlisted, false);
    applyParsed(state, release(15.35, { consideration: "Cash", resultsReport: true }), hit("2021-08-12", "0001-21-2"), target, unlisted, false);
    expect(state.deals[0]).toMatchObject({ pricePerShare: 15.35, consideration: "Cash" });
  });
});

describe("a bare 8-K read before its own release", () => {
  const item = (buyer: string, over: Partial<ParsedPress> = {}) => parsed("announcement", buyer, { item101: true, signedOn: "2026-03-02", ...over });
  const release = (buyer: string, over: Partial<ParsedPress> = {}) => parsed("announcement", buyer, { announcedOn: "2026-03-03", ...over });

  it("gives way to the release's real buyer, value and consideration, but not its price (R1 RCM, AES)", () => {
    const state = emptyState();
    applyParsed(state, item("Raven Acquisition Holdings", { pricePerShare: 15, valueUsd: 10_700_000_000, valueKind: "equity", consideration: "Stock" }), hit("2026-03-03", "0001-26-1"), target, unlisted, false);
    applyParsed(state, release("TowerBrook and CD&R", { pricePerShare: 14, valueUsd: 33_400_000_000, valueKind: "enterprise", consideration: "Cash" }), hit("2026-03-03", "0001-26-2"), target, unlisted, false);
    expect(state.deals).toHaveLength(1);
    expect(state.deals[0]).toMatchObject({ acquirer: { name: "TowerBrook and CD&R" }, valueUsd: 33_400_000_000, valueKind: "enterprise", consideration: "Cash", pricePerShare: 15 });
  });

  it("gives way to one release only: the same 8-K wrapped in a DEFA14A doesn't put its value back (AES)", () => {
    const state = emptyState();
    applyParsed(state, item("Horizon Parent, L.P.", { pricePerShare: 15, valueUsd: 10_700_000_000, valueKind: "equity" }), hit("2026-03-02", "0001-26-1"), target, unlisted, false);
    applyParsed(state, release("Consortium Led by GIP and EQT", { valueUsd: 33_400_000_000, valueKind: "enterprise", announcedOn: undefined }), hit("2026-03-02", "0001-26-2"), target, unlisted, false);
    applyParsed(state, release("Consortium", { valueUsd: 10_700_000_000, valueKind: "equity", announcedOn: undefined }), hit("2026-03-02", "0001-26-3"), target, unlisted, false);
    expect(state.deals[0]).toMatchObject({ valueUsd: 33_400_000_000, valueKind: "enterprise" });
  });

  it("keeps its buyer against a release calling it a description (Heidrick / Advent's Investor Consortium)", () => {
    const state = emptyState();
    applyParsed(state, item("Advent International"), hit("2026-03-03", "0001-26-1"), target, unlisted, false);
    applyParsed(state, release("Investor Consortium"), hit("2026-03-03", "0001-26-2"), target, unlisted, false);
    expect(state.deals[0].acquirer.name).toBe("Advent International");
  });
});

describe("a raised offer", () => {
  const signed = () => {
    const state = emptyState();
    applyParsed(state, parsed("announcement", "Atlas Holdings LLC", { pricePerShare: 20.26, premiumPct: 30, valueUsd: 3_500_000_000, valueKind: "transaction" }), hit("2020-12-14", "0001-20-1"), target, unlisted, false);
    return state;
  };

  it("replaces the first price, with the value it states (Pluralsight $20.26 to $22.50)", () => {
    const state = signed();
    applyParsed(state, parsed("update", "Atlas Holdings LLC", { amended: true, pricePerShare: 22.5, premiumPct: 44, valueUsd: 4_000_000_000, valueKind: "transaction" }), hit("2021-03-08", "0001-21-2"), target, unlisted, false);
    expect(state.deals[0]).toMatchObject({ pricePerShare: 22.5, premiumPct: 44, valueUsd: 4_000_000_000 });
  });

  it("never keeps the first price's value beside it", () => {
    const state = signed();
    applyParsed(state, parsed("update", "Atlas Holdings LLC", { amended: true, pricePerShare: 22.5 }), hit("2021-03-08", "0001-21-2"), target, unlisted, false);
    expect(state.deals[0]).toMatchObject({ pricePerShare: 22.5, valueUsd: null, premiumPct: null });
  });

  it("stands when its signing, older, is read after it (Pluralsight: March's $22.50, then December's $20.26 from the backstop)", () => {
    const state = emptyState();
    applyParsed(state, parsed("announcement", "Atlas Holdings LLC", { amended: true, pricePerShare: 22.5 }), hit("2021-03-08", "0001-21-2"), target, unlisted, false);
    applyParsed(state, parsed("announcement", "Atlas Holdings LLC", { pricePerShare: 20.26, valueUsd: 3_500_000_000, valueKind: "transaction" }), hit("2020-12-14", "0001-20-1"), target, unlisted, false);
    expect(state.deals[0]).toMatchObject({ pricePerShare: 22.5, announcedDate: "2020-12-14" });
  });

  it("through a restated agreement under the same shell (Squarespace $44 to $46.50)", () => {
    const state = emptyState();
    applyParsed(state, parsed("announcement", "Spaceship Purchaser, Inc.", { item101: true, pricePerShare: 44, signedOn: "2024-05-13" }), hit("2024-05-13", "0001-24-1"), target, unlisted, false);
    applyParsed(state, parsed("announcement", "Spaceship Purchaser, Inc.", { item101: true, amended: true, pricePerShare: 46.5, signedOn: "2024-09-09" }), hit("2024-09-09", "0001-24-2"), target, unlisted, false);
    expect(state.deals).toHaveLength(1);
    expect(state.deals[0].pricePerShare).toBe(46.5);
  });

  it("needs its own words: another document's higher price doesn't replace it", () => {
    const state = signed();
    applyParsed(state, parsed("update", "Atlas Holdings LLC", { pricePerShare: 22.5 }), hit("2021-03-08", "0001-21-2"), target, unlisted, false);
    expect(state.deals[0].pricePerShare).toBe(20.26);
  });

  it("not a lower price, nor one far above the first", () => {
    const lower = signed();
    applyParsed(lower, parsed("update", "Atlas Holdings LLC", { amended: true, pricePerShare: 18 }), hit("2021-03-08", "0001-21-2"), target, unlisted, false);
    expect(lower.deals[0].pricePerShare).toBe(20.26);
    const far = signed();
    applyParsed(far, parsed("update", "Atlas Holdings LLC", { amended: true, pricePerShare: 40 }), hit("2021-03-08", "0001-21-2"), target, unlisted, false);
    expect(far.deals[0].pricePerShare).toBe(20.26);
  });
});

describe("a named part of the company beside another buyer's deal (Meredith)", () => {
  it("neither tops the other", () => {
    const state = emptyState();
    applyParsed(state, parsed("announcement", "Gray Television, Inc.", { pricePerShare: 14.51 }), hit("2021-05-03", "0001-21-1"), target, unlisted, false);
    applyParsed(state, parsed("announcement", "IAC", { pricePerShare: 42.18, partOfTarget: true }), hit("2021-07-20", "0001-21-2"), target, unlisted, false);
    tidyDeals(state.deals);
    expect(state.deals.map((d) => [d.acquirer.name, d.status])).toEqual([
      ["Gray Television, Inc.", "Announced"],
      ["IAC", "Announced"],
    ]);
  });
});

describe("a later filing naming only a shell", () => {
  it("still belongs to the live deal it implements, when nothing says that deal ended", () => {
    const state = withAtlas();
    applyParsed(state, parsed("announcement", "Atlas River Parent Inc."), hit("2021-12-20", "0001-21-2"), target, unlisted, false);
    expect(state.deals.map((d) => d.acquirer.name)).toEqual(["Atlas Holdings LLC"]);
  });
});

// The pipeline's re-read through the real ingestIpos, with EDGAR stood in by fixtures.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Directory } from "./deals";
import { ingestIpos } from "./ipos";
import { IPO_PARSER_VERSION } from "./parse/ipo";
import type { State, StoredIpo } from "./store";

const edgar = vi.hoisted(() => ({
  subs: {} as Record<string, unknown>,
  docs: {} as Record<string, string>,
  index: {} as Record<string, string[]>,
  reads: [] as string[],
}));

vi.mock("./edgar", async (importOriginal) => {
  const real = await importOriginal<typeof import("./edgar")>();
  const read = async (url: string) => {
    edgar.reads.push(url);
    return edgar.docs[url] ?? "";
  };
  return {
    ...real,
    fullTextSearch: async () => [],
    getSubmissions: async (cik: string) => edgar.subs[cik],
    recentFilings: (sub: { list: unknown[] }) => sub.list,
    filingDocuments: async (cik: string, adsh: string) => edgar.index[`${cik}/${adsh}`] ?? [],
    getText: read,
    getTextHead: read,
  };
});

const url = (cik: string, adsh: string, file: string) => `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh.replace(/-/g, "")}/${file}`;
const today = "2026-11-05";
const REG_COVER = "PROSPECTUS We are offering shares of common stock. This is our initial public offering. We intend to apply to list our common stock on the Nasdaq Global Select Market. Goldman Sachs & Co. LLC Morgan Stanley TABLE OF CONTENTS Page";
const fee = (amount: string) => `Calculation of Filing Fee Tables Maximum Aggregate Offering Price $${amount} Fee`;

/** One company with one registration, and optionally a final prospectus. */
function company(cik: string, name: string, s1: string, feeText: string | null, final?: { date: string; text: string }) {
  const list = [{ form: "S-1", date: "2026-07-01", adsh: `0001-26-${cik}`, primaryDocument: "s1.htm", items: "" }];
  edgar.docs[url(cik, list[0].adsh, "s1.htm")] = s1;
  edgar.index[`${cik}/${list[0].adsh}`] = feeText ? ["ex107.htm"] : [];
  if (feeText) edgar.docs[url(cik, list[0].adsh, "ex107.htm")] = feeText;
  if (final) {
    const row = { form: "424B4", date: final.date, adsh: `0002-26-${cik}`, primaryDocument: "b4.htm", items: "" };
    list.push(row);
    edgar.docs[url(cik, row.adsh, "b4.htm")] = final.text;
  }
  edgar.subs[cik] = { cik, name, sic: "7372", sicDescription: "Software", tickers: [], list };
}

const stored = (cik: string, name: string, over: Partial<StoredIpo> = {}): StoredIpo => ({
  id: `ipo-${cik}`,
  company: { name, ticker: null, cik },
  sector: "Tech",
  industry: "Software",
  stage: "Filed",
  filedDate: "2026-07-01",
  pricedDate: null,
  expectedRaiseUsd: null,
  offerPrice: null,
  underwriters: ["Goldman Sachs"],
  description: "A software company.",
  filings: [],
  lastActivity: "2026-07-01",
  checkedAt: null,
  parsedAdsh: "older",
  parser: IPO_PARSER_VERSION - 1,
  ...over,
});

async function run(ipos: StoredIpo[]) {
  const state = { ipos, deals: [], seen: new Set<string>() } as unknown as State;
  const directory = { byCik: new Map(), byTicker: new Map(), byName: new Map() } as unknown as Directory;
  await ingestIpos(state, { from: today, to: today, directory, log: () => {}, today });
  return new Map(state.ipos.map((i) => [i.company.cik, i]));
}

beforeEach(() => {
  edgar.subs = {};
  edgar.docs = {};
  edgar.index = {};
  edgar.reads = [];
});

describe("a stored raise on a re-read", () => {
  it("clears a placeholder an older parser stored (Anthropic: a round fee table, no price range)", async () => {
    company("1", "Anthropic, PBC", REG_COVER, fee("1,000,000,000"));
    const out = await run([stored("1", "Anthropic, PBC", { expectedRaiseUsd: 1e9 })]);
    expect(out.get("1")!.expectedRaiseUsd).toBeNull();
    expect(out.get("1")!.parser).toBe(IPO_PARSER_VERSION);
  });

  it("never shows a fee table's maximum or a stale figure as the raise, and keeps a price range landing on a round number", async () => {
    company("2", "Real Fee Co", REG_COVER, fee("33,000,000"));
    company("3", "Fee Lost Co", REG_COVER, null);
    company("4", "Range Co", `25,000,000 Shares between $17.00 and $19.00 per share ${REG_COVER}`, fee("1,000,000,000"));
    const out = await run([stored("2", "Real Fee Co", { expectedRaiseUsd: 1e9 }), stored("3", "Fee Lost Co", { expectedRaiseUsd: 28e6 }), stored("4", "Range Co", { expectedRaiseUsd: 1e9 })]);
    // The fee table's maximum stays apart, for the size test only; a figure the re-read can't find goes (vVARDIS kept its first filing's).
    expect(out.get("2")!.expectedRaiseUsd).toBeNull();
    expect(out.get("2")!.registeredMaxUsd).toBe(33e6);
    expect(out.get("3")!.expectedRaiseUsd).toBeNull();
    expect(out.get("4")!.expectedRaiseUsd).toBe(450e6);
  });

  it("doesn't touch a stored figure on a run that doesn't re-read the document", async () => {
    company("5", "Quiet Co", REG_COVER, fee("1,000,000,000"));
    const out = await run([stored("5", "Quiet Co", { expectedRaiseUsd: 150e6, parsedAdsh: "0001-26-5", parser: IPO_PARSER_VERSION })]);
    expect(out.get("5")!.expectedRaiseUsd).toBe(150e6);
    expect(edgar.reads).toEqual([]);
  });

  it("doesn't carry a placeholder into a priced record whose cover gives no total, and keeps a real estimate", async () => {
    const noTotal = { date: "2026-10-30", text: "PROSPECTUS We are offering shares. Prospectus dated October 29, 2026 Table of Contents. Underwriters Number of Shares Morgan Stanley & Co. LLC 1 Total" };
    company("6", "Placeholder Priced Co", REG_COVER, null, noTotal);
    company("7", "Estimate Priced Co", REG_COVER, null, noTotal);
    const out = await run([stored("6", "Placeholder Priced Co", { expectedRaiseUsd: 1e9 }), stored("7", "Estimate Priced Co", { expectedRaiseUsd: 88e6 })]);
    expect(out.get("6")!.expectedRaiseUsd).toBeNull();
    expect(out.get("7")!.expectedRaiseUsd).toBe(88e6);
  });
});

describe("second-step conversions", () => {
  it("drops Columbia Financial's and keeps Hometown's first-time conversion", async () => {
    company("8", "Columbia Financial, Inc.", `${REG_COVER} The "second-step" conversion process that we are now undertaking. The shares of Columbia Financial currently owned by the public will be exchanged for shares of common stock of Columbia Financial, Inc.`, fee("1,926,250,000"));
    company("9", "Hometown Financial Group, Inc.", `${REG_COVER} in connection with the conversion of Hometown Financial Group, MHC. There is no current public or private market. The Plan of Conversion of Hometown Financial Group, MHC.`, fee("825,240,000"));
    const out = await run([stored("8", "Columbia Financial, Inc.", { expectedRaiseUsd: 1926250000 }), stored("9", "Hometown Financial Group, Inc.", { expectedRaiseUsd: 825240000 })]);
    expect(out.has("8")).toBe(false);
    expect(out.get("9")!.registeredMaxUsd).toBe(825240000);
  });
});

describe("the priced date", () => {
  const b4 = (body: string) => `PROSPECTUS We are offering 10,000,000 shares. The initial public offering price per share is $15.00. ${body} Underwriters Number of Shares Morgan Stanley & Co. LLC 1 Total`;

  it("comes from the cover, and the stage stays on the filing date (Orion180: priced September 17, filed the 21st)", async () => {
    // Filed October 31, dated October 27: nine days after the date but within seven of the filing, so it's still "Priced".
    company("10", "Cover Date Co", REG_COVER, null, { date: "2026-10-31", text: b4("October 27, 2026 Table of Contents") });
    const out = await run([stored("10", "Cover Date Co")]);
    expect(out.get("10")).toMatchObject({ pricedDate: "2026-10-27", stage: "Priced", lastActivity: "2026-10-31" });
  });

  it("falls back to the filing date when the cover has none (Braveheart)", async () => {
    company("11", "No Date Co", REG_COVER, null, { date: "2026-10-31", text: b4("") });
    const out = await run([stored("11", "No Date Co")]);
    expect(out.get("11")!.pricedDate).toBe("2026-10-31");
  });

  it("stays as stored on a run that doesn't re-read the prospectus, and is blank until it prices", async () => {
    company("12", "Stored Date Co", REG_COVER, null, { date: "2026-10-31", text: b4("October 27, 2026 Table of Contents") });
    company("13", "Unpriced Co", REG_COVER, fee("33,000,000"));
    const out = await run([stored("12", "Stored Date Co", { pricedDate: "2026-10-29", parsedAdsh: "0002-26-12", parser: IPO_PARSER_VERSION }), stored("13", "Unpriced Co")]);
    expect(out.get("12")!.pricedDate).toBe("2026-10-29");
    expect(out.get("13")!.pricedDate).toBeNull();
  });
});

describe("a merged company's resale registration", () => {
  it("drops a foreign issuer listed through a merger before its F-1 (newcleo, IQM), and keeps an IPO whose listing comes after", async () => {
    const resale = "PROSPECTUS This prospectus relates to the offer and sale, from time to time, by the selling securityholders named herein, and the issuance of ordinary shares upon the exercise of warrants. Cohen & Company Capital Markets TABLE OF CONTENTS";
    company("21", "IQM Quantum Computers Oyj", resale, null);
    company("22", "Listed Later Co", REG_COVER, null);
    const listedFirst = (cik: string, listed: string) =>
      (edgar.subs[cik] as { list: object[] }).list.unshift(
        { form: "F-4", date: "2026-03-01", adsh: `0003-26-${cik}`, primaryDocument: "f4.htm", items: "" },
        { form: "8-A12B", date: listed, adsh: `0004-26-${cik}`, primaryDocument: "8a.htm", items: "" },
      );
    listedFirst("21", "2026-06-30");
    listedFirst("22", "2026-08-01");
    const out = await run([stored("21", "IQM Quantum Computers Oyj"), stored("22", "Listed Later Co")]);
    expect(out.has("21")).toBe(false);
    expect(out.has("22")).toBe(true);
  });
});

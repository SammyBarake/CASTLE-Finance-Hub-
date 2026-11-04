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

describe("a later filing naming only a shell", () => {
  it("still belongs to the live deal it implements, when nothing says that deal ended", () => {
    const state = withAtlas();
    applyParsed(state, parsed("announcement", "Atlas River Parent Inc."), hit("2021-12-20", "0001-21-2"), target, unlisted, false);
    expect(state.deals.map((d) => d.acquirer.name)).toEqual(["Atlas Holdings LLC"]);
  });
});

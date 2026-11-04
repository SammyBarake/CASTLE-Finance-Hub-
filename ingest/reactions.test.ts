import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { carryReactions, heldReactions, reactionsToHold, sameBuyer } from "./reactions";
import { JsonStore, type StoredDeal } from "./store";

const reaction = { announcementPct: -5, announcementVsMarketPct: -6, m6VsMarketPct: 2.5, y1VsMarketPct: null };

const deal = (over: Partial<StoredDeal> = {}): StoredDeal =>
  ({
    id: "21510-2024-03-04",
    announcedDate: "2024-03-04",
    acquirer: { name: "II-VI Inc", ticker: "IIVI", cik: "820318" },
    target: { name: "Coherent Inc", ticker: "COHR", cik: "21510" },
    ...over,
  }) as StoredDeal;

const held = (over: Partial<StoredDeal> = {}) => deal({ reaction, reactionCheckedAt: "2026-11-01", ...over });

describe("carryReactions", () => {
  it("carries a reaction and its check date to the record with the same id", () => {
    const next = [deal()];
    expect(carryReactions([held()], next)).toEqual({ carried: 1, unplaced: [] });
    expect(next[0].reaction).toEqual(reaction);
    expect(next[0].reactionCheckedAt).toBe("2026-11-01");
  });

  it("keeps a figure on its record when the date moved within a week (a signing or a dateline)", () => {
    const next = [deal({ announcedDate: "2024-03-01" })];
    expect(carryReactions([held()], next)).toEqual({ carried: 1, unplaced: [] });
    expect(next[0].reaction).toEqual(reaction);
  });

  it("parks a figure whose record's date moved further: it was measured around another day, a closing (Kito Crosby)", () => {
    const rebuilt = [deal({ announcedDate: "2023-05-04" })];
    const r = carryReactions([held()], rebuilt);
    expect(r).toMatchObject({ carried: 0 });
    expect(r.unplaced).toHaveLength(1);
    expect(rebuilt[0].reaction).toBeUndefined();
  });

  it("takes such a figure off a record that still holds it, repeatably, and leaves another figure alone", () => {
    const ordinary = [deal({ announcedDate: "2023-05-04", reaction, reactionCheckedAt: "2026-11-01" })];
    for (let i = 0; i < 2; i++) {
      const r = carryReactions([held()], ordinary);
      expect(r.unplaced).toHaveLength(1);
      expect(ordinary[0].reaction).toBeUndefined();
      expect(ordinary[0].reactionCheckedAt).toBeUndefined();
    }
    const other = { ...reaction, announcementPct: 1 };
    const own = [deal({ announcedDate: "2023-05-04", reaction: other })];
    carryReactions([held()], own);
    expect(own[0].reaction).toEqual(other);
  });

  it("finds a record whose id changed: same buyer CIK, same target, announced within a week", () => {
    const next = [deal({ id: "21510-2024-03-09", announcedDate: "2024-03-09" })];
    expect(carryReactions([held()], next).carried).toBe(1);
    expect(next[0].reaction).toEqual(reaction);
  });

  it("matches a private target by its normalised name", () => {
    const old = held({ id: "p-rotron-2024-03-04", target: { name: "Rotron Aerospace, Ltd.", ticker: null, cik: null } });
    const next = [deal({ id: "p-rotron-aerospace-2024-03-05", announcedDate: "2024-03-05", target: { name: "Rotron Aerospace", ticker: null, cik: null } })];
    expect(carryReactions([old], next).carried).toBe(1);
  });

  it("doesn't give a rival buyer of the same target the reaction, under another id or the same one", () => {
    const rival = { name: "MKS Inc", ticker: "MKSI", cik: "1049502" };
    const days = [deal({ id: "21510-2024-03-05", announcedDate: "2024-03-05", acquirer: rival })];
    const r1 = carryReactions([held()], days);
    expect(r1.carried).toBe(0);
    expect(r1.unplaced).toHaveLength(1);
    expect(days[0].reaction).toBeUndefined();
    const sameId = [deal({ acquirer: rival })];
    expect(carryReactions([held()], sameId).carried).toBe(0);
    expect(sameId[0].reaction).toBeUndefined();
  });

  it("finds the right rival when the two swap ids in a rebuild", () => {
    const rival = { name: "MKS Inc", ticker: "MKSI", cik: "1049502" };
    const swapped = [deal({ acquirer: rival }), deal({ id: "21510-2024-03-04-2" })];
    expect(carryReactions([held()], swapped).carried).toBe(1);
    expect(swapped[0].reaction).toBeUndefined();
    expect(swapped[1].reaction).toEqual(reaction);
  });

  it("doesn't carry a reaction to a record whose buyer turned out to be another firm", () => {
    // McAfee's "Advent" was the buyout firm, not the listed fuel-cell maker Advent Technologies. A shared first word or a
    // shared normalised name proves nothing either, with one side's CIK missing.
    const pairs: [string, string, string][] = [
      ["Advent Technologies Holdings, Inc.", "1744494", "Clayton Dubilier & Rice"],
      ["Advent Technologies Holdings, Inc.", "1744494", "Advent International"],
      ["General Motors Co", "1467858", "General Electric"],
      ["First Citizens BancShares", "798941", "First Horizon"],
      ["EQT Corp", "33213", "EQT Infrastructure"],
      ["Blackstone Mortgage Trust, Inc.", "1061630", "Blackstone Real Estate Partners"],
    ];
    for (const [name, cik, other] of pairs) {
      const next = [deal({ acquirer: { name: other, ticker: null, cik: null } })];
      const r = carryReactions([held({ acquirer: { name, ticker: "X", cik } })], next);
      expect(r.carried, other).toBe(0);
      expect(r.unplaced, other).toHaveLength(1);
      expect(next[0].reaction, other).toBeUndefined();
    }
  });

  it("doesn't move by id across two different CIKs, however alike the names", () => {
    const next = [deal({ acquirer: { name: "II-VI Inc", ticker: "IIVX", cik: "999" } })];
    expect(carryReactions([held()], next).carried).toBe(0);
  });

  it("knows two registrants behind one ticker are the same shares, by id and under a new id", () => {
    // Cidara's merger 8-K named Merck Sharp & Dohme; a re-read names Merck & Co. Both trade as MRK.
    const old = held({ acquirer: { name: "Merck Sharp & Dohme LLC", ticker: "MRK", cik: "64978" } });
    const merck = { name: "Merck & Co., Inc.", ticker: "MRK", cik: "310158" };
    expect(carryReactions([old], [deal({ acquirer: merck })]).carried).toBe(1);
    expect(carryReactions([old], [deal({ id: "21510-2024-03-06", announcedDate: "2024-03-06", acquirer: merck })]).carried).toBe(1);
  });

  it("carries by id when the rebuilt record hasn't linked its buyer yet: the same name, its legal form aside", () => {
    const next = [deal({ acquirer: { name: "II-VI Incorporated", ticker: null, cik: null } })];
    expect(carryReactions([held()], next).carried).toBe(1);
  });

  it("doesn't take a registrant of the same name for the target when the CIKs differ", () => {
    // SailPoint, bought in 2022, relisted in 2025 under a new CIK.
    const next = [deal({ id: "999-2024-03-05", announcedDate: "2024-03-05", target: { name: "Coherent Inc", ticker: "COHR", cik: "999" } })];
    expect(carryReactions([held()], next).carried).toBe(0);
  });

  it("allows a move of up to seven days under a new id, and no more", () => {
    const moved = (date: string) => [deal({ id: `21510-${date}`, announcedDate: date })];
    expect(carryReactions([held()], moved("2024-03-11")).carried).toBe(1);
    expect(carryReactions([held()], moved("2024-03-12")).carried).toBe(0);
    expect(carryReactions([held()], moved("2024-02-26")).carried).toBe(1);
    expect(carryReactions([held()], moved("2024-02-25")).carried).toBe(0);
  });

  it("reports what found no record and changes nothing", () => {
    const tooFar = [deal({ id: "21510-2024-03-20", announcedDate: "2024-03-20" })];
    const otherTarget = [deal({ id: "1-2024-03-04", target: { name: "Finisar", ticker: null, cik: "1" } })];
    for (const next of [[], tooFar, otherTarget]) {
      const r = carryReactions([held()], next);
      expect(r.carried).toBe(0);
      expect(r.unplaced.map((u) => u.id)).toEqual(["21510-2024-03-04"]);
      expect(next.every((d) => d.reaction === undefined)).toBe(true);
    }
  });

  it("never overwrites a reaction already there, and repeating changes nothing", () => {
    const own = { ...reaction, announcementPct: 9 };
    const there = [deal({ reaction: own, reactionCheckedAt: "2026-10-01" })];
    expect(carryReactions([held()], there)).toEqual({ carried: 0, unplaced: [] });
    expect(there[0].reaction).toBe(own);
    expect(there[0].reactionCheckedAt).toBe("2026-10-01");
    // A checkpoint, then the final save.
    const next = [deal({ id: "21510-2024-03-09", announcedDate: "2024-03-09" })];
    expect(carryReactions([held()], next).carried).toBe(1);
    expect(carryReactions([held()], next)).toEqual({ carried: 0, unplaced: [] });
  });

  it("gives a record back its reaction when it turns up in a later run", () => {
    const first = carryReactions([held()], []);
    const next = [deal()];
    expect(carryReactions(first.unplaced, next)).toEqual({ carried: 1, unplaced: [] });
  });

  it("holds only what it needs, from the deals that have a reaction", () => {
    const held1 = heldReactions([deal(), held({ sources: ["a"], filings: [] })]);
    expect(held1).toHaveLength(1);
    expect(Object.keys(held1[0]).sort()).toEqual(["acquirer", "announcedDate", "id", "reaction", "reactionCheckedAt", "target"]);
  });
});

describe("sameBuyer", () => {
  const merck = { name: "Merck & Co., Inc.", ticker: "MRK", cik: "310158" };
  it("goes by the ticker or the CIK, and by the name only when one is missing", () => {
    expect(sameBuyer({ name: "Merck Sharp & Dohme LLC", ticker: "MRK", cik: "64978" }, merck)).toBe(true);
    expect(sameBuyer({ name: "Merck & Co", ticker: null, cik: "310158" }, merck)).toBe(true);
    expect(sameBuyer({ name: "Merck & Co", ticker: null, cik: "999" }, merck)).toBe(false);
    expect(sameBuyer({ name: "Merck & Co", ticker: null, cik: null }, merck)).toBe(true);
    expect(sameBuyer({ name: "Merck KGaA", ticker: null, cik: null }, merck)).toBe(false);
  });
});

describe("the local store", () => {
  it("keeps what's parked through a save and a load", async () => {
    const dir = mkdtempSync(join(tmpdir(), "castle-store-"));
    try {
      const store = new JsonStore(join(dir, "castle.json"));
      const parked = heldReactions([held()]);
      await store.save({ deals: [], ipos: [], seen: new Set(), asOf: null, macro: null, activists: [], unplacedReactions: parked });
      expect((await store.load()).unplacedReactions).toEqual(parked);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("reactionsToHold", () => {
  it("takes what's on the records and what was parked, once each", () => {
    const onRecord = held();
    const parkedToo = heldReactions([held()])[0];
    const elsewhere = heldReactions([held({ id: "p-other-2024-01-01" })])[0];
    const out = reactionsToHold([onRecord, deal({ id: "no-reaction" })], [parkedToo, elsewhere, elsewhere]);
    expect(out.map((h) => h.id)).toEqual(["21510-2024-03-04", "p-other-2024-01-01"]);
  });

  it("keeps two buyers' reactions under one id apart", () => {
    const rival = heldReactions([held({ acquirer: { name: "MKS Inc", ticker: "MKSI", cik: "1049502" } })])[0];
    expect(reactionsToHold([held()], [rival])).toHaveLength(2);
  });
});

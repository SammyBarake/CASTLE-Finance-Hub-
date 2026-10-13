import { describe, expect, it } from "vitest";
import { bankFingerprint } from "./fingerprint";
import type { Deal } from "./types";

let n = 0;
const deal = (over: Partial<Deal>): Deal =>
  ({
    id: `d${++n}`,
    announcedDate: "2024-01-01",
    sector: "Tech",
    valueUsd: null,
    premiumPct: null,
    acquirer: { name: "Acme Corp", ticker: null, cik: "1" },
    target: { name: `Target ${n}`, ticker: null, cik: String(100 + n) },
    acquirerAdvisors: [],
    targetAdvisors: [],
    ...over,
  }) as Deal;

describe("bankFingerprint", () => {
  const deals = [
    deal({ acquirerAdvisors: ["Goldman Sachs"], targetAdvisors: ["Lazard"], valueUsd: 2e9 }),
    deal({ acquirerAdvisors: ["Goldman Sachs"], targetAdvisors: ["Lazard", "Evercore"], valueUsd: 4e9, sector: "Healthcare" }),
    deal({ targetAdvisors: ["Goldman Sachs"], acquirerAdvisors: ["Morgan Stanley"], valueUsd: 1e9, premiumPct: 30 }),
    deal({ targetAdvisors: ["Morgan Stanley"], acquirerAdvisors: ["Citigroup"] }),
  ];

  it("counts sides, sizes, sectors, repeat clients and counterparts", () => {
    const f = bankFingerprint("Goldman Sachs", deals);
    expect(f.deals).toBe(3);
    expect(f.buySide).toBe(2);
    expect(f.sellSide).toBe(1);
    expect(f.medianValueUsd).toBe(2e9);
    expect(f.medianPremiumPct).toBe(30);
    expect(f.sectors[0]).toEqual({ sector: "Tech", count: 2, share: (2 / 3) * 100 });
    // Acme Corp was its buy-side client twice.
    expect(f.repeatClients).toEqual([{ company: { name: "Acme Corp", ticker: null, cik: "1" }, count: 2 }]);
    expect(f.counterparts[0]).toEqual({ bank: "Lazard", count: 2 });
    expect(f.counterparts.map((c) => c.bank)).toEqual(["Lazard", "Evercore", "Morgan Stanley"]);
  });

  it("is empty for a bank with no deals", () => {
    expect(bankFingerprint("Nobody", deals)).toMatchObject({ deals: 0, medianValueUsd: null, sectors: [], repeatClients: [], counterparts: [] });
  });
});

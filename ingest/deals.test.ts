import { describe, expect, it } from "vitest";
import type { Company } from "../lib/types";
import { dropPrivateDuplicates, isPrivateTargetName, stripDateline, tidyTargetName } from "./deals";
import type { StoredDeal } from "./store";

describe("isPrivateTargetName", () => {
  it("accepts real company names", () => {
    expect(isPrivateTargetName("Kashiv Specialty Pharmaceuticals", "Amneal")).toBe(true);
    expect(isPrivateTargetName("Acme Company, Inc.", "Widget Corp")).toBe(true);
  });
  it("rejects descriptions, assets and generic words", () => {
    expect(isPrivateTargetName("Next-Gen AI Drug Discovery Company", "Nexentis")).toBe(false);
    expect(isPrivateTargetName("Land", "Nomadar")).toBe(false);
    expect(isPrivateTargetName("certain assets of Foo", "Bar")).toBe(false);
    expect(isPrivateTargetName("Pizza Hut Brand", "Bar")).toBe(false);
  });
});

describe("stripDateline", () => {
  it("drops an all-caps city glued onto a name", () => {
    expect(stripDateline("Sirius Computer Solutions LINCOLNSHIRE")).toBe("Sirius Computer Solutions");
    expect(stripDateline("Acme Robotics NEW YORK")).toBe("Acme Robotics");
    expect(stripDateline("Elon Musk SAN FRANCISCO")).toBe("Elon Musk");
  });
  it("keeps legal suffixes, short acronyms and all-caps names", () => {
    expect(stripDateline("Acme Software USA")).toBe("Acme Software USA");
    expect(stripDateline("Nexus AI")).toBe("Nexus AI");
    expect(stripDateline("Bright Health DTC")).toBe("Bright Health DTC");
    expect(stripDateline("IBM")).toBe("IBM");
  });
});

describe("dropPrivateDuplicates", () => {
  const deal = (id: string, acq: Company, target: string, date: string, privateTarget = false) =>
    ({ id, acquirer: acq, target: { name: target, ticker: null, cik: privateTarget ? null : "1" }, announcedDate: date, privateTarget }) as unknown as StoredDeal;
  it("drops a private copy of a public deal and keeps the better buyer name", () => {
    const deals = [
      deal("a", { name: "SoundHound Closing Stock Price", ticker: null, cik: null }, "Liveperson Inc", "2026-04-21"),
      deal("b", { name: "Soundhound Ai, Inc.", ticker: "SOUN", cik: "9" }, "LivePerson", "2026-09-04", true),
      deal("c", { name: "Valley National Bancorp", ticker: "VLY", cik: "8" }, "Providence", "2026-08-25", true),
      deal("d", { name: "Other Co", ticker: null, cik: "7" }, "Providence Service Corp", "2026-06-01"),
    ];
    dropPrivateDuplicates(deals);
    expect(deals.map((d) => d.id)).toEqual(["a", "c", "d"]);
    expect(deals[0].acquirer.name).toBe("Soundhound Ai, Inc.");
  });
});

describe("isPrivateTargetName rejects counts, sites and divisions", () => {
  it.each([
    "Two Toyota and Two Lexus Dealerships",
    "Sixth Real Estate Brokerage",
    "FOUR DOMINANT ENCLOSED REGIONAL MALLS",
    "A GEORGIA COMMUNITY",
    "MONTICELLO LAND",
    "RF Business of Wolfspeed",
    "Microlab RF Business Unit of Wireless Telecom Group",
    "ALLIANCE HEALTHCARE BUSINESSES",
  ])("%s", (name) => expect(isPrivateTargetName(name, "Buyer Inc")).toBe(false));
  it("keeps real names", () => {
    for (const n of ["First Watch Partners", "Rosewood Communities", "Kodiak Building Partners", "Teton Financial Services"]) expect(isPrivateTargetName(n, "Buyer Inc")).toBe(true);
  });
});

describe("tidyTargetName", () => {
  it("cuts the acquirer's brand, title-cases capitals, strips datelines", () => {
    expect(tidyTargetName("Ginop Sales Alta CE", "Alta Equipment Group Inc.")).toBe("Ginop Sales");
    expect(tidyTargetName("Crestwood Energy Partners", "Energy Transfer LP")).toBe("Crestwood Energy Partners");
    expect(tidyTargetName("TETON FINANCIAL SERVICES", "First Western Financial")).toBe("Teton Financial Services");
    expect(tidyTargetName("WTG MIDSTREAM", "Energy Transfer LP")).toBe("WTG Midstream");
    expect(tidyTargetName("COMPUTERSHARE MORTGAGE SERVICES INC", "Rithm Capital")).toBe("Computershare Mortgage Services Inc");
    expect(tidyTargetName("Sirius Computer Solutions LINCOLNSHIRE", "CDW")).toBe("Sirius Computer Solutions");
  });
});

describe("isPrivateTargetName rejects drugs", () => {
  it("drops programme names", () => {
    expect(isPrivateTargetName("ST-920 Fabry Disease Gene Therapy", "PTC Therapeutics")).toBe(false);
    expect(isPrivateTargetName("Actio Biosciences", "Jazz")).toBe(true);
  });
});

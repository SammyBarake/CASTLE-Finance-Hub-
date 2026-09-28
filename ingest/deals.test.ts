import { describe, expect, it } from "vitest";
import { isPrivateTargetName, sameExchange, stripDateline } from "./deals";

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
  });
  it("keeps legal suffixes, short acronyms and all-caps names", () => {
    expect(stripDateline("Acme Software USA")).toBe("Acme Software USA");
    expect(stripDateline("Nexus AI")).toBe("Nexus AI");
    expect(stripDateline("Bright Health DTC")).toBe("Bright Health DTC");
    expect(stripDateline("IBM")).toBe("IBM");
  });
});

describe("sameExchange", () => {
  it("normalises exchange names", () => {
    expect(sameExchange("NASDAQ", "Nasdaq")).toBe(true);
    expect(sameExchange("NYSE American", "NYSE MKT")).toBe(true);
    expect(sameExchange("NASDAQ", "NYSE")).toBe(false);
    expect(sameExchange(null, "NYSE")).toBe(false);
  });
});

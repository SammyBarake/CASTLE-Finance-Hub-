import { describe, expect, it } from "vitest";
import { isIpoProspectus } from "./ipoHistory";
import { FINAL_PROSPECTUS, publicWithin } from "./ipos";

const row = (date: string, form: string, adsh = `${form}-${date}`) => ({ adsh, date, form, primaryDocument: "doc.htm", items: "" });

describe("final prospectuses", () => {
  it("counts 424B1 as well as 424B4", () => {
    expect(FINAL_PROSPECTUS.test("424B4")).toBe(true);
    expect(FINAL_PROSPECTUS.test("424B1")).toBe(true);
    expect(FINAL_PROSPECTUS.test("424B3")).toBe(false);
  });

  it("reads a 424B1 IPO (Grupo Aeroméxico) and treats an earlier one as already public", () => {
    const filings = [row("2025-11-07", "424B1"), row("2025-10-17", "F-1/A"), row("2024-05-13", "F-1")];
    expect(isIpoProspectus(filings, "2025-11-07", "424B1-2025-11-07")).toBe(true);
    expect(publicWithin([row("2024-03-01", "424B1")], "2025-11-07")).toBe(true);
  });
});

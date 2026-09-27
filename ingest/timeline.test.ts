import { describe, expect, it } from "vitest";
import { milestonesFrom } from "./timeline";

const f = (form: string, date: string, items = "") => ({ form, date, items });

describe("milestonesFrom", () => {
  it("reads a shareholder-vote deal", () => {
    const m = milestonesFrom(
      [
        f("10-Q", "2026-01-05"),
        f("8-K", "2026-02-01", "1.01"),
        f("PREM14A", "2026-03-10"),
        f("DEFM14A", "2026-04-02"),
        f("8-K", "2026-05-08", "5.07"),
        f("8-K", "2026-06-20", "2.01,5.01"),
        f("25-NSE", "2026-06-21"),
      ],
      "2026-02-01",
      null,
    );
    expect(m).toEqual({ path: "vote", firstFiling: { form: "PREM14A", date: "2026-03-10" }, definitiveProxy: "2026-04-02", voteHeld: "2026-05-08", closed: "2026-06-20", terminated: null });
  });

  it("reads a tender offer and ignores filings before the announcement", () => {
    const m = milestonesFrom([f("DEFM14A", "2025-05-01"), f("SC 14D9", "2026-02-15"), f("15-12G", "2026-03-20")], "2026-02-01", null);
    expect(m.path).toBe("tender");
    expect(m.firstFiling).toEqual({ form: "SC 14D9", date: "2026-02-15" });
    expect(m.definitiveProxy).toBeNull();
    expect(m.closed).toBe("2026-03-20");
  });

  it("keeps a terminated deal open-ended and a fresh deal empty", () => {
    expect(milestonesFrom([f("PREM14A", "2026-03-01"), f("25-NSE", "2026-09-01")], "2026-02-01", "2026-05-01")).toMatchObject({ closed: null, terminated: "2026-05-01" });
    expect(milestonesFrom([], "2026-09-20", null)).toEqual({ path: null, firstFiling: null, definitiveProxy: null, voteHeld: null, closed: null, terminated: null });
  });
});

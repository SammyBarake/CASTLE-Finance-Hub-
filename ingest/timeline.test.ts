import { describe, expect, it } from "vitest";
import { isClosingFiling, milestonesFrom } from "./timeline";

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

  it("ignores a preferred-series delisting when the company keeps reporting", () => {
    const filings = [f("DEFM14A", "2022-05-01"), f("25-NSE", "2022-06-01"), f("10-Q", "2022-08-05"), f("10-K", "2023-02-20")];
    expect(milestonesFrom(filings, "2022-02-28", null).closed).toBeNull();
    expect(milestonesFrom([f("DEFM14A", "2022-05-01"), f("25-NSE", "2022-06-01"), f("15-12B", "2022-06-12")], "2022-02-28", null).closed).toBe("2022-06-01");
  });

  it("keeps a terminated deal open-ended and a fresh deal empty", () => {
    expect(milestonesFrom([f("PREM14A", "2026-03-01"), f("25-NSE", "2026-09-01")], "2026-02-01", "2026-05-01")).toMatchObject({ closed: null, terminated: "2026-05-01" });
    expect(milestonesFrom([], "2026-09-20", null)).toEqual({ path: null, firstFiling: null, definitiveProxy: null, voteHeld: null, closed: null, terminated: null });
  });
});

describe("isClosingFiling for a company that keeps reporting", () => {
  it("accepts a delisting next to a change-of-control 8-K, or completion and change of control together", () => {
    // Athene: Form 25 and the change-of-control 8-K on January 3, 2022; 10-Qs since for its preferred shares and notes.
    const athene = [f("25-NSE", "2022-01-03"), f("8-K", "2022-01-03", "1.01,5.01,5.03"), f("10-Q", "2022-05-10"), f("10-K", "2023-03-01")];
    expect(isClosingFiling(athene, athene[0])).toBe(true);
    expect(isClosingFiling(athene, athene[1])).toBe(true);
    // Bally's: Standard General took control and the stock stayed listed.
    const ballys = [f("8-K", "2025-02-13", "2.01,3.03,5.01"), f("10-Q", "2025-05-10")];
    expect(isClosingFiling(ballys, ballys[0])).toBe(true);
  });
  it("rejects a preferred series delisted on its own, and a change of control alone", () => {
    const preferred = [f("25-NSE", "2023-07-03"), f("8-K", "2023-07-03", "3.01,8.01"), f("10-Q", "2023-11-10")];
    expect(isClosingFiling(preferred, preferred[0])).toBe(false);
    const control = [f("8-K", "2022-09-12", "1.01,3.02,5.01"), f("10-Q", "2023-05-10")];
    expect(isClosingFiling(control, control[0])).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { closingFiling, closingsToRead, isClosingFiling, milestonesFrom, ownFilings } from "./timeline";

const f = (form: string, date: string, items = "", reportDate?: string) => ({ form, date, items, reportDate });

describe("ownFilings: a deal's filings end where it did", () => {
  const dated = (date: string) => ({ date });
  it("drops the winner's proxy from a losing bid, and a later buyer's from a closed deal", () => {
    // Netflix / WBD ended February 27 2026; Paramount's proxy was mailed March 26.
    const wbd = [dated("2026-02-17"), dated("2026-03-26")];
    expect(ownFilings(wbd, { announcedDate: "2025-12-05", status: "Terminated", statusDate: "2026-02-27" })).toEqual([dated("2026-02-17")]);
    // LKCM's 2022 purchase of Lawson Products closed April 4 2022; the 2026 proxy is LKCM Headwater's new deal.
    const lawson = [dated("2022-02-10"), dated("2026-10-28")];
    expect(ownFilings(lawson, { announcedDate: "2022-01-04", status: "Closed", statusDate: "2022-04-04" })).toEqual([dated("2022-02-10")]);
    expect(ownFilings(lawson, { announcedDate: "2026-07-16", status: "Pending", statusDate: "2026-09-01" })).toEqual([dated("2026-10-28")]);
  });
  it("can't bound an ended deal with no date (tidy clears what it took), and nothing before the announcement counts", () => {
    const aerojet = [dated("2020-05-01"), dated("2021-02-05"), dated("2023-02-13")];
    expect(ownFilings(aerojet, { announcedDate: "2020-12-21", status: "Terminated", statusDate: null })).toEqual([dated("2021-02-05"), dated("2023-02-13")]);
  });
});

describe("the vote", () => {
  const voted = (filings: ReturnType<typeof f>[], announced: string, terminated: string | null, opts = {}) => milestonesFrom(filings, announced, terminated, opts).voteHeld;

  it("isn't the annual meeting's 8-K before the merger meeting", () => {
    // Hess: proxy April 26 2024 for "a special meeting of its stockholders on May 28, 2024"; annual meeting May 15.
    const hess = [f("DEFM14A", "2024-04-26"), f("8-K", "2024-05-17", "5.07", "2024-05-15"), f("8-K", "2024-05-31", "5.07,8.01,9.01", "2024-05-28"), f("25-NSE", "2025-07-18")];
    expect(voted(hess, "2023-10-23", null, { meetingDate: "2024-05-28" })).toBe("2024-05-28");
    // Silicon Labs: annual meeting April 23 2026, 27 days after the proxy: only the proxy's own date tells.
    const labs = [f("DEFM14A", "2026-03-27"), f("8-K", "2026-04-24", "5.07", "2026-04-23"), f("8-K", "2026-04-30", "5.07", "2026-04-30")];
    expect(voted(labs, "2026-02-04", null, { meetingDate: "2026-04-30" })).toBe("2026-04-30");
  });

  it("is blank on an open deal until its meeting, and while the date is unknown", () => {
    // Synaptics' annual meeting was October 27 2026; the proxy's merger meeting is November 17. "Approved by shareholders" printed from this field.
    const synaptics = [f("PREM14A", "2026-10-08"), f("DEFM14A", "2026-10-19"), f("8-K", "2026-10-29", "5.02,5.07,9.01", "2026-10-27")];
    expect(voted(synaptics, "2026-06-25", null, { meetingDate: "2026-11-17" })).toBeNull();
    expect(voted(synaptics, "2026-06-25", null)).toBeNull();
    // Silicon Labs' two 5.07s with no date read: in doubt while the deal is open.
    expect(voted([f("DEFM14A", "2026-03-27"), f("8-K", "2026-04-24", "5.07", "2026-04-23")], "2026-02-04", null)).toBeNull();
  });

  it("with no date read, ignores a 5.07 under 20 days after the proxy once the deal has ended", () => {
    // First Horizon: annual meeting April 26 2022, four days after the proxy; the vote May 31.
    const fh = [f("PREM14A", "2022-04-12"), f("DEFM14A", "2022-04-22"), f("8-K", "2022-04-28", "5.07", "2022-04-26"), f("8-K", "2022-06-01", "5.07,8.01,9.01", "2022-05-31")];
    expect(voted(fh, "2022-02-28", "2023-05-04")).toBe("2022-05-31");
    // Hess's annual meeting, 19 days on.
    expect(voted([f("DEFM14A", "2024-04-26"), f("8-K", "2024-05-17", "5.07", "2024-05-15"), f("8-K", "2024-05-31", "5.07", "2024-05-28"), f("25-NSE", "2025-07-18")], "2023-10-23", null)).toBe("2024-05-28");
  });

  it("counts an adjourned meeting, on the day it was held", () => {
    // Nielsen's August 2022 meetings were adjourned to September 1; Anaplan's June 9 to June 21 after the raised price.
    expect(voted([f("DEFM14A", "2022-07-08"), f("8-K", "2022-09-02", "5.07,8.01,9.01", "2022-09-01"), f("25-NSE", "2022-10-11")], "2022-03-28", null, { meetingDate: "2022-08-09" })).toBe("2022-09-01");
    expect(voted([f("DEFM14A", "2022-05-02"), f("8-K", "2022-06-22", "5.07", "2022-06-21"), f("15-12G", "2022-06-22")], "2022-03-20", null, { meetingDate: "2022-06-09" })).toBe("2022-06-21");
  });

  it("is the meeting's day even when the 8-K was filed after the closing", () => {
    expect(voted([f("DEFM14A", "2022-12-20"), f("8-K", "2023-02-06", "5.07", "2023-01-31"), f("8-K", "2023-02-01", "2.01,5.01")], "2022-10-12", null, { meetingDate: "2023-01-31" })).toBe("2023-01-31");
  });

  it("is the meeting when the report date is another event in the 8-K, or a slip", () => {
    // Life Storage: filed July 18 2023, the meeting that day, an Item 1.01 from July 14 in the same 8-K.
    expect(voted([f("DEFM14A", "2023-06-01"), f("8-K", "2023-07-18", "1.01,5.07,9.01", "2023-07-14"), f("8-K", "2023-07-20", "2.01,5.01")], "2023-04-03", null, { meetingDate: "2023-07-18" })).toBe("2023-07-18");
    // Masonite: filed April 25 2024 with a report date of 2023-04-25, a year off.
    expect(voted([f("DEFM14A", "2024-03-20"), f("8-K", "2024-04-25", "5.07", "2023-04-25"), f("25-NSE", "2024-05-15")], "2024-02-09", null, { meetingDate: "2024-04-25" })).toBe("2024-04-25");
    // Metsera's and Core-Mark's: the merger's 8-K, dated a day and two days before the meeting.
    expect(voted([f("DEFM14A", "2025-10-17"), f("8-K", "2025-11-13", "2.01,3.01,5.01,5.07,9.01", "2025-11-12")], "2025-09-22", null, { meetingDate: "2025-11-13" })).toBe("2025-11-13");
    expect(voted([f("DEFM14A", "2021-07-14"), f("8-K", "2021-08-25", "5.07", "2021-08-23"), f("8-K", "2021-09-02", "2.01,5.01", "2021-09-01")], "2021-05-18", null, { meetingDate: "2021-08-25" })).toBe("2021-08-25");
  });

  it("is the meeting when the filer dated the 8-K the day it filed, the day after", () => {
    // Spirit: "was held on October 19, 2022", filed and dated October 20.
    expect(voted([f("DEFM14A", "2022-09-12"), f("8-K", "2022-10-20", "5.07", "2022-10-20")], "2022-07-28", "2024-03-04", { meetingDate: "2022-10-19" })).toBe("2022-10-19");
    // Perspecta: "On May 5, 2021, the Company held a special meeting", in its closing 8-K of May 6.
    expect(voted([f("DEFM14A", "2021-03-26"), f("8-K", "2021-05-06", "2.01,5.01,5.07", "2021-05-06"), f("25-NSE", "2021-05-06")], "2021-01-27", null, { meetingDate: "2021-05-05" })).toBe("2021-05-05");
  });

  it("is never after the closing (KnowBe4)", () => {
    expect(voted([f("DEFM14A", "2022-12-22"), f("15-12G", "2023-02-01"), f("8-K", "2023-02-06", "2.01,5.01,5.07", "2023-02-06")], "2022-10-12", null, { meetingDate: "2023-01-31" })).toBe("2023-01-31");
  });

  it("keeps a meeting adjourned by days, and the annual meetings before the merger's", () => {
    // Avidity +3, Athene +4, Senti +7, Anaplan +12: the report date is the day it was held.
    expect(voted([f("DEFM14A", "2026-01-15"), f("8-K", "2026-02-26", "5.07", "2026-02-26"), f("8-K", "2026-02-27", "2.01,5.01")], "2025-10-27", null, { meetingDate: "2026-02-23" })).toBe("2026-02-26");
    expect(voted([f("DEFM14A", "2021-11-01"), f("8-K", "2021-12-21", "5.07", "2021-12-21"), f("8-K", "2022-01-03", "2.01,5.01")], "2021-03-08", null, { meetingDate: "2021-12-17" })).toBe("2021-12-21");
    expect(voted([f("DEFM14A", "2026-09-24"), f("8-K", "2026-10-15", "5.07", "2026-10-15")], "2026-07-15", null, { meetingDate: "2026-10-08" })).toBe("2026-10-15");
    expect(voted([f("DEFM14A", "2022-05-02"), f("8-K", "2022-06-22", "5.07", "2022-06-21"), f("8-K", "2022-06-22", "2.01,5.01")], "2022-03-21", null, { meetingDate: "2022-06-09" })).toBe("2022-06-21");
    // Hess and Zendesk: the annual meeting's 8-K is filed before the merger meeting, so it is left as it is, and refused.
    expect(voted([f("DEFM14A", "2024-04-26"), f("8-K", "2024-05-17", "5.07", "2024-05-15"), f("8-K", "2024-05-31", "5.07", "2024-05-28")], "2023-10-23", null, { meetingDate: "2024-05-28" })).toBe("2024-05-28");
    expect(voted([f("DEFM14A", "2022-08-08"), f("8-K", "2022-08-17", "5.07", "2022-08-17"), f("8-K", "2022-09-19", "5.07", "2022-09-19")], "2022-06-24", null, { meetingDate: "2022-09-19" })).toBe("2022-09-19");
  });

  it("needs a DEFM14A: an information statement means written consent", () => {
    // Albertsons: "delivered to the Company a written consent"; its August 2023 5.07 was the annual meeting's.
    const m = milestonesFrom([f("PREM14C", "2022-12-02"), f("DEFM14C", "2023-04-21"), f("8-K", "2023-08-07", "5.07", "2023-08-03")], "2022-10-14", "2024-12-11");
    expect(m.voteHeld).toBeNull();
    expect(m.definitiveProxy).toBe("2023-04-21");
  });

  it("takes the proxy that called the meeting", () => {
    // KCS's July 2021 proxy was for CN's merger; CP's went out November 3, for December 10.
    const kcs = [f("DEFM14A", "2021-07-07"), f("DEFM14A", "2021-11-03"), f("8-K", "2021-12-10", "5.07", "2021-12-10"), f("25-NSE", "2021-12-14")];
    expect(milestonesFrom(kcs, "2021-03-21", null, { meetingDate: "2021-12-10" }).definitiveProxy).toBe("2021-11-03");
    // Black Knight's 2022 proxy, with its re-solicitation in 2023: the vote goes with the later one.
    const bk = [f("DEFM14A", "2022-08-19"), f("8-K", "2022-09-23", "5.07", "2022-09-21"), f("DEFM14A", "2023-02-01"), f("8-K", "2023-03-08", "5.07", "2023-03-07")];
    expect(milestonesFrom(bk, "2022-05-04", null, { meetingDate: "2023-03-07" })).toMatchObject({ definitiveProxy: "2023-02-01", voteHeld: "2023-03-07" });
  });
});

describe("a deal that ended", () => {
  const wbd = [f("SC TO-T", "2025-12-08"), f("PREM14A", "2026-01-20"), f("DEFM14A", "2026-02-17"), f("SC TO-T/A", "2026-02-28"), f("PREM14A", "2026-03-16"), f("DEFM14A", "2026-03-26"), f("8-K", "2026-04-23", "5.07", "2026-04-23"), f("8-K", "2026-10-06", "2.01,5.01")];

  it("stops at its termination: no winner's proxy, vote or closing, and a rival's tender isn't its path", () => {
    // Netflix / WBD: "we canceled the special meeting of WBD stockholders for the Netflix Merger".
    expect(milestonesFrom(wbd, "2025-12-05", "2026-02-27")).toEqual({ path: "vote", firstFiling: { form: "PREM14A", date: "2026-01-20" }, definitiveProxy: "2026-02-17", voteHeld: null, closed: null, terminated: "2026-02-27" });
  });

  it("gives the winner its own", () => {
    // Paramount / WBD: amendments of its old tender aren't a tender path.
    expect(milestonesFrom(wbd, "2026-02-27", null, { meetingDate: "2026-04-23" })).toEqual({ path: "vote", firstFiling: { form: "PREM14A", date: "2026-03-16" }, definitiveProxy: "2026-03-26", voteHeld: "2026-04-23", closed: "2026-10-06", terminated: null });
  });

  it("closes nothing with a blank date, and ignores a meeting read from the winner's proxy", () => {
    // Lockheed / Aerojet, topped by L3Harris: its own vote stands, L3Harris's Form 25 doesn't close it.
    const aj = [f("PREM14A", "2021-01-25"), f("DEFM14A", "2021-02-05"), f("8-K", "2021-03-10", "5.07", "2021-03-09"), f("DEFM14A", "2023-02-13"), f("8-K", "2023-03-16", "5.07", "2023-03-16"), f("25-NSE", "2023-07-28")];
    expect(milestonesFrom(aj, "2020-12-21", null, { ended: true, meetingDate: "2023-03-16" })).toEqual({ path: "vote", firstFiling: { form: "PREM14A", date: "2021-01-25" }, definitiveProxy: "2021-02-05", voteHeld: "2021-03-09", closed: null, terminated: null });
  });

  it("reads a dead deal's rival tender as a rival's", () => {
    // Frontier / Spirit: DEFM14A May 11 2022, JetBlue's tender May 16. JetBlue / Spirit: only that tender's amendments, then its own proxy.
    expect(milestonesFrom([f("DEFM14A", "2022-05-11"), f("SC TO-T", "2022-05-16"), f("SC 14D9", "2022-05-17")], "2022-02-07", "2022-07-27").path).toBe("vote");
    expect(milestonesFrom([f("SC TO-T/A", "2022-07-28"), f("PREM14A", "2022-08-25"), f("DEFM14A", "2022-09-12"), f("8-K", "2022-10-20", "5.07", "2022-10-19")], "2022-07-28", "2024-03-04").path).toBe("vote");
  });

  it("ends at a Closed deal's own date when no closing filing exists", () => {
    // Expro / Frank's International, October 1 2021: the 2026 proxy and vote are its later sale's.
    const franks = [f("S-4", "2021-04-26"), f("DEFM14A", "2026-04-21"), f("8-K", "2026-06-15", "5.07", "2026-06-10"), f("25-NSE", "2026-07-14")];
    expect(milestonesFrom(franks, "2021-03-11", null, { closedOn: "2021-10-01" })).toEqual({ path: null, firstFiling: { form: "S-4", date: "2021-04-26" }, definitiveProxy: null, voteHeld: null, closed: null, terminated: null });
  });
});

describe("closingFiling", () => {
  it("refuses a closing over three years after the announcement", () => {
    expect(closingFiling([f("25-NSE", "2026-07-14")], "2021-03-11")).toBeUndefined();
  });
  it("keeps the longest real ones", () => {
    // Amedisys, 780 days; Safeguard, 934.
    expect(closingFiling([f("25-NSE", "2025-08-14")], "2023-06-26")?.date).toBe("2025-08-14");
    expect(closingFiling([f("25-NSE", "2024-02-02")], "2021-07-13")?.date).toBe("2024-02-02");
  });
});

describe("closingsToRead: a target that sold out and stays listed", () => {
  it("is its Item 2.01 8-K after the vote", () => {
    // Senti: the vote October 15 2026, the 8-K October 26 (Items 1.01, 1.02, 2.01, 3.02, 9.01), no Form 25 or Item 5.01.
    const senti = [f("8-K", "2026-07-15", "1.01,2.02,5.01,7.01,8.01,9.01", "2026-07-14"), f("DEFM14A", "2026-09-24"), f("8-K", "2026-10-15", "5.07", "2026-10-15"), f("8-K", "2026-10-26", "1.01,1.02,2.01,3.02,9.01", "2026-10-21")];
    expect(closingFiling(senti, "2026-07-15")).toBeUndefined();
    expect(closingsToRead(senti, "2026-07-15").map((x) => x.date)).toEqual(["2026-10-26"]);
    expect(milestonesFrom(senti, "2026-07-15", null, { closedOn: "2026-10-21", meetingDate: "2026-10-08" })).toMatchObject({ voteHeld: "2026-10-15", closed: "2026-10-21" });
  });
  it("not its own purchase before the vote, nor an amendment after it (Sonim's DNA X)", () => {
    const sonim = [f("DEFM14A", "2025-12-05"), f("8-K", "2025-12-18", "1.01,2.01,2.03,3.02,3.03,8.01,9.01", "2025-12-15"), f("8-K", "2025-12-31", "5.07", "2025-12-30"), f("8-K", "2026-01-27", "1.01,1.02,2.01,5.03,7.01,8.01,9.01", "2026-01-23"), f("8-K/A", "2026-03-02", "2.01,9.01", "2025-12-15")];
    expect(closingsToRead(sonim, "2025-07-18").map((x) => x.date)).toEqual(["2026-01-27"]);
  });
  it("not with no vote yet: Urstadt Biddle's, Terran Orbital's and ZAGG's change-of-control 8-Ks come before their merger proxy", () => {
    // ZAGG: Item 5.01 on January 4 2021, the proxy January 21.
    expect(closingsToRead([f("8-K", "2021-01-04", "2.01,5.01"), f("PREM14A", "2021-01-07"), f("DEFM14A", "2021-01-21")], "2020-12-11")).toEqual([]);
    expect(closingsToRead([f("8-K", "2023-02-01", "2.01,5.01"), f("DEFM14A", "2023-06-01"), f("8-K", "2023-06-20", "5.07", "2023-06-20")], "2023-01-10")).toEqual([]);
  });
});

describe("the path", () => {
  const path = (filings: ReturnType<typeof f>[], announced: string, terminated: string | null = null) => milestonesFrom(filings, announced, terminated).path;
  it("keeps a tender whose proxy is the extra meeting", () => {
    // Merus and Playa: the offer, then an EGM for the back-end steps within weeks.
    expect(path([f("SC 14D9", "2025-10-21"), f("DEFM14A", "2025-11-12"), f("8-K", "2025-12-09", "5.07", "2025-12-09"), f("8-K", "2025-12-12", "2.01,5.01")], "2025-09-29")).toBe("tender");
    expect(path([f("SC 14D9", "2025-02-24"), f("DEFM14A", "2025-03-21"), f("8-K", "2025-06-16", "2.01,5.01")], "2025-02-10")).toBe("tender");
  });
  it("keeps a tender after a proxy nothing was voted on", () => {
    // Squarespace, moved to a tender offer in September 2024.
    expect(path([f("PREM14A", "2024-06-17"), f("DEFM14A", "2024-08-22"), f("SC TO-T", "2024-09-16"), f("SC 14D9", "2024-09-30"), f("25-NSE", "2024-10-17")], "2024-05-13")).toBe("tender");
  });
  it("reads a tender launched before the announcement from its amendments alone", () => {
    // Beacon: QXO's offer began in January 2025; the agreement came in March.
    expect(path([f("SC TO-T/A", "2025-03-21"), f("25-NSE", "2025-04-29")], "2025-03-20")).toBe("tender");
  });
  it("stops at a tender's closing: a later proxy isn't the deal's", () => {
    // Dawson: Wilks's tender closed in January 2022; the February proxy was for another transaction.
    const m = milestonesFrom([f("SC 14D9", "2021-11-01"), f("8-K", "2022-01-18", "2.01,5.01"), f("DEFM14A", "2022-02-22"), f("8-K", "2022-03-16", "5.07"), f("10-Q", "2022-05-10")], "2021-10-25", null);
    expect(m).toMatchObject({ path: "tender", closed: "2022-01-18", definitiveProxy: null, voteHeld: null });
  });
  it("reads a merger voted on, after a tender long before, as a vote", () => {
    expect(path([f("SC TO-T", "2021-01-05"), f("DEFM14A", "2021-04-01"), f("8-K", "2021-05-11", "5.07", "2021-05-11")], "2021-01-02")).toBe("vote");
  });
});

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

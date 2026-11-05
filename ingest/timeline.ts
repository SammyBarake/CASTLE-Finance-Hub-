/**
 * Deal milestones from the target's filing index: when the proxy / tender documents were filed,
 * when the definitive proxy went out, and when the deal closed or ended. Pure (no requests).
 */
import type { DealMilestones } from "../lib/types";

export interface FilingRef {
  form: string;
  date: string;
  items: string;
  /** The 8-K's "date of earliest event reported" (`reportDate` in EDGAR's submissions): a vote's 8-K, the meeting's day. */
  reportDate?: string;
}

const TENDER = /^(SC 14D9|SC14D9|SC TO-T)(\/A)?$/;
const VOTE = /^(PREM14A|DEFM14A|PREM14C|DEFM14C)(\/A)?$/;
const FIRST = /^(PREM14A|DEFM14A|PREM14C|DEFM14C|SC 14D9|SC14D9|SC TO-T|S-4|F-4)$/;
const CLOSED = /^(?:25-NSE|25|15-12B|15-12G|15-15D)(?:\/A)?$/;

const PERIODIC = /^(10-K|10-Q|20-F|40-F)(\/A)?$/;

const addDays = (date: string, n: number) => new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The target's filings that can belong to this deal: on or after its announcement and, once it has ended, on or before
 * that. A target's index runs on after a deal: a losing bid took the winner's proxy, opinions and vote (Netflix / WBD,
 * Zendesk / Momentive, 26 proxies on 53 records), and a 2022 buyer the 2026 buyer's (LKCM on Lawson Products). A blank
 * end date (a topped deal, Lockheed / Aerojet) can't be bounded here: tidy clears what it took.
 */
export function ownFilings<T extends { date: string }>(filings: T[], deal: { announcedDate: string; status: string; statusDate?: string | null }): T[] {
  const end = deal.status === "Closed" || deal.status === "Terminated" ? deal.statusDate : null;
  return filings.filter((f) => f.date >= deal.announcedDate && (!end || f.date <= end));
}

/**
 * A delisting / deregistration or change-of-control filing that really marks the closing: an
 * acquired company stops filing periodic reports. Banks and REITs file Form 25 to delist a single
 * preferred series and keep reporting, so a 10-Q / 10-K more than 60 days later rules it out.
 */
export function isClosingFiling(filings: FilingRef[], f: FilingRef): boolean {
  const eightK = /^8-K/.test(f.form);
  if (!(CLOSED.test(f.form) || (eightK && /\b5\.01\b/.test(f.items)))) return false;
  // The company's own merger proxy or tender comes later: this delisted one preferred series, or a change of control short of the merger (Urstadt Biddle, Terran Orbital, ZAGG). An 8-K Item 2.01 always counts (Dawson's tender closed; Bally's, Athene).
  const within = addDays(f.date, 400);
  if (!/\b2\.01\b/.test(f.items) && filings.some((g) => /^(?:PREM14[AC]|DEFM14[AC]|SC 14D9|SC14D9|SC TO-T)$/.test(g.form) && g.date > f.date && g.date <= within)) return false;
  const limit = addDays(f.date, 60);
  if (!filings.some((g) => PERIODIC.test(g.form) && g.date > limit)) return true;
  // Still reporting afterwards for its bonds or preferred shares (Athene, Continental Resources, STORE Capital, Triton):
  // a closing when the filings agree. One 8-K reports the merger's completion and the change of control (Item 2.01 and
  // 5.01), or the common stock's delisting (Form 25) comes within days of an 8-K reporting either. A Form 25 for one
  // preferred series comes with an 8-K Item 3.01 only (II-VI, 2023).
  if (eightK) return /\b2\.01\b/.test(f.items) || filings.some((g) => /^25(?:-NSE)?$/.test(g.form) && near(g, f));
  return /^25(?:-NSE)?$/.test(f.form) && filings.some((g) => /^8-K/.test(g.form) && /\b(?:2\.01|5\.01)\b/.test(g.items) && near(g, f));
}

const near = (a: FilingRef, b: FilingRef) => Math.abs(Date.parse(a.date) - Date.parse(b.date)) <= 5 * 86_400_000;

/**
 * The first closing filing from `after` (the target's filings from the announcement on, oldest first). Not one over three
 * years on: a target that survives under a new name files its own sale later (Frank's International became Expro Group in
 * 2021, delisted in 2026). The longest real closings on record are about 780 and 934 days (Amedisys, Safeguard).
 */
export function closingFiling<T extends FilingRef>(after: T[], announcedDate: string): T | undefined {
  const latest = addDays(announcedDate, 3 * 365);
  return after.find((f) => f.date <= latest && isClosingFiling(after, f));
}

/**
 * The target's Item 2.01 8-Ks after the deal's vote, to read when no filing here marks a closing (`completedSigningOn`): a company that sells its business
 * and stays listed files no Form 25 or Item 5.01 (Senti, October 2026; Sonim, January 2026). Never one before the vote: a target's own purchase between
 * signing and closing (Sonim's, December 2025), and Urstadt Biddle's, Terran Orbital's and ZAGG's change-of-control 8-Ks come before their merger proxy.
 */
export function closingsToRead<T extends FilingRef>(after: T[], announcedDate: string): T[] {
  const proxy = after.find((f) => f.form === "DEFM14A");
  const vote = proxy && after.find((f) => /^8-K/.test(f.form) && /\b5\.07\b/.test(f.items) && f.date > proxy.date);
  if (!vote) return [];
  const latest = addDays(announcedDate, 3 * 365);
  return after.filter((f) => f.form === "8-K" && /\b2\.01\b/.test(f.items) && f.date >= vote.date && f.date <= latest).slice(0, 2);
}

const inDealItem201 = (after: FilingRef[], closedOn: string) => after.some((f) => /^8-K/.test(f.form) && /\b2\.01\b/.test(f.items) && f.date >= closedOn && f.date <= addDays(closedOn, 10));

/**
 * The meeting's day from a vote's 8-K. EDGAR's report date is the 8-K's earliest event, usually the meeting, but it can be something else in the same 8-K, or
 * a slip: Life Storage's 8-K of July 18 2023 also reports an Item 1.01 from July 14, and Masonite's of April 25 2024 says 2023-04-25. Before the meeting the
 * proxy calls, with the filing from that day to ten days on: the meeting. A report date that is the filing day and the day after the meeting is the filer
 * dating it when it filed (Spirit's vote of October 19 2022, Perspecta's of May 5 2021 in its closing 8-K). Not one further on: an adjourned meeting
 * (Avidity's, three days; Athene's, four; Senti's, seven; Anaplan's, twelve), and not a report date before the meeting with its 8-K filed before it too: that
 * is another meeting's (Hess's, First Horizon's and Zendesk's annual meetings). And no vote comes after the closing: KnowBe4's 8-K of February 6 2023 is dated
 * that day, five days after it closed, for the meeting of January 31.
 */
function voteDay(f: FilingRef, meeting: string | null, end: string | null): string {
  const reported = f.reportDate || f.date;
  if (!meeting) return reported;
  if (reported < meeting && f.date >= meeting && f.date <= addDays(meeting, 10)) return meeting;
  if (reported === addDays(meeting, 1) && reported === f.date) return meeting;
  if (end && reported > end && meeting <= end && f.date <= addDays(meeting, 10)) return meeting;
  return reported;
}

/**
 * `terminated` is passed in because deciding it needs the 8-K text (an Item 1.02 can end any
 * material agreement, not just the merger agreement). `ended`: the deal is over though no date is known (a topped deal);
 * `closedOn`: a Closed deal's date when the index has no closing filing; `meetingDate`: what the definitive proxy calls.
 */
export function milestonesFrom(
  filings: FilingRef[],
  announcedDate: string,
  terminated: string | null,
  opts: { ended?: boolean; closedOn?: string | null; meetingDate?: string | null } = {},
): DealMilestones {
  const after = filings.filter((f) => f.date >= announcedDate).sort((a, b) => a.date.localeCompare(b.date));
  // A deal ended with no date closed nothing: the target's closing filings are the winner's (Lockheed / Aerojet took L3Harris's Form 25).
  const closedFiling = terminated || opts.ended ? undefined : closingFiling(after, announcedDate);
  const end = terminated ?? closedFiling?.date ?? opts.closedOn ?? null;
  const inDeal = end ? after.filter((f) => f.date <= end) : after;
  // With no end date, a meeting read from the index's newest proxy is the winner's.
  const meeting = opts.ended && !terminated ? null : (opts.meetingDate ?? null);
  // The last proxy before the meeting it calls, else the first (KCS's July 2021 proxy was for CN's merger; CP's went out in November).
  const defs = inDeal.filter((f) => /^DEFM14[AC]$/.test(f.form));
  const proxy = meeting ? (defs.filter((f) => f.date <= meeting).at(-1) ?? defs[0]) : defs[0];
  // Item 5.07 = "Submission of Matters to a Vote of Security Holders", and an annual meeting files one too. An information
  // statement (DEFM14C) means holders approved by written consent: no meeting (Albertsons' 5.07 was its annual meeting's).
  // Not before the meeting the proxy calls, adjourned ones after it counting (Hess's annual meeting on May 15 2024, its
  // merger vote on May 28; Nielsen's adjourned to September 1 2022). A merger vote needs 20 days' notice, so with no date read
  // one sooner is the annual meeting (First Horizon's, six days after the proxy). And with no date on an open deal the vote
  // stays in doubt: the page would say "Approved by shareholders" (Synaptics' annual meeting, its merger vote still to come).
  const notBefore = proxy?.form !== "DEFM14A" ? null : (meeting ?? addDays(proxy.date, 20));
  const vote =
    notBefore && (meeting || end || opts.ended)
      ? after.find((f) => /^8-K/.test(f.form) && /\b5\.07\b/.test(f.items) && voteDay(f, meeting, end) >= notBefore && (!end || voteDay(f, meeting, end) <= end))
      : undefined;
  // Originals only: a rival's offer amended after the signing is no offer in this deal (Paramount's, at WBD's merger with it).
  // A tender first with its proxy soon after is the deal's path (Dutch offers' meeting: Merus, Playa), and so is one after
  // a proxy nothing was voted on (Squarespace). Not in a deal that died with a proxy on file: that tender was a rival's
  // (Paramount's at Netflix / WBD, 43 days before WBD's proxy; JetBlue's at Frontier / Spirit).
  const tender = inDeal.find((f) => /^(SC 14D9|SC14D9|SC TO-T)$/.test(f.form));
  const voteForm = inDeal.find((f) => VOTE.test(f.form));
  const soon = !!tender && !!voteForm && tender.date <= voteForm.date && Date.parse(voteForm.date) - Date.parse(tender.date) <= 45 * 86_400_000;
  const dead = !!terminated || !!opts.ended;
  const path = tender && (!voteForm || (!dead && (soon || (tender.date > voteForm.date && !vote)))) ? "tender" : voteForm ? "vote" : inDeal.some((f) => TENDER.test(f.form)) ? "tender" : null;
  // On a vote, a tender form isn't this deal's first filing either.
  const first = inDeal.find((f) => FIRST.test(f.form) && (path !== "vote" || !TENDER.test(f.form)));
  return {
    path,
    firstFiling: first ? { form: first.form, date: first.date } : null,
    definitiveProxy: proxy?.date ?? null,
    // The meeting's day (the 8-K's report date), not when the 8-K was filed.
    voteHeld: vote ? voteDay(vote, meeting, end) : null,
    // (A closing only an 8-K's words give, Senti's: its stated day, when an Item 2.01 8-K follows within ten days. Without it the page shows the deal as open.)
    closed: closedFiling?.date ?? (!dead && opts.closedOn && inDealItem201(after, opts.closedOn) ? opts.closedOn : null),
    terminated,
  };
}

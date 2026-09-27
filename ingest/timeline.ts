/**
 * Deal milestones from the target's filing index: when the proxy / tender documents were filed,
 * when the definitive proxy went out, and when the deal closed or ended. Pure (no requests).
 */
import type { DealMilestones } from "../lib/types";

export interface FilingRef {
  form: string;
  date: string;
  items: string;
}

const TENDER = /^(SC 14D9|SC14D9|SC TO-T)(\/A)?$/;
const VOTE = /^(PREM14A|DEFM14A|PREM14C|DEFM14C)(\/A)?$/;
const FIRST = /^(PREM14A|DEFM14A|PREM14C|DEFM14C|SC 14D9|SC14D9|SC TO-T|S-4|F-4)$/;
const CLOSED = /^(25-NSE|25|15-12B|15-12G|15-15D)$/;

const PERIODIC = /^(10-K|10-Q|20-F|40-F)(\/A)?$/;

/**
 * A delisting / deregistration or change-of-control filing that really marks the closing: an
 * acquired company stops filing periodic reports. Banks and REITs file Form 25 to delist a single
 * preferred series and keep reporting, so a 10-Q / 10-K more than 60 days later rules it out.
 */
export function isClosingFiling(filings: FilingRef[], f: FilingRef): boolean {
  if (!(CLOSED.test(f.form) || (/^8-K/.test(f.form) && /\b5\.01\b/.test(f.items)))) return false;
  const limit = new Date(Date.parse(f.date) + 60 * 86_400_000).toISOString().slice(0, 10);
  return !filings.some((g) => PERIODIC.test(g.form) && g.date > limit);
}

/**
 * `terminated` is passed in because deciding it needs the 8-K text (an Item 1.02 can end any
 * material agreement, not just the merger agreement).
 */
export function milestonesFrom(filings: FilingRef[], announcedDate: string, terminated: string | null): DealMilestones {
  const after = filings.filter((f) => f.date >= announcedDate).sort((a, b) => a.date.localeCompare(b.date));
  const first = after.find((f) => FIRST.test(f.form));
  const closedFiling = terminated ? undefined : after.find((f) => isClosingFiling(filings, f));
  const definitiveProxy = after.find((f) => /^DEFM14[AC]$/.test(f.form))?.date ?? null;
  return {
    path: after.some((f) => TENDER.test(f.form)) ? "tender" : after.some((f) => VOTE.test(f.form)) ? "vote" : null,
    firstFiling: first ? { form: first.form, date: first.date } : null,
    definitiveProxy,
    // Item 5.07 = "Submission of Matters to a Vote of Security Holders": the special meeting's results.
    voteHeld: definitiveProxy ? (after.find((f) => f.date > definitiveProxy && /^8-K/.test(f.form) && /\b5\.07\b/.test(f.items))?.date ?? null) : null,
    closed: closedFiling?.date ?? null,
    terminated,
  };
}

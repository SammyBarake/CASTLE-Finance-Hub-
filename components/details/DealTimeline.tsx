"use client";

import { formatDateLong } from "@/lib/format";
import { daysBetween, months } from "@/lib/timelines";
import type { Deal } from "@/lib/types";

interface Step {
  label: string;
  date: string | null;
  state: "done" | "current" | "todo" | "failed";
  note?: string;
}

/** Announced → proxy / tender → definitive proxy → closed, with the days between steps. */
export function DealTimeline({ deal, asOf }: { deal: Deal; asOf: string }) {
  const m = deal.milestones;
  if (!m) return null;
  const tender = m.path === "tender";
  const ended = m.closed ?? m.terminated;
  const steps: Step[] = [{ label: "Announced", date: deal.announcedDate, state: "done" }];
  steps.push({
    label: tender ? "Tender offer launched" : m.firstFiling?.form.startsWith("S-4") || m.firstFiling?.form.startsWith("F-4") ? "Registration filed" : "Proxy filed",
    date: m.firstFiling?.date ?? null,
    state: m.firstFiling ? "done" : ended ? "todo" : "current",
  });
  if (!tender) {
    steps.push({ label: "Proxy mailed to shareholders", date: m.definitiveProxy, state: m.definitiveProxy ? "done" : m.firstFiling && !ended ? "current" : "todo" });
    steps.push({ label: "Shareholders voted", date: m.voteHeld ?? null, state: m.voteHeld ? "done" : "todo" });
  }
  if (m.terminated) steps.push({ label: "Terminated", date: m.terminated, state: "failed" });
  else steps.push({ label: "Closed", date: m.closed, state: m.closed ? "done" : "todo" });

  // Mark the first unfinished step as current while the deal is live.
  if (!ended) {
    const firstTodo = steps.findIndex((s) => s.state === "todo" || s.state === "current");
    steps.forEach((s, i) => {
      if (s.state === "current" && i !== firstTodo) s.state = "todo";
    });
    if (firstTodo >= 0) steps[firstTodo].state = "current";
  }

  const total = daysBetween(deal.announcedDate, ended ?? asOf);
  const summary = m.closed
    ? `Closed in ${months(total)}`
    : m.terminated
      ? `Ended after ${months(total)}`
      : m.voteHeld
        ? `Approved by shareholders · waiting on regulators / closing conditions`
        : `${months(total)} since announcement`;

  let prev = deal.announcedDate;
  return (
    <div className="deal-timeline" aria-label="Deal timeline">
      <div className="deal-timeline-head">
        <span>Timeline</span>
        <b>{summary}</b>
      </div>
      <ol>
        {steps.map((s, i) => {
          const gap = s.date && i > 0 ? daysBetween(prev, s.date) : null;
          if (s.date) prev = s.date;
          return (
            <li key={s.label} className={`step-${s.state}`}>
              <span className="deal-timeline-dot" aria-hidden="true" />
              <span className="deal-timeline-label">{s.label}</span>
              <span className="deal-timeline-date">
                {s.date ? formatDateLong(s.date) : s.state === "current" ? "In progress" : "—"}
                {gap != null && <small> · +{gap}d</small>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

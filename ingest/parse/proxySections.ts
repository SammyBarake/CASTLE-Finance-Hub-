/**
 * Jump links into a merger proxy: the table of contents' links to the sections people read first (the background
 * story, the board's reasons, each bank's opinion, the projections, financing, fees). A 300-page proxy is easier with
 * them, and they cost nothing: the links are already in the document.
 *
 * Pure. Only anchors the document actually defines are kept; a proxy without a linked table of contents gets none.
 */
import type { ProxySection } from "../../lib/types";
import { decodeEntities, flatten } from "../text";
import { titleCaseCaps } from "./names";

/** Sections in reading order. `many` keeps every match (one opinion per bank); otherwise the last link wins. */
const SECTIONS: { label: string | null; re: RegExp; many?: boolean }[] = [
  { label: "Background", re: /^Background of the (?:Mergers?|Offer|Transactions?|Proposed Merger|Business Combination)\b/i },
  { label: "Board's reasons", re: /\bReasons for the (?:Mergers?|Offer|Transactions?|Recommendation)\b/i },
  // "Opinion of Goldman Sachs & Co. LLC", "Opinion of the Company's Financial Advisor": the label is the heading itself.
  { label: null, re: /^Opinions? of (?!Counsel|Tax)[\w&.,'’() -]{2,80}$/i, many: true },
  { label: "Projections", re: /\b(?:Projections|Forecasts|Prospective Financial Information)\b/i },
  { label: "Insiders' interests", re: /^Interests of (?:the )?[\w’' ]{0,40}?(?:Directors|Executive Officers)\b/i },
  { label: "Financing", re: /^Financing(?: of the (?:Mergers?|Offer|Transactions?))?$/i },
  { label: "Regulatory approvals", re: /^(?:Required )?Regulatory Approvals?\b/i },
  { label: "Termination fees", re: /^(?:Termination Fees?|Expenses and Termination Fees?|Termination Fees? and Expenses)\b/i },
  { label: "Appraisal rights", re: /^(?:Appraisal|Dissenters['’]?) Rights\b/i },
];

/** At most this many bank opinions. */
const MAX_OPINIONS = 3;

export function proxySections(html: string, docUrl: string): ProxySection[] {
  const defined = new Set<string>();
  for (const m of html.matchAll(/\b(?:id|name)\s*=\s*["']?([^"'\s>]+)/gi)) defined.add(m[1]);
  const found = new Map<number, { label: string; url: string }[]>();
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']#([^"']+)["'][^>]*>([\s\S]{1,400}?)<\/a>/gi)) {
    const id = m[1];
    if (!defined.has(id)) continue;
    const plain = (h: string) => flatten(decodeEntities(h.replace(/<[^>]+>/g, " ")));
    let text = plain(m[2]);
    // The link is often on the page number: "<td>Background of the Merger</td><td><a href="#x">45</a></td>". Use the row.
    if (/^(?:\d+|[ivxlc]+)$/i.test(text)) {
      const row = html.lastIndexOf("<tr", m.index!);
      if (row < 0 || m.index! - row > 3000) continue;
      text = plain(html.slice(row, m.index!));
    }
    text = text.replace(/\s*\(see page[^)]*\)/i, "").replace(/[\s.·…]+\d*$/, "").replace(/^\d+(?:\.\d+)*\s+/, "");
    // The annexes come last, and the merger agreement's own contents reuse these headings ("Termination Fee",
    // "Appraisal Rights"): stop there. (Some contents list the annexes first.)
    if (/^(?:Annex|Appendix)\b/i.test(text) && found.size) break;
    if (text.length < 6 || text.length > 110) continue;
    const i = SECTIONS.findIndex((s) => s.re.test(text));
    if (i < 0) continue;
    const s = SECTIONS[i];
    const entry = { label: s.label ?? opinionLabel(text), url: `${docUrl}#${id}` };
    const list = found.get(i) ?? [];
    if (s.many) {
      // The summary and the body both link an opinion: keep the later (fuller) one per heading.
      const same = list.findIndex((e) => e.label === entry.label);
      if (same >= 0) list[same] = entry;
      else list.push(entry);
    } else list.splice(0, list.length, entry); // the last link: the body, after the summary
    found.set(i, list);
  }
  return [...found.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([i, list]) => {
      if (!SECTIONS[i].many) return list;
      // "Opinions of Coherent's Financial Advisors" heads the banks' own sections: keep those when there are any.
      const single = list.filter((e) => !/^Opinions\b/.test(e.label));
      return (single.length ? single : list).slice(0, MAX_OPINIONS);
    });
}

/** "OPINION OF QATALYST PARTNERS LP, SYNAPTICS' FINANCIAL ADVISOR" → "Opinion of Qatalyst Partners". */
export function opinionLabel(heading: string): string {
  let s = heading.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  if (s === s.toUpperCase()) s = titleCaseCaps(s).replace(/\b(To|The|Of|And)\b/g, (w, _x, at) => (at === 0 ? w : w.toLowerCase()));
  // What follows a comma is a description or a date ("…, dated as of March 9", "…, Synaptics' Financial Advisor"), unless
  // it is the name going on ("Keefe, Bruyette & Woods").
  s = s.replace(/,\s+(?:dated|the|[A-Z][\w.&’'-]*(?:\s[A-Z][\w.&’'-]*)*[’']s?\s+(?:[Ee]xclusive\s+)?[Ff]inancial [Aa]dvisors?)\b.*$/, "");
  for (let i = 0; i < 2; i++) s = s.replace(/,?\s+(?:LLC|L\.L\.C\.?|LP|L\.P\.|Inc\.?|Incorporated|& Co\.?|and Company)$/i, "").replace(/[.,;:]+$/, "");
  return s;
}

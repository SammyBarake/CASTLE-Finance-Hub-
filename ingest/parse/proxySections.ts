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
  { label: null, re: /^Opinions? of (?!Counsel|Tax)[\wÀ-ɏ&.,'’()–— -]{2,110}$/i, many: true },
  { label: "Projections", re: /\b(?:Projections|Forecasts|Prospective Financial Information)\b/i },
  { label: "Insiders' interests", re: /^Interests of (?:the )?[\w’' ]{0,40}?(?:Directors|Executive Officers)\b/i },
  { label: "Financing", re: /^Financing(?: of the (?:Mergers?|Offer|Transactions?))?$/i },
  { label: "Regulatory approvals", re: /^(?:Required )?Regulatory Approvals?\b/i },
  { label: "Termination fees", re: /^(?:Termination Fees?|Expenses and Termination Fees?|Termination Fees? and Expenses)\b/i },
  { label: "Appraisal rights", re: /^(?:Appraisal|Dissenters['’]?) Rights\b/i },
];

/** At most this many bank opinions. */
const MAX_OPINIONS = 3;

const plain = (h: string) => flatten(decodeEntities(h.replace(/<[^>]+>/g, " ")));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ZERO_WIDTH = new RegExp(String.fromCharCode(0x200b), "g");

export function proxySections(html: string, docUrl: string): ProxySection[] {
  const defined = new Map<string, number>();
  for (const m of html.matchAll(/\b(?:id|name)\s*=\s*["']?([^"'\s>]+)/gi)) if (!defined.has(m[1])) defined.set(m[1], m.index!);
  const found = new Map<number, { label: string; url: string; heading: string }[]>();
  const letters: { label: string; url: string; heading: string }[] = [];
  let matched = false;
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']#([^"']+)["'][^>]*>([\s\S]{1,400}?)<\/a>/gi)) {
    const id = m[1];
    if (!defined.has(id)) continue;
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
    if (/^(?:Annex|Appendix)\b/i.test(text) && matched) break;
    if (text.length < 6 || text.length > 110) continue;
    const i = SECTIONS.findIndex((s) => s.re.test(text));
    if (i < 0) continue;
    matched = true;
    const s = SECTIONS[i];
    // Not every contents says "Annex" first, and the last link wins: a link that lands on an agreement's numbered section
    // ("Section 4.4 Financing", "Section 8.3 Termination Fees": Proofpoint; "Section 5.12. Financing": VMware) is no section
    // of the proxy, nor is one whose page holds it (Xilinx's page-level anchor before "Section 3.21 Opinion of Financial Advisor").
    const at = defined.get(id)!;
    const landing = plain(html.slice(at, at + 1500).replace(/^[^>]*>/, "")).replace(ZERO_WIDTH, "").trimStart();
    if (/^(?:Section\s+)?\d+\.\d+\b/i.test(landing)) continue;
    // (Not an amount running into the heading: "$0.001 Recommendation of the Board": Atrion.)
    const numbered = new RegExp(`(?<![$\\d.,])(?:Section\\s+)?\\d+\\.\\d+\\.?\\s*${escapeRe(text.replace(ZERO_WIDTH, "").trimEnd().slice(0, 40))}`, "i");
    if (numbered.test(plain(html.slice(at, at + 12_000)).replace(ZERO_WIDTH, ""))) continue;
    // A bank's letter in an annex stands in only when the contents links no opinion section (Nuvalent, 1st Constitution). Webster's
    // "Opinion of …" landed on "Annex D February 3, 2026"; William Penn's on a letter with its annex heading on the page before.
    // (Not a page of the body that happens to open on "Exhibit A to the Merger Agreement": Atrion.)
    if (/^(?:Annex|ANNEX|Exhibit|EXHIBIT|Appendix|APPENDIX)\s+[A-Z0-9]{1,4}\b(?!\s+(?:to|of|and|hereto)\b)|^[A-Z][a-z]+ \d{1,2}, 20\d\d (?:The )?Board of Directors\b/.test(landing)) {
      if (s.many) letters.push({ label: opinionLabel(text), url: `${docUrl}#${id}`, heading: text });
      continue;
    }
    const entry = { label: s.label ?? opinionLabel(text), url: `${docUrl}#${id}`, heading: text };
    const list = found.get(i) ?? [];
    if (s.many) {
      // The summary and the body both link an opinion: keep the later (fuller) one per heading ("Opinion of Lazard Fr", cut at its accent, is Opiant's "Lazard Frères").
      const same = list.findIndex((e) => e.label === entry.label || entry.label.startsWith(e.label));
      if (same >= 0) list[same] = entry;
      else list.push(entry);
    } else if (!(s.label === "Board's reasons" && list[0] && /Recommend/i.test(list[0].heading) && !/Recommend/i.test(text) && /^[\w&.\- ]{2,40}?(?:['’]s?\s+)?(?:Purpose|Reasons)\b/i.test(text))) {
      // The last link: the body, after the summary. Not a joint proxy's buyer replacing the board that recommends to the
      // target's holders ("Santander's Reasons for the Transaction", "ExxonMobil's Reasons for the Merger").
      list.splice(0, list.length, entry);
    }
    found.set(i, list);
  }
  const opinions = SECTIONS.findIndex((x) => x.many);
  if (letters.length && !found.get(opinions)?.length) found.set(opinions, letters);
  return [...found.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([i, list]) => {
      if (!SECTIONS[i].many) return list;
      // "Opinions of Coherent's Financial Advisors" heads the banks' own sections: keep those when there are any. Only a named
      // bank's section stands in for it: "Opinion of QXO's Financial Advisor" says nothing of "Opinions of TopBuild's Financial Advisors".
      const named = list.some((e) => /^Opinion\b/.test(e.label) && !/Financial Advisor/i.test(e.label));
      // A heading that names no one ("Opinions of Financial Advisors") only goes when something more exact is there.
      const exact = list.filter((e) => !/^Opinions? of (?:the )?Financial Advisors?$/i.test(e.label));
      const single = named ? list.filter((e) => !/^Opinions\b/.test(e.label)) : exact.length ? exact : list;
      return (single.length ? single : list).slice(0, MAX_OPINIONS);
    })
    .map(({ label, url }) => ({ label, url }));
}

/** "OPINION OF QATALYST PARTNERS LP, SYNAPTICS' FINANCIAL ADVISOR" → "Opinion of Qatalyst Partners". */
export function opinionLabel(heading: string): string {
  // "Opinions of TopBuild's Financial Advisors – Opinion of Goldman Sachs" is the second part.
  let s = heading.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim().replace(/^Opinions? of .*?\s[–—]\s*(Opinion of .+)$/i, "$1");
  // One spelling for the summary's link and the body's ("Advisor—J.P. Morgan", "Advisor — J.P. Morgan"), and an accent the markup split ("Lazard Fr è res").
  s = s.replace(/\s*[–—]\s*/g, " – ").replace(/ ([À-ɏ]) /g, "$1");
  if (s === s.toUpperCase()) s = titleCaseCaps(s).replace(/\b(To|The|Of|And)\b/g, (w, _x, at) => (at === 0 ? w : w.toLowerCase()));
  // What follows a comma is a description or a date ("…, dated as of March 9", "…, Synaptics' Financial Advisor"), unless
  // it is the name going on ("Keefe, Bruyette & Woods").
  s = s.replace(/,\s+(?:dated|the|[A-Z][\w.&’'-]*(?:\s[A-Z][\w.&’'-]*)*[’']s?\s+(?:[Ee]xclusive\s+)?[Ff]inancial [Aa]dvisors?)\b.*$/, "");
  for (let i = 0; i < 2; i++) s = s.replace(/,?\s+(?:LLC|L\.L\.C\.?|LP|L\.P\.|Inc\.?|Incorporated|& Co\.?|and Company)$/i, "").replace(/[.,;:]+$/, "");
  return s;
}

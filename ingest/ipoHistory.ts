/**
 * Priced IPOs since 2015, from final prospectuses (424B4). Each 424B4 is kept only if it is the company's IPO:
 * no periodic report or earlier 424B4 before it, an S-1 / F-1 on file, not a SPAC or fund, not a resale or direct
 * listing, not a company that came public through a SPAC merger. The same tests as the live pipeline (ingest/ipos.ts).
 */
import { archiveUrl, filingsUntil, fullTextSearch, getSubmissions, getText, nameOn, NotFoundError, trimCik, type Submissions } from "./edgar";
import { monthWindows } from "./deals";
import { EXCLUDED_SIC, FINAL_PROSPECTUS, FUNDLIKE, LISTING_SIC, listsOnExchange, MIN_RAISE, publicWithin } from "./ipos";
import { normalizeName } from "./parse/names";
import { isResaleOnly, isSecondStepConversion, parseFinalProspectus, prospectusDate } from "./parse/ipo";
import { displayName } from "./parse/press";
import { sectorForSic } from "./sectors";
import { htmlToText } from "./text";
import type { Company, Sector } from "../lib/types";

export interface IpoHistoryRecord {
  /** "ipo-<cik>-<pricedDate>" */
  id: string;
  /** Name as of pricing; ticker as SEC lists it today. */
  company: Company;
  sector: Sector;
  industry: string | null;
  /** Pricing date: the date on the final prospectus cover, else the 424B4 filing date. */
  pricedDate: string;
  /** The 424B4's filing date (usually a day or two after pricing). */
  filedDate: string;
  offerPrice: number | null;
  sharesOffered: number | null;
  /** Offer price × shares on the cover (base deal, before any over-allotment). */
  raiseUsd: number | null;
  underwriters: string[];
  url: string;
}

type Row = { adsh: string; date: string; form: string; primaryDocument: string; items: string };

/** Is the 424B4 filed on `date` this company's IPO? (Filings newest first, up to `date`.) */
export function isIpoProspectus(filings: Row[], date: string, adsh: string): boolean {
  const before = filings.filter((f) => f.date < date || (f.date === date && f.adsh !== adsh && !FINAL_PROSPECTUS.test(f.form)));
  if (publicWithin(before, date)) return false;
  const registered = before.some((f) => /^(?:S-1|F-1|S-11)(?:\/A)?$/.test(f.form) && (Date.parse(date) - Date.parse(f.date)) / 86_400_000 <= 1100);
  // Came public through a SPAC merger: a merger registration and the 8-K that ends shell status.
  const deSpac = before.some((f) => /^(?:S-4|F-4)(?:\/A)?$/.test(f.form)) && before.some((f) => /^8-K/.test(f.form) && /\b5\.06\b/.test(f.items));
  return registered && !deSpac;
}

/** IPO history plus the 424B4s already looked at (so a re-run only reads new ones). */
export interface IpoHistoryState {
  records: IpoHistoryRecord[];
  checked: string[];
}

export async function backfillIpoHistory(
  from: string,
  to: string,
  state: IpoHistoryState,
  log: (s: string) => void,
  checkpoint?: (state: IpoHistoryState) => Promise<void>,
): Promise<IpoHistoryState> {
  const byId = new Map(state.records.map((r) => [r.id, r]));
  const checked = new Set([...state.checked, ...state.records.map((r) => r.url)]);
  const snapshot = (): IpoHistoryState => ({ records: [...byId.values()].sort((a, b) => a.pricedDate.localeCompare(b.pricedDate)), checked: [...checked] });
  const subs = new Map<string, Submissions | null>();
  const submissions = async (cik: string) => {
    if (!subs.has(cik)) subs.set(cik, await getSubmissions(cik).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e))));
    return subs.get(cik)!;
  };
  let candidates = 0;
  for (const [start, end] of monthWindows(from, to)) {
    // 424B1 is a final pricing prospectus too (Grupo Aeroméxico), roughly one for every five to fifteen 424B4s.
    const hits = (await fullTextSearch({ q: "", forms: ["424B4", "424B1"], from: start, to: end })).filter(
      (h) => FINAL_PROSPECTUS.test(h.fileType) && !h.sics.some((s) => EXCLUDED_SIC.has(s)) && !FUNDLIKE.test(h.displayNames[0] ?? ""),
    );
    let added = 0;
    for (const h of hits) {
      const cik = trimCik(h.ciks[0]);
      const url = archiveUrl(cik, h.adsh, h.file);
      if (checked.has(url)) continue;
      checked.add(url);
      candidates++;
      try {
        const sub = await submissions(cik);
        if (!sub || EXCLUDED_SIC.has(sub.sic) || FUNDLIKE.test(sub.name)) continue;
        const filings = await filingsUntil(sub, h.fileDate);
        if (!isIpoProspectus(filings, h.fileDate, h.adsh)) continue;
        const text = htmlToText(await getText(url)); // whole: the underwriting table is near the end
        const terms = parseFinalProspectus(text);
        const own = ` ${normalizeName(sub.name)} `;
        const underwriters = terms.underwriters.filter((u) => !own.includes(` ${normalizeName(u)} `));
        if (isResaleOnly(text, underwriters) || isSecondStepConversion(text)) continue;
        if ((LISTING_SIC.has(sub.sic) || h.sics.some((s) => LISTING_SIC.has(s))) && !listsOnExchange(text)) continue;
        if ((terms.expectedRaiseUsd ?? 0) < MIN_RAISE && !underwriters.length) continue;
        const pricedDate = prospectusDate(text, h.fileDate) ?? h.fileDate;
        const shares = terms.offerPrice && terms.expectedRaiseUsd ? Math.round(terms.expectedRaiseUsd / terms.offerPrice) : null;
        const record: IpoHistoryRecord = {
          id: `ipo-${cik}-${pricedDate}`,
          company: { name: displayName(nameOn(sub, pricedDate)), ticker: sub.tickers?.[0] ?? null, cik },
          sector: sectorForSic(sub.sic, sub.name),
          industry: sub.sicDescription || null,
          pricedDate,
          filedDate: h.fileDate,
          offerPrice: terms.offerPrice,
          sharesOffered: shares,
          raiseUsd: terms.expectedRaiseUsd != null ? Math.round(terms.expectedRaiseUsd) : null,
          underwriters,
          url,
        };
        byId.set(record.id, record);
        added++;
      } catch (err) {
        checked.delete(url); // try again next run
        log(`  ! ${h.adsh}: ${(err as Error).message}`);
      }
    }
    log(`  ${start.slice(0, 7)}: ${hits.length} final prospectuses, ${added} IPOs (${byId.size} total, ${candidates} checked)`);
    await checkpoint?.(snapshot());
  }
  return snapshot();
}

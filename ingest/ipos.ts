/**
 * Feature 3: the IPO pipeline.
 *
 * Filed   → a first-time registrant has a public S-1 / F-1 on file
 * Priced  → priced in the last 7 days (a 424B4 final prospectus is on file), the "priced this week" list
 *           IPO calendars show. The 424B4 lands a day or two after pricing, when the stock already trades,
 *           so "priced but not yet trading" is never visible in EDGAR.
 * Trading → priced more than 7 days ago (kept for 120 days)
 *
 * Excluded: SPACs, funds/ETFs/trusts, companies already filing 10-K/10-Q/20-F
 * (follow-ons and resale registrations), withdrawn registrations, and tiny
 * self-underwritten offerings (< $20M with no recognised bookrunner).
 */
import type { Directory } from "./deals";
import {
  archiveUrl,
  filingDocuments,
  fullTextSearch,
  getSubmissions,
  getTextHead,
  NotFoundError,
  recentFilings,
  trimCik,
  type Submissions,
} from "./edgar";
import { monthWindows } from "./deals";
import { normalizeName } from "./parse/names";
import { displayName } from "./parse/press";
import { IPO_PARSER_VERSION, isResaleOnly, parseFinalProspectus, parseRegistration, type IpoTerms } from "./parse/ipo";
import { sectorForSic } from "./sectors";
import type { State, StoredIpo } from "./store";
import { htmlToText } from "./text";
import type { Filing, IpoStage } from "../lib/types";

const REG_FORMS = /^(S-1|F-1)(\/A)?$/;
const PERIODIC = /^(10-K|10-Q|20-F|40-F|10-KT)(\/A)?$/;
const EXCLUDED_SIC = new Set(["6770", "6221", "6189", "6798"]); // SPACs, commodity pools, ABS, (non-traded) REITs
const FUNDLIKE =
  /\b(ETF|Fund|Trust|Bitcoin|Ether(?:eum)?|Staked|Solana|XRP|Crypto(?:currency)?|Portfolio|Income Shares)\b|\bAcquisition (?:Corp|Company|Co)\b|\b(?:Holdings|Capital|Acquisition) (?:Corp\.?,? |Inc\.?,? )?[IVX]{1,4}\b/i;
const MIN_RAISE = 20e6;
/** How long a new pricing shows as "Priced" before moving to "Trading". */
const PRICED_DAYS = 7;
/** Tracked companies are re-checked when their last check is older than this (the ingest runs every 3 hours). */
const RECHECK_MS = 2 * 3_600_000;
const DAY = 86_400_000;

async function discoverRegistrants(from: string, to: string, log: (s: string) => void) {
  const ciks = new Map<string, string>(); // cik -> latest filing date seen
  for (const [start, end] of monthWindows(from, to)) {
    const hits = await fullTextSearch({ q: "", forms: ["S-1", "F-1"], from: start, to: end });
    for (const h of hits) {
      if (h.sics.some((s) => EXCLUDED_SIC.has(s))) continue;
      if (FUNDLIKE.test(h.displayNames[0] ?? "")) continue;
      const cik = trimCik(h.ciks[0]);
      if ((ciks.get(cik) ?? "") < h.fileDate) ciks.set(cik, h.fileDate);
    }
    log(`  searched ${start} → ${end}: ${ciks.size} registrants so far`);
  }
  return ciks;
}

function filing(sub: Submissions, f: { adsh: string; date: string; form: string; primaryDocument: string }): Filing {
  return { form: f.form, filedDate: f.date, url: archiveUrl(sub.cik, f.adsh, f.primaryDocument) };
}

async function feeExhibitText(cik: string, adsh: string): Promise<string | null> {
  try {
    const docs = await filingDocuments(cik, adsh);
    const fee = docs.find((d) => /ex-?107|filing[-_ ]?fee|exfilingfees|ex_fee/i.test(d) && /\.html?$/i.test(d));
    return fee ? htmlToText(await getTextHead(archiveUrl(cik, adsh, fee), 200_000)) : null;
  } catch {
    return null;
  }
}

/** Build or refresh one company's pipeline record from its filing history. Returns null to drop it. */
async function evaluate(cik: string, existing: StoredIpo | undefined, dir: Directory, today: string): Promise<StoredIpo | null> {
  let sub: Submissions;
  try {
    sub = await getSubmissions(cik);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
  if (EXCLUDED_SIC.has(sub.sic) || FUNDLIKE.test(sub.name)) return null;

  const filings = recentFilings(sub).sort((a, b) => a.date.localeCompare(b.date));
  const regs = filings.filter((f) => REG_FORMS.test(f.form));
  // The IPO registration: the latest original (non-amended) S-1 / F-1 filed before the company had any periodic
  // report or IPO prospectus. A later S-1 is a follow-on or resale (WhiteHawk filed one three months after its IPO);
  // with nothing but those, the company was already public: not an IPO.
  const originals = regs.filter((f) => !f.form.endsWith("/A"));
  const alreadyPublicBy = (date: string) => filings.some((f) => (PERIODIC.test(f.form) || f.form === "424B4") && f.date < date);
  const initial = [...(originals.length ? originals : regs.slice(0, 1))].reverse().find((r) => !alreadyPublicBy(r.date));
  if (!initial) return null;
  // Registered a merger (S-4 / F-4) before this S-1 and left shell status (8-K Item 5.06, filed when a SPAC merger
  // closes): it came public through a SPAC and the S-1 resells holders' shares (Securitize, Suncrete). An earlier
  // S-4 alone isn't enough: WhiteHawk registered exchange offers before its underwritten IPO, so without the 5.06
  // such a company is dropped only if no bookrunner is found (below). A mutual bank converting while buying another
  // bank files its S-4 alongside or after the S-1 and is unaffected.
  const mergedIn = filings.some((f) => /^(?:S-4|F-4)(?:\/A)?$/.test(f.form) && f.date < initial.date);
  if (mergedIn && filings.some((f) => /^8-K/.test(f.form) && /\b5\.06\b/.test(f.items))) return null;

  const priced = filings.find((f) => f.form === "424B4" && f.date >= initial.date);
  // Withdrawn before pricing (a withdrawal after the IPO concerns some later registration).
  const withdrawn = filings.find((f) => f.form === "RW" && f.date >= initial.date && (!priced || f.date < priced.date));
  if (withdrawn) return null;
  // This IPO's own registration and amendments, not later follow-on S-1s.
  const latestReg = regs.filter((f) => f.date >= initial.date && (!priced || f.date <= priced.date)).at(-1) ?? initial;
  const lastActivity = [latestReg.date, priced?.date ?? ""].sort().at(-1)!;

  const listed = dir.byCik.get(sub.cik.replace(/^0+/, ""));
  // Already quoted over the counter: an uplisting, not an IPO.
  if (!priced && listed?.exchange === "OTC") return null;
  const stage: IpoStage = !priced ? "Filed" : (Date.parse(today) - Date.parse(priced.date)) / DAY <= PRICED_DAYS ? "Priced" : "Trading";

  // Pipeline window: live registrations from the past year, and recent pricings.
  const ageDays = (d: string) => (Date.parse(today) - Date.parse(d)) / DAY;
  if (stage === "Filed" && ageDays(lastActivity) > 365) return null;
  if (stage !== "Filed" && ageDays(priced!.date) > 120) return null;

  const docAdsh = priced?.adsh ?? latestReg.adsh;
  // Skip re-downloading a document we already parsed.
  let terms: IpoTerms | null = null;
  if (!existing || existing.parsedAdsh !== docAdsh || existing.parser !== IPO_PARSER_VERSION) {
    const doc = priced ?? latestReg;
    const text = htmlToText(await getTextHead(archiveUrl(sub.cik, doc.adsh, doc.primaryDocument), 700_000));
    terms = priced ? parseFinalProspectus(text) : parseRegistration(text, await feeExhibitText(sub.cik, doc.adsh));
    // A bank named in the company's own name isn't its bookrunner ("Baird Medical" is not Robert W. Baird).
    const own = ` ${normalizeName(sub.name)} `;
    terms.underwriters = terms.underwriters.filter((u) => !own.includes(` ${normalizeName(u)} `));
    // A direct listing, or selling holders reselling with no underwriters: no IPO offering.
    if (isResaleOnly(text, terms.underwriters)) return null;
    // Amendments often omit the fee table; the original registration has it.
    if (!priced && terms.expectedRaiseUsd == null && doc.adsh !== initial.adsh) {
      terms = { ...terms, expectedRaiseUsd: parseRegistration("", await feeExhibitText(sub.cik, initial.adsh)).expectedRaiseUsd };
    }
    // Final prospectus may omit a clean price×shares; fall back to the registration estimate.
    if (priced && terms.expectedRaiseUsd == null) terms.expectedRaiseUsd = existing?.expectedRaiseUsd ?? null;
  }

  const base: StoredIpo = existing ?? {
    id: `ipo-${sub.cik.replace(/^0+/, "")}`,
    company: { name: displayName(sub.name), ticker: null, cik: sub.cik.replace(/^0+/, "") },
    sector: sectorForSic(sub.sic, sub.name),
    industry: sub.sicDescription || null,
    stage,
    filedDate: initial.date,
    pricedDate: null,
    expectedRaiseUsd: null,
    offerPrice: null,
    underwriters: [],
    description: "",
    filings: [],
    lastActivity,
    checkedAt: null,
    parsedAdsh: null,
  };

  const ipo: StoredIpo = {
    ...base,
    company: { ...base.company, name: displayName(sub.name), ticker: sub.tickers?.[0] ?? listed?.ticker ?? base.company.ticker },
    sector: sectorForSic(sub.sic, sub.name),
    industry: sub.sicDescription || null,
    stage,
    filedDate: initial.date,
    pricedDate: priced?.date ?? null,
    lastActivity,
    checkedAt: new Date().toISOString(),
    filings: [initial, latestReg !== initial ? latestReg : null, priced ?? null].filter((f): f is NonNullable<typeof f> => !!f).map((f) => filing(sub, f)),
  };
  if (terms) {
    ipo.expectedRaiseUsd = terms.expectedRaiseUsd ?? ipo.expectedRaiseUsd;
    ipo.offerPrice = terms.offerPrice ?? ipo.offerPrice;
    ipo.underwriters = terms.underwriters.length ? terms.underwriters : ipo.underwriters;
    ipo.description = terms.description ?? (ipo.description || sub.sicDescription || "");
    ipo.parsedAdsh = docAdsh;
    ipo.parser = IPO_PARSER_VERSION;
  }

  // Tiny self-underwritten offerings aren't the IPO market this tracks; nor is a post-merger registration with no
  // bookrunner (a pending SPAC merger's resale or PIPE shares: Einride).
  if ((ipo.expectedRaiseUsd ?? 0) < MIN_RAISE && !ipo.underwriters.length) return null;
  if (mergedIn && !ipo.underwriters.length) return null;
  if (ipo.expectedRaiseUsd != null && ipo.expectedRaiseUsd < 5e6) return null;
  return ipo;
}

export async function ingestIpos(
  state: State,
  opts: { from: string; to: string; directory: Directory; log: (s: string) => void; today: string; checkpoint?: () => Promise<void> },
) {
  const { log } = opts;
  const found = await discoverRegistrants(opts.from, opts.to, log);
  const byCik = new Map(state.ipos.map((i) => [i.company.cik!, i]));
  // New registrants, plus every company already in the pipeline (to catch pricing / withdrawal).
  const toCheck = new Set([...found.keys(), ...byCik.keys()]);
  log(`  evaluating ${toCheck.size} companies (${found.size} from search, ${byCik.size} already tracked)`);

  let n = 0;
  for (const cik of toCheck) {
    const existing = byCik.get(cik);
    if (existing?.checkedAt && Date.now() - Date.parse(existing.checkedAt) < RECHECK_MS && !found.has(cik)) continue;
    try {
      const ipo = await evaluate(cik, existing, opts.directory, opts.today);
      if (ipo) byCik.set(cik, ipo);
      else byCik.delete(cik);
    } catch (err) {
      log(`  ! ipo ${cik}: ${(err as Error).message}`);
    }
    if (++n % 50 === 0) log(`  evaluated ${n}/${toCheck.size}, ${byCik.size} in pipeline`);
    if (n % 250 === 0 && opts.checkpoint) {
      state.ipos = [...byCik.values()];
      await opts.checkpoint();
    }
  }
  state.ipos = [...byCik.values()].sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  return { candidates: toCheck.size, pipeline: state.ipos.length };
}

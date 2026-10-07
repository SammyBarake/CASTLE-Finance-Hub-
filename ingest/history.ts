/**
 * History CLI: the data foundation for the what-if engine. Separate from the live pipelines and tables, so the
 * site's features are untouched.
 *
 *   npm run history -- deals --from 2015-01-01 --to 2020-12-31   backfill deals with the live parsers (light enrichment)
 *   npm run history -- ipos --from 2015-01-01                    priced IPOs from 424B4 final prospectuses
 *   npm run history -- markets                                   sector ETF prices (Yahoo) + FRED series
 *   npm run history -- build [--value-kind transaction]          sector_monthly + macro_monthly from all of the above
 *   npm run history -- snapshot [--period 2026-09]               IPO pipeline + league table snapshot for a month
 *   npm run history -- recall                                    per-year coverage check against merger-proxy filers
 *   npm run history -- report                                    coverage report
 *   npm run history -- push                                      upload the local history files to Supabase
 *   npm run history -- monthly                                   the GitHub Actions job: everything from/to Supabase
 *
 * Local files live in .data/history/ (git-ignored). Supabase writes need SUPABASE_SERVICE_ROLE_KEY and the tables
 * from supabase/migrations/0002_history.sql.
 */
import { createClient } from "@supabase/supabase-js";
import { buildDirectory, discoverMergerFilers, ingestDeals, parseDisplayName } from "./deals";
import { edgarRequestCount, getListedCompanies } from "./edgar";
import { historyDb, LOCAL, loadFromSupabase, push, readJson, writeJson, type Snapshot } from "./historyStore";
import { backfillIpoHistory, type IpoHistoryState } from "./ipoHistory";
import { fetchMarkets, SECTOR_ETFS, type Markets } from "./markets";
import { JsonStore, LOCAL_DATA_PATH, type StoredDeal } from "./store";
import { leagueTable, toPublicIpo } from "../lib/aggregate";
import { bankShortName } from "../lib/banks";
import { buildMacroMonthly, buildSectorMonthly, coverageFlags, previousMonth, type MacroMonthRow, type SectorMonthRow, type ValueKind, type YearCoverage } from "../lib/history";
import { SECTORS, type Ipo, type Sector } from "../lib/types";
import { sectorForSic } from "./sectors";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const thisMonth = () => isoDay(new Date()).slice(0, 7);

/** The history starts here; months are complete months only (up to, not including, the current month). */
export const HISTORY_FROM = "2015-01";
type Log = (s: string) => void;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Live deals and IPOs (2021 onward): Supabase read-only when configured, else the local file. */
async function loadLive(log: Log): Promise<{ deals: StoredDeal[]; ipos: Ipo[] }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key && process.env.CASTLE_DATA_SOURCE !== "local") {
    const db = createClient(url, key, { auth: { persistSession: false } });
    const all = async <T,>(table: string) => {
      const out: T[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.from(table).select("data").range(from, from + 999);
        if (error) throw new Error(`Supabase ${table}: ${error.message}`);
        out.push(...(data ?? []).map((r) => r.data as T));
        if (!data || data.length < 1000) return out;
      }
    };
    const [deals, ipos] = await Promise.all([all<StoredDeal>("deals"), all<Ipo>("ipos")]);
    log(`live data (Supabase): ${deals.length} deals, ${ipos.length} IPOs`);
    return { deals, ipos };
  }
  const state = await new JsonStore(LOCAL_DATA_PATH).load();
  log(`live data (${LOCAL_DATA_PATH}): ${state.deals.length} deals, ${state.ipos.length} IPOs`);
  return { deals: state.deals, ipos: state.ipos };
}

/**
 * Live deals plus the 2015–2020 backfill, without double counting: a history deal is left out when the live table has
 * the same id, or the same target (by CIK) announced within 30 days. The live record wins.
 */
export function mergeDeals(live: StoredDeal[], history: StoredDeal[]): StoredDeal[] {
  const ids = new Set(live.map((d) => d.id));
  const byCik = new Map<string, string[]>();
  for (const d of live) if (d.target.cik) byCik.set(d.target.cik, [...(byCik.get(d.target.cik) ?? []), d.announcedDate]);
  const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= 30 * 86_400_000;
  const extra = history.filter((h) => !ids.has(h.id) && !(h.target.cik && (byCik.get(h.target.cik) ?? []).some((d) => near(d, h.announcedDate))));
  return [...live, ...extra];
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** `statePath`: another history file (e.g. a fresh re-read to compare before replacing .data/history/deals.json). */
async function backfillDeals(from: string, to: string, log: Log, statePath = LOCAL.deals) {
  const store = new JsonStore(statePath);
  const state = await store.load();
  log(`history deals ${from} -> ${to}: ${state.deals.length} deals, ${state.seen.size} documents already read`);
  const directory = buildDirectory(await getListedCompanies());
  const checkpoint = async () => {
    state.asOf = new Date().toISOString();
    await store.save(state);
    log(`  checkpoint saved (${state.deals.length} deals)`);
  };
  try {
    const s = await ingestDeals(state, { from, to, directory, log, today: isoDay(new Date()), checkpoint, light: true });
    log(`deals: read ${s.documents} documents, ${s.parsed} parsed (${s.privateDeals} private-target), ${s.newDeals} new deals, ${s.enriched} enriched`);
    if (s.searchGaps.length) log(`deals: ${s.searchGaps.length} searches failed; run again to fill them: ${s.searchGaps.slice(0, 5).join(", ")}`);
  } finally {
    await checkpoint();
  }
}

async function updateIpos(state: IpoHistoryState, from: string, to: string, log: Log, save?: (s: IpoHistoryState) => Promise<void>) {
  log(`IPO history ${from} -> ${to}: ${state.records.length} IPOs, ${state.checked.length} prospectuses already checked`);
  const next = await backfillIpoHistory(from, to, state, log, save);
  log(`IPO history: ${next.records.length} priced IPOs`);
  return next;
}

async function updateMarkets(previous: Markets | null, log: Log) {
  log("markets: sector ETFs (Yahoo Finance) and FRED series");
  const { markets, failed } = await fetchMarkets(`${HISTORY_FROM}-01`, thisMonth(), previous, log);
  if (failed.length) log(`markets: ${failed.join(", ")} failed; previous values kept`);
  return markets;
}

function build(deals: StoredDeal[], ipos: IpoHistoryState, markets: Markets | null, valueKind: ValueKind) {
  const sectorMonthly = buildSectorMonthly({
    deals,
    ipos: ipos.records,
    etf: markets?.etf ?? {},
    etfTickers: SECTOR_ETFS,
    cpi: markets?.fred.cpi ?? {},
    from: HISTORY_FROM,
    before: thisMonth(),
    valueKind,
  });
  const macroMonthly = buildMacroMonthly(markets?.fred ?? {}, HISTORY_FROM, thisMonth());
  return { sectorMonthly, macroMonthly };
}

/** The month just ended (the job runs early in the next month), or --period. */
const snapshotPeriod = () => arg("period") ?? previousMonth(thisMonth());

function snapshots(liveDeals: StoredDeal[], liveIpos: Ipo[], period: string): Snapshot[] {
  const [y, m] = period.split("-").map(Number);
  const end = isoDay(new Date(Date.UTC(y, m, 0)));
  const takenAt = new Date().toISOString();
  const ipos = liveIpos.map(toPublicIpo);
  const byStage = Object.fromEntries(["Filed", "Priced", "Trading"].map((s) => [s, ipos.filter((i) => i.stage === s).length]));
  return [
    // As the site showed it when taken (the pipeline has no history of its own).
    { kind: "ipo_pipeline", period, takenAt, data: { asOf: takenAt, byStage, ipos } },
    // Year to date at the end of the month, from deals announced by then.
    { kind: "league_table", period, takenAt, data: { asOf: end, ...leagueTable(liveDeals.filter((d) => d.announcedDate <= end), `${end}T23:59:59Z`, bankShortName) } },
  ];
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

type Coverage = Record<string, YearCoverage>;

/** Per year and sector: merger-proxy / tender filers (PREM14A, DEFM14A, SC 14D9, SC 13E3) and how many have a deal. */
async function recall(deals: StoredDeal[], from: number, to: number, log: Log): Promise<Coverage> {
  const out: Coverage = readJson(LOCAL.coverage, {});
  const targets = new Map<string, string[]>();
  for (const d of deals) if (d.target.cik) targets.set(d.target.cik, [...(targets.get(d.target.cik) ?? []), d.announcedDate]);
  for (let y = from; y <= to; y++) {
    const filers = await discoverMergerFilers(`${y}-01-01`, `${y}-12-31`, [], log);
    const year: Required<YearCoverage> = { filers: filers.size, matched: 0, sectors: {} };
    for (const [cik, f] of filers) {
      // A deal for that company announced up to ~8 months before its first proxy / 14D-9 that year.
      const hit = (targets.get(cik) ?? []).some((d) => d <= f.firstDate && Date.parse(f.firstDate) - Date.parse(d) <= 250 * 86_400_000);
      const sector = sectorForSic(f.hit.sics[0], parseDisplayName(f.hit.displayNames[0]).name);
      const s = (year.sectors[sector] ??= { filers: 0, matched: 0 });
      s.filers++;
      if (hit) {
        s.matched++;
        year.matched++;
      }
    }
    out[y] = year;
    log(`  ${y}: ${filers.size} merger-proxy filers, ${year.matched} with a deal (${filers.size ? Math.round((year.matched / filers.size) * 100) : 0}%)`);
    writeJson(LOCAL.coverage, out);
  }
  return out;
}

function report(deals: StoredDeal[], ipos: IpoHistoryState, rows: SectorMonthRow[], macro: MacroMonthRow[], log: Log) {
  const live = deals.filter((d) => d.status !== "Terminated");
  // Every calendar year, so a year with no deals at all still shows (and is flagged).
  const years = Array.from({ length: Number(thisMonth().slice(0, 4)) - Number(HISTORY_FROM.slice(0, 4)) + 1 }, (_, i) => String(Number(HISTORY_FROM.slice(0, 4)) + i));
  const coverage: Coverage = readJson(LOCAL.coverage, {});
  const currentYear = thisMonth().slice(0, 4);
  const publicDeals: Record<string, Partial<Record<Sector, number>>> = {};
  for (const d of live) if (!d.privateTarget) (publicDeals[d.announcedDate.slice(0, 4)] ??= {})[d.sector] = (publicDeals[d.announcedDate.slice(0, 4)]?.[d.sector] ?? 0) + 1;
  const flags = coverageFlags({ coverage, publicDeals, years, currentYear });
  writeJson(LOCAL.coverageFlags, { builtAt: new Date().toISOString(), ...flags });
  log("\nDeals per year (terminated excluded) and IPOs priced:");
  log("  year   deals  public  private  with value   IPOs   recall   flag");
  for (const f of flags.years) {
    const ds = live.filter((d) => d.announcedDate.startsWith(f.year));
    const valued = ds.filter((d) => d.valueUsd != null).length;
    const ipoN = ipos.records.filter((i) => i.pricedDate.startsWith(f.year)).length;
    const flag = f.year === currentYear ? "partial year" : f.weak ? `WEAK (${f.reason})` : "";
    log(`  ${f.year}   ${String(ds.length).padStart(5)}  ${String(f.publicDeals).padStart(6)}  ${String(ds.length - f.publicDeals).padStart(7)}  ${`${Math.round((valued / Math.max(1, ds.length)) * 100)}%`.padStart(10)}  ${String(ipoN).padStart(5)}  ${(f.recall != null ? `${f.recall}%` : "—").padStart(7)}   ${flag}`);
  }
  const weakSectorYears = flags.sectorYears.filter((f) => f.weak && !flags.years.find((y) => y.year === f.year)?.weak);
  log(`  weak sector-years (in otherwise sound years): ${weakSectorYears.length ? weakSectorYears.map((f) => `${f.sector} ${f.year} (${f.reason})`).join("; ") : "none"}`);

  log("\nMonths of data per sector (" + `${rows[0]?.month} to ${rows.at(-1)?.month}` + "):");
  for (const s of SECTORS) {
    const rs = rows.filter((r) => r.sector === s);
    log(`  ${s.padEnd(12)} ${rs.length} months | ETF return ${rs.filter((r) => r.etfReturnPct != null).length} | with deals ${rs.filter((r) => r.dealCount > 0).length} | with IPOs ${rs.filter((r) => r.ipoCount > 0).length}`);
  }
  const macroCols: [keyof MacroMonthRow, string][] = [["fedFundsPct", "Fed funds"], ["treasury10yPct", "10Y Treasury"], ["hySpreadPct", "HY OAS"], ["baaSpreadPct", "Baa-10Y spread"], ["vix", "VIX"], ["cpi", "CPI"]];
  log(`  macro (${macro.length} months): ` + macroCols.map(([k, label]) => `${label} ${macro.filter((m) => m[k] != null).length}`).join(" | "));

  const total = rows.reduce((s, r) => s + r.dealCount, 0);
  const inSum = rows.reduce((s, r) => s + r.dealValueN, 0);
  const nulls = rows.reduce((s, r) => s + r.dealValueNullN, 0);
  const other = rows.reduce((s, r) => s + r.dealValueOtherKindN, 0);
  const kind = rows[0]?.dealValueKind;
  const pct = (n: number) => `${((n / Math.max(1, total)) * 100).toFixed(1)}%`;
  log(`\nDeal values (${total} deals in sector_monthly, value type "${kind}", ${rows[0]?.cpiBaseMonth} dollars):`);
  log(`  usable (${kind}): ${inSum} (${pct(inSum)}) | no value disclosed: ${nulls} (${pct(nulls)}) | other value type: ${other} (${pct(other)})`);
  const kinds = ["transaction", "equity", "enterprise"].map((k) => `${k} ${live.filter((d) => d.valueUsd != null && d.valueKind === k).length}`).join(", ");
  log(`  any disclosed value, by type: ${kinds}`);

  const zero = rows.filter((r) => r.dealCount === 0);
  log(`\nSector-months with zero deals: ${zero.length} of ${rows.length}`);
  for (const s of SECTORS) {
    const ms = zero.filter((r) => r.sector === s).map((r) => r.month);
    if (ms.length) log(`  ${s}: ${ms.join(", ")}`);
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const started = Date.now();
  const log: Log = (s) => console.log(s.startsWith("\n") ? s : `[${((Date.now() - started) / 1000).toFixed(0).padStart(5)}s] ${s}`);
  const cmd = process.argv[2];
  const valueKind = (arg("value-kind") ?? "transaction") as ValueKind;
  const historyDeals = () => readJson<{ deals?: StoredDeal[] }>(LOCAL.deals, {}).deals ?? [];
  const ipoState = () => readJson<IpoHistoryState>(LOCAL.ipos, { records: [], checked: [] });

  if (cmd === "deals") {
    await backfillDeals(arg("from") ?? "2015-01-01", arg("to") ?? "2020-12-31", log, arg("state"));
  } else if (cmd === "ipos") {
    await updateIpos(ipoState(), arg("from") ?? `${HISTORY_FROM}-01`, arg("to") ?? isoDay(new Date()), log, async (s) => writeJson(LOCAL.ipos, s));
  } else if (cmd === "markets") {
    writeJson(LOCAL.markets, await updateMarkets(readJson<Markets | null>(LOCAL.markets, null), log));
  } else if (cmd === "build" || cmd === "report") {
    const live = await loadLive(log);
    const deals = mergeDeals(live.deals, historyDeals());
    const { sectorMonthly, macroMonthly } = build(deals, ipoState(), readJson<Markets | null>(LOCAL.markets, null), valueKind);
    writeJson(LOCAL.sectorMonthly, sectorMonthly);
    writeJson(LOCAL.macroMonthly, macroMonthly);
    log(`built ${sectorMonthly.length} sector-month rows and ${macroMonthly.length} macro rows from ${deals.length} deals`);
    if (cmd === "report") report(deals, ipoState(), sectorMonthly, macroMonthly, log);
  } else if (cmd === "snapshot") {
    const live = await loadLive(log);
    const snaps = snapshots(live.deals, live.ipos, snapshotPeriod());
    const all = readJson<Snapshot[]>(LOCAL.snapshots, []).filter((s) => !snaps.some((n) => n.kind === s.kind && n.period === s.period));
    writeJson(LOCAL.snapshots, [...all, ...snaps]);
    log(`snapshots for ${snapshotPeriod()}: ${snaps.map((s) => s.kind).join(", ")}`);
  } else if (cmd === "recall") {
    const live = await loadLive(log);
    await recall(mergeDeals(live.deals, historyDeals()), Number(arg("from") ?? 2015), Number(arg("to") ?? Number(thisMonth().slice(0, 4)) - 1), log);
  } else if (cmd === "push") {
    const db = historyDb();
    await push.deals(db, historyDeals());
    await push.ipos(db, ipoState());
    await push.sectorMonthly(db, readJson<SectorMonthRow[]>(LOCAL.sectorMonthly, []));
    await push.macroMonthly(db, readJson<MacroMonthRow[]>(LOCAL.macroMonthly, []));
    const markets = readJson<Markets | null>(LOCAL.markets, null);
    const snaps = readJson<Snapshot[]>(LOCAL.snapshots, []);
    await push.snapshots(db, [...snaps, ...(markets ? [{ kind: "markets", period: "latest", takenAt: markets.fetchedAt, data: markets }] : [])]);
    log("pushed the local history to Supabase");
  } else if (cmd === "monthly") {
    // GitHub Actions: no local files; read and write the Supabase history tables.
    const db = historyDb();
    const data = await loadFromSupabase(db);
    log(`Supabase: ${data.historyDeals.length} history deals, ${data.ipos.records.length} history IPOs, ${data.liveDeals.length} live deals`);
    const markets = await updateMarkets(data.markets, log);
    const since = `${previousMonth(previousMonth(thisMonth()))}-01`;
    const ipos = await updateIpos(data.ipos, since, isoDay(new Date()), log);
    const { sectorMonthly, macroMonthly } = build(mergeDeals(data.liveDeals, data.historyDeals), ipos, markets, valueKind);
    const snaps = snapshots(data.liveDeals, data.liveIpos as Ipo[], snapshotPeriod());
    await push.ipos(db, ipos);
    await push.sectorMonthly(db, sectorMonthly);
    await push.macroMonthly(db, macroMonthly);
    await push.snapshots(db, [...snaps, { kind: "markets", period: "latest", takenAt: markets.fetchedAt, data: markets }]);
    log(`monthly: ${sectorMonthly.length} sector-month rows, ${macroMonthly.length} macro rows, snapshots for ${snapshotPeriod()}`);
  } else {
    throw new Error(`unknown command "${cmd}" (deals | ipos | markets | build | snapshot | recall | report | push | monthly)`);
  }
  log(`done (${edgarRequestCount()} EDGAR requests)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

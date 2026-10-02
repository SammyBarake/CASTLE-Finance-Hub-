/**
 * Try a what-if scenario on the ripple engine (lib/ripple) from the command line. Read-only.
 *
 *   npm run ripple -- --shock Tech.valuation=10
 *   npm run ripple -- --shock baaSpread=1 --shock vix=10 --quarters 4
 *   npm run ripple -- --shock Energy.valuation=-20 --json
 *   npm run ripple -- --shock vix=10 --links hand-set          (default: the link set in lib/ripple/settings.ts)
 *   npm run ripple -- --export-handset                         hand-set links → .data/history/handset_links.json
 *
 * Sector shocks are % changes (Sector.feature=value; features: valuation, dealCount, dealValue, ipoCount). Macro
 * shocks are in natural units: fedFunds / treasury10y / baaSpread in percentage points (1 = 100 bp), vix in points.
 * Levels use .data/history/sector_monthly.json (npm run history -- build); adviser shares use the live deals plus the
 * 2015–2020 history when present.
 */
import { createClient } from "@supabase/supabase-js";
import { HISTORY_DIR, LOCAL, readJson, writeJson } from "./historyStore";
import { JsonStore, LOCAL_DATA_PATH, type StoredDeal } from "./store";
import { adviserOutlook, adviserShares } from "../lib/ripple/advisers";
import { levelChange, sectorBaselines } from "../lib/ripple/baseline";
import { explain, runRipple, type RippleShock } from "../lib/ripple/engine";
import {
  FEATURE_LINKS,
  FEATURES,
  handSetValue,
  linkKey,
  MACRO_LINKS,
  MACRO_UNITS,
  MACROS,
  SECTOR_LINKS,
  STRENGTH_SCALE,
  type Feature,
  type FeatureLink,
  type Macro,
  type MacroLink,
  type SectorLink,
} from "../lib/ripple/links";
import { linkCounts, LINK_SETS, RIPPLE_SETTINGS, type LinkSetName } from "../lib/ripple/settings";
import type { SectorMonthRow } from "../lib/history";
import { SECTORS, type Sector } from "../lib/types";

function parseShocks(): RippleShock {
  const shock: RippleShock = { sectors: {}, macro: {} };
  process.argv.forEach((a, i) => {
    if (a !== "--shock") return;
    const [key, raw] = (process.argv[i + 1] ?? "").split("=");
    const value = Number(raw);
    if (!key || !Number.isFinite(value)) throw new Error(`bad --shock "${process.argv[i + 1]}" (e.g. Tech.valuation=10 or vix=10)`);
    if ((MACROS as readonly string[]).includes(key)) shock.macro![key as Macro] = value;
    else {
      const [sector, feature] = key.split(".");
      if (!(SECTORS as readonly string[]).includes(sector) || !(FEATURES as readonly string[]).includes(feature)) throw new Error(`unknown shock "${key}"`);
      (shock.sectors![sector as Sector] ??= {})[feature as Feature] = value;
    }
  });
  return shock;
}

async function liveDeals(): Promise<StoredDeal[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key && process.env.CASTLE_DATA_SOURCE !== "local") {
    const db = createClient(url, key, { auth: { persistSession: false } });
    const out: StoredDeal[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("deals").select("data").range(from, from + 999);
      if (error) throw new Error(error.message);
      out.push(...(data ?? []).map((r) => r.data as StoredDeal));
      if (!data || data.length < 1000) return out;
    }
  }
  return (await new JsonStore(LOCAL_DATA_PATH).load()).deals;
}

const fmt = (b: { mid: number; low: number; high: number }) => `${b.mid >= 0 ? "+" : ""}${b.mid.toFixed(1)}% [${b.low.toFixed(1)}, ${b.high.toFixed(1)}]`;
const usd = (v: number) => `${v < 0 ? "-" : "+"}$${(Math.abs(v) / 1e9).toFixed(2)}B`;

/** The hand-set links with their numbers, for the estimator (research/estimate_links.py reads them as priors). */
function exportHandSet(path: string) {
  const row = (l: FeatureLink | SectorLink | MacroLink) => ({ key: linkKey(l), ...l, value: handSetValue(l) });
  writeJson(path, { features: FEATURE_LINKS.map(row), sectors: SECTOR_LINKS.map(row), macro: MACRO_LINKS.map(row), strengthScale: STRENGTH_SCALE, macroUnits: MACRO_UNITS });
  console.log(`wrote ${FEATURE_LINKS.length + SECTOR_LINKS.length + MACRO_LINKS.length} hand-set links to ${path}`);
}

async function main() {
  const ei = process.argv.indexOf("--export-handset");
  if (ei >= 0) return exportHandSet(process.argv[ei + 1] ?? `${HISTORY_DIR}/handset_links.json`);
  const shock = parseShocks();
  const qi = process.argv.indexOf("--quarters");
  const quarters = qi >= 0 ? Number(process.argv[qi + 1]) : 4;
  const li = process.argv.indexOf("--links");
  const linkSet = (li >= 0 ? process.argv[li + 1] : RIPPLE_SETTINGS.linkSet) as LinkSetName;
  if (!LINK_SETS[linkSet]) throw new Error(`--links must be "estimated" or "hand-set"`);
  const result = runRipple(shock, { ...RIPPLE_SETTINGS, links: LINK_SETS[linkSet], quarters });
  const today = new Date().toISOString().slice(0, 10);
  const threeYearsAgo = new Date(Date.now() - 3 * 365.25 * 86_400_000).toISOString().slice(0, 10);
  const deals = [...(await liveDeals()), ...(readJson<{ deals?: StoredDeal[] }>(LOCAL.deals, {}).deals ?? [])];
  const outlook = adviserOutlook(result, adviserShares(deals, threeYearsAgo, today));

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ shock, result, advisers: outlook }, null, 1));
    return;
  }
  const counts = linkCounts(LINK_SETS[linkSet]);
  console.log(`Ripple engine, ${linkSet} links (${counts.estimated} of ${counts.total} estimated from data): λ = ${result.lambda}, rounds = ${result.rounds}.`);
  console.log(`Shock: ${JSON.stringify(shock)}\n`);
  const rows = readJson<SectorMonthRow[]>(LOCAL.sectorMonthly, []);
  const baselines = rows.length ? sectorBaselines(rows) : null;
  for (const s of SECTORS) {
    console.log(s);
    for (const f of FEATURES) {
      const cells = result.quarters.map((q) => fmt(q.sectors[s][f]).padEnd(24));
      const lv = baselines && levelChange(result, baselines, s, f, 2);
      const level = lv && lv.base > 0 && f !== "valuation" ? `  (Q2 ≈${f === "dealValue" ? usd(lv.mid) : `${lv.mid >= 0 ? "+" : ""}${lv.mid.toFixed(1)}`} vs ${f === "dealValue" ? `$${(lv.base / 1e9).toFixed(1)}B` : lv.base.toFixed(1)} a quarter)` : "";
      console.log(`  ${f.padEnd(10)} ${cells.join(" ")}${level}`);
    }
  }
  const biggest = SECTORS.flatMap((s) => FEATURES.map((f) => ({ s, f, v: result.quarters[1].sectors[s][f].mid }))).sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0];
  if (biggest && biggest.v) {
    console.log(`\nWhy ${biggest.s} ${biggest.f} moves in Q2:`);
    for (const c of explain(shock, biggest.s, biggest.f, 2, { ...RIPPLE_SETTINGS, links: LINK_SETS[linkSet] }).slice(0, 5))
      console.log(`  ${c.value >= 0 ? "+" : ""}${c.value}% from ${c.source}${c.lag != null ? ` (lag ${c.lag})` : ""}${c.assumed ? " [assumption]" : ""}`);
  }
  console.log(`\nAdvisers (share of sector deal value ${threeYearsAgo} → ${today} × predicted deal value, ${quarters} quarters):`);
  const show = (o: (typeof outlook)[number]) => `  ${o.bank.padEnd(26)} ${usd(o.changeUsd.mid).padStart(9)} [${usd(o.changeUsd.low)}, ${usd(o.changeUsd.high)}]  ${o.changePct.mid >= 0 ? "+" : ""}${o.changePct.mid}% of baseline${o.driver ? `, mostly ${o.driver}` : ""}`;
  const rise = outlook.filter((o) => o.changeUsd.mid > 0);
  const fall = outlook.filter((o) => o.changeUsd.mid < 0).reverse();
  console.log(" Positioned to rise:");
  if (rise.length) rise.slice(0, 8).forEach((o) => console.log(show(o)));
  else console.log("  none in this scenario");
  console.log(" Positioned to fall:");
  if (fall.length) fall.slice(0, 8).forEach((o) => console.log(show(o)));
  else console.log("  none in this scenario");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

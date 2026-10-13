/**
 * Castle ingest CLI.
 *
 *   npm run ingest                         daily update (last 5 days), writes to Supabase if configured
 *   npm run ingest -- --from 2024-09-01    backfill from a date
 *   npm run ingest -- --local              force the local JSON store (.data/castle.json)
 *   npm run ingest -- --only deals|ipos|activists|macro    run one pipeline
 *   npm run ingest -- --skip macro,activists               leave pipelines out (quick hourly runs)
 *   npm run ingest -- --only activists --from 2025-01-01   backfill activist 13Ds
 *   npm run ingest -- --rebuild-deals --from 2024-09-01   re-read every filing with the current parsers, drop stale deals
 *   npm run ingest -- --only deals --backstop-only --from 2021-01-01   only look up merger-proxy filers without a deal
 *   npm run ingest -- --only prices                 merger-arb spreads and buyers' share-price reactions (Yahoo)
 */
import { ingestActivists } from "./activists";
import { buildDirectory, ingestDeals } from "./deals";
import { edgarRequestCount, getListedCompanies } from "./edgar";
import { ingestIpos } from "./ipos";
import { fetchMacro } from "./macro";
import { updatePrices } from "./prices";
import { storeFromEnv } from "./store";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const started = Date.now();
  const today = isoDay(new Date());
  const to = arg("to") ?? today;
  const from = arg("from") ?? isoDay(new Date(Date.now() - 5 * 86_400_000));
  const only = arg("only");
  // --skip macro,activists: leave pipelines out (quick hourly runs skip the slow, slow-changing ones).
  const skip = new Set((arg("skip") ?? "").split(",").filter(Boolean));
  const runs = (step: string) => (!only || only === step) && !skip.has(step);
  const log = (s: string) => console.log(`[${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s] ${s}`);

  const store = storeFromEnv({ local: flag("local") });
  log(`Castle ingest ${from} -> ${to} using ${store.label}`);
  const state = await store.load();
  log(`loaded ${state.deals.length} deals, ${state.ipos.length} IPOs, ${state.seen.size} seen documents`);

  // --reenrich: recompute names, status, sector and multiples for every stored deal
  // (use after changing enrichment logic; doesn't re-read press releases).
  if (flag("reenrich")) {
    for (const d of state.deals) {
      d.statusCheckedAt = null;
      d.financialsCheckedAt = null;
      if (d.status !== "Terminated") d.status = d.status === "Closed" && d.statusDate ? d.status : "Announced";
    }
    log(`re-enriching all ${state.deals.length} deals`);
  }

  // --rebuild-deals: forget every deal and seen document and re-read all filings from --from with the
  // current parsers. Deals the new run doesn't produce are deleted at the end (only if the run succeeds).
  const rebuild = flag("rebuild-deals");
  if (rebuild) {
    if (!arg("from")) throw new Error("--rebuild-deals needs --from (e.g. --from 2024-09-01)");
    state.deals = [];
    state.seen = new Set();
    log("rebuilding all deals from scratch");
  }

  // The SEC company directory is only needed for deals and IPOs.
  const directory = only === "macro" ? buildDirectory([]) : buildDirectory(await getListedCompanies());
  if (only !== "macro") log(`company directory: ${directory.byTicker.size} listed tickers`);

  // Save progress periodically and at the end (even on failure), so long backfills can resume.
  // A failed progress save doesn't stop the run: the final save below tries again (a rebuild died an hour in).
  const checkpoint = async () => {
    state.asOf = new Date().toISOString();
    try {
      await store.save(state);
      log(`  checkpoint saved (${state.deals.length} deals)`);
    } catch (err) {
      log(`  ! checkpoint not saved, carrying on: ${(err as Error).message}`);
    }
  };
  let succeeded = false;
  // A rebuild only deletes stale deals when every search worked; a skipped month would otherwise lose its deals.
  let complete = true;
  try {
    if (runs("deals")) {
      log("deals: discovering announcements");
      const s = await ingestDeals(state, { from, to, directory, log, today, checkpoint, backstopOnly: flag("backstop-only") });
      log(`deals: read ${s.documents} documents, ${s.parsed} parsed (${s.privateDeals} private-target), ${s.newDeals} new deals, ${s.enriched} enriched, ${s.valuesFound} values found, ${s.sponsorsFound} sponsors named, ${s.advisorsFound} buyer advisers found`);
      if (s.searchGaps.length) {
        complete = false;
        log(`deals: ${s.searchGaps.length} searches failed after retries; stale deals are kept this run (run again later to fill the gaps)`);
      }
    }
    if (runs("ipos")) {
      log("ipos: discovering registrations");
      const s = await ingestIpos(state, { from, to, directory, log, today, checkpoint });
      log(`ipos: ${s.candidates} candidates, ${s.pipeline} in pipeline`);
    }
    if (runs("prices")) {
      // Non-critical: merger-arb spreads and buyers' share-price reactions (Yahoo); a failure keeps the stored figures.
      try {
        await updatePrices(state, { today, log });
      } catch (err) {
        log(`prices: skipped (${(err as Error).message})`);
      }
    }
    if (runs("activists")) {
      // Non-critical: a failure keeps the stored stakes.
      try {
        log("activists: reading Schedule 13D filings");
        const s = await ingestActivists(state, { from, to, directory, log });
        log(`activists: ${s.added} new stakes, ${s.total} stored`);
      } catch (err) {
        log(`activists: skipped (${(err as Error).message})`);
      }
    }
    if (runs("macro")) {
      // Non-critical: on failure keep the last good snapshot and carry on.
      try {
        state.macro = await fetchMacro();
        log(`macro: ${state.macro.economies.length} economies (IMF WEO ${state.macro.forecastYear} + BIS policy rates)`);
      } catch (err) {
        log(`macro: skipped, keeping previous data (${(err as Error).message})`);
      }
    }
    succeeded = true;
  } finally {
    state.asOf = new Date().toISOString();
    await store.save(state, { prune: rebuild && succeeded && complete });
    log(`saved to ${store.label}: ${state.deals.length} deals, ${state.ipos.length} IPOs (${edgarRequestCount()} EDGAR requests)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

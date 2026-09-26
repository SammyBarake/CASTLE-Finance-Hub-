@AGENTS.md

# Castle

A modern, **free** web terminal that tracks investment banking activity using public **SEC EDGAR** data.
The founder is a finance student building toward IB/PE. Design is set; the job is to build it cleanly.

## The five core features

1. **Deal flow**: announced M&A involving US public companies (acquirer, target, value, price per share, premium, cash/stock, sector, status).
2. **Deal volume**: line charts of M&A $ value and deal count over time, by sector.
3. **IPO pipeline**: companies that filed to go public, by stage (Filed → Priced → Trading), with underwriters.
4. **Who's advising**: league tables of banks by deals advised and value.
5. **Valuation moves**: median EV/EBITDA, EV/Revenue, and premiums paid by sector over time.

"World Economies" appears in the sidebar as **Soon** only. It is not a core feature; don't build it unless asked.

## Hard constraints

- **$0 to run.** Free tiers only: Next.js on Vercel, Supabase free Postgres, GitHub Actions, free SEC EDGAR data. No paid APIs or data vendors.
- **Serious, modern finance aesthetic.** Dark, dense, calm. The castle appears **only** as the logo (`Logo` in `components/layout/Sidebar.tsx`).
- **Never commit secrets.** Real values go in `.env.local` (git-ignored). Document every variable in `.env.example` with no values. Supabase service-role keys stay server-side / in GitHub Actions secrets, never `NEXT_PUBLIC_`.
- SEC EDGAR requires a descriptive `User-Agent` with contact info and has a rate limit of 10 requests/second.

## Design reference

`Design/Castle_Hub.html` is the approved design (standalone HTML with sample data). Match its look, layout, and interactions closely.
Colours, type sizes and breakpoints were ported from it. Check it before changing any visual.

## Stack

- Next.js 16 (App Router, Turbopack), React 19, TypeScript (strict), Tailwind CSS v4, Chart.js 4.
- Next 16 has breaking changes from older versions. Read `node_modules/next/dist/docs/` before using unfamiliar APIs (see AGENTS.md).
- Windows dev machine. `git` is not on PATH; GitHub Desktop's bundled git lives at
  `%LOCALAPPDATA%\GitHubDesktop\app-<version>\resources\app\git\cmd\git.exe`.

## Commands

```bash
npm run dev      # http://localhost:3000
npm run build    # production build (also type-checks)
npm run lint
npm test                               # vitest: parsers, financials, aggregation
npm run ingest -- --local              # pull the last 5 days of EDGAR into .data/castle.json
npm run ingest:backfill -- --local     # 24-month backfill (resumable; set EDGAR_CACHE_DIR=.data/cache)
npm run ingest                         # same, but writes to Supabase when its env vars are set
```

Going live (Supabase, GitHub secrets, Vercel) is documented step by step in [SETUP.md](SETUP.md).

## Architecture

```
app/
  layout.tsx          Root layout, Inter font, metadata
  page.tsx            Server component: getHubData() → <Hub data />
  globals.css         Design tokens (@theme) + a few shared component classes
components/
  hub/                One component per hub section (KpiStrip, DealVolumePanel, VolumeChart,
                      ValuationMoves, DealFlowTable, IpoPipelineTable, AdvisorsTable),
                      details.tsx (dialog bodies), Hub.tsx (owns search/filter/nav state)
  layout/             Sidebar (+ Logo), Topbar, PageHeader, Footer
  ui/                 Icon, primitives (StatusTag, SectorDot, CompanyIcon, Sparkline, Segment,
                      Select, PanelTitle, Delta), table helpers, UiProvider (dialog + toast)
lib/
  types.ts            THE DATA CONTRACT: every shape the UI renders
  sampleData.ts       The ONLY file with sample numbers (fictional)
  data.ts             getHubData(): Supabase → .data/castle.json → sample (server-only)
  aggregate.ts        Raw deals → monthly volume, league table, valuation medians (+ public field stripping)
  metrics.ts          Pure derived figures: YTD, momentum, medians, valuation cards
  banks.ts            Known banks, name variants, monograms (shared by ingest + UI)
  search.ts           Search / filter predicates
  format.ts           Money, %, multiples, dates
  sectors.ts          Sector colours (UI config)
  csv.ts              Deal export
ingest/               The SEC data engine (Node, run by GitHub Actions; never imported by components)
  run.ts              CLI entry: load store → deals → IPOs → save
  edgar.ts            EDGAR client: User-Agent, ~8 req/s throttle, retries, optional disk cache
  deals.ts            Full-text search → parse → resolve CIKs → merge → status/sector/multiples
  ipos.ts             S-1/F-1 registrants → filters → Filed / Priced (424B4) / Trading
  financials.ts       XBRL company facts → LTM revenue/EBITDA, debt, cash → EV multiples
  sectors.ts          SIC code → 5 display sectors
  store.ts            JsonStore (.data/castle.json) and SupabaseStore
  text.ts             EDGAR HTML → plain text
  parse/              Pure text parsers (press releases, IPO documents, company names) + tests
supabase/migrations/  SQL schema (jsonb `data` column per record, RLS read-only for anon)
.github/workflows/    ingest.yml (cron 09:30 + 21:30 ET, manual backfill) and ci.yml (lint/test/build)
```

### Data rules (important)

- Components **never** import `lib/sampleData.ts` or `ingest/`. They get `HubData` from `getHubData()` via props.
- Stored records are the `Deal` / `Ipo` shapes plus ingest-only fields (`StoredDeal`/`StoredIpo` in `ingest/store.ts`); `lib/aggregate.ts` strips those before data reaches the browser. The browser gets the latest 100 deals and 40 IPOs; aggregates use everything.
- UI copy (badges, notes, footer, methodology) switches on `HubData.isSample`.
- Conventions in `lib/types.ts`: money is plain USD, dates are ISO strings, percentages are whole numbers (34.2 = 34.2%), `null` means undisclosed.
- KPIs, momentum and medians are computed in `lib/metrics.ts` from raw rows. Never hardcode derived numbers in the UI.
- Sample bank names are real institutions, but their activity and ranks are fictional. Keep them labelled as sample data.

### Styling rules

- Use the Tailwind tokens (`bg-panel`, `border-line`, `text-muted`, `text-dim`, `text-accent`, `text-up`, `text-down`...).
- Breakpoints mirror the design's max-width queries. Use `max-laptop:` (≤1250px), `max-tablet:` (≤1000px), `max-phone:` (≤760px), and `wide:` (≥1650px).
- Repeated primitives (`.panel`, `.data-table`, `.segment`, `.status-*`, `.btn`, `.modal`) live in `globals.css` `@layer components`.

### SEC data engine rules

- **$0:** extraction is regex/heuristics over filing text. No paid APIs, no LLM calls.
- **Never guess:** if a term isn't clearly stated, leave it `null`. Blank is better than wrong.
- **Deal scope:** targets must be SEC registrants listed on a US exchange (NYSE / Nasdaq / NYSE American / Cboe). Private targets, SPAC combinations and OTC targets are skipped.
- **Merging:** documents about the same target (by CIK) merge into one deal. Only an announcement can create a deal; updates, completions and terminations modify existing deals.
- **Status comes from the target's filing history:** PREM14A / DEFM14A / SC 14D9 / SC TO-T / S-4 → Pending; Form 25 / 15 or an 8-K Item 5.01 → Closed; an 8-K Item 1.02 that mentions terminating the merger agreement → Terminated.
- **Parser changes need a test** in `ingest/parse/*.test.ts`. Fixtures are synthetic text in the style of real filings.
- **EDGAR etiquette:** always go through `ingest/edgar.ts`, which sends the User-Agent and throttles to ~8 requests/second.

## Roadmap

- **Task 1 (done):** scaffold, CLAUDE.md, hub rebuilt as components on sample data.
- **Task 2 (done):** SEC data engine (EDGAR → parsers → Supabase via GitHub Actions; site reads Supabase with hourly ISR).
- **Ideas / known gaps:** better recall for stock-for-stock bank mergers and deals announced only in 8-K bodies; a "Consumer" sector if the founder wants to split it from Industrials; World Economies (currently "Soon").

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

**World Economies** (a sixth page, not one of the core five) shows GDP growth and inflation from the IMF World Economic Outlook (DataMapper API; the current year is an IMF estimate) and central-bank policy rates from the BIS, for 11 major economies. Both sources are free and need no key. The data is fetched by the same ingest job (`ingest/macro.ts`) and stored in Supabase `meta` under key `macro`, so no schema change was needed.

## Hard constraints

- **$0 to run.** Free tiers only: Next.js on Vercel, Supabase free Postgres, GitHub Actions, free SEC EDGAR data. No paid APIs or data vendors.
- **Serious, modern finance aesthetic.** Monochrome, dense, calm. The castle appears **only** as the logo (`public/castle-logo.webp`, shown in `components/shell/AppShell.tsx`).
- **Never commit secrets.** Real values go in `.env.local` (git-ignored). Document every variable in `.env.example` with no values. Supabase service-role keys stay server-side / in GitHub Actions secrets, never `NEXT_PUBLIC_`.
- SEC EDGAR requires a descriptive `User-Agent` with contact info and has a rate limit of 10 requests/second.

## Design reference

`Design/Castle_Hub.html` is the approved design (v2, a multi-page terminal made in ChatGPT, standalone HTML with sample data). Match its look, layout, and interactions closely.
`globals.css` keeps the design file's class names (`.panel`, `.kpis`, `.preview-row`, `.detail-drawer`...) so the two are easy to compare. Check the design before changing any visual.
`Design/Castle_Hub_v1.html` is the previous design, kept for reference only.

Design v2 was built in two phases on the `design-v2` branch, both done:
- **Phase 1:** look, logo, 7-page routing, detail drawer, search dropdown, per-page export, definitions.
- **Phase 2:** deal screener (advanced filters, chips, saved views, columns, bulk select, compare), watchlist and notes, right-click and "…" row menus, density and animation settings, "?" shortcuts, chart type and granularity options, IPO and advisor extra filters.

**Workspace data (watchlist, notes, saved views, columns, density) lives only in the browser's localStorage** (`components/workspace/store.ts`, key `castle-workspace-v1`). Nothing is sent to a server. Syncing across devices would need user accounts, which aren't built.

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
npm run ingest -- --only macro         # just World Economies (IMF + BIS), ~1 second
npm run ingest -- --only deals --rebuild-deals --from 2024-09-01   # re-read all filings with current parsers; drops stale deals at the end
                                       # (also a "rebuild" checkbox on the GitHub Actions "Run workflow" form)
```

With Supabase keys in `.env.local`, the local site reads the live database. Set `CASTLE_DATA_SOURCE=local` (in the shell or `.env.local`) to make it read `.data/castle.json` instead, e.g. to try ingest changes without touching production.

Going live (Supabase, GitHub secrets, Vercel) is documented step by step in [SETUP.md](SETUP.md).

## Architecture

```
app/
  layout.tsx          Root layout (html/body, Inter font, metadata)
  (terminal)/layout.tsx  Loads getHubData() once → HubDataProvider → UiProvider → AppShell
  (terminal)/page.tsx + deal-flow/, deal-volume/, ipo-pipeline/, advisors/, valuations/
                      Thin route files: metadata + render one view
  (terminal)/company/[id]/  Company page (CIK, or "n-<name-key>" for companies without one); cached per page for 1h
  globals.css         Design tokens (@theme) + the design file's component classes + responsive rules
components/
  shell/              AppShell (sidebar, top bar, footer, Alt+1–6), GlobalSearch (dropdown), routes.ts
  data/               HubDataProvider: page data + common derived figures via useHubData()
  views/              One view per page (HubView, DealFlowView, ...) + sections.tsx (VolumePanel,
                      ValuationCards, Legend, shared chart state)
  details/            useDetails(): deal / IPO / advisor drawers (overview, advisors, filings, notes),
                      data definitions dialog
  workspace/          store.ts (localStorage prefs via useSyncExternalStore), WorkspaceProvider
                      (watchlist, notes, saved views, columns, density, compare selection),
                      actions.tsx (row menus, copy summary, WatchButton, compare/watchlist/views dialogs)
  charts/             LineChart (Chart.js, design tooltip + crosshair)
  ui/                 Icon, primitives (Kpi, StatusTag, SectorLabel, CompanyMark, Sparkline, Segment,
                      Select, FilterSearch, PageHeading, PanelHead, PageLink), table helpers,
                      UiProvider (modal / side drawer + toast)
lib/
  types.ts            THE DATA CONTRACT: every shape the UI renders
  sampleData.ts       The ONLY file with sample numbers (fictional)
  data.ts             getHubData(): Supabase → .data/castle.json → sample (server-only)
  aggregate.ts        Raw deals → monthly volume, league table, valuation medians (+ public field stripping)
  metrics.ts          Pure derived figures: YTD, momentum, medians, valuation cards
  banks.ts            Known banks, name variants, monograms (shared by ingest + UI)
  activists.ts        Activist stakes: stats, demands, later deals, insights + tests
  buyers.ts           Strategic vs private-equity buyer classification + comparison, insights + tests
  fees.ts             Advisory fees: league by total fees, fee % by deal size, insights + tests
  timelines.ts        Deal timelines: time to close by sector / path / consideration, open-deal progress, insights + tests
  explorer.ts         Volume explorer helpers (month labels, deal sorting) + tests
  precedents.ts       Precedent-transaction screen + comps statistics (percentiles) + tests
  companies.ts        Company profiles derived from deals + IPOs (ids, deal history, banks, filings, search) + tests
  search.ts           Search / filter predicates
  screen.ts           Deal screener model (filters, date windows, sort, chips, columns) + tests
  format.ts           Money, %, multiples, dates
  sectors.ts          Sector colours (UI config)
  csv.ts              Deal export
ingest/               The SEC data engine (Node, run by GitHub Actions; never imported by components)
  run.ts              CLI entry: load store → deals → IPOs → save
  edgar.ts            EDGAR client: User-Agent, ~8 req/s throttle, retries, optional disk cache
  deals.ts            Full-text search → parse → resolve CIKs → merge → status/sector/multiples
  ipos.ts             S-1/F-1 registrants → filters → Filed / Priced (424B4) / Trading
  activists.ts        Schedule 13D activist stakes from the daily form index (stored in meta "activists")
  macro.ts            World Economies: IMF WEO (growth, inflation) + BIS policy rates; failure keeps last snapshot
  financials.ts       XBRL company facts → LTM revenue/EBITDA, debt, cash → EV multiples
  sectors.ts          SIC code → 5 display sectors
  store.ts            JsonStore (.data/castle.json) and SupabaseStore
  text.ts             EDGAR HTML → plain text
  parse/              Pure text parsers (press releases, merger 8-K Item 1.01, merger proxies, fairness opinions, IPO documents, company names) + tests
supabase/migrations/  SQL schema (jsonb `data` column per record, RLS read-only for anon)
.github/workflows/    ingest.yml (every 3 hours; manual backfill / "rebuild" from 2021) and ci.yml (lint/test/build)
app/api/deal/[id]/    Full record for one deal (fairness opinions); the page feed leaves them out
```

### Data rules (important)

- Components **never** import `lib/sampleData.ts` or `ingest/`. They read `HubData` through `useHubData()`, which the terminal layout fills from `getHubData()`.
- **The deployed site never shows sample data.** On Vercel, if Supabase can't be read, `getHubData()` returns empty data with `dataError` and the shell shows a red banner saying why. Sample data exists only for local development before anything is ingested.
- Stored records are the `Deal` / `Ipo` shapes plus ingest-only fields (`StoredDeal`/`StoredIpo` in `ingest/store.ts`); `lib/aggregate.ts` strips those before data reaches the browser. The browser gets up to 4,000 deals and 150 IPOs, so screeners filter client-side. Fairness opinions are left out of the feed (`hasFairness` flag instead; fees go in `HubData.fees`) and loaded from `/api/deal/[id]` when the Valuation tab opens. Keep heavy per-deal detail out of the feed.
- Freshness: ingest every 3 hours; pages regenerate every 15 minutes (`revalidate = 900`). Volume charts cover as many months as the data has (24–72).
- UI copy (badges, notes, footer, methodology) switches on `HubData.isSample`.
- Conventions in `lib/types.ts`: money is plain USD, dates are ISO strings, percentages are whole numbers (34.2 = 34.2%), `null` means undisclosed.
- KPIs, momentum and medians are computed in `lib/metrics.ts` from raw rows. Never hardcode derived numbers in the UI.
- Sample bank names are real institutions, but their activity and ranks are fictional. Keep them labelled as sample data.

### Styling rules

- Prefer the design's component classes in `globals.css` (`.panel`, `.kpis`, `.table-scroll`, `.segmented`, `.status-*`, `.button`, `.modal`, `.detail-drawer`...). Add new classes there, named like the design file's.
- Tailwind utilities and tokens (`bg-panel`, `border-line`, `text-muted`, `text-dim`, `text-up`, `text-down`) are fine for one-off layout tweaks.
- Breakpoints mirror the design: ≤1280px, ≤1020px, ≤760px (phone), ≥1650px (wide). Responsive rules live at the bottom of `globals.css`.

### SEC data engine rules

- **$0:** extraction is regex/heuristics over filing text. No paid APIs, no LLM calls.
- **Never guess:** if a term isn't clearly stated, leave it `null`. Blank is better than wrong.
- **Deal scope:** (1) targets that are SEC registrants listed on a US exchange (NYSE / Nasdaq / NYSE American / Cboe), and (2) **private companies bought by a US-listed acquirer** (`Deal.privateTarget`, id `p-<name>-<date>`). SPAC combinations, OTC / foreign-listed targets, minority stakes, carve-outs of a named company's business ("acquires Honeywell's valve unit") and asset / product-rights purchases are skipped.
- **Private targets:** found by extra full-text searches ("has acquired", "completed the acquisition of", "definitive agreement to acquire", …; `PRIVATE_QUERIES`). A target counts as private when it resolves to no SEC registrant, has no ticker, passes `isPrivateTargetName`, and no public deal already tracks it (catches delisted public targets). They are often signed and closed at once, so a completion release can create one (status Closed). Enrichment (`enrichPrivateDeal`) takes sector / industry from the acquirer and marks Closed on the acquirer's 8-K Item 2.01; no premium, multiples, proxy, fairness or milestones. Premium and valuation medians therefore cover public targets only. The Deal Flow screener has a Public / Private target filter.
- **Three discovery channels** (all in `ingest/deals.ts`):
  1. Press releases (EX-99) found by full-text search → `parse/press.ts`.
  2. Merger 8-Ks with Item 1.01 ("merge with and into the Company", tender offers) → `parse/eightk.ts`, which reads defined terms ("Parent", "Merger Sub", "Ultimate Parent") and names the sponsor behind a shell buyer.
  3. Backstop: every PREM14A / DEFM14A / SC 14D9 / SC 13E3 filer without a deal gets its Item 1.01 8-Ks from the prior 210 days re-parsed (press exhibit first, then the 8-K body).
- **Merging:** documents about the same target (by CIK) merge into one deal. Two announcements for the same target within 14 days are the same deal. A placeholder or shell buyer name ("Parent", "… Merger Sub", "… BidCo") is replaced by a real name from a later document. Only an announcement can create a deal; updates, completions and terminations modify existing deals.
- **Recall benchmark:** `.scratch/recall.mts <from> <to>` (git-ignored) compares deals against merger-proxy filers. It was 32% before the 8-K channels and about 64% after. Many misses are acquirer-side votes, SPACs and BDC mergers, which the benchmark counts even though they are out of scope.
- **Proxy enrichment:** a deal missing its premium or target advisors gets them from the target's DEFM14A / SC 14D9 / PREM14A (`parse/proxy.ts`), read once (`proxyCheckedAt`). It fills blanks only; it never overwrites a press-release value.
- **Premium means premium over the unaffected / last closing price.** Premiums over VWAPs, 52-week highs, earlier proposals or precedent medians are ignored. If only those are stated, the premium stays `null`.
- **Status comes from the target's filing history:** PREM14A / DEFM14A / SC 14D9 / SC TO-T / S-4 → Pending; Form 25 / 15 or an 8-K Item 5.01 → Closed; an 8-K Item 1.02 that mentions terminating the merger agreement → Terminated.
- **Parser changes need a test** in `ingest/parse/*.test.ts`. Fixtures are synthetic text in the style of real filings.
- **EDGAR etiquette:** always go through `ingest/edgar.ts`, which sends the User-Agent and throttles to ~8 requests/second.

## Roadmap

- **Task 1 (done):** scaffold, CLAUDE.md, hub rebuilt as components on sample data.
- **Task 2 (done):** SEC data engine (EDGAR → parsers → Supabase via GitHub Actions; site reads Supabase with 15-minute ISR). History goes back to 2021 (run the workflow with "rebuild").
- **Company pages (done):** every acquirer, target and IPO issuer links to `/company/[id]`. Use `CompanyLink` for company names; generic buyer names ("The Investor Group") get no page.
- **Precedent transactions (done):** `/precedents` (`lib/precedents.ts` + `PrecedentsView`). Screen by sector / industry / size / window, untick outliers, summary rows (high, 75th, mean, median, 25th, low), CSV export. A deal drawer's "Precedents" button opens `/precedents?deal=<id>` seeded from that deal (same sector, ⅓×–3× its size).
- **Fairness-opinion valuation (done):** `ingest/parse/fairness.ts` reads each "Opinion of <Bank>" section of the target's DEFM14A / SC 14D9 / PREM14A: implied per-share ranges by analysis, DCF discount rate / perpetuity growth / terminal multiple, and the bank's fee. Stored as `Deal.fairness`; shown as a football field in the deal drawer's Valuation tab (`components/details/Valuation.tsx`). Ranges are only read inside a bank's section (bids in the background story and termination fees are ignored); a section ends at the next "Opinion of" line, another bank's analysis heading, or a major heading such as the projections. A preliminary proxy is re-read when the definitive one arrives (`fairnessAdsh` / `fairnessCheckedAt`). About 270 of 377 deals have one.
- **Volume explorer (done):** the volume chart's "Expand" button opens a full-screen view (`components/views/VolumeExplorer.tsx`, helpers in `lib/explorer.ts`). Two views: "Trend over time" (the same monthly totals as the panel, from `matrix`; click a month to focus it) and "Every deal" (`components/charts/DealScatter.tsx`: each deal a dot by date × value on a log scale, sized by value, coloured by sector, largest labelled by name; click opens the deal). A side panel explains the selection in plain English (`insights()`), with biggest deals, sector mix and top buyers; the full deal list sits below. Balance: the founder rejected both a many-filter version ("too complicated") and a chart-only version ("just the same chart bigger"). Aim for few controls with a lot to look at. It is a fixed overlay portalled to `<body>` (not a `<dialog>`), so deal drawers open on top; Esc closes a drawer first, then the explorer. `LineChart` supports `onPointClick`, `highlight`, `stacked`, `maxTicks`.
- **Deal timelines (done):** `ingest/timeline.ts` derives `Deal.milestones` (path tender/vote, first filing, definitive proxy, vote held via 8-K Item 5.07, closed, terminated) from the target's filing index during enrichment (no extra requests). `lib/timelines.ts` computes time-to-close stats and plain-English insights; `/timelines` page (`TimelinesView`) and a timeline strip at the top of the deal drawer (`DealTimeline`). Deals closing < 7 days after the first filing Castle saw ("seen at completion") and deals open 18+ months (data gaps) are excluded from timings.
- **Advisory fees (done):** Advisors page has a "Fees earned" view (`AdvisorFees`, model `lib/fees.ts`): fee league table, fee as % of deal by size band, biggest paydays, insights. Fees come from `Deal.fairness[].feeUsd`; `bankFee()` in `parse/fairness.ts` only accepts payments to the adviser (not termination fees or the target's own "fee-related earnings"). Bump `FAIRNESS_PARSER_VERSION` after changing the fairness parser; stored opinions are then re-read on the next ingest.
- **Buyer types (done):** `lib/buyers.ts` classifies each buyer as Strategic or Private equity (known-sponsor list, fund-shaped names, unlisted buyout vehicles); the Valuations page has a "Who pays more" comparison (`BuyerTypes`) and the deal drawer shows the buyer type. Extend the `SPONSORS` list when a sponsor is missed.
- **Activists (done):** `ingest/activists.ts` reads EDGAR's daily form index (full-text search barely indexes XML 13Ds), fetches each new SCHEDULE 13D whose issuer is US-listed (`primary_doc.xml`, parsed in `parse/thirteend.ts`), and keeps activists only: known funds (`KNOWN_ACTIVISTS`) or a concrete campaign in Item 4 after the SEC checklist boilerplate is stripped (`campaignText`). 13D/A amendments are counted from the index. Stored in `meta` key `activists` (newest 300, ~18 months), shown on `/activists` and on company pages. Missing daily index files return 403: use `getDailyIndex`, not `getText`. Backfill: `npm run ingest -- --only activists --from 2025-01-01`.
- **Ideas next:** fairness data in the precedents tool (median DCF range vs offer by sector), alerts, accounts, a data-quality monitor page.
- **Ideas / known gaps:** acquirer-side advisors for deals without a press release (the proxy names the target's bank only); placeholder buyer names when no filing names the sponsor; a "Consumer" sector if the founder wants to split it from Industrials.

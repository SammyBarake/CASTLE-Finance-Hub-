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
- **Serious, modern finance aesthetic.** Monochrome, dense, calm. The castle appears **only** as the logo (`public/castle-logo.png`, a transparent PNG trimmed to the artwork, shown in `components/shell/AppShell.tsx`; never use a logo file with a baked-in background).
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
npm run ingest -- --skip macro         # everything except the named step(s), comma-separated
npm run ingest -- --only deals --rebuild-deals --from 2024-09-01   # re-read all filings with current parsers; drops stale deals at the end
                                       # (also a "rebuild" checkbox on the GitHub Actions "Run workflow" form)
npm run audit                          # data-quality audit of the live database (read-only); -- --local, -- --all
npm run history -- report              # history foundation (what-if engine): see "History foundation" below
npm run ripple -- --shock Tech.valuation=10 --shock vix=10   # what-if ripple engine (read-only), see "Ripple engine" below
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
  data/               HubDataProvider: loads /api/hub once, polls for fresher data, common derived figures via useHubData()
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
  names.ts            Company-name display (SEC tags, all-caps title case); shared with the ingest + tests
  sectors.ts          Sector colours (UI config)
  csv.ts              Deal export
ingest/               The SEC data engine (Node, run by GitHub Actions; never imported by components)
  run.ts              CLI entry: load store → deals → IPOs → save
  edgar.ts            EDGAR client: User-Agent, ~8 req/s throttle, retries, optional disk cache
  deals.ts            Full-text search → parse → resolve CIKs → merge → status/sector/multiples
  ipos.ts             S-1/F-1 registrants → filters → Filed / Priced (424B4) / Trading. Not IPOs, so dropped:
                      direct listings and resales with no bookrunner (`isResaleOnly`; an underwritten IPO sold only
                      by existing holders, like Innio, stays), and SPAC mergers (S-4/F-4 before the S-1 plus an
                      8-K Item 5.06, or no bookrunner). The tracked registration is the IPO's own S-1: a follow-on
                      S-1 after the IPO (WhiteHawk) no longer drops it. A bank in the company's own name isn't a
                      bookrunner ("Baird Medical"). Bump IPO_PARSER_VERSION to re-read stored records
  activists.ts        Schedule 13D activist stakes from the daily form index (stored in meta "activists")
  macro.ts            World Economies: IMF WEO (growth, inflation) + BIS policy rates; failure keeps last snapshot
  financials.ts       XBRL company facts → LTM revenue/EBITDA, debt, cash → EV multiples
  sectors.ts          SIC code → 5 display sectors
  store.ts            JsonStore (.data/castle.json) and SupabaseStore
  tidy.ts             Final pass after each deal ingest: junk records, impossible values, duplicate merge, topped bids + tests
  audit-rules.ts      Data-quality rules (pure); audit.ts prints what fails (`npm run audit`)
  text.ts             EDGAR HTML → plain text
  parse/              Pure text parsers (press releases, merger 8-K Item 1.01, merger proxies, fairness opinions, IPO documents, company names) + tests
  history.ts          History CLI (what-if engine foundation): 2015–2020 deal backfill, IPO history, markets, monthly tables
  historyStore.ts     History storage: .data/history/*.json and the Supabase history tables
  ipoHistory.ts       Priced IPOs since 2015 from 424B4 final prospectuses (same IPO tests as ipos.ts)
  markets.ts          Sector ETF monthly prices (Yahoo chart API) and FRED series (public CSV), no keys
lib/history.ts        Pure builders for sector_monthly / macro_monthly (inflation adjustment, one value type) + tests
lib/ripple/           What-if ripple engine (pure): links.ts (hand-set links config), engine.ts (A = C ⊗ L, M, λ),
                      settings.ts (THE engine settings + presets + slider ranges), advisers.ts (bank outlook),
                      baseline.ts (levels from sector_monthly), insights.ts (takeaways) + tests; CLI ingest/ripple.ts
lib/whatIfData.ts     What-if screen data (server-only): sector_monthly → baselines + "IPO history ready"; /api/what-if
components/whatif/    What-if screen parts: ScenarioPanel, RippleGrid, RangeChart, WhyPanel, AdviserPanel, AssumptionBadge
supabase/migrations/  SQL schema (jsonb `data` column per record, RLS read-only for anon); 0002_history.sql = history tables
.github/workflows/    ingest.yml (full run every 6 hours + a quick 2-day run hourly on weekdays 11:50–23:50 UTC;
                      manual backfill / "rebuild" from 2021), history.yml (2nd of each month) and ci.yml (lint/test/build)
app/api/deal/[id]/    Full record for one deal (fairness opinions); the page feed leaves them out
```

### Data rules (important)

- Components **never** import `lib/sampleData.ts` or `ingest/`. They read `HubData` through `useHubData()`, which the terminal layout fills from `getHubData()`.
- **The deployed site never shows sample data.** On Vercel, if Supabase can't be read, `getHubData()` returns empty data with `dataError` and the shell shows a red banner saying why. Sample data exists only for local development before anything is ingested.
- Stored records are the `Deal` / `Ipo` shapes plus ingest-only fields (`StoredDeal`/`StoredIpo` in `ingest/store.ts`); `lib/aggregate.ts` strips those before data reaches the browser. **The dataset reaches the browser once per visit from `GET /api/hub`** (static, regenerated at most once a minute, compressed, browser-cached 10 minutes with stale-while-revalidate) and stays in memory in `HubDataProvider`; the terminal layout passes only a small boot copy (`bootHubData`: no deals / IPOs / activists / fees). Never pass the full `HubData` through a layout or page again: it shipped ~2.3 MB with every page and every navigation, which on a slow connection meant minutes per click. Until the dataset arrives the page is hidden behind `PageSkeleton`, and clicks are held and replayed (`NavigationProgress hold`). Fairness opinions stay out of the feed (`hasFairness` flag; loaded from `/api/deal/[id]`).
- Freshness: ingest hourly on weekdays (quick run) and every 6 hours (full run). Pages and `/api/hub` regenerate at most once a minute: the shared meta cache in `lib/data.ts` is 60 s, which caps the routes' own `revalidate` (900 / 120). A regeneration is a cache hit unless `asOf` changed. The private repo's 2,000 free Actions minutes cover roughly this cadence; a public repo would allow every 15–30 minutes. Volume charts cover as many months as the data has (24–72).
- **Data cache (performance):** `lib/data.ts` reads Supabase through `unstable_cache`. Meta is re-checked every minute; deals (in 500-row chunks, because Next caps an entry at 2 MB) and IPOs are cached per `asOf` snapshot and shared by every page. Only the fields the site uses are selected. Reads retry transient errors. On Vercel a failed refresh throws, so the last good page keeps being served instead of an empty one. Never make each page read the database on its own: eleven pages × 8 s used to make clicks wait up to a minute.
- **Live updates without a refresh:**
  - `HubDataProvider` polls `GET /api/freshness` (edge-cached 30 s) 3 s after load, then every 30 s while the tab is visible, and again when the tab regains focus or the network returns. When the database `asOf` is newer, it re-fetches `/api/hub?t=…` (no-store; up to 6 tries per new dataset while the cached copy catches up) and swaps the data in place.
  - It must **never** call `revalidatePath` / `revalidateTag` from user traffic. An earlier version did, purging every cached page and making each click wait for a full rebuild.
  - What the user sees: the top-bar `LiveStatus` pill ("Live · updated N min ago"; "2 new deals" / "1 new IPO" / "Updated" for 8 s after an update), new deal / IPO rows glow green for 12 s (`freshness.freshIds`, `.row-fresh`), changed KPI figures count to their new value tinted green / red (`isLiveUpdate()` in `AnimatedNumber`), and charts ease to new values.
- **Navigation feedback:** `NavigationProgress` draws a hairline progress bar from the click until the new page shows.
- UI copy (badges, notes, footer, methodology) switches on `HubData.isSample`.
- Conventions in `lib/types.ts`: money is plain USD, dates are ISO strings, percentages are whole numbers (34.2 = 34.2%), `null` means undisclosed.
- KPIs, momentum and medians are computed in `lib/metrics.ts` from raw rows. Never hardcode derived numbers in the UI.
- Sample bank names are real institutions, but their activity and ranks are fictional. Keep them labelled as sample data.

### Styling rules

- Prefer the design's component classes in `globals.css` (`.panel`, `.kpis`, `.table-scroll`, `.segmented`, `.status-*`, `.button`, `.modal`, `.detail-drawer`...). Add new classes there, named like the design file's.
- Tailwind utilities and tokens (`bg-panel`, `border-line`, `text-muted`, `text-dim`, `text-up`, `text-down`) are fine for one-off layout tweaks.
- Breakpoints mirror the design: ≤1280px, ≤1020px, ≤760px (phone), ≥1650px (wide). Responsive rules live at the bottom of `globals.css`.

### UI conventions (from the October 2026 polish pass; the founder wants clean, organised and professional, never cluttered, and no features removed)

- **Page order:** `PageHeading` (title, subtitle, Export) → `Kpis` → optional `Takeaways` → panels → `AboutData`. The data date lives only in the top bar's live pill, not in headings.
- **`Takeaways`** (primitives): 2–5 short, number-led lines (about 100 characters each) that add something the KPIs don't show. No textbook explanations there; those go in **`AboutData`** (a folded "About this data" disclosure), along with the methodology.
- **Long tables** show `TABLE_PAGE` (25) rows plus `ShowMore` (`components/ui/table.tsx`).
- **Missing values** are always "—" (from `lib/format.ts`).
- **Company names** go through `displayCompanyName` (`lib/names.ts`) in `toPublicDeal` / `toPublicIpo`. It strips SEC state tags and title-cases all-capital names. The ingest uses the same `titleCaseCaps`.
- **Controls:** keep a panel to a few visible controls; rarely used options go in a menu (`openMenu`), like the volume chart's ⚙ (chart style, period, gridlines). The volume legend doubles as the month-on-month scoreboard.
- **Navigation:** six sidebar sections (Hub, M&A, Valuation, Advisors, IPOs, Macro; `SECTIONS` in `components/shell/routes.ts`). A section with several pages shows them as tabs above the page (`SectionTabs`, sliding underline); M&A = Deal Flow · Volume · Deal Terms · Timelines · Activism, Valuation = Multiples · Precedents · What-if. URLs are unchanged. The sidebar link returns to the tab last open in that section. Add a new page to an existing section rather than a new sidebar item.
- **Motion:**
  - page sections rise in one after another (`.page-enter > *`);
  - KPI and valuation figures count up (`AnimatedNumber`, only after hydration, so the first load never flashes);
  - charts grow in, table rows fade in, and hovers and tabs transition.
  - Everything respects the animations setting (`.reduce-motion`) and `prefers-reduced-motion`.

### SEC data engine rules

- **$0:** extraction is regex/heuristics over filing text. No paid APIs, no LLM calls.
- **Never guess:** if a term isn't clearly stated, leave it `null`. Blank is better than wrong.
- **Deal scope:** (1) targets that are SEC registrants listed on a US exchange (NYSE / Nasdaq / NYSE American / Cboe), and (2) **private companies bought by a US-listed acquirer** (`Deal.privateTarget`, id `p-<name>-<date>`). SPAC combinations, investment funds (closed-end funds, ETFs; `FUND_TARGET`), OTC / foreign-listed targets, minority stakes, carve-outs of a named company's business ("acquires Honeywell's valve unit") and asset / product-rights purchases are skipped.
- **Private targets:** found by extra full-text searches ("has acquired", "completed the acquisition of", "definitive agreement to acquire", …; `PRIVATE_QUERIES`). A target counts as private when it resolves to no SEC registrant, has no ticker, passes `isPrivateTargetName`, and no public deal already tracks it (catches delisted public targets). Every candidate is also looked up with EDGAR's company-name search (`lookupCompanies`, by the full name and by `coreName` without trailing descriptors): if it was an exchange-listed reporting company then (`listedOn`: periodic reports in the prior year, still listed or a Form 25 after), it becomes a public-target deal (Abiomed, Hillrom, Enable Midstream). The registrant's name on the deal date must match (`registrantMatches`: the same name ignoring spacing and suffixes, or that name plus descriptors only, so "Fortune" is not Fortune Brands, "Beacon" is not Beacon Financial, and a private "First American" bank is not First American Financial), and it must have been in the middle of being bought (`takenOverAround`: merger proxy, tender response, 425 / DEFA14A or Form 25 within ~18 months before to ~13 after; "Longboard" is not Longboard Pharmaceuticals, "API" is not APi Group). A converted record created from a completion release (`completedAround`: the target's Form 25 / 15 within days of the stored date) gets its real announcement date from the signing 8-K Item 1.01 naming the other party, the target's or else the buyer's (`signingDate`, up to ~21 months back; Capital One / Discover → February 2024, AMD / Xilinx → October 2020, not the closings). It's the 8-K filing date, which can trail the press release by a day or three. Don't infer the date from DEFA14A / 425 alone: annual meetings and a company's own earlier mergers file those too. With a premium but no listed registrant it is OTC / foreign, or a release read backwards ("GenMark acquires Roche"), and is skipped; a per-share price alone stays private (private banks quote one). Stored private deals are re-checked whenever `REGISTRANT_CHECK_VERSION` changes. A party written as its ticker ("Blackstone to acquire PSB") resolves to the filer listing that ticker. `dropPrivateDuplicates` also matches the same buyer's private copy within 45 days by spacing-insensitive prefix, shared first word or the public record's ticker ("HILLROM" = Hill-Rom Holdings). Don't infer reversed roles from the buyer's filing index: bidders file SC TO-T and SC 13E3 under their own CIK too. They are often signed and closed at once, so a completion release can create one (status Closed). Enrichment (`enrichPrivateDeal`) takes sector / industry from the acquirer and marks Closed on the acquirer's 8-K Item 2.01; no premium, multiples, proxy, fairness or milestones. Premium and valuation medians therefore cover public targets only. The Deal Flow screener has a Public / Private target filter.
- **Three discovery channels** (all in `ingest/deals.ts`):
  1. Press releases (EX-99) found by full-text search → `parse/press.ts`.
  2. Merger 8-Ks with Item 1.01 ("merge with and into the Company", tender offers) → `parse/eightk.ts`, which reads defined terms ("Parent", "Merger Sub", "Ultimate Parent") and names the sponsor behind a shell buyer.
  3. Backstop: every PREM14A / DEFM14A / SC 14D9 / SC 13E3 filer without a deal gets its Item 1.01 8-Ks from the prior 210 days re-parsed (press exhibit first, then the 8-K body).
- **Tickers:**
  - A ticker in a release resolves only if the company names agree, because tickers get reused after delistings.
  - A bare all-caps target name ("WBD") counts as a ticker only when the same document lists it on an exchange ("(NASDAQ: WBD)").
  - Otherwise it is treated as an abbreviation and expanded from its definition ("Medical Manufacturing Technologies, LLC ("MMT")", `expandAbbreviation`).
- **Merging:** documents about the same target (by CIK) merge into one deal. Two announcements for the same target within 14 days are the same deal. A placeholder or shell buyer name ("Parent", "… Merger Sub", "… BidCo") is replaced by a real name from a later document. Only an announcement can create a deal; updates, completions and terminations modify existing deals.
- **Recall benchmark:** `.scratch/recall.mts <from> <to>` (git-ignored) compares deals against merger-proxy filers. It was 32% before the 8-K channels and about 64% after. Many misses are acquirer-side votes, SPACs and BDC mergers, which the benchmark counts even though they are out of scope.
- **Proxy enrichment:** a deal missing its premium or target advisors gets them from the target's DEFM14A / SC 14D9 / PREM14A (`parse/proxy.ts`), read once (`proxyCheckedAt`). It fills blanks only; it never overwrites a press-release value.
- **Premium means premium over the unaffected / last closing price.** Premiums over VWAPs, 52-week highs, earlier proposals or precedent medians are ignored. If only those are stated, the premium stays `null`.
- **Status comes from the target's filing history:** PREM14A / DEFM14A / SC 14D9 / SC TO-T / S-4 → Pending; Form 25 / 15 or an 8-K Item 5.01 → Closed; an 8-K Item 1.02 that mentions terminating the merger agreement → Terminated.
- **Names at announcement:** a target's name is the one it had when the deal was announced (`nameOn` reads EDGAR `formerNames`: "FLIR Systems", not "Teledyne FLIR"). When acquirer and target still look identical (`identicalNames`), the acquirer's old name is used too ("Southern California Bancorp"); a buyer that was a SPAC then is dropped, and an exact same name on both sides is dropped.
- **EV and multiples:** none for banks, insurers, brokers (SIC 6000–6499) or mortgage REITs (6798 with a lending name): deposits and repo funding aren't debt. An implied equity value (price × shares) is ignored when the share count is under 500k or the result is more than 2× off the stated value (a reverse split since the last filing). Revenue takes the largest of the revenue tags reported for the latest period (`series(..., largest)`): a REIT tags only fee income as "RevenueFromContractWithCustomer…", which gave Monmouth 57× EV/Revenue.
- **HTML entities:** `decodeEntities` (`ingest/text.ts`) knows the Latin-1 accented letters by name ("&auml;" → "ä"); names like "BillerudKorsnäs" were cut at the undecoded entity before.
- **Consideration (cash / stock / mixed)** is decided by the sentence saying what holders "will receive" first, then the whole text: financing talk ("funded with cash and new shares") made HPE / Juniper look mixed, and "one Union Pacific common share and $88.82 in cash" now reads as mixed. Stored deals pick this up on a rebuild.
- **Activist investor names:** EDGAR lists people surname-first ("ICAHN CARL C"), but filer-typed names come in either order. `individualName` (`parse/thirteend.ts`) applies only to reporting persons the 13D marks as individuals ("IN"): the person's own signature decides ("/s/ Carl C. Icahn"), else an all-capitals EDGAR name is turned around, else the name is left as filed. Stakes under 1% are shown as unknown (a 13D means 5%+). Stored stakes were fixed once (`13dname:` markers in seen docs). `displayName` uses the shared `titleCaseCaps`, so "FUND II LP" stays "Fund II LP"; `displayCompanyName` also repairs "Lp" / "Ii" in stored names.
- **Volume chart range** starts at `coverageStart` (the first month with at least a quarter of a typical month's deals), not at the earliest deal: a few 2020 deals found when they closed made late 2020 look like a collapse.
- **Data quality:**
  - `ingest/tidy.ts` runs after every deal ingest (no requests, so it also repairs old records). It removes implausible names, self-deals and private "targets" that are merger vehicles (`isMergerVehicle`: "… MergerCo", "… Merger Sub"; Holdco / Topco names are real entities, and a registrant's SEC name is never a placeholder), re-cleans names that have no CIK, clears premiums outside −50%…300% and values under $1M, re-checks fees against the final value (`saneFee`: 0.3–10% target, 0.3–12% reverse), keeps a bank on the target side only, merges the same buyer's second record within 60 days ("H&F" = "Hellman & Friedman", `SHORT_FORMS` in `parse/names.ts`), and marks an agreement Terminated when a rival buyer signs with the same listed target within 120 days (Optum over Option Care for Amedisys).
  - Removed records are deleted from Supabase on save (`State.dropped`); a plain upsert would keep them.
  - `npm run audit` checks every rule in `audit-rules.ts`. The October 2026 pass took flagged records from 5.1% to 1.7%. What remains is mostly legitimate or known: EV far above equity for heavily indebted targets (Sotherly, Hall of Fame Resort), placeholder buyers no filing names, and multiples stored before the bank / share-count rules (recomputed by a rebuild). Veoneer is a known miss: EDGAR's name lookup doesn't know it.
- **Parser changes need a test** in `ingest/parse/*.test.ts`. Fixtures are synthetic text in the style of real filings.
- **EDGAR etiquette:** always go through `ingest/edgar.ts`, which sends the User-Agent and throttles to ~8 requests/second.

## History foundation (for the what-if engine)

Separate from the live features: its own tables (`supabase/migrations/0002_history.sql`), its own CLI (`npm run history -- <command>`, `ingest/history.ts`) and local files (`.data/history/`). The live tables and pipelines are unchanged; the only reader on the site is the what-if screen (`sector_monthly`, through `/api/what-if`).

- **`deals_history`**: deals announced 2015–2020, found by the live discovery channels and parsers (`npm run history -- deals --from … --to …`, `ingestDeals(..., { light: true })`). Light enrichment skips fairness opinions and deal protections (gigabytes of proxies); status, sector, names, premium, advisers, milestones and multiples are filled. 2021 onward lives in `deals`; `mergeDeals` combines both without double counting (same id, or same target CIK within 30 days: the live record wins).
- **`ipo_history`**: priced IPOs since 2015 from 424B4 final prospectuses (`ingest/ipoHistory.ts`), with the live pipeline's IPO tests (no earlier periodic report or 424B4, an S-1 / F-1 on file, not a SPAC, fund, resale, direct listing or de-SPAC). Pricing date = the prospectus cover date ("The date of this prospectus is …") when within ten days of the filing, else the filing date. Raise = offer price × cover shares (base deal, no over-allotment). `filingsUntil` reads a company's older submission pages, since `filings.recent` holds only ~1,000 filings.
- **`sector_monthly`** (one row per sector per month, 2015-01 to the last complete month; `lib/history.ts`):
  - **ETF:** XLK = Tech, XLV = Healthcare, XLE = Energy, XLF = Financials, XLI = Industrials. Month-end close, plus the total return from Yahoo's dividend-adjusted close (Stooq now returns 403; other free APIs need keys).
  - **Deals:** counted like the volume chart (terminated excluded). `deal_value_usd` sums **one** value type (default `transaction`, the headline value; `--value-kind equity|enterprise`) in today's dollars (CPI-U, latest published month; October 2025 CPI was never published and is interpolated). Deals left out are counted: `deal_value_null_n` (no value), `deal_value_other_kind_n` (another type).
  - **IPOs:** `ipo_count` = IPOs priced that month (from `ipo_history`).
- **`macro_monthly`**: FRED monthly averages (public CSV, no key): FEDFUNDS, GS10, VIXCLS, CPIAUCSL, and two credit spreads. ICE BofA HY OAS (BAMLH0A0HYM2) is limited on FRED to ~3 years by ICE's licence, so Moody's Baa − 10-year (BAA10Y) is kept as the full-history spread.
- **`snapshots`**: on the 2nd of each month `.github/workflows/history.yml` runs `npm run history -- monthly`. It refreshes markets, adds the last two months' IPOs and rebuilds both monthly tables. It also saves the IPO pipeline as shown and the YTD league table at month end (`kind` = `ipo_pipeline` / `league_table`, `period` = the month just ended), plus the raw market series (`markets` / `latest`) as a fallback when a source fails.
- **`valueKind`** stays in stored records and the server-side read (`DEAL_FIELDS` in `lib/data.ts`, optional `Deal.valueKind`); `toPublicDeal` still leaves it out of the browser feed (tested).
- **Order of work for a fresh history:** `deals` (hours) → `ipos` → `markets` → `recall` (per-year coverage against merger-proxy filers) → `report` (builds the tables locally) → `push` (after the migration). Never run two EDGAR-heavy commands at once: each process throttles itself to ~8 requests a second, and SEC's limit is 10.

## Ripple engine (what-if, v1)

Pure functions in `lib/ripple/`, separate from the existing features; only the what-if screen uses them. Try it with `npm run ripple -- --shock …`.

- **Variables:** 20 = 4 features (valuation = sector ETF, deal count, deal value, IPO count) × 5 sectors, each a % deviation from what would have happened without the shock. Macro inputs (Fed funds, 10-year, Baa spread, VIX) can be shocked in natural units (pp; VIX points) but get no feedback.
- **Links** (`lib/ripple/links.ts`, the only place numbers live):
  - **Feature links C** (lags 0, 1, 2 → C0, C1, C2): elasticities. Strong 1.0, moderate 0.5, weak 0.2.
  - **Sector links L:** each sector reaches itself with 1; the share reaching another sector is strong 0.5, moderate 0.25, weak 0.1.
  - **Macro links M:** % per unit (+1 pp, or +10 VIX points): strong 10, moderate 5, weak 2.
  - Every entry has a direction, strength, lag, one-sentence reason and `status: "assumption — not yet estimated from data"` (a test enforces this).
- **Engine** (`engine.ts`): `A_lag = C_lag ⊗ L` (feature-major index = feature·5 + sector) with self-links zeroed, so a variable's own shock just fades. Shocks hit in quarter 1 and fade by λ = 0.7 a quarter. A lag-ℓ link fires ℓ quarters later and fades from then on: `y_k = λ^(k−1)·s + Σ_ℓ<k λ^(k−1−ℓ)·(A_ℓ·s + M_ℓ·m)`.
  - One link deep in v1 (`rounds: 1`), so hand-set numbers don't compound. `rounds: 2` (or 3, `MAX_ROUNDS`) adds effects of effects; `explain()` then shows the variables a chain passed through (`via`).
  - From quarter 3 every response shrinks by exactly λ.
  - Range: each link's contribution at ±50% (positive and negative contributions bounded separately). A link with an estimated `value` and `range` (status `"estimated from data"`) uses those instead of the strength scale and ±band; once no link is hand-set, `RippleResult.handSet` is false and the screen drops its "assumption" badges.
  - `explain()` lists a result's contributions with the link entries behind each hop.
- **Settings** (`settings.ts`, the single place): fade, range, horizon, rounds, link set, adviser window, presets and slider ranges. Switching on second-round effects or estimated links is a change there only; the screen reads everything from it.
- **Advisers** (`advisers.ts`): each bank's share of sector deal value over the last 3 years (league-table credit, both sides) × the sector's average quarterly deal value × the predicted % change, summed over the quarters. Banks are ranked by predicted change, with range, % of baseline and driving sector.
- **Levels** (`baseline.ts`): turns % responses into quarterly levels using the last four complete quarters of `sector_monthly`.

## What-if screen (`/what-if`, Valuation tab)

`WhatIfView` runs the engine in the browser on every change (it's instant), with `RIPPLE_SETTINGS`. The existing pages are untouched.

- **Inputs** (`ScenarioPanel`): five presets ("Rates +1%" = Fed funds and the 10-year both +1 pp, "VIX spike +15", "Tech rally +20%", "Oil crash (Energy −25%)", "Credit crunch (Baa +2)"), then up to four shocks as chips. Each shock picks a variable (4 features × 5 sectors, or one of 4 macro inputs) and a size by slider or number box, within `SHOCK_RANGES`.
- **Outputs:**
  - `RippleGrid`: sectors × features, green / red with strength relative to the largest knock-on effect, Q1–Q4 segment and play / pause / replay (1.1 s a quarter).
  - `RangeChart`: the selected cell over the quarters, range shaded (a small SVG, not Chart.js), with a level note from the baselines.
  - `WhyPanel`: the selected cell's contributions and each link's direction, strength, lag and reason.
  - `AdviserPanel`: top 5 banks positioned to rise and to fall, with the driving sector; a click selects that sector's deal value and shows why.
- **Honesty rules:** every result carries an "assumption" badge while any link is hand-set, and the page states "Shows direction and strength of likely effects, not price predictions." IPO cells show "IPO history loading" until `ipoHistoryReady` (12+ months of priced IPOs before 2021 in `sector_monthly`, i.e. after the IPO backfill is pushed).
- **Data:** `/api/what-if` (cached an hour) returns baselines from `sector_monthly`. Without the 0002 migration it returns no baselines and the screen still works, minus the level notes.
- Phone: one column, short column headers, ranges hidden in cells.

## Roadmap

- **Task 1 (done):** scaffold, CLAUDE.md, hub rebuilt as components on sample data.
- **Task 2 (done):** SEC data engine (EDGAR → parsers → Supabase via GitHub Actions; site reads Supabase with 15-minute ISR). History goes back to 2021 (run the workflow with "rebuild").
- **Company pages (done):** every acquirer, target and IPO issuer links to `/company/[id]`. Use `CompanyLink` for company names; generic buyer names ("The Investor Group") get no page.
- **What-if (screen done, links hand-set):** history foundation → ripple engine → `/what-if`. Next: estimate link values and ranges from `sector_monthly` / `macro_monthly`, then switch them in through `settings.ts`.
- **Precedent transactions (done):** `/precedents` (`lib/precedents.ts` + `PrecedentsView`). Screen by sector / industry / size / window, untick outliers, summary rows (high, 75th, mean, median, 25th, low), CSV export. A deal drawer's "Precedents" button opens `/precedents?deal=<id>` seeded from that deal (same sector, ⅓×–3× its size).
- **Fairness-opinion valuation (done):** `ingest/parse/fairness.ts` reads each "Opinion of <Bank>" section of the target's DEFM14A / SC 14D9 / PREM14A: implied per-share ranges by analysis, DCF discount rate / perpetuity growth / terminal multiple, and the bank's fee. Stored as `Deal.fairness`; shown as a football field in the deal drawer's Valuation tab (`components/details/Valuation.tsx`). Ranges are only read inside a bank's section (bids in the background story and termination fees are ignored); a section ends at the next "Opinion of" line, another bank's analysis heading, or a major heading such as the projections. A preliminary proxy is re-read when the definitive one arrives (`fairnessAdsh` / `fairnessCheckedAt`). About 270 of 377 deals have one.
- **Volume explorer (done):** the volume chart's "Expand" button opens a full-screen view (`components/views/VolumeExplorer.tsx`, helpers in `lib/explorer.ts`). Two views: "Trend over time" (the same monthly totals as the panel, from `matrix`; click a month to focus it) and "Every deal" (`components/charts/DealScatter.tsx`: each deal a dot by date × value on a log scale, sized by value, coloured by sector, largest labelled by name; click opens the deal). A side panel explains the selection in plain English (`insights()`), with biggest deals, sector mix and top buyers; the full deal list sits below. Balance: the founder rejected both a many-filter version ("too complicated") and a chart-only version ("just the same chart bigger"). Aim for few controls with a lot to look at. It is a fixed overlay portalled to `<body>` (not a `<dialog>`), so deal drawers open on top; Esc closes a drawer first, then the explorer. `LineChart` supports `onPointClick`, `highlight`, `stacked`, `maxTicks`.
- **Deal timelines (done):** `ingest/timeline.ts` derives `Deal.milestones` (path tender/vote, first filing, definitive proxy, vote held via 8-K Item 5.07, closed, terminated) from the target's filing index during enrichment (no extra requests). `lib/timelines.ts` computes time-to-close stats and plain-English insights; `/timelines` page (`TimelinesView`) and a timeline strip at the top of the deal drawer (`DealTimeline`). Deals closing < 7 days after the first filing Castle saw ("seen at completion") and deals open 18+ months (data gaps) are excluded from timings.
- **Advisory fees (done):** Advisors page has a "Fees earned" view (`AdvisorFees`, model `lib/fees.ts`): fee league table, fee as % of deal by size band, biggest paydays, insights. Fees come from `Deal.fairness[].feeUsd`; `bankFee()` in `parse/fairness.ts` only accepts payments to the adviser (not termination fees or the target's own "fee-related earnings"). Bump `FAIRNESS_PARSER_VERSION` after changing the fairness parser; stored opinions are then re-read on the next ingest.
- **Buyer types (done):** `lib/buyers.ts` classifies each buyer as Strategic or Private equity (known-sponsor list, fund-shaped names, unlisted buyout vehicles); the Valuations page has a "Who pays more" comparison (`BuyerTypes`) and the deal drawer shows the buyer type. Extend the `SPONSORS` list when a sponsor is missed.
- **Activists (done):** `ingest/activists.ts` reads EDGAR's daily form index (full-text search barely indexes XML 13Ds), fetches each new SCHEDULE 13D whose issuer is US-listed (`primary_doc.xml`, parsed in `parse/thirteend.ts`), and keeps activists only: known funds (`KNOWN_ACTIVISTS`) or a concrete campaign in Item 4 after the SEC checklist boilerplate is stripped (`campaignText`). 13D/A amendments are counted from the index. Stored in `meta` key `activists` (newest 300, ~18 months), shown on `/activists` and on company pages. Missing daily index files return 403: use `getDailyIndex`, not `getText`. Backfill: `npm run ingest -- --only activists --from 2025-01-01`.
- **Deal terms (done):** `ingest/parse/terms.ts` reads deal protections from the target's merger 8-K (Item 1.01), with gaps filled from its merger proxy:
  - **Fees:** the target's break fee and the buyer's reverse fee. The payer comes from defined terms ("Parent Termination Fee"), "X will pay", or who gets paid. Fees outside 0.3%–10% of deal value (12% for reverse fees) are dropped, re-checked after the final value is known. A full-dollar amount ("$5,560,000") is never multiplied by a unit word that follows it.
  - **Go-shop vs no-shop**, including the go-shop length.
  - **Financing:** the financing condition, and the committed lenders. Advisory-only firms are excluded, and lenders are mostly named in the proxy's "Financing of the Merger".
  - **Storage:** `Deal.terms`, read once per deal (`termsCheckedAt`, `TERMS_PARSER_VERSION`).
  - **Display:** `lib/terms.ts` builds the stats, lender league and labels. The `/deal-terms` page shows fees by size and sector, the lender league (click to filter) and a deals table. The deal drawer has a "Deal protections" section.
  - Calibrated on real filings: about 94% of public deals have a break fee and about half a reverse fee, at market-typical levels (break 2–4%, reverse 4–7%).
- **Tear sheets (done):** printable Letter one-pagers at `/tearsheet/deal/[id]` and `/tearsheet/company/[id]` (route group `app/(print)`, no terminal shell).
  - Server-rendered: `components/tearsheet/*`, from `getDeal` (full record, with fairness) and `getHubData`.
  - Deal sheet contents: headline figures, transaction, deal protections, advisors, sector context (prior 24 months), timeline, and a fairness football field. Company sheet contents: deal history, banks, activists.
  - On screen: white paper on a dark stage, rising in with staggered sections. Print CSS: one page, no toolbar, light colour scheme. The logo is drawn dark with `filter: brightness(0)`.
  - Opened from the deal drawer's "Tear sheet" button and the company page heading.
- **Ideas next:** fairness data in the precedents tool (median DCF range vs offer by sector), alerts, accounts, a data-quality monitor page.
- **Ideas / known gaps:** acquirer-side advisors for deals without a press release (the proxy names the target's bank only); placeholder buyer names when no filing names the sponsor; a "Consumer" sector if the founder wants to split it from Industrials.

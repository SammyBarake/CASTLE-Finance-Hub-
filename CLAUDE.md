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
```

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
  data.ts             getHubData(): the single data entry point (server-only)
  metrics.ts          Pure derived figures: YTD, momentum, medians, valuation cards
  search.ts           Search / filter predicates
  format.ts           Money, %, multiples, dates
  sectors.ts          Sector colours (UI config)
  csv.ts              Deal export
```

### Data rules (important)

- Components **never** import `lib/sampleData.ts`. They get `HubData` from `getHubData()` via props.
- Swapping in real data = change `lib/data.ts` to return the same `HubData` shape from Supabase and set `isSample: false`. UI copy (badges, notes, footer) switches on `isSample` automatically.
- Conventions in `lib/types.ts`: money is plain USD, dates are ISO strings, percentages are whole numbers (34.2 = 34.2%), `null` means undisclosed.
- KPIs, momentum and medians are computed in `lib/metrics.ts` from raw rows. Never hardcode derived numbers in the UI.
- Sample bank names are real institutions, but their activity and ranks are fictional. Keep them labelled as sample data.

### Styling rules

- Use the Tailwind tokens (`bg-panel`, `border-line`, `text-muted`, `text-dim`, `text-accent`, `text-up`, `text-down`...).
- Breakpoints mirror the design's max-width queries. Use `max-laptop:` (≤1250px), `max-tablet:` (≤1000px), `max-phone:` (≤760px), and `wide:` (≥1650px).
- Repeated primitives (`.panel`, `.data-table`, `.segment`, `.status-*`, `.btn`, `.modal`) live in `globals.css` `@layer components`.

## Roadmap

- **Task 1 (done):** scaffold, CLAUDE.md, hub rebuilt as components on sample data.
- **Task 2 (next):** the SEC data engine. EDGAR ingestion (8-K, DEFM14A, S-4, S-1, 424B4) on GitHub Actions cron, writing to Supabase and reading in `lib/data.ts`.
  Do not start Task 2 until the founder asks.

# Castle

A modern, free web terminal for investment banking activity (M&A deal flow, deal volume, the IPO pipeline, advisor league tables and valuation multiples), built on public SEC EDGAR data.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. With nothing configured, the local dev site shows built-in sample data (the deployed site never does).

## Load real SEC data locally

1. Copy `.env.example` to `.env.local` and set `SEC_USER_AGENT` (the SEC requires a contact email).
2. Pull filings into `.data/castle.json`:

   ```bash
   npm run ingest:backfill -- --local
   ```

   This is a 24-month backfill; it's resumable, and `EDGAR_CACHE_DIR=.data/cache` speeds up re-runs.
   For just the last few days, run `npm run ingest -- --local` instead.
3. `npm run dev`. The site now reads the local file.

## Go live

Supabase (database), GitHub Actions (updates every 3 hours) and Vercel (hosting), all on free tiers: see [SETUP.md](SETUP.md).

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · Chart.js · Supabase · GitHub Actions · Vitest.

See [CLAUDE.md](CLAUDE.md) for architecture and project rules.

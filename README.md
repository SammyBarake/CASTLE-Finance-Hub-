# Castle

A modern, free web terminal for investment banking activity (M&A deal flow, deal volume, the IPO pipeline, advisor league tables and valuation multiples), built on public SEC EDGAR data.

> The hub currently runs on **sample (fictional) data**. The SEC EDGAR data engine is the next milestone.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Environment

Copy `.env.example` to `.env.local` when variables are needed. Never commit `.env.local`.

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · Chart.js. Deploys free on Vercel. Data will live in Supabase (free tier), refreshed by GitHub Actions.

See [CLAUDE.md](CLAUDE.md) for architecture and project rules.

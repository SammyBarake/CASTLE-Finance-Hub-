-- Castle: history tables, the data foundation for the what-if engine.
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
-- Separate from the live tables (deals, ipos, meta, seen_docs), which the site reads and these never change.
-- Filled by `npm run history` (ingest/history.ts); the site does not read them yet.

-- Deals announced 2015–2020, read from EDGAR with the live parsers (lighter enrichment: no fairness opinions or deal
-- protections). Same record shape as public.deals; 2021 onward stays in public.deals.
create table if not exists public.deals_history (
  id             text primary key,
  announced_date date not null,
  status         text not null,
  data           jsonb not null,
  updated_at     timestamptz not null default now()
);
create index if not exists deals_history_announced_date_idx on public.deals_history (announced_date);

-- Priced IPOs since 2015, from final prospectuses (424B4).
create table if not exists public.ipo_history (
  id          text primary key,
  priced_date date not null,
  sector      text not null,
  raise_usd   numeric,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);
create index if not exists ipo_history_priced_date_idx on public.ipo_history (priced_date);

-- One row per sector per month (month = first day of the month).
create table if not exists public.sector_monthly (
  sector                  text not null,
  month                   date not null,
  etf_ticker              text not null,
  etf_close               numeric,          -- month-end close, unadjusted
  etf_return_pct          numeric,          -- total return for the month (dividend-adjusted), 2.5 = 2.5%
  deal_count              integer not null, -- deals announced, terminated ones excluded
  deal_value_kind         text not null,    -- the one value type summed: transaction | equity | enterprise
  deal_value_usd          numeric not null, -- sum of that type, in cpi_base_month dollars
  deal_value_n            integer not null, -- deals in that sum
  deal_value_null_n       integer not null, -- deals left out: no disclosed value
  deal_value_other_kind_n integer not null, -- deals left out: a value of another type
  ipo_count               integer not null, -- IPOs priced
  cpi_base_month          date,             -- the CPI month whose dollars deal_value_usd is in
  updated_at              timestamptz not null default now(),
  primary key (sector, month)
);

-- One row per month of FRED series (monthly averages).
create table if not exists public.macro_monthly (
  month            date primary key,
  fed_funds_pct    numeric, -- FEDFUNDS
  treasury_10y_pct numeric, -- GS10
  hy_spread_pct    numeric, -- BAMLH0A0HYM2, ICE BofA US High Yield OAS (FRED keeps only ~3 years)
  baa_spread_pct   numeric, -- BAA10Y, Moody's Baa minus 10-year Treasury (full history)
  vix              numeric, -- VIXCLS
  cpi              numeric, -- CPIAUCSL
  updated_at       timestamptz not null default now()
);

-- Monthly snapshots of what the site showed (IPO pipeline, league table), building real history going forward.
-- kind: ipo_pipeline | league_table | markets (raw ETF and FRED series, kept for fallback). period: "YYYY-MM".
create table if not exists public.snapshots (
  kind     text not null,
  period   text not null,
  taken_at timestamptz not null default now(),
  data     jsonb not null,
  primary key (kind, period)
);

drop trigger if exists deals_history_touch on public.deals_history;
create trigger deals_history_touch before update on public.deals_history for each row execute function public.touch_updated_at();
drop trigger if exists ipo_history_touch on public.ipo_history;
create trigger ipo_history_touch before update on public.ipo_history for each row execute function public.touch_updated_at();
drop trigger if exists sector_monthly_touch on public.sector_monthly;
create trigger sector_monthly_touch before update on public.sector_monthly for each row execute function public.touch_updated_at();
drop trigger if exists macro_monthly_touch on public.macro_monthly;
create trigger macro_monthly_touch before update on public.macro_monthly for each row execute function public.touch_updated_at();

-- Public read-only, like the live tables; only the ingest job (service-role key) writes.
alter table public.deals_history  enable row level security;
alter table public.ipo_history    enable row level security;
alter table public.sector_monthly enable row level security;
alter table public.macro_monthly  enable row level security;
alter table public.snapshots      enable row level security;

drop policy if exists "public read deals_history" on public.deals_history;
create policy "public read deals_history" on public.deals_history for select to anon, authenticated using (true);
drop policy if exists "public read ipo_history" on public.ipo_history;
create policy "public read ipo_history" on public.ipo_history for select to anon, authenticated using (true);
drop policy if exists "public read sector_monthly" on public.sector_monthly;
create policy "public read sector_monthly" on public.sector_monthly for select to anon, authenticated using (true);
drop policy if exists "public read macro_monthly" on public.macro_monthly;
create policy "public read macro_monthly" on public.macro_monthly for select to anon, authenticated using (true);
drop policy if exists "public read snapshots" on public.snapshots;
create policy "public read snapshots" on public.snapshots for select to anon, authenticated using (true);

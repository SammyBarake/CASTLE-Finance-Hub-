-- Castle: initial schema.
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
--
-- Each record's full shape (see lib/types.ts) lives in `data` (jsonb); a few columns
-- are pulled out for ordering and filtering. The website reads with the public anon
-- key and can only SELECT; only the ingest job (service-role key) can write.

create table if not exists public.deals (
  id             text primary key,
  announced_date date not null,
  status         text not null,
  data           jsonb not null,
  updated_at     timestamptz not null default now()
);
create index if not exists deals_announced_date_idx on public.deals (announced_date desc);

create table if not exists public.ipos (
  id         text primary key,
  filed_date date not null,
  stage      text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists ipos_filed_date_idx on public.ipos (filed_date desc);

-- EDGAR documents already processed, so daily runs only read new filings.
create table if not exists public.seen_docs (
  id      text primary key,
  seen_at timestamptz not null default now()
);

-- Small key/value store (e.g. asOf = time of the last successful ingest).
create table if not exists public.meta (
  key   text primary key,
  value jsonb
);

-- Keep updated_at current on upsert.
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists deals_touch on public.deals;
create trigger deals_touch before update on public.deals for each row execute function public.touch_updated_at();
drop trigger if exists ipos_touch on public.ipos;
create trigger ipos_touch before update on public.ipos for each row execute function public.touch_updated_at();

-- Row-level security: public read-only for what the site shows; nothing else.
alter table public.deals     enable row level security;
alter table public.ipos      enable row level security;
alter table public.meta      enable row level security;
alter table public.seen_docs enable row level security;

drop policy if exists "public read deals" on public.deals;
create policy "public read deals" on public.deals for select to anon, authenticated using (true);
drop policy if exists "public read ipos" on public.ipos;
create policy "public read ipos" on public.ipos for select to anon, authenticated using (true);
drop policy if exists "public read meta" on public.meta;
create policy "public read meta" on public.meta for select to anon, authenticated using (true);
-- seen_docs: no policies, so anon/authenticated cannot read or write it.
-- The service-role key used by the ingest job bypasses RLS.

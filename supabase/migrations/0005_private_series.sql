-- Castle doesn't publish raw market series. Nothing on the site reads these two tables (the What-if screen reads only
-- sector_monthly), and the series in them carry their owners' terms: FRED's Baa spread comes with Moody's notice against
-- reproducing it without consent, and the markets snapshot held old share-price series until November 2026.
--
-- The jobs that write and read them use the service-role key, which row-level security doesn't apply to. Row-level
-- security stays on, so with no policy the public keys get no rows.
drop policy if exists "public read macro_monthly" on public.macro_monthly;
drop policy if exists "public read snapshots" on public.snapshots;

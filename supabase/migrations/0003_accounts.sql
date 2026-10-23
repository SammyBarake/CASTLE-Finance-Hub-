-- Castle: optional accounts (Supabase Auth).
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run), after 0001 and 0002.
-- Safe to run again. Then run supabase/tests/0003_accounts_rls.sql to check the rules below.
--
-- A signed-in user's workspace (watchlist, notes, saved screens, display settings; the shape is `Prefs` in
-- lib/workspace.ts) is one row that only that user can read or change. The public (anon) key the website ships
-- with can't see these rows at all.

create table if not exists public.workspaces (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  prefs      jsonb not null,
  -- Bumped on every update. A client saves only if the row is still the revision it read
  -- (`update … where rev = <read>`), so two devices saving at once can't overwrite each other's changes.
  rev        integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint workspaces_prefs_object check (jsonb_typeof(prefs) = 'object'),
  constraint workspaces_prefs_size   check (pg_column_size(prefs) <= 262144)
);

create or replace function public.workspaces_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.rev        = old.rev + 1;
  new.updated_at = now();
  new.user_id    = old.user_id; -- a row can never be moved to another user
  return new;
end $$;

drop trigger if exists workspaces_before_update on public.workspaces;
create trigger workspaces_before_update before update on public.workspaces
  for each row execute function public.workspaces_before_update();

-- Row-level security: each signed-in user reaches only their own row.
alter table public.workspaces enable row level security;

drop policy if exists "own workspace: read" on public.workspaces;
create policy "own workspace: read" on public.workspaces
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "own workspace: create" on public.workspaces;
create policy "own workspace: create" on public.workspaces
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "own workspace: update" on public.workspaces;
create policy "own workspace: update" on public.workspaces
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "own workspace: delete" on public.workspaces;
create policy "own workspace: delete" on public.workspaces
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.workspaces from anon;
grant select, insert, update, delete on public.workspaces to authenticated;

-- "Delete my account": removes the signed-in user from Supabase Auth, and their workspace with it (cascade).
-- Runs with the owner's rights so it can reach auth.users, and only ever deletes the caller.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from auth.users where id = me;
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

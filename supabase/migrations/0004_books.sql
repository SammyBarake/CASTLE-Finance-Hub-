-- Castle: shared deal books. Run once in the Supabase SQL editor, after 0003_accounts.sql. Safe to run again.
-- Then run supabase/tests/0004_books_rls.sql to check the rules below.
--
-- A deal book lives in its author's workspace (workspaces.prefs → books). Sharing one publishes a read-only snapshot
-- here: its title, thesis, comments, chosen byline and deal ids (the shared page shows the deals' live figures).
-- Anyone with the link can read that one book, and nobody can list them: the table itself is closed to the public,
-- and get_shared_book() returns a book only for its exact, unguessable id.

-- Books make a workspace larger: allow up to 1 MB per account (compressed size).
alter table public.workspaces drop constraint if exists workspaces_prefs_size;
alter table public.workspaces add constraint workspaces_prefs_size check (pg_column_size(prefs) <= 1048576);

create table if not exists public.shared_books (
  -- 20 hex characters (about 74 random bits) from a v4 UUID: the link's id.
  id         text primary key default substr(replace(gen_random_uuid()::text, '-', ''), 1, 20),
  owner      uuid not null references auth.users (id) on delete cascade,
  -- The book's id in the owner's workspace: one share link per book.
  book_id    text not null,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shared_books_one_per_book unique (owner, book_id),
  constraint shared_books_data_object check (jsonb_typeof(data) = 'object'),
  constraint shared_books_data_size   check (pg_column_size(data) <= 131072)
);

create or replace function public.shared_books_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  new.id         = old.id;     -- a link never changes
  new.owner      = old.owner;  -- nor its owner
  new.book_id    = old.book_id;
  return new;
end $$;

drop trigger if exists shared_books_before_update on public.shared_books;
create trigger shared_books_before_update before update on public.shared_books
  for each row execute function public.shared_books_before_update();

-- Owners manage their own shared books (up to 25); nobody else reaches the table directly.
alter table public.shared_books enable row level security;

drop policy if exists "own shared books: read" on public.shared_books;
create policy "own shared books: read" on public.shared_books
  for select to authenticated using ((select auth.uid()) = owner);
drop policy if exists "own shared books: create" on public.shared_books;
create policy "own shared books: create" on public.shared_books
  for insert to authenticated with check (
    (select auth.uid()) = owner
    and (select count(*) from public.shared_books s where s.owner = (select auth.uid())) < 25
  );
drop policy if exists "own shared books: update" on public.shared_books;
create policy "own shared books: update" on public.shared_books
  for update to authenticated using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
drop policy if exists "own shared books: delete" on public.shared_books;
create policy "own shared books: delete" on public.shared_books
  for delete to authenticated using ((select auth.uid()) = owner);

revoke all on public.shared_books from anon;
grant select, insert, update, delete on public.shared_books to authenticated;

-- The one public way in: a single book by its exact id (no listing, no owner id in the result).
create or replace function public.get_shared_book(p_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('data', b.data, 'updatedAt', b.updated_at)
  from public.shared_books b
  where b.id = p_id;
$$;

revoke all on function public.get_shared_book(text) from public;
grant execute on function public.get_shared_book(text) to anon, authenticated;

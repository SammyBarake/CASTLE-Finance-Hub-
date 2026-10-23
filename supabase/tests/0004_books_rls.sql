-- Checks the shared deal book rules in 0004_books.sql. Paste into the Supabase SQL editor and run.
-- Everything happens inside one transaction that is rolled back at the end. The last result reads
-- "All shared book checks passed"; any failure stops with "FAIL: …".

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'castle-test-a@example.invalid'),
  ('00000000-0000-4000-8000-00000000000b', 'castle-test-b@example.invalid');

-- A shares a book (its link id is kept in a transaction setting for the later steps).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$ declare link text; begin
  insert into public.shared_books (owner, book_id, data)
    values ('00000000-0000-4000-8000-00000000000a', 'btest', '{"title":"Software take-privates","items":[]}')
    returning id into link;
  perform set_config('castle.test_link', link, true);
  if link !~ '^[a-f0-9]{20}$' then raise exception 'FAIL: link id has the wrong shape: %', link; end if;
  begin
    insert into public.shared_books (owner, book_id, data) values ('00000000-0000-4000-8000-00000000000b', 'bforged', '{}');
    raise exception 'FAIL: A published a book as B';
  exception when insufficient_privilege then null;
  end;
  update public.shared_books set id = 'aaaaaaaaaaaaaaaaaaaa', data = '{"title":"Renamed","items":[]}' where id = link;
  if not exists (select 1 from public.shared_books where id = link and data->>'title' = 'Renamed') then
    raise exception 'FAIL: the owner could not update the book, or its link changed';
  end if;
end $$;

-- B can't see, change or delete A's book directly.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
do $$ declare n integer; link text := current_setting('castle.test_link'); begin
  if (select count(*) from public.shared_books) <> 0 then raise exception 'FAIL: B can list A''s shared books'; end if;
  update public.shared_books set data = '{}' where id = link;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B changed A''s book'; end if;
  delete from public.shared_books where id = link;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B deleted A''s book'; end if;
end $$;

-- The public key: no table access, but the exact link opens the book (and reveals no owner).
reset role;
set local role anon;
do $$ declare link text := current_setting('castle.test_link'); book jsonb; begin
  begin
    perform 1 from public.shared_books;
    raise exception 'FAIL: the anon key can list shared books';
  exception when insufficient_privilege then null;
  end;
  book := public.get_shared_book(link);
  if book is null or book->'data'->>'title' <> 'Renamed' then raise exception 'FAIL: the link does not open the book'; end if;
  if book ? 'owner' or book->'data' ? 'owner' then raise exception 'FAIL: the link reveals the owner'; end if;
  if public.get_shared_book('0000000000000000ffff') is not null then raise exception 'FAIL: a made-up link opened something'; end if;
end $$;

-- Deleting A's account takes A's shared books with it.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select public.delete_my_account();
reset role;
do $$ begin
  if exists (select 1 from public.shared_books where owner = '00000000-0000-4000-8000-00000000000a') then raise exception 'FAIL: shared books outlived the account'; end if;
end $$;

select 'All shared book checks passed' as result;

rollback;

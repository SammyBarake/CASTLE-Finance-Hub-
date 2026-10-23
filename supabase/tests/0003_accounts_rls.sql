-- Checks the account rules in 0003_accounts.sql. Paste into the Supabase SQL editor and run.
-- Everything happens inside one transaction that is rolled back at the end: the two test users and their rows are
-- never kept. The last result reads "All account checks passed"; any failure stops with "FAIL: …".

begin;

-- Two throwaway users, A and B.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'castle-test-a@example.invalid'),
  ('00000000-0000-4000-8000-00000000000b', 'castle-test-b@example.invalid');

-- Act as A (what Supabase does for a request carrying A's sign-in token).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

insert into public.workspaces (user_id, prefs) values ('00000000-0000-4000-8000-00000000000a', '{"watch":["deal:a"]}');

do $$ begin
  begin
    insert into public.workspaces (user_id, prefs) values ('00000000-0000-4000-8000-00000000000b', '{}');
    raise exception 'FAIL: A created a workspace for B';
  exception when insufficient_privilege then null; -- refused by row-level security, as it should be
  end;
end $$;

do $$ declare r integer; begin
  update public.workspaces set prefs = '{"watch":["deal:a","deal:b"]}' where user_id = '00000000-0000-4000-8000-00000000000a';
  select rev into r from public.workspaces where user_id = '00000000-0000-4000-8000-00000000000a';
  if r <> 1 then raise exception 'FAIL: rev should be 1 after one update, is %', r; end if;
  update public.workspaces set user_id = '00000000-0000-4000-8000-00000000000b' where user_id = '00000000-0000-4000-8000-00000000000a';
  if not exists (select 1 from public.workspaces where user_id = '00000000-0000-4000-8000-00000000000a') then
    raise exception 'FAIL: A moved their row to B';
  end if;
end $$;

-- Act as B: A's row must be invisible and untouchable.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

do $$ declare n integer; begin
  if (select count(*) from public.workspaces) <> 0 then raise exception 'FAIL: B can read A''s workspace'; end if;
  update public.workspaces set prefs = '{}' where user_id = '00000000-0000-4000-8000-00000000000a';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B changed A''s workspace'; end if;
  delete from public.workspaces where user_id = '00000000-0000-4000-8000-00000000000a';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B deleted A''s workspace'; end if;
end $$;

-- The public website key (anon) can't read workspaces at all, or delete accounts.
reset role;
set local role anon;
do $$ begin
  begin
    perform 1 from public.workspaces;
    raise exception 'FAIL: the anon key can read workspaces';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.delete_my_account();
    raise exception 'FAIL: the anon key can call delete_my_account';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A deletes their account: the user and their workspace go; B is untouched.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select public.delete_my_account();
reset role;

do $$ begin
  if exists (select 1 from auth.users where id = '00000000-0000-4000-8000-00000000000a') then raise exception 'FAIL: A''s account still exists'; end if;
  if exists (select 1 from public.workspaces where user_id = '00000000-0000-4000-8000-00000000000a') then raise exception 'FAIL: A''s workspace outlived the account'; end if;
  if not exists (select 1 from auth.users where id = '00000000-0000-4000-8000-00000000000b') then raise exception 'FAIL: deleting A removed B'; end if;
end $$;

select 'All account checks passed' as result;

rollback;

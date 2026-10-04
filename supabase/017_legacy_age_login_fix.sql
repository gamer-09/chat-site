-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · legacy account age verification/login fix
-- Run AFTER 016_existing_account_age_verification.sql in Supabase SQL Editor.
--
-- Purpose:
--   • Existing accounts made before the age gate stay unverified by default.
--   • Fresh login creates/refreshes account_sessions and returns age_confirmed.
--   • If an old local session has no server session, the app forces re-login
--     instead of silently skipping the 13+ verification.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

alter table public.accounts
  add column if not exists age_confirmed boolean not null default false,
  add column if not exists age_confirmed_at timestamptz;

create or replace function public.account_age_status(acct uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  ok_session boolean;
  confirmed boolean;
begin
  if auth.uid() is null then
    return '{"ok":false,"error":"not_authenticated"}'::jsonb;
  end if;

  select exists (
    select 1 from public.account_sessions s
    where s.account_id = acct
      and s.auth_uid = auth.uid()::text
      and s.expires_at > now()
  ) into ok_session;

  if not ok_session then
    return '{"ok":false,"error":"forbidden"}'::jsonb;
  end if;

  select coalesce(a.age_confirmed, false) into confirmed
    from public.accounts a where a.id = acct;

  return jsonb_build_object('ok', true, 'age_confirmed', coalesce(confirmed, false));
end;
$$;

create or replace function public.confirm_account_age(acct uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  ok_session boolean;
begin
  if auth.uid() is null then
    return '{"ok":false,"error":"not_authenticated"}'::jsonb;
  end if;

  select exists (
    select 1 from public.account_sessions s
    where s.account_id = acct
      and s.auth_uid = auth.uid()::text
      and s.expires_at > now()
  ) into ok_session;

  if not ok_session then
    return '{"ok":false,"error":"forbidden"}'::jsonb;
  end if;

  update public.accounts
     set age_confirmed = true,
         age_confirmed_at = coalesce(age_confirmed_at, now())
   where id = acct;

  return '{"ok":true,"age_confirmed":true}'::jsonb;
end;
$$;

create or replace function public.login_account(un text, pass text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  acc public.accounts%rowtype;
  lock public.login_locks%rowtype;
  pepper constant text := 'ptr29::v1::9f2c4a81d3b6e057';
begin
  if auth.uid() is null then
    return '{"ok":false,"error":"not_authenticated"}'::jsonb;
  end if;
  if pass is null or pass !~ '^[0-9a-f]{64}$' then
    return '{"ok":false,"error":"invalid_credentials"}'::jsonb;
  end if;

  select * into lock from public.login_locks l where l.uname = lower(un);
  if found and lock.locked_until is not null and lock.locked_until > now() then
    return '{"ok":false,"error":"locked"}'::jsonb;
  end if;

  select * into acc from public.accounts a where lower(a.username) = lower(un);
  if not found then
    perform crypt(pass || pepper, gen_salt('bf', 12));
    return '{"ok":false,"error":"invalid_credentials"}'::jsonb;
  end if;

  if acc.pass_hash <> crypt(pass || pepper, acc.pass_hash) then
    insert into public.login_locks (uname, fails) values (lower(un), 1)
    on conflict (uname) do update
      set fails = public.login_locks.fails + 1,
          locked_until = case
            when public.login_locks.fails + 1 >= 5 then now() + interval '15 minutes'
            else public.login_locks.locked_until end;
    return '{"ok":false,"error":"invalid_credentials"}'::jsonb;
  end if;

  delete from public.login_locks l where l.uname = lower(un);

  insert into public.account_sessions (account_id, auth_uid)
  values (acc.id, auth.uid()::text)
  on conflict (account_id, auth_uid) do update
    set last_seen = now(), expires_at = now() + interval '30 days';

  return jsonb_build_object(
    'ok', true,
    'id', acc.id,
    'username', acc.username,
    'avatar', coalesce(acc.avatar, ''),
    'age_confirmed', coalesce(acc.age_confirmed, false)
  );
end;
$$;

grant execute on function public.account_age_status(uuid) to anon, authenticated;
grant execute on function public.confirm_account_age(uuid) to anon, authenticated;
grant execute on function public.login_account(text, text) to anon, authenticated;

-- Done.

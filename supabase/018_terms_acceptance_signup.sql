-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · server-enforced Terms acceptance for signup
-- Run AFTER 017_legacy_age_login_fix.sql in Supabase SQL Editor.
--
-- Fixes: account creation must explicitly accept Terms/Privacy.
-- The app no longer auto-accepts terms in local storage, and this RPC
-- change prevents direct Supabase calls from bypassing Terms acceptance.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

alter table public.accounts
  add column if not exists terms_accepted boolean not null default false,
  add column if not exists terms_accepted_at timestamptz;

drop function if exists public.register_account(text, text);
drop function if exists public.register_account(text, text, boolean);
drop function if exists public.register_account(text, text, boolean, boolean);

create or replace function public.register_account(un text, pass text, age_confirmed boolean, terms_accepted boolean)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  acc public.accounts%rowtype;
  pepper constant text := 'ptr29::v1::9f2c4a81d3b6e057';
begin
  if auth.uid() is null then
    return '{"ok":false,"error":"not_authenticated"}'::jsonb;
  end if;
  if age_confirmed is not true then
    return '{"ok":false,"error":"age_required"}'::jsonb;
  end if;
  if terms_accepted is not true then
    return '{"ok":false,"error":"terms_required"}'::jsonb;
  end if;
  if lower(un) = 'anonymous' or length(un) < 2 or length(un) > 50 or un ~ '[\r\n\t]' then
    return '{"ok":false,"error":"invalid_username"}'::jsonb;
  end if;
  if pass is null or pass !~ '^[0-9a-f]{64}$' then
    return '{"ok":false,"error":"invalid_credentials"}'::jsonb;
  end if;
  if exists (select 1 from public.accounts a where lower(a.username) = lower(un)) then
    return '{"ok":false,"error":"taken"}'::jsonb;
  end if;

  insert into public.accounts (username, pass_hash, age_confirmed, age_confirmed_at, terms_accepted, terms_accepted_at)
  values (un, crypt(pass || pepper, gen_salt('bf', 12)), true, now(), true, now())
  returning * into acc;

  insert into public.account_sessions (account_id, auth_uid)
  values (acc.id, auth.uid()::text)
  on conflict (account_id, auth_uid) do update
    set last_seen = now(), expires_at = now() + interval '30 days';

  return jsonb_build_object(
    'ok', true,
    'id', acc.id,
    'username', acc.username,
    'age_confirmed', true,
    'terms_accepted', true
  );
end;
$$;

-- Keep login response aware of stored terms state.
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
    'age_confirmed', coalesce(acc.age_confirmed, false),
    'terms_accepted', coalesce(acc.terms_accepted, false)
  );
end;
$$;

grant execute on function public.register_account(text, text, boolean, boolean) to anon, authenticated;
grant execute on function public.login_account(text, text) to anon, authenticated;

-- Done.

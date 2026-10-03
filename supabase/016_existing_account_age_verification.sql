-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · age verification for existing accounts
-- Run AFTER 015_age_gate_signup.sql in Supabase SQL Editor.
--
-- Existing accounts created before the age gate default to unverified.
-- The app will prompt them to confirm they are at least 13, then this
-- migration stores that confirmation server-side.
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

drop function if exists public.register_account(text, text);
drop function if exists public.register_account(text, text, boolean);

create or replace function public.register_account(un text, pass text, age_confirmed boolean)
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
  if lower(un) = 'anonymous' or length(un) < 2 or length(un) > 50 or un ~ '[\r\n\t]' then
    return '{"ok":false,"error":"invalid_username"}'::jsonb;
  end if;
  if pass is null or pass !~ '^[0-9a-f]{64}$' then
    return '{"ok":false,"error":"invalid_credentials"}'::jsonb;
  end if;
  if exists (select 1 from public.accounts a where lower(a.username) = lower(un)) then
    return '{"ok":false,"error":"taken"}'::jsonb;
  end if;

  insert into public.accounts (username, pass_hash, age_confirmed, age_confirmed_at)
  values (un, crypt(pass || pepper, gen_salt('bf', 12)), true, now())
  returning * into acc;

  insert into public.account_sessions (account_id, auth_uid)
  values (acc.id, auth.uid()::text)
  on conflict (account_id, auth_uid) do update
    set last_seen = now(), expires_at = now() + interval '30 days';

  return jsonb_build_object('ok', true, 'id', acc.id, 'username', acc.username, 'age_confirmed', true);
end;
$$;

grant execute on function public.account_age_status(uuid) to anon, authenticated;
grant execute on function public.confirm_account_age(uuid) to anon, authenticated;
grant execute on function public.register_account(text, text, boolean) to anon, authenticated;

-- Done.

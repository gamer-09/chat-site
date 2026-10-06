-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · block login/use of accounts containing "anonymous"
-- Run AFTER 024_ban_anonymous_usernames.sql in Supabase SQL Editor.
--
-- 024 blocked new usernames and direct public.users changes. This migration
-- also blocks legacy accounts whose existing account username contains
-- "anonymous" anywhere, case-insensitively, from logging in/continuing use.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

create or replace function public.ptr29_username_reserved(un text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(un, '')) like '%anonymous%';
$$;

grant execute on function public.ptr29_username_reserved(text) to anon, authenticated;

create or replace function public.login_account(un text, pass text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  acc public.accounts%rowtype;
  lock public.login_locks%rowtype;
  out_avatar text := '';
  pepper constant text := 'ptr29::v1::9f2c4a81d3b6e057';
begin
  if auth.uid() is null then
    return '{"ok":false,"error":"not_authenticated"}'::jsonb;
  end if;
  if pass is null or pass !~ '^[0-9a-f]{64}$' then
    return '{"ok":false,"error":"invalid_credentials"}'::jsonb;
  end if;

  -- Do not even attempt login with newly reserved names.
  if public.ptr29_username_reserved(un) then
    return '{"ok":false,"error":"invalid_username"}'::jsonb;
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

  -- Also block legacy accounts that already exist with anonymous variants.
  if public.ptr29_username_reserved(acc.username) then
    return '{"ok":false,"error":"invalid_username"}'::jsonb;
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

  out_avatar := coalesce(acc.avatar, '');
  if out_avatar = '' then
    select coalesce(u.avatar, '') into out_avatar
      from public.users u
     where u.client_id = acc.id::text
        or lower(u.username) = lower(acc.username)
     order by case when u.client_id = acc.id::text then 0 else 1 end,
              u.last_seen desc
     limit 1;
    out_avatar := coalesce(out_avatar, '');
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', acc.id,
    'username', acc.username,
    'avatar', out_avatar,
    'age_confirmed', coalesce(acc.age_confirmed, false),
    'terms_accepted', coalesce(acc.terms_accepted, false)
  );
end;
$$;

grant execute on function public.login_account(text, text) to anon, authenticated;

-- Done.

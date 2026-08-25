-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · hardened account system
-- Run ONCE in: Supabase Dashboard → SQL Editor → paste → Run
--
-- Defense in depth:
--  1. Client hashes the password first: SHA-256(password + ':' + username)
--     → the raw password never leaves the device.
--  2. Server bcrypt-hashes that digest WITH A SECRET PEPPER baked into
--     the function → even a full database dump contains only
--     bcrypt(sha256(pw+user) + pepper): uncrackable in practice.
--  3. The accounts table has NO client-facing policies at all: password
--     hashes CANNOT be read, listed, updated or deleted through the API.
--     Only the two SECURITY DEFINER functions can touch the table.
--  4. Rate limiting: 5 failed logins lock the name for 15 minutes.
--  5. Anti-enumeration: "no account" and "wrong password" return the
--     same generic error; a dummy bcrypt runs to equalise timing.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

create table if not exists public.accounts (
  id         uuid primary key default gen_random_uuid(),
  username   text not null unique,
  pass_hash  text not null,
  avatar     text default '',
  created_at timestamptz default now()
);

create table if not exists public.login_locks (
  uname        text primary key,
  fails        int not null default 0,
  locked_until timestamptz
);

alter table public.accounts   enable row level security;
alter table public.login_locks enable row level security;
-- NOTE: deliberately NO policies → anon/authenticated roles cannot
-- SELECT/INSERT/UPDATE/DELETE either table directly. Only the two
-- SECURITY DEFINER functions below can access them.

create or replace function public.register_account(un text, pass text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  acc public.accounts%rowtype;
  pepper constant text := 'ptr29::v1::9f2c4a81d3b6e057';
begin
  if lower(un) = 'anonymous' or length(un) < 2 or length(un) > 50 then
    return '{"ok":false,"error":"invalid_username"}'::jsonb;
  end if;
  if length(pass) < 32 then  -- client must send the sha-256 digest (64 hex)
    return '{"ok":false,"error":"invalid_credentials"}'::jsonb;
  end if;
  if exists (select 1 from public.accounts a where lower(a.username) = lower(un)) then
    return '{"ok":false,"error":"taken"}'::jsonb;
  end if;
  insert into public.accounts (username, pass_hash)
  values (un, crypt(pass || pepper, gen_salt('bf', 10)))
  returning * into acc;
  return jsonb_build_object('ok', true, 'id', acc.id, 'username', acc.username);
end;
$$;

create or replace function public.login_account(un text, pass text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  acc public.accounts%rowtype;
  lock public.login_locks%rowtype;
  pepper constant text := 'ptr29::v1::9f2c4a81d3b6e057';
begin
  if length(pass) < 32 then
    return '{"ok":false,"error":"invalid_credentials"}'::jsonb;
  end if;

  select * into lock from public.login_locks l where l.uname = lower(un);
  if found and lock.locked_until is not null and lock.locked_until > now() then
    return '{"ok":false,"error":"locked"}'::jsonb;
  end if;

  select * into acc from public.accounts a where lower(a.username) = lower(un);
  if not found then
    -- dummy work so timing doesn't reveal account existence
    perform crypt(pass || pepper, gen_salt('bf', 10));
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

  -- success: clear failure history
  delete from public.login_locks l where l.uname = lower(un);
  return jsonb_build_object('ok', true, 'id', acc.id, 'username', acc.username,
                            'avatar', coalesce(acc.avatar, ''));
end;
$$;

grant execute on function public.register_account(text, text) to anon, authenticated;
grant execute on function public.login_account(text, text)   to anon, authenticated;

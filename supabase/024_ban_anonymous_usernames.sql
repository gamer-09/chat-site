-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · ban usernames containing "anonymous"
-- Run AFTER 023_account_profile_terms_sync.sql in Supabase SQL Editor.
--
-- Blocks any user-chosen username containing "anonymous" anywhere,
-- case-insensitive: anonymous, anonymous123, myAnonymousName, etc.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.ptr29_username_reserved(un text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(un, '')) like '%anonymous%';
$$;

grant execute on function public.ptr29_username_reserved(text) to anon, authenticated;

create or replace function public.username_available(un text, cid text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  if public.ptr29_username_reserved(un) then
    return 'taken';
  end if;

  select client_id into r
    from public.users
   where lower(username) = lower(un)
   limit 1;
  if not found then
    return 'available';
  end if;
  if r.client_id = cid then
    return 'mine';
  end if;
  if not exists (
    select 1 from public.presence p
     where lower(p.username) = lower(un)
  ) then
    delete from public.users where lower(username) = lower(un);
    return 'available';
  end if;
  return 'taken';
end;
$$;

grant execute on function public.username_available(text, text) to anon, authenticated;

-- Update the current register_account signature to reject reserved usernames.
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
  if public.ptr29_username_reserved(un) or length(un) < 2 or length(un) > 50 or un ~ '[\r\n\t]' then
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

grant execute on function public.register_account(text, text, boolean, boolean) to anon, authenticated;

-- Optional trigger blocks direct inserts/updates to public.users for new rows.
create or replace function public.prevent_reserved_usernames()
returns trigger
language plpgsql
as $$
begin
  if public.ptr29_username_reserved(new.username) then
    raise exception 'reserved_username';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_reserved_usernames on public.users;
create trigger trg_prevent_reserved_usernames
before insert or update of username on public.users
for each row execute function public.prevent_reserved_usernames();

-- Done.

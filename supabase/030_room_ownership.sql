-- 030_room_ownership.sql
-- Fix room ownership for rooms created before the identity fix.
--
-- Background: rooms were inserted with owner_id = the browser's anonymous auth
-- uid instead of the signed-in account id. Because the users table also had a
-- legacy row keyed by that same browser uid (carrying the name of whoever last
-- used the browser), a room created by a newly signed-in account was displayed
-- as owned/admined by the PREVIOUS account.
--
-- This migration adds a self-service repair: a signed-in account can re-assign
-- the rooms that THIS BROWSER created (owner_id = its own auth uid). It can never
-- touch rooms owned by anyone else, and it only works for an account this
-- browser is actually signed in as (verified against account_sessions).

create or replace function public.claim_browser_rooms(p_acct text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  text := auth.uid()::text;
  v_name text;
  n_rooms int := 0;
  n_users int := 0;
begin
  if v_uid is null or v_uid = '' then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if p_acct is null or p_acct = '' then
    return jsonb_build_object('ok', false, 'error', 'no_account');
  end if;

  -- the caller must really be signed in as this account on this browser
  if not exists (
    select 1 from public.account_sessions s
     where s.account_id::text = p_acct
       and s.auth_uid = v_uid
       and (s.expires_at is null or s.expires_at > now())
  ) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select a.username into v_name from public.accounts a where a.id::text = p_acct;

  -- 1) hand the browser-owned rooms to the signed-in account
  update public.rooms r
     set owner_id = p_acct,
         admins = (
           select coalesce(array_agg(distinct x), '{}'::text[])
             from unnest(coalesce(r.admins, '{}'::text[]) || array[p_acct]) as x
            where x is not null and x <> '' and x <> v_uid
         ),
         members = (
           select coalesce(array_agg(distinct x), '{}'::text[])
             from unnest(coalesce(r.members, '{}'::text[])) as x
            where x is not null and x <> '' and x <> v_uid
         )
   where r.owner_id = v_uid;
  get diagnostics n_rooms = row_count;

  -- 2) drop the legacy users row keyed by the browser uid (it is not an account
  --    id, so it can only be a stale row from the pre-account identity model)
  delete from public.users u
   where u.client_id = v_uid
     and not exists (select 1 from public.accounts a where a.id::text = u.client_id);
  get diagnostics n_users = row_count;

  return jsonb_build_object('ok', true, 'rooms', n_rooms, 'cleaned_users', n_users, 'username', coalesce(v_name, ''));
end;
$$;

grant execute on function public.claim_browser_rooms(text) to anon, authenticated;

-- Repair a room from the SQL editor (operator only), e.g. a room made on a
-- device you no longer have signed in:
--   select public.operator_reassign_room('my-room-name', 'wenny');
create or replace function public.operator_reassign_room(p_room text, p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acct public.accounts%rowtype;
  v_room public.rooms%rowtype;
  v_old  text;
begin
  select * into v_acct from public.accounts a where lower(a.username) = lower(p_username);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'account_not_found');
  end if;

  select * into v_room from public.rooms r where r.name = p_room;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'room_not_found');
  end if;

  v_old := v_room.owner_id;

  update public.rooms r
     set owner_id = v_acct.id::text,
         admins = (
           select coalesce(array_agg(distinct x), '{}'::text[])
             from unnest(coalesce(r.admins, '{}'::text[]) || array[v_acct.id::text]) as x
            where x is not null and x <> '' and x <> coalesce(v_old, '')
         )
   where r.name = p_room;

  return jsonb_build_object('ok', true, 'room', p_room, 'from', v_old, 'to', v_acct.username);
end;
$$;

-- keep it out of the public API surface: run it yourself in the SQL editor
revoke all on function public.operator_reassign_room(text, text) from anon, authenticated;

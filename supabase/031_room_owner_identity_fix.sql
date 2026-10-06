-- 031_room_owner_identity_fix.sql
-- Corrects the earlier room-ownership repair.
--
-- What went wrong with 030: it moved rooms from the browser's auth uid to the
-- ACCOUNT id. Every server-side rule in this project (rooms RLS, delete_room,
-- rename_room, set-room-passkey, the manager checks inside the room RPCs) keys
-- off auth.uid(), so an owner whose rooms pointed at an account id was refused
-- their own admin commands — including Delete room.
--
-- Ownership therefore belongs in the auth-uid space. The reason rooms looked
-- like they were owned by a PREVIOUS account was never ownership at all: the
-- users row keyed by this browser's uid still carried that account's name, so
-- the owner name resolved wrong. This migration:
--   1. moves any room owned by an account id back to the auth uid bound to that
--      account (from account_sessions), so the owner can manage it again;
--   2. stores the account's current username/avatar on that users row, so the
--      owner is displayed under the signed-in account;
--   3. keeps a clean operator tool for hand repair.

-- ── 1 + 2: repair rows, account by account ──────────────────────────────────
do $$
declare
  r record;
  fixed_rooms int := 0;
  total_rooms int := 0;
begin
  -- rooms whose owner_id is an account id (only possible from migration 030)
  for r in
    select rm.name,
           rm.owner_id                as acct_id,
           coalesce(rm.admins, '{}')  as admins,
           a.username                 as uname,
           a.avatar                   as uavatar,
           (select s.auth_uid
              from public.account_sessions s
             where s.account_id = a.id
             order by s.last_seen desc nulls last
             limit 1)                 as auth_uid
      from public.rooms rm
      join public.accounts a on a.id::text = rm.owner_id
  loop
    total_rooms := total_rooms + 1;
    if r.auth_uid is null then
      continue;   -- no browser ever signed in as this account; leave it alone
    end if;

    update public.rooms
       set owner_id = r.auth_uid,
           admins   = (
             select coalesce(array_agg(distinct x), '{}'::text[])
               from unnest(r.admins || array[r.auth_uid]) as x
              where x is not null and x <> ''
           )
     where name = r.name;

    -- the auth uid row must show the current account, or the room will again
    -- appear to belong to whoever used this browser previously
    insert into public.users (client_id, username, avatar, last_seen)
    values (r.auth_uid, r.uname, coalesce(r.uavatar, ''), (extract(epoch from now()) * 1000)::bigint)
    on conflict (client_id) do update
      set username = excluded.username,
          avatar   = excluded.avatar;

    fixed_rooms := fixed_rooms + 1;
  end loop;

  raise notice '031: repaired % of % account-owned room(s)', fixed_rooms, total_rooms;
end $$;

-- ── 2b: belt and braces — name the users row of every signed-in account ─────
update public.users u
   set username = a.username,
       avatar   = coalesce(nullif(a.avatar, ''), u.avatar)
  from public.account_sessions s
  join public.accounts a on a.id = s.account_id
 where u.client_id = s.auth_uid
   and (s.expires_at is null or s.expires_at > now())
   and u.username is distinct from a.username;

-- ── 3: self-service repair, now identity-safe ───────────────────────────────
-- Refreshes the caller's own users row (so owner names are right) and returns
-- how many rooms this browser owns. It never changes ownership between
-- identities, so no admin command can be locked out by running it.
create or replace function public.claim_browser_rooms(p_acct text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   text := auth.uid()::text;
  v_name  text;
  v_avatar text;
  n_rooms int := 0;
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

  select a.username, coalesce(a.avatar, '') into v_name, v_avatar
    from public.accounts a where a.id::text = p_acct;

  insert into public.users (client_id, username, avatar, last_seen)
  values (v_uid, v_name, v_avatar, (extract(epoch from now()) * 1000)::bigint)
  on conflict (client_id) do update
    set username = excluded.username,
        avatar   = excluded.avatar;

  select count(*) into n_rooms from public.rooms where owner_id = v_uid;

  return jsonb_build_object('ok', true, 'rooms', n_rooms, 'username', coalesce(v_name, ''));
end;
$$;

grant execute on function public.claim_browser_rooms(text) to anon, authenticated;

-- ── operator tool: assign a room to the account's browser identity ──────────
create or replace function public.operator_reassign_room(p_room text, p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acct public.accounts%rowtype;
  v_uid  text;
  v_name text;
  v_from text;
begin
  select * into v_acct from public.accounts a where lower(a.username) = lower(p_username);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'account_not_found');
  end if;

  select s.auth_uid into v_uid
    from public.account_sessions s
   where s.account_id = v_acct.id
   order by s.last_seen desc nulls last
   limit 1;

  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_browser_session_for_account');
  end if;

  select name into v_name from public.rooms where name = p_room;
  if v_name is null then
    return jsonb_build_object('ok', false, 'error', 'room_not_found');
  end if;

  select owner_id into v_from from public.rooms where name = p_room;

  update public.rooms
     set owner_id = v_uid,
         admins   = (
           select coalesce(array_agg(distinct x), '{}'::text[])
             from unnest(coalesce(admins, '{}'::text[]) || array[v_uid]) as x
            where x is not null and x <> '' and x <> coalesce(v_from, '')
         )
   where name = p_room;

  insert into public.users (client_id, username, avatar, last_seen)
  values (v_uid, v_acct.username, coalesce(v_acct.avatar, ''), (extract(epoch from now()) * 1000)::bigint)
  on conflict (client_id) do update
    set username = excluded.username,
        avatar   = excluded.avatar;

  return jsonb_build_object('ok', true, 'room', p_room, 'to', v_acct.username, 'auth_uid', v_uid);
end;
$$;

revoke all on function public.operator_reassign_room(text, text) from anon, authenticated;

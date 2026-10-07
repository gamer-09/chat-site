-- 032_room_roles_and_kick.sql
-- Room roles done server-side, so "add member / add admin / kick" actually work.
--
-- Why this is needed:
--   • `join_room` (and private-room access) is decided server-side against
--     auth.uid(). The UI used to store whatever the operator typed — usually a
--     Client ID (= account id) — so adding a member silently granted nothing.
--   • `admins`/`members` updates were plain table writes: if RLS rejected them
--     the client showed nothing at all ("the button did nothing").
--   • There was no way to remove someone (kick), and no ban list to keep them out.
--
-- This migration resolves an identifier (Client ID, auth uid or username) to
-- every identity that person owns, then writes them into the room with a proper
-- manager check and a real error response.

-- ── ban list ────────────────────────────────────────────────────────────────
alter table public.rooms add column if not exists banned text[] not null default '{}'::text[];

-- ── identifier → identities ─────────────────────────────────────────────────
create or replace function public.resolve_identities(identifier text)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ident text := btrim(coalesce(identifier, ''));
  out_ids text[] := '{}'::text[];
begin
  if ident = '' then return out_ids; end if;

  -- direct match: account id or auth uid
  if exists (select 1 from public.accounts a where a.id::text = ident) then
    out_ids := out_ids || ident;
  end if;
  if exists (select 1 from public.users u where u.client_id = ident) then
    out_ids := out_ids || ident;
  end if;

  -- username match (accounts, then presence/users rows)
  out_ids := out_ids || coalesce((
    select array_agg(a.id::text) from public.accounts a where lower(a.username) = lower(ident)
  ), '{}'::text[]);
  out_ids := out_ids || coalesce((
    select array_agg(u.client_id) from public.users u where lower(u.username) = lower(ident)
  ), '{}'::text[]);

  -- every browser identity bound to that account
  out_ids := out_ids || coalesce((
    select array_agg(s.auth_uid)
      from public.account_sessions s
     where s.account_id in (select a.id from public.accounts a where lower(a.username) = lower(ident))
        or s.account_id::text = ident
  ), '{}'::text[]);

  -- plus anything already stored in this browser's users rows with that name
  out_ids := out_ids || coalesce((
    select array_agg(p.uid)
      from public.presence p
     where lower(coalesce(p.username, '')) = lower(ident)
  ), '{}'::text[]);

  select coalesce(array_agg(distinct x), '{}'::text[]) into out_ids
    from unnest(out_ids) as x
   where x is not null and x <> '';
  return out_ids;
end;
$$;

grant execute on function public.resolve_identities(text) to anon, authenticated;

-- ── who is the operator in this room? ───────────────────────────────────────
create or replace function public.room_is_manager(room_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.identity_allowed(r.owner_id)
        or (coalesce(r.admins, '{}'::text[]) && public.current_identity_ids())
      from public.rooms r where r.name = room_name
  ), false);
$$;

grant execute on function public.room_is_manager(text) to anon, authenticated;

-- ── add a member (private-room access) ──────────────────────────────────────
create or replace function public.room_add_member(room_name text, identifier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ids text[];
  r record;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if not public.room_is_manager(room_name) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;

  select * into r from public.rooms where name = room_name;
  if not found then return jsonb_build_object('ok', false, 'error', 'room_not_found'); end if;

  ids := public.resolve_identities(identifier);
  if array_length(ids, 1) is null then
    return jsonb_build_object('ok', false, 'error', 'no_such_user');
  end if;

  update public.rooms
     set members = (select coalesce(array_agg(distinct x), '{}'::text[])
                      from unnest(coalesce(members, '{}'::text[]) || ids) as x
                     where x is not null and x <> '' and not (x = any(coalesce(banned, '{}'::text[])))),
         banned  = array_remove(coalesce(banned, '{}'::text[]), ids[1])
   where name = room_name;

  return jsonb_build_object('ok', true, 'identities', array_length(ids, 1));
end;
$$;

-- ── add an admin ────────────────────────────────────────────────────────────
create or replace function public.room_add_admin(room_name text, identifier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ids text[];
  r record;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if not public.room_is_manager(room_name) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;

  select * into r from public.rooms where name = room_name;
  if not found then return jsonb_build_object('ok', false, 'error', 'room_not_found'); end if;

  ids := public.resolve_identities(identifier);
  if array_length(ids, 1) is null then
    return jsonb_build_object('ok', false, 'error', 'no_such_user');
  end if;

  update public.rooms
     set admins  = (select coalesce(array_agg(distinct x), '{}'::text[])
                      from unnest(coalesce(admins, '{}'::text[]) || ids) as x
                     where x is not null and x <> ''),
         members = (select coalesce(array_agg(distinct x), '{}'::text[])
                      from unnest(coalesce(members, '{}'::text[]) || ids) as x
                     where x is not null and x <> ''),
         banned  = (select coalesce(array_agg(distinct x), '{}'::text[])
                      from unnest(coalesce(banned, '{}'::text[])) as x
                     where not (x = any(ids)))
   where name = room_name;

  return jsonb_build_object('ok', true, 'identities', array_length(ids, 1));
end;
$$;

-- ── kick (remove member + admin rights and keep them out) ───────────────────
create or replace function public.room_kick(room_name text, identifier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ids text[];
  r record;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if not public.room_is_manager(room_name) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;

  select * into r from public.rooms where name = room_name;
  if not found then return jsonb_build_object('ok', false, 'error', 'room_not_found'); end if;

  ids := public.resolve_identities(identifier);
  if array_length(ids, 1) is null then
    return jsonb_build_object('ok', false, 'error', 'no_such_user');
  end if;

  -- never let an admin kick the owner
  if r.owner_id = any(ids) then
    return jsonb_build_object('ok', false, 'error', 'cannot_kick_owner');
  end if;

  update public.rooms
     set members = (select coalesce(array_agg(x), '{}'::text[])
                      from unnest(coalesce(members, '{}'::text[])) as x
                     where not (x = any(ids))),
         admins  = (select coalesce(array_agg(x), '{}'::text[])
                      from unnest(coalesce(admins, '{}'::text[])) as x
                     where not (x = any(ids))),
         banned  = (select coalesce(array_agg(distinct x), '{}'::text[])
                      from unnest(coalesce(banned, '{}'::text[]) || ids) as x
                     where x is not null and x <> '')
   where name = room_name;

  return jsonb_build_object('ok', true, 'kicked', array_length(ids, 1));
end;
$$;

-- ── a manager can take ownership when the owner row is orphaned ─────────────
-- Rooms created before accounts existed can be owned by a browser uid nobody
-- uses any more. RLS then refuses every write for the real operator (the "add
-- admin does nothing" case). If the caller is already an admin of that room this
-- lets them take it over.
create or replace function public.room_claim_ownership(room_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid text := auth.uid()::text;
  r record;
  bound boolean;
  orphan boolean;
begin
  if uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;

  select * into r from public.rooms where name = room_name;
  if not found then return jsonb_build_object('ok', false, 'error', 'room_not_found'); end if;
  if public.identity_allowed(r.owner_id) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  -- the caller must already be an admin of that room
  if not (coalesce(r.admins, '{}'::text[]) && public.current_identity_ids()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  -- the existing owner must be orphaned: an auth uid with no account bound to it
  select exists (select 1 from public.account_sessions s where s.auth_uid = r.owner_id) into bound;
  orphan := (not bound)
            and exists (select 1 from public.users u where u.client_id = r.owner_id)
            and not exists (select 1 from public.accounts a where a.id::text = r.owner_id);
  if not orphan then
    return jsonb_build_object('ok', false, 'error', 'owner_still_active');
  end if;

  update public.rooms
     set owner_id = uid,
         admins   = (select coalesce(array_agg(distinct x), '{}'::text[])
                       from unnest(coalesce(admins, '{}'::text[]) || array[uid]) as x
                      where x is not null and x <> '' and x <> r.owner_id)
   where name = room_name;

  return jsonb_build_object('ok', true, 'claimed', true, 'username', (select coalesce(a.username, '') from public.accounts a where a.id::text = (
    select s.account_id::text from public.account_sessions s where s.auth_uid = uid order by s.last_seen desc limit 1)));
end;
$$;

-- ── private-room access must respect the ban list and all identities ────────
create or replace function public.join_room(room_name text, passkey text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r    public.rooms%rowtype;
  ids  text[] := public.current_identity_ids();
  uid  text := auth.uid()::text;
begin
  if uid is null then return '{"ok":false,"error":"not_authenticated"}'::jsonb; end if;
  select * into r from public.rooms where name = room_name;
  if not found then return '{"ok":false,"error":"not_found"}'::jsonb; end if;

  if coalesce(r.banned, '{}'::text[]) && ids then
    return '{"ok":false,"error":"banned"}'::jsonb;
  end if;

  if not r.is_private then return '{"ok":true}'::jsonb; end if;

  -- owner, admins and existing members never need the passkey
  if public.identity_allowed(r.owner_id)
     or coalesce(r.admins,  '{}'::text[]) && ids
     or coalesce(r.members, '{}'::text[]) && ids then
    update public.rooms set members = (select coalesce(array_agg(distinct x), '{}'::text[])
                                        from unnest(coalesce(members, '{}'::text[]) || array[uid]) as x)
     where name = room_name;
    return '{"ok":true}'::jsonb;
  end if;

  if r.passkey = '' or r.passkey <> coalesce(passkey, '') then
    return '{"ok":false,"error":"invalid_passkey"}'::jsonb;
  end if;

  update public.rooms set members = (select coalesce(array_agg(distinct x), '{}'::text[])
                                      from unnest(coalesce(members, '{}'::text[]) || array[uid]) as x)
   where name = room_name;
  return '{"ok":true}'::jsonb;
end;
$$;

grant execute on function public.room_add_member(text, text) to authenticated;
grant execute on function public.room_add_admin(text, text)  to authenticated;
grant execute on function public.room_kick(text, text)       to authenticated;
grant execute on function public.room_claim_ownership(text)  to authenticated;

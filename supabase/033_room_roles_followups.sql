-- 033_room_roles_followups.sql
-- Follow-ups to 032:
--   • Client IDs are displayed shortened in the UI ("3fbd5518-339b-4d…"), so a
--     pasted short ID resolved to nothing. resolve_identities now accepts a
--     shortened/prefixed id (and strips quotes, spaces and the ellipsis).
--   • Kicking banned the person permanently with no way back. Kicks are now a
--     reversible room ban: `room_unban()` re-allows someone, `room_list_bans()`
--     shows who is banned, and adding someone back clears their ban for every
--     identity they own.
--   • Re-joining after a kick is allowed as soon as the owner un-bans or adds
--     them again.

-- ── identifier → identities (now prefix-tolerant) ───────────────────────────
create or replace function public.resolve_identities(identifier text)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ident text;
  out_ids text[] := '{}'::text[];
  hits text[];
begin
  -- normalise: strip quotes, whitespace, the UI ellipsis and trailing dots
  ident := btrim(coalesce(identifier, ''));
  ident := replace(ident, '…', '');
  ident := replace(ident, '"', '');
  ident := replace(ident, '''', '');
  ident := btrim(ident, ' .');
  if ident = '' then return out_ids; end if;

  -- exact matches: account id, auth uid, usernames
  if exists (select 1 from public.accounts a where a.id::text = ident) then
    out_ids := out_ids || ident;
  end if;
  if exists (select 1 from public.users u where u.client_id = ident) then
    out_ids := out_ids || ident;
  end if;
  out_ids := out_ids || coalesce((
    select array_agg(a.id::text) from public.accounts a where lower(a.username) = lower(ident)
  ), '{}'::text[]);
  out_ids := out_ids || coalesce((
    select array_agg(u.client_id) from public.users u where lower(u.username) = lower(ident)
  ), '{}'::text[]);

  -- shortened Client ID (the sidebar shows only the first 16 characters).
  -- Only accept it when it identifies exactly one account.
  if array_length(out_ids, 1) is null and length(ident) >= 8 then
    select array_agg(a.id::text) into hits
      from public.accounts a
     where a.id::text like ident || '%';
    if coalesce(array_length(hits, 1), 0) = 1 then
      out_ids := out_ids || hits;
    end if;
  end if;
  if array_length(out_ids, 1) is null and length(ident) >= 8 then
    select array_agg(u.client_id) into hits
      from public.users u
     where u.client_id like ident || '%';
    if coalesce(array_length(hits, 1), 0) = 1 then
      out_ids := out_ids || hits;
    end if;
  end if;
  -- and the same for usernames typed with a partial tail is NOT done on purpose
  -- (too ambiguous); usernames must match exactly.

  -- every browser identity bound to those accounts
  out_ids := out_ids || coalesce((
    select array_agg(s.auth_uid)
      from public.account_sessions s
     where s.account_id::text = any(out_ids)
  ), '{}'::text[]);

  -- presence rows carrying that name
  out_ids := out_ids || coalesce((
    select array_agg(p.uid) from public.presence p
     where lower(coalesce(p.username, '')) = lower(ident)
  ), '{}'::text[]);

  select coalesce(array_agg(distinct x), '{}'::text[]) into out_ids
    from unnest(out_ids) as x
   where x is not null and x <> '';
  return out_ids;
end;
$$;

grant execute on function public.resolve_identities(text) to anon, authenticated;

-- ── adding someone back always clears their ban (all their identities) ──────
create or replace function public.room_add_member(room_name text, identifier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ids text[];
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if not public.room_is_manager(room_name) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if not exists (select 1 from public.rooms where name = room_name) then
    return jsonb_build_object('ok', false, 'error', 'room_not_found');
  end if;

  ids := public.resolve_identities(identifier);
  if coalesce(array_length(ids, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_such_user');
  end if;

  update public.rooms
     set members = (select coalesce(array_agg(distinct x), '{}'::text[])
                      from unnest(coalesce(members, '{}'::text[]) || ids) as x
                     where x is not null and x <> ''),
         banned  = (select coalesce(array_agg(distinct x), '{}'::text[])
                      from unnest(coalesce(banned, '{}'::text[])) as x
                     where x is not null and x <> '' and not (x = any(ids)))
   where name = room_name;

  return jsonb_build_object('ok', true, 'identities', array_length(ids, 1), 'unbanned', true);
end;
$$;

create or replace function public.room_add_admin(room_name text, identifier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ids text[];
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if not public.room_is_manager(room_name) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if not exists (select 1 from public.rooms where name = room_name) then
    return jsonb_build_object('ok', false, 'error', 'room_not_found');
  end if;

  ids := public.resolve_identities(identifier);
  if coalesce(array_length(ids, 1), 0) = 0 then
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
                     where x is not null and x <> '' and not (x = any(ids)))
   where name = room_name;

  return jsonb_build_object('ok', true, 'identities', array_length(ids, 1), 'unbanned', true);
end;
$$;

-- ── allow someone back in (reverses a kick) ─────────────────────────────────
create or replace function public.room_unban(room_name text, identifier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ids text[];
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if not public.room_is_manager(room_name) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;

  ids := public.resolve_identities(identifier);
  if coalesce(array_length(ids, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_such_user');
  end if;

  update public.rooms
     set banned = (select coalesce(array_agg(distinct x), '{}'::text[])
                     from unnest(coalesce(banned, '{}'::text[])) as x
                    where x is not null and x <> '' and not (x = any(ids)))
   where name = room_name;

  return jsonb_build_object('ok', true, 'unbanned', array_length(ids, 1));
end;
$$;

-- ── who is banned right now (manager view) ─────────────────────────────────
create or replace function public.room_list_bans(room_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ids text[];
  out jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if not public.room_is_manager(room_name) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;

  select coalesce(banned, '{}'::text[]) into ids from public.rooms where name = room_name;
  if ids is null then return jsonb_build_object('ok', false, 'error', 'room_not_found'); end if;

  select jsonb_agg(entry) into out from (
    select distinct jsonb_build_object(
             'identifier', b,
             'username', coalesce(
                (select a.username from public.accounts a where a.id::text = b),
                (select u.username from public.users u where u.client_id = b),
                ''
             )
           ) as entry
      from unnest(ids) as b
     where b is not null and b <> ''
  ) t;

  return jsonb_build_object('ok', true, 'bans', coalesce(out, '[]'::jsonb));
end;
$$;

grant execute on function public.room_add_member(text, text) to authenticated;
grant execute on function public.room_add_admin(text, text)  to authenticated;
grant execute on function public.room_unban(text, text)      to authenticated;
grant execute on function public.room_list_bans(text)        to authenticated;

-- ── membership check the UI uses to decide whether "Kick" makes sense ──────
create or replace function public.room_is_member(room_name text, identifier text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ids text[];
  r record;
begin
  ids := public.resolve_identities(identifier);
  if coalesce(array_length(ids, 1), 0) = 0 then return false; end if;
  select * into r from public.rooms where name = room_name;
  if not found then return false; end if;
  return public.identity_allowed(r.owner_id)
      or coalesce(r.owner_id = any(ids), false)
      or coalesce(r.admins  && ids, false)
      or coalesce(r.members && ids, false);
end;
$$;

grant execute on function public.room_is_member(text, text) to anon, authenticated;

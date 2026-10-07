-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · renaming permanently wipes the previous identity
-- Run AFTER 034_delete_account_rooms.sql in Supabase SQL Editor.
--
-- Renaming a username is NOT cosmetic. Everything tied to the old name
-- (messages, reactions, read receipts, presence history, profile row) and
-- every room owned by any identity the account ever used is deleted at
-- the moment of rename, and a brand-new identity is issued. For signed-in
-- accounts the account row itself is renamed too, so login switches to
-- the new name. The UI warns about this before a rename is allowed.
-- ═══════════════════════════════════════════════════════════════════

-- Signed-in accounts: full identity wipe + account rename.
-- Authorized the same way update_account_profile (023) is: a live
-- account_sessions row must link this browser's auth uid to the account.
create or replace function public.rename_account(acct uuid, new_un text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  acc        public.accounts%rowtype;
  auth_uids  text[];
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

  select * into acc from public.accounts where id = acct;
  if not found then
    return '{"ok":false,"error":"account_not_found"}'::jsonb;
  end if;

  new_un := trim(coalesce(new_un, ''));
  if public.ptr29_username_reserved(new_un)
     or length(new_un) < 2 or length(new_un) > 50 or new_un ~ '[\r\n\t]' then
    return '{"ok":false,"error":"invalid_username"}'::jsonb;
  end if;
  -- Same name (maybe different case): nothing changes, don't wipe.
  if lower(new_un) = lower(acc.username) then
    return jsonb_build_object('ok', true, 'id', acc.id, 'username', acc.username);
  end if;
  if exists (select 1 from public.accounts a where lower(a.username) = lower(new_un) and a.id <> acct)
     or exists (select 1 from public.presence p where lower(p.username) = lower(new_un))
     or exists (select 1 from public.users u where lower(u.username) = lower(new_un) and u.client_id <> acct::text) then
    return '{"ok":false,"error":"taken"}'::jsonb;
  end if;

  -- Every auth uid this account ever signed in from (any browser/device).
  select array_agg(auth_uid) into auth_uids
    from public.account_sessions where account_id = acct;
  auth_uids := array_remove(array_append(coalesce(auth_uids, '{}'::text[]), auth.uid()::text), null);
  auth_uids := array_remove(auth_uids, '');

  -- Wipe everything tied to the old name / old identities…
  delete from public.messages
   where lower(payload->>'username') = lower(acc.username)
      or lower(payload->>'clientId') = acct::text
      or lower(coalesce(payload->>'clientId','')) = any(auth_uids);
  delete from public.reactions
   where lower(username) = lower(acc.username) or uid = acct::text
      or lower(uid) = any(auth_uids);
  delete from public.receipts
   where lower(username) = lower(acc.username) or uid = acct::text
      or lower(uid) = any(auth_uids);
  delete from public.presence
   where lower(username) = lower(acc.username) or uid = acct::text
      or lower(uid) = any(auth_uids);
  delete from public.users
   where lower(username) = lower(acc.username) or client_id = acct::text
      or lower(client_id) = any(auth_uids);
  -- …and every room owned by the account (account-as-clientId pre-030, or
  -- any auth uid the account used post-030).
  delete from public.rooms
   where owner_id = acct::text
      or lower(owner_id) = any(auth_uids);
  -- The old name is freed; drop any stale login locks held against it.
  delete from public.login_locks where uname = lower(acc.username);

  update public.accounts set username = new_un where id = acct;

  return jsonb_build_object('ok', true, 'id', acct, 'username', new_un);
end;
$$;

grant execute on function public.rename_account(uuid, text) to anon, authenticated;

-- Not signed into an account (pure browser identity): purge every row tied
-- to the caller's identity — the supabase auth uid (and anything keyed to
-- it) plus every room owned by that uid. Restricted to the caller's own
-- identity so nobody can wipe another user's rows by guessing a name.
create or replace function public.purge_identity(un text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  me text := auth.uid()::text;
begin
  if auth.uid() is null then
    return '{"ok":false,"error":"not_authenticated"}'::jsonb;
  end if;
  if un is null or trim(un) = '' then
    return '{"ok":false,"error":"bad_request"}'::jsonb;
  end if;

  delete from public.messages
   where payload->>'userId' = me
      or payload->>'clientId' = me;
  delete from public.reactions
   where uid = me;
  delete from public.receipts
   where uid = me;
  delete from public.presence
   where uid = me;
  delete from public.users
   where client_id = me;
  delete from public.rooms
   where owner_id = me;

  return jsonb_build_object('ok', true, 'purged', un);
end;
$$;

grant execute on function public.purge_identity(text) to anon, authenticated;
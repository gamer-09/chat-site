-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · delete_account leaves owned rooms behind
-- Run ONCE in: Supabase Dashboard → SQL Editor → paste → Run
--
-- Rooms are owned by the Supabase auth uid (030/031 re-keyed ownership
-- from the account id / clientId to the browser auth uid), but
-- delete_account only deleted rooms where owner_id = acct::text. An
-- account that created any room logged-in kept that room forever after
-- its account was deleted, with an owner_id pointing at a uid that no
-- longer has a usable session.
--
-- This re-creates delete_account so it also removes rooms owned by any
-- auth uid that account ever signed in with (tracked in
-- account_sessions), which is exactly how every logged-in room is owned.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.delete_account(acct uuid, pass text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  acc       public.accounts%rowtype;
  pepper    constant text := 'ptr29::v1::9f2c4a81d3b6e057';
  auth_uids text[];
begin
  select * into acc from public.accounts where id = acct;
  if not found or pass is null or pass !~ '^[0-9a-f]{64}$' then
    return '{"ok":false,"error":"invalid_credentials"}'::jsonb;
  end if;
  if acc.pass_hash <> crypt(pass || pepper, acc.pass_hash) then
    return '{"ok":false,"error":"invalid_credentials"}'::jsonb;
  end if;

  -- Every auth uid this account ever signed in from (any browser/device).
  select array_agg(auth_uid) into auth_uids
    from public.account_sessions where account_id = acct;
  auth_uids := array_remove(array_append(coalesce(auth_uids, '{}'::text[]), auth.uid()::text), null);
  auth_uids := array_remove(auth_uids, '');

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
  delete from public.users
   where lower(username) = lower(acc.username) or client_id = acct::text
      or lower(client_id) = any(auth_uids);
  delete from public.presence
   where lower(username) = lower(acc.username) or uid = acct::text
      or lower(uid) = any(auth_uids);
  -- Rooms owned via the account id (account-as-clientId, pre-030) OR via any
  -- auth uid the account used (post-030 ownership model).
  delete from public.rooms
   where owner_id = acct::text
      or lower(owner_id) = any(auth_uids);
  delete from public.account_sessions where account_id = acct;
  delete from public.login_locks where uname = lower(acc.username);
  delete from public.accounts where id = acct;

  return jsonb_build_object('ok', true, 'username', acc.username);
end;
$$;

grant execute on function public.delete_account(uuid, text) to anon, authenticated;
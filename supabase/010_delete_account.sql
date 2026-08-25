-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · full account erase ("Delete everything")
-- Run ONCE in: Supabase Dashboard → SQL Editor → paste → Run
--
-- SECURITY DEFINER so it can reach the policy-locked accounts table.
-- Requires the owner's password digest (same scheme as login) —
-- nobody else can erase an account, even with its id.
-- Deletes: account, login locks, messages (+ cascading receipts and
-- reactions), stray reactions/receipts, users row, presence, and any
-- rooms owned by the client (incl. tour rooms).
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.delete_account(acct uuid, pass text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  acc    public.accounts%rowtype;
  pepper constant text := 'ptr29::v1::9f2c4a81d3b6e057';
begin
  select * into acc from public.accounts where id = acct;
  if not found or pass is null or length(pass) < 32 then
    return '{"ok":false,"error":"invalid_credentials"}'::jsonb;
  end if;
  if acc.pass_hash <> crypt(pass || pepper, acc.pass_hash) then
    return '{"ok":false,"error":"invalid_credentials"}'::jsonb;
  end if;

  -- 1) messages — receipts & reactions cascade automatically
  delete from public.messages
   where lower(payload->>'username') = lower(acc.username)
      or lower(payload->>'clientId') = acct::text;

  -- 2) stray reactions / receipts authored by this identity
  delete from public.reactions
   where lower(username) = lower(acc.username) or uid = acct::text;
  delete from public.receipts
   where lower(username) = lower(acc.username) or uid = acct::text;

  -- 3) users + presence rows
  delete from public.users
   where lower(username) = lower(acc.username) or client_id = acct::text;
  delete from public.presence
   where lower(username) = lower(acc.username) or uid = acct::text;

  -- 4) rooms owned by this client (private rooms, tour rooms, …)
  delete from public.rooms where owner_id = acct::text;

  -- 5) lock history + the account itself
  delete from public.login_locks where uname = lower(acc.username);
  delete from public.accounts    where id = acct;

  return jsonb_build_object('ok', true, 'username', acc.username);
end;
$$;

grant execute on function public.delete_account(uuid, text) to anon, authenticated;

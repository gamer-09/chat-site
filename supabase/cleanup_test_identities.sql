-- ═══════════════════════════════════════════════════════════════════════
-- REPLICA chat · adapter-smoke leftovers: one-off identity wipe
--
-- This is NOT a migration. Do not add it to the numbered migration list.
--
-- `node supabase/adapter-smoke.js` removes its own identity in a `finally`
-- block, so a normal run leaves nothing behind (the run itself asserts zero
-- leftover messages and users). This script covers the one case that cannot:
-- a run killed before cleanup — Ctrl+C, a closed terminal, or a shell pipeline
-- that stops reading its output.
--
-- It wipes by IDENTITY, the way `delete_account()` does, not by username alone:
-- every id tied to a throwaway name is resolved first (users, presence, message
-- sender ids, reaction/receipt uids, accounts and their auth uids), then rows
-- are removed by id as well as by the name. That catches content written under
-- an older display name, and a browser id that no longer has a `users` row.
--
-- Run it in the Supabase SQL Editor. It needs service-role access: the
-- browser's anonymous key may only delete rows belonging to its own identity,
-- so it cannot clean up another run's throwaway identity.
--
-- Safe to re-run. Names are matched as exactly `smoke`/`probe` + six lowercase
-- alphanumerics (e.g. smoke3x583u), which is the shape the test generates.
-- ═══════════════════════════════════════════════════════════════════════

do $$
declare
  pat    text   := '^(smoke|probe)[a-z0-9]{6}$';
  ids_lc text[] := '{}';
begin
  -- 1. Resolve every identity key before deleting anything: later deletes
  --    remove the very rows these ids are read from.
  with keys as (
    -- browser / account ids recorded on the throwaway name
    select u.client_id as k
      from public.users u
     where lower(coalesce(u.username, '')) ~ pat
    union
    select p.uid
      from public.presence p
     where lower(coalesce(p.username, '')) ~ pat
    -- ids stamped on its messages (sender id is authoritative even if the
    -- display name was changed later)
    union
    select m.payload->>'userId'
      from public.messages m
     where lower(coalesce(m.payload->>'username', '')) ~ pat
    union
    select m.payload->>'clientId'
      from public.messages m
     where lower(coalesce(m.payload->>'username', '')) ~ pat
    -- ids on its reactions / receipts
    union
    select r.uid
      from public.reactions r
     where lower(coalesce(r.username, '')) ~ pat
    union
    select rc.uid
      from public.receipts rc
     where lower(coalesce(rc.username, '')) ~ pat
    -- real accounts (the smoke test never creates one, but do not rely on it)
    union
    select a.id::text
      from public.accounts a
     where lower(coalesce(a.username, '')) ~ pat
    union
    select s.auth_uid
      from public.account_sessions s
      join public.accounts a on a.id = s.account_id
     where lower(coalesce(a.username, '')) ~ pat
  )
  select coalesce(array_agg(distinct lower(k)), '{}')
    into ids_lc
    from keys
   where k is not null and btrim(k) <> '';

  -- 2. Content written by those identities, by id AND by name.
  delete from public.messages
   where lower(coalesce(payload->>'username', '')) ~ pat
      or lower(coalesce(payload->>'userId', ''))   = any(ids_lc)
      or lower(coalesce(payload->>'clientId', '')) = any(ids_lc);

  delete from public.reactions
   where lower(coalesce(username, '')) ~ pat
      or lower(uid) = any(ids_lc);

  delete from public.receipts
   where lower(coalesce(username, '')) ~ pat
      or lower(uid) = any(ids_lc);

  delete from public.presence
   where lower(coalesce(username, '')) ~ pat
      or lower(uid) = any(ids_lc);

  delete from public.users
   where lower(coalesce(username, '')) ~ pat
      or lower(client_id) = any(ids_lc);

  -- 3. Rooms: remove the identity's own rooms, and strip its ids out of the
  --    member/admin arrays of rooms it merely joined. (delete_account() does the
  --    first; the array scrub is what stops a ghost id lingering in a room.)
  delete from public.rooms
   where lower(owner_id) = any(ids_lc)
      or lower(owner_id) ~ pat;

  update public.rooms r
     set admins  = array(select x from unnest(r.admins)  x where lower(x) <> all(ids_lc)),
         members = array(select x from unnest(r.members) x where lower(x) <> all(ids_lc))
   where exists (select 1 from unnest(r.admins || r.members) z where lower(z) = any(ids_lc));

  -- 4. Inbox requests sent by the identity, and bug reports it filed. Requests
  --    sent TO it belong to the other person's inbox, so those stay.
  delete from public.id_requests
   where lower(coalesce(requester_username, '')) ~ pat
      or lower(coalesce(requester_client_id, '')) = any(ids_lc)
      or (requester_uid is not null and lower(requester_uid::text) = any(ids_lc));

  delete from public.bug_reports
   where reporter_uid is not null and lower(reporter_uid::text) = any(ids_lc);

  -- 5. Accounts, sessions and login locks (no-op for anonymous smoke runs).
  delete from public.account_sessions s
   using public.accounts a
   where s.account_id = a.id
     and (lower(coalesce(a.username, '')) ~ pat or lower(a.id::text) = any(ids_lc));

  delete from public.login_locks
   where lower(coalesce(uname, '')) ~ pat;

  delete from public.accounts
   where lower(coalesce(username, '')) ~ pat;
end $$;

-- ── Verify: all four counts must be 0 ───────────────────────────────────────
select
  (select count(*) from public.messages m
    where lower(coalesce(m.payload->>'username', '')) ~ '^(smoke|probe)[a-z0-9]{6}$') as messages,
  (select count(*) from public.users u
    where lower(coalesce(u.username, '')) ~ '^(smoke|probe)[a-z0-9]{6}$') as users,
  (select count(*) from public.presence p
    where lower(coalesce(p.username, '')) ~ '^(smoke|probe)[a-z0-9]{6}$') as presence,
  (select count(*) from public.accounts a
    where lower(coalesce(a.username, '')) ~ '^(smoke|probe)[a-z0-9]{6}$') as accounts;

-- ── What this cannot reach ──────────────────────────────────────────────────
-- • Uploaded files live in Storage under `chat-uploads/<room>/...`, not under a
--   user id, so they are identified only by the deleted messages that reference
--   them. `delete_account()` has the same gap. If those runs uploaded anything,
--   remove the now-orphaned files from the Storage browser.
-- • Anonymous auth rows in auth.users: the smoke test signs in anonymously, so
--   each killed run leaves one row there. After the deletes above it holds no
--   profile, message or room. Do NOT bulk-delete by "is_anonymous": a real
--   visitor who has not joined a room yet looks identical.

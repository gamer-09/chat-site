-- ═══════════════════════════════════════════════════════════════════════
-- REPLICA chat · adapter-smoke leftovers: one-off cleanup
--
-- This is NOT a migration. Do not add it to the numbered migration list.
--
-- `node supabase/adapter-smoke.js` removes its own identity in a `finally`
-- block, so a normal run leaves nothing behind (the run itself asserts zero
-- leftover messages and users). This script covers the one case that cannot:
-- a run killed before cleanup — Ctrl+C, a closed terminal, or a shell pipeline
-- that stops reading its output.
--
-- Run it in the Supabase SQL Editor. It needs service-role access: the
-- browser's anonymous key may only delete rows belonging to its own identity,
-- so it cannot clean up another run's throwaway identity.
--
-- Safe to re-run. It only matches the generated name shape
-- `smoke`/`probe` + six lowercase alphanumerics, e.g. smoke3x583u.
-- ═══════════════════════════════════════════════════════════════════════

do $$
declare
  pat text := '^(smoke|probe)[a-z0-9]{6}$';
begin
  delete from public.messages  where lower(coalesce(payload->>'username', '')) ~ pat;
  delete from public.reactions where lower(coalesce(username, '')) ~ pat;
  delete from public.receipts  where lower(coalesce(username, '')) ~ pat;
  delete from public.presence  where lower(coalesce(username, '')) ~ pat;
  delete from public.users     where lower(coalesce(username, '')) ~ pat;
end $$;

-- Verify (both must be 0):
--   select count(*) from public.messages where lower(coalesce(payload->>'username', '')) ~ '^(smoke|probe)[a-z0-9]{6}$';
--   select count(*) from public.users    where lower(coalesce(username, '')) ~ '^(smoke|probe)[a-z0-9]{6}$';
--
-- Note: the smoke test also signs in anonymously, so each killed run leaves one
-- anonymous row in auth.users. Those rows hold no profile, messages or rooms
-- after the deletes above, and anonymous users are meant to be disposable, so
-- they are safe to leave. Do NOT bulk-delete auth.users by "is_anonymous": real
-- visitors who have not joined a room yet look the same.

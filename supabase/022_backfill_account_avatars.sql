-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · backfill account avatars from user profiles
-- Run AFTER 021_login_avatar_fallback.sql in Supabase SQL Editor.
--
-- Some older accounts have their avatar stored in public.users.avatar
-- while public.accounts.avatar is blank. This backfills accounts.avatar
-- so future logins return the avatar directly.
-- ═══════════════════════════════════════════════════════════════════

update public.accounts a
   set avatar = u.avatar
  from public.users u
 where coalesce(a.avatar, '') = ''
   and coalesce(u.avatar, '') <> ''
   and (
     u.client_id = a.id::text
     or lower(u.username) = lower(a.username)
   );

-- Done.

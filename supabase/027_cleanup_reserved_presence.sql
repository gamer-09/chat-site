-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · cleanup reserved/anonymous presence rows
-- Run AFTER 025_block_reserved_account_login.sql in Supabase SQL Editor.
--
-- Removes stale People-panel presence rows for anonymous/reserved names.
-- The app also stops writing these rows going forward.
-- ═══════════════════════════════════════════════════════════════════

delete from public.presence
where username is null
   or btrim(username) = ''
   or lower(btrim(username)) like '%anonymous%'
   or btrim(username) like '🎓%';

-- Done.

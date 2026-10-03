-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · stop sharing Client ID
-- Run AFTER 013_inbox_badge_fix.sql in Supabase SQL Editor.
--
-- Adds a `revoked` status so a user can stop sharing a previously
-- approved Client ID disclosure. The requester must send a new request
-- if they need the Client ID again.
-- ═══════════════════════════════════════════════════════════════════

do $$
declare
  r record;
begin
  -- Drop the old status CHECK constraint even if Supabase/Postgres gave it
  -- a different name.
  for r in
    select conname
      from pg_constraint
     where conrelid = 'public.id_requests'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.id_requests drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.id_requests
  add constraint id_requests_status_check
  check (status in ('pending', 'approved', 'denied', 'revoked'));

-- Done.

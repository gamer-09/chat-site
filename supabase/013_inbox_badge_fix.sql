-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · inbox badge realtime + case-insensitive matching
-- Run AFTER 012_safe_links.sql in Supabase SQL Editor.
--
-- Fixes the inbox badge staying at 0 by:
--   • publishing id_requests changes to Supabase Realtime
--   • matching requester/target usernames case-insensitively in RLS
-- ═══════════════════════════════════════════════════════════════════

-- Make id_requests changes available to realtime subscribers.
do $$
begin
  alter publication supabase_realtime add table public.id_requests;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

alter table public.id_requests replica identity full;

-- Recreate RLS policies using case-insensitive participant checks.
drop policy if exists "idreq_insert" on public.id_requests;
drop policy if exists "idreq_select" on public.id_requests;
drop policy if exists "idreq_update" on public.id_requests;

create policy "idreq_insert" on public.id_requests
  for insert to anon, authenticated
  with check (
    requester_uid = auth.uid()
    and exists (
      select 1 from public.my_usernames() as u(name)
      where lower(u.name) = lower(requester_username)
    )
  );

create policy "idreq_select" on public.id_requests
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.my_usernames() as u(name)
      where lower(u.name) = lower(requester_username)
         or lower(u.name) = lower(target_username)
    )
  );

create policy "idreq_update" on public.id_requests
  for update to anon, authenticated
  using (
    exists (
      select 1 from public.my_usernames() as u(name)
      where lower(u.name) = lower(target_username)
    )
  )
  with check (
    exists (
      select 1 from public.my_usernames() as u(name)
      where lower(u.name) = lower(target_username)
    )
  );

-- Done.

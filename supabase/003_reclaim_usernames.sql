-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · reclaim orphaned usernames
-- Run ONCE in: Supabase Dashboard → SQL Editor → paste → Run
--
-- Fixes "Username already taken" when the only holder of the name is an
-- orphan row (registered, then the browser identity was lost/reset).
-- A name is reclaimable when its row has NO messages and is NOT online.
-- Active users (any messages, or currently present) can never be taken.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.reclaim_username(un text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.users u
   where lower(u.username) = lower(un)
     and u.client_id <> coalesce(auth.uid()::text, '')
     and not exists (
       select 1 from public.presence p
        where lower(p.username) = lower(u.username)
     )
     and not exists (
       select 1 from public.messages m
        where m.payload->>username = u.username
     );
end;
$$;

grant execute on function public.reclaim_username(text) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · one-call username check + orphan reclaim (replaces 003)
-- Run ONCE in: Supabase Dashboard → SQL Editor → paste → Run
--
-- Returns:
--   'available' → no row, or orphan reclaimed (nobody online under it)
--   'mine'      → held by the caller's client id
--   'taken'     → someone is CURRENTLY ONLINE under that name
-- A name whose holder is offline is treated as abandoned and reclaimed,
-- which fixes the "already taken" loop after identity resets.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.username_available(un text, cid text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  select client_id into r
    from public.users
   where lower(username) = lower(un)
   limit 1;
  if not found then
    return 'available';
  end if;
  if r.client_id = cid then
    return 'mine';
  end if;
  if not exists (
    select 1 from public.presence p
     where lower(p.username) = lower(un)
  ) then
    delete from public.users where lower(username) = lower(un);
    return 'available';
  end if;
  return 'taken';
end;
$$;

grant execute on function public.username_available(text, text) to anon, authenticated;

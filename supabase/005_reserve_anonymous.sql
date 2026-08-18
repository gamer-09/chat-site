-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · reserve "anonymous" + keep one-call check (re-creates
-- username_available from 004 with the reservation added)
-- Run ONCE in: Supabase Dashboard → SQL Editor → paste → Run
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.username_available(un text, cid text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  if lower(un) = 'anonymous' then
    return 'taken';
  end if;
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

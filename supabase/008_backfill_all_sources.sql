-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · backfill users from EVERY source of usernames
-- Run ONCE in: Supabase Dashboard → SQL Editor → paste → Run
--
-- 007 only covered message authors. Older users who only reacted,
-- only read (receipts), or only used ID requests still had no row.
-- This sweeps messages + reactions + receipts + id_requests.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.backfill_users()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare nm text;
begin
  for nm in
    select distinct v.name from (
      select payload->>'username' as name from public.messages
      union all
      select username from public.reactions
      union all
      select username from public.receipts
    ) v(name)
    where v.name is not null
      and lower(v.name) not in ('anonymous', '🎓 guest')
  loop
    if not exists (select 1 from public.users u where lower(u.username) = lower(nm)) then
      insert into public.users (client_id, username, avatar, last_seen)
      values ('legacy-' || substr(md5(nm), 1, 16), nm,
              'https://api.dicebear.com/7.x/thumbs/svg?seed=' || replace(nm, ' ', '-'), 0)
      on conflict (client_id) do nothing;
    end if;
  end loop;

  if to_regclass('public.id_requests') is not null then
    for nm in
      select distinct x.name from (
        select requester_username as name from public.id_requests
        union all
        select target_username from public.id_requests
      ) x(name)
      where x.name is not null and lower(x.name) not in ('anonymous', '🎓 guest')
    loop
      if not exists (select 1 from public.users u where lower(u.username) = lower(nm)) then
        insert into public.users (client_id, username, avatar, last_seen)
        values ('legacy-' || substr(md5(nm), 1, 16), nm,
                'https://api.dicebear.com/7.x/thumbs/svg?seed=' || replace(nm, ' ', '-'), 0)
        on conflict (client_id) do nothing;
      end if;
    end loop;
  end if;
end;
$$;

select public.backfill_users();

-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · backfill missing users rows from message history
-- Run ONCE in: Supabase Dashboard → SQL Editor → paste → Run
--
-- Users who registered before the upsert fallback fix never got a row
-- in public.users, so they never appear in the Offline list. This
-- recreates their rows from distinct message authors.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.backfill_users()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare un text;
begin
  for un in
    select distinct m.payload->>username
      from public.messages m
     where m.payload->>username is not null
       and lower(m.payload->>username) not in ('anonymous', '🎓 guest')
       and not exists (
         select 1 from public.users u
          where lower(u.username) = lower(m.payload->>username)
       )
  loop
    insert into public.users (client_id, username, avatar, last_seen)
    values (
      'legacy-' || substr(md5(un), 1, 16),
      un,
      'https://api.dicebear.com/7.x/thumbs/svg?seed=' || replace(un, ' ', '-'),
      0
    )
    on conflict (client_id) do nothing;
  end loop;
end;
$$;

select public.backfill_users();

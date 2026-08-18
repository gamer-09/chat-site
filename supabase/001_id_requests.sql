-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · Client-ID request inbox
-- Run this ONCE in: Supabase Dashboard → SQL Editor → paste → Run
-- (idempotent — safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.id_requests (
  id                  uuid primary key default gen_random_uuid(),
  requester_username  text not null,
  requester_client_id text,
  requester_uid       uuid,                          -- auth uid at send time
  target_username     text not null,
  reason              text not null default '',
  status              text not null default 'pending'
                      check (status in ('pending','approved','denied')),
  disclosed_client_id text,                          -- filled ONLY on approve
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz
);

alter table public.id_requests enable row level security;

-- helper: the caller's current username(s), via their live presence row
-- NOTE: presence.uid is TEXT while auth.uid() is UUID → explicit cast
create or replace function public.my_usernames()
returns setof text
language sql stable security definer as $$
  select username from public.presence where uid = auth.uid()::text;
$$;

drop policy if exists "idreq_insert" on public.id_requests;
drop policy if exists "idreq_select" on public.id_requests;
drop policy if exists "idreq_update" on public.id_requests;

-- anyone signed in can SEND a request (as their own current username)
create policy "idreq_insert" on public.id_requests
  for insert to anon, authenticated
  with check (
    requester_username in (select public.my_usernames())
    and requester_uid = auth.uid()
  );

-- only the two participants can READ their own rows
create policy "idreq_select" on public.id_requests
  for select to anon, authenticated
  using (
    requester_username in (select public.my_usernames())
    or target_username in (select public.my_usernames())
  );

-- only the TARGET can approve/deny (update) their incoming rows
create policy "idreq_update" on public.id_requests
  for update to anon, authenticated
  using ( target_username in (select public.my_usernames()) )
  with check ( target_username in (select public.my_usernames()) );

-- nobody deletes request history (audit trail of disclosures)

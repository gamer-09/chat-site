-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · scale pass: real timestamps, indexes, server-side search
-- Run AFTER 039_ensure_pepper_secret.sql in the Supabase SQL Editor.
-- (idempotent — safe to re-run; ADDITIVE ONLY — deletes no rows)
-- ═══════════════════════════════════════════════════════════════════
--
-- WHY
--   History paging sorted on `payload->>timestamp` (text cast) and search
--   downloaded 150 full payloads per query to filter in the browser. Both
--   get progressively more expensive as the table grows. This adds:
--
--     • messages.created_at  — a real timestamptz, backfilled from
--       payload.timestamp (which is kept untouched), indexed for paging;
--     • covering indexes for reactions / receipts lookups;
--     • a full-text index + search_room_messages() so search runs in
--       Postgres instead of shipping rows to the client;
--     • room_activity() — one cheap call per minute replaces the old
--       "every message in every room is pushed to every client" fan-out
--       for unread badges and cross-room toasts.
--
--   `payload` remains the source of truth: this migration never rewrites or
--   removes message data.

-- ── 1. created_at on messages ─────────────────────────────────────────
alter table public.messages
  add column if not exists created_at timestamptz;

-- Backfill only rows that are still NULL, from the timestamp already in the
-- payload. Guarded so a malformed payload can never abort the migration.
update public.messages
   set created_at = to_timestamp((payload ->> 'timestamp')::numeric / 1000.0)
 where created_at is null
   and payload ? 'timestamp'
   and (payload ->> 'timestamp') ~ '^[0-9]{10,16}$';

-- Anything unparseable keeps working; new rows always get a value.
alter table public.messages
  alter column created_at set default now();

-- Paging is "newest first within a room", so this index serves both the
-- initial load and every "Load older messages" click.
create index if not exists messages_room_created_idx
  on public.messages (room, created_at desc);

-- ── 2. Indexes for the per-message metadata lookups ───────────────────
create index if not exists reactions_room_message_idx
  on public.reactions (room, message_id);

create index if not exists receipts_room_message_idx
  on public.receipts (room, message_id);

create index if not exists receipts_uid_idx
  on public.receipts (uid);

-- ── 3. Server-side search ─────────────────────────────────────────────
-- Expression index for chat text. 'simple' avoids stemming surprises on
-- usernames/handles; the message column is the only thing indexed.
create index if not exists messages_message_fts_idx
  on public.messages
  using gin (to_tsvector('simple', coalesce(payload ->> 'message', '')));

-- SECURITY INVOKER (default): message RLS still decides what each caller
-- can see, so private rooms are not searchable by outsiders.
--
-- light_payload() drops the inline base64 avatar copy (35–46 KB per message)
-- when present. The stored row is never modified.
create or replace function public.light_payload(p jsonb)
returns jsonb
language sql
immutable
as $$
  select case
           when p is null then null
           when length(coalesce(p ->> 'avatar', '')) > 1024 then p - 'avatar'
           else p
         end;
$$;

create or replace function public.search_room_messages(
  room_name text,
  q         text,
  lim       integer default 150
)
returns setof jsonb
language sql
stable
as $$
  select public.light_payload(m.payload)
    from public.messages m
   where m.room = room_name
     and (
       to_tsvector('simple', coalesce(m.payload ->> 'message', ''))
         @@ plainto_tsquery('simple', coalesce(q, ''))
       or coalesce(m.payload ->> 'username', '') ilike '%' || coalesce(q, '') || '%'
     )
   order by m.created_at desc nulls last
   limit greatest(1, least(coalesce(lim, 150), 300));
$$;

grant execute on function public.search_room_messages(text, text, integer)
  to anon, authenticated;

-- ── 3b. Indexed history paging ────────────────────────────────────────
-- One page of a room, newest first, served by messages_room_created_idx.
-- before_ts = the timestamp of the oldest message already on screen (used by
-- "Load older messages"); NULL means the newest page.
create or replace function public.get_room_history(
  room_name text,
  before_ts timestamptz default null,
  lim       integer default 50
)
returns setof jsonb
language sql
stable
as $$
  select public.light_payload(m.payload)
    from public.messages m
   where m.room = room_name
     and m.created_at is not null
     and (before_ts is null or m.created_at < before_ts)
   order by m.created_at desc
   limit greatest(1, least(coalesce(lim, 50), 200));
$$;

grant execute on function public.get_room_history(text, timestamptz, integer)
  to anon, authenticated;

-- ── 4. Room activity for unread badges / cross-room notices ───────────
-- `p_since` maps room name -> epoch-ms cursor the client has already seen.
-- Returns only rooms with something newer, plus the newest payload so the
-- client can show one toast per room instead of receiving every message.
create or replace function public.room_activity(p_since jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  out_rooms jsonb := '{}'::jsonb;
  r         record;
begin
  for r in
    select m.room,
           count(*) as n,
           (array_agg(m.payload order by m.created_at desc))[1] as last_payload
      from public.messages m
     where m.created_at is not null
       and m.created_at > coalesce(
             to_timestamp(
               nullif(p_since ->> m.room, '')::numeric / 1000.0
             ),
             to_timestamp(0)
           )
     group by m.room
  loop
    out_rooms := out_rooms || jsonb_build_object(
      r.room,
      jsonb_build_object('count', r.n, 'last', public.light_payload(r.last_payload))
    );
  end loop;

  return jsonb_build_object(
    'now', (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'rooms', out_rooms
  );
end;
$$;

grant execute on function public.room_activity(jsonb) to anon, authenticated;

-- ── 5. Sanity check ───────────────────────────────────────────────────
do $$
declare
  n bigint;
begin
  select count(*) into n from public.messages where created_at is null;
  if n > 0 then
    raise warning '% message(s) still have no created_at (unparseable payload timestamp); they are hidden from paging but not deleted', n;
  end if;
end $$;

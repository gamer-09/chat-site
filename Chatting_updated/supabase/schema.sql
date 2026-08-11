-- ═══════════════════════════════════════════════════════════════════════════
-- ptr_29 Chat — Supabase schema (GitHub Pages edition)
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLES
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.rooms (
  name       text primary key,
  is_private boolean not null default false,
  owner_id   text not null default '',
  admins     text[] not null default '{}',
  members    text[] not null default '{}',
  passkey    text not null default '',
  created_at bigint not null default 0
);

create table if not exists public.messages (
  id      text primary key,
  room    text not null,
  payload jsonb not null
);
create index if not exists idx_messages_room_ts
  on public.messages (room, ((payload ->> 'timestamp')::bigint) desc);

create table if not exists public.receipts (
  message_id text not null references public.messages (id) on delete cascade,
  room       text not null,
  uid        text not null,
  username   text not null default '',
  at         bigint not null default 0,
  primary key (message_id, uid)
);
create index if not exists idx_receipts_room on public.receipts (room);

create table if not exists public.reactions (
  message_id text not null references public.messages (id) on delete cascade,
  room       text not null,
  emoji      text not null,
  uid        text not null,
  username   text not null default '',
  created_at bigint not null default 0,
  primary key (message_id, emoji, uid)
);
create index if not exists idx_reactions_room on public.reactions (room);

create table if not exists public.users (
  client_id text primary key,
  username  text not null,
  avatar    text not null default '',
  last_seen bigint not null default 0
);
create unique index if not exists idx_users_username_lower
  on public.users (lower(username));

create table if not exists public.presence (
  uid        text primary key,
  username   text not null default '',
  avatar     text not null default '',
  room       text not null default '',
  updated_at bigint not null default 0
);

-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTS + RLS
-- ─────────────────────────────────────────────────────────────────────────────

grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all functions in schema public to anon, authenticated;

-- Anonymous visitors (pre-sign-in) can read public rooms, but never write:
-- all writes require a real signed-in identity (auth.uid()).
revoke insert, update, delete on all tables in schema public from anon;

alter table public.rooms     enable row level security;
alter table public.messages  enable row level security;
alter table public.receipts  enable row level security;
alter table public.reactions enable row level security;
alter table public.users     enable row level security;
alter table public.presence  enable row level security;

-- Helper: can this auth uid read/write this room?
create or replace function public.room_accessible(room_name text, uid text)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.rooms r
    where r.name = room_name
      and (not r.is_private
           or r.owner_id = uid
           or uid = any (r.admins)
           or uid = any (r.members))
  );
$$;

-- ROOMS ───────────────────────────────────────────────────────────────────────
drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms for select using (
  not is_private
  or owner_id = auth.uid()::text
  or auth.uid()::text = any (admins)
  or auth.uid()::text = any (members)
);
drop policy if exists rooms_insert on public.rooms;
create policy rooms_insert on public.rooms for insert
  with check (auth.role() = 'authenticated');
drop policy if exists rooms_update on public.rooms;
create policy rooms_update on public.rooms for update using (
  owner_id = auth.uid()::text or auth.uid()::text = any (admins)
);
drop policy if exists rooms_delete on public.rooms;
create policy rooms_delete on public.rooms for delete using (
  owner_id = auth.uid()::text
);

-- MESSAGES ────────────────────────────────────────────────────────────────────
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select using (
  public.room_accessible(room, auth.uid()::text)
);
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert with check (
  auth.role() = 'authenticated'
  and public.room_accessible(room, auth.uid()::text)
);
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages for update using (
  public.room_accessible(room, auth.uid()::text)
  and (payload ->> 'clientId') = auth.uid()::text
);
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages for delete using (
  public.room_accessible(room, auth.uid()::text)
  and (payload ->> 'clientId') = auth.uid()::text
);

-- RECEIPTS ────────────────────────────────────────────────────────────────────
drop policy if exists receipts_select on public.receipts;
create policy receipts_select on public.receipts for select using (
  public.room_accessible(room, auth.uid()::text)
);
drop policy if exists receipts_insert on public.receipts;
create policy receipts_insert on public.receipts for insert with check (
  uid = auth.uid()::text
  and public.room_accessible(room, auth.uid()::text)
);
drop policy if exists receipts_delete on public.receipts;
create policy receipts_delete on public.receipts for delete using (
  uid = auth.uid()::text
);

-- REACTIONS ───────────────────────────────────────────────────────────────────
drop policy if exists reactions_select on public.reactions;
create policy reactions_select on public.reactions for select using (
  public.room_accessible(room, auth.uid()::text)
);
drop policy if exists reactions_insert on public.reactions;
create policy reactions_insert on public.reactions for insert with check (
  uid = auth.uid()::text
  and public.room_accessible(room, auth.uid()::text)
);
drop policy if exists reactions_delete on public.reactions;
create policy reactions_delete on public.reactions for delete using (
  uid = auth.uid()::text
);

-- USERS ───────────────────────────────────────────────────────────────────────
drop policy if exists users_select on public.users;
create policy users_select on public.users for select using (
  auth.role() = 'authenticated'
);
drop policy if exists users_insert on public.users;
create policy users_insert on public.users for insert with check (
  client_id = auth.uid()::text
);
drop policy if exists users_update on public.users;
create policy users_update on public.users for update using (
  client_id = auth.uid()::text
);
drop policy if exists users_delete on public.users;
create policy users_delete on public.users for delete using (
  client_id = auth.uid()::text
);

-- PRESENCE ────────────────────────────────────────────────────────────────────
drop policy if exists presence_select on public.presence;
create policy presence_select on public.presence for select using (
  auth.role() = 'authenticated'
);
drop policy if exists presence_insert on public.presence;
create policy presence_insert on public.presence for insert with check (
  uid = auth.uid()::text
);
drop policy if exists presence_update on public.presence;
create policy presence_update on public.presence for update using (
  uid = auth.uid()::text
);
drop policy if exists presence_delete on public.presence;
create policy presence_delete on public.presence for delete using (
  uid = auth.uid()::text
);

-- ─────────────────────────────────────────────────────────────────────────────
-- RPCs (SECURITY DEFINER — they must self-check authorization)
-- ─────────────────────────────────────────────────────────────────────────────

-- Ensure the #general room always exists.
create or replace function public.seed_general()
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.rooms (name, created_at)
  values ('general', (extract(epoch from now()) * 1000)::bigint)
  on conflict (name) do nothing;
end;
$$;

-- Resolve a passkey to a room name (private rooms aren't listable).
create or replace function public.find_room_by_passkey(passkey text)
returns text language sql security definer set search_path = public as $$
  select name from public.rooms
  where rooms.passkey = find_room_by_passkey.passkey
    and rooms.passkey <> ''
    and auth.uid() is not null
  limit 1;
$$;

-- Join a room: public rooms free; private rooms need the passkey and
-- grant the caller read/write membership.
create or replace function public.join_room(room_name text, passkey text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r   public.rooms%rowtype;
  uid text := auth.uid()::text;
begin
  if uid is null then return '{"ok":false,"error":"not_authenticated"}'::jsonb; end if;
  select * into r from public.rooms where name = room_name;
  if not found then return '{"ok":false,"error":"not_found"}'::jsonb; end if;

  if not r.is_private then
    return '{"ok":true}'::jsonb;
  end if;

  -- Owner, admins and existing members NEVER need the passkey.
  if r.owner_id = uid or uid = any (r.admins) or uid = any (r.members) then
    return '{"ok":true}'::jsonb;
  end if;

  -- New joiners of a private room need a matching (non-empty) passkey.
  -- A private room with no passkey set is only accessible to its members.
  if r.passkey = '' or r.passkey <> coalesce(passkey, '') then
    return '{"ok":false,"error":"invalid_passkey"}'::jsonb;
  end if;

  update public.rooms set members = members || uid
  where name = room_name and not (uid = any (members));

  return '{"ok":true}'::jsonb;
end;
$$;

create or replace function public.rename_room(from_name text, to_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r     public.rooms%rowtype;
  uid   text := auth.uid()::text;
  clean text;
begin
  if uid is null then return '{"ok":false,"error":"not_authenticated"}'::jsonb; end if;
  clean := lower(btrim(regexp_replace(to_name, '[^a-z0-9_-]', '-', 'g')));
  if clean = '' or char_length(clean) > 50 then
    return '{"ok":false,"error":"invalid"}'::jsonb;
  end if;
  if clean = 'general' then return '{"ok":false,"error":"default_room"}'::jsonb; end if;

  select * into r from public.rooms where name = from_name;
  if not found then return '{"ok":false,"error":"not_found"}'::jsonb; end if;
  if r.owner_id <> uid and not (uid = any (r.admins)) then
    return '{"ok":false,"error":"forbidden"}'::jsonb;
  end if;
  if exists (select 1 from public.rooms where name = clean) then
    return '{"ok":false,"error":"exists"}'::jsonb;
  end if;

  update public.rooms    set name = clean where name = from_name;
  update public.messages set room = clean where room = from_name;
  update public.receipts set room = clean where room = from_name;
  update public.reactions set room = clean where room = from_name;
  update public.presence set room  = clean where room  = from_name;

  return jsonb_build_object('ok', true, 'from', from_name, 'to', clean);
end;
$$;

create or replace function public.delete_room(room_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r   public.rooms%rowtype;
  uid text := auth.uid()::text;
begin
  if uid is null then return '{"ok":false,"error":"not_authenticated"}'::jsonb; end if;
  select * into r from public.rooms where name = room_name;
  if not found then return '{"ok":false,"error":"not_found"}'::jsonb; end if;
  if r.owner_id <> uid and not (uid = any (r.admins)) then
    return '{"ok":false,"error":"forbidden"}'::jsonb;
  end if;

  delete from public.messages where room = room_name;
  delete from public.receipts where room = room_name;
  delete from public.reactions where room = room_name;
  delete from public.presence where room = room_name;
  delete from public.rooms where name = room_name;

  return '{"ok":true}'::jsonb;
end;
$$;

create or replace function public.clear_room(room_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r   public.rooms%rowtype;
  uid text := auth.uid()::text;
begin
  if uid is null then return '{"ok":false,"error":"not_authenticated"}'::jsonb; end if;
  select * into r from public.rooms where name = room_name;
  if not found then return '{"ok":false,"error":"not_found"}'::jsonb; end if;
  if r.owner_id <> uid and not (uid = any (r.admins)) then
    return '{"ok":false,"error":"forbidden"}'::jsonb;
  end if;

  delete from public.messages where room = room_name;

  return '{"ok":true}'::jsonb;
end;
$$;

create or replace function public.prune_stale_presence(older_than_ms bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.presence
  where updated_at < (extract(epoch from now()) * 1000)::bigint - older_than_ms;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- REALTIME — publish all tables to the supabase_realtime publication
-- ─────────────────────────────────────────────────────────────────────────────
do $$ begin alter publication supabase_realtime add table public.rooms;    exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.messages;  exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.receipts;  exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.reactions; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.users;     exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.presence;  exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- STORAGE — private bucket for images/files
-- Files are only downloadable by room members via signed URLs (RLS enforced).
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('chat-uploads', 'chat-uploads', false)
on conflict (id) do nothing;

drop policy if exists uploads_insert on storage.objects;
create policy uploads_insert on storage.objects for insert with check (
  bucket_id = 'chat-uploads'
  and auth.role() = 'authenticated'
);

drop policy if exists uploads_select on storage.objects;
create policy uploads_select on storage.objects for select using (
  bucket_id = 'chat-uploads'
  and exists (
    select 1 from public.rooms r
    where r.name = (storage.foldername(name))[1]
      and (not r.is_private
           or r.owner_id = auth.uid()::text
           or auth.uid()::text = any (r.admins)
           or auth.uid()::text = any (r.members))
  )
);

-- Done. The chat is now fully backed by Supabase. 🎉

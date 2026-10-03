-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · security hardening pass
-- Run ONCE in: Supabase Dashboard → SQL Editor → paste → Run
--
-- Adds server-side enforcement for account sessions, safer RLS, upload
-- type/size limits, and stricter message payload checks.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Account sessions: bind a successful account login to the current
-- Supabase auth uid. This stops a copied/guessed clientId from being enough.
create table if not exists public.account_sessions (
  account_id uuid not null references public.accounts(id) on delete cascade,
  auth_uid   text not null,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  primary key (account_id, auth_uid)
);

alter table public.account_sessions enable row level security;
-- Deliberately no direct table policies: only SECURITY DEFINER functions below.

-- Best-effort backfill for users who are currently online during migration.
insert into public.account_sessions (account_id, auth_uid, last_seen, expires_at)
select a.id, p.uid, now(), now() + interval '30 days'
  from public.accounts a
  join public.presence p on lower(p.username) = lower(a.username)
on conflict (account_id, auth_uid) do update
  set last_seen = excluded.last_seen,
      expires_at = excluded.expires_at;

create or replace function public.current_account_ids()
returns text[]
language sql stable security definer
set search_path = public
as $$
  select coalesce(array_agg(s.account_id::text), '{}'::text[])
    from public.account_sessions s
   where s.auth_uid = auth.uid()::text
     and s.expires_at > now();
$$;

grant execute on function public.current_account_ids() to anon, authenticated;

create or replace function public.current_identity_ids()
returns text[]
language sql stable security definer
set search_path = public
as $$
  select array_remove(array_append(public.current_account_ids(), auth.uid()::text), null);
$$;

grant execute on function public.current_identity_ids() to anon, authenticated;

create or replace function public.identity_allowed(identity text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(identity, '') = any(public.current_identity_ids());
$$;

grant execute on function public.identity_allowed(text) to anon, authenticated;

create or replace function public.my_usernames()
returns setof text
language sql stable security definer
set search_path = public
as $$
  select a.username
    from public.accounts a
   where a.id::text = any(public.current_account_ids())
  union
  select u.username
    from public.users u
   where public.identity_allowed(u.client_id)
  union
  select p.username
    from public.presence p
   where p.uid = auth.uid()::text;
$$;

grant execute on function public.my_usernames() to anon, authenticated;

-- Recreate account RPCs so successful login/register creates a server-side session.
create or replace function public.register_account(un text, pass text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  acc public.accounts%rowtype;
  pepper constant text := 'ptr29::v1::9f2c4a81d3b6e057';
begin
  if auth.uid() is null then
    return '{"ok":false,"error":"not_authenticated"}'::jsonb;
  end if;
  if lower(un) = 'anonymous' or length(un) < 2 or length(un) > 50 or un ~ '[\r\n\t]' then
    return '{"ok":false,"error":"invalid_username"}'::jsonb;
  end if;
  -- Client sends the SHA-256 digest. Enforce exact hash shape server-side.
  if pass is null or pass !~ '^[0-9a-f]{64}$' then
    return '{"ok":false,"error":"invalid_credentials"}'::jsonb;
  end if;
  if exists (select 1 from public.accounts a where lower(a.username) = lower(un)) then
    return '{"ok":false,"error":"taken"}'::jsonb;
  end if;

  insert into public.accounts (username, pass_hash)
  values (un, crypt(pass || pepper, gen_salt('bf', 12)))
  returning * into acc;

  insert into public.account_sessions (account_id, auth_uid)
  values (acc.id, auth.uid()::text)
  on conflict (account_id, auth_uid) do update
    set last_seen = now(), expires_at = now() + interval '30 days';

  return jsonb_build_object('ok', true, 'id', acc.id, 'username', acc.username);
end;
$$;

create or replace function public.login_account(un text, pass text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  acc public.accounts%rowtype;
  lock public.login_locks%rowtype;
  pepper constant text := 'ptr29::v1::9f2c4a81d3b6e057';
begin
  if auth.uid() is null then
    return '{"ok":false,"error":"not_authenticated"}'::jsonb;
  end if;
  if pass is null or pass !~ '^[0-9a-f]{64}$' then
    return '{"ok":false,"error":"invalid_credentials"}'::jsonb;
  end if;

  select * into lock from public.login_locks l where l.uname = lower(un);
  if found and lock.locked_until is not null and lock.locked_until > now() then
    return '{"ok":false,"error":"locked"}'::jsonb;
  end if;

  select * into acc from public.accounts a where lower(a.username) = lower(un);
  if not found then
    perform crypt(pass || pepper, gen_salt('bf', 12));
    return '{"ok":false,"error":"invalid_credentials"}'::jsonb;
  end if;

  if acc.pass_hash <> crypt(pass || pepper, acc.pass_hash) then
    insert into public.login_locks (uname, fails) values (lower(un), 1)
    on conflict (uname) do update
      set fails = public.login_locks.fails + 1,
          locked_until = case
            when public.login_locks.fails + 1 >= 5 then now() + interval '15 minutes'
            else public.login_locks.locked_until end;
    return '{"ok":false,"error":"invalid_credentials"}'::jsonb;
  end if;

  delete from public.login_locks l where l.uname = lower(un);
  insert into public.account_sessions (account_id, auth_uid)
  values (acc.id, auth.uid()::text)
  on conflict (account_id, auth_uid) do update
    set last_seen = now(), expires_at = now() + interval '30 days';

  return jsonb_build_object('ok', true, 'id', acc.id, 'username', acc.username,
                            'avatar', coalesce(acc.avatar, ''));
end;
$$;

grant execute on function public.register_account(text, text) to anon, authenticated;
grant execute on function public.login_account(text, text) to anon, authenticated;

create or replace function public.logout_account(acct uuid default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return '{"ok":true}'::jsonb; end if;
  if acct is null then
    delete from public.account_sessions where auth_uid = auth.uid()::text;
  else
    delete from public.account_sessions where auth_uid = auth.uid()::text and account_id = acct;
  end if;
  return '{"ok":true}'::jsonb;
end;
$$;

grant execute on function public.logout_account(uuid) to anon, authenticated;

create or replace function public.delete_account(acct uuid, pass text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  acc    public.accounts%rowtype;
  pepper constant text := 'ptr29::v1::9f2c4a81d3b6e057';
begin
  select * into acc from public.accounts where id = acct;
  if not found or pass is null or pass !~ '^[0-9a-f]{64}$' then
    return '{"ok":false,"error":"invalid_credentials"}'::jsonb;
  end if;
  if acc.pass_hash <> crypt(pass || pepper, acc.pass_hash) then
    return '{"ok":false,"error":"invalid_credentials"}'::jsonb;
  end if;

  delete from public.messages
   where lower(payload->>'username') = lower(acc.username)
      or lower(payload->>'clientId') = acct::text;
  delete from public.reactions
   where lower(username) = lower(acc.username) or uid = acct::text;
  delete from public.receipts
   where lower(username) = lower(acc.username) or uid = acct::text;
  delete from public.users
   where lower(username) = lower(acc.username) or client_id = acct::text;
  delete from public.presence
   where lower(username) = lower(acc.username) or uid = acct::text;
  delete from public.rooms where owner_id = acct::text;
  delete from public.account_sessions where account_id = acct;
  delete from public.login_locks where uname = lower(acc.username);
  delete from public.accounts where id = acct;

  return jsonb_build_object('ok', true, 'username', acc.username);
end;
$$;

grant execute on function public.delete_account(uuid, text) to anon, authenticated;

-- ── Room access helper upgraded to include account sessions.
create or replace function public.room_accessible(room_name text, uid text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.rooms r
    where r.name = room_name
      and (
        not r.is_private
        or r.owner_id = any(public.current_identity_ids())
        or r.admins && public.current_identity_ids()
        or r.members && public.current_identity_ids()
      )
  );
$$;

grant execute on function public.room_accessible(text, text) to anon, authenticated;

-- ── Upload validation helpers used by Storage RLS.
create or replace function public.ptr29_upload_ext(object_name text)
returns text language sql immutable as $$
  select lower(coalesce(substring(object_name from '\.([A-Za-z0-9]+)$'), ''));
$$;

create or replace function public.ptr29_upload_mime(meta jsonb)
returns text language sql immutable as $$
  select lower(coalesce(meta->>'mimetype', meta->>'mimeType', ''));
$$;

create or replace function public.ptr29_upload_size(meta jsonb)
returns bigint language sql immutable as $$
  select case when coalesce(meta->>'size', '') ~ '^\d+$' then (meta->>'size')::bigint else 0 end;
$$;

create or replace function public.ptr29_upload_allowed(object_name text, meta jsonb)
returns boolean language sql immutable as $$
  select
    public.ptr29_upload_size(meta) > 0
    and (
      (
        public.ptr29_upload_size(meta) <= 5242880
        and (
          (public.ptr29_upload_mime(meta) = 'image/jpeg' and public.ptr29_upload_ext(object_name) in ('jpg','jpeg')) or
          (public.ptr29_upload_mime(meta) = 'image/png'  and public.ptr29_upload_ext(object_name) = 'png') or
          (public.ptr29_upload_mime(meta) = 'image/gif'  and public.ptr29_upload_ext(object_name) = 'gif') or
          (public.ptr29_upload_mime(meta) = 'image/webp' and public.ptr29_upload_ext(object_name) = 'webp')
        )
      )
      or
      (
        public.ptr29_upload_size(meta) <= 10485760
        and (
          (public.ptr29_upload_mime(meta) = 'application/pdf' and public.ptr29_upload_ext(object_name) = 'pdf') or
          (public.ptr29_upload_mime(meta) = 'text/plain' and public.ptr29_upload_ext(object_name) in ('txt','text','log')) or
          (public.ptr29_upload_mime(meta) = 'text/csv' and public.ptr29_upload_ext(object_name) = 'csv') or
          (public.ptr29_upload_mime(meta) = 'application/json' and public.ptr29_upload_ext(object_name) = 'json') or
          (public.ptr29_upload_mime(meta) = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' and public.ptr29_upload_ext(object_name) = 'docx') or
          (public.ptr29_upload_mime(meta) = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' and public.ptr29_upload_ext(object_name) = 'xlsx') or
          (public.ptr29_upload_mime(meta) = 'application/vnd.openxmlformats-officedocument.presentationml.presentation' and public.ptr29_upload_ext(object_name) = 'pptx')
        )
      )
    );
$$;

grant execute on function public.ptr29_upload_ext(text) to anon, authenticated;
grant execute on function public.ptr29_upload_mime(jsonb) to anon, authenticated;
grant execute on function public.ptr29_upload_size(jsonb) to anon, authenticated;
grant execute on function public.ptr29_upload_allowed(text, jsonb) to anon, authenticated;

-- ── Replace permissive policies with tighter ones.
do $$ declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public'
             and tablename in ('rooms','messages','receipts','reactions','users','presence') loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy rooms_select on public.rooms for select to anon, authenticated
  using (public.room_accessible(name, auth.uid()::text));
create policy rooms_insert on public.rooms for insert to anon, authenticated
  with check (auth.role() = 'authenticated' and (owner_id = '' or public.identity_allowed(owner_id)));
create policy rooms_update on public.rooms for update to anon, authenticated
  using (public.identity_allowed(owner_id) or admins && public.current_identity_ids())
  with check (public.identity_allowed(owner_id) or admins && public.current_identity_ids());
create policy rooms_delete on public.rooms for delete to anon, authenticated
  using (public.identity_allowed(owner_id));

create policy messages_select on public.messages for select to anon, authenticated
  using (public.room_accessible(room, auth.uid()::text));
create policy messages_insert on public.messages for insert to anon, authenticated
  with check (
    auth.role() = 'authenticated'
    and public.room_accessible(room, auth.uid()::text)
    and coalesce(payload->>'room','') = room
    and coalesce(payload->>'userId','') = auth.uid()::text
    and char_length(coalesce(payload->>'message','')) <= 2000
    and coalesce(payload->>'type','text') in ('text','image','file')
    and (
      coalesce(payload->>'type','text') = 'text'
      or (
        coalesce(payload->>'storagePath','') like room || '/%'
        and coalesce(payload->>'dataUrl','') = ''
        and coalesce(payload->>'mimeType','') <> ''
        and coalesce(payload->>'fileSize','0') ~ '^\d+$'
        and (
          (coalesce(payload->>'type','text') = 'image' and (payload->>'fileSize')::bigint <= 5242880 and (payload->>'mimeType') in ('image/jpeg','image/png','image/gif','image/webp'))
          or
          (coalesce(payload->>'type','text') = 'file' and (payload->>'fileSize')::bigint <= 10485760 and (payload->>'mimeType') in ('application/pdf','text/plain','text/csv','application/json','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation'))
        )
      )
    )
  );
create policy messages_update on public.messages for update to anon, authenticated
  using (public.room_accessible(room, auth.uid()::text) and coalesce(payload->>'userId','') = auth.uid()::text)
  with check (public.room_accessible(room, auth.uid()::text) and coalesce(payload->>'userId','') = auth.uid()::text);
create policy messages_delete on public.messages for delete to anon, authenticated
  using (public.room_accessible(room, auth.uid()::text) and coalesce(payload->>'userId','') = auth.uid()::text);

create policy receipts_select on public.receipts for select to anon, authenticated
  using (public.room_accessible(room, auth.uid()::text));
create policy receipts_insert on public.receipts for insert to anon, authenticated
  with check (uid = auth.uid()::text and public.room_accessible(room, auth.uid()::text));
create policy receipts_delete on public.receipts for delete to anon, authenticated
  using (uid = auth.uid()::text);

create policy reactions_select on public.reactions for select to anon, authenticated
  using (public.room_accessible(room, auth.uid()::text));
create policy reactions_insert on public.reactions for insert to anon, authenticated
  with check (uid = auth.uid()::text and public.room_accessible(room, auth.uid()::text) and char_length(emoji) <= 16);
create policy reactions_delete on public.reactions for delete to anon, authenticated
  using (uid = auth.uid()::text);

create policy users_select on public.users for select to anon, authenticated
  using (auth.role() = 'authenticated');
create policy users_insert on public.users for insert to anon, authenticated
  with check (public.identity_allowed(client_id));
create policy users_update on public.users for update to anon, authenticated
  using (public.identity_allowed(client_id)) with check (public.identity_allowed(client_id));
create policy users_delete on public.users for delete to anon, authenticated
  using (public.identity_allowed(client_id));

create policy presence_select on public.presence for select to anon, authenticated
  using (auth.role() = 'authenticated');
create policy presence_insert on public.presence for insert to anon, authenticated
  with check (uid = auth.uid()::text);
create policy presence_update on public.presence for update to anon, authenticated
  using (uid = auth.uid()::text) with check (uid = auth.uid()::text);
create policy presence_delete on public.presence for delete to anon, authenticated
  using (uid = auth.uid()::text);

-- Storage policies: private bucket, allowed room folder, allow-listed type/size.
drop policy if exists uploads_insert on storage.objects;
drop policy if exists uploads_select on storage.objects;

create policy uploads_insert on storage.objects for insert to anon, authenticated with check (
  bucket_id = 'chat-uploads'
  and auth.role() = 'authenticated'
  and public.ptr29_upload_allowed(name, metadata)
  and public.room_accessible((storage.foldername(name))[1], auth.uid()::text)
);

create policy uploads_select on storage.objects for select to anon, authenticated using (
  bucket_id = 'chat-uploads'
  and public.room_accessible((storage.foldername(name))[1], auth.uid()::text)
);

-- Optional clean-up of expired account sessions.
create or replace function public.prune_account_sessions()
returns void language sql security definer set search_path = public as $$
  delete from public.account_sessions where expires_at <= now();
$$;

grant execute on function public.prune_account_sessions() to anon, authenticated;

-- Done.

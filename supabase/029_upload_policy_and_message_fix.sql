-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · upload storage + message policy compatibility fix
-- Run AFTER 028_upload_extension_mime_fix.sql in Supabase SQL Editor.
--
-- Fixes allowed file uploads failing when browser/Supabase reports generic
-- MIME metadata, by allowing safe extensions in BOTH:
--   • storage.objects insert policy
--   • public.messages insert policy for upload payloads
-- ═══════════════════════════════════════════════════════════════════

-- ── Helpers ───────────────────────────────────────────────────────
create or replace function public.ptr29_upload_ext(object_name text)
returns text language sql immutable as $$
  select case
    when coalesce(object_name, '') like '%.%' then lower(reverse(split_part(reverse(object_name), '.', 1)))
    else ''
  end;
$$;

create or replace function public.ptr29_upload_mime(meta jsonb)
returns text language sql immutable as $$
  select lower(coalesce(meta->>'mimetype', meta->>'mimeType', ''));
$$;

create or replace function public.ptr29_upload_size(meta jsonb)
returns bigint language sql immutable as $$
  select case when coalesce(meta->>'size', '') ~ '^[0-9]+$' then (meta->>'size')::bigint else 0 end;
$$;

create or replace function public.ptr29_upload_allowed_ext(object_name text)
returns boolean language sql immutable as $$
  select public.ptr29_upload_ext(object_name) in ('pdf','txt','text','log','csv','json','docx','xlsx','pptx','jpg','jpeg','png','gif','webp');
$$;

create or replace function public.ptr29_upload_ext_mime_ok(object_name text, mime text)
returns boolean language sql immutable as $$
  select
    (
      lower(coalesce(mime,'')) in ('', 'application/octet-stream', 'binary/octet-stream')
      and public.ptr29_upload_ext(object_name) in ('pdf','txt','text','log','csv','json','docx','xlsx','pptx')
    )
    or (lower(coalesce(mime,'')) = 'application/pdf' and public.ptr29_upload_ext(object_name) = 'pdf')
    or (lower(coalesce(mime,'')) = 'text/plain' and public.ptr29_upload_ext(object_name) in ('txt','text','log'))
    or (lower(coalesce(mime,'')) = 'text/csv' and public.ptr29_upload_ext(object_name) = 'csv')
    or (lower(coalesce(mime,'')) = 'application/json' and public.ptr29_upload_ext(object_name) = 'json')
    or (lower(coalesce(mime,'')) = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' and public.ptr29_upload_ext(object_name) = 'docx')
    or (lower(coalesce(mime,'')) = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' and public.ptr29_upload_ext(object_name) = 'xlsx')
    or (lower(coalesce(mime,'')) = 'application/vnd.openxmlformats-officedocument.presentationml.presentation' and public.ptr29_upload_ext(object_name) = 'pptx')
    or (lower(coalesce(mime,'')) = 'image/jpeg' and public.ptr29_upload_ext(object_name) in ('jpg','jpeg'))
    or (lower(coalesce(mime,'')) = 'image/png'  and public.ptr29_upload_ext(object_name) = 'png')
    or (lower(coalesce(mime,'')) = 'image/gif'  and public.ptr29_upload_ext(object_name) = 'gif')
    or (lower(coalesce(mime,'')) = 'image/webp' and public.ptr29_upload_ext(object_name) = 'webp');
$$;

-- Storage RLS policy helper. If size metadata is missing/zero during RLS
-- evaluation, rely on bucket limit + client checks + message policy.
create or replace function public.ptr29_upload_allowed(object_name text, meta jsonb)
returns boolean language sql immutable as $$
  select
    public.ptr29_upload_allowed_ext(object_name)
    and public.ptr29_upload_ext_mime_ok(object_name, public.ptr29_upload_mime(meta))
    and (
      public.ptr29_upload_size(meta) = 0
      or (
        public.ptr29_upload_ext(object_name) in ('jpg','jpeg','png','gif','webp')
        and public.ptr29_upload_size(meta) <= 5242880
      )
      or (
        public.ptr29_upload_ext(object_name) in ('pdf','txt','text','log','csv','json','docx','xlsx','pptx')
        and public.ptr29_upload_size(meta) <= 10485760
      )
    );
$$;

-- Message payload helper for upload messages.
create or replace function public.ptr29_message_upload_allowed(room_name text, payload jsonb)
returns boolean language sql immutable as $$
  select
    coalesce(payload->>'storagePath','') like room_name || '/%'
    and coalesce(payload->>'dataUrl','') = ''
    and coalesce(payload->>'fileSize','0') ~ '^[0-9]+$'
    and public.ptr29_upload_allowed_ext(coalesce(payload->>'storagePath',''))
    and public.ptr29_upload_ext_mime_ok(coalesce(payload->>'storagePath',''), coalesce(payload->>'mimeType',''))
    and (
      (
        coalesce(payload->>'type','text') = 'image'
        and public.ptr29_upload_ext(coalesce(payload->>'storagePath','')) in ('jpg','jpeg','png','gif','webp')
        and (payload->>'fileSize')::bigint <= 5242880
      )
      or
      (
        coalesce(payload->>'type','text') = 'file'
        and public.ptr29_upload_ext(coalesce(payload->>'storagePath','')) in ('pdf','txt','text','log','csv','json','docx','xlsx','pptx')
        and (payload->>'fileSize')::bigint <= 10485760
      )
    );
$$;

grant execute on function public.ptr29_upload_ext(text) to anon, authenticated;
grant execute on function public.ptr29_upload_mime(jsonb) to anon, authenticated;
grant execute on function public.ptr29_upload_size(jsonb) to anon, authenticated;
grant execute on function public.ptr29_upload_allowed_ext(text) to anon, authenticated;
grant execute on function public.ptr29_upload_ext_mime_ok(text, text) to anon, authenticated;
grant execute on function public.ptr29_upload_allowed(text, jsonb) to anon, authenticated;
grant execute on function public.ptr29_message_upload_allowed(text, jsonb) to anon, authenticated;

-- Keep storage bucket bounded server-side.
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array[
         'image/jpeg','image/png','image/gif','image/webp',
         'application/pdf','text/plain','text/csv','application/json',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation',
         'application/octet-stream','binary/octet-stream'
       ]
 where id = 'chat-uploads';

-- ── Storage policies ─────────────────────────────────────────────
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

-- ── Message insert policy ────────────────────────────────────────
drop policy if exists messages_insert on public.messages;

create policy messages_insert on public.messages for insert to anon, authenticated
  with check (
    auth.role() = 'authenticated'
    and public.room_accessible(room, auth.uid()::text)
    and coalesce(payload->>'room','') = room
    and coalesce(payload->>'userId','') = auth.uid()::text
    and char_length(coalesce(payload->>'message','')) <= 2000
    and public.ptr29_message_links_allowed(payload->>'message')
    and coalesce(payload->>'type','text') in ('text','image','file')
    and (
      coalesce(payload->>'type','text') = 'text'
      or public.ptr29_message_upload_allowed(room, payload)
    )
  );

-- Done.

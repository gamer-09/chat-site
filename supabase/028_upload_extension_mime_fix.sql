-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · upload MIME/extension compatibility fix
-- Run AFTER 011_security_hardening.sql (and after later migrations).
--
-- Some browsers/Supabase uploads report allowed files as an empty MIME
-- type or application/octet-stream even when the extension is allowed
-- (.pdf, .txt, .csv, .json, .docx, .xlsx, .pptx). This keeps the size
-- limits and dangerous-extension blocks, while allowing safe extensions
-- when the MIME metadata is generic.
-- ═══════════════════════════════════════════════════════════════════

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
          (public.ptr29_upload_mime(meta) = 'application/vnd.openxmlformats-officedocument.presentationml.presentation' and public.ptr29_upload_ext(object_name) = 'pptx') or
          (
            public.ptr29_upload_mime(meta) in ('', 'application/octet-stream', 'binary/octet-stream')
            and public.ptr29_upload_ext(object_name) in ('pdf','txt','text','log','csv','json','docx','xlsx','pptx')
          )
        )
      )
    );
$$;

grant execute on function public.ptr29_upload_allowed(text, jsonb) to anon, authenticated;

-- Done.

-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · safe link validation
-- Run AFTER 011_security_hardening.sql in Supabase SQL Editor.
--
-- Allows normal http/https links, but blocks unsafe protocols, localhost /
-- private-network links, credential-obfuscated links, punycode look-alike
-- domains, too many links, overlong links, and risky executable downloads.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.ptr29_message_links_allowed(msg text)
returns boolean
language plpgsql
immutable
as $$
declare
  raw text;
  clean text;
  link text;
  without_scheme text;
  hostport text;
  host text;
  link_count int := 0;
begin
  if msg is null then
    return true;
  end if;

  -- Dangerous browser/local protocols must not be sent as link-like text.
  if msg ~* '\m(javascript|data|file|vbscript)[[:space:]]*:' then
    return false;
  end if;

  for raw in
    select (m)[1]
      from regexp_matches(msg, $rx$((https?://|www\.)[^[:space:]<>"']+)$rx$, 'gi') as m
  loop
    link_count := link_count + 1;
    if link_count > 5 then
      return false;
    end if;

    -- Remove common punctuation copied at the end of a sentence.
    clean := regexp_replace(raw, $rx$[),.!?;:'"\]]+$rx$, '');
    if clean = '' or char_length(clean) > 2048 then
      return false;
    end if;

    link := clean;
    if link ~* '^www\.' then
      link := 'https://' || link;
    end if;

    if link !~* '^https?://' then
      return false;
    end if;

    -- Block credential-obfuscated URLs such as https://user:pass@example.com
    if link ~* '^https?://[^/[:space:]?#]*@' then
      return false;
    end if;

    -- Block risky executable/script download targets.
    if lower(link) ~ '\.(exe|msi|apk|ipa|dmg|pkg|bat|cmd|sh|ps1|vbs|scr|jar|js|mjs|wasm)([?#]|$)' then
      return false;
    end if;

    without_scheme := regexp_replace(link, '^https?://', '', 'i');
    hostport := split_part(split_part(split_part(without_scheme, '/', 1), '?', 1), '#', 1);
    hostport := regexp_replace(lower(hostport), '\.$', '');

    if hostport = '' or position('@' in hostport) > 0 then
      return false;
    end if;

    -- Block IPv6/bracketed hosts. Allow a normal numeric port on domains/IPv4.
    if hostport like '[%' or hostport like '%]' then
      return false;
    end if;
    if position(':' in hostport) > 0 then
      if hostport ~ '^[^:]+:[0-9]{1,5}$' then
        host := split_part(hostport, ':', 1);
      else
        return false;
      end if;
    else
      host := hostport;
    end if;

    if host = '' then
      return false;
    end if;

    if host = 'localhost' or host like '%.localhost' then
      return false;
    end if;

    if host like 'xn--%' or host like '%.xn--%' then
      return false;
    end if;

    -- Block local/private IPv4, link-local, carrier-grade NAT, multicast/reserved.
    if host ~ '^(0|10|127)\.'
       or host ~ '^169\.254\.'
       or host ~ '^192\.168\.'
       or host ~ '^172\.(1[6-9]|2[0-9]|3[0-1])\.'
       or host ~ '^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.'
       or host ~ '^(22[4-9]|23[0-9]|24[0-9]|25[0-5])\.' then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

grant execute on function public.ptr29_message_links_allowed(text) to anon, authenticated;

-- Recreate the message policies from 011 with the safe-link check added.
drop policy if exists messages_insert on public.messages;
drop policy if exists messages_update on public.messages;

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
  with check (
    public.room_accessible(room, auth.uid()::text)
    and coalesce(payload->>'userId','') = auth.uid()::text
    and char_length(coalesce(payload->>'message','')) <= 2000
    and public.ptr29_message_links_allowed(payload->>'message')
  );

-- Done.

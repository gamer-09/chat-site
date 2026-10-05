-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · safe-link PostgreSQL regex fix
-- Run AFTER 019_markdown_safe_links.sql in Supabase SQL Editor.
--
-- Fixes Supabase RLS rejecting normal safe links such as YouTube,
-- GitHub Pages, Instagram, and Markdown-style pasted links.
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
  if msg ~* $rx$\m(javascript|data|file|vbscript)[[:space:]]*:$rx$ then
    return false;
  end if;

  -- Stop at Markdown delimiters ()[] as well as whitespace/quotes.
  for raw in
    select (m)[1]
      from regexp_matches(msg, $rx$((https?://|www\.)[^[:space:]<>"'()\[\]]+)$rx$, 'gi') as m
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
    if link ~* $rx$^www\.$rx$ then
      link := 'https://' || link;
    end if;

    if link !~* $rx$^https?://$rx$ then
      return false;
    end if;

    -- Block credential-obfuscated URLs such as https://user:pass@example.com
    if link ~* $rx$^https?://[^/[:space:]?#]*@$rx$ then
      return false;
    end if;

    -- Block risky executable/script download targets.
    if lower(link) ~ $rx$\.(exe|msi|apk|ipa|dmg|pkg|bat|cmd|sh|ps1|vbs|scr|jar|js|mjs|wasm)([?#]|$)$rx$ then
      return false;
    end if;

    without_scheme := regexp_replace(link, $rx$^https?://$rx$, '', 'i');
    hostport := split_part(split_part(split_part(without_scheme, '/', 1), '?', 1), '#', 1);
    hostport := regexp_replace(lower(hostport), $rx$\.$rx$, '');

    if hostport = '' or position('@' in hostport) > 0 then
      return false;
    end if;

    -- Block IPv6/bracketed hosts. Allow a normal numeric port on domains/IPv4.
    if hostport like '[%' or hostport like '%]' then
      return false;
    end if;
    if position(':' in hostport) > 0 then
      if hostport ~ $rx$^[^:]+:[0-9]{1,5}$$rx$ then
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
    if host ~ $rx$^(0|10|127)\.$rx$
       or host ~ $rx$^169\.254\.$rx$
       or host ~ $rx$^192\.168\.$rx$
       or host ~ $rx$^172\.(1[6-9]|2[0-9]|3[0-1])\.$rx$
       or host ~ $rx$^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.$rx$
       or host ~ $rx$^(22[4-9]|23[0-9]|24[0-9]|25[0-5])\.$rx$ then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

grant execute on function public.ptr29_message_links_allowed(text) to anon, authenticated;

-- Done.

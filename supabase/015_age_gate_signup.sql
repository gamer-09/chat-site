-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · server-enforced age gate for registration
-- Run AFTER 014_stop_client_id_sharing.sql in Supabase SQL Editor.
--
-- Replaces register_account so account creation requires an explicit
-- age_confirmed=true value. Children under 13 may not create accounts.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

drop function if exists public.register_account(text, text);
drop function if exists public.register_account(text, text, boolean);

create or replace function public.register_account(un text, pass text, age_confirmed boolean)
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
  if age_confirmed is not true then
    return '{"ok":false,"error":"age_required"}'::jsonb;
  end if;
  if lower(un) = 'anonymous' or length(un) < 2 or length(un) > 50 or un ~ '[\r\n\t]' then
    return '{"ok":false,"error":"invalid_username"}'::jsonb;
  end if;
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

grant execute on function public.register_account(text, text, boolean) to anon, authenticated;

-- Done.

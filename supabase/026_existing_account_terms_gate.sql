-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · Terms gate for existing accounts
-- Run AFTER 025_block_reserved_account_login.sql in Supabase SQL Editor.
--
-- Makes Terms/Privacy acceptance mandatory for all existing accounts,
-- not only new signups. The app blocks entry until this confirmation is
-- stored server-side.
-- ═══════════════════════════════════════════════════════════════════

alter table public.accounts
  add column if not exists terms_accepted boolean not null default false,
  add column if not exists terms_accepted_at timestamptz;

create or replace function public.account_terms_status(acct uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  ok_session boolean;
  accepted boolean;
begin
  if auth.uid() is null then
    return '{"ok":false,"error":"not_authenticated"}'::jsonb;
  end if;

  select exists (
    select 1 from public.account_sessions s
    where s.account_id = acct
      and s.auth_uid = auth.uid()::text
      and s.expires_at > now()
  ) into ok_session;

  if not ok_session then
    return '{"ok":false,"error":"forbidden"}'::jsonb;
  end if;

  select coalesce(a.terms_accepted, false) into accepted
    from public.accounts a where a.id = acct;

  return jsonb_build_object('ok', true, 'terms_accepted', coalesce(accepted, false));
end;
$$;

create or replace function public.confirm_account_terms(acct uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  ok_session boolean;
begin
  if auth.uid() is null then
    return '{"ok":false,"error":"not_authenticated"}'::jsonb;
  end if;

  select exists (
    select 1 from public.account_sessions s
    where s.account_id = acct
      and s.auth_uid = auth.uid()::text
      and s.expires_at > now()
  ) into ok_session;

  if not ok_session then
    return '{"ok":false,"error":"forbidden"}'::jsonb;
  end if;

  update public.accounts
     set terms_accepted = true,
         terms_accepted_at = coalesce(terms_accepted_at, now())
   where id = acct;

  return '{"ok":true,"terms_accepted":true}'::jsonb;
end;
$$;

grant execute on function public.account_terms_status(uuid) to anon, authenticated;
grant execute on function public.confirm_account_terms(uuid) to anon, authenticated;

-- Done.

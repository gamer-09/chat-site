-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · account avatar + terms sync
-- Run AFTER 022_backfill_account_avatars.sql in Supabase SQL Editor.
--
-- Saves profile avatars to public.accounts as well as public.users and
-- stores Terms acceptance for older accounts when they tick/save Terms.
-- ═══════════════════════════════════════════════════════════════════

alter table public.accounts
  add column if not exists avatar text default '',
  add column if not exists terms_accepted boolean not null default false,
  add column if not exists terms_accepted_at timestamptz;

create or replace function public.update_account_profile(acct uuid, avatar_in text default '', terms_accepted_in boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  ok_session boolean;
  clean_avatar text := coalesce(avatar_in, '');
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

  -- Basic server-side sanity for avatar strings. The browser already performs
  -- richer validation; this prevents obviously unsafe protocols/direct huge data.
  if clean_avatar <> '' then
    if char_length(clean_avatar) > 1500000 then
      return '{"ok":false,"error":"avatar_too_large"}'::jsonb;
    end if;
    if clean_avatar !~* '^https://'
       and clean_avatar !~* '^data:image/(png|jpeg|jpg|gif|webp);base64,' then
      return '{"ok":false,"error":"invalid_avatar"}'::jsonb;
    end if;
  end if;

  update public.accounts
     set avatar = clean_avatar,
         terms_accepted = case when terms_accepted_in then true else terms_accepted end,
         terms_accepted_at = case
           when terms_accepted_in and terms_accepted_at is null then now()
           else terms_accepted_at
         end
   where id = acct;

  return jsonb_build_object('ok', true, 'avatar', clean_avatar, 'terms_accepted', terms_accepted_in);
end;
$$;

grant execute on function public.update_account_profile(uuid, text, boolean) to anon, authenticated;

-- One-time backfill in case users.avatar has data and accounts.avatar is blank.
update public.accounts a
   set avatar = u.avatar
  from public.users u
 where coalesce(a.avatar, '') = ''
   and coalesce(u.avatar, '') <> ''
   and (
     u.client_id = a.id::text
     or lower(u.username) = lower(a.username)
   );

-- Done.

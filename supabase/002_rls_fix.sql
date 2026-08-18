-- ═══════════════════════════════════════════════════════════════════
-- REPLICA chat · RLS fix: own-message deletion + reaction ownership
-- Run ONCE in: Supabase Dashboard → SQL Editor → paste → Run
--
-- What it fixes:
--  • "I deleted a message but it didn't delete"  → you can now delete
--    (and edit) any message sent by YOUR identity — by auth uid, by
--    client id, or by your current username.
--  • "Anyone can delete reactions"               → reactions can now be
--    removed ONLY by the person who sent them (uid or current username).
-- Idempotent: drops existing policies on both tables, recreates them.
-- ═══════════════════════════════════════════════════════════════════

do $$ declare r record;
begin
  for r in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'messages' loop
    execute format('drop policy %I on public.messages', r.policyname);
  end loop;
  for r in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'reactions' loop
    execute format('drop policy %I on public.reactions', r.policyname);
  end loop;
end $$;

-- ── messages ─────────────────────────────────────────────────────────
create policy messages_select on public.messages
  for select to anon, authenticated using (true);

create policy messages_insert on public.messages
  for insert to anon, authenticated with check (true);

create policy messages_update on public.messages
  for update to anon, authenticated
  using (
    payload->>'userId'   = auth.uid()::text
    or payload->>'clientId' = auth.uid()::text
    or payload->>'username' in (select public.my_usernames())
  )
  with check (
    payload->>'userId'   = auth.uid()::text
    or payload->>'clientId' = auth.uid()::text
    or payload->>'username' in (select public.my_usernames())
  );

create policy messages_delete on public.messages
  for delete to anon, authenticated
  using (
    payload->>'userId'   = auth.uid()::text
    or payload->>'clientId' = auth.uid()::text
    or payload->>'username' in (select public.my_usernames())
  );

-- ── reactions (only the sender may remove theirs) ───────────────────
create policy reactions_select on public.reactions
  for select to anon, authenticated using (true);

create policy reactions_insert on public.reactions
  for insert to anon, authenticated with check (true);

create policy reactions_delete on public.reactions
  for delete to anon, authenticated
  using (
    uid = auth.uid()::text
    or username in (select public.my_usernames())
  );

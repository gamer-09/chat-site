# ptr_29 Chat — GitHub Pages + Supabase Setup

The app runs fully on **GitHub Pages** (static files) with **Supabase** as its
backend (database, realtime, auth, file storage). The Node/Socket.IO server in
this folder is the optional self-hosted fallback.

---

## One-time setup (5 minutes)

### 1. Apply the base schema

1. Open your Supabase project dashboard
2. Click **SQL Editor** → **New query**
3. Paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql)
4. Click **Run** — you should see success with no errors

This creates all tables (rooms, messages, receipts, reactions, users, presence),
the base security rules (RLS), the `chat-uploads` storage bucket and realtime
publishing.

### 2. Run the numbered migrations — in order

`schema.sql` is only the starting point. Everything security-, legal- and
role-related lives in the numbered files in the repository root `supabase/`
folder. **Run each one in the SQL Editor in ascending order** and confirm
"Success. No rows returned" before moving on:

```text
011_security_hardening.sql            015_age_gate_signup.sql
012_safe_links.sql                    016_existing_account_age_verification.sql
013_inbox_badge_fix.sql               017_legacy_age_login_fix.sql
014_stop_client_id_sharing.sql        018_terms_acceptance_signup.sql
019_markdown_safe_links.sql           025_block_reserved_account_login.sql
020_safe_link_regex_fix.sql           026_existing_account_terms_gate.sql
021_login_avatar_fallback.sql         027_cleanup_reserved_presence.sql
022_backfill_account_avatars.sql      028_upload_extension_mime_fix.sql
023_account_profile_terms_sync.sql    029_upload_policy_and_message_fix.sql
024_ban_anonymous_usernames.sql       030_room_ownership.sql
031_room_owner_identity_fix.sql       032_room_roles_and_kick.sql
033_room_roles_followups.sql
```

What the last few do, because they matter most in practice:

| Migration | Why you need it |
|---|---|
| `030` → `031` | Room ownership is stored as the browser auth uid (what the room rules check). 031 repairs rooms that 030 re-pointed and syncs the owner **name**, so the owner keeps full admin rights and shows the right name |
| `032` | Server-side room roles: `resolve_identities`, `room_add_member`, `room_add_admin`, `room_kick` (+ ban list), `room_claim_ownership`, ban-aware `join_room` |
| `033` | Accepts the **shortened Client ID** the sidebar shows, adds `room_unban` + `room_list_bans` (reversible kicks) and `room_is_member` |

> If you skip `032`/`033`, the app now says so plainly: *"Room roles need the
> database update: run supabase/032_room_roles_and_kick.sql in Supabase."*

### 3. Enable anonymous sign-ins (required)

1. Supabase dashboard → **Authentication** → **Sign In / Providers**
2. Find **Anonymous** → toggle it **on** ("Allow anonymous sign-ins")
3. Save

This gives every visitor a private, stable identity — it is what makes the
database rules work.

### 4. Publish to GitHub Pages

1. Push this repo to GitHub — `.github/workflows/deploy-pages.yml` deploys on
   every push to `main` (it also stamps the build id into `index.html` and
   writes `public/version.json`)
2. GitHub repo → **Settings** → **Pages** → **Source**: **GitHub Actions**
3. The site goes live at `https://gamer-09.github.io/chat-site/`

> The build stamp is what makes the in-app freshness guard work: if a browser is
> holding an older document, it reloads itself once after a deploy.

---

## What you get after setup

- Accounts with 13+ confirmation and Terms/Privacy acceptance (new **and** existing accounts)
- Public and private rooms, passkeys, membership, and **server-side room roles** — add members/admins by Client ID or username, kick, ban / allow rejoin
- Search with match counter + ↑/↓ navigation, **@mentions** with autocomplete, jump-to-newest button
- **Out-of-app notifications** (service worker) for other-room messages, mentions and inbox requests — opt-in from Edit Profile → Appearance
- Optional **Glass UI** (frosted panels over a live animated backdrop), also in Edit Profile → Appearance
- Uploads served through **signed URLs** that only room members can generate

---

## Notes

- **Data lives in the cloud** and persists across deployments. Free-tier limits: 500 MB database, 1 GB storage, 5 GB egress/month — see the egress section in `README.md`.
- Notifications need HTTPS and a service worker (both provided by GitHub Pages). On iPhone, add the site to the Home Screen first.
- If you ever reset the Supabase project, re-run `schema.sql`, then the numbered migrations, then re-enable anonymous sign-ins.
- The self-hosted `node server.js` copy still works untouched; `README.md` has the environment variables and the feature-parity notes.

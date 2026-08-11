# ptr_29 Chat — GitHub Pages + Supabase Setup

The app now runs fully on **GitHub Pages** (static files) with **Supabase** as its
backend (database, realtime, auth, file storage). The old Node/Socket.IO server
is no longer needed for the hosted version.

## One-time setup (2 minutes)

### 1. Apply the database schema
1. Open your Supabase project dashboard
2. Click **SQL Editor** → **New query**
3. Paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql)
4. Click **Run** — you should see success with no errors

This creates all tables (rooms, messages, receipts, reactions, users, presence),
security rules (RLS), the `chat-uploads` storage bucket, and realtime publishing.

### 2. Enable anonymous sign-ins (required!)
1. Supabase dashboard → **Authentication** → **Sign In / Providers**
2. Find **Anonymous** → toggle it **on** (check "Allow anonymous sign-ins")
3. Save

This is what gives every visitor a private, stable identity — it's what makes
the security rules work.

### 3. Publish to GitHub Pages
1. Push this repo to GitHub (the included
   `.github/workflows/deploy-pages.yml` auto-deploys on push to `main`)
2. GitHub repo → **Settings** → **Pages**
3. Under **Build and deployment** → **Source**: choose **GitHub Actions**
   (the workflow will publish `Chatting_updated/public` automatically)
4. Your site goes live at `https://gamer-09.github.io/chat-site/`

## What changed vs the old server version
- `public/supabase-client.js` — new backend adapter (auth, realtime, storage)
- `public/client.js` — talks to `window.ChatAPI` instead of Socket.IO/REST
- `public/index.html` — loads the Supabase SDK, all paths made relative
- `supabase/schema.sql` — the full database schema
- Private rooms + uploaded images are access-controlled via database rules,
  so nobody can see them without the passkey / membership.
- Your old local `node server.js` copy still works untouched if you want it.

## Notes
- **Data lives in the cloud now** — it persists across deployments (no more
  resets). Free tier limits: 500 MB database, 1 GB storage.
- Uploads are served via **signed URLs** that only room members can generate.
- If you ever reset the Supabase project, just re-run `schema.sql` and re-enable
  anonymous sign-ins.

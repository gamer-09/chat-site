> ### 🌐 [Open Chat Site →](https://gamer-09.github.io/chat-site/)

![Chat Site interface preview](docs/chat-site-preview.png)

# Chat Site


A real-time multi-room chat app. The deployed site runs on GitHub Pages + Supabase; the repo also includes the original Node.js/Express/Socket.io server for self-hosting. Access requires an account (login/register gate), 13+ age confirmation, and Terms/Privacy acceptance; existing accounts created before those gates are prompted before entering. Your username, rooms and content follow the account across devices.

---

## Features

| Feature | Details |
|---|---|
| Real-time messaging | Instant delivery via Supabase Realtime on GitHub Pages; Socket.IO remains available in the self-hosted Node server |
| Multiple rooms | Join existing rooms or create your own |
| Private rooms | Lock any room with a passkey |
| Image sharing | Upload and send allow-listed images up to 5 MB; other safe document types up to 10 MB |
| Typing indicators | See when others are typing |
| Edit & delete | Edit or delete your own messages within the time window |
| Read receipts | See who has read each message |
| User presence | Online = tab open, offline = tab closed; presence pruned when stale |
| People panel | Online/Offline toggle with live counts, **search filter**, last-seen times |
| Member profiles | Online-list ⋮ menu → personal card (avatar, status, activity stats); view-only entry point |
| Client-ID requests | Consent-based: reasoned request → recipient approves/denies in the 📥 Inbox; approval shares a snapshot and can later be stopped/revoked |
| Username rules | Any username containing “anonymous” is reserved and cannot be created, edited into, logged into, or continued from legacy sessions; abandoned/orphan names auto-reclaimable; active names protected |
| Full wipes | Rename fully erases the old name's messages/reactions/receipts; **Delete Account** (password-verified) erases account + user + all content + owned rooms; operator `purge_user()` for any name |
| Reactions | Instant hover tooltip with names ("you" for self), correct own-detection, toggle semantics |
| Accounts | 🔐 Login/register gate before app access; 13+ age confirmation and Terms/Privacy acceptance for new and legacy accounts; bcrypt+pepper hashed passwords (SHA-256 on-device first); hashes unreadable via API; 5-try rate limit; logout button; Delete Account = full erase |
| Unique usernames | Server enforces no two users share the same name |
| Auto avatars | DiceBear avatars generated from your username, or supply your own URL |
| Room roles | Requires migrations `032` **and** `033` (the app tells you if they are missing). Add a member/admin by **Client ID (full or the shortened form shown in the UI) or username** — resolved server-side to every identity that person owns. The People ⋮ menu shows **Kick** only for someone actually in this room (never for the owner, admins or yourself) — everyone else just gets profile / request-ID. **Banning and un-bans live in Room settings**: ban anyone by Client ID or username, and press ↩ Allow rejoin to let a kicked person back in. Admins can also claim a room whose owner row is an orphaned browser session. Every action reports success or the exact reason |
| Room ownership | Rooms are owned by the **browser auth uid** (what the room RLS/RPCs check), while the owner **name** shown comes from that identity's `users` row, which is kept in sync with the signed-in account. Switching accounts on one device therefore shows the current account as owner and never locks the owner out of their own room; the UI also accepts either id as "me" (`identityAliases`) |
| Admin tools | Rename, clear, delete, transfer ownership, manage admins and users |
| Inbox | Received + sent Client-ID requests, realtime badge/popup notifications, approval/denial status, and Stop sharing controls |
| Guided tour | 🎓 Launches once after a brand-new account is created, and can be replayed manually from the 🎓 button or Help. It creates temporary demo rooms only when started and deletes them when finished |
| Themes | 🌙/☀️ dark-light toggle, remembered per browser; message links **and read receipts** re-tint per theme and bubble type so they never disappear into a dark or gradient bubble |
| Jump to newest | Floating ↓ button above the composer appears whenever you scroll up (PC, tablet, phone); it shows a count of messages that arrived while you were reading and returns you to the newest message |
| System notifications | Notifications are sent through the **service worker**, so they appear outside the app (background tab, minimised window, locked phone) for new messages in other rooms, mentions of you and inbox requests. Toggle in Edit Profile → Appearance; permission is requested on enable |
| Appearance settings | Edit Profile holds the Glass UI switch and the live-backdrop motion switch; both apply instantly and are remembered per browser (no profile save needed) |
| Glass UI | Available to **every account**: a normal appearance setting in **Edit Profile → Appearance** (🫧 Glass UI + a live-backdrop motion switch). Frosted-glass panels + composer over a **live animated backdrop** — `glass-backdrop.js` draws flowing colour-wave bands, drifting orbs and bokeh on a `<canvas>` (no images, no network). The still JPEGs (`glass-backdrop-dark.jpg` / `glass-backdrop-light.jpg`) paint the instant first frame the canvas crossfades over. Dark/light palettes follow the theme and ⏸ Still / ▶ Animate freezes it (honours `prefers-reduced-motion`). The glass level is **fixed at the final 15%** for everyone — no per-browser control: chrome panels, strips, composer and message layers sit at ~15% opacity with a 6.4px blur via the `--gb-*` variables, so the waves stay clearly visible. Content stays readable on purpose: message bubbles are opaque (dark `#111827` / light `#ffffff`, own-message gradient), the typing strip is transparent, dialogs are at 30% with the whole-page scrim lightened so the backdrop shows through, and the 13+/Terms gates stay near-solid for their legal copy. An auto-lite tier drops render scale/frame rate on slow devices, and the engine only runs while glass mode is on. Turning it off returns the plain solid UI instantly |
| Resilience | Self-hosted Supabase lib, versioned assets, network-first service worker, and a **build-freshness guard**: every deploy stamps the commit id into `index.html` and writes `version.json`, and the app reloads once if the open document is older than the deployed build (GitHub Pages caches HTML for ~10 minutes, which used to hide new releases) |
| Message search | Highlights every match in the room, shows a live **match counter** (`2/6`, plus `+N older` when older messages also match), steps through matches with ↑/↓ (Enter / Shift+Enter on desktop) and a **✕ cancel** that clears the highlights and restores your view |
| @mentions | Type `@` in the composer for a filtered user list (online first, then offline) — arrows + Enter/Tab or click to insert. Mentioned users see a highlighted `@name` chip, an in-app toast, and a system notification |
| Built-in help | Slide-by-slide help guide accessible from the toolbar |
| Mobile layout | Responsive design with a dedicated mobile sidebar |
| PWA | Service worker included for offline caching |
| Safe links | Plain and Markdown-style http/https links are clickable after validation; unsafe protocols, private/local links, credential-obfuscated links, punycode look-alikes, risky downloads, and link spam are blocked. This is allow-list validation, not a full malware scan of the remote site. |
| Docker ready | `Dockerfile` included for container deployments |

---

## Project Structure

```
Chatting_updated/
├── server.js            # Express + Socket.IO server — self-hosted entry point
├── package.json
├── Dockerfile
├── Procfile             # For Heroku-style platforms
├── data/
│   ├── store.js         # JSON data layer (rooms, messages, users)
│   └── db.json          # Persistent store — auto-created on first run
├── public/
│   ├── index.html       # Main chat UI (all styles inline)
│   ├── client.js        # Frontend app logic (sockets, rooms, messages, gates)
│   ├── chat-ux.js       # Search with counters/navigation, @mentions, system notifications
│   ├── glass-backdrop.js# Live animated glass backdrop (canvas waves; opt-in Glass UI)
│   ├── supabase-client.js # Data layer used by the GitHub Pages build
│   ├── mobile.css       # Mobile/tablet styles
│   ├── version.json      # Build stamp written by the deploy workflow
│   ├── terms.html       # Terms of Use
│   ├── privacy.html     # Privacy Policy
│   └── sw.js            # Service worker (notifications, offline shell, freshness)
└── uploads/             # Self-hosted uploads — auto-created on first run
```

---

## Requirements

- Node.js 18 or newer (20 recommended)
- npm 8 or newer

---

## Running Locally

```bash
cd Chatting_updated
npm install
npm start
```

Open `http://localhost:3000` in your browser. The deployed GitHub Pages version uses `public/supabase-client.js` and Supabase; the Node server is the self-hosted fallback.

**Feature parity:** the UI, search, @mentions, jump-to-newest, themes and Glass UI are shared by both builds. The **room-role commands (add member/admin by Client ID or username, kick, ban / allow rejoin)** and **out-of-app system notifications** are implemented against Supabase (migrations 032/033) and are therefore only active on the hosted build; the self-hosted Node server keeps the original room tools (rename, clear, delete, admins/members) and its own socket-based notifications.

For development with auto-reload:

```bash
npm run dev
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the server listens on |
| `HOST` | `127.0.0.1` | Interface to bind to |
| `ADMIN_TOKEN` | unset | Required token for destructive server admin endpoints (`/api/clear-all`, `/api/admins/prune`, `/admin/shutdown`). If unset, those endpoints are disabled. |
| `ALLOWED_ORIGINS` | same-origin only | Comma-separated extra origins/hosts allowed to call the API/socket server. |
| `UPLOAD_SECRET` | random per boot | Secret used to sign self-hosted upload URLs; set a fixed strong value in production. |
| `MAX_IMAGE_BYTES` | `5242880` | Self-hosted image upload limit. |
| `MAX_FILE_BYTES` | `10485760` | Self-hosted non-image file upload limit. |

> Set `HOST=0.0.0.0` when running on a VPS or inside Docker so the server is reachable from outside.

### Supabase security migrations

For the GitHub Pages + Supabase deployment, run the SQL files in `supabase/` in order. The current security/legal sequence is:

```text
011_security_hardening.sql
012_safe_links.sql
013_inbox_badge_fix.sql
014_stop_client_id_sharing.sql
015_age_gate_signup.sql
016_existing_account_age_verification.sql
017_legacy_age_login_fix.sql
018_terms_acceptance_signup.sql
019_markdown_safe_links.sql
020_safe_link_regex_fix.sql
021_login_avatar_fallback.sql
022_backfill_account_avatars.sql
023_account_profile_terms_sync.sql
024_ban_anonymous_usernames.sql
025_block_reserved_account_login.sql
026_existing_account_terms_gate.sql
027_cleanup_reserved_presence.sql
028_upload_extension_mime_fix.sql
029_upload_policy_and_message_fix.sql
030_room_ownership.sql
031_room_owner_identity_fix.sql
032_room_roles_and_kick.sql
033_room_roles_followups.sql
```

`011_security_hardening.sql` enforces account-session binding, stricter RLS, upload type/size limits, and safer message payload checks on the server side. Then run `supabase/012_safe_links.sql` to enforce safe-link validation in Supabase too. Run `supabase/013_inbox_badge_fix.sql` to enable realtime inbox badge updates, `supabase/014_stop_client_id_sharing.sql` to allow approved Client-ID sharing to be stopped, then `supabase/015_age_gate_signup.sql` to enforce the 13+ signup gate server-side, then `supabase/016_existing_account_age_verification.sql` so existing accounts are prompted and can store their confirmation, then `supabase/017_legacy_age_login_fix.sql` so legacy sessions that predate account sessions are forced through fresh login/verification instead of being skipped, then `supabase/018_terms_acceptance_signup.sql` so Terms acceptance is stored and enforced server-side at signup, then `supabase/019_markdown_safe_links.sql` so Markdown-style pasted links are parsed safely instead of rejected incorrectly, then `supabase/020_safe_link_regex_fix.sql` to correct the PostgreSQL regex used by the RLS safe-link check, then `supabase/021_login_avatar_fallback.sql` so older accounts restore avatars saved in the profile table, then `supabase/022_backfill_account_avatars.sql` to copy existing profile avatars into the account table, then `supabase/023_account_profile_terms_sync.sql` so future avatar and Terms changes sync back to the account record, then `supabase/024_ban_anonymous_usernames.sql` to reserve any username containing “anonymous”, then `supabase/025_block_reserved_account_login.sql` to block legacy accounts using that reserved pattern from logging in, then `supabase/026_existing_account_terms_gate.sql` so every existing account must accept Terms/Privacy before entering, then `supabase/027_cleanup_reserved_presence.sql` to remove stale Anonymous/reserved People-panel presence rows, then `supabase/028_upload_extension_mime_fix.sql` so allowed file extensions still work when MIME metadata is generic, then `supabase/029_upload_policy_and_message_fix.sql` to align Storage and message RLS upload checks, then `supabase/030_room_ownership.sql`, then **`supabase/031_room_owner_identity_fix.sql`** which is the important one: room ownership lives in the browser auth-uid space (that is what `rooms` RLS and the room RPCs such as `delete_room`/`rename_room` check), so 031 moves any room that 030 re-pointed at an account id back to that account's auth uid and writes the account's current name/avatar onto that identity row. That is what makes the owner see the right name AND keep full admin rights on their own room. Finally run `supabase/032_room_roles_and_kick.sql` and `supabase/033_room_roles_followups.sql`: they move room roles server-side (add a member/admin by **Client ID or username**, resolved to every identity that person owns), add **kick** with a room-scoped **ban list** plus **Allow rejoin**, accept the *shortened* Client ID the sidebar displays, and let an admin claim a room whose owner row is an orphaned browser session. Without 032/033 the role buttons report “Room roles need the database update”.

---

## Docker

```bash
cd Chatting_updated

# Build
docker build -t chat-site .

# Run
docker run -p 3000:3000 -e HOST=0.0.0.0 chat-site
```

To keep messages and uploads after the container restarts:

```bash
docker run -p 3000:3000 -e HOST=0.0.0.0 \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/uploads:/app/uploads" \
  chat-site
```

---

## Deploying to a VPS

```bash
# 1. SSH into your server and clone
git clone https://github.com/gamer-09/chat-site.git
cd chat-site/Chatting_updated

# 2. Install dependencies
npm install --omit=dev

# 3. Start with PM2 so it survives reboots
npm install -g pm2
HOST=0.0.0.0 PORT=3000 pm2 start server.js --name chat-site
pm2 save
pm2 startup   # copy and run the command it prints
```

Then open port 3000 in your firewall, or put Nginx or Caddy in front on port 80/443 with HTTPS.

### Updating from GitHub

```bash
cd chat-site/Chatting_updated
git pull --ff-only
npm install --omit=dev
pm2 restart chat-site
```

---

## Deploying to Railway / Render / Heroku

The `Procfile` is already configured:

```
web: node server.js
```

Set `HOST=0.0.0.0` in your hosting dashboard's environment variables. `PORT` is set automatically by most platforms.

---

## How to Use

### Joining a room

1. Log in or create an account at the account gate. New signups must confirm 13+ and accept Terms/Privacy.
2. Pick a room from the Rooms list, or click **+ New Room** to create one.
3. Public rooms open immediately; private rooms require membership or a valid passkey.

### Sending a message

- Type in the message box and press **Enter** or click **Send**.
- Click the image icon to attach and send a JPG/PNG/GIF/WebP photo (max 5 MB).
- Click the file icon to attach an allow-listed file (PDF, TXT, CSV, JSON, DOCX, XLSX, PPTX; max 10 MB).

### Sending links

The chat accepts normal links and Markdown-style pasted links, for example:

```text
https://www.youtube.com/@WhiteWanderer-j4w
[https://gamer-09.github.io/Note_vault/](https://gamer-09.github.io/Note_vault/)
[My site](https://gamer-09.github.io/Note_vault/)
```

Before a message is saved, the browser and Supabase RLS check the link. The app allows only regular `http://` and `https://` links, then blocks unsafe protocols, localhost/private-network targets, links with embedded usernames/passwords, punycode look-alike domains, risky executable/script downloads, and messages with too many links. This is a validation/allow-list check; it does **not** guarantee the destination site is malware-free.

### Creating a room

1. Click **+ New Room**.
2. Enter a room name (letters, numbers, hyphens, underscores — max 50 characters).
3. Toggle **Private** if you want to restrict access, then set a passkey.
4. Click **Create**.

### Joining a private room

Click the room name and enter the passkey when prompted. The passkey is checked against the server — it is not stored in your browser.

### Searching a room

The search box in the room bar highlights **every** match, shows a live counter (`3/12`, plus `+N older` when older messages are not loaded), and steps through them with the ↑ / ↓ buttons (or Enter / Shift+Enter in the box). **✕** cancels, clears the highlights and returns you to where you were reading. On phones the same controls live behind the 🔍 button.

### Mentions

Type `@` in the composer for a filtered list of users — online first, then offline. Use ↑/↓ and Enter/Tab (or click) to insert. The mentioned person sees a highlighted `@name` chip, an in-app toast, and a system notification.

### Jumping to the newest message

When you scroll up, a floating **↓** button appears above the composer with a badge counting messages that arrived while you were reading. Click it to return to the newest message.

### Notifications outside the app

Open **Edit Profile → Appearance** and switch on **🔔 Notifications outside the app**. Your browser asks for permission once. Notifications are delivered by the service worker, so they appear when the tab is in the background, the window is minimised, or the phone is locked — for messages in other rooms, mentions of you, and inbox requests. On iPhone, add the site to the Home Screen first (iOS requirement).

### Appearance (Glass UI)

**Edit Profile → Appearance** also holds **🫧 Glass UI** (frosted, see-through panels over a live animated backdrop) and the **live backdrop animation** switch to freeze the waves. Both apply instantly and are remembered on that browser.

### Editing or deleting messages

Hover over one of your own messages and click the **edit** or **delete** icon. Editing is only available within the time window set by the server.

### Admin actions (room owner / room admin)

Room owners and room admins have a settings panel for **that room only**:

- Rename the room, change privacy, set or clear the passkey
- **Add a member** (private-room access) or **add an admin** — paste a **Client ID (full or the shortened form shown in the sidebar) or a username**; the server resolves it to every identity that person owns
- **Kick** — offered in the People ⋮ menu only for someone actually in this room (never the owner, an admin, or yourself)
- **Ban / Allow rejoin** — *Room settings → Banned from this room*: ban anyone by Client ID or username, and press **↩** to let them back in. A banned person cannot rejoin, even with the passkey
- Clear all messages, delete the room
- If the room's owner row belongs to a dead browser session, an admin is offered **claim ownership** so management works again

The owner is counted as an admin in the room banner and wears a 👑 in the admin list.

---

## API Reference

### HTTP endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check — returns `{ status: "ok" }` |
| `GET` | `/api/rooms` | List all rooms |
| `POST` | `/api/rooms` | Create a room |
| `GET` | `/api/rooms/:room/messages?clientId=&limit=` | Fetch message history |
| `POST` | `/api/rooms/:room/images` | Upload an image |

### WebSocket events (client → server)

| Event | Payload | Description |
|---|---|---|
| `join` | `{ room, username, avatar, clientId }` | Enter a room |
| `chat-message` | `{ text, replyTo }` | Send a text message |
| `typing` | `{ isTyping }` | Broadcast typing state |
| `update-profile` | `{ room, clientId, username, avatar }` | Change display name or avatar |
| `check-username` | `{ username }` | Check if a username is available |
| `edit-message` | `{ room, id, text, clientId }` | Edit a sent message |
| `delete-message` | `{ room, id, clientId }` | Delete a message |
| `list-users` | — | Request list of all users |
| `add-room-members` / `add-room-admins` | `{ room, identifier }` | Add a member/admin by Client ID or username (server-resolved) |
| `kick-room-user` | `{ room, identifier }` | Kick + room-ban; reverse it with the ban list |
| `get-room-meta` | `{ room }` | Room owner/admins/members/passkey (manager view only) |

### WebSocket events (server → client)

`chat-message`, `history`, `presence`, `presence-all`, `system`, `typing`, `rooms`, `read-receipt`, `message-updated`, `message-deleted`, `room-renamed`, `room-deleted`

---

## Data Storage

The deployed GitHub Pages app stores data in Supabase tables/storage — including each room's owner/admin/member lists, its **ban list** (`rooms.banned`, used by kick/ban with allow-rejoin) and a build stamp in `public/version.json`. The self-hosted Node server stores data in `Chatting_updated/data/db.json` plus local `uploads/`; back those up if you run the Node version. Do not commit runtime data or uploads to GitHub.

---

## Operator contact

Official operator channels:

- WhatsApp: [+234 902 378 5212](https://wa.me/2349023785212)
- Instagram: [@not_udo2025](https://www.instagram.com/not_udo2025/)
- YouTube: [@WhiteWanderer-j4w](https://www.youtube.com/@WhiteWanderer-j4w)
- GitHub: [gamer-09](https://github.com/gamer-09)

Do not send passwords, room passkeys, or unnecessary sensitive information through contact channels.

---

## Egress / bandwidth controls

The GitHub Pages + Supabase deployment is tuned to reduce Supabase egress:

- Room history loads the latest 50 messages by default.
- Reactions/read receipts are fetched only for the currently loaded history messages, not the whole room.
- Message search is limited to recent messages (150 results) and history to the latest 50.
- Presence heartbeat/pruning intervals are less aggressive than the original realtime prototype.
- Upload size/type limits keep large media from consuming storage/egress unexpectedly.

If egress spikes, check Storage downloads first: shared images/files are usually the largest contributor. Consider deleting old uploaded objects, reducing image sizes, or moving to a paid Supabase plan before sharing publicly.

---

## Legal & Safety

Running a public chat platform makes you the operator. These steps protect you:

### Included Terms and Privacy pages

The app already includes `public/terms.html` (Terms of Service / Terms of Use) and `public/privacy.html`, linked from the header, Contact modal, and Help guide. They now describe the 13+ age requirement, account gates, uploads, safe links, Client-ID requests/Stop sharing, account deletion, private-room limits, **room-level kick/ban by room owners and admins (with an allow-rejoin path)**, **opt-in service-worker notifications** (including that a preview can appear on a locked screen), and operator contact.

### Remaining operator responsibilities

- Keep an abuse/security contact visible and monitored.
- Run the Supabase migrations in order, especially the age-gate and security migrations.
- Use HTTPS in production; never expose the chat over plain HTTP.
- Keep `.env`, `data/db.json`, runtime logs, and user uploads out of GitHub.
- If you later add email marketing, payments/subscriptions, analytics, ads, Google Fonts, or session replay, update the Terms/Privacy before launch.

## Database migrations (Supabase SQL Editor)

| File | Purpose |
|---|---|
| `Chatting_updated/supabase/schema.sql` | Base schema (rooms, messages, presence, receipts, reactions, room RPCs) |
| *(inline in chat)* | `purge_user(name)` — full operator purge of a username |
| `supabase/001_id_requests.sql` | Client-ID request inbox table + participant-only RLS |
| `supabase/002_rls_fix.sql` | Own-message edit/delete by any of your identities; reactions sender-only |
| `supabase/004_username_available.sql` | One-call availability check + orphan reclaim |
| `supabase/005_reserve_anonymous.sql` | Reserves "anonymous" |
| `supabase/007…/008_backfill…sql` | Backfill user rows from every activity source |
| `supabase/009_accounts.sql` | Hardened accounts: no client-facing table policies, peppered bcrypt, rate limiting, anti-enumeration |
| `supabase/010_delete_account.sql` | `delete_account(acct, pass)` — password-verified SECURITY DEFINER full erase |
| `supabase/011_security_hardening.sql` | Account-session binding, stricter RLS, upload type/size limits |
| `supabase/012_safe_links.sql` | Safe-link validation for messages and edits |
| `supabase/013_inbox_badge_fix.sql` | Realtime inbox badge updates + case-insensitive request matching |
| `supabase/014_stop_client_id_sharing.sql` | Allows approved Client-ID sharing to be revoked/stopped |
| `supabase/015_age_gate_signup.sql` | Requires explicit 13+ age confirmation for account registration |
| `supabase/016_existing_account_age_verification.sql` | Prompts/stores 13+ confirmation for existing accounts |
| `supabase/017_legacy_age_login_fix.sql` | Fixes legacy account sessions so age verification cannot be skipped |
| `supabase/018_terms_acceptance_signup.sql` | Requires explicit Terms/Privacy acceptance for account registration |
| `supabase/019_markdown_safe_links.sql` | Fixes safe-link parsing for Markdown-style pasted links |
| `supabase/020_safe_link_regex_fix.sql` | Corrects Supabase RLS regex so normal safe links are not rejected |
| `supabase/021_login_avatar_fallback.sql` | Restores avatars for older accounts whose avatar is stored in `users` instead of `accounts` |
| `supabase/022_backfill_account_avatars.sql` | Backfills blank `accounts.avatar` values from saved `users.avatar` rows |
| `supabase/023_account_profile_terms_sync.sql` | Saves future avatar updates and Terms acceptance to the account record |
| `supabase/024_ban_anonymous_usernames.sql` | Reserves any username containing “anonymous” |
| `supabase/025_block_reserved_account_login.sql` | Blocks legacy reserved-pattern accounts from logging in |
| `supabase/026_existing_account_terms_gate.sql` | Forces existing accounts through the Terms gate before entering |
| `supabase/027_cleanup_reserved_presence.sql` | Removes stale Anonymous/reserved presence rows |
| `supabase/028_upload_extension_mime_fix.sql` | Lets allow-listed extensions through when MIME metadata is generic |
| `supabase/029_upload_policy_and_message_fix.sql` | Aligns Storage + message RLS so allowed uploads post successfully |
| `supabase/030_room_ownership.sql` | Superseded by 031 — kept for history |
| `supabase/031_room_owner_identity_fix.sql` | Moves rooms back to the owning account's auth uid and syncs the owner name (keeps `delete_room`/`rename_room` working) |
| `supabase/032_room_roles_and_kick.sql` | Server-side room roles: `resolve_identities`, `room_add_member/admin`, `room_kick` + ban list, `room_claim_ownership`, ban-aware `join_room` |
| `supabase/033_room_roles_followups.sql` | Accepts the shortened Client ID shown in the UI, adds `room_unban` + `room_list_bans` (reversible kicks) and `room_is_member` for the Kick gate |

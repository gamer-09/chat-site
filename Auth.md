# Authentication & Session Model

This document describes how identity, login, sessions and account lifecycle work
in ptr_29 Chat. It is written for operators, auditors and contributors. It is
not legal advice and it is not a promise that every control is perfect.

Two builds exist:

| Build | Frontend | Backend | Audience |
|---|---|---|---|
| Hosted (primary) | GitHub Pages, `public/` | Supabase (Auth, Postgres, Realtime, Storage) | The public site |
| Self-hosted | Same `public/` UI | `server.js` (Express + Socket.IO + JSON file) | Local use / trusted network only |

The hosted build is the one covered by [SECURITY.md](SECURITY.md) support. The
self-hosted Node server has **no login gate of its own** (see
[Self-hosted server](#self-hosted-node-server) below).

---

## 1. Identity layers in the hosted build

There are three related identifiers. Confusing them is the usual source of
access-control bugs.

1. **Supabase auth uid** (`auth.uid()`)
   Created automatically by Supabase anonymous sign-in the first time a browser
   loads the app. It is stored in the browser session. It is the identity the
   database trusts for Row Level Security (RLS). It is not a username and is not
   secret.

2. **Account** (`public.accounts.id`)
   Created only when a visitor registers a username and password. The account
   row is linked to one or more auth uids through `public.account_sessions`.
   A username can be used from several browsers/devices; each browser keeps its
   own auth uid.

3. **Client ID / username** (`public.users.client_id`, `username`)
   The public-facing chat identity used in messages, rooms, reactions and
   presence. The app resolves a username or Client ID to every identity the
   account owns. Room roles and bans are stored against these identities.

The key rule: **RLS decisions use the auth uid**, not a value supplied in the
request body. Client-supplied `client_id` or `userId` fields are checked against
`auth.uid()` and the identities reachable from it.

---

## 2. Registration

1. The browser has (or obtains) an anonymous Supabase session.
2. The user chooses a username and password, confirms 13+, and accepts the
   Terms and Privacy Policy.
3. The browser computes
   `SHA-256(password + ":" + username.toLowerCase())` and sends the 64-character
   hex digest — never the plaintext password.
4. The `register_account(un, pass, age_confirmed, terms_accepted)` RPC
   (`SECURITY DEFINER`, see `supabase/018`, `024`, `038`) validates:
   - a live `auth.uid()`,
   - 13+ confirmation and Terms/Privacy acceptance,
   - username length/characters and the reserved-name rules
     (`ptr29_username_reserved`, which blocks `anonymous` variants and
     impersonation patterns),
   - the digest format `^[0-9a-f]{64}$`,
   - username uniqueness (case-insensitive).
5. The server adds a pepper and bcrypt-hashes the digest:
   `crypt(pass || pepper, gen_salt('bf', 12))`. The plaintext digest is not
   stored. The pepper is a server-side secret (`038_pepper_vault.sql` reads it
   from Supabase Vault; earlier migrations embedded a v1 pepper).
6. A row is written to `account_sessions` linking the new account to the current
   auth uid, with a 30-day expiry.
7. The username is adopted locally and the UI unlocks.

Usernames are unique case-insensitively. A rename is not cosmetic — it wipes the
previous identity's content and issues a new identity (see
`supabase/035_rename_wipes_identity.sql`), and the UI warns first.

---

## 3. Login

`login_account(un, pass)` (`supabase/025`, redefined by `038`):

1. Requires a live `auth.uid()` and a well-formed digest.
2. Rejects reserved usernames before touching the password hash.
3. Checks `login_locks` and returns `{"ok":false,"error":"locked"}` if the
   username is temporarily locked.
4. Loads the account by case-insensitive username.
5. If the username does not exist, it still performs a bcrypt operation with a
   dummy hash so response timing does not reveal whether the account exists.
6. Verifies `crypt(pass || pepper, stored_hash)`. The pepper version stored on
   the row is used. A successful login on an older pepper version is
   transparently re-hashed with the current pepper.
7. On failure: increments `login_locks.fails`; the fifth consecutive failure
   locks the username for 15 minutes.
8. On success: clears the lock, upserts `account_sessions` for this auth uid
   with a fresh 30-day expiry, and returns the profile.

Account login is a **username + password** credential. There is no email,
phone, OAuth or magic-link login, so there is currently no self-service password
reset. A forgotten password means the account cannot be recovered by the
operator without a separate identity-verification process, which the app does
not implement. Do not claim otherwise in support replies.

---

## 4. Sessions

- The browser keeps the Supabase session (local storage + refresh token handled
  by the vendored Supabase client).
- `public.account_sessions` maps an account to each auth uid that has logged in,
  with `expires_at` defaulting to 30 days and refreshed on login.
- Database authorization for account-only actions (profile update, rename,
  delete) requires a **live, unexpired** `account_sessions` row for the current
  `auth.uid()`.
- Expired session rows are removed by `prune_account_sessions()` (callable by
  `anon`/`authenticated`, deletes only expired rows).
- Signing out of the account clears the local account session and returns the
  browser to an anonymous auth identity; it does not delete the Supabase auth
  user.
- Clearing site data removes the browser session. On the next load the app signs
  in anonymously again and the old auth uid is no longer usable from that
  browser; content owned solely by that uid is effectively orphaned unless an
  account links it.

### Pepper rotation

`supabase/038_pepper_vault.sql`:

- adds `accounts.pepper_version` (default `1`),
- reads the current pepper from Vault (`ptr29_pepper_v2`) through the
  `ptr29_pepper(version)` helper,
- fails closed on registration if the secret is missing or shorter than 32
  characters,
- keeps v1 only to verify legacy hashes, and upgrades a row on successful login,
- accepts either version in `delete_account`.

`supabase/039_ensure_pepper_secret.sql` creates `ptr29_pepper_v2` once if it is
missing (value generated inside the database) and verifies the helper works. It
never overwrites an existing secret. Run it after 038 so a skipped manual
`vault.create_secret(...)` step cannot leave registration returning HTTP 400.

Operational rules:

1. Create/rotate the Vault secret **before** running or re-running the
   migration — or run `039_ensure_pepper_secret.sql`, which does it for you the
   first time.
2. Bump `ptr29_current_pepper_version()` when rotating again.
3. Do not delete old secret versions until every account has logged in at least
   once, or those accounts will be locked out.
4. Rotating the pepper does **not** invalidate existing sessions; rotate the
   Supabase JWT secret separately if you need to force re-authentication.

---

## 5. Authorization in the database

RLS is enabled on `rooms`, `messages`, `reactions`, `receipts`, `users`,
`presence`, `id_requests`, `accounts`, `login_locks`, `account_sessions`,
`bug_reports` and `storage.objects`.

Representative rules (`supabase/011_security_hardening.sql`,
`029_upload_policy_and_message_fix.sql`):

- **Rooms/messages/receipts/reactions:** visibility requires
  `room_accessible(room, auth.uid())` — public rooms are readable by any
  authenticated session; private rooms only by owner, admins or members.
- **Message insert:** requires `auth.role() = 'authenticated'`, room access,
  `payload.room = room`, `payload.userId = auth.uid()`, ≤ 2000 characters, a
  known message type, and — for uploads — a storage path inside that room with
  an allow-listed MIME type and size. Link filtering is applied as well.
- **Message update/delete:** only the author's auth uid, within room access.
- **Users/presence:** profile rows and presence are writable only for identities
  derived from the caller.
- **Room administration:** owner/admin checks use
  `current_identity_ids()`; kick/ban/member/admin helpers are `SECURITY DEFINER`
  functions that re-check the caller.
- **Storage:** the `chat-uploads` bucket is private. Insert/select requires an
  authenticated session, room access to the first path folder, and an
  allow-listed extension/MIME/size. Reads use short-lived signed URLs (7 days in
  the current client).
- **Bug reports:** write-only to the app (no `SELECT` policy for clients), via a
  rate-limited `SECURITY DEFINER` RPC. The operator reads them with the secret
  key.

The `accounts`, `login_locks` and `account_sessions` tables deliberately expose
no direct client policies; access goes through the RPCs.

---

## 6. Account deletion and rename

- `delete_account(acct, pass)` requires the correct password digest, then
  deletes the account's messages, reactions, receipts, profile, presence, owned
  rooms, session links, login locks and the account row. It also covers every
  auth uid recorded in `account_sessions`.
- Deletion is best-effort and immediate at the database level. It does **not**
  guarantee removal of storage objects referenced by deleted messages,
  provider backups/logs, cached signed URLs, or copies in the GitHub issue
  tracker (bug reports).
- `rename_account(acct, new_un)` wipes the old identity's content and owned
  rooms, then issues a new identity. This is intentional and irreversible
  through the UI.
- Deleting the local account does not delete the Supabase anonymous auth user.
  Those users are managed in the Supabase dashboard.

---

## 7. Secret handling

| Secret | Where it belongs | Never |
|---|---|---|
| Supabase publishable/anon key | `public/supabase-client.js` (public by design) | — |
| Supabase secret/service key | GitHub Actions secret `SUPABASE_SECRET_KEY`, server-side only | In `public/**`, a commit, or the browser |
| Password pepper | Supabase Vault (`ptr29_pepper_v2`) | In SQL text, docs, or the repo |
| `UPLOAD_SECRET` (self-hosted) | Environment variable | A committed default |
| `ADMIN_TOKEN` (self-hosted) | Environment variable | A committed default |

The publishable key is not a secret; it only permits what RLS permits.

---

## 8. Self-hosted Node server

`server.js` is a deliberately small Express + Socket.IO fallback. It stores data
in `data/db.json` and uploads in `uploads/`.

- **No authentication or authorization layer.** Identity is a browser-generated
  Client ID sent by the client. Anyone who can reach the server can act as any
  identity and read every room.
- Admin/destructive API endpoints were removed (`ADMIN_TOKEN` is empty and the
  admin API is gone). Do not re-add an unauthenticated admin surface.
- Uploads are served only through signed `?sig=` URLs using `UPLOAD_SECRET`; if
  the variable is unset, a random secret is generated per boot, so links break
  on restart.
- Run it on a trusted network or behind an authenticating reverse proxy. Do not
  expose it directly to the internet as a public chat service.
- If you need multi-user hosting with real access control, deploy the hosted
  Supabase build instead.

---

## 9. Known limitations

- No email/phone recovery and no self-service password reset.
- No MFA.
- No server-side logout/revocation list for anonymous auth users beyond Supabase
  session handling.
- Rate limits are application/database-level, not a substitute for edge/WAF
  protection.
- Username uniqueness and identity resolution are case-insensitive; reserve
  names carefully before allowing renames.
- Account deletion cannot guarantee erasure of every copy held by third parties.

Report authentication or authorization bugs privately as described in
[SECURITY.md](SECURITY.md).

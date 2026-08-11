> ### 🌐 [Open Chat Site →](https://gamer-09.github.io/chat-site/)

# Chat Site


A real-time multi-room chat app built with Node.js, Express, and Socket.io. No accounts required — pick a username and start chatting instantly.

---

## Features

| Feature | Details |
|---|---|
| Real-time messaging | Instant delivery via WebSocket (Socket.io) |
| Multiple rooms | Join existing rooms or create your own |
| Private rooms | Lock any room with a passkey |
| Image sharing | Upload and send images up to 10 MB |
| Typing indicators | See when others are typing |
| Edit & delete | Edit or delete your own messages within the time window |
| Read receipts | See who has read each message |
| User presence | Sidebar shows who is currently online per room |
| Unique usernames | Server enforces no two users share the same name |
| Auto avatars | DiceBear avatars generated from your username, or supply your own URL |
| Admin tools | Rename, clear, delete, transfer ownership, manage admins and members |
| Built-in help | Slide-by-slide help guide accessible from the toolbar |
| Mobile layout | Responsive design with a dedicated mobile sidebar |
| PWA | Service worker included for offline caching |
| Docker ready | `Dockerfile` included for container deployments |

---

## Project Structure

```
Chatting_updated/
├── server.js            # Express + Socket.io server — entry point
├── package.json
├── Dockerfile
├── Procfile             # For Heroku-style platforms
├── data/
│   ├── store.js         # JSON data layer (rooms, messages, users)
│   └── db.json          # Persistent store — auto-created on first run
├── public/
│   ├── index.html       # Main chat UI
│   ├── client.js        # Frontend Socket.io logic
│   ├── mobile.css       # Mobile styles
│   └── sw.js            # Service worker
└── uploads/             # Uploaded images — auto-created on first run
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

Open `http://localhost:3000` in your browser.

For development with auto-reload:

```bash
npm run dev
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the server listens on |
| `HOST` | `127.0.0.1` | Interface to bind to |

> Set `HOST=0.0.0.0` when running on a VPS or inside Docker so the server is reachable from outside.

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

1. Enter a **username** in the sidebar — minimum 2 characters, must be unique across all connected users.
2. Click a room from the list, or click **+ New Room** to create one.
3. Click **Join**.

### Sending a message

- Type in the message box and press **Enter** or click **Send**.
- Click the image icon to attach and send a photo (max 10 MB).

### Creating a room

1. Click **+ New Room**.
2. Enter a room name (letters, numbers, hyphens, underscores — max 50 characters).
3. Toggle **Private** if you want to restrict access, then set a passkey.
4. Click **Create**.

### Joining a private room

Click the room name and enter the passkey when prompted. The passkey is checked against the server — it is not stored in your browser.

### Editing or deleting messages

Hover over one of your own messages and click the **edit** or **delete** icon. Editing is only available within the time window set by the server.

### Admin actions (room owner)

Room owners have a settings panel with:

- Rename the room
- Clear all messages
- Delete the room
- Transfer ownership to another user
- Add or remove admins and members

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
| `message` | `{ room, text, clientId }` | Send a text message |
| `typing` | `{ isTyping }` | Broadcast typing state |
| `update-profile` | `{ room, clientId, username, avatar }` | Change display name or avatar |
| `check-username` | `{ username }` | Check if a username is available |
| `edit-message` | `{ room, id, text, clientId }` | Edit a sent message |
| `delete-message` | `{ room, id, clientId }` | Delete a message |
| `list-users` | — | Request list of all users |

### WebSocket events (server → client)

`message`, `presence`, `system`, `typing`, `users`, `receipt`, `room-renamed`, `room-deleted`

---

## Data Storage

All data is written to `data/db.json` — a plain JSON file, no database server needed. Back this file up regularly if message history matters.

For high-traffic deployments, replace the read/write calls in `data/store.js` with a proper database (PostgreSQL, SQLite, MongoDB, etc.).

---

## Legal & Safety

Running a public chat platform makes you the operator. These steps protect you:

### 1. Add a Terms of Service
State what users may and may not do, that you can remove content and ban users, and that you are not liable for user-generated content. Place a link to it in the site footer.

### 2. Add a Privacy Policy
Required by law if any EU or California users can access the site (GDPR / CCPA). Explain what you store — usernames, messages, uploaded images, and server IP logs — and how users can request deletion.

### 3. Add an abuse contact
Add a visible `abuse@yourdomain.com` email address. This is evidence that you act responsibly if a legal complaint is ever made about content on your site.

### 4. Enable server-side IP logging
The server does not currently log IP addresses. Adding IP logging to `server.js` means you can cooperate with law enforcement if something illegal is reported, which reduces your own liability.

### 5. Run behind HTTPS
Use Nginx or Caddy with a free Let's Encrypt certificate. Never run a public chat site over plain HTTP — messages and uploads would be visible to anyone on the same network.

### 6. Keep `.env` and `data/db.json` off GitHub
`db.json` contains all usernames and messages. Never commit it to a public repository. The `.gitignore` already excludes `.env` — make sure `data/db.json` is also excluded if you fork or redeploy.

# Chat Site

A real-time multi-room chat application built with Node.js, Express, and Socket.io. Supports multiple rooms, image sharing, typing indicators, private rooms with passkeys, and admin management — all with no account required.

---

## Features

- **Multiple rooms** — join any room or create your own
- **Private rooms** — lock a room with a passkey so only invited users can join
- **Real-time messaging** — messages appear instantly for everyone in the room via WebSocket
- **Image sharing** — upload and send images up to 10 MB
- **Typing indicators** — see when others are typing
- **Message editing and deletion** — edit or delete your own messages within the allowed time window
- **Read receipts** — see who has read each message
- **User presence** — sidebar shows who is currently online in each room
- **Unique usernames** — the server enforces that no two users share the same name
- **Avatar support** — auto-generated avatars via DiceBear, or supply your own URL
- **Admin tools** — room owners can rename, clear, delete, or transfer ownership of rooms
- **Help guide** — built-in slide-by-slide help modal accessible from the UI
- **Mobile friendly** — responsive layout with a dedicated mobile sidebar
- **Progressive Web App** — includes a service worker for offline caching
- **Docker ready** — includes a `Dockerfile` for containerised deployment

---

## Project Structure

```
Chatting_updated/
├── server.js              # Express + Socket.io server (entry point)
├── package.json
├── Dockerfile
├── Procfile               # For Heroku-style platforms (web: node server.js)
├── data/
│   ├── store.js           # JSON-file data layer (rooms, messages, users)
│   └── db.json            # Persistent data store (auto-created)
├── public/
│   ├── index.html         # Main chat UI
│   ├── client.js          # Frontend Socket.io logic
│   ├── mobile.css         # Mobile-specific styles
│   └── sw.js              # Service worker
└── uploads/               # Uploaded images (auto-created)
```

---

## Requirements

- **Node.js** 18 or newer (20 recommended)
- **npm** 8 or newer

---

## Running Locally

```bash
cd Chatting_updated
npm install
npm start
```

The server starts on `http://localhost:3000`.

For development with auto-reload on file changes:

```bash
npm run dev
```

### Environment variables

| Variable | Default       | Description                        |
|----------|---------------|------------------------------------|
| `PORT`   | `3000`        | Port the server listens on         |
| `HOST`   | `127.0.0.1`   | Host/interface to bind to          |

To listen on all interfaces (required for Docker or a VPS):

```bash
HOST=0.0.0.0 PORT=3000 node server.js
```

Or create a `.env` file and load it yourself — the server reads `process.env.HOST` and `process.env.PORT` directly.

---

## Running with Docker

Build the image:

```bash
cd Chatting_updated
docker build -t chat-site .
```

Run the container:

```bash
docker run -p 3000:3000 chat-site
```

The server will be available at `http://localhost:3000`.

To persist messages and uploads across restarts, mount the `data` and `uploads` directories:

```bash
docker run -p 3000:3000 \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/uploads:/app/uploads" \
  chat-site
```

---

## Deploying to a VPS

1. SSH into your server.
2. Install Node.js 20+ (`nvm` is recommended).
3. Clone this repository:

   ```bash
   git clone https://github.com/gamer-09/chat-site.git
   cd chat-site/Chatting_updated
   ```

4. Install dependencies:

   ```bash
   npm install --omit=dev
   ```

5. Start with a process manager so the server restarts on reboot:

   ```bash
   npm install -g pm2
   HOST=0.0.0.0 PORT=3000 pm2 start server.js --name chat-site
   pm2 save
   pm2 startup
   ```

6. Open port 3000 in your firewall (or put Nginx/Caddy in front on port 80/443).

---

## Deploying to Heroku / Railway / Render

The included `Procfile` is already configured:

```
web: node server.js
```

Set the environment variable `HOST=0.0.0.0` in your hosting provider's dashboard so the server binds to the public interface. `PORT` is set automatically by most platforms.

---

## Using the Chat Site

### Joining a room

1. Open the site in your browser.
2. Enter a **username** in the sidebar (minimum 2 characters, must be unique).
3. Click a room in the room list, or create a new one.
4. Press **Join** to enter the room.

### Sending messages

- Type in the message box and press **Enter** or click **Send**.
- Click the image icon to upload and send a photo (max 10 MB).

### Creating a room

1. Click **+ New Room** in the sidebar.
2. Enter a room name (letters, numbers, hyphens, underscores).
3. Optionally toggle **Private** and set a passkey — users will need the passkey to join.
4. Click **Create**.

### Joining a private room

1. Click the private room in the list.
2. Enter the passkey when prompted.

### Editing or deleting your messages

- Hover over a message you sent and click the **edit** or **delete** icon.
- Editing is only available within the allowed time window after sending.

### Admin actions (room owners)

Room owners can access a settings panel to:

- **Rename** the room
- **Clear** all messages
- **Delete** the room
- **Transfer ownership** to another user
- **Add or remove** admins and members

---

## API Endpoints

The server exposes a small REST API alongside the WebSocket connection.

| Method | Path                           | Description                          |
|--------|--------------------------------|--------------------------------------|
| GET    | `/health`                      | Health check — returns `{ status: "ok" }` |
| GET    | `/api/rooms`                   | List all rooms                       |
| POST   | `/api/rooms`                   | Create a room                        |
| GET    | `/api/rooms/:room/messages`    | Fetch message history for a room     |
| POST   | `/api/rooms/:room/images`      | Upload an image to a room            |

---

## WebSocket Events

Connect to the server with [Socket.io](https://socket.io/). The client emits:

| Event            | Payload                          | Description                     |
|------------------|----------------------------------|---------------------------------|
| `join`           | `{ room, username, avatar, clientId }` | Join a room               |
| `message`        | `{ room, text, clientId }`       | Send a text message             |
| `typing`         | `{ isTyping }`                   | Broadcast typing indicator      |
| `update-profile` | `{ room, clientId, username, avatar }` | Update display name/avatar |
| `check-username` | `{ username }`                   | Check if a username is available |
| `edit-message`   | `{ room, id, text, clientId }`   | Edit a sent message             |
| `delete-message` | `{ room, id, clientId }`         | Delete a sent message           |
| `list-users`     | —                                | Request list of all users       |

The server emits events including `message`, `presence`, `system`, `typing`, `users`, and `receipt`.

---

## Data Storage

All data is persisted in `data/db.json`. This is a plain JSON file — no database server is required. Back up this file regularly if you care about message history.

Data is written synchronously on each change. For high-traffic deployments, consider migrating the data layer in `data/store.js` to a proper database.

---

## Security Notes

- Never commit `.env` files or any file containing secrets to GitHub.
- The `uploads/` directory is publicly served — do not store sensitive files there.
- Room passkeys are stored in the JSON data file — do not use important passwords as passkeys.
- For production, run behind a reverse proxy (Nginx or Caddy) with HTTPS.

# Smart Messages

A web app that lets you read your iPhone text messages in a browser — desktop and mobile friendly. Messages sync automatically from your Mac every 5 minutes via a lightweight background agent.

## How it works

```
iPhone → iCloud → Mac Messages app → chat.db → sync agent → server → web UI
```

The sync agent runs on your Mac as a background service, reads new messages from `~/Library/Messages/chat.db`, and pushes them to the server every 5 minutes. The server stores them in its own database, served to any browser.

## Prerequisites

- Node.js 18+
- A Mac with the Messages app (synced with iPhone via iCloud)

## Local setup

```bash
npm install

# Create your first user
node create-user.js yourname yourpassword

# Start the server
npm start        # or: npm run dev  (auto-restarts on changes)
```

Open [http://localhost:3000](http://localhost:3000) and sign in.

## Set up the sync agent

1. Sign in to the web app and open **Settings** (gear icon) → copy your sync token
2. Run the installer:

```bash
bash sync-agent/install.sh
```

It will ask for your server URL and sync token, then register a launchd service that runs every 5 minutes.

> **Full Disk Access required**
> Node.js needs permission to read `~/Library/Messages/chat.db`.
> Go to **System Settings → Privacy & Security → Full Disk Access** and add the Node.js binary (shown during install).

**Monitor sync logs:**
```bash
tail -f /tmp/smartmessages-sync.log
tail -f /tmp/smartmessages-sync-error.log
```

**Run a sync manually:**
```bash
node sync-agent/index.js
```

**Uninstall the agent:**
```bash
bash sync-agent/uninstall.sh
```

## Adding users

Run this on the server (locally or via Render shell):

```bash
node create-user.js alice password123
```

This prints the user's sync token. Each user needs their own sync agent configured with their own token.

## Deploy to Render

1. Push the repo to GitHub
2. Go to [render.com](https://render.com) → **New → Web Service** → connect the repo
3. Render picks up `render.yaml` automatically (Node build, persistent disk for the database)
4. Set the `SESSION_SECRET` environment variable to a long random string:

```bash
# Generate a secret:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

5. After deploy, open the Render **Shell** tab and create your first user:

```bash
node create-user.js yourname yourpassword
```

6. Update `sync-agent/config.json` with your Render URL and re-run the installer.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `SESSION_SECRET` | `dev-secret-...` | Cookie signing secret — **change in production** |
| `SERVER_DB_PATH` | `data/server.db` | Path to server database |

## Project structure

```
├── server.js              Express app — routes, auth, sync endpoint
├── db-server.js           Server DB (users, chats, messages)
├── create-user.js         CLI to create user accounts
├── public/
│   └── index.html         Single-page frontend (Tailwind + vanilla JS)
├── sync-agent/
│   ├── index.js           Mac sync script (no dependencies)
│   ├── install.sh         Installs as a launchd background service
│   ├── uninstall.sh       Removes the launchd service
│   └── config.example.json
├── render.yaml            Render deployment config
└── data/                  (gitignored) — server.db lives here
```

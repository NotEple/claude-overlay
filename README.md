# OBS Overlay — Collaborative Canvas

A real-time collaborative overlay for OBS, built with React + Konva + Socket.io.

## Structure

```
/
├── client/   Vite + React + TypeScript + TailwindCSS
└── server/   Node.js + Express + Socket.io
```

## Local development

### 1. Server
```bash
cd server
npm install
npm run dev
# Runs on http://localhost:3001
```

### 2. Client
```bash
cd client
npm install
npm run dev
# Runs on http://localhost:5173
```

### 3. Views
- **Dashboard** → http://localhost:5173/
- **Overlay** → http://localhost:5173/overlay

In OBS: Add → Browser Source → URL: `https://your-render-url/overlay` → check **transparent background** → set width/height to 1920×1080.

## Environment variables

### Client (`client/.env`)
```
VITE_SERVER_URL=http://localhost:3001
```

### Server (`server/.env`)
```
PORT=3001
CLIENT_URL=http://localhost:5173
SESSION_SECRET=replace-with-a-long-random-secret
TWITCH_CLIENT_ID=your-twitch-client-id
TWITCH_CLIENT_SECRET=your-twitch-client-secret
TWITCH_REDIRECT_URI=http://localhost:3001/auth/callback
OWNER_TWITCH_USERNAME=vicksy
DATA_DIR=./data
UPLOAD_DIR=/tmp/obs-uploads
```

`SESSION_SECRET` is required when `NODE_ENV=production`. The owner defaults to
`vicksy`; the environment variable exists to make local testing easier.

For production, point these at your Render URLs.

## Deploying to Render

1. **Server** — New Web Service → root dir: `server` → build: `npm install && npm run build` → start: `npm start`
2. **Client** — New Static Site → root dir: `client` → build: `npm install && npm run build` → publish dir: `dist`

Set env vars in each service's Render dashboard.

Attach a Render persistent disk to the server and set `DATA_DIR` and
`UPLOAD_DIR` to directories on that disk. The whitelist, uploaded media,
scenes, presets, soundboard, and command definitions are stored there. Without a persistent disk,
Render will erase those settings whenever the service filesystem is replaced.

Chat commands connect anonymously to Vicksy's public channel by default.
Switching the dashboard preview between Vicksy and Wixels also moves the chat
listener to that channel. Those are the only two accepted channels. The
streamer does not need to authorize the listener, and no chat token is stored.
Anonymous chat can read public messages only; it cannot send messages or
receive private broadcaster events.

## Next steps

- [ ] Swap local `/tmp` file storage for durable object storage
- [ ] Persist canvas state to a DB (Drizzle + SQLite or Supabase)
- [ ] Continue splitting the DOM canvas interaction modules as features are added

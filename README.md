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
```

For production, point these at your Render URLs.

## Deploying to Render

1. **Server** — New Web Service → root dir: `server` → build: `npm install && npm run build` → start: `npm start`
2. **Client** — New Static Site → root dir: `client` → build: `npm install && npm run build` → publish dir: `dist`

Set env vars in each service's Render dashboard.

## Next steps

- [ ] Swap local `/tmp` file storage for Cloudinary (update `server/src/index.ts` upload route)
- [ ] Add mod authentication (Clerk or a simple password env var)
- [ ] Persist canvas state to a DB (Drizzle + SQLite or Supabase)
- [ ] Video element support in `CanvasStage` (Konva doesn't render `<video>` natively — use a DOM overlay)
- [ ] Z-index controls (bring forward / send back) in the toolbar

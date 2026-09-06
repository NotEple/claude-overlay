# Vicksy OBS Overlay

A private, collaborative stream-overlay controller for Vicksy and Wixels. The
dashboard lets approved users arrange media and drawings on a 1920×1080 OBS
browser source, operate effects, and connect Twitch chat or broadcaster events
to chained overlay actions in real time.

The editor is DOM-based. Media elements are positioned and transformed with
HTML, CSS, and native pointer events; freehand drawings use an HTML canvas.
Konva is not used by the current application code.

## What it does

- Synchronizes the dashboard and OBS overlay through Socket.IO.
- Adds images, GIFs, video, audio, text, and drawings to a large pan-and-zoom
  workspace containing a 1920×1080 stream viewport.
- Supports dragging, resizing, rotation, snapping, fit/fill placement,
  horizontal and vertical flips, grouping, duplication, visibility, locking,
  opacity, and undo/redo.
- Animates media with adjustable DVD movement, corner celebrations, sound, and
  a shared corner-hit counter.
- Provides a Soundboard and chained commands for showing, hiding, playing, or
  flying media across the stream, playing sounds, refreshing OBS, starting DVD
  movement, and sending Twitch chat messages.
- Listens anonymously to public Vicksy or Wixels chat commands through `tmi.js`.
- Displays Twitch and 7TV chat emotes as an ordered bottom parade or with floor/wall-bounce movement,
- Plays one-shot Pop, Pulse, Spin, Shake, and directional slide animations on selected media,
  configurable physics, sender labels, limits, and a chatter blacklist.
- Receives authenticated Twitch follows, subscriptions, gift subscriptions,
  Bits, raids, and custom channel-point redemptions through EventSub webhooks.
- Restricts dashboard access with Twitch login, an owner account, and a
  database-backed whitelist/admin role system.

## Project layout

```text
.
├── client/                 React, Vite, TypeScript, Socket.IO client
│   └── src/
│       ├── canvas/         Element transforms and DVD motion
│       ├── components/     Canvas, Studio, toolbars, dialogs, and effects
│       ├── hooks/          Authentication, sockets, and Twitch live state
│       └── views/          Dashboard, login, and OBS overlay
└── server/                 Node.js, Express, Socket.IO, PostgreSQL, tmi.js
    └── src/
        ├── auth/           Twitch login, signed sessions, and authorization
        ├── db/             LowDB studio data and PostgreSQL whitelist
        ├── socket/         Realtime handlers and input validation
        ├── state/          In-memory canvas history
        ├── twitch/         Chat listener, Event OAuth, and EventSub webhooks
        └── uploads/        Validated media uploads and Myinstants resolution
```

## Runtime model and persistence

The application intentionally uses more than one kind of state:

| Data | Storage | Survives a Render restart? |
| --- | --- | --- |
| Broadcaster OAuth tokens | Neon PostgreSQL, encrypted with AES-256-GCM | Yes |
| Dashboard whitelist and admin roles | Neon PostgreSQL when `DATABASE_URL` is set | Yes |
| Elements, drawings, cursor presence, history, playback | Server memory | No |
| Soundboard, commands, emote settings, scenes, presets | `DATA_DIR/db.json` through LowDB | Only with a persistent disk |
| Uploaded media | `UPLOAD_DIR` | Only with a persistent disk/object storage |

On Render's free tier, the filesystem is ephemeral. Neon keeps authorization
and whitelist records, but uploaded files and LowDB studio configuration can be
lost when the service is replaced or restarted. Do not treat `/tmp` as durable
storage.

## Local development

Node.js 22 or newer is required.

### Server

```bash
cd server
npm install
copy .env.example .env
npm run dev
```

The server listens on `http://localhost:3001` by default.

### Client

Create `client/.env`:

```dotenv
VITE_SERVER_URL=http://localhost:3001
```

Then start Vite:

```bash
cd client
npm install
npm run dev
```

Open:

- Dashboard: `http://localhost:5173/`
- OBS overlay: `http://localhost:5173/overlay`
- Loading-screen preview: `http://localhost:5173/?preview=loading`

## Server configuration

Copy `server/.env.example` to `server/.env`. Never commit the populated file.

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | Render supplies it | HTTP and Socket.IO port; local default is `3001`. |
| `CLIENT_URL` | Yes | Exact frontend origin, without a trailing path. Used by CORS and OAuth redirects. |
| `PUBLIC_SERVER_URL` | Production | Public server origin. Falls back to Render's `RENDER_EXTERNAL_URL`. |
| `NODE_ENV` | Production | Set to `production` on Render. |
| `SESSION_SECRET` | Yes | Signs dashboard sessions and Twitch Event OAuth state. |
| `OWNER_TWITCH_USERNAME` | Yes | Twitch login with owner privileges. |
| `TWITCH_CLIENT_ID` | Yes | Twitch Developer Console application ID. |
| `TWITCH_CLIENT_SECRET` | Yes | Twitch Developer Console application secret. |
| `TWITCH_REDIRECT_URI` | Recommended | Dashboard-login callback, ending in `/auth/callback`. |
| `TWITCH_EVENTS_REDIRECT_URI` | Recommended | Broadcaster callback, ending in `/auth/events/callback`. |
| `EVENT_CHANNELS` | Yes | Comma-separated broadcaster logins; currently `vicksy,wixels`. |
| `CHAT_BOT_USERNAME` | For chat messages | Dedicated Twitch account used to send automated messages; defaults to `dankchapbot`. |
| `DATABASE_URL` | Production | Neon pooled PostgreSQL connection URL with TLS enabled. |
| `TWITCH_TOKEN_ENCRYPTION_KEY` | Yes for Events | Base64-encoded 32-byte key used to encrypt stored broadcaster tokens. |
| `TWITCH_EVENTSUB_CALLBACK_URL` | Yes for Events | Public HTTPS webhook URL ending in `/twitch/eventsub`. |
| `TWITCH_EVENTSUB_SECRET` | Yes for Events | Independent random secret used to verify Twitch webhook signatures. |
| `DATA_DIR` | Optional | LowDB directory; defaults to `server/data` locally. |
| `UPLOAD_DIR` | Optional | Media directory; defaults to `/tmp/obs-uploads`. |

Generate independent secrets with Node.js:

```bash
# SESSION_SECRET or TWITCH_EVENTSUB_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# TWITCH_TOKEN_ENCRYPTION_KEY (must remain stable or stored tokens cannot decrypt)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Changing `TWITCH_TOKEN_ENCRYPTION_KEY` invalidates existing encrypted Twitch
authorizations. Each broadcaster must reconnect after that key changes.

## Twitch application setup

Register all callback URLs exactly in the same Twitch Developer Console
application used by the server:

```text
http://localhost:3001/auth/callback
http://localhost:3001/auth/events/callback
https://<server-host>/auth/callback
https://<server-host>/auth/events/callback
```

The production server variables must contain the exact same URLs. Twitch
rejects differences in protocol, hostname, port, path, or trailing slash.

### Dashboard login vs. broadcaster Events

These are separate OAuth flows:

1. **Dashboard login** identifies an approved controller. The owner always has
   access; everyone else must exist in the whitelist.
2. **Events connections** are completed once by the Vicksy and Wixels
   broadcaster accounts. They grant only the read permissions needed for
   broadcaster events.
3. **Chatbot connection** is completed once by the dedicated DankChapBot
   account. It grants `user:write:chat`; configured messages use this account as
   the sender and never use a broadcaster token to write chat.

All access and refresh tokens are encrypted before being stored in PostgreSQL
and are refreshed automatically.

Public chat commands and emotes do not require broadcaster authorization. The
anonymous listener follows the dashboard's active Vicksy/Wixels preview.

## OBS setup

Add a **Browser Source** in OBS with:

- URL: `https://<frontend-host>/overlay`
- Width: `1920`
- Height: `1080`
- Custom CSS: none required
- Control audio via OBS: enable if OBS should route/monitor overlay audio
- Refresh browser when scene becomes active: optional fallback
- Shutdown source when not visible: usually leave disabled if state and media
  should remain loaded between scene switches

The overlay URL is view-only but exposes whatever is currently being rendered.
Treat it as unlisted rather than as an administrative secret. Dashboard actions
remain protected by Twitch login and server-side authorization.

## Controls and shortcuts

The in-app **?** guide is the canonical quick reference. The current workspace
controls are:

| Input | Action |
| --- | --- |
| Left-drag an element | Move it; selected grouped elements move together |
| Alt + drag | Temporarily disable edge and center snapping |
| Drag a resize handle | Resize from that edge or corner |
| Drag the round handle | Rotate around the element center; hold Shift for 15° increments |
| Shift/Ctrl/Cmd + click | Add or remove an element from the selection |
| Drag empty background | Marquee-select multiple elements |
| Middle-mouse drag | Pan the workspace, including over the Twitch preview |
| Mouse wheel | Zoom toward or away from the pointer |
| Double-click text | Edit the text element |
| Delete / Backspace | Delete selected unlocked elements |
| Ctrl/Cmd + Z | Undo the latest shared canvas change |
| Ctrl/Cmd + Shift + Z | Redo the latest undone change |
| Ctrl/Cmd + Y | Redo on Windows |
| Ctrl/Cmd + C / V | Copy and paste selected elements |
| Shift while drawing a line/arrow | Snap the shape to 45° angles |
| Shift while drawing a box/oval | Constrain it to a square/circle |

Dashboard buttons use labels or icons with explanatory tooltips. Keep this
section and `HelpGuide.tsx` synchronized when adding a gesture or shortcut.

Before a stream, use **Go-live check** in the top bar to verify the realtime
server, connected OBS browser sources, selected chat listener, broadcaster
Events authorization, saved command targets, and visible layer placement. OBS
Browser Source dimensions cannot be detected remotely and still need to be
confirmed as 1920×1080 in OBS.

## Deploying on Render

### Server web service

```text
Root Directory: server
Build Command: npm install --include=dev && npm run build
Start Command: npm start
```

`--include=dev` is necessary because TypeScript and declaration packages are
development dependencies but are required during the production build.

Add all server environment variables in Render. Use the pooled Neon URL for
`DATABASE_URL`, retain its TLS options, and never expose database credentials or
Twitch secrets in client-side `VITE_*` variables.

### Client static site

```text
Root Directory: client
Build Command: npm install --include=dev && npm run build
Publish Directory: dist
```

Set:

```dotenv
VITE_SERVER_URL=https://<server-host>
```

Render invalidates the static-site CDN on successful deployments, and Vite
generates fingerprinted asset filenames. OBS can still be refreshed manually
from the dashboard if a long-running browser source remains on an old page.

## Verification

Before deploying:

```bash
cd client
npm run build

cd ../server
npm test
npm audit --omit=dev
```

After deploying:

1. Confirm the server starts and reports that PostgreSQL stores initialized.
2. Log into the dashboard with an approved Twitch account.
3. Open `/overlay` in OBS or a browser and verify the overlay status is online.
4. Connect Vicksy and Wixels in **Studio → Events**.
5. Run a simulated event, then verify one real Twitch event.
6. Confirm an anonymous chat command follows the selected preview channel.
7. Test uploaded media after a restart if durable file storage is configured.

## Security notes

- Dashboard mutations are authenticated and sensitive management routes enforce
  owner/admin permissions on the server.
- Twitch EventSub messages are checked with HMAC signatures, timestamp limits,
  and message-ID deduplication.
- Broadcaster tokens are encrypted at rest; encryption keys and OAuth secrets
  stay server-side.
- Uploaded files are size-limited and checked by allowed type and file
  signature. Do not weaken these checks to support arbitrary URLs.
- Myinstants page-link resolution is best-effort because Myinstants may reject
  requests from hosting-provider IPs. Downloading the MP3 and uploading it is
  the reliable fallback.
- Keep dependencies patched, rotate exposed secrets immediately, and avoid
  logging tokens, database URLs, session values, or deploy hooks.

## Known operational limitations

- This is a private Vicksy/Wixels overlay, not a general multi-tenant service.
- The free Render filesystem does not provide durable media or LowDB storage.
- Canvas state is intentionally runtime state and resets when the server does.
- The Twitch embed is cross-origin and sensitive to pointer-blocking layers;
  editor interaction uses a shield only while dashboard gestures require it.
- Myinstants can return HTTP 403 to server-side resolution requests.

## License and content

No license is currently declared. Twitch emotes, 7TV emotes, uploaded media,
sound effects, and included character artwork remain subject to their respective
owners' permissions and terms.

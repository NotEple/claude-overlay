import './types/session.js';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import multer from 'multer';
import session from 'express-session';
import FileStore from 'session-file-store';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { authRouter } from './auth/routes.js';
import { whitelistRouter } from './auth/whitelist.js';
import { requireAuth } from './middleware/auth.js';
import type {
  CanvasState,
  CanvasElement,
  ServerToClientEvents,
  ClientToServerEvents,
  UserPresencePayload,
} from './types.js';

const app = express();
const httpServer = createServer(app);

const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:5173';
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'change-me-in-production';
const DATA_DIR = process.env.DATA_DIR ?? './data';

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync('/tmp/obs-uploads', { recursive: true });

// ---------------------------------------------------------------------------
// Session middleware (shared between Express and Socket.io)
// ---------------------------------------------------------------------------
const FileStoreSession = FileStore(session);

const sessionMiddleware = session({
  store: new FileStoreSession({
    path: `${DATA_DIR}/sessions`,
    ttl: 7 * 24 * 60 * 60,
    retries: 0,
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  },
});

app.use(sessionMiddleware);
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json());

// ---------------------------------------------------------------------------
// Socket.io
// ---------------------------------------------------------------------------
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: CLIENT_URL, methods: ['GET', 'POST'], credentials: true },
});

// Share Express session with Socket.io
io.engine.use(sessionMiddleware);

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------
const canvasState: CanvasState = { elements: [] };

// Active dashboard users: socketId → presence info
const activeUsers = new Map<string, UserPresencePayload & { socketId: string }>();

// ---------------------------------------------------------------------------
// File upload
// ---------------------------------------------------------------------------
const upload = multer({
  dest: '/tmp/obs-uploads',
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm',
      'audio/mpeg', 'audio/wav', 'audio/ogg',
    ];
    cb(null, allowed.includes(file.mimetype));
  },
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/ping', (_, res) => res.sendStatus(200));
app.use('/auth', authRouter);

// Inject io into whitelist router so it can kick revoked users
app.use('/whitelist', (req, _res, next) => {
  (req as any).io = io;
  (req as any).activeUsers = activeUsers;
  next();
}, whitelistRouter);

app.post('/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
  res.json({ url: `/files/${req.file.filename}`, mimetype: req.file.mimetype });
});

app.use('/files', express.static('/tmp/obs-uploads'));

// ---------------------------------------------------------------------------
// Socket.io auth middleware
// ---------------------------------------------------------------------------
io.use((socket, next) => {
  if (socket.handshake.query.mode === 'overlay') return next();
  const req = socket.request as express.Request;
  if (!req.session?.user) return next(new Error('Unauthorized'));
  next();
});

io.on('connection', (socket) => {
  const req = socket.request as express.Request;
  const user = req.session?.user;
  const isOverlay = socket.handshake.query.mode === 'overlay';

  console.log(`Connected: ${user?.login ?? 'overlay'} (${socket.id})`);

  // Send full canvas state on connect
  socket.emit('state:sync', canvasState);

  if (!isOverlay && user) {
    // Register presence
    const presence: UserPresencePayload = {
      userId: user.id,
      login: user.login,
      displayName: user.displayName,
      avatar: user.avatar,
      color: user.color ?? '#9146FF',
    };
    activeUsers.set(socket.id, { ...presence, socketId: socket.id });

    // Tell everyone about the new user, and send the joiner the full list
    socket.broadcast.emit('user:joined', presence);
    socket.emit('users:list', [...activeUsers.values()].map(({ socketId: _, ...u }) => u));

    socket.on('cursor:move', ({ x, y }) => {
      socket.broadcast.emit('cursor:move', { ...presence, x, y });
    });
  }

  socket.on('element:add', ({ element }) => {
    canvasState.elements.push(element);
    io.emit('element:added', { element });
  });

  socket.on('element:update', ({ id, changes }) => {
    const el = canvasState.elements.find((e) => e.id === id);
    if (el) {
      // null groupId means "clear group"
      if ('groupId' in changes && changes.groupId === null) {
        delete el.groupId;
      }
      Object.assign(el, changes);
    }
    io.emit('element:updated', { id, changes });
  });

  socket.on('element:remove', ({ id }) => {
    canvasState.elements = canvasState.elements.filter((e) => e.id !== id);
    io.emit('element:removed', { id });
  });

  socket.on('audio:trigger', (payload) => {
    io.emit('audio:play', payload);
  });

  socket.on('media:control', (payload) => {
    socket.broadcast.emit('media:control', payload);
  });

  socket.on('disconnect', () => {
    console.log(`Disconnected: ${user?.login ?? 'overlay'} (${socket.id})`);
    if (activeUsers.has(socket.id)) {
      activeUsers.delete(socket.id);
      io.emit('user:left', { userId: user!.id });
    }
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT ?? 3001);
httpServer.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

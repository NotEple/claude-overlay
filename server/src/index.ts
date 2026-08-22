import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { authRouter, getUserFromToken } from "./auth/routes.js";
import { whitelistRouter } from "./auth/whitelist.js";
import { canvasStore } from "./state/canvasStore.js";
import { registerSocketHandlers, type ActiveUser } from "./socket/handlers.js";
import { uploadRouter, UPLOAD_DIR } from "./uploads/routes.js";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from "./types.js";

const app = express();
const httpServer = createServer(app);

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

// ---------------------------------------------------------------------------
app.set("trust proxy", 1);
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json());

// ---------------------------------------------------------------------------
// Socket.io
// ---------------------------------------------------------------------------
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: CLIENT_URL, methods: ["GET", "POST"], credentials: true },
});

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------
// Active dashboard users: socketId → presence info
const activeUsers = new Map<string, ActiveUser>();
const activeOverlays = new Set<string>();

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get("/ping", (_, res) => res.sendStatus(200));
app.use("/auth", authRouter);

// Inject io into whitelist router so it can kick revoked users
app.use(
  "/whitelist",
  (req, _res, next) => {
    (req as any).io = io;
    (req as any).activeUsers = activeUsers;
    next();
  },
  whitelistRouter,
);

app.use("/upload", uploadRouter);
app.use("/files", express.static(UPLOAD_DIR));

// ---------------------------------------------------------------------------
// Socket.io auth middleware
// ---------------------------------------------------------------------------
io.use((socket, next) => {
  if (socket.handshake.query.mode === "overlay") return next();
  // Accept JWT from socket auth
  const token = socket.handshake.auth?.token as string | undefined;
  if (token) {
    const authorizedUser = getUserFromToken(token);
    if (authorizedUser) {
      (socket as any).jwtUser = authorizedUser;
      return next();
    }
  }
  next(new Error("Unauthorized"));
});

io.on("connection", (socket) =>
  registerSocketHandlers(io, socket, canvasStore, activeUsers, activeOverlays),
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT ?? 3001);
httpServer.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`),
);

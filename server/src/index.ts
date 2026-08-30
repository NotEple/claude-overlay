import express from "express";
import { randomUUID } from "crypto";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { authRouter, getUserFromToken } from "./auth/routes.js";
import { whitelistRouter } from "./auth/whitelist.js";
import { canvasStore } from "./state/canvasStore.js";
import { registerSocketHandlers, type ActiveUser } from "./socket/handlers.js";
import { setUploadedMediaHeaders, uploadRouter, UPLOAD_DIR } from "./uploads/routes.js";
import type {
  CanvasElement,
  ChatPermission,
  FlyDirection,
  TriggerPlacement,
  ServerToClientEvents,
  ClientToServerEvents,
} from "./types.js";
import { configureTwitchEvents } from "./twitch/eventsub.js";

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
const STREAM_W = 1920;
const STREAM_H = 1080;
const STREAM_OFFSET_X = 1040;
const STREAM_OFFSET_Y = 960;

interface PresentationRestore {
  changes: Partial<CanvasElement>;
  timer?: NodeJS.Timeout;
}

const presentationRestores = new Map<string, PresentationRestore>();

function restorePresentation(id: string) {
  const pending = presentationRestores.get(id);
  if (!pending) return;
  if (pending.timer) clearTimeout(pending.timer);
  presentationRestores.delete(id);
  const element = canvasStore.canvasState.elements.find((candidate) => candidate.id === id);
  if (!element) return;
  Object.assign(element, pending.changes);
  io.emit("element:updated", { id, changes: pending.changes });
}

function presentElement(
  element: CanvasElement,
  placement: TriggerPlacement = "current",
  emitUpdate = true,
) {
  let pending = presentationRestores.get(element.id);
  if (!pending) {
    pending = {
      changes: {
        visible: element.visible,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        rotation: element.rotation,
        dvdEnabled: element.dvdEnabled ?? false,
        autoVisibility: element.autoVisibility ?? false,
        flyStartedAt: 0,
        flyDurationMs: 0,
      },
    };
    presentationRestores.set(element.id, pending);
  } else if (pending.timer) {
    clearTimeout(pending.timer);
    delete pending.timer;
  }

  const changes: Partial<CanvasElement> = { visible: true, dvdEnabled: false };
  if (placement === "random") {
    const positions: TriggerPlacement[] = [
      "top-left", "top-center", "top-right",
      "center-left", "center", "center-right",
      "bottom-left", "bottom-center", "bottom-right",
    ];
    placement = positions[Math.floor(Math.random() * positions.length)];
  }
  if (placement === "fit" || placement === "fill") {
    const originalWidth = pending.changes.width ?? element.width;
    const originalHeight = pending.changes.height ?? element.height;
    const factor = placement === "fit"
      ? Math.min(STREAM_W / originalWidth, STREAM_H / originalHeight)
      : Math.max(STREAM_W / originalWidth, STREAM_H / originalHeight);
    changes.width = originalWidth * factor;
    changes.height = originalHeight * factor;
    changes.x = STREAM_OFFSET_X + (STREAM_W - changes.width) / 2;
    changes.y = STREAM_OFFSET_Y + (STREAM_H - changes.height) / 2;
    changes.rotation = 0;
  } else if (placement !== "current") {
    const width = pending.changes.width ?? element.width;
    const height = pending.changes.height ?? element.height;
    const horizontal = placement.endsWith("left") ? "left" : placement.endsWith("right") ? "right" : "center";
    const vertical = placement.startsWith("top") ? "top" : placement.startsWith("bottom") ? "bottom" : "center";
    const isCorner = horizontal !== "center" && vertical !== "center";
    const margin = isCorner ? 0 : 40;
    changes.x = horizontal === "left"
      ? STREAM_OFFSET_X + margin
      : horizontal === "right"
        ? STREAM_OFFSET_X + STREAM_W - width - margin
        : STREAM_OFFSET_X + (STREAM_W - width) / 2;
    changes.y = vertical === "top"
      ? STREAM_OFFSET_Y + margin
      : vertical === "bottom"
        ? STREAM_OFFSET_Y + STREAM_H - height - margin
        : STREAM_OFFSET_Y + (STREAM_H - height) / 2;
    changes.rotation = 0;
  }
  Object.assign(element, changes);
  if (emitUpdate) io.emit("element:updated", { id: element.id, changes });
  return pending;
}

function flyElement(
  element: CanvasElement,
  direction: FlyDirection = "left-to-right-bottom",
  durationSeconds = 5,
) {
  const pending = presentElement(element, "current", false);
  const width = pending?.changes.width ?? element.width;
  const height = pending?.changes.height ?? element.height;
  const [movement, lane] = direction.split(/-(?=top$|center$|bottom$|left$|right$)/) as [string, string];
  const horizontal = movement === "left-to-right" || movement === "right-to-left";
  const laneX = lane === "left"
    ? STREAM_OFFSET_X
    : lane === "right"
      ? STREAM_OFFSET_X + STREAM_W - width
      : STREAM_OFFSET_X + (STREAM_W - width) / 2;
  const laneY = lane === "top"
    ? STREAM_OFFSET_Y
    : lane === "bottom"
      ? STREAM_OFFSET_Y + STREAM_H - height
      : STREAM_OFFSET_Y + (STREAM_H - height) / 2;
  let fromX = laneX;
  let toX = laneX;
  let fromY = laneY;
  let toY = laneY;
  if (horizontal) {
    fromX = movement === "left-to-right" ? STREAM_OFFSET_X - width : STREAM_OFFSET_X + STREAM_W;
    toX = movement === "left-to-right" ? STREAM_OFFSET_X + STREAM_W : STREAM_OFFSET_X - width;
  } else {
    fromY = movement === "top-to-bottom" ? STREAM_OFFSET_Y - height : STREAM_OFFSET_Y + STREAM_H;
    toY = movement === "top-to-bottom" ? STREAM_OFFSET_Y + STREAM_H : STREAM_OFFSET_Y - height;
  }
  const durationMs = Math.max(1, durationSeconds) * 1000;
  const changes: Partial<CanvasElement> = {
    visible: true,
    dvdEnabled: false,
    rotation: 0,
    x: fromX,
    y: fromY,
    flyStartedAt: Date.now(),
    flyDurationMs: durationMs,
    flyFromX: fromX,
    flyFromY: fromY,
    flyToX: toX,
    flyToY: toY,
  };
  Object.assign(element, changes);
  io.emit("element:updated", { id: element.id, changes });
  if (element.type === "video") {
    io.emit("media:control", { id: element.id, action: "play", currentTime: 0 });
  }
  if (pending) {
    pending.timer = setTimeout(() => {
      if (element.type === "video") {
        io.emit("media:control", { id: element.id, action: "pause", currentTime: 0 });
      }
      restorePresentation(element.id);
    }, durationMs);
  }
}

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
app.use("/files", setUploadedMediaHeaders, express.static(UPLOAD_DIR));

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
  registerSocketHandlers(io, socket, canvasStore, activeUsers, activeOverlays, restorePresentation),
);

const triggerCooldowns = new Map<string, number>();
configureTwitchEvents((eventType, event) => {
  const now = Date.now();
  for (const trigger of canvasStore.triggers) {
    if (!trigger.enabled || trigger.event !== eventType) continue;
    if ((triggerCooldowns.get(trigger.id) ?? 0) > now) continue;
    const message = String(event.message?.text ?? '').trim().split(/\s+/)[0]?.toLowerCase();
    const reward = String(event.reward?.title ?? '').toLowerCase();
    if (eventType === 'chat-command' && trigger.match?.toLowerCase() !== message) continue;
    if (eventType === 'chat-command') {
      const roleRank: Record<ChatPermission, number> = { everyone: 0, vip: 1, moderator: 2, streamer: 3 };
      const required = trigger.permission ?? 'everyone';
      const chatter = event.chatter_role ?? 'everyone';
      if (roleRank[chatter] < roleRank[required]) continue;
    }
    if (eventType === 'channel-points' && trigger.match && trigger.match.toLowerCase() !== reward) continue;
    if (eventType === 'bits' && Number(event.bits ?? 0) < (trigger.minimum ?? 0)) continue;
    triggerCooldowns.set(trigger.id, now + trigger.cooldownSeconds * 1000);
    canvasStore.activity.unshift({ id: randomUUID(), at: new Date().toISOString(), user: 'Twitch', action: `ran trigger “${trigger.name}”` });
    canvasStore.activity = canvasStore.activity.slice(0, 50);
    io.to('dashboard').emit('studio:sync', { scenes: canvasStore.scenes, presets: canvasStore.presets, sounds: canvasStore.sounds, triggers: canvasStore.triggers, activity: canvasStore.activity, twitchConnected: canvasStore.twitchConnected });
    const element = canvasStore.canvasState.elements.find(item => item.id === trigger.targetId);
    if (trigger.action === 'refresh-overlay') { io.emit('overlay:refresh'); continue; }
    if (trigger.action === 'play-sound') { const sound = canvasStore.sounds.find(item => item.id === trigger.targetId); if (sound) io.to('overlay').emit('sound:play', sound); continue; }
    if (!element) continue;
    if (trigger.action === 'play-media') {
      if (element.type !== 'video') continue;
      presentElement(element, trigger.placement);
      element.autoVisibility = true;
      io.emit('element:updated', { id: element.id, changes: { autoVisibility: true } });
      io.emit('media:control', { id: element.id, action: 'play', currentTime: 0 });
      continue;
    }
    if (trigger.action === 'fly-across') {
      if (!['image', 'gif', 'video'].includes(element.type)) continue;
      flyElement(element, trigger.flyDirection, trigger.durationSeconds ?? 5);
      continue;
    }
    if (trigger.action === 'show-temporary') {
      if (!['image', 'gif'].includes(element.type)) continue;
      const pending = presentElement(element, trigger.placement);
      if (pending) pending.timer = setTimeout(() => restorePresentation(element.id), (trigger.durationSeconds ?? 5) * 1000);
      continue;
    }
    const changes: Partial<CanvasElement> = {};
    if (trigger.action === 'show-element') changes.visible = true;
    if (trigger.action === 'hide-element') changes.visible = false;
    if (trigger.action === 'toggle-element') changes.visible = !element.visible;
    if (trigger.action === 'enable-dvd') Object.assign(changes, { dvdEnabled: true, dvdStartedAt: Date.now(), dvdStartX: element.x, dvdStartY: element.y, dvdVelocityX: 120 + Math.random() * 100, dvdVelocityY: (Math.random() > .5 ? 1 : -1) * (120 + Math.random() * 100) });
    Object.assign(element, changes);
    io.emit('element:updated', { id: element.id, changes });
  }
}, connected => {
  canvasStore.twitchConnected = connected;
  io.to('dashboard').emit('studio:sync', { scenes: canvasStore.scenes, presets: canvasStore.presets, sounds: canvasStore.sounds, triggers: canvasStore.triggers, activity: canvasStore.activity, twitchConnected: connected });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT ?? 3001);
httpServer.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`),
);

import type { Server, Socket } from "socket.io";
import type { AuthUser } from "../auth/routes.js";
import type { CanvasStore } from "../state/canvasStore.js";
import type {
  ClientToServerEvents,
  LiveDrawStroke,
  ServerToClientEvents,
  UserPresencePayload,
} from "../types.js";
import { validElement, validElementUpdate, validMediaControl, validStroke } from "./validation.js";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
export type ActiveUser = UserPresencePayload & { socketId: string };

const MAX_ELEMENTS = 1_000;
const MAX_STROKES = 10_000;

export function registerSocketHandlers(
  io: AppServer,
  socket: AppSocket,
  store: CanvasStore,
  activeUsers: Map<string, ActiveUser>,
  activeOverlays: Set<string>,
) {
  const user = (socket as any).jwtUser as AuthUser | undefined;
  const isOverlay = socket.handshake.query.mode === "overlay";
  socket.join(isOverlay ? "overlay" : "dashboard");
  const { canvasState, drawStrokes } = store;

  console.log(`Connected: ${user?.login ?? "overlay"} (${socket.id})`);
  socket.emit("state:sync", canvasState);
  socket.emit("draw:sync", drawStrokes);
  socket.emit("dvd:settings", store.dvdCelebrationSettings);
  if (isOverlay) activeOverlays.add(socket.id);
  io.emit("overlay:status", {
    connected: activeOverlays.size > 0,
    count: activeOverlays.size,
  });

  socket.on("disconnect", () => {
    console.log(`Disconnected: ${user?.login ?? "overlay"} (${socket.id})`);
    if (activeOverlays.delete(socket.id)) {
      io.emit("overlay:status", {
        connected: activeOverlays.size > 0,
        count: activeOverlays.size,
      });
    }
    if (!user || !activeUsers.delete(socket.id)) return;
    const stillConnected = [...activeUsers.values()].some((active) => active.userId === user.id);
    if (!stillConnected) io.emit("user:left", { userId: user.id });
  });

  if (!isOverlay && user) registerPresence(socket, user, activeUsers);

  // Public OBS renderers receive state, but never get mutation listeners.
  if (isOverlay || !user) return;

  socket.on("element:add", ({ element }) => {
    if (!validElement(element) || canvasState.elements.length >= MAX_ELEMENTS) return;
    if (canvasState.elements.some((existing) => existing.id === element.id)) return;
    canvasState.elements.push(element);
    io.emit("element:added", { element });
  });

  socket.on("element:update", ({ id, changes }) => {
    if (typeof id !== "string" || id.length > 100 || !validElementUpdate(changes)) return;
    const element = canvasState.elements.find((candidate) => candidate.id === id);
    if (!element) return;
    if ("groupId" in changes && changes.groupId === null) delete element.groupId;
    Object.assign(element, changes);
    io.emit("element:updated", { id, changes });
  });

  socket.on("element:remove", ({ id }) => {
    if (typeof id !== "string" || id.length > 100) return;
    canvasState.elements = canvasState.elements.filter((element) => element.id !== id);
    io.emit("element:removed", { id });
  });

  socket.on("media:control", (payload) => {
    if (validMediaControl(payload)) socket.broadcast.emit("media:control", payload);
  });
  socket.on("overlay:refresh", () => io.emit("overlay:refresh"));
  socket.on("dvd:settings", (settings) => {
    if (
      !Number.isFinite(settings.volume) ||
      settings.volume < 0 ||
      settings.volume > 1 ||
      ![
        "top-left",
        "top-center",
        "top-right",
        "bottom-left",
        "bottom-center",
        "bottom-right",
      ].includes(settings.counterPosition) ||
      !(
        settings.soundUrl === null ||
        (typeof settings.soundUrl === "string" && settings.soundUrl.length <= 2048)
      )
    ) return;
    store.dvdCelebrationSettings = {
      volume: settings.volume,
      soundUrl: settings.soundUrl,
      counterPosition: settings.counterPosition,
    };
    io.emit("dvd:settings", store.dvdCelebrationSettings);
  });

  socket.on("draw:stroke", (stroke) => {
    if (!validStroke(stroke) || drawStrokes.length >= MAX_STROKES) return;
    if (drawStrokes.some((existing) => existing.id === stroke.id)) return;
    drawStrokes.push(stroke);
    socket.broadcast.emit("draw:stroke", stroke);
  });
  socket.on("draw:clear", () => {
    drawStrokes.length = 0;
    socket.broadcast.emit("draw:clear");
  });
  socket.on("draw:live", (data) => {
    if (!validLiveStroke(data)) return;
    socket.volatile.broadcast.emit("draw:live", { ...data, userId: user.id } as LiveDrawStroke);
  });
}

function registerPresence(socket: AppSocket, user: AuthUser, activeUsers: Map<string, ActiveUser>) {
  const presence: UserPresencePayload = {
    userId: user.id,
    login: user.login,
    displayName: user.displayName,
    avatar: user.avatar,
    color: user.color,
  };
  activeUsers.set(socket.id, { ...presence, socketId: socket.id });

  const seen = new Set<string>();
  const uniqueUsers = [...activeUsers.values()]
    .filter(({ userId }) => !seen.has(userId) && !!seen.add(userId))
    .map(({ socketId: _, ...active }) => active);
  const tabCount = [...activeUsers.values()].filter((active) => active.userId === user.id).length;
  if (tabCount === 1) socket.broadcast.emit("user:joined", presence);
  socket.emit("users:list", uniqueUsers);

  socket.on("cursor:move", ({ x, y, showOnOverlay }) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const payload = { ...presence, x, y };
    socket.to("dashboard").volatile.emit("cursor:move", payload);
    if (showOnOverlay === true) socket.to("overlay").volatile.emit("cursor:move", payload);
  });
}

function validLiveStroke(data: Omit<LiveDrawStroke, "userId">): boolean {
  return Array.isArray(data.points) && data.points.length <= 20_000
    && data.points.every((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))
    && typeof data.color === "string" && data.color.length <= 32
    && Number.isFinite(data.size) && data.size >= 0 && data.size <= 200
    && typeof data.eraser === "boolean";
}

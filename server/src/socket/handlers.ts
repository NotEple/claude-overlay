import type { Server, Socket } from "socket.io";
import { randomUUID } from "crypto";
import type { AuthUser } from "../auth/routes.js";
import { saveChatEmoteSettings, saveStudioData } from "../db/index.js";
import type { CanvasStore } from "../state/canvasStore.js";
import type {
  ClientToServerEvents,
  LiveDrawStroke,
  ServerToClientEvents,
  UserPresencePayload,
} from "../types.js";
import { validElement, validElementUpdate, validMediaControl, validStroke } from "./validation.js";
import { getTwitchChatChannel, setTwitchChatChannel } from "../twitch/eventsub.js";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
export type ActiveUser = UserPresencePayload & { socketId: string };

const MAX_ELEMENTS = 1_000;
const MAX_STROKES = 10_000;
const HISTORY_LIMIT = 30;
let chatEmoteSettingsSaveTimer: NodeJS.Timeout | undefined;

const clone = <T>(value: T): T => structuredClone(value);
function studioState(store: CanvasStore) {
  return { scenes: store.scenes, presets: store.presets, sounds: store.sounds, triggers: store.triggers, activity: store.activity, twitchConnected: store.twitchConnected };
}
function historyStatus(store: CanvasStore) { return { canUndo: store.undoStack.length > 0, canRedo: store.redoStack.length > 0 }; }
function checkpoint(store: CanvasStore) {
  store.undoStack.push({ elements: clone(store.canvasState.elements), strokes: clone(store.drawStrokes) });
  if (store.undoStack.length > HISTORY_LIMIT) store.undoStack.shift();
  store.redoStack.length = 0;
}

export function registerSocketHandlers(
  io: AppServer,
  socket: AppSocket,
  store: CanvasStore,
  activeUsers: Map<string, ActiveUser>,
  activeOverlays: Set<string>,
  onMediaEnded?: (id: string) => void,
  onSoundEnded?: (playbackId: string) => void,
) {
  const user = socket.data.jwtUser as AuthUser | undefined;
  const isOverlay = socket.handshake.query.mode === "overlay";
  socket.join(isOverlay ? "overlay" : "dashboard");
  const { canvasState, drawStrokes } = store;

  console.log(`Connected: ${user?.login ?? "overlay"} (${socket.id})`);
  socket.emit("state:sync", canvasState);
  socket.emit("draw:sync", drawStrokes);
  socket.emit("dvd:settings", store.dvdCelebrationSettings);
  socket.emit("chat-emote:settings", store.chatEmoteSettings);
  if (!isOverlay) socket.emit("chat:channel", { channel: getTwitchChatChannel() });
  if (!isOverlay && user) {
    socket.emit("studio:sync", studioState(store));
    socket.emit("history:status", historyStatus(store));
  }
  if (isOverlay) activeOverlays.add(socket.id);
  io.emit("overlay:status", {
    connected: activeOverlays.size > 0,
    count: activeOverlays.size,
  });

  if (isOverlay) {
    socket.on("media:ended", ({ id }) => {
      if (typeof id !== "string" || id.length > 100) return;
      const element = canvasState.elements.find((candidate) => candidate.id === id);
      if (!element || !["video", "audio"].includes(element.type) || !element.autoVisibility) return;
      onMediaEnded?.(id);
    });
    socket.on("sound:ended", ({ playbackId }) => {
      if (typeof playbackId !== "string" || playbackId.length > 100) return;
      onSoundEnded?.(playbackId);
    });
  }

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

  let lastCheckpointKey = "";
  let lastCheckpointAt = 0;
  const log = (action: string) => {
    store.activity.unshift({ id: randomUUID(), at: new Date().toISOString(), user: user.displayName, action });
    store.activity = store.activity.slice(0, 50);
    io.to("dashboard").emit("studio:sync", studioState(store));
  };
  const record = (key: string, action: string) => {
    const now = Date.now();
    const isNewAction = key !== lastCheckpointKey || now - lastCheckpointAt > 750;
    if (isNewAction) checkpoint(store);
    lastCheckpointKey = key;
    lastCheckpointAt = now;
    if (isNewAction) {
      log(action);
      io.to("dashboard").emit("history:status", historyStatus(store));
    }
  };

  socket.on("element:add", ({ element }) => {
    if (!validElement(element) || canvasState.elements.length >= MAX_ELEMENTS) return;
    if (canvasState.elements.some((existing) => existing.id === element.id)) return;
    record(`add:${element.id}`, `added ${element.type}`);
    canvasState.elements.push(element);
    io.emit("element:added", { element });
  });

  socket.on("element:update", ({ id, changes }) => {
    if (typeof id !== "string" || id.length > 100 || !validElementUpdate(changes)) return;
    const element = canvasState.elements.find((candidate) => candidate.id === id);
    if (!element) return;
    if (element.locked && Object.keys(changes).some((key) => ["x", "y", "width", "height", "rotation", "scaleX", "scaleY", "dvdEnabled", "dvdStartedAt", "dvdStartX", "dvdStartY", "dvdVelocityX", "dvdVelocityY"].includes(key))) return;
    const normalizedChanges = {
      ...changes,
      ...(changes.flyStartedAt ? { flyStartedAt: Date.now() } : {}),
      ...(changes.effectStartedAt ? { effectStartedAt: Date.now() } : {}),
    };
    const changeKeys = Object.keys(changes);
    const affectedGroupId = typeof changes.groupId === "string"
      ? changes.groupId
      : element.groupId;
    const transformKeys = new Set(["x", "y", "width", "height", "rotation", "scaleX", "scaleY"]);
    const isGroupTransform = !!affectedGroupId && changeKeys.length > 0 && changeKeys.every((key) => transformKeys.has(key));
    record(
      isGroupTransform ? `update-group:${affectedGroupId}` : `update:${id}`,
      isGroupTransform
        ? `${changeKeys.every((key) => key === "x" || key === "y") ? "moved" : "transformed"} ${element.groupName ?? "group"}`
        : `updated ${element.type}`,
    );
    if ("groupId" in changes && changes.groupId === null) {
      delete element.groupId;
      delete element.groupName;
    }
    Object.assign(element, normalizedChanges);
    io.emit("element:updated", { id, changes: normalizedChanges });
  });

  socket.on("element:remove", ({ id }) => {
    if (typeof id !== "string" || id.length > 100) return;
    const element = canvasState.elements.find((candidate) => candidate.id === id);
    if (!element || element.locked) return;
    record(`remove:${id}`, `deleted ${element.type}`);
    canvasState.elements = canvasState.elements.filter((element) => element.id !== id);
    io.emit("element:removed", { id });
    if (element.groupId) {
      const remaining = canvasState.elements.filter(
        (candidate) => candidate.groupId === element.groupId,
      );
      if (remaining.length === 1) {
        delete remaining[0].groupId;
        delete remaining[0].groupName;
        io.emit("element:updated", {
          id: remaining[0].id,
          changes: { groupId: null },
        });
      }
    }
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
    checkpoint(store);
    record(`stroke:${stroke.id}`, "added a drawing stroke");
    drawStrokes.push(stroke);
    socket.broadcast.emit("draw:stroke", stroke);
    io.to("dashboard").emit("history:status", historyStatus(store));
  });
  socket.on("draw:clear", () => {
    if (!drawStrokes.length) return;
    checkpoint(store);
    record("draw:clear", "cleared the drawing");
    drawStrokes.length = 0;
    socket.broadcast.emit("draw:clear");
    io.to("dashboard").emit("history:status", historyStatus(store));
  });
  socket.on("draw:live", (data) => {
    if (!validLiveStroke(data)) return;
    socket.volatile.broadcast.emit("draw:live", { ...data, userId: user.id } as LiveDrawStroke);
  });
  socket.on("chat-emote:settings", (settings) => {
    if (
      typeof settings.enabled !== "boolean" ||
      typeof settings.showNames !== "boolean" ||
      typeof settings.nameBackgroundEnabled !== "boolean" ||
      typeof settings.nameBackgroundColor !== "string" || !/^#[0-9a-f]{6}$/i.test(settings.nameBackgroundColor) ||
      !Number.isFinite(settings.nameFontSize) || settings.nameFontSize < 9 || settings.nameFontSize > 32 ||
      !["walls", "floor", "parade", "corners"].includes(settings.motion) ||
      !["left", "right"].includes(settings.direction) ||
      !Number.isFinite(settings.gravity) || settings.gravity < 100 || settings.gravity > 2400 ||
      !Number.isFinite(settings.size) || settings.size < 24 || settings.size > 100 ||
      !Number.isFinite(settings.speed) || settings.speed < 40 || settings.speed > 600 ||
      !Number.isFinite(settings.lifetimeSeconds) || settings.lifetimeSeconds < 2 || settings.lifetimeSeconds > 120 ||
      !Number.isInteger(settings.maxVisible) || settings.maxVisible < 1 || settings.maxVisible > 100 ||
      !Array.isArray(settings.blacklist) || settings.blacklist.length > 100 ||
      settings.blacklist.some((name) => typeof name !== "string" || !/^[a-z0-9_]{1,25}$/i.test(name)) ||
      !Array.isArray(settings.additionalEmotes) || settings.additionalEmotes.length > 100 ||
      settings.additionalEmotes.some((name) => typeof name !== "string" || !/^[a-z0-9_]{1,64}$/i.test(name))
    ) return;
    store.chatEmoteSettings = { ...settings };
    io.emit("chat-emote:settings", store.chatEmoteSettings);
    if (chatEmoteSettingsSaveTimer) clearTimeout(chatEmoteSettingsSaveTimer);
    chatEmoteSettingsSaveTimer = setTimeout(() => {
      void saveChatEmoteSettings(store.chatEmoteSettings);
    }, 300);
  });

  socket.on("history:undo", () => {
    const previous = store.undoStack.pop();
    if (!previous) return;
    lastCheckpointKey = "";
    store.redoStack.push({ elements: clone(canvasState.elements), strokes: clone(drawStrokes) });
    canvasState.elements = clone(previous.elements);
    drawStrokes.splice(0, drawStrokes.length, ...clone(previous.strokes));
    io.emit("state:sync", canvasState);
    io.emit("draw:sync", drawStrokes);
    io.to("dashboard").emit("history:status", historyStatus(store));
  });
  socket.on("history:redo", () => {
    const next = store.redoStack.pop();
    if (!next) return;
    lastCheckpointKey = "";
    store.undoStack.push({ elements: clone(canvasState.elements), strokes: clone(drawStrokes) });
    canvasState.elements = clone(next.elements);
    drawStrokes.splice(0, drawStrokes.length, ...clone(next.strokes));
    io.emit("state:sync", canvasState);
    io.emit("draw:sync", drawStrokes);
    io.to("dashboard").emit("history:status", historyStatus(store));
  });

  const syncStudio = () => io.to("dashboard").emit("studio:sync", studioState(store));
  socket.on("chat:channel:set", async ({ channel }) => {
    if (typeof channel !== "string" || channel.length > 50) return;
    const previous = getTwitchChatChannel();
    if (!await setTwitchChatChannel(channel)) return;
    const current = getTwitchChatChannel();
    io.to("dashboard").emit("chat:channel", { channel: current });
    if (current !== previous) log(`switched Twitch chat to ${current}`);
  });
  socket.on("scene:save", async ({ id, name }) => {
    if (!validLabel(id, 100) || !validLabel(name, 60)) return;
    const scene = { id, name: name.trim(), elements: clone(canvasState.elements), strokes: clone(drawStrokes), updatedAt: new Date().toISOString() };
    store.scenes = [...store.scenes.filter((item) => item.id !== id), scene].slice(-50);
    await saveStudioData({ scenes: store.scenes }); log(`saved scene “${scene.name}”`);
  });
  socket.on("scene:load", ({ id }) => {
    const scene = store.scenes.find((item) => item.id === id); if (!scene) return;
    checkpoint(store); canvasState.elements = clone(scene.elements); drawStrokes.splice(0, drawStrokes.length, ...clone(scene.strokes)); log(`loaded scene “${scene.name}”`);
    io.emit("state:sync", canvasState); io.emit("draw:sync", drawStrokes); io.to("dashboard").emit("history:status", historyStatus(store));
  });
  socket.on("scene:delete", async ({ id }) => { const item = store.scenes.find(scene => scene.id === id); store.scenes = store.scenes.filter((scene) => scene.id !== id); await saveStudioData({ scenes: store.scenes }); if (item) log(`deleted scene “${item.name}”`); else syncStudio(); });
  socket.on("preset:save", async ({ id, name, elementIds }) => {
    if (!validLabel(id, 100) || !validLabel(name, 60) || !Array.isArray(elementIds) || elementIds.length > 100) return;
    const elements = canvasState.elements.filter((element) => elementIds.includes(element.id)); if (!elements.length) return;
    store.presets = [...store.presets.filter((item) => item.id !== id), { id, name: name.trim(), elements: clone(elements), createdAt: new Date().toISOString() }].slice(-100);
    await saveStudioData({ presets: store.presets }); log(`saved preset “${name.trim()}”`);
  });
  socket.on("preset:load", ({ id }) => {
    const preset = store.presets.find((item) => item.id === id); if (!preset) return;
    checkpoint(store); log(`inserted preset “${preset.name}”`); const groups = new Map<string, string>();
    const copies = preset.elements.map((element) => ({ ...clone(element), id: randomUUID(), x: element.x + 32, y: element.y + 32, groupId: element.groupId ? (groups.get(element.groupId) ?? (() => { const value = randomUUID(); groups.set(element.groupId!, value); return value; })()) : undefined }));
    canvasState.elements.push(...copies); copies.forEach((element) => io.emit("element:added", { element })); io.to("dashboard").emit("history:status", historyStatus(store));
  });
  socket.on("preset:delete", async ({ id }) => { store.presets = store.presets.filter((item) => item.id !== id); await saveStudioData({ presets: store.presets }); syncStudio(); });
  socket.on("sound:save", async (item) => {
    if (!validLabel(item?.id, 100) || !validLabel(item?.name, 60) || !validSoundUrl(item?.url) || !Number.isFinite(item.volume) || item.volume < 0 || item.volume > 1) return;
    store.sounds = [...store.sounds.filter((sound) => sound.id !== item.id), item].slice(-100); await saveStudioData({ sounds: store.sounds }); syncStudio();
  });
  socket.on("sound:delete", async ({ id }) => { store.sounds = store.sounds.filter((item) => item.id !== id); await saveStudioData({ sounds: store.sounds }); syncStudio(); });
  socket.on("sound:play", ({ id }) => { const item = store.sounds.find((sound) => sound.id === id); if (item) io.to("overlay").emit("sound:play", item); });
  socket.on("trigger:save", async (trigger) => {
    if (!validTrigger(trigger)) return; store.triggers = [...store.triggers.filter((item) => item.id !== trigger.id), trigger].slice(-100); await saveStudioData({ triggers: store.triggers }); syncStudio();
  });
  socket.on("trigger:delete", async ({ id }) => { store.triggers = store.triggers.filter((item) => item.id !== id); await saveStudioData({ triggers: store.triggers }); syncStudio(); });
}

function validLabel(value: unknown, max: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function validUrl(value: unknown): value is string { if (typeof value !== "string" || value.length > 2048) return false; try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol); } catch { return false; } }
function validSoundUrl(value: unknown): value is string {
  if (!validUrl(value)) return false;
  const url = new URL(value);
  const serverOrigin = new URL(process.env.PUBLIC_SERVER_URL ?? "http://localhost:3001").origin;
  const uploadedHere = url.origin === serverOrigin && url.pathname.startsWith("/files/");
  const myInstants = url.protocol === "https:" && url.hostname === "www.myinstants.com" && /^\/media\/sounds\/[a-zA-Z0-9_.%-]+\.mp3$/i.test(url.pathname);
  return uploadedHere || myInstants;
}
const triggerActions = ["show-element", "show-temporary", "fly-across", "hide-element", "toggle-element", "play-media", "play-sound", "enable-dvd", "refresh-overlay", "send-chat"];
const triggerPlacements = ["current", "random", "fit", "fill", "top-left", "top-center", "top-right", "center-left", "center", "center-right", "bottom-left", "bottom-center", "bottom-right"];
const flyDirections = ["left-to-right-top", "left-to-right-center", "left-to-right-bottom", "right-to-left-top", "right-to-left-center", "right-to-left-bottom", "top-to-bottom-left", "top-to-bottom-center", "top-to-bottom-right", "bottom-to-top-left", "bottom-to-top-center", "bottom-to-top-right"];
function validTriggerStep(value: any): boolean {
  const allowed = new Set(["action", "targetId", "placement", "durationSeconds", "flyDirection", "timing", "delaySeconds", "chatMessage"]);
  return value && typeof value === "object" && Object.keys(value).every(key => allowed.has(key))
    && triggerActions.includes(value.action)
    && (value.placement === undefined || triggerPlacements.includes(value.placement))
    && (value.durationSeconds === undefined || (Number.isFinite(value.durationSeconds) && value.durationSeconds >= 1 && value.durationSeconds <= 3600))
    && (value.flyDirection === undefined || flyDirections.includes(value.flyDirection))
    && (value.timing === undefined || ["immediate", "delay", "after-previous"].includes(value.timing))
    && (value.delaySeconds === undefined || (Number.isFinite(value.delaySeconds) && value.delaySeconds >= 0 && value.delaySeconds <= 3600))
    && (value.chatMessage === undefined || (typeof value.chatMessage === "string" && value.chatMessage.trim().length > 0 && value.chatMessage.length <= 500))
    && (["refresh-overlay", "send-chat"].includes(value.action) ? value.targetId === undefined : validLabel(value.targetId, 100));
}
function validTrigger(value: any): boolean {
  const allowed = new Set(["id", "name", "enabled", "event", "match", "minimum", "channel", "action", "targetId", "cooldownSeconds", "placement", "durationSeconds", "flyDirection", "timing", "delaySeconds", "chatMessage", "permission", "steps"]);
  return value && typeof value === "object" && Object.keys(value).every(key => allowed.has(key))
    && validLabel(value.id, 100) && validLabel(value.name, 60)
    && ["chat-command", "follow", "subscribe", "gift-subscribe", "raid", "bits", "channel-points", "ban", "timeout"].includes(value.event)
    && validTriggerStep({ action: value.action, targetId: value.targetId, placement: value.placement, durationSeconds: value.durationSeconds, flyDirection: value.flyDirection, timing: value.timing, delaySeconds: value.delaySeconds, chatMessage: value.chatMessage })
    && typeof value.enabled === "boolean" && Number.isFinite(value.cooldownSeconds) && value.cooldownSeconds >= 0 && value.cooldownSeconds <= 86400
    && (value.match === undefined || (typeof value.match === "string" && value.match.length <= 100))
    && (value.minimum === undefined || (Number.isFinite(value.minimum) && value.minimum >= 0 && value.minimum <= 10_000_000))
    && (value.channel === undefined || (typeof value.channel === "string" && /^[a-z0-9_]{3,25}$/.test(value.channel)))
    && (value.permission === undefined || ["everyone", "vip", "moderator", "streamer"].includes(value.permission))
    && (value.steps === undefined || (Array.isArray(value.steps) && value.steps.length >= 2 && value.steps.length <= 10 && value.steps.every(validTriggerStep)));
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
    && typeof data.eraser === "boolean"
    && (data.tool === undefined || ["pen", "eraser", "line", "arrow", "rectangle", "ellipse"].includes(data.tool))
    && (data.opacity === undefined || (Number.isFinite(data.opacity) && data.opacity >= 0.05 && data.opacity <= 1));
}

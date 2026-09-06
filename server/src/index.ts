import express from "express";
import { randomUUID } from "crypto";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { authRouter, getUserFromToken } from "./auth/routes.js";
import { createWhitelistRouter } from "./auth/whitelist.js";
import { canvasStore } from "./state/canvasStore.js";
import { registerSocketHandlers, type ActiveUser } from "./socket/handlers.js";
import { setUploadedMediaHeaders, uploadRouter, UPLOAD_DIR } from "./uploads/routes.js";
import type {
  CanvasElement,
  ChatPermission,
  FlyDirection,
  TriggerStep,
  TriggerPlacement,
  ServerToClientEvents,
  ClientToServerEvents,
} from "./types.js";
import { configureTwitchEvents, emitTwitchEvent } from "./twitch/eventsub.js";
import { getValidEventAuth, initializeEventAuthStore } from "./twitch/eventAuthStore.js";
import { twitchClientId } from "./auth/twitch.js";
import { CHATBOT_AUTH_KEY, createEventRoutes } from "./twitch/eventRoutes.js";
import { createEventWebhook } from "./twitch/eventWebhook.js";
import { resolveSevenTvEmotes } from "./seventv/emotes.js";
import { initializeChatEmoteSettingsStore, initializeWhitelistStore } from "./db/index.js";
import { myinstantsRouter } from "./uploads/myinstants.js";

const app = express();
const httpServer = createServer(app);

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

// ---------------------------------------------------------------------------
app.set("trust proxy", 1);
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use("/twitch/eventsub", express.raw({ type: "application/json", limit: "256kb" }), createEventWebhook(emitTwitchEvent));
app.use(express.json());
await initializeEventAuthStore().catch((error) =>
  console.error("Event database initialization failed", error),
);
await initializeWhitelistStore().catch((error) => {
  console.error("Whitelist database initialization failed", error);
  if (process.env.NODE_ENV === "production") throw error;
});
const storedChatEmoteSettings = await initializeChatEmoteSettingsStore().catch((error) => {
  console.error("Could not initialize persistent chat-emote settings", error);
  return undefined;
});
if (storedChatEmoteSettings) {
  canvasStore.chatEmoteSettings = {
    ...canvasStore.chatEmoteSettings,
    ...storedChatEmoteSettings,
    blacklist: Array.isArray(storedChatEmoteSettings.blacklist) ? storedChatEmoteSettings.blacklist : [],
    additionalEmotes: Array.isArray(storedChatEmoteSettings.additionalEmotes) ? storedChatEmoteSettings.additionalEmotes : [],
  };
}
app.use(createEventRoutes(emitTwitchEvent));

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
const mediaCompletionWaiters = new Map<string, Set<() => void>>();
const soundCompletionWaiters = new Map<string, () => void>();
const chatEmoteSenderCooldowns = new Map<string, number>();

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function waitForMediaEnd(id: string) {
  return new Promise<void>((resolve) => {
    const waiters = mediaCompletionWaiters.get(id) ?? new Set();
    const finish = () => {
      clearTimeout(fallback);
      resolve();
    };
    const fallback = setTimeout(finish, 60 * 60 * 1000);
    waiters.add(finish);
    mediaCompletionWaiters.set(id, waiters);
  });
}

function finishMedia(id: string) {
  mediaCompletionWaiters.get(id)?.forEach((resolve) => resolve());
  mediaCompletionWaiters.delete(id);
  restorePresentation(id);
}

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
    const width = pending.changes.width ?? element.width;
    const height = pending.changes.height ?? element.height;
    changes.x = STREAM_OFFSET_X + Math.random() * Math.max(0, STREAM_W - width);
    changes.y = STREAM_OFFSET_Y + Math.random() * Math.max(0, STREAM_H - height);
    changes.rotation = 0;
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
  } else if (placement !== "current" && placement !== "random") {
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

type TriggerEventPayload = Record<string, any>;

function renderEventMessage(template: string, event: TriggerEventPayload) {
  const values: Record<string, string> = {
    user: String(event.user_name ?? event.chatter_user_name ?? event.from_broadcaster_user_name ?? "Viewer"),
    months: String(event.cumulative_months ?? event.duration_months ?? 0),
    viewers: String(event.viewers ?? 0),
    bits: String(event.bits ?? 0),
    reward: String(event.reward?.title ?? event.reward_title ?? ""),
    channel: String(event.channel ?? event.broadcaster_user_login ?? ""),
  };
  return template.replace(/\{(user|months|viewers|bits|reward|channel)\}/gi, (_, key: string) => values[key.toLowerCase()] ?? "").slice(0, 500);
}

async function sendEventChatMessage(step: TriggerStep, event: TriggerEventPayload) {
  const channel = String(event.channel ?? event.broadcaster_user_login ?? "").toLowerCase();
  const broadcasterAuth = channel ? await getValidEventAuth(channel) : null;
  const chatbotAuth = await getValidEventAuth(CHATBOT_AUTH_KEY);
  if (!broadcasterAuth) throw new Error(`No Twitch Events connection for ${channel || "this channel"}`);
  if (!chatbotAuth) throw new Error("The chatbot is not connected");
  if (!step.chatMessage) throw new Error("The chat message is empty");
  if (!chatbotAuth.scopes.includes("user:write:chat")) throw new Error(`${chatbotAuth.displayName} must reconnect to grant chat-message permission`);
  const response = await fetch("https://api.twitch.tv/helix/chat/messages", {
    method: "POST",
    headers: { "Client-Id": twitchClientId, Authorization: `Bearer ${chatbotAuth.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ broadcaster_id: broadcasterAuth.twitchUserId, sender_id: chatbotAuth.twitchUserId, message: renderEventMessage(step.chatMessage, event) }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Twitch chat message failed (${response.status}): ${detail.slice(0, 300)}`);
  }
}

function executeTriggerStep(step: TriggerStep, event: TriggerEventPayload): Promise<void> {
  if (step.action === 'refresh-overlay') { io.emit('overlay:refresh'); return Promise.resolve(); }
  if (step.action === 'send-chat') return sendEventChatMessage(step, event);
  if (step.action === 'play-sound') {
    const sound = canvasStore.sounds.find(item => item.id === step.targetId);
    if (!sound) return Promise.resolve();
    const playbackId = randomUUID();
    io.to('overlay').emit('sound:play', { ...sound, playbackId });
    return new Promise<void>((resolve) => {
      const fallback = setTimeout(() => {
        soundCompletionWaiters.delete(playbackId);
        resolve();
      }, 10 * 60 * 1000);
      soundCompletionWaiters.set(playbackId, () => {
        clearTimeout(fallback);
        resolve();
      });
    });
  }
  const element = canvasStore.canvasState.elements.find(item => item.id === step.targetId);
  if (!element) return Promise.resolve();
  if (step.action === 'play-media') {
    if (element.type !== 'video' && element.type !== 'audio') return Promise.resolve();
    presentElement(element, step.placement);
    element.autoVisibility = true;
    io.emit('element:updated', { id: element.id, changes: { autoVisibility: true } });
    io.emit('media:control', { id: element.id, action: 'play', currentTime: 0 });
    return waitForMediaEnd(element.id);
  }
  if (step.action === 'fly-across') {
    if (!['image', 'gif', 'video'].includes(element.type)) return Promise.resolve();
    flyElement(element, step.flyDirection, step.durationSeconds ?? 5);
    return delay((step.durationSeconds ?? 5) * 1000);
  }
  if (step.action === 'show-temporary') {
    if (!['image', 'gif'].includes(element.type)) return Promise.resolve();
    const pending = presentElement(element, step.placement);
    if (pending) pending.timer = setTimeout(() => restorePresentation(element.id), (step.durationSeconds ?? 5) * 1000);
    return delay((step.durationSeconds ?? 5) * 1000);
  }
  const changes: Partial<CanvasElement> = {};
  if (step.action === 'show-element') changes.visible = true;
  if (step.action === 'hide-element') changes.visible = false;
  if (step.action === 'toggle-element') changes.visible = !element.visible;
  if (step.action === 'enable-dvd') Object.assign(changes, { dvdEnabled: true, dvdStartedAt: Date.now(), dvdStartX: element.x, dvdStartY: element.y, dvdVelocityX: 120 + Math.random() * 100, dvdVelocityY: (Math.random() > .5 ? 1 : -1) * (120 + Math.random() * 100) });
  Object.assign(element, changes);
  io.emit('element:updated', { id: element.id, changes });
  return Promise.resolve();
}

async function executeTriggerSteps(steps: TriggerStep[], event: TriggerEventPayload) {
  let previousCompletion = Promise.resolve();
  for (const step of steps) {
    if (step.timing === "after-previous") await previousCompletion;
    if (step.timing === "delay") await delay((step.delaySeconds ?? 1) * 1000);
    previousCompletion = executeTriggerStep(step, event).catch((error) => console.error("Trigger action failed", error));
  }
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

app.use("/whitelist", createWhitelistRouter(io, activeUsers));

app.use("/upload", uploadRouter);
app.use("/myinstants", myinstantsRouter);
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
      socket.data.jwtUser = authorizedUser;
      return next();
    }
  }
  next(new Error("Unauthorized"));
});

io.on("connection", (socket) =>
  registerSocketHandlers(
    io,
    socket,
    canvasStore,
    activeUsers,
    activeOverlays,
    finishMedia,
    (playbackId) => {
      soundCompletionWaiters.get(playbackId)?.();
      soundCompletionWaiters.delete(playbackId);
    },
  ),
);

const triggerCooldowns = new Map<string, number>();
configureTwitchEvents((eventType, event) => {
  const emoteSender = (event.chatter_user_login ?? "").toLowerCase();
  const emoteSenderBlocked = canvasStore.chatEmoteSettings.blacklist.includes(emoteSender);
  const emoteSenderKey = emoteSender || event.chatter_user_id || "unknown";
  const canSpawnChatEmote = () => {
    const blockedUntil = chatEmoteSenderCooldowns.get(emoteSenderKey) ?? 0;
    if (blockedUntil > Date.now()) return false;
    chatEmoteSenderCooldowns.delete(emoteSenderKey);
    return true;
  };
  const markChatEmoteSpawned = () => {
    const lifetimeMs = canvasStore.chatEmoteSettings.lifetimeSeconds * 1000;
    const blockedUntil = Date.now() + lifetimeMs;
    chatEmoteSenderCooldowns.set(emoteSenderKey, blockedUntil);
    setTimeout(() => {
      if (chatEmoteSenderCooldowns.get(emoteSenderKey) === blockedUntil)
        chatEmoteSenderCooldowns.delete(emoteSenderKey);
    }, lifetimeMs);
  };
  if (eventType === "chat-command" && canvasStore.chatEmoteSettings.enabled && !emoteSenderBlocked && canSpawnChatEmote()) {
    const nativeEmotes = event.native_emotes ?? [];
    if (nativeEmotes.length || event.room_id) void (event.room_id
      ? resolveSevenTvEmotes(event.room_id, event.message.text)
      : Promise.resolve([])
    ).then((emotes) => {
      type PositionedEmote = (typeof emotes)[number];
      const nativePositions = new Set(nativeEmotes.map((item) => item.position));
      const orderedEmotes: PositionedEmote[] = [
        ...nativeEmotes.map((item) => ({ ...item, isZeroWidth: false })),
        ...emotes.filter((item) => !nativePositions.has(item.position ?? -1)),
      ].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      const stacks: Array<{ base: PositionedEmote; overlays: PositionedEmote[] }> = [];
      const leadingOverlays: PositionedEmote[] = [];
      for (const item of orderedEmotes) {
        if (item.isZeroWidth && stacks.length) stacks.at(-1)!.overlays.push(item);
        else if (item.isZeroWidth) leadingOverlays.push(item);
        else if (!item.isZeroWidth) stacks.push({ base: item, overlays: [] });
      }
      const emote = stacks[0]?.base ?? leadingOverlays[0];
      if (emote && canSpawnChatEmote()) {
        const firstOverlays = stacks[0]?.overlays ?? leadingOverlays;
        const allowlist = new Set(canvasStore.chatEmoteSettings.additionalEmotes.map((name) => name.toLowerCase()));
        const additional = stacks
          .filter((_stack, index) => index > 0)
          .filter((stack) => allowlist.has(stack.base.name.toLowerCase()))
          .map((stack) => ({
            id: randomUUID(),
            emoteId: stack.base.id,
            name: stack.base.name,
            imageUrl: stack.base.imageUrl,
            overlays: stack.overlays.map((item) => ({ emoteId: item.id, name: item.name, imageUrl: item.imageUrl })),
          }));
        markChatEmoteSpawned();
        io.to("overlay").emit("chat-emote:spawn", {
          id: randomUUID(),
          emoteId: emote.id,
          name: emote.name,
          imageUrl: emote.imageUrl,
          overlays: firstOverlays
            .filter((item) => item.id !== emote.id)
            .map((item) => ({ emoteId: item.id, name: item.name, imageUrl: item.imageUrl })),
          additional,
          sender: event.chatter_user_name || event.chatter_user_login || "Viewer",
          senderLogin: emoteSender,
          senderColor: event.chatter_color,
        });
      }
    });
  }
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
    const eventAmount = eventType === 'bits' ? Number(event.bits ?? 0)
      : eventType === 'raid' ? Number((event as any).viewers ?? 0)
        : eventType === 'gift-subscribe' ? Number((event as any).total ?? 0)
          : eventType === 'subscribe' ? Number((event as any).cumulative_months ?? (event as any).duration_months ?? 1)
            : 0;
    if (trigger.minimum !== undefined && eventAmount < trigger.minimum) continue;
    if (trigger.channel && trigger.channel !== String((event as any).channel ?? (event as any).broadcaster_user_login ?? '').toLowerCase()) continue;
    triggerCooldowns.set(trigger.id, now + trigger.cooldownSeconds * 1000);
    canvasStore.activity.unshift({ id: randomUUID(), at: new Date().toISOString(), user: 'Twitch', action: `ran trigger “${trigger.name}”` });
    canvasStore.activity = canvasStore.activity.slice(0, 50);
    io.to('dashboard').emit('studio:sync', { scenes: canvasStore.scenes, presets: canvasStore.presets, sounds: canvasStore.sounds, triggers: canvasStore.triggers, activity: canvasStore.activity, twitchConnected: canvasStore.twitchConnected });
    const steps = trigger.steps?.length ? trigger.steps : [trigger];
    void executeTriggerSteps(steps, event);
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

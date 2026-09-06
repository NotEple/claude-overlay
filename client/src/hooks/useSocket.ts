import { useEffect, useRef, useState, useCallback } from "react";
import type React from "react";
import { io, Socket } from "socket.io-client";
import type {
  CanvasElement,
  CursorPayload,
  UserPresencePayload,
  MediaControlPayload,
  DrawStroke,
  LiveDrawStroke,
  DvdCelebrationSettings,
  ChatEmoteSettings,
  ChatEmoteSpawn,
  StudioState,
  SoundboardItem,
  OverlayTrigger,
  ServerToClientEvents,
  ClientToServerEvents,
} from "../types";
import { getAuthToken } from "./useAuth";
import { useToast } from "../components/ToastProvider";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface UseSocketOptions {
  mode?: "dashboard" | "overlay";
  onSessionRevoked?: () => void;
  onRoleUpdated?: () => void;
  onMediaControl?: (payload: MediaControlPayload) => void;
  onOverlayRefresh?: () => void;
  directUpdateRef?: React.MutableRefObject<
    ((id: string, changes: Partial<CanvasElement>) => void) | null
  >;
}

export function useSocket({
  mode = "dashboard",
  onSessionRevoked,
  onRoleUpdated,
  onMediaControl,
  onOverlayRefresh,
  directUpdateRef,
}: UseSocketOptions = {}) {
  const toast = useToast();
  const socketRef = useRef<AppSocket | null>(null);
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [connected, setConnected] = useState(false);
  const [overlayConnected, setOverlayConnected] = useState(false);
  const [overlayCount, setOverlayCount] = useState(0);
  const [cursors, setCursors] = useState<Map<string, CursorPayload>>(new Map());
  const [activeUsers, setActiveUsers] = useState<UserPresencePayload[]>([]);
  const [showCursorOnOverlay, setShowCursorOnOverlayState] = useState(
    () => localStorage.getItem("show_cursor_on_overlay") === "true",
  );
  const [strokes, setStrokes] = useState<DrawStroke[]>([]);
  const [liveStrokes, setLiveStrokes] = useState<Map<string, LiveDrawStroke>>(
    new Map(),
  );
  const [dvdCelebrationSettings, setDvdCelebrationSettingsState] =
    useState<DvdCelebrationSettings>({
      volume: 0.25,
      soundUrl: null,
      counterPosition: "top-right",
    });
  const [chatEmoteSettings, setChatEmoteSettingsState] =
    useState<ChatEmoteSettings>({
      enabled: false,
      showNames: true,
      nameBackgroundEnabled: true,
      nameBackgroundColor: "#08080a",
      nameFontSize: 12,
      motion: "floor",
      direction: "left",
      gravity: 900,
      size: 40,
      speed: 180,
      lifetimeSeconds: 12,
      maxVisible: 20,
      blacklist: [],
      additionalEmotes: [],
    });
  const [chatEmoteSpawn, setChatEmoteSpawn] =
    useState<ChatEmoteSpawn | null>(null);
  const [studio, setStudio] = useState<StudioState>({
    scenes: [],
    presets: [],
    sounds: [],
    triggers: [],
    activity: [],
    twitchConnected: false,
  });
  const [historyStatus, setHistoryStatus] = useState({
    canUndo: false,
    canRedo: false,
  });
  const [chatChannel, setChatChannelState] = useState("vicksy");

  // Use refs for callbacks so the socket listener closure always has the latest version
  const onRoleUpdatedRef = useRef(onRoleUpdated);
  const onMediaControlRef = useRef(onMediaControl);
  useEffect(() => {
    onRoleUpdatedRef.current = onRoleUpdated;
  }, [onRoleUpdated]);
  useEffect(() => {
    onMediaControlRef.current = onMediaControl;
  }, [onMediaControl]);

  // Pending updates — batched per rAF frame so overlay gets one setState per frame
  const pendingUpdates = useRef<Map<string, Partial<CanvasElement>>>(new Map());
  const pendingCursors = useRef<Map<string, CursorPayload>>(new Map());
  const cursorExpiryTimers = useRef<Map<string, number>>(new Map());
  const rafRef = useRef(0);
  const connectedOnceRef = useRef(false);
  const lastConnectionToastRef = useRef(0);
  const activeSoundAudioRef = useRef<Set<HTMLAudioElement>>(new Set());
  const previewAudioBySoundRef = useRef<Map<string, Set<HTMLAudioElement>>>(new Map());

  const startSound = useCallback(
    (
      item: SoundboardItem & { playbackId?: string },
      mutedStart: boolean,
      reportError: boolean,
      previewSoundId?: string,
    ) => {
      const audio = new Audio(item.url);
      activeSoundAudioRef.current.add(audio);
      if (previewSoundId) {
        const previews = previewAudioBySoundRef.current.get(previewSoundId) ?? new Set<HTMLAudioElement>();
        previews.add(audio);
        previewAudioBySoundRef.current.set(previewSoundId, previews);
      }
      audio.preload = "auto";
      audio.volume = item.volume;
      audio.muted = mutedStart;
      const cleanup = () => {
        activeSoundAudioRef.current.delete(audio);
        if (previewSoundId) {
          const previews = previewAudioBySoundRef.current.get(previewSoundId);
          previews?.delete(audio);
          if (!previews?.size) previewAudioBySoundRef.current.delete(previewSoundId);
        }
      };
      let completionReported = false;
      const reportPlaybackEnded = () => {
        if (completionReported || mode !== "overlay" || !item.playbackId) return;
        completionReported = true;
        socketRef.current?.emit("sound:ended", {
          playbackId: item.playbackId,
        });
      };
      audio.addEventListener(
        "ended",
        () => {
          cleanup();
          reportPlaybackEnded();
        },
        { once: true },
      );
      audio.addEventListener(
        "error",
        () => {
          cleanup();
          reportPlaybackEnded();
          if (reportError)
            toast.error(
              `Could not load “${item.name}”. Check its URL or uploaded file.`,
            );
        },
        { once: true },
      );
      audio
        .play()
        .then(() => {
          if (mutedStart) audio.muted = false;
        })
        .catch((error) => {
          cleanup();
          reportPlaybackEnded();
          console.error("Soundboard playback failed:", error);
          if (reportError)
            toast.error(
              `Could not play “${item.name}”. The browser may have blocked audio.`,
            );
        });
    },
    [mode, toast],
  );

  useEffect(() => {
    const socket: AppSocket = io(SERVER_URL, {
      transports: ["websocket", "polling"],
      withCredentials: true,
      query: mode === "overlay" ? { mode: "overlay" } : {},
      auth: mode === "overlay" ? {} : { token: getAuthToken() ?? "" },
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      if (mode === "dashboard" && connectedOnceRef.current)
        toast.success("Reconnected to the dashboard server");
      connectedOnceRef.current = true;
    });
    socket.on("disconnect", () => {
      setConnected(false);
      if (mode === "dashboard") {
        lastConnectionToastRef.current = Date.now();
        toast.error("Disconnected from the dashboard server. Reconnecting…");
      }
    });
    socket.on("connect_error", (err) => {
      console.error("Socket connect error:", err.message);
      if (
        mode === "dashboard" &&
        Date.now() - lastConnectionToastRef.current > 8000
      ) {
        lastConnectionToastRef.current = Date.now();
        toast.error(
          `Could not connect to the dashboard server: ${err.message}`,
        );
      }
    });
    socket.on("overlay:status", ({ connected: online, count }) => {
      setOverlayConnected(online);
      setOverlayCount(count);
    });

    const normalizeScale = (el: CanvasElement): CanvasElement => ({
      ...el,
      scaleX: el.scaleX < 0 ? -1 : 1,
      scaleY: el.scaleY < 0 ? -1 : 1,
    });
    socket.on("state:sync", (state) =>
      setElements(state.elements.map(normalizeScale)),
    );
    socket.on("element:added", ({ element }) =>
      setElements((p) => {
        const normalized = normalizeScale(element);
        // May already be present from the optimistic local add — replace rather than duplicate.
        if (p.some((el) => el.id === normalized.id)) {
          return p.map((el) => (el.id === normalized.id ? normalized : el));
        }
        return [...p, normalized];
      }),
    );
    socket.on("element:removed", ({ id }) =>
      setElements((p) => p.filter((el) => el.id !== id)),
    );

    // Batch position updates via rAF
    socket.on("element:updated", ({ id, changes }) => {
      if (!changes || typeof changes !== "object") return;
      // Flight duration must use the receiving browser's clock. Comparing a
      // Render server timestamp with a viewer's system clock can clamp the
      // animation to its beginning or end and make duration changes ineffective.
      const normalizedChanges = {
        ...changes,
        ...(changes.flyStartedAt ? { flyStartedAt: Date.now() } : {}),
        ...(changes.effectStartedAt ? { effectStartedAt: Date.now() } : {}),
      };
      pendingUpdates.current.set(id, {
        ...(pendingUpdates.current.get(id) ?? {}),
        ...normalizedChanges,
      });
    });
    socket.on("media:control", (payload) =>
      onMediaControlRef.current?.(payload),
    );

    socket.on("cursor:move", (payload) => {
      pendingCursors.current.set(payload.userId, payload);
      const existingTimer = cursorExpiryTimers.current.get(payload.userId);
      if (existingTimer !== undefined) window.clearTimeout(existingTimer);
      cursorExpiryTimers.current.set(
        payload.userId,
        window.setTimeout(() => {
          pendingCursors.current.delete(payload.userId);
          setCursors((previous) => {
            const next = new Map(previous);
            next.delete(payload.userId);
            return next;
          });
          cursorExpiryTimers.current.delete(payload.userId);
        }, 650),
      );
    });
    socket.on("users:list", (users) => setActiveUsers(users));
    socket.on("user:joined", (user) =>
      setActiveUsers((p) => [
        ...p.filter((u) => u.userId !== user.userId),
        user,
      ]),
    );
    socket.on("user:left", ({ userId }) => {
      const timer = cursorExpiryTimers.current.get(userId);
      if (timer !== undefined) window.clearTimeout(timer);
      cursorExpiryTimers.current.delete(userId);
      setActiveUsers((p) => p.filter((u) => u.userId !== userId));
      setCursors((p) => {
        const m = new Map(p);
        m.delete(userId);
        return m;
      });
    });
    socket.on("session:revoked", () => {
      socket.disconnect();
      onSessionRevoked?.();
    });
    socket.on("session:role_updated", () => onRoleUpdatedRef.current?.());
    socket.on("overlay:refresh", () => {
      if (onOverlayRefresh) {
        onOverlayRefresh();
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.set("v", String(Date.now()));
      window.location.replace(url.toString());
    });

    socket.on("draw:sync", (s) => setStrokes(s));
    socket.on("draw:stroke", (stroke) =>
      setStrokes((prev) => [...prev, stroke]),
    );
    socket.on("draw:clear", () => {
      setStrokes([]);
      setLiveStrokes(new Map());
    });
    socket.on("draw:live", (live) => {
      setLiveStrokes((prev) => {
        const next = new Map(prev);
        if (live.points.length === 0) {
          next.delete(live.userId);
        } else {
          next.set(live.userId, live);
        }
        return next;
      });
    });
    socket.on("dvd:settings", setDvdCelebrationSettingsState);
    socket.on("chat-emote:settings", setChatEmoteSettingsState);
    socket.on("chat-emote:spawn", setChatEmoteSpawn);
    socket.on("studio:sync", setStudio);
    socket.on("history:status", setHistoryStatus);
    socket.on("chat:channel", ({ channel }) => setChatChannelState(channel));
    socket.on("sound:play", (item) => {
      if (mode !== "overlay") return;
      startSound(item, true, false);
    });

    // rAF loop — flush pending element and cursor updates once per frame
    const flushLoop = () => {
      rafRef.current = requestAnimationFrame(flushLoop);
      if (pendingUpdates.current.size > 0) {
        const batch = new Map(pendingUpdates.current);
        pendingUpdates.current.clear();
        const directUpdate = directUpdateRef?.current;
        const GEOMETRY_KEYS = new Set([
          "x",
          "y",
          "width",
          "height",
          "rotation",
          "scaleX",
          "scaleY",
        ]);
        // Apply to DOM immediately for smoothness
        if (directUpdate) {
          for (const [id, changes] of batch) {
            const keys = Object.keys(changes);
            if (keys.length > 0 && keys.every((k) => GEOMETRY_KEYS.has(k))) {
              directUpdate(id, changes);
            }
          }
        }
        // Always update React state to keep it in sync
        setElements((prev) =>
          prev.map((el) => {
            const u = batch.get(el.id);
            if (!u) return el;
            const merged = { ...el, ...u };
            if ("groupId" in u && u.groupId === null) {
              delete merged.groupId;
              delete merged.groupName;
            }
            return merged;
          }),
        );
      }
      if (pendingCursors.current.size > 0) {
        const batch = new Map(pendingCursors.current);
        pendingCursors.current.clear();
        setCursors((prev) => {
          const next = new Map(prev);
          batch.forEach((v, k) => next.set(k, v));
          return next;
        });
      }
    };
    rafRef.current = requestAnimationFrame(flushLoop);

    return () => {
      socket.disconnect();
      cancelAnimationFrame(rafRef.current);
      cursorExpiryTimers.current.forEach((timer) => window.clearTimeout(timer));
      cursorExpiryTimers.current.clear();
      activeSoundAudioRef.current.forEach((audio) => audio.pause());
      activeSoundAudioRef.current.clear();
    };
  }, [mode, startSound]);

  const addElement = (element: CanvasElement) => {
    setElements((prev) => [...prev, element]);
    socketRef.current?.emit("element:add", { element });
  };
  const updateElement = useCallback(
    (id: string, changes: Partial<CanvasElement>) => {
      // Socket payloads are runtime data even though this function is typed.
      // Ignore invalid callers instead of allowing `in`/spread operations on
      // null to take down the entire dashboard.
      if (!changes || typeof changes !== "object") return;
      setElements((prev) =>
        prev.map((el) => {
          if (el.id !== id) return el;
          const merged = { ...el, ...changes };
          if ("groupId" in changes && changes.groupId === null) {
            delete merged.groupId;
            delete merged.groupName;
          }
          return merged;
        }),
      );
      socketRef.current?.emit("element:update", { id, changes });
    },
    [],
  );
  const removeElement = (id: string) =>
    socketRef.current?.emit("element:remove", { id });
  const setShowCursorOnOverlay = useCallback((visible: boolean) => {
    localStorage.setItem("show_cursor_on_overlay", String(visible));
    setShowCursorOnOverlayState(visible);
  }, []);
  const sendCursor = useCallback(
    (x: number, y: number) =>
      socketRef.current?.volatile.emit("cursor:move", {
        x,
        y,
        showOnOverlay: showCursorOnOverlay,
      }),
    [showCursorOnOverlay],
  );
  const emitMediaControl = useCallback(
    (payload: MediaControlPayload) =>
      socketRef.current?.emit("media:control", payload),
    [],
  );
  const notifyMediaEnded = useCallback(
    (id: string) => socketRef.current?.emit("media:ended", { id }),
    [],
  );
  const refreshOverlay = useCallback(
    () => socketRef.current?.emit("overlay:refresh"),
    [],
  );
  const addStroke = useCallback((stroke: DrawStroke) => {
    setStrokes((prev) => [...prev, stroke]);
    socketRef.current?.emit("draw:stroke", stroke);
    // Clear own live stroke now that it's committed
    socketRef.current?.volatile.emit("draw:live", {
      points: [],
      color: "",
      size: 0,
      eraser: false,
    });
  }, []);
  const clearStrokes = useCallback(() => {
    setStrokes([]);
    setLiveStrokes(new Map());
    socketRef.current?.emit("draw:clear");
  }, []);
  const sendLiveStroke = useCallback((data: Omit<LiveDrawStroke, "userId">) => {
    socketRef.current?.volatile.emit("draw:live", data);
  }, []);
  const setDvdCelebrationSettings = useCallback(
    (settings: DvdCelebrationSettings) => {
      setDvdCelebrationSettingsState(settings);
      socketRef.current?.emit("dvd:settings", settings);
    },
    [],
  );
  const setChatEmoteSettings = useCallback((settings: ChatEmoteSettings) => {
    setChatEmoteSettingsState(settings);
    socketRef.current?.emit("chat-emote:settings", settings);
  }, []);

  const undo = useCallback(() => socketRef.current?.emit("history:undo"), []);
  const redo = useCallback(() => socketRef.current?.emit("history:redo"), []);
  const saveScene = useCallback(
    (id: string, name: string) =>
      socketRef.current?.emit("scene:save", { id, name }),
    [],
  );
  const loadScene = useCallback(
    (id: string) => socketRef.current?.emit("scene:load", { id }),
    [],
  );
  const deleteScene = useCallback(
    (id: string) => socketRef.current?.emit("scene:delete", { id }),
    [],
  );
  const savePreset = useCallback(
    (id: string, name: string, elementIds: string[]) =>
      socketRef.current?.emit("preset:save", { id, name, elementIds }),
    [],
  );
  const loadPreset = useCallback(
    (id: string) => socketRef.current?.emit("preset:load", { id }),
    [],
  );
  const deletePreset = useCallback(
    (id: string) => socketRef.current?.emit("preset:delete", { id }),
    [],
  );
  const saveSound = useCallback(
    (item: SoundboardItem) => {
      previewAudioBySoundRef.current.get(item.id)?.forEach((audio) => {
        audio.volume = item.volume;
      });
      socketRef.current?.emit("sound:save", item);
    },
    [],
  );
  const deleteSound = useCallback(
    (id: string) => socketRef.current?.emit("sound:delete", { id }),
    [],
  );
  const previewSound = useCallback(
    (id: string) => {
      const item = studio.sounds.find((sound) => sound.id === id);
      if (!item) {
        toast.error("That sound is no longer available.");
        return;
      }
      // Local-only safety preview, started synchronously from the click so the
      // browser recognizes the user gesture.
      startSound(item, false, true, item.id);
    },
    [studio.sounds, startSound, toast],
  );
  const playSound = useCallback(
    (id: string) => {
      const item = studio.sounds.find((sound) => sound.id === id);
      if (!item) {
        toast.error("That sound is no longer available.");
        return;
      }
      if (!overlayConnected) {
        toast.error("The OBS overlay is offline, so the sound was not played.");
        return;
      }
      socketRef.current?.emit("sound:play", { id });
      toast.success(`Playing “${item.name}” on overlay`);
    },
    [overlayConnected, studio.sounds, toast],
  );
  const saveTrigger = useCallback(
    (trigger: OverlayTrigger) =>
      socketRef.current?.emit("trigger:save", trigger),
    [],
  );
  const deleteTrigger = useCallback(
    (id: string) => socketRef.current?.emit("trigger:delete", { id }),
    [],
  );
  const setChatChannel = useCallback(
    (channel: string) =>
      socketRef.current?.emit("chat:channel:set", { channel }),
    [],
  );

  return {
    elements,
    connected,
    overlayConnected,
    overlayCount,
    cursors,
    activeUsers,
    showCursorOnOverlay,
    setShowCursorOnOverlay,
    dvdCelebrationSettings,
    setDvdCelebrationSettings,
    chatEmoteSettings,
    setChatEmoteSettings,
    chatEmoteSpawn,
    strokes,
    liveStrokes,
    studio,
    historyStatus,
    chatChannel,
    setChatChannel,
    addElement,
    updateElement,
    removeElement,
    sendCursor,
    emitMediaControl,
    notifyMediaEnded,
    refreshOverlay,
    addStroke,
    clearStrokes,
    sendLiveStroke,
    undo,
    redo,
    saveScene,
    loadScene,
    deleteScene,
    savePreset,
    loadPreset,
    deletePreset,
    saveSound,
    deleteSound,
    previewSound,
    playSound,
    saveTrigger,
    deleteTrigger,
  };
}

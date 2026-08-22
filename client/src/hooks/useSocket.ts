import { useEffect, useRef, useState, useCallback } from 'react';
import type React from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  CanvasElement, CursorPayload, UserPresencePayload, MediaControlPayload, DrawStroke, LiveDrawStroke, DvdCelebrationSettings,
  ServerToClientEvents, ClientToServerEvents,
} from '../types';
import { getAuthToken } from './useAuth';
import { useToast } from '../components/ToastProvider';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';
type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface UseSocketOptions {
  mode?: 'dashboard' | 'overlay';
  onSessionRevoked?: () => void;
  onRoleUpdated?: () => void;
  onMediaControl?: (payload: MediaControlPayload) => void;
  onOverlayRefresh?: () => void;
  directUpdateRef?: React.MutableRefObject<((id: string, changes: Partial<CanvasElement>) => void) | null>;
}

export function useSocket({ mode = 'dashboard', onSessionRevoked, onRoleUpdated, onMediaControl, onOverlayRefresh, directUpdateRef }: UseSocketOptions = {}) {
  const toast = useToast();
  const socketRef = useRef<AppSocket | null>(null);
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [connected, setConnected] = useState(false);
  const [overlayConnected, setOverlayConnected] = useState(false);
  const [overlayCount, setOverlayCount] = useState(0);
  const [cursors, setCursors] = useState<Map<string, CursorPayload>>(new Map());
  const [activeUsers, setActiveUsers] = useState<UserPresencePayload[]>([]);
  const [showCursorOnOverlay, setShowCursorOnOverlayState] = useState(
    () => localStorage.getItem('show_cursor_on_overlay') === 'true',
  );
  const [strokes, setStrokes] = useState<DrawStroke[]>([]);
  const [liveStrokes, setLiveStrokes] = useState<Map<string, LiveDrawStroke>>(new Map());
  const [dvdCelebrationSettings, setDvdCelebrationSettingsState] =
    useState<DvdCelebrationSettings>({
      volume: 0.25,
      soundUrl: null,
      counterPosition: 'top-right',
    });

  // Use refs for callbacks so the socket listener closure always has the latest version
  const onRoleUpdatedRef = useRef(onRoleUpdated);
  const onMediaControlRef = useRef(onMediaControl);
  useEffect(() => { onRoleUpdatedRef.current = onRoleUpdated; }, [onRoleUpdated]);
  useEffect(() => { onMediaControlRef.current = onMediaControl; }, [onMediaControl]);

  // Pending updates — batched per rAF frame so overlay gets one setState per frame
  const pendingUpdates = useRef<Map<string, Partial<CanvasElement>>>(new Map());
  const pendingCursors = useRef<Map<string, CursorPayload>>(new Map());
  const cursorExpiryTimers = useRef<Map<string, number>>(new Map());
  const rafRef = useRef(0);
  const connectedOnceRef = useRef(false);
  const lastConnectionToastRef = useRef(0);

  useEffect(() => {
    const socket: AppSocket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      query: mode === 'overlay' ? { mode: 'overlay' } : {},
      auth: mode === 'overlay' ? {} : { token: getAuthToken() ?? '' },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      if (mode === 'dashboard' && connectedOnceRef.current) toast.success('Reconnected to the dashboard server');
      connectedOnceRef.current = true;
    });
    socket.on('disconnect', () => {
      setConnected(false);
      if (mode === 'dashboard') {
        lastConnectionToastRef.current = Date.now();
        toast.error('Disconnected from the dashboard server. Reconnecting…');
      }
    });
    socket.on('connect_error', (err) => {
      console.error('Socket connect error:', err.message);
      if (mode === 'dashboard' && Date.now() - lastConnectionToastRef.current > 8000) {
        lastConnectionToastRef.current = Date.now();
        toast.error(`Could not connect to the dashboard server: ${err.message}`);
      }
    });
    socket.on('overlay:status', ({ connected: online, count }) => {
      setOverlayConnected(online);
      setOverlayCount(count);
    });

    const normalizeScale = (el: CanvasElement): CanvasElement => ({
      ...el,
      scaleX: el.scaleX < 0 ? -1 : 1,
      scaleY: el.scaleY < 0 ? -1 : 1,
    });
    socket.on('state:sync', (state) => setElements(state.elements.map(normalizeScale)));
    socket.on('element:added', ({ element }) => setElements((p) => {
      const normalized = normalizeScale(element);
      // May already be present from the optimistic local add — replace rather than duplicate.
      if (p.some((el) => el.id === normalized.id)) {
        return p.map((el) => (el.id === normalized.id ? normalized : el));
      }
      return [...p, normalized];
    }));
    socket.on('element:removed', ({ id }) => setElements((p) => p.filter((el) => el.id !== id)));

    // Batch position updates via rAF
    socket.on('element:updated', ({ id, changes }) => {
      pendingUpdates.current.set(id, { ...(pendingUpdates.current.get(id) ?? {}), ...changes });
    });

    socket.on('media:control', (payload) => onMediaControlRef.current?.(payload));

    socket.on('cursor:move', (payload) => {
      pendingCursors.current.set(payload.userId, payload);
      const existingTimer = cursorExpiryTimers.current.get(payload.userId);
      if (existingTimer !== undefined) window.clearTimeout(existingTimer);
      cursorExpiryTimers.current.set(payload.userId, window.setTimeout(() => {
        pendingCursors.current.delete(payload.userId);
        setCursors((previous) => {
          const next = new Map(previous);
          next.delete(payload.userId);
          return next;
        });
        cursorExpiryTimers.current.delete(payload.userId);
      }, 650));
    });
    socket.on('users:list', (users) => setActiveUsers(users));
    socket.on('user:joined', (user) => setActiveUsers((p) => [...p.filter((u) => u.userId !== user.userId), user]));
    socket.on('user:left', ({ userId }) => {
      const timer = cursorExpiryTimers.current.get(userId);
      if (timer !== undefined) window.clearTimeout(timer);
      cursorExpiryTimers.current.delete(userId);
      setActiveUsers((p) => p.filter((u) => u.userId !== userId));
      setCursors((p) => { const m = new Map(p); m.delete(userId); return m; });
    });
    socket.on('session:revoked', () => { socket.disconnect(); onSessionRevoked?.(); });
    socket.on('session:role_updated', () => onRoleUpdatedRef.current?.());
    socket.on('overlay:refresh', () => {
      if (onOverlayRefresh) { onOverlayRefresh(); return; }
      const url = new URL(window.location.href);
      url.searchParams.set('v', String(Date.now()));
      window.location.replace(url.toString());
    });

    socket.on('draw:sync', (s) => setStrokes(s));
    socket.on('draw:stroke', (stroke) => setStrokes((prev) => [...prev, stroke]));
    socket.on('draw:clear', () => { setStrokes([]); setLiveStrokes(new Map()); });
    socket.on('draw:live', (live) => {
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
    socket.on('dvd:settings', setDvdCelebrationSettingsState);

    // rAF loop — flush pending element and cursor updates once per frame
    const flushLoop = () => {
      rafRef.current = requestAnimationFrame(flushLoop);
      if (pendingUpdates.current.size > 0) {
        const batch = new Map(pendingUpdates.current);
        pendingUpdates.current.clear();
        const directUpdate = directUpdateRef?.current;
        const GEOMETRY_KEYS = new Set(['x', 'y', 'width', 'height', 'rotation', 'scaleX', 'scaleY']);
        // Apply to DOM immediately for smoothness
        if (directUpdate) {
          for (const [id, changes] of batch) {
            const keys = Object.keys(changes);
            if (keys.length > 0 && keys.every(k => GEOMETRY_KEYS.has(k))) {
              directUpdate(id, changes);
            }
          }
        }
        // Always update React state to keep it in sync
        setElements((prev) => prev.map((el) => {
          const u = batch.get(el.id);
          if (!u) return el;
          const merged = { ...el, ...u };
          if ('groupId' in u && u.groupId === null) delete merged.groupId;
          return merged;
        }));
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
    };
  }, [mode]);

  const addElement = (element: CanvasElement) => {
    setElements((prev) => [...prev, element]);
    socketRef.current?.emit('element:add', { element });
  };
  const updateElement = useCallback((id: string, changes: Partial<CanvasElement>) => {
    setElements((prev) => prev.map((el) => {
      if (el.id !== id) return el;
      const merged = { ...el, ...changes };
      if ('groupId' in changes && changes.groupId === null) delete merged.groupId;
      return merged;
    }));
    socketRef.current?.emit('element:update', { id, changes });
  }, []);
  const removeElement = (id: string) => socketRef.current?.emit('element:remove', { id });
  const setShowCursorOnOverlay = useCallback((visible: boolean) => {
    localStorage.setItem('show_cursor_on_overlay', String(visible));
    setShowCursorOnOverlayState(visible);
  }, []);
  const sendCursor = useCallback((x: number, y: number) => socketRef.current?.volatile.emit('cursor:move', { x, y, showOnOverlay: showCursorOnOverlay }), [showCursorOnOverlay]);
  const emitMediaControl = useCallback((payload: MediaControlPayload) => socketRef.current?.emit('media:control', payload), []);
  const refreshOverlay = useCallback(() => socketRef.current?.emit('overlay:refresh'), []);
  const addStroke = useCallback((stroke: DrawStroke) => {
    setStrokes((prev) => [...prev, stroke]);
    socketRef.current?.emit('draw:stroke', stroke);
    // Clear own live stroke now that it's committed
    socketRef.current?.volatile.emit('draw:live', { points: [], color: '', size: 0, eraser: false });
  }, []);
  const clearStrokes = useCallback(() => {
    setStrokes([]);
    setLiveStrokes(new Map());
    socketRef.current?.emit('draw:clear');
  }, []);
  const sendLiveStroke = useCallback((data: Omit<LiveDrawStroke, 'userId'>) => {
    socketRef.current?.volatile.emit('draw:live', data);
  }, []);
  const setDvdCelebrationSettings = useCallback((settings: DvdCelebrationSettings) => {
    setDvdCelebrationSettingsState(settings);
    socketRef.current?.emit('dvd:settings', settings);
  }, []);

  return { elements, connected, overlayConnected, overlayCount, cursors, activeUsers, showCursorOnOverlay, setShowCursorOnOverlay, dvdCelebrationSettings, setDvdCelebrationSettings, strokes, liveStrokes, addElement, updateElement, removeElement, sendCursor, emitMediaControl, refreshOverlay, addStroke, clearStrokes, sendLiveStroke };
}

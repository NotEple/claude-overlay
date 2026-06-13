import { useEffect, useRef, useState, useCallback } from 'react';
import type React from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  CanvasElement, CursorPayload, UserPresencePayload, MediaControlPayload,
  ServerToClientEvents, ClientToServerEvents,
} from '../types';
import { getAuthToken } from './useAuth';

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
  const socketRef = useRef<AppSocket | null>(null);
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [connected, setConnected] = useState(false);
  const [cursors, setCursors] = useState<Map<string, CursorPayload>>(new Map());
  const [activeUsers, setActiveUsers] = useState<UserPresencePayload[]>([]);

  // Use refs for callbacks so the socket listener closure always has the latest version
  const onRoleUpdatedRef = useRef(onRoleUpdated);
  const onMediaControlRef = useRef(onMediaControl);
  useEffect(() => { onRoleUpdatedRef.current = onRoleUpdated; }, [onRoleUpdated]);
  useEffect(() => { onMediaControlRef.current = onMediaControl; }, [onMediaControl]);

  // Pending updates — batched per rAF frame so overlay gets one setState per frame
  const pendingUpdates = useRef<Map<string, Partial<CanvasElement>>>(new Map());
  const pendingCursors = useRef<Map<string, CursorPayload>>(new Map());
  const rafRef = useRef(0);

  useEffect(() => {
    const socket: AppSocket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      query: mode === 'overlay' ? { mode: 'overlay' } : {},
      auth: mode === 'overlay' ? {} : { token: getAuthToken() ?? '' },
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err) => console.error('Socket connect error:', err.message));

    const normalizeScale = (el: CanvasElement): CanvasElement => ({
      ...el,
      scaleX: el.scaleX < 0 ? -1 : 1,
      scaleY: el.scaleY < 0 ? -1 : 1,
    });
    socket.on('state:sync', (state) => setElements(state.elements.map(normalizeScale)));
    socket.on('element:added', ({ element }) => setElements((p) => [...p, normalizeScale(element)]));
    socket.on('element:removed', ({ id }) => setElements((p) => p.filter((el) => el.id !== id)));

    // Batch position updates via rAF
    socket.on('element:updated', ({ id, changes }) => {
      pendingUpdates.current.set(id, { ...(pendingUpdates.current.get(id) ?? {}), ...changes });
    });

    socket.on('media:control', (payload) => onMediaControlRef.current?.(payload));

    socket.on('cursor:move', (payload) => { pendingCursors.current.set(payload.userId, payload); });
    socket.on('users:list', (users) => setActiveUsers(users));
    socket.on('user:joined', (user) => setActiveUsers((p) => [...p.filter((u) => u.userId !== user.userId), user]));
    socket.on('user:left', ({ userId }) => {
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
    };
  }, [mode]);

  const addElement = (element: CanvasElement) => socketRef.current?.emit('element:add', { element });
  const updateElement = useCallback((id: string, changes: Partial<CanvasElement>) => socketRef.current?.emit('element:update', { id, changes }), []);
  const removeElement = (id: string) => socketRef.current?.emit('element:remove', { id });
  const triggerAudio = (id: string, src: string) => socketRef.current?.emit('audio:trigger', { id, src });
  const sendCursor = useCallback((x: number, y: number) => socketRef.current?.volatile.emit('cursor:move', { x, y }), []);
  const emitMediaControl = useCallback((payload: MediaControlPayload) => socketRef.current?.emit('media:control', payload), []);
  const refreshOverlay = useCallback(() => socketRef.current?.emit('overlay:refresh'), []);

  return { elements, connected, cursors, activeUsers, addElement, updateElement, removeElement, triggerAudio, sendCursor, emitMediaControl, refreshOverlay };
}

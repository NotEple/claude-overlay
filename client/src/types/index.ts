export type MediaType = 'image' | 'gif' | 'video' | 'audio' | 'text';

export interface CanvasElement {
  id: string;
  type: MediaType;
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  visible: boolean;
  zIndex: number;
  groupId?: string | null;
  mediaCurrentTime?: number;
  mediaPaused?: boolean;
  mediaVolume?: number;
  autoVisibility?: boolean;
  dvdEnabled?: boolean;
  dvdStartedAt?: number;
  dvdStartX?: number;
  dvdStartY?: number;
  dvdVelocityX?: number;
  dvdVelocityY?: number;
  locked?: boolean;
  opacity?: number;
  enterAnimation?: ElementAnimation;
  exitAnimation?: ElementAnimation;
}

export type ElementAnimation = 'none' | 'fade' | 'pop' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'spin';
export interface SavedScene { id: string; name: string; elements: CanvasElement[]; strokes: DrawStroke[]; updatedAt: string; }
export interface ElementPreset { id: string; name: string; elements: CanvasElement[]; createdAt: string; }
export interface SoundboardItem { id: string; name: string; url: string; volume: number; }
export type TriggerEventType = 'chat-command' | 'follow' | 'subscribe' | 'gift-subscribe' | 'raid' | 'bits' | 'channel-points';
export type TriggerActionType = 'show-element' | 'show-temporary' | 'hide-element' | 'toggle-element' | 'play-media' | 'play-sound' | 'enable-dvd' | 'refresh-overlay';
export type TriggerPlacement = 'current' | 'fit' | 'fill' | 'top-left' | 'top-center' | 'top-right' | 'center-left' | 'center' | 'center-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
export type ChatPermission = 'everyone' | 'vip' | 'moderator' | 'streamer';
export interface OverlayTrigger { id: string; name: string; enabled: boolean; event: TriggerEventType; match?: string; minimum?: number; action: TriggerActionType; targetId?: string; cooldownSeconds: number; placement?: TriggerPlacement; durationSeconds?: number; permission?: ChatPermission; }
export interface ActivityItem { id: string; at: string; user: string; action: string; }
export interface StudioState { scenes: SavedScene[]; presets: ElementPreset[]; sounds: SoundboardItem[]; triggers: OverlayTrigger[]; activity: ActivityItem[]; twitchConnected: boolean; }

export interface CanvasState { elements: CanvasElement[]; }
export interface DvdCelebrationSettings {
  volume: number;
  soundUrl: string | null;
  counterPosition: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
}
export interface ElementAddedPayload { element: CanvasElement; }
export interface ElementUpdatedPayload { id: string; changes: Partial<CanvasElement>; }
export interface ElementRemovedPayload { id: string; }
export interface MediaControlPayload {
  id: string;
  action: 'play' | 'pause' | 'seek';
  currentTime: number;
}

export interface CursorPayload {
  userId: string;
  login: string;
  displayName: string;
  avatar: string;
  color: string;
  x: number;
  y: number;
}

export interface UserPresencePayload {
  userId: string;
  login: string;
  displayName: string;
  avatar: string;
  color: string;
}

export interface DrawStroke {
  id: string;
  points: Array<[number, number]>;
  color: string;
  size: number;
  eraser: boolean;
  fillX?: number;
  fillY?: number;
}

export interface LiveDrawStroke {
  userId: string;
  points: Array<[number, number]>;
  color: string;
  size: number;
  eraser: boolean;
}

export interface ServerToClientEvents {
  'state:sync': (state: CanvasState) => void;
  'element:added': (payload: ElementAddedPayload) => void;
  'element:updated': (payload: ElementUpdatedPayload) => void;
  'element:removed': (payload: ElementRemovedPayload) => void;
  'media:control': (payload: MediaControlPayload) => void;
  'cursor:move': (payload: CursorPayload) => void;
  'user:joined': (payload: UserPresencePayload) => void;
  'user:left': (payload: { userId: string }) => void;
  'users:list': (payload: UserPresencePayload[]) => void;
  'session:revoked': () => void;
  'session:role_updated': () => void;
  'overlay:refresh': () => void;
  'overlay:status': (payload: { connected: boolean; count: number }) => void;
  'draw:stroke': (stroke: DrawStroke) => void;
  'draw:clear': () => void;
  'draw:sync': (strokes: DrawStroke[]) => void;
  'draw:live': (stroke: LiveDrawStroke) => void;
  'dvd:settings': (settings: DvdCelebrationSettings) => void;
  'studio:sync': (state: StudioState) => void;
  'history:status': (status: { canUndo: boolean; canRedo: boolean }) => void;
  'sound:play': (item: SoundboardItem) => void;
  'chat:channel': (payload: { channel: string }) => void;
}

export interface ClientToServerEvents {
  'element:add': (payload: ElementAddedPayload) => void;
  'element:update': (payload: ElementUpdatedPayload) => void;
  'element:remove': (payload: ElementRemovedPayload) => void;
  'media:control': (payload: MediaControlPayload) => void;
  'media:ended': (payload: { id: string }) => void;
  'cursor:move': (payload: { x: number; y: number; showOnOverlay: boolean }) => void;
  'overlay:refresh': () => void;
  'draw:stroke': (stroke: DrawStroke) => void;
  'draw:clear': () => void;
  'draw:live': (stroke: Omit<LiveDrawStroke, 'userId'>) => void;
  'dvd:settings': (settings: DvdCelebrationSettings) => void;
  'history:undo': () => void;
  'history:redo': () => void;
  'scene:save': (payload: { id: string; name: string }) => void;
  'scene:load': (payload: { id: string }) => void;
  'scene:delete': (payload: { id: string }) => void;
  'preset:save': (payload: { id: string; name: string; elementIds: string[] }) => void;
  'preset:load': (payload: { id: string }) => void;
  'preset:delete': (payload: { id: string }) => void;
  'sound:save': (item: SoundboardItem) => void;
  'sound:delete': (payload: { id: string }) => void;
  'sound:play': (payload: { id: string }) => void;
  'trigger:save': (trigger: OverlayTrigger) => void;
  'trigger:delete': (payload: { id: string }) => void;
  'chat:channel:set': (payload: { channel: string }) => void;
}

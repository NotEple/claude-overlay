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
}

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
}

export interface ClientToServerEvents {
  'element:add': (payload: ElementAddedPayload) => void;
  'element:update': (payload: ElementUpdatedPayload) => void;
  'element:remove': (payload: ElementRemovedPayload) => void;
  'media:control': (payload: MediaControlPayload) => void;
  'cursor:move': (payload: { x: number; y: number; showOnOverlay: boolean }) => void;
  'overlay:refresh': () => void;
  'draw:stroke': (stroke: DrawStroke) => void;
  'draw:clear': () => void;
  'draw:live': (stroke: Omit<LiveDrawStroke, 'userId'>) => void;
  'dvd:settings': (settings: DvdCelebrationSettings) => void;
}

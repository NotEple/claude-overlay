import { getChatEmoteSettings, getStudioData } from "../db/index.js";
import type { ActivityItem, CanvasState, ChatEmoteSettings, DrawStroke, DvdCelebrationSettings, ElementPreset, OverlayTrigger, SavedScene, SoundboardItem } from "../types.js";

export interface CanvasSnapshot { elements: CanvasState['elements']; strokes: DrawStroke[]; }

export interface CanvasStore {
  canvasState: CanvasState;
  drawStrokes: DrawStroke[];
  dvdCelebrationSettings: DvdCelebrationSettings;
  chatEmoteSettings: ChatEmoteSettings;
  scenes: SavedScene[];
  presets: ElementPreset[];
  sounds: SoundboardItem[];
  triggers: OverlayTrigger[];
  activity: ActivityItem[];
  undoStack: CanvasSnapshot[];
  redoStack: CanvasSnapshot[];
  twitchConnected: boolean;
}

const studio = getStudioData();

export const canvasStore: CanvasStore = {
  canvasState: { elements: [] },
  drawStrokes: [],
  dvdCelebrationSettings: {
    volume: 0.25,
    soundUrl: null,
    counterPosition: "top-right",
  },
  chatEmoteSettings: (() => {
    const stored = getChatEmoteSettings();
    return {
      enabled: stored?.enabled ?? false,
      showNames: stored?.showNames ?? true,
      nameBackgroundEnabled: stored?.nameBackgroundEnabled ?? true,
      nameBackgroundColor: /^#[0-9a-f]{6}$/i.test(stored?.nameBackgroundColor ?? "")
        ? stored!.nameBackgroundColor
        : "#08080a",
      nameFontSize: Math.min(32, Math.max(9, stored?.nameFontSize ?? 12)),
      motion: (["walls", "floor", "parade", "corners"] as const).includes(stored?.motion as any)
        ? stored!.motion
        : "floor",
      direction: (["left", "right"] as const).includes(stored?.direction as any)
        ? stored!.direction
        : "left",
      gravity: Math.min(2400, Math.max(100, stored?.gravity ?? 900)),
      size: Math.min(100, Math.max(24, stored?.size ?? 40)),
      speed: stored?.speed ?? 180,
      lifetimeSeconds: stored?.lifetimeSeconds ?? 12,
      maxVisible: stored?.maxVisible ?? 20,
      blacklist: Array.isArray(stored?.blacklist)
        ? stored.blacklist.filter((name) => /^[a-z0-9_]{1,25}$/i.test(name)).slice(0, 100)
        : [],
      additionalEmotes: Array.isArray(stored?.additionalEmotes)
        ? stored.additionalEmotes.filter((name) => /^[a-z0-9_]{1,64}$/i.test(name)).slice(0, 100)
        : [],
    };
  })(),
  ...studio,
  activity: [],
  undoStack: [],
  redoStack: [],
  twitchConnected: false,
};

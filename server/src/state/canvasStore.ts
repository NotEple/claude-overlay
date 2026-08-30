import { getStudioData } from "../db/index.js";
import type { ActivityItem, CanvasState, DrawStroke, DvdCelebrationSettings, ElementPreset, OverlayTrigger, SavedScene, SoundboardItem } from "../types.js";

export interface CanvasSnapshot { elements: CanvasState['elements']; strokes: DrawStroke[]; }

export interface CanvasStore {
  canvasState: CanvasState;
  drawStrokes: DrawStroke[];
  dvdCelebrationSettings: DvdCelebrationSettings;
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
  ...studio,
  activity: [],
  undoStack: [],
  redoStack: [],
  twitchConnected: false,
};

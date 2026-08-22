import type { CanvasState, DrawStroke, DvdCelebrationSettings } from "../types.js";

export interface CanvasStore {
  canvasState: CanvasState;
  drawStrokes: DrawStroke[];
  dvdCelebrationSettings: DvdCelebrationSettings;
}

export const canvasStore: CanvasStore = {
  canvasState: { elements: [] },
  drawStrokes: [],
  dvdCelebrationSettings: {
    volume: 0.25,
    soundUrl: null,
    counterPosition: "top-right",
  },
};

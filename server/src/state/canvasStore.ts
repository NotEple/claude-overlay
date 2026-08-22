import type { CanvasState, DrawStroke } from "../types.js";

export interface CanvasStore {
  canvasState: CanvasState;
  drawStrokes: DrawStroke[];
}

export const canvasStore: CanvasStore = {
  canvasState: { elements: [] },
  drawStrokes: [],
};

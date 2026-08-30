import type { CanvasElement, DrawStroke, MediaControlPayload } from "../types.js";

const MEDIA_TYPES = new Set(["image", "gif", "video", "audio", "text"]);
const UPDATE_KEYS = new Set<keyof CanvasElement>([
  "src", "x", "y", "width", "height", "rotation", "scaleX", "scaleY",
  "visible", "zIndex", "groupId", "mediaCurrentTime", "mediaPaused", "mediaVolume",
  "autoVisibility",
  "dvdEnabled", "dvdStartedAt", "dvdStartX", "dvdStartY", "dvdVelocityX", "dvdVelocityY",
  "locked", "opacity", "enterAnimation", "exitAnimation",
  "flyStartedAt", "flyDurationMs", "flyFromX", "flyFromY", "flyToX", "flyToY",
]);
const ANIMATIONS = new Set(["none", "fade", "pop", "slide-left", "slide-right", "slide-up", "slide-down", "spin"]);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const boundedString = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

export function validElement(element: CanvasElement): boolean {
  return !!element && boundedString(element.id, 100) && MEDIA_TYPES.has(element.type)
    && boundedString(element.src, 10_000)
    && finite(element.x) && finite(element.y)
    && finite(element.width) && element.width > 0 && element.width <= 10_000
    && finite(element.height) && element.height > 0 && element.height <= 10_000
    && finite(element.rotation) && finite(element.scaleX) && finite(element.scaleY)
    && typeof element.visible === "boolean" && finite(element.zIndex)
    && (element.autoVisibility === undefined || typeof element.autoVisibility === "boolean")
    && (element.dvdEnabled === undefined || typeof element.dvdEnabled === "boolean")
    && (element.locked === undefined || typeof element.locked === "boolean")
    && (element.opacity === undefined || (finite(element.opacity) && element.opacity >= 0 && element.opacity <= 1))
    && (element.enterAnimation === undefined || ANIMATIONS.has(element.enterAnimation))
    && (element.exitAnimation === undefined || ANIMATIONS.has(element.exitAnimation))
    && [element.dvdStartedAt, element.dvdStartX, element.dvdStartY, element.dvdVelocityX, element.dvdVelocityY,
      element.flyStartedAt, element.flyDurationMs, element.flyFromX, element.flyFromY, element.flyToX, element.flyToY]
      .every((value) => value === undefined || finite(value));
}

export function validElementUpdate(changes: Partial<CanvasElement>): boolean {
  if (!changes || typeof changes !== "object") return false;
  const keys = Object.keys(changes) as Array<keyof CanvasElement>;
  if (keys.length === 0 || keys.some((key) => !UPDATE_KEYS.has(key))) return false;
  const candidate = changes as Record<string, unknown>;
  if ("src" in candidate && !boundedString(candidate.src, 10_000)) return false;
  for (const key of ["x", "y", "rotation", "scaleX", "scaleY", "zIndex", "mediaCurrentTime"] as const) {
    if (key in candidate && !finite(candidate[key])) return false;
  }
  for (const key of ["width", "height"] as const) {
    if (key in candidate && (!finite(candidate[key]) || (candidate[key] as number) <= 0 || (candidate[key] as number) > 10_000)) return false;
  }
  if ("visible" in candidate && typeof candidate.visible !== "boolean") return false;
  if ("mediaPaused" in candidate && typeof candidate.mediaPaused !== "boolean") return false;
  if ("autoVisibility" in candidate && typeof candidate.autoVisibility !== "boolean") return false;
  if ("dvdEnabled" in candidate && typeof candidate.dvdEnabled !== "boolean") return false;
  if ("locked" in candidate && typeof candidate.locked !== "boolean") return false;
  if ("opacity" in candidate && (!finite(candidate.opacity) || (candidate.opacity as number) < 0 || (candidate.opacity as number) > 1)) return false;
  if ("enterAnimation" in candidate && !ANIMATIONS.has(candidate.enterAnimation as string)) return false;
  if ("exitAnimation" in candidate && !ANIMATIONS.has(candidate.exitAnimation as string)) return false;
  for (const key of ["dvdStartedAt", "dvdStartX", "dvdStartY", "dvdVelocityX", "dvdVelocityY", "flyStartedAt", "flyDurationMs", "flyFromX", "flyFromY", "flyToX", "flyToY"] as const) {
    if (key in candidate && !finite(candidate[key])) return false;
  }
  if ("mediaVolume" in candidate && (!finite(candidate.mediaVolume) || (candidate.mediaVolume as number) < 0 || (candidate.mediaVolume as number) > 1)) return false;
  if ("groupId" in candidate && candidate.groupId !== null && candidate.groupId !== undefined && !boundedString(candidate.groupId, 100)) return false;
  return true;
}

export function validStroke(stroke: DrawStroke): boolean {
  if (!stroke || !boundedString(stroke.id, 100) || !boundedString(stroke.color, 32)) return false;
  if (!Array.isArray(stroke.points) || stroke.points.length > 20_000) return false;
  if (!finite(stroke.size) || stroke.size < 0 || stroke.size > 200 || typeof stroke.eraser !== "boolean") return false;
  if (!stroke.points.every((point) => Array.isArray(point) && point.length === 2 && finite(point[0]) && finite(point[1]))) return false;
  if (stroke.fillX !== undefined && !finite(stroke.fillX)) return false;
  if (stroke.fillY !== undefined && !finite(stroke.fillY)) return false;
  return true;
}

export function validMediaControl(payload: MediaControlPayload): boolean {
  return !!payload && boundedString(payload.id, 100)
    && ["play", "pause", "seek"].includes(payload.action)
    && finite(payload.currentTime) && payload.currentTime >= 0;
}

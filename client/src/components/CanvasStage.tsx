/**
 * CanvasStage — DOM-based canvas.
 *
 * Key design decisions:
 * - DOM elements, no canvas library
 * - Left-drag on background = pan OR marquee select
 * - Left-drag on element = move (all selected move together)
 * - Dedicated top-center rotation handle
 * - 8 resize handles: corners + edges; drag past 0 flips via negative scaleX/scaleY
 * - Video: transparent drag overlay captures mousedown before video does
 * - Groups: elements with same groupId are selected/moved together
 * - Double-click text = edit via callback
 * - Overlay: rAF lerp animation, zero React re-renders during motion
 * - draggingRef prevents React from overwriting DOM positions for group members mid-drag
 */

import {
  useRef,
  useState,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import type {
  CanvasElement,
  CursorPayload,
  DrawStroke,
  MediaControlPayload,
  DvdCelebrationSettings,
  FlyDirection,
} from "../types";
import { renderAction } from "./DrawingCanvas";
import { renderToStaticMarkup } from "react-dom/server";
import {
  X,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  Image as ImageIcon,
  Images,
  FileAudio,
  Film,
  Type as TypeIcon,
  Group as GroupIcon,
  Maximize2,
  Expand,
  Disc,
  FlipHorizontal2,
  FlipVertical2,
  RefreshCw,
  RotateCw,
  Lock,
  Unlock,
  Pencil,
  Play,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { LiveCursors } from "./LiveCursors";
import {
  STREAM_W,
  STREAM_H,
  WORKSPACE_W,
  WORKSPACE_H,
  STREAM_OFFSET_X,
  STREAM_OFFSET_Y,
  parseTextSrc,
  getFileLabel,
} from "../canvas/config";
import {
  getScale,
  setScale,
  getRotation,
  setRotation,
  applyNodeTransform,
} from "../canvas/elementTransforms";
import { createDvdMotion, getDvdPosition } from "../canvas/dvdMotion";
import { DvdCelebrationControls } from "./DvdCelebrationControls";
import { useToast } from "./ToastProvider";
import { randomUUID } from "../utils";

/** Renders a Lucide icon to an SVG string for use in imperatively-built DOM nodes. */
function iconHTML(Icon: LucideIcon, size = 14): string {
  return renderToStaticMarkup(<Icon size={size} strokeWidth={2} />);
}

function animationFrames(name: CanvasElement['enterAnimation']): Keyframe[] {
  const end = { opacity: 1, transform: 'translate(0, 0) scale(1) rotate(0deg)' };
  const starts: Record<string, Keyframe> = {
    fade: { opacity: 0 }, pop: { opacity: 0, transform: 'scale(.55)' },
    'slide-left': { opacity: 0, transform: 'translateX(-80px)' }, 'slide-right': { opacity: 0, transform: 'translateX(80px)' },
    'slide-up': { opacity: 0, transform: 'translateY(-80px)' }, 'slide-down': { opacity: 0, transform: 'translateY(80px)' },
    spin: { opacity: 0, transform: 'scale(.65) rotate(-180deg)' }, none: end,
  };
  return [starts[name ?? 'fade'] ?? starts.fade, end];
}

function effectAnimationFrames(name: CanvasElement['effectAnimation']): Keyframe[] {
  if (name === 'pulse') return [
    { transform: 'scale(1)' },
    { transform: 'scale(1.18)' },
    { transform: 'scale(1)' },
  ];
  if (name === 'spin') return [
    { transform: 'rotate(0deg)' },
    { transform: 'rotate(360deg)' },
  ];
  if (name === 'shake') return [
    { transform: 'translateX(0)' },
    { transform: 'translateX(-16px) rotate(-2deg)' },
    { transform: 'translateX(14px) rotate(2deg)' },
    { transform: 'translateX(-10px) rotate(-1deg)' },
    { transform: 'translateX(8px) rotate(1deg)' },
    { transform: 'translateX(0)' },
  ];
  return [
    { opacity: 0, transform: 'scale(.4)' },
    { opacity: 1, transform: 'scale(1.12)', offset: 0.72 },
    { opacity: 1, transform: 'scale(1)' },
  ];
}

function playRequestedEffect(node: HTMLElement, element: CanvasElement) {
  if (!element.effectAnimation || !element.effectStartedAt) return;
  const key = element.effectId ?? `${element.effectAnimation}:${element.effectStartedAt}`;
  if (node.dataset.effectAnimation === key) return;
  node.dataset.effectAnimation = key;
  const duration = Math.max(150, Math.min(10_000, element.effectDurationMs ?? 700));
  if (Date.now() - element.effectStartedAt > duration + 1500) return;
  const surface = node.querySelector<HTMLElement>('.element-content') ?? node.firstElementChild as HTMLElement | null;
  surface?.animate(effectAnimationFrames(element.effectAnimation), {
    duration,
    easing: element.effectAnimation === 'shake' ? 'ease-in-out' : 'cubic-bezier(.2,.8,.2,1)',
  });
}

// ---------------------------------------------------------------------------
// 8-handle resize with proper flip/stretch
// ---------------------------------------------------------------------------
type HandlePos = "tl" | "tc" | "tr" | "ml" | "mr" | "bl" | "bc" | "br";

const HANDLE_CURSORS: Record<HandlePos, string> = {
  tl: "nw-resize",
  tc: "n-resize",
  tr: "ne-resize",
  ml: "w-resize",
  mr: "e-resize",
  bl: "sw-resize",
  bc: "s-resize",
  br: "se-resize",
};
const HANDLE_POSITIONS: Record<HandlePos, string> = {
  tl: "top:0;left:0;transform:translate(-50%,-50%)",
  tc: "top:0;left:50%;transform:translate(-50%,-50%)",
  tr: "top:0;right:0;transform:translate(50%,-50%)",
  ml: "top:50%;left:0;transform:translate(-50%,-50%)",
  mr: "top:50%;right:0;transform:translate(50%,-50%)",
  bl: "bottom:0;left:0;transform:translate(-50%,50%)",
  bc: "bottom:0;left:50%;transform:translate(-50%,50%)",
  br: "bottom:0;right:0;transform:translate(50%,50%)",
};

function addResizeHandle(
  container: HTMLElement,
  pos: HandlePos,
  getZoom: () => number,
  onUpdate: (changes: Partial<CanvasElement>) => void,
  canResize: () => boolean = () => true,
) {
  const btn = document.createElement("div");
  btn.className = `rh rh-${pos}`;
  btn.style.cssText = `
    position:absolute;${HANDLE_POSITIONS[pos]};
    width:10px;height:10px;background:white;border:1.5px solid var(--accent-border);
    border-radius:2px;cursor:${HANDLE_CURSORS[pos]};z-index:20;display:none;touch-action:none;
  `;

  btn.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (!canResize()) return;
    e.stopPropagation();
    e.preventDefault();
    // Keep all resize events targeted at this handle even when the pointer
    // crosses Twitch's cross-origin iframe. Without capture, the iframe eats
    // mousemove/mouseup and leaves the resize interaction stuck.
    btn.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = container.offsetWidth;
    const startH = container.offsetHeight;
    const startScale = getScale(container);
    const startSignX = startScale.x < 0 ? -1 : 1;
    const startSignY = startScale.y < 0 ? -1 : 1;
    const startLeft = parseFloat(container.style.left) || 0;
    const startTop = parseFloat(container.style.top) || 0;
    const startRotation = (getRotation(container) * Math.PI) / 180;
    const cos = Math.cos(startRotation);
    const sin = Math.sin(startRotation);
    const startCenterX = startLeft + startW / 2;
    const startCenterY = startTop + startH / 2;
    let lastEmit = 0;
    let pendingChanges: Partial<CanvasElement> | null = null;
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const zoom = getZoom();
      const screenDx = (ev.clientX - startX) / zoom;
      const screenDy = (ev.clientY - startY) / zoom;
      // Resize in the element's own coordinate system. Applying screen-space
      // deltas directly makes a 90°-rotated element resize sideways, and also
      // moves the supposedly fixed opposite handle.
      const dx = screenDx * cos + screenDy * sin;
      const dy = -screenDx * sin + screenDy * cos;

      // All 8 handles: pure resize (change width/height, anchor opposite edge/corner).
      // Scale is always reset to ±1 so any prior stretch is cleared on resize.
      let newW = startW,
        newH = startH;
      let newLeft = startLeft,
        newTop = startTop;
      let newSX = startSignX,
        newSY = startSignY;

      const hasRight = pos === "tr" || pos === "mr" || pos === "br";
      const hasLeft = pos === "tl" || pos === "ml" || pos === "bl";

      if (hasRight) {
        const rightEdge = startLeft + startW + dx;
        if (rightEdge >= startLeft) {
          newW = Math.max(1, rightEdge - startLeft);
          newLeft = startLeft;
          newSX = startSignX;
        } else {
          newW = Math.max(1, startLeft - rightEdge);
          newLeft = rightEdge;
          newSX = -startSignX;
        }
      } else if (hasLeft) {
        const rightEdge = startLeft + startW;
        const leftEdge = startLeft + dx;
        if (leftEdge <= rightEdge) {
          newW = Math.max(1, rightEdge - leftEdge);
          newLeft = leftEdge;
          newSX = startSignX;
        } else {
          newW = Math.max(1, leftEdge - rightEdge);
          newLeft = rightEdge;
          newSX = -startSignX;
        }
      }

      const hasBottom = pos === "bl" || pos === "bc" || pos === "br";
      const hasTop = pos === "tl" || pos === "tc" || pos === "tr";

      if (hasBottom) {
        const bottomEdge = startTop + startH + dy;
        if (bottomEdge >= startTop) {
          newH = Math.max(1, bottomEdge - startTop);
          newTop = startTop;
          newSY = startSignY;
        } else {
          newH = Math.max(1, startTop - bottomEdge);
          newTop = bottomEdge;
          newSY = -startSignY;
        }
      } else if (hasTop) {
        const bottomEdge = startTop + startH;
        const topEdge = startTop + dy;
        if (topEdge <= bottomEdge) {
          newH = Math.max(1, bottomEdge - topEdge);
          newTop = topEdge;
          newSY = startSignY;
        } else {
          newH = Math.max(1, topEdge - bottomEdge);
          newTop = bottomEdge;
          newSY = -startSignY;
        }
      }

      // The calculations above describe the resized box in its unrotated local
      // space. Rotate its center displacement back into workspace coordinates
      // so the opposite edge/corner remains visually anchored.
      const localCenterShiftX = newLeft + newW / 2 - startCenterX;
      const localCenterShiftY = newTop + newH / 2 - startCenterY;
      const centerX =
        startCenterX + localCenterShiftX * cos - localCenterShiftY * sin;
      const centerY =
        startCenterY + localCenterShiftX * sin + localCenterShiftY * cos;
      newLeft = centerX - newW / 2;
      newTop = centerY - newH / 2;

      container.style.width = newW + "px";
      container.style.height = newH + "px";
      container.style.left = newLeft + "px";
      container.style.top = newTop + "px";
      setScale(container, newSX, newSY);
      applyNodeTransform(container);
      const changes = {
        x: newLeft,
        y: newTop,
        width: newW,
        height: newH,
        scaleX: newSX,
        scaleY: newSY,
      };
      pendingChanges = changes;
      const now = Date.now();
      if (now - lastEmit > 16) {
        lastEmit = now;
        onUpdate(changes);
        pendingChanges = null;
      }
    };

    let finished = false;
    const finish = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId || finished) return;
      finished = true;
      btn.removeEventListener("pointermove", onMove);
      btn.removeEventListener("pointerup", finish);
      btn.removeEventListener("pointercancel", finish);
      btn.removeEventListener("lostpointercapture", finish);
      if (pendingChanges) onUpdate(pendingChanges);
      if (btn.hasPointerCapture(e.pointerId)) {
        btn.releasePointerCapture(e.pointerId);
      }

    };
    btn.addEventListener("pointermove", onMove);
    btn.addEventListener("pointerup", finish);
    btn.addEventListener("pointercancel", finish);
    btn.addEventListener("lostpointercapture", finish);
  });

  container.appendChild(btn);
  return btn;
}

function addRotationHandle(
  container: HTMLElement,
  onUpdate: (changes: Partial<CanvasElement>) => void,
  canRotate: () => boolean = () => true,
  onStart?: () => void,
  onEnd?: () => void,
  getPivot?: () => { x: number; y: number } | null,
  onGroupRotate?: (deltaDegrees: number) => void,
) {
  const handle = document.createElement("div");
  handle.className = "rh rotation-handle";
  handle.title = "Drag to rotate · Hold Shift to snap to 15° increments";
  handle.setAttribute("role", "button");
  handle.setAttribute("aria-label", "Rotate element");
  handle.style.cssText =
    "position:absolute;top:-38px;left:50%;transform:translateX(-50%);" +
    "width:18px;height:18px;display:none;align-items:center;justify-content:center;" +
    "box-sizing:border-box;border:1.5px solid var(--accent-border);border-radius:50%;" +
    "background:#fff;color:#303038;cursor:grab;z-index:22;touch-action:none;" +
    "box-shadow:0 1px 4px rgba(0,0,0,.45);";
  handle.innerHTML = iconHTML(RotateCw, 11);

  const connector = document.createElement("span");
  connector.style.cssText =
    "position:absolute;left:50%;top:16px;width:1.5px;height:22px;" +
    "transform:translateX(-50%);background:var(--accent-border);pointer-events:none;z-index:-1;";
  handle.appendChild(connector);

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !canRotate()) return;
    event.preventDefault();
    event.stopPropagation();
    handle.style.cursor = "grabbing";
    handle.setPointerCapture(event.pointerId);
    onStart?.();

    const rect = container.getBoundingClientRect();
    const pivot = getPivot?.();
    const centerX = pivot?.x ?? rect.left + rect.width / 2;
    const centerY = pivot?.y ?? rect.top + rect.height / 2;
    const startRotation = getRotation(container);
    const startAngle = Math.atan2(
      event.clientY - centerY,
      event.clientX - centerX,
    );
    let pending: Partial<CanvasElement> | null = null;
    let lastEmit = 0;

    const move = (moveEvent: PointerEvent) => {
      const angle = Math.atan2(
        moveEvent.clientY - centerY,
        moveEvent.clientX - centerX,
      );
      let rotation =
        startRotation + ((angle - startAngle) * 180) / Math.PI;
      if (moveEvent.shiftKey) rotation = Math.round(rotation / 15) * 15;
      const delta = rotation - startRotation;
      if (onGroupRotate && pivot) {
        onGroupRotate(delta);
      } else {
        setRotation(container, rotation);
        applyNodeTransform(container);
        pending = { rotation };
      }
      const now = Date.now();
      if (pending && now - lastEmit >= 16) {
        lastEmit = now;
        onUpdate(pending);
        pending = null;
      }
    };
    const finish = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      if (handle.hasPointerCapture(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
      handle.style.cursor = "grab";
      if (pending) onUpdate(pending);
      onEnd?.();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  });

  container.appendChild(handle);
  return handle;
}

// ---------------------------------------------------------------------------
// makeDraggable — move
// ---------------------------------------------------------------------------
function makeDraggable(
  el: HTMLElement,
  getZoom: () => number,
  onUpdate: (changes: Partial<CanvasElement>) => void,
  onGroupDrag: (dx: number, dy: number, final: boolean) => void,
  onDblClick: (() => void) | null,
  options: {
    onDragStart?: () => void;
    onDragEnd?: () => void;
    onSnapGuides?: (guideX?: number, guideY?: number) => void;
    canInteract?: () => boolean;
  } = {},
) {
  el.addEventListener(
    "mousedown",
    (e) => {
      if (options.canInteract && !options.canInteract()) return;
      if ((e.target as HTMLElement).classList.contains("rh")) return;
      const eventTarget = e.target as HTMLElement;
      const targetVideo = eventTarget.closest("video");
      if (eventTarget.closest("button, input, audio, .rh")) return;
      // Native video controls live in the bottom strip. Leave that area fully
      // interactive; the rest of the video supports click-to-play or
      // movement-threshold dragging.
      if (targetVideo) {
        const videoRect = targetVideo.getBoundingClientRect();
        if (e.clientY >= videoRect.bottom - Math.min(48, videoRect.height * 0.3)) return;
      }

      if (e.button !== 0) return;

      if (!targetVideo) e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const startLeft = parseFloat(el.style.left) || 0;
      const startTop = parseFloat(el.style.top) || 0;
      let didDrag = false;
      let dragLastEmit = 0;
      let dragPending: Partial<CanvasElement> | null = null;
      let lastDx = 0;
      let lastDy = 0;

      const onMove = (ev: MouseEvent) => {
        const zoom = getZoom();
        const dx = (ev.clientX - startX) / zoom;
        const dy = (ev.clientY - startY) / zoom;
        if (!didDrag && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
          didDrag = true;
          ev.preventDefault();
          options.onDragStart?.();
        }
        if (!didDrag) return;

        const snapped = ev.altKey
          ? {
              x: startLeft + dx,
              y: startTop + dy,
              guideX: undefined,
              guideY: undefined,
            }
          : snapToStream(
              startLeft + dx,
              startTop + dy,
              el.offsetWidth,
              el.offsetHeight,
              10 / zoom,
            );
        lastDx = snapped.x - startLeft;
        lastDy = snapped.y - startTop;
        el.style.left = snapped.x + "px";
        el.style.top = snapped.y + "px";
        options.onSnapGuides?.(snapped.guideX, snapped.guideY);
        const ch = { x: snapped.x, y: snapped.y };
        dragPending = ch;
        const now = Date.now();
        // The DOM already moves every pointer event. State/socket updates only
        // need a modest cadence; flooding them creates an echo backlog that can
        // continue moving grouped elements after the pointer is released.
        if (now - dragLastEmit > 50) {
          dragLastEmit = now;
          onUpdate(ch);
          dragPending = null;
        }
        onGroupDrag(lastDx, lastDy, false);
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);

        if (didDrag) {
          if (dragPending) {
            onUpdate(dragPending);
            dragPending = null;
          }
          onGroupDrag(lastDx, lastDy, true);
          options.onSnapGuides?.();
          options.onDragEnd?.();

          // Prevent video from toggling play/pause on drag release
          const video = el.querySelector("video");
          if (video) {
            const suppressVideo = (ev2: Event) => {
              ev2.stopImmediatePropagation();
              ev2.preventDefault();
              video.removeEventListener("click", suppressVideo, true);
            };
            video.addEventListener("click", suppressVideo, true);
          }
          // Also suppress on the container level
          const suppressEl = (ev2: MouseEvent) => {
            ev2.stopPropagation();
            el.removeEventListener("click", suppressEl, true);
          };
          el.addEventListener("click", suppressEl, true);
        }
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    true,
  );

  if (onDblClick) {
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      onDblClick();
    });
  }

  el.addEventListener("contextmenu", (e) => e.preventDefault());
}

// ---------------------------------------------------------------------------
// createMediaElement
// ---------------------------------------------------------------------------
function attachMediaListeners(
  media: HTMLMediaElement,
  onMediaEvent: (
    action: "play" | "pause" | "seek",
    currentTime: number,
  ) => void,
  trackNativeSeeking = false,
) {
  // Only track play/pause via events. Seek is emitted directly by UI controls to avoid
  // a re-emit loop (seeked fires asynchronously, potentially after __applyingRemote resets).
  media.addEventListener("play", () => {
    if ((media as any).__applyingRemote) return;
    onMediaEvent("play", media.currentTime);
  });
  media.addEventListener("pause", () => {
    if ((media as any).__applyingRemote) return;
    onMediaEvent("pause", media.currentTime);
  });
  if (trackNativeSeeking) {
    media.addEventListener("seeked", () => {
      const remoteTarget = (media as any).__remoteSeekTarget;
      if (
        typeof remoteTarget === "number" &&
        Math.abs(media.currentTime - remoteTarget) < 0.25
      ) {
        delete (media as any).__remoteSeekTarget;
        return;
      }
      if (!(media as any).__applyingRemote)
        onMediaEvent("seek", media.currentTime);
    });
  }
}

function snapToStream(
  x: number,
  y: number,
  width: number,
  height: number,
  threshold: number,
) {
  const left = STREAM_OFFSET_X;
  const right = STREAM_OFFSET_X + STREAM_W;
  const centerX = STREAM_OFFSET_X + STREAM_W / 2;
  const top = STREAM_OFFSET_Y;
  const bottom = STREAM_OFFSET_Y + STREAM_H;
  const centerY = STREAM_OFFSET_Y + STREAM_H / 2;
  let snappedX = x;
  let snappedY = y;
  let guideX: number | undefined;
  let guideY: number | undefined;

  // Stream guides are contextual to the visible output, not the surrounding
  // workspace. Keep edge snapping available while an element is entering the
  // stream, but disable every stream guide once its box is fully outside.
  const nearOrInsideStream =
    x + width >= left - threshold &&
    x <= right + threshold &&
    y + height >= top - threshold &&
    y <= bottom + threshold;
  if (!nearOrInsideStream) {
    return { x, y, guideX, guideY };
  }

  const xCandidates = [
    { distance: Math.abs(x - left), value: left, guide: left },
    {
      distance: Math.abs(x + width / 2 - centerX),
      value: centerX - width / 2,
      guide: centerX,
    },
    {
      distance: Math.abs(x + width - right),
      value: right - width,
      guide: right,
    },
  ].sort((a, b) => a.distance - b.distance);
  if (xCandidates[0].distance <= threshold) {
    snappedX = xCandidates[0].value;
    guideX = xCandidates[0].guide;
  }

  const yCandidates = [
    { distance: Math.abs(y - top), value: top, guide: top },
    {
      distance: Math.abs(y + height / 2 - centerY),
      value: centerY - height / 2,
      guide: centerY,
    },
    {
      distance: Math.abs(y + height - bottom),
      value: bottom - height,
      guide: bottom,
    },
  ].sort((a, b) => a.distance - b.distance);
  if (yCandidates[0].distance <= threshold) {
    snappedY = yCandidates[0].value;
    guideY = yCandidates[0].guide;
  }

  return { x: snappedX, y: snappedY, guideX, guideY };
}

function createMediaElement(
  el: CanvasElement,
  options: {
    isOverlay?: boolean;
    onMediaEvent?: (
      action: "play" | "pause" | "seek",
      currentTime: number,
    ) => void;
    onMediaReady?: (mediaEl: HTMLMediaElement) => void;
    onVolumeChange?: (vol: number) => void;
    onVisibilityChange?: (visible: boolean) => void;
  } = {},
): HTMLElement {
  const {
    isOverlay = false,
    onMediaEvent,
    onMediaReady,
    onVolumeChange,
    onVisibilityChange,
  } = options;
  const { type, src } = el;

  if (type === "text") {
    const { text, color, fontSize, fontFamily } = parseTextSrc(src);
    const span = document.createElement("span");
    span.textContent = text;
    span.style.cssText = `color:${color};font-size:${fontSize}px;font-family:${fontFamily},sans-serif;
      text-shadow:1px 1px 4px rgba(0,0,0,0.8);white-space:pre-wrap;
      display:block;width:100%;height:100%;word-break:break-word;pointer-events:none;`;
    return span;
  }

  if (type === "image" || type === "gif") {
    const img = document.createElement("img");
    img.src = src;
    img.draggable = false;
    img.style.cssText =
      "width:100%;height:100%;object-fit:contain;pointer-events:none;display:block;";
    return img;
  }

  if (type === "video") {
    const video = document.createElement("video");
    video.src = src;
    video.draggable = false;
    video.volume = el.mediaVolume ?? 0.25;
    video.preload = "auto";

    if (isOverlay) {
      video.style.cssText =
        "width:100%;height:100%;object-fit:contain;display:block;";
      if (el.mediaCurrentTime && el.mediaCurrentTime > 0) {
        video.addEventListener(
          "loadedmetadata",
          () => {
            video.currentTime = el.mediaCurrentTime!;
          },
          { once: true },
        );
      }
      onMediaReady?.(video);
      return video;
    }

    // Dashboard: use the browser player for reliable, accessible playback.
    // Dashboard-only editing surface: drag anywhere above the native control
    // strip, while genuine clicks are forwarded to play/pause below.
    video.controls = true;
    video.style.cssText =
      "width:100%;height:100%;object-fit:contain;display:block;background:transparent;";

    if (onVisibilityChange) {
      video.addEventListener("play", () => onVisibilityChange(true));
      video.addEventListener("ended", () => onVisibilityChange(false));
    }
    if (onMediaEvent) attachMediaListeners(video, onMediaEvent, true);
    onMediaReady?.(video);

    video.addEventListener("loadedmetadata", () => {
      if (el.mediaCurrentTime && el.mediaCurrentTime > 0) {
        (video as any).__remoteSeekTarget = el.mediaCurrentTime;
        video.currentTime = el.mediaCurrentTime;
      }
    });
    video.addEventListener("volumechange", () => {
      const remoteTarget = (video as any).__remoteVolumeTarget;
      if (typeof remoteTarget === "number" && Math.abs(video.volume - remoteTarget) < 0.001) {
        delete (video as any).__remoteVolumeTarget;
        return;
      }
      onVolumeChange?.(video.volume);
    });

    const wrap = document.createElement("div");
    wrap.style.cssText =
      "position:relative;width:100%;height:100%;background:transparent;overflow:hidden;";
    wrap.appendChild(video);

    const dragHandle = document.createElement("div");
    dragHandle.className = "video-drag-handle";
    dragHandle.title = "Drag to move · Use the round handle above the selection to rotate";
    dragHandle.style.cssText =
      "position:absolute;top:0;left:0;right:0;bottom:48px;z-index:2;" +
      "cursor:move;user-select:none;box-sizing:border-box;";
    dragHandle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (video.paused) void video.play().catch(() => {});
      else video.pause();
    });
    wrap.appendChild(dragHandle);
    return wrap;
  }

  if (type === "audio") {
    if (isOverlay) {
      // Audio is handled via hidden elements in OverlayStage — return invisible placeholder
      const placeholder = document.createElement("div");
      placeholder.style.cssText =
        "width:0;height:0;overflow:hidden;pointer-events:none;";
      return placeholder;
    }

    const audio = document.createElement("audio");
    audio.src = src;
    audio.volume = el.mediaVolume ?? 0.25;
    audio.preload = "auto";
    audio.controls = true;
    audio.style.cssText =
      "display:block;width:100%;height:54px;flex-shrink:0;accent-color:var(--accent-border);";
    if (el.mediaCurrentTime && el.mediaCurrentTime > 0) {
      audio.addEventListener(
        "loadedmetadata",
        () => {
          audio.currentTime = el.mediaCurrentTime!;
        },
        { once: true },
      );
    }

    if (onMediaEvent) attachMediaListeners(audio, onMediaEvent, true);
    audio.addEventListener("volumechange", () => {
      const remoteTarget = (audio as any).__remoteVolumeTarget;
      if (typeof remoteTarget === "number" && Math.abs(audio.volume - remoteTarget) < 0.001) {
        delete (audio as any).__remoteVolumeTarget;
        return;
      }
      onVolumeChange?.(audio.volume);
    });
    onMediaReady?.(audio);

    const wrap = document.createElement("div");
    wrap.style.cssText =
      "width:100%;height:100%;min-height:86px;display:flex;flex-direction:column;" +
      "box-sizing:border-box;background:#17171b;border:1px solid #34343c;border-radius:8px;overflow:hidden;";

    const name = el.displayName || getFileLabel(src) || "Audio";
    const label = document.createElement("div");
    label.title = `${name} · Drag to move · Use the round handle above the selection to rotate`;
    label.style.cssText =
      "height:30px;flex-shrink:0;padding:0 10px;box-sizing:border-box;color:#d6d8de;" +
      "font:600 11px Inter,sans-serif;display:flex;align-items:center;gap:6px;cursor:move;" +
      "background:#202027;border-bottom:1px solid #34343c;user-select:none;";
    const labelIcon = document.createElement("span");
    labelIcon.innerHTML = iconHTML(FileAudio, 12);
    labelIcon.style.cssText = "display:flex;flex-shrink:0;";
    const labelText = document.createElement("span");
    labelText.className = "media-name";
    labelText.textContent = name;
    labelText.style.cssText =
      "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    label.appendChild(labelIcon);
    label.appendChild(labelText);

    wrap.appendChild(label);
    wrap.appendChild(audio);
    return wrap;
  }

  return document.createElement("div");
}

// ---------------------------------------------------------------------------
// Layers panel
// ---------------------------------------------------------------------------
type LayerSlot =
  | { kind: "element"; el: CanvasElement }
  | { kind: "group"; groupId: string; members: CanvasElement[] };

function buildSlots(elements: CanvasElement[]): LayerSlot[] {
  const sorted = [...elements].sort((a, b) => b.zIndex - a.zIndex);
  const slots: LayerSlot[] = [];
  const seen = new Set<string>();
  for (const el of sorted) {
    if (el.groupId) {
      if (!seen.has(el.groupId)) {
        seen.add(el.groupId);
        const members = elements
          .filter((e) => e.groupId === el.groupId)
          .sort((a, b) => b.zIndex - a.zIndex);
        slots.push({ kind: "group", groupId: el.groupId, members });
      }
    } else {
      slots.push({ kind: "element", el });
    }
  }
  return slots;
}

function applySlotOrder(
  slots: LayerSlot[],
  onElementChange: (id: string, changes: Partial<CanvasElement>) => void,
) {
  const total = slots.reduce(
    (n, s) => n + (s.kind === "element" ? 1 : s.members.length),
    0,
  );
  let z = total * 100;
  for (const slot of slots) {
    if (slot.kind === "element") {
      onElementChange(slot.el.id, { zIndex: z });
      z -= 100;
    } else {
      for (const m of slot.members) {
        onElementChange(m.id, { zIndex: z });
        z -= 100;
      }
    }
  }
}

export function ElementPanel({
  elements,
  selectedIds,
  onSelect,
  onToggleVisible,
  onDelete,
  onGroup,
  onUngroup,
  onElementChange,
  dvdCelebrationSettings,
  dvdSoundUploading,
  onDvdSettingsChange,
  onDvdSoundUpload,
  footer,
}: {
  elements: CanvasElement[];
  selectedIds: Set<string>;
  onSelect: (id: string, multi: boolean) => void;
  onToggleVisible: (id: string) => void;
  onDelete: (id: string) => void;
  onGroup: () => void;
  onUngroup: () => void;
  onElementChange: (id: string, changes: Partial<CanvasElement>) => void;
  dvdCelebrationSettings: DvdCelebrationSettings;
  dvdSoundUploading: boolean;
  onDvdSettingsChange: (settings: DvdCelebrationSettings) => void;
  onDvdSoundUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  footer?: React.ReactNode;
}) {
  type SelectedAnimation = "slide-lr" | "slide-rl" | "slide-tb" | "slide-bt" | "pop" | "pulse" | "spin" | "shake";
  const [layerSearch, setLayerSearch] = useState("");
  const [selectedAnimation, setSelectedAnimation] = useState<SelectedAnimation>("slide-lr");
  const [animationDuration, setAnimationDuration] = useState(3);
  const animationTimersRef = useRef(new Map<string, number>());
  const toast = useToast();
  const slots = buildSlots(elements);
  const normalizedSearch = layerSearch.trim().toLowerCase();
  const visibleSlots = slots
    .map((slot, originalIndex) => ({ slot, originalIndex }))
    .filter(({ slot }) => {
      if (!normalizedSearch) return true;
      const members = slot.kind === "element" ? [slot.el] : slot.members;
      const groupName = slot.kind === "group" ? slot.members[0]?.groupName ?? "group" : "";
      return [groupName, ...members.map((element) =>
        element.type === "text"
          ? parseTextSrc(element.src).text
          : element.displayName || getFileLabel(element.src) || element.type,
      )].some((value) => value.toLowerCase().includes(normalizedSearch));
    });
  const icon = (t: string) => {
    const Icon =
      t === "image"
        ? ImageIcon
        : t === "gif"
          ? Images
          : t === "audio"
            ? FileAudio
            : t === "video"
              ? Film
              : TypeIcon;
    return <Icon size={12} strokeWidth={2} />;
  };
  const anyGrouped = [...selectedIds].some(
    (id) => elements.find((e) => e.id === id)?.groupId,
  );
  const canGroup = selectedIds.size >= 2;
  const selectedElement =
    selectedIds.size === 1
      ? elements.find((element) => selectedIds.has(element.id))
      : undefined;

  useEffect(() => () => {
    for (const timer of animationTimersRef.current.values()) window.clearTimeout(timer);
  }, []);

  const playSelectedAnimation = () => {
    if (!selectedElement || !["image", "gif", "video"].includes(selectedElement.type)) return;
    const durationMs = Math.round(Math.max(0.2, Math.min(10, animationDuration)) * 1000);
    const existingTimer = animationTimersRef.current.get(selectedElement.id);
    if (existingTimer) window.clearTimeout(existingTimer);
    if (["pop", "pulse", "spin", "shake"].includes(selectedAnimation)) {
      onElementChange(selectedElement.id, {
        effectAnimation: selectedAnimation as CanvasElement['effectAnimation'],
        effectId: randomUUID(),
        effectStartedAt: Date.now(),
        effectDurationMs: durationMs,
      });
      toast.success(`Playing ${selectedAnimation} on ${selectedElement.displayName || getFileLabel(selectedElement.src) || selectedElement.type}`);
      return;
    }

    const original = {
      x: selectedElement.x,
      y: selectedElement.y,
      visible: selectedElement.visible,
    };
    const horizontal = selectedAnimation === "slide-lr" || selectedAnimation === "slide-rl";
    const forward = selectedAnimation === "slide-lr" || selectedAnimation === "slide-tb";
    const laneX = Math.max(STREAM_OFFSET_X, Math.min(STREAM_OFFSET_X + STREAM_W - selectedElement.width, selectedElement.x));
    const laneY = Math.max(STREAM_OFFSET_Y, Math.min(STREAM_OFFSET_Y + STREAM_H - selectedElement.height, selectedElement.y));
    const fromX = horizontal
      ? (forward ? STREAM_OFFSET_X - selectedElement.width : STREAM_OFFSET_X + STREAM_W)
      : laneX;
    const toX = horizontal
      ? (forward ? STREAM_OFFSET_X + STREAM_W : STREAM_OFFSET_X - selectedElement.width)
      : laneX;
    const fromY = horizontal
      ? laneY
      : (forward ? STREAM_OFFSET_Y - selectedElement.height : STREAM_OFFSET_Y + STREAM_H);
    const toY = horizontal
      ? laneY
      : (forward ? STREAM_OFFSET_Y + STREAM_H : STREAM_OFFSET_Y - selectedElement.height);
    onElementChange(selectedElement.id, {
      visible: true,
      dvdEnabled: false,
      x: fromX,
      y: fromY,
      flyStartedAt: Date.now(),
      flyDurationMs: durationMs,
      flyFromX: fromX,
      flyFromY: fromY,
      flyToX: toX,
      flyToY: toY,
    });
    const timer = window.setTimeout(() => {
      onElementChange(selectedElement.id, {
        ...original,
        flyStartedAt: 0,
        flyDurationMs: 0,
        flyFromX: 0,
        flyFromY: 0,
        flyToX: 0,
        flyToY: 0,
      });
      animationTimersRef.current.delete(selectedElement.id);
    }, durationMs + 50);
    animationTimersRef.current.set(selectedElement.id, timer);
    toast.success("Media slide started on the dashboard and overlay");
  };

  const fitSelectedToStream = (mode: "fit" | "fill") => {
    if (
      !selectedElement ||
      selectedElement.width <= 0 ||
      selectedElement.height <= 0
    )
      return;
    const factor =
      mode === "fit"
        ? Math.min(
            STREAM_W / selectedElement.width,
            STREAM_H / selectedElement.height,
          )
        : Math.max(
            STREAM_W / selectedElement.width,
            STREAM_H / selectedElement.height,
          );
    const width = selectedElement.width * factor;
    const height = selectedElement.height * factor;
    onElementChange(selectedElement.id, {
      x: STREAM_OFFSET_X + (STREAM_W - width) / 2,
      y: STREAM_OFFSET_Y + (STREAM_H - height) / 2,
      width,
      height,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      dvdEnabled: false,
    });
  };

  const toggleDvdMotion = () => {
    if (!selectedElement) return;
    if (selectedElement.dvdEnabled) {
      const position = getDvdPosition(selectedElement);
      onElementChange(selectedElement.id, {
        dvdEnabled: false,
        x: position.x,
        y: position.y,
      });
      return;
    }
    onElementChange(selectedElement.id, createDvdMotion(selectedElement));
  };

  const setDvdSpeed = (speed: number) => {
    if (
      !selectedElement?.dvdEnabled ||
      selectedElement.dvdVelocityX === undefined ||
      selectedElement.dvdVelocityY === undefined
    )
      return;
    const currentSpeed = Math.hypot(
      selectedElement.dvdVelocityX,
      selectedElement.dvdVelocityY,
    );
    if (currentSpeed <= 0) return;
    const position = getDvdPosition(selectedElement);
    const factor = speed / currentSpeed;
    onElementChange(selectedElement.id, {
      x: position.x,
      y: position.y,
      dvdStartX: position.x,
      dvdStartY: position.y,
      dvdStartedAt: Date.now(),
      dvdVelocityX: selectedElement.dvdVelocityX * factor,
      dvdVelocityY: selectedElement.dvdVelocityY * factor,
    });
  };

  const dvdSpeed = selectedElement?.dvdEnabled
    ? Math.round(
        Math.hypot(
          selectedElement.dvdVelocityX ?? 0,
          selectedElement.dvdVelocityY ?? 0,
        ),
      )
    : 0;

  const canFlipSelected = selectedElement && ["image", "gif", "video"].includes(selectedElement.type);
  const flipSelected = (axis: "x" | "y") => {
    if (!selectedElement || !canFlipSelected) return;
    onElementChange(selectedElement.id, axis === "x"
      ? { scaleX: -(selectedElement.scaleX ?? 1) }
      : { scaleY: -(selectedElement.scaleY ?? 1) });
  };

  const moveSlot = (idx: number, dir: "up" | "down") => {
    const arr = [...slots];
    const to = dir === "up" ? idx - 1 : idx + 1;
    if (to < 0 || to >= arr.length) return;
    [arr[idx], arr[to]] = [arr[to], arr[idx]];
    applySlotOrder(arr, onElementChange);
  };

  const moveMember = (
    groupId: string,
    memberId: string,
    dir: "up" | "down",
  ) => {
    const newSlots = slots.map((slot) => {
      if (slot.kind !== "group" || slot.groupId !== groupId) return slot;
      const arr = [...slot.members];
      const idx = arr.findIndex((m) => m.id === memberId);
      const to = dir === "up" ? idx - 1 : idx + 1;
      if (to < 0 || to >= arr.length) return slot;
      [arr[idx], arr[to]] = [arr[to], arr[idx]];
      return { ...slot, members: arr };
    });
    applySlotOrder(newSlots, onElementChange);
  };

  const arrowBtn = (disabled: boolean, label: string, onClick: () => void) => (
    <button
      className="ui-icon-button ui-button--compact"
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      title={`Move layer ${label}`}
      style={{
        background: "none",
        border: "none",
        cursor: disabled ? "default" : "pointer",
        padding: "1px 2px",
        color: disabled ? "#444" : "#999",
        lineHeight: 1,
        display: "block",
      }}
    >
      {label === "up" ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </button>
  );

  const renderRow = (
    el: CanvasElement,
    slotIdx: number,
    inGroup: boolean,
    memberIdx?: number,
    groupId?: string,
    groupSize?: number,
  ) => {
    const sel = selectedIds.has(el.id);
    const label =
      el.type === "text"
        ? parseTextSrc(el.src).text.slice(0, 18) || "Text"
        : (el.displayName || getFileLabel(el.src)).slice(0, 22) || el.type;
    const isTop = inGroup ? memberIdx === 0 : slotIdx === 0;
    const isBottom = inGroup
      ? memberIdx === groupSize! - 1
      : slotIdx === slots.length - 1;
    return (
      <div
        key={el.id}
        onClick={(e) => onSelect(el.id, e.shiftKey || e.metaKey || e.ctrlKey)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 3,
          padding: `4px 6px 4px ${inGroup ? 14 : 8}px`,
          cursor: "pointer",
          background: sel ? "#1e2030" : "transparent",
          borderLeft: sel
            ? "2px solid var(--accent-border)"
            : "2px solid transparent",
        }}
      >
        <span style={{ fontSize: 10 }}>{icon(el.type)}</span>
        <span
          style={{
            fontSize: 11,
            flex: 1,
            color: el.visible ? "#d1d5db" : "#7c8593",
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "Inter,sans-serif",
          }}
        >
          {label}
        </span>
        {el.type !== "text" && (
          <button
            className="ui-icon-button ui-button--compact"
            title="Rename this media in the dashboard"
            aria-label={`Rename ${label}`}
            onClick={(event) => {
              event.stopPropagation();
              const value = window.prompt(
                "Media name",
                el.displayName || getFileLabel(el.src) || el.type,
              )?.trim();
              if (value) onElementChange(el.id, { displayName: value.slice(0, 120) });
            }}
            style={{
              width: 22,
              height: 22,
              padding: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              background: "#1d1d20",
              border: "1px solid #34343a",
              color: "#aeb6c2",
              cursor: "pointer",
            }}
          >
            <Pencil size={11} />
          </button>
        )}
        <div
          style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}
        >
          {arrowBtn(isTop, "up", () =>
            inGroup
              ? moveMember(groupId!, el.id, "up")
              : moveSlot(slotIdx, "up"),
          )}
          {arrowBtn(isBottom, "down", () =>
            inGroup
              ? moveMember(groupId!, el.id, "down")
              : moveSlot(slotIdx, "down"),
          )}
        </div>
        <button
          className="ui-icon-button ui-button--compact"
          title={
            el.visible ? "Hide this layer from OBS" : "Show this layer in OBS"
          }
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisible(el.id);
          }}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "0 2px",
            color: el.visible ? "#999" : "#555",
            flexShrink: 0,
            display: "flex",
          }}
        >
          {el.visible ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <button
          className="ui-icon-button ui-button--compact ui-danger"
          title="Delete this layer. Use Ctrl/Cmd + Z immediately afterward to undo"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(el.id);
          }}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "0 2px",
            color: "#777",
            flexShrink: 0,
            display: "flex",
          }}
        >
          <X size={13} />
        </button>
      </div>
    );
  };

  return (
    <div
      style={{
        width: "var(--sidebar-width)",
        background: "#111",
        borderRight: "1px solid #222",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          padding: "8px 10px 4px",
          fontSize: 10,
          color: "#8b95a5",
          fontWeight: 600,
          borderBottom: "1px solid #1e1e1e",
          fontFamily: "Inter,sans-serif",
          letterSpacing: "0.08em",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>LAYERS</span>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 4 }}>
          {selectedElement && !selectedElement.locked && (
            <span style={{ display: "none" }}>
              <button
                className="ui-button ui-button--compact"
                onClick={() => fitSelectedToStream("fit")}
                title="Fit selected element inside the stream"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  background: "#1e2030",
                  border: "1px solid #334",
                  borderRadius: 3,
                  color: "var(--accent-text)",
                  fontSize: 9,
                  padding: "2px 5px",
                  cursor: "pointer",
                }}
              >
                <Maximize2 size={11} /> Fit
              </button>
              <button
                className="ui-button ui-button--compact"
                onClick={() => fitSelectedToStream("fill")}
                title="Fill the stream with the selected element (edges may crop)"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  background: "#1e2030",
                  border: "1px solid #334",
                  borderRadius: 3,
                  color: "var(--accent-text)",
                  fontSize: 9,
                  padding: "2px 5px",
                  cursor: "pointer",
                }}
              >
                <Expand size={11} /> Fill
              </button>
              {selectedElement.type !== "audio" && (
                <button
                  className="ui-button ui-button--compact"
                  onClick={toggleDvdMotion}
                  title={
                    selectedElement.dvdEnabled
                      ? "Stop DVD motion at its current position"
                      : "Bounce the selected element around inside the stream"
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    background: selectedElement.dvdEnabled
                      ? "var(--accent-surface-strong)"
                      : "#1e2030",
                    border: selectedElement.dvdEnabled
                      ? "1px solid var(--accent-border)"
                      : "1px solid #334",
                    borderRadius: 3,
                    color: selectedElement.dvdEnabled
                      ? "var(--accent-text)"
                      : "#aaa",
                    fontSize: 9,
                    padding: "2px 5px",
                    cursor: "pointer",
                  }}
                >
                  <Disc size={11} /> DVD
                </button>
              )}
              {canFlipSelected && (
                <>
                  <button className="ui-icon-button ui-button--compact" onClick={() => flipSelected("x")} title="Flip selected media left to right" style={{ background: "#1e2030", border: "1px solid #334", color: "var(--accent-text)", cursor: "pointer" }}><FlipHorizontal2 size={12} /></button>
                  <button className="ui-icon-button ui-button--compact" onClick={() => flipSelected("y")} title="Flip selected media top to bottom" style={{ background: "#1e2030", border: "1px solid #334", color: "var(--accent-text)", cursor: "pointer" }}><FlipVertical2 size={12} /></button>
                </>
              )}
            </span>
          )}
          {canGroup && !anyGrouped && (
            <button
              className="ui-button ui-button--compact"
              onClick={onGroup}
              title="Group selected"
              style={{
                background: "#1e2030",
                border: "1px solid #334",
                borderRadius: 3,
                color: "var(--accent-text)",
                fontSize: 9,
                padding: "1px 4px",
                cursor: "pointer",
              }}
            >
              Group
            </button>
          )}
          {anyGrouped && (
            <button
              className="ui-button ui-button--compact ui-danger"
              onClick={onUngroup}
              title="Ungroup"
              style={{
                background: "#1e2030",
                border: "1px solid #334",
                borderRadius: 3,
                color: "#f87171",
                fontSize: 9,
                padding: "1px 4px",
                cursor: "pointer",
              }}
            >
              Ungroup
            </button>
          )}
        </div>
      </div>
      {elements.length > 0 && (
        <div style={{ padding: "6px 8px", borderBottom: "1px solid #1e1e1e" }}>
          <input
            value={layerSearch}
            onChange={(event) => setLayerSearch(event.target.value)}
            placeholder="Search layers…"
            aria-label="Search layers"
            style={{
              width: "100%",
              height: 30,
              boxSizing: "border-box",
              padding: "0 8px",
              border: "1px solid #34343a",
              borderRadius: 5,
              background: "#171719",
              color: "#e1e5eb",
              fontSize: 11,
            }}
          />
        </div>
      )}
      {selectedElement?.dvdEnabled && !selectedElement.locked && (
        <div className="dvd-selected-controls">
        <div
          style={{
            height: 34,
            padding: "5px 9px",
            display: "flex",
            alignItems: "center",
            gap: 7,
            borderBottom: "1px solid #1e1e1e",
            background: "var(--accent-surface)",
            flexShrink: 0,
          }}
        >
          <Disc size={12} color="var(--accent-text)" />
          <span
            style={{
              color: "#aaa",
              fontSize: 10,
              fontFamily: "Inter,sans-serif",
            }}
          >
            Speed
          </span>
          <input
            type="range"
            min="40"
            max="400"
            step="10"
            value={Math.min(400, Math.max(40, dvdSpeed))}
            onChange={(event) => setDvdSpeed(Number(event.target.value))}
            style={{
              minWidth: 0,
              flex: 1,
              accentColor: "var(--accent-border)",
              cursor: "pointer",
            }}
          />
          <span
            style={{
              width: 30,
              color: "var(--accent-text)",
              fontSize: 9,
              fontFamily: "monospace",
              textAlign: "right",
            }}
          >
            {dvdSpeed}
          </span>
        </div>
        <DvdCelebrationControls settings={dvdCelebrationSettings} uploading={dvdSoundUploading} onChange={onDvdSettingsChange} onSoundUpload={onDvdSoundUpload}/>
        </div>
      )}
      {selectedElement && (
        <div style={{ padding: "8px 9px", display: "grid", gap: 7, borderBottom: "1px solid #242424", background: "#151515" }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="ui-button ui-button--compact" onClick={() => onElementChange(selectedElement.id, { locked: !selectedElement.locked })} title={selectedElement.locked ? "Unlock this element for editing" : "Lock this element to prevent accidental movement, resizing, or deletion"} style={{ flex: 1, background: selectedElement.locked ? "var(--accent-surface)" : "#202020", border: `1px solid ${selectedElement.locked ? "var(--accent-border)" : "#3a3a3a"}`, color: selectedElement.locked ? "var(--accent-text)" : "#bec5cf", cursor: "pointer" }}>{selectedElement.locked ? <Unlock size={12}/> : <Lock size={12}/>} {selectedElement.locked ? "Unlock" : "Lock"}</button>
          </div>
          <label style={{ display: "grid", gridTemplateColumns: "52px 1fr 34px", alignItems: "center", gap: 6, color: "#aeb6c2", fontSize: 10 }}><span>Opacity</span><input type="range" min="0" max="1" step="0.05" value={selectedElement.opacity ?? 1} onChange={(event) => onElementChange(selectedElement.id, { opacity: Number(event.target.value) })} style={{ minWidth: 0, accentColor: "var(--accent-border)" }}/><span style={{ textAlign: "right" }}>{Math.round((selectedElement.opacity ?? 1) * 100)}%</span></label>
          {!selectedElement.locked && ["image", "gif", "video"].includes(selectedElement.type) && (
            <div className="selected-media-animation">
              <strong>PLAY ANIMATION</strong>
              <div>
                <select
                  value={selectedAnimation}
                  onChange={(event) => setSelectedAnimation(event.target.value as SelectedAnimation)}
                  title="Choose a one-time animation for this media on both the dashboard and OBS overlay"
                >
                  <option value="slide-lr">Slide left → right</option>
                  <option value="slide-rl">Slide right → left</option>
                  <option value="slide-tb">Slide top → bottom</option>
                  <option value="slide-bt">Slide bottom → top</option>
                  <option value="pop">Pop</option>
                  <option value="pulse">Pulse</option>
                  <option value="spin">Spin</option>
                  <option value="shake">Shake</option>
                </select>
                <label title="Animation duration in seconds">
                  <input
                    type="number"
                    min="0.2"
                    max="10"
                    step="0.1"
                    value={animationDuration}
                    onChange={(event) => setAnimationDuration(Number(event.target.value))}
                    aria-label="Animation duration in seconds"
                  />
                  <span>s</span>
                </label>
                <button className="ui-icon-button" onClick={playSelectedAnimation} title="Play this animation now on the dashboard and OBS overlay">
                  <Play size={13} />
                </button>
              </div>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <label style={{ display: "grid", gap: 3, color: "#8f99a8", fontSize: 9 }}>SHOW<select value={selectedElement.enterAnimation ?? "fade"} onChange={(event) => onElementChange(selectedElement.id, { enterAnimation: event.target.value as CanvasElement['enterAnimation'] })} style={{ height: 28, border: "1px solid #3a3a3a", borderRadius: 4, background: "#1d1d1f", color: "#d5dae2", fontSize: 10 }}>{["none","fade","pop","slide-left","slide-right","slide-up","slide-down","spin"].map(value => <option key={value}>{value}</option>)}</select></label>
            <label style={{ display: "grid", gap: 3, color: "#8f99a8", fontSize: 9 }}>HIDE<select value={selectedElement.exitAnimation ?? "fade"} onChange={(event) => onElementChange(selectedElement.id, { exitAnimation: event.target.value as CanvasElement['exitAnimation'] })} style={{ height: 28, border: "1px solid #3a3a3a", borderRadius: 4, background: "#1d1d1f", color: "#d5dae2", fontSize: 10 }}>{["none","fade","pop","slide-left","slide-right","slide-up","slide-down","spin"].map(value => <option key={value}>{value}</option>)}</select></label>
          </div>
        </div>
      )}
      {!selectedElement && elements.length > 0 && (
        <div className="layer-selection-hint">
          Select a layer to edit opacity, animations, locking, and effects.
        </div>
      )}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {slots.length === 0 && (
          <div
            style={{
              padding: 16,
              fontSize: 11,
              color: "#737d8c",
              textAlign: "center",
              fontFamily: "Inter,sans-serif",
            }}
          >
            No layers yet. Use Add media, Text, Draw, or drag a file onto the workspace.
          </div>
        )}
        {slots.length > 0 && visibleSlots.length === 0 && (
          <div style={{ padding: 16, fontSize: 11, color: "#737d8c", textAlign: "center" }}>
            No layers match “{layerSearch}”.
          </div>
        )}
        {visibleSlots.map(({ slot, originalIndex: slotIdx }) => {
          if (slot.kind === "element") {
            return renderRow(slot.el, slotIdx, false);
          }
          // Group block
          const groupSelected = slot.members.some((m) => selectedIds.has(m.id));
          const allVisible = slot.members.every((m) => m.visible);
          const isTop = slotIdx === 0;
          const isBottom = slotIdx === slots.length - 1;
          return (
            <div
              key={slot.groupId}
              style={{
                margin: "4px 5px",
                border: "1px solid rgba(var(--accent-rgb),0.45)",
                borderRadius: 5,
                background: "rgba(var(--accent-rgb),0.04)",
                overflow: "hidden",
              }}
            >
              {/* Group header row */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  padding: "4px 6px",
                  background: groupSelected
                    ? "rgba(var(--accent-rgb),0.14)"
                    : "rgba(var(--accent-rgb),0.07)",
                  borderBottom: "1px solid rgba(var(--accent-rgb),0.2)",
                }}
              >
                <GroupIcon size={12} color="var(--accent-text)" />
                <span
                  style={{
                    fontSize: 11,
                    flex: 1,
                    color: "var(--accent-text)",
                    fontFamily: "Inter,sans-serif",
                    fontWeight: 600,
                  }}
                >
                  {slot.members[0]?.groupName || "Group"}{" "}
                  <span
                    style={{ color: "#8b95a5", fontWeight: 500, fontSize: 10 }}
                  >
                    ({slot.members.length})
                  </span>
                </span>
                <button
                  className="ui-icon-button ui-button--compact"
                  title="Rename this group"
                  aria-label="Rename group"
                  onClick={(event) => {
                    event.stopPropagation();
                    const value = window.prompt(
                      "Group name",
                      slot.members[0]?.groupName || "Group",
                    )?.trim();
                    if (!value) return;
                    slot.members.forEach((member) =>
                      onElementChange(member.id, {
                        groupName: value.slice(0, 80),
                      }),
                    );
                  }}
                  style={{
                    width: 22,
                    height: 22,
                    padding: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    background: "#1d1d20",
                    border: "1px solid #34343a",
                    color: "var(--accent-text)",
                    cursor: "pointer",
                  }}
                >
                  <Pencil size={11} />
                </button>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    flexShrink: 0,
                  }}
                >
                  {arrowBtn(isTop, "up", () => moveSlot(slotIdx, "up"))}
                  {arrowBtn(isBottom, "down", () => moveSlot(slotIdx, "down"))}
                </div>
                {/* Toggle visibility for all group members */}
                <button
                  className="ui-icon-button ui-button--compact"
                  onClick={(e) => {
                    e.stopPropagation();
                    const target = !allVisible;
                    slot.members.forEach((m) =>
                      onElementChange(m.id, { visible: target }),
                    );
                  }}
                  title={allVisible ? "Hide group" : "Show group"}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "0 2px",
                    color: allVisible ? "var(--accent-text)" : "#555",
                    flexShrink: 0,
                    display: "flex",
                  }}
                >
                  {allVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
              </div>
              {/* Member rows */}
              {slot.members.map((m, mIdx) =>
                renderRow(
                  m,
                  slotIdx,
                  true,
                  mIdx,
                  slot.groupId,
                  slot.members.length,
                ),
              )}
            </div>
          );
        })}
      </div>
      {footer}
      {/* OVER HERE SHOULD BE FINE I THINK */}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Marquee selection
// ---------------------------------------------------------------------------
function useMarquee(
  wrapperRef: React.RefObject<HTMLDivElement | null>,
  workspaceRef: React.RefObject<HTMLDivElement | null>,
  panRef: React.MutableRefObject<{ x: number; y: number }>,
  zoomRef: React.MutableRefObject<number>,
  elements: CanvasElement[],
  onSelectMany: (ids: string[]) => void,
  onClearSelect: () => void,
) {
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const workspace = workspaceRef.current;
    if (!wrapper || !workspace) return;

    const marquee = document.createElement("div");
    marquee.style.cssText =
      "position:absolute;border:1.5px dashed var(--accent-border);background:rgba(var(--accent-rgb),0.08);display:none;z-index:500;box-sizing:border-box;";
    wrapper.appendChild(marquee);

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (
        target !== workspace &&
        !target.classList.contains("viewport-rect") &&
        !target.classList.contains("canvas-interaction-surface")
      )
        return;

      const rect = wrapper.getBoundingClientRect();
      const startScreenX = e.clientX - rect.left;
      const startScreenY = e.clientY - rect.top;
      let didMove = false;

      const onMove = (ev: MouseEvent) => {
        const curX = ev.clientX - rect.left;
        const curY = ev.clientY - rect.top;
        const dx = curX - startScreenX;
        const dy = curY - startScreenY;
        if (!didMove && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        didMove = true;
        const x = Math.min(startScreenX, curX);
        const y = Math.min(startScreenY, curY);
        marquee.style.cssText = marquee.style.cssText.replace(
          /display:[^;]+/,
          "",
        );
        Object.assign(marquee.style, {
          display: "block",
          left: x + "px",
          top: y + "px",
          width: Math.abs(dx) + "px",
          height: Math.abs(dy) + "px",
        });
      };

      const onUp = (ev: MouseEvent) => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        marquee.style.display = "none";

        if (!didMove) {
          onClearSelect();
          return;
        }

        const curX = ev.clientX - rect.left;
        const curY = ev.clientY - rect.top;
        const sx = Math.min(startScreenX, curX);
        const sy = Math.min(startScreenY, curY);
        const sw = Math.abs(curX - startScreenX);
        const sh = Math.abs(curY - startScreenY);

        const z = zoomRef.current;
        const p = panRef.current;
        const wx = (sx - p.x) / z;
        const wy = (sy - p.y) / z;
        const ww = sw / z;
        const wh = sh / z;

        const hit: string[] = [];
        for (const el of elements) {
          if (!el.visible) continue;
          const overlap = !(
            el.x > wx + ww ||
            el.x + el.width < wx ||
            el.y > wy + wh ||
            el.y + el.height < wy
          );
          if (overlap) hit.push(el.id);
        }
        if (hit.length > 0) onSelectMany(hit);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };

    wrapper.addEventListener("mousedown", onDown);
    return () => {
      wrapper.removeEventListener("mousedown", onDown);
      marquee.remove();
    };
  }, [elements, onSelectMany, onClearSelect]);
}

// ---------------------------------------------------------------------------
// Main dashboard canvas
// ---------------------------------------------------------------------------
export interface CanvasStageProps {
  elements: CanvasElement[];
  cursors?: Map<string, CursorPayload>;
  selectedIds: Set<string>;
  onSelect: (id: string | null, multi?: boolean) => void;
  onSelectMany: (ids: string[]) => void;
  onElementChange: (id: string, changes: Partial<CanvasElement>) => void;
  onElementDelete: (id: string) => void;
  onCursorMove?: (x: number, y: number) => void;
  onEditText?: (id: string) => void;
  onMediaControl?: (
    id: string,
    action: MediaControlPayload["action"],
    currentTime: number,
  ) => void;
  /** Ref populated with a function that applies incoming remote media:control events to this stage */
  mediaControlRef?: React.MutableRefObject<
    ((payload: MediaControlPayload) => void) | null
  >;
  /** Ref populated with a function for direct DOM position updates, bypassing React state */
  directUpdateRef?: React.MutableRefObject<
    ((id: string, changes: Partial<CanvasElement>) => void) | null
  >;
  previewFlyRef?: React.MutableRefObject<
    ((id: string, direction: FlyDirection, durationSeconds: number) => boolean) | null
  >;
  showTwitchEmbed?: boolean;
  twitchChannel?: string;
  drawingLayer?: React.ReactNode;
}

export function CanvasStage({
  elements,
  cursors = new Map(),
  selectedIds,
  onSelect,
  onSelectMany,
  onElementChange,
  onElementDelete,
  onCursorMove,
  onEditText,
  onMediaControl,
  mediaControlRef,
  directUpdateRef,
  previewFlyRef,
  showTwitchEmbed = false,
  twitchChannel = "",
  drawingLayer,
}: CanvasStageProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const nodeMapRef = useRef<Map<string, HTMLElement>>(new Map());
  const mediaElMapRef = useRef<Map<string, HTMLMediaElement>>(new Map());
  const dashboardAudioContextRef = useRef<AudioContext | null>(null);
  const dashboardSilencedVideosRef = useRef<WeakSet<HTMLVideoElement>>(new WeakSet());
  const volumeCommitTimersRef = useRef<Map<string, number>>(new Map());
  const groupBoxMapRef = useRef<Map<string, HTMLElement>>(new Map());
  const twitchEmbedRef = useRef<HTMLDivElement>(null);
  const [twitchInteractionEnabled, setTwitchInteractionEnabled] = useState(false);
  const [twitchNeedsReconnect, setTwitchNeedsReconnect] = useState(false);
  const [twitchPlayerGeneration, setTwitchPlayerGeneration] = useState(0);
  const snapXGuideRef = useRef<HTMLDivElement>(null);
  const snapYGuideRef = useRef<HTMLDivElement>(null);
  const twitchInitedRef = useRef(false);
  const twitchPlayerRef = useRef<any>(null);
  const twitchHasPlayedRef = useRef(false);
  const twitchSessionRef = useRef(0);
  const twitchNeedsReconnectRef = useRef(false);
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const [panState, setPanState] = useState({ x: 0, y: 0 });
  const [zoomState, setZoomState] = useState(1);

  // Track which elements are actively being dragged so we don't reset their DOM position
  const draggingRef = useRef<Set<string>>(new Set());

  const selectedIdsRef = useRef(selectedIds);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);
  const elementsRef = useRef(elements);
  useEffect(() => {
    elementsRef.current = elements;
  }, [elements]);

  useEffect(() => {
    twitchNeedsReconnectRef.current = twitchNeedsReconnect;
  }, [twitchNeedsReconnect]);

  useEffect(() => {
    let frame = 0;
    const animateMovingElements = () => {
      const now = Date.now();
      for (const element of elementsRef.current) {
        if (draggingRef.current.has(element.id)) continue;
        const node = nodeMapRef.current.get(element.id);
        if (!node) continue;
        if (
          element.flyStartedAt &&
          element.flyDurationMs &&
          element.flyFromX !== undefined &&
          element.flyFromY !== undefined &&
          element.flyToX !== undefined &&
          element.flyToY !== undefined
        ) {
          const progress = Math.max(
            0,
            Math.min(1, (now - element.flyStartedAt) / element.flyDurationMs),
          );
          node.style.left = `${element.flyFromX + (element.flyToX - element.flyFromX) * progress}px`;
          node.style.top = `${element.flyFromY + (element.flyToY - element.flyFromY) * progress}px`;
        } else if (element.dvdEnabled) {
          const position = getDvdPosition(element, now);
          node.style.left = `${position.x}px`;
          node.style.top = `${position.y}px`;
        }
      }
      frame = requestAnimationFrame(animateMovingElements);
    };
    frame = requestAnimationFrame(animateMovingElements);
    return () => cancelAnimationFrame(frame);
  }, []);

  const getZoom = useCallback(() => zoomRef.current, []);

  const applyTransform = useCallback(() => {
    const p = panRef.current,
      z = zoomRef.current;
    if (workspaceRef.current)
      workspaceRef.current.style.transform = `translate(${p.x}px, ${p.y}px) scale(${z})`;
    setPanState({ ...p });
    setZoomState(z);
  }, []);

  // Fit stream viewport on mount
  const initialized = useRef(false);
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const obs = new ResizeObserver(() => {
      if (initialized.current) return;
      const w = wrapper.clientWidth,
        h = wrapper.clientHeight;
      if (!w || !h) return;
      initialized.current = true;
      const fit = Math.min(w / STREAM_W, h / STREAM_H) * 0.82;
      panRef.current = {
        x: (w - STREAM_W * fit) / 2 - STREAM_OFFSET_X * fit,
        y: (h - STREAM_H * fit) / 2 - STREAM_OFFSET_Y * fit,
      };
      zoomRef.current = fit;
      applyTransform();
    });
    obs.observe(wrapper);
    return () => {
      obs.disconnect();
      initialized.current = false; // reset for React strict-mode remount
    };
  }, [applyTransform]);

  // Scroll to zoom
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = wrapper.getBoundingClientRect();
      const px = e.clientX - rect.left,
        py = e.clientY - rect.top;
      const oldZ = zoomRef.current;
      const ptX = (px - panRef.current.x) / oldZ;
      const ptY = (py - panRef.current.y) / oldZ;
      const newZ = Math.min(
        4,
        Math.max(0.04, oldZ * (e.deltaY < 0 ? 1.08 : 1 / 1.08)),
      );
      panRef.current = { x: px - ptX * newZ, y: py - ptY * newZ };
      zoomRef.current = newZ;
      applyTransform();
    };
    wrapper.addEventListener("wheel", onWheel, { passive: false });
    return () => wrapper.removeEventListener("wheel", onWheel);
  }, [applyTransform]);

  // Middle-mouse pan
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    let panning = false;
    const down = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      panning = true;
    };
    const move = (e: MouseEvent) => {
      if (!panning) return;
      panRef.current = {
        x: panRef.current.x + e.movementX,
        y: panRef.current.y + e.movementY,
      };
      applyTransform();
    };
    const up = (e: MouseEvent) => {
      if (e.button === 1) panning = false;
    };
    wrapper.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      wrapper.removeEventListener("mousedown", down);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [applyTransform]);

  // Keyboard delete
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;
      if ((e.code === "Delete" || e.code === "Backspace") && !inInput) {
        selectedIdsRef.current.forEach((id) => onElementDelete(id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onElementDelete]);

  // Cursor broadcast
  useEffect(() => {
    if (!onCursorMove) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    let lastEmit = 0;
    const onMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastEmit < 33) return; // ~30fps
      lastEmit = now;
      const rect = wrapper.getBoundingClientRect();
      onCursorMove(
        (e.clientX - rect.left - panRef.current.x) / zoomRef.current,
        (e.clientY - rect.top - panRef.current.y) / zoomRef.current,
      );
    };
    wrapper.addEventListener("mousemove", onMove);
    return () => wrapper.removeEventListener("mousemove", onMove);
  }, [onCursorMove]);

  useMarquee(
    wrapperRef,
    workspaceRef,
    panRef,
    zoomRef,
    elements,
    onSelectMany,
    () => onSelect(null),
  );

  // Sync DOM elements
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const nodeMap = nodeMapRef.current;
    const mediaElMap = mediaElMapRef.current;
    const presentIds = new Set(elements.map((e) => e.id));

    if (previewFlyRef) {
      previewFlyRef.current = (id, direction, durationSeconds) => {
        const node = nodeMap.get(id);
        const element = elementsRef.current.find((item) => item.id === id);
        if (!node || !element) return false;
        const [movement, lane] = direction.split(
          /-(?=top$|center$|bottom$|left$|right$)/,
        ) as [string, string];
        const horizontal =
          movement === "left-to-right" || movement === "right-to-left";
        const laneX =
          lane === "left"
            ? STREAM_OFFSET_X
            : lane === "right"
              ? STREAM_OFFSET_X + STREAM_W - element.width
              : STREAM_OFFSET_X + (STREAM_W - element.width) / 2;
        const laneY =
          lane === "top"
            ? STREAM_OFFSET_Y
            : lane === "bottom"
              ? STREAM_OFFSET_Y + STREAM_H - element.height
              : STREAM_OFFSET_Y + (STREAM_H - element.height) / 2;
        let fromX = laneX;
        let toX = laneX;
        let fromY = laneY;
        let toY = laneY;
        if (horizontal) {
          fromX = movement === "left-to-right" ? STREAM_OFFSET_X - element.width : STREAM_OFFSET_X + STREAM_W;
          toX = movement === "left-to-right" ? STREAM_OFFSET_X + STREAM_W : STREAM_OFFSET_X - element.width;
        } else {
          fromY = movement === "top-to-bottom" ? STREAM_OFFSET_Y - element.height : STREAM_OFFSET_Y + STREAM_H;
          toY = movement === "top-to-bottom" ? STREAM_OFFSET_Y + STREAM_H : STREAM_OFFSET_Y - element.height;
        }
        node.getAnimations().forEach((animation) => animation.cancel());
        node.animate(
          [
            { left: `${fromX}px`, top: `${fromY}px`, opacity: 1 },
            { left: `${toX}px`, top: `${toY}px`, opacity: 1 },
          ],
          {
            duration: Math.max(1, durationSeconds) * 1000,
            easing: "linear",
          },
        );
        return true;
      };
    }

    if (directUpdateRef) {
      directUpdateRef.current = (
        id: string,
        changes: Partial<CanvasElement>,
      ) => {
        const n = nodeMap.get(id);
        if (!n || draggingRef.current.has(id)) return;
        if (changes.x != null) n.style.left = changes.x + "px";
        if (changes.y != null) n.style.top = changes.y + "px";
        if (changes.width != null) n.style.width = changes.width + "px";
        if (changes.height != null) n.style.height = changes.height + "px";
        if (changes.rotation != null) {
          setRotation(n, changes.rotation);
          applyNodeTransform(n);
        }
        if (changes.scaleX != null || changes.scaleY != null) {
          const currentScale = getScale(n);
          setScale(
            n,
            changes.scaleX ?? currentScale.x,
            changes.scaleY ?? currentScale.y,
          );
          applyNodeTransform(n);
        }
        // Mark node so the DOM sync effect skips geometry this frame
        (n as any).__directUpdatedAt = Date.now();
      };
    }

    // Remove deleted nodes
    for (const [id, node] of nodeMap) {
      if (!presentIds.has(id)) {
        const media = mediaElMap.get(id);
        if (media) {
          media.pause();
          if (media.parentNode) media.parentNode.removeChild(media);
          mediaElMap.delete(id);
        }
        node.remove();
        nodeMap.delete(id);
      }
    }

    for (const el of elements) {
      // Audio uploads previously inherited the old 16:9 video-player box.
      // Compact those legacy elements once while preserving user-resized ones.
      if (el.type === "audio" && el.width === 400 && el.height === 225) {
        onElementChange(el.id, { width: 360, height: 86 });
      }
      let node = nodeMap.get(el.id);

      if (!node) {
        node = document.createElement("div");
        node.dataset.id = el.id;
        node.style.cssText =
          "position:absolute;cursor:move;transform-origin:center center;box-sizing:border-box;";

        const content = createMediaElement(el, {
            onMediaEvent: onMediaControl
              ? (action, currentTime) =>
                  onMediaControl(el.id, action, currentTime)
              : undefined,
            onMediaReady: (media) => {
              mediaElMap.set(el.id, media);
              if (media instanceof HTMLVideoElement && !dashboardSilencedVideosRef.current.has(media)) {
                try {
                  const context = dashboardAudioContextRef.current ?? new AudioContext();
                  dashboardAudioContextRef.current = context;
                  const source = context.createMediaElementSource(media);
                  const silentOutput = context.createGain();
                  silentOutput.gain.value = 0;
                  source.connect(silentOutput).connect(context.destination);
                  dashboardSilencedVideosRef.current.add(media);
                } catch (error) {
                  // Very old/restricted browsers may reject Web Audio routing.
                  // Keep the dashboard silent even in that fallback case.
                  media.muted = true;
                  console.warn("Could not route dashboard video through silent output", error);
                }
              }
            },
            onVolumeChange: (vol) => {
              const existing = volumeCommitTimersRef.current.get(el.id);
              if (existing !== undefined) window.clearTimeout(existing);
              volumeCommitTimersRef.current.set(el.id, window.setTimeout(() => {
                volumeCommitTimersRef.current.delete(el.id);
                onElementChange(el.id, { mediaVolume: vol });
              }, 100));
            },
            onVisibilityChange: (visible) => {
              const current = elementsRef.current.find(
                (element) => element.id === el.id,
              );
              if (current?.autoVisibility) {
                onElementChange(el.id, { visible });
              }
            },
          });
        content.classList.add("element-content");
        node.appendChild(content);

        // Selection border
        const selBorder = document.createElement("div");
        selBorder.className = "sel-border";
        selBorder.style.cssText =
          "position:absolute;inset:-2px;pointer-events:none;border:2px solid var(--accent-border);display:none;border-radius:1px;";
        node.appendChild(selBorder);

        // 8 resize handles
        const handlePos: HandlePos[] = [
          "tl",
          "tc",
          "tr",
          "ml",
          "mr",
          "bl",
          "bc",
          "br",
        ];
        for (const pos of handlePos) {
          addResizeHandle(node, pos, getZoom, (changes) => {
            const current = elementsRef.current.find(
              (element) => element.id === el.id,
            );
            if (current?.dvdEnabled) {
              const position = getDvdPosition(current);
              onElementChange(el.id, {
                ...changes,
                dvdEnabled: false,
                x: changes.x ?? position.x,
                y: changes.y ?? position.y,
              });
              return;
            }
            onElementChange(el.id, changes);
          }, () => !elementsRef.current.find((element) => element.id === el.id)?.locked);
        }

        // Delete button
        const deleteBtn = document.createElement("button");
        deleteBtn.innerHTML = iconHTML(X, 11);
        deleteBtn.style.cssText =
          "position:absolute;top:-25px;right:-25px;background:#dc2626;color:white;border:1px solid #f87171;cursor:pointer;width:20px;height:20px;z-index:30;border-radius:50%;display:none;align-items:center;justify-content:center;padding:0;line-height:0;box-sizing:border-box;box-shadow:0 2px 8px rgba(0,0,0,.45);";
        deleteBtn.className = "delete-btn";
        deleteBtn.title = "Permanently delete this element";
        deleteBtn.setAttribute("aria-label", "Delete element");
        deleteBtn.onclick = (e) => {
          e.stopPropagation();
          if (elementsRef.current.find((element) => element.id === el.id)?.locked) return;
          onElementDelete(el.id);
        };
        node.appendChild(deleteBtn);

        // Click to select
        node.addEventListener(
          "click",
          (e) => {
            if ((e.target as HTMLElement).closest("button, input, audio, .rh"))
              return;
            onSelect(el.id, e.shiftKey || e.metaKey || e.ctrlKey);
          },
          true,
        );

        // Drag start/end callbacks to suppress React's DOM position override during group drag
        const onDragStart = () => {
          draggingRef.current.add(el.id);
          const thisEl = elementsRef.current.find((e) => e.id === el.id);
          if (thisEl?.dvdEnabled) {
            const position = getDvdPosition(thisEl);
            onElementChange(el.id, {
              dvdEnabled: false,
              x: position.x,
              y: position.y,
            });
          }
          if (thisEl?.groupId) {
            for (const member of elementsRef.current) {
              if (member.groupId === thisEl.groupId)
                draggingRef.current.add(member.id);
            }
          }
        };
        const onDragEnd = () => {
          draggingRef.current.clear();
        };

        addRotationHandle(
          node,
          (changes) => onElementChange(el.id, changes),
          () =>
            !elementsRef.current.find((element) => element.id === el.id)
              ?.locked,
          () => draggingRef.current.add(el.id),
          () => draggingRef.current.delete(el.id),
        );

        let groupDragLastEmit = 0;
        makeDraggable(
          node,
          getZoom,
          (changes) => onElementChange(el.id, changes),
          (dx, dy, final) => {
            // Move all other group members
            const thisEl = elementsRef.current.find((e) => e.id === el.id);
            if (!thisEl?.groupId) return;
            const groupBox = groupBoxMapRef.current.get(thisEl.groupId);
            if (groupBox) {
              if (!groupBox.dataset.dragStartLeft) {
                groupBox.dataset.dragStartLeft = String(
                  parseFloat(groupBox.style.left) || 0,
                );
                groupBox.dataset.dragStartTop = String(
                  parseFloat(groupBox.style.top) || 0,
                );
              }
              groupBox.style.left = `${Number(groupBox.dataset.dragStartLeft) + dx}px`;
              groupBox.style.top = `${Number(groupBox.dataset.dragStartTop) + dy}px`;
              if (final) {
                delete groupBox.dataset.dragStartLeft;
                delete groupBox.dataset.dragStartTop;
              }
            }
            for (const other of elementsRef.current) {
              if (other.id === el.id || other.groupId !== thisEl.groupId || other.locked)
                continue;
              const otherNode = nodeMapRef.current.get(other.id);
              if (!otherNode) continue;
              const startLeft = parseFloat(
                otherNode.dataset.startLeft ?? String(other.x),
              );
              const startTop = parseFloat(
                otherNode.dataset.startTop ?? String(other.y),
              );
              if (!otherNode.dataset.startLeft) {
                otherNode.dataset.startLeft = String(other.x);
                otherNode.dataset.startTop = String(other.y);
              }
              const nx = startLeft + dx;
              const ny = startTop + dy;
              otherNode.style.left = nx + "px";
              otherNode.style.top = ny + "px";
              const now = Date.now();
              if (final || now - groupDragLastEmit >= 50) {
                onElementChange(other.id, { x: nx, y: ny });
              }
              if (final) {
                delete otherNode.dataset.startLeft;
                delete otherNode.dataset.startTop;
              }
            }
            if (final || Date.now() - groupDragLastEmit >= 50) {
              groupDragLastEmit = Date.now();
            }
          },
          el.type === "text" ? () => onEditText?.(el.id) : null,
          {
            onDragStart,
            onDragEnd,
            canInteract: () => !elementsRef.current.find((element) => element.id === el.id)?.locked,
            onSnapGuides: (guideX, guideY) => {
              const xGuide = snapXGuideRef.current;
              const yGuide = snapYGuideRef.current;
              if (xGuide) {
                xGuide.style.display = guideX === undefined ? "none" : "block";
                if (guideX !== undefined) xGuide.style.left = `${guideX}px`;
              }
              if (yGuide) {
                yGuide.style.display = guideY === undefined ? "none" : "block";
                if (guideY !== undefined) yGuide.style.top = `${guideY}px`;
              }
            },
          },
        );

        workspace.appendChild(node);
        nodeMap.set(el.id, node);
      }

      // Update attrs — skip geometry if node is being dragged or was just direct-updated
      const sx = el.scaleX ?? 1,
        sy = el.scaleY ?? 1,
        rot = el.rotation ?? 0;
      const recentlyDirect =
        ((node as any).__directUpdatedAt ?? 0) > Date.now() - 200;
      if (!draggingRef.current.has(el.id) && !recentlyDirect) {
        node.style.left = el.x + "px";
        node.style.top = el.y + "px";
        node.style.width = el.width + "px";
        node.style.height = el.height + "px";
      } else if (!recentlyDirect) {
        node.style.width = el.width + "px";
        node.style.height = el.height + "px";
      }
      node.style.opacity = el.visible ? String(el.opacity ?? 1) : "0.2";
      node.style.cursor = el.locked ? "not-allowed" : "move";
      node.style.zIndex = String(el.zIndex);
      if (!recentlyDirect) {
        setScale(node, sx, sy);
        setRotation(node, rot);
        applyNodeTransform(node);
      }
      playRequestedEffect(node, el);

      // Update text content live
      if (el.type === "text") {
        const span = node.querySelector("span");
        if (span) {
          const { text, color, fontSize, fontFamily } = parseTextSrc(el.src);
          span.textContent = text;
          span.style.color = color;
          span.style.fontSize = fontSize + "px";
          span.style.fontFamily = fontFamily + ", sans-serif";
        }
      } else {
        const mediaName = node.querySelector<HTMLElement>(".media-name");
        if (mediaName) {
          const label = el.displayName || getFileLabel(el.src) || el.type;
          mediaName.textContent = label;
          mediaName.parentElement!.title =
            `${label} · Drag to move · Use the round handle above the selection to rotate`;
        }
      }

      // Sync volume from element state to media element + slider UI
      if (el.type === "video" || el.type === "audio") {
        const vol = el.mediaVolume ?? 0.25;
        const media = mediaElMapRef.current.get(el.id);
        if (media && Math.abs(media.volume - vol) > 0.001) {
          (media as any).__remoteVolumeTarget = vol;
          media.volume = vol;
        }
        const slider = node.querySelector<HTMLInputElement>(
          "input[type=range][title='Volume']",
        );
        if (slider && Math.abs(parseFloat(slider.value) - vol) > 0.001)
          slider.value = String(vol);
      }

      // Group indicator — dashed outline per element
      node.style.outline = el.groupId
        ? "1px dashed rgba(var(--accent-rgb),0.35)"
        : "none";

      // Selection UI
      const isSelected = selectedIds.has(el.id);
      node.querySelector<HTMLElement>(".sel-border")!.style.display = isSelected
        ? "block"
        : "none";
      node.querySelector<HTMLElement>(".delete-btn")!.style.display = isSelected && !el.locked
        ? "flex"
        : "none";
      for (const h of node.querySelectorAll<HTMLElement>(".rh")) {
        h.style.display =
          isSelected && !el.locked
            ? h.classList.contains("rotation-handle")
              ? "flex"
              : "block"
            : "none";
      }
    }

    // Group bounding boxes
    const groupBoxMap = groupBoxMapRef.current;
    const activeGroups = new Map<string, CanvasElement[]>();
    for (const el of elements) {
      if (!el.groupId) continue;
      const arr = activeGroups.get(el.groupId) ?? [];
      arr.push(el);
      activeGroups.set(el.groupId, arr);
    }

    // Remove stale group boxes
    for (const [gid, box] of groupBoxMap) {
      if (!activeGroups.has(gid)) {
        box.remove();
        groupBoxMap.delete(gid);
      }
    }

    // Update/create group boxes
    const PAD = 10;
    for (const [gid, members] of activeGroups) {
      if (members.length < 2) continue;
      const corners = members.flatMap((member) => {
        const memberNode = nodeMap.get(member.id);
        const x = memberNode
          ? parseFloat(memberNode.style.left) || member.x
          : member.x;
        const y = memberNode
          ? parseFloat(memberNode.style.top) || member.y
          : member.y;
        const width = memberNode?.offsetWidth || member.width;
        const height = memberNode?.offsetHeight || member.height;
        const rotation = memberNode ? getRotation(memberNode) : (member.rotation ?? 0);
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const angle = (rotation * Math.PI) / 180;
        const memberCos = Math.cos(angle);
        const memberSin = Math.sin(angle);
        return [
          [-width / 2, -height / 2],
          [width / 2, -height / 2],
          [width / 2, height / 2],
          [-width / 2, height / 2],
        ].map(([cornerX, cornerY]) => ({
          x: centerX + cornerX * memberCos - cornerY * memberSin,
          y: centerY + cornerX * memberSin + cornerY * memberCos,
        }));
      });
      const minX = Math.min(...corners.map((corner) => corner.x)) - PAD;
      const minY = Math.min(...corners.map((corner) => corner.y)) - PAD;
      const maxX = Math.max(...corners.map((corner) => corner.x)) + PAD;
      const maxY = Math.max(...corners.map((corner) => corner.y)) + PAD;

      let box = groupBoxMap.get(gid);
      if (!box) {
        box = document.createElement("div");
        box.style.cssText =
          "position:absolute;border:1.5px dashed rgba(var(--accent-rgb),0.45);background:rgba(var(--accent-rgb),0.04);pointer-events:none;border-radius:4px;";
        let rotationState:
          | {
              pivotX: number;
              pivotY: number;
              members: Array<{
                id: string;
                centerX: number;
                centerY: number;
                width: number;
                height: number;
                rotation: number;
              }>;
            }
          | null = null;
        const rotationHandle = addRotationHandle(
          box,
          () => {},
          () =>
            elementsRef.current
              .filter((item) => item.groupId === gid)
              .some((item) => !item.locked),
          () => {
            const currentMembers = elementsRef.current.filter(
              (item) => item.groupId === gid && !item.locked,
            );
            if (currentMembers.length < 2) return;
            const left = parseFloat(box!.style.left) || 0;
            const top = parseFloat(box!.style.top) || 0;
            const width = parseFloat(box!.style.width) || 0;
            const height = parseFloat(box!.style.height) || 0;
            rotationState = {
              pivotX: left + width / 2,
              pivotY: top + height / 2,
              members: currentMembers.map((member) => {
                draggingRef.current.add(member.id);
                return {
                  id: member.id,
                  centerX: member.x + member.width / 2,
                  centerY: member.y + member.height / 2,
                  width: member.width,
                  height: member.height,
                  rotation: member.rotation ?? 0,
                };
              }),
            };
          },
          () => {
            rotationState = null;
            draggingRef.current.clear();
          },
          () => {
            if (!rotationState) return null;
            const workspaceRect = workspace.getBoundingClientRect();
            const zoom = getZoom();
            return {
              x: workspaceRect.left + rotationState.pivotX * zoom,
              y: workspaceRect.top + rotationState.pivotY * zoom,
            };
          },
          (deltaDegrees) => {
            if (!rotationState) return;
            const angle = (deltaDegrees * Math.PI) / 180;
            const groupCos = Math.cos(angle);
            const groupSin = Math.sin(angle);
            for (const member of rotationState.members) {
              const offsetX = member.centerX - rotationState.pivotX;
              const offsetY = member.centerY - rotationState.pivotY;
              const centerX =
                rotationState.pivotX + offsetX * groupCos - offsetY * groupSin;
              const centerY =
                rotationState.pivotY + offsetX * groupSin + offsetY * groupCos;
              const changes = {
                x: centerX - member.width / 2,
                y: centerY - member.height / 2,
                rotation: member.rotation + deltaDegrees,
              };
              const memberNode = nodeMapRef.current.get(member.id);
              if (memberNode) {
                memberNode.style.left = `${changes.x}px`;
                memberNode.style.top = `${changes.y}px`;
                setRotation(memberNode, changes.rotation);
                applyNodeTransform(memberNode);
              }
              onElementChange(member.id, changes);
            }
          },
        );
        rotationHandle.classList.add("group-rotation-handle");
        rotationHandle.style.pointerEvents = "auto";
        rotationHandle.style.width = "22px";
        rotationHandle.style.height = "22px";
        rotationHandle.style.top = "-44px";
        rotationHandle.style.background = "var(--accent-solid)";
        rotationHandle.style.color = "var(--accent-contrast)";
        rotationHandle.style.zIndex = "100000";
        rotationHandle.title =
          "Drag to rotate the group · Hold Shift to snap to 15° increments";
        rotationHandle.setAttribute("aria-label", "Rotate group");
        workspace.insertBefore(box, workspace.firstChild);
        groupBoxMap.set(gid, box);
      }
      box.style.left = minX + "px";
      box.style.top = minY + "px";
      box.style.width = maxX - minX + "px";
      box.style.height = maxY - minY + "px";
      const groupSelected = members.some((member) => selectedIds.has(member.id));
      const groupRotationHandle = box.querySelector<HTMLElement>(
        ".group-rotation-handle",
      );
      if (groupRotationHandle) {
        groupRotationHandle.style.display = groupSelected ? "flex" : "none";
      }
    }
  }, [
    elements,
    selectedIds,
    onSelect,
    onElementChange,
    onElementDelete,
    onEditText,
    getZoom,
    onMediaControl,
  ]);

  useEffect(() => () => {
    volumeCommitTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    volumeCommitTimersRef.current.clear();
    void dashboardAudioContextRef.current?.close();
    dashboardAudioContextRef.current = null;
  }, []);

  // Expose applyControl for incoming remote media:control events
  useEffect(() => {
    if (!mediaControlRef) return;
    mediaControlRef.current = (payload) => {
      const media = mediaElMapRef.current.get(payload.id);
      if (!media) return;
      (media as any).__applyingRemote = true;
      (media as any).__remoteSeekTarget = payload.currentTime;
      media.currentTime = payload.currentTime;
      if (payload.action === "play") {
        media
          .play()
          .catch(() => {})
          .finally(() => {
            (media as any).__applyingRemote = false;
          });
      } else {
        if (payload.action === "pause") media.pause();
        (media as any).__applyingRemote = false;
      }
    };
  }, [mediaControlRef]);

  const reconnectTwitchPlayer = useCallback(() => {
    if (!showTwitchEmbed || !twitchChannel) return;

    // Invalidate events from the old player before removing its iframe.
    twitchSessionRef.current += 1;
    setTwitchInteractionEnabled(false);
    twitchNeedsReconnectRef.current = false;
    setTwitchNeedsReconnect(false);
    twitchHasPlayedRef.current = false;
    twitchPlayerRef.current = null;
    twitchInitedRef.current = false;
    twitchEmbedRef.current
      ?.querySelector("#twitch-player-container")
      ?.replaceChildren();
    setTwitchPlayerGeneration((generation) => generation + 1);
  }, [showTwitchEmbed, twitchChannel]);

  // Twitch.Player — initialize once, then switch channels in the same player.
  useEffect(() => {
    const div = twitchEmbedRef.current;
    if (!div || !twitchChannel) return;

    if (!showTwitchEmbed) {
      div.style.display = "none";
      return;
    }

    div.style.display = "block";

    if (twitchInitedRef.current) {
      setTwitchInteractionEnabled(false);
      twitchPlayerRef.current?.setChannel(twitchChannel);
      return;
    }
    const Twitch = (window as any).Twitch;
    if (!Twitch?.Player) return;
    twitchInitedRef.current = true;
    const session = ++twitchSessionRef.current;

    const player = new Twitch.Player("twitch-player-container", {
      width: "100%",
      height: "100%",
      channel: twitchChannel,
      parent: [window.location.hostname],
      muted: true,
      autoplay: true,
    });
    twitchPlayerRef.current = player;
    player.addEventListener(Twitch.Player.PLAYING, () => {
      if (session !== twitchSessionRef.current) return;
      twitchHasPlayedRef.current = true;
      twitchNeedsReconnectRef.current = false;
      setTwitchNeedsReconnect(false);
      setTwitchInteractionEnabled(false);
    });
    player.addEventListener(Twitch.Player.PAUSE, () => {
      if (session !== twitchSessionRef.current) return;
      if (twitchHasPlayedRef.current) {
        twitchNeedsReconnectRef.current = true;
        setTwitchNeedsReconnect(true);
      }
    });
  }, [showTwitchEmbed, twitchChannel, twitchPlayerGeneration]);

  // Twitch may reject play() after a background-tab visibility pause. Rebuild
  // only its player when the tab returns instead of refreshing the dashboard.
  useEffect(() => {
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        twitchNeedsReconnectRef.current
      )
        reconnectTwitchPlayer();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reconnectTwitchPlayer]);

  const resetView = useCallback(() => {
    const w = wrapperRef.current?.clientWidth ?? 800;
    const h = wrapperRef.current?.clientHeight ?? 600;
    const fit = Math.min(w / STREAM_W, h / STREAM_H) * 0.82;
    panRef.current = {
      x: (w - STREAM_W * fit) / 2 - STREAM_OFFSET_X * fit,
      y: (h - STREAM_H * fit) / 2 - STREAM_OFFSET_Y * fit,
    };
    zoomRef.current = fit;
    applyTransform();
  }, [applyTransform]);

  return (
    <div
      ref={wrapperRef}
      data-media-drop-target
      className="canvas-stage-drop-target"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#161616",
        userSelect: "none",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={workspaceRef}
        id="viewport"
        style={{
          position: "absolute",
          transformOrigin: "0 0",
          width: WORKSPACE_W,
          height: WORKSPACE_H,
          background: "#111",
        }}
      >
        {/* Twitch.Player container — inside workspace so zoom/pan applies automatically */}
        <div
          ref={twitchEmbedRef}
          className="canvas-interaction-surface"
          style={{
            position: "absolute",
            left: STREAM_OFFSET_X,
            top: STREAM_OFFSET_Y,
            width: STREAM_W,
            height: STREAM_H,
            display: showTwitchEmbed ? "block" : "none",
            overflow: "hidden",
          }}
        >
          <div
            id="twitch-player-container"
            style={{
              width: "100%",
              height: "100%",
              pointerEvents: twitchInteractionEnabled ? "auto" : "none",
            }}
          />
        </div>
        <div
          className="viewport-rect"
          style={{
            position: "absolute",
            left: STREAM_OFFSET_X,
            top: STREAM_OFFSET_Y - 22,
            fontSize: 10,
            color: "var(--accent-border)",
            fontFamily: "Inter,sans-serif",
            userSelect: "none",
            whiteSpace: "nowrap",
            zIndex: 1,
          }}
        >
          1920 × 1080 — stream viewport
        </div>
        <button
          type="button"
          className="ui-button ui-button--compact"
          onClick={(event) => {
            event.stopPropagation();
            setTwitchInteractionEnabled((enabled) => !enabled);
          }}
          title={
            twitchInteractionEnabled
              ? "Lock Twitch input and restore canvas zoom, pan, selection, and dragging"
              : "Temporarily unlock Twitch input so you can press its Play button"
          }
          aria-pressed={twitchInteractionEnabled}
          style={{
            position: "absolute",
            left: STREAM_OFFSET_X + STREAM_W - 112,
            top: STREAM_OFFSET_Y - 29,
            width: 112,
            height: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
            padding: "0 7px",
            border: `1px solid ${
              twitchInteractionEnabled ? "#f59e0b" : "#3a3a3f"
            }`,
            borderRadius: 4,
            background: twitchInteractionEnabled ? "#3a2608" : "#1b1b1d",
            color: twitchInteractionEnabled ? "#fbbf24" : "#b7bec8",
            fontSize: 10,
            fontWeight: 700,
            cursor: "pointer",
            zIndex: 5,
          }}
        >
          {twitchInteractionEnabled ? <Unlock size={12} /> : <Lock size={12} />}
          {twitchInteractionEnabled ? "Finish input" : "Play stream"}
        </button>
        <div
          className="viewport-rect"
          style={{
            position: "absolute",
            left: STREAM_OFFSET_X,
            top: STREAM_OFFSET_Y,
            width: STREAM_W,
            height: STREAM_H,
            background: "transparent",
            outline: "2px solid var(--accent-border)",
            boxSizing: "border-box",
            pointerEvents: "none",
            zIndex: 1,
          }}
        />
        <div
          ref={snapXGuideRef}
          style={{
            position: "absolute",
            top: STREAM_OFFSET_Y,
            height: STREAM_H,
            width: 2,
            background: "#f97316",
            boxShadow: "0 0 6px rgba(249,115,22,0.8)",
            pointerEvents: "none",
            display: "none",
            zIndex: 2147483647,
          }}
        />
        <div
          ref={snapYGuideRef}
          style={{
            position: "absolute",
            left: STREAM_OFFSET_X,
            width: STREAM_W,
            height: 2,
            background: "#f97316",
            boxShadow: "0 0 6px rgba(249,115,22,0.8)",
            pointerEvents: "none",
            display: "none",
            zIndex: 2147483647,
          }}
        />
        {drawingLayer}
      </div>
      <LiveCursors cursors={cursors} pan={panState} zoom={zoomState} />
      <div
        style={{
          position: "absolute",
          bottom: 12,
          right: 56,
          display: "flex",
          gap: 6,
          userSelect: "none",
          pointerEvents: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {showTwitchEmbed && twitchNeedsReconnect && (
            <button
              className="ui-button"
              onClick={reconnectTwitchPlayer}
              title="Reload only the Twitch player after it was paused by browser visibility rules"
              style={{
                background: "var(--accent-solid)",
                color: "var(--accent-contrast)",
                fontSize: 11,
                pointerEvents: "all",
                padding: "3px 8px",
                borderRadius: 4,
                border: "1px solid var(--accent-border)",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                whiteSpace: "nowrap",
              }}
            >
              <RefreshCw size={12} /> Reconnect stream
            </button>
          )}
          <button
            className="ui-button"
            onClick={resetView}
            title="Reset zoom and center the 1920×1080 stream area"
            style={{
              background: "rgba(0,0,0,0.7)",
              color: "#aaa",
              fontSize: 11,
              pointerEvents: "all",
              padding: "3px 8px",
              borderRadius: 4,
              border: "none",
              cursor: "pointer",
            }}
          >
            {Math.round(zoomState * 100)}% · Fit
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlay — rAF lerp, imperative media control
// ---------------------------------------------------------------------------
function lerpAngle(current: number, target: number, factor: number): number {
  let delta = (target - current) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return current + delta * factor;
}

export interface OverlayStageHandle {
  applyControl: (payload: MediaControlPayload) => void;
}

interface CornerParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
}

export const OverlayStage = forwardRef<
  OverlayStageHandle,
  {
    elements: CanvasElement[];
    cursors?: Map<string, CursorPayload>;
    dvdCelebrationSettings?: DvdCelebrationSettings;
    strokes?: DrawStroke[];
    liveStrokes?: Map<
      string,
      {
        userId: string;
        points: Array<[number, number]>;
        color: string;
        size: number;
        eraser: boolean;
      }
    >;
    onMediaEnded?: (id: string) => void;
  }
>(function OverlayStage(
  {
    elements,
    cursors = new Map(),
    dvdCelebrationSettings = {
      volume: 0.25,
      soundUrl: null,
      counterPosition: "top-right",
    },
    strokes = [],
    liveStrokes,
    onMediaEnded,
  },
  ref,
) {
  const [cornerHitCount, setCornerHitCount] = useState(0);
  const hasActiveDvd = elements.some(
    (element) =>
      element.dvdEnabled && element.visible && element.type !== "audio",
  );
  const counterAtTop = dvdCelebrationSettings.counterPosition.startsWith("top");
  const counterAtCenter = dvdCelebrationSettings.counterPosition.endsWith("center");
  const counterAtLeft = dvdCelebrationSettings.counterPosition.endsWith("left");
  const counterLeft = counterAtCenter
    ? "50%"
    : counterAtLeft
      ? "28px"
      : "calc(100% - 28px)";
  const counterTop = counterAtTop ? "28px" : "calc(100% - 28px)";
  const counterTransform = `translate(${counterAtCenter ? "-50%" : counterAtLeft ? "0" : "-100%"}, ${counterAtTop ? "0" : "-100%"})`;
  const hadActiveDvdRef = useRef(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const nodeMapRef = useRef<Map<string, HTMLElement>>(new Map());
  const posMapRef = useRef<
    Map<string, { x: number; y: number; rotation: number }>
  >(new Map());
  const targetMapRef = useRef<
    Map<string, { x: number; y: number; rotation: number }>
  >(new Map());
  const animatingRef = useRef<Set<string>>(new Set());
  const flyingRef = useRef<Set<string>>(new Set());
  // Stores the actual HTMLMediaElement for each element id (video or hidden audio)
  const mediaElMapRef = useRef<Map<string, HTMLMediaElement>>(new Map());
  // Container for hidden audio elements
  const audioContainerRef = useRef<HTMLDivElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawLiveCanvasRef = useRef<HTMLCanvasElement>(null);
  const cornerFxCanvasRef = useRef<HTMLCanvasElement>(null);
  const cornerParticlesRef = useRef<CornerParticle[]>([]);
  const cornerAudioContextRef = useRef<AudioContext | null>(null);
  const customCornerAudioRef = useRef<HTMLAudioElement | null>(null);
  const dvdCelebrationSettingsRef = useRef(dvdCelebrationSettings);
  const dvdBounceStateRef = useRef<
    Map<
      string,
      {
        x: number;
        y: number;
        dx: number;
        dy: number;
        lastXBounce: number;
        lastYBounce: number;
        lastXEdge: "left" | "right";
        lastYEdge: "top" | "bottom";
        lastCelebration: number;
      }
    >
  >(new Map());

  useEffect(() => {
    dvdCelebrationSettingsRef.current = dvdCelebrationSettings;
  }, [dvdCelebrationSettings]);

  useEffect(() => {
    if (!hasActiveDvd && hadActiveDvdRef.current) {
      setCornerHitCount(0);
    }
    hadActiveDvdRef.current = hasActiveDvd;
  }, [hasActiveDvd]);
  // Offscreen layer holding committed strokes/fills already baked in, so an
  // expensive flood fill is never re-run just because a live stroke updated.
  const drawBaseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawBakedCountRef = useRef(0);
  const overlayElementsRef = useRef(elements);
  useEffect(() => {
    overlayElementsRef.current = elements;
  }, [elements]);

  useEffect(() => {
    let frame = 0;
    const animateMovingElements = () => {
      const now = Date.now();
      for (const element of overlayElementsRef.current) {
        if (!element.visible || element.type === "audio")
          continue;
        const node = nodeMapRef.current.get(element.id);
        if (!node) continue;
        if (
          element.flyStartedAt &&
          element.flyDurationMs &&
          element.flyFromX !== undefined &&
          element.flyFromY !== undefined &&
          element.flyToX !== undefined &&
          element.flyToY !== undefined
        ) {
          const progress = Math.max(
            0,
            Math.min(1, (now - element.flyStartedAt) / element.flyDurationMs),
          );
          const x = element.flyFromX + (element.flyToX - element.flyFromX) * progress - STREAM_OFFSET_X;
          const y = element.flyFromY + (element.flyToY - element.flyFromY) * progress - STREAM_OFFSET_Y;
          node.style.left = `${x}px`;
          node.style.top = `${y}px`;
          const current = posMapRef.current.get(element.id);
          if (current) Object.assign(current, { x, y, rotation: 0 });
          targetMapRef.current.set(element.id, { x, y, rotation: 0 });
          flyingRef.current.add(element.id);
          continue;
        }
        if (!element.dvdEnabled) continue;
        const position = getDvdPosition(element, now);
        const x = position.x - STREAM_OFFSET_X;
        const y = position.y - STREAM_OFFSET_Y;
        const previous = dvdBounceStateRef.current.get(element.id);
        if (previous) {
          const dx = x - previous.x;
          const dy = y - previous.y;
          const bouncedX =
            previous.dx !== 0 &&
            dx !== 0 &&
            Math.sign(previous.dx) !== Math.sign(dx);
          const bouncedY =
            previous.dy !== 0 &&
            dy !== 0 &&
            Math.sign(previous.dy) !== Math.sign(dy);
          if (bouncedX) {
            previous.lastXBounce = now;
            previous.lastXEdge = previous.dx > 0 ? "right" : "left";
          }
          if (bouncedY) {
            previous.lastYBounce = now;
            previous.lastYEdge = previous.dy > 0 ? "bottom" : "top";
          }
          previous.x = x;
          previous.y = y;
          previous.dx = dx;
          previous.dy = dy;

          // Axis reflections can land on adjacent animation frames. Treat them
          // as one genuine corner collision only when they occur within 50 ms.
          if (
            (bouncedX || bouncedY) &&
            Math.abs(previous.lastXBounce - previous.lastYBounce) <= 50 &&
            now - previous.lastCelebration > 1500
          ) {
            previous.lastCelebration = now;
            const cornerX = previous.lastXEdge === "left" ? 0 : STREAM_W;
            const cornerY = previous.lastYEdge === "top" ? 0 : STREAM_H;
            spawnCornerCelebration(cornerX, cornerY);
          }
        } else {
          dvdBounceStateRef.current.set(element.id, {
            x,
            y,
            dx: 0,
            dy: 0,
            lastXBounce: -Infinity,
            lastYBounce: Infinity,
            lastXEdge: "left",
            lastYEdge: "top",
            lastCelebration: -Infinity,
          });
        }
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
        const current = posMapRef.current.get(element.id);
        if (current) {
          current.x = x;
          current.y = y;
        }
      }
      const activeIds = new Set(
        overlayElementsRef.current
          .filter((element) => element.dvdEnabled && element.visible)
          .map((element) => element.id),
      );
      for (const id of dvdBounceStateRef.current.keys()) {
        if (!activeIds.has(id)) dvdBounceStateRef.current.delete(id);
      }
      frame = requestAnimationFrame(animateMovingElements);
    };
    frame = requestAnimationFrame(animateMovingElements);
    return () => cancelAnimationFrame(frame);
  }, []);

  const spawnCornerCelebration = (cornerX: number, cornerY: number) => {
    const settings = dvdCelebrationSettingsRef.current;
    setCornerHitCount((count) => count + 1);
    const colors = ["#fb923c", "#f97316", "#fdba74", "#facc15", "#ffffff"];
    const directionX = cornerX === 0 ? 1 : -1;
    const directionY = cornerY === 0 ? 1 : -1;
    for (let index = 0; index < 90; index += 1) {
      const life = 1.4 + Math.random() * 0.9;
      cornerParticlesRef.current.push({
        x: cornerX,
        y: cornerY,
        vx: directionX * (180 + Math.random() * 620),
        vy:
          directionY * (120 + Math.random() * 520) -
          directionY * Math.random() * 220,
        rotation: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 14,
        size: 8 + Math.random() * 14,
        color: colors[Math.floor(Math.random() * colors.length)],
        life,
        maxLife: life,
      });
    }

    if (settings.volume <= 0) return;
    if (settings.soundUrl) {
      const audio =
        customCornerAudioRef.current ?? new Audio(settings.soundUrl);
      if (audio.src !== settings.soundUrl) {
        audio.src = settings.soundUrl;
      }
      customCornerAudioRef.current = audio;
      audio.volume = settings.volume;
      audio.currentTime = 0;
      void audio.play().catch(() => {});
      return;
    }

    try {
      const AudioContextClass = window.AudioContext;
      const audioContext =
        cornerAudioContextRef.current ?? new AudioContextClass();
      cornerAudioContextRef.current = audioContext;
      void audioContext.resume().then(() => {
        const start = audioContext.currentTime;
        [659.25, 783.99, 1046.5].forEach((frequency, index) => {
          const oscillator = audioContext.createOscillator();
          const gain = audioContext.createGain();
          oscillator.type = "triangle";
          oscillator.frequency.value = frequency;
          gain.gain.setValueAtTime(0.0001, start + index * 0.07);
          gain.gain.exponentialRampToValueAtTime(
            Math.max(0.0001, 0.24 * settings.volume),
            start + index * 0.07 + 0.015,
          );
          gain.gain.exponentialRampToValueAtTime(
            0.0001,
            start + index * 0.07 + 0.28,
          );
          oscillator.connect(gain).connect(audioContext.destination);
          oscillator.start(start + index * 0.07);
          oscillator.stop(start + index * 0.07 + 0.3);
        });
      });
    } catch {
      // OBS/browser autoplay policy may suppress synthesized audio; confetti
      // still renders even when audio output is unavailable.
    }
  };

  useEffect(() => {
    let frame = 0;
    let previousTime = performance.now();
    const renderParticles = (time: number) => {
      const canvas = cornerFxCanvasRef.current;
      const context = canvas?.getContext("2d");
      const dt = Math.min(0.033, (time - previousTime) / 1000);
      previousTime = time;
      context?.clearRect(0, 0, STREAM_W, STREAM_H);
      const particles = cornerParticlesRef.current;
      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index];
        particle.life -= dt;
        if (particle.life <= 0) {
          particles.splice(index, 1);
          continue;
        }
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vy += 520 * dt;
        particle.rotation += particle.spin * dt;
        if (!context) continue;
        context.save();
        context.globalAlpha = Math.min(1, particle.life / 0.35);
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        context.fillStyle = particle.color;
        context.fillRect(
          -particle.size / 2,
          -particle.size / 3,
          particle.size,
          particle.size * 0.66,
        );
        context.restore();
      }
      frame = requestAnimationFrame(renderParticles);
    };
    frame = requestAnimationFrame(renderParticles);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let base = drawBaseCanvasRef.current;
    if (!base) {
      base = document.createElement("canvas");
      drawBaseCanvasRef.current = base;
    }
    const canvas = drawCanvasRef.current;
    if (
      canvas &&
      (base.width !== canvas.width || base.height !== canvas.height)
    ) {
      base.width = canvas.width;
      base.height = canvas.height;
      drawBakedCountRef.current = 0;
    }
    const baseCtx = base.getContext("2d")!;
    if (strokes.length < drawBakedCountRef.current) {
      baseCtx.clearRect(0, 0, base.width, base.height);
      drawBakedCountRef.current = 0;
    }
    for (let i = drawBakedCountRef.current; i < strokes.length; i++) {
      renderAction(baseCtx, strokes[i], STREAM_OFFSET_X, STREAM_OFFSET_Y);
    }
    drawBakedCountRef.current = strokes.length;

    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
  }, [strokes]);

  // Keep in-progress remote strokes on their own transparent layer. This
  // avoids copying the complete 1080p committed drawing for every live shape
  // position received from the dashboard.
  useEffect(() => {
    const canvas = drawLiveCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (liveStrokes) {
      for (const live of liveStrokes.values()) {
        renderAction(
          ctx,
          {
            ...live,
            id: `live-${live.userId}`,
            points: live.points,
            eraser: live.eraser,
          } as any,
          STREAM_OFFSET_X,
          STREAM_OFFSET_Y,
        );
      }
    }
  }, [liveStrokes]);

  useImperativeHandle(ref, () => ({
    applyControl(payload: MediaControlPayload) {
      const media = mediaElMapRef.current.get(payload.id);
      if (!media) return;
      (media as any).__applyingRemote = true;
      if (payload.action !== "play") media.currentTime = payload.currentTime;
      if (payload.action === "play") {
        // Play muted first (always allowed by autoplay policy), then restore volume.
        // This lets the overlay work in browsers without a prior user gesture.
        const wasMuted = media.muted;
        media.muted = true;
        media.currentTime = payload.currentTime;
        media
          .play()
          .then(() => {
            media.muted = wasMuted;
          })
          .catch(() => {})
          .finally(() => {
            (media as any).__applyingRemote = false;
          });
      } else {
        if (payload.action === "pause") media.pause();
        (media as any).__applyingRemote = false;
      }
    },
  }));

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const nodeMap = nodeMapRef.current;
    const posMap = posMapRef.current;
    const targetMap = targetMapRef.current;
    const animating = animatingRef.current;
    const mediaElMap = mediaElMapRef.current;
    const audioContainer = audioContainerRef.current;
    const presentIds = new Set(elements.map((e) => e.id));

    // Remove deleted elements
    for (const [id, node] of nodeMap) {
      if (!presentIds.has(id)) {
        node.remove();
        nodeMap.delete(id);
        posMap.delete(id);
        targetMap.delete(id);
        animating.delete(id);
      }
    }
    // Remove deleted audio elements
    for (const [id, media] of mediaElMap) {
      if (!presentIds.has(id)) {
        media.pause();
        if (media.parentNode) media.parentNode.removeChild(media);
        mediaElMap.delete(id);
      }
    }

    for (const el of elements) {
      const sx = el.scaleX ?? 1,
        sy = el.scaleY ?? 1;

      // Audio: hidden element, no visual node
      if (el.type === "audio") {
        if (!mediaElMap.has(el.id)) {
          const audio = document.createElement("audio");
          audio.src = el.src;
          audio.volume = el.mediaVolume ?? 0.25;
          audio.preload = "auto";
          audio.addEventListener("ended", () => onMediaEnded?.(el.id));
          if (el.mediaCurrentTime && el.mediaCurrentTime > 0) {
            audio.addEventListener(
              "loadedmetadata",
              () => {
                audio.currentTime = el.mediaCurrentTime!;
              },
              { once: true },
            );
          }
          if (audioContainer) audioContainer.appendChild(audio);
          mediaElMap.set(el.id, audio);
        } else {
          const audio = mediaElMap.get(el.id)!;
          audio.volume = el.mediaVolume ?? 0.25;
        }
        continue;
      }

      let node = nodeMap.get(el.id);
      if (!node) {
        node = document.createElement("div");
        node.style.cssText =
          "position:absolute;transform-origin:center center;";

        const content = createMediaElement(el, {
            isOverlay: true,
            onMediaReady: (media) => mediaElMap.set(el.id, media),
            onVisibilityChange: (visible) => {
              if (!visible) onMediaEnded?.(el.id);
            },
          });
        content.classList.add("element-content");
        node.appendChild(content);

        viewport.appendChild(node);
        const ox = el.x - STREAM_OFFSET_X,
          oy = el.y - STREAM_OFFSET_Y;
        nodeMap.set(el.id, node);
        posMap.set(el.id, { x: ox, y: oy, rotation: el.rotation ?? 0 });
        targetMap.set(el.id, { x: ox, y: oy, rotation: el.rotation ?? 0 });
        node.style.left = ox + "px";
        node.style.top = oy + "px";
        node.style.width = el.width + "px";
        node.style.height = el.height + "px";
        setScale(node, sx, sy);
        setRotation(node, el.rotation ?? 0);
        applyNodeTransform(node);
        node.style.visibility = el.visible ? "visible" : "hidden";
        node.dataset.visible = String(el.visible);
      }

      node.style.width = el.width + "px";
      node.style.height = el.height + "px";
      const previousVisible = node.dataset.visible === "true";
      if (previousVisible !== el.visible) {
        node.dataset.visible = String(el.visible);
        const surface = node.firstElementChild as HTMLElement | null;
        surface?.getAnimations().forEach((animation) => animation.cancel());
        if (el.visible) {
          node.style.visibility = "visible";
          surface?.animate(animationFrames(el.enterAnimation), { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
        } else {
          const frames = animationFrames(el.exitAnimation).reverse();
          const animation = surface?.animate(frames, { duration: 260, easing: "ease-in" });
          if (animation) {
            animation.finished.then(() => {
              if (node?.dataset.visible === "false") node.style.visibility = "hidden";
            }).catch(() => {});
          } else node.style.visibility = "hidden";
        }
      } else if (!el.visible) {
        node.style.visibility = "hidden";
      }
      node.style.opacity = String(el.opacity ?? 1);
      node.style.zIndex = String(el.zIndex);
      setScale(node, sx, sy);
      applyNodeTransform(node);
      playRequestedEffect(node, el);

      // Sync volume whenever element state changes
      if (el.type === "video") {
        const media = mediaElMap.get(el.id);
        if (media) media.volume = el.mediaVolume ?? 0.25;
      }

      if (el.type === "text") {
        const span = node.querySelector("span");
        if (span) {
          const { text, color, fontSize, fontFamily } = parseTextSrc(el.src);
          span.textContent = text;
          span.style.color = color;
          span.style.fontSize = fontSize + "px";
          span.style.fontFamily = fontFamily + ",sans-serif";
        }
      }

      targetMap.set(el.id, {
        x: el.x - STREAM_OFFSET_X,
        y: el.y - STREAM_OFFSET_Y,
        rotation: el.rotation ?? 0,
      });

      const hasActiveFlight = Boolean(
        el.flyStartedAt &&
          el.flyDurationMs &&
          el.flyFromX !== undefined &&
          el.flyFromY !== undefined &&
          el.flyToX !== undefined &&
          el.flyToY !== undefined,
      );
      if (hasActiveFlight) {
        flyingRef.current.add(el.id);
        animating.delete(el.id);
        continue;
      }
      if (flyingRef.current.delete(el.id)) {
        const restored = targetMap.get(el.id)!;
        const current = posMap.get(el.id);
        if (current) Object.assign(current, restored);
        node.style.left = `${restored.x}px`;
        node.style.top = `${restored.y}px`;
        setRotation(node, restored.rotation);
        applyNodeTransform(node);
        animating.delete(el.id);
        continue;
      }

      // DVD motion already supplies a continuous position every animation
      // frame. Applying the remote-drag lerp as well makes the rendered node
      // lag behind the mathematical path and visually reverse before reaching
      // an edge.
      if (el.dvdEnabled) {
        const dvdPosition = getDvdPosition(el);
        const dvdX = dvdPosition.x - STREAM_OFFSET_X;
        const dvdY = dvdPosition.y - STREAM_OFFSET_Y;
        const current = posMap.get(el.id);
        if (current) {
          current.x = dvdX;
          current.y = dvdY;
          current.rotation = 0;
        }
        targetMap.set(el.id, { x: dvdX, y: dvdY, rotation: 0 });
        node.style.left = `${dvdX}px`;
        node.style.top = `${dvdY}px`;
        continue;
      }

      if (!animating.has(el.id)) {
        animating.add(el.id);
        const id = el.id;
        const FACTOR = 0.18;
        const animate = () => {
          const latestElement = overlayElementsRef.current.find(
            (candidate) => candidate.id === id,
          );
          if (latestElement?.dvdEnabled || latestElement?.flyStartedAt) {
            animating.delete(id);
            return;
          }
          const pos = posMap.get(id),
            target = targetMap.get(id),
            n = nodeMap.get(id);
          if (!pos || !target || !n) {
            animating.delete(id);
            return;
          }
          const curSx = latestElement?.scaleX ?? 1,
            curSy = latestElement?.scaleY ?? 1;
          pos.x += (target.x - pos.x) * FACTOR;
          pos.y += (target.y - pos.y) * FACTOR;
          pos.rotation = lerpAngle(pos.rotation, target.rotation, FACTOR);
          n.style.left = pos.x + "px";
          n.style.top = pos.y + "px";
          setScale(n, curSx, curSy);
          setRotation(n, pos.rotation);
          applyNodeTransform(n);
          const close =
            Math.abs(target.x - pos.x) < 0.3 &&
            Math.abs(target.y - pos.y) < 0.3 &&
            Math.abs(target.rotation - pos.rotation) < 0.3;
          if (close) {
            pos.x = target.x;
            pos.y = target.y;
            pos.rotation = target.rotation;
            n.style.left = target.x + "px";
            n.style.top = target.y + "px";
            setScale(n, curSx, curSy);
            setRotation(n, target.rotation);
            applyNodeTransform(n);
            animating.delete(id);
            return;
          }
          requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
      }
    }
  }, [elements]);

  return (
    <div
      style={{
        width: STREAM_W,
        height: STREAM_H,
        overflow: "hidden",
        background: "transparent",
        position: "relative",
      }}
    >
      <div
        ref={viewportRef}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      />
      <canvas
        ref={drawCanvasRef}
        width={STREAM_W}
        height={STREAM_H}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 999,
        }}
      />
      <canvas
        ref={drawLiveCanvasRef}
        width={STREAM_W}
        height={STREAM_H}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 1000,
        }}
      />
      <LiveCursors
        cursors={cursors}
        pan={{ x: -STREAM_OFFSET_X, y: -STREAM_OFFSET_Y }}
        zoom={1}
        large
      />
      {hasActiveDvd && (
        <div
          style={{
            position: "absolute",
            top: counterTop,
            left: counterLeft,
            transform: counterTransform,
            transition:
              "top 480ms cubic-bezier(.22,1,.36,1), left 480ms cubic-bezier(.22,1,.36,1), transform 480ms cubic-bezier(.22,1,.36,1)",
            zIndex: 1900,
            display: "flex",
            alignItems: "center",
            width: "max-content",
            whiteSpace: "nowrap",
            gap: 10,
            padding: "10px 16px",
            borderRadius: 10,
            color: "#fff7ed",
            background: "rgba(24,18,15,.88)",
            border: "2px solid #f97316",
            boxShadow:
              "0 5px 18px rgba(0,0,0,.55), 0 0 16px rgba(249,115,22,.22)",
            font: "700 22px Inter,sans-serif",
            letterSpacing: "0.03em",
            pointerEvents: "none",
          }}
        >
          <span>CORNER HITS</span>
          <span
            style={{
              minWidth: 34,
              textAlign: "center",
              padding: "3px 8px",
              borderRadius: 7,
              background: "#f97316",
              color: "#fff",
              fontSize: 24,
            }}
          >
            {cornerHitCount}
          </span>
        </div>
      )}
      <canvas
        ref={cornerFxCanvasRef}
        width={STREAM_W}
        height={STREAM_H}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 2000,
        }}
      />
      {/* Hidden audio container */}
      <div ref={audioContainerRef} style={{ display: "none" }} />
    </div>
  );
});

/**
 * CanvasStage — DOM-based canvas.
 *
 * Key design decisions:
 * - DOM elements, no canvas library
 * - Left-drag on background = pan OR marquee select
 * - Left-drag on element = move (all selected move together)
 * - Right-drag on element = rotate
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
  MediaControlPayload,
} from "../types";
import { randomUUID } from "../utils";

export const STREAM_W = 1920;
export const STREAM_H = 1080;
const WORKSPACE_W = 4000;
const WORKSPACE_H = 3000;
// Stream rect offset so it sits centered in the workspace
export const STREAM_OFFSET_X = Math.round((WORKSPACE_W - STREAM_W) / 2); // 1040
export const STREAM_OFFSET_Y = Math.round((WORKSPACE_H - STREAM_H) / 2); // 960
// Default spawn: just to the left of the stream rect, out of the way
export const SPAWN_X = STREAM_OFFSET_X - 800;
export const SPAWN_Y = STREAM_OFFSET_Y + 100;

export function parseTextSrc(src: string) {
  const [text = "", color = "#ffffff", fs = "48", fontFamily = "Inter"] =
    src.split("|||");
  return { text, color, fontSize: parseInt(fs, 10), fontFamily };
}

function getScale(el: HTMLElement) {
  return {
    x: parseFloat(el.dataset.scaleX ?? "1"),
    y: parseFloat(el.dataset.scaleY ?? "1"),
  };
}
function setScale(el: HTMLElement, sx: number, sy: number) {
  el.dataset.scaleX = String(sx);
  el.dataset.scaleY = String(sy);
}
function getRotation(el: HTMLElement) {
  return parseFloat(el.dataset.rotation ?? "0");
}
function setRotation(el: HTMLElement, deg: number) {
  el.dataset.rotation = String(deg);
}
function applyNodeTransform(el: HTMLElement) {
  const { x, y } = getScale(el);
  const r = getRotation(el);
  el.style.transform = `rotate(${r}deg) scaleX(${x}) scaleY(${y})`;
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
) {
  const btn = document.createElement("div");
  btn.className = `rh rh-${pos}`;
  btn.style.cssText = `
    position:absolute;${HANDLE_POSITIONS[pos]};
    width:10px;height:10px;background:white;border:1.5px solid #6366f1;
    border-radius:2px;cursor:${HANDLE_CURSORS[pos]};z-index:20;display:none;
  `;

  btn.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = container.offsetWidth;
    const startH = container.offsetHeight;
    const startLeft = parseFloat(container.style.left) || 0;
    const startTop = parseFloat(container.style.top) || 0;
    let lastEmit = 0;
    let pendingChanges: Partial<CanvasElement> | null = null;
    const onMove = (ev: MouseEvent) => {
      const zoom = getZoom();
      const dx = (ev.clientX - startX) / zoom;
      const dy = (ev.clientY - startY) / zoom;

      // All 8 handles: pure resize (change width/height, anchor opposite edge/corner).
      // Scale is always reset to ±1 so any prior stretch is cleared on resize.
      let newW = startW,
        newH = startH;
      let newLeft = startLeft,
        newTop = startTop;
      let newSX = 1,
        newSY = 1;

      const hasRight = pos === "tr" || pos === "mr" || pos === "br";
      const hasLeft = pos === "tl" || pos === "ml" || pos === "bl";

      if (hasRight) {
        const rightEdge = startLeft + startW + dx;
        if (rightEdge >= startLeft) {
          newW = Math.max(1, rightEdge - startLeft);
          newLeft = startLeft;
          newSX = 1;
        } else {
          newW = Math.max(1, startLeft - rightEdge);
          newLeft = rightEdge;
          newSX = -1;
        }
      } else if (hasLeft) {
        const rightEdge = startLeft + startW;
        const leftEdge = startLeft + dx;
        if (leftEdge <= rightEdge) {
          newW = Math.max(1, rightEdge - leftEdge);
          newLeft = leftEdge;
          newSX = 1;
        } else {
          newW = Math.max(1, leftEdge - rightEdge);
          newLeft = rightEdge;
          newSX = -1;
        }
      }

      const hasBottom = pos === "bl" || pos === "bc" || pos === "br";
      const hasTop = pos === "tl" || pos === "tc" || pos === "tr";

      if (hasBottom) {
        const bottomEdge = startTop + startH + dy;
        if (bottomEdge >= startTop) {
          newH = Math.max(1, bottomEdge - startTop);
          newTop = startTop;
          newSY = 1;
        } else {
          newH = Math.max(1, startTop - bottomEdge);
          newTop = bottomEdge;
          newSY = -1;
        }
      } else if (hasTop) {
        const bottomEdge = startTop + startH;
        const topEdge = startTop + dy;
        if (topEdge <= bottomEdge) {
          newH = Math.max(1, bottomEdge - topEdge);
          newTop = topEdge;
          newSY = 1;
        } else {
          newH = Math.max(1, topEdge - bottomEdge);
          newTop = bottomEdge;
          newSY = -1;
        }
      }

      container.style.width = newW + "px";
      container.style.height = newH + "px";
      container.style.left = newLeft + "px";
      container.style.top = newTop + "px";
      setScale(container, newSX, newSY);
      applyNodeTransform(container);
      const changes = { x: newLeft, y: newTop, width: newW, height: newH, scaleX: newSX, scaleY: newSY };
      pendingChanges = changes;
      const now = Date.now();
      if (now - lastEmit > 16) {
        lastEmit = now;
        onUpdate(changes);
        pendingChanges = null;
      }
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (pendingChanges) onUpdate(pendingChanges);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  container.appendChild(btn);
  return btn;
}

// ---------------------------------------------------------------------------
// makeDraggable — move + rotate
// ---------------------------------------------------------------------------
function makeDraggable(
  el: HTMLElement,
  getZoom: () => number,
  onUpdate: (changes: Partial<CanvasElement>) => void,
  onGroupDrag: (dx: number, dy: number, final: boolean) => void,
  onDblClick: (() => void) | null,
  options: { onDragStart?: () => void; onDragEnd?: () => void } = {},
) {
  el.addEventListener(
    "mousedown",
    (e) => {
      if ((e.target as HTMLElement).classList.contains("rh")) return;
      if ((e.target as HTMLElement).closest("button, input, audio, .rh"))
        return;

      // Right-click = rotate
      if (e.button === 2) {
        e.preventDefault();
        options.onDragStart?.();
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const startRot = getRotation(el);
        const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
        let rotLastEmit = 0; let rotPending: Partial<CanvasElement> | null = null;
        const onMove = (ev: MouseEvent) => {
          const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx);
          const delta = (angle - startAngle) * (180 / Math.PI);
          const newDeg = startRot + delta;
          setRotation(el, newDeg);
          applyNodeTransform(el);
          const ch = { x: parseFloat(el.style.left), y: parseFloat(el.style.top), rotation: newDeg };
          rotPending = ch;
          const now = Date.now();
          if (now - rotLastEmit > 16) { rotLastEmit = now; onUpdate(ch); rotPending = null; }
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          if (rotPending) onUpdate(rotPending);
          options.onDragEnd?.();
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        return;
      }

      if (e.button !== 0) return;

      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const startLeft = parseFloat(el.style.left) || 0;
      const startTop = parseFloat(el.style.top) || 0;
      let didDrag = false;
      let dragLastEmit = 0; let dragPending: Partial<CanvasElement> | null = null;

      const onMove = (ev: MouseEvent) => {
        const zoom = getZoom();
        const dx = (ev.clientX - startX) / zoom;
        const dy = (ev.clientY - startY) / zoom;
        if (!didDrag && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
          didDrag = true;
          options.onDragStart?.();
        }
        if (!didDrag) return;

        el.style.left = startLeft + dx + "px";
        el.style.top = startTop + dy + "px";
        const ch = { x: startLeft + dx, y: startTop + dy };
        dragPending = ch;
        const now = Date.now();
        if (now - dragLastEmit > 16) { dragLastEmit = now; onUpdate(ch); dragPending = null; }
        onGroupDrag(dx, dy, false);
      };

      const onUp = (ev: MouseEvent) => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);

        if (didDrag) {
          if (dragPending) { onUpdate(dragPending); dragPending = null; }
          const finalDx = (ev.clientX - startX) / getZoom();
          const finalDy = (ev.clientY - startY) / getZoom();
          onGroupDrag(finalDx, finalDy, true);
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
}

function makeSeekButtons(
  media: HTMLMediaElement,
  onSeek?: (t: number) => void,
): HTMLElement {
  const bar = document.createElement("div");
  bar.style.cssText =
    "display:flex;gap:4px;justify-content:center;padding:3px 0;flex-shrink:0;";
  const makeBtn = (label: string, onClick: () => void) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText =
      "background:#1e293b;border:1px solid #334;color:#94a3b8;font-size:10px;padding:2px 8px;border-radius:3px;cursor:pointer;font-family:Inter,sans-serif;";
    b.addEventListener("mousedown", (e) => e.stopPropagation());
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  };
  bar.appendChild(
    makeBtn("−5s", () => {
      const t = Math.max(0, media.currentTime - 5);
      media.currentTime = t;
      onSeek?.(t);
    }),
  );
  bar.appendChild(
    makeBtn("+5s", () => {
      const t = Math.min(media.duration || Infinity, media.currentTime + 5);
      media.currentTime = t;
      onSeek?.(t);
    }),
  );
  return bar;
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
  } = {},
): HTMLElement {
  const {
    isOverlay = false,
    onMediaEvent,
    onMediaReady,
    onVolumeChange,
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

    // Dashboard: custom controls + full drag overlay so the video face never toggles play
    video.controls = false;
    video.style.cssText =
      "width:100%;height:100%;object-fit:contain;display:block;";

    if (onMediaEvent) attachMediaListeners(video, onMediaEvent);
    onMediaReady?.(video);

    const wrap = document.createElement("div");
    wrap.style.cssText =
      "position:relative;width:100%;height:100%;display:flex;flex-direction:column;box-sizing:border-box;background:#000;";

    // Video area (fills available space)
    const videoArea = document.createElement("div");
    videoArea.style.cssText =
      "flex:1;position:relative;overflow:hidden;min-height:0;";
    videoArea.appendChild(video);

    // Full-size transparent overlay — captures all pointer events on the video face,
    // preventing any click from reaching the video element (no accidental play/pause).
    // makeDraggable with capture:true handles drag; this layer just blocks face clicks.
    const faceOverlay = document.createElement("div");
    faceOverlay.style.cssText =
      "position:absolute;inset:0;z-index:2;cursor:move;";
    faceOverlay.title = "Drag to move · Right-drag to rotate";
    videoArea.appendChild(faceOverlay);

    // Custom controls bar
    const ctrl = document.createElement("div");
    ctrl.style.cssText =
      "display:flex;align-items:center;gap:4px;padding:4px 6px;background:#0f172a;flex-shrink:0;border-top:1px solid #1e293b;";

    const playBtn = document.createElement("button");
    playBtn.textContent = "▶";
    playBtn.style.cssText =
      "background:none;border:none;color:#94a3b8;font-size:13px;cursor:pointer;padding:0 2px;line-height:1;flex-shrink:0;";
    playBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    playBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      video.paused ? video.play() : video.pause();
    });
    video.addEventListener("play", () => {
      playBtn.textContent = "⏸";
    });
    video.addEventListener("pause", () => {
      playBtn.textContent = "▶";
    });

    const timeDisplay = document.createElement("span");
    timeDisplay.style.cssText =
      "font-size:9px;color:#64748b;font-family:monospace;white-space:nowrap;flex-shrink:0;";
    timeDisplay.textContent = "0:00";

    const progress = document.createElement("input");
    progress.type = "range";
    progress.min = "0";
    progress.max = "100";
    progress.value = "0";
    progress.style.cssText =
      "flex:1;min-width:0;accent-color:#6366f1;cursor:pointer;";
    const onProgressChange = () => {
      if (video.duration) {
        const t = (Number(progress.value) / 100) * video.duration;
        video.currentTime = t;
        onMediaEvent?.("seek", t);
      }
    };
    progress.addEventListener("input", onProgressChange);
    progress.addEventListener("change", onProgressChange);

    const fmt = (s: number) => {
      const m = Math.floor(s / 60);
      return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    };
    video.addEventListener("timeupdate", () => {
      if (!video.duration) return;
      progress.value = String((video.currentTime / video.duration) * 100);
      timeDisplay.textContent =
        fmt(video.currentTime) + " / " + fmt(video.duration);
    });
    video.addEventListener("loadedmetadata", () => {
      timeDisplay.textContent = "0:00 / " + fmt(video.duration);
      if (el.mediaCurrentTime && el.mediaCurrentTime > 0) {
        video.currentTime = el.mediaCurrentTime;
      }
    });

    const seekBtn = (label: string, sec: number) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText =
        "background:none;border:none;color:#64748b;font-size:9px;cursor:pointer;padding:0 1px;white-space:nowrap;";
      b.addEventListener("mousedown", (e) => e.stopPropagation());
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const t = Math.max(
          0,
          Math.min(video.duration || 0, video.currentTime + sec),
        );
        video.currentTime = t;
        onMediaEvent?.("seek", t);
      });
      return b;
    };

    const volSlider = document.createElement("input");
    volSlider.type = "range";
    volSlider.min = "0";
    volSlider.max = "1";
    volSlider.step = "0.01";
    volSlider.value = String(el.mediaVolume ?? 0.25);
    volSlider.title = "Volume";
    volSlider.style.cssText =
      "width:50px;accent-color:#6366f1;cursor:pointer;flex-shrink:0;";
    const onVolChange = () => {
      const vol = parseFloat(volSlider.value);
      video.volume = vol;
      onVolumeChange?.(vol);
    };
    volSlider.addEventListener("input", onVolChange);
    volSlider.addEventListener("change", onVolChange);

    ctrl.appendChild(playBtn);
    ctrl.appendChild(seekBtn("−5s", -5));
    ctrl.appendChild(progress);
    ctrl.appendChild(seekBtn("+5s", 5));
    ctrl.appendChild(volSlider);
    ctrl.appendChild(timeDisplay);

    wrap.appendChild(videoArea);
    wrap.appendChild(ctrl);
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
    if (el.mediaCurrentTime && el.mediaCurrentTime > 0) {
      audio.addEventListener(
        "loadedmetadata",
        () => {
          audio.currentTime = el.mediaCurrentTime!;
        },
        { once: true },
      );
    }

    if (onMediaEvent) attachMediaListeners(audio, onMediaEvent);
    onMediaReady?.(audio);

    const wrap = document.createElement("div");
    wrap.style.cssText =
      "width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:8px;box-sizing:border-box;background:rgba(20,20,30,0.85);border-radius:8px;";

    const name = src.split("/").pop()?.split("?")[0] ?? "Audio";
    const label = document.createElement("span");
    label.textContent = "🔊 " + name;
    label.style.cssText =
      "color:#ccc;font-size:11px;font-family:Inter,sans-serif;text-align:center;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

    // Custom controls row
    const ctrl = document.createElement("div");
    ctrl.style.cssText = "display:flex;align-items:center;gap:4px;width:100%;";

    const playBtn = document.createElement("button");
    playBtn.textContent = "▶";
    playBtn.style.cssText =
      "background:none;border:none;color:#94a3b8;font-size:13px;cursor:pointer;padding:0 2px;line-height:1;flex-shrink:0;";
    playBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      audio.paused ? audio.play() : audio.pause();
    });
    audio.addEventListener("play", () => {
      playBtn.textContent = "⏸";
    });
    audio.addEventListener("pause", () => {
      playBtn.textContent = "▶";
    });

    const makeAudioSeekBtn = (label2: string, sec: number) => {
      const b = document.createElement("button");
      b.textContent = label2;
      b.style.cssText =
        "background:none;border:none;color:#64748b;font-size:9px;cursor:pointer;padding:0 1px;white-space:nowrap;flex-shrink:0;";
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const t = Math.max(
          0,
          Math.min(audio.duration || 0, audio.currentTime + sec),
        );
        audio.currentTime = t;
        onMediaEvent?.("seek", t);
      });
      return b;
    };

    const audioProgress = document.createElement("input");
    audioProgress.type = "range";
    audioProgress.min = "0";
    audioProgress.max = "100";
    audioProgress.value = "0";
    audioProgress.style.cssText =
      "flex:1;min-width:0;accent-color:#6366f1;cursor:pointer;";
    const onAudioProgress = () => {
      if (audio.duration) {
        const t = (Number(audioProgress.value) / 100) * audio.duration;
        audio.currentTime = t;
        onMediaEvent?.("seek", t);
      }
    };
    audioProgress.addEventListener("input", onAudioProgress);
    audioProgress.addEventListener("change", onAudioProgress);
    audio.addEventListener("timeupdate", () => {
      if (audio.duration)
        audioProgress.value = String(
          (audio.currentTime / audio.duration) * 100,
        );
    });

    const audioVol = document.createElement("input");
    audioVol.type = "range";
    audioVol.min = "0";
    audioVol.max = "1";
    audioVol.step = "0.01";
    audioVol.value = String(el.mediaVolume ?? 0.25);
    audioVol.title = "Volume";
    audioVol.style.cssText =
      "width:45px;accent-color:#6366f1;cursor:pointer;flex-shrink:0;";
    const onAudioVol = () => {
      const vol = parseFloat(audioVol.value);
      audio.volume = vol;
      onVolumeChange?.(vol);
    };
    audioVol.addEventListener("input", onAudioVol);
    audioVol.addEventListener("change", onAudioVol);

    ctrl.appendChild(playBtn);
    ctrl.appendChild(makeAudioSeekBtn("−5s", -5));
    ctrl.appendChild(audioProgress);
    ctrl.appendChild(makeAudioSeekBtn("+5s", 5));
    ctrl.appendChild(audioVol);

    wrap.appendChild(label);
    wrap.appendChild(ctrl);
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
}: {
  elements: CanvasElement[];
  selectedIds: Set<string>;
  onSelect: (id: string, multi: boolean) => void;
  onToggleVisible: (id: string) => void;
  onDelete: (id: string) => void;
  onGroup: () => void;
  onUngroup: () => void;
  onElementChange: (id: string, changes: Partial<CanvasElement>) => void;
}) {
  const slots = buildSlots(elements);
  const icon = (t: string) =>
    t === "image"
      ? "📷"
      : t === "gif"
        ? "🖼️"
        : t === "audio"
          ? "🔊"
          : t === "video"
            ? "🎬"
            : "✏️";
  const anyGrouped = [...selectedIds].some(
    (id) => elements.find((e) => e.id === id)?.groupId,
  );
  const canGroup = selectedIds.size >= 2;

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
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      title={label}
      style={{
        background: "none",
        border: "none",
        cursor: disabled ? "default" : "pointer",
        fontSize: 9,
        padding: "1px 2px",
        color: disabled ? "#2a2a2a" : "#555",
        lineHeight: 1,
        display: "block",
      }}
    >
      {label === "up" ? "▲" : "▼"}
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
        : el.type;
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
          borderLeft: sel ? "2px solid #6366f1" : "2px solid transparent",
        }}
      >
        <span style={{ fontSize: 10 }}>{icon(el.type)}</span>
        <span
          style={{
            fontSize: 11,
            flex: 1,
            color: el.visible ? "#ccc" : "#444",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "Inter,sans-serif",
          }}
        >
          {label}
        </span>
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
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisible(el.id);
          }}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 11,
            padding: "0 2px",
            color: el.visible ? "#555" : "#2a2a2a",
            flexShrink: 0,
          }}
        >
          {el.visible ? "👁" : "🚫"}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(el.id);
          }}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 9,
            padding: "0 2px",
            color: "#2a2a2a",
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>
    );
  };

  return (
    <div
      style={{
        width: 220,
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
          color: "#555",
          borderBottom: "1px solid #1e1e1e",
          fontFamily: "Inter,sans-serif",
          letterSpacing: "0.08em",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>LAYERS</span>
        <div style={{ display: "flex", gap: 4 }}>
          {canGroup && !anyGrouped && (
            <button
              onClick={onGroup}
              title="Group selected"
              style={{
                background: "#1e2030",
                border: "1px solid #334",
                borderRadius: 3,
                color: "#818cf8",
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
      <div style={{ flex: 1, overflowY: "auto" }}>
        {slots.length === 0 && (
          <div
            style={{
              padding: 16,
              fontSize: 11,
              color: "#333",
              textAlign: "center",
              fontFamily: "Inter,sans-serif",
            }}
          >
            No elements yet
          </div>
        )}
        {slots.map((slot, slotIdx) => {
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
                border: "1px solid rgba(99,102,241,0.45)",
                borderRadius: 5,
                background: "rgba(99,102,241,0.04)",
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
                    ? "rgba(99,102,241,0.14)"
                    : "rgba(99,102,241,0.07)",
                  borderBottom: "1px solid rgba(99,102,241,0.2)",
                }}
              >
                <span style={{ fontSize: 10, color: "#818cf8" }}>⊞</span>
                <span
                  style={{
                    fontSize: 11,
                    flex: 1,
                    color: "#818cf8",
                    fontFamily: "Inter,sans-serif",
                    fontWeight: 600,
                  }}
                >
                  Group{" "}
                  <span
                    style={{ color: "#555", fontWeight: 400, fontSize: 10 }}
                  >
                    ({slot.members.length})
                  </span>
                </span>
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
                    fontSize: 11,
                    padding: "0 2px",
                    color: allVisible ? "#818cf8" : "#2a2a2a",
                    flexShrink: 0,
                  }}
                >
                  {allVisible ? "👁" : "🚫"}
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live cursors
// ---------------------------------------------------------------------------
function LiveCursors({
  cursors,
  pan,
  zoom,
}: {
  cursors: Map<string, CursorPayload>;
  pan: { x: number; y: number };
  zoom: number;
}) {
  return (
    <>
      {[...cursors.values()].map((c) => (
        <div
          key={c.userId}
          style={{
            position: "absolute",
            left: c.x * zoom + pan.x,
            top: c.y * zoom + pan.y,
            pointerEvents: "none",
            zIndex: 1000,
            transition: "left 60ms linear, top 60ms linear",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 20 20">
            <path
              d="M4 2L16 10L10 11L7 18L4 2Z"
              fill={c.color}
              stroke="white"
              strokeWidth="1.5"
            />
          </svg>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              background: c.color,
              borderRadius: 4,
              padding: "2px 6px",
              whiteSpace: "nowrap",
              marginTop: 2,
            }}
          >
            <img
              src={c.avatar}
              alt=""
              style={{ width: 14, height: 14, borderRadius: "50%" }}
            />
            <span
              style={{
                fontSize: 11,
                color: "#fff",
                fontWeight: 600,
                fontFamily: "Inter, sans-serif",
              }}
            >
              {c.displayName}
            </span>
          </div>
        </div>
      ))}
    </>
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
      "position:absolute;border:1.5px dashed #6366f1;background:rgba(99,102,241,0.08);pointer-events:none;display:none;z-index:500;box-sizing:border-box;";
    wrapper.appendChild(marquee);

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target !== workspace && !target.classList.contains("viewport-rect"))
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
  directUpdateRef?: React.MutableRefObject<((id: string, changes: Partial<CanvasElement>) => void) | null>;
  showTwitchEmbed?: boolean;
  twitchChannel?: string;
  twitchPlayerRef?: React.MutableRefObject<any>;
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
  showTwitchEmbed = false,
  twitchChannel = "",
  twitchPlayerRef: externalTwitchPlayerRef,
}: CanvasStageProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const nodeMapRef = useRef<Map<string, HTMLElement>>(new Map());
  const mediaElMapRef = useRef<Map<string, HTMLMediaElement>>(new Map());
  const groupBoxMapRef = useRef<Map<string, HTMLElement>>(new Map());
  const twitchEmbedRef = useRef<HTMLDivElement>(null);
  const twitchInitedRef = useRef(false);
  const twitchPlayerRef = useRef<any>(null);

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

    if (directUpdateRef) {
      directUpdateRef.current = (id: string, changes: Partial<CanvasElement>) => {
        const n = nodeMap.get(id);
        if (!n || draggingRef.current.has(id)) return;
        if (changes.x != null) n.style.left = changes.x + 'px';
        if (changes.y != null) n.style.top = changes.y + 'px';
        if (changes.width != null) n.style.width = changes.width + 'px';
        if (changes.height != null) n.style.height = changes.height + 'px';
        if (changes.rotation != null) { setRotation(n, changes.rotation); applyNodeTransform(n); }
        if (changes.scaleX != null || changes.scaleY != null) {
          setScale(n, changes.scaleX ?? 1, changes.scaleY ?? 1);
          applyNodeTransform(n);
        }
        // Mark node so the DOM sync effect skips geometry this frame
        (n as any).__directUpdatedAt = Date.now();
      };
    }

    // Remove deleted nodes
    for (const [id, node] of nodeMap) {
      if (!presentIds.has(id)) {
        node.remove();
        nodeMap.delete(id);
        mediaElMap.delete(id);
      }
    }

    for (const el of elements) {
      let node = nodeMap.get(el.id);

      if (!node) {
        node = document.createElement("div");
        node.dataset.id = el.id;
        node.style.cssText =
          "position:absolute;cursor:move;transform-origin:center center;box-sizing:border-box;";

        node.appendChild(
          createMediaElement(el, {
            onMediaEvent: onMediaControl
              ? (action, currentTime) =>
                  onMediaControl(el.id, action, currentTime)
              : undefined,
            onMediaReady: (media) => mediaElMap.set(el.id, media),
            onVolumeChange: (vol) =>
              onElementChange(el.id, { mediaVolume: vol }),
          }),
        );

        // Selection border
        const selBorder = document.createElement("div");
        selBorder.className = "sel-border";
        selBorder.style.cssText =
          "position:absolute;inset:-2px;pointer-events:none;border:2px solid #6366f1;display:none;border-radius:1px;";
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
          addResizeHandle(node, pos, getZoom, (changes) =>
            onElementChange(el.id, changes),
          );
        }

        // Delete button
        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "✕";
        deleteBtn.style.cssText =
          "position:absolute;top:-12px;right:-12px;background:#ef4444;color:white;border:none;cursor:pointer;font-size:10px;width:18px;height:18px;z-index:30;border-radius:50%;display:none;line-height:1;padding:0;";
        deleteBtn.className = "delete-btn";
        deleteBtn.onclick = (e) => {
          e.stopPropagation();
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

        makeDraggable(
          node,
          getZoom,
          (changes) => onElementChange(el.id, changes),
          (dx, dy, final) => {
            // Move all other group members
            const thisEl = elementsRef.current.find((e) => e.id === el.id);
            if (!thisEl?.groupId) return;
            for (const other of elementsRef.current) {
              if (other.id === el.id || other.groupId !== thisEl.groupId)
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
              // Always emit so all clients + overlay see the whole group move together
              onElementChange(other.id, { x: nx, y: ny });
              if (final) {
                delete otherNode.dataset.startLeft;
                delete otherNode.dataset.startTop;
              }
            }
          },
          el.type === "text" ? () => onEditText?.(el.id) : null,
          { onDragStart, onDragEnd },
        );

        workspace.appendChild(node);
        nodeMap.set(el.id, node);
      }

      // Update attrs — skip geometry if node is being dragged or was just direct-updated
      const sx = el.scaleX ?? 1,
        sy = el.scaleY ?? 1,
        rot = el.rotation ?? 0;
      const recentlyDirect = ((node as any).__directUpdatedAt ?? 0) > Date.now() - 200;
      if (!draggingRef.current.has(el.id) && !recentlyDirect) {
        node.style.left = el.x + "px";
        node.style.top = el.y + "px";
        node.style.width = el.width + "px";
        node.style.height = el.height + "px";
      } else if (!recentlyDirect) {
        node.style.width = el.width + "px";
        node.style.height = el.height + "px";
      }
      node.style.opacity = el.visible ? "1" : "0.2";
      node.style.zIndex = String(el.zIndex);
      if (!recentlyDirect) {
        setScale(node, sx, sy);
        setRotation(node, rot);
        applyNodeTransform(node);
      }

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
      }

      // Sync volume from element state to media element + slider UI
      if (el.type === "video" || el.type === "audio") {
        const vol = el.mediaVolume ?? 0.25;
        const media = mediaElMapRef.current.get(el.id);
        if (media && Math.abs(media.volume - vol) > 0.001) media.volume = vol;
        const slider = node.querySelector<HTMLInputElement>(
          "input[type=range][title='Volume']",
        );
        if (slider && Math.abs(parseFloat(slider.value) - vol) > 0.001)
          slider.value = String(vol);
      }

      // Group indicator — dashed outline per element
      node.style.outline = el.groupId
        ? "1px dashed rgba(99,102,241,0.35)"
        : "none";

      // Selection UI
      const isSelected = selectedIds.has(el.id);
      node.querySelector<HTMLElement>(".sel-border")!.style.display = isSelected
        ? "block"
        : "none";
      node.querySelector<HTMLElement>(".delete-btn")!.style.display = isSelected
        ? "block"
        : "none";
      for (const h of node.querySelectorAll<HTMLElement>(".rh")) {
        h.style.display = isSelected ? "block" : "none";
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
      const minX = Math.min(...members.map((e) => e.x)) - PAD;
      const minY = Math.min(...members.map((e) => e.y)) - PAD;
      const maxX = Math.max(...members.map((e) => e.x + e.width)) + PAD;
      const maxY = Math.max(...members.map((e) => e.y + e.height)) + PAD;

      let box = groupBoxMap.get(gid);
      if (!box) {
        box = document.createElement("div");
        box.style.cssText =
          "position:absolute;border:1.5px dashed rgba(99,102,241,0.45);background:rgba(99,102,241,0.04);pointer-events:none;border-radius:4px;z-index:0;";
        workspace.insertBefore(box, workspace.firstChild);
        groupBoxMap.set(gid, box);
      }
      box.style.left = minX + "px";
      box.style.top = minY + "px";
      box.style.width = maxX - minX + "px";
      box.style.height = maxY - minY + "px";
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

  // Expose applyControl for incoming remote media:control events
  useEffect(() => {
    if (!mediaControlRef) return;
    mediaControlRef.current = (payload) => {
      const media = mediaElMapRef.current.get(payload.id);
      if (!media) return;
      (media as any).__applyingRemote = true;
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

  // Twitch embed — init once the pan is set (ResizeObserver has fired) and embed is shown
  useEffect(() => {
    const div = twitchEmbedRef.current;
    if (!div || !twitchChannel) return;
    // panState starts at {x:0,y:0}; wait until ResizeObserver has set a real pan value
    const panIsSet = panState.x !== 0 || panState.y !== 0;
    if (showTwitchEmbed) {
      div.style.display = "block";
      if (!twitchInitedRef.current && panIsSet) {
        twitchInitedRef.current = true;
        const Twitch = (window as any).Twitch;
        if (!Twitch) return;
        const embed = new Twitch.Embed(div, {
          width: "100%",
          height: "100%",
          channel: "vicksy",
          layout: "video",
          autoplay: true,
          muted: true,
          parent: ["localhost", "shared-obs-overlay.onrender.com"],
        });
        embed.addEventListener(Twitch.Embed.VIDEO_READY, () => {
          const player = embed.getPlayer();
          twitchPlayerRef.current = player;
          if (externalTwitchPlayerRef) externalTwitchPlayerRef.current = player;
          player.setMuted(true);
          player.setVolume(0);
        });
      }
    } else {
      div.style.display = "none";
    }
  }, [showTwitchEmbed, twitchChannel, panState, externalTwitchPlayerRef]);

  return (
    <div
      ref={wrapperRef}
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
      {/* Twitch embed — rendered before workspace so it sits behind canvas elements */}
      <div
        ref={twitchEmbedRef}
        style={{
          position: "absolute",
          left: Math.round(STREAM_OFFSET_X * zoomState + panState.x),
          top: Math.round(STREAM_OFFSET_Y * zoomState + panState.y),
          width: Math.round(STREAM_W * zoomState),
          height: Math.round(STREAM_H * zoomState),
          display: "none",
          pointerEvents: "none",
          overflow: "hidden",
        }}
      />
      <div
        ref={workspaceRef}
        id="viewport"
        style={{
          position: "absolute",
          transformOrigin: "0 0",
          width: WORKSPACE_W,
          height: WORKSPACE_H,
          background: "transparent",
        }}
      >
        <div
          className="viewport-rect"
          style={{
            position: "absolute",
            left: STREAM_OFFSET_X,
            top: STREAM_OFFSET_Y - 22,
            fontSize: 10,
            color: "#6366f1",
            fontFamily: "Inter,sans-serif",
            pointerEvents: "none",
            userSelect: "none",
            whiteSpace: "nowrap",
          }}
        >
          1920 × 1080 — stream viewport
        </div>
        <div
          className="viewport-rect"
          style={{
            position: "absolute",
            left: STREAM_OFFSET_X,
            top: STREAM_OFFSET_Y,
            width: STREAM_W,
            height: STREAM_H,
            background: showTwitchEmbed ? "transparent" : "#1a1a2e",
            outline: "2px solid #6366f1",
            boxSizing: "border-box",
            pointerEvents: "none",
          }}
        />
      </div>
      <LiveCursors cursors={cursors} pan={panState} zoom={zoomState} />
      <div
        style={{
          position: "absolute",
          bottom: 12,
          right: 12,
          display: "flex",
          gap: 6,
          userSelect: "none",
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            background: "rgba(0,0,0,0.7)",
            color: "#444",
            fontSize: 10,
            padding: "3px 8px",
            borderRadius: 4,
            fontFamily: "Inter,sans-serif",
          }}
        >
          Drag bg to pan · Middle mouse to pan · Scroll to zoom · Right-drag to
          rotate · Dbl-click text to edit · Del to remove
        </span>
        <button
          onClick={resetView}
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

export const OverlayStage = forwardRef<
  OverlayStageHandle,
  { elements: CanvasElement[] }
>(function OverlayStage({ elements }, ref) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const nodeMapRef = useRef<Map<string, HTMLElement>>(new Map());
  const posMapRef = useRef<
    Map<string, { x: number; y: number; rotation: number }>
  >(new Map());
  const targetMapRef = useRef<
    Map<string, { x: number; y: number; rotation: number }>
  >(new Map());
  const animatingRef = useRef<Set<string>>(new Set());
  // Stores the actual HTMLMediaElement for each element id (video or hidden audio)
  const mediaElMapRef = useRef<Map<string, HTMLMediaElement>>(new Map());
  // Container for hidden audio elements
  const audioContainerRef = useRef<HTMLDivElement>(null);

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

        node.appendChild(
          createMediaElement(el, {
            isOverlay: true,
            onMediaReady: (media) => mediaElMap.set(el.id, media),
          }),
        );

        viewport.appendChild(node);
        const ox = el.x - STREAM_OFFSET_X, oy = el.y - STREAM_OFFSET_Y;
        nodeMap.set(el.id, node);
        posMap.set(el.id, { x: ox, y: oy, rotation: el.rotation ?? 0 });
        targetMap.set(el.id, { x: ox, y: oy, rotation: el.rotation ?? 0 });
        node.style.left = ox + "px";
        node.style.top = oy + "px";
        node.style.width = el.width + "px";
        node.style.height = el.height + "px";
        node.style.transform = `rotate(${el.rotation ?? 0}deg) scaleX(${sx}) scaleY(${sy})`;
        node.style.visibility = el.visible ? "visible" : "hidden";
      }

      node.style.width = el.width + "px";
      node.style.height = el.height + "px";
      node.style.visibility = el.visible ? "visible" : "hidden";

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

      targetMap.set(el.id, { x: el.x - STREAM_OFFSET_X, y: el.y - STREAM_OFFSET_Y, rotation: el.rotation ?? 0 });

      if (!animating.has(el.id)) {
        animating.add(el.id);
        const id = el.id;
        const FACTOR = 0.18;
        const animate = () => {
          const pos = posMap.get(id),
            target = targetMap.get(id),
            n = nodeMap.get(id);
          if (!pos || !target || !n) {
            animating.delete(id);
            return;
          }
          const curSx = el.scaleX ?? 1,
            curSy = el.scaleY ?? 1;
          pos.x += (target.x - pos.x) * FACTOR;
          pos.y += (target.y - pos.y) * FACTOR;
          pos.rotation = lerpAngle(pos.rotation, target.rotation, FACTOR);
          n.style.left = pos.x + "px";
          n.style.top = pos.y + "px";
          n.style.transform = `rotate(${pos.rotation}deg) scaleX(${curSx}) scaleY(${curSy})`;
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
            n.style.transform = `rotate(${target.rotation}deg) scaleX(${curSx}) scaleY(${curSy})`;
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
      {/* Hidden audio container */}
      <div ref={audioContainerRef} style={{ display: "none" }} />
    </div>
  );
});

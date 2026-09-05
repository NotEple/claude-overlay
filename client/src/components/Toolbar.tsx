import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { randomUUID } from "../utils";
import { TextDialog, encodeTextSrc } from "./TextDialog";
import type { TextConfig } from "./TextDialog";
import type { CanvasElement, MediaType } from "../types";
import { authHeaders } from "../hooks/useAuth";
import type { DrawToolMode } from "./DrawingCanvas";
import { useToast } from "./ToastProvider";
import { useConfirm } from "./ConfirmProvider";
import {
  Disc,
  Pencil,
  X,
  Eraser,
  PaintBucket,
  Pin,
  Trash2,
  ImagePlus,
  Type,
  Palette,
  SlidersHorizontal,
  Maximize2,
  Expand,
  FlipHorizontal2,
  FlipVertical2,
  Undo2,
  Redo2,
  Minus,
  ArrowRight,
  Square,
  Circle,
  Droplets,
} from "lucide-react";
import { STREAM_H, STREAM_OFFSET_X, STREAM_OFFSET_Y, STREAM_W } from "../canvas/config";
import { createDvdMotion, getDvdPosition } from "../canvas/dvdMotion";

const PRESET_COLORS = [
  "#ffffff",
  "#ff4444",
  "#ff9900",
  "#ffff00",
  "#44ff44",
  "#44aaff",
  "#aa44ff",
  "#ff44aa",
  "#000000",
];

interface ToolbarProps {
  onAdd: (element: CanvasElement) => void;
  onSaveSound: (item: { id: string; name: string; url: string; volume: number }) => void;
  drawMode: boolean;
  onDrawModeToggle: () => void;
  drawColor: string;
  onDrawColorChange: (c: string) => void;
  drawSize: number;
  onDrawSizeChange: (s: number) => void;
  drawOpacity: number;
  onDrawOpacityChange: (opacity: number) => void;
  fillTolerance: number;
  onFillToleranceChange: (tolerance: number) => void;
  toolMode: DrawToolMode;
  onToolModeChange: (m: DrawToolMode) => void;
  onDrawClear: () => void;
  onSaveDrawingAsElement: () => void;
  hasStrokes: boolean;
  strokeCount: number;
  selectedElement?: CanvasElement;
  onElementChange: (id: string, changes: Partial<CanvasElement>) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const ACCEPTED =
  "image/*,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg,.gif";
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
const BUTTON_HEIGHT = 30;
const ICON_SIZE = 15;
const TOOLBAR_FONT_SIZE = 12;
const INITIAL_MEDIA_MAX_WIDTH = 500;
const INITIAL_MEDIA_MAX_HEIGHT = 350;

async function getVisualMediaSize(file: File) {
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
    return null;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const dimensions = await new Promise<{ width: number; height: number }>(
      (resolve, reject) => {
        if (file.type.startsWith("image/")) {
          const image = new Image();
          image.onload = () =>
            resolve({ width: image.naturalWidth, height: image.naturalHeight });
          image.onerror = () => reject(new Error("Could not read image dimensions"));
          image.src = objectUrl;
          return;
        }

        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () =>
          resolve({ width: video.videoWidth, height: video.videoHeight });
        video.onerror = () => reject(new Error("Could not read video dimensions"));
        video.src = objectUrl;
      },
    );
    if (dimensions.width <= 0 || dimensions.height <= 0) return null;
    const scale = Math.min(
      1,
      INITIAL_MEDIA_MAX_WIDTH / dimensions.width,
      INITIAL_MEDIA_MAX_HEIGHT / dimensions.height,
    );
    return {
      width: Math.max(1, Math.round(dimensions.width * scale)),
      height: Math.max(1, Math.round(dimensions.height * scale)),
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function Toolbar({
  onAdd,
  onSaveSound,
  drawMode,
  onDrawModeToggle,
  drawColor,
  onDrawColorChange,
  drawSize,
  onDrawSizeChange,
  drawOpacity,
  onDrawOpacityChange,
  fillTolerance,
  onFillToleranceChange,
  toolMode,
  onToolModeChange,
  onDrawClear,
  onSaveDrawingAsElement,
  hasStrokes,
  strokeCount,
  selectedElement,
  onElementChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: ToolbarProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [showTextDialog, setShowTextDialog] = useState(false);
  const [uploading, setUploading] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  const fitSelected = (mode: "fit" | "fill") => {
    if (!selectedElement || selectedElement.width <= 0 || selectedElement.height <= 0) return;
    const factor = mode === "fit"
      ? Math.min(STREAM_W / selectedElement.width, STREAM_H / selectedElement.height)
      : Math.max(STREAM_W / selectedElement.width, STREAM_H / selectedElement.height);
    const width = selectedElement.width * factor;
    const height = selectedElement.height * factor;
    onElementChange(selectedElement.id, {
      x: STREAM_OFFSET_X + (STREAM_W - width) / 2,
      y: STREAM_OFFSET_Y + (STREAM_H - height) / 2,
      width,
      height,
      rotation: 0,
      scaleX: selectedElement.scaleX && selectedElement.scaleX < 0 ? -1 : 1,
      scaleY: selectedElement.scaleY && selectedElement.scaleY < 0 ? -1 : 1,
      dvdEnabled: false,
    });
  };

  const toggleDvd = () => {
    if (!selectedElement || selectedElement.type === "audio") return;
    if (selectedElement.dvdEnabled) {
      const position = getDvdPosition(selectedElement);
      onElementChange(selectedElement.id, { dvdEnabled: false, x: position.x, y: position.y });
      return;
    }
    onElementChange(selectedElement.id, createDvdMotion(selectedElement));
  };

  const flipSelected = (axis: "x" | "y") => {
    if (!selectedElement || !["image", "gif", "video"].includes(selectedElement.type)) return;
    onElementChange(selectedElement.id, axis === "x"
      ? { scaleX: -(selectedElement.scaleX ?? 1) }
      : { scaleY: -(selectedElement.scaleY ?? 1) });
  };

  const uploadMediaFile = async (file: File) => {
    setUploading(true);
    const visualSizePromise = getVisualMediaSize(file).catch(() => null);
    const body = new FormData();
    body.append("file", file);
    try {
      const res = await fetch(`${SERVER_URL}/upload`, {
        method: "POST",
        body,
        credentials: "include",
        headers: authHeaders(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Upload failed (${res.status})`);
      }
      const { url, mimetype } = await res.json();
      const visualSize = await visualSizePromise;
      const type: MediaType = mimetype.startsWith("audio")
        ? "audio"
        : mimetype.startsWith("video")
          ? "video"
          : mimetype === "image/gif"
            ? "gif"
            : "image";
      const mediaUrl = `${SERVER_URL}${url}`;
      onAdd({
        id: randomUUID(),
        type,
        src: mediaUrl,
        displayName: file.name,
        x: 200,
        y: 200,
        width: type === "audio" ? 360 : (visualSize?.width ?? 400),
        height: type === "audio" ? 86 : (visualSize?.height ?? 225),
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        visible: true,
        zIndex: Date.now(),
      });
      toast.success(`${file.name} added to the canvas`);
      if (type === "audio" && await confirm({
        title: "Add to Soundboard?",
        message: "Soundboard clips can play on OBS without creating or showing a canvas layer.",
        confirmLabel: "Add sound",
      })) {
        onSaveSound({
          id: randomUUID(),
          name: file.name.replace(/\.[^.]+$/, ""),
          url: mediaUrl,
          volume: 0.25,
        });
        toast.success(`${file.name} also added to the Soundboard`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Media upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await uploadMediaFile(file);
    e.target.value = "";
  };

  useEffect(() => {
    const dropTarget = () => document.querySelector<HTMLElement>("[data-media-drop-target]");
    const insideTarget = (event: DragEvent) => {
      const target = dropTarget();
      if (!target) return false;
      const rect = target.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    };
    const clear = () => dropTarget()?.classList.remove("media-drop-active");
    const dragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files") || !insideTarget(event)) { clear(); return; }
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      dropTarget()?.classList.add("media-drop-active");
    };
    const drop = (event: DragEvent) => {
      const accepted = insideTarget(event);
      clear();
      if (!accepted || !event.dataTransfer?.files.length) return;
      event.preventDefault();
      const files = [...event.dataTransfer.files];
      if (files.length > 1) toast.info("Uploading the first dropped file");
      void uploadMediaFile(files[0]);
    };
    window.addEventListener("dragover", dragOver, true);
    window.addEventListener("drop", drop, true);
    window.addEventListener("dragleave", clear);
    return () => { window.removeEventListener("dragover", dragOver, true); window.removeEventListener("drop", drop, true); window.removeEventListener("dragleave", clear); };
  });

  const handleTextConfirm = (config: TextConfig) => {
    onAdd({
      id: randomUUID(),
      type: "text",
      src: encodeTextSrc(config),
      x: 200,
      y: 200,
      width: 400,
      height: 80,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      visible: true,
      zIndex: Date.now(),
    });
    setShowTextDialog(false);
    toast.success("Text element added to the canvas");
  };

  const toolBtn = (label: ReactNode, mode: DrawToolMode, title: string) => (
    <button
      className="ui-button"
      onClick={() => onToolModeChange(mode)}
      title={title}
      style={{
        height: BUTTON_HEIGHT,
        padding: "0 11px",
        background: toolMode === mode ? "var(--accent-solid)" : "#202020",
        border: `1px solid ${toolMode === mode ? "var(--accent-border)" : "#3a3a3a"}`,
        borderRadius: 5,
        color: toolMode === mode ? "var(--accent-contrast)" : "var(--text-secondary)",
        fontSize: TOOLBAR_FONT_SIZE,
        cursor: "pointer",
        fontFamily: "Inter, sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        boxSizing: "border-box",
        whiteSpace: "nowrap",
        lineHeight: 1,
      }}
    >
      {label}
    </button>
  );

  const btn = (
    label: ReactNode,
    onClick: () => void,
    active = false,
    title?: string,
    variant: "default" | "primary" | "danger" = "default",
  ) => (
    <button
      className="ui-button"
      onClick={onClick}
      title={title}
      style={{
        height: BUTTON_HEIGHT,
        padding: "0 11px",
        background: variant === "danger"
          ? "#7f1d1d"
          : variant === "primary" || active
            ? "var(--accent-solid)"
            : "#202020",
        border: `1px solid ${variant === "danger" ? "#ef4444" : variant === "primary" || active ? "var(--accent-border)" : "#3a3a3a"}`,
        borderRadius: 5,
        color: variant === "danger"
          ? "#fee2e2"
          : variant === "primary" || active
            ? "var(--accent-contrast)"
            : "var(--text-secondary)",
        fontSize: TOOLBAR_FONT_SIZE,
        cursor: "pointer",
        fontFamily: "Inter, sans-serif",
        whiteSpace: "nowrap",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        boxSizing: "border-box",
        lineHeight: 1,
      }}
    >
      {label}
    </button>
  );

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          background: "#141414",
          borderBottom: "1px solid #222",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED}
          style={{ display: "none" }}
          onChange={handleFile}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <button className="ui-icon-button" onClick={onUndo} disabled={!canUndo} title="Undo the latest canvas change (Ctrl+Z)" style={{ background: "#202020", border: "1px solid #3a3a3a", color: canUndo ? "#d6d9df" : "#555", cursor: canUndo ? "pointer" : "not-allowed" }}><Undo2 size={ICON_SIZE}/></button>
          <button className="ui-icon-button" onClick={onRedo} disabled={!canRedo} title="Redo the latest undone canvas change (Ctrl+Y)" style={{ background: "#202020", border: "1px solid #3a3a3a", color: canRedo ? "#d6d9df" : "#555", cursor: canRedo ? "pointer" : "not-allowed" }}><Redo2 size={ICON_SIZE}/></button>
        </div>
        <div style={{ width: 1, height: 24, background: "#2a2a2a", margin: "0 2px" }} />

        {!drawMode && (
          <>
            <button
              className="ui-button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              title="Upload an image, GIF, video, or audio file"
              style={{
                height: BUTTON_HEIGHT,
                padding: "0 11px",
                background: "var(--accent-solid)",
                border: "1px solid var(--accent-border)",
                borderRadius: 5,
                color: "var(--accent-contrast)",
                fontSize: TOOLBAR_FONT_SIZE,
                cursor: uploading ? "not-allowed" : "pointer",
                opacity: uploading ? 0.6 : 1,
                fontFamily: "Inter, sans-serif",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                boxSizing: "border-box",
                whiteSpace: "nowrap",
                lineHeight: 1,
              }}
            >
              <ImagePlus size={ICON_SIZE} />
              {uploading ? "Uploading…" : "Add media"}
            </button>
            {btn(
              <>
                <Type size={ICON_SIZE} /> Text
              </>,
              () => setShowTextDialog(true),
              false,
              "Add text",
            )}
            <div
              style={{
                width: 1,
                height: 24,
                background: "#2a2a2a",
                margin: "0 2px",
              }}
            />
          </>
        )}

        {btn(
          drawMode ? (
            <>
              <X size={ICON_SIZE} /> Exit Draw
            </>
          ) : (
            <>
              <Pencil size={ICON_SIZE} /> Draw
            </>
          ),
          onDrawModeToggle,
          drawMode,
          "Toggle drawing mode",
        )}

        {!drawMode && selectedElement && !selectedElement.locked && (
          <>
            <div style={{ width: 1, height: 24, background: "#2a2a2a", margin: "0 2px" }} />
            <span style={{ color: "#7f8997", fontSize: 10, fontWeight: 700 }}>SELECTED</span>
            {btn(<><Maximize2 size={ICON_SIZE}/> Fit</>, () => fitSelected("fit"), false, "Fit selected element inside the Twitch viewport")}
            {btn(<><Expand size={ICON_SIZE}/> Fill</>, () => fitSelected("fill"), false, "Fill the Twitch viewport with the selected element")}
            {selectedElement.type !== "audio" && btn(<><Disc size={ICON_SIZE}/> DVD</>, toggleDvd, Boolean(selectedElement.dvdEnabled), selectedElement.dvdEnabled ? "Stop DVD movement" : "Start DVD movement")}
            {["image", "gif", "video"].includes(selectedElement.type) && (
              <>
                {btn(<><FlipHorizontal2 size={ICON_SIZE}/> Flip X</>, () => flipSelected("x"), (selectedElement.scaleX ?? 1) < 0, "Mirror selected media left to right")}
                {btn(<><FlipVertical2 size={ICON_SIZE}/> Flip Y</>, () => flipSelected("y"), (selectedElement.scaleY ?? 1) < 0, "Mirror selected media top to bottom")}
              </>
            )}
            {selectedElement.type === "video" && (
              btn(<>Auto</>, () => onElementChange(selectedElement.id, { autoVisibility: !selectedElement.autoVisibility }), Boolean(selectedElement.autoVisibility), selectedElement.autoVisibility ? "Disable automatic show on play and hide on end" : "Automatically show on play and hide when the video ends")
            )}
          </>
        )}

        {drawMode && (
          <>
            <span className="drawing-action-count" title="Completed drawing actions; each stroke, shape, or fill can be undone separately">
              DRAWING · {strokeCount}
            </span>
            {/* Tool buttons */}
            {toolBtn(
              <>
                <Pencil size={ICON_SIZE} /> Pen
              </>,
              "pen",
              "Freehand pen",
            )}
            {toolBtn(
              <>
                <Eraser size={ICON_SIZE} /> Erase
              </>,
              "eraser",
              "Eraser",
            )}
            {toolBtn(
              <>
                <PaintBucket size={ICON_SIZE} /> Fill
              </>,
              "fill",
              "Flood fill enclosed area",
            )}
            {toolBtn(<><Minus size={ICON_SIZE} /> Line</>, "line", "Draw a straight line. Hold Shift to snap it to 45-degree angles")}
            {toolBtn(<><ArrowRight size={ICON_SIZE} /> Arrow</>, "arrow", "Draw an arrow. Hold Shift to snap it to 45-degree angles")}
            {toolBtn(<><Square size={ICON_SIZE} /> Box</>, "rectangle", "Draw a rectangle. Hold Shift to make a square")}
            {toolBtn(<><Circle size={ICON_SIZE} /> Oval</>, "ellipse", "Draw an ellipse. Hold Shift to make a circle")}

            <div
              style={{
                width: 1,
                height: 24,
                background: "#2a2a2a",
                margin: "0 2px",
              }}
            />

            {/* Color swatches */}
            <div
              style={{
                height: BUTTON_HEIGHT,
                display: "flex",
                gap: 4,
                alignItems: "center",
                fontSize: TOOLBAR_FONT_SIZE,
                color: "#94a3b8",
                fontFamily: "Inter,sans-serif",
              }}
            >
              <Palette size={ICON_SIZE} />
              <span>Color</span>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    onDrawColorChange(c);
                    if (toolMode === "eraser" || toolMode === "fill")
                      onToolModeChange("pen");
                  }}
                  title={`Use ${c} as the drawing color`}
                  aria-label={`Use drawing color ${c}`}
                  style={{
                    width: 20,
                    height: 20,
                    background: c,
                    border:
                      drawColor === c && toolMode === "pen"
                        ? "2px solid #fff"
                        : "1.5px solid #555",
                    borderRadius: 3,
                    cursor: "pointer",
                    padding: 0,
                    flexShrink: 0,
                  }}
                />
              ))}
              <input
                type="color"
                value={drawColor}
                onChange={(e) => {
                  onDrawColorChange(e.target.value);
                  if (toolMode === "eraser" || toolMode === "fill")
                    onToolModeChange("pen");
                }}
                title="Choose a custom drawing color"
                style={{
                  width: 24,
                  height: 24,
                  padding: 0,
                  border: "1.5px solid #555",
                  borderRadius: 3,
                  cursor: "pointer",
                  background: "none",
                }}
              />
            </div>

            {/* Size slider — not shown for fill */}
            {toolMode !== "fill" && (
              <div
                style={{
                  height: BUTTON_HEIGHT,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <SlidersHorizontal size={ICON_SIZE} color="#94a3b8" />
                <span
                  style={{
                    fontSize: TOOLBAR_FONT_SIZE,
                    color: "#94a3b8",
                    fontFamily: "Inter,sans-serif",
                    whiteSpace: "nowrap",
                  }}
                >
                  Size
                </span>
                <input
                  type="range"
                  min="2"
                  max="60"
                  value={drawSize}
                  onChange={(e) => onDrawSizeChange(Number(e.target.value))}
                  style={{ width: 80, accentColor: "var(--accent-border)" }}
                />
                <span
                  style={{
                    fontSize: TOOLBAR_FONT_SIZE,
                    color: "#94a3b8",
                    fontFamily: "Inter,sans-serif",
                    minWidth: 20,
                  }}
                >
                  {drawSize}
                </span>
              </div>
            )}

            <div className="draw-setting" title="Set drawing opacity">
              <Droplets size={ICON_SIZE} />
              <span>Opacity</span>
              <input
                type="range"
                min="0.05"
                max="1"
                step="0.05"
                value={drawOpacity}
                onChange={(event) => onDrawOpacityChange(Number(event.target.value))}
              />
              <output>{Math.round(drawOpacity * 100)}%</output>
            </div>

            {toolMode === "fill" && (
              <div className="draw-setting" title="How closely pixels must match for flood fill; lower values stop at sharper boundaries">
                <SlidersHorizontal size={ICON_SIZE} />
                <span>Tolerance</span>
                <input
                  type="range"
                  min="0"
                  max="160"
                  step="8"
                  value={fillTolerance}
                  onChange={(event) => onFillToleranceChange(Number(event.target.value))}
                />
                <output>{fillTolerance}</output>
              </div>
            )}

            {hasStrokes &&
              btn(
                <>
                  <Pin size={ICON_SIZE} /> Add as Element
                </>,
                onSaveDrawingAsElement,
                false,
                "Convert drawing to a draggable element",
                "primary",
              )}
            {hasStrokes &&
              btn(
                <>
                  <Trash2 size={ICON_SIZE} /> Clear
                </>,
                onDrawClear,
                false,
                "Clear all drawing",
                "danger",
              )}
          </>
        )}

      </div>

      {showTextDialog && (
        <TextDialog
          onConfirm={handleTextConfirm}
          onClose={() => setShowTextDialog(false)}
        />
      )}
    </>
  );
}

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { randomUUID } from "../utils";
import { TextDialog, encodeTextSrc } from "./TextDialog";
import type { TextConfig } from "./TextDialog";
import type { CanvasElement, MediaType } from "../types";
import { authHeaders } from "../hooks/useAuth";
import type { DrawToolMode } from "./DrawingCanvas";
import { useToast } from "./ToastProvider";
import {
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
} from "lucide-react";

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
  drawMode: boolean;
  onDrawModeToggle: () => void;
  drawColor: string;
  onDrawColorChange: (c: string) => void;
  drawSize: number;
  onDrawSizeChange: (s: number) => void;
  toolMode: DrawToolMode;
  onToolModeChange: (m: DrawToolMode) => void;
  onDrawClear: () => void;
  onSaveDrawingAsElement: () => void;
  hasStrokes: boolean;
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
  drawMode,
  onDrawModeToggle,
  drawColor,
  onDrawColorChange,
  drawSize,
  onDrawSizeChange,
  toolMode,
  onToolModeChange,
  onDrawClear,
  onSaveDrawingAsElement,
  hasStrokes,
}: ToolbarProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [showTextDialog, setShowTextDialog] = useState(false);
  const [uploading, setUploading] = useState(false);
  const toast = useToast();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const { url, mimetype } = await res.json();
      const visualSize = await visualSizePromise;
      const type: MediaType = mimetype.startsWith("audio")
        ? "audio"
        : mimetype.startsWith("video")
          ? "video"
          : mimetype === "image/gif"
            ? "gif"
            : "image";
      onAdd({
        id: randomUUID(),
        type,
        src: `${SERVER_URL}${url}`,
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
    } catch {
      toast.error("Media upload failed. Check that the server is running and the file type is supported.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

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
  ) => (
    <button
      className="ui-button"
      onClick={onClick}
      title={title}
      style={{
        height: BUTTON_HEIGHT,
        padding: "0 11px",
        background: active ? "var(--accent-solid)" : "#202020",
        border: `1px solid ${active ? "var(--accent-border)" : "#3a3a3a"}`,
        borderRadius: 5,
        color: active ? "var(--accent-contrast)" : "var(--text-secondary)",
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
              {uploading ? "Uploading…" : "Media"}
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

        {drawMode && (
          <>
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
                  if (toolMode !== "pen") onToolModeChange("pen");
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

            {hasStrokes &&
              btn(
                <>
                  <Pin size={ICON_SIZE} /> Add as Element
                </>,
                onSaveDrawingAsElement,
                false,
                "Convert drawing to a draggable element",
              )}
            {hasStrokes &&
              btn(
                <>
                  <Trash2 size={ICON_SIZE} /> Clear
                </>,
                onDrawClear,
                false,
                "Clear all drawing",
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

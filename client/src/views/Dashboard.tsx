import { useState, useCallback, useRef, useEffect } from "react";
import {
  CanvasStage,
  ElementPanel,
  SPAWN_X,
  SPAWN_Y,
  WORKSPACE_W,
  WORKSPACE_H,
} from "../components/CanvasStage";
import { DrawingCanvas, renderAction } from "../components/DrawingCanvas";
import type { DrawToolMode } from "../components/DrawingCanvas";
import { Toolbar } from "../components/Toolbar";
import { WhitelistPanel } from "../components/WhitelistPanel";
import {
  TextDialog,
  encodeTextSrc,
  decodeTextSrc,
} from "../components/TextDialog";
import { useSocket } from "../hooks/useSocket";
import { randomUUID } from "../utils";
import type { AuthUser } from "../hooks/useAuth";
import { authHeaders } from "../hooks/useAuth";
import type { CanvasElement, MediaControlPayload } from "../types";
import { RotateCcw, Settings } from "lucide-react";
import { useToast } from "../components/ToastProvider";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
type DashboardTheme = "fox" | "custom";
const THEME_STORAGE_KEY = "dashboard_theme";
const CUSTOM_ACCENT_STORAGE_KEY = "dashboard_custom_accent";

function customAccentVariables(hex: string) {
  const value = hex.replace("#", "");
  const rgb = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  const mix = (target: number, amount: number) => `#${rgb.map((channel) => Math.round(channel + (target - channel) * amount).toString(16).padStart(2, "0")).join("")}`;
  return {
    "--accent-solid": hex,
    "--accent-border": mix(255, 0.18),
    "--accent-text": mix(255, 0.38),
    "--accent-surface": mix(0, 0.72),
    "--accent-surface-strong": mix(0, 0.56),
    "--accent-rgb": rgb.join(", "),
    "--accent-contrast": luminance > 0.58 ? "#111827" : "#ffffff",
  } as React.CSSProperties;
}

interface DashboardProps {
  user: AuthUser;
  onLogout: () => void;
  onSessionRevoked: () => void;
  onRoleUpdated: () => void;
}

export function Dashboard({
  user,
  onLogout,
  onSessionRevoked,
  onRoleUpdated,
}: DashboardProps) {
  const toast = useToast();
  const dashboardControlRef = useRef<
    ((payload: MediaControlPayload) => void) | null
  >(null);
  const directUpdateRef = useRef<
    ((id: string, changes: Partial<CanvasElement>) => void) | null
  >(null);

  const handleIncomingMediaControl = useCallback(
    (payload: MediaControlPayload) => {
      dashboardControlRef.current?.(payload);
    },
    [],
  );

  const {
    elements,
    connected,
    overlayConnected,
    overlayCount,
    cursors,
    activeUsers,
    showCursorOnOverlay,
    setShowCursorOnOverlay,
    dvdCelebrationSettings,
    setDvdCelebrationSettings,
    strokes,
    liveStrokes,
    addElement,
    updateElement,
    removeElement,
    sendCursor,
    emitMediaControl,
    refreshOverlay,
    addStroke,
    clearStrokes,
    sendLiveStroke,
  } = useSocket({
    mode: "dashboard",
    onSessionRevoked,
    onRoleUpdated,
    onMediaControl: handleIncomingMediaControl,
    directUpdateRef,
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const copiedElementsRef = useRef<CanvasElement[]>([]);
  const [showWhitelist, setShowWhitelist] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [drawColor, setDrawColor] = useState("#ff4444");
  const [drawSize, setDrawSize] = useState(6);
  const [toolMode, setToolMode] = useState<DrawToolMode>("pen");
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [showTwitchEmbed, setShowTwitchEmbed] = useState(true);
  const [twitchChannel, setTwitchChannel] = useState<"vicksy" | "wixels">(
    "vicksy",
  );
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [dvdSoundUploading, setDvdSoundUploading] = useState(false);
  const [presenceMenuOpen, setPresenceMenuOpen] = useState(false);
  const [theme, setTheme] = useState<DashboardTheme>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "custom" || saved === "indigo" ? "custom" : "fox";
  });
  const [customAccent, setCustomAccent] = useState(() => localStorage.getItem(CUSTOM_ACCENT_STORAGE_KEY) ?? "#4f46e5");

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);
  useEffect(() => { localStorage.setItem(CUSTOM_ACCENT_STORAGE_KEY, customAccent); }, [customAccent]);

  const handleDvdSoundUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setDvdSoundUploading(true);
      try {
        const body = new FormData();
        body.append("file", file);
        const response = await fetch(`${SERVER_URL}/upload`, {
          method: "POST",
          body,
          credentials: "include",
          headers: authHeaders(),
        });
        if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
        const { url } = await response.json();
        setDvdCelebrationSettings({
          ...dvdCelebrationSettings,
          soundUrl: `${SERVER_URL}${url}`,
        });
        toast.success(`${file.name} is now the DVD corner sound`);
      } catch (error) {
        console.error("DVD celebration sound upload failed", error);
        toast.error("DVD sound upload failed. Use an MP3, WAV, OGG, or WebM audio file.");
      } finally {
        setDvdSoundUploading(false);
        event.target.value = "";
      }
    },
    [dvdCelebrationSettings, setDvdCelebrationSettings, toast],
  );

  const handleSelect = useCallback(
    (id: string | null, multi = false) => {
      if (!id) {
        setSelectedIds(new Set());
        return;
      }

      const clickedEl = elements.find((e) => e.id === id);
      if (clickedEl?.groupId && !multi) {
        const groupMembers = elements
          .filter((e) => e.groupId === clickedEl.groupId)
          .map((e) => e.id);
        setSelectedIds(new Set(groupMembers));
        return;
      }

      setSelectedIds((prev) => {
        if (multi) {
          const n = new Set(prev);
          n.has(id) ? n.delete(id) : n.add(id);
          return n;
        }
        return new Set([id]);
      });
    },
    [elements],
  );

  const handleSelectMany = useCallback(
    (ids: string[]) => setSelectedIds(new Set(ids)),
    [],
  );

  const handleDelete = useCallback(
    (id: string) => {
      removeElement(id);
      setSelectedIds((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    },
    [removeElement],
  );

  const handleAdd = useCallback(
    (el: CanvasElement) => {
      addElement({ ...el, x: SPAWN_X, y: SPAWN_Y });
    },
    [addElement],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select") || target?.isContentEditable) return;

      if (event.key.toLowerCase() === "c") {
        const selected = elements.filter((element) => selectedIds.has(element.id));
        if (!selected.length) return;
        copiedElementsRef.current = selected.map((element) => ({ ...element }));
        event.preventDefault();
        toast.success(`Copied ${selected.length} element${selected.length === 1 ? "" : "s"}`);
        return;
      }

      if (event.key.toLowerCase() === "v" && copiedElementsRef.current.length) {
        event.preventDefault();
        const groupIds = new Map<string, string>();
        const topZ = elements.reduce((highest, element) => Math.max(highest, element.zIndex), Date.now());
        const copies = copiedElementsRef.current.map((element, index) => {
          let groupId = element.groupId;
          if (groupId) {
            if (!groupIds.has(groupId)) groupIds.set(groupId, randomUUID());
            groupId = groupIds.get(groupId)!;
          }
          return {
            ...element,
            id: randomUUID(),
            x: element.x + 32,
            y: element.y + 32,
            zIndex: topZ + index + 1,
            groupId,
            dvdEnabled: false,
          } satisfies CanvasElement;
        });
        copies.forEach(addElement);
        copiedElementsRef.current = copies.map((element) => ({ ...element }));
        setSelectedIds(new Set(copies.map((element) => element.id)));
        toast.success(`Pasted ${copies.length} element${copies.length === 1 ? "" : "s"}`);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addElement, elements, selectedIds, toast]);

  const handleGroup = useCallback(() => {
    const groupId = randomUUID();
    selectedIds.forEach((id) => updateElement(id, { groupId }));
  }, [selectedIds, updateElement]);

  const handleUngroup = useCallback(() => {
    // Send null — server and clients both treat null groupId as "clear group"
    selectedIds.forEach((id) => updateElement(id, { groupId: null }));
  }, [selectedIds, updateElement]);

  const handleEditText = useCallback((id: string) => {
    setEditingTextId(id);
  }, []);

  const handleTextUpdate = useCallback(
    (config: {
      text: string;
      color: string;
      fontSize: number;
      fontFamily: string;
    }) => {
      if (!editingTextId) return;
      updateElement(editingTextId, { src: encodeTextSrc(config) });
      setEditingTextId(null);
    },
    [editingTextId, updateElement],
  );

  const handleMediaControl = useCallback(
    (
      id: string,
      action: MediaControlPayload["action"],
      currentTime: number,
    ) => {
      emitMediaControl({ id, action, currentTime });
      // Persist playback position so refreshing users resume at the right spot
      const timeUpdate: Partial<import("../types").CanvasElement> = {
        mediaCurrentTime: currentTime,
      };
      if (action === "play") timeUpdate.mediaPaused = false;
      else if (action === "pause") timeUpdate.mediaPaused = true;
      updateElement(id, timeUpdate);
    },
    [emitMediaControl, updateElement],
  );

  const handleSaveDrawingAsElement = useCallback(async () => {
    if (strokes.length === 0) return;
    try {
      // Render the complete drawing first so fills and erased areas are included
      // when calculating the final transparent PNG bounds.
      const source = document.createElement("canvas");
      source.width = WORKSPACE_W;
      source.height = WORKSPACE_H;
      const sourceCtx = source.getContext("2d", { willReadFrequently: true })!;
      for (const action of strokes) renderAction(sourceCtx, action);

      const pixels = sourceCtx.getImageData(0, 0, WORKSPACE_W, WORKSPACE_H).data;
      let minX = WORKSPACE_W,
        minY = WORKSPACE_H,
        maxX = -1,
        maxY = -1;
      for (let y = 0; y < WORKSPACE_H; y++) {
        for (let x = 0; x < WORKSPACE_W; x++) {
          if (pixels[(y * WORKSPACE_W + x) * 4 + 3] === 0) continue;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
      if (maxX < minX || maxY < minY) return;

      const width = maxX - minX + 1;
      const height = maxY - minY + 1;
      const cropped = document.createElement("canvas");
      cropped.width = width;
      cropped.height = height;
      cropped
        .getContext("2d")!
        .drawImage(source, minX, minY, width, height, 0, 0, width, height);

      const blob = await new Promise<Blob>((resolve, reject) =>
        cropped.toBlob(
          (result) => (result ? resolve(result) : reject(new Error("PNG conversion failed"))),
          "image/png",
        ),
      );
      const body = new FormData();
      body.append("file", blob, `drawing-${Date.now()}.png`);
      const response = await fetch(`${SERVER_URL}/upload`, {
        method: "POST",
        body,
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error(`Drawing upload failed (${response.status})`);
      const { url } = await response.json();

      addElement({
        id: randomUUID(),
        type: "image",
        src: `${SERVER_URL}${url}`,
        x: minX,
        y: minY,
        width,
        height,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        visible: true,
        zIndex: Date.now(),
      });
      clearStrokes();
      toast.success("Drawing saved as a canvas element");
    } catch (error) {
      console.error("Could not convert drawing to an element:", error);
      toast.error("Could not save the drawing as an element. Your drawing was kept.");
      // Keep the strokes intact so a temporary upload failure never destroys work.
    }
  }, [strokes, addElement, clearStrokes, toast]);

  const isAdmin = user.isOwner || user.isAdmin;

  const editingTextEl = editingTextId
    ? elements.find((e) => e.id === editingTextId)
    : null;
  const editingTextConfig = editingTextEl
    ? decodeTextSrc(editingTextEl.src)
    : undefined;

  return (
    <div
      data-theme={theme}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#0d0d0d",
        color: "white",
        overflow: "hidden",
        ...(theme === "custom" ? customAccentVariables(customAccent) : {}),
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 12px",
          height: 48,
          background: "#111",
          borderBottom: "1px solid #222",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: "var(--accent-text)",
            letterSpacing: "0.05em",
          }}
        >
          OBS Overlay | Vicksy
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {isAdmin && (
            <>
              <button
                className="ui-icon-button"
                onClick={() => setShowWhitelist(true)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#ccc",
                  cursor: "pointer",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                }}
                title="Whitelist settings"
              >
                <Settings size={30} />
              </button>
            </>
          )}
          <button
            className="ui-button"
            onClick={() => setShowTwitchEmbed((v) => !v)}
            title={showTwitchEmbed ? "Hide the Twitch stream preview" : "Show the Twitch stream preview"}
            style={{
              background: showTwitchEmbed ? "var(--accent-surface)" : "none",
              border: showTwitchEmbed ? "1px solid var(--accent-border)" : "1px solid #333",
              color: showTwitchEmbed ? "var(--accent-text)" : "#ccc",
              cursor: "pointer",
              fontSize: 18,
              padding: "2px 8px",
              borderRadius: 4,
            }}
          >
            {showTwitchEmbed ? "Hide Stream" : "Show Stream"}
          </button>
          <button
            className="ui-button"
            onClick={() =>
              setTwitchChannel((channel) =>
                channel === "vicksy" ? "wixels" : "vicksy",
              )
            }
            style={{
              background: twitchChannel === "wixels" ? "var(--accent-surface)" : "none",
              border:
                twitchChannel === "wixels"
                  ? "1px solid var(--accent-border)"
                  : "1px solid #333",
              color: twitchChannel === "wixels" ? "var(--accent-text)" : "#ccc",
              cursor: "pointer",
              fontSize: 18,
              padding: "2px 8px",
              borderRadius: 4,
            }}
            title={`Currently showing ${twitchChannel}`}
          >
            Switch to {twitchChannel === "vicksy" ? "Wixels" : "Vicksy"}
          </button>
          <button
            className="ui-button"
            onClick={() => {
              refreshOverlay();
              toast.success("OBS overlay refresh requested");
            }}
            style={{
              background: "none",
              border: "1px solid #444",
              color: "#ccc",
              cursor: "pointer",
              fontSize: 18,
              padding: "2px 8px",
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
            title="Refresh OBS overlay (Refreshes the overlay on the streamers OBS)"
          >
            <RotateCcw size={14} /> Overlay
          </button>
        </div>
      </div>

      <Toolbar
        onAdd={handleAdd}
        drawMode={drawMode}
        onDrawModeToggle={() => setDrawMode((v) => !v)}
        drawColor={drawColor}
        onDrawColorChange={setDrawColor}
        drawSize={drawSize}
        onDrawSizeChange={setDrawSize}
        toolMode={toolMode}
        onToolModeChange={setToolMode}
        onDrawClear={() => {
          clearStrokes();
          toast.success("Drawing cleared");
        }}
        onSaveDrawingAsElement={handleSaveDrawingAsElement}
        hasStrokes={strokes.length > 0}
      />

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <ElementPanel
          elements={elements}
          selectedIds={selectedIds}
          onSelect={handleSelect}
          onToggleVisible={(id) => {
            const el = elements.find((e) => e.id === id);
            if (el) updateElement(id, { visible: !el.visible });
          }}
          onDelete={handleDelete}
          onGroup={handleGroup}
          onUngroup={handleUngroup}
          onElementChange={updateElement}
          footer={
            <div
              style={{
                position: "relative",
                borderTop: "1px solid #222",
                padding: 8,
                background: "#0d0d0d",
                flexShrink: 0,
              }}
            >
              {presenceMenuOpen && (
                <div
                  style={{
                    position: "absolute",
                    left: 8,
                    right: 8,
                    bottom: "calc(100% + 6px)",
                    padding: 7,
                    background: "#181818",
                    border: "1px solid #333",
                    borderRadius: 6,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
                    zIndex: 2000,
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gap: 5,
                      padding: "3px 4px 8px",
                      marginBottom: 6,
                      borderBottom: "1px solid #2a2a2a",
                      fontSize: 11,
                      color: "#b6beca",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: overlayConnected ? "#4ade80" : "#f87171",
                        }}
                      />
                      OBS overlay: {overlayConnected ? "online" : "offline"}
                      {overlayCount > 1 ? ` (${overlayCount} sources)` : ""}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: connected ? "#4ade80" : "#f87171",
                        }}
                      />
                      Dashboard server: {connected ? "connected" : "disconnected"}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: "2px 4px 6px",
                      color: "#a3aab5",
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                    }}
                  >
                    ACTIVE NOW
                  </div>
                  {activeUsers.map((activeUser) => (
                    <div
                      key={activeUser.userId}
                      style={{
                        minHeight: 34,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "4px 5px",
                        color: "#d1d5db",
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    >
                      <img
                        src={activeUser.avatar}
                        alt=""
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: "50%",
                          border: `2px solid ${activeUser.color}`,
                        }}
                      />
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {activeUser.displayName}
                      </span>
                    </div>
                  ))}
                  {activeUsers.length === 0 && (
                    <div
                      style={{
                        padding: "7px 5px",
                        color: "#8b95a5",
                        fontSize: 11,
                      }}
                    >
                      No dashboard users reported
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={() => {
                  setPresenceMenuOpen((open) => !open);
                  setProfileMenuOpen(false);
                }}
                title="Show OBS overlay status and everyone currently on the dashboard"
                aria-expanded={presenceMenuOpen}
                style={{
                  width: "100%",
                  height: 34,
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "0 6px",
                  marginBottom: 6,
                  background: presenceMenuOpen ? "#1b1b1b" : "transparent",
                  border: "1px solid #242424",
                  borderRadius: 5,
                  color: "#c4cad4",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: overlayConnected ? "#4ade80" : "#f87171",
                    boxShadow: overlayConnected
                      ? "0 0 6px rgba(74,222,128,0.55)"
                      : "none",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 11, fontWeight: 600 }}>
                  {overlayConnected ? "OBS Online" : "OBS Offline"}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ display: "flex", alignItems: "center" }}>
                  {activeUsers.slice(0, 4).map((activeUser, index) => (
                    <img
                      key={activeUser.userId}
                      src={activeUser.avatar}
                      alt={activeUser.displayName}
                      title={`${activeUser.displayName} is active`}
                      style={{
                        width: 22,
                        height: 22,
                        marginLeft: index === 0 ? 0 : -6,
                        borderRadius: "50%",
                        border: `2px solid ${activeUser.color}`,
                        background: "#111",
                      }}
                    />
                  ))}
                  {activeUsers.length > 4 && (
                    <span
                      style={{
                        marginLeft: 4,
                        color: "#a3aab5",
                        fontSize: 10,
                        fontWeight: 600,
                      }}
                    >
                      +{activeUsers.length - 4}
                    </span>
                  )}
                </span>
              </button>
              {profileMenuOpen && (
                <div
                  style={{
                    position: "absolute",
                    left: 8,
                    right: 8,
                    bottom: "calc(100% + 6px)",
                    padding: 6,
                    background: "#181818",
                    border: "1px solid #333",
                    borderRadius: 6,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
                    zIndex: 2000,
                  }}
                >
                  <div
                    style={{
                      padding: "3px 4px 7px",
                      color: "#a3aab5",
                      fontSize: 9,
                      fontFamily: "Inter,sans-serif",
                      letterSpacing: "0.08em",
                    }}
                  >
                    DASHBOARD THEME
                  </div>
                  <div style={{ display: "flex", gap: 5, marginBottom: 7 }}>
                    {(["fox", "custom"] as const).map((option) => (
                      <button
                        className="ui-button ui-button--compact"
                        key={option}
                        onClick={() => setTheme(option)}
                        title={option === "fox" ? "Use the default Fox Orange accent" : "Use your custom accent color"}
                        style={{
                          flex: 1,
                          background:
                            theme === option
                              ? "var(--accent-surface-strong)"
                              : "#202020",
                          border:
                            theme === option
                              ? "1px solid var(--accent-border)"
                              : "1px solid #333",
                          color:
                            theme === option ? "var(--accent-text)" : "#888",
                          cursor: "pointer",
                          fontSize: 10,
                          padding: "6px 4px",
                          borderRadius: 4,
                        }}
                      >
                        {option === "fox" ? "Fox Orange" : "Custom"}
                      </button>
                    ))}
                  </div>
                  <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8, color: "#b6beca", fontSize: 10 }}>
                    <span>Custom accent</span>
                    <input
                      type="color"
                      value={customAccent}
                      onChange={(event) => { setCustomAccent(event.target.value); setTheme("custom"); }}
                      title="Choose a custom dashboard accent color"
                      style={{ width: 42, height: 26, padding: 2, border: "1px solid #3a3a3a", borderRadius: 5, background: "#111", cursor: "pointer" }}
                    />
                  </label>
                  <div
                    style={{
                      padding: "7px 4px 5px",
                      marginBottom: 7,
                      borderTop: "1px solid #2a2a2a",
                      borderBottom: "1px solid #2a2a2a",
                    }}
                  >
                    <div
                      style={{
                        color: "#a3aab5",
                        fontSize: 9,
                        letterSpacing: "0.08em",
                        marginBottom: 7,
                      }}
                    >
                      DVD CORNER SOUND
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        marginBottom: 7,
                        color: "#b6beca",
                        fontSize: 10,
                      }}
                    >
                      <span>Volume</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={dvdCelebrationSettings.volume}
                        onChange={(event) =>
                          setDvdCelebrationSettings({
                            ...dvdCelebrationSettings,
                            volume: Number(event.target.value),
                          })
                        }
                        title="Set the DVD corner celebration sound volume"
                        style={{
                          flex: 1,
                          minWidth: 0,
                          accentColor: "var(--accent-border)",
                        }}
                      />
                      <span style={{ width: 30, textAlign: "right" }}>
                        {Math.round(dvdCelebrationSettings.volume * 100)}%
                      </span>
                    </div>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        marginBottom: 7,
                        color: "#b6beca",
                        fontSize: 10,
                      }}
                    >
                      <span>Counter</span>
                      <select
                        value={dvdCelebrationSettings.counterPosition}
                        onChange={(event) => {
                          const counterPosition = event.target.value as typeof dvdCelebrationSettings.counterPosition;
                          setDvdCelebrationSettings({
                            ...dvdCelebrationSettings,
                            counterPosition,
                          });
                          toast.success(
                            `DVD counter moved to ${event.target.options[event.target.selectedIndex].text.toLowerCase()}`,
                          );
                        }}
                        title="Choose where the DVD corner counter appears on OBS"
                        style={{
                          flex: 1,
                          height: 28,
                          padding: "0 7px",
                          borderRadius: 4,
                          border: "1px solid #3a3a3f",
                          background: "#202020",
                          color: "#d1d5db",
                          font: "600 10px Inter,sans-serif",
                          cursor: "pointer",
                        }}
                      >
                        <option value="top-left">Top left</option>
                        <option value="top-center">Top center</option>
                        <option value="top-right">Top right</option>
                        <option value="bottom-left">Bottom left</option>
                        <option value="bottom-center">Bottom center</option>
                        <option value="bottom-right">Bottom right</option>
                      </select>
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                      <label
                        className="ui-button ui-button--compact"
                        title="Upload an audio file for DVD corner celebrations"
                        style={{
                          minWidth: 0,
                          cursor: dvdSoundUploading ? "wait" : "pointer",
                          background: dvdCelebrationSettings.soundUrl
                            ? "var(--accent-surface-strong)"
                            : "#202020",
                          border: dvdCelebrationSettings.soundUrl
                            ? "1px solid var(--accent-border)"
                            : "1px solid #333",
                          color: "#d1d5db",
                        }}
                      >
                        {dvdSoundUploading
                          ? "Uploading…"
                          : dvdCelebrationSettings.soundUrl
                            ? "Replace sound"
                            : "Upload sound"}
                        <input
                          type="file"
                          accept="audio/mpeg,audio/wav,audio/ogg,audio/webm"
                          disabled={dvdSoundUploading}
                          onChange={handleDvdSoundUpload}
                          style={{ display: "none" }}
                        />
                      </label>
                      <button
                        className="ui-button ui-button--compact"
                        onClick={() =>
                          {
                            setDvdCelebrationSettings({
                              ...dvdCelebrationSettings,
                              soundUrl: null,
                            });
                            toast.success("Using the built-in DVD corner chime");
                          }
                        }
                        disabled={!dvdCelebrationSettings.soundUrl}
                        title="Use the built-in three-note corner chime"
                        style={{
                          minWidth: 0,
                          background: dvdCelebrationSettings.soundUrl ? "#202020" : "var(--accent-surface-strong)",
                          border: dvdCelebrationSettings.soundUrl ? "1px solid #333" : "1px solid var(--accent-border)",
                          color: dvdCelebrationSettings.soundUrl ? "#b6beca" : "var(--accent-text)",
                        }}
                      >
                        Built-in chime
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: 7 }}>
                    <button
                      className="ui-button ui-button--compact"
                      onClick={() => {
                        const visible = !showCursorOnOverlay;
                        setShowCursorOnOverlay(visible);
                        toast.success(
                          visible
                            ? "Your cursor is now visible on OBS"
                            : "Your cursor is now hidden from OBS",
                        );
                      }}
                      title="Choose whether your cursor is visible on the OBS stream overlay; dashboard users always see it"
                      aria-pressed={showCursorOnOverlay}
                      style={{
                        width: "100%",
                        justifyContent: "space-between",
                        background: showCursorOnOverlay ? "var(--accent-surface-strong)" : "#202020",
                        border: showCursorOnOverlay ? "1px solid var(--accent-border)" : "1px solid #333",
                        color: showCursorOnOverlay ? "var(--accent-text)" : "#b6beca",
                      }}
                    >
                      <span>Show my cursor on OBS</span>
                      <span>{showCursorOnOverlay ? "On" : "Off"}</span>
                    </button>
                    <button
                      className="ui-button ui-danger"
                      onClick={onLogout}
                      title="Log out of the dashboard"
                      style={{
                        width: "100%",
                        background: "#450a0a",
                        border: "1px solid #7f1d1d",
                        color: "#fca5a5",
                        cursor: "pointer",
                        fontSize: 12,
                        padding: "7px 10px",
                        borderRadius: 4,
                        textAlign: "left",
                      }}
                    >
                      Log out
                    </button>
                  </div>
                </div>
              )}
              <button
                onClick={() => {
                  setProfileMenuOpen((open) => !open);
                  setPresenceMenuOpen(false);
                }}
                aria-expanded={profileMenuOpen}
                title={profileMenuOpen ? "Close account menu" : "Open account menu and settings"}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: 6,
                  background: profileMenuOpen ? "#1b1b1b" : "transparent",
                  border: "1px solid transparent",
                  borderRadius: 5,
                  color: "#ccc",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <img
                  src={user.avatar}
                  alt=""
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    border: `2px solid ${user.color ?? "#9146FF"}`,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    minWidth: 0,
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 12,
                  }}
                >
                  {user.displayName}
                </span>
                {!user.isOwner && user.isAdmin && (
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 600,
                      color: "#34d399",
                      background: "#064e3b",
                      borderRadius: 3,
                      padding: "1px 4px",
                    }}
                  >
                    admin
                  </span>
                )}
                <span style={{ color: "#9ca3af", fontSize: 10 }}>
                  {profileMenuOpen ? "▼" : "▲"}
                </span>
              </button>
            </div>
          }
        />
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          <CanvasStage
            elements={elements}
            cursors={cursors}
            selectedIds={selectedIds}
            onSelect={handleSelect}
            onSelectMany={handleSelectMany}
            onElementChange={updateElement}
            onElementDelete={handleDelete}
            onCursorMove={sendCursor}
            onEditText={handleEditText}
            onMediaControl={handleMediaControl}
            mediaControlRef={dashboardControlRef}
            directUpdateRef={directUpdateRef}
            showTwitchEmbed={showTwitchEmbed}
            twitchChannel={twitchChannel}
            drawingLayer={
              <DrawingCanvas
                width={WORKSPACE_W}
                height={WORKSPACE_H}
                strokes={strokes}
                liveStrokes={liveStrokes}
                drawMode={drawMode}
                toolMode={toolMode}
                color={drawColor}
                size={drawSize}
                onStroke={addStroke}
                onLiveStroke={sendLiveStroke}
              />
            }
          />
        </div>
      </div>

      {showWhitelist && (
        <WhitelistPanel
          onClose={() => setShowWhitelist(false)}
          isOwner={user.isOwner}
          isAdmin={isAdmin}
        />
      )}

      {editingTextId && (
        <TextDialog
          initial={editingTextConfig}
          onConfirm={handleTextUpdate}
          onClose={() => setEditingTextId(null)}
        />
      )}
    </div>
  );
}

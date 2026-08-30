import { useState } from "react";
import {
  AudioLines,
  Clapperboard,
  Headphones,
  Play,
  Pencil,
  Plus,
  Radio,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type {
  CanvasElement,
  DvdCelebrationSettings,
  OverlayTrigger,
  StudioState,
  TriggerPlacement,
  FlyDirection,
  ChatPermission,
} from "../types";
import { randomUUID } from "../utils";
import { getFileLabel } from "../canvas/config";
import { authHeaders } from "../hooks/useAuth";
import { useToast } from "./ToastProvider";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

type Tab = "scenes" | "presets" | "sounds" | "triggers" | "effects";

interface StudioPanelProps {
  studio: StudioState;
  elements: CanvasElement[];
  selectedIds: Set<string>;
  isOwner: boolean;
  onClose: () => void;
  onSaveScene: (id: string, name: string) => void;
  onLoadScene: (id: string) => void;
  onDeleteScene: (id: string) => void;
  onSavePreset: (id: string, name: string, elementIds: string[]) => void;
  onLoadPreset: (id: string) => void;
  onDeletePreset: (id: string) => void;
  onSaveSound: (item: {
    id: string;
    name: string;
    url: string;
    volume: number;
  }) => void;
  onDeleteSound: (id: string) => void;
  onPreviewSound: (id: string) => void;
  onPlaySound: (id: string) => void;
  onSaveTrigger: (trigger: OverlayTrigger) => void;
  onDeleteTrigger: (id: string) => void;
  onPreviewFly: (id: string, direction: FlyDirection, durationSeconds: number) => boolean;
  dvdCelebrationSettings: DvdCelebrationSettings;
  dvdSoundUploading: boolean;
  onDvdSettingsChange: (settings: DvdCelebrationSettings) => void;
  onDvdSoundUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const tabs: Array<[Tab, string, typeof Save]> = [
  ["scenes", "Scenes", Clapperboard],
  ["presets", "Presets", Save],
  ["sounds", "Sounds", AudioLines],
  ["triggers", "Commands", Radio],
  ["effects", "Effects", Sparkles],
];

const fieldStyle = {
  width: "100%",
  height: 32,
  boxSizing: "border-box" as const,
  border: "1px solid #3a3a3f",
  borderRadius: 5,
  background: "#151515",
  color: "#e5e7eb",
  padding: "0 9px",
  fontSize: 12,
};

const triggerActionOptions: Array<{
  value: OverlayTrigger["action"];
  label: string;
}> = [
  { value: "show-element", label: "Show element" },
  { value: "show-temporary", label: "Show image temporarily" },
  { value: "fly-across", label: "Fly across stream" },
  { value: "hide-element", label: "Hide element" },
  { value: "toggle-element", label: "Toggle element visibility" },
  { value: "play-media", label: "Play video, then hide" },
  { value: "play-sound", label: "Play sound on overlay" },
  { value: "enable-dvd", label: "Start DVD movement" },
  { value: "refresh-overlay", label: "Refresh OBS overlay" },
];

const triggerActionLabel = (action: OverlayTrigger["action"]) =>
  triggerActionOptions.find((option) => option.value === action)?.label ??
  action;
const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: 8,
  border: "1px solid #303036",
  borderRadius: 6,
  background: "#181818",
};

export function StudioPanel(props: StudioPanelProps) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("scenes");
  const [name, setName] = useState("");
  const [soundUrl, setSoundUrl] = useState("");
  const [triggerAction, setTriggerAction] =
    useState<OverlayTrigger["action"]>("show-element");
  const [triggerMatch, setTriggerMatch] = useState("<fox");
  const [targetId, setTargetId] = useState("");
  const [cooldown, setCooldown] = useState(5);
  const [triggerPlacement, setTriggerPlacement] =
    useState<TriggerPlacement>("current");
  const [flyDirection, setFlyDirection] =
    useState<FlyDirection>("left-to-right-bottom");
  const [duration, setDuration] = useState(5);
  const [permission, setPermission] = useState<ChatPermission>("everyone");
  const [editingTriggerId, setEditingTriggerId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const createScene = () => {
    if (name.trim()) {
      props.onSaveScene(randomUUID(), name.trim());
      setName("");
    }
  };
  const createPreset = () => {
    if (name.trim() && props.selectedIds.size) {
      props.onSavePreset(randomUUID(), name.trim(), [...props.selectedIds]);
      setName("");
    }
  };
  const createSound = () => {
    if (name.trim() && soundUrl.trim()) {
      props.onSaveSound({
        id: randomUUID(),
        name: name.trim(),
        url: soundUrl.trim(),
        volume: 0.25,
      });
      setName("");
      setSoundUrl("");
    }
  };
  const uploadSound = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`${SERVER_URL}/upload`, {
        method: "POST",
        body,
        headers: authHeaders(),
        credentials: "include",
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { url: string };
      props.onSaveSound({
        id: randomUUID(),
        name: name.trim() || file.name.replace(/\.[^.]+$/, ""),
        url: `${SERVER_URL}${data.url}`,
        volume: 0.25,
      });
      setName("");
      setSoundUrl("");
      toast.success(`${file.name} added to the soundboard`);
    } catch {
      toast.error("Sound upload failed. Use MP3, WAV, OGG, or WebM audio.");
    } finally {
      setUploading(false);
    }
  };
  const createTrigger = () => {
    if (!name.trim() || (triggerAction !== "refresh-overlay" && !targetId))
      return;
    props.onSaveTrigger({
      id: editingTriggerId ?? randomUUID(),
      name: name.trim(),
      enabled: editingTriggerId
        ? (props.studio.triggers.find(
            (trigger) => trigger.id === editingTriggerId,
          )?.enabled ?? true)
        : true,
      event: "chat-command",
      match: triggerMatch.trim() || undefined,
      action: triggerAction,
      targetId: targetId || undefined,
      cooldownSeconds: cooldown,
      placement: ["play-media", "show-temporary"].includes(triggerAction)
        ? triggerPlacement
        : undefined,
      durationSeconds:
        ["show-temporary", "fly-across"].includes(triggerAction)
          ? duration
          : undefined,
      flyDirection:
        triggerAction === "fly-across" ? flyDirection : undefined,
      permission,
    });
    toast.success(
      editingTriggerId ? "Chat command updated" : "Chat command added",
    );
    setName("");
    setEditingTriggerId(null);
  };

  const editTrigger = (trigger: OverlayTrigger) => {
    setEditingTriggerId(trigger.id);
    setName(trigger.name);
    setTriggerMatch(trigger.match ?? "");
    setTriggerAction(trigger.action);
    setTargetId(trigger.targetId ?? "");
    setCooldown(trigger.cooldownSeconds);
    setTriggerPlacement(trigger.placement ?? "current");
    setFlyDirection(trigger.flyDirection ?? "left-to-right-bottom");
    setDuration(trigger.durationSeconds ?? 5);
    setPermission(trigger.permission ?? "everyone");
  };

  const cancelTriggerEdit = () => {
    setEditingTriggerId(null);
    setName("");
  };

  return (
    <aside className="studio-panel">
      <div className="studio-panel__header">
        <div>
          <strong>Studio</strong>
          <span>Production tools</span>
        </div>
        <button
          className="ui-icon-button"
          onClick={props.onClose}
          title="Close Studio panel"
        >
          <X size={16} />
        </button>
      </div>
      <div className="studio-tabs">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
            title={`Open ${label}`}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="studio-panel__body">
        {tab === "scenes" && (
          <Section
            title="Scenes"
            description="Save or restore the complete canvas and drawing."
          >
            <CreateRow
              name={name}
              setName={setName}
              placeholder="Scene name"
              onCreate={createScene}
              label="Save scene"
            />
            {props.studio.scenes.map((item) => (
              <Item
                key={item.id}
                name={item.name}
                detail={new Date(item.updatedAt).toLocaleString()}
                onPrimary={() => {
                  if (
                    window.confirm(
                      `Replace the current canvas with “${item.name}”? You can undo this action.`,
                    )
                  )
                    props.onLoadScene(item.id);
                }}
                primary="Load"
                onDelete={() => {
                  if (window.confirm(`Delete the saved scene “${item.name}”?`))
                    props.onDeleteScene(item.id);
                }}
              />
            ))}
          </Section>
        )}
        {tab === "presets" && (
          <Section
            title="Presets"
            description="Save the currently selected elements for reuse."
          >
            <CreateRow
              name={name}
              setName={setName}
              placeholder={
                props.selectedIds.size
                  ? `Preset from ${props.selectedIds.size} selected`
                  : "Select elements first"
              }
              onCreate={createPreset}
              label="Save preset"
              disabled={!props.selectedIds.size}
            />
            {props.studio.presets.map((item) => (
              <Item
                key={item.id}
                name={item.name}
                detail={`${item.elements.length} element${item.elements.length === 1 ? "" : "s"}`}
                onPrimary={() => props.onLoadPreset(item.id)}
                primary="Insert"
                onDelete={() => props.onDeletePreset(item.id)}
              />
            ))}
          </Section>
        )}
        {tab === "sounds" && (
          <Section
            title="Soundboard"
            description="Play saved sounds directly through the OBS overlay."
          >
            <input
              style={fieldStyle}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sound name"
              maxLength={60}
            />
            <input
              style={fieldStyle}
              value={soundUrl}
              onChange={(e) => setSoundUrl(e.target.value)}
              placeholder="Direct HTTPS audio URL"
              maxLength={2048}
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 6,
              }}
            >
              <button
                className="ui-button studio-primary"
                onClick={createSound}
              >
                <Plus size={14} /> Add URL
              </button>
              <label
                className="ui-button"
                title="Upload an audio file to the soundboard"
                style={{
                  border: "1px solid #3a3a3f",
                  background: "#202024",
                  color: "#cbd1da",
                  cursor: uploading ? "wait" : "pointer",
                }}
              >
                {uploading ? "Uploading…" : "Upload file"}
                <input
                  type="file"
                  accept="audio/*,.mp3,.wav,.ogg,.webm"
                  hidden
                  disabled={uploading}
                  onChange={(event) => {
                    void uploadSound(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            {props.studio.sounds.map((item) => (
              <div key={item.id} className="soundboard-item">
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: 12, display: "block" }}>
                    {item.name}
                  </strong>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 9,
                      color: "#8b95a5",
                    }}
                  >
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={item.volume}
                      onChange={(event) =>
                        props.onSaveSound({
                          ...item,
                          volume: Number(event.target.value),
                        })
                      }
                      style={{ width: 76, accentColor: "var(--accent-border)" }}
                    />
                    {Math.round(item.volume * 100)}%
                  </label>
                </div>
                <div className="soundboard-item__actions">
                  <button
                    className="ui-button ui-button--compact soundboard-action"
                    onClick={() => props.onPreviewSound(item.id)}
                    title={`Preview ${item.name} locally without playing it on stream`}
                  >
                    <Headphones size={13} />
                    Preview
                  </button>
                  <button
                    className="ui-button ui-button--compact soundboard-action soundboard-action--obs"
                    onClick={() => props.onPlaySound(item.id)}
                    title={`Play ${item.name} on the OBS overlay only`}
                  >
                    <Play size={12} />
                    Play on Overlay
                  </button>
                  <button
                    className="ui-button ui-button--compact ui-danger soundboard-action"
                    onClick={() => props.onDeleteSound(item.id)}
                    title={`Delete ${item.name}`}
                  >
                    <Trash2 size={13} />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </Section>
        )}
        {tab === "triggers" && (
          <Section
            title="Chat commands"
            description={
              props.studio.twitchConnected
                ? "Anonymous Twitch chat listener connected."
                : "Connecting to public Twitch chat automatically…"
            }
          >
            <input
              style={fieldStyle}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Command name"
              maxLength={60}
            />
            <input
              style={fieldStyle}
              value={triggerMatch}
              onChange={(e) => setTriggerMatch(e.target.value)}
              placeholder="Chat command, for example <fox"
            />
            <select
              style={fieldStyle}
              value={triggerAction}
              onChange={(e) => {
                setTriggerAction(e.target.value as OverlayTrigger["action"]);
                setTargetId("");
              }}
            >
              {triggerActionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {triggerAction !== "refresh-overlay" && (
              <select
                style={fieldStyle}
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
              >
                <option value="">Choose target…</option>
                {(triggerAction === "play-sound"
                  ? props.studio.sounds
                  : triggerAction === "play-media"
                    ? props.elements.filter(
                        (element) => element.type === "video",
                      )
                    : ["show-temporary", "fly-across"].includes(triggerAction)
                      ? props.elements.filter((element) =>
                          ["image", "gif", "video"].includes(element.type),
                        )
                      : props.elements
                ).map((item) => (
                  <option key={item.id} value={item.id}>
                    {"name" in item
                      ? item.name
                      : item.type === "text"
                        ? `Text · ${item.id.slice(0, 6)}`
                        : `${getFileLabel(item.src) || item.type} · ${item.type}`}
                  </option>
                ))}
              </select>
            )}
            {["play-media", "show-temporary"].includes(triggerAction) && (
              <label
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 150px",
                  alignItems: "center",
                  gap: 8,
                  color: "#aab2bf",
                  fontSize: 11,
                }}
              >
                Position while active
                <select
                  style={fieldStyle}
                  value={triggerPlacement}
                  onChange={(event) =>
                    setTriggerPlacement(event.target.value as TriggerPlacement)
                  }
                >
                  <option value="current">Keep position</option>
                  <option value="random">Random position</option>
                  <option value="fit">Fit inside stream</option>
                  <option value="fill">Fill stream</option>
                  <option value="top-left">Top left</option>
                  <option value="top-center">Top center</option>
                  <option value="top-right">Top right</option>
                  <option value="center-left">Center left</option>
                  <option value="center">Center</option>
                  <option value="center-right">Center right</option>
                  <option value="bottom-left">Bottom left</option>
                  <option value="bottom-center">Bottom center</option>
                  <option value="bottom-right">Bottom right</option>
                </select>
              </label>
            )}
            {triggerAction === "fly-across" && (
              <label
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 150px",
                  alignItems: "center",
                  gap: 8,
                  color: "#aab2bf",
                  fontSize: 11,
                }}
              >
                Flight path
                <select
                  style={fieldStyle}
                  value={flyDirection}
                  onChange={(event) =>
                    setFlyDirection(event.target.value as FlyDirection)
                  }
                >
                  <option value="left-to-right-top">Left → right · top</option>
                  <option value="left-to-right-center">Left → right · center</option>
                  <option value="left-to-right-bottom">Left → right · bottom</option>
                  <option value="right-to-left-top">Right → left · top</option>
                  <option value="right-to-left-center">Right → left · center</option>
                  <option value="right-to-left-bottom">Right → left · bottom</option>
                  <option value="top-to-bottom-left">Top → bottom · left</option>
                  <option value="top-to-bottom-center">Top → bottom · center</option>
                  <option value="top-to-bottom-right">Top → bottom · right</option>
                  <option value="bottom-to-top-left">Bottom → top · left</option>
                  <option value="bottom-to-top-center">Bottom → top · center</option>
                  <option value="bottom-to-top-right">Bottom → top · right</option>
                </select>
              </label>
            )}
            {["show-temporary", "fly-across"].includes(triggerAction) && (
              <label
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 90px",
                  alignItems: "center",
                  gap: 8,
                  color: "#aab2bf",
                  fontSize: 11,
                }}
              >
                {triggerAction === "fly-across"
                  ? "Flight duration (seconds)"
                  : "Visible duration (seconds)"}
                <input
                  style={fieldStyle}
                  type="number"
                  min="1"
                  max="3600"
                  value={duration}
                  onChange={(event) =>
                    setDuration(
                      Math.min(3600, Math.max(1, Number(event.target.value))),
                    )
                  }
                />
              </label>
            )}
            {triggerAction === "fly-across" && (
              <button
                type="button"
                className="ui-button ui-button--compact"
                disabled={!targetId}
                onClick={() => {
                  if (!targetId || !props.onPreviewFly(targetId, flyDirection, duration)) {
                    toast.error("Choose an available media element to preview");
                    return;
                  }
                  toast.info("Playing dashboard-only flight preview");
                }}
                title="Preview this flight only on your dashboard; OBS and other users are not affected"
                style={{
                  width: "100%",
                  border: "1px solid #3a3a3f",
                  background: "#202024",
                  color: "#d7dce4",
                  cursor: targetId ? "pointer" : "not-allowed",
                }}
              >
                <Play size={12} /> Preview flight on dashboard
              </button>
            )}
            <label
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 150px",
                alignItems: "center",
                gap: 8,
                color: "#aab2bf",
                fontSize: 11,
              }}
            >
              Who can use it
              <select
                style={fieldStyle}
                value={permission}
                onChange={(event) =>
                  setPermission(event.target.value as ChatPermission)
                }
              >
                <option value="everyone">Everyone</option>
                <option value="vip">VIPs, moderators & streamer</option>
                <option value="moderator">Moderators & streamer</option>
                <option value="streamer">Streamer only</option>
              </select>
            </label>
            <label
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 90px",
                alignItems: "center",
                gap: 8,
                color: "#aab2bf",
                fontSize: 11,
              }}
            >
              Cooldown (seconds)
              <input
                style={fieldStyle}
                type="number"
                min="0"
                max="86400"
                value={cooldown}
                onChange={(e) =>
                  setCooldown(Math.max(0, Number(e.target.value)))
                }
              />
            </label>
            <button
              className="ui-button studio-primary"
              onClick={createTrigger}
              disabled={
                !name.trim() ||
                (triggerAction !== "refresh-overlay" && !targetId)
              }
            >
              {editingTriggerId ? <Save size={14} /> : <Plus size={14} />}{" "}
              {editingTriggerId ? "Save changes" : "Add command"}
            </button>
            {editingTriggerId && (
              <button
                className="ui-button"
                onClick={cancelTriggerEdit}
                style={{
                  border: "1px solid #3a3a3f",
                  background: "#202024",
                  color: "#cbd1da",
                  cursor: "pointer",
                }}
              >
                <X size={14} /> Cancel editing
              </button>
            )}
            {props.studio.triggers
              .filter((item) => item.event === "chat-command")
              .map((item) => (
                <Item
                  key={item.id}
                  name={item.name}
                  detail={`${item.match ?? "command"} → ${triggerActionLabel(item.action)} · ${item.permission ?? "everyone"}`}
                  onEdit={() => editTrigger(item)}
                  onPrimary={() =>
                    props.onSaveTrigger({ ...item, enabled: !item.enabled })
                  }
                  primary={item.enabled ? "Active" : "Disabled"}
                  active={item.enabled}
                  onDelete={() => props.onDeleteTrigger(item.id)}
                />
              ))}
          </Section>
        )}
        {tab === "effects" && (
          <Section
            title="Overlay effects"
            description="Configure global effects shared by every DVD-enabled element."
          >
            <div style={{ ...rowStyle, display: "grid", gap: 10 }}>
              <label
                style={{
                  display: "grid",
                  gridTemplateColumns: "52px 1fr 34px",
                  alignItems: "center",
                  gap: 7,
                  color: "#b6beca",
                  fontSize: 11,
                }}
              >
                <span>Volume</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={props.dvdCelebrationSettings.volume}
                  onChange={(event) =>
                    props.onDvdSettingsChange({
                      ...props.dvdCelebrationSettings,
                      volume: Number(event.target.value),
                    })
                  }
                  title="Set the DVD corner celebration sound volume"
                  style={{ minWidth: 0, accentColor: "var(--accent-border)" }}
                />
                <span style={{ textAlign: "right" }}>
                  {Math.round(props.dvdCelebrationSettings.volume * 100)}%
                </span>
              </label>
              <label
                style={{
                  display: "grid",
                  gridTemplateColumns: "52px 1fr",
                  alignItems: "center",
                  gap: 7,
                  color: "#b6beca",
                  fontSize: 11,
                }}
              >
                <span>Counter</span>
                <select
                  style={fieldStyle}
                  value={props.dvdCelebrationSettings.counterPosition}
                  onChange={(event) => {
                    const counterPosition = event.target
                      .value as DvdCelebrationSettings["counterPosition"];
                    props.onDvdSettingsChange({
                      ...props.dvdCelebrationSettings,
                      counterPosition,
                    });
                    toast.success(
                      `DVD counter moved to ${event.target.options[event.target.selectedIndex].text.toLowerCase()}`,
                    );
                  }}
                  title="Choose where the DVD corner counter appears on overlay"
                >
                  <option value="top-left">Top left</option>
                  <option value="top-center">Top center</option>
                  <option value="top-right">Top right</option>
                  <option value="bottom-left">Bottom left</option>
                  <option value="bottom-center">Bottom center</option>
                  <option value="bottom-right">Bottom right</option>
                </select>
              </label>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 6,
                }}
              >
                <label
                  className="ui-button ui-button--compact soundboard-action"
                  title="Upload an audio file for DVD corner celebrations"
                  style={{
                    cursor: props.dvdSoundUploading ? "wait" : "pointer",
                  }}
                >
                  {props.dvdSoundUploading
                    ? "Uploading…"
                    : props.dvdCelebrationSettings.soundUrl
                      ? "Replace sound"
                      : "Upload sound"}
                  <input
                    type="file"
                    accept="audio/mpeg,audio/wav,audio/ogg,audio/webm"
                    disabled={props.dvdSoundUploading}
                    onChange={props.onDvdSoundUpload}
                    hidden
                  />
                </label>
                <button
                  className="ui-button ui-button--compact soundboard-action"
                  onClick={() => {
                    props.onDvdSettingsChange({
                      ...props.dvdCelebrationSettings,
                      soundUrl: null,
                    });
                    toast.success("Using the built-in DVD corner chime");
                  }}
                  disabled={!props.dvdCelebrationSettings.soundUrl}
                  title="Use the built-in three-note corner chime"
                >
                  Built-in chime
                </button>
              </div>
            </div>
          </Section>
        )}
      </div>
    </aside>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="studio-section">
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </section>
  );
}
function CreateRow({
  name,
  setName,
  placeholder,
  onCreate,
  label,
  disabled,
}: {
  name: string;
  setName: (v: string) => void;
  placeholder: string;
  onCreate: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <>
      <input
        style={fieldStyle}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onCreate()}
        placeholder={placeholder}
        maxLength={60}
      />
      <button
        className="ui-button studio-primary"
        onClick={onCreate}
        disabled={disabled}
      >
        <Plus size={14} />
        {label}
      </button>
    </>
  );
}
function Item({
  name,
  detail,
  onPrimary,
  primary,
  onDelete,
  onEdit,
  active,
}: {
  name: string;
  detail: string;
  onPrimary: () => void;
  primary: string;
  onDelete: () => void;
  onEdit?: () => void;
  active?: boolean;
}) {
  return (
    <div style={rowStyle}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <strong
          style={{
            fontSize: 12,
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </strong>
        <small style={{ fontSize: 10, color: "#8b95a5" }}>{detail}</small>
      </div>
      {onEdit && (
        <button
          className="ui-icon-button ui-button--compact"
          onClick={onEdit}
          title={`Edit ${name}`}
        >
          <Pencil size={12} />
        </button>
      )}
      <button
        className="ui-button ui-button--compact"
        onClick={onPrimary}
        title={
          active === undefined
            ? `${primary} ${name}`
            : `${active ? "Disable" : "Enable"} ${name}`
        }
        role={active === undefined ? undefined : "switch"}
        aria-checked={active}
        style={
          active === undefined
            ? undefined
            : {
                minWidth: 70,
                border: `1px solid ${active ? "#166534" : "#6b2b32"}`,
                background: active ? "#0f3925" : "#302024",
                color: active ? "#86efac" : "#d7a0a6",
                fontWeight: 700,
                cursor: "pointer",
              }
        }
      >
        {primary === "Play" ? <Play size={12} /> : primary}
      </button>
      <button
        className="ui-icon-button ui-button--compact ui-danger"
        onClick={onDelete}
        title={`Delete ${name}`}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

import { useRef, useState } from "react";
import {
  AudioLines,
  Headphones,
  MessageCircle,
  Play,
  Pencil,
  Plus,
  Radio,
  Save,
  Trash2,
  X,
  BellRing,
  Link2,
  Search,
} from "lucide-react";
import type {
  CanvasElement,
  OverlayTrigger,
  StudioState,
  TriggerPlacement,
  FlyDirection,
  ChatPermission,
  TriggerStep,
  TriggerEventType,
  ChatEmoteSettings,
  ChatEmoteSpawn,
} from "../types";
import { randomUUID } from "../utils";
import { getFileLabel } from "../canvas/config";
import { authHeaders } from "../hooks/useAuth";
import { useToast } from "./ToastProvider";
import { ChatEmoteLayer } from "./ChatEmoteLayer";
import previewEmote from "../assets/vicksyW.png";
import { useTwitchEvents } from "../hooks/useTwitchEvents";
import { useConfirm } from "./ConfirmProvider";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

type Tab =
  | "scenes"
  | "presets"
  | "sounds"
  | "triggers"
  | "events"
  | "emotes";

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
  onPreviewFly: (
    id: string,
    direction: FlyDirection,
    durationSeconds: number,
  ) => boolean;
  chatEmoteSettings: ChatEmoteSettings;
  onChatEmoteSettingsChange: (settings: ChatEmoteSettings) => void;
}

const tabs: Array<[Tab, string, typeof Save]> = [
  ["sounds", "Soundboard", AudioLines],
  ["triggers", "Commands", Radio],
  ["events", "Events", BellRing],
  ["emotes", "Emotes", MessageCircle],
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
  { value: "play-media", label: "Play video/audio layer, then hide" },
  { value: "play-sound", label: "Play Soundboard clip" },
  { value: "enable-dvd", label: "Start DVD movement" },
  { value: "refresh-overlay", label: "Refresh OBS overlay" },
  { value: "send-chat", label: "Send Twitch chat message" },
];

const triggerActionLabel = (action: OverlayTrigger["action"]) =>
  triggerActionOptions.find((option) => option.value === action)?.label ??
  action;
const triggerTimingLabel = (step: TriggerStep, index: number) => {
  if (index === 0 || !step.timing || step.timing === "immediate")
    return "same time";
  if (step.timing === "after-previous") return "after previous";
  return `after ${step.delaySeconds ?? 1}s`;
};
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
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>("sounds");
  const [name, setName] = useState("");
  const [soundUrl, setSoundUrl] = useState("");
  const [triggerAction, setTriggerAction] =
    useState<OverlayTrigger["action"]>("show-element");
  const [triggerMatch, setTriggerMatch] = useState("");
  const [triggerEvent, setTriggerEvent] =
    useState<Exclude<TriggerEventType, "chat-command">>("follow");
  const [triggerMinimum, setTriggerMinimum] = useState(1);
  const [triggerChannel, setTriggerChannel] = useState("");
  const [chatMessage, setChatMessage] = useState("");
  const [targetId, setTargetId] = useState("");
  const [cooldown, setCooldown] = useState(5);
  const [triggerPlacement, setTriggerPlacement] =
    useState<TriggerPlacement>("current");
  const [flyDirection, setFlyDirection] = useState<FlyDirection>(
    "left-to-right-bottom",
  );
  const [duration, setDuration] = useState(5);
  const [permission, setPermission] = useState<ChatPermission>("everyone");
  const [editingTriggerId, setEditingTriggerId] = useState<string | null>(null);
  const [chainedSteps, setChainedSteps] = useState<TriggerStep[]>([]);
  const [editingChainIndex, setEditingChainIndex] = useState<number | null>(
    null,
  );
  const [stepTiming, setStepTiming] =
    useState<NonNullable<TriggerStep["timing"]>>("immediate");
  const [stepDelay, setStepDelay] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [emotePreview, setEmotePreview] = useState<ChatEmoteSpawn | null>(null);
  const [blacklistName, setBlacklistName] = useState("");
  const [additionalEmoteName, setAdditionalEmoteName] = useState("");
  const [listSearch, setListSearch] = useState("");
  const pendingStepBeforeChainEdit = useRef<TriggerStep | null>(null);
  const twitchEvents = useTwitchEvents(tab === "events");
  const eventStatus = twitchEvents.status;

  const currentTriggerStep = (): TriggerStep => ({
    action: triggerAction,
    targetId: targetId || undefined,
    placement: ["play-media", "show-temporary"].includes(triggerAction)
      ? triggerPlacement
      : undefined,
    durationSeconds: ["show-temporary", "fly-across"].includes(triggerAction)
      ? duration
      : undefined,
    flyDirection: triggerAction === "fly-across" ? flyDirection : undefined,
    timing: stepTiming,
    delaySeconds: stepTiming === "delay" ? stepDelay : undefined,
    chatMessage: triggerAction === "send-chat" ? chatMessage.trim() : undefined,
  });

  const resetTriggerStep = () => {
    setTriggerAction("show-element");
    setTargetId("");
    setTriggerPlacement("current");
    setFlyDirection("left-to-right-bottom");
    setDuration(5);
    setStepTiming("immediate");
    setStepDelay(1);
    setChatMessage("");
    setEditingChainIndex(null);
  };

  const loadTriggerStep = (step: TriggerStep) => {
    setTriggerAction(step.action);
    setTargetId(step.targetId ?? "");
    setTriggerPlacement(step.placement ?? "current");
    setFlyDirection(step.flyDirection ?? "left-to-right-bottom");
    setDuration(step.durationSeconds ?? 5);
    setStepTiming(step.timing ?? "immediate");
    setStepDelay(step.delaySeconds ?? 1);
    setChatMessage(step.chatMessage ?? "");
  };

  const resetTriggerForm = () => {
    setName("");
    setTriggerMatch("");
    setCooldown(5);
    setPermission("everyone");
    setChainedSteps([]);
    setEditingTriggerId(null);
    pendingStepBeforeChainEdit.current = null;
    resetTriggerStep();
  };

  const createScene = () => {
    if (name.trim()) {
      props.onSaveScene(randomUUID(), name.trim());
      toast.success(`Scene “${name.trim()}” saved`);
      setName("");
    }
  };
  const createPreset = () => {
    if (name.trim() && props.selectedIds.size) {
      props.onSavePreset(randomUUID(), name.trim(), [...props.selectedIds]);
      toast.success(`Preset “${name.trim()}” saved`);
      setName("");
    }
  };
  const createSound = async () => {
    if (soundUrl.trim()) {
      try {
        setUploading(true);
        const response = await fetch(`${SERVER_URL}/myinstants/resolve`, {
          method: "POST",
          credentials: "include",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ url: soundUrl.trim() }),
        });
        const data = (await response.json()) as {
          url?: string;
          title?: string;
          error?: string;
        };
        if (!response.ok || !data.url)
          throw new Error(data.error ?? "Could not resolve Myinstants link");
        const soundName = name.trim() || data.title || "Myinstants sound";
        props.onSaveSound({
          id: randomUUID(),
          name: soundName,
          url: data.url,
          volume: 0.25,
        });
        toast.success(`Sound “${soundName}” added`);
        setName("");
        setSoundUrl("");
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not add Myinstants sound",
        );
      } finally {
        setUploading(false);
      }
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
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          data.error ?? `Sound upload failed (${response.status})`,
        );
      }
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
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Sound upload failed",
      );
    } finally {
      setUploading(false);
    }
  };
  const createTrigger = () => {
    if (editingChainIndex !== null) {
      toast.error("Finish updating the command action first");
      return;
    }
    if (
      !name.trim() ||
      (!["refresh-overlay", "send-chat"].includes(triggerAction) &&
        !targetId) ||
      (triggerAction === "send-chat" && !chatMessage.trim())
    )
      return;
    const steps = [...chainedSteps, currentTriggerStep()];
    props.onSaveTrigger({
      id: editingTriggerId ?? randomUUID(),
      name: name.trim(),
      enabled: editingTriggerId
        ? (props.studio.triggers.find(
            (trigger) => trigger.id === editingTriggerId,
          )?.enabled ?? true)
        : true,
      event: tab === "events" ? triggerEvent : "chat-command",
      match:
        tab === "events" && triggerEvent !== "channel-points"
          ? undefined
          : triggerMatch.trim() || undefined,
      minimum:
        tab === "events" &&
        ["subscribe", "gift-subscribe", "raid", "bits"].includes(triggerEvent)
          ? triggerMinimum
          : undefined,
      channel: tab === "events" ? triggerChannel || undefined : undefined,
      ...steps[0],
      cooldownSeconds: cooldown,
      permission,
      steps: steps.length > 1 ? steps : undefined,
    });
    toast.success(
      editingTriggerId
        ? `${tab === "events" ? "Event trigger" : "Chat command"} updated`
        : `${tab === "events" ? "Event trigger" : "Chat command"} added`,
    );
    resetTriggerForm();
  };

  const editTrigger = (trigger: OverlayTrigger) => {
    pendingStepBeforeChainEdit.current = null;
    setEditingChainIndex(null);
    setEditingTriggerId(trigger.id);
    setName(trigger.name);
    setTriggerMatch(trigger.match ?? "");
    if (trigger.event !== "chat-command") setTriggerEvent(trigger.event);
    setTriggerMinimum(trigger.minimum ?? 1);
    setTriggerChannel(trigger.channel ?? "");
    const steps = trigger.steps?.length ? trigger.steps : [trigger];
    const current = steps.at(-1)!;
    setChainedSteps(steps.slice(0, -1));
    loadTriggerStep(current);
    setCooldown(trigger.cooldownSeconds);
    setPermission(trigger.permission ?? "everyone");
  };

  const cancelTriggerEdit = () => {
    resetTriggerForm();
    toast.info("Command editing cancelled");
  };

  const addChainedStep = () => {
    if (
      (!["refresh-overlay", "send-chat"].includes(triggerAction) &&
        !targetId) ||
      (triggerAction === "send-chat" && !chatMessage.trim())
    ) {
      toast.error(
        triggerAction === "send-chat"
          ? "Enter a chat message before adding this action"
          : "Choose a target before adding this action",
      );
      return;
    }
    if (chainedSteps.length >= 9 && editingChainIndex === null) {
      toast.error("A command can contain up to 10 actions");
      return;
    }
    if (editingChainIndex !== null) {
      setChainedSteps((steps) =>
        steps.map((step, index) =>
          index === editingChainIndex ? currentTriggerStep() : step,
        ),
      );
      toast.success("Command action updated");
      const pendingStep = pendingStepBeforeChainEdit.current;
      pendingStepBeforeChainEdit.current = null;
      if (pendingStep) loadTriggerStep(pendingStep);
      else resetTriggerStep();
      setEditingChainIndex(null);
    } else {
      setChainedSteps((steps) => [...steps, currentTriggerStep()]);
      toast.success("Action added to command chain");
      resetTriggerStep();
    }
  };

  const editChainedStep = (step: TriggerStep, index: number) => {
    if (editingChainIndex === null)
      pendingStepBeforeChainEdit.current = currentTriggerStep();
    setEditingChainIndex(index);
    loadTriggerStep(step);
  };

  const currentStepIsFirst =
    editingChainIndex === 0 ||
    (editingChainIndex === null && chainedSteps.length === 0);
  const selectedTargetElement = props.elements.find((element) => element.id === targetId);
  const selectedTargetSound = props.studio.sounds.find((sound) => sound.id === targetId);

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
            onClick={() => {
              setTab(id);
              setListSearch("");
            }}
            title={`Open ${label}`}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
        <span
          className="studio-tab-indicator"
          style={{
            transform: `translateX(${tabs.findIndex(([id]) => id === tab) * 100}%)`,
          }}
          aria-hidden="true"
        />
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
                onPrimary={async () => {
                  if (await confirm({
                    title: `Load “${item.name}”?`,
                    message: "This replaces the current canvas and drawing. You can restore the previous state with Undo.",
                    confirmLabel: "Load scene",
                  })) {
                    props.onLoadScene(item.id);
                    toast.success(`Scene “${item.name}” loaded`);
                  }
                }}
                primary="Load"
                onDelete={async () => {
                  if (await confirm({
                    title: `Delete “${item.name}”?`,
                    message: "This permanently removes the saved scene.",
                    confirmLabel: "Delete scene",
                    danger: true,
                  })) {
                    props.onDeleteScene(item.id);
                    toast.success(`Scene “${item.name}” deleted`);
                  }
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
                onPrimary={() => {
                  props.onLoadPreset(item.id);
                  toast.success(`Preset “${item.name}” inserted`);
                }}
                primary="Insert"
                onDelete={() => {
                  props.onDeletePreset(item.id);
                  toast.success(`Preset “${item.name}” deleted`);
                }}
              />
            ))}
          </Section>
        )}
        {tab === "sounds" && (
          <Section
            title="Soundboard"
            description="Soundboard clips play directly through OBS without creating or showing a canvas layer."
          >
            <input
              style={fieldStyle}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sound name (optional for Myinstants)"
              maxLength={60}
            />
            <input
              style={fieldStyle}
              value={soundUrl}
              onChange={(e) => setSoundUrl(e.target.value)}
              placeholder="Paste a Myinstants sound-page link"
              maxLength={2048}
              title="Paste the normal Myinstants button-page URL or a direct Myinstants MP3 link"
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
                onClick={() => void createSound()}
                disabled={uploading || !soundUrl.trim()}
              >
                <Plus size={14} /> Add Myinstants
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
            {props.studio.sounds.length > 0 && (
              <label className="studio-search">
                <Search size={13} aria-hidden="true" />
                <input
                  value={listSearch}
                  onChange={(event) => setListSearch(event.target.value)}
                  placeholder="Search sounds…"
                  aria-label="Search sounds"
                />
              </label>
            )}
            {props.studio.sounds.length === 0 && (
              <div className="studio-empty-state">
                <strong>No sounds yet</strong>
                <span>Add a Myinstants link or upload an audio file to create your Soundboard.</span>
              </div>
            )}
            {props.studio.sounds
              .filter((item) => item.name.toLowerCase().includes(listSearch.trim().toLowerCase()))
              .map((item) => (
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
                    onClick={async () => {
                      if (!await confirm({
                        title: `Delete “${item.name}”?`,
                        message: "Commands using this sound will keep a missing target until they are edited.",
                        confirmLabel: "Delete sound",
                        danger: true,
                      })) return;
                      props.onDeleteSound(item.id);
                      toast.success(`Sound “${item.name}” deleted`);
                    }}
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
        {(tab === "triggers" || tab === "events") && (
          <Section
            title={tab === "events" ? "Event actions" : "Chat commands"}
            description={
              tab === "events"
                ? "Run media, sound, chat, and chained actions when Twitch events arrive."
                : props.studio.twitchConnected
                  ? "Anonymous Twitch chat listener connected."
                  : "Connecting to public Twitch chat automatically…"
            }
          >
            <input
              style={fieldStyle}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                tab === "events" ? "Event action name" : "Command name"
              }
              maxLength={60}
            />
            {tab === "events" && (
              <>
                <select
                  style={fieldStyle}
                  value={triggerEvent}
                  onChange={(e) =>
                    setTriggerEvent(
                      e.target.value as Exclude<
                        TriggerEventType,
                        "chat-command"
                      >,
                    )
                  }
                  title="Choose the Twitch event that starts this action"
                >
                  <option value="follow">New follow</option>
                  <option value="subscribe">
                    Subscription or resubscription
                  </option>
                  <option value="gift-subscribe">Gift subscriptions</option>
                  <option value="raid">Incoming raid</option>
                  <option value="bits">Bits cheered</option>
                  <option value="channel-points">
                    Channel point redemption
                  </option>
                  <option value="ban">Permanent ban</option>
                  <option value="timeout">Timeout</option>
                </select>
                <select
                  style={fieldStyle}
                  value={triggerChannel}
                  onChange={(e) => setTriggerChannel(e.target.value)}
                  title="Limit this trigger to one connected broadcaster"
                >
                  <option value="">Any connected channel</option>
                  {(eventStatus?.channels ?? []).map((item) => (
                    <option key={item.channel} value={item.channel}>
                      {item.displayName ?? item.channel}
                    </option>
                  ))}
                </select>
                {triggerEvent === "channel-points" && (
                  <input
                    style={fieldStyle}
                    value={triggerMatch}
                    onChange={(e) => setTriggerMatch(e.target.value)}
                    placeholder="Reward title (leave empty for any reward)"
                  />
                )}
                {["subscribe", "gift-subscribe", "raid", "bits"].includes(
                  triggerEvent,
                ) && (
                  <label className="command-timing">
                    <span>
                      {triggerEvent === "subscribe"
                        ? "Minimum months"
                        : triggerEvent === "gift-subscribe"
                          ? "Minimum gifts"
                          : triggerEvent === "raid"
                            ? "Minimum raiders"
                            : "Minimum Bits"}
                    </span>
                    <input
                      style={fieldStyle}
                      type="number"
                      min="1"
                      value={triggerMinimum}
                      onChange={(e) =>
                        setTriggerMinimum(Math.max(1, Number(e.target.value)))
                      }
                    />
                  </label>
                )}
              </>
            )}
            {tab === "triggers" && (
              <input
                style={fieldStyle}
                value={triggerMatch}
                onChange={(e) => setTriggerMatch(e.target.value)}
                placeholder="Chat command, for example <fox"
              />
            )}
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
            {!["refresh-overlay", "send-chat"].includes(triggerAction) && (
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
                        (element) =>
                          element.type === "video" || element.type === "audio",
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
                        : `${item.displayName || getFileLabel(item.src) || item.type} · ${item.type}`}
                  </option>
                ))}
              </select>
            )}
            {targetId && (selectedTargetElement || selectedTargetSound) && (
              <div className="trigger-target-summary">
                {selectedTargetElement && ["image", "gif"].includes(selectedTargetElement.type) ? (
                  <img src={selectedTargetElement.src} alt="" />
                ) : (
                  <span className="trigger-target-summary__icon">
                    {selectedTargetSound ? <AudioLines size={15} /> : <Play size={15} />}
                  </span>
                )}
                <div>
                  <strong>
                    {selectedTargetSound?.name || selectedTargetElement?.displayName ||
                      (selectedTargetElement ? getFileLabel(selectedTargetElement.src) : "Selected target")}
                  </strong>
                  <span>
                    {selectedTargetSound
                      ? "Soundboard clip"
                      : `${selectedTargetElement?.type} layer · ${selectedTargetElement?.visible ? "visible" : "hidden on overlay"}`}
                  </span>
                </div>
              </div>
            )}
            {triggerAction === "send-chat" && (
              <div className="chat-message-editor">
                <label>
                  <span>Chat message</span>
                  <textarea
                    style={{
                      ...fieldStyle,
                      height: 72,
                      paddingTop: 8,
                      resize: "vertical",
                    }}
                    maxLength={500}
                    value={chatMessage}
                    onChange={(e) => setChatMessage(e.target.value)}
                    placeholder="Thanks {user} for the {bits} Bits!"
                    title="Message sent by the connected chatbot account. Event variables in braces are replaced automatically."
                  />
                </label>
                <div
                  className="chat-variable-guide"
                  aria-label="Available chat message variables"
                >
                  <strong>Variables</strong>
                  <code title="Viewer or broadcaster who caused the event">
                    {"{user}"}
                  </code>
                  <code title="Total subscription months">{"{months}"}</code>
                  <code title="Number of incoming raid viewers">
                    {"{viewers}"}
                  </code>
                  <code title="Number of Bits cheered">{"{bits}"}</code>
                  <code title="Channel point reward title">{"{reward}"}</code>
                  <code title="Channel receiving the event">{"{channel}"}</code>
                  <code title="Moderator who issued the ban or timeout">{"{moderator}"}</code>
                  <code title="Moderation reason">{"{reason}"}</code>
                  <code title="Permanent or timeout duration">{"{duration}"}</code>
                  <code title="Either ban or timeout">{"{banType}"}</code>
                </div>
              </div>
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
                  <option value="left-to-right-center">
                    Left → right · center
                  </option>
                  <option value="left-to-right-bottom">
                    Left → right · bottom
                  </option>
                  <option value="right-to-left-top">Right → left · top</option>
                  <option value="right-to-left-center">
                    Right → left · center
                  </option>
                  <option value="right-to-left-bottom">
                    Right → left · bottom
                  </option>
                  <option value="top-to-bottom-left">
                    Top → bottom · left
                  </option>
                  <option value="top-to-bottom-center">
                    Top → bottom · center
                  </option>
                  <option value="top-to-bottom-right">
                    Top → bottom · right
                  </option>
                  <option value="bottom-to-top-left">
                    Bottom → top · left
                  </option>
                  <option value="bottom-to-top-center">
                    Bottom → top · center
                  </option>
                  <option value="bottom-to-top-right">
                    Bottom → top · right
                  </option>
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
                  if (
                    !targetId ||
                    !props.onPreviewFly(targetId, flyDirection, duration)
                  ) {
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
            {!currentStepIsFirst && (
              <label className="command-timing">
                <span>Start this action</span>
                <select
                  style={fieldStyle}
                  value={stepTiming}
                  onChange={(event) =>
                    setStepTiming(
                      event.target.value as NonNullable<TriggerStep["timing"]>,
                    )
                  }
                  title="Choose whether this action starts immediately, after a delay, or when the previous timed media action finishes"
                >
                  <option value="immediate">At the same time</option>
                  <option value="delay">After a delay</option>
                  <option value="after-previous">
                    After previous finishes
                  </option>
                </select>
              </label>
            )}
            {!currentStepIsFirst && stepTiming === "delay" && (
              <label className="command-timing">
                <span>Delay (seconds)</span>
                <input
                  style={fieldStyle}
                  type="number"
                  min="0"
                  max="3600"
                  step="0.5"
                  value={stepDelay}
                  onChange={(event) =>
                    setStepDelay(
                      Math.min(3600, Math.max(0, Number(event.target.value))),
                    )
                  }
                />
              </label>
            )}
            {chainedSteps.length > 0 && (
              <div className="command-chain" aria-label="Command action chain">
                <strong>Action chain</strong>
                {chainedSteps.map((step, index) => (
                  <div
                    className="command-chain__step"
                    key={`${index}-${step.action}`}
                  >
                    <span className="command-chain__description">
                      <b>{index + 1}</b>
                      <span>
                        <strong>{triggerActionLabel(step.action)}</strong>
                        <small>
                          {triggerTimingLabel(step, index)}
                          {step.targetId
                            ? ` · ${props.studio.sounds.find((sound) => sound.id === step.targetId)?.name || props.elements.find((element) => element.id === step.targetId)?.displayName || "media target"}`
                            : ""}
                        </small>
                      </span>
                    </span>
                    <div className="command-chain__actions">
                      <button
                        type="button"
                        className="ui-icon-button"
                        onClick={() => editChainedStep(step, index)}
                        title={`Edit action ${index + 1}`}
                        aria-label={`Edit action ${index + 1}`}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        className="ui-icon-button command-chain__delete"
                        onClick={() => {
                          setChainedSteps((steps) =>
                            steps.filter((_, stepIndex) => stepIndex !== index),
                          );
                          if (editingChainIndex === index) {
                            const pendingStep =
                              pendingStepBeforeChainEdit.current;
                            pendingStepBeforeChainEdit.current = null;
                            if (pendingStep) loadTriggerStep(pendingStep);
                            else resetTriggerStep();
                            setEditingChainIndex(null);
                          } else if (
                            editingChainIndex !== null &&
                            editingChainIndex > index
                          )
                            setEditingChainIndex(editingChainIndex - 1);
                          toast.success("Action removed from command chain");
                        }}
                        title={`Remove action ${index + 1} from this command`}
                        aria-label={`Remove action ${index + 1}`}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                ))}
                <span className="command-chain__pending">
                  {editingChainIndex !== null
                    ? `Editing action ${editingChainIndex + 1}`
                    : `${chainedSteps.length + 1}. ${triggerActionLabel(triggerAction)} (current)`}
                </span>
              </div>
            )}
            <button
              type="button"
              className="ui-button ui-button--compact command-chain__add"
              onClick={addChainedStep}
              disabled={
                (chainedSteps.length >= 9 && editingChainIndex === null) ||
                (!["refresh-overlay", "send-chat"].includes(triggerAction) &&
                  !targetId) ||
                (triggerAction === "send-chat" && !chatMessage.trim())
              }
              title="Keep this action and configure another action for the same chat command"
            >
              {editingChainIndex !== null ? (
                <Save size={13} />
              ) : (
                <Plus size={13} />
              )}
              {editingChainIndex !== null
                ? "Update action"
                : "Add another action"}
            </button>
            {tab === "triggers" && (
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
            )}
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
                editingChainIndex !== null ||
                (!["refresh-overlay", "send-chat"].includes(triggerAction) &&
                  !targetId) ||
                (triggerAction === "send-chat" && !chatMessage.trim())
              }
            >
              {editingTriggerId ? <Save size={14} /> : <Plus size={14} />}{" "}
              {editingTriggerId
                ? "Save changes"
                : tab === "events"
                  ? "Add event action"
                  : "Add command"}
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
            {props.studio.triggers.some((item) =>
              tab === "events" ? item.event !== "chat-command" : item.event === "chat-command",
            ) && (
              <label className="studio-search">
                <Search size={13} aria-hidden="true" />
                <input
                  value={listSearch}
                  onChange={(event) => setListSearch(event.target.value)}
                  placeholder={tab === "events" ? "Search event actions…" : "Search commands…"}
                  aria-label={tab === "events" ? "Search event actions" : "Search commands"}
                />
              </label>
            )}
            {!props.studio.triggers.some((item) =>
              tab === "events" ? item.event !== "chat-command" : item.event === "chat-command",
            ) && (
              <div className="studio-empty-state">
                <strong>{tab === "events" ? "No event actions yet" : "No chat commands yet"}</strong>
                <span>{tab === "events" ? "Choose an event and action above, then save it." : "Name a command, choose what it should do, then add it."}</span>
              </div>
            )}
            {props.studio.triggers
              .filter((item) =>
                (tab === "events"
                  ? item.event !== "chat-command"
                  : item.event === "chat-command") &&
                [item.name, item.match ?? "", item.event].some((value) =>
                  value.toLowerCase().includes(listSearch.trim().toLowerCase()),
                ),
              )
              .map((item) => (
                <Item
                  key={item.id}
                  name={item.name}
                  detail={`${item.event === "chat-command" ? (item.match ?? "command") : item.event} → ${item.steps?.length ? `${item.steps.length} actions` : triggerActionLabel(item.action)}${item.minimum ? ` · min ${item.minimum}` : ""}`}
                  onEdit={() => editTrigger(item)}
                  onPrimary={() => {
                    props.onSaveTrigger({ ...item, enabled: !item.enabled });
                    toast.success(
                      `Command “${item.name}” ${item.enabled ? "disabled" : "enabled"}`,
                    );
                  }}
                  primary={item.enabled ? "Active" : "Disabled"}
                  active={item.enabled}
                  onDelete={async () => {
                    if (!await confirm({
                      title: `Delete “${item.name}”?`,
                      message: "This permanently removes the saved command or event action.",
                      confirmLabel: "Delete action",
                      danger: true,
                    })) return;
                    props.onDeleteTrigger(item.id);
                    toast.success(`Command “${item.name}” deleted`);
                  }}
                />
              ))}
          </Section>
        )}
        {tab === "events" && (
          <Section
            title="Twitch connections"
            description="Broadcasters provide event access; the separate chatbot account sends automated messages."
          >
            {!eventStatus?.configured && (
              <div style={{ ...rowStyle, color: "#fca5a5" }}>
                Event storage is unavailable. Check the server database
                configuration.
              </div>
            )}
            {eventStatus?.configured && (
              <div style={{ ...rowStyle, display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>Chatbot</strong>
                  <span style={{ color: eventStatus.chatbot?.connected ? "#86efac" : "#fca5a5", fontSize: 11 }}>
                    {eventStatus.chatbot?.connected
                      ? `Connected as ${eventStatus.chatbot.displayName}`
                      : "Not connected"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    className="ui-button studio-primary"
                    disabled={!props.isOwner}
                    onClick={() => void twitchEvents.connectChatbot()}
                    title={props.isOwner ? `Authorize ${eventStatus.chatbot?.login ?? "the chatbot"} to send automated messages` : "Only the overlay owner can manage the chatbot connection"}
                  >
                    <Link2 size={13} /> {eventStatus.chatbot?.connected ? "Reconnect chatbot" : "Connect chatbot"}
                  </button>
                  {eventStatus.chatbot?.connected && props.isOwner && (
                    <button
                      className="ui-button ui-danger"
                      onClick={() => void twitchEvents.disconnectChatbot()}
                      title="Remove the chatbot's stored authorization"
                    >
                      Disconnect
                    </button>
                  )}
                </div>
                <div style={{ color: "#8f99a8", fontSize: 10 }}>
                  Outgoing automation messages are sent by this account. Broadcaster tokens are never used to write chat.
                </div>
              </div>
            )}
            {(eventStatus?.channels ?? []).map((status) => {
              const channel = status.channel;
              const hasLegacyChatAccess = status.scopes.includes("user:write:chat");
              const hasBanAccess = status.scopes.includes("channel:moderate");
              return (
                <div
                  key={channel}
                  style={{ ...rowStyle, display: "grid", gap: 8 }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <strong style={{ textTransform: "capitalize" }}>
                      {channel}
                    </strong>
                    <span
                      style={{
                        color: status?.connected ? "#86efac" : "#fca5a5",
                        fontSize: 11,
                      }}
                    >
                      {status?.connected
                        ? `Connected as ${status.displayName}`
                        : "Not connected"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      className="ui-button studio-primary"
                      onClick={() => void twitchEvents.connect(channel)}
                      title={`Authorize event access using the ${channel} Twitch account`}
                    >
                      <Link2 size={13} />{" "}
                      {status?.connected ? "Reconnect" : "Connect"}
                    </button>
                    {status?.connected && (
                      <button
                        className="ui-button ui-danger"
                        onClick={() => void twitchEvents.disconnect(channel)}
                        title={`Disconnect ${channel} Twitch event access`}
                      >
                        Disconnect
                      </button>
                    )}
                  </div>
                  <div style={{ color: "#8f99a8", fontSize: 10 }}>
                    Event access for follows, subscriptions, Bits, channel
                    points, Hype Trains, bans, and timeouts.
                  </div>
                  {status.connected && hasLegacyChatAccess && (
                    <div style={{ color: "#fbbf24", fontSize: 11 }}>
                      This connection still has the old chat-writing permission.
                      Reconnect it to replace that token with event-only access.
                    </div>
                  )}
                  {status.connected && !hasBanAccess && (
                    <div style={{ color: "#fbbf24", fontSize: 11 }}>
                      Reconnect this broadcaster once to enable ban and timeout events.
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {(
                      [
                        "follow",
                        "subscribe",
                        "gift-subscribe",
                        "bits",
                        "raid",
                        "channel-points",
                        "ban",
                        "timeout",
                      ] as const
                    ).map((type) => (
                      <button
                        key={type}
                        className="ui-button ui-button--compact"
                        disabled={!status?.connected}
                        title={`Run a local simulated ${type} event`}
                        onClick={() => void twitchEvents.test(channel, type)}
                      >
                        Test {type}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </Section>
        )}
        {tab === "emotes" && (
          <Section
            title="Chat emotes"
            description="Animate 7TV and Twitch emotes on OBS without adding them to Layers or storing their images."
          >
            <button
              type="button"
              className="ui-button"
              aria-pressed={props.chatEmoteSettings.enabled}
              onClick={() => {
                const enabled = !props.chatEmoteSettings.enabled;
                props.onChatEmoteSettingsChange({
                  ...props.chatEmoteSettings,
                  enabled,
                });
                toast.success(
                  `Chat emotes ${enabled ? "enabled" : "disabled"}`,
                );
              }}
              title="Enable or disable automatic 7TV and Twitch emotes from the currently monitored chat"
              style={{
                width: "100%",
                justifyContent: "space-between",
                border: `1px solid ${props.chatEmoteSettings.enabled ? "#16a34a" : "#7f1d1d"}`,
                background: props.chatEmoteSettings.enabled
                  ? "#052e16"
                  : "#2a1717",
                color: props.chatEmoteSettings.enabled ? "#bbf7d0" : "#fecaca",
              }}
            >
              <span>Chat emotes</span>
              <span>
                {props.chatEmoteSettings.enabled ? "Enabled" : "Disabled"}
              </span>
            </button>
            <div className="chat-emote-preview">
              <ChatEmoteLayer
                preview
                spawn={emotePreview}
                settings={props.chatEmoteSettings}
              />
              <span>Dashboard-only preview</span>
            </div>
            <button
              type="button"
              className="ui-button ui-button--compact soundboard-action"
              onClick={() => {
                setEmotePreview({
                  id: randomUUID(),
                  emoteId: "preview",
                  name: "Preview",
                  imageUrl: previewEmote,
                  sender: "Vicksy viewer",
                  senderColor: "#fb923c",
                });
                toast.info("Playing a dashboard-only emote preview");
              }}
              title="Preview the selected emote movement locally without showing anything on OBS"
            >
              <Play size={13} /> Preview movement
            </button>
            <div className="chat-emote-card">
              <strong className="chat-emote-card__title">Behavior</strong>
              <label className="chat-emote-setting">
                <span>Show sender names</span>
                <input
                  type="checkbox"
                  checked={props.chatEmoteSettings.showNames}
                  onChange={(event) => {
                    props.onChatEmoteSettingsChange({
                      ...props.chatEmoteSettings,
                      showNames: event.target.checked,
                    });
                    toast.success(
                      `Sender names ${event.target.checked ? "shown" : "hidden"}`,
                    );
                  }}
                    title="Display the Twitch sender's name above each emote"
                />
              </label>
              {props.chatEmoteSettings.showNames && (
                <label className="chat-emote-setting">
                  <span>Name background</span>
                  <input
                    type="checkbox"
                    checked={props.chatEmoteSettings.nameBackgroundEnabled}
                    onChange={(event) => {
                      props.onChatEmoteSettingsChange({
                        ...props.chatEmoteSettings,
                        nameBackgroundEnabled: event.target.checked,
                      });
                      toast.success(
                        `Name backgrounds ${event.target.checked ? "shown" : "hidden"}`,
                      );
                    }}
                    title="Show or hide the colored background behind sender names"
                  />
                </label>
              )}
              {props.chatEmoteSettings.showNames &&
                props.chatEmoteSettings.nameBackgroundEnabled && (
                  <label className="chat-emote-setting">
                    <span>Background color</span>
                    <input
                      type="color"
                      value={props.chatEmoteSettings.nameBackgroundColor}
                      onChange={(event) =>
                        props.onChatEmoteSettingsChange({
                          ...props.chatEmoteSettings,
                          nameBackgroundColor: event.target.value,
                        })
                      }
                      title="Choose the background color behind sender names"
                    />
                  </label>
                )}
              {props.chatEmoteSettings.showNames && (
                <label className="chat-emote-range">
                  <span>Name text size</span>
                  <input
                    type="range"
                    min="9"
                    max="32"
                    step="1"
                    value={props.chatEmoteSettings.nameFontSize}
                    onChange={(event) =>
                      props.onChatEmoteSettingsChange({
                        ...props.chatEmoteSettings,
                        nameFontSize: Number(event.target.value),
                      })
                    }
                    title="Set the sender-name text size"
                  />
                  <strong>{props.chatEmoteSettings.nameFontSize}px</strong>
                </label>
              )}
              <label className="chat-emote-setting chat-emote-setting--motion">
                <span>Movement</span>
                <select
                  style={fieldStyle}
                  value={props.chatEmoteSettings.motion}
                  onChange={(event) => {
                    const motion = event.target.value as ChatEmoteSettings["motion"];
                    props.onChatEmoteSettingsChange({ ...props.chatEmoteSettings, motion });
                    toast.success(
                      motion === "parade" ? "Using the bottom parade"
                        : motion === "corners" ? "Emotes will travel around the corners"
                          : motion === "floor" ? "Using floor bounce physics"
                            : "Using wall-to-wall bounce",
                    );
                  }}
                  title="Choose how chat emotes move across the overlay"
                >
                  <option value="parade">Bottom parade</option>
                  <option value="corners">Corner route</option>
                  <option value="floor">Floor bounce</option>
                  <option value="walls">Wall bounce</option>
                </select>
              </label>
              {(props.chatEmoteSettings.motion === "parade" || props.chatEmoteSettings.motion === "corners") && (
                <label className="chat-emote-setting">
                  <span>Direction</span>
                  <select
                    style={fieldStyle}
                    value={props.chatEmoteSettings.direction}
                    onChange={(event) => {
                      const direction = event.target.value as ChatEmoteSettings["direction"];
                      props.onChatEmoteSettingsChange({ ...props.chatEmoteSettings, direction });
                      toast.success(`Emotes will travel ${direction}`);
                    }}
                    title={props.chatEmoteSettings.motion === "parade"
                      ? "Choose whether the parade travels left or right"
                      : "Choose which bottom corner the route starts from"}
                  >
                    <option value="left">
                      {props.chatEmoteSettings.motion === "corners" ? "Counter-clockwise · start right" : "Right to left"}
                    </option>
                    <option value="right">
                      {props.chatEmoteSettings.motion === "corners" ? "Clockwise · start left" : "Left to right"}
                    </option>
                  </select>
                </label>
              )}
            </div>
            <div className="chat-emote-card">
              <strong className="chat-emote-card__title">
                Motion & limits
              </strong>
              {(
                [
                  ["Emote size", "size", 24, 100, 2, "px"],
                  ["Movement speed", "speed", 40, 600, 10, " px/s"],
                  ["Gravity", "gravity", 100, 2400, 50, " px/s²"],
                  ["Lifetime", "lifetimeSeconds", 2, 120, 1, "s"],
                  ["Maximum visible", "maxVisible", 1, 100, 1, ""],
                ] as const
              )
                .filter(
                  ([, key]) =>
                    key !== "gravity" ||
                    props.chatEmoteSettings.motion === "floor",
                )
                .map(([label, key, min, max, step, suffix]) => (
                  <label className="chat-emote-range" key={key}>
                    <span>{label}</span>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={props.chatEmoteSettings[key]}
                      onChange={(event) =>
                        props.onChatEmoteSettingsChange({
                          ...props.chatEmoteSettings,
                          [key]: Number(event.target.value),
                        })
                      }
                      title={`Set ${label.toLowerCase()}`}
                    />
                    <strong>
                      {props.chatEmoteSettings[key]}
                      {suffix}
                    </strong>
                  </label>
                ))}
            </div>
            <div className="chat-emote-card">
              <strong className="chat-emote-card__title">
                Additional emotes
              </strong>
              <span className="chat-emote-card__description">
                The first emote in a message always appears. Later emotes only
                appear when their exact 7TV name is listed here.
              </span>
              <div className="chat-emote-blacklist__add">
                <input
                  style={fieldStyle}
                  value={additionalEmoteName}
                  onChange={(event) => setAdditionalEmoteName(event.target.value.trim())}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    event.currentTarget.nextElementSibling instanceof HTMLButtonElement &&
                      event.currentTarget.nextElementSibling.click();
                  }}
                  placeholder="PianoTime"
                  maxLength={64}
                  title="Enter the exact case-insensitive Twitch or 7TV emote name"
                />
                <button
                  type="button"
                  className="ui-button ui-button--compact"
                  disabled={
                    !/^[a-z0-9_]{1,64}$/i.test(additionalEmoteName) ||
                    props.chatEmoteSettings.additionalEmotes.some(
                      (name) => name.toLowerCase() === additionalEmoteName.toLowerCase(),
                    )
                  }
                  onClick={() => {
                    if (!/^[a-z0-9_]{1,64}$/i.test(additionalEmoteName)) {
                      toast.error("Enter a valid 7TV emote name");
                      return;
                    }
                    props.onChatEmoteSettingsChange({
                      ...props.chatEmoteSettings,
                      additionalEmotes: [...props.chatEmoteSettings.additionalEmotes, additionalEmoteName],
                    });
                    toast.success(`${additionalEmoteName} can now appear after the first emote`);
                    setAdditionalEmoteName("");
                  }}
                  title="Allow this emote after the first emote in a message"
                >
                  <Plus size={13} /> Allow
                </button>
              </div>
              {props.chatEmoteSettings.additionalEmotes.length ? (
                <div className="chat-emote-blacklist">
                  {props.chatEmoteSettings.additionalEmotes.map((emoteName) => (
                    <span key={emoteName.toLowerCase()}>
                      {emoteName}
                      <button
                        type="button"
                        onClick={() => {
                          props.onChatEmoteSettingsChange({
                            ...props.chatEmoteSettings,
                            additionalEmotes: props.chatEmoteSettings.additionalEmotes.filter(
                              (name) => name.toLowerCase() !== emoteName.toLowerCase(),
                            ),
                          });
                          toast.success(`${emoteName} removed from additional emotes`);
                        }}
                        title={`Stop allowing ${emoteName} after the first emote`}
                        aria-label={`Remove ${emoteName} from additional emotes`}
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <span className="chat-emote-blacklist__empty">No additional emotes allowed</span>
              )}
            </div>
            <div className="chat-emote-card">
              <strong className="chat-emote-card__title">
                Blocked chatters
              </strong>
              <span className="chat-emote-card__description">
                These Twitch usernames cannot spawn chat emotes. Commands are
                unaffected.
              </span>
              <div className="chat-emote-blacklist__add">
                <input
                  style={fieldStyle}
                  value={blacklistName}
                  onChange={(event) =>
                    setBlacklistName(
                      event.target.value.replace(/^@/, "").toLowerCase(),
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    event.currentTarget.nextElementSibling instanceof
                      HTMLButtonElement &&
                      event.currentTarget.nextElementSibling.click();
                  }}
                  placeholder="username"
                  maxLength={25}
                  title="Enter a Twitch username to prevent their emotes from appearing"
                />
                <button
                  type="button"
                  className="ui-button ui-button--compact"
                  disabled={
                    !/^[a-z0-9_]{1,25}$/.test(blacklistName) ||
                    props.chatEmoteSettings.blacklist.includes(blacklistName)
                  }
                  onClick={() => {
                    if (!/^[a-z0-9_]{1,25}$/.test(blacklistName)) {
                      toast.error("Enter a valid Twitch username");
                      return;
                    }
                    props.onChatEmoteSettingsChange({
                      ...props.chatEmoteSettings,
                      blacklist: [
                        ...props.chatEmoteSettings.blacklist,
                        blacklistName,
                      ],
                    });
                    toast.success(`@${blacklistName} blocked from chat emotes`);
                    setBlacklistName("");
                  }}
                  title="Add this username to the chat-emote blacklist"
                >
                  <Plus size={13} /> Block
                </button>
              </div>
              {props.chatEmoteSettings.blacklist.length ? (
                <div className="chat-emote-blacklist">
                  {props.chatEmoteSettings.blacklist.map((username) => (
                    <span key={username}>
                      @{username}
                      <button
                        type="button"
                        onClick={() => {
                          props.onChatEmoteSettingsChange({
                            ...props.chatEmoteSettings,
                            blacklist: props.chatEmoteSettings.blacklist.filter(
                              (item) => item !== username,
                            ),
                          });
                          toast.success(
                            `@${username} removed from the blacklist`,
                          );
                        }}
                        title={`Allow @${username} to spawn chat emotes again`}
                        aria-label={`Remove ${username} from blacklist`}
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <span className="chat-emote-blacklist__empty">
                  No blocked chatters
                </span>
              )}
            </div>
            <p className="chat-emote-note">
              Both channel 7TV sets follow the active preview. Native Vicksy and
              Wixels Twitch emotes are recognized from chat in either channel.
              Images remain on their providers’ CDNs.
            </p>
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

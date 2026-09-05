import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  Info,
  RefreshCw,
  X,
} from "lucide-react";
import type { CanvasElement, StudioState, TriggerStep } from "../types";
import { STREAM_H, STREAM_OFFSET_X, STREAM_OFFSET_Y, STREAM_W } from "../canvas/config";
import { authHeaders } from "../hooks/useAuth";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

type CheckKind = "pass" | "warning" | "info";
interface CheckItem {
  kind: CheckKind;
  title: string;
  detail: string;
}
interface EventStatus {
  configured: boolean;
  channels: Array<{ channel: string; connected: boolean }>;
}

function triggerSteps(studio: StudioState) {
  return studio.triggers.flatMap((trigger) =>
    (trigger.steps?.length ? trigger.steps : [trigger]).map((step) => ({ trigger, step })),
  );
}

function missingTargets(elements: CanvasElement[], studio: StudioState) {
  const elementIds = new Set(elements.map((element) => element.id));
  const soundIds = new Set(studio.sounds.map((sound) => sound.id));
  return triggerSteps(studio).filter(({ step }: { step: TriggerStep }) => {
    if (!step.targetId) return false;
    return step.action === "play-sound"
      ? !soundIds.has(step.targetId)
      : !elementIds.has(step.targetId);
  });
}

export function ReadinessCheck({
  connected,
  overlayConnected,
  overlayCount,
  twitchConnected,
  twitchChannel,
  chatEmotesEnabled,
  elements,
  studio,
}: {
  connected: boolean;
  overlayConnected: boolean;
  overlayCount: number;
  twitchConnected: boolean;
  twitchChannel: string;
  chatEmotesEnabled: boolean;
  elements: CanvasElement[];
  studio: StudioState;
}) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<EventStatus | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [mediaResult, setMediaResult] = useState<{ checked: number; failed: number } | null>(null);

  const refreshEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const response = await fetch(`${SERVER_URL}/events/status`, { headers: authHeaders() });
      setEvents(response.ok ? await response.json() : null);
    } catch {
      setEvents(null);
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  const refreshMedia = useCallback(async () => {
    const urls = [...new Set([
      ...elements.filter((element) => element.type !== "text").map((element) => element.src),
      ...studio.sounds.map((sound) => sound.url),
    ])].filter((url) => url.startsWith(SERVER_URL)).slice(0, 100);
    if (urls.length === 0) {
      setMediaResult({ checked: 0, failed: 0 });
      return;
    }
    const results = await Promise.all(urls.map(async (url) => {
      try {
        return (await fetch(url, { method: "HEAD", cache: "no-store" })).ok;
      } catch {
        return false;
      }
    }));
    setMediaResult({ checked: urls.length, failed: results.filter((result) => !result).length });
  }, [elements, studio.sounds]);

  const refreshChecks = useCallback(() => {
    void refreshEvents();
    void refreshMedia();
  }, [refreshEvents, refreshMedia]);

  useEffect(() => {
    if (open) refreshChecks();
  }, [open, refreshChecks]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  const checks = useMemo<CheckItem[]>(() => {
    const missing = missingTargets(elements, studio);
    const offscreen = elements.filter((element) =>
      element.visible && (
        element.x + element.width <= STREAM_OFFSET_X ||
        element.y + element.height <= STREAM_OFFSET_Y ||
        element.x >= STREAM_OFFSET_X + STREAM_W ||
        element.y >= STREAM_OFFSET_Y + STREAM_H
      ),
    );
    const enabledDvd = elements.filter((element) => element.visible && element.dvdEnabled).length;
    const connectedEvents = events?.channels.filter((channel) => channel.connected).length ?? 0;
    const totalEvents = events?.channels.length ?? 0;
    return [
      {
        kind: connected ? "pass" : "warning",
        title: "Dashboard server",
        detail: connected ? "Realtime connection is online." : "Disconnected—changes will not reach OBS.",
      },
      {
        kind: overlayConnected ? "pass" : "warning",
        title: "OBS overlay",
        detail: overlayConnected
          ? `${overlayCount} overlay browser source${overlayCount === 1 ? " is" : "s are"} connected.`
          : "No overlay browser source is connected.",
      },
      {
        kind: twitchConnected ? "pass" : "warning",
        title: "Chat listener",
        detail: twitchConnected
          ? `Listening to ${twitchChannel} chat commands and emotes.`
          : `The ${twitchChannel} anonymous chat listener is reconnecting.`,
      },
      {
        kind: events === null
          ? "info"
          : events.configured && connectedEvents === totalEvents && totalEvents > 0
            ? "pass"
            : "warning",
        title: "Twitch Events",
        detail: loadingEvents
          ? "Checking broadcaster connections…"
          : events?.configured
            ? `${connectedEvents}/${totalEvents} broadcaster accounts connected.`
            : events === null
              ? "Open this check or use Recheck to verify broadcaster connections."
              : "Event storage or broadcaster connections could not be verified.",
      },
      {
        kind: missing.length === 0 ? "pass" : "warning",
        title: "Command targets",
        detail: missing.length === 0
          ? "Every saved command action points to existing media or sound."
          : `${missing.length} saved action${missing.length === 1 ? " has" : "s have"} a missing target. Edit or remove them before going live.`,
      },
      {
        kind: mediaResult === null || mediaResult.failed === 0 ? (mediaResult === null ? "info" : "pass") : "warning",
        title: "Uploaded media",
        detail: mediaResult === null
          ? "Local upload URLs have not been checked yet."
          : mediaResult.checked === 0
            ? "No server-hosted media URLs need checking."
            : mediaResult.failed === 0
              ? `${mediaResult.checked} server-hosted media URL${mediaResult.checked === 1 ? " is" : "s are"} reachable.`
              : `${mediaResult.failed}/${mediaResult.checked} server-hosted media URL${mediaResult.failed === 1 ? " is" : "s are"} unavailable.`,
      },
      {
        kind: offscreen.length === 0 ? "pass" : "info",
        title: "Visible media placement",
        detail: offscreen.length === 0
          ? "All visible layers intersect the 1920×1080 stream area."
          : `${offscreen.length} visible layer${offscreen.length === 1 ? " is" : "s are"} staged completely outside the stream area.`,
      },
      {
        kind: "info",
        title: "Active effects",
        detail: `${enabledDvd} visible DVD element${enabledDvd === 1 ? "" : "s"}; chat emotes are ${chatEmotesEnabled ? "active" : "off"}.`,
      },
      {
        kind: "info",
        title: "OBS source settings",
        detail: "Confirm the Browser Source is 1920×1080. Its dimensions cannot be read remotely from the dashboard.",
      },
      {
        kind: "info",
        title: "Render persistence",
        detail: "Uploads, canvas state, and LowDB Studio data remain ephemeral without persistent storage. Neon keeps whitelist and encrypted Twitch authorization.",
      },
    ];
  }, [chatEmotesEnabled, connected, elements, events, loadingEvents, mediaResult, overlayConnected, overlayCount, studio, twitchChannel, twitchConnected]);

  const warningCount = checks.filter((check) => check.kind === "warning").length;

  return (
    <>
      <button
        className="ui-button readiness-button"
        onClick={() => setOpen(true)}
        title="Check the server, OBS, Twitch connections, command targets, and stream placement"
      >
        <ClipboardCheck size={14} /> Go-live check
        {warningCount > 0 && <span>{warningCount}</span>}
      </button>
      {open && (
        <div className="readiness-backdrop" onMouseDown={() => setOpen(false)}>
          <section
            className="readiness-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="readiness-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2 id="readiness-title">Stream readiness</h2>
                <p>{warningCount ? `${warningCount} item${warningCount === 1 ? " needs" : "s need"} attention.` : "Core checks look ready."}</p>
              </div>
              <button className="ui-icon-button" onClick={() => setOpen(false)} title="Close stream readiness"><X size={16} /></button>
            </header>
            <div className="readiness-list">
              {checks.map((check) => {
                const Icon = check.kind === "pass" ? CheckCircle2 : check.kind === "warning" ? CircleAlert : Info;
                return (
                  <div key={check.title} className={`readiness-item readiness-item--${check.kind}`}>
                    <Icon size={17} aria-hidden="true" />
                    <div><strong>{check.title}</strong><span>{check.detail}</span></div>
                  </div>
                );
              })}
            </div>
            <footer>
              <button className="ui-button" onClick={refreshChecks} disabled={loadingEvents} title="Check connections, command targets, and uploaded media again">
                <RefreshCw size={13} className={loadingEvents ? "spin" : undefined} /> Recheck
              </button>
              <button className="ui-button studio-primary" onClick={() => setOpen(false)}>Done</button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

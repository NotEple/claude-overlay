import { useCallback, useEffect, useState } from "react";
import type { TriggerEventType } from "../types";
import { authHeaders } from "./useAuth";
import { useToast } from "../components/ToastProvider";
import { useConfirm } from "../components/ConfirmProvider";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
type TestableEvent = Exclude<TriggerEventType, "chat-command">;

export interface TwitchEventChannelStatus {
  channel: string;
  connected: boolean;
  displayName?: string;
  scopes: string[];
}

export interface TwitchEventStatus {
  configured: boolean;
  channels: TwitchEventChannelStatus[];
}

/** Owns Twitch Events connection status and all related HTTP actions. */
export function useTwitchEvents(active: boolean) {
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState<TwitchEventStatus | null>(null);

  const refresh = useCallback(async (showError = false) => {
    try {
      const response = await fetch(`${SERVER_URL}/events/status`, {
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error();
      setStatus(await response.json());
    } catch {
      if (showError) toast.error("Could not refresh Twitch Events status");
    }
  }, [toast]);

  useEffect(() => {
    if (!active) return;
    void refresh(true);
    const refreshQuietly = () => void refresh();
    const interval = window.setInterval(refreshQuietly, 5_000);
    window.addEventListener("focus", refreshQuietly);
    document.addEventListener("visibilitychange", refreshQuietly);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshQuietly);
      document.removeEventListener("visibilitychange", refreshQuietly);
    };
  }, [active, refresh]);

  const connect = useCallback(async (channel: string) => {
    try {
      const response = await fetch(`${SERVER_URL}/auth/events/start/${channel}`, {
        headers: authHeaders(),
      });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) {
        toast.error(data.error ?? "Could not start Twitch authorization");
        return;
      }
      window.location.href = data.url;
    } catch {
      toast.error("Could not reach the server to start Twitch authorization");
    }
  }, [toast]);

  const disconnect = useCallback(async (channel: string) => {
    if (!await confirm({
      title: `Disconnect ${channel}?`,
      message: "Twitch events and configured chat messages for this broadcaster will stop until it is authorized again.",
      confirmLabel: "Disconnect",
      danger: true,
    })) return;
    try {
      const response = await fetch(`${SERVER_URL}/events/${channel}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error();
      toast.success(`${channel} event access disconnected`);
      void refresh();
    } catch {
      toast.error(`Could not disconnect ${channel} event access`);
    }
  }, [confirm, refresh, toast]);

  const test = useCallback(async (channel: string, type: TestableEvent) => {
    try {
      const response = await fetch(`${SERVER_URL}/events/${channel}/test`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      response.ok
        ? toast.success(`Simulated ${type} event sent`)
        : toast.error(`Could not simulate the ${type} event`);
    } catch {
      toast.error(`Could not reach the server to test the ${type} event`);
    }
  }, [toast]);

  return { status, connect, disconnect, test };
}

import { createHmac, timingSafeEqual } from "crypto";
import { Router, type Request } from "express";
import { getAppAccessToken, twitchClientId } from "../auth/twitch.js";
import type { TriggerEventType } from "../types.js";
import type { StoredEventAuth } from "./eventAuthStore.js";

const callback = process.env.TWITCH_EVENTSUB_CALLBACK_URL;
const secret = process.env.TWITCH_EVENTSUB_SECRET;
const handledMessages = new Map<string, number>();
const MESSAGE_TTL_MS = 10 * 60_000;

function isDuplicateMessage(id: string) {
  const now = Date.now();
  for (const [messageId, receivedAt] of handledMessages) {
    if (now - receivedAt > MESSAGE_TTL_MS) handledMessages.delete(messageId);
  }
  if (handledMessages.has(id)) return true;
  handledMessages.set(id, now);
  return false;
}

const subscriptions = [
  ["channel.follow", "2", (id: string) => ({ broadcaster_user_id: id, moderator_user_id: id })],
  ["channel.subscribe", "1", (id: string) => ({ broadcaster_user_id: id })],
  ["channel.subscription.message", "1", (id: string) => ({ broadcaster_user_id: id })],
  ["channel.subscription.gift", "1", (id: string) => ({ broadcaster_user_id: id })],
  ["channel.cheer", "1", (id: string) => ({ broadcaster_user_id: id })],
  ["channel.raid", "1", (id: string) => ({ to_broadcaster_user_id: id })],
  ["channel.channel_points_custom_reward_redemption.add", "1", (id: string) => ({ broadcaster_user_id: id })],
  ["channel.ban", "1", (id: string) => ({ broadcaster_user_id: id })],
] as const;

export async function registerEventSubscriptions(auth: StoredEventAuth) {
  if (!callback || !secret) {
    console.warn("Skipping EventSub registration: callback URL or secret is not configured");
    return;
  }
  if (!callback.startsWith("https://")) throw new Error("TWITCH_EVENTSUB_CALLBACK_URL must use HTTPS");
  const token = await getAppAccessToken();
  for (const [type, version, condition] of subscriptions) {
    const response = await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
      method: "POST",
      headers: { "Client-Id": twitchClientId, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type, version, condition: condition(auth.twitchUserId), transport: { method: "webhook", callback, secret } }),
    });
    if (!response.ok && response.status !== 409) {
      const detail = await response.text();
      throw new Error(`Could not register ${type} (${response.status}): ${detail.slice(0, 300)}`);
    }
  }
}

function validSignature(req: Request, body: Buffer) {
  if (!secret) return false;
  const id = String(req.header("Twitch-Eventsub-Message-Id") ?? "");
  const timestamp = String(req.header("Twitch-Eventsub-Message-Timestamp") ?? "");
  const supplied = String(req.header("Twitch-Eventsub-Message-Signature") ?? "");
  if (!id || !timestamp || Math.abs(Date.now() - Date.parse(timestamp)) > 10 * 60_000) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(id + timestamp).update(body).digest("hex")}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

const eventTypes: Record<string, TriggerEventType> = {
  "channel.follow": "follow",
  "channel.subscribe": "subscribe",
  "channel.subscription.message": "subscribe",
  "channel.subscription.gift": "gift-subscribe",
  "channel.cheer": "bits",
  "channel.raid": "raid",
  "channel.channel_points_custom_reward_redemption.add": "channel-points",
};

export function createEventWebhook(emitEvent: (type: TriggerEventType, event: any) => void) {
  const router = Router();
  router.post("/", (req, res) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !validSignature(req, body)) return res.status(403).send("Invalid EventSub signature");
    let payload: any;
    try { payload = JSON.parse(body.toString("utf8")); }
    catch { return res.status(400).send("Invalid JSON"); }
    const messageType = req.header("Twitch-Eventsub-Message-Type");
    if (messageType === "webhook_callback_verification") return res.type("text/plain").send(payload.challenge);
    if (messageType === "notification") {
      const messageId = String(req.header("Twitch-Eventsub-Message-Id") ?? "");
      if (isDuplicateMessage(messageId)) return res.sendStatus(204);
      const type = payload.subscription?.type === "channel.ban"
        ? (payload.event?.is_permanent ? "ban" : "timeout")
        : eventTypes[payload.subscription?.type];
      if (type) emitEvent(type, { ...payload.event, channel: payload.event?.broadcaster_user_login ?? payload.event?.to_broadcaster_user_login });
    }
    return res.sendStatus(204);
  });
  return router;
}

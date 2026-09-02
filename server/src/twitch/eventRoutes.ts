import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { Router } from "express";
import { getUserFromRequest } from "../auth/routes.js";
import { exchangeCodeForRedirect, getTwitchEventsAuthUrl, getTwitchUserFromToken, twitchEventsRedirectUri } from "../auth/twitch.js";
import { deleteEventAuth, eventDatabaseConfigured, getEventAuth, saveEventAuth, type EventChannel } from "./eventAuthStore.js";
import type { TriggerEventType } from "../types.js";
import { registerEventSubscriptions } from "./eventWebhook.js";

const twitchLoginPattern = /^[a-z0-9_]{3,25}$/;
export function getEventChannels(): EventChannel[] {
  const configured = process.env.EVENT_CHANNELS ?? "vicksy,wixels";
  return [...new Set(configured.split(",").map((value) => value.trim().toLowerCase()).filter((value) => twitchLoginPattern.test(value)))];
}
function isEventChannel(channel: string): channel is EventChannel {
  return getEventChannels().includes(channel);
}
function canManageEventChannel(req: Parameters<typeof getUserFromRequest>[0], channel: EventChannel) {
  const user = getUserFromRequest(req);
  return !!user && (user.isOwner || user.login.toLowerCase() === channel);
}
const sessionSecret = process.env.SESSION_SECRET ?? "development-only-secret";
const clientUrl = process.env.CLIENT_URL ?? "http://localhost:5173";
const redirectUri = twitchEventsRedirectUri;
export const EVENT_SCOPES = ["user:read:chat", "user:write:chat", "moderator:read:followers", "channel:read:subscriptions", "bits:read", "channel:read:redemptions", "channel:read:hype_train"];

function createState(channel: EventChannel) {
  const payload = Buffer.from(JSON.stringify({ channel, expires: Date.now() + 600_000, nonce: randomBytes(16).toString("hex") })).toString("base64url");
  return `${payload}.${createHmac("sha256", sessionSecret).update(payload).digest("base64url")}`;
}
function parseState(state: string): EventChannel | null {
  try {
    const [payload, signature] = state.split(".");
    const expected = createHmac("sha256", sessionSecret).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const value = JSON.parse(Buffer.from(payload, "base64url").toString()) as { channel: EventChannel; expires: number };
    return isEventChannel(value.channel) && value.expires > Date.now() ? value.channel : null;
  } catch { return null; }
}

export function createEventRoutes(emitEvent: (type: TriggerEventType, event: any) => void) {
  const router = Router();
  router.get("/auth/events/start/:channel", (req, res) => {
    const channel = req.params.channel.toLowerCase() as EventChannel;
    if (!isEventChannel(channel)) return res.status(400).json({ error: "Unknown Events channel" });
    if (!canManageEventChannel(req, channel)) return res.status(403).json({ error: `Sign into the dashboard as ${channel} or the overlay owner to connect this channel` });
    if (!eventDatabaseConfigured()) return res.status(503).json({ error: "Event storage is not configured" });
    res.json({ url: getTwitchEventsAuthUrl(createState(channel)) });
  });
  router.get("/auth/events/callback", async (req, res) => {
    let stage = "authorization";
    try {
      if (req.query.error) {
        console.warn("Twitch Events authorization was denied", req.query.error, req.query.error_description);
        return res.redirect(`${clientUrl}/?events_error=twitch_denied`);
      }
      const channel = parseState(String(req.query.state ?? ""));
      if (!channel || !req.query.code) throw new Error("Invalid authorization state");
      stage = "token_exchange";
      const token = await exchangeCodeForRedirect(String(req.query.code), redirectUri);
      const missingScopes = EVENT_SCOPES.filter((scope) => !token.scopes.includes(scope));
      if (missingScopes.length) throw new Error(`Twitch did not grant required scopes: ${missingScopes.join(", ")}`);
      stage = "account_lookup";
      const twitchUser = await getTwitchUserFromToken(token.accessToken);
      if (twitchUser.login.toLowerCase() !== channel) return res.redirect(`${clientUrl}/?events_error=expected_${channel}&events_actual=${encodeURIComponent(twitchUser.login.toLowerCase())}`);
      stage = "database_save";
      await saveEventAuth({ channel, twitchUserId: twitchUser.id, displayName: twitchUser.display_name,
        accessToken: token.accessToken, refreshToken: token.refreshToken,
        expiresAt: Date.now() + token.expiresIn * 1000, scopes: token.scopes });
      stage = "eventsub_registration";
      await registerEventSubscriptions({ channel, twitchUserId: twitchUser.id, displayName: twitchUser.display_name,
        accessToken: token.accessToken, refreshToken: token.refreshToken,
        expiresAt: Date.now() + token.expiresIn * 1000, scopes: token.scopes });
      res.redirect(`${clientUrl}/?events_connected=${channel}`);
    } catch (error) {
      console.error(`Event authorization failed during ${stage}`, error);
      res.redirect(`${clientUrl}/?events_error=${stage}`);
    }
  });
  router.get("/events/status", async (req, res) => {
    if (!getUserFromRequest(req)) return res.status(401).json({ error: "Not authenticated" });
    const values = await Promise.all(getEventChannels().map(async (channel) => {
      const auth = await getEventAuth(channel);
      return { channel, connected: !!auth, displayName: auth?.displayName, scopes: auth?.scopes ?? [] };
    }));
    res.json({ configured: eventDatabaseConfigured(), channels: values });
  });
  router.delete("/events/:channel", async (req, res) => {
    const channel = req.params.channel as EventChannel;
    if (!isEventChannel(channel) || !canManageEventChannel(req, channel)) return res.status(403).json({ error: "Not allowed" });
    await deleteEventAuth(channel); res.status(204).end();
  });
  router.post("/events/:channel/test", (req, res) => {
    const channel = req.params.channel as EventChannel;
    const type = req.body?.type as TriggerEventType;
    if (!isEventChannel(channel) || !canManageEventChannel(req, channel)) return res.status(403).json({ error: "Not allowed" });
    if (!["follow", "subscribe", "gift-subscribe", "raid", "bits", "channel-points"].includes(type)) return res.status(400).json({ error: "Unsupported event" });
    emitEvent(type, {
      message: { text: "Test event" }, channel, broadcaster_user_login: channel,
      user_name: "Test Viewer", from_broadcaster_user_name: "Test Raider",
      simulated: true, bits: type === "bits" ? 100 : undefined,
      viewers: type === "raid" ? 25 : undefined,
      cumulative_months: type === "subscribe" ? 12 : undefined,
      duration_months: type === "subscribe" ? 1 : undefined,
      total: type === "gift-subscribe" ? 5 : undefined,
      reward: type === "channel-points" ? { title: "Test reward" } : undefined,
    });
    res.json({ ok: true });
  });
  return router;
}

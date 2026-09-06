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
// Broadcasters only authorize the read permissions needed by EventSub. Outgoing
// chat uses the independently-authorized chatbot account below.
export const EVENT_SCOPES = ["moderator:read:followers", "channel:read:subscriptions", "bits:read", "channel:read:redemptions", "channel:read:hype_train", "channel:moderate"];
export const CHATBOT_AUTH_KEY = "__chatbot__";
export const CHATBOT_SCOPES = ["user:write:chat"];
const chatbotLogin = (process.env.CHAT_BOT_USERNAME ?? "dankchapbot").trim().toLowerCase();
type AuthTarget = EventChannel | typeof CHATBOT_AUTH_KEY;

function createState(channel: AuthTarget) {
  const payload = Buffer.from(JSON.stringify({ channel, expires: Date.now() + 600_000, nonce: randomBytes(16).toString("hex") })).toString("base64url");
  return `${payload}.${createHmac("sha256", sessionSecret).update(payload).digest("base64url")}`;
}
function parseState(state: string): AuthTarget | null {
  try {
    const [payload, signature] = state.split(".");
    const expected = createHmac("sha256", sessionSecret).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const value = JSON.parse(Buffer.from(payload, "base64url").toString()) as { channel: AuthTarget; expires: number };
    return (value.channel === CHATBOT_AUTH_KEY || isEventChannel(value.channel)) && value.expires > Date.now() ? value.channel : null;
  } catch { return null; }
}

export function createEventRoutes(emitEvent: (type: TriggerEventType, event: any) => void) {
  const router = Router();
  router.get("/auth/events/start/:channel", (req, res) => {
    const channel = req.params.channel.toLowerCase() as EventChannel;
    if (!isEventChannel(channel)) return res.status(400).json({ error: "Unknown Events channel" });
    if (!canManageEventChannel(req, channel)) return res.status(403).json({ error: `Sign into the dashboard as ${channel} or the overlay owner to connect this channel` });
    if (!eventDatabaseConfigured()) return res.status(503).json({ error: "Event storage is not configured" });
    res.json({ url: getTwitchEventsAuthUrl(createState(channel), EVENT_SCOPES) });
  });
  router.get("/auth/chatbot/start", (req, res) => {
    const user = getUserFromRequest(req);
    if (!user?.isOwner) return res.status(403).json({ error: "Only the overlay owner can connect the chatbot" });
    if (!eventDatabaseConfigured()) return res.status(503).json({ error: "Event storage is not configured" });
    res.json({ url: getTwitchEventsAuthUrl(createState(CHATBOT_AUTH_KEY), CHATBOT_SCOPES) });
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
      const expectedLogin = channel === CHATBOT_AUTH_KEY ? chatbotLogin : channel;
      const requiredScopes = channel === CHATBOT_AUTH_KEY ? CHATBOT_SCOPES : EVENT_SCOPES;
      const missingScopes = requiredScopes.filter((scope) => !token.scopes.includes(scope));
      if (missingScopes.length) throw new Error(`Twitch did not grant required scopes: ${missingScopes.join(", ")}`);
      stage = "account_lookup";
      const twitchUser = await getTwitchUserFromToken(token.accessToken);
      if (twitchUser.login.toLowerCase() !== expectedLogin) return res.redirect(`${clientUrl}/?events_error=expected_${expectedLogin}&events_actual=${encodeURIComponent(twitchUser.login.toLowerCase())}`);
      stage = "database_save";
      await saveEventAuth({ channel, twitchUserId: twitchUser.id, displayName: twitchUser.display_name,
        accessToken: token.accessToken, refreshToken: token.refreshToken,
        expiresAt: Date.now() + token.expiresIn * 1000, scopes: token.scopes });
      if (channel !== CHATBOT_AUTH_KEY) {
        stage = "eventsub_registration";
        await registerEventSubscriptions({ channel, twitchUserId: twitchUser.id, displayName: twitchUser.display_name,
          accessToken: token.accessToken, refreshToken: token.refreshToken,
          expiresAt: Date.now() + token.expiresIn * 1000, scopes: token.scopes });
      }
      res.redirect(`${clientUrl}/?${channel === CHATBOT_AUTH_KEY ? "chatbot_connected" : "events_connected"}=${encodeURIComponent(expectedLogin)}`);
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
    const botAuth = await getEventAuth(CHATBOT_AUTH_KEY);
    res.json({
      configured: eventDatabaseConfigured(),
      channels: values,
      chatbot: { login: chatbotLogin, connected: !!botAuth, displayName: botAuth?.displayName, scopes: botAuth?.scopes ?? [] },
    });
  });
  router.delete("/events/chatbot", async (req, res) => {
    if (!getUserFromRequest(req)?.isOwner) return res.status(403).json({ error: "Only the overlay owner can disconnect the chatbot" });
    await deleteEventAuth(CHATBOT_AUTH_KEY); res.status(204).end();
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
    if (!["follow", "subscribe", "gift-subscribe", "raid", "bits", "channel-points", "ban", "timeout"].includes(type)) return res.status(400).json({ error: "Unsupported event" });
    emitEvent(type, {
      message: { text: "Test event" }, channel, broadcaster_user_login: channel,
      user_name: "Test Viewer", from_broadcaster_user_name: "Test Raider",
      simulated: true, bits: type === "bits" ? 100 : undefined,
      viewers: type === "raid" ? 25 : undefined,
      cumulative_months: type === "subscribe" ? 12 : undefined,
      duration_months: type === "subscribe" ? 1 : undefined,
      total: type === "gift-subscribe" ? 5 : undefined,
      reward: type === "channel-points" ? { title: "Test reward" } : undefined,
      moderator_user_name: type === "ban" || type === "timeout" ? "Test Moderator" : undefined,
      reason: type === "ban" || type === "timeout" ? "Test moderation reason" : undefined,
      is_permanent: type === "ban" ? true : type === "timeout" ? false : undefined,
      banned_at: type === "ban" || type === "timeout" ? new Date().toISOString() : undefined,
      ends_at: type === "timeout" ? new Date(Date.now() + 10 * 60_000).toISOString() : undefined,
    });
    res.json({ ok: true });
  });
  return router;
}

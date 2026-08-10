import { Router } from "express";
import { randomUUID } from "crypto";
import {
  getTwitchAuthUrl,
  exchangeCode,
  getTwitchUserFromToken,
  getTwitchChatColor,
  isStreamerLive,
} from "./twitch.js";
import { isWhitelisted, getWhitelistEntry } from "../db/index.js";
import { signToken, verifyToken } from "./jwt.js";

const OWNER = (process.env.OWNER_TWITCH_USERNAME ?? "").toLowerCase();
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";
const SESSION_SECRET = process.env.SESSION_SECRET ?? "change-me-in-production";

export const authRouter = Router();

const STATE_COOKIE = "oauth_state";
const IS_PROD = process.env.NODE_ENV === "production";

function getUserFromRequest(req: any): any {
  const auth = req.headers?.authorization as string | undefined;
  if (auth?.startsWith("Bearer ")) {
    try {
      return verifyToken(auth.slice(7), SESSION_SECRET);
    } catch {}
  }
  return req.session?.user ?? null;
}

export { getUserFromRequest };

authRouter.get("/twitch", (req, res) => {
  const state = randomUUID();
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    maxAge: 5 * 60 * 1000,
  });
  res.redirect(getTwitchAuthUrl(state));
});

authRouter.get("/callback", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;
  const cookieHeader = req.headers.cookie ?? "";
  const storedState = cookieHeader
    .split(";")
    .map((c: string) => c.trim())
    .find((c: string) => c.startsWith(STATE_COOKIE + "="))
    ?.split("=")[1];
  res.clearCookie(STATE_COOKIE);

  if (error) {
    res.redirect(`${CLIENT_URL}/login?error=twitch_denied`);
    return;
  }
  if (!state || !storedState || state !== storedState) {
    res.redirect(`${CLIENT_URL}/login?error=invalid_state`);
    return;
  }

  try {
    const accessToken = await exchangeCode(code);
    const twitchUser = await getTwitchUserFromToken(accessToken);
    const login = twitchUser.login.toLowerCase();

    if (login !== OWNER && !isWhitelisted(login)) {
      res.redirect(`${CLIENT_URL}/login?error=not_whitelisted`);
      return;
    }

    const color = await getTwitchChatColor(twitchUser.id, accessToken);
    const whitelistEntry = login !== OWNER ? getWhitelistEntry(login) : null;

    const user = {
      id: twitchUser.id,
      login,
      displayName: twitchUser.display_name,
      avatar: twitchUser.profile_image_url,
      color,
      isOwner: login === OWNER,
      isAdmin: login === OWNER || (whitelistEntry?.isAdmin ?? false),
    };

    const token = signToken(user, SESSION_SECRET);
    res.redirect(`${CLIENT_URL}/?token=${token}`);
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.redirect(`${CLIENT_URL}/login?error=server_error`);
  }
});

authRouter.get("/me", (req, res) => {
  const user = getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json(user);
});

authRouter.get("/refresh", (req, res) => {
  const user = getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  // Re-check admin status from whitelist
  if (!user.isOwner) {
    const entry = getWhitelistEntry(user.login);
    user.isAdmin = entry?.isAdmin ?? false;
  }
  res.json(user);
});

authRouter.post("/logout", (req, res) => {
  req.session?.destroy(() => {});
  res.sendStatus(200);
});

authRouter.get("/live", async (req, res) => {
  try {
    const live = await isStreamerLive("vicksy");
    res.json({ live });
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

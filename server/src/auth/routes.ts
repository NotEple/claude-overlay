import { Router, type Request } from "express";
import { randomUUID } from "crypto";
import {
  getTwitchAuthUrl,
  exchangeCode,
  getTwitchUserFromToken,
  getTwitchChatColor,
  isStreamerLive,
} from "./twitch.js";
import { getWhitelistEntry } from "../db/index.js";
import { signToken, verifyToken } from "./jwt.js";

const OWNER = (process.env.OWNER_TWITCH_USERNAME ?? "vicksy").toLowerCase();
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";
const IS_PROD = process.env.NODE_ENV === "production";
if (IS_PROD && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required in production");
}
const SESSION_SECRET = process.env.SESSION_SECRET ?? "development-only-secret";

export const authRouter = Router();

const STATE_COOKIE = "oauth_state";
export interface AuthUser {
  id: string;
  login: string;
  displayName: string;
  avatar: string;
  color: string;
  isOwner: boolean;
  isAdmin: boolean;
}

function authorizeTokenUser(tokenUser: any): AuthUser | null {
  if (!tokenUser || typeof tokenUser.login !== "string") return null;
  const login = tokenUser.login.toLowerCase();
  const isOwner = login === OWNER;
  const whitelistEntry = isOwner ? null : getWhitelistEntry(login);
  if (!isOwner && !whitelistEntry) return null;

  return {
    id: String(tokenUser.id ?? ""),
    login,
    displayName: String(tokenUser.displayName ?? login),
    avatar: String(tokenUser.avatar ?? ""),
    color: String(tokenUser.color ?? "#9146FF"),
    isOwner,
    isAdmin: isOwner || (whitelistEntry?.isAdmin ?? false),
  };
}

export function getUserFromToken(token: string): AuthUser | null {
  try {
    return authorizeTokenUser(verifyToken(token, SESSION_SECRET));
  } catch {
    return null;
  }
}

function getUserFromRequest(req: Request): AuthUser | null {
  const auth = req.headers?.authorization as string | undefined;
  if (auth?.startsWith("Bearer ")) {
    return getUserFromToken(auth.slice(7));
  }
  return null;
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
    const tokenSet = await exchangeCode(code);
    const accessToken = tokenSet.accessToken;
    const twitchUser = await getTwitchUserFromToken(accessToken);
    const login = twitchUser.login.toLowerCase();

    if (login !== OWNER && !getWhitelistEntry(login)) {
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
  res.json(user);
});

authRouter.post("/logout", (_req, res) => {
  res.sendStatus(200);
});

authRouter.get("/live", async (req, res) => {
  try {
    const requestedChannel = String(req.query.channel ?? "vicksy").toLowerCase();
    const channel = requestedChannel === "wixels" ? "wixels" : "vicksy";
    const live = await isStreamerLive(channel);
    res.json({ live });
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

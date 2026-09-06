const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID!;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET!;
const SERVER_URL = (
  process.env.PUBLIC_SERVER_URL ??
  process.env.RENDER_EXTERNAL_URL ??
  "http://localhost:3001"
).replace(/\/$/, "");
const TWITCH_REDIRECT_URI =
  process.env.TWITCH_REDIRECT_URI || `${SERVER_URL}/auth/callback`;
export const twitchEventsRedirectUri =
  process.env.TWITCH_EVENTS_REDIRECT_URI ||
  `${SERVER_URL}/auth/events/callback`;

export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
}

export interface TwitchChatColor {
  user_id: string;
  user_login: string;
  color: string; // hex string like "#FF0000", empty string if not set
}

export function getTwitchAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    redirect_uri: TWITCH_REDIRECT_URI,
    response_type: "code",
    // Dashboard login only; chat commands use a separate anonymous listener.
    scope: "user:read:email user:read:chat",
    state,
  });
  return `https://id.twitch.tv/oauth2/authorize?${params}`;
}

export function getTwitchEventsAuthUrl(state: string, scopes: string[]): string {
  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    redirect_uri: twitchEventsRedirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    state,
    force_verify: "true",
  });
  return `https://id.twitch.tv/oauth2/authorize?${params}`;
}

export interface TwitchTokenSet { accessToken: string; refreshToken: string; expiresIn: number; scopes: string[]; }
export async function exchangeCode(code: string): Promise<TwitchTokenSet> {
  return exchangeCodeForRedirect(code, TWITCH_REDIRECT_URI);
}

export async function exchangeCodeForRedirect(code: string, redirectUri: string): Promise<TwitchTokenSet> {
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Twitch token exchange failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number; scope?: string[] };
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in, scopes: data.scope ?? [] };
}

export async function refreshUserToken(refreshToken: string): Promise<TwitchTokenSet> {
  const res = await fetch("https://id.twitch.tv/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: TWITCH_CLIENT_ID, client_secret: TWITCH_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: refreshToken }) });
  if (!res.ok) throw new Error("Failed to refresh Twitch token");
  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number; scope?: string[] };
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in, scopes: data.scope ?? [] };
}

export const twitchClientId = TWITCH_CLIENT_ID;

export async function getTwitchUserFromToken(
  accessToken: string,
): Promise<TwitchUser> {
  const res = await fetch("https://api.twitch.tv/helix/users", {
    headers: {
      "Client-Id": TWITCH_CLIENT_ID,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) throw new Error("Failed to fetch Twitch user");
  const data = (await res.json()) as { data: TwitchUser[] };
  if (!data.data[0]) throw new Error("No Twitch user returned");
  return data.data[0];
}

// Fetch the user's Twitch chat color (requires user:read:chat scope)
export async function getTwitchChatColor(
  userId: string,
  accessToken: string,
): Promise<string> {
  const fallbackColor = "#9146FF";

  const res = await fetch(
    `https://api.twitch.tv/helix/chat/color?user_id=${userId}`,
    {
      headers: {
        "Client-Id": TWITCH_CLIENT_ID,
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  if (!res.ok) return fallbackColor; // fallback to Twitch purple
  const data = (await res.json()) as { data: TwitchChatColor[] };
  const color = data.data[0]?.color;
  // If user hasn't set a color, Twitch returns empty string — use purple
  return color || fallbackColor;
}

// ---------------------------------------------------------------------------
// App access token (for looking up usernames — no user needed)
// ---------------------------------------------------------------------------
let appAccessToken: string | null = null;
let appTokenExpiry = 0;

export async function getAppAccessToken(): Promise<string> {
  if (appAccessToken && Date.now() < appTokenExpiry) return appAccessToken;
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error("Failed to get Twitch app access token");
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  appAccessToken = data.access_token;
  appTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return appAccessToken;
}

export async function lookupTwitchUser(
  username: string,
): Promise<TwitchUser | null> {
  const token = await getAppAccessToken();
  const res = await fetch(
    `https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`,
    {
      headers: {
        "Client-Id": TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (!res.ok) throw new Error("Twitch API error");
  const data = (await res.json()) as { data: TwitchUser[] };
  return data.data[0] ?? null;
}

export async function isStreamerLive(username: string) {
  const token = await getAppAccessToken();

  const response = await fetch(
    `https://api.twitch.tv/helix/streams?user_login=${username}`,
    {
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID!,
        Authorization: `Bearer ${token}`,
      },
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message ?? "Twitch API error");
  }

  return data.data.length > 0;
}

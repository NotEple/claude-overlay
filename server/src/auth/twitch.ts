const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID!;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET!;
const TWITCH_REDIRECT_URI = process.env.TWITCH_REDIRECT_URI!;

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
    response_type: 'code',
    scope: 'user:read:email user:read:chat',
    state,
  });
  return `https://id.twitch.tv/oauth2/authorize?${params}`;
}

export async function exchangeCode(code: string): Promise<string> {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: TWITCH_REDIRECT_URI,
    }),
  });
  if (!res.ok) throw new Error('Failed to exchange Twitch code for token');
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

export async function getTwitchUserFromToken(accessToken: string): Promise<TwitchUser> {
  const res = await fetch('https://api.twitch.tv/helix/users', {
    headers: {
      'Client-Id': TWITCH_CLIENT_ID,
      'Authorization': `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) throw new Error('Failed to fetch Twitch user');
  const data = await res.json() as { data: TwitchUser[] };
  if (!data.data[0]) throw new Error('No Twitch user returned');
  return data.data[0];
}

// Fetch the user's Twitch chat color (requires user:read:chat scope)
export async function getTwitchChatColor(userId: string, accessToken: string): Promise<string> {
  const res = await fetch(
    `https://api.twitch.tv/helix/chat/color?user_id=${userId}`,
    {
      headers: {
        'Client-Id': TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`,
      },
    }
  );
  if (!res.ok) return '#9146FF'; // fallback to Twitch purple
  const data = await res.json() as { data: TwitchChatColor[] };
  const color = data.data[0]?.color;
  // If user hasn't set a color, Twitch returns empty string — use purple
  return color || '#9146FF';
}

// ---------------------------------------------------------------------------
// App access token (for looking up usernames — no user needed)
// ---------------------------------------------------------------------------
let appAccessToken: string | null = null;
let appTokenExpiry = 0;

async function getAppAccessToken(): Promise<string> {
  if (appAccessToken && Date.now() < appTokenExpiry) return appAccessToken;
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) throw new Error('Failed to get Twitch app access token');
  const data = await res.json() as { access_token: string; expires_in: number };
  appAccessToken = data.access_token;
  appTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return appAccessToken;
}

export async function lookupTwitchUser(username: string): Promise<TwitchUser | null> {
  const token = await getAppAccessToken();
  const res = await fetch(
    `https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`,
    {
      headers: {
        'Client-Id': TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${token}`,
      },
    }
  );
  if (!res.ok) throw new Error('Twitch API error');
  const data = await res.json() as { data: TwitchUser[] };
  return data.data[0] ?? null;
}

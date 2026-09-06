interface SevenTvEmote {
  id?: string;
  name?: string;
  flags?: number | { zero_width?: boolean; zeroWidth?: boolean };
  data?: {
    id?: string;
    name?: string;
    flags?: number | { default_zero_width?: boolean; defaultZeroWidth?: boolean };
  };
}

interface SevenTvUserResponse {
  emote_set?: { emotes?: SevenTvEmote[] };
}

export interface ResolvedSevenTvEmote {
  id: string;
  name: string;
  imageUrl: string;
  isZeroWidth: boolean;
}

interface CachedEmoteSet {
  expiresAt: number;
  emotes: Map<string, ResolvedSevenTvEmote>;
}

const CACHE_MS = 5 * 60 * 1000;
const caches = new Map<string, CachedEmoteSet>();
const pendingLoads = new Map<string, Promise<Map<string, ResolvedSevenTvEmote>>>();

async function loadEmoteSet(twitchUserId: string) {
  const cached = caches.get(twitchUserId);
  if (cached && cached.expiresAt > Date.now()) return cached.emotes;

  const pending = pendingLoads.get(twitchUserId);
  if (pending) return pending;

  const request = (async () => {
    const response = await fetch(`https://7tv.io/v3/users/twitch/${encodeURIComponent(twitchUserId)}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`7TV returned ${response.status}`);
    const data = (await response.json()) as SevenTvUserResponse;
    const emotes = new Map<string, ResolvedSevenTvEmote>();
    for (const entry of data.emote_set?.emotes ?? []) {
      const id = entry.id ?? entry.data?.id;
      const name = entry.name ?? entry.data?.name;
      if (!id || !name) continue;
      emotes.set(name, {
        id,
        name,
        imageUrl: `https://cdn.7tv.app/emote/${encodeURIComponent(id)}/2x.webp`,
        // V3 has represented this on both the active set entry and emote data
        // across API generations. Supporting both keeps cached channel sets
        // compatible while 7TV rolls out its newer schema.
        isZeroWidth:
          (typeof entry.flags === "number" && (entry.flags & 1) !== 0) ||
          (typeof entry.data?.flags === "number" && (entry.data.flags & 256) !== 0) ||
          (typeof entry.flags === "object" && !!(entry.flags.zero_width ?? entry.flags.zeroWidth)) ||
          (typeof entry.data?.flags === "object" && !!(entry.data.flags.default_zero_width ?? entry.data.flags.defaultZeroWidth)),
      });
    }
    caches.set(twitchUserId, { expiresAt: Date.now() + CACHE_MS, emotes });
    return emotes;
  })()
    .catch((error) => {
      caches.set(twitchUserId, {
        expiresAt: Date.now() + 60_000,
        emotes: new Map(),
      });
      throw error;
    })
    .finally(() => pendingLoads.delete(twitchUserId));

  pendingLoads.set(twitchUserId, request);
  return request;
}

export async function resolveSevenTvEmotes(twitchUserId: string, message: string) {
  if (!twitchUserId) return [];
  try {
    const emoteSet = await loadEmoteSet(twitchUserId);
    const matches: ResolvedSevenTvEmote[] = [];
    for (const token of message.split(/\s+/)) {
      const emote = emoteSet.get(token);
      if (!emote) continue;
      matches.push(emote);
      if (matches.length >= 20) break;
    }
    return matches;
  } catch (error) {
    console.error("Could not load the 7TV emote set:", error);
    return [];
  }
}

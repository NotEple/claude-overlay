import * as tmi from 'tmi.js';
import type { TriggerEventType } from '../types.js';
import type { ChatPermission } from '../types.js';

type ChatCommandEvent = {
  channel?: string;
  message: { text: string };
  reward?: { title?: string };
  bits?: number;
  chatter_user_id?: string;
  chatter_user_login?: string;
  chatter_user_name?: string;
  chatter_color?: string;
  room_id?: string;
  native_emotes?: Array<{ id: string; name: string; imageUrl: string; position: number }>;
  chatter_role?: ChatPermission;
};
type EventHandler = (type: TriggerEventType, event: ChatCommandEvent) => void;

let channel = 'vicksy';
const allowedChannels = new Set(['vicksy', 'wixels']);

let handler: EventHandler | null = null;
let statusHandler: ((connected: boolean) => void) | null = null;
let client: tmi.Client | null = null;

export function emitTwitchEvent(type: TriggerEventType, event: ChatCommandEvent) {
  handler?.(type, event);
}

/**
 * Connects to public Twitch chat anonymously. This listener can read public
 * messages and run commands, but cannot send messages or access private events.
 */
export function configureTwitchEvents(onEvent: EventHandler, onStatus: (connected: boolean) => void) {
  handler = onEvent;
  statusHandler = onStatus;
  restartTwitchEvents();
}

export function restartTwitchEvents() {
  const previous = client;
  client = null;
  statusHandler?.(false);
  if (previous) void previous.disconnect().catch(() => undefined);

  const current = new tmi.Client({
    connection: { secure: true, reconnect: true },
    channels: [channel],
  });
  client = current;

  current.on('connected', () => {
    if (client === current) statusHandler?.(true);
  });
  current.on('disconnected', () => {
    if (client === current) statusHandler?.(false);
  });
  current.on('message', (joinedChannel, tags, message, self) => {
    if (client !== current || self || joinedChannel.replace(/^#/, '').toLowerCase() !== channel) return;
    const badges = tags.badges ?? {};
    const login = String(tags.username ?? '').toLowerCase();
    const chatterRole: ChatPermission = badges.broadcaster || login === channel
      ? 'streamer'
      : tags.mod || badges.moderator
        ? 'moderator'
        : badges.vip
          ? 'vip'
          : 'everyone';
    const nativeEmotes: Array<{ id: string; name: string; imageUrl: string; position: number }> = [];
    for (const [id, ranges] of Object.entries(tags.emotes ?? {})) {
      for (const range of ranges ?? []) {
        const [start, end] = range.split('-').map(Number);
        if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
        nativeEmotes.push({
          id,
          name: message.slice(start, end + 1),
          imageUrl: `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark/2.0`,
          position: start,
        });
      }
    }
    nativeEmotes.sort((a, b) => a.position - b.position);
    emitTwitchEvent('chat-command', {
      channel,
      message: { text: message },
      chatter_user_id: tags['user-id'],
      chatter_user_login: tags.username,
      chatter_user_name: tags['display-name'],
      chatter_color: tags.color,
      room_id: tags['room-id'],
      native_emotes: nativeEmotes,
      chatter_role: chatterRole,
    });
  });

  void current.connect().catch((error: unknown) => {
    if (client !== current) return;
    statusHandler?.(false);
    console.error(`Could not connect anonymously to Twitch chat #${channel}:`, error);
  });
}

export function getTwitchChatChannel() {
  return channel;
}

export async function setTwitchChatChannel(value: string): Promise<boolean> {
  const nextChannel = value.trim().replace(/^#/, '').toLowerCase();
  if (!allowedChannels.has(nextChannel)) return false;
  if (nextChannel === channel) return true;

  const current = client;
  if (!current) {
    channel = nextChannel;
    restartTwitchEvents();
    return true;
  }

  try {
    await current.join(nextChannel);
    const previousChannel = channel;
    channel = nextChannel;
    await current.part(previousChannel).catch(() => undefined);
    return true;
  } catch (error) {
    console.error(`Could not switch Twitch chat from #${channel} to #${nextChannel}:`, error);
    return false;
  }
}

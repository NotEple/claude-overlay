import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { mkdirSync } from 'fs';
import path from 'path';
import type { ChatEmoteSettings, ElementPreset, OverlayTrigger, SavedScene, SoundboardItem } from '../types.js';

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
mkdirSync(DATA_DIR, { recursive: true });

interface WhitelistEntry {
  username: string;
  added_by: string;
  added_at: string;
  isAdmin: boolean;
}

interface DbSchema {
  whitelist: WhitelistEntry[];
  scenes: SavedScene[];
  presets: ElementPreset[];
  sounds: SoundboardItem[];
  triggers: OverlayTrigger[];
  chatEmoteSettings?: ChatEmoteSettings;
  twitchAuth?: { encryptedAccessToken: string; encryptedRefreshToken: string; expiresAt: number; userId: string };
}

const adapter = new JSONFile<DbSchema>(path.join(DATA_DIR, 'db.json'));
const db = new Low<DbSchema>(adapter, { whitelist: [], scenes: [], presets: [], sounds: [], triggers: [] });
await db.read();
db.data.scenes ??= [];
db.data.presets ??= [];
db.data.sounds ??= [];
db.data.triggers ??= [];

export function getWhitelist(): WhitelistEntry[] {
  return db.data.whitelist;
}

export function isWhitelisted(username: string): boolean {
  return db.data.whitelist.some((e) => e.username.toLowerCase() === username.toLowerCase());
}

export function getWhitelistEntry(username: string): WhitelistEntry | undefined {
  return db.data.whitelist.find((e) => e.username.toLowerCase() === username.toLowerCase());
}

export async function addToWhitelist(username: string, addedBy: string): Promise<void> {
  if (isWhitelisted(username)) return;
  db.data.whitelist.push({ username: username.toLowerCase(), added_by: addedBy, added_at: new Date().toISOString(), isAdmin: false });
  await db.write();
}

export async function setAdmin(username: string, isAdmin: boolean): Promise<void> {
  const entry = db.data.whitelist.find((e) => e.username.toLowerCase() === username.toLowerCase());
  if (entry) { entry.isAdmin = isAdmin; await db.write(); }
}

export async function removeFromWhitelist(username: string): Promise<void> {
  db.data.whitelist = db.data.whitelist.filter((e) => e.username.toLowerCase() !== username.toLowerCase());
  await db.write();
}

export function getStudioData() {
  return { scenes: db.data.scenes, presets: db.data.presets, sounds: db.data.sounds, triggers: db.data.triggers };
}

export function getChatEmoteSettings(): ChatEmoteSettings | undefined {
  return db.data.chatEmoteSettings;
}

export async function saveChatEmoteSettings(settings: ChatEmoteSettings): Promise<void> {
  db.data.chatEmoteSettings = settings;
  await db.write();
}

export async function saveStudioData(data: Partial<ReturnType<typeof getStudioData>>): Promise<void> {
  if (data.scenes) db.data.scenes = data.scenes;
  if (data.presets) db.data.presets = data.presets;
  if (data.sounds) db.data.sounds = data.sounds;
  if (data.triggers) db.data.triggers = data.triggers;
  await db.write();
}

export function getStoredTwitchAuth() { return db.data.twitchAuth; }
export async function setStoredTwitchAuth(value: DbSchema['twitchAuth']): Promise<void> {
  db.data.twitchAuth = value;
  await db.write();
}

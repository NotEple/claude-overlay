import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { mkdirSync } from 'fs';
import path from 'path';
import type { ChatEmoteSettings, ElementPreset, OverlayTrigger, SavedScene, SoundboardItem } from '../types.js';
import { Pool } from 'pg';

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
db.data.whitelist ??= [];
db.data.scenes ??= [];
db.data.presets ??= [];
db.data.sounds ??= [];
db.data.triggers ??= [];

const postgresUrl = process.env.DATABASE_URL?.replace(
  /([?&])sslmode=(?:prefer|require|verify-ca)(?=&|$)/i,
  "$1sslmode=verify-full",
);
const postgres = postgresUrl
  ? new Pool({ connectionString: postgresUrl, max: 3 })
  : null;
let whitelistCache: WhitelistEntry[] = [...db.data.whitelist];

export async function initializeWhitelistStore(): Promise<void> {
  if (!postgres) return;
  await postgres.query(`CREATE TABLE IF NOT EXISTS dashboard_whitelist (
    username TEXT PRIMARY KEY,
    added_by TEXT NOT NULL,
    added_at TIMESTAMPTZ NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE
  )`);
  for (const entry of db.data.whitelist) {
    await postgres.query(`INSERT INTO dashboard_whitelist (username, added_by, added_at, is_admin)
      VALUES ($1,$2,$3,$4) ON CONFLICT (username) DO NOTHING`,
      [entry.username.toLowerCase(), entry.added_by, entry.added_at, entry.isAdmin]);
  }
  const result = await postgres.query('SELECT username, added_by, added_at, is_admin FROM dashboard_whitelist ORDER BY added_at');
  whitelistCache = result.rows.map((row) => ({
    username: row.username,
    added_by: row.added_by,
    added_at: new Date(row.added_at).toISOString(),
    isAdmin: row.is_admin,
  }));
  console.log(`Loaded ${whitelistCache.length} dashboard whitelist entries from Postgres`);
}

export function getWhitelist(): WhitelistEntry[] {
  return whitelistCache;
}

export function isWhitelisted(username: string): boolean {
  return whitelistCache.some((e) => e.username.toLowerCase() === username.toLowerCase());
}

export function getWhitelistEntry(username: string): WhitelistEntry | undefined {
  return whitelistCache.find((e) => e.username.toLowerCase() === username.toLowerCase());
}

export async function addToWhitelist(username: string, addedBy: string): Promise<void> {
  if (isWhitelisted(username)) return;
  const entry = { username: username.toLowerCase(), added_by: addedBy, added_at: new Date().toISOString(), isAdmin: false };
  if (postgres) await postgres.query('INSERT INTO dashboard_whitelist (username, added_by, added_at, is_admin) VALUES ($1,$2,$3,$4) ON CONFLICT (username) DO NOTHING', [entry.username, entry.added_by, entry.added_at, false]);
  whitelistCache.push(entry);
  if (!postgres) { db.data.whitelist = whitelistCache; await db.write(); }
}

export async function setAdmin(username: string, isAdmin: boolean): Promise<void> {
  const entry = whitelistCache.find((e) => e.username.toLowerCase() === username.toLowerCase());
  if (entry) {
    if (postgres) await postgres.query('UPDATE dashboard_whitelist SET is_admin=$2 WHERE username=$1', [entry.username, isAdmin]);
    entry.isAdmin = isAdmin;
    if (!postgres) { db.data.whitelist = whitelistCache; await db.write(); }
  }
}

export async function removeFromWhitelist(username: string): Promise<void> {
  if (postgres) await postgres.query('DELETE FROM dashboard_whitelist WHERE username=$1', [username.toLowerCase()]);
  whitelistCache = whitelistCache.filter((e) => e.username.toLowerCase() !== username.toLowerCase());
  if (!postgres) { db.data.whitelist = whitelistCache; await db.write(); }
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

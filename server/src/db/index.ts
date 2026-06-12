import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { mkdirSync } from 'fs';
import path from 'path';

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
}

const adapter = new JSONFile<DbSchema>(path.join(DATA_DIR, 'db.json'));
const db = new Low<DbSchema>(adapter, { whitelist: [] });
await db.read();

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

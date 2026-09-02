import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { Pool } from "pg";
import { refreshUserToken } from "../auth/twitch.js";

export type EventChannel = string;
export interface StoredEventAuth {
  channel: EventChannel;
  twitchUserId: string;
  displayName: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}

const databaseUrl = process.env.DATABASE_URL?.replace(
  /([?&])sslmode=(?:prefer|require|verify-ca)(?=&|$)/i,
  "$1sslmode=verify-full",
);
const encryptionValue = process.env.TWITCH_TOKEN_ENCRYPTION_KEY;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 3 }) : null;

function key() {
  if (!encryptionValue) throw new Error("TWITCH_TOKEN_ENCRYPTION_KEY is not configured");
  const decoded = Buffer.from(encryptionValue, "base64");
  if (decoded.length !== 32) throw new Error("TWITCH_TOKEN_ENCRYPTION_KEY must be a Base64 encoded 32-byte key");
  return decoded;
}
function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${ciphertext.toString("base64")}`;
}
function decrypt(value: string) {
  const [iv, tag, ciphertext] = value.split(".").map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export async function initializeEventAuthStore() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS twitch_event_auth (
    channel TEXT PRIMARY KEY,
    twitch_user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    encrypted_access_token TEXT NOT NULL,
    encrypted_refresh_token TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    scopes JSONB NOT NULL DEFAULT '[]',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  // Older development builds restricted this table to Vicksy/Wixels. Event
  // authorization targets are now configuration-driven so a test account can
  // be connected without changing any preview or overlay channel behavior.
  await pool.query("ALTER TABLE twitch_event_auth DROP CONSTRAINT IF EXISTS twitch_event_auth_channel_check");
}

export async function saveEventAuth(value: StoredEventAuth) {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  await pool.query(`INSERT INTO twitch_event_auth
    (channel,twitch_user_id,display_name,encrypted_access_token,encrypted_refresh_token,expires_at,scopes,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
    ON CONFLICT (channel) DO UPDATE SET twitch_user_id=EXCLUDED.twitch_user_id,
    display_name=EXCLUDED.display_name, encrypted_access_token=EXCLUDED.encrypted_access_token,
    encrypted_refresh_token=EXCLUDED.encrypted_refresh_token, expires_at=EXCLUDED.expires_at,
    scopes=EXCLUDED.scopes, updated_at=NOW()`, [value.channel, value.twitchUserId,
    value.displayName, encrypt(value.accessToken), encrypt(value.refreshToken), value.expiresAt,
    JSON.stringify(value.scopes)]);
}
export async function getEventAuth(channel: EventChannel): Promise<StoredEventAuth | null> {
  if (!pool) return null;
  const result = await pool.query("SELECT * FROM twitch_event_auth WHERE channel=$1", [channel]);
  const row = result.rows[0];
  if (!row) return null;
  return { channel, twitchUserId: row.twitch_user_id, displayName: row.display_name,
    accessToken: decrypt(row.encrypted_access_token), refreshToken: decrypt(row.encrypted_refresh_token),
    expiresAt: Number(row.expires_at), scopes: row.scopes };
}
export async function getValidEventAuth(channel: EventChannel): Promise<StoredEventAuth | null> {
  const auth = await getEventAuth(channel);
  if (!auth || auth.expiresAt > Date.now() + 5 * 60_000) return auth;
  const refreshed = await refreshUserToken(auth.refreshToken);
  const next: StoredEventAuth = {
    ...auth,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken || auth.refreshToken,
    expiresAt: Date.now() + refreshed.expiresIn * 1000,
    scopes: refreshed.scopes.length ? refreshed.scopes : auth.scopes,
  };
  await saveEventAuth(next);
  return next;
}
export async function deleteEventAuth(channel: EventChannel) {
  if (pool) await pool.query("DELETE FROM twitch_event_auth WHERE channel=$1", [channel]);
}
export function eventDatabaseConfigured() { return !!pool && !!encryptionValue; }

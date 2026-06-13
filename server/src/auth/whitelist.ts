import { Router } from 'express';
import type { Server } from 'socket.io';
import { getWhitelist, addToWhitelist, removeFromWhitelist, setAdmin } from '../db/index.js';
import { lookupTwitchUser } from '../auth/twitch.js';
import { requireAdmin, requireOwner } from '../middleware/auth.js';
import type { ServerToClientEvents, ClientToServerEvents, UserPresencePayload } from '../types.js';

export const whitelistRouter = Router();

// List + add + remove: admin-level (owner OR isAdmin user)
whitelistRouter.get('/', requireAdmin, (_req, res) => res.json(getWhitelist()));

whitelistRouter.post('/', requireAdmin, async (req, res) => {
  const { username } = req.body as { username?: string };
  if (!username || typeof username !== 'string') { res.status(400).json({ error: 'Username is required' }); return; }
  const clean = username.trim().toLowerCase();
  let twitchUser;
  try { twitchUser = await lookupTwitchUser(clean); }
  catch { res.status(502).json({ error: 'Could not reach Twitch API' }); return; }
  if (!twitchUser) { res.status(404).json({ error: `Twitch account "${clean}" does not exist` }); return; }
  await addToWhitelist(twitchUser.login, (req as any).authUser?.login ?? req.session.user!.login);
  res.json({ username: twitchUser.login, displayName: twitchUser.display_name, avatar: twitchUser.profile_image_url });
});

// Toggle admin — owner only
whitelistRouter.patch('/:username/admin', requireOwner, async (req, res) => {
  const username = req.params.username.toLowerCase();
  const { isAdmin } = req.body as { isAdmin: boolean };
  await setAdmin(username, isAdmin);

  // Notify the affected user in real-time if they're connected
  const io = (req as any).io as Server<ClientToServerEvents, ServerToClientEvents>;
  const activeUsers = (req as any).activeUsers as Map<string, UserPresencePayload & { socketId: string }>;
  for (const [socketId, user] of activeUsers.entries()) {
    if (user.login.toLowerCase() === username) {
      io.to(socketId).emit('session:role_updated');
    }
  }

  res.sendStatus(200);
});

whitelistRouter.delete('/:username', requireAdmin, async (req, res) => {
  const username = req.params.username.toLowerCase();
  await removeFromWhitelist(username);
  const io = (req as any).io as Server<ClientToServerEvents, ServerToClientEvents>;
  const activeUsers = (req as any).activeUsers as Map<string, UserPresencePayload & { socketId: string }>;
  for (const [socketId, user] of activeUsers.entries()) {
    if (user.login.toLowerCase() === username) {
      io.to(socketId).emit('session:revoked');
      setTimeout(() => io.sockets.sockets.get(socketId)?.disconnect(true), 500);
    }
  }
  res.sendStatus(200);
});

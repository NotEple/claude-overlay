import { Router } from 'express';
import type { Server } from 'socket.io';
import { getWhitelist, addToWhitelist, removeFromWhitelist, setAdmin } from '../db/index.js';
import { lookupTwitchUser } from '../auth/twitch.js';
import { requireAdmin, requireOwner } from '../middleware/auth.js';
import type { ServerToClientEvents, ClientToServerEvents, UserPresencePayload } from '../types.js';

type WhitelistServer = Server<ClientToServerEvents, ServerToClientEvents>;
type ConnectedUser = UserPresencePayload & { socketId: string };

/** Create whitelist routes with their realtime dependencies explicitly injected. */
export function createWhitelistRouter(
  io: WhitelistServer,
  activeUsers: Map<string, ConnectedUser>,
) {
  const router = Router();

  // List, add, and remove are admin-level operations. Only the owner can grant
  // or revoke admin privileges.
  router.get('/', requireAdmin, (_req, res) => res.json(getWhitelist()));

  router.post('/', requireAdmin, async (req, res) => {
    const { username } = req.body as { username?: unknown };
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,25}$/.test(username.trim())) {
      res.status(400).json({ error: 'Enter a valid Twitch username' });
      return;
    }
    const clean = username.trim().toLowerCase();
    let twitchUser;
    try {
      twitchUser = await lookupTwitchUser(clean);
    } catch {
      res.status(502).json({ error: 'Could not reach Twitch API' });
      return;
    }
    if (!twitchUser) {
      res.status(404).json({ error: `Twitch account "${clean}" does not exist` });
      return;
    }
    try {
      await addToWhitelist(twitchUser.login, req.authUser!.login);
    } catch {
      res.status(503).json({ error: 'Dashboard access storage is unavailable' });
      return;
    }
    res.json({
      username: twitchUser.login,
      displayName: twitchUser.display_name,
      avatar: twitchUser.profile_image_url,
    });
  });

  // Admin grants are deliberately owner-only.
  router.patch('/:username/admin', requireOwner, async (req, res) => {
    const username = req.params.username.toLowerCase();
    const { isAdmin } = req.body as { isAdmin?: unknown };
    if (typeof isAdmin !== 'boolean') {
      res.status(400).json({ error: 'isAdmin must be a boolean' });
      return;
    }
    try {
      await setAdmin(username, isAdmin);
    } catch {
      res.status(503).json({ error: 'Dashboard access storage is unavailable' });
      return;
    }

    // Notify the affected user in real-time if they're connected.
    for (const [socketId, user] of activeUsers.entries()) {
      if (user.login.toLowerCase() === username) {
        io.to(socketId).emit('session:role_updated');
      }
    }

    res.sendStatus(200);
  });

  router.delete('/:username', requireAdmin, async (req, res) => {
    const username = req.params.username.toLowerCase();
    if (username === req.authUser!.login.toLowerCase()) {
      res.status(400).json({ error: 'You cannot remove your own dashboard access' });
      return;
    }
    try {
      await removeFromWhitelist(username);
    } catch {
      res.status(503).json({ error: 'Dashboard access storage is unavailable' });
      return;
    }
    for (const [socketId, user] of activeUsers.entries()) {
      if (user.login.toLowerCase() === username) {
        io.to(socketId).emit('session:revoked');
        setTimeout(() => io.sockets.sockets.get(socketId)?.disconnect(true), 500);
      }
    }
    res.sendStatus(200);
  });

  return router;
}

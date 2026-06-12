import { Router } from 'express';
import { randomUUID } from 'crypto';
import {
  getTwitchAuthUrl,
  exchangeCode,
  getTwitchUserFromToken,
  getTwitchChatColor,
} from './twitch.js';
import { isWhitelisted, getWhitelistEntry } from '../db/index.js';

const OWNER = (process.env.OWNER_TWITCH_USERNAME ?? '').toLowerCase();
const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:5173';

export const authRouter = Router();

const STATE_COOKIE = 'oauth_state';
const IS_PROD = process.env.NODE_ENV === 'production';

authRouter.get('/twitch', (req, res) => {
  const state = randomUUID();
  // Store state in a direct cookie — avoids session file-store issues across redirects
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    maxAge: 5 * 60 * 1000,
  });
  res.redirect(getTwitchAuthUrl(state));
});

authRouter.get('/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;
  const cookieHeader = req.headers.cookie ?? '';
  const storedState = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith(STATE_COOKIE + '='))?.split('=')[1];
  res.clearCookie(STATE_COOKIE);

  if (error) { res.redirect(`${CLIENT_URL}/login?error=twitch_denied`); return; }
  if (!state || !storedState || state !== storedState) {
    res.redirect(`${CLIENT_URL}/login?error=invalid_state`); return;
  }

  try {
    const accessToken = await exchangeCode(code);
    const twitchUser = await getTwitchUserFromToken(accessToken);
    const login = twitchUser.login.toLowerCase();

    if (login !== OWNER && !isWhitelisted(login)) {
      res.redirect(`${CLIENT_URL}/login?error=not_whitelisted`); return;
    }

    // Fetch their Twitch chat color
    const color = await getTwitchChatColor(twitchUser.id, accessToken);

    const whitelistEntry = login !== OWNER ? getWhitelistEntry(login) : null;
    req.session.user = {
      id: twitchUser.id,
      login,
      displayName: twitchUser.display_name,
      avatar: twitchUser.profile_image_url,
      color,
      isOwner: login === OWNER,
      isAdmin: login === OWNER || (whitelistEntry?.isAdmin ?? false),
    };

    req.session.save((err) => {
      if (err) console.error('Session save error:', err);
      res.redirect(`${CLIENT_URL}/`);
    });
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(`${CLIENT_URL}/login?error=server_error`);
  }
});

authRouter.get('/me', (req, res) => {
  if (!req.session.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
  res.json(req.session.user);
});

authRouter.get('/refresh', (req, res) => {
  if (!req.session.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
  const { login, isOwner } = req.session.user;
  if (!isOwner) {
    const entry = getWhitelistEntry(login);
    req.session.user.isAdmin = entry?.isAdmin ?? false;
  }
  req.session.save(() => res.json(req.session.user));
});

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.sendStatus(200);
  });
});

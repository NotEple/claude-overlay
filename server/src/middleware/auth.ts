import type { Request, Response, NextFunction } from 'express';
import { getUserFromRequest } from '../auth/routes.js';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = getUserFromRequest(req);
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return; }
  (req as any).authUser = user;
  next();
}

export function requireOwner(req: Request, res: Response, next: NextFunction) {
  const user = getUserFromRequest(req);
  if (!user?.isOwner) { res.status(403).json({ error: 'Owner only' }); return; }
  next();
}

// Admin = owner OR whitelisted user with isAdmin flag
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = getUserFromRequest(req);
  if (!user?.isAdmin) { res.status(403).json({ error: 'Admin only' }); return; }
  next();
}

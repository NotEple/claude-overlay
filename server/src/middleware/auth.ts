import type { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
  next();
}

export function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (!req.session.user?.isOwner) { res.status(403).json({ error: 'Owner only' }); return; }
  next();
}

// Admin = owner OR whitelisted user with isAdmin flag
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.user?.isAdmin) { res.status(403).json({ error: 'Admin only' }); return; }
  next();
}

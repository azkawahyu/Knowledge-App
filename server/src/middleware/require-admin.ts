// requireAdmin (PLAN §B3.6, §B-D10b — R-B1).
//
// Defined by F3-B, mounted by F3-C only (`routes/audit.ts`). It must run
// AFTER `authMiddleware`, which is what sets `req.user`.

import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  // Today every authenticated caller IS an admin (admins has no role column),
  // so the only thing this can catch is a mount that skipped authentication.
  // §B-D10b: 403 {"error":"Forbidden"} is the ONLY status for this branch —
  // it supersedes round 1's 401 mandate and must not drift.
  const user = (req as AuthRequest).user;
  if (!user) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  // This seam exists so a future role column has one place to be enforced
  // (FU-C1). NB §B-D10a: `req.user.id` is `undefined` at runtime — an
  // identity check written against it would 403 a real, authenticated admin.
  next();
}

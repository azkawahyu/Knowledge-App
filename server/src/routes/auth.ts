import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db';
import { hashPassword, verifyPassword } from '../utils/hash';
import { config } from '../config';
import { recordAudit } from '../audit/log';
import { sanitizeActor, sanitizeResource } from '../audit/sanitize';

const router = Router();

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      res.status(400).json({ error: 'username and password are required' });
      return;
    }

    const result = await pool.query(
      'SELECT id, password_hash FROM admins WHERE username = $1',
      [username]
    );
    const row = result.rows[0];
    if (!row || !(await verifyPassword(String(password), row.password_hash))) {
      // `username` is req.body.username — attacker-controlled, pre-auth. It is
      // NEVER stringified raw: sanitizeActor caps it at 64 and strips controls.
      const attempted = sanitizeActor(username);
      // §B-D10a / R4-B/1: `actor` is the literal `null` here, NOT
      // `req.user?.username ?? null` — this route is mounted without
      // authMiddleware (app.ts:51), so `req.user` is absent by construction
      // and MUST NOT be referenced on this path at all. The candidate lives
      // only in `resource` and `detail.attempted`.
      void recordAudit({
        action: 'auth.login.failure',
        actor: null,
        resource: sanitizeResource(`admin:${attempted ?? 'unknown'}`),
        detail: {
          outcome: 'failure',
          reason: 'invalid_credentials',
          attempted: attempted ?? undefined,
          // Computed AFTER the password check failed: the SELECT at :17-21 has
          // already run, so `row` present ⇔ the username matched an admin row.
          user_known: row !== undefined,
        },
      });
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign({ sub: row.id, username }, config.JWT_SECRET, { expiresIn: '12h' });
    const attempted = sanitizeActor(username);
    void recordAudit({
      action: 'auth.login.success',
      // §B-D10a: the identity is the VERIFIED username. The SELECT at :18 is
      // `SELECT id, password_hash` — it does NOT return `username`, so the
      // proven identities are `row.id` and the `username` this request
      // matched. `row.username` would be `undefined` → sanitizeActor → null,
      // and would blank the actor column. NOT req.body.username raw (it is
      // attacker-controlled), NOT req.user.id (undefined), NOT req.user?.sub.
      actor: attempted,
      resource: sanitizeResource(`admin:${attempted ?? 'unknown'}`),
      detail: { outcome: 'success', attempted: attempted ?? undefined },
    });
    res.json({ token, user: { id: row.id, username } });
  } catch (err) {
    console.error('[auth] /login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

export { router as authRouter };

import { Router, Request, Response } from 'express';
import { pool } from '../db';

const router = Router();

router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(`
      SELECT actor, action, resource, detail, created_at
      FROM audit_log
      ORDER BY created_at DESC
      LIMIT 200
    `);
    res.json({ rows: result.rows });
  } catch (err) {
    console.error('[audit] GET error:', err);
    res.status(500).json({ error: 'Failed to load audit log' });
  }
});

export { router as auditRouter };

import { Pool } from 'pg';
import { config } from '../config';
import { initSchema } from './schema';
import { hashPassword } from '../utils/hash';

export const pool = new Pool({ connectionString: config.DATABASE_URL });

export async function initDb(): Promise<void> {
  if (!config.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }
  await pool.query('SELECT 1');
  await initSchema(pool);
  await ensureDefaultAdmin(pool);
  console.log('[db] connected to PostgreSQL and schema initialized');
}

export async function closeDb(): Promise<void> {
  await pool.end();
}

async function ensureDefaultAdmin(p: Pool): Promise<void> {
  const res = await p.query(
    'SELECT id FROM admins WHERE username = $1',
    [config.ADMIN_USERNAME]
  );
  if (res.rows.length === 0) {
    const hash = await hashPassword(config.ADMIN_PASSWORD || 'admin123');
    await p.query(
      'INSERT INTO admins (username, password_hash) VALUES ($1, $2)',
      [config.ADMIN_USERNAME, hash]
    );
    console.log('[db] default admin created (admin / admin123)');
  }
}

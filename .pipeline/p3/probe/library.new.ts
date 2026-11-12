import { Router, Request, Response } from 'express';
import { pool } from '../db';

const router = Router();

// ---- Pagination constants (PLAN §A3.2, A-D6) ----------------------------
// `limit` follows the `search.ts` clamp idiom: out-of-range values are
// clamped silently, never 400. `25` fills one viewport; `100` is the ceiling
// and matches what the Library page previously asked `/api/search` for.
const DEFAULT_LIMIT = 25;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

// ---- Cursor codec (PLAN §A3.2, A-D5) -----------------------------------
// Opaque to the client: base64url of { v: 1, t: <ISO8601>, i: <uuid> }.
// It carries the (created_at, id) total order so the next page is exactly
// "the rows strictly after the last row of this page" — the reason the cursor
// exists is ordering stability, not client policing.
type Cursor = { t: string; i: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseCursor(raw: unknown): Cursor | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null; // undecodable -> treat as absent (page 1), never 400
  }
  if (typeof decoded !== 'object' || decoded === null) return null;
  const { v, t, i } = decoded as { v?: unknown; t?: unknown; i?: unknown };
  if (v !== 1) return null;
  if (typeof t !== 'string' || Number.isNaN(Date.parse(t))) return null;
  if (typeof i !== 'string' || !UUID_RE.test(i)) return null;
  return { t, i };
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify({ v: 1, t: c.t, i: c.i }), 'utf8').toString('base64url');
}

/** A-SQL-1 (PLAN §A3.5). $1 = limit, $2 = cursor_ts (NULL on page 1), $3 = cursor_id. */
const PAGE_SQL = `
      SELECT d.id,
             d.name,
             d.kind,
             d.size_bytes::int AS size_bytes,
             d.sha256,
             d.status,
             d.access_policy,
             d.metadata,
             d.created_at,
             d.updated_at,
             COUNT(c.id)::int AS chunk_count
      FROM public.documents d
      LEFT JOIN public.chunks c ON c.document_id = d.id
      WHERE ($2::timestamptz IS NULL
             OR (d.created_at, d.id) < ($2::timestamptz, $3::uuid))
      GROUP BY d.id, d.name, d.kind, d.size_bytes, d.sha256, d.status,
               d.access_policy, d.metadata, d.created_at, d.updated_at
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT $1 + 1`;

/** A-SQL-2 (PLAN §A3.5). Counts every document, independent of limit/cursor. */
const TOTAL_SQL = 'SELECT COUNT(*)::int AS total FROM public.documents';

type Row = {
  id: string;
  name: string;
  kind: string;
  size_bytes: unknown;
  sha256: string;
  status: string;
  access_policy: string;
  metadata: unknown;
  created_at: Date | string;
  updated_at: Date | string;
  chunk_count: number;
};

/**
 * Serialise one row. `source_path` is deliberately absent (A-D7 / LA-1) and
 * `size_bytes` is normalised to a JSON number or null (R-A4): the column is
 * `bigint`, so without the ::int cast the `pg` driver would emit a string.
 */
function toWire(r: Row) {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    size_bytes: typeof r.size_bytes === 'number' ? r.size_bytes : null,
    sha256: r.sha256,
    status: r.status,
    access_policy: r.access_policy,
    metadata: r.metadata,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
    chunk_count: r.chunk_count,
  };
}

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    // limit: floor, then clamp — never 400 (A3.2). A non-numeric value falls
    // back to the default rather than NaN.
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, Math.floor(rawLimit)))
      : DEFAULT_LIMIT;

    const cursor = parseCursor(req.query.cursor);

    const [page, totalResult] = await Promise.all([
      pool.query<Row>(PAGE_SQL, [limit, cursor ? cursor.t : null, cursor ? cursor.i : null]),
      pool.query<{ total: number }>(TOTAL_SQL),
    ]);

    // R-A3: LIMIT $1 + 1. The extra row is the "is there another page" probe
    // and is dropped BEFORE serialising; the cursor is emitted only when it
    // was present, so a page that is exactly `limit` long does not advertise
    // a next page that does not exist.
    const rows = page.rows;
    let nextCursor: string | null = null;
    if (rows.length > limit) {
      rows.pop();
      const last = rows[rows.length - 1];
      nextCursor = encodeCursor({
        t: last.created_at instanceof Date ? last.created_at.toISOString() : String(last.created_at),
        i: last.id,
      });
    }

    res.json({
      results: rows.map(toWire),
      total: totalResult.rows[0]?.total ?? 0,
      limit,
      next_cursor: nextCursor,
    });
  } catch (err) {
    console.error('[library] GET error:', err);
    res.status(500).json({ error: 'Failed to load library' });
  }
});

export { router as libraryRouter };

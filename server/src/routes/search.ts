import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { QueryResult } from 'pg';
import { recordAudit } from '../audit/log';
import { AuthRequest } from '../middleware/auth';
import { buildBroadSearchQuery } from '../utils/search-query';

interface SearchRow {
  document_id: string;
  document_name: string;
  document_policy: string;
  chunk_id: string;
  text: string;
  page_no: number | null;
  start_char: number | null;
  end_char: number | null;
}

const router = Router();

interface SearchBody {
  q: string;
  limit?: number;
  policy?: string;
}

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { q, limit = 10, policy = '*' } = req.body as SearchBody;

    // ONE guard. Non-string / missing / blank q -> 400.
    // Message is today's message, verbatim (search.ts:28) — no new contract string.
    // Whitespace-only is now caught too (today "   " passes !q and yields 0 rows).
    if (typeof q !== 'string' || !q.trim()) {
      res.status(400).json({ error: 'q (query string) is required' });
      return;
    }
    // NO lexeme-less guard here. A non-blank but lexeme-less q ("the and or",
    // "!!!", "-") deliberately falls through to the SQL: the empty tsquery
    // matches nothing, so the caller gets 200 { results: [] } — the honest
    // answer, and NOT the whole library. See PLAN §A2.4.
    const limitN = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));

    const broadQuery = buildBroadSearchQuery(q);

    const result: QueryResult<SearchRow> = await pool.query<SearchRow>({
      text: `
        WITH query_terms AS (
          SELECT websearch_to_tsquery('english', $2) AS en,
                 websearch_to_tsquery('simple', $2) AS simple_all,
                 CASE WHEN $4 = '' THEN NULL::tsquery
                      ELSE websearch_to_tsquery('simple', $4) END AS simple_any
        )
        SELECT d.id AS document_id,
               d.name AS document_name,
               d.access_policy AS document_policy,
               c.id AS chunk_id,
               c.text,
               c.page_no,
               c.start_char,
               c.end_char
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        CROSS JOIN query_terms q
        WHERE (d.access_policy = $1 OR $1 = '*')
          AND (
            to_tsvector('english', c.text) @@ q.en
            OR to_tsvector('simple', c.text) @@ q.simple_all
            OR (q.simple_any IS NOT NULL AND to_tsvector('simple', c.text) @@ q.simple_any)
          )
        ORDER BY GREATEST(
                   ts_rank(to_tsvector('english', c.text), q.en),
                   ts_rank(to_tsvector('simple', c.text), q.simple_all),
                   CASE WHEN q.simple_any IS NULL THEN 0
                        ELSE ts_rank(to_tsvector('simple', c.text), q.simple_any) END
                 ) DESC,
                 d.id ASC,
                 c.start_char ASC NULLS LAST,
                 c.id ASC
        LIMIT $3
      `,
      values: [policy, q, limitN, broadQuery],
    });

    const results = result.rows.map((r: SearchRow) => ({
      document_id: r.document_id,
      document_name: r.document_name,
      document_policy: r.document_policy,
      chunk_id: r.chunk_id,
      text: r.text,
      page_no: r.page_no,
      start_char: r.start_char,
      end_char: r.end_char,
    }));

    // §B3.4: audited after the query resolves and only on success. A 400
    // (blank q, above) is not a query; a 500 (catch below) emits nothing —
    // "search failures are invisible in the audit log" is FU-B6.
    // `resource` is `search:<policy>`: policy is a closed-set validated
    // literal ('*', public, trusted, restricted), never free text.
    void recordAudit({
      action: 'search.query',
      actor: req.user?.username ?? null,
      resource: `search:${policy}`,
      detail: { outcome: 'success', q, limit: limitN, returned: results.length },
    });

    res.json({ query: q, limit: results.length, results });
  } catch (err) {
    console.error('[search] / POST error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

export { router as searchRouter };

-- probe_r2_c4_fixture.sql — REVIEWER round-2 check of the C4 fixture against C's contract.
-- Temp table only; transaction ROLLED BACK; no product data touched.
BEGIN;

CREATE TEMP TABLE a (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                     actor text, action text NOT NULL, resource text,
                     detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL);

-- the 13 rows exactly as the plan's fixture lists them (tests 1-13)
INSERT INTO a (actor, action, resource, detail, created_at) VALUES
 (NULL,      'auth.login.failure',    'admin:p3c-invalid',   '{"outcome":"failure"}', '2026-11-02T10:00:00Z'),
 ('admin',   'auth.login.success',    'admin:admin',         '{"outcome":"success"}', '2026-11-02T10:00:00Z'),
 ('admin',   'search.query',          'search:*',            '{"outcome":"success"}', '2026-11-02T10:00:00Z'),
 ('admin',   'ingest.upload.success', 'p3c-document:aaaa',   '{"outcome":"success"}', '2026-11-02T09:00:00Z'),
 ('p3c-user','ingest.upload.failure', 'p3c-upload:bad.docx', '{"outcome":"failure"}', '2026-11-02T11:00:00Z'),
 ('p3c-user','search.query',          'search:public',       '{"outcome":"success"}', '2026-11-02T12:00:00Z'),
 ('admin',   'ingest.upload.success', 'p3c-document:bbbb',   '{"outcome":"success"}', '2026-11-02T13:00:00Z'),
 ('admin',   'search.query',          'search:trusted',      '{"outcome":"success"}', '2026-11-02T08:00:00Z'),
 ('p3c-user','auth.login.success',    'admin:p3c-user',      '{"outcome":"success"}', '2026-11-02T07:00:00Z'),
 ('admin',   'ingest.upload.failure', 'p3c-upload:x.pdf',    '{"outcome":"failure"}', '2026-11-02T06:00:00Z'),
 ('p3c-user','ingest.upload.success', 'p3c-document:cccc',   '{"outcome":"success"}', '2026-11-02T05:00:00Z'),
 ('admin',   'auth.login.failure',    'admin:p3c-other',     '{"outcome":"failure"}', '2026-11-02T04:00:00Z'),
 ('admin',   'ingest.upload.success', 'p3c-document:bbbb',   '{"outcome":"success"}', '2026-11-02T14:00:00Z');

\echo '=== P1a: ?resource=p3c-document:bbbb&limit=1 — how many rows does a FILTERED page see AFTER the popped probe row? ==='
-- 2 rows match the filter (14:00 and 13:00). SQL fetches LIMIT 1+1 = 2 -> rows.length(2) > lim(1) -> hasMore=true,
-- rows.pop() removes the 13:00 row, so the page returns ONLY the 14:00 row with a next_cursor.
SELECT id, created_at, detail->>'name' AS name, detail->>'chunk_count' AS chunk_count
  FROM a WHERE resource = 'p3c-document:bbbb' ORDER BY created_at DESC, id DESC LIMIT 1 + 1;

\echo '=== P1b: T-C6 expects chunk_count === 1 and name === b.txt on rows[0] (the 14:00 row) ==='
SELECT detail->>'name' AS name, (detail->>'chunk_count')::int AS chunk_count
  FROM a WHERE resource='p3c-document:bbbb' ORDER BY created_at DESC, id DESC LIMIT 1;

\echo '=== P2: keyset continuation ACROSS a filtered tie — tie mates at 10:00 under ?actor=admin, limit=1 ==='
-- page1 (actor=admin, limit 1): fetch 2, pop 1 => the surviving row is the 2nd in (created_at DESC, id DESC)
SELECT id, created_at FROM a WHERE actor='admin' ORDER BY created_at DESC, id DESC LIMIT 1 + 1;

\echo '=== P3: T-C3 = 13 rows / limit 2 => requests to reach terminal ==='
SELECT ceil(13.0/2) AS ceil_13_2, (13/2) AS floor_13_2;

\echo '=== P4: T-C5 inclusive to=12:30 — row at 12:00 included? row at 13:00 excluded? ==='
SELECT count(*) AS rows_1030_to_1230 FROM a
 WHERE created_at >= '2026-11-02T10:30:00Z' AND created_at <= '2026-11-02T12:30:00Z';

\echo '=== P5: T-C5 exact-bound from=to=11:00 — inclusive on both ends => 1 row ==='
SELECT count(*) AS rows_exact_1100 FROM a
 WHERE created_at >= '2026-11-02T11:00:00Z' AND created_at <= '2026-11-02T11:00:00Z';

ROLLBACK;

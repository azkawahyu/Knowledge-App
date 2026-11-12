-- probe_r2_verify3.sql — keyset continuation, isolated so no prior ERROR aborts it.
BEGIN;
CREATE TEMP TABLE t_rows (id uuid primary key, created_at timestamptz);

\echo '--- P5: 3 rows at 10:00:00Z (the C4 tie), 1 row at 09:00 ---'
INSERT INTO t_rows SELECT gen_random_uuid(), '2026-11-02T10:00:00Z'::timestamptz FROM generate_series(1,3);
INSERT INTO t_rows SELECT gen_random_uuid(), '2026-11-02T09:00:00Z'::timestamptz;

\echo '--- P5a: LIMIT 2+1 probe for page 1 (3 fetched, last is the probe row) ---'
SELECT id, created_at FROM t_rows ORDER BY created_at DESC, id DESC LIMIT 2 + 1;

-- capture the last SURVIVING row (rn = 2) as the cursor, exactly as the route does in JS
SELECT q.id::text AS cur_id, q.created_at::text AS cur_ts
  FROM (SELECT id, created_at, row_number() OVER (ORDER BY created_at DESC, id DESC) rn FROM t_rows) q
 WHERE q.rn = 2 \gset

\echo '--- P6: page 2 from that cursor (expect the 3rd tie row, then the 09:00 row) ---'
SELECT id, created_at FROM t_rows
 WHERE (created_at, id) < (:'cur_ts'::timestamptz, :'cur_id'::uuid)
 ORDER BY created_at DESC, id DESC LIMIT 2 + 1;

\echo '--- P7: union pages 1+2 = 4 rows, 4 distinct, 0 dup ---'
WITH p1 AS (SELECT id FROM (SELECT id, row_number() OVER (ORDER BY created_at DESC, id DESC) rn FROM t_rows) z WHERE rn <= 2),
     p2 AS (SELECT id FROM t_rows WHERE (created_at, id) < (:'cur_ts'::timestamptz, :'cur_id'::uuid) LIMIT 2)
SELECT (SELECT count(*) FROM p1)+(SELECT count(*) FROM p2) AS page_rows,
       (SELECT count(*) FROM (SELECT id FROM p1 UNION SELECT id FROM p2) u) AS distinct_rows;
ROLLBACK;

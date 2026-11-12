-- probe_r2_verify2.sql — REVIEWER round-2 verification, part 2.
-- Same discipline: txn rolled back, temp tables only. No product data touched.
BEGIN;

\echo '--- P4: bigint::int overflow on 2147483648 (expect ERROR: integer out of range) ---'
SELECT 2147483648::bigint::int AS overflow_would_throw;

\echo '--- P5: tie-break + keyset continuation, uuid ordering via ORDER BY id DESC (no max(uuid)) ---'
CREATE TEMP TABLE t_rows (id uuid primary key, created_at timestamptz);
INSERT INTO t_rows
  SELECT gen_random_uuid(), '2026-11-02T10:00:00Z'::timestamptz FROM generate_series(1,3);
INSERT INTO t_rows
  SELECT gen_random_uuid(), '2026-11-02T09:00:00Z'::timestamptz;

-- page 1 with LIMIT 2 (+1 probe => 3 rows fetched, 1 popped)
SELECT id, created_at FROM t_rows ORDER BY created_at DESC, id DESC LIMIT 2 + 1;

-- the last SURVIVING row of page 1 (row 2 of the ordered set) becomes the cursor
WITH ordered AS (
  SELECT id, created_at, row_number() OVER (ORDER BY created_at DESC, id DESC) AS rn FROM t_rows
)
SELECT id AS cursor_id, created_at AS cursor_ts FROM ordered WHERE rn = 2 \gset

\echo '--- P6: page 2 using that cursor must return exactly the remaining tie row, no gap/dup ---'
SELECT id, created_at FROM t_rows
 WHERE (created_at, id) < (:'cursor_ts'::timestamptz, :'cursor_id'::uuid)
 ORDER BY created_at DESC, id DESC
 LIMIT 2 + 1;

\echo '--- P7: union of pages 1+2 sizes must be 4 with 0 duplicates ---'
WITH ordered AS (
  SELECT id, created_at, row_number() OVER (ORDER BY created_at DESC, id DESC) AS rn FROM t_rows
),
p1 AS (SELECT id FROM ordered WHERE rn <= 2),
p2 AS (SELECT id FROM t_rows WHERE (created_at, id) < (:'cursor_ts'::timestamptz, :'cursor_id'::uuid) LIMIT 2)
SELECT (SELECT count(*) FROM p1)+(SELECT count(*) FROM p2) AS total_rows,
       (SELECT count(*) FROM (SELECT id FROM p1 UNION SELECT id FROM p2) u) AS distinct_rows;

ROLLBACK;

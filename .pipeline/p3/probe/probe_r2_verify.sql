-- probe_r2_verify.sql — REVIEWER round-2 read-only verification.
-- Runs entirely inside a transaction that is ROLLED BACK; touches only TEMP tables.
-- Purpose: independently confirm three plan claims, not to test product data.
BEGIN;
SET LOCAL transaction_read_only = off;   -- read-write txn, but ONLY temp tables touched

CREATE TEMP TABLE t_docs (id uuid primary key, name text, size_bytes bigint, created_at timestamptz);
INSERT INTO t_docs VALUES
 (gen_random_uuid(),'d-zero', 0,'2026-11-02T10:00:00Z'),
 (gen_random_uuid(),'d-one',  1,'2026-11-02T10:00:00Z'),
 (gen_random_uuid(),'d-three',3,'2026-11-02T11:00:00Z');

\echo '--- P1: ::int preserves value and yields integer type ---'
SELECT name, size_bytes, size_bytes::int AS as_int, pg_typeof(size_bytes::int) FROM t_docs ORDER BY name;

\echo '--- P2: tie-break ORDER BY created_at DESC, id DESC ---'
SELECT name FROM t_docs WHERE created_at='2026-11-02T10:00:00Z' ORDER BY created_at DESC, id DESC;

\echo '--- P3: keyset predicate after (last-of-page1 id, tie ts) => 0 remaining in tie ---'
SELECT count(*) AS remaining_in_tie FROM t_docs
 WHERE (created_at, id) < ('2026-11-02T10:00:00Z'::timestamptz,
        (SELECT max(id) FROM t_docs WHERE created_at='2026-11-02T10:00:00Z'));

\echo '--- P4: does bigint::int overflow throw? (expect ERROR) ---'
SELECT 2147483648::bigint::int AS overflow_would_throw;

ROLLBACK;

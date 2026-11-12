-- READ-ONLY probes for the Phase-3 plan. No DDL, no DML against any table.
-- psql session variables (used for set_config keys when there is no type context).
\if :{?actor}
\else
\set actor 'plan-probe'
\endif
\set action 'plan-probe'

\echo '--- P1: audit_log columns/types ---'
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='audit_log'
ORDER BY ordinal_position;

\echo '--- P2: audit_log indexes ---'
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename='audit_log';

\echo '--- P3: documents columns ---'
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='documents'
ORDER BY ordinal_position;

\echo '--- P4: server defaults (affects the timestamptz cast path) ---'
SELECT current_setting('TimeZone') AS tz, current_setting('DateStyle') AS datestyle,
       current_setting('server_version') AS server_version;

\echo '--- P5: candidate keyset statement, literals instead of settings (empty table) ---'
SELECT id, actor, action, resource, detail, created_at
FROM public.audit_log
WHERE ('plan-probe'::text IS NULL OR actor = 'plan-probe'::text)
  AND ('plan-probe'::text IS NULL OR action = 'plan-probe'::text)
  AND (2020-01-01::text IS NULL OR created_at >= '2020-01-01T00:00:00.000Z'::timestamptz)
  AND (2030-01-01::text IS NULL OR created_at <= '2030-01-01T00:00:00.000Z'::timestamptz)
  AND ('00000000-0000-0000-0000-000000000000'::text IS NULL
       OR (created_at, id) < ('2030-01-01T00:00:00.000Z'::timestamptz, NULL::uuid))
ORDER BY created_at DESC, id DESC
LIMIT 51 OFFSET 0;

\echo '--- P6: row < row comparison with a NULL element (semantics check) ---'
SELECT (now(), NULL::uuid) < (now(), gen_random_uuid()) AS rowcmp_null_right,
       (now(), '00000000-0000-0000-0000-000000000001'::uuid) < (now(), '00000000-0000-0000-0000-000000000002'::uuid) AS rowcmp_lt;

\echo '--- P7: does a bound param in a boolean context skip an invalid cast? (pg_typeof only) ---'
SELECT pg_typeof(NULL::timestamptz) AS null_ts,
       pg_typeof(('2020-01-01'::text)::timestamptz) AS text_ts;

\echo '--- P8: baseline counts (read-only) ---'
SELECT (SELECT count(*) FROM public.documents) AS documents,
       (SELECT count(*) FROM public.chunks)    AS chunks,
       (SELECT count(*) FROM public.audit_log) AS audit_log,
       (SELECT count(*) FROM public.admins)    AS admins;

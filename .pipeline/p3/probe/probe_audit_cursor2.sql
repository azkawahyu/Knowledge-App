-- READ-ONLY. TEMP table only. Keyset paging + tie-sensitive ordering + LIKE-escape probe.
CREATE TEMP TABLE probe_audit (LIKE public.audit_log INCLUDING DEFAULTS);
-- Four rows sharing the SAME created_at: created_at alone is not a total order.
INSERT INTO probe_audit (id, actor, action, resource, detail, created_at) VALUES
  ('00000000-0000-0000-0000-00000000000a','plan-probe','search.query','doc:a','{}','2026-11-02 10:00:00+00'),
  ('00000000-0000-0000-0000-00000000000b','plan-probe','search.query','doc:b','{}','2026-11-02 10:00:00+00'),
  ('00000000-0000-0000-0000-00000000000c','plan-probe','search.query','doc:c','{}','2026-11-02 10:00:00+00'),
  ('00000000-0000-0000-0000-00000000000d','plan-probe','search.query','doc:d','{}','2026-11-02 10:00:00+00'),
  ('00000000-0000-0000-0000-00000000000e','pct%user', 'search.query','doc:e','{}','2026-11-02 09:00:00+00');

PREPARE act_keyset (text, text, text, timestamptz, timestamptz, uuid, timestamptz, int) AS
  SELECT id, resource, created_at
  FROM probe_audit
  WHERE ($1::text IS NULL OR actor = $1)
    AND ($2::text IS NULL OR action = $2)
    AND ($3::text IS NULL OR resource = $3)
    AND ($4::timestamptz IS NULL OR created_at >= $4)
    AND ($5::timestamptz IS NULL OR created_at <= $5)
    AND ($6::uuid IS NULL OR (created_at, id) < ($7::timestamptz, $6::uuid))
  ORDER BY created_at DESC, id DESC
  LIMIT $8 OFFSET 0;

\echo '--- P13: page 1 (limit 2) of the 4 identical-timestamp rows ---'
EXECUTE act_keyset(NULL,'search.query',NULL,NULL,NULL,NULL,NULL,2);
\echo '--- P14: keyset continuation from cursor (created_at, id) of row ..000c ---'
EXECUTE act_keyset(NULL,'search.query',NULL,NULL,NULL,'00000000-0000-0000-0000-00000000000c'::uuid,'2026-11-02 10:00:00+00'::timestamptz,2);

\echo '--- P15: LIKE-escape probe: actor containing % (ILIKE vs escaped LIKE, same 2 rows) ---'
SELECT count(*) FILTER (WHERE actor ILIKE '%' || 'pct%user' || '%')       AS ilike_hits,
       count(*) FILTER (WHERE actor ILIKE '%' || 'pct\%user' || '%')     AS ilike_escaped_hits
FROM (VALUES ('pct%user'),('pctXuser'),('pctX%Xuser')) v(actor);

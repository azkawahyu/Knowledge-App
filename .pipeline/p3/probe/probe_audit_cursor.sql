-- READ-ONLY probes: does a *bound parameter* survive an unexecuted cast when it is NULL?
-- Session-local temp table only (vanishes at disconnect); NEVER public.audit_log.
CREATE TEMP TABLE probe_audit (LIKE public.audit_log INCLUDING DEFAULTS) ON COMMIT PRESERVE ROWS;

\echo '--- P11: temp table created; inserting 6 probe rows into the TEMP table only ---'
INSERT INTO probe_audit (actor, action, resource, detail, created_at) VALUES
  ('plan-probe','search.query','doc:a', '{"outcome":"success"}', now() - interval '5 min'),
  ('plan-probe','search.query','doc:b', '{"outcome":"success"}', now() - interval '4 min'),
  ('plan-probe','ingest.upload.success','doc:c', '{"outcome":"success"}', now() - interval '3 min'),
  ('plan-probe','ingest.upload.failure','doc:d', '{"outcome":"failure"}', now() - interval '2 min'),
  ('other-user','auth.login.success', NULL, '{"outcome":"success"}', now() - interval '1 min'),
  ('plan-probe','search.query','doc:e', '{"outcome":"success"}', now());

\echo '--- P12: PREPARE with $1..$8; NULL cursor params (the pg-node shape) ---'
PREPARE act_page (text, text, text, timestamptz, timestamptz, uuid, timestamptz, int) AS
  SELECT id, action, created_at
  FROM probe_audit
  WHERE ($1::text IS NULL OR actor = $1)
    AND ($2::text IS NULL OR action = $2)
    AND ($3::text IS NULL OR resource = $3)
    AND ($4::timestamptz IS NULL OR created_at >= $4)
    AND ($5::timestamptz IS NULL OR created_at <= $5)
    AND ($6::uuid IS NULL OR (created_at, id) < ($7::timestamptz, $6::uuid))
  ORDER BY created_at DESC, id DESC
  LIMIT $8 OFFSET 0;

\echo 'P12a: no filters at all (all 6 rows, newest first)'
EXECUTE act_page(NULL, NULL, NULL, NULL, NULL, NULL, NULL, 50);

\echo 'P12b: action filter only'
EXECUTE act_page(NULL, 'search.query', NULL, NULL, NULL, NULL, NULL, 50);

\echo 'P12c: actor + action'
EXECUTE act_page('plan-probe', 'search.query', NULL, NULL, NULL, NULL, NULL, 50);

\echo 'P12d: from/to only'
EXECUTE act_page(NULL, NULL, NULL, (now() - interval '4 min')::timestamptz,
                 (now() - interval '1 min')::timestamptz, NULL, NULL, 50);

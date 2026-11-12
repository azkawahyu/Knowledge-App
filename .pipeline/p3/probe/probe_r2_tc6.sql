-- probe_r2_tc6.sql — T-C6 detail-content check with jsonb access done correctly.
BEGIN;
CREATE TEMP TABLE a (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor text, action text NOT NULL,
                     resource text, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL);
INSERT INTO a (actor, action, resource, detail, created_at) VALUES
 ('admin', 'ingest.upload.success', 'p3c-document:bbbb',
  '{"outcome":"success","name":"b.txt","chunk_count":1}', '2026-11-02T13:00:00Z'),
 ('admin', 'ingest.upload.success', 'p3c-document:bbbb',
  '{"outcome":"success","name":"b.txt","chunk_count":1,"password":"L3AK_PASSWORD_SENTINEL_9f2a","token":"L3AK_TOKEN_SENTINEL_4c7d","blob":{"nested":"L3AK_NESTED_SENTINEL_1e5b"}}',
  '2026-11-02T14:00:00Z');

\echo '--- P6: rows[0] under ?resource=p3c-document:bbbb&limit=1 (the 14:00 poison row) ---'
SELECT detail->>'name' AS name, (detail->>'chunk_count')::int AS chunk_count, detail->>'outcome' AS outcome
  FROM a WHERE resource='p3c-document:bbbb' ORDER BY created_at DESC, id DESC LIMIT 1;

\echo '--- P7: every T-C6 sentinel IS present in the raw stored detail (pre-fix route returns it verbatim) ---'
SELECT detail::text LIKE '%L3AK_PASSWORD_SENTINEL_9f2a%' AS has_password_sentinel,
       detail::text LIKE '%L3AK_TOKEN_SENTINEL_4c7d%'    AS has_token_sentinel,
       detail::text LIKE '%L3AK_NESTED_SENTINEL_1e5b%'   AS has_nested_sentinel
  FROM a ORDER BY created_at DESC LIMIT 1;

\echo '--- P8: the bbbb tie pair (14:00, 13:00) => limit=1 fetches 2, hasMore=true, page returns exactly 1 ---'
SELECT count(*) AS matching_rows FROM a WHERE resource='p3c-document:bbbb';
ROLLBACK;

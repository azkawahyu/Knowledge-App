-- READ-ONLY probe: does the CURRENT query (no @@ predicate) return rows for a
-- nonsense query when chunks exist?  Uses a TEMP TABLE (session-local, vanishes
-- on disconnect) so NOTHING is written to public/f1test.
SET search_path = public;

CREATE TEMP TABLE p2_probe_docs (LIKE documents INCLUDING DEFAULTS) ON COMMIT PRESERVE ROWS;
CREATE TEMP TABLE p2_probe_chunks (LIKE chunks INCLUDING DEFAULTS) ON COMMIT PRESERVE ROWS;

INSERT INTO p2_probe_docs (id, name, kind, sha256, access_policy)
VALUES ('00000000-0000-0000-0000-00000000f2a1', 'p2-probe-a', 'txt', repeat('a',64), 'public'),
       ('00000000-0000-0000-0000-00000000f2a2', 'p2-probe-b', 'txt', repeat('b',64), 'restricted');

INSERT INTO p2_probe_chunks (document_id, text, page_no) VALUES
  ('00000000-0000-0000-0000-00000000f2a1', 'The N2N escalation procedure requires a pager alert within five minutes.', 1),
  ('00000000-0000-0000-0000-00000000f2a1', 'Backup rotation runs nightly at 03:00 UTC on the vault host.', 2),
  ('00000000-0000-0000-0000-00000000f2a2', 'Restricted salary bands for grade 7 staff are reviewed annually.', 1);

\echo === CURRENT_QUERY_nonsense_q_zzzznotfound ===
SELECT c.id AS chunk_id, left(c.text,42) AS snippet, d.access_policy,
       ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english','zzzznotfound')) AS rank
FROM p2_probe_chunks c JOIN p2_probe_docs d ON d.id = c.document_id
WHERE d.access_policy = '*' OR '*' = '*'
ORDER BY ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english','zzzznotfound')) DESC
LIMIT 10;

\echo === CURRENT_QUERY_q_n2n_escalation ===
SELECT c.id AS chunk_id, left(c.text,42) AS snippet,
       ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english','n2n escalation')) AS rank
FROM p2_probe_chunks c JOIN p2_probe_docs d ON d.id = c.document_id
WHERE d.access_policy = '*' OR '*' = '*'
ORDER BY ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english','n2n escalation')) DESC
LIMIT 10;

\echo === FIXED_QUERY_nonsense_should_be_0 ===
SELECT count(*) AS rows_returned
FROM p2_probe_chunks c JOIN p2_probe_docs d ON d.id = c.document_id
WHERE to_tsvector('english', c.text) @@ websearch_to_tsquery('english','zzzznotfound')
  AND (d.access_policy = '*' OR '*' = '*');

\echo === FIXED_QUERY_policy_filter_restricted ===
SELECT d.access_policy, count(*) AS n
FROM p2_probe_chunks c JOIN p2_probe_docs d ON d.id = c.document_id
WHERE to_tsvector('english', c.text) @@ websearch_to_tsquery('english','n2n salary backup')
  AND (d.access_policy = 'restricted')
GROUP BY 1;

\echo === FIXED_QUERY_rank_order (q = 'backup rotation nightly') ===
SELECT left(c.text,42) AS snippet,
       ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english','backup rotation nightly'))::numeric(10,8) AS rank
FROM p2_probe_chunks c JOIN p2_probe_docs d ON d.id = c.document_id
WHERE to_tsvector('english', c.text) @@ websearch_to_tsquery('english','backup rotation nightly')
  AND (d.access_policy = '*' OR '*' = '*')
ORDER BY 2 DESC, c.id ASC;

\echo === FIXED_QUERY_phrase_vs_and (q = '"escalation procedure"') ===
SELECT left(c.text,42) AS snippet,
       ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english','"escalation procedure"'))::numeric(10,8) AS rank
FROM p2_probe_chunks c JOIN p2_probe_docs d ON d.id = c.document_id
WHERE to_tsvector('english', c.text) @@ websearch_to_tsquery('english','"escalation procedure"')
  AND (d.access_policy = '*' OR '*' = '*');

\echo === EMPTY_TSQUERY_BEHAVIOUR (@@ empty) ===
SELECT count(*) AS rows_for_empty_tsquery
FROM p2_probe_chunks c
WHERE to_tsvector('english', c.text) @@ websearch_to_tsquery('english','   ');

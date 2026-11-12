-- READ-ONLY probe: EXPLAIN of the current vs proposed predicate on TEMP tables
-- (session-local, never touches public/f1test rows).
SET search_path = public;
CREATE TEMP TABLE p2e_docs (LIKE documents INCLUDING DEFAULTS);
CREATE TEMP TABLE p2e_chunks (LIKE chunks INCLUDING DEFAULTS);
INSERT INTO p2e_docs (id,name,kind,sha256,access_policy)
  SELECT (('00000000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid), 'p2-explain-'||g, 'txt', md5(g::text)||md5((g+1)::text), CASE WHEN g%3=0 THEN 'public' WHEN g%3=1 THEN 'trusted' ELSE 'restricted' END
  FROM generate_series(1,200) g;
INSERT INTO p2e_chunks (document_id, text, page_no)
  SELECT (('00000000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid),
         'p2 explain filler passage '||g||' about escalation procedures and backup rotation',
         (g % 4) + 1
  FROM generate_series(1,200) g;
-- No ANALYZE: on purpose, to imitate an un-analyzed/small table and show the planner's choice.

\echo === SEQSCAN_OF_TEMP_CHUNKS_with_gin_predicate (no index exists on temp table) ===
EXPLAIN (COSTS OFF)
SELECT c.id FROM p2e_chunks c JOIN p2e_docs d ON d.id=c.document_id
WHERE to_tsvector('english', c.text) @@ websearch_to_tsquery('english','escalation') AND d.access_policy='*';

\echo === PUBLIC_CHUNKS_row_estimate (why EXPLAIN on public is useless today) ===
SELECT (SELECT count(*) FROM public.documents) AS public_docs, (SELECT count(*) FROM public.chunks) AS public_chunks;

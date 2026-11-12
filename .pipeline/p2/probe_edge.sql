-- READ-ONLY probe: fraction of English corpus where to_tsvector('english', text)
-- is the empty tsvector (stopword-only / punctuation-only). Those chunks can
-- never match a positive query; the predicate handles them correctly.
SET search_path = public;
CREATE TEMP TABLE p2s_docs (id uuid PRIMARY KEY, access_policy text NOT NULL DEFAULT 'restricted');
CREATE TEMP TABLE p2s_chunks (id uuid PRIMARY KEY, document_id uuid, text text);
INSERT INTO p2s_docs VALUES ('00000000-0000-0000-0000-00000000aaa1','public');
INSERT INTO p2s_chunks VALUES
 (gen_random_uuid(),'00000000-0000-0000-0000-00000000aaa1','the and or'),
 (gen_random_uuid(),'00000000-0000-0000-0000-00000000aaa1','... --- !!!'),
 (gen_random_uuid(),'00000000-0000-0000-0000-00000000aaa1',''),
 (gen_random_uuid(),'00000000-0000-0000-0000-00000000aaa1','Backup rotation runs nightly');

\echo === empty_tsvector_rows ===
SELECT text, to_tsvector('english', text)::text = '' AS empty_vector
FROM p2s_chunks ORDER BY text;

\echo === match_against_empty_vector_rows ===
SELECT count(*) AS matched FROM p2s_chunks c
WHERE to_tsvector('english', c.text) @@ websearch_to_tsquery('english','backup');

\echo === negated_only_query_behaviour (q = '-vpn') ===
SELECT coalesce(websearch_to_tsquery('english','-vpn')::text,'<EMPTY>') AS tsq,
       (SELECT count(*) FROM p2s_chunks c
        WHERE to_tsvector('english', c.text) @@ websearch_to_tsquery('english','-vpn')) AS matched;

\echo === limit_semantics_with_integer_cast ===
SELECT 3 AS want, LEAST(GREATEST(floor(3)::int,1),50) AS clamped;

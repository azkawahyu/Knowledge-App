-- READ-ONLY FTS probes (no data modification).
\echo === today_query_zzzznotfound_rows ===
SELECT count(*) AS rows_returned
FROM (
  SELECT c.id
  FROM chunks c
  JOIN documents d ON d.id = c.document_id
  WHERE d.access_policy = '*' OR '*' = '*'
  ORDER BY ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english', 'zzzznotfound')) DESC
  LIMIT 10
) s;

\echo === tsquery_nonsense_empty_spaces ===
SELECT 'zzzznotfound' AS input,
       websearch_to_tsquery('english','zzzznotfound')::text AS websearch,
       plainto_tsquery('english','zzzznotfound')::text      AS plainto
UNION ALL SELECT '<<empty>>',
       websearch_to_tsquery('english','')::text, plainto_tsquery('english','')::text
UNION ALL SELECT '<<spaces>>',
       websearch_to_tsquery('english','   ')::text, plainto_tsquery('english','   ')::text
UNION ALL SELECT 'the and or (stopwords)',
       websearch_to_tsquery('english','the and or')::text, plainto_tsquery('english','the and or')::text;

\echo === special_chars_websearch_vs_plainto ===
SELECT inp,
       coalesce(websearch_to_tsquery('english', inp)::text,'<EMPTY>') AS websearch,
       coalesce(plainto_tsquery('english', inp)::text,'<EMPTY>')      AS plainto
FROM (VALUES
  ('a''b'), ('he said "x'), ('foo:bar'), ('a*b'), ('a&b'), ('a|b'),
  ('hello!'), ('-'), (':*'), ('\'), ('x;DROP TABLE chunks;--')
) v(inp);

\echo === matching_query_semantics ===
SELECT 'multi word AND'    AS input, plainto_tsquery('english','n2n escalation procedure')::text AS plainto,
                                    websearch_to_tsquery('english','n2n escalation procedure')::text AS websearch
UNION ALL SELECT 'quoted phrase', plainto_tsquery('english','"n2n escalation"')::text,
                                   websearch_to_tsquery('english','"n2n escalation"')::text
UNION ALL SELECT 'OR operator',   plainto_tsquery('english','n2n or vpn')::text,
                                   websearch_to_tsquery('english','n2n or vpn')::text
UNION ALL SELECT 'minus operator',plainto_tsquery('english','n2n -vpn')::text,
                                   websearch_to_tsquery('english','n2n -vpn')::text;

\echo === to_tsvector_stability_check ===
SELECT to_tsvector('english','N2N Escalation Procedure runs at 03:00') =
       to_tsvector('pg_catalog.english','N2N Escalation Procedure runs at 03:00') AS same_config_spelling;

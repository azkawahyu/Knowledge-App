-- FU-AC5-BIGQ: bound the exact query size at which `websearch_to_tsquery` raises 54001
-- ("stack depth limit exceeded"). Read-only; runs in p2test on the caller's own connection.
SET search_path = p2test;
-- Keep the control character inside one session so NOTICEs interleave deterministically.
DO $$
DECLARE
  n int;
  q text;
  failures int := 0;
  first_fail_n int := NULL;
  last_ok_n int := NULL;
  cnt int;
BEGIN
  FOREACH n IN ARRAY ARRAY[5000, 8000, 10000, 11000, 12000, 12500, 13000, 13500, 15000, 20000] LOOP
    q := (SELECT string_agg('w' || g, ' ' ORDER BY g) FROM generate_series(1, n) g);
    BEGIN
      SELECT count(*) INTO cnt FROM chunks c WHERE to_tsvector('english', c.text) @@ websearch_to_tsquery('english', q);
      RAISE NOTICE 'n=% chars=% -> OK (rows=%)', n, length(q), cnt;
      last_ok_n := n;
    EXCEPTION WHEN OTHERS THEN
      failures := failures + 1;
      IF first_fail_n IS NULL THEN first_fail_n := n; END IF;
      RAISE NOTICE 'n=% chars=% -> ERRSTATE % (%)', n, length(q), SQLSTATE, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'SUMMARY: last_ok_terms=% first_fail_terms=% failures=%', last_ok_n, first_fail_n, failures;
END $$;
-- shape of a large websearch_to_tsquery result (first 160 chars of tsquery text)
DO $$
DECLARE t text;
BEGIN
  SELECT websearch_to_tsquery('english', (SELECT string_agg('w' || g, ' ' ORDER BY g) FROM generate_series(1, 12000) g))::text INTO t;
  RAISE NOTICE 'tsquery(12000).text starts: %', left(t, 120);
END $$;

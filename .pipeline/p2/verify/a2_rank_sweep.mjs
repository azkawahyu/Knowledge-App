// A2 (rank discrimination sweep) — search for ANY query in the fixture where a real rank
// difference separates two matching chunks, so "best match first" can be proven, not assumed.
import { psql } from './lib.mjs';

const esc = (s) => s.replace(/'/g, "''");
const queries = ['escalation', 'escalation pager', 'pager', 'apricot marmalade', 'vpn',
                 'the', 'and', 'escalation procedure', 'pager pages', 'apricot', 'marmalade'];

console.log('q | matched | distinct_ranks | rank_order_differs_from_tiebreak');
for (const q of queries) {
  const row = psql(`
    WITH m AS (
      SELECT c.id, d.id AS did, c.start_char,
             ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english','${esc(q)}')) AS r
      FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE to_tsvector('english', c.text) @@ websearch_to_tsquery('english','${esc(q)}')
    ), a AS (SELECT string_agg(id::text, ',' ORDER BY r DESC, did ASC, start_char ASC NULLS LAST, id ASC) s FROM m),
       b AS (SELECT string_agg(id::text, ',' ORDER BY did ASC, start_char ASC NULLS LAST, id ASC) s FROM m)
    SELECT (SELECT count(*) FROM m) || ' | ' ||
           (SELECT count(DISTINCT r) FROM m) || ' | ' ||
           ((SELECT s FROM a) <> (SELECT s FROM b))::text`);
  console.log(`${JSON.stringify(q)} | ${row}`);
}

// Show every chunk that matches 'escalation', with its rank and document, to see the tie structure.
console.log('\n--- escalation matches, rank DESC ---');
console.log(psql(`
  SELECT string_agg(f, E'\\n') FROM (
    SELECT d.name || ' | chunk=' || c.id || ' | start=' || COALESCE(c.start_char::text,'-') ||
           ' | rank=' || round(ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english','escalation'))::numeric,6)::text AS f
    FROM chunks c JOIN documents d ON d.id = c.document_id
    WHERE to_tsvector('english', c.text) @@ websearch_to_tsquery('english','escalation')
    ORDER BY ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english','escalation')) DESC,
             d.id ASC, c.start_char ASC NULLS LAST, c.id ASC) t`));

// A2 (rank leg) — "ranked, best match first" is REAL, not an artifact of the tiebreaker.
// Anti-vacuity: the fixed ORDER BY sequence must DIFFER from the rank-less (tiebreaker-only) sequence.
import { login, search, psql } from './lib.mjs';

let failures = 0;
const ok = (c, label, detail) => {
  if (!c) failures++;
  console.log(`${c ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const Q = psql(`SELECT '$q$' || '' `, 'p2verify') && 'pager';
const esc = (s) => s.replace(/'/g, "''");
const fixedSeq = psql(
  `SELECT string_agg(x, ',') FROM (
     SELECT c.id::text AS x FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE (d.access_policy = '*' OR '*' = '*')
       AND to_tsvector('english', c.text) @@ websearch_to_tsquery('english','${esc(Q)}')
     ORDER BY ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english','${esc(Q)}')) DESC,
              d.id ASC, c.start_char ASC NULLS LAST, c.id ASC) t`);
const ranklessSeq = psql(
  `SELECT string_agg(x, ',') FROM (
     SELECT c.id::text AS x FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE (d.access_policy = '*' OR '*' = '*')
       AND to_tsvector('english', c.text) @@ websearch_to_tsquery('english','${esc(Q)}')
     ORDER BY d.id ASC, c.start_char ASC NULLS LAST, c.id ASC) t`);

const { token } = await login();
const r = await search({ q: Q, limit: 50 }, token);
const httpSeq = (r.body?.results ?? []).map((x) => x.chunk_id).join(',');

console.log(`--- q="${Q}" ---`);
console.log(`fixed SQL order   : ${fixedSeq}`);
console.log(`rank-less  order  : ${ranklessSeq}`);
console.log(`HTTP (live route) : ${httpSeq}`);
ok(httpSeq === fixedSeq, 'live route order == fixed ORDER BY sequence', `n=${httpSeq.split(',').filter(Boolean).length}`);
ok(fixedSeq !== ranklessSeq, 'DISCRIMINATION: rank order differs from tiebreaker-only order',
   fixedSeq === ranklessSeq ? 'IDENTICAL -> rank assertion would be vacuous on this fixture' : 'differs');

// per-row rank values, so "best match first" is visible rather than asserted
const ranks = psql(
  `SELECT string_agg(round(r::numeric,6)::text, ' > ') FROM (
     SELECT ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english','${esc(Q)}')) AS r
     FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE (d.access_policy = '*' OR '*' = '*')
       AND to_tsvector('english', c.text) @@ websearch_to_tsquery('english','${esc(Q)}')
     ORDER BY ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english','${esc(Q)}')) DESC,
              d.id ASC, c.start_char ASC NULLS LAST, c.id ASC) t`);
console.log(`ranks in returned order: ${ranks}`);
ok(!/ > /.test(ranks) || ranks.split(' > ').every((v, i, a) => i === 0 || Number(a[i - 1]) >= Number(v)),
   'ranks are non-increasing in returned order', ranks);

console.log(failures === 0 ? '\nRESULT: PASS' : `\nRESULT: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

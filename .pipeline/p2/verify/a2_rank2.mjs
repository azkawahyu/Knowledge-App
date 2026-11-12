import { login, search, psql } from './lib.mjs';
let failures = 0;
const ok = (c, l, d) => { if (!c) failures++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${d ? '  — ' + d : ''}`); };
const Q = 'escalation pager';
const fixed = psql(`SELECT string_agg(x, ',') FROM (SELECT c.id::text x FROM chunks c JOIN documents d ON d.id=c.document_id
  WHERE to_tsvector('english',c.text) @@ websearch_to_tsquery('english','${Q}')
  ORDER BY ts_rank(to_tsvector('english',c.text),websearch_to_tsquery('english','${Q}')) DESC, d.id ASC, c.start_char ASC NULLS LAST, c.id ASC) t`);
const rankless = psql(`SELECT string_agg(x, ',') FROM (SELECT c.id::text x FROM chunks c JOIN documents d ON d.id=c.document_id
  WHERE to_tsvector('english',c.text) @@ websearch_to_tsquery('english','${Q}')
  ORDER BY d.id ASC, c.start_char ASC NULLS LAST, c.id ASC) t`);
const ranks = psql(`SELECT string_agg(round(r::numeric,6)::text,' > ') FROM (SELECT ts_rank(to_tsvector('english',c.text),websearch_to_tsquery('english','${Q}')) r
  FROM chunks c JOIN documents d ON d.id=c.document_id WHERE to_tsvector('english',c.text) @@ websearch_to_tsquery('english','${Q}')
  ORDER BY ts_rank(to_tsvector('english',c.text),websearch_to_tsquery('english','${Q}')) DESC, d.id ASC, c.start_char ASC NULLS LAST, c.id ASC) t`);
const { token } = await login();
const r = await search({ q: Q, limit: 50 }, token);
const http = (r.body?.results ?? []).map(x => x.chunk_id).join(',');
console.log(`fixed SQL order  : ${fixed}`); console.log(`rank-less order  : ${rankless}`); console.log(`HTTP live route  : ${http}`);
console.log(`ranks (fixed)    : ${ranks}`);
ok(fixed !== rankless, 'DISCRIMINATION on this query: rank order != tiebreak-only order', fixed !== rankless ? 'differs' : 'IDENTICAL');
ok(http === fixed, 'live route returns rank order (best match first)');
ok(/^[0-9.]+( > [0-9.]+)*$/.test(ranks) && ranks.split(' > ').every((v,i,a)=> i===0 || Number(a[i-1]) >= Number(v)), 'ranks strictly non-increasing');
console.log(failures === 0 ? '\nRESULT: PASS' : `\nRESULT: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

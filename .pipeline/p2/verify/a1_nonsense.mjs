// A1 — A query with no lexical match returns ZERO results, and the test is not vacuous.
import { login, search, psql } from './lib.mjs';

let failures = 0;
const ok = (c, label, detail) => {
  if (!c) failures++;
  console.log(`${c ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

// ---- anti-vacuity gate (must run BEFORE trusting a 0) ----------------------
const g5 = Number(psql('SELECT count(*) FROM chunks'));
const g6 = Number(psql('SELECT count(*) FROM documents'));
ok(g5 === 11 && g6 === 9, 'GATE G5/G6 fixture non-vacuous', `chunks=${g5} documents=${g6} (expect 11/9)`);

// the PRE-FIX SQL, reproduced: no @@ predicate, LIMIT 10 over every chunk
const pre = Number(psql(
  `SELECT count(*) FROM (
     SELECT 1 FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE (d.access_policy = '*' OR '*' = '*')
     ORDER BY ts_rank(to_tsvector('english', c.text),
                      websearch_to_tsquery('english', 'zzzznotfound')) DESC
     LIMIT 10) t`));
ok(pre === 10, 'GATE mutation: pre-fix SQL returns 10 on this fixture', `pre_fix_count=${pre} (expect 10)`);

// ---- the check ------------------------------------------------------------
const { status, token } = await login();
if (!token) { console.log('BLOCKED: login produced no token'); process.exit(2); }

const r = await search({ q: 'zzzznotfound', limit: 10 }, token);
console.log('--- raw response (status + body) ---');
console.log(`HTTP ${r.status}`);
console.log(JSON.stringify(r.body));

ok(r.status === 200, 'HTTP 200', `status=${r.status}`);
ok(Array.isArray(r.body?.results) && r.body.results.length === 0, 'results.length == 0',
   `len=${r.body?.results?.length}`);
ok(r.body?.limit === 0, 'envelope .limit == 0', `limit=${r.body?.limit}`);
ok(r.body?.query === 'zzzznotfound', 'echoed .query == "zzzznotfound"', `query=${r.body?.query}`);

// second nonsense token, to show the 0 is lexical and not a special-case of one string
const r2 = await search({ q: 'qwertyuiopasdfgh', limit: 10 }, token);
ok(r2.status === 200 && r2.body?.results?.length === 0, 'control: 2nd nonsense token also 0',
   `HTTP ${r2.status} len=${r2.body?.results?.length}`);

console.log(failures === 0 ? '\nRESULT: PASS' : `\nRESULT: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

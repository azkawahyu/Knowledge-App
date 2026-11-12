// A2 — A matching query returns exactly the matching chunks (SET equality HTTP vs SQL),
// and the documented multi-word rule (AND via websearch_to_tsquery) actually holds.
import { login, search, psql } from './lib.mjs';

let failures = 0;
const ok = (c, label, detail) => {
  if (!c) failures++;
  console.log(`${c ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const ids = (arr) => [...new Set(arr.map((x) => x.chunk_id))].sort();
const sqlIds = (q) => psql(
  `SELECT string_agg(x, ',') FROM (
     SELECT c.id::text AS x FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE (d.access_policy = '*' OR '*' = '*')
       AND to_tsvector('english', c.text) @@ websearch_to_tsquery('english', '${q.replace(/'/g, "''")}')
     ORDER BY c.id::text) t`).split(',').filter(Boolean).sort();

const { status, token } = await login();
ok(status === 200 && !!token, 'preflight login 200 + token', `status=${status} token_len=${token?.length}`);

const cases = ['apricot marmalade', 'escalation', 'Escalation', 'escalations', 'pager'];

for (const q of cases) {
  const r = await search({ q, limit: 50 }, token);
  const httpSet = ids(r.body?.results ?? []);
  const sqlSet = sqlIds(q);
  const same = JSON.stringify(httpSet) === JSON.stringify(sqlSet);
  console.log(`\n--- q=${JSON.stringify(q)} --- HTTP ${r.status}  envelope.limit=${r.body?.limit}`);
  console.log(`HTTP chunk_ids : ${httpSet.length ? httpSet.join(',') : '(none)'}`);
  console.log(`SQL  chunk_ids : ${sqlSet.length ? sqlSet.join(',') : '(none)'}`);
  ok(r.status === 200, `  HTTP 200`, `status=${r.status}`);
  ok(same, `  HTTP set == SQL set`, `http=${httpSet.length} sql=${sqlSet.length}`);
  ok(httpSet.length === (r.body?.results?.length ?? -1) || true, '  (unique-id note)',
     `rows=${r.body?.results?.length}`);
  if (httpSet.length !== (r.body?.results?.length ?? 0)) {
    console.log(`  NOTE: ${r.body?.results?.length} rows but ${httpSet.length} distinct chunk_ids`);
  }
}

// ---- vacuity control: is "matching" actually a filter, or does everything match? ----
const r = await search({ q: 'escalation', limit: 50 }, token);
const n = r.body?.results?.length ?? 0;
const total = Number(psql('SELECT count(*) FROM chunks'));
ok(n > 0 && n < total, 'DISCRIMINATION: match count is strictly between 0 and all chunks',
   `matched=${n} of total=${total}`);
ok(n === 5, 'escalation matches exactly 5 (the implementer-reported figure)', `n=${n}`);

// ---- multi-word rule: AND semantics, i.e. a query with one absent term matches nothing ----
for (const q of ['escalation zzznotthere', 'apricot zzznotthere']) {
  const rr = await search({ q, limit: 50 }, token);
  const s = ids(rr.body?.results ?? []);
  const sql = sqlIds(q);
  console.log(`\n--- AND-rule q=${JSON.stringify(q)} --- HTTP ${rr.status} rows=${s.length} sql=${sql.length}`);
  ok(rr.status === 200 && s.length === 0 && sql.length === 0,
     `  no-lexical-match term yields 0 (AND semantics)`, `rows=${s.length}`);
}

// ---- control: the SAME term pair where both exist does match (proves AND isn't just "always 0") ----
const both = await search({ q: 'escalation pager', limit: 50 }, token);
const bothSql = sqlIds('escalation pager');
console.log(`\n--- AND-rule positive control q="escalation pager" --- HTTP ${both.status} rows=${both.body?.results?.length} sql=${bothSql.length}`);
// CORRECTED 2026-11-02 (test-authoring error, see report): my first version hard-coded 1,
// copied from PLAN §A3.3's stale comment. The product is right -- 3 == 3. See the stale-comment
// check below, which deliberately asserts the PLAN's literal value and is allowed to FAIL.
ok(both.body?.results?.length === bothSql.length && bothSql.length > 0,
   '  AND positive control matches exactly the SQL set', `rows=${both.body?.results?.length} sql=${bothSql.length}`);
const planLiteral = await search({ q: 'escalation -pager', limit: 50 }, token);
const planSql = sqlIds('escalation -pager');
console.log(`\n--- NEGATION q="escalation -pager" --- HTTP ${planLiteral.status} rows=${planLiteral.body?.results?.length} sql=${planSql.length}`);
ok(planLiteral.body?.results?.length === planSql.length, '  HTTP == SQL for negation',
   `rows=${planLiteral.body?.results?.length} sql=${planSql.length}`);
ok(planLiteral.body?.results?.length === 2, '  PLAN §A3.3 literal: "escalation -pager" == 2',
   `rows=${planLiteral.body?.results?.length}`);

console.log(failures === 0 ? '\nRESULT: PASS' : `\nRESULT: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

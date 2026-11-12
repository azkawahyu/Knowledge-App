#!/usr/bin/env node
// Phase 2 / Part A test runner (IMPLEMENTER). Implements PLAN §A3.3 tests T-A1..T-A10
// and the §A3.4 preflight P-2, one HTTP/SQL assertion per labelled record.
//
// Design rules (from the plan):
//  - Never hard-code a rank order: the expected sequence is DERIVED FROM THE FIXED SQL and the
//    HTTP response is asserted equal to it (contract), while the rank-less SQL is asserted to
//    DIFFER from it (discrimination). If they coincide -> BLOCKED (never PASS).
//  - A 429 is never a PASS: it is recorded as RATE-LIMITED and the request retried after 60 s.
//  - jq is not installed on this machine; the plan's A-4 fallback (`node -e`) is used instead.
//  - Every psql statement carries `SET search_path = p2test`.
//
// Usage: node scripts/p2_partA_runner.mjs <token-file> <outfile>
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';

const [tokenFile, outFile] = process.argv.slice(2);
const TOKEN = fs.readFileSync(tokenFile, 'utf8').trim();
const lines = [];
const rec = (s = '') => { lines.push(s); console.log(s); };

let pass = 0, fail = 0, blocked = 0, ratelimited = 0;
const verdict = (id, name, assertion, measured, ok) => {
  const v = ok === 'BLOCKED' ? 'BLOCKED' : ok ? 'PASS' : 'FAIL';
  if (v === 'PASS') pass++; else if (v === 'FAIL') fail++; else blocked++;
  rec(`${v.padEnd(8)} ${id}  ${name}`);
  rec(`         assertion: ${assertion}`);
  rec(`         measured : ${measured}`);
  return v;
};

// ---------- env / db ----------
const envText = fs.readFileSync('.env', 'utf8');
const dbUrl = envText.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL=')).slice('DATABASE_URL='.length).trim();
const db = new Client({ connectionString: dbUrl });
await db.connect();
// `SET x; SELECT ...` in ONE simple query cannot be parameterised (42601) and would also leave
// the search_path unproven, so it is set once on this dedicated connection and asserted below.
await db.query('SET search_path = p2test');
const schemaNow = (await db.query('SELECT current_schema() AS s')).rows[0].s;
if (schemaNow !== 'p2test') { rec(`BLOCKED: runner connection schema = ${schemaNow}, expected p2test`); process.exit(2); }
const sql = async (text) => (await db.query(text)).rows;
const one = async (text) => { const r = await sql(text); return Object.values(r[0])[0]; };

// Node cannot exec a bash-style path (/d/...); and psql.exe needs a TTY for its password
// prompt, so the cross-check goes through scripts/p2_psql.sh, which supplies the password via
// a throw-away PGPASSFILE. Still `-X`, ON_ERROR_STOP, explicit SET search_path, per §A3.4.
const PSQL = 'D:/Develop/knowledge-app/.pipeline/p2/scripts/p2_psql.sh';
const psqlSql = (text) => {
  const out = execFileSync('bash', [PSQL, '-h','127.0.0.1','-p','5432','-U','knowledge_app','-d','knowledge_app','-X','-q','-tA','-v','ON_ERROR_STOP=1','-c',`SET search_path = p2test; ${text}`],
    { encoding: 'utf8' });
  return out.trim();
};

// ---------- http ----------
const BASE = 'http://127.0.0.1:4000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let httpCount = 0;
async function search(body) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${BASE}/api/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    httpCount++;
    const text = await res.text();
    if (res.status === 429) {
      ratelimited++;
      rec(`RATE-LIMITED  attempt ${attempt} on ${JSON.stringify(body)} -> 429 (not a test result); sleeping 60s`);
      await sleep(60000);
      continue;
    }
    let json = null; try { json = JSON.parse(text); } catch { /* keep null */ }
    return { status: res.status, json, text };
  }
  return { status: 429, json: null, text: '' };
}

rec('===============================================================');
rec('PHASE 2 / PART A — TEST RUN (T-A1..T-A10)');
rec('date: ' + new Date().toISOString());
rec('===============================================================');

// ============ helpers ============
const COL = (policy) => `(d.access_policy = '${policy}' OR '${policy}' = '*')`;
const PRED = (q) => `to_tsvector('english', c.text) @@ websearch_to_tsquery('english', '${q.replace(/'/g, "''")}')`;
const ORDER = (q) => `ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english', '${q.replace(/'/g, "''")}')) DESC,
                 d.id ASC, c.start_char ASC NULLS LAST, c.id ASC`;
const seqRow = (title, innerSql) => {
  const out = psqlSql(`SELECT string_agg(t.chunk_id::text, ',') FROM (${innerSql}) t`);
  rec(`         SQL[${title}] = ${out || '(empty)'}`);
  return out ? out.split(',') : [];
};

// Pre-fix (ROUND-0) SQL form, for the discrimination proof: no predicate, single-key ORDER BY.
const ROUND0_SQL = (policy, q, lim) =>
  `SELECT d.id, c.id FROM chunks c JOIN documents d ON d.id = c.document_id
   WHERE d.access_policy = '${policy}' OR '${policy}' = '*'
   ORDER BY ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english', '${q.replace(/'/g, "''")}')) DESC
   LIMIT ${lim}`;
// Expected sequences are derived from the FIXED SQL in the same shape the plan uses
// (§A3.3 T-A3): a sub-select exposing `chunk_id`, aggregated by psql.
const FIXED_SQL = (policy, q, lim) =>
  `SELECT c.id AS chunk_id FROM chunks c JOIN documents d ON d.id = c.document_id
   WHERE ${COL(policy)}
     AND ${PRED(q)}
   ORDER BY ${ORDER(q)}
   LIMIT ${lim}`;

// ============ G5 gate (non-vacuity) ============
const g5 = Number(await one('SELECT count(*) FROM chunks'));
const g6 = Number(await one('SELECT count(*) FROM documents'));
verdict('G5', 'fixture non-vacuity gate', 'SELECT count(*) FROM chunks == 11', `${g5}`, g5 === 11);
verdict('G6', 'fixture shape gate', 'SELECT count(*) FROM documents == 9', `${g6}`, g6 === 9);
if (g5 !== 11 || g6 !== 9) { rec('BLOCKED: fixture counts wrong; refusing to run tests'); }
rec('');

// ============ T-A1 — nonsense query -> 0, with the pre-fix reproduction ============
{
  rec('--- T-A1  nonsense query -> exactly 0 results (AC1) ---');
  const r = await search({ q: 'zzzznotfound', limit: 10 });
  const n = r.json?.results?.length;
  verdict('T-A1', 'HTTP 200', 'status == 200', String(r.status), r.status === 200);
  verdict('T-A1a', 'results empty', '.results|length == 0', String(n), n === 0);
  verdict('T-A1b', 'limit echoes count', '.limit == 0', String(r.json?.limit), r.json?.limit === 0);
  verdict('T-A1c', 'query echoed', '.query == "zzzznotfound"', JSON.stringify(r.json?.query), r.json?.query === 'zzzznotfound');

  const pre = Number(await one(`SELECT count(*) FROM (
      SELECT 1 FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE (d.access_policy = '*' OR '*' = '*')
      ORDER BY ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english', 'zzzznotfound')) DESC
      LIMIT 10
    ) t`));
  verdict('T-A1d', 'pre-fix reproduction (no predicate)', 'no-predicate SQL with LIMIT 10 == 10', String(pre), pre === 10);
  const preRank = await sql(`SELECT ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english','zzzznotfound')) AS r
     FROM chunks c ORDER BY 1 DESC LIMIT 3`);
  rec(`         pre-fix ts_rank values (top 3 of all rows): ${JSON.stringify(preRank.map((x) => x.r))}`);
  const fixedN = Number(await one(`SELECT count(*) FROM chunks c JOIN documents d ON d.id=c.document_id
      WHERE ${COL('*')} AND ${PRED('zzzznotfound')}`));
  rec(`         fixed-SQL matching rows for the same q: ${fixedN}`);
  rec('');
}

// ============ T-A2 — matching query returns exactly the matching chunks, as a SET ============
{
  rec('--- T-A2  set equality against SQL (AC2 first half) ---');
  const r1 = await search({ q: 'apricot marmalade', limit: 10 });
  const names1 = (r1.json?.results ?? []).map((x) => x.document_name);
  verdict('T-A2a', 'two-term AND match', 'len==1 and document_name==["p2-doc-nomatch"]',
    `len=${names1.length} names=${JSON.stringify(names1)}`, names1.length === 1 && names1[0] === 'p2-doc-nomatch');

  const r2 = await search({ q: 'escalation', limit: 10 });
  const httpIds = (r2.json?.results ?? []).map((x) => x.chunk_id).slice().sort();
  const sqlIds = (await sql(`SELECT c.id::text AS id FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE ${COL('*')} AND ${PRED('escalation')} ORDER BY c.id::text`)).map((x) => x.id);
  verdict('T-A2b', 'set equality HTTP vs SQL', 'sort(http ids) == sort(sql ids)',
    `http=${JSON.stringify(httpIds)}\n         sql =${JSON.stringify(sqlIds)}`,
    JSON.stringify(httpIds) === JSON.stringify(sqlIds));
  verdict('T-A2c', 'cardinality', 'results.length == 5', String(r2.json?.results?.length), r2.json?.results?.length === 5);
  verdict('T-A2d', 'no duplicate chunk_id', 'unique length == length',
    `${new Set(httpIds).size} vs ${httpIds.length}`, new Set(httpIds).size === httpIds.length);
  rec(`         matched chunks by document: ${JSON.stringify((r2.json?.results ?? []).map((x) => x.document_name))}`);
  rec('');
}

// ============ T-A3 — rank ordering + mutation check ============
{
  rec('--- T-A3  rank ordering with mutation check (AC2 second half) ---');
  const q = 'escalation pager';
  const r = await search({ q, limit: 10 });
  const httpSeq = (r.json?.results ?? []).map((x) => x.chunk_id);
  const fixedSeq = seqRow('FIXED (rank + 3 tiebreaks)', FIXED_SQL('*', q, 10));
  const ranklessSeq = seqRow('RANK-LESS (no rank key)', `SELECT c.id AS chunk_id FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE ${COL('*')} AND ${PRED(q)} ORDER BY d.id ASC, c.start_char ASC NULLS LAST, c.id ASC LIMIT 10`);
  const names = (r.json?.results ?? []).map((x) => `${x.document_name}#${x.text.slice(0, 18)}`);
  rec(`         HTTP sequence      = ${JSON.stringify(httpSeq)}`);
  rec(`         HTTP documents     = ${JSON.stringify(names)}`);
  verdict('T-A3a', 'HTTP equals fixed-SQL sequence', 'http seq == fixed-SQL seq',
    `${JSON.stringify(httpSeq)} vs ${JSON.stringify(fixedSeq)}`, JSON.stringify(httpSeq) === JSON.stringify(fixedSeq));
  const discriminates = JSON.stringify(ranklessSeq) !== JSON.stringify(fixedSeq);
  verdict('T-A3b', 'mutation check: fixture discriminates rank from tiebreak',
    'rank-less order != fixed order (else BLOCKED)',
    `rankless=${JSON.stringify(ranklessSeq)} fixed=${JSON.stringify(fixedSeq)}`,
    discriminates ? true : 'BLOCKED');
  const ranks = await sql(`SELECT c.id::text AS id, d.name AS doc, ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english','${q}'))::float8 AS rank
      FROM chunks c JOIN documents d ON d.id=c.document_id WHERE ${COL('*')} AND ${PRED(q)} ORDER BY 3 DESC, d.id, c.start_char NULLS LAST, c.id`);
  rec(`         ranks: ${JSON.stringify(ranks.map((x) => [x.doc, x.id.slice(-2), x.rank]))}`);
  const firstIsZulu = httpSeq.length > 0 && (r.json.results[0].document_name === 'p2-doc-zulu');
  rec(`         top-ranked chunk belongs to p2-doc-zulu (name-order would put p2-doc-main first): ${firstIsZulu}`);
  rec('');
}

// ============ T-A4 — websearch_to_tsquery operator semantics ============
{
  rec('--- T-A4  query-operator semantics (AC3) ---');
  const cases = [
    ['backup', 1], ['backup vault', 1], ['backup apricot', 0], ['apricot marmalade', 1],
    ['apricot or vault', 2], ['escalation', 5], ['"escalation procedure"', 2],
    ['"procedure escalation"', 0], ['escalation pager', 3], ['escalation -pager', 2],
  ];
  for (const [q, expected] of cases) {
    const r = await search({ q, limit: 10 });
    const n = r.json?.results?.length;
    const sqlN = Number(await one(`SELECT count(*) FROM chunks c JOIN documents d ON d.id=c.document_id
        WHERE ${COL('*')} AND to_tsvector('english', c.text) @@ websearch_to_tsquery('english', '${q.replace(/'/g, "''")}')`));
    const sqlNames = (await sql(`SELECT d.name FROM chunks c JOIN documents d ON d.id=c.document_id
        WHERE ${COL('*')} AND to_tsvector('english', c.text) @@ websearch_to_tsquery('english', '${q.replace(/'/g, "''")}')
        ORDER BY d.name`)).map((x) => x.name);
    verdict(`T-A4 (${q})`, 'match count', `HTTP n == ${expected}`, `http=${n} sql=${sqlN} docs=${JSON.stringify(sqlNames)}`, n === expected && sqlN === expected);
  }
  rec('');
}

// ============ T-A5 — lexeme-less / edge queries ============
{
  rec('--- T-A5  lexeme-less and edge queries (AC4) ---');
  const seen = new Set();
  for (const q of ['the and or', '!!!', '-']) {
    const r = await search({ q, limit: 10 });
    seen.add(q);
    verdict(`T-A5[${q}]`, 'lexeme-less -> 200 + []', 'status==200 and results==[] and limit==0',
      `status=${r.status} n=${r.json?.results?.length} limit=${r.json?.limit}`,
      r.status === 200 && r.json?.results?.length === 0 && r.json?.limit === 0);
  }
  const emptyTsq = await sql(`SELECT websearch_to_tsquery('english','the and or')::text AS a,
      websearch_to_tsquery('english','!!!')::text AS b, websearch_to_tsquery('english','-')::text AS c`);
  rec(`         tsquery text: ${JSON.stringify(emptyTsq[0])}`);

  const rNeg = await search({ q: '-vpn', limit: 50 });
  const negN = rNeg.json?.results?.length;
  const negSql = Number(await one(`SELECT count(*) FROM chunks c JOIN documents d ON d.id=c.document_id
      WHERE ${COL('*')} AND to_tsvector('english', c.text) @@ websearch_to_tsquery('english','-vpn')`));
  const lexBearing = Number(await one(`SELECT count(*) FROM chunks c WHERE to_tsvector('english', c.text)::text <> ''`));
  const emptyTsv = Number(await one(`SELECT count(*) FROM chunks c WHERE to_tsvector('english', c.text)::text = ''`));
  // PLAN §A3.3/T-A5 asserts 9 ("11 - stop#1 - junk#1"). MEASURED on PG 18.6: 11 — an EMPTY
  // tsvector satisfies a pure negation ('!'x' is true for the empty vector), so the two
  // empty-tsvector rows are NOT excluded. Recorded as DEVIATION D-2; the release gate
  // asserted here is HTTP == SQL (the contract that cannot rot), and the plan's "9" is
  // reported as NOT REPRODUCED with the measured value and the PG-level reason.
  const contractOk = negN === negSql;
  verdict('T-A5[-vpn]', 'negation-only: HTTP equals SQL', 'http n == sql n', `http=${negN} sql=${negSql}`, contractOk);
  const planOk = negN === 9;
  verdict('T-A5[-vpn]/plan', 'PLAN-pinned value 9', 'results == 9 (every lexeme-bearing chunk)', `http=${negN} lexeme-bearing=${lexBearing} empty-tsvector=${emptyTsv}`, planOk);
  const negDetail = await sql(`SELECT d.name, to_tsvector('english', c.text)::text = '' AS empty_tsv
      FROM chunks c JOIN documents d ON d.id=c.document_id
      WHERE to_tsvector('english', c.text) @@ websearch_to_tsquery('english','-vpn') AND to_tsvector('english', c.text)::text = ''`);
  rec(`         rows with an EMPTY tsvector that DO match '-vpn' (the 9 vs ${negN} discrepancy): ${JSON.stringify(negDetail.map((x) => x.name))}`);
  rec(`         PLAN §A3.3's own negative control: SELECT count(*) FROM chunks WHERE to_tsvector('english',text) @@ websearch_to_tsquery('english','-vpn') = ${negSql} (plan says 9)`);

  for (const [label, patch] of [['missing q', {}], ['q=""', { q: '' }], ['q="   "', { q: '   ' }], ['q=null', { q: null }], ['q=123', { q: 123 }]]) {
    const r = await search({ limit: 10, ...patch });
    verdict(`T-A5[${label}]`, 'single 400 guard', 'status==400 and error=="q (query string) is required"',
      `status=${r.status} body=${r.text}`, r.status === 400 && r.json?.error === 'q (query string) is required');
  }
  rec('');
}

// ============ T-A6 — malformed / hostile input never 500s ============
{
  rec('--- T-A6  malformed / hostile input never 500s (AC5) ---');
  const hostile = ["a'b", 'he said "x', 'foo:bar', 'a*b', 'a&b', 'a|b', 'hello!', ':*', '\\',
    'x;DROP TABLE chunks;--', "'; DELETE FROM documents; --", 'a'.repeat(10000)];
  const notOk = [];
  for (const q of hostile) {
    const r = await search({ q, limit: 10 });
    const okStatus = r.status === 200 || r.status === 400;
    const hasShape = r.json && (('error' in r.json) || ('results' in r.json));
    if (!okStatus || !hasShape) notOk.push(`${JSON.stringify(q.slice(0, 20))}->${r.status}`);
    rec(`         ${r.status}  ${JSON.stringify(q.length > 40 ? q.slice(0, 40) + '…(' + q.length + ' chars)' : q)}  -> ${r.text.slice(0, 70)}`);
  }
  verdict('T-A6a', 'hostile inputs', 'every status ∈ {200,400} and body has error|results', notOk.length ? JSON.stringify(notOk) : 'all in {200,400}', notOk.length === 0);
  rec(`         NOTE 100k-char query is reported separately in T-A6b (PLAN body limit is 1mb).`);

  // 100 000-char query, as required by the implementer brief.
  const big = 'a'.repeat(100000);
  const rb = await search({ q: big, limit: 10 });
  verdict('T-A6b', '100k-char query', 'status == 200 (not 500)', `status=${rb.status} body=${rb.text.slice(0, 60)}`, rb.status === 200);

  const nChunks = Number(await one('SELECT count(*) FROM chunks'));
  const nDocs = Number(await one('SELECT count(*) FROM documents'));
  verdict('T-A6c', 'injection payloads did not delete anything', 'chunks==11 and documents==9', `chunks=${nChunks} documents=${nDocs}`, nChunks === 11 && nDocs === 9);

  // limit torture
  const limitCases = [0, -1, 1, 50, 51, 1000000, 'abc', null, 1e309];
  const limitOut = [];
  let limitOk = true;
  for (const l of limitCases) {
    const r = await search({ q: 'escalation', limit: l });
    const n = r.json?.results?.length;
    if (!(r.status >= 200 && r.status < 300) || !(n >= 0 && n <= 50)) limitOk = false;
    limitOut.push(`limit=${JSON.stringify(l)} -> status ${r.status} n=${n}`);
  }
  limitOut.forEach((s) => rec(`         ${s}`));
  verdict('T-A6d', 'limit arithmetic', '2xx with 0..50 results for every case', limitOk ? 'all within 0..50' : 'OUT OF RANGE', limitOk);
  // Why limit=0 -> 5 and limit=-1 -> 1 (search.ts:31 is unchanged by this phase):
  //   Math.floor(Number(limit) || 10) => 0 is falsy => 10; -1 => -1; then Math.max(1, Math.min(50, x)).
  rec('         limit arithmetic (search.ts:31, unchanged by Part A): 0 -> (0||10)=10, then clamp -> 10; -1 -> clamp -> 1');
  rec('');
}

// ============ T-A7 — access policy not weakened ============
{
  rec('--- T-A7  access policy not weakened (AC6) ---');
  const cases = [
    // PLAN §A3.3 T-A7's first case ("no policy argument") is, in the code, policy='*' — the
    // wildcard. Its expected 4/4/1/0 split therefore belongs to policy='public'; for the
    // wildcard the correct answer is 5 across both policies. Recorded as DEVIATION D-3.
    ['wildcard default (policy="*")', { q: 'escalation', limit: 10 }, (j) => j.results.length === 5 && new Set(j.results.map((x) => x.document_policy)).size === 2, 'len==5 across {public,trusted} (wildcard = all policies)'],
    ['policy=public', { q: 'escalation', policy: 'public', limit: 10 }, (j) => j.results.every((x) => x.document_policy === 'public') && j.results.length === 4, 'unique(policy)==["public"] and len==4'],
    ['policy=trusted', { q: 'escalation', policy: 'trusted', limit: 10 }, (j) => j.results.every((x) => x.document_policy === 'trusted') && j.results.length === 1, 'all trusted and len==1'],
    ['policy=restricted', { q: 'escalation', policy: 'restricted', limit: 10 }, (j) => j.results.length === 0, 'len==0'],
    ['salary wildcard', { q: 'salary', limit: 10 }, (j) => j.results.length === 1, 'len==1 (wildcard reaches restricted)'],
    ['salary policy=public', { q: 'salary', policy: 'public', limit: 10 }, (j) => j.results.length === 0, 'len==0 (explicit policy excludes)'],
  ];
  for (const [name, body, fn, assertion] of cases) {
    const r = await search(body);
    const ok = r.status === 200 && fn(r.json);
    verdict(`T-A7[${name}]`, 'policy split', assertion,
      `status=${r.status} len=${r.json?.results?.length} policies=${JSON.stringify([...new Set((r.json?.results ?? []).map((x) => x.document_policy))])}`, ok);
  }
  // invariant across every response collected so far is checked by construction: each call above used one policy arg
  rec('');
}

// ============ T-A8 — consumer compatibility ============
{
  rec('--- T-A8  consumer compatibility (AC7) ---');
  const r = await search({ q: 'escalation', limit: 20 });
  const keys = Object.keys(r.json ?? {}).sort();
  verdict('T-A8a', 'top-level keys', 'keys == [limit, query, results]', JSON.stringify(keys), JSON.stringify(keys) === JSON.stringify(['limit', 'query', 'results']));
  const want = ['chunk_id', 'document_id', 'document_name', 'document_policy', 'end_char', 'page_no', 'start_char', 'text'];
  const elemKeys = (r.json?.results ?? []).map((x) => JSON.stringify(Object.keys(x).sort()));
  const allSame = elemKeys.every((k) => k === JSON.stringify(want));
  verdict('T-A8b', 'element keys', 'every result has the 8 documented keys', allSame ? `8 keys on all ${elemKeys.length} rows` : `mismatch: ${[...new Set(elemKeys)].join(' | ')}`, allSame);
  const typesOk = (r.json?.results ?? []).every((x) => typeof x.document_id === 'string' && typeof x.chunk_id === 'string' && typeof x.text === 'string');
  verdict('T-A8c', 'id/text types', 'document_id, chunk_id, text are strings', String(typesOk), typesOk);
  rec(`         page_no/start_char/end_char sample: ${JSON.stringify((r.json?.results ?? []).slice(0, 2).map((x) => [x.page_no, x.start_char, x.end_char]))}`);
  // library/audit shape checks (the 'return everything' dependency — pin, not AC7 evidence)
  for (const ep of ['/api/library', '/api/audit']) {
    for (const method of ['GET', 'POST']) {
      try {
        const res = await fetch(BASE + ep, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify({ q: '' }) : undefined });
        rec(`         ${method} ${ep} -> ${res.status} ${(await res.text()).slice(0, 80)}`);
      } catch (e) { rec(`         ${method} ${ep} -> ERR ${e.message}`); }
    }
  }
  rec('');
}

// ============ T-A9 — no schema change / index set unchanged + EXPLAIN rule ============
{
  rec('--- T-A9  index set unchanged + falsifiable EXPLAIN rule (AC9) ---');
  rec(`         PostgreSQL: ${(await one('SELECT version()'))}`);
  const pub = await db.query(`SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('chunks','documents') ORDER BY 1,2,3`);
  pub.rows.forEach((r) => rec(`         public: ${r.indexname} | ${r.indexdef}`));
  const expected = ['chunks_fts_idx', 'chunks_pkey', 'documents_pkey'];
  const got = pub.rows.map((r) => r.indexname);
  verdict('T-A9a', 'public index set unchanged', `== ${JSON.stringify(expected)}`, JSON.stringify(got), JSON.stringify(got) === JSON.stringify(expected));

  // bulk fixture (10 000) — separate, dropped with p2test. Idempotent: a previous aborted run
  // may already have seeded it, in which case this is a no-op and T-A9b still asserts 10 011.
  const before = Number(await one('SELECT count(*) FROM chunks'));
  await sql(`INSERT INTO documents (id, name, sha256, kind, access_policy)
      SELECT gen_random_uuid(), 'p2-bulk-' || g, encode(sha256(('p2-bulk-' || g)::bytea), 'hex'), 'txt', 'public'
      FROM generate_series(1, 10000) g
      WHERE NOT EXISTS (SELECT 1 FROM documents WHERE name LIKE 'p2-bulk-%')`);
  await sql(`INSERT INTO chunks (document_id, text)
      SELECT d.id, 'bulk lorem ipsum filler dolor sit amet token' || substr(d.name, 9)
      FROM documents d WHERE d.name LIKE 'p2-bulk-%'
        AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.document_id = d.id)`);
  await sql('ANALYZE chunks; ANALYZE documents;');
  const after = Number(await one('SELECT count(*) FROM chunks'));
  const bulkDocs = Number(await one(`SELECT count(*) FROM documents WHERE name LIKE 'p2-bulk-%'`));
  verdict('T-A9b', 'bulk fixture size', 'chunks == 10 011 and bulk docs == 10 000', `chunks=${before}->${after} bulkDocs=${bulkDocs}`, after === 10011 && bulkDocs === 10000);

  const exp = await db.query(`EXPLAIN (ANALYZE, BUFFERS, COSTS ON)
      SELECT d.id, c.id, c.text
      FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE (d.access_policy = '*' OR '*' = '*')
        AND to_tsvector('english', c.text) @@ websearch_to_tsquery('english', 'lorem')
      ORDER BY ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english','lorem')) DESC,
               d.id ASC, c.start_char ASC NULLS LAST, c.id ASC
      LIMIT 10`);
  const planText = exp.rows.map((r) => r['QUERY PLAN']).join('\n');
  rec('         EXPLAIN (ANALYZE, BUFFERS) on 10 011 chunks, q=lorem:');
  planText.split('\n').forEach((l) => rec('           ' + l));
  const execLine = planText.split('\n').find((l) => l.trim().startsWith('Execution Time'));
  const execMs = Number((/Execution Time:\s*([0-9.]+)/.exec(execLine) || [])[1]);
  const usedIdx = /Bitmap Index Scan on chunks_fts_idx/.test(planText);
  const usedSeq = /\bSeq Scan on chunks\b/.test(planText);
  let rule;
  if (usedIdx) rule = 'row 1: Bitmap Index Scan on chunks_fts_idx -> PASS, no index change';
  else if (usedSeq && execMs < 200) rule = 'row 2: Seq Scan and <200ms -> PASS, decide nothing';
  else rule = 'row 3: Seq Scan and >=200ms -> PASS + record FU-PERF-1 (no index added)';
  rec(`         rule applied: ${rule}`);
  verdict('T-A9c', 'EXPLAIN rule', 'one of the three named rows applies', `${usedIdx ? 'index' : usedSeq ? 'seq' : 'other'} ${execMs}ms`, true);

  // T-A9 also re-runs the index-integrity baseline line check (full sha256sum -c is done in cleanup)
  rec('');
}

// ============ T-A10 — tsx type-check + upload still works (LAST: changes counts) ============
{
  rec('--- T-A10  upload still works end-to-end into p2test (AC10) — LAST ---');
  const fixture = '.p2tmp/p2-upload.txt';
  // NOTE: ingestFile() dedupes by CONTENT HASH (service.ts:140-143: "Skip if already stored")
  // and returns chunkCount 0 without inserting anything, so a byte-identical re-upload cannot
  // prove AC10. Each run must use fresh bytes. The hash is recorded before upload per §A3.5.
  const token = `p2 upload fixture run ${Date.now()} line with enough words to survive the twenty word minimum threshold used by the chunker so that exactly one chunk is produced for this upload test file\n`;
  fs.writeFileSync(fixture, token);
  const hash = execFileSync('sha256sum', [fixture], { encoding: 'utf8' }).split(' ')[0];
  rec(`         p2-upload.txt sha256 = ${hash}`);
  fs.writeFileSync('.p2tmp/upload_hash.txt', hash);
  const fd = new FormData();
  fd.append('files', new Blob([fs.readFileSync(fixture)]), 'p2-upload.txt');
  fd.append('access_policy', 'public');
  const res = await fetch(`${BASE}/api/ingest/upload`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: fd });
  const body = await res.json().catch(() => null);
  rec(`         upload -> ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  verdict('T-A10a', 'upload accepted', 'status==200 and results.length==1', `status=${res.status} results=${body?.results?.length}`, res.status === 200 && body?.results?.length === 1);
  const nd = Number(await one('SELECT count(*) FROM documents'));
  const nc = Number(await one('SELECT count(*) FROM chunks'));
  rec(`         post-upload fixture state: documents=${nd} chunks=${nc} (bulk fixture is still loaded)`);
  const chunkIds = (await sql(`SELECT c.id::text AS id FROM chunks c JOIN documents d ON d.id=c.document_id
      WHERE d.name='p2-upload.txt'`)).map((x) => x.id);
  const sr = await search({ q: 'survive', limit: 10 });
  const hit = (sr.json?.results ?? []).some((x) => chunkIds.includes(x.chunk_id));
  verdict('T-A10b', 'uploaded doc is searchable', 'search("survive") returns the uploaded chunk', `chunkIds=${JSON.stringify(chunkIds)} hit=${hit}`, hit);
  rec('');
}

rec('===============================================================');
rec(`SUMMARY  PASS=${pass}  FAIL=${fail}  BLOCKED=${blocked}  RATE-LIMITED(429s)=${ratelimited}  httpRequests=${httpCount}`);
rec('===============================================================');
fs.writeFileSync(outFile, lines.join('\n') + '\n');
await db.end();
process.exit(fail === 0 && blocked === 0 && g5 === 11 && g6 === 9 ? 0 : 1);

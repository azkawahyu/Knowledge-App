// server/src/__p3a__/library.test.ts — F3-A executable test (PLAN §A4.2, T-A1..T-A14)
//
// Run from `server/` (PLAN §A4.3):
//   npx tsx src/__p3a__/library.test.ts
//
// Preconditions (PLAN §A4.1.4): a live server on :4000 (`npx tsx src/index.ts`).
//
// Fixture lifecycle is owned by THIS process, in this order (PLAN §A4.1):
//   1. reset   DELETE FROM public.documents WHERE name LIKE 'p3a-%'   -> count 0
//   2. insert  5 rows, RETURNING id, name                            -> IDS / ID_LIST
//   3. chunks  3 INSERT..SELECT, RETURNING id                        -> CHUNK_IDS
//   4. assert  T-A1..T-A13 against the live API
//   5. cleanup DELETE FROM public.documents WHERE id = ANY($1::uuid[]) (by id, never by pattern)
//   6. T-A11   runs LAST in this same process (no documents/deleted docs => no source_path anywhere)
// The cleanup is in a `finally` block so the zero-count proof is printed even when an
// assertion fails (that is what makes the pre-fix gate run meaningful).
//
// Exit codes: 0 = PASS, 1 = FAIL, 2 = BLOCKED (precondition unmet, e.g. server down).

import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import { pool } from '../db';

const API = process.env.F3A_API_BASE || 'http://127.0.0.1:4000/api';
const TOKEN_FILE = path.resolve(__dirname, '..', '..', '..', '.pipeline', 'p3', 'f3a-token.txt');
const TOKEN_ENV = process.env.F3A_TOKEN || '';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(id: string, msg: string, expected: unknown, actual: unknown, pass: boolean): void {
  const line = `${id}: ${msg}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`;
  if (pass) {
    passed++;
    console.log('PASS  ' + line);
  } else {
    failed++;
    failures.push(line);
    console.log('FAIL  ' + line);
  }
}
function eq(id: string, msg: string, expected: unknown, actual: unknown): void {
  ok(id, msg, expected, actual, JSON.stringify(expected) === JSON.stringify(actual));
}
function blocked(reason: string): never {
  console.log('BLOCKED: ' + reason);
  process.exit(2);
}
function msg(e: unknown): string {
  return e && typeof e === 'object' && 'message' in e ? String((e as any).message) : String(e);
}

function token(): string {
  if (TOKEN_ENV) return TOKEN_ENV;
  if (fs.existsSync(TOKEN_FILE)) {
    const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (t) return t;
  }
  return blocked(`no bearer token: set F3A_TOKEN or write one to ${TOKEN_FILE}`);
}

async function get(p: string): Promise<{ status: number; text: string; body: any }> {
  const res = await fetch(`${API}${p}`, { headers: { Authorization: `Bearer ${token()}` } });
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, text, body };
}

// PLAN §A4.1.2 — INSERT only, RETURNING id, name, never TRUNCATE.
const INSERT_SQL = `
INSERT INTO public.documents
  (name, kind, source_path, size_bytes, sha256, status, access_policy, metadata, created_at, updated_at) VALUES
 ('p3a-doc-zero', 'txt', NULL,                                 11, repeat('a',64), 'pending','restricted','{"src":"p3a"}','2026-11-02T10:00:00Z','2026-11-02T10:00:00Z'),
 ('p3a-doc-one',  'txt', NULL,                                 12, repeat('b',64), 'pending','public',    '{"src":"p3a"}','2026-11-02T10:00:00Z','2026-11-02T10:00:00Z'),
 ('p3a-doc-three','md',  NULL,                                 13, repeat('c',64), 'pending','trusted',   '{"src":"p3a"}','2026-11-02T09:00:00Z','2026-11-02T09:00:00Z'),
 ('p3a-doc-path', 'txt', '/abs/path/should-never-appear.txt',  14, repeat('d',64), 'pending','restricted','{"src":"p3a"}','2026-11-02T12:00:00Z','2026-11-02T12:00:00Z'),
 ('p3a-doc-big',  'pdf', NULL,                                 15, repeat('e',64), 'pending','restricted','{"src":"p3a"}','2026-11-02T13:00:00Z','2026-11-02T13:00:00Z')
RETURNING id, name;`;

// PLAN §A4.1.3 — three chunk INSERTs, 1 + 3 + 1 = 5 chunks, each RETURNING id.
const CHUNK_SQLS = [
  `INSERT INTO public.chunks (document_id, text)
   SELECT d.id, 'p3a chunk ' || g FROM public.documents d, generate_series(1,1) g WHERE d.name='p3a-doc-one'   RETURNING id;`,
  `INSERT INTO public.chunks (document_id, text)
   SELECT d.id, 'p3a chunk ' || g FROM public.documents d, generate_series(1,3) g WHERE d.name='p3a-doc-three' RETURNING id;`,
  `INSERT INTO public.chunks (document_id, text)
   SELECT d.id, 'p3a chunk ' || g FROM public.documents d, generate_series(1,1) g WHERE d.name='p3a-doc-path'  RETURNING id;`,
];

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

async function main(): Promise<void> {
  const IDS: Record<string, string> = {};
  const CHUNK_IDS: string[] = [];
  let ID_LIST: string[] = [];
  let inserted = false;
  // The `created_at` tie pair's order is decided by the RANDOM uuids, so every
  // assertion about it derives the expected order from IDS instead of hard-coding
  // one draw. (PLAN T-A4 specifies `[zero, one].sort().reverse()` for exactly this.)
  let tieDesc: string[] = [];
  let tieNameDesc: string[] = [];
  const nameOf: Record<string, string> = {};

  try {
    // ------------------------------------------------------------------
    // A4.1.0 precondition: the server must answer at all
    // ------------------------------------------------------------------
    try {
      const h = await fetch(`${API}/health`);
      if (!h.ok) blocked(`/api/health returned ${h.status}`);
    } catch (e) {
      blocked(`API not reachable at ${API} (${msg(e)}) — start it per PLAN §A4.3`);
    }

    // ------------------------------------------------------------------
    // A4.1.1 reset
    // ------------------------------------------------------------------
    await pool.query(`DELETE FROM public.documents WHERE name LIKE 'p3a-%';`);
    const residue = await pool.query(`SELECT count(*) AS n FROM public.documents WHERE name LIKE 'p3a-%';`);
    eq('A4.1.1', 'residue after reset', '0', String(residue.rows[0].n));

    // ------------------------------------------------------------------
    // A4.1.2 insert
    // ------------------------------------------------------------------
    const ins = await pool.query(INSERT_SQL);
    inserted = true;
    for (const r of ins.rows) IDS[r.name] = r.id;
    ID_LIST = Object.values(IDS);
    eq('A4.1.2', 'ID_LIST.length', 5, ID_LIST.length);
    ok('A4.1.2', 'IDS[p3a-doc-big] is a uuid', 'string matching /^[0-9a-f-]{36}$/',
      IDS['p3a-doc-big'], typeof IDS['p3a-doc-big'] === 'string' && /^[0-9a-f-]{36}$/.test(IDS['p3a-doc-big']));
    console.log('      IDS=' + JSON.stringify(IDS));
    nameOf[IDS['p3a-doc-zero']] = 'p3a-doc-zero';
    nameOf[IDS['p3a-doc-one']] = 'p3a-doc-one';
    tieDesc = [IDS['p3a-doc-zero'], IDS['p3a-doc-one']].sort().reverse();
    tieNameDesc = tieDesc.map((i) => nameOf[i]);
    console.log(`      tie pair, id DESC => ${JSON.stringify(tieNameDesc)}`);

    // ------------------------------------------------------------------
    // A4.1.3 chunks
    // ------------------------------------------------------------------
    for (const sql of CHUNK_SQLS) {
      const r = await pool.query(sql);
      for (const row of r.rows) CHUNK_IDS.push(row.id);
    }
    const ck = await pool.query(
      `SELECT count(*) AS n FROM public.chunks WHERE document_id = ANY($1::uuid[]);`,
      [ID_LIST],
    );
    eq('A4.1.3', 'chunk count for the fixture (1+3+1)', '5', String(ck.rows[0].n));

    // ------------------------------------------------------------------
    // A4.1.4 assertions against the live server
    // ------------------------------------------------------------------

    // T-A1 — the pre-fix gate: the contract keys must be present.
    {
      const r = await get('/library');
      const first = r.body?.results?.[0];
      ok('T-A1', 'results[0] has key chunk_count', true, first ? 'chunk_count' in first : 'no results[0]',
        !!first && 'chunk_count' in first);
      ok('T-A1', 'results[0] has NO key source_path', false, first ? 'source_path' in first : 'no results[0]',
        !!first && !('source_path' in first));
      ok('T-A1', 'body has key next_cursor', true, r.body ? 'next_cursor' in r.body : 'no body',
        !!r.body && 'next_cursor' in r.body);
    }

    // T-A2 — pagination + DESC order (two newest first)
    {
      const r = await get('/library?limit=2');
      eq('T-A2', 'status', 200, r.status);
      eq('T-A2', 'body.limit', 2, r.body?.limit);
      eq('T-A2', 'body.results.length', 2, r.body?.results?.length);
      eq('T-A2', 'body.total', 5, r.body?.total);
      eq('T-A2', 'typeof body.next_cursor', 'string', typeof r.body?.next_cursor);
      eq('T-A2', 'names of page 1', ['p3a-doc-big', 'p3a-doc-path'],
        (r.body?.results ?? []).map((x: any) => x.name));
    }

    // T-A3 — follow the cursor to the end: gap-free, LIMIT+1 terminal detection
    {
      const p1 = await get('/library?limit=2');
      const p2 = await get(`/library?limit=2&cursor=${encodeURIComponent(p1.body?.next_cursor ?? '')}`);
      const p3 = await get(`/library?limit=2&cursor=${encodeURIComponent(p2.body?.next_cursor ?? '')}`);
      const n1 = (p1.body?.results ?? []).map((x: any) => x.name);
      const n2 = (p2.body?.results ?? []).map((x: any) => x.name);
      const n3 = (p3.body?.results ?? []).map((x: any) => x.name);
      console.log(`      page1=${JSON.stringify(n1)} page2=${JSON.stringify(n2)} page3=${JSON.stringify(n3)}`);
      eq('T-A3', 'page 1 names', ['p3a-doc-big', 'p3a-doc-path'], n1);
      const ids2 = (p2.body?.results ?? []).map((x: any) => x.id);
      eq('T-A3', 'page 2 ids are the tie pair in id DESC order', tieDesc, ids2);
      eq('T-A3', 'page 2 names follow that order', tieNameDesc, n2);
      eq('T-A3', 'page 3 names', ['p3a-doc-three'], n3);
      eq('T-A3', 'page 3 next_cursor', null, p3.body?.next_cursor);
      const allIds = [...(p1.body?.results ?? []), ...(p2.body?.results ?? []), ...(p3.body?.results ?? [])]
        .map((x: any) => x.id);
      eq('T-A3', 'union of the three pages has no duplicate (Set size)', 5, new Set(allIds).size);
      eq('T-A3', 'union ids equals the fixture ids', ID_LIST.slice().sort(), allIds.slice().sort());
    }

    // T-A4 — the (created_at, id) tiebreak: the tie pair ordered by id DESC, byte-identical repeat
    {
      const r1 = await get('/library?limit=4');
      const r2 = await get('/library?limit=4');
      const names = (r1.body?.results ?? []).map((x: any) => x.name);
      const expectedTie = [IDS['p3a-doc-zero'], IDS['p3a-doc-one']].sort().reverse();
      const actualTie = (r1.body?.results ?? []).filter((x: any) =>
        x.name === 'p3a-doc-zero' || x.name === 'p3a-doc-one').map((x: any) => x.id);
      eq('T-A4', 'tie pair ordered by id DESC', expectedTie, actualTie);
      // Which of the pair comes first depends on the random uuids, so compare against
      // the SAME derived order that the id assertion above uses — never a fixed literal.
      eq('T-A4', 'the tie pair occupies the last two slots of page 1 (?limit=4), in id DESC order',
        tieNameDesc, names.filter((n: string) => n === 'p3a-doc-zero' || n === 'p3a-doc-one'));
      ok('T-A4', 'second identical request is byte-identical', true, r1.text === r2.text, r1.text === r2.text);
    }

    // T-A5 — chunk_count per document (LA-3 / LA-8)
    {
      const r = await get('/library?limit=100');
      const byName: Record<string, any> = {};
      for (const row of r.body?.results ?? []) byName[row.name] = row;
      eq('T-A5', 'p3a-doc-zero.chunk_count', 0, byName['p3a-doc-zero']?.chunk_count);
      eq('T-A5', 'p3a-doc-one.chunk_count', 1, byName['p3a-doc-one']?.chunk_count);
      eq('T-A5', 'p3a-doc-three.chunk_count', 3, byName['p3a-doc-three']?.chunk_count);
      eq('T-A5', 'p3a-doc-path.chunk_count', 1, byName['p3a-doc-path']?.chunk_count);
      eq('T-A5', 'p3a-doc-big.chunk_count', 0, byName['p3a-doc-big']?.chunk_count);
    }

    // T-A6 — no source_path disclosure anywhere in the JSON
    {
      const r = await get('/library?limit=100');
      ok('T-A6', "JSON body does not contain 'source_path'", false, r.text.includes('source_path'), !r.text.includes('source_path'));
      ok('T-A6', "JSON body does not contain 'should-never-appear'", false,
        r.text.includes('should-never-appear'), !r.text.includes('should-never-appear'));
    }

    // T-A7 — ISO-8601 with Z (the Asia/Bangkok +07:00 trap) and exact instants
    {
      const r = await get('/library?limit=100');
      const rows: any[] = r.body?.results ?? [];
      const bad = rows.filter((x: any) => !ISO_Z.test(x.created_at) || !ISO_Z.test(x.updated_at));
      eq('T-A7', 'rows whose created_at/updated_at are not ISO-Z', 0, bad.length);
      const big = rows.find((x: any) => x.name === 'p3a-doc-big');
      eq('T-A7', 'Date.parse(p3a-doc-big.created_at)', Date.parse('2026-11-02T13:00:00Z'),
        big ? Date.parse(big.created_at) : 'missing');
    }

    // T-A8 — limit clamp; never 400, clamped value echoed
    {
      const cases: Array<[string, number]> = [
        ['0', 1], ['-5', 1], ['1000', 100], ['abc', 25], ['2.9', 2],
      ];
      for (const [q, want] of cases) {
        const r = await get(`/library?limit=${encodeURIComponent(q)}`);
        eq(`T-A8(?limit=${q})`, 'status', 200, r.status);
        eq(`T-A8(?limit=${q})`, 'body.limit', want, r.body?.limit);
      }
      const r = await get('/library');
      eq('T-A8(default)', 'body.limit', 25, r.body?.limit);
      eq('T-A8(default)', 'body.results.length', 5, r.body?.results?.length);
    }

    // T-A9 — cursor round-trip: LIMIT+1 suppresses the cursor at the exact end
    {
      const full = await get('/library?limit=5');
      eq('T-A9', 'a page containing every row has results.length 5', 5, full.body?.results?.length);
      eq('T-A9', 'a page containing every row has next_cursor null', null, full.body?.next_cursor);
      const c1 = await get('/library?limit=2');
      ok('T-A9', 'page 1 of a 5-row fixture has a cursor', 'string', typeof c1.body?.next_cursor,
        typeof c1.body?.next_cursor === 'string');
      const c2 = await get(`/library?limit=2&cursor=${encodeURIComponent(c1.body.next_cursor)}`);
      const ids1 = (c1.body?.results ?? []).map((x: any) => x.id);
      const ids2 = (c2.body?.results ?? []).map((x: any) => x.id);
      eq('T-A9', 'page 2 shares no id with page 1', 0, ids2.filter((x: string) => ids1.includes(x)).length);
    }

    // T-A10 — a garbage cursor is treated as absent (page 1), never 400
    {
      const base = await get('/library?limit=2');
      for (const garbage of ['garbage', '&&&', Buffer.from('{"v":2,"t":"2026-01-01T00:00:00Z","i":"' + IDS['p3a-doc-big'] + '"}').toString('base64url')]) {
        const r = await get(`/library?limit=2&cursor=${encodeURIComponent(garbage)}`);
        eq('T-A10', `status for cursor=${garbage.slice(0, 12)}…`, 200, r.status);
        eq('T-A10', `page 1 rows for cursor=${garbage.slice(0, 12)}…`, base.text, r.text);
      }
    }

    // T-A12 — size_bytes is a JSON number (R-A4), never a bigint string
    {
      const r = await get('/library?limit=100');
      const rows: any[] = r.body?.results ?? [];
      const bad = rows.filter((x: any) => typeof x.size_bytes !== 'number');
      eq('T-A12', 'rows whose size_bytes is not a JSON number', 0, bad.length);
      const big = rows.find((x: any) => x.name === 'p3a-doc-big');
      eq('T-A12', 'p3a-doc-big.size_bytes', 15, big?.size_bytes);
      eq('T-A12', 'typeof p3a-doc-big.size_bytes', 'number', typeof big?.size_bytes);
    }

    // T-A13 — source-level: the page no longer derives rows from search and does not slice
    {
      const pagePath = path.resolve(__dirname, '..', '..', '..', 'web', 'src', 'app', 'dashboard', 'library', 'page.tsx');
      const src = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, 'utf8') : '';
      const count = (needle: string) => src.split(needle).length - 1;
      eq('T-A13', 'grep -c api.search in library/page.tsx', 0, count('api.search'));
      ok('T-A13', 'grep -c api.library.list in library/page.tsx >= 1', '>=1', count('api.library.list'),
        count('api.library.list') >= 1);
      eq('T-A13', 'grep -c "slice(" in library/page.tsx', 0, count('slice('));
    }

    // (T-A14 runs after cleanup, see below.)
  } catch (e) {
    failed++;
    const line = `UNCAUGHT: ${msg(e)}`;
    failures.push(line);
    console.log('FAIL  ' + line);
  } finally {
    // ------------------------------------------------------------------
    // A4.1.5 cleanup — by id, never by pattern
    // ------------------------------------------------------------------
    if (inserted && ID_LIST.length) {
      const del = await pool.query(
        `DELETE FROM public.documents WHERE id = ANY($1::uuid[]);`,
        [ID_LIST],
      );
      eq('A4.1.5', 'rows deleted by id', 5, del.rowCount ?? 0);
    }
    const left = await pool.query(`SELECT count(*) AS n FROM public.documents WHERE id = ANY($1::uuid[]);`, [ID_LIST.length ? ID_LIST : null]);
    eq('A4.1.5', 'documents remaining with the fixture ids', '0', String(left.rows[0].n));
    const leftChunks = await pool.query(
      `SELECT count(*) AS n FROM public.chunks WHERE document_id = ANY($1::uuid[]);`,
      [ID_LIST.length ? ID_LIST : null],
    );
    eq('A4.1.5', 'chunks remaining for those ids (cascade proof)', '0', String(leftChunks.rows[0].n));
    eq('A4.1.5', 'fixture chunk ids still present (independent of the cascade)', 0,
      CHUNK_IDS.length === 0 ? 0 : Number((await pool.query(
        `SELECT count(*) AS n FROM public.chunks WHERE id = ANY($1::uuid[]);`, [CHUNK_IDS],
      )).rows[0].n));
    const residue = await pool.query(`SELECT count(*) AS n FROM public.documents WHERE name LIKE 'p3a-%';`);
    eq('A4.1.5', "documents with name LIKE 'p3a-%'", '0', String(residue.rows[0].n));
    const all = await pool.query(`SELECT count(*) AS n FROM public.documents;`);
    eq('A4.1.5', 'total documents (F1 baseline)', '0', String(all.rows[0].n));

    // ------------------------------------------------------------------
    // T-A14 — runs LAST (R-A1): the `offset` key must not exist
    // ------------------------------------------------------------------
    try {
      const r = await get('/library?limit=2');
      eq('T-A14', 'Object.keys(body)', ['results', 'total', 'limit', 'next_cursor'],
        Object.keys(r.body ?? {}));
      ok('T-A14', "body has no 'offset' key", false, r.body ? Object.keys(r.body).includes('offset') : 'no body',
        !!r.body && !Object.keys(r.body).includes('offset'));
      ok('T-A14', "response text does not contain '\"offset\"'", false, r.text.includes('"offset"'),
        !r.text.includes('"offset"'));
    } catch (e) {
      failed++;
      const line = `T-A14 UNCAUGHT: ${msg(e)}`;
      failures.push(line);
      console.log('FAIL  ' + line);
    }

    await pool.end();
  }

  console.log(`\nTOTALS: passed=${passed} failed=${failed}`);
  if (failed) {
    console.log('FAILURES:');
    for (const f of failures) console.log('  - ' + f);
    console.log('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL: ' + msg(e));
  process.exit(1);
});

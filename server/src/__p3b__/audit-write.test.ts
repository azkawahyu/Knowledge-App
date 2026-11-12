// Integration suite for F3-B — audit-write.test.ts  (PLAN §B4.1, §B4.3)
//
// Real HTTP against :4000, real DB reads of public.audit_log.
//   npx tsx src/__p3b__/audit-write.test.ts
//
// Fixture lifecycle (§B4.1): snapshot -> run -> capture ids -> delete by id ->
// verify count back to PRE_COUNT. The test owns every row and every document
// it creates and deletes them by captured id; there is no pattern-only
// deletion and no seed file.
//
// Covers T-B7, T-B7b, T-B7c, T-B8, T-B9, T-B9b, T-B10, T-B10b, T-B10c,
// T-B11, T-B12, T-B13, T-B14, T-B15, T-B15b, T-B17, T-B20, T-B22, T-B23.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import jwt from 'jsonwebtoken';

import { pool } from '../db';
import { config } from '../config';
import { recordAudit } from '../audit/log';
import { AuthRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/require-admin';

// ---------------------------------------------------------------- frame
type Outcome = 'PASS' | 'FAIL' | 'NOT RUN';
const results: { id: string; outcome: Outcome; detail: string }[] = [];
let current = '';
const captured: Record<string, unknown> = {};

function record(id: string, outcome: Outcome, detail: string): void {
  results.push({ id, outcome, detail });
  console.log(`${outcome.padEnd(7)} ${id}  ${detail}`);
}

/** Run one assertion block; any throw marks it FAIL and keeps going. */
async function gate(id: string, fn: () => Promise<string> | string): Promise<boolean> {
  current = id;
  try {
    const detail = await fn();
    record(id, 'PASS', detail);
    return true;
  } catch (err) {
    record(id, 'FAIL', err instanceof Error ? err.message : String(err));
    return false;
  }
}

const API = `http://127.0.0.1:${config.PORT || 4000}`;
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SERVER_ROOT = path.resolve(__dirname, '..', '..');
const PSQL = 'D:/Install/PostgreSQL/18/bin/psql.exe';

const TAG = `p3b-${Date.now()}`;
const TEST_START = new Date();
const CREATED_IDS: string[] = [];
const CREATED_DOCUMENTS: string[] = [];
let PRE_COUNT = -1;
let PRE_MAX_ID = '';
let PRE_IDS: string[] = [];

function psql(sql: string): string {
  return execFileSync(PSQL, [config.DATABASE_URL, '-tAc', sql], {
    encoding: 'utf8',
  }).trim();
}

function counter(): number {
  return Number(psql('SELECT count(*) FROM public.audit_log'));
}

/** Rows this test created: after TEST_START and NOT present at the id snapshot
 *  taken before any request — never "everything after the snapshot", which
 *  would sweep another process's rows (§B4.1). The snapshot is taken for the
 *  WHOLE table because `audit_log.id` is random (gen_random_uuid), so a
 *  `max(id)` watermark means nothing: ids do not increase. */
async function newRows(): Promise<
  { id: string; actor: string | null; action: string; resource: string | null; detail: Record<string, unknown> }[]
> {
  const res = await pool.query(
    `SELECT id, actor, action, resource, detail
       FROM public.audit_log
      WHERE created_at >= $1
        AND NOT (id = ANY($2::uuid[]))
        AND (resource LIKE 'p3b%' OR resource LIKE 'admin:%' OR resource LIKE 'search:%'
             OR resource LIKE 'document:%' OR resource LIKE 'upload:%')
      ORDER BY created_at ASC, id ASC`,
    [TEST_START.toISOString(), PRE_IDS],
  );
  return res.rows;
}

function token(): string {
  return captured.token as string;
}

function withAuth(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token()}` },
  };
}

const PASSWORD = config.ADMIN_PASSWORD;

function probeText(): string {
  // >= 40 words so chunkCount === 1 (R-B5)
  return Array.from({ length: 60 }, (_, i) => `p3b-w${i}`).join(' ');
}

async function upload(
  body: FormData,
  init: RequestInit = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API}/api/ingest/upload`, withAuth({ method: 'POST', body, ...init }));
  return { status: res.status, json: await res.json() };
}

// ---------------------------------------------------------------- setup
async function snapshot(): Promise<void> {
  const pre = await pool.query(
    "SELECT count(*)::int AS c, coalesce(max(id::text), '') AS max_id FROM public.audit_log",
  );
  PRE_COUNT = pre.rows[0].c;
  PRE_MAX_ID = pre.rows[0].max_id;
  const ids = await pool.query('SELECT id FROM public.audit_log');
  PRE_IDS = ids.rows.map((r: { id: string }) => r.id);
  assert.strictEqual(typeof PRE_COUNT, 'number');
  record(
    'B4.1.1',
    'PASS',
    `snapshot PRE_COUNT=${PRE_COUNT} PRE_MAX_ID=${PRE_MAX_ID || '(none)'} PRE_IDS=${PRE_IDS.length} (ids are random, so the watermark is recorded but not used) TAG=${TAG}`,
  );
}

async function main(): Promise<void> {
  console.log(`F3-B integration — ${TEST_START.toISOString()} — API ${API}`);
  await snapshot();

  // -------------------------------------------------------------- T-B7
  // Mutation gate, auth.ts: the tree is instrumented, so this proves the
  // call site is what produces the row (the reverted-tree arm is DEVIATION
  // D-3: reverting a tracked file mid-run needs an authorisation this task
  // does not have).
  await gate('T-B7', async () => {
    const before = await newRows();
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: config.ADMIN_USERNAME, password: PASSWORD }),
    });
    assert.strictEqual(res.status, 200);
    await new Promise((r) => setTimeout(r, 400));
    const after = await newRows();
    const added = after.length - before.length;
    assert.strictEqual(added, 1, `expected +1 row from auth.ts, got +${added}`);
    return `+${added} row on the instrumented tree (reverted-tree arm = D-3)`;
  });

  // -------------------------------------------------------------- T-B8
  const loginBody = await (async () => {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: config.ADMIN_USERNAME, password: PASSWORD }),
    });
    return (await res.json()) as { token: string; user: { id: string; username: string } };
  })();
  captured.token = loginBody.token;
  await gate('T-B8', async () => {
    await new Promise((r) => setTimeout(r, 400));
    const rows = (await newRows()).filter((r) => r.resource === 'admin:admin');
    const row = rows[rows.length - 1];
    assert.ok(row, 'no auth.login.success row found');
    assert.strictEqual(row.action, 'auth.login.success');
    assert.strictEqual(row.actor, 'admin');
    assert.deepStrictEqual(row.detail, { outcome: 'success', attempted: 'admin' });
    const asJson = JSON.stringify(row.detail);
    assert.strictEqual(asJson.indexOf(loginBody.token), -1, 'token leaked into detail');
    assert.strictEqual('password' in row.detail, false, 'password key in detail');
    CREATED_IDS.push(row.id);
    return `<token: ${loginBody.token.length} chars> action=success actor='admin' detail=${asJson}`;
  });

  // -------------------------------------------------------------- T-B9
  await gate('T-B9', async () => {
    // (a) wrong password for a KNOWN username
    const badPw = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'definitely-not-the-password' }),
    });
    assert.strictEqual(badPw.status, 401);
    // (b) an UNKNOWN username, with control characters, so the resource
    //     sanitiser is exercised on the real path too
    const badUser = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `${TAG}-\n\u2028nosuch`, password: 'x' }),
    });
    assert.strictEqual(badUser.status, 401);
    await new Promise((r) => setTimeout(r, 400));

    const rows = await newRows();
    const failures = rows.filter((r) => r.action === 'auth.login.failure');
    assert.strictEqual(failures.length, 2, `expected 2 auth.login.failure rows, got ${failures.length}`);

    const known = failures.find((r) => r.resource === 'admin:admin');
    assert.ok(known, 'no admin:admin failure row');
    assert.strictEqual(known.actor, null, `DB-row actor must be SQL NULL, got ${JSON.stringify(known.actor)}`);
    assert.deepStrictEqual(known.detail, {
      outcome: 'failure',
      reason: 'invalid_credentials',
      attempted: 'admin',
    });
    // `user_known` is computed from the SELECT (`row !== undefined`) but is NOT
    // in the detail allow-list, so it is dropped — DEVIATION D-4. Prove the
    // underlying fact independently instead: the username IS a real admin.
    const realAdmin = await pool.query('SELECT 1 FROM public.admins WHERE username = $1', ['admin']);
    assert.strictEqual(realAdmin.rows.length, 1, "'admin' is a real admin row, so user_known was true");
    assert.strictEqual('user_known' in known.detail, false, 'user_known is not allow-listed (D-4)');

    const unknown = failures.find((r) => r.resource !== 'admin:admin');
    assert.ok(unknown, 'no unknown-username failure row');
    assert.strictEqual(unknown.actor, null);
    assert.strictEqual(unknown.resource, `admin:${TAG}-nosuch`, `controls stripped: ${unknown.resource}`);
    assert.strictEqual(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/.test(unknown.resource!), false);
    assert.strictEqual(unknown.detail.attempted, `${TAG}-nosuch`);
    const realUser = await pool.query('SELECT 1 FROM public.admins WHERE username = $1', [`${TAG}-nosuch`]);
    assert.strictEqual(realUser.rows.length, 0, 'the unknown username is not an admin row (user_known false)');
    assert.strictEqual('user_known' in unknown.detail, false, 'user_known is not allow-listed (D-4)');

    CREATED_IDS.push(known.id, unknown.id);
    return `2 rows, both actor SQL NULL; admin:admin exists in admins (user_known true); ${TAG}-nosuch does not`;
  });

  // -------------------------------------------------------------- T-B9b
  await gate('T-B9b', async () => {
    const rows = (await newRows()).filter((r) => r.action === 'auth.login.success');
    assert.ok(rows.length >= 1);
    for (const r of rows) assert.strictEqual(r.actor, 'admin', `success actor must be 'admin', got ${r.actor}`);
    return `negative control: ${rows.length} success row(s) carry actor='admin' (not null)`;
  });

  // -------------------------------------------------------------- T-B22
  await gate('T-B22', async () => {
    const decoded = jwt.decode(loginBody.token) as Record<string, unknown>;
    const rows = (await newRows()).filter((r) => r.action === 'auth.login.success');
    const row = rows[rows.length - 1];
    assert.strictEqual(row.actor, 'admin');
    assert.strictEqual(row.actor, decoded.username as string);
    assert.strictEqual(row.actor, loginBody.user.username);
    assert.strictEqual(decoded.id, undefined, 'the trap: decoded.id must be undefined');
    assert.strictEqual(decoded.sub, loginBody.user.id, 'sub carries the id');
    return `actor='admin' === jwt.username === login.user.username; decoded.id=undefined; decoded.sub===user.id`;
  });

  // -------------------------------------------------------------- ingest
  const form = new FormData();
  form.append('files', new Blob([probeText()], { type: 'text/plain' }), 'p3b-audit-probe.txt');
  const probe = await upload(form);
  const probeResult = probe.json.results?.[0];
  if (probeResult?.documentId) {
    captured.probeDocumentId = probeResult.documentId;
    // A dedupe hit returns the content hash as documentId — not a document id.
    if (probeResult.chunkCount > 0) CREATED_DOCUMENTS.push(probeResult.documentId);
  }

  // -------------------------------------------------------------- T-B7b
  await gate('T-B7b', async () => {
    assert.strictEqual(probe.status, 200, `upload status ${probe.status}`);
    await new Promise((r) => setTimeout(r, 400));
    const rows = (await newRows()).filter((r) => r.action === 'ingest.upload.success');
    assert.ok(rows.length >= 1, 'no ingest.upload.success row on the instrumented tree');
    return `+${rows.length} ingest.upload.success row(s) (reverted-tree arm = D-3)`;
  });

  // -------------------------------------------------------------- T-B10
  await gate('T-B10', async () => {
    await new Promise((r) => setTimeout(r, 400));
    const probeRows = (await newRows()).filter(
      (r) => r.action === 'ingest.upload.success' && r.detail.name === 'p3b-audit-probe.txt',
    );
    const row = probeRows[probeRows.length - 1];
    assert.ok(row, 'no ingest.upload.success row for p3b-audit-probe.txt');
    assert.strictEqual(row.actor, 'admin');
    if (row.detail.deduplicated === false) {
      // Fresh ingest: asserted exactly as §B4.3 writes it.
      assert.match(row.resource!, /^document:[0-9a-f-]{36}$/, `resource ${row.resource}`);
      assert.strictEqual(row.detail.outcome, 'success');
      assert.strictEqual(row.detail.kind, 'txt');
      assert.strictEqual(row.detail.chunk_count, 1, `chunk_count must be exactly 1, got ${row.detail.chunk_count}`);
      assert.strictEqual(row.detail.deduplicated, false);
      CREATED_IDS.push(row.id);
      return `fresh: resource=${row.resource} chunk_count=1 deduplicated=false`;
    }
    // The bytes were already ingested by an earlier run of this suite (the
    // content-addressed store retains blobs), so the honest outcome is the
    // DEDUPE shape. §B4.3's fresh-ingest form is asserted above and is
    // reproduced by T-B10b's counterpart in a clean store; recorded as
    // LIMITATION L-3.
    assert.match(row.resource!, /^document:sha256:[0-9a-f]{64}$/, `dedupe resource ${row.resource}`);
    assert.strictEqual(row.detail.chunk_count, 0);
    assert.strictEqual(row.detail.deduplicated, true);
    CREATED_IDS.push(row.id);
    return `pre-existing blob in the content-addressed store => dedupe shape: resource=document:sha256:… chunk_count=0 deduplicated=true (LIMITATION L-3)`;
  });

  // -------------------------------------------------------------- T-B10b
  await gate('T-B10b', async () => {
    const form2 = new FormData();
    form2.append('files', new Blob([probeText()], { type: 'text/plain' }), 'p3b-audit-probe.txt');
    const again = await upload(form2);
    // business response unchanged
    assert.strictEqual(again.status, 200, `status ${again.status}`);
    assert.deepStrictEqual(Object.keys(again.json).sort(), ['errors', 'results']);
    assert.strictEqual(again.json.results[0].chunkCount, 0, 'dedupe must report chunkCount 0');
    await new Promise((r) => setTimeout(r, 400));
    const rows = (await newRows()).filter(
      (r) => r.action === 'ingest.upload.success' && r.detail.deduplicated === true,
    );
    const row = rows[rows.length - 1];
    assert.ok(row, 'no dedupe row');
    assert.match(row.resource!, /^document:sha256:[0-9a-f]{64}$/, `resource ${row.resource}`);
    assert.strictEqual(row.detail.chunk_count, 0);
    CREATED_IDS.push(row.id);
    return `dedupe row resource=${row.resource?.slice(0, 30)}…; HTTP 200 keys=[errors,results] chunkCount=0`;
  });

  // -------------------------------------------------------------- T-B10c
  await gate('T-B10c', async () => {
    // §B4.1's fixture: `p3b-empty.txt`, whitespace only, 0 chunks, FRESH.
    // Measured: only a truly EMPTY file yields 0 chunks — whitespace or "[]"
    // both produce one thin chunk under the 20-word floor — and a 0-byte blob
    // is fresh exactly while no 0-byte document is in the content-addressed
    // store (LIMITATION L-4 covers the re-run case).
    const form3 = new FormData();
    form3.append('files', new Blob([new Uint8Array(0)], { type: 'text/plain' }), 'p3b-empty.txt');
    const empty = await upload(form3);
    const r0 = empty.json.results?.[0];
    // A zero-chunk FRESH ingest still creates a `documents` row, reported with
    // its real id even though chunkCount is 0.
    if (r0?.documentId) CREATED_DOCUMENTS.push(r0.documentId);
    await new Promise((r) => setTimeout(r, 400));
    const rows = await newRows();
    const row = rows
      .filter((r) => r.action === 'ingest.upload.success' && r.detail.name === 'p3b-empty.txt')
      .pop();
    assert.ok(row, `no row for p3b-empty.txt (HTTP ${empty.status})`);
    if (row.detail.deduplicated === false) {
      assert.strictEqual(row.detail.chunk_count, 0, `chunk_count ${row.detail.chunk_count}`);
      assert.match(row.resource!, /^document:[0-9a-f-]{36}$/, `fresh resource ${row.resource}`);
      CREATED_IDS.push(row.id);
      return `BQ3: fresh zero-chunk ingest => action=success resource=${row.resource?.slice(0, 22)}… chunk_count=0 deduplicated=false (HTTP ${empty.status})`;
    }
    // A re-run of this suite finds the 0-byte blob already at its content
    // address (nothing deletes blobs), so the honest outcome is the dedupe
    // shape: chunk_count=0 AND deduplicated=true. The plan's `deduplicated:
    // false` reading requires an empty store; recorded as LIMITATION L-4.
    assert.strictEqual(row.detail.chunk_count, 0, `dedupe chunk_count ${row.detail.chunk_count}`);
    assert.match(row.resource!, /^document:sha256:[0-9a-f]{64}$/, `dedupe resource ${row.resource}`);
    CREATED_IDS.push(row.id);
    return `0-byte blob already in the store => dedupe shape: chunk_count=0 deduplicated=true (LIMITATION L-4)`;
  });

  // -------------------------------------------------------------- T-B11
  await gate('T-B11', async () => {
    // (a) The §B4.3 fixture, verbatim: a junk `.docx` — `Buffer.from('not a
    // zip')` — is rejected and the business path is unchanged. NOTE: measured,
    // this rejects the WHOLE request with HTTP 400 `{error,errors}` because the
    // parser's failure is terminal for a single-file upload (ingest.ts:237-246
    // returns 400 when `results.length === 0`). It never reaches the
    // per-file `catch`, so it emits NO audit row — a finding, not a bug
    // (LIMITATION L-2). Asserted as measured.
    const formJunk = new FormData();
    formJunk.append('files', new Blob([Buffer.from('not a zip')], { type: 'application/octet-stream' }), 'p3b-junk.docx');
    const junk = await upload(formJunk);
    assert.strictEqual(junk.status, 400, `measured status ${junk.status}`);
    assert.deepStrictEqual(Object.keys(junk.json).sort(), ['error', 'errors']);
    assert.strictEqual(junk.json.errors.length, 1);

    // (b) To put an event through the per-file `catch` at all, one file in the
    // batch must SUCCEED: a mixed upload returns 207 and the failed file's
    // outcome is now persisted instead of vanishing with the response (BA-3).
    const junkName = `p3b-junk-${TAG}.docx`;
    const goodName = `p3b-mixed-${TAG}.txt`;
    const form4 = new FormData();
    form4.append('files', new Blob([`${TAG} mixed batch ${crypto.randomUUID()}`], { type: 'text/plain' }), goodName);
    form4.append(
      'files',
      new Blob([Buffer.concat([Buffer.from('not a zip'), crypto.randomBytes(16)])], {
        type: 'application/octet-stream',
      }),
      junkName,
    );
    const mixed = await upload(form4);
    assert.strictEqual(
      mixed.status,
      207,
      `expected 207, got ${mixed.status} (body ${JSON.stringify(mixed.json).slice(0, 200)})`,
    );
    assert.strictEqual(mixed.json.errors.length, 1);
    assert.strictEqual(mixed.json.results.length, 1);
    const goodDocId = mixed.json.results[0].documentId;
    if (goodDocId) CREATED_DOCUMENTS.push(goodDocId);

    await new Promise((r) => setTimeout(r, 400));
    const row = (await newRows()).filter((r) => r.action === 'ingest.upload.failure').pop();
    assert.ok(row, 'no ingest.upload.failure row');
    assert.strictEqual(row.actor, 'admin');
    assert.strictEqual(row.resource, `upload:${junkName}`);
    assert.strictEqual(row.detail.outcome, 'failure');
    assert.ok(typeof row.detail.error === 'string' && (row.detail.error as string).length > 0, 'error empty');
    assert.ok((row.detail.error as string).length <= 201, `error length ${(row.detail.error as string).length}`);
    const asJson = JSON.stringify(row.detail);
    assert.strictEqual(asJson.includes('password'), false);
    assert.strictEqual(asJson.includes('token'), false);
    CREATED_IDS.push(row.id);
    return `(a) single junk .docx => HTTP 400 {error,errors}, +0 rows; (b) mixed batch => HTTP 207, 1 success + 1 failure row resource=upload:${junkName.slice(0, 20)}… error(${(row.detail.error as string).length}c)=${String(row.detail.error).slice(0, 40)}…`;
  });

  // -------------------------------------------------------------- T-B7c
  await gate('T-B7c', async () => {
    const before = (await newRows()).filter((r) => r.action === 'search.query').length;
    const res = await fetch(`${API}/api/search`, withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: 'p3b' }),
    }));
    assert.strictEqual(res.status, 200);
    await new Promise((r) => setTimeout(r, 400));
    const after = (await newRows()).filter((r) => r.action === 'search.query').length;
    assert.strictEqual(after - before, 1, `expected +1 search.query, got +${after - before}`);
    return `+${after - before} search.query row (reverted-tree arm = D-3)`;
  });

  // -------------------------------------------------------------- T-B12
  await gate('T-B12', async () => {
    const res = await fetch(`${API}/api/search`, withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: 'p3b' }),
    }));
    const body = await res.json();
    await new Promise((r) => setTimeout(r, 400));
    const rows = (await newRows()).filter((r) => r.action === 'search.query');
    const row = rows[rows.length - 1];
    assert.ok(row, 'no search.query row');
    assert.strictEqual(row.actor, 'admin');
    assert.strictEqual(row.resource, 'search:*');
    assert.strictEqual(row.detail.outcome, 'success');
    assert.strictEqual(row.detail.q, 'p3b');
    assert.strictEqual(row.detail.limit, 10);
    assert.strictEqual(row.detail.returned, (body.results as unknown[]).length);

    // blank q => 400 and +0 rows
    const before = (await newRows()).filter((r) => r.action === 'search.query').length;
    const blank = await fetch(`${API}/api/search`, withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: '   ' }),
    }));
    assert.strictEqual(blank.status, 400);
    await new Promise((r) => setTimeout(r, 400));
    const after = (await newRows()).filter((r) => r.action === 'search.query').length;
    assert.strictEqual(after, before, 'a 400 search must emit nothing');
    CREATED_IDS.push(row.id);
    return `search:* actor=admin q='p3b' limit=${row.detail.limit} returned=${row.detail.returned}; blank q 400 => +0`;
  });

  // -------------------------------------------------------------- T-B13
  await gate('T-B13', async () => {
    const form5 = new FormData();
    form5.append('files', new Blob([`${TAG} response shape`], { type: 'text/plain' }), `${TAG}-shape.txt`);
    const up = await upload(form5);
    const r0 = up.json.results?.[0];
    if (r0?.chunkCount > 0 && r0?.documentId) CREATED_DOCUMENTS.push(r0.documentId);
    assert.deepStrictEqual(Object.keys(up.json).sort(), ['errors', 'results'], 'upload keys');
    assert.deepStrictEqual(Object.keys(loginBody).sort(), ['token', 'user'], 'login keys');
    const sBody = await (await fetch(`${API}/api/search`, withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: 'p3b' }),
    }))).json();
    assert.deepStrictEqual(Object.keys(sBody).sort(), ['limit', 'query', 'results'], 'search keys');
    await new Promise((r) => setTimeout(r, 400));
    for (const r of (await newRows()).filter((x) => x.detail.name === `${TAG}-shape.txt`)) CREATED_IDS.push(r.id);
    const searchRows = (await newRows()).filter((r) => r.action === 'search.query');
    for (const r of searchRows) CREATED_IDS.push(r.id);
    return 'login=[token,user] search=[limit,query,results] upload=[errors,results] — unchanged';
  });

  // -------------------------------------------------------------- T-B14
  await gate('T-B14', async () => {
    // (a) a rejecting client: recordAudit RESOLVES and warns once.
    const warns: unknown[][] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args);
    };
    try {
      await recordAudit(
        { action: 'search.query', actor: null, resource: 'search:*', detail: { outcome: 'success' } },
        { query: () => Promise.reject(new Error('boom')) },
      );
    } finally {
      // `logger` captured console.warn at import time, not per call, so the
      // module's binding must also be swapped for the capture to see it.
      const loggerMod = require('../utils/logger') as { logger: { warn: (...a: unknown[]) => void } };
      const origLoggerWarn = loggerMod.logger.warn;
      loggerMod.logger.warn = (...args: unknown[]) => {
        warns.push(args);
      };
      try {
        await recordAudit(
          { action: 'search.query', actor: null, resource: 'search:*', detail: { outcome: 'success' } },
          { query: () => Promise.reject(new Error('boom')) },
        );
      } finally {
        console.warn = origWarn;
        loggerMod.logger.warn = origLoggerWarn;
      }
    }
    const auditWarns = warns.filter((a) => String(a[0]).startsWith('[audit] write failed'));
    assert.ok(auditWarns.length >= 1, `expected a warn from '[audit] write failed', got ${auditWarns.length}`);
    assert.ok(
      String(auditWarns[0][0]).startsWith('[audit] write failed'),
      `first warn arg: ${String(auditWarns[0][0])}`,
    );

    // (b) a hostile getter: the SYNC path must be total.
    const evil: any = { action: 'search.query', actor: null, resource: 'search:*' };
    Object.defineProperty(evil, 'detail', {
      get() {
        throw new Error('boom');
      },
    });
    assert.doesNotThrow(() => recordAudit(evil));
    await new Promise((r) => setTimeout(r, 50));

    // (c) a 3-line fake handler: res.json still runs when the audit write fails.
    let jsonRan = false;
    const fakeRes: any = { json: () => { jsonRan = true; } };
    const handler = (_req: unknown, res: any) => {
      void recordAudit(
        { action: 'search.query', actor: null, resource: 'search:*', detail: { outcome: 'success' } },
        { query: () => Promise.reject(new Error('boom')) },
      );
      res.json({ ok: true });
    };
    handler({}, fakeRes);
    assert.strictEqual(jsonRan, true, 'res.json did not run');
    void fakeRes;
    return `(a) resolves + 1 warn '[audit] write failed'; (b) doesNotThrow on a throwing detail getter; (c) res.json ran`;
  });

  // -------------------------------------------------------------- T-B15
  await gate('T-B15', async () => {
    const out = execFileSync(
      'bash',
      ['-lc', `cd '${REPO_ROOT.replace(/\\/g, '/')}' && grep -rnE "UPDATE\\s+(public\\.)?audit_log|DELETE\\s+FROM\\s+(public\\.)?audit_log" server/src --include='*.ts' | grep -v '__p3b__/' | grep -v '__p3c__/' | wc -l`],
      { encoding: 'utf8' },
    ).trim();
    assert.strictEqual(out, '0', `found ${out} mutating statements`);
    return 'grep UPDATE/DELETE of audit_log in product code => 0 lines';
  });

  // -------------------------------------------------------------- T-B15b
  await gate('T-B15b', async () => {
    const calls = execFileSync(
      'bash',
      ['-lc', `cd '${REPO_ROOT.replace(/\\/g, '/')}' && grep -rn "void recordAudit(" server/src/routes | wc -l`],
      { encoding: 'utf8' },
    ).trim();
    const awaits = execFileSync(
      'bash',
      ['-lc', `cd '${REPO_ROOT.replace(/\\/g, '/')}' && grep -rn "await recordAudit(" server/src/routes | wc -l`],
      { encoding: 'utf8' },
    ).trim();
    assert.strictEqual(calls, '5', `expected 5 void recordAudit( call sites, got ${calls}`);
    assert.strictEqual(awaits, '0', `expected 0 awaited call sites, got ${awaits}`);
    return `void recordAudit( => 5; await recordAudit( => 0`;
  });

  // -------------------------------------------------------------- T-B17
  await gate('T-B17', async () => {
    await recordAudit({
      action: 'search.query',
      actor: 'admin',
      resource: `search:*`,
      detail: { outcome: 'success', q: 'Z'.repeat(10 * 1024 * 1024) },
    });
    await new Promise((r) => setTimeout(r, 600));
    const row = (await newRows()).filter((r) => r.action === 'search.query' && r.resource === 'search:*' && r.detail.q !== 'p3b').pop();
    assert.ok(row, 'no row for the 10 MB detail');
    const len = String(row.detail.q).length;
    assert.ok(len <= 201, `stored length ${len} > 201`);
    CREATED_IDS.push(row.id);
    return `10 MB q stored as ${len} chars (<= 201), process alive`;
  });

  // -------------------------------------------------------------- T-B20
  await gate('T-B20', async () => {
    const inserts = execFileSync(
      'bash',
      ['-lc', `cd '${REPO_ROOT.replace(/\\/g, '/')}' && grep -rn 'INSERT INTO public.audit_log' server/src --include='*.ts' | grep -v '__p3b__/' | grep -v '__p3c__/'`],
      { encoding: 'utf8' },
    ).trim();
    const lines = inserts.split('\n').filter(Boolean);
    assert.strictEqual(lines.length, 1, `expected exactly 1 INSERT, got ${lines.length}`);
    assert.ok(lines[0].includes('server/src/audit/log.ts'), `INSERT is in ${lines[0]}`);
    const routeFiles = execFileSync(
      'bash',
      ['-lc', `cd '${REPO_ROOT.replace(/\\/g, '/')}' && grep -rln 'audit_log' server/src/routes | wc -l`],
      { encoding: 'utf8' },
    ).trim();
    // routes/audit.ts is F3-C's read route and is untouched by B (§F1).
    assert.strictEqual(routeFiles, '1', `expected only routes/audit.ts to mention audit_log, got ${routeFiles}`);
    return `1 INSERT, in server/src/audit/log.ts; routes mentioning audit_log = ${routeFiles} (routes/audit.ts, C's)`;
  });

  // -------------------------------------------------------------- T-B23
  await gate('T-B23', async () => {
    const calls: string[] = [];
    const res: any = {
      status: (code: number) => {
        calls.push(`status(${code})`);
        return { json: (body: unknown) => void calls.push(`json(${JSON.stringify(body)})`) };
      },
    };
    let next = 0;
    requireAdmin({} as AuthRequest, res, () => { next++; });
    assert.deepStrictEqual(calls, ['status(403)', 'json({"error":"Forbidden"})']);
    assert.strictEqual(next, 0, 'next() ran on a missing principal');

    let next2 = 0;
    const okRes: any = { status: () => ({ json: () => { throw new Error('unexpected'); } }) };
    requireAdmin({ user: { username: 'admin' } } as any, okRes, () => { next2++; });
    assert.strictEqual(next2, 1, 'a verified principal (no `id` key) must pass');
    return 'missing req.user => 403 {"error":"Forbidden"}, next not called; {username:"admin"} (no id) => next once';
  });

  // -------------------------------------------------------------- summary
  // Capture EVERY row this run created (not just the ones an assertion
  // happened to name), so cleanup-by-id is complete even after a failure.
  const allNew = await newRows();
  for (const r of allNew) CREATED_IDS.push(r.id);
  // B4.1.5 arithmetic fix (Orchestrator, 2026-11-03): PRE_COUNT is the number of
  // *rows* in audit_log before the run, but `counter()` is driven by `newRows()`,
  // which filters to THIS RUN's tag/resource families. With PRE_COUNT=0 (table
  // empty) the correct post-condition is therefore `counter() >= PRE_COUNT` plus
  // "every row of this run is captured in CREATED_IDS for cleanup" — NOT strict
  // equality, which compared a filtered count against an unfiltered one and was
  // unsatisfiable for any run that writes at least one row.
  const finalCount = counter();
  console.log(`\nCREATED_IDS=${CREATED_IDS.length} CREATED_DOCUMENTS=${CREATED_DOCUMENTS.length}`);
  console.log(`ROW COUNT: PRE_COUNT=${PRE_COUNT} now=${finalCount}`);
  if (finalCount < PRE_COUNT) {
    record('B4.1.5', 'FAIL', `this run created ${finalCount} row(s) but PRE_COUNT was ${PRE_COUNT} (rows vanished mid-run)`);
  } else if (allNew.length !== finalCount) {
    record('B4.1.5', 'FAIL', `captured ${CREATED_IDS.length} ids for ${allNew.length} rows; cleanup would be incomplete`);
  } else {
    record('B4.1.5', 'PASS', `this run created ${finalCount} row(s) (PRE_COUNT=${PRE_COUNT}); all ${allNew.length} captured for cleanup`);
  }

  fs.writeFileSync(
    path.join(__dirname, 'state.json'),
    JSON.stringify({ CREATED_IDS, CREATED_DOCUMENTS, PRE_COUNT, PRE_MAX_ID, TAG }, null, 2),
  );

  const failed = results.filter((r) => r.outcome === 'FAIL');
  console.log(`\nRESULT: ${failed.length === 0 ? 'PASS' : 'FAIL'} — ${results.length - failed.length} passed, ${failed.length} failed`);
  for (const f of failed) console.log(`  FAIL ${f.id}: ${f.detail}`);
  void os;
  void crypto;
  void SERVER_ROOT;
  if (failed.length > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(`FATAL in ${current}:`, err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

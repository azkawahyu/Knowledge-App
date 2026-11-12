// F1 T06a — COMMIT throws BEFORE the real commit (plan §7.5 T6a; AC1/AC4).
// The patch rejects 'COMMIT' without calling the original. The post-COMMIT
// verification probe must run, find 0 rows, and the ORIGINAL error object must
// reach the caller; nothing may exist at the content address.
import * as path from 'path';
import { randomBytes, createHash } from 'crypto';

const fs: any = require('fs');
const SCHEMA = 'f1test';

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail: string = ''): void {
  if (cond) {
    passed++;
    console.log('PASS ' + name);
  } else {
    failed++;
    console.log('FAIL ' + name + ': ' + detail);
  }
}
function eq(name: string, got: unknown, want: unknown): void {
  ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}
function blocked(reason: string): never {
  console.log('BLOCKED: ' + reason);
  process.exit(2);
}
function msg(e: unknown): string {
  return e && typeof e === 'object' && 'message' in e ? String((e as any).message) : String(e);
}

const ROOT = process.env.F1_SCRATCH || path.join(process.env.TEMP || '.', 'f1-ingest-tests');
const DIR = path.join(ROOT, 't06a');
const UP = path.join(DIR, 'uploads');
const EX = path.join(DIR, 'extracts');

function sha(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}
function temps(): string[] {
  return fs.readdirSync(UP).filter((f: string) => f.startsWith('.ingest-tmp-'));
}
function blobs(): string[] {
  return fs.readdirSync(UP).filter((f: string) => !f.startsWith('.ingest-tmp-'));
}

async function main(): Promise<void> {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(UP, { recursive: true });
  fs.mkdirSync(EX, { recursive: true });

  if (!process.env.DATABASE_URL) blocked('DATABASE_URL must be set before the process starts');
  const { pool } = require('../../db');
  const { initSchema } = require('../../db/schema');
  let cs: any;
  try {
    cs = (await pool.query('SELECT current_schema()')).rows[0].current_schema;
  } catch (e) {
    blocked('DB unreachable: ' + msg(e));
  }
  if (cs !== SCHEMA) blocked('search_path guard: current_schema()=' + cs + ' expected ' + SCHEMA);
  try {
    await initSchema(pool);
  } catch (e) {
    blocked('initSchema failed: ' + msg(e));
  }
  const { createIngestionService } = require('../service');
  const svc = createIngestionService({ storageDir: UP, extractDir: EX });

  const bytes = Buffer.from('t06a ' + randomBytes(8).toString('hex') + ' ' + 'word '.repeat(40), 'utf8');
  const sha1 = sha(bytes);
  const src = path.join(DIR, 't06a.txt');
  fs.writeFileSync(src, bytes);

  // Count the verification probe's SELECT so we can assert it actually ran.
  const pg = require('pg');
  const origQ = pg.Client.prototype.query;
  let commitFired = 0;
  let probeSelects = 0;
  let rollbacks = 0;
  const injected = new Error('t06a injected COMMIT failure (before the real commit)');
  pg.Client.prototype.query = function (q: any, ...rest: any[]) {
    if (q === 'COMMIT' && commitFired === 0) {
      commitFired++;
      return Promise.reject(injected); // no original call => no real commit
    }
    if (typeof q === 'string' && q.includes('FROM documents WHERE id = $1')) probeSelects++;
    if (q === 'ROLLBACK') rollbacks++;
    return origQ.call(this, q, ...rest);
  };

  let thrown: unknown;
  try {
    await svc.ingestFile({ name: 't06a.txt', path: src, sizeBytes: bytes.length, kind: 'txt', accessPolicy: 'restricted' });
  } catch (e) {
    thrown = e;
  } finally {
    pg.Client.prototype.query = origQ;
  }

  ok('T6a: fault fired (anti-vacuity)', commitFired === 1, 'the COMMIT patch never ran');
  ok('T6a: ingestFile rejects', thrown !== undefined, 'it resolved');
  ok('T6a: the ORIGINAL COMMIT error object surfaced (===)', thrown === injected, 'a different error escaped: ' + msg(thrown));
  ok('T6a: the verification probe ran', probeSelects >= 1, 'the post-COMMIT SELECT never ran (probeSelects=0)');
  ok('T6a: no ROLLBACK error escaped (rollback attempted cleanly)', rollbacks >= 1, 'no ROLLBACK was attempted (rollbacks=' + rollbacks + ')');
  const rows = (await pool.query('SELECT id FROM documents WHERE sha256=$1', [sha1])).rows;
  eq('T6a: documents delta for the sha = 0', rows.length, 0);
  eq('T6a: no content address', blobs(), []);
  eq('T6a: no .ingest-tmp-*', temps(), []);

  await pool.end();
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log('FAIL harness: ' + msg(e));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
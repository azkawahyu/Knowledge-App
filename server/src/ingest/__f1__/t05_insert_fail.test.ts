// F1 T05 — INSERT INTO documents fails (plan §7.5 T5; AC1).
// Patched pg.Client.prototype.query throws once on the documents INSERT. The
// caller must see the original error, nothing may exist at the content address,
// no row may be committed, and the fault must be proven to have fired.
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
const DIR = path.join(ROOT, 't05');
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

  const bytes = Buffer.from('t05 ' + randomBytes(8).toString('hex') + ' ' + 'word '.repeat(40), 'utf8');
  const sha1 = sha(bytes);
  const src = path.join(DIR, 't05.txt');
  fs.writeFileSync(src, bytes);

  const pg = require('pg');
  const origQ = pg.Client.prototype.query;
  let fired = 0;
  const injected = new Error('t05 injected INSERT INTO documents failure');
  pg.Client.prototype.query = function (q: any, ...rest: any[]) {
    if (typeof q === 'string' && q.includes('INSERT INTO documents')) {
      if (fired === 0) {
        fired++;
        return Promise.reject(injected);
      }
    }
    return origQ.call(this, q, ...rest);
  };

  let thrown: unknown;
  try {
    await svc.ingestFile({ name: 't05.txt', path: src, sizeBytes: bytes.length, kind: 'txt', accessPolicy: 'restricted' });
  } catch (e) {
    thrown = e;
  } finally {
    pg.Client.prototype.query = origQ;
  }

  ok('T5: fault fired (anti-vacuity)', fired === 1, 'the injected INSERT throw never ran (fired=' + fired + ')');
  ok('T5: ingestFile rejects', thrown !== undefined, 'it resolved');
  ok('T5: the ORIGINAL error object surfaced (===)', thrown === injected, 'a different error escaped: ' + msg(thrown));
  eq('T5: 0 content-address blobs', blobs(), []);
  eq('T5: 0 .ingest-tmp-*', temps(), []);
  const rows = (await pool.query('SELECT id FROM documents WHERE sha256=$1', [sha1])).rows;
  eq('T5: 0 rows for the sha', rows.length, 0);

  await pool.end();
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log('FAIL harness: ' + msg(e));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
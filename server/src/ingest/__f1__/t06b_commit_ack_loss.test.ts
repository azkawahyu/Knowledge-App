// F1 T06b — COMMIT succeeds, the ack throws (phantom success) (§7.5 T6b; AC1/AC2).
// The patch awaits the REAL COMMIT then throws. The row exists, so the
// verification probe must find it, storeDocument must return the id, and
// ingestFile must still rename the blob into place and resolve.
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
const DIR = path.join(ROOT, 't06b');
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

  const bytes = Buffer.from('t06b ' + randomBytes(8).toString('hex') + ' ' + 'word '.repeat(40), 'utf8');
  const sha1 = sha(bytes);
  const src = path.join(DIR, 't06b.txt');
  fs.writeFileSync(src, bytes);

  const pg = require('pg');
  const origQ = pg.Client.prototype.query;
  let fired = 0;
  let probeSelects = 0;
  const mine = 't06b ack lost after a real commit';
  pg.Client.prototype.query = function (q: any, ...rest: any[]) {
    if (q === 'COMMIT') {
      if (fired === 0) {
        fired++; // set BEFORE the real call: re-entry cannot double-arm
        return origQ.call(this, q, ...rest).then(() => {
          throw new Error(mine);
        });
      }
    }
    if (typeof q === 'string' && q.includes('FROM documents WHERE id = $1')) probeSelects++;
    return origQ.call(this, q, ...rest);
  };

  let res: any;
  let thrown: unknown;
  try {
    res = await svc.ingestFile({ name: 't06b.txt', path: src, sizeBytes: bytes.length, kind: 'txt', accessPolicy: 'restricted' });
  } catch (e) {
    thrown = e;
  } finally {
    pg.Client.prototype.query = origQ;
  }

  ok('T6b: fault fired (anti-vacuity)', fired === 1, 'the COMMIT patch never ran');
  ok('T6b: ingestFile RESOLVES (phantom success treated as committed)', thrown === undefined, 'it rejected with: ' + msg(thrown));
  ok('T6b: the verification probe ran', probeSelects >= 1, 'the post-COMMIT SELECT never ran');
  ok('T6b: a real UUID documentId was returned', res && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(res.documentId), 'documentId=' + (res ? res.documentId : null));

  const rows = (await pool.query('SELECT id, source_path FROM documents WHERE sha256=$1', [sha1])).rows;
  eq('T6b: exactly 1 row for the sha', rows.length, 1);
  eq('T6b: the returned id is that row', rows.length === 1 && res ? res.documentId : null, rows.length === 1 ? rows[0].id : null);

  const addr = path.join(UP, sha1 + '.txt');
  ok('T6b: blob present at the content address', fs.existsSync(addr), 'missing ' + addr);
  if (fs.existsSync(addr)) {
    eq('T6b: sha256 of the blob === its filename prefix', sha(fs.readFileSync(addr)), sha1);
  } else {
    ok('T6b: sha256 of the blob === its filename prefix', false, 'blob absent');
  }
  eq('T6b: 0 .ingest-tmp-* left', temps().length, 0);
  ok('T6b: extract present', fs.existsSync(path.join(EX, sha1 + '.txt')), 'extract missing');
  eq('T6b: exactly one blob in uploads/', blobs().length, 1);

  await pool.end();
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log('FAIL harness: ' + msg(e));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
// F1 T11 — duplicate ingestion, contract unchanged (§7.5 T11; AC5, records O9).
// Phase A: the same .txt twice => the 2nd resolves chunkCount 0 with documentId
//          === <sha> and no new row.
// Phase B: the §7.4 rename-failure primitive (no §7.5 row of its own, but R10
//          requires the renameAttempted predicate to be pinned): fs.renameSync
//          -> EPERM must leave the row committed, NO blob at the content
//          address, and the temp PRESERVED (it is the only copy of the bytes).
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
const DIR = path.join(ROOT, 't11');
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

  // ================= PHASE A: duplicate ingestion ==========================
  const bytes = Buffer.from('t11 dup ' + randomBytes(8).toString('hex') + ' ' + 'word '.repeat(40), 'utf8');
  const sha1 = sha(bytes);
  const src = path.join(DIR, 't11.txt');
  fs.writeFileSync(src, bytes);

  const r1 = await svc.ingestFile({ name: 't11.txt', path: src, sizeBytes: bytes.length, kind: 'txt', accessPolicy: 'restricted' });
  ok('T11a: first ingest creates chunks', r1.chunkCount >= 1, 'chunkCount=' + r1.chunkCount);
  const rows1 = (await pool.query('SELECT id FROM documents WHERE sha256=$1', [sha1])).rows;
  eq('T11a: 1 row after the first ingest', rows1.length, 1);

  const r2 = await svc.ingestFile({ name: 't11.txt', path: src, sizeBytes: bytes.length, kind: 'txt', accessPolicy: 'restricted' });
  eq('T11a: 2nd resolves chunkCount 0 (dedupe branch)', r2.chunkCount, 0);
  eq('T11a: 2nd documentId is the sha, not a UUID (O9, contract unchanged)', r2.documentId, sha1);
  eq('T11a: 2nd contentHash is the sha', r2.contentHash, sha1);
  const rows2 = (await pool.query('SELECT id FROM documents WHERE sha256=$1', [sha1])).rows;
  eq('T11a: documents delta = 0', rows2.length, rows1.length);
  eq('T11a: 0 .ingest-tmp-* after both ingests', temps().length, 0);

  // ================= PHASE B: rename failure ==============================
  const b2 = Buffer.from('t11 rename ' + randomBytes(8).toString('hex') + ' ' + 'word '.repeat(40), 'utf8');
  const sha2 = sha(b2);
  const src2 = path.join(DIR, 't11b.txt');
  fs.writeFileSync(src2, b2);

  const origRename = fs.renameSync;
  let fired = 0;
  const injected: any = new Error('EPERM: operation not permitted (injected)');
  injected.code = 'EPERM';
  fs.renameSync = function (a: any, b: any) {
    if (typeof a === 'string' && path.basename(a).startsWith('.ingest-tmp-')) {
      fired++;
      throw injected;
    }
    return origRename.call(fs, a, b);
  };
  let thrown: unknown;
  try {
    await svc.ingestFile({ name: 't11b.txt', path: src2, sizeBytes: b2.length, kind: 'txt', accessPolicy: 'restricted' });
  } catch (e) {
    thrown = e;
  } finally {
    fs.renameSync = origRename;
  }

  ok('T11b: the injected rename fault fired (anti-vacuity)', fired === 1, 'renameSync never saw a .ingest-tmp- source (fired=' + fired + ')');
  ok('T11b: ingestFile rejects', thrown !== undefined, 'it resolved');
  ok('T11b: the ORIGINAL rename error object surfaced (===)', thrown === injected, 'a different error escaped: ' + msg(thrown));
  const rowsB = (await pool.query('SELECT id FROM documents WHERE sha256=$1', [sha2])).rows;
  eq('T11b: the row WAS committed (dangling row, §5.2b)', rowsB.length, 1);
  eq('T11b: no <sha2>.txt at the content address', fs.existsSync(path.join(UP, sha2 + '.txt')), false);

  const t = temps();
  eq('T11b: exactly one .ingest-tmp-* preserved', t.length, 1);
  ok(
    'T11b: the preserved temp holds the committed document bytes',
    t.length === 1 && sha(fs.readFileSync(path.join(UP, t[0]))) === sha2,
    'temps=' + JSON.stringify(t),
  );
  ok('T11b: the preserved temp name is a legal temp (prefix + ext)', t.length === 1 && t[0].startsWith('.ingest-tmp-') && t[0].endsWith('.txt'), 'temp=' + JSON.stringify(t));
  eq('T11b: no extract written', fs.existsSync(path.join(EX, sha2 + '.txt')), false);

  // Remove the deliberately preserved temp (scratch dir only, §7.2 permits).
  const realRm = require('fs').rmSync;
  for (const f of temps()) realRm(path.join(UP, f), { force: true });
  eq('T11b: temp removed after asserting', temps().length, 0);

  await pool.end();
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log('FAIL harness: ' + msg(e));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
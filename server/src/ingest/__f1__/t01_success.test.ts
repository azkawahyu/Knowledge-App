// F1 T01 — success path (plan §7.5 T1; guard for AC2).
// Plain tsx script: no framework, no installs. Run one process per file.
// Isolation: DB = f1test schema (DATABASE_URL + options set BEFORE this process
// started); FS = scratch dirs under F1_SCRATCH. Nothing under server/data.
import * as path from 'path';
import { randomBytes, createHash } from 'crypto';

const fs: any = require('fs'); // the real module object, so patches take effect
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
const DIR = path.join(ROOT, 't01');
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
  fs.rmSync(DIR, { recursive: true, force: true }); // scratch only
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
  const t = await pool.query(
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name='documents'",
    [SCHEMA],
  );
  if (t.rows[0].n !== 1) blocked('bootstrap check: ' + SCHEMA + '.documents missing');
  if (!(await pool.query("SELECT to_regclass('documents') AS r")).rows[0].r) blocked("to_regclass('documents') IS NULL");

  const { createIngestionService } = require('../service');
  const svc = createIngestionService({ storageDir: UP, extractDir: EX });

  const body = 't01 ' + randomBytes(8).toString('hex') + ' ' + Array.from({ length: 40 }, (_, i) => 'word' + i).join(' ');
  const bytes = Buffer.from(body, 'utf8');
  const sha1 = sha(bytes);
  const src = path.join(DIR, 't01.txt');
  fs.writeFileSync(src, bytes);

  const before = blobs();
  const res = await svc.ingestFile({ name: 't01.txt', path: src, sizeBytes: bytes.length, kind: 'txt', accessPolicy: 'restricted' });

  const blobPath = path.join(UP, sha1 + '.txt');
  ok('T1: chunkCount > 0', res.chunkCount > 0, 'chunkCount=' + res.chunkCount);
  eq('T1: contentHash is the sha256 of the bytes', res.contentHash, sha1);
  ok('T1: documentId is a real UUID', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(res.documentId), 'documentId=' + res.documentId);
  ok('T1: exactly one blob at <sha>.txt', fs.existsSync(blobPath) && blobs().length === before.length + 1, 'blobs=' + JSON.stringify(blobs()));
  eq('T1: blob bytes equal the source bytes', sha(fs.readFileSync(blobPath)), sha1);

  const rows = (await pool.query('SELECT id, sha256, source_path FROM documents WHERE sha256=$1', [sha1])).rows;
  eq('T1: exactly 1 documents row for the sha', rows.length, 1);
  eq('T1: row.sha256 matches', rows.length === 1 ? rows[0].sha256 : null, sha1);
  eq('T1: row.source_path is the content address', rows.length === 1 ? rows[0].source_path : null, blobPath);
  ok('T1: source_path -f true', rows.length === 1 ? fs.statSync(rows[0].source_path).isFile() : false, 'source_path missing on disk');

  const ch = (await pool.query('SELECT count(*)::int AS n FROM chunks WHERE document_id=$1', [rows[0].id])).rows[0].n;
  ok('T1: at least 1 chunk row', ch >= 1, 'chunks=' + ch);
  eq('T1: chunkCount === chunk rows', res.chunkCount, ch);
  ok('T1: extract present', fs.existsSync(path.join(EX, sha1 + '.txt')), 'extract missing');
  eq('T1: 0 .ingest-tmp-* left', temps().length, 0);

  await pool.end();
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log('FAIL harness: ' + msg(e));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
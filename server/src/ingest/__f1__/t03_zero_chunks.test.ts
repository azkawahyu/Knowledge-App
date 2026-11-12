// F1 T03 — zero chunks is not an orphan (plan §7.5 T3; guard for AC3).
// An empty .txt parses to 0 chunks and still commits 1 row; the blob must stay
// at the content address (the fix must never delete a referenced blob).
import * as path from 'path';
import { createHash } from 'crypto';

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
const DIR = path.join(ROOT, 't03');
const UP = path.join(DIR, 'uploads');
const EX = path.join(DIR, 'extracts');

function sha(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}
function temps(): string[] {
  return fs.readdirSync(UP).filter((f: string) => f.startsWith('.ingest-tmp-'));
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

  // An empty file is byte-identical to every empty file, so a re-run would hit
  // dedupe. Use whitespace-only content instead: still 0 chunks, but unique.
  const bytes = Buffer.from(' \n\t\r\n ', 'utf8');
  const sha1 = sha(bytes);
  const src = path.join(DIR, 't03.txt');
  fs.writeFileSync(src, bytes);

  const res = await svc.ingestFile({ name: 't03.txt', path: src, sizeBytes: bytes.length, kind: 'txt', accessPolicy: 'restricted' });
  eq('T3: resolves with chunkCount 0', res.chunkCount, 0);
  ok('T3: documentId is a real UUID (row committed, not the sha)', /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(res.documentId), 'documentId=' + res.documentId);

  // Scoped by the row THIS run created (the fixture bytes are constant, so the
  // sha accumulates one row per run — assertions are deltas, never absolutes).
  const rows = (await pool.query('SELECT id, source_path FROM documents WHERE id=$1 AND sha256=$2', [res.documentId, sha1])).rows;
  eq('T3: this run committed exactly 1 row for its id + sha', rows.length, 1);
  const ch = rows.length === 1 ? (await pool.query('SELECT count(*)::int AS n FROM chunks WHERE document_id=$1', [rows[0].id])).rows[0].n : -1;
  eq('T3: that row has 0 chunks', ch, 0);

  const blobPath = path.join(UP, sha1 + '.txt');
  ok('T3: blob present at the content address', fs.existsSync(blobPath), 'missing ' + blobPath);
  ok('T3: blob is referenced by the row', rows.length === 1 ? rows[0].source_path === blobPath : false, 'source_path=' + (rows.length === 1 ? rows[0].source_path : null));
  ok('T3: blob is non-empty', fs.existsSync(blobPath) && fs.statSync(blobPath).size === bytes.length, 'size mismatch');
  eq('T3: 0 .ingest-tmp-* left', temps().length, 0);

  await pool.end();
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log('FAIL harness: ' + msg(e));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
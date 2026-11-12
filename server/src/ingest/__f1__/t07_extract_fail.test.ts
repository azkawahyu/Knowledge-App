// F1 T07 — extract-write failure, S5 shape preserved (§7.5 T7; AC2/AC4).
// extracts/<sha>.txt pre-created as a DIRECTORY => fs.writeFileSync throws EISDIR.
// The row and its chunks are committed and the blob sits at the content address,
// because the rename (step 6) precedes the extract write (step 7).
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
const DIR = path.join(ROOT, 't07');
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

  const bytes = Buffer.from('t07 ' + randomBytes(8).toString('hex') + ' ' + 'word '.repeat(40), 'utf8');
  const sha1 = sha(bytes);
  const src = path.join(DIR, 't07.txt');
  fs.writeFileSync(src, bytes);

  // Inject: the extract target is a directory => EISDIR.
  const extractTarget = path.join(EX, sha1 + '.txt');
  fs.mkdirSync(extractTarget, { recursive: true });
  ok('T7: extract target is a directory (fault armed)', fs.statSync(extractTarget).isDirectory(), 'mkdir failed');

  let thrown: unknown;
  try {
    await svc.ingestFile({ name: 't07.txt', path: src, sizeBytes: bytes.length, kind: 'txt', accessPolicy: 'restricted' });
  } catch (e) {
    thrown = e;
  }

  ok('T7: rejects with EISDIR', thrown !== undefined && (thrown as any).code === 'EISDIR', 'code=' + (thrown === undefined ? 'no throw' : String((thrown as any).code)) + ' message=' + msg(thrown));
  const rows = (await pool.query('SELECT id, source_path FROM documents WHERE sha256=$1', [sha1])).rows;
  eq('T7: the row WAS committed (1 row for the sha)', rows.length, 1);
  const chN = rows.length === 1 ? (await pool.query('SELECT count(*)::int AS n FROM chunks WHERE document_id=$1', [rows[0].id])).rows[0].n : -1;
  ok('T7: its chunks were committed', chN >= 1, 'chunks=' + chN);
  const addr = path.join(UP, sha1 + '.txt');
  ok('T7: blob present at the content address (rename preceded the extract)', fs.existsSync(addr), 'missing ' + addr);
  ok('T7: row.source_path -f true', rows.length === 1 ? fs.statSync(rows[0].source_path).isFile() : false, 'source_path');
  eq('T7: 0 .ingest-tmp-* left', temps().length, 0);
  eq('T7: exactly one blob in uploads/', blobs().length, 1);

  await pool.end();
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log('FAIL harness: ' + msg(e));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
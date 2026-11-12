// F1 T09 — idempotency (§7.5 T9).
// (a) The exact cleanup primitive — rmSync(absent, {force:true}) — is silent
//     twice in a row. (b) fail-then-retry: the same bytes that failed as .docx
//     ingest fully once presented as .txt (dedupe miss, one row, one blob).
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
const DIR = path.join(ROOT, 't09');
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

  // ---- (a) guard: the primitive itself is idempotent
  const absent = path.join(UP, '.ingest-tmp-999999-doesnotexist.txt');
  let a1 = 'threw';
  let a2 = 'threw';
  try {
    fs.rmSync(absent, { force: true });
    a1 = 'silent';
  } catch (e) {
    a1 = 'threw: ' + msg(e);
  }
  try {
    fs.rmSync(absent, { force: true });
    a2 = 'silent';
  } catch (e) {
    a2 = 'threw: ' + msg(e);
  }
  eq('T9a: first rmSync(absent,{force:true}) is silent', a1, 'silent');
  eq('T9a: second rmSync(absent,{force:true}) is silent', a2, 'silent');

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

  // ---- (b) fail then retry with the SAME bytes
  const bytes = Buffer.concat([Buffer.from('t09 retryable ' + randomBytes(8).toString('hex') + ' '), Buffer.from('word '.repeat(40))]);
  const sha1 = sha(bytes);
  const srcDocx = path.join(DIR, 't09.docx');
  fs.writeFileSync(srcDocx, bytes);

  let firstErr: unknown;
  try {
    await svc.ingestFile({ name: 't09.docx', path: srcDocx, sizeBytes: bytes.length, kind: 'docx', accessPolicy: 'restricted' });
  } catch (e) {
    firstErr = e;
  }
  ok('T9b: first attempt fails', firstErr !== undefined, 'it resolved');
  eq('T9b: no content address after the failure', blobs(), []);
  eq('T9b: 0 .ingest-tmp-* after the failure', temps().length, 0);

  const srcTxt = path.join(DIR, 't09.txt');
  fs.writeFileSync(srcTxt, bytes);
  eq('T9b: retry bytes hash identically', sha(fs.readFileSync(srcTxt)), sha1);
  const res = await svc.ingestFile({ name: 't09.txt', path: srcTxt, sizeBytes: bytes.length, kind: 'txt', accessPolicy: 'restricted' });
  ok('T9b: retry resolves (dedupe miss => full ingest)', res.chunkCount > 0, 'chunkCount=' + res.chunkCount);
  const rows = (await pool.query('SELECT id, source_path FROM documents WHERE sha256=$1', [sha1])).rows;
  eq('T9b: exactly 1 row', rows.length, 1);
  eq('T9b: exactly 1 blob', blobs().length, 1);
  ok('T9b: that blob is <sha>.txt', fs.existsSync(path.join(UP, sha1 + '.txt')), 'missing blob');
  ok('T9b: source_path -f true', rows.length === 1 ? fs.statSync(rows[0].source_path).isFile() : false, 'source_path');
  eq('T9b: no residue (.ingest-tmp-*)', temps().length, 0);

  await pool.end();
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log('FAIL harness: ' + msg(e));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
// F1 T10 — shared-blob safety, concrete (§7.5 T10; guard for AC3).
// Ingest bytes X as p.txt (commits <shaX>.txt + row). Then ingest the SAME bytes
// X as p.docx, where parse throws. The .txt blob and its row must survive and no
// <shaX>.docx may appear. Label: a guard against a revert to option (A) — the
// pre-fix code also never unlinked, so this cannot prove (B) by itself.
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
const DIR = path.join(ROOT, 't10');
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

  // X: valid UTF-8 text, and NOT a zip => the .docx parse throws.
  const X = Buffer.from('t10 shared ' + randomBytes(8).toString('hex') + ' ' + 'word '.repeat(40), 'utf8');
  const shaX = sha(X);

  // ---- 1. X as .txt: commits <shaX>.txt + row
  const pTxt = path.join(DIR, 'p.txt');
  fs.writeFileSync(pTxt, X);
  const r1 = await svc.ingestFile({ name: 'p.txt', path: pTxt, sizeBytes: X.length, kind: 'txt', accessPolicy: 'restricted' });
  const addrTxt = path.join(UP, shaX + '.txt');
  ok('T10: first ingest resolves with chunks', r1.chunkCount >= 1, 'chunkCount=' + r1.chunkCount);
  ok('T10: <shaX>.txt exists', fs.existsSync(addrTxt), 'missing ' + addrTxt);
  const beforeRows = (await pool.query('SELECT id, source_path FROM documents WHERE sha256=$1', [shaX])).rows;
  eq('T10: 1 row for shaX', beforeRows.length, 1);
  const chunksBefore = beforeRows.length === 1 ? (await pool.query('SELECT count(*)::int AS n FROM chunks WHERE document_id=$1', [beforeRows[0].id])).rows[0].n : -1;

  // ---- 2. the SAME bytes X as .docx: parse throws
  const pDocx = path.join(DIR, 'p.docx');
  fs.writeFileSync(pDocx, X);
  eq('T10: both paths hold identical bytes', sha(fs.readFileSync(pDocx)), shaX);
  let err2: unknown;
  try {
    await svc.ingestFile({ name: 'p.docx', path: pDocx, sizeBytes: X.length, kind: 'docx', accessPolicy: 'restricted' });
  } catch (e) {
    err2 = e;
  }
  ok('T10: the second call rejects', err2 !== undefined, 'it resolved');
  ok('T10: it rejects with the ADM-ZIP message', msg(err2).includes('ADM-ZIP'), 'message=' + JSON.stringify(msg(err2)));

  // ---- 3. the shared blob and its row are untouched
  ok('T10: <shaX>.txt still present', fs.existsSync(addrTxt), 'the referenced blob was deleted');
  const afterRows = (await pool.query('SELECT id, source_path FROM documents WHERE sha256=$1', [shaX])).rows;
  eq('T10: still exactly 1 row for shaX', afterRows.length, 1);
  eq('T10: same source_path as before', afterRows.length === 1 ? afterRows[0].source_path : null, beforeRows.length === 1 ? beforeRows[0].source_path : null);
  ok('T10: source_path -f true', afterRows.length === 1 ? fs.statSync(afterRows[0].source_path).isFile() : false, 'source_path missing');
  const chunksAfter = afterRows.length === 1 ? (await pool.query('SELECT count(*)::int AS n FROM chunks WHERE document_id=$1', [afterRows[0].id])).rows[0].n : -2;
  eq('T10: chunks unchanged', chunksAfter, chunksBefore);

  eq('T10: no <shaX>.docx was created', fs.existsSync(path.join(UP, shaX + '.docx')), false);
  eq('T10: 0 .ingest-tmp-* left', temps().length, 0);
  eq('T10: uploads/ holds only <shaX>.txt', blobs(), [shaX + '.txt']);

  await pool.end();
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log('FAIL harness: ' + msg(e));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
// F1 T12 — concurrent identical ingests, both succeed (§7.5 T12; guard for AC3).
// Two ingestFile calls on the SAME bytes under Promise.allSettled: exactly one
// content-address blob, <= 2 rows (UNIQUE is absent), every row's source_path
// resolves on disk, 0 temps. Note (recorded, not hidden): when both callers miss
// dedupe BOTH resolve and both keep their rows sharing one blob — the
// loser-error branch of T13 is what exercises the unlink path.
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
const DIR = path.join(ROOT, 't12');
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

  const bytes = Buffer.from('t12 concurrent ' + randomBytes(8).toString('hex') + ' ' + 'word '.repeat(40), 'utf8');
  const shaX = sha(bytes);
  const src = path.join(DIR, 't12.txt');
  fs.writeFileSync(src, bytes);

  const call = () =>
    svc.ingestFile({ name: 't12.txt', path: src, sizeBytes: bytes.length, kind: 'txt', accessPolicy: 'restricted' });
  const settled = await Promise.allSettled([call(), call()]);
  const statuses = settled.map((s: any) => s.status);
  console.log('INFO T12: settlement statuses = ' + JSON.stringify(statuses));

  // Deliberately NOT asserting "the loser errored": see the header note.
  ok(
    'T12: at least one caller succeeded',
    statuses.filter((s: string) => s === 'fulfilled').length >= 1,
    'statuses=' + JSON.stringify(statuses),
  );
  eq('T12: exactly one content-address blob', blobs(), [shaX + '.txt']);
  ok('T12: the blob hashes to its name', fs.existsSync(path.join(UP, shaX + '.txt')) && sha(fs.readFileSync(path.join(UP, shaX + '.txt'))) === shaX, 'blob missing or wrong content');

  const rows = (await pool.query('SELECT id, source_path FROM documents WHERE sha256=$1', [shaX])).rows;
  ok('T12: 1 or 2 rows (<= 2)', rows.length >= 1 && rows.length <= 2, 'rows=' + rows.length);
  ok(
    'T12: every row source_path exists on disk',
    rows.every((r: any) => { try { return fs.statSync(r.source_path).isFile(); } catch { return false; } }),
    'source_paths=' + JSON.stringify(rows.map((r: any) => r.source_path)),
  );
  eq('T12: 0 .ingest-tmp-* left', temps().length, 0);

  await pool.end();
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log('FAIL harness: ' + msg(e));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
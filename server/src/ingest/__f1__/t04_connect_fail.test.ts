// F1 T04 — DB connect failure, OWN PROCESS (plan §7.5 T4; AC1/AC7).
// This file is only ever run with DATABASE_URL pointing at a closed port, so the
// pool built at import can never touch the user's database. It proves the
// failure class leaves no content-address blob and no temp — the pre-fix code
// wrote <sha><ext> at step 3 and left it there.
import * as path from 'path';
import { randomBytes, createHash } from 'crypto';

const fs: any = require('fs');

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
function msg(e: unknown): string {
  return e && typeof e === 'object' && 'message' in e ? String((e as any).message) : String(e);
}

const ROOT = process.env.F1_SCRATCH || path.join(process.env.TEMP || '.', 'f1-ingest-tests');
const DIR = path.join(ROOT, 't04');
const UP = path.join(DIR, 'uploads');
const EX = path.join(DIR, 'extracts');

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

  const url = process.env.DATABASE_URL || '';
  // Guard the process model: this file must not be run against a live DB.
  if (!/:\/\/[^/]*:1\//.test(url) && !/:1(\/|$|\?)/.test(url)) {
    console.log('BLOCKED: T04 must be run with its own DATABASE_URL at a closed port (127.0.0.1:1); got host/port not :1');
    process.exit(2);
  }
  const { createIngestionService } = require('../service');
  const svc = createIngestionService({ storageDir: UP, extractDir: EX });

  const bytes = Buffer.from('t04 connect-failure fixture ' + randomBytes(8).toString('hex') + ' ' + 'padding '.repeat(10), 'utf8');
  const src = path.join(DIR, 't04.txt');
  fs.writeFileSync(src, bytes);

  let thrown: unknown;
  try {
    await svc.ingestFile({ name: 't04.txt', path: src, sizeBytes: bytes.length, kind: 'txt', accessPolicy: 'restricted' });
  } catch (e) {
    thrown = e;
  }
  ok('T4: ingestFile rejects on a dead DB', thrown !== undefined, 'it resolved');
  ok(
    'T4: the rejection is a connection error',
    thrown !== undefined && /ECONNREFUSED|connect|timeout/i.test(msg(thrown)),
    'message=' + JSON.stringify(thrown === undefined ? null : msg(thrown)),
  );
  eq('T4: 0 content-address blobs', blobs(), []);
  eq('T4: 0 .ingest-tmp-*', temps(), []);

  // No live connection was ever made to the user's DB: the only configured
  // target is the closed port we started with.
  ok('T4: DATABASE_URL is still the closed-port URL', /:1(\/|$|\?)/.test(process.env.DATABASE_URL || ''), 'DATABASE_URL changed');

  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  // No pool.end(): the pool lives in ../../db and refused every connection.
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log('FAIL harness: ' + msg(e));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
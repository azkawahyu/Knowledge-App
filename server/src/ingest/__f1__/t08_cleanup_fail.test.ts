// F1 T08 — a failing cleanup must not mask the original error (§7.5 T8; AC4).
// Control run of the same junk .docx, then the run with fs.rmSync patched to
// EPERM. The caller must see the same error object type/message, no content
// address, exactly ONE .ingest-tmp-* (the suppressed cleanup), and a warn.
import * as path from 'path';
import { randomBytes } from 'crypto';

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
const DIR = path.join(ROOT, 't08');
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

  function junk(name: string): { p: string; n: number } {
    const b = Buffer.concat([Buffer.from('t08 junk, not a zip '), randomBytes(16)]);
    const p = path.join(DIR, name);
    fs.writeFileSync(p, b);
    return { p, n: b.length };
  }

  // ---- control: real cleanup path, no patch
  const c = junk('t08_control.docx');
  let controlErr: any;
  try {
    await svc.ingestFile({ name: 't08_control.docx', path: c.p, sizeBytes: c.n, kind: 'docx', accessPolicy: 'restricted' });
  } catch (e) {
    controlErr = e;
  }
  const controlMsg = msg(controlErr);
  ok('T8: control run rejects', controlErr !== undefined, 'control resolved');
  ok('T8: control message is the ADM-ZIP message', controlMsg.includes('ADM-ZIP'), 'control message=' + JSON.stringify(controlMsg));
  eq('T8: control left 0 .ingest-tmp-* (cleanup works when not patched)', temps().length, 0);

  // ---- patched: fs.rmSync throws EPERM for anything named .ingest-tmp-*, and
  //      the logger sink is patched so the warn is observable.
  const origRm = fs.rmSync;
  let rmCalls = 0;
  fs.rmSync = function (p: any, o: any) {
    if (typeof p === 'string' && path.basename(p).startsWith('.ingest-tmp-')) {
      rmCalls++;
      const e: any = new Error('EPERM: operation not permitted (injected)');
      e.code = 'EPERM';
      throw e;
    }
    return origRm.call(fs, p, o);
  };
  const { logger } = require('../../utils/logger');
  const origWarn = logger.warn;
  const warns: any[] = [];
  logger.warn = function (m: string, o?: any) {
    warns.push({ m, o });
  };

  const p2 = junk('t08_patched.docx');
  let patchedErr: any;
  try {
    await svc.ingestFile({ name: 't08_patched.docx', path: p2.p, sizeBytes: p2.n, kind: 'docx', accessPolicy: 'restricted' });
  } catch (e) {
    patchedErr = e;
  } finally {
    fs.rmSync = origRm;
    logger.warn = origWarn;
  }

  ok('T8: the injected cleanup fault fired (anti-vacuity)', rmCalls === 1, 'rmSync was never called with a .ingest-tmp- path (rmCalls=' + rmCalls + ')');
  ok('T8: the caller still gets an error', patchedErr !== undefined, 'patched run resolved');
  eq('T8: message is byte-identical to the control run', msg(patchedErr), controlMsg);
  ok('T8: the error is the same kind of object (both plain Error, no code)', patchedErr && controlErr && (patchedErr as any).code === (controlErr as any).code, 'codes differ');
  eq('T8: no content address', blobs(), []);
  eq('T8: exactly ONE .ingest-tmp-* left (the suppressed cleanup)', temps().length, 1);
  ok(
    'T8: a logger.warn was emitted',
    warns.some((w) => String(w.m).includes('temp blob cleanup failed')),
    'warns=' + JSON.stringify(warns.map((w) => w.m)),
  );

  // Remove the deliberately-left temp so later "0 temps" assertions stay true.
  // (Inside the scratch dir, which §7.2 permits.)
  for (const f of temps()) origRm.call(fs, path.join(UP, f), { force: true });
  eq('T8: temp removed after asserting', temps().length, 0);

  await pool.end();
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log('FAIL harness: ' + msg(e));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
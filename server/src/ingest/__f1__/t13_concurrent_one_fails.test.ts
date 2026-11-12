// F1 T13 — CONCURRENCY GUARD (relabelled post-PASS; no behaviour change).
// READ THIS BEFORE TRUSTING IT AS MUTATION EVIDENCE:
// the fault is a patched `pg.Client.prototype.query` (the FIRST `INSERT INTO
// documents` is rejected, the SECOND caller's COMMIT is parked), so the
// interleaving is *forced*, not observed. Both the pre-fix code (A: write
// directly to the content address, unlink on failure) and the delivered code
// (B: temp + rename after COMMIT) already satisfy these assertions under this
// patch. It therefore does NOT discriminate A from B — the Test Engineer's
// real-PostgreSQL-trigger probe (`verify/seam-delivered.txt`) is what proves
// that, and the §7.5 T13 A/B discrimination remains a Test-Engineer seam proof.
// What this file guarantees instead: if the concurrency handling regresses,
// this test fails loudly rather than hanging (watchdog + fail-closed gate).
// The scenario it guards:
//   (A) "write to the address, unlink on failure": a real loser's unlink could
//        remove the winner's blob => the winner's source_path is missing.
//   (B) temp + rename after COMMIT: the loser removes only its own temp.
//   (C) a parse failure shared with a concurrent caller must leave the
//        committed row/blob intact (vacuity guard, §8.3 of the test report).
//
// WHAT WOULD MAKE THIS AN (A)-DISCRIMINATOR (not done here — out of scope):
// assert on the CLEANUP TARGET rather than on the surviving file. Capture every
// path passed to `fs.rmSync` and assert that none of them equals the winner's
// committed storagePath (`<sha><ext>`), with the loser forced all the way into
// its own INSERT failure while the winner's COMMIT is parked. As written the
// loser never gets there: with a blob already sitting at the address the loser
// is absorbed by the `existsSync(storagePath)` dedupe branch before any unlink,
// which is precisely why (A) passes. The alternative is a real DB seam (a
// BEFORE INSERT trigger that raises), which is how the Test Engineer proved it.
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
// Watchdog: a bug must FAIL the test, never hang the process.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => {
      const t = setTimeout(() => rej(new Error('watchdog: ' + label + ' (after ' + ms + 'ms)')), ms);
      if (typeof (t as any).unref === 'function') (t as any).unref();
    }),
  ]);
}

const ROOT = process.env.F1_SCRATCH || path.join(process.env.TEMP || '.', 'f1-ingest-tests');
const DIR = path.join(ROOT, 't13');
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

  const bytes = Buffer.from('t13 concurrent ' + randomBytes(8).toString('hex') + ' ' + 'word '.repeat(40), 'utf8');
  const shaX = sha(bytes);
  const src = path.join(DIR, 't13.txt');
  fs.writeFileSync(src, bytes);

  // ---- arming
  const pg = require('pg');
  const origQ = pg.Client.prototype.query;
  const lateInjected = new Error('t13 injected INSERT failure for the loser');
  let failInserts = false; // armed only once the winner's COMMIT is parked
  let insertAttempts = 0;
  let winnerInserted = false;
  let commitParked = false;
  let releaseCommit: () => void = () => {};
  const gate = new Promise<void>((res) => { releaseCommit = res; });
  let winnerCommitDone = false;

  pg.Client.prototype.query = function (q: any, ...rest: any[]) {
    if (typeof q === 'string' && q.includes('INSERT INTO documents')) {
      insertAttempts++;
      if (failInserts) return Promise.reject(lateInjected); // the loser
      return origQ.call(this, q, ...rest).then((r: any) => {
        winnerInserted = true; // the first caller through is the winner
        return r;
      });
    }
    if (q === 'COMMIT' && winnerInserted && !commitParked) {
      commitParked = true;
      const self = this;
      return gate.then(() => origQ.call(self, q, ...rest)).then(() => { winnerCommitDone = true; });
    }
    return origQ.call(this, q, ...rest);
  };

  const call = () =>
    svc.ingestFile({ name: 't13.txt', path: src, sizeBytes: bytes.length, kind: 'txt', accessPolicy: 'restricted' });
  const settle = (p: Promise<any>) => p.then((v) => ({ status: 'fulfilled', value: v }), (e) => ({ status: 'rejected', reason: e }));

  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      releaseCommit();
    }
  };

  // 0. Start the winner alone; wait until its COMMIT is parked (transaction
  //    open, its row therefore invisible to every other connection).
  let watchdogFired = false;
  const winner = settle(call());
  try {
    await withTimeout(
      (async () => { while (!commitParked) await new Promise((r) => setTimeout(r, 5)); })(),
      15000,
      'the winner never reached a parkable COMMIT',
    );
  } catch (e) {
    watchdogFired = true;
    ok('T13: the winner reached its COMMIT (parked)', false, msg(e));
  }

  // 1. Now the loser starts: its dedupe check must MISS (the winner's row is
  //    still uncommitted) and its own INSERT is made to fail.
  failInserts = true;
  const loserP = settle(call());
  try {
    const l: any = await withTimeout(loserP, 15000, 'the loser never settled');
    ok('T13: the loser rejected with the injected error', l.status === 'rejected' && l.reason === lateInjected, 'status=' + l.status + ' reason=' + msg(l.reason));
    eq('T13: the winner had NOT committed at that moment', winnerCommitDone, false);
    ok('T13: the winner COMMIT really was parked', commitParked, 'the COMMIT patch never parked — the interleaving did not happen');
  } catch (e) {
    watchdogFired = true;
    ok('T13: the loser settles while the winner is parked', false, msg(e));
  }

  // 2. Always release the winner so nothing can hang.
  release();
  pg.Client.prototype.query = origQ;
  let settled: any[] = [];
  try {
    settled = await withTimeout(Promise.all([winner, loserP]), 15000, 'callers did not finish after the gate was released');
  } catch (e) {
    ok('T13: both callers finish after the gate is released', false, msg(e));
  }
  const statuses = settled.map((s: any) => s.status);
  console.log('INFO T13: insertAttempts=' + insertAttempts + ' statuses=' + JSON.stringify(statuses) + ' watchdogFired=' + watchdogFired);

  // ---- fail-closed gate: never a vacuous pass
  if (insertAttempts < 2) {
    ok('T13: both callers must have missed dedupe', false, 'insertAttempts=' + insertAttempts + ' (< 2)');
  } else {
    eq('T13: both callers missed dedupe (2 INSERT attempts)', insertAttempts, 2);
  }
  ok('T13: exactly one caller resolved', statuses.filter((s: string) => s === 'fulfilled').length === 1, 'statuses=' + JSON.stringify(statuses));
  const loser = settled.filter((s: any) => s.status === 'rejected');
  ok('T13: the loser error surfaced', loser.length === 1 && loser[0].reason === lateInjected, 'statuses=' + JSON.stringify(statuses));

  const rows = (await pool.query('SELECT id, source_path FROM documents WHERE sha256=$1', [shaX])).rows;
  eq('T13: exactly one row (the winner)', rows.length, 1);
  const spExists = rows.length === 1 && (() => { try { return fs.statSync(rows[0].source_path).isFile(); } catch { return false; } })();
  ok('T13: the winner source_path EXISTS on disk', spExists, 'source_path=' + (rows.length === 1 ? rows[0].source_path : null) + ' (under (A) the loser unlinked it)');
  eq('T13: exactly one content-address blob', blobs(), [shaX + '.txt']);
  eq('T13: 0 .ingest-tmp-* left', temps().length, 0);

  await pool.end();
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log('FAIL harness: ' + msg(e));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
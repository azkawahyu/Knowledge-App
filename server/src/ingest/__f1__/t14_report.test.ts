// F1 T14 — the report script (§7.5 T14; proof for AC8).
// Runs .pipeline/f1/orphans.sh with F1_DATA_DIR=<scratch> and F1_PGARGS=...f1test.
// Plants: one orphan blob (random bytes at <64hex>.txt, no row), one corrupt blob
// (a T01-shaped name whose bytes do not hash to the name), one temp back-dated
// 2 hours. Asserts ORPHAN_BLOB / HASH_MISMATCH / STALE_TMP appear, nothing is
// reported for the blob T01 legitimately created, exit 0, and nothing is deleted.
import * as path from 'path';
import { randomBytes, createHash } from 'crypto';
import { execFileSync } from 'child_process';

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
const DIR = path.join(ROOT, 't14');
const UP = path.join(DIR, 'uploads');
const EX = path.join(DIR, 'extracts');
const TMPDIR = path.join(DIR, 'tmp');
// __dirname = <repo>/server/src/ingest/__f1__  =>  four levels up is the repo root.
const SPACE = path.resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = path.resolve(SPACE, '.pipeline', 'f1', 'orphans.sh');

function sha(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}
function listing(): string[] {
  const out: string[] = [];
  for (const d of [UP, EX, TMPDIR]) {
    const names = fs.existsSync(d) ? fs.readdirSync(d).sort() : [];
    for (const n of names) out.push(path.basename(d) + '/' + n);
  }
  return out;
}

async function main(): Promise<void> {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(UP, { recursive: true });
  fs.mkdirSync(EX, { recursive: true });
  fs.mkdirSync(TMPDIR, { recursive: true });

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

  // ---- a legitimate document in this scratch dir: must NOT be reported
  const legBytes = Buffer.from('t14 legitimate ' + randomBytes(8).toString('hex') + ' ' + 'word '.repeat(40), 'utf8');
  const legSha = sha(legBytes);
  const legSrc = path.join(DIR, 't14.txt');
  fs.writeFileSync(legSrc, legBytes);
  const leg = await svc.ingestFile({ name: 't14.txt', path: legSrc, sizeBytes: legBytes.length, kind: 'txt', accessPolicy: 'restricted' });
  ok('T14: the legitimate document has chunks (so its row exists)', leg.chunkCount >= 1, 'chunkCount=' + leg.chunkCount);

  // ---- plant the three conditions
  const randomBytesBuf = randomBytes(32);
  const orphanSha = sha(randomBytesBuf); // 64 hex, deliberately NOT in documents
  fs.writeFileSync(path.join(UP, orphanSha + '.txt'), randomBytesBuf);

  const corruptName = sha(Buffer.from('t14 corrupt name seed ' + randomBytes(8).toString('hex')));
  fs.writeFileSync(path.join(UP, corruptName + '.txt'), Buffer.from('bytes that do not hash to the name'));
  // A row IS NOT needed for HASH_MISMATCH; keep it absent so it is also an ORPHAN_BLOB.

  const tmpName = '.ingest-tmp-t14-' + randomBytes(4).toString('hex') + '.txt';
  const tmpPath = path.join(UP, tmpName);
  fs.writeFileSync(tmpPath, Buffer.from('stale temp'));
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
  fs.utimesSync(tmpPath, old, old);
  ok('T14: temp planted and back-dated 2h', fs.statSync(tmpPath).mtime.getTime() < Date.now() - 60 * 60 * 1000, 'mtime not back-dated');

  const before = listing();
  ok('T14: the report script exists', fs.existsSync(SCRIPT), 'missing ' + SCRIPT);

  // ---- run it
  const url = process.env.DATABASE_URL || '';
  const m = url.match(/^\w+:\/\/([^:]+):([^@]*)@([^:/]+):(\d+)\/([^?]+)/);
  let out = '';
  let code = -1;
  let stderr = '';
  if (!m) {
    ok('T14: DATABASE_URL parseable for psql args', false, 'could not parse DATABASE_URL');
  } else {
    const [, user, pass, host, port, db] = m;
    // NOTE (T14): the schema is chosen with PGOPTIONS, not with extra F1_PGARGS.
    // psql executes every -c itself, so an extra `-c search_path=f1test` in
    // F1_PGARGS is both an error and — because psql reuses the LAST -c as the
    // process exit status — masks the report's own query. PGOPTIONS sets the
    // session default for every connection the script opens.
    const env = {
      ...process.env,
      PGPASSWORD: decodeURIComponent(pass),
      PGOPTIONS: '-c search_path=f1test',
      F1_ROOT: SPACE.replace(/\\/g, '/'),
      F1_DATA_DIR: DIR.replace(/\\/g, '/'),
      F1_PGARGS: `-h ${host} -p ${port} -U ${user} -d ${db}`,
      F1_TMP_AGE_MIN: '60',
    };
    try {
      out = execFileSync('bash', [SCRIPT], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      code = 0;
    } catch (e: any) {
      code = typeof e.status === 'number' ? e.status : -1;
      out = String(e.stdout || '');
      stderr = String(e.stderr || '');
    }
  }

  console.log('INFO T14: orphans.sh output follows');
  console.log(out.trimEnd());
  if (stderr.trim()) console.log('INFO T14: stderr: ' + stderr.trimEnd());

  // Windows: the captured stream has CRLF line endings; normalise once so field
  // indexes are stable.
  const clean = out.replace(/\r/g, '');
  const lines = clean.split('\n');
  const fields = (line: string) => line.split('\t');

  eq('T14: exit code 0', code, 0);

  const orphanLine = lines.find((l) => l.startsWith('ORPHAN_BLOB\t' + orphanSha + '\t'));
  ok('T14: prints ORPHAN_BLOB for the planted orphan', orphanLine !== undefined, 'no ORPHAN_BLOB line for ' + orphanSha);

  const mm = lines.find((l) => l.startsWith('HASH_MISMATCH\t' + corruptName + '.txt\t'));
  ok('T14: prints HASH_MISMATCH for the corrupt blob', mm !== undefined, 'no HASH_MISMATCH line for ' + corruptName + '.txt');
  if (mm) eq('T14: HASH_MISMATCH names the true hash', fields(mm)[3].replace(/\r/g, ''), sha(fs.readFileSync(path.join(UP, corruptName + '.txt'))));

  ok('T14: prints STALE_TMP for the back-dated temp', lines.some((l) => l.startsWith('STALE_TMP\t' + tmpName + '\t')), 'no STALE_TMP line for ' + tmpName);
  ok('T14: prints INGEST_TMP (informational) for the temp', lines.some((l) => l.startsWith('INGEST_TMP\t' + tmpName + '\t')), 'no INGEST_TMP line');

  ok(
    'T14: nothing reported for the legitimate document',
    !lines.some((l) => (l.startsWith('ORPHAN_BLOB\t') || l.startsWith('HASH_MISMATCH\t')) && l.includes(legSha)),
    'a line mentioned ' + legSha,
  );
  ok(
    'T14: the legitimate blob was not listed as an orphan',
    !lines.some((l) => l.startsWith('ORPHAN_BLOB\t' + legSha + '\t')),
    'ORPHAN_BLOB for the legitimate blob',
  );

  // ---- REPORT ONLY: the directory listing is unchanged
  const after = listing();
  eq('T14: deletes nothing (listing identical before/after)', after, before);
  ok('T14: the planted orphan still exists', fs.existsSync(path.join(UP, orphanSha + '.txt')), 'the script deleted it!');

  await pool.end();
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log('FAIL harness: ' + msg(e));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
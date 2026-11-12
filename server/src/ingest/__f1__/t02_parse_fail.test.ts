// F1 T02 — parse failure, the core proof (plan §7.5 T2; AC1 + AC4 + O3).
// junk .docx => rejects with the ADM-ZIP message, NO file at the content
// address, no row, no extract, no temp.
// Then the O3 check in its STRICT form: re-ingest the SAME bytes under the
// SAME name and extension (`.docx`), i.e. the identical storagePath the failed
// attempt would have used. Identical bytes + identical extension is the only
// shape that can hit a stuck `existsSync(storagePath)` dedupe:
//   pre-fix: the failed attempt left `<sha>.docx` at the address, so this retry
//            returns {documentId: <sha>, chunkCount: 0} with NO row (O3);
//   fixed  : it re-parses and throws the ADM-ZIP error again.
// Finally the same bytes as a legitimate `.txt` must ingest fully — that is a
// different address, so it is a sanity check on the bytes, not the O3 proof.
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
const DIR = path.join(ROOT, 't02');
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

  // Byte-unique junk that is not a zip at all (ADM-ZIP rejects it).
  // hex, not raw bytes: the .txt phase feeds these same bytes into a text parse and
  // the `text` column, and a NUL byte makes PostgreSQL reject them
  // ("invalid byte sequence for encoding UTF8: 0x00") — an unrelated ~6% flake.
  const junk = Buffer.concat([Buffer.from('not a zip file at all '), Buffer.from(randomBytes(16).toString('hex'))]);
  const sha1 = sha(junk);
  const srcDocx = path.join(DIR, 't02.docx');
  fs.writeFileSync(srcDocx, junk);

  let thrown: unknown;
  try {
    await svc.ingestFile({ name: 't02.docx', path: srcDocx, sizeBytes: junk.length, kind: 'docx', accessPolicy: 'restricted' });
  } catch (e) {
    thrown = e;
  }
  ok('T2: junk .docx rejects', thrown !== undefined, 'it resolved — the parse failure did not surface');
  ok(
    'T2: error is the ADM-ZIP message',
    msg(thrown).includes('ADM-ZIP: Invalid or unsupported zip format'),
    'message=' + JSON.stringify(thrown === undefined ? null : msg(thrown)),
  );

  // --- the fix's load-bearing assertion: no file at the content address
  eq('T2: uploads/ has 0 files (no <sha>.docx at the content address)', blobs(), []);
  eq('T2: 0 .ingest-tmp-* left', temps(), []);
  const rowsAfterFail = (await pool.query('SELECT id FROM documents WHERE sha256=$1', [sha1])).rows;
  eq('T2: documents delta for the sha = 0', rowsAfterFail.length, 0);
  ok('T2: no extract', !fs.existsSync(path.join(EX, sha1 + '.txt')), 'extract exists');

  // --- O3 in its STRICT form: SAME bytes, SAME name, SAME extension.
  // This is precisely the retry a user performs. If the failed attempt had
  // left `<sha>.docx` at the content address, the dedupe shortcut would answer
  // here with chunkCount 0 and no row (O3). The fix must re-parse and throw.
  const srcDocxAgain = path.join(DIR, 't02-retry.docx');
  fs.writeFileSync(srcDocxAgain, junk);
  eq('T2: the same-name retry bytes hash to the same sha', sha(fs.readFileSync(srcDocxAgain)), sha1);
  ok('T2: no <sha>.docx exists at the address before the same-name retry', !fs.existsSync(path.join(UP, sha1 + '.docx')), 'a .docx blob already sits at the content address — the retry could dedupe to it');
  let thrownAgain: unknown;
  let retried: any = undefined;
  try {
    retried = await svc.ingestFile({ name: 't02.docx', path: srcDocxAgain, sizeBytes: junk.length, kind: 'docx', accessPolicy: 'restricted' });
  } catch (e) {
    thrownAgain = e;
  }
  ok('T2: same-name .docx retry does NOT resolve (O3: no silent success)', retried === undefined, 'it RESOLVED: ' + JSON.stringify(retried) + ' — that is O3, a success with no row');
  ok(
    'T2: same-name .docx retry surfaces the ADM-ZIP parse error again',
    msg(thrownAgain).includes('ADM-ZIP: Invalid or unsupported zip format'),
    'message=' + JSON.stringify(thrownAgain === undefined ? null : msg(thrownAgain)),
  );
  eq('T2: still no <sha>.docx at the content address after the retry', fs.existsSync(path.join(UP, sha1 + '.docx')), false);

  // --- then: the SAME bytes under a valid .txt name must fully ingest.
  // (A different extension means a different content address, so this does not
  // by itself prove the O3 cure; it proves the bytes are ordinary text input.)
  const same = path.join(DIR, 't02.txt');
  fs.writeFileSync(same, junk); // identical bytes, different extension/kind
  eq('T2: the .txt bytes hash to the same sha', sha(fs.readFileSync(same)), sha1);
  const res = await svc.ingestFile({ name: 't02.txt', path: same, sizeBytes: junk.length, kind: 'txt', accessPolicy: 'restricted' });
  ok('T2: the .txt ingest resolves with a real UUID documentId', /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(res.documentId), 'documentId=' + res.documentId);
  ok('T2: the .txt ingest produces chunks (different address — sanity, not the O3 proof)', res.chunkCount > 0, 'chunkCount=' + res.chunkCount + ' (a dedupe hit returns chunkCount 0)');
  const rows2 = (await pool.query('SELECT id, source_path FROM documents WHERE sha256=$1', [sha1])).rows;
  eq('T2: exactly 1 row for the sha after the .txt ingest', rows2.length, 1);
  const addrTxt = path.join(UP, sha1 + '.txt');
  ok('T2: blob now exists at <sha>.txt', fs.existsSync(addrTxt), 'missing ' + addrTxt);
  ok('T2: row.source_path -f true', rows2.length === 1 ? fs.statSync(rows2[0].source_path).isFile() : false, 'source_path');
  eq('T2: still 0 .ingest-tmp-*', temps().length, 0);

  await pool.end();
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log('FAIL harness: ' + msg(e));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
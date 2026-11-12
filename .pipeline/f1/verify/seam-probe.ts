// INDEPENDENT TEST ENGINEER — F1 real-service seam proof (no mocks, no patches).
//
// Exercises the DELIVERED ingestion service against a throwaway storage dir and the
// f1test schema. Covers:
//   A. junk .docx  => original error, no content address, no .ingest-tmp-*
//   B. same bytes as .txt => real UUID + chunkCount >= 1
//   C. O3 cure     => document row EXISTS for bytes whose first ingest failed
//   D. shared blob => a failing ingest of bytes a committed doc shares does not
//                     delete that doc's blob
//   E. concurrency => two simultaneous ingests of the same NEW bytes, one fails at
//                     a REAL PostgreSQL INSERT (BEFORE INSERT trigger on f1test
//                     .documents that raises for a name prefix) => the winner's row
//                     still has its blob on disk.
//
// Run with DATABASE_URL pointing at ...?options=-c%20search_path%3Df1test and
// PGOPTIONS unset. F1_SERVICE may override the service module under test.

import * as path from 'path';
import { randomBytes, createHash } from 'crypto';

const fs: any = require('fs');

const SERVICE = process.env.F1_SERVICE || 'D:/Develop/knowledge-app/server/src/ingest/service';
const LABEL = process.env.F1_LABEL || 'delivered';

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail: string = ''): void {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + ': ' + detail); }
}
function note(name: string, detail: string): void { console.log('INFO ' + name + ': ' + detail); }
function msg(e: unknown): string {
  return e && typeof e === 'object' && 'message' in e ? String((e as any).message) : String(e);
}
function sha(buf: Buffer): string { return createHash('sha256').update(buf).digest('hex'); }
function shaFile(p: string): string { return sha(fs.readFileSync(p)); }
function list(dir: string): string[] { return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []; }
function temps(dir: string): string[] { return list(dir).filter((f: string) => f.startsWith('.ingest-tmp-')); }
function uuidish(s: unknown): boolean { return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s); }

async function main(): Promise<void> {
  const nonce = Date.now().toString(36) + randomBytes(3).toString('hex');
  const BASE = path.join(process.env.F1V_SCRATCH || process.env.TEMP || '.', 'f1v-probe-' + nonce);
  const UP = path.join(BASE, 'uploads');
  const EX = path.join(BASE, 'extracts');
  fs.mkdirSync(UP, { recursive: true });
  fs.mkdirSync(EX, { recursive: true });
  note('base', BASE);
  note('service module', String(require.resolve(SERVICE)));

  const { createIngestionService } = require(SERVICE);
  const { pool } = require(path.resolve(SERVICE, '..', '..', 'db'));

  const cs = (await pool.query('SELECT current_schema()')).rows[0].current_schema;
  note('schema', cs);
  if (cs !== 'f1test') { console.log('BLOCKED: current_schema()=' + cs + ', expected f1test'); process.exit(2); }

  const svc = createIngestionService({ storageDir: UP, extractDir: EX });
  const q = (sql: string, args: any[] = []) => pool.query(sql, args);

  // ---------------------------------------------------------------- A + B + C
  const junk = Buffer.concat([Buffer.from('F1V not a zip '), randomBytes(16)]);
  const sj = sha(junk);
  const pDocx = path.join(BASE, 'junk.docx');
  fs.writeFileSync(pDocx, junk);

  let thrown: unknown;
  try {
    await svc.ingestFile({ name: 'junk.docx', path: pDocx, sizeBytes: junk.length, kind: 'docx', accessPolicy: 'restricted' });
  } catch (e) { thrown = e; }
  note('A message', JSON.stringify(msg(thrown)));
  ok('A1 junk .docx throws the original parse error', thrown !== undefined && msg(thrown).includes('ADM-ZIP: Invalid or unsupported zip format'), 'thrown=' + msg(thrown));
  ok('A2 no <sha>.docx at the content address', !fs.existsSync(path.join(UP, sj + '.docx')), 'found ' + sj + '.docx');
  ok('A3 uploads/ has no blob at all', list(UP).length === 0, 'listing=' + JSON.stringify(list(UP)));
  ok('A4 no .ingest-tmp-* left', temps(UP).length === 0, 'temps=' + JSON.stringify(temps(UP)));
  ok('A5 no extract', !fs.existsSync(path.join(EX, sj + '.txt')), 'extract exists');
  ok('A6 documents rows for that sha = 0', Number((await q('SELECT count(*)::int AS n FROM documents WHERE sha256=$1', [sj])).rows[0].n) === 0, 'rows exist');

  const pTxt = path.join(BASE, 'junk.txt');
  fs.writeFileSync(pTxt, junk);
  ok('B0 the .txt fixture is byte-identical', shaFile(pTxt) === sj, 'sha differs');
  const res = await svc.ingestFile({ name: 'junk.txt', path: pTxt, sizeBytes: junk.length, kind: 'txt', accessPolicy: 'restricted' });
  note('B result', JSON.stringify({ documentId: res.documentId, chunkCount: res.chunkCount, textLength: res.textLength }));
  ok('B1 re-ingest returns a real UUID documentId', uuidish(res.documentId), 'documentId=' + res.documentId);
  ok('B2 chunkCount >= 1', res.chunkCount >= 1, 'chunkCount=' + res.chunkCount);
  const rowsB = (await q('SELECT id, source_path, sha256 FROM documents WHERE sha256=$1', [sj])).rows;
  ok('B3 exactly 1 documents row for those bytes', rowsB.length === 1, 'rows=' + rowsB.length);
  ok('B4 that row is the returned id', rowsB.length === 1 && rowsB[0].id === res.documentId, 'row=' + (rowsB[0] && rowsB[0].id));
  const chunkN = rowsB.length === 1 ? Number((await q('SELECT count(*)::int AS n FROM chunks WHERE document_id=$1', [rowsB[0].id])).rows[0].n) : -1;
  ok('B5 the row has >= 1 chunk row', chunkN >= 1, 'chunks=' + chunkN);
  const addrTxt = path.join(UP, sj + '.txt');
  ok('B6 blob exists at <sha>.txt', fs.existsSync(addrTxt), 'missing ' + addrTxt);
  ok('B7 blob bytes hash to its name', fs.existsSync(addrTxt) && shaFile(addrTxt) === sj, 'hash mismatch');
  ok('B8 source_path resolves to a file', rowsB.length === 1 && fs.statSync(rowsB[0].source_path).isFile(), 'source_path missing');
  ok('B9 no .ingest-tmp-* left', temps(UP).length === 0, 'temps=' + JSON.stringify(temps(UP)));
  // C is B3/B4: the row EXISTS for bytes whose first ingest failed (pre-fix: no row,
  // dedupe hit on the leftover <sha>.docx/blob, documentId = the sha, 0 chunks).
  ok('C1 O3 cured: a row exists for bytes whose first ingest failed', rowsB.length === 1, 'pre-fix this is 0');

  // ------------------------------------------------------------------- G
  // O3, EXACTLY: a failed ingest followed by a retry of the SAME bytes with the
  // SAME extension. That retry must not be answered from a stale content address —
  // pre-fix it silently "succeeded" (documentId = sha, chunkCount 0, no row).
  const W = Buffer.concat([Buffer.from('F1V O3 junk '), randomBytes(16)]);
  const sW = sha(W);
  const g1 = path.join(BASE, 'g1.docx');
  const g2 = path.join(BASE, 'g2.docx');   // same bytes, same extension
  fs.writeFileSync(g1, W);
  fs.writeFileSync(g2, W);
  let gThrown1: unknown;
  try { await svc.ingestFile({ name: 'g1.docx', path: g1, sizeBytes: W.length, kind: 'docx', accessPolicy: 'restricted' }); } catch (e) { gThrown1 = e; }
  ok('G1 the first .docx attempt fails', gThrown1 !== undefined, 'it resolved');
  ok('G2 the second fixture is byte-identical', shaFile(g2) === sW, 'sha differs');
  let gThrown2: unknown;
  let gRes: any = null;
  try { gRes = await svc.ingestFile({ name: 'g2.docx', path: g2, sizeBytes: W.length, kind: 'docx', accessPolicy: 'restricted' }); } catch (e) { gThrown2 = e; }
  note('G retry outcome', gThrown2 !== undefined ? 'threw: ' + JSON.stringify(msg(gThrown2)) : 'RESOLVED: ' + JSON.stringify(gRes));
  ok('G3 the same-bytes same-extension retry is NOT a silent dedupe no-op', gThrown2 !== undefined, 'it RESOLVED (O3): documentId=' + (gRes && gRes.documentId) + ' chunkCount=' + (gRes && gRes.chunkCount));
  ok('G4 the retry surfaces the parse error again', gThrown2 !== undefined && msg(gThrown2).includes('ADM-ZIP'), 'message=' + (gThrown2 === undefined ? 'none' : msg(gThrown2)));
  const rowsW = (await q('SELECT id FROM documents WHERE sha256=$1', [sW])).rows;
  ok('G5 no row exists for those bytes', rowsW.length === 0, 'rows=' + rowsW.length);
  ok('G6 no content address for those bytes', !fs.existsSync(path.join(UP, sW + '.docx')), 'address created');
  ok('G7 no .ingest-tmp-* left', temps(UP).length === 0, 'temps=' + JSON.stringify(temps(UP)));

  // ------------------------------------------------------------------- D
  const X = Buffer.from('F1V shared blob ' + randomBytes(8).toString('hex') + ' ' + 'word '.repeat(40), 'utf8');
  const sX = sha(X);
  const p1 = path.join(BASE, 'p1.txt');
  fs.writeFileSync(p1, X);
  const r1 = await svc.ingestFile({ name: 'p1.txt', path: p1, sizeBytes: X.length, kind: 'txt', accessPolicy: 'restricted' });
  const addrX = path.join(UP, sX + '.txt');
  const row1 = (await q('SELECT id, source_path FROM documents WHERE sha256=$1', [sX])).rows;
  const chunks1 = row1.length === 1 ? Number((await q('SELECT count(*)::int AS n FROM chunks WHERE document_id=$1', [row1[0].id])).rows[0].n) : -1;
  ok('D1 first ingest committed a row + blob', row1.length === 1 && fs.existsSync(addrX) && r1.chunkCount >= 1, 'row/blob missing');

  const p2 = path.join(BASE, 'p2.docx');
  fs.writeFileSync(p2, X);
  ok('D2 the second fixture is byte-identical to the first', shaFile(p2) === sX, 'sha differs');
  let thrown2: unknown;
  try {
    await svc.ingestFile({ name: 'p2.docx', path: p2, sizeBytes: X.length, kind: 'docx', accessPolicy: 'restricted' });
  } catch (e) { thrown2 = e; }
  ok('D3 the second ingest fails', thrown2 !== undefined, 'it resolved');
  ok('D4 the committed <shaX>.txt blob still exists', fs.existsSync(addrX), 'blob deleted');
  ok('D5 its bytes are unchanged', fs.existsSync(addrX) && shaFile(addrX) === sX, 'content changed');
  const rowAfter = (await q('SELECT id, source_path FROM documents WHERE sha256=$1', [sX])).rows;
  ok('D6 exactly 1 row still, same id', rowAfter.length === 1 && row1.length === 1 && rowAfter[0].id === row1[0].id, 'rows=' + rowAfter.length);
  ok('D7 its source_path still resolves', rowAfter.length === 1 && fs.statSync(rowAfter[0].source_path).isFile(), 'source_path missing');
  const chunks2 = rowAfter.length === 1 ? Number((await q('SELECT count(*)::int AS n FROM chunks WHERE document_id=$1', [rowAfter[0].id])).rows[0].n) : -2;
  ok('D8 its chunks are unchanged', chunks2 === chunks1, 'chunks ' + chunks1 + ' -> ' + chunks2);
  ok('D9 no <shaX>.docx was created', !fs.existsSync(path.join(UP, sX + '.docx')), 'address created');
  ok('D10 no .ingest-tmp-* left', temps(UP).length === 0, 'temps=' + JSON.stringify(temps(UP)));

  // ------------------------------------------------------------------- F
  // "Two documents whose bytes are identical, arriving under a different
  // name/extension": a second, VALID extension gives a different content address,
  // so both rows must end up with a blob that exists.
  const p3 = path.join(BASE, 'p3.md');
  fs.writeFileSync(p3, X);
  const r3 = await svc.ingestFile({ name: 'p3.md', path: p3, sizeBytes: X.length, kind: 'md', accessPolicy: 'restricted' });
  ok('F1 the .md ingest resolves with chunks', r3.chunkCount >= 1, 'chunkCount=' + r3.chunkCount);
  ok('F2 its documentId is a real UUID (no dedupe hit: different address)', uuidish(r3.documentId), 'documentId=' + r3.documentId);
  const addrMd = path.join(UP, sX + '.md');
  ok('F3 <shaX>.md exists', fs.existsSync(addrMd), 'missing ' + addrMd);
  const allRows = (await q('SELECT id, source_path, sha256 FROM documents WHERE sha256=$1', [sX])).rows;
  ok('F4 exactly 2 rows share those bytes', allRows.length === 2, 'rows=' + allRows.length);
  const allResolve = allRows.every((r: any) => { try { return fs.statSync(r.source_path).isFile(); } catch { return false; } });
  ok('F5 EVERY row for those bytes has a source_path that exists', allRows.length === 2 && allResolve, 'missing source_path');
  ok('F6 both content addresses exist', fs.existsSync(addrX) && fs.existsSync(addrMd), 'an address is missing');
  ok('F7 no .ingest-tmp-* left', temps(UP).length === 0, 'temps=' + JSON.stringify(temps(UP)));

  // ------------------------------------------------------------------- E
  // A REAL PostgreSQL fault: BEFORE INSERT trigger on f1test.documents that raises
  // for a name prefix. Created and dropped by this probe; no application code is
  // patched and no service behaviour is simulated.
  let concurrencyObserved = false;
  let attempts = 0;
  try {
    await q(`CREATE OR REPLACE FUNCTION f1test.f1v_fail_on_name() RETURNS trigger LANGUAGE plpgsql AS $f$
             BEGIN
               IF NEW.name LIKE 'f1v-fail-%' THEN
                 RAISE EXCEPTION 'f1v injected INSERT failure for %', NEW.name;
               END IF;
               RETURN NEW;
             END $f$`);
    await q('DROP TRIGGER IF EXISTS f1v_fail ON f1test.documents');
    await q('CREATE TRIGGER f1v_fail BEFORE INSERT ON f1test.documents FOR EACH ROW EXECUTE FUNCTION f1v_fail_on_name()');
    note('E trigger', 'f1test.f1v_fail armed (raises for name LIKE f1v-fail-%)');

    while (!concurrencyObserved && attempts < 6) {
      attempts++;
      const Z = Buffer.from('F1V concurrent ' + randomBytes(8).toString('hex') + ' ' + 'word '.repeat(40), 'utf8');
      const sZ = sha(Z);
      const srcZ = path.join(BASE, 'conc-' + attempts + '.txt');
      fs.writeFileSync(srcZ, Z);
      const winName = 'f1v-win-' + attempts + '-' + randomBytes(3).toString('hex') + '.txt';
      const loseName = 'f1v-fail-' + attempts + '-' + randomBytes(3).toString('hex') + '.txt';
      const before = list(UP).length;
      const settle = (p: Promise<any>) => p.then((v) => ({ status: 'fulfilled', value: v }), (e) => ({ status: 'rejected', reason: e }));
      const call = (n: string) => svc.ingestFile({ name: n, path: srcZ, sizeBytes: Z.length, kind: 'txt', accessPolicy: 'restricted' });
      const [a, b] = await Promise.all([settle(call(winName)), settle(call(loseName))]);
      const statuses = [a.status, b.status];
      note('E attempt ' + attempts, 'statuses=' + JSON.stringify(statuses) + (b.status === 'rejected' ? ' loserMsg=' + JSON.stringify(msg(b.reason)) : ''));
      if (a.status === 'fulfilled' && b.status === 'rejected') {
        concurrencyObserved = true;
        ok('E1 exactly one caller rejected (real INSERT failure)', true);
        ok('E2 the loser surfaced the real PostgreSQL error', msg(b.reason).includes('f1v injected INSERT failure'), 'msg=' + msg(b.reason));
        const rowsZ = (await q('SELECT id, source_path FROM documents WHERE sha256=$1', [sZ])).rows;
        ok('E3 exactly one row for the new bytes (the winner)', rowsZ.length === 1, 'rows=' + rowsZ.length);
        const spZ = rowsZ.length === 1 ? rowsZ[0].source_path : '';
        ok('E4 the winner source_path still EXISTS on disk', rowsZ.length === 1 && fs.existsSync(spZ) && fs.statSync(spZ).isFile(), 'missing ' + spZ);
        ok('E5 that blob hashes to its name', fs.existsSync(spZ) && shaFile(spZ) === sZ, 'hash mismatch');
        ok('E6 exactly one content-address blob for the bytes', list(UP).filter((f: string) => f === sZ + '.txt').length === 1, 'blob count wrong');
        ok('E7 no .ingest-tmp-* left', temps(UP).length === 0, 'temps=' + JSON.stringify(temps(UP)));
        ok('E8 uploads/ grew by exactly one blob', list(UP).length === before + 1, 'before=' + before + ' after=' + list(UP).length);
      }
    }
    if (!concurrencyObserved) {
      ok('E0 the interleaving was observed', false, 'after ' + attempts + ' attempts both callers settled the same way (see INFO)');
    }
  } finally {
    await q('DROP TRIGGER IF EXISTS f1v_fail ON f1test.documents').catch(() => {});
    await q('DROP FUNCTION IF EXISTS f1test.f1v_fail_on_name()').catch(() => {});
  }

  console.log('LABEL: ' + LABEL);
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log('FAIL harness: ' + msg(e));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
// INDEPENDENT — Phase 1 regression probe: real service, real HTTP, public schema.
// usage: tsx p1-upload.ts <port> [--cleanup-only <sha>]
import * as path from 'path';
import { randomBytes, createHash } from 'crypto';

const fs: any = require('fs');

async function main(): Promise<void> {
  const port = process.argv[2] || '4000';
  const cleanupOnly = process.argv[3] === '--cleanup-only' ? process.argv[4] : '';
  const base = 'http://127.0.0.1:' + port;
  const ROOT = 'D:/Develop/knowledge-app/server';
  const { createIngestionService } = require(path.join(ROOT, 'src/ingest/service'));
  const { pool } = require(path.join(ROOT, 'src/db'));
  const storageDir: string = createIngestionService({}).storageDir;

  const cs = (await pool.query('SELECT current_schema()')).rows[0].current_schema;
  if (cs !== 'public') { console.log('BLOCKED: current_schema()=' + cs + ', expected public'); process.exit(2); }

  if (cleanupOnly) { await removeOwn(cleanupOnly, storageDir, pool); await pool.end(); return; }

  const login = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  console.log('INFO login status=' + login.status);
  const lj: any = await login.json();
  if (!lj.token) { console.log('BLOCKED: no token from /api/auth/login: ' + JSON.stringify(lj)); process.exit(2); }

  const unit = 'independent test engineer f1 regression ' + randomBytes(6).toString('hex') + ' ' + 'word '.repeat(30);
  const buf = Buffer.from(unit, 'utf8');
  const sha = createHash('sha256').update(buf).digest('hex');
  console.log('INFO marker unit=' + JSON.stringify(unit.trim()));
  console.log('INFO expected sha=' + sha + ' expected blob=' + path.join(storageDir, sha + '.txt'));

  const fd = new FormData();
  fd.append('files', new Blob([buf], { type: 'text/plain' }), 'f1v-regression.txt');
  const up = await fetch(base + '/api/ingest/upload', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + lj.token },
    body: fd,
  });
  const text = await up.text();
  console.log('INFO upload status=' + up.status);
  console.log('INFO upload body=' + text);
  const body: any = JSON.parse(text);
  const r = body && Array.isArray(body.results) && body.results.length ? body.results[0] : null;
  const FIELDS = ['documentId', 'contentHash', 'name', 'kind', 'accessPolicy', 'chunkCount', 'chunkIds', 'textLength', 'savedAt'];
  console.log('RESULT upload_status_200: ' + (up.status === 200));
  console.log('RESULT all_nine_fields_present: ' + (r !== null && FIELDS.every((f) => Object.prototype.hasOwnProperty.call(r, f))));
  console.log('INFO result fields=' + JSON.stringify(r === null ? null : Object.keys(r)));
  console.log('RESULT contentHash_matches: ' + (r !== null && r.contentHash === sha));
  console.log('RESULT blob_at_sha_txt: ' + fs.existsSync(path.join(storageDir, sha + '.txt')));
  const row = (await pool.query('SELECT id FROM public.documents WHERE sha256=$1', [sha])).rows;
  console.log('INFO documents rows for sha=' + row.length + ' id=' + (row[0] && row[0].id));
  const chunkN = row.length === 1 ? (await pool.query('SELECT count(*)::int AS n FROM public.chunks WHERE document_id=$1', [row[0].id])).rows[0].n : -1;
  console.log('INFO chunk rows=' + chunkN);

  // --- the ONLY delete this engineer performs: exactly the row/blob it created.
  if (row.length !== 1) { console.log('BLOCKED: expected exactly one row for my own sha, found ' + row.length); process.exit(2); }
  const del = await pool.query('DELETE FROM public.documents WHERE id=$1 AND sha256=$2 RETURNING id', [row[0].id, sha]);
  const chDel = await pool.query('SELECT count(*)::int AS n FROM public.chunks WHERE document_id=$1', [row[0].id]);
  fs.rmSync(path.join(storageDir, sha + '.txt'), { force: true });
  fs.rmSync(path.join(ROOT, 'data/extracts', sha + '.txt'), { force: true });
  console.log('INFO deleted documents rows=' + del.rowCount + ' remaining chunks for that id=' + chDel.rows[0].n);
  console.log('RESULT blob_removed: ' + (!fs.existsSync(path.join(storageDir, sha + '.txt'))));
  await pool.end();
}

// Delete exactly the rows + blob this engineer created for one sha, and nothing else.
async function removeOwn(sha: string, storageDir: string, pool: any): Promise<void> {
  const rows = (await pool.query('SELECT id, name FROM public.documents WHERE sha256=$1', [sha])).rows;
  for (const r of rows) {
    const del = await pool.query('DELETE FROM public.documents WHERE id=$1 AND sha256=$2 RETURNING id', [r.id, sha]);
    const ch = await pool.query('SELECT count(*)::int AS n FROM public.chunks WHERE document_id=$1', [r.id]);
    console.log('CLEANUP deleted row id=' + r.id + ' name=' + r.name + ' -> ' + del.rowCount + ' row, chunks left=' + ch.rows[0].n);
  }
  for (const p of [path.join(storageDir, sha + '.txt'), path.join('D:/Develop/knowledge-app/server/data/extracts', sha + '.txt')]) {
    const existed = fs.existsSync(p);
    fs.rmSync(p, { force: true });
    console.log('CLEANUP removed ' + p + ' (existed=' + existed + ')');
  }
  console.log('CLEANUP remaining rows for sha=' + (await pool.query('SELECT count(*)::int AS n FROM public.documents WHERE sha256=$1', [sha])).rows[0].n);
}

main().catch((e) => { console.log('FAIL harness: ' + String(e && e.stack || e)); process.exit(1); });
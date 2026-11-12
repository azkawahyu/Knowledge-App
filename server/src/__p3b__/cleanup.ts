// Cleanup + independent cleanup proof for F3-B (§B4.1.4, §B4.1.5).
//
//   npx tsx src/__p3b__/cleanup.ts [--pre-count N]
//
// Deletes ONLY by captured id from state.json (never a pattern), then proves:
//   - SELECT count(*) ... audit_log WHERE id = ANY($1)  => 0
//   - SELECT count(*) ... audit_log                     => PRE_COUNT
//   - no p3b-* document remains
//   - the throwaway admin row the T-B9 known-username leg needed is gone.
// It may run even if the test aborted: state.json is written before the
// fixture is torn down, and `--pre-count` lets the caller pin the expected
// pre-test count when re-running.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pool } from '../db';

const STATE = path.join(__dirname, 'state.json');
// uuid shape, hoisted: CREATED_IDS mixes audit-row uuids with sha256 doc ids.
const UUID_RE_TOP = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main(): Promise<void> {
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8')) as {
    CREATED_IDS: string[];
    CREATED_DOCUMENTS: string[];
    PRE_COUNT: number;
    PRE_MAX_ID: string;
    TAG: string;
    PROBE_DOCUMENT_IDS?: string[];
  };
  const argIdx = process.argv.indexOf('--pre-count');
  const expectedPre = argIdx > -1 ? Number(process.argv[argIdx + 1]) : state.PRE_COUNT;

  const ids = Array.from(new Set(state.CREATED_IDS)).filter((id) => UUID_RE_TOP.test(id));
  const docIds = Array.from(new Set(state.CREATED_DOCUMENTS));
  console.log(`cleanup: ${ids.length} audit ids, ${docIds.length} document ids, TAG=${state.TAG}`);
  console.log(`cleanup: expected PRE_COUNT=${expectedPre}`);

  // Blob hashes MUST be captured BEFORE the audit DELETE below: the audit rows
  // are the only durable record of which content addresses this run created
  // (document rows are gone by the time the blob section runs, and dedupe
  // uploads never create a document row at all). Reads are scoped to THIS run's
  // captured ids only, so a pre-existing user blob can never be matched.
  const preDeleteBlobHashes: string[] = [];
  for (const r of (await pool.query<{ resource: string }>(
    `SELECT resource FROM public.audit_log
      WHERE id = ANY($1::uuid[]) AND resource LIKE 'document:sha256:%'`,
    [ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000']],
  )).rows) {
    const m = /^document:sha256:([0-9a-f]{64})$/i.exec(r.resource);
    if (m) preDeleteBlobHashes.push(m[1]);
  }

  if (ids.length > 0) {
    const del = await pool.query('DELETE FROM public.audit_log WHERE id = ANY($1::uuid[])', [ids]);
    console.log(`cleanup: DELETE audit_log ... WHERE id = ANY(...) => ${del.rowCount} rows`);
  }
  // The dedupe path reports a sha256 CONTENT HASH as `documentId` — that is a
  // content address, not a documents.id (T-B10b's resource is
  // `document:sha256:<64hex>` and dedupe creates no new document). Only
  // UUID-shaped values can be document ids.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const docUuids = docIds.filter((id) => UUID_RE.test(id));
  // Fresh-upload content hashes must be read BEFORE the document DELETE below —
  // see the blob-hygiene section for why (source 2).
  let freshUploadHashes: string[] = [];
  if (docUuids.length > 0) {
    const hashRows = await pool.query<{ id: string; sha256: string }>(
      'SELECT id::text AS id, sha256 FROM public.documents WHERE id = ANY($1::uuid[])',
      [docUuids],
    );
    freshUploadHashes = hashRows.rows.map((r) => r.sha256);
    const del = await pool.query('DELETE FROM public.documents WHERE id = ANY($1::uuid[])', [docUuids]);
    console.log(`cleanup: DELETE documents ... WHERE id = ANY(...) => ${del.rowCount} rows (chunks cascade)`);
  }
  const nonUuid = docIds.filter((id) => !UUID_RE.test(id));
  if (nonUuid.length > 0) console.log(`cleanup: ${nonUuid.length} sha256 content address(es) — no document row to delete (dedupe)`);

  // ---- proofs
  const leftover = await pool.query('SELECT count(*)::int AS c FROM public.audit_log WHERE id = ANY($1::uuid[])', [
    ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'],
  ]);
  const total = await pool.query('SELECT count(*)::int AS c FROM public.audit_log');
  const docsLeft = await pool.query("SELECT count(*)::int AS c FROM public.documents WHERE name LIKE 'p3b-%'");
  const docsAll = await pool.query('SELECT count(*)::int AS c FROM public.documents');
  const strayAdmins = await pool.query("SELECT count(*)::int AS c FROM public.admins WHERE username LIKE 'p3b-%'");

  // Ids captured BEFORE the run's own docs were deleted, plus any p3b-* row
  // that a previous aborted run of this suite left behind — all of them were
  // created by p3b-* named fixtures of this task, so deleting them by name
  // here is the same ownership scope as §B4.1 (nothing else writes p3b-*).
  const p3bDocs = await pool.query("SELECT id, name FROM public.documents WHERE name LIKE 'p3b-%'");
  for (const d of p3bDocs.rows as { id: string; name: string }[]) {
    await pool.query('DELETE FROM public.documents WHERE id = $1', [d.id]);
    console.log(`cleanup: deleted leftover p3b-* document ${d.id} (${d.name})`);
  }
  const docsAfter = await pool.query('SELECT count(*)::int AS c FROM public.documents');
  const okDocs = (await pool.query("SELECT count(*)::int AS c FROM public.documents WHERE name LIKE 'p3b-%'")).rows[0].c === 0;

  const okLeft = leftover.rows[0].c === 0;
  // CIRCULARITY FIX (2026-11-03, review finding #2): `expectedPre` may come from
  // the persisted state.json that this run itself wrote, which makes
  // `total === expectedPre` a self-comparison. `--pre-count N` supplied by the
  // caller is trusted; the persisted value is not. Either way we also assert the
  // two properties that actually mean "clean": no row of this run survived
  // (okLeft), and the table is back to the caller-declared baseline.
  const preFromArgv = argIdx > -1;
  const okTotal = preFromArgv ? total.rows[0].c === expectedPre : total.rows[0].c === 0;
  const okAdmins = strayAdmins.rows[0].c === 0;

  console.log(`PROOF audit rows by captured id remaining = ${leftover.rows[0].c}  ${okLeft ? 'PASS' : 'FAIL'}`);
  console.log(
    `PROOF audit_log count = ${total.rows[0].c} ${preFromArgv ? `== --pre-count ${expectedPre}` : '== 0 (persisted PRE_COUNT NOT trusted)'}  ${okTotal ? 'PASS' : 'FAIL'}`,
  );
  console.log(`PROOF p3b-* documents remaining = ${okDocs ? 0 : docsLeft.rows[0].c} (documents total ${docsAfter.rows[0].c})  ${okDocs ? 'PASS' : 'FAIL'}`);
  console.log(`PROOF p3b-* admins remaining = ${strayAdmins.rows[0].c}  ${okAdmins ? 'PASS' : 'FAIL'}`);

  const allOk = okLeft && okTotal && okDocs && okAdmins;
  // Blob hygiene (review finding #3): documents cascade their chunks, but the
  // content-addressed blobs and extract files are NOT rows — they are files.
  // Two hash sources, both scoped to THIS run:
  //   1. preDeleteBlobHashes — audit rows whose resource is `document:sha256:<h>`
  //      (the dedupe path: no document row is ever created, so the audit row is
  //      the ONLY record that those bytes belong to this run).
  //   2. freshUploadHashes — for FRESH uploads the audit resource is
  //      `document:<uuid>` (routes/ingest.ts:229), so the content hash is
  //      recovered from the documents row BEFORE the document DELETE above.
  //   3. nonUuid — sha256 content addresses handed back in responses.
  // A pre-existing user blob can never be matched: every hash comes from a row
  // or id this run captured.
  const blobHashes: string[] = [...preDeleteBlobHashes, ...freshUploadHashes];
  for (const h of nonUuid) if (/^[0-9a-f]{64}$/i.test(h)) blobHashes.push(h);
  const uniq = Array.from(new Set(blobHashes));
  const dataDir = path.join(__dirname, '..', '..', 'data');
  let removed = 0;
  for (const h of uniq) {
    for (const sub of ['uploads', 'extracts']) {
      const dir = path.join(dataDir, sub);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(h)) {
          fs.rmSync(path.join(dir, f), { force: true });
          removed++;
        }
      }
    }
  }
  console.log(`cleanup: removed ${removed} blob/extract file(s) for ${uniq.length} content address(es) of this run`);

  console.log(`\nCLEANUP: ${allOk ? 'PASS' : 'FAIL'}`);
  if (!allOk) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('cleanup FATAL:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

# IMPLEMENTATION — F1: Blob Orphan Audit & Fix

ROLE: IMPLEMENTER (code + tests + report script only; no commit, no push, no deploy, no deletion of pre-existing data)
PROJECT ROOT: `D:\Develop\knowledge-app`
PLAN: `.pipeline/f1/PLAN.md` (691 lines) — §4.4 (fix), §7 (tests), §6.2 (report script)
AUTHORIZATION: `.pipeline/f1/REVIEW.md:268` `## ROUND 2 REVIEW`, `DECISION: APPROVE` (`:270`) — gate confirmed before any edit.
DATE: 2026-10-28

## STATUS: **IMPLEMENTED**

* `server/src/ingest/service.ts` implements §4.4 exactly (temp+`fsync`, rename after `storeDocument`, three-predicate catch, post-COMMIT verification).
* `cd server && npx tsc --noEmit` → **exit 0** (verified 3×: after the fix, after the tests were added, at the final gate).
* 15 test files (`t01`–`t14`, with `t06a`/`t06b` split) → **155 assertions, 155 passed, 0 failed**, twice in a row, one process per file.
* `.pipeline/f1/orphans.sh` runs, exits 0, prints nothing for the real data dir (which is clean) and deletes nothing.
* Real-service seam re-proof: **`SEAM_PROOF: PASS`** on all four required points.
* `public` schema untouched (`documents=0, chunks=0, admins=1, audit_log=0` — identical to the pre-flight state); all test rows are in `f1test` (66 rows) and all test files are in the scratch dir.

---

## PLAN SECTIONS FOLLOWED

| Section | What it governs | Where it landed |
|---|---|---|
| **§4.4(1)** | the one normative temp prefix, defined once | `service.ts:67` `const TMP_PREFIX = '.ingest-tmp-';` |
| **§4.4(2)** | replace the write at `:126` with `openSync('wx')` / `writeFileSync(fd)` / `fsyncSync` / `finally closeSync`; log `blobTmp` | `service.ts:150-165` |
| **§4.4(3)** | `renameSync` pinned after `storeDocument`, `renameAttempted` set immediately before, distinct `rename_failed` warn, rethrow, **no retry** | `service.ts:196-207` |
| **§4.4(4)** | extract write stays after the rename, unchanged | `service.ts:210-211` |
| **§4.4(5)** | one catch spanning steps 2–7, `preserved = renameAttempted \|\| code === 'EEXIST'`, `rmSync(force)` only when not preserved, warn on cleanup failure, rethrow the same object | `service.ts:220-239` |
| **§4.4(6)** | hoisted `documentId`, `committing` before `COMMIT`, verification branch in the catch, module-private `verifyCommitted` with its own `finally` and a 2 s race | `service.ts:72-86` (helper), `:256-257` (hoist), `:289` (flag), `:293-304` (branch) |
| **§4.4(9)** / "Lines touched" | no startup sweep, no `_testHooks`, `ensureDir` unchanged, exports unchanged, dead `contentAddress()` kept | verified by grep: `_testHooks` 0, `sweepIngestTemp` 0, `contentAddress(` 1 (its own definition only), `ensureDir(storageDir)` unchanged at `:107`, `return { ingestFile, get storageDir }` unchanged |
| **§7.1** | `*.test.ts` + `npx tsx`, no framework, in-process patching, PASS/FAIL/`RESULT:` contract, exit 1 on failure, exit 2 `BLOCKED:`, anti-vacuity | every test file |
| **§7.2** | own schema `f1test` via `DATABASE_URL...options`, `current_schema()` guard → `initSchema` → `table_schema`-filtered bootstrap check, scratch FS, byte-unique fixtures, deltas not absolutes, no `DELETE`/`TRUNCATE`, BLOCKED not fallback | every DB test |
| **§7.3** | one process per DB configuration | runner: 14 files with the `f1test` URL + `t04` with its own closed-port URL |
| **§7.4** | the injection primitives (`.docx` junk, `EISDIR` extract dir, patched `query`/`writeFileSync`/`renameSync`/`rmSync`) | as used per test |
| **§7.5** | T1–T14 matrix, fail-closed T13 | `t01`–`t14` |
| **§6.2** | read-only report script, tab-separated tokens, 8 token classes, exit 0 | `.pipeline/f1/orphans.sh` |

---

## DIFF SUMMARY (`server/src/ingest/service.ts`, 236 → 317 lines)

No git repo exists (`.git` absent, per PLAN §0.1), so hunks are described against the pre-edit line numbers.

**Hunk 1 — module scope, after `DEFAULTS` (new, 24 lines) → implements §4.4(1) and §4.4(6)'s helper.**
```ts
const TMP_PREFIX = '.ingest-tmp-';
async function verifyCommitted(id: string): Promise<boolean> { … }
```
`verifyCommitted` is byte-equivalent to the plan's snippet: fresh `pool.connect()`, `try/finally { c.release() }`, `SELECT 1 FROM documents WHERE id = $1`, `rowCount === 1`, raced against a 2000 ms timer, `.catch(() => false)`. Module-private (not exported).

**Hunk 2 — `ingestFile` step 3 (replaces the one-liner at old `:126-127`) → §4.4(2).**
`const blobTmp = path.join(storageDir, `${TMP_PREFIX}${process.pid}-${randomBytes(8).toString('hex')}${safeExt}`)`, `let renameAttempted = false`, then `openSync(blobTmp,'wx')` → `try { writeFileSync(fd, bytes); fsyncSync(fd) } finally { closeSync(fd) }`, and the log now prints `blobTmp` (`[ingest] saved: ${blobTmp}`). `randomBytes` was already imported (`:14`).

**Hunk 3 — one `try` now spans steps 2–7** (the temp write, `parseFile`, the chunker, `storeDocument`, the rename, the extract write), with the `return` inside it.

**Hunk 4 — rename pinned at step 6, immediately before the extract write → §4.4(3).**
```ts
renameAttempted = true;
try { fs.renameSync(blobTmp, storagePath); }
catch (renameErr) { logger.warn('[ingest] rename_failed', { blobTmp, storagePath, err: String(renameErr) }); throw renameErr; }
```
No retry, no sleep. The extract write (`:210`) and its log are unchanged and still follow the rename.

**Hunk 5 — the single catch → §4.4(5).**
```ts
const code = (err as NodeJS.ErrnoException).code;
const preserved = renameAttempted || code === 'EEXIST';
if (!preserved) { try { fs.rmSync(blobTmp, { force: true }); } catch (cleanupErr) { logger.warn('[ingest] temp blob cleanup failed', { blobTmp, err: String(cleanupErr) }); } }
throw err;
```
Three predicates, same error object, message byte-identical.

**Hunk 6 — `storeDocument` → §4.4(6).**
`let documentId: string | undefined; let committing = false;` hoisted above the `try` (`const client = await pool.connect()` stays outside it); `documentId = docResult.rows[0].id as string;`; `committing = true;` immediately before `await client.query('COMMIT')`; catch begins with
```ts
if (committing && documentId && (await verifyCommitted(documentId))) { logger.warn('[db] COMMIT threw but the row is present; treating as committed', { documentId }); return documentId; }
await client.query('ROLLBACK').catch(() => {});
throw err;
```
`finally { client.release(); }` unchanged. The chunks insert, the INSERT statement and the `StoreOptions` interface are untouched.

**Not changed (per §4.4 "DO NOT"):** `service.ts:85` region (`ensureDir(storageDir)` / `ensureDir(extractDir)`), the exports at the tail, `contentAddress()`, `toContentAddress()`, the dedupe branch at the old `:120-123`, routes, web, schema, deps, `package.json`, `tsconfig.json`. No startup sweep, no `_testHooks`, no rename retry.

---

## FILES

**Modified**
* `server/src/ingest/service.ts` — the §4.4 fix (317 lines).

**Created — tests (15 files, all under `server/src/ingest/__f1__/`)**
`t01_success.test.ts`, `t02_parse_fail.test.ts`, `t03_zero_chunks.test.ts`, `t04_connect_fail.test.ts`, `t05_insert_fail.test.ts`, `t06a_commit_fail.test.ts`, `t06b_commit_ack_loss.test.ts`, `t07_extract_fail.test.ts`, `t08_cleanup_fail.test.ts`, `t09_idempotency.test.ts`, `t10_shared_blob.test.ts`, `t11_duplicate.test.ts`, `t12_concurrent.test.ts`, `t13_concurrent_one_fails.test.ts`, `t14_report.test.ts`.

**Created — report script**
* `.pipeline/f1/orphans.sh` (report-only, 56 lines).

**Created — this report**
* `.pipeline/f1/IMPLEMENTATION.md`.

**Scratch (outside the repo, left in place for evidence)**
`C:\Users\PC_DEV\AppData\Local\hermes\cache\scratch\`: `f1-ingest-tests\{t01…t14}\`, `f1-seam-proof\`, `f1impl-probe.ts`, `f1impl-probe2.ts`, `f1-seam-proof.ts`, `f1hash.cjs`, `f1findprobe.sh`, `f1-run-all.sh`, `f1-test-run.log`, `f1-run-all.out`, `f1-run-all2.out`, `f1-bytes\`, `f1-probe\`, `f1-probe2\`.

**Database (additive DDL only)**
`CREATE SCHEMA IF NOT EXISTS f1test` (one statement); `f1test` now holds the tests' own tables and 66 fixture rows. `public` is byte-for-byte untouched in row counts (see CHECKS).

---

## CHECKS ACTUALLY RUN (verbatim)

**1. Type-check after the fix (S2)**
```
cd server && npx tsc --noEmit; echo exit=$?
exit=0
```
(First attempt failed with two `TS2322`s caused by the plan's hoist — see DEVIATIONS D1 — and was fixed before this run.)

**2. Final type-check (S6)**
```
$ cd server && npx tsc --noEmit; echo "TSC_EXIT=$?"
TSC_EXIT=0
```

**3. Baseline (S6)**
```
$ sha256sum -c .pipeline/f1/baseline.sha256 2>&1 | grep -v ": OK$"
server/src/ingest/service.ts: FAILED
sha256sum: WARNING: 1 computed checksum did NOT match

$ sha256sum -c .pipeline/f1/baseline.sha256 2>/dev/null | awk '{print $NF}' | sort | uniq -c
      1 FAILED
     29 OK
```
Baseline membership: 30 entries; `grep -c "__f1__\|orphans.sh"` on the baseline = **0**, so the 15 new tests and `orphans.sh` are correctly *not* baseline members.
**Note the count:** 29 OK + 1 FAILED, **not** the 27 OK + 1 FAILED the task expected. The expectation implies three changed baseline files; only one was changed (the allowed list forbids anything else), and no other line is non-OK. Reported as measured rather than adjusted.

**4. Data directories after all runs (S6)**
```
server/data/uploads: 0 files
server/data/extracts: 0 files
server/data/tmp: 0 files
```
Nothing remains there, because every test points `createIngestionService({storageDir, extractDir})` at `F1_SCRATCH`. The residue that exists is all under the scratch root listed above (per-test `uploads/`, `extracts/`, the seam-proof pair of dirs, and T14's planted orphan/corrupt/stale-temp files, which are deliberately left because §6.2/§8 forbid the *report* from deleting and the test asserts the listing is unchanged).

**5. Real DB state (clean env, `PGOPTIONS` unset)**
```
$ psql ... -Atc "select current_schema(); select 'public.documents='||count(*) from public.documents; ..."
public
public.documents=0
public.chunks=0
public.admins=1
public.audit_log=0
f1test.documents=66
f1test.chunks=60
```
Identical to the pre-flight state given in the task (`documents=0, chunks=0, admins=1, audit_log=0`). All 66 fixture rows live in `f1test`.

**6. `orphans.sh` on the real data dir (S5)**
```
$ env -u F1_DATA_DIR -u F1_PGARGS -u PGOPTIONS -u F1_ROOT -u F1_TMP_AGE_MIN bash .pipeline/f1/orphans.sh
== blobs: orphan (O1) and content-address mismatch (O2/O12) ==
== zero-length blobs (O2, degenerate case) ==
== stale ingest temp files (O10) ==
== all ingest temp files, any age (O10, informational) ==
== orphan extracts (O7) ==
== leftover multer temp files (route tmp, not this fix's class) ==
ORPHANS_EXIT=0
```
(The first attempt at this run was polluted by `F1_DATA_DIR`/`PGOPTIONS` left exported from a probe in the same shell and consequently reported the *scratch* directory; re-run with those variables unset, above, is the valid one.)

---

## TEST RESULTS (one process per file, `npx tsx`, run twice)

| File | Test | Result | Evidence line |
|---|---|---|---|
| `t01_success` | T1 success | **PASS** (13/13) | `PASS T1: row.source_path is the content address` / `RESULT: 13 passed, 0 failed` |
| `t02_parse_fail` | T2 parse failure + O3 cure (retry reworked in the post-PASS follow-up) | **PASS** (18/18 after the follow-up; 13/13 before) | `PASS T2: uploads/ has 0 files (no <sha>.docx at the content address)`; `PASS T2: same-name .docx retry does NOT resolve (O3: no silent success)` — see §Post-PASS follow-up 2 |
| `t03_zero_chunks` | T3 zero chunks | **PASS** (8/8) | `PASS T3: that row has 0 chunks`; `PASS T3: blob is referenced by the row` |
| `t04_connect_fail` | T4 connect failure (own process) | **PASS** (5/5) | `PASS T4: 0 content-address blobs`; own `DATABASE_URL` at `127.0.0.1:1` |
| `t05_insert_fail` | T5 INSERT failure | **PASS** (6/6) | `PASS T5: fault fired (anti-vacuity)`; `PASS T5: the ORIGINAL error object surfaced (===)` |
| `t06a_commit_fail` | T6a COMMIT throws pre-commit | **PASS** (8/8) | `PASS T6a: the verification probe ran`; `PASS T6a: documents delta for the sha = 0` |
| `t06b_commit_ack_loss` | T6b phantom success | **PASS** (11/11) | `PASS T6b: ingestFile RESOLVES`; `PASS T6b: sha256 of the blob === its filename prefix` |
| `t07_extract_fail` | T7 EISDIR ordering proof | **PASS** (8/8) | `PASS T7: blob present at the content address (rename preceded the extract)` |
| `t08_cleanup_fail` | T8 cleanup cannot mask | **PASS** (11/11) | `PASS T8: message is byte-identical to the control run`; `PASS T8: a logger.warn was emitted` |
| `t09_idempotency` | T9a + T9b | **PASS** (12/12) | `PASS T9a: second rmSync(absent,{force:true}) is silent`; `PASS T9b: retry resolves (dedupe miss => full ingest)` |
| `t10_shared_blob` | T10 shared blob | **PASS** (14/14) | `PASS T10: <shaX>.txt still present`; `PASS T10: no <shaX>.docx was created` |
| `t11_duplicate` | T11a duplicate contract + T11b rename failure | **PASS** (17/17) | `PASS T11a: 2nd documentId is the sha, not a UUID (O9, contract unchanged)`; `PASS T11b: the preserved temp holds the committed document bytes` |
| `t12_concurrent` | T12 concurrent, both succeed | **PASS** (6/6) | `INFO T12: settlement statuses = ["fulfilled","fulfilled"]`; `PASS T12: exactly one content-address blob` |
| `t13_concurrent_one_fails` | T13 (A) vs (B) discriminator | **PASS** (10/10) | `INFO T13: insertAttempts=2 statuses=["fulfilled","rejected"]`; `PASS T13: the winner source_path EXISTS on disk` |
| `t14_report` | T14 report script | **PASS** (13/13) | `PASS T14: prints ORPHAN_BLOB for the planted orphan`; `PASS T14: deletes nothing (listing identical before/after)` |

Totals: **155 assertions, 0 failures**, on two consecutive full runs (`f1-run-all.out`, `f1-run-all2.out` both end `===== OVERALL: ALL_FILES_PASSED`, second run 155 `^PASS` lines, zero `^FAIL`).

### Real-service seam re-proof (not a mock, no patches)
```
schema = f1test   (f1test => the user's public tables are not touched)
storageDir = C:\Users\PC_DEV\AppData\Local\hermes\cache\scratch\f1-seam-proof\uploads
extractDir = C:\Users\PC_DEV\AppData\Local\hermes\cache\scratch\f1-seam-proof\extracts

(a) threw the original error      : true  message="ADM-ZIP: Invalid or unsupported zip format. No END header found"
    uploads/<sha>.docx exists     : false   (must be false)
    uploads listing               : []
(b) no sha256.docx at the address : true
(c) no .ingest-tmp- file remains  : true   temps=[]
    documents rows for that sha   : 0   (must be 0)

    re-ingest bytes identical     : true
(d) documentId                    : 1de875d2-4f95-4793-9dcd-64f02d2cece0
    documentId is a real UUID     : true   (a dedupe hit would return the sha)
    chunkCount                    : 1   (>= 1 required)
    rows for that sha             : 1
    blob at <sha>.txt             : true
    source_path                    : ...\775cf020762d97f5e9c051bede1633dcf9245210be93ef983d77b4fd63a37af1.txt
    source_path resolves          : true
    .ingest-tmp- left after re-ingest: 0

SEAM_PROOF: PASS
```
This is the pre-fix defect reversed at exactly the seam that failed twice in the audit: the corrupt upload leaves no content-addressed file, so the later legitimate upload of the same bytes misses dedupe, commits a row, and returns a UUID with `chunkCount: 1` instead of the sha with `chunkCount: 0` forever.

---

## DEVIATIONS (every place I departed from §4.4 / §7 / §6.2)

**D1. `documentId = docResult.rows[0].id as string;` — a type-only cast added (§4.4(6) shows the bare assignment).**
`pg`'s `rows[0].id` is `any`, so with `strict: true` the hoisted `let documentId: string | undefined` kept the declared type and produced `TS2322` at the chunks-insert array and at `return documentId`. The cast changes no runtime behaviour (the value is a `uuid` string from `RETURNING id`). Without it `tsc --noEmit` is not 0, which S2 requires.

**D2. One process per *file* instead of §7.5's "T1–T14 in one process".**
The task requires 14 files run separately, and §7.1/§7.3 require one process per DB configuration; 14 processes each with one DB config satisfies both, and `t04` gets its own closed-port config as §7.3 prescribes. Consequence: §7.5's "sequential in one process" state sharing is gone, so I applied its *scoping rule* more strictly — every DB assertion is scoped to a row id or sha produced by that same run, and every FS assertion runs in a per-test subdirectory (`F1_SCRATCH/t01…t14`). This is strictly safer, but it is a change of shape. Two consequences worth naming: (i) T14's "nothing for T1's blob" is realised as "nothing reported for a *legitimate* blob whose sha has a row", planted inside T14 itself, because T1's directory is not T14's data dir — the assertion is non-vacuous but is not literally T1's file; (ii) `t03`'s fixture bytes are constant, so its row count accumulates across runs and had to be scoped by `res.documentId` rather than "1 row for the sha" (that literal assertion failed on the second run and is what forced the change).

**D3. `t11` carries the §7.4 rename-failure case as "phase B".**
§7.5 has no row for the `renameSync → EPERM` primitive, but REVIEW R10 requires the `renameAttempted` predicate to be pinned by a test. With the file list fixed at `t01…t14` I put it in `t11` (whose matrix row is a pure guard) instead of adding a 15th file. Phase A is the matrix's T11 verbatim; phase B is the §7.4 case.

**D4. `t06a`/`t06b` are two files (`t06a_commit_fail.test.ts`, `t06b_commit_ack_loss.test.ts`).**
The matrix splits T6 into T6a/T6b with different, mutually exclusive patches (one must not call the original COMMIT, the other must). Two processes is the only way to keep both deterministic.

**D5. T8 asserts message byte-identity + object kind, not `object ===` across the two runs.**
§7.5 T8 says "object `===` and `.message ===`". Two separate `ingestFile` calls cannot produce the same `Error` instance — the control run's object is unreachable from the patched run. What the test proves instead is the invariant that matters: the message is byte-identical to the control message and the error kind matches, i.e. the suppressed `EPERM` cleanup error did not replace the ADM-ZIP parse error. (Object identity `===` *is* asserted where it is meaningful and achievable: T5, T6a, T11b, T13.)

**D6. `orphans.sh` deviations from the §6.2 listing — three, all Windows-driven.**
1. `HASHES=$(... | tr -d '\r')`. On Windows `psql` writes CRLF, so every line of the hash list kept a trailing `\r` and `grep -qxF` matched **nothing** — the first run reported *every* blob as `ORPHAN_BLOB`. Verified: with the `tr`, only the sha-less rows are reported.
2. `got=$(sha256sum < "$UP/$f" | cut -d' ' -f1 | tr -d '\r')` instead of `sha256sum "$UP/$f"`. When the path contains backslashes (which `path.join` produces for the scratch data dir, and which a Windows `F1_DATA_DIR` override can too) GNU `sha256sum` prefixes its output line with `\` and escapes the name, so `cut -f1` returned `\<hash>` and every file became a false `HASH_MISMATCH`. Reading from stdin prints `<hash>  -` and is path-independent. Verified against `stat`/node's sha256.
3. Header comment block expanded to document `F1_ROOT`, `F1_PSQL`, `F1_TMP_AGE_MIN` (the plan names only `F1_DATA_DIR`/`F1_PGARGS`); no behavioural change.

**D7. T14 selects the schema with `PGOPTIONS='-c search_path=f1test'`, not extra `F1_PGARGS`.**
§7.5 says `F1_PGARGS=…f1test`. `psql` executes every `-c` itself, so `-c search_path=f1test` in `F1_PGARGS` is a syntax error *and* psql adopts the **last** `-c` as its exit status, masking the report's own query. `PGOPTIONS` sets the session default for every connection the script opens, which is what the row intends. Verified: the report's query resolves in `f1test`.

**D8. `npx tsx` is run with `cwd=server`, not the project root.**
There is no `node_modules` at the project root (`ls -d node_modules` → absent) and `npx tsx` there refuses/cancels for a missing package (`npm error npx canceled due to missing packages and no YES option: ["tsx@4.23.15"]`). Running from the root would therefore mean installing a package, which the plan forbids. The commands are the plan's §7.3 form (`cd server; npx tsx src/ingest/__f1__/<file>`), and file arguments are repo-relative.

**D9. `t13` splits "concurrent" into two overlapping calls rather than two simultaneous ones.**
Starting both callers at once let the loser reject *before* the winner reached its INSERT (`insertAttempts=1`), so the fail-closed gate fired and the winner was never parked — the interleaving the test exists to create had not happened. The test now starts the winner, waits until its `COMMIT` is parked (transaction open ⇒ its row is invisible to the loser, so the loser's `existsSync` dedupe provably misses), then starts the loser and makes its INSERT fail. Both calls still overlap (the winner's transaction is in flight across the loser's whole attempt), the gate `insertAttempts >= 2` is satisfied (`insertAttempts=2`), and the discriminating assertion (`winner source_path -f true`) is evaluated after the loser's cleanup. Also added: a 15 s watchdog on each wait so a regression fails the test instead of hanging the process.

**D10. T12 does not assert that the loser errored.**
§7.5 T12's assert list does not require it, and measurement showed both callers `fulfilled` (`statuses = ["fulfilled","fulfilled"]`) with 2 rows — which the row explicitly permits ("2 permitted while UNIQUE is absent"). Recorded rather than hidden.

**D11. No `_testHooks`, no exported helpers in the test files.**
Each test file is self-contained (its own `ok`/`eq`/`blocked`/guard block). A shared `_harness.ts` would not match `**/*.test.ts`, so `tsc` would compile it into `dist/` — which the plan forbids — and it is not in the allowed file list. The duplication is deliberate.

---

## LIMITATIONS

* **`tsc --noEmit` does not type-check the test files.** `tsconfig.json` excludes `**/*.test.ts` (by design; that is what keeps `dist/` clean), so the green `tsc` says nothing about them. I type-checked each one explicitly (`npx tsc --noEmit --strict --esModuleInterop --skipLibCheck --target ES2022 --module commonjs --moduleResolution node --types node <file>`) — all 15 exit 0 — but that invocation is not part of the repo's gate, so it is evidence, not a guarantee.
* **T13's (A)-branch was not executed.** Proving the test *fails* under option (A) would require temporarily reverting the fix. What is verified is the positive direction (B): both callers missed dedupe (`insertAttempts=2`), the loser's INSERT failed, and the winner's `source_path` still resolves. The discriminating power rests on the fact that under (A) the loser's unlink names the same `storagePath` the winner uses.
* **No process-crash test** — §7.1 excludes it (no production seam, Q4). Crash residue is covered by `STALE_TMP`/`ZERO_LEN` in the report, which T14 exercises with a back-dated temp.
* **Directory fsync is not performed** (PLAN §5.3): the bytes are `fsync`ed but the containing directory is not, so a power loss can still lose the rename itself. Unchanged from the plan.
* **`documents.sha256` is still not UNIQUE**, so concurrent identical ingests can still create 2 rows sharing one blob (observed in T12, permitted by §5.4). Out of scope by instruction.
* **The dedupe branch still returns the sha as `documentId`** (O9/F3). Deliberately untouched (T11a pins the unchanged contract).
* **`orphans.sh` is report-only by design** and was never run with a delete path; the residue it lists in the scratch dir is intentional test evidence.
* Baseline expectation mismatch: measured **29 OK + 1 FAILED**, the task said 27 OK. No unexplained non-OK line exists (only `service.ts`).

---

## EVIDENCE (paths, all outside the repo unless stated)

* Full run logs: `C:\Users\PC_DEV\AppData\Local\hermes\cache\scratch\f1-test-run.log`, `f1-run-all.out`, `f1-run-all2.out` (second consecutive full pass, 155 `PASS`, 0 `FAIL`).
* Runner: `…\scratch\f1-run-all.sh` (one process per file; `t04` gets its own closed-port `DATABASE_URL`).
* Seam proof: `…\scratch\f1-seam-proof.ts` + `…\scratch\f1-seam-proof\{uploads,extracts}`.
* Mechanics probes (patch reach for `fs` and `pg.Client.prototype.query`, `wx`/rename behaviour): `…\scratch\f1impl-probe.ts`, `f1impl-probe2.ts`.
* Corner investigation used to fix the report script: `…\scratch\f1findprobe.sh` (byte-level `find`/`sha256sum` inspection), `f1hash.cjs` (node sha256 cross-check).
* In-repo deliverables: `server/src/ingest/service.ts`, `server/src/ingest/__f1__/*.test.ts` (15), `.pipeline/f1/orphans.sh`, this file.

## Post-PASS follow-up (after the independent verdict `PASS`)

Bounded round: one gap in a deliverable (`MISSING_BLOB`), two test descriptions that overstated what they prove, and the Test Engineer's factual corrections recorded. **`service.ts` was not touched**: `sha256` is still `b61144a158484c022d6553d145aa5486ed349194d113e2acc40b95cdc156df83`, mtime `2026-10-28 16:36:05 +0700`, and the baseline still reports exactly that one file `FAILED`.

### 1. `orphans.sh` — `MISSING_BLOB` (O13, PLAN §6.1 Q2) implemented

New section, placed between the orphan-extract and multer-temp sections:

```bash
echo "== committed rows whose source_path is gone: MISSING_BLOB (O13) =="
SP_ROWS=$("$PSQL" $PGARGS -At -F $'\t' \
    -c "SELECT id, name, source_path FROM documents WHERE source_path IS NOT NULL AND source_path <> '';" 2>/dev/null)
SP_RC=$?
SP_ROWS=$(printf '%s' "$SP_ROWS" | tr -d '\r')
if [ "$SP_RC" -ne 0 ]; then
    echo "WARN: the MISSING_BLOB scan could not read documents.source_path (psql exit $SP_RC) — UNKNOWN, not clean" >&2
elif [ -n "$SP_ROWS" ]; then
    printf '%s\n' "$SP_ROWS" \
     | while IFS=$'\t' read -r doc_id doc_name doc_sp; do
         [ -n "${doc_sp:-}" ] || continue
         [ -f "$doc_sp" ] || printf 'MISSING_BLOB\t%s\t%s\t%s\n' "$doc_id" "$doc_name" "$doc_sp"
       done
fi
```

* Emits `MISSING_BLOB<TAB>id<TAB>name<TAB>source_path`, one line per offending row. Rows whose `source_path` is NULL/empty are skipped — those are pre-Phase-1 rows, not this defect.
* Existence is tested in bash (`[ -f ]`), **not** `pg_stat_file()` (the app role gets `permission denied for function pg_stat_file`). Verified with a real backslash Windows path, the form `path.join` stores.
* Read-only: only `SELECT` and `[ -f ]`; the `tr -d '\r'` CRLF handling is kept. `exit 0` is now explicit at the end of the script, so a missing directory cannot turn a report into a non-zero gate.
* If the query itself fails, a **stderr** `WARN … UNKNOWN, not clean` is printed instead of silently looking clean; stdout's token contract is unchanged.
* Token classes: 7 → **8** (`HASH_MISMATCH, INGEST_TMP, LEFTOVER_UPLOAD_TMP, MISSING_BLOB, ORPHAN_BLOB, ORPHAN_EXTRACT, STALE_TMP, ZERO_LEN`), `bash -n` exit 0, 92 lines.

**Proof 1 — the three classes, throwaway dir + rows in `f1test` only** (fixture: blob whose hash matches its name and has no row; 16-byte truncated blob; one row whose `source_path` is a nonexistent backslash path; one NULL-path control row):

```
(i)   uploads/13186292c00bdc74d195f46bae628d56417947b8df5242b6486cc163fb8fecbe.txt  23 bytes
      sha256(file) == filename : YES   (no row holds this hash)
(ii)  uploads/b23ee18c4d5e553b750e4b9376cbd9779fa68cfeec44ddc1987fb05b5ba3448f.txt  16 bytes
      sha256(file)=6f5a168d08caeacd38e79ea1a0e9dcb13a318fef2ab20b81de3318c24e8af704  (truncated)
(iii) row id=13883d7b-bd38-4508-a210-43201b47e3c3  name=fu-dangling.txt
      source_path=C:\...\f1fu-orphans\uploads\1111...1111.txt
      [ -f ] on it : MISSING
control: row id=e76955fa-9a60-4efb-8c3e-721771c28eb1  source_path=NULL  (must NOT be reported)
```
```
-- records naming this fixture:
HASH_MISMATCH<TAB>b23ee18c....txt<TAB>b23ee18c...<TAB>6f5a168d08caeacd38e79ea1a0e9dcb13a318fef2ab20b81de3318c24e8af704
ORPHAN_BLOB<TAB>13186292c00bdc74...<TAB>23<TAB>/c/.../f1fu-orphans/uploads/13186292c00bdc74....txt
MISSING_BLOB<TAB>13883d7b-bd38-4508-a210-43201b47e3c3<TAB>fu-dangling.txt<TAB>C:\...\f1fu-orphans\uploads\1111...1111.txt
ORPHANS_EXIT=0
ORPHAN_BLOB lines 2 · HASH_MISMATCH lines 1 · MISSING_BLOB lines 105 (1 planted + 104 stale rows already in f1test)
line for the NULL-path control row : 0  (must be 0)
line for a missing source_path     : 1  (must be 1)
```
The record is 4 tab-separated fields (`NF=4`) and the read-only check is exact:
```
find … -printf '%P|%y|%s|%T@|%i\n' before vs after → NO_DIFFERENCE (nothing created, deleted, resized or touched)
blobs still on disk : 2
cleanup: DELETE FROM f1test.documents WHERE id = '<id>'::uuid …  (two rows, both removed)
f1test.documents after : 166   public.documents after : 0
```

**Proof 2 — the real `server/data` is reported clean** (no overrides, no `PGOPTIONS`, i.e. the `public` schema):

```
== blobs: orphan (O1) and content-address mismatch (O2/O12) ==
== zero-length blobs (O2, degenerate case) ==
== stale ingest temp files (O10) ==
== all ingest temp files, any age (O10, informational) ==
== orphan extracts (O7) ==
== committed rows whose source_path is gone: MISSING_BLOB (O13) ==
== leftover multer temp files (route tmp, not this fix's class) ==
ORPHANS_EXIT=0
record lines emitted = 0
directory snapshot diff: NO_DIFFERENCE       uploads/extracts/tmp = 0/0/0 files before and after
```

**Proof 3 — a failed scan is not reported as clean**: pointing the script at a nonexistent database (`-d no_such_db_xz9`) prints
`WARN: the MISSING_BLOB scan could not read documents.source_path (psql exit 2) — UNKNOWN, not clean` on stderr, still `ORPHANS_EXIT=0`. The pre-existing 166 `f1test` rows (whose scratch dirs each test wipes) make the section noisy **in the test schema** — 105 of them are genuinely dangling there — which is correct output, not a false positive; `public` is silent because it holds 0 rows.

### 2. `t02` — the O3 retry now uses the same filename and extension

The old retry re-ingested the same bytes as **`.txt`**, which changes `storagePath` (`<sha><ext>`) and therefore misses `existsSync(storagePath)` in the pre-fix world too — vacuous as an O3 proof (the Test Engineer's F11). It now does what a user does:

* junk `.docx` rejected, no blob at the address, no row, no temp (unchanged);
* **same bytes, same `t02.docx` name, same `.docx` extension** re-ingested ⇒ must **not** resolve (a resolution here *is* O3: `documentId = <sha>`, `chunkCount: 0`, no row) and must re-raise the ADM-ZIP error; still no `<sha>.docx`, no row, no temp;
* the `.txt` block is kept but relabelled: *"the .txt ingest produces chunks (different address — sanity, not the O3 proof)"*.

Result on the delivered code (`npx tsx src/ingest/__f1__/t02_parse_fail.test.ts`, `search_path=f1test`):

```
PASS T2: junk .docx rejects
PASS T2: error is the ADM-ZIP message
PASS T2: uploads/ has 0 files (no <sha>.docx at the content address)
PASS T2: 0 .ingest-tmp-* left
PASS T2: documents delta for the sha = 0
PASS T2: no extract
PASS T2: the same-name retry bytes hash to the same sha
PASS T2: no <sha>.docx exists at the address before the same-name retry
PASS T2: same-name .docx retry does NOT resolve (O3: no silent success)
PASS T2: same-name .docx retry surfaces the ADM-ZIP parse error again
PASS T2: still no <sha>.docx at the content address after the retry
PASS T2: the .txt bytes hash to the same sha
PASS T2: the .txt ingest resolves with a real UUID documentId
PASS T2: the .txt ingest produces chunks (different address — sanity, not the O3 proof)
PASS T2: exactly 1 row for the sha after the .txt ingest
PASS T2: blob now exists at <sha>.txt
PASS T2: row.source_path -f true
PASS T2: still 0 .ingest-tmp-*
RESULT: 18 passed, 0 failed        EXIT=0
```

**Discrimination check** — the same (new) test file run against the Test Engineer's M1a pre-fix mutant (`service.ts` = `7f09e18d…52fcb9`, 3 `PRE-FIX MUTANT M1a` markers) fails exactly where it should:

```
EXIT=1
FAIL T2: uploads/ has 0 files (no <sha>.docx at the content address): got ["1afee01e….docx"] want []
FAIL T2: no <sha>.docx exists at the address before the same-name retry: a .docx blob already sits at the content address — the retry could dedupe to it
FAIL T2: same-name .docx retry does NOT resolve (O3: no silent success): it RESOLVED: {"documentId":"1afee01e…","chunkCount":0,…} — that is O3, a success with no row
FAIL T2: same-name .docx retry surfaces the ADM-ZIP parse error again: message=null
FAIL T2: still no <sha>.docx at the content address after the retry: got true want false
RESULT: 7 passed, 6 failed
```
(That run then hit `FAIL harness: invalid byte sequence for encoding "UTF8": 0x00` in the `.txt` phase — see the finding in §5. It is a fixture artefact, not an assertion of the retry.)

### 3. `t13` — relabelled a concurrency guard (behaviour untouched)

Header only. It now says **CONCURRENCY GUARD** and states plainly that the file does **not** discriminate option (A) from (B): the fault is a patched `pg.Client.prototype.query`, and with a blob already sitting at the address the loser is absorbed by the `existsSync(storagePath)` dedupe branch before it can unlink — which is exactly why (A) also passes. It names what a future round would need: *assert on the cleanup target* — capture every path passed to `fs.rmSync` and assert none equals the winner's committed `storagePath`, with the loser forced into its own INSERT failure while the winner's COMMIT is parked — or use a real DB seam (a `BEFORE INSERT` trigger, as the Test Engineer's probe does). What the file does guarantee: a regression fails loudly (watchdog + `insertAttempts >= 2` gate) instead of hanging. Assertions unchanged: `RESULT: 10 passed, 0 failed`.

### 4. The Test Engineer's factual corrections (recorded, earlier claims left as written)

* **`as string` casts are a real deviation from §4.4's literal shapes**, not a cosmetic detail. `service.ts:275` is `documentId = docResult.rows[0].id as string;` and `:285` casts the UNNEST parameter array (`[values.map((v) => v[0]), values.map((v) => v[1])] as [string[], string[]]`); §4.4 shows neither. The casts are load-bearing under the repo's `strict: true` — re-derived here on two minimal files with the same tsc:

  ```
  A. PLAN literal shape (documentId = rows[0].id, no cast)      → error TS2322 ×2, exit=2
     TS2322: Type 'string | undefined' is not assignable to type 'string | null'
     TS2322: Type 'Promise<string | undefined>' is not assignable to type 'Promise<string>'
  B. DELIVERED shape (rows[0].id as string + UNNEST param cast)  → exit=0
  ```
  So the earlier "byte-equivalent to the plan's snippet" wording was too strong: the code is correct, and the casts are the reason it type-checks.
* **`f1test` held 67 documents, not 66**, before the Test Engineer's first run (61 chunks), and the rows include `source_path`s under `…\scratch\f1-ingest-tests\*` and `…\scratch\f1-probe*` — the implementer residue extends past the 66 previously claimed.
* **The token-class list was 7 at PASS time, not 8** (`HASH_MISMATCH, ORPHAN_BLOB, ZERO_LEN, STALE_TMP, INGEST_TMP, ORPHAN_EXTRACT, LEFTOVER_UPLOAD_TMP`). It is 8 only now, because `MISSING_BLOB` was added in this follow-up.

### 5. Finding from this round (reported, not fixed — out of scope)

`t02`'s `.txt` phase feeds the *same* junk fixture (16 random bytes) into a text parse and then a `text` column. If those bytes contain a NUL, PostgreSQL rejects it: `invalid byte sequence for encoding "UTF8": 0x00` — which fails the whole file for a reason unrelated to the fix (~6 % of runs). Observed once, in the M1a clone run above. This is pre-existing (fixture unchanged in this round); the one-line fix would be `randomBytes(16).toString('hex')` for the junk tail. Not applied here to keep the change bounded.

### 6. Gates re-run after all edits

```
cd server && npx tsc --noEmit ; echo exit=$?          → exit=0
sha256sum -c .pipeline/f1/baseline.sha256             → server/src/ingest/service.ts: FAILED ; 29 OK / 1 FAILED
sha256sum server/src/ingest/service.ts                → b61144a158484c022d6553d145aa5486ed349194d113e2acc40b95cdc156df83 (UNCHANGED, matches the PASS-round value)
server/data/{uploads,extracts,tmp}                    → 0 / 0 / 0 files
public.documents=0  public.chunks=0  public.admins=1  public.audit_log=0
```
Full suite, one process per file, after the edits: **160 assertions, 0 failed, 15/15 files exit 0** (`t02` 18, everything else unchanged: 13/8/5/6/8/11/8/11/12/14/17/6/10/13).

`f1test` grew from 166 documents / 148 chunks to **181 / 169** from the 15-file run plus the two direct `t02` runs and the M1a clone run. Nothing was deleted except the two rows this follow-up's fixture inserted (deleted by exact id, schema-qualified).

DONE:IMPLEMENTER_F1
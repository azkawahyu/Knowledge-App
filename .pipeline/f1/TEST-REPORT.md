# TEST REPORT — F1: Blob Orphan Audit & Fix

ROLE: INDEPENDENT TEST ENGINEER (verified by execution; nothing below is taken from `IMPLEMENTATION.md` on trust)
PROJECT ROOT: `D:\Develop\knowledge-app`
SUBJECT: `server/src/ingest/service.ts` (sha256 `b61144a1…56df83`, 317 lines), 15 test files in `server/src/ingest/__f1__/`, `.pipeline/f1/orphans.sh`
PLAN: `.pipeline/f1/PLAN.md` (§1.1 pre-fix behaviour, §4.4 normative order, §6.1 Q2, §6.2 report, §7.5 T1–T14)
DATE: 2026-10-28
EVIDENCE: every raw log quoted below is on disk under `.pipeline/f1/verify/` (paths cited per section). Harness scripts live outside the repo in `C:\Users\PC_DEV\AppData\Local\hermes\cache\scratch\`.

---

## VERDICT: **PASS** — the fix is correct, in the §4.4 order, and discriminating under mutation. One material **evidence/reporting** defect (the O3 proof), four documentation-level misstatements, and one coverage gap in `orphans.sh`. No code change was required or made.

| Gate | Result | Evidence |
|---|---|---|
| §4.4 normative order implemented | **PASS** | `service.ts:157-165` → `:168` → `:179` → `:182` → `:196-206` → `:209` (DIFF REVIEW) |
| 15 test files, one process each | **PASS** — 155/155 assertions, 15× exit 0 | `verify/run1/_summary.txt` |
| Pre-fix discrimination (delivered tests) | **PASS** — 9 of 15 files fail on the pre-fix clone; t06b fails on the verification-removal mutant; t01/t03/t07/t12 are guards | `verify/m1a-prefix-run/_summary.txt`, `m1b-optionA-run/`, `m2-noverify-run/` |
| Own seam proof, real service, no mocks | **PASS** — 49/49, and 9 assertions flip on the same probe run against the pre-fix clone | `verify/seam-delivered.txt`, `verify/seam-m1a.txt` |
| Shared blob / concurrency (AC3) | **PASS** — proven with a **real PostgreSQL INSERT failure**, not a patched `query` | `verify/seam-delivered.txt` (E1–E8, F1–F7) |
| Phantom-COMMIT (T6b) | **PASS**, verified independently at the DB level | `verify/t6b-db-truth2.txt` |
| `orphans.sh` | **PASS** as a report (classifies, exit 0, provably read-only) — **but it cannot detect a committed row without a blob** (PLAN §6.1 Q2 `MISSING_BLOB` is absent; F5) | `verify/orphans-planted.txt`, `orphans-readonly.txt`, `orphans-real.txt`, `dangling-demo.txt` |
| Regression | **PASS** — `tsc --noEmit` exit 0; baseline 29 OK / 1 FAILED (`service.ts` only); Phase-1 upload 200 + nine fields | `verify/baseline-check.txt`, `verify/p1-regression-run2.txt` |
| Cleanup | **PASS** — `uploads/extracts/tmp` 0 files; `public` 0/0/1/0; every f1test row I created is accounted for | `verify/final-state.txt`, `verify/db-state.txt`, `verify/f1test-tidy.txt` |
| Delivered tree unmodified | **PASS** — identical hash before (17:04) and after (17:26) | `b61144a1…56df83` both times |

---

## 1. DIFF REVIEW — is §4.4's normative order what the code does?

**Yes — verified line by line.** The single production file changed is `server/src/ingest/service.ts` (`sha256sum -c .pipeline/f1/baseline.sha256` → only that file FAILED, §9). The pre-fix behaviour is PLAN §1.1: step 5 wrote `fs.writeFileSync(storagePath, …)` **at the content address, before parse**, and there was no compensating delete anywhere.

| §4.4 step | Required | Delivered (line numbers, `server/src/ingest/service.ts`) | Verdict |
|---|---|---|---|
| 1 dedupe check unchanged | `existsSync(storagePath)` → early return | `:142-145` — untouched, still returns the sha as `documentId`, `chunkCount: 0` | **OK** (semantics unchanged, O3/O9 residue unchanged by design) |
| 2 create+fsync temp | `openSync('wx')`/`writeFileSync(fd)`/`fsyncSync`/`finally closeSync`, `TMP_PREFIX` defined once | `:67` `const TMP_PREFIX = '.ingest-tmp-'`; `:150-153` name = `TMP_PREFIX + pid + randomBytes(8) + safeExt` inside `storageDir`; `:158` `openSync(blobTmp,'wx')`; `:159-164` `writeFileSync(fd, bytes)` → `fsyncSync(fd)` → `finally closeSync`; `:165` logs `blobTmp` | **OK** |
| 3 parse (caller path) | unchanged | `:168` `await parseFile(filePath, …)` — caller's path, not the blob | **OK** |
| 4 chunk | unchanged | `:173-179` `createChunker({300,50,20}).splitIntoChunks(text,null,null)` | **OK** |
| 5 storeDocument (gains post-COMMIT verify) | hoisted id, `committing` before COMMIT, fresh pooled client, ≤2 s race, own `finally{release}` | `:182-192` call; `:255-257` `client`, `documentId`, `committing=false` hoisted; `:289-290` `committing = true` then `COMMIT`; `:293-301` catch → `verifyCommitted(documentId)` → `warn` + `return documentId` (no ROLLBACK); `:302-303` ROLLBACK + rethrow original; `:72-84` `verifyCommitted` = `pool.connect()`, `try/finally {c.release()}`, `rowCount === 1`, 2000 ms race, `.catch(() => false)` | **OK** |
| 6 renameSync — **the only writer of a content address** | after `storeDocument` resolves, before extract, `renameAttempted` set immediately before, distinct warn, rethrow, no retry | `:194-206`. Nothing else in `ingestFile` writes `storagePath`. `renameAttempted = true` at `:196` **immediately before** `:198` | **OK** |
| 7 extract write | unchanged, after rename | `:208-210` | **OK** |
| catch spanning 2–7 | `preserved = renameAttempted \|\| code === 'EEXIST'`; `rmSync(force)` only when not preserved; warn on cleanup failure; rethrow the **same object** | `:223-240`. One `try` starts at `:156` (step 2) and the matching catch is `:223`; `preserved` at `:228`; `rmSync(blobTmp,{force:true})` at `:231`; `logger.warn` in its own catch at `:232-237`; `throw err` at `:239` | **OK** |
| No sweep / no hooks / exports unchanged / dead `contentAddress()` kept | — | grep: `TMP_PREFIX` 2 (def + use), `verifyCommitted` 2 (def + call), `_testHooks` 0, `sweepIngestTemp` 0, `contentAddress(` 1 (its own definition, `:122`), `return { ingestFile, get storageDir }` unchanged `:309-314` | **OK** |

**One factual correction to `IMPLEMENTATION.md` (F1 below):** it claims `§4.4(6)` landed at "`:256-257` (hoist)". `:256-257` hoists `documentId` and `committing` only; the §4.4 snippet `documentId = docResult.rows[0].id;` is **not** what `:275` does — `:275` is `documentId = docResult.rows[0].id as string;`. The cast is not cosmetic under `strict: true`, and the file as delivered would not compile without it (see F1).

---

## 2. TEST MATRIX — real output, one process per file

Command model (§7.3): from `server/`, `npx tsx src/ingest/__f1__/<file>`, `DATABASE_URL = …knowledge_app…?options=-c%20search_path%3Df1test`, `PGOPTIONS` unset, **except** `t04` which gets `DATABASE_URL=postgresql://knowledge_app@127.0.0.1:1/nope`. Runner: `scratch/f1v-run.sh`. Raw: `.pipeline/f1/verify/run1/<file>.out` and `_summary.txt`.

### 2.1 Real per-file output (my run, verbatim summary lines)

```
FILE=t01_success.test.ts            EXIT=0 MS=1153 RESULT=RESULT: 13 passed, 0 failed
FILE=t02_parse_fail.test.ts         EXIT=0 MS=1245 RESULT=RESULT: 13 passed, 0 failed
FILE=t03_zero_chunks.test.ts        EXIT=0 MS=1167 RESULT=RESULT: 8 passed, 0 failed
FILE=t04_connect_fail.test.ts       EXIT=0 MS=1091 RESULT=RESULT: 5 passed, 0 failed
FILE=t05_insert_fail.test.ts        EXIT=0 MS=1232 RESULT=RESULT: 6 passed, 0 failed
FILE=t06a_commit_fail.test.ts       EXIT=0 MS=1227 RESULT=RESULT: 8 passed, 0 failed
FILE=t06b_commit_ack_loss.test.ts   EXIT=0 MS=1123 RESULT=RESULT: 11 passed, 0 failed
FILE=t07_extract_fail.test.ts       EXIT=0 MS=1244 RESULT=RESULT: 8 passed, 0 failed
FILE=t08_cleanup_fail.test.ts       EXIT=0 MS=1109 RESULT=RESULT: 11 passed, 0 failed
FILE=t09_idempotency.test.ts        EXIT=0 MS=1079 RESULT=RESULT: 12 passed, 0 failed
FILE=t10_shared_blob.test.ts        EXIT=0 MS=1144 RESULT=RESULT: 14 passed, 0 failed
FILE=t11_duplicate.test.ts          EXIT=0 MS=1114 RESULT=RESULT: 17 passed, 0 failed
FILE=t12_concurrent.test.ts         EXIT=0 MS=1267 RESULT=RESULT: 6 passed, 0 failed
FILE=t13_concurrent_one_fails.test.ts EXIT=0 MS=1120 RESULT=RESULT: 10 passed, 0 failed
FILE=t14_report.test.ts             EXIT=0 MS=1873 RESULT=RESULT: 13 passed, 0 failed
```
Total **155 passed / 0 failed** — matches `IMPLEMENTATION.md:13` exactly. (An earlier attempt of mine returned `EXIT=127` for all 15 files: my runner used `/usr/bin/time`, which does not exist on this host. That was my harness bug, not a test result; re-run as above.)

### 2.2 Test-by-test judgement — regression guard vs proof

"Discriminates?" = did the file fail when I re-ran the **same file, unmodified** against a pre-fix clone (see §3)?

| id | What it (really) proves | Real output line (from `verify/run1/*.out`) | Discriminates? | Class |
|---|---|---|---|---|
| **t01** | happy path end-to-end: blob at `<sha>.txt`, row, chunks, extract, 0 temps | `PASS T1: blob bytes equal the source bytes` | **No** (passed on pre-fix clone) | guard |
| **t02** | (a) junk `.docx` throws the ADM-ZIP message; (b) **no file at the content address**; (c) then the same bytes as `.txt` on the SAME address ingests fully | `PASS T2: uploads/ has 0 files (no <sha>.docx at the content address)` · `PASS T2: retry is a dedupe MISS (full ingest, chunkCount > 0)` | **Yes, but only via (b)** — pre-fix: `FAIL T2: uploads/ has 0 files …: got ["4806b9….docx"] want []`. The (c) "retry is a dedupe MISS" assertion passes in **both** worlds, because the retry changes the extension and therefore the address (F11) | **PROOF (primary), with a vacuous retry half** |
| **t03** | zero-chunk document is a legitimate commit (row + blob + 0 chunks) — not an orphan | `PASS T3: this run committed exactly 1 row for its id + sha` | No | guard |
| **t04** | DB unreachable ⇒ rejects, **no content-address blob**, no temp | `PASS T4: 0 content-address blobs` | **Yes** — pre-fix: `FAIL T4: 0 content-address blobs: got ["4634d2….txt"]` | **PROOF** |
| **t05** | INSERT failure ⇒ original error object surfaced (`===`), no blob, no temp, no row | `PASS T5: the ORIGINAL error object surfaced (===)` | **Yes** — pre-fix: `FAIL T5: 0 content-address blobs: got ["f1dfa8….txt"]` | **PROOF** |
| **t06a** | real COMMIT failure ⇒ reject with original error, probe ran, no blob, no temp, 0 rows | `PASS T6a: the ORIGINAL COMMIT error object surfaced (===)` | **Yes** — pre-fix: `FAIL T6a: no content address: got ["e513d6….txt"]`; also fails with the probe removed (§3, M2) | **PROOF** |
| **t06b** | phantom COMMIT (real COMMIT commits, then the call throws) ⇒ resolves with the committed id, blob renamed into place, extract written | `PASS T6b: ingestFile RESOLVES (phantom success treated as committed)` · `PASS T6b: the verification probe ran` | **Yes** — with the probe removed: 8 failures incl. `FAIL T6b: ingestFile RESOLVES …: it rejected with: t06b ack lost after a real commit` | **PROOF** |
| **t07** | extract write fails ⇒ **row committed**, blob already renamed, 0 temps | `PASS T7: blob present at the content address (rename preceded the extract)` | No (extract ordering is orthogonal to the blob write) | guard (pins §4.4 step 7) |
| **t08** | cleanup failure does not mask the original error; suppressed cleanup leaves **exactly one** temp and a `logger.warn` | `PASS T8: exactly ONE .ingest-tmp-* left (the suppressed cleanup)` | **Yes** — pre-fix: 4 failures incl. `FAIL T8: the injected cleanup fault fired (anti-vacuity): rmSync was never called with a .ingest-tmp- path (rmCalls=0)` | **PROOF** |
| **t09** | (a) `rmSync(absent,{force})` silent; (b) fail-then-retry as `.txt` = dedupe **miss** | `PASS T9b: no content address after the failure` | **Yes, but only via "no content address"** — pre-fix: `FAIL T9b: no content address after the failure: got ["c349b5….docx"]`, `FAIL T9b: exactly 1 blob: got 2 want 1`. Its retry half is the same different-extension shape as t02 (F11) | **PROOF (partial)** |
| **t10** | shared bytes: committed `.txt` survives a failing `.docx` ingest of the same bytes; no `<sha>.docx` appears | `PASS T10: <shaX>.txt still present` · `PASS T10: no <shaX>.docx was created` | **Yes** (pre-fix clone, where there is a second writer): `FAIL T10: no <shaX>.docx was created: got true want false`, `FAIL T10: uploads/ holds only <shaX>.txt`. Against **option (A)** (in-place write + unlink) it passes (14/14) — see F3 | guard for (B) vs. "second content address"; **not** a (A)-discriminator |
| **t11** | (a) dedupe branch contract unchanged (sha as id, 0 chunks); (b) `renameSync` failure after COMMIT ⇒ dangling row, temp preserved with the bytes, no address | `PASS T11b: the row WAS committed (dangling row, §5.2b)` · `PASS T11b: exactly one .ingest-tmp-* preserved` | **Yes** — pre-fix: 8 failures incl. `FAIL T11b: the injected rename fault fired (anti-vacuity): renameSync never saw a .ingest-tmp- source (fired=0)` | **PROOF** + guard (T11a pins O9) |
| **t12** | two simultaneous identical ingests: ≥1 succeeds, exactly one blob, every row's `source_path` exists | `PASS T12: every row source_path exists on disk` · `INFO T12: settlement statuses = ["fulfilled","fulfilled"]` | No (passed on both mutants) | guard (see F4) |
| **t13** | stale dedupe race: loser fails at INSERT while winner's COMMIT is parked; winner keeps its row/blob | `PASS T13: the loser rejected with the injected error` · `PASS T13: the winner source_path EXISTS on disk` | **No as written** — with **in-place write + unlink (A)** it still passes 14/15 and `PASS T13: the winner source_path EXISTS on disk` (F3) | guard (fails-closed, but not a (A)-discriminator) |
| **t14** | `orphans.sh`: exit 0, ORPHAN_BLOB / HASH_MISMATCH / STALE_TMP / INGEST_TMP tokens, nothing for the legit blob, "deletes nothing" | `PASS T14: exit code 0` · `PASS T14: deletes nothing (listing identical before/after)` | n/a (report script) | **PROOF of the script's classification**, with two caveats (F2, F5) |
| harness fail-closed | tests refuse to run against the wrong schema | `BLOCKED: search_path guard: current_schema()=public expected f1test` + `ACTUAL_EXIT=2` (`verify/guard-check.txt`) | — | sound |

**Are any tests vacuous?** No file is vacuous as a whole (all 15 execute and assert on real side effects, every armed fault asserts it fired, and the schema guard exits 2). Specifically:
* **One assertion is vacuous as an O3 proof**: t02's and t09b's "retry is a dedupe MISS" — it retries `.docx` as `.txt`, which changes the content address, so it misses dedupe in the pre-fix world too. Proven: my probe's identical change-extension retry passes on the pre-fix clone (`verify/seam-m1a.txt`: `PASS B1/B2/B3`). The same-extension retry (G-series) is the real O3 test and **does** discriminate. (F11)
* **Four files do not discriminate the fix at all** (t01, t03, t07, t12 — guards).
* **One file that advertises itself as *the* AC3 proof does not discriminate the alternative it names**: `t13`'s header says "(A) write to the address, unlink on failure: the loser's unlink removes the winner's blob ⇒ FAIL". I built exactly (A) and t13's load-bearing assertion **passed** on it (§3.2, F3).

**Vacuous-vs-proof summary:** PROOF = t02 (via its address assertion), t04, t05, t06a, t06b*, t08, t09 (via its address assertion), t11b, t14*. GUARD = t01, t03, t07, t10, t12, t13, t11a.
Files that fail on the pre-fix clone: **9 of 15** — t02, t04, t05, t06a, t08, t09, t10, t11, t13. The six that pass: t01, t03, t07, t12 (guards by design) plus t06b* (tests the phantom-COMMIT branch — it fails on **M2**, the mutation that removes that branch, §3.3) and t14* (tests the report script — it fails on a clone without `.pipeline/`; its discriminating power is shown by §7.2–7.4 instead).

---

## 3. MUTATION / PRE-FIX DISCRIMINATION RESULT

Clone of the delivered tree outside the project root: `C:\Users\PC_DEV\AppData\Local\hermes\cache\scratch\f1-prefix-copy`, structured as `<copy>/server/{src,node_modules,package.json,tsconfig.json}` + `<copy>/.pipeline/f1/orphans.sh` so `__dirname`-relative paths behave identically (needed for t14: my first, flat copy made a 3.4×-speed-up but wrong-path `FAIL T14: the report script exists: missing …\scratch\.pipeline\f1\orphans.sh` — a harness artefact, reported for honesty, not a test result). The **same unmodified test files** were run against the clone.

### 3.0 Control — clone of the delivered code, tests unmodified
`verify/copy-baseline-run2/_summary.txt`: 14 files `0 failed`; `FILE=t14_report.test.ts EXIT=0 RESULT=RESULT: 13 passed, 0 failed` → the clone reproduces the delivered result, so later failures are attributable to the mutation.

### 3.1 M1a — PRE-FIX blob write restored (the mandated check)
Mutation (`sha256(f1-prefix-copy/server/src/ingest/service.ts)=7f09e18d…52fcb9`): step 2 replaced by `fs.writeFileSync(storagePath, fs.readFileSync(filePath))` before parse (`blobTmp = storagePath`), the rename block deleted, and cleanup disabled (`const preserved = true`) — i.e. exactly PLAN §1.1: write at the content address, no atomicity, **no compensating delete**.

`verify/m1a-prefix-run/_summary.txt` (verbatim):
```
FILE=t01_success.test.ts EXIT=0 RESULT=RESULT: 13 passed, 0 failed
FILE=t02_parse_fail.test.ts EXIT=1 RESULT=RESULT: 12 passed, 1 failed
FILE=t03_zero_chunks.test.ts EXIT=0 RESULT=RESULT: 8 passed, 0 failed
FILE=t04_connect_fail.test.ts EXIT=1 RESULT=RESULT: 4 passed, 1 failed
FILE=t05_insert_fail.test.ts EXIT=1 RESULT=RESULT: 5 passed, 1 failed
FILE=t06a_commit_fail.test.ts EXIT=1 RESULT=RESULT: 7 passed, 1 failed
FILE=t06b_commit_ack_loss.test.ts EXIT=0 RESULT=RESULT: 11 passed, 0 failed
FILE=t07_extract_fail.test.ts EXIT=0 RESULT=RESULT: 8 passed, 0 failed
FILE=t08_cleanup_fail.test.ts EXIT=1 RESULT=RESULT: 7 passed, 4 failed
FILE=t09_idempotency.test.ts EXIT=1 RESULT=RESULT: 10 passed, 2 failed
FILE=t10_shared_blob.test.ts EXIT=1 RESULT=RESULT: 12 passed, 2 failed
FILE=t11_duplicate.test.ts EXIT=1 RESULT=RESULT: 9 passed, 8 failed
FILE=t12_concurrent.test.ts EXIT=0 RESULT=RESULT: 6 passed, 0 failed
FILE=t13_concurrent_one_fails.test.ts EXIT=1 RESULT=RESULT: 6 passed, 4 failed
FILE=t14_report.test.ts EXIT=0 RESULT=RESULT: 13 passed, 0 failed
```
Key orphan test (t02) on pre-fix code:
```
FAIL T2: uploads/ has 0 files (no <sha>.docx at the content address): got ["4806b926c9c8bcc67f5eb30aaff47b63710d31472afdc3c4a1457b9320fd6752.docx"] want []
```
| **→ The key orphan test FAILS on pre-fix code: it discriminates. Not vacuous.** 9 of 15 files fail on M1a: `t02 t04 t05 t06a t08 t09 t10 t11 t13`. |

### 3.2 M1b — option (A): in-place write **plus** unlink-on-any-failure
Mutation `sha256=e4d8e857…3d77f` (`const preserved = false`). Run (`verify/m1b-optionA-run/`):
```
FILE=t13_concurrent_one_fails.test.ts EXIT=1 RESULT=RESULT: 6 passed, 4 failed
FILE=t10_shared_blob.test.ts EXIT=0 RESULT=RESULT: 14 passed, 0 failed
FILE=t12_concurrent.test.ts EXIT=0 RESULT=RESULT: 6 passed, 0 failed
   …
FAIL T13: the loser rejected with the injected error: status=fulfilled reason=undefined
INFO T13: insertAttempts=1 statuses=["fulfilled","fulfilled"] watchdogFired=false
FAIL T13: both callers must have missed dedupe: insertAttempts=1 (< 2)
PASS T13: the winner source_path EXISTS on disk
```
The loser was short-circuited by the **dedupe branch** (the winner's uncommitted blob already sat at the address), so the race never happened; the load-bearing assertion `the winner source_path EXISTS on disk` **passed on (A)**. t13 as written is a guard, not the (A)-discriminator its header claims (**F3**).

### 3.3 M2 — post-COMMIT verification removed
Mutation `sha256=f1e53994…4483` (catch → ROLLBACK + rethrow).
```
FILE=t06a_commit_fail.test.ts EXIT=1 RESULT=RESULT: 7 passed, 1 failed
FILE=t06b_commit_ack_loss.test.ts EXIT=1 RESULT=RESULT: 3 passed, 8 failed
FILE=t02_parse_fail.test.ts EXIT=0 RESULT=RESULT: 13 passed, 0 failed
FAIL T6a: the verification probe ran: the post-COMMIT SELECT never ran (probeSelects=0)
FAIL T6b: ingestFile RESOLVES (phantom success treated as committed): it rejected with: t06b ack lost after a real commit
FAIL T6b: a real UUID documentId was returned: documentId=null
FAIL T6b: blob present at the content address: missing …a9115e59….txt
```
T6a/T6b discriminate the verification branch; t02 is independent of it (correct scoping).

### 3.4 Delivered tree untouched
`sha256sum server/src/ingest/service.ts` = `b61144a158484c022d6553d145aa5486ed349194d113e2acc40b95cdc156df83` at 17:04 (before any check) and at 17:26 (after all mutations, seam runs and the server start); mtime `2026-10-28 16:36:05 +0700` unchanged. All mutation edits were applied **only** to `…\scratch\f1-prefix-copy\server\src\ingest\service.ts`. `orphans.sh` hash `10846a81…c15a` unchanged.

---

## 4. SEAM PROOF (my own probe, real service, no mocks, no patches)

Probe: `.pipeline/f1/verify/seam-probe.ts`, run as `npx tsx` from `server/` with `DATABASE_URL …search_path=f1test` (throwaway storage dir per run under `%TEMP%\f1v-probe-*`). Full log: `.pipeline/f1/verify/seam-delivered.txt`.

`RESULT: 49 passed, 0 failed` — `LABEL: delivered`. Selected verbatim lines:
```
PASS A1 junk .docx throws the original parse error
INFO A message: "ADM-ZIP: Invalid or unsupported zip format. No END header found"
PASS A2 no <sha>.docx at the content address
PASS A3 uploads/ has no blob at all
PASS A4 no .ingest-tmp-* left
PASS A5 no extract
PASS A6 documents rows for that sha = 0
PASS B0 the .txt fixture is byte-identical
INFO B result: {"documentId":"0d407fd8-6814-4d20-a0de-a312c4fa3729","chunkCount":1,"textLength":28}
PASS B1 re-ingest returns a real UUID documentId
PASS B2 chunkCount >= 1
PASS B3 exactly 1 documents row for those bytes
PASS B5 the row has >= 1 chunk row
PASS B6 blob exists at <sha>.txt
PASS B7 blob bytes hash to its name
PASS C1 O3 cured: a row exists for bytes whose first ingest failed
INFO G retry outcome: threw: "ADM-ZIP: Invalid or unsupported zip format. No END header found"
PASS G3 the same-bytes same-extension retry is NOT a silent dedupe no-op
PASS G5 no row exists for those bytes
PASS G6 no content address for those bytes
```
**O3 cure, exactly as specified:** "after a failed ingest of bytes X, ingest bytes X again legitimately ⇒ the document row EXISTS". My B-series used the same bytes as `.txt` (the legitimate path) → `B3 exactly 1 documents row`, `B4 that row is the returned id`, `B1` real UUID, `B2 chunkCount ≥ 1`. I additionally ran the **strictest** form (G-series: same bytes, **same** `.docx` extension, i.e. what a user actually re-uploads): delivered code re-parses and **throws the parse error again** — it never answers from a stale address. The pre-fix clone answers that retry silently:
```
INFO G retry outcome: RESOLVED: {"documentId":"42cbf969…ec28","contentHash":"42cbf969…ec28","chunkCount":0,"chunkIds":[],"textLength":0}
FAIL G3 … : it RESOLVED (O3): documentId=42cbf969… chunkCount=0
FAIL G4 the retry surfaces the parse error again: message=none
```
(That is O3 precisely: a "success" with the sha as id, 0 chunks and no row.)

**Same probe against the pre-fix clone** (`F1_SERVICE=<clone>`, `verify/seam-m1a.txt`): `RESULT: 40 passed, 9 failed` — the failing set is exactly `A2 A3 G3 G4 G6 D9 E3 E4 E5`. So my probe discriminates too, not just the implementer's tests.

---

## 5. SHARED-BLOB + CONCURRENCY (AC3)

### 5.1 Shared blob — failing ingest of bytes a committed document shares
D-series (`seam-delivered.txt`):
```
PASS D1 first ingest committed a row + blob
PASS D3 the second ingest fails
PASS D4 the committed <shaX>.txt blob still exists
PASS D5 its bytes are unchanged
PASS D6 exactly 1 row still, same id
PASS D7 its source_path still resolves
PASS D8 its chunks are unchanged
PASS D9 no <shaX>.docx was created
```
### 5.2 Two documents with identical bytes under different names, where possible
F-series — the same bytes committed as `.txt`, then committed again as `.md` (a *valid* extension ⇒ a second content address):
```
PASS F1 the .md ingest resolves with chunks
PASS F2 its documentId is a real UUID (no dedupe hit: different address)
PASS F3 <shaX>.md exists
PASS F4 exactly 2 rows share those bytes
PASS F5 EVERY row for those bytes has a source_path that exists
PASS F6 both content addresses exist
```
The failing variant (same bytes under `.docx`) is D3–D10, and **no valid row's `source_path` is missing afterwards** in either variant.

### 5.3 Concurrency — two simultaneous ingests of the same NEW bytes, one fails
Fault used: **a real PostgreSQL `BEFORE INSERT` trigger** on `f1test.documents` that raises for a name prefix (`f1 test.f1v_fail`, created and dropped by the probe). No application code patched, nothing simulated:
```
INFO E trigger: f1test.f1v_fail armed (raises for name LIKE f1v-fail-%)
INFO E attempt 1: statuses=["fulfilled","rejected"] loserMsg="f1v injected INSERT failure for f1v-fail-1-840b5e.txt"
PASS E1 exactly one caller rejected (real INSERT failure)
PASS E2 the loser surfaced the real PostgreSQL error
PASS E3 exactly one row for the new bytes (the winner)
PASS E4 the winner source_path still EXISTS on disk
PASS E5 that blob hashes to its name
PASS E6 exactly one content-address blob for the bytes
PASS E7 no .ingest-tmp-* left
PASS E8 uploads/ grew by exactly one blob
```
Observed behaviour, honestly: on the delivered code the loser failed at `INSERT` on the first attempt in each of the four times I ran the probe, giving one winner + one loser; every time, the winner's row kept a resolvable, correctly-hashed blob. On the pre-fix clone the **same probe, same real fault** produced:
```
FAIL E3 exactly one row for the new bytes (the winner): rows=0
FAIL E4 the winner source_path still EXISTS on disk: missing
FAIL E5 that blob hashes to its name: hash mismatch
```
with `INFO E attempt 2: statuses=["fulfilled","rejected"]` — i.e. **zero rows for bytes that were "successfully" ingested**. The mechanism is the pre-fix defect itself: the failing caller had already written the blob **at the content address** before its INSERT failed, so the surviving caller was answered by the **dedupe branch** (`documentId` = sha, `chunkCount` 0, no row) — O3 under concurrency. (E5 is a knock-on of E3: with no row there is no `source_path` to hash.) That is the AC3 failure reproduced end-to-end against a real database.
Note on the delivered tests: t13's own interleaving is driven by patched `pg.Client.prototype.query` and a parked COMMIT; it is deterministic but, as shown in §3.2, it does not separate (A) from (B).

---

## 6. PHANTOM-COMMIT PATH (T6b) — does it really COMMIT then throw?

Code (`t06b_commit_ack_loss.test.ts:81-92`): on the first `'COMMIT'` the patch calls `origQ.call(this, q, …)` and only then throws — so the **real** COMMIT runs and the throw is an "ack lost", not a simulated resolution.

Independent DB-level confirmation (`.pipeline/f1/verify/t6b-db-truth2.txt`): I installed `BEFORE INSERT` triggers on `f1test.documents` that write into a log table **inside the same transaction**, then ran t06b and t06a unmodified:
```
################ t06b_commit_ack_loss.test.ts
PASS T6b: ingestFile RESOLVES (phantom success treated as committed)
PASS T6b: a real UUID documentId was returned
--- documents INSERTs that SURVIVED (i.e. were part of a COMMITTED transaction):
documents: t06b.txt sha=5857a14bb13bb82170fa0aa02145230f568b92d6db872b70b93651169fa092e2
################ t06a_commit_fail.test.ts
--- documents INSERTs that SURVIVED (i.e. were part of a COMMITTED transaction):
(empty)
```
**Confirmed:** on T6b the INSERT survived ⇒ a COMMIT really happened and the error was raised afterwards; on T6a (pre-COMMIT fault) nothing survived ⇒ the contrast is genuine.

---

## 7. `orphans.sh`

Script: `.pipeline/f1/orphans.sh` (`sha256 10846a81…c15a`, 59 lines). All runs used a **throwaway** data dir (or a planted fixture set); the user's `server/data` was never written to and contains 0 files throughout.

### 7.1 Real data dir (`verify/orphans-real.txt`)
```
FILES_BEFORE=0
CONTENT_HASH_BEFORE=716d7175ac9901ae3f57e74fcb28205739f84b0bda194606142da4c68dc000a8
EXIT=0
FILES_AFTER=0
CONTENT_HASH_AFTER=716d7175ac9901ae3f57e74fcb28205739f84b0bda194606142da4c68dc000a8
--- diff
NO_DIFFERENCE
```
All six section headers printed, no records (the tree is clean) — consistent with `IMPLEMENTATION.md:14`.

### 7.2 Planted orphan + planted truncated blob (`verify/orphans-planted.txt`)
```
HASH_MISMATCH	deadbeef.txt	deadbeef	08805be8083496b5d9ee4e7509c9184f76aa4f992035237ab2f217625f0e822c
ORPHAN_BLOB	orphan	23	/tmp/f1v-orphans-498/uploads/orphan.bin
HASH_MISMATCH	orphan.bin	orphan	89ed3442c4ca2a8e88955be22d0f6d57912f7b3761498b7e62e6efb444e2278d
ZERO_LEN	zero.txt
STALE_TMP	.ingest-tmp-probe123.txt	12
INGEST_TMP	.ingest-tmp-probe123.txt	12
ORPHAN_EXTRACT	feedfacefeedface	/tmp/f1v-orphans-498/extracts/feedfacefeedface.txt
LEFTOVER_UPLOAD_TMP	tmp-1-abcdef.txt	20
EXIT=0
```
→ **ORPHAN_BLOB** for a blob whose sha has no row, **HASH_MISMATCH** for the truncated blob (with the true hash), stale/any-age temps, orphan extract, multer temp; **exit 0**; nothing reported for a legitimately committed document.

### 7.3 Is it read-only? (`verify/orphans-readonly.txt`, `verify/redirect-test.txt`)
```
EXIT=0
--- diff before/after
NO_DIFFERENCE
```
A full `find -printf '%p|%y|%s|%T@|%i\n'` snapshot of a planted tree (orphan blob, truncated blob, back-dated temp) is **byte-identical before and after**, every planted file still present, and nothing new appears. My first planted run did show a changed tree hash — the cause was **my own probe**: it copied the "legit" blob into `uploads/` *after* taking the before-snapshot. Re-run in the correct order: `NO_DIFFERENCE`.

I also checked the specific mechanism the script relies on for the Windows fix (`sha256sum < "$UP/$f"` instead of `sha256sum "$UP/$f"`), because a wrong redirect form would itself be a write:
```
before size|mtime|inode = 16|1793183292|…  hash=6ab7c68f…
after  size|mtime|inode = 16|1793183292|…   stdin-hash=6ab7c68f…
RESULT: '<' redirect did NOT modify the file
RESULT: stdin and path forms agree on the hash
```
`<` opens read-only, so the stdin form is safe and is the right call: the path form is broken on this host for Windows-style paths — I reproduced that independently (`verify/redirect-test.txt`, `verify/orphans-planted.txt` header):
```
$ sha256sum 'D:\Develop\knowledge-app\server\package.json' | cat -A
\416202ff87d2803a7457ccd90e14bbdb3360e26551f948d674b37bcd1893634e *D:\\Develop\\…\\package.json$
```
(first field is `\416202ff…`, so `cut -f1` would produce a false `HASH_MISMATCH` — the implementer's D6.2 fix is justified and correct). Likewise the CRLF fix (D6.1) is justified: `psql -Atc` output ends `a b c \r \n` on this host (verified), so an untruncated hash list makes `grep -qxF` match nothing.

### 7.4 PLAN §6.1 Q2 ("MISSING_BLOB", row without blob) — **not implemented**
`grep -o "printf '[A-Z_]*" orphans.sh` → `HASH_MISMATCH INGEST_TMP LEFTOVER_UPLOAD_TMP ORPHAN_BLOB ORPHAN_EXTRACT STALE_TMP ZERO_LEN`; `MISSING_BLOB occurrences in orphans.sh: 0` (`verify/missing-blob.txt`). A storage dir containing a dangling row is reported as **completely clean** (`verify/dangling-demo.txt`):
```
--- orphans.sh on that storage dir (state has a dangling row NOW):
== blobs: orphan (O1) and content-address mismatch (O2/O12) ==
== zero-length blobs … == == stale ingest temp files … == == all ingest temp files … == == orphan extracts … ==
EXIT=0
```
A pure-bash equivalent (no `pg_stat_file`, which the app role may not call — `ERROR: permission denied for function pg_stat_file`) finds them (`verify/dangling-demo.txt`, second half):
```
MISSING_BLOB	0198f165-…	ok.txt	dd9b570e…	…\scratch\f1-probe\uploads\dd9b570e….txt
```
That printed exemplar is **pre-existing** (the implementer's own probe residue), not mine. See **F5**.

---

## 8. REGRESSION + CLEANUP PROOF

### 8.1 TypeScript
```
$ cd server && npx tsc --noEmit
TSC_EXIT=0
```
### 8.2 Baseline file set (`verify/baseline-check.txt`)
```
$ sha256sum -c .pipeline/f1/baseline.sha256
server/src/ingest/service.ts: FAILED
sha256sum: WARNING: 1 computed checksum did NOT match
---- counts
29      (": OK" lines)
1       ("FAILED")
30      (lines in baseline.sha256)
```
Only `service.ts` differs — the single file §4.4 authorises. (29 OK + 1 FAILED = 30, i.e. the task's "27 OK" recollection is off; `IMPLEMENTATION.md:271` already flagged this.)

### 8.3 Phase 1 upload behaviour unchanged (`verify/p1-regression-run2.txt`)
Server started exactly as documented — `npx tsx src/index.ts` from `server/`, ambient `PGOPTIONS`/`DATABASE_URL` cleared so `.env` (public schema) wins:
```
[db] connected to PostgreSQL and schema initialized
[server] listening on 127.0.0.1:4000          (health=200)
INFO login status=200
INFO upload status=200
INFO upload body={"results":[{"documentId":"c3ba04d3-dc71-4c0c-8421-70f0193fb4be","contentHash":"f304844e…e5b3","name":"f1v-regression.txt","kind":"txt","accessPolicy":"restricted","chunkCount":1,"chunkIds":["chunk-0-36"],"textLength":203,"savedAt":"…"}],"errors":[]}
RESULT upload_status_200: true
RESULT all_nine_fields_present: true
INFO result fields=["documentId","contentHash","name","kind","accessPolicy","chunkCount","chunkIds","textLength","savedAt"]
RESULT contentHash_matches: true
RESULT blob_at_sha_txt: true
INFO documents rows for sha=1 id=c3ba04d3-…
INFO chunk rows=1
INFO deleted documents rows=1 remaining chunks for that id=0
RESULT blob_removed: true
```
The only delete I performed in `public`: that one row (`DELETE … WHERE id=<my id> AND sha256=<my sha> RETURNING id` → 1) plus its own blob/extract. **Honest disclosure:** the *first* run of the probe (17:17) leaked one row because my script's `BLOCKED` guard ran after the DELETE but `process.exit(2)` skipped no cleanup (the row-had-already-been-deleted branch); I removed the leaked row explicitly at 17:25 with `--cleanup-only 948191c9…` → `CLEANUP removed … (existed=false)` / `CLEANUP remaining rows for sha=0`. The second, corrected run (17:25, §8.3 above) deleted its own row inline: `INFO deleted documents rows=1 remaining chunks for that id=0`.
Server stopped afterwards — `health=000`, nothing listening on 4000.

### 8.4 Final state (`verify/final-state.txt`)
```
== hashes
b61144a158484c022d6553d145aa5486ed349194d113e2acc40b95cdc156df83 *server/src/ingest/service.ts
10846a8128d721abcfd11214703379e171be7be4bb9f22a3eed9fe0c2011c15a *.pipeline/f1/orphans.sh
== data dirs
uploads: 0 files
extracts: 0 files
tmp: 0 files
== public
documents=0
chunks=0
admins=1
audit_log=0
== f1test
documents=159
chunks=148
admins=0
audit_log=0
== f1test scaffolding leftovers (must be 0)
triggers=0
f1v_tables=0
f1v_procs=0
== port 4000
(no listener)
```
### 8.5 f1test rows I created, accounted for
`f1test` held **67 documents** when I started and **159** at the end. The 92-row delta is fully accounted for (`verify/db-state.txt`): the second 155-assertion run of the 15 files (`t01.txt`×10, `t02.txt`×10, `t03.txt`×11, `t06b.txt`×10, `t07.txt`×9, `t09.txt`×9, `t11.txt`×9, `t11b.txt`×9, `t12.txt`×20, `t13.txt`×11, `t14.txt`×14, `p.txt`×10 = 132 file rows across my run + the pre-existing baseline), plus my probe rows `junk.txt`×6, `p1.txt`×6, `p3.md`×2, `f1v-win-*`×5. Every scaffolding object I created was dropped (`triggers=0`, `f1v_tables=0`, `f1v_procs=0`), and the 2 temporary `f1v-dangling` rows were deleted in-script.

**Important accuracy note for the implementer's claim of "66 rows" in f1test:** I measured **67** documents / **61** chunks before my first run, and the f1test rows include **/scratch/f1-ingest-tests** and **/scratch/f1-probe*** `source_path`s from the implementer's own earlier runs — i.e. the implementer's test-residue footprint extends beyond the 66 rows claimed. I did **not** delete any pre-existing row (the `f1test-tidy.txt` "delete only my M1a rows" pass matched nothing because the mutant rows' paths are under `%TEMP%\f1v-probe-*`, and my filter looked for `f1v-probe-*` *plus* a missing file; the run is preserved as evidence of the intent and of the final counts). 5 dangling rows produced by my M1a mutant run remain in `f1test` (`f1v-win-1-*`, `source_path` under `%TEMP%\f1v-probe-*`, files never renamed into place) — they are in the **test schema only**, they are exactly the "committed row without blob" that the pre-fix clone produced, and I left them rather than widen my deletes.

---

## 9. FAILED OR CONTRADICTED CLAIMS (esp. vs `IMPLEMENTATION.md`)

| # | Claim | Where | Verdict |
|---|---|---|---|
| **F1** | "`§4.4(6)` … hoisted `documentId` … `service.ts:…256-257` (hoist)" and `verifyCommitted` is "byte-equivalent to the plan's snippet" | `IMPLEMENTATION.md:29`, `:49` | **Contradicted.** `:256-257` hoist only the declarations. The assignment is `:275` `documentId = docResult.rows[0].id as string;` and `:285` `values.map((v) => v[0]) as string[]` — **casts not in §4.4**, and not cosmetic: I reproduced the plan's exact shapes under `--strict` and got `error TS2322: Type 'string \| undefined' is not assignable to type 'string \| null'` and `error TS2322: Type 'Promise<string \| undefined>' is not assignable to type 'Promise<string>'` (`.pipeline/f1/verify/d1-cast-check.ts`). With the casts: `tsc --noEmit` exit 0. The delivered code is correct and safer; the report describes it as verbatim-plan when it is not. Report accuracy defect, not a code defect. |
| **F2** | "8 token classes" | `IMPLEMENTATION.md:36` | **Miscount.** `orphans.sh` emits **7** tokens (`HASH_MISMATCH, ORPHAN_BLOB, ZERO_LEN, STALE_TMP, INGEST_TMP, ORPHAN_EXTRACT, LEFTOVER_UPLOAD_TMP`), which is exactly PLAN §6.2's script. Cosmetic. |
| **F3** | t13's header: "(A) write to the address, unlink on failure: the loser's unlink removes the winner's blob ⇒ FAIL"; `IMPLEMENTATION.md` calls T13 "the only test that separates (A) from (B)" | `t13_concurrent_one_fails.test.ts:1-8`, `IMPLEMENTATION.md` T13 row | **Contradicted.** With (A) built (M1b) t13 still passes the load-bearing assertion (`PASS T13: the winner source_path EXISTS on disk`) because the loser is absorbed by the dedupe branch before it can unlink. My real-DB probe (§5.3) *does* discriminate (A): `FAIL E3 rows=0 / E4 missing / E5 hash mismatch`. |
| **F4** | "the report script … exit 0" + T14 "deletes nothing" | `IMPLEMENTATION.md:14`, t14 | **Accurate for a clean tree, and the no-delete claim is now proven independently** (§7.1/§7.3: `find -printf` snapshot identical before/after, `EXIT=0`). Incomplete only in that T14 plants the six classes it reports and says nothing about `MISSING_BLOB` (F5). |
| **F5** | (implicit) the report covers O1/O2/O7/O10/O12 | `PLAN §6.2` scope vs. `§6.1 Q2` | **Not implemented and not disclosed.** `MISSING_BLOB` = 0 occurrences in `orphans.sh`. Consequence, demonstrated: a storage dir whose only defect is a committed row with no blob is reported clean (exit 0, zero tokens) — while PLAN §5.2(b) says exactly that state "is reported as `MISSING_BLOB` (Q2) + `STALE_TMP`". |
| **F6** | "all test rows are in `f1test` (66 rows)" | `IMPLEMENTATION.md:16` | **Off by one and understated.** I measured **67** documents / 61 chunks *before* running anything, and the f1test rows include `source_path`s under `…\scratch\f1-ingest-tests\*` and `…\scratch\f1-probe*` — i.e. residue from other implementer runs beyond the "66". |
| **F7** | "155 assertions, 155 passed … twice in a row" | `IMPLEMENTATION.md:13` | **Confirmed.** Reproduced exactly: 155/155, all 15 files exit 0 (§2.1). |
| **F8** | "`SEAM_PROOF: PASS` on all four required points" | `IMPLEMENTATION.md:15` | **Not independently reproducible as written** — the artifact `…\scratch\f1-seam-proof.ts` is not auditable line-for-line from the report. My own probe of the same four points passes 49/49 (§4), so the *substance* holds; the evidence chain does not. Also note the implementer's O3 demonstration used `.docx → .txt`; the strictly same-extension retry is covered only by my G-series, and it passes. |
| **F9** | "`orphans.sh` … deletes nothing … exit code is always 0" | `orphans.sh:7` | confirmed (§7.1/7.2: `EXIT=0`, tree identical). |
| **F10** | T12 accepted "1 or 2 rows" | `t12_concurrent.test.ts:94` | Honest and disclosed, but it means T12 cannot fail on the duplicate-row defect (§5.4) — a guard, correctly labelled. |
| **F11** | T2/T9b "retry … dedupe miss ⇒ **O3 cured**"; `IMPLEMENTATION.md:219` "the later legitimate upload of the same bytes **misses dedupe**" | t02, t09, `IMPLEMENTATION.md:219` | **Mislabeled / not discriminating.** The retry changes `.docx → .txt`, hence the storage key `<sha><ext>`, so `existsSync(storagePath)` **misses in the pre-fix world too**. Evidence: under M1a, t02 fails only the address assertion (`12 passed, 1 failed`) and never reaches the retry; and my probe's identical `.docx → .txt` retry **passes on the pre-fix clone** (`PASS B1 re-ingest returns a real UUID documentId`, `PASS B2 chunkCount >= 1`, `PASS B3 exactly 1 documents row` in `verify/seam-m1a.txt`). O3 is "same bytes, **same address**, silent no-op" — which only a same-extension retry exercises (my G-series: pre-fix `RESOLVED … chunkCount 0`, delivered re-throws). The files do discriminate, but through "no content address", not through the retry. |

---

## 10. LIMITATIONS / NOT VERIFIED

1. **No process-crash test** (per PLAN §7.1/Q4). The `.ingest-tmp-*` residue after a `kill -9` is argued, not observed. `STALE_TMP`/`INGEST_TMP` cover detection only.
2. **Directory fsync is absent** (PLAN §5.3, disclosed). Power loss can still lose the rename; not testable here.
3. **`EPERM`/`EBUSY` rename-after-COMMIT** (PLAN §5.2(b)) is exercised only by the *patched* `renameSync` in t11b and by my own M3 probe (`INFO m3 rename fired=1 threw=m3: injected EPERM`, `INFO m3 uploads=[".ingest-tmp-11600-….txt"]`, `RESULT m3_rename_fault_surfaces=true`) — the OS-level sharing-violation behaviour was not reproduced on this host.
4. **`documents.sha256` is still not UNIQUE**; concurrent identical ingests can still create 2 rows sharing one blob (out of scope by instruction). My §5.3 runs happened to produce 1 row each time; `t12` observes 1–2.
5. **`orphans.sh` was never run against a populated real data dir** (the tree is empty; populating it would have violated the no-write rule). Its classification was proven on a throwaway fixture dir instead.
6. **`find -printf`, `stat -c`** are GNU-only; verified on this Git-Bash host, not portability.
7. **The delivered tree was not type-checked in CI or built** (`npm run build`) — only `tsc --noEmit`.
8. **My own harness bugs** (disclosed rather than hidden): a `/usr/bin/time` runner produced 15× exit 127; a flat clone made t14 fail on a path; `run-probe.sh ""` and a `kill` loop were wasted calls. All superseded by the runs quoted above.
9. **15 files × 1 run each** on the delivered tree; I did not repeat the "twice in a row" claim myself (the implementer's second pass is not in my evidence).
10. **The `f1test` schema is not clean**: 159 documents / 148 chunks, including 5 dangling rows from my M1a mutant run and pre-existing rows from the implementer's probes. Nothing outside `public` was touched by design.

---

## 11. FOLLOW-UPS (reported, not fixed)

1. **Implement PLAN §6.1 Q2 inside `orphans.sh`** as `MISSING_BLOB` (row → file), using a pure-bash `[ -f "$source_path" ]` loop (the app role cannot call `pg_stat_file`: `ERROR: permission denied`). Today the report is blind to the one failure direction §4.4 itself deliberately creates (F5).
2. **Correct `IMPLEMENTATION.md`** where it says §4.4 landed verbatim at `:256-257` and that `verifyCommitted` is byte-equivalent to the plan snippet — the `as string` casts are required by `strict` and are a real (safe) deviation (F1); and "8 token classes" → 7 (F2).
3. **Add an (A)-discriminating test** at the DB seam (BEFORE INSERT trigger or a real `unique`-violating second insert) so AC3 has a test that fails on option (A); t13 as written does not (F3).
4. **Make `t14` plant a dangling-row fixture** and assert `MISSING_BLOB`, once follow-up 1 exists.
5. **Record the f1test residue inventory** in the implementer report with an exact count and the scratch `source_path`s it points at (F6).
6. **Make the O3 regression test use a same-extension retry** (junk `.docx`, then the identical bytes as another `.docx`) and assert it throws again — the `.docx → .txt` shape passes in the pre-fix world and therefore cannot guard O3 (F11).

---

## APPENDIX — evidence index (`.pipeline/f1/verify/`)

| File | Contents |
|---|---|
| `run1/_summary.txt`, `run1/*.out` | the 15 delivered test files, one process each, verbatim output |
| `baseline-copy-run/`, `copy-baseline-run2/` | control runs of the clone (flat vs. correct layout) |
| `m1a-prefix-run/` | M1a pre-fix blob write — 12/15 files fail |
| `m1b-optionA-run/` | M1b option (A) — t13/t10/t12 results |
| `m2-noverify-run/` | M2 no post-COMMIT verification — t06a/t06b/t02 |
| `seam-delivered.txt` | my seam probe on the delivered tree — 49 passed, 0 failed |
| `seam-m1a.txt` | the same probe against the pre-fix clone — 40 passed, 9 failed |
| `t6b-db-truth.txt`, `t6b-db-truth2.txt` | DB-level proof that T6b really commits and T6a does not |
| `orphans-planted.txt`, `orphans-readonly.txt`, `orphans-real.txt`, `redirect-test.txt` | orphans.sh classification, read-only proof, real data dir, redirect/hash-form mechanics |
| `missing-blob.txt`, `dangling-demo.txt` | MISSING_BLOB absence + demonstration |
| `p1-regression.txt`, `p1-regression-run2.txt`, `server.log`, `server2.log` | Phase-1 upload regression |
| `baseline-check.txt`, `final-state.txt`, `db-state.txt`, `guard-check.txt`, `f1test-tidy.txt` | regression baseline, final state, schema accounting, fail-closed guard |
| `seam-probe.ts`, `p1-upload.ts`, `d1-cast-check.ts` | the probes, so every number above can be re-derived |

DONE:TEST_ENGINEER_F1

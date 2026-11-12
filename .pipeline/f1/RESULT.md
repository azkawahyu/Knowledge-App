# RESULT — F1: Blob Orphan Audit & Fix

**Orchestrator final review:** `FINAL_REVIEW: PASS`
**Date:** 2026-10-28
**Pipeline:** Planner → Plan Reviewer (2 rounds) → Implementer → Test Engineer (independent) → bounded follow-up → Orchestrator verification

## 1. Status

| Gate | Result |
|---|---|
| Plan approval | **DECISION: APPROVE** — `REVIEW.md` §ROUND 2 REVIEW (line 270) after 12 numbered revisions |
| Implementation | **IMPLEMENTED** — `IMPLEMENTATION.md` |
| Independent verification | **VERDICT: PASS** — `TEST-REPORT.md` (485 lines), incl. pre-fix mutation, seam proof, real-trigger concurrency |
| Gap closure | **COMPLETE** — `MISSING_BLOB` added; vacuous retry replaced; `t13` relabelled honestly |
| Orchestrator checks | **PASS** — `service.ts` hash unchanged (`b61144a1…56df83`), `tsc --noEmit` exit 0, public schema 0/0/1/0, data dirs empty, ports free, `t02` re-run **18 passed / 0 failed** |

## 2. Root cause (confirmed by audit + reproduction)

`ingestionService.ingestFile()` wrote the content-addressed blob at `service.ts:126` — **before** `parseFile` (`:130`) and three steps before the only commit point (`storeDocument()` COMMIT, `:217`). Consequences:

- **O1 orphan blob** — a corrupt-but-allowed file (junk `.docx`) left `<sha>.docx` on disk with no `documents` row. Reproduced twice in Phase 1.
- **O3 stuck dedupe (silent data loss)** — dedupe (`:120-123`) is keyed only on `fs.existsSync(storagePath)` with no DB read. An orphan therefore made a later legitimate upload of the **same bytes** return `200` with `contentHash` as `documentId` and `chunkCount: 0`, **forever, creating no row**. Not retryable from the UI.
- Secondary classes: O2 truncated blob at the content address (crash mid-write), O4 phantom success (COMMIT ack lost after commit), O5 zero-chunk rows, O6 duplicate rows (no UNIQUE on `sha256`), O7 orphan extracts, O13 dangling `source_path`.

## 3. Files changed

| File | Purpose |
|---|---|
| `server/src/ingest/service.ts` (236 → 317 lines) | The fix. Blob bytes go to `data/uploads/.ingest-tmp-<pid>-<rand><ext>` via `openSync('wx')` → `writeFileSync` → **`fsyncSync`** → `finally closeSync`; parse/chunk unchanged; `storeDocument()`; **`renameSync` to the content address only after it resolves**; extract write last. Failure path unlinks **only the temp**, gated by `preserved = renameAttempted \|\| err.code === 'EEXIST'` (never a content address), swallows cleanup errors with a `warn`, and rethrows the **same** error object. `storeDocument` gained a phantom-COMMIT check: `committing` flag before COMMIT, then `verifyCommitted(id)` on a fresh pooled client (`SELECT 1 FROM documents WHERE id=$1`, 2 s race, own `finally release()`) → resolve instead of failing a committed doc. |
| `server/src/ingest/__f1__/t01…t14 (+t06a, t06b).test.ts` | 15 deterministic test files (160 assertions) — `npx tsx`, in-process fault injection, isolated `f1test` schema + throwaway dirs |
| `.pipeline/f1/orphans.sh` | Read-only orphan **report** (8 token classes incl. `MISSING_BLOB`, `HASH_MISMATCH`) — deletes nothing, exit 0 |

No change to the route, `web/**`, schema, dependencies, exports, or `service.ts:85`.

## 4. Consistency guarantees

**Guaranteed (verified):**
- A failed ingest that never committed leaves **no** file at a content address — the code contains **no path that unlinks a content-address name**, so "never delete a blob a valid row references" holds *by construction*, not by a guard.
- The O3 class is cured: after a failed ingest of bytes X, a later ingest of the same bytes under the **same name/extension** no longer silently succeeds — it re-raises the parse error; under a parseable extension it creates a real row. Proven against pre-fix code: the same test fails there (6 assertions).
- A valid row's `source_path` survives a concurrent failure on identical bytes (verified with a real PostgreSQL `BEFORE INSERT` trigger, not a mock).
- Cleanup is idempotent, and a cleanup failure never masks the original error.

**Not guaranteed (documented, PLAN §5):**
- A crash/kill between COMMIT and rename leaves a **committed row whose blob is missing** — detected by `orphans.sh MISSING_BLOB`, self-heals on re-upload. This is the deliberate trade: strictly better than a permanently stuck dedupe.
- A rename failure caused by `EPERM`/`EBUSY` (measured on this machine: rename over an open target) produces the same dangling row and **preserves the temp** as the last copy of the bytes.
- No `fsync` on the directory (Windows), so a power loss can still lose the rename itself.
- `documents.sha256` has no UNIQUE constraint → duplicate rows remain possible; not fixed (schema change out of scope).
- A second server process can still race; `documents.status` stays `'pending'`.

## 5. Tests

- `npx tsc --noEmit` → **exit 0**.
- 15 files, one process each: **160 passed / 0 failed**, 15× exit 0.
- **Mutation / pre-fix discrimination:** pre-fix clone → `t02` fails with `uploads/ has 0 files … got ["…docx"]`; **9 of 15 files** fail on pre-fix code. Two extra mutants (option A; verification removed) also caught.
- **Seam proof (real service, no mocks):** junk `.docx` → original ADM-ZIP error; no `<sha>.docx`; no `.ingest-tmp-*`; re-ingest as `.txt` → real UUID `documentId`, `chunkCount: 1`.
- **O3 cure:** same-name retry fails loudly instead of returning `chunkCount: 0` (pre-fix it resolved silently — captured in the mutant output).
- **Phantom COMMIT (T6b):** proven at DB level with in-transaction log triggers — T6b's INSERT survived (committed), T6a's did not.
- **`orphans.sh`:** read-only (tree snapshot byte-identical before/after), exit 0, and on a planted throwaway layout emitted `ORPHAN_BLOB`, `HASH_MISMATCH`, `MISSING_BLOB` (and `0` lines for the NULL-`source_path` control row).
- **Phase 1 regression:** live server + multipart upload → 200, nine result fields, blob at `<sha>.txt`.

## 6. Data safety

No existing data was modified or deleted. Public schema before and after: `documents=0, chunks=0, admins=1, audit_log=0`. `server/data/{uploads,extracts,tmp}` empty. `service.ts` hash byte-identical to the tested build. Test rows live only in the isolated `f1test` schema (181 documents / 169 chunks) and every test dir is under the OS scratch area.

**Residue requiring your decision (nothing was deleted — approval policy):**
- `f1test` schema in the user's database (5 tables, 181+169 rows) — created for isolation, not part of the product. Drop with: `psql "$DATABASE_URL" -c "DROP SCHEMA f1test CASCADE;"` (I did **not** run it).
- `F1_DATA_DIR` is still exported in the shell environment pointing at the Test Engineer's scratch dir; run `unset F1_DATA_DIR F1_ROOT` before using `orphans.sh`, or it will audit the scratch dir.
- Scratch artefacts outside the repo: `…\hermes\cache\scratch\f1-*`, `f1-ingest-tests\`, `%TEMP%\f1*`.

## 7. Remaining risks

1. `t13` is a concurrency **guard**, not an option-(A) discriminator (documented in its header; a `rmSync`-target assertion would be needed).
2. `MISSING_BLOB` is a stat race (file may vanish between scan and report) — informational.
3. `orphans.sh` classifies by `documents` in the schema on the connection's `search_path`; with the wrong schema selected it reports every blob as orphan (safe direction: over-reporting, never deletes).
4. A `source_path` containing a tab/newline would break the `-F $'\t'` split (not realistic with UUID/text paths).

## 8. Cleanup candidates (REPORT ONLY — nothing deleted)

Current real state is **clean**: `orphans.sh` with explicit defaults (`F1_DATA_DIR=/d/Develop/knowledge-app/server/data`) returns **0 record lines** on the public data dir; report saved at `.pipeline/f1/orphans-public-report.txt`. Elements of the report (planted fixtures, scratch temp, f1test rows) are the only orphan-class artifacts that exist, and they are all outside the product's data dir.

## 9. Next step

**Phase 2 — PostgreSQL FTS search correctness** (`/api/search` still returns every chunk regardless of query) **plus token rehydration** (Phase 1 F2: after a reload the UI sends no `Authorization` header, so every search 401s). F1's `orphans.sh` and the O-class vocabulary are ready to be reused by any later GC phase — note the reviewer's N1 warning: a "no `documents.sha256` references it" predicate is also satisfied by every `.ingest-tmp-*`, so a GC must exclude that prefix explicitly.
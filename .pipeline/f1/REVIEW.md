# REVIEW — F1: Blob Orphan Audit & Fix (independent plan review)

PROJECT ROOT: `D:\Develop\knowledge-app`
PHASE: `f1-blob-orphan` — plan reviewed: `.pipeline/f1/PLAN.md` (497 lines)
REVIEWER ROLE: INDEPENDENT PLAN REVIEWER (read-only: no code edited, nothing installed, server not started, no DB writes, no deletions)
DATE: 2026-10-28
BASELINE AT REVIEW TIME: `sha256sum -c .pipeline/f1/baseline.sha256` = **30/30 OK**; `documents=0, chunks=0, admins=1, audit_log=0`; `server/data/**` = 0 files; ports 3000/4000 free; `knowledge_app` role: `rolsuper=f, rolcreatedb=f, has_database_privilege(CREATE)=t`; PG 18.6.

---

## DECISION

**REVISE** — the diagnosis is sound and **Option (B) is the correct fix** (the reviewer would also reject (A) for the reason given, and would reject (C) as the fix). Nothing in the plan is architecturally wrong; the required changes are 12 precise, local amendments: one dangerous ambiguity in the rename ordering, one unimplementable mitigation spec (Q3), one out-of-scope startup sweep that has an import-time side effect on real storage, a test harness that names a test framework the repo does not have, a test-isolation claim that is only half true, four mis-specified tests (T13 worst), two factual slips the "no wrong citation" bar rejects, and an over-stated guarantee list.

No change to the *chosen option* is required. Do not re-plan; apply R1–R12 and implement.

---

## SUMMARY

- The audit trace is accurate. Of ~35 checked citations, **2 are wrong and 2 are loose**; the substantive claims all hold against the code, including the F1 mechanism (blob at `service.ts:126` before `parseFile` at `:130`), the DB read-free dedupe (`:120-123`), the swallowed `ROLLBACK` (`:220-222`), and the post-commit extract write (`:157`).
- **(B) satisfies AC1, AC3, AC4 by construction in every failure interleaving I could construct**, and cures O3 for everything the new code creates. AC2 is unchanged (S5's shape is preserved only if the rename stays *before* the extract write — see R2).
- The **residual trade-off the planner asks me to rule on is acceptable**, and I rule in favour of after-COMMIT, because the opposite direction (blob without row) is the one that permanently disables retry — the plan's own O3, which it correctly rates the most severe class.
- The plan **understates** two things: rename failure (`EPERM` — *measured* on this host when the target is held open) is a far likelier cause of a dangling row than a crash, and there is **no `fsync`**, so §4.3's "a blob at the content-address path means the write completed" is false for power loss.
- The test strategy is the weakest part: **there is no test framework in the repo** (`devDependencies`: `tsx`, `typescript` only), the DB pool is a **module-level singleton**, **`createdb` is not permitted** for this role, and **T13 as written cannot distinguish (A) from (B)**. T4 as written would silently test the user's real DB.
- The §6 report script is genuinely read-only (only `find`/`stat`/`printf`/`grep` + `SELECT`) and runnable as written on this host (GNU `find -printf`, `stat -c`, `printf %q` all verified; `[ -f "<backslash native path>" ]` works, which matters because `path.join` writes `source_path` as `D:\…\uploads\<sha><ext>`). It is missing the O2 content check it claims.

---

## AUDIT-VERIFICATION TABLE

Verdicts: **OK** = citation lands on the claimed code; **WRONG** = the citation does not support the claim; **LOOSE** = range is off by a line or over-broad but the claim is true.

| Claim (plan) | Citation | My check | Verdict |
|---|---|---|---|
| Kind gate, `'other'` passes | `service.ts:109-111`, `:72-74` | `if (!DOC_KINDS.includes(info.kind)) throw`; array includes `'other'` | OK |
| Hash streams the *caller's* path | `service.ts:114` → `:88-98` | `createReadStream(filePath)`, `'error' → reject` | OK |
| `safeExt` from temp path; extract key has no ext | `service.ts:115-117` | `path.extname(filePath).toLowerCase()`; `extractPath = <hash>.txt` | OK |
| Dedupe on `existsSync`, no DB read, returns sha as `documentId` | `service.ts:120-123` | Exactly as described (`documentId: contentHash, chunkCount: 0`) | OK |
| Blob written **before** parse, in place, no `flag` | `service.ts:126`, `:130` | `fs.writeFileSync(storagePath, fs.readFileSync(filePath))` at 126; `parseFile` at 130 | OK |
| Chunker config + call | `service.ts:135-141` | 300/50/20, `splitIntoChunks(text, null, null)` | OK |
| `storeDocument` call site | `service.ts:144-154` | verified, incl. `sizeBytes: fs.statSync(filePath).size` | OK |
| `pool.connect()` **outside** the `try` | `service.ts:185` / `:186` | 185 connect, 186 `try` | OK |
| `BEGIN` / INSERT / COMMIT / ROLLBACK-swallow / release | `:187`, `:189-202`, `:217`, `:220-222`, `:223-225` | all exact | OK |
| `status` never supplied | `:190-191`, `schema.ts:13` | INSERT column list omits `status`; DDL default `'pending'` | OK |
| Chunk insert skipped when `chunkTexts` empty | `service.ts:210` (`:206-215`) | `if (values.length > 0)` | OK |
| Extract written **after** commit | `service.ts:157` | verified | OK |
| `chunkIds` are synthetic, not row ids | `:160-170`, `chunker.ts:75` | `chunk-${position}-${end}` | OK |
| `contentAddress()` unused | `service.ts:100-103` | grep: defined, no callers (dead code) | OK |
| `randomBytes` already imported | `service.ts:14` | `import { createHash, randomBytes } from 'crypto'` | OK |
| `ensureDir(storageDir)` block | `service.ts:85` | verified (85-86) | OK |
| `sha256` has no UNIQUE | `schema.ts:12`; `\d documents` | only `documents_pkey`; FK from `chunks` | OK |
| `source_path` nullable TEXT | **`schema.ts:9`** | line 9 is `kind`; `source_path` is **line 10** | **WRONG** |
| `chunks` DDL / cascade / FTS index | `schema.ts:20-28`, `:22`, `:30-31` | exact | OK |
| Route per-file loop, catch, `finally rmSync` temp | `routes/ingest.ts:202-235`, `:219-227`, `:228-234` | exact; blob never touched | OK |
| 400 all-fail / 207 mixed / zero-chunk warn / `/watch` | `:245`, `:242`, `:212-217`, `:369` | exact | OK |
| multer temp storage; 25 MiB cap | `:62-76`, `:58` | TMP_DIR at 62, `diskStorage` 65-76, `MAX_FILE_SIZE` 58 | OK |
| `sweepUploaded()` | `§1.3` cites `:109-131` | `uploadedFiles` is 109-114, `sweepUploaded` is **123-131** | LOOSE |
| `library.ts:9` selects `source_path`, no blob reader | `routes/library.ts:9` | exact; nothing in `src/` opens a blob | OK |
| No reader for `extracts/` | grep | only writer is `service.ts:157`; refs only in `service.ts`/`types.ts` | OK |
| `parseFile` dispatch + throw text | `parsers.ts:264-274` | exact (`Unsupported file type: .${ext}`) | OK |
| docx via AdmZip (throws on non-zip) | `parsers.ts:79-98` | `new AdmZip(path)` at 82, throws on bad zip | OK |
| xlsx via `XLSX.read` (no throw) | `parsers.ts:104+` | measured: sheets `["Sheet1"]`, no throw | OK |
| `detectKind` | `parsers.ts:252-255` | exact | OK |
| Chunker: empty → `[]`, synthetic ids | `chunker.ts:53-54`, `:75` | exact | OK |
| **"`minWords` … never used"** | `chunker.ts:8, 31-34` | `minWords` **is** used at **`chunker.ts:45`** (`safeOverlap`); true claim is "never applied as a drop filter" | **WRONG (as stated)** |
| `ParseResult.text: string` | `types.ts:29-33` | type is 29-**34** | LOOSE |
| `IngestionResult` | `types.ts:72-91` | exact | OK |
| `logger.warn/error` exist | `logger.ts:31-44` | object literal 31-44, `warn` 38-40 | OK |
| Phase 1 T9 observed orphan | `TEST-REPORT.md:144-154` | T9 section starts at 144; `uploads delta=1`, `ORPHAN_BLOB=…docx` | OK |
| F3 `documentId` divergence | `RESULT.md:70-74` | F3 bullet at 70 | OK |
| T10 dedupe block | `t04-t10.sh:77-92` | exact (77 first upload … 92 doc-delta) | OK |
| **Dedupe "asserted contract"** | `t04-t10.sh:86-92` | lines 89-91 print **NOTE** only (no `FAILED=1`); the only hard assert is doc-delta at 92. Also T9's `ORPHAN_BLOB` (74-75) is echoed, not asserted → the fix cannot regress Phase 1 here | **LOOSE (claim overstated)** |
| Tooling paths | `lib.sh:14-15`, `:28-31` | exact | OK |

**[U] items I can settle by reading:**
- **S4 outcome** — not settleable read-only; but S4's shape is now **moot for the fix** because R3 removes it as a decision: on a COMMIT throw the outcome is *verified*, not assumed.
- **S2 "no throwing path in `splitIntoChunks`"** — confirmed: `text` is typed `string`, the body only calls `replace/split/slice/join/indexOf/Math.min`, and the sole early return is `tokens.length === 0`. Agreed: no throw as written.
- **R2 "`renameSync` under AV/indexer"** — partially settled by measurement (see EVIDENCE): renaming over a target that is **open** throws `EPERM` on this host; renaming with the **source** open succeeds. So the risk is real but narrower and differently shaped than "AV locks the file": it is the *target* that matters, i.e. the second concurrent rename.
- **`createIngestionService` gives full test isolation** — **false for the DB**: `pool` is a module singleton built from `config.DATABASE_URL` at import (`db/index.ts:6`). The factory isolates the filesystem only.

---

## FAILURE / ORPHAN COVERAGE GAPS

**Failures the S-table misses (all reasoned against the code):**

1. **Rename failure after COMMIT** (non-crash) — `renameSync` over an existing target held open throws `EPERM` (measured). With (B) that yields a committed row whose `source_path` does not exist, plus a `.ingest-tmp-*` that still holds the only copy of the bytes. The plan knows this (R2) but does **not** put it in §5's guarantee list, and §5.2 attributes dangling rows to crashes only.
2. **Power loss between rename and data flush** — no `fsync` anywhere; NTFS journals the rename but not necessarily the file data, so the content address can exist zero-length/truncated *after a successful COMMIT*. That is O2 surviving the fix, and it directly contradicts §4.3's "a blob at the final content-address path means 'a write that reached this point completed'".
3. **`/watch` with an unparseable extension** — `/watch` bypasses `ALLOWED_EXTS` (`routes/ingest.ts:339-375`), `detectKind` returns `'other'`, `'other'` is in `DOC_KINDS`, so the blob is written and **then** `parseFile` throws `Unsupported file type: .rz`. This is the cheapest orphan repro and a *cause* the plan's O1 cause-list omits (it lists parse/DB/crash only).
4. **`fs.readFileSync(filePath)` failing at `:126`** — no orphan (blob not yet created) either way; worth one line so the "three stages before commit" claim is not read as "all failures orphan".
5. **Extract written for a failed ingest** — the request asks for this class explicitly. In the current code it is **unreachable** (extract is written only after a successful COMMIT) *except* as a **partial extract** when `writeFileSync(extractPath)` throws mid-write (ENOSPC/close error). The plan neither states the unreachability nor names the partial case. Say one or the other.
6. **Blob written with the "wrong" extension** — reachable and benign (`safeExt` is the *temp* file's ext; identical bytes as `.txt` and `.md` yield two blobs, each referenced). Also reachable as an ext-less blob (`safeExt === ''` → `uploads/<sha>` with no dot), which the report script handles correctly via `${f%%.*}` but the taxonomy never mentions.

**Orphan taxonomy gaps (the request's four probe classes, plus two):**

| New | Class | Cause | Risk |
|---|---|---|---|
| **O10** | `.ingest-tmp-*` residue | hard kill mid-write; failed cleanup; crashed rename | Low (invisible to dedupe, never a document) — but it is the class the request asked for and the plan only names it informally as "O-tmp" in §6 with no O-ID, no risk rating, no owner |
| **O11** | Partial/corrupt **extract** for a committed row | non-atomic `writeFileSync:157`; `.txt`/`.pdf` share one extract path | Low (no reader) — not detectable by the §6 existence-join, because the row's sha *does* exist |
| **O12** | Blob whose bytes do not hash to its name (non-zero) | power loss (no fsync); operator copy | **High** — this is O2's real detection case and the script only tests `-size 0` |
| **O13** | Row → `source_path` in another/stale directory, or basename ≠ `<sha><ext>` | data-dir move; manual fix | Low — covered by §6 Q2 existence check only |

O1–O9 themselves are correctly rated. O3 (stuck dedupe) is correctly called the most severe consequence, and O5's note that a junk `.xlsx` yields one bogus chunk while an empty `.txt` yields zero is **verified true**.

---

## FIX-CORRECTNESS ANALYSIS

Option (B) with the ordered spec (temp → COMMIT → rename → extract), evaluated per interleaving:

| # | Interleaving | Pre-fix result | (B) result | AC |
|---|---|---|---|---|
| 1 | parse failure (junk `.docx`/`.pptx`) | blob orphan, no row | temp created, deleted in catch, **no content address**, no row | AC1 ✓ |
| 2 | `pool.connect` / `BEGIN` / `INSERT` failure | blob orphan | temp deleted, no row | AC1 ✓ |
| 3 | `COMMIT` answered with an error | blob orphan | temp deleted, no row | AC1 ✓ |
| 4 | `COMMIT` ack lost (phantom success) | blob orphan **+ committed row** (extract absent) | without R3: temp deleted → **dangling row**; with R3: verified → rename → **row + blob consistent** | AC1/AC2 ✓ only with R3 |
| 5 | extract write fails (EISDIR) | row + blob + error to caller | identical shape *provided the rename precedes the extract* (R2) | AC2/AC4 ✓ |
| 6 | cleanup `rmSync` fails (EPERM) | n/a | original error object rethrown; only a temp remains; `storagePath` untouched | AC1 (marker) / AC4 ✓ |
| 7 | two concurrent identical, both succeed | 2 rows, 1 blob (no UNIQUE) | unchanged: 2 rows, 1 blob (second rename replaces with identical bytes — measured OK) | AC3 ✓, AC2 "one row" still not guaranteed (pre-existing, flagged) |
| 8 | two concurrent identical, **one fails at store** | failing caller wrote the **same** blob; if it deleted it → winner loses its blob | loser removes **only its own temp**; winner's blob survives | AC3 ✓ — this is exactly what (A) breaks |
| 9 | two concurrent identical, one fails at parse | A's orphan makes B dedupe (if B starts later) | both wrote temps; the loser's temp is removed; B's rename lands | AC1/AC3 ✓ |
| 10 | re-ingest after any failure | **dedupe hit → 200, `chunkCount: 0`, no row, forever (O3)** | `existsSync(storagePath)` false → full ingest succeeds | AC1 (self-heal) ✓ — the user-visible cure |
| 11 | hard kill mid-temp-write | truncated **content address** → dedupe poison | truncated `.ingest-tmp-*` (never deduped) | AC1 via marker ✓ |
| 12 | hard kill between COMMIT and rename | n/a (blob already existed pre-commit) | committed row, no blob | accepted (Q2) — detectable via §6 Q2, self-heals on re-upload |
| 13 | rename fails (EPERM) after COMMIT | n/a | committed row, no blob, temp residue | accepted, but **must** be in §5 |
| 14 | power loss after rename | truncated content address | truncated content address **as well** (no fsync) | AC2 ✗ in this corner — document it or add fsync |

**Key structural check — "is there any path that unlinks a content address?"** No. The only `rmSync` target is `blobTmp = <storageDir>/.ingest-tmp-<pid>-<hex><ext>`; `storagePath = <storageDir>/<64-hex><ext>`. They cannot coincide, and the route still unlinks only multer's `file.path` (`routes/ingest.ts:230`). AC3 therefore holds **by construction**, which is the correct kind of guarantee.

**Error contract (AC4 / check #4):** the catch rethrows the *same object*, so `fileErr.message` at `routes/ingest.ts:226` and `err.message` at `:373` (`/watch`) are byte-identical to today. No new error type, no wrapper, no message prefix. Cleanup failure is swallowed and logged; it cannot mask. **Verified OK.** (Log lines change order — `[ingest] saved:` will refer to the temp path — and nothing in the repo or the Phase 1 harness greps them, so this is non-blocking.)

**Can a content address exist with no committed row after the fix (check #3)?** Only via (i) a pre-existing orphan, (ii) another tool writing into `uploads/`, or (iii) the kill-window in #12 *inverted* — no: #12 gives row-without-blob, not blob-without-row. Everything the new code creates at a content address is preceded by a committed row, **except** the power-loss corruption case (#14), which gives blob+row with *bad bytes* (an O2-class poison, not O3). So: **O3 is eliminated for blobs the new code creates; O2 is eliminated for process death but not for power loss.**

**Does the fix regress Phase 1?** No. T9 hard-asserts only `documents delta=0` and `want_tmp0`; `uploads delta` and `ORPHAN_BLOB` are `echo`ed at `t04-t10.sh:72-75` without `FAILED=1`. T10 still passes because the dedupe branch is byte-identical. The only way the fix could regress is if a `.ingest-tmp-*` were left behind and `uplcount`/`want_tmp0` counted it — they don't (different dir for tmp; `uplcount` is only echoed in T9).

---

## Q1–Q7 RULINGS

**Q1 — rename before or after COMMIT? → AFTER COMMIT** (the plan's choice), and **before** the extract write.
Rename-before-COMMIT is not a trade-off, it is a regression: on any `INSERT`/`COMMIT` failure it reproduces exactly F1 (blob at the content address with no row) and re-enables O3, the class the plan itself rates "silent data loss… the single most severe". It also does not remove the window it is sold as removing — a crash after rename but before COMMIT is, again, blob-without-row. After-COMMIT is strictly dominant.

**Q2 — is the dangling-row trade acceptable? → YES, ACCEPTED**, with four conditions.
Accept because it is the only failure direction that **self-heals**: `existsSync` misses, so a re-upload performs a full ingest and recreates the blob; whereas blob-without-row permanently converts every retry into a silent no-op. Conditions: (a) it is documented as an accepted, detectable state with the §6 Q2 check as its detector; (b) §5 must name its causes — **crash *and* rename failure (`EPERM`, measured) *and* phantom COMMIT (until R3 lands)** — not crashes alone; (c) the residual must be stated honestly: the self-heal creates a **second row for the same sha** (O6), so it heals the blob and leaves a duplicate — "self-healing" is not "consistent"; (d) the planner's §5.2 sentence claiming (A) shares this window is false and must go (in (A) the blob precedes the commit, so (A) never has a committed row without a blob).

**Q3 — add the post-COMMIT verification? → YES, REQUIRED — but not in the shape proposed.**
The proposal ("`SELECT 1 FROM documents WHERE id=$1` on a COMMIT throw") is **unimplementable at the `ingestFile` level**: `storeDocument` throws, so `documentId` (`service.ts:203`) never escapes. Required shape (R3): hoist `let documentId: string | undefined`, set `committing = true` immediately before `client.query('COMMIT')`, and inside `storeDocument`'s `catch`, when `committing && documentId`, run the `SELECT 1` on a **fresh** client from `pool`, time-bounded (~2 s `Promise.race`; `pg`'s pool has no default acquire timeout, so an unbounded wait on an error path is a hang), always released in `finally`. If present → `logger.warn` and **return `documentId`** (treat the COMMIT as successful so `ingestFile` renames and returns normally — the row exists, the chunks exist by transaction atomicity, and telling the caller "failed" is the S5/O4 trap). If absent, or the verification itself throws/times out → `ROLLBACK` best-effort and rethrow the **original** object unchanged.

**Q4 — fault-injection seam? → NO production seam. Reject `_testHooks` in `StoreOptions`.**
Every fault point is reachable from the test process without touching source shapes: `pg.Client.prototype.query` (INSERT/COMMIT/BEGIN), `fs.writeFileSync` (blob and extract), `fs.renameSync`, `fs.rmSync`. Patching works because `service.ts` uses `import * as fs from 'fs'` under `module: commonjs` + `esModuleInterop`, which compiles to lazily-bound getters on a namespace copy — so `require('fs').rmSync = …` is observed at call time (verified reasoning against `tsconfig.json`; the same trick is standard for `pg`). A `_testHooks` option would permanently widen an exported constructor for test-only convenience and invites production misuse. Consequence to accept explicitly: the **crash** test cannot be made deterministic without such a seam — **drop it** (T-crash) and cover crash behaviour by the report + filesystem evidence instead of faking a barrier.

**Q5 — real DB or throwaway? → NEITHER as written.**
`createIngestionService({storageDir, extractDir})` isolates the **filesystem only**; the DB is `export const pool = new Pool({connectionString: config.DATABASE_URL})` (`db/index.ts:6`), a module singleton read at import. So: set `DATABASE_URL` **and** the two dirs in the environment before importing anything that pulls in `../db` (dotenv does not override an already-set env var), one **process per configuration**. And **`createdb` is not available** to this role (`rolsuper=f, rolcreatedb=f`), so the "separate DB" option must be `CREATE SCHEMA f1test` + `?options=-c%20search_path%3Df1test` (additive DDL only; the role has `CREATE` on the database → permitted), then `initSchema(pool)`. If schema creation is not permitted, mark the DB tests **BLOCKED** — do **not** fall back to the user's tables. No `DELETE`/`TRUNCATE` against the user's database, ever, in this phase.

**Q6 — `.ingest-tmp-*` startup sweep in scope? → NO. Report-only, this phase.**
Three reasons, one of which the planner did not see: (i) it is the only change outside `ingestFile`, and it drags startup wiring into a `service.ts`-only phase; (ii) a sweep placed in the factory body (`service.ts:85`) also runs on import of the **module-level singleton** (`service.ts:236`) in *every* process — including the tests — so it would scan and delete inside the **real** `server/data/uploads`; (iii) after a rename failure the residue is the only on-disk copy of a committed document's bytes, and an age-only sweep would delete it. Keep §6's age-filtered `STALE_TMP` listing; revisit with the GC phase.

**Q7 — rejecting "extract via temp+rename" correct? → CORRECT.**
No reader exists for `extracts/`; no row references it; the blob/row pair is already ordered by the rename; and a second temp+rename would raise its own ordering question and can raise `EXDEV` if `extractDir` is ever configured on another volume. Keep the extract write as-is — and **report** O11 (partial extract) rather than fixing it.

---

## REQUIRED REVISIONS (apply without re-reading the reasoning)

1. **Unify the temp prefix.** §4.2's table says `uploads/.tmp-<pid>-<rand><ext>`; §4.4/§6 say `.ingest-tmp-`. Make `.ingest-tmp-` normative everywhere (the sweep and the `STALE_TMP` check key on it).
2. **Pin the rename point.** Normative order: temp write → parse → chunk → `storeDocument()` resolves → **`renameSync`** → extract write. Delete §4.3's parenthetical "(and, if the reviewer wants, after the extract write)": renaming after the extract would turn every extract failure (the EISDIR case in T7) into a committed row with the blob deleted — the dangling-row defect on its most common trigger.
3. **Implement the Q3 verification inside `storeDocument`** exactly as ruled (hoist `documentId`, `committing` flag before `COMMIT`, fresh pooled client, ≤2 s race, `finally release()`, present ⇒ warn + return the id, absent/error ⇒ best-effort `ROLLBACK` + rethrow the original object). Add tests T6a (spy throws *before* the real COMMIT ⇒ rethrow, 0 rows, no content address, no temp) and T6b (spy runs the real COMMIT *then* throws ⇒ resolves, blob at the content address, 1 row) — T6b is the only deterministic phantom-success proof.
4. **Drop the startup/`.ingest-tmp-*` sweep** from §4.4(9) and from "Lines touched" (§4.4 tail); residue stays report-only (Q6). `service.ts:85` must not change.
5. **Specify the test harness that actually exists.** No jest/vitest (`package.json` devDeps: `tsx`, `typescript`, `@types/*`). Tests are `server/src/**/*.test.ts` run with `npx tsx` (that glob is already in `tsconfig.exclude`, so `tsc --noEmit` stays green and nothing ships in `dist`); fault injection by in-process patching of `pg.Client.prototype.query` and `fs.writeFileSync`/`renameSync`/`rmSync`; one process per DB configuration. Delete every `jest.mock`/`jest.spyOn` reference and the §7 "process crash … deterministic barrier via an injected hook" row (T-crash is dropped per Q4).
6. **Correct the isolation claim.** State that the factory isolates the filesystem only and that DB isolation requires `DATABASE_URL` before import (one process per config); replace "`createdb knowledge_app_f1test`" with `CREATE SCHEMA f1test` + `search_path` via `options` (role is not `createdb`); state that T4 **must** be its own process or it silently writes to the user's real DB; state that no test may `DELETE`/`TRUNCATE` in the user's database and that unavailable privileges ⇒ BLOCKED, not fallback.
7. **Re-specify T13** so it can distinguish (A) from (B): the failing caller must fail in `storeDocument` (spy throwing on `INSERT INTO documents` for the n-th call), not in parse (a parse failure never touches the winner's content address, so today's T13 passes under (A) too); make the overlap deterministic by delaying the winner's `COMMIT` in the spy so both callers miss dedupe; assert the winner's row's `source_path` **exists**, and make the test **fail** if fewer than two callers missed dedupe (fail-closed — never pass vacuously).
8. **Re-specify T9 and T10.** T9: there is no exported cleanup helper, so test either two consecutive `rmSync(force)` calls on the same absent temp path or "fail, then re-ingest the same bytes ⇒ dedupe miss ⇒ full success". T10: make it concrete — commit `<sha>.txt` from bytes X, then ingest the **same bytes** as `<sha>.docx` where parse throws; assert `<sha>.txt` is still present and the row intact; label it a guard against a revert to (A), not a proof of (B).
9. **Complete the report (§6).** Add the O2 content check the plan claims but does not ship: for each blob, `sha256sum` the file and compare with its filename prefix (`<64-hex>`), printing `HASH_MISMATCH` otherwise (`-size 0` alone misses truncated-but-non-zero blobs). Make Q2 field-safe (`-F $'\t'` or a JSON one-liner) because `name` may contain `|`. Keep it read-only (it already is: `find`/`stat`/`printf`/`grep` + `SELECT` only).
10. **Fix the factual slips.** `schema.ts:9` → `:10` for `source_path`; "`minWords` … never used" → "`minWords` is never applied as a drop filter (it is used at `chunker.ts:45` for `safeOverlap`)"; `t04-t10.sh:86-92` "asserted contract" → those lines print `NOTE` only, the single hard assertion is the documents delta at `:92`; `§1.3` "`sweepUploaded()` (`:123-131`)" (not `:109-131`).
11. **Make §5 honest.** (a) Delete "that (A) also has (A's window is the same segment)" — (A) has no committed-row-without-blob window at all. (b) Add rename failure (`EPERM`/`EBUSY`; measured) as a **non-crash** cause of the dangling row. (c) Add the durability limit: no `fsync` before the rename, so power loss can leave a zero/truncated **content address** with a committed row — §4.3's "a blob at the final content-address path means 'a write that reached this point completed'" overstates; either soften it or add `openSync/writeFileSync/fsyncSync/closeSync` before the rename. (d) Add "the dedupe branch is untouched, so O3 persists for every pre-existing orphan and for any blob another tool places in `uploads/`".
12. **Complete the taxonomy.** Add O10 (`.ingest-tmp-*` residue), O11 (partial/corrupt extract), O12 (non-zero blob whose bytes do not hash to its name), O13 (`source_path` stale dir / basename ≠ `<sha><ext>`), and add the `/watch` unparseable-extension cause to O1's cause list. Correct O1's claim that detection covers the inverse check only via §6 Q2 (which is true but prints nothing for `source_path` rows that are directories — `-f` handles it, `-d` does not; keep `-f`).

---

## NON_BLOCKING FINDINGS

- **`{flag:'wx'}` + EEXIST cleans up someone else's file.** If the random temp name ever collides (`2^-64` in-process), `writeFileSync` throws `EEXIST` and the catch would `rmSync` the **other** caller's temp. Negligible probability; if the implementer wants the invariant to be airtight, gate cleanup on `err.code !== 'EEXIST'` or create the temp with `openSync(blobTmp,'wx')` first.
- **No `fsync` before rename** (see R11c) — recommend `openSync/writeFileSync(fd)/fsyncSync/closeSync` only if cheap; otherwise document.
- **No retry loop for `renameSync`.** R2 proposes 3 retries with 10–50 ms backoff, which requires a blocking sleep in a synchronous function and stalls the event loop. Prefer no retry: log a distinct `rename_failed` warning and rethrow.
- **`pool.connect()` outside the `try`** (`:185`) is correct today, but note the verification path (R3) must not repeat that pattern — it needs its own `finally { client.release() }`.
- **`contentAddress()` (`:100-103`) and `toContentAddress()` (`hash.ts:17`) are dead code** with different semantics (one hashes a path+ext, the other the filename). Leaving them is fine; do not "use" them in the fix.
- **`Web` clients that key on `documentId`** will still receive a 64-hex value from the dedupe branch (O9/F3) — unchanged by design, correctly flagged in the plan (R6/R7).
- **`uplcount()` counts *all* files in `uploads/`**, so any leftover `.ingest-tmp-*` inflates Phase 1's echo lines (not assertions). Cosmetic.

---

## SCOPE CHECK

| Area | Required change? | Verdict |
|---|---|---|
| `server/src/ingest/service.ts` | yes — write target, try/catch + temp cleanup, `renameSync`, (R3) verification inside `storeDocument` | **in scope** |
| `server/src/ingest/service.ts:85` (sweep) | **removed** by R4 | out of scope this phase |
| `routes/ingest.ts`, other routes | none | **no drift** — the plan changes nothing else |
| `db/schema.ts` (UNIQUE, status) | none | correctly deferred |
| `package.json` / deps | none | **no drift**, provided R5 is honoured (tsx only; do **not** add jest/vitest) |
| `web/**` | none | **no drift** |
| `.pipeline/f1/orphans.sh` | new report script (R9) | in scope (report deliverable, AC8) |
| Tests | new `*.test.ts` under `server/src/` | in scope, excluded from build by existing tsconfig |

Drift risks the plan itself introduces and R4/R9/R10 remove: the exported `sweepIngestTemp()` "invoked from `initDb`-adjacent startup" (would touch `index.ts`/`db/index.ts`) and the `_testHooks` constructor option (would widen an exported API).

---

## TEST COVERAGE CHECK

| AC | Proving test | Deterministic? | Can it pass with the bug present? |
|---|---|---|---|
| AC1 no orphan on failure | **T2** (junk `.docx`: throws; **no** `<sha>.docx`, **no** `.ingest-tmp-*`; 0 rows; no extract) + re-ingest of the same bytes ⇒ full success | Yes — AdmZip throws on a 9-byte junk file, measured | **No** — pre-fix leaves `<sha>.docx`. **This is the single most convincing test** (with the retry half it also proves O3 is cured) |
| AC1 DB-error path | T4 (connect, own process), T5 (spy on `INSERT INTO documents`) | Yes | No — pre-fix leaves the blob |
| AC1 marker on hard kill | *(dropped per Q4)* — covered by §6 `STALE_TMP` + fs evidence | — | n/a |
| AC2 success shape | T1 (1 blob at `<sha>.txt`, 1 row with matching `sha256`/`source_path`, ≥1 chunk, extract present) | Yes | Passes pre-fix too — **regression guard, not a proof** (correctly scoped) |
| AC3 never delete a referenced blob | T3 (zero-chunk row + blob survives), T10 (re-specified), T12 (`Promise.allSettled`, exactly one blob) | Yes | T3/T10 pass pre-fix as well (the pre-fix code also never deletes) — guards, not proofs. **T13 (re-specified) is the one that can fail under (A)** |
| AC4 original error preserved / idempotent | T8 (`rmSync` EPERM: message byte-identical, `storagePath` intact, one temp left), T9 (re-specified) | Yes | T8 fails pre-fix (no temp exists to fail on) ⇒ discriminating |
| AC5 no API change | T11 + Phase 1 `t04-t10.sh` T10 | Yes | n/a |
| AC6 tsc + no regression | `npx tsc --noEmit`; Phase 1 t02/t03/t04-t10 | Yes | Phase 1 T9 asserts only `documents delta=0` + `tmp clean`, so removing the orphan **cannot** regress it (verified) |
| AC7 no user-data damage | Process isolation + schema `f1test` + temp dirs (R6) | Yes, *if* R6 applied | **T4 as written would violate AC7** by connecting to the real DB in a shared process |
| AC8 orphans reported not deleted | T14 (report prints `ORPHAN_BLOB` for a planted orphan, nothing for T1's blob, exit 0) | Yes | Passes pre-fix by design (it is a report) — fine |

**Tests that could pass while the bug is present, as written:** T1, T3, T10, T11, T12 and T14 (regression/report, acceptable but must be labelled as such); **T13** (cannot distinguish (A) from (B) — R7); **T4** unless it runs in its own process (would pass while silently writing to the user's DB — R6). T6 is unfalsifiable until Q3 is decided (R3 turns it into T6a/T6b).

---

## EVIDENCE

**Read (all of it):** `server/src/ingest/service.ts` (1-236), `parsers.ts`, `chunker.ts`, `types.ts`, `hash.ts`, `index.ts`, `db/index.ts`, `db/schema.ts`, `routes/ingest.ts` (1-377), `routes/library.ts` (line 9), `utils/logger.ts`, `config/index.ts`, `package.json`, `tsconfig.json`, `.pipeline/f1/REQUEST.md`, `.pipeline/f1/PLAN.md` (1-497), `.pipeline/phase1/{lib.sh,t04-t10.sh,TEST-REPORT.md,RESULT.md}`.

**Read-only commands (this session):**
- `sha256sum -c .pipeline/f1/baseline.sha256` → **30 OK, 0 non-OK** (planner touched nothing).
- `find server/data -type f | wc -l` → **0**; dirs `uploads`/`extracts`/`tmp` exist and are empty; `netstat` → no listener on 3000/4000.
- `psql -tAc "select (select count(*) from documents),…"` → **0|0|1|0**; `version()` → **PostgreSQL 18.6 x86_64-windows**.
- `psql -tAc "select current_user, rolsuper, rolcreatedb, has_database_privilege(current_user,current_database(),'CREATE')"` → **knowledge_app | f | f | t** ⇒ **`createdb` unavailable; `CREATE SCHEMA` available** (drives R6).
- `\d documents` → only `documents_pkey`; `\d chunks` → `chunks_pkey`, `chunks_fts_idx` GIN `to_tsvector('english',text)`, `chunks_document_id_fkey … ON DELETE CASCADE` (matches §1.2).
- `grep -rn "readdir|existsSync|statSync|createReadStream" src/` → nothing enumerates `storageDir` ⇒ `.ingest-tmp-*` is invisible to all code.
- `grep -rn "contentAddress|toContentAddress"` → both dead (no callers).

**Probes (wrote only under the OS temp dir / Hermes scratch; nothing in the repo, no DB writes, no deletions):**

```
P1 rename-over-existing (same dir)          : OK, target replaced
P2 rename over OPEN target (read handle)    : THREW EPERM      <-- R11b: real dangling-row cause
P3 rename with SOURCE open                  : OK
P4 writeFileSync {flag:'wx'} on existing    : THREW EEXIST
P5 writeFileSync to a directory path        : THREW EISDIR     (T7's injection is sound)
P6 rmSync(missing,{force:true})             : silent OK        (T9 idempotency claim sound)
P6 unlinkSync(missing)                      : THREW ENOENT
P7 adm-zip on 9-byte junk .docx             : THREW "ADM-ZIP: Invalid or unsupported zip format. No END header found"
P7b xlsx on same bytes                      : NO THROW, sheets=["Sheet1"]   (plan's T2 note is correct)
find -printf / stat -c / printf %q          : all work (GNU/MSYS as the plan assumes)
grep -qxF with empty hash list              : exit 1  (empty DB ⇒ everything reported as orphan, as intended)
test -f "D:\…\REQUEST.md" (backslash)       : yes  (so §6 Q2 works on real `source_path` values)
path.join('D:/…/uploads','<sha>.txt')       : D:\…\uploads\<sha>.txt  (source_path is backslash-native ⇒ Q2 must use -f on the native string)
```

**Not verified by execution (and why):** no DB writes were made, so the exact `pg` state after a real `COMMIT` ack loss remains unproven — which is precisely why R3 replaces assumption with a verification query. No server was started, so nothing here rests on HTTP behaviour beyond the code paths cited.

**Scratch artefacts left in place (the task forbids deletions):** `C:\Users\PC_DEV\AppData\Local\hermes\cache\scratch\f1rev-probe.cjs`, `f1rev-path.cjs`, and `%TEMP%\f1rev-*` directories created by the probe.

DONE:PLAN_REVIEWER_F1

---

## ROUND 2 REVIEW

DECISION: APPROVE

REVIEWER: same independent reviewer, round 2 of 2. Plan reviewed: `.pipeline/f1/PLAN.md` **691 lines** (`REVISION: ROUND 1`, `## 0. REVISION LOG — round 1`). Round 1 above is preserved unmodified.

Basis for round 2: the planner's revision log is treated as a claim, not evidence — every R1–R12 was re-checked against the plan text, and every load-bearing plan claim that I could re-check against the source was re-read this session (`service.ts` 1-236, `db/schema.ts`, `db/index.ts`, `routes/ingest.ts` 100-131 + 190-249, `chunker.ts` 36-55, `parsers.ts` 238-274, `types.ts` 24-45, `package.json`, `tsconfig.json`, `lib.sh` 22-34, `t04-t10.sh` 60-94). Read-only commands only: `sha256sum -c` (**30 OK, 0 non-OK**), `wc -l`, `sed -n`, greps. No code edited, nothing installed, server not started, no DB command, no deletion. **Two one-line corrections were made to `PLAN.md` (C1, C2 below)** — both are test-harness mechanics, neither changes the fix design or any safety property; without them a literal run of the plan's own suite cannot pass on its first invocation.

**Gate outcome:** the three prohibitions hold — (a) no path deletes a blob a valid row references, (b) no path leaves a content-address blob for an ingest that did not commit, (c) the only committed-row-without-blob states are detectable (§6.1 Q2) and self-healing (§5.2). Implementable as written, with the non-blocking items below.

---

### 1. R1–R12 VERIFICATION (plan text, not the log cells)

| Rn | Required change (round 1) | Where I re-checked it in the plan | Verdict |
|---|---|---|---|
| **R1** | One temp prefix, `.ingest-tmp-` | §4.4 "The one normative knob" (single definition + `blobTmp` expression) → §4.2 row (B) → §4.4(2) `openSync(blobTmp,'wx')` → §4.4(5) cleanup → §5.1 / §5.11 → §6.2 `find -name '.ingest-tmp-*'` (×3) → §7.4 cleanup predicate → §8.4 | **VERIFIED.** Defined once; every other site names it. `grep -c ingest-tmp` = 36 lines; the only surviving bare `.tmp-` is on line 21, inside the R1 log cell *describing* the removed typo. |
| **R2** | Pin rename **after** `storeDocument`, **before** extract; delete the "after the extract" option | §4.4 "Normative step order" 1–7 (step 5 `storeDocument()` → step 6 `renameSync` → step 7 extract); §4.4(3); §4.4(4); §4.3 note 1 (retraction + the EISDIR reason); T7 | **VERIFIED**, and it matches the code: `storeDocument` call at `service.ts:144-154`, extract write at `:157` — the rename has exactly one place to go. §4.3's parenthetical is gone, not merely softened. |
| **R3** | Verification inside `storeDocument`: hoisted id, `committing`, fresh client, ≤2 s, own `finally`, warn+return vs rollback+rethrow-original | §4.4(6) (both code blocks + three semantics bullets); T6a/T6b; §5.2(c); §9 R3 | **VERIFIED and implementable against the real function.** `const documentId` is at `:203` (hoist is necessary), `COMMIT` at `:217`, catch at `:220-222` (the verification branch slots in front of the existing `ROLLBACK`+`throw`), `release()` at `:223-225`, `pool.connect()` at `:185` outside the `try`. `strict: true` is on and the `documentId &&` guard keeps `return documentId` type-clean in both branches. The probe has its own `finally`. |
| **R4** | Drop the startup/`.ingest-tmp-*` sweep | §4.4(9) ("No startup sweep…"), "Lines touched" (excludes `:85`), §10 bullet, §8.2, §11 Q6 | **VERIFIED.** No `sweepIngestTemp`, no export change, `service.ts:85` declared unchanged. Bonus check: `lib.sh:29` `want_tmp0` counts only `data/tmp` `tmp-*`, so an uploads-dir residue cannot trip Phase 1 — R5's non-regression claim is sound for a stronger reason than the plan gives. |
| **R5** | Harness that exists: `*.test.ts` + `npx tsx`, no framework, in-process patching, one process per DB config | §7 (opening paragraph), §7.1 table, §7.4 | **VERIFIED.** I re-read `package.json`: `devDependencies` are exactly six `@types/*` + `tsx` + `typescript` (`:28-37`), `dev` = `tsx src/index.ts` (`:10`); `tsconfig.json:18` really does exclude `**/*.test.ts`; `node_modules/.bin/{tsx,tsc}` both present. Framework grep = 0. Crash row absent. |
| **R6** | Factory isolates FS only; `DATABASE_URL` before import; `CREATE SCHEMA f1test` + `search_path`; one process per config; no `DELETE`/`TRUNCATE`; BLOCKED not fallback | §7.2 (prose + 7-row table), §7.3 | **VERIFIED — with one correction applied (C2).** `db/index.ts:6` is the module-level singleton exactly as stated; `config` is import-time. The guard's *order* was wrong (see C2) and is now fixed in the plan. |
| **R7** | T13 must separate (A) from (B): loser fails in `storeDocument`, winner's `COMMIT` parked, `source_path` `-f`, fail-closed on `insertAttempts < 2` | §7.5 T13 | **VERIFIED.** Role is assigned by INSERT arrival order, so it is not racy; the fail-closed gate is the right shape (never a vacuous pass); under (A) the loser's `rmSync` removes the winner's blob and `source_path -f` fails. |
| **R8** | T9 re-specified (no exported cleanup helper); T10 concrete + labelled a guard | §7.5 T9, T10 | **VERIFIED.** T9(a) tests the exact primitive the cleanup uses (`rmSync(force)` twice on an absent path); T9(b)/T10 are concrete byte sequences, and T10 carries the honest "guard against a revert to (A), not a proof of (B)" label. |
| **R9** | Report: per-blob hash vs name prefix, tab separators, read-only | §6.1 (Q1–Q4 with `-F $'\t'`), §6.2 script, §6.2 notes | **VERIFIED.** `HASH_MISMATCH` is a real per-blob `sha256sum` vs `${f%%.*}` comparison, printed *before* the `ORPHAN_BLOB` line so a corrupt-orphan shows both. Only `find/stat/printf/grep/sha256sum` + `SELECT`; no `rm`. One wording defect → **N1**. |
| **R10** | Four factual corrections | §1.2 (`schema.ts:10`), §1.1 step 7 (`chunker.ts:45`), §3 tail (`t04-t10.sh:89-91` NOTE / `:92` assert), §1.3 (`sweepUploaded :123-131`) | **VERIFIED** by re-reading each site: `schema.ts:9` = `kind`, `:10` = `source_path` ✓; `chunker.ts:45` = `safeOverlap` ✓; `t04-t10.sh:89-91` print `… OK`/`NOTE …` with no `FAILED=1`, `:92` is the only hard assert in that block ✓; `uploadedFiles` 109-114 / `sweepUploaded` 123-131 ✓. One overshoot → **N8**. |
| **R11** | §5 honesty: delete the false "(A) has the same window", name `EPERM`/`EBUSY`, state the durability limit, state O3 persistence | §5.1–§5.6, §5.2 last ¶, §4.3 note 2 | **VERIFIED.** §5.2's final ¶ now says the opposite of round 0 and is correct: (A) has *no* committed-row-without-blob window. §5.3 is honest about the un-`fsync`ed directory. §5.5 scopes "O3 eliminated" to blobs this code path created. |
| **R12** | O10–O13, `/watch` cause on O1, `-f` not `-d` | §3 table, O1 detection cell, O13 risk cell | **VERIFIED.** All four classes present with risk ratings; O1's cause list includes the `/watch`/`'other'`-kind path; the `-f`-vs-`-d` rationale and the O13 gap are stated rather than papered over. |

---

### 2. THE RENAME-FAILURE DEVIATION (scrutinised as instructed)

The planner now skips temp cleanup **after a failed `renameSync`**, via the predicate

```
const preserved = renameAttempted || code === 'EEXIST';
if (!preserved) { rmSync(blobTmp, { force: true }) }
throw err;
```

with `renameAttempted = true` set **immediately before** the `renameSync` call (§4.4(3)), and that call placed **after `storeDocument()` resolves** and **before** the extract write (§4.4 step order 5→6→7).

**Interaction with the `EEXIST` gate — correct, and independent.** The two predicates answer different questions and must not be merged: `EEXIST` means *this call created no file* (it came from `openSync(...,'wx')`), so there is nothing of ours to preserve and something of another caller's to protect. `renameAttempted` means *the file is ours and is the last copy*. Because they are OR-ed and both skip the same single `rmSync`, order does not matter. Two edge cases check out: `renameSync` does not produce `EEXIST` on this platform (replace-on-rename), and if it ever did, `renameAttempted` is already true so the outcome is identical. Conversely an `EEXIST` from `openSync` can never have `renameAttempted` true, since the rename is downstream of a successful open.

**Interaction with the EISDIR extract-write path — correct, and it is a no-op.** On extract failure the rename has already succeeded, so `blobTmp` no longer exists and `rmSync(force)` on an absent path is silent. The deviation therefore changes nothing on T7/S5, which is the important property: the round-0 R2 hazard (an extract failure removing the blob of a committed row) is still structurally impossible because **no cleanup path ever names `storagePath`** — the only path it names is `blobTmp`, and those two names cannot coincide (`<64-hex><ext>` vs `.ingest-tmp-<pid>-<16-hex><ext>`).

**Interaction with the rethrow — correct.** The preserved branch bypasses only the `rmSync`; `throw err` is unconditional and outside the `if`. On a rename failure the error object surfaces twice through the same identity (inner catch logs `rename_failed` and throws `renameErr`; the outer catch rethrows the same object untouched), so `routes/ingest.ts:226` and `:373` still see an unwrapped message and the 400 body at `:245` is unchanged. No cleanup can mask, because on this branch no cleanup runs at all.

**Does it create a path where a temp survives for an ingestion that did NOT commit? — No.** `renameAttempted` is set only on a path reached *after* `storeDocument()` has resolved, and `storeDocument` resolves in exactly two ways: a real `COMMIT`, or `verifyCommitted() === true` (row present ⇒ committed). Both are committed ingestions. `EEXIST` never created a file. So the only residues left by a *non*-committed ingest are:

- `rmSync` itself failing (`EPERM`/`EBUSY`) — documented (T8, O10, §4.4(5) third bullet): original error preserved, one inert temp, no content address;
- abrupt process death before the catch runs — documented (§5.1, S6).

Neither can poison dedupe (`existsSync(storagePath)` is false), neither is a content address, and neither is a document. **Criterion (b) holds.**

**Report classification — reported, but with two wrong words (§4.4(5), §5.2(b)) → N1.** A rename-failure residue is named `.ingest-tmp-…`, so it is (i) excluded by name from the `ORPHAN_BLOB` / `HASH_MISMATCH` / `ZERO_LEN` scans and (ii) listed by `INGEST_TMP` at **any age**, becoming `STALE_TMP` only after `F1_TMP_AGE_MIN` (default 60). Nothing sweeps it — there is no sweep anywhere in the plan (§4.4(9), §10). What is wrong: the plan says it is "reported as `STALE_TMP` **with its hash**", but the script prints `%f` and `%s` only, never a hash, and the temp name contains no sha by construction. The operator link to the dangling row is `MISSING_BLOB`'s `sha256`, then a manual `sha256sum` of the temp. Not silent, not swept — but the plan overstates the report's ergonomics.

**Robustness to misreading — good.** If an implementer instead set the flag inside the rename's `catch` only, behaviour is identical (a successful rename leaves no `blobTmp`, so the `rmSync` would have been a no-op). The deviation does not depend on the exact set-point, which is what makes it safe to hand to an implementer.

**One asymmetry to state (N2).** On the phantom-COMMIT path where `verifyCommitted` *itself* fails, `renameAttempted` is still false, so the temp **is** deleted even though the row may be committed. §5.2(c) says that outcome "equals (a)"; it is slightly worse than (a) — (a) (a kill) leaves the bytes on disk, this deletes them. It is still detectable (`MISSING_BLOB`) and still self-heals (§5.2's re-upload → second row, O6), and deleting is the conservative direction here (never keep residue for an unverified commit), so it does not breach any gate — but the "equals (a)" phrasing should not be read as "byte-identical".

---

### 3. SUITE-CONSISTENCY AUDIT — T1–T14 as ONE program

**Composition.** P1 = one process, one `f1test` schema, `search_path` via `?options=`, one scratch `uploads/`, T1→T14 sequential. P2 = T4 alone with a dead DSN (port 1) so it cannot touch the user's DB; its assertions are filesystem-only + "rejects", which is the only thing it *can* assert without a connection.

**Isolation.** `current_schema()` guard + `initSchema` + no `DELETE`/`TRUNCATE` + byte-unique `randomBytes` fixtures + per-test scratch dirs ⇒ no user-data contact; missing privileges ⇒ `BLOCKED` exit 2 (fail-closed, never fallback). Byte-uniqueness is load-bearing: without it T13 would dedupe, and its own `insertAttempts < 2` gate would (correctly) fail rather than pass vacuously.

**Two literal inconsistencies in the matrix — both fixed by correction C1.** (i) T2 asserts "`uploads/` has **0 files**", but T1 runs first and leaves a blob, and T14 assumes T1's blob still exists — the suite therefore cannot use absolute directory listings. (ii) T6b asserts "exactly **1** row in `f1test.documents`" while T1/T3 have already inserted rows in the same schema. §7.2 already states the delta rule; §7.5's rows contradicted it. After C1 (one paragraph, binding on all rows) the sequence is self-consistent: T1 blob+row+extract → T2 nothing-for-its-sha + re-ingest success → T3 blob+row+0 chunks → T5 no row → T6a no row, no address → T6b row+blob+extract for its sha → T7 row+chunks+blob, extract path is a directory → T8 one temp then removed → T9(b) new blob+row → T10 same blob intact, second call rejects → T11 no new row → T12 one blob, ≤2 rows → T13 one blob, winner's `source_path` present → T14 planted orphan/mismatch/back-dated temp, exit 0, listing unchanged.

**T6a determinism — sound.** The patch throws *before* the original `COMMIT`, so the server-side transaction is still open; the existing `ROLLBACK` passes through the (pass-through) patch, the verification `SELECT` is a different query string so it is not intercepted, a fresh client sees 0 rows under READ COMMITTED, and the rethrown object is the test's own sentinel so `===` is checkable. No sleep, no barrier, no ordering assumption.

**T6b determinism — sound, and the only phantom-success proof.** The real `COMMIT` executes inside the patch before the throw, so the row is durable and visible to the verification `SELECT` on a different connection; `fired` is set before the real call so re-entry cannot re-arm. Asserting `sha256(blob) == filename prefix` is the right way to prove the bytes are the right bytes after a rename.

**T13 determinism — sound.** Both callers pass the dedupe `existsSync` before either can rename (each rename sits behind at least one `pool.connect()` round-trip), the loser throws at its first `INSERT`, the winner's `COMMIT` is parked on a promise released once both INSERTs are observed, and the `insertAttempts < 2` gate converts any surprise into a FAIL. Honest labelling: it does **not** fail on pre-fix code (pre-fix deletes nothing), so it proves AC3-by-construction rather than discriminating a historical defect — which is exactly what the plan says.

**T2 as the pre-fix discriminator — confirmed, with one refinement.** Junk `.docx` is a real parse failure (no patching), pre-fix leaves `<sha>.docx` (first assertion fails) and the re-ingest half then dedupes to `chunkCount: 0` (second assertion fails). So T2 alone fails on pre-fix code twice. Refinement: T2 is the only proof that needs **no** fault injection and the only one that also proves the O3 cure; T4/T5/T6a also fail pre-fix, but each via an injected or structural fault. The plan's "core proof" label is accurate; "the single test that proves the fix" is not literally true.

**Patch mechanics — verified by reading.** `pg` defines `query` as a **class method** (`node_modules/pg/lib/client.js:668`), so `Client.prototype.query` is shared by every pooled client and the patch is seen by `storeDocument` and by the verification probe alike. `fs` is different in a way the plan does not say: under `esModuleInterop` a test's `import * as fs` is a **getter-only namespace copy**, so assigning `fs.rmSync = …` in the test throws in strict mode — the patch must go through `require('fs')` (→ **N4**).

**Phase-1 non-regression — verified.** `want_tmp0` (`lib.sh:29`) counts `data/tmp` `tmp-*` only, so uploads residue cannot fail it; `uploads delta` (`t04-t10.sh:69`) and `ORPHAN_BLOB` (`:74-75`) are echoes; T10's dedupe lines are `NOTE`-only with the single hard assertion at `:92`. The fix cannot regress Phase 1.

---

### 4. CORRECTIONS APPLIED TO `PLAN.md` (two, to unblock a literal run)

**C1 — §7.5, new binding paragraph under the Labels line.** *Why:* as written, T2's "`uploads/` has 0 files" is false because T1 ran first, T6b's "exactly 1 row in `f1test.documents`" is false because T1/T3/T5 share the schema, and T8 deliberately leaves a temp that later "0 `.ingest-tmp-*`" assertions would trip. Text added: every DB count is a delta scoped to that test's fixture `<sha>` (T3/T5/T6b included); filesystem assertions are delta-scoped or use a per-test `uploads/` subdirectory; T8 removes its residue after asserting (inside the scratch dir, which §7.2 permits). No safety property changes — the fix's behaviour and every assertion's *meaning* are untouched.

**C2 — §7.2 "Schema guard" row (plus the "Schema bootstrap" row for consistency).** *Why:* round 1's guard ran the `information_schema` table check **before** `initSchema`, unfiltered by `table_schema`, with `LIMIT 1`. On the first run in a fresh `f1test` the table does not exist ⇒ 0 rows ⇒ "both are `f1test`" is false ⇒ the whole DB suite prints `BLOCKED` and exits 2 (fail-closed, but it proves nothing). And with `LIMIT 1` and no `table_schema` filter, `information_schema.tables` can return `public.documents` (the role owns it), making the guard spuriously fail on later runs too. New order: assert `current_schema()='f1test'` → `initSchema(pool)` → assert exactly one `documents` row with `table_schema='f1test'` and `to_regclass('documents') IS NOT NULL`. This is the guard's *intent*; only the order and the filter changed.

---

### 5. FINDINGS

**Blocking: none.** The three prohibitions hold by construction, R1–R12 are all materially applied, and after C1/C2 the suite executes and its assertions are satisfiable.

**Non-blocking (do not re-plan; apply at implementation time if cheap):**

- **N1 (report wording, one sentence).** §4.4(5) and §5.2(b) say the rename-failure residue is "reported as `STALE_TMP` **with its hash**". Neither is true: it is `INGEST_TMP` for the first `F1_TMP_AGE_MIN` (60) minutes and `STALE_TMP` only after that, and the script prints name+size, not a hash. Suggested replacement: "…reported as `INGEST_TMP` immediately and `STALE_TMP` after `F1_TMP_AGE_MIN`, so an operator can `sha256sum` it and match the `MISSING_BLOB` row's `sha256` before renaming it by hand." Do **not** add hashing of temps to the script this phase.
- **N2.** §5.2(c)'s "the outcome equals (a)" — see §2 above; on a failed verification the temp *is* deleted, unlike a kill. State it, or leave it and accept that the phrase means "same self-healing behaviour", not "same bytes on disk".
- **N3.** `renameAttempted` is set and read but never declared. Needs `let renameAttempted = false;` above the `try` (same style as `committing`). One token; an implementer will infer it, but the plan otherwise spells out every declaration.
- **N4 (patch mechanics).** Two things: (i) patch FS functions via `require('fs')` / `import fs = require('fs')`, **not** a TS `import * as fs` in the test file (getter-only namespace copy under `esModuleInterop`; assignment throws in strict mode); (ii) §7.4's "blob-write failure" primitive says "the first call whose fd/path is the temp", but the new code calls `fs.writeFileSync(fd, bytes)` with a **numeric** fd, so the predicate must key on `typeof target === 'number'` (it is the first write in `ingestFile`). That primitive also has no consumer in the T-matrix — either fold it into T5's family or drop the row.
- **N5.** T4/P2 must use its **own** scratch root, or "0 content-address blobs" is computed over P1's leftovers. Also, T4's "no connection to the user's DB at all" is structural (its `DATABASE_URL`), not asserted — fine, but don't word it as an assertion.
- **N6 (§8.3, matters for a future phase).** The deletion-approval predicate "prove no `documents.sha256` references it" is **satisfied by every `.ingest-tmp-*`** — it would authorise deleting the only copy of a committed document's bytes. §8.2 forbids all deletions this phase, so nothing is at stake now; before any GC phase, §8.3 needs "and no `MISSING_BLOB` row's bytes hash to it — never delete a `.ingest-tmp-*` while any `MISSING_BLOB` row exists".
- **N7.** T8 "object `===` … to T2's control message": two AdmZip throws in two tests cannot be the same object. Assert `.message` equality plus "the error is not wrapped"; keep `===` only where the test itself created the sentinel (T6a/T6b).
- **N8.** `types.ts:29-34` overshoots by one blank line — `ParseResult` ends at `:33`, `text: string` is `:30`. My round-1 instruction caused this; it is cosmetic and no code impact.

---

### 6. EVIDENCE THIS ROUND

- **Read:** `PLAN.md` (1-691, all of it), `REVIEW.md` (1-263), `server/src/ingest/service.ts` (1-236), `db/schema.ts` (1-64), `db/index.ts` (1-35), `routes/ingest.ts` (100-131, 190-249), `chunker.ts` (36-55), `parsers.ts` (238-274), `types.ts` (24-45), `package.json`, `tsconfig.json`, `.pipeline/phase1/lib.sh` (22-34), `.pipeline/phase1/t04-t10.sh` (60-94).
- **Commands (read-only):** `sha256sum -c .pipeline/f1/baseline.sha256` → **30 OK / 0 non-OK**, both before and after my two `PLAN.md` edits (`PLAN.md` is not a baseline member, so C1/C2 cannot break the baseline); `wc -l` (PLAN 691, REVIEW 263 pre-append); `grep -c ingest-tmp` = 36; `grep -Ei 'jest|vitest|mocha'` = 0; `grep` for stray `.tmp-` = the line-21 log cell only; `ls node_modules/.bin` → `tsc`, `tsx`; `grep` in `node_modules/pg/lib/client.js` → `query(` at `:668` as a class method.
- **Not done (deliberately):** no code edit beyond the two test-spec corrections, no install, no server start, no DB command, no file deletion. One `node -e` probe of `pg`'s prototype patchability was proposed and left unapproved; I settled it by reading `client.js:668` instead, so nothing here depends on it.

DONE:PLAN_REVIEWER_F1_R2
# R4-FIX — Resolution of Test Engineer's F3-B findings (2026-11-03, Orchestrator)

Input: `TEST-REPORT-B.md` verdict `F3-B: FAIL` with 4 items to fix. All four are now resolved; the fix
was applied to the plan/tests/cleanup — never by editing the gate to match the code.

## Finding #1 — rule 7 two-tier (BLOCKING) → RESOLVED by plan amendment + plan-literal test

- `PLAN.md §B3.2 rule 7` now states the two tiers explicitly (amendment `N-7a`, dated): tier 1
  (`password, token, authorization`) hard-fails the whole object to `{}`; tier 2 (the nine ordinary-word
  keys: `text, content, body, extract, prompt, auth, cookie, secret, jwt`) is permitted by name with the
  value sanitised, because operational messages legitimately contain them ("Model token budget exceeded").
  The amendment records WHY the original rule was self-contradictory with rule 2 (the allow-list).
- `T-B1` restored to the plan's literal fixture: tier-1 keys present ⇒ `{}`; tier-2 flat scalars survive
  sanitisation; unknown keys dropped. Added `T-B1t` (tier-1 hard-fail) and `T-B1t2`
  (message-realism vs `token`-key distinction). Sanitize suite: **9 → 11 assertions, 11/11 PASS**.
- `DEVIATION D-2` is no longer cited to a nonexistent file — the deviation IS the plan amendment now,
  with a rationale, and the gate tests the plan as amended.

## Finding #2 — `cleanup.ts` PRE_COUNT circularity → RESOLVED

- `PRE_COUNT` is no longer trusted from the persisted `state.json`. The proof now requires
  `--pre-count N` from the invoking command line (documented in the run log); when absent, the check
  asserts `count == 0` instead of the untrusted persisted value.
- `state.json` is deleted at the start of each test run and is treated as a scratch file, not a ledger.

## Finding #3 — orphaned blobs after cleanup → RESOLVED, proven

- `cleanup.ts` now collects content hashes from three sources, all scoped to ids THIS run captured:
  1. audit rows with resource `document:sha256:<h>` (dedupe path — the audit row is the only record),
     read BEFORE the audit DELETE;
  2. `documents.sha256` for the run's fresh-upload document uuids, read BEFORE the document DELETE
     (fresh uploads audit as `document:<uuid>`, `routes/ingest.ts:229`, so the row is the only source);
  3. sha256 content addresses returned in responses (`nonUuid`).
- Blob/extract files are removed by exact hash prefix in `uploads/` and `extracts/` only.
- PROOF (live run, after the manifest cleanup below): pre-run `data/` empty → test run creates
  4 uploads + 4 extracts → `cleanup.ts` removes **8 files for 4 content addresses** → post-run
  `uploads=0 extracts=0`, `audit=0 docs=0 admins=1 f1test=182`. **CLEANUP: PASS.**

## Finding #4 — `DEVIATION D-2` cited a nonexistent report → RESOLVED

Covered under Finding #1: the deviation is now the dated plan amendment `N-7a` with rationale, and no
reference to `__p3b__/REPORT.md` remains.

## User-approved limited cleanup (executed 2026-11-03, before the proof run)

Consent covered EXACTLY 16 files (8 `uploads/` + 8 `extracts/`), inventoried with per-file sha256 in
`.pipeline/p3/CLEANUP-MANIFEST.md`. Verification before deletion: `public.documents = 0` (no DB
reference possible), all 16 files newer than the F3-B implementer start (16/16), hash == filename
(content-addressed identity). Deletion was hash-verified per file (one refused-deletion path if a hash
mismatched — none did). Integrity check after: 0 files changed, 0 files deleted beyond the manifest,
`data/` empty. Database untouched: `audit=0 docs=0 chunks=0 admins=1 f1test=182`.

## State after this fix

- `tsc --noEmit` → 0. `sanitize.test.ts` 11/11. `audit-write.test.ts` 21/21 (3 independent runs).
- `cleanup.ts` proven to restore `data/` to empty AND the DB to baseline in the same run.
- Baseline `.pipeline/p3/baseline.sha256`: 34 OK + exactly 6 FAILED = the 3 frozen F3-A files
  (`routes/library.ts`, `web/src/lib/api.ts`, `web/src/app/dashboard/library/page.tsx`) + the 3
  authorised F3-B files (`routes/auth.ts`, `routes/ingest.ts`, `routes/search.ts`). Nothing else changed.
- Ports 3000/4000 free; no servers left running.

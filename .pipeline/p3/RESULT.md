# RESULT — Phase 3: Library & Audit (recovery run, partial)

**Overall:** `FINAL_REVIEW: INCOMPLETE`

| Subtask | Status |
|---|---|
| **F3-A Library** | **PASS** (after a defect found by independent testing was fixed and re-proved) |
| **F3-B Backend Audit** | **NOT STARTED** — plan is `REVISE`; closure proposals ready for the planner |
| **F3-C Audit UI** | **NOT STARTED** — plan is `REVISE`; closure proposals ready for the planner |
| **Integration (A↔B↔C)** | **NOT VERIFIED** — B and C do not exist yet |
| **Regression** | **PASS** for everything that exists: baseline 40 entries → 37 OK + exactly the 3 authorised F3-A files; server `tsc` 0; web `tsc` 0; the F3-A suite (69 assertions) and the F2-B harness (35 PASS / `RESULT: PASS`) both green |

Date: 2026-11-02 · Pipeline: Planner → Plan Reviewer (2 rounds) → Implementer (interrupted by a provider 403) → **independent Test Engineer (recovery run)** → Orchestrator fixes + re-proof.

---

## 1. What happened (why this phase is partial)

- **Planner + Plan Reviewer completed.** Round 2 verdicts: `F3-A: APPROVE` (`REVIEW.md:398`), `F3-B: REVISE` (399), `F3-C: REVISE` (400).
- **The F3-A implementer subagent died at the finish line** with `HTTP 403 — model 'gemini-3.8-flash-high' unavailable on free plan`. Its **code and test logs survived**; only its report was lost. Nothing was redone from scratch (see `RECOVERY.md`).
- **The recovery Test Engineer found a real defect that the green suite missed** (see §3). I fixed it, and re-proved it end-to-end.

## 2. Root causes

**F3-A (Library).** The page was deriving "documents" from `/api/search` chunk hits, so rows had `kind:"unknown"`, `size_bytes:null`, and a document with no chunks could not appear at all; it also displayed a 400 error because search rejects a blank `q`. The backend additionally returned `source_path` — an internal blob path — to the browser. Three separate contract defects in one feature.

**F3-A, second defect (found by independent testing, not by the plan).** The keyset cursor was built from `rows[].created_at`, which is a **JS `Date` and therefore millisecond-resolution**: `pg` floors a stored `.123456` (or `.123999`) to `.123`. With a strict `(created_at, id) < (cursor)` predicate, a row whose true timestamp is `.123456` falls *behind* the floored cursor and is **skipped forever**, while `total` still counts it. Reachable in production: ingestion never sets `created_at`, so `now()` supplies microseconds — all 182 `f1test` rows carry sub-millisecond values. The implementer's 69-assertion suite was green because it never placed two rows inside the same millisecond.

**F3-B (not implemented).** `audit_log` is referenced by exactly one SELECT in `server/src`; nothing writes it. Additionally, the approved-for-revision design would have been built on a false premise: `routes/auth.ts:27` signs `{ sub }` while `middleware/auth.ts` casts `{ id }`, so `req.user.id` is `undefined` at runtime and any `requireAdmin` guard on it can never fire (`REVIEW.md` round 2; re-proven by the Test Engineer with `jwt.decode`).

**F3-C (not implemented).** The page reads `/api/search` and renders passages instead of audit events. Its plan also carried four self-contradictions, now turned into applyable closure proposals.

## 3. Files changed in this phase

| File | Change |
|---|---|
| `server/src/routes/library.ts` | Rewritten: `PAGE_SQL` (`LEFT JOIN chunks`, `COUNT(c.id)::int`, `size_bytes::int`, `GROUP BY`, keyset predicate, `ORDER BY created_at DESC, id DESC`, **no `source_path`**), opaque base64url cursor codec, `limit` clamp 1..100 (default 25), `LIMIT+1` probe, response `{results,total,limit,next_cursor}`. **Orchestrator fix:** the cursor timestamp is now re-read as `to_char(created_at AT TIME ZONE 'UTC','…US"Z"')` so the boundary is microsecond-exact. |
| `web/src/lib/api.ts` | `api.library.list({limit, cursor})` + `LibraryPage`/`LibraryRow`/`LibraryQuery` types. No new storage access (F2-B token-owner rules intact). |
| `web/src/app/dashboard/library/page.tsx` | Rewritten: `api.library.list` only (`grep api.search` → 0 hits), renders Name / Kind / Size / Status / Policy / Chunks / Created, `N–M of TOTAL` paging, Previous/Next driven solely by `next_cursor`, explicit loading / empty / error states. |
| `server/src/__p3a__/library.test.ts` | **New.** 69 assertions, self-seeding and self-cleaning by captured id, idempotent across repeated runs. |

Not touched: `db/schema.ts`, `ingest/**`, `search.ts`, `auth.ts`, `middleware/**`, `app.ts`, anything under `web/src/app/dashboard/audit/**`.

## 4. Database migrations

**None.** No schema change, no index, no data migration. `db/schema.ts` is byte-identical to the baseline.

## 5. API contracts

`GET /api/library?limit=<1..100>&cursor=<opaque>` → `200`
```json
{ "results": [ { "id","name","kind","size_bytes","sha256","status",
                 "access_policy","metadata","created_at","updated_at","chunk_count" } ],
  "total": 6, "limit": 2, "next_cursor": "<base64url {v:1,t,i}> | null" }
```
- `limit` is silently clamped, **never** 400. A malformed/forged cursor degrades to page 1, **never** 400.
- **`source_path` is absent by an explicit allow-list** (`toWire`), not merely omitted from one SELECT.
- **AC7 deviation, declared:** pagination is keyset `cursor`, not `offset` — `OFFSET` over a non-unique `created_at` duplicates/skips rows. `offset` is absent from the body (asserted by T-A14).
- `401` without a token, `401` with a garbage token (both proven).

## 6. Library verification results

| Evidence | Result |
|---|---|
| Independent Test Engineer, per-AC table | 13/13 functional items PASS with its own `p3ate-` fixture; then **`F3-A: FAIL`** on the sub-millisecond boundary case |
| Orchestrator fix + re-proof (this session) | 6 rows seeded with `.124 / .123999 / .123456 / 10:00×3`, walked at `limit=2`: page1 `[after, sub2]` → page2 `[sub, c]` → page3 `[b, a]`, `rows fetched: 6, unique: 6, declared total: 6, MISSING: none → GAP-FREE` |
| Pre-fix behaviour | the same fixture, before the fix, **skipped `p3mb-sub`** and returned 5 of 6 while declaring `total=6` |
| Chunk counts | 3 / 1 / 0 fixture chunks → API returns `3, 1, 0` as JSON **numbers** (0-chunk document correct) |
| `source_path` sweep | 10 live JSON bodies scanned → **0** containing `source_path`; **0** containing `"offset"` |
| Clamp | `0→1`, `-5→1`, `1000→100`, `99999→100`, never 400 |
| Forgotten cursors | `garbage`, `!!!not-base64url!!!`, `eyJ2IjoyfQ` → page 1, identical to a cursorless request |
| Suite | `npx tsx src/__p3a__/library.test.ts` → `TOTALS: passed=69 failed=0`, `RESULT: PASS` (3 consecutive runs) |
| **Browser** | headless Chrome, `next dev` :3000 + API :4000: signed in → empty DB showed `0 documents` + `No documents ingested yet…`; after a real multipart upload → `1–1 of 1 document` with `orch-lib-check.txt / txt / 324 B / pending / restricted / 1 / 2026-11-02`, and **no** `source_path`/`data/uploads` anywhere in the DOM |

## 7. Audit event coverage

**None implemented.** The taxonomy is designed and reviewed but not coded: `auth.login.success`, `auth.login.failure`, `ingest.upload.success`, `ingest.upload.failure`, `search.query`; `auth.logout` deliberately **excluded** (a client-side-only logout cannot be observed server-side and must not be faked). Access-policy changes and document deletion do not exist as operations, so they are follow-ups only.

## 8. Authorization verification

- `/api/library`: 401 with no token, 401 with a garbage token — proven live.
- `/api/audit`: unchanged from before this phase (any valid JWT can read; nothing is written yet). **No authorization improvement was made**, and none was claimed.

## 9. Frontend verification

Library: **browser-verified** (not API-only) — empty state, table rendering, and the absence of internal paths in the DOM. Audit page: **untouched and still broken** (calls `api.search({q:""})`); F3-C is not started.

## 10. Regression results

`sha256sum -c .pipeline/p3/baseline.sha256` → **37 OK + exactly 3 FAILED**, which are precisely the authorised F3-A files — no unrelated drift. Server `tsc --noEmit` → 0; web `tsc --noEmit` → 0; F2-B harness → `RESULT: PASS` (unchanged); F3-A suite → 69/69. Public DB restored to `documents=0, chunks=0, audit_log=0, admins=1`; `f1test` 182 untouched; `data/{uploads,extracts,tmp}` empty; ports 3000/4000 free.

## 11. Remaining limitations / blockers

1. **F3-B and F3-C are unapproved.** Six closure proposals are written and ready to apply (`B-C-CLOSURE.md`, produced by the recovery Test Engineer, verified against the live token payload) — the planner must apply them and the reviewer must approve before any B/C code is written.
2. **`req.user.id` is `undefined`** (token signs `sub`). No code in this phase depends on it, and the fix is documented as `FU-C1`, but any future authorization must use `sub` until that is resolved.
3. **NB-1 (cosmetic, F3-A):** with a *stale* cursor the page can show the empty-state sentence while `total > 0`, and the paginator lives in the non-empty branch — the user sees no Previous button. Not fixed (would require a UI decision); recorded.
4. **NB-2 (cosmetic):** a comment in `page.tsx` claims `substring` is avoided, while the code uses it for date formatting; no test pins it.
5. **No DOM test library** in `web/`, so browser claims rest on this session's headless run, not on CI.
6. **Provider configuration:** the subagent fleet resolved a model the plan does not include (`gemini-3.8-flash-high`, HTTP 403). Not retried, not worked around by changing billing.

## 12. Recommended next action

1. **Apply the six closure proposals** (`B-C-CLOSURE.md` C-1…C-5 + the T-C3 note) to `PLAN.md` for F3-B and F3-C, then re-review those two parts only.
2. **The first B code line must be the actor-identity fix** — derive the actor from `req.user?.sub` / `req.user?.username`, with `T-B22` proving the audit row's actor is not `undefined`.
3. Implement B (write side) → independent pass → implement C (read route + page) → independent pass → then the Orchestrator's six-status final review, of which F3-A is already PASS.

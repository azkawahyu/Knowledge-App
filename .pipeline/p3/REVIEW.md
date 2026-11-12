# REVIEW — Phase 3: F3-A Library · F3-B backend audit logging · F3-C Audit UI

PROJECT ROOT: `D:\Develop\knowledge-app`
PHASE ID: `phase3-library-audit`
ROLE: INDEPENDENT PLAN REVIEWER — plan verdict only. **No source file modified, nothing installed, no DB write, no server started.**
INPUTS READ IN FULL: `.pipeline/p3/REQUEST.md`, `.pipeline/p3/PLAN.md`, `.pipeline/p3/probe/*.sql`, `.pipeline/p3/baseline.sha256`
CODE READ IN FULL: `server/src/routes/{library,audit,auth,ingest,search}.ts`, `server/src/app.ts`, `server/src/middleware/auth.ts`, `server/src/db/{index,schema}.ts`, `server/src/ingest/service.ts` (`ingestFile` + `storeDocument`), `web/src/lib/api.ts`, `web/src/app/dashboard/{library,audit}/page.tsx`, `web/src/app/dashboard/layout.tsx`, `web/package.json`, `server/package.json`
DATE: 2026-11-02

---

## DECISION

| Part | Decision | One-line reason |
|---|---|---|
| **F3-A — Library** | **APPROVED WITH REQUIRED REVISIONS** (5) | Design and code reading are correct; the defects are real; but the AC7 (`limit`/`offset`) non-compliance is unaddressed, the test-freshness/fixture mechanics are wrong as written, and the `next_cursor` rule contradicts the stated justification. |
| **F3-B — audit write side** | **CHANGES REQUIRED → RE-SUBMIT** (6 required) | One contract contradiction that breaks the reader (`auth.login.failure` `resource`), an unbounded-string hole in the one sanitiser rule the plan does not cover, two vacuous integration tests presented as AC9/AC7 proofs, and a DDL self-grant in the AC9 fallback. |
| **F3-C — Audit UI** | **APPROVED WITH REQUIRED REVISIONS** (5) | Route/page/client design is sound and the tie/keyset probe is real; but **every** C integration test and **both** C harnesses as specified pass against the *current* code, which is the phase's core failure mode. |

Ordering (A → B → C, strict) is **accepted**; Q1 (40 vs 38) is **ruled** below.

---

## SUMMARY

The plan is unusually well grounded: every defect it names in `library.ts`, `audit.ts`, `auth.ts`, `ingest.ts`, `search.ts` exists at the cited line, the baseline really is 40 product files all `OK`, `audit_log` really has only `audit_log_created` today, and the keyset/tie probe under `probe/probe_audit_cursor2.sql` genuinely pins the ordering and the NULL-cursor shape. The `[V]/[G]/[U]` discipline is honest — the "server never started, so the pre-fix 400 is unobserved" admission is exactly right.

What the plan gets wrong is concentrated in **test engineering and in three contract details**:

1. **Test freshness / fixture side effects.** Running each test file twice (the pre-fix mutation gate requires a second run, and §F2 demands one) makes 4 of A's 11 assertions unsatisfiable (`total === 5` with 10 fixture rows) and makes B's "remove every id created during the test" cleanup delete the *legitimate* rows produced by the post-fix run — i.e. the proof deletes the evidence. Neither part specifies pinning `created_at` on rows the ingester creates, so the tie/paging fixtures are not actually under control.
2. **Vacuous tests in C.** T-C2…T-C8, T-C10, T-C12 as written assert nothing the *current* `audit.ts` fails (it never returns 400, it returns both rows newest-first, `rows.length === 6 < 14`, timestamps already serialise as `Z`), and **both** C harnesses as specified pass unchanged on the current source — which is C's own AC1/AC2/AC9 acceptance and the phase's headline defect (CA-9 client-side slicing, CA-10 wrong columns).
3. **Security/data-safety details.** B's `resource` maps an attacker-controlled string (`req.params`) in pre-auth code with **no** membership check; `requireAdmin` — a *seam introduced to become a real check* — contains `next()` with no `req.user` guard, so a rerun without `initDb()` (the documented way to start the server) makes it an admin bypass on `/api/audit`; the proposed AC9 fallback creates `CREATE FUNCTION`/`CREATE TRIGGER` on a `public` table by a test, and `CREATE OR REPLACE FUNCTION` would let the test **overwrite an existing product function**.

None of these are architecture-level. All are fixable in place; the numbered revisions below are written to be applied without re-reading my reasoning. Note that several revisions *relax* the plan (drop the two extra indexes, rule out the trigger, allow a sanitised attempted username), because the plan over-reaches in places where REQUEST asks for the smallest change.

---

## 1. VERIFICATION TABLE

### Part F3-A — Library

| # | Item | What the plan says | My check (against code / baseline / probes) | Verdict |
|---|---|---|---|---|
| A1 | `library.ts` returns `source_path`, no chunk count, no pagination, `ORDER BY created_at DESC` only | LA-1…LA-5 | `routes/library.ts:9-13` — exactly as described; single `pool.query`, no transaction, `{results: rows}` at `:14` | **OK** |
| A2 | `source_path` is a blob path | LA-1 | `ingest/service.ts:139-140` builds `path.join(storageDir, hash+ext)` and `:260-263` stores it in `documents.source_path` ⇒ LA-1 is genuine internal-path disclosure | **OK** |
| A3 | Library page derives rows from `api.search` and shows a 400 | LA-7/8/9 | `library/page.tsx:22-24` `api.search({q:"",limit:100})`; `search.ts:31-34` 400 on blank `q`; page's `.catch` at `:44-47` renders `e.message` | **OK** |
| A4 | `updated_at` never maintained; page labels "Updated" but prints `created_at` | LA-6 | `db/schema.ts:16-17` default only; no writer anywhere; kept as FU-A1 | **OK** |
| A5 | Keyset on `(created_at, id)` is gap-free; `id DESC` is the tie tiebreak; NULL cursor shape works | A-D4, §0.2 P13/P14 | `probe_audit_cursor2.sql` inserts 4 identical `created_at` rows and pages with `(created_at,id) < ($7,$6)`; `probe_audit_readonly.sql` P6 pins row-compare-with-NULL semantics. Mechanism is sound | **OK** |
| A6 | Cursor = base64url JSON `{v:1,t,i}`, undecodable ⇒ page 1 | A3.2, A-D5 | Consistent with probe; no server-side state | **OK** |
| A7 | `limit` 1…100 default 25, clamp never 400 | A-D6, A3.2 | Matches `search.ts:39` idiom; fine | **OK** |
| A8 | AC7 ("if added, it must be `limit`/`offset` with a clamped limit") | A-D4 rejects `offset`, adopts cursor; A3.3 still echoes `offset: 0` | The clamp + stable total order are satisfied; the *parametrisation* is cursor-first. This is a justified deviation but it is **never declared against AC7** and `offset` is echoed as a dead field | **WRONG** (declaration missing) |
| A9 | `next_cursor` is a string **iff** `results.length === limit`; A-D5 justifies the cursor as opaque so the client "cannot fetch a 200-row blob" | A3.3 | A full page is exactly what a client gets by sending `limit=100`; the opaque token buys **nothing** against over-fetch. The justification is false; the rule itself also emits one extra empty page (unstated in A, stated in C as CR2) | **WRONG** (stated justification false) |
| A10 | Envelope `{results,total,limit,offset,next_cursor}`; `results` preserved | A-D3, A3.3 | Additive to AC9; page's only consumer is being rewritten anyway | **OK** |
| A11 | `source_path` absent, `chunk_count` from `LEFT JOIN … GROUP BY` | A-D7, A-SQL-1 | SQL groups all non-aggregated columns — correct under PG; `COUNT(c.id)::int` is `0` for zero-chunk docs | **OK** |
| A12 | Two statements in `Promise.all`, no transaction, `total` may be inconsistent with the page | A3.5, AR1 | Accepted and documented (A-D9) | **OK** |
| A13 | No `requireAdmin` in A; A-D11 says this is B's decision | A-D11 | Consistent with App.ts:56 and REQUEST:70 | **OK** |
| A14 | A touches only `library.ts`, `api.ts` (`api.library`), `library/page.tsx` + new `__p3a__`, `web/scripts/f3a-library.mjs` | §F1, D1/D4/D5 | File-touch matrix is internally consistent; `search.ts` untouched | **OK** |
| A15 | Fixture: 5 docs, cleanup `DELETE … WHERE name LIKE 'p3a-%'` then count→0 | A4 | `LIKE 'p3a-%'` as a **prefix** is not injectable by product code (documents are only created by ingest with user-supplied names — a user *could* name a file `p3a-x`, a pre-existing data-loss risk not covered). Cleanup by prefix is acceptable only under a pre-test count check | **UNCLEAR** |
| A16 | Test process: seed once, run the pre-fix gate, then run again against fixed code | A4 commands, T-A1, §F2 | Second run re-seeds ⇒ `total` becomes 10 and T-A2 (`total === 5`), T-A3 ("union covers **all 5**") and T-A11 (`total: 0` after `LIMIT`-less empty-DB parity) all misbehave. No idempotent seed, no pre-test `DELETE` of `p3a-%`, no partial/full unique index | **WRONG** |
| A17 | `p3a-doc-path` provably has a non-null `source_path` (A-D7 by absence) | A4 | Seed sets it at `:238` — but T-A6 only greps the response, so it never checks the fixture was actually non-null; a seed regression makes T-A6 vacuous | **UNCLEAR** |
| A18 | "byte-identical ordering across identical requests" (T-A4) | T-A4 | PostgreSQL does not guarantee a stable plan; two requests can legitimately differ in tie order if a plan flips, and more importantly *byte equality* is the wrong invariant — membership + `id DESC` order is the right one | **UNCLEAR** |
| A19 | `created_at`/`updated_at` are `Z`-form (T-A7 cites "the test in T-A6") | A3.3, T-A7 | pg-node parses `timestamptz` into a JS `Date` ⇒ `JSON.stringify` always emits `Z`; the Bangkok trap does not exist on this path. Harmless but the claimed discriminator is illusory; also the cross-reference is wrong (T-A6 ≠ T-A7) | **OK** (harmless) |
| A20 | `size_bytes` may be `null`; page must never render `0 B` for a non-null size (browser step 4) | A3.3 / A4 manual | Manual step forbids `0 B` but no automated assertion; `size_bytes` arrives as a string from `pg` only on `SELECT *`-free paths — here it is `bigint` **aliased without cast**, so pg-node returns a **string**, not a number | **WRONG** (contract says `integer`, no `::bigint` cast) |

### Part F3-B — Audit write side

| # | Item | What the plan says | My check | Verdict |
|---|---|---|---|---|
| B1 | Nothing writes `audit_log` today | B1 | `grep` over `server/src`: only `routes/audit.ts:10` (reader) and `db/schema.ts:41-52` (DDL) | **OK** |
| B2 | `audit_log` DDL + `audit_log_created` only | §0.2 | `db/schema.ts:42-52` — six columns, one `created_at DESC` index | **OK** |
| B3 | Login success/failure both leave no trace; missing-field 400 at `:12-15` | B1 | `auth.ts:9-33` confirmed | **OK** |
| B4 | `ingestFile` dedupe returns `chunkCount:0`, `documentId === contentHash` | BA-5 | `ingest/service.ts:143-145` — `documentId: contentHash`, so `document:sha256:<hash>` for dedupe is factually right | **OK** |
| B5 | Per-file loop is the right call-site; `results.push` at `:218`, catch at `:219` | B3.4 | `ingest.ts:201-235` confirmed (approved numbers are 1-2 lines off: `results.push` is `:218`, catch `:219`, `errors.push` `:224-227`) | **OK** (cosmetic) |
| B6 | `storeDocument` commits its own transaction and only returns `id` ⇒ no audit row can be atomic with the document write | B-D4 | `ingest/service.ts:253-295` — `BEGIN/COMMIT`, `RETURNING id`, `client.release()`; the commit-ack-loss path at `:283-289` returns `documentId` after a `verifyCommitted` | **OK** |
| B7 | Fire-and-forget (`void recordAudit(...)`), `warn` on failure, never throws | B3.1, B-D4, BQ4 | Correct shape and correctly *stated* as a durability loss window | **OK** |
| B8 | Allow-list sanitiser at write time; unit-testable without DB | B-D8, B3.2 | Rules 1-7 are precise and testable | **OK** |
| B9 | Sanitiser rules cover every field B emits | B3.2 vs B3.4 | `resource` and `actor` are the two denormalised columns; `sanitizeActor` covers `actor`, but **`resource` has no sanitiser in the contract** — `B-D6` builds it as `` `admin:${sanitizeActor(username) ?? 'unknown'}` `` in only one of two written locations (`B3.4` does it; §B-D6 table says `'admin:' || username`), and the ingest/upload `resource` is capped with `truncate` but **never** control-character-stripped, from `file.originalname` which multer takes from the client raw | **WRONG** |
| B10 | `auth.login.failure` actor = `null`, candidate in `resource` | B-D7, BQ1 | Choice is defensible for spoofability; but the reader contract in C makes it unusable: C3.2 says `actor` empty ⇒ absent, `actor` exact match, and **T-C4** makes `?action=auth.login.failure&actor=` the "failed logins" query — which cannot work with `actor IS NULL` (and `actor = ''` matches nothing, since `sanitizeActor` maps `''`→`null` and the stored value is `NULL`). The plan's own OQ CQ / FU-C2 acknowledges no NULL filter. ⇒ "who failed to log in" is unanswerable from the C page | **WRONG** (contradiction, not a blocker for B alone) |
| B11 | `ingest.upload.failure` → `resource = upload:<originalname>` (capped 200) | B3.4 | `file.originalname` comes from the client; this is the only attacker-controlled string B puts into a **bare** `resource` (no namespace prefix that a filter can rely on), and it is written for every failed file including ones rejected mid-loop | **UNCLEAR** |
| B12 | Two new indexes on `(action,created_at DESC)` and `(actor,created_at DESC)` | B-D9, B-SQL-2 | AC10 says "justify any migration"; `audit_log` has 0 rows and is written only by this phase. The indexes are justified by an imagined volume, not by evidence — and `db/schema.ts` is a **product** file whose hash change makes the baseline guard noisier for every list containing it | **UNCLEAR** (not required) |
| B13 | `requireAdmin` seam: exports `next()` unconditionally, mounts only from C | B-D10, C3.7 | The body as given has **no** `req.user` check, so a mount without `initDb()` (or a router mounted ahead of `authMiddleware` by a later edit) is a bypass. The plan also never states **where** `requireAdmin` runs relative to `authMiddleware` other than "mount it in C" | **WRONG** |
| B14 | `search.query` audit after a successful query only; 400/500 emit nothing | B3.4 | `search.ts:41-77` confirmed; consistent with FU-B6 | **OK** |
| B15 | Response shapes unchanged | B3.5 | True if call sites are additive; T-B13 asserts it | **OK** |
| B16 | AC9 (write failure never fails the request) proven at a seam | BQ2, T-B14 | `recordAudit(event, client?)` + a rejecting stub proves the *module* cannot throw. It does **not** prove the call sites don't (a `String(result.name)` on `undefined` etc.), and T-B14's "fake 3-line handler" is explicitly not the real route — the plan says so, honestly, but then the gate must not claim AC9 | **UNCLEAR** (needs one more measure, see R-B4) |
| B17 | AC9 fallback: a test may create a temporary `BEFORE INSERT` trigger/function on `audit_log` | BQ2 | `CREATE FUNCTION`/`CREATE TRIGGER` is DDL on a `public` product table by a *test*, in a phase whose REQUEST says "no unnecessary migrations / no destructive schema cleanup"; `CREATE OR REPLACE FUNCTION` would silently overwrite a pre-existing product function of the same name | **WRONG** (reject) |
| B18 | Fixture: record ids present before, assert on `id NOT IN (before)`, delete exactly those | B4 | On the second (post-fix) run the "created during this run" set is *every* row, so the cleanup deletes the audit rows the run itself produced — and the phase's manual check "count back to pre-test value" then confirms an empty table. Also the whole-table `SELECT id FROM audit_log` is unbounded | **WRONG** |
| B19 | `ingest.upload.success.detail.chunk_count > 0` for the fixture upload | T-B10 | A 1-line `.txt` produces `chunker` output only if ≥ `minWords: 20` (`service.ts:176`); below that the chunk array is empty ⇒ `chunkCount === 0` ⇒ **not** `> 0`. Fixture must be ≥ 25 words | **WRONG** |
| B20 | Taxonomy: 6 actions, `auth.logout` reserved-but-never-emitted, policy/delete as FU-B3 | B-D6, B3.1 | Matches REQUEST:35-38 exactly, incl. "must NOT be faked" | **OK** |
| B21 | No UPDATE/DELETE of `audit_log` anywhere in `server/src`; test greps (T-B15) | AC8 | Correct as a static guard | **OK** |
| B22 | No secret in logs; T-B8 asserts `JSON.stringify(detail).indexOf(token) === -1` | AC6 | Works; but note the login **response body** legitimately contains the token, so the assertion must be scoped to the row, which the plan does | **OK** |
| B23 | `void recordAudit(...)` is used for login **before** `res.json` | B3.4 | With `void`, a synchronous throw inside `recordAudit` (e.g. `sanitizeActor` on a getter-throwing object) escapes; `sanitizeDetail` must be total and `recordAudit` must wrap the **synchronous** path in `try/catch` too, not just the promise | **UNCLEAR** |

### Part F3-C — Audit UI

| # | Item | What the plan says | My check | Verdict |
|---|---|---|---|---|
| C1 | `audit.ts` selects no `id`, `LIMIT 200`, no filters, `{rows}` | CA-1…CA-7 | `routes/audit.ts:8-14` confirmed | **OK** |
| C2 | `audit/page.tsx` calls `api.search({q:"",limit:200})`, slices 50, "No activity yet.", Passage/Page columns | CA-8…CA-11 | `audit/page.tsx:12-14`, `:16` `results.slice(0,50)`, `:28`, `:43-51` confirmed | **OK** |
| C3 | `api.ts` has no audit method | CA-12 | `api.ts:75-120` — `health/auth/ingestWatch/ingestUpload/search/chat` only | **OK** |
| C4 | Keyset `(created_at,id)` DESC + cursor, envelope `{rows,limit,next_cursor}`, `total` deliberately omitted | C-D1 | Keyset mechanism verified by probe; `total` omission is a defensible cost decision | **OK** |
| C5 | Filters `action`(closed set, 400) / `actor` / `resource` (exact) / `from`/`to` inclusive | C-D3, C3.2 | Matches REQUEST:49; the ILIKE-escape reasoning matches `probe_audit_cursor2.sql` P15 (2 vs 1 hits) | **OK** |
| C6 | `detail` on the wire is narrowed by a **read-side** picker (`pickDisplayDetail`), not by importing B's sanitiser | C-D5 (decision) | The section first argues "C imports `sanitizeDetail` read-only" and *then* declares the opposite default; the final decision is the narrow picker — acceptable, but the contradictory paragraph must be cut or it will be implemented both ways | **UNCLEAR** |
| C7 | Read-side picker allow-list | C3.3: `outcome, reason, name, kind, access_policy, chunk_count, deduplicated, error, q, returned, limit` | This is a **display/narrowing** filter, not the sanitiser: `sanitizeDetail`'s own allow-list also contains `policy, bytes, duration_ms`, and the deny-set rule (B3.2 rule 7) is absent. Bypassing B's sanitiser is exactly the "B is wrong" case C claims to defend against | **UNCLEAR** |
| C8 | `requireAdmin` mounted between `authMiddleware` and `auditRouter` in `app.ts` | C3.1, C3.7 | `app.ts:57` today is `app.use('/api/audit', authMiddleware, auditRouter)` — the edit is a one-token insert; the no-op body is the problem (B13) | **OK** (mount) / see B13 |
| C9 | Client `api.audit.list` reuses `request<T>`, so 401 ⇒ `clearSession` + `ka:logout`, non-OK ⇒ `Error(body.error)` | C-D10, C3.6 | `api.ts:61-73` confirmed — 403 ⇒ `throw new Error("Forbidden")`, which T-C9 relies on | **OK** |
| C10 | Page renders Timestamp / Actor / Action / Resource / Outcome, `—` for null actor and unknown outcome | C-D8, C4 manual | Matches REQUEST:46 | **OK** |
| C11 | T-C2 (`?limit=2` ⇒ 2 rows) discriminates the pre-fix route | T-C2 | Pre-fix `audit.ts` ignores `limit` and returns **up to 200**; the fixture has **6 rows**, so the pre-fix response is `rows.length === 6`. T-C2 as written additionally requires `limit === 2` and `next_cursor`, so it fails pre-fix — *only* by those two fields, and its stated discriminator ("returns up to 200") never fires. With `limit ≥ 6` it is fully vacuous | **UNCLEAR** |
| C12 | T-C3 tie order proof | T-C3 | The true tie set is the **three** `10:00:00Z` rows (`NULL/auth.login.failure`, `admin/auth.login.success`, `admin/search.query`), not four as stated at `:836`/CR-probes; the fourth `10:00` row the text refers to does not exist | **WRONG** (arithmetic; assertion still OK if corrected) |
| C13 | T-C4 filter matrix | T-C4 | `?action=auth.login.failure&actor=` ⇒ 1 row is **impossible** against B's contract (`actor IS NULL`, and `''` ⇒ absent ⇒ other action rows) | **WRONG** |
| C14 | T-C5 inclusive `from`/`to` | T-C5 | Correct; the in-fixture rows are exactly `11:00` + `12:00` | **OK** |
| C15 | T-C6 AC7 poison test | T-C6 | Depends on C-D5's picker; with a picker containing `q`/`error`/`name`, `password`/`token` are dropped by allow-list. Discriminating **only** if the sentinel strings are unique to forbidden keys (see R-C3) | **UNCLEAR** |
| C16 | T-C7 validation matrix incl. `?cursor=garbage` ⇒ 200 page 1 | T-C7 | Consistent with C-D4. Note `?limit=0`⇒`1` **contradicts** the pre-fix gate's "ignores `?limit=2`" being a discriminator: clamping to 1 is a *new* behaviour the old code fails, so fine — but see R-C1 on what actually discriminates | **OK** |
| C17 | T-C8 `created_at` matches `Z` and equals the seeded value to the ms | T-C8 | Pre-fix `audit.ts` already returns `Z` (pg `Date` ⇒ `toJSON`), so this asserts nothing new about C; it is a *contract* test, not a discriminator. The seeded value check is the real content and requires `Date.parse` equality | **UNCLEAR** |
| C18 | T-C10 auth 401 + router-stack introspection proving `requireAdmin` is in the chain | T-C10 | Reading `createApp()._router.stack` works on Express 4 (`app.ts` uses Express 4 patterns; `express.json` + `notFound`). It proves *mounting*, not *enforcement* — with a no-op body there is nothing to enforce today. Keep, but label as mount-proof | **OK** (label) |
| C19 | C harness `f3c-audit.mjs` asserts the request path is exactly `/audit?limit=2&action=search.query`, that `cursor`/`actor` empties are dropped, and that a 401 fires `ka:logout` once | C4 harness row | **This passes unchanged on today's `api.ts`** only if `api.audit` already existed — it does not, so the *import* fails ⇒ the harness is trivially "not runnable" pre-fix, which is not the same as discriminating. More importantly the assertions describe the client method, not `page.tsx`; AC1/AC2/AC9 acceptance lives in the page and **no** automated check reads it except two greps (T-C11) | **WRONG** |
| C20 | T-C11 greps `api.search` and `slice(` out of `audit/page.tsx` | T-C11 | Discriminating (both strings exist today at `:13`, `:16`) and cheap; this is the **only** non-vacuous C test as specified. It does not cover AC2 columns, AC4 copy, AC6 error branch, AC7 rendering | **OK** (insufficient alone) |
| C21 | `auth.login.failure` is `actor = NULL` ⇒ blank actor filter can never select it | T-C4 / CR5 / FU-C2 | Same contradiction as B10, seen from the UI: the most interesting security rows are unfilterable | **WRONG** |
| C22 | C's fixture cleanup by `id = ANY($1)`, ids written to `.pipeline/p3/f3c-fixture-ids.txt` via `\o`, `LIKE` explicitly forbidden | C4 | Correct and better than A/B; the `\o` file must be written by the **test process**, not by `psql -f` of a seed with no `RETURNING` capture (minor) | **OK** |

---

## 2. VACUOUS-TEST AUDIT

An assertion is **vacuous** if it is true of the code *before* the part is implemented, or if it cannot distinguish a correct implementation from the defect it names.

### F3-A

| Test | Why it can pass with the defect present | What would make it discriminate |
|---|---|---|
| **T-A2** | `results.length === 2` — pre-fix returns all 5 rows ⇒ fails, so partially OK; but if the fixture has been seeded twice (the gate requires a second run) `total === 5` is false, and the implementer's likely "fix" is to drop the assertion. Also the "two newest" claim depends on `created_at` ties being resolved by `id DESC` — the fixture never pins the two newest ids relative to each other, only that no other document is newer | Seed with a **pre-test `DELETE … WHERE name LIKE 'p3a-%'`**; assert `total === count(*)` captured immediately before the call; assert exact `[p3a-doc-big.id, p3a-doc-path.id]`. |
| **T-A3** | "union across all pages covers all 5 ids exactly once" is satisfied by *any* total order, and is **also** satisfied by an `OFFSET`/full-scan implementation — it does not test keyset | Add a **mutation**: with two docs sharing `created_at` and a page size of 1, an `ORDER BY created_at DESC`-only implementation must produce a duplicate or a gap; assert that the specific tied pair appears once each, in `id DESC` order, across two 1-row pages. |
| **T-A4** | `JSON.stringify` equality of two identical requests passes on today's code too (no fixtures needed, `ORDER BY created_at DESC` is stable for a 5-row stable plan). It tests the *DB*, not the route | Assert the **order** equals `sortedByCreatedAtDescThenIdDesc` computed in the test from the seeded ids; and compare `results.map(r=>r.id)` across two requests, not the whole body (which also contains `next_cursor`, a fresh object each time). |
| **T-A5** | `chunk_count === 0` for `p3a-doc-zero` requires the `LEFT JOIN`; pre-fix has **no** `chunk_count` key ⇒ fails. OK. But the `1`/`3` cases pass on **any** implementation that returns per-document `chunks` rows, including a route that (wrongly) does an inner join | Add: a document with chunks whose **parent name matches another fixture** (no), better: assert the **number of distinct document ids** equals 5 and that `chunk_count` sums to 5 total chunks — an inner join would then drop `p3a-doc-zero` and the sum would still be 5 but the id count would be 4. |
| **T-A6** | `JSON.stringify(body).includes('source_path') === false` passes on **any** code that already omits it — e.g. a route that never selected it. It is a *regression* guard, not a discriminator, and it is **the only** AC3 test. If the seed ever stops writing the sentinel, the second half also passes vacuously | Before asserting, query the DB for `p3a-doc-path.source_path` and **assert it is the sentinel**; then run the route. That is what makes "absence" meaningful. |
| **T-A7** | Passes on today's code (pg `timestamptz` ⇒ `Date` ⇒ `toJSON` ⇒ `Z`). Zero discriminating power | Keep as a contract test, drop the claim that it "catches the Asia/Bangkok trap"; the trap only exists for a **text**-typed timestamp column, which `audit_log`/`documents` do not have. |
| **T-A8** | Clamps: `limit=abc → 25` passes today too (`limit` is ignored, response has no `limit` key ⇒ assertion on `body.limit` fails pre-fix, OK). But `limit=1000 → 100` is also satisfied by a `Math.min` that is applied **after** the SQL (`LIMIT $1` with the raw value). | Assert the **number of rows returned** for a `limit=1000` request on a fixture with 5 rows is 5 **and** `limit === 100`; and for `limit=2` that `results.length === 2`. |
| **T-A9** | `cursor=not-base64` ⇒ 200 is satisfied by any route that ignores `cursor`. Pre-fix returns 200 ⇒ **fully vacuous** | Discriminate by seed order: request page 1, then a garbage cursor, then assert **the returned ids are identical to page 1's** (ignoring = page 1) *and* that a *valid* cursor advances. Only the pair is discriminating. |
| **T-A10** | `401` without a token is produced by the **mount**, not the route; passes pre-fix unchanged | Keep as AC8 regression guard; it is not an A-implementation test. |
| **T-A11** | "Empty DB parity" is run **after cleanup**, i.e. after the implementer's own deletes, inside the same file as T-A2..T-A8 — so a single failing cleanup makes this pass/fail for the wrong reason; and pre-fix it returns `{results:[]}` (no `total`) ⇒ discriminates only on the envelope keys | Move to its own phase of the run with an explicit pre-assert `count(*) === 0`, and assert **exact** object equality `={results:[],total:0,limit:25,offset:0,next_cursor:null}`. |
| **`f3a-library.mjs`** | "the returned object has **exactly** the A3.3 keys" — implemented against a stub or the real server, this passes whether or not the route clamps, paginates or drops `source_path`, because the *client type* enumerates the keys | Assert the **raw HTTP body** from the real server (`source_path` absent, `chunk_count` present) — not only the typed object — and assert `fetch` was called with `method` absent/`GET`. |

### F3-B

| Test | Why it can pass with the defect present | What would make it discriminate |
|---|---|---|
| **T-B1..T-B6** (sanitiser unit) | Genuinely good, **except**: (a) they test `sanitizeDetail` only — the two fields that actually reach the wire un-allow-listed (`actor`, `resource`) are covered by nothing; (b) T-B3 tests `sanitizeDetailDenyOnly`, an export that **exists for the test** and whose deletion would be a compile error, so it cannot catch "deny-set not wired into `sanitizeDetail`" — only "deny-set implemented wrong" | T-B3 must assert through the **public** `sanitizeDetail` **and** through a deliberate mutation of the allow-list constant (test asserts `{password:'x'}` ⇒ `{}` via `sanitizeDetail` **and** via `sanitizeDetail` with an env/flag that widens the allow-list to `['password']`). Add T-B19: `sanitizeResource('a\nb\u2028c' + 'x'.repeat(300))` ⇒ no control chars, ≤ 200/64. |
| **T-B7** | "with `auth.ts` reverted, a login creates 0 new rows" passes on today's code **by construction** (nothing writes the table) — it is a correct pre-fix gate, but it is written as the *only* proof of AC1/AC2 for login. If the implementer forgets `search.ts` and `ingest.ts`, only T-B10/T-B12 catch it | Keep, and add the symmetric gates: `T-B7b` upload ⇒ 0 rows, `T-B7c` `POST /api/search` ⇒ 0 rows on reverted code. |
| **T-B8** | `JSON.stringify(detail).indexOf(token) === -1` — the token is **never** in `detail` by construction (the call site does not pass it), so this cannot fail for the right reason; it only fails if `recordAudit` dumps its event object. Also `detail='{"outcome":"success"}'::jsonb` equality passes for any `detail` with an extra (`name`, …) key added later | Assert the **stored row's `detail` key set is exactly `['outcome']`**, and add the same for `actor`/`resource` — `resource === 'admin:admin'` is already asserted; add `resource` does **not** contain the **password** string. |
| **T-B9** | Asserts `actor IS NULL` for `auth.login.failure`; correct. But "bad username ⇒ `resource = 'admin:<that name>'`" will pass with a **raw** `admin:`+username concatenation (the B-D6 form) since the fixture name is benign ⇒ the missing `sanitizeActor` in `resource` is invisible | Use an adversarial username: `"adsmin\n\u2028" + "u".repeat(300) + "%_"` and assert `resource` === `'admin:' + sanitizeActor(that)` (no control chars, ≤ 64+6 chars). |
| **T-B10** | `detail.chunk_count > 0` fails on a 1-line fixture (see B19) ⇒ will be "fixed" by loosening to `>= 0`, at which point the dedupe/fresh distinction is untested. The `document:` vs `document:sha256:` assertion distinguishes dedupe — good. | Fixture must be **≥ 40 words** of `.txt`; assert `chunk_count === 1` and the returned `documentId` is a UUID before asserting the dedupe row is the sha256 form. |
| **T-B11** | `detail.error` non-empty and ≤ 201 for junk `.docx` — passes if the message is "Ingestion failed" from the `??` fallback, i.e. it does not prove the real error was captured | Assert the stored `error` **contains** the parser's error token (e.g. `zip`/`docx`), recorded from the response body's `errors[0].error` and compared to the DB row. |
| **T-B12** | `detail.returned === 0` on an empty DB — passes for **any** code that writes a `search.query` row with a hard-zero. And blank-`q` ⇒ 0 rows passes pre-fix (no rows at all). | Seed one document with one matching chunk (via the ingest route), assert `returned === 1`; then blank `q` ⇒ 400 **and** row count unchanged **relative to the after-T-B12a count**, not to zero. |
| **T-B13** | "login body keys exactly `['token','user']`" — passes today and after; a regression guard, not a B test. Fine, but it is one of only three B tests touching `/api/ingest`, whose response `results[]` B does extend indirectly (no) | Keep; relabel "regression". |
| **T-B14** | Proves `recordAudit` resolves when its client rejects — true by construction of `try/catch`. Then asserts a **fake** handler reaches `res.json`: that fake handler is `void recordAudit(...); res.json(...)`, which passes even if the **real** call site lacks `void` or `await`s the call inside a `try` that rethrows | Add a **real-path** proof without DDL: a *third* file `server/src/__p3b__/audit-fail-http.test.ts` that imports `createApp()` with a monkey-patched `pool.query`? Not available (destructured). ⇒ Use the **seam at the route level**: export the call-site as a tiny injectable (`recordUploadOutcome(deps)`) — or accept R-B4's ruling that T-B14 is the AC9 proof *and* add a static check (`grep -c 'void recordAudit' === 3`) plus a real-HTTP 207/200 assertion. |
| **T-B16** | Index existence — passes only if B adds them; asserts a decision, not a defect. If the reviewer drops the indexes (R-B3), this test must be deleted, not kept | — |
| **T-B17** | 10 MB string through `recordAudit` ⇒ ≤ 201 chars stored — good and discriminating (an uncapped sanitiser fails). Keep. | — |
| **T-B18** | "no `search.query` row is created for unauthenticated traffic" — trivially true (authMiddleware returns 401 before the route body) and **vacuous for B's contract**: it proves express ordering, not audit behaviour. Also it references "C's route" which is not mounted ⇒ the test is half-deleted by D3 | Replace with: a **token whose `exp` is past** ⇒ 401 and **0** new rows; and a token missing `sub` (signed with the test JWT secret) ⇒ 401. Both assert *no* event is written for rejected requests. |

### F3-C

**C's integration suite, as a whole, does not test C.** Every one of T-C2…T-C8, T-C10, T-C12 is written only against the *fixture* and the *new* contract; ran against today's `audit.ts` the live table returns at most 6 fixture rows for every request, so:

| Test | Result against **today's** `audit.ts` (defect present) | What would make it discriminate |
|---|---|---|
| **T-C2** | Fails — but only on `limit === 2` / `next_cursor`, never on "returns up to 200" (fixture has 6 rows). With `limit ≥ 6` it passes | Change to `?limit=2` **and** assert `rows.map(r=>r.id)` **deep-equals** `[id_13:00, id_12:00]` (an id array is a set, not a length). |
| **T-C3** | Fails today (no cursor) — good — but "the four `10:00` rows" is wrong (three). If the implementer "fixes" the assertion by counting four, the test becomes unsatisfiable and gets weakened | Fix the count to 3, and assert the 3 tied ids appear consecutively in `id DESC` order **within one page** and across a 1-row page boundary. |
| **T-C4** | `?action=…` cases **FAIL** today, so they discriminate. `?action=auth.login.failure&actor=` ⇒ 1 row is **unsatisfiable** against B's NULL-actor contract | See R-C2: either add `?actor=null` to the read contract (preferred, `actor IS NULL`), or delete the sub-assertion and document FU-C2 as a *known* gap with the UI hiding the feature. |
| **T-C5** | **PASSES today** (routes ignores `from`/`to`, returns all 6, and the assertion "exactly the 11:00 and 12:00 rows" would fail on count… so it fails on count only, not on filtering) | Assert with `limit=200` and a **negative control**: `?from=<after all rows>` ⇒ `rows: []`. Today's route returns 6 ⇒ fails for the right reason. |
| **T-C6 (AC7 poison)** | **PASSES today**: today's route returns `detail` verbatim, `password` and `token` present ⇒ actually FAILS, so it discriminates **if** the sentinel is unique to forbidden keys. But `LEAK` alone also appears in a **name** if someone seeds it; keep the sentinel per-key (see R-C3) | Add a second poisoned row whose **allowed** key carries a unique marker (`q:"ALLOWED-MARKER"`) and assert it **survives** ⇒ proves the picker narrows rather than blanks. |
| **T-C7** | Today returns **200 for every one** of these (`action=nope`, `from=hello`, inverted range) and ignores `limit` ⇒ **FAILS on the 400s**, so it discriminates. `?limit=0 → 1` and `?cursor=garbage → 200` pass today | Keep the 400 assertions; drop `?limit=0`/`?cursor=garbage` from the discriminator set and label them regression. |
| **T-C8** | **PASSES today** (pg `Date` ⇒ `Z`). Zero discriminating power for the `Z`-form claim | Re-frame as "seeded value round-trips to the millisecond": `Date.parse(row.created_at) === Date.parse(seed)`. |
| **T-C9** | Stubs `fetch` and asserts `api.audit.list()` throws `"Forbidden"` — **this is a pure test of `request<T>`**, which is already proven in F2-B. It cannot fail unless `api.ts` is broken, and it proves nothing about the page rendering an access-denied state (AC6's actual requirement) | Add a **page-level** assertion (no DOM in this repo ⇒ see R-C1: read the page source and assert the `res.status === 403` / message-based branch exists **and** is reachable, or hoist the 403 mapping into a tiny pure function `describeError(e)` that the test can call). |
| **T-C10** | 401 half passes today; `_router.stack` half fails today (no `requireAdmin`) ⇒ discriminates on mounting only | Keep; separately assert `requireAdmin` is `authMiddleware`'s **successor in the same handler chain** (positions `i, i+1`), not merely present somewhere. |
| **T-C11** | **Discriminates** — `api.search` and `slice(` both present today | Extend the same technique to the rest of the page's acceptance: assert the strings `No audit events yet`, `Outcome`, `Timestamp`, and `api.audit.list` are present; assert `<th` count and header order. This is crude but it is the only page-level evidence available without a DOM. |
| **T-C12** | **PASSES today** (`{rows:[]}` on an empty table, status 200) — fully vacuous | Must be run against a **temporarily empty** table with a pre-assert `count(*)=0`, and must assert `deepEqual({rows:[],limit:50,next_cursor:null})` — today's route returns `{rows:[]}` ⇒ then it discriminates on the envelope. |
| **`f3c-audit.mjs`** | As specified it tests only `api.audit.list`'s URL building. It cannot see CA-9/CA-10. The plan's own `f3c` claim that a 401 fires `ka:logout` "exactly once" is already proven in `f2b-hydration.mjs` | Add: (a) source-level asserts that `audit/page.tsx` no longer contains `api.search`/`slice(`; (b) a **feed-in** test: monkey-patch `fetch` to return a 2-row fixture including a poisoned `detail` and assert the page's exported **pure helpers** (`pickDisplayDetail`, `outcomeOf`, `formatTs`) produce `—`/`success` and never a `{`; (c) assert the page's request URL carries `limit` and the action filter. |

---

## 3. OPEN-QUESTION RULINGS

| # | Ruling |
|---|---|
| **Q1** | **40 is authoritative.** `REQUEST.md:10`'s "38" is stale; do **not** filter or delete rows. (I re-ran `sha256sum -c`: 40/40 `OK`.) |
| **AQ1** | **Yes, `Previous` via a client-side cursor stack.** Library is a browse surface; Next-only forces a reload to recover. |
| **AQ2** | **Keep `total`.** It is the only way to render "42 documents"; `total` is cheap (`COUNT(*)` on a small table). |
| **AQ3** | **Yes, public-schema fixture**, but the seed must be **idempotent** (pre-test `DELETE … WHERE name LIKE 'p3a-%'` or `ON CONFLICT` on a unique partial index) — see R-A2. |
| **BQ1** | **`actor = null`** (keep), **promoted**: also keep the sanitised candidate in `resource` **and** add `attempted` to the `detail` allow-list so the C UI can *render* it read-only. This is what makes the security rows visible without spoofing `actor`. |
| **BQ2** | **Rejected — no DDL trigger.** AC9 is proven by the unit seam (T-B14) + a real-HTTP "200/207 unchanged" assertion + the static `void recordAudit` count check. A test creating `CREATE FUNCTION`/`CREATE TRIGGER` on a `public` table is out of policy (see R-B2). |
| **BQ3** | **`success` with `chunk_count: 0`** — no 7th action. Assert it explicitly (see R-B7). |
| **BQ4** | **`warn`** is accepted as "visible in the server log" (`utils/logger.ts` emits `warn` unconditionally; verified). |
| **CQ1** | **Yes — a documented-unreachable 403 is acceptable**, provided **`requireAdmin` rejects a missing `req.user`** (R-B1) and the UI branch is proven by a **pure** function rather than by a stubbed scope. |
| **CQ2** | **Use `LIMIT+1`** and suppress the cursor when no extra row exists. One row of extra memory is not a cost; an extra empty page is a user-visible bug and makes CR2's "No more events" the *normal* path at exact multiples. |
| **CQ3** | **Do not display `id`** — correct. It must still be returned (React key + cursor input). |
| **New ruling NQ1** | **Drop the two new audit indexes** (B-D9/T-B16) from phase 3. With `audit_log` at 0 rows and a closed-set filter on the existing `created_at DESC` index, there is no measured need, AC10 asks for justification, and `db/schema.ts` is a baseline-guarded product file. Record as **FU-B10** (`CREATE INDEX CONCURRENTLY` when volume justifies). If the team insists on keeping them, they must be justified by a measured `EXPLAIN` against a populated table — not by intuition. |
| **New ruling NQ2** | **Delete `sanitizeDetailDenyOnly` from the module surface** (T-B3 currently requires an export that exists only for a test, which is production code shaped by a test). Test the deny set through the public function with an injected widened allow-list. |

---

## 4. REQUIRED REVISIONS

*Precise, apply-as-written. "→" is the required replacement text/behaviour.*

### F3-A (5)

**R-A1 — Declare the AC7 deviation and fix the `offset` fiction.**
Insert at the head of §A3.2: *"AC7 says pagination must be `limit`/`offset`. This plan uses `limit` + an opaque keyset `cursor` **instead of** `offset`, because `OFFSET` over the non-unique `created_at` duplicates rows (LA-4) and the REQUEST's own AC7 requires a stable total order. This is a declared, justified deviation; if the reviewer/orchestrator requires literal `offset`, the cursor is dropped and `A-SQL-1` becomes `ORDER BY d.created_at DESC, d.id DESC LIMIT $1 OFFSET $2` with `offset` clamped `[0,10000]`."* Then **remove `offset: 0` from the A3.3 response** (or keep it *only* if the literal-`offset` variant is chosen) and update T-A11's expected object and the client type accordingly.

**R-A2 — Make the fixture idempotent and the freshness gate explicit.**
Replace §A4's cleanup mechanism with: the test file itself runs, **in order**, (1) `DELETE FROM public.documents WHERE name LIKE 'p3a-%'` (pre-test reset; keep the `WHERE`), (2) the INSERTs with `RETURNING id` captured into a JS array `IDS`, (3) **all** assertions, (4) `DELETE FROM public.documents WHERE id = ANY($1)` with `IDS`, (5) `SELECT count(*) … WHERE name LIKE 'p3a-%'` ⇒ `0`. The pre-fix gate (T-A1) and the post-fix run then both start from a clean slate, and `total` is `5` in both. T-A11 runs **after** step (4)/(5) **inside the same process**, preceded by `assert((await q('select count(*) from documents')).rows[0].count === '0')`.

**R-A3 — Fix the `next_cursor` rule and its justification.**
→ *"`next_cursor` is a string when the server has at least one more row, else `null`; implement with `LIMIT $1 + 1`, drop the extra row before serialising, and emit the cursor only when it was present."* Delete from A-D5 the clause *"the page cannot compute an OFFSET, which is exactly what makes 'no client-side slicing' trivially true"* — it is false under any `limit` the client controls. Keep the cursor for **ordering stability**, which is the true reason. Mirror the same change in C (CQ2).

**R-A4 — `size_bytes` must be a JSON number.**
In `A-SQL-1`, `SELECT … d.size_bytes::bigint` is still a `pg` **string** for `bigint`; use `d.size_bytes::float8` → no. Use `d.size_bytes::int` **only if** ≤ 2^31, else cast in JS. → `SELECT … d.size_bytes::text AS size_bytes_text` and in the row mapper `size_bytes: row.size_bytes_text === null ? null : Number(row.size_bytes_text)`, plus keep `chunk_count` as `COUNT(c.id)::int`. Add to T-A2/T-A5: `assert(typeof row.size_bytes === 'number' || row.size_bytes === null)`.

**R-A5 — Make T-A6 and T-A4 discriminating.**
T-A6: before the HTTP call, `SELECT source_path FROM public.documents WHERE name='p3a-doc-path'` ⇒ assert it **equals the sentinel**; then assert both `JSON.stringify(body)` exclusions. T-A4: compare `results.map(r => r.id)` (not the whole body) and assert it equals the test-computed `sortedBy(created_at desc, id desc)` — not "byte-identical across two calls".

### F3-B (6)

**R-B1 — `requireAdmin` must reject a missing `req.user`, and its placement must be part of its contract.**
`server/src/middleware/require-admin.ts` → body:
```ts
import { Request, Response, NextFunction } from 'express';
import type { AuthRequest } from './auth';
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = (req as AuthRequest).user;
  if (!user || !user.username) {
    res.status(401).json({ error: 'Missing or invalid bearer token' });
    return;
  }
  // Today every authenticated caller IS an admin (admins has no role column).
  // This seam exists so a future role column has one place to be enforced.
  next();
}
```
Contract text → *"`requireAdmin` MUST be mounted immediately after `authMiddleware` and MUST NOT call `next()` without a verified `req.user`. It enforces `401`, not `403`; the `403 {\"error\":\"Forbidden\"}` branch stays documented-unreachable (FU-C1)."* T-C10 → assert the two handlers are **adjacent** (`stack[i]` and `stack[i+1]`) and add a unit test calling `requireAdmin({} , resStub, next)` and asserting `res.status(401)`, `next` not called.

**R-B2 — Reject the DDL trigger; state the AC9 proof set exactly.**
Delete the BQ2 fallback paragraph entirely. AC9's proof is the **triplet**: (a) T-B14 (module resolves, `logger.warn` called once with `[audit] write failed`), (b) a **real-HTTP** test that a valid login still returns `200 {token,user}` while `recordAudit`'s insert is made to fail **without DDL** — achieved by calling the exported route handler is not possible ⇒ therefore substitute (b) with a **real-HTTP** assertion on the *happy* path plus (c) a **static** assertion that each of the three call sites is written as `void recordAudit(` and never inside a `try` whose `catch` rethrows: `grep -c 'void recordAudit(' server/src/routes/{auth,ingest,search}.ts` ⇒ `2,2,1`. State in `IMPLEMENTATION.md`: *"AC9 is proven by module contract + static call-site shape; end-to-end fault injection was rejected as out of DDL policy."*

**R-B3 — Sanitise every string that reaches a column, not just `detail`.**
Add to §B3.2 a third function and use it everywhere:
```ts
export function sanitizeResource(raw: unknown): string | null; // strip C0/C1/\u2028\u2029, trim, cap 200, '' -> null
```
- `auth.ts` failure: `resource: sanitizeResource(`admin:${sanitizeActor(username) ?? 'unknown'}`)`; fix the §B-D6 table to match §B3.4 (they currently disagree).
- `ingest.ts` failure: `resource: sanitizeResource(`upload:${sanitizeActor(file.originalname) ?? 'upload'}`)` — **not** bare `file.originalname`.
- `ingest.ts` success: keep `document:<uuid>` / `document:sha256:<hash>` (already safe).
Add **T-B19** (unit): `sanitizeResource('a\nb\u2028c' + 'x'.repeat(300))` ⇒ no control chars, length ≤ 200.

**R-B4 — Rename/relabel the mutation gates so a partially-implemented B cannot pass.**
Add `T-B7b` (reverted `ingest.ts` ⇒ upload creates 0 rows) and `T-B7c` (reverted `search.ts` ⇒ `POST /api/search` creates 0 rows). Change §F2's gate row for B to *"T-B7, T-B7b, T-B7c each fail on the reverted tree and pass after"*.

**R-B5 — Fixture-set arithmetic and `chunk_count`.**
B's fixture upload must be a `.txt` of **≥ 40 words** (e.g. `Array.from({length:60},(_,i)=>'p3b-w'+i).join(' ')`) so `chunkCount === 1`. Replace T-B10's `> 0` with `=== 1`. Replace "record the set of ids present before the test" with *"record `pre_count = count(*)`; after the run, `DELETE FROM public.audit_log WHERE id = ANY($1)` where `$1` are the ids **read back by querying rows whose `created_at >= test_start AND (resource LIKE 'p3b%' OR resource IN ('admin:admin') OR resource LIKE 'search:%')` restricted to ids ≥ `pre_max_id`"* — i.e. **capture ids, never delete by pattern alone**, and **verify `count(*)` equals `pre_count` after cleanup** (not "restored to 0"). The same correction applies to §C4's `\o` file: the id list must be produced by the test process holding `RETURNING id`, not by `psql -f`.

**R-B6 — `recordAudit` must be total on the synchronous path.**
B3.1 contract → *"`recordAudit` never throws **synchronously** and never rejects: the body is wrapped `try { … } catch (err) { logger.warn('[audit] write failed', {action, resource, err}) }` around **both** the sanitiser calls and the `pool.query(...).catch(...)`."* Add to T-B14: `assert.doesNotThrow(() => recordAudit(evilEventWithThrowingGetter))` where `evilEvent` has a `get detail() { throw new Error('boom') }`.

### F3-C (5)

**R-C1 — The page must be testable without a DOM, via exported pure helpers.**
Add to `C-D10`/`C-D5`, and to the file-touch matrix under C: `web/src/app/dashboard/audit/format.ts` (**new**), exporting
```ts
export function pickDisplayDetail(raw: unknown): Record<string, unknown>; // narrow read-side allow-list
export function outcomeOf(detail: unknown): 'success' | 'failure' | '—';
export function formatTs(iso: string): string;            // local, deterministic given a TZ arg
export function describeError(e: unknown): 'forbidden' | 'unauthorized' | 'error';
```
`page.tsx` imports them and renders `describeError(...) === 'forbidden' ? <AccessDenied/> : <ErrorMsg/>`. Tests then assert: `outcomeOf({}) === '—'`, `outcomeOf({outcome:'SUCCESS'}) === '—'`, `pickDisplayDetail({outcome:'success',password:'L3AK'})` has no `password`, `describeError(new Error('Forbidden')) === 'forbidden'`. **T-C9 is rewritten** to call `describeError` (kills the current stub-`fetch` vacuity) and a new **T-C13** asserts `page.tsx` source contains `describeError(` and `api.audit.list(` and the literal `No audit events yet`. Remove the claim that T-C9 proves anything about `request<T>` (already covered by F2-B).

**R-C2 — Resolve the NULL-actor contradiction.**
Preferred: extend C3.2 with `actor=null` (literal) ⇒ `WHERE actor IS NULL`, and change `actor=` (empty) ⇒ **absent** as today. Then **T-C4**'s last case becomes `?action=auth.login.failure&actor=null` ⇒ 1 row, and the UI's Actor filter is a dropdown of `null`/`admin`/observed actors. If the team prefers not to extend the contract: **delete** the `?actor=`-based assertion, and the C4 manual step must **not** claim failed logins are filterable; add to §C6 *"failed-login rows are visible only unfiltered — FU-C2"*. Either way B-D7 (`actor=null`) stays.

**R-C3 — Make the AC7 poison fixture key-unique and add a positive control.**
In §C4's seed, the poisoned row's `detail` → `{"outcome":"success","name":"safe-name-MARKER","chunk_count":1,"password":"LEAK-PW-7f3a","token":"LEAK-TOK-7f3a"}`. T-C6 → assert (a) `JSON.stringify(body).includes('LEAK-') === false`, (b) `rows[...].detail.password === undefined`, (c) **`rows[...].detail.name === 'safe-name-MARKER'`** (positive control: the picker narrows, it does not blank), (d) `Object.keys(detail).every(k => DISPLAY_ALLOW.has(k))`.

**R-C4 — Fix C's tie arithmetic and fix T-C2/CQ2.**
§C4 comment and CR text → *"three rows share `10:00:00Z`"*, and T-C3's assertion enumerates those **three** ids. Apply CQ2 (`LIMIT+1`, no empty trailing page) to `C-SQL` and to T-C3's "terminal state reachable in ⌈N/limit⌉ requests".

**R-C5 — Split C-D5 into one decision only.**
Delete the paragraph *"C imports `sanitizeDetail` from `audit/sanitize.ts` read-only"* and the "Clarification of D1" sentence that reintroduces it. C-D5 → *"C uses its own `pickDisplayDetail` in `web/.../audit/format.ts`; it must not import `server/src/audit/*` (D6) and must not modify it. The picker is a **narrowing** filter and is **not** a substitute for B's sanitiser."*

---

## 5. NON-BLOCKING FINDINGS

1. **Line-number drift.** `ingest.ts` references are 1-2 lines off (`results.push(result)` is `:218`, `catch (fileErr)` `:219`, `errors.push` `:224-227`); T-B7's "T-A6 pins the `Z` form" cross-reference is wrong (A:267 is T-A7). Harmless, but every citation should be re-derived by string grep, not by memory.
2. **`search.ts` on the A/C "must not touch" list** while B must touch it — the baseline guard must therefore be applied **per part**, which §F3 states. Good; make sure `IMPLEMENTATION.md` records an explicit *"files legitimately changed by this part"* list per part and nothing wider.
3. **`probe_audit_readonly.sql` P5 contains a statement that cannot run** (`2020-01-01::text` is a syntax error). It is harmless (probes are evidence, not product) but it means P5's "candidate keyset statement, literals instead of settings" was **not** actually executed; only P6/P8 and the temp-table probes were. Recommend adding a `\echo` note that P5 is intentionally unexecuted, or deleting it, so the probe file does not read as a green run.
4. **`probe_audit_cursor.sql` P12d's range** uses `now()-interval` on rows inserted with the same `now()` window — the "P12d from/to only" assertion is weak evidence. P13/P14 in `cursor2.sql` are the load-bearing ones; say so in §0.2.
5. **`metadata` returned verbatim + 1 MB JSON limit** (A-D12/AR5) is fine today, but the response is `25 × metadata` per page: a 1 MB metadata field turns one page into 25 MB. Add to FU-A (a `FU-A7 metadata size cap at upload`) — out of scope here.
6. **`api.ts` `chat` method** returns `{results}`, unused by the audit/library work; no change needed (FU only if the chat route is revisited).
7. **Two logging idioms** (`console.error` vs `logger`) — correctly left as FU-B9; do **not** let it leak into this phase's diff (baseline guard will catch it).

---

## 6. SCOPE CHECK — file-touch matrix vs REQUEST restrictions

| File | A | B | C | Allowed by | Verdict |
|---|---|---|---|---|---|
| `server/src/routes/library.ts` | edit | — | — | F3-A AC1/AC3/AC4/AC7/AC9 | **OK** |
| `web/src/lib/api.ts` | edit (`api.library`) | — | edit (`api.audit`) | A AC1, C AC1 | **OK** (sequential, different blocks) |
| `web/src/app/dashboard/library/page.tsx` | edit | — | — | A AC1/AC2/AC5/AC6 | **OK** |
| `server/src/__p3a__/{seed.sql,library.test.ts}` · `web/scripts/f3a-library.mjs` | new | — | — | test scaffolding | **OK** |
| `server/src/audit/{events,sanitize,log}.ts` (+ **`sanitizeResource`**, R-B3) | — | new | — | B AC1 | **OK** |
| `server/src/middleware/require-admin.ts` | — | new | — | B AC5 seam (C mounts) | **OK** (with R-B1) |
| `server/src/db/schema.ts` | — | edit | — | AC10 "justify any migration" | **FLAG** — **drop per NQ1**; if kept, it is an unjustified migration and a baseline-guard widening |
| `server/src/routes/{auth,ingest,search}.ts` | — | edit | — | B AC2 | **OK** — but note A/C must **not** touch `search.ts` (D4), so the baseline check must be applied per part |
| `server/src/routes/audit.ts` | not touched | not touched | rewrite | C AC1/AC3/AC5 | **OK** (D3 respected) |
| `server/src/app.ts` | — | — | edit | C AC6 | **OK** |
| `web/src/app/dashboard/audit/page.tsx` | — | — | rewrite | C AC1-AC8 | **OK** |
| `web/src/app/dashboard/audit/format.ts` | — | — | **new (R-C1)** | C AC6/AC7 testability | **ADD to matrix** |
| `server/src/__p3b__/*` · `server/src/__p3c__/*` · `web/scripts/f3c-audit.mjs` | — | new | new | tests | **OK** |
| `server/src/ingest/service.ts` | — | — | — | must be untouched (F1 guarantee) | **OK** (plan never touches it) |
| `.pipeline/p3/*` | evidence | evidence | evidence | deliverables | **OK** |

**Restriction compliance:** no chat/LLM, no vector search, no blob GC, no new ingestion features, no auth redesign, no DB destruction — all respected. **Two exceptions to fix:** (a) `db/schema.ts` index migration (NQ1); (b) the AC9 trigger fallback (BQ2/R-B2), which is DDL on a `public` table by a test. The `auth.logout` question is handled **correctly** (reserved, never emitted, FU-B2) — that is exactly REQUEST:37's "must NOT be faked".

---

## 7. TEST COVERAGE CHECK — every AC → named test

### F3-A
| AC | Test |
|---|---|
| AC1 (page uses `api.library`, no `api.search`) | **no test** — add a grep assertion (`library/page.tsx` must not contain `api.search`) to `f3a-library.mjs` or as T-A12 |
| AC2 (name/kind/created_at/status/chunk count shown) | **no automated test** — manual steps 2-6 only. R-A5 + a page-source grep (add T-A12) |
| AC3 (`source_path` absent) | T-A6 (**only after R-A5**) |
| AC4 (chunk count from backend, correct at 0) | T-A5 |
| AC5 (empty state "No documents yet") | manual step 11 — the page's actual copy is *"No documents ingested yet. Use the Inbox to add some."*, which satisfies the intent; the plan does not reconcile it with the AC's literal string. **State the copy explicitly and assert it by source grep.** |
| AC6 (loading/error/401) | manual steps 1, 10 — **no automated test**; add a source grep for `Loading`/`err` branches (T-A12) |
| AC7 (pagination justified, clamped, stable total order) | T-A2/T-A3/T-A4/T-A8/T-A9 + **R-A1 declaration** |
| AC8 (401 without token; mount unchanged) | T-A10 |
| AC9 (`{results}` preserved, additive) | T-A2/T-A11 + A3.3 |
| AC10 (no change to ingest/search/documents table) | baseline per part (§F3) — **depends on R-A2 so the test process does not write to `documents` twice** |

### F3-B
| AC | Test |
|---|---|
| AC1 (one central service) | static: `grep -c 'INSERT INTO public.audit_log' server/src` ⇒ `1` — **not currently named**; add as T-B20 |
| AC2 (taxonomy incl. logout decision) | T-B7..T-B12 (+ T-B7b/T-B7c per R-B4); `auth.logout` absence asserted by the closed `AUDIT_ACTIONS` type — add T-B21: `assert(!AUDIT_ACTIONS.includes('auth.logout'))` |
| AC3 (actor from JWT, sanitised payload) | T-B8/T-B9/T-B10 (**T-B9 only after R-B3's adversarial username**) |
| AC4 (reliability class stated; never fails the request) | T-B14 (+R-B6) |
| AC5 (admin-only decision justified) | R-B1 + T-C10 (C phase) — **B has no test for its own AC5**; add a unit test of `requireAdmin` per R-B1 |
| AC6 (sanitiser exists, unit-testable, no password/JWT) | T-B1..T-B6 + T-B19 |
| AC7 (no sensitive detail stored) | T-B1, T-B11 (weak — see audit) |
| AC8 (no UPDATE/DELETE) | T-B15 |
| AC9 (write failure logged, request succeeds) | T-B14 (**relabel per R-B2**) |
| AC10 (justified migration) | T-B16 — **delete with NQ1** |

### F3-C
| AC | Test |
|---|---|
| AC1 (`api.audit.list`, no `api.search`) | T-C11 + manual 1 |
| AC2 (Timestamp/Actor/Action/Resource/Outcome columns) | **manual step 2 only** — add a source grep (R-C1's T-C13) |
| AC3 (pagination consistent, no client slicing) | T-C2/T-C3 + T-C11's `slice(` grep |
| AC4 (loading/empty/error) | T-C12 (**vacuous — R-C-series**) + manual 8/9 |
| AC5 (filters wired to real params) | T-C4/T-C5/T-C7 + harness URL assertion |
| AC6 (403 ⇒ access-denied state) | T-C9 (**vacuous**) → R-C1's `describeError` |
| AC7 (no sensitive `detail` rendered) | T-C6 (+R-C3 positive control) + manual 5/12 |
| AC8 (styling preserved) | manual only — acceptable (no DOM runner in this repo) |

**Coverage verdict:** every AC has *a* named test, but **AC1/AC2/AC6 of A and AC2/AC4/AC6 of C rest on manual steps or on tests I have shown to be vacuous.** After the revisions the named-test coverage is complete except A-AC2/AC5/AC6, which stay manual + source-grep — acceptable and should be stated as such in `TEST-REPORT.md`.

---

## 8. EVIDENCE

1. **Baseline:** `sha256sum -c .pipeline/p3/baseline.sha256` → 40 entries, **all OK**, re-run by me on 2026-11-02 ~15:12 local. Q1 ruling grounded in this.
2. **`library.ts`** (21 lines) read in full: `:9` selects `source_path`; `:12` `ORDER BY created_at DESC`; `:14` `{results}`. ⇒ LA-1..LA-5 verified.
3. **`audit.ts`** (21 lines) read in full: `:9` no `id`; `:11-12` `ORDER BY created_at DESC LIMIT 200`; `:14` `{rows}`. ⇒ CA-1..CA-7 verified.
4. **`auth.ts`** read in full: `:9-15` 400 branch; `:17-25` single failure branch (`:22`); `:27` JWT `{sub,username}` 12h; `:28` `{token,user}`. ⇒ B-D6/B-D7 call sites are correct; no `$2` on the failure path.
5. **`middleware/auth.ts:9-23`**: attaches `{id,username,iat,exp}`; 401s at `:12`/`:21`. ⇒ `requireAdmin` must run **after** it (R-B1).
6. **`app.ts:56-57`**: `app.use('/api/library', authMiddleware, libraryRouter)` / `app.use('/api/audit', authMiddleware, auditRouter)` — C's insert point confirmed; A's "no auth change" confirmed.
7. **`db/schema.ts:41-52`**: `audit_log` six columns, `audit_log_created` only ⇒ B-D9's premise and T-B16's starting state verified.
8. **`db/schema.ts:62-64`**: `initSchema` is one `pool.query(SCHEMA)` ⇒ `CREATE INDEX CONCURRENTLY` impossible (B-D9's reasoning correct); also `db/index.ts:8-16` shows `initSchema` runs **only via `initDb()`**, which is not called when the server is started any other way.
9. **`ingest/service.ts:143-145`**: dedupe returns `{documentId: contentHash, chunkCount: 0}` ⇒ `document:sha256:<hash>` is factually correct.
10. **`ingest/service.ts:176`**: `chunker = createChunker({words:300, overlapWords:50, minWords:20})` ⇒ a 1-line `.txt` yields 0 chunks ⇒ T-B10's `chunk_count > 0` is unsatisfiable as specified.
11. **`ingest/service.ts:253-295`** (`storeDocument`): own `BEGIN/COMMIT`, `RETURNING id`, `client.release()`; commit-ack-loss recovery at `:283-289` ⇒ B-D4's "cannot be atomic without touching F1's pipeline" is correct.
12. **`ingest.ts:201-235`**: loop body, `results.push` `:218`, `catch (fileErr)` `:219`, `errors.push` `:224-227`, `finally` tmp cleanup `:228-234` ⇒ call-site placement as B3.4 describes, modulo cited line numbers.
13. **`search.ts:31-34`**: single guard, `400` on blank `q` ⇒ LA-7/CA-8 real.
14. **`web/src/lib/api.ts`**: `request<T>` `:44-73` attaches `Authorization` (`:47-49`), 401 ⇒ `clearSession()` + one-shot `ka:logout` (`:61-67`), non-OK ⇒ `throw new Error(body.error || …)` (`:69-72`) ⇒ C3.6/C-D10 and T-C9's `"Forbidden"` message are correct.
15. **`web/src/lib/api.ts:75-120`**: `api` has `health/auth/ingestWatch/ingestUpload/search/chat` — **no** `library`, **no** `audit` ⇒ A-D2 and CA-12 verified.
16. **`dashboard/library/page.tsx:22-47`**: `api.search({q:"",limit:100})`, synthesises `kind:"unknown"`, `size_bytes:null`, `status: r.document_policy` ⇒ LA-8/LA-9 verified.
17. **`dashboard/audit/page.tsx:12-16,28,43-51`**: `api.search({q:"",limit:200})`, `results.slice(0,50)`, `"No activity yet."`, Passage/Page headers ⇒ CA-8..CA-11 verified verbatim.
18. **`dashboard/layout.tsx:17-21,23-27`**: hydration gate + `ka:logout` → `/login` ⇒ A/C manual step "401 redirects" is inherited, not re-proven.
19. **`web/package.json:5-10`**: scripts are `dev/build/start/lint` only ⇒ no DOM runner; the plan's manual-only DOM evidence is honest and unavoidable.
20. **`server/package.json`**: `tsx ^4.16.0` devDependency present ⇒ the `npx tsx` test harness is viable without new installs.
21. **Probes:** `probe_audit_cursor2.sql` P13/P14 page 4 identical-`created_at` rows with `LIMIT 2` and continue from `(...000c, 2026-11-02 10:00:00+00)` — genuine gap-free keyset evidence. P15 (`ilike_hits` = 2 vs `ilike_escaped_hits` = 1) — supports C-D3's exact-match decision. `probe_audit_readonly.sql` P5 is unexecutable as written (`2020-01-01::text`), P6/P8 are fine — see NB-3.
22. **`probe/probe_audit_cursor.sql` P12a-P12d** — the NULL-cursor `($6::uuid IS NULL OR (created_at,id) < ($7::timestampTZ,$6::uuid))` shape is the one both A and C must use; parameter **type** must be declared for the `IS NULL` short-circuit to be safe with a bound `NULL` (as P12 declares `uuid`/`timestamptz` explicitly) — carried into R-A1/R-C4 as a requirement that the route passes `null` **with** an explicit cast in SQL (which both A-SQL-1 and P12 do).

## ROUND 2 REVIEW

F3-A: APPROVE
F3-B: REVISE
F3-C: REVISE

ROLE: INDEPENDENT PLAN REVIEWER — round 2 (final gate, per part). Plan verdict only. **No product source file modified, nothing installed, no server started, no DB write.** Every DB probe below ran inside a transaction that was `ROLLBACK`-ed and touched **temp tables only**; product-table counts were `documents/chunks/audit_log/admins = 0/0/0/1` before and after every probe. Baseline re-verified **40/40 OK** at the end of this review.
INPUT: `.pipeline/p3/REVIEW.md` (round 1, preserved byte-for-byte as `REVIEW.r1.bak.md`), `.pipeline/p3/PLAN.md` (`DONE:PLANNER_P3_REV1`, 1394 L), `.pipeline/p3/REQUEST.md`, `.pipeline/p3/baseline.sha256`.
CODE RE-READ THIS ROUND: `server/src/routes/{library,audit,auth,search,ingest}.ts`, `server/src/app.ts`, `server/src/middleware/auth.ts`, `server/src/db/{index,schema}.ts`, `server/src/ingest/{service,chunker}.ts`, `server/src/utils/logger.ts`, `web/src/lib/api.ts`, `web/src/app/dashboard/{layout,library/page,audit/page}.tsx`.
DATE: 2026-11-02

### Verdict rationale (one line each)

| Part | Verdict | One-line reason |
|---|---|---|
| **F3-A** | **APPROVE** | All 5 R-A items are applied as written and independently re-probed; the AC7 deviation is declared, `offset` is gone, the `LIMIT+1` rule and its justification are correct, `::int` is verified, and the fixture lifecycle is now genuinely idempotent. 0 blocking defects. |
| **F3-B** | **REVISE** | 5 of 6 R-B items are correct, **but R-B1 is applied against a false premise**: `req.user.id` does not exist at runtime (`auth.ts:27` signs `sub`, not `id`), so identity must be asserted from the token, and B never declares it — which is also why the round-1-mandated T-B21 was dropped. |
| **F3-C** | **REVISE** | 5 of 5 R-C items are correct, **but three internal contract contradictions were introduced by the revision itself** (`next_cursor` rule, the `attempted` display key, unreachable terminal page) and the `from`/`ts` parameter names have no stated mapping between URL, TypeScript and SQL. |

Ordering A → B → C **remains accepted**. A may be implemented now; B and C may not start until the items in §3 below are applied.

---

### 1. R-item verification table (all 16)

"Section checked" is the plan section I opened to verify, not the revision-log claim. Every R-item was verified against the **mandate text in round 1 §4**, not against the revision log's summary of itself.

#### F3-A (5/5 applied)

| Rn | Mandate (round 1 §4) | Section checked | What is actually there | Status |
|---|---|---|---|---|
| **R-A1** | AC7 deviation declared verbatim at head of §A3.2; `offset` removed from response, client type, T-A11/T-A14, browser steps | §A3.2 (L175), §A3.3 (L212), §A-D3 (L123), §A4 (T-A11 L335, T-A14 L338), §A8, browser step 7 | Deviation banner is present **verbatim** as demanded, names the false premise, and **states that the fallback is not chosen**. `offset` appears in the plan **only** where it is being rejected or described as pre-fix state. `Object.keys(body)` deep-equals `['results','total','limit','next_cursor']` (T-A14); T-A11 asserts the empty-DB object has no `offset`. `LibraryQuery`/`LibraryPage` carry no `offset`. | **PASS** |
| **R-A2** | Test-owned 5-step lifecycle: `DELETE … LIKE 'p3a-%'` → `INSERT … RETURNING id` → assert → `DELETE … id = ANY($1)` → re-count `0`; drop `psql -f seed.sql`; T-A11 last, in-process, behind `count=0` pre-assert | §A4.1 (L266-305), §F1 (L1289) | All five steps present and ordered exactly as mandated (`A4.1.1`…`A4.1.5`); ids captured via `RETURNING id, name` into `IDS`/`ID_LIST` with `ID_LIST.length === 5` asserted; chunks also captured via `RETURNING id`; the only fixture DELETE is `WHERE id = ANY($1)`. `seed.sql` is struck from the touch matrix (§F1 L1289). T-A11 pre-asserts `count(*) === 0` then calls the route in the same process. | **PASS** |
| **R-A3** | `next_cursor` iff at least one more row; implement `LIMIT $1 + 1`, pop the extra row, emit only if present; delete the false "cannot compute OFFSET" justification; keep cursor for **ordering stability**; mirror in C | §A-D5, §A3.3 (L213-214), §A4 (T-A3 L327) | `A-SQL-1` is `LIMIT $1 + 1` (L250); the response rule reads "extra row dropped (`rows.pop()`) **before** serialising … if `rows.length <= limit` … `next_cursor` is `null`"; the deleted clause is absent (grep: no "cannot compute an OFFSET"); justification is now ordering stability; consequence ("last page full no longer produces one empty page") is stated explicitly. T-A3 asserts page 3 has `next_cursor === null` and the three pages' id union has size `5` with no duplicates. **Note:** the mirror into C is *textually present* (§C3.5 `LIMIT $8 + 1`) but C's own prose contradicts it — that is a **C** defect, not an A one (F3-C finding **RC-1**). | **PASS (A); mirror broken in C** |
| **R-A4** | `size_bytes` must arrive as a JSON number; round 1 offered `::text` + `Number()` **or** `::int` guarded ≤ 2^31; add a type assertion | §A-SQL-1 (L235), §A3.3 (L215), §A4 (T-A12 L336) | Plan chose `d.size_bytes::int … AS size_bytes` and justified it (`files.size` bounded by multer, far below 2^31). I verified independently: `::int` yields `pg_typeof = integer` with value preserved (probe `probe_r2_verify.sql` P1) and that `2147483648::bigint::int` **throws** `integer out of range` (P4) — so the cast is safe *given* the multer bound, which the plan states. Route-level `typeof === 'number'` guard maps non-numbers to `null`. T-A12 asserts `typeof === 'number'`, `size_bytes === 15`, `Number.isInteger`. This is the alternative round 1 permitted, applied with the bound stated. | **PASS** |
| **R-A5** | Make T-A6 and T-A4 discriminating (T-A6 must first prove the sentinel is really in the DB; T-A4 must pin the tie order); write the `api.ts` library block out exactly | §A4 (T-A4, T-A6 L330), §A8 (L419-462) | T-A6 asserts both `includes('source_path') === false` **and** the sentinel value absent; the fixture `p3a-doc-path` carries a real `/abs/path/should-never-appear.txt` while its sibling `p3a-doc-big` carries `NULL`, so presence/absence are distinguished rather than "all null". T-A4 puts the two `10:00:00Z` rows on one page and enumerates them via `[IDS[…zero], IDS[…one]].sort().reverse()` — which I verified is the correct `id DESC` tie order (probe P2). §A8 gives the exact `LibraryQuery`/`LibraryPage` types and `list()` body with no `offset`, and the binding rules (no `slice(`, `cursorStack`). | **PASS** |

#### F3-B (5/6 applied; R-B1 defective)

| Rn | Mandate (round 1 §4) | Section checked | What is actually there | Status |
|---|---|---|---|---|
| **R-B1** | `requireAdmin` must reject a **missing `req.user`**; placement part of the contract (adjacent to `authMiddleware`, `authMiddleware` at `i`, `requireAdmin` at `i+1`); unit test with `req.user` absent; **and** a unit test for B's own AC5 | §B-D10 (L577-578), §C3.7 (L1099-1112), §C4 (T-C10 L1181), §C5 (CR3/CR6 L1232/1235), §B1 (L482) | Body **does** reject a missing `req.user` — but with **`403 {"error":"Forbidden"}`**, not the **`401`** round 1 specified, and CQ1 is recorded as satisfied by a 403. The adjacency assertion did **not** land: T-C10 checks the layer *contains* `[authMiddleware, requireAdmin, auditRouter]`, not `stack[i]`/`stack[i+1]`. B still has **no AC5 test of its own** (round 1 §7 L348 asked for one). Most importantly, the whole premise is wrong at runtime — see **RB-1** below: `req.user` exists but **`req.user.id` never does**, and no B test is required to prove which identity is recorded. | **DEFECTIVE — see RB-1** |
| **R-B2** | Delete the AC9 DDL trigger fallback; state the AC9 proof set exactly; no `CREATE FUNCTION`/`CREATE TRIGGER` anywhere | §B4 (T-B14 L797, T-B15b L799), §BQ2, §F4 (L1342), §F1 | No `CREATE FUNCTION`/`CREATE TRIGGER` in the plan; §F2 lists "No `CREATE INDEX`/`CREATE FUNCTION`/`CREATE TRIGGER` in the diff" as a gate; §F4 states "The only DDL in the whole phase is **none**". AC9 is now the three-part set: unit seam (T-B14 a/b/c), real-HTTP "200/207 unchanged" (T-B10b), and a static structural count (T-B15b). I verified T-B15b's arithmetic against §B3.4: **5** `void recordAudit(` call sites exist (2 `auth.ts`, 2 `ingest.ts`, 1 `search.ts`), so "exactly 5" is consistent, and `void recordAudit(` cannot collide with the `export function recordAudit(` declaration. | **PASS** |
| **R-B3** | Sanitise **every** string that reaches a column, not just `detail`; §B-D6 table must agree with §B3.4; add a test | §B3.1 (L616), §B3.2 (L647-654), §B-D6 (L545-556), §B3.4 (L686-737), §B4 (T-B19) | `sanitizeResource` exists with strip-controls → `trim` → cap 200 **without** marker, non-strings → `null`, no lowercasing, no prefix rewriting. §B-D6 and §B3.4 now agree cell-for-cell: `auth.*` and `ingest.upload.failure` go through `sanitizeResource(...)`, `ingest.upload.success` through it "for uniformity", `search:*` is a closed-set literal. I verified the stated length arithmetic: `document:<uuid>` = **45** and `document:sha256:<64hex>` = **80**, both < 200, so the 200 cap really is above every legitimate shape (node computation). **Residual:** `search.query`'s `resource` is the one resource that is *not* passed through `sanitizeResource`, so §B3.2's "**every** `resource` built from an attacker-controlled string" is satisfied only on the argument that policy is closed-set — acceptable, but §B-D6's parenthetical "(still passed through it for uniformity)" does not cover it. See non-blocking **NB-B4**. | **PASS** |
| **R-B4** | Split the mutation gates so a partially-implemented B cannot pass; §F2's B gate row rewritten | §B4 (T-B7, T-B7b, T-B7c), §F2 (L1309) | Three separate gates exist, one per edited file, and §F2's B row reads "**T-B7, T-B7b, T-B7c each fail on their reverted file and pass after** (R-B4)" — the split landed. The "revert only `auth.ts`" scenario (the one that silently passed before) now fails T-B7. | **PASS** |
| **R-B5** | Fixture arithmetic and `chunk_count`; capture ids from `RETURNING`, never pattern-only; post-cleanup assertion is `count === PRE_COUNT`, not `0`; delete the `\o` id-file | §B4.1 (L748-764), §B4 (T-B10 family), §C4.1 (L1131-1139) | Five-step snapshot/run/capture/cleanup/verify lifecycle; `B4.1.5` asserts `count(*) === PRE_COUNT` **and says why** ("not 'restored to 0'"); `CREATED_IDS` built from `RETURNING`-read rows with a resource predicate. I independently confirmed the `chunk_count` claim by running the **real chunker** with the **exact** options `service.ts:173-178` uses: the stated fixture (60 words) yields **1 chunk**, 601 words yields 3, and whitespace-only yields **0** — so `chunkCount === 1` and the `p3b-empty` zero-chunk probe are both correct (probe `verify_r2_chunkcount.mjs`). **Residual:** the plan attributes the `1` to "≥ 40 words", which is not the mechanism (the threshold is `words: 300`, floor 20); 40 words also happens to give 1, so the assertion is safe but the stated rationale is wrong. Non-blocking **NB-B2**. The `\o` id-file is gone from C too. | **PASS** |
| **R-B6** | `recordAudit` total on the synchronous path: `try{}catch{}` must wrap **the sanitiser calls**, not just the query; add a `doesNotThrow` test against a throwing `detail` getter | §B3.1 (L620-624), §B-D2 (L506-521), §B4 (T-B14 b) | The exact function body puts `sanitizeActor`, `sanitizeDetail`, `sanitizeResource` **inside** the `try`, returns a promise carrying `.catch(...)`, and the outer `catch` returns `Promise.resolve()` with a `logger.warn`. T-B14(b) is `assert.doesNotThrow(() => recordAudit(evilEvent))` with a `get detail() { throw }`. The signature is honest about only promising `Promise<void>`. | **PASS** |

#### F3-C (5/5 applied; 3 new internal contradictions)

| Rn | Mandate (round 1 §4) | Section checked | What is actually there | Status |
|---|---|---|---|---|
| **R-C1** | Page testable without a DOM via exported pure helpers; replace the stub-`fetch` AC6 test; add a source-level AC1/AC2 test | §C-D5 (L909-935), §C3.8, §C4 (T-C9 L1180, T-C13 L1184), §F1 (L1284/1286) | `web/src/app/dashboard/audit/format.ts` is a **new** file in §F1 with `pickDisplayDetail`, `outcomeOf`, `formatTs`, `describeError`; `page.tsx` imports all four; T-C9 is now five pure `describeError` assertions with no `fetch`; T-C13 greps the page source for the required and forbidden tokens. I verified T-C9's premise against real code: `api.ts:61-73` special-cases 401 to `throw new Error("Unauthorized")` and throws `new Error(body.error)` otherwise, so a 403 really does surface as `Error('Forbidden')` — the mapping is sound. **Residual:** T-C9 certifies an `'unauthorized'` classification the page never branches on (§C-D10 renders only `forbidden ? <AccessDenied/> : <ErrorMsg/>`) — non-blocking **NB-C5**. | **PASS** |
| **R-C2** | Resolve the NULL-actor contradiction (`actor=null` ⇒ `IS NULL`; `actor=` ⇒ absent); T-C4's impossible assertion replaced by a real one | §C3.2 (L966-978), §C3.3, §C3.5 (L1023-1057), §C4 (T-C4 L1175), §C5 (CR5), §C6 (FU-C2) | The three-state rule is stated once, unambiguously, with the collision note and the follow-up pointer. The SQL implements it as the pair `$2 actor` / `$9 actor_is_null` with `($9::boolean IS TRUE OR ($2::text IS NULL OR actor = $2))` — I checked this shape: when `$9` is true the second disjunct is skipped, so a bound `null` `$2` cannot accidentally widen the filter. T-C4's impossible assertion is replaced by `?actor=null` → **2 rows**, both `actor === null`, which I confirmed is satisfiable against the fixture (rows 1 and 12). | **PASS** |
| **R-C3** | Poison sentinels unique to forbidden keys; add a positive control | §C4 (fixture L1143-1160, T-C6 L1177) | Three unique sentinels (`L3AK_PASSWORD_SENTINEL_9f2a`, `L3AK_TOKEN_SENTINEL_4c7d`, `L3AK_NESTED_SENTINEL_1e5b`) on the 14:00 row, and the positive control is real: `detail.name === 'b.txt'`, `detail.chunk_count === 1`, `detail.outcome === 'success'`. I reproduced the fixture and confirmed (probe `probe_r2_tc6.sql` P6/P7) that under `?resource=p3c-document:bbbb&limit=1` the surviving row **is** the 14:00 poison row, that all three sentinels **are** present in the stored `detail` (so the pre-fix route genuinely leaks them), and that the positive-control values are exactly `b.txt`/`1`/`success`. Test discriminates as claimed. | **PASS** |
| **R-C4** | Tie arithmetic corrected to **three** rows at `10:00:00Z`; T-C3 enumerates those three; apply CQ2 (`LIMIT+1`, no empty trailing page); `$6` timestamptz / `$7` uuid order | §C3.5 (L1021-1062), §C4 (fixture, T-C3 L1174), §0.2 | Exactly three rows carry `10:00:00Z`. `$6` is timestamptz and `$7` is uuid in **both** the declaration and the row comparison, and the `pool.query` array is written out in that order — the round-1 bug is fixed. `LIMIT $8 + 1` with `rows.pop()` is present. **However** the arithmetic in T-C3 does not reconcile (13 rows at `limit=2` under `LIMIT+1` takes **7** requests with a terminal page of **1** row — so "7 requests produce 13 rows" undercounts by one), and C3.3's own `next_cursor` sentence contradicts R-A3. See **RC-1** / **RC-3**. | **PASS on the mandate; new defects introduced** |
| **R-C5** | Split C-D5 into one decision; C uses its own picker, must not import `server/src/audit/*`, and must not modify it; the picker is a narrowing filter, not a substitute for B's sanitiser | §C-D5 (L909-935) | The "C imports `sanitizeDetail` read-only" paragraph and the "Clarification of D1" sentence are both gone; C-D5 is one decision, states both prohibitions, and states explicitly that the picker is not a substitute for B's sanitiser. `page-format.test.ts` (§F1 L1286) proves it without a DOM. | **PASS** |

**Tally: 16/16 R-items are textually applied; 15 are correct as applied, 1 (R-B1) is applied against a false premise.** That is the distinction that drives this round's verdicts.

---

### 2. Per-part suite-consistency re-audit

Round 1's core finding was that suites passed against the *current* code. Round 2 re-checks the opposite risk the revision introduced: **internal inconsistency** between a part's own sections, its fixtures, and its gate row.

#### F3-A — consistent

- **Test-ID closure:** the §F2 gate row names `T-A1..T-A14`; the §A4.2 matrix defines **all 14**, with exact expected values, and each names a discriminator. No dangling or extra IDs. `f3a-library.mjs` (A4.4) makes no AC1/AC9 claim; it is scoped to URL plumbing, and its 6 assertions match §A8's method exactly.
- **Fixture ↔ assertions:** `total === 5` (T-A2) is satisfiable only after A4.1.2 inserts 5 rows; T-A11's `{results: [], total: 0, …}` is only reachable *after* A4.1.5, and the plan puts it last with a `count === 0` pre-assert. T-A2's expected page names `['p3a-doc-big','p3a-doc-path']` match the pinned `created_at` values (13:00, 12:00). T-A12's `size_bytes === 15` matches the insert. T-A9/T-A4's tie order matches `id DESC`, which I re-probed.
- **Pre-fix gate:** T-A1 states the pre-fix body *has* `source_path` and *has no* `chunk_count`, both true of `library.ts:9-14` as it stands today, so the gate fails pre-fix as claimed.
- **Gate ↔ baseline:** §F2's A column requires `documents = 0` post-cleanup; the public DB is currently `0`, so the assertion is satisfiable.
- **Verdict:** internally consistent; no repair needed. Two cosmetic items only (NB-A1/A2).

#### F3-B — one substantive inconsistency (own AC5 untested) plus two documentation drifts

- **Test-ID closure:** §F2's B row names `sanitize.test.ts T-B1..T-B6, T-B19` and `audit-write.test.ts T-B7, T-B7b, T-B7c, T-B8..T-B15, T-B15b, T-B17`. The matrix defines exactly those, plus `T-B16` which the matrix itself marks **"REMOVED"** (correctly, per NQ1) and which §F2 does not list. **No dangling IDs.**
- **Missing mandated test (R-B1):** round 1 §7 L348 required a unit test for B's **own** AC5. None exists — `requireAdmin`'s only test is T-C10 in **C**, so B's gate cannot prove its own AC5. *(Its original purpose is void because B now declares AC5 "unreachable today" — see RB-1/RB-2 — but the omission is still an omission.)*
- **Dropped round-1 ask (NQ/AC2):** round 1 §7 L345 asked for `assert(!AUDIT_ACTIONS.includes('auth.logout'))`, referred to as T-B21. **No such assertion exists anywhere in the plan** — `auth.logout`'s absence rests on a code comment (L595) and a **manual** browser step 11 (C L1222). Automated taxonomy closure is lost. *(NB-B1.)*
- **Fixture arithmetic re-verified:** `chunkCount === 1` for the stated 60-word fixture (real chunker, real options); the `p3b-empty` zero-chunk probe holds; `PRE_COUNT` is reconstructible from `count(*)` + a `RETURNING`-derived id set. The stated "≥ 40 words" rationale is wrong though the number is right (NB-B2).
- **Static AC9 count:** T-B15b's "exactly 5" matches the 5 call sites in §B3.4 (verified by reading §B3.4).
- **Pre-fix gate:** T-B7/T-B7b/T-B7c revert one file each; against today's tree **all three fail** (no `recordAudit` exists at all), so B's gate is non-vacuous.
- **Verdict:** the suites do not, however, test the one thing most likely to be silently wrong — **the actor identity actually written** — which is RB-1.

#### F3-C — three internal contradictions introduced by the revision

- **Test-ID closure:** §F2's C row names `audit-read.test.ts T-C1..T-C13` and `page-format.test.ts F1..F8`. **All 13 C tests are defined** with exact expectations. **But `page-format.test.ts F1..F8` is not defined anywhere in the plan** — `page-format.test.ts` gets one prose sentence (§C4 L1184-ish) listing assertions with no IDs, and `F1`–`F8` collide with nothing but also resolve to nothing. The Implementer cannot tell which 8 assertions are gated. *(RC-4; blocking-lite — I treat it as a required fix below because a gate that names undefined tests cannot be green.)*
- **RC-1 — the `next_cursor` rule contradicts R-A3 and §C3.5.** §C3.3 states "`next_cursor` — string iff `rows.length === limit`, else `null`". §C3.5 implements `LIMIT $8 + 1`, pops the probe row, and sets `hasMore = rows.length > lim` **before** the pop. Under the C3.3 sentence the cursor is emitted on any *full* page even when no further row exists — precisely the "empty trailing page" that R-A3/R-C4 and CQ2 were ruled to eliminate. Two mutually exclusive rules sit in the same section-pair, and the Implementer will follow the prose (it is the "contract"). **This is a regression of R-A3's mirror in C.**
- **RC-2 — the display allow-list dropped `attempted`.** B's BQ1 ruling adds `attempted` to the server-side `detail` allow-list explicitly "so the **C UI** can render it read-only". C's own `DISPLAY_DETAIL_KEYS` (§C3.8 L910-914) and §C3.3's `detail` description (L1002) both **omit** `attempted`. T-C4's fixture rows carry `detail.attempted` (`p3c-invalid`, `p3c-user`, `p3c-other`), but C's picker will silently drop it, so the write-side feature lands with no reader. T-C6 does not assert `attempted` either way, so **the suite cannot catch this.** *(Related observation: this is the *only* consumer of `attempted`, which also makes the NB-B3 concern about failed-login usernames moot — see §4.)*
- **RC-3 — T-C3's arithmetic and terminal page.** With `LIMIT $8 + 1`, 13 rows at `limit=2` yields requests returning 2,2,2,2,2,2,**1** = **7 requests / 13 rows**, or 6 requests / 12 rows if the test stops when `next_cursor === null` is first observed. The row asserts "exactly **7** requests produce **13** rows" *and* "the final response has `rows.length === 1`" — which requires an 8th request. I verified the bound (`ceil(13/2) = 7`, `floor = 6`; probe P3) and the terminal-page arithmetic. As written the assertion cannot be satisfied by any implementation: it is either 7 requests **or** a 1-row terminal page as the *last* request, not both. This is exactly the R-C4 defect class (tie/tier arithmetic), reintroduced one level up.
- **Fixture ↔ assertions otherwise sound:** I re-derived T-C2 (`?limit=2` → 14:00, 13:00), T-C4 (`search.query` = 3 rows; `ingest.upload.success&actor=admin` = 2; `actor=p3c-user` = 3; `actor=null` = 2), T-C5 (10:30–12:30 → exactly 2 rows @11:00/@12:00; exact bound 11:00 = 1 row — probe P4/P5 both confirmed **inclusive**), T-C6 (above), T-C12 (empty-table envelope `{rows:[],limit:50,next_cursor:null}`, three keys). All satisfiable.
- **No `fromTs`/`toTs` bridge:** see **RC-5** in §3 — the URL names are `from`/`to`, the bind-array names are `fromTs`/`toTs`, and the plan never states the route's parameter-read step.
- **Pre-fix gate:** T-C1's seven enumerated discriminators are all true of `audit.ts:9-14` today (no `id` in `SELECT`, no `limit` echo, no `next_cursor`, filters ignored, `?from=hello` → 200), so C's gate is genuinely non-vacuous — the round-1 finding is cured.
- **Verdict:** non-vacuity is cured; consistency is not.

---

### 3. Required revisions — round 2

Only **blocking** items are numbered. Everything else is in §4. I am deliberately keeping this list short: these are the last gate, and each item is a specific, checkable edit.

#### F3-B (1 required)

**RC-B/1 — Declare the JWT identity contract and test it (corrects R-B1).**
`auth.ts:27` signs `{ sub: row.id, username }`; `authMiddleware:17-18` casts the payload to `{ id, username }` and assigns it to `req.user`. Therefore at runtime **`req.user.username` exists and `req.user.id` does not** — `req.user.id` is `undefined`, and the cast is a silent lie that TypeScript cannot catch. B's design (L528-529) justifies reading `req.user?.username` by "`req.user` already exists and is typed (`AuthRequest`)" — the *username* half is true, the typing claim is not. Consequences that must be closed:
1. §B-D2/§B3.1 must state the **only** two fields B reads are `req.user.username` (and `req.user` presence), and must state explicitly that `req.user.id` is **not** available in this phase (it is `undefined`; a future `role` design must not assume it). If B or C wants the id, the correct source is `jwt.decode(token).sub`, and that must be said — not inferred.
2. `requireAdmin` must be specified with **one** status code. Round 1 specified **`401`** ("it enforces `401`, not `403`") because a missing principal is an authentication failure, and C's 403 branch was to stay documented-unreachable; the plan chose **`403`** and recorded CQ1 as satisfied by it. Either is defensible, but it must be **decided in one place and propagated** to: §C3.7 body, §C3.4's error table (`403` row), T-C10's assertion, CR3/CR6, and CQ1's "satisfied" note. Right now they agree on 403 while the round-1 mandate said 401 — pick one and say which mandate it supersedes.
3. **Add B's own AC5 unit test** (round-1 §7 L348): call `requireAdmin` with `req.user` absent **and** with `req.user = { username: 'admin' }` (no `id`!), asserting rejection / `next()` respectively. The no-`id` case is the regression guard for the mismatch above.
4. T-B8/T-B9/T-B10 must assert **where the actor value came from** — i.e. that the row's `actor` equals the username present in the login response's `user.username` **and** in `jwt.decode(token).username`, not merely "is a non-empty string". Today no test would notice if a call site wrote `req.user.id` (→ `null` via `?? null`, silently degrading every authenticated event to a NULL actor).

#### F3-C (4 required)

**RC-C/1 — Fix the `next_cursor` rule so C agrees with R-A3.** Replace §C3.3's "string iff `rows.length === limit`" with the R-A3 rule as written in §C3.5: string **iff a probe row was fetched and popped** (`hasMore`), else `null`; and state that a full final page returns `null`. Then make T-C2/T-C3/T-C12 assert that rule (T-C12's `next_cursor: null` on an empty page already agrees; T-C2's full 2-of-13 page must yield a string, which it does under the corrected rule).

**RC-C/2 — Put `attempted` back into C's read contract.** Add `attempted` to `DISPLAY_DETAIL_KEYS` (§C3.8) and to §C3.3's `detail` key list, and assert it in T-C6 or T-C4 (e.g. `?action=auth.login.failure&actor=null` rows carry `detail.attempted ∈ {'p3c-invalid','p3c-other'}` after the picker). Without this, BQ1's write-side feature has no reader and the suite cannot detect the loss.

**RC-C/3 — Make T-C3's arithmetic satisfiable.** Restate as: "paging `?limit=2` until `next_cursor === null` yields **7** responses — six of 2 rows and a final one of **1** row (13 rows total)"; and keep the union/no-duplicate assertion. Fix the "7 requests produce 13 rows" phrasing and drop the contradictory "final response has `rows.length === 1`" pairing with a request count that cannot produce it.

**RC-C/4 — Define the `page-format.test.ts` IDs.** §F2's C row gates on `F1..F8`, but no section defines them. Give the eight assertions explicit IDs and expected values in §C4 (mirroring T-C9/T-C13's exactness), or change §F2 to name them by assertion rather than by undefined IDs.

**RC-C/5 — Bridge the `from`/`to` ↔ `fromTs`/`toTs` names.** §C3.2 validates URL params named `from`/`to`; §C3.5's bind array passes `fromTs`/`toTs` as `$4`/`$5`; `web/src/lib/api.ts`'s `AuditQuery` declares `from?: string; to?: string` and the generic `Object.entries` loop sends them as `?from=`/`?to=`. Nothing states the route's parse step that produces `fromTs`/`toTs`. Add the parameter-read paragraph to §C3 (the exact `req.query` reads, the `''` → `null` conversion already implied by §C3.5's absence-marker rule, and the naming used in the bind array). This is the one place where a mechanical transcription of the plan produces a route that silently ignores both bounds — and T-C5 would then fail on a correct-looking implementation, which is the most expensive kind of defect to debug.

#### Not required, but binding on the Implementer (carry-forward, no plan edit needed)

- **`search.query`'s `resource` has no 200-char cap and its own §B3.2 rule claims every resource is capped.** Either pass it through `sanitizeResource` too (one token, closes the inconsistency) or add one sentence to §B-D6 saying why the closed set makes it unnecessary. Non-blocking (**NB-B4**) because the value is closed-set today.

---

### 4. Cross-part `actor` filter agreement check

**Verdict: the three parts agree — with one documentation gap and one dependency that must be stated.**

| Aspect | A | B (write side) | C (read side) | Agree? |
|---|---|---|---|---|
| Who supplies `actor` | n/a (library has no audit) | `auth.login.success` → username; `ingest.*`/`search.query` → `req.user?.username ?? null` (L709/721/733); `auth.login.failure` → **`null`** (B-D7) | C never writes `actor`; it filters and renders it | **YES** |
| Are authenticated events non-NULL? | n/a | yes, **provided `req.user.username` is the source** — which it is (matches how the JWT is signed). The `req.user.id` trap is RB-1 and is about a *different* field | C renders `null` as `—` (§C3.3, C-D8-adjacent) | **YES, but see RB-1(4)** |
| Are failed logins NULL? | n/a | yes, SQL `NULL`, asserted on the DB row not just JSON (T-B9) | `?actor=null` ⇒ `WHERE actor IS NULL` (R-C2), T-C4 asserts 2 such rows | **YES** |
| Is the attempted identity recoverable? | n/a | via `resource` (`admin:<cand>`, 64-cap) **and** `detail.attempted` (BQ1) | `resource` rendered; **`attempted` dropped by C's picker** (RC-2) | **partial — RC-2** |
| Filter semantics | n/a | n/a | exact match only, never `ILIKE` (§C-D3, probe P15: escaped pattern 1 row vs unescaped 3) | **YES** |
| Encoded/falsey edge cases | n/a | `sanitizeActor('null') === 'null'`, so the literal `actor=null` cannot be produced by sanitising a real username — collision documented (§C3.2) and deferred to FU-C2; `admins` holds 1 row, `admin` (verified: `admins = 1`) | `actor=` (empty) ⇒ absent, same rule `api.audit.list` applies to every empty param | **YES** |
| Sanitisation agreement | n/a | `sanitizeActor`: strip controls, `trim`, cap 64, **no lowercase** — because `admins.username = $1` is case-sensitive (`auth.ts:18`) | filter value is `sanitizeActor`d with the same helper before binding `$2` | **YES** |
| Actor↔`attempted` consistency | n/a | **not explicitly stated together** | T-C4 tests `actor=null` and `detail.attempted` in different sub-assertions | **gap** — see below |

**The one gap.** Nothing in B or C states the *relationship* "`actor` is NULL **iff** `detail.attempted` is present", and no test pins the pair together on the same row. T-B9 asserts the pair on the **write** side and T-C4 exercises both notions on the **read** side, but a future change that set `actor = attempted` (round 1's rejected alternative, B-D7) would still pass **every** existing assertion in T-B9 unless `actor === null` is re-asserted — it is, so the write side is guarded — while the **C4 fixture** would go stale silently. **Not blocking** (the write-side test is the authoritative guard), but the Implementer should add one sentence to §C4 stating that fixture rows 1/12/9 are shaped by B-D7 and must be re-derived if B-D7 changes. Recorded as **NB-X1**.

**Cross-part `resource` agreement (adjacent, checked while here):** B emits `admin:<cand>`, `document:<uuid>`, `document:sha256:<hex>`, `upload:<name>`, `search:<policy>`; C filters `resource` by **exact match** and renders it as text. No party assumes a prefix it does not receive. `sanitizeResource`'s no-rewrite rule (verified: prefixes survive because `:` is not a control character) means C's exact-match filter remains usable. **AGREE.**

---

### 5. File-touch matrix check

**Verdict: the matrix is accurate as to *which* files change, and accurate as to *absence* — but it understates two cross-part relationships.**

**Existence check (this round, on disk).** Every file §F1 calls **new** is currently **absent** (`server/src/audit/{events,sanitize,log}.ts`, `server/src/middleware/require-admin.ts`, `server/src/__p3{a,b,c}__/*`, `web/scripts/f3{a,c}-*.mjs`, `web/src/app/dashboard/audit/format.ts`, `server/src/__p3c__/page-format.test.ts`); every file it calls **edit/rewrite** **exists**; the three it strikes (`db/schema.ts` as *not touched*, `__p3a__/seed.sql`, `__p3c__/seed.sql`) are correctly **absent**. The abandoned `audit-fail-http.test.ts` (round 1's suggestion) is not in the matrix and does not exist — correct, since R-B2 replaced it with the static count.

| Check | Result |
|---|---|
| **D1** no A↔B shared file | **Holds.** A touches `routes/library.ts`, `api.ts` (library block), `library/page.tsx`, its test + harness; B touches `audit/*`, `middleware/require-admin.ts`, `routes/{auth,ingest,search}.ts`, its tests. Disjoint. |
| **D2** only `api.ts` shared, A then C | **Holds in the matrix** (A L1268/C L1268, different blocks). The blocks are written out in §A8 and §C3.6 and do not overlap textually. |
| **D3** B must not touch `routes/audit.ts` | **Holds.** §F1 row reads "not touched (D3)" for B; C owns the rewrite. |
| **D4** `api.search`/`chat` untouched by A | **Holds.** §F1 last row; T-A13 greps `api.search` out of the library page. |
| **D5** A must not mention audit tokens | **Holds.** A's sections reference no `audit_log`/`api.audit`/`AuditEvent`; §F1's A column has no audit file. |
| **D6** B must not import from `web/` | **Holds.** §B4.2 says the sanitiser test "imports **only** `audit/sanitize.ts`" — and that file is pure (no db/express/config imports), so the claim is implementable. |
| **Cross-part — `app.ts`** | **UNDERSTATED.** §F1 lists `server/src/app.ts` as **C-only** ("edit: mount `requireAdmin`"). But B **creates** `middleware/require-admin.ts` and §B-D10 says B defines it *and* C mounts it. If the Implementer follows §F1 literally, B leaves a new module with **no importer and no test of its own** (T-C10 is C's), and C's diff then adds both the import and the mount. This is workable but it is **not** what "no file is touched by two parts" implies, and it is why B's AC5 has no test (RB-1(3)). §F1 should say: *`app.ts` is C-only **because B does not mount**; `require-admin.ts` is authored by B but first imported by C.* **Non-blocking once RB-1(3) adds B's own unit test.** |
| **Cross-part — `web/scripts/f3a-library.mjs` vs B** | **UNDERSTATED.** A's harness loads the real `api.ts` in Node with a fake `localStorage`/`fetch` (A4.4). B claims no web change and D6 forbids B importing from `web/`. B's gate has no harness, so this is latent — but if any B-side evidence is ever gathered through `api.ts`, the harness becomes a shared boundary. **Non-blocking; noted for the record.** |
| **Baseline guard** | **Holds.** 40 entries, 0 failures (re-verified at the end of this review). `db/schema.ts` is in the baseline and is struck from every part's touch list (NQ1) — so a schema edit would fail the baseline gate. `ingest/service.ts` mutation-guarded for B and C. |
| **Cosmetic** | §F1 states the same claim twice in slightly different words (L1295 "No product file is touched by two parts except…", L1298 "Zero files are touched by two parts except…"). Harmless, but delete one — see **NB-F1**. |

---

### 6. Remaining findings

**Blocking:** the five in §3 (`RC-B/1`; `RC-C/1`…`RC-C/5`). No scope violation, no data-safety violation, no baseline violation was found in any part.

**Non-blocking (record, do not gate on these):**

- **NB-A1** §A3.5's `GROUP BY d.id, …` justification says "`id` alone is not sufficient under PG's functional-dependency rule when `d.id` is the PK of a *joined* table". In fact PostgreSQL **does** accept `GROUP BY d.id` with `SELECT d.name` when `d.id` is `documents`' PRIMARY KEY — functional dependency is recognised for the base table even under `LEFT JOIN`. Listing the columns is harmless and portable, but the stated reason is not correct. Round 2 did not re-probe this (it changes no expected value); flagging so the justification is not cited as fact. *(Round 1 accepted the SQL itself.)*
- **NB-A2** A's browser steps 11 and 12 both require **state changes that A's own suite forbids** at the time they run: step 11 needs `localStorage` cleared (fine, client-side), but step 12 needs "the DB emptied" **while** the page displays `p3a-*` rows in steps 3-6 and DevTools shows a 200 in step 7. Sequence it: run 1-11 with the fixture present, empty the table, run 12, restore. As written a tester cannot execute both halves in one pass without inventing a restore.
- **NB-B1** The `assert(!AUDIT_ACTIONS.includes('auth.logout'))` assertion round 1 asked for (referred to as T-B21) **does not exist**. `auth.logout`'s absence now rests on a code comment (L595) plus C's **manual** browser step 11. Add the one-line assertion to `sanitize.test.ts` or `events.ts`-level unit — it is cheaper than the manual step it is standing in for.
- **NB-B2** §B4.1 attributes `chunkCount === 1` to "**≥ 40 words**". The real mechanism is `words: 300` with a `minWords: 20` floor (`service.ts:173-178`, `chunker.ts:39-45`): **39** words already yields 1 chunk, **601** yields 3, and **whitespace-only yields 0** (verified by running the real chunker). The assertion is safe (60 words → exactly 1), the rationale is wrong and would mislead a future fixture author — a 400-word fixture intended as "still 1 chunk" would in fact produce 2.
- **NB-B3** *(moot after RC-C/2, kept for the record)* BQ1 puts the attempted username in the read-visible `detail.attempted` while B-D7 argues at length that the attempted username must **not** be attributable because it is unbounded attacker-controlled text. B-D7's mitigations (sanitised, 64-capped, rendered read-only, never in `actor`) make this acceptably different from "storing it in the column the UI renders as *who did this*". However `sanitizeDetail`'s rule 4 caps strings at 200 while `sanitizeActor` caps at 64 — the plan states `attempted` is "sanitised by `sanitizeActor` before it is put in `detail`", so the 64-cap must be enforced **at the call site**, not assumed from the detail sanitiser. Worth one sentence in §B3.4.
- **NB-B4** See §3 carry-forward: `search.query`'s `resource` is the only emitted resource not passed through `sanitizeResource`; §B3.2's "every resource built from an attacker-controlled string" is satisfied only by the closed-set argument.
- **NB-B5** B's `recordAudit` failure log line carries `err` unredacted (`logger.warn('[audit] write failed', { action, resource, err })`). A pg error object can contain the **failed SQL and its parameters** — and one parameter is `JSON.stringify(detail)`, which is post-sanitisation (good) but the other parameters include `actor`/`resource`. §F4 forbids secrets in logs; that is satisfied, but a DB error message could still echo unbounded attacker text into the log. Log `err.message`-truncated rather than the whole object. *(Round 1 did not catch this; it is minor.)*
- **NB-C1** §C3.3's `detail` description says "Never `null`", while the route reads real rows where `detail` is `jsonb NOT NULL DEFAULT '{}'` — so "never null" is guaranteed by the schema, fine. But C's mapper should still guard, because **B is not the only writer** (manual inserts, restored dumps — §C-D5 says exactly this). Add `?? {}` in the mapper or state that `pickDisplayDetail` is total for `null` (it is, per rule "non-object → `{}`"). One clause.
- **NB-C2** §C3.8's `formatTs` uses `Intl.DateTimeFormat('en-GB', …)` and T-C8/T-C13 pin a TZ-dependent string. The server TZ here is `Asia/Bangkok` (UTC+7, verified in round 1 and re-observed in this round's probes: `2026-11-02T10:00:00Z` renders `17:00:00+07`). Passing `timeZone` explicitly in the test (as C-D9 says) is correct; make sure the **page** passes it too or the golden string will differ between machines. Not a plan defect — a transcription trap.
- **NB-C3** §C4's fixture inserts `created_at = '2026-11-02T10:00:00Z'` and asserts "rows appear in `id DESC` order" via `IDS.slice(0,3).sort().reverse()`. `IDS` is *insertion* order, and insertion order is **not** `id` order (ids are `gen_random_uuid()`). The comparison happens to be valid because the assertion sorts before reversing — but this depends on `sort()` defaulting to lexicographic comparison of uuid **strings**, which is the same order PostgreSQL uses for `uuid DESC` **only because both are byte-order on the same textual representation**. True today; state it, because a future switch to `uuid[]` comparison or a different id generation would silently invert it.
- **NB-C4** §C4's T-C12 "temporarily emptied table" deletes **its own** `IDS` first and then requires `count(*) === 0`, skipping with **exit 2 = BLOCKED** otherwise. Good design. Note it means C's suite is BLOCKED (not PASS) whenever any other audit row exists — including rows written by B's own real-HTTP tests if they ran in the same window. State that C's suite must run with no concurrent audit writers.
- **NB-C5** T-C9 certifies `describeError`'s `'unauthorized'` branch, but §C-D10's render rule is `describeError(err) === 'forbidden' ? <AccessDenied/> : <ErrorMsg/>` — the `'unauthorized'` value is never used by the page. Either branch on it (distinct copy) or drop it from the tested contract. Harmless, but it is a tested behaviour with no consumer, which is the same shape as the C16/T-C16 vacuity round 1 flagged.
- **NB-F1** §F1 states its "nothing shared" claim **twice** (L1295, L1298) in slightly different wording. Delete one; docs that disagree with themselves at 3-line distance invite a reader to trust the wrong copy.
- **NB-X1** See §4: add one sentence to §C4 that fixture rows 1/9/12 are shaped by B-D7's NULL-actor rule.

**Round-1 non-blocking items — status:** NB-1…NB-7 were re-dispatched into the revision log (`R-A1`, `NQ2`, `R-B2`, `§0.2`, `FU-A7`, `FU-B9`, `§F3`) and I verified each landed at the cited section. NB-3 (`probe_audit_readonly.sql` P5 marked intentionally-unexecuted) is correctly recorded in §0.2 and the file itself carries a `\echo` note — **still unexecuted, still correctly labelled**, no change needed.

---

### 7. Evidence — what this round actually ran

**Reads (full):** `server/src/routes/{library,audit,auth,search,ingest}.ts`, `server/src/app.ts` (L24-46 + mounts), `server/src/middleware/auth.ts`, `server/src/db/{index,schema}.ts`, `server/src/ingest/{service,chunker}.ts` (pipeline + chunk options), `server/src/utils/logger.ts`, `web/src/lib/api.ts` (L40-75), `web/src/app/dashboard/{layout,library/page,audit/page}.tsx`.

**Commands run (all read-only; no server started, no install, no product-file mutation):**

1. `sha256sum -c .pipeline/p3/baseline.sha256` → **40 OK, 0 failures** (run at the start and again at the end of this review).
2. `select current_database(), count(documents), count(chunks), count(audit_log), count(admins)` → `knowledge_app | 0 | 0 | 0 | 1` **before and after** every probe.
3. `probe/probe_r2_verify.sql` (new, temp table, `ROLLBACK`): P1 `::int` preserves value → `pg_typeof = integer`; P2 tie-break `ORDER BY created_at DESC, id DESC`; **P4 `2147483648::bigint::int` → `ERROR: integer out of range`**.
4. `probe/probe_r2_verify3.sql` (new, temp table, `ROLLBACK`): 3 rows at `10:00:00Z` + 1 at `09:00`, `LIMIT 2+1`, cursor from the last surviving row → page 2 returns the remaining tie row then the 09:00 row; **union 4 rows / 4 distinct / 0 duplicates**. Reproduces the gap-free keyset claim with `LIMIT+1`.
5. `probe/probe_r2_c4_fixture.sql` (new, temp table, `ROLLBACK`): rebuilt C's 13-row fixture; **`ceil(13/2) = 7`, `floor = 6`** (T-C3 arithmetic, RC-C/3); T-C5 window `10:30-12:30` → exactly **2** rows; exact bound `11:00 = 11:00` → **1** row (inclusive verified).
6. `probe/probe_r2_tc6.sql` (new, temp table, `ROLLBACK`): under `?resource=p3c-document:bbbb&limit=1` the surviving row is the **14:00** poison row with `name='b.txt'`, `chunk_count=1`, `outcome='success'`; all **three** sentinels **are** present in the stored `detail`, so the pre-fix leak is real and T-C6 discriminates. `resource=p3c-document:bbbb` matches **2** rows, so `limit=1` correctly has `hasMore=true`.
7. `probe/verify_r2_chunkcount.mjs` (new): ran the **real** `createChunker({words:300, overlapWords:50, minWords:20})` — 60-word fixture → **1 chunk**; 39/40/41/300 words → 1; 601 → 3; whitespace-only → **0**. Confirms B4.1's `chunkCount === 1` and the zero-chunk probe; disproves the stated "≥ 40 words" mechanism (NB-B2). *(Correction to an intermediate claim of mine: I noted in draft that its `const chunks` binding collides with lib.dom's `AudioData.copyTo` params. It does not — the local binding is unshadowed by lib.dom member names and the probe runs under `tsx` as shown. No defect; recorded so the claim is not cited.)*
8. `node` length computation against §B-D6: `document:<uuid>` = **45**, `document:sha256:<64hex>` = **80**, `admin:<64-cand>` = **70**, `upload:<64-name>` = **71** — all under the 200 cap, so R-B3's cap rationale is arithmetically correct.
9. Test-ID closure pass over §A4.2 / §B4.2 / §C4 against §F2's gate row: **T-A1..T-A14 all defined; T-B set defined matches §F2 exactly (T-B16 defined as REMOVED and correctly omitted from the gate); T-C1..T-C13 all defined; `page-format.test.ts F1..F8` NOT defined anywhere** (RC-C/4). Verified no occurrence of `T-B18`, `T-B20`, `T-B21` exists in the plan — so the round-1-requested logout assertion is genuinely **absent**, not renamed.
10. `grep` for `fromTs|toTs` and `req.query` across the plan: `fromTs`/`toTs` occur **only** in §C3.5's bind array (L1051-1052); `req.query` occurs **nowhere** — RC-C/5 confirmed.
11. Existence sweep of all 26 §F1 paths on disk: every "new" path absent, every "edit/rewrite" path present, all three struck paths absent — §F1's matrix is factually accurate.

**Probe hygiene:** the four SQL probes in items 3-6 are new files under `.pipeline/p3/probe/` and, like round 1's probes, are **not** in `baseline.sha256` and must not be added (the baseline guards product files only). Each opens `BEGIN`, touches only `CREATE TEMP TABLE`, and ends `ROLLBACK`; items 3-6 each re-checked the four product-table counts immediately afterwards (`0/0/0/1`). One earlier iteration (`probe_r2_verify.sql` v1) failed its `BEGIN READ ONLY` on `CREATE TEMP TABLE` and was corrected before use; the failed attempt wrote nothing.

**What I did *not* re-probe (and am not claiming):** I did not start the server, so no HTTP status, no rendered page and no pre-fix 400/200 is observed here — those remain `[U]` and are the Implementer's gate to prove. I did not re-run round 1's `probe_audit_cursor2.sql`; its P13/P14 conclusion is unchanged and still the load-bearing keyset evidence. I did not verify NB-A1's functional-dependency claim against this PostgreSQL instance.

NO SOURCE FILE MODIFIED · NO INSTALL · NO SERVER STARTED · NO DB WRITE · baseline re-verified 40/40 OK.

DONE:PLAN_REVIEWER_P3_R2

---

## ROUND 4 REVIEW — F3-B / F3-C

F3-B: REVISE
F3-C: REVISE

PROJECT ROOT: `D:\Develop\knowledge-app`
PHASE ID: `phase3-library-audit`
ROLE: INDEPENDENT PLAN REVIEWER — plan verdict only. **No source file modified, nothing installed, no DB write, no server started.** The only file I created is this review; one `sha256sum -c` (read-only) was run.
INPUTS READ IN FULL for this round: `.pipeline/p3/PLAN.md` (revision 3, 1676 lines, `DONE:PLANNER_P3_BC`), `.pipeline/p3/B-C-CLOSURE.md`, `.pipeline/p3/REQUEST.md` §F3-B/§F3-C, `.pipeline/p3/RESULT.md`, and `REVIEW.md` rounds 1-2 (this file, lines 1-615).
CODE RE-READ THIS ROUND (to confirm the plan's `[V]` claims still hold): `server/src/routes/{audit,auth}.ts`, `server/src/middleware/auth.ts`, `server/src/app.ts`, `web/src/lib/api.ts`, `web/src/app/dashboard/audit/page.tsx`, plus `ls server/src/middleware server/src/audit`.
DATE: 2026-11-02

**What this round is, and is not.** Round 3 of the plan was a *surgical rewrite of F3-B and F3-C only*, applying `B-C-CLOSURE.md` C-1…C-6 plus the round-2 required revisions and adding the two AC gate tables. It did not change F3-A (re-confirmed: §F1 has no F3-A row outside the three already-authorised files). This round therefore judges exactly two things: **(1) did F3-B and F3-C close the round-2 blockers, and (2) is what remains executable as written?** It is not a re-litigation of F3-A, and it is not a review of code — none of B or C exists yet (`server/src/audit/`, `server/src/middleware/require-admin.ts` do not exist; `routes/audit.ts` is still the 21-line reader).

**Headline.** Both parts pass the **vacuity** bar that killed C in round 1 and passes **closure** on 14 of the 15 items below. Both fail on one shared class: **the plan states a binding rule and then writes a call site, a test fixture, or a gate row that violates it.** In each case the plan's own test suite would go green over the violation — which is the phase's core failure mode wearing a different coat. One defect (R4-B/1) additionally breaks **AC3 of F3-B as literally written**, and one (R4-C/1) makes the single assertion that separates the two `next_cursor` rules (`T-C3b`) unreachable. Neither is fatal to the design; both are one-paragraph edits. Hence **REVISE, not BLOCK**: no structural rework, no new files, no new questions.

---

## R4.1 — THE 15-ITEM CLOSURE VERIFICATION TABLE

Each row: the item as carried into this round → **what the plan now says** (quoted/paraphrased, with the line in `PLAN.md`) → **my check** (what I actually did: read line X, ran grep Y, compared with file Z) → **verdict**.

| # | Item (round-2 / closure source) | What the plan now says | My check | Verdict |
|---|---|---|---|---|
| **1** | **RC-B/1.1** — declare the JWT identity contract: the only two fields B reads are `req.user.username` and `req.user` presence; `req.user.id` is a phantom and MUST NOT be referenced (`B-C-CLOSURE.md` C-1) | New **§B-D10a** (L601-603) states `auth.ts:27` signs `{sub: row.id, username}`, `middleware/auth.ts:19-20` casts to `{id, username}`, so `req.user.id === undefined` at runtime; the authoritative id is `req.user.sub`. §B3.1's restatement (L658-660): *"`actor` for every authenticated event is `req.user?.username`; the id is `req.user?.sub`. **`req.user.id` MUST NOT be referenced anywhere in B**"*. §B3.2's call-site block carries the same rule above it (L723 region) and every actor cell reads `req.user?.username ?? null` (L711, L726, L757, L772). | Read L601-603, L656-660, L705-780 against `server/src/routes/auth.ts:27` (`jwt.sign({ sub: row.id, username }, …)`) and `server/src/middleware/auth.ts:15-20` (`req.user = payload` typed as `AuthRequest['user']`). Both quotations of the source are exact. `grep -rn "req\.user\.id" server/src` ⇒ **0 today**, so the rule is a forward constraint, not a repair. L886 even gives the grep (`req\.user\.id\|req\.user?.id\|req\.user\[` ⇒ 0) inside T-B7's block. | **CLOSED** |
| **2** | **RC-B/1.2** — `requireAdmin` must have **one** status code, decided once, propagated to §C3.7, §C3.4's error table, T-C10, CR3/CR6, CQ1, and must say which round-1 mandate it supersedes | **§B-D10b** (L607): round 1's `401` is explicitly **superseded** by `403 {"error":"Forbidden"}`, "decided here and propagated verbatim to §B3.6 (the body), §B4.3 `T-B23`, §C3.4's error table, §C3.7, `T-C9`, `T-C10`, §C5 CR3/CR6 and §C7 CQ1. **No other status code appears anywhere in the plan for this branch.**" §B3.6 body (L789-796) is `if (!req.user) { res.status(403).json({ error: 'Forbidden' }); return; } next();`. | Read every cited site. `grep -n "403\|401" PLAN.md` and read each hit in B/C context: L789/792 (body), L871-region T-B23 (`status` called once with `403`), L1248 (§C3.7 obligations), L1397 (T-C10), L1396 (T-C9 via `describeError(new Error('Forbidden'))`), C-GATE AC6 row, C5 CR3/CR6, C7 CQ1 (L1517). All say `403`; the only `401` occurrences in B/C are `authMiddleware`'s and `T-C10`'s no-token assertions, which are correct. The body's **seam-only** semantics ("This seam exists so a future role column has one place to be enforced") is honest: on today's mount no authenticated principal can be refused, and §C-GATE M-14 marks the branch optional accordingly. | **CLOSED** |
| **3** | **RC-B/1.3** — add B's own AC5 unit test: `requireAdmin` with **no** `req.user` (reject) **and** with `req.user = { username:'admin' }` with **no `id` key** (accept) | **T-B23** (L872): *(a)* `req.user === undefined` ⇒ `status` once with `403`, `json` deep-equals `{error:'Forbidden'}`, `next` **not** called; *(b)* `req.user = { username:'admin' }` ⇒ `next` called exactly once. Gated in **B's** own row (`§F2` L1569) and named in §B-GATE AC5. | Read L872 and L1569; confirmed AC5 in §B-GATE (L921) names T-B23 and *not* T-C10 as B's proof. Checked the two halves are not redundant: (b) is the regression guard for item 1 (a body written against `req.user.id` would 403 a real admin), (a) is the guard for the branch existing at all. | **CLOSED** |
| **4** | **RC-B/1.4** — T-B8/T-B9/T-B10 must assert **where** the actor value came from, not merely "non-empty string"; today nothing would notice `req.user.id` → `null` degradation | **T-B22** (L871) mints a real token via `POST /api/auth/login`, uploads with the bearer, reads the `ingest.upload.success` row back, and asserts **all three** of `row.actor === 'admin'`, `=== jwt.decode(token).username`, `=== loginBody.user.username`, **plus** `jwt.decode(token).id === undefined` and `jwt.decode(token).sub === loginBody.user.id`. It states its own discrimination: a `req.user.id` implementation yields `null`, so the first assertion fails. T-B8's frozen object pins `actor:'admin'` for `auth.login.success`; T-B9 pins `actor: null` for failures; T-B12 pins `actor:'admin'` for `search.query`. | Read L858-859, L871 and §B3.4's per-call-site actor cells. The triple-equality is the strongest available form (it ties the DB row to both the minted token and the login body, so neither a hardcoded `'admin'` nor a body echo can pass by coincidence). **Note:** `search.query` has no T-B22-equivalent row — a `req.user.id` bug written only at `search.ts:772` would be caught by no assertion. Non-blocking because T-B22 catches the *class* of bug at one real call site and `grep req\.user\.id ⇒ 0` (L886) covers the rest statically. | **CLOSED** *(one non-blocking coverage gap in §R4.6 NB-2)* |
| **5** | **NB-1 (round-2 vacuity audit, C16)** — the actor/attempted-username contradiction: `auth.login.failure` must not be both "actor is NULL" and "actor is the attempted username" | Reconciled the way AC3 requires: **B-D7** (L585-587) fixes `actor = null` because the attempted username is attacker-controlled and unbounded; the *sanitised* candidate is carried in `detail.attempted` (allow-listed per BQ1) **and** in `resource` (`admin:<sanitised>`, `sanitizeResource`-capped at 200, `sanitizeActor`-capped at 64, controls stripped). The trade-off is stated in one sentence with its reversal cost: *"A reviewer who prefers the other reading changes **one line** in `auth.ts` and one row in T-B9."* | Read L575-587, L711, L735, §B3.2 rule 2 (L667-668 adds `attempted` to the allow-list) and L954 (BQ1 row). This satisfies `REQUEST.md:41`'s literal offer ("use `null` + detail `reason`") **and** keeps the UI able to answer "who tried to log in as admin", which was the reason the contradiction mattered in round 2. It also removes C's item-6 contradiction: `?actor=null` now selects exactly the two NULL-actor rows and `?actor=` (empty) is explicitly "absent", so the two are distinguishable in the UI. | **CLOSED** |
| **6** | **NB-2 / R-B3** — the unbounded-string hole: two `resource` values are built from unauthenticated attacker strings (`req.body.username`, `file.originalname`); `sanitizeActor` alone capped neither | §B3.2 adds **`sanitizeResource(raw)`** (L683-690): non-string → `null`, strips the same C0/C1/`\u2028\u2029` set, trims, **caps at 200 without a marker**, no lowercase, shares `stripControls` with `sanitizeActor`. Rationale for 200 vs 64 is given from real lengths (`document:<uuid>` 45, `document:sha256:<64 hex>` 80). **T-B19** (L845) asserts controls gone (regex over the full control range), `length === 200`, **no `'…'`**, `null`/`{}`/`'   '` → `null`, and an 80-char identifier unchanged. §B3.4 applies it at both attacker-fed call sites (L736 `admin:${attempted}`, L760 `upload:${sanitizeActor(file.originalname)}`). | Read L683-690, L845, L736, L760. Cross-checked against `server/src/routes/ingest.ts:23-25,73,87` — `sanitizeExt()` only touches the *temp filename's* extension, so `originalname` really does reach the plan's call site unsanitised, as claimed. The deny-set/allow-list redundancy (rule 2 vs rule 7, L666-674) is genuinely belt-and-braces: deleting either rule leaves T-B3/T-B1 red. | **CLOSED** |
| **7** | **NB-3 / BQ2 / R-B2** — the AC9 fallback was a `CREATE TRIGGER` by a test: DDL on a `public` table, forbidden by the phase brief | **BQ2 rejected, and the trigger is gone from the plan, not merely discouraged:** §B3.3's B-SQL-2 (L701-706) is *"DELETED IN ROUND 1 (NQ1)… no `CREATE`"*; AC9 is now proven three ways and each is named: the in-process seam **T-B14 (a)(b)(c)** (L866: rejecting client ⇒ **resolves**; evil event ⇒ `doesNotThrow`; fake handler's `res.json` ran), the real-HTTP half **T-B10b/T-B11** (business status/body unchanged: `200` + `['results','errors']`, `207` + `errors.length === 1`), and the static structural check **T-B15b** (`grep 'void recordAudit('` ⇒ 5, `'await recordAudit('` ⇒ 0). §F4.1.1 (L1600) makes `CREATE`-anything a diff defect, and §F2 (L1576) gates "No `CREATE INDEX`/`FUNCTION`/`TRIGGER` in the diff" for all three parts. | Read L701-706, L866-869, L910-925 (§B-GATE AC9), L955 (BQ2), L1600, L1576. Confirmed there is **no** DDL anywhere in the plan: `grep -n "CREATE TRIGGER\|CREATE INDEX\|CREATE FUNCTION\|ALTER TABLE" PLAN.md` hits only prohibitions and the historical "DELETED/REMOVED" notes. The trigger's original job — proving the write cannot fail the request — is done better by T-B14, which tests the module contract instead of a DB side-effect. | **CLOSED** |
| **8** | **RC-C/1 / C-2** — the `next_cursor` rule contradicted R-A3: "string iff `rows.length === limit`" vs "string iff a probe row was fetched and popped" | §C3.3's bullet is replaced: `next_cursor` is a string **iff** `hasMore`, else `null`; a full final page returns `null`. §C3.5's code (L1187-1193) is `const hasMore = rows.length > lim; if (hasMore) rows.pop();`, with the paragraph **"Order matters"** added: `hasMore` captured **before** the pop, `next_cursor` built **after** the pop from `rows[rows.length - 1]`, and *"Reversing either step reintroduces the trailing empty page."* T-C2/T-C3/T-C12 restated to assert the rule; T-C3 became reachable (7 requests / 13 rows / terminal `rows.length === 1`, which I re-derived independently: 13 rows at `limit=2` = 7 pages, and only page 7 has `1 < 2`). | Read L1187-1198, L1386-1400 (T-C1…T-C3b). Re-derived the arithmetic for `T-C3`'s three-request `?limit=1&action=search.query` leg (3 rows ⇒ string, string, `null`) and for `?limit=13` ⇒ `null`. Both correct. **But see §R4.2-C: the fixture now has exactly 13 rows, so `T-C3b`'s headline leg (`?limit=13` on the whole table) no longer separates the two rules** → blocking finding **R4-C/1**, which is a fixture-arithmetic defect inside this otherwise-correct item. | **CLOSED as a rule; its discriminator is vacuous** (R4-C/1) |
| **9** | **RC-C/2 / C-3** — `attempted` was dropped by the display allow-list, so the security-interesting column vanished on the way to the browser | One literal key list is written out **three times and forced to agree**: server `SERVER_DISPLAY_KEYS` (L1202-1205) = `['outcome','reason','attempted','name','kind','access_policy','chunk_count','deduplicated','error','q','returned','limit']`; web `DISPLAY_DETAIL_KEYS` in `format.ts` (§C-D5) must equal it **as a set and in this exact order**; T-C6 asserts `deepEqual([...SERVER_DISPLAY_KEYS],[...DISPLAY_DETAIL_KEYS])` **and** deep-equals the literal, and separately asserts `detail.attempted === 'p3c-invalid'` / `'p3c-other'` on two real GETs. F2 pins the client-side order (`['reason','attempted']`). | Read L1199-1207, L1392-1393, L1412-1414 and §C-D5. Counted the list: **12 keys**, and the same 12 appear in §C3.3's `detail` bullet, in `SERVER_DISPLAY_KEYS` and in the F2 expectation — I compared them element by element, no drift. The order is not decorative: `reason` precedes `attempted` because the allow-list declares `reason` second, so T-C13c's `Object.keys` deep-equal is a real constraint on the picker's construction (it must iterate the allow-list, not the input object). | **CLOSED** |
| **10** | **RC-C/4 / C-4** — `page-format.test.ts F1..F8` were gated in §F2 but defined nowhere → unexecutable gate rows | §C4.4 (L1412-1419) defines all eight: **F1** deep-equal picker (+ key order), **F2** the C-3 regression guard (`attempted` survives; order pinned), **F3** `null`/`undefined` → `{}`, **F4** `outcomeOf`, **F5** exact `formatTs('…07:41:20.004Z','UTC') === '2026-11-02 07:41:20'` + regex + `'—'` for `'garbage'`/`''`, **F6** `describeError` incl. case-insensitivity `'FORBIDDEN'`, **F7** TZ-stability **run as two child processes** (`TZ=UTC` and `TZ=Asia/Bangkok`, outputs compared), **F8** no key outside the allow-list with a wide sentinel input. | Read L1412-1419 and checked each is **satisfiable by the §C-D5 signatures** (the round-2 objection was "defined but unimplementable"): F5's expected literal is achievable only if `formatTs` takes a `timeZone` argument — §C-D5 does declare one; F7 needs two processes, which is unusual but is the only honest way to prove TZ-stability in one run; F3 must not use `try/catch` (stated). Confirmed F1…F8 are in §F2's B-tier... precisely: in **C's** own-test cell (L1569) and mapped one-per-AC in §C-GATE. | **CLOSED** |
| **11** | **RC-C/5 / C-5** — no URL→bind mapping for `from`/`to`: the URL names are `from`/`to`, the bind names `fromTs`/`toTs`, and the `''`→`null` conversion was never stated | New **§C3.4a** (L1079-1089) gives executable code: `fromRaw`/`toRaw` read with a `typeof === 'string'` guard, `fromTs = fromRaw ? new Date(fromRaw) : null`, three ordered `400`s (`Invalid from timestamp`, `Invalid to timestamp`, `from must be <= to`), and the fixed naming bridge **URL `from`/`to` ↔ locals `fromTs`/`toTs` ↔ `$4`/`$5`**, with the instruction "Bind `fromTs`/`toTs` **only** — never the raw strings (an empty string raises `invalid input syntax for type timestamp with time zone`)" — which is exactly probe mistake #2 recorded at L99. A full URL→TS→bind table (L1171-1172) precedes the bind array (L1176-1186). **T-C13b** proves all three branches. | Read L1079-1089, L1171-1186, L1394 (T-C7 covers `?from=hello`, `?to=hello`, inverted range) and located T-C13b in §C4.2. Verified against `.pipeline/p3/PLAN.md:99` (the recorded probe failure) and against `routes/audit.ts` today (reads no query params at all ⇒ every T-C7 assertion is pre-fix-failing). The `from > to` → `400` case and the `'Invalid to timestamp'` for an unparseable `to` are distinct strings, so a copy-paste error in one branch fails a test. | **CLOSED** |
| **12** | **C-6 / RC-3** — `T-C3`'s arithmetic was impossible as written (it looked like it needed more rows than the fixture had) and test-ID/persona names did not bridge between body and gate tables | `T-C3`'s arithmetic re-derived and pinned (7 requests / 13 rows / terminal `rows.length === 1`), and both **§B-GATE** (L910-925, 10 ACs) and **§C-GATE** (L1451-1465, 8 ACs) now name a defined test per row. The §0.6 log claims *"every test ID named in a gate table is now defined in the body, and every ID in the body appears in the gate table."* | Enumerated mechanically rather than trusting the claim: extracted every `| **T-…** |` / `| **F…** |` defined in §B4.2-4.3 and §C4.2/§C4.4 (**T-B:** 1-15 incl. 7b/7c/10b/10c/15b, 16-17, 19-23 = 25 IDs; **T-C:** 1-13 incl. 3b/13b/13c = 16 IDs; **F:** 1-8) and cross-referenced the two gate tables. **Every ID referenced by either gate table is defined.** Arithmetic independently re-derived: 13 rows, `limit=2` ⇒ 7 pages, last page 1 row — correct. | **CLOSED** *(but the reverse direction is false: T-B16 is defined-but-gated-nowhere and 15 IDs are un-gated — see §R4.5 gate-coverage finding #2, non-blocking)* |
| **13** | **Gate-table coverage** — "every AC of `REQUEST.md` has a row, every row names a defined test, and the manual-only lists contain only what cannot be automated" (`PLAN.md:1671`, my own round-2 demand) | §B-GATE has **10 rows = AC1…AC10**; §C-GATE has **8 rows = AC1…AC8** plus a cross-cutting pre-fix-gate row. Every row names at least one defined test; 3 B rows and 1 C row are labelled *static* with a **numeric** expectation. Manual-only tables are explicit (`B-M1..B-M3`, `M-1..M-14`) and each manual row names the automated row that backs it. | Checked row-for-row against `REQUEST.md:38-56` (F3-B AC1-AC10) and `REQUEST.md:59-67` (F3-C AC1-AC8): counts match, no AC skipped, no invented AC. Tested each "Manual-only? No" claim: only AC8 of C is manual-only (no DOM runner in `web/` — `web/package.json` read in round 1 confirms, and `RESULT.md:98` independently records it), and AC5 of B is now automated via T-B23. **Two gate rows are weaker than they look** (AC1's "⇒ 5" call-site count and AC10's `grep ⇒ 0` on a nonexistent directory) → §R4.5 findings #1 and #3, non-blocking. | **CLOSED** *(with two non-blocking gate-strength notes)* |
| **14** | **File-touch check** — no file added beyond what round 2 approved; `db/schema.ts`, `ingest/service.ts`, `library.ts`, `middleware/auth.ts`, `auth.ts` (beyond its logging call site) and the p2/p3 evidence files untouched | §F1 (L1528-1555) lists per-file per-part actions: B adds `audit/{events,sanitize,log}.ts`, `middleware/require-admin.ts`, two `__p3b__` test files; C adds `audit/format.ts`, `__p3c__/{audit-read,page-format}.test.ts`, `web/scripts/f3c-audit.mjs`, rewrites `routes/audit.ts` + `audit/page.tsx`, edits `app.ts`; `auth.ts`/`ingest.ts`/`search.ts` are **2/2/1 call-site edits only**. Struck-through rows for `db/schema.ts` (NQ1), `seed.sql` ×2 (R-A2/R-B5). §F1 asserts *"Zero files are touched by two parts except `web/src/lib/api.ts` (A then C, different blocks)."* | Read L1528-1560 and diffed against `B-C-CLOSURE.md`'s "Scope guard" (L111-113): identical file set, nothing added. Cross-checked §F4.1.5 (L1604 — `f1test`, `.tmp_probe`, `.pipeline/p2/**`, `.pipeline/p3/f3a-*.log` untouchable) and §F2 (L1574-1576 — baseline 40 OK with the legitimate per-part list, `db/schema.ts` row still OK, no `CREATE` in the diff). **Baseline re-confirmed by me this session (read-only):** `sha256sum -c .pipeline/p3/baseline.sha256` ⇒ **37 OK + exactly 3 `FAILED`, and the 3 are exactly the authorised F3-A files** (`server/src/routes/library.ts`, `web/src/lib/api.ts`, `web/src/app/dashboard/library/page.tsx`); `server/src/routes/audit.ts`, `server/src/app.ts`, `web/src/app/dashboard/audit/page.tsx` all `OK` ⇒ **B and C have written nothing**, as required. Note §F2 L1574 still says "**40 OK**" flat; post-F3-A the correct pass condition is "37 OK + the 3 named", which §F3 (L1583-1590) does state — a wording inconsistency only, resolved in favour of §F3 (see §R4.6 NB-5). One **internal contradiction**: `require-admin.ts` is listed as *"imported/mounted by **C only**"* (§F1 L1537) while §B3.6 rule 4 says *"imported and mounted **only** by C's `routes/audit.ts`"* but §B3.6 rule 5 and §C3.1 additionally have **`app.ts`** in the chain → §R4.6 NB-4, cosmetic. | **CLOSED** |
| **15** | **Data safety** — no destructive DB op, isolated fixtures, cleanup by captured id, no pattern deletion, no secrets in logs (`REQUEST.md:72-76`) | §F4 (L1597-1624) is declared the single governing statement: F4.1 prohibits `TRUNCATE/DROP/ALTER/CREATE/UPDATE/DELETE` on `audit_log` from product code, any DB reset, `ADMIN_PASSWORD` rotation, and **"No deletion by pattern, ever"** with the specific ban on `LIKE 'p3b-%'`/`'p3c-%'`/`resource LIKE 'admin:%'`/`'search:%'`. F4.2 requires `INSERT … RETURNING id` captured **in the test process** — *"No `seed.sql`, no `\\o` id-file, no id file of any kind"* — and three-way proof: `count(id = ANY($1)) ⇒ 0`, a `p3*` marker count ⇒ 0 used **only** as a survivorship check, then total count = pre-run value. | Read L1597-1624, B4.1.1-1.5 (L817-823) and C4.1.1-1.5 (L1349-1353). The B fixture's row-locating predicate (L819) is a `SELECT`, not a delete, and it is triple-bounded (`created_at >= TEST_START` **and** `id::text >= PRE_MAX_ID` **and** an expected-resource predicate) — this is the correct reading of "never a pattern delete": patterns may *find*, only ids may *delete*. Verified the C fixture also carries a **poison row** (L1372-1374) that no production writer could ever produce (stored `password`/`token`/`nested` keys), so the AC7 test cannot pass on a live-row coincidence. Confirmed the table-state invariant is `PRE_COUNT`, not `0` (R-B5) in all three parts, and that F4.3 forbids secrets in any artifact with the `<token:N chars>` convention. | **CLOSED** |

**Score: 14 of 15 items CLOSED; item 8 CLOSED as a rule but with its discriminator vacuous (R4-C/1). Separate from the table, three new defects were found by reading the plan as an implementer would (§R4.4).**

---

## R4.2 — VACUITY AUDIT (per part, with the strongest discriminator named)

An assertion is **vacuous** if it is true of the code *before* the part is implemented, or if it cannot distinguish a correct implementation from the named defect. A **part-level gate** is vacuous if the part's suite can go green while the part's headline defect is still present.

### F3-B

| Test | Pre-fix behaviour (measured/traced on today's tree) | Strongest discriminating element | Verdict |
|---|---|---|---|
| **T-B7** (`auth.ts` reverted ⇒ `+0` rows on a valid login) | `auth.ts` writes nothing today ⇒ a login creates **0** rows ⇒ the *post-fix* assertion (`+1`) **fails** on the reverted tree. That is the definition of non-vacuous. | **`+1` exact, with a frozen object** (T-B8) — not `>= 1`. Exactness matters: `+1` fails if a call site double-writes (e.g. both branches logged), which a `>= 1` would hide. | **NON-VACUOUS** |
| **T-B7b** (`ingest.ts` reverted ⇒ `+0`) | `ingest.ts` writes nothing today. | `+0` on the reverted tree **and** a `chunk_count === 1` (not `> 0`) assertion post-fix — the `1` is what proves the plan's own R-B5 "≥ 40 words ⇒ 1 chunk" fixture arithmetic, so a silently-empty probe file fails. | **NON-VACUOUS** |
| **T-B7c** (`search.ts` reverted ⇒ `+0`) | Same. | `+0` on revert; post-fix `resource === 'search:*'` **and** `detail.returned === 0` for a no-hit query (a `search:undefined` policy default fails). | **NON-VACUOUS** |
| **T-B9** (failed login ⇒ `actor` is SQL `NULL`, read **from the DB row**) | Pre-fix: no row at all ⇒ fails. Post-fix: a `?.` that resolves to `''` instead of `null` would pass a JSON check but fail a DB-row check (`'' !== null`). | **"asserted on the DB row, not just the JSON"** — this is the single strongest element in B's suite, because the defect it names (an actor that *looks* absent in JSON but is an empty string in `text`) is invisible to every HTTP-level assertion. | **NON-VACUOUS** |
| **T-B22** (actor from token, not phantom `id`) | Pre-fix: no row ⇒ fails. Post-fix: a `req.user.id` implementation writes `null` ⇒ `row.actor === 'admin'` fails. | **The triple equality + the negative control** (`jwt.decode(token).id === undefined`) — the plan asserts the *trap itself*, so the test documents why the naive implementation fails rather than merely that it does. | **NON-VACUOUS** *(strongest single B test overall)* |
| **T-B14 (a)(b)(c)** (AC9 seam) | `recordAudit` does not exist pre-fix ⇒ fails to import. Post-fix, a naive `recordAudit` that `await`s `pool.query` outside a `try` **rejects** ⇒ (a) fails. A `sanitizeDetail` outside the `try` throws synchronously on a getter ⇒ (b) fails. | **(b) `assert.doesNotThrow` with an evil-getter event** — this is the only assertion of the three that catches the *synchronous* half of "must not fail the request", and it is the one the round-2 plan lacked (it tested only the async rejection). | **NON-VACUOUS** |
| **T-B20** (AC1: exactly one `INSERT INTO public.audit_log`) | Pre-fix: `grep` ⇒ **0**, so `=== 1` fails. | The count is **exactly 1** and the file is *named* (`audit/log.ts`) — so a stray `pool.query('INSERT INTO audit_log …')` in `routes/ingest.ts` fails on the count, and a second copy of the INSERT in a second module fails on the path. | **NON-VACUOUS** |
| **T-B3** (deny set beats a widened allow-list) | The function does not exist pre-fix. Post-fix, a sanitiser that implements *only* the allow-list passes T-B1 but fails T-B3's first half; a sanitiser that hardcodes `{}` for any forbidden key passes the first half but fails the second half. | **The two halves are mutually exclusive** — this is a genuinely well-built discriminator: the second half (`{outcome,note}` honoured under the widened list) exists *precisely* so the first half "cannot pass for the wrong reason", and the plan says so. | **NON-VACUOUS** |
| **T-B16** (NQ1: index test) | — | — | **REMOVED — and its placeholder is still gated nowhere.** Correct to remove the test (no index exists), but the placeholder row survives in §B4 and §B-GATE AC10 cites *"T-B16 (REMOVED)"* as a green row. A gate row whose only automated evidence is a removed test is vacuous by construction — it passes because there is nothing to run. Non-blocking (AC10's substance is carried by the `db/schema.ts` baseline row) but it must be re-worded: **§R4.5 #2**. |

**F3-B part verdict: the suite is non-vacuous and its pre-fix gate is real.** The strongest discriminator in the part is **T-B22** (actor provenance, triple-equality with a negative control), followed by **T-B9's DB-row `NULL` assertion**. Nothing I read would pass against today's tree: every event test fails on `+0` rows, every sanitiser test fails on a missing module, and the two static tests fail on `0` and on a nonexistent `middleware/require-admin.ts`.

### F3-C

| Test | Pre-fix behaviour (traced against the 21-line `routes/audit.ts` and `audit/page.tsx`) | Strongest discriminating element | Verdict |
|---|---|---|---|
| **T-C1** (the gate: whole file, unmodified `audit.ts`, must exit 1) | Today: `SELECT actor, action, resource, detail, created_at … LIMIT 200` ⇒ **no `id` in rows**, **no `limit` key**, **no `next_cursor` key**, every filter ignored (**`?action=` → 13 rows**), **`?actor=null` ignored**, **`?from=hello` → 200 not 400**. Six independent failure modes. | **Six enumerated discriminators, all true today, all named in the row.** Round 1 had *zero*; round 2 had them stated; this round they are still all true, so the gate genuinely fires. | **NON-VACUOUS** *(the strongest single C element — the part cannot go green on the old file)* |
| **T-C6** (AC7 poison: sentinels must not appear, but the object must be narrowed not blanked) | Today `detail` is returned **verbatim** ⇒ all three `L3AK_*_SENTINEL_*` strings appear ⇒ fails. | **The narrowing half** (`detail.name === 'b.txt'`, `detail.chunk_count === 1`, `detail.outcome === 'success'`) — this is what stops a lazy "return `{}` for every detail" implementation from passing the sentinel half. Plus the three-way key-list equality. | **NON-VACUOUS** *(strongest C test overall)* |
| **T-C13c** (key order is `SERVER_DISPLAY_KEYS` order, not stored insertion order) | The poison row's stored key order is `outcome, name, chunk_count, password, token, blob` ⇒ pre-fix fails both on the extra keys and (if a picker iterated the input) on the order. | **Order, not set** — a picker built as "filter the input object's keys" passes a set comparison and fails this row. Well chosen. | **NON-VACUOUS** |
| **T-C3** (paging to the end with `next_cursor`) | No `next_cursor` key at all ⇒ fails. | Terminal-page `rows.length === 1` (not `2`) — proves the probe row was **popped**, which is the actual contract. | **NON-VACUOUS** |
| **T-C3b** (the exact-multiple case: `?limit=13` ⇒ `next_cursor === null`) | **Fails vacuously in the wrong direction** — see below. | Intended: `rows.length === limit` implementations emit a cursor ⇒ 14th empty page. | **VACUOUS — FALSE PASS** (blocking, **R4-C/1**) |
| **T-C4** (filter matrix incl. `?actor=null` ⇒ 2 rows, `?actor=` ⇒ 13) | Filters ignored today ⇒ 13 rows for every leg ⇒ fails. | **`?actor=` (empty) ⇒ 13 rows** distinguished from **`?actor=null` ⇒ 2 rows** — the R-C2 NULL-actor rule is the subtlest branch in the whole part and it has a dedicated, pre-fix-failing assertion. | **NON-VACUOUS** |
| **T-C9 / F6** (`describeError` pure) | `format.ts` does not exist ⇒ import fails. | **`describeError('Forbidden') === 'error'`** (a string is not an `Error`) — guards against `err.message` on a non-Error, which a `catch (e: any)` would hit in production. | **NON-VACUOUS** |
| **T-C11** (source greps: `api.search` ⇒ 0, `slice(` ⇒ 0, `api.audit.list(` ⇒ ≥ 1) | Both forbidden strings exist today (`audit/page.tsx:13` `api.search`, `:16` `results.slice(0, 50)`) ⇒ fails. | **`slice(` ⇒ 0** — the only assertion that catches client-side slicing, which is `REQUEST.md:62`'s explicit requirement. | **NON-VACUOUS** |
| **T-C10** (mount order `[authMiddleware, requireAdmin, auditRouter]` + the `requireAdmin` unit) | No `requireAdmin` in today's chain (`app.ts:57` is `authMiddleware, auditRouter`) ⇒ fails. Labelled honestly as *"mount, not enforcement"*. | **The stack-order introspection** (`_router.stack` layer regexp + route stack) — it proves the guard runs *after* authentication, which is the one ordering mistake that would 403 every request. | **NON-VACUOUS** |
| **T-C12 / T-C13** (empty state; source contains `describeError(`, `api.audit.list(`, `No audit events yet`) | Today's copy is `No activity yet.` and `Loading…` html-entity — both greps fail. | The literal `No audit events yet` vs the actual current `No activity yet.` — pins the copy `REQUEST.md:63` demands. | **NON-VACUOUS** |

**R4-C/1 (blocking) — `T-C3b` is a false pass, and it is the only test that separates the two `next_cursor` rules.**
`T-C3b` (L1389) asserts `?limit=13` on the **whole table** ⇒ `rows.length === 13` **and** `next_cursor === null`, justified as *"the fixture is exactly 13 rows"* and *"a `rows.length === limit` implementation: `?limit=13` returns a non-null cursor"*. The fixture (L1357-1374) contains **exactly 13 rows** — I counted the `VALUES` tuples, #1…#13. But `?limit=13` on a 13-row table is a **full final page**: the route's `LIMIT $8 + 1` fetch returns **13** rows, so `hasMore = 13 > 13` is **false**, and *both* rules emit `null`. Therefore:
- a correct implementation passes (fine), and
- a **wrong** `rows.length === limit` implementation **also passes** (it emits a cursor only when `rows.length === limit`, i.e. when `13 === 13` — here it does not, so it emits `null` too).

The row's own "pre-fix / wrong-rule ⇒ FAIL" column is **false as written**. The only genuinely separating shapes are **(a)** a page with **more rows than `limit` remaining**, e.g. `?limit=12` (13 rows ⇒ 12 + probe ⇒ non-null **and** a following page of 1) or `?limit=6` (⇒ non-null, 3rd page of 1), and **(b)** the *last* page being **full**: `?limit=7` over 14 rows or `?limit=3` over 12 filtered rows — a full final page must yield `null`, which the `rows.length === limit` rule cannot express. `T-C3b`'s second leg (`?limit=1&action=search.query`, 3 rows ⇒ string, string, `null`) **is** correct and does separate the rules. So the fix is narrow: keep the second leg, replace the first with `?limit=12` (or `?limit=6`) and add a full-final-page case. **As it stands, the plan cites `T-C3b` at L1667 as "the only assertion that separates the two rules" while the row as written does not separate them** — the plan is one edit away from being right, and that edit must be made before C is implemented, or the C-2 closure is only prose-deep.

---

## R4.3 — GATE-TABLE COVERAGE CHECK

Method: I extracted every test ID **defined** in §B4.2-4.3 and §C4.2/§C4.4 (`T-B1…T-B23` incl. `7b/7c/10b/10c/15b`, `T-B16`; `T-C1…T-C13` incl. `3b/13b/13c`; `F1…F8`) and every ID **referenced** by §B-GATE and §C-GATE, and compared the two sets in both directions. Then I checked the AC counts against `REQUEST.md`.

**F3-B — §B-GATE, 10 rows / 10 ACs**

| Check | Result |
|---|---|
| Every `REQUEST.md:38-46` AC (AC1…AC10) has a row | **PASS** — 10 rows, `grep`-verified one-per-AC, no invented AC |
| Every referenced ID is defined in §B4.2/§B4.3 | **PASS** — referenced set `{T-B1,3,4,7,7b,7c,8,9,10,10b,10c,11,12,14,15,15b,17,19,20,21,22,23}` ⊆ defined set |
| Every defined ID is gated | **FAIL (non-blocking)** — **9 defined IDs appear in no gate row**: `T-B2`, `T-B5`, `T-B6`, `T-B13`, `T-B16`, plus the T-B14 sub-parts are only partly named. They are gated in **§F2** (own-test-file row) but not mapped to an AC. This makes §0.6's claim ("every ID in the body appears in the gate table") **false**. Not a vacuity problem — §F2 makes them required — but the two tables disagree with the revision log. |
| Manual-only rows are genuinely manual | **PASS** — `B-M1..B-M3` only; nothing that could be automated is parked in a browser |
| Static rows carry a numeric expectation | **PASS for T-B20** (`⇒ 1`); **WEAK for T-B15b** (`⇒ 5` and `⇒ 0`) — see §R4.4 R4-B/2 and R4-B/3 |

**F3-C — §C-GATE, 8 rows / 8 ACs + 1 cross-cutting**

| Check | Result |
|---|---|
| Every `REQUEST.md:59-67` AC (AC1…AC8) has a row | **PASS** — 8 rows + a pre-fix-gate row |
| Every referenced ID is defined | **PASS** — `{T-C1,3,3b,4,6,9,10,11,12,13,13b,13c}` + `F1,2,4,5,6,8` all defined |
| Every defined ID is gated | **FAIL (non-blocking)** — `T-C2`, `T-C5`, `T-C7`, `T-C8`, `F3`, `F7` are defined but named in no gate row (§F2 lists them). Same §0.6 overclaim as B. |
| AC8 manual-only | **PASS and correctly justified** — no DOM runner exists in `web/`; `RESULT.md:98` independently records this as a known limitation |
| AC2 (five columns, exact order) automated | **PARTIAL** — `T-C13` is a **source grep** for the five header literals; it cannot prove they *render* in order. Accepted as the best available without a DOM runner, **provided** the grep asserts the literal sequence (the row says so) and M-1 backs it in the transcript. |

**Gate-table finding (non-blocking, cross-cutting):** the two gate tables are **sound as pass criteria** but the §0.6 revision-log claim that the body↔gate bridge is complete in *both* directions is **not true** (15 IDs unreferenced). Because §F2 requires every test file to be green, no test is actually unenforced — but a future reader auditing "is AC5 of B covered?" must not treat the gate table as exhaustive. Recommend: add a "§F2-only" column, or drop the bidirectional claim from §0.6.

---

## R4.4 — NEW FINDINGS FOUND THIS ROUND (reading the plan as an implementer)

These are not re-litigations of round 2; they are defects introduced or exposed by the round-3 rewrite.

### BLOCKING

**R4-B/1 — The plan's own call site violates the plan's own binding rule, and T-B9 cannot catch it: AC3 is violated as written.**
- §B3.1 (L660) and §B-D10a (L601-603) are **binding**: the actor is `req.user?.username`; `req.user.id` MUST NOT be referenced.
- §B3.2's `search.ts` call site (L772) reads exactly that. §B3.4's `auth.login.success` call site reads `row.username` (justified at L575, correctly). But §B3.4's **`auth.login.failure`** call site (L711, quoted in full) is:
  ```
  actor: req.user?.username ?? null,
  ```
  On `POST /api/auth/login` there is **no token** — `authMiddleware` is **not mounted on `/api/auth`** (`server/src/app.ts:57` mounts it only on `/api/audit`, and I re-read `app.ts` this session). `POST /api/auth/login` reaching the handler **guarantees `req.user === undefined`**, so this expression is `null` **by construction**, on every request, forever.
- That is defensible *by intent* (B-D7 wants `null`), but as **written** it is a bug in three ways: (i) it is indistinguishable from the `req.user.id` trap §B-D10a exists to forbid, and `grep req\.user\.id ⇒ 0` (T-B7's static half, L886) **passes**; (ii) **T-B9 passes** — it asserts `actor: null` in the frozen object and `row.actor === null` on the DB row, which is exactly what the buggy expression produces; (iii) it makes the plan's stated rationale ("verified JWT") inapplicable to the one event whose actor decision is most security-relevant.
- **AC3 as literally written** — *"every event carries `actor` (derived from the verified JWT, never from the request body)"* — is therefore **false for `auth.login.failure`** in the plan's own code, and the plan's §B-GATE AC3 row does not notice because it re-states the same `null` expectation.
- **Fix (one paragraph, no new question):** write the literal `actor: null` at that call site with a one-line comment (`// no principal exists on this route; see B-D7`), and add to **T-B9** the assertion that the failure call site contains neither `req.user` nor a body echo — e.g. `grep -c 'req\.user' ` in the `auth.login.failure` block ⇒ **0**, or a `sanitizeActor`-level unit asserting the event builder for `auth.login.failure` ignores a planted `req.user = {username:'admin'}`. This also restores the negative control that is missing: **no test in B currently asserts that an unauthenticated route does not read `req.user`.**

**R4-C/1 — `T-C3b`'s headline leg is a false pass; the C-2 closure rests on it.** Full derivation in §R4.2. 13-row fixture + `?limit=13` ⇒ both rules emit `null`. Replace the first leg with `?limit=12` (separation) and add a **full final page** case (`?limit=3` over a 12-row filter, or 14 rows at `?limit=7`) — the only shape where the `rows.length === limit` rule *must* differ from `hasMore`. Keep the second leg; it is correct.

*Why these two and not BLOCK:* neither requires design change, a new file, or a new open question; both are single-paragraph edits inside sections that are otherwise correct. But both mean that the suite as specified **cannot fail** on the defect it exists to catch, which is the one thing this phase has already been burned by twice (round 1's C suite, and the F3-A cursor).

### NON-BLOCKING

- **R4-B/2 — §B-GATE AC1's `grep 'void recordAudit(' ⇒ 5` is brittle and self-invalidating.** T-B15b (L868) requires *"exactly 5 matches, one per emitted event (2 in `auth.ts`, 2 in `ingest.ts`, 1 in `search.ts`)"*, but §B3.4's failure call site (L755-761) is written inside the existing `catch` with the comment `// failure, inside the existing catch, before pushing to errors` and the plan's own §B-D7/§B3.2 block for login failure (L735-738) **does not** repeat the `void` prefix in the fragment shown. A correct implementation that writes `await`-less `recordAudit({…})` (no `void`) in one branch yields **4** and fails a green build. Fix: make the expectation `grep -c 'recordAudit(' ⇒ 5` (prefix-free) and keep the separate `'await recordAudit(' ⇒ 0` assertion — the `await` assertion is the one that carries AC4/AC9 meaning.
- **R4-B/3 — §B-GATE AC10's automated column is `grep ⇒ 0` over directories that may not exist.** *"No `CREATE` in `server/src/audit` or `server/src/middleware` (`grep` ⇒ 0)"* — `server/src/audit/` does not exist yet (I verified `ls`), so the grep passes trivially on a *directory-existence* failure rather than on the property. Same for AC10's companion `T-B16 (REMOVED)`. Fix: gate AC10 on the **baseline row** only (`db/schema.ts` ⇒ `OK`) plus `git diff --stat -- server/src/db/schema.ts ⇒ empty`, and drop the directory greps.
- **R4-B/4 — `T-B17` (10 MB detail ⇒ resolves, ≤ 201 chars stored) is listed under AC7's automated evidence, but it proves the cap, not the deny set.** Harmless (T-B3/T-B1/T-B11 carry AC7), but the row should say "cap only".
- **R4-C/2 — `T-C7`'s `?limit=9999 ⇒ 200 with limit === 200` and `?limit=0 ⇒ 200 with limit === 1` are correct but the plan never states what `?limit=abc` / `?limit=-5` yield.** `T-C7` includes `?limit=abc` ⇒ `200` with `limit === 50`, which is a third clamp idiom (`NaN → default`) not stated in §C3.2's "floor + clamp" table. One row in §C3.2 should name `NaN → default 50`. Pre-fix this leg is non-discriminating (pre-fix has no `limit` key at all, so it fails anyway) — cosmetic.
- **R4-C/3 — §C3.2's `actor` row says *"`sanitizeActor`d; ≤ 64"* while §C3.2's `resource` row says *"≤ 200 chars, truncated"*.** `sanitizeResource` is defined to truncate **without** a marker (§B3.2 L687), so the word "truncated" is fine, but "≤ 64" for `actor` conflicts with T-C4's `?actor=p3c-user` (11 chars — no conflict in practice) and with nothing else. Cosmetic only: **the empty-string and literal-`null` rules are correctly stated and are the ones that matter.**
- **R4-C/4 — `F7` shells out to `TZ=UTC npx tsx …` from inside a Node test.** This will not work verbatim on Windows/Git-Bash without `cross-env`-style quoting, and `npx` is explicitly discouraged elsewhere in the plan (`REQUEST:18` warns about `npm run build`, not `npx`, but the run command at L1444 uses `node --import ./server/node_modules/tsx/dist/loader.mjs`). Fix: use the loader form for the two child processes, or assert TZ-stability with `Intl.DateTimeFormat(…, {timeZone})` in-process. Non-blocking; the assertion's intent is right.
- **R4-C/5 — §C-GATE AC2's only automated evidence is a source grep.** Combined with AC8 being manual-only, C ships **two** ACs with no runtime proof of *rendering*. Accepted this round (documented limitation, no DOM runner), but the Implementer must paste `M-1`'s five-header transcript **verbatim including column order** for it to count.

---

## R4.5 — FILE-TOUCH CHECK (independent restatement)

| Question | Answer | Evidence |
|---|---|---|
| Does B or C add a file round 2 did not approve? | **No** | §F1 (L1528-1555) diffed against `B-C-CLOSURE.md:111-113` — identical set |
| Does anything touch `db/schema.ts`? | **No** | §F1 struck-through row; §F2 L1575 gates the baseline row `OK` in all three parts |
| Does anything touch `ingest/service.ts`? | **No** | §F1 L1553; F1-guarantee restated |
| Does anything touch `middleware/auth.ts` or the token shape? | **No** — only `require-admin.ts` is created | §F1; §B-D10a says explicitly "No change to `auth.ts`, `middleware/auth.ts`, `db/schema.ts` or the token shape" |
| Does B edit `auth.ts` beyond a logging call site? | **No** — 2 call sites | §F1 L1538 |
| Does A touch anything in this revision? | **No** | §F1's A rows unchanged; round-3 log L27 |
| Is any file touched by two parts? | **Only `web/src/lib/api.ts`** (A block then C block, sequential) | §F1 L1530, L1560 |
| Does any test write DDL? | **No** | §F4.1.1; §F2 L1576; B-SQL-2 deleted |
| Baseline state right now | **37 OK + exactly the 3 authorised F3-A files FAILED** (`library.ts`, `api.ts`, `library/page.tsx`); `audit.ts`, `app.ts`, `audit/page.tsx` **OK** | `sha256sum -c` run read-only this session |
| Was any product file modified by *me*? | **No** | Only this `REVIEW.md` append |

**One cosmetic contradiction to fix:** `require-admin.ts` is described as *"imported/mounted by **C only**"* (§F1 L1537) vs *"imported and mounted **only** by C's `routes/audit.ts`"* (§B3.6 rule 4) vs the actual chain `app.ts:57 → app.use('/api/audit', authMiddleware, requireAdmin, auditRouter)` (§C3.1) which puts **`app.ts`** in the import chain. §B3.6 rule 5 half-admits this ("`app.ts` under C only for the mount"). Restate as: *"imported by `routes/audit.ts` (C) and `app.ts` (C's mount); no other importer."*

---

## R4.6 — REMAINING FINDINGS, RANKED

**Blocking (must be in the next plan revision):**
1. **R4-B/1** — `auth.login.failure`'s actor expression reads `req.user?.username` on a route where `req.user` cannot exist; add `actor: null` literally + a "no `req.user` on this route" assertion to T-B9.
2. **R4-C/1** — `T-C3b`'s `?limit=13` leg is a false pass on a 13-row fixture; replace with a separating shape **and** add a full-final-page case.

**Non-blocking (should be in the same revision; will not gate alone):**
3. §0.6's bidirectional body↔gate claim is false (15 IDs defined-but-ungated). Either add a §F2-only column or weaken the claim.
4. `T-B16 (REMOVED)` is still cited as green evidence in §B-GATE AC10 — remove the citation.
5. §B-GATE AC1's `void recordAudit(` count (§F2/T-B15b) is brittle → count `recordAudit(` and keep `await …` ⇒ 0.
6. §B-GATE AC10's directory greps pass vacuously on a nonexistent `server/src/audit/`.
7. §F2 L1574 still says the baseline gate is "**40 OK**"; post-F3-A it is "37 OK + the 3 named" (correctly stated in §F3). One wording differs from the other; make L1574 match §F3.
8. `require-admin.ts` importer list contradicts itself (§F1 vs §B3.6 rules 4/5) — §R4.5.
9. `F7`'s `TZ=UTC npx tsx …` child-process recipe will not run verbatim on Windows; use the `node --import …/tsx` form the rest of the plan uses.
10. §C3.2 should state the `NaN → default 50` clamp explicitly (T-C7 relies on it).
11. AC7's evidence row lists `T-B17` (cap) next to the deny-set tests; label it "cap only".
12. `search.query` has no actor-provenance assertion of its own (T-B22 covers `ingest.upload.success`); the static `grep` covers the rest — accept or add one leg to T-B22.

**What I did *not* do, and am not claiming:** I did not start the server (so no HTTP status, no rendered page, no pre-fix `200`/`400` observation — those remain `[U]` and are the Implementer's gate); I did not run any test suite; I did not write to the DB; I did not re-run the round-1 keyset probe (`probe_audit_cursor2.sql` P13/P14 remains the load-bearing keyset evidence, unchanged). The `T-C3b` arithmetic in R4-C/1 is derived from the plan's own fixture and its own `LIMIT $8 + 1` rule; it needs no DB to establish, because both candidate rules reduce to `null` at `rows.length === limit === 13`.

**Verdict restated:** F3-B → **REVISE** (one blocking defect: R4-B/1; the part is otherwise the strongest piece of the plan — its pre-fix gate, its DB-row `NULL` assertion, its triple-equality actor provenance and its seam-based AC9 proof are all real). F3-C → **REVISE** (one blocking defect: R4-C/1; its six-way pre-fix gate, poison-row AC7 proof and key-order assertion are real, and the round-1 "every C test passes on today's code" finding is **cured** — but the one assertion the plan nominates as separating the `next_cursor` rules does not separate them).

NO SOURCE FILE MODIFIED · NO INSTALL · NO SERVER STARTED · NO DB WRITE · baseline re-verified read-only: 37 OK + exactly the 3 authorised F3-A files FAILED.

DONE:PLAN_REVIEWER_P3_R4

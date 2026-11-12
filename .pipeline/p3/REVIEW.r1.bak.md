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

NO SOURCE FILE MODIFIED · NO INSTALL · NO SERVER STARTED · NO DB WRITE · baseline re-verified 40/40 OK.

DONE:PLAN_REVIEWER_P3

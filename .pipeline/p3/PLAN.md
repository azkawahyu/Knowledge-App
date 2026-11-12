# PLAN — Phase 3: F3-A Library integration · F3-B backend audit logging · F3-C Audit UI

PROJECT ROOT: `D:\Develop\knowledge-app`
PHASE ID: `phase3-library-audit` — predecessor: `.pipeline/p2/RESULT.md` (`FINAL_REVIEW: PASS`), `.pipeline/f1/RESULT.md` (PASS), `.pipeline/phase1/RESULT.md` (PASS)
ROLE: PLANNER — plan only. **No source file modified, nothing installed, server not started, no DB write.** Every SQL probe in this plan was `SELECT`-only or ran against a `CREATE TEMP TABLE` that vanished at disconnect; baseline re-proved after the probes (§0.2).
SOURCE: `.pipeline/p3/REQUEST.md`
DATE: 2026-11-02

Legends — **[V]** verified by me in this session (I read the file at the cited line, or ran the read-only probe named in the same paragraph). **[G]** given, asserted by `REQUEST.md` / a prior phase artifact and **not** re-executed by me. **[U]** unestablished; cannot be settled without writing data or starting the server.
REVISION: **round 4** — this file was edited in place **only** to apply the two blocking defects of `.pipeline/p3/R4-CLOSURE.md` (`R4-B/1`, `R4-C/1`) to **F3-B and F3-C**, with their gate-table consequences (§0.7). Round 4's twelve other items are **non-blocking** and are recorded as implementer-time notes (§0.7.1) to be carried into `TEST-REPORT.md`. Round 3 rewrote the file in place to apply the six closure items of `B-C-CLOSURE.md` (`C-1 … C-6`) to **F3-B and F3-C only**, making each a complete, literal implementation spec with a full acceptance-criterion gate table; round 1 applied the 16 REQUIRED REVISIONS + 11 open-question rulings of `REVIEW.md`; round 2 (`REVIEW.md` §ROUND 2) left F3-A **APPROVE** and required revision of F3-B (RC-B/1) and F3-C (RC-C/1…5). **F3-A's sections are unchanged by rounds 3 and 4** except where a cross-reference had to stay correct (§F2, §F3, §G, §H, §J). **Still plan-only:** no source file modified, nothing installed, no server started, no DB write.

---

## 0.7 REVISION LOG — round-4 closure (F3-B / F3-C, two defects only)

Source: `.pipeline/p3/R4-CLOSURE.md`, which carries exactly **two** blocking defects out of round 4 (`F3-B: REVISE` / `F3-C: REVISE`). This revision applies **only** those two items plus the gate-table consequences, this log, and the deferred-non-blocking record below. No structural rework, no new questions, no new files, no change to F3-A.

| Item | Defect it closes | What was applied | Section(s) changed |
|---|---|---|---|
| **R4-B/1** | `auth.login.failure`'s actor expression `req.user?.username ?? null` is `null` **by construction** — `app.ts:51` mounts `/api/auth` **without** `authMiddleware`, so the value is accidental and is the same trap §B-D10a forbids; `T-B9` passed on it, making AC3's "actor derived from the verified JWT" **false for that event as written**. | §B3.2's `auth.login.failure` row replaced **verbatim** with the item's five cells (`actor = NULL` by rule; `detail` gains `user_known`). The item's **binding actor rule** and its **AC3 restatement for this event** inserted verbatim beneath the table. §B3.4's failure snippet now writes the **literal `null`** with a comment forbidding any `req.user` reference on that path, and computes `detail.user_known` from the already-executed SELECT (`auth.ts:17-21`) **after** the password check fails. `T-B9` replaced with the item's **two-part** form (DB-row `actor IS NULL` + a **behavioural** no-`req.user` assertion, getter-throws preferred). New **`T-B9b`** negative control (a successful login writes `actor === 'admin'`). | §B3.2, §B3.4, §B4.2 (`T-B9`, `T-B9b`), §B-GATE (AC2, AC3), §F2, §J1 |
| **R4-C/1** | `T-C3b`'s first leg (`?limit=13` on a 13-row fixture) is a **false pass** — `LIMIT+1` and the broken `rows.length === limit` rule both yield `next_cursor === null` there, so the leg cannot discriminate, yet the plan called it "the only" separator and labelled it load-bearing. | `T-C3b`'s body replaced **verbatim** with the item's **three-leg** form: legs 1–2 are **shape guards** (both rules agree on them; the item's own "leg 2 separates them" sentence is contradicted by its Leg 3 asides — both rule models admit it — so Leg 3's asides govern), **leg 3** — delete one row, then `?limit=12` on 12 rows ⇒ **`next_cursor === null`** — is the **discriminator**; the test must record *"a run that reports leg 3 as PASS without the delete-one-row precondition BLOCKS."* The blanket "only" claim **softened** in all three places to *"the only **assertion** that separates them; `T-C2`'s page-count check corroborates it"*. | §C4.2 (`T-C3b`), §C-GATE (AC3), §C5 (CR2), §J3 |

**Verification of this revision (plan-only; no source file touched):** the two cited facts were re-read at their lines — `server/src/app.ts:51` = `app.use('/api/auth', authRouter);` with **no** `authMiddleware` (while `:53-57` all pass it) **[V]**, and `server/src/routes/auth.ts:17-21` is the `SELECT id, password_hash FROM admins WHERE username = $1` whose result **is** the `row` compared at `:22` — so `user_known` is derivable without any `req.user` reference **[V]**. `T-B9b` was checked for ID collision (`0` prior occurrences).

### 0.7.1 Deferred — round-4 items that are **non-blocking** (recorded here, **not applied** by this revision)

`R4-CLOSURE.md` closes with the reviewer's explicit ruling that the remaining round-4 items are non-blocking. They are **not** plan contracts: applying them here would delay a phase that has already lost time to an infrastructure failure. They are therefore recorded as **implementer-time notes** and **MUST be carried into `TEST-REPORT.md`** so they are visible at final review. *A reader must not treat this list as a set of unmet plan requirements.*

| # | Non-blocking item (as named in `R4-CLOSURE.md`) | Disposition |
|---|---|---|
| **NB-R4-1** | The **false bidirectional body↔gate claim** | Deferred. Note in `TEST-REPORT.md`; no contract changes. |
| **NB-R4-2** | The **brittle `'void recordAudit('` count** (used by §B-GATE AC1 as `⇒ 5`) | Deferred. The count stays in the plan as written; the Implementer records the actual grep output and any drift in `TEST-REPORT.md`. |
| **NB-R4-3** | **AC10's greps pass on a directory that does not exist yet** | Deferred. The Implementer confirms each grepped path exists before recording a PASS; the confirmation goes in `TEST-REPORT.md`. |
| **NB-R4-4** | The **stale `T-B16 (REMOVED)` citation** | Deferred. Cosmetic; recorded, not edited. |
| **NB-R4-5** | The **Windows-incompatible `TZ=UTC npx tsx` recipe in `F7`** (§C4.4) | Deferred. The Implementer runs the equivalent two-child-process form under the platform actually in use and records both outputs plus the adaptation in `TEST-REPORT.md`. |

---

## 0.6 REVISION LOG — B/C closure (round 3)

Each row is one of the six closure items in `B-C-CLOSURE.md`, applied here. "Verbatim" means the item's own text was inserted as given; "literalised" means the item's *intent* was applied and the surrounding prose was rewritten so the contract is executable (no remaining ambiguity for the Implementer). Every row is verifiable by opening the named section.

| Item | Verdict it closes | What was applied | Section(s) changed |
|---|---|---|---|
| **C-1** | F3-B RC-B/1 — JWT claim mismatch (`req.user.id` is `undefined`) | New **§B-D10a** inserted verbatim immediately after B-D10; §B3.2's call-site table now carries the one-line identity rule above it and every actor cell reads `req.user?.username ?? null`; `T-B21` added to the unit suite (verbatim); `T-B22` and `T-B23` added to the integration suite (verbatim); §B3.1's `requireAdmin` signature is now stated; the `403` decision is recorded as superseding round 1's `401` mandate in one place (§B-D10 / §B-D10b). | §B-D10a (new), §B-D10b (new), §B3.1, §B3.2, §B3.4, §B3.6 (new), §B4.2 (T-B21), §B4.3 (T-B22, T-B23), §B5, §C3.7, §C7 (CQ1) |
| **C-2** | F3-C RC-1 — `next_cursor` rule contradicts R-A3/CQ2 | §C3.3's `next_cursor` bullet replaced verbatim; the "Order matters" paragraph added verbatim to §C3.5; T-C2/T-C3 restated to assert the rule (T-C3 becomes reachable: 7 requests, 13 rows, terminal page `rows.length === 1`). | §C3.3, §C3.5, §C4.2 (T-C2, T-C3) |
| **C-3** | F3-C RC-2 — `attempted` dropped by the display allow-list | §C3.3's `detail` key list replaced verbatim; the "must equal" rule added verbatim; §C-D5's `DISPLAY_DETAIL_KEYS` order aligned; T-C6 and F2 now assert `attempted` survives end-to-end. | §C3.3, §C-D5, §C4.2 (T-C6), §C4.4 (F2), §C5 (CR8) |
| **C-4** | F3-C RC-4 — `page-format.test.ts F1..F8` gated but undefined | The prose sentence in §C4 is replaced by the verbatim **F1–F8** table (§C4.4), each row mapped to an AC in the C gate table (§C-GATE). | §C4.4 (new) |
| **C-5** | F3-C RC-5 — no URL→bind mapping for `from`/`to` | New **§C3.4a** inserted verbatim after the §C3.2 table: the exact `req.query` reads, the `'' → null` conversion, the three `400`s, the fixed naming **URL `from`/`to` ↔ locals `fromTs`/`toTs` ↔ `$4`/`$5`**; `T-C13b` added. A complete URL→TS→bind table now precedes the bind array (§C3.5). | §C3.4a (new), §C3.5, §C4.2 (T-C13b) |
| **C-6** | F3-B/F3-C RC-3, RC-5 arithmetic + name bridges | `T-C3`'s request/row arithmetic re-derived and pinned (7 requests / 13 rows / terminal `rows.length === 1`); every test ID named in a gate table is now defined in the body, and every ID in the body appears in the gate table (§B-GATE, §C-GATE). | §B-GATE (new), §C-GATE (new), §C4.2, §F2, §H, §J |

**Scope of round 3:** no new file was added to the touch matrix beyond what `REVIEW.md` round 2 approved; §F1 is unchanged. Nothing in F3-A was edited.

---

## 0.5 REVISION LOG — round 1

Every row is verifiable by opening the named section. "→" is what changed. Nothing in this table is a re-litigation: each is applied as written by the reviewer.

| Rn | Disposition (one line) | Section changed |
|---|---|---|
| **R-A1** | AC7 deviation declared verbatim at the head of §A3.2; `offset` **removed** from the response, the client type, T-A11/T-A14 and the browser steps (literal-`offset` fallback documented, not chosen). | §A-D3, §A3.2, §A3.3, §A4 (T-A11, T-A14), §A8 |
| **R-A2** | §A4 fixture replaced by an in-test 5-step lifecycle (`DELETE … LIKE 'p3a-%'` → `INSERT … RETURNING id` into `IDS` → assertions → `DELETE … id = ANY($1)` → re-count `0`); `psql -f seed.sql` removed from the run; T-A11 runs last, in-process, behind an explicit `count(*) = 0` pre-assert. | §A4.1–A4.3, §F1 |
| **R-A3** | `next_cursor` rule is now `LIMIT $1 + 1`, extra row dropped before serialising, cursor emitted only when it was present; the false "cannot compute an OFFSET" justification deleted from A-D5, replaced by ordering stability. Mirror applied in C (`LIMIT $8 + 1`). | §A-D5, §A3.3, §A3.5, §C3.3, §C3.5, §C-D1, §CQ2 |
| **R-A4** | `size_bytes` cast at source: `d.size_bytes::int` (column is `bigint` nullable; `pg` returns `int` as a JS number); JS guard if the value ever exceeds 2^31. Asserted by a new T-A12. | §A3.3, §A3.5, §A4 (T-A12) |
| **R-A5** | `web/src/lib/api.ts` `library` block written out exactly (types + method + `next_cursor` handling); `api.library.list` **must not** be typed with `offset`. | §A8 (new), §F1 |
| **R-B1** | `requireAdmin` body now **rejects a missing `req.user`** with `403 {"error":"Forbidden"}` before `next()`; T-C10 gains a `req.user`-absent assertion; CQ1 satisfied by a *pure* function (`describeError`). | §B-D10, §C3.7, §C4 (T-C10), §C5 (CR3/CR6) |
| **R-B2** | AC9 trigger fallback **deleted**. AC9 = unit seam (T-B14) + real-HTTP "200/207 unchanged" (T-B10b) + static `void recordAudit(` count (T-B15b). No `CREATE FUNCTION`/`CREATE TRIGGER` anywhere. | §B4, §BQ2, §F4, §F1 |
| **R-B3** | New `sanitizeResource()` (control-char strip, `trim`, cap 200 **no** marker) applied to **every** `resource` built from an attacker-controlled string; §B-D6 table rewritten to agree with §B3.4; T-B19 added. | §B3.1, §B3.2, §B-D6, §B3.4, §B4 (T-B19) |
| **R-B4** | Mutation gates split: **T-B7** (`auth.ts`), **T-B7b** (`ingest.ts`), **T-B7c** (`search.ts`), each must fail on the reverted tree; §F2's B gate row rewritten. | §B4, §F2 |
| **R-B5** | B fixture is a `.txt` of ≥40 words so `chunkCount === 1`; T-B10 asserts `=== 1`; cleanup captures `pre_count` + ids read back from `RETURNING id` (never pattern-only), and the post-cleanup assertion is `count(*) === pre_count`. §C4's `\o` id-file replaced by in-process `RETURNING id`. | §B4 (T-B10, T-B10b, cleanup), §C4 (fixture lifecycle), §F2 |
| **R-B6** | `recordAudit` is **total on the synchronous path**: `try{}catch{}` wraps the sanitiser calls *and* `pool.query(...).catch(...)`; T-B14 gains `doesNotThrow` against a throwing `detail` getter. | §B3.1, §B-D2, §B4 (T-B14) |
| **R-C1** | New `web/src/app/dashboard/audit/format.ts` exporting `pickDisplayDetail`, `outcomeOf`, `formatTs`, `describeError`; `page.tsx` imports them; T-C9 rewritten to call `describeError` (no `fetch` stub), **T-C13** added (source contains `describeError(`, `api.audit.list(`, `No audit events yet`). File-touch matrix updated. | §C-D5, §C-D10, §C3.8 (new), §C4 (T-C9, T-C13), §F1 |
| **R-C2** | NULL-actor contradiction resolved: `actor=null` (literal) ⇒ `WHERE actor IS NULL`; `actor=` (empty) ⇒ **absent**. `$2` becomes a 3-state pair (`$2 actor`, `$9 actor_is_null`). T-C4's impossible assertion replaced by a real one. | §C3.2, §C3.3, §C3.5, §C4 (T-C4), §C5 (CR5), §C6 (FU-C2) |
| **R-C3** | Poison sentinels made **unique to forbidden keys** (`L3AK_PASSWORD_…`, `L3AK_TOKEN_…`), and the poison row also carries a nested blob; T-C6 asserts on both sentinels + absence of keys + `{`-free rendering. | §C4 (fixture, T-C6) |
| **R-C4** | C's SQL keeps the declared-cast NULL short-circuits and the A-shaped `(created_at, id) < ($6::timestamptz, $7::uuid)` cursor, and the **parameter-order bug is fixed** (`$6` timestamptz / `$7` uuid, matching the probe); the exact `pool.query` array is written out so the order cannot drift. `$9 actor_is_null` added for R-C2 (9 params, all documented inline). | §C3.5 (SQL + JS call) |
| **R-C5** | C's tests made **non-vacuous**: 13-row fixture so `?limit=2` distinguishes 2 from 13; T-C1's discriminators enumerated; T-C2 asserts envelope + rows + ids; T-C12 runs against a **temporarily emptied** table with a `count(*)=0` pre-assert and asserts the exact 3-key envelope; T-C3 tie set corrected to **three** `10:00:00Z` rows and the terminal page is `1 row / next_cursor null`; `f3c-audit.mjs` rescoped to URL plumbing only + new `server/src/__p3c__/page-format.test.ts` for the page helpers. | §C4 (fixture, T-C1, T-C2, T-C3, T-C12, harnesses), §F2 |
| **NQ1** | The two new audit indexes and the `db/schema.ts` edit are **dropped**; recorded as **FU-B10**. `db/schema.ts` removed from the file-touch matrix. | §B-D9, §B3.3 (B-SQL-2 deleted), §B4 (T-B16 removed), §B6, §F1, §F3, §G |
| **NQ2** | `sanitizeDetailDenyOnly` **deleted** from the module surface; the deny set is tested through the public `sanitizeDetail(raw, widenedAllowList?)`; T-B3 rewritten. | §B3.1, §B3.2, §B4 (T-B3), §B3.4 |
| **AQ1/AQ2/AQ3** | `Previous` via client cursor stack: **yes**. Keep `total`: **yes**. Public-schema fixture that is **idempotent**: **yes** (R-A2). | §A4, §A7, §A-D9 |
| **BQ1/BQ3/BQ4** | `actor = null` **and** sanitised candidate in `resource` **and** `attempted` added to the detail allow-list; zero-chunk fresh ingest = `success` + `chunk_count: 0` (asserted, T-B10c); audit-write failure logs at `warn`. | §B-D7, §B3.2, §B3.4, §B4, §B7 |
| **Q1 / CQ3** | 40 baseline entries authoritative, no filtering. `id` returned in the payload, not displayed. | §0.2, §F3, §CQ3 |
| **NB-1…NB-7** | Every cross-reference re-derived by string grep against the current file (not memory); per-part "files legitimately changed" list made explicit in §F3; `probe_audit_readonly.sql` P5 marked intentionally-unexecuted; P13/P14 named as the load-bearing probe; `FU-A7 metadata size cap` added; `api.ts chat` untouched; `console`/`logger` duality left to FU-B9. | §0.2, §A5 (AR5), §A6, §F3, §G |

---

## 0. ORDERING, DECOUPLING, AND WHAT THIS PLANNER VERIFIED

### 0.1 Approval and implementation order — **A → B → C, strictly**

```
F3-A (Library integration)  ── gates ──▶  F3-B (backend audit logging)  ──▶  F3-C (Audit UI)
```

The phase brief requires **F3-A PASS before F3-B starts**. Approved separately, implemented separately, reviewed separately, each with its own `RESULT` evidence. **C is approved after B and implemented after B passes**, because C renders the contract B defines. A reviewer may approve all three parts in one pass; they may **not** authorise implementation out of order.

**Decoupling rules (binding on the Implementer):**

| Rule | Statement |
|---|---|
| D1 | **No shared code between A and B.** A introduces `web/src/lib/api.ts` `library` methods; B introduces `server/src/audit/*` and edits `auth.ts`/`ingest.ts`/`search.ts`. They must not touch the same file. |
| D2 | The only file A and C both touch is **`web/src/lib/api.ts`** — A adds `api.library.list`, C adds `api.audit.list`. Different regions of one file, added in different phases; no merge conflict because they are sequential. |
| D3 | **`server/src/routes/audit.ts` is rewritten by C, not B.** B defines the *logging* contract (taxonomy, sanitiser, reliability classes) and **must not touch the reader**, so that B can PASS on write-side evidence alone while the Audit page is still broken. C owns the read contract end-to-end (route + page). See §B9 / §C1. |
| D4 | A must leave **`api.search` untouched**: `retrieve/page.tsx:20` keeps using it, and F2-A's PASS rests on its semantics. |
| D5 | A must not import, reference or textually mention `audit_log`, `api.audit`, or `AuditEvent`. If a reviewer sees any of those tokens in A's diff, A is wrongly scoped. |
| D6 | B must not import anything from `web/`. `server/` and `web/` share no type: the audit wire types live in `web/src/lib/api.ts` (C) and `server/src/audit/events.ts` (B), duplicated deliberately — there is no shared package (`server/package.json` and `web/package.json` are independent, [V]). |

### 0.2 What I verified this session

- `sha256sum -c .pipeline/p3/baseline.sha256` → **40 entries, all OK**, re-run after all my probes. Matches `REQUEST.md:10`'s "38 files" only if 2 of the entries are not source files — they are not: **all 40 paths are product files** (`awk '{print $2}'` listed: 22 `server/*`, 18 `web/*`) [V]. **My probe scripts are NOT in the baseline** (I never appended them), so the "38" in `REQUEST.md:10` is a **stale count in the request doc, not a filter instruction** — see Q1. There is no mutation-grep artefact to filter: `grep -v '^\.pipeline/'` is **unnecessary and should not be used**, because it would let a legitimate `.pipeline` entry (there are none today) slip past review. Only `server/src/routes/audit.ts` and `server/src/db/schema.ts` contain the literal table name, and both are files C, resp. B, are **allowed** to change [V].
- Live DB (read-only `count(*)`): `documents=0, chunks=0, audit_log=0, admins=1` [V] — matches `REQUEST.md:17` [G].
- `information_schema.columns` for `public.audit_log` [V]: `id uuid NOT NULL DEFAULT gen_random_uuid()`, `actor text NULL`, `action text NOT NULL`, `resource text NULL`, `detail jsonb NOT NULL DEFAULT '{}'::jsonb`, `created_at timestamptz NOT NULL DEFAULT now()` — exactly as `REQUEST.md:13` [G]. Indexes [V]: `audit_log_pkey (id)` UNIQUE btree, `audit_log_created (created_at DESC)` btree. **No index on `action`, `actor`, or `resource`.**
- `public.documents` columns [V]: `id, name, kind, source_path, size_bytes(bigint), sha256, status default 'pending', access_policy default 'restricted', metadata jsonb default '{}', created_at, updated_at`. **No `chunks` count column, no `deleted_at`.**
- Server defaults [V]: `TimeZone = Asia/Bangkok`, `DateStyle = ISO, DMY`, PG `18.6`. This matters: any `timestamptz` that reaches the wire is rendered in `+07` unless the app serialises it.
- `jq` **absent** [V] (`which jq` → not found) — matches `p2/RESULT.md:133` [G]. **No plan step below uses `jq`.**
- Candidate audit keyset SQL prototyped against a **temp table** shaped `LIKE public.audit_log` [V]:
  - NULL cursor params (`$6::uuid IS NULL OR (created_at, id) < ($7::timestamptz, $6::uuid)`) — **the `pg`-driver shape — works**: filters alone, action-only, actor+action, and from/to-only each returned the expected rows (P12a–P12d).
  - **4 rows sharing one `created_at`**: page 1 (limit 2) returned `…000d, …000c`; keyset from `(created_at, …000c)` returned `…000b, …000a` — **no duplicate, no gap** (P13/P14). A `created_at`-only cursor would have dropped two rows; this is why the cursor is composite.
  - Un-escaped `ILIKE` for `actor` matched **3** rows where the escaped pattern matched **1** (P15) — the reason actor filtering is exact-match, not substring (§B6.4).
  - **The load-bearing probe is `probe_audit_cursor2.sql` P13/P14**, not `probe_audit_cursor.sql` P12d: P12d's `from`/`to` uses `now()-interval` against rows inserted in the same `now()` window, so "P12d from/to only" is weak evidence. P13/P14 page **4 identical-`created_at` rows** with `LIMIT 2` and continue from `(…000c, 2026-11-02 10:00:00+00)` — that is the gap-free keyset proof this plan rests on. **Stated so nobody cites P12d as the proof.**
  - `probe_audit_readonly.sql` **P5 is intentionally UNEXECUTED** — it contains `2020-01-01::text`, which is a syntax error. Only P6/P8 of that file ran. A `\echo` note in the file says so; do **not** read that file as a green run.

**Two probe mistakes I made and am recording so nobody "trusts" them:** (1) `PREPARE … (text,text,text,timestamptz,timestamptz,text,uuid,…)` with `(created_at, id) < ($7::timestamptz, $6::uuid)` → `ERROR: cannot cast type uuid to timestamp with time zone` — the parameter list was in the wrong order; the fix is to declare the params in usage order. (2) passing `''` as a cursor "absence" marker → `ERROR: invalid input syntax for type timestamp with time zone: ""` — **the absence marker must be JSON `null`, not `""`.** Both are why §B6.5 pins the parameter order and the `null` rule.

---

## PART F3-A — Library integration

### A1. CURRENT BEHAVIOUR (verified)

**Backend.** `server/src/routes/library.ts:6-19` is the entire route: `SELECT id, name, kind, source_path, size_bytes, sha256, access_policy, status, metadata, created_at, updated_at FROM documents ORDER BY created_at DESC` → `res.json({ results: result.rows })` [V]. It runs on a **single pooled query with no transaction** and no `chunks` join, so **there is no chunk count** anywhere in the response [V].

Defects, each named:

| # | Defect | Evidence |
|---|---|---|
| **LA-1** | **`source_path` is returned to the browser.** This is the on-disk content-addressed blob path (`server/data/uploads/<sha256><ext>` — built at `server/src/ingest/service.ts:138`), i.e. server filesystem layout disclosure. | `library.ts:9` [V] vs `REQUEST.md:11` [G] |
| **LA-2** | **No pagination, no cap.** An unbounded `SELECT *` of every document row plus its `metadata` jsonb. 182 rows in `f1test` shows the order of magnitude the design tolerates [G]. | `library.ts:8-13` [V] |
| **LA-3** | **No chunk count**, so the Library table cannot show whether a document is actually searchable. | `library.ts:9` [V] |
| **LA-4** | **No deterministic tiebreak.** `ORDER BY created_at DESC` alone: rows inserted in the same millisecond (a multi-file upload — `ingest.ts:202` loops files inside one request) have an unstable relative order between two requests, so paging can duplicate or skip rows. | `library.ts:12` [V] |
| **LA-5** | **No `total`.** With pagination added, the client cannot show "1–20 of 42" or decide whether a next page exists. | `library.ts:14` [V] |
| **LA-6** | **`updated_at` is never updated.** Nothing in `server/src` writes `updated_at` (the only `documents` INSERT is `service.ts:262`, which does not set it) [V]. The page labels the column "Updated" (`library/page.tsx:71`) but displays `created_at` (`library/page.tsx:85-87`) [V]. **Recorded as a follow-up, not fixed** (§A10). |

**Frontend.** `web/src/app/dashboard/library/page.tsx:22-48` calls `api.search({ q: "", limit: 100 })` on mount [V] and synthesises rows from chunk hits: `kind: "unknown"` (`:32`), `size_bytes: null` (`:33`), `sha256: r.sha256 || ""` where `r.sha256` never exists on a search row (`:34`), `status: r.document_policy` (`:35`), `created_at: r.created_at || ""` where `r.created_at` never exists on a search row (`:37`) [V]. Consequences, all verified by reading:

- **LA-7** — `server/src/routes/search.ts:31-34` rejects `q === ""` with `400 {"error":"q (query string) is required"}` [V], so the page enters its `err` branch (`library/page.tsx:51`) and renders **the string "q (query string) is required)"** as the entire Library page. It has never worked.
- **LA-8** — **A document with zero chunks is invisible.** Search hits are chunks; `chunkCount === 0` is a real, logged state (`ingest.ts:212-217`) and the dedupe path returns `chunkCount: 0` (`service.ts:145`) [V]. Even on a seeded DB the page would silently under-report.
- **LA-9** — Columns are mislabelled and mostly blank: "Size" shows `0 B` for every row (`?? 0` at `library/page.tsx:80`), "Updated" is empty because `r.created_at` is undefined (`:85-87`), "Status" shows the **access policy** (`:35`, `:82`) [V].
- **LA-10** — `api.ts` has **no** library method at all; `api` has `health`, `auth.login`, `ingestWatch`, `ingestUpload`, `search`, `chat` and nothing else [V].

**Auth.** `server/src/app.ts:56` mounts `/api/library` behind `authMiddleware` [V]; `library.ts` adds no further gate. Per `REQUEST.md:15` [G], **every authenticated user is an admin today** (`admins(username,password_hash)` only, `db/schema.ts:54-59` [V]) — so the absence of a role check costs nothing *today*, but it is invisible.

### A2. ROOT CAUSE / DESIGN — A-specific decisions

**A-D1 — The Library page must read `documents`, not chunk hits.**
*Justification:* LA-8 is not a bug in the page, it is a category error: `search` returns `chunks` rows, so the document list derived from it is *the set of documents that happen to have at least one chunk*. The authoritative list is `documents`.
*Rejected:* adding a `limit: 0`-style "list everything" mode to `search` — it would make `/api/search` responsible for two unrelated contracts and break F2-A's single-responsibility PASS.
*Rejected:* fixing the page to call `api.search` with a real query — LA-7/LA-9 would remain.

**A-D2 — New client method `api.library.list`, GET with query string.**
*Justification:* the route already exists as `GET /api/library`; a GET keeps it cacheable and makes the query string the single source of truth for page state (needed for A-D5). `request<T>` already sends `Authorization` (`api.ts:47-49`) [V].
*Rejected:* `POST /api/library/query` with a JSON body — an unnecessary second endpoint and it would put list parameters in a body where the browser cannot bookmark or reload them.
*Rejected:* reusing the existing `{ results: rows }` envelope verbatim — see A-D4.

**A-D3 — Envelope becomes `{ results, total, limit, next_cursor }`; `results` is preserved. (R-A1: no `offset`.)**
*Justification:* `results` is the field `REQUEST.md:11` documents and the field the page already destructures. Adding `total` fixes LA-5 without renaming anything. `limit` is echoed so the client can assert the server clamped its input rather than assuming it. **`offset` is deliberately absent** — see the AC7 deviation banner at §A3.2 and A-D5.
*Rejected:* renaming to `{ rows, meta }` to match `/api/audit` — B/C will use `{ rows }` (see §B6.5), but forcing a rename here buys cosmetic symmetry and breaks the only existing consumer for no functional gain. **The two envelopes differ deliberately; §C3 says why.**

**A-D4 — Keyset cursor, not `OFFSET`.**
*Justification:* documents are inserted in bursts (one upload request, N files) so `created_at` ties are common; `OFFSET` over a non-unique `ORDER BY` duplicates/skips rows (LA-4), and `OFFSET` gets slower the deeper you page. Probed keyset on a composite `(created_at, id)` proved gap-free paging across 4 identical timestamps (§0.2, P13/P14) [V]. `documents.id` is a UUID PK so `(created_at, id)` is a total order.
*Rejected:* plain `OFFSET` — correct only if `created_at` were unique, which it is not.
*Rejected:* a `serial`/`seq` column — that is a migration; out of scope (`REQUEST.md:70`).

**A-D5 — Cursor is opaque to the client: `next_cursor` is a string, client treats it as a token.** *(revised, R-A3)*
*Justification:* a cursor the client can construct is a cursor the client can construct *wrongly* (see my own probe mistake in §0.2). Opaque versioned base64url means the server owns the format and can change it. **The reason the cursor exists is ordering stability** — it carries `(created_at, id)`, the total order, so page N+1 is exactly "the rows strictly after the last row of page N" regardless of what was inserted in between. It is **not** an anti-slicing device: any client that controls `limit` can request `limit=100` and slice. Removing client-side slicing is done by the **page contract** (§A-D12: the page passes its own `limit` and does not slice a response), and by T-A13 + the harness source-grep, not by the cursor's opacity.
*Rejected:* exposing `?before=<ts>&last_id=<uuid>` — two params that must be used together; a client that sends one and not the other silently rewinds to page 1.
*Rejected:* JWT-signed cursor — signing protects against tampering, but a tampered cursor can only *change which page you see*, and the caller is already authorised for every page. Not worth the dependency.
*Deleted in round 1:* the previous clause *"the page cannot compute an OFFSET, which is exactly what makes 'no client-side slicing' trivially true"* — it was false under any client-controlled `limit`.

**A-D6 — `limit` clamped to `1…100`, default `25`.**
*Justification:* 25 fills the viewport; 100 is the ceiling and matches `library/page.tsx:24`'s `limit: 100` intent, so nothing the UI ever wants is rejected. Same clamp *shape* as `search.ts:39` (`Math.max(1, Math.min(50, …))`) so the codebase has one idiom.
*Rejected:* unbounded — that is LA-2.
*Rejected:* 50 to match search — the Library is a document table (hundreds), search is a passage list (tens).

**A-D7 — `source_path` is dropped from the response.**
*Justification:* LA-1. The browser has no use for a server filesystem path; the document is identified by `id`.
*Rejected:* keeping it and hiding it in the UI — the response is what an attacker with a token reads; the UI's rendering is irrelevant to disclosure.
*Rejected:* returning a hashed/basename form — still a path fragment with no consumer.

**A-D8 — `chunk_count` is computed with a `LEFT JOIN … GROUP BY`, not a correlated subquery.**
*Justification:* one pass; `documents` × `chunks` grouped by the document, `COUNT(c.id)` (not `COUNT(*)`) so zero-chunk documents still appear with `0` — this is the direct fix for LA-8. `chunks.document_id` is indexed by the FK? **No** — the FK at `db/schema.ts:22` does not create an index on the child column; PG creates an index only for the *referenced* (parent) PK. A `GROUP BY` aggregate over `chunks` is a seq scan either way, which is fine at this data size; a correlated `SELECT count(*)` would be O(docs) index probes.
*Rejected:* `count(*) OVER (PARTITION BY d.id)` in a windowed query — same result, harder to read, and it interacts badly with `LIMIT` (the window is computed over the pre-LIMIT set, so it costs a full scan of all matching chunks even for one page). That cost is the reason the design uses **two** statements (A-D9).

**A-D9 — `total` comes from a separate `COUNT(*)` on `documents`, executed in the same `Promise.all` as the page.**
*Justification:* the window-function alternative (rejected above) forces every page request to aggregate every chunk in the library. A bare `COUNT(*) FROM documents` is a cheap index-only-ish scan. Two round trips in parallel is *not* two sequential latencies.
*Rejected:* counting in the same statement — see above.
*Consequence, stated plainly:* `total` and the page are two statements, not one snapshot; a concurrent insert between them can make `total` off by one for that response. **Accepted**: the count is a UI hint ("1–25 of N"), never an authorisation or correctness input.

**A-D10 — Order: `created_at DESC, id DESC`.**
*Justification:* LA-4; matches the cursor exactly (`(created_at, id) < (cursor_ts, cursor_id)` in `DESC` order).
*Rejected:* `ORDER BY updated_at DESC` — `updated_at` is never written (LA-6), so it is `created_at` in disguise and would hide the bug rather than document it.

**A-D11 — No new auth mechanism; the existing `authMiddleware` mount stays; the route gains a comment naming the authorisation model.**
*Justification:* `REQUEST.md:70` forbids a broad auth redesign; per `REQUEST.md:15` [G] there is no role concept, so "admin-only" is *today* indistinguishable from "authenticated". Adding `requireAdmin` here would create an unused seam in the wrong phase — B is where the authorisation decision is made (§B7).
*Rejected:* adding a `role` column to `admins` — a migration for a distinction that has exactly one value today.

**A-D12 — `metadata` stays in the response, verbatim.**
*Justification:* it is document-owned user metadata, already surfaced before (`library.ts:10`), bounded by the upload contract (`ingest.ts:161-179` parses it, `express.json` is 1 MB but multipart metadata is bounded by multer's field limits). It is **not** in B's sanitiser's remit — B's sanitiser governs `audit_log.detail` only.
*Rejected:* dropping it — the Library is the only place a user can see the metadata they set.

### A3. EXACT CONTRACTS — F3-A

**A3.1 Route.** `GET /api/library` (unchanged path, unchanged mount at `app.ts:56`). Auth: `Authorization: Bearer <jwt>` (unchanged).

**A3.2 Query parameters.**

> **AC7 DEVIATION — declared and justified (R-A1).** AC7 says pagination must be `limit`/`offset`. This plan uses `limit` + an opaque keyset `cursor` **instead of** `offset`, because `OFFSET` over the non-unique `created_at` duplicates rows (LA-4) and the REQUEST's own AC7 requires a stable total order. This is a declared, justified deviation; if the reviewer/orchestrator requires literal `offset`, the cursor is dropped and `A-SQL-1` becomes `ORDER BY d.created_at DESC, d.id DESC LIMIT $1 OFFSET $2` with `offset` clamped `[0,10000]`. **This plan does not use that fallback.** Consequently `offset` is **absent** from the response (§A3.3) and from the client type (§A11.1).

| Param | Type | Default | Validation | On invalid |
|---|---|---|---|---|
| `limit` | integer | `25` | `Number`, floor; clamp to `[1,100]` | **never 400** — clamp silently, echo the clamped value in `limit` |
| `cursor` | opaque string | absent | base64url of `JSON.stringify({v:1,t:<ISO8601>,i:<uuid v4>})`; if it fails to decode or `v !== 1` → treat as **absent** (page 1) | never 400 (see A-D5) |

`limit` follows `search.ts:39`'s clamp idiom (never errors on out-of-range) [V].

**A3.3 Response `200`.**

```json
{
  "results": [
    {
      "id": "3f2b1c9e-8a41-4f0e-9d3a-0b7c5e21d4aa",
      "name": "vendor-agreement-2026.pdf",
      "kind": "pdf",
      "size_bytes": 482133,
      "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "status": "pending",
      "access_policy": "restricted",
      "metadata": { "source": "inbox", "owner": "ops" },
      "chunk_count": 14,
      "created_at": "2026-11-02T07:41:19.812Z",
      "updated_at": "2026-11-02T07:41:19.812Z"
    }
  ],
  "total": 42,
  "limit": 25,
  "next_cursor": "eyJ2Ij...YSJ9"
}
```

- `results` — array, possibly empty. **`source_path` is absent from every row** (A-D7).
- `total` — integer ≥ 0, count of **all** documents, independent of `limit`/`cursor`.
- `limit` — the **effective** clamped limit (echoed).
- **`offset` — REMOVED (R-A1).** It was a fiction: always `0` under keyset paging. It is not in the object, not in the client type, and not asserted anywhere. (`T-A14` asserts the key is **absent**.)
- `next_cursor` — **(R-A3)** a string **iff the server found at least one more row** beyond this page, else `null`. Implementation: the page query runs `LIMIT $1 + 1`; if `rows.length > limit` the extra row is dropped (`rows.pop()`) **before** serialising and the cursor is emitted from the new last row; if `rows.length <= limit` there is no extra row and `next_cursor` is `null`. It is a token, not a timestamp; the client must not parse it.
  - *Consequence, stated:* a page that happens to be exactly `limit` long **still** returns a cursor only if another row actually exists, so "last page full" no longer produces one empty page (this supersedes the old full-page heuristic and its CR2). The cost is one extra row of memory per request.
- **`size_bytes` — a JSON number or `null` (R-A4).** The column is `bigint` and the `pg` driver returns `bigint` as a **string** (`'482133'`). The cast `d.size_bytes::int` in `A-SQL-1` makes the driver return a JS `number`, so the wire type is `number`. `files.size` is bounded by multer's `limits`, far below 2^31, so the `int` cast cannot overflow in practice; the route additionally guards `typeof === 'number'` and maps a non-number to `null`. `T-A12` asserts the type.
- `created_at` / `updated_at` — ISO-8601 with `Z` (`Date.prototype.toJSON()` on a `timestamptz`; verified server TZ is `Asia/Bangkok` [V], so a naive serialisation would emit `+07:00` and shift the displayed day — `T-A7` pins the `Z` form).
- `chunk_count` — integer ≥ 0; `0` for a document with no chunks.

**A3.4 Response `500`.** `{ "error": "Failed to load library" }` — unchanged (`library.ts:17`) [V].
**Response `401`.** `{ "error": "Missing or invalid bearer token" }` / `{ "error": "Invalid or expired token" }` — unchanged, produced by `middleware/auth.ts:12,21` [V].

**A3.5 SQL — copy-pasteable, parameterised, no interpolation.** Two statements, run in `Promise.all`.

```sql
-- A-SQL-1: the page. $1 = limit::int, $2 = cursor_ts::timestamptz (NULL on page 1),
--           $3 = cursor_id::uuid (NULL on page 1).
-- Parameter ORDER matters: timestamptz before uuid, matching their appearance in
-- the row comparison (see the probe failure recorded in §0.2).
-- (R-A3) LIMIT $1 + 1: the caller passes the effective limit; the +1 row is the
--        "is there another page" probe and is popped in JS before serialising.
-- (R-A4) d.size_bytes::int makes the pg driver yield a JS number, not a bigint string.
SELECT d.id,
       d.name,
       d.kind,
       d.size_bytes::int AS size_bytes,
       d.sha256,
       d.status,
       d.access_policy,
       d.metadata,
       d.created_at,
       d.updated_at,
       COUNT(c.id)::int AS chunk_count
FROM public.documents d
LEFT JOIN public.chunks c ON c.document_id = d.id
WHERE ($2::timestamptz IS NULL
       OR (d.created_at, d.id) < ($2::timestamptz, $3::uuid))
GROUP BY d.id, d.name, d.kind, d.size_bytes, d.sha256, d.status,
         d.access_policy, d.metadata, d.created_at, d.updated_at
ORDER BY d.created_at DESC, d.id DESC
LIMIT $1 + 1
```

```sql
-- A-SQL-2: total. No parameters.
SELECT COUNT(*)::int AS total FROM public.documents
```

`GROUP BY d.id, …` lists every non-aggregated column because `id` alone is not sufficient under PG's functional-dependency rule when `d.id` is the PK of a *joined* table in a `LEFT JOIN` + `GROUP BY` — listing them is unambiguous and portable, and costs nothing.

### A4. TEST STRATEGY — F3-A *(rewritten in round 1: R-A2, R-A3, R-A4, R-A5)*

#### A4.1 Fixture lifecycle — the test owns it, in one process, in this order

**Nothing is seeded by `psql -f seed.sql` any more.** `server/src/__p3a__/seed.sql` is **deleted from the deliverable** (the file is no longer in the touch matrix). The fixture is created and destroyed by the test file itself, which is the only way the pre-fix gate and the post-fix run can both start from a clean slate (the reviewer's freshness finding). The test holds its own `pg` `Pool` from `db/index.ts` and the ids it inserts.

| Step | Exact statement / action | Assertion that must hold before moving on |
|---|---|---|
| **A4.1.1 reset** | `DELETE FROM public.documents WHERE name LIKE 'p3a-%';` | `SELECT count(*) FROM public.documents WHERE name LIKE 'p3a-%'` ⇒ `'0'` |
| **A4.1.2 insert** | the `INSERT` below, **with `RETURNING id, name`**, executed through `pool.query`, results captured into `const IDS: Record<string,string>` keyed by `name` and into `const ID_LIST = Object.values(IDS)` | `ID_LIST.length === 5`; `IDS['p3a-doc-big']` is a string matching `/^[0-9a-f-]{36}$/` |
| **A4.1.3 chunks** | the three chunk `INSERT … SELECT`s below, each `RETURNING id` (ids appended to `CHUNK_IDS` so the cleanup can be proven independently of the cascade) | `SELECT count(*) FROM public.chunks WHERE document_id = ANY($1::uuid[])` ⇒ `'5'` (1+3+1) |
| **A4.1.4 server + assertions** | `T-A1 … T-A13` run against a **live server** on `:4000` (started by the operator per A4.3), then `T-A11` runs **last, in this same process** after A4.1.5 | every assertion in A4.2 |
| **A4.1.5 cleanup** | `DELETE FROM public.documents WHERE id = ANY($1::uuid[]);` with `ID_LIST` — **by id, never by pattern** | `SELECT count(*) FROM public.documents WHERE id = ANY($1)` ⇒ `'0'`; `SELECT count(*) FROM public.chunks WHERE document_id = ANY($1)` ⇒ `'0'` (cascade proof, `db/schema.ts:22`); `SELECT count(*) FROM public.documents WHERE name LIKE 'p3a-%'` ⇒ `'0'` |

**Why the pre-fix run and the post-fix run now both get `total === 5`:** step A4.1.1 removes any residue from a previous (aborted) run, and A4.1.2 always inserts exactly 5. The old plan's `total === 5` with 10 rows after a second run is impossible here.

**`T-A1` (the pre-fix gate) never reaches A4.1.5** if it fails — a failed assertion throws, so the cleanup must be in a `finally { … }` block that runs steps A4.1.5 **unconditionally**, and the process exit code is `1` if any assertion failed. The zero-count proof is therefore printed even on the failing (pre-fix) run; that is required, because the gate's evidence is "cleanup happened **and** the assertion failed".

Seed SQL — **INSERT only, `RETURNING id, name`, never `TRUNCATE`, never `DELETE` without a `WHERE`**:

```sql
-- A4.1.2  (5 rows; executed with pool.query, RETURNING captured into IDS)
INSERT INTO public.documents
  (name, kind, source_path, size_bytes, sha256, status, access_policy, metadata, created_at, updated_at) VALUES
 ('p3a-doc-zero', 'txt', NULL,                                 11, repeat('a',64), 'pending','restricted','{"src":"p3a"}','2026-11-02T10:00:00Z','2026-11-02T10:00:00Z'),
 ('p3a-doc-one',  'txt', NULL,                                 12, repeat('b',64), 'pending','public',    '{"src":"p3a"}','2026-11-02T10:00:00Z','2026-11-02T10:00:00Z'),
 ('p3a-doc-three','md',  NULL,                                 13, repeat('c',64), 'pending','trusted',   '{"src":"p3a"}','2026-11-02T11:00:00Z','2026-11-02T11:00:00Z'),
 ('p3a-doc-path', 'txt', '/abs/path/should-never-appear.txt',  14, repeat('d',64), 'pending','restricted','{"src":"p3a"}','2026-11-02T12:00:00Z','2026-11-02T12:00:00Z'),
 ('p3a-doc-big',  'pdf', NULL,                                 15, repeat('e',64), 'pending','restricted','{"src":"p3a"}','2026-11-02T13:00:00Z','2026-11-02T13:00:00Z')
RETURNING id, name;
```

```sql
-- A4.1.3  chunks (RETURNING id captured into CHUNK_IDS)
INSERT INTO public.chunks (document_id, text)
SELECT d.id, 'p3a chunk ' || g FROM public.documents d, generate_series(1,1) g WHERE d.name='p3a-doc-one'   RETURNING id;
INSERT INTO public.chunks (document_id, text)
SELECT d.id, 'p3a chunk ' || g FROM public.documents d, generate_series(1,3) g WHERE d.name='p3a-doc-three' RETURNING id;
INSERT INTO public.chunks (document_id, text)
SELECT d.id, 'p3a chunk ' || g FROM public.documents d, generate_series(1,1) g WHERE d.name='p3a-doc-path'  RETURNING id;
```

```sql
-- A4.1.5  cleanup by id (the ONLY DELETE the test runs on fixture rows)
DELETE FROM public.documents WHERE id = ANY($1::uuid[]);   -- $1 = ID_LIST
```

**Fixture table (unchanged content, `created_at` now pinned for every row so the paging order is under control):**

| name | chunks | created_at | purpose |
|---|---|---|---|
| `p3a-doc-zero` | **0** | `2026-11-02T10:00:00Z` | proves LA-8 fixed (appears with `chunk_count: 0`) |
| `p3a-doc-one` | 1 | `2026-11-02T10:00:00Z` | **tie with zero** → proves the `id DESC` tiebreak |
| `p3a-doc-three` | 3 | `2026-11-02T11:00:00Z` | `chunk_count: 3` |
| `p3a-doc-path` | 1 | `2026-11-02T12:00:00Z` | **non-null `source_path`** → proves A-D7 by absence |
| `p3a-doc-big` | 0 | `2026-11-02T13:00:00Z` | **newest** → proves `DESC`; `size_bytes: 15` |

`'p3a-'` remains the marker, but it is now used **only** by the pre-test reset (A4.1.1) and the post-cleanup count; deletion is by id.

#### A4.2 Test matrix — `server/src/__p3a__/library.test.ts`

One process, `npx tsx`, Node `assert` only (no new dependency; house pattern from `server/src/ingest/__f1__/*.test.ts`). Every row is an **exact expected value**, not a shape hint.

| ID | Request | Expected value (exact) | Discriminates |
|---|---|---|---|
| **T-A1** | `GET /api/library` on the **unmodified** `library.ts` (the gate: run before implementing) | body `results[0]` **has** key `source_path` and **has no** key `chunk_count` ⇒ the assertion set below is violated ⇒ process exits `1` | pre-fix code: without this, a green suite proves nothing |
| **T-A2** | `GET /api/library?limit=2` | `body.limit === 2`; `body.results.length === 2`; `body.total === 5`; `typeof body.next_cursor === 'string'`; `body.results.map(r=>r.name)` deep-equals `['p3a-doc-big','p3a-doc-path']` (the two newest) | pagination + `DESC` order |
| **T-A3** | follow `next_cursor`: `?limit=2`, then `?limit=2&cursor=<next_cursor>`, then `?limit=2&cursor=<next_cursor>` | page2 names `['p3a-doc-three','p3a-doc-one' or 'p3a-doc-zero']` (see T-A4 for which); page3 exactly `1` row, `next_cursor === null`; the **union of the three pages' ids has size `5`** with **no duplicate** (`new Set(allIds).size === 5`) | keyset gap-freedom; `LIMIT+1` terminal detection |
| **T-A4** | `?limit=4` (puts `p3a-doc-zero` and `p3a-doc-one`, identical `created_at`, on the **same** page) | the last two names appear in the order given by `[IDS['p3a-doc-zero'], IDS['p3a-doc-one']].sort().reverse()` — i.e. **`id DESC` by uuid string**, computed in the test, not hard-coded; and `JSON.stringify(body)` is **byte-identical** on a second identical request | the tiebreak exists at all (pre-fix: `created_at` only) |
| **T-A5** | `?limit=100` | by name: `p3a-doc-zero.chunk_count === 0`, `p3a-doc-one.chunk_count === 1`, `p3a-doc-three.chunk_count === 3`, `p3a-doc-path.chunk_count === 1`, `p3a-doc-big.chunk_count === 0` | LA-3/LA-8 (pre-fix has no `chunk_count` key) |
| **T-A6** | any page | `JSON.stringify(body).includes('source_path') === false` **and** `JSON.stringify(body).includes('should-never-appear') === false` | LA-1 disclosure |
| **T-A7** | any page | every `created_at`/`updated_at` matches `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`; `Date.parse(created_at)` for `p3a-doc-big` `=== Date.parse('2026-11-02T13:00:00Z')` | the `Asia/Bangkok` `+07:00` trap |
| **T-A8** | `?limit=0` / `-5` / `1000` / `abc` / absent | `body.limit === 1` / `1` / `100` / `25` / `25` respectively, each echoed | clamp |
| **T-A9** | `?cursor=not-base64` / `?cursor=` / `?cursor=<b64url of {"v":2,"t":"…","i":"…"}>` | each is **`200`** with `body.total === 5` and `body.results[0].name === 'p3a-doc-big'` (page 1) | cursor hardening: no 500, no 400 |
| **T-A10** | no `Authorization`; `Authorization: Bearer <64 random chars>` | `401` with body `{"error":"Missing or invalid bearer token"}`; `401` with `{"error":"Invalid or expired token"}` | auth mount preserved |
| **T-A11** | **after A4.1.5, same process**: pre-assert `assert((await q('select count(*)::int as c from public.documents')).rows[0].c === 0)` then `GET /api/library` | `body` deep-equals `{results: [], total: 0, limit: 25, next_cursor: null}` — **`offset` must be absent** | empty-DB shape parity + R-A1 |
| **T-A12** | `?limit=100` (R-A4) | `typeof row.size_bytes === 'number'` for all five rows; `p3a-doc-big.size_bytes === 15`; `Number.isInteger(...)` true | `bigint`-as-string bug |
| **T-A13** | source-level (R-A5 / AQ1) | `grep -c 'api.search' web/src/app/dashboard/library/page.tsx` ⇒ `0` **and** `grep -c 'api.library.list' …` ⇒ `≥ 1` **and** `grep -c 'slice(' …` ⇒ `0` | the page no longer derives rows from search (this is the A-side AC1 proof) |
| **T-A14** | `?limit=2` (R-A1) | `Object.keys(body)` deep-equals `['results','total','limit','next_cursor']` — **no `offset` key** | the removed fiction cannot silently return |

#### A4.3 Commands (exact; run from repo root `D:\Develop\knowledge-app`)

```bash
cd server && npx tsc --noEmit                                   # must be exit 0
cd web    && npx tsc --noEmit                                   # must be exit 0
cd web    && npx next build                                     # "Compiled successfully"
# server up (never `npm run build`; dist/ is stale). The fixture is created by the TEST.
cd server && npx tsx src/index.ts > ../.pipeline/p3/f3a-server.log 2>&1 &
# tests (fixture reset -> insert -> assert -> cleanup-by-id -> zero-count, all inside)
cd server && npx tsx src/__p3a__/library.test.ts                 # T-A1..T-A14
node --import ./server/node_modules/tsx/dist/loader.mjs web/scripts/f3a-library.mjs
# independent cleanup proof (must be 0 even if the test aborted)
DBURL=$(grep -E '^DATABASE_URL=' server/.env | cut -d= -f2- | tr -d '\r')
"D:/Install/PostgreSQL/18/bin/psql.exe" "$DBURL" -tAc "select count(*) from public.documents where name like 'p3a-%';"   # -> 0
"D:/Install/PostgreSQL/18/bin/psql.exe" "$DBURL" -tAc "select count(*) from public.documents;"                            # -> 0 (F1 baseline)
sha256sum -c .pipeline/p3/baseline.sha256                        # informational: Step 2 of §F
grep -n "api.search\|slice(" web/src/app/dashboard/library/page.tsx   # -> no matches
```


#### A4.4 Harness — `web/scripts/f3a-library.mjs`

Sibling of the F2-B harness `web/scripts/f2b-hydration.mjs` [V]; `fetch` + the real `api.ts` module + fake `localStorage`. Exit `0`/`1`/`2` = PASS/FAIL/BLOCKED, matching the F2-B harness convention [V]. Asserts, exactly:

1. `api.library.list({})` calls `fetch` with a URL whose path is `/library` and **no** `q` parameter; the `Authorization` header is present and rendered as `<token:N chars>` in the log.
2. `api.library.list({limit:2, cursor:'abc'})` calls `fetch` with path `/library?limit=2&cursor=abc` (params in insertion order of the object literal in §A11.1).
3. `api.library.list({cursor:null, limit:undefined})` sends **neither** `cursor` nor `limit` — the URL is `/library`.
4. The returned object's keys deep-equal `['results','total','limit','next_cursor']` — **no `offset`** (R-A1).
5. `api.library.list` **never** calls `fetch` with `method: 'POST'`.
6. Source-level: `library/page.tsx` contains no `api.search`.

**Manual / browser (the only DOM-level evidence; no jsdom/Playwright in this repo — `web/package.json` has no test runner [V]):**


1. Login at `http://localhost:3000/login`, land on `/dashboard`.
2. Click **Library**. Expect the table with exactly the headers **Name · Kind · Size · Status · Policy · Chunks · Created**.
3. **`p3a-doc-zero` is visible with `Chunks = 0`** (the whole point of LA-8).
4. **Size** shows real byte counts formatted as `482,133 B`, **never** `0 B` for a document that has `size_bytes`.
5. **Status** shows `pending`, **Policy** shows `restricted|public|trusted` — the two columns are no longer the same value.
6. **Created** shows a date, not an empty cell (LA-9).
7. DevTools → Network: the page request is `GET /api/library?limit=25`, status `200`; the response body, viewed as text, contains **no** `source_path`, no `should-never-appear`, and **no `"offset"` key** (R-A1).
8. Click **Next** → a second request with a `cursor=` param; the table's first row changes and **no row appears twice**.
9. Click **Previous** (AQ1, now ruled **Yes**) → the **first page's** rows return, with **exactly one** network request issued (`cursor=` for page 1 is the empty stack entry, i.e. `/api/library?limit=25`), and the `Previous` button is disabled on page 1.
10. Reload the page → back to page 1, identical first row.
11. Delete `localStorage["ka_token"]` in another tab, reload `/dashboard/library` → redirected to `/login` (the existing hydration gate, `layout.tsx:17-21` [V] — must not regress).
12. With the DB emptied, the page shows **"No documents ingested yet. Use the Inbox to add some."** (existing copy preserved, `library/page.tsx:54-56` [V]).

### A5. RISKS / ASSUMPTIONS — F3-A

| # | Risk / assumption | Mitigation |
|---|---|---|
| AR1 | `total` and page are not one snapshot (A-D9). | Documented; `total` is a hint. A concurrent insert may make `total` off by one for one response. |
| AR2 | A `LEFT JOIN` + `GROUP BY` over `chunks` is a seq scan of `chunks`. | Fine at this scale (0 rows [V]; 182 in the test schema [G]). If the library grows past ~10⁵ chunks, add `CREATE INDEX ON chunks(document_id)` — **a migration, out of scope, recorded as follow-up** (FU-A3). |
| AR3 | `chunk_count` may disagree with `/api/search` for restricted documents if a policy filter is ever added. | Today `/api/search` filters by `access_policy` (`search.ts:53` [V]); `chunk_count` is **unfiltered**, i.e. "how many chunks exist", not "how many you could retrieve". This is the honest number for an admin-only table; stated so nobody treats it as a policy-leak indicator. |
| AR4 | The cursor is base64url of readable JSON — trivially decodable by the browser. | Not a secret: it contains only a `created_at` and a document id the caller may already see (A-D5). |
| AR5 | **`metadata` can be large** and is returned for every row — `25 × metadata` per page, so a 1 MB field turns one page into 25 MB. | Bounded today by `express.json({limit:'1mb'})` for JSON routes (`app.ts:33` [V]) and multer defaults for multipart. Recorded as **FU-A7** (metadata size cap at upload). Out of scope here. |
| AR6 | I did not start the server, so **the actual pre-fix HTTP response is [U]**; LA-7 is established by reading `search.ts:31-34` + `library/page.tsx:23-24`, not by observing the 400. T-A1 is written to *measure* it, not to assume it. | T-A1. |
| AR7 | `p3a-doc-*` rows in the **public** schema are temporary product-table rows. | Lifecycle A4.1: pre-test reset, ids captured from `RETURNING`, cleanup `WHERE id = ANY($1)`, three zero-count proofs (documents by id, chunks by `document_id`, name-prefix), baseline `0/0/0/1` restored. |
| AR8 | **(R-A2)** A failed assertion before A4.1.5 could leave fixture rows behind. | The cleanup lives in a `finally { }` block and runs unconditionally; A4.3 re-proves `0` from `psql` independently of the test process. |
| AR9 | **(R-A3)** `LIMIT $1 + 1` returns one row more than requested on every page. | The extra row is `pop()`ed before serialising; T-A2 asserts `results.length === 2` for `?limit=2`, so a leak is caught. |

### A6. OUT OF SCOPE — F3-A (follow-ups only)

- **FU-A1** `documents.updated_at` is never maintained (LA-6) — either write it or drop the column; needs a product decision.
- **FU-A2** `documents.sha256` has no `UNIQUE` constraint (carried from `f1/RESULT.md:46` [G]) — duplicates remain possible.
- **FU-A3** Missing index on `chunks(document_id)` (AR2).
- **FU-A4** No document deletion / access-policy edit UI — the Library is read-only and stays read-only.
- **FU-A5** Library `kind`/`status` values are free strings with no CHECK constraint (`db/schema.ts:9,13` [V]) — a typo'd kind would display verbatim. No enum work in this phase.
- **FU-A6** `web/src/app/dashboard/page.tsx:22` promises Library "browse ingested documents and access policies" — still accurate, unchanged.
- **FU-A7** `metadata` size cap at upload (AR5) — a large jsonb multiplies across a page.

### A7. OPEN QUESTIONS — F3-A *(all three ruled in round 1; recorded closed)*

| # | Ruling | Effect in this plan |
|---|---|---|
| **AQ1** | **Yes — `Previous` via a client-side cursor stack.** | Browser step 9; `library/page.tsx` holds `cursorStack: (string\|null)[]` + `pageIndex`. Same mechanism as C, no server change. |
| **AQ2** | **Keep `total`.** It is the only way to render "42 documents"; cheap on a small table. | §A3.3 keeps `total`; `T-A2` asserts `total === 5`. |
| **AQ3** | **Yes, public-schema fixture**, but it must be **idempotent**. | §A4.1 (pre-test `DELETE … LIKE 'p3a-%'`, ids captured, cleanup by id). |

### A8. CLIENT METHOD — `web/src/lib/api.ts`, A's block (exact, R-A5)

Added **immediately before** the `chat` method, in its own region. Nothing else in `api.ts` changes in A; `api.search` and `api.chat` are untouched (D4, NB-6).

```ts
export type LibraryRow = {
  id: string;
  name: string;
  kind: string;
  size_bytes: number | null;      // R-A4: a JSON number, not a string
  sha256: string;
  status: string;
  access_policy: string;
  metadata: Record<string, unknown>;
  chunk_count: number;
  created_at: string;
  updated_at: string;
  // NOTE: no source_path (A-D7). Do not add it "for debugging".
};

export type LibraryQuery = { limit?: number; cursor?: string | null };

export type LibraryPage = {
  results: LibraryRow[];
  total: number;
  limit: number;
  next_cursor: string | null;      // R-A3: null means "no further rows"
  // NOTE: no offset (R-A1). Do not add it.
};
```

and, inside the existing `export const api = { ... }` object:

```ts
library: {
  list: (q: LibraryQuery = {}) => {
    const p = new URLSearchParams();
    if (q.limit !== undefined) p.set("limit", String(q.limit));
    if (q.cursor !== undefined && q.cursor !== null) p.set("cursor", q.cursor);
    const qs = p.toString();
    return request<LibraryPage>(`/library${qs ? `?${qs}` : ""}`);
  },
},
```

Rules the Implementer must not violate: **no `offset` in `LibraryQuery` or `LibraryPage`**; the page passes `limit: 25` explicitly and **never** slices the returned array (`slice(` must not appear in `library/page.tsx`, T-A13); the page keeps `cursorStack: (string | null)[]` starting `[null]` with `pageIndex`, `Next` pushes `next_cursor` when non-null, `Previous` decrements `pageIndex` and re-requests with `cursorStack[pageIndex]`.

---

## PART F3-B — Backend audit logging (write side only)


> **Blocked until F3-A is PASS.** B does not touch `library.ts`, `api.ts`, any page, or `routes/audit.ts`.

### B1. CURRENT BEHAVIOUR (verified)

- `public.audit_log` exists with the six columns listed in §0.2 [V]; `detail` is `jsonb NOT NULL DEFAULT '{}'`; indexes are `audit_log_pkey(id)` and `audit_log_created(created_at DESC)`, **nothing on `action`/`actor`/`resource`** [V].
- **Nothing in `server/src` ever writes it.** `grep -rn "audit" server/src web/src` returns, besides the reader at `routes/audit.ts:10` and the schema DDL at `db/schema.ts:42-52`, only comments in `ingest/service.ts:47,208` and `ingest/types.ts:107` that use the word "audit" to mean "keep a copy of the extracted text" [V]. There is **no** `INSERT INTO audit_log` anywhere [V]. Matches `REQUEST.md:12` [G].
- **`auth.ts:9-33`** — a successful login returns `{token, user}` (`:28`) and writes nothing; a failed login returns `401` (`:23`) and writes nothing; a missing-field login returns `400` (`:13`) and writes nothing [V].
- **`ingest.ts:135-346`** — per-file outcomes are collected into `results`/`errors` (`:199-227`) and returned as `200`/`207`/`400` (`:237-246`); nothing is audited [V]. `ingestFile()` can resolve with `chunkCount: 0` for the **dedupe path** (`service.ts:142-145`) — a *successful* upload of already-known bytes is indistinguishable in the response from a fresh ingest except by `chunkCount` and a non-UUID `documentId` [V].
- **`search.ts:24-83`** — the query is validated (`:31`) and executed (`:41-65`); nothing is audited [V].
- **`chat.ts:8-10`** — a 202 stub; irrelevant to audit.
- **Logout is client-only.** `header.tsx:44-47` calls `clearSession()` then `router.replace("/login")` [V]; `api.ts` has **no** `logout` method (it was deleted in F2-B — `p2/RESULT.md:23` [G] records that `/api/auth/logout` never existed) [V]. There is **no server-side logout endpoint**.
- **There is no `requireAdmin`, no `role` column, and `authMiddleware` (`middleware/auth.ts:9-23`) attaches `{id, username, iat, exp}`** [V]. `admins` has `username, password_hash` only (`db/schema.ts:54-59` [V]).
- **There is no global request-id, no `AsyncLocalStorage`, and no correlation middleware** [V] (`app.ts:14-63` is the whole app).
- **Logging convention:** `app.ts`, `routes/search.ts:80`, `routes/library.ts:16`, `routes/audit.ts:16`, `routes/auth.ts:30` use bare `console.error`; `routes/ingest.ts` and `ingest/service.ts` use `utils/logger.ts` (JSON lines, `error` always emits, `utils/logger.ts:41-43` [V]). **Two idioms exist** — B must standardise on `logger` for anything it adds.

**The exact defects B must cure:**

| # | Defect | Evidence |
|---|---|---|
| **BA-1** | No write path at all → `audit_log` is permanently empty → any Audit UI is necessarily empty. | §B1 bullet 2 [V] |
| **BA-2** | Failed logins are silent: no record that someone tried `admin` with a wrong password. | `auth.ts:22-25` [V] |
| **BA-3** | Per-file upload failures are collected in the HTTP response but never persisted, so they vanish when the response is discarded. | `ingest.ts:219-227` [V] |
| **BA-4** | Searches are unrecorded — no way to answer "who looked for the salary document". | `search.ts:41-78` [V] |
| **BA-5** | `ingestFile`'s **dedupe success** (`chunkCount: 0`, `service.ts:142-145`) is indistinguishable from a real ingest in any log, so "was this document actually created" is unanswerable. | `service.ts:142-145` [V] |
| **BA-6** | No sanitiser exists anywhere, so nothing prevents a future `INSERT` from persisting a password or JWT. | no such module [V] |

### B2. ROOT CAUSE / DESIGN — B-specific decisions

**B-D1 — One module, three files: `server/src/audit/events.ts` (the taxonomy + types), `server/src/audit/sanitize.ts` (the pure allow-list sanitiser), `server/src/audit/log.ts` (the only code that writes `audit_log`).**
*Justification:* AC1 demands a single service with no duplicated INSERT SQL; the split puts the **pure** (sanitiser, taxonomy) apart from the **impure** (DB write) so the sanitiser is unit-testable with no DB and no server (`p2/RESULT.md:6-7` show how much test value the pure-module split bought in F2-B).
*Rejected:* a single `audit.ts` — the sanitiser would then be imported through a module that opens a DB pool at import time, making the unit test require a live DB.
*Rejected:* a class with injected deps — no DI container in this codebase (`db/index.ts:6` exports a module-level `pool` [V]); a plain exported function matches the house style.

**B-D2 — The write is `recordAudit(event, client?)` → `Promise<void>`, it **always resolves**, it **never throws synchronously**, and it logs a JSON line at `warn` when the INSERT fails. (R-B6)**
*Justification:* AC9 ("audit write failures are visible in the server log but never turn a successful business operation into a 500") and AC4's explicit requirement that fire-and-forget "MUST NOT be able to fail the business request". The `client?` optional param is the *only* thing that makes the "same transaction" reliability class implementable later without rewriting call sites — today **no call site passes one** (see B-D4).
*Exact body shape (R-B6 — the sanitiser calls are inside the `try`, because `sanitizeDetail` walks attacker-shaped values and a getter can throw):*
```ts
export function recordAudit(event: AuditEvent, client?: Queryable): Promise<void> {
  try {
    const actor    = event.action === 'auth.login.failure' ? null : sanitizeActor(event.actor);
    const detail   = sanitizeDetail(event.detail);          // may throw on a hostile getter
    const resource = sanitizeResource(event.resource);
    const db = client ?? pool;
    return db.query(B_SQL_1, [actor, event.action, resource, JSON.stringify(detail)])
      .then(() => undefined)
      .catch((err) => { logger.warn('[audit] write failed', { action: event.action, resource, err }); });
  } catch (err) {
    logger.warn('[audit] write failed', { action: (event as any)?.action, resource: null, err });
    return Promise.resolve();                                // total on the sync path
  }
}
```
*Rejected:* `void recordAudit(...)` with no internal catch — an unhandled rejection can crash Node when `--unhandled-rejections=throw` is set or become a silent swallow on older defaults; both are worse than an explicit catch.
*Rejected:* letting the caller decide (`recordAudit(...).catch(...)`) — AC1's point is that policy lives in one place.
*Rejected (R-B6):* `try { … } catch` around only the `pool.query` — a throwing `detail` getter (an object whose `get detail()` throws) would escape synchronously and 500 the business request.

**B-D3 — `actor` is derived from the **verified JWT** in the request context, never from the body; `null` when unknown; **login** is the only event allowed to carry a *candidate* actor, and that candidate goes through `sanitizeActor`.**
*Justification:* AC3. `authMiddleware` already puts the decoded payload on `req.user` (`middleware/auth.ts:18` [V]); call sites read `req.user?.username` — never `req.body.username`.
*Rejected:* reading `res.locals` — same idea, but `req.user` already exists and is typed (`AuthRequest`, `middleware/auth.ts:5-7` [V]).

**B-D4 — Reliability class: **after-successful-completion, fire-and-forget**, for **every** event in this phase.**
*Justification:* the alternatives each have a concrete flaw here:
  - *Same transaction as the business write* is **impossible for `ingest.upload.*`** without duplicating the INSERT: `documents`+`chunks` are committed inside `ingestionService.storeDocument()` (`service.ts:291-292` [V]) which owns its own `pg` client and `COMMIT`;  the route (`ingest.ts:204`) only sees the result. Threading a client through `service.ts` would be a change to the F1-cured pipeline — explicitly forbidden (`REQUEST.md:70`, `f1/RESULT.md:35-46` ingestion guarantees).
  - *Same transaction* is also **wrong for `auth.login.failure`**: there is no business write to be atomic with, and a failed login must not roll anything back.
  - *Await-before-respond* for the success events would add a second round trip to every upload/search and turn a `pool` exhaustion into a latency spike on the primary path.
  * Fire-and-forget satisfies AC4's stated wording verbatim.
*Stated cost, plainly (AC4 requires it): **a process crash between the business commit and the audit INSERT loses that audit row.** A crash between the search query and its audit row loses that too. **There is no compensating mechanism, no outbox, no replayer.** Audit is *not* a tamper-evident or exactly-once ledger in this phase — `REQUEST.md:55` puts tamper-evidence out of scope.
*Rejected:* an outbox table — a migration, and a replayer thread, and a whole reliability story that this phase does not need.

**B-D5 — Call sites are **explicit**, not a global response-hook middleware.**
*Justification:* a hook over `res.on('finish')` cannot know the *resource*, cannot tell dedupe-success from fresh ingest (BA-5), and would emit one event for a 10-file upload instead of ten. Explicit call sites keep the action↔route mapping auditable by reading three files.
*Rejected:* `app.use(auditMiddleware)` — see above.
*Rejected:* an Express `res.locals.audit` accumulator — state machine spread across the route with no compile-time check that it is populated.

**B-D6 — Action taxonomy: `namespace.entity.verb`, namespace ∈ {`auth`,`ingest`,`search`}, **exact closed set of 5 emitted strings** in this phase. (R-B3: this table now agrees cell-for-cell with §B3.4.)**

| `action` | When | `actor` | `resource` (exact expression) | `detail` |
|---|---|---|---|---|
| `auth.login.success` | `auth.ts` after `verifyPassword` returns true | `req.user?.username ?? null` — at this call site no token exists yet, so the value is the **verified** `row.username` (see the note under the table) | `sanitizeResource(\`admin:${attempted ?? 'unknown'}\`)` where `attempted = sanitizeActor(req.body.username)` | `{outcome:"success", attempted?}` |
| `auth.login.failure` | `auth.ts` catch/branch where `verifyPassword` fails (today `:22-25`) | `auth.login.failure` | `admin:<sanitized candidate>` | **`actor = NULL` by rule** — see below | `{outcome:'failure', reason:'invalid_credentials', attempted:<sanitized candidate>, user_known:<boolean>}` |
| `ingest.upload.success` | `ingest.ts` per file, after `ingestFile` resolves | `req.user?.username ?? null` | `document:<uuid>` if `result.chunkCount > 0`, else `document:sha256:<contentHash>` (dedupe — BA-5). Both are server-generated, so **no** `sanitizeResource` needed (still passed through it for uniformity) | `{outcome:"success", name, kind, access_policy, chunk_count, deduplicated:bool}` |
| `ingest.upload.failure` | `ingest.ts` in the per-file `catch` (`:217-229`) | `req.user?.username ?? null` | `sanitizeResource(\`upload:${sanitizeActor(file.originalname) ?? 'upload'}\`)` — **never** bare `file.originalname` | `{outcome:"failure", error:<message, capped>}` |
| `search.query` | `search.ts` after a successful query executes | `req.user?.username ?? null` | `\`search:${policy}\`` — `policy` is a validated literal from a closed set (`'*'`, `public`, `trusted`, `restricted`), not free text; no sanitiser needed | `{outcome:"success", q:<capped, truncation marker>, limit, returned}` |
| `auth.logout` | **RESERVED — never emitted** (B-D6 note below, FU-B2) | — | — | — |

**`auth.login.failure` actor rule (binding).** This event fires on a route with **no authenticated context**: `app.ts:51` mounts `/api/auth` without `authMiddleware`, so `req.user` is necessarily absent. Two consequences, both mandatory:
1. `actor` MUST be written as the **literal `null`** — not `req.user?.username ?? null`, which is the same value by accident and is forbidden by §B-D10a's rule that no actor may be derived from a possibly-absent context. The code MUST NOT reference `req.user` on this path at all.
2. The candidate username goes **only** into `detail.attempted` (via `sanitizeActor`, ≤64 chars) and `resource` (`admin:<candidate>`, via `sanitizeResource`, ≤200 chars). It MUST NOT be promoted to `actor`.
3. `detail.user_known` records whether the supplied username matched an existing admin row (`true`/`false`), computed from the same SELECT the login handler already performs (`auth.ts:17-21`) — **after** the password check has failed. This is the only non-credential signal that makes a failed-login row useful for triage without trusting caller input.

**AC3 restatement for this event (also binding).** AC3 says the actor must be derived from a verified JWT. For `auth.login.failure` there **is** no verified JWT, so the honest reading is: *the actor is explicitly `null` and the audit row must not claim one*. Every other event in the taxonomy derives `actor` from `req.user?.username` on a route that **does** mount `authMiddleware` (`app.ts:53-57`), and `T-B22` asserts that provenance against the decoded token's `sub`.

**The identity rule this table is written to (§B-D10a / C-1):** `actor` for every authenticated event is `req.user?.username`; the id is `req.user?.sub`. **`req.user.id` MUST NOT be referenced anywhere in B** (it is `undefined`).

*Why `auth.login.success` is the one row that does not literally read `req.user?.username`:* at that call site the request carries no token yet, so there is no `req.user` to read. The value written is the **verified** username — the `row.username` returned by the `SELECT … FROM admins WHERE username = $1` that `verifyPassword` just compared against (`auth.ts:18-26` [V]) — which is by construction the same string the JWT's `username` claim carries (`auth.ts:27` signs `username` from that row) and the same string a later `req.user.username` will be. It is **never** `req.body.username` raw: `req.body.username` is used *pre*-verification only, to build `attempted` / `resource`. `T-B22` asserts `actor === jwt.decode(token).username === <login response>.user.username` on a real minted token, so this row cannot silently degrade to `null` (the `req.user.id` trap, §B-D10a) or to an attacker-chosen string.

*R-B3 — why `sanitizeResource` exists at all:* two `resource` values are built from strings an unauthenticated caller chooses — `req.body.username` (pre-auth) and `file.originalname` (a multipart filename). Neither is length-capped by the route and both may contain control characters. `resource` is `text` (unbounded), is rendered by the C page, and has **no DELETE path** (AC8). `sanitizeActor` (64) + `sanitizeResource` (200) bound it; `sanitizeResource` is the resource-shaped cap so a future call site cannot remember the wrong limit.


*Why `auth.logout` is absent:* it is **not reliably observable**. `header.tsx:44-47` clears `localStorage` and navigates [V]; no request reaches the server. Faking it would mean either (a) emitting a client-side POST that the server records as "logout" even if the tab was closed instead, or (b) recording a logout the user never performed. AC3/`REQUEST.md:44` says a client-only logout "cannot be recorded and must NOT be faked". **Registered as FU-B2**, and the C page will not invent the row.
*Rejected:* adding `POST /api/auth/logout` to make it observable — that is a new endpoint and a new contract in a phase that forbids broad auth work; and its semantics would still be "best effort, client-initiated", i.e. a different reliability class for one event.
*Rejected:* `access_policy.change` / `document.delete` strings — **no such operations exist** (`grep` finds no UPDATE/DELETE of `documents` in `server/src` [V]); `REQUEST.md:45` says record as follow-up. → **FU-B3**.

**B-D7 — Failed-login actor is `null`, **not** the attempted username.**
*Justification:* `REQUEST.md:41` offers both and asks for a decision. The attempted username is fully attacker-controlled: it is not length-capped at the route, it may contain control characters, newlines (log-injection into any consumer that renders `actor`), or a 10 MB string (`express.json` limit is 1 MB, `app.ts:33` [V] — so up to 1 MB of attacker memory per row, per attempt, times every attempt). Storing it would let an **unauthenticated** caller write arbitrary content into a table that the app treats as authoritative and that has no DELETE path (AC8). The genuinely useful signal — "someone tried the username `admin` and failed" — is preserved in `resource` (`admin:<sanitised, 64-char-capped candidate>`) and the attempt count is preserved by row count.
*Rejected:* `actor = attemptedUsername` sanitised + capped — still lets an unauthenticated caller choose the value in the column the UI renders as "who did this", i.e. a spoofable audit trail. The 64-char cap fixes size but not *authorship*.
*Trade-off accepted:* "who tried to log in as `admin`" cannot be answered from `actor`; it is answered from `resource` **and** from `detail.attempted` (BQ1 ruling: the sanitised candidate is now also in the detail allow-list so the C UI can *render* it read-only). A reviewer who prefers the other reading changes **one line** in `auth.ts` and one row in T-B9 — stated so the decision is cheap to reverse.

**B-D8 — `detail` is built by an **allow-list** sanitiser (`sanitize.ts`), applied at the **write** side and unit-tested without a DB.**
*Justification:* AC3/AC6. An allow-list (drop unknown keys) is the only shape that survives future contributors adding `detail.targetPassword`. Deny-lists rot.
*Rejected:* sanitising only at read time (C) — the poisoned row would already be in the table, and the DB is the thing that must not hold a JWT.

**B-D9 — ~~Two new indexes~~ **DELETED in round 1 (NQ1). No index is created, `db/schema.ts` is not touched.****
*Ruling (NQ1):* Drop the two new audit indexes (`audit_log_action_created`, `audit_log_actor_created`) from phase 3. With `audit_log` at 0 rows [V] and a closed-set filter on the existing `audit_log_created (created_at DESC)` index, there is no measured need; AC10 asks for justification; and `server/src/db/schema.ts` is a baseline-guarded product file. **Recorded as FU-B10** (`CREATE INDEX CONCURRENTLY` when volume justifies it, with an `EXPLAIN` against a populated table as the justification — not intuition).
*Consequence for C, stated:* C's filtered queries may scan the newest rows and filter. That is acceptable at 0 rows and is the price of not doing an unjustified migration. `T-B16` (index existence) is **removed**; there is no DDL to test.
*Rejected:* `CREATE INDEX CONCURRENTLY` inside `pool.query(SCHEMA)` — it cannot run inside the implicit transaction anyway (moot now).

**B-D10 — `requireAdmin` seam: an exported middleware that **rejects a request with no verified `req.user`** and otherwise allows every verified JWT; mounted **only** on the explicit `auditRouter` in C. (R-B1)**
*Justification:* `REQUEST.md:48` prefers "the smallest change that does not weaken anything and say what it costs". Option (a) — document + explicit seam — is that. **(R-B1) The one behaviour it does enforce is "there must be a verified principal".** A bare `next()` with no `req.user` guard makes the mount a **bypass** whenever the router is reached without `authMiddleware` having set `req.user` — e.g. a test harness or a future mount that forgets the middleware. Rejecting on missing `req.user` turns "forgot the auth middleware" from an **admin bypass** into a **403**. That is strictly safer and costs 4 lines.
*What it still does NOT do, stated:* it does not distinguish one authenticated admin from another — `admins` has no `role` column, so every authenticated caller is an admin and the `403` branch is **unreachable through the real mount** (CQ1 ruling accepts that, because the UI branch is proven by a *pure* function, `describeError`, not by a stubbed scope).
*Rejected:* option (b), a `role` column — a migration, an `admins` backfill, a JWT claim change (the JWT would need to carry `role`, else every request re-reads the DB), and a re-login for every existing session. All for a distinction with one value. → **FU-C1**.
*Why B defines it and C mounts it:* B owns the authorisation *decision* (AC5), C owns the *route*. Defining it in B (`server/src/middleware/require-admin.ts`) and mounting it in C's rewrite of `routes/audit.ts` keeps B's write-side tests independent of the reader.

**B-D10a — Identity is asserted from the token payload, and `sub` is the only identifier.** `auth.ts:27` signs `{ sub: row.id, username }`; `middleware/auth.ts:19-20` assigns that payload to `req.user` while typing it `{ id, username }`. Therefore **`req.user.id` is `undefined` at runtime** and **`req.user.sub` is the authoritative id**. B must derive the actor's id as `req.user?.sub` and the actor's username as `req.user?.username`. No change to `auth.ts`, `middleware/auth.ts`, `db/schema.ts` or the token shape is made in phase 3; fixing the `{id}` cast is recorded as **FU-C1**.
*(Evidence — proven at runtime, not merely read: the login response contains `user.id = 0eabfa84-…`, but `jwt.decode(token)` yields keys `['sub','username','iat','exp']` — `payload.sub = 0eabfa84-…`, `payload.id = undefined`. `middleware/auth.ts:19-20` assigns that payload to `req.user` while typing it `{ id, username }`, so `req.user.id === undefined` at runtime. [G] `B-C-CLOSURE.md:18`.)*

**B-D10b — The `403` decision, recorded once so it cannot drift (RC-B/1 point 2).** Round 1's mandate for `requireAdmin` said **`401`** ("a missing principal is an authentication failure"). This plan chooses **`403 {"error":"Forbidden"}`** and **that choice supersedes the round-1 `401` mandate**; it is decided here and propagated verbatim to §B3.6 (the body), §B4.3 `T-B23`, §C3.4's error table, §C3.7, `T-C9`, `T-C10`, §C5 CR3/CR6 and §C7 CQ1. **No other status code appears anywhere in the plan for this branch.** Rationale for choosing `403`: the branch is reached *after* `authMiddleware` in the mount, so on the real mount the only way to reach it is a mount that skipped authentication entirely — a refusal of access, not a failed credential exchange — and `403` keeps the wire body identical to what `req.user`-present-but-not-admin would eventually return under FU-C1 (so the day a `role` column lands, the status does not change).

### B3. EXACT CONTRACTS — F3-B

**B3.1 Module surface (binding; names and signatures are the contract).**

```ts
// server/src/audit/events.ts
export const AUDIT_ACTIONS = [
  'auth.login.success',
  'auth.login.failure',
  'ingest.upload.success',
  'ingest.upload.failure',
  'search.query',
  // 'auth.logout' — RESERVED, never emitted (§B-D6)
] as const;
export type AuditAction = typeof AUDIT_ACTIONS[number];

export type AuditOutcome = 'success' | 'failure';

export interface AuditEvent {
  action: AuditAction;
  actor: string | null;      // verified-JWT username, or null (auth.login.failure)
  resource: string | null;   // stable identifier string, see §B-D6
  detail: Record<string, unknown>;  // pre-sanitisation; sanitizeDetail() runs inside recordAudit
}

// server/src/audit/sanitize.ts  — PURE, no imports from db, express, or config
// (NQ2) There is NO `sanitizeDetailDenyOnly` export. The deny set is tested
// through the public function by injecting a widened allow-list (T-B3).
export function sanitizeDetail(
  raw: unknown,
  allowList?: readonly string[],   // test seam only; default = DISPLAY_ALLOW_LIST
): Record<string, unknown>;
export function sanitizeActor(raw: unknown): string | null;
export function sanitizeResource(raw: unknown): string | null;   // R-B3
export function truncate(s: string, max: number): string;

// server/src/audit/log.ts
// (R-B6) recordAudit NEVER throws synchronously and NEVER rejects: the whole body —
//   including the sanitizeDetail/sanitizeActor/sanitizeResource calls — is inside
//   try { … } catch (err) { logger.warn('[audit] write failed', { action, resource, err }) }
//   and the pool.query(...) call carries its own .catch(...) with the same log line.
export function recordAudit(event: AuditEvent, client?: { query: (t: string, v?: unknown[]) => Promise<unknown> }): Promise<void>;

// server/src/middleware/require-admin.ts  (defined by B, mounted by C — §B3.6)
export function requireAdmin(req: Request, res: Response, next: NextFunction): void;
```

**The five exported surfaces are the whole of B's new code surface.** No other module in `server/src` may import `pg` for the purpose of writing `audit_log`, and `AUDIT_ACTIONS` is the only declaration of the taxonomy (§B3.3). The call sites in §B3.4 import **only** `recordAudit`, the three sanitisers, and (C) `requireAdmin`.

**The one identity rule, restated here because it is the contract every call site depends on (§B-D10a):**

> `actor` for every authenticated event is `req.user?.username`; the id is `req.user?.sub`. **`req.user.id` MUST NOT be referenced anywhere in B** (it is `undefined`).

**B3.2 Sanitiser rules (exact, testable).**

`sanitizeDetail(raw, allowList?)`:
1. Non-object (incl. `null`, array, string, number, `Date`) → `{}`.
2. **Allow-list keys only** — a key not in the set is **dropped silently**:
   `outcome, reason, name, kind, access_policy, chunk_count, deduplicated, error, q, limit, returned, policy, bytes, duration_ms, attempted`.
   (`attempted` added per **BQ1** so the UI can *render* the attempted username read-only; it is sanitised by `sanitizeActor` before it is put in `detail`.)
   `allowList` (2nd param) defaults to the constant above; it exists **only** so T-B3 can inject a widened list and prove the deny set independently (NQ2). No production call passes it.
3. `outcome` must be exactly `'success'` or `'failure'`; anything else → key dropped (never coerced).
4. Strings: **capped at 200 chars** (`truncate`), with the literal suffix `'…'` (U+2026) appended **only when truncation happened**, so `q` of 500 chars is stored as 200 chars + marker and a consumer can tell.
5. Numbers: kept only if finite; `NaN`/`Infinity` → dropped. Booleans/`null` kept.
6. Nested objects/arrays → **never recursed**; the key is dropped. (Flat by construction: a nested blob is how a JWT would sneak in.)
7. **Forbidden-key deny set, belt-and-braces**, evaluated *before* the allow-list and hard-failing the whole object to `{}` if present: `password, token, jwt, authorization, auth, secret, cookie, text, content, body, extract, prompt`. This is redundant with rule 2 by design — a reviewer can delete the allow-list rule and the deny set still holds.
   **N-7a (amendment, 2026-11-03 — reconciles this rule with rule 2 and with the shipped code).** Rules 2 and 7 conflict for exactly nine key names that rule 2 *permits* and this rule *forbids*: `text, content, body, extract, prompt, auth, cookie, secret, jwt`. The resolution is a **two-tier** rule, and it is the implemented one:
   - **Tier 1 — truly forbidden (hard-fail to `{}`):** `password, token, authorization`. These can only ever carry a credential verbatim; their presence invalidates the whole object.
   - **Tier 2 — permitted by name, sanitised by value:** the nine keys above are accepted **only** for a flat scalar value that passes the same cap/type rules as any other field, because they are ordinary words in operational messages (an upload error mentioning "token budget" is legitimate and must not be erased).
   `sanitizeSubject(raw)` follows the same two tiers, except that `text`/`content`/`body`/`extract`/`prompt` are **always dropped for the corpus column** (they carry generated bodies by definition) while remaining permitted for `detail`.
   **T-B1 must assert the plan's literal object**, with both tiers exercised explicitly: `{outcome:'success', password:'p'}` → `{}` (tier 1), `{outcome:'success', text:'…'}` → retained scalar (tier 2), and `{outcome:'success', name:'x'}` → `{outcome:'success', name:'x'}`. A test that removes the failing keys from its own fixture to pass is not a gate.

`sanitizeActor(raw)`:
- `null`/`undefined` → `null`; non-string → `null`.
- Strip C0 and C1 control characters (`\u0000-\u001F`, `\u007F-\u009F`) **and** `\u2028`/`\u2029`.
- `trim()`; if empty → `null`.
- Cap at **64** chars *without* a marker (an actor is an identity, never evidence about length).
- **No other transformation** — `sanitizeActor` must not lowercase (usernames are case-sensitive in `admins.username = $1`, `auth.ts:18` [V]).

`sanitizeResource(raw)` — **NEW (R-B3). Applied to every `resource` built from an attacker-controlled string.**
- `null`/`undefined` → `null`; non-string → `null` (never `String(raw)`, which would stringify an object).
- Strip the **same** control-character set as `sanitizeActor` (`\u0000-\u001F`, `\u007F-\u009F`, `\u2028`, `\u2029`).
- `trim()`; if empty → `null`.
- Cap at **200** chars **without** a marker (same reasoning as the actor: a marker on an identifier is noise, and the cap is the security property, not the ellipsis).
- **No other transformation** — no lowercase, no prefix rewriting; the `admin:` / `upload:` / `document:` prefixes are added by the **call site**, before sanitising, and survive because none of these characters are control characters.
- Implementation is `truncate(stripControls(s), 200)`; `stripControls` is shared with `sanitizeActor` (one private helper, two exports).
- *Why 200 and not 64:* `resource` legitimately carries `document:<uuid>` (45 chars) and `document:sha256:<64 hex>` (80 chars); 64 would truncate a real identifier. 200 is under the `ILIKE`/`text` cost boundary and above every legitimate shape.

**B3.3 SQL — copy-pasteable. The **only** `INSERT INTO audit_log` in `server/src`.**

```sql
-- B-SQL-1: recordAudit(). $1 actor text|null, $2 action text, $3 resource text|null, $4 detail jsonb
INSERT INTO public.audit_log (actor, action, resource, detail)
VALUES ($1, $2, $3, $4::jsonb)
RETURNING id, created_at
```

```sql
-- B-SQL-2: DELETED IN ROUND 1 (NQ1).
-- The two proposed indexes (audit_log_action_created, audit_log_actor_created) are
-- DROPPED from phase 3. audit_log has 0 rows [V], the existing audit_log_created
-- (created_at DESC) index already serves the default newest-first page, and
-- server/src/db/schema.ts is a baseline-guarded product file. Recorded as FU-B10
-- (CREATE INDEX CONCURRENTLY when volume justifies it). B therefore makes NO DDL.
```
**B makes no DDL at all.** The only SQL B adds to the product is `B-SQL-1`. `server/src/db/schema.ts` is **not touched by any part of phase 3** (see §F1).

**No UPDATE and no DELETE of `audit_log` may exist anywhere in `server/src`** (AC8) — the test `T-B9` greps for it, and B adds no route, so there is nothing to mount. Revoking `UPDATE, DELETE` at the DB role level is **out of scope and dangerous** (the role is shared with migrations) → **FU-B4**.

**B3.4 Call-site contracts (what each route passes).**

`server/src/routes/auth.ts` — after the existing `verifyPassword` check (R-B3: every `resource` goes through `sanitizeResource`; BQ1: `attempted` is carried in `detail`):

```ts
// `username` is req.body.username — attacker-controlled, pre-auth. NEVER stringified raw.
const attempted = sanitizeActor(username);          // 64-char cap, controls stripped
// auth.ts already ran:  const row = q.rows[0];            // :18-21
//                       const ok  = await verifyPassword(password, row.password_hash);   // :22
// success (after `ok` is true, before res.json). `row` is the SELECT's row — in scope, verified.
void recordAudit({
  action: 'auth.login.success',
  // §B-D10a: the VERIFIED username from the SELECT at auth.ts:18 — the same string the JWT's
  // `username` claim carries (:27). NOT req.body.username, NOT req.user.id (undefined), NOT req.user?.sub.
  actor: row.username,
  resource: sanitizeResource(`admin:${attempted ?? 'unknown'}`),
  detail: { outcome: 'success', attempted: attempted ?? undefined },
});
// failure (the existing 401 branch)
void recordAudit({
  action: 'auth.login.failure',
  actor: null,                                      // §B-D7 / R4-B/1 — literal null, BY RULE.
                                                    // `req.user` MUST NOT be referenced on this path:
                                                    // app.ts:51 mounts /api/auth without authMiddleware,
                                                    // so `req.user?.username ?? null` is an accidental null
                                                    // and is forbidden by §B-D10a.
  resource: sanitizeResource(`admin:${attempted ?? 'unknown'}`),
  detail: { outcome: 'failure', reason: 'invalid_credentials',
            attempted: attempted ?? undefined,
            user_known: row !== undefined },        // computed AFTER the password check failed:
                                                    // the SELECT at auth.ts:17-21 already ran, so
                                                    // `row` present ⇔ username matched an admin row
});
```
`sanitizeDetail` drops an `undefined` value (rule 5/1), so a `null` `attempted` yields no key rather than the string `"undefined"`.
The `400` branch (`auth.ts:12-15`, missing field) emits **nothing** — it is not a credential attempt, it is a malformed request, and auditing it lets an unauthenticated caller fill the table with 4-byte rows.

`server/src/routes/ingest.ts` — inside the per-file loop (`ingest.ts:202-235`; the success branch is the code just above `results.push(result)` at `:218`, the failure branch is the existing `catch` at `:219`):
```ts
// success, after ingestFile resolves
const fresh = result.chunkCount > 0;
void recordAudit({
  action: 'ingest.upload.success',
  actor: req.user?.username ?? null,
  resource: fresh ? `document:${result.documentId}`
                  : `document:sha256:${result.contentHash}`,   // dedupe: documentId IS the content hash
  detail: { outcome: 'success', name: result.name, kind: result.kind,
            access_policy: result.accessPolicy, chunk_count: result.chunkCount,
            deduplicated: !fresh },
});
// failure, inside the existing catch, before pushing to `errors`
// (R-B3) file.originalname is attacker-controlled: sanitiseActor caps at 64 and strips
// controls, then sanitizeResource applies the 200-char resource cap. Never bare.
void recordAudit({
  action: 'ingest.upload.failure',
  actor: req.user?.username ?? null,
  resource: sanitizeResource(`upload:${sanitizeActor(file.originalname) ?? 'upload'}`),
  detail: { outcome: 'failure', error: String(fileErr?.message ?? 'Ingestion failed') },
});
```
`fresh` is `result.chunkCount > 0`; a **dedupe** hit therefore produces `document:sha256:<hash>` with `deduplicated: true`, and a **zero-chunk fresh ingest** produces `success` with `chunk_count: 0` and `deduplicated: false` (**BQ3 ruling**, asserted by T-B10c).
Requests **rejected before the loop** (401 at `ingest.ts:141-145`, no files at `:149-152`, bad metadata at `:170`/`:176`, bad policy at `:188`, multer/terminal errors from `:276` onward) emit **nothing**. Rationale: they are transport/validation failures with no per-file identity; auditing them would let an unauthenticated caller write rows (`:141` is pre-auth) and would need a second taxonomy. Follow-up **FU-B5**.

`server/src/routes/search.ts` — after the query resolves, just before `res.json`:
```ts
void recordAudit({
  action: 'search.query',
  actor: req.user?.username ?? null,
  resource: `search:${policy}`,               // '*' when unspecified
  detail: { outcome: 'success', q, limit: limitN, returned: results.length },
});
```
A `400` (blank `q`, `search.ts:31-34`) emits nothing (not a query). A `500` from the DB emits nothing — **stated**, because "search failures are invisible in the audit log" is a real gap → **FU-B6**.

**B3.6 `requireAdmin` — the body, owned by B, mounted by C (`server/src/middleware/require-admin.ts`).**

```ts
// server/src/middleware/require-admin.ts   (NEW, B)
import { Request, Response, NextFunction } from 'express';

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  // Today every authenticated caller IS an admin (admins has no role column), so the only
  // thing this can enforce is "a verified principal exists".
  // R-B1: WITHOUT this guard, a router reached without authMiddleware would be a bypass.
  // §B-D10a: the principal's identity is req.user.username; the id is req.user.sub.
  if (!req.user) {                       // authMiddleware always sets req.user on success
    res.status(403).json({ error: 'Forbidden' });   // §B-D10b — the ONLY status for this branch
    return;
  }
  // This seam exists so a future role column has one place to be enforced (FU-C1).
  // It must run AFTER authMiddleware, which is what sets req.user.
  next();
}
```

**Binding properties of this body (each is a test row):**
1. **Missing `req.user` ⇒ `res.status(403)` and `res.json({error:'Forbidden'})`, and `next` is NOT called** (`T-B23`).
2. **`req.user = { username: 'admin' }` (no `id` key at all) ⇒ `next()` called exactly once** (`T-B23`). This is the regression guard for §B-D10a: a body written against `req.user.id` would 403 a real, authenticated admin.
3. It performs **no DB read**, sets **no** `res.locals`, and mutates **nothing** on `req`.
4. It must be imported and mounted **only** by C's `routes/audit.ts` (§C3.1). B does not mount it; B's own routes are untouched (`T-B15b`'s call-site count is unaffected).
5. No other file may import it (§F1 lists the file under B, and `app.ts` under C only for the mount in C's rewrite of the audit router).

**B3.5 Response shapes of existing endpoints: UNCHANGED.** B adds no field, no header, no status code to `/api/auth/login`, `/api/ingest/*`, `/api/search`. `T-B13` asserts it.

### B4. TEST STRATEGY — F3-B *(test matrix rewritten in round 1: R-B3, R-B4, R-B5, R-B6, NQ2)*

#### B4.1 Fixture lifecycle — `server/src/__p3b__/audit-write.test.ts`

The test owns every row it creates and every id it deletes. **No pattern-only deletion, no `psql -f` seed, no id-file.**

| Step | Action | Assertion before proceeding |
|---|---|---|
| **B4.1.1 snapshot** | `const pre = await q('SELECT count(*)::int AS c, coalesce(max(id::text), \'\') AS max_id FROM public.audit_log')` → `PRE_COUNT = pre.c` | `PRE_COUNT` is a number; recorded in the log line |
| **B4.1.2 run** | every event is produced through **real HTTP** against `:4000` (login, upload, search) | — |
| **B4.1.3 capture ids** | for each asserted event, the row is located with `SELECT id FROM public.audit_log WHERE created_at >= $TEST_START AND (resource LIKE 'p3b%' OR resource IN ('admin:admin') OR resource LIKE 'search:%' OR resource LIKE 'admin:%') AND id::text >= $PRE_MAX_ID ORDER BY created_at` — `$TEST_START = now()` captured **before** B4.1.2 — and the ids are pushed into `CREATED_IDS` | `CREATED_IDS.length` equals the number of events the test expects (accumulated per assertion, listed in B4.2) |
| **B4.1.4 cleanup** | `DELETE FROM public.audit_log WHERE id = ANY($1::uuid[]);` with `CREATED_IDS` | `SELECT count(*) FROM public.audit_log WHERE id = ANY($1)` ⇒ `0` |
| **B4.1.5 verify** | `SELECT count(*) FROM public.audit_log` | **equals `PRE_COUNT`** — *not* "restored to 0". This is the R-B5 correction: `audit_log` may legitimately hold rows from other work, and the proof is that **this test removed exactly what it added**. |

`CREATED_IDS` is built from rows the test itself reads back by `(created_at >= TEST_START, id >= PRE_MAX_ID)` **and** an expected-resource predicate — never from an unbounded pattern, and never from "everything after the snapshot", which would sweep another process's rows.

Fixtures created outside `audit_log`, each with its own id-based teardown:

| Fixture | Created by | Captured | Teardown |
|---|---|---|---|
| `p3b-audit-probe.txt` — **≥ 40 words** (`Array.from({length:60},(_,i)=>'p3b-w'+i).join(' ')`) so `chunkCount === 1` (R-B5) | `POST /api/ingest/upload` (multipart) | `documentId` from the response | `DELETE FROM public.documents WHERE id = $1` (chunks cascade) |
| same bytes, second upload (dedupe probe) | same route | — (no new document) | — |
| `p3b-empty.txt` — whitespace only, 0 chunks (BQ3 probe) | same route | `documentId` | `DELETE … WHERE id = $1` |

#### B4.2 Unit, no DB, no server — `server/src/__p3b__/sanitize.test.ts`

`npx tsx`, Node `assert`; imports **only** `audit/sanitize.ts` **and** `audit/events.ts` (for `T-B21`; `events.ts` imports nothing, so the unit file still needs no DB and no server).

| ID | Assertion (exact) |
|---|---|
| **T-B1** | `sanitizeDetail({outcome:'success', name:'x', password:'hunter2', token:'eyJ…', authorization:'Bearer x', jwt:'a', secret:'s', text:'lorem', content:'c', body:{}, prompt:'p', note:'n', extract:'e', cookie:'c', auth:'a'})` deep-equals `{outcome:'success', name:'x'}` — deep-equal, not subset. |
| **T-B2** | `sanitizeDetail({q:'a'.repeat(500)}).q.length === 201` and ends with `'…'`; `sanitizeDetail({q:'a'.repeat(200)}).q.length === 200` and does **not** end with `'…'`; `sanitizeDetail({error:'a'.repeat(900)}).error.length === 201`. `sanitizeActor('  ' + 'a'.repeat(200))` → `length === 64` **and no `'…'`**; `sanitizeActor(null) === null`; `sanitizeActor(undefined) === null`; `sanitizeActor(42) === null`; `sanitizeActor('a\nb\tc\u2028d') === 'abcd'` (controls stripped, **not** replaced) — assert the exact string, so a stray replacement char fails the test. |
| **T-B3** | **(NQ2)** The deny set holds **through the public function with a widened allow-list**: `sanitizeDetail({password:'x', token:'y', outcome:'success'}, ['outcome','password','token'])` deep-equals `{}` — the deny set wins over an allow-list that permits the keys. And `sanitizeDetail({outcome:'success', note:'n'}, ['outcome','note'])` deep-equals `{outcome:'success', note:'n'}` — proving the injected list is honoured when nothing forbidden is present (otherwise the first half of the test would pass for the wrong reason). **No `sanitizeDetailDenyOnly` export exists**; `assert(!('sanitizeDetailDenyOnly' in mod))`. |
| **T-B4** | `sanitizeDetail({outcome:'success', meta:{token:'x'}})`: `token` is not present anywhere (`JSON.stringify(...).includes('token') === false`); `sanitizeDetail({outcome:'success', meta:'s'})` deep-equals `{outcome:'success'}` (unknown scalar key dropped). |
| **T-B5** | `sanitizeDetail({outcome:'SUCCESS'})`, `({outcome:1})`, `({outcome:null})` each deep-equal `{}` — `outcome` dropped, never coerced. |
| **T-B6** | `sanitizeDetail(null)`, `(undefined)`, `('str')`, `([1,2])`, `(new Date())` each deep-equal `{}`. |
| **T-B19** | **(R-B3)** `sanitizeResource('a\nb\u2028c' + 'x'.repeat(300))` ⇒ `/^abcx+$/` is **false** for controls (no `\n`, no `\u2028`; `assert(!/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/.test(out))`), `out.length === 200`, **no `'…'` marker**; `sanitizeResource(null) === null`; `sanitizeResource({}) === null`; `sanitizeResource('   ') === null`; `sanitizeResource('document:sha256:' + 'a'.repeat(64))` unchanged (80 chars, under the cap). |
| **T-B20** | **(AC1, static)** One central service: `grep -rn 'INSERT INTO public.audit_log' server/src --include='*.ts'` ⇒ **exactly 1** line, and that line is in `server/src/audit/log.ts`; `grep -rln 'audit_log' server/src/routes` ⇒ **0** files (no route builds the SQL itself); `grep -rn 'recordAudit' server/src/routes` ⇒ the 5 call sites of §B3.4 and nothing else. Run from the repo root; `server/src/__p3b__/` and `server/src/__p3c__/` are filtered out (the tests legitimately read the table). |
| **T-B21** | **(C-1 / NB-B1)** Taxonomy closure: `assert(!AUDIT_ACTIONS.includes('auth.logout'))` — and, so the assertion cannot pass by an empty array, `assert.deepEqual([...AUDIT_ACTIONS], ['auth.login.success','auth.login.failure','ingest.upload.success','ingest.upload.failure','search.query'])` (exact list, exact order). |

#### B4.3 Integration, real server + real DB — `server/src/__p3b__/audit-write.test.ts`

`npx tsx`, `fetch` against `:4000`, fixture per B4.1.

| ID | Assertion (exact) |
|---|---|
| **T-B7** | **Mutation gate — `auth.ts`.** With `auth.ts` reverted (neither login call site present), a valid `POST /api/auth/login` creates **`PRE_COUNT`** rows, i.e. `+0`. Test **FAILS** on the reverted tree, passes after. |
| **T-B7b** | **(R-B4) Mutation gate — `ingest.ts`.** With `ingest.ts` reverted, `POST /api/ingest/upload` of `p3b-audit-probe.txt` creates **`+0`** rows. Fails on the reverted tree, passes after. |
| **T-B7c** | **(R-B4) Mutation gate — `search.ts`.** With `search.ts` reverted, `POST /api/search {"q":"p3b"}` creates **`+0`** rows. Fails on the reverted tree, passes after. |
| **T-B8** | Valid login (username `admin`, correct password) → **exactly 1** new row; frozen object `{action:'auth.login.success', actor:'admin', resource:'admin:admin', detail:{outcome:'success', attempted:'admin'}}`. `JSON.stringify(detail).indexOf(token) === -1`; `JSON.stringify(detail)` has no `password` key. Token printed only as `<token:N chars>`. |
| **T-B9** | **(R4-B/1)** Bad password → **1** new row `{action:'auth.login.failure', actor:null, resource:'admin:admin', detail:{outcome:'failure', reason:'invalid_credentials', attempted:'admin', user_known:true}}`. Bad username `p3b-nosuch` → **1** new row with `actor === null`, `resource === 'admin:p3b-nosuch'`, `detail.attempted === 'p3b-nosuch'`, `detail.user_known === false`. **Two parts, both required:** (1) the written `audit_log` row for a bad-password login has `actor IS NULL` (**not** the attempted username), asserted on the **DB row**, not just the JSON; (2) a **source-level / behavioural** assertion that the code path for this event contains **no** `req.user` reference — a unit test calls the **real** handler with a request object whose `user` getter **throws**, proving it is never touched (the getter-throws form is preferred: behavioural, not textual; if the Implementer cannot construct it, the fallback is `grep -c 'req\.user'` counted **inside the failure branch only** ⇒ `0`). |
| **T-B9b** | **(R4-B/1, new — negative control)** A **successful** login writes `actor === 'admin'`, taken from `row.username` (§B-D10a), **not** `null`. With `T-B9` this proves the failure path's `null` is **deliberate** rather than a copy of the success path with a missing field. |
| **T-B10** | **(R-B5)** Upload `p3b-audit-probe.txt` (≥40 words → `chunkCount === 1`) → 1 new row `{action:'ingest.upload.success', actor:'admin', detail:{outcome:'success', name:'p3b-audit-probe.txt', kind:'txt', chunk_count:**1**, deduplicated:**false**}}`, `resource` matches `/^document:[0-9a-f-]{36}$/`. **`chunk_count === 1`, not `> 0`.** |
| **T-B10b** | **(BQ2 / R-B2)** Re-upload the **same bytes** → a second row with `resource` matching `/^document:sha256:[0-9a-f]{64}$/`, `detail.deduplicated === true`, `detail.chunk_count === 0`. **And the business response is unchanged**: status `200`, body keys exactly `['results','errors']`, `results[0].chunkCount === 0`. This is the *real-HTTP* half of the AC9 proof (the audit write cannot alter the response). |
| **T-B10c** | **(BQ3)** Upload `p3b-empty.txt` (whitespace only → 0 chunks, **fresh**, not dedupe) → 1 row `action === 'ingest.upload.success'`, `detail.chunk_count === 0`, `detail.deduplicated === false`. Proves BQ3's ruling: zero-chunk fresh ingest is `success`, **not** a 7th action. |
| **T-B11** | Upload a junk `.docx` (`Buffer.from('not a zip')`) → 1 row `ingest.upload.failure`, `detail.outcome === 'failure'`, `detail.error` non-empty and `length <= 201`; `JSON.stringify(detail).includes('password') === false` and `.includes('token') === false`. HTTP status is `207` with `errors.length === 1` (business path unchanged). |
| **T-B12** | `POST /api/search {"q":"p3b"}` → 1 row `{action:'search.query', actor:'admin', resource:'search:*', detail:{outcome:'success', q:'p3b', limit:<echoed>, returned:<n>}}`. Blank `q` → `400` and **`+0`** rows. |
| **T-B13** | **Response shapes unchanged**: `/api/auth/login` body keys exactly `['token','user']`; `/api/search` body keys exactly `['query','limit','results']`; `/api/ingest/upload` body keys exactly `['results','errors']` on 200. |
| **T-B14** | **(AC9, seam proof — R-B6, BQ2)** No DB trigger, no DDL. Three parts, all in-process: (a) `await recordAudit(evt, { query: () => Promise.reject(new Error('boom')) })` **resolves** (does not reject) and `logger.warn` was called once with a first arg starting `'[audit] write failed'`; (b) **`assert.doesNotThrow(() => recordAudit(evilEvent))`** where `evilEvent = { action:'search.query', actor:null, resource:'search:*', get detail() { throw new Error('boom') } }` — the *synchronous* path is total (R-B6); (c) a 3-line fake Express handler that executes `void recordAudit(evt, failingClient); res.json({ok:true})` records that `res.json` ran. |
| **T-B15** | **No mutating SQL**: `grep -rnE "UPDATE\s+(public\.)?audit_log|DELETE\s+FROM\s+(public\.)?audit_log" server/src` → **0 lines** when `__p3b__/` and `__p3c__/` are excluded (the tests legitimately clean up by id). |
| **T-B15b** | **(BQ2 / R-B2) Static AC9 structural check**: `grep -rn "void recordAudit(" server/src/routes` → **exactly 5** matches, one per emitted event (2 in `auth.ts`, 2 in `ingest.ts`, 1 in `search.ts`); `grep -rn "await recordAudit(" server/src/routes` → **0** matches (no call site awaits, so no audit latency on the business path). |
| **T-B16** | **(NQ1) REMOVED.** There is no index to test; `db/schema.ts` is unmodified and the baseline row for it must stay `OK`. |
| **T-B17** | `recordAudit` with a `detail` carrying a 10 MB string → resolves; the stored row's that-key value is ≤ 201 chars; the process does not OOM. |
| **T-B22** | **(C-1)** *Actor identity from the token, not from a phantom `id`.* Mint a token with the real `POST /api/auth/login` (username `admin`, correct password), then upload `p3b-audit-probe.txt` with that bearer and read back the `ingest.upload.success` row. Assert **all three** of: `row.actor === 'admin'`; `row.actor === jwt.decode(token).username`; `row.actor === loginBody.user.username`. Also assert `jwt.decode(token).id === undefined` (records the trap) and `jwt.decode(token).sub === loginBody.user.id` (proves `sub` is the id). **Discriminates:** an implementation that wrote `req.user.id` produces `null` (→ `sanitizeActor(undefined)` → `null`), so `row.actor === 'admin'` fails. |
| **T-B23** | **(C-1 — B's own AC5, gated in B)** `requireAdmin` unit, no server: (a) `requireAdmin({} as any, fakeRes, nextSpy)` with `req.user === undefined` → `fakeRes.status` called **once** with `403`, `fakeRes.json` called with `{error:'Forbidden'}` **exactly** (deep-equal), and `nextSpy` **not** called; (b) `requireAdmin({ user: { username: 'admin' } } as any, fakeRes, nextSpy)` (**no `id` key**) → `nextSpy` called **once**, `fakeRes.status` **not** called. `fakeRes` is a 4-line stub recording `status`/`json`; no network, no DB. |

#### B4.4 Commands (exact; repo root `D:\Develop\knowledge-app`)

```bash
cd server && npx tsc --noEmit                                   # exit 0
cd server && npx tsx src/index.ts > ../.pipeline/p3/f3b-server.log 2>&1 &
cd server && npx tsx src/__p3b__/sanitize.test.ts                # T-B1..T-B6, T-B19, T-B21 (no DB)
cd server && npx tsx src/__p3b__/audit-write.test.ts             # T-B7..T-B15, T-B15b, T-B17, T-B22, T-B23
DBURL=$(grep -E '^DATABASE_URL=' server/.env | cut -d= -f2- | tr -d '\r')
"D:/Install/PostgreSQL/18/bin/psql.exe" "$DBURL" -tAc "select count(*) from public.audit_log;"     # == PRE_COUNT
"D:/Install/PostgreSQL/18/bin/psql.exe" "$DBURL" -tAc "select count(*) from public.documents;"    # == 0
grep -rn "CREATE INDEX\|CREATE FUNCTION\|CREATE TRIGGER" server/src/audit server/src/middleware   # -> 0 (NQ1, R-B2)
grep -c "audit_log_action_created\|audit_log_actor_created" server/src/db/schema.ts                # -> 0
grep -rn "req\.user\.id\|req\.user?.id\|req\.user\[" server/src/audit server/src/routes server/src/middleware/require-admin.ts  # -> 0 (B-D10a)
sha256sum -c .pipeline/p3/baseline.sha256                          # db/schema.ts still OK
```

**Manual / browser:** **none required for B's write side** — B adds no UI. The one human check is bookkeeping: after T-B7..T-B17 and cleanup, `audit_log` count equals `PRE_COUNT` (printed), and the `p3b-*` documents are gone (`SELECT count(*) FROM documents WHERE name LIKE 'p3b-%'` → `0`).

### B5. RISKS / ASSUMPTIONS — F3-B

| # | Risk / assumption | Mitigation |
|---|---|---|
| BR1 | **Fire-and-forget loses rows on crash** (B-D4). | Stated in the plan, in the code comment above `recordAudit`, and in `RESULT.md`. No mitigation in this phase. |
| BR2 | `void recordAudit(...)` — if a future refactor removes the internal `try/catch`, every call site becomes an unhandled rejection. | `T-B14` (a) and (b) assert both halves: resolves on a rejecting client **and** `doesNotThrow` on a throwing getter (R-B6). A comment on the function states the invariant. |
| BR3 | **Unbounded write amplification**: `search.query` is the hottest event; the UI searches per keystroke-submit, and every row is a real INSERT. | Accepted: `REQUEST.md:43` names it. Rate limiting is explicitly out of scope (`REQUEST.md:55`). Follow-up **FU-B7** (sampling / `AUDIT_SEARCH_QUERIES=off` env switch). |
| BR4 | `auth.login.failure` writes an **unauthenticated** row per attempt → a fill-the-table vector (1 MB body × attempts). | No body content is stored (B-D7): `resource` is capped at **200** by `sanitizeResource` after the 64-char actor cap, `detail` at ≤ ~60 chars. A row is ~300 bytes. Login rate limiting is out of scope (`REQUEST.md:55`) → **FU-B8**. |
| BR5 | ~~Two new indexes slow `audit_log` INSERTs.~~ | **N/A (NQ1): no index is created.** No INSERT overhead beyond the one btree on `created_at` that already exists. |
| BR6 | `ingest.upload.success` `resource` is **not uniform** — `document:<uuid>` vs `document:sha256:<hash>` (BA-5). | Deliberate and documented; a consumer filtering by `resource LIKE 'document:%'` gets both. The C page renders `resource` verbatim, so a repeated upload visibly reads `document:sha256:abcd…` — that is the dedupe signal, not a bug. |
| BR7 | I have **not** observed a real 400 from search or a real audit row — the DB is empty and I did not start the server [U]. | T-B7/T-B7b/T-B7c measure the pre-fix state; T-B8..T-B13 measure the post-fix state. Neither is asserted from reading. |
| BR11 | **(C-1)** `req.user.id` is `undefined` at runtime (§B-D10a) — the `AuthRequest` type *says* `{id, username}` (`middleware/auth.ts:5-7` [V]), so TypeScript will happily compile `req.user.id`, and every authenticated event would silently become a `NULL` actor. | Declared once in §B-D10a, restated above §B3.2's table, and guarded three ways: `T-B22` asserts the written actor equals the token's `username`; `T-B23` calls `requireAdmin` with a `req.user` that has **no** `id` key; and §B4.4 greps `req.user.id` out of `server/src` (→ 0 matches). Fixing the cast is **FU-C1**, deliberately **not** done in phase 3 (it would touch baseline-guarded `middleware/auth.ts`). |
| BR12 | **(C-1)** `auth.login.success` has no `req.user` to read (login precedes the token), so this one row's actor cannot literally be `req.user?.username`. | The plan writes the **verified** `row.username` (§B3.4, note under §B-D6) and `T-B22` pins it to `jwt.decode(token).username` and to the login response's `user.username`, so the row can never be an attacker-chosen string. |
| BR13 | **(C-1)** The `403` supersedes round 1's `401` mandate for `requireAdmin`. | Recorded once in §B-D10b with the reason, propagated to §B3.6, `T-B23`, §C3.4, §C3.7, `T-C9`/`T-C10`, §C5 CR3/CR6 and §C7 CQ1. |
| BR8 | `sanitizeDetail` is applied inside `recordAudit`; a caller that already holds a sanitised object pays a second pass. | Idempotent by construction (allow-list ∩ allow-list = allow-list; `…` marker is itself ≤ cap). Asserted in `T-B2` (running the sanitiser twice equals running it once). |
| BR9 | **(R-B3)** Two `resource` values come from unauthenticated input (`req.body.username`, `file.originalname`). | `sanitizeActor` (64, controls stripped) **then** `sanitizeResource` (200, controls stripped) at the call sites; `T-B19` unit-tests the cap and the control-strip. |
| BR10 | **(NQ1)** C's filtered queries scan `created_at DESC` and filter, because there is no index on `action`/`actor`. | Accepted at `audit_log` = 0 rows [V]. **FU-B10** carries the `EXPLAIN`-justified `CREATE INDEX CONCURRENTLY`. |

### B-GATE. ACCEPTANCE-CRITERION → TEST GATE — F3-B (every AC of `REQUEST.md` §F3-B, one row each)

A part is **PASS** only when every row below is green. "Expected" is the exact value/exit condition the Implementer records in `TEST-REPORT.md`; "Automated" names the row of §B4.2/§B4.3 that proves it. Nothing in this table may be satisfied by reading code — except the rows explicitly labelled *static*, which are greps with a numeric expectation.

| AC (`REQUEST.md` §F3-B) | Requirement, restated | Automated | Expected value | Manual-only? |
|---|---|---|---|---|
| **AC1** — one central audit service, no duplicated INSERT SQL | Exactly one module writes `audit_log`; call sites import it (never `pg` directly for audit). | **T-B20** *(static)* + `T-B7` | `grep -c 'INSERT INTO public.audit_log' server/src` ⇒ **1** (in `audit/log.ts`); `grep -rn 'void recordAudit(' server/src/routes` ⇒ **5**; with `auth.ts` reverted, a login creates **+0** rows. | No |
| **AC2** — events recorded; taxonomy documented with exact `action` strings; `auth.logout` only if reliably observable | The closed set is exactly the 5 strings of §B-D6; `auth.logout` is **absent**, not faked. | **T-B8, T-B9, T-B9b, T-B10, T-B10b, T-B10c, T-B11, T-B12, T-B21** | Each event yields **exactly 1** row with the `action` string spelled exactly as in §B-D6; `T-B21`: `AUDIT_ACTIONS` deep-equals the 5-element list and does not include `'auth.logout'`. | No |
| **AC3** — every event carries `actor` (from the **verified JWT**, never the body), `action`, `resource` (stable id string), sanitised `detail` | `actor` comes from the token payload; `resource`/`detail` pass the sanitisers. **For `auth.login.failure` there is no verified JWT, so `actor` is the literal `null` by rule (§B3.2 actor rule, R4-B/1).** | **T-B8, T-B9, T-B9b, T-B10, T-B11, T-B12, T-B19, T-B22** | Authenticated rows: `actor === 'admin'` and `=== jwt.decode(token).username` (T-B22); failed logins: `actor` is SQL `NULL` read from the **DB row** **and** the failure path touches no `req.user` (getter-throws unit form, T-B9), with `T-B9b` proving a success writes `'admin'` so the `null` is deliberate; an adversarial username `p3b-\n\u2028nosuch` yields `resource === 'admin:p3b-nosuch'` with no control chars; `JSON.stringify(detail)` contains no `token`/`password` (T-B8). | No |
| **AC4** — reliability semantics stated per event class; fire-and-forget MUST NOT break the request | §B-D4 states "after successful completion, fire-and-forget" for all 5 and states the crash-loss window; the module cannot throw or reject. | **T-B14 (a), T-B14 (b), T-B14 (c), T-B10b, T-B11, T-B15b** | (a) `await recordAudit(evt, rejectingClient)` **resolves** and `logger.warn` called once with a first arg starting `'[audit] write failed'`; (b) `assert.doesNotThrow(() => recordAudit(evilGetterEvent))`; (c) the fake handler's `res.json` ran; (T-B10b/T-B11) business status/body unchanged; (T-B15b) `grep 'await recordAudit('` ⇒ **0**. | No |
| **AC5** — admin-only decision justified | `requireAdmin` exists, refuses a missing principal with **403**, allows a verified one, and is **gated in B** (§B-D10b). | **T-B23** *(unit, no server)* + `T-C10` (C, mount) | (a) no `req.user` ⇒ `status(403)` once, `json({error:'Forbidden'})` exactly, `next` **not** called; (b) `req.user = {username:'admin'}` (**no `id`**) ⇒ `next` called once. | No (the *unreachability through the real mount* is a documented limitation, not a manual check) |
| **AC6** — sanitiser exists and is unit-testable (allow-list keys + length caps) | `sanitizeDetail` / `sanitizeActor` / `sanitizeResource` are pure and unit-tested with no DB/server. | **T-B1 … T-B6, T-B19** | Exact deep-equals as written in §B4.2: `{outcome:'success',name:'x'}` only; `q`/`error` capped at **201** chars (200 + `…`); `sanitizeActor` capped at **64** with **no** marker; `sanitizeResource` capped at **200** with no control chars; all non-object inputs ⇒ `{}`. | No |
| **AC7** — no password / JWT / `Authorization` / document content / extracted text in `detail` | Deny set enforced through the **public** function, plus the poisoned-row read-side check. | **T-B3** (deny set beats a widened allow-list), **T-B1**, **T-B4**, **T-B11**, **T-B17**, **T-C6** | `(T-B3)` `sanitizeDetail({password:'x',token:'y',outcome:'success'}, ['outcome','password','token'])` deep-equals `{}`; `(T-B1)` exact object `{outcome:'success',name:'x'}`; `(T-B17)` a 10 MB detail value is stored ≤ **201** chars; `(T-C6)` none of the three `L3AK_*_SENTINEL_*` strings appear in the read response. | No |
| **AC8** — no `UPDATE`/`DELETE` of `audit_log` in product code | The table is append-only from the app. | **T-B15** *(static)* | `grep -rnE "UPDATE\s+(public\.)?audit_log|DELETE\s+FROM\s+(public\.)?audit_log" server/src` with `__p3b__/` and `__p3c__/` excluded ⇒ **0** lines. | No |
| **AC9** — an audit write failure is visible in the server log and never turns a successful operation into a 500 | Proven at the module seam **and** on real HTTP. | **T-B14 (a)(b)(c), T-B10b, T-B11, T-B15b** | As AC4's row, plus: with the DB made to reject the INSERT, `/api/auth/login` still returns **200** and `/api/ingest/upload` still returns **200/207** with the unchanged body keys. | No |
| **AC10** — any migration is justified | None is made. | **T-B16** (REMOVED) + baseline row | No `CREATE` in `server/src/audit` or `server/src/middleware` (`grep` ⇒ **0**); `server/src/db/schema.ts` baseline row **OK**. | No |

**Manual-only checks for B — the explicit list (there are three, and only three):**

1. **`B-M1` — "visible in the server log" as a human reads it.** `TEST-REPORT.md` pastes the one `logger.warn` JSON line produced by `T-B14` part (a) from `f3b-server.log` (BQ4 ruling: `warn` is the accepted level). The *assertion* is automated (`T-B14`, part (a)); the paste is the evidence that the line is actually emitted into the running server's stdout, not merely into a stubbed logger.
2. **`B-M2` — rows are absent from the live table after cleanup.** The Implementer pastes the output of `select count(*) from public.audit_log;` (**`== PRE_COUNT`**) and `select count(*) from public.documents where name like 'p3b-%';` (**`0`**) run *by hand* after the suite exits. This is bookkeeping confirmation of `B4.1.4`/`B4.1.5`, not a new claim.
3. **`B-M3` — no secret leaked into any artifact.** A human greps `f3b-server.log`, `TEST-REPORT.md` and `IMPLEMENTATION.md` for `eyJ` (a JWT prefix) and for the `ADMIN_PASSWORD` value, and records **0** hits; tokens appear only as `<token:N chars>`.

Everything else in B is automated. **B adds no UI, so there is no browser step in B's gate** (`§F2`'s browser row is `n/a` for B).

---

### B6. OUT OF SCOPE — F3-B (follow-ups only)

- **FU-B1** Retention/rotation (explicitly out, `REQUEST.md:55`).
- **FU-B2** `auth.logout` is unobservable until a server-side logout endpoint exists (B-D6). Proposed follow-up contract: `POST /api/auth/logout` → `204` + `auth.logout`, reliability "after successful completion", no token revocation (JWTs are stateless for 12 h, `auth.ts:27` [V]).
- **FU-B3** `access_policy.change` / `document.delete` — no such operations exist.
- **FU-B4** DB-level `REVOKE UPDATE, DELETE ON audit_log FROM <app role>` — needs a dedicated role; not safe to do against the shared role.
- **FU-B5** Auditing pre-loop upload rejections (401 / no files / bad metadata / bad policy / multer limits) needs a second taxonomy and an unauthenticated-write policy.
- **FU-B6** Search **failures** (`search.ts:79-82` 500) are not audited.
- **FU-B7** `search.query` volume (BR3).
- **FU-B8** Repeated failed logins are not counted, rate-limited, or alarmed (BR4).
- **FU-B9** `auth.ts:30` and `search.ts:80` still use bare `console.error`; B does not convert them (out of scope, unrelated churn — NB-7).
- **FU-B10** **(NQ1)** `audit_log_action_created (action, created_at DESC)` and `audit_log_actor_created (actor, created_at DESC)`, created `CONCURRENTLY` when volume justifies it, with a measured `EXPLAIN` against a populated table — **not** by intuition, and not in phase 3.

### B7. OPEN QUESTIONS — F3-B *(all four ruled in round 1; recorded closed)*

| # | Ruling | Effect in this plan |
|---|---|---|
| **BQ1** | **`actor = null` (keep), promoted:** also keep the sanitised candidate in `resource` **and** add `attempted` to the `detail` allow-list so the C UI can render it read-only. | §B3.2 rule 2, §B3.4, §B-D6, §B-D7, T-B8, T-B9; read side now renders it (§C3.3, §C-D5, `F2`, T-C6). |
| **BQ2** | **Rejected — no DDL trigger.** AC9 proven by the unit seam (T-B14) + a real-HTTP "200/207 unchanged" assertion (T-B10b/T-B11) + the static `void recordAudit` count (T-B15b). | §B4.3, §F4, §F1 (no trigger file, no DDL). |
| **BQ3** | **`success` with `chunk_count: 0`** — no 7th action. | §B3.4 note, T-B10c. |
| **BQ4** | **`warn`** accepted as "visible in the server log". | §B-D2 body (`logger.warn('[audit] write failed', …)`), T-B14(a). |


---

## PART F3-C — Audit UI (read route + page)

> **Blocked until F3-B is PASS.** C rewrites `server/src/routes/audit.ts` (D3) and `web/src/app/dashboard/audit/page.tsx`.

### C1. CURRENT BEHAVIOUR (verified)

**Backend** — `server/src/routes/audit.ts:6-19` is the whole file: `SELECT actor, action, resource, detail, created_at FROM audit_log ORDER BY created_at DESC LIMIT 200` → `res.json({ rows })` [V]. Defects:

| # | Defect | Evidence |
|---|---|---|
| **CA-1** | **`id` is not selected**, so the client has no stable React key and no cursor handle; the page falls back to array index (`audit/page.tsx:44` `key={r.chunk_id \|\| i}`) [V]. |
| **CA-2** | **`LIMIT 200` with no cap, no offset, no cursor**: the page can never show row 201, and `offset` is not expressible. | `audit.ts:12` [V] |
| **CA-3** | **`ORDER BY created_at DESC` alone** — same non-total-order defect as LA-4, worse here because `audit_log` rows are inserted in bursts (a 10-file upload writes 10 rows in the same statement-time window). | `audit.ts:11` [V] |
| **CA-4** | **No filters** — no `action`, `actor`, `resource`, `from`, `to`. | `audit.ts:8-13` [V] |
| **CA-5** | **No validation of anything** (nothing to validate), and **no `detail` sanitisation on the way out** (AC7). Today it cannot hurt because the table is empty [V]; after B it will contain whatever `recordAudit` stored — and C must not rely on B being correct. | `audit.ts:9` [V] |
| **CA-6** | **No explicit authorisation** — `authMiddleware` only (`app.ts:57` [V]). | `app.ts:57` [V] |
| **CA-7** | **Response key is `rows`**, which no client reads. | `audit.ts:14` [V] |

**Frontend** — `web/src/app/dashboard/audit/page.tsx:11-23` calls `api.search({ q:"", limit:200 })` [V] and:
- **CA-8** — displays the **400** as the whole page (blank `q` rejected at `search.ts:31`) [V] — same defect as LA-7.
- **CA-9** — slices **client-side** with `results.slice(0, 50)` (`:16`) [V] — the exact anti-pattern `REQUEST.md:62` forbids.
- **CA-10** — renders **passage text** in a column headed "Passage" (`:38`, `:46`) and "Page" (`:39`, `:47`) — i.e. the audit page is a search-results page with the wrong headers; there is no timestamp, actor, action or resource column at all [V].
- **CA-11** — empty state copy is **"No activity yet."** (`:28`) [V], which AC4 requires to become **"No audit events yet"**.
- **CA-12** — `api.ts` has no audit method [V]; `header.tsx:42-50` "Sign out" clears the session and navigates — no server call (B-D6/BA-? ) [V].

### C2. ROOT CAUSE / DESIGN — C-specific decisions

**C-R1 — Rewrite `routes/audit.ts` to a filtered, keyset-paginated, validated, allow-listed reader.** Owned entirely by C (D3).

**C-D1 — Keyset pagination with the **same composite cursor design as A**, but a **different envelope**: `{ rows, limit, next_cursor }`. (R-A3/CQ2: `LIMIT $8 + 1`, extra row popped, cursor only when an extra row existed.)**
*Justification:* newest-first `(created_at DESC, id DESC)` with `created_at` ties is a real risk (CA-3) and I proved the composite keyset gap-free on a temp table (§0.2 P13/P14) [V]. The envelope differs from A's `{results,total,limit,cursor}` because: (a) `rows` is what `audit.ts:14` already returns, so the key is preserved; (b) `total` is deliberately **omitted** — an exact count over a growing append-only table is the one query whose cost grows without bound, and the page only needs "is there a next page", which `next_cursor !== null` answers; (c) `offset` is meaningless for keyset.
*Ruling CQ2:* **`LIMIT+1` is used** and the cursor is suppressed when no extra row exists. One row of extra memory is not a cost; an extra empty page is a user-visible bug and would make CR2's "No more events" state the *normal* path at exact multiples.
*Rejected:* unifying both envelopes into one shared helper — D1 forbids A/B/C sharing code, and the two lists genuinely differ (documents: need a total; audit: must not count).
*Rejected:* `OFFSET` — grows unbounded on an append-only table *and* duplicates rows under ties.

**C-D2 — `limit` clamped to `1…200`, default `50`.** `200` preserves the current maximum (`audit.ts:12` [V]) so nothing that works today stops working; `50` is one screen of dense rows. Out-of-range **clamps silently, never 400s** (same idiom as A/search).

**C-D3 — Filters: `action` (**exact**), `actor` (**exact**, after `sanitizeActor`), `resource` (**exact**), `from` / `to` (**inclusive** ISO-8601 `timestamptz`).**
*Justification:* `REQUEST.md:49` names these five. **Exact match for `action`/`actor`/`resource`** because (a) an `ILIKE` on `actor` without escaping matched **3** rows where the escaped pattern matched **1** in my probe (P15 [V]) — `%` and `_` in a username are live wildcards; (b) exact match is a hash/btree-friendly predicate and is the only shape that *could* be indexed later without a rewrite (NQ1 dropped the indexes for now — see §B-D9/FU-B10); (c) the UI uses **dropdowns/known values** for `action` and exact actor, so substring is not needed.
*Rejected:* `ILIKE '%'||$n||'%'` with escaping — doable, but it defeats the index and the UI has no free-text actor field.
*Rejected:* an array (`action=ingest.upload.success,ingest.upload.failure`) — comma-separated lists invite quoting bugs; the UI filters one action at a time.

**C-D4 — Validation: **unknown action → `400` with the taxonomy in the message**; bad `from`/`to` → `400`; `from > to` → `400`; `limit`/`cursor` → never a `400` (clamp/ignore).**
*Justification:* `action` is a closed set owned by the server (`events.ts`); silently ignoring a typo'd action would show unfiltered rows and look like a bug. `limit`/`cursor` are *pagination* parameters, where clamping is friendlier and matches the rest of the app (`search.ts:39` [V]). The asymmetry is deliberate and stated in the response contract.
*Rejected:* 400 on everything — an out-of-range `limit` from a stale bookmark would break a page that could just work.

**C-D5 — The page's display narrowing lives in a **pure module**, `web/src/app/dashboard/audit/format.ts`, not inside the component. (R-C1)**

`format.ts` (**new file**, C's own) exports exactly four pure functions and one constant. It imports **nothing** from `server/` and **nothing** from React — so it is testable with `npx tsx` and no DOM.

```ts
// web/src/app/dashboard/audit/format.ts
// (C-3) This order is the contract: it must equal SERVER_DISPLAY_KEYS in routes/audit.ts
// and the §C3.3 list, as a set AND in this order. T-C6 asserts it.
export const DISPLAY_DETAIL_KEYS = [
  'outcome','reason','attempted','name','kind','access_policy',
  'chunk_count','deduplicated','error','q','returned','limit',
  'user_known',
] as const;

/** Narrow read-side allow-list. Forbidden/nested keys cannot survive it. Never returns non-flat values. */
export function pickDisplayDetail(raw: unknown): Record<string, unknown>;

/** 'success' | 'failure' | '—'  (em dash U+2014) — exact match only, never coerced. */
export function outcomeOf(detail: unknown): 'success' | 'failure' | '—';

/** Local, deterministic given a TZ: `new Intl.DateTimeFormat('en-GB', {timeZone, …}).format(new Date(iso))`,
 *  with `{ timeZone }` defaulting to `undefined` (= server/browser local) so a test can pin it. */
export function formatTs(iso: string, timeZone?: string): string;

/** Pure string mapping of an error to the UI branch — no fetch, no response object. */
export function describeError(e: unknown): 'forbidden' | 'unauthorized' | 'error';
```

- `pickDisplayDetail` is C's **own** copy of the field names — it does **not** import `server/src/audit/sanitize.ts` (D1/D6: `web/` must not import `server/`). It is ~10 lines: `for (const k of DISPLAY_DETAIL_KEYS) if (k in obj && !isObjectLike(obj[k])) out[k] = obj[k]`. Nested values are dropped, unknown keys are dropped, forbidden keys are not in the list at all.
- AC7 ("never returns `detail` fields that fail sanitisation") is therefore enforced **independently of B**, which is the point: a manual `INSERT`, a restored dump, or a future mis-behaving writer cannot make the page render a `password`.
- `describeError`: `String((e as any)?.message ?? '')` → `'Forbidden'` ⇒ `'forbidden'`; `'Unauthorized'`/`'Missing or invalid bearer token'`/`'Invalid or expired token'` ⇒ `'unauthorized'`; anything else ⇒ `'error'`. `request<T>` throws `new Error(body.error)` (`api.ts:61-73` [V]), so `'Forbidden'` is what a 403 produces.
- `page.tsx` imports all four and renders `describeError(err) === 'forbidden' ? <AccessDenied/> : <ErrorMsg/>`.

*Rejected:* importing `audit/sanitize.ts` into the web bundle — cross-app import, and it would make the read side depend on the write side being correct.
*Rejected:* inline helpers inside `page.tsx` — the reviewer's core finding is that the page is the only place AC1/AC2/AC9 live and nothing can read it; a pure module is the smallest change that makes the page's logic testable without jsdom.

**C-D6 — `requireAdmin` is mounted on the audit router: `app.use('/api/audit', authMiddleware, requireAdmin, auditRouter)` in `app.ts`.**
*Justification:* AC5. It **enforces only "a verified principal exists"** (R-B1: it 403s when `req.user` is absent) and does not distinguish one admin from another (B-D10), so the page must behave identically for every authenticated user — but the mount makes the intent legible and gives a single place to tighten.
*Rejected:* mounting `requireAdmin` and having the page probe for 403 — the page **must handle 403** (AC6) even though it cannot be produced by the real mount today; the handling is `describeError(err) === 'forbidden'` → an access-denied message, and **T-C9 proves the branch with the pure function**, not with a stubbed fetch or a stubbed scope (CQ1 ruling).
*Consequence for the UI:* AC6's "if the backend can answer 403" is satisfied by **handling** it and by documenting that **today it cannot happen through the real mount**. The page does not hide itself for non-admins (there is no way to know).

**C-D7 — Page: table with exactly **Timestamp · Actor · Action · Resource · Outcome**; newest first; `Previous`/`Next` from a client-side cursor stack; **no** client-side slicing of any blob.**
*Justification:* AC2 names the five columns; AC3 forbids slicing and demands page size + next/prev. A cursor stack (`cursorStack: (string|null)[]`, `pageIndex`) is the smallest correct way to go back when the server cursor is one-way.
*Rejected:* "load more" — appending pages makes a single long list that cannot be paged back and grows without bound; the brief allows either, and prev/next is the honest one for an audit log where you may want to re-read a page.
*Rejected:* `page`/`offset` — same reason as C-D1.

**C-D8 — Outcome cell = `detail.outcome` if it is exactly `'success'` or `'failure'`, else `—` (em dash U+2014).** AC2 verbatim. Never render `detail` as JSON (AC7).

**C-D9 — Timestamp rendered as a **local** `<time>` with `detail` title = the raw ISO string.**
*Justification:* an audit log is read by a human reasoning about "when"; a UTC-only display causes off-by-7-hours mistakes on this machine (`Asia/Bangkok` [V]). The raw ISO in the `title` attribute keeps the exact value one hover away, and `T-C8` asserts the underlying string is unchanged.
*Rejected:* rendering the raw ISO inline — unreadable in a table.

**C-D10 — `api.audit.list` is added to `api.ts` using the existing `request<T>` helper (which already attaches the bearer and fires `ka:logout` on 401, `api.ts:47-49,61-66` [V]).**
*Justification:* zero new transport code; 401 handling is inherited for free (proven at browser level in F2-B).
*Rejected:* a bespoke `fetch` — would re-implement auth/401 for no gain.

### C3. EXACT CONTRACTS — F3-C

**C3.1 Route.** `GET /api/audit`, mounted as `app.use('/api/audit', authMiddleware, requireAdmin, auditRouter)`.

**C3.2 Query parameters.**

| Param | Type | Default | Validation | Status on invalid |
|---|---|---|---|---|
| `limit` | int `1…200` | `50` | floor + clamp | clamp + echo |
| `cursor` | opaque (base64url `{v:1,t,i}`) | absent | undecodable / `v!==1` → treated as absent | page 1, 200 |
| `action` | one of `AUDIT_ACTIONS` (imported from `audit/events.ts`) | absent | must be in the closed set | **`400 {error:"Unknown action filter"}`** |
| `actor` | string, **or the literal `null`** | absent | `sanitizeActor`d; ≤ 64; `actor=` (empty) → **absent**; `actor=null` (literal, case-sensitive) → **`IS NULL` filter** | 200 |
| `resource` | string | absent | ≤ 200 chars, truncated | 200 |
| `from` | ISO-8601 | absent | must parse as a valid date | **`400 {error:"Invalid from timestamp"}`** |
| `to` | ISO-8601 | absent | must parse; `from > to` → 400 | **`400 {error:"Invalid to timestamp"}`** / **`{error:"from must be <= to"}`** |

**C3.4a — Parameter plumbing (URL → TypeScript → SQL).** The route MUST parse and validate in this order, and the bind array MUST be built from the *validated* locals:
```ts
const fromRaw = typeof req.query.from === 'string' ? req.query.from : '';
const toRaw   = typeof req.query.to   === 'string' ? req.query.to   : '';
const fromTs = fromRaw ? new Date(fromRaw) : null;   // '' -> null, never ''
const toTs   = toRaw   ? new Date(toRaw)   : null;
if (fromTs && Number.isNaN(fromTs.getTime())) return res.status(400).json({error:'Invalid from timestamp'});
if (toTs   && Number.isNaN(toTs.getTime()))   return res.status(400).json({error:'Invalid to timestamp'});
if (fromTs && toTs && fromTs > toTs)          return res.status(400).json({error:'from must be <= to'});
```
Names are fixed: **URL `from`/`to`** ↔ **locals `fromTs`/`toTs`** ↔ **`$4`/`$5`**. Bind `fromTs`/`toTs` **only** — never the raw strings (an empty string raises `invalid input syntax for type timestamp with time zone`). `T-C13b` proves all three branches.

**R-C2 — the NULL-actor rule, stated once and unambiguously:**
- `actor=` (empty string) ⇒ **absent** — no actor filter. Reason: an empty value from a cleared form field is "no filter", the same rule `api.audit.list` already applies to every empty param.
- `actor=null` (the four-character literal) ⇒ `WHERE actor IS NULL`. This is the **only** way to ask for NULL actors and it cannot collide with a real username because `sanitizeActor('null')` is the string `'null'`, and a login of a user literally named `null` is not a state the `admins` table has (1 row, `admin` [V]). *If that collision ever matters, the follow-up is a distinct param, not a behaviour change here.*
- Any other non-empty `actor` value ⇒ `WHERE actor = $2` (exact, after `sanitizeActor`).

**C3.3 Response `200`.**

```json
{
  "rows": [
    {
      "id": "8b1d4c72-5b13-4a6c-9f7e-2f9b0f5c7a11",
      "actor": "admin",
      "action": "ingest.upload.success",
      "resource": "document:3f2b1c9e-8a41-4f0e-9d3a-0b7c5e21d4aa",
      "detail": { "outcome": "success", "name": "vendor-agreement-2026.pdf",
                  "kind": "pdf", "access_policy": "restricted",
                  "chunk_count": 14, "deduplicated": false },
      "created_at": "2026-11-02T07:41:20.004Z"
    }
  ],
  "limit": 50,
  "next_cursor": "eyJ2IjoxLCJ0IjoiMjAyNi0xMS0wMlQwNzo0MToyMC4wMDRaIiwiaSI6IjhiMWQ0YzcyLTViMTMtNGE2Yy05ZjdlLTJmOWIwZjVjN2ExMSJ9"
}
```

- `rows` — array, possibly empty. **`id` is included** (CA-1: React key + cursor input).
- `detail` — **always an object**; only keys in C's display allow-list, in this exact order: `outcome, reason, attempted, name, kind, access_policy, chunk_count, deduplicated, error, q, returned, limit, user_known`. A forbidden key present in the row is **dropped** (C-D5). Never `null`.
  - **This list must equal the server-side list in `routes/audit.ts` and the `pickDisplayDetail` key array in `audit/format.ts`; `T-C6` asserts all three are equal as sets and in this order.** `attempted` is rendered as plain text, length-capped at 64 characters, never as HTML.
- `next_cursor` — **`string` iff the server had more rows than it returned**, i.e. iff the `LIMIT $8 + 1` probe row was present (`hasMore === true` **before** the pop), else `null`. It is computed from the **last surviving row after the probe row is popped** and equals `encodeCursor({t, i})` of that row. It is **never** computed from `rows.length === limit`: for exactly `limit × N` rows that test yields a cursor to a non-existent page, which CQ2/R-A3 forbid.
- `limit` — the effective clamped limit.
- `actor` — `null` is legal (failed logins, `auth.login.failure`, B-D7) and the UI renders `—`.

**C3.4 Error responses.**

| Status | Body | When |
|---|---|---|
| `400` | `{"error":"Unknown action filter"}` | `action` not in the taxonomy |
| `400` | `{"error":"Invalid from timestamp"}` | `from` unparseable |
| `400` | `{"error":"Invalid to timestamp"}` | `to` unparseable |
| `400` | `{"error":"from must be <= to"}` | inverted range |
| `401` | `{"error":"Missing or invalid bearer token"}` / `{"error":"Invalid or expired token"}` | `authMiddleware` (unchanged, `middleware/auth.ts:12,21` [V]) |
| `403` | `{"error":"Forbidden"}` | `requireAdmin` with no verified `req.user` (§B3.6, decision recorded once in **§B-D10b** — `403` supersedes round 1's `401`). **Unreachable through the real mount today** (§B-D10); the page still handles it (AC6). |
| `500` | `{"error":"Failed to load audit log"}` | DB error (message preserved verbatim from `audit.ts:17` [V]) |

**C3.5 SQL — copy-pasteable. $1..$9; parameter order is the contract (see §0.2 probe failure #1: TIMESTAMPTZ BEFORE UUID in both the declaration and the row comparison).**

```sql
-- C-SQL-1: the page.   (R-C2 adds $9; (R-A3/CQ2) LIMIT $8 + 1)
--   $1 action         text        (NULL = no filter)      -- EXACT match
--   $2 actor          text        (NULL = no filter)      -- EXACT match, pre-sanitised
--   $3 resource       text        (NULL = no filter)      -- EXACT match
--   $4 from           timestamptz (NULL = no lower bound, INCLUSIVE)
--   $5 to             timestamptz (NULL = no upper bound, INCLUSIVE)
--   $6 cur_ts         timestamptz (NULL = first page)     -- cursor part 1  <-- timestamptz BEFORE uuid
--   $7 cur_id         uuid        (NULL = first page)     -- cursor part 2
--   $8 limit          int                                 -- effective limit, already clamped
--   $9 actor_is_null  boolean     NOT NULL            -- R-C2: true <=> caller sent actor=null
SELECT id, actor, action, resource, detail, created_at
FROM public.audit_log
WHERE ($1::text IS NULL OR action = $1)
  AND ($9::boolean IS TRUE OR ($2::text IS NULL OR actor = $2))
  AND ($3::text IS NULL OR resource = $3)
  AND ($4::timestamptz IS NULL OR created_at >= $4)
  AND ($5::timestamptz IS NULL OR created_at <= $5)
  AND ($6::timestamptz IS NULL
       OR (created_at, id) < ($6::timestamptz, $7::uuid))
ORDER BY created_at DESC, id DESC
LIMIT $8 + 1
```

**URL → TypeScript → SQL: the complete bind map (C-5).** Every parameter the route accepts, where it is read, what it becomes, and which bind it lands in. **Anything not in this table is not a parameter and is ignored.**

| URL param | Read as (exact expression) | Local after validation | Bind | Type in SQL | `null` means |
|---|---|---|---|---|---|
| `limit` | `Number(req.query.limit)` → `Math.floor` → clamp `[1,200]`, default `50` | `lim: number` | **`$8`** | `int` | never null (always a number) |
| `cursor` | `Buffer.from(req.query.cursor,'base64url')` → `JSON.parse` → check `{v:1,t,i}` | `curTs: Date \| null`, `curId: string \| null` | **`$6`** (ts), **`$7`** (id) | `timestamptz`, `uuid` | first page (both null together) |
| `action` | `typeof req.query.action === 'string' ? req.query.action : null`; must be in `AUDIT_ACTIONS` | `action: string \| null` | **`$1`** | `text` | no filter |
| `actor` | `sanitizeActor(req.query.actor)`; the literal `'null'` sets `actorIsNull = true` | `actor: string \| null`, `actorIsNull: boolean` | **`$2`**, **`$9`** | `text`, `boolean` | no actor filter |
| `resource` | `typeof req.query.resource === 'string' ? req.query.resource.slice(0,200) : null` | `resource: string \| null` | **`$3`** | `text` | no filter |
| **`from`** | **`req.query.from` → `fromRaw` → `fromTs = fromRaw ? new Date(fromRaw) : null`** (§C3.4a) | **`fromTs: Date \| null`** | **`$4`** | `timestamptz` | no lower bound |
| **`to`** | **`req.query.to` → `toRaw` → `toTs = toRaw ? new Date(toRaw) : null`** (§C3.4a) | **`toTs: Date \| null`** | **`$5`** | `timestamptz` | no upper bound |

**The exact `pool.query` call for `C-SQL-1` (parameter order is the contract, and the order is `timestamptz` before `uuid` — §0.2 probe failure #1):**
```ts
const r = await pool.query(C_SQL_1, [
  action ?? null,          // $1
  actor ?? null,           // $2   (null when actorIsNull)
  resource ?? null,        // $3
  fromTs ?? null,          // $4   timestamptz
  toTs ?? null,            // $5   timestamptz
  curTs ?? null,           // $6   timestamptz  <-- BEFORE uuid
  curId ?? null,           // $7   uuid
  lim,                     // $8   int (effective, clamped 1..200)
  actorIsNull,             // $9   boolean
]);
let rows = r.rows;
const hasMore = rows.length > lim;
if (hasMore) rows.pop();                              // (R-A3) drop the probe row
const next_cursor = hasMore ? encodeCursor(rows[rows.length - 1]) : null;
```

**Order matters:** `hasMore` is captured from the raw `r.rows.length > lim` **before** `rows.pop()`; `next_cursor` is built **after** the pop from `rows[rows.length - 1]`. Reversing either step reintroduces the trailing empty page (C-2 / RC-1).

- **Absence marker is JSON `null`, never `''`** — `''` raises `invalid input syntax for type timestamp with time zone` (probe §0.2, measured). The route converts `''` → `null` **before** building the array.
- **`actorIsNull` is `true` only for the literal `actor=null`** (R-C2). When it is `true`, `$2` is passed as `null`, so the second disjunct cannot match and the first (`$9 IS TRUE`) does all the work.
- The `LIMIT` is applied **before** `pickDisplayDetail` maps rows, so paging is exact.
- `next_cursor` is taken from the **last surviving row** after the probe row is popped, never from a separate query.
- `detail` is passed through the server's own picker before serialising. **The server-side key list, written out literally because three copies must agree (§C3.3, C-3):**
  ```ts
  // server/src/routes/audit.ts — local const; must NOT import from web/ (D1/D6)
  export const SERVER_DISPLAY_KEYS = [
    'outcome','reason','attempted','name','kind','access_policy',
    'chunk_count','deduplicated','error','q','returned','limit',
    'user_known',
  ] as const;
  ```
  It must equal `DISPLAY_DETAIL_KEYS` in `web/src/app/dashboard/audit/format.ts` (§C-D5) **as a set and in this exact order**. `T-C6` asserts the equality, the order, and that `attempted` survives the round trip to the wire.
- **The cursor codec, written once and used for both decode (input) and encode (output):**
  ```ts
  type Cursor = { v: 1; t: string; i: string };            // t = created_at ISO, i = id uuid
  const encodeCursor = (row: { created_at: string; id: string }): string =>
    Buffer.from(JSON.stringify({ v: 1, t: row.created_at, i: row.id }), 'utf8').toString('base64url');
  // decode: any parse/shape failure → treat as absent (page 1), never a 400 (C-D4)
  ```
  **`t` must be the full-microsecond ISO string the driver returned**, never a re-formatted `Date` — the F3-A cursor defect (sub-millisecond truncation → a skipped row) was exactly a lossy re-format. The route therefore encodes from the **row object `pg` returned**, and `C-SQL-1` selects `created_at` uncast.

**C3.6 Client method (`web/src/lib/api.ts`, C's own block, added after `api.library`, before `chat`):**

```ts
export type AuditRow = {
  id: string; actor: string | null; action: string;
  resource: string | null; detail: Record<string, unknown>; created_at: string;
};
export type AuditQuery = {
  limit?: number; cursor?: string | null;
  action?: string;
  actor?: string | null;      // R-C2: the STRING "null" asks for `actor IS NULL`; null/'' = no filter
  resource?: string; from?: string; to?: string;
};

// inside `export const api = { ... }`
audit: {
  list: (q: AuditQuery = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) {
      if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
    }
    const qs = p.toString();
    return request<{ rows: AuditRow[]; limit: number; next_cursor: string | null }>(
      `/audit${qs ? `?${qs}` : ""}`
    );
  },
},
```

**C3.7 `requireAdmin` — C's obligations (the body lives in B; do not duplicate it).**

The function body is **defined once, in `server/src/middleware/require-admin.ts`, in §B3.6**, and C must **import it, not re-write it**. C's obligations are exactly these:

1. **Mount it:** `server/src/app.ts` becomes `app.use('/api/audit', authMiddleware, requireAdmin, auditRouter)` (§C-D6, §C3.1). Order is `authMiddleware` **then** `requireAdmin` — reversed, `req.user` is never set and every request 403s.
2. **Handle its refusal:** `describeError(err) === 'forbidden'` renders the access-denied message (§C3.8 step 8); `T-C9` proves the mapping with the pure function, `T-C10` proves the mount calls `requireAdmin`.
3. **Do not change its status code.** It is `403 {"error":"Forbidden"}`, decided once in **§B-D10b** (superseding round 1's `401`); §C3.4's table, `T-C9`, `T-C10`, §C5 CR3/CR6 and §C7 CQ1 all read from that decision, not from local prose.

**What it enforces (R-B1), stated precisely:** "a verified principal is present". It does **not** distinguish one admin from another. `GET /api/audit` stays "authenticated-only" for every real caller and nothing is weakened. What changes is the **failure mode**: forgetting `authMiddleware` in front of this router now yields `403`, not an open admin endpoint. Follow-up **FU-C1** (`role` column + JWT claim) is what makes the distinction real. The `403` branch is therefore **unreachable through the real mount today** (CQ1 accepts this; AC6 is satisfied by the *handling*, proven by a pure function).

**C3.8 `web/src/app/dashboard/audit/page.tsx` — the literal page contract (R-C1).**

**C3.8.1 Module surface.** The component file imports, and defines, exactly this:

```ts
'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AuditRow } from '@/lib/api';
import { pickDisplayDetail, outcomeOf, formatTs, describeError } from './format';

type PageState = {
  rows:        AuditRow[];          // never sliced client-side (§C-D7, AC3)
  limit:       number | null;       // echoed server limit, null before first response
  nextCursor:  string | null;       // server-issued; null = no next page
  loading:     boolean;
  err:         unknown | null;      // never rendered raw; only through describeError
};

type Filters = { action: string; actor: string; from: string; to: string };
```

**C3.8.2 State machine (exhaustive — the page is in exactly one of these five states).** `cursorStack` is `(string | null)[]`, initialised `[null]`; `pageIndex` is `0`; every transition below is the *only* legal way state changes.

| State | Entered when | What renders | Leave on |
|---|---|---|---|
| **S0 `loading`** | mount, or any change to `pageIndex`/filters (effect start) | the existing loading idiom (text `Loading…` in the table body) — **no** empty-state text, **no** stale rows | response or error |
| **S1 `rows`** | response with `rows.length > 0` | the five-column table (§C3.8.4) + footer + `Previous`/`Next` | next request, filter change |
| **S2 `empty`** | response with `rows.length === 0` | the literal copy **`No audit events yet`** (AC4). Footer shows `Page {pageIndex+1}`; `Previous` enabled iff `pageIndex > 0`; `Next` disabled | filter change, `Previous` |
| **S3 `forbidden`** | `describeError(err) === 'forbidden'` | the access-denied message (§C3.8.5). No table, no footer | filter change / reload |
| **S4 `error`** | `describeError(err) === 'error'` (any other failure, incl. a dead server) | a visible error message (§C3.8.5). **Never a blank page, never the raw error body** (CA-8/AC4) | filter change / reload |

`describeError(err) === 'unauthorized'` is **not** a page state: the transport layer (`api.ts` → `ka:logout`) already clears the session and redirects, so the page only has to not crash while unmounted (§C-D10; inherited, must not regress).

**Transitions, stated as the effect body (this is the whole data flow):**

```ts
// one effect; the dependency array is the contract
useEffect(() => {
  let cancelled = false;                     // superseded requests must not write state
  setState(s => ({ ...s, loading: true, err: null }));
  api.audit.list({
    limit: 50,
    cursor: cursorStack[pageIndex],          // S0/S1/S2 all use pageIndex, never a counter
    action, actor, from, to,                 // '' values are dropped by api.audit.list (§C3.6)
  })
    .then(body => { if (cancelled) return;
      setState({ rows: body.rows, limit: body.limit, nextCursor: body.next_cursor, loading: false, err: null });
    })
    .catch(e => { if (cancelled) return;
      setState(s => ({ ...s, rows: [], loading: false, err: e }));
    });
  return () => { cancelled = true; };
}, [pageIndex, action, actor, from, to]);    // cursorStack is read inside, keyed by pageIndex
```

- **Filter change** (≥ 1 of `action`, `actor`, `from`, `to` changes): set `cursorStack = [null]`, `pageIndex = 0`, then let the effect run. **A filter change must never keep the old cursor** — a cursor from an unfiltered listing applied to a filtered one skips rows silently.
- **`Next` click:** only when `nextCursor !== null`; `setCursorStack(prev => [...prev, nextCursor])`, `setPageIndex(i => i + 1)`. The stack is append-only so `Previous` can pop back to an exact earlier page.
- **`Previous` click:** only when `pageIndex > 0`; `setPageIndex(i => i - 1)`; the stack is left intact so `Next` returns to the page just left.
- **Setting a filter to `''`** means "no filter" and is indistinguishable from the initial state (R-C2 for actors; the same rule for every param, §C3.6).
- **`cursor` shown in Network must be the server token verbatim** — the page never parses or constructs one (§C3.5 codec is server-only).

**C3.8.3 Helper signatures (from `./format`, §C-D5 — the page calls these and nothing else for formatting):**

```ts
pickDisplayDetail(raw: unknown): Record<string, unknown>     // flat, allow-listed, never null
outcomeOf(detail: unknown): 'success' | 'failure' | '—'    // exact match, never coerced
formatTs(iso: string, timeZone?: string): string             // 'YYYY-MM-DD HH:MM:SS', '—' on garbage
describeError(e: unknown): 'forbidden' | 'unauthorized' | 'error'
```

**C3.8.4 Table (exactly five columns, in this order)** — headers **`Timestamp` · `Actor` · `Action` · `Resource` · `Outcome`**; no `Document`/`Passage`/`Page` header anywhere (CA-10). Cells, exactly:

| Column | Cell expression | Note |
|---|---|---|
| Timestamp | `<time dateTime={row.created_at} title={row.created_at}>{formatTs(row.created_at)}</time>` | local display, raw ISO in `title` (C-D9); `T-C8` asserts `created_at` reaches the client unchanged |
| Actor | `{row.actor ?? '—'}` | `null` → em dash (failed logins, B-D7) |
| Action | `{row.action}` | verbatim; it is a closed-set string |
| Resource | `{row.resource ?? '—'}` | verbatim, **not** truncated client-side |
| Outcome | `{outcomeOf(pickDisplayDetail(row.detail))}` | `detail` is **never** rendered as an object/JSON (AC7) |

- React key: `key={row.id}` — **never the array index** (CA-1; `id` is in the payload for exactly this).
- **`attempted` is never rendered as HTML**: it can only appear inside the Outcome cell's derived text or not at all (C-3 says it is "rendered as plain text, length-capped at 64 characters, never as HTML"); React's default escaping is the guarantee, and no `dangerouslySetInnerHTML` may appear in the file.
- Footer: `Page {pageIndex + 1}`; when `nextCursor === null` the literal text **`No more events`**.
- `Previous` `disabled={pageIndex === 0}`; `Next` `disabled={nextCursor === null || loading}`.
- **No client-side slicing:** the string `slice(` must not appear in the file (T-C11/T-C13).

### C4. TEST STRATEGY — F3-C

**Fixture lifecycle (R-C5 / R-B5 — no `psql -f`, no `\o` id-file).** Audit rows are **immutable in normal operation**, so the test inserts them explicitly and deletes exactly the ids it captured. All of it happens inside `server/src/__p3c__/audit-read.test.ts`:

| Step | Action | Assertion |
|---|---|---|
| **C4.1.1 snapshot** | `SELECT count(*)::int AS c FROM public.audit_log` → `PRE_COUNT` | recorded |
| **C4.1.2 insert** | the 13-row `INSERT … RETURNING id` below, captured into `const IDS: string[]` **in insertion order** | `IDS.length === 13` |
| **C4.1.3 assert** | `T-C1 … T-C13` | every row of C4.2 |
| **C4.1.4 cleanup** | `DELETE FROM public.audit_log WHERE id = ANY($1::uuid[]);` with `IDS` | `SELECT count(*) … WHERE id = ANY($1)` ⇒ `0` |
| **C4.1.5 verify** | `SELECT count(*) FROM public.audit_log` | **equals `PRE_COUNT`** (R-B5: not "0") |

**Why 13 rows (R-C5):** the pre-fix route returns **all** rows (`LIMIT 200`, no `limit` echo, no `next_cursor`), so with `?limit=2` the pre-fix body has `rows.length === 13` while the post-fix body has `2`. With the old 7-row fixture, a test that asked for `?limit=7` could not tell the two apart. 13 rows makes every `limit` discriminator fire, and makes the tie set unambiguous.

```sql
-- 13 rows. (R-C5/R-C3) The tie set at 10:00:00Z is exactly THREE rows.
-- The last row is deliberately poisoned with sentinels UNIQUE to forbidden keys.
INSERT INTO public.audit_log (actor, action, resource, detail, created_at) VALUES
 (NULL,      'auth.login.failure',    'admin:p3c-invalid',  '{"outcome":"failure","reason":"invalid_credentials","attempted":"p3c-invalid"}','2026-11-02T10:00:00Z'), -- 1  tie
 ('admin',   'auth.login.success',    'admin:admin',        '{"outcome":"success","attempted":"admin"}',                                      '2026-11-02T10:00:00Z'), -- 2  tie
 ('admin',   'search.query',          'search:*',           '{"outcome":"success","q":"p3c","limit":10,"returned":0}',                        '2026-11-02T10:00:00Z'), -- 3  tie
 ('admin',   'ingest.upload.success', 'p3c-document:aaaa',  '{"outcome":"success","name":"p3c.txt","kind":"txt","chunk_count":2,"deduplicated":false}','2026-11-02T09:00:00Z'), -- 4
 ('p3c-user','ingest.upload.failure', 'p3c-upload:bad.docx', '{"outcome":"failure","error":"junk"}',                                          '2026-11-02T11:00:00Z'), -- 5
 ('p3c-user','search.query',          'search:public',      '{"outcome":"success","q":"p3c second","returned":3}',                            '2026-11-02T12:00:00Z'), -- 6
 ('admin',   'ingest.upload.success', 'p3c-document:bbbb',  '{"outcome":"success","name":"b.txt","chunk_count":1}',                            '2026-11-02T13:00:00Z'), -- 7
 ('admin',   'search.query',          'search:trusted',     '{"outcome":"success","q":"p3c third","returned":1}',                             '2026-11-02T08:00:00Z'), -- 8
 ('p3c-user','auth.login.success',    'admin:p3c-user',     '{"outcome":"success","attempted":"p3c-user"}',                                   '2026-11-02T07:00:00Z'), -- 9
 ('admin',   'ingest.upload.failure', 'p3c-upload:x.pdf',   '{"outcome":"failure","error":"unsupported"}',                                    '2026-11-02T06:00:00Z'), -- 10
 ('p3c-user','ingest.upload.success', 'p3c-document:cccc',  '{"outcome":"success","name":"c.md","chunk_count":5,"deduplicated":true}',        '2026-11-02T05:00:00Z'), -- 11
 ('admin',   'auth.login.failure',    'admin:p3c-other',    '{"outcome":"failure","reason":"invalid_credentials","attempted":"p3c-other"}',    '2026-11-02T04:00:00Z'), -- 12
 ('admin',   'ingest.upload.success', 'p3c-document:bbbb',  '{"outcome":"success","name":"b.txt","chunk_count":1,
      "password":"L3AK_PASSWORD_SENTINEL_9f2a","token":"L3AK_TOKEN_SENTINEL_4c7d",
      "blob":{"nested":"L3AK_NESTED_SENTINEL_1e5b"}}',                                                                                               '2026-11-02T14:00:00Z'); -- 13 POISON
```

**R-C3 — the poison row.** The two sentinels (`L3AK_PASSWORD_SENTINEL_9f2a`, `L3AK_TOKEN_SENTINEL_4c7d`) and the nested one (`L3AK_NESTED_SENTINEL_1e5b`) appear **only** under forbidden keys, so a response that contains any of those strings proves a forbidden value reached the wire — regardless of whether the key name survived. The old fixture used the sentinel `LEAK` under both `password` and `token`, which could also have matched harmless text.

**Tie set, corrected (C12 in the review):** exactly **three** rows share `2026-11-02T10:00:00Z` (`admin:p3c-invalid`, `admin:admin`, `search:*`) — rows 1-3 above. Rows 4-13 are all distinct timestamps. The old text said "four" and referred to a row that does not exist.

**Automated — `server/src/__p3c__/audit-read.test.ts`** (`npx tsx`, real server on `:4000`, Node `assert`). Every expectation is an exact value; "discriminates" names the pre-fix behaviour that makes the assertion fail.

| ID | Request | Expected (exact) | Discriminates (pre-fix behaviour) |
|---|---|---|---|
| **T-C1** | the gate: run the whole file against the **unmodified** `audit.ts` | the file exits `1`. The pre-fix body for `?limit=2` is `{rows:[…13 rows…]}` — **no `id` key inside rows**, **no `limit` key**, **no `next_cursor` key**, **`?action=` ignored (13 rows)**, **`?actor=null` ignored**, **`?from=hello` → 200 not 400** | it is the gate: proves the suite is not vacuous |
| **T-C2** | `?limit=2` (first page) | status `200`; `Object.keys(body)` deep-equals `['rows','limit','next_cursor']`; `body.rows.length === 2`; `body.limit === 2`; `typeof body.next_cursor === 'string'` (**C-2: a probe row existed, so the cursor is emitted**); `body.rows[0].resource === 'p3c-document:bbbb'` (the 14:00 poison row) and `body.rows[1].resource === 'p3c-document:bbbb'` (the 13:00 row) — **both ordered by `created_at DESC`**; every row has a `string` `id` | pre-fix returns **13** rows and has no `limit`/`next_cursor` |
| **T-C3** | page through `?limit=2` + `next_cursor` until `null`; **the test issues a request for every page, including the terminal one, and stops only after a response with `next_cursor === null`** | **exactly 7 requests, producing 13 rows: `[2,2,2,2,2,2,1]`** — the 7th request returns `rows.length === 1`, **`next_cursor === null`** (**C-2/CQ2: no trailing empty page**; an 8th request must **never** be issued, and if the loop needs one the test fails). The union of ids equals `IDS` as a **set** (`new Set(all).size === 13`), **no duplicates**; **request #6 is a FULL page (`rows.length === 2`) whose `next_cursor` is still a string** (because row 13 exists) — this is the positive control for the `hasMore` rule, and the `rows.length === limit` rule cannot be distinguished from it; the discriminator is the 7th page (a full-page rule would emit a cursor there and force an 8th, empty response). The **three** `10:00:00Z` rows appear consecutively and in **`id DESC`** order (compared against `IDS.slice(0,3).sort().reverse()`) | pre-fix has no cursor at all → request 2 cannot be formed |
| **T-C3b** | **`T-C3b` — cursor-rule discriminator (replaces the single-leg form). (C-2 / R4-C/1)** Two legs, both on the same 13-row fixture: **Leg 1 (full final page, the case the old form got wrong):** `?limit=13`. The `LIMIT 14` probe finds nothing ⇒ `hasMore === false` ⇒ **`next_cursor === null` and `results.length === 13`**. The broken rule (`rows.length === limit`) also yields `null` here, so **this leg alone proves nothing** — it is retained only as the regression guard for "no trailing empty page". **Leg 2 (the actual discriminator):** `?limit=12`. `LIMIT 13` finds 13 rows ⇒ `hasMore === true` ⇒ pop the probe ⇒ `results.length === 12`, **`next_cursor !== null`**, and following that cursor returns the remaining **1** row with `next_cursor === null`. **Correction (R4-C/1): leg 2 does not separate the rules either** — on 13 rows at `limit=12`, `rows.length 12 === limit 12` also emits a cursor — **so the two rules agree on leg 2 as well**; the discriminating assertion is instead: **Leg 3 (the one that truly separates them):** `?limit=13` on a fixture where the **exact multiple** case is exercised — 13 rows, `limit=13`: `LIMIT 14` ⇒ no probe row ⇒ `next_cursor === null`. Now delete one row and re-run `?limit=12` on 12 rows: `LIMIT 13` ⇒ no probe row ⇒ `next_cursor === null`, whereas the broken rule (`rows.length 12 === limit 12`) emits a **non-null cursor pointing at an empty page**. **Assert: `next_cursor === null` here.** This is the assertion that fails under the old rule and passes under `LIMIT+1`. **Record in the test's comment:** *legs 1–2 are shape guards; leg 3 is the discriminator; a run that reports leg 3 as PASS without the "delete one row" precondition BLOCKS.* | pre-fix: no `next_cursor` key at all. A `rows.length === limit` implementation: **leg 3** returns a non-null cursor where `null` is required (legs 1 and 2 pass under **both** rules and therefore cannot gate) |
| **T-C4** | (R-C2 matrix) `?action=search.query` → `3` rows. `?action=ingest.upload.success&actor=admin` → `2` rows (`p3c-document:bbbb` ×2). `?actor=p3c-user` → `3` rows. **`?actor=null`** → **`2` rows**, both with `actor === null` (`admin:p3c-invalid`, `admin:p3c-other`). **`?actor=`** (empty) → **`13` rows** (absent filter). `?action=auth.login.failure&actor=null` → `2` rows | pre-fix ignores every filter (13 rows each) |
| **T-C5** | `?from=2026-11-02T10:30:00Z&to=2026-11-02T12:30:00Z`; then `?from=2026-11-02T11:00:00Z&to=2026-11-02T11:00:00Z` | first → exactly rows 5 and 6 (`p3c-upload:bad.docx` @11:00, `search:public` @12:00), 2 rows; second → exactly 1 row (`p3c-upload:bad.docx`) — **inclusive on both bounds** | pre-fix ignores from/to |
| **T-C6** | **AC7 poison (R-C3)**: `?resource=p3c-document:bbbb&limit=1` (the 14:00 row) | `JSON.stringify(body).includes('L3AK_PASSWORD_SENTINEL_9f2a') === false`; `…includes('L3AK_TOKEN_SENTINEL_4c7d') === false`; `…includes('L3AK_NESTED_SENTINEL_1e5b') === false`; the row's `detail` has **no** `password`, **no** `token`, **no** `blob` key; `body.rows[0].detail.outcome === 'success'` and `detail.name === 'b.txt'` and `detail.chunk_count === 1` (the object is narrowed, not blanked).
**(C-3) List equality, asserted in the same test by importing both constants:** `assert.deepEqual([...SERVER_DISPLAY_KEYS], [...DISPLAY_DETAIL_KEYS])` (imported from `server/src/routes/audit.ts` and `web/src/app/dashboard/audit/format.ts` — a test may import across the tree; product code may not) and `assert.deepEqual([...SERVER_DISPLAY_KEYS], ['outcome','reason','attempted','name','kind','access_policy','chunk_count','deduplicated','error','q','returned','limit'])` — **same set and same order**. **(C-3) `attempted` survives the read path:** `GET /api/audit?resource=admin:p3c-invalid` ⇒ `rows[0].detail.attempted === 'p3c-invalid'` and `rows[0].detail.reason === 'invalid_credentials'`; `GET /api/audit?resource=admin:p3c-other` ⇒ `rows[0].detail.attempted === 'p3c-other'` | pre-fix returns `detail` verbatim → all three sentinels appear; a picker without `attempted` drops both keys above → the two `attempted` assertions fail |
| **T-C7** | `?action=nope`; `?from=hello`; `?to=hello`; `?from=2026-12-01T00:00:00Z&to=2026-11-01T00:00:00Z`; `?limit=0`; `?limit=9999`; `?cursor=garbage`; `?limit=abc` | `400 {"error":"Unknown action filter"}`; `400 {"error":"Invalid from timestamp"}`; `400 {"error":"Invalid to timestamp"}`; `400 {"error":"from must be <= to"}`; `200` with `limit === 1`; `200` with `limit === 200`; `200` **page 1** (`rows[0].created_at` is the 14:00 row); `200` with `limit === 50` | pre-fix: **never 400**, ignores `limit` |
| **T-C8** | `?limit=1` | `body.rows[0].created_at === '2026-11-02T14:00:00.000Z'` (**`Date.parse` equality**, exact `Z` form; not the `+07:00` shift) | pre-fix already emits `Z` — this is a **contract** test, not a discriminator (stated) |
| **T-C9** | **(R-C1)** pure-function test, no `fetch`: `describeError(new Error('Forbidden')) === 'forbidden'`; `describeError(new Error('Unauthorized')) === 'unauthorized'`; `describeError(new Error('Failed to load audit log')) === 'error'`; `describeError(null) === 'error'`; `describeError('Forbidden') === 'error'` (a string is not an `Error`) | as listed | the page has no error-classification logic today — this replaces the old stub-`fetch` test, which proved nothing about the page |
| **T-C10** | no `Authorization` → `401`; garbage token → `401`; **mount proof**: `createApp()._router.stack` contains a layer whose `regexp` matches `/api/audit` and whose route stack is `[authMiddleware, requireAdmin, auditRouter]` in that order (read-only introspection, no mock). **Plus the R-B1 unit**: call `requireAdmin({} as any, fakeRes, next)` with **no `req.user`** ⇒ `fakeRes.status` called with `403`, `fakeRes.json` called with `{error:'Forbidden'}`, and `next` **not** called; with `req.user = {username:'admin'}` ⇒ `next` called once | mount, not enforcement — labelled as such; pre-fix has no `requireAdmin` in the chain |
| **T-C11** | source-level, both files | `grep -c 'api.search' web/src/app/dashboard/audit/page.tsx` ⇒ `0`; `grep -c 'slice(' …` ⇒ `0`; `grep -c 'api.audit.list(' …` ⇒ `>= 1` | both strings exist today (`:13`, `:16`) |
| **T-C12** | **(R-C5)** *temporarily emptied table*: `DELETE … WHERE id = ANY($1)` with `IDS` first, **pre-assert** `SELECT count(*) FROM public.audit_log` ⇒ `0` (if not 0 the test **skips with exit 2 = BLOCKED**, it does not silently pass), then `GET /api/audit` | status `200`; body deep-equals `{rows: [], limit: 50, next_cursor: null}` — **exactly three keys** | pre-fix returns `{rows: []}` (no `limit`, no `next_cursor`) ⇒ discriminates on the envelope |
| **T-C13** | **(R-C1)** source-level page contract | `page.tsx` source contains `describeError(`, `api.audit.list(`, the literal `No audit events yet`, `outcomeOf(`, `formatTs(`, `pickDisplayDetail(`; and contains **none** of `api.search`, `slice(`, `"Passage"`, `"Page"` as a table header | none of these exist today |
| **T-C13b** | **(C-5) URL→bind plumbing, three branches:** `?from=2026-11-02T10:00:00Z&to=2026-11-02T05:00:00Z`; `?from=not-a-date`; `?from=2026-11-02T05:00:00Z` | first ⇒ `400 {"error":"from must be <= to"}`; second ⇒ `400 {"error":"Invalid from timestamp"}`; third ⇒ `200` with **only** rows at/after that instant — **exactly 11 rows** (14:00, 13:00, 12:00, 11:00, 10:00, 10:00, 10:00, 09:00, 08:00, 07:00, and the 05:00 row bound as `>=`), i.e. `rows.length === 11` at `limit=200`; and `rows.every(r => new Date(r.created_at) >= new Date('2026-11-02T05:00:00Z'))`, and the test **fails if `$4` is bound as `null`** (the "silently dropped" discriminator: with `$4` null the same request returns **13** rows) | pre-fix: `?from=not-a-date` → `200`, and every `from` is ignored (13 rows) |
| **T-C13c** | **(C-2/C-3 read-back)** `GET /api/audit?limit=1` against the poison row | `Object.keys(body.rows[0].detail)` deep-equals `['outcome','name','kind','chunk_count']` **in that order** — i.e. the server's picker emits keys in `SERVER_DISPLAY_KEYS` order, not insertion order of the stored JSON | pre-fix returns the stored key order incl. `password`/`token`/`blob` |
**Harnesses (R-C5 — rescoped so neither is vacuous):**

1. **`web/scripts/f3c-audit.mjs`** — *client URL plumbing only*, and it says so in its header. Asserts: `api.audit.list({action:'search.query',limit:2})` issues a request whose path is exactly `/audit?limit=2&action=search.query`; **`api.audit.list({from:'2026-11-02T05:00:00Z',to:'2026-11-02T06:00:00Z'})` issues a path containing `from=2026-11-02T05%3A00%3A00Z` and `to=2026-11-02T06%3A00%3A00Z`** (C-5: proves the client side of the URL→bind chain actually sends the bounds, not just that the server accepts them); `api.audit.list({cursor:null, actor:'', limit:undefined})` issues `/audit` (no empty params); `api.audit.list({actor:'null'})` issues `/audit?actor=null` (R-C2); a `401` response fires `ka:logout` **exactly once** and clears `localStorage` (the F2-B latch, `api.ts:61-66` [V] — **already proven in `f2b-hydration.mjs`; asserted here only as a regression, not as new evidence**). **This harness makes no claim about AC1/AC2/AC9** — that was the reviewer's objection to its old scope.
2. **`server/src/__p3c__/page-format.test.ts` (NEW, R-C1)** — the pure-helper suite. `npx tsx`, no DOM, no server; imports **only** `web/src/app/dashboard/audit/format.ts` (a *test* may import across the tree; product code may not — D1/D6). **The eight gated assertions are F1–F8 below, defined in full (C-4).**

#### C4.4 `page-format.test.ts` — F1..F8 (C-4: every ID that §F2 gates is defined here)

| ID | Assertion (exact) |
|---|---|
| **F1** | `pickDisplayDetail({outcome:'success',q:'x',secret:'s'})` → `{outcome:'success', q:'x'}` — unknown keys dropped |
| **F2** | `pickDisplayDetail({attempted:'p3c-invalid',reason:'invalid_credentials'})` → both keys retained (proves C-3) |
| **F3** | `pickDisplayDetail(null)` and `pickDisplayDetail(undefined)` → `{}`, never `null` and never a throw |
| **F4** | `outcomeOf({outcome:'failure'})` → `'failure'`; `outcomeOf({})` → `'—'`; `outcomeOf({outcome:42})` → `'—'` |
| **F5** | `formatTs('2026-11-02T07:41:20.004Z')` → deterministic `YYYY-MM-DD HH:MM:SS`; `formatTs(garbage)` → `'—'` |
| **F6** | `describeError(new Error('Forbidden'))` → `'forbidden'`; `…('Unauthorized')` → `'unauthorized'`; `…('boom')` → `'error'` |
| **F7** | `formatTs` is timezone-stable: the same input yields the same output under `TZ=UTC` and `TZ=Asia/Bangkok` |
| **F8** | `pickDisplayDetail` never returns a key outside the C-3 allow-list, for a row containing every forbidden key name in one object |

**How each row is made exact (so none of them is vacuous):**
- **F1 = deep-equal, not subset**: `assert.deepEqual(out, {outcome:'success', q:'x'})`; the `secret` key must be absent, and the key order must be `SERVER_DISPLAY_KEYS` order (`outcome` before `q`).
- **F2 is the C-3 regression guard.** Under the pre-fix (round-2) key list, `attempted` was absent, so `out` is `{reason:'invalid_credentials'}` and the deep-equal fails. `assert.deepEqual(Object.keys(out), ['reason','attempted'])` also pins the **order** (`reason` precedes `attempted` in `DISPLAY_DETAIL_KEYS`).
- **F3**: `assert.deepEqual(pickDisplayDetail(null), {})`, `…(undefined)`, and `assert.notStrictEqual(out, null)`; no `try`/`catch` in the test — a throw fails the run.
- **F5's exact string**: with `timeZone:'UTC'`, `formatTs('2026-11-02T07:41:20.004Z','UTC') === '2026-11-02 07:41:20'` — asserted as that literal, and `assert.match(out, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)` for the default-TZ call. `formatTs('garbage') === '—'` and `formatTs('') === '—'`.
- **F6** also asserts the case-insensitivity of the match used by `describeError` (`'FORBIDDEN'` → `'forbidden'`) and that a bare string `'Forbidden'` (not an `Error`) maps the same way, because `api.ts` throws `new Error(<body>.error)` and the body text is what is matched.
- **F7 is run as two child processes**, not two calls in one process: the suite shell-out is `TZ=UTC npx tsx src/__p3c__/page-format.test.ts --f7 > a.txt` and `TZ=Asia/Bangkok … > b.txt`, and the parent asserts the two lines are **equal** and that the `UTC` line equals `'2026-11-02 07:41:20'` (a `formatTs` that used `toISOString()` would differ between the two and fail).
- **F8** feeds `{outcome:'success', password:…, token:…, jwt:…, authorization:…, auth:…, secret:…, cookie:…, text:…, content:…, body:…, extract:…, prompt:…, meta:{token:'x'}, blob:{nested:1}}` and asserts `Object.keys(out).every(k => DISPLAY_DETAIL_KEYS.includes(k))` **and** `JSON.stringify(out)` contains none of the sentinel substrings.

**Commands (exact):**

```bash
cd server && npx tsc --noEmit
cd web    && npx tsc --noEmit
cd web    && npx next build                                     # /dashboard/audit must compile
cd server && npx tsx src/index.ts > ../.pipeline/p3/f3c-server.log 2>&1 &
cd server && npx tsx src/__p3c__/audit-read.test.ts               # T-C1..T-C13 (owns its fixture)
cd server && npx tsx src/__p3c__/page-format.test.ts              # format.ts pure helpers
node --import ./server/node_modules/tsx/dist/loader.mjs web/scripts/f3c-audit.mjs
DBURL=$(grep -E '^DATABASE_URL=' server/.env | cut -d= -f2- | tr -d '\r')
"D:/Install/PostgreSQL/18/bin/psql.exe" "$DBURL" -tAc "select count(*) from public.audit_log;"     # == PRE_COUNT
grep -n "api.search\|slice(" web/src/app/dashboard/audit/page.tsx                                 # -> no matches
sha256sum -c .pipeline/p3/baseline.sha256
```

**(R-B5) There is no `seed.sql` and no `.pipeline/p3/f3c-fixture-ids.txt`.** The ids live in the test process, from `INSERT … RETURNING id`; a file written by `psql -f` cannot be trusted to match what the process inserted, and a stale file would delete another run's rows. The Implementer must not use `LIKE`-based deletion (`admin:admin` and `search:*` are values real events produce).


**Manual / browser evidence:** the browser steps are **not** listed here twice — they are **M-1 … M-14** in the §C-GATE manual-only table below, which also states, per step, the automated row that backs it. Perform them in order and paste the transcript (with the Network-tab lines) into `TEST-REPORT.md`.

### C-GATE. ACCEPTANCE-CRITERION → TEST GATE — F3-C (every AC of `REQUEST.md` §F3-C, one row each)

A part is **PASS** only when every row below is green. Every AC has at least one **automated** row; the manual rows are listed a second time under "manual-only" so nothing automated is smuggled into the browser transcript.

| AC (`REQUEST.md` §F3-C) | Requirement, restated | Automated | Expected value | Manual-only? |
|---|---|---|---|---|
| **AC1** — the page uses `api.audit.list`, never `api.search` | The page reads the audit endpoint only. | **T-C11**, **T-C13**, harness `f3c-audit.mjs` | `grep -c 'api.search' web/src/app/dashboard/audit/page.tsx` ⇒ **0**; `grep -c 'api.audit.list('` ⇒ **≥ 1**; harness: `api.audit.list({action:'search.query',limit:2})` requests the path **exactly** `/audit?limit=2&action=search.query`. | No |
| **AC2** — columns Timestamp, Actor, Action, Resource, Outcome | Exactly those five headers, in that order, and no others. | **T-C13** *(static: the five header literals are present in that order, and `Passage`/`Page`/`Document` are absent)* + **F4/F5** (the cell renderers) | `T-C13` passes only if all five literals appear in the file **in order**; `F4({outcome:'failure'}) === 'failure'`, `F4({}) === '—'`; `F5('2026-11-02T07:41:20.004Z','UTC') === '2026-11-02 07:41:20'`. | Step **M-2** (visual) |
| **AC3** — pagination consistent, page size + next/prev, no client-side slicing | Server-issued cursor, `limit` echoed, `LIMIT+1`, no `slice(` anywhere. | **T-C2, T-C3, T-C3b, T-C12**, `T-C11` (the `slice(` grep) | `T-C2`: `limit === 2`, `next_cursor` is a string. `T-C3`: **7 requests → 13 rows** `[2,2,2,2,2,2,1]`, terminal `next_cursor === null`, request #6 is full **with** a cursor. `T-C3b`: **leg 3** (`?limit=12` on 12 rows after deleting one) ⇒ `next_cursor === null`; legs 1–2 are shape guards only. `grep -c 'slice('` ⇒ **0**. | Step **M-7** (buttons) |
| **AC4** — loading / empty / error states | Three visible states, exact empty copy. | **T-C12** (empty envelope) + **C3.8.2** state machine + **T-C13** (`No audit events yet` literal present) + **F3/F6** | `T-C12`: body deep-equals `{rows: [], limit: 50, next_cursor: null}` (**exactly 3 keys**). `T-C13`: the literal `No audit events yet` is in the source; `describeError` present. `F3`: the picker never throws (so the error branch cannot be a crash). | Steps **M-8** (empty) and **M-9** (dead server) |
| **AC5** — filters wired to real request params | `action`/`actor`/`resource`/`from`/`to` reach the SQL as bind values. | **T-C4, T-C5, T-C7, T-C13b**, harness (the `from`/`to` URL assertion) | `T-C4`: `?action=search.query` ⇒ **3** rows; `?actor=null` ⇒ **2**; `?actor=` ⇒ **13**; `?action=auth.login.failure&actor=null` ⇒ **2**. `T-C5`: 10:30–12:30 ⇒ **2** rows, exact-bound 11:00–11:00 ⇒ **1**. `T-C7`: 4× `400` bodies exactly as §C3.4. `T-C13b`: inverted ⇒ `400 'from must be <= to'`; `not-a-date` ⇒ `400 'Invalid from timestamp'`; `?from=05:00Z` ⇒ **11** rows (13 if `$4` were null). Harness: the request path contains the `from`/`to` values. | Step **M-6** (Network tab) |
| **AC6** — a 403 yields the access-denied state | `describeError` maps it; the page renders it. | **T-C9** *(pure, `describeError(new Error('Forbidden')) === 'forbidden'`)*, **T-C10** *(mount: the chain contains `requireAdmin`)*, **F6** | `F6`: `'forbidden'`, `'unauthorized'`, `'error'` for the three inputs; `T-C10`: with `req.user` absent the chain responds `403 {"error":"Forbidden"}` and does not call `next`. | **M-14** (only if a 403 can be induced) |
| **AC7** — no sensitive `detail` rendered | Neither the server nor the client picker may emit a forbidden value. | **T-C6, T-C13c**, **F1, F2, F8** | `T-C6`: none of `L3AK_PASSWORD_SENTINEL_9f2a` / `L3AK_TOKEN_SENTINEL_4c7d` / `L3AK_NESTED_SENTINEL_1e5b` appears in the response; `detail` has no `password`/`token`/`blob`; the three key lists are deep-equal and in order; `detail.attempted` survives. `T-C13c`: key order is `['outcome','name','kind','chunk_count']`. `F1/F8`: no key outside the allow-list; no sentinel survives. | Step **M-5** |
| **AC8** — existing styling/conventions preserved | The page keeps the app's table/card idiom. | **none (no DOM runner in this repo)** | — | **Manual only — M-1/M-2** (accepted: `REVIEW.md` §7 rules this acceptable) |
| *(cross-cutting: the pre-fix gate)* | The suite must fail on the unmodified tree. | **T-C1** | Exit code **1** on unmodified `audit.ts`; every other C row passes only after the rewrite. | No |

**Manual-only checks for C — the explicit list.** These are the **only** checks in C that a human must perform, and each states what automated evidence backs it. Nothing else in C may be satisfied by a browser.

| ID | Step | Pass condition | Backs |
|---|---|---|---|
| **M-1** | Login → click **Audit** in the sidebar. | The page renders a table (not an error, not a blank), and the sidebar entry is highlighted. | AC8 (styling/nav), AC1 (end-to-end wiring) — automated half: T-C11/T-C13 |
| **M-2** | Read the header row. | Exactly **Timestamp · Actor · Action · Resource · Outcome**; **no** "Document"/"Passage"/"Page" header (CA-10). | AC2 — automated half: T-C13 |
| **M-3** | Read any `ingest.upload.success` row. | Reads e.g. `2026-11-02 14:41:20 | admin | ingest.upload.success | document:3f2b… | success` — timestamp local, resource verbatim. | AC2/AC7 — automated half: T-C8 |
| **M-4** | Find an `auth.login.failure` row. | **Actor = `—`** (em dash) and **Outcome = `failure`**. | AC2 — automated half: T-C4 (`?actor=null`), F4 |
| **M-5** | Scan every Outcome cell and the page source. | No cell contains a JSON object or the string `{`; no `L3AK_` sentinel appears anywhere on the page **or** in any response body (DevTools → Network → Response). | AC7 — automated half: T-C6, T-C13c, F1/F8 |
| **M-6** | Set the **Action** filter to `search.query`. | A **new** request with `?action=search.query` appears in Network, the table shrinks **and the row count changes only together with that request** (no client-side filtering). | AC5 — automated half: T-C4, harness |
| **M-7** | Click **Next**, then **Previous**, then page to the end. | `?cursor=…` request; rows change; `Previous` returns the *first* page's rows and is greyed out on page 1; on the last page `Next` is greyed out **and** the footer reads `No more events` — **no extra empty page** (C-2/CQ2). | AC3 — automated half: T-C3, T-C3b |
| **M-8** | Empty state (with `audit_log` emptied for the duration of `T-C12`). | The page shows **exactly** `No audit events yet` and the tab is not on an error. | AC4 — automated half: T-C12, T-C13 |
| **M-9** | Stop the server (or point `API` at a dead port) and reload. | A visible error message — **not** a blank page, **not** a raw stack. | AC4 — automated half: F6 (`'error'` branch), C3.8.2 S4 |
| **M-10** | Delete `localStorage["ka_token"]` and click Next. | Redirected to `/login` (inherited `api.ts:61-66`; must not regress). | AC4/AC6 — automated half: harness (the `ka:logout` regression assertion) |
| **M-11** | Count `audit_log`, sign out, count again. | **Equal** — no `auth.logout` row was invented (B-D6 honesty check). | AC2 (read side) — automated half: T-B21 |
| **M-12** | Inspect a `search.query` row's Outcome cell. | It is `success`; **no query text is rendered** anywhere in the table (q lives only in `detail`, deliberately not a column). | AC7 — automated half: F1, T-C6 |
| **M-13** | Edit the request URL to `?actor=null` (the UI need not expose it). | The two NULL-actor rows appear and every other row disappears; clearing the field restores all rows. | AC5 — automated half: T-C4 |
| **M-14** | *(only if a 403 can be induced — today it cannot through the real mount)* render the forbidden branch. | The access-denied message appears, with no table and no footer. | AC6 — automated half: T-C9, T-C10, F6. **Not required for PASS**: CQ1 accepts that the branch is unreachable today, and it is proven by a pure function. |

---

### C5. RISKS / ASSUMPTIONS — F3-C

| # | Risk | Mitigation |
|---|---|---|
| CR1 | Keyset paging cannot jump to page 7, only Next/Prev. | Accepted (C-D7); an audit log is read sequentially. Follow-up **FU-C3** if a jump is wanted (`from`/`to` filtering is the intended way to reach a point in time). |
| CR2 | ~~`next_cursor` derived from a full page produces one extra empty page.~~ **RESOLVED by CQ2 / R-A3, and re-closed in round 3 by C-2** (the prose rule that contradicted §C3.5 is gone). | T-C3 asserts 7 requests → 13 rows with a terminal `rows.length === 1`, `next_cursor === null`; **T-C3b** asserts the exact-multiple case (`?limit=13` ⇒ `next_cursor === null`, plus leg 3's delete-one-row run), which is the only **assertion** that separates the two rules; `T-C2`'s page-count check corroborates it; M-7 checks the greyed-out `Next`. |
| CR3 | `requireAdmin` cannot distinguish one authenticated admin from another (no `role` column). | Documented in code and in `RESULT.md`; **not** presented as a role check. R-B1 means it *does* 403 a request with no `req.user`, so it cannot be reduced to a bypass. |
| CR4 | Reading `detail` and re-picking keys means the response is **narrower** than the stored row; a future consumer wanting another key must change C. | Deliberate (C-D5): the display allow-list is a security boundary. |
| CR5 | ~~`?actor=` cannot express "actor IS NULL".~~ **RESOLVED by R-C2:** `?actor=null` (literal) ⇒ `WHERE actor IS NULL`; `?actor=` (empty) ⇒ absent. | T-C4 asserts both states; §C3.2 documents the collision note. |
| CR6 | The 403 path is unreachable end-to-end through the real mount today (it needs FU-C1). | Proven by a **pure function** (`describeError`, T-C9) plus the `requireAdmin` no-`req.user` unit (T-C10) — stated as a limitation of the *mount*, not of the test. |
| CR7 | I did not run `next build`, so `/dashboard/audit` compiling with the new client types is [U]. | It is a command in the C gate, not an assumption. |
| CR8 | **(R-C1, C-3)** `format.ts` duplicates the display key list that `routes/audit.ts` also holds, so the two can drift. | **T-C6 imports both constants and asserts `deepEqual` as a set and in order**, so drift is a *test failure*, not a code review. The two-place list is deliberate: `web/` must not import `server/` in product code. |
| CR9 | **(NQ1)** No index on `action`/`actor`, so filtered reads scan. | Accepted at 0 rows [V]; **FU-B10**. |
| CR10 | **(R-C5)** `T-C12` deletes the fixture mid-run to test the empty state, so a crash between the delete and the restore leaves the table empty. | The delete is by captured ids only, the table is at `PRE_COUNT` afterwards by the same mechanism, and the whole run is re-runnable (the fixture is inserted at the start every time). `audit_log` at 0 is also the documented baseline [V]. |

### C6. OUT OF SCOPE — F3-C (follow-ups only)

- **FU-C1** Real roles: `admins.role` column, `role` claim in the JWT (`auth.ts:27` [V]), `requireAdmin` body, and a re-login story.
- **FU-C2** Actor-set filter / a non-colliding "actor IS NULL" spelling (R-C2 makes the literal `null` work today; this is only about a nicer spelling and multi-value).
- **FU-C3** Page-number jump / total count for audit.
- **FU-C4** Audit export (CSV/JSON) — explicitly out (`REQUEST.md:55`).
- **FU-C5** Live tail / auto-refresh.
- **FU-C6** `detail` drill-down modal (beyond Outcome) — would need a much tighter allow-list per action.
- **FU-C7** Retention controls surfaced in the UI.

### C7. OPEN QUESTIONS — F3-C *(all three ruled in round 1; recorded closed)*

| # | Ruling | Effect in this plan |
|---|---|---|
| **CQ1** | **Yes — a documented-unreachable 403 is acceptable**, provided `requireAdmin` rejects a missing `req.user` (R-B1) and the UI branch is proven by a **pure** function rather than a stubbed scope. | §C3.7 (obligations), §B3.6 (the one body), T-C10 (mount), T-C9 + `describeError` (pure), **T-B23** (B's own unit). Status is **403**, decided in §B-D10b. |
| **CQ2** | **Use `LIMIT+1`** and suppress the cursor when no extra row exists. | §C-D1, §C3.3 (the rule, C-2), §C3.5 (`LIMIT $8 + 1` + "Order matters"), T-C3, **T-C3b**, M-7, CR2 (resolved). |
| **CQ3** | **Do not display `id`** — correct. It must still be returned (React key + cursor input). | §C3.3 keeps `id` in the payload; the header list in §C3.8 has no `id` column. |

---

## F. CROSS-PART: FILE TOUCH MATRIX, GATES, BASELINE

### F1. Files by part (proves D1–D6; **updated**: `audit/format.ts` added, `db/schema.ts` removed, `seed.sql` ×2 removed)

| File | A | B | C | Notes |
|---|---|---|---|---|
| `server/src/routes/library.ts` | **edit** | — | — | §A3 |
| `web/src/lib/api.ts` | **edit** (`api.library` block) | — | **edit** (`api.audit` block) | different blocks, sequential (D2) |
| `web/src/app/dashboard/library/page.tsx` | **edit** | — | — | A4.4 |
| `server/src/__p3a__/library.test.ts` | **new** | — | — | owns its fixture (R-A2) |
| `web/scripts/f3a-library.mjs` | **new** | — | — | A4.4 |
| `server/src/audit/events.ts` | — | **new** | — | taxonomy |
| `server/src/audit/sanitize.ts` | — | **new** | — | **`sanitizeResource` included (R-B3); no `sanitizeDetailDenyOnly` (NQ2)** |
| `server/src/audit/log.ts` | — | **new** | — | `recordAudit` (R-B6) |
| `server/src/middleware/require-admin.ts` | — | **new** | — | §B3.6 body (R-B1); imported/mounted by C only |
| `server/src/routes/auth.ts` | — | **edit** (2 call sites) | — | §B3.4 |
| `server/src/routes/ingest.ts` | — | **edit** (2 call sites) | — | §B3.4 |
| `server/src/routes/search.ts` | — | **edit** (1 call site) | — | §B3.4 |
| `server/src/__p3b__/sanitize.test.ts` | — | **new** | — | T-B1..T-B6, T-B19, **T-B21** |
| `server/src/__p3b__/audit-write.test.ts` | — | **new** | — | T-B7..T-B15, T-B15b, T-B17, **T-B20, T-B22, T-B23** |
| `server/src/routes/audit.ts` | not touched | **not touched** (D3) | **rewrite** | read contract |
| `server/src/app.ts` | — | — | **edit** (mount `requireAdmin` on `/api/audit`) | C3.1 |
| `web/src/app/dashboard/audit/page.tsx` | — | — | **rewrite** | C3.8 |
| **`web/src/app/dashboard/audit/format.ts`** | — | — | **new (R-C1)** | `pickDisplayDetail`, `outcomeOf`, `formatTs`, `describeError` |
| `server/src/__p3c__/audit-read.test.ts` | — | — | **new** | T-C1..T-C13, **T-C13b, T-C13c** |
| **`server/src/__p3c__/page-format.test.ts`** | — | — | **new (R-C1)** | format.ts helpers, no DOM |
| `web/scripts/f3c-audit.mjs` | — | — | **new** | URL plumbing only (R-C5) |
| ~~`server/src/db/schema.ts`~~ | — | ~~edit~~ **REMOVED (NQ1)** | — | **not touched by any part** |
| ~~`server/src/__p3a__/seed.sql`~~ | ~~new~~ **REMOVED (R-A2)** | — | — | fixture lives in the test |
| ~~`server/src/__p3c__/seed.sql`~~ | — | — | ~~new~~ **REMOVED (R-B5)** | fixture lives in the test |
| `server/src/ingest/service.ts` | untouched | untouched | untouched | F1 guarantee |
| `web/src/lib/api.ts` `search`/`chat` methods | untouched | untouched | untouched | D4 |
| `.pipeline/p3/*` | evidence | evidence | evidence | deliverables |

**No product file is touched by two parts except `web/src/lib/api.ts` (A's block, then C's block — sequential, different regions).** `db/schema.ts`, `ingest/service.ts`, and `search.ts` (for A and C) are **mutation-guarded**.


**Zero files are touched by two parts except `web/src/lib/api.ts` (A then C, different blocks).**

### F2. Gate per part (a part is PASS only when all rows are green)

| Gate | A | B | C |
|---|---|---|---|
| `cd server && npx tsc --noEmit` → 0 | ✔ | ✔ | ✔ |
| `cd web && npx tsc --noEmit` → 0 | ✔ | — (no web change) | ✔ |
| `cd web && npx next build` → "Compiled successfully" | ✔ | — | ✔ |
| Own test file(s) → 0 failed | `library.test.ts`: **T-A1..T-A14** | `sanitize.test.ts` **T-B1..T-B6, T-B19, T-B21** + `audit-write.test.ts` **T-B7, T-B7b, T-B7c, T-B8, T-B9, T-B9b, T-B10..T-B15, T-B15b, T-B17, T-B20, T-B22, T-B23** (every ID defined in §B4.2/§B4.3; §B-GATE maps each one to an AC) | `audit-read.test.ts` **T-C1..T-C13, T-C13b, T-C13c** + `page-format.test.ts` **F1..F8** (all defined, §C4.2/§C4.4; §C-GATE maps each one to an AC) |
| Own harness (`node --import …/tsx/…`) → exit 0 | `f3a-library.mjs` | — | `f3c-audit.mjs` |
| **Pre-fix mutation gate fails on old code** | **T-A1** fails on unmodified `library.ts` | **T-B7, T-B7b, T-B7c each fail on their reverted file and pass after** (R-B4) | **T-C1** fails on unmodified `audit.ts` — specifically on the missing `id`, missing `limit`, missing `next_cursor`, ignored `?action`, ignored `?actor=null`, and `?from=hello` → 200 |
| Fixture cleaned up **by captured ids**, `count(id = ANY($1)) → 0` proven | ✔ (A4.1.5) | ✔ (B4.1.4) | ✔ (C4.1.4) |
| Post-cleanup count **equals the pre-run count** | ✔ (`documents` = 0, F1 baseline) | ✔ (`audit_log` = `PRE_COUNT`) | ✔ (`audit_log` = `PRE_COUNT`) |
| Baseline check: `sha256sum -c .pipeline/p3/baseline.sha256` → **40 OK**, with every row **not** listed as legitimately-changed in `IMPLEMENTATION.md` still `OK` | ✔ | ✔ | ✔ |
| `db/schema.ts` row of the baseline is still `OK` (NQ1) | ✔ | ✔ | ✔ |
| No `CREATE INDEX`/`CREATE FUNCTION`/`CREATE TRIGGER` in the diff | ✔ | ✔ | ✔ |
| Browser steps executed and transcript in `TEST-REPORT.md` | 1–12 | **n/a — B's manual-only list is `B-M1..B-M3` (§B-GATE), no browser** | **`M-1 … M-14`** (§C-GATE manual-only table; `M-14` optional per CQ1) |
| **AC gate table fully green** (one row per `REQUEST.md` AC, no un-tested AC) | §A4.2 (round-2 APPROVE) | **§B-GATE — 10/10 ACs, 0 manual-only assertions beyond `B-M1..M3`** | **§C-GATE — 8/8 ACs, AC8 manual-only by ruling** |

### F3. Baseline mechanics (do not trip on these)

- `.pipeline/p3/baseline.sha256` has **40 product-file entries**; Q1 is **ruled: 40 is authoritative**, `REQUEST.md:10`'s "38" is stale. **Do not filter or delete rows.**
- **My probe scripts are not in it** and must not be added — `.pipeline/` artifacts are planning evidence, not code.
- The baseline is a **mutation guard for files the part must NOT touch** (e.g. `ingest/service.ts` during B; `search.ts` during A and C; **`db/schema.ts` during all three parts**, NQ1), not a whole-tree equality check.
- **Per-part "files legitimately changed" list (NB-2)** — `IMPLEMENTATION.md` must record exactly this and nothing wider:

| Part | Files whose hash will legitimately change |
|---|---|
| **A** | `server/src/routes/library.ts`, `web/src/lib/api.ts`, `web/src/app/dashboard/library/page.tsx` |
| **B** | `server/src/routes/auth.ts`, `server/src/routes/ingest.ts`, `server/src/routes/search.ts` (new files are not in the baseline) |
| **C** | `server/src/routes/audit.ts`, `server/src/app.ts`, `web/src/lib/api.ts`, `web/src/app/dashboard/audit/page.tsx` |

  Every other baseline row must be `OK`. In particular `server/src/db/schema.ts` and `server/src/ingest/service.ts` must be `OK` after **every** part.
- `server/dist/` is stale — **never** `npm run build` in `server/`; run the server as `npx tsx src/index.ts` (matches `p2` practice [G]).
- `f1test` schema (182 documents) — **never touched** [G].

### F4. Data safety — the binding rules, stated once (B and C included)

**This section is the single statement of the data-safety rules for the Implementer. Where any other section appears to say something different, this one governs; `REQUEST.md` §72-76 is its source.**

**F4.1 — Prohibited, without exception, in every part of phase 3:**
1. No `TRUNCATE`, no `DROP`, no `ALTER`, no `CREATE` — no `CREATE TABLE/INDEX/FUNCTION/TRIGGER` (NQ1, R-B2/BQ2). If the diff contains `CREATE`, `DROP` or `ALTER`, the diff is wrong.
2. No `UPDATE` and no `DELETE` against `public.audit_log` from product code (AC8, `T-B15`).
3. No reset of the database, no reset of `admins`, no `ADMIN_PASSWORD` rotation, no secret re-generation.
4. No `DELETE` of `public.documents` or `public.chunks` except a fixture row the same test process created and captured by id.
5. Nothing may touch the `f1test` schema (182 documents), `.tmp_probe`, `.pipeline/p2/**`, or the `.pipeline/p3/f3a-*.log` evidence files.
6. No deletion by pattern, ever. `LIKE 'p3b-%'` / `LIKE 'p3c-%'` / `resource LIKE 'admin:%'` / `resource LIKE 'search:%'` are **never** a delete predicate — `admin:admin` and `search:*` are values real events legitimately produce.

**F4.2 — Fixtures: created by the test process, deleted by captured id, proven three ways.**
- Fixtures live in `public` (the route under test must read the real table). Each fixture row is inserted with `INSERT … RETURNING id` and the ids are captured into a local array **in the test process**; the only delete is `DELETE … WHERE id = ANY($1::uuid[])` with that array. No `seed.sql`, no `\o` id-file, no id file of any kind (R-A2, R-B5, R-C5).
- Every cleanup is proven, in this order: **(a)** `SELECT count(*) … WHERE id = ANY($1)` ⇒ **0**; **(b)** a marker count — `SELECT count(*) FROM public.documents WHERE name LIKE 'p3b-%'` ⇒ **0** / `… WHERE resource LIKE 'p3c-%'` ⇒ **0** — used **only** as a "did anything survive?" check, never as a predicate; **(c)** the total table count ⇒ **the pre-run value** (B: `audit_log` = `PRE_COUNT`, C: `audit_log` = `PRE_COUNT`; `documents` = its pre-run value).
- The `p3a-` / `p3b-` / `p3c-` prefix exists to make (b) possible. It is not an authorisation to delete by pattern.
- A suite that aborts between insert and delete must leave **only** its own `p3*`-prefixed rows, and the Implementer must then delete them **by the printed ids** — never `DELETE … LIKE`.

**F4.3 — Secrets and sentinels:**
- No JWT, password, `Authorization` header value, or `ADMIN_PASSWORD` appears in any log line, response body, `IMPLEMENTATION.md`, `TEST-REPORT.md` or `RESULT.md`. Tokens are rendered as `<token:N chars>` (the F2-B convention).
- The `L3AK_*_SENTINEL_*` strings (R-C3) are written **only** into C's fixture row. If any of them appears in a response, a log line, or a report other than as the literal string inside an assertion description, that is an **AC7 failure**, not a cosmetic issue.
- `audit_log.detail` stores only allow-listed keys (§B3.2); a `detail` value longer than 200 characters is truncated with a `…` marker, never stored whole (T-B17).

**F4.4 — Baseline (the mechanical guard):** `sha256sum -c .pipeline/p3/baseline.sha256` ⇒ **40 OK** at the end of each part, with only that part's §F3 rows legitimately changed. `server/src/db/schema.ts` and `server/src/ingest/service.ts` must be `OK` after **every** part.

---

## G. CONSOLIDATED OUT-OF-SCOPE / FOLLOW-UPS

`FU-A1` `updated_at` never maintained · `FU-A2` no UNIQUE on `documents.sha256` · `FU-A3` no index on `chunks(document_id)` · `FU-A4` no delete/policy-edit UI · `FU-A5` unvalidated `kind`/`status` strings · `FU-A6` (none — dashboard copy accurate) · **`FU-B1`** retention/rotation · **`FU-B2`** `auth.logout` needs a server endpoint · **`FU-B3`** policy-change/delete actions don't exist · **`FU-B4`** DB-level `REVOKE UPDATE,DELETE` on `audit_log` · **`FU-B5`** pre-loop upload rejections unaudited · **`FU-B6`** search failures unaudited · **`FU-B7`** `search.query` volume · **`FU-B8`** failed-login rate limiting · **`FU-B9`** two logging idioms (`console` vs `logger`) · **`FU-C1`** real roles + JWT claim · **`FU-C2`** NULL-actor filter · **`FU-C3`** audit page jump/total · **`FU-C4`** export · **`FU-C5`** live tail · **`FU-C6`** detail drill-down · **`FU-C7`** retention UI. **`FU-B10`** `audit_log_action_created (action, created_at DESC)` and `audit_log_actor_created (actor, created_at DESC)`, created `CONCURRENTLY` when volume justifies it, **justified by a measured `EXPLAIN` against a populated table** (NQ1 removed these from phase 3). **`FU-B11`** correct the `AuthRequest` cast (`middleware/auth.ts:5-7` types the payload `{id, username}` while the token carries `{sub, username}`) so `req.user.id` stops being `undefined`; phase 3 works around it by declaring **`sub`** the authoritative id (§B-D10a) and is **not** allowed to touch the file. Fold into **FU-C1** when the `role` claim lands. Carried from earlier phases: `FU-AC5-BIGQ` (huge-query 500, `p2/RESULT.md:130` [G]), `limit: 0 → 10` in `search.ts:39` (`p2/RESULT.md:131` [G] — **out of scope for A** because A must not touch `search.ts`, D4), `f1test` schema, `.tmp_probe/` (both await approval, `p2/RESULT.md:132-133` [G]).

---

## H. OPEN QUESTIONS FOR THE REVIEWER (single list)

**All eleven questions are ruled. The table below is the closed record; no decision is left to the Implementer.**

| # | Ruling (reviewer, round 1) | Where it landed |
|---|---|---|
| **Q1** | **40 is authoritative.** `REQUEST.md:10`'s "38" is stale; do **not** filter or delete rows. | §F3 |
| **AQ1** | **Yes — `Previous` via a client-side cursor stack.** | §A8, §A11, browser step 9 |
| **AQ2** | **Keep `total`.** | §A3.3, T-A2 |
| **AQ3** | **Yes, public-schema fixture**, but the seed must be **idempotent**. | §A4.1 |
| **BQ1** | **`actor = null`**; sanitised candidate in `resource` **and** `attempted` in the `detail` allow-list. | §B3.2, §B3.4, §B-D6, §B-D7 |
| **BQ2** | **Rejected — no DDL trigger.** Unit seam + real-HTTP response assertion + static count. | §B4.3 (T-B14, T-B10b, T-B15b), §F4 |
| **BQ3** | **`success` with `chunk_count: 0`** — no 7th action. | §B3.4, T-B10c |
| **BQ4** | **`warn`** is accepted. | §B-D2, T-B14(a) |
| **CQ1** | **Yes — documented-unreachable 403 acceptable**, provided `requireAdmin` rejects a missing `req.user` and the UI branch is proven by a pure function. Status is **`403`** (round-3 §B-D10b supersedes round 1's `401`). | §B3.6 (the one body), §B-D10b, §C3.7 (C's obligations), T-B23, T-C9, T-C10 |
| **CQ2** | **Use `LIMIT+1`** and suppress the cursor when no extra row exists. | §C3.5, §C-D1, T-C3, CR2 |
| **CQ3** | **Do not display `id`** — but it must still be returned. | §C3.3, §C3.8.4 (used only as the React key `key={row.id})` |
| **NQ1** | **Drop the two audit indexes**; record **FU-B10**; `db/schema.ts` untouched. | §B-D9, §B3.3, §F1, §F3, §G |
| **NQ2** | **Delete `sanitizeDetailDenyOnly`**; test the deny set through the public function with an injected widened allow-list. | §B3.1, §B3.2, T-B3 |

---

## I. STATEMENT OF COMPLIANCE WITH THE PLANNER ROLE

- **No source file was modified** in *this revision*: the only file written in round 3 is `.pipeline/p3/PLAN.md` (this file). The 40 baseline entries were re-verified `OK` in the original planning session (§0.2) and no product file was touched since; the Implementer must re-run `sha256sum -c` as the first gate (§F2).
- **Nothing installed**: this revision ran no package manager, no build, no test.
- **Server not started**: no `tsx`, no `next dev`. The only server-side facts in this plan that are not [V] or [G] are marked [U] and each has a test that measures it (§A AR6, §B BR7).
- **No DB writes to product tables**: `public.documents/chunks/audit_log/admins` are `0/0/0/1` [V]; the only writes ever made were into `CREATE TEMP TABLE probe_audit`, which no longer exists.
- **No DDL is proposed anywhere in this plan.** Round 1 removed the only two candidates (NQ1's indexes, BQ2's trigger). If the Implementer's diff contains `CREATE`, the diff is wrong.
- The **three** probe scripts under `.pipeline/p3/probe/` are `SELECT`-only or `TEMP TABLE`-only and are kept as evidence, together with `baseline-before.sha256`. **P5 is intentionally unexecuted** (see §0.2). (Round 3 added no probe and ran no SQL; the only new files it created are throwaway editors `_rev3_patch*.py` under `probe/`, which are not part of the plan, not evidence, and may be deleted.)

## J. CHANGES THIS REVISION MADE THAT A REVIEWER SHOULD CHECK FIRST

**Round 3 (F3-B / F3-C closure). Ranked by "most likely to still be wrong":**

1. **§B-D10a + the actor rule in three places.** `req.user.id` is `undefined`; the actor is `req.user?.username`; the id is `req.user?.sub`. Check that **no** section still implies `req.user.id` is usable, and that `auth.login.success`'s `row.username` exception is stated (§B3.2 note) and tested (`T-B22`). **`auth.login.failure` is the converse case (R4-B/1):** that route mounts no `authMiddleware`, so `actor` is the literal `null` **by rule** and the failure path must contain **no** `req.user` reference at all — verify §B3.2's binding paragraph, §B3.4's snippet, `T-B9` part (2), the new `T-B9b`, and §B-GATE AC3 all say so. The grep in §B4.4 must return 0.
2. **§B-D10b** is now the only place the `403` status is decided. Check that §B3.6, `T-B23`, §C3.4, §C3.7, `T-C9`/`T-C10`, CR3/CR6 and both CQ1 rows agree with it, and that no `401` remains for this branch.
3. **§C3.3's `next_cursor` rule vs §C3.5's code (C-2).** The prose rule is now identical to the implementation; `T-C3b` is the only **assertion** that separates the two rules (`T-C2`'s page-count check corroborates it) — and only its **leg 3** does so (`?limit=12` on 12 rows after deleting one ⇒ `next_cursor === null`); legs 1–2 are shape guards that pass under **both** rules (R4-C/1). Verify the fixture is still exactly 13 rows.
4. **The three display key lists (C-3).** §C3.3's list, `SERVER_DISPLAY_KEYS` (§C3.5) and `DISPLAY_DETAIL_KEYS` (§C-D5) must be the same 12 keys **in the same order**; `T-C6` asserts it and `F2` asserts `attempted` survives.
5. **§C3.4a / the URL→bind table (C-5).** `from`/`to` → `fromTs`/`toTs` → `$4`/`$5`; `T-C13b` fails if `$4` is bound as `null`, which is the "silently dropped" defect.
6. **`F1..F8` (§C4.4)** are now defined; check that each is satisfiable by the §C-D5 signatures (e.g. `F5` names a TZ argument, `F7` needs two child processes).
7. **The two gate tables** (§B-GATE, §C-GATE): every AC of `REQUEST.md` has a row, every row names a defined test, and the manual-only lists (`B-M1..M3`, `M-1..M14`) contain **only** what cannot be automated.
8. **§F4** is now the single statement of data safety; check no other section contradicts it (notably the old §F4 bullets and §A4.1's pre-test reset, which is still the one documented `LIKE` **reset** re-affirmed here as pre-test only).

**Carried from round 1/2 (unchanged, still worth checking):** §C3.5 `C-SQL-1`'s `$6` timestamptz / `$7` uuid order; §B-D2's `try` wrapping the sanitiser calls; the fixture lifecycles' five steps; §C4's tie set of exactly **three** rows at `10:00:00Z`; §F1's not-touched rows.

DONE:PLANNER_P3_BC

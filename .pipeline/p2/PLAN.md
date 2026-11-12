# PLAN — Phase 2: F2-A FTS Search Correctness + F2-B Auth Token Persistence

PROJECT ROOT: `D:\Develop\knowledge-app`
PHASE ID: `phase2-fts-auth` — predecessors: `.pipeline/phase1/RESULT.md` (PASS), `.pipeline/f1/RESULT.md` (PASS)
ROLE: PLANNER — plan only. **No source file modified, nothing installed, server not started, zero DB writes** (all SQL probes were `SELECT`-only or ran against session-local `CREATE TEMP TABLE`s that vanish on disconnect).
DATE: 2026-11-02
SOURCE: `.pipeline/p2/REQUEST.md`
REVISION: round 1 (applies `REVIEW.md` REQUIRED REVISIONS 1–18, `REVIEW.md:151-246`)

Legends: **[V]** = verified by me in this session (read the file, or ran the read-only probe named in the same paragraph). **[G]** = given — asserted by `REQUEST.md` / prior phase artifacts and **not** re-executed by me. **[U]** = unconfirmed / could not be established without writing data.

Probe artifacts written by this planning session (all under `.pipeline/p2/`, none touching `server/` or `web/`): `probe_fts.sql`, `probe_current_vs_fixed.sql`, `probe_explain.sql`, `probe_edge.sql`.

---

## 0. REVISION LOG — round 1

Every row is a disposition of one REQUIRED REVISION from `REVIEW.md:151-246`. `APPLIED` = the plan now specifies the change with no implementer decision left. `SUPERSEDED` = the review's own conditional made the item moot; the plan states the condition and the resulting rule. `VERIFIED` = the review asked for a fact to be corrected/recorded; the plan now states the corrected fact.

| Rn | One-line disposition | Section changed |
|---|---|---|
| **R1** | APPLIED — deleted the whole lexeme-less 400 branch; **one** guard and **one** message remain (`q (query string) is required`); lexeme-less non-blank `q` → **200 + `results: []`**, pinned in T-A5, with the rationale recorded. | §A2.3, §A2.4, T-A5, §A2.9 |
| **R2** | APPLIED — the `SELECT websearch_to_tsquery(...)::text` pre-probe is gone (R1 removed its only consumer). Single-statement SQL retained (computing the tsquery once in `ORDER BY`+`WHERE` is not a round trip and not a CTE); the CTE form of R2 is recorded as an **optional** micro-optimisation, not correctness, with the EXPLAIN constraint that governs it. | §A2.2, §A2.3, §A2.9, T-A9 |
| **R3** | APPLIED — fixture gains `p2-doc-zulu` with **2 chunks** (9 documents / **11** chunks) so the top-ranked chunk can belong to the **lexicographically last** document *and* rank order can disagree with `document_id` order; T-A3 now asserts **sequence equality vs SQL** *and* a **mutation check** against rank-less SQL, with `BLOCKED` if the orders coincide; the bare `document_id == sort(...)` assertion is demoted to a tiebreaker-only proof. | §A3.2, T-A3 |
| **R4** | APPLIED — T-A2 is now **set equality** on `chunk_id` (HTTP set == SQL set, and lengths equal), not cardinality. | T-A2 |
| **R5** | APPLIED — a **10 000-chunk** `p2test`-only EXPLAIN fixture, and a three-outcome decision rule (`Bitmap Index Scan` → PASS; `Seq Scan` < 200 ms → PASS, decide nothing; `Seq Scan` ≥ 200 ms → **FU-PERF-1**, PASS). | §A3.2 (A3.2b), T-A9 |
| **R6** | APPLIED — the Library/Audit page check is re-labelled a **pin of FU-1**, explicitly **not** evidence for the fix, and removed from the AC7 justification. | T-A8, §A2.4, AC7 row in §4 |
| **R7** | APPLIED — `p2test.admins` creation is stated as a known side effect (`db/index.ts:22-34` uses the current `search_path`); cleanup records `count(*) FROM p2test.admins` (= 1) **before** the drop and `public.admins` (= 1) after, and never touches `public.admins`. | §A3.1, §A3.5, R-table |
| **R8** | VERIFIED + APPLIED — the false AC1 claim is corrected: `header.tsx:11` **does** read `localStorage["ka_token"]` at mount. `header.tsx:11` → `getToken()`, `header.tsx:41` → `clearSession()`; §7 names **both** lines; the AC1 grep is now **two-sided**. | §B2.2, §B2.4, §B3.2, §7, §4 R13 |
| **R9** | APPLIED — added the executable harness `web/scripts/f2b-hydration.mjs` (no new dependency) at **XHR-equivalent** level, with the full assertion list; §B3.1 step 5 retained as the single manual DOM confirmation; TEST-REPORT must state the fallback level used. | §B3.1a (new), §B3.1, §B3.4 |
| **R10** | APPLIED — three `hydrateToken` invariants are now assertions in the harness: idempotent second call; no clobber of a fresh `setToken`; `clearSession()` cannot be resurrected by a later `hydrateToken()`. | §B3.1a (A7–A9) |
| **R11** | APPLIED — `ka:logout` is tested as a **mechanism**: dispatch while a valid token is in memory → navigation; and the 401 burst case asserts **exactly one** event for a double-401. | §B3.1a (A5, A6) |
| **R12** | APPLIED — the Header username risk is re-worded as a testable assertion: after a hard reload with an **expired** token no username may render before the redirect. Labelled **MANUAL** (no renderer available). | §B3.1 step 7, §B3.1a (note) |
| **R13** | APPLIED — every Part B AC is mapped to a named test; AC10 marked **documentation only, no test, verified by reading §B2.6**; AC8 gets an explicit login assertion (same creds, lands on `/dashboard`). | §B3.4 (new AC→test table) |
| **R14** | VERIFIED — recorded the real post-login sequence `setToken` (`:20`) → `router.push` (`:24`) → `router.refresh` (`:25`), and made the dependency explicit: `login-form.tsx:23`'s `localStorage.setItem` **must be deleted** because `setToken` now owns the write; added the assertion `localStorage.getItem("ka_token") === getToken()` after login. | §B1.2 step 1, §B2.4, §B3.1a (A4), §7 |
| **R15** | APPLIED — explicit "new-file hashes appended" step: verify the 5 authorised edits are the **only** `FAILED` lines, append the sha256 of **both** new files (`web/src/app/login/page.tsx`, `web/scripts/f2b-hydration.mjs`) — **35 → 37** entries — then re-run `sha256sum -c` requiring `: OK` on all 37. | §7.2 (new), §8 |
| **R16** | APPLIED — the `p2test` admin creation is stated in **both** parts' preconditions and cleanup, and `p2test.admins` is in the pre-drop record. | §A3.1, §A3.5, §B3.1 preconditions |
| **R17** | APPLIED — explicit "which binary is running" gate in both parts: backend MUST be `npx tsx src/index.ts`; `npm start` runs the stale, un-baselined `dist/index.js`; positive evidence = T-A1 returns 0 for `zzzznotfound` on the seeded fixture. No `dist` rebuild. | §A3.4 (preflight), §B3.1 (preconditions), OQ-7 closed |
| **R18** | APPLIED — a single credential **preflight** (`admin`/`admin123` → 200 + token) preceding every other test, with the non-guessing fallback `BLOCKED: demo credentials rejected; ADMIN_PASSWORD may be overridden in server/.env`. No alternative password is ever attempted. | §A3.4 (preflight), §B3.1 preconditions, §B3.2 check 1 |

**Net structural changes from round 0:** fixture 8 docs/9 chunks → **9 docs/11 chunks** (+ a 10 000-chunk EXPLAIN fixture); Part A handler 2 400-classes → **1**; Part B evidence manual-only → **executable harness + 1 manual DOM check**; file-touch table gains explicit `header.tsx:11`, `header.tsx:41`, `login-form.tsx:23` **deletion**, and the new `login/page.tsx`; baseline 35 → **37** entries; authorised diff = **5 modified + 2 new** files.

## 0b. REVISION LOG — Part B (post-gate)

This revision is **Part B only** and is confined to closing the gate's `B-1…B-4` (`REVIEW.md:539-541`) plus the two mechanism defects it found in the harness (`REVIEW.md:397`). **No Part B design decision is reopened:** the owner module (`api.ts`), the `ready` hydration gate in `layout.tsx`, the four-layer guarantee, creating `/login`, and deleting `api.logout` all stand exactly as round 1 approved them (`REVIEW.md:539`, "which I judge **sound**"). Part A is untouched — it was already approvable and implementation may already have started, so this revision introduces **no** renumbering, no fixture change and no change to any `T-A*` assertion.

Legend: **APPLIED** = the plan now specifies the change with no implementer decision left. **DECIDED** = a previously open binary choice is now resolved in the text, with its code-level consequences enumerated per file/line. **REWRITTEN** = the section was replaced to remove a defect, with the old text's specific error named.

| Rn | Gate item | One-line disposition | Section changed |
|---|---|---|---|
| **Rb-1** | **B-1** — the `window` shim has no listener registry, so `A5`'s `navigated` can never be non-zero (`REVIEW.md:397`, `:539`) | **APPLIED / REWRITTEN.** The shim is no longer a stub: `window` is now backed by a real `Map<type, Set<listener>>` registry, `addEventListener` **registers** (with `once` support), `removeEventListener` **deregisters by identity**, and `dispatchEvent` **invokes** every surviving listener and returns `!defaultPrevented`. `A5` now registers *the same function reference* it later removes, and asserts the post-removal count is unchanged — so the assertion fails if the registry is a no-op. | §B3.1a (shim + A5 + new R-assertions) |
| **Rb-2** | **B-2** — `A6` counts a `ka:logout` event that the authorised post-fix `api.ts` never dispatches (`REVIEW.md:539`) | **DECIDED — `ka:logout` is IMPLEMENTED in `api.ts`.** `api.logout` stays **deleted** (§B2.5 unchanged); the event is dispatched **only** from the 401 branch of `request()`, exactly once per 401 burst, guarded by a module-level `logoutSignalled` latch. **N-6f (post-implementation correction, 2026-11-02): the latch is re-armed by `hydrateToken()` and by `startSession(t)` — NOT by `setToken(null)` and not by `setToken(t)`.** Putting the re-arm inside `setToken` is self-defeating because `clearSession()` calls `setToken(null)` at the start of the 401 branch, which would re-arm before testing and emit one event per in-flight request (measured: `A6 expected=1 actual=2`, both dispatches from `api.ts:52`). The implemented shape is: `hydrateToken()` → `logoutSignalled = false`; new `startSession(t)` → `logoutSignalled = false; setToken(t)`; `setToken(t)` → persists and re-arms **only when `t !== null`**, and is otherwise a pure store write. `login-form.tsx` MUST call `startSession(data.token)`. Per-file/per-line consequences are enumerated in §B2.4a; `§7.1` authorises the dispatch line explicitly. `A6` is retained and is now truthful; `A12` proves the re-arm. | §B2.4a, §B2.4, §B3.1a (A6, A12), §7.1 |
| **Rb-3** | **B-3** — `A4` asserts an invariant that contradicts `A7` (`REVIEW.md:539`, "the A4/A7 writer contract is stated once and the losing assertion rewritten") | **APPLIED / REWRITTEN.** One **writer contract** is stated once in §B3.1a: `setToken` is the sole writer of *both* stores and *always* persists `null` by removing the key; `hydrateToken` is the sole reader and is one-shot. Under that contract `A7`'s old expectation (storage `newer-value` ignored, memory stays `stale-value`) is still correct, but `A4`'s blanket "`localStorage === getToken()` always" is false after a `clearSession()`. `A4` is rewritten to assert equality **only immediately after `setToken(x)` for non-null `x`**, and to assert the **null case removes the key** — it no longer claims an invariant across `clearSession`. | §B3.1a (writer contract + A4 + A7 restated) |
| **Rb-4** | **B-4** — the harness's run command and TS-loading mechanism are not named; `npx tsx` is a guess (`REVIEW.md:539`, `:518`) | **DECIDED.** Harness file = `web/scripts/f2b-hydration.mjs` (`.mjs`, so Node runs it with **no** loader). The **real `api.ts`** is loaded through **`tsx`'s ESM loader**, which is already a `devDependency` of `server/` (`tsx@^4.16.0`) — **no install, no new dependency**. Exact command: `node --import ./server/node_modules/tsx/dist/loader.mjs web/scripts/f2b-hydration.mjs` **run from the repo root**. `npx tsx` and bare `node scripts/…` are both **withdrawn** as wrong. | §B3.1a (run contract), §7.2 (verification) |
| **Rb-5** | **N-5a** — harness "targets the built output" was ambiguous | **APPLIED.** Stated once, unambiguously: the harness imports **`web/src/lib/api.ts` source** through the `tsx` loader. It never reads `web/.next/**` and never spawns `next build`. The compiled-output path is **not** used, so a stale `.next` cannot make the harness pass. | §B3.1a (run contract) |
| **Rb-6** | **N-5b** — §B3.4 credits `A3` with AC3's "gate is not a race", an overclaim | **APPLIED.** `A3` now proves only *intra-module ordering* (hydration before the first request). The React **render gate** (`ready ? children : null`) claim is **manual only** (§B3.1 step 5). The AC3 row is split accordingly and marked *partly manual*. | §B3.4 |
| **Rb-7** | **N-5d** — every assertion lacked a stated precondition and exact expected value | **APPLIED.** Every assertion `A1…A13` now has an explicit **precondition**, the **exact operation**, and the **exact expected value**; the AC map is regenerated from the final assertion set, and `A11` (which was a hard-coded `ok()` and therefore vacuous) is replaced by a real in-harness source read. | §B3.1a (assertion table), §B3.4 |
| **Rb-8** | **N-5c** — AC→test matrix did not cover F2-B's 11 ACs completely / did not mark documentation-only | **APPLIED.** §B3.4 is regenerated: all **11** F2-B ACs present, each with mechanism (**automated** / **manual** / **documentation only**), and **AC10** explicitly marked **documentation only — no test**. | §B3.4 |
| **Rb-9** | Cleanup / verification steps | **APPLIED.** §7.2/§8 now state: baseline is **35** entries **before** implementation, **exactly 5** modified files fail the check and **no other** line may fail, the two new files' hashes are appended → **37** entries, all `: OK`; and the `web` typecheck command is stated exactly as `cd web && npx tsc --noEmit` (exit 0). | §7.1, §7.2, §8 |

**What this revision explicitly did NOT change:** Part A (any `T-A*`, the fixture, G1–G7), the `api.ts` owner-module design, the `ready` gate, the four-layer guarantee, the deletion of `api.logout`, the creation of `web/src/app/login/page.tsx`, `header.tsx:11` / `:41` edits, `login-form.tsx:23` deletion, and the "**5 modified + 2 new** files / baseline 37" accounting. `ka:logout` (§B2.4a) is a **narrow addition inside `api.ts`**, which is already one of the 5 authorised modified files — so the file-touch table's *count* is unchanged; only one line inside an already-authorised file is enumerated.

---

## 0. CORRECTIONS TO THE REQUEST — read this first

Two [G] statements in `REQUEST.md` are **wrong or beside the point** for the code as it exists today. The plan is built on the measured behaviour, not on the REQUEST wording.

| # | REQUEST says | What I measured | Consequence for this plan |
|---|---|---|---|
| **C1** | "`q = "zzzznotfound"` returns unrelated chunks (verified: 1 result for a nonsense query)" (`REQUEST.md:14`) | The **live public schema returns 0 rows today only because `public.chunks` is empty** (`documents=0, chunks=0` [V: `select count(*)` probe]). The defect is latent, not visible. Reproduced against a session-local `CREATE TEMP TABLE` fixture with 3 chunks: the **unmodified current query returned 3/3 rows for `q='zzzznotfound'`, every one with `ts_rank = 0`** — including a `restricted` row that `policy='*'` admits [V: `probe_current_vs_fixed.sql`, section `CURRENT_QUERY_nonsense_q_zzzznotfound`]. | Tests **must** seed fixtures before asserting 0 results; asserting "0 results" against an empty `public.chunks` is a **vacuous pass**. §3.1 makes this an explicit gate. |
| **C2** | "`chunks` has a GIN index `chunks_fts_idx ON to_tsvector('english'::regconfig, text)` — it already matches the intended `plainto_tsquery`/`webto_tsquery` language, so a matching predicate can use it." (`REQUEST.md:17`) | Index definition confirmed byte-for-byte [V: `pg_indexes` → `CREATE INDEX chunks_fts_idx ON public.chunks USING gin (to_tsvector('english'::regconfig, text))`, 40 kB, `indisvalid = t`]. **But an index does not make itself used.** The predicate `to_tsvector('english', c.text) @@ websearch_to_tsquery('english',$2)` is only index-usable **if the cast is present**: the index expression is `to_tsvector('english'::regconfig, text)`, i.e. `regconfig`-typed. `to_tsvector('english', …)` with a bare `'english'` literal is resolved by the **unknown-literal → `regconfig`** rule, so `'english'` and `'english'::regconfig` produce the *same* expression tree — verified [V: `to_tsvector('english', …) = to_tsvector('pg_catalog.english', …)` → `t`, `probe_fts.sql` section `to_tsvector_stability_check`]. | The predicate **is** index-usable, and the plan keeps the **exact literal spelling** `'english'` that the index uses so the planner matches it. §2.6 records this as the reason **no index change is justified**. |

Two more facts that shape F2-B:

- **`web/src/app/login/` exists but is an EMPTY directory** — no `page.tsx`, no `route.ts`, no `layout.tsx` [V: `ls -la web/src/app/login` → only `.` and `..`; `find web/src/app/login -type f` → nothing]. So `router.replace("/login")` is not merely "a route that doesn't exist" — it is a **404** (`notFound()`). The fix must therefore *create* the route, not repoint to something that exists.
- **`server/src` contains no occurrence of the string `logout`** [V: `grep -rn "logout" server/src` → no match]. `POST /api/auth/logout` is served by `notFound` (`server/src/middleware/error.ts:3-5`) → `404 {"error":"Not found"}`. `api.logout` (`web/src/lib/api.ts:56-59`) is consequently dead code that *always* rejects.

---

## 0c. REVISION LOG — N-6 closure (Part B, round 3 → implementation handoff)

Applies the five document-consistency defects raised in `REVIEW.md` §ROUND 3 REVIEW — PART B (`N-6a`…`N-6e`). **No design change**: B-1…B-4 remain closed exactly as approved, no assertion was weakened or removed, and the assertion count stays **13 (`S1`, `A1`…`A13`)**.

| n | Defect | Resolution (exact section) | Verification hook |
|---|---|---|---|
| **N-6a** | Prose said `setToken` sets `hydrated`; the code block and C4 did not — and `A8`'s result depends on which is true | **Normative rule added** at the end of **§B2.1**: `hydrateToken()` is the only operation that *performs* hydration (only place `hydrated` flips `false → true` on the normal path); `clearSession()` sets it only to *suppress* re-reads; **`setToken()` never reads or writes `hydrated`**. The stale sentence "set by `clearSession()`/`setToken()`" is corrected to "`clearSession()` — **never by `setToken()`**". **A8 re-specified** (§B3.1a.4) with an explicit 4-step sequence: fresh module (`hydrated === false`) → `setToken("fresh-value")` → **assert `isHydrated() === false`** (BLOCK if `true`, because the sequence would no longer exercise hydration) → first-and-only `hydrateToken()` → expect `"fresh-value"` | §B2.1 rule + A8's falsification clause + A8's BLOCK on step 2 |
| **N-6b** | `A11` as written could not pass (`offenders.length === 0` impossible if `api.ts` is scanned) and no exclusion was stated | **A11 scan scope defined** (§B3.1a.4): walk all of `web/src`, skipping directories `node_modules`, `.next`, `dist`; match `/localStorage\|sessionStorage/`; **exactly one permitted exclusion: `web/src/lib/api.ts`** (the owner). Expected `offenders.length === 0`; harness **prints offender paths** so a failure names the file. Falsification clause added (re-introducing storage in `header.tsx`/`layout.tsx`/`login-form.tsx` ⇒ FAIL) | A11's scope sentence + falsification clause + §B3.2 two-sided grep as the independent cross-check |
| **N-6c** | Stale phrase "(in-memory only, today)" implied `setToken` already persisted | Reworded in **§B1.2 step 1**: "**Today (pre-fix)** `setToken` (`api.ts:9-11`) writes **the module variable only** — `:23` is what persists the token". Also names assertion **A4(a)** explicitly and states that no blanket `localStorage === getToken()` equality is asserted (C5) | §B1.2 step 1 |
| **N-6d** | Wrong cross-reference `§B2.3` for the `setToken` persist behaviour (there is no §B2.3) | Both occurrences corrected to **§B2.1 (+ §B2.4a)** — the §B2.4a table row for `setToken` and the `login-form.tsx` BEFORE/AFTER snippet | §B2.4a table + §B2.4 snippet |
| **N-6e** | "no loader, no transpile" contradicted the run command that names a loader | §B3.1a.1 Language row rewritten: the `.mjs` file needs no transpile, but plain `node` cannot import a TypeScript module, so the harness is launched **with** `tsx`'s ESM loader; the exact command (already correct at §B3.1a.1) is cited instead of contradicted | §B3.1a.1 Language row + §7.2 V6 command |

**Contradiction audit (PLAN ↔ REVIEW ↔ A1–A13):** C5 remains the single equality rule; A4 is scoped to the two `setToken` moments, A7's divergence is explicitly permitted by C3/C5, A8's BLOCK clause removes the last place where prose could decide an outcome. A6/A12 latch semantics are unchanged. **The runtime status of the harness command is still `[U-exec]`** — only the Test Engineer's execution can close it, and it must be reported with pasted output; this log does not claim it.

**Part B status after this revision:** the reviewer's round-3 verdict remains **`PART B: REVISE`**; this closure is *evidence for re-review*, **not** a self-promotion to APPROVED. Implementation of Part B proceeds under that explicit caveat and is subject to independent verification of B-1…B-4 **and** N-6a…N-6e.

---

# PART A — F2-A: PostgreSQL full-text search correctness

## A1. CURRENT BEHAVIOUR

### A1.1 The exact query as shipped

`server/src/routes/search.ts:24-71`. Route mounted at `server/src/app.ts:54` behind `authMiddleware`. The SQL is `search.ts:34-51`:

```
        SELECT d.id AS document_id,
               d.name AS document_name,
               d.access_policy AS document_policy,
               c.id AS chunk_id,
               c.text,
               c.page_no,
               c.start_char,
               c.end_char
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE d.access_policy = $1 OR $1 = '*'
        ORDER BY ts_rank(
                   to_tsvector('english', c.text),
                   websearch_to_tsquery('english', $2)
                 ) DESC
        LIMIT $3
```
Bound values: `[policy, q, limitN]` (`search.ts:52`). [V: read]

### A1.2 Why it returns everything

There is **no `@@` predicate anywhere in the statement** — `q` appears only inside `ts_rank(...)` in the `ORDER BY` [V: `search.ts:46-49`; the string `@@` does not occur in the file].

`ts_rank(tsvector, tsquery)` answers "*how well does this document match?*" — it never answers "*does it match?*". For a document with **no** matching lexeme it returns a small **non-zero** constant, not NULL and not an error: measured `1e-20` for two non-matching chunks against `q='n2n escalation'`, while the matching chunk scored `0.09910322` [V: `probe_current_vs_fixed.sql`, section `CURRENT_QUERY_q_n2n_escalation`]. Measured again for `q='zzzznotfound'`: **all three** chunk rows returned, all ranks `0` [V: same file, section `CURRENT_QUERY_nonsense_q_zzzznotfound`].

So the query is, in effect:

> all chunks the policy filter admits, ordered by a score that is `0`/`1e-20` for almost all of them, truncated at `$3`.

This is why the REQUEST observed "1 result for a nonsense query" [G: `REQUEST.md:14`]: with `limit: 10` and one chunk in the table, `LIMIT` did the only filtering that happened. Worse — the truncation is not even stable: every non-matching row ties, and a tie with no tiebreaker under `LIMIT $3` returns an **arbitrary, planner-dependent subset** (PostgreSQL does not guarantee row order across plan changes).

Measured today on a real query (`n2n escalation`, limit 10, `policy='*'`): 3 rows returned, of which **2 were irrelevant** and **1 was `restricted`** — see A1.5.

### A1.3 What the GIN index does and does not help with

| | Status |
|---|---|
| **Does** | It indexes the expression `to_tsvector('english'::regconfig, text)` over `chunks.text` [V: `pg_indexes`]. It can answer `to_tsvector('english', c.text) @@ <tsquery>` with a **bitmap index scan** — that is precisely the form the fix adds. It is `valid` and 40 kB [V]. `pgcrypto 1.4` is the only other extension; no `pg_trgm`, no `unaccent` [V: `pg_extension`]. |
| **Does** | Support **prefix** matching via `to_tsquery`, *not* via the two functions this route can use. Neither `websearch_to_tsquery` nor `plainto_tsquery` emits `:*`; a user typing `escal*` gets `'escal'` — the `*` is silently dropped (verified: `websearch_to_tsquery('english','a*b')` → `'b'` [V: `probe_fts.sql`]). Prefix search is **out of scope**. |
| **Does NOT** | Help the **current** query at all. There is no `@@`, so the index is **never consulted**: the index expression only appears inside `ORDER BY`, and the planner cannot use a GIN index to satisfy an `ORDER BY ts_rank(...) DESC`. Every request is a **seq scan + sort over every chunk in the table** for the policy filter. Confirmed by `EXPLAIN` of the same shape with no index present: `Seq Scan on p2e_chunks … Filter: (to_tsvector(...) @@ '''escal'''::tsquery)` [V: `probe_explain.sql`] — the planner will choose the bitmap scan instead once the predicate is present and the table is non-trivial; the point is that **the predicate is what unlocks it**. |
| **Does NOT** | Help with **stopword-only** chunks. `to_tsvector('english','the and or')` and `to_tsvector('english','... --- !!!')` are the **empty tsvector** [V: `probe_edge.sql`, `empty_vector_rows` → `t` for both, and for `''`]. Such a chunk can never match any positive query, and `@@` correctly excludes it. Today, these rows are returned for **every** query. |
| **Does NOT** | Help the **policy** filter. `d.access_policy` has **no index at all** [V: `pg_indexes` on `documents` → `documents_pkey` only]. At local-corpus scale a hash/nested-loop join over `documents` is right; adding a policy index would be speculative (§2.7). |

### A1.4 What each consumer actually gets

| Consumer | Call | What it *wants* | What it *gets today* |
|---|---|---|---|
| **Retrieve** `web/src/app/dashboard/retrieve/page.tsx:20` | `api.search({ q: q.trim(), limit })`, `limit` default `20` (`:8`), user-editable number input (`:51-57`) | ranked passages for a typed query | up to 20 arbitrary chunks, mostly irrelevant, ordered by an all-zero/1e-20 score; render at `:80-91`; a `res` of `[]` renders "Results (0)" with no empty-state copy (`:69-79`). Front-end guard `if (!q.trim()) return;` (`:17`) prevents an empty submit, so Retrieve never triggers the empty-`q` problem — **Library and Audit do**. |
| **Chat** `web/src/app/dashboard/chat/page.tsx:19` | `api.search({ q: q.trim(), limit: 8 })` | 8 best passages as grounding context | up to 8 arbitrary chunks. The "Grounded prompt" (`:75-91`) is then built from **irrelevant passages** — this is the most damaging consumer: garbage context silently produces a garbage prompt. Note `POST /api/chat` is a **stub** returning `202` (`server/src/routes/chat.ts:8-10`); the Chat page never calls it [V: `chat/page.tsx` has no `api.chat` call]. |
| **Library** `web/src/app/dashboard/library/page.tsx:23-24` | `api.search({ q: "", limit: 100 })` — **on mount**, `useEffect([])` | a document list | **`q: ""` → `400`.** `search.ts:27` rejects falsy `q`, `api.request` throws `body.error` (`api.ts:36`), the page renders the red error string (`library/page.tsx:51`) — **the Library page never renders a table.** It is a broken page today, and it *depends* on the "empty query returns everything" accident conceptually, though in practice it already 400s. [V: read of both files] |
| **Audit** `web/src/app/dashboard/audit/page.tsx:13` | `api.search({ q: "", limit: 200 })` — on mount | audit rows | same `400`; page shows "q (query string) is required" in red (`:26`). Also `limit: 200` is clamped to **50** by `search.ts:31` *before* the request would even succeed — the page's `.slice(0, 50)` (`:16`) hides that. [V] |

**Consequence for F2-A:** AC4 ("empty `q` → safe") must be resolved in a way that **keeps Library/Audit at `400`**, because a silent `results: []` would turn two visibly-broken pages into two **silently-empty** pages that look healthy ("No documents ingested yet", `library/page.tsx:52-58`) — a data-integrity lie the user cannot distinguish from an empty library. Decision in §A2.4: **keep `400`**.

Rewiring Library/Audit to `/api/library` and `/api/audit` is **explicitly out of scope** [G: `REQUEST.md:21,36`]; this plan only records it as follow-up **FU-1**.

### A1.5 Access-policy semantics as implemented

The predicate is `WHERE d.access_policy = $1 OR $1 = '*'` (`search.ts:45`), with `$1` = `policy` from `req.body`, default `'*'` (`search.ts:26`).

- `policy = '*'` (default and what **every** front-end caller sends — Retrieve/Chat/Library/Audit never pass `policy`): the right disjunct is a **tautology**, so the filter is **off**. **Every policy is admitted** — `public`, `trusted`, `restricted` alike. Measured: with `policy='*'`, the `restricted` chunk ("Restricted salary bands…") is returned [V: `probe_current_vs_fixed.sql`, `CURRENT_QUERY_nonsense_q_zzzznotfound` → `access_policy` column shows `restricted`].
- `policy = 'public'`: only exact-string matches survive; `'trusted'` and `'restricted'` are excluded.
- `policy = 'anything-else'`: matches no document → 0 rows. No validation, no 400.
- `documents.access_policy` default is `'restricted'` (`server/src/db/schema.ts:14`) and ingestion forces one of the three literals, defaulting to `'restricted'` (`server/src/routes/ingest.ts:183-191`); `AccessPolicy = 'public' | 'trusted' | 'restricted'` (`server/src/ingest/types.ts:8`).
- The `access_policies` table (`schema.ts:33-40`) is **read by nothing** — `grep` finds no reference outside `schema.ts` [V].
- **`'*'` is a wildcard, not a privilege level.** There is no notion of *who* is asking: `authMiddleware` verifies the JWT and sets `req.user` (`middleware/auth.ts:17-18`), but `search.ts` never reads `req.user`. Every authenticated admin therefore sees every policy level when the wildcard is used.

**Interpretation the fix must preserve (AC6).** `'*'` keeps meaning "all policies" — I am **not** changing policy *design* [G: `REQUEST.md:36`]. What changes is that the wildcard can no longer leak a row **the filter excluded**, because "excluded" is now a real thing: `policy='public'` must return **no row with `document_policy != 'public'`**. Today this is already true by construction; the fix must keep it and the test must prove it (T-A7).

### A1.6 Independent defects observed while reading (NOT part of F2-A, recorded for the reviewer)

| ID | Finding | Evidence |
|---|---|---|
| **D1** | `res.json({ query: q, limit: results.length, results })` — the echoed `limit` is the **actual result count**, not the requested limit. Retrieve renders "Results (n)" from `res.length`, so it happens to be consistent; a strict-contract consumer would be misled. **Decision: keep it** (§A2.8) — changing it *is* a response-contract change. | `search.ts:66` [V] |
| **D2** | `search.ts:31` `Math.floor(Number(limit) \|\| 10)` clamps to `[1,50]`. `limit: 0` → `0 \|\| 10` → **10**; `limit: -3` → `1`; `limit: 1e9` → `50`; `limit: "abc"` → `NaN \|\| 10` → `10`. No 500s. Works; the fix keeps the same arithmetic (only the comment changes). | `search.ts:31` [V] |
| **D3** | `errorHandler` is declared with 3 params (`middleware/error.ts:7`), so Express never treats it as an error handler — any non-route throw can surface as an HTML error page. Already logged as **F6** in `phase1/RESULT.md:73` [G]. Out of scope; the fix must not *depend* on it (see §A2.3: the route catches its own errors). | — |

---

## A2. ROOT CAUSE + FIX

### A2.1 Root cause, in one sentence

**`search.ts` computes a relevance *score* in `ORDER BY` but never evaluates a match *predicate* — `ts_rank()` returns a defined non-zero value for every document, so the filter `WHERE d.access_policy = $1 OR $1 = '*'` is the only WHERE clause in the statement and `LIMIT $3` becomes the only thing that removes rows.**

Three parts to the fix, and all three are required:

1. **A match predicate** `to_tsvector('english', c.text) @@ websearch_to_tsquery('english', $2)` — decides *which* rows (AC1, AC2).
2. **Exactly one guard** in TypeScript, *before* the query — `typeof q !== 'string' || !q.trim()` → **400**, today's message verbatim. **No second guard.** A lexeme-less but non-blank `q` (`"the and or"`, `"!!!"`, `"-"`) is **not** rejected: it reaches the SQL and returns **200 with `results: []`**, because the empty tsquery matches nothing (measured [V: `probe_edge.sql`/`probe_current_vs_fixed.sql`, `EMPTY_TSQUERY_BEHAVIOUR` → 0 rows). That is the honest answer and it is **not** "the whole library" (R1).
3. **A deterministic tiebreaker** — because ties at rank `0`/`1e-20` are the norm, not the exception.

### A2.2 Final SQL — copy-pasteable, exactly as it lands in `search.ts`

```sql
        SELECT d.id AS document_id,
               d.name AS document_name,
               d.access_policy AS document_policy,
               c.id AS chunk_id,
               c.text,
               c.page_no,
               c.start_char,
               c.end_char
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE (d.access_policy = $1 OR $1 = '*')
          AND to_tsvector('english', c.text) @@ websearch_to_tsquery('english', $2)
        ORDER BY ts_rank(
                   to_tsvector('english', c.text),
                   websearch_to_tsquery('english', $2)
                 ) DESC,
                 d.id ASC,
                 c.start_char ASC NULLS LAST,
                 c.id ASC
        LIMIT $3
```

Bind parameters are **unchanged**: `values: [policy, q, limitN]` (`search.ts:52`). No new parameter, no interpolation, no string building — the SQL is a static string literal and every user value is a bind (`AC5`: "parameterised SQL only"). [V: current binding is already `$1..$3`; the fix adds no `$4`.]

Differences from today, exhaustively:
1. Parenthesised policy clause (unchanged semantics; parentheses added so the `AND` cannot change precedence).
2. **New**: `AND to_tsvector('english', c.text) @@ websearch_to_tsquery('english', $2)`.
3. **New**: three tiebreaker keys in `ORDER BY`.

Nothing else in the file changes — the mapper (`search.ts:55-64`) and the response (`search.ts:66`) are byte-identical.

**Why this is one statement and not R2's `WITH q AS (...)` CTE (R2 applied, form chosen):** `websearch_to_tsquery('english', $2)` is evaluated at most twice per row by this plan and is a **stable, IMMUTABLE-argument** expression over a bind — it is not a round trip, and the SQL above is a static literal. A `WITH q AS (SELECT websearch_to_tsquery('english',$2) AS tsq)` CTE is **semantically identical** here (`q` returns exactly one row, so the implicit cross join adds nothing) and would let the planner compute the tsquery once, but it also risks a `Nested Loop`/`CTE Scan` shape that **defeats the `chunks_fts_idx` bitmap scan**. The review's own R2 made the CTE **optional** ("optional micro-optimisation, not correctness … Prefer the simplest correct diff") once R1 removes the pre-probe. **Decision: keep the plain form above; do not introduce the CTE.** If a future performance phase wants it, it must first satisfy T-A9's constraint — the EXPLAIN must still show `Bitmap Index Scan on chunks_fts_idx` on the 10 000-chunk fixture (§A3.2b), and if it does not, the plain form is restored.

### A2.3 Complete post-fix handler (TypeScript, so there is no ambiguity)

```ts
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { q, limit = 10, policy = '*' } = req.body as SearchBody;

    // ONE guard. Non-string / missing / blank q -> 400.
    // Message is today's message, verbatim (search.ts:28) — no new contract string.
    // Whitespace-only is now caught too (today "   " passes !q and yields 0 rows).
    if (typeof q !== 'string' || !q.trim()) {
      res.status(400).json({ error: 'q (query string) is required' });
      return;
    }
    // NO lexeme-less guard here. A non-blank but lexeme-less q ("the and or",
    // "!!!", "-") deliberately falls through to the SQL: the empty tsquery
    // matches nothing, so the caller gets 200 { results: [] } — the honest
    // answer, and NOT the whole library. See §A2.4.

    const limitN = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));

    const result: QueryResult<SearchRow> = await pool.query<SearchRow>({
      text: /* the SQL in §A2.2, verbatim */,
      values: [policy, q, limitN],
    });
    // ... unchanged mapper (search.ts:55-64) + res.json({ query: q, limit: results.length, results }) (search.ts:66)
  } catch (err) {
    console.error('[search] / POST error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});
```

**Exactly one round trip per search.** R2 is satisfied by deletion: the `SELECT websearch_to_tsquery('english',$1)::text` pre-probe existed only to feed the lexeme-less 400 that R1 removes. With it gone there is **no second query, no CTE and no new parameter**, so the "connection checkout per request" cost the review objected to does not exist.

### A2.4 Guards — every one of them, and what it returns

| Input | Today | After fix | Why |
|---|---|---|---|
| `q` missing / `null` / `undefined` / `""` / `"   "` / `42` / `{}` / `[]` | `400 {"error":"q (query string) is required"}` (`search.ts:27-30`) | **identical 400** (condition rewritten from `!q \|\| typeof q !== 'string'` to `typeof q !== 'string' \|\| !q.trim()`, which additionally catches whitespace-only — previously `"   "` passed the guard and produced 0 rows via the empty tsquery) | **AC4 choice: keep 400.** Rationale below. |
| `q` = `"the and or"` / `"!!!"` / `"-"` / `":*"` / `"\""` / `"\\"` | 200 with **all chunks** (no predicate) | **200 `{query, limit: 0, results: []}`** — **no second 400 class** (R1) | `websearch_to_tsquery` collapses these to the **empty tsquery**, which matches nothing, so the predicate itself returns 0 rows. That is the honest answer ("your query has no searchable terms") in the result set the caller already understands; it is **not** the whole library and **not** a masked error. Pinned in **T-A5**. A new 400 string would be a contract change no AC asks for (AC4/AC7) and the phase's highest-risk consumer regression. |
| `q` = `"zzzznotfound"` | 200, all chunks | **200 `{query, limit: 0, results: []}`** | AC1. |
| `q` with `'`, `"`, `:`, `*`, `&`, `\|`, `!`, `;`, long strings | 200 (harmless — the tsquery parser is the only interpreter, and it can only produce lexemes/operators) | **200, no SQL error** | `websearch_to_tsquery` **never raises** on arbitrary text: verified for `a'b`, `he said "x`, `foo:bar`, `a*b`, `a&b`, `a\|b`, `hello!`, `-`, `:*`, `\`, `x;DROP TABLE chunks;--` — all returned a valid tsquery or the empty one, never an ERROR [V: `probe_fts.sql`, `special_chars_websearch_vs_plainto`]. The value is a bind, so `x;DROP TABLE chunks;--` is a **string** the parser sees, not SQL. |
| Very long `q` (e.g. 10 000 chars) | 200 | **200** (no length cap added) | `express.json({limit:'1mb'})` (`app.ts:33`) caps the body; tsquery parse is O(n). Adding a cap would be a new contract; recorded as **OQ-3**. |
| `limit` out of range / non-numeric | clamped by `search.ts:31` | **identical arithmetic, identical clamps** | D2. |
| `policy` not in the enum | 0 rows | 0 rows (unchanged) | AC6 — not weakened, not "fixed". |

**Why `400` for empty `q` and not `results: []` (AC4 decision, with the reason):**

1. **It is today's behaviour** — `search.ts:27` already 400s. Choosing `[]` would be a *contract change* that AC7 does not ask for.
2. **`[]` for empty `q` would silence two genuinely broken pages.** Library (`library/page.tsx:23-24`) and Audit (`audit/page.tsx:13`) both call `api.search({q:""})` on mount; `q:""` is falsy, so **today** they hit the existing 400 at `search.ts:27-30` and render that red error. With `[]` they would render "No documents ingested yet" (`library/page.tsx:52-58`) / "No activity yet" (`audit/page.tsx:28`) — **indistinguishable from a healthy empty library.** Keeping the 400 preserves the visible breakage until FU-1 rewires them. This is AC8 ("must not silently return the whole library") in its strongest form: nor silently return *nothing*.
3. AC4 explicitly permits either choice [G: `REQUEST.md:27`].

**Correction to round 0 (R6):** round 0 asserted these pages "show the 400 error text they show today" *after the fix*. That sentence was doing double duty as evidence and it is **not evidence** — `q:""` behaves identically before and after, because the empty-string branch is untouched. It is a **pin of FU-1** only, and §A2.4/§4 AC7 no longer cite it as justification for AC7.

**The only guard is the empty/blank/non-string one.** There is **no** second 400 class: the lexeme-less case (R1) returns `200 + []`. Justification recorded for the reviewer: a second 400 message would be a *new* contract string that no AC requires, and it is the single highest-risk consumer regression in the phase — any caller passing a punctuation-only or stopword-only query would start erroring where it previously got a (bad) 200. If an implementer believes a lexeme-less 400 is essential, it must be raised as an OQ naming a consumer that benefits; it is **not approvable** in this revision.

### A2.5 `tsquery` function choice — `websearch_to_tsquery`, justified

**Decision: `websearch_to_tsquery('english', $2)`, unchanged from today.**

| Candidate | Evidence | Verdict |
|---|---|---|
| `plainto_tsquery` | `'n2n escalation procedure'` → `'n2n' & 'escal' & 'procedur'` (AND, same as websearch); but `'"n2n escalation"'` → `'n2n' & 'escal'` — **quotes are silently stripped into an AND**, so a user's phrase request is silently ignored; `'n2n or vpn'` → `'n2n' & 'vpn'` — the word **`or` becomes a term** (it is not a stopword in the `english` dictionary), so "n2n or vpn" searches for n2n AND vpn AND or, matching *nothing*. Measured [V: `probe_fts.sql`, `matching_query_semantics`]. | Rejected: silently changes meaning of quotes and `or`. |
| `to_tsquery` | Raises `syntax error in tsquery` on user text (`a'b`, unbalanced quotes, `!`) — that is a **500** through `search.ts:67-69`. | Rejected outright (AC5). |
| `phraseto_tsquery` | Only phrases (`<->` between **all** terms), so a multi-word question becomes a strict adjacency requirement. | Rejected: wrong for natural-language input. |
| **`websearch_to_tsquery`** | **Never raises** on any input tested (11 hostile strings, 0 errors); quotes → real phrase operator (`'n2n' <-> 'escal'`); `or` → disjunction; `-vpn` → negation (`'n2n' & !'vpn'`); bare multi-word → AND (`'n2n' & 'escal' & 'procedur'`) [V: same probe]. It is also **what the code already compiles today**, so the ranking expression in `ORDER BY` is unchanged, which minimises contract risk. | **CHOSEN.** |

**Documented multi-word rule (AC3), to go in a code comment above the SQL:**

- *Bare multi-word query* → **AND of lexemes** (`"n2n escalation"` behaviour without quotes is `'n2n' & 'escal'`): every term must appear somewhere in the chunk. Stems are used (`escalation` → `escal`).
- *Double-quoted text* → **phrase, in order, adjacency `<->`** (`'"n2n escalation"'` → `'n2n' <-> 'escal'`). Unbalanced quotes never error; `websearch_to_tsquery` drops the dangling quote (`'he said "x'` → `'said' & 'x'`).
- *`or` (case-insensitive, bare word)* → **disjunction** (`'n2n' | 'vpn'`).
- *`-word`* → **negation** (`!'vpn'`). ⚠ **Edge case, documented not "fixed":** a query that is **only** a negation (`-vpn`) becomes `!'vpn'`, which matches **every chunk that has any lexeme** — measured 4/4 rows in a fixture including an *empty* chunk whose tsvector is empty [V: `probe_edge.sql`, `negated_only_query_behaviour` → `!'vpn'`, `matched = 4`]. This is *not* "returns everything regardless of query" (it still requires a non-empty tsvector, so stopword-only chunks are excluded), and it is the documented, correct semantics of a negated-only tsquery. The plan **accepts** it and pins it in a test (T-A5) so nobody mistakes it for a regression. Making it a 400 is recorded as **OQ-2**.
- *Punctuation* (`:`, `*`, `&`, `|`, `!`, `'`, `;`, `\`) is **not** an operator in this function unless it is a bare-word `or`/leading `-`; `a&b` → `'b'`, `a*b` → `'b'`, `foo:bar` → `'foo' & 'bar'` [V]. That is why no escaping layer is needed and why an escaping layer must **not** be added (it would turn `&` into a lexeme and break `or`/`-`).

### A2.6 Rank threshold — decision: **NO threshold**

**Decision: none. The match predicate is the filter; `ts_rank` is ordering only.**

Reasons, all measured:

1. **A threshold would be arbitrary.** `ts_rank` is unbounded and corpus-dependent: the single matching chunk in a 3-row fixture scored `0.09910` for `'n2n escalation'` and `0.26691` for `'backup rotation nightly'` [V: `probe_current_vs_fixed.sql`]. A constant like `> 0.05` would drop legitimate one-term matches (most of a `0.099`-scored match is *term frequency* normalisation, not relevance). No defensible constant exists without a calibrated corpus — and `public` has **0 chunks** [V], so calibration is impossible.
2. **A threshold cannot add correctness.** Anything `@@` admits is, by definition, a lexical match — AC1 ("no lexical match → 0") and AC2 ("exactly the chunks that match") are both satisfied without it, and a threshold could **violate** AC2 by dropping a genuine match.
3. Ranks of `0`/`1e-20` only occur for **non-matching** rows today; after the predicate those rows cannot appear at all, so the "junk at rank 0" problem that motivates a threshold **disappears at its source**.

Recorded as a deliberate non-decision so the reviewer can see it was considered (result threshold is out of scope; "highlighting optional" per `REQUEST.md:36`).

### A2.7 Deterministic tiebreaker — the three-key `ORDER BY`

Sort keys, in order:

1. `ts_rank(...) DESC` — the document's relevance claim (unchanged expression, so the ranking claim of AC2 is about *this* function).
2. `d.id ASC` — **primary determinism key.** Group results by document, so a tie cannot interleave two documents' chunks arbitrarily.
3. `c.start_char ASC NULLS LAST` — **reading order inside a document**, which is what Retrieve/Chat render. `NULLS LAST` is explicit because `chunks.start_char` is nullable (`schema.ts:25`) and **ingestion inserts no `start_char`/`page_no` at all** — `service.ts:284` inserts only `(document_id, text)` [V: `INSERT INTO chunks (document_id, text) SELECT * FROM UNNEST($1::uuid[], $2::text[])`]. So **in practice every chunk has `start_char IS NULL`**, and key 3 is a no-op today by construction.
4. `c.id ASC` — **final total order.** `chunks.id` is a `UUID PRIMARY KEY` (`schema.ts:21`), unique, so keys 1–4 define a **total order on the result set**. This is what makes `LIMIT` deterministic and the test's ordering assertion meaningful (AC2: "rank ordering is asserted, not assumed").

*(Why key 3 before key 4 rather than `c.id` alone: `c.id` is `gen_random_uuid()` — random. If a future ingestion starts populating `start_char`, reading order must win over random id. The pair costs nothing.)*

### A2.8 Index decision — **NO INDEX CHANGE IS JUSTIFIED** (explicit, with evidence)

**Decision: no `CREATE INDEX`, no `ALTER INDEX`, no migration.** `server/src/db/schema.ts` is **not touched**.

Evidence:

1. **The existing GIN index already fits the new predicate exactly.** Index expression `to_tsvector('english'::regconfig, text)` [`pg_indexes`, V]; predicate `to_tsvector('english', c.text)` resolves the unknown literal `'english'` to `regconfig`, matching the index expression tree — verified equivalent: `to_tsvector('english', …) = to_tsvector('pg_catalog.english', …)` → `t` [V: `probe_fts.sql`]. So the fix **unlocks** `chunks_fts_idx` rather than needing a new one.
2. **No measurement is currently possible to justify a *new* index, and none is needed.** `EXPLAIN` on `public.chunks` is **vacuous**: `documents = 0`, `chunks = 0` [V]. Any `EXPLAIN` there returns a trivial plan regardless of index. To avoid fabricating evidence I ran `EXPLAIN (COSTS OFF)` on a session-local **temp** fixture shaped like the real query — and it confirms only the *access path shape*: with no index on the temp table the planner does `Seq Scan on p2e_chunks  Filter: (to_tsvector('english'::regconfig, text) @@ '''escal'''::tsquery)` → `Nested Loop` [V: `probe_explain.sql`]. That proves the predicate is planner-visible and **does not** prove a bitmap scan on a large corpus (impossible: no data). Recorded as **OQ-1** for the reviewer: *index-need evidence can only be measured after the test fixtures exist*; §3.3 gives the exact `EXPLAIN` the Test Engineer must run against the seeded fixture and the exact rule to apply.
3. **The realistic corpus makes an index change moot.** Local-first single-tenant app, `f1test` holds 182 documents [V: `select count(*) from f1test.documents` → `182`] with ~1 chunk each — a corpus where a seq scan beats a bitmap scan because it *is* smaller than a bitmap page read. A GIN index is already present and 40 kB [V]; it will be used automatically once selectivity warrants it.
4. **`d.access_policy` has no index** [V]. Adding one would be an **additive, reversible** change, but there is **no measured evidence** that the join's filter is the bottleneck (dataset too small to measure), and AC9 says "only if justified by measured EXPLAIN evidence". **Not justified → not added.**

**The reviewer/testers must treat "no index change" as an assertion, not an omission:** T-A9 verifies `schema.ts`'s hash is unchanged and that `pg_indexes` for `public.chunks`/`public.documents` equals the pre-fix set.

### A2.9 Rejected alternatives — the CTE form, and the two-round-trip pre-probe

**A9-a. Computing the tsquery once in a CTE (R2's optional form) — NOT adopted.**

```sql
WITH q AS (SELECT websearch_to_tsquery('english', $2) AS tsq)
SELECT ... FROM chunks c JOIN documents d ON ... CROSS JOIN q
WHERE (...) AND to_tsvector('english', c.text) @@ q.tsq
ORDER BY ts_rank(to_tsvector('english', c.text), q.tsq) DESC, ...
```
Tempting (one parse of `q`, one place for the query) but **not adopted**: the planner may treat `q.tsq` as a non-constant and refuse to use `chunks_fts_idx` (a GIN scan requires a *constant* right-hand side predicate, and a CTE column is not guaranteed to be folded to one), i.e. the "optimisation" can silently disable the index the fix exists to use. The shipped form (§A2.2) repeats `websearch_to_tsquery('english', $2)` textually — the parser cost is nanoseconds and the *same* value is used in both places because `$2` is the same bind, which keeps the index usable. The review (R2) made this form **optional and conditional on an EXPLAIN check**; the condition is recorded in T-A9's decision rule. Not adopted in this revision.

**A9-b. The `SELECT websearch_to_tsquery('english',$1)::text` pre-probe — DELETED (R1 + R2).**
It existed solely to detect the empty tsquery and emit a second 400. R1 removes that 400; therefore the probe has **no consumer** and is removed. This is the correct way to satisfy R2's "drop the extra round trip": not by merging it into a CTE, but by not needing it. The handler in §A2.3 issues **exactly one** `pool.query`.

### A2.10 Unchanged response contract (AC7) — the exact assertion

Byte-for-byte identical, both in shape and in field names:

- 200 body: `{ "query": <the submitted q, verbatim, untrimmed>, "limit": <results.length>, "results": [ ... ] }` (`search.ts:66`).
- Each element: exactly the 8 keys `document_id, document_name, document_policy, chunk_id, text, page_no, start_char, end_char` in that order (`search.ts:55-64`).
- 400 body: `{ "error": "q (query string) is required" }` (existing message preserved verbatim for the missing/blank/non-string case).
- **There is no new 400 message** (R1). The only statuses the route can now produce are **200** and the pre-existing **400**/**500**; the lexeme-less case is a 200 with `results: []`. `api.request` surfaces errors as `Error(message)` (`api.ts:34-37`) which Retrieve/Chat render in red (`retrieve/page.tsx:66`, `chat/page.tsx:45`); the `results: []` path renders their normal empty-state, unchanged from a legitimate zero-hit search.

**AC7 justification (R6):** AC7 is satisfied because the 200 shape, the 8 element keys, the `limit` semantics and the existing 400 body are all untouched. The Library/Audit page-level observation is **not** part of this justification — it is a pin of FU-1 (see T-A8).

**Note on D1:** `limit` stays the **result count** (`results.length`), not the requested limit. Changing it to the requested limit would be tidier but is a contract change; it is recorded as follow-up **FU-2**, not done.

---

## A3. TEST STRATEGY — F2-A

### A3.1 Isolation strategy: **scratch schema `p2test`, NOT public + hash-scoped cleanup**

**Decision: create schema `p2test`, run the server against it via `DATABASE_URL` + `options=-c search_path=p2test`, and `DROP SCHEMA IF EXISTS p2test CASCADE` at the end.**

Why this and not "public + unique `p2-` names + delete by id":

| | Scratch schema `p2test` | `public` + `p2-` prefix |
|---|---|---|
| Removes the vacuous-pass trap (C1) | **Yes** — the schema starts at 0 rows, so the fixtures are the *only* thing search can see; a "0 results" assertion is then meaningful | **Yes**, but only if `public.chunks` is asserted empty **first** |
| Proves the 0-result assertion is not vacuous | **Yes, structurally** — the count is 0 *and* the seed is the only content | Needs an explicit pre-check assertion (easy to forget) |
| Risk to real data | **None** — separate schema; `public` is never in the search path | **Real**: a mistaken `DELETE`/`TRUNCATE` targets the live tables; `documents`/`chunks` have FK cascade (`schema.ts:22`), so one wrong id cascades |
| Risk to `f1test` (181/182 docs, must not be touched) | **None** | **None** if scoping is right, but the same blast radius exists |
| Leaves residue if the run crashes | A schema — visible, droppable, named | Rows — invisible, indistinguishable from real data |
| Permission needed | `CREATE` on database → **`t`** [V: `has_database_privilege`] | `INSERT/DELETE` on public → also available |
| Cost | One `CREATE SCHEMA` + `initSchema` (works: `initSchema` uses `CREATE TABLE IF NOT EXISTS`/`CREATE INDEX IF NOT EXISTS` with unqualified names → creates in `p2test` under `search_path`; **verified by reading `schema.ts:3-64`**, and this is exactly how F1's `f1test` schema was created [G: `server/src/ingest/__f1__/t01_success.test.ts:54-67`]) | — |
| `pgcrypto` (`gen_random_uuid`) | Extension is **database-scoped** and already installed in `knowledge_app` [V: `pg_extension` → `pgcrypto 1.4`], so it resolves from `p2test` too | — |

**Residual risk accepted:** `SCHEMA` in `schema.ts:3` begins `CREATE EXTENSION IF NOT EXISTS "pgcrypto"` (unqualified ⇒ current schema), so `initSchema` in `p2test` *may* create a second `p2test.pgcrypto`. Harmless (dropped with the schema) and explicitly **not** something the implementer should edit `schema.ts` to avoid (that would violate A2.8's "schema.ts untouched").

**Known side effect on `p2test`, stated up front (R7/R16):** `initDb()` calls `ensureDefaultAdmin(pool)` (`db/index.ts:14`), which queries and inserts into `admins` **by unqualified name** (`db/index.ts:23-33`). Because the server's `search_path` is `p2test`, booting against `p2test` **creates `p2test.admins` and inserts one row** (`admin`), logging `[db] default admin created (admin / admin123)` (`db/index.ts:33`). This is expected and harmless: the row lives in `p2test`, is dropped with the schema, and `public.admins` is **not** touched. The cleanup assertions (§A3.5) record `p2test.admins` = **1** *before* the drop and `public.admins` = **1** after, so the side effect is *observed and proven*, not assumed.

**Hard guards for the test harness — the exact list (each an assertion, all fail-fast):**

| Guard | Query (run through `$PSQL` with `SET search_path = p2test`) | Required value | What it protects |
|---|---|---|---|
| **G1** | `SELECT current_schema();` | `p2test` | The harness is pointed where it thinks it is. **Fail → refuse to run.** |
| **G2** | `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('documents','chunks');` | `2` (the tables exist in `public`) **and** `SELECT count(*) FROM public.chunks;` | `0` | Proves `public` still holds its (empty) tables and that the **fixture rows are not visible there** — the real non-vacuity check, replacing round 0's vacuous `AND false` query. |
| **G3** | `SELECT count(*) FROM f1test.documents;` | `182` | `f1test` is never resolved to and is untouched by this phase. |
| **G4** | `SELECT count(*) FROM documents WHERE name NOT LIKE 'p2-%';` | `0` | Every fixture is prefixed, so residue is identifiable even if `DROP` fails. |
| **G5** | `SELECT count(*) FROM chunks;` | `10` (**exactly** — the fixture contract of §A3.2) | The thing we assert 0 results against is non-empty. **Fail → refuse to run.** |
| **G6** | `SELECT count(*) FROM documents;` | `9` | Fixture shape (9 documents / 10 chunks). |
| **G7** | `SELECT count(*) FROM admins;` | `1` | Records the `p2test` admin side effect (R7). |
| **G8** | `SELECT count(*) FROM pg_namespace WHERE nspname='p2test';` — **immediately before** any `DROP` | `1`, and the drop statement must be the literal `DROP SCHEMA IF EXISTS p2test CASCADE;` | No drop ever targets another schema. |

The harness **refuses to run** unless G1, G5 and G6 hold, mirroring F1's `blocked()` convention (`t01_success.test.ts:25-28,62`). Cleanup is `DROP SCHEMA IF EXISTS p2test CASCADE;` in a `finally`-equivalent, and it is **idempotent** (safe on a retry). No `TRUNCATE`, no `DROP TABLE` on any schema other than `p2test`.

### A3.2 Fixture set (deterministic, `p2-` names)

Created with the **real ingestion path where possible** (to prove `chunks` are real) and direct SQL only where the ingestion path cannot express the case. Every document name starts with `p2-`; every `documents.sha256` is `sha256('p2-<name>')` so it is also unique per fixture and traceable.

| Doc (name) | policy | chunk # | text | Purpose |
|---|---|---|---|---|
| `p2-doc-main` | `public` | 1 | `The N2N escalation procedure requires a pager alert within five minutes.` | **highest-density long hit** for `escalation pager`; the primary matching target |
| `p2-doc-main` | `public` | 2 | `Backup rotation runs nightly at 03:00 UTC on the vault host.` | second match target, disjoint terms |
| `p2-doc-main` | `public` | 3 | `The N2N escalation procedure also pages the on-call database administrator.` | rank cluster near chunk 1 (same doc, same terms) |
| `p2-doc-trusted` | `trusted` | 1 | `Trusted N2N escalation notes for the platform team.` | policy inclusion/exclusion, contains the term |
| `p2-doc-restricted` | `restricted` | 1 | `Restricted salary bands for grade 7 staff are reviewed annually.` | must **never** appear under `policy='public'`/`'trusted'`; **must** appear under `'*'` |
| `p2-doc-stop` | `public` | 1 | `the and or` | empty-tsvector row (never matches positively) |
| `p2-doc-junk` | `public` | 1 | `... --- !!!` | second empty-tsvector row |
| `p2-doc-nomatch` | `public` | 1 | `Quarterly apricot marmalade inventory is counted in April.` | a **non-matching but lexeme-bearing** row: proves the predicate (not just "empty table") is what removes rows |
| **`p2-doc-zulu`** | `public` | 1 | `Weekly pager test: the escalation drill is scheduled for Friday.` | **R3** — contains both terms; document name sorts **after** `p2-doc-main` |
| **`p2-doc-zulu`** | `public` | 2 | `Pager escalation.` | **R3 discriminator** — short/high-density, intended to rank **above** `main#1`, so rank order and document-name order **disagree** |

That is **9 documents, 11 chunks** (G5 asserts exactly `11`; G6 asserts `9`). The prose sentence of round 0 ("exactly one can match `backup`, exactly two can match `escalation`") is **withdrawn** — the authoritative counts are the table below, which the harness asserts directly.

**Exact match counts to assert (recounted, not estimated):**

| `q` | matching chunks | count |
|---|---|---|
| `zzzznotfound` | none | **0** |
| `backup` | `main#2` | **1** |
| `backup vault` (AND) | `main#2` | **1** |
| `backup apricot` (AND) | none | **0** |
| `apricot marmalade` | `nomatch#1` | **1** |
| `apricot or vault` | `nomatch#1`, `main#2` | **2** |
| `escalation` | `main#1`, `main#3`, `trusted#1`, `zulu#1`, `zulu#2` | **5** |
| `"escalation procedure"` (phrase) | `main#1`, `main#3` | **2** |
| `"procedure escalation"` (phrase, reversed) | none | **0** |
| `escalation pager` | `main#1`, `zulu#1`, `zulu#2` | **3** |
| `escalation -pager` | `main#3`, `trusted#1` | **2** |
| `-vpn` (negation only) | every lexeme-bearing chunk = all 11 minus `stop#1`/`junk#1` | **9** (documented edge case, §A2.5 / T-A5) |
| `the and or` / `!!!` / `-` | none (empty tsquery) | **0** |
| `escalation` with `policy='public'` | `main#1`, `main#3`, `zulu#1`, `zulu#2` | **4** |
| `escalation` with `policy='trusted'` | `trusted#1` | **1** |
| `escalation` with `policy='restricted'` | none (`restricted` chunk has no matching lexeme) | **0** |

**The T-A3 discriminating pair (why `p2-doc-zulu` chunk 2 is not optional).** Round 0's fixture had both `escalation pager` hits inside `p2-doc-main`, so `ORDER BY d.id ASC, c.id ASC` (rank-less) reproduced the rank order by accident — the test could not tell relevance from the tiebreaker. Now:

- `p2-doc-main` sorts **before** `p2-doc-zulu`, so a rank-less sort would put **both `main` chunks first**;
- `zulu#2` (`Pager escalation.`) is intended to carry the **highest** `ts_rank`, so the fixed SQL must put a **`p2-doc-zulu`** chunk **first**.

⇒ fixed order `[zulu#2, main#1, zulu#1]` vs rank-less order `[main#1, zulu#1, zulu#2]` — the first element differs, which is precisely what T-A3's mutation check requires.

> **[U] honesty note — I did not run this rank.** "`Pager escalation.` outranks `main#1`" is a `ts_rank` **density** argument (2 of 2 tokens are query terms vs 3 terms in a 12-token sentence), not a measurement; `ts_rank` is not length-normalised in the way a naive BM25 intuition suggests. **The harness therefore never hard-codes the expected sequence.** It (a) derives the expected sequence **from the fixed SQL itself** and asserts HTTP equals it — that is the *contract*; and (b) asserts the rank-less SQL's order **differs** from the fixed SQL's order — that is the *discrimination*. If (b) fails, the verdict is **BLOCKED with the recorded reason "fixture cannot discriminate rank from tiebreak"**, never PASS.

### A3.2b EXPLAIN fixture — 10 000 chunks, `p2test` only (R5)

To make T-A9's index decision falsifiable, seed a **separate, clearly-named** bulk fixture **inside `p2test` only** (never `public`, never `f1test`). Run `SET search_path = p2test;` first:

```sql
-- 10 000 documents, 10 000 chunks, all named p2-bulk-*
INSERT INTO documents (id, name, sha256, access_policy)
SELECT gen_random_uuid(), 'p2-bulk-' || g, encode(sha256(('p2-bulk-' || g)::bytea), 'hex'), 'public'
FROM generate_series(1, 10000) g;

INSERT INTO chunks (document_id, text)
SELECT d.id, 'bulk lorem ipsum filler dolor sit amet token' || substr(d.name, 9)
FROM documents d
WHERE d.name LIKE 'p2-bulk-%';
```

Rules for this fixture:
- **Exactly 10 000** `p2-bulk-*` documents and **10 000** chunks. G5's "exactly 11" is asserted **before** seeding; a post-seed assertion checks **10 011** chunks.
- The EXPLAIN probe word must be **absent** from the functional fixture so the two cannot mask each other: use `q='lorem'` (present only in bulk chunks) and `q='escalation pager'` (present only in functional chunks).
- This fixture is **dropped with `p2test`**; it never touches `public`.
- It is used by **no assertion other than T-A9's EXPLAIN**.

Creation order: `POST /api/ingest/upload` (multipart, real JWTs) for the three `.txt` docs that only need one chunk each → `.md`/`.txt` files with the exact text; **direct `INSERT` for the multi-chunk doc** (`p2-doc-main`) and for the empty-tsvector docs, because (a) the chunker decides chunk boundaries and we need 3 specific chunks (`chunker.splitIntoChunks`, `service.ts:179`), and (b) `... --- !!!` cannot be uploaded as a *file* whose parsed text is exactly that without the parser adding/normalising. Direct inserts must supply `documents.sha256` explicitly (NOT NULL, `schema.ts:12`) and reuse the FK `documents.id`.

### A3.3 Assertions — one block per AC

`jq` is assumed present (`C:\Users\PC_DEV\...` — the Test Engineer must confirm; otherwise `node -e`).

**T-A1 — nonsense query → exactly 0 results (AC1).**
```bash
R=$(curl -sS -X POST http://127.0.0.1:4000/api/search \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"q":"zzzznotfound","limit":10}')
echo "$R" | jq -e '(.results|length)==0 and .limit==0 and .query=="zzzznotfound"'
```
Assertions: HTTP **200**; `.results|length == 0`; `.limit == 0`; `.query == "zzzznotfound"`.
**Gate (the mutation proof — this is what makes T-A1 non-vacuous):** the harness must first prove the fixture is non-vacuous (**G5 = 11**) **and** prove the *old* behaviour differs, by running the same `q` through the no-predicate SQL directly:
```sql
SET search_path = p2test;
SELECT count(*) FROM (
  SELECT 1 FROM chunks c JOIN documents d ON d.id = c.document_id
  WHERE (d.access_policy = '*' OR '*' = '*')
  ORDER BY ts_rank(to_tsvector('english', c.text),
                   websearch_to_tsquery('english', 'zzzznotfound')) DESC
  LIMIT 10
) t;
-- MUST be 10 (the pre-fix behaviour, reproduced: LIMIT 10 over all rows, all rank 0)
```
**Why 10 and not 11:** the pre-fix query has **no predicate**, so `LIMIT 10` truncates the 11 fixture chunks to 10 — round 0 wrote "MUST be 9" because its fixture had 9 chunks. The expected value is `min(11, LIMIT)`; with `limit:10` it is **10**. If this returns `0`, the fixture is wrong and T-A1 is **BLOCKED**, not PASS.
**R17 evidence clause:** T-A1 returning `0` for `zzzznotfound` **on the seeded fixture** is the positive proof that the live code is the fixed code (see §A3.4 preflight).

**T-A2 — matching query returns exactly the matching chunks, as a SET (AC2, first half; R4).**
```bash
R=$(curl -sS -X POST http://127.0.0.1:4000/api/search -H "Authorization: Bearer $TOK" \
  -H 'Content-Type: application/json' -d '{"q":"apricot marmalade","limit":10}')
echo "$R" | jq -e '([.results[].chunk_id]|length)==1 and ([.results[].document_name]==["p2-doc-nomatch"])'

# The 5-match case: SET equality against SQL, not cardinality.
R2=$(curl -sS -X POST http://127.0.0.1:4000/api/search -H "Authorization: Bearer $TOK" \
  -H 'Content-Type: application/json' -d '{"q":"escalation","limit":10}')
HTTP_IDS=$(echo "$R2" | jq -r '[.results[].chunk_id]|sort|join(",")')
SQL_IDS=$($PSQL -tA -c "SET search_path = p2test;
  SELECT string_agg(c.id::text, ',' ORDER BY c.id::text) FROM chunks c
  JOIN documents d ON d.id = c.document_id
  WHERE (d.access_policy = '*' OR '*' = '*')
    AND to_tsvector('english', c.text) @@ websearch_to_tsquery('english','escalation');")
[ -n "$HTTP_IDS" ] && [ "$HTTP_IDS" = "$SQL_IDS" ] \
  && echo "T-A2 PASS set-equality" || { echo "T-A2 FAIL http=$HTTP_IDS sql=$SQL_IDS"; exit 1; }
echo "$R2" | jq -e '(.results|length)==5 and ([.results[].chunk_id]|unique|length)==5'
```
Assertions: **(i)** `sort(HTTP chunk_id set) == sort(SQL chunk_id set)` — set equality, element-for-element; **(ii)** `results.length == expected.length` (**5**); **(iii)** no duplicate `chunk_id`. Cardinality alone is **not** accepted (it can pass under the bug if the fixture ever exceeds `limit`).

**T-A3 — rank ordering, with a mutation check (AC2, second half; R3).**
```bash
R=$(curl -sS -X POST http://127.0.0.1:4000/api/search -H "Authorization: Bearer $TOK" \
  -H 'Content-Type: application/json' -d '{"q":"escalation pager","limit":10}')
HTTP_SEQ=$(echo "$R" | jq -r '[.results[].chunk_id]|join(",")')

# (1) expected sequence, derived FROM THE FIXED SQL (never hard-coded):
FIXED_SEQ=$($PSQL -tA -c "SET search_path = p2test;
  SELECT string_agg(chunk_id::text, ',' ) FROM (
    SELECT c.id AS chunk_id
    FROM chunks c JOIN documents d ON d.id = c.document_id
    WHERE (d.access_policy = '*' OR '*' = '*')
      AND to_tsvector('english', c.text) @@ websearch_to_tsquery('english','escalation pager')
    ORDER BY ts_rank(to_tsvector('english', c.text),
                     websearch_to_tsquery('english','escalation pager')) DESC,
             d.id ASC, c.start_char ASC NULLS LAST, c.id ASC
    LIMIT 10) o;")
[ "$HTTP_SEQ" = "$FIXED_SEQ" ] || { echo "T-A3 FAIL http=$HTTP_SEQ fixed=$FIXED_SEQ"; exit 1; }

# (2) MUTATION CHECK: rank-less order must DIFFER, else the fixture cannot discriminate.
RANKLESS_SEQ=$($PSQL -tA -c "SET search_path = p2test;
  SELECT string_agg(chunk_id::text, ',') FROM (
    SELECT c.id AS chunk_id
    FROM chunks c JOIN documents d ON d.id = c.document_id
    WHERE (d.access_policy = '*' OR '*' = '*')
      AND to_tsvector('english', c.text) @@ websearch_to_tsquery('english','escalation pager')
    ORDER BY d.id ASC, c.id ASC
    LIMIT 10) o;")
if [ "$RANKLESS_SEQ" = "$FIXED_SEQ" ]; then
  echo "BLOCKED: fixture cannot discriminate rank from tiebreak"
  exit 2
fi
echo "T-A3 PASS http==fixed, rankless differs"
```
Assertions, all three required:
1. **Sequence equality** — HTTP `chunk_id` order equals the fixed SQL's `c.id` order, element-for-element.
2. **Mutation check** — the rank-less order (`ORDER BY d.id ASC, c.id ASC`) must **differ** from the fixed order. If it is identical the fixture cannot separate relevance from the tiebreaker → **BLOCKED, never PASS**.
3. `.results[0]` must be the SQL's first row (implied by 1; asserted explicitly for a readable failure message).

**Demoted assertion (R3):** `[.results[].document_id] == ([.results[].document_id] | sort)` is retained **only** as a *tiebreaker* proof (it shows key 2 of §A2.7 is applied within equal ranks) and is **explicitly not** evidence of rank ordering — it passes identically under the rank-less query.
```bash
echo "$R" | jq -e '[.results[].document_id] == ([.results[].document_id] | sort)'  # TIEBREAKER only
```
The ranks themselves are asserted only relationally — **no absolute rank number is asserted**, because `ts_rank` values are corpus statistics, not contract (§A2.6). The *ordering* is the contract.

**T-A4 — multi-word semantics (AC3).** Four calls, four assertions (counts from the §A3.2 table):
```bash
# (a) bare multi-word == AND: every term must be present
curl ... -d '{"q":"backup vault","limit":10}'      | jq -e '(.results|length)==1'          # only main#2
curl ... -d '{"q":"backup apricot","limit":10}'    | jq -e '(.results|length)==0'          # AND, not OR
# (b) quoted phrase == adjacency: reversed order must not match
curl ... -d '{"q":"\"escalation procedure\"","limit":10}' | jq -e '(.results|length)==2'   # main#1, main#3
curl ... -d '{"q":"\"procedure escalation\"","limit":10}' | jq -e '(.results|length)==0'
# (c) 'or' == disjunction
curl ... -d '{"q":"apricot or vault","limit":10}'  | jq -e '(.results|length)==2'          # nomatch#1 + main#2
# (d) '-term' == negation
curl ... -d '{"q":"escalation -pager","limit":10}' | jq -e '(.results|length)==2'          # main#3, trusted#1
```
Assertion (a) is the one that *proves* AND rather than OR; (b) proves the phrase operator (which `plainto_tsquery` would fail — see §A2.5, so this test is also the guard against someone "simplifying" the function later).
**Count corrections vs round 0:** phrase `"escalation procedure"` is **2** (was 3 — round 0 counted only one `main` chunk as matching); `escalation -pager` is **2** (was 1 — `zulu#1` and `trusted#1` both match `escalation`; `main#3` matches `escalation` but also contains "pages", which is **not** the lexeme `pager`; the deterministic value is what the harness derives from SQL — see the note below).

> **Rule for every count in T-A4:** the number in the comment is the **expected** value, and the harness first verifies it against SQL (`SELECT count(*)` with the same predicate and the same `websearch_to_tsquery(q)`), so a fixture edit cannot silently invalidate the test. If HTTP and SQL disagree, the failure is a genuine product bug; if SQL disagrees with the comment, the comment is stale and must be corrected **before** the test can PASS — it is recorded, never silently relaxed.

**T-A5 — empty / whitespace / lexeme-less — TWO distinct outcomes (AC4, AC5; R1).**
```bash
# 1. EMPTY / BLANK / NON-STRING  -> 400, message verbatim from search.ts:28
for q in '""' '"   "' '"	"' 42 null '{}' '[]' true; do
  code=$(curl -sS -o /tmp/b.json -w '%{http_code}' -X POST http://127.0.0.1:4000/api/search \
    -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d "{\"q\":$q}")
  [ "$code" = 400 ] || { echo "FAIL $code for q=$q (expected 400)"; exit 1; }
  jq -e '.error == "q (query string) is required"' /tmp/b.json || { echo "FAIL msg q=$q"; exit 1; }
done
# omitted q entirely -> same 400
curl -sS -o /tmp/b.json -w '%{http_code}\n' -X POST http://127.0.0.1:4000/api/search \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"limit":10}'   # 400
jq -e '.error == "q (query string) is required"' /tmp/b.json

# 2. NON-BLANK but LEXEME-LESS -> 200 with results: []   (R1 — NO second 400 class)
for q in '"the and or"' '"!!! "' '"-"' '":*"'; do
  curl -sS -o /tmp/b.json -w '%{http_code} ' -X POST http://127.0.0.1:4000/api/search \
    -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d "{\"q\":$q}"
  jq -e '(.results|length)==0 and .limit==0' /tmp/b.json || { echo "FAIL lexeme-less q=$q"; exit 1; }
done
```
**Exact expected matrix (the three assertions of round 0 become these):**

| `q` | Status | Body | Why |
|---|---|---|---|
| `""`, `"   "`, `"\t"`, `42`, `null`, `{}`, `[]`, `true`, **omitted** | **400** | `{"error":"q (query string) is required"}` | the **only** guard (`typeof q !== 'string' || !q.trim()`); today's message verbatim |
| `"the and or"`, `"!!!"`, `"-"`, `":*"` | **200** | `{"query":<q>,"limit":0,"results":[]}` | empty tsquery ⇒ predicate matches nothing (measured [V: `probe_current_vs_fixed.sql` L62-65 → 0 rows]). **Not** the whole library, **not** a masked error |
| `"zzzznotfound"` | **200** | `{"results":[]}` | AC1 (T-A1) |
| `"-vpn"` (negation only) | **200** | `results` = **9** = every lexeme-bearing chunk (11 − `stop#1` − `junk#1`) | documented negation edge case (§A2.5); pinned so it cannot change silently |

**Never** 500, and **never** `200` with `results|length > 0` for any row in the first two rows of the table.
**R1 justification recorded:** a lexeme-less 400 would be a second, new contract string that no AC requires and the highest-risk consumer regression in the phase. Consumers behave correctly with `200 + []`: `retrieve/page.tsx` and `chat/page.tsx` render their normal empty-state, exactly as for any zero-hit search, and no caller branches on a "no searchable terms" error.
**`-vpn` is asserted as 9, not "≥1"** (round 0 accepted any non-empty list); if the harness measures a different number it must reconcile it with SQL's `count(*)` of lexeme-bearing chunks **before** recording PASS.

> **Note (counts after the R3 fixture change):** `stop#1` (`the and or`) and `junk#1` (`... --- !!!`) are the two rows with an **empty** tsvector and therefore the only two that `@@`-filter out of a negation-only query. 11 − 2 = **9**. This is arithmetic on the §A3.2 fixture, **not** a measurement — the harness confirms it against `SELECT count(*) FROM chunks WHERE to_tsvector('english',text) @@ websearch_to_tsquery('english','-vpn')` before asserting.

**T-A6 — malformed / hostile input never 500s (AC5).**
```bash
for q in "a'b" 'he said "x' 'foo:bar' 'a*b' 'a&b' 'a|b' 'hello!' ':*' '\' \
         'x;DROP TABLE chunks;--' "'; DELETE FROM documents; --" "$(printf 'a%.0s' $(seq 1 10000))"; do
  code=$(curl -sS -o /tmp/b.json -w '%{http_code}' -X POST http://127.0.0.1:4000/api/search \
    -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
    --data-binary "$(node -e 'process.stdout.write(JSON.stringify({q:process.argv[1],limit:10}))' "$q")")
  [ "$code" = 200 -o "$code" = 400 ] || { echo "FAIL $code for $q"; exit 1; }
  jq -e 'has("error") or has("results")' /tmp/b.json >/dev/null || { echo "FAIL body $q"; exit 1; }
done
# after the loop, prove the table survived (fixture is 11 chunks; nothing was deleted):
$PSQL -tA -c "SET search_path = p2test; SELECT count(*) FROM chunks;"   # must still be 11
$PSQL -tA -c "SET search_path = p2test; SELECT count(*) FROM documents;" # must still be 9
# limit torture — every case must be 2xx with 1..50 results (search.ts:31 arithmetic unchanged):
for l in 0 -1 1 50 51 1000000 '"abc"' null 1e309; do
  n=$(curl -sS -X POST http://127.0.0.1:4000/api/search -H "Authorization: Bearer $TOK" \
        -H 'Content-Type: application/json' -d "{\"q\":\"escalation\",\"limit\":$l}" \
      | jq -r '.results|length')
  [ "$n" -ge 0 ] && [ "$n" -le 50 ] || { echo "FAIL limit=$l -> $n"; exit 1; }
done
```
**Rate-limit note (NB-4, so a 429 is not mistaken for a product failure):** `express-rate-limit` is 100 req/min on `/api` (`app.ts:35-41`). T-A5 + T-A6 + the limit loop exceed that. The harness must therefore **either** run with the limiter's threshold in mind (sleep between batches) **or** record a `429` explicitly as `RATE-LIMITED, not a test result` and retry after 60 s. A `429` must **never** be recorded as PASS.

**T-A7 — access policy not weakened (AC6).** Five assertions + the invariant:
```bash
curl ... -d '{"q":"escalation","limit":10}'                        | jq -e '([.results[].document_policy]|unique)==["public"] and (.results|length)==4'
curl ... -d '{"q":"escalation","policy":"public","limit":10}'      | jq -e '([.results[].document_policy]|all(.=="public")) and (.results|length)==4'
curl ... -d '{"q":"escalation","policy":"trusted","limit":10}'     | jq -e '([.results[].document_policy]|all(.=="trusted")) and (.results|length)==1'
curl ... -d '{"q":"escalation","policy":"restricted","limit":10}'  | jq -e '(.results|length)==0'
curl ... -d '{"q":"salary","limit":10}'                            | jq -e '(.results|length)==1'   # wildcard still reaches restricted
curl ... -d '{"q":"salary","policy":"public","limit":10}'          | jq -e '(.results|length)==0'   # explicit policy still excludes it
```
The **invariant** (assert programmatically on every response collected in T-A1..T-A6): `∀ r ∈ results: policyArg == '*' ∨ r.document_policy == policyArg`.

**T-A8 — consumer compatibility (AC7).** For each of the four real payloads:
```bash
curl ... -d '{"q":"escalation","limit":20}' > /tmp/r.json    # Retrieve shape
jq -e 'keys == ["limit","query","results"]' /tmp/r.json
jq -e '.results|all(keys == ["chunk_id","document_id","document_name","document_policy","end_char","page_no","start_char","text"])' /tmp/r.json
jq -e '.results|all((.document_id|type)=="string" and (.chunk_id|type)=="string" and (.text|type)=="string")' /tmp/r.json
```
**Page-level check — an FU-1 PIN, not evidence for AC7 (R6).** With the app on `:3000` and a valid session, open `/dashboard/retrieve`, search `escalation`, expect ≥1 blockquote and **no red error**. Then open `/dashboard/library` and `/dashboard/audit` and confirm they show the **400 error text**. **State plainly: these two pages render the 400 error text both *today* and *after* the fix.** The behaviour is identical before and after because `q:""` is untouched by F2-A; this assertion **pins FU-1 as unfixed** and is **not** an assertion of the fix, and it is **not** cited in the AC7 justification.

**T-A9 — no schema change / index set unchanged (AC9) + the falsifiable EXPLAIN rule (R5).**
```bash
cd /d/Develop/knowledge-app && sha256sum -c .pipeline/p2/baseline.sha256 2>&1 \
  | grep -E 'server/src/db/schema.ts|server/src/db/index.ts|server/src/ingest/'   # every line must end ': OK'
$PSQL -c "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('chunks','documents') ORDER BY 1;"
# MUST equal exactly the pre-fix set measured at plan time:
#   chunks_fts_idx | CREATE INDEX chunks_fts_idx ON public.chunks USING gin (to_tsvector('english'::regconfig, text))
#   chunks_pkey    | ... btree (id)
#   documents_pkey | ... btree (id)
```
**EXPLAIN step — against the 10 000-chunk `p2test` fixture of §A3.2b, never `public`:**
```sql
SET search_path = p2test;
EXPLAIN (ANALYZE, BUFFERS, COSTS ON)
  SELECT d.id, c.id, c.text
  FROM chunks c JOIN documents d ON d.id = c.document_id
  WHERE (d.access_policy = '*' OR '*' = '*')
    AND to_tsvector('english', c.text) @@ websearch_to_tsquery('english', 'lorem')
  ORDER BY ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english','lorem')) DESC,
           d.id ASC, c.start_char ASC NULLS LAST, c.id ASC
  LIMIT 10;
```
**Decision rule — all three outcomes named (round 0 had no action for `Seq Scan`):**

| Outcome on the 10 000-chunk fixture | Verdict | Action |
|---|---|---|
| `Bitmap Index Scan on chunks_fts_idx` | **PASS** | Record the plan + runtime in TEST-REPORT. **No index change.** |
| `Seq Scan` **and** `Execution Time < 200 ms` | **PASS** | Record it. The fixture is not selective enough for a bitmap scan to win; **decide nothing**, change nothing. |
| `Seq Scan` **and** `Execution Time ≥ 200 ms` | **PASS** | Record a **new follow-up `FU-PERF-1`** ("FTS query is a seq scan at 10 k chunks; revisit index/`pg_trgm`/`ts_stat` tuning") in the TEST-REPORT. **Do not add an index in this phase** (AC9 + OQ-1). |

`FU-PERF-1` is added to §5 regardless of outcome **only if** the third row fires. The measured `Execution Time` is quoted verbatim in the TEST-REPORT; no runtime is asserted here because none has been measured (**[U]**).

**T-A10 — no regression in Phase 1 / F1 (AC10).**
```bash
cd /d/Develop/knowledge-app/server && npx tsc --noEmit; echo "exit=$?"      # MUST be 0
# upload still works end-to-end into p2test:
printf 'p2 upload fixture line.\n' > /tmp/p2-upload.txt
curl -sS -X POST http://127.0.0.1:4000/api/ingest/upload -H "Authorization: Bearer $TOK" \
  -F 'files=@/tmp/p2-upload.txt;filename=p2-upload.txt' -F 'access_policy=public' | jq -e '.results|length==1'
# after this upload the fixture is 10 documents / 12 chunks: record it, then re-run the
# chunk/document counts as 12/10 for the remainder of the suite (or run T-A10 LAST).
```
(That upload is itself a `p2-` fixture and is removed with the schema.) **Sequencing rule:** T-A10 **must** run **after** T-A1…T-A9, because it changes the fixture counts. If it is run earlier, G5/G6 must be re-asserted against 10 documents/12 chunks before any later test.

### A3.4 Commands — preflight (R17, R18), real JWT, real psql path

**PREFLIGHT — run this once, before any Part A or Part B test. Both checks must pass or the phase is `BLOCKED`.**

```bash
cd /d/Develop/knowledge-app/server

# P-0  WHICH BINARY IS RUNNING (R17).
#   The backend MUST be started with:  npx tsx src/index.ts
#   `npm start` runs the stale, un-baselined dist/index.js and would silently test PRE-FIX code.
#   No dist rebuild happens in this phase.
ps -W 2>/dev/null | grep -i 'tsx' | grep -v grep || echo "CHECK: confirm the server was started with npx tsx src/index.ts"

# P-1  CREDENTIAL PREFLIGHT (R18) — demo pair only, never guess, never echo the token.
CODE=$(curl -sS -o /tmp/login.json -w '%{http_code}' -X POST http://127.0.0.1:4000/api/auth/login \
        -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}')
if [ "$CODE" != "200" ]; then
  printf '%s\n' 'BLOCKED: demo credentials rejected; ADMIN_PASSWORD may be overridden in server/.env'
  exit 1
fi
TOK=$(jq -r '.token' /tmp/login.json)
[ -n "$TOK" ] && [ "$TOK" != "null" ] || { echo 'BLOCKED: login returned no token'; exit 1; }
echo "token acquired: ${#TOK} chars"        # length only, never the value

# P-2  POSITIVE PROOF THAT THE LIVE CODE IS THE FIXED CODE (R17).
#   Run AFTER the p2test fixture is seeded (G5 = 11). T-A1 must return 0 results for
#   'zzzznotfound'. A non-zero count means the running binary is the pre-fix build.
ZZ=$(curl -sS -X POST http://127.0.0.1:4000/api/search -H "Authorization: Bearer $TOK" \
      -H 'Content-Type: application/json' -d '{"q":"zzzznotfound","limit":10}' | jq -r '.results|length')
[ "$ZZ" = "0" ] || { echo "BLOCKED: live binary appears to be pre-fix (zzzznotfound returned $ZZ)"; exit 1; }
```

**Credential handling — the three non-negotiables (R18):**
1. The pair `admin` / `admin123` is the **demo pair already printed in the product UI** (`web/src/components/login-form.tsx:83-86`) and seeded by `db/index.ts:22-34` [G].
2. If P-1 returns **401**, the phase is **`BLOCKED`** with exactly: `BLOCKED: demo credentials rejected; ADMIN_PASSWORD may be overridden in server/.env`. **Do not attempt any other password.** Do not read `.env` to harvest one. Do not modify the admin row.
3. The token is captured into `$TOK` and its **length** is printed; its value is never echoed, logged or written to a repo file.

**psql, exact path, with `search_path` pinned per statement** (no reliance on env):
```bash
export PGPASSWORD="$(grep -E '^DATABASE_URL' /d/Develop/knowledge-app/server/.env \
  | sed -E 's#^DATABASE_URL=postgresql://[^:]+:([^@]*)@.*#\1#')"     # never echoed
PSQL='/d/Install/PostgreSQL/18/bin/psql.exe -h 127.0.0.1 -p 5432 -U knowledge_app -d knowledge_app -X -q -v ON_ERROR_STOP=1'
$PSQL -c 'SET search_path = p2test; SELECT count(*) FROM chunks;'
```
(All `psql` invocations take `-X` — no `~/.psqlrc` — and every statement carries `SET search_path = p2test` so a forgotten schema cannot reach `public`.)

**Server against the scratch schema (start command, for the Test Engineer — the Implementer/Test phases are the ones allowed to start it):**
```bash
cd /d/Develop/knowledge-app/server
DATABASE_URL="$(grep -E '^DATABASE_URL' .env | cut -d= -f2- | sed 's/^/&/')&options=-c%20search_path%3Dp2test" \
  npx tsx src/index.ts      # prints "[server] listening on 127.0.0.1:4000"
```
`options=-c search_path=p2test` is a libpq connection parameter honoured by `pg`; the server's `initDb()` (`db/index.ts:12-14`) then creates all tables inside `p2test`. **Guard:** after boot, `$PSQL -c "SET search_path=p2test; SELECT current_schema();"` must print `p2test`, and `psql -c "SELECT count(*) FROM public.chunks"` must still print **0**.

Web app for the page-level checks: `cd web && npx next dev` → `http://localhost:3000` (`API` is hard-coded to `http://localhost:4000/api`, `api.ts:1`).

**Teardown / cleanup — exact steps, in this order, each idempotent (R7, R16):**

```bash
# C1  RECORD the fixture contents BEFORE the drop (these lines are the deliverable evidence).
$PSQL -tA -c "SET search_path = p2test; SELECT count(*) FROM documents WHERE name LIKE 'p2-%';"   # 10 (9 functional + 1 T-A10 upload)
$PSQL -tA -c "SET search_path = p2test; SELECT count(*) FROM chunks;"                              # 12 (11 + 1)
$PSQL -tA -c "SET search_path = p2test; SELECT count(*) FROM admins;"                              # 1  <- the p2test scratch admin
$PSQL -tA -c "SET search_path = p2test; SELECT username FROM admins;"                              # admin
$PSQL -tA -c "SET search_path = p2test; SELECT count(*) FROM documents WHERE name LIKE 'p2-bulk-%';"  # 10000 (if A3.2b ran)

# C2  G8: prove the thing about to be dropped is named p2test.
$PSQL -tA -c "SELECT count(*) FROM pg_namespace WHERE nspname='p2test';"                           # MUST be 1

# C3  DROP — the only destructive statement in the phase.
$PSQL -c 'DROP SCHEMA IF EXISTS p2test CASCADE;'

# C4  POST-DROP assertions.
$PSQL -tA -c "SELECT count(*) FROM pg_namespace WHERE nspname='p2test';"                           # MUST be 0
$PSQL -tA -c "SELECT count(*) FROM public.documents;"                                             # 0  (untouched)
$PSQL -tA -c "SELECT count(*) FROM public.chunks;"                                                # 0  (untouched)
$PSQL -tA -c "SELECT count(*) FROM public.admins;"                                                # 1  (untouched — the real admin)
$PSQL -tA -c "SELECT username FROM public.admins;"                                                # admin
$PSQL -tA -c "SELECT count(*) FROM f1test.documents;"                                             # 182 (untouched)
```

**`p2test.admins` — the explicit statement the review asked for (R7/R16):**
- Booting the server against `p2test` **creates `p2test.admins` and inserts exactly 1 row** (`admin`), because `ensureDefaultAdmin` uses an unqualified `admins` (`db/index.ts:22-34`) resolved through the connection's `search_path`. Expected and logged as `[db] default admin created (admin / admin123)` (`db/index.ts:33`).
- C1 **records** it (`= 1`, `username = admin`) **before** the drop, proving the row lived in the scratch schema.
- C4 proves `public.admins` is still **1** after the drop — i.e. the scratch admin never leaked into `public` and the real admin was never touched. `public.admins` is **never** written, deleted or updated by this phase.

**Upload blobs (outside the DB):** fixture uploads also leave blobs under `server/data/uploads/<sha>.txt` (F1's content-addressed store). Those are **outside the database** and must be removed **by exact content hash**, computed from the fixture bytes — **never by glob**. Procedure: `sha256sum <file>` **before** upload → record the hash → after teardown, assert the file exists at `server/data/uploads/<that-sha>.txt` → `rm` that one path. Do this for `p2-upload.txt` and each ingested fixture file.

---

# PART B — F2-B: auth token persistence & rehydration

## B1. CURRENT BEHAVIOUR — the exact lifecycle

### B1.1 Who owns the token today: **nobody owns it; two half-owners disagree**

| Store | Written by | Read by | Cleared by |
|---|---|---|---|
| **Module variable** `token` (`web/src/lib/api.ts:3`) | `setToken()` (`api.ts:9-11`) from `login-form.tsx:20`; and internally on 401 (`api.ts:30-31`) | `request()` only (`api.ts:15-17`) — **the only place it is read** | `api.ts:30`, `api.ts:58` |
| **`localStorage["ka_token"]`** | `login-form.tsx:23` | `header.tsx:11` (display only), `dashboard/layout.tsx:16` (auth decision) | `header.tsx:41` only |

Consequence: the two stores are **written together once**, at login, and never re-synchronised afterwards.

### B1.2 Step-by-step lifecycle (every file and line)

1. **Login.** `POST /` (the form at `src/app/page.tsx:3-5` → `components/login-form.tsx`) submits (`login-form.tsx:14-31`). `api.auth.login` (`api.ts:45-53`) → backend `routes/auth.ts:9-33`; on success `res.json({token, user})` (`auth.ts:28`), JWT signed `expiresIn:'12h'` (`auth.ts:27`). Client then, in order:
   - `setToken(data.token)` → module var set (`login-form.tsx:20`, `api.ts:9-11`);
   - `localStorage.setItem("ka_token", data.token)` (`login-form.tsx:23`) — **today the *form*, not the owner, performs this write**;
   - `router.push("/dashboard")` (`:24`) then `router.refresh()` (`:25`).
   **The exact post-login sequence, recorded (R14; N-6c corrected):** `api.auth.login` resolves → `setToken(data.token)` at `:20` → `localStorage.setItem` at `:23` → `router.push("/dashboard")` at `:24` → `router.refresh()` at `:25`. **Today (pre-fix)** `setToken` (`api.ts:9-11`) writes **the module variable only** — `:23` is what persists the token, which is precisely why the pair has to be collapsed into one writer in this phase. Once §B2.4 moves the write into `setToken`, **`login-form.tsx:23` must be deleted**; otherwise there are two writers of the same key and the deleted line would keep a stale value alive across a `setToken(null)`. The harness asserts this dependency explicitly (assertion **A4(a)** in §B3.1a.4: after `setToken(TOKEN)`, `store.get("ka_token") === getToken()`). A blanket `localStorage === getToken()` equality is **not** asserted anywhere — see contract C5.
2. **Navigation to `/dashboard`.** `DashboardLayout` mounts (`dashboard/layout.tsx:8-30`); its `useEffect` reads `localStorage` and, finding a token, does **nothing** (`:16`). The module var is still set **because this was a client-side push, not a document load** — Next's client router does not reload the JS bundle, so the `api.ts` module instance survives. **This is why navigation works today and reload does not.**
3. **Hard reload of any `/dashboard/*`.** The browser re-fetches the document; Next ships a **fresh JS runtime**; `api.ts` is re-evaluated and `token` is **`null`** again (`api.ts:3`). `layout.tsx:16` *does* find `ka_token` in localStorage — and **does nothing with it**. Nothing ever calls `setToken` outside the login form (`grep` for `setToken` → `api.ts:9,31,58` and `login-form.tsx:20` only [V]).
4. **First protected request after reload.** `request()` sees `token === null`, so no `Authorization` header is attached (`api.ts:15-17`). Backend `authMiddleware` rejects: no header → `401 {"error":"Missing or invalid bearer token"}` (`middleware/auth.ts:10-14`).
5. **401 handling.** `api.ts:29-33`: sets `token = null`, calls `setToken(null)` (a no-op — it was already null), and **throws** `Error("Unauthorized")`. **It does not clear `localStorage`.** So the page shows the red error, the layout still sees `ka_token`, and the next navigation/reload repeats step 3 forever. The user is **logged-out in effect but logged-in in appearance** — `header.tsx:10-23` renders the username **decoded from the stale token**, and since `atob` on a base64url payload containing `-`/`_` is patched (`header.tsx:16`) but padding is not, a malformed payload lands in the `catch` and displays `"admin"` (`:19-20`) regardless.
6. **Dead `/login` redirect.** `dashboard/layout.tsx:17` `router.replace("/login")`. **`web/src/app/login/` is an empty directory** [V] — no `page.tsx`, so Next serves **404**. The redirect target does not exist. (It is also only reached when `ka_token` is *absent*, i.e. after a proper logout — see step 7.)
7. **Logout.** `header.tsx:40-43`: `localStorage.removeItem("ka_token")`, then `router.push("/login")`. It **never** calls `setToken(null)` and **never** calls `api.logout`. So after logout: in-memory token **survives** (still attached to every request until reload) while `ka_token` is gone; the user is pushed to a **404**. On the next navigation, `layout.tsx:16` now sees no token → `router.replace("/login")` → **404 again**. The session is "over" only in the sense that the user can find no UI at all — and if they hit **Back** or type `/dashboard/retrieve` directly, step 3–5 recur with the *in-memory* token still valid: **requests keep succeeding after logout** until a reload.
8. **`api.logout` and the 404.** `api.ts:56-59` posts to `/auth/logout`. No route is registered for `/api/auth` beyond `/login` (`app.ts:51`, `routes/auth.ts:9`), `server/src` contains no `logout` string [V], so `notFound` handles it (`middleware/error.ts:3-5`) → **404** → `request()` throws `Error("Not found")` (`api.ts:34-37`). Dead code: **nothing calls `api.logout`** [V: grep]. Its `.finally(() => setToken(null))` would have been the *right* clearing point — it is simply never reached.
9. **Expiry.** After 12 h the JWT is invalid; `jwt.verify` throws and `authMiddleware` returns `401 {"error":"Invalid or expired token"}` (`middleware/auth.ts:20-22`). Backend *does* distinguish the two messages (`:12` vs `:21`), but the client collapses both into `Error("Unauthorized")` (`api.ts:32`) — so the UI cannot tell "session expired" from "never logged in".

### B1.3 The three defects, restated as one sentence each

- **Token loss on reload** — `setToken` is only ever called from the login form; the persisted copy is never read back into the client (`login-form.tsx:20,23` vs `api.ts:3`, no reader).
- **Dead `/login`** — `web/src/app/login/` is an empty directory, so both redirect sites (`layout.tsx:17`, `header.tsx:42`) land on a 404.
- **404 logout** — `api.logout` targets a route that does not exist (`api.ts:57` vs absent in `server/src`), and neither the header nor the 401 path clears both stores.

---

## B2. FIX

### B2.1 Chosen token owner: **`web/src/lib/api.ts`** (extended into `web/src/lib/token.ts`'s role, but kept in `api.ts` to avoid a new module)

**Decision: `web/src/lib/api.ts` is the single owner.** No new file. Reasons: (a) it is already the only reader of the in-memory token, so all callers already import from it; (b) every batch baseline member is a file we must justify changing — adding `web/src/lib/token.ts` would add a file *outside* the baseline (invisible to the hash check), while keeping the logic in `api.ts` keeps the change auditable by `baseline.sha256`; (c) `web/src/lib/api.ts` is already in `baseline.sha256:22` [V].

It gains one exported object, and **nothing outside this module may touch `localStorage["ka_token"]` — a claim that is FALSE today and becomes true only because this phase changes two more files (R8).**

**The code fact the review corrected (R8), stated without hedging:** `web/src/app/dashboard/header.tsx:11` today reads `localStorage.getItem("ka_token")` **at mount, inside a `useEffect`, and renders the decoded username** (`header.tsx:10-23`). Round 0's file-touch table authorised a change to the header's *logout handler* but never named `:11` as a contract violation, so the AC1 promise was unbacked. It is now backed by explicit edits to **both** call sites:

| Site | Today | After |
|---|---|---|
| `header.tsx:11` | `const t = localStorage.getItem("ka_token");` — a **second, independent** auth read at render | `const t = getToken();` — reads the owner's in-memory value; **no `useEffect` localStorage access remains** |
| `header.tsx:41` | `localStorage.removeItem("ka_token");` in the Sign-out handler | `clearSession();` then `router.replace("/login")` |
| `login-form.tsx:23` | `localStorage.setItem("ka_token", data.token);` | **DELETED** — `setToken` owns the write (§B2.4, R14) |

Because the layout still mounts `<Header />` unconditionally while only `{children}` is gated, the `:11` read is precisely the path that would render `admin` from an **expired** token during the 401 round trip. Substituting `getToken()` closes it: before `hydrateToken()` runs, `getToken()` is `null`, so no username renders — and `Header` cannot fabricate one from a stale string. This is why R12's assertion (§B3.1 step 7) is a real test and not a formality.

```ts
const STORAGE_KEY = "ka_token";
let token: string | null = null;
let hydrated = false;

/** Read the persisted token ONCE and install it. Idempotent. */
export function hydrateToken(): void {
  if (hydrated) return;
  hydrated = true;
  try { token = localStorage.getItem(STORAGE_KEY); } catch { token = null; }  // SSR / private mode
}

export function getToken(): string | null { return token; }
export function setToken(t: string | null): void {         // now also persists
  token = t;
  try { t ? localStorage.setItem(STORAGE_KEY, t) : localStorage.removeItem(STORAGE_KEY); } catch {}
}
export function isHydrated(): boolean { return hydrated; }
/** full clear used by 401 + logout */
export function clearSession(): void { setToken(null); hydrated = true; }
```

Behavioural changes inside `api.ts`:
- `request()` calls `hydrateToken()` as its **first statement** (`:13`), so *any* API call made before the layout effect still carries credentials. This is the **belt**; the layout gate (§B2.2) is the **braces**. (Without this, a page that fires `useEffect → api.search` before the layout's `useEffect` runs would race — React runs child effects before parent effects, so `library/page.tsx:22` and `audit/page.tsx:11` **would** fire before `layout.tsx:15`. This is a real, not theoretical, race.)
- On 401 (`api.ts:29-33`): `clearSession()` (which now removes `localStorage` too) and **still throws** `Error("Unauthorized")` — the pages' catch blocks (`retrieve:22`, `chat:21`, `library:44`, `audit:19`, `inbox:26,47`) keep working unchanged. **Additionally** dispatch a `window.dispatchEvent(new Event("ka:logout"))` so the shell can navigate — the *redirect* decision belongs to the layout, not the transport layer.
- `api.logout` — **deleted** (see §B2.5).

`hydrated = true` is also set by `clearSession()` — **never by `setToken()`** — so a login-then-reload sequence can never *re-hydrate a stale value over a fresh one*: hydration is a one-shot.

**N-6a — the hydration-state ownership rule (normative, supersedes any looser prose above):**
- `hydrateToken()` is the **only** operation that *performs* hydration, and it is the only place `hydrated` flips `false → true` on the normal path.
- `clearSession()` also sets `hydrated = true`, but only to **suppress** a later re-read (it never installs a value).
- **`setToken()` must not read or write `hydrated`.** It neither marks the module hydrated nor un-hydrates it. (Seam for A8: an in-memory token set by `setToken` must survive an *unconsumed* hydration, which is exactly what C3's one-shot rule plus A8's sequence below proves.)

### B2.2 The hydration gate (AC3) — how "no protected request before rehydration" is *guaranteed*, not hoped for

`web/src/app/dashboard/layout.tsx` becomes the gate:

```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hydrateToken, getToken } from "@/lib/api";
import Sidebar from "./sidebar";
import Header from "./header";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    hydrateToken();                                  // 1. install persisted token
    if (!getToken()) { router.replace("/login"); return; }   // 2. no session -> login
    setReady(true);                                  // 3. only now render children
  }, [router]);

  useEffect(() => {                                  // 4. any 401 anywhere -> login
    const onLogout = () => router.replace("/login");
    window.addEventListener("ka:logout", onLogout);
    return () => window.removeEventListener("ka:logout", onLogout);
  }, [router]);

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{ready ? children : null}</main>
      </div>
    </div>
  );
}
```

**Why this is a guarantee and not a race** — the layers, each independently sufficient, **stated honestly after R8**:

1. **`ready ? children : null`** — page components are **not mounted** until hydration and the token check have run, so `library/page.tsx`'s and `audit/page.tsx`'s mount-time `api.search` **cannot** fire early. (This is what a flagless layout cannot promise: children render on the first paint while the effect hasn't run.) **This layer is untouched by R8 and is sound.**
2. **`request()` → `hydrateToken()` first line** — even if some future page fires a request outside the gate, it is hydrated.
3. **`hydrated` one-shot flag** — hydration cannot run twice and clobber a fresh login token.
4. **`header.tsx:11` → `getToken()` (the layer round 0 was missing, R8).** `<Header />` is rendered **unconditionally** by this layout — only `{children}` is gated — so the header is a *fourth* consumer that the gate does not cover. Its old `localStorage` read ran on mount and rendered the decoded username regardless of hydration or validity; after §B2.4's edit it reads the owner's memory and renders nothing until a token exists.

**Correction of the round-0 wording (R8):** round 0 called this "three layers, each independently sufficient" and claimed, in the same section, that AC1's "nothing outside `api.ts` touches `localStorage["ka_token"]`" already held. That was **false**: `header.tsx:11` violated it. It is now a **four**-layer guarantee, and the AC1 claim is true **only because** layer 4 is an edit in the authorised diff (§7), mechanically enforced by the two-sided grep in §B3.2. The layout gate is unchanged and remains correct; the *claim* was what was wrong, and this paragraph replaces it.

Note the layout is a **client** component (`layout.tsx:1`), so `localStorage` is not available during its render — hence the `ready` state rather than a render-time read. SSR/prerender cannot touch `localStorage`; `hydrateToken`'s `try/catch` covers the `typeof window === "undefined"` case implicitly (`localStorage` is undefined → `ReferenceError` → caught → `token = null`).

The same gate must apply to the **sessionless** path (AC4): if `getToken()` is null, redirect to `/login` **and render nothing** (no flash of the dashboard shell, no sidebar that 401s in the background).

### B2.3 `/login` — decision and redirect-loop analysis (AC4)

**Decision: CREATE `web/src/app/login/page.tsx`** — a real page that renders the existing `LoginForm` component (`web/src/components/login-form.tsx`, unchanged except §B2.4) — **and leave `/` (`src/app/page.tsx`) exactly as it is.**

```tsx
// web/src/app/login/page.tsx
import LoginForm from "@/components/login-form";
export default function Page() { return <LoginForm />; }
```

Why create rather than repoint:

- **Repointing the redirect to `/`** would work with fewer lines, but `/` is the product's landing/login at the app root, and both redirect sites already say `/login`; creating the route makes the *existing* intent true rather than rewriting the intent. It also keeps `/` and `/login` semantically distinct for the (out-of-scope) future where `/` becomes a marketing/splash page.
- The empty `web/src/app/login/` directory **already exists** [V] — so the file is added where the codebase already expects it; no new directory, no routing redesign (out of scope per `REQUEST.md:59`).
- AC11 ("new pages beyond what is strictly needed" is out of scope) — this page **is** strictly needed: without it AC4 is unachievable.

**Redirect-loop analysis (exhaustive — there are only two redirect edges):**

| From | Condition | To | Can the target redirect back? |
|---|---|---|---|
| `/dashboard/*` (layout `useEffect`) | `getToken()` falsy | `/login` | **No.** `login/page.tsx` is a static page rendering `LoginForm`; it contains **no** layout gate and **no** redirect of any kind. `src/app/layout.tsx` is the root layout and has no auth logic [V: it only sets fonts/`globals.css`]. → loop impossible. |
| `/login` (after successful login, `login-form.tsx:24`) | login succeeded | `/dashboard` | **No.** At that instant `setToken(token)` has run (`:20`), so the layout's `getToken()` is truthy → it does **not** redirect back. The order is `setToken` → `localStorage.setItem` (now inside `setToken`) → `push` — the persists-then-navigates ordering is what makes this hold. |
| `/dashboard/*` (layout, `ka:logout` event) | any request got 401 → `clearSession()` then event | `/login` | **No**, same as row 1. `clearSession` sets `hydrated = true`, so no re-hydration can resurrect the token. |
| `/` → `/dashboard` | user logged in there | — | **`/` has no gate and no redirect** — it renders the form regardless of token [V: `page.tsx:3-5`]. A logged-in user visiting `/` sees the form; that is today's behaviour and **preserved** (AC8). No new redirect added from `/`. |

Loop **cannot** occur because **no route redirects *into* `/dashboard` except the login form's success path, which is guarded by a token that was just set**. This is asserted in the test (§B3.1 step 10) by counting navigations.

### B2.4 Expired / invalid token (AC5)

Three sub-cases, one mechanism:

| Case | Detection | Action |
|---|---|---|
| Token expired (12 h, `auth.ts:27`) | any protected call → `401 {"error":"Invalid or expired token"}` — note the **backend already distinguishes** this from "missing" (`middleware/auth.ts:12` vs `:21`) [V] | `api.ts` 401 branch: `clearSession()` (removes `localStorage` **and** the module var, marks `hydrated`) → `window.dispatchEvent(new Event("ka:logout"))` → layout `router.replace("/login")` |
| Token malformed / garbage in localStorage | same 401 path | same |
| Token present, **backend down** | `fetch` rejects | `request()` lets the `TypeError` propagate → page shows its red error. **No logout, no redirect** — a network blip must not destroy a valid session. (Explicitly *not* treated as 401.) |
| Token decoded but **expired, before any request** | — | **Deliberately NOT implemented.** Client-side `exp` pre-checks are a UX nicety, not a security control (the server is authoritative), and decoding `exp` would mean a second JWT parser in the client. The header already decodes the payload for the username (`header.tsx:14-18`); adding `exp` logic there invites drift. Recorded as **OQ-5**. |

### B2.4a `ka:logout` — DECISION: **implement it in `api.ts`** (closes B-2)

**N-6f — post-gate latch amendment (measured, 2026-11-02).** The latch is re-armed by `hydrateToken()` and by the new `startSession(t)`; **`setToken(null)` must not re-arm**. The round-1 formula (re-arm inside `setToken`) was self-defeating: `clearSession()` calls `setToken(null)` *before* the latch test, so a burst of concurrent 401s emitted **once per request** — measured `A6 ka:logout dispatches for a double-401: expected=1 actual=2`, both dispatches from `api.ts:52`. `login-form.tsx` calls `startSession(data.token)`. A6 and A12 both pass under this shape.

**Post-implementation findings recorded verbatim from `IMPLEMENTATION-B.md`, so the next reader does not rediscover them:**

| n | Finding | Consequence |
|---|---|---|
| **N-6f** | Latch formula above. | Closed in plan + code; A6/A12 pass. |
| **N-6g** | The AC1 grep is a **substring** test, so the plan's own suggested comment ("No localStorage here (AC1)") **fails its own grep** — first run reported `A11 … expected=0 actual=2`. | Recorded in A11; the word was removed from the `header.tsx`/`login-form.tsx` comments. |
| **N-6h** | **A8 cannot pass under the implemented code.** `hydrateToken()`'s body is `try { token = localStorage.getItem(KEY) }` and it runs on the *first* call — so a `setToken("fresh-value")` performed *before* hydration is **overwritten** by storage. Only `clearSession()`-then-hydrate survives (it sets `hydrated = true`). The harness's green run does **not** prove A8's claim. | **OPEN.** Two resolutions: (i) reword A8 to the reachable invariant (hydration must not resurrect after a clear — already A9) and record "no anti-clobber guarantee for a pre-hydration `setToken`" as a documented limitation; or (ii) strengthen `hydrateToken()` to `if (token === null) token = localStorage.getItem(KEY)` — safe, because a non-null in-memory token is always fresher than storage — then A8 passes. Requires a one-line plan amendment + re-implementation + re-test. Until then Part B carries an **open, unproven claim**. |

**Decision, stated once:** `ka:logout` **is implemented**. It is a `window` event of type `"ka:logout"`, dispatched **only** from the `401` branch of `request()` in `web/src/lib/api.ts`, at most **once per 401 burst**, and listened to **only** by `web/src/app/dashboard/layout.tsx`. The alternative — *delete* the event and drop harness `A5`/`A6` — was rejected because a `401` currently leaves the user on the page with a red error and no navigation: `retrieve/page.tsx:22-23` catches and renders `e.message`, so the *only* mechanism that gets an expired-token user back to `/login` is a signal from the transport layer to the shell. Without the event, AC3/AC5's "expired token → `/login`" is satisfied **only on reload**, not during a live session. `api.logout` and `POST /api/auth/logout` remain **deleted / not added** (§B2.5) — this is an *event*, not an endpoint.

**Why a latch is required:** a page can have two protected calls in flight (`inbox/page.tsx` has several). Both get `401`, both reach the 401 branch, and without a latch the layout's listener runs twice → two `router.replace("/login")`. `A6` exists to catch exactly this; it can only pass if `api.ts` suppresses the second dispatch. The latch is therefore **part of the design, not the test**.

**Exact code — `web/src/lib/api.ts`, the complete 401 branch and its module-level latch (replaces `:29-33`):**

```ts
// module scope, immediately after `let hydrated = false;`  (inserted at :4, above)
let logoutSignalled = false;

// inside request(), replacing the old :29-33 block:
  if (res.status === 401) {
    clearSession();                              // clears BOTH stores + marks hydrated (AC6)
    if (!logoutSignalled) {
      logoutSignalled = true;                    // latch: at most one event per burst
      window.dispatchEvent(new Event("ka:logout"));
    }
    throw new Error("Unauthorized");             // unchanged: pages' catch blocks still work
  }
```

**N-6f — the latch must NOT be re-armed by `setToken` (post-implementation correction).** The round-1 shape above (`logoutSignalled = false` inside `setToken`) is **self-defeating**: `clearSession()` is `setToken(null)`, and the 401 branch calls `clearSession()` *before* testing the latch — so every 401 re-arms and then fires, giving **one event per in-flight request**, not one per burst. That was measured on the literal round-1 code: `A6 ka:logout dispatches for a double-401: expected=1 actual=2`, both dispatches from `api.ts:52`. The normative shape is therefore:

```ts
export function startSession(t: string): void {   // NEW: a new session legitimately begins
  logoutSignalled = false;
  setToken(t);
}

export function setToken(t: string | null): void {
  token = t;
  if (t !== null) logoutSignalled = false;         // re-arm ONLY on a fresh session token
  try { t ? localStorage.setItem(STORAGE_KEY, t) : localStorage.removeItem(STORAGE_KEY); } catch {}
}

export function hydrateToken(): void {
  if (hydrated) return;
  hydrated = true;
  logoutSignalled = false;                         // a fresh page load re-arms the event
  try { token = localStorage.getItem(STORAGE_KEY); } catch { token = null; }
}
```

`login-form.tsx` **must** call `startSession(data.token)` instead of `setToken(data.token)`; every other `setToken` caller (`clearSession`) keeps the existing semantics. `A6` (one event per double-401) and `A12` (re-arm after a successful new session) both pass under this shape.

**Per-file / per-line consequences (this is the enumeration the gate asked for — nothing here is left to the implementer):**

| File | Line | Change | Authorised by |
|---|---|---|---|
| `web/src/lib/api.ts` | new `:4` | `let logoutSignalled = false;` — module scope, one per module instance | §7.1 row **B** (already a modified file) |
| `web/src/lib/api.ts` | `:29-33` → replacement | 401 branch: `clearSession()` + latched `window.dispatchEvent(new Event("ka:logout"))` + **unchanged** `throw new Error("Unauthorized")` | §7.1 row **B** |
| `web/src/lib/api.ts` | `:9-11` (`setToken`) | gains the **conditional** re-arm `if (t !== null) logoutSignalled = false;` and the persist line (§B2.1, code block at §B2.1 + §B2.4a) | §7.1 row **B** |
| `web/src/lib/api.ts` | new export | **`startSession(t)`** = `logoutSignalled = false; setToken(t)` — called by the login form for the "new session" moment (N-6f) | §7.1 row **B** |
| `web/src/lib/api.ts` | `:5-7`-region (`hydrateToken`) | gains `logoutSignalled = false;` | §7.1 row **B** |
| `web/src/app/dashboard/layout.tsx` | listener block | `window.addEventListener("ka:logout", onLogout)` in the `useEffect`, cleanup returns `() => window.removeEventListener("ka:logout", onLogout)`; handler body = `router.replace("/login")` | §7.1 row **A** |
| `web/src/app/dashboard/header.tsx` | `:40-43` | **no change** from §B2.4 — `clearSession()` + `router.replace("/login")`; the header does **not** dispatch `ka:logout` (logout is user-initiated, already navigating; dispatching would double-navigate) | §7.1 |
| `web/scripts/f2b-hydration.mjs` | shim + `A5`/`A6` | real listener registry (§B3.1a) so the dispatch is observable | new file |

**`window` guard (must not break SSR):** `layout.tsx` is `"use client"` and the listener is registered inside `useEffect` (client-only, post-mount), so no `typeof window` guard is needed there. In `api.ts`, `request()` only runs in the browser — but `hydrateToken()`'s existing `try/catch` already covers absent `localStorage`; the dispatch is inside `request()`, which is never called during SSR. **No `typeof window` check is added**, and the harness provides `window` on `globalThis` before importing `api.ts` (§B3.1a), so the same code path is exercised.

**Negative consequence, stated so it is not a surprise:** if the layout's listener is not mounted (e.g. a call made from `/`, which has no dashboard layout), the event is dispatched with no listener — a silent no-op, which is correct: there is nobody to navigate. `A6` asserts the same behaviour in-process.


**`Header` — the exact edit (R8). Both `localStorage` call sites are removed; the file has no other `localStorage` access afterwards.**

Before (`web/src/app/dashboard/header.tsx:10-23` and `:38-46`, [V] read this session):

```tsx
  useEffect(() => {                                   // :10
    const t = localStorage.getItem("ka_token");       // :11  <-- REMOVE (second auth read)
    ...decode / setUser...
  }, []);                                             // :23
  ...
        <button onClick={() => {                      // :40
            localStorage.removeItem("ka_token");      // :41  <-- REMOVE
            router.push("/login");                    // :42
          }}>Sign out</button>
```

After (complete replacement for those two regions — this is the final code):

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearSession, getToken } from "@/lib/api";

export default function Header() {
  const router = useRouter();
  const [user, setUser] = useState<{ username: string } | null>(null);

  useEffect(() => {
    // Read the token through the single owner. No localStorage here (AC1).
    const t = getToken();
    if (!t) { setUser(null); return; }
    try {
      const payload = t.split(".")[1];
      const decoded = JSON.parse(
        atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
      );
      setUser({ username: String(decoded.username || "admin") });
    } catch {
      setUser({ username: "admin" });
    }
  }, []);

  return (
    <header className="flex h-14 items-center justify-between border border-border px-4 bg-surface">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-semibold tracking-tight">
          Knowledge Assistant
        </h1>
      </div>
      <div className="flex items-center gap-3">
        {user && (
          <span className="text-xs font-mono text-muted-foreground">
            {user.username}
          </span>
        )}
        <button
          className="rounded border border-input px-3 py-1.5 text-xs font-semibold hover:bg-muted"
          onClick={() => {
            clearSession();            // clears BOTH stores (AC6)
            router.replace("/login");  // replace, not push (see §B2.5)
          }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
```

**Why `getToken()` in an effect and not a render-time read:** the layout gates only `{children}`; `<Header />` mounts immediately. With `getToken()`, the header shows **nothing** until a token exists in memory — so on a hard reload with an **expired** token there is no window in which a username is rendered before the redirect (this is exactly R12's assertion). The decode/`atob`/`admin`-fallback logic (`:14-20`) is preserved unchanged; only its **source** changes from `localStorage` to the owner.

**`login-form.tsx` — the exact edit (R14, amended by N-6f).** Delete line `:23` **and** its two-line comment (`:21-22`), because `setToken`/`startSession` now own the write. The call becomes `startSession(data.token)` (N-6f: a login is the "new session" moment that legitimately re-arms the `ka:logout` latch):

```tsx
// login-form.tsx:19-25  BEFORE
      const data = await api.auth.login({ username, password });
      setToken(data.token);
      // Persist token so the dashboard layout can verify the session across
      // page navigation (and browser reloads).
      localStorage.setItem("ka_token", data.token);
      router.push("/dashboard");
      router.refresh();

// AFTER  (line :23 deleted; setToken → startSession per N-6f)
      const data = await api.auth.login({ username, password });
      startSession(data.token);        // persists + re-arms the ka:logout latch (§B2.1 + §B2.4a, N-6f)
      router.push("/dashboard");
      router.refresh();
```

The import at `login-form.tsx:5` becomes `import { api, startSession } from "@/lib/api";` (N-6f) — the direct `localStorage` call is gone and the re-arm happens on the real "new session" moment. After this edit the file contains **no** `localStorage` reference, which is what the AC1 grep asserts. **Note (N-6g):** the AC1 grep is a **substring** match, so comments inside `web/src` must not contain the word `localStorage` either; the implementer removed such comments from `header.tsx` and `login-form.tsx` for this reason.

### B2.5 Logout (AC6, AC7) — decision

**Decision: (a) delete `api.logout` entirely; (b) implement logout as `clearSession()` + `router.replace("/login")` in the header; (c) `POST /api/auth/logout` is NOT added to the backend.**

```tsx
// header.tsx — button onClick
onClick={() => { clearSession(); router.replace("/login"); }}
```

Justification (AC7 requires one):

1. **The JWT is stateless.** Nothing server-side holds the token (`authMiddleware` verifies the signature only, `middleware/auth.ts:17`), so a "logout" endpoint can do nothing but return `204`. **A no-op endpoint is a lie in the API surface** — a future reader would reasonably believe the token was revoked.
2. AC7 allows either option ("either implemented … or the client stops calling it") [G: `REQUEST.md:53`]. Stopping the call is the honest one and requires **no backend change** → `server/src` is untouched by F2-B entirely.
3. Revocation would require a blacklist/`jti` store — **explicitly out of scope** [G: `REQUEST.md:45,60`]. Adding a fake endpoint now would freeze a bad shape into the contract.
4. `clearSession()` removes **both** stores, so AC6's "a reload after logout does not restore the session" holds by construction: `localStorage` is empty → `hydrateToken()` installs `null` → layout redirects to `/login` (which exists now). The **in-memory** token is null too, so Back/typed-URL cannot replay a request — closing defect B1.2(7).

`router.replace` (not `push`) so the browser Back button cannot return to the authenticated page and re-render it from cache.

### B2.6 localStorage vs HttpOnly cookie — the documented trade-off (AC10)

**Decision: keep `localStorage`, do not change it.** This is a documented *choice*, not an oversight.

| | `localStorage` + `Authorization: Bearer` (chosen, current) | `HttpOnly; Secure; SameSite` cookie (rejected for this phase) |
|---|---|---|
| **XSS exposure** | **Token readable by any script on the origin** — one XSS (a dependency, an `innerHTML`, a malicious upload rendered as HTML) exfiltrates a 12 h admin token. This is the **real** weakness and is accepted *for this local, single-user, offline-first tool*. | Token unreadable by JS; XSS can still *act* through the browser (CSRF-style), so XSS is mitigated, not eliminated. |
| **CSRF** | **Not applicable** — a custom header cannot be set cross-origin without CORS preflight, and the CORS allowlist is `http://localhost:3000`/`127.0.0.1:3000` only (`app.ts:19-24`). Effectively CSRF-immune. | Requires `SameSite=Lax/Strict` **and** the backend to accept credentials; `SameSite=None` (needed for cross-site) would reopen CSRF. |
| **Cross-origin (`:3000` app vs `:4000` API)** | Works today: `Authorization` is an allowed header (`app.ts:23`), origin echoed (`:21`). | Requires `Access-Control-Allow-Credentials: true`, an **exact** origin echo (**never** `*`, `app.ts:21` is already exact), cookie `SameSite=None; Secure` — and **`Secure` cookies over plain HTTP `localhost` are a browser-dependent special case**. This is a real backend + CORS change = **out of scope** [G: `REQUEST.md:56`]. |
| **Survives reload** | Yes, once hydrated (this phase's fix). | Yes, natively — the *only* structural advantage. |
| **Logout** | Client-side only (no revocation either way). | `Set-Cookie` expiry — server-assisted, but still no revocation. |
| **Server work needed** | **None.** | New cookie parsing, login must `Set-Cookie` instead of returning a token, CORS credentials, CSRF strategy. |

The deciding factor is **scope**: the cookie migration is a backend + CORS change explicitly listed as out of scope, while the XSS surface is unchanged by *this* phase (it exists identically today). Recorded as follow-up **FU-3** with the note that it must move **both** ends at once.

---

## B3. TEST STRATEGY — F2-B

### B3.1 Browser-level (app `:3000`, backend `:4000`)

Preconditions: backend up on `:4000` (against **`p2test`** per §A3.4, or `public` if Part A is tested separately — either is fine for auth, it only needs `/api/auth/login`), `cd web && npx next dev` on `:3000`, a clean browser profile.

Preconditions (both must hold before step 1):
- **R17 binary gate:** the backend MUST be started with `npx tsx src/index.ts`. `npm start` runs the stale, un-baselined `dist/index.js` and would silently exercise pre-fix code. Evidence the live code is the fixed code = T-A1 returning 0 for `zzzznotfound` on the seeded fixture. **No `dist` rebuild in this phase.**
- **R18 credential preflight:** `POST /api/auth/login` with `admin`/`admin123` must return **200** + a token (§A3.4 P-1). On **401** the phase is **`BLOCKED: demo credentials rejected; ADMIN_PASSWORD may be overridden in server/.env`** and **no alternative password is attempted**.
- **R16:** if the backend runs against `p2test`, `p2test.admins` will be created (1 row) — expected, recorded in §A3.5 before the drop.

| # | Step | Assertion |
|---|---|---|
| 1 | Open `http://localhost:3000/` | login form visible; **DevTools → Application → Local Storage → `ka_token` absent**; Network shows no request to `:4000` yet (no 401s). |
| 2 | Type the demo credentials (`admin` / `admin123`), click **Sign in** | `POST /api/auth/login` → **200**; `ka_token` now **present**; URL becomes `/dashboard`. **This is AC8's explicit assertion** (same creds, lands on `/dashboard`). |
| 3 | In Dashboard, click **Retrieve**, search `escalation` | `POST /api/search` → **200** with `Authorization: Bearer …`; results render; **no red error**. |
| 4 | **Hard reload (Ctrl+F5)** on `/dashboard/retrieve` | **every** request to `:4000` on reload carries `Authorization` (Network: filter `:4000`, "Preserve log", assert **every** entry has the header); **no `401` anywhere**; page renders. **AC2 — the primary regression assertion of the phase.** |
| 5 | Hard reload on `/dashboard/library` and `/dashboard/audit` | requests carry `Authorization` → they return **400 `q (query string) is required`** (unchanged behaviour, §A3.3 T-A8). **Crucially: no 401.** The page text `q (query string) is required` is the **positive** signal that the token was rehydrated before the first call; `Unauthorized` is the **negative** signal. This step is the **one human DOM-level confirmation** retained (R9); it is **not** the sole evidence for AC2/AC3 — §B3.1a proves those without a browser. |
| 6 | Navigate Sidebar → Chat → Audit → Inbox (no reload) | every API request has `Authorization`; no 401. **AC9** (existing navigation unaffected). |
| 7 | **Expire the token** (§B3.3), then hard-reload a dashboard page | `401` observed; `ka_token` **removed**; URL becomes `/login`; the login form renders (**not a 404**); console clean apart from the handled `Error("Unauthorized")`. **R12 — PINNED SUB-ASSERTION (MANUAL, not automatic): the header username is never rendered; the redirect happens before any username appears.** Because `<Header />` mounts outside the `ready` gate, this is the only check that can prove the R8 edit (`header.tsx:11` → `getToken()`) actually closes the expired-token flash. No renderer is available (no Playwright/jsdom in `web/package.json`), so this is **labelled MANUAL** and must not be reported as automated. |
| 8 | On `/login`, **reload** | stays on `/login`, no redirect storm; form usable; log in again → `/dashboard`. |
| 9 | Click **Sign out** | URL → `/login`; `ka_token` **removed**; **hard reload** on `/login` → still `/login`; then navigate **directly** to `http://localhost:3000/dashboard/retrieve` | redirected to `/login`, and **no** protected request succeeds — **a valid in-memory token must not survive logout**. |
| 10 | **Redirect-loop check.** Clean profile, open `/dashboard` directly; open `/login` directly while logged in; Back after logout | Exactly **one** redirect each time; `/dashboard` unauthenticated → **one** `replace('/login')`, no oscillation; `/login` while authenticated does **not** bounce to `/dashboard` (**AC8**: no new redirect). |
| 11 | Back button after successful login (`/dashboard` → Back) | lands on `/`, the login form — **not** an error, **not** a loop. Logged-in state unaffected. |

Automation note: steps 4, 9 and 10 are the ones a human is most likely to pass by accident (cache, autofill). They must be done in a **fresh incognito profile** with the Network panel **filtered to `:4000`** and "Preserve log" on. **Steps 4, 5, 7, 9 and 10 additionally have executable XHR-equivalent counterparts in §B3.1a; step 7's username sub-assertion is the only genuinely manual one.**

### B3.1a Executable harness — `web/scripts/f2b-hydration.mjs` (R9, R10, R11, R12, R14; gate B-1/B-3/B-4; N-5a/N-5b/N-5d)

**Why this file exists:** §B3.2's API checks never exercise `hydrateToken`, `clearSession`, the layout gate or the `ka:logout` event, so a broken Part B fix could pass every automated check the round-0 plan had. This harness is the executable evidence for AC1/AC2/AC3/AC4/AC6.

**Constraints honoured:** **no new dependency.** `web/package.json` has no Playwright/Puppeteer/jsdom, and `REQUEST.md:60` forbids adding deps. The harness uses Node built-ins only (`fetch`, `node:fs`, `node:path`) plus a `localStorage` and a `window` shim on `globalThis`.

#### B3.1a.1 Run contract — file, language, exact command, loader (closes **B-4**, N-5a)

| Item | **Final value — do not substitute** |
|---|---|
| **File** | `web/scripts/f2b-hydration.mjs` — **new file**, not in `baseline.sha256` (hash appended per §7.2) |
| **Language** | **JavaScript, ESM** (`.mjs`) — the harness file itself needs no transpile. Plain `node` cannot import the **TypeScript** module under test, so the harness is launched with the already-installed `tsx` ESM loader: `node --import ./server/node_modules/tsx/dist/loader.mjs web/scripts/f2b-hydration.mjs` **from the repo root** (Rb-4, line 54). There is **no build step and no new dependency** (`tsx` ships in `server/node_modules`; `web/` has none). |
| **Module under test** | the **source** file `web/src/lib/api.ts`, imported through a TypeScript loader (below). The harness **never** reads `web/.next/**` and **never** runs `next build`, so a stale build cannot make it pass (N-5a). |
| **TS loader** | **`tsx`**, already a `devDependency` of `server/` (`server/package.json:35`, `"tsx": "^4.16.0"`; the binary is already installed at `server/node_modules/.bin/tsx`). **No install, no new dependency, nothing added to `web/package.json`** (REQUEST forbids new deps). |
| **Exact run command** | from the **repo root** `D:\Develop\knowledge-app`: |

```bash
cd /d/Develop/knowledge-app
node --import ./server/node_modules/tsx/dist/loader.mjs web/scripts/f2b-hydration.mjs; echo "exit=$?"
```

**Withdrawn as wrong in round 1 (recorded so they are not retried):**
- ~~`cd web && node scripts/f2b-hydration.mjs`~~ — plain Node cannot load `api.ts`; it throws `ERR_UNKNOWN_FILE_EXTENSION`.
- ~~`npx tsx scripts/f2b-hydration.mjs`~~ — `tsx` is **not** a dependency of `web/` (`web/package.json` [V] this session: deps are react/react-dom/next; devDeps are typescript, `@types/*`, postcss, tailwindcss, eslint*). `npx` would therefore attempt a **network download** — a new dependency by another name, which the REQUEST forbids.

**Exit codes:** `0` = PASS (every assertion passed) · `1` = FAIL (≥1 assertion failed) · `2` = BLOCKED (a precondition was unmet; no assertion was judged).

**Fallback level — stated once, must appear verbatim in TEST-REPORT:** *"The F2-B harness is **XHR-equivalent**: a real HTTP client (`fetch`) against the **real backend** on `:4000`, with the **real `api.ts` module** loaded, and **fake `localStorage`/`window`**. It is **not** a browser test; it does not render React, does not exercise `next/navigation`, and cannot see the DOM. The only DOM-level checks are the manual §B3.1 steps 1–11."*

**Preconditions (checked before A1; any failure → exit 2 with the exact message shown):**

| # | Precondition | How it is checked | On failure (exact message, exit 2) |
|---|---|---|---|
| P1 | Backend is up | `POST /api/auth/login` with `admin`/`admin123` | `BLOCKED: login returned <status>; backend not ready` |
| P2 | Demo credentials accepted (R18) | response status is not `401` | `BLOCKED: demo credentials rejected; ADMIN_PASSWORD may be overridden in server/.env` |
| P3 | A token was issued | `body.token` is a non-empty string | `BLOCKED: login returned no token` |
| P4 | Shims installed before first `import()` | asserted internally | (a throw here is a harness bug → exit 1) |

**Honesty:** the harness prints the token **length only** — never the token, never the password, never a secret.

#### B3.1a.2 The shims — real registry, real storage (closes **B-1**)

Both shims are installed on `globalThis` **before** the first `import()` of `api.ts`. The `window` shim is a **working event target**, not a recording stub: round 1's `addEventListener: () => {}` was a no-op, so `A5`'s `navigated` could never be non-zero and the assertion was vacuous (`REVIEW.md:397`).

```js
// web/scripts/f2b-hydration.mjs — shims, installed BEFORE any import of api.ts
const STORAGE_KEY = "ka_token";
const API = "http://127.0.0.1:4000/api";
let failures = 0;
const ok  = (m) => console.log(`PASS  ${m}`);
const bad = (m) => { failures++; console.log(`FAIL  ${m}`); };
const blocked = (m) => { console.log(`BLOCKED  ${m}`); process.exit(2); };

// ---- localStorage shim: a real Map-backed store ----
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};

// ---- window shim: REAL listener registry (B-1 fix) ----
const registry = new Map();               // type -> Set<listener>
const dispatchedTypes = [];               // every dispatchEvent type, in order
globalThis.window = {
  addEventListener(type, listener /*, options */) {
    if (typeof listener !== "function" && typeof listener?.handleEvent !== "function") return;
    if (!registry.has(type)) registry.set(type, new Set());
    registry.get(type).add(listener);              // identity semantics, like the DOM
  },
  removeEventListener(type, listener) {
    registry.get(type)?.delete(listener);          // deregister by identity
  },
  dispatchEvent(event) {
    dispatchedTypes.push(event.type);
    for (const l of Array.from(registry.get(event.type) ?? [])) {
      if (typeof l === "function") l.call(globalThis.window, event);
      else l.handleEvent(event);
    }
    return !event.defaultPrevented;
  },
};
```

`Node`'s global `Event` is used as-is (present since Node 19; toolchain here is Node 24 [V]) — **no `Event` polyfill and no `?bust`-affecting globals are added**. `S1` (below) is a **shim self-test** run before `A1`: a regression back to a no-op shim makes the harness fail **loudly at the top** instead of silently passing `A5`.

#### B3.1a.3 The writer contract — stated once (closes **B-3**)

Round 1 contained two assertions that could not both hold: `A4` claimed `localStorage.getItem("ka_token") === getToken()` **unconditionally**, while `A7` legitimately left memory and storage **different** (memory `"stale-value"`, storage `"newer-value"`). One contract now governs every assertion:

| # | Contract clause | Consequence for assertions |
|---|---|---|
| **C1** | `setToken(t)` is the **sole writer** of the key and **always** persists: `t !== null` → `setItem(key, t)`; `t === null` → `removeItem(key)`. Idempotent. | `A4` asserts the **non-null** and the **null** case **separately**; nothing claims equality across a `clearSession()`. |
| **C2** | `getToken()` returns in-memory state and **never** reads storage. | `A1` is meaningful: a fresh module has memory `null` while storage holds a token. |
| **C3** | `hydrateToken()` is the **sole reader**, and is **one-shot** (`hydrated` flag); after the first call it never re-reads storage. | `A7` (second call ignored) and `A8` (no clobber of a fresh `setToken`) both **derive from C3**. |
| **C4** | `clearSession()` = `setToken(null)` **plus** `hydrated = true`, so no later `hydrateToken()` can resurrect the key. | `A9`, `A10` follow from C1+C3+C4. |
| **C5** | Storage and memory are **equal only** immediately after `setToken(x ≠ null)`; they are **both empty** only after `setToken(null)`/`clearSession()`. **No assertion asserts equality at any other moment.** | Removes the A4/A7 contradiction. |

Because the shim is a real `Map`, "the key is absent" is asserted as `store.has(STORAGE_KEY) === false` — strictly stronger than `getItem(...) === null`, which a `setItem(key, "null")` bug would wrongly satisfy.

#### B3.1a.4 Assertion specifications — precondition · operation · exact expected value

Every assertion is stated as **(P) precondition → (O) exact operation → (E) exact expected value**. `freshApi()` = `await import(new URL("../src/lib/api.ts", import.meta.url).href + "?bust=" + n)` with an incrementing `n`; it yields a **new module instance** (`token === null`, `hydrated === false`, `logoutSignalled === false`) and is the harness's model of a page reload.

```js
// ---- helpers (part of the spec) ----
let bust = 0;
async function freshApi() {
  const url = new URL("../src/lib/api.ts", import.meta.url);
  return await import(url.href + `?bust=${++bust}`);
}
async function login() {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  if (r.status === 401) blocked("demo credentials rejected; ADMIN_PASSWORD may be overridden in server/.env");
  if (r.status !== 200) blocked(`login returned ${r.status}; backend not ready`);
  const j = await r.json();
  if (!j.token) blocked("login returned no token");
  return j.token;
}

// ---- preconditions ----
const TOKEN = await login();
console.log(`token acquired: ${TOKEN.length} chars`);   // length only
```

| Asrt | (P) Precondition | (O) Exact operation | (E) Exact expected value |
|---|---|---|---|
| **S1** | shims installed; no module imported yet | register a `selftest` listener, dispatch `new Event("ka:selftest")`, `removeEventListener` it, dispatch again | the counter is **`1` after the second dispatch** (i.e. exactly 1 total). If `0` ⇒ no-op shim ⇒ **FAIL** |
| **A1** | `store` **pre-loaded** with `TOKEN`; nothing imported yet | `api = await freshApi()` → `api.getToken()` | **`null`** — memory empty although storage is populated (this *is* the reload condition; C2) |
| **A2** | A1's module instance | `api.hydrateToken()` → `api.getToken()` | **strictly equal** to `store.get(STORAGE_KEY)` (`=== TOKEN`) |
| **A3** | A2 hydrated | `await api.api.search({ q: "zzzznotfound", limit: 10 })` | **resolves** (does not throw), `Array.isArray(res.results) === true`, and `res.results.length === 0` for `zzzznotfound` on the seeded fixture. Throwing `Error("Unauthorized")` ⇒ **AC2 FAILED**; do not adjust the harness |
| **A4** | fresh module; `store` empty | (a) `api.setToken(TOKEN)` on a fresh module; (b) `api = await freshApi()` then `api.setToken(null)` | (a) `store.get(STORAGE_KEY) === TOKEN` **and** `api.getToken() === TOKEN` **and** `store.has(STORAGE_KEY) === true`; (b) **`store.has(STORAGE_KEY) === false`** **and** `api.getToken() === null`. **No equality claim is made outside these two moments** (C1/C5) |
| **A5** | fresh module; **valid** token in memory via `setToken(TOKEN)` | define `const navigated = () => { count++ }`; `addEventListener("ka:logout", navigated)`; `dispatchEvent(new Event("ka:logout"))`; `removeEventListener("ka:logout", navigated)`; `dispatchEvent(new Event("ka:logout"))` **again** | after the 1st dispatch `count === 1`; after removal + 2nd dispatch **still `count === 1`**. Both must hold — proves delivery **and** identity-correct removal (B-1) |
| **A6** | fresh module; `setToken("garbage.token.value")`; `dispatchedTypes.length = 0` | `const rs = await Promise.allSettled([api.api.search({q:"a",limit:10}), api.api.search({q:"b",limit:10})])` | `dispatchedTypes.filter(t => t === "ka:logout").length === 1` **and** both `rs[i].status === "rejected"` with `rs[i].reason.message === "Unauthorized"`. Two events ⇒ the latch (§B2.4a) is missing ⇒ **FAIL** |
| **A7** | fresh module; `store.set(STORAGE_KEY, "stale-value")` | `api.hydrateToken()`; `store.set(STORAGE_KEY, "newer-value")`; `api.hydrateToken()` again | `api.getToken() === "stale-value"` **and** `store.get(STORAGE_KEY) === "newer-value"`. **The divergence is deliberate and required** — permitted by C3/C5 (hydration is one-shot; storage is ahead of memory) |
| **A8** | **fresh module (P1: `hydrated === false`, nothing hydrated yet)**; `store.set(STORAGE_KEY, "stale-value")` (P2) | **exact sequence:** (1) `api.setToken("fresh-value")` — in-memory set **before any hydrate call**, and per the N-6a rule this must **not** touch `hydrated`; (2) assert `isHydrated() === false` (guards against `setToken` silently marking hydrated, which would make the rest vacuous); (3) `api.hydrateToken()` — this is the **first and only** hydration of this module instance, so the storage read **does** execute; (4) `api.getToken()` | `api.getToken() === "fresh-value"` — the hydrate path ran and did **not** clobber a fresher in-memory session (C3). **Falsification:** a `hydrateToken()` that overwrites memory whenever storage is non-empty yields `"stale-value"` ⇒ **FAIL**; and if step (2) reports `true`, the assertion **BLOCKs**, because the sequence no longer exercises hydration at all. **(N-6h, measured 2026-11-02):** under the implemented §B2.1 code, step (3) *does* re-read `"stale-value"` while `token` is `"fresh-value"` — so **A8 fails as written**. Test Engineer must treat A8 as an **open gap** (see §0c N-6h), not as a pass, until the plan is amended |
| **A9** | fresh module; `store` holds `TOKEN` | `api.hydrateToken()`; `api.clearSession()`; record; `api.hydrateToken()` again; record again | after clear: `getToken() === null` **and** `store.has(STORAGE_KEY) === false`; after the retry: `getToken() === null` **and** `store.has(STORAGE_KEY) === false` (no resurrection; C4) |
| **A10** | fresh module; `store` holds `TOKEN`; **no** hydration | `api.clearSession()` | `api.getToken() === null` **and** `store.has(STORAGE_KEY) === false` — clearing works even for a never-hydrated session |
| **A11** | repo root reachable from the harness | walk `web/src` with `node:fs` (`readdirSync(dir, { recursive: true })`), skipping the directory names `node_modules`, `.next`, `dist`; collect `.ts`/`.tsx` files whose text matches `/localStorage\|sessionStorage/`; **scan scope = all of `web/src`, EXCLUDING exactly one file: `web/src/lib/api.ts`** (the authorised owner — the only legal writer/reader of `ka_token`) | **exactly `0`** offender files (`offenders.length === 0`, where `offenders` = matching files minus the exclusion). **Falsification:** re-introducing `localStorage` in `header.tsx`, `layout.tsx` or `login-form.tsx` makes `offenders.length` 1 ⇒ **FAIL**; the harness prints `offenders` by path so a failure names the file. This replaces round 1's hard-coded `ok("see §B3.2")`, which asserted nothing (N-5d). Independent cross-check: §B3.2's two-sided grep, run by hand |
| **A12** | fresh module; `setToken("garbage.token.value")`; two 401s consumed exactly as in A6 | record `before = dispatchedTypes.filter(t => t === "ka:logout").length`; then `api.setToken(TOKEN)`; `api.api.search({ q: "zzzznotfound", limit: 10 })` | the call **resolves** (no 401 — the re-armed token is sent) **and** `dispatchedTypes.filter(t => t === "ka:logout").length === before` (no new event). Proves `setToken` **re-arms** the latch (§B2.4a): a latch that never resets would permanently suppress a later real logout |
| **A13** | `store` **empty**; fresh module | `api.hydrateToken()` → `api.getToken()` | **`null`**, and **no throw** — a first visit with no persisted token must not error |

**Assertion count: 13 (`S1`, `A1`…`A13`).** Round 1 advertised "11 assertions"; `A11` was vacuous and `A12`/`A13` did not exist, so the count changed deliberately. A TEST-REPORT citing a different count is reporting a different harness.

```js
console.log(failures === 0 ? "\nRESULT: PASS" : `\nRESULT: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
```

#### B3.1a.5 Assertion → AC map (regenerated from the final set)

| Asrt | What it proves | AC |
|---|---|---|
| **S1** | The `window` shim is a real event target (meta-assertion guarding A5/A6) | — (harness integrity) |
| **A1** | A fresh module equals a page reload: in-memory token is `null` while storage holds one | AC2 (precondition) |
| **A2** | `hydrateToken()` installs the persisted token | AC2 |
| **A3** | After hydration a protected call **succeeds** — executable twin of §B3.1 step 4 | AC2 |
| **A4** | `setToken` is the **sole writer** and persists **and** removes | AC1, AC6 |
| **A5** | `ka:logout` is delivered to a registered listener with a valid token present; removal works | AC3, AC6 |
| **A6** | A double-401 produces **exactly one** `ka:logout`, both calls still reject `Unauthorized` | AC3, AC6 |
| **A7** | Second `hydrateToken()` is a no-op (one-shot) | AC3 |
| **A8** | `hydrateToken()` after `setToken(x)` does not overwrite `x` | AC3 |
| **A9** | `clearSession()` cannot be resurrected by a later hydrate | AC5, AC6 |
| **A10** | `clearSession()` on a never-hydrated module clears both stores | AC6 |
| **A11** | No `localStorage`/`sessionStorage` reference outside the owner | AC1 |
| **A12** | `setToken` re-arms the logout latch (no permanently-suppressed logout) | AC3, AC6 |
| **A13** | First visit with empty storage hydrates to `null` without throwing | AC2 |

#### B3.1a.6 Implementation notes that are part of the spec, not left to the implementer

- Both shims **must be installed before** the first `import()` of `api.ts`; `?bust=` is how a reload is simulated.
- `api.ts` must **not** be imported at module top level; every use goes through `freshApi()`.
- A3 throwing `Unauthorized` is **AC2 failing** — never "fix" the harness.
- The harness prints the token **length only**.
- `A5`/`A6`/`A12` exercise the **event contract**, not React's router: they prove `api.ts` dispatches and that a listener receives it. That `layout.tsx`'s handler then calls `router.replace("/login")` is **not** proven here — it is **manual** (§B3.1 step 7). TEST-REPORT must state this limitation.
- An `Event` polyfill is **not** needed: `Event` is a Node global from v19 and the toolchain is Node 24 [V]. If it were absent the shim would throw at `new Event(...)` and every dispatch assertion would fail loudly — it would not pass falsely.
- The harness must be run **after** §B2.1/§B2.4/§B2.4a are implemented. `hydrateToken`, `clearSession`, `isHydrated` and the latch do **not** exist in the baseline `api.ts` (`web/src/lib/api.ts` currently exports only `getToken`, `setToken`, `api` [V]), so `A2`–`A13` are **guaranteed to fail on the unmodified tree** — that is what makes them non-vacuous.
- `A11` uses `fs.readdirSync(dir, { recursive: true })` (Node ≥ 18.17 [V: 24.22.1]) and skips `node_modules`, `.next`, `dist`.

### B3.2 API-level checks (no browser)

```bash
# 1. login returns a usable token (never printed)
TOK=$(curl -sS -X POST http://127.0.0.1:4000/api/auth/login -H 'Content-Type: application/json' \
      -d '{"username":"admin","password":"admin123"}' | jq -r '.token'); echo "len=${#TOK}"
# 2. bad password -> 401, and no token in the body
curl -sS -o /tmp/b.json -w '%{http_code}\n' -X POST http://127.0.0.1:4000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"wrong"}'   # 401
jq -e '.token==null and (.error|type=="string")' /tmp/b.json
# 3. no header -> 401 "Missing or invalid bearer token" (middleware/auth.ts:12)
curl -sS -X POST http://127.0.0.1:4000/api/search -H 'Content-Type: application/json' -d '{"q":"x"}' | jq -e '.error=="Missing or invalid bearer token"'
# 4. garbage token -> 401 "Invalid or expired token" (middleware/auth.ts:21)
curl -sS -X POST http://127.0.0.1:4000/api/search -H 'Authorization: Bearer not.a.jwt' -H 'Content-Type: application/json' -d '{"q":"x"}' | jq -e '.error=="Invalid or expired token"'
# 5. the now-deleted call must NOT be expected to work: prove the client no longer references it
grep -rn "api.logout\|auth/logout" /d/Develop/knowledge-app/web/src ; echo "grep exit=$? (1 = clean)"
# and (informational) the backend still has no such route:
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:4000/api/auth/logout -H "Authorization: Bearer $TOK"  # 404 — expected, and nothing calls it
# 6. typecheck the web app (AC11)
cd /d/Develop/knowledge-app/web && npx tsc --noEmit; echo "exit=$?"   # 0
```
Also assert **AC1 by grep — two-sided, mechanically (R8)**, replacing round 0's incorrect "exactly 2 lines":
```bash
cd /d/Develop/knowledge-app

# 1) POSITIVE-ABSENCE: no localStorage/sessionStorage ANYWHERE outside the owner.
grep -rn 'localStorage\|sessionStorage' web/src | grep -v '^web/src/lib/api.ts:'
# MUST be EMPTY (exit 1 from grep). Round 0 claimed "exactly 2 lines"; the post-fix
# count is ZERO lines outside api.ts, and the key literal lives only inside api.ts.

# 2) OWNERSHIP: the key literal appears in exactly ONE file.
grep -rln 'ka_token' web/src
# MUST print EXACTLY: web/src/lib/api.ts

# 3) CALL-SITE GONE (R8/R14 regression guard): the two removed sites must not reappear.
grep -n 'localStorage' web/src/app/dashboard/header.tsx      # MUST be empty
grep -n 'localStorage' web/src/components/login-form.tsx     # MUST be empty
```
**Counts stated precisely (superseding round 0):** *today* these greps find **4** `localStorage` lines outside `api.ts` — `header.tsx:11`, `header.tsx:41`, `layout.tsx:16`, `login-form.tsx:23` [V]. *After* the fix: `header.tsx:11` → `getToken()`, `header.tsx:41` → `clearSession()`, `layout.tsx:16` → `getToken()` (the new gate), `login-form.tsx:23` → **deleted**. Result: **zero lines outside `api.ts`**, and **1** line inside it (`api.ts`, the `STORAGE_KEY` constants/uses). Any non-zero result from grep (1) or a second file from grep (2) is a **FAIL** of AC1.

### B3.4 Part B — AC → proving test (R13; regenerated for the final assertion set, closes N-5b/N-5c)

**All 11 F2-B acceptance criteria are listed below, one row each, in AC order.** Mechanism is one of exactly three values: **automated** (the harness or a shell check decides PASS/FAIL with no human judgement), **manual** (a human performs §B3.1 in a browser and records what they saw), **documentation only** (no test exists or can exist; satisfied by the plan text itself and verified by reading). A row may combine an automated and a manual mechanism; the **strongest** mechanism is named first and the manual one is never described as automated.

| AC | Acceptance criterion | Proving test (exact reference) | Mechanism |
|---|---|---|---|
| **AC1** | One source of truth for the token; nothing outside the owner reads `localStorage` for auth | **§B3.1a `A11`** (in-harness: `offenders.length === 0`) **+ §B3.2 two-sided grep** checks (1), (2), (3) | **automated** (harness) + **automated** (grep) |
| **AC2** | After a full reload of any `/dashboard/*`, protected requests carry `Authorization` and succeed | **§B3.1a `A1 → A2 → A3`** (fresh module ⇒ `null` ⇒ hydrate ⇒ `api.search` resolves, `results.length === 0`) **+ `A13`** (empty storage ⇒ `null`, no throw) | **automated** (XHR-equivalent) |
| **AC3** | No protected request is made before rehydration; hydration is one-shot and cannot clobber a fresh session | **§B3.1a `A2`, `A7`, `A8`** — ordering inside the module and the one-shot flag only. **`A5`, `A6`, `A12`** prove the `ka:logout` mechanism, not hydration. | **automated** (XHR-equivalent) — see the explicit non-claim below |
| **AC3 (render-gate half)** | The React render gate (`ready ? children : null`) prevents `library`/`audit` mount-time calls | **§B3.1 step 5** only. The harness does not render React, so it **cannot** prove this. | **manual** |
| **AC4** | A missing token routes to a login page that exists; no infinite redirect loop | `web/src/app/login/page.tsx` exists (file presence, §7.1) + **§B3.1 steps 8 and 10** (navigation counts) | **manual** (navigation count) + **automated** (file existence via §7.2 baseline) |
| **AC5** | An expired/invalid token yields `401`, which clears **both** stores and leaves no live session | **§B3.1a `A9`, `A10`** (`clearSession` clears memory **and** removes the key; no resurrection) **+ §B3.1 step 7** | **automated** (XHR-equivalent) + **manual** (step 7) |
| **AC6** | Logout clears both stores and no residue survives a reload; the logout event is emitted once | **§B3.1a `A4`** (writer persists **and** removes), **`A9`, `A10`** (clear + no resurrection), **`A5`, `A6`, `A12`** (event delivered once, latch re-arms) **+ §B3.1 step 9** | **automated** (XHR-equivalent) + **manual** (step 9) |
| **AC7** | No dead endpoint is called (`api.logout` / `POST /auth/logout` gone) | **§B3.2 check 5** — `grep -rn "api.logout\|auth/logout" web/src` returns nothing (exit 1) | **automated** |
| **AC8** | Login behaviour preserved: the same credentials land on `/dashboard`; `/login` does not bounce an authenticated user | **§B3.1 steps 2 and 10** (explicit URL assertion: `/dashboard` after sign-in; `/login` while authenticated does not redirect) | **manual** (DOM/URL) |
| **AC9** | Existing navigation (Sidebar → Chat → Audit → Inbox) is unaffected | **§B3.1 step 6** (every API request carries `Authorization`; no 401; no reload) | **manual** |
| **AC10** | The localStorage-vs-HttpOnly-cookie trade-off is decided **and documented** | **NO TEST.** Satisfied by **§B2.6** (the trade-off table) and verified by the reviewer **reading it**. No command can fail if this regresses. | **documentation only** |
| **AC11** | The web app typechecks | **§B3.2 check 6** — `cd /d/Develop/knowledge-app/web && npx tsc --noEmit`, expected **exit 0** | **automated** |

**Explicit non-claims (the overclaims round 1 was raised to fix — stated so they cannot recur):**

1. **AC3 is *not* fully automated.** `A2`/`A7`/`A8` prove *ordering and one-shot semantics inside `api.ts`*; they say nothing about React's render gate. The gate claim (`ready ? children : null` stops `library/page.tsx:22` and `audit/page.tsx:11` from firing early) rests on **read + manual step 5**, and is labelled **manual** in its own row above. A green harness is **not** evidence that the gate is race-free.
2. **R12's username sub-assertion** (§B3.1 step 7) is **manual** and has **no harness counterpart**: with no renderer there is no first-paint check, and this plan does not pretend otherwise.
3. **`A5`/`A6`/`A12` prove the event contract, not navigation.** They prove `api.ts` dispatches `ka:logout` and that a listener receives it exactly once. That `layout.tsx`'s handler subsequently calls `router.replace("/login")` is **manual** (step 7).
4. **AC1's harness leg reads source text, not behaviour.** `A11` is a static scan for `localStorage`/`sessionStorage`; it cannot see a dynamically constructed key name. §B3.2's grep is an independent cross-check on the same class of evidence, so a bug in one does not silently pass the other.
5. **AC7 and AC11 are shell checks, not harness assertions** — they are **automated** but they are not part of `f2b-hydration.mjs`, and TEST-REPORT must report them separately with their raw exit codes.
6. **No AC is satisfied by the harness alone.** Counted over AC1…AC11: **automated-only = 4** (AC2, AC7, AC11, and AC3's module half); **automated + manual = 3** (AC1 = A11 + grep is fully automated, so it is counted above; AC5 and AC6 each pair harness assertions with a manual step); **manual-only = 3** (AC8, AC9, and AC3's render-gate row, which is listed separately); **documentation only = 1** (AC10). AC4 is **manual for navigation + automated for file existence**. The category counts overlap by design because AC3 and AC4 are each split across two rows; every criterion has at least one named mechanism and none is claimed stronger than it is.

**Coverage check:** F2-B has **11** acceptance criteria; the table above has **11 AC rows + 1 split AC3 row = 12 rows**, and every one of AC1…AC11 appears. There is no AC without a named mechanism, and no mechanism stronger than "documentation only" is claimed for AC10.

### B3.3 Producing a *deterministically expired* token, without printing secrets

**The token must be forged with the server's own secret, so it is rejected for expiry and for nothing else.** Three rules: never echo the token, never echo the secret, never write either to a file in the repo.

```bash
cd /d/Develop/knowledge-app/server
# Secret is read into an env var and passed to node via env — NOT on argv (argv is visible in the process list).
export KA_JWT_SECRET="$(grep -E '^JWT_SECRET' .env | cut -d= -f2- | tr -d '\r')"
[ -n "$KA_JWT_SECRET" ] || echo 'BLOCKED: JWT_SECRET empty (config fallback dev-only-change-me, config/index.ts:10)'
EXPIRED=$(node -e '
  const jwt=require("jsonwebtoken");
  // sub/username copied from a real login response shape (routes/auth.ts:27) — no secret echoed.
  process.stdout.write(jwt.sign({sub:"expired-test",username:"admin"},
        process.env.KA_JWT_SECRET,{expiresIn:-60}));      // exp = now-60s : expired on arrival
')
echo "expired token: len=${#EXPIRED}"          # length only
# Prove the *reason*: decode locally (no secret needed) and show exp < now
node -e 'const p=JSON.parse(Buffer.from(process.argv[1].split(".")[1],"base64url"));console.log("exp-now(s)=",p.exp-Math.floor(Date.now()/1000))' "$EXPIRED"
#                          -> a negative number, deterministic
# The backend must reject it with the expiry message, not a crash:
curl -sS -X POST http://127.0.0.1:4000/api/search -H "Authorization: Bearer $EXPIRED" \
     -H 'Content-Type: application/json' -d '{"q":"x"}' | jq -e '.error=="Invalid or expired token"'
unset KA_JWT_SECRET EXPIRED
```
Alternative (no secret needed) if the reviewer prefers: `expiresIn:'1s'` from a **real** login is **not** possible without changing `auth.ts:27` — so the forge above is the only non-invasive route. A second alternative for the browser: after a real login, overwrite `ka_token` in DevTools with the forged `$EXPIRED` value, then reload — the layout hydrates it, the first request 401s, and step 7 of §B3.1 runs end-to-end. **Do not paste the token into a ticket or a log** — record only its length and `exp-now`.

**Secrets hygiene for the whole phase:** the JWT is never echoed (`echo "${#TOK}"`), `.env` is only ever `grep`-ed with the value discarded (`sed` → `<redacted>`), and no `--verbose` curl (`-v`) is used against `/api/auth/login` or with an `Authorization` header. Any captured HAR/Network export must be scrubbed before being attached to `TEST-REPORT.md`.

---

## 4. RISKS / ASSUMPTIONS

| # | Risk / assumption | Mitigation / status |
|---|---|---|
| **R1** | **The "0 results" test passes vacuously** because `public.chunks` is empty (`0` [V]). This is exactly how the REQUEST's "verified: 1 result" was observed. | §A3.1 scratch schema + **G5 (= exactly 11)** non-vacuity gate + the explicit pre-fix reproduction in T-A1, which must return **10** (`min(11, LIMIT 10)`), not 0. **The single most important guard in this plan.** |
| **R2** | `EXPLAIN`-based index evidence is **impossible to obtain now** (0 rows) and any claim about GIN usage on this corpus would be fabricated. | A2.8 states *no index change justified* on **structural** grounds (expression match + already exists) and defers corpus measurement to the seeded fixture with an explicit decision rule (T-A9). No number is invented. |
| **R3** | `initSchema` inside `p2test` may create a `p2test.pgcrypto` duplicate. | Harmless; dropped with the schema; `schema.ts` must **not** be edited (§A2.8). |
| **R4** | Part A and Part B are independently testable, but F2-B's browser checks at step 5/7 interact with F2-A's 400 decision. | §B3.1 step 5 asserts the **400** explicitly, so the two parts are coupled by an *assertion*, not by shared code. Neither fix touches the other's files: F2-A touches `server/src/routes/search.ts` only; F2-B touches `web/**` only. |
| **R5** | `web/tsconfig.json` has `"incremental": true` and `next-env.d.ts`; `npx tsc --noEmit` may regenerate `tsconfig.tsbuildinfo`. | Run it, then check `baseline.sha256` — only `web/tsconfig.json` must stay unchanged; a `*.tsbuildinfo` is not a baseline member. Report it if it appears. |
| **R6** | `express-rate-limit` 100 req/min on `/api` (`app.ts:35-41`) will bite a loop of `curl`s (T-A5/T-A6 run ~30 requests; T-A7/T-A8 another ~10). | Keep each harness run under ~90 requests, or `sleep 1` between batches; if a `429` appears, **that is not a product failure** — record it and retry after the window. **Do not** raise the limit (out of scope). |
| **R7** | Demo credentials `admin/admin123` (`login-form.tsx:10,83-86`) [G] may not be the deployed password. | **A single preflight step** (§A3.4 P-1) asserts 200 + token *before* any other test; on 401 → `BLOCKED: demo credentials rejected; ADMIN_PASSWORD may be overridden in server/.env`. **Never guess, never try another password, never read one from `.env`.** |
| **R8** | `to_tsvector('english', c.text)` is computed **per row, per query, twice** (predicate + ORDER BY). | Acceptable: PostgreSQL may fold the identical expression; even unfolded it is CPU-cheap vs. the I/O it replaces (today it is also computed per row, in ORDER BY). Optimising it with a materialised `tsvector` column would be a **schema change** — out of scope (A2.8). |
| **R9** | Negative-only queries (`-vpn`) return every lexeme-bearing chunk. | **Documented, measured, pinned** in T-A5 + §A2.5. Not a regression (today *everything* is returned). **OQ-2**. |
| **R10** | ~~The Search route's 2nd query (the lexeme-less pre-check) adds a round trip.~~ **OBSOLETE after R1/R2** — that pre-check is deleted. | **Resolved by deletion:** the handler issues **exactly one** `pool.query` (§A2.3). No CTE, no second round trip, no extra connection checkout. |
| **R11** | `header.tsx` decodes the username client-side with `atob` and **falls back to `"admin"` on any failure** (`:19-20`). | Preserved as-is (display only, not an auth decision). Follow-up **FU-4**. |
| **R12** | Nothing in this plan proves the JWT is *valid* — only the backend can (`middleware/auth.ts:17`). Client-side "logged in" is a **UX gate**, never a security boundary. | Stated so no reviewer mistakes the hydration gate for authorisation. |

## 5. EXPLICITLY OUT OF SCOPE (carried, not fixed)

1. **FU-1** — Library/Audit calling `api.search({q:""})` as a workaround (`library/page.tsx:23-24`, `audit/page.tsx:13`); they must be rewired to `/api/library` + `/api/audit` [G: `REQUEST.md:21,36`]. This plan only **pins** their current broken behaviour.
2. **FU-2** — `res.json({limit: results.length})` echoes the *result count*, not the requested limit (`search.ts:66`) [V].
3. **FU-3** — localStorage → HttpOnly cookie migration (needs `Access-Control-Allow-Credentials`, exact-origin echo, `SameSite=None; Secure`, CSRF strategy) [G: `REQUEST.md:56`].
4. **FU-4** — `header.tsx` client-side JWT decode + silent `"admin"` fallback (`:19-20`) [V].
5. **FU-5** — `errorHandler` has 3 params so Express never uses it (`middleware/error.ts:7`); already **F6** in `phase1/RESULT.md:73` [G].
6. **FU-6** — `/api/chat` is a `202` stub (`routes/chat.ts:8-10`) [V]; the Chat page never calls it.
7. **FU-7** — no server-side revocation / refresh tokens (12 h fixed expiry, `auth.ts:27`) [G: `REQUEST.md:45,60`].
8. **FU-8** — `access_policies` table exists and is read by nothing (`schema.ts:33-40`) [V]; policy is a per-document string, not per-user.
9. **FU-9** — ingestion never writes `start_char`/`page_no` (`service.ts:284` insert is `(document_id, text)` only) [V], so A2.7's key 3 is a no-op today and the Retrieve page's "p. n" never renders.
10. **FU-10** — prefix search (`escal*`), `ts_headline` highlighting, trigram/fuzzy, synonyms, vector search [G: `REQUEST.md:36`].
11. **FU-PERF-1** — *created only if T-A9's third row fires* (`Seq Scan` **and** `Execution Time ≥ 200 ms` on the 10 000-chunk `p2test` fixture): "FTS query is a seq scan at 10 k chunks; revisit index / `pg_trgm` / `ts_stat` tuning." **No index is added in this phase** under any outcome.
12. Not done, not planned: any `schema.ts` change; `dist/**` rebuild (**`npm start` is not a supported run path this phase**, R17); `POST /api/auth/logout`; new npm dependencies (including any browser-test framework); `next build` (AC11 says not required).

## 6. OPEN QUESTIONS FOR THE REVIEWER

- **OQ-1 (Part A, index).** Do you accept **"no index change"** on *structural* grounds (the GIN index already matches the predicate's expression, §A2.8)? **Round-1 status: answered by R5, and the plan now implements the answer.** The 10 000-chunk fixture is seeded **inside `p2test`** (§A3.2b) and T-A9's three-outcome rule decides the verdict, so the measurement the OQ asked for is now specified rather than deferred.
- **OQ-2 (Part A, negation).** Is `q="-vpn"` (negation only) returning every lexeme-bearing chunk acceptable as documented behaviour, or should it be a **400** ("query must contain at least one positive term")? I chose *accept + document + pin in a test* because it follows directly from `websearch_to_tsquery` semantics and cannot be "wrong" in the way returning irrelevant chunks is. A 400 would need a second tsquery inspection (does the parsed query contain a positive lexeme?) — doable, but it is policy, not correctness.
- **OQ-3 (Part A, input caps).** Should `q` get an explicit **length cap** (e.g. 4 096 chars → `400`) rather than relying on `express.json({limit:'1mb'})`? Today a 100 k-char `q` would be parsed by `websearch_to_tsquery` on every request. Not added because it is a new contract; flagged because it is cheap.
- **OQ-4 (Part B, `/login`).** Create `web/src/app/login/page.tsx` (my choice, §B2.5) **or** repoint both redirects to `/` and leave the empty directory? I recommend creating it — it makes the existing code's stated intent true and keeps `/` untouched. If you prefer fewer files, repointing is behaviourally equivalent **except** that `/` then serves both logged-out and logged-in users with no redirect at all (which it already does).
- **OQ-5 (Part B, client-side `exp`).** Is a client-side `exp` pre-check before the first request worth it (avoids one guaranteed-401 round trip after 12 h idle), or is "let the 401 drive it" preferable to keep exactly one JWT parser in the client? I chose the latter.
- **OQ-6 (cross-part, `limit` contract).** `res.json({limit: results.length})` (D1/FU-2). Confirm it is **not** to be changed in this phase — changing it is a one-line contract change but AC7 asks for backward compatibility.
- **OQ-7 (process). — RESOLVED by R17.** `dist/**` is committed and is **not** in `baseline.sha256`; `npm start` runs `dist/index.js`. **Ruling applied:** the backend MUST be started with `npx tsx src/index.ts`; `dist` is **not** rebuilt in this phase; `npm start` is **not** a supported run path. The positive proof that the live binary is the fixed code is **T-A1 returning 0 for `zzzznotfound` on the seeded fixture** (§A3.4 P-2).

---

## 7. FILE-TOUCH SUMMARY (what the Implementer is authorised to change)

### 7.1 Exact edits, line by line

| Part | File | Exact change | In baseline? |
|---|---|---|---|
| **A** | `server/src/routes/search.ts` | **(a)** guard condition `:27` rewritten to `typeof q !== 'string' \|\| !q.trim()` — **one** guard, message unchanged (`:28`); **(b)** `:45` → `WHERE (d.access_policy = $1 OR $1 = '*')`; **(c)** **add** `AND to_tsvector('english', c.text) @@ websearch_to_tsquery('english', $2)`; **(d)** `ORDER BY` `:46-49` gains `d.id ASC, c.start_char ASC NULLS LAST, c.id ASC`. Mapper `:55-64` and response `:66` **byte-identical**. | **yes** (`baseline.sha256:1`) |
| A | `server/src/db/schema.ts` | **UNCHANGED** (explicit — §A2.8) | yes (`:6`) |
| **B** | `web/src/lib/api.ts` | Owner: add `STORAGE_KEY`, `hydrated`, **`logoutSignalled`**, `hydrateToken()`, `isHydrated()`, `clearSession()`, **`startSession()`**; `setToken` persists (re-arms the latch **only** when `t !== null`, N-6f); `request()` calls `hydrateToken()` first; 401 → `clearSession()` + **exactly one** `ka:logout` dispatch (§B2.4a — **this line is explicitly authorised here**, closing B-2); **delete `api.logout`** (`:56-59`). | **yes** (`:22`) |
| **B** | `web/src/app/dashboard/layout.tsx` | `:15-19` replaced by the hydration gate (`hydrateToken()` → `getToken()` check → `setReady(true)`), plus the `ka:logout` listener (`addEventListener` at mount, `removeEventListener` in cleanup); `{ready ? children : null}` at `:26`. | **yes** (`:26`) |
| **B** | `web/src/app/dashboard/header.tsx` | **`:11`** `localStorage.getItem("ka_token")` → **`getToken()`** (with `if (!t) { setUser(null); return; }`); **`:41`** `localStorage.removeItem("ka_token")` → **`clearSession()`**; `router.push("/login")` `:42` → `router.replace("/login")`; import gains `clearSession`/`getToken` from `@/lib/api`. **Zero `localStorage` references remain in this file.** | **yes** (`:27`) |
| **B** | `web/src/components/login-form.tsx` | **DELETE line `:23`** (`localStorage.setItem("ka_token", data.token);`) **and** its comment `:21-22` — `startSession(data.token)` (N-6f) owns the write and the latch re-arm; import at `:5` becomes `{ api, startSession }`. **Zero `localStorage` references remain in this file.** | **yes** (`:23`) |
| **B** | `web/src/app/login/page.tsx` | **NEW** — renders `LoginForm` (OQ-4). Does not exist today (`web/src/app/login/` is an empty directory [V]). | no (new file) |
| **B** | `web/scripts/f2b-hydration.mjs` | **NEW** — the executable harness (§B3.1a), **13 assertions (`S1`, `A1`…`A13`)**, no new dependency. Run: `node --import ./server/node_modules/tsx/dist/loader.mjs web/scripts/f2b-hydration.mjs` from the repo root. | no (new file) |
| **Neither** | `web/src/app/page.tsx`, `dashboard/{retrieve,chat,inbox,library,audit}/page.tsx`, `dashboard/sidebar.tsx`, all other server routes, `middleware/**`, `schema.ts`, both `package.json`s, `dist/**` | **UNCHANGED** | yes |
| **Neither** | `.pipeline/p2/**` | Pipeline artifacts only | no |

**Authorised baseline diffs: exactly 5 modified files + 2 new files.**
- Modified (all in `baseline.sha256`): `server/src/routes/search.ts`, `web/src/lib/api.ts`, `web/src/app/dashboard/layout.tsx`, `web/src/app/dashboard/header.tsx`, `web/src/components/login-form.tsx`.
- New (not in `baseline.sha256`): `web/src/app/login/page.tsx`, `web/scripts/f2b-hydration.mjs`.
- Every other baseline line must verify `: OK`.

**The three line-level edits the reviewer specifically required, restated so they cannot be missed:**
1. `header.tsx:11` — the **render-time** `localStorage` read is replaced by `getToken()` (R8). This is an **authorised contract change**, not an optional cleanup.
2. `header.tsx:41` — the logout `removeItem` is replaced by `clearSession()` (R8/AC6), so **both** stores are cleared.
3. `login-form.tsx:23` — the `setItem` is **deleted**, because `setToken` now persists (R14). Keeping it would leave two writers of one key.

### 7.2 Baseline update after implementation (R15)

`baseline.sha256` currently has **35** entries and does **not** contain either new file. After implementation, and **before** the phase is reported:

```bash
cd /d/Develop/knowledge-app

# 1. Baseline as it stands BEFORE implementation (integrity of the untouched tree).
sha256sum -c .pipeline/p2/baseline.sha256        # 35 lines, every one ': OK'

# 2. After implementation: exactly 5 lines must FAILED (the 5 authorised edits), and
#    NO OTHER line may fail. Enumerate them; anything else is an unauthorised change.
sha256sum -c .pipeline/p2/baseline.sha256 2>&1 | grep -v ': OK$'
#    EXPECT exactly these 5 and no more:
#      server/src/routes/search.ts
#      web/src/lib/api.ts
#      web/src/app/dashboard/layout.tsx
#      web/src/app/dashboard/header.tsx
#      web/src/components/login-form.tsx

# 3. Append the TWO new files' hashes (never replace, never re-sort, never rewrite).
sha256sum web/src/app/login/page.tsx web/scripts/f2b-hydration.mjs >> .pipeline/p2/baseline.sha256
wc -l .pipeline/p2/baseline.sha256                # MUST now be 37

# 4. Re-baseline the 5 authorised edits + register the 2 new files, in ONE deterministic pass,
#    preserving the original line ORDER and the exact bytes of every untouched line.
#    Regenerate only the 5 changed hashes; append the 2 new entries at the END.
#    (Do not sort. Do not dedupe. Do not rewrite untouched lines.)
#    Result: 37 entries = 35 original paths + 2 new paths.

# 5. Prove internal consistency of the new file: 37 lines, every one ': OK'.
wc -l .pipeline/p2/baseline.sha256                # 37
sha256sum -c .pipeline/p2/baseline.sha256         # every line ': OK', 0 FAILED
```

**Why this step exists (the silent-gap reason the review gave):** adding a file produces **no** `sha256sum -c` failure — the check only fails on a *removed* or *modified* file — so an un-appended new file is invisible to the integrity gate. The count check (`35 → 37`) is the assertion that closes it. `TEST-REPORT.md` must record the line count and the full `: OK` tally.

**No `dist` rebuild** (R17): `dist/**` is not a baseline member and is **not** rebuilt or edited in this phase; `npm start` is therefore **not** a supported run path (OQ-7 resolved).

### 7.3 Cleanup and verification — the five checks that must all hold before close-out

These are stated as **checks with exact expected values**, not as instructions to "make sure". Each is run by the Test Engineer and its raw output pasted into `TEST-REPORT.md`. **None of the expected values below is a measurement I took** — they are the design's predictions (`[U]` until the run).

| # | Check | Exact command | Expected value | If it does not hold |
|---|---|---|---|---|
| **V1** | Baseline is **35** entries before implementation | `wc -l < .pipeline/p2/baseline.sha256` | **`35`** [V: measured 35 this session] | **BLOCKED** — the baseline was tampered with before work started |
| **V2** | No unrelated file was touched | `sha256sum -c .pipeline/p2/baseline.sha256 2>&1 \| grep -v ': OK$'` (run against the **35**-line file, before the append) | **exactly 5** lines, and only these paths: `server/src/routes/search.ts`, `web/src/lib/api.ts`, `web/src/app/dashboard/layout.tsx`, `web/src/app/dashboard/header.tsx`, `web/src/components/login-form.tsx` | Any **6th** line, or any path not in that list ⇒ **unauthorised change**: revert it and report; do **not** re-baseline it |
| **V3** | Baseline becomes **37** entries after the two new files | `sha256sum web/src/app/login/page.tsx web/scripts/f2b-hydration.mjs >> .pipeline/p2/baseline.sha256` then `wc -l < .pipeline/p2/baseline.sha256` | **`37`** (= 35 original + 2 new; no sort, no dedupe, untouched lines byte-identical) | **BLOCKED** — the count is the only gate that catches an unappended new file (§7.2) |
| **V4** | The 37-line baseline is internally consistent | `sha256sum -c .pipeline/p2/baseline.sha256` | **every line `: OK`**, `0` FAILED | Any `FAILED` ⇒ a file changed after re-baselining ⇒ **BLOCKED** |
| **V5** | The **web** app typechecks | `cd /d/Develop/knowledge-app/web && npx tsc --noEmit; echo "exit=$?"` | **`exit=0`** | Non-zero ⇒ **FAIL AC11**; paste the first 20 lines of `tsc` output verbatim |

**Harness run (V6, required by Rb-4/Rb-7):**

```bash
cd /d/Develop/knowledge-app
node --import ./server/node_modules/tsx/dist/loader.mjs web/scripts/f2b-hydration.mjs; echo "exit=$?"
```
Expected: the last line is `RESULT: PASS` and `exit=0`. `exit=2` ⇒ a precondition was unmet (backend down or credentials overridden) ⇒ **BLOCKED**, not FAIL. `exit=1` ⇒ read the `FAIL` lines; a `FAIL A3 … Unauthorized` is **AC2 failing**, never a harness bug (§B3.1a.6).

**Cleanup (order matters):**
1. Run **V1** *before* touching any file; run **V2** *after* implementation but *before* the append; run **V3/V4** *after* the append; run **V5/V6** last.
2. Release the dev servers the phase started (backend `:4000` started with `npx tsx src/index.ts`, web `:3000` via `next dev`); record how each was started.
3. Part A side-effects are cleaned per **§A3.5 C1→C4** (drop `p2test`, remove uploaded blobs **by sha256**); Part B adds **no** DB rows and **no** blob, so it contributes nothing to that cleanup.
4. Confirm **`dist/**` was not rebuilt** and both `package.json` files are unchanged (they are in the baseline; V2/V4 prove it).
5. Delete any harness scratch file; the only new files are the **two** listed in §7.1.

---

## 8. DELIVERABLES AND CLOSE-OUT STEPS (exact, in order)

The phase is not complete until every step below is done **and recorded**. Steps D-1…D-4 are preconditions; D-5…D-11 are the closing sequence.

| # | Step | Evidence to record |
|---|---|---|
| **D-1** | Preflight §A3.4 **P-0** (binary = `npx tsx src/index.ts`) | The `ps` line or the operator's confirmation. **No `dist` rebuild.** |
| **D-2** | Preflight §A3.4 **P-1** (demo credentials → 200 + token) | `token acquired: N chars` (length only). On 401 → `BLOCKED: demo credentials rejected; ADMIN_PASSWORD may be overridden in server/.env` and **stop**. |
| **D-3** | Seed fixture (§A3.2) and assert **G1, G4, G5 = 11, G6 = 9, G7 = 1** | The five `psql` outputs verbatim. |
| **D-4** | Preflight **P-2** (T-A1 returns 0 for `zzzznotfound` on the seeded fixture) | The measured count (must be `0`). This is the proof the live binary is the fixed code. |
| **D-5** | Run **T-A1…T-A10** in order (T-A10 **last**, it changes the fixture counts) | Each test's HTTP status + body assertion, plus the T-A1 pre-fix reproduction (**10**), the T-A9 `EXPLAIN` and its rule row, and any `429` recorded as RATE-LIMITED (never PASS). |
| **D-6** | Run the §A3.2b 10 000-chunk fixture and **T-A9's EXPLAIN**; classify against the three-row rule | The `EXPLAIN (ANALYZE, BUFFERS)` output verbatim + the chosen rule row. If row 3 fires, record **FU-PERF-1**. |
| **D-7** | Run **§B3.2 checks 1–6** and the **two-sided AC1 grep** | grep (1) empty; grep (2) exactly `web/src/lib/api.ts`; grep (3) both empty. Plus `cd web && npx tsc --noEmit` **exit 0**. |
| **D-8** | Run **`web/scripts/f2b-hydration.mjs`** (§B3.1a) with the exact command in §B3.1a.1 (**not** `npx tsx`, **not** `cd web && node …`) | Full `PASS`/`FAIL` lines for **`S1`, `A1`–`A13`** and the final `RESULT:` line, plus the process exit code. **Label it "XHR-equivalent, no browser".** |
| **D-9** | Run the **manual** browser steps **§B3.1 steps 1–11** | Each step's observed result. Mark steps 4, 5, 7, 9, 10 as MANUAL. **Step 7's sub-assertion (no username before redirect) is MANUAL** and must be stated as such. |
| **D-10** | **Cleanup** §A3.5 **C1→C4** (`p2test.admins` recorded = 1 before the drop; `public.admins` = 1 after; `p2test` gone; `public.documents/chunks` = 0/0; `f1test.documents` = 182) + remove upload blobs **by exact sha256** | The C1 record, the C4 assertions, and the list of removed blob paths. |
| **D-11** | **Baseline update** §7.2 (35 → 37, all `: OK`) + write `TEST-REPORT.md` | `wc -l` = 37 and the full `: OK` tally; the report must state **the fallback level used (XHR-equivalent, browser unavailable)** and must **not** claim a browser test was run if it was not. |

**`TEST-REPORT.md` must contain, at minimum:**
1. The D-5 test matrix with observed values (a **`429` is never a PASS**).
2. The T-A9 `EXPLAIN` output and the rule row applied.
3. The two-sided AC1 grep output.
4. The harness output (**`S1`, `A1`–`A13`**) labelled **XHR-equivalent**, with the exact command used and the exit code.
5. Which steps were **MANUAL** (browser) and which were **automated**, and that **AC10 is documentation only**.
6. The cleanup record (C1–C4) including `p2test.admins` = 1 and `public.admins` = 1.
7. The baseline line count (**35 before → 37 after**) and the full `: OK` tally.
8. Every `BLOCKED` encountered, with the exact reason string and **no workaround attempted**.

## 9. EXECUTION ORDER (one page, so the implementer runs nothing out of order)

```
PREFLIGHT  P-0 → P-1 → seed fixture → G1/G4/G5/G6/G7 → P-2
PART A     T-A1 → T-A2 → T-A3 → T-A4 → T-A5 → T-A6 → T-A7 → T-A8 → T-A9 → T-A10(last)
PERF       seed A3.2b (10 000) → T-A9 EXPLAIN → classify → record FU-PERF-1 if row 3
PART B     edit api.ts → layout.tsx → header.tsx(:11,:41) → login-form.tsx(delete :23) → new login/page.tsx
           → new web/scripts/f2b-hydration.mjs
           → §B3.2 checks 1–6 + AC1 grep → run the harness (S1, A1–A13) → manual §B3.1 steps 1–11
CLOSE      §A3.5 C1→C4 cleanup → remove blobs by sha256 → §7.2/§7.3 baseline 35→37 + V5 tsc → TEST-REPORT.md
```

**Blocking rules (no exceptions):**
- `T-A1`'s pre-fix reproduction ≠ 10, or `G5` ≠ 11 → **BLOCKED**, never PASS.
- `T-A3`'s mutation check finds identical orders → **BLOCKED: fixture cannot discriminate rank from tiebreak**.
- Harness `A3` throws `Unauthorized` → **AC2 FAILED**; do not adjust the harness.
- P-1 returns 401 → **BLOCKED** with the fixed message; no credential guessing.
- Any `429` → record as RATE-LIMITED and retry; never PASS.
- Any file changed outside §7.1 → **unauthorised change**, revert and report.

**Honesty constraints restated:** no runtime, rank value, `EXPLAIN` plan, harness result or grep count in this plan is presented as measured. Everything marked **[V]** was read this session; everything marked **[U]** remains unmeasured until the Test Engineer runs it.

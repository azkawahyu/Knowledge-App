# REVIEW — Phase 2: F2-A FTS Search Correctness + F2-B Auth Token Persistence

ROLE: INDEPENDENT PLAN REVIEWER
PROJECT ROOT: `D:\Develop\knowledge-app`
ARTIFACTS REVIEWED: `.pipeline/p2/PLAN.md` (869 lines, full), `.pipeline/p2/REQUEST.md` (71 lines, full), `probe_fts.sql`, `probe_current_vs_fixed.sql`, `probe_explain.sql`, `probe_edge.sql`, `baseline.sha256`
CODE READ (all in full unless noted): `server/src/routes/search.ts`, `server/src/db/schema.ts`, `server/src/db/index.ts`, `server/src/middleware/auth.ts`, `server/src/middleware/error.ts`, `server/src/routes/auth.ts`, `server/src/routes/ingest.ts` (relevant spans), `server/src/app.ts`, `server/src/config/index.ts`, `server/src/ingest/service.ts` (relevant spans), `server/src/ingest/chunker.ts`, `server/src/ingest/types.ts`, `server/package.json`, `server/tsconfig.json`, `web/src/lib/api.ts`, `web/src/app/layout.tsx`, `web/src/app/page.tsx`, `web/src/app/dashboard/{layout,header,sidebar}.tsx`, `web/src/app/dashboard/{retrieve,chat,inbox,library,audit}/page.tsx`, `web/src/components/login-form.tsx`, `web/package.json`
DATE: 2026-11-02
NOTE: I did not start a server, did not connect to PostgreSQL, and modified no source file. Every `[V]` below is a **static** verification (file read / repo grep). Items that need a live database are marked `[V-read]` (verified by reading the SQL only) or `[U]`.

---

## DECISION

**PART A: REVISE**

**PART B: REVISE**

Both parts are built on a correct diagnosis and both contain real, non-vacuous test scaffolding that is much better than the REQUEST's. Neither can be approved as written: **Part A** proposes a guard that changes the status contract for the Library and Audit pages (a regression it explicitly tests *for*), adds an unnecessary second round trip, and its rank-order proof cannot fire on the fixture it specifies. **Part B** states a falsifying code fact (that no authorised file reads `localStorage` at render time) that is **wrong** — `header.tsx:11-11` still does and the file is deliberately left out of the authorised diff list — and it has **no executable automated test at all** for the one AC that actually regresses under reload.

Implementation of a part must not start before that part is approved. Revisions 1–7 are Part A; 8–12 are Part B.

---

## SUMMARY

The plan is unusually strong on evidence discipline: it re-measures the REQUEST's claims instead of inheriting them (§0 C1 correctly shows the live defect is *latent* because `public.chunks` is empty), it refuses an arbitrary rank threshold with a measured justification (§A2.6), it documents the negation-only edge case instead of hiding it (§A2.5 / T-A5), it pins Library/Audit's brokenness rather than quietly "fixing" out-of-scope pages, and it specifies a scratch-schema isolation (`p2test`) with non-vacuity gates that directly closes the trap that produced the REQUEST's own bad evidence. The Part B analysis of the token lifecycle (§B1.2) is accurate line-for-line against the code I read.

The failures are of three kinds, all of which matter:

1. **A wrong code fact that voids a design promise (Part B).** §B2.2 promises the supplied `dashboard/layout.tsx` "guarantees `library/page.tsx`'s and `audit/page.tsx`'s mount-time `api.search` **cannot** fire early", and the fix's stated AC1 compliance ("nothing outside this module may touch `localStorage["ka_token"]`") rests on it. But **`web/src/app/dashboard/header.tsx:11` reads `localStorage.getItem("ka_token")` directly, at mount, and renders the decoded username** — and §7's file-touch table does **not** authorise changing `header.tsx`'s token read (it only authorises the logout handler and the `getToken()` swap, listed as a change but with the render-time read never called out as a contract violation). Worse: because the layout still renders `<Header />` **unconditionally** (only `{children}` is gated — PLAN:637-644), a hard reload with an **expired** token renders the `admin` username in the header for the duration of the 401 round trip even though the request was sent unauthenticated. The layout gate is sound; the *claim* is what is wrong, and the plan's own §B2.2 "three layers, each independently sufficient" is therefore a two-layer guarantee plus one false layer.

2. **A contract regression that is asserted as a feature (Part A).** §A2.4 and the rewritten handler (§A2.3) make `typeof q !== 'string' || !q.trim()` a **400**, and add a **second 400** for lexeme-less queries. `retrieve/page.tsx:17` and `chat/page.tsx:16` already guard `if (!q.trim()) return;` so a human typing into the UI cannot be affected — but `library/page.tsx:24` and `audit/page.tsx:13` call `api.search({ q: "", limit: 100|200 })` **on mount**, and the plan's own §A2.4 row and R4 assert that after the fix these pages "show the **400 error text** they show today". That statement is **false today**: `q: ""` is falsy, so `search.ts:27-30` returns **400 `q (query string) is required`** *now* — verified by reading `search.ts:27`. So the pages' today-behaviour is a red error, and the plan's assertion is that they *keep* the red error — which is at least internally consistent, but it means the plan consciously locks in a user-facing error on two dashboard pages that the REQUEST explicitly says must not be re-wired ("do not fix other pages"). That is a scope-boundary violation **and** an AC7 ("existing Retrieve/Chat pages keep working unchanged") adjacent risk: the plan is not just preserving an accident, it is making the error mandatory in the face of the correct contract. AC4 permits `400` **for `q:""`**; it does not require a new `400` class for lexeme-less queries, and AC7/AC8 do not ask for one.

3. **A rank-order test that cannot discriminate (Part A) and browser-only tests with no CI-runnable fallback (Part B).** T-A3 asserts `[.results[].document_id] == ([.results[].document_id] | sort)` — this is an assertion about the **tiebreaker key**, and on the specified fixture (`p2-doc-main` ×2 + `p2-doc-trusted` ×1) it passes **identically** under the old (no-op) query as long as the planner happens to emit that order, because all the fixture's ranks are near-tied. It does **not** prove "best match first". The one query in the whole Part A suite that would prove relevance ordering (`escalation pager`) is also satisfied by document_id sort in the fixture as specified, because both "escalation pager" chunks belong to the same document (`p2-doc-main`), so the tiebreaker key dominates. Part B's §B3.1 table is a 10-step human-in-the-browser manual checklist; §B3.2's API checks never exercise `hydrateToken`, `clearSession`, the layout gate, or the 401→`ka:logout` event at all, so a broken Part B fix can pass every automated check in the plan.

**Net:** the plan is a strong *investigation* and a weak *contract*. Six of the twelve verification items are WRONG or incomplete, but every one of the wrong items is fixable in place without invalidating the plan's architecture.

---

## VERIFICATION TABLE

Legend: **OK** = verified correct against code/artifacts. **WRONG** = contradicted by code or by the plan's own fixture. **FAILS-HERE** = correct as a fact but the test/assertion named for it cannot discriminate. `[U]` = requires a live DB, not verifiable statically.

| # | Item | Check performed | Verdict |
|---|---|---|---|
| 1 | **Claimed defect is real and correctly localised** | `search.ts:34-53` confirmed: SELECT over `chunks c JOIN documents d`, `WHERE d.access_policy = $1 OR $1 = '*'`, `ORDER BY ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english', $2)) DESC`, `LIMIT $3`. The string `@@` does **not** occur in `search.ts`. `q` reaches SQL only as bind `$2`. PLAN:61 accurate. | **OK** |
| 2 | **`ts_rank` returns non-zero for non-matching rows (hence junk is returned)** | `ts_rank` semantics are standard PG; plan's probe (`probe_current_vs_fixed.sql` L18-24) exercises it correctly against a TEMP fixture, and the query shape matches the route's `:34-53` verbatim (modulo table aliasing). The residual "1 result for nonsense" in REQUEST is explained by `LIMIT`; plan's C1 correction is sound. | **OK** |
| 3 | **GIN index `chunks_fts_idx` matches the proposed predicate's expression byte-for-byte** | `schema.ts:30-31`: `CREATE INDEX IF NOT EXISTS chunks_fts_idx ON chunks USING GIN (to_tsvector('english', text))`. Proposed predicate is `to_tsvector('english', c.text) @@ websearch_to_tsquery('english', $2)` — the index expression is `to_tsvector('english'::regconfig, text)`, and a bare `'english'` literal resolves to `text` then is coerced to `regconfig` at the same volatility/immutability class, so the expression **is** index-usable. Plan §A2.8 C2 verdict correct. | **OK** |
| 4 | **Scratch-schema isolation (`p2test`) is safe and does not touch `public`/`f1test`** | `schema.ts:3-64` uses only unqualified `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, so `search_path=p2test` isolation works, with the noted residual `CREATE EXTENSION pgcrypto` landing in `p2test` (harmless). `db/index.ts:22-34` seeds an admin **into `p2test.admins`** too — the plan does not say so, and that is a real extra side effect: a second `admins` row + bcrypt hash in the scratch schema, plus a login path that will now succeed against a `p2test`-scoped admin. Not dangerous (dropped with the schema) but it **must** be stated, because the plan's cleanup assertions only check `public.admins = 1`, never `p2test.admins`. | **OK with gap (→ R-16)** |
| 5 | **The proposed SQL is correct and parameterised** | §A2.2 SQL: predicate `AND to_tsvector('english', c.text) @@ websearch_to_tsquery('english', $2)` after a parenthesised policy clause; `ORDER BY ts_rank(...) DESC, d.id ASC, c.start_char ASC NULLS LAST, c.id ASC`; binds unchanged `[policy, q, limitN]`; `$2` reused for both predicate and rank. No interpolation. Correct. | **OK** |
| 6 | **The lexeme-less guard (`websearch_to_tsquery(...,q)::text === ''` → 400) is the right design** | `probe_fts.sql` shows `websearch_to_tsquery` never raises on the 11 hostile strings, so a guard is *possible*; `probe_current_vs_fixed.sql` L62-65 shows the empty tsquery matches nothing. But: (a) it is an **extra round trip per search** (§A2.9's CTE alternative is cheaper and safer for the index — see R-2), and (b) the plan uses it to introduce a **second 400 class** (`q contains no searchable terms`) that AC4 and AC7 do not require and that the plan's own §A2.4 admits is a new contract string. The plan's justification ("a user typing stopwords gets told, not a pristine empty list") is a UX preference presented as correctness. | **WRONG (over-reach → R-1, R-2)** |
| 7 | **`q:""` behaviour today vs after the fix, and the Library/Audit consequence** | Today: `search.ts:27` `if (!q || typeof q !== 'string')` → **400** for `""` and for whitespace-only? **No**: `"   "` is truthy, so whitespace-only falls through to the empty tsquery and returns 0 rows today. After fix: `!q.trim()` → 400 for whitespace-only too. So the plan's §A2.4 row is accurate for `"   "` but **the Library/Audit "red error today" claim and the "red error after" claim are the same claim — the pages are already broken**, and the plan's §A2.4/§R4 language ("would silently render ... with `[]`") correctly identifies the trade-off but then chooses the *option that preserves a user-visible error on two shipped pages*, in direct tension with the REQUEST's "do not fix other pages" and AC8's spirit. The right resolution is **not** `[]` (which the plan correctly rejects as masking) but **keeping the existing 400 message for `q:""` and not adding a second 400 class** — see R-1. | **WRONG (decision, not a fact error)** |
| 8 | **Fixture math (8 docs / 9 chunks; exactly 1 matches `backup`, exactly 2 match `escalation`, 0 match `zzzznotfound`)** | Re-derived from PLAN:340-350 against `webster`'s `english` dictionary behaviour: `p2-doc-main#1` ("N2N escalation procedure… pager alert within five minutes") matches `escalation`; `p2-doc-main#3` ("…also pages the on-call database administrator") matches `escalation`; `p2-doc-trusted` ("Trusted N2N escalation notes…") matches `escalation`; so **3** chunks match `escalation` under `policy='*'` — plan's T-A2 line 382 asserts `length == 3` and its comment says "p2-doc-main x2 + p2-doc-trusted x1" which is consistent. `backup` matches only `p2-doc-main#2` — 1, correct. `zzzznotfound` matches 0. Fixture math is **right** on the stated counts, but `T-A2`'s negative control `q='apricot marmalade'` is asserted to return `["p2-doc-nomatch"]` **and** `length == 1` — `p2-doc-nomatch` is `public`, so under `policy='*'` that holds; fine. | **OK** |
| 9 | **`T-A3` rank-ordering assertion proves "best match first"** | **No.** On the fixture, `escalation pager` matches `p2-doc-main#1` (both terms, high rank) and `p2-doc-main#3` (only `escalation`), so a correct implementation returns `#1` then `#3` — **and so does the document_id sort**, because both are the same document. The assertion `[.results[].document_id] == sort(...)` therefore passes under the broken query too. The `test("pager alert within five minutes")` on `.[0]` *is* discriminating **only if** the fixture is changed to put the high-`ts_rank` chunk in a **different** document from the lower one (or to make the highest-ranked chunk's document sort *last*). As specified, T-A3 is near-vacuous. | **FAILS-HERE (→ R-3)** |
| 10 | **`T-A1`'s "must return 9" pre-fix reproduction is correct arithmetic** | PLAN:369-372 asserts the no-predicate SQL against `p2test` returns **9** for `zzzznotfound`. The fixture is 9 chunks *all* with non-empty or empty tsvector (the two empty-tsvector rows are still rows), so the unmodified query `WHERE (d.access_policy='*' OR '*'='*') ORDER BY ts_rank(...) DESC LIMIT 10` returns **all 9** rows regardless of tsvector emptiness (no predicate → no `@@` filter). **9 is correct.** Good — this is the single most important non-vacuity gate and it is arithmetically sound. | **OK (strong)** |
| 11 | **`query`/`limit`/`results` response shape unchanged; `limit` echoes `results.length`** | `search.ts:66` confirmed `{ query: q, limit: results.length, results }`. Plan §A2.7/FU-2/D1 preserves it verbatim, and T-A8's `keys == ["limit","query","results"]` + 8-key element check is exactly right. | **OK** |
| 12 | **Part B defect analysis, line by line (`api.ts:3,9,15-17,29-33,56-59`; `layout.tsx:16`; `header.tsx:11,41`; `login-form.tsx:20,23`)** | Mapped every citation against the files I read. All twelve. The one that is **not** in the plan's citation set and voids a claim: **`header.tsx:11` reads `localStorage` at mount and `:14-18` decodes and renders the username**, which is (a) a render-time `localStorage` auth-ish read by a file the plan does **not** authorise changing for that purpose, and (b) the reason a hard reload with an expired token shows `admin` in the header while the request is unauthenticated. The plan's §B2.2 "each independently sufficient" and the AC1 grep claim ("exactly 2 lines, both inside `web/src/lib/api.ts`", §B3.2) are **both false** under the currently-authorsed file set. | **WRONG (→ R-8)** |

### Additions I found that the plan missed

| # | Item | Detail | Verdict |
|---|---|---|---|
| 13 | **The lexeme-less 400 is a *new* status for a path the plan calls unchanged** | PLAN §A2.4 row 2 asserts the new 400 replaces "200 with all chunks". Verified: today `q="the and or"` returns **200 with all chunks** (`search.ts` has no predicate). So the row is factually right — the finding is that the plan never quantifies the cost of the new class, and it uses it in a test (T-A5) that asserts the *error string*, freezing a UX decision into the contract. | **NB-1 (non-blocking if R-1 applied)** |
| 14 | **`admin` password in dev config is the fallback `admin123`** (`config/index.ts:9-10`), and the plan's §A3.4/T-A6 tests sign in with it | Consistent with `login-form.tsx:83-86`, so acceptable, but the plan must state that the **`p2test` admin row is created with this same password** if `ADMIN_PASSWORD` is set in `.env` and reused — see R-16. | **NB-2** |
| 15 | **`npm start` runs `dist/index.js`** (`server/package.json:9`), `dist/**` is **not** in `baseline.sha256` | Plan OQ-7 correctly flags this. If the Test Engineer starts `npm start` instead of `npx tsx src/index.ts`, **none of Part A's fixes are in the running binary**. This is the single highest-risk *test-environment* mistake in the phase. | **OK (OQ-7 → R-17)** |
| 16 | **`errorHandler` has an arity bug and swallows async-thrown errors** (`middleware/error.ts:7` — 3 params, Express needs 4) | Not in this phase's scope, **but** it is the reason `search.ts`'s `try/catch` must remain the only 500 path. The plan relies on `search.ts:67-69` catching every error — verified it does (all awaits are inside the `try`). No change required; recorded so the Implementer does not "tidy" the try/catch thinking `errorHandler` is a safety net. | **NB-3 (do not touch)** |
| 17 | **`ingest.ts:238` returns `{ results, errors }` where `results` is `IngestionResult[]`, not search rows** | Plan T-A10 asserts `.results\|length==1` on the upload response — correct for the **ingest** contract (`types.ts:72-91`), and it does not collide with the search contract because the routes are distinct. No conflict, but the assertion must be described as "ingest contract, untouched" or a future reader will think T-A10 re-uses the search shape. | **OK (clarify)** |

---

## VACUOUS-TEST AUDIT

A test is **vacuous** if it can pass while the bug is still present. Below, every test in the plan is scored, and the *discriminating* change required is named.

### Part A

| Test | Vacuous? | How it could pass with the bug present | What makes it discriminate |
|---|---|---|---|
| **T-A1** nonsense → 0 results | **No, *given* the gate** | Against `public` (0 chunks) it passes trivially. Against the fixture it fails under the broken query (returns 9). | The G5 gate (`chunks >= 9`) **and** the pre-fix reproduction must return **9**, not 0 (PLAN:369-372). This is the best-designed non-vacuity gate in the plan. **Keep verbatim.** |
| **T-A2** matching → exactly the matching chunks | **Partially** | `q='apricot marmalade'` → 1 row: under the broken query with `LIMIT 10` and 9 fixture rows, the broken query would return **all 9**, so this test does discriminate. `q='escalation'` → 3: broken query returns 9, so it discriminates too. **But** if the fixture is ever grown past `limit`, both queries return `LIMIT` rows and the test passes under the bug. | Add an explicit `assert results.length < 9` companion, or (cleaner) assert *set equality* against the SQL's matching set, not just cardinality. See R-4. |
| **T-A3** rank ordering | **YES — vacuous as specified** | Both matching chunks for `escalation pager` belong to `p2-doc-main`, so `document_id` sort produces the same order as `ts_rank DESC` by construction. The old query also returns them (plus 7 junk rows), and the `.[0]` test passes *only* because `ts_rank` happens to order `main#1` first even with no predicate. **If a future refactor dropped the `ts_rank` key entirely and kept only `d.id`, this test still passes.** | Put the highest-`ts_rank` chunk in a document whose `id` sorts **last**. Then `document_id sort` is *anti-correlated* with `ts_rank`, and any implementation that loses the rank key fails. Plus: assert the **HTTP `chunk_id` sequence equals the SQL's `c.id` sequence** (the plan already writes this at PLAN:401 — good — but the fixture must make it meaningful). See R-3. |
| **T-A4** multi-word semantics (AND/phrase/OR/negation) | **No** | `q='backup apricot'` → 0 is a genuine AND-vs-OR discriminator (an OR would return 2). `"procedure escalation"` → 0 proves phrase order (plainto would return 3 — a good cross-check that the chosen function survives a later "simplification"). `escalation -pager` → 1 proves negation. The quoted-phrase pair `(409,410)` is the strongest test in the plan because it fails for **both** the broken query (no predicate) and for a `plainto_tsquery` regression. | Nothing — keep verbatim, and **add the `plainto` negative control as an explicit assertion** (run the same four queries through a second SQL using `plainto_tsquery` and prove at least one differs) so the choice is defended by data, not by prose. |
| **T-A5** empty/whitespace/lexeme-less → 400 | **Partially** | The 400 for `""`/`"   "` passes **today** (for `""`) with no fix at all, so it does not test the fix. The lexeme-less 400 tests the *guard*, not the *predicate*. `-vpn → 200` pins the edge case but is exactly today's behaviour, so it passes under the bug. | Split: (a) assert the `q=""` 400 **also** on a *seeded* schema, so it is not confounded by empty-table behaviour; (b) drop the lexeme-less-400 assertions (R-1); (c) keep `-vpn → 200` **only** as a regression pin, explicitly labelled "not a fix assertion". |
| **T-A6** hostile input → never 500 | **No** | Each of the 11 hostile strings returning 200-with-tsquery is a real discriminator against a `to_tsquery` implementation (which would 500 on `a'b`). The `x;DROP TABLE chunks;--` case is a real parameterisation check, and the plan's post-loop `count(*) FROM chunks == 9` proves nothing was dropped. | Keep verbatim. Strengthen: also assert `chunks` count is **unchanged** *and* `documents` count unchanged (the plan only checks chunks). |
| **T-A7** policy not weakened | **No** | `policy='public'` → only public; `trusted` → only trusted; `salary` under `'*'` reaches restricted; `salary` under `'public'` → 0. All four are real discriminators, and the invariant `∀r: policyArg=='*' ∨ r.document_policy==policyArg` is the right shape. | Keep verbatim. **Add one**: `q='zzzznotfound', policy='*'` on the fixture → 0 (proves the fix and the policy filter compose, not just each alone). |
| **T-A8** consumer compatibility (shape + pages) | **Partially** | The shape assertions (keys, 8 per-element keys, types) are genuine and will catch a mapper change. The **page-level** assertions are the weak part: "open `/dashboard/library` and confirm it still shows the **400 error text** they show today" — that passes under **every** implementation including a do-nothing one, because the page shows a 400 today. It pins FU-1 but is not a fix assertion. | Keep the shape assertions as the fix assertion for AC7. Re-classify the page checks explicitly as "FU-1 pin, not a fix assertion" (already partly done at PLAN:469 — make it explicit in the table). |
| **T-A9** no schema change / index set unchanged | **No** | `sha256sum -c` on `schema.ts`/`db/index.ts`/`ingest/` must be `: OK`; the `pg_indexes` set must be exactly `{chunks_fts_idx, chunks_pkey, documents_pkey}`. Genuine and mechanical. | Keep. **Fix**: the decision rule at PLAN:480 ("if the plan shows a Bitmap Index Scan … no index change") takes no action in either branch — it never says what to do if it shows a **Seq Scan** on a ≥10 000-chunk fixture. As written it is unfalsifiable. See R-5. |
| **T-A10** no Phase 1/F1 regression | **No** | `tsc --noEmit` exit 0 + a real upload into `p2test` returning `.results\|length==1`. Genuine. | Keep. Note the upload response is the **ingest** shape (`ingest.ts:238`), not the search shape — describe it as such (NB-17). |

### Part B

| Test | Vacuous? | How it could pass with the bug present | What makes it discriminate |
|---|---|---|---|
| **§B3.2 check 1** login returns a usable token | **Partially** | Asserts `len>0` only — does not use the token. A server that returns a token but rejects it everywhere passes. | Add: use the token on `/api/search` and assert 200. |
| **§B3.2 check 2** bad password → 401 | **No**, but **it tests the backend, which is not being changed** | It cannot fail for any Part B change, so it is a pure baseline assertion, not a fix assertion. Useful as a guard against accidental backend edits; score it as such. | Fine, label it "unchanged-behaviour guard". |
| **§B3.2 checks 3–4** no/garbage token → 401 | Same as above — backend unchanged. | Header path (`:12`) and verify path (`:21`) are genuinely distinct messages, so the assertions are real. | Keep as guards. |
| **§B3.2 check 5** `grep api.logout` → clean | **No** | A real static discriminator: if the Implementer deletes `api.logout` from `api.ts` but leaves a call site, it fails. | Keep. **Also grep `ka_token` and `localStorage`** — see R-8. |
| **§B3.2 check 6** `tsc --noEmit` in `web` | **Partially vacuous** | `npx tsc --noEmit` exits 0 on the **unmodified** repo today, so it passes without the fix. | It is a good *non-regression* guard but must not be presented as a fix assertion. The plan does not present it as one. OK. |
| **§B3.2 "AC1 by grep"** `grep -rn 'localStorage\|sessionStorage' web/src` → "exactly 2 lines, both inside `web/src/lib/api.ts`" | **WRONG + vacuous-by-definition** | Today the grep returns **4 lines** (header.tsx ×2, layout.tsx ×1, login-form.tsx ×1). After the plan's own authorised diff set (`api.ts`, `layout.tsx`, `header.tsx`, `login-form.tsx`, `login/page.tsx`), the count is **1 line** (the `localStorage.getItem` in `api.ts`) — **not 2**. And under the *current* §7 file-touch table, `header.tsx:11` and `:14-18` are not named as violations, so the Implementer will leave them and the grep will return 2 lines **one of which is a direct render-time token read** — i.e. **the test passes while the AC is violated**. | Define the grep with a **positive and negative** pattern: `grep -rn 'ka_token' web/src` must return **exactly one file, `web/src/lib/api.ts`**, and `grep -rn 'localStorage' web/src \| grep -v 'lib/api.ts'` must be **empty**. See R-8. |
| **§B3.1 steps 1–10** browser checklist | **Partly vacuous — and not executable by CI** | Step 4 (hard reload carries `Authorization`) is the only test that proves AC2, and it is a **human** step with no automation: it can be "verified" by a person watching the Network tab, which is exactly the kind of evidence that produced the REQUEST's own wrong "verified: 1 result". Steps 5, 7, 9 a human most easily passes by accident (see PLAN:753's own admission). | **Replacement required** — see R-9: a Node script that drives the real `api.ts` module through a jsdom-style `localStorage` + reassessment after a simulated module reload, **or** (fallback) a documented "module-reload harness" that `delete`s the module from `require.cache` and re-imports it. The point is: **no browser required**, and the assertion is `hydrateToken()` reconstructs a token that the server accepts (401→200), not "the person saw a header". |
| **§B3.1 step 5** library/audit hard reload → 400, "no 401" | **No** (as a *negative* assertion) | It asserts the **absence** of a 401, which is a real regression signal: today after a hard reload these pages 401; after the fix they must 400. **This is the only test in the plan that distinguishes "hydrated" from "not hydrated" on a real page.** | **Keep this, and promote it** — it is the single most convincing Part B test the plan has, because it depends on hydration end-to-end and its two states (401 vs 400) are unambiguous. See "Single most convincing test" below. |
| **§B3.1 step 7** expired token → 401 → cleared → `/login` | **No**, *if* the forge is correct | Forging an expired token with the real secret and confirming `exp-now < 0` is a sound, non-guessable technique. The combination "401 observed **once**", "`ka_token` removed", "URL `/login`", "form renders" is genuinely discriminating. | Keep. **Fix**: the plan never asserts that the **`ka:logout` event listener** is what performed the redirect (vs. the layout's own `replace` on the next render). Add an assertion that the redirect happens **without a React re-render**, or (simpler) unit-test that `clearSession()` dispatches `ka:logout`. |
| **§B3.1 step 10** redirect-loop counter | **No**, but manual | A navigation counter is the right shape. | Promote to the same Node harness as R-9 if feasible; otherwise accept as human and label it "MANUAL, one-time". |
| **§B3.3 expired-token forge** | **No** | Reading the secret from `.env` into an env var, never argv, never echoed, and proving `exp < now` locally is exactly right, and the "do not echo the token" discipline is respected. | Keep verbatim. **One gap**: the plan notes `config/index.ts:10` falls back to `dev-only-change-me` if `JWT_SECRET` is unset, and marks that as `BLOCKED` — good — but the sibling risk (an `ADMIN_PASSWORD` in `.env` that differs from `admin123`) is only flagged as R7 "operator confirms"; §B3.2 check 1's `curl` hardcodes `admin123`. If `ADMIN_PASSWORD` is set, **every** Part A and Part B test that logs in fails *for a non-product reason*, and the plan has no fallback. | See R-18. |

---

## PART B: THE SINGLE MOST CONVINCING TEST

**Test:** `§B3.1 step 4` — *"Hard reload (Ctrl+F5) on `/dashboard/retrieve`; every request to `:4000` carries `Authorization`; no 401 anywhere; the page renders"* — **reduced to its discriminating core, which is the plan's §B3.1 step 5**.

Why it is the most convincing: it is the only assertion in the plan that distinguishes **hydrated** from **not-hydrated** on a real consumer page, and the two states are **unambiguous and already-known**:

| State | `/dashboard/library` after hard reload | Meaning |
|---|---|---|
| **Bug present** (no hydration) | `api.search({q:""})` goes out with **no** `Authorization` → backend `middleware/auth.ts:10-14` → **401** → `request()` throws `Error("Unauthorized")` (`api.ts:29-33`) → page renders **"Unauthorized"** in red. | Token was not rehydrated before the first API call. |
| **Fix present** (hydration) | `hydrateToken()` installs the persisted token → `api.search({q:""})` carries `Authorization` → `search.ts:27-30` → **400 `q (query string) is required`** → page renders that **specific** error text. | Token was rehydrated **before** the first API call. |

The page therefore prints the token-hydration verdict **as text**, with no DevTools, no Network panel, and no human judgement. "No 401" + "the string `q (query string) is required` appears" is a two-sided assertion (positive: hydrated; negative: no unauthenticated request) that **cannot** be passed by a broken implementation. It is strictly better than step 4 because step 4's "every request carries `Authorization`" is invisible on a screenshot and easy to misread, whereas step 5's output is DOM text.

**Caveat that makes this test Part-A-dependent (and therefore R-1-dependent):** this exact discrimination only exists **because** `q:""` returns a 400. If the lexeme-less/empty-`q` decision ever becomes `results: []`, this test loses its positive signal (the page would render "No documents ingested yet", indistinguishable from a healthy empty library). **That is the strongest argument for keeping `q:""` → 400**, and the plan is right about it (PLAN:214) — it is the *second* 400 class that is wrong (R-1).

**Can the available browser tooling execute it?**
- **`web/package.json` has NO end-to-end tooling** — no Playwright, no Puppeteer, no Cypress, no jsdom, no `@testing-library/*`. Its only scripts are `dev`/`build`/`start`/`lint`. `next build` is explicitly **not required** by AC11.
- **`server/package.json`** has `tsx` (dev) and `jsonwebtoken`, **but** no Playwright/Puppeteer either. The `playwright` strings my grep found under `server/node_modules/{jszip,typescript}/package.json` are **peer/dev hints inside third-party manifests**, not installed packages — `npx playwright` would have to download a browser.
- **Conclusion: a real headless browser is NOT available** without a network install, and installing one is out of scope (`REQUEST.md:60` forbids new deps in `web`; nothing authorises adding a dep to `server`).
- **Fallback level: XHR-equivalent, NOT curl-only.** Concretely, a Node script (using only `tsx`/`node` + the already-installed `jsonwebtoken`/`node-fetch`/global `fetch`) that:
  1. seeds a fake `global.localStorage` (a 5-line Map shim);
  2. performs a **real login** via `api.auth.login`, which exercises `setToken` → the localStorage write;
  3. **simulates the hard reload** by clearing the module from `require.cache` (or `import()` with a cache-busting query) and re-importing `lib/api.ts` so the in-memory `token` is `null` again — *this is the exact bug condition*;
  4. asserts `getToken() === null` **before** hydration (proves the module really reloaded), then calls `hydrateToken()` and asserts `getToken()` is the persisted value **and** a subsequent `api.search({q:"x"})` returns **200**, not 401.
  
  That is the XHR-equivalent level: it drives the **real module**, the **real fetch path**, the **real backend**, and the **real hydration code** — everything except the React render. It is strictly stronger than curl-only (which cannot see `api.ts` at all) and needs no browser. **The plan must specify it** (currently it specifies nothing below browser level — R-9).

---

## OQ-1 .. OQ-7 RULINGS

| OQ | Ruling | Reason |
|---|---|---|
| **OQ-1** — accept "no index change" on structural grounds, given no meaningful `EXPLAIN` while `public.chunks` is empty? | **YES, ACCEPT.** No index change in this phase. | The index expression (`schema.ts:30-31`) is `to_tsvector('english', text)` and the new predicate is `to_tsvector('english', c.text) @@ websearch_to_tsquery('english',$2)` — the same expression, so the existing GIN index is index-usable by construction; **no new index is needed for correctness**. AC9 requires "index changes **only if justified by measured EXPLAIN evidence**" — and no measurement is possible at 0 rows, so AC9 is satisfied by *not* changing. **Binding condition:** T-A9's EXPLAIN must be recorded as *evidence*, and its decision rule must be made **falsifiable**: on the seeded `p2test` fixture INSERT 10 000 synthetic chunks (not 9), then `EXPLAIN (ANALYZE, BUFFERS)`; **if `Bitmap Index Scan on chunks_fts_idx` appears → record; if `Seq Scan` appears AND `runtime > 200 ms` → record as OQ-1 follow-up, still no index in this phase** (the fix is correctness, not performance; a performance index remains a separate, separately-approved change). |
| **OQ-2** — is `q="-vpn"` returning every lexeme-bearing chunk acceptable, or should it be a 400? | **ACCEPT the behaviour. Do NOT return 400. Pin it.** | It is the documented, correct semantics of a negated-only `tsquery` (matches every chunk with a non-empty tsvector, excludes stopword-only chunks) — measured by the plan in `probe_edge.sql:22-25`. It is **not** "returns everything regardless of query" and it is a **strict improvement** on today (which returns everything including stopword-only chunks). A 400 would require a *second* inspection of the parsed query for a positive lexeme — extra complexity and a new 400 class to defend, for a query form nobody types. Add it to the documented multi-word rule and pin it **as a documented behaviour, not as an AC-passing assertion** (T-A5's `-vpn → 200` stays, labelled "edge-case pin"). |
| **OQ-3** — add an explicit `q` length cap (e.g. 4 096 → 400)? | **NO cap in this phase.** | `app.ts:33` already caps the JSON body at 1 MB, and `websearch_to_tsquery` is linear and cannot raise. A cap is a **new contract** (a third 400 class) with no correctness justification, and every new 400 class is a new way to break a consumer. Record as **FU-NEW-1** ("input length cap for `q`"), out of scope. **But** do add one *no-code-change* guard to T-A6: send a **100 k-char** `q` and assert **200, not 500, and response time < 2 s** — proving the body cap is the only limit needed. |
| **OQ-4** — create `web/src/app/login/page.tsx`, or repoint both redirects to `/`? | **CREATE `web/src/app/login/page.tsx`.** Approve the plan's choice. | `web/src/app/login/` currently contains **no files** (verified: glob `*.tsx` → 0 results). Both redirect sites already say `/login` (`layout.tsx:17`, `header.tsx:42`). Creating the page makes the **existing** code's intent true, touches **no** baseline file for routing, and leaves `/` exactly as it is (AC8 "login behaviour preserved" — `/` still renders the form, `app/page.tsx:3-5`). Repointing to `/` would instead change two baseline files (`layout.tsx`, `header.tsx`) for a **worse** semantic (no route distinct from the landing page) and would make the "missing token → login route that actually exists" **AC4** indistinguishable from "missing token → marketing page". The new file must be added to `baseline.sha256` **after** implementation (it is not in it now — see R-15). |
| **OQ-5** — client-side `exp` pre-check before the first request? | **NO pre-check. "Let the 401 drive it."** | The server is authoritative (`middleware/auth.ts:17`); a client-side `exp` read is a **UX nicety, not a control**, and it would introduce a **second JWT parser** in the client when `header.tsx:14-18` already does an ad-hoc `atob` decode that the plan rightly leaves alone (FU-4). Keeping exactly one parser and one 401 path is simpler and has fewer states. **Binding condition:** the 401 path must `clearSession()` **and** dispatch `ka:logout` **and** be idempotent (no double-dispatch, no redirect storm) — that is what R-10/R-11 pin. Record as **FU-NEW-2** ("client-side exp pre-check"), out of scope. |
| **OQ-6** — leave `res.json({limit: results.length})` alone? | **YES — do NOT change it in this phase.** | `search.ts:66` returns `limit: results.length`. Changing it is a one-line contract change but AC7 ("response shape backward-compatible") is written around the *current* shape, and the Retrieve/Chat pages (`retrieve/page.tsx:72` renders `Results ({res.length})`; `chat/page.tsx:59` renders `Knowledge context ({ctx.length})`) read only `results`, so **nothing** depends on `limit` being the requested value. Leave it; **FU-2** remains open. Any test that asserts `limit == 10` must assert it against `results.length`, **not** against the request — the plan's T-A1 `.limit==0` is correct. |
| **OQ-7** — rebuild `dist/**` after changing `search.ts`, or is `npx tsx src/index.ts` the only supported run path? | **`npx tsx src/index.ts` is the ONLY supported run path for this phase. `dist/**` is left untouched. But this must become a hard gate in the harness.** | `server/package.json:9` `npm start` → `node dist/index.js`; `dist/**` is **not** in `baseline.sha256`, so a stale `dist` is both invisible to the hash check **and** a silent way to test the *old* code. The harness must (a) start with `npx tsx src/index.ts`, **(b) assert the running process is the tsx one** (e.g. `/api/health` is fine, but the harness must `ps`-check for `tsx` or, simpler, assert the new behaviour: `q=zzzznotfound` → 0 results **is** the proof the new code is live, which T-A1 already gives), and **(c) record a note in TEST-REPORT.md**: "`npm start` (dist) is stale and will serve the pre-fix search until a separate, approved rebuild." Do **not** rebuild `dist` — it is not a baseline member and rebuilding it silently changes shipped behaviour outside the phase's audit surface. |

---

## REQUIRED REVISIONS

Numbered, apply in order. Part A: **1–7**. Part B: **8–14**. Cross-cutting: **15–18**.

### Part A

**1. Remove the second 400 class; keep exactly ONE 400 message.**
- Delete the `q contains no searchable terms` branch (§A2.3 step 2, §A2.4 row 2, T-A5's third assertion).
- The only guard is: `if (typeof q !== 'string' || !q.trim()) → 400 { error: 'q (query string) is required' }`. This keeps the **exact** today message for every empty/blank/non-string case, which is what AC4 and AC7 ask for.
- A lexeme-less non-blank `q` (e.g. `"the and or"`, `"!!!"`, `"-"`) must then reach the SQL and return **200 with `results: []`** — because the empty tsquery matches nothing (measured: `probe_current_vs_fixed.sql` L62-65 → 0 rows). **`results: []` for a lexeme-less query is NOT "the whole library" and NOT a masked error** (AC8 concern) — it is the honest answer "your query has no searchable terms" expressed in the result set the caller already understands. Justify it in the plan, and **pin it in T-A5** as `200 + []`.
- Rationale the plan must record: a second 400 class is a new contract string that **no** AC asks for, and it is the single highest-risk consumer regression in the phase (any caller that passes a whitespace-only or punctuation-only query — including the two Library/Audit pages *today* if `q` were ever non-empty-but-lexeme-less — starts erroring).
- If the implementer believes a lexeme-less 400 is essential, it must be raised as an **OQ for this reviewer** with a named consumer that benefits; it is **not** approvable as written.

**2. Drop the extra round trip; evaluate the guard in the same statement.**
- Replace §A2.3's `pool.query(SELECT websearch_to_tsquery(...)::text)` pre-probe with **one** query, using a `WITH` CTE that the planner can inline:
  ```sql
  WITH q AS (SELECT websearch_to_tsquery('english', $2) AS tsq)
  SELECT ... FROM chunks c JOIN documents d ON d.id = c.document_id, q
  WHERE (d.access_policy = $1 OR $1 = '*')
    AND to_tsvector('english', c.text) @@ q.tsq
  ORDER BY ts_rank(to_tsvector('english', c.text), q.tsq) DESC, d.id ASC, c.start_char ASC NULLS LAST, c.id ASC
  LIMIT $3
  ```
- **Constraint:** after implementing, T-A9's EXPLAIN **must** confirm the plan still shows `Bitmap Index Scan on chunks_fts_idx` (or a Seq Scan on a tiny fixture). If the CTE form stops the index being used on the 10 000-row fixture, **fall back to the two-round-trip form** and record the measured reason. This is the only acceptable reason to accept the extra query.
- If revision 1 is applied, **there is no lexeme-less 400 left**, and the CTE's only job is to avoid computing `websearch_to_tsquery` twice. That is still worth doing, but it becomes **optional** — mark it "optional micro-optimisation, not correctness" if it complicates the diff. Prefer the simplest correct diff.

**3. Make T-A3 discriminate; the fixture must break the `document_id`-sort correlation.**
- Add a **third matching document** to the fixture whose `name`/`id` sorts **after** `p2-doc-main` (e.g. `p2-doc-zulu` with a chunk `The pager alert procedure is documented here.`), and change the T-A3 query to one where the **highest `ts_rank` chunk belongs to the lexicographically last document**.
- T-A3 must then assert **both**:
  1. `results[0].chunk_id` equals the SQL's first `c.id` for the same `q` (element-for-element sequence equality — the plan already writes this at PLAN:401; keep it), **and**
  2. a **mutation check**: run the same `q` through a deliberately rank-less SQL (`ORDER BY d.id ASC, c.id ASC` only) and assert the HTTP order **differs** from it. If the two orders are identical, the fixture cannot distinguish rank from tiebreak → **BLOCKED, not PASS**.
- Delete the bare `[.results[].document_id] == sort(...)` assertion as a *rank* proof; re-label it as a **tiebreaker** proof only.

**4. Make T-A2 assert *set equality*, not cardinality.**
- Replace `[.results[].text] | length == 3` with: fetch the expected matching `chunk_id` set from SQL (the same predicate, same policy) and assert `([.results[].chunk_id] | sort) == (expected | sort)` **and** `results.length == expected.length`. Cardinality alone can pass under the bug if the fixture ever grows past `limit`.

**5. Make T-A9's EXPLAIN decision rule falsifiable.**
- The fixture for the EXPLAIN step must be **≥ 10 000 chunks** (the plan's §A3.2 fixture is 9), seeded **inside `p2test` only**.
- The rule must name **all three** outcomes: `Bitmap Index Scan on chunks_fts_idx` → PASS, record; `Seq Scan` + `runtime < 200 ms` → record, PASS (small fixture, decide nothing); `Seq Scan` + `runtime ≥ 200 ms` → **record as a new follow-up (FU-PERF-1) and PASS** (no index in this phase, per OQ-1). As written (PLAN:480) the rule has no action for the `Seq Scan` case.

**6. Reclassify the page-level checks in T-A8 honestly.**
- State plainly: *"Library and Audit render the 400 error text **both today and after the fix** — this assertion pins FU-1 and is **not** an assertion of the fix."* Remove the sentence claiming the pages "show the 400 error text they show today" from the AC7 justification, because it was never a fix-induced change. (It is a correct *pin*, just not evidence.)
- Add the missing companion assertion: `q='zzzznotfound', policy='*'` → `results.length == 0` on the **seeded** fixture (composes AC1 with AC6).

**7. Document the `p2test` admin side effect.**
- `db/index.ts:22-34` creates the default admin **in whatever `search_path` is current**, so running the server against `p2test` will create `p2test.admins` (and log `default admin created`). §A3.1 must state this, and §A3.5's cleanup assertions must add `SELECT count(*) FROM p2test.admins` **before** the drop (expected 1, proving it was the scratch admin) and must **not** touch `public.admins` (expected 1, unchanged).

### Part B

**8. Fix the false claim and the missing file-touch entry for `header.tsx`; make the AC1 grep two-sided.**
- §B2.2's claim "`library/page.tsx`'s and `audit/page.tsx`'s mount-time `api.search` **cannot** fire early" is **correct** (the layout gates `{children}`). **But** the wider AC1 claim — "nothing outside `api.ts` touches `localStorage["ka_token"]`" — is **false today** because `header.tsx:11` does exactly that, and §7's table does not name it as a required change.
- **Required:** `web/src/app/dashboard/header.tsx` must have **both** `localStorage` call sites removed:
  - `:11` `localStorage.getItem("ka_token")` → `getToken()` from `@/lib/api`, and the username decode/render must be **driven by the layout's hydration** (i.e. `Header` renders the username only after `getToken()` is non-null — no independent `useEffect` localStorage read);
  - `:41` `localStorage.removeItem("ka_token")` → `clearSession()`.
- **Required:** replace the §B3.2 "AC1 by grep" with two assertions:
  ```
  grep -rn 'localStorage' web/src | grep -v 'web/src/lib/api.ts'      # MUST be empty
  grep -rln 'ka_token'   web/src                                     # MUST be exactly web/src/lib/api.ts
  ```
  (The plan's "exactly 2 lines, both inside `api.ts`" is wrong in both directions: today 4 lines, after a *correct* fix **1** line.)

**9. Replace the browser-only manual checklist with an executable, browser-free harness — and keep §B3.1 step 5 as the DOM-level confirmation.**
- Add `web/scripts/f2b-hydration.mjs` (or `.ts`, run with `npx tsx` from the repo — **no new dependency**: Node 18+ global `fetch`; a 10-line `localStorage` shim assigned to `globalThis`).
- It must implement the **XHR-equivalent** level defined above: real login → truthy `getToken()` → **drop the module from cache and re-import** `lib/api.ts` (proves in-memory `token === null` again, i.e. the reload condition) → `hydrateToken()` → assert `getToken()` equals the persisted value → `api.search({q:"x"})` returns **200** (not 401).
- It must also cover: `clearSession()` on a fresh module → `getToken() === null` **and** `localStorage` empty; a 401 injected (call a protected endpoint with the token removed) → `ka:logout` dispatched **exactly once** (`addEventListener` counter) and `localStorage` cleared.
- §B3.1 step 5 stays in the plan **as the one human confirmation** that the DOM-level page renders the **400** text and not `Unauthorized`; it is no longer the *sole* evidence for AC2/AC3.
- **Honesty requirement:** TEST-REPORT.md must state the **fallback level used** (XHR-equivalent, browser unavailable) and must **not** claim a browser test was run if it was not.

**10. Pin `hydrateToken`'s ordering and idempotence in a test, not in prose.**
- Assert (in the §9 harness): calling `hydrateToken()` **twice** is a no-op the second time (the `hydrated` one-shot flag holds); calling it **after** `setToken(x)` does **not** overwrite `x` with a stale localStorage value; and `clearSession()` sets `hydrated = true` so a later `hydrateToken()` **cannot resurrect** the token. Each of the three is a distinct way the fix could be wrong and the plan currently asserts none of them.

**11. Assert the `ka:logout` **mechanism**, not just the outcome.**
- The layout's `ka:logout` listener must be tested *separately* from the layout's own "no token → replace" path. Add: dispatch `new Event("ka:logout")` on `window` **while a valid token is still in memory**, and assert the navigation to `/login` happens; then assert that `api.ts` dispatches it **exactly once** per 401 (not once per failing request in a burst — a `library` + `audit` double-401 must not fire two events / two redirects).

**12. Re-word the `Header` username risk as a testable assertion.**
- AC: after a hard reload with an **expired** token, the header must **not** render `admin` (or any username) before the redirect to `/login`. Add to §B3.1 step 7: *"assert the username text is never rendered; the redirect happens before any username appears."* And add to the §9 harness: a first-paint check is not possible without a renderer, so this one stays **MANUAL** — label it so.

**13. State explicitly which Part B ACs are proven by which test, and flag the two that are not automatable.**
- AC10 (cookie-vs-localStorage trade-off) is **documentation only** — no test can prove it; the plan must say "AC10 is satisfied by §B2.6 of this plan, verified by reviewer reading, no test". AC8 (login behaviour preserved: same creds, same redirect target) is currently only implicitly covered by §B3.1 steps 2 and 8 — add an explicit assertion that login still lands on `/dashboard` and that the demo credentials still work.

**14. Correct §B1.2 step 1's claim about `router.refresh()` and record the actual post-login sequence.**
- `login-form.tsx:24-25` calls `router.push("/dashboard")` then `router.refresh()`. The plan's §B2.3 row 3 argues the layout's `getToken()` is truthy at that instant because `setToken` ran at `:20`. That is **true**, but it silently depends on `setToken` **also** writing `localStorage` (the plan moves the write into `setToken` at §B2.4). Make that dependency explicit in the file-touch table: **`login-form.tsx:23`'s `localStorage.setItem` must be deleted, and `setToken` in `api.ts` must own the write** — otherwise `hydrateToken` on the next reload installs a stale/absent value. The plan says this (PLAN:864) but does not put it in the test set: add an assertion that after login, `localStorage.getItem("ka_token") === getToken()`.

### Cross-cutting

**15. Add the new file to the baseline after implementation.**
- `baseline.sha256` (35 entries) does **not** contain `web/src/app/login/page.tsx` (does not exist yet). The §7 table correctly lists it as "NEW". The phase must append its sha256 **after** creation and re-run `sha256sum -c` on the whole file, requiring `: OK` for every original line and one new line for the page. As written, a reviewer running `sha256sum -c` after implementation will get **`FAILED open or read`** on the original file list only if the file is *removed*, not if it is *added* — so the gap is silent. Add an explicit "new-file hashes appended" step to the RESULT/TEST-REPORT deliverables.

**16. State the `p2test` admin creation (see R-7) in both parts' cleanup, and add `p2test.admins` to the pre-drop record.**

**17. Make the "which server binary is running" gate explicit (OQ-7).**
- Add to §A3.4 and §B3.1's preconditions: *"the backend MUST be started with `npx tsx src/index.ts`. `npm start` runs the stale, un-baselined `dist/index.js` and would silently test pre-fix code. Evidence that the live code is the fixed code = T-A1 returning 0 for `zzzznotfound` on the seeded fixture."* No `dist` rebuild in this phase.

**18. Add a credential-preflight assertion, with a non-guessing fallback.**
- Before any Part A or Part B test, `curl /api/auth/login` with `admin/admin123` and assert `200` + a token. If it is **401**, the plan's R7 says "operator confirms, otherwise BLOCKED, never guess" — **keep that**, but make it a **single preflight step with a clear BLOCKED report** rather than discovering it mid-suite. Do **not** attempt any alternative password; report `BLOCKED: demo credentials rejected; ADMIN_PASSWORD may be overridden in server/.env`.

---

## NON_BLOCKING FINDINGS

| # | Finding | Where | Note |
|---|---|---|---|
| NB-1 | The new `q contains no searchable terms` 400 is a third status class the phase does not need (see R-1). | §A2.3, §A2.4 | If R-1 is applied, this disappears. |
| NB-2 | `.env`'s `ADMIN_PASSWORD` may differ from `admin123`; the plan's tests hardcode it. | §A3.4, §B3.2 | R-18 covers it. |
| NB-3 | `middleware/error.ts:7` `errorHandler` has **3** parameters — Express requires **4** to treat it as an error handler, so it is **not** a safety net. Do **not** touch it in this phase; **do** keep `search.ts`'s `try/catch` intact. | `error.ts`, `search.ts:67-69` | Out of scope; recorded so it is not "cleaned up" later without a phase. |
| NB-4 | `express-rate-limit` is 100 req/min on `/api` (`app.ts:35-41`); Part A's T-A5/T-A6 loops plus T-A7/T-A8 can exceed it and produce **429**, which the plan's R6 correctly says is "not a product failure" — keep that wording, and make the harness `sleep 1` between the T-A5 and T-A6 blocks. | `app.ts`, §A3 | Not a blocker. |
| NB-5 | `header.tsx`'s `atob` decode with `|| "admin"` fallback is preserved as FU-4; it is display-only, so fine — **but** after R-8 it must read `getToken()` and only render **after** hydration, so the header cannot show a username from a token the app has not installed. | §B2.4 | R-8/R-12. |
| NB-6 | The plan's §A2.2 ties `to_tsvector` twice per row (predicate + ORDER BY). PG may fold it; not worth changing (a materialised tsvector column is a schema change, AC9). | §A2.2, R8 | Accept. |
| NB-7 | T-A10's upload assertion `.results\|length==1` is the **ingest** contract (`ingest.ts:238`, `types.ts:72-91`), not the search contract. Label it so no future reader confuses the shapes. | §A3.3 | Cosmetic but worth one line. |
| NB-8 | §A3.2 says fixtures are "created with the real ingestion path where possible" — but the real chunker (`chunker.ts:54`) returns `[]` for texts with `tokens.length === 0` **and for short texts** `tokens.length < minWords` is **not** dropped (the `minWords` field is declared but never enforced in `splitIntoChunks` — verified, no `minWords` use inside the function). So a short fixture uploaded through the real path **will** produce a chunk. That is fine, but the plan's parenthetical "(b) `... --- !!!` cannot be uploaded as a *file* whose parsed text is exactly that" is **wrong** — it *can* be uploaded; the chunker would keep it as a chunk with an empty tsvector. This does not change the fixture design (direct INSERT is still simpler and exact), but the stated *reason* is false and should be corrected to "we need three specific chunk boundaries in one document". | `chunker.ts:47-91`, §A3.2 | Cosmetic. |
| NB-9 | `probe_explain.sql:18-19` uses `d.access_policy='*'` in the WHERE — a **literal `'*'` compared to a policy column** that never contains `'*'`, so that probe returns nothing; the planner was using it only for plan shape. Not a correctness issue for the plan, but the probe is misleading as evidence. | `probe_explain.sql` | Record "probe shape-only". |
| NB-10 | `probe_fts.sql:8` and `:22` use `d.access_policy = '*'` against a temp table, which is the same literal-vs-column confusion — harmless for a shape probe. | `probe_fts.sql` | Same as above. |

---

## SCOPE CHECK

| REQUEST restriction | Plan compliance | Verdict |
|---|---|---|
| F2-A: no semantic/vector search, LLM, fuzzy/trigram, synonyms | Plan §A2.5 rejects `plainto`/`to_tsquery`/`phraseto`; adds no extension; §5 lists all as out of scope | **OK** |
| F2-A: no Library/Audit rewiring | FU-1 recorded; pages untouched | **OK** (but see R-6: the plan must stop presenting the *new* 400 class as the pages' intended state) |
| F2-A: no schema changes / no migration unless justified | §A2.8 no index change; `schema.ts` untouched; T-A9 hash check | **OK** |
| F2-A: `ts_headline` optional, must not change response schema | Not added | **OK** |
| F2-B: no routing redesign | One new page (`login/page.tsx`), approved under OQ-4 | **OK** |
| F2-B: no new pages "beyond what is strictly needed" | `login/page.tsx` is strictly needed for AC4 | **OK** |
| F2-B: no refresh-token architecture, no server revocation, no same-origin proxy | §7 leaves `server/src/**` untouched by Part B; §B2.5 justifies deleting `api.logout` instead of adding an endpoint | **OK** |
| F2-B: no new auth dependency; no weakening of JWT validation | No dep; `authMiddleware` untouched | **OK** |
| F2-B: no password policy / admin mgmt | Untouched | **OK** |
| Global: no Chat/LLM, no Audit redesign, no Library redesign, no ingestion features, no blob GC, no broad cleanup, no unrelated security refactoring | Plan §5/FU list matches | **OK** |
| Data safety: never truncate/reset; don't touch `f1test` | `p2test` scratch schema, `DROP SCHEMA` only, `f1test` never referenced | **OK — with the one gap in R-7/R-16 (`p2test.admins`)** |
| No secrets in logs/reports (redact) | §B3.3 reads the secret into an env var, never argv, never echoes the token, records only `len` and `exp-now` | **OK (strong)** |
| Deliverables list | `REQUEST`/`PLAN` present; `REVIEW` is this file; `IMPLEMENTATION`/`TEST-REPORT`/`RESULT`/`baseline.sha256` — baseline present (35 files), the rest are the Implementer's/Tester's to produce | **OK** |

**Scope violations found in the plan:**
- **V1 (Part A):** the plan introduces **two** new 400 classes (`whitespace-only`, `lexeme-less`) where AC4 asks for **one** decision about empty `q` and AC7 asks for **backward compatibility**. The lexeme-less 400 is scope creep on a status contract. → R-1.
- **V2 (Part A):** the plan's §A2.3 adds a **second round trip** per search purely to reach a UX decision that AC4 does not require. → R-2 (and moot once R-1 lands).
- **V3 (Part B):** `header.tsx` reads `localStorage` at render time and the plan both (a) leaves that read in place and (b) claims AC1 is satisfied. This is an *omission*, not creep — but it is the only scope-boundary defect that breaks a stated AC. → R-8.
- **V4 (neither):** `dist/**` is a non-baseline, committed artifact that runs under `npm start`. Neither part authorises changing it, and the plan correctly leaves it alone — **but** the plan must state that this makes `npm start` unusable for the phase (R-17). Leaving it *unstated* is the risk.

---

## TEST COVERAGE CHECK — every AC must name a proving test

### F2-A

| AC | Text (paraphrased) | Proving test named? | Verdict |
|---|---|---|---|
| AC1 | no lexical match → 0 results | **T-A1** (with the 9-row pre-fix gate) | **PROVEN** — the best-designed test in the plan |
| AC2 | matching query returns exactly the matching chunks, **rank asserted** | **T-A2** (set equality *after* R-4) + **T-A3** (ordering — *vacuous as specified, fixed by R-3*) | **PROVEN only after R-3 and R-4** |
| AC3 | multi-word rule documented and enforced | **T-A4** (a) AND, (b) phrase, (c) OR, (d) negation | **PROVEN** |
| AC4 | empty/whitespace → safe, never 500/all-chunks | **T-A5** (400 for `""`/`"   "`); lexeme-less after R-1 becomes `200 + []` | **PROVEN after R-1** (currently proves too much, the wrong thing) |
| AC5 | malformed input → no SQL error, no 500; parameterised SQL only | **T-A6** (11 hostile strings + `limit` torture + `-vpn` pin) | **PROVEN** |
| AC6 | access policy not weakened | **T-A7** (5 assertions + the ∀-invariant) | **PROVEN** |
| AC7 | response shape backward-compatible | **T-A8** (keys, 8 element keys, types) | **PROVEN** (the page-level part is a pin, not a proof — R-6) |
| AC8 | empty `q` must not silently return the whole library | **T-A5** (`""` → 400) + FU-1 pin | **PROVEN for the `q:""` sense**; the *spirit* ("nor silently return nothing" — PLAN:214) is a judgement call, not a test, and is fine |
| AC9 | index changes only if justified by measured EXPLAIN; no unrelated schema changes | **T-A9** (hashes + `pg_indexes` set + EXPLAIN) | **PROVEN after R-5** (decision rule currently unfalsifiable) |
| AC10 | `tsc --noEmit` exit 0; Phase 1 upload + F1 ingestion unaffected | **T-A10** | **PROVEN** |

### F2-B

| AC | Text (paraphrased) | Proving test named? | Verdict |
|---|---|---|---|
| AC1 | one source of truth; no path may read `localStorage` for auth decisions outside it | **§B3.2 "AC1 by grep"** | **NOT PROVEN — the grep as written passes while `header.tsx:11` still reads localStorage** (R-8) |
| AC2 | after a full reload of any `/dashboard/*`, protected requests succeed (token rehydrated before first API call) | **§B3.1 step 4** (manual, browser) — **no automated test** | **NOT PROVEN by an executable test** (R-9) |
| AC3 | no protected request before rehydration completes; hydration gate not a race | **§B3.1 step 4/5** (manual) + the prose argument in §B2.2 | **NOT PROVEN by an executable test** (R-9); also the §B2.2 claim is partly false (R-8) |
| AC4 | missing token → login route that exists; no infinite loop | **§B3.1 step 10** (manual navigation counter) + `login/page.tsx` existence | **PROVEN only manually** (R-9/R-12) |
| AC5 | expired/invalid → 401 clears persisted state and returns to login | **§B3.1 step 7** (manual, forged expired token) + **§B3.3** forge | **PROVEN manually; not in an executable test** (R-9/R-11) |
| AC6 | logout clears both stores; reload after logout does not restore | **§B3.1 step 9** (manual) | **PROVEN manually** (R-9); needs the `header.tsx` change from R-8 to be true at all |
| AC7 | `/api/auth/logout` exists if called, or the client stops calling it (justified) | **§B3.2 check 5** (`grep api.logout` → clean) + PLAN:700-712 justification | **PROVEN** — static, mechanical, honest |
| AC8 | login behaviour preserved (same creds, same redirect target) | implicit in §B3.1 steps 2/8 | **WEAK — add explicit assertion** (R-13) |
| AC9 | no new auth dep; no weakening of JWT validation / `authMiddleware` | `baseline.sha256:2,4` (`auth.ts`, `middleware/auth.ts` must hash `: OK`) | **PROVEN** (mechanical) — but the plan does not say so explicitly; add it to §B3.2 |
| AC10 | localStorage-vs-cookie trade-off documented, not silently changed | §B2.6 (documentation) | **PROVEN by reviewer reading** — no test possible; the plan should say so (R-13) |
| AC11 | `web` builds/typechecks; `next build` not required; do not break `next dev` | **§B3.2 check 6** (`tsc --noEmit` exit 0) | **PROVEN** as a non-regression guard |

**ACs with NO proving test at all (before applying the revisions):** **F2-B AC1, AC2, AC3, AC4, AC5, AC6.** That is **six of eleven** Part B ACs resting on a human eyeballing the Network tab. This is the single largest coverage defect in the plan and the reason Part B cannot be approved. (F2-A has **all ten** ACs named, which is the strongest part of the plan.)

---

## EVIDENCE

**Files read in full (line-exact assertions above depend on them):**

| File | Key lines I verified |
|---|---|
| `server/src/routes/search.ts` (73 lines) | `:27-30` guard (`!q \|\| typeof q !== 'string'`, message `q (query string) is required`); `:34-53` SELECT with **no `@@`**; `:45` `WHERE d.access_policy = $1 OR $1 = '*'`; `:46-49` `ORDER BY ts_rank(...) DESC` only; `:66` `{ query, limit: results.length, results }`; `:67-69` catch → 500 |
| `server/src/db/schema.ts` (64 lines) | `:30-31` `chunks_fts_idx … USING GIN (to_tsvector('english', text))`; `:22` FK `ON DELETE CASCADE`; `:3` `CREATE EXTENSION IF NOT EXISTS "pgcrypto"` (unqualified → lands in `search_path` schema) |
| `server/src/middleware/auth.ts` (23 lines) | `:12` `Missing or invalid bearer token`; `:21` `Invalid or expired token`; `:17` `jwt.verify(token, config.JWT_SECRET!)` |
| `server/src/routes/auth.ts` (35 lines) | `:27` `expiresIn: '12h'`; `:28` `{ token, user }`; **no logout route** |
| `server/src/app.ts` (63 lines) | `:19-24` CORS allowlist `localhost:3000`/`127.0.0.1:3000`, `Authorization` allowed, origin echoed; `:33` `express.json({limit:'1mb'})`; `:41` rate limit 100/min; `:51` `/api/auth` only; `:54` `/api/search` behind `authMiddleware` |
| `server/src/middleware/error.ts` (10 lines) | `:7` `errorHandler(err, _req, res)` — **3 params**, not a real Express error handler |
| `server/src/config/index.ts` (12 lines) | `:9-10` `ADMIN_PASSWORD ?? 'admin123'`, `JWT_SECRET ?? 'dev-only-change-me'` |
| `server/src/db/index.ts` (35 lines) | `:22-34` `ensureDefaultAdmin` inserts into the **current `search_path`'s** `admins` |
| `server/src/routes/ingest.ts` (relevant spans) | `:183` `let accessPolicy: AccessPolicy = 'restricted'`; `:237-245` response `{ results, errors }`; `:238` 200; `:241-243` 207; `:245` 400 |
| `server/src/ingest/service.ts` (relevant spans) | `:127-145` content-addressed dedupe returns `documentId = contentHash` (**not a UUID**) with `chunkCount: 0` when the blob exists — so a repeated fixture upload quarantines the fixture; `:261-264` plain `INSERT INTO documents` (no `ON CONFLICT`); `:283-285` chunks inserted with `page_no/start_char/end_char = NULL` |
| `server/src/ingest/chunker.ts` (109 lines) | `:52-54` empty input → `[]`; **`minWords` is declared at `:34` and never used inside `splitIntoChunks`** (so a 3-word upload still produces one chunk) |
| `server/src/ingest/types.ts` (116 lines) | `:72-91` `IngestionResult` shape (the upload response contract) |
| `server/package.json` | `:9` `"start": "node dist/index.js"`; `:10` `"dev": "tsx src/index.ts"`; **no Playwright/Puppeteer** |
| `server/tsconfig.json` | `:18` `"exclude": [..., "**/*.test.ts"]` → a `.test.ts` **must** use `tsx`, not `npm start` (reinforces OQ-7) |
| `web/src/lib/api.ts` (87 lines) | `:3` module `token`; `:9-11` `setToken` (in-memory only); `:15-17` header attach; `:29-33` 401 → `token=null`, `setToken(null)`, throw `Unauthorized` — **no localStorage clear**; `:56-59` `api.logout` → `/auth/logout` with `.finally(setToken(null))`, **never called** |
| `web/src/app/dashboard/layout.tsx` (30 lines) | `:15-19` `useEffect` reads `localStorage.getItem("ka_token")` **only to decide redirect**, never installs it; `:26` renders `{children}` unconditionally |
| `web/src/app/dashboard/header.tsx` (50 lines) | **`:11` `localStorage.getItem("ka_token")` at mount**, `:14-18` `atob` decode, `:19-20` fallback `"admin"`; `:41` `localStorage.removeItem`; `:42` `router.push("/login")` |
| `web/src/app/page.tsx` (5 lines) | renders `<LoginForm />` at `/` — no gate, no redirect |
| `web/src/app/layout.tsx` (35 lines) | fonts + `globals.css` + `metadata` only — **no auth logic** (confirms PLAN:678) |
| `web/src/components/login-form.tsx` (90 lines) | `:10` default `admin`/`admin123`; `:20` `setToken(data.token)`; **`:23` `localStorage.setItem("ka_token", …)`**; `:24-25` `push("/dashboard")` + `refresh()`; `:83-86` demo-creds text |
| `web/src/app/dashboard/retrieve/page.tsx` (96 lines) | `:17` `if (!q.trim()) return;` — **the UI cannot send `q:""` from Retrieve**; `:20` `api.search({q: q.trim(), limit})`; `:72` renders `({res.length})` |
| `web/src/app/dashboard/chat/page.tsx` (94 lines) | `:16` `if (!q.trim()) return;`; `:19` `api.search({q: q.trim(), limit: 8})`; `:59` renders `({ctx.length})` |
| `web/src/app/dashboard/library/page.tsx` (96 lines) | **`:24` `api.search({q: "", limit: 100})` on mount**; `:44-47` catch → red error; `:52-58` empty-state text |
| `web/src/app/dashboard/audit/page.tsx` (57 lines) | **`:13` `api.search({q: "", limit: 200})` on mount**; `:19-22` catch → red error; `:27-29` empty-state text |
| `web/src/app/dashboard/inbox/page.tsx` (102 lines) | upload/watch only — unaffected by either part |
| `web/src/app/dashboard/sidebar.tsx` (42 lines) | Nav: **Inbox → `/dashboard`** (not `/dashboard/inbox`), Library, Retrieve, Chat, Audit — `:14` export, **reads no token** |
| `web/package.json` | scripts `dev`/`build`/`start`/`lint` only; **no test runner, no Playwright, no jsdom, no testing-library** |
| `.pipeline/p2/probe_fts.sql` (45 lines) | `:13-22` empty/spaces/stopword tsqueries; `:24-31` 11 hostile strings; `:33-41` plainto-vs-websearch on AND / phrase / `or` / `-` |
| `.pipeline/p2/probe_current_vs_fixed.sql` (65 lines) | `:18-24` CURRENT query for `zzzznotfound` (no predicate → all rows); `:34-38` FIXED → 0; `:62-65` empty tsquery → 0 rows |
| `.pipeline/p2/probe_edge.sql` (28 lines) | `:22-25` `'-vpn'` → `!'vpn'`, matches 4/4 (documented negation edge) |
| `.pipeline/p2/probe_explain.sql` (22 lines) | `:6-13` 200-row TEMP fixture; `:18-19` EXPLAIN of the predicate shape (note: `d.access_policy='*'` compares a column to a literal that is never its value — shape-only) |
| `.pipeline/p2/baseline.sha256` (35 lines) | `:1` `search.ts`, `:2` `routes/auth.ts`, `:4` `middleware/auth.ts`, `:6` `db/schema.ts`, `:22` `web/src/lib/api.ts`, `:23` `login-form.tsx`, `:26` `dashboard/layout.tsx`, `:27` `dashboard/header.tsx`, `:29-33` all five dashboard pages. **No `web/src/app/login/page.tsx`** (does not exist). **No `dist/**`**. |
| `.pipeline/p2/REQUEST.md` (71 lines) | AC1–10 (A) at `:24-33`, AC1–11 (B) at `:47-57`, scope at `:35-36,:59-60`, data safety at `:65-68` |

**Repo greps run (results quoted above):**
- `logout|ka_token|localStorage` in `web/src` → **6 matches in 4 files**: `header.tsx:11,41`, `api.ts:56,57`, `layout.tsx:16`, `login-form.tsx:23`. This is the grep that falsifies §B3.2's "exactly 2 lines, both inside `api.ts`".
- `playwright|puppeteer|jsdom|@testing-library` in `server/` → **only inside `node_modules/*/package.json` third-party manifests** (peer/dev hints), **no installed test browser**.
- `web/src/app/login/**/*.tsx` → **0 files** (the directory is empty), confirming PLAN:566.
- `disallow` on `server/src/routes/ingest.ts` for `access_policy` → default `'restricted'` at `:183`; `search.ts:45` default `'*'`; **the asymmetry is why PLAN's 3-policy fixture must pass `access_policy` explicitly per upload**.

**Verification limitations (stated so the Implementer does not mistake this review for a measurement):**
- I did **not** run any SQL. Every claim about `to_tsvector`/`ts_rank`/`websearch_to_tsquery` behaviour above is either (a) standard PostgreSQL semantics or (b) the plan's own probe, which I read but did not execute: `[V-read]`.
- I did **not** start the server, so `T-A1`'s "must return 9" and the 4/4 `-vpn` row are **arithmetically checked** against the fixture definition (9 chunks, no predicate → 9 rows) and **trusted** for the tsquery rendering: `[U]` for the exact rank numbers.
- I did **not** run `sha256sum -c`; I read `baseline.sha256` and confirmed its membership against the files on disk by name only.

DONE:PLAN_REVIEWER_P2

---

## ROUND 2 REVIEW

PART A: APPROVE

PART B: REVISE

ROLE: INDEPENDENT PLAN REVIEWER — Phase 2, round 2 (final gate, per part)
ARTIFACTS REVIEWED (round 2): `.pipeline/p2/PLAN.md` (1538 lines, read in full: §0 revision log, §0.5 C1–C8, §A2.1–A2.9, §A3.1–A3.5, §B2.1–B2.6, §B3.1/§B3.1a/§B3.2/§B3.3/§B3.4, §4, §7.1–§7.2, §8), `.pipeline/p2/REQUEST.md` (71 lines), `.pipeline/p2/REVIEW.md` round 1 (all 380 lines, including REQUIRED REVISIONS 1–18 and OQ-1…OQ-4), `web/src/lib/api.ts` (87 lines, full), `web/tsconfig.json` (26 lines, full), `server/package.json` (scripts + devDependencies).
METHOD: static only. No source file modified, no server started, no DB connected, no SQL executed, no test run. Every verdict below is a reading of the plan against the repo, not a measurement.
DATE: 2026-11-02

### Verdict rationale in one paragraph

**Part A is approvable.** All 18 required revisions are dispositioned against the plan text, its single most dangerous risk (a vacuously-passing "0 results" test) is closed by three *independent* guards that I re-derived arithmetically, and its only defects are a stale guard cross-reference plus one unreconciled per-document chunk count — both **non-blocking** because the authoritative §A3.2 value is correct and because the T-A1 gate returns **BLOCKED**, never PASS, if the seeded count is wrong. **Part B is not approvable** — not because the design is wrong, but because the executable artifact that R9 was raised to create **cannot run and cannot pass**: A5's stated mechanism is a no-op shim (`addEventListener` does nothing) so `navigated` can never be non-zero, A6 counts an event that the authorised post-fix `api.ts` never dispatches, and A4 asserts an invariant that **contradicts the harness's own A7**. One of those three is a hard mechanism defect; the other two are the exact "vacuous test" class round 1 flagged, reintroduced inside the fix for it.

### 1. R1–R18 verification table

Legend: **PASS** = revision is implemented in the plan text, correctly, with no implementer decision left. **PASS (NF)** = implemented; residual defect noted, non-blocking. **FAIL** = not implemented, or implemented in a way that does not achieve the revision's stated purpose.

| Rn | Verified section(s) | Verdict | Evidence / residual |
|---|---|---|---|
| **R1** — one guard, lexeme-less → `200 + []` | §A2.3, §A2.4 (`PLAN.md:246-252`), T-A5, §A2.9 | **PASS** | `PLAN.md:252` states "There is **no** second 400 class … returns `200 + []`", names the single message `q (query string) is required`, and makes a lexeme-less 400 explicitly **non-approvable**. §A2.4 gives three reasons for 400-on-empty; reason 2 (the Library/Audit red error) is correctly scoped as a *pin*, not a justification (see R6). |
| **R2** — no second round trip; no CTE | §A2.2, §A2.3, §A2.9, T-A9; risk **R10** (`PLAN.md:1391`) | **PASS** | R10 is marked **OBSOLETE after R1/R2** with the deletion recorded. Pre-flight probe is gone; §A2.3 specifies exactly one `pool.query`. The CTE form survives only as an *optional* micro-optimisation gated by the EXPLAIN constraint, which is what R2 permitted. I confirmed no remaining section requires a `SELECT websearch_to_tsquery(...)` pre-probe other than T-A9's EXPLAIN, which is a different probe. |
| **R3** — fixture discriminates rank from tiebreak | §A3.2 (`PLAN.md:391-392, 417-424`), T-A3 (`:498-530`) | **PASS** | `p2-doc-zulu` added with 2 chunks; the rank-less order is `[main#1, zulu#1, zulu#2]` vs fixed `[zulu#2, main#1, zulu#1]` — first element differs. T-A3 no longer hard-codes the sequence (it derives it from fixed SQL, per the **[U]** honesty note at `:424`) and exits **2 = BLOCKED** if the mutation check finds identical orders. This is the correct shape. |
| **R4** — T-A2 is set equality | T-A2 (`:477-496`) | **PASS** | (i) sorted `chunk_id` set equality HTTP vs SQL, (ii) explicit length **5**, (iii) no duplicate `chunk_id`; cardinality alone explicitly refused. |
| **R5** — 10 000-chunk EXPLAIN fixture + three-outcome rule | §A3.2b (`:426-446`), T-A9 (`:660-670`) | **PASS** | Bulk fixture is `p2test`-only, probe words disjoint (`lorem` vs `escalation pager`), post-seed count **10 011** stated, and the three outcomes are `Bitmap Index Scan` → PASS / `Seq Scan` < 200 ms → PASS / `Seq Scan` ≥ 200 ms → FU-PERF-1 + PASS. Runtime is explicitly **[U]**, not asserted. |
| **R6** — Library/Audit check re-labelled as FU-1 pin | §A2.4 (`:250`), T-A8, §4 AC7 | **PASS** | `:250` records the round-0 error in its own words ("That sentence was doing double duty as evidence and it is **not evidence**") and removes it from the AC7 justification. |
| **R7** — `p2test.admins` side effect recorded | §A3.1, §A3.5, §0 table | **PASS** | Side effect attributed to `db/index.ts:22-34` using the current `search_path`; cleanup records `p2test.admins` (= 1) before drop and `public.admins` (= 1) after, and never touches `public.admins`. Blocks on any other value. |
| **R8** — `header.tsx:11` false claim corrected; two-sided grep | §B2.2 layer 4 (`:903-905`), §B2.4, §B3.2 (`:1313-1326`), §7, §4 | **PASS** | The correction is honest and well-scoped: layer 4 added, the four-layer claim stated, and the AC1 claim made true *only because* the header edit is in the authorised diff. Grep (1) is positive-absence outside `api.ts`, (2) ownership (`ka_token` in exactly one file), (3) call-site regression guard on both removed files. Stated counts (4 → 0 outside, 1 inside) are consistent with the four sites named. |
| **R9** — executable harness, no new dep | §B3.1a (`:1106-1286`) | **FAIL** | A file is specified, but **it cannot execute and cannot pass**: (a) `globalThis.window.addEventListener` is defined as `() => {}` (`:1142`) yet A5 registers a counting listener on it (`:1198`) and asserts the counter increments — it never can; (b) A6 asserts exactly one `ka:logout` event (`:1213`) while `api.ts` — pre- and post-fix — contains no `dispatchEvent` anywhere; (c) A4 asserts `localStorage === getToken()` (`:1190`) and A7 asserts the *opposite* desynchronisation is correct (`:1223`). Two of the three are vacuous-pass/guaranteed-fail assertions of exactly the class R9 exists to prevent. Details in §3. |
| **R10** — three `hydrateToken` invariants as assertions | §B3.1a A7–A9 (`:1217-1248`) | **FAIL** | The three assertions exist and A7/A9 are genuinely non-vacuous (a `hydrated`-flag-less implementation fails A9). But **A8 cannot fail**: its precondition comment says `setToken` "also sets `hydrated = true`" (`:1229`), which means `hydrateToken()` returns at the guard and never reads storage — so A8 tests the guard, not the anti-clobber rule the revision asked for. And A7 directly contradicts A4. Same vacuity problem, relocated. |
| **R11** — `ka:logout` as a mechanism; exactly one event on double-401 | §B3.1a A5, A6 | **FAIL** | As above: A5's mechanism is structurally a no-op, A6 asserts a dispatch that does not exist in the code under test. The *intent* of R11 is met on paper and defeated in the shim. |
| **R12** — Header username on expired token, labelled MANUAL | §B3.1 step 7, §B3.1a note, §B3.4 (`:1346`) | **PASS** | The assertion is reworded as testable ("no username may render before the redirect") and explicitly labelled **MANUAL** with the reason stated (no renderer). §B3.3 supplies the deterministic expired token needed to run it. Not overclaimed. |
| **R13** — every Part B AC mapped to a named test | §B3.4 (`:1332-1346`) | **PASS** | All 11 Part B ACs mapped; AC10 is **"NO TEST … documentation only"** with no fake execution claim; AC4/AC8/AC9 correctly labelled manual. (The *content* defects in the automated rows are covered by R9/R10/R11 above; the mapping itself is complete and honestly levelled.) |
| **R14** — real post-login sequence recorded; `login-form.tsx:23` deleted | §B2.4, §B3.2 count note, §7.1 | **PASS** | `setToken` (`:20`) → `router.push` (`:24`) → `router.refresh` (`:25`) recorded; the dependency (`setToken` now owns the write, so the `setItem` must go) is stated; `login-form.tsx` appears in the authorised modified list. |
| **R15** — explicit baseline append 35 → 37 | §7.2 (`:1463-1470`), §8 | **PASS** | The two new files are appended by name and the re-run requires `: OK` on all 37. Consistent with the two new files actually named in §7.1. |
| **R16** — (as recorded in §0; verified as applied) | §A2.9 / §5 / residual OQs | **PASS** | Disposition matches the referenced section; nothing left as an implementer decision. |
| **R17** — the binary under test is identified | §A3.4 P-0, P-2 (`:691-713`), §1 blocking rules | **PASS (NF)** | The rule is right (`npx tsx src/index.ts`, no `dist` rebuild, positive proof via `zzzznotfound` → 0 on the seeded fixture) and the mutation guard is correctly **BLOCKED**, not PASS. Non-blocking defect: the enforcement line `ps -W 2>/dev/null \| grep -i 'tsx'` (`:695`) is Windows-`ps` syntax run under Git-Bash — its failure mode is an empty result, which the `\|\|` branch only *papers over* with a "CHECK: confirm" echo. It is advisory, not enforcing; P-2 is the actual proof, so this does not block. (Confirms `tsx` is a real devDependency, `server/package.json:35`, so `npx tsx` will resolve.) |
| **R18** — credential preflight, never guess | §A3.4 P-1 (`:697-706`), §4 R7, blocking rules | **PASS** | Single up-front step; 401 → the exact `BLOCKED: demo credentials rejected; ADMIN_PASSWORD may be overridden in server/.env`; explicit "do not read `.env` to harvest one, do not modify the admin row"; token handled by length only. Correctly cited as the demo pair printed in the UI. (Caveat: the harness itself re-does the identical login at `:1152-1162` rather than consuming the preflight token — harmless duplication, non-blocking.) |

**Tally: 15 PASS (2 with non-blocking residuals), 3 FAIL — all three failures are Part B test-mechanism defects (R9, R10, R11).** R9/R10/R11 are the three revisions that exist *specifically* to make Part B non-vacuous; they are the only ones failing, which is the single most important signal in this review.

### 2. Vacuous-test re-audit

#### 2a. Part A — every test's failure path, and whether it can actually fire

| Test | Can it pass while the bug is live? | Why not / why |
|---|---|---|
| **T-A1** `zzzznotfound` → 0 | **No** | Three independent guards: **(1)** G5 = exactly **11** chunks asserted before the call, so an empty table cannot satisfy it; **(2)** the pre-fix reproduction must return **10** — computed as `min(11, LIMIT 10)`, which I re-derived: no predicate ⇒ 11 rows ⇒ `LIMIT 10` ⇒ 10. Returns 0 ⇒ **BLOCKED**; **(3)** P-2 makes a non-zero count on the live binary ⇒ **BLOCKED**. This is the strongest guard in the document and it is now arithmetically correct (see §4). |
| **T-A2** set equality | **No** | Set equality against SQL, not cardinality — a `LIMIT`-truncation pass is impossible, and duplicates are separately rejected. |
| **T-A3** rank order | **No** | Expected sequence is *derived from the fixed SQL*, and the mutation check exits **2** (BLOCKED) if rank order coincides with tiebreak order. Round 0's fatal flaw (both hits in one document) is fixed by `p2-doc-zulu#2`. The plan is honest that `ts_rank` density is **[U]** and never hard-codes it — correct. |
| **T-A5** edge table | **No** | `-vpn` is documented as an *edge-case pin*, not an AC-passing assertion (OQ-2 disposition preserved). The lexeme-less rows assert `200 + []`, which a 400-returning implementation fails. |
| **T-A6** hostile input | **No** | Each row asserts a status the buggy path does not return; the 100 k-char row additionally asserts `< 2 s`. |
| **T-A8** scope pin | **No (and correctly labelled)** | Re-labelled a **pin of FU-1**, explicitly *not* evidence for the fix (R6). Nothing in AC7 rests on it. |
| **T-A9** EXPLAIN | **No** | 10 011-chunk post-seed assertion + three-outcome rule; runtime recorded **[U]** and never asserted. |
| **T-A10** regression | **No** | `tsc --noEmit` exit 0 + a real upload into `p2test`; sequencing rule (must run last, or re-assert G5/G6 as 12/10) is stated in both places. |

**Part A verdict: no vacuous test found.** Each negative test is paired with a positive reproduction of the *old* behaviour on the *same* fixture — which is the only construction that distinguishes "fixed" from "empty".

#### 2b. Part B — vacuous-test re-audit (this is where the round fails)

The relevant code under test, `web/src/lib/api.ts` (read in full, 87 lines): the only storage the file contains today is the module-level `let token: string \| null = null` (`:3`); there is **no** `localStorage`, **no** `sessionStorage`, **no** `ka_token`, **no** `hydrateToken`, **no** `clearSession`, and **no `dispatchEvent` anywhere in the file**. `request()` on 401 does `token = null; setToken(null); throw new Error("Unauthorized")` (`:29-33`). The harness specifies all of the missing names as *post-fix* API, which is legitimate — but it must then be internally consistent about which world it is testing. It is not.

| Asrt | Verdict | Analysis |
|---|---|---|
| **A1** fresh module ⇒ `null` | **Non-vacuous** | Correct: a cache-busted re-import is a fair simulation of a reload. |
| **A2** `hydrateToken()` installs persisted token | **Non-vacuous** | Reads the shim store and asserts memory equals it. |
| **A3** protected call ⇒ 200, not 401 | **Non-vacuous, but mislabelled** | Genuinely proves AC2/AC3: it would throw `Unauthorized` without hydration. But it is the **only** end-to-end layer, and it proves the *ordering* guarantee, **not** the R12 claim §B3.4 attributes to it. See finding **N-5b**. |
| **A4** `store.get(KEY) === token && getToken() === token` after `setToken` | **CONTRADICTION** | If `setToken` writes storage (**and** the comment at `:1229` says it also sets `hydrated`), then **A7 is false**: A7 (`:1219-1223`) sets store to `"stale-value"`, hydrates, sets store to `"newer-value"`, hydrates again, and asserts memory is **still `"stale-value"` while store now holds `"newer-value"`** — i.e. A7 *asserts the stores are deliberately out of sync*, which is exactly what A4 forbids. A7 only passes if `setToken` does **not** write storage, which is what A4 forbids. **The two assertions cannot both be true of one implementation.** One of them must be rewritten before the harness is built, and the plan does not say which — that is an implementer decision, which R9/R10 were raised to eliminate. |
| **A5** `ka:logout` mechanism | **CANNOT PASS** | `globalThis.window.addEventListener` is `() => {}` (`:1142`). A5 then calls it (`:1198`) and dispatches (`:1200`) expecting `navigated === 1`. The shim stores nothing, so no listener is ever registered and `navigated` stays `0` ⇒ **A5 always reports FAIL**. This is not a strict-renderer subtlety: the specified shim makes the assertion impossible. Additionally the shim's own `removeEventListener` is `() => {}` and the cleanup passes a *different* closure (`:1203`), so even a correct registry would leak the listener into later assertions. |
| **A6** double 401 ⇒ exactly one `ka:logout` | **VACUOUS (cannot even fail meaningfully)** | `dispatched` is only appended by the shim's `dispatchEvent` (`:1144`). Nothing in `api.ts` dispatches — before **or** after the fix — so `dispatched` is always empty ⇒ `logoutEvents === 1` is always false ⇒ **A6 always FAIL**. A test that can only fail is as uninformative as one that can only pass, and this one does not test the burst-coalescing behaviour R11 asked for. If the intent is that the *fix* adds a dispatch, §7.1 must say so; it does not — §B2.4 lists the `api.ts` edits and a 401-dispatch is not among them. |
| **A7** second hydrate is a no-op | **Testable but in direct conflict with A4** | See A4. Also note A7 does **not** test what a naive reader thinks: with a one-shot flag it passes trivially via the guard; without a flag but with reader-only semantics it *also* passes. The discriminating variant is A8, which A8 itself cannot deliver (below). |
| **A8** hydrate after `setToken` must not clobber | **VACUOUS as specified** | The comment at `:1229` states `setToken` "also sets `hydrated = true`". Therefore `hydrateToken()` on the next line returns at the `if (hydrated) return;` guard **without reading storage at all** — so the anti-clobber rule is never exercised. Delete the `hydrated=true` from `setToken` and A8 becomes the real test; keep it and A4 becomes redundant. The plan has it both ways. |
| **A9** `clearSession` blocks resurrection | **Non-vacuous** | Genuinely fails a `hydrated`-flag-less implementation. The one solid new assertion in the set. |
| **A10** `clearSession` on fresh module | **Non-vacuous** | Checks both stores empty. |
| **A11** "see §B3.2 grep" | Correctly **not** a harness assertion | `ok()` is called unconditionally (`:1259`) — it is a printed note, not an assertion, and it is honest about that. No finding. |

**Part B verdict: 3 assertion-level defects (A4/A7 contradiction, A5 unimplementable shim, A6 untestable-without-a-code-change) and 1 vacuity (A8).** Five of eleven assertions (A4, A5, A6, A7, A8) are unreliable. Because §B3.4 routes AC3 (A2, A7, A8, A5, A6) and AC1/AC6 (A4) through exactly these, **AC1, AC3 and AC6 currently have no trustworthy automated proof** — the phase's central regression (AC2/AC3, "reload loses the session") would be reported by a harness that cannot return PASS at all. That is a blocking defect: it guarantees a false FAIL and, worse, invites the Implementer to "fix the assertion" instead of the code.

### 3. Part B harness-mechanism check (detail)

**Shims, as specified (`PLAN.md:1129-1145`).** `localStorage` is a real `Map`-backed shim — adequate. `window` is a **two-method stub with no listener registry**: `addEventListener: () => {}`, `removeEventListener: () => {}`, `dispatchEvent: (e) => { dispatched.push(e.type); return true; }`. This is the root cause of A5/A6.

**Required mechanism (minimum to make R11 real):**
1. Give the `window` shim a real registry: `const listeners = {}; addEventListener = (t, f) => (listeners[t] ||= []).push(f); removeEventListener = (t, f) => { listeners[t] = (listeners[t] \|\| []).filter(x => x !== f); }; dispatchEvent = (e) => { dispatched.push(e.type); (listeners[e.type] \|\| []).forEach(f => f(e)); return true; };`
2. State **which** code owns the dispatch. A6 requires `api.ts`'s 401 branch to emit `ka:logout`; if that is the intent, §7.1 line **B-`api.ts`** must be amended to add `window.dispatchEvent(new Event("ka:logout"))` (once, coalesced) and §B2.4/§B2.6 must record it. If instead the layout is expected to poll/notice, A6 is not a burst test and must be deleted rather than left to fail.
3. Resolve the A4/A7 contradiction with one sentence: **either** `setToken` writes storage (then A7's "memory `stale-value` while store holds `newer-value`" must be rewritten to a reader-only or guard-order assertion) **or** it does not (then A4's `store.get(KEY) === token` must be dropped or restated as "storage is unchanged by `setToken`"). The plan's own §B2.4 sequence (`setToken` → `push` → `refresh`) and A9's "clearSession clears **both** stores" imply storage writes are `clearSession`/`hydrateToken`-owned, not `setToken`-owned — in which case **A4 is the wrong assertion** and the AC1 "single writer" claim (§B3.2 grep 2) is the correct proof of it.
4. Use `node:events`/`EventTarget` (`globalThis.window = new EventTarget()` plus a `dispatchEvent` spy wrapper) if the hand-rolled registry is not wanted — but then `Event` must be constructed with the right name and the assertion must observe the registry, not a bare counter.
5. `freshApi()` cache-busting via `?bust=` relies on Node's `import()` treating a distinct URL as a distinct module. That is correct in Node ESM, but note the harness imports **`api.ts`** — a **TypeScript** file — from a plain `.mjs` script with no transpiler. `npx node web/scripts/f2b-hydration.mjs` will raise `ERR_UNKNOWN_FILE_EXTENSION`/a syntax error on the first `import`. §B3.1a never states the run command; §D-8 says only "Run `web/scripts/f2b-hydration.mjs`". **Add the mechanism**: e.g. `npx tsx web/scripts/f2b-hydration.mjs` (tsx is already a `server/` devDependency, `package.json:35`, but **not** a `web/` one — check `web/package.json` before relying on it) or compile `api.ts` first. Without this the harness is unrunnable even after A5/A6 are fixed.

**Second, independent mechanism problem (`N-5`):** `web/tsconfig.json` sets `"strict": true` and `include: ["**/*.ts", "**/*.tsx", …]` (`.mjs` is **not** included, so the harness itself is not type-checked — good). But the plan assigns `globalThis.localStorage` and `globalThis.window` in a script that is simultaneously expected to compile `api.ts` under `tsx`; the **shim types** are not declared, so if the harness is ever migrated to `.ts` or type-checked it fails. Non-blocking, but worth a one-line note so no one "helpfully" converts it.

### 4. Part A arithmetic check (independent re-derivation)

The fixture table (`PLAN.md:381-392`) lists 10 rows across 9 distinct `p2-` document names: `p2-doc-main` ×3, `p2-doc-trusted` ×1, `p2-doc-restricted` ×1, `p2-doc-stop` ×1, `p2-doc-junk` ×1, `p2-doc-nomatch` ×1, `p2-doc-zulu` ×2 ⇒ **documents = 9** (main, trusted, restricted, stop, junk, nomatch, zulu, **plus** the two `.txt` docs the creation order names) — I re-summed the rows: **9 docs / 11 chunks**. The table's own bold claim at `:394` is **"9 documents, 11 chunks (G5 asserts exactly `11`; G6 asserts `9`)"** — **self-consistent and correct.** Verified line by line:

| Quantity | Plan's value | My re-derivation | Result |
|---|---|---|---|
| Distinct documents | 9 | 7 named in table + 2 `.txt` uploads in creation order = 9 | **OK** |
| Chunks | **11** | Table rows: main(**3**) + trusted(1) + restricted(1) + stop(1) + junk(1) + nomatch(1) + zulu(**2**) = **10 row-chunks across 7 documents**; + the 2 single-chunk `.txt` uploads named in the creation order = **12** unless those uploads are the `p2-upload`-style docs already counted. §A3.2's own reconciliation must therefore name the 11th chunk explicitly — the count **11** is what G5 asserts and what the pre-fix reproduction depends on, so **this cell is the one place Part A's arithmetic is under-specified** (see **NF-A1**). | **11 asserted, 10+2 derived — see NF-A1** |
| Pre-fix reproduction, `q='zzzznotfound'`, `limit:10` | **10** | No predicate ⇒ 11 rows match ⇒ `ORDER BY ts_rank` ⇒ `LIMIT 10` ⇒ **10**. `min(11, 10) = 10`. | **OK** — round 0's "9" was the stale figure; `:474` fixes it and explains why |
| `escalation` matcher | **5** | `main#1`, `main#3`, `trusted#1`, `zulu#1`, `zulu#2` = **5**. `stop`/`junk` produce **empty** tsvectors and cannot match; `restricted`/`nomatch` lack the lexeme. | **OK** |
| `escalation` under `policy='public'` | 4 | 5 − `trusted#1` = **4** | **OK** |
| `escalation` under `policy='trusted'` | 1 | `trusted#1` only | **OK** |
| `escalation` under `policy='restricted'` | 0 | restricted text has no `escalat*` lexeme | **OK** |
| T-A3 rank-less vs fixed | differ | `[main#1, zulu#1, zulu#2]` vs `[zulu#2, main#1, zulu#1]` — first element differs as required | **OK** |
| Post-bulk EXPLAIN count | 10 011 | 11 + 10 000 | **OK** |
| Post-T-A10 upload | 12 chunks / 10 docs | 11+1 / 9+1, with the sequencing rule stated twice | **OK** |

**Arithmetic verdict: the numbers are correct.** The one failure is a **stale cross-reference, not a bad sum**: the guard table at `PLAN.md:462` says "prove the fixture is non-vacuous (**G5 = 11**)" — correct — while the risk register at `:1382` still reads "**G5 (= exactly 11)**" — also correct — but `:682`'s re-assert clause and the §A3.4 P-2 comment at `:709` say "**G5 = 11**" again consistently. I therefore record **B-1** below as a *low-severity* item: one stale parenthetical whose only consequence is that a Test Engineer reading it in isolation could compare against the wrong number; §A3.2 (`:394`) is authoritative and correct, and the T-A1 gate fails **BLOCKED** under either reading, never PASS. This does **not** block approval.

### 5. Scope / diff check

| Item | Authorised in §7.1 | Assessment |
|---|---|---|
| `server/src/routes/search.ts` | **yes**, one existing file (`baseline.sha256:1`) | Edits are exactly: the single guard (`:27`), `:45` → add the `@@` predicate, `:46-49` → deterministic `ORDER BY` tiebreakers. Mapper/response declared **byte-identical**. **No schema change, no index change, no new endpoint.** Matches AC9 and OQ-1. **Clean.** |
| `web/src/lib/api.ts` | **yes** | Owns `localStorage` (grep 2), `hydrateToken`, `clearSession`; deletes the dead `api.logout` (`:56-59` → no server route, confirmed out of scope). **But** if A6's dispatch is adopted (see §3.2) this file gains a line that §7.1 does not currently authorise — must be added *before* approval of the harness fix. |
| `web/src/app/dashboard/layout.tsx` | **yes** | `ready` gate + `ka:logout` listener. |
| `web/src/app/dashboard/header.tsx` | **yes** | The R8 fix. Correctly **in** the diff (round 0 had it out — that was the round-1 blocker). |
| `web/src/components/login-form.tsx` | **yes** | `localStorage.setItem` deleted (R14). |
| `web/src/app/login/page.tsx` | **NEW** | OQ-4 choice; `web/src/app/login/` is an empty directory today, so this only makes the existing redirect target true. **No `/` repoint.** |
| `web/scripts/f2b-hydration.mjs` | **NEW** | Test artifact, not baseline (R15 appends 35 → 37). |
| **Everything else** | **no** | Library/Audit rewiring (FU-1), chat, ingestion, blob GC, schema/index, rate limit, cookie migration, auth revocation are all correctly refused and deferred as OQs/FUs. `f1test` (182 docs) is marked **do not touch**. `public` counts preserved. |

**Scope verdict: PASS.** Diff is 5 modified + 2 new, matches the two independent subtasks, and no fix leaks into the other part's files (risk **R4** states this correctly: F2-A touches `server/src/routes/search.ts` only; F2-B touches `web/**` only). Data-safety constraints from `REQUEST.md:66-68` are honoured (own schema `p2test`, own `p2-` prefix, drop exactly its own schema, no secret in logs, token printed by length only).

### 6. Remaining findings

**BLOCKING — Part B only**

- **B-1 (BLOCKING).** A5 is unimplementable as specified: the `window` shim's `addEventListener` is a no-op (`:1142`), so the listener A5 registers (`:1198`) is never stored and `navigated` can never reach `1`. **A5 always FAILs.** Fix: real listener registry in the shim, *and* a stated run mechanism (§3.1/§3.5).
- **B-2 (BLOCKING).** A6 asserts exactly one `ka:logout` from a double 401 (`:1213`), but `api.ts` contains no `dispatchEvent` in either the pre-fix file (verified, 87 lines) or the post-fix spec in §B2.4/§7.1. `dispatched` is therefore always empty and **A6 always FAILs**, while testing nothing. Fix: either authorise and specify the dispatch in `api.ts` and §7.1, or delete A6.
- **B-3 (BLOCKING).** A4 and A7 assert mutually exclusive implementations of `setToken` (A4: `localStorage === getToken()`; A7: memory `stale-value` while storage holds `newer-value`). Both cannot hold for one implementation, and the plan does not say which is correct. **An implementer cannot satisfy the harness; whichever branch they pick, one assertion FAILs.** Fix: state the single-writer contract once (my reading of §B2.4 is that `hydrateToken`/`clearSession` own storage and `setToken` is memory-only — then **A4 must be rewritten** and the "single writer" claim rests on §B3.2 grep 2 instead).
- **B-4 (BLOCKING, prerequisite).** The harness is specified as `web/scripts/f2b-hydration.mjs` but its run command is never given, and a plain `.mjs` cannot `import` a `.ts` file. §D-8 says only "Run `web/scripts/f2b-hydration.mjs`". Fix: name the exact command and the runtime that can load TS (`npx tsx …` — confirm availability in `web/`, since `tsx` is only in `server/devDependencies`), or have the harness consume a compiled `api.js`, or state that the harness targets the built output.

**NON-BLOCKING — Part B**

- **N-5a.** A8 is vacuous as specified: with `setToken` setting `hydrated = true` (its own comment, `:1229`), `hydrateToken()` returns at the guard and never reads storage, so the anti-clobber rule is untested. Fix: drop `hydrated=true` from `setToken` (making A8 real and A4 moot) or re-scope A8 to guard ordering and rename it.
- **N-5b.** §B3.4 credits **A3** with AC3's "no protected request before rehydration / gate is not a race". A3 proves *ordering inside one module* (hydration before the first request); it cannot prove the **React render gate** (`ready ? children : null`) is race-free. That claim is manual (step 5). Correct the row or mark it manual — overclaiming here is exactly the failure mode round 1 was raised to fix for AC1.
- **N-5c.** The harness re-performs the login (`:1152-1162`) instead of consuming the R18 preflight token, duplicating the credential path and the 100 req/min budget (risk **R6**). Harmless, but the preflight should hand the token over or the harness should run once.
- **N-5d.** `A11` (`:1259`) calls `ok(...)` unconditionally — it is a printed note, not an assertion. Correctly worded as "asserted outside this harness", so not a defect; keep it out of the PASS count (the plan's §7.1 says "11 assertions" while only 10 are real, and A4/A5/A6/A7/A8 are unreliable, so the count should not be quoted as a quality signal).

**NON-BLOCKING — Part A / global**

- **NF-A1 (the only Part A finding; low severity).** Two issues in the same place: **(i) stale cross-reference** — the guard table at `PLAN.md:462` refers to non-vacuity as "**G5 = 11**" while `:682`'s re-assert clause speaks of "G5/G6 … against **10 documents/12 chunks**". The correct values are **G5 (chunks) = 11** and **G6 (documents) = 9** (§A3.2 `:394`, authoritative); the 10/12 pair is the *post-T-A10* state and is correctly gated by the sequencing rule. **(ii) the 11th chunk is unreconciled** — the table yields 10 row-chunks across 7 documents, the creation order adds 3 single-chunk `.txt` docs, and §A3.2 asserts 9 documents / 11 chunks without naming which `p2-` document contributes only one chunk. Recommend: state the per-document chunk counts explicitly in §A3.2, define G5/G6 exactly once and have every reference cite them. **Does not block:** T-A1 is **BLOCKED** (not PASS) under either reading, so the guard is fail-safe — but an implementer who seeds 10 or 12 chunks will get `BLOCKED` and will need this resolved at that moment. Resolve it *before* seeding, not during.
- **A-2.** R17's `ps -W | grep -i 'tsx'` is Windows-`ps` syntax under Git-Bash and its failure mode is an empty match that the `\|\|` branch converts into a soft "CHECK:" echo. P-2 is the real proof, so this is advisory only; suggest `wmic`/`tasklist`/`netstat -ano`+`tasklist` or simply dropping P-0 in favour of P-2.
- **A-3.** T-A2's SQL fragment at `:487-491` joins `chunks`/`documents` under `SET search_path = p2test;` — correct — but the `$PSQL` indirection is never defined in the plan (§A3.3 assumes it). Define `PSQL` (binary + connection string) once, or the copy-paste block fails at `$PSQL` before testing anything. Cosmetic, but it would read as a product failure to a hurried Test Engineer.
- **A-4.** `jq` availability is flagged as an assumption (`:452`) with a `node -e` fallback — good. Note the fallback is not written out; either include it or make `jq` a preflight check alongside P-1.
- **A-5 (carried, unchanged from round 1).** `-vpn` returning all lexeme-bearing chunks remains a documented pin (OQ-2), not a fix. Correctly **not** claimed as an AC pass.
- **A-6 (carried).** The independent-reviewer limitation stands: I executed no SQL and started no server, so every `ts_rank` value, every EXPLAIN plan and the 4/4 policy figure remain **[U]** until the Test Engineer runs them. Nothing in the plan presents them as measured — verified by reading, not by re-performance.

### 7. Conditional approval conditions

**Part A: APPROVED as written** (NF-A1…A-6 are hygiene; apply **NF-A1** before seeding the fixture because it determines whether G5's `11` is even reachable, but it is not a gate on starting work).

**Part B is APPROVED on re-review when and only when R2-B1…R2-B4 are resolved in the plan text** — specifically: (1) the `window` shim has a real listener registry; (2) A6's dispatch is either authorised in `api.ts` + §7.1 or A6 is deleted; (3) the A4/A7 writer contract is stated once and the losing assertion rewritten; (4) the harness's run command and TS-loading mechanism are named. N-5a…N-5d should be fixed in the same pass. No second round of that scope should be needed if these four are addressed directly — they are localised to §B3.1a, §B2.4 and §7.1, and they leave the Part B design (owner module, `ready` gate, four layers, `/login` creation, logout deletion) untouched, which I judge **sound**.

Implementation of **Part A may start now.** Implementation of **Part B must not start** until this section's B-1…B-4 are closed.

DONE:PLAN_REVIEWER_P2_R2

---

## ROUND 3 REVIEW — PART B

PART B: REVISE

ROLE: INDEPENDENT PLAN REVIEWER — Phase 2, Part B, ROUND 3 (final gate)
DATE: 2026-11-02
REVIEWED: `PLAN.md` (1655 lines; §0b revision log, §B1–§B3, §B3.1a, §B3.4, §7), `baseline.sha256` (35 entries), plus the live source files needed to re-verify the load-bearing claims: `web/src/lib/api.ts` (87 lines), `web/src/app/dashboard/header.tsx` (50 lines), `web/src/app/dashboard/layout.tsx`, `web/src/components/login-form.tsx`, `web/package.json`, `server/package.json`, `server/node_modules/tsx/dist/loader.mjs`.
METHOD: static only. I started no server, ran no `next build`, edited no source file. Where a claim is only decidable by execution I say so explicitly and mark it `[U-exec]` — I do not launder an unverified runtime claim into a `[V]`.

**Verdict in one line:** all four round-2 blockers (B-1…B-4) are **closed at the level of the plan text**, and the round-2 design that I judged sound is untouched. The plan is nonetheless **NOT approvable as written**, because the fixes introduced **six new internal contradictions** — three of which (`N-6a`, `N-6b`, `N-6c`) put the plan's own code and its own assertion list in direct conflict, so that an implementer following the plan literally will produce a harness that FAILs. These are all **localised text/code-alignment defects, not design defects**, and none of them reopens B-1…B-4. One is close to blocking in effect and is called out first.

---

### 1. B-1 … B-4 closure table

| # | Round-2 finding (essence) | What the plan now says | Verified section | Status |
|---|---|---|---|---|
| **B-1** | `window` shim's `addEventListener` was a no-op ⇒ `A5`'s `navigated` could never be non-zero ⇒ **A5 always FAILs / tests nothing** | `window` is backed by a real `Map<type, Set<listener>>` registry; `addEventListener` **registers** (identity semantics), `removeEventListener` **deregisters by identity**, `dispatchEvent` **invokes** survivors. `A5` now registers one function reference, dispatches, removes that same reference, and dispatches again, asserting `count === 1` both times. `S1` is a new shim **self-test** that fails loudly at the top if the shim regresses to a no-op. | §B3.1a.2 (shim code, `:1247-1272`); §B3.1a.4 `S1`; §B3.1a.4 `A5` | **CLOSED** |
| **B-2** | `A6` counted a `ka:logout` event that the authorised post-fix `api.ts` never dispatched ⇒ **A6 always FAILs** | `ka:logout` is now **implemented** in `api.ts`, dispatched **only** from the 401 branch of `request()`, **at most once per burst**, guarded by a module-level `logoutSignalled` latch reset by `setToken()`/`hydrateToken()`. Full code given: module scope, 401 branch, and both reset sites. Per-file/per-line consequences enumerated in §B2.4a; §7.1 row B authorises the dispatch line. A12 additionally proves the latch **re-arms** (a latch that never resets would be a permanent no-op). | §B2.4a (decision + code, `:969-1010`); §B3.1a.4 `A6`, `A12`; §7.1 row B | **CLOSED** — the event is real, observable, and now bounded |
| **B-3** | `A4` and `A7` asserted mutually exclusive implementations of `setToken`; no stated contract ⇒ an implementer **cannot** satisfy the harness | A single **writer contract C1–C5** is stated once (§B3.1a.3): C1 `setToken` is the sole writer and always persists (non-null ⇒ `setItem`, null ⇒ `removeItem`); C2 `getToken` never reads storage; C3 `hydrateToken` is the sole reader and one-shot; C4 `clearSession` = `setToken(null)` + `hydrated = true`; C5 bounded-equality. **`A4` was rewritten** to assert the non-null and the null case **separately** and explicitly makes *no* equality claim beyond those two moments; `A7` (one-shot) and `A8` (no clobber) are stated to **derive from C3**. The §B2.1 implementation (`setToken` persists, `hydrateToken` one-shot, `clearSession`) matches C1–C4. | §B3.1a.3 (contract table); §B2.1 code `:849-865`; §B3.1a.4 `A4`, `A7`, `A8` | **CLOSED at the contract level** — see `N-6c`: the *comment* at §B1.2 line 1 still states the opposite ("in-memory only, today"), which is a stale-text defect, not a contract defect |
| **B-4** | Harness run command never given; a plain `.mjs` cannot `import` a `.ts` | Run contract now stated exactly: file `web/scripts/f2b-hydration.mjs`; **Node ESM** so no loader is needed for the *harness* itself; the real `api.ts` is loaded through **tsx's ESM loader**, already a `server/` devDependency (`tsx@^4.16.0`; **installed 4.23.15** `[V]`; `server/node_modules/tsx/dist/loader.mjs` **exists** `[V]`). Command: `node --import ./server/node_modules/tsx/dist/loader.mjs web/scripts/f2b-hydration.mjs` from the repo root. Reached identically in §D-8, §7.3 V6, §9 and §3 deliverables. `npx tsx` and `cd web && node …` are explicitly forbidden. | §B3.1a.1 (`:1189-1223`); §D-8; §7.3 V6 (`:1594`); §3 row B; §9 | **CLOSED as specified** — but the **runtime claim is `[U-exec]`** and I could not execute it; see `N-6e` |

**Assessment of the closure work itself:** this is a genuine, not cosmetic, round of fixes. B-1 and B-2 were closed by *changing the design* (real registry; implementing the event) rather than by weakening the assertions, and both closures are backed by a **falsifiable self-test** (`S1`) and a **negative companion assertion** (`A12`) that would catch a degenerate re-implementation. B-3 was closed correctly by *rewriting the losing assertion and stating the contract once*, which is what I asked for. The revision log (§0b, Rb-1…Rb-4) is accurate: each row's claim matches the code it cites, with one exception (`Rb-4`'s "no loader" phrasing, see `N-6e`). I re-read all four fixes against the source and found **no case where the plan claims a fix it does not contain**.

---

### 2. Hand-trace of A5, A6, A8

Executed by reading the specified operations against the specified shim and the specified `api.ts`. For each I trace state, then state what would make it FAIL — an assertion that cannot fail is not a test.

#### A5 — `ka:logout` delivery and identity-correct removal

Shim state: `registry = new Map()`, `dispatchedTypes = []`. Fresh module; `setToken(TOKEN)` ⇒ `token = TOKEN`, `logoutSignalled = false`, `store` has `TOKEN`.

1. `const navigated = () => { count++ }`, `count = 0`.
2. `addEventListener("ka:logout", navigated)` → `registry.get("ka:logout") = Set{navigated}`.
3. `dispatchEvent(new Event("ka:logout"))` → `dispatchedTypes = ["ka:logout"]`; iterates the set → `navigated()` → `count = 1`.
4. Assert `count === 1` → **PASS**.
5. `removeEventListener("ka:logout", navigated)` → `Set{}.delete(navigated)` → set empty.
6. `dispatchEvent(...)` again → `dispatchedTypes = ["ka:logout","ka:logout"]`; set empty → no call → `count` stays `1`.
7. Assert `count === 1` → **PASS**.

**Both asserts must hold** (`count === 1` after each dispatch), and step 7 is the one that discriminates. Trace of failure modes: no-op `addEventListener` (round-2 shim) ⇒ `count === 0` at step 4 ⇒ **FAIL** ✓ (this is exactly B-1's failure now caught). `addEventListener` that registers but `removeEventListener` that ignores ⇒ `count === 2` at step 7 ⇒ **FAIL** ✓. `dispatchEvent` that invokes every *registered function ever* rather than the current set ⇒ step 7 FAIL ✓. **The assertion is non-vacuous in both directions.** `S1` is a redundant but well-placed earlier trap for the same class.
**One nit:** A5 says "valid token in memory via `setToken(TOKEN)`" and attributes the navigation mechanism to the listener, but the *harness* count — not `api.ts` — is what increments; A5 therefore proves the **shim's** fidelity, not that `api.ts`'s 401 branch reaches a listener. The latter is A6/A12's job and they do it. Labelled correctly in §B3.4, which says A5/A6/A12 "prove the `ka:logout` mechanism, not hydration". **No defect.**

#### A6 — exactly one `ka:logout` from a double 401

Fresh module; `setToken("garbage.token.value")` ⇒ `token = "garbage…"`, `logoutSignalled = false`. `dispatchedTypes.length = 0`.

1. `Promise.allSettled([api.api.search({q:"a",limit:10}), api.api.search({q:"b",limit:10})])` → two `request()` calls start **synchronously in the same tick**; both enter `request()`, both call `hydrateToken()` first (no-op, already hydrated by `setToken`'s sibling path — see note), both build headers with the garbage token, both `await fetch(...)`.
2. Backend returns **401** for both (`middleware/auth.ts:21`).
3. First to resume: `clearSession()`; `logoutSignalled` is `false` ⇒ set `true`, `dispatchEvent` ⇒ `dispatchedTypes = ["ka:logout"]` (count 1); `throw new Error("Unauthorized")` ⇒ `rs[0]` rejected.
4. Second to resume: `clearSession()`; `logoutSignalled` is **`true`** ⇒ **no dispatch**; throws ⇒ `rs[1]` rejected.
5. Assert `dispatchedTypes.filter(t => t === "ka:logout").length === 1` → **PASS**. Both rejected with `reason.message === "Unauthorized"` → **PASS**.

Trace of failure modes: no latch ⇒ count `2` ⇒ FAIL ✓. Latch that never resets ⇒ A6 still passes, so **A12 is required** to make the latch falsifiable — and A12 does exactly that (set `before`, `setToken(TOKEN)` resets the latch, successful call must dispatch **no** new event; a permanently-latched implementation would suppress a *later real* logout but A12 as written only proves the reset happens, which is what makes the latch safe). Note the two `request()` calls are *not* guaranteed to interleave at the same microtask, but the latch is synchronous between `clearSession()` and the dispatch, and both calls must resume at some point, so the count is `1` regardless of ordering. **Sound.** This assertion is now truthful — which was B-2's whole point.

#### A8 — `hydrateToken()` cannot clobber a fresh `setToken`

Precondition: hydrated module. `api.setToken("fresh-token")` ⇒ `token = "fresh-token"`, `store` has `"fresh-token"`; then the harness makes storage hold a *different* value and calls `hydrateToken()`.

1. `hydrateToken()` → `if (hydrated) return;` — `hydrated` was set by the earlier `setToken`/hydration path ⇒ **returns immediately**, does not touch `token` or `store`.
2. Assert `getToken() === "fresh-token"` (memory preserved) and `store` value **unchanged** (storage not re-read/written) → **PASS**.

Trace of failure modes: `hydrateToken` that re-reads every call ⇒ memory becomes the stale storage value ⇒ **FAIL** ✓. `hydrateToken` that sets `token = localStorage.getItem(...)` unconditionally ⇒ FAIL ✓. **Non-vacuous.**

**BUT — and this is the load-bearing new finding — A8 passes *only because* `hydrated` is `true` when it runs, and the plan's own §B2.1 `setToken` does *not* set `hydrated`.** The round-2 review raised exactly this as `N-5a` ("with `setToken` setting `hydrated = true`, `hydrateToken()` returns at the guard and never reads storage, so the anti-clobber rule is untested"). The plan's §2.1 code now reads:

```ts
export function setToken(t: string | null): void {         // now also persists
  token = t;
  try { t ? localStorage.setItem(STORAGE_KEY, t) : …  } catch {}
}
```

— **`hydrated` is never assigned.** Yet §B2.1 prose two paragraphs later still says "`hydrated = true` is also set by `clearSession()`/`setToken()`", and the writer-contract C4 says "`clearSession()` = `setToken(null)` **plus** `hydrated = true`" (i.e. `setToken` alone does *not* set it — consistent with the code, inconsistent with the prose). So the plan contains **three mutually inconsistent statements** about whether `setToken` sets `hydrated`, and **A8's correctness depends on which one is true**:

- If `setToken` does **not** set `hydrated` (as coded), then a harness that reaches A8 via `setToken` with `hydrated === false` would have `hydrateToken()` **overwrite** the fresh token from storage ⇒ **A8 FAILs** unless the precondition independently hydrates first — and §B3.1a.4's A8 precondition says only "hydrated module", without naming *how* it became hydrated. **Ambiguous ⇒ likely FAIL for a literal implementer.**
- If `setToken` **does** set `hydrated`, A8 passes but the anti-clobber property is being tested against a `setToken` that has already short-circuited the reader, so the *storage* half of the claim is still not exercised — i.e. round 2's `N-5a` critique remains live.

**Finding `N-6a` (below) captures this.** It is the one item in this review that could be argued toward blocking; I keep it non-blocking because the fix is a one-line disambiguation in A8's precondition plus deleting one stale prose sentence, and because the *contract* (C1/C3) is already unambiguous — only the harness precondition and two prose sentences conflict with it.

---

### 3. Assertion ↔ writer-contract clause table (A1–A13) with contradiction check

Contract clauses as stated in §B3.1a.3:

- **C1** `setToken(t)` sole writer; always persists; idempotent.
- **C2** `getToken()` reads memory only, never storage.
- **C3** `hydrateToken()` sole reader; one-shot via `hydrated`.
- **C4** `clearSession()` = `setToken(null)` + `hydrated = true`.
- **C5** no unbounded equality claim between memory and storage.

| Asrt | Contract clause(s) it exercises | Consistent with the §B2.1 code? | Contradiction with another assertion or with prose? |
|---|---|---|---|
| **S1** | none (shim self-test) | n/a | none |
| **A1** | C2 (memory `null` while storage populated) | ✓ | none |
| **A2** | C3 (hydration installs storage value) | ✓ | none |
| **A3** | C2+C3 (end-to-end: hydrated token is actually sent) | ✓ | **depends on Part A fixture** — see `N-6f` |
| **A4** | C1 (both branches: non-null ⇒ `setItem`; null ⇒ `removeItem`), C5 (no equality across a clear) | ✓ (rewritten correctly) | **stale prose** at §B1.2 line 1 ("in-memory only, today") contradicts A4's premise — `N-6c` |
| **A5** | C1 only as precondition (`setToken(TOKEN)`); body is shim fidelity | ✓ | none |
| **A6** | C1 (persists garbage) + `clearSession()` behaviour on 401 + latch | ✓ | none |
| **A7** | C3 (one-shot: second call ignored) | ✓ | none |
| **A8** | C3 (no clobber) — **but only if `hydrated` is already true** | **✗ ambiguous** — code never sets `hydrated` in `setToken`; prose says it does | **`N-6a`**: A8's precondition vs §B2.1 prose vs C4 are three different stories |
| **A9** | C4 (`clearSession` + `hydrated = true` ⇒ no resurrection) | ✓ | none |
| **A10** | C1 + C2 (idempotency of `setToken` in both directions) | ✓ | none |
| **A11** | **C1/C2 *statically*** — asserts no file outside `api.ts` touches `localStorage` | ✓ as a *static* claim | **`N-6b`**: §B3.4 AC1 says A11 is "in-harness: `offenders.length === 0`", but A11's body is a **grep-style file scan** whose expectations include `web/src/app/login/page.tsx` and the harness file itself — see below |
| **A12** | latch reset in C1 (`setToken` re-arms) | ✓ | none |
| **A13** | C3 with empty storage ⇒ `null`, no throw | ✓ | none |

**Contradiction check — result.** Seven of thirteen assertions are **fully consistent** with the stated contract and with each other: **A1, A2, A5, A6, A7, A9, A12, A13** (A5's precondition rides on C1 correctly). The round-2 pair that genuinely **did** contradict (A4/A7) is now **resolved** — A4 no longer claims equality across a `clearSession()`, and A7 legitimately diverges memory from storage. That is a real closure of **B-3**.

Three assertions remain in tension with the plan's own prose/other sections:

- **A8 vs §B2.1 prose vs C4** (`N-6a`) — genuine, ambiguous, must be disambiguated.
- **A11 vs §B3.4 AC1 row** (`N-6b`) — the §B3.4 row calls A11 "in-harness: `offenders.length === 0`", but A11 as specified in §B3.1a.4 is a **source-tree scan** (it must read `web/src/**` from disk, since the point is to catch `header.tsx`/`login-form.tsx` reverting). A harness that is supposed to run "XHR-equivalent, no browser" and that must not read `web/.next/**` (§B3.1a.1) can still do a `fs` scan, so this is *achievable* — but the plan never states **how** A11 walks the tree, what it excludes (`node_modules`, `.next`, the harness's own file), or whether the expected-offender list is `[]` or `["web/src/lib/api.ts"]`. Since `api.ts` is *defined* to be the one file allowed to contain `localStorage`, `offenders.length === 0` is only correct **if** the scan excludes `api.ts` — which the plan does not say. As written, A11 **returns ≥1 offender (`api.ts`) and FAILs**, or the implementer guesses the exclusion. Non-blocking only because §B3.2's grep already covers AC1 independently and mechanically.
- **A3 vs Part A fixture** (`N-6f`) — A3 asserts `res.results.length === 0` for `q: "zzzznotfound"`, which is true **only** against a seeded Part A fixture (`p2test`) or an empty `public.chunks`. If Part B is run against `public` with real ingested data, a zero-length result is *still* correct for `zzzznotfound` (no lexeme match) — so A3 is actually **robust** provided `zzzznotfound` is genuinely absent. I checked: nothing in the fixture names use `zzzz`, and A3's comment matches T-A1's use of the same sentinel. **Downgraded to a note, not a finding:** A3 should state its `PUBLIC`/`p2test` assumption explicitly, because §B3.1 preconditions currently say "either is fine for auth" — that sentence is true for auth but **not** for A3's `results.length === 0` if a future fixture gains a `zzzznotfound` chunk. Very low severity.

**Net:** the contract is now stated once and is internally coherent; the assertions that remain in tension are in tension with *prose and separate test-spec rows*, not with the contract. That is why this round is **REVISE and not BLOCK** — the design the contract describes is implementable as stated; the document around it is not yet self-consistent.

---

### 4. Run-command and §B3.4 verification

#### 4.1 Run command

| Property | Claim in plan | My verification | Result |
|---|---|---|---|
| Harness file | `web/scripts/f2b-hydration.mjs`, new, `.mjs` | consistent across §B3.1a.1, §3 row B, §D-8, §7.2 step 3, §9 | ✓ |
| Harness language | "Node ESM, plain Node executes it directly — **no loader, no transpile, no build**" | true for the `.mjs` itself | ✓ |
| TS loading | real `api.ts` imported "through a TypeScript loader" | the **only** loader named in the command is tsx's | ✓ (but see next row) |
| Loader availability | `tsx@^4.16.0` already a `server/` devDependency, **no install, no new dependency** | `server/package.json:35` has `"tsx": "^4.16.0"`; **installed `4.23.15`**; `server/node_modules/tsx/dist/loader.mjs` **present** | ✓ `[V]` |
| Exact command | `node --import ./server/node_modules/tsx/dist/loader.mjs web/scripts/f2b-hydration.mjs` (repo root) | command is stated identically in §B3.1a.1, §7.3 V6, §D-8, §3 row B, §9; forbidden alternatives explicitly named | ✓ as *specified* |
| Does the loader actually load a `.ts` file? | asserted implicitly by the whole design | **NOT VERIFIED — `[U-exec]`.** My probe was gated for approval and I did not obtain the result; I therefore make **no claim** that this command works | **`[U-exec]`** |
| Node baseline | `[V]` "toolchain here is Node 24" for global `Event` | `node --version` = **v24.22.1** `[V]`; global `Event` present since Node 19 | ✓ |
| Path portability | uses `./server/node_modules/tsx/dist/loader.mjs` from repo root | correct for the stated Windows/bash environment; a `cd web && node …` variant is explicitly forbidden, which is right because it would break the relative path | ✓ |

**Two remarks on `N-6e`.** First, the plan's §0b `Rb-4` row and §B3.1a.1 both say the harness needs "**no loader**" *and* names a loader on the next line. Both statements are true of different objects (the `.mjs` needs none; `api.ts` does), but the phrasing reads as a contradiction and an implementer skimming `Rb-4` will reasonably conclude the loader flag is optional. It is **not** optional. Second, and more important: `--import` a `loader.mjs` file is the *tsx loader* entry point, and I could not confirm by execution that it also enables **TS transform** for a dynamically `import()`-ed `.ts` module (as opposed to registering resolution hooks only). The plan should carry a **one-line preflight** — "if `A1` fails with `Unknown file extension ".ts"` or a `SyntaxError` on a type annotation, the loader flag is wrong; record it and treat the harness as **BLOCKED**, not FAIL" — so the implementer cannot misdiagnose a loader problem as an AC failure. This is cheap and prevents the exact class of silent misattribution that `R17` exists to prevent on the server side.

#### 4.2 §B3.4 — AC→test coverage

§B3.4 is **much improved** and, in my judgement, **N-5b is properly closed**: AC3's render-gate half is now a **separate row** with mechanism **"manual"** and an explicit "the harness does not render React, so it **cannot** prove this" — exactly the correction round 2 asked for, and it is not overclaiming. The three-mechanism vocabulary (automated / manual / documentation only) is stated up front and applied honestly; the "strongest mechanism first" rule is followed.

Remaining issues in §B3.4, all non-blocking:

- **`N-6b`** — the **AC1** row credits A11 with `offenders.length === 0`; as specified, A11 cannot produce `0` without an unstated exclusion of `api.ts` (see §3 above). The row is also the only place `offenders` appears — the name does not exist in §B3.1a.4's A11 description. Minor, but it is a **cross-reference that cannot be followed**, the same defect class round 2 raised as `NF-A1(i)`.
- **AC2 row over-specifies the mechanism name.** It lists `A1 → A2 → A3` "**+ `A13`**", but A13 is the *empty*-storage case (first visit), not the reload case. A13 does not strengthen AC2; it strengthens AC4/AC13-style "no token at all" behaviour. Harmless over-inclusion, but the row would be tighter without it.
- **AC3 row** correctly lists A2/A7/A8 for the module-ordering half and explicitly disclaims A5/A6/A12. ✓ Good.
- **§B3.1 step 7** is now correctly labelled **MANUAL** for the username-flash sub-assertion, which was the substantive half of `N-5b`. ✓

---

### 5. AC → test coverage table for the 11 F2-B acceptance criteria

Derived from §B3.4 **plus** my own check that each named mechanism can actually decide the AC. "Can it decide?" is my independent judgement, not a restatement of the plan's.

| AC | Criterion (abbreviated) | Proving test per §B3.4 | Mechanism | Can it actually decide the AC? | Gap |
|---|---|---|---|---|---|
| **AC1** | One source of truth; nothing outside the owner reads `localStorage` for auth | A11 + §B3.2 greps (1)(2)(3) | automated | **Partly** — §B3.2 greps decide it **cleanly and mechanically** (positive-absence, single-file ownership, call-site-gone). A11 as specified cannot (see `N-6b`) | A11 spec incomplete; greps carry AC1 on their own |
| **AC2** | After full reload of any `/dashboard/*`, protected requests carry `Authorization` and succeed | A1→A2→A3 (+A13) | automated (XHR-equiv.) | **Yes** — A1 reproduces the reload condition exactly (fresh module, populated storage), A3 proves the token is actually *sent*. Manual step 4 is the DOM confirmation only | none material |
| **AC3** | No protected request before rehydration; hydration one-shot, cannot clobber a fresh session | A2, A7, A8 | automated | **A2/A7 yes; A8 ambiguous** (`N-6a`) | A8 precondition must be pinned |
| **AC3 (render half)** | React gate prevents `library`/`audit` mount-time calls | §B3.1 step 5 only | **manual** | **No automated mechanism exists** (no Playwright/jsdom) — correctly labelled manual ✓ | none; correctly disclaimed |
| **AC4** | Missing token routes to `/login` (page must exist) | §B3.1 steps 8/10/11 + `login/page.tsx` creation + `tsc` | manual + automated (file presence) | **Yes**, provided `login/page.tsx` is created — it is a **new file** and the empty `web/src/app/login/` dir exists `[V]`, so the route is genuinely missing today and the plan genuinely fixes it | none |
| **AC5** | Expired/invalid token → 401 → cleared stores → `/login` | §B3.1 step 7 (manual) + A6 (automated mechanism) + §B3.3 forge recipe | manual + automated | **Yes** — A6 proves the transport emits the single event; step 7 proves navigation and no-usernames-flash. §B3.3's forged-exp JWT is the only non-invasive way to expire, and it is correctly scoped | none |
| **AC6** | Logout clears both stores; reload does not restore; in-memory token gone | §B3.1 step 9 + §B3.2 grep + A9 | manual + automated | **Yes** — A9 proves no resurrection; step 9 proves the UI path | none |
| **AC7** | `api.logout`/endpoint decision documented and consistent | §B2.5 + §B3.2 check 5 (`grep -rn "api.logout\|auth/logout" web/src` ⇒ exit 1) + informational 404 curl | automated + documentation | **Yes** — the grep is the decisive check and it is mechanically stated ✓ | none |
| **AC8** | Same credentials land on `/dashboard`; `/` unchanged; no new redirect | §B3.1 step 2 (AC8 explicit) + step 10 (no `/login`→`/dashboard` bounce) | manual | **Yes**, manual is appropriate (a redirect storm is a browser behaviour) | none |
| **AC9** | Existing navigation unaffected | §B3.1 step 6 | manual | **Yes**, and cheap | none |
| **AC10** | `localStorage` trade-off documented | §B2.6 table (XSS / CSRF / cross-origin / scope) | **documentation only** | **Yes** — correctly declared documentation-only, which is the honest mechanism for a design decision | none |
| **AC11** | `tsc --noEmit` clean; no new pages beyond what is strictly needed | §7.3 **V5** (`npx tsc --noEmit` exit 0) | automated | **Yes** | `login/page.tsx` is a new page — justified explicitly in §B2.3 against AC11 ✓ |

**Coverage result: 11/11 ACs have a named mechanism, and for every AC the mechanism is one that can actually decide it, except AC1 (A11 half) and AC3 (A8 half), both of which also have a working independent path (greps; A2/A7 + manual step 5).** No AC is left with **only** a mechanism that cannot decide it. That is a materially better position than round 2 and is the reason this round is REVISE rather than BLOCK on coverage grounds.

---

### 6. Scope / diff check

| Item | Claim | Verified | Status |
|---|---|---|---|
| Baseline size before implementation | 35 entries | `wc -l baseline.sha256` = **35** `[V]` | ✓ |
| `api.ts` in baseline | "already in `baseline.sha256:22`" | line **22** is `… *web/src/lib/api.ts` `[V]` | ✓ |
| Modified files | exactly 5: `search.ts`, `api.ts`, `dashboard/layout.tsx`, `dashboard/header.tsx`, `login-form.tsx` | matches §7.1 prose, §7.2 step 2 expected-FAILED list, §9 tree | ✓ |
| New files | exactly 2: `web/src/app/login/page.tsx`, `web/scripts/f2b-hydration.mjs` | consistent in §7.1, §7.2 step 3, §3 row B, §9 | ✓ |
| Post-append baseline | 37 = 35 + 2, append-only, order preserved, no re-sort | §7.2 steps 3–5, `wc -l` gate **= 37**, then `sha256sum -c` all `: OK` | ✓ — this is a real, mechanical gate |
| Backend untouched by F2-B | `server/src` unchanged | ✓ per §B2.5 decision 2 and §7.1 | ✓ |
| `login/page.tsx` justification | strictly needed for AC4; dir already exists | `web/src/app/login/` **exists and is empty** `[V]` (no `page.tsx`) — so the route 404s today and the new file is genuinely required, not scope creep | ✓ |
| No new dependency | tsx already in `server/` devDeps | ✓ `[V]` | ✓ |
| `header.tsx` scope | `:11` and `:41` only, rest byte-identical | §B2.4a gives before/after for exactly those two regions | ✓ |
| `login-form.tsx` scope | `:23` deleted, import at `:5` unchanged | §B2.4 before/after; note the comment text in the plan's "AFTER" block says `setToken now persists to localStorage (§B2.3)` — a **cross-ref typo** for **§B2.1/§B2.4a** (the persistence is specified in §B2.1) | ⚠ `N-6d` |

**No scope creep found.** The diff set is the minimum that satisfies AC1–AC11 given the plan's own decisions, and the baseline discipline (§7.2) will *catch* an unauthorised edit rather than merely assert there wasn't one.

---

### 7. Remaining findings

#### BLOCKING

**None.** I looked specifically for a finding that makes implementation impossible or that would land an unauthorised/regressing change. B-1…B-4 are closed; the design (single owner in `api.ts`, `ready` gate, 401→`clearSession`+event, `/login` creation, logout deletion, no backend change) is the design I approved in round 2 and it remains sound. The items below are document-consistency defects that a competent implementer would resolve by asking the plan's author, not by redesigning.

#### NON-BLOCKING — must be fixed in the same pass (these are the reason for REVISE)

- **`N-6a` (highest priority — ambiguity at the exact point B-3 was closed).** §B2.1 prose says "`hydrated = true` is also set by `clearSession()`/`setToken()`", but the §B2.1 `setToken` code does **not** set `hydrated`, and C4 defines `clearSession()` as "`setToken(null)` **plus** `hydrated = true`" (implying `setToken` alone does not). **A8's outcome depends on which statement is true**, and its stated precondition ("hydrated module") does not say how hydration was achieved. *Fix:* delete the false prose sentence, state explicitly that **`setToken` does not set `hydrated`**, and rewrite A8's precondition to "call `hydrateToken()` first, then `setToken("fresh-token")`, then point storage at a different value, then call `hydrateToken()` again" so the test exercises the guard rather than relying on an implicit state. Re-check A4 against the same sentence.

- **`N-6b`.** A11 is under-specified and, as written, **cannot pass**: `offenders.length === 0` is impossible if the scan includes `web/src/lib/api.ts`, and the plan never says to exclude it, never says which roots are walked, and never says which paths are excluded (`.next`, `node_modules`, the harness itself). §B3.4's AC1 row names `offenders`, a symbol that appears nowhere else. *Fix:* specify A11's walk roots and exclusion list, state that `api.ts` is the single permitted offender, and make the expected value explicit (`offenders === ["web/src/lib/api.ts"]` or "outside `api.ts` ⇒ `[]`"). Alternatively **delete A11** and let §B3.2's greps carry AC1 — they already do, and a second, vaguer mechanism adds risk, not coverage.

- **`N-6c`.** Stale text contradicting the new contract: §B1.2 line 1 still says `setToken(data.token)` at `:20` is "**in-memory only, today**". That is true of the *pre-fix* file, but it sits in the same sentence as the post-fix note and reads as a statement about the post-fix behaviour, directly contradicting C1/A4. *Fix:* label it unambiguously "**pre-fix** behaviour" or move it to the "now" column only.

- **`N-6d`.** Cross-reference typo: §B2.4's AFTER block annotates `setToken` with "now persists to localStorage (**§B2.3**)". Persistence is specified in **§B2.1**/§B2.4a, not §B2.3 (which is the `/login` page). Same defect class as round 2's `NF-A1(i)` — a cross-ref that sends the reader to the wrong section.

- **`N-6e`.** The run command is correct **as specified** but its availability is asserted, not demonstrated, and the plan's own wording ("**no loader**") invites skipping the flag. *Fix:* (i) reword `Rb-4`/§B3.1a.1 to "the harness file needs no loader; the **TS module under test does**"; (ii) add the loader-failure preflight line described in §4.1 (a `.ts`-resolution error ⇒ **BLOCKED**, never FAIL); (iii) note that the command is `[U-exec]` until the implementer runs it once and records the first 5 lines of output. I did not verify it by execution and the plan must not present it as verified.

#### NON-BLOCKING — notes, no action strictly required

- **`N-6f`.** A3's `results.length === 0` for `zzzznotfound` is robust for the named sentinel but depends on an unstated assumption about which database it runs against (§B3.1 preconditions say "either `p2test` or `public` is fine for auth" — true for auth, not a general statement). One clarifying clause is enough.
- **`N-6g`.** §B3.4's AC2 row lists `A13`, which tests the *empty-storage first visit*, not the reload path. Drop it from that row (or move it to AC4).
- **`N-6h`.** The round-1 observation about A11 being quoted in a PASS count is now **fixed** — the plan states the count is **13 (`S1`, `A1`…`A13`)** and explicitly says round 1's "11" was wrong. This is correct and I am recording it as **closed**, not as a residual nit.

---

### 8. Gate decision

**PART B: REVISE.**

The four round-2 blockers are **closed**, and closed properly — by changing the design where the design was wrong (real listener registry; implementing `ka:logout` with a latch) and by rewriting the assertion that conflicted instead of weakening the contract. The §B3.4 coverage table no longer overclaims, the render-gate limitation is explicitly manual, and the scope/diff discipline is sound and mechanically enforced.

What keeps this from approval is **document self-consistency, not design**: `N-6a` leaves A8's precondition ambiguous at exactly the seam where B-3 was closed; `N-6b` specifies an assertion (A11) that cannot pass as written; `N-6c`/`N-6d` are stale sentences and wrong cross-references that contradict the contract the round was spent establishing; `N-6e` asks the implementer to trust an unverified loader invocation while the plan's own summary says no loader is needed.

**Approval condition, precisely:** fix `N-6a`…`N-6e` in the plan text. They are confined to §B1.2 (one sentence), §B2.1 (one sentence + the A8 precondition), §B2.4 (one cross-ref), §B3.1a.1/`Rb-4` (wording + preflight line) and §B3.1a.4/§B3.4 (A11's spec, or A11's deletion). **No part of the Part B design, the writer contract C1–C5, the file set, or the AC coverage needs to change**, and `N-6f`…`N-6h` can ride along or be dropped. This is a proofreading-and-disambiguation pass on five localities; it does not warrant a fourth full round, and I will close it on inspection of those five places alone.

Implementation of **Part A** is unaffected by this section. Implementation of **Part B must not start** until `N-6a`…`N-6e` are closed.

DONE:PLAN_REVIEWER_P2B_R3

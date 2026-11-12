# IMPLEMENTATION — Phase 2, Part A (F2-A PostgreSQL full-text search correctness)

ROLE: IMPLEMENTER — Part A only. Part B was **not** started; no file under `web/**` was read for
editing, modified, or otherwise touched.
DATE: 2026-11-02
PLAN: `.pipeline/p2/PLAN.md` Part A (§A2.1–§A2.10, §A3.1–§A3.5), revision-log rows R1–R7.
REVIEW GATE: `.pipeline/p2/REVIEW.md` "ROUND 2 REVIEW — PART A: APPROVE" (`REVIEW.md:384-`) and its
condition *"Implementation of Part A may start now."* (`REVIEW.md:541`).

## STATUS: **IMPLEMENTED** (with 1 recorded plan-arithmetic deviation and 1 recorded plan-gap defect)

* Every assertion the plan, the review and the brief define was **run** and its measured value is
  recorded below and in `.pipeline/p2/evidence/`.
* `npx tsc --noEmit` → **exit 0**.
* Guards G1–G8 all hold on the seeded fixture (**G5 = 11, G6 = 9**).
* T-A1 pre-fix reproduction = **10**; live route returns **0**; `escalation` = **5**; the ordered
  sequence discriminates rank from tiebreak; the policy split is **5 / 4 / 1 / 0** (see D-3);
  the EXPLAIN rule row is #2 (Seq Scan, **99.580 ms < 200 ms**, no index change); a 100 000-char
  query returns **200**; a lexeme-less query returns **200 + []**.
* **One** test row FAILs: the plan's `-vpn` = **9** is not reproducible on this PostgreSQL
  (**11** measured, HTTP == SQL). See **D-2**.
* **One** finding outside the plan's test list: a *multi-word* ~128 889-char query returns **500**
  (`54001 stack depth limit exceeded`). This is **not** the 100 000-char case the brief asks about
  (that one is 200) and it is **not** claimed as a pass. See **D-5** and **FU-AC5-BIGQ**.

---

## 1. PLAN SECTIONS FOLLOWED

| Section | What I did |
|---|---|
| §A2.1 (root cause) | Implemented all three parts: match predicate, exactly one guard, deterministic tiebreaker. |
| §A2.2 (final SQL) | SQL copied **character-for-character** from the plan block into `search.ts` (verified by re-reading `search.ts:42-63`). `values: [policy, q, limitN]` unchanged; no `$4`. |
| §A2.3 (complete handler) | The handler body is the plan's TypeScript block; mapper (`:67-75`) and response (`:82`) byte-identical to baseline. |
| §A2.4 (guards) | One guard, plan's message verbatim. **No** lexeme-less 400 branch. |
| §A2.5 (`websearch_to_tsquery`) | Unchanged function; operator semantics asserted in T-A4 (10 cases) and T-A5. |
| §A2.6 (no rank threshold) | No threshold added. |
| §A2.7 (three-key tiebreaker) | `d.id ASC, c.start_char ASC NULLS LAST, c.id ASC` exactly as specified. |
| §A2.8 / §A2.9 (no index change, no CTE) | No index added; no CTE; single `pool.query`. |
| §A2.10 / AC7 | Response contract asserted in T-A8. |
| §A3.1 (`p2test` scratch schema) | `CREATE SCHEMA p2test`, server run against it, `DROP SCHEMA IF EXISTS p2test CASCADE`. Guards G1–G8 implemented and run. |
| §A3.2 (fixture) | Seeded; NF-A1 reconciled (see §5 and D-1). |
| §A3.2b (10 000-chunk EXPLAIN fixture) | Seeded inside `p2test`, `ANALYZE`d, EXPLAIN recorded, dropped with the schema. |
| §A3.3 T-A1…T-A10 | All run, one process each for the standalone tests (see §6). |
| §A3.4 P-0/P-1/P-2 | All run (P-0 deviation D-4). |
| §A3.5 C1→C4 cleanup + blobs by sha256 | Done; see §8. |
| §7.1 (allowed files) | `search.ts` changed; everything else is under `.pipeline/p2/`. See D-6 for the transient `server/scripts/` directory I created and removed. |

---

## 2. DIFF — one hunk per plan line it implements

`git` is not available in this project (`fatal: not a git repository`), so the diff below is taken
from the file itself (`server/src/routes/search.ts:24-65`) against the baseline hash in
`baseline.sha256` (`48d8fe6778e491817f0ca082007f4bed0f640a011ff8214bf82ece5453562aba`).

### Hunk 1 — the single guard (`search.ts:27` → `:31`)

```diff
-    if (!q || typeof q !== 'string') {
+    // ONE guard. Non-string / missing / blank q -> 400.
+    // Message is today's message, verbatim (search.ts:28) — no new contract string.
+    // Whitespace-only is now caught too (today "   " passes !q and yields 0 rows).
+    if (typeof q !== 'string' || !q.trim()) {
       res.status(400).json({ error: 'q (query string) is required' });
       return;
     }
+    // NO lexeme-less guard here. A non-blank but lexeme-less q ("the and or",
+    // "!!!", "-") deliberately falls through to the SQL: the empty tsquery
+    // matches nothing, so the caller gets 200 { results: [] } — the honest
+    // answer, and NOT the whole library. See PLAN §A2.4.
```
Implements **§A2.3 lines "ONE guard…" + §A2.4 + R1**. Message string untouched.

### Hunk 2 — the policy clause is parenthesised (§A2.2 difference 1)

```diff
-        WHERE d.access_policy = $1 OR $1 = '*'
+        WHERE (d.access_policy = $1 OR $1 = '*')
```

### Hunk 3 — the match predicate (§A2.2 difference 2; the actual root-cause fix)

```diff
+          AND to_tsvector('english', c.text) @@ websearch_to_tsquery('english', $2)
```

### Hunk 4 — the three-key tiebreaker (§A2.2 difference 3 / §A2.7)

```diff
                  ) DESC
+                 ) DESC,
+                 d.id ASC,
+                 c.start_char ASC NULLS LAST,
+                 c.id ASC
         LIMIT $3
```
(shown compressed; the real text is `) DESC,` followed by the three keys on their own lines.)

**Lines that did NOT change (proved by the diff):** the `SELECT` column list, `FROM`/`JOIN`,
`ts_rank(...)` arguments, `LIMIT $3`, `values: [policy, q, limitN]`, the mapper and the JSON
response. Confirmed by reading `search.ts:42-82` after the edit.

---

## 3. FILES

### Modified (1)
| File | Baseline sha256 | Now |
|---|---|---|
| `server/src/routes/search.ts` | `48d8fe67…2aba` | `28ddd1356a10669b994c1e39c0b87796b0a24b7db57709c6663d0c35337cc33c` |

### Created under `.pipeline/p2/` (evidence, notes, harness)
| Path | Purpose |
|---|---|
| `IMPLEMENTATION-A.md` | this report |
| `seed_fixture.sql` | §A3.2 fixture + the NF-A1 reconciliation note (9 docs / 11 chunks) |
| `run_guards.sh` | G1–G8, one psql call per guard |
| `reset_bulk.sh` | removes only `p2-bulk-*` / `p2-upload.txt` rows inside `p2test` (no `TRUNCATE`, no `DROP TABLE`) |
| `probe_bigquery_limit.sql` | FU-AC5-BIGQ probe (read-only) |
| `scripts/p2_partA_runner.mjs` | T-A1…T-A10 + G5/G6 (HTTP + SQL cross-check) |
| `scripts/p2_discrimination.mjs` | the A-7 discrimination proof (fixed vs ROUND-0 SQL) |
| `scripts/p2_bigquery.mjs` | the 100 000-char (and larger) query test |
| `scripts/p2_baseline_probe.mjs` | read-only DB state probe (before/after cleanup) |
| `scripts/p2_psql.sh` | psql wrapper (throw-away `PGPASSFILE`, `-X`, `ON_ERROR_STOP`) |
| `scripts/p2_start_p2test.sh` | P-0 launcher (`npx tsx src/index.ts` against `p2test`) |
| `scripts/p2_gen_admin_hash.mjs` | bcrypt hash of the **demo** password for `p2test.admins` (self-checks against the app's bcryptjs) |
| `scripts/p2_url_shape.mjs`, `scripts/p2_env_trailing.mjs` | redacted diagnostics used to find D-4 |
| `scripts/p2_freshsession_probe.mjs` | FU-AC5-BIGQ threshold probe, one fresh connection per case |
| `evidence/16-fresh-session-threshold.txt` | `13 000 terms → OK`, `≥14 000 terms → 54001`, repeatable |
| `evidence/17-final-db-state.txt` | post-cleanup DB state, re-measured after the report was written |
| `evidence/00-baseline-preflight.txt` | DB state **before** any write |
| `evidence/01-seed-and-guards.txt` | seed + G1–G8 (first run) |
| `evidence/02-p0-first-attempt.txt` | the **failed** first `P-0` boot (verbatim) |
| `evidence/03-sql-match-counts.txt` | per-query SQL match counts |
| `evidence/04-discrimination.txt` | A-7 |
| `evidence/05-preflight-p0-p1-p2.txt` | P-0 / P-1 / P-2 |
| `evidence/06-tests-T-A1-T-A10.txt` | the full T-A run (253 lines, 50 PASS / 1 FAIL) |
| `evidence/07-explain-10k.txt`, `11-bigquery-threshold.txt` | EXPLAIN + FU-AC5-BIGQ probe |
| `evidence/08-guards-pre-run.txt` | guards immediately before the authoritative run |
| `evidence/09-bigquery-100k.txt` | 100k / 128 889-char / 100 001-char query results |
| `evidence/10-large-query-500-cause.txt` | SQL-level reproduction of 54001 |
| `evidence/12-cleanup-c1-c2.txt`, `13-cleanup-c3-c4.txt`, `14-blobs.txt`, `15-baseline-check.txt` | cleanup proof |

### Touched and restored
| Path | Status |
|---|---|
| `server/scripts/` (9 helper files) | **Created by me, then removed**; contents relocated to `.pipeline/p2/scripts/`. The directory did not exist before (`ls --time-style` showed it created 2026-11-02; `baseline.sha256` has no `server/scripts` entry). Deviation **D-6**. |
| `server/.p2tmp/` | transient scratch (logs, token, fixtures) — removed |
| `server/.p2token.tmp` | transient 213-char bearer token — **deleted at the end of this task** |
| `server/data/uploads`, `data/extracts` | were empty (0 files), are empty again (blobs removed by exact sha256, §8) |
| `server/data/tmp` | multer scratch, empty |

`server/data/**` and `server/dist/**` are not baseline members.

---

## 4. CHECKS ACTUALLY RUN — verbatim output

### 4.1 A-4 type check
```
$ cd server && npx tsc --noEmit; echo "exit=$?"
npm notice New major version of npm available! 11.19.1 -> 12.2.1
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.1
npm notice To update run: npm install -g npm@12.2.1
npm notice
exit=0
```
(Re-run after the final source state: `tsc_exit=0`.)

### 4.2 A-2 preflight
**P-0** — no server was running before I started (`curl` → `Failed to connect`, `netstat` empty).
Started with the plan's entry point:
```
$ bash scripts/p2_start_p2test.sh
starting: npx tsx src/index.ts (PGOPTIONS=-c search_path=p2test)
[db] connected to PostgreSQL and schema initialized
[server] listening on 127.0.0.1:4000
$ curl -sS -w '\nHTTP=%{http_code}\n' http://127.0.0.1:4000/api/health
{"ok":true,"service":"knowledge-app","time":"2026-11-02T05:19:11.494Z"}
HTTP=200
```
The **first** attempt at the plan's literal command failed — its verbatim output is kept in
`evidence/02-p0-first-attempt.txt`:
```
[server] failed to start: error: database "knowledge_app&options=-c search_path%3Dp2test" does not exist
    ... code: '3D000' ... routine: 'InitPostgres'
```
Cause and fix: **D-4**.

**P-1** — demo pair only, token value never printed:
```
login HTTP=200
token acquired: 213 chars; user = admin
```

**P-2** — positive proof that the live code is the fixed code (run after seeding, G5 = 11):
```
status=200 results=0 limit=0 query="zzzznotfound"
```
→ **0**, i.e. the running binary is the fixed code, not a stale `dist/index.js`.

### 4.3 A-5 seed + guards G1–G8 (`evidence/01-seed-and-guards.txt`, `08-guards-pre-run.txt`)
```
=== SEED (server/src/db/schema.ts DDL + §A3.2 fixture) ===
psql:...seed_fixture.sql:36: NOTICE:  extension "pgcrypto" already exists, skipping
seed: OK

=== GUARDS (each run with SET search_path = p2test) ===
G1   current_schema()                             expected=p2test actual=p2test PASS
G2   public plans documents+chunks exist          expected=2      actual=2      PASS
G2b  public.chunks rows (fixture invisible there) expected=0      actual=0      PASS
G3   f1test.documents untouched                   expected=182    actual=182    PASS
G4   p2test docs not named p2-*                   expected=0      actual=0      PASS
G5   p2test.chunks (G5 = 11)                      expected=11     actual=11     PASS
G6   p2test.documents (G6 = 9)                    expected=9      actual=9      PASS
G7   p2test.admins (R7 side effect)               expected=1      actual=1      PASS
G8   pg_namespace p2test = 1 (pre-DROP)           expected=1      actual=1      PASS
guard_failures=0
```
**NF-A1 reconcilation (stated before seeding).** The plan's §A3.2 creation order says *"upload the
three `.txt` docs that only need one chunk each"*, but ingestion uses
`words:300, overlapWords:50, minWords:20` (`service.ts:173-177`) and `createChunker` **drops any
chunk with fewer than 20 words** (`chunker.ts:20,80-`). Both `.txt` texts in the table are **8
words**, so every one of those documents is single-chunk and **would be dropped** — documents would
be 7 + 2 = 9 but chunks 10 + 2 = 12, and if the ingest path were really used the chunks would be
**10**. The review reached the same "10 + 2 derived vs 11 asserted" cell (`REVIEW.md:481`).
Reconciled counts I seeded and G5/G6 assert: **9 documents / 11 chunks** —
`main 3 + trusted 1 + restricted 1 + stop 1 + junk 1 + nomatch 1 + zulu 2 = 10`, plus
`p2-doc-api` (1 chunk) = **11**; `p2-doc-brief` is inserted as a document with **0 chunks** (a legal
state — `schema.ts` has no chunks-per-document constraint) and is named in `seed_fixture.sql` so no
row is hidden. Consequence: all 11 chunks are direct `INSERT`s; **ingestion-path realism is carried
by T-A10** (a real multipart upload of a >20-word file). Recorded as **D-1**.

### 4.4 EXPLAIN on the 10 011-chunk fixture (`evidence/07-explain-10k.txt`, `06…:212-233`)
```
Limit  (cost=6350.45..6350.47 rows=10 width=88) (actual time=99.504..99.506 rows=10.00 loops=1)
  ->  Sort  (cost=6350.45..6375.45 rows=10000 width=88) (actual time=99.503..99.504 rows=10.00 loops=1)
        Sort Method: top-N heapsort  Memory: 27kB
        ->  Hash Join  (cost=650.20..6134.35 rows=10000 width=88) (actual time=1.815..97.641 rows=10000.00 loops=1)
              ->  Seq Scan on chunks c  (cost=0.00..2932.89 rows=10000 width=84) (actual time=0.140..47.469 rows=10000.00 loops=1)
                    Filter: (to_tsvector('english'::regconfig, text) @@ '''lorem'''::tsquery)
                    Rows Removed by Filter: 11
              ->  Hash  (...)  ->  Seq Scan on documents d (...)
Planning Time: 0.206 ms
Execution Time: 99.580 ms
```
**Rule row 2 fires: `Seq Scan` and `Execution Time 99.580 ms < 200 ms` → PASS, decide nothing,
change nothing. No `FU-PERF-1` is raised.** Note the plan's §A2.8 expectation that the predicate
"is index-usable" is true of the *expression*, but the planner did **not** choose
`Bitmap Index Scan on chunks_fts_idx` on this fixture because every bulk chunk matches `lorem`
(10 000 of 10 011 rows); see FU-PERF-2.

---

## 5. TEST MATRIX (id → assertion → measured → verdict)

Run: `node scripts/p2_partA_runner.mjs` → `evidence/06-tests-T-A1-T-A10.txt`,
`SUMMARY PASS=50 FAIL=1 BLOCKED=0 RATE-LIMITED(429s)=0 httpRequests=53`, plus the standalone
`p2_discrimination.mjs` and `p2_bigquery.mjs`.

| id | assertion | measured | verdict |
|---|---|---|---|
| G5 | `count(*) chunks == 11` | `11` | PASS |
| G6 | `count(*) documents == 9` | `9` | PASS |
| T-A1 | `zzzznotfound` → HTTP 200 | `200` | PASS |
| T-A1a | `.results\|length == 0` | `0` | PASS |
| T-A1b | `.limit == 0` | `0` | PASS |
| T-A1c | `.query == "zzzznotfound"` | `"zzzznotfound"` | PASS |
| **T-A1d** | **pre-fix reproduction == 10** (no-predicate SQL, `LIMIT 10`) | **`10`**, all `ts_rank = 0` | PASS |
| T-A2a | `apricot marmalade` → 1 result, `p2-doc-nomatch` | `len=1 ["p2-doc-nomatch"]` | PASS |
| T-A2b | set equality HTTP vs SQL for `escalation` | 5 ids identical both sides | PASS |
| T-A2c | cardinality == 5 | `5` | PASS |
| T-A2d | no duplicate `chunk_id` | `5 vs 5` | PASS |
| T-A3a | HTTP sequence == fixed-SQL sequence (`escalation pager`) | `[0a, 09, 01]` == `[0a, 09, 01]` | PASS |
| **T-A3b** | **rank-less order ≠ fixed order (else BLOCKED)** | rankless `[01, 09, 0a]` vs fixed `[0a, 09, 01]` | PASS |
| — | measured ranks | `zulu#0a 0.09910 > zulu#09 0.09736 > main#01 0.09524` | (evidence) |
| T-A4 `backup` | 1 | `http=1 sql=1` | PASS |
| T-A4 `backup vault` | 1 | `1 / 1` | PASS |
| T-A4 `backup apricot` | 0 | `0 / 0` | PASS |
| T-A4 `apricot marmalade` | 1 | `1 / 1` | PASS |
| T-A4 `apricot or vault` | 2 | `2 / 2` | PASS |
| **T-A4 `escalation`** | **5** | **`5 / 5`** | PASS |
| T-A4 `"escalation procedure"` | 2 | `2 / 2` | PASS |
| T-A4 `"procedure escalation"` | 0 | `0 / 0` | PASS |
| T-A4 `escalation pager` | 3 | `3 / 3` | PASS |
| T-A4 `escalation -pager` | 2 | `2 / 2` | PASS |
| T-A5 `the and or` | 200 + `[]`, `limit 0` | `200 n=0 limit=0` | PASS |
| T-A5 `!!!` | 200 + `[]` | `200 n=0 limit=0` | PASS |
| T-A5 `-` | 200 + `[]` | `200 n=0 limit=0` | PASS |
| T-A5 missing / `""` / `"   "` / `null` / `123` | 400, message verbatim | all `400 {"error":"q (query string) is required"}` | PASS (5 rows) |
| T-A5 `-vpn` (contract) | HTTP == SQL | `http=11 sql=11` | PASS |
| **T-A5 `-vpn` (plan value 9)** | **results == 9** | **`11`** (lexeme-bearing `9`, empty-tsvector `2`) | **FAIL — D-2** |
| T-A6a | hostile inputs ∈ {200,400} | all `{200,400}` (11 payloads incl. both SQL-injection strings) | PASS |
| T-A6c | injections deleted nothing | `chunks=11 documents=9` | PASS |
| T-A6d | limit torture 2xx, 0..50 results | `0→5, -1→1, 1→1, 50→5, 51→5, 1e6→5, "abc"→5, null→5, 1e309→5` | PASS |
| **T-A6b / brief "100k-char → 200 not 500"** | status 200 | `100 000 chars → HTTP 200 in 70 ms, results=0` | **PASS** |
| — | `100 001 chars` (`escalation` + 99 990 filler) | `HTTP 200, results=5` | PASS |
| T-A7 | policy split 5 / **4** / **1** / **0** | wildcard `5` {public,trusted}; `public` `4`; `trusted` `1`; `restricted` `0` | PASS (see D-3) |
| T-A7 | wildcard reaches restricted (`salary`) | `1` | PASS |
| T-A7 | explicit `public` excludes it (`salary`) | `0` | PASS |
| T-A8a | top-level keys `[limit,query,results]` | identical | PASS |
| T-A8b | 8 element keys on every row | `8 keys on all 5 rows` | PASS |
| T-A8c | `document_id`/`chunk_id`/`text` are strings | `true` | PASS |
| T-A9a | `public` index set unchanged | `["chunks_fts_idx","chunks_pkey","documents_pkey"]` | PASS |
| T-A9b | bulk fixture 10 000 docs / 10 011 chunks | `chunks=11→10011 bulkDocs=10000` | PASS |
| T-A9c | EXPLAIN rule row | row 2 (`Seq Scan`, 99.580 ms) | PASS |
| T-A10a | upload accepted, 1 result | `status=200 results=1` (`chunkCount:1`, `chunkIds:["chunk-0-32"]`) | PASS |
| T-A10b | uploaded doc searchable | `hit=true` | PASS |

**RATE-LIMITED:** one `429` occurred in an **earlier, non-authoritative** run (on `limit:"abc"`);
it was recorded as RATE-LIMITED, the runner slept 60 s and retried, and the same run then completed.
The authoritative run above had **0** 429s (`httpRequests=53`).

**Test ordering:** T-A10 ran **last** (it changes the counts: 10 010 docs / 10 012 chunks
afterwards), per the plan's sequencing rule. The authoritative run therefore ended with
G5/G6 deliberately not 11/9 — that is why cleanup re-asserted the p2- prefix scope instead (§8).

---

## 6. DISCRIMINATION PROOF (A-7) — `evidence/04-discrimination.txt`

Same seeded fixture (`p2test`, 11 chunks), same `q='zzzznotfound'`, three statements:

```
schema in force: p2test
chunks in fixture: 11

=== STATEMENT 1 — FIXED (with match predicate) ===
rows returned for q='zzzznotfound': 0
=== STATEMENT 2 — ROUND-0 (shipped pre-fix form, no predicate) ===
rows returned for q='zzzznotfound': 10
  first 3: [["p2-doc-main","The N2N escalation procedure"],["p2-doc-main","Backup rotation runs nightly"],["p2-doc-main","The N2N escalation procedure"]]
  every pre-fix row has ts_rank: [0,0,0]

=== STATEMENT 3 — the LIVE HTTP route (fixed search.ts under tsx) ===
status=200 results=0 limit=0 query="zzzznotfound"

DISCRIMINATION: fixed=0 round0=10 http=0 -> PROVEN (fixed 0 vs round-0 10 on the same fixture)
```
The ROUND-0 text in that script is the pre-fix statement verbatim (no predicate, single-key
`ORDER BY`), matching the baseline file's sha256 `48d8fe67…`. **Conclusion: the fixture is not
vacuous (11 chunks) and the fix, not the fixture, is what turns 10 into 0.**

---

## 7. CLEANUP PROOF (A-8, §A3.5 C1→C4) — `evidence/12…15`

**C1 / C2 (before DROP)** — `evidence/12-cleanup-c1-c2.txt`:
```
G7   p2test.admins (R7 side effect)  expected=1  actual=1  PASS
G8   pg_namespace p2test = 1 (pre-DROP) expected=1 actual=1 PASS
=== C1 p2test.admins BEFORE drop ===
1
admin
=== bulk + upload rows present (all p2-) ===
10000|1|0        <- bulk=10000, upload=1, other(NOT LIKE 'p2-%')=0
```
`p2test.documents = 10 010`, `p2test.chunks = 10 012` at that point (the §A3.2b bulk fixture plus
the T-A10 upload) — so G5/G6 read `10012/10010` in that file; that is the post-T-A10 state, by design.

**C3 (the only destructive statement)** — `evidence/13-cleanup-c3-c4.txt`:
```
$ psql -c 'DROP SCHEMA IF EXISTS p2test CASCADE;'
NOTICE:  drop cascades to 5 other objects
DETAIL:  drop cascades to table p2test.documents
drop cascades to table p2test.chunks
drop cascades to table p2test.access_policies
drop cascades to table p2test.audit_log
drop cascades to table p2test.admins
DROP SCHEMA
```

**C4 (after DROP)** — same file, `p2_baseline_probe.mjs`:
```
schemas          [{"nspname":"f1test"},{"nspname":"public"}]
public.documents [{"n":0}]
public.chunks    [{"n":0}]
public.admins    [{"n":1}]
public.audit_log [{"n":0}]
public.access_policies [{"n":0}]
f1test.documents [{"n":182}]
f1test.chunks    [{"n":170}]
f1test.admins    [{"n":0}]
f1test.audit_log [{"n":0}]
indexes          chunks_fts_idx | chunks_pkey | documents_pkey   (defs unchanged)
p2test           [{"n":0}]
```
`f1test` is **identical to the pre-work baseline** (`documents 182`, `chunks 170`, captured in
`evidence/00-baseline-preflight.txt` before any write). `public` is `documents=0, chunks=0,
admins=1, audit_log=0` — exactly the baseline.

**Upload blobs (§A3.5, by exact sha256)** — `evidence/14-blobs.txt`:
| sha256 | When | Removed |
|---|---|---|
| `182e00763453ee64d26d0df75871b064f9b93de3b7425e1e9e5c853db4047d38` | successful T-A10 upload (recorded **before** upload) | `data/uploads/<sha>.txt` + `data/extracts/<sha>.txt` removed |
| `450c43152861cd178f02e02b1c2e6bd58025f62a2f57f5a91b16539c81b342d7` | **failed** first T-A10 attempt (dedupe short-circuit, no DB row) | removed by exact path before the rerun |
Final state: `uploads=0 extracts=0`, `data/tmp` empty.

**Baseline (`evidence/15-baseline-check.txt`)**
```
$ sha256sum -c .pipeline/p2/baseline.sha256
server/src/routes/search.ts: FAILED
sha256sum: WARNING: 1 computed checksum did NOT match
EXIT=1
lines: 36   OK count: 34
```
All 35 baseline members are present; **the only new FAILED line is `server/src/routes/search.ts`**.
(35 = 34 `: OK` + 1 `FAILED`; the 36th line is the `WARNING`.)

---

## 8. DEVIATIONS (each with what the plan said, what I did, and why)

| id | Plan / brief said | What happened | Disposition |
|---|---|---|---|
| **D-1** | §A3.2: 9 docs / **11** chunks, with three `.txt` docs created by upload | The two `.txt` texts are 8 words < `minWords=20`, so the ingest path drops them → 11 is unreachable via upload (10 or 12). **NF-A1.** | Seeded 9 docs / 11 chunks by direct `INSERT` (11th chunk = `p2-doc-api`; `p2-doc-brief` = 0 chunks), documented inside `seed_fixture.sql`; ingestion is exercised by T-A10. G5/G6 asserted 11/9 as the plan requires. **No assertion weakened.** |
| **D-2** | §A3.3 / T-A5: `-vpn` → **9** ("11 − stop#1 − junk#1") | **11** measured, HTTP == SQL == the plan's own negative-control query. On PG **18.6**, an **empty** tsvector **satisfies** a pure negation (`to_tsvector('english','the and or') @@ websearch_to_tsquery('english','-vpn')` → `true`), so `stop#1`/`junk#1` are *not* excluded. The plan's parenthetical arithmetic is wrong, not the code. | Recorded as **FAIL against the plan's literal value**, with the reason quoted from the measurement. The **contract** assertion (HTTP == SQL) passes. **I did not edit the plan.** The fix is unaffected. |
| **D-3** | §A3.3 T-A7 case 1: "no policy argument" → `unique(policy)==["public"] and len==4` | Omitting `policy` yields `policy='*'` (`search.ts:26`), i.e. the wildcard → `len=5` over `{public,trusted}`. The 4/4/1/0 split belongs to an explicit `policy='public'`. | Asserted both: wildcard = 5 across two policies; `public`=4, `trusted`=1, `restricted`=0. The required split **4/4/1/0 is measured and matched** (4 = public; 1 = trusted; 0 = restricted). |
| **D-4** | §A3.4 P-0: `DATABASE_URL="$(… grep … .env …)&options=-c%20search_path%3Dp2test" npx tsx src/index.ts` | Failed verbatim: `database "knowledge_app&options=-c search_path%3Dp2test" does not exist` (`evidence/02`). `npx` normalises env names, so lower-case `options` reaches the child as `OPTIONS`, libpq ignores it, and Postgres reads it as part of the dbname. (The `.env` line also has a trailing `\r`, which my `sed/tr` strip handles.) | Used the libpq-native `PGOPTIONS="-c search_path=p2test"` with `DATABASE_URL` **byte-identical**. Proven: every guard runs with `current_schema() = p2test` and the whole suite saw only fixture rows. |
| **D-5** | Brief / T-A6: "the 100k-char query must return 200, not 500" | **100 000 chars → 200** (holds). But a **multi-word** query of **≥ 14 000 terms / ≥ 86 889 chars** returns **500** — `error: stack depth limit exceeded`, SQLSTATE **54001**, from `search.ts:41`; measured deterministically on fresh connections (`evidence/16`). The predicate is a **necessary** trigger: the same query in the ROUND-0 (no-predicate) form returns 10, and via the fixed predicate it raises 54001 (`evidence/10`). 13 000 terms (79 889 chars) is fine. | Reported, **not** claimed as a pass, and **not** fixed: it is outside §A2's approved diff (a length/term cap would be a **new 400/413 branch**, precisely the R1 pattern the review rejected). Raised as **FU-AC5-BIGQ**. |
| **D-6** | §7.1 / task brief: only `search.ts` + `.pipeline/p2/**` | I first wrote 9 harness files into a **new** `server/scripts/` directory (it did not exist before; not a baseline member, so `sha256sum -c` could not have caught it). | Detected by me during the file audit, **relocated to `.pipeline/p2/scripts/`, `server/scripts/` removed**, and one moved script re-executed afterwards to prove it still works. Verified by `find server web -newermt …` that only `search.ts` remains modified outside `.pipeline/p2`. |
| **D-7** | §A3.4 psql invocation (`$PSQL -c …` with `PGPASSWORD`) | `psql.exe` on Windows **requires a terminal** for the password (`stdin is not a tty`), and Node cannot `exec` the MSYS path `/d/Install/…`. | `scripts/p2_psql.sh` writes a throw-away `PGPASSFILE` (mode 600, deleted on exit) and keeps `-X`, `ON_ERROR_STOP=1` and the explicit `SET search_path = p2test`. The password is never printed. |
| **D-8** | jq assumed (`§A3.3`, flagged as an assumption at `:452`) | **`jq` is not installed** on this machine (`which jq` → not found). | Used the plan's own A-4 fallback (`node` instead of `jq`); every assertion was evaluated in Node with explicit `assertion:`/`measured:` output. |
| **D-9** | §A3.1 expects the boot to log `[db] default admin created (admin / admin123)` | I pre-seeded `p2test.admins` with a real bcrypt(cost 10) hash of the demo password so P-1 could log in and G7=1 held before boot; `ensureDefaultAdmin()` then found the row and did **not** insert. | The R7 side effect is still **observed** (G7 = 1, `C1` records `1 / admin`) — it just arrived via the seed rather than the first boot. No `public.admins` write occurred. |

---

## 9. LIMITATIONS

1. **Part B not done** (correctly). No `web/**` file was touched. The `FU-1` page-level pin
   (`/dashboard/library`, `/dashboard/audit` rendering the 400 text) was **not** exercised in a
   browser — no browser was driven in this task; only the API routes were probed:
   `GET /api/library → 200`, `POST /api/library → 404`, `GET /api/audit → 200 {"rows":[]}`,
   `POST /api/audit → 404`. That is API-level, not page-level.
2. **G3** (`f1test.documents = 182`) is asserted; `f1test.chunks = 170` is also recorded and equal
   before/after, but it is not a plan guard.
3. The **EXPLAIN** figure is one measurement on one machine (Windows, PG 18.6, 10 011 chunks,
   warm-ish cache: `shared hit=730`, no reads). Timings are not stable to ±20 ms.
4. `limit:"abc"` and `1e309` both serialise to `null` over JSON, so the plan's torture list has two
   duplicate cases in practice; both pass. Not a code issue (`search.ts:39` is unchanged by Part A).
5. The runner's SQL cross-checks build statements by **string interpolation of fixture-owned
   constants** (query strings, policy). The **route under test** is fully parameterised; this only
   affects the test harness, and no user input reaches it.
6. **T-A9's 10 000-row bulk fixture** proves planner behaviour at 10 k chunks, not at production
   scale.
7. `ts_rank` ordering on this fixture was **measured**, not assumed: the plan's own `[U]` note
   ("`Pager escalation.` outranks `main#1`") turned out to be **true**
   (0.09910 vs 0.09524), and the mutation check passed (rank-less order differs).
8. The harness now lives in `.pipeline/p2/scripts/`, i.e. **outside** `server/`. ESM resolves `pg`
   relative to the script, so any script there that needs `pg` must import it by absolute path
   (as `p2_freshsession_probe.mjs` does) **or** be run with its CWD in `server/` and a path-safe
   import. Everything that produced the recorded evidence was run with CWD `server/`; the
   `p2_psql.sh` wrapper `cd`s there itself.

---

## 10. FOLLOW-UPS

* **FU-AC5-BIGQ (new, from D-5).** A multi-word query of roughly **≥ 86 889 characters (≥ 14 000
  distinct terms)** returns **500** with `54001 stack depth limit exceeded` from `search.ts:41`'s
  catch-all. Measured on **fresh connections, one per case** (`evidence/16-fresh-session-threshold.txt`):
  `13 000 terms / 79 889 chars → OK`; `14 000 / 86 889 → ERROR 54001`; repeat runs of 14 000/15 000/20 000
  all error identically, so the threshold is **deterministic** on a fresh session (my earlier
  identical-size OK/error flapping came from reusing one session across many oversized statements).
  The failure is in `websearch_to_tsquery` building a left-deep `AND` tree
  (`'w1' & 'w2' & …`), not in reading rows: it reproduces against an empty table.
  The predicate is a **necessary** trigger — the ROUND-0 form with no predicate returns 10 for the
  same input (`evidence/10`). Suggested direction, **not implemented** because it is outside the
  approved diff and would add a new error branch (exactly the R1 pattern the review rejected): cap
  `q` length or term count before the query. Note the asymmetry that matters for AC5: a **single**
  100 000-char word is fine (200); it is many **terms** that overflows the recursion.
* **FU-LIB-AUDIT-2 (carried, the "Library/Audit return everything" dependency).** `GET
  /api/library` returns rows with no `q`, and that path is **not** touched by F2-A — this phase
  neither fixes nor breaks it. The plan's T-A8 "page-level check" exists only to **pin FU-1 as
  unfixed**; it was **not** performed (no browser). Do not cite it as AC7 evidence.
* **FU-PERF-2 (new, EXPLAIN note).** The plan's §A2.8 says the predicate is index-usable, and it is
  — but on the §A3.2b fixture the planner chose `Seq Scan on chunks` because **10 000 of 10 011
  rows match** (`Rows Removed by Filter: 11`); a GIN bitmap scan cannot win on that selectivity.
  Per the plan's rule this is row 2 → **no index change**, and no `FU-PERF-1` is raised. Revisit
  only if a future phase measures a *selective* query at scale (>1 M chunks) and still sees a
  seq scan.
* **FU-INGEST-DEDUPE.** `ingestFile()` dedupes by content hash and returns `chunkCount: 0` with
  **no document row** for byte-identical re-uploads (`service.ts:140-143`). This made my first
  T-A10 attempt look like a "zero chunks" failure. It is by design, but the response body
  (`200` with `results:[{chunkCount:0}]`, `documentId` = content hash) is indistinguishable from a
  failed parse to a caller. Worth a note for the frontend.
* **FU-NFA1 (plan hygiene).** `.pipeline/p2/PLAN.md` should record the NF-A1 reconciliation in
  §A3.2 rather than in an implementer note, and correct the `-vpn` = 9 arithmetic (D-2). I did not
  edit the plan (not my file).
* **FU-P2-HARNESS.** The harness now lives in `.pipeline/p2/scripts/`; if a future phase wants it
  as a real test, it should move under a `__p2__` directory of `.test.ts` files (and `tsc` would
  need a matching project, since `tsconfig.json` only excludes `**/*.test.ts`, a
  `server/src/routes/__p2__/*.test.ts` path would satisfy that glob).

---

## 11. HONESTY STATEMENT

Every number in this report came from a command I ran in this session and whose output is stored
in `.pipeline/p2/evidence/`. Nothing is copied from the plan or the review as if it were measured.
The three cases the brief calls out that could hide a failure — a vacuous 0-result test, a
rank-less test that cannot discriminate, and an assertion I tuned until it passed — were each
addressed by measurement: the fixture is 11 chunks and the ROUND-0 form returns 10 on it; the
rank-less order differs from the fixed order; and the one assertion that **fails** (the plan's
`-vpn` = 9) is left failing and explained rather than edited.

DONE:IMPLEMENTER_P2A

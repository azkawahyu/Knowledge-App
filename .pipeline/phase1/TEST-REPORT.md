# TEST REPORT — Phase 1: Fix Multipart Document Upload

**Role:** Independent Test Engineer. **Scope:** verify the delivered code against the approved plan by executing the suite. No source file was modified (proof: baseline re-run at the end, §9).

---

## 1. VERDICT

# **PASS (with one documented security follow-up, F1)**

Every in-scope functional assertion from PLAN §7 T0–T15 plus the five extra checks **passed when executed**. Nothing was "reasoned" as passing: every status code below is pasted from a run.

| | |
|---|---|
| Tests executed with assertions | **T0, T1, T1b, T2, T3, T4, T5a, T5b, T6, T7, T8a, T8b, T9, T10, T11, T13a–T13e, T14, T15a–T15c, T12, EXTRA 1–5** — 31 checks/request assertions |
| Hard failures | **0** |
| Findings | 1 security follow-up (**F1**, orphan blob on ingestion failure), 4 minor observations (F2–F5), 1 plan/test-harness caveat (H1) |
| UI verification level reached | **BROWSER** (§5) — real Chromium, real Next.js dev server on :3000, real app login form, real `onDrop` handler → **200 ingest through the UI** |
| Temp-file leaks (any failure case) | **0** — `find server/data/tmp -name 'tmp-*'` = 0 after **every** case |
| DB after cleanup | `documents=0 chunks=0 admins=1 audit_log=0`, uploads == T2 listing, extracts empty, tmp empty, fixtures dir empty |

Why F1 does not change the verdict: the orphan blob is behaviour the plan **explicitly designed and documented** (see §8). It is a real defect-graded security issue that must be fixed, but it is *out of the approved contract* rather than a regression of it — so this phase is a contract PASS with F1 carried forward.

---

## 2. ENVIRONMENT

| Item | Value |
|---|---|
| Host | Windows, git-bash (MINGW64). **MSYS path translation is DISABLED** — see H2 |
| Project root | `D:/Develop/knowledge-app` |
| Node / npm | `v24.22.1` / `11.19.1` |
| TypeScript | `npx tsc --noEmit` → **exit 0** |
| Server | `npx tsx src/index.ts` → `[db] connected to PostgreSQL and schema initialized` / `[server] listening on 127.0.0.1:4000` |
| DB | PostgreSQL 18, `psql D:/Install/PostgreSQL/18/bin/psql.exe -h 127.0.0.1 -p 5432 -U knowledge_app -d knowledge_app` |
| Web | `npm run dev` in `web/` → `▲ Next.js 14.2.35`, `✓ Ready in 14.1s`, `http://localhost:3000` (read-only; no source touched) |
| Browser | Real Chromium session (browser-use) on `http://localhost:3000` |
| `command -v pdftotext` | `/mingw64/bin/pdftotext` ← **recorded verbatim as Q5 requires** |
| Credentials | Loaded from `server/.env` via a BOM-stripping preamble; never echoed, never passed on a command line |
| Rate limit | `/api` = 100 req/min; no 429 occurred in any run |

Baseline at T0: `documents=0 chunks=0 admins=1 audit_log=0`; `server/data/uploads` empty; `server/data/tmp` empty; `server/data/extracts` empty.

---

## 3. TEST MATRIX

Legend: **PASS** = assertion executed and satisfied; evidence is a verbatim quote from `run-full.log`, `run-extra.log`, `run-t12.log` (kept in `.pipeline/phase1/`) or from the live browser session.

### T0 — Preconditions
| Cmd | Result | Evidence |
|---|---|---|
| `command -v pdftotext` | recorded | `/mingw64/bin/pdftotext` |
| `curl /api/health` | **200** | `{"ok":true,"service":"knowledge-app","time":"2026-10-28T07:40:13.945Z"} [200]` |
| ports | free before start | `no listeners on 3000/4000` |

### T1 — Typecheck (AC9) — **PASS**
```
npx tsc --noEmit
exit=0
```

### T1b — Baseline integrity (AC10) — **PASS**
```
$ cd /d/Develop/knowledge-app && sha256sum -c .pipeline/phase1/baseline.sha256
server/src/routes/ingest.ts: FAILED
server/package.json: FAILED
server/package-lock.json: FAILED
... (24 lines ': OK')
sha256sum: WARNING: 3 computed checksums did NOT match
OK lines: 24 ; FAILED lines: 3 ; web/** failures: none
```
✅ exactly the three allowed files failed; 24/27 still print `OK`; **no `web/**` line failed**.

### T2 — Login + baseline gate — **PASS**
```
token length: 213 (expect > 100)
documents=0 chunks=0
admins=1 audit_log=0
BEFORE_UPLOADS listing: [] (files=0)
pre-existing document hashes: 0
baseline gate: documents=0 (want 0) chunks=0 (want 0) uploads=0 (want 0) tmp=0 (want 0)
```

### T3 — Fixtures + single-file happy path (AC1–AC4, AC8) — **PASS**
```
status 200 OK  [single file]
response: {"results":[{"documentId":"1769681e-c806-49f1-8ff9-3bf655f82bf6","contentHash":"adc2bbb0...5f02","name":"p1-ok3.txt","kind":"txt","accessPolicy":"restricted","chunkCount":1,"chunkIds":["chunk-0-162"],"textLength":1248,"savedAt":"2026-10-28T07:49:55.349Z"}],"errors":[]}
envelope OK (results.length=1, errors.length=0, all 9 result fields, chunkCount=1, kind=txt)
contentHash == sha256(file) OK
documents.kind=txt OK
documents.size_bytes=1248 OK
default access_policy=restricted OK
documents.status=pending (pending is expected per plan)
SQL chunks (1) == response.chunkCount (1) OK
exactly one documents row for this sha256 OK
AC4 blob <hash>.txt present OK (adc2bbb0...5f02.txt)
status 200 OK  [unicode filename accepted]
response.name bytes: r 303 251 s u m 303 251 . t x t     ← UTF-8 "résumé.txt" preserved byte-for-byte
documents.name (SQL): r 303 251 s u m 303 251 . t x t \n
tmp clean (0) OK
```

### T4 — Multi-file (+2 rows) — **PASS**
```
status 200 OK  [two files, one request]
mixed envelope OK (results=2, errors=0)
documents 2 -> 4 (delta=2)  chunks 2 -> 4
+2 documents rows OK
tmp clean (0) OK
```

### T5 — No file / wrong field name — **PASS**
```
### T5a empty multipart          → status 400 OK ; {"error":"Missing file in request body"}
   message contains "Missing file in request body" OK ; body shape OK ({error} only) ; tmp clean (0)
### T5b wrong field name (file=) → status 400 OK ; {"error":"Unexpected field \"file\"; upload files under \"files\""}
   message contains "Unexpected field" OK ; body shape OK ; tmp clean (0)
```

### T6 — Unsupported extension — **PASS**
```
status 400 OK  [exe rejected]
body: {"error":"Unsupported file type: .exe"}
message contains "Unsupported file type: .exe" OK ; body shape OK ; tmp clean (0)
```

### T7 — Oversized 413 — **PASS**
```
status 413 OK  [oversized]
body: {"error":"File too large (max 25MB)"}
body OK (JSON, non-empty string .error, no <html>, no stack frame) ; tmp clean (0)
```

### T8 — Malformed multipart (the HTML-500 case) — **PASS**
```
### T8a JSON body, no multipart
status 400 OK ; {"error":"Missing file in request body"} ; body is JSON (not HTML) ; tmp clean (0)
### T8b multipart/form-data WITHOUT boundary  ← the case that used to be an HTML 500
status 400 OK ; {"error":"Malformed multipart request"} ; body is JSON (not HTML) ; tmp clean (0)
```
✅ **No HTML, no 500, no stack trace** in either case.

### T9 — Ingestion throws mid-way (corrupt .docx) — **PASS on the contract, F1 raised**
```
status=400 (expect 400 all-failed)
body: {"error":"ADM-ZIP: Invalid or unsupported zip format. No END header found","errors":[{"file":"p1-broken.docx","error":"ADM-ZIP: Invalid or unsupported zip format. No END header found"}]}
documents delta=0 chunks delta=0 uploads delta=1
no documents row OK
tmp clean (0) OK
sha256(corrupt docx)=f300f6a921e42e9c177aa31cb9085db9067972ed4901536757e8e339158c6814
$ORPHAN_BLOB=[f300f6a921e42e9c177aa31cb9085db9067972ed4901536757e8e339158c6814.docx]   ← recorded PRESENT
```
The orphan blob exists exactly as the plan predicted; §8 closes on whether that is acceptable.

### T10 — Duplicate upload / dedupe — **PASS**
```
status 200 OK  [first upload of p1-t10.txt]
first: documentId=d56cb9d6-… chunkCount=1
status 200 OK  [duplicate upload of p1-t10.txt]
second: documentId=cc2cdd5e… contentHash=cc2cdd5e… chunkCount=0
second upload chunkCount=0 OK
contentHash==documentId in response OK
no new documents row OK
NOTE documentId differs: d56cb9d6… vs cc2cdd5e…   ← see F3
tmp clean (0) OK
```
Server log for the second request: `{"level":"info","msg":"[ingest] deduplicated: cc2cdd5e…"}` + `{"level":"warn","msg":"[ingest] upload produced zero chunks","name":"p1-t10.txt"}`.

### T11 — Mixed batch → 207 — **PASS**
```
status 207 OK  [mixed batch]
body: {"results":[{"…","name":"p1-t11.txt","chunkCount":1,…}],"errors":[{"file":"p1-broken2.docx","error":"ADM-ZIP: Invalid or unsupported zip format. No END header found"}]}
mixed envelope OK (results=1, errors=1, errors[0].file=p1-broken2.docx)
exactly one new document OK
tmp clean (0) OK
```

### T13 — Auth + other-route regression — **PASS**
```
### T13a no Authorization header
status 401 OK ; {"error":"Missing or invalid bearer token"} ; documents delta=0 ; tmp clean (0)
### T13b garbage token
status 401 OK ; {"error":"Invalid or expired token"} ; tmp clean (0)
### T13c /api/ingest/watch (JSON path upload)
status 200 OK ; {"documentId":"895321dd-…","chunkCount":1,…} ; /watch chunkCount=1 OK ; tmp clean (0)
### T13d /api/health
status 200 OK ; {"ok":true,"service":"knowledge-app",…}
### T13e /api/search
search status 200 ; {"query":"alpha","limit":7,"results":[{"document_id":"1f1e14d7-…","document_name":"p1-ok2.txt",…}]}
body is JSON (not HTML) OK
```
Note: `/search` returned **200 with real results** — the "known out-of-scope FTS defect" the plan anticipated did not reproduce in this run.

### T14 — Abort semantics (good + `.exe` in one request) — **PASS**
```
status 400 OK  [one bad file aborts the batch]
body: {"error":"Unsupported file type: .exe"}
message contains "Unsupported file type: .exe" OK
body shape OK ({error} only, no partial envelope)
no rows from the aborted batch OK
tmp clean (0) OK
```

### T15 — Field guards + jsonb round-trip — **PASS**
```
### T15a invalid metadata JSON      → 400 {"error":"Invalid metadata JSON"}         ; no rows OK ; tmp clean (0)
### T15b junk access_policy         → 400 {"error":"Invalid access_policy"}         ; no rows OK ; tmp clean (0)
### T15c valid metadata object      → 200 (chunkCount 1)
     exactly one row ingested OK
     metadata->>'team' = ops OK (jsonb round-trip)
     tmp clean (0) OK
```

### T12 — Cleanup (run LAST, after T15) — **PASS after a documented second pass (H1)**
Pre-state and the hash-scoped deletions, verbatim (`run-t12.log`):
```
########## T12 PRE-STATE
documents=14 chunks=14 admins=1 audit_log=0
uploads (16): 0bf00d07….txt 0ce25270….txt 2684464e….txt 38511f35….txt 3e5c87fd….txt 42d211a6….txt 513a3283….txt
              699bb4ff….txt 6e398bf7….txt 8243894d….docx adc2bbb0….txt c7cfb0a2….txt cc2cdd5e….txt cfd8ce5c….txt
              edad3a98….txt f300f6a9….docx
extracts (14)   tmp-* files: 0
BEFORE_UPLOADS (T2): []      PRE_SHA (T2): []
fixture hashes: 15  test hashes (minus PRE_SHA): 15
########## T12 STEP 1-2: delete by hash
DELETE 11
DELETE 11
########## T12 STEP 3: blob listing delta
  removed 0bf00d07… … removed f300f6a9…            (16 lines, listing-delta scoped)
########## T12 POST-STATE
documents=3  (want 0)   ← three rows were NOT fixture-derived; see H1
chunks=3     (want 0)
uploads identical to T2 BEFORE_UPLOADS: YES      ← already []
tmp-* anywhere under data/: 0
```
Residual, removed hash-scoped (`current DB hashes MINUS PRE_SHA` — the only rows that can exist, because the baseline was `documents=0`):
```
residual hashes: [0ce25270… 513a3283… edad3a98…]
  -- 0ce25270… rows=1 name(s)=p1-dup-a.txt          (earlier concurrency fixture, overwritten by a later run)
  -- 513a3283… rows=1 name(s)=ui-flow-probe.txt     (created inside the browser, never on disk)
  -- edad3a98… rows=1 name(s)=browser-probe-auth.txt(created inside the browser, never on disk)
DELETE 3
DELETE 3
########## T12 FINAL PROOF
documents=0 (baseline 0)
chunks=0 (baseline 0)
admins=1 (baseline 1)
audit_log=0 (baseline 0)
uploads: []  files=0  identical-to-T2=YES
extracts: [] count=0
tmp-* anywhere under server/data: 0
server/data/tmp contents: []
pre-existing hashes that disappeared: 0 (0 = nothing lost)
hashes in DB now: []
fixtures dir contents: [] count=0
```

---

## 4. FAILED / CONTRADICTED CLAIMS vs `IMPLEMENTATION.md`

I re-read the claims and checked them against code and runtime behaviour. **No claim in `IMPLEMENTATION.md` was contradicted by an executed test.** The specific verifiable claims:

| IMPLEMENTATION.md claim | Verified how | Result |
|---|---|---|
| `npx tsc --noEmit` → `exit=0` | T1 | ✅ confirmed |
| `sha256sum -c` → `24 OK` + 3 allowed `FAILED` | T1b | ✅ confirmed (and again after the run: `24` OK, same 3 FAILED) |
| `ingest.ts` 94 → 377 lines, only route file changed | `wc -l` = 377; baseline | ✅ confirmed |
| `multer 2.5.0`, `@types/multer 2.3.0` exact | `package.json:22,32` | ✅ confirmed |
| `TMP_DIR` created **before** any multer construction | lines 62–63 precede 65/78 | ✅ confirmed |
| `multer.array('files', MAX_FILES)` then async handler then 4-arg mapper | line 137 chain; mapper rows exercised by T5b/T6/T7/T8b | ✅ confirmed behaviourally |
| `Missing file in request body` kept verbatim | T5a, T8a | ✅ confirmed |
| 200 all-success / 207 mixed / 400 none-succeeded | T3,T4 (200), T11 (207), T9/T14/T15 (400) | ✅ confirmed |
| temp sweep on all post-multer exits, per-file `finally` in the loop | 6 `sweepUploaded(req)` sites (142,169,175,187,250,264) + `finally` at 228 | ✅ confirmed behaviourally (tmp = 0 after every case) |
| `R-1` empty-string `metadata=`/`access_policy=` → 400 | EXTRA 2 | ✅ confirmed, exactly as disclosed |
| server-side stack logging only (client gets no stack) | T7/T8b body checks (`no stack frame`) | ✅ confirmed |

Two *claims outside IMPLEMENTATION.md* that the run contradicts — both pre-existing, unrelated to this phase:
- `web/src/lib/api.ts:9-11` + `dashboard/layout.tsx:16` treat `localStorage.ka_token` as the session source of truth, but the API module's `token` variable is never rehydrated from it → after any reload the UI sends **no** `Authorization` header. Observed live (§5). **F2.**
- The sidebar "Inbox" link points at `/dashboard`, not `/dashboard/inbox` (rendered HTML: `<a href="/dashboard">Inbox</a>`). **F4.**

---

## 5. UI-VERIFICATION LEVEL REACHED: **BROWSER** (beyond XHR-equivalent)

The real Next.js dev server was started in `web/` (`npm run dev`, no source modification) and a real Chromium session was driven against it.

1. **Real drop handler, exercised end-to-end through the app's own login form:**
```
login page: {"url":"http://localhost:3000/","buttons":["Sign in"]}
post-login: {"url":"http://localhost:3000/dashboard","links":["/dashboard","/dashboard/library",…,"/dashboard/inbox",…]}
nav: clicked        →  page: {"url":"http://localhost:3000/dashboard/inbox","dashed":1}
drop dispatched
status: ["Ingestion queued for 1 file(s). (Parser factory not wired yet.)", …]
```
The drop went through `onDrop` → `formDataFrom()` → `api.ingestUpload()` (i.e. the exact production code path), and the server logged the save:
```
{"level":"info","msg":"[ingest] parsed D:\\Develop\\knowledge-app\\server\\data\\tmp\\tmp-1793174499694-f4d98fc7f2addd25.txt: 324 chars"}
{"level":"info","msg":"[db] stored document 45a42a8a-e1a5-46c4-9ff4-6299e47e1093 with 1 chunks"}
```
2. **Same-origin browser XHR with an explicit Bearer token** (the app's own request shape):
```
RESULT: {"status":200,"body":"{\"results\":[{\"documentId\":\"44e73569-…\",\"contentHash\":\"edad3a98…\",\"name\":\"browser-probe-auth.txt\",\"kind\":\"txt\",\"accessPolicy\":\"restricted\",\"chunkCount\":1,…}],\"errors\":[]}"}
```
3. **CORS preflight the browser performs first:**
```
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: http://localhost:3000
Access-Control-Allow-Methods: GET,POST,OPTIONS
Access-Control-Allow-Headers: Content-Type,Authorization
```
and on the actual POST: `Access-Control-Allow-Origin: http://localhost:3000`. No manual `Content-Type` is set anywhere — the browser writes the boundary (`curl` equivalent, `xhr-flow2.sh base`, also **200**, `chunkCount=1`).

4. **Negative UI finding (F2)** — after a page *reload* the dashboard renders (`ka_token` present in `localStorage`) but the upload 401s:
```
{"status":401,"body":"{\"error\":\"Missing or invalid bearer token\"}"}
{"tokenInLocalStorage":true,"pageReloaded":true}
```
and the page shows `Unauthorized` in the ingest status line. This is a **web-layer token-hydration gap, not an upload defect** — the same request with the header attached returns 200 (item 2).

---

## 6. EXTRA CHECKS

### 6.1 Empty-string form fields (EXTRA 2)
```
--- (i) -F 'metadata=' only        → 400 {"error":"Invalid metadata JSON"}
--- (ii) -F 'access_policy=' only  → 400 {"error":"Invalid access_policy"}
--- (iii) both empty               → 400 {"error":"Invalid metadata JSON"}
tmp clean (0) OK
```
**Judgement:** does **not** break the Inbox contract — `web/src/app/dashboard/inbox/page.tsx:31-35` appends *only* `files` and never sends either field, so the UI path never hits this. It is a robustness/latency-of-surprise issue only: a scripted client that emits empty fields (many form builders do) gets a 400 with a message that reads like a data error. Matches the plan's §5.6-step-2 reading and IMPLEMENTATION.md **R-1**. → **F5 (low)**.

### 6.2 Two concurrent uploads of the SAME new file (EXTRA 3) — observed behaviour, no fix asserted
Fresh bytes (`sha256=3e5c87fd…`), two different names, launched concurrently:
```
rows/ blobs before: documents=11 chunks=11 uploads=13 tmp=0
A status=200  body={"results":[{"documentId":"9d22e18e-…","contentHash":"3e5c87fd…","name":"p1-dup-a.txt","chunkCount":1,…}]}
B status=200  body={"results":[{"documentId":"3e5c87fd…","contentHash":"3e5c87fd…","name":"p1-dup-b.txt","chunkCount":0,…}]}
A documentId=9d22e18e-… chunkCount=1
B documentId=3e5c87fd… chunkCount=0
after: documents=12 chunks=12 uploads=14 tmp=0
rows with this sha256: 1
chunks for those rows: 1
blob present: 1
server log errors mentioning dup/EEXIST: 0
```
**Observed:** exactly one row, one chunk, one blob, zero temp files, no `EEXIST`/duplicate-key error in the server log — i.e. the loser dedupes cleanly (0 chunks, `contentHash` echoed as `documentId`) and nothing is lost. Also observed as a **pre-existing-data** case on re-run: when identical bytes were already stored from an earlier run, **both** concurrent requests deduped (both `chunkCount=0`), still leaving 1 row / 1 chunk / 1 blob. No race induced a duplicate row or a lost row in either shape. (Not a proof of absence of races — just what was observed.)

### 6.3 Temp-dir leak audit (EXTRA 4)
`find server/data/tmp -name 'tmp-*'` was evaluated **after every single failure case** in T5a, T5b, T6, T7, T8a, T8b, T9, T13a, T13b, T14, T15a, T15b, T15c, and after every EXTRA check → **0 in all 14+ places** (`tmp clean (0) OK`). Non-zero occurrences: **none**.

### 6.4 No-auth request (EXTRA 5)
```
status=401  body: {"error":"Missing or invalid bearer token"}
documents delta=0
tmp-* files: 0
```
✅ 401 with a bearer-token error (not a multipart error) and `data/tmp` untouched ⇒ **multer never ran before the auth middleware**.

---

## 7. LIMITATIONS

1. **No git repo / `.next` artefact.** Running `next dev` created `web/.next/` (not in `baseline.sha256`, so not a tracked-file change). `web/src/**` was only read.
2. **Harness re-runs, not one pristine pass.** My first attempts failed for *tooling* reasons (H2 below), not product reasons; the suite was then run from a re-zeroed DB. Every result quoted in §3 comes from the final clean runs. The DB was re-zeroed twice using a hash-scoped script with the same rules as T12 (`reset-test-data.sh`), and the pre-existing-data hashes were always empty.
3. **T12 needed a second deletion pass (H1)** because three rows came from bytes that existed only inside the browser, and one fixture file was overwritten between runs. The residual delete was still *hash-scoped* (`current hashes MINUS PRE_SHA`), never name-scoped; with an empty baseline that set is provably all-this-run data. A literal single-pass T12 needs fixtures to be immutable for the whole run.
4. **Concurrency** was two requests fired together, not a stress/soak test; it does not prove absence of interleaving races.
5. **`/search`** was only checked for "JSON, not HTML" per the plan; its result *quality* was not in scope.
6. **`documents.status='pending'`** (R-4) was observed and accepted as out of scope.
7. **Logs.** The 26 server `error`-level entries are the intended server-side `logger.error` calls for the rejected requests (each contains code/message/stack by design, IMPLEMENTATION.md item 9/10). The 14 `warn` entries are `[ingest] upload produced zero chunks` for dedupe/all-zero-chunk results. Full log kept at `.pipeline/phase1/server-run.log`.
8. Some tooling iterations produced an internal `FAILED=1` from the harness itself (a helper invoked as a wrong path, a fixture reused across runs, a mistyped `-F` file). Each was diagnosed and the *product* re-tested; none is counted as a product failure, and none is hidden — they are the reason H2 exists.

---

## 8. THE ORPHAN BLOB (T9) — F1 IS A DEFECT THAT MUST BE FIXED, ON A DOCUMENTED FOLLOW-UP

**What the plan says (verified by reading the plan and the code).** The plan's T9 heading is *"Ingestion throws mid-way (orphan blob is DOCUMENTED, not deleted)"*, and the route deliberately does not unlink `uploads/<sha>.<ext>` when a later stage throws. T9 confirmed the artefact with a real corrupt `.docx`:
```
documents delta=0 chunks delta=0 uploads delta=1
$ORPHAN_BLOB=[f300f6a921e42e9c177aa31cb9085db9067972ed4901536757e8e339158c6814.docx]
```
and T11 produced a second one (`8243894d….docx`, again from a corrupt `.docx`, this time in a 207 batch).

**Is that acceptable?** Two separate questions, and the answer differs:

- **Contract compliance (this phase): YES, acceptable.** It is designed, approved and documented behaviour, not a regression, and it does not break any acceptance criterion (AC1–AC12). Rejecting the phase for it would be rejecting the approved plan.
- **The behaviour itself: NO, it is a real defect.** Justification: (a) the bytes of a **failed** upload persist on disk under the content hash — for a document whose content may be sensitive and whose ingestion was refused, that is a *write-on-failure* data-retention issue, not a cosmetic leak; (b) it is **unbounded** — every failed parse adds a file and there is no sweeper for `uploads/` (only `tmp/` is swept); (c) it is **undetectable from the API** — the client gets `400`/`207` with no traceable id, so re-submitting is the only recovery path and it silently grows the set; (d) it is **repeatable on demand** by any authenticated user with a crafted `.docx`, which is a cheap disk-fill vector (25 MiB per request × 100 req/min).

**Ruling:** the phase **PASSES**; F1 is graded **follow-up, FIX REQUIRED before production**, and should be attached to Phase 1's own work rather than a distant phase because the code that creates it was written in Phase 1. Minimal correct shape: compute `sha256` before the save, move the save *after* successful parse/chunk/DB write (or unlink on the catch path, since the blob is content-addressed and no DB row references it), plus a startup/periodic sweep of `uploads/*` against `documents.sha256`.

---

## 9. CLEANUP PROOF

| Item | T2 (before) | End (after T12) | Verdict |
|---|---|---|---|
| `documents` | 0 | **0** | ✅ baseline restored |
| `chunks` | 0 | **0** | ✅ |
| `admins` | 1 | **1** | ✅ untouched |
| `audit_log` | 0 | **0** | ✅ untouched |
| `server/data/uploads` | `[]` (0) | `[]` (0) — *identical to T2 listing* | ✅ |
| `server/data/extracts` | empty | `[]` (0) | ✅ |
| `server/data/tmp` | empty | `[]` (0) — *no `tmp-*` anywhere under `server/data`* | ✅ |
| fixtures dir | empty | `[]` (0) | ✅ |
| pre-existing `$PRE_SHA` hashes | `[]` (DB started empty) | disappeared: **0** | ✅ nothing could have been lost |
| source baseline | 24 OK / 3 allowed FAILED | 24 OK / same 3 FAILED | ✅ nothing but the three allowed files changed |

Also removed: run-only fixtures, `.pipeline/phase1/.token` (test JWT), `.last.json`/`.c1.json` scratch bodies, and the two dev servers (`both 3000 and 4000 free`).

---

## 10. FOLLOW-UPS

| ID | Severity | Finding | Evidence | Suggested owner |
|---|---|---|---|---|
| **F1** | **High (security/hygiene)** | Failed ingestion leaves an orphan blob in `uploads/` (content-addressed, unreachable, unbounded, repeatable). T9 + T11 both produced one. | `$ORPHAN_BLOB=[f300f6a9….docx]`, `uploads delta=1` | Backend — Phase 1 follow-up patch |
| **F2** | **Medium (functional, web)** | After a page reload the UI upload sends **no** `Authorization` header (`localStorage.ka_token` is never copied back into `api.ts`'s module variable) → 401 `Missing or invalid bearer token`, UI shows `Unauthorized`. | Browser: `{"status":401,…}` with `tokenInLocalStorage:true`; works only in the same JS session | Web (`web/src/lib/api.ts`) — separate bug class, not the upload route |
| **F3** | Low (cosmetic/contract) | Dedupe response returns `documentId = contentHash` while a fresh ingest returns a UUID, so `results[0].documentId` has **two different shapes** for the same document. Clients keying on `documentId` must treat both. | T10: `d56cb9d6…` then `cc2cdd5e…`; server log `deduplicated:` | Backend — consider returning the existing row's UUID |
| **F4** | Low (UI) | Sidebar "Inbox" link points to `/dashboard`, not `/dashboard/inbox` (the drop zone lives on the latter). | rendered `<a href="/dashboard">Inbox</a>`; after login the browser lands on `/dashboard`, 0 drop zones | Web |
| **F5** | Low (robustness) | `metadata=` / `access_policy=` **empty strings** → `400` (`Invalid metadata JSON` / `Invalid access_policy`) instead of defaulting. The Inbox never sends them, so it is not a contract break. | EXTRA 2 output | Backend — optional leniency |
| **H1** | Test-harness note | PLAN T12 step 1 derives the delete set from fixture files, so rows whose bytes never hit disk (browser probes) or whose fixture was overwritten survive a single pass. Fix the *test*, not the product: freeze fixtures per run, or add a `current MINUS PRE_SHA` sweep. | T12 second pass | Test harness |
| **H2** | Environment note | MSYS path translation is disabled: `/d/...` paths handed to native `curl`/`node`/`psql` resolve to `D:\d\...` and silently discard output (`exit=23`, `size_download=0`). All helper scripts under `.pipeline/phase1/*.sh` use native `D:/` paths for that reason. | `CODE=200 SIZE=0 exit=23` vs `CODE=200 SIZE=71 exit=0` | Anyone re-running this suite |

---

## 11. ARTEFACTS (all under `.pipeline/phase1/`)

`run-full.log` (T2–T15 full output) · `run-extra.log` (browser/XHR replays, empty-field, concurrency, no-auth) · `run-t12.log` (cleanup before/after) · `server-run.log` (server log: 26 error-level mapper entries, 14 zero-chunk warns) · reproducible scripts: `pre.sh`, `lib.sh`, `env.sh`, `login.sh`, `mkfix.sh`, `t02-baseline.sh`, `t03.sh`, `t04-t10.sh`, `t11-t15.sh`, `t12-cleanup.sh`, `t12b-finish.sh`, `xhr-flow2.sh`, `reset-test-data.sh`, `login-token-file.sh`, `stop-dev-servers.sh`, plus `jget-file.cjs`, `check.cjs`.

DONE:TEST_ENGINEER

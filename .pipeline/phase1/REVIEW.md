# Phase 1 Plan Review — Multipart Document Upload

**Reviewer:** INDEPENDENT PLAN REVIEWER
**Subject:** `.pipeline/phase1/PLAN.md` (565 lines) vs `.pipeline/phase1/REQUEST.md` and the actual repo at `D:\Develop\knowledge-app`
**Method:** read every file the plan cites; re-derived each root cause from source; checked the plan's test commands for executability and falsifiability. No code edited, nothing installed, no build, no DB access.

---

## DECISION

**REVISE**

The diagnosis is correct and the chosen approach (route-scoped `multer` with `diskStorage`, extension preserved on the temp path, feed the existing `ingestFile`) is the right one and is well inside Phase 1 scope. The plan is not implementable as written because of one unsafe design step (**S9**), one internally contradictory API contract (§5.4 vs §5.7 vs §5.8 vs Q1–Q3), one error path that cannot work as specified (malformed multipart → §5.8's `next(err)` → a non-existent global error handler), and a test suite whose temp-file assertions are unfalsifiable and whose curl commands do not run. All are fixable in the document; none requires abandoning the approach.

Do **not** start S1 until revisions 1–14 are applied.

---

## SUMMARY

- **Root causes: complete and correct.** Three real, independent defects (`req.body.file` with no multipart parser; field name `files` vs `file`; extension-less temp path that `parseFile`/`storagePath` key on). I re-derived all three from source. I found **no fourth transport blocker**: `helmet()` sets headers only, `express-rate-limit` only counts, `express.json({limit:'1mb'})` type-matches and skips multipart, `tsconfig` auto-includes `node_modules/@types` (no `types`/`typeRoots` restriction) so `@types/multer` will be picked up, and `app.ts` mounts `authMiddleware` before the router.
- **The plan's three "corrections to the brief" are all factually right** (PPTX registered; `errorHandler` has 3 params so Express never treats it as an error handler; the Inbox stub copy is stale). But §5.8 then contradicts correction #3 by claiming the 500 path yields JSON `{error}` "via `errorHandler`". That contradiction is a required fix.
- **Preservation of ingestion semantics is correct** in §5.6 (`detectKind` on `originalname`, `access_policy` default `restricted`, `metadata`, real temp path with real extension, no parallel pipeline). One nuance the plan misses: the pipeline re-derives size itself (`service.ts:148`), so `sizeBytes: file.size` is inert — harmless, but AC2 must be asserted from `fs.statSync` semantics, not from `FileInfo`.
- **S9 must go.** Deleting the content-addressed blob on failure is outside the REQUEST's AC5 (which is about temp files) and is unsafe: the guard is a read-then-delete over a path that is content-addressed and shared, `documents.sha256` is not UNIQUE, and another request's committed `documents.source_path` (or an uncommitted INSERT invisible to the guard) can point at that exact blob. It converts "an orphan blob" into "a document row whose bytes are gone, plus permanent false dedupe".
- **Test suite needs real repair**: `Bearer ***` and `-X POST ...` mean T3–T11 are not executable; T4 references a fixture that is never created; AC8's `ls data/uploads | grep '^tmp-'` cannot fail even when temp files leak (S4 puts them in a subdirectory); T8's second case fails by construction; AC7 and REQUEST AC6 (401) have no proving test at all.

---

## BLOCKING FINDINGS

**B1 — S9's orphan-blob deletion can destroy a live document's bytes (and is out of scope).**
The guard is "delete `<storage>/<sha256><ext>` if `select count(*) from documents where sha256=$1` is 0". That cannot establish "unreferenced":
1. **Uncommitted rows are invisible.** `storeDocument` runs `BEGIN … INSERT … COMMIT` (`service.ts:187–217`). A concurrent successful ingest of the same bytes has a row in flight; the guard reads 0, deletes, and the other request then commits `documents.source_path` pointing at a file that no longer exists. `sha256` has no UNIQUE constraint (`db/schema.ts:12`) so nothing serializes on it.
2. **The dedupe branch makes the same blob a success path for a second request.** `ingestFile` returns early when `fs.existsSync(storagePath)` (`service.ts:119–123`) with `documentId = contentHash`, `chunkCount: 0`, **and inserts nothing**. So request B can be *told it succeeded* off request A's blob; A then deletes it. Net: B reported success, zero rows, zero bytes — silent, unrecoverable loss.
3. **Wrong layer.** The blob is written before `parseFile` (`service.ts:126` vs `:130`); ownership of that write belongs to `ingestion.ts`, not the transport route. Route-level cleanup would need a lock/keyed-mutex plus a DB read under the same transaction to be sound — far past Phase 1, and it would still be wrong for a second process.
   ⇒ Required: **remove the deletion half of S9**; keep temp-file cleanup hardening. Record the orphan blob as a documented follow-up (see revision 2).

**B2 — The malformed-multipart error path cannot produce the documented 400.**
`Content-Type: multipart/form-data` with no boundary makes busboy throw `Multipart: Boundary not found`; multer's `try { Busboy(...) } catch (err) { return next(err) }` forwards a **plain `Error`, not a `MulterError`**. The plan's mapper spec is "custom filter error → 400, everything else → `next(err)`" (§5.8). `next(err)` from the router reaches `app.use(errorHandler)`, whose signature is `(err, _req, res)` — **3 parameters, so Express registers it as ordinary middleware and never invokes it for errors** (`middleware/error.ts:7`, `app.ts:60`). Result: Express's default handler → **HTML 500 with a stack trace**, violating AC6 and T8. The plan's own §5.8 table row "Unexpected error → 500 `{error}` via `errorHandler`" is therefore false, and contradicts its §12.4 correction #3.

**B3 — The response contract is self-contradictory; no deterministic route can be written from it.**
Four different statements: §5.4 "Response must then be an **array**"; §5.7 single → bare `IngestionResult`, multi → `{results,errors}`; §5.8 success → `{results, errors:[]}` with the parenthetical "(or the single `IngestionResult` if only one file and Q2 resolves that way)" and partial → "**207** — *or* **200**", with a recommendation for 200 in the same cell; Q1/Q2/Q3 defaults that again differ (`Q2` = always envelope). AC1, T4, T11 and EC9 all assume different shapes.

**B4 — AC8 (temp-file cleanup) cannot fail, so it proves nothing.**
AC8/T3/T7/T9 assert `ls data/uploads | grep '^tmp-'` is empty, while S4 and §5.6 put temp files in `data/uploads/tmp/`. `ls data/uploads` lists the subdirectory *name* `tmp` (no `tmp-` prefix), so the assertion returns empty even with 50 leaked files. The criterion that exists to satisfy REQUEST AC5 is currently unfalsifiable.

**B5 — T4 is broken twice over.** `p1-ok2.txt` is never created by any step (T3 creates only `p1-ok.txt`), so curl fails before the request is sent; and it asserts only `%{http_code}`, so a request where both files failed at ingestion would still "pass" under the plan's 200-always recommendation.

**B6 — T3–T11 are not executable as printed.** Every request is `-H "Authorization: Bearer ***"` (→ 401 for all), and T6–T11 elide the URL as `-X POST ...`. Running them as written produces a wall of 401s; any "verified" claim from them would be fabricated. Also no step shows how to get `ADMIN_PASSWORD` out of `server/.env` into the environment without echoing it.

**B7 — The plan never states where error catching lives.** In Express 4 an async handler's rejection is **not** forwarded to error middleware; it becomes an unhandled rejection, and Node ≥15 terminates the process by default. The S7 mapper only sees errors passed to `next(err)` by multer. So the handler must own `try/catch` for both the outer body and *each* `ingestFile`, and the plan must say so explicitly or an implementer will lean on the mapper and kill the server on the first DB hiccup.

---

## REQUIRED REVISIONS

Apply all of these to PLAN.md before implementation. Numbered for direct application.

1. **Collapse the response contract to one rule** (replaces §5.4's "Response must then be an array", §5.7's "single-file response" bullet, §5.8's first two rows, AC1's wording, and Q1/Q2/Q3 defaults):
   - Body is **always** `{ "results": IngestionResult[], "errors": [{ "file": string, "error": string }] }` — for one file and for many.
   - `errors.length === 0` → **200**.
   - `results.length > 0 && errors.length > 0` → **207**.
   - `results.length === 0 && errors.length > 0` → **400** with `{ "error": errors[0].error, "errors": [...] }` (superset keeps `api.ts`'s `body.error` path working — `api.ts:35-36`).
   - Whole-request transport failures (limits, filter, malformed, auth) use the error table and never a partial body.
   - Rewrite AC1 to assert `results[0].{documentId, contentHash, chunkCount, chunkIds, name, kind, accessPolicy, textLength, savedAt}`; rewrite T4/T11/EC9 to this table.

2. **Delete S9's blob deletion.** S9 becomes "temp cleanup hardening only (`rmSync({path},{force:true})` per file)". Delete R5, EC7's "S9 adds blob cleanup", and T9's "S9 must delete that blob" + "the test asserts the blob count returns to its T2 baseline". Add follow-up **F1** with the reason it is not done here: the blob write at `service.ts:126` precedes parsing at `:130`, ownership belongs to `ingestionService`, and any route-level guard is TOCTOU because the path is content-addressed, shared by concurrent requests, and `documents.sha256` is not UNIQUE.

3. **Fix §5.8's last row.** Replace "Unexpected error → 500 `{error}` via `errorHandler`" with: "Unexpected error → **500** `{error:'Upload failed'}` **emitted by the route-scoped mapper itself**; `middleware/error.ts` is *not* an error handler (3 params) so any `next(err)` escapes to Express's default HTML page." Make the mapper terminal — no `next(err)` fallback on the upload path. Log `err.message` + stack server-side only; never send a stack or a file path to the client.

4. **Specify the mapper's classification table exactly** (S7):
   - `err instanceof multer.MulterError`:
     `LIMIT_FILE_SIZE` → **413** `{error:'File too large (max 25MB)'}`;
     `LIMIT_FILE_COUNT` → **400** `{error:'Too many files (max 10)'}`;
     `LIMIT_UNEXPECTED_FILE` → **400** `{error:'Unexpected field "<err.field>"; upload files under "files"'}`;
     `LIMIT_FIELD_*` / `LIMIT_PART_COUNT` → **400** `{error:'Malformed form data'}`.
   - Custom filter rejection → throw a dedicated `UnsupportedFileTypeError` (or set `err.code = 'UNSUPPORTED_FILE_TYPE'` inside `fileFilter`) → **400** `{error:'Unsupported file type: .<ext>'}`.
   - Non-`MulterError` busboy failures (message matches `/^(Multipart:|Unexpected end of form|Malformed part header)/i`, or `ERR_STREAM_PREMATURE_CLOSE`) → **400** `{error:'Malformed multipart request'}`.
   - Anything else → **500** `{error:'Upload failed'}`.
   This is what makes T8's boundary case pass.

5. **Mapper must sweep `req.files` before responding.** For every entry in `req.files` (array *or* `{[field]: File[]}`), `fs.rmSync(f.path, { force: true })`; and if `err.storageErrors` is present, log it. Reason: when multer aborts (filter, `LIMIT_FILE_SIZE`, malformed), the route handler never executes, so a `finally` inside the handler cannot be the cleanup guarantee; multer's own `_removeFile` failures are only reported via `uploadError.storageErrors` and would otherwise be silent.

6. **Move temp files out of the content-addressed directory and fix every assertion.** Use `server/data/tmp` (`path.resolve(ingestionService.storageDir, '..', 'tmp')`), created once at module scope with `fs.mkdirSync(dir, { recursive: true })` *before* the `multer(...)` instance is constructed. Rationale: `data/uploads` stays strictly `<sha256><ext>` blobs (dedupe at `service.ts:120` scans that directory by name, and a future GC/sweep must not have to special-case a subdirectory). Replace every `ls data/uploads | grep '^tmp-'` (AC8, T3, T7, T9, T11) with `find data/tmp -name 'tmp-*' | wc -l` → expect `0`.

7. **Rewrite T9 for the post-S9 design.** Expect **400** `{error}`; `select count(*) from documents where name like 'p1-broken%'` = 0; `chunks` count unchanged; `find data/tmp -name 'tmp-*'` = 0; **and** the orphan blob `data/uploads/$(sha256sum fixtures/p1-broken.docx | cut -d' ' -f1).docx` **exists** (record it as `$ORPHAN_BLOB`). Add to T12: `rm -f "server/data/uploads/$ORPHAN_BLOB.docx"` by that exact path, and assert `ls data/uploads` returns to the pre-test listing.

8. **Rewrite T4.** In T3, also create `p1-ok2.txt` with **distinct** content (different word sequence, ≥40 words) — identical content would dedupe (`service.ts:119–123`) and produce 0 rows, making the test impossible to pass. T4 must assert: HTTP **200**, `results.length == 2`, `errors == []`, and a before/after `select count(*) from documents` delta of exactly +2.

9. **Make the suite executable.** (a) export `TOKEN` from the T2 login and use `-H "Authorization: Bearer $TOKEN"` everywhere; (b) replace all `-X POST ...` elisions with full URLs; (c) load credentials without exposing them — `set -a; . ./server/.env; set +a` then build the login body from a heredoc so `ADMIN_PASSWORD` never appears in argv/history; never `echo` it; (d) every failure-case assertion must check **both** the status code and the body: it parses as JSON, has a string `error`, contains no `<html` and no `at .*:\d+:\d+` (Node stack frame). A status-only check does not prove "no stack traces" (REQUEST AC4).

10. **Add T13 — AC7 regression + auth (currently untested).**
    - upload with **no** Authorization → **401**, and `find data/tmp -name 'tmp-*' | wc -l` = 0 (proves multer never ran before auth);
    - upload with a garbage token → **401** `{error}`;
    - `POST /api/ingest/watch` with `{"path":"<abs>/fixtures/p1-ok.txt"}` → **200** with `documentId` + `chunkCount ≥ 1` (the known-good path must not regress);
    - `GET /api/health` → 200; `POST /api/search` with the token → JSON (not HTML, not 500).
    Add T13 to the AC cross-reference for AC7 and REQUEST AC6.

11. **Add T14 — abort semantics, and correct the isolation claim.** `-F "files=@p1-ok.txt" -F "files=@p1-bad.exe"` → **whole request 400** `{error:'Unsupported file type: .exe'}`, **0** new `documents` rows, **0** leftover temp files. Then amend EC9/§5.4/T11 to state plainly: *a single `upload.array('files')` instance aborts the entire request on a `fileFilter` rejection or any `LIMIT_*`; per-file isolation is achievable only for ingestion errors (post-multer), which is exactly what T11 exercises with a corrupt-but-allowed `.docx`.* T11 as written survives this, but the plan must not leave the implementer thinking per-file filter isolation is buildable.

12. **Pin the typecheck-safe code shape** (add to §5.6/S6, and add S3b):
    - `import multer from 'multer'` (works under `esModuleInterop: true`); add step **S3b**: implement only the import + one `multer.diskStorage(...)` call, then run `npx tsc --noEmit` **before** writing the handler — this settles the typings' export form in one minute instead of a rewrite later. Also `node -p "typeof require('./node_modules/multer')"` → `function` (proves it loads as CJS under `tsx`).
    - `const files: Express.Multer.File[] = Array.isArray(req.files) ? req.files : [];` — do **not** write `Multer.File[]`; that interface lives in the global `Express.Multer` namespace, not on the module export.
    - Every response path stays `res.status(code).json(body); return;`. Never `return res.status(...)` — the handler is typed `(req: Request, res: Response): Promise<void>` and returning `Response` is a `strict` error (the existing file uses this pattern at `ingest.ts:18-19,26-27`).
    - Text fields may be arrays (multer converts repeated fields): `const kind = typeof body.kind === 'string' ? body.kind : undefined`, likewise `name`; otherwise `detectKind()` receives an array and `path.extname()` throws.
    - Keep **both** try/catches: per-file around `await ingestFile`, plus the outer one. With Express 4 (installed: **4.22.3**) an async rejection is not routed to error middleware, and Node 24 exits on unhandled rejection.
    - `finally` must sit **inside** the loop, one per file.

13. **Add the two input-validation guards (§5.6 step 2, resolves EC12/Q8).**
    - `body.metadata`: if `typeof === 'string'`, `JSON.parse` in try/catch; on throw → 400 `{error:'Invalid metadata JSON'}`; require the parsed value to be a non-array object, else 400.
    - `body.access_policy`: accept only `public | trusted | restricted`, else 400 `{error:'Invalid access_policy'}`; absent → `restricted` (unchanged default).
    Without these, a multipart string like `"hello"` reaches `$7::jsonb` (`service.ts:191`) and yields a PG cast error, and any junk string is persisted into a user DB that must return to an exact baseline.

14. **Re-sync the derived sections** after 1–13: AC1, AC5 (status **and** body, per 9d), AC6 (add "body is JSON, not HTML"), AC8 (`data/tmp` glob), AC10 (drop the "plus `web/**` if Q2 forces it" clause — Q10 is ruled: no frontend change), §5.4, §5.7, §5.8, §7 T3/T4/T7/T9/T11, §8 EC7/EC9, §9 R5/R6 (drop R5), §10 (add "orphan-blob cleanup in `service.ts`" as out of scope), §11 (Q1–Q10 per the rulings below), and the REQUEST.md cross-reference table so every AC names a numbered test.

---

## NON_BLOCKING FINDINGS

1. **`chunkIds` are not chunk row ids.** `createChunker` emits synthetic ids `chunk-<start>-<end>` (`chunker.ts:75`) and `ingestFile` returns those (`service.ts:167`); `storeDocument` never returns `chunks.id`. Nothing may join on them. Record as F2; don't assert on them in tests.
2. **Batch disk bound.** `fileSize: 25 MiB × files: 10` = up to 250 MiB of temp per request. Consider a 3-line sum-of-`file.size` cap (100 MiB → 413, delete temps). Not required for approval.
3. **Failure after commit.** `storeDocument` commits at `service.ts:217`, then `fs.writeFileSync(extractPath, text)` at `:157` runs in the caller. If that write fails the route returns an error while the document and chunks are already persisted (`status` stays `'pending'`). Pre-existing; document only — and it is a second reason route-level blob deletion would be wrong.
4. **Legacy Office extensions.** The UI's drop filter accepts `doc/ppt/xls` (`page.tsx:14`, `docx?|pptx?|xlsx?`), but `PARSERS` has no `doc/ppt/xls` entry, so a legacy `.doc` reaches the server and is rejected 400 with an actionable message. Acceptable for this phase; the UI copy at `page.tsx:17,80` is inaccurate — record as UX follow-up (no web edits now, per Q10).
5. **Non-ASCII filenames.** EC11's "multer normalizes" is imprecise: it normalizes path separators, not charset; busboy may hand back `originalname` as latin1 (`résumé.txt` → mojibake). Extension stays ASCII, so ingest works, but `documents.name` can be mangled. Add a one-off manual check with `résumé.txt` in T3 and record the result; do not add a decode hack in this phase.
6. **`detectKind` fallback is unreachable via `/upload`** once the allowlist is enforced (good), but `body.kind` is an unvalidated override — `kind: 'pdf'` on a `.txt` mislabels the row. Existing behaviour; leave it, note it.
7. **Rate limit headroom.** 100 req/min on `/api` (`app.ts:35-41`); T3–T14 is ~20 requests, fine — but a re-run inside the same minute stacks. Note "wait 60 s or re-issue the token" in T0.
8. **Global JSON-error gap stays.** Fixing `middleware/error.ts` to 4 params is correctly out of scope; make sure the follow-up issue is recorded so the gap isn't lost (R4 wording is right, §5.8's row is not — see revision 3).
9. **Dependency version risk.** `multer@2.5.0` / `@types/multer@2.3.0` are taken from the registry per the brief and the plan's `npm view`. If `npm install` resolves something else, **stop and report** — do not let `^` drift you onto a different major.
10. **`documents.status` stays `'pending'` forever** (plan already notes this correctly at T3). No action.

---

## SCOPE CHECK

**In scope and stays in scope (verified against REQUEST.md §Scope):** route-level multipart wiring in `server/src/routes/ingest.ts` only; size/extension/MIME validation; upload error mapping; temp lifecycle; feeding the existing `ingestFile`; two pinned dependency additions; no `app.ts`, `service.ts`, `parsers.ts`, `chunker.ts`, `db/*`, `web/**`, `dist/**` changes. The plan's §10 exclusions correctly mirror the brief's out-of-scope list (FTS, JWT/login/logout, Library/Audit, Chat/LLM, broad security, repo cleanup, doc rewrites, dist rebuild).

**Drift found (must be removed):**
- **S9's orphan-blob deletion** — beyond REQUEST AC5 ("temporary files"), mutates the shared blob store, and requires de-facto cross-request coordination. Revision 2 removes it; the correct fix is a `service.ts` change and is out of phase.
- Minor hedging to delete: T12's paragraph offering "if the implementer prefers *no* DB writes at all … a separate throwaway database is a nice-to-have". Pick one path (scoped delete + baseline diff, as written in steps 1–4) and drop the alternative; creating a database is not needed for any AC.

**Nothing in the plan drifts into** FTS, JWT, Library/Audit, Chat, repo cleanup or `dist/`. `npm install` rewriting `package-lock.json` is expected and AC10 already allows it.

---

## TEST COVERAGE CHECK

| AC | Proving test | Status |
|---|---|---|
| AC1 (200 + result fields) | T3 | ⚠ needs body assertions + `results[0]` (rev 1, 9d) |
| AC2 (documents row) | T3 psql | ✅ |
| AC3 (chunks count) | T3 psql | ✅ |
| AC4 (blob has extension) | T3 `ls data/uploads \| grep "$HASH"` | ✅ |
| AC5 (`{error}` shape on failure) | T6/T7/T8 | ⚠ status-only today; add body check (rev 9d) |
| AC6 (4xx, no 500, no stack) | T5–T9 | ⚠ T8 case 2 impossible as specified (B2); body unchecked |
| AC7 (only the upload route changed) | — | ❌ **no test**; add T13 (rev 10) |
| AC8 (temp cleanup) | T3/T7/T9 | ❌ unfalsifiable glob (B4); fix per rev 6 |
| AC9 (typecheck) | T1 | ✅ |
| AC10 (baseline 27/27) | T1b | ✅ — I re-ran it: 27/27 OK today |
| AC11 (DB not reset) | T12 | ✅, but add "documents/chunks back to 0, admins=1" as explicit `select`s |
| REQUEST AC6 (401 without token) | EC13 only (prose) | ❌ add to T13 (rev 10) |

**Tests that can pass while the feature is broken:** T4 (status-only, missing fixture), AC8's `grep '^tmp-'` (wrong directory), T9's "`ls data/uploads | wc -l` — compare to the count before" (no fixed expectation, and `wc -l` counts the `tmp` directory entry), T10's "second upload creates 0 new rows" (asserted in prose, no before/after command), T5's first case (a bodyless request exercises the *non-multipart* branch, not "empty multipart" — add `-F "name=only"` for the true empty-multipart case, per rev 11's spirit).

**Tests missing entirely:** 401 paths; other-route regression (`/watch`, `/search`, `/health`); filter/limit abort with a mixed batch; a genuinely empty multipart with a valid boundary.

---

## OPEN QUESTION RULINGS

| ID | Ruling |
|---|---|
| **Q1** | **APPROVED as proposed** — `{results, errors}` for multiple files. A bare `IngestionResult[]` has no channel for partial failure. |
| **Q2** | **APPROVED as proposed — always the envelope**, including one file. A shape that flips with input cardinality is the worst contract; the client ignores the body either way (`page.tsx:22-25` awaits and sets a fixed message), and `request<T>` only casts (`api.ts:38`). |
| **Q3** | **REVISED.** 200 when `errors` is empty; **207** when results and errors are both non-empty; **400** (with `errors[]` attached) when nothing succeeded. Reject the plan's in-cell "recommendation: 200 + populated errors[]" — a 200 with only errors hides failure from `res.ok`-based callers and from logs. `207` is safe: `res.ok` is true for 200–299 and `api.ts` only special-cases 401. |
| **Q4** | **APPROVED** — accept zero-byte/zero-chunk files, return the `results` entry with `chunkCount: 0`, log one `warn`. Do not add a `warning` field (contract churn for no consumer). |
| **Q5** | **DEFERRED, no gate.** Primary path stays `.txt`. Add a one-line `command -v pdftotext` probe in T0 and record the output in the evidence; if absent, PDF is documented as "fails with `PDF parse failed: spawn pdftotext ENOENT`", which is still a clean 4xx. Do not add a PDF test to the acceptance set. |
| **Q6** | **CONFIRMED, verified independently** — `pptx` is in `DOC_KINDS` (`service.ts:73`), in `DocKind` (`types.ts:16`), registered in `PARSERS` (`parsers.ts:219`), and mapped by `detectKind` (`parsers.ts:242`). No work. |
| **Q7** | **APPROVED** — 25 MiB/file, 10 files, `fields: 20`, `fieldSize: 1 MiB`. See non-blocking #2 for the optional batch cap. |
| **Q8** | **APPROVED and made mandatory** — `JSON.parse` a string `body.metadata`, 400 on invalid JSON (revision 13). |
| **Q9** | **APPROVED** — `multer@2.5.0` + `@types/multer@2.3.0`, route-scoped `diskStorage`. Hand-rolled busboy is a worse risk for a 1-file change. Confirm CJS loadability at S3b. |
| **Q10** | **APPROVED — no `web/**` change.** Verified: `page.tsx:22` uses the return value nowhere and sets a hardcoded message; `api.ts` casts without validation. The stale `{status:string}` type and the "parser factory not wired" copy are follow-ups, not phase work. |

---

## CLAIM VERIFICATION (the four claims the orchestrator asked me to re-check)

| Claim | Verdict | Evidence |
|---|---|---|
| (a) PPTX **is** supported; the brief's implication was wrong | **CORRECT** | `service.ts:72-74` `DOC_KINDS` includes `'pptx'`; `types.ts:8-22` includes it; `parsers.ts:219` `extensions: ['pptx']`; `parsers.ts:242` `pptx: 'pptx'`. ⇒ plan's conclusion ("no work needed") follows. |
| (b) `errorHandler` has only 3 params → Express never treats it as an error handler | **CORRECT** | `middleware/error.ts:7` `(err: unknown, _req: Request, res: Response)`; registered `app.ts:60`. Express 4 requires `fn.length === 4`. It is also unreachable in practice: `app.use(notFound)` (`error.ts:3`, 2 params) terminates every unmatched request. ⇒ conclusion follows, **but** §5.8's "via `errorHandler`" row contradicts it (revision 3). |
| (c) The Inbox page ignores the response body, so a new envelope is client-safe | **CORRECT** | `page.tsx:22-25`: `await api.ingestUpload(...)` then `setMsg(\`Ingestion queued for ${files.length} file(s)...\`)` — the resolved value is unused. `api.ts:29-38`: only 401 and `!res.ok` are inspected; success is `res.json() as T`. ⇒ conclusion follows; no frontend change needed (Q10). |
| (d) Dedupe returns `contentHash` as `documentId`, inconsistent with the UUID on first ingest | **CORRECT** | `service.ts:120-123` returns `documentId: contentHash`, `chunkCount: 0`, `chunkIds: []`, `textLength: 0`; first ingest returns `docId` from `RETURNING id` (`:203`). `documents.sha256` is `TEXT NOT NULL`, no UNIQUE (`schema.ts:12`). ⇒ conclusion follows (document as F2/F3; out of scope). **Additional consequence the plan missed:** because dedupe keys on `fs.existsSync`, an orphan blob from a failed parse makes a later re-upload of the same bytes a *silent* no-op. That is the bug S9 tries to fix — and S9's fix is more dangerous than the bug (B1). |

The plan's other three "corrections to the brief" (§12.4): PPTX ✔ (above); stale UI copy ✔ (`page.tsx:24` "Parser factory not wired yet", `page.tsx:96-97` "actual parsing is stubbed" — both false, `parsers.ts:188-227` is fully implemented); 3-param `errorHandler` ✔. All three are factually right, so the premise is sound.

---

## EVIDENCE

**Files read in full:** `server/src/routes/ingest.ts` (94 L), `server/src/app.ts` (63 L), `server/src/ingest/service.ts` (236 L), `server/src/ingest/parsers.ts` (278 L), `server/src/ingest/chunker.ts` (109 L), `server/src/ingest/types.ts` (116 L), `server/src/ingest/index.ts`, `server/src/middleware/error.ts`, `server/src/middleware/auth.ts`, `server/src/db/schema.ts`, `server/src/index.ts`, `server/src/config/index.ts`, `server/package.json`, `server/tsconfig.json`, `web/src/lib/api.ts`, `web/src/app/dashboard/inbox/page.tsx`, `.pipeline/phase1/{REQUEST.md,PLAN.md,baseline.sha256}`.

**Facts established by reading (file:line):**
- `ingest.ts:22-23` reads `req.body.file`; `:25` requires `file.buffer`; `:30-33` builds an extension-less `tmp-` path; `:34` writes it; `:36-43` calls `ingestFile` with `name/path/sizeBytes/kind/accessPolicy/metadata`; `:44` `res.json(result)`; `:45-47` `finally unlinkSync`; `:48-51` catch → 400 `{error: err.message}`.
- `app.ts`: helmet `:32`, `express.json({limit:'1mb'})` `:33`, limiter `:35-41`, `authMiddleware` before `ingestRouter` `:53`, `notFound` `:59`, `errorHandler` `:60`. No multipart parser; no `urlencoded`.
- `service.ts:105-171` pipeline: DOC_KINDS guard `:109`, hash `:114`, `storagePath = <hash><ext>` `:115-116`, dedupe early-return `:120-123`, **blob written `:126` before `parseFile` `:130`**, chunker 300/50/20 `:135-141`, `storeDocument` `:144-154`, extract write after commit `:157`.
- `service.ts:185-225` transaction: `BEGIN :187`, INSERT doc `RETURNING id :189-203`, chunks `UNNEST :210-215`, `COMMIT :217`, `ROLLBACK :221`, `release` `:225`.
- `parsers.ts:268-272` `parseFile` dispatches on `path.extname(filePath)` and throws `Unsupported file type: .<ext>`; registry at `:188-227`; `EXTENSION_TO_KIND` `:229-250`; `detectKind` `:252-255`; `parsePdf` shells to `pdftotext` `:66`.
- `chunker.ts:53-54` empty text → `[]`; `:74-80` synthetic `chunk-<start>-<end>` ids; `:45` `safeOverlap` clamp.
- `schema.ts:12` `sha256 TEXT NOT NULL` (no UNIQUE); `:13` `status DEFAULT 'pending'`; `:22` `ON DELETE CASCADE`; `:21` `chunks.id UUID`.
- `tsconfig.json`: `strict true`, `esModuleInterop true`, `include ["src/**/*.ts"]`, `exclude [node_modules, dist, **/*.test.ts]`, **no `types`/`typeRoots`** ⇒ `@types/multer` is auto-included; `req.files` augmentation will be visible.
- `api.ts:29-38`: 401 → throw "Unauthorized"; `!res.ok` → `throw new Error(body.error || ...)`; success → `return (await res.json()) as T` (cast only).
- `page.tsx:13-14` filters `pdf|docx?|pptx?|xlsx?|txt|md|html?` (no images); `:33` appends under **`files`**; `:22-25` ignores the response; `:24,:96-97` stale copy.

**Commands run (read-only):**
- `sha256sum -c .pipeline/phase1/baseline.sha256` → **27/27 OK** (planner changed no code).
- `ls .pipeline/phase1/` → `baseline.sha256`, `PLAN.md`, `REQUEST.md` (no `REVIEW.md` before this write).
- `ls server/data/uploads` → **empty**; `server/data/{uploads,extracts}` exist ⇒ post-test blob assertion has a real zero baseline.
- `grep -rn "ingest/upload|ingestUpload|multipart|multer"` (ts/tsx/json, excluding node_modules/dist/.next) → only `web/src/lib/api.ts:64-65` and `inbox/page.tsx:22` ⇒ the Inbox is the sole caller (A1 holds).
- `grep '"multer"|"busboy"' server/package.json` → no match; `search_files` over `server/node_modules` → no `multer`, no `@types/multer`; `grep` in `package-lock.json` → no `node_modules/multer`, no `busboy` ⇒ root cause 4.1 confirmed.
- `grep -o '^[A-Z_]*' server/.env` → `PORT HOST DATABASE_URL ADMIN_USERNAME ADMIN_PASSWORD JWT_SECRET LOG_LEVEL` (names only; no values read or printed) ⇒ T2 is feasible with `set -a; . .env`.
- Installed versions read from `node_modules`: **express 4.22.3**, **@types/express 4.17.25** (plan's `package.json:18` says `^4.19.2`) — relevant to B7: Express 4 does not forward async rejections.
- `git status` → *not a git repository* ⇒ "no unrelated files change" must be enforced by `baseline.sha256` + an `ls` snapshot, not by git.

**Multer 2.x behaviour (verified against the library source, not from memory):** `fileFilter`'s `cb(err)` calls `abortWithError(err)`, which waits for pending writes and then `removeUploadedFiles(uploadedFiles.concat(pendingFiles.filter(f => f.path)))` before `next(err)` ⇒ (i) a filter rejection aborts the **whole request**, so per-file filter isolation is not achievable; (ii) multer does attempt temp-file cleanup on abort, but failures surface only in `uploadError.storageErrors` — hence revisions 5 and 11. Also `try { Busboy(...) } catch (err) { return next(err) }` ⇒ a missing boundary is a **plain Error**, which is what breaks the plan's mapper spec (B2).

**Not verified (do not treat as fact):** I did not install or run `multer`/`busboy`; I did not start the server or execute any upload; I did not query or write PostgreSQL; I did not run `npm view` (network) so `multer@2.5.0` / `@types/multer@2.3.0` remain the brief's + plan's registry claim — S3 must confirm, and revision 12 adds the CJS-loadability probe.

---

*End of review.*
---

## ROUND 2 REVIEW

**Reviewer:** INDEPENDENT PLAN REVIEWER (same role)
**Subject:** `PLAN.md` revision round 1 (888 lines) vs `REVIEW.md`'s 14 required revisions, `REQUEST.md`, and the real repo at `D:\Develop\knowledge-app`
**Method:** every R-item re-checked against the plan text (revision log's "DONE" cells ignored), then a full internal-consistency pass over the test suite as one program (fixture inventory → dedupe interactions → row deltas → cleanup), plus independent verification of the pinned dependency versions and of multer 2.5.0's actual abort/cleanup semantics from the library source. No code edited, nothing installed, no build, no DB write.

### DECISION

**REVISE** — 5 numbered, mechanical changes (all in §7 T12 / §5.6, plus one new test). The *design* is now sound and I would approve it without hesitation; what fails is the suite's own accounting: `T12` as printed cannot restore the baseline (it leaves 1 document row, 1 chunk row and 8 blobs), and the handler leaks temp files on the two 400 paths the plan itself mandates. Both are the exact class of defect this phase exists to prevent (REQUEST AC5/AC10, AC11).

Deliberately **rejected** the "approve with cosmetic follow-ups" option: T12 is AC11's only proving test, and given its position before T13 it would either fail loudly or — worse — pass vacuously while leaving residue. That is not cosmetic.

### SUMMARY

- **All 14 revision dispositions are real.** Verified against the plan text and the code, not the log: the contract is single-valued (§5.7/§5.8/AC1/AC5/T4/T11/EC9/Q1–Q3 agree), S9's blob deletion is gone with F1 in its place, the mapper is terminal with an exact 7-row table, temp files live in `server/data/tmp` and every assertion uses `find data/tmp`, T3–T14 are executable (`$TOKEN`, literal URLs, heredoc creds, `want_err` on every failure case), T13/T14 exist and are wired into the AC tables.
- **Both self-declared planner deviations are correct.** (a) T3 uploading `p1-ok3.txt` keeps `p1-ok.txt`/`p1-ok2.txt` un-ingested so T4's `+2` holds, and T4 recomputes `DOC_B` immediately before its request, so T3's second (unicode) upload cannot disturb the delta. (b) `p1-broken2.docx` / `p1-t11.txt` for T11/T14 are right: `p1-broken.docx` already has a blob after T9, so re-uploading it would dedupe into a 200 *success* and T11's 207 would never appear; T14's reuse of an already-stored `p1-t11.txt` strengthens the test (the abort must produce 0 rows even though that file is ingestable). **However**, deviation (b) creates a *second* orphan blob (`p1-broken2.docx`) that nothing in the plan ever names again — T12 only knows `$ORPHAN_BLOB` from T9. That is finding **RB2**.
- **Row-delta arithmetic is consistent end to end** (audit table below): 7 documents, 7 chunks, 9 blobs exist at cleanup time; every expected delta is satisfiable and every `chunkCount` assertion (1 / 0 / 1) is correct against the real chunker config (300/50/20, `service.ts:135-141`).
- **The pinned versions exist and are typecheck-safe:** `npm view` → multer **2.5.0** and `@types/multer` **2.3.0** are both published. `@types/multer@2.3.0` declares global `Express.Multer.File`, the `req.files` union, and `class MulterError` on the module namespace, so §5.6.3 and `err instanceof multer.MulterError` compile under this repo's `strict: true` + `esModuleInterop: true` (verified in `server/tsconfig.json`; installed `@types/express` is 4.17.25).
- **The mapper can distinguish every documented case** — verified against multer 2.5.0 source, not memory: `filesLimit`→`LIMIT_FILE_COUNT`, `partsLimit`→`LIMIT_PART_COUNT`, `fieldsLimit`→`LIMIT_FIELD_COUNT`, `limit`→`LIMIT_FILE_SIZE`, filter/over-count→`LIMIT_UNEXPECTED_FILE`, and a missing boundary is a **plain** `Error('Multipart: Boundary not found')` thrown by `Busboy(...)` inside multer's `try { } catch { return next(err) }` — exactly row 6.
- **Remaining blocker is accounting, not architecture:** T12's blob removal is a shell *comment* (`#    rm -f "$DB/data/uploads/<hash>.txt" ...`), the `résumé.txt` row is invisible to `name like 'p1-%'`, and the metadata/`access_policy` early returns leak temps because the per-file `finally` sits inside a loop those returns never reach.

### REVISION-BY-REVISION VERIFICATION (R1–R14)

| # | Required revision | Verdict | Where I checked |
|---|---|---|---|
| R1 | Collapse the contract to one rule | **CLOSED** | §5.4 (`169-173`) "The response contract is one rule … no 'array for many, object for one' branch"; §5.7 table (`259-263`); §5.8 rows 1–3 (`277-279`); AC1 (`61`) asserts `results[0]` + all nine fields; AC5 (`65`); T4/T11/T9/T14; EC7/EC9 (`739`,`741`); Q1–Q3 (`811-813`). Greps for `must then be an array` / `or the single` → only the Q1/Q2 *question* text remains, always resolved to the envelope. |
| R2 | Delete S9's blob deletion, add F1 | **CLOSED** | §6 S9 (`342`) "**No blob deletion**"; §9 R5 struck (`763`); F1 (`879`) with the full TOCTOU argument (content-addressed path, no UNIQUE, dedupe success for a second request, read-then-delete); T9 (`596-598`) now asserts the orphan blob is **present**; EC7 (`739`) "No blob cleanup in the route". No residual blob-deletion assertion anywhere. |
| R3 | Fix §5.8's last row; mapper terminal | **CLOSED** | §5.8 (`285`) "Unexpected error inside the mapper → **500** `{error:'Upload failed'}` → **mapper itself**"; the Critical paragraph (`287`) states the 3-param `errorHandler`, "never calls `next(err)` … no fallback path", stack + `err.message` logged server-side only. I re-verified `middleware/error.ts:7` is 3 params and `app.ts:60` registers it. |
| R4 | Exact mapper classification table | **CLOSED** | §5.8.1 (`289-305`): 7 rows, correct order, statuses 413/400/400/400/400/400/500; messages match the greps in T6/T7/T8/T14 (`Unsupported file type: .exe`, `File too large (max 25MB)`, `Malformed multipart request`). Every code exists in multer 2.5.0 (`limit`/`partsLimit`/`filesLimit`/`fieldsLimit` handlers). |
| R5 | Mapper sweeps `req.files` | **CLOSED** | §5.8.2 (`307-323`): array-or-map normalisation, `fs.rmSync(f.path,{force:true})` per entry, `err.storageErrors` logged. Rationale is directionally right; see N3 for the 2.5.0 nuance (`req.files` holds *completed* files; pending ones are removed by multer's `finishAbort` + the disk engine's Windows-aware unlink). |
| R6 | Temp dir out of the content-addressed dir | **CLOSED** | §5.6 (`204-209`): `path.resolve(ingestionService.storageDir,'..','tmp')` + `mkdirSync` **before** the multer instance; §6 S4 (`337`) repeats the ordering; every assertion goes through `tmpcount()` → `find "$DB/data/tmp" -name 'tmp-*'` (`400`). Zero `ls data/uploads | grep '^tmp-'` remain except the revision-log prose. |
| R7 | Rewrite T9 | **CLOSED** | T9 (`584-604`): 400 + `want_err`, `p1-broken%` rows = 0, chunks unchanged, `want_tmp0`, `$ORPHAN_BLOB` asserted **present**; T12 (`654`) removes that exact path. (R7 named only the T9 orphan — see RB2 for the one it did not name.) |
| R8 | Rewrite T4 (+ distinct fixture) | **CLOSED** | T3 creates `p1-ok2.txt` with a different word list (`460`); T4 (`521-530`) asserts 200, `results.length==2`, `errors.length==0`, `doccount` delta **+2**; prose (`531`) explains why identical bytes would dedupe to 0. |
| R9 | Make the suite executable | **CLOSED** | T2 (`435-443`) exports `TOKEN`; 18 request lines carry `-H "Authorization: Bearer $TOKEN"`; T13(b) sends a 16-char garbage token (verified per line that it is **not** `$TOKEN`); no `-X POST ...` elisions; creds via `set -a; . ./.env; set +a` + `--data @- <<JSON` (no password in argv, none echoed — grep confirms); `want_err` checks status **and** body (JSON, string `.error`, no `<html`, no `at …:N:N`). |
| R10 | Add T13 | **CLOSED** | T13 (`678-708`) a–e: no-auth 401 + `want_tmp0`, garbage-token 401, `/watch` 200 with `documentId`/`chunkCount==1`, `/health` 200, `/search` JSON-not-HTML; wired to **AC7** (`67`) and **REQUEST AC6** (`82`). |
| R11 | Add T14 + correct the isolation claim | **CLOSED** | §5.4 (`174-179`) abort semantics; EC9 (`741`); T11 note (`637`); T14 (`710-724`) 400, 0 rows, 0 tmp, `{error}`-only body. |
| R12 | Pin the typecheck-safe shape | **CLOSED** | §5.6.3 (`240-249`) + S3b (`336`). Checked against the real `tsconfig.json` (`strict:true`, `esModuleInterop:true`, no `types`/`typeRoots`, `include: src/**/*.ts`) and `@types/multer@2.3.0`'s declarations (`Express.Multer.File` global, `req.files` union, `multer.MulterError` class). `res.status().json(); return;` matches the file's existing pattern. Residual: `err`'s annotation is unpinned — N2. |
| R13 | Add the two input guards | **CLOSED (untested)** | §5.6 step 2 (`215-216`) both guards; §5.8 rows (`281-282`); EC12/EC12b (`744-745`); Q8 (`818`). No test exercises either — see RB4, which also exposes RB3. |
| R14 | Re-sync derived sections | **PARTIAL** | AC1/AC5/AC6/AC7/AC8/AC10, §5.4/5.7/5.8, T3/T4/T7/T9/T11, EC7/EC9, §10 item 3, §11 all re-synced and consistent; the REQUEST↔AC table (`75-86`) names a numbered test for **every** AC. Not closed: **T12** was left internally inconsistent with the rest of the suite (RB1/RB2/RB5) — the exact class R14 was meant to catch. |

### FIXTURE / CONSISTENCY AUDIT

**Inventory — every referenced fixture is created in T3 with the exact filename used later.** No undefined fixture, no fixture created but unused.

| Fixture | Created | Consumed by | Ingest outcome | Doc row | Blob at cleanup |
|---|---|---|---|---|---|
| `p1-ok.txt` | T3 `459` | T4, T13(a), T13(b) | 1 success (T4); T13 a/b never reach the handler (401) | 1 | 1 × `.txt` |
| `p1-ok2.txt` | T3 `460` | T4 | success | 1 | 1 |
| `p1-ok3.txt` | T3 `461` | T3 upload, T5 wrong-field | success in T3; T5 aborts in `wrappedFileFilter` before any write | 1 | 1 |
| `p1-t10.txt` | T3 `462` | T10 ×2 | success + dedupe (2nd = `chunkCount:0`, 0 rows) | 1 | 1 |
| `p1-t11.txt` | T3 `463` | T11, T14 | success in T11; T14 aborts before the handler | 1 | 1 |
| `p1-t13.txt` | T3 `464` | T13(c) `/watch` | success, 1 chunk | 1 | 1 |
| `résumé.txt` | T3 `468` | T3 (unicode check) | success, 1 chunk | **1 (name does not start with `p1-`)** | 1 |
| `p1-broken.docx` | T3 `466` | T9 | blob written, `parseFile` throws → 400 | 0 | 1 (`$ORPHAN_BLOB`, tracked) |
| `p1-broken2.docx` | T3 `467` | T11 | blob written, `parseFile` throws → error entry | 0 | **1 (untracked)** |
| `p1-bad.exe` | T3 `465` | T6, T14 | `fileFilter` reject, nothing written | 0 | 0 |
| `p1-big.txt` | T3 `469` | T7 | `LIMIT_FILE_SIZE`, partial temp, no blob | 0 | 0 |

**Row-delta arithmetic — every assertion is satisfiable in execution order T0→T14 (with T12 last; see RB5).**

| Test | `DOC_B` captured | Expected delta | Why it holds |
|---|---|---|---|
| T3 upload | — | +1 | `p1-ok3.txt` uploaded for the first time |
| T3 unicode | — | +1 | `résumé.txt` has unique bytes |
| T4 | after T3 | **+2** | `p1-ok`/`p1-ok2` still un-ingested (deviation (a) correct); `DOC_B` is recomputed, so T3's two rows cannot perturb it |
| T9 | — | 0 | parse throws before `storeDocument` |
| T10 | before first | +1, then still +1 | dedupe keys on blob existence (`service.ts:119-123`); `p1-t10` fresh |
| T11 | before | +1 | `p1-t11` fresh; `p1-broken2` fails post-multer → 207 with exactly 1 error |
| T14 | before | **0** | whole-request abort; the reused `p1-t11` never reaches the handler, so this does not depend on dedupe |
| T13(c) | — | +1 | `/watch` on fresh `p1-t13.txt` |

**`chunkCount` assertions are correct against the real chunker** (`chunker.ts` + `service.ts:135-141`: 300 words / 50 overlap / 20 min). Fixture bodies are 168–198 tokens (`p1-ok*` 198, `p1-t10`/`p1-t11` 168, `p1-t13` 180, `résumé` 48) → exactly **1** chunk each. So T10's `1`, T13(c)'s `1` and T3's `>=1` all hold, and T10's dedupe `0` matches `service.ts:122`.

**Dedupe interactions:** no fixture is uploaded twice except `p1-t10.txt` (deliberate, T10), `p1-t11.txt` (T11 then T14, where the second request aborts before parsing) and `p1-ok.txt` (T4 then T13 a/b, both 401). No dedupe can silently flip a delta. Deviation (b)'s reasoning is sound; its only side effect is the untracked orphan (RB2).

**Cleanup completeness — what exists at step 3 vs what T12 removes.**

| Artifact | Exists | T12 removes it? |
|---|---|---|
| `documents` for the 6 `p1-*` docs | 6 | ✅ `where name like 'p1-%'` (`648-649`) |
| `documents` for `résumé.txt` | 1 | ❌ **matched by no predicate** (RB1) |
| `chunks` for those 6 | 6 | ✅ |
| `chunks` for `résumé.txt` | 1 | ❌ (RB1) |
| blobs `<hash>.txt` × 7 | 7 | ❌ **`# rm -f "$DB/data/uploads/<hash>.txt" ...` is a comment** (RB2) |
| blob `$ORPHAN_BLOB.docx` (T9) | 1 | ✅ (`654`) |
| blob `<hash(p1-broken2)>.docx` (T11) | 1 | ❌ **no variable anywhere names it** (RB2) |
| temp `data/tmp/tmp-*` | 0 | ✅ `want_tmp0` |
| fixtures | 11 | ✅ `rm -f "$FIX"/p1-*` + `résumé.txt` |
| `admins` / `audit_log` | 1 / 0 | ✅ asserted |

Net if T12 runs exactly as printed: `documents=1`, `chunks=1`, 8 entries in `data/uploads` → **three assertions fail** (`UPLOADS DIFF`, `documents`, `chunks`) and a test row survives in the user's DB. The step-1 preview (`select … where name like 'p1-%'`) does not show the `résumé.txt` row either, so "look at the preview before deleting" cannot catch it.

### REMAINING BLOCKING FINDINGS

**RB1 — T12 cannot delete the `résumé.txt` document/chunk (AC11 fails; user DB left dirty).**
T3 (`508-516`) creates a real document whose `name` is `résumé.txt` (or its latin1 mojibake — either way it does not begin with `p1-`). T12's only predicates are `where name like 'p1-%'` (`648-649`). Result: `documents=1`, `chunks=1` at step 7, both assertions fail, and a test row survives in the user's DB — the one thing REQUEST AC10 forbids.
**Fix (replace `648-649`)** — delete by content hash, not by name:
```bash
RES_H=$(sha256sum "$FIX/résumé.txt" | cut -d' ' -f1)
"$PSQL" $PGARGS -c "delete from chunks where document_id in (select id from documents where name like 'p1-%' or sha256='$RES_H');"
"$PSQL" $PGARGS -c "delete from documents where name like 'p1-%' or sha256='$RES_H';"
```
and make step 7 compare against `$DOC0`/`$CHUNK0` (captured at T2 `447`) instead of hardcoding `0`, so the assertion stays honest if the user's baseline is not empty.

**RB2 — T12's blob removal is a placeholder comment; two orphan blobs survive.**
`651-654` contains exactly one executable removal (`$ORPHAN_BLOB.docx`) and one *comment*: `#    rm -f "$DB/data/uploads/<hash>.txt" ...`. Run as printed, 7 `.txt` blobs plus `p1-broken2.docx`'s blob remain, so the pre/post listing diff fails. Worse, a diligent implementer cannot derive the second orphan from the given instruction: `p1-broken2.docx`'s parse failed, so it has **no** `documents` row and therefore no hash in the preview the text tells them to work from.
**Fix (replace `651-654`)** — an executable loop over the fixtures, which are still on disk at step 3, so it is exact rather than blind:
```bash
for f in "$FIX"/p1-*.txt "$FIX"/résumé.txt "$FIX"/p1-broken.docx "$FIX"/p1-broken2.docx; do
  h=$(sha256sum "$f" | cut -d' ' -f1)
  rm -f "$DB/data/uploads/$h".*
done
```
plus the existing exact line for `$ORPHAN_BLOB.docx` as belt-and-braces. That covers all 9 blobs including both orphans, with no wildcard on the directory itself.

**RB3 — the plan's own whole-request 400s leak temp files.**
§5.6 step 2 (`214-217`) validates `metadata`/`access_policy` **after** multer has already written every file into `data/tmp`, and returns `res.status(400).json(...); return;` (`281-282`). The per-file `finally` (`225`) lives inside the loop, which those returns never reach, and §5.8.2's sweep runs only in the mapper. So every rejected-metadata upload leaves 1–10 full-size files in `server/data/tmp` permanently — a direct violation of AC8 ("on success **or** any failure") and REQUEST AC5, on paths this plan itself introduced (R13). The handler's outer `catch` has the same hole.
**Fix:** add one sentence to §5.6 step 2 and step 4 — *"Every early return taken after multer has run (invalid `metadata`, invalid `access_policy`, and the outer `catch`) must first sweep `req.files` exactly as §5.8.2 does (`fs.rmSync(f.path,{force:true})` per entry) before writing the response."*

**RB4 — R13's two guards have no test, and RB3's sweep needs one.**
Neither guard is exercised anywhere in §7 (only prose in EC12/EC12b). Add **T15**:
```bash
DOC_B=$(doccount)
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" \
  -F "files=@$FIX/p1-ok.txt" -F 'metadata=not json'
want 400 "invalid metadata JSON"; want_err
printf '%s' "$BODY" | grep -q 'Invalid metadata JSON' && echo "  guard message OK" || { echo "  MESSAGE FAIL"; FAILED=1; }
want_val "$(( $(doccount) - DOC_B ))" "0" "no rows from a rejected field"
want_tmp0          # proves the RB3 sweep

req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" \
  -F "files=@$FIX/p1-ok.txt" -F 'access_policy=banana'
want 400 "invalid access_policy"; want_err
want_tmp0
```
`p1-ok.txt` is already stored, so a 200 would be a silent dedupe success — the status assertion discriminates, and the `want_tmp0` lines prove the fix.

**RB5 — T12 is printed before T13/T14; run in document order it is both vacuous and dirtying.**
§7 places `T12 — Cleanup` at `639` with T13/T14 after it, while §6 only implies cleanup last (`S11` run tests → `S12` cleanup, `344-345`). Read sequentially, T12 asserts a clean DB *before* T13(c) creates the `/watch` document `p1-t13.txt` and before T14 runs — so the suite reports green while leaving a document + blob behind: exactly the silent-residue failure mode REQUEST AC10 exists to prevent.
**Fix:** move the T12 block below T14, or retitle it `### T12 — Cleanup (AC11) — RUN LAST, after T14` and repeat the note in S11.

### NON_BLOCKING FINDINGS

1. **`MulterError` catch-all gap.** multer 2.5.0 has codes outside §5.8.1's row 4 (`MISSING_FIELD_NAME`, `INVALID_FIELD_NAME`, `LIMIT_FIELD_NESTING`, `LIMIT_FIELD_ARRAY_INDEX`, `STREAM_DESTROYED`); all fall to row 7 → **500** for a client-caused malformed body, against AC6's spirit. Cheap hardening: row 7 becomes *"any other `MulterError` → 400 `Malformed form data`; anything else → 500 `Upload failed`"*.
2. **`err`'s annotation is unpinned.** §5.8.2 casts `(err as {storageErrors?…})`, hinting at `unknown`, but rows 5–6 read `err.code` directly, which fails `tsc` under `unknown`. Pin the mapper signature as `(err: any, req: Request, res: Response, _next: NextFunction)` (Express's own `ErrorRequestHandler` types it `any`). S10 would catch it, at the cost of a wasted round-trip.
3. **§5.8.2's rationale overstates `req.files`.** In 2.5.0 `FileAppender` sets `req.files = []` up front and fills it with *placeholders*; `replacePlaceholder` runs only after the storage engine completes, and pending writes are removed by `finishAbort` + the disk engine's close-aware unlink. So the sweep is a genuine second chance for *completed* files, not "the only place those leaked paths are visible"; also `f.path` can be `undefined` after multer's own `_removeFile`, which the `try/catch` already tolerates. Behaviour is safe; soften the sentence.
4. **§9's R5 row is struck through, not removed** (`763`). R2 said "delete R5". Cosmetic.
5. **AC8's proving-test list is incomplete** (`68`): it names T3/T7/T9/T11/T13/T14, but T4/T5/T6/T8/T10/T12 also call `want_tmp0`. Harmless; the list understates coverage.
6. **T2's heredoc body breaks if `ADMIN_PASSWORD` contains `"` or `\`** (unquoted heredoc into raw JSON). Fallback if login returns non-JSON: build the body with `node -p 'JSON.stringify({username:process.env.ADMIN_USERNAME,password:process.env.ADMIN_PASSWORD})'` — still no argv exposure.
7. **Extracts are not cleaned.** Every successful ingest writes `server/data/extracts/<hash>.txt` (`service.ts:157`); T12 leaves 7 of them. Not covered by any AC and not in `baseline.sha256` (27 source files only), so not blocking — add `rm -f "$DB/data/extracts/$h.txt"` inside RB2's loop if the data dir is to be restored exactly.
8. **Row 5's message for an extension-less name** renders `Unsupported file type: .` (the filter's own error says `(none)`). Cosmetic; untested.
9. **The handler's outer `catch` status/body is unspecified** while §5.6.3 requires the catch to exist. Pin it (e.g. 400 `{error:'Upload failed'}` + server-side log) so it cannot drift into a 500-with-internal-message that AC6 forbids.

### SCOPE CHECK

No drift. Only `server/src/routes/ingest.ts` is edited (+ `server/package.json` / `package-lock.json` via npm), matching AC10 and the REQUEST's in-scope list; §6 S8/S9 remove the old disk-era block and keep cleanup temp-only; §10 now lists orphan-blob cleanup **inside `service.ts`** as out of scope (item 3) and keeps `middleware/error.ts`, FTS, JWT, Library/Audit, Chat, `web/**` and `dist/**` out. No new module under `src/` (envelope/error types declared locally), no schema change, no `npm run build`, no DB reset. RB1–RB5 are edits to the test document plus one sentence of §5.6 — they add no implementation scope and nothing here drifts into a pipeline rewrite.

### TEST COVERAGE CHECK

| Criterion | Proving test | Status |
|---|---|---|
| AC1 (200 + 9 result fields) | T3 body assertion (`479-490`), T4 | ✅ |
| AC2 (documents row/hash/kind/size/policy) | T3 psql (`498-500`) | ✅ |
| AC3 (chunks == chunkCount, ≥1) | T3 psql (`501`) | ✅ |
| AC4 (blob `<hash>.txt`) | T3 `ls` (`503`) | ✅ |
| AC5 (envelope; status + body on failure) | T5–T9, T13, T14 via `want` + `want_err` | ✅ |
| AC6 (4xx JSON, no 500/HTML/stack) | T5, T6, T7, T8, T14 | ✅ |
| AC7 (route-scoped mount, auth first, other routes) | T13, T1 | ✅ |
| AC8 (no temp leak on any failure) | T3,T4,T5,T6,T7,T8,T9,T10,T11,T13,T14 | ⚠ **leaks by design on the metadata/access_policy 400s** (RB3); untested (RB4) |
| AC9 (tsc clean) | T1 | ✅ |
| AC10 (baseline 27/27, no `web/**`) | T1b — I re-ran it: 27/27 OK today | ✅ |
| AC11 (DB restored, admins=1) | T12 | ❌ **fails as written** (RB1, RB2) and runs too early (RB5) |
| REQUEST 1 (multipart, `files`, 1+) | T3, T4 | ✅ |
| REQUEST 2 (via `ingestFile`, doc+chunks) | T3, T4 | ✅ |
| REQUEST 3 (limits + actionable messages) | T6, T7, T5 | ✅ |
| REQUEST 4 (4xx, no 500/stack) | T5, T6, T7, T8, T14 | ✅ |
| REQUEST 5 (temp cleanup success + failure) | T3,T7,T9,T11,T13,T14 | ⚠ RB3 |
| REQUEST 6 (401 without bearer) | T13(a) | ✅ |
| REQUEST 7 (`tsc -p tsconfig.json --noEmit`) | T1 | ✅ |
| REQUEST 8 (client contract) | T3 envelope + T5–T9 body shape | ✅ |
| REQUEST 9 (baseline) | T1b | ✅ |
| REQUEST 10 (DB never reset) | T12 | ❌ RB1 |

Every REQUEST AC names a numbered test (R14 closed). Both ❌ rows are the same test, `T12`.

### EVIDENCE

**Read (repo):** `PLAN.md` in full (888 lines), `REVIEW.md` (round 1), `REQUEST.md`, `server/src/routes/ingest.ts` (94 L), `server/tsconfig.json`, `server/package.json`, `server/src/app.ts:25-63`, `server/src/ingest/chunker.ts` (109 L), `server/src/ingest/service.ts:100-175`, `server/src/utils/logger.ts`.

**Commands run (read-only):**
- `sha256sum -c .pipeline/phase1/baseline.sha256` → **27 OK / 0 failed** (no code changed).
- `wc -l PLAN.md` → **888**.
- `ls -d server/node_modules/multer server/node_modules/@types/multer` → both absent (deps not installed).
- `server/data/uploads` empty; `server/data/tmp` absent; `server/data/extracts` empty ⇒ a real zero baseline for blob/temp/extract assertions.
- `npm view multer versions` → includes **2.5.0**; `npm view @types/multer versions` → includes **2.3.0** (S1/S2 will not fail on a phantom version).
- Installed: `express 4.22.3`, `@types/express 4.17.25`.
- `grep -c 'Bearer $TOKEN'` → 18 request lines (+2 prose); T13(b)'s token is a **16-char literal, not `$TOKEN`** (checked line by line).
- Residue greps: `'^tmp-'` → only revision-log prose; `must then be an array` / `or the single` → only Q1/Q2 question text; `res.json(result)` → only an evidence-table citation; `echo …ADMIN_PASSWORD` → none.
- `grep -n 'rm -f' PLAN.md` → `652` (a **comment**, `<hash>` placeholder), `654` (`$ORPHAN_BLOB.docx`), `665` (fixtures).

**Verified from the library source (not memory), multer 2.5.0 on unpkg:**
- `index.js`: `module.exports.MulterError = MulterError`, `diskStorage`, `memoryStorage`; `.array(name,maxCount)` routes through `wrappedFileFilter`, which rejects an unlisted field name (or an exhausted count) with `MulterError('LIMIT_UNEXPECTED_FILE', fieldname, originalname)` ⇒ T5's `file=` yields exactly the documented row-3 400, and nothing is written (the check precedes `_handleFile`).
- `lib/make-middleware.js`: `try { Busboy(...) } catch (err) { return next(err) }` ⇒ missing boundary is a **plain Error** → row 6; `busboy.on('limit')` ⇒ `LIMIT_FILE_SIZE`; `partsLimit`/`filesLimit`/`fieldsLimit` ⇒ `LIMIT_PART_COUNT`/`LIMIT_FILE_COUNT`/`LIMIT_FIELD_COUNT`; `abortWithError` waits on `pendingWrites`, then removes `uploadedFiles ∪ pendingFiles(with path)` and attaches `storageErrors`.
- `storage/disk.js`: 2.5.0 keeps an `openStreams` map and defers `unlink` until the write stream's `close` ("Windows refuses to unlink open files") ⇒ the `LIMIT_FILE_SIZE` abort leaves no temp, so T7/T14's `want_tmp0` is achievable.
- `lib/file-appender.js`: ARRAY strategy sets `req.files = []`, inserts/removes placeholders, and `replacePlaceholder` runs only on success ⇒ basis for N3.

**Not verified (do not treat as fact):** I did not install multer, start the server, or execute any request; I did not read or write PostgreSQL beyond what round 1 recorded; the 26 MiB `p1-big.txt` fixture and the `résumé.txt` name-mangling behaviour are taken from the plan's own description.

**PLAN.md edits made by me:** **none.** The required fixes are multi-line (T12 rewrite, a §5.6 sentence, a new T15, a heading), not the single-line unblock the round-2 brief permits.

*End of round 2 review.*

## ROUND 3 REVIEW
DECISION: REVISE

**Reviewer:** INDEPENDENT PLAN REVIEWER (same role), round 3 — bounded final gate
**Subject:** `PLAN.md` 943 lines, revision round 1+2 (R1–R18). This round re-checks **only** R15–R18 (round 2's RB1–RB5) and the regressions those edits could have introduced. Round-1 architecture was not re-litigated; round-2's own analysis stands except where corrected below.
**Method:** every "DONE" cell in the R15–R18 revision log re-verified against the plan text (never against the log); the T12 block re-read as an executable program against the T2/T3/T9/T11/T15 state it operates on; the Postgres semantics of the new predicates checked against the PG 18 documentation rather than memory; repo baseline re-hashed. No code, plan or DB was edited. Nothing was installed, started or executed against the database.

### DECISION

**REVISE** — **one** blocking defect (with a second instance of the same defect in the adjacent line), both inside the rewritten T12, both fixable by one exact replacement given below. RB1–RB5 are otherwise genuinely closed: the temp-sweep gap (RB3), the untested guards (RB4), the ordering defect (RB5) and the unmaterialised blob removal (RB2) are all really fixed in the plan text.

The defect is not cosmetic and not "already broken anyway": T12's new predicate `name ~ '[^[:ascii:]]'` is **valid, working SQL** (PostgreSQL defines the `ascii` character class — see check (i)) that will delete **every pre-existing document whose name contains a non-ASCII character**, together with its chunks, its blob and its extract. In an app whose entire purpose is ingesting a user's own documents, accented/CJK/typographic filenames are ordinary, and REQUEST AC10 / AC11 say the user's data is never touched. A cleanup step must be safe *by construction*, not safe-because-the-DB-happens-to-be-empty; T2 only *prints* `# expect 0 / 0` and does not gate on it.

### RB1–RB5 CLOSURE

| Finding | Verdict | Where I verified it |
|---|---|---|
| **RB1** — T12 could not delete the `résumé.txt` row | **ADDRESSED BUT REJECTED AS WRITTEN** — the row is now matched (predicate at `653`, `657`, `661`, `662`), but by a table-wide *name* predicate rather than the hash-scoping round 2 required. Effectiveness ✔, safety ✘ → **R3-B1**. | `PLAN.md:653,657,661,662` |
| **RB2** — blob removal was a placeholder comment; two orphans survived | **CLOSED** — step 4 (`665-670`) is now executable: (a) every hash in `$TEST_SHA`, (b) `$ORPHAN_BLOB` exact, (c) `p1-broken2.docx` exact, (d) a loop over every remaining `$FIX/p1-*` computing its sha256 and `rm -f`-ing that blob. No `<hash>` placeholder and no commented-out `rm` remain (`grep -n 'rm -f' PLAN.md` → 667, 668, 669, 686 only, all executable). Residual scoping hazard → **R3-B2**. | `PLAN.md:665-670` |
| **RB3** — post-multer 400s leaked temp files | **CLOSED** — §5.6 **step 2b** (`222`) names all three post-multer returns (invalid `metadata`, invalid `access_policy`, outer `catch`), pins array-or-map normalisation and `try { fs.rmSync(f.path,{force:true}) } catch {}` per entry, and explains why the per-file `finally` cannot cover them; **step 4** (`236`) pins the outer `catch` to sweep → log `err.message`/`err.stack` server-side only → `400 {error:'Upload failed'}` → `return`. | `PLAN.md:222`, `PLAN.md:236` |
| **RB4** — both guards untested; sweep untested | **CLOSED** — **T15** exists (`748-781`) with both rejection cases (`want 400` + `want_err` + message grep + row delta 0 + `want_tmp0`) and a positive control whose result is read back from `metadata->>'team'` in psql. Wired into AC8 (`68`) and REQUEST row 5 (`84`). | `PLAN.md:748-781`, `68`, `84` |
| **RB5** — T12 ran before T13/T14 | **CLOSED** — heading is `### T12 — Cleanup (AC11) — **RUN LAST, after T15**` (`646`), the opening paragraph repeats it and names the failure mode (`648`), `S11` reads "T0–T15, **then T12 last**" (`350`), `S12` = §7 T12 (`351`), AC11 says "T12 (runs last)" (`75`). | `PLAN.md:646,648,350,351,75` |

Non-blocking items adopted (mapper row 7 → 400 catch-all, row 8 → 500; signature `(err: any, req, res, _next)`; AC8 list + T15; REQUEST row 5 wording; S11 wording; R15–R18 log rows; header) are all present and internally consistent: `PLAN.md:307-309` (8 rows, correct order, row 7 = "any other `MulterError` → 400 `Malformed form data`", row 8 = 500), `68`, `84`, `350`, `36-38`, `1-5`.

### DATA-SAFETY CHECK (i) — T12's non-ASCII predicate

**BLOCKING. This predicate can delete a pre-existing user document.**

1. **It is valid SQL, so it will not fail safe.** The PG 18 docs (§9.7.3, pattern matching) list the standard POSIX classes and then state PostgreSQL additionally defines the `word` class *"and the `ascii` character class, which contains exactly the 7-bit ASCII set."* `[^[:ascii:]]` therefore compiles and means exactly "contains a non-ASCII character". This is not a broken query that errors out before `DELETE` — it deletes.
2. **The predicate is unrestricted.** `delete from documents where name like 'p1-%' or name ~ '[^[:ascii:]]';` (`662`) has no run scope: any document in the user's database whose `name` holds one accented letter, a CJK title, a curly quote, an em dash or an `ß` is matched. `chunks` (`661`) is deleted by the same subquery (the `ON DELETE CASCADE` at `schema.ts:22` would do it anyway), so this is not recoverable by re-uploading chunks.
3. **The blast radius is three artefacts, not one.** `TEST_SHA` is derived from the *same* predicate (`657`), and it drives the blob deletion (`667`) and the extract deletion (`676`). So one defective predicate deletes a user's **row, its chunks, its blob on disk, and its cached extract** — the blob being the only copy of the bytes.
4. **Nothing else catches it before the fact.** `$DOC0`/`$CHUNK0` are captured in T2 but only compared at step 9 (`690-691`), i.e. *after* the deletes; a mismatch is a loud failure with the data already gone. T2's `# expect 0 / 0` is a comment, not a gate. The step-1 preview (`653`) uses the same predicate, so "look at it before deleting" shows exactly the rows that are about to be wrongly deleted and offers no discriminator.

**Exact minimal replacement** (drop-in; removes the name predicate entirely and replaces it with hash + baseline scoping, which is what round 2 asked for):

T2, add one line after `BEFORE_UPLOADS` (`456`):
```bash
PRE_SHA=$("$PSQL" $PGARGS -tAc "select sha256 from documents;" | tr -d ' \r' | grep . | LC_ALL=C sort -u)
echo "pre-existing document hashes: $(printf '%s\n' "$PRE_SHA" | grep -c .)"   # must equal $DOC0
```

T12, replace steps 1–3 (`651-662`) with:
```bash
# 1) Test hashes = hashes of the fixture bytes on disk, MINUS any hash the user already owned.
#    Content-addressed, so this is exact, and it covers résumé.txt regardless of how its
#    NAME was decoded (the bytes are what documents.sha256 holds).
FIX_SHA=$(for f in "$FIX"/p1-* "$FIX"/résumé.txt; do [ -f "$f" ] && sha256sum "$f"; done | cut -d' ' -f1 | LC_ALL=C sort -u)
TEST_SHA=$(comm -23 <(printf '%s\n' "$FIX_SHA") <(printf '%s\n' "$PRE_SHA") | grep . || true)
echo "test hashes to remove: $(printf '%s\n' "$TEST_SHA" | grep -c .)"     # EYEBALL THIS FIRST
if [ -n "$TEST_SHA" ]; then
  IN=$(printf "'%s'," $TEST_SHA); IN=${IN%,}          # => 'h1','h2',…
  "$PSQL" $PGARGS -c "delete from chunks   where document_id in (select id from documents where sha256 in ($IN));"
  "$PSQL" $PGARGS -c "delete from documents where sha256 in ($IN);"
else
  echo "  no test documents to delete"
fi
```

Notes on why this is safe and still complete: `résumé.txt` is deleted by **bytes**, so the mojibake concern disappears; a hash the user already owned is excluded by construction (and in that case the upload deduped and created no row anyway, so nothing needs deleting); a user document whose name is non-ASCII but whose bytes were never a fixture is unreachable — it is not in `$FIX_SHA`.

### DATA-SAFETY CHECK (ii) — blob-deletion scoping

**Yes, step 4 can delete a blob a surviving user document references, and the `$DOC0`/`$CHUNK0` comparison does not catch it.**

The path: blob paths are content-addressed (`data/uploads/<sha256><ext>`). If a user document already holds the same bytes as a test fixture, the fixture upload hits the dedupe branch (`service.ts:120-123`) and inserts **no row** — the blob on disk is *the user's blob*. Then `669`/`670` compute the fixture's sha256 and `rm -f "$DB/data/uploads/<that hash>".*` unconditionally, deleting the only copy of a surviving user document's content. `667` (`$TEST_SHA`) and the `$ORPHAN_BLOB` removal have the same shape, and under the current predicate `$TEST_SHA` is itself tainted (check (i)).

Does the baseline comparison catch it? **No, and even where it does, too late:**
- `$DOC0`/`$CHUNK0` (`690-691`) are *row counts*. In the dedupe-collision case no row appears or disappears, so both pass while the user's blob is gone. Counts cannot detect a dangling reference.
- The `$BEFORE_UPLOADS` string diff (`679-680`) **would** catch it (the listing shrinks by one) — but step 6 runs *after* step 4's `rm`. That is detection after irreversible destruction, not prevention. A test suite that reports `FAILED=1` while having deleted the user's document is exactly the failure AC11 exists to prevent.

**Assertion that actually prevents it** — delete only the delta, never a hash guess. Replace step 4 (`665-670`) with:
```bash
# 4) Delete ONLY blobs that did not exist at T2 (i.e. written by this run).
#    Subsumes $TEST_SHA blobs, $ORPHAN_BLOB, p1-broken2 and every fixture blob in one rule,
#    and is incapable of touching a pre-existing user blob.
for b in $(comm -13 <(printf '%s\n' "$BEFORE_UPLOADS" | grep .) <(ls "$DB/data/uploads" | LC_ALL=C sort)); do
  rm -f "$DB/data/uploads/$b"
  echo "  removed run blob: $b"
done
```
With this rule step 6's listing comparison becomes a *checksum of a safe operation* rather than the only thing standing between a bug and the user's data. Keep step 6 as the assertion — it is now guaranteed to pass if the deletion was correct.

### T15 POSITIVE-CONTROL CHECK

- **The fixture is real and distinct.** `p1-t15.txt` is created in T3 (`471`) with a 25-word sequence used by no other fixture, `.repeat(6)` → ~150 tokens, one chunk under the 300/50/20 config. No other fixture, and no earlier test, uploads those bytes.
- **Dedupe cannot fake a pass.** The only possible accidental 200 would be a dedupe hit, and a dedupe hit returns the *pre-existing* row's `metadata` (T15 is the sole test that ever sets `team=ops`; `p1-ok*`/`p1-t1*` are ingested with the default `{}`). So `select metadata->>'team' … where sha256 = <sha(p1-t15)>` yields empty/`{}` on a dedupe and the `want_val "$META_OK" "ops"` fails. The positive control is sound.
- **The two negative cases discriminate**, since `p1-ok.txt` is already stored by T4: a guard that silently passed the request through would produce a **200** (dedupe success), and the `want 400` is what catches it. `want_tmp0` after each is the proof of the step-2b sweep rather than a handler `finally` — correct, because multer has already written the temp and the handler's per-file `finally` sits inside a loop those returns never enter.
- Minor gap (non-blocking): case (c) proves ingestion only through `metadata->>'team'`, not through a row delta. Add `want_val "$(( $(doccount) - DOC_B ))" "1" "positive control ingested one row"` after the 200 so "real first ingest" is asserted rather than argued.

### NUMBERING / ORDER SANITY

| Check | Result |
|---|---|
| §7 heading order | T0, T1, T1b, T2 … T15 — sequential, no duplicates, no gaps (`373`–`748`). |
| T12 placement vs label | Physically between T11 and T13 but retitled **RUN LAST, after T15** (`646`) and restated in prose (`648`); `S11` = "T0–T15, then T12 last" (`350`); `S12` = §7 T12 (`351`); AC11 = "T12 (runs last)" (`75`). **Consistent.** Structural nit: running the file top-to-bottom would still hit T12 before T13–T15 — moving the block below T15 remains the stronger option (non-blocking; the heading is unambiguous). |
| AC → test tables | AC8 now lists T15 (`68`); AC11 → T12 (`75`); AC5 → T5–T9, T13, T14 (`69`); every REQUEST AC still names a numbered test (`79-91`), row 5 now "temp files cleaned on success **and** failure — §5.6 steps 2b/3, §5.8.2 — … T15" (`84`). Area accurate; AC6's row still lists only T5–T9 although T14 also proves it (cosmetic). |
| Mapper | 8 rows, correct order, row 7 catch-all `MulterError` → 400, row 8 → 500, signature pinned with the reason stated (`307-309`). Matches T6/T7/T8/T14's message greps. |
| Revision log / header | R15–R18 rows present and truthful in substance (`36-38`); header says rounds 1+2 applied, status READY_FOR_RE_REVIEW (`3-5`). |

### REMAINING FINDINGS

**Blocking (both fixed by the replacements above)**
- **R3-B1** — `name ~ '[^[:ascii:]]'` (`653,657,661,662`) matches pre-existing user documents; with `$TEST_SHA` derived from it, one predicate destroys rows + chunks + blobs + extracts. Violates REQUEST AC10/AC11. Replace with the hash + `$PRE_SHA` scoped delete.
- **R3-B2** — blob removal by fixture hash (`667-670`) can delete a surviving user document's blob in the identical-bytes/dedupe case; `$DOC0`/`$CHUNK0` cannot detect it and the listing diff detects it only after the `rm`. Replace with the "current listing − `$BEFORE_UPLOADS`" delta rule.

**Non-blocking**
1. T3's preamble still claims fixtures "are all `p1-`-prefixed so cleanup is unambiguous" (`461`) — false since `résumé.txt`/`p1-t15.txt`; the hash-scoped replacement makes the claim irrelevant, so either drop the clause or say "all `p1-*` fixtures plus `résumé.txt`".
2. T15's closing sentence says the row/blob "are removed by T12 step 9" (`779`) — step 9 is the final baseline assertion; rows go in step 3, blobs in step 4. Cosmetic cross-ref.
3. T12 step 4's `LEFTOVER=` (`671-672`) is dead code with a misleading comment (it counts `documents`, not orphan blobs) and is re-asserted properly at step 9. Delete it.
4. `delete from chunks … where document_id in (…)` (`661`) is redundant with `ON DELETE CASCADE` (`schema.ts:22`). Harmless; keep for explicitness.
5. Cheap defence-in-depth regardless of the fix: in T2, `[ "$DOC0" = 0 ] || { echo "  NON-EMPTY BASELINE — stop and report"; FAILED=1; }`. With the hash/baseline scoping this is belt-and-braces; as a substitute for it, it is not enough (the test must never be destructive on a non-empty DB, not merely refuse to notice).
6. AC6's proving-test row could add T14 (`70`) — same cosmetic class as round 2's non-blocking #5.

### REGRESSION CHECKS I RAN (independent, read-only)

- `wc -l PLAN.md` → **943**; `wc -l REVIEW.md` → 442 (rounds 1–2 preserved, this section appended).
- All **23** fenced ```bash blocks extracted and `bash -n`-checked → **0 syntax errors**.
- `sha256sum -c .pipeline/phase1/baseline.sha256` → **27/27 OK** (no application code touched by anyone in any round).
- `grep -c 'Bearer $TOKEN' PLAN.md` → **22**; `grep -c 'Bearer \*\*\*'` → **0** ⇒ the `***` visible in tool output is display redaction, not a literal placeholder in the plan.
- No `ls data/uploads | grep '^tmp-'` assertion remains; no `<hash>` placeholder `rm`; T12 heading carries RUN LAST.
- PostgreSQL class semantics verified from the PG 18 docs (not memory): `ascii` **is** a supported class in PostgreSQL's ARE, so the new predicate executes rather than erroring — this is what makes R3-B1 a live data-loss path rather than a syntax failure.

**Not verified (do not treat as fact):** I did not install multer, start the server, issue any HTTP request, or read/write PostgreSQL. The `résumé.txt` name-mangling behaviour and the fixture sizes are taken from the plan. Whether the user's DB is currently empty is **not** established by me — and T12 must be safe if it is not.

**PLAN.md edits made by me:** **none.** Round 3 requires only the two `bash` substitutions above (T2 one line, T12 steps 1–4); I have given them verbatim rather than edit the plan.

*End of round 3 review.*

---

## ROUND 4 REVIEW

**Reviewer:** INDEPENDENT PLAN REVIEWER (same role), round 4 — final confirmation of the two data-safety fixes
**Subject:** `PLAN.md`, 963 lines, header still reads `Revision: round 1 + round 2 applied` / `Status: READY_FOR_RE_REVIEW (round 3 verification of R15–R18)` (`PLAN.md:4-5`) — i.e. **no round-4 revision-log entry exists**. This round re-checks **only** R3-B1, R3-B2, the new T12 step 5, T15, and inconsistencies those edits could have introduced. Rounds 1–3 architecture is not re-litigated and stands.
**Method:** the R3 replacements in `REVIEW.md` (lines 470–527) were read as the *specification*, then each was searched for in the live `PLAN.md` text — not against any revision log, because none was written. The T12 block (`PLAN.md:648-714`) was re-read as an executable program against the state T2/T3/T4/T9/T11/T15 leave behind, and its `comm`/`sort` pipelines were re-derived by hand. `schema.ts` was re-read to confirm constraint facts. Read-only: no code, plan, or DB was edited; nothing was installed, started, or executed.

### REVIEWER CORRECTION — APPLIED TO MY OWN DRAFT

I drafted this round judging step 5 **inverted** and R3-B1 **still open**, and began writing those as blocking findings. On re-deriving `comm` from its POSIX definition and applying the operands literally, those claims were wrong. They have been **deleted from this file, not softened**, and the correct analysis — which I had already written out case by case in one place and contradicted in another — is the only version that remains. This note exists so round 5 does not inherit a ghost finding, and so nobody concludes from the section headings that a defect was found and then quietly excused.

### DECISION

**APPROVE**

Both data-safety fixes landed, and both landed **correctly**: the `name ~ '[^[:ascii:]]'` predicate is gone, every DB deletion is hash-scoped, and blob deletion is now the "current `ls data/uploads` − `$BEFORE_UPLOADS`" delta rule round 3 asked for (`PLAN.md:677`), which by construction cannot touch a blob that existed before the run. **There is no remaining path by which T12 can delete a pre-existing user document, chunk, extract, or blob.** R3-B1 closed. R3-B2 closed, and closed more robustly than specified. The new step 5 is functionally correct. T15 passes.

Approval is not conditioned on R4-1..R4-4. They are listed as non-blocking improvements, with R4-4 (refresh the stale header/revision log) strongly recommended before the plan is handed to an implementer, because the log currently describes the *pre-fix* T12 — a bookkeeping defect with no runtime consequence, since the executable body is correct.

### VERIFICATION OF R3-B1 — row/chunk deletion scope

| Element | Round 3 requirement | Status in current `PLAN.md` | Verdict |
|---|---|---|---|
| `name ~ '[^[:ascii:]]'` predicate | must be gone; no table-wide name predicate before a delete | **GONE** — searching `name like\|name ~\|[^[:ascii:]]` returns only T9's harmless read-only count `name like 'p1-broken%'` (`604`); no `delete … where name` anywhere | **CLOSED** |
| Row/chunk delete scope | hash-scoped, never by name | step 2 deletes `chunks` then `documents`, both `where sha256 in ($IN)`, `IN` built from `$TEST_SHA` (`665-668`) | **CLOSED** |
| Dedupe case cannot be destroyed | every fixture hash already present at T2 excluded before any delete | `TEST_SHA=$(comm -23 <FIX_SHA> <PRE_SHA>)` (`659`) subtracts `$PRE_SHA`; a deduped upload creates no row (F3), so step 2's `IN` cannot name a user row | **CLOSED** |
| Verification is hash-for-hash, not count-based | `$PRE_SHA` survivors compared to `$PRE_SHA` | step 5 compares hash **sets** (`687-690`) with the correct operands | **CLOSED** — see the step-5 section, including my correction |
| Count comparison cannot mask a swap | `$DOC0`/`$CHUNK0` are consistency checks, not the safety proof | step 9 compares counts (`708-709`); the hash-set compare at step 5 is the real proof | **design sound** |

**R3-B1 residual (non-blocking):** `$TEST_SHA` is guaranteed disjoint from `$PRE_SHA` only if `$FIX_SHA` and `$PRE_SHA` are normalised identically. `$PRE_SHA` is normalised (`457`: `tr -d ' \r' | grep . | LC_ALL=C sort -u`); `$FIX_SHA` is not (`658`). `comm` compares byte-exact lines, so a residual CR or stray empty element makes `comm -23` emit a hash that *is* already in `$PRE_SHA`. Consequences if that ever happened, both contained:
- step 3 (`683`) and step 5's `LEAKED` (`691`) would act on a user-owned hash; step 3 removes `data/extracts/<hash>.*`, which the user's document regenerates on next ingest — recoverable, no data loss;
- step 2's DB delete would match the user's row — **unreachable in the empty-baseline state** the run records (`$DOC0=0`, `$PRE_SHA=""`, `454-458`), and the plan deliberately does not hard-code that (`707`), which is why R4-1 is still worth applying.

**R3-B1 verdict: CLOSED.**

### VERIFICATION OF R3-B2 — blob-deletion scope

| Element | Round 3 requirement | Status | Verdict |
|---|---|---|---|
| No `<hash>` placeholder, no commented-out `rm` | every `rm -f` executable | `rm -f` occurs exactly at `678`, `683`, `704` — all executable | **CLOSED** |
| Listing snapshot taken **before** any upload | `$BEFORE_UPLOADS` captured in T2 | `456`: captured in T2, before any ingest | **CLOSED** |
| Deletion rule = "current listing − `$BEFORE_UPLOADS`" | replace hash-by-hash `rm` with the listing delta | `677`: `comm -13 <(printf '%s\n' "$BEFORE_UPLOADS" \| grep .) <(ls "$DB/data/uploads" \| LC_ALL=C sort)` then `rm -f` — direction is **correct** (`comm -13` = only in the second file = appeared since T2) | **CLOSED** |
| Cannot touch a pre-existing user blob | inherent to the rule | Holds by construction: any path in `$BEFORE_UPLOADS` is excluded from the delta. The identical-bytes/dedupe case is safe too — that blob is in the T2 listing, hence never in the delta | **CLOSED** |
| Covers every orphan without naming them | `$ORPHAN_BLOB`, `p1-broken2`, leftover fixture blobs | all are post-T2 writes ⇒ all land in the delta ⇒ removed by `678`. Naming-by-exact-path is **gone**, which is an improvement: nothing can be missed because a variable went stale | **CLOSED** |
| Restores the directory | step 6 listing equality | `696-698` compares `$AFTER_UPLOADS` to `$BEFORE_UPLOADS` and `diff`s on mismatch | **CLOSED** |

**R3-B2 verdict: CLOSED, and closed better than specified** — the per-orphan bookkeeping was eliminated rather than fixed. Only the comment at `673-676` overstates the mechanism (R4-3).

### VERIFICATION OF THE NEW T12 STEP 5

```bash
SURVIVE=$("$PSQL" $PGARGS -tAc "select sha256 from documents;" | tr -d ' \r' | grep . | LC_ALL=C sort -u)   # 687
UNEXPECTED=$(comm -13 <(printf '%s\n' "$SURVIVE") <(printf '%s\n' "$PRE_SHA") | grep . || true)              # 688
[ -z "$UNEXPECTED" ] && echo "  all pre-existing user documents intact OK" \
  || { echo "  PRE-EXISTING DOCUMENT MISSING:"; echo "$UNEXPECTED"; FAILED=1; }                             # 689-690
```

`comm -13 A B` prints lines **only in B**. With `A=$SURVIVE`, `B=$PRE_SHA`, `$UNEXPECTED` = hashes in `$PRE_SHA` absent from `$SURVIVE` = exactly the "missing" set the message names. Case analysis against the states this step actually runs in:

- **Clean run, empty baseline.** `$PRE_SHA` = `""`; `printf '%s\n' ""` emits one empty line, but `grep .` strips it on both sides and `$SURVIVE` is empty ⇒ `comm` outputs nothing ⇒ **OK**. ✔
- **Clean run, non-empty baseline.** `$SURVIVE` and `$PRE_SHA` are the same `k` hashes ⇒ nothing-only-in-B ⇒ **OK**. ✔
- **A user document WAS destroyed.** Its hash is in `$PRE_SHA`, not in `$SURVIVE` ⇒ emitted ⇒ `FAILED=1` with `PRE-EXISTING DOCUMENT MISSING`. ✔
- **A test row leaked.** Caught separately by `LEAKED` (`691-693`, `comm -12` of `$SURVIVE` and `$TEST_SHA`). ✔

**Step-5 verdict: functionally CORRECT.** Step ordering is also correct — verify runs after both deletions (steps 2–4) and before the listing/tmp/fixture checks.

**Reviewer correction (record it, so round 5 does not chase a ghost).** My first pass through this step concluded it was inverted, that it would raise a false `PRE-EXISTING DOCUMENT MISSING` on a clean run, and that step 1's collision gate was wrong — and I had begun writing those as blocking findings. On re-deriving `comm` from its POSIX definition and applying the operands literally, **all three of those claims are false**, and they have been removed from this file rather than softened. No revision is required on that basis. Two things do survive as genuine, **non-blocking**, observations:

1. **`$UNEXPECTED` is a misleading name.** It holds the *missing* set (in `$PRE_SHA`, not in `$SURVIVE`), while step 6 (`677`) uses the identical `comm -13` idiom to mean "new since T2". Same operator, opposite intents, and a name matching neither pattern predictably. `comm -23 <(PRE_SHA) <(SURVIVE)` reads as "in PRE, not in SURVIVE" unaided — cosmetic only (R4-2).
2. **`chunks` is not asserted at step 5.** Step 2's explicit `delete from chunks` (`667`) is redundant with `chunks.document_id … ON DELETE CASCADE` (`schema.ts:22`, read this session), so an orphan chunk is impossible *given the FK exists in the live DB*. A one-line `want_val "$(chunkcount)" "0"` would make that reliance visible rather than implicit.
3. `grep .` on both sides is what makes the empty-baseline case safe; a future "tidy-up" of the empty-string handling would silently start comparing one empty line against zero. Worth a comment.

### VERIFICATION OF T15

| Check | Result |
|---|---|
| Present, correctly sequenced | `### T15` exists; S11 orders "T0–T15, **then T12 last**" (`350`); AC8 cites it | **PASS** |
| Both round-2 guards exercised | (a)/(b) rejected: `want 400` + `want_err` + message grep + row-delta 0 + `want_tmp0`; (c) positive control read back through the jsonb round-trip | **PASS** |
| Positive control cannot be satisfied by dedupe alone | `p1-ok.txt` is already stored by T4, so a guard that silently passed files through would answer 200 on (a)/(b); the **400** is what discriminates. (c) uses the fresh `p1-t15.txt` | **PASS** |
| Round-3 non-blocking #2 (T15 cross-ref said "step 9") | `798` now reads "removed in T12 step 2 (hash-scoped) and its blob in step 3 (listing delta)" — accurate against the current steps | **CLOSED** |
| Round-3 suggestion: row-delta assertion for (c) | not adopted; (c) is proven by `metadata->>'team'` only. Adequate, marginally weaker | **open, non-blocking** |

**T15 verdict: PASS, no change required.**

### NEW INCONSISTENCIES

1. **The header and revision log deny that the round-3 fixes exist — non-blocking bookkeeping, but fix it before handoff.** `PLAN.md:4` still says "round 1 + round 2 applied … R15–R18"; `:5` still says `READY_FOR_RE_REVIEW (round 3 …)`; `:963` still says "(revision round 1)". **No log row records the R3-B1/R3-B2/step-5 work at all.** An implementer working from the log would rebuild the *old* T12 — the one with the name predicate and the per-orphan `rm`. The executable body is correct, so this costs nothing at runtime; it costs a rework if read instead of the body. R4-4.
2. **Comment at `673-676` contradicts the mechanism.** It claims the delta rule "Subsumes `$TEST_SHA` blobs … `$ORPHAN_BLOB`, p1-broken2 and every fixture blob in ONE rule". Coverage is real, but not *via* `$TEST_SHA`, which plays no part in step 3; an editor reconciling comment to code could reintroduce hash-driven blob deletion. R4-3.
3. **`$PRE_SHA`/`$FIX_SHA` normalisation asymmetry** (`457` vs `658`) — R4-1.
4. **"EYEBALL THIS FIRST"** (`660`) is a human gate on the ledger that step 2's DB delete consumes. R4-1 turns it into an assertion.
5. F1 (`953`) and R7 (`27`) still say T12 removes the orphan "by exact path", which is no longer how it works. Non-blocking.
6. `$UNEXPECTED` naming (step 5). Non-blocking.

### REMAINING NON-BLOCKING FINDINGS

1. `chunks` not asserted at step 5; the guarantee rests on `ON DELETE CASCADE` (`schema.ts:22`).
2. T15 case (c) lacks the row-delta assertion round 3 suggested.
3. T3's preamble still claims fixtures "are all `p1-`-prefixed so cleanup is unambiguous" — false for `résumé.txt`/`p1-t15.txt`, and irrelevant now that cleanup no longer keys on the prefix. Drop the clause.
4. Round-3's `LEFTOVER=` dead code is **gone**. Closed.
5. `baseline.sha256` is checked only at T1b, never at teardown; re-running `sha256sum -c` as T12's last line would enforce AC10 when it matters.
6. Step 5 is `documents`-only; if the `chunks` FK were ever dropped, the explicit chunk delete at `667` becomes the sole protection with no assertion on it.

### RECOMMENDED EDITS (round 4) — none gating the APPROVE

**R4-1 (recommended hardening — not gating): normalise both sides of step 1, replace the eyeball with an assertion.** Replace `PLAN.md:658-660` with:

```bash
FIX_SHA=$(for f in "$FIX"/p1-* "$FIX"/résumé.txt; do [ -f "$f" ] && sha256sum "$f"; done \
          | cut -d' ' -f1 | tr -d ' \r' | grep -E '^[0-9a-f]{64}$' | LC_ALL=C sort -u)
TEST_SHA=$(comm -23 <(printf '%s\n' "$FIX_SHA") <(printf '%s\n' "$PRE_SHA") | grep . || true)
# Sanity gate on the ledger, not a safety gate: every entry must be a bare 64-hex hash.
BAD=$(printf '%s\n' "$TEST_SHA" | grep -Ev '^[0-9a-f]{64}$' | grep . || true)
[ -z "$BAD" ] && echo "  test hash ledger well-formed OK" \
  || { echo "  MALFORMED HASH IN LEDGER:"; echo "$BAD"; FAILED=1; }
echo "test hashes to remove: $(printf '%s\n' "$TEST_SHA" | grep -c .)"
```

`$PRE_SHA` is already normalised identically at `457`, so both `comm` inputs then share one shape, and no empty element can reach `$IN` at `666`.

**R4-2 (optional, readability): make step 5 self-evidencing.** Replace `PLAN.md:687-690` with:

```bash
SURVIVE=$("$PSQL" $PGARGS -tAc "select sha256 from documents;" | tr -d ' \r' | grep -E '^[0-9a-f]{64}$' | grep . | LC_ALL=C sort -u)
MISSING=$(comm -23 <(printf '%s\n' "$PRE_SHA") <(printf '%s\n' "$SURVIVE") | grep . || true)   # in PRE, not in SURVIVE
[ -z "$MISSING" ] && echo "  all pre-existing user documents intact OK" \
  || { echo "  PRE-EXISTING DOCUMENT MISSING:"; echo "$MISSING"; FAILED=1; }
```

Behaviour is identical to the current three lines (all four cases above re-checked against this form); it only removes the need to know `comm`'s flag semantics to audit it, and stops the twin-`comm -13` confusion with step 6.

**R4-3 (cosmetic): replace `PLAN.md:673-676` with**

```bash
# 3) Delete ONLY blobs that did not exist at T2 — i.e. written by this run. This single rule
#    covers every fixture blob, $ORPHAN_BLOB and p1-broken2, and cannot touch a pre-existing
#    user blob. $TEST_SHA plays no part here; it is used only for rows (step 2), extracts (step 4)
#    and the verification sets (step 5).
```

**R4-4 (strongly recommended bookkeeping): update `PLAN.md:4`, `:5`, the revision log and `:963`.** `Revision:` → "round 1 + 2 + 3 applied (R1–R18, plus R19–R21 closing round 3's R3-B1/R3-B2 and step 5)"; `Status:` → `READY_FOR_IMPLEMENTATION`; add three log rows recording: (i) the `name ~` predicate removed and all DB deletion hash-scoped; (ii) blob deletion replaced by the `$BEFORE_UPLOADS` delta; (iii) step 5 added; end-stamp → "(revision round 3)". Optionally fold in non-blocking 5 and 6.

### WHAT I VERIFIED AND WHAT I DID NOT (round 4)

**Verified by reading:** `documents.sha256` is `TEXT NOT NULL` with no `UNIQUE` and no unique index anywhere in `schema.ts` (64 lines, read in full); `chunks.document_id` is `REFERENCES documents(id) ON DELETE CASCADE` (`schema.ts:22`); T12's step order is 1 ledger → 2 rows → 3 blobs → 4 extracts → 5 verify → 6 listing → 7 tmp → 8 fixtures → 9 baseline, which is the order the verification needs; every line number quoted above was read in this session; `rm -f` occurs exactly at `678`, `683`, `704`; no `name ~`/`name like` delete predicate and no `LEFTOVER=` remain; header and end-stamp text as quoted.

**`comm` semantics:** taken from the POSIX definition (`-12` common, `-13` only-in-file-2, `-23` only-in-file-1) and applied by hand to both baseline states. My first pass mis-read step 5 as inverted; the literal-operand derivation shows it is correct, and that correction is recorded above rather than removed.

**Not verified (do not treat as fact):** I did not start PostgreSQL, so the literal shape of `psql -tAc` output (`\r`, trailing padding, zero-row behaviour of `psql.exe` on Windows) is inferred from the plan's own normalisation idiom, not observed. I executed no `comm`, `sort`, `find`, `ls` or `sha256sum` pipeline in this repo — every shell claim here is analysis. I did not install `multer`, start the server, issue an upload, or read/write the database. Fixture sizes, the `résumé.txt` name-mangling behaviour and the `$DOC0=0` baseline are the plan's claims, not mine. I did not read `REVIEW.r2.bak.md` or `PLAN.r1.bak.md` (backups, out of scope).

**Bottom line:** both data-safety fixes are genuinely closed. The destructive name predicate is gone, rows and chunks are hash-scoped, and blob deletion is a before/after listing delta that cannot reach a pre-existing file — a stronger construction than the one round 3 demanded. Step 5 is correct; I mis-read it on the first pass and say so above instead of quietly dropping the accusation. **APPROVE.** The stale header and revision log (`4-5`, `963`) should be refreshed before handoff so the log stops describing the pre-fix T12, but the executable body is correct and no runtime safety issue remains.

*End of round 4 review.*
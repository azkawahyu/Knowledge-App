# Phase 1 Plan — Fix Multipart Document Upload for Knowledge Assistant

**Author:** PLANNER (Phase 1)
**Revision:** rounds 1–4 applied — R1–R14 (round 1), R15–R18 (round 2 blocks), R19–R20 (round-3 data-safety fixes; all four reviewer rounds signed off, `REVIEW.md` ROUND 4 = **APPROVE**)
**Status:** **APPROVED FOR IMPLEMENTATION** (REVIEW.md §ROUND 4 REVIEW, line 588)
**Date:** based on code as re-read in this session

> **Provenance convention used throughout this document**
> - **[V]** = I verified this myself by reading code / running a read-only command. Citation given.
> - **[G]** = Taken from the task brief / REVIEW.md, not independently re-verified by me.
> Where [G] and [V] conflict, **[V] wins** and the conflict is called out explicitly (see §3, §12.4).

---

## 0. REVISION LOG — round 1

Applied against `REVIEW.md` (decision **REVISE**; findings B1–B7, required revisions 1–14). Each row is verifiable in the named section.

| # | Required revision | Disposition |
|---|---|---|
| R1 | Collapse the response contract to one rule | **DONE** — §5.7 is the single normative contract (always `{results, errors}`; 200 all-success / 207 mixed / 400 zero-success with an `error` superset); §5.4 no longer says "array"; §5.8's first rows replaced; AC1 rewritten to assert `results[0].{…}`; T4/T11/EC9 rewritten to the table. |
| R2 | Delete S9's blob deletion | **DONE** — S9 is temp-cleanup hardening only; **R5 deleted**; EC7/T9 blob-deletion assertions removed; follow-up **F1** explains why ownership is `ingestionService`'s and why any route guard is TOCTOU. |
| R3 | Fix §5.8's last row | **DONE** — unexpected error → **500 `{error:'Upload failed'}` emitted by the route-scoped mapper itself**; mapper is terminal (never `next(err)`); `middleware/error.ts:7` has 3 params so `next(err)` escapes to Express's **HTML** page; `err.message` + stack logged server-side only. |
| R4 | Specify the mapper classification table exactly | **DONE** — verbatim 7-row table in §5.8.1 (MulterError codes, `UNSUPPORTED_FILE_TYPE`, busboy/`ERR_STREAM_PREMATURE_CLOSE`, fallback 500). |
| R5 | Mapper must sweep `req.files` before responding | **DONE** — §5.8.2, array-or-map normalisation, `fs.rmSync(f.path,{force:true})`, logs `err.storageErrors`. |
| R6 | Move temp files out of the content-addressed dir | **DONE** — `server/data/tmp` = `path.resolve(ingestionService.storageDir,'..','tmp')`, `mkdirSync` recursive at module scope **before** the multer instance (§6 S4); every `ls data/uploads \| grep '^tmp-'` assertion replaced by `find data/tmp -name 'tmp-*' \| wc -l` → 0 (AC8, T3, T7, T9, T11, T13, T14). |
| R7 | Rewrite T9 for the post-S9 design | **DONE** — T9 expects 400 `{error}`, `p1-broken%` rows = 0, chunks unchanged, tmp = 0, and records `$ORPHAN_BLOB` as **present**; T12 deletes that exact path and asserts `ls data/uploads` returns to the pre-test listing. |
| R8 | Rewrite T4 | **DONE** — T3 creates `p1-ok2.txt` with distinct ≥40-word content (and T3 itself uploads a *different* fixture); T4 asserts 200, `results.length==2`, `errors==[]`, documents delta **exactly +2**. |
| R9 | Make the suite executable | **DONE** — `TOKEN` exported once from T2 and used as `-H "Authorization: Bearer $TOKEN"` everywhere; every elided `-X POST ...` replaced with a literal URL; creds via `set -a; . ./.env; set +a` + heredoc body (never argv/history, never echoed); helper `want_err` checks status **and** body (JSON, string `error`, no `<html`, no `at …:N:N`). |
| R10 | Add T13 — AC7 regression + auth | **DONE** — §7 T13 (no-auth 401 + tmp 0, garbage token 401, `/watch` 200, `/health` 200, `/search` JSON not HTML); added to the AC cross-reference for **AC7** and **REQUEST AC6**. |
| R11 | Add T14 — abort semantics | **DONE** — §7 T14 (`p1-ok.txt` + `p1-bad.exe` → whole request 400, 0 rows, 0 temp, body is `{error}` only); EC9/§5.4/T11 now state that one `upload.array('files')` aborts the entire request on any `fileFilter`/`LIMIT_*`, so per-file isolation exists **only** for post-multer ingestion errors. |
| R12 | Pin the typecheck-safe code shape | **DONE** — §5.6.3 + step **S3b** (import + one `diskStorage` call + `tsc --noEmit` + `node -p "typeof require('./node_modules/multer')"` → `function` **before** the handler); `Express.Multer.File[]`; `res.status().json(body); return;`; guarded string fields; both try/catches; `finally` inside the loop. |
| R13 | Add the two input-validation guards | **DONE** — §5.6 step 2 (`metadata`: string → `JSON.parse` in try/catch, 400 `Invalid metadata JSON`, must be non-array object; `access_policy` ∈ {public,trusted,restricted} else 400 `Invalid access_policy`, absent → `restricted`). |
| R14 | Re-sync every derived section | **DONE** — AC1/AC5/AC6/AC7/AC8/AC10, §5.4/5.7/5.8, T3/T4/T7/T9/T11, EC7/EC9, §9 (R5 dropped), §10 (orphan-blob cleanup inside `service.ts` added), §11 (Q1–Q10 rulings), REQUEST.md cross-reference (every AC names a numbered test). |
| **R15** | **(round 2)** Sweep `req.files` on every post-multer early return | **DONE** — §5.6 **step 2b** (invalid `metadata`, invalid `access_policy`) + outer `catch` pinned to 400 with a prior sweep (§5.6 step 4); proven by **T15**. |
| **R16** | **(round 2, superseded by R19/R20)** T12 must actually restore the baseline | **DONE then tightened** — T12 rewritten and retitled **RUN LAST, after T15**; blob/extract removal and delete predicates were subsequently replaced by the hash+baseline rules in **R19/R20** (the name-based form was rejected by round 3). |
| **R17** | **(round 2)** Test the field guards | **DONE** — **T15** added (invalid metadata, invalid access_policy, positive control with a real jsonb round-trip); T15 added to AC8's test list. |
| **R18** | **(round 2)** Non-blocking hardening adopted | **DONE** — mapper row 7 = any other `MulterError` → 400 (row 8 = 500 fallback); mapper signature pinned `(err: any, …)`; outer `catch` status pinned; fixture inventory extended with `p1-t15.txt`; §5.6 step 5 list re-synced. |
| **R19** | **(round 3)** T12 must be hash+baseline scoped, never name-scoped | **DONE** — `name ~ '[^[:ascii:]]'` **removed**; T2 captures `PRE_SHA` and hard-gates on `$DOC0 = 0`; T12 `TEST_SHA = comm -23(FIX_SHA, PRE_SHA)`; both deletes are `where sha256 in ($IN)`. |
| **R20** | **(round 3)** Blob/extract deletion must be incapable of touching pre-existing files | **DONE** — blobs deleted only as the listing delta `comm -13(BEFORE_UPLOADS, current ls)`; extracts keyed on `$TEST_SHA`; new step 5 verifies hash-for-hash that no pre-existing row vanished and no test row remains. |

Also folded in (non-blocking, zero-cost): **F2** synthetic `chunkIds`, **F3** dedupe `documentId`, **F4** extract-write-after-commit, **F5** legacy Office UX, batch-sum-cap note (§5.5), `résumé.txt` check (T3), rate-limit headroom note (T0), stop-and-report on dependency drift (S3), `documents.status` stays `'pending'` (T3).

---

## 1. STATUS

**READY_FOR_RE_REVIEW.** Nothing blocks implementation. The response contract, the error-mapping table, the temp-file location and the test commands are now single-valued everywhere in this document: an implementer should not have to make a contract decision of their own.

---

## 2. PHASE

**Phase 1 — Multipart document upload plumbing (backend only).**
Scope is the transport layer: get bytes from `multipart/form-data` into the **existing** `ingestionService.ingestFile()` pipeline. The ingestion pipeline itself is already implemented and is **not** to be rewritten.

---

## 3. GOAL

A `multipart/form-data` POST to `/api/ingest/upload` with one or more files under the field name **`files`** must authenticate, be validated, be handed to `ingestionService.ingestFile()`, and result in **one `documents` row plus N `chunks` rows per accepted file** and the raw bytes persisted in the content-addressed uploads directory — and the JSON response must remain parseable by the current Next.js client without changing that client.

### Acceptance criteria

| # | Criterion | Proving test |
|---|---|---|
| AC1 | `POST /api/ingest/upload` with field `files` (one **or** many) + valid JWT returns **HTTP 200** and body `{"results":[…],"errors":[]}` whose `results[0]` contains **all nine** of `documentId`, `contentHash`, `chunkCount`, `chunkIds`, `name`, `kind`, `accessPolicy`, `textLength`, `savedAt` | §7 T3 (field-by-field body assertion), T4 |
| AC2 | A `documents` row exists with `sha256` = SHA-256 of the bytes, `kind='txt'`, `size_bytes` = on-disk byte count (the pipeline re-derives size, `service.ts:148` [V]), `access_policy='restricted'` by default | §7 T3 psql |
| AC3 | `chunks` count for the returned `documentId` equals the response's `chunkCount` and is ≥ 1 | §7 T3 psql |
| AC4 | Raw bytes persisted at `<storageDir>/<sha256><ext>` with the **correct extension** (`.txt`) | §7 T3 `ls` |
| AC5 | Success body is the §5.7 envelope; every failure is asserted by **status AND body** — JSON parses, has a string `error`, no `<html`, no stack frame — so `api.ts:34-36`'s `body.error` path works unmodified | §7 T5–T9, T13, T14 |
| AC6 | Non-multipart bodies, empty multipart, wrong field name, bad extension, oversized files and malformed multipart each return a **4xx JSON `{error}`** — body is JSON **not HTML**, never a 500, never a stack trace, never a connection reset | §7 T5–T9 |
| AC7 | Multipart parsing is mounted **only** on the upload route; auth still runs first; `express.json({limit:'1mb'})` and every other route still work | §7 T1 + **T13** |
| AC8 | No temp files leak on success **or** any failure: `find server/data/tmp -name 'tmp-*' \| wc -l` = **0** after every upload test | §7 T3, T7, T9, T11, T13, T14, **T15** |
| AC9 | Typecheck clean: `npx tsc --noEmit` exits 0 | §7 T1 |
| AC10 | **No unrelated files change** — `sha256sum -c .pipeline/phase1/baseline.sha256` reports 27/27 `OK`; only `server/src/routes/ingest.ts`, `server/package.json`, `server/package-lock.json` may differ. **No `web/**` change** (Q10 ruled no frontend change). | §7 T1b |
| AC11 | **The user's DB is never reset** — post-test counts return to the pre-test baseline and `admins=1` is intact | §7 **T12 (runs last)** |

### Acceptance criteria ↔ `.pipeline/phase1/REQUEST.md` cross-reference

| REQUEST.md AC | Covered by | Proving test |
|---|---|---|
| 1. accepts multipart, field `files`, 1+ files | AC1, §5.2–5.4 | T3 (one file), T4 (two files) |
| 2. routed through `ingestionService.ingestFile`, persists doc+chunks | AC1–AC3, §5.6 | T3, T4 |
| 3. size/type limits, actionable messages, correct statuses | AC6, §5.5, §5.8 / §5.8.1 | T6 (type), T7 (size), T5 (field) |
| 4. missing/wrong-field/unsupported/oversized/malformed → 4xx, no 500s/stack traces | AC6, §5.8, §8 EC1–EC6 | T5, T6, T7, T8, T14 |
| 5. temp files cleaned on success **and** failure | AC8, §5.6 steps 2b/3, §5.8.2 | T3, T7, T9, T11, T13, T14, **T15** |
| 6. auth still enforced (401 without bearer) | §5.2, §8 EC13 | **T13** |
| 7. `npx tsc -p tsconfig.json --noEmit` exits 0 | AC9 | T1 |
| 8. Next.js client contract keeps working | AC5, §5.7 | T3 (envelope), T5–T9 (body shape) |
| 9. no unrelated files change (baseline.sha256) | AC10 | T1b |
| 10. DB never reset; only test rows removed | AC11 | T12 |

---

## 4. ROOT CAUSE

### 4.1 Primary root cause — nothing ever parses the multipart body

The upload handler reads an **already-parsed object** at `req.body.file`:

- `server/src/routes/ingest.ts:22` — `const body = req.body as { file?: { buffer: Buffer; originalname: string; mimetype: string }; … }` [V]
- `server/src/routes/ingest.ts:23` — `const file = body.file;` [V]
- `server/src/routes/ingest.ts:25-28` — `if (!file || !file.buffer || !file.originalname) { res.status(400) … 'Missing file in request body' }` [V]

But the only body parser registered is JSON, mounted globally:

- `server/src/app.ts:33` — `app.use(express.json({ limit: '1mb' }));` [V]

There is **no multipart parser anywhere in the app**:
- `server/src/app.ts:1-12` lists every import; no multer/busboy/formidable [V].
- `server/package.json:12-35` — `multer`, `busboy`, `formidable` absent from both dependency blocks [V].
- `server/node_modules/multer` and `server/node_modules/@types/multer` do not exist [V].

`express.json()` type-matches and skips non-JSON bodies, so for a `multipart/form-data` POST **`req.body` is `{}`** and `file` is `undefined` → the handler *always* returns **400 `{"error":"Missing file in request body"}`**.

### 4.2 Second, latent bug — field name mismatch

`web/src/app/dashboard/inbox/page.tsx:33` — `files.forEach((f) => form.append("files", f));` [V]
`web/src/lib/api.ts:64-68` — `ingestUpload: (body: FormData) => request<{status:string}>(…)` [V]; no `Content-Type` is set manually, so `fetch` generates `multipart/form-data; boundary=…` correctly [V].

The field name is **`files`** and it may hold **multiple** files. A `.single('file')` fix would still 400.

### 4.3 Third, latent bug — the temp file has no extension

- `server/src/routes/ingest.ts:30-33` — `tmpPath = path.join(ingestionService.storageDir, \`tmp-${Date.now()}-${crypto.randomBytes(8).toString('hex')}\`)` — **no extension** [V]
- `server/src/routes/ingest.ts:34` — `fs.writeFileSync(tmpPath, file.buffer);` [V]

The pipeline dispatches on the **path's** extension:
- `server/src/ingest/parsers.ts:268-272` — `path.extname(filePath)` → registry lookup → `throw new Error(\`Unsupported file type: .${ext}\`)`; for an extension-less path `ext === ''` so it **always throws** [V].
- `server/src/ingest/service.ts:115-116` — `storagePath = path.join(storageDir, \`${contentHash}${safeExt}\`)` → would store the blob with **no extension** [V].

Hence `diskStorage` with a sanitized original extension, not `memoryStorage`.

### 4.4 Non-causes — cleared by reading code

- **Auth is not the problem.** `app.ts:53` mounts `authMiddleware` before `ingestRouter` [V]; `routes/ingest.ts:16-20` re-checks the header [V]; a missing/invalid JWT yields 401 (`middleware/auth.ts:11-14`, `:20-22` [V]).
- **`pptx` is NOT missing.** `service.ts:72-74` includes `'pptx'` in `DOC_KINDS`; `parsers.ts:219` registers `extensions: ['pptx']`; `parsers.ts:243` maps `pptx: 'pptx'` [V]. No change needed (Q6).
- **`sizeBytes` plumbing is fine** — `routes/ingest.ts:39` passes `file.buffer.length`, and `service.ts:148` re-derives with `fs.statSync(filePath).size` [V]. So `sizeBytes` is inert; AC2 is asserted from the on-disk byte count, not from `FileInfo`.

### 4.5 Root-cause summary in one line

`POST /api/ingest/upload` has **no multipart body parser**, expects the wrong **field name** (`file` vs `files`), and **strips the file extension** from the temp path the parser registry keys on — three independent defects that must be fixed together.

---

## 5. PLAN — smallest in-scope implementation

### 5.1 Middleware choice: **multer 2.x**, `diskStorage`, route-level

**Decision: `multer@2.5.0` + `@types/multer@2.3.0`** [G from brief/registry; S3 confirms]. [V] multer's deps are `busboy`, `type-is`, `append-field`.

Alternatives rejected for this phase: raw `busboy` (hand-written boundary/stream/error handling — more surface than a 12-line config); `formidable` (heavier, no upside); manual `Buffer` parsing (not viable for binary); **global mount** (`app.use(multer())`) — **explicitly rejected**: it parses multipart on every route, widens the attack surface, and would break AC7.

**`diskStorage` over `memoryStorage`** because (a) `file.path` already exists on disk when the handler runs, (b) the original extension is preserved (§4.3), (c) it avoids buffering 25 MiB × 10 in the heap.

### 5.2 Where to mount

`server/src/routes/ingest.ts` only — a module-scope `upload` const plus the route chain:

```ts
const upload = multer({ storage, limits, fileFilter });

router.post('/upload', upload.array('files', MAX_FILES), uploadHandler, uploadErrorMapper);
```

`uploadErrorMapper` is a **4-argument** function in the same chain, so Express treats it as that route's error handler. **Do not touch `app.ts`** — `authMiddleware` already runs before the router (`app.ts:53` [V]), so auth applies unchanged and multer never runs before auth (proved by T13).

### 5.3 Field names

- Accept **`files`** only (matches `inbox/page.tsx:33` [V]).
- The legacy singular `file` is **not** accepted in Phase 1: it has no current consumer. A `file=` upload returns our own actionable 400 (`Unexpected field "file"; upload files under "files"`), not a 500.

### 5.4 Single vs multiple, and abort semantics

`upload.array('files', MAX_FILES)` with **`MAX_FILES = 10`** — the UI appends every dropped file (`page.tsx:13-15, 33` [V]).

**The response contract is one rule, independent of file count — see §5.7.** There is no "array for many, object for one" branch anywhere in this plan.

**Abort semantics — state this plainly, it constrains what is testable.** A single `upload.array('files')` instance **aborts the entire request** on the first `fileFilter` rejection or any `LIMIT_*` condition: multer's `abortWithError` waits for pending writes, removes what it already wrote, and calls `next(err)` **once for the whole request**. Therefore:

- **Per-file isolation does NOT exist for validation failures.** One bad file in a batch of ten → the whole request is 400 and **no** file is ingested (§7 T14 proves this).
- **Per-file isolation exists only for post-multer ingestion errors** (parse/DB failures raised inside the handler's own loop). That is exactly what §7 T11 exercises: a corrupt-but-*allowed* `.docx` alongside a good `.txt` → 207.

An implementer must not attempt per-file filter isolation; that would require two-pass parsing or a manual busboy loop, which is out of scope.

### 5.5 Limits and validation

- **Size:** `fileSize: 25 * 1024 * 1024` (**25 MiB per file**), `files: 10`, `fields: 20`, `fieldSize: 1 * 1024 * 1024`. 25 MiB covers PDF/DOCX/XLSX/PPTX knowledge documents while bounding disk; `express.json` is 1 MB (`app.ts:33`) so large JSON is already blocked. [Q7 approved]
  - *Optional hardening, NOT implemented in Phase 1:* a ~3-line sum-of-`file.size` cap (~100 MiB → 413 + sweep) against a 250 MiB worst case. Noted only.
- **Extension allowlist** (authoritative, derived from `PARSERS` [V]):
  `txt, md, markdown, csv, json, xml, yaml, yml, log, html, htm, pdf, docx, xlsx, pptx`
  (from `parsers.ts:191,202,207,211,215,219` [V]). Image extensions `png,jpg,jpeg,tif,tiff` (`parsers.ts:224` [V]) are **excluded** — the OCR path (`tesseract.js`) is out of this phase's acceptance set and is the slowest/highest-variance route; images remain reachable via `/ingest/watch`. `markdown` is kept because the parser accepts it (`parsers.ts:191`).
- **MIME:** secondary signal only. No MIME allowlist (browsers send `application/octet-stream` routinely). Optional deny-list: `application/x-msdownload`, `application/x-msdos-program`, `application/x-executable`, `application/x-sh`, `text/x-sh`. The effective control is the extension allowlist — files are never re-served or executed, only read by parsers.
- **`fileFilter`** does the extension check and rejects **by callback with a tagged error** (the mapper needs a stable code and the offending extension):

```ts
fileFilter(_req, file, cb) {
  const ext = sanitizeExt(file.originalname);            // '' unless /^\.[a-z0-9]{1,8}$/
  if (ext && ALLOWED_EXTS.has(ext.slice(1))) { cb(null, true); return; }
  cb(Object.assign(new Error(`Unsupported file type: ${ext || '(none)'}`),
                   { code: 'UNSUPPORTED_FILE_TYPE', ext }));
}
```

### 5.6 How the file feeds `ingestionService.ingestFile`

Temp files live in **`server/data/tmp`**, *not* inside the content-addressed uploads directory:

```ts
const TMP_DIR = path.resolve(ingestionService.storageDir, '..', 'tmp'); // <server>/data/tmp
fs.mkdirSync(TMP_DIR, { recursive: true });                             // BEFORE multer(...) is constructed
```

**Why:** `data/uploads` must stay **strictly** `<sha256><ext>` blobs. The dedupe branch scans that directory by name (`fs.existsSync(storagePath)`, `service.ts:120` [V]) and any future GC/sweep must not have to special-case a subdirectory. A `tmp/` subdirectory inside `uploads/` would also pollute `ls`-based verification and the AC4/T12 listing diff.

Flow inside the handler:

1. **Validate the batch** — `const files: Express.Multer.File[] = Array.isArray(req.files) ? req.files : [];` then `if (files.length === 0) → 400 {"error":"Missing file in request body"}` (string kept verbatim from `routes/ingest.ts:26` [V] for client compatibility). This is also what a non-multipart body hits, because multer passes non-multipart requests straight through without parsing.
2. **Validate the shared form fields once, before the loop** (whole-request failures → `{error}` only):
   - `body.metadata` — if `typeof body.metadata === 'string'`: `JSON.parse` inside `try/catch`; on throw → **400 `{"error":"Invalid metadata JSON"}`**. Then require a **non-array object** (`typeof v === 'object' && v !== null && !Array.isArray(v)`), else the same 400. Absent → `{}`. Rationale: a multipart text field arrives as a string and `service.ts:191` casts `$7::jsonb`, so `"hello"` would surface as a PG cast error instead of an actionable 400.
   - `body.access_policy` — accept only `public | trusted | restricted`, else **400 `{"error":"Invalid access_policy"}`**; absent → `'restricted'` (unchanged default, `routes/ingest.ts:41` [V]).
   - `body.kind` / `body.name` may arrive as **arrays** when a field is repeated — guard with `typeof x === 'string'` before use (otherwise `detectKind()` receives an array and `path.extname()` throws).
2b. **Sweep `req.files` before EVERY early return taken after multer has run.** By the time step 2 executes, multer has already written all accepted files into `data/tmp`, and the per-file `finally` in step 3 sits **inside** the loop — returns from step 2 never reach it, and §5.8.2's sweep runs only in the mapper. Therefore the three post-multer whole-request returns — **invalid `metadata`, invalid `access_policy`, and the outer `catch`** — must each first sweep the uploaded files exactly as §5.8.2 does (array-or-map normalised `try { fs.rmSync(f.path, { force: true }) } catch {}` per entry) **before** writing the response. Without this, every rejected-field upload leaks 1–10 full-size temp files permanently, violating AC8 and REQUEST AC5 on paths this plan itself introduces (R15/RB3).
3. **Per-file loop**, one iteration per file, building the same `FileInfo` semantics as today:
   - `name: nameField || file.originalname` (`routes/ingest.ts:37` [V])
   - `path: file.path` ← the multer disk path, which carries the sanitized original extension
   - `sizeBytes: file.size` (inert; `service.ts:148` re-derives [V])
   - `kind: detectKind(kindField || file.originalname)` — **on `originalname`, never on `file.path`** (`routes/ingest.ts:40` [V])
   - `accessPolicy` and `metadata` from step 2
   - `await ingestionService.ingestFile(fileInfo)` inside its **own** `try/catch`; on throw push `{ file: file.originalname, error: err.message }` to `errors` and continue to the next file. A zero-chunk result is **not** an error: accept it, return the result, log one `warn` (Q4).
   - **`finally` inside the loop, one per file**: `fs.rmSync(file.path, { force: true })`. `force:true` so a missing temp cannot mask the real error (`routes/ingest.ts:46` uses bare `unlinkSync` today [V]).
4. **Respond** from the §5.7 table. Never `res.json` inside the loop. The **outer `catch`** is pinned as well (R15): sweep `req.files` first (step 2b), log `err.message` + `err.stack` **server-side only**, then `res.status(400).json({ error: 'Upload failed' }); return;` — never a 500 that could carry an internal message, and never a stack or filesystem path in the body (AC6).

#### 5.6.1 Preserved ingestion semantics (do not change)

`detectKind` on `originalname`; `access_policy` default `restricted`; `metadata` pass-through (post-parse merge happens inside the service, `service.ts:151` [V]); **real temp path with a real extension**; no parallel pipeline. Bug-for-bug behaviours that stay (documented, not fixed): `documents.status` remains `'pending'` forever (`schema.ts:13` [V]; `ingestFile` never updates it); dedupe returns the content hash as `documentId` (F3); `chunkIds` are synthetic (F2).

#### 5.6.2 Why both try/catches are mandatory

Express resolves to **4.22.3** in this repo (`server/node_modules/express/package.json:4` [V]; `package.json:18` declares `^4.19.2`). Express 4 does **not** forward a rejected promise from an async handler to error middleware — the rejection becomes an **unhandled rejection**, and Node 24 exits the process on those by default. Therefore:

- the **outer** `try/catch` (whole handler body) and the **per-file** `try/catch` around `await ingestFile` are both required;
- the route-scoped mapper only ever sees errors multer passes to `next(err)`; it will never see a handler rejection;
- `finally` inside the loop is required so one file's temp is removed even when a later iteration throws.

#### 5.6.3 Pinned typecheck-safe code shape

| Rule | Why |
|---|---|
| `import multer from 'multer';` | `tsconfig.json:10` has `esModuleInterop: true` [V]; `@types/multer` is auto-included because `tsconfig.json:17-18` sets no `types`/`typeRoots` restriction [V]. |
| `const files: Express.Multer.File[] = Array.isArray(req.files) ? req.files : [];` | `req.files` is `File[] \| {[field]: File[]} \| undefined`. **Never** write `Multer.File[]` — that interface lives in the global `Express.Multer` namespace, not on the module export. |
| `res.status(code).json(body); return;` on **every** response path | The handler is typed `(req: Request, res: Response): Promise<void>` (`routes/ingest.ts:14` [V]) and the existing file uses exactly this pattern (`:18-20`, `:26-27` [V]). `return res.status(...)` would return `Response` from a `Promise<void>` and fail `strict`. |
| `const kind = typeof body.kind === 'string' ? body.kind : undefined;` (same for `name`) | Repeated multipart fields arrive as arrays. |
| Both try/catches; `finally` **inside** the loop, one per file | §5.6.2. |
| No new module under `src/` | AC10 permits only `routes/ingest.ts` + the two package files to change. Envelope/error types are declared **locally** in `ingest.ts`; `types.ts` is untouched. |

### 5.7 The response contract — ONE rule

Every request that reaches the handler and yields per-file outcomes returns **the same envelope**, for one file and for many:

```json
{ "results": [ IngestionResult, … ], "errors": [ { "file": "<originalname>", "error": "<message>" }, … ] }
```

| Condition | Status | Body |
|---|---|---|
| `errors.length === 0` (one or many results, incl. dedupe results) | **200** | `{ "results": [...], "errors": [] }` |
| `results.length > 0 && errors.length > 0` | **207** | `{ "results": [...], "errors": [...] }` |
| `results.length === 0 && errors.length > 0` (nothing succeeded) | **400** | `{ "error": "<errors[0].error>", "errors": [...] }` |

Notes that make this unambiguous:

- The 400 body is a **superset**: the extra `error` key is what `api.ts:34-36` reads (`body.error || …` [V]), so the UI shows the real message instead of a generic one.
- **207 is safe for the existing client**: `res.ok` is true for 200–299 and `api.ts` only special-cases 401 (`:29-33` [V]).
- **Whole-request transport failures never carry a partial body.** Limits, `fileFilter`, malformed multipart, auth, missing file, bad `metadata` and bad `access_policy` all return **`{ "error": "..." }` only** — no `results`, no `errors` array (§5.8 table). A client distinguishes the two 400 shapes by the presence of `errors[]`; it only ever needs `error`.
- `IngestionResult` shape is unchanged from `types.ts:72-91` [V]; `savedAt` serialises as an ISO string over JSON.
- **No `web/**` change is needed or permitted**: `page.tsx:22-25` awaits the call and sets a hardcoded message, ignoring the value [V]; `api.ts:38` only casts (`return (await res.json()) as T` [V]). The stale `request<{status:string}>` type at `api.ts:64-68` stays as a recorded follow-up (Q10, F6).

### 5.8 HTTP status table and the route-scoped mapper

| Situation | Status | Body | Emitted by |
|---|---|---|---|
| All files ingested | **200** | `{results, errors:[]}` | handler |
| Some ingested, some not | **207** | `{results, errors}` | handler |
| None ingested (all failed post-multer) | **400** | `{error: errors[0].error, errors}` | handler |
| No file in request / non-multipart body | **400** | `{error:"Missing file in request body"}` | handler |
| Invalid `metadata` field | **400** | `{error:"Invalid metadata JSON"}` | handler |
| Invalid `access_policy` value | **400** | `{error:"Invalid access_policy"}` | handler |
| No/invalid JWT | **401** | `{error:"…"}` | `authMiddleware` (`middleware/auth.ts:11-14,20-22` [V]) — **before** multer |
| Anything multer/busboy raises | per §5.8.1 | `{error:"…"}` | **route-scoped mapper** |
| Unexpected error inside the mapper | **500** | `{error:"Upload failed"}` | **route-scoped mapper itself** |

**Critical (R3):** `middleware/error.ts:7` declares `errorHandler(err: unknown, _req: Request, res: Response)` — **3 parameters**, registered at `app.ts:60` [V]. Express requires `fn.length === 4`, so it is **not** an error handler: any `next(err)` escapes to Express's **default HTML error page with a stack trace**, violating AC6. Therefore the upload path's mapper is **terminal** — it always writes the response itself, **never calls `next(err)`**, and has **no fallback path**. It logs `err.message` and `err.stack` **server-side only** (`logger.error`, already imported at `routes/ingest.ts:7` [V]) — never a stack, and never a filesystem path, in the response body. Fixing `middleware/error.ts` globally stays out of scope (F6).

#### 5.8.1 Mapper classification table (exact — this is what makes T8 pass)

Evaluate in this order; first match wins:

| # | Condition | Status | `error` string |
|---|---|---|---|
| 1 | `err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'` | **413** | `File too large (max 25MB)` |
| 2 | `… err.code === 'LIMIT_FILE_COUNT'` | **400** | `Too many files (max 10)` |
| 3 | `… err.code === 'LIMIT_UNEXPECTED_FILE'` | **400** | `Unexpected field "` + `err.field` + `"; upload files under "files"` |
| 4 | `… err.code` ∈ `LIMIT_FIELD_KEY`, `LIMIT_FIELD_VALUE`, `LIMIT_FIELD_COUNT`, `LIMIT_PART_COUNT` | **400** | `Malformed form data` |
| 5 | `err && err.code === 'UNSUPPORTED_FILE_TYPE'` (our `fileFilter` rejection, §5.5) | **400** | `Unsupported file type: .` + `err.ext` |
| 6 | Non-`MulterError` busboy failure: `/^(Multipart:\|Unexpected end of form\|Malformed part header)/i.test(String(err && err.message))` **or** `err.code === 'ERR_STREAM_PREMATURE_CLOSE'` | **400** | `Malformed multipart request` |
| 7 | any **other** `multer.MulterError` (`MISSING_FIELD_NAME`, `INVALID_FIELD_NAME`, `LIMIT_FIELD_NESTING`, `LIMIT_FIELD_ARRAY_INDEX`, `STREAM_DESTROYED`, …) | **400** | `Malformed form data` |
| 8 | anything else | **500** | `Upload failed` |

Row 6 exists because busboy's own throws are plain `Error`s (`Multipart: Boundary not found` when the request header carries no boundary) and are **not** `MulterError` — multer forwards them verbatim. Row 7 keeps every client-caused multer code a 4xx instead of a 500 (REVIEW round-2 non-blocking #1). Row 8 is emitted **by the mapper**, per R3. The mapper signature is pinned as `(err: any, req: Request, res: Response, _next: NextFunction)` so `err.code` reads typecheck under `strict` (Express's own `ErrorRequestHandler` types `err` as `any`).

Every row writes `res.status(code).json({ error }); return;`. The mapper wraps its whole classification in a `try/catch` so even a throwing getter cannot escape to Express's HTML handler.

#### 5.8.2 The mapper must sweep `req.files` before responding

```ts
const raw = (req as Request & {
  files?: Express.Multer.File[] | { [field: string]: Express.Multer.File[] };
}).files;
const list: Express.Multer.File[] = Array.isArray(raw) ? raw : raw ? Object.values(raw).flat() : [];
for (const f of list) {
  try { fs.rmSync(f.path, { force: true }); } catch { /* best effort; never mask the real error */ }
}
if ((err as { storageErrors?: unknown[] }).storageErrors?.length) {
  logger.error('[ingest] multer storage cleanup failures',
               { storageErrors: (err as { storageErrors: unknown[] }).storageErrors });
}
```

**Why the handler's `finally` is not enough:** on a `fileFilter` rejection, a `LIMIT_*` abort, or malformed multipart, **the route handler never executes** — so no `finally` inside it can run. `req.files` holds whatever multer had already written and is the only place those leaked paths are visible. Multer does attempt its own `_removeFile` on abort, but failures surface only via `uploadError.storageErrors`, which would otherwise be silent (hence the log line). Normalise both shapes: `req.files` is an **array** for `.array()` and a **`{[field]: File[]}` map** for `.fields()`/`.any()`, and the sweep must handle either.

---

## 6. ORDERED STEPS AND DEPENDENCIES

All commands run in **`D:\Develop\knowledge-app\server`**. Only `src/routes/ingest.ts` is edited.

| # | Step | Depends on | Exact change / command |
|---|---|---|---|
| S1 | Install runtime dep, exact | — | `npm install multer@2.5.0 --save-exact` |
| S2 | Install types, exact | — | `npm install @types/multer@2.3.0 --save-dev --save-exact` |
| S3 | Verify install, **stop-and-report gate** | S1,S2 | `node -p "require('./node_modules/multer/package.json').version"` → `2.5.0`; `ls node_modules/@types/multer/index.d.ts`; `grep '"multer"' package.json` → exact `2.5.0` (no `^`). **If npm resolves a different major version, STOP and report** — do not let an alternate resolution carry the change. |
| **S3b** | **Settle the typings before writing the handler** | S3 | Write **only** `import multer from 'multer';` plus **one** `multer.diskStorage({ destination: TMP_DIR, filename: … })` call in `routes/ingest.ts`; then `npx tsc --noEmit` → exit 0 and `node -p "typeof require('./node_modules/multer')"` → **`function`** (proves CJS loadability under `tsx`). One minute here prevents a rewrite later. |
| S4 | `TMP_DIR` + `storage` | S3b | Module scope in `routes/ingest.ts`: `const TMP_DIR = path.resolve(ingestionService.storageDir, '..', 'tmp'); fs.mkdirSync(TMP_DIR, { recursive: true });` **before** the `multer(...)` instance. `filename` = `tmp-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${sanitizeExt(file.originalname)}`. |
| S5 | `fileFilter` + `limits` | S4 | Extension allowlist of §5.5, tagged `UNSUPPORTED_FILE_TYPE` rejection, `fileSize/files/fields/fieldSize` limits. |
| S6 | Rewrite the `/upload` handler | S5 | `upload.array('files', 10)`, non-empty `req.files` guard, `metadata`/`access_policy`/`kind`/`name` guards, per-file `try/catch/finally` loop feeding `ingestFile`, envelope response per §5.7 and the shape rules of §5.6.3. Preserve `detectKind`/`access_policy`/`metadata` semantics (`routes/ingest.ts:37-42` [V]). |
| S7 | Add the 4-arg mapper | S6 | Last element of the `router.post('/upload', …)` chain; classification §5.8.1, `req.files` sweep §5.8.2, **terminal** (never `next(err)`). |
| S8 | Delete the dead disk-era code | S6 | Remove the `file.buffer` check and the `tmp-` `writeFileSync` block (`routes/ingest.ts:25-34` [V]). `fs`, `path`, `crypto` stay in use (`TMP_DIR`, `sanitizeExt`, sweep). The now-unused `pool` import (`:5`) is left alone — removing it is unrelated cleanup and AC10 tracks files, not lines. |
| S9 | **Temp-cleanup hardening only** | S6 | Per-file `fs.rmSync(file.path, { force: true })` in the loop's `finally`, plus the mapper sweep (§5.8.2). **No blob deletion.** Deleting `<storageDir>/<sha256><ext>` from the route is **removed** from this plan (unsafe *and* out of scope — see **F1**). |
| S10 | Typecheck | S4–S9 | `npx tsc --noEmit` → exit 0 |
| S11 | Run §7 tests | S10 | T0–T15, **then T12 last** |
| S12 | Cleanup | S11 | §7 T12 |

**No changes** to: `app.ts`, `service.ts`, `parsers.ts`, `chunker.ts`, `types.ts`, `db/*`, `web/**`, `dist/**`.
**Do not run `npm run build`** — it writes `dist/`, which the brief forbids. `tsc --noEmit` (S10) is the compile gate; run the server with `npx tsx src/index.ts`.

### `sanitizeExt` (S4)

```ts
function sanitizeExt(originalname: string): string {
  const ext = path.extname(originalname).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}
```

An empty ext is reachable only for files `fileFilter` already rejected, so this is defence-in-depth: the temp path can never contain `/`, `\`, or `..`.

---

## 7. TEST STRATEGY

Toolchain verified [V]: `node v24.22.1`, `npm 11.19.1`, `tsc 5.9.3`, `npx tsc -p tsconfig.json --noEmit` → **exit 0** on the current tree. Ports 3000/4000 free [V]. DB baseline: `documents=0, chunks=0, admins=1, audit_log=0` [V]. `server/data/uploads` is **empty** and `server/data/tmp` does **not** exist yet [V] — a real zero baseline for both the blob and temp assertions.

### T0 — Preconditions, credentials, helpers

```bash
cd /d/Develop/knowledge-app/server
command -v pdftotext || echo "pdftotext: NOT FOUND"      # Q5: record this line verbatim in the evidence
npx tsx src/index.ts    # separate terminal; expect "listening on 127.0.0.1:4000"
curl -s -w ' [%{http_code}]\n' http://127.0.0.1:4000/api/health    # {"ok":true,...} [200]
```

Rate-limit headroom: `/api` is capped at **100 req/min** (`app.ts:35-41` [V]). T3–T14 is ~22 requests, fine for one pass — but a re-run inside the same 60 s window stacks. **If you see 429, wait 60 s and re-run the block; do not "fix" it by disabling the limiter.**

Credentials are loaded **without exposing them**; `dotenv` already loads `.env` for the server (`config/index.ts:1-2` [V]) and the shell does the same for curl:

```bash
cd /d/Develop/knowledge-app/server
set -a; . ./.env; set +a   # exports PORT HOST DATABASE_URL ADMIN_USERNAME ADMIN_PASSWORD JWT_SECRET LOG_LEVEL
                           # (names verified against server/.env [V]); NEVER echo these
```

Helpers — define once per shell; used by every test below:

```bash
SERVER="http://127.0.0.1:4000"; UPLOAD="$SERVER/api/ingest/upload"
FIX="/d/Develop/knowledge-app/.pipeline/phase1/fixtures"
DB="/d/Develop/knowledge-app/server"
PSQL="D:/Install/PostgreSQL/18/bin/psql.exe"
PGARGS="-h 127.0.0.1 -p 5432 -U knowledge_app -d knowledge_app"
FAILED=0

req ()  { local r; r=$(curl -s -w $'\n%{http_code}' "$@"); CODE="${r##*$'\n'}"; BODY="${r%$'\n'*}"; }
want () { if [ "$CODE" = "$1" ]; then echo "  status $CODE OK  [$2]"; else echo "  STATUS FAIL want=$1 got=$CODE  [$2]"; FAILED=1; fi; }
doccount   () { "$PSQL" $PGARGS -tAc "select count(*) from documents;" | tr -d ' \r'; }
chunkcount () { "$PSQL" $PGARGS -tAc "select count(*) from chunks;"    | tr -d ' \r'; }
tmpcount   () { find "$DB/data/tmp" -name 'tmp-*' 2>/dev/null | wc -l | tr -d ' \r'; }
want_tmp0  () { local n; n=$(tmpcount); if [ "$n" = 0 ]; then echo "  tmp clean (0) OK"; else echo "  TMP LEAK: $n file(s)"; FAILED=1; fi; }
uq () { tr -d ' \r'; }
jget () { node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).$1"; }

# Assert a JSON failure body: parses, non-empty string .error, no <html, no Node stack frame.
want_err () { printf '%s' "$BODY" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  let ok=true, why="";
  try { const o=JSON.parse(s); if(typeof o.error!=="string"||!o.error.trim()){ok=false;why="no string .error";} }
  catch(e){ ok=false; why="not JSON"; }
  if(/<html/i.test(s)){ ok=false; why="contains <html"; }
  if(/at [^\n]*:\d+:\d+/.test(s)){ ok=false; why="contains stack frame"; }
  console.log(ok?"  body OK (JSON, string .error, no html, no stack)":"  BODY FAIL: "+why); process.exit(ok?0:1); });' || FAILED=1; }

want_val () { if [ "$1" = "$2" ]; then echo "  $3 = $2 OK"; else echo "  FAIL $3: want=$2 got=$1"; FAILED=1; fi; }
```

Every failure case asserts **both** the status (`want`) **and** the body (`want_err`): status-only checks cannot prove "no stack traces" (REQUEST AC4).

### T1 — Typecheck (AC9)
```bash
cd /d/Develop/knowledge-app/server && npx tsc --noEmit; echo "exit=$?"      # expect exit=0
```

### T1b — Baseline integrity (AC10)
```bash
cd /d/Develop/knowledge-app && sha256sum -c .pipeline/phase1/baseline.sha256   # 27/27 OK before implementation
```
After implementation only `server/src/routes/ingest.ts`, `server/package.json`, `server/package-lock.json` may differ; **every other line must still print `OK`**, and **no `web/**` line may change**. (The repo is not a git repo [V], so this file list — not `git status` — is the "no unrelated changes" evidence.)

### T2 — Login (exported once) + baseline counts

The password never appears in argv or history — it is expanded inside a **heredoc** body:

```bash
mkdir -p "$FIX"; cd /d/Develop/knowledge-app/server
TOKEN=$(curl -s -X POST "$SERVER/api/auth/login" -H 'Content-Type: application/json' --data @- <<JSON | jget token
{"username":"$ADMIN_USERNAME","password":"$ADMIN_PASSWORD"}
JSON
)
echo "token length: ${#TOKEN}"     # expect > 100; NEVER echo the token or the password itself
export TOKEN
```
Login shape verified: `routes/auth.ts:27-28` returns `{token, user}` [V]. Every later command uses `-H "Authorization: Bearer $TOKEN"`.

```bash
DOC0=$(doccount); CHUNK0=$(chunkcount)
echo "documents=$DOC0 chunks=$CHUNK0"                     # expect 0 / 0
want_val "$("$PSQL" $PGARGS -tAc 'select count(*) from admins;' | uq)" "1" "admins"
BEFORE_UPLOADS=$(ls "$DB/data/uploads" | sort)            # expect empty; T12 reference listing
PRE_SHA=$("$PSQL" $PGARGS -tAc "select sha256 from documents;" | tr -d ' \r' | grep . | LC_ALL=C sort -u)
echo "pre-existing document hashes: $(printf '%s\n' "$PRE_SHA" | grep -c .)"   # must equal $DOC0
# Hard gate: the suite must never run destructively against a non-empty database.
[ "$DOC0" = 0 ] || { echo "  NON-EMPTY BASELINE — stop and report before running the suite"; FAILED=1; }
```

### T3 — Fixtures + single-file happy path (AC1–AC4, AC8)

Fixtures live **outside** `dist/`. Cleanup is **hash-scoped**, not name-scoped: T12 derives test hashes from the fixture bytes on disk and subtracts every hash the user already owned, so fixture names carry no meaning for safety. Names are still chosen to be recognisable (`p1-*`, plus `résumé.txt`) for the non-ASCII check. Every success fixture is **fresh content**: re-uploading identical bytes hits the blob-existence dedupe (`service.ts:120-123` [V]) and inserts **0** rows, which would make the row-count assertions impossible to satisfy. Distinct word sequences, ≥40 words each:

```bash
cd "$FIX"
node -e "require('fs').writeFileSync('p1-ok.txt','Zephyr quartz nymph vortex jigsaw baffle cobbler dwindled ember fickle gallant hustle ivory jostle knuckle lattice murmur nibble obtuse prattle quiver rustle sizzle tundra umbrage vivid waddle yoke zipper. '.repeat(6))"
node -e "require('fs').writeFileSync('p1-ok2.txt','Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu anvil beacon cinder. '.repeat(6))"
node -e "require('fs').writeFileSync('p1-ok3.txt','Cobalt driftwood elderberry fathom glisten harness imperil jarring kindle lantern mosaic nectar orchard plumage quill ravenous sapphire thistle upland vellum willow xenial yarrow zenith almanac birch cavern. '.repeat(6))"
node -e "require('fs').writeFileSync('p1-t10.txt','Amber bramble cascade dapple escarp fjord granite hollow inlet juniper kelp lagoon meadow niche onyx prairie quarry ripple sedan tundra umbra valley wisp yonder zealot abacus bellow crag. '.repeat(6))"
node -e "require('fs').writeFileSync('p1-t11.txt','Ballast cinder dune ember flint gravel hollow ingot jetty kestrel ledge mortar nimbus opal pumice quarry rivet silt timber usher vapor whet yarrow zephyr anvil basalt cobalt. '.repeat(6))"
node -e "require('fs').writeFileSync('p1-t13.txt','Dome ember fathom gully hollow isthmus jamb keel loam mesa notch outlet pinnacle quill ridge spire tor usher vale weir xenon yarrow zephyr alder briar crag delta. '.repeat(6))"
node -e "require('fs').writeFileSync('p1-t15.txt','Establish falcon gable hammock ignite jaunt kelp lantern muster nudge opal prism quiver relabel saffron toll unify vessel wager xenon yeast zonal anodyne bluster cobble. '.repeat(6))"
node -e "require('fs').writeFileSync('p1-bad.exe','MZ')"
node -e "require('fs').writeFileSync('p1-broken.docx', Buffer.from('not-a-zip'))"
node -e "require('fs').writeFileSync('p1-broken2.docx', Buffer.from('also-not-a-zip-2'))"
node -e "require('fs').writeFileSync('résumé.txt','Résumé sample text for the non-ASCII filename check. '.repeat(6))"
node -e "require('fs').writeFileSync('p1-big.txt', Buffer.alloc(26*1024*1024, 97))"
```
`p1-broken2.docx` exists because `p1-broken.docx` already has a blob on disk after T9, and re-uploading it would dedupe into a **success** (F1) instead of failing.

Single-file upload — **T3 uses `p1-ok3.txt`** so `p1-ok.txt` and `p1-ok2.txt` are still un-ingested when T4 sends them (T4 needs a delta of exactly +2):

```bash
cd /d/Develop/knowledge-app/server
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-ok3.txt;type=text/plain"
want 200 "single file"
printf '%s' "$BODY" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const b=JSON.parse(s), r=Array.isArray(b.results)?b.results[0]:null;
  const need=["documentId","contentHash","chunkCount","chunkIds","name","kind","accessPolicy","textLength","savedAt"];
  const miss=need.filter(k=>!r||!(k in r));
  const ok=Array.isArray(b.results)&&b.results.length===1&&Array.isArray(b.errors)&&b.errors.length===0
           &&miss.length===0&&r.chunkCount>=1&&r.kind==="txt";
  console.log(ok?"  envelope OK (all 9 result fields, chunkCount="+r.chunkCount+")"
                 :"  ENVELOPE FAIL missing="+miss.join(",")+" chunkCount="+(r&&r.chunkCount));
  process.exit(ok?0:1); });' || FAILED=1
```
AC1 requires `results[0]` to carry all nine fields — this asserts exactly that, not just the status.

Then extract ids and assert in SQL:

```bash
DOCID=$(printf '%s' "$BODY" | jget results[0].documentId)
HASH=$(printf '%s'  "$BODY" | jget results[0].contentHash)
want_val "$HASH" "$(sha256sum "$FIX/p1-ok3.txt" | cut -d' ' -f1)" "contentHash == sha256(file)"
want_val "$("$PSQL" $PGARGS -tAc "select kind from documents where id='$DOCID';" | uq)" "txt" "documents.kind"
want_val "$("$PSQL" $PGARGS -tAc "select size_bytes from documents where id='$DOCID';" | uq)" "$(wc -c < "$FIX/p1-ok3.txt" | tr -d ' ')" "documents.size_bytes"
want_val "$("$PSQL" $PGARGS -tAc "select access_policy from documents where id='$DOCID';" | uq)" "restricted" "default access_policy"
want_val "$("$PSQL" $PGARGS -tAc "select count(*) from chunks where document_id='$DOCID';" | uq)" "$(printf '%s' "$BODY" | jget results[0].chunkCount)" "chunks == response.chunkCount"
want_val "$("$PSQL" $PGARGS -tAc "select count(*) from documents where sha256='$HASH';" | uq)" "1" "one row per sha256"
ls "$DB/data/uploads" | grep -q "^$HASH.txt$" && echo "  AC4 blob <hash>.txt present OK" || { echo "  AC4 FAIL"; FAILED=1; }
want_tmp0
```
`documents.status` defaults to `'pending'` (`schema.ts:13` [V]) and `ingestFile` never updates it — `pending` is **expected**; do not assert `'ready'`.

**Non-ASCII filename check (recorded, no decode hack):** upload the `résumé.txt` fixture once and record the observed `documents.name` value verbatim:

```bash
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/résumé.txt;type=text/plain"
want 200 "unicode filename accepted"
RESUME_ID=$(printf '%s' "$BODY" | jget results[0].documentId)
"$PSQL" $PGARGS -tAc "select name from documents where id='$RESUME_ID';"   # RECORD bytes exactly as returned
want_tmp0
```
Acceptance for this check is "upload succeeds and the extension is preserved". A mojibake `name` (busboy can hand `originalname` back latin1-decoded) is **recorded** as a known limitation and **not** fixed with a decode hack in Phase 1.

### T4 — Multi-file happy path (AC1, AC8)

```bash
DOC_B=$(doccount)
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" \
  -F "files=@$FIX/p1-ok.txt;type=text/plain" -F "files=@$FIX/p1-ok2.txt;type=text/plain"
want 200 "two files, both good"
want_val "$(printf '%s' "$BODY" | jget results.length)" "2" "results.length"
want_val "$(printf '%s' "$BODY" | jget errors.length)"  "0" "errors.length"
want_val "$(( $(doccount) - DOC_B ))" "2" "documents delta"
want_tmp0
```
Both fixtures are first-time uploads with **different** content, so both insert; identical content would dedupe to 0 rows (`service.ts:120-123` [V]). Status-only checking is not acceptable here — the delta is the assertion that catches "200 but nothing stored".

### T5 — No file / empty multipart / wrong field name (AC6, EC1–EC2)

```bash
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN"
want 400 "no body at all"; want_err

req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "name=only"
want 400 "true empty multipart (valid boundary, no file)"; want_err

req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "file=@$FIX/p1-ok3.txt"
want 400 "wrong field name (LIMIT_UNEXPECTED_FILE)"; want_err
printf '%s' "$BODY" | grep -q 'files' && echo "  message names the right field OK" || { echo "  message missing field hint"; FAILED=1; }
want_tmp0
```
The empty-multipart case needs the `-F name=only` form: a wholly body-less request takes the "non-multipart" branch instead, so it does not test what EC1 intends.

### T6 — Unsupported extension (AC6, EC3)

```bash
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-bad.exe"
want 400 "unsupported extension"; want_err
printf '%s' "$BODY" | grep -q 'Unsupported file type: .exe' && echo "  actionable message OK" || { echo "  MESSAGE FAIL"; FAILED=1; }
want_tmp0
```

### T7 — Oversized file (AC6, EC5, 413)

```bash
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-big.txt"
want 413 "26 MiB > 25 MiB"; want_err
printf '%s' "$BODY" | grep -q 'File too large (max 25MB)' && echo "  size message OK" || { echo "  MESSAGE FAIL"; FAILED=1; }
want_tmp0        # multer truncates then aborts; the mapper sweep must remove the partial file
```

### T8 — Malformed / non-multipart (AC6, EC6)

```bash
# (a) JSON body: multer only parses multipart, so it passes through unparsed and the handler's
#     empty-files guard answers.
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"file":"x"}'
want 400 "JSON body on the upload route"; want_err

# (b) multipart with NO boundary: busboy throws "Multipart: Boundary not found" (a plain Error,
#     not a MulterError) -> mapper row 6 -> 400. NOT a 500, NOT HTML.
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: multipart/form-data' --data-binary 'garbage'
want 400 "multipart without boundary"; want_err
printf '%s' "$BODY" | grep -q 'Malformed multipart request' && echo "  malformed message OK" || { echo "  MESSAGE FAIL"; FAILED=1; }
want_tmp0
```
Case (b) is the one that was impossible under the old plan: `next(err)` would have reached the 3-arg `errorHandler` and produced Express's HTML 500.

### T9 — Ingestion throws mid-way (orphan blob is DOCUMENTED, not deleted) (AC5, AC8, EC7)

A `.docx` that is not a zip passes the extension allowlist and fails inside the parser.

```bash
ORPHAN_BLOB=$(sha256sum "$FIX/p1-broken.docx" | cut -d' ' -f1)
CHUNK_B=$(chunkcount)
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-broken.docx"
want 400 "corrupt docx"; want_err                    # message is the parser's; JSON, not a stack
want_val "$("$PSQL" $PGARGS -tAc "select count(*) from documents where name like 'p1-broken%';" | uq)" "0" "no documents row"
want_val "$(chunkcount)" "$CHUNK_B" "chunks unchanged"
want_tmp0
test -f "$DB/data/uploads/$ORPHAN_BLOB.docx" \
  && echo "  orphan blob present (expected, documented F1): $ORPHAN_BLOB.docx" \
  || { echo "  UNEXPECTED: orphan blob missing — record what happened, do not 'fix' it in the route"; FAILED=1; }
```
What this proves, and what it does not:

- **No orphan rows.** `storeDocument` runs only after parsing (`service.ts:144` [V]) inside `BEGIN … ROLLBACK` (`:187`/`:221` [V]), so a parse failure never inserts.
- **One orphan blob is expected and asserted present.** `service.ts:126` writes the blob **before** `parseFile` at `:130` [V]. The route cannot safely delete it (F1), so T9 records it as `$ORPHAN_BLOB` and T12 removes it by exact path. A plan that deleted it here would be the B1 defect.
- **Temp is gone regardless**, because the per-file `finally` runs on the error path too.

### T10 — Duplicate upload / dedupe (EC8)

```bash
DOC_B=$(doccount)
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-t10.txt"
want 200 "first upload"
want_val "$(printf '%s' "$BODY" | jget results[0].chunkCount)" "1" "first chunkCount"
want_val "$(( $(doccount) - DOC_B ))" "1" "first upload delta"
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-t10.txt"
want 200 "re-upload (dedupe is a success, not an error)"
want_val "$(printf '%s' "$BODY" | jget results[0].chunkCount)" "0" "dedupe chunkCount"
want_val "$(( $(doccount) - DOC_B ))" "1" "delta after re-upload (0 new rows)"
want_tmp0
```
Verified by reading `service.ts:119-123` [V]: dedupe keys on `fs.existsSync(storagePath)`; on a hit it returns `documentId = contentHash`, `chunkCount: 0`, `chunkIds: []`, `textLength: 0` and inserts nothing. Two documented consequences (F3): the same file returns a **UUID** on first ingest and a **hash** on re-upload, and `documents.sha256` is not UNIQUE (`schema.ts:12` [V]).

### T11 — Multiple files, one fails **after** multer (AC5, AC8, EC9)

```bash
DOC_B=$(doccount)
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" \
  -F "files=@$FIX/p1-t11.txt" -F "files=@$FIX/p1-broken2.docx"
want 207 "mixed batch"
want_val "$(printf '%s' "$BODY" | jget results.length)" "1" "results.length"
want_val "$(printf '%s' "$BODY" | jget errors.length)"  "1" "errors.length"
want_val "$(printf '%s' "$BODY" | jget errors[0].file)" "p1-broken2.docx" "errors[0].file"
want_val "$(( $(doccount) - DOC_B ))" "1" "exactly one new document"
want_tmp0
```
`p1-broken2.docx` is used, not `p1-broken.docx`: after T9 the latter already has a blob, and a re-upload would hit dedupe and *succeed* (F1) rather than fail.

This is the **only** per-file isolation this design provides: the failure happens *after* multer, inside the loop, so the per-file `try/catch` keeps the other results. A `fileFilter`/`LIMIT_*` failure cannot be isolated — it aborts the whole request (T14).

### T12 — Cleanup (AC11) — **RUN LAST, after T15**

Surgical, scoped to test data only. Runs **after** every test that creates data (T3–T15);  run out of order it would report `FAILED=0` while leaving T13(c)'s `/watch` document and T14's rows behind (REVIEW round 2, RB5).

```bash
# 1) Test hashes = hashes of the fixture bytes on disk, MINUS any hash the user already owned.
#    Content-addressed, so this is exact, and it covers résumé.txt regardless of how its
#    NAME was decoded (documents.sha256 holds the bytes).
FIX_SHA=$(for f in "$FIX"/p1-* "$FIX"/résumé.txt; do [ -f "$f" ] && sha256sum "$f"; done | cut -d' ' -f1 | LC_ALL=C sort -u)
TEST_SHA=$(comm -23 <(printf '%s\n' "$FIX_SHA") <(printf '%s\n' "$PRE_SHA") | grep . || true)
echo "test hashes to remove: $(printf '%s\n' "$TEST_SHA" | grep -c .)"     # EYEBALL THIS FIRST

# 2) Delete test chunks then documents, scoped BY HASH — never by name, never by a name pattern.
#    Any hash the user already owned was excluded above, so a pre-existing user document can
#    never match (in that case the upload deduped and created no row at all).
if [ -n "$TEST_SHA" ]; then
  IN=$(printf "'%s'," $TEST_SHA); IN=${IN%,}          # => 'h1','h2',…
  "$PSQL" $PGARGS -c "delete from chunks   where document_id in (select id from documents where sha256 in ($IN));"
  "$PSQL" $PGARGS -c "delete from documents where sha256 in ($IN);"
else
  echo "  no test documents to delete"
fi

# 3) Delete ONLY blobs that did not exist at T2 — i.e. written by this run. Subsumes $TEST_SHA
#    blobs, $ORPHAN_BLOB, p1-broken2 and every fixture blob in ONE rule, and is incapable of
#    touching a pre-existing user blob (including the identical-bytes/dedupe case, where the
#    blob on disk belongs to a surviving user document).
for b in $(comm -13 <(printf '%s\n' "$BEFORE_UPLOADS" | grep .) <(ls "$DB/data/uploads" | LC_ALL=C sort)); do
  rm -f "$DB/data/uploads/$b"
  echo "  removed run blob: $b"
done

# 4) Extract artifacts written by the pipeline for test documents (data/extracts/<hash>.txt)
for h in $TEST_SHA; do rm -f "$DB/data/extracts/$h".*; done

# 5) Verify: no surviving document references a hash we just removed, and the user's
#    pre-existing rows are all still there, hash for hash.
SURVIVE=$("$PSQL" $PGARGS -tAc "select sha256 from documents;" | tr -d ' \r' | grep . | LC_ALL=C sort -u)
UNEXPECTED=$(comm -13 <(printf '%s\n' "$SURVIVE") <(printf '%s\n' "$PRE_SHA") | grep . || true)
[ -z "$UNEXPECTED" ] && echo "  all pre-existing user documents intact OK" \
  || { echo "  PRE-EXISTING DOCUMENT MISSING:"; echo "$UNEXPECTED"; FAILED=1; }
LEAKED=$(comm -12 <(printf '%s\n' "$SURVIVE") <(printf '%s\n' "$TEST_SHA") | grep . || true)
[ -z "$LEAKED" ] && echo "  no test row left behind OK" \
  || { echo "  TEST ROWS REMAIN:"; echo "$LEAKED"; FAILED=1; }

# 6) Assert the uploads directory is back to the T2 listing
AFTER_UPLOADS=$(ls "$DB/data/uploads" | sort)
[ "$BEFORE_UPLOADS" = "$AFTER_UPLOADS" ] && echo "  uploads dir restored OK" \
  || { echo "  UPLOADS DIFF:"; diff <(echo "$BEFORE_UPLOADS") <(echo "$AFTER_UPLOADS"); FAILED=1; }

# 7) Temp dir must contain no tmp-* files (the directory itself may remain — created at module scope)
want_tmp0

# 8) Remove fixtures
rm -f "$FIX"/p1-* "$FIX"/résumé.txt
[ -z "$(ls -A "$FIX" 2>/dev/null)" ] && echo "  fixtures dir empty OK" || { echo "  FIXTURES LEFT"; ls -A "$FIX"; FAILED=1; }

# 9) Final baseline — compare against the values captured in T2 ($DOC0/$CHUNK0), not hard-coded 0
want_val "$(doccount)"   "$DOC0"   "documents (baseline)"
want_val "$(chunkcount)" "$CHUNK0" "chunks (baseline)"
want_val "$("$PSQL" $PGARGS -tAc 'select count(*) from admins;' | uq)" "1" "admins"
want_val "$("$PSQL" $PGARGS -tAc 'select count(*) from audit_log;' | uq)" "0" "audit_log"

echo "FAILED=$FAILED"     # must be 0
```

**Hard rules:** ❌ never `DROP DATABASE`/`DROP SCHEMA`/`TRUNCATE`/`DELETE FROM documents` without `WHERE`; ❌ never delete `admins` rows (`admins=1` is the pre-existing baseline [V]); ✅ `documents`/`chunks` back to the T2 baseline, `admins=1`, `audit_log=0`, `data/uploads` byte-identical to the pre-test listing, no `tmp-*` left. Scoped delete + baseline diff is the whole plan — a throwaway database is not required (and creating one is arguably "touching the DB").

### T13 — Auth + other-route regression (AC7, REQUEST AC6)

```bash
# (a) no Authorization at all -> 401 AND no temp file: proves multer never ran before auth
req -X POST "$UPLOAD" -F "files=@$FIX/p1-ok.txt"
want 401 "no Authorization header"; want_err
want_tmp0

# (b) garbage token -> 401 JSON
req -X POST "$UPLOAD" -H "Authorization: Bearer not-a-real-token" -F "files=@$FIX/p1-ok.txt"
want 401 "garbage token"; want_err
want_tmp0

# (c) known-good non-upload path must not regress: /watch (absolute path, JSON body)
req -X POST "$SERVER/api/ingest/watch" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"path\":\"$(cd "$FIX" && pwd -W)/p1-t13.txt\"}"
want 200 "/ingest/watch still works"
want_val "$(printf '%s' "$BODY" | node -p "typeof JSON.parse(require('fs').readFileSync(0,'utf8')).documentId")" "string" "/watch documentId is a string"
want_val "$(printf '%s' "$BODY" | jget chunkCount)" "1" "/watch chunkCount"

# (d) health
req "$SERVER/api/health"; want 200 "/api/health"

# (e) search returns JSON, not HTML (unchanged global error path)
req -X POST "$SERVER/api/search" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"q":"alpha"}'
echo "  search status $CODE (record it; a 5xx here is the known out-of-scope FTS defect, not a regression)"
printf '%s' "$BODY" | grep -qi '<html' && { echo "  SEARCH RETURNED HTML — global error path changed"; FAILED=1; } \
  || echo "  search body is JSON, not HTML OK"
```
`/watch` needs a Windows-absolute path because `fs.statSync` runs in Node (`routes/ingest.ts:80` [V]); `pwd -W` gives `D:/…` form from git-bash. `p1-t13.txt` is a **fresh** fixture so `/watch` returns `chunkCount≥1` rather than a dedupe hit (a dedupe hit would report `0`).

### T14 — Abort semantics: one bad file kills the whole request (AC6, EC9)

```bash
DOC_B=$(doccount)
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" \
  -F "files=@$FIX/p1-t11.txt" -F "files=@$FIX/p1-bad.exe"
want 400 "one bad file aborts the whole batch"; want_err
printf '%s' "$BODY" | grep -q 'Unsupported file type: .exe' && echo "  filter message OK" || { echo "  MESSAGE FAIL"; FAILED=1; }
want_val "$(( $(doccount) - DOC_B ))" "0" "no documents rows from the aborted batch"
want_tmp0

# transport failure => {error} only, no partial envelope
printf '%s' "$BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);const ok=!("results" in o)&&!("errors" in o);console.log(ok?"  transport-failure body is {error} only OK":"  BODY SHAPE FAIL");process.exit(ok?0:1);});' || FAILED=1
```
`p1-t11.txt` is already stored by T11 and is deliberately reused here: the assertion is that the **aborted batch adds 0 rows even though the other file is perfectly ingestable** — that is exactly what "the whole request aborts" means.

### T15 — Field-guard rejections + the step-2b temp sweep (R13, RB3, RB4)

The two input guards from §5.6 step 2 had no test, and neither did the sweep that RB3 added. This test proves both, plus a positive control so a guard that rejects *everything* cannot pass:

```bash
DOC_B=$(doccount)

# (a) invalid metadata JSON -> 400, no rows, AND no leaked temp file
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" \
  -F "files=@$FIX/p1-ok.txt" -F 'metadata=not json'
want 400 "invalid metadata JSON"; want_err
printf '%s' "$BODY" | grep -q 'Invalid metadata JSON' && echo "  guard message OK" || { echo "  MESSAGE FAIL"; FAILED=1; }
want_val "$(( $(doccount) - DOC_B ))" "0" "no rows from a rejected metadata field"
want_tmp0                      # proves the step-2b sweep, not a handler finally

# (b) junk access_policy -> 400, no rows, no leaked temp file
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" \
  -F "files=@$FIX/p1-ok.txt" -F 'access_policy=banana'
want 400 "invalid access_policy"; want_err
want_val "$(( $(doccount) - DOC_B ))" "0" "no rows from a rejected access_policy"
want_tmp0

# (c) positive control: a valid metadata object is accepted and persisted as jsonb
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" \
  -F "files=@$FIX/p1-t15.txt" -F 'metadata={"team":"ops"}'
want 200 "valid metadata accepted"
want_val "$(( $(doccount) - DOC_B ))" "1" "positive control ingested exactly one row"
META_OK=$("$PSQL" $PGARGS -tAc "select metadata->>'team' from documents where sha256='$(sha256sum "$FIX/p1-t15.txt" | cut -d' ' -f1)';" | uq)
want_val "$META_OK" "ops" "metadata persisted as jsonb"
want_tmp0
```

`p1-ok.txt` is already stored by T4, so a 200 on cases (a)/(b) would be a silent dedupe success — the **400 assertion is what discriminates**. Case (c) uses a fresh fixture (`p1-t15.txt`, created in T3 with distinct content) so it is a real first ingest; its result is asserted through the row delta **and** the jsonb round-trip. Its row is removed in T12 step 2 (hash-scoped) and its blob in step 3 (listing delta).

---

## 8. EDGE CASES

| ID | Case | Expected behaviour | Notes / evidence |
|---|---|---|---|
| EC1 | **No file** (empty multipart, valid boundary) | **400** `{"error":"Missing file in request body"}` | Handler guard; string kept verbatim from `routes/ingest.ts:26` [V] |
| EC2 | **Wrong field name** (`file=` instead of `files=`) | **400** `Unexpected field "file"; upload files under "files"` | `LIMIT_UNEXPECTED_FILE` → mapper row 3 |
| EC3 | **Unsupported extension** (`.exe`, `.zip`, `.tar`) | **400** `Unsupported file type: .<ext>` | `fileFilter` allowlist derived from `parsers.ts:191-224` [V] |
| EC4 | **Dangerous MIME** on an allowed ext (optional deny-list) | **400** | Deny-list only — no false positives from browsers |
| EC5 | **Oversized file** (>25 MiB) | **413** `File too large (max 25MB)`, **no temp left behind** | Mapper row 1 + mapper sweep (§5.8.2) |
| EC6 | **Malformed multipart** (no boundary, truncated body) | **400** `Malformed multipart request` | Plain busboy `Error` → mapper row 6; the mapper is terminal, so this can never become Express's HTML page |
| EC6b | **Non-multipart content type** (`application/json`) on the upload route | **400** `Missing file in request body` | Multer only parses multipart and passes the request through unparsed, so the handler's empty-files guard answers |
| EC7 | **Ingestion throws mid-way** | **400** `{error, errors[]}`; **no** orphan `documents`/`chunks` (single transaction, `service.ts:185-225` [V]); **one orphan blob remains** (`:126` before `:130` [V]) — asserted present, **not** deleted by the route (F1); temp always removed | **No blob cleanup in the route.** Ownership is `ingestionService`'s; a route-level "count rows then delete" is TOCTOU (F1) |
| EC8 | **Duplicate upload (identical bytes)** | **Verified** `service.ts:119-123` [V]: dedupe by *blob existence*; returns `documentId = contentHash`, `chunkCount 0`, `chunkIds []`, `textLength 0`, inserts nothing — reported as a **200 result**, not an error | Inconsistent `documentId` semantics; `sha256` not UNIQUE (`schema.ts:12` [V]) → **F3** |
| EC9 | **Multiple files, one fails at ingestion** | **207** `{results:[…], errors:[…]}`; successes committed; one failure does not abort the batch | Per-file `try/catch` in the loop. **This isolation exists only for post-multer errors** — a `fileFilter` rejection or any `LIMIT_*` aborts the **whole** request (T14), because one `upload.array('files')` instance reports a single error for the request |
| EC10 | **Zero-byte / zero-chunk file** (allowed ext) | **200** with `chunkCount: 0` + **one `warn` log** | `splitIntoChunks` returns `[]` for empty text (`chunker.ts:54` [V]); Q4 approved; no `warning` field (contract churn) |
| EC11 | **Filename with path/unicode** (`../../etc/passwd.txt`, `résumé.txt`) | Multer strips path separators; `sanitizeExt` allows only `^\.[a-z0-9]{1,8}$`, so no traversal via ext; the stored path is server-generated | `originalname` is used only for `name`, `detectKind`, and the ext. Charset is **not** normalised — T3 records the result, no decode hack |
| EC12 | **`body.metadata` as a multipart text field** | Arrives as a **string**; `JSON.parse` in try/catch → **400** `Invalid metadata JSON` on throw or on a non-object/array value | Otherwise `"hello"` reaches `$7::jsonb` (`service.ts:191` [V]) as a PG cast error |
| EC12b | **`body.access_policy` junk** | **400** `Invalid access_policy` unless `public\|trusted\|restricted`; absent → `restricted` | Prevents junk policy strings being persisted into the user's DB |
| EC13 | **No/expired JWT** | **401** JSON, and **0 temp files** | `authMiddleware` runs before the router (`app.ts:53` [V]); T13 proves multer never ran |
| EC14 | **Rate limit** | 100 req/min on `/api` (`app.ts:35-41` [V]); a re-run inside 60 s stacks | Wait 60 s; do not disable the limiter |
| EC15 | **Field-count / field-size limit** (`fields: 20`, `fieldSize: 1 MiB`) | **400** `Malformed form data` | Mapper row 4 (`LIMIT_FIELD_*`, `LIMIT_PART_COUNT`) |
| EC16 | **Legacy Office ext** (`.doc`, `.ppt`, `.xls`) | **400** `Unsupported file type: .doc` | `PARSERS` has no entry (`parsers.ts:188-227` [V]) although the UI drop filter accepts them (`page.tsx:14` [V]) → UX follow-up **F5** |

---

## 9. RISKS / ASSUMPTIONS

### Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Dependency install fails** (offline / registry) — `multer@2.5.0` pulls `busboy`, `type-is`, `append-field` into `node_modules` + lockfile | Med | If the registry is unreachable, try `npm install --offline`; otherwise **STOP and report**. Never substitute a different parser. |
| R2 | **Temp files pollute the content-addressed dir** if `TMP_DIR` is placed inside `data/uploads` | Low | `data/tmp` is a sibling (`path.resolve(storageDir,'..','tmp')`), created at module scope; AC8 asserts `find data/tmp -name 'tmp-*'` = 0 |
| R3 | **Envelope contract** replaces the old bare `IngestionResult` body | Low | Proven safe: `page.tsx:22-25` ignores the value [V]; `api.ts:38` only casts [V]. Q1/Q2 ruled: keep the envelope. |
| R4 | **`errorHandler` has 3 params** (`middleware/error.ts:7` [V]) → global unhandled errors return **HTML** | Med | Out of scope ≠ ignored: the upload route's mapper is terminal and self-responding (S7). Recorded as F6. |
| R5 | ~~Orphan storage blobs cleaned up by the route~~ | — | **DELETED (revision 2).** Blob deletion from the route is unsafe and out of scope; see **F1** for the correct owner and why any route-level guard is TOCTOU. |
| R6 | **Dedupe returns a hash masquerading as `documentId`** (EC8) | Med | Documented, out of scope → **F3** |
| R7 | **`pdftotext` is an external binary** (`parsers.ts:66` [V]) — PDF ingest depends on poppler | Med | T0 probes `command -v pdftotext` and records the output; the acceptance set uses `.txt` only (Q5). If absent, a PDF 4xx `PDF parse failed: spawn pdftotext ENOENT` is still clean. |
| R8 | **OCR/image path excluded** from the allowlist | Low | Intentional (§5.5); images remain reachable via `/watch` |
| R9 | `npm run build` would write `dist/`, violating the brief | High if done | **Never** run it; `npx tsx src/index.ts` + `tsc --noEmit` |
| R10 | **Ambiguous abort semantics** if implemented as per-file validation | High if misunderstood | §5.4 + EC9 + T14 state it: one `upload.array('files')` aborts the whole request on filter/`LIMIT_*` |
| R11 | **Async rejection kills the process** (Express 4.22.3 + Node 24) | High if omitted | Both try/catches + `finally` inside the loop (§5.6.2/§5.6.3) |

### Assumptions

- **A1** [G] The Inbox UI is the only consumer of `/api/ingest/upload` in this phase.
- **A2** [G] `multer@2.5.0` and `@types/multer@2.3.0` are installable as pinned; S3 is a stop-and-report gate.
- **A3** [V] The DB is reachable at `127.0.0.1:5432` as `knowledge_app` (trust auth) and is currently `documents=0, chunks=0, admins=1, audit_log=0`.
- **A4** [V] The ingestion pipeline is functional for text formats (verified by reading; **no live upload executed yet**).
- **A5** [V] 25 MiB / 10 files are acceptable defaults (not specified by the brief). Q7 approved.
- **A6** [V] `npx tsx` is available (`package.json:33`), so the server runs without writing `dist/`.
- **A7** [V] Express resolves to **4.22.3** (`node_modules/express/package.json:4`) despite `package.json:18`'s `^4.19.2` — async rejections are **not** forwarded (§5.6.2).

---

## 10. OUT OF SCOPE

1. Any change to `web/**` — including the stale `request<{status:string}>` type at `api.ts:64-68` and the inaccurate copy at `page.tsx:17,24,96-97` (record only: Q10, **F6**). AC10 forbids it.
2. Rewriting `ingestionService`, `parsers.ts`, `chunker.ts`, or `db/*`.
3. **Orphan-blob cleanup inside `service.ts`** — the correct fix for EC7/F1, but a pipeline change, so not in this phase.
4. Fixing `middleware/error.ts`'s 3-arg `errorHandler` globally (R4) beyond the **local** terminal mapper on the upload route.
5. Fixing the dedupe `documentId` inconsistency (R6 / EC8).
6. Adding a `UNIQUE` constraint on `documents.sha256`, or any schema migration.
7. Setting `documents.status` to a terminal value like `'ready'` — it stays `'pending'` (`schema.ts:13` [V]).
8. Wiring `/api/ingest/watch` folder sync (only the existing one-shot behaviour is regression-tested by T13).
9. Global mount of the multipart parser on `app.ts`.
10. OCR / image uploads via `/upload` (`parsers.ts:224` [V]).
11. Any `dist/` rebuild, `npm run build`, or publishing.
12. Any DB reset, `TRUNCATE`, `DROP`, or re-seeding.
13. Rate-limit tuning, CORS changes, or new routes.
14. Virus scanning, content sniffing deeper than the extension allowlist, or PDF parser replacement.
15. Test-framework introduction (no test runner exists — `package.json:7-11` [V]); tests are `curl` + `psql` per §7.
16. Per-file isolation for validation failures (impossible with one `upload.array()` — §5.4).
17. FTS/search correctness, JWT persistence/login/logout routing, Library/Audit wiring, Chat/LLM, broad security remediation, repo cleanup, doc rewrites (REQUEST.md "Out of scope").

---

## 11. OPEN QUESTIONS — with rulings

All ten are resolved. No open decisions remain for the implementer.

| ID | Question | **Ruling** |
|---|---|---|
| **Q1** | Envelope for multiple files vs bare `IngestionResult[]` | **APPROVED — envelope `{results, errors}`.** A bare array has no channel for partial failure. |
| **Q2** | Single file: bare `IngestionResult` or always the envelope? | **APPROVED — always the envelope.** A shape that flips with cardinality is the worst contract, and the client ignores the body either way (`page.tsx:22-25` [V], `api.ts:38` [V]). |
| **Q3** | Partial failure: 207 or 200 with populated `errors[]`? | **REVISED — 200 when `errors` is empty; 207 when results and errors are both non-empty; 400 when nothing succeeded** (body = `{error: errors[0].error, errors}`). A 200 carrying only errors hides failure from `res.ok`-based callers; 207 is safe because `res.ok` is true for 2xx and `api.ts` only special-cases 401. |
| **Q4** | Zero-byte / zero-chunk file | **APPROVED — accept**, return the `results` entry with `chunkCount: 0`, log one `warn`. No `warning` field. |
| **Q5** | Is `pdftotext` installed? | **DEFERRED — no gate.** Probe `command -v pdftotext` in T0 and record the output; **no PDF in the acceptance set**. If absent, PDF is documented as failing with `PDF parse failed: spawn pdftotext ENOENT` (still a clean 4xx). |
| **Q6** | Does PPTX need work? | **CONFIRMED — no work.** `service.ts:72-74`, `parsers.ts:219`, `parsers.ts:243` [V]. |
| **Q7** | 25 MiB / 10 files acceptable? | **APPROVED** — 25 MiB/file, 10 files, `fields: 20`, `fieldSize: 1 MiB` (§5.5). Optional 100 MiB batch-sum cap noted, not implemented. |
| **Q8** | `JSON.parse` a string `body.metadata`? | **APPROVED and MANDATORY** — §5.6 step 2, 400 `Invalid metadata JSON`, plus the `access_policy` enum guard. |
| **Q9** | `multer` vs hand-rolled busboy? | **APPROVED — `multer@2.5.0` + `@types/multer@2.3.0`, route-scoped `diskStorage`.** Hand-rolled busboy is a worse risk for a one-file change. CJS loadability confirmed at S3b. |
| **Q10** | Frontend change required? | **APPROVED — no `web/**` change.** `page.tsx:22-25` uses the return value nowhere [V]; `api.ts:38` casts without validating [V]. Stale type/copy → F6. |

---

## 12. EVIDENCE

### 12.1 Files read in full or in relevant part [V]

| File | Key facts extracted |
|---|---|
| `server/src/routes/ingest.ts` (94 lines) | Upload handler `:14-52`; auth re-check `:16-20`; reads `req.body.file` `:22-23`; 400 guard `:25-28`; extension-less `tmpPath` `:30-33`; `fs.writeFileSync` `:34`; `ingestFile` call `:36-43`; `res.json(result)` `:44`; `finally unlinkSync` `:45-47`; catch→400 `:48-51`; `logger` imported `:7`; `/watch` `:56-92` |
| `server/src/app.ts` (63 lines) | `helmet()` `:32`; `express.json({limit:'1mb'})` `:33`; limiter `:35-41`; `/api/health` `:43-49`; `authMiddleware` before `ingestRouter` `:53`; `notFound` `:59`; `errorHandler` `:60` |
| `server/src/ingest/service.ts` (236 lines) | `DOC_KINDS` incl. pptx `:72-74`; `sha256File` `:88-98`; `storagePath = <hash><ext>` `:115-116`; **dedupe early-return** `:120-123`; **blob written `:126` before parse `:130`**; chunker opts `:135-139`; `storeDocument` `:144-154`; size re-derived `:148`; metadata merge `:151`; extract write after commit `:157`; result `:160-170`; `BEGIN` `:187`; INSERT `:189-202`; `$7::jsonb` `:191`; `RETURNING id` `:203`; `UNNEST` `:212`; `COMMIT` `:217`; `ROLLBACK` `:221`; singleton `:236` |
| `server/src/ingest/parsers.ts` (278 lines) | Registry `:188-227` (`txt,md,markdown,csv,json,xml,yaml,yml,log` `:191`; `html,htm` `:202`; `pdf` `:207`; `docx` `:211`; `xlsx` `:215`; **`pptx` `:219`**; images `:224`); `EXTENSION_TO_KIND` `:229-250` (`pptx:'pptx'` `:243`); `detectKind` `:252-255`; `isUnsupported` `:257-262`; `parseFile` — path-ext dispatch, **throws `Unsupported file type: .<ext>`** `:264-274` |
| `server/src/ingest/chunker.ts` (109 lines) | `safeOverlap` `:45`; empty text → `[]` `:54`; **synthetic id `chunk-<start>-<end>`** `:75` |
| `server/src/ingest/types.ts` | `Chunk` `:64-70`; `IngestionResult` 9 fields `:72-91`; `IngestionError` `:93-98` |
| `server/src/middleware/error.ts` | `notFound` 2 params `:3-5`; **`errorHandler(err,_req,res)` = 3 params** `:7-10` |
| `server/src/middleware/auth.ts` | 401 on missing/malformed header `:11-14`; 401 on invalid token `:20-22` |
| `server/src/db/schema.ts` | `documents` `:6-18` — **`sha256 TEXT NOT NULL`, no UNIQUE** `:12`; `status DEFAULT 'pending'` `:13`; `access_policy DEFAULT 'restricted'` `:14`; `chunks` `:20-28` with `ON DELETE CASCADE` `:22` |
| `server/src/config/index.ts` | `dotenv.config()` `:1-2`; `PORT 4000`/`HOST 127.0.0.1` `:5-6`; `ADMIN_USERNAME`/`ADMIN_PASSWORD` from env `:8-9` |
| `server/tsconfig.json` | `strict true` `:9`; **`esModuleInterop true`** `:10`; `skipLibCheck` `:11`; `include ["src/**/*.ts"]` `:17`; `exclude [node_modules,dist,**/*.test.ts]` `:18`; **no `types`/`typeRoots`** ⇒ `@types/multer` auto-included |
| `server/package.json` | scripts `:7-11`; deps `:12-26` (express `^4.19.2` `:18`); devDeps `:27-35`; `tsx ^4.16.0` `:33`; **no multer/busboy/formidable** |
| `server/node_modules/express/package.json` | `"version": "4.22.3"` `:4` — **installed Express is 4.22.3** |
| `web/src/lib/api.ts` | `fetch` `:24-28`; 401 → throw `:29-33`; `!res.ok` → `body.error` `:34-37`; cast-only `:38`; `ingestUpload` with stale `request<{status:string}>` `:64-68` |
| `web/src/app/dashboard/inbox/page.tsx` | drop filter `pdf\|docx?\|pptx?\|xlsx?\|txt\|md\|html?` `:13-15`; **response value ignored** `:22-25`; stale copy `:24`; appends under **`files`** `:33`; watch stub `:45` |

### 12.2 Commands run in this session (all read-only; nothing built, installed, started or written) [V]

| Command | Result |
|---|---|
| `ls -la .pipeline/phase1/` | `baseline.sha256`, `PLAN.md`, `REQUEST.md`, `REVIEW.md` |
| `ls -la server/data/` | `extracts/`, `uploads/` — **no `tmp/` yet** (this plan creates it) |
| `ls -la server/data/uploads/` | **empty** ⇒ real zero baseline for AC4/T12 |
| `grep -o '^[A-Z_]*' server/.env` | `PORT HOST DATABASE_URL ADMIN_USERNAME ADMIN_PASSWORD JWT_SECRET LOG_LEVEL` (names only; no values read or printed) |
| read `server/node_modules/express/package.json` | `4.22.3` |
| `npx tsc -p tsconfig.json --noEmit` (prior session) | **exit 0** |
| `sha256sum -c .pipeline/phase1/baseline.sha256` (prior session) | **27/27 OK** |
| psql read-only counts (prior session) | `documents=0, chunks=0, admins=1, audit_log=0` |

### 12.3 Things NOT verified (do not treat as facts)

- I did **not** execute an upload. The "always 400 today" claim follows from Express semantics (`express.json` skips non-JSON ⇒ `req.body` is `{}`) plus the guard at `ingest.ts:25-28`; confirm with one live curl before changing code.
- I did **not** install `multer`/`@types/multer`, start the server, or run any `INSERT`/`UPDATE`/`DELETE`.
- I did **not** verify `pdftotext` presence (Q5 → T0 probe).
- I did **not** touch `dist/` or anything under `web/`.
- Multer 2.x abort/sweep behaviour is taken from `REVIEW.md`'s reading of the library source [G]; S3b, T7 and T14 are the live checks that it holds.

### 12.4 Corrections to the brief

1. **PPTX is supported** — `DOC_KINDS` (`service.ts:72-74`), `PARSERS` (`parsers.ts:219`), `detectKind` (`parsers.ts:243`) [V]. No work needed.
2. The "parser factory not wired / parsing is stubbed" copy (`page.tsx:24,96-97`) is **stale** — `parsers.ts:188-227` is fully implemented [V]. The real failure is transport.
3. `middleware/error.ts:7`'s handler has **3 parameters**, so it is **not** an Express error handler; unhandled errors produce **HTML**, not JSON [V]. This plan therefore never relies on it — the upload mapper responds itself (§5.8).

---

## 13. FOLLOW-UPS (recorded, not implemented)

| ID | Follow-up | Why it is not in Phase 1 |
|---|---|---|
| **F1** | **Orphan-blob cleanup belongs to `ingestionService`, not the route.** `service.ts:126` writes `<storageDir>/<sha256><ext>` **before** `parseFile` at `:130`, so any parse failure leaves a blob with no row. The correct fix lives in the service: delete the blob it just wrote when parsing/storing fails, guarded by the same transaction (`BEGIN :187 … COMMIT :217`), ideally with a `UNIQUE` on `documents.sha256` (`schema.ts:12`). **A route-level guard cannot be made sound:** (a) the path is content-addressed and shared, so a concurrent ingest of the same bytes may be mid-transaction and invisible to any `select count(*)` (`:187-217`); (b) `documents.sha256` is **not UNIQUE**, so nothing serialises on it; (c) the dedupe early-return (`:120-123`) lets request B return a **success** for A's blob — deleting it under B turns a reported success into permanent byte loss plus a stuck dedupe; (d) any "read count, then delete" is inherently **TOCTOU**. Hence deletion is **removed** from this plan (revision 2): T9 *asserts the orphan blob exists* and T12 removes it by exact path. |
| **F2** | **`chunkIds` are synthetic, not row ids.** `chunker.ts:75` emits `chunk-<start>-<end>` and `service.ts:167` returns those; `chunks.id` (a UUID, `schema.ts:21`) is never returned. **Nothing may join on `chunkIds`.** Tests do not assert on their values (T3 asserts `chunkCount`; AC3 proves the rows via psql). |
| **F3** | **Dedupe `documentId` inconsistency.** First ingest returns a UUID (`RETURNING id`, `service.ts:203`); a re-upload returns the content hash (`:122`). And `documents.sha256` is not UNIQUE, so dedupe is filesystem-based, not DB-based: delete the blob and a re-upload creates a second row with the same `sha256`. |
| **F4** | **Write-after-commit hazard.** `storeDocument` commits at `service.ts:217`; the extract write happens afterwards at `:157`. If that write throws, the route reports an error while the document and chunks are already persisted (`status='pending'`). Pre-existing; a second reason route-level blob deletion would be wrong. |
| **F5** | **Legacy Office UX gap.** The UI drop filter accepts `doc/ppt/xls` (`page.tsx:14`), but `PARSERS` has no `.doc`/`.ppt`/`.xls` entry, so those files reach the server and 400 with `Unsupported file type: .doc`. Correct for this phase; the UI copy should list the real set. |
| **F6** | **`middleware/error.ts` is not an error handler** (3 params, `:7`; registered `app.ts:60`) ⇒ global unhandled errors render Express's HTML page. Also `api.ts:64-68`'s `request<{status:string}>` type is wrong and `page.tsx:24,96-97` copy is stale. Global fix + client typing are separate changes. |
| **F7** | **`body.kind` is an unvalidated override** — `kind: 'pdf'` on a `.txt` mislabels the row (existing behaviour, preserved). Optional future guard: require `detectKind(originalname) === body.kind`. |

---

*End of Phase 1 plan (revision round 1).*
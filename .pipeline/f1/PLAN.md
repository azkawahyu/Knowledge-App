# PLAN — F1: Blob Orphan Audit & Fix

PROJECT ROOT: `D:\Develop\knowledge-app`
PHASE: `f1-blob-orphan` — predecessor: Phase 1 (`FINAL_REVIEW: PASS`, F1 carried forward)
ROLE: PLANNER (audit + plan only — **no code modified, nothing installed, server not started, no DB writes, no deletions**)
DATE: 2026-10-28 (revision round 1, same date)
REVISION: **ROUND 1** — all 12 `REQUIRED REVISIONS` from `REVIEW.md:164-177` applied, plus the three orchestrator rulings (durability, `EEXIST` gating, no rename retry) and the non-blocking items that cost nothing.

Legend: **[V]** = verified by reading the code, or by a read-only command/probe run **in this session**. **[G]** = given (from `REQUEST.md` / Phase 1 artifacts / `REVIEW.md` findings and its recorded probes — not re-executed by me). **[U]** = UNCONFIRMED — could not be established by reading.

> Provenance discipline for this revision: four citations were wrong or loose in round 0 and are corrected below (R10). Everything carrying a `[V]` here was re-read or re-run before it was written. Measurements made by the independent reviewer are cited as `[G]` with its probe id (e.g. `[G: P2]`) and are **not** restated as `[V]`.

---

## 0. REVISION LOG — round 1

Disposition of each numbered required revision from `REVIEW.md:164-177`. "Section" = where the change lives in this document.

| Rn | Disposition | Section changed |
|---|---|---|
| **R1** | **Applied.** `.ingest-tmp-` is the single normative prefix; the round-0 table's bare `.tmp-` prefix (a typo) is gone; the prefix is defined **once** (§4.4) and referenced by name thereafter. | §4.2, §4.4, §5, §6.2 |
| **R2** | **Applied.** Normative order pinned as a numbered sequence: temp create+fsync → parse → chunk → `storeDocument()` resolves → `renameSync` → extract write. §4.3's parenthetical offering "after the extract write" is **deleted**, with the reason it was wrong (an extract failure would then remove the blob of a committed row). | §4.3, §4.4(3), §4.4(4) |
| **R3** | **Applied.** Phantom-COMMIT verification specified **inside `storeDocument`** (hoisted `documentId`, `committing` set before `COMMIT`, fresh pooled client, ≤2 s race, its own `finally { release() }`, present ⇒ `logger.warn` + return the id, absent/error ⇒ best-effort `ROLLBACK` + rethrow the **original** object). T6 split into **T6a** / **T6b**, both deterministic. | §4.4(6), §7.5 T6a/T6b, §5.2c, §9 R3 |
| **R4** | **Applied.** Startup/`.ingest-tmp-*` sweep **deleted** from §4.4 and from "Lines touched"; `service.ts:85` explicitly **unchanged**; no `sweepIngestTemp()` export; residue is report-only. | §4.4(9), §4.4 tail, §10 |
| **R5** | **Applied.** Harness re-specified as `server/src/**/*.test.ts` run with `npx tsx` (§7); **no test-framework mock/spy API is named anywhere in this document** (there is no framework to mock). Fault injection = in-process patching of `pg.Client.prototype.query` and `fs.*`. One process per DB configuration. The process-crash test row is gone (no production seam, Q4). | §7 (whole), §4.2, §11 |
| **R6** | **Applied.** Isolation rewritten: the factory isolates the **filesystem only** (`db/index.ts:6` is a module-level singleton); `DATABASE_URL` must be set **before import**, one process per config; `createdb` replaced by `CREATE SCHEMA f1test` + `search_path` via `options`; T4 runs in its own process; no `DELETE`/`TRUNCATE` against the user's tables ever; missing privileges ⇒ **BLOCKED**, not fallback. | §7.1–§7.3 |
| **R7** | **Applied.** T13 re-specified: the loser fails in `storeDocument` (spy throwing on the first `INSERT INTO documents`), the winner's `COMMIT` is **parked** so both callers demonstrably miss dedupe, the assertion is that the winner's `source_path` **exists**, and the test **fails closed** if fewer than two `INSERT INTO documents` attempts were observed. | §7.5 T13 |
| **R8** | **Applied.** T9 re-specified (no cleanup helper is exported ⇒ two consecutive `rmSync(force)` calls on the same absent temp path, **and** the fail-then-re-ingest sequence). T10 re-specified concretely (commit `<sha>.txt` from bytes X, re-ingest the same bytes as `<sha>.docx` where parse throws, assert `<sha>.txt` survives and the row is intact) and labelled a **guard against a revert to (A)**, not a proof of (B). | §7.5 T9, T10 |
| **R9** | **Applied.** Report spec completed: per-blob `sha256sum` vs filename prefix ⇒ `HASH_MISMATCH` (the O2 content check round 0 claimed but never shipped); `STALE_TMP` for `.ingest-tmp-*`; Q1–Q4 with **tab** separators (`-F $'\t'`) so a `name` containing `|` cannot shift fields; explicit read-only statement. | §6.1, §6.2 |
| **R10** | **Applied — four factual corrections.** `source_path` is `schema.ts:**10**` (9 is `kind`); "`minWords` … never used" → "never applied as a drop filter (used at `chunker.ts:**45**` for `safeOverlap`)"; `t04-t10.sh:86-92` is **not** an asserted contract (89-91 print `NOTE`, the single hard assertion is the documents delta at `:92`); `sweepUploaded()` is `routes/ingest.ts:**123-131**` (109-114 is `uploadedFiles`). Also tightened `types.ts:29-33` → `:29-34`. | §1.1, §1.2, §1.3, §3, §9 |
| **R11** | **Applied — §5 is now honest.** Adopted `fsync` before the rename (orchestrator ruling) **and** documented that the containing **directory is not fsynced** (not portable on Windows), so power loss can still lose the rename itself; `EPERM`/`EBUSY` rename failure named as a **non-crash** cause of the dangling row; the false "(A) also has this window" claim **deleted**; the dedupe-branch / O3-persistence statement added. | §5.1–§5.6, §4.3, §4.4(2) |
| **R12** | **Applied.** Taxonomy extended with **O10** (`.ingest-tmp-*` residue), **O11** (partial/corrupt extract), **O12** (non-zero blob whose bytes do not hash to its name), **O13** (stale/mismatched `source_path`); `/watch` unparseable-extension added to O1's causes; O1's detection claim corrected (`-f`, not `-d`). | §3 |

**Non-blocking items folded in (normative where it costs a predicate):**

| Item (from `REVIEW.md:181-189`) | Where | Disposition |
|---|---|---|
| `wx` + `EEXIST` must not unlink another caller's temp | §4.4(5) | **Normative.** Cleanup gated on `err.code !== 'EEXIST'`. |
| No `fsync` before the rename | §4.4(2), §5.3 | **Adopted**: `openSync/writeFileSync(fd)/fsyncSync/closeSync`, with the directory-fsync caveat stated. |
| No rename retry loop | §4.4(3), §9 R2 | **Normative.** No retry, no blocking sleep; distinct `rename_failed` warning + rethrow. |
| Verification path needs its own `finally { release() }` | §4.4(6) | **Normative**, spec'd inline. |
| `contentAddress()` / `toContentAddress()` are dead — do not "use" them | §4.4 note, §10 | Explicit "do not use" note. |
| `uplcount()` counts all files ⇒ Phase 1 echo lines inflate | §6.3, §9 R9 | Noted as cosmetic (an `echo`, not an assertion). |
| One affirmative detail, not a reviewer item | §4.4(5), §5.2b | Cleanup is **also** skipped when the failure came from `renameSync`: after a committed row the temp is the only copy of the bytes (`REVIEW.md:157`). One boolean. |

---

## 0.1 STATUS

**STATUS: READY_FOR_IMPLEMENTATION** (revision round 1 applied; no design question is open).

The audit is complete and every claim below is backed by a `file:line` citation or a read-only command. All seven round-0 questions are **ruled** and folded in (§11 records each ruling and where it landed). Nothing in the chosen option changed: the review confirmed Option **(B)** and returned "apply R1–R12 and implement".

**Working tree is untouched by this revision:**
- `sha256sum -c .pipeline/f1/baseline.sha256` → **30 `: OK`, 0 non-OK** [V: re-run in this session. `PLAN.md` is not a baseline member, so revising it cannot break the baseline].
- `cd server && npx tsc --noEmit` → **exit 0** [G: round-0 baseline; re-running it is part of the implementer's DoD, §7.3].
- DB read-only: `documents=0, chunks=0, admins=1, audit_log=0` [G]; `server/data/{uploads,extracts,tmp}` each `0` files [G].
- Ports 3000/4000 free [G]; no git repo (`.git` absent) [G] — "clean tree" is proven by the baseline hash, not `git status`.

**Scratch artefacts left behind (deliberate — no deletions permitted):** round-0 probe dirs under the OS temp dir (`/tmp/f1-probe-7332`, `/tmp/f1-probe2-32`, `/tmp/f1-probe2-15100`) plus `C:\Users\PC_DEV\AppData\Local\hermes\cache\scratch\{f1-probe.cjs,f1-chunk-probe.ts}`; the reviewer added `{f1rev-probe.cjs,f1rev-path.cjs}` and `%TEMP%\f1rev-*`. All outside the repo, listed for the user to remove (§10).

---

## 1. AUDIT TRACE — storage semantics as actually implemented

### 1.1 `ingestFile()` step by step (`server/src/ingest/service.ts`)

| # | Step | Code | What it actually does | Facts |
|---|---|---|---|---|
| 1 | Kind validation | `service.ts:109-111` | `if (!DOC_KINDS.includes(info.kind)) throw` — pure, no I/O. `DOC_KINDS` **includes `'other'`** (`service.ts:72-74`), so an unknown extension passes this gate. | [V] |
| 2 | Hash | `service.ts:114` → `sha256File()` at `service.ts:88-98` | Streams `fs.createReadStream(filePath)` into `createHash('sha256')`, resolves hex. Stream `'error'` → reject. **Reads the caller's path, not the stored blob.** | [V] |
| 3 | Paths | `service.ts:115-117` | `safeExt = path.extname(filePath).toLowerCase()` (**the temp file's** ext, not the original name); `storagePath = <storageDir>/<hash><ext>`; `extractPath = <extractDir>/<hash>.txt` — the extract key has **no extension**, so `.txt` and `.pdf` of identical bytes collide on one extract file. | [V] |
| 4 | **Dedupe check** | `service.ts:120-123` | `if (fs.existsSync(storagePath))` → logs `deduplicated`, **returns immediately**: `{ documentId: contentHash, contentHash, chunkCount: 0, chunkIds: [], textLength: 0, savedAt: new Date() }`. No DB read, no DB write, no extract write, and **no verification that a `documents` row exists**. `documentId` is the *sha256 hex*, not a UUID. | [V] |
| 5 | **Blob write** | `service.ts:126` | `fs.writeFileSync(storagePath, fs.readFileSync(filePath))` — **synchronous, in-place, non-atomic** (no temp+rename, no `flag`, no `fsync`). A 8 MiB `writeFileSync` completes fully in one call (`size=8388608, ms=3`) [G]. Because it is in-place at the final name, a reader can observe a partial file and a crash can leave a truncated one. Header comment: "Save raw bytes" *before* parse (`service.ts:4-8`). | [V] |
| 6 | Parse | `service.ts:130` | `await parseFile(filePath, …)` — parses the **temp file**, dispatches on `path.extname` (`parsers.ts:264-274`). Throws `Unsupported file type: .ext` when no parser matches (`parsers.ts:271`); otherwise delegates. | [V] |
| 7 | Chunk | `service.ts:135-141` | `createChunker({words:300, overlapWords:50, minWords:20}).splitIntoChunks(text, null, null)`. Probe of the real chunker: `''` → **0 chunks**, whitespace-only → **0**, `'[[Sheet1]]'` → **1**, 19 words → **1**, 20 words → **1** [G]. `minWords` is documented as a drop threshold (`chunker.ts:8`, `:29-34`) but is **never applied as a drop filter** — its only use is as an input to `safeOverlap` at **`chunker.ts:45`** (`Math.min(overlapWords, Math.max(0, words - minWords - 1))`), so no chunk is ever discarded for being short. `splitIntoChunks` is synchronous and, as written, cannot throw on any string input [V: body read at `chunker.ts:47-92`; only `replace/split/filter/slice/join/indexOf/Math.min` plus the `tokens.length === 0` early return]. | [V] |
| 8 | Transaction | `service.ts:144-154` → `storeDocument()` at `service.ts:174-226` | `pool.connect()` (`:185`) → `BEGIN` (`:187`) → `INSERT INTO documents … RETURNING id` (`:189-202`) → bulk `INSERT INTO chunks … SELECT * FROM UNNEST($1::uuid[],$2::text[])` **only if `chunkTexts.length > 0`** (`:206-215`, guard at `:210`) → `COMMIT` (`:217`) → info log (`:218`). `catch` → `ROLLBACK` with `.catch(()=>{})`, then rethrow the original error (`:220-222`). `finally` → `client.release()` (`:223-225`). **`documents.status` is never supplied**, so the column default `'pending'` applies; nothing ever updates it. | [V] |
| 9 | **Extract write** | `service.ts:157` | `fs.writeFileSync(extractPath, text)` — **after** the commit. A throw here propagates to the caller while the document + chunks are already committed. | [V] |
| 10 | Return | `service.ts:160-170` | `documentId: docId` (UUID), `chunkIds: chunks.map(c => c.id)` — the **synthetic `chunk-<start>-<end>` strings** from `chunker.ts:75`, *not* chunk row ids. | [V] |
| 11 | Caller | `routes/ingest.ts:202-235` | Per file: `try { ingestFile }` → `catch (fileErr) { errors.push({ file, error: (fileErr && fileErr.message) \|\| 'Ingestion failed' }) }` (`:219-227`) → `finally { fs.rmSync(file.path, { force: true }) }` (`:228-234`) — the **temp** is always swept, the **blob** never touched. All-fail → `400 { error: errors[0].error, errors }` (`:245`); mixed → `207` (`:241-243`); success → `200` (`:237-239`). Zero chunks → `logger.warn` only (`:212-217`). `/watch` calls the same service (`routes/ingest.ts:369`). | [V] |

**Order that matters:** `existsSync` → `writeFileSync` → `parseFile` → `chunk` → `BEGIN … COMMIT` → `writeFileSync(extract)`. **The blob is materialised three stages before the only commit point.**

### 1.2 What the DB schema guarantees and does not guarantee (`server/src/db/schema.ts`)

| Property | Reality | Cite |
|---|---|---|
| `documents.sha256` UNIQUE? | **No.** No `UNIQUE` on the column, no unique index. Live `\d documents` shows only `documents_pkey PRIMARY KEY btree (id)` and the inbound FK from `chunks`. | `schema.ts:12`; `\d documents` [G] |
| `documents.status` default | `TEXT NOT NULL DEFAULT 'pending'` — the insert never sets it, so every row is `'pending'` forever. | `schema.ts:13`; `service.ts:190-191` [V] |
| `documents.source_path` | Nullable `TEXT` — line **10** (line 9 is `kind`). The service stores the **absolute server-side `storagePath`** in it: the only DB→blob link. | **`schema.ts:10`**; `service.ts:147` [V] |
| `chunks → documents` | `document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE` — deleting a row removes its chunks; the cascade never reaches the filesystem. | `schema.ts:22` (`:20-28`) [V] |
| Chunks FTS index | `chunks_fts_idx` GIN on `to_tsvector('english', text)`. | `schema.ts:30-31` [V] |
| Transactionality | Only `documents` + `chunks` are in one transaction. **Filesystem writes are outside every transaction.** | `service.ts:187-217` [V] |
| Constraint against an empty document | None. Zero chunks is legal (the insert is skipped, `service.ts:210`). | [V] |
| Startup/periodic reconciliation | **None.** No code anywhere references orphan detection. | grep [G] |

**Net:** the DB guarantees "one row ⇒ its chunks exist" and "no chunk without a document". It guarantees **nothing** about the filesystem: no constraint ties `sha256` to a row, no constraint ties `source_path` to an existing file, and nothing prevents N rows sharing one `sha256`.

### 1.3 Who reads blobs and extracts

- `uploads/**`: no code path opens a blob after ingestion. `routes/library.ts:9` only selects `source_path` as display metadata; `search` reads `chunks`. So **an orphan blob is write-only garbage** today [G].
- `extracts/**`: only written at `service.ts:157`; **no reader exists anywhere in `src/`** (grep: `extracts` appears only in `service.ts` and `types.ts`) [G].
- `tmp/**`: written by multer (`routes/ingest.ts:62-76`), swept in a per-file `finally` (`:228-234`) and by `sweepUploaded()` (`:123-131`; `uploadedFiles()` is the separate helper at `:109-114`) [V].

---

## 2. FAILURE SCENARIOS

For each: what remains **on disk** and **in the DB**, with code evidence. "Blob" = `uploads/<sha><ext>`.

### S1 — Parse failure (corrupt-but-allowed file)
- Sequence: step 5 wrote the blob → step 6 throws (`ADM-ZIP: Invalid or unsupported zip format. No END header found` for `.docx`/`.pptx`).
- **Disk:** blob remains (nothing in `ingestFile` removes it; the route's `finally` removes only the temp, `routes/ingest.ts:230`).
- **DB:** no `documents` row, no `chunks` — `storeDocument` is never entered.
- **Extract:** none.
- **Evidence:** `service.ts:126` then `:130` [V]; throw text for `.docx` and `.pptx` [G: P7]; Phase 1 T9 observed `uploads delta=+1, documents delta=0` [G]; `TEST-REPORT.md:144-154` [G].
- **Second, cheaper repro (review gap 3):** `POST /watch` bypasses `ALLOWED_EXTS` — `routes/ingest.ts:339-375` accepts any `body.path`, `detectKind` (`parsers.ts:252-255`) returns `'other'` for an unknown extension (`EXTENSION_TO_KIND[ext] ?? 'other'`), `'other'` ∈ `DOC_KINDS` (`service.ts:72-74`) so the kind gate passes, the blob is written, and only then does `parseFile` throw `Unsupported file type: .rz` (`parsers.ts:264-274`) [V]. No multer temp is involved, so this is the file-free orphan repro.
- **Confirmed.** This is F1.

### S2 — Chunker throwing / returning zero chunks
- **Throwing:** `splitIntoChunks` is pure and total — `text` is a `string` by type (`ParseResult.text: string`, `types.ts:29-34`); the only early return is `tokens.length === 0 → []` (`chunker.ts:53-54`); no throwing call exists in the body. **I could not construct a throwing input.** Status: **no realistic throwing path — [V] that none exists as written; any future throw would behave exactly like S1** (temp left, no row, no content address after the fix).
- **Zero chunks — confirmed, and it does NOT create an orphan.** Probe: `parseFile('empty.txt')` → `textLen=0` → `chunks=0` [G]. Also reachable via a junk `.xlsx`: `XLSX.read` **does not throw** on `'not-a-zip'`; it returns `SheetNames=['Sheet1']` and the parser returns `text="[[Sheet1]]"` → 1 chunk [G: P7b].
- **Disk:** blob remains — but this is **not** an orphan, because…
- **DB:** a `documents` row **is committed** with `status='pending'`, `source_path=<blob>`, and **zero** `chunks` rows (`service.ts:210` skips the insert). The route only logs a warning (`routes/ingest.ts:212-217`) [V].
- **Consequence:** an *empty document* row — a different defect class (silent zero-content ingest), not a blob orphan. It also **permanently "blocks" re-ingest**, because the dedupe branch fires on the next attempt and returns `chunkCount: 0` and a non-UUID `documentId` (§3, O3).

### S3 — DB connect / `BEGIN` / `INSERT` failure inside the transaction
- **Connect failure:** `pool.connect()` at `service.ts:185` rejects **before** the `try` at `:186`, so no `BEGIN`, no `ROLLBACK`, no `release()` — the client is never acquired, so nothing leaks [V].
- **`BEGIN` / `INSERT documents` / `INSERT chunks` failure:** catch at `:220` → `ROLLBACK` (swallowed with `.catch(()=>{})`) → `throw err` → `finally { client.release() }` [V].
- **Disk:** blob remains today; a `.ingest-tmp-*` is removed after the fix (§4.4(5)).
- **DB:** nothing — the transaction is rolled back server-side. (Caveat: if the *connection* died, PostgreSQL aborts the implicit transaction anyway; either way no committed row.)
- **Extract:** none (step 9 not reached).
- **Confirmed.**

### S4 — `COMMIT` failure
- Code path: `await client.query('COMMIT')` at `service.ts:217` rejects → catch at `:220` runs `ROLLBACK` (likely rejects too, swallowed) → original error rethrown → `client.release()` [V].
- **Disk:** blob remains today. **Extract:** none.
- **DB:** the final state depends on *why* the commit failed, and it cannot be settled read-only:
  - Failure client-side (socket dropped before the server processed `COMMIT`) → PostgreSQL commits the implicit transaction when the backend terminates normally, i.e. **row + chunks are committed anyway** while the client is told it failed → **phantom success** (row exists, no extract, caller sees 400). This is O4's non-extract variant.
  - Failure server-side (`COMMIT` answered with an error, e.g. serialization/deferrable constraint) → **nothing committed**, outcome equals S3.
- **Round-1 consequence:** the ambiguity is **no longer a design decision**. `storeDocument` *verifies* the outcome with a read-only probe and only then decides whether the content address may be created (§4.4(6), T6a/T6b). The residual `[U]` is what `pg` does to the pooled client afterwards (§9 R11), not what the caller observes.

### S5 — Extract-write failure
- Step 9 at `service.ts:157` throws **after** COMMIT succeeded [V].
- **Disk:** committed row + blob at the content address (post-fix the blob is renamed into place **before** the extract write — §4.4(3)/(4)).
- **DB:** `documents` + `chunks` committed.
- **Extract:** absent, or **partially written** — `writeFileSync` is non-atomic, so a mid-write `ENOSPC`/close error leaves a truncated file (O11).
- **Caller** receives `400 {error: <fs message>}`; the route's outer comment (`:248-249`) anticipates DB errors, not this one. The upload is reported as failed **although it actually succeeded**, and the caller gets no id. On the next upload of the same bytes, dedupe short-circuits and returns `chunkCount: 0` + `documentId=<sha>`.
- **Confirmed** by reading; not executed.

### S6 — Process crash between blob write and COMMIT
- Crash (`SIGKILL`, power loss, OOM) between `service.ts:126` and `service.ts:217`. `finally`/`catch` never run.
- **Disk (today):** the blob — **full, partial, or zero-length**, depending on where the crash hit inside `writeFileSync`, at the *final* name [V: API semantics; the 8 MiB probe shows a single full-buffer operation once entered]. **Disk (post-fix):** a `.ingest-tmp-*`, possibly truncated, never at a content address.
- **DB:** nothing committed. **Extract:** none.
- **Dedupe poison (today):** the next upload of the same bytes hits `existsSync` → **dedupe short-circuit on a truncated blob**. The worst variant: unrecoverable without manual intervention and *silently reported as success*. Post-fix this cannot happen, because the dedupe key is never created before the row (§5.5).
- **Also:** a crash **after** COMMIT but before step 9 leaves the DB fine and only the extract missing.

### S7 — Concurrent identical ingests
Three sub-cases, all confirmed by code reading:

1. **Both start together (both miss dedupe).** Both evaluate `existsSync(storagePath) === false`, both write, both parse, both chunk, then **both INSERT** — `documents.sha256` has **no UNIQUE** (`schema.ts:12`) → **two rows**, two sets of chunks, **one blob**, one extract. Post-fix: two renames onto the same content address with identical bytes; a rename over a target another process holds **open** throws `EPERM` on this host [G: P2], which lands in the accepted dangling-row class of §5.2b. Dedupe is **advisory only** and race-loser rows are silently duplicated.
2. **One fails to parse, one succeeds.** Both check `existsSync` **before** either finishes. The bad case is the inverse ordering — A writes blob → A fails parse → B *starts after* the blob exists → **B dedupes off A's orphan**, gets `200` with `chunkCount: 0`, and **no row is ever created for those bytes**, permanently. Post-fix A leaves no content address, so B performs a full ingest (§5.5).
3. **Same bytes, different filenames / extensions.** `storagePath` includes the extension, so `a.txt` and `a.pdf` of identical bytes dedupe against **different** paths — two blobs and, if the parsers differ, different extract text. Not an orphan, but one sha256 can legitimately map to several blobs; with no extension at all (`safeExt === ''`) the blob is `uploads/<sha>` with no dot (handled by the report's `${f%%.*}` prefix rule, §6.2).

Nothing serialises these paths: no lock, no unique index, no `INSERT … ON CONFLICT`, no advisory lock [V]. Node is single-threaded but `ingestFile` is `async` and yields at `await parseFile` / `await pool.connect`, so two requests interleave freely at those points [V].

### S8 — Failures that create **no** orphan (so "three stages before commit" is not read as "every failure orphans")
- `sha256File()` rejecting (`service.ts:114`): no path computed yet, nothing on disk — the stream's `'error'` handler rejects (`service.ts:96`) [V].
- Kind-gate throw (`:109-111`): pure.
- `fs.readFileSync(filePath)` failing at `:126`: today the failure happens while evaluating the *argument*, before the target is opened, so no blob is created; post-fix `openSync('wx')` runs first, so an empty temp may exist and the cleanup removes it.
- **Extract-written-for-a-failed-ingest is unreachable today**: `writeFileSync(extractPath)` at `:157` is reached only after `storeDocument` resolved [V]. The only extract defects are the *partial* write (O11) and the orphan extract left after a later row deletion (O7).

---

## 3. ORPHAN TAXONOMY

Detection is expressed as the primitive that would find it; concrete commands are in §6.

| ID | Class | Cause (cite) | Detectability | Risk |
|---|---|---|---|---|
| **O1** | **Orphan blob, never referenced** — the core F1 defect | blob at `service.ts:126`, then failure at parse (`:130`), at store (`:144`), process death (`:126`–`:217`), **or `/watch` with an extension no parser handles** (`routes/ingest.ts:339-375` bypasses `ALLOWED_EXTS`; `detectKind` → `'other'`, `parsers.ts:252-255`; `'other'` ∈ `DOC_KINDS`, `service.ts:72-74`; `parseFile` throws, `parsers.ts:264-274`) — with no compensating delete anywhere | `uploads/` filename whose `<sha>` prefix has no `documents.sha256` (§6.2 `ORPHAN_BLOB`). The **inverse** check is §6.1 **Q2**, which tests `[ -f "$source_path" ]` per row and prints `MISSING_BLOB`; `-f` is correct here (a `source_path` resolving to a *directory* counts as missing; `-d` would not), but it says nothing about a row pointing into *another* directory (O13) | **Wasted bytes / unbounded disk**; **not** silent data loss by itself — but it is the trigger for O3, which *is* |
| **O2** | **Truncated / corrupt blob at the final content address** | in-place `writeFileSync:126` + crash/kill mid-write; power loss before a flush (no `fsync` today); operator copy/move | **Two checks, not one:** `-size 0` (`ZERO_LEN`) misses truncated-but-non-zero files, so the primary check is `sha256sum` per blob vs its filename prefix (§6.2 `HASH_MISMATCH`) | **Worst class, pre-fix.** Permanent, because O3 then short-circuits every retry; unrecoverable without an operator fixing the file. Post-fix: eliminated for process death (the address cannot exist before the row, and the bytes are `fsync`ed first); **not** eliminated for a volume that lies about flush (§5.3) |
| **O3** | **Stuck dedupe / permanent silent no-op** (the requested consequence) | dedupe keys on `existsSync(blob)` only (`service.ts:120-122`), never on a DB row | Same query as O1; plus: re-uploading the same bytes returns `200` with `chunkCount: 0` and a non-UUID `documentId` while the `documents` count is unchanged | **Silent data loss.** The user is told the upload succeeded; the document is permanently unindexable. The single most severe consequence of O1/O2 |
| **O4** | **Phantom success after extract failure** (and after a verified-but-thrown COMMIT, pre-fix) | `service.ts:157` throws after COMMIT | `documents.source_path` exists, blob exists, **no** `extracts/<sha>.txt`; caller logs show a 400 for a document that is in the DB | Confusing but recoverable: row and blob are valid; only the audit text is missing. Combined with O3 the user cannot re-ingest |
| **O5** | **Empty / zero-chunk document row** | `chunker` returns `[]` for empty/whitespace text (`chunker.ts:53-54`), chunk insert skipped (`service.ts:210`), route only warns (`routes/ingest.ts:212-217`) | `SELECT … FROM documents d WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.document_id = d.id)` (§6.1 Q3) | **Silent data loss** (a document the user believes is searchable is not), and it makes dedupe *look* broken. Most likely real-world trigger: junk `.xlsx` → 1 bogus chunk `"[[Sheet1]]"`; a genuinely empty `.txt` → 0 |
| **O6** | **Duplicate `documents` rows for one `sha256`** | no UNIQUE (`schema.ts:12`) + concurrent interleave (S7.1), or a re-upload that self-heals a dangling row (§5.2c) | `SELECT sha256, count(*) FROM documents GROUP BY 1 HAVING count(*) > 1` (§6.1 Q1) | Not a data loss; wastes rows/chunks and makes "which row is canonical" ambiguous. **Blocks the natural fix** of adding UNIQUE later |
| **O7** | **Orphan extract** | `service.ts:157` writes `<sha>.txt` keyed only by hash; the extract persists if the row is later deleted; `.txt`/`.pdf` of identical bytes share one extract path | `extracts/*.txt` whose `<sha>` has no `documents.sha256` (§6.2 `ORPHAN_EXTRACT`) | Wasted bytes only; **no current reader**, so risk is low (§1.3) |
| **O8** | **Unfinished/stale marker rows** — *not applicable*: Option (A)'s `status='ingesting'` marker is **not** adopted | would have been a `status` marker abandoned by a crash (§4.2 row (A)) | `SELECT * FROM documents WHERE status='ingesting'` — no such value is ever written | Retained only to record the class the rejected option would have created |
| **O9** | **Divergent `documentId` contract between fresh and deduped responses** | `service.ts:122` returns the sha as `documentId`; `service.ts:161` returns a UUID | Response inspection: 64 hex chars vs a 36-char UUID | Not a leak, but the *observable* symptom of O3, and it breaks clients keying on `documentId` (Phase 1 F3) [G] |
| **O10** | **`.ingest-tmp-*` residue** | hard kill mid-write/mid-`fsync`; a cleanup whose `rmSync` failed (`EPERM`/`EBUSY`); a **failed rename after COMMIT**, in which case the residue is the *only* copy of a committed document's bytes (§4.4(5), §5.2b) | `find uploads -maxdepth 1 -name '.ingest-tmp-*' -mmin +60` (§6.2 `STALE_TMP`), plus an any-age `INGEST_TMP` listing; the prefix is normative, so age is the only judgement | **Low for dedupe** (never at a content address, invisible to `existsSync(storagePath)`, never a document) — but **not low** in the rename-failure case, where deleting it destroys the only copy. Report-only; **no sweep** (Q6) |
| **O11** | **Partial / corrupt extract for a committed row** | non-atomic `writeFileSync:157` (mid-write `ENOSPC`, close error); `.txt`/`.pdf` of identical bytes share one `<sha>.txt` | **Not** detectable by the existence join — the row's sha *does* exist and the file is present. Would need a content/size comparison that nothing records | **Low** (no reader); reported, not fixed (Q7) |
| **O12** | **Blob whose bytes do not hash to its name (non-zero)** | power loss before a flush (no `fsync` pre-fix); volume cache loss; operator copy/move; an interrupted manual rename | `sha256sum <blob>` vs the filename prefix (§6.2 `HASH_MISMATCH`). This is O2's *real* detection case — `-size 0` finds only the degenerate variant | **High** — the blob at the content address is silently wrong, and every later dedupe hit returns `chunkCount: 0` for it. Post-fix: not reachable by this code (§5.3) |
| **O13** | **Row → stale `source_path`** (another directory, or a basename ≠ `<sha><ext>`) | data-dir move/rename; manual fix; a restore from another machine | §6.1 Q2 catches only the *missing* variant (`-f` on the stored string). A path that exists but is not `<storageDir>/<sha><ext>` is detected by **no** check in §6 — recorded here as a known report gap, not a defect to fix | **Low** — the file exists; dedupe keys on the computed path, so a stale row simply dedupes on a path nobody writes again |

**Explicitly on the requested "stuck dedupe" consequence:** an orphan blob from S1 (including the `/watch` variant), S3/S4/S6 makes a later legitimate upload of the **same bytes** a no-op — `service.ts:120-123` returns `200`, `chunkCount: 0`, `documentId = <sha256>`, and **no DB row is ever created**. Phase 1's T10 block reproduces the dedupe *shape*, but note precisely what it asserts: `t04-t10.sh:89`, `:90`, `:91` print `same documentId returned OK` / `chunkCount=0 OK` / `contentHash==documentId … OK` on success and only `NOTE …` otherwise, **without setting `FAILED=1`**; the single hard assertion in that block is the documents-delta test at `t04-t10.sh:92` [V]. So the harness *records* the dedupe contract but does not *fail* on a violation — which is why this plan's own tests, not Phase 1's, must prove the reply shape.

---

## 4. PROPOSED FIX

### 4.1 Constraint set
- Smallest change **inside `createIngestionService`** (no route change, no API change, no schema change without approval — REQUEST §Out of scope).
- Must never delete a blob a valid row references, including: two documents sharing one blob, and a concurrent ingest in flight.
- Must preserve the original error (same object, same message, same status) and be idempotent.

### 4.2 Options compared

| | **(A) Delete-on-failure for a blob *this call created*** | **(B) Write to a temp name, rename after COMMIT** | **(C) Reconciliation / GC with approval gate** |
|---|---|---|---|
| Shape | Track `let wroteBlob = false`; set `true` immediately after the write succeeds; wrap steps 6–9 in `try/catch`; on catch `if (wroteBlob && !deduped) try { fs.rmSync(storagePath, {force:true}) } catch { log }`; `throw err` | Write to `uploads/.ingest-tmp-<pid>-<rand><ext>`, `fs.renameSync(blobTmp, storagePath)` after COMMIT; unlink only `blobTmp` on failure | A read-only report (§6) + an approved delete tool run by a human |
| Orphan left on parse failure | **none** | none at a content address; on a hard kill only a `.ingest-tmp-*` (invisible to dedupe, never a document) | none until a human runs it |
| Concurrent identical ingests | **risk:** two callers both wrote; the failing one's `rmSync` removes the blob the *other* caller committed → **row with a missing blob** | **safe:** a failing caller never touches the final name; the second rename replaces identical bytes | n/a |
| Shared-blob safety (two documents, same bytes) | safe **only** if the "did I write it" guard is exact — a caller that took the dedupe branch must never delete | inherently safe (no code path unlinks a content address) | n/a |
| Process crash / kill | leaves an orphan at the content address | leaves only `.ingest-tmp-*` (never deduped against) | caught later |
| Race with a *future* reader of the blob | fine (no readers today) | fine | fine |
| Size of change | ~10 lines in `service.ts` | ~25 lines in `service.ts` (temp create + `fsync` + `renameSync` + gated cleanup + post-COMMIT verification) | new script + human process |
| Testability | easy BUT the concurrency test is inherently racy | deterministic via in-process patching (§7.4) | manual |
| Preserves original error | yes (`throw err` after a swallowed cleanup) | yes (same object; cleanup cannot mask) | n/a |
| Fit with acceptance criteria | passes 1,3,4; **fails 3 under concurrency in the worst interleaving** | passes 1,3,4 with **no new race** | doesn't meet AC1 within the ingestion attempt |

### 4.3 Decision: **(B) — temp name + `fsync`, atomic rename to the content address after COMMIT**

Rationale: (B) obtains the same benefit as (A) for the *dominant* failure modes (parse failure, DB failure, chunker issues) and **removes the one dangerous window in (A)** — deleting a blob another request may have just committed. With (B) the content address is created by **exactly one** `renameSync`, which runs **only after** `storeDocument()` has resolved (a verified `COMMIT`) and therefore **before** the extract write. Nothing is ever deleted on the failure path except a temp file this call created, so Criterion 3 holds **by construction**, not by a guard that can be got wrong.

Two precision notes the round-0 text got wrong or omitted:

- The rename is **before** the extract write, full stop. (Round 0 offered "after the extract write" as an option; that is retracted — renaming after the extract converts every extract failure, i.e. the EISDIR case in T7 and the most common S5 trigger, into a committed row whose blob was then removed: the dangling-row defect on its most frequent trigger.)
- "A blob at the content-address path means the write completed" is true **for process death**, and true **for power loss only because of the `fsync` in §4.4(2)** — and even then the *rename* itself is not durable, because the containing directory is not `fsync`ed on this platform (§5.3).

**(A) is rejected** because its correctness depends on a boolean that distinguishes "wrote" from "didn't write", not "wrote and am the only participant". Under two concurrent identical ingests both can write; the failing one's `rmSync` destroys the winner's blob and the winner's row then points at a missing file — a **worse** defect than the orphan it fixes (silent data loss with a DB row present, vs. wasted bytes).

**(C) is retained as a complement, not as the fix** — see §6. It is required anyway for pre-existing orphans and for residues (B) cannot cover.

### 4.4 Exact specification of the chosen fix (B)

**The one normative knob.** The temp prefix is `.ingest-tmp-` — a dotted prefix inside `storageDir`, defined **once** here and referenced by that name everywhere else (§2, §5, §6.2, §9):

```
const TMP_PREFIX = '.ingest-tmp-';                     // inside storageDir, never elsewhere
blobTmp = path.join(storageDir,
  `${TMP_PREFIX}${process.pid}-${randomBytes(8).toString('hex')}${safeExt}`);
```
`randomBytes` is already imported at `service.ts:14` [V]. `storagePath` and `blobTmp` share a directory **by construction**, so `renameSync` is same-volume and cannot raise `EXDEV`.

**Normative step order (this is the whole fix; every numbered item below refers to it):**

```
1  dedupe check            (unchanged, service.ts:120-123)
2  create+fsync temp blob  (replaces service.ts:126)
3  parse                   (unchanged, service.ts:130, on the CALLER's path)
4  chunk                   (unchanged, service.ts:135-141)
5  storeDocument()         (gains the post-COMMIT verification, item 6)
6  renameSync(tmp → storagePath)      <-- the ONLY writer of a content address
7  extract write           (unchanged, service.ts:157)
```

1. **Dedupe check stays exactly where it is** (`service.ts:120-123`), keyed on `existsSync(storagePath)` — unchanged, so dedupe semantics and the pre-existing response contract are untouched (what that costs is stated in §5.5).
2. **Replace `service.ts:126`** with a durable temp write:
   ```
   const bytes = fs.readFileSync(filePath);          // source unchanged
   const fd = fs.openSync(blobTmp, 'wx');            // 'wx' => never clobber a colliding name
   try {
     fs.writeFileSync(fd, bytes);
     fs.fsyncSync(fd);                               // bytes durable BEFORE the address exists
   } finally {
     fs.closeSync(fd);                               // closes even if write/fsync threw
   }
   ```
   `'wx'` makes a (2^-64) name collision loud instead of clobbering. The log line at `:127` becomes `[ingest] saved: ${blobTmp}` — the printed path changes; nothing in the repo or the Phase-1 harness greps it [G].
3. **`renameSync` — pinned step 6.** `fs.renameSync(blobTmp, storagePath)` runs **after `storeDocument()` resolves** and **before** the extract write, wrapped so the failure is distinguishable:
   ```
   renameAttempted = true;                            // set immediately BEFORE the call
   try { fs.renameSync(blobTmp, storagePath); }
   catch (renameErr) {
     logger.warn('[ingest] rename_failed', { blobTmp, storagePath, err: String(renameErr) });
     throw renameErr;                                // original object, no retry
   }
   ```
   **No retry loop** (reviewer's preference): a synchronous backoff needs a blocking sleep inside a sync function and stalls the event loop. A rename failure is a real, reportable state (§5.2b), not something to paper over.
4. **Extract write** (step 7, `service.ts:157`) stays **after** the rename and is unchanged. If it throws, the caller sees the error while the document, its chunks and its blob are all in place — S5 keeps its current shape. Extract semantics are deliberately not changed (no reader exists; out of scope; Q7).
5. **Failure path — one `catch`, three predicates, original error preserved.** One `try` spans steps 2–7. In the catch:
   ```
   } catch (err) {
     const code = (err as NodeJS.ErrnoException).code;
     const preserved = renameAttempted || code === 'EEXIST';
     if (!preserved) {
       try { fs.rmSync(blobTmp, { force: true }); }
       catch (cleanupErr) {
         logger.warn('[ingest] temp blob cleanup failed', { blobTmp, err: String(cleanupErr) });
       }
     }
     throw err;                                       // the SAME object; message byte-identical
   }
   ```
   - **`EEXIST` is never cleaned up** (non-blocking item, now normative): `EEXIST` can only come from `openSync(...,'wx')`, which means *this call did not create the file* — it is another caller's live temp. Unlinking it would delete someone else's in-flight data.
   - **`renameAttempted` is never cleaned up** (affirmative detail required by §5.2b / `REVIEW.md:157`): once the row is committed, `blobTmp` is the **only** on-disk copy of that document's bytes. Deleting it converts a repairable state into an unrecoverable one; the residue is reported as `STALE_TMP` with its hash so an operator can rename it by hand. If the rename *succeeded*, the predicate is a harmless no-op: `blobTmp` no longer exists and `rmSync(force)` on an absent path is silent [G: P6].
   - **Cleanup failure cannot mask:** swallowed + `logger.warn`, then the original `err` is rethrown. Same object ⇒ `fileErr.message` at `routes/ingest.ts:226` and `err.message` at `:373` stay byte-identical, and so does the 400 body (`errors[0].error`, `:245`).
   - **`force: true`** makes an absent temp a silent success, so repeated cleanup is trivially idempotent [G: P6].
6. **Post-COMMIT verification inside `storeDocument` (R3 — the Q3 ruling, in its implementable shape).** The round-0 proposal ("`SELECT 1` on a COMMIT throw", at the `ingestFile` level) was unimplementable: `storeDocument` throws, so the id at `service.ts:203` never escapes. Required shape, inside `storeDocument`:
   ```
   const client = await pool.connect();        // :185 stays OUTSIDE the try (unchanged)
   let documentId: string | undefined;         // hoisted from :203
   let committing = false;                     // set immediately before COMMIT
   try {
     await client.query('BEGIN');
     const docResult = await client.query(INSERT_DOCUMENTS);
     documentId = docResult.rows[0].id;        // was `const` at :203
     ...chunk insert (:206-215, unchanged)...
     committing = true;                        // <-- BEFORE the COMMIT
     await client.query('COMMIT');
     logger.info(`[db] stored document ${documentId} with ${params.chunkTexts.length} chunks`);
     return documentId;
   } catch (err) {
     if (committing && documentId && await verifyCommitted(documentId)) {
       logger.warn('[db] COMMIT threw but the row is present; treating as committed', { documentId });
       return documentId;                      // no ROLLBACK: the transaction is known-committed
     }
     await client.query('ROLLBACK').catch(() => {});
     throw err;                                // the ORIGINAL object, unchanged
   } finally {
     client.release();                         // :223-225, unchanged
   }
   ```
   and the probe itself, which **must not** repeat the `connect()`-outside-`try` shape (non-blocking item):
   ```
   async function verifyCommitted(id: string): Promise<boolean> {
     const probe = (async () => {
       const c = await pool.connect();         // FRESH client from the pool
       try   { const r = await c.query('SELECT 1 FROM documents WHERE id = $1', [id]);
               return r.rowCount === 1; }
       finally { c.release(); }                // its own finally, always
     })();
     const timeout = new Promise<boolean>((res) => setTimeout(() => res(false), 2000));
     return await Promise.race([probe, timeout]).catch(() => false);   // fail-closed => "absent"
   }
   ```
   Semantics, verbatim from the ruling:
   - **present** ⇒ `logger.warn` + **return the id**. The row exists and the chunks exist by transaction atomicity; telling the caller "failed" is the S5/O4 trap. `ingestFile` then renames and returns normally, so the content address is created and the caller receives a real UUID.
   - **absent, threw, or timed out (≤2 s)** ⇒ best-effort `ROLLBACK` + rethrow the **original** error object. The bound matters: `pg`'s pool has no default acquire timeout, so an unbounded wait on an error path is a hang [G: Q3].
   - The abandoned `probe` promise is not cancelled; if its `connect()` resolves later it still releases in its `finally`, so no client leaks. (Optional hardening: `.unref()` the timer.)
7. **What happens on concurrent identical ingests.** Both callers write **distinct** temp names (different random suffix). Both parse, both chunk, **both may commit a row** (no UNIQUE — unchanged, §5.4). Each renames its temp → the same `storagePath`; the second rename replaces it with byte-identical content, observationally a no-op — *except* that renaming over a target another process has **open** throws `EPERM` on this host [G: P2], which is the accepted non-crash dangling-row case (§5.2b), not a silent corruption. If one caller fails, it deletes **only its own temp**; the winner's rename is unaffected. **No interleaving can unlink a content address.**
8. **Idempotency.** Running the cleanup twice, or after a crash, is safe: (i) `rmSync(force)` on a missing path is a no-op [G: P6], while plain `unlinkSync` throws `ENOENT` [G: P6b]; (ii) the cleanup never names `storagePath`; (iii) a re-ingest of the same bytes after a failed attempt finds no `storagePath`, misses dedupe, and does a full ingest — the retry does the right thing, which is exactly what the current code does **not** do (§5.5).
9. **No startup sweep. No marker rows. No new exported API.** `.ingest-tmp-*` residue is **report-only** this phase (Q6): a sweep in the factory body would run on import of the module-level singleton (`service.ts:236`) in *every* process — including tests — and would therefore scan and delete inside the real `server/data/uploads`; and an age-only sweep would delete the only copy of a committed document's bytes after a rename failure. `ensureDir(storageDir)` at `service.ts:85` is **unchanged**.

**Lines touched (final, no other file):** `service.ts:126` (write target → temp + `fsync`), `service.ts:127` (log target), one `try/catch` spanning `:126`–`:157`, one `renameSync` immediately before `:157`, and inside `storeDocument` the hoist of `documentId` (`:203`), the `committing` flag before `:217`, the verification branch in the catch (`:220-222`), plus a module-private `verifyCommitted` helper. **`service.ts:85` does not change.** The export at `:228-233` does not change. The `StoreOptions` interface (`:40-56`) does not change — in particular **no `_testHooks`** (Q4).

**Do not use the dead helpers.** `contentAddress()` (`service.ts:100-103`) and `toContentAddress()` (`hash.ts:17`) are unused and have *different* semantics (path+ext hash vs filename hash, both suffixed with `-<size>`); neither is a content address in the sense of `<sha256-of-bytes><ext>`. The fix must not "reuse" them, and must not delete them in this phase.

---

## 5. GUARANTEES / LIMITS — what this fix does **not** guarantee

1. **A hard kill before the rename leaves a file on disk** — now a `.ingest-tmp-*`, not a content-addressed blob. It wastes bytes but **cannot poison dedupe** (the dedupe key is `storagePath`, which has no prefix) and cannot be mistaken for a document. Nothing removes it automatically: no sweep this phase (Q6); `STALE_TMP` in §6.2 is its only detector.
2. **A committed row can exist with no blob at `source_path`** (accepted, Q2). Three distinct causes, only the first of which is a crash:
   - **(a) crash/kill between `COMMIT` and `renameSync`** — the narrow window.
   - **(b) `renameSync` failure after `COMMIT`** — a **non-crash** cause and, per measurement, the much likelier one: renaming over a target another process has **open** throws `EPERM` on this host [G: P2], and `EBUSY` is the equivalent Windows sharing violation. Consequence: committed row, no blob, and a `.ingest-tmp-*` holding the only copy of the bytes (deliberately preserved, §4.4(5)). Reported as `MISSING_BLOB` (Q2) + `STALE_TMP`.
   - **(c) phantom COMMIT** — *now handled, not tolerated*: §4.4(6) verifies the row and, when present, completes the rename, so this cause no longer yields a dangling row. It survives only if the verification query itself fails, in which case the outcome equals (a).
   This direction is accepted because it is the only failure direction that **self-heals**: `existsSync` misses, so a re-upload performs a full ingest and recreates the blob; whereas blob-without-row permanently converts every retry into a silent no-op (O3). **Honesty about the residual:** self-healing recreates the blob and inserts a **second row for the same sha** (O6) — it heals the *blob* and leaves a duplicate, so "self-healing" is not "consistent". Detector: §6.1 **Q2** (`MISSING_BLOB`), per row.
   **This window is not shared with option (A).** (A) writes the blob *before* the commit and never unlinks a content address on the success path, so (A) has **no** committed-row-without-blob window at all; its defect is the opposite one (blob-without-row) plus the concurrency hazard of §4.3. (The round-0 sentence claiming "(A's window is the same segment)" was false and is deleted.)
3. **Durability is now explicit, and still bounded.** §4.4(2) `fsync`s the temp file **before** the address exists, so the bytes behind a content address are on stable storage before the rename can place the address. What is **not** `fsync`ed is the containing **directory** — there is no portable directory fsync on Windows (opening a directory as a file and flushing it is not supported the way it is on POSIX). So a power loss can still **lose the rename itself**: the row commits, the blob is absent. That is case 2(a) — the detectable, self-healing direction — **not** a truncated blob at the address. Beyond fsync's contract, if the volume's device cache ignores flush barriers, even that is not guaranteed; that is a hardware caveat, recorded rather than claimed away.
4. **No UNIQUE on `documents.sha256`.** Concurrent identical ingests can still commit **two rows** sharing one blob (S7.1). Out of scope per REQUEST (schema change needs approval); **detectable** (§6.1 Q1) and harmless for search. Recommendation: defer to a phase that may touch the schema.
5. **The dedupe branch is untouched — so O3 persists for every blob the new code did not create.** `service.ts:120-123` is not modified: any **pre-existing** orphan blob, and any blob placed in `uploads/` by another tool or by hand, still short-circuits a legitimate upload into `200 / chunkCount: 0 / documentId=<sha>` with no row. The fix cures O3 **only** for blobs created by this code path after the change (plus, per §5.2, the dangling-row case after a re-upload). Treat "O3 eliminated" as scoped to new failures — pre-existing orphans need the report plus an approved cleanup.
6. **A second server process** (e.g. `tsx src/index.ts` on :4000 plus `node dist/index.js` on :3000) still races: both can pass the dedupe check and both commit. (B) keeps the *filesystem* safe under that race but cannot make the *DB* single-insert. A concurrent second rename can produce the `EPERM` dangling row of §5.2b.
7. **Nothing prevents a *human* or another tool from deleting `uploads/**`.** (B) adds no referential integrity; there is no FK from the filesystem to the DB.
8. **Orphans created before the fix are untouched** — report-only (§8); deleting any of them requires a separate approved plan.
9. **The extract file remains non-transactional** — a crash after the rename but in the middle of `writeFileSync(extractPath)` leaves a partial extract with a valid row and blob (O4/O11). Out of scope (Q7); no reader exists.
10. **`documents.status='pending'` forever** and `chunkIds` being synthetic `chunk-<start>-<end>` strings are **unchanged** (Phase 1 F3) [G], as is `documentId` being the sha in the dedupe branch (O9).
11. **The temp name is not secret and is not scanned.** Nothing in `src/` enumerates `storageDir` [G], so a `.ingest-tmp-*` file is invisible to every code path — including dedupe. Only the report (§6.2) sees it.

---

## 6. ORPHAN REPORT MECHANISM (REPORT, never DELETE)

All commands are **read-only**: `find`, `stat`, `printf`, `grep`, `sha256sum`, `psql -c SELECT`. No `rm`. No `DELETE`/`TRUNCATE`/`UPDATE`. No writes anywhere. Tooling paths follow the repo's own convention (`lib.sh:14-15`) [V].

### 6.1 DB-side checks (psql, read-only)

Field separator is a **tab** (`-A -t -F $'\t'`): `documents.name` is user-supplied and may contain `|`, spaces or a newline, so pipe-splitting is unsafe (R9). A name containing a newline would still break a line-oriented read — that is the known limit; the upgrade path is a `row_to_json` one-liner, noted rather than needed.

```bash
PSQL="${F1_PSQL:-D:/Install/PostgreSQL/18/bin/psql.exe}"
PGARGS="${F1_PGARGS:--h 127.0.0.1 -p 5432 -U knowledge_app -d knowledge_app}"

# Q1 — duplicated sha256 (O6). Any row here means "one blob, several documents".
"$PSQL" $PGARGS -c "SELECT sha256, count(*) AS docs, string_agg(name, ' | ') AS names
                      FROM documents GROUP BY sha256 HAVING count(*) > 1 ORDER BY docs DESC;"

# Q2 — rows whose blob is MISSING on disk (dangling source_path; §5.2 a/b).
#      Tab-separated so a name containing '|' cannot shift fields.
"$PSQL" $PGARGS -At -F $'\t' -c "SELECT id, name, sha256, source_path FROM documents ORDER BY created_at;" \
 | while IFS=$'\t' read -r id name sha src; do
     [ -f "$src" ] || printf 'MISSING_BLOB\t%s\t%s\t%s\t%s\n' "$id" "$name" "$sha" "${src:-<null>}";
   done

# Q3 — committed empty documents (O5): zero chunks.
"$PSQL" $PGARGS -c "SELECT d.id, d.name, d.sha256, d.created_at
                      FROM documents d
                     WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.document_id = d.id)
                     ORDER BY d.created_at;"

# Q4 — rows still 'pending' (informational: every row is, today).
"$PSQL" $PGARGS -Atc "SELECT count(*) FROM documents WHERE status = 'pending';"
```

Notes: Q2 tests `-f` on the **stored string**, which is a `path.join`-produced native path (`D:\…\uploads\<sha><ext>`) — `[ -f "D:\…" ]` works in this shell [G: reviewer probe]. `-f` is deliberately used rather than `-d`: a `source_path` resolving to a *directory* must count as missing. Q2 says nothing about a `source_path` that exists but lives in another directory (O13) — that gap is recorded in §3, not papered over.

### 6.2 FS→DB check: the orphan-blob report (O1/O2/O7/O10/O12) — **the deliverable**

Save as `D:\Develop\knowledge-app\.pipeline\f1\orphans.sh` (pipeline dir, **not** `src/`). Data dir and psql target are overridable (T14 points them at a scratch dir + the `f1test` schema); defaults are the real ones.

```bash
#!/usr/bin/env bash
# REPORT ONLY. Lists orphan blob / corrupt blob / stale temp / orphan extract candidates.
# Deletes nothing. Read-only: find/stat/printf/grep/sha256sum + SELECT.
set -u
ROOT="${F1_ROOT:-D:/Develop/knowledge-app}"
DB="${F1_DATA_DIR:-$ROOT/server/data}"
UP="$DB/uploads"; EX="$DB/extracts"; TMP="$DB/tmp"
PSQL="${F1_PSQL:-D:/Install/PostgreSQL/18/bin/psql.exe}"
PGARGS="${F1_PGARGS:--h 127.0.0.1 -p 5432 -U knowledge_app -d knowledge_app}"
AGE="${F1_TMP_AGE_MIN:-60}"

HASHES=$("$PSQL" $PGARGS -Atc "SELECT DISTINCT sha256 FROM documents;" 2>/dev/null)
in_db () { printf '%s' "$HASHES" | grep -qxF -- "$1"; }

echo "== blobs: orphan (O1) and content-address mismatch (O2/O12) =="
find "$UP" -maxdepth 1 -type f ! -name '.ingest-tmp-*' -printf '%f\n' 2>/dev/null \
 | while read -r f; do
     [ -n "$f" ] || continue
     sha="${f%%.*}"                                   # correct with or without an extension
     got=$(sha256sum "$UP/$f" | cut -d' ' -f1)
     [ "$got" = "$sha" ] || printf 'HASH_MISMATCH\t%s\t%s\t%s\n' "$f" "$sha" "$got"
     in_db "$sha" || printf 'ORPHAN_BLOB\t%s\t%s\t%s\n' "$sha" "$(stat -c %s "$UP/$f")" "$UP/$f"
   done

echo "== zero-length blobs (O2, degenerate case) =="
find "$UP" -maxdepth 1 -type f -size 0 ! -name '.ingest-tmp-*' \
     -printf 'ZERO_LEN\t%f\n' 2>/dev/null

echo "== stale ingest temp files (O10) =="
find "$UP" -maxdepth 1 -type f -name '.ingest-tmp-*' -mmin +"$AGE" \
     -printf 'STALE_TMP\t%f\t%s\n' 2>/dev/null
echo "== all ingest temp files, any age (O10, informational) =="
find "$UP" -maxdepth 1 -type f -name '.ingest-tmp-*' -printf 'INGEST_TMP\t%f\t%s\n' 2>/dev/null

echo "== orphan extracts (O7) =="
find "$EX" -maxdepth 1 -type f -name '*.txt' -printf '%f\n' 2>/dev/null \
 | while read -r f; do
     [ -n "$f" ] || continue
     sha="${f%.txt}"
     in_db "$sha" || printf 'ORPHAN_EXTRACT\t%s\t%s\n' "$sha" "$EX/$f"
   done

echo "== leftover multer temp files (route tmp, not this fix's class) =="
find "$TMP" -maxdepth 1 -type f -name 'tmp-*' -printf 'LEFTOVER_UPLOAD_TMP\t%f\t%s\n' 2>/dev/null
```

Implementer notes:
- Every record is **tab-separated** with a leading token, so `awk -F'\t'` / `cut -f2` is safe on a name containing `|`. Paths are printed last and unescaped; a path containing a tab would still be ambiguous, which is acceptable because a blob's `%f` is `<sha><ext>` and cannot contain one. (Round 0 used `printf %q` and a `|`-delimited Q2 loop; both are replaced.)
- `HASH_MISMATCH` is the O2/O12 check round 0 *claimed* but did not ship: `-size 0` finds only the degenerate variant. Every non-temp blob is hashed — bounded by the document count, fine at this scale.
- `-printf` is GNU `find`; this is Git-Bash/MSYS on Windows where GNU find is the default, and `sha256sum` / `stat -c` / `-printf` all work here [G: reviewer probes; `lib.sh:31` already shells out to `sha256sum`] [V].
- Empty DB ⇒ `in_db` returns false for everything ⇒ every blob is reported as an orphan. Intended (`grep -qxF` with an empty pattern list exits 1) [G: reviewer probe].
- Exit code is always 0 — a report, not a gate. A CI gate could grep the tokens and fail **without deleting**.
- The script must be marked REPORT-ONLY in its header, and the pipeline must require explicit user approval before any deletion of anything it lists (§8).

### 6.3 Phase-1 harness equivalent (already exists, do not duplicate)
`lib.sh` provides `uplcount()` and `tmpcount()` (`lib.sh:28-30`) [V]; the report supersedes them for orphan detection because it joins against `documents.sha256`. Note `uplcount()` counts **every** file in `uploads/` (`lib.sh:30` = `find … -type f | wc -l`) [V], so a leftover `.ingest-tmp-*` would inflate Phase 1's `uploads delta` line — an `echo` at `t04-t10.sh:69`, not an assertion — so it is cosmetic and cannot fail the suite.

---

## 7. TEST STRATEGY

**There is no test framework in this repo and none may be added.** `package.json` `devDependencies` are exactly the six `@types/*` packages plus `tsx` and `typescript` [V] — no test runner, no assertion library, no mocking library. Nothing in this document names a framework API to call, and the implementer must not add one: the tests are plain `tsx` scripts.

### 7.1 Harness (the one that actually exists)

| Aspect | Decision |
|---|---|
| Test files | `server/src/**/*.test.ts` — e.g. `src/ingest/service.f1.db.test.ts`, `src/ingest/service.f1.connect.test.ts`. Matches the existing `tsconfig.json:18` exclude (`"**/*.test.ts"`) [V], so `npx tsc --noEmit` stays green and nothing ships in `dist`. |
| Runner | `npx tsx <file>` — `tsx` is a devDependency and `npm run dev` already uses it (`package.json:10`) [V]. Each file is a plain script with a ~15-line local `assert`/`eq`/`count` helper and a pass/fail tally; **no framework**. |
| Result contract | Each file prints `PASS <name>` / `FAIL <name>: <detail>` and a final `RESULT: n passed, m failed`, exiting `1` if `m > 0` — or `2` with `BLOCKED: <reason>` when a required privilege is unavailable (§7.2). A skipped test that is not explicitly BLOCKED counts as a failure. |
| Fault injection | **In-process patching**, saved and restored in `finally`: `pg.Client.prototype.query` (BEGIN/INSERT/COMMIT/ROLLBACK/SELECT), `fs.writeFileSync`, `fs.renameSync`, `fs.rmSync`. Works because `service.ts:12` does `import * as fs from 'fs'` under `module: commonjs` + `esModuleInterop` (`tsconfig.json:4,10`) [V], which binds namespace members lazily at call time, and because `pg`'s `Client` defines `query` on the prototype [G: Q4]. |
| Anti-vacuity rule | Any test that arms a fault **must assert the fault fired**. If the injected throw never occurred, the test **fails** (`fault did not fire`) instead of passing on the unpatched path. Patches are per-test and restored in `finally`, so they cannot leak between tests. |
| Process model | **One process per DB configuration.** Two files, two invocations. Never set `DATABASE_URL` inside a test body — the pool is built at import. |
| Not tested | No process-crash test (Q4: it needs a production seam, which is rejected). Crash behaviour is covered by §6.2 (`STALE_TMP`, `ZERO_LEN`) plus filesystem evidence. |

### 7.2 Isolation (corrected — R6)

**The factory isolates the filesystem only.** `createIngestionService({storageDir, extractDir})` (`service.ts:64-69`) rebinds the two directories [V]; the database is *not* parameterised: `export const pool = new Pool({connectionString: config.DATABASE_URL})` (`db/index.ts:6`) is a **module-level singleton built at import** [V], and `config` reads `process.env` once at import (`config/index.ts:1-7`) [V]. `dotenv.config()` (`config/index.ts:2`) does **not** override an already-set variable, so the environment must be correct **before the first import of anything that pulls in `../db`**.

| Mechanism | How | Why it is safe |
|---|---|---|
| **Own schema, not a new DB** | `psql -c "CREATE SCHEMA IF NOT EXISTS f1test"` (additive DDL), then `DATABASE_URL=…?options=-c%20search_path%3Df1test` so every unqualified table resolves inside `f1test`. `createdb` is **not** available to this role — `rolsuper=f, rolcreatedb=f`, `has_database_privilege(CREATE)=t` [G: REVIEW evidence] — so schema creation is the only permitted route. | The user's `public` tables are never named by the tests. |
| **Schema guard (fail-closed; *order corrected in R2 review*)** | First DB action: assert `SELECT current_schema()` = `f1test` — an existing-but-empty `f1test` passes; a wrong `options` string yields `public`/NULL and BLOCKs. **Then** `initSchema(pool)`. **Then** assert `SELECT count(*) FROM information_schema.tables WHERE table_schema='f1test' AND table_name='documents'` = 1 and `to_regclass('documents') IS NOT NULL`. (The count **must** be `table_schema`-filtered and **must** run after bootstrap: round 1's order — unfiltered `LIMIT 1`, before `initSchema` — BLOCKs on every first run in a fresh schema and can pick `public.documents`.) | A wrong `options` string cannot silently write to `public`. |
| **Schema bootstrap** | Immediately after the `current_schema()` assert and **before** the table check, the test calls `initSchema(pool)` (`db/schema.ts:62-64`) itself; the DDL is all `CREATE … IF NOT EXISTS` [V], so re-runs are idempotent. | No dependency on `initDb()`, which would also create the default admin (`db/index.ts:22-34`) [V]. |
| **Filesystem** | `createIngestionService({ storageDir: <scratch>/uploads, extractDir: <scratch>/extracts })`. | No writes under `server/data`. |
| **Fixtures** | Generated at test time in the scratch dir (`Buffer.from(...)` plus `randomBytes` for byte-uniqueness). `.pipeline/phase1/fixtures` is empty [G] and must stay empty per baseline. | No repo writes. |
| **No deletion of user data** | Byte-unique fixtures ⇒ each test's rows/blobs are new; assertions are **deltas scoped to that sha**, never absolute table counts. | No `DELETE`, no `TRUNCATE`, no `rm` outside the scratch dir. A `DELETE` inside `f1test` would be technically permitted but is unnecessary — this plan requires none. |
| **Privileges unavailable ⇒ BLOCKED** | If `CREATE SCHEMA f1test`, the search-path guard, `initSchema`, or `CREATE EXTENSION IF NOT EXISTS "pgcrypto"` (`schema.ts:4`) fails, the DB tests print `BLOCKED: <reason>` and exit **2**. | **Never** fall back to the user's tables. BLOCKED is reported, not silently skipped. |

`pgcrypto` note: the extension is database-scoped and already present in the live DB [G], so `CREATE EXTENSION IF NOT EXISTS` is a no-op; PG 18 also provides `gen_random_uuid()` natively. If it were absent *and* uncreatable by this role, that is the BLOCKED case above.

### 7.3 The two processes (verbatim commands)

```bash
cd /d/Develop/knowledge-app/server

# ---- P1: DB-backed tests in their OWN schema (process 1) --------------------
PSQL="D:/Install/PostgreSQL/18/bin/psql.exe"
PGARGS="-h 127.0.0.1 -p 5432 -U knowledge_app -d knowledge_app"
"$PSQL" $PGARGS -c "CREATE SCHEMA IF NOT EXISTS f1test;"

F1_TEST_SCHEMA=f1test \
DATABASE_URL="postgres://knowledge_app:<pw>@127.0.0.1:5432/knowledge_app?options=-c%20search_path%3Df1test" \
npx tsx src/ingest/service.f1.db.test.ts ; echo "P1 EXIT=$?"

# ---- P2: connect-failure test (T4), DIFFERENT DB config => its own process ---
DATABASE_URL="postgres://knowledge_app@127.0.0.1:1/nope" \
npx tsx src/ingest/service.f1.connect.test.ts ; echo "P2 EXIT=$?"

# ---- type-check must stay green with the new *.test.ts files present --------
npx --no-install tsc --noEmit ; echo "TSC EXIT=$?"
```

(The password is read from the existing `.env` at run time and is never echoed — the `lib.sh:1` convention [V]. The `?options=` value must be percent-encoded exactly as shown; a literal space breaks the connection string.)

### 7.4 Concrete injection primitives (all deterministic)

| Need | Primitive |
|---|---|
| Parse failure | junk `.docx`/`.pptx` → `ADM-ZIP: Invalid or unsupported zip format. No END header found` [G: P7]. **Not** `.xlsx` — `XLSX.read` does not throw on junk and yields 1 bogus chunk [G: P7b], so a `.xlsx` fixture proves nothing here. |
| Zero chunks | empty `.txt` → `textLen=0, chunks=0` [G]. |
| Extract-write failure | pre-create `extracts/<sha>.txt` as a **directory** ⇒ `fs.writeFileSync` throws `EISDIR` [G: P5]. `sha` is computed by the test from the fixture, so it is known before ingest. |
| Blob-write failure | patch `fs.writeFileSync` to throw `ENOSPC` on the first call whose fd/path is the temp; assert the original error surfaces and no content address exists. (Pre-creating `uploads/<sha><ext>` as a directory does **not** work — dedupe's `existsSync` fires first and short-circuits.) |
| `INSERT INTO documents` failure | patch `pg.Client.prototype.query` to throw when `typeof q === 'string' && q.includes('INSERT INTO documents')`, once. |
| `COMMIT` failure, no commit | same patch, `q === 'COMMIT'`, **without** calling the original ⇒ T6a. |
| `COMMIT` ack loss, real commit | same patch, `q === 'COMMIT'`, `await original.call(this, q)` **then** throw ⇒ T6b. |
| `renameSync` failure | patch `fs.renameSync` to throw `EPERM` ⇒ dangling row + preserved temp (§5.2b). |
| Cleanup failure | patch `fs.rmSync` to throw `EPERM` when the path contains `.ingest-tmp-`. |
| DB connect failure | `DATABASE_URL` at a closed port — **P2 only**, it must be a separate process. |
| Report script | run `orphans.sh` with `F1_DATA_DIR` / `F1_PGARGS` pointed at the scratch dir and `f1test`. |

### 7.5 Test matrix

Labels: **proof** = fails if the defect is present (discriminating); **guard** = passes either way, exists to catch a regression.

**Scoping rule — binding on every row below (R2 review).** T1–T14 run **sequentially in document order, in one process**, against one `f1test` schema and one scratch `uploads/`. Therefore every **DB** count is scoped to that test's own fixture `<sha>` (a delta), never an absolute `documents` count — T6b's "exactly 1 row" means one row with its sha, and T3's "1 row with 0 chunks" / T5's "0 rows" likewise. Every **filesystem** assertion is either delta-scoped (before/after) or run against a per-test `uploads/` subdirectory of the scratch dir (the factory already isolates directories), so T2's "`uploads/` has 0 files" means no file for its own sha. T8 deliberately leaves exactly one temp and **removes it after asserting** (inside the scratch dir, which §7.2 permits), so later "0 `.ingest-tmp-*`" assertions stay true.

| # | Test | Sim | Assert | Kind |
|---|---|---|---|---|
| T1 | **Success** | real `.txt`, scratch dirs, `f1test` | 1 blob at `<sha>.txt`; 1 row (`sha256` matches, `source_path` = that blob and `-f` true); ≥1 chunk; extract present; `chunkCount > 0`; **0** `.ingest-tmp-*` | guard (AC2) |
| T2 | **Parse failure — the core proof** | junk `.docx` | rejects with the ADM-ZIP message; **`uploads/` has 0 files** (pre-fix: `<sha>.docx` present); documents delta = 0; no extract; **0** `.ingest-tmp-*`. **Then** re-ingest the same bytes ⇒ **dedupe miss ⇒ full success** (1 row) — that half is what proves O3 is cured | **proof** (AC1 + AC4) |
| T3 | **Zero chunks (documented, not an orphan)** | empty `.txt` | resolves `chunkCount: 0`; **1 row with 0 chunks** committed; blob present and referenced — asserts the fix does **not** delete a referenced blob | guard (AC3) |
| T4 | **DB connect failure — own process** | `DATABASE_URL` → `127.0.0.1:1`, `service.f1.connect.test.ts` | `ingestFile` rejects; **0** content-address blobs; **0** `.ingest-tmp-*`; **no connection to the user's DB at all** (P2 sets its own `DATABASE_URL` before import) | **proof** (AC1/AC7) |
| T5 | **`INSERT INTO documents` failure** | patched `query` | rejects; 0 content address; 0 `.ingest-tmp-*`; 0 rows; **fault-fired asserted** | **proof** (AC1) |
| T6a | **COMMIT throws *before* the real commit** | patch `query`: on `'COMMIT'`, throw without calling the original | rejects with the **same error object** (`===`); the verification probe runs and finds **0 rows** (the uncommitted INSERT is invisible to the fresh client); no ROLLBACK error escapes; documents delta = 0; **no content address**; **no `.ingest-tmp-*`** | **proof** (AC1/AC4) |
| T6b | **COMMIT succeeds, ack throws (phantom success)** | patch `query`: on the first `'COMMIT'`, `await original.call(this, 'COMMIT')` **then** throw; a `fired` flag set **before** the real call so re-entry cannot double-arm | **resolves** (no throw); exactly **1** row in `f1test.documents`; **blob present at the content address** with `sha256 == its filename prefix`; **0** `.ingest-tmp-*`; extract present. Deterministic: no sleeps, no barrier — the real commit executes inside the patch, and the verification `SELECT` is a different query string so it passes straight through | **proof** (AC1/AC2 — the only deterministic phantom-success proof) |
| T7 | **Extract-write failure (S5 shape preserved)** | `extracts/<sha>.txt` pre-created as a **directory** | rejects `EISDIR`; row + chunks committed; **blob present at the content address** (the rename preceded the extract, R2); **0** temp | **proof** of ordering (AC2/AC4) |
| T8 | **Cleanup failure must not mask** | patch `fs.rmSync` → `EPERM` on `.ingest-tmp-*` | caller's message is **byte-identical** to T2's control message (object `===` and `.message ===`); **no content address**; **one** `.ingest-tmp-*` left (the suppressed cleanup); a `logger.warn` was emitted (asserted through a patched logger sink) | **proof** (AC4) |
| T9 | **Idempotency (re-specified — no cleanup helper is exported)** | two halves: (a) `fs.rmSync(<absent temp path>, {force:true})` **twice** ⇒ both silent (the exact primitive the cleanup uses); (b) *fail-then-retry*: T2's fixture fails, then the **same bytes** are re-ingested ⇒ dedupe miss ⇒ full success, exactly 1 row, 1 blob | no throw in (a); in (b) resolves `chunkCount > 0` and leaves no residue | (b) **proof** (AC1/AC4); (a) guard |
| T10 | **Shared-blob safety, concrete (re-specified)** | ingest bytes **X** as `p.txt` ⇒ commit `<shaX>.txt` + row. Then ingest the **same bytes X** as `p.docx` (X chosen to be valid UTF-8 text but **not** a zip, so the `.docx` parse throws) | `<shaX>.txt` **still present** and its row intact (same `source_path`, chunks unchanged); the second call rejects; **no** `<shaX>.docx`; **0** temp. **Label: a guard against a revert to (A)** — the pre-fix code also never unlinks, so it cannot prove (B) | guard (AC3) |
| T11 | **Duplicate ingestion (contract unchanged)** | same `.txt` twice, sequential | 2nd resolves `chunkCount: 0` with `documentId` = `<sha>` from the response; documents delta = 0 | guard (AC5); also records O9 |
| T12 | **Concurrent identical, both succeed** | `Promise.allSettled([ingest, ingest])` | **exactly one** blob at the content address; **1 or 2** rows (2 permitted while UNIQUE is absent — assert `<= 2` and that each row's `source_path` exists); **0** `.ingest-tmp-*` | guard (AC3) |
| T13 | **Concurrent identical, one fails — the only test that separates (A) from (B)** | arm `pg.Client.prototype.query`: **the first** `INSERT INTO documents` observed ⇒ throw (`faultFired = true`); **the second** ⇒ let it through and **park its `COMMIT`** on a promise the test releases afterwards. Both calls start under `Promise.allSettled` on the **same bytes**. | **Fail-closed gate:** if `insertAttempts < 2` the test **FAILS** (`"both callers must have missed dedupe"`) — never a vacuous pass. Then: the winner's row's **`source_path` `-f` true**; **exactly one** content-address blob; the loser's error surfaced; **0** `.ingest-tmp-*`. Under (A) the loser's `rmSync` removes the winner's blob ⇒ `source_path` missing ⇒ **fails**; under (B) the loser unlinks only its own temp ⇒ **passes** | **proof** (AC3) |
| T14 | **Report script** | run `orphans.sh` with `F1_DATA_DIR=<scratch>`, `F1_PGARGS=…f1test`; plant one orphan blob (random bytes at `<64hex>.txt`, no row) and one corrupt blob (right name, wrong bytes) | prints `ORPHAN_BLOB` for the planted orphan, **`HASH_MISMATCH`** for the corrupt one, `STALE_TMP` for a temp file back-dated with `touch -d '-2 hours'`, and **nothing** for T1's blob; exit 0; **deletes nothing** (directory listing identical before/after) | **proof** (AC8) |

Deliberately **not** tested: process crash (no seam, Q4 — covered by §6.2 evidence); rename retry (no retry exists); `documents.status` transitions (out of scope).

---

## 8. DATA-MIGRATION / CLEANUP REQUIREMENTS

**None required.** Justification:
- The fix changes only *where a new blob is written before its commit point* and adds (i) a `fsync`, (ii) one `renameSync`, (iii) a failure-path unlink of a file the same call created, (iv) a read-only verification `SELECT` on one error path. It alters no table, column, index, constraint, `source_path` value, `sha256` value, access policy, chunking or API shape → **no schema migration, no backfill, no re-index**.
- The live DB is **empty** (`documents=0, chunks=0`) and all three data dirs are **empty** [G]. So **there are no pre-existing orphans to remediate in this environment**, and no acceptance criterion requires touching historical data.
- `extracts/` has no reader in `src/` [G], so no index or cache depends on it.

**Pre-existing-orphan policy (binding):**
1. Orphans are **reported only** (`.pipeline/f1/orphans.sh`, §6) with class, hash, size and path.
2. **No deletion** of a pre-existing orphan blob, corrupt blob, orphan extract, or `.ingest-tmp-*` file is permitted under this phase — not by the fix, not by the tests, not by the implementer. **No startup sweep, no GC** (Q6).
3. Deleting any candidate requires **a separate plan and explicit user approval**, listing each path and size, and must first prove no `documents.sha256` references it (Q1–Q2) and that no ingest is in flight.
4. The one thing the fix **does** delete is a file its own call created in the same attempt and never renamed into place — and even that is skipped when the name collided (`EEXIST`) or when the failure happened at/after the rename (§4.4(5)).

---

## 9. RISKS / ASSUMPTIONS

| # | Item | Type | Note |
|---|---|---|---|
| R1 | `renameSync` is atomic on the host FS | assumption | Same directory, same volume — no `EXDEV` by construction. NTFS same-volume rename is atomic [G: P1/P3]. |
| R2 | `renameSync` can fail with `EPERM`/`EBUSY` on a just-written target | **measured risk** | Renaming over a target another process holds **open** throws `EPERM` on this host [G: P2]; renaming with the **source** open succeeds [G: P3]. That makes it the likeliest **non-crash** cause of a dangling row (§5.2b). Mitigation, per the ruling: **no retry loop**, a distinct `logger.warn('rename_failed')`, rethrow, and **preserve the temp** because it is the only copy of the committed bytes. |
| R3 | `COMMIT` phantom success | risk, **mitigated** | §4.4(6): present ⇒ warn + return the id ⇒ the rename happens; absent/timeout ⇒ best-effort `ROLLBACK` + rethrow the original. Proven by T6a/T6b. |
| R4 | `readFileSync(filePath)` loads up to 25 MiB into memory per file, ×10 files | pre-existing | Unchanged; the cap is `routes/ingest.ts:58` [V]. |
| R5 | The fix changes behaviour observed by the Phase 1 suite | assumption | No — the dedupe branch and the success path's observable shape are unchanged; only a *failed* ingest stops leaving a blob, and Phase 1 does not assert on that (`t04-t10.sh:69`, `:74-75` echo only; the hard assertion is `:92`) [V]. |
| R6 | `documentId` remains the sha in the dedupe branch (O9/F3) | given | Out of scope; must not change (Phase 1 records the shape at `t04-t10.sh:89-91`, `NOTE`-only) [V]. |
| R7 | The implementer may be tempted to "fix" dedupe to check the DB | risk | **Do not** — it changes the response contract and is out of scope (§5.5). Log the recommendation instead. |
| R8 | Empty-`.txt` / junk-`.xlsx` behaviour differs from intuition | verified | Empty → 0 chunks; junk `.xlsx` → 1 bogus chunk [G]. The tests use `.docx`/`.pptx` for parse failure. |
| R9 | `uplcount()` counts **all** files in `uploads/` | cosmetic | `lib.sh:30` = `find … -type f \| wc -l` [V]. A leftover `.ingest-tmp-*` inflates Phase 1's **echoed** `uploads delta` line (`t04-t10.sh:69`) and nothing else — no `FAILED=1` is attached. |
| R10 | The implementer drops the `fsync` or the preserve-on-rename-failure predicate | risk | Both are **load-bearing**, not stylistic: without `fsync` §5.3 becomes false; without `renameAttempted` a rename failure destroys the only copy of a committed document's bytes. T6b and the §7.4 rename-failure case pin them. |
| R11 | `pg`'s pooled client after an aborted `COMMIT` | **[U]** | Whether `release()` returns a poisoned client to the pool is not established. The verification probe deliberately uses a **fresh** client for this reason; the original client is used only for a best-effort `ROLLBACK` whose failure is swallowed. |

---

## 10. OUT OF SCOPE

- Adding `UNIQUE` on `documents.sha256`, `status` transitions out of `'pending'`, or any schema/DDL change (REQUEST §Out of scope; §5.4) — **report, don't do**.
- Changing dedupe semantics or the response contract (`documentId`/`chunkCount` in the dedupe branch) — including "making dedupe check the DB" (§5.5).
- **Any startup/periodic sweep of `.ingest-tmp-*`**, and any change to `service.ts:85` (the `ensureDir` block) — Q6, report-only.
- **Any new exported API**: no `_testHooks` on `StoreOptions`, no `__test` export, no `sweepIngestTemp()`. `StoreOptions` (`service.ts:40-56`) and the returned object (`:228-233`) are unchanged.
- Reusing or deleting the dead helpers `contentAddress()` (`service.ts:100-103`) / `toContentAddress()` (`hash.ts:17`) — leave them; do not "use" them (§4.4 note).
- Route-level changes (`routes/ingest.ts`, including the `/watch` extension gap that makes S1's cheap repro possible) and multer temp handling.
- Extract-via-temp+rename, or any change to extract ordering/semantics (Q7) — O11 is reported, not fixed.
- FTS/search (Phase 2), JWT/token rehydration (F2), Library/Audit wiring, Chat/LLM.
- Any auto-deletion of pre-existing orphans, any GC without an approval gate (§8).
- Repository cleanup (the 371 MB installer, stray probe scripts), doc rewrites.
- Deleting the scratch artefacts created by the planner or the reviewer (`/tmp/f1-probe*`, `%TEMP%\f1rev-*`, the probe scripts) — **the task forbids deletions**; they are outside the repo and listed for the user to remove.

---

## 11. OPEN QUESTIONS — RESOLVED IN ROUND 1

All seven round-0 questions are decided. Each ruling and where it landed is recorded so nothing is re-litigated.

| Q | Ruling | Where applied |
|---|---|---|
| **Q1** Fix vs documented marker | **(B) is sufficient.** It creates no unreferenced *blob*; a hard kill leaves only a `.ingest-tmp-*`, which is the "documented, detectable marker" leg of AC1 and is detected by §6.2 `STALE_TMP`. | §4.3, §5.1, §6.2 |
| **Q2** Rename before or after COMMIT | **After COMMIT**, and **before** the extract write. Rename-before-COMMIT reproduces F1 exactly, re-enables O3, and does not even close the window it is sold as closing. | §4.4 step order, §4.3 note 1, §5.2 |
| **Q3** Is the dangling row acceptable | **YES, accepted**, on four conditions: (a) documented and detected by §6.1 Q2; (b) causes named — crash **and** rename failure **and** phantom COMMIT, not crashes alone; (c) the residual stated honestly (the self-heal creates a duplicate row, O6); (d) the false "(A) has the same window" claim removed. | §5.2 (a)–(c) and its last ¶ |
| **Q4** Post-COMMIT verification query | **YES, required — inside `storeDocument`**, in the implementable shape (hoisted id, `committing` flag, fresh client, ≤2 s race, own `finally`, warn+return vs rollback+rethrow). | §4.4(6), T6a/T6b |
| **Q5** Fault-injection seam | **NO production seam.** In-process patching only; the crash test is dropped. | §4.4 tail, §7.1, §7.4 |
| **Q6** Real DB or throwaway | **Neither as written.** Filesystem isolation from the factory; DB isolation from `DATABASE_URL`-before-import + `CREATE SCHEMA f1test` + `search_path`; one process per config; BLOCKED on missing privileges. | §7.1–§7.3 |
| **Q7** `.ingest-tmp-*` startup sweep | **NO.** Report-only this phase; the residue is sometimes the only copy of committed bytes. | §4.4(9), §5.1, §8.2 |
| **Q8** (orchestrator) Durability | **Adopted** the cheap option: `openSync('wx')` → `writeFileSync(fd)` → `fsyncSync(fd)` → `closeSync(fd)` → `renameSync`. **Directory** fsync is *not* performed (not portable on Windows), so a power loss can still lose the rename itself — stated, not hidden. | §4.4(2), §5.3, §4.3 note 2 |
| **Q9** (orchestrator) `wx`-collision cleanup | **Normative:** cleanup gated on `err.code !== 'EEXIST'`. | §4.4(5) |
| **Q10** (orchestrator) Rename retry | **None.** Distinct `rename_failed` warning + rethrow. | §4.4(3), §9 R2 |

---

## 12. EVIDENCE

### 12.1 Source citations re-read in this revision (all `[V]`)

- `server/src/ingest/service.ts` — `:4-8` header comment; `:12` `import * as fs`; `:14` `createHash, randomBytes`; `:40-56` `StoreOptions`; `:58-62` `DEFAULTS`; `:64-69` factory destructure; `:72-74` `DOC_KINDS` (includes `'other'`); `:80-86` `ensureDir` + calls at `:85-86`; `:88-98` `sha256File` (reject at `:96`); `:100-103` unused `contentAddress`; `:109-111` kind gate; `:114` hash; `:115-117` `storagePath`/`extractPath`; `:120-123` dedupe short-circuit; `:126` blob write **pre-parse**; `:127` log; `:130` parse; `:135-141` chunker 300/50/20; `:144-154` `storeDocument` call (`:147` `sourcePath`, `:148` `statSync`); `:157` extract write **post-commit**; `:160-170` return; `:174-184` params; `:185` `pool.connect()` **outside the try**; `:187` BEGIN; `:189-202` INSERT without `status`; `:203` `const documentId`; `:206-215` chunk insert (`:210` `if (values.length > 0)`); `:217` COMMIT; `:218` info log; `:220-222` ROLLBACK-swallow + rethrow; `:223-225` release; `:228-233` return object; `:236` module-level singleton.
- `server/src/db/schema.ts` — `:4` `CREATE EXTENSION … pgcrypto`; `:6-18` `documents`; **`:10` `source_path TEXT`** (line 9 is `kind`); `:12` `sha256 TEXT NOT NULL` (no UNIQUE); `:13` `status … DEFAULT 'pending'`; `:20-28` `chunks`; `:22` FK `ON DELETE CASCADE`; `:30-31` `chunks_fts_idx`; `:62-64` `initSchema`.
- `server/src/db/index.ts` — **`:6` `export const pool = new Pool({connectionString: config.DATABASE_URL})`**; `:8-16` `initDb`; `:22-34` `ensureDefaultAdmin`.
- `server/src/config/index.ts` — `:1-2` `dotenv.config()`; `:4-11` object literal; `:7` `DATABASE_URL: process.env.DATABASE_URL || ''`.
- `server/src/ingest/chunker.ts` — `:8` "Any chunk with fewer than 20 words is dropped" (comment only); `:29-34` `minWords` doc; **`:45` `const safeOverlap = Math.min(overlapWords, Math.max(0, words - minWords - 1))`**; `:47-92` body (no throw path); `:53-54` `tokens.length === 0 → []`; `:75` synthetic `chunk-${position}-${end}`.
- `server/src/ingest/parsers.ts` — `:240-250` `EXTENSION_TO_KIND`; `:252-255` `detectKind` (`?? 'other'`); `:264-274` `parseFile` (`Unsupported file type: .${ext}` at `:271`).
- `server/src/ingest/hash.ts` — `:17-19` `toContentAddress` (no callers).
- `server/src/ingest/types.ts` — `:29-34` `ParseResult`; `:72-91` `IngestionResult`.
- `server/src/routes/ingest.ts` — `:57-58` `MAX_FILES` / 25 MiB; `:62-76` multer `diskStorage` into `TMP_DIR`; `:78-101` limits + `fileFilter` (`ALLOWED_EXTS` gate); **`:109-114` `uploadedFiles()`**; **`:123-131` `sweepUploaded()`**; `:196-235` per-file loop (`:202` `for`, `:212-217` zero-chunk warn, `:219-227` catch → `errors.push`, `:226` `fileErr.message`, `:228-234` `finally rmSync(file.path)`); `:237-246` 200/207/400 (`:245` body); `:339-375` `/watch` (no `ALLOWED_EXTS`, `:364` `detectKind`, `:369` `ingestFile`, `:373` `err.message`).
- `server/package.json` — `:7-11` scripts (`"dev": "tsx src/index.ts"` at `:10`); `:28-37` **devDeps = six `@types/*` + `tsx` + `typescript`; no test framework**.
- `server/tsconfig.json` — `:4` `module: commonjs`; `:10` `esModuleInterop`; `:18` `exclude: [..., "**/*.test.ts"]`.
- `.pipeline/phase1/lib.sh` — `:1` "Never echoes secrets"; `:14-15` `PSQL`/`PGARGS`; `:28-30` `tmpcount`/`want_tmp0`/`uplcount` (**`uplcount` = every file**); `:31` `sha256sum` helper.
- `.pipeline/phase1/t04-t10.sh` — `:63-75` T9 (`:69` echoes `uploads delta`; `:70` the only hard assert, `documents delta=0`; `:72-75` `ORPHAN_BLOB` **echoed**); `:77-93` T10 (**`:89-91` print `… OK` or `NOTE …`, no `FAILED=1`; `:92` is the single hard assertion**); `:94` `FAILED` echo.
- `.pipeline/f1/baseline.sha256` — 30 entries; `service.ts` hash `9c7897…`; `PLAN.md` is **not** a member.

### 12.2 Read-only commands run in this revision

- `sha256sum -c .pipeline/f1/baseline.sha256` → **30 `: OK`, 0 FAILED** (run fresh; this revision touched no baseline member).
- Nothing else was executed for this revision: **no** DB command, no server start, no install, no deletion.

### 12.3 Facts carried from the reviewer's recorded probes (`[G]`, not re-executed by me)

```
P1  rename over existing target (same dir)     : OK, replaced
P2  rename over OPEN target (read handle)      : THREW EPERM        -> §5.2b
P3  rename with SOURCE open                    : OK                 -> §4.4(7)
P4  writeFileSync {flag:'wx'} on existing file : THREW EEXIST       -> §4.4(5)
P5  writeFileSync to a directory path          : THREW EISDIR       -> T7
P6  rmSync(missing,{force:true})               : silent OK          -> §4.4(8)
P6b unlinkSync(missing)                        : THREW ENOENT
P7  adm-zip on 9-byte junk .docx               : THREW "ADM-ZIP: … No END header found"  -> T2
P7b xlsx on the same bytes                     : NO THROW, sheets=["Sheet1"]              -> §7.4
    psql role knowledge_app                    : rolsuper=f, rolcreatedb=f, CREATE=t      -> §7.2
    find -printf / stat -c / sha256sum / -f <native backslash path> : all work              -> §6
    grep -qxF with an empty hash list          : exit 1 (everything reported as orphan)   -> §6.2
```

### 12.4 Carried from round 0 (`[G]` unless re-read above)

Phase-1 T9 live orphan (`TEST-REPORT.md:144-154`); F3 `documentId` divergence (`RESULT.md:70-74`); DB baseline `0|0|1|0`, PG 18.6; empty data dirs; ports free; the greps finding no reader of `uploads/`/`extracts/` and no callers of `contentAddress`/`toContentAddress`.

### 12.5 Still UNCONFIRMED (explicit)

- **[U]** `pg`'s behaviour on a `COMMIT` whose ack is lost — whether `release()` returns a poisoned client to the pool (§9 R11). The verification path uses a **fresh** client, so the design does not depend on the answer.
- **[U]** Whether `xlsx` can ever throw on adversarial input — one `not-a-zip` sample did not; no broad corpus was tested.
- **[U]** Whether a throwing path exists in `splitIntoChunks` for some string — none is visible in the body; treated as "does not exist as written".
- **[U]** Device-level write-cache behaviour without flush barriers — outside what `fsync` can promise (§5.3).
- **No longer `[U]`:** Windows rename-under-open-handle behaviour (measured, `[G: P2]`/`P3`); the COMMIT outcome after the fix (now *verified at run time* by §4.4(6) rather than assumed); the exact post-`COMMIT`-failure DB state as a *decision* (S4's ambiguity is resolved operationally, not theoretically).

DONE:PLANNER_F1_REV1
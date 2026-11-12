# RESULT — Phase 1: Fix Multipart Document Upload

**Orchestrator final review:** `FINAL_REVIEW: PASS (with one open cleanup item + follow-ups)`
**Date:** 2026-10-28
**Pipeline:** Planner → Plan Reviewer (4 rounds) → Implementer → Test Engineer → Orchestrator

## 1. Status

| Gate | Result |
|---|---|
| Plan approval | **APPROVE** — `REVIEW.md` §ROUND 4 REVIEW, line 588 (rounds 1–3 drove 20 numbered revisions; round 3 caught a data-loss defect in the test plan) |
| Implementation | **IMPLEMENTED** — `IMPLEMENTATION.md` |
| Independent testing | **PASS** — `TEST-REPORT.md`, 22 HTTP requests + SQL/blob assertions, zero product failures, **browser-level UI verification reached** |
| Orchestrator reproduction | **PASS** — re-ran `tsc --noEmit` (exit 0), baseline diff (exactly the 3 permitted files), and 5 live requests (200/400/400/400/401) with 0 temp leaks |

## 2. Root cause (three independent defects, each fatal alone)

1. No multipart body parser existed: `app.ts:33` mounts only `express.json`, so `req.body` was `{}` for `multipart/form-data` and the guard at `routes/ingest.ts:25` always returned 400.
2. Field-name mismatch: the Inbox appends `files` (`inbox/page.tsx:33`); the server read `body.file`.
3. The temp file was written with **no extension**, while `parseFile` dispatches on `path.extname` ⇒ `Unsupported file type: .` would have failed even after fixing 1 and 2.

## 3. Files changed

| File | Change |
|---|---|
| `server/src/routes/ingest.ts` | 94 → 377 lines. `multer.diskStorage` into `server/data/tmp` with sanitized original extension; `upload.array('files', 10)`; limits 25 MiB/file × 10, fields 20, fieldSize 1 MiB; 15-extension allowlist derived from the parser registry + MIME deny-list; per-file `try/catch/finally`; `sweepUploaded()` on every post-multer early return and in the mapper; 8-row **terminal** error mapper (never `next(err)`); response contract `{results, errors}` with 200 / 207 / 400 |
| `server/package.json` | `multer: "2.5.0"`, `@types/multer: "2.3.0"` (exact) |
| `server/package-lock.json` | npm-generated |
| `.pipeline/phase1/**` | Pipeline artifacts only (REQUEST, PLAN, REVIEW, IMPLEMENTATION, TEST-REPORT, this file, test harness scripts) — outside the source tree |

No change to `app.ts`, `src/ingest/*`, `src/middleware/*`, `src/db/*`, `src/routes/{auth,search,chat,library,audit}.ts`, `web/**`, `dist/**`, or `.env`.

## 4. Verification (evidence)

- `npx tsc --noEmit` → **exit 0**.
- `sha256sum -c .pipeline/phase1/baseline.sha256` → **24 OK**, and exactly the three permitted `FAILED` lines (`routes/ingest.ts`, `package.json`, `package-lock.json`). No `web/**` line failed.
- Live requests (orchestrator, this session): `POST /api/ingest/upload` with `-F files=@…` → **200** with all nine `IngestionResult` fields, `chunkCount: 1`; wrong field → **400** `Unexpected field "file"; upload files under "files"`; `.exe` → **400** `Unsupported file type: .exe`; boundary-less `multipart/form-data` → **400** `Malformed multipart request` (JSON — the historical HTML-500 trap is closed); no auth → **401**.
- Test Engineer: 200/207/400/413/401 matrix correct, `tmp-*` count 0 after every failure case, concurrency-safe dedupe, **real browser** upload through the app's own drag-and-drop on :3000 succeeded.

## 5. Upload behaviour as shipped

- Field name `files`, up to **10 files** per request, **25 MiB** each.
- Accepted extensions: `txt, md, markdown, csv, json, xml, yaml, yml, log, html, htm, pdf, docx, xlsx, pptx`. Images/OCR excluded (reachable via `/watch` only). MIME is a deny-list only (browsers misreport).
- `200` all succeeded, `207` partial, `400` none succeeded (with `{error, errors[]}`). Whole-request transport failures return `{error}` only — never HTML, never a stack trace, never a filesystem path.
- `access_policy` restricted to `public|trusted|restricted`; `metadata` must be a JSON object.

## 6. Data safety

Test data was removed and proven gone by both the Test Engineer and the orchestrator: `documents=0, chunks=0, admins=1, audit_log=0`; `data/uploads`, `data/extracts`, `data/tmp` and the fixtures dir empty; pre-existing hashes lost: 0.

**Open item from the orchestrator's own reproduction:** the verification upload left **one** document (`orch-check.txt`) + its chunk + the blob/extract `53bed513d531aba360bfb596735abf3d6b8fa864d8614125540bc7695620f43b.{txt}`. The cleanup command was **blocked pending user approval** (no user present). Run to finish the reset:

```bash
cd /d/Develop/knowledge-app/server
DBURL=$(grep -E '^DATABASE_URL' .env | cut -d= -f2- | tr -d '\r')
H=53bed513d531aba360bfb596735abf3d6b8fa864d8614125540bc7695620f43b
/d/Install/PostgreSQL/18/bin/psql "$DBURL" -c "delete from chunks   where document_id in (select id from documents where sha256='$H');"
/d/Install/PostgreSQL/18/bin/psql "$DBURL" -c "delete from documents where sha256='$H';"
rm -f "data/uploads/$H".* "data/extracts/$H".*
rm -rf /d/Develop/knowledge-app/.pipeline/phase1/orch-check
/d/Install/PostgreSQL/18/bin/psql "$DBURL" -c "select count(*) from documents; select count(*) from chunks;"
```

A dev server started by the orchestrator (`npx tsx src/index.ts`, pid 12056) may still hold port 4000; the kill was also blocked. If `netstat -ano | grep :4000` shows it listening: `powershell -NoProfile -Command "Stop-Process -Id 12056 -Force"`.

## 7. Known limitations (documented, not fixed — all out of Phase 1 scope)

- **F1 orphan blob (must fix before production):** `ingestionService` writes `<sha256><ext>` **before** parsing, so a corrupt-but-allowed file (e.g. bad `.docx`) leaves a blob with no row. Bounded correction belongs inside `service.ts`; a route-level delete is TOCTOU and was explicitly rejected.
- **F2 session persistence (pre-existing web bug):** after a page reload the UI sends no `Authorization` header (`localStorage.ka_token` is never rehydrated into `api.ts`) ⇒ 401. Verified by the Test Engineer; this is the Phase-2 blocker for real UI use.
- **F3** dedupe returns the content hash as `documentId` while a first ingest returns a UUID; `documents.sha256` has no UNIQUE constraint.
- **F4** sidebar "Inbox" links to `/dashboard`, not the inbox page.
- **F5** empty-string `metadata=` / `access_policy=` form fields are rejected 400 (the Inbox never sends them).
- **F6** `middleware/error.ts` `errorHandler` has 3 parameters, so Express never treats it as an error handler — every non-upload error can still surface as HTML.
- Synthetic `chunkIds` (`chunk-<start>-<end>`) are not row ids; `documents.status` stays `'pending'` forever.

## 8. Next phase

**Phase 2 — PostgreSQL full-text search correctness** (`/api/search` currently returns every chunk regardless of the query because there is no `@@ to_tsquery` predicate and no rank threshold). Recommend pairing it with **F2** (token rehydration), since a correct search endpoint is unusable from the UI while every reload 401s. Follow-ups F1/F3/F6 belong with whichever phase touches their owner files.
# REQUEST — F1 Follow-up: Blob Orphan Audit & Fix

PROJECT ROOT: D:\Develop\knowledge-app
PHASE ID: f1-blob-orphan
STARTED: 2026-10-28
PREDECESSOR: Phase 1 (multipart upload) — `FINAL_REVIEW: PASS`, see `.pipeline/phase1/RESULT.md`

## Objective
Audit and fix orphaned blobs / inconsistent DB records in the existing ingestion pipeline, with
**data safety prioritised over automatic cleanup**. A failed ingestion must not leave unreferenced
blobs or incomplete records; a successful one must leave storage and DB consistent.

## Confirmed context (verified in Phase 1)
- `POST /api/ingest/upload` and `/api/ingest/watch` both funnel into
  `ingestionService.ingestFile()` (`server/src/ingest/service.ts`).
- The service writes the content-addressed blob `<storageDir>/<sha256><ext>` **before** parsing.
  A corrupt-but-allowed file (e.g. a `.docx` that is not a zip) therefore leaves a blob with **no**
  `documents` row. Observed live in Phase 1 (T9): `uploads` delta = +1, `documents` delta = 0.
- `storeDocument()` is transactional (`BEGIN … COMMIT`/`ROLLBACK`), so parse failures create no rows;
  the orphan class is the **blob on disk** (and potentially the extract file written after commit).
- `documents.sha256` has **no UNIQUE constraint**, and dedupe is keyed on `fs.existsSync(blobPath)`
  (file existence), not on a DB row.
- The Phase 1 review rejected a route-level blob delete as TOCTOU (shared content-addressed path,
  concurrent identical uploads, dedupe lets a second request "succeed" off the first one's blob).

## Acceptance criteria
1. A failed ingestion (parse error, DB error, or write error) leaves **no** unreferenced blob created
   by that attempt, or — where safe deletion is impossible — leaves a documented, detectable marker
   and no silent leak.
2. A successful ingestion still produces exactly one blob `<sha256><ext>`, one `documents` row and
   its `chunks` rows, with existing metadata/access-policy semantics unchanged.
3. Cleanup never deletes a blob that a **valid** `documents` row references, including when two
   documents share identical bytes and when a concurrent ingest of the same bytes is in flight.
4. Cleanup is idempotent and never masks the original ingestion error (the caller still receives the
   original failure message/status).
5. No change to the public API contract, auth, chunking, content addressing, or `web/**`.
6. `npx tsc --noEmit` exits 0; Phase 1's upload behaviour still passes its suite (no regression).
7. The user's database and existing files are never reset, truncated or deleted by the task.
8. Orphan candidates found during the audit are **reported, not deleted**.

## In scope
- `server/src/ingest/service.ts` (the owner of blob/extract writes and the DB transaction).
- Minimal, additive helpers if strictly required; no new modules unless justified.
- Deterministic tests for failure paths (fault injection where needed).

## Out of scope (report only)
- PostgreSQL FTS / search correctness (Phase 2).
- JWT persistence, login routing, logout, token rehydration (Phase 2).
- Library / Audit endpoint wiring; Chat/LLM.
- Broad refactoring, dependency upgrades, schema changes (incl. adding UNIQUE on sha256) unless the
  reviewer approves a narrowly justified one.
- Repository cleanup (371 MB installer, stray probe scripts), doc rewrites.
- Deleting any pre-existing orphan candidate — that needs a separate, explicitly approved plan.

## Baseline (captured before any change)
- PostgreSQL: `documents=0, chunks=0, admins=1, audit_log=0`.
- `server/data/uploads`, `server/data/extracts`, `server/data/tmp` all empty; fixtures dir empty.
- Ports 3000/4000 free; server not running.
- File hashes for everything that must not change: `.pipeline/f1/baseline.sha256`.
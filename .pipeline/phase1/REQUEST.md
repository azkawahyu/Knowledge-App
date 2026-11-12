# REQUEST — Phase 1: Fix Multipart Document Upload

PROJECT ROOT: D:\Develop\knowledge-app
PHASE ID: phase1-multipart-upload
STARTED: 2026-10-28

## Goal
Files uploaded through the Inbox UI must be accepted by the backend and processed through the
EXISTING ingestion pipeline (no parallel implementation).

## Acceptance criteria
1. `POST /api/ingest/upload` accepts multipart/form-data with field name `files` (one or more files).
2. Every accepted file is routed through `ingestionService.ingestFile` and persists a `documents`
   row plus its `chunks` rows.
3. File size limit and file type validation are enforced with actionable error messages and
   appropriate HTTP status codes.
4. Missing file, wrong field name, unsupported type, oversized file, and malformed (non-multipart)
   requests all produce clear 4xx errors, not 500s and not stack traces.
5. Temporary files are cleaned up on success AND on failure.
6. Auth remains enforced (401 without a valid bearer token).
7. `npx tsc -p tsconfig.json --noEmit` in `server/` still exits 0.
8. The existing Next.js client contract keeps working (`web/src/lib/api.ts` parses JSON; the
   Inbox page reports success/failure).
9. No unrelated files change (verified against `.pipeline/phase1/baseline.sha256`).
10. The user's database is never reset; only test rows created during verification are removed.

## In scope
- Multipart middleware wiring on the upload route only.
- File validation (size, type/extension) and upload error handling.
- Temp-file lifecycle and ingestion integration on the upload path.
- Minimal, upload-only frontend adjustment if the response shape requires it.

## Out of scope (record as follow-ups, do not implement)
- PostgreSQL FTS/search correctness fix.
- JWT persistence, `/login` routing, logout endpoint.
- Library and Audit endpoint wiring.
- Chat / LLM context assembly.
- Broad security remediation beyond upload handling.
- Repository cleanup (371 MB installer, stray .ps1/.bat probe scripts), doc rewrites, dependency
  upgrades beyond adding the multipart middleware.

## Constraints
- Preserve existing ingestion pipeline, content addressing, chunking and metadata.
- No DB migrations unless strictly necessary.
- Never log file contents, credentials, tokens or secrets.
- Do not weaken authentication/authorization.
- Do not commit, push or deploy.
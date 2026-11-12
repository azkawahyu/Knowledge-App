# knowledge-app — Project Rules

Local-first company-knowledge ingestion web app. Two packages in this repo: `server/` (backend) and `web/` (frontend).

## Stack
- TypeScript everywhere; no new plain-JS source files in `server/` or `web/`.
- Backend: Express.js (`server/`). Frontend: Next.js 14 + Tailwind (`web/`).
- Database: PostgreSQL, local instance started from `server/start_postgres*.bat`.
- Read `server/package.json` / `web/package.json` before adding a dependency; reuse what is already there. No stack swaps without a written technical reason.

## Retrieval
- BM25-first. Keep the existing retrieval path; do not add embeddings, vector stores, or rerankers without a proven need and explicit approval.

## OCR
- Tesseract, wired into the existing ingestion pipeline (`server/eng.traineddata`). No OCR engine swap without evaluation and approval.

## Network & security
- Bind `127.0.0.1` only. Never expose to `0.0.0.0` or the public network.
- No user registration, no third-party auth providers. The existing local admin auth stays as-is.
- Never read, print, or commit `.env` or credential files.

## Frontend
- Theme through CSS variables (dark/light). No hardcoded colors where a token exists.
- Match the existing dense, table-first, monospace-label UI. No gradients, carousels, or marketing-style pages.

## Working rules
- Read the existing implementation before writing new code; extend rather than duplicate.
- Minimal patches. No drive-by refactors, renames, or reformatting.
- Batch independent lookups in one turn; cite `path:line` instead of pasting files.
- Verify before claiming done — `cd server && npm run build` (tsc) and/or `cd web && npm run build` or `npm run lint`, and report the real output.
- Stay inside the requested scope; ask before touching anything else.

# REQUEST — Phase 3: Library & Audit Integration

PROJECT ROOT: D:\Develop\knowledge-app
PHASE ID: phase3-library-audit
STARTED: 2026-11-02
PREDECESSORS (all PASS): `.pipeline/phase1/RESULT.md` (upload), `.pipeline/f1/RESULT.md` (blob orphans), `.pipeline/p2/RESULT.md` (**FTS search + auth persistence; baseline 38/38**)
READ FIRST: `.pipeline/p2/RESULT.md` §8 limitations, `.pipeline/p2/PLAN.md` §B2.1 (token owner rules — the web auth model is now strict: one owner module, hydration gate), `.pipeline/f1/RESULT.md` §5 (ingestion guarantees must not break).

## Orchestrator-verified current state (re-verify anything you rely on)
- `.pipeline/p3/baseline.sha256` = 38 files, **all OK** right now.
- `server/src/routes/library.ts` (21 lines): `GET /api/library` → `SELECT id, name, kind, source_path, size_bytes, sha256, access_policy, status, metadata, created_at, updated_at FROM documents ORDER BY created_at DESC` → `{ results: rows }`. **No auth beyond the router mount, no pagination, no chunk count, and it returns `source_path`** (an internal blob path).
- `server/src/routes/audit.ts` (21 lines): `GET /api/audit` → `SELECT actor, action, resource, detail, created_at FROM audit_log ORDER BY created_at DESC LIMIT 200` → `{ rows }`. **Nothing in `server/src` ever writes `audit_log`** (`grep -rn audit_log` → only this SELECT), so the table is empty and the page has nothing to show.
- `public.audit_log` DDL: `id uuid pk`, `actor text NULL`, `action text NOT NULL`, `resource text NULL`, `detail jsonb NOT NULL DEFAULT '{}'`, `created_at timestamptz NOT NULL DEFAULT now()`; index `audit_log_created (created_at DESC)`.
- `public.documents` DDL: `id, name, kind, source_path, size_bytes, sha256, status (default 'pending'), access_policy (default 'restricted'), metadata jsonb, created_at, updated_at`; `chunks.document_id → documents(id) ON DELETE CASCADE`.
- `server/src/app.ts` mounts `/api/library` and `/api/audit` behind `authMiddleware` — i.e. any valid JWT can read both. **There is no role concept in the DB**: `admins(username, password_hash)` only. Every authenticated user IS an admin today.
- Web: `dashboard/library/page.tsx` calls `api.search({q:"",limit:100})` and synthesises "documents" from chunk hits (`kind:"unknown"`, `size_bytes:null`); `dashboard/audit/page.tsx` calls `api.search({q:"",limit:200})` and shows passages. Both therefore display a **400 error** today (search rejects a blank `q`).
- Public DB: `documents=0, chunks=0, audit_log=0, admins=1`. A `f1test` schema exists (182 docs) — **never touch it**.
- Windows/Git-Bash; Node v24.22.1; PG 18.6; psql at `D:/Install/PostgreSQL/18/bin/psql.exe`; ports 3000/4000 free; `server/dist/` stale — **never** `npm run build` / `npm start`; run the API with `npx tsx src/index.ts`.

## F3-A — Library integration

**Acceptance criteria**
1. The Library page fetches `GET /api/library` through the shared API client (no `/api/search` usage remains in `library/page.tsx`).
2. Each row shows: document name, `kind`, `created_at` (formatted), `status`, and **chunk count** (see AC4).
3. The response **must not include `source_path`** or any other internal storage path — the client has no use for it and REQUEST F3-A.9 forbids exposing it.
4. Chunk count comes from the backend (a `LEFT JOIN chunks … GROUP BY` / correlated subquery), not from a second client request; it must be correct for documents with 0 chunks.
5. Empty database ⇒ explicit empty state ("No documents yet"), not an error and not a spinner forever.
6. Loading and error states render correctly; a 401 must surface as the auth error path (which now redirects via `ka:logout`), not as a silent blank table.
7. Pagination: justified only if the backend needs it. Decide with evidence (row counts, index, expected volume) and state the decision explicitly; if added, it must be `limit`/`offset` with a clamped limit and a stable total-order sort (e.g. `created_at DESC, id ASC`).
8. Auth unchanged: 401 without a token; the mount-level `authMiddleware` stays.
9. Response contract: `{ results: [...] }` preserved (additive fields allowed); the client type updated accordingly.
10. No change to ingestion, search, or the documents table.

**Out of scope:** document deletion, download/preview, editing metadata, access-policy UI, search integration.

## F3-B — Backend audit logging

**Acceptance criteria**
1. **One central audit service** (single module, e.g. `server/src/audit/log.ts` + `events.ts`) — no duplicated INSERT SQL in controllers.
2. Events recorded (the taxonomy must be documented in the plan, with exact `action` strings):
   - `auth.login.success` (actor = username), `auth.login.failure` (actor = attempted username **only if safe** — decide: storing an attacker-supplied string is fine if sanitised and length-capped, or use `null` + detail `reason`),
   - `ingest.upload.success` / `ingest.upload.failure`,
   - `search.query`,
   - `auth.logout` **only if reliably observable** (there is no server-side logout today — decide and justify; a client-side-only logout cannot be recorded and must NOT be faked),
   - access-policy change / document deletion: only if such operations exist (they do not — record as follow-up).
3. Every event carries `actor` (derived from the verified JWT, never from the request body), `action`, `resource` (a stable identifier string), and `detail` (jsonb) with a **sanitised** payload: no password, no JWT, no `Authorization` header, no document content, no extracted text. A sanitiser must exist and be unit-testable (allow-list key names + caps on string length).
4. **Reliability semantics stated per event class**, chosen from: same transaction as the business write / after successful completion / best-effort fire-and-forget. Fire-and-forget MUST NOT be able to fail the business request (wrap in try/catch + log), and the plan must say plainly that a crash between the business commit and the audit write loses the audit row.
5. `GET /api/audit` is **admin-only**: authentication is already enforced; authorization must be made explicit (today every JWT holder is an admin — decide between (a) documenting "all authenticated users are admins" and adding an explicit `requireAdmin` seam for later, or (b) adding a role column — which is a migration; prefer the smallest change that does not weaken anything and say what it costs).
6. `GET /api/audit` supports safe pagination (clamped `limit`, `offset` or keyset), newest-first, and optional filters `action`, `actor`, `resource`, `from`/`to` — all parameterised, all validated, no SQL string interpolation.
7. The audit endpoint never returns `detail` fields that fail sanitisation; response shape is documented.
8. No mutation endpoints for audit rows; nothing in the app can UPDATE/DELETE `audit_log`.
9. Audit write failures are visible in the server log but never turn a successful business operation into a 500.
10. No schema change unless strictly required (the existing table already has actor/action/resource/detail/created_at — justify any migration).

**Out of scope:** retention/rotation policy, audit-log export, tamper-evident hashing, per-user roles beyond what AC5 needs, login rate limiting.

## F3-C — Audit UI integration

**Acceptance criteria**
1. `audit/page.tsx` uses `api.audit.list(...)` (new client method) against `/api/audit`; **no `api.search` usage remains**.
2. Table columns: timestamp, actor, action, resource, outcome (from `detail.outcome` if present, else `—`).
3. Pagination consistent with the backend contract (page size + next/prev or "load more"); no client-side slicing of a 200-row blob.
4. Loading, empty ("No audit events yet"), and error states.
5. Filters: only those the backend supports, wired to real query params.
6. Admin-only: if the backend can answer 403, the page must render an access-denied state rather than a stack of errors; the dashboard route stays gated as today.
7. No sensitive detail rendered (no `detail` object dump; only allow-listed display fields).
8. Existing styling/conventions preserved (same table/card idioms already in the app).

## Global scope restrictions (from the phase brief)
No chat/LLM, no semantic/vector search, no blob GC, no new ingestion features, no broad auth redesign, no unrelated frontend redesign, no unnecessary migrations, no destructive DB operations. Record out-of-scope findings as follow-ups only.

## Data safety
- Never truncate/reset the DB, never delete documents or blobs, no destructive schema cleanup.
- Isolated test fixtures only; clean up exactly your own rows by id and prove it.
- Preserve existing admins/credentials (do not rotate `ADMIN_PASSWORD`).
- No secrets in logs or reports (JWT/password by length only).

## Deliverables (`.pipeline/p3/`)
`REQUEST.md` (this), `PLAN.md`, `REVIEW.md`, `IMPLEMENTATION.md`, `TEST-REPORT.md`, `RESULT.md`, `baseline.sha256`.
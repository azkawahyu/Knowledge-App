# REQUEST — Phase 2: FTS Search + Auth Token Persistence

PROJECT ROOT: D:\Develop\knowledge-app
PHASE ID: phase2-fts-auth
STARTED: 2026-11-02
PREDECESSORS (both PASS): `.pipeline/phase1/RESULT.md` (multipart upload), `.pipeline/f1/RESULT.md` (blob orphan fix)
READ FIRST: `.pipeline/f1/RESULT.md` (§5 guarantees the fix must not break), `.pipeline/phase1/RESULT.md` (§6–7 known issues), `.pipeline/f1/TEST-REPORT.md`

## Two independent subtasks — both must pass, tested separately

# F2-A — PostgreSQL full-text search correctness

## Confirmed defect (orchestrator-verified by live curl in Phase 1)
`POST /api/search` ignores the query for matching purposes. `server/src/routes/search.ts:34-53` has **no `@@` predicate**: it selects every chunk, orders by `ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english', $2))`, and applies `LIMIT`. So `q = "zzzznotfound"` returns unrelated chunks (verified: 1 result for a nonsense query).

## Verified facts to build on
- `chunks` has a GIN index `chunks_fts_idx ON to_tsvector('english'::regconfig, text)` — it already matches the intended `plainto_tsquery`/`websearch_to_tsquery` language, so a matching predicate can use it.
- `default_text_search_config` = `pg_catalog.english`; ingestion chunks with the same `english` config.
- Access filtering today is `d.access_policy = $1 OR $1 = '*'` (`:45`), default `'*'`. `documents.access_policy ∈ {public, trusted, restricted}`. `access_policies` table exists but is unused by search.
- Response shape today: `{ query, limit, results[] }` with each result `{document_id, document_name, document_policy, chunk_id, text, page_no, start_char, end_char}`.
- Consumers: `web/src/app/dashboard/retrieve/page.tsx` and `web/src/app/dashboard/chat/page.tsx` call `api.search`. `web/src/app/dashboard/library/page.tsx` and `audit/page.tsx` call `api.search` **only as a workaround** for their real endpoints (`/api/library`, `/api/audit`) — rewiring those is **out of scope**.

## Acceptance criteria
1. A query with no lexical match returns **zero** `results` (e.g. `zzzznotfound`).
2. A matching query returns exactly the chunks that match, ranked (best match first); rank ordering is asserted, not assumed.
3. Multi-word queries behave per a documented rule (AND semantics via `plainto_tsquery`/`websearch_to_tsquery`, quoting/phrase support per the chosen function).
4. Empty / whitespace-only `q` → safe behaviour (plan must choose: 400 like today, or `results: []`); never a 500 and never "all chunks".
5. Malformed input (special characters, `'`, `"`, `:`, `*`, `&`, `|`, `!`, very long strings, non-string `q`, `limit` out of range) → no SQL error, no 500; parameterised SQL only.
6. Access policy enforcement preserved and *not weakened*: `policy='*'` keeps today's "all policies" meaning, an explicit policy filters, and no result may carry a `document_policy` the filter excluded.
7. Response shape backward-compatible (`query`, `limit`, `results[]`, same field names) so the existing Retrieve/Chat pages keep working unchanged.
8. Empty query string must not silently return the whole library (today `api`/Library relies on that accident — flag as a follow-up, do not fix other pages).
9. Index changes only if justified by measured EXPLAIN evidence; no unrelated schema changes; any migration must be additive and reversible.
10. `npx tsc --noEmit` exit 0; Phase 1 upload + F1 ingestion behaviour unaffected.

## Out of scope for F2-A
Semantic/vector search, LLM, fuzzy/trigram, synonyms, highlighting (`ts_headline` optional/nice-to-have only if it does not change the response schema), Library/Audit rewiring, Chat implementation, access-policy *design* changes (row-level per-user policy), audit logging of searches.

# F2-B — auth token persistence & rehydration

## Confirmed defects (orchestrator-verified by reading code)
1. Token lives in a module variable `web/src/lib/api.ts:3`, set by `setToken` (`:9`) and cleared on 401 (`:29-33`). The login form persists it to `localStorage["ka_token"]` (`login-form.tsx`), but **nothing ever reads it back into the client** — so after a reload every protected request goes out without `Authorization` and the backend returns 401. (Observed live in Phase 1's browser test.)
2. `web/src/app/dashboard/layout.tsx` redirects to `/login`, but **no `/login` route exists** (`src/app/page.tsx` is the login form at `/`). The redirect is a dead end.
3. `web/src/app/dashboard/header.tsx` "Sign out" only does `localStorage.removeItem` + `push('/login')` — it never clears the in-memory token and never calls `api.logout`; `api.logout` (`api.ts:56-59`) calls `POST /api/auth/logout`, **which does not exist on the backend** (404).
4. JWT has a 12 h expiry (`routes/auth.ts`), no refresh, no server-side revocation store.

## Acceptance criteria
1. **One source of truth** for the token, with a documented init order; no path may read `localStorage` directly for auth decisions outside that module (the plan must state which module owns it).
2. After a full browser reload of any `/dashboard/*` page, protected requests succeed (token rehydrated before the first API call).
3. No protected request may be issued before rehydration completes (document how this is guaranteed — e.g. hydration gate in the dashboard layout, not a race).
4. Missing token → user is sent to the login route that actually exists, with no infinite redirect loop.
5. Expired/invalid token → 401 clears the persisted state and returns the user to login (no stale loop, no crash).
6. Logout clears **both** persisted and in-memory state, and a reload after logout does **not** restore the session.
7. `/api/auth/logout` exists if the client calls it — either implemented (stateless: acknowledge + audit, no revocation store) or the client stops calling it. The plan must justify the choice; JWT logout is primarily client-side unless a revocation store is added (which is out of scope).
8. Login behaviour preserved (same credentials, same redirect target).
9. No new auth dependency; no weakening of JWT validation or `authMiddleware`.
10. **Security trade-off documented, not silently changed**: localStorage vs HttpOnly cookie (XSS exposure, CSRF, `SameSite`, the fact that the API is on a different origin `:4000` than the app `:3000`). Changing to cookies requires backend CORS/credential work — out of scope unless the reviewer rules otherwise.
11. `web` builds/typechecks (`npx tsc --noEmit` in `web/`) and `next build` is not required (do not break `next dev`).

## Out of scope for F2-B
Routing redesign, new pages beyond what is strictly needed, refresh-token architecture, server-side revocation/blacklist store, moving API to same-origin proxy, Library/Audit/Chat/Inbox feature work, password policy, admin user management.

## Global scope restrictions
Chat/LLM, semantic/vector search, Audit redesign, Library redesign, new ingestion features, blob GC, broad repo cleanup, unrelated security refactoring. Record such findings as follow-ups only.

## Data safety
- Never truncate or reset the DB. Public schema currently `documents=0, chunks=0, admins=1, audit_log=0`; `f1test` schema exists from F1 tests (181 docs) — **do not touch or drop it** unless the user approves.
- Use isolated fixtures (own documents/chunks, ideally in a scratch schema or with unique hash/name prefixes) and remove exactly your own rows by id afterwards.
- No secrets or JWT values in logs or reports (redact).

## Deliverables
`.pipeline/p2/` : REQUEST.md (this), PLAN.md, REVIEW.md, IMPLEMENTATION.md, TEST-REPORT.md, RESULT.md, baseline.sha256.
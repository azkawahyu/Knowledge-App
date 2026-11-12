# RESULT — Phase 2: FTS search + auth token persistence

**Orchestrator final review:** `FINAL_REVIEW: PASS`

| Verdict | Value |
|---|---|
| **F2-A (search)** | **PASS with one known limitation** (`FU-AC5-BIGQ`, unfixed, documented) |
| **F2-B (auth)** | **PASS** — verified at browser level (JS-executed end-to-end, not just XHR-equivalent) |
| **Integration** | **PASS** — real HTTP + real browser: login → reload → authenticated search → logout → expired/invalid token → redirect |
| **Overall** | **FINAL_REVIEW: PASS** |

Date: 2026-11-02 · Pipeline: Planner → Plan Reviewer (3 rounds + N-6 closure) → Implementer (A, B, A8 fix) → Independent Test Engineer → Orchestrator browser verification.

---

## 1. Root cause of each issue

**F2-A — search ignored the query.** `server/src/routes/search.ts:34-53` had **no `@@` predicate**: it selected every chunk, ordered by `ts_rank(...)` and applied `LIMIT`. Ranking a non-match yields `0`, and `ORDER BY 0 DESC` is stable, so any query returned the whole library in insertion order. Verified live before the fix: `q="zzzznotfound"` returned a chunk. The defect was **latent on an empty database** — which is why the plan's test strategy required a seeded fixture plus a "pre-fix must return 10" gate; a "0 results" assertion on an empty table would have passed without fixing anything.

**F2-B — the token was never rehydrated.** Three independent defects:
1. `web/src/lib/api.ts:3` kept the JWT in a module variable; only the login form ever set it. The persisted copy (`localStorage["ka_token"]`) was **written but never read**, so after a reload every protected request went out with no `Authorization` header → 401.
2. `web/src/app/dashboard/layout.tsx` redirected to `/login`, and `web/src/app/login/` was an **empty directory** — a 404, not a login page.
3. Sign-out only did `localStorage.removeItem`, leaving the in-memory token alive, and `api.logout()` posted to `/api/auth/logout`, **which does not exist** in `server/src` (no `logout` string anywhere) → always 404.

---

## 2. Files changed

| File | Change | Purpose |
|---|---|---|
| `server/src/routes/search.ts` | 4 hunks | One guard (`typeof q !== 'string' \|\| !q.trim()`), parenthesised policy clause, **`AND to_tsvector('english', c.text) @@ websearch_to_tsquery('english', $2)`**, deterministic tiebreaker `d.id, c.start_char NULLS LAST, c.id`. Response shape unchanged. |
| `web/src/lib/api.ts` | rewritten owner module | `STORAGE_KEY`, `hydrated`, `logoutSignalled`; `hydrateToken()` (single reader, **one-shot**, and **never clobbers a fresher in-memory token**), `getToken()`, `setToken()` (single writer of both stores; re-arms the latch only for a non-null token), `startSession()` (the "new session" moment), `isHydrated()`, `clearSession()`; `request()` hydrates first; 401 → `clearSession()` + **exactly one** `ka:logout` event; `api.logout` **deleted**. |
| `web/src/app/dashboard/layout.tsx` | hydration gate | `hydrateToken()` → no token ⇒ `router.replace("/login")` → else `setReady(true)`; children rendered only when ready; `ka:logout` listener with cleanup; `<Header authVersion={ready ? 1 : 0} />`. |
| `web/src/app/dashboard/header.tsx` | 3 hunks | `:11` `localStorage.getItem` → `getToken()`; `:41` `removeItem` → `clearSession()`; `push` → `replace`; re-derives the username when `authVersion` changes (fixes the reload-username gap the Test Engineer found). |
| `web/src/components/login-form.tsx` | −3 lines | `localStorage.setItem` deleted; `setToken` → `startSession`. |
| `web/src/app/login/page.tsx` | **new** | Makes `/login` a real route (kills the 404). |
| `web/scripts/f2b-hydration.mjs` | **new** | Executable harness: 13 assertions (S1, A1–A13), no new dependency. |
| `web/next.config.mjs` | 1 key | `distDir: ".next-build"` so a build cannot destroy `web/.next` (see §7). |
| `web/tsconfig.json` | 1 line | `include` follows `distDir`; the stale `.next/types` glob dropped. |

**Not changed:** `server/src/app.ts`, every other route, `middleware/**`, `db/**`, `ingest/**`, `schema.ts`, both `package.json`s, `dist/**`, `web/src/app/page.tsx`, and all other dashboard pages.

---

## 3. Database migrations and indexes

**None.** No schema change, no new index. The EXISTING `chunks_fts_idx` (`gin(to_tsvector('english'::regconfig, text))`) already matches the new predicate's expression tree; EXPLAIN on a 10 011-chunk fixture showed `Seq Scan` (99.58 ms) because the fixture is tiny, so "no index change" was ruled structurally rather than on a measurement (§A2.8). No data written to `public` by any phase step.

---

## 4. Search verification

| Check | Result |
|---|---|
| Nonsense query `zzzznotfound` | **200** `{"limit":0,"results":[]}` — live, orchestrator + Test Engineer |
| Pre-fix SQL on the same seeded fixture | **10 rows** — the fix is discriminating, not vacuous |
| Matching queries (`escalation`=5, `pager`=3, `apricot marmalade`=1) | HTTP result set **== SQL result set** on every case |
| Rank ordering | Verified on `escalation pager`: `0.099103 > 0.097359 > 0.095243`, order ≠ tiebreaker-only order |
| Empty / whitespace / non-string `q` | **400** `q (query string) is required` (one guard, verbatim message) |
| Lexeme-less (`the and or`, `!!!`, `-`) | **200 + `[]`** — never the whole library |
| Injection-shaped input (`'; DROP TABLE chunks; --`) | **200**, table intact |
| `policy` filtering | no result may carry an excluded `document_policy` (Test Engineer, seeded `p2verify` schema) |
| No auth | **401** `Missing or invalid bearer token` |
| Single-token 100 000-char query | **200** |

**Known limitation (documented, not fixed): `FU-AC5-BIGQ`.** A **multi-word** query of roughly ≥86 889 characters (`~14 000 terms`) returns **500 `{"error":"Search failed"}`** because `websearch_to_tsquery` overflows the parser stack (`54001 stack depth limit exceeded`), at `search.ts:41`. It is reachable inside the 1 MB JSON body limit. Fixing it means adding a length guard — a new error contract the reviewer explicitly ruled out of scope for this phase — so it is recorded as a follow-up with the exact reproduction numbers.

---

## 5. Authentication verification (browser level)

Executed in a **real browser session** against `next dev` (:3000) + the API (:4000):

| Step | Observed |
|---|---|
| Sign in with the demo credentials | `/dashboard`, `localStorage.ka_token` present (213 chars), header shows `admin` |
| **Hard reload** `/dashboard/retrieve` | still `/dashboard/retrieve`, token survives, **header shows `admin`**, page functional |
| Search after reload | returned **`Results (0)`** for `zzzznotfound` → the request carried `Authorization` and reached the fixed search route (a missing header would have produced a 401 error state) |
| Sign out | → `/login`, `ka_token` = `null` |
| Reload `/dashboard` after logout | stays on `/login` — the old session **does not** come back |
| Invalid/expired token on `/dashboard/library` | → `/login`, token cleared (the 401 → `ka:logout` → redirect path works end-to-end) |
| No token on `/dashboard` | → `/login` (no redirect loop) |

Harness corroboration: `node --import ./server/node_modules/tsx/dist/loader.mjs web/scripts/f2b-hydration.mjs` → **`RESULT: PASS`**, exit 0 (35 PASS lines across 13 assertions), re-run by the orchestrator and by the Test Engineer.

**Anti-vacuity (mutation-tested, not assumed):**

| Mutation | Effect |
|---|---|
| `hydrateToken` returns immediately | RED — A2, A3, A7 fail |
| `setToken` stops persisting | RED — A4a, A9 fail |
| logout latch removed | RED — A6 (2 events) |
| `hydrateToken` clobbers a fresh token | RED — A8 (`expected="fresh-value" actual="stale-value"`) |

Two vacuity defects were found and **fixed during this phase**: A8's original precondition staged the "stale" value *before* `setToken`, which by design overwrote it (the assertion was tautological); and the plan's round-1 latch formula re-armed inside `setToken(null)`, making a double-401 emit **two** events. Both corrections are recorded in `PLAN.md` §0c/§B2.4a (N-6f, N-6h) so they cannot be reintroduced.

---

## 6. Security considerations

- **localStorage is kept, deliberately and with the trade-off written down** (§B2.6): a JWT in `localStorage` is readable by any XSS; an HttpOnly cookie would remove that class of theft but requires server-side cookie issuing, `Access-Control-Allow-Credentials`, and `SameSite` work across the `:3000`/`:4000` split — out of scope here, documented rather than silently changed.
- JWT validation is untouched: `middleware/auth.ts` still verifies with `jwt.verify` and the 12 h expiry; no client-side `exp` pre-check was added (the server stays authoritative — a client check would be UX theatre and a second JWT parser).
- `api.logout` and the phantom `/api/auth/logout` call are **gone**; logout is client-side state clearing, which is honest for a stateless JWT (no revocation store exists, and none was added).
- One owner module: verified by grep — `localStorage`/`sessionStorage` appears in **exactly one file**, `web/src/lib/api.ts`. `ka_token` likewise. No secret, token or `.env` value appears in any report or log (tokens reported by length only).
- **Open security-adjacent follow-up (#2 below):** `limit: 0` returns 10 rows instead of 1… — a caller-input clamp bug, not a leak, but it returns more than asked.

---

## 7. Actual commands and outputs (selected, verbatim)

```
cd server && npx tsc --noEmit                     -> exit=0
cd web    && npx tsc --noEmit                     -> exit=0
cd web    && npx next build                        -> "✓ Compiled successfully", 12/12 static pages, /login present, exit=0
sha256sum -c .pipeline/p2/baseline.sha256          -> 38 entries, 0 FAILED
node --import ./server/node_modules/tsx/dist/loader.mjs web/scripts/f2b-hydration.mjs
                                                   -> RESULT: PASS, exit=0
curl -X POST :4000/api/search -d '{"q":"zzzznotfound"}'   -> HTTP 200 {"query":"zzzznotfound","limit":0,"results":[]}
curl -X POST :4000/api/search -d '{"q":"   "}'            -> HTTP 400 {"error":"q (query string) is required"}
curl -X POST :4000/api/search   (no Authorization)         -> HTTP 401 {"error":"Missing or invalid bearer token"}
```

---

## 8. Remaining limitations

1. **`FU-AC5-BIGQ`** — multi-word queries ≥ ~86 889 chars → 500 (parser stack depth). Not fixed by design decision.
2. **`limit: 0` → 10** (`search.ts:31`, `Number(limit) || 10` treats 0 as falsy). Pre-existing, one-line fix, filed.
3. **`f1test` schema** (5 tables, 182 documents) still exists from the F1 phase — created for test isolation, not product data. Dropping it needs your approval: `psql "$DATABASE_URL" -c "DROP SCHEMA f1test CASCADE;"` (**not** run by me).
4. **`.tmp_probe/`** (`mod.ts` 190 B, `run.mjs` 108 B) still in the project root, awaiting your approval to delete: `rm -rf D:/Develop/knowledge-app/.tmp_probe`.
5. **Library and Audit pages remain broken by design-accident** — they call `api.search({q:""})` on mount, which has always returned 400 (and now correctly still does). They need rewiring to `/api/library` and `/api/audit` (out of scope, carried from Phase 1).
6. **No DOM test library** — the render-gate claim ("no protected request before the gate opens") is proven by browser behaviour here, not by an automated test; a future CI would need jsdom or Playwright.
7. **`jq` is not installed** on this machine; the plan's literal Part A shell harness cannot run as written (the Test Engineer re-implemented it in Node).

---

## 9. Recommendation for Phase 3

**Phase 3 — rewire Library and Audit to their real endpoints (`/api/library`, `/api/audit`) and add server-side audit logging**, because: (a) both pages are user-visibly broken today and their 400 is *correct* behaviour that will not fix itself; (b) `audit_log` has been empty since Phase 1 — nothing writes to it, so the Audit page has nothing to show even once wired; (c) it is the last remaining "the UI works" gap after upload (Phase 1), ingestion integrity (F1), search (F2-A) and session durability (F2-B). Pair it with the small `limit: 0` clamp fix and, if you want a CI gate, a jsdom/Playwright harness so the render gate and the manual steps become automated. `FU-AC5-BIGQ` can ride along if a length guard becomes acceptable.

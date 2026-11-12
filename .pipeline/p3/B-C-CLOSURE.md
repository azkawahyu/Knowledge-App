# B-C-CLOSURE — closure proposals for F3-B / F3-C blocking findings

PRODUCED BY: independent recovery Test Engineer + closure analyst (2026-11-02), re-verified by the Orchestrator against the live token payload before being written here.
STATUS OF THE SOURCE: the subagent's report was delivered in-chat and **never persisted to disk** — this file reconstructs its six proposals verbatim-in-substance so the planner can apply them. `TEST-REPORT.md` (the same run's F3-A verdict) is likewise reconstructed below in §0.

Every edit below is written to be applied **verbatim** by the Planner to `.pipeline/p3/PLAN.md` (1394 lines, `DONE:PLANNER_P3_REV1`). Line numbers refer to that revision.

---

## 0. Reconstruction note — F3-A verdict (the missing TEST-REPORT)

`F3-A: FAIL` as delivered, on exactly one defect: the pagination cursor was built from a JS `Date`, which floors sub-millisecond `created_at`; a row with `.123456` falls behind a `.123` cursor and is skipped forever while `total` still counts it. **That defect has since been fixed by the Orchestrator** (`server/src/routes/library.ts`: the cursor timestamp is re-read via `to_char(created_at AT TIME ZONE 'UTC','…US"Z"')`) and re-proved: 6 rows with `.124 / .123999 / .123456 / 10:00×3` at `limit=2` → `fetched 6, unique 6, declared total 6, MISSING: none → GAP-FREE`. F3-A is therefore **PASS** in `.pipeline/p3/RESULT.md`, and the 13/13 other acceptance criteria were independently verified at that time.

---

## C-1 · JWT claim mismatch breaks `requireAdmin` and the actor identity (F3-B)

**Proven at runtime, not merely read:** the login response contains `user.id = 0eabfa84-…`, but `jwt.decode(token)` yields keys `['sub','username','iat','exp']` — `payload.sub = 0eabfa84-…`, **`payload.id = undefined`**. `middleware/auth.ts:19-20` assigns that payload to `req.user` while typing it `{ id, username }`. Therefore **`req.user.id === undefined` at runtime** and the planned `requireAdmin` guard can never fire.

**Apply these edits:**

1. **New §B-D10a — insert immediately after B-D10's closing paragraph (after line 582):**
   > **Identity is asserted from the token payload, and `sub` is the only identifier.** `auth.ts:27` signs `{ sub: row.id, username }`; `middleware/auth.ts:19-20` assigns that payload to `req.user` while typing it `{ id, username }`. Therefore **`req.user.id` is `undefined` at runtime** and **`req.user.sub` is the authoritative id**. B must derive the actor's id as `req.user?.sub` and the actor's username as `req.user?.username`. No change to `auth.ts`, `middleware/auth.ts`, `db/schema.ts` or the token shape is made in phase 3; fixing the `{id}` cast is recorded as **FU-C1**.

2. **§B3.2 (lines 549–550, both event rows):** replace the actor expression with `req.user?.username ?? null`, and state once above the table:
   > `actor` for every authenticated event is `req.user?.username`; the id is `req.user?.sub`. **`req.user.id` MUST NOT be referenced anywhere in B** (it is `undefined`).

3. **§B4 — add `T-B21`** (the round-1 ask; `grep` confirms no `T-B21` exists today):
   `T-B21 | unit, no DB | assert(!AUDIT_ACTIONS.includes('auth.logout'))`
   and **add `T-B22`**:
   > with a token minted by the real `POST /api/auth/login`, the row written by an `ingest.upload.success` has `actor === 'admin'` **and** the id passed to `recordAudit` equals `jwt.decode(token).sub` — **not** `undefined`. Discriminates: today `req.user.id` is `undefined`.

4. **§B4 — add `T-B23`** (B's own AC5, which round 2 found missing):
   > `requireAdmin` called with `req.user === undefined` → `403 {"error":"Forbidden"}`; called with a verified `req.user` → `next()` is called. Gated in **B**, not only in C's T-C10.

---

## C-2 · `next_cursor` rule contradicts R-A3 / §C3.5 (F3-C)

**Line 1003** currently reads `next_cursor` — string iff `rows.length === limit`, else `null`. That is the **pre-pop** count and would re-introduce the trailing empty page that CQ2/R-A3 removed.

**Replace line 1003 verbatim with:**

> - `next_cursor` — **`string` iff the server had more rows than it returned**, i.e. iff the `LIMIT $8 + 1` probe row was present (`hasMore === true` **before** the pop), else `null`. It is computed from the **last surviving row after the probe row is popped** and equals `encodeCursor({t, i})` of that row. It is **never** computed from `rows.length === limit`: for exactly `limit × N` rows that test yields a cursor to a non-existent page, which CQ2/R-A3 forbid.

**And in §C3.5, after the code block at line 1062, add:**

> **Order matters:** `hasMore` is captured from the raw `r.rows.length > lim` **before** `rows.pop()`; `next_cursor` is built **after** the pop from `rows[rows.length-1]`. Reversing these two lines reintroduces the CQ2 defect.

---

## C-3 · `attempted` dropped from the display allow-list (F3-C)

**Line 1002** allow-list reads `outcome, reason, name, kind, access_policy, chunk_count, deduplicated, error, q, returned, limit` — **no `attempted`** — while BQ1 (line 632), line 914 (`'chunk_count','deduplicated','attempted'`) and the fixtures at lines 1147/1148/1155/1158 all **require** it. As written, `pickDisplayDetail` silently drops it from every failed-login row.

**Replace the line-1002 list verbatim with:**

> `outcome, reason, attempted, name, kind, access_policy, chunk_count, deduplicated, error, q, returned, limit`

**And add:**

> This list **must equal** the server-side list in `routes/audit.ts` (line 914) and the `pickDisplayDetail` key array in `audit/format.ts`; `T-C6` asserts all three are equal **as sets and in this order**. `attempted` is rendered as plain text, length-capped at 64 characters, never as HTML.

---

## C-4 · `page-format.test.ts F1..F8` gated but undefined (F3-C)

`§F2` names `F1..F8`; nothing in the plan defines them.

**Replace the §C4 prose sentence with this table:**

| ID | Assertion (exact) |
|---|---|
| **F1** | `pickDisplayDetail({outcome:'success',q:'x',secret:'s'})` → `{outcome:'success', q:'x'}` — unknown keys dropped |
| **F2** | `pickDisplayDetail({attempted:'p3c-invalid',reason:'invalid_credentials'})` → both keys retained (proves C-3) |
| **F3** | `pickDisplayDetail(null)` and `pickDisplayDetail(undefined)` → `{}`, never `null` and never a throw |
| **F4** | `outcomeOf({outcome:'failure'})` → `'failure'`; `outcomeOf({})` → `'—'`; `outcomeOf({outcome:42})` → `'—'` |
| **F5** | `formatTs('2026-11-02T07:41:20.004Z')` → deterministic `YYYY-MM-DD HH:MM:SS`; `formatTs(garbage)` → `'—'` |
| **F6** | `describeError(new Error('Forbidden'))` → `'forbidden'`; `…('Unauthorized')` → `'unauthorized'`; `…('boom')` → `'error'` |
| **F7** | `formatTs` is timezone-stable: the same input yields the same output under `TZ=UTC` and `TZ=Asia/Bangkok` |
| **F8** | `pickDisplayDetail` never returns a key outside the C-3 allow-list, for a row containing every forbidden key name in one object |

---

## C-5 · No mapping between URL `from`/`to` and bind `fromTs`/`toTs` (F3-C)

§C3.2 defines URL names `from`/`to`; §C3.5's bind array uses `fromTs`/`toTs`; `req.query` appears **nowhere** in the plan. As written, date filters are silently dropped.

**Insert as new §C3.4a, after the C3.2 table:**

> **C3.4a — Parameter plumbing (URL → TypeScript → SQL).** The route MUST parse and validate in this order, and the bind array MUST be built from the *validated* locals:
> ```ts
> const fromRaw = typeof req.query.from === 'string' ? req.query.from : '';
> const toRaw   = typeof req.query.to   === 'string' ? req.query.to   : '';
> const fromTs = fromRaw ? new Date(fromRaw) : null;   // '' -> null, never ''
> const toTs   = toRaw   ? new Date(toRaw)   : null;
> if (fromTs && Number.isNaN(fromTs.getTime())) return res.status(400).json({error:'Invalid from timestamp'});
> if (toTs   && Number.isNaN(toTs.getTime()))   return res.status(400).json({error:'Invalid to timestamp'});
> if (fromTs && toTs && fromTs > toTs)          return res.status(400).json({error:'from must be <= to'});
> ```
> Names are fixed: **URL `from`/`to`** ↔ **locals `fromTs`/`toTs`** ↔ **`$4`/`$5`**. Bind `fromTs`/`toTs` **only** — never the raw strings (an empty string raises `invalid input syntax for type timestamp with time zone`). Add **`T-C13b`**: `?from=…10:00:00Z&to=…05:00:00Z` → `400 {"error":"from must be <= to"}`; `?from=not-a-date` → `400 {"error":"Invalid from timestamp"}`; `?from=…05:00:00Z` → only rows at/after that instant, and the test **fails if `$4` is bound as `null`** (the "silently dropped" discriminator).

---

## Note on T-C3's arithmetic — closed by C-2, not a separate finding

The `LIMIT+1` algorithm was simulated: **7 requests do produce 13 rows**, terminal page `rows=1`, `next_cursor=null`. T-C3 is arithmetically **correct as written**; it only looked impossible because the erroneous `rows.length === limit` rule was in place. Applying C-2 makes it reachable. **No further edit required.**

---

## Scope guard for the planner

Applying these six items adds **no** new file to the touch matrix beyond what `REVIEW.md` round 2 already approved: B → `server/src/audit/{events,sanitize,log}.ts`, `server/src/middleware/require-admin.ts`, call sites in `routes/{auth,ingest,search}.ts`; C → `server/src/routes/audit.ts`, `web/src/app/dashboard/audit/{page.tsx,format.ts}`, `web/scripts` test. **Nothing may touch** `db/schema.ts`, `ingest/service.ts`, `middleware/auth.ts`, `routes/auth.ts` (only its *call site* for logging), `web/src/app/dashboard/library/**`, `server/src/routes/library.ts`, `.pipeline/p2/**`, `.pipeline/p3/f3a-*.log`, `f1test`, or `.tmp_probe`.

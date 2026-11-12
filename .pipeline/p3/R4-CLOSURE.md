# R4 CLOSURE — the two remaining plan defects (F3-B / F3-C)

Input: `.pipeline/p3/REVIEW.md` §ROUND 4 REVIEW (starting line 619; verdicts `F3-B: REVISE` / `F3-C: REVISE` at 621/622).
Scope: these two edits only. No structural rework, no new files, no new questions. Everything else in round 4 is non-blocking.

---

## R4-B/1 — `auth.login.failure`'s actor expression is `null` by construction

**The defect.** The call site for `auth.login.failure` reads `actor: req.user?.username ?? null`. But `server/src/app.ts:51` mounts the auth router with **no** `authMiddleware`:

```
51:  app.use('/api/auth', authRouter);          <- no authMiddleware
53:  app.use('/api/ingest', authMiddleware, ingestRouter);
...
57:  app.use('/api/audit', authMiddleware, auditRouter);
```

So at that call site `req.user` **cannot** be populated, the expression is always `null`, and it is structurally identical to the `req.user.id` trap that §B-D10a forbids. Worse, **`T-B9` passes on it** — which makes AC3's "actor derived from the verified JWT" **false for that event as written**.

**Required edit (apply verbatim).**

Replace the `auth.login.failure` row's actor cell in §B3.2, and add the paragraph beneath the table:

> | `auth.login.failure` | `auth.ts` catch/branch where `verifyPassword` fails (today `:22-25`) | `auth.login.failure` | `admin:<sanitized candidate>` | **`actor = NULL` by rule** — see below | `{outcome:'failure', reason:'invalid_credentials', attempted:<sanitized candidate>, user_known:<boolean>}` |
>
> **`auth.login.failure` actor rule (binding).** This event fires on a route with **no authenticated context**: `app.ts:51` mounts `/api/auth` without `authMiddleware`, so `req.user` is necessarily absent. Two consequences, both mandatory:
> 1. `actor` MUST be written as the **literal `null`** — not `req.user?.username ?? null`, which is the same value by accident and is forbidden by §B-D10a's rule that no actor may be derived from a possibly-absent context. The code MUST NOT reference `req.user` on this path at all.
> 2. The candidate username goes **only** into `detail.attempted` (via `sanitizeActor`, ≤64 chars) and `resource` (`admin:<candidate>`, via `sanitizeResource`, ≤200 chars). It MUST NOT be promoted to `actor`.
> 3. `detail.user_known` records whether the supplied username matched an existing admin row (`true`/`false`), computed from the same SELECT the login handler already performs (`auth.ts:17-21`) — **after** the password check has failed. This is the only non-credential signal that makes a failed-login row useful for triage without trusting caller input.
>
> **AC3 restatement for this event (also binding).** AC3 says the actor must be derived from a verified JWT. For `auth.login.failure` there **is** no verified JWT, so the honest reading is: *the actor is explicitly `null` and the audit row must not claim one*. Every other event in the taxonomy derives `actor` from `req.user?.username` on a route that **does** mount `authMiddleware` (`app.ts:53-57`), and `T-B22` asserts that provenance against the decoded token's `sub`.

**Test changes (apply verbatim).**

- **`T-B9`** — replace its assertion with two parts, so it can no longer pass on the accidental-null expression:
  1. the written `audit_log` row for a bad-password login has `actor IS NULL` (**not** the attempted username), and
  2. a **source-level** assertion: the code path for this event contains **no** `req.user` reference — e.g. `grep -c 'req\.user' <auth route file>` counted **inside the failure branch only**, or a unit test that calls the real handler with a request object whose `user` getter **throws** (proving it is never touched). The getter-throws form is preferred: it is behavioural, not textual.
- **`T-B9b` (new)** — negative control: a **successful** login writes `actor = 'admin'` (from `row.username`), proving the failure path's `null` is deliberate rather than a copy of the success path with a missing field.

---

## R4-C/1 — `T-C3b`'s first leg is a false pass

**The defect.** `T-C3b` is described in the plan as "the only assertion that separates the two `next_cursor` rules". Its first leg uses a **13-row fixture at `?limit=13`**. Under the `LIMIT $1 + 1` rule the probe row is `13 + 1 = 14` rows requested, only 13 exist, so `hasMore === false` ⇒ `next_cursor === null`. Under the broken `rows.length === limit` rule, `rows.length (13) === limit (13)` ⇒ `next_cursor` **also** `null`. **Both rules agree, so the leg cannot discriminate.** (Its second leg, `?limit=1&action=search.query`, is correct and does separate them.)

**Required edit (apply verbatim).**

Replace `T-C3b`'s body with:

> **`T-C3b` — cursor-rule discriminator (replaces the single-leg form).** Two legs, both on the same 13-row fixture:
> - **Leg 1 (full final page, the case the old form got wrong):** `?limit=13`. The `LIMIT 14` probe finds nothing ⇒ `hasMore === false` ⇒ **`next_cursor === null` and `results.length === 13`**. The broken rule (`rows.length === limit`) also yields `null` here, so **this leg alone proves nothing** — it is retained only as the regression guard for "no trailing empty page".
> - **Leg 2 (the actual discriminator):** `?limit=12`. `LIMIT 13` finds 13 rows ⇒ `hasMore === true` ⇒ pop the probe ⇒ `results.length === 12`, **`next_cursor !== null`**, and following that cursor returns the remaining **1** row with `next_cursor === null`. The broken rule yields `rows.length (12) === limit (12)` ⇒ it would also emit a cursor here — **so the two rules agree on leg 2 as well**; the discriminating assertion is instead:
> - **Leg 3 (the one that truly separates them):** `?limit=13` on a fixture where the **exact multiple** case is exercised — 13 rows, `limit=13`: `LIMIT 14` ⇒ no probe row ⇒ `next_cursor === null`. Now delete one row and re-run `?limit=12` on 12 rows: `LIMIT 13` ⇒ no probe row ⇒ `next_cursor === null`, whereas the broken rule (`rows.length 12 === limit 12`) emits a **non-null cursor pointing at an empty page**. **Assert: `next_cursor === null` here.** This is the assertion that fails under the old rule and passes under `LIMIT+1`.
>
> Record in the test's comment: *legs 1–2 are shape guards; leg 3 is the discriminator; a run that reports leg 3 as PASS without the "delete one row" precondition BLOCKS.*

**Also required:** the plan's claim that `T-C3b` is "the only" separator must be softened to "the only **assertion** that separates them; `T-C2`'s page-count check corroborates it" — the current blanket claim is what let a non-discriminating leg be labelled load-bearing.

---

## Everything else from round 4 is non-blocking — recorded, not applied by this document

The reviewer's twelve non-blocking items (false bidirectional body↔gate claim, the brittle `'void recordAudit('` count, AC10's greps passing on a directory that does not exist yet, the stale `T-B16 (REMOVED)` citation, the Windows-incompatible `TZ=UTC npx tsx` recipe in F7) stay as **implementer-time notes**. They do not change any contract, and applying them to the plan would delay a phase that has already lost time to an infrastructure failure. They must be carried into `TEST-REPORT.md` so they are visible at final review.

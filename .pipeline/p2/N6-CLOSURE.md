# Part B — N-6 Closure Matrix and Handoff Record

DATE: 2026-11-02
PLAN REVISION: `PLAN.md` **1678 lines**, revision logs `§0` (round 1), `§0b` (Part B post-gate), **`§0c` (N-6 closure, new)**.
Scope: documentation corrections only. **No code, no tests, no installs, no DB writes, no deletions.**

## 1. Closure matrix — N-6a … N-6e → exact PLAN.md section

| n | Defect (REVIEW.md §ROUND 3 REVIEW — PART B) | Exact section changed | What now says what |
|---|---|---|---|
| **N-6a** | Prose claimed `setToken` sets `hydrated`; the code block and C4 said otherwise; **A8's outcome depended on which was true**, and A8 never stated how its module became hydrated | **§B2.1** (normative rule block, immediately after the code fence) + **§B3.1a.4 row A8** | Rule: `hydrateToken()` is the **only** operation that performs hydration (only place `hydrated` flips `false → true` on the normal path); `clearSession()` sets it **only** to suppress re-reads; **`setToken()` never reads or writes `hydrated`**. The stale sentence is corrected to "`clearSession()` — **never by `setToken()`**". A8 is a stated 4-step sequence: fresh module (`hydrated === false`) → `setToken("fresh-value")` → **assert `isHydrated() === false`** (BLOCK if `true`) → first-and-only `hydrateToken()` → expect `"fresh-value"`, with a falsification clause (`"stale-value"` ⇒ FAIL) |
| **N-6b** | `A11` could not pass: `offenders.length === 0` is impossible if the scan includes `api.ts`, and no exclusion was stated; §B3.4 also cited an `offenders` symbol defined nowhere | **§B3.1a.4 row A11** | Scan scope = **all of `web/src`**, skipping directories `node_modules`, `.next`, `dist`; match `/localStorage\|sessionStorage/`; **exactly one permitted exclusion: `web/src/lib/api.ts`** (the authorised owner). Expected `offenders.length === 0`, harness prints offender paths; falsification clause: re-introducing storage in `header.tsx`/`layout.tsx`/`login-form.tsx` ⇒ FAIL. `offenders` is now defined in the row that uses it |
| **N-6c** | Stale phrase "(in-memory only, today)" implied `setToken` already persisted | **§B1.2 step 1** | Reworded: "**Today (pre-fix)** `setToken` (`api.ts:9-11`) writes **the module variable only** — `:23` is what persists the token", plus an explicit pointer to assertion **A4(a)** and a statement that no blanket `localStorage === getToken()` equality is asserted (C5) |
| **N-6d** | Wrong cross-reference `§B2.3` for the `setToken` persist behaviour (no §B2.3 exists) | **§B2.4a table row** (`api.ts :9-11`) and **§B2.4 BEFORE/AFTER snippet**; plus two further stale refs found during closure: the harness precondition bullet and OQ-4 | All now point at **§B2.1 (+ §B2.4a)** / **§B2.5** (OQ-4). `grep -n "§B2.3"` returns only the N-6d log row itself, which describes the defect |
| **N-6e** | "no loader, no transpile" contradicted the very command that names a loader | **§B3.1a.1 Language row** | Rewritten: the `.mjs` file needs no transpile, but plain `node` cannot import a **TypeScript** module, so the harness is launched **with** `tsx`'s ESM loader; the exact command is cited instead of contradicted, and "no new dependency" is justified (`tsx` ships in `server/node_modules`; `web/` has none) |

## 2. Contradiction check — PLAN.md ↔ REVIEW.md ↔ A1–A12(–A13)

- **Assertion count is 13 (`S1`, `A1`…`A13`)** and unchanged by this revision. No assertion was weakened, removed or bypassed; A8 and A11 were *sharpened* (explicit preconditions, explicit BLOCK/falsification clauses).
- **C5 remains the single equality rule**: equality is claimed only at the two `setToken` moments; **A7**'s memory/storage divergence is explicitly permitted by C3/C5; **A4** asserts only the non-null and null cases. No pair of assertions can now contradict.
- **A6 / A12** (the `ka:logout` latch and its re-arm) are untouched, and §7.1 still explicitly authorises the dispatch line — B-2 stays closed.
- **B-1** (real listener registry in the shim, S1 self-test) and **B-4**'s mechanism (exact run command) are untouched; B-4's *precondition ambiguity* is what N-6a fixed.
- **REVIEW.md round 3 verdict is not edited and not overridden.** It still reads `PART B: REVISE`. This document is *evidence for re-review*, not an approval.

## 3. Revision record

| Item | Value |
|---|---|
| `PLAN.md` before | 1655 lines |
| `PLAN.md` after | **1678 lines** (+23: `§0c` log, N-6 rule block, A8/A11 rewrites, 4 cross-ref fixes) |
| Revision logs | `§0` round 1 · `§0b` Part B post-gate · **`§0c` N-6 closure** |
| Source files touched | **none** — `sha256sum -c .pipeline/p2/baseline.sha256` → 34 OK, and the single FAILED line is `server/src/routes/search.ts`, which is the **already-approved Part A implementation**, not part of this revision |
| DB / data dirs | untouched; `public` documents=0, chunks=0, admins=1, audit_log=0; `f1test` untouched |

## 4. Handoff

| Part | Plan status | Implementation status | Independent verification owed |
|---|---|---|---|
| **A** — search | `PART A: APPROVE` (REVIEW.md:386) | IMPLEMENTED (`IMPLEMENTATION-A.md`) | full re-run: T-A1…T-A10, guards G1–G8, discrimination (fixed 0 vs round-0 10), policy split, EXPLAIN rule, cleanup proof |
| **B** — auth | `PART B: REVISE` (REVIEW.md:549) — closure applied, **re-review or reviewer-accepted closure still outstanding** | to be implemented under §7.1's authorised diff | must prove **B-1…B-4 *and* N-6a…N-6e**, run A/S assertions **A1–A13** including their negative cases, and paste **real** execution output for `node --import ./server/node_modules/tsx/dist/loader.mjs web/scripts/f2b-hydration.mjs` |

**`[U-exec]` status: still open.** The harness command has never been observed executing successfully. Static inspection cannot close it; only the Test Engineer can, with pasted output (exit code + `RESULT: PASS` line).

**Scope independence:** Part A is confined to `server/src/routes/search.ts`; Part B to the five `web/` files + the new `web/scripts/f2b-hydration.mjs`. No shared file, no shared fixture (A uses the `p2test` schema, B uses no schema). Integration observation is read-only (Part A's route must answer 200 for a nonsense query while Part B's hydration supplies the header).

## 5. `.tmp_probe` — pending user approval, not deleted

| Fact | Value |
|---|---|
| Path | `D:\Develop\knowledge-app\.tmp_probe` |
| Contents (verified) | `mod.ts` (190 bytes), `run.mjs` (108 bytes) — created 2026-11-02 12:57 by the round-3 reviewer's loader probe |
| Baseline membership | **Not** in `baseline.sha256`; invisible to the hash gate |
| Status | **Still present.** A removal attempt was refused for lack of approval; no retry was made |
| Awaiting | explicit user approval. Suggested command when granted: `rm -rf D:/Develop/knowledge-app/.tmp_probe` |

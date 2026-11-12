### B3.1a Executable harness — `web/scripts/f2b-hydration.mjs` (R9, R10, R11, R12, R14; gate B-1/B-3/B-4; N-5a/N-5b/N-5d)

**Why this file exists:** §B3.2's API checks never exercise `hydrateToken`, `clearSession`, the layout gate or the `ka:logout` event, so a broken Part B fix could pass every automated check the round-0 plan had. This harness is the executable evidence for AC1/AC2/AC3/AC4/AC6.

#### B3.1a.1 Run contract — file, language, exact command, loader (closes **B-4**, N-5a)

| Item | **Final value — do not substitute** |
|---|---|
| **File** | `web/scripts/f2b-hydration.mjs` — **new file**, not in `baseline.sha256` (hash appended per §7.2) |
| **Language** | **JavaScript, ESM** (`.mjs`). Plain Node executes it directly — **no loader, no transpile, no build**. |
| **Module under test** | the **source** file `web/src/lib/api.ts`, imported through a TypeScript loader (below). The harness **never** reads `web/.next/**` and **never** runs `next build`; a stale `.next` cannot make it pass (N-5a). |
| **TS loader** | **`tsx`**, already a `devDependency` of `server/` (`server/package.json:35`, `"tsx": "^4.16.0"`; resolves to the already-installed `server/node_modules/.bin/tsx`). **No install, no new dependency, nothing added to `web/package.json`** (REQUEST forbids new deps). |
| **Exact run command** | run from the **repo root** `D:\Develop\knowledge-app`: |

```bash
cd /d/Develop/knowledge-app
node --import ./server/node_modules/tsx/dist/loader.mjs web/scripts/f2b-hydration.mjs; echo "exit=$?"
```

**Withdrawn as wrong in round 1 (recorded so they are not retried):**
- ~~`cd web && node scripts/f2b-hydration.mjs`~~ — plain Node cannot load `api.ts`; it throws `ERR_UNKNOWN_FILE_EXTENSION`.
- ~~`npx tsx scripts/f2b-hydration.mjs`~~ — `tsx` is **not** a dependency of `web/` (`web/package.json` verified this session: deps are react/react-dom/next; devDeps are typescript, @types/*, postcss, tailwindcss, eslint*). `npx` would therefore attempt a **network download** — a new dependency by another name, which the REQUEST forbids.

**Exit codes:** `0` = PASS (every assertion passed) · `1` = FAIL (≥1 assertion failed) · `2` = BLOCKED (a precondition was unmet; no assertion was judged).

**Fallback level — stated once, must appear verbatim in TEST-REPORT:** *"F2-B harness is **XHR-equivalent**: a real HTTP client (`fetch`) against the **real backend** on `:4000`, with the **real `api.ts` module** loaded, and **fake `localStorage`/`window`**. It is **not** a browser test; it does not render React, does not exercise `next/navigation`, and cannot see the DOM. The only DOM-level checks are manual §B3.1 steps 1–11."*

**Preconditions (checked before A1; any failure → exit 2 with the message shown):**

| # | Precondition | How it is checked | On failure (exact message, exit 2) |
|---|---|---|---|
| P1 | Backend is up and serving the **fixed** code | `POST /api/auth/login` `admin`/`admin123` | `BLOCKED: login returned <status>; backend not ready` |
| P2 | Demo credentials accepted (R18) | response status is not `401` | `BLOCKED: demo credentials rejected; ADMIN_PASSWORD may be overridden in server/.env` |
| P3 | A token was issued | `body.token` is a non-empty string | `BLOCKED: login returned no token` |
| P4 | `window`/`localStorage` shims installed | asserted internally before the first `import()` | (a throw here is a harness bug → exit 1) |

**Honesty:** the harness prints the token **length only**, never the token, never the password, never a secret.

#### B3.1a.2 The shims — real registry, real storage (closes **B-1**)

Both shims are installed on `globalThis` **before** the first `import()` of `api.ts`. The `window` shim is a **working event target**, not a recording stub: round 1's `addEventListener: () => {}` was a no-op, so `A5`'s `navigated` could never be non-zero and the assertion was vacuous (`REVIEW.md:397`).

```js
// web/scripts/f2b-hydration.mjs — shims, installed BEFORE any import of api.ts
const STORAGE_KEY = "ka_token";
const API = "http://127.0.0.1:4000/api";

// ---- localStorage shim: a real Map-backed store ----
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};

// ---- window shim: REAL listener registry (B-1 fix) ----
const registry = new Map();               // type -> Set<listener>
const dispatchedTypes = [];               // every dispatchEvent type, in order
if (typeof globalThis.Event !== "function") {      // Node < 19 fallback only
  globalThis.Event = class Event {
    constructor(type) { this.type = type; this.defaultPrevented = false; }
    preventDefault() { this.defaultPrevented = true; }
  };
}
globalThis.window = {
  addEventListener(type, listener /*, options */) {
    if (typeof listener !== "function" && typeof listener?.handleEvent !== "function") return;
    if (!registry.has(type)) registry.set(type, new Set());
    registry.get(type).add(listener);              // identity semantics, like the DOM
  },
  removeEventListener(type, listener) {
    registry.get(type)?.delete(listener);          // dereGISTER by identity
  },
  dispatchEvent(event) {
    dispatchedTypes.push(event.type);
    const listeners = Array.from(registry.get(event.type) ?? []);
    for (const l of listeners) {
      if (typeof l === "function") l.call(globalThis.window, event);
      else l.handleEvent(event);
    }
    return !event.defaultPrevented;
  },
};
globalThis.window.dispatchEvent(new Event("ka:selftest"));   // S1: shim sanity
```

`S1` is a **shim self-test**, run before `A1`: a listener registered on `ka:selftest` must fire. Its purpose is that a regression to a no-op shim makes the whole harness fail **loudly at the top** instead of silently passing `A5`.

#### B3.1a.3 The writer contract — stated once (closes **B-3**)

Round 1 contained two assertions that could not both hold: `A4` claimed `localStorage.getItem("ka_token") === getToken()` **unconditionally**, while `A7` legitimately left memory and storage **different** (memory `"stale-value"`, storage `"newer-value"`). One contract now governs every assertion:

| # | Contract clause | Consequence for assertions |
|---|---|---|
| **C1** | `setToken(t)` is the **sole writer** of the key. It **always** persists: `t !== null` → `setItem(key, t)`; `t === null` → `removeItem(key)`. It is idempotent. | `A4`, `A10` assert the **non-null** and **null** cases **separately**; neither claims equality across a `clearSession()`. |
| **C2** | `getToken()` returns the in-memory value and **never** reads storage. | `A1` is meaningful: a fresh module has memory `null` even while storage holds a token. |
| **C3** | `hydrateToken()` is the **sole reader**, and is **one-shot** (`hydrated` flag). After the first call it never re-reads storage. | `A7` (second call ignored) and `A8` (no clobber of a fresh `setToken`) are both **derived from C3**, not independent whims. |
| **C4** | `clearSession()` = `setToken(null)` **plus** `hydrated = true`, so no later `hydrateToken()` can resurrect the key. | `A9` follows from C1+C3+C4. |
| **C5** | Storage and memory are **equal only** immediately after `setToken(x≠null)`; they are **both empty** only after `setToken(null)`/`clearSession()`. **No assertion asserts equality at any other moment.** | Removes the A4/A7 contradiction. |

Testability of storage bytes: because the shim is a real `Map`, "the key is absent" is asserted as `store.has(STORAGE_KEY) === false` (strictly stronger than `getItem(...) === null`, which a `setItem(key,"null")` bug would satisfy).

#### B3.1a.4 Assertion specifications — precondition · operation · exact expected value

Every assertion below is stated as **(P) precondition → (O) exact operation → (E) exact expected value**. `freshApi()` = `await import(new URL("../src/lib/api.ts", import.meta.url).href + "?bust=" + n)` with an incrementing `n`; it yields a **new module instance** (`token === null`, `hydrated === false`, `logoutSignalled === false`) and is the harness's model of a page reload.

| Asrt | (P) Precondition | (O) Exact operation | (E) Exact expected value |
|---|---|---|---|
| **S1** | shims installed | register a listener for `ka:selftest`, dispatch `new Event("ka:selftest")`, remove it, dispatch again | counter `=== 1` after the second dispatch (i.e. exactly 1 total). `0` ⇒ no-op shim ⇒ **FAIL** |
| **A1** | `store` **pre-loaded** with a valid token; no module imported yet | `api = await freshApi()` → `api.getToken()` | **`null`** — memory is empty even though storage is populated (this *is* the reload condition; C2) |
| **A2** | A1's module instance | `api.hydrateToken()` → `api.getToken()` | **strictly equal** to the token string from `store.get(STORAGE_KEY)` |
| **A3** | A2 hydrated | `await api.api.search({ q: "zzzznotfound", limit: 10 })` | **resolves** (does not throw) and `Array.isArray(res.results) === true`; `res.results.length === 0` for `zzzznotfound` on the seeded fixture. Throwing `Error("Unauthorized")` ⇒ **AC2 FAILED**, do not adjust the harness |
| **A4** | fresh module; `store` empty | (a) `api.setToken(T)` where `T` is the real token; (b) then on a **second** fresh module `api.setToken(null)` | (a) `store.get(STORAGE_KEY) === T` **and** `api.getToken() === T` **and** `store.has(STORAGE_KEY) === true`; (b) `store.has(STORAGE_KEY) === false` **and** `api.getToken() === null`. **No equality claim is made outside these two moments** (C1/C5) |
| **A5** | fresh module; **valid** token in memory via `setToken(T)` | register `navigated` listener on `"ka:logout"` (**keep the reference**), `dispatchEvent(new Event("ka:logout"))`, then `removeEventListener("ka:logout", navigated)`, then dispatch **again** | after 1st dispatch `navigated === 1`; after `removeEventListener` + 2nd dispatch **still `navigated === 1`**. Both must hold: proves the listener fires **and** that removal works by identity (B-1) |
| **A6** | fresh module; `api.setToken("garbage.token.value")`; `dispatchedTypes.length = 0` | `await Promise.allSettled([api.api.search({q:"a",limit:10}), api.api.search({q:"b",limit:10})])` | `dispatchedTypes.filter(t => t === "ka:logout").length === 1` **and** both promises rejected with message **`"Unauthorized"`**. Two events ⇒ the latch (§B2.4a) is missing ⇒ **FAIL** |
| **A7** | fresh module; storage `"stale-value"` | `api.hydrateToken()`; then `store.set(STORAGE_KEY, "newer-value")`; then `api.hydrateToken()` again | `api.getToken() === "stale-value"` **and** `store.get(STORAGE_KEY) === "newer-value"`. **Note the deliberate divergence** — permitted by C3/C5; storage is ahead of memory because hydration is one-shot |
| **A8** | fresh module; storage `"stale-value"` | `api.setToken("fresh-value")`; then `api.hydrateToken()` | `api.getToken() === "fresh-value"` (hydration must not clobber a fresh session; C3) |
| **A9** | fresh module; storage holds `T` | `api.hydrateToken()`; `api.clearSession()`; record memory+storage; `api.hydrateToken()` again; record again | after clear: `getToken() === null` **and** `store.has(STORAGE_KEY) === false`; after the retry: `getToken() === null` **and** `store.has(STORAGE_KEY) === false` (no resurrection; C4) |
| **A10** | fresh module; storage holds `T`; **no** hydration | `api.clearSession()` | `api.getToken() === null` **and** `store.has(STORAGE_KEY) === false` — clearing works even when the token was never hydrated |
| **A11** | repo root reachable from the harness | read `web/src/**/*.ts,tsx` recursively with `node:fs`; count files whose text matches `/localStorage|sessionStorage/` and which are **not** `web/src/lib/api.ts` | **exactly `0`** files. This replaces round 1's hard-coded `ok("see §B3.2")`, which asserted nothing. Independent cross-check: §B3.2's two-sided grep, run by hand |
| **A12** | fresh module; storage holds `T`; `api.setToken("garbage.token.value")` → both 401s consumed (as in A6) | `api.setToken(T)`; `store.delete(STORAGE_KEY)`; then `api.api.search({q:"a",limit:10})` | `dummy`: the call must **succeed on the wire** (no `401`) and **no new `ka:logout`** is dispatched: `dispatchedTypes.filter(t => t === "ka:logout").length` stays at the A6 value. Proves `setToken` **re-arms** the latch (§B2.4a) — a latch that never resets would silently suppress a later real logout |
| **A13** | storage **empty**; fresh module | `api.hydrateToken()` → `api.getToken()` | **`null`**, no throw — a first-visit browser with no persisted token must not error (the `try/catch` around `localStorage`; `:838` region) |

**Assertion count: 13 (`S1`, `A1`…`A13`).** Round 1 advertised "11 assertions"; `A11` was vacuous and `A12`/`A13` did not exist, so the count changed. Any TEST-REPORT that cites a different count is reporting a different harness.

#### B3.1a.5 Assertion → AC map (regenerated from the final set)

| Asrt | What it proves | AC |
|---|---|---|
| **S1** | The `window` shim is a real event target (meta-assertion guarding A5/A6) | — (harness integrity) |
| **A1** | A fresh module equals a page reload: in-memory token is `null` while storage holds one | AC2 (precondition) |
| **A2** | `hydrateToken()` installs the persisted token | AC2 |
| **A3** | After hydration a protected call **succeeds** — executable twin of §B3.1 step 4 | AC2 |
| **A4** | `setToken` is the **sole writer** and persists **and** removes | AC1, AC6 |
| **A5** | `ka:logout` is delivered to a registered listener with a valid token present; removal works | AC3, AC6 |
| **A6** | A double-401 produces **exactly one** `ka:logout` and both calls still reject `Unauthorized` | AC3, AC6 |
| **A7** | Second `hydrateToken()` is a no-op (one-shot) | AC3 |
| **A8** | `hydrateToken()` after `setToken(x)` does not overwrite `x` | AC3 |
| **A9** | `clearSession()` cannot be resurrected by a later hydrate | AC5, AC6 |
| **A10** | `clearSession()` on a never-hydrated module clears both stores | AC6 |
| **A11** | No `localStorage`/`sessionStorage` reference outside the owner | AC1 |
| **A12** | `setToken` re-arms the logout latch (no permanently-suppressed logout) | AC3, AC6 |
| **A13** | First visit with empty storage hydrates to `null` without throwing | AC2 |

#### B3.1a.6 Implementation notes that are part of the spec, not left to the implementer

- Both shims **must be installed before** the first `import()` of `api.ts`; `?bust=` is how a reload is simulated.
- `api.ts` must **not** be imported at module top level; every use goes through `freshApi()`.
- A3 throwing `Unauthorized` is **AC2 failing** — never "fix" the harness.
- The harness prints the token **length only**.
- `A5`/`A6`/`A12` exercise the **event contract**, not React's router: they prove `api.ts` dispatches and that a listener receives it. That `layout.tsx`'s handler then calls `router.replace("/login")` is **not** proven here — it is **manual** (§B3.1 step 7). TEST-REPORT must state this limitation.
- The harness must be run **after** implementation of §B2.3/§B2.4/§B2.4a; `hydrateToken`, `clearSession`, `isHydrated` and the latch do not exist in the baseline `api.ts` (`web/src/lib/api.ts` currently exports only `getToken`, `setToken`, `api`), so `A2`–`A13` are **guaranteed to fail on the unmodified tree**. That is intended: it is what makes them non-vacuous.
- `A11`'s recursive walk uses `node:fs`'s `readdirSync(..., { recursive: true })` (Node ≥ 18.17; the toolchain here is Node 24) and skips `node_modules`, `.next` and `dist`.

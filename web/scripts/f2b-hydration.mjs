// web/scripts/f2b-hydration.mjs — Part B (F2-B) executable harness
// Spec: PLAN.md §B3.1a (S1, A1…A13 — 13 assertions). Node built-ins only; no new dependency.
//
// Run from the repo root (the ONLY supported command, §B3.1a.1):
//   node --import ./server/node_modules/tsx/dist/loader.mjs web/scripts/f2b-hydration.mjs
//
// Exit codes: 0 = PASS (every assertion passed) · 1 = FAIL (>=1 assertion failed) · 2 = BLOCKED (precondition unmet).
//
// Fallback level (§B3.1a.1, verbatim): "The F2-B harness is XHR-equivalent: a real HTTP client (`fetch`)
// against the real backend on :4000, with the real `api.ts` module loaded, and fake localStorage/window.
// It is not a browser test; it does not render React, does not exercise next/navigation, and cannot see
// the DOM. The only DOM-level checks are the manual §B3.1 steps 1–11."

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const STORAGE_KEY = "ka_token";
const API = "http://127.0.0.1:4000/api";
const MODULE_PATH = path.resolve("web/src/lib/api.ts"); // repo root is the cwd (run contract)
let failures = 0;
const ok = (m) => console.log(`PASS  ${m}`);
const bad = (m) => { failures++; console.log(`FAIL  ${m}`); };
const blocked = (m) => { console.log(`BLOCKED  ${m}`); process.exit(2); };

// Every assertion prints expected vs actual (both sides shown, never inferred).
// Secrets are never printed: any actual/expected value equal to the issued token is
// rendered as its length only (§B3.1a: "the harness prints the token length only").
let SECRET = null;
const show = (v) => {
  if (typeof v === "string" && SECRET && v === SECRET) return `<token:${v.length} chars>`;
  return typeof v === "string" ? JSON.stringify(v) : String(v);
};
function expect(name, expected, actual, pass) {
  const line = `${name}: expected=${show(expected)} actual=${show(actual)}`;
  pass ? ok(line) : bad(line);
  return pass;
}

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
globalThis.window = {
  addEventListener(type, listener /*, options */) {
    if (typeof listener !== "function" && typeof listener?.handleEvent !== "function") return;
    if (!registry.has(type)) registry.set(type, new Set());
    registry.get(type).add(listener);              // identity semantics, like the DOM
  },
  removeEventListener(type, listener) {
    registry.get(type)?.delete(listener);          // deregister by identity
  },
  dispatchEvent(event) {
    dispatchedTypes.push(event.type);
    for (const l of Array.from(registry.get(event.type) ?? [])) {
      if (typeof l === "function") l.call(globalThis.window, event);
      else l.handleEvent(event);
    }
    return !event.defaultPrevented;
  },
};

// ---- shims installed; now (and only now) the module under test may be imported ----
// P4: both shims must exist on globalThis before the first import() of api.ts.
if (typeof globalThis.localStorage !== "object" || typeof globalThis.window !== "object") {
  bad("P4 shims installed before first import(): expected=localStorage+window objects actual=missing");
}
let bust = 0;
async function freshApi() {
  // A "reload" = a fresh module instance with its own module-level state.
  return await import(pathToFileURL(MODULE_PATH).href + `?bust=${++bust}`);
}
async function login() {
  let r;
  try {
    r = await fetch(`${API}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123" }),
    });
  } catch (e) {
    blocked(`login returned ${e?.message ?? e}; backend not ready`);
  }
  if (r.status === 401) blocked("demo credentials rejected; ADMIN_PASSWORD may be overridden in server/.env");
  if (r.status !== 200) blocked(`login returned ${r.status}; backend not ready`);
  const j = await r.json();
  if (!j.token) blocked("login returned no token");
  return j.token;
}

// ---- preconditions ----
const TOKEN = await login();
SECRET = TOKEN;
console.log(`token acquired: ${TOKEN.length} chars`);   // length only

// =====================================================================
// S1 — shim self-test (meta-assertion guarding A5/A6)
// =====================================================================
{
  let n = 0;
  const listener = () => { n++; };
  window.addEventListener("ka:selftest", listener);
  window.dispatchEvent(new Event("ka:selftest"));
  window.removeEventListener("ka:selftest", listener);
  window.dispatchEvent(new Event("ka:selftest"));
  expect("S1 shim delivery+removal (count after 2nd dispatch)", 1, n, n === 1);
}

// =====================================================================
// A1 — reload condition: memory empty although storage populated
// =====================================================================
store.set(STORAGE_KEY, TOKEN);
let api = await freshApi();
{
  const got = api.getToken();
  expect("A1 fresh module getToken() with storage populated", null, got, got === null);
}

// =====================================================================
// A2 — hydrateToken() installs the persisted token
// =====================================================================
{
  api.hydrateToken();
  const got = api.getToken();
  const want = store.get(STORAGE_KEY);
  expect("A2 getToken() after hydrateToken() (=== store value)", want, got, got === want && got === TOKEN);
}

// =====================================================================
// A3 — after hydration a protected call succeeds (AC2)
// =====================================================================
{
  let res = null, err = null;
  try { res = await api.api.search({ q: "zzzznotfound", limit: 10 }); } catch (e) { err = e; }
  if (err) {
    bad(`A3 search after hydration: expected=resolves actual=threw ${show(err.message)}` +
        (err.message === "Unauthorized" ? " (AC2 FAILED — do not adjust the harness)" : ""));
  } else {
    const isArr = Array.isArray(res.results);
    const len = isArr ? res.results.length : "<not an array>";
    expect("A3 Array.isArray(res.results)", true, isArr, isArr);
    expect('A3 results.length for q="zzzznotfound" on seeded fixture', 0, len, len === 0);
  }
}

// =====================================================================
// A4 — setToken is the sole writer: persists (a) and removes (b)
// =====================================================================
{
  store.clear();
  let m = await freshApi();
  m.setToken(TOKEN);
  expect("A4(a) store.get(key) after setToken(TOKEN)", TOKEN, store.get(STORAGE_KEY), store.get(STORAGE_KEY) === TOKEN);
  expect("A4(a) getToken() after setToken(TOKEN)", TOKEN, m.getToken(), m.getToken() === TOKEN);
  expect("A4(a) store.has(key) after setToken(TOKEN)", true, store.has(STORAGE_KEY), store.has(STORAGE_KEY) === true);
}
{
  let m = await freshApi();
  m.setToken(null);
  expect("A4(b) store.has(key) after setToken(null)", false, store.has(STORAGE_KEY), store.has(STORAGE_KEY) === false);
  expect("A4(b) getToken() after setToken(null)", null, m.getToken(), m.getToken() === null);
}

// =====================================================================
// A5 — ka:logout delivered to a registered listener; identity-correct removal
// =====================================================================
{
  let m = await freshApi();
  m.setToken(TOKEN);                              // valid token in memory
  let count = 0;
  const navigated = () => { count++; };
  window.addEventListener("ka:logout", navigated);
  window.dispatchEvent(new Event("ka:logout"));
  expect("A5 count after 1st dispatch", 1, count, count === 1);
  window.removeEventListener("ka:logout", navigated);
  window.dispatchEvent(new Event("ka:logout"));
  expect("A5 count after removal + 2nd dispatch", 1, count, count === 1);
}

// =====================================================================
// A6 — double 401 ⇒ exactly one ka:logout; both calls reject Unauthorized
// =====================================================================
async function consumeDouble401(m) {
  // two 401s consumed exactly as in A6 (A12 reuses this sequence)
  return await Promise.allSettled([
    m.api.search({ q: "a", limit: 10 }),
    m.api.search({ q: "b", limit: 10 }),
  ]);
}
let a6api;
{
  a6api = await freshApi();
  a6api.setToken("garbage.token.value");
  dispatchedTypes.length = 0;
  const rs = await consumeDouble401(a6api);
  const nLogout = dispatchedTypes.filter((t) => t === "ka:logout").length;
  expect("A6 ka:logout dispatches for a double-401", 1, nLogout, nLogout === 1);
  for (let i = 0; i < rs.length; i++) {
    const st = rs[i].status;
    const msg = st === "rejected" ? rs[i].reason?.message : "<resolved>";
    expect(`A6 rs[${i}] status`, "rejected", st, st === "rejected");
    expect(`A6 rs[${i}] reason.message`, "Unauthorized", msg, msg === "Unauthorized");
  }
}

// =====================================================================
// A7 — second hydrateToken() is a no-op (one-shot); divergence is required
// =====================================================================
{
  store.clear();
  let m = await freshApi();
  store.set(STORAGE_KEY, "stale-value");
  m.hydrateToken();
  store.set(STORAGE_KEY, "newer-value");
  m.hydrateToken();
  expect("A7 getToken() after 2nd hydrateToken()", "stale-value", m.getToken(), m.getToken() === "stale-value");
  expect("A7 store.get(key) after 2nd hydrateToken()", "newer-value", store.get(STORAGE_KEY), store.get(STORAGE_KEY) === "newer-value");
}

// =====================================================================
// A8 — hydrateToken() after setToken(x) must not overwrite x (N-6a sequence)
// =====================================================================
{
  store.clear();
  let m = await freshApi();
  // P1: fresh module, nothing hydrated yet — asserted, because a module that is
  // already hydrated would skip the storage read entirely and make (3) vacuous.
  const p1 = m.isHydrated();
  if (p1 !== false) {
    blocked(`A8 P1: fresh module is already hydrated (isHydrated()=${show(p1)}); hydration would be a no-op and the sequence would not exercise it`);
  }
  expect("A8 P1 isHydrated() on fresh module", false, p1, p1 === false);
  // A8 precondition (A8 root-cause fix). The stale value must be in storage
  // *at the moment hydrateToken() reads it*. The earlier version staged it before
  // setToken("fresh-value"), but setToken persists by design (writer contract,
  // api.ts:36), which overwrote "stale-value" — so hydrateToken() re-read
  // "fresh-value" and the assertion was a tautology (green on unguarded code).
  // Re-stage the stale value AFTER setToken so the hydrate read really conflicts.
  m.setToken("fresh-value");                      // (1) in-memory set before any hydrate call
  store.set(STORAGE_KEY, "stale-value");          // P2: divergence staged at read time
  const afterSet = m.isHydrated();                // (2) must NOT have touched `hydrated`
  if (afterSet !== false) {
    blocked(`A8 step (2): setToken marked the module hydrated (isHydrated()=${show(afterSet)}); the sequence no longer exercises hydration`);
  }
  ok(`A8 step (2) isHydrated() after setToken("fresh-value") (must be false): expected=false actual=${show(afterSet)}`);
  m.hydrateToken();                               // (3) first and only hydration of this instance
  const got = m.getToken();                       // (4)
  expect('A8 getToken() after hydrateToken() following setToken("fresh-value")', "fresh-value", got, got === "fresh-value");
}

// =====================================================================
// A9 — clearSession() cannot be resurrected by a later hydrate
// =====================================================================
{
  store.clear();
  let m = await freshApi();
  store.set(STORAGE_KEY, TOKEN);
  m.hydrateToken();
  m.clearSession();
  const t1 = m.getToken(), h1 = store.has(STORAGE_KEY);
  expect("A9 after clearSession: getToken()", null, t1, t1 === null);
  expect("A9 after clearSession: store.has(key)", false, h1, h1 === false);
  m.hydrateToken();                               // retry
  const t2 = m.getToken(), h2 = store.has(STORAGE_KEY);
  expect("A9 after retry hydrateToken(): getToken()", null, t2, t2 === null);
  expect("A9 after retry hydrateToken(): store.has(key)", false, h2, h2 === false);
}

// =====================================================================
// A10 — clearSession() works on a never-hydrated module
// =====================================================================
{
  store.clear();
  let m = await freshApi();
  store.set(STORAGE_KEY, TOKEN);                  // no hydration
  m.clearSession();
  expect("A10 never-hydrated clearSession: getToken()", null, m.getToken(), m.getToken() === null);
  expect("A10 never-hydrated clearSession: store.has(key)", false, store.has(STORAGE_KEY), store.has(STORAGE_KEY) === false);
}

// =====================================================================
// A11 — no localStorage/sessionStorage outside the owner (AC1, N-6b scope)
// =====================================================================
{
  const SKIP_DIRS = new Set(["node_modules", ".next", "dist"]);
  const OWNER = path.normalize("web/src/lib/api.ts");
  const root = path.normalize("web/src");
  const offenders = [];
  let entries = [];
  try {
    entries = fs.readdirSync(root, { recursive: true });
  } catch (e) {
    bad(`A11 readdirSync(${root}): expected=readable actual=threw ${show(e?.message)} (run from repo root)`);
  }
  for (const rel of entries) {
    const p = path.normalize(path.join(root, rel.toString()));
    const parts = p.split(path.sep);
    if (parts.some((seg) => SKIP_DIRS.has(seg))) continue;      // skip node_modules/.next/dist
    if (!/\.(ts|tsx)$/.test(p)) continue;
    let text = "";
    try { text = fs.readFileSync(p, "utf8"); } catch { continue; }
    if (!/localStorage|sessionStorage/.test(text)) continue;
    if (p === OWNER) continue;                                   // the ONE permitted exclusion
    offenders.push(p);
  }
  if (offenders.length !== 0) console.log(`      offenders: ${offenders.join(", ")}`);
  expect("A11 offenders.length (localStorage|sessionStorage outside web/src/lib/api.ts)",
    0, offenders.length, offenders.length === 0);
}

// =====================================================================
// A12 — setToken re-arms the logout latch (no permanently-suppressed logout)
// =====================================================================
{
  let m = await freshApi();
  m.setToken("garbage.token.value");
  dispatchedTypes.length = 0;
  const rs1 = await consumeDouble401(m);          // two 401s consumed exactly as in A6
  const before = dispatchedTypes.filter((t) => t === "ka:logout").length;
  ok(`A12 pre-state: ka:logout dispatches before re-arm: expected=${1} actual=${before}`);
  m.setToken(TOKEN);                              // re-arms the latch
  let resolved = false, errMsg = null;
  try { await m.api.search({ q: "zzzznotfound", limit: 10 }); resolved = true; }
  catch (e) { errMsg = e?.message; }
  expect("A12 search after setToken(TOKEN): resolves", true, resolved ? true : `threw ${show(errMsg)}`, resolved);
  const after = dispatchedTypes.filter((t) => t === "ka:logout").length;
  expect("A12 ka:logout count after re-armed successful call (=== before)", before, after, after === before);
  const rs1statuses = rs1.map((r) => r.status).join(",");
  ok(`A12 pre-state: double-401 statuses: expected=rejected,rejected actual=${rs1statuses}`);
}

// =====================================================================
// A13 — first visit, empty storage: hydrates to null without throwing
// =====================================================================
{
  store.clear();
  let m = await freshApi();
  let threw = null;
  try { m.hydrateToken(); } catch (e) { threw = e?.message ?? String(e); }
  expect("A13 hydrateToken() with empty storage: no throw", "no throw", threw === null ? "no throw" : `threw ${show(threw)}`, threw === null);
  expect("A13 getToken() with empty storage", null, m.getToken(), m.getToken() === null);
}

// =====================================================================
console.log(failures === 0 ? "\nRESULT: PASS" : `\nRESULT: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

// web/scripts/f3a-library.mjs — Part A (F3-A) executable harness
// Spec: PLAN.md §A4.4 (six assertions). Node built-ins only; no new dependency.
//
// Run from the repo root (the ONLY supported command, PLAN §A4.3):
//   node --import ./server/node_modules/tsx/dist/loader.mjs web/scripts/f3a-library.mjs
//
// Exit codes: 0 = PASS · 1 = FAIL (>=1 assertion failed) · 2 = BLOCKED (precondition unmet).
//
// Fallback level (stated so nothing is overclaimed): this is NOT a browser test. It loads the real
// `web/src/lib/api.ts` module, swaps in a real `fetch` wrapper (the module's own fetch call is
// recorded), uses a fake localStorage/window, and does NOT render React, does NOT exercise
// next/navigation and cannot see the DOM. The DOM-level evidence is the manual browser steps of
// PLAN §A4.4, run by the operator.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const STORAGE_KEY = "ka_token";
const API_BASE = process.env.F3A_API_BASE || "http://127.0.0.1:4000/api";
const API_ORIGIN = new URL(API_BASE).origin;
const MODULE_PATH = path.resolve("web/src/lib/api.ts"); // repo root is the cwd (run contract)
const PAGE_PATH = path.resolve("web/src/app/dashboard/library/page.tsx");

let failures = 0;
const ok = (m) => console.log(`PASS  ${m}`);
const bad = (m) => { failures++; console.log(`FAIL  ${m}`); };
const blocked = (m) => { console.log(`BLOCKED  ${m}`); process.exit(2); };

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
const eqJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- localStorage shim ----
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};

// ---- window shim (api.ts dispatches ka:logout on 401) ----
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return true; },
};

// ---- fetch recorder: the real fetch, with the call captured ----
const realFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, init) => {
  const rec = { url: String(url), init: init ?? {} };
  calls.push(rec);
  return realFetch(url, init);
};
const lastCall = () => calls[calls.length - 1];

// ---- preconditions ----
let TOKEN = process.env.F3A_TOKEN || "";
if (!TOKEN) {
  const f = path.resolve(".pipeline/p3/f3a-token.txt");
  if (fs.existsSync(f)) TOKEN = fs.readFileSync(f, "utf8").trim();
}
if (!TOKEN) {
  try {
    const r = await fetch(`${API_BASE}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: process.env.F3A_USER || "admin",
        password: process.env.F3A_PASSWORD || "admin123",
      }),
    });
    if (r.status === 200) TOKEN = (await r.json()).token;
    else blocked(`login returned ${r.status}`);
  } catch (e) {
    blocked(`API not reachable at ${API_BASE} (${e?.message ?? e}) — start it per PLAN §A4.3`);
  }
}
if (!TOKEN) blocked("no token available");
SECRET = TOKEN;
console.log(`token acquired: ${TOKEN.length} chars`);

const mod = await import(pathToFileURL(MODULE_PATH).href);
const api = mod.api;
mod.setToken(TOKEN); // named export (api.ts:32), not a method on `api`

// =====================================================================
// 1 — api.library.list({}) -> /library, no `q`, Authorization present
// =====================================================================
{
  calls.length = 0;
  let res = null, err = null;
  try { res = await api.library.list({}); } catch (e) { err = e; }
  const c = lastCall();
  const u = c ? new URL(c.url) : null;
  expect("1 path for api.library.list({})", "/library", u ? u.pathname.replace(/^\/api/, "") : "no fetch",
    !!u && u.pathname.replace(/^\/api/, "") === "/library");
  expect("1 the request has NO q parameter", null, u ? u.searchParams.get("q") : "no fetch",
    !!u && u.searchParams.get("q") === null);
  const auth = c?.init?.headers?.Authorization ?? "";
  expect("1 Authorization header present", "<token:N chars>",
    auth ? auth.replace(/^Bearer .*$/, "<token:N chars>") : "missing",
    typeof auth === "string" && auth.startsWith("Bearer "));
  expect("1 the call resolved against the live API", true, err ? `threw ${show(err.message)}` : true,
    err === null);
  if (res) {
    const keys = Object.keys(res);
    expect("1 live response keys", ["results", "total", "limit", "next_cursor"], keys, eqJson(keys, ["results", "total", "limit", "next_cursor"]));
  }
}

// =====================================================================
// 2 — api.library.list({limit:2, cursor:'abc'}) -> /library?limit=2&cursor=abc
// =====================================================================
{
  calls.length = 0;
  try { await api.library.list({ limit: 2, cursor: "abc" }); } catch { /* 200 expected, ignore body */ }
  const u = new URL(lastCall().url);
  expect("2 search string", "?limit=2&cursor=abc", u.search, u.search === "?limit=2&cursor=abc");
}

// =====================================================================
// 3 — api.library.list({cursor:null, limit:undefined}) sends neither
// =====================================================================
{
  calls.length = 0;
  try { await api.library.list({ cursor: null, limit: undefined }); } catch {}
  const u = new URL(lastCall().url);
  expect("3 search string", "", u.search, u.search === "");
  expect("3 path", "/api/library", u.pathname, u.pathname === "/api/library");
}

// =====================================================================
// 4 — the returned object's keys: no `offset` (R-A1)
// =====================================================================
{
  let res = null;
  try { res = await api.library.list({ limit: 1 }); } catch (e) { res = null; bad(`4 threw ${show(e?.message)}`); }
  if (res) {
    const keys = Object.keys(res);
    expect("4 Object.keys(page)", ["results", "total", "limit", "next_cursor"], keys, eqJson(keys, ["results", "total", "limit", "next_cursor"]));
    expect("4 page has no offset property", false, Object.prototype.hasOwnProperty.call(res, "offset"),
      !Object.prototype.hasOwnProperty.call(res, "offset"));
  }
}

// =====================================================================
// 5 — api.library.list never calls fetch with method POST
// =====================================================================
{
  calls.length = 0;
  try { await api.library.list({ limit: 1 }); } catch {}
  try { await api.library.list({ limit: 1, cursor: "abc" }); } catch {}
  const methods = calls.map((c) => c.init.method ?? "GET");
  expect("5 methods used by api.library.list", ["GET", "GET"], methods, eqJson(methods, ["GET", "GET"]));
  expect("5 no POST among them", 0, methods.filter((m) => m === "POST").length, methods.filter((m) => m === "POST").length === 0);
}

// =====================================================================
// 6 — source level: library/page.tsx contains no api.search
// =====================================================================
{
  const src = fs.existsSync(PAGE_PATH) ? fs.readFileSync(PAGE_PATH, "utf8") : "";
  const count = (n) => src.split(n).length - 1;
  expect("6 grep -c api.search in library/page.tsx", 0, count("api.search"), count("api.search") === 0);
  expect("6 grep -c api.library.list in library/page.tsx (>=1)", true, count("api.library.list") >= 1, count("api.library.list") >= 1);
  expect('6 grep -c "slice(" in library/page.tsx', 0, count("slice("), count("slice(") === 0);
}

console.log(failures === 0 ? "\nRESULT: PASS" : `\nRESULT: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

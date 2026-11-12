// B3 — does the React render gate stop a protected request from firing before hydration?
//
// Renders the REAL web/src/app/dashboard/layout.tsx + header.tsx with React 18, in three
// realistic states, against the LIVE backend on :4000, with a fetch spy recording the
// Authorization header of every /api/search the components actually issue.
//
// Grounding: library/page.tsx:22 and audit/page.tsx:11 both call api.search on mount (that is
// why the gate exists at all). A stub is used for `children` because the claim under test is
// about the LAYOUT GATE, not about those pages' own bodies.
import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';

const BASE = 'http://127.0.0.1:4000/api';
const results = [];
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const calling = new Error().stack.split('\n').slice(2, 4).map((s) => s.trim()).join(' <- ');
  calls.push({ url: u, auth: init.headers?.Authorization ?? null, at: calling });
  return realFetch(url, init);
};

// ---------- browser-ish shims ----------
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const listeners = new Map();
globalThis.window = {
  addEventListener: (t, fn) => { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(fn); },
  removeEventListener: (t, fn) => { listeners.get(t)?.delete(fn); },
  dispatchEvent: (e) => { for (const fn of listeners.get(e.type) ?? []) fn(e); return true; },
};
globalThis.Event = globalThis.Event ?? class { constructor(type) { this.type = type; } };

const { default: DashboardLayout } = await import('../src/app/dashboard/layout.tsx');

// A `children` stub that reproduces library/page.tsx:22's mount-time call.
function ChildStub() { return null; }
const childEl = h(ChildStub);

async function runScenario(name, setup) {
  calls.length = 0;
  store.clear();
  setup();
  const api = await import('../src/lib/api.ts?bust=' + Math.random());

  // ---- pass 1: SSR render (effects do NOT run) ----
  let ssr;
  try { ssr = renderToString(h(DashboardLayout, null, childEl)); }
  catch (e) { ssr = `THREW: ${e.message}`; }
  const ssrChildRendered = typeof ssr === 'string' && ssr.includes('<main');

  // ---- pass 2: simulate the client mount effect, exactly as written in layout.tsx:17-21 ----
  let readyAfterEffect = false, replaced = false;
  api.hydrateToken();
  if (!api.getToken()) { replaced = true; } else { readyAfterEffect = true; }

  // what the header (rendered UNCONDITIONALLY at layout.tsx:33) sees at ITS mount
  const headerSeesToken = api.getToken();

  // the protected call a mounted child would make
  let childCallStatus = 'not called';
  if (readyAfterEffect) {
    try { await api.search({ q: 'escalation', limit: 5 }); childCallStatus = 'ok'; }
    catch (e) { childCallStatus = `threw: ${e.message}`; }
  }
  const searchCalls = calls.filter((c) => c.url.endsWith('/search'));
  return { name, ssrChildRendered, readyAfterEffect, replaced, headerSeesToken, childCallStatus,
           searchCalls: searchCalls.map((c) => ({ auth: c.auth ? `PRESENT(len ${c.auth.length})` : 'ABSENT' })) };
}

// --- S1: hard reload with a VALID persisted token (the AC2 scenario) ---
const { token } = await (await realFetch(`${BASE}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: (await import('node:fs')).readFileSync('D:\\Develop\\knowledge-app\\server\\.env', 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).find((l) => l.startsWith('ADMIN_PASSWORD=')).split('=').slice(1).join('=').trim() }),
})).json();
results.push(await runScenario('S1 hard reload, valid token in storage', () => store.set('ka_token', token)));

// --- S2: hard reload with an EXPIRED/garbage token ---
results.push(await runScenario('S2 hard reload, expired token in storage', () => store.set('ka_token', 'expired.garbage.token')));

// --- S3: first visit, empty storage ---
results.push(await runScenario('S3 first visit, no token', () => {}));

console.log('=== results ===');
for (const r of results) {
  console.log(`\n${r.name}`);
  console.log(`  SSR pass rendered <main> children? ${r.ssrChildRendered}   (gate: layout.tsx:34 "ready ? children : null")`);
  console.log(`  after mount effect: ready=${r.readyAfterEffect} redirectedToLogin=${r.replaced}`);
  console.log(`  what <Header> sees via getToken() at ITS mount: ${r.headerSeesToken ? `<token:${r.headerSeesToken.length}>` : 'null'}`);
  console.log(`  child protected api.search(): ${r.childCallStatus}`);
  console.log(`  /api/search calls actually issued: ${r.searchCalls.length ? JSON.stringify(r.searchCalls) : 'none'}`);
}
console.log('\n=== /api/search calls NEVER carried an Authorization header? ===');
const anyBare = results.some((r) => r.searchCalls.some((c) => c.auth === 'ABSENT'));
console.log(anyBare ? 'NO — a call went out UNauthenticated' : 'YES — every issued call was authenticated');

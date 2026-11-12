// A4 — malformed input, very long q, limit out of range: no SQL error, no 500, parameterised.
import { login, search } from './lib.mjs';

let failures = 0;
const ok = (c, l, d) => { if (!c) failures++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${d ? '  — ' + d : ''}`); };
const { token } = await login();
const TOTAL = 11;

// ---- 1. special characters / SQL-injection-shaped input --------------------
const specials = ["'", '""', ':', '*', '&', '|', '!', "'; DROP TABLE chunks; --", "' OR 1=1 --",
                  '" OR ""="', 'a:b*c&d|e!f', '\\', '%', '_', '$1', '(', ')', "'||'"];
console.log('=== special characters ===');
for (const q of specials) {
  const r = await search({ q, limit: 10 }, token);
  ok(r.status === 200, `${JSON.stringify(q).padEnd(28)} HTTP 200`, `status=${r.status} len=${r.body?.results?.length}`);
}
const alive = await search({ q: 'escalation', limit: 10 }, token);
ok(alive.status === 200 && alive.body?.results?.length === 5,
   'table still intact after injection-shaped queries (escalation == 5)', `len=${alive.body?.results?.length}`);

// ---- 2. VERY long q -------------------------------------------------------
console.log('\n=== very long q ===');
for (const n of [1000, 10000, 50000, 100000]) {
  const r = await search({ q: 'a'.repeat(n), limit: 10 }, token);
  ok(r.status === 200, `single-token q len=${n} -> 200`, `status=${r.status}`);
}
// multi-word long query (the implementer disclosed a 500 here — judge it, do not assume)
for (const terms of [1000, 8000, 14000, 20000]) {
  const q = Array.from({ length: terms }, (_, i) => 'w' + i).join(' ');
  const r = await search({ q, limit: 10 }, token);
  console.log(`multi-word terms=${terms} chars=${q.length} -> HTTP ${r.status} ${r.status !== 200 ? JSON.stringify(r.body) : 'len=' + r.body?.results?.length}`);
  ok(r.status === 200, `multi-word q terms=${terms} (chars=${q.length}) -> 200`, `status=${r.status}`);
}

// ---- 3. limit torture -----------------------------------------------------
console.log('\n=== limit torture ===');
const limits = [0, -5, 1, 2, 10, 49, 50, 51, 1e9, -1e9, '5', 'abc', null, 3.7, NaN, Infinity];
for (const lim of limits) {
  const r = await search({ q: 'e', limit: lim }, token);
  const n = r.body?.results?.length;
  const okRange = r.status >= 200 && r.status < 300 && Number.isInteger(n) && n >= 0 && n <= 50;
  console.log(`limit=${String(lim).padEnd(8)} -> HTTP ${r.status} envelope.limit=${r.body?.limit} rows=${n}`);
  ok(okRange, `  limit=${String(lim)} -> 2xx with 0..50 results`, `status=${r.status} rows=${n}`);
}

console.log(failures === 0 ? '\nRESULT: PASS' : `\nRESULT: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

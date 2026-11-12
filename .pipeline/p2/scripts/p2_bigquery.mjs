#!/usr/bin/env node
// T-A6 / implementer brief §A-6: a 100 000-character query must return 200, never 500.
// The body limit is 1mb (app.ts:33), so 100k chars is well inside it; the assertion is that
// websearch_to_tsquery does not choke and the route's catch-all 500 is not reached.
// Usage: node scripts/p2_bigquery.mjs <token-file>
import fs from 'node:fs';

const TOKEN = fs.readFileSync(process.argv[2], 'utf8').trim();
const cases = [
  ['a'.repeat(100000), '100k letters (one giant lexeme)'],
  [Array.from({ length: 20000 }, (_, i) => `w${i}`).join(' '), '20k distinct words (title : 200k chars)'],
  ['escalation ' + 'x'.repeat(99990), 'real term + 99 990 filler chars'],
];
let failed = 0;
for (const [q, label] of cases) {
  const t0 = Date.now();
  const res = await fetch('http://127.0.0.1:4000/api/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, limit: 10 }),
  });
  const text = await res.text();
  const ms = Date.now() - t0;
  let n = null;
  try { n = JSON.parse(text).results?.length; } catch { /* not json */ }
  const ok = res.status === 200;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  q.length=${q.length} (${label}) -> HTTP ${res.status} in ${ms} ms; results=${n}; body[0..90]=${JSON.stringify(text.slice(0, 90))}`);
}
console.log(failed === 0 ? 'RESULT: all oversized queries returned 200 (none reached the 500 handler)' : `RESULT: ${failed} oversized query/queries did not return 200`);
process.exit(failed === 0 ? 0 : 1);

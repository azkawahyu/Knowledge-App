#!/usr/bin/env node
// FU-AC5-BIGQ: is the 54001 "stack depth limit exceeded" threshold stable, or does it depend on
// connection history? Each case below runs on a BRAND-NEW pg connection (pool size 1, fresh
// Client per case) so that "fresh session" really means fresh.
// Read-only against p2test (the schema has already been dropped by cleanup; the query is planned
// against an EMPTY table, which is enough: the failure happens in websearch_to_tsquery, not in
// reading rows).
import fs from 'node:fs';
// This script lives outside server/, so `pg` is resolved by absolute path (ESM ignores NODE_PATH).
const pgmod = await import('file:///D:/Develop/knowledge-app/server/node_modules/pg/lib/index.js');
const Client = pgmod.default?.Client ?? pgmod.Client;

const url = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL=')).slice('DATABASE_URL='.length).trim();

async function freshRun(terms) {
  const db = new Client({ connectionString: url });
  await db.connect();
  const q = Array.from({ length: terms }, (_, i) => `w${i}`).join(' ');
  try {
    const r = await db.query(`SELECT count(*)::int n FROM chunks c WHERE to_tsvector('english', c.text) @@ websearch_to_tsquery('english', $1)`, [q]);
    return { terms, chars: q.length, ok: true, rows: r.rows[0].n };
  } catch (e) {
    return { terms, chars: q.length, ok: false, code: e.code, msg: e.message };
  } finally {
    await db.end();
  }
}

for (const terms of [10000, 12000, 13000, 14000, 15000, 20000, 15000, 14000, 15000]) {
  const r = await freshRun(terms);
  console.log(`${r.ok ? 'OK   ' : 'ERROR'} terms=${String(r.terms).padStart(6)} chars=${String(r.chars).padStart(7)} ${r.ok ? 'rows=' + r.rows : r.code + ' ' + r.msg}`);
}

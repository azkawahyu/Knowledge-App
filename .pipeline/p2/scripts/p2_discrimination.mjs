#!/usr/bin/env node
// A-7 DISCRIMINATION PROOF (implementer brief).
// On the SAME seeded p2test fixture, for q='zzzznotfound':
//   FIXED code path     (predicate present, exactly as server/src/routes/search.ts sends it) -> 0
//   ROUND-0 SQL form    (the shipped pre-fix statement: no predicate, single-key ORDER BY)   -> 10
// Both statements are executed here against p2test; the fixed count is ALSO cross-checked
// through the live HTTP route, which is running the fixed search.ts under `tsx`.
// Usage: node scripts/p2_discrimination.mjs <token-file> <outfile>
import fs from 'node:fs';
import { Client } from 'pg';

const [tokenFile, outFile] = process.argv.slice(2);
const TOKEN = fs.readFileSync(tokenFile, 'utf8').trim();
const out = [];
const rec = (s = '') => { out.push(s); console.log(s); };

const dbUrl = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL=')).slice('DATABASE_URL='.length).trim();
const db = new Client({ connectionString: dbUrl });
await db.connect();
await db.query('SET search_path = p2test');
rec(`schema in force: ${(await db.query('SELECT current_schema() AS s')).rows[0].s}`);
rec(`chunks in fixture: ${(await db.query('SELECT count(*)::int n FROM chunks')).rows[0].n}`);
rec('');

const Q = 'zzzznotfound';
const POLICY = '*';
const LIMIT = 10;

// --- the FIXED statement, character-for-character the `text` of search.ts's pool.query ---
const FIXED_TEXT = `
        SELECT d.id AS document_id,
               d.name AS document_name,
               d.access_policy AS document_policy,
               c.id AS chunk_id,
               c.text,
               c.page_no,
               c.start_char,
               c.end_char
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE (d.access_policy = $1 OR $1 = '*')
          AND to_tsvector('english', c.text) @@ websearch_to_tsquery('english', $2)
        ORDER BY ts_rank(
                   to_tsvector('english', c.text),
                   websearch_to_tsquery('english', $2)
                 ) DESC,
                 d.id ASC,
                 c.start_char ASC NULLS LAST,
                 c.id ASC
        LIMIT $3
      `;

// --- the ROUND-0 (pre-fix) statement, verbatim from the baseline search.ts (git-baseline form) ---
const ROUND0_TEXT = `
        SELECT d.id AS document_id,
               d.name AS document_name,
               d.access_policy AS document_policy,
               c.id AS chunk_id,
               c.text,
               c.page_no,
               c.start_char,
               c.end_char
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE d.access_policy = $1 OR $1 = '*'
        ORDER BY ts_rank(
                   to_tsvector('english', c.text),
                   websearch_to_tsquery('english', $2)
                 ) DESC
        LIMIT $3
      `;

const fixed = await db.query(FIXED_TEXT, [POLICY, Q, LIMIT]);
const round0 = await db.query(ROUND0_TEXT, [POLICY, Q, LIMIT]);

rec('=== STATEMENT 1 — FIXED (with match predicate) ===');
rec(`rows returned for q='${Q}': ${fixed.rowCount}`);
rec('=== STATEMENT 2 — ROUND-0 (shipped pre-fix form, no predicate) ===');
rec(`rows returned for q='${Q}': ${round0.rowCount}`);
rec(`  first 3: ${JSON.stringify(round0.rows.slice(0, 3).map((r) => [r.document_name, r.text.slice(0, 28)]))}`);
const ranks = await db.query(`SELECT ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english','${Q}'))::float8 AS r FROM chunks c ORDER BY r DESC LIMIT 3`);
rec(`  every pre-fix row has ts_rank: ${JSON.stringify(ranks.rows.map((x) => x.r))}`);
rec('');

const res = await fetch('http://127.0.0.1:4000/api/search', {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ q: Q, limit: LIMIT }),
});
const body = await res.json();
rec('=== STATEMENT 3 — the LIVE HTTP route (fixed search.ts under tsx) ===');
rec(`status=${res.status} results=${body.results?.length} limit=${body.limit} query=${JSON.stringify(body.query)}`);
rec('');

const ok = fixed.rowCount === 0 && round0.rowCount === 10 && (body.results?.length === 0) && res.status === 200;
rec(`DISCRIMINATION: fixed=${fixed.rowCount} round0=${round0.rowCount} http=${body.results?.length} -> ${ok ? 'PROVEN (fixed 0 vs round-0 10 on the same fixture)' : 'NOT PROVEN'}`);
fs.writeFileSync(outFile, out.join('\n') + '\n');
await db.end();
process.exit(ok ? 0 : 1);

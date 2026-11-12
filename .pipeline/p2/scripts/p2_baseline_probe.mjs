// Read-only baseline probe for Phase 2 Part A (IMPLEMENTER).
// Usage: node scripts/p2_baseline_probe.mjs
// Connects with DATABASE_URL from server/.env; issues SELECT/catalog queries only.
import fs from 'node:fs';
import path from 'node:path';
// This script lives outside server/, so `pg` is resolved by absolute path (ESM ignores NODE_PATH).
const pgmod = await import('file:///D:/Develop/knowledge-app/server/node_modules/pg/lib/index.js');
const Client = pgmod.default?.Client ?? pgmod.Client;
const SERVER_DIR = 'D:/Develop/knowledge-app/server';

const envText = fs.readFileSync(path.join(SERVER_DIR, '.env'), 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
  if (m) env[m[1]] = m[2];
}
const url = env.DATABASE_URL;
if (!url) { console.error('no DATABASE_URL'); process.exit(1); }

const client = new Client({ connectionString: url });
await client.connect();

const q = async (label, sql) => {
  const r = await client.query(sql);
  console.log(`${label}\t${JSON.stringify(r.rows)}`);
};

console.log('== databases / namespaces ==');
await q('current_database', 'SELECT current_database() AS db, current_user AS usr, current_schema() AS schema');
await q('schemas', "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY 1");
await q('pgcrypto', "SELECT extname, extversion FROM pg_extension WHERE extname IN ('pgcrypto','pg_trgm') ORDER BY 1");

console.log('== public tables ==');
await q('public_tables', "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1");
for (const t of ['documents', 'chunks', 'admins', 'audit_log', 'access_policies']) {
  try {
    await q(`public.${t}`, `SELECT count(*)::int AS n FROM public.${t}`);
  } catch (e) { console.log(`public.${t}\tERR ${e.message}`); }
}

console.log('== f1test ==');
try {
  await q('f1test_tables', "SELECT table_name FROM information_schema.tables WHERE table_schema='f1test' ORDER BY 1");
  for (const t of ['documents', 'chunks', 'admins', 'audit_log']) {
    try { await q(`f1test.${t}`, `SELECT count(*)::int AS n FROM f1test.${t}`); }
    catch (e) { console.log(`f1test.${t}\tERR ${e.message}`); }
  }
} catch (e) { console.log('f1test\tERR ' + e.message); }

console.log('== public indexes (chunks/documents) ==');
await q('indexes', "SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('chunks','documents') ORDER BY 1,2,3");

console.log('== p2test present? ==');
await q('p2test', "SELECT count(*)::int AS n FROM pg_namespace WHERE nspname='p2test'");

await client.end();

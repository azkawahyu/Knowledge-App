// Part A verification driver — independent Test Engineer (Phase 2).
// Usage: node .pipeline/p2/verify/partA.mjs <checkId>
// Prints raw HTTP status + body; never prints the token value.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = 'D:\\Develop\\knowledge-app';
const BASE = 'http://127.0.0.1:4000/api';
const V = `${ROOT}\\.pipeline\\p2\\verify`;
const PSQL = 'D:\\Install\\PostgreSQL\\18\\bin\\psql.exe';

// --- credentials read from .env; never printed -----------------------------
function envVal(key) {
  const raw = readFileSync(`${ROOT}\\server\\.env`, 'utf8').replace(/^\uFEFF/, '');
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith(key + '=')) return line.slice(key.length + 1).trim();
  }
  return '';
}
const PGURL = envVal('DATABASE_URL');
const pgPw = PGURL.replace(/^postgresql:\/\/[^:]+:/, '').replace(/@.*$/, '');

export function psql(sql, schema = 'p2verify') {
  const out = execFileSync(PSQL, [
    '-h', '127.0.0.1', '-p', '5432', '-U', 'knowledge_app', '-d', 'knowledge_app',
    '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-c', `SET search_path = ${schema}; ${sql}`,
  ], { env: { ...process.env, PGPASSWORD: pgPw }, encoding: 'utf8' });
  return out.trim();
}

export async function login() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: envVal('ADMIN_PASSWORD') }),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, token: body.token || null };
}

export async function search(body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}/search`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  let parsed = null;
  const text = await r.text();
  try { parsed = JSON.parse(text); } catch { /* keep raw */ }
  return { status: r.status, body: parsed, raw: parsed ? null : text };
}

export function trunc(s, n = 300) {
  s = typeof s === 'string' ? s : JSON.stringify(s);
  return s && s.length > n ? s.slice(0, n) + `…[${s.length} chars]` : s;
}
export { V, ROOT };

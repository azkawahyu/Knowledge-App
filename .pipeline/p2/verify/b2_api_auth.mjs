// B2 — §B3.2 API-level auth checks (no browser). The six checks, verbatim in intent:
//   1 login returns a usable token   2 bad password -> 401, no token in body
//   3 no header -> 401 "Missing or invalid bearer token"   4 garbage token -> 401 "Invalid or expired token"
//   5 removed call no longer referenced by the client (static)   6 web typecheck (shell, run separately)
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:4000/api';
const ROOT = 'D:\\Develop\\knowledge-app';
let failures = 0;
const ok = (c, l, d) => { if (!c) failures++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${d ? '  — ' + d : ''}`); };

const raw = readFileSync(`${ROOT}\\server\\.env`, 'utf8').replace(/^\uFEFF/, '');
const pw = (raw.split(/\r?\n/).find((l) => l.startsWith('ADMIN_PASSWORD=')) || '').split('=').slice(1).join('=').trim();

const post = async (path, body, headers = {}) => {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
};

// ---- check 1: usable token ------------------------------------------------
const g = await post('/auth/login', { username: 'admin', password: pw });
console.log(`check 1 raw: HTTP ${g.status}  body keys=[${Object.keys(g.json || {}).join(',')}]`);
ok(g.status === 200, '1 login -> 200', `status=${g.status}`);
const token = g.json?.token;
ok(typeof token === 'string' && token.length > 0, '1 token present', `len=${token?.length}`);
const use = await post('/search', { q: 'escalation', limit: 5 }, { Authorization: `Bearer ${token}` });
ok(use.status === 200, '1 token is USABLE (search with it -> 200)', `status=${use.status} rows=${use.json?.results?.length}`);

// ---- check 2: wrong password ---------------------------------------------
const b = await post('/auth/login', { username: 'admin', password: pw + 'X' });
console.log(`check 2 raw: HTTP ${b.status}  body=${JSON.stringify(b.json)}`);
ok(b.status === 401, '2 bad password -> 401', `status=${b.status}`);
ok(b.json?.token === undefined || b.json?.token === null, '2 no token in body', JSON.stringify(b.json?.token));
ok(typeof b.json?.error === 'string', '2 error is a string', JSON.stringify(b.json?.error));

// ---- check 3: no Authorization header ------------------------------------
const n = await post('/search', { q: 'x' });
console.log(`check 3 raw: HTTP ${n.status}  body=${JSON.stringify(n.json)}`);
ok(n.status === 401, '3 no header -> 401', `status=${n.status}`);
ok(n.json?.error === 'Missing or invalid bearer token', '3 exact message', JSON.stringify(n.json?.error));

// ---- check 4: garbage token ----------------------------------------------
const t = await post('/search', { q: 'x' }, { Authorization: 'Bearer not.a.jwt' });
console.log(`check 4 raw: HTTP ${t.status}  body=${JSON.stringify(t.json)}`);
ok(t.status === 401, '4 garbage token -> 401', `status=${t.status}`);
ok(t.json?.error === 'Invalid or expired token', '4 exact message', JSON.stringify(t.json?.error));

// also: an expired/short-token shape and a valid-looking-but-wrong-signature token
const [h, p, s] = token.split('.');
const forged = `${h}.${p}.${s.slice(0, -4)}AAAA`;
const f = await post('/search', { q: 'x' }, { Authorization: `Bearer ${forged}` });
console.log(`check 4b forged-signature raw: HTTP ${f.status}  body=${JSON.stringify(f.json)}`);
ok(f.status === 401, '4b tampered signature -> 401', `status=${f.status}`);

// ---- check 5: the removed call is no longer referenced by the client -----
const apiTs = readFileSync(`${ROOT}\\web\\src\\lib\\api.ts`, 'utf8');
// the plan's R8/R14 regression guard: the two removed sites must not reappear
const patterns = [
  { name: 'localStorage.setItem(STORAGE_KEY) ("the write") outside api.ts', re: /localStorage\s*\.\s*setItem\s*\(\s*STORAGE_KEY/g },
  { name: 'localStorage.removeItem(STORAGE_KEY) ("the removal") outside api.ts', re: /localStorage\s*\.\s*removeItem\s*\(\s*STORAGE_KEY/g },
  { name: "localStorage.getItem(STORAGE_KEY) (\"the read\") outside api.ts", re: /localStorage\s*\.\s*getItem\s*\(\s*STORAGE_KEY/g },
  { name: "localStorage.getItem(\"ka_token\") (literal key read) outside api.ts", re: /localStorage\s*\.\s*getItem\s*\(\s*["']ka_token["']/g },
];
// Independent file walk — deliberately NOT `git grep`: web/src is almost entirely UNTRACKED
// (git ls-files src => 6 files), so a git-based scan would silently see only a fraction of the tree.
import { readdirSync } from 'node:fs';
function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', 'dist'].includes(e.name)) continue;
    const p = `${dir}\\${e.name}`;
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}
const allFiles = walk(`${ROOT}\\web`);
const srcFiles = allFiles.filter((f) => f.includes('\\web\\src\\'));
console.log(`check 5: ${allFiles.length} files under web\\ (excl node_modules/.next/dist); ${srcFiles.length} under web\\src`);
const rel = (f) => f.replace(`${ROOT}\\web\\`, '').replace(/\\/g, '/');
const files = allFiles.map(rel);
const hitsBy = (re) => files.filter((f) => { try { return re.test(readFileSync(`${ROOT}\\web\\${f}`, 'utf8')); } catch { return false; } });
console.log(`  files mentioning ka_token: ${JSON.stringify(hitsBy(/ka_token/))}`);
for (const ptn of patterns) {
  const hits = hitsBy(ptn.re);
  console.log(`  ${ptn.name}: ${hits.length ? hits.join(', ') : 'no hits'}`);
  ok(hits.length === 0 || (hits.length === 1 && hits[0] === 'src/lib/api.ts'),
     `5 "${ptn.name}" -> only the owner or nobody`, hits.join(',') || 'none');
}
ok(!/localStorage\.setItem\(\s*["']ka_token["']\s*,\s*data\.token/.test(readFileSync(`${ROOT}\\web\\src\\components\\login-form.tsx`, 'utf8')),
   '5 login-form.tsx no longer writes the token itself');

console.log(failures === 0 ? '\nRESULT: PASS' : `\nRESULT: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

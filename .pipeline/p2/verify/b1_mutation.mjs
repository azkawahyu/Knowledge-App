// Mutation driver — proves the Part B harness is non-vacuous.
// For each mutant: patch web/src/lib/api.ts (or the harness copy), run the harness, record
// whether it went RED, then restore the original byte-for-byte and verify the sha256.
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const API = 'D:\\Develop\\knowledge-app\\web\\src\\lib\\api.ts';
const HARNESS = 'D:\\Develop\\knowledge-app\\web\\scripts\\f2b-hydration.mjs';
const ROOT = 'D:\\Develop\\knowledge-app';
const backup = (p) => p + '.orig';
const sha = (s) => createHash('sha256').update(s).digest('hex');

const originals = new Map();
for (const p of [API, HARNESS]) {
  if (!existsSync(backup(p))) copyFileSync(p, backup(p));
  originals.set(p, readFileSync(p, 'utf8'));
}
const origHashes = new Map([...originals].map(([p, s]) => [p, sha(s)]));
console.log('original sha256:');
for (const [p, h] of origHashes) console.log(`  ${h}  ${p}`);

function runHarness() {
  try {
    const out = execFileSync('node', ['--import', './server/node_modules/tsx/dist/loader.mjs', 'web/scripts/f2b-hydration.mjs'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? -1, out: (e.stdout || '') + (e.stderr || '') };
  }
}
function restore(p) {
  writeFileSync(p, originals.get(p));
  const now = sha(readFileSync(p, 'utf8'));
  if (now !== origHashes.get(p)) throw new Error(`RESTORE FAILED for ${p}`);
}

const mutants = [
  { id: 'M1', target: API, label: 'hydrateToken() returns immediately (never installs the persisted token)',
    from: 'export function hydrateToken(): void {\n  if (hydrated) return;',
    to: 'export function hydrateToken(): void {\n  return; // MUTANT M1' },
  { id: 'M2', target: API, label: 'setToken() no longer persists to localStorage (sole-writer broken)',
    from: '  try { t ? localStorage.setItem(STORAGE_KEY, t) : localStorage.removeItem(STORAGE_KEY); } catch {}',
    to: '  /* MUTANT M2: persistence removed */' },
  { id: 'M3', target: API, label: '401 branch dispatches ka:logout unconditionally (latch removed -> double dispatch)',
    from: '    if (!logoutSignalled) {\n      logoutSignalled = true;',
    to: '    if (true) {\n      logoutSignalled = true; // MUTANT M3' },
  { id: 'M4', target: API, label: 'hydrateToken() clobbers a fresher in-memory token (A8 anti-clobber removed)',
    from: 'if (token === null) token = localStorage.getItem(STORAGE_KEY);',
    to: 'token = localStorage.getItem(STORAGE_KEY); // MUTANT M4' },
  { id: 'M5', target: HARNESS, label: 'HARNESS mutant: A11 scan excludes everything (offenders always 0)',
    from: 'const offenders =',
    to: 'const offenders = [].concat(' },
];

let alive = 0;
for (const m of mutants) {
  const src = readFileSync(m.target, 'utf8');
  if (!src.includes(m.from)) {
    console.log(`\n${m.id} SKIP — anchor text not found in ${m.target}`);
    continue;
  }
  writeFileSync(m.target, src.replace(m.from, m.to));
  const r = runHarness();
  const fails = (r.out.match(/^FAIL /gm) || []).length;
  const passedStill = r.code === 0;
  console.log(`\n${m.id} ${m.label}`);
  console.log(`   harness exit=${r.code}  FAIL lines=${fails}  -> ${passedStill ? 'STILL GREEN (VACUOUS for this mutant!)' : 'WENT RED (harness discriminates)'}`);
  const failed = r.out.split('\n').filter((l) => l.startsWith('FAIL ')).slice(0, 4);
  for (const f of failed) console.log(`     ${f}`);
  if (!passedStill) alive++;
  restore(m.target);
}
restore(API); restore(HARNESS);
console.log(`\n=== restored; verifying hashes ===`);
for (const [p, h] of origHashes) {
  const now = sha(readFileSync(p, 'utf8'));
  console.log(`  ${now === h ? 'OK  ' : 'DIFF'} ${p}`);
}
const clean = runHarness();
console.log(`\nclean re-run after restore: exit=${clean.code}`);
console.log(`\nMUTATION SCORE: ${alive}/${mutants.length} mutants detected`);

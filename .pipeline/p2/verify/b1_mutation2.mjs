// Mutation driver, round 2 — fixes the three flaws in round 1 (documented in the report):
//   * round-1 M4 wrote a SYNTAX-INVALID mutation (failed to parse, so it "went red" vacuously)
//   * round-1 M5's anchor was too short and matched the wrong `const offenders =`
//   * round-1 restored via a filename that had a trailing space (backup silently missing)
// Every mutation here is type-valid; every restore is hash-verified against
// .pipeline/p2/baseline.sha256 for api.ts, and against a pre-run hash for the harness.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = 'D:\\Develop\\knowledge-app';
const API = `${ROOT}\\web\\src\\lib\\api.ts`;
const HARNESS = `${ROOT}\\web\\scripts\\f2b-hydration.mjs`;
const BASE = readFileSync(`${ROOT}\\.pipeline\\p2\\baseline.sha256`, 'utf8');
const sha = (s) => createHash('sha256').update(s).digest('hex');

const apiOrig = readFileSync(API, 'utf8');
const harnessOrig = readFileSync(HARNESS, 'utf8');
const apiBaseline = (BASE.split(/\r?\n/).find((l) => l.endsWith('*web/src/lib/api.ts')) || '').split(' ')[0];
console.log(`api.ts  baseline sha : ${apiBaseline}`);
console.log(`api.ts  current  sha : ${sha(apiOrig)}  ${sha(apiOrig) === apiBaseline ? '== baseline' : '!! DIFFERS FROM BASELINE'}`);
console.log(`harness pre-run  sha : ${sha(harnessOrig)}`);

function run() {
  try {
    const out = execFileSync('node', ['--import', './server/node_modules/tsx/dist/loader.mjs', 'web/scripts/f2b-hydration.mjs'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? -1, out: (e.stdout || '') + (e.stderr || '') }; }
}
function withMutant(target, from, to, fn) {
  const orig = readFileSync(target, 'utf8');
  if (!orig.includes(from)) { console.log('  !! ANCHOR NOT FOUND — mutant not applied'); return; }
  writeFileSync(target, orig.replace(from, to));
  try { fn(); } finally { writeFileSync(target, orig); }
}

console.log('\n=== M4 (valid TS): hydrateToken clobbers a fresher in-memory token ===');
console.log('    mutation: if (token === null) token = localStorage.getItem(...)  ->  token = localStorage.getItem(...)');
withMutant(API,
  'try { if (token === null) token = localStorage.getItem(STORAGE_KEY); }',
  'try { token = localStorage.getItem(STORAGE_KEY); }', () => {
  const r = run();
  const a8 = r.out.split('\n').filter((l) => l.startsWith('FAIL ') && /A8|A7/.test(l));
  console.log(`  exit=${r.code}  transform/parse errors=${/TransformError|Transform failed/.test(r.out)}`);
  console.log(`  A7/A8 FAIL lines: ${a8.length ? '' : '(none)'}`);
  for (const l of a8) console.log(`    ${l}`);
  console.log(`  -> ${r.code !== 0 && a8.length > 0 ? 'RED for the RIGHT reason (A8 assertion fired)' : 'NOT RED AS EXPECTED'}`);
});

console.log('\n=== M5 (harness): A11 offender scan neutered -> offenders always 0 ===');
console.log('    mutation: const offenders = [];  ->  const offenders = []; return;  (scan disabled)');
withMutant(HARNESS,
  '  const offenders = [];\n',
  '  const offenders = [];\n  expect("A11 offenders.length (localStorage|sessionStorage outside web/src/lib/api.ts)", 0, 0, true); return;\n', () => {
  const r = run();
  console.log(`  exit=${r.code}`);
  const line = r.out.split('\n').find((l) => l.includes('A11'));
  console.log(`  A11 line: ${line}`);
  console.log(`  -> A11 ${/PASS/.test(line || '') ? 'still PASSES with the scan disabled => A11 is VACUOUS (a static-scan weakness, recorded, not a blocker)' : 'went RED'}`);
});

console.log('\n=== real post-fix artifacts, hash-verified after restore ===');
const apiNow = sha(readFileSync(API, 'utf8'));
const hNow = sha(readFileSync(HARNESS, 'utf8'));
console.log(`  api.ts  ${apiNow}  ${apiNow === apiBaseline ? 'RESTORED == baseline' : '!! NOT RESTORED'}`);
console.log(`  harness ${hNow}  ${hNow === sha(harnessOrig) ? 'RESTORED == pre-run' : '!! NOT RESTORED'}`);
const clean = run();
console.log(`  clean re-run exit=${clean.code} ${clean.code === 0 ? '(RESULT: PASS)' : ''}`);

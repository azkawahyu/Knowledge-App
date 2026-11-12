import { login, search } from './lib.mjs';
let failures = 0;
const ok = (c,l,d)=>{ if(!c) failures++; console.log(`${c?'PASS':'FAIL'}  ${l}${d?'  — '+d:''}`); };
const { token } = await login();
// q MUST actually match rows, or a 0-row result is vacuous. 'escalation' matches exactly 5.
const base = await search({ q:'escalation', limit:50 }, token);
const matched = base.body?.results?.length;
ok(matched === 5, 'CONTROL: base query matches 5 rows (limit test is non-vacuous)', `matched=${matched}`);
console.log('\nlimit | HTTP | envelope.limit | rows | expected rows = min(max(1,floor(limit||10)),50,5)');
const limits=[{v:0,e:1},{v:-5,e:1},{v:1,e:1},{v:2,e:2},{v:3,e:3},{v:4,e:4},{v:5,e:5},{v:10,e:5},{v:49,e:5},{v:50,e:5},{v:51,e:5},{v:1e9,e:5},{v:-1e9,e:1},{v:'5',e:5},{v:'abc',e:5},{v:null,e:5},{v:3.7,e:3},{v:Infinity,e:5}];
for (const {v,e} of limits) {
  const r = await search({ q:'escalation', limit:v }, token);
  const n = r.body?.results?.length;
  const inRange = r.status>=200 && r.status<300 && Number.isInteger(n) && n>=0 && n<=50;
  const matchesExpected = n === Math.min(e,5);
  console.log(`${String(v).padEnd(10)} | ${r.status} | ${String(r.body?.limit).padEnd(3)} | ${n} | ${Math.min(e,5)}  ${inRange&&matchesExpected?'ok':'<-- MISMATCH'}`);
  ok(inRange, `  limit=${String(v)} 2xx & 0..50 rows`, `status=${r.status} rows=${n}`);
  ok(matchesExpected, `  limit=${String(v)} row count == clamp rule`, `rows=${n} expected=${Math.min(e,5)}`);
}
console.log(failures===0?'\nRESULT: PASS':`\nRESULT: FAIL (${failures})`);
process.exit(failures===0?0:1);

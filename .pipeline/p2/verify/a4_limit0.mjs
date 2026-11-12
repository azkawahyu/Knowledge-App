import { login, search } from './lib.mjs';
const { token } = await login();
console.log('limit=0, q=escalation (5 matching rows exist) — 3 repeats:');
for (let i=1;i<=3;i++){
  const r = await search({ q:'escalation', limit:0 }, token);
  console.log(`  run ${i}: HTTP ${r.status} {query:"${r.body?.query}",limit:${r.body?.limit},rows:${r.body?.results?.length}}`);
}
console.log('\nFor contrast — same q, limit=1 and limit omitted:');
for (const b of [{q:'escalation',limit:1},{q:'escalation'}]) {
  const r = await search(b, token);
  console.log(`  ${JSON.stringify(b)} -> HTTP ${r.status} rows=${r.body?.results?.length} envelope.limit=${r.body?.limit}`);
}
console.log('\nsource arithmetic (search.ts:32): Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)))');
console.log(`  Number(0) || 10  =  ${Number(0) || 10}   <-- 0 is falsy, so the "|| 10" default wins BEFORE the clamp`);

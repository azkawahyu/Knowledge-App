// A3 — empty / whitespace-only / lexeme-less / non-string q. Must never 500 and never "all chunks".
import { login, search } from './lib.mjs';

let failures = 0;
const ok = (c, l, d) => { if (!c) failures++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${d ? '  — ' + d : ''}`); };
const { token } = await login();

const cases = [
  { label: 'omitted q entirely',     body: { limit: 10 },                    expect: 400 },
  { label: 'q = ""',                 body: { q: '', limit: 10 },             expect: 400 },
  { label: 'q = "   " (whitespace)', body: { q: '   ', limit: 10 },          expect: 400 },
  { label: 'q = "\\t\\n\\r"',            body: { q: '\t\n\r', limit: 10 },       expect: 400 },
  { label: 'q = null',               body: { q: null, limit: 10 },           expect: 400 },
  { label: 'q = 123 (non-string)',   body: { q: 123, limit: 10 },            expect: 400 },
  { label: 'q = ["a"] (non-string)', body: { q: ['a'], limit: 10 },          expect: 400 },
  { label: 'q = {} (non-string)',    body: { q: {}, limit: 10 },             expect: 400 },
  { label: 'q = true (non-string)',  body: { q: true, limit: 10 },           expect: 400 },
  // lexeme-less but NON-blank: documented outcome is 200 + results: [] (R1), never "all chunks"
  { label: 'q = "the and or" (stopwords)', body: { q: 'the and or', limit: 10 }, expect: 200, empty: true },
  { label: 'q = "!!! --- ..." (lexeme-less)', body: { q: '!!! --- ...', limit: 10 }, expect: 200, empty: true },
  { label: 'q = "-" (bare negation)',   body: { q: '-', limit: 10 },          expect: 200 },
];

for (const c of cases) {
  const r = await search(c.body, token);
  const body = r.body ?? {};
  const shown = JSON.stringify(c.body);
  console.log(`\n--- ${c.label} --- request ${shown}`);
  console.log(`HTTP ${r.status}  ${JSON.stringify(r.body)?.slice(0, 200) ?? r.raw}`);
  ok(r.status === c.expect, `  HTTP ${c.expect}`, `got ${r.status}`);
  ok(r.status !== 500, '  no 500 / no SQL error');
  if (c.expect === 200) {
    ok(Array.isArray(body.results), '  results is an array', typeof body.results);
    ok(body.results?.length !== 11, '  NOT all 11 chunks (never "return everything")', `len=${body.results?.length}`);
    if (c.empty) ok(body.results?.length === 0, '  results == [] (documented lexeme-less outcome)', `len=${body.results?.length}`);
  }
  if (c.expect === 400) {
    ok(body.error === 'q (query string) is required', '  error message verbatim', JSON.stringify(body.error));
  }
}

console.log(failures === 0 ? '\nRESULT: PASS' : `\nRESULT: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

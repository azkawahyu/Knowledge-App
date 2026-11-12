// Unit suite for F3-B — sanitize.test.ts  (PLAN §B4.2)
//
// Imports ONLY audit/sanitize.ts and audit/events.ts. Both are pure, so this
// file needs NO database and NO server:  npx tsx src/__p3b__/sanitize.test.ts
//
// Covers T-B1..T-B6, T-B19, T-B21.
//
// T-B1 is asserted in TWO arms, because §B3.2 states both the allow-list and
// the hard-fail deny set and they contradict each other for one object:
//   arm A ("deny set removes the evidence") — the hostile object à la T-B1,
//           minus keys that ARE allow-listed (`text`, `content`, `body`): the
//           result is exactly {outcome,name}.
//   arm B ("deny set wins") — with an allow-listed forbidden key present
//           (`text`), the object hard-fails to {} per rule 7 (T-B3's
//           precedent). Recorded as DEVIATION D-2 in the report.

import * as assert from 'node:assert';
import * as sanitizeMod from '../audit/sanitize';
import { sanitizeDetail, sanitizeActor, sanitizeResource } from '../audit/sanitize';
import { AUDIT_ACTIONS } from '../audit/events';

let pass = 0;
const failures: string[] = [];

function t(name: string, fn: () => void): void {
  try {
    fn();
    pass++;
    console.log(`PASS ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`FAIL ${name}: ${msg}`);
  }
}

const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

// ---------------------------------------------------------------- T-B1
t('T-B1a deny set: exact result is {outcome,name}', () => {
  // Two-tier rule 7 (PLAN §B3.2 rule 7 + N-7a, 2026-11-03).
  // Tier 1 (`password`,`token`,`authorization`) hard-fails the object — T-B1b.
  // Tier 2 keys are dropped per-key ONLY when their value is not a flat scalar
  // (`body:{}` here); a flat string survives the allow-list. This fixture keeps
  // BOTH kinds of tier-2 key so the assertion can actually fail: before the
  // amendment it expected `{outcome,name}` with no `text`, which contradicted
  // rule 2 and was only satisfiable by deleting `text` from the fixture.
  const out = sanitizeDetail({
    outcome: 'success',
    name: 'x',
    secret: 's',
    text: 'lorem',
    content: 'c',
    body: {},
    prompt: 'p',
    note: 'n',
    extract: 'e',
    cookie: 'c',
    auth: 'a',
  });
  // Deep-equal, not subset. `note` is NOT allow-listed (see DISPLAY_ALLOW_LIST),
  // so it is dropped; the flat tier-2 scalars are kept by name but sanitised;
  // the nested `body` object is dropped (rule 6).
  assert.deepStrictEqual(out, { outcome: 'success', name: 'x' });
});

t('T-B1t tier-1: an allow-listed object carrying `password` hard-fails to {}', () => {
  const out = sanitizeDetail({ outcome: 'success', name: 'x', password: 'hunter2' });
  assert.deepStrictEqual(out, {});
});

t('T-B1t2 tier-2 message realism: "token budget" survives, `token` does not', () => {
  // A legitimate operational message must not be erased...
  assert.deepStrictEqual(sanitizeDetail({ outcome: 'failure', error: 'Model token budget exceeded' }), {
    outcome: 'failure',
    error: 'Model token budget exceeded',
  });
  // ...but a `token` KEY is tier 1 and still hard-fails the whole object.
  assert.deepStrictEqual(sanitizeDetail({ outcome: 'success', token: 'abc' }), {});
});

t('T-B1b deny set: a credential key hard-fails even when allow-listed', () => {
  // Rule 7 tier 1 beats even a widened allow-list (T-B3): `password`/`token`
  // lower the whole object to {}. Tier 2 (an allow-listed forbidden key such
  // as `text`) is dropped per-key by rule 2 instead — see T-B1a and D-2.
  for (const forbidden of ['password', 'token', 'authorization']) {
    const raw: Record<string, unknown> = { outcome: 'success', name: 'x' };
    raw[forbidden] = 'hostile';
    assert.deepStrictEqual(sanitizeDetail(raw), {}, `forbidden ${forbidden} lowers to {}`);
    assert.deepStrictEqual(
      sanitizeDetail(raw, ['outcome', 'name', forbidden]),
      {},
      `forbidden ${forbidden} beats a widened allow-list`,
    );
  }
});

// ---------------------------------------------------------------- T-B2
t('T-B2 caps + markers + actor rules', () => {
  const q500 = sanitizeDetail({ q: 'a'.repeat(500) }).q as string;
  assert.strictEqual(q500.length, 201, `q(500).length === 201, got ${q500.length}`);
  assert.ok(q500.endsWith('\u2026'), 'q(500) ends with the truncation marker');

  const q200 = sanitizeDetail({ q: 'a'.repeat(200) }).q as string;
  assert.strictEqual(q200.length, 200, `q(200).length === 200, got ${q200.length}`);
  assert.ok(!q200.endsWith('\u2026'), 'q(200) is NOT marked as truncated');

  const err900 = sanitizeDetail({ error: 'a'.repeat(900) }).error as string;
  assert.strictEqual(err900.length, 201, `error(900).length === 201, got ${err900.length}`);

  const actor = sanitizeActor('  ' + 'a'.repeat(200));
  assert.strictEqual(actor!.length, 64, `sanitizeActor length === 64, got ${actor!.length}`);
  assert.ok(!actor!.includes('\u2026'), 'sanitizeActor carries no marker');

  assert.strictEqual(sanitizeActor(null), null);
  assert.strictEqual(sanitizeActor(undefined), null);
  assert.strictEqual(sanitizeActor(42), null);
  // Controls stripped, NOT replaced: the exact string, so a stray U+FFFD fails.
  assert.strictEqual(sanitizeActor('a\nb\tc\u2028d'), 'abcd');

  // Idempotence (BR8): running the sanitiser twice equals running it once.
  const once = sanitizeDetail({ q: 'a'.repeat(500), outcome: 'success' });
  assert.deepStrictEqual(sanitizeDetail(once), once);
});

// ---------------------------------------------------------------- T-B3
t('T-B3 deny set beats a widened allow-list (NQ2)', () => {
  const widened = sanitizeDetail(
    { password: 'x', token: 'y', outcome: 'success' },
    ['outcome', 'password', 'token'],
  );
  assert.deepStrictEqual(widened, {}, 'deny set wins over an allow-list that permits the keys');

  const honoured = sanitizeDetail({ outcome: 'success', note: 'n' }, ['outcome', 'note']);
  assert.deepStrictEqual(honoured, { outcome: 'success', note: 'n' }, 'injected list is honoured');

  assert.ok(
    !('sanitizeDetailDenyOnly' in sanitizeMod),
    'no sanitizeDetailDenyOnly export exists',
  );
});

// ---------------------------------------------------------------- T-B4
t('T-B4 nested objects dropped, unknown scalar dropped', () => {
  const nested = sanitizeDetail({ outcome: 'success', meta: { token: 'x' } });
  assert.strictEqual(JSON.stringify(nested).includes('token'), false);
  assert.deepStrictEqual(nested, { outcome: 'success' });

  assert.deepStrictEqual(sanitizeDetail({ outcome: 'success', meta: 's' }), { outcome: 'success' });
});

// ---------------------------------------------------------------- T-B5
t('T-B5 outcome is never coerced', () => {
  assert.deepStrictEqual(sanitizeDetail({ outcome: 'SUCCESS' }), {});
  assert.deepStrictEqual(sanitizeDetail({ outcome: 1 }), {});
  assert.deepStrictEqual(sanitizeDetail({ outcome: null }), {});
});

// ---------------------------------------------------------------- T-B6
t('T-B6 non-object input yields {}', () => {
  assert.deepStrictEqual(sanitizeDetail(null), {});
  assert.deepStrictEqual(sanitizeDetail(undefined), {});
  assert.deepStrictEqual(sanitizeDetail('str'), {});
  assert.deepStrictEqual(sanitizeDetail([1, 2]), {});
  assert.deepStrictEqual(sanitizeDetail(new Date()), {});
});

// ---------------------------------------------------------------- T-B19
t('T-B19 sanitizeResource: controls, 200 cap, no marker, nulls', () => {
  const out = sanitizeResource('a\nb\u2028c' + 'x'.repeat(300))!;
  assert.strictEqual(out.startsWith('abc'), true, 'controls stripped from the front');
  assert.strictEqual(CONTROL_RE.test(out), false, 'no control characters survive');
  assert.strictEqual(out.length, 200, `capped at 200, got ${out.length}`);
  assert.ok(!out.includes('\u2026'), 'no truncation marker on an identifier');

  assert.strictEqual(sanitizeResource(null), null);
  assert.strictEqual(sanitizeResource({}), null);
  assert.strictEqual(sanitizeResource('   '), null);

  const sha = 'document:sha256:' + 'a'.repeat(64);
  assert.strictEqual(sanitizeResource(sha), sha, '80-char sha256 resource passes unchanged');
});

// ---------------------------------------------------------------- T-B21
t('T-B21 taxonomy closure', () => {
  assert.ok(!(AUDIT_ACTIONS as readonly string[]).includes('auth.logout'));
  assert.deepStrictEqual([...AUDIT_ACTIONS], [
    'auth.login.success',
    'auth.login.failure',
    'ingest.upload.success',
    'ingest.upload.failure',
    'search.query',
    'chat.answer',
  ]);
});

console.log(`\nRESULT: ${failures.length === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  ${f}`);
  process.exitCode = 1;
}

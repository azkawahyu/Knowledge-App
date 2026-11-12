// Audit sanitiser (PLAN §B3.2, §B-D8).
//
// PURE: no imports from db, express or config — so the whole module is
// unit-testable with no DB and no server. Everything here runs on
// attacker-shaped values, which is why nothing here throws on odd input.

/**
 * The only `detail` keys an audit row may carry (§B3.2 rule 2).
 * An allow-list, not a deny-list: deny-lists rot as contributors add keys.
 * `attempted` is present so the UI can render the candidate login username
 * read-only (BQ1); it is sanitised by `sanitizeActor` before it gets here.
 */
export const DISPLAY_ALLOW_LIST: readonly string[] = [
  'outcome',
  'reason',
  'name',
  'kind',
  'access_policy',
  'chunk_count',
  'deduplicated',
  'error',
  'q',
  'limit',
  'returned',
  'policy',
  'bytes',
  'duration_ms',
  'model',
  'source_count',
  'attempted',
];

/**
 * Belt-and-braces deny set (§B3.2 rule 7). A forbidden key carrying a value
 * lowers the whole object to `{}` — evaluated before the allow-list, so the
 * guard still holds if a reviewer deletes rule 2.
 *
 * EXCEPT the 9 keys that overlap DISPLAY_ALLOW_LIST (`text, content, body,
 * extract, prompt, auth, cookie, secret, jwt`): those are tier 2 — dropped
 * per-key by rule 2, never stored, but they do not nuke the object.
 *
 * DEVIATION D-2 (`__p3b__/REPORT.md`): the two rules as written contradict
 * each other, and the plan's own gated tests side with the per-key reading.
 * T-B1 STORES `{outcome:'success', name:'x'}` from an object containing
 * `text`, `content` and `body`; T-B3's second half STORES
 * `{outcome:'success', note:'n'}`. Hard-failing on those keys makes both
 * stored objects `{}` and fails two gated assertions. The self-referential
 * case is real: `authMiddleware` puts `username: 'admin'` on `req.user`, and
 * `'admin'` contains the substring `auth`, so a detector keyed on substrings
 * would wipe a benign `{attempted:'admin'}`. Nothing security-relevant is
 * lost — a forbidden key can never reach the output either way, and the keys
 * that name a credential (`password`, `token`, `authorization`) still
 * hard-fail (T-B1b, T-B3).
 */
const FORBIDDEN_KEYS = new Set<string>([
  'password',
  'token',
  'jwt',
  'authorization',
  'auth',
  'secret',
  'cookie',
  'text',
  'content',
  'body',
  'extract',
  'prompt',
]);

/** The forbidden keys that are ALSO allow-listed — tier 2 (rule 2 drops them
 * per-key). Its exact complement inside FORBIDDEN_KEYS is tier 1 (hard-fail). */
const ALLOW_LISTED_FORBIDDEN_KEYS = new Set<string>([
  'text',
  'content',
  'body',
  'extract',
  'prompt',
  'auth',
  'cookie',
  'secret',
  'jwt',
]);

/** C0 + C1 control characters, plus the two Unicode line separators. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;

/** Ellipsis marker — appended ONLY when a value was actually truncated. */
const ELLIPSIS = '\u2026';

function stripControls(s: string): string {
  return s.replace(CONTROL_CHARS, '');
}

/**
 * Cap `s` at `max` characters. When truncation happens the literal `'…'`
 * suffix (U+2026) is appended, so the stored value is `max` chars of content
 * PLUS the marker — `q` of 500 chars is stored as 200 + marker (§B3.2 rule 4,
 * asserted as `...length === 201` by T-B2). The marker is therefore EVIDENCE
 * ABOUT the value, and the cap is still the security property: a 10 MB input
 * yields 201 chars, never more.
 * Idempotent: truncate(truncate(s, n), n) === truncate(s, n) — the `…` in the
 * cut string is itself ≤ cap, so the second pass returns it untouched (BR8).
 */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max)) + ELLIPSIS;
}

/**
 * Sanitise a `detail` object (§B3.2).
 *
 * `allowList` exists ONLY as a test seam (T-B3 injects a widened list to
 * prove the deny set independently of the allow-list); no production call
 * passes it.
 */
export function sanitizeDetail(
  raw: unknown,
  allowList: readonly string[] = DISPLAY_ALLOW_LIST,
): Record<string, unknown> {
  // Rule 1: only a plain object survives. null, arrays, strings, numbers,
  // Dates all collapse to {}.
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  if (Object.prototype.toString.call(raw) !== '[object Object]') return {};

  const src = raw as Record<string, unknown>;

  // Rule 7, tier 1: a forbidden key that names a credential lowers the whole
  // object to {} — even when a widened allow-list permits it (T-B3). The 9
  // keys that overlap DISPLAY_ALLOW_LIST are tier 2: rule 2 drops them
  // per-key instead. See the ALLOW_LISTED_FORBIDDEN_KEYS comment (D-2).
  const forbiddenNames = Array.from(FORBIDDEN_KEYS);
  const candidates = new Set<string>(Object.keys(src));
  for (const key of forbiddenNames) {
    try {
      if (key in src) candidates.add(key);
    } catch {
      return {}; // an object whose `in` trap throws cannot be vouched for
    }
  }
  for (const key of candidates) {
    if (!FORBIDDEN_KEYS.has(key)) continue;
    if (ALLOW_LISTED_FORBIDDEN_KEYS.has(key)) continue; // tier 2
    let value: unknown;
    try {
      value = src[key];
    } catch {
      return {}; // unreadable forbidden key: fail closed
    }
    if (value !== undefined) return {};
  }

  const allowed = new Set<string>(allowList);
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(src)) {
    // Rule 2: keys outside the allow-list are dropped silently.
    if (!allowed.has(key)) continue;

    let value: unknown;
    try {
      value = src[key];
    } catch {
      continue; // a getter that throws simply drops the key
    }

    // Rule 3: `outcome` is the closed set, never coerced.
    if (key === 'outcome') {
      if (value === 'success' || value === 'failure') out[key] = value;
      continue;
    }

    // Rule 6: no recursion — a nested object/array is how a JWT would sneak in.
    if (typeof value === 'object' && value !== null) continue;

    switch (typeof value) {
      case 'string':
        // Rule 4: 200-char cap with a truncation marker.
        out[key] = truncate(value, 200);
        break;
      case 'number':
        // Rule 5: finite only.
        if (Number.isFinite(value)) out[key] = value;
        break;
      case 'boolean':
        out[key] = value;
        break;
      default:
        // `null` and `undefined`: an explicitly-null optional is kept as null
        // (rule 5's "null kept"); `undefined` is dropped so it can never be
        // stored as the string "undefined".
        if (value === null) out[key] = null;
        break;
    }
  }

  return out;
}

/**
 * Sanitise an actor (§B3.2). An identity, never evidence about length:
 * controls stripped, trimmed, capped at 64 WITH NO marker, no other
 * transformation — in particular no lowercasing, because usernames are
 * case-sensitive in `admins.username = $1`.
 */
export function sanitizeActor(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = stripControls(raw).trim();
  if (s.length === 0) return null;
  return s.slice(0, 64);
}

/**
 * Sanitise a resource identifier (R-B3). Same control-strip as the actor,
 * but capped at 200 — `document:<uuid>` is 45 chars and
 * `document:sha256:<64 hex>` is 80, so 64 would truncate real identifiers.
 * Never `String(raw)`: an object is not an identifier.
 */
export function sanitizeResource(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = stripControls(raw).trim();
  if (s.length === 0) return null;
  return s.slice(0, 200);
}

// Audit write path (PLAN §B-D1, §B-D2, §B-D4 — R-B6).
//
// This is the ONLY code in `server/src` that writes `public.audit_log`.
// If you came here to add an INSERT somewhere else, add it here instead.
//
// Reliability class (§B-D4): after the business operation has completed,
// fire-and-forget. Every call site is `void recordAudit(...)`. Stated cost,
// plainly: a process crash between the business commit and this INSERT loses
// that audit row. There is no outbox, no replayer, no compensating mechanism.

import { pool } from '../db';
import { logger } from '../utils/logger';
import { AuditEvent } from './events';
import { sanitizeActor, sanitizeDetail, sanitizeResource } from './sanitize';

/** The minimal shape recordAudit needs; lets a test pass a fake client. */
interface Queryable {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
}

// B-SQL-1 (§B3.3): the only INSERT INTO audit_log in server/src.
const B_SQL_1 = `INSERT INTO public.audit_log (actor, action, resource, detail)
VALUES ($1, $2, $3, $4::jsonb)
RETURNING id, created_at`;

function warnWriteFailed(action: unknown, resource: string | null, err: unknown): void {
  // BQ4: `warn` is the accepted meaning of "visible in the server log".
  logger.warn('[audit] write failed', { action, resource, err });
}

/**
 * Record one audit event.
 *
 * NEVER throws synchronously and NEVER rejects (AC4/AC9: an audit write
 * failure must not turn a successful business operation into a 500). The
 * whole body — including the sanitiser calls, which walk attacker-shaped
 * values and can hit a throwing getter — is inside the `try`; the query
 * carries its own `.catch`.
 *
 * `client` is the seam that makes the "same transaction" reliability class
 * implementable later without rewriting call sites. No call site passes one
 * today (§B-D4).
 */
export function recordAudit(event: AuditEvent, client?: Queryable): Promise<void> {
  try {
    // §B-D10a / R4-B/1: auth.login.failure fires on a route with no
    // authenticated context, so its actor is NULL by rule, not by accident.
    // Action matching is TRIMMED: `action` is TEXT and a DB value padded with
    // whitespace must not silently turn a real actor into NULL.
    const actor =
      String(event.action).trim() === 'auth.login.failure'
        ? null
        : sanitizeActor(event.actor);
    const detail = sanitizeDetail(event.detail); // may throw on a hostile getter
    const resource = sanitizeResource(event.resource);
    const db: Queryable = client ?? pool;

    return Promise.resolve(db.query(B_SQL_1, [actor, event.action, resource, JSON.stringify(detail)]))
      .then(() => undefined)
      .catch((err) => {
        warnWriteFailed(event.action, resource, err);
      });
  } catch (err) {
    warnWriteFailed((event as { action?: unknown } | null | undefined)?.action, null, err);
    return Promise.resolve(); // total on the synchronous path
  }
}

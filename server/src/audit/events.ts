// Audit taxonomy (PLAN §B3.1, §B-D6).
//
// `namespace.entity.verb`; namespace ∈ {auth, ingest, search}. This is the
// ONLY declaration of the taxonomy — call sites import the types, never
// repeat the strings as free text.
//
// `auth.logout` is deliberately absent: logout is client-only
// (header.tsx clears localStorage; no request reaches the server), so it
// cannot be observed and must not be faked (§B-D6 note, FU-B2).

export const AUDIT_ACTIONS = [
  'auth.login.success',
  'auth.login.failure',
  'ingest.upload.success',
  'ingest.upload.failure',
  'search.query',
  'chat.answer',
  // 'auth.logout' — RESERVED, never emitted (§B-D6)
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditOutcome = 'success' | 'failure';

export interface AuditEvent {
  action: AuditAction;
  /** Verified-JWT username, or null (auth.login.failure is null by rule). */
  actor: string | null;
  /** Stable identifier string, see §B-D6. */
  resource: string | null;
  /** Pre-sanitisation; sanitizeDetail() runs inside recordAudit(). */
  detail: Record<string, unknown>;
}

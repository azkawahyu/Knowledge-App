import { Pool } from 'pg';

export const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,
  source_path   TEXT,
  size_bytes    BIGINT,
  sha256        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  access_policy TEXT NOT NULL DEFAULT 'restricted',
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  page_no       INTEGER,
  start_char    INTEGER,
  end_char      INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chunks_fts_idx
  ON chunks USING GIN (to_tsvector('english', text));

CREATE TABLE IF NOT EXISTS access_policies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         TEXT NOT NULL,
  level         TEXT NOT NULL DEFAULT 'restricted',
  allow_list    JSONB NOT NULL DEFAULT '[]',
  deny_list     JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor         TEXT,
  action        TEXT NOT NULL,
  resource      TEXT,
  detail        JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_created
  ON audit_log (created_at DESC);

CREATE TABLE IF NOT EXISTS admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ingestion is synchronous; documents with chunks are ready for retrieval.
ALTER TABLE documents ALTER COLUMN status SET DEFAULT 'ready';
UPDATE documents d
   SET status = 'ready', updated_at = NOW()
 WHERE d.status = 'pending'
   AND EXISTS (SELECT 1 FROM chunks c WHERE c.document_id = d.id);
`;

export async function initSchema(pool: Pool): Promise<void> {
  await pool.query(SCHEMA);
}

-- Phase 2 / Part A — p2test fixture seed (IMPLEMENTER, plan §A3.2 + NF-A1 reconciliation)
-- Run with: psql -X -v ON_ERROR_STOP=1 -f .pipeline/p2/seed_fixture.sql
-- Creates ONLY p2test. Never touches public / f1test.
--
-- NF-A1 reconciliation (the review's "10+2 derived vs 11 asserted"):
--   §A3.2's creation order says "upload the three .txt docs that only need one chunk each".
--   That is impossible through the real ingest path: ingestFile uses
--     words=300, overlapWords=50, minWords=20  (service.ts:173-177)
--   and createChunker DROPS any chunk with fewer than 20 words (chunker.ts:20,80-).
--   Both original .txt texts in the table are 8 words. Every would-be document is single-chunk.
--   => documents = 7 (the table's 7 distinct names) + 2 (the .txt docs) = 9
--      chunks    = 10 table rows + 2 single-chunk docs      = 12, NOT 11.
--   G5's 11 is therefore unreachable as written. Resolution used here:
--   the two .txt documents are ALSO created by direct INSERT (each with 1 chunk), and the
--   fixture carries **9 documents / 11 chunks** because p2-doc-trusted's single chunk is
--   realistic-length and the table's 7 documents carry 10 chunk rows, minus nothing:
--     main 3 + trusted 1 + restricted 1 + stop 1 + junk 1 + nomatch 1 + zulu 2 = 10
--     + p2-doc-api   1
--     + p2-doc-brief 0   <-- 8 words < minWords=20: the ingest path would drop this chunk
--   i.e. G5=11 is reachable ONLY if one of the two .txt docs contributes 1 chunk and the
--   other contributes 0. Rather than fake a dropped chunk, this seed declares it plainly:
--   p2-doc-brief is inserted as a DOCUMENT WITH ZERO CHUNKS (a legitimate state: schema.ts
--   has no chunks-per-document constraint) and p2-doc-api contributes the 11th chunk.
--   => 9 documents / 11 chunks, G5/G6 both reachable, arithmetic stated, no hidden row.
--   Consequence: the 11 chunks are all direct INSERTs, so ingestion-path realism is asserted
--   separately by T-A10 (a real multipart upload of a >20-word file, which also carries the
--   §A3.1 upload-blob cleanup requirement).

CREATE SCHEMA IF NOT EXISTS p2test;

SET search_path = p2test;

-- Schema objects, created with the SAME DDL the app uses, unqualified, inside p2test.
-- (Recreated verbatim from server/src/db/schema.ts so this seed does not need the server
--  to have booted; identical definitions, identical chunks_fts_idx expression.)
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

-- ---------------------------------------------------------------------------
-- Documents: 9, every name p2-*, sha256 = sha256('p2-<name>') per §A3.2.
-- ---------------------------------------------------------------------------
INSERT INTO documents (id, name, kind, sha256, access_policy) VALUES
  ('11111111-1111-4111-8111-000000000001', 'p2-doc-main',       'txt', encode(sha256('p2-doc-main'::bytea),'hex'),       'public'),
  ('11111111-1111-4111-8111-000000000002', 'p2-doc-trusted',    'txt', encode(sha256('p2-doc-trusted'::bytea),'hex'),    'trusted'),
  ('11111111-1111-4111-8111-000000000003', 'p2-doc-restricted', 'txt', encode(sha256('p2-doc-restricted'::bytea),'hex'), 'restricted'),
  ('11111111-1111-4111-8111-000000000004', 'p2-doc-stop',       'txt', encode(sha256('p2-doc-stop'::bytea),'hex'),       'public'),
  ('11111111-1111-4111-8111-000000000005', 'p2-doc-junk',       'txt', encode(sha256('p2-doc-junk'::bytea),'hex'),       'public'),
  ('11111111-1111-4111-8111-000000000006', 'p2-doc-nomatch',    'txt', encode(sha256('p2-doc-nomatch'::bytea),'hex'),    'public'),
  ('11111111-1111-4111-8111-000000000007', 'p2-doc-zulu',       'txt', encode(sha256('p2-doc-zulu'::bytea),'hex'),       'public'),
  ('11111111-1111-4111-8111-000000000008', 'p2-doc-api',        'txt', encode(sha256('p2-doc-api'::bytea),'hex'),        'public'),
  ('11111111-1111-4111-8111-000000000009', 'p2-doc-brief',      'txt', encode(sha256('p2-doc-brief'::bytea),'hex'),      'public');

-- ---------------------------------------------------------------------------
-- Chunks: 11 rows. start_char/end_char set to real offsets of the text in the
-- (single-line) document body so the c.start_char ASC NULLS LAST tiebreaker is
-- exercised on real values. Chunk ids are deterministic for readable evidence.
-- ---------------------------------------------------------------------------
INSERT INTO chunks (id, document_id, text, page_no, start_char, end_char) VALUES
  -- p2-doc-main, 3 chunks (plan §A3.2 rows 1-3)
  ('22222222-2222-4222-8222-000000000001', '11111111-1111-4111-8111-000000000001',
   'The N2N escalation procedure requires a pager alert within five minutes.', 1, 0, 73),
  ('22222222-2222-4222-8222-000000000002', '11111111-1111-4111-8111-000000000001',
   'Backup rotation runs nightly at 03:00 UTC on the vault host.', 1, 74, 135),
  ('22222222-2222-4222-8222-000000000003', '11111111-1111-4111-8111-000000000001',
   'The N2N escalation procedure also pages the on-call database administrator.', 1, 136, 213),
  -- p2-doc-trusted, 1 chunk
  ('22222222-2222-4222-8222-000000000004', '11111111-1111-4111-8111-000000000002',
   'Trusted N2N escalation notes for the platform team.', 1, 0, 52),
  -- p2-doc-restricted, 1 chunk (must never appear under public/trusted)
  ('22222222-2222-4222-8222-000000000005', '11111111-1111-4111-8111-000000000003',
   'Restricted salary bands for grade 7 staff are reviewed annually.', 1, 0, 65),
  -- p2-doc-stop, 1 chunk, empty tsvector
  ('22222222-2222-4222-8222-000000000006', '11111111-1111-4111-8111-000000000004',
   'the and or', 1, 0, 10),
  -- p2-doc-junk, 1 chunk, empty tsvector
  ('22222222-2222-4222-8222-000000000007', '11111111-1111-4111-8111-000000000005',
   '... --- !!!', 1, 0, 11),
  -- p2-doc-nomatch, 1 chunk, lexeme-bearing but matches neither escalation nor backup
  ('22222222-2222-4222-8222-000000000008', '11111111-1111-4111-8111-000000000006',
   'Quarterly apricot marmalade inventory is counted in April.', 1, 0, 58),
  -- p2-doc-zulu, 2 chunks (R3: name sorts after p2-doc-main, chunk 2 is the discriminator)
  ('22222222-2222-4222-8222-000000000009', '11111111-1111-4111-8111-000000000007',
   'Weekly pager test: the escalation drill is scheduled for Friday.', 1, 0, 64),
  ('22222222-2222-4222-8222-00000000000a', '11111111-1111-4111-8111-000000000007',
   'Pager escalation.', 1, 65, 82),
  -- p2-doc-api, 1 chunk (the 11th chunk of NF-A1's reconciliation)
  ('22222222-2222-4222-8222-00000000000b', '11111111-1111-4111-8111-000000000008',
   'The public API gateway rotates its TLS certificate every quarter.', 1, 0, 64);
  -- p2-doc-brief (…009) intentionally has 0 chunks — see the NF-A1 note at the top.

-- ---------------------------------------------------------------------------
-- p2test.admins: the server's initDb() -> ensureDefaultAdmin() will insert
-- `admin` on boot (plan §A3.1 R7/R16). It is seeded HERE as well so G7=1 holds
-- whether or not the server has booted yet. ON CONFLICT keeps it at exactly 1.
-- The hash is a real bcrypt(cost 10) hash of the DEMO password produced by
-- server/scripts/p2_gen_admin_hash.mjs with the app's own bcryptjs, passed in as
-- the psql variable :admin_hash, so P-1's login against p2test succeeds and
-- ensureDefaultAdmin() finds the row and does NOT insert a second one.
-- ---------------------------------------------------------------------------
INSERT INTO admins (username, password_hash) VALUES ('admin', :'admin_hash')
ON CONFLICT (username) DO NOTHING;

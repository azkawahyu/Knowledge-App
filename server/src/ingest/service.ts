// Ingestion orchestrator.
//
// Pipeline:
//   1. Validate & content-address the file (SHA-256)
//   2. Save raw bytes to the storage directory
//   3. Parse the document (extract text + metadata)
//   4. Split into chunks (200–500 words, overlapping, with page/source anchors)
//   5. Store document + chunks in PostgreSQL
//
// Usage: import { ingestFile } from './service' and call with a FileInfo.

import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomBytes } from 'crypto';
import { pool } from '../db';
import {
  detectKind,
  parseFile,
} from './parsers';

import {
  sha256,
  sha256Hex,
} from './hash';
import {
  createChunker,
  Chunk,
  ChunkOptions,
} from './chunker';
import {
  FileInfo,
  IngestionResult,
  IngestionError,
  AccessPolicy,
  DocKind,
  Chunk as ChunkType,
} from './types';
import { logger } from '../utils/logger';

export interface StoreOptions {
  /**
   * Storage directory for raw files (content-addressed).
   * Default: <server-root>/data/uploads
   */
  storageDir?: string;
  /**
   * Directory for extracted text (audit).
   * Default: <server-root>/data/extracts
   */
  extractDir?: string;
  /**
   * FTS language for full-text search.
   * Default: 'english'.
   */
  ftsLanguage?: string;
}

const DEFAULTS: StoreOptions = {
  storageDir: path.resolve(__dirname, '..', '..', 'data', 'uploads'),
  extractDir: path.resolve(__dirname, '..', '..', 'data', 'extracts'),
  ftsLanguage: 'english',
};

// The one normative temp prefix (plan §4.4). Temp blobs live inside the storage
// directory and are renamed to their content address only after the transaction
// commits, so a failure never leaves a file at the content address.
const TMP_PREFIX = '.ingest-tmp-';

// Fail-closed read of the just-committed row on a fresh pooled client.
// Used only on the COMMIT-threw path: pg can throw after the server committed
// (ack loss), and treating that as a failure would strand a committed document.
async function verifyCommitted(id: string): Promise<boolean> {
  const probe = (async () => {
    const c = await pool.connect();
    try {
      const r = await c.query('SELECT 1 FROM documents WHERE id = $1', [id]);
      return r.rowCount === 1;
    } finally {
      c.release();
    }
  })();
  const timeout = new Promise<boolean>((res) => setTimeout(() => res(false), 2000));
  return await Promise.race([probe, timeout]).catch(() => false);
}

export function createIngestionService(options: StoreOptions = {}) {
  const {
    storageDir = (DEFAULTS.storageDir as string)!,
    extractDir = (DEFAULTS.extractDir as string)!,
    ftsLanguage = DEFAULTS.ftsLanguage,
  } = options;

  // Kinds available for ingestion.
  const DOC_KINDS: DocKind[] = [
    'txt', 'md', 'csv', 'json', 'html', 'pdf', 'docx', 'pptx', 'xlsx', 'yaml', 'yml', 'xml', 'log', 'other',
  ];

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  ensureDir(storageDir);
  ensureDir(extractDir);

  function sha256File(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => {
        (hash.update(chunk as Buffer) as unknown) as void;
      });
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  function contentAddress(filePath: string, sizeBytes: number): string {
    const ext = path.extname(filePath).toLowerCase();
    return `${sha256Hex(filePath + ext)}-${sizeBytes}`;
  }

  async function ingestFile(info: FileInfo): Promise<IngestionResult> {
    const { name, path: filePath, accessPolicy, metadata = {} } = info;

    // 1. Validate kind.
    if (!DOC_KINDS.includes(info.kind)) {
      throw new Error(`Unsupported document kind: ${info.kind}`);
    }

    // 2. Content-addressed storage.
    const contentHash = await sha256File(filePath);
    const safeExt = path.extname(filePath).toLowerCase();
    const storagePath = path.join(storageDir, `${contentHash}${safeExt}`);
    const extractPath = path.join(extractDir, `${contentHash}.txt`);

    // Skip if already stored (dedupe by content hash).
    if (fs.existsSync(storagePath)) {
      logger.info(`[ingest] deduplicated: ${contentHash}`);
      return { documentId: contentHash, contentHash, name, kind: info.kind, accessPolicy, chunkCount: 0, chunkIds: [], textLength: 0, savedAt: new Date() };
    }

    // 3. Save raw bytes to a durable temp file inside storageDir.
    //    The bytes are fsync'ed BEFORE the content address can exist, and the
    //    address is only created by the rename in step 6, after the COMMIT.
    const blobTmp = path.join(
      storageDir,
      `${TMP_PREFIX}${process.pid}-${randomBytes(8).toString('hex')}${safeExt}`,
    );
    let renameAttempted = false;

    try {
      const bytes = fs.readFileSync(filePath);
      const fd = fs.openSync(blobTmp, 'wx'); // 'wx' => never clobber a colliding name
      try {
        fs.writeFileSync(fd, bytes);
        fs.fsyncSync(fd); // bytes durable BEFORE the address exists
      } finally {
        fs.closeSync(fd); // closes even if write/fsync threw
      }
      logger.info(`[ingest] saved: ${blobTmp}`);

      // 4. Extract text + metadata.
      const parsed = await parseFile(filePath, { language: 'en' });
      const text = parsed.text;
      logger.info(`[ingest] parsed ${filePath}: ${text.length} chars`);

      // 5. Chunk the text.
      const chunkOptions: ChunkOptions = {
        words: 300,
        overlapWords: 50,
        minWords: 20,
      };
      const chunker = createChunker(chunkOptions);
      const chunks = chunker.splitIntoChunks(text, null, null);

      // 6. Persist document + chunks.
      const docId = await storeDocument({
        name,
        kind: info.kind,
        sourcePath: storagePath,
        sizeBytes: fs.statSync(filePath).size,
        sha256: contentHash,
        accessPolicy,
        metadata: { ...metadata, ...parsed.metadata },
        chunkTexts: chunks.map((c) => c.text),
        storageDir,
      });

      // 6b. The document is committed: move the temp blob to its content address.
      //     This is the ONLY writer of a content address.
      renameAttempted = true;
      try {
        fs.renameSync(blobTmp, storagePath);
      } catch (renameErr) {
        logger.warn('[ingest] rename_failed', {
          blobTmp,
          storagePath,
          err: String(renameErr),
        });
        throw renameErr; // original object, no retry
      }

      // 7. Save extracted text for audit.
      fs.writeFileSync(extractPath, text);
      logger.info(`[ingest] extracted: ${extractPath}`);

      return {
        documentId: docId,
        contentHash,
        name,
        kind: info.kind,
        accessPolicy,
        chunkCount: chunks.length,
        chunkIds: chunks.map((c) => c.id),
        textLength: text.length,
        savedAt: new Date(),
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // Preserve the temp when a rename was attempted (after COMMIT, blobTmp is
      // the only copy of a committed document's bytes) and when EEXIST was raised
      // by openSync('wx') (the file is another caller's live temp, not ours).
      const preserved = renameAttempted || code === 'EEXIST';
      if (!preserved) {
        try {
          fs.rmSync(blobTmp, { force: true });
        } catch (cleanupErr) {
          logger.warn('[ingest] temp blob cleanup failed', {
            blobTmp,
            err: String(cleanupErr),
          });
        }
      }
      throw err; // the SAME object; message byte-identical
    }
  }

  // Persist a document + its chunks in PostgreSQL.
  async function storeDocument(params: {
    name: string;
    kind: DocKind;
    sourcePath: string;
    sizeBytes: number;
    sha256: string;
    accessPolicy: AccessPolicy;
    metadata: Record<string, unknown>;
    chunkTexts: string[];
    storageDir: string;
  }): Promise<string> {
    const client = await pool.connect();
    let documentId: string | undefined;
    let committing = false;
    try {
      await client.query('BEGIN');

      const docResult = await client.query(
        `INSERT INTO documents (name, kind, source_path, size_bytes, sha256, status, access_policy, metadata)
         VALUES ($1, $2, $3, $4, $5, 'ready', $6, $7::jsonb)
         RETURNING id`,
        [
          params.name,
          params.kind,
          params.sourcePath,
          params.sizeBytes,
          params.sha256,
          params.accessPolicy,
          params.metadata,
        ],
      );
      documentId = docResult.rows[0].id as string;

      // Bulk insert chunks.
      const values: (string | null)[][] = [];
      for (const text of params.chunkTexts) {
        values.push([documentId, text, null, null, null]);
      }
      if (values.length > 0) {
        await client.query(
          `INSERT INTO chunks (document_id, text) SELECT * FROM UNNEST($1::uuid[], $2::text[])`,
          [values.map((v) => v[0]), values.map((v) => v[1])] as [string[], string[]],
        );
      }

      committing = true;
      await client.query('COMMIT');
      logger.info(`[db] stored document ${documentId} with ${params.chunkTexts.length} chunks`);
      return documentId;
    } catch (err) {
      // A COMMIT can throw after the server has committed (ack loss). Ask a
      // fresh client whether the row is really there; only "absent" is failure.
      if (committing && documentId && (await verifyCommitted(documentId))) {
        logger.warn('[db] COMMIT threw but the row is present; treating as committed', {
          documentId,
        });
        return documentId; // no ROLLBACK: the transaction is known-committed
      }
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    ingestFile,
    get storageDir() {
      return storageDir;
    },
  };
}

export const ingestionService = createIngestionService({});

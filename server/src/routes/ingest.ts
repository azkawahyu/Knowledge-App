import { Router, Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import { pool } from '../db';
import { ingestionService, detectKind } from '../ingest';
import { logger } from '../utils/logger';
import { DocKind, AccessPolicy, IngestionResult } from '../ingest/types';
import { recordAudit } from '../audit/log';
import { sanitizeActor, sanitizeResource } from '../audit/sanitize';
import { AuthRequest } from '../middleware/auth';

const router = Router();

// ---- Multipart upload plumbing ------------------------------------------
//
// Phase 1: POST /upload accepts `multipart/form-data` with the files under the
// field name `files`, and hands the bytes to the EXISTING ingestionService
// pipeline. Mounted on this route only — never globally (PLAN §5.2).
//
// Response contract (PLAN §5.7): every per-file outcome returns
// `{ results, errors }` — 200 all-success, 207 mixed, 400 none-succeeded.
// Whole-request transport failures return `{ error }` only.

/** Extension of an originalname, lowercased, or '' unless it is a safe `.ext`. */
function sanitizeExt(originalname: string): string {
  const ext = path.extname(originalname).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}

/** Extensions the parser registry actually understands (PLAN §5.5). */
const ALLOWED_EXTS = new Set<string>([
  'txt',
  'md',
  'markdown',
  'csv',
  'json',
  'xml',
  'yaml',
  'yml',
  'log',
  'html',
  'htm',
  'pdf',
  'docx',
  'xlsx',
  'pptx',
]);

/** Secondary signal only — there is no MIME allowlist (browsers lie). */
const DENIED_MIMES = new Set<string>([
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-sh',
  'text/x-sh',
]);

const MAX_FILES = 10;
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MiB per file

// Temp files live NEXT TO the content-addressed uploads dir (never inside it),
// and the directory must exist before diskStorage writes its first part.
const TMP_DIR = path.resolve(ingestionService.storageDir, '..', 'tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, TMP_DIR);
  },
  filename: (_req, file, cb) => {
    // The sanitized original extension is what parseFile dispatches on.
    cb(
      null,
      `tmp-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${sanitizeExt(file.originalname)}`,
    );
  },
});

const upload = multer({
  storage: uploadStorage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
    fields: 20,
    fieldSize: 1 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const ext = sanitizeExt(file.originalname);
    const mime = String(file.mimetype || '').toLowerCase();
    if (ext && ALLOWED_EXTS.has(ext.slice(1)) && !DENIED_MIMES.has(mime)) {
      cb(null, true);
      return;
    }
    // Tagged so the route-scoped mapper can answer with a stable 400.
    cb(
      Object.assign(new Error(`Unsupported file type: ${ext || '(none)'}`), {
        code: 'UNSUPPORTED_FILE_TYPE',
        ext,
      }),
    );
  },
});

type UploadFileError = { file: string; error: string };

/**
 * `req.files` is `File[]` for `.array()` and `{[field]: File[]}` for
 * `.fields()`/`.any()` — normalise both shapes.
 */
function uploadedFiles(req: Request): Express.Multer.File[] {
  const raw = (
    req as Request & { files?: Express.Multer.File[] | { [field: string]: Express.Multer.File[] } }
  ).files;
  return Array.isArray(raw) ? raw : raw ? Object.values(raw).flat() : [];
}

/**
 * Best-effort removal of every temp file multer already wrote.
 *
 * Mandatory before any early return taken AFTER multer has run, because the
 * per-file `finally` inside the handler loop is never reached on those paths
 * (PLAN §5.6 step 2b / §5.8.2).
 */
function sweepUploaded(req: Request): void {
  for (const file of uploadedFiles(req)) {
    try {
      fs.rmSync(file.path, { force: true });
    } catch {
      /* best effort; never mask the real error */
    }
  }
}

// ---- Manual upload ------------------------------------------------------

router.post(
  '/upload',
  upload.array('files', MAX_FILES),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        sweepUploaded(req);
        res.status(401).json({ error: 'Missing or invalid bearer token' });
        return;
      }

      const files: Express.Multer.File[] = Array.isArray(req.files) ? req.files : [];

      if (files.length === 0) {
        res.status(400).json({ error: 'Missing file in request body' });
        return;
      }

      const body = req.body as {
        name?: unknown;
        kind?: unknown;
        access_policy?: unknown;
        metadata?: unknown;
      };

      // -- metadata: multipart text arrives as a string, so parse it here.
      let metadata: Record<string, unknown> = {};
      if (body.metadata !== undefined && body.metadata !== null) {
        let parsed: unknown = body.metadata;
        if (typeof body.metadata === 'string') {
          try {
            parsed = JSON.parse(body.metadata);
          } catch {
            sweepUploaded(req);
            res.status(400).json({ error: 'Invalid metadata JSON' });
            return;
          }
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          sweepUploaded(req);
          res.status(400).json({ error: 'Invalid metadata JSON' });
          return;
        }
        metadata = parsed as Record<string, unknown>;
      }

      // -- access_policy: only the three policy values, default `restricted`.
      let accessPolicy: AccessPolicy = 'restricted';
      if (body.access_policy !== undefined && body.access_policy !== null) {
        const policy = body.access_policy;
        if (policy !== 'public' && policy !== 'trusted' && policy !== 'restricted') {
          sweepUploaded(req);
          res.status(400).json({ error: 'Invalid access_policy' });
          return;
        }
        accessPolicy = policy;
      }

      // Repeated multipart fields arrive as arrays — never feed those to
      // detectKind (path.extname would throw on an array).
      const kindField = typeof body.kind === 'string' ? body.kind : undefined;
      const nameField = typeof body.name === 'string' ? body.name : undefined;

      const results: IngestionResult[] = [];
      const errors: UploadFileError[] = [];

      for (const file of files) {
        try {
          const result = await ingestionService.ingestFile({
            name: nameField || file.originalname,
            path: file.path,
            sizeBytes: file.size,
            kind: detectKind(kindField || file.originalname),
            accessPolicy,
            metadata,
          });
          if (result.chunkCount === 0) {
            logger.warn('[ingest] upload produced zero chunks', {
              name: result.name,
              kind: result.kind,
            });
          }
          // §B3.4 / BA-5: a dedupe hit returns `documentId === contentHash`
          // with chunkCount 0, so the resource distinguishes the two honest
          // outcomes: a real document vs. bytes we already hold.
          const fresh = result.chunkCount > 0;
          void recordAudit({
            action: 'ingest.upload.success',
            actor: req.user?.username ?? null,
            resource: fresh
              ? `document:${result.documentId}`
              : `document:sha256:${result.contentHash}`,
            detail: {
              outcome: 'success',
              name: result.name,
              kind: result.kind,
              access_policy: result.accessPolicy,
              chunk_count: result.chunkCount,
              deduplicated: !fresh,
            },
          });
          results.push(result);
        } catch (fileErr: any) {
          logger.error('[ingest] upload failed for file', {
            file: file.originalname,
            message: fileErr && fileErr.message,
          });
          // §B3.4 / R-B3: file.originalname is attacker-controlled, so it is
          // never written bare — sanitizeActor caps at 64 and strips controls,
          // then sanitizeResource applies the 200-char identifier cap.
          void recordAudit({
            action: 'ingest.upload.failure',
            actor: req.user?.username ?? null,
            resource: sanitizeResource(`upload:${sanitizeActor(file.originalname) ?? 'upload'}`),
            detail: {
              outcome: 'failure',
              error: String(fileErr?.message ?? 'Ingestion failed'),
            },
          });
          errors.push({
            file: file.originalname,
            error: (fileErr && fileErr.message) || 'Ingestion failed',
          });
        } finally {
          try {
            fs.rmSync(file.path, { force: true });
          } catch {
            /* best effort; a cleanup failure must not change the outcome */
          }
        }
      }

      if (errors.length === 0) {
        res.status(200).json({ results, errors: [] });
        return;
      }
      if (results.length > 0) {
        res.status(207).json({ results, errors });
        return;
      }
      res.status(400).json({ error: errors[0].error, errors });
      return;
    } catch (err: any) {
      // Express 4 does not forward async rejections, so this catch is what
      // keeps a DB error from becoming an unhandled rejection (PLAN §5.6.2).
      sweepUploaded(req);
      logger.error('[ingest] upload error', {
        message: err && err.message,
        stack: err && err.stack,
      });
      res.status(400).json({ error: 'Upload failed' });
      return;
    }
  },
  // Route-scoped, TERMINAL error mapper: it always writes the response itself
  // and never forwards to the global handler, because the errorHandler has 3
  // params and therefore is not an error handler (PLAN §5.8 / §5.8.1).
  (err: any, req: Request, res: Response, _next: NextFunction): void => {
    try {
      sweepUploaded(req);

      const storageErrors = err && (err as { storageErrors?: unknown[] }).storageErrors;
      if (storageErrors && storageErrors.length > 0) {
        logger.error('[ingest] multer storage cleanup failures', { storageErrors });
      }
      logger.error('[ingest] upload rejected by multipart layer', {
        code: err && err.code,
        message: err && err.message,
        stack: err && err.stack,
      });

      // Rows 1-4 and 7: multer's own limit/parse codes.
      if (err instanceof multer.MulterError) {
        switch (err.code) {
          case 'LIMIT_FILE_SIZE':
            res.status(413).json({ error: 'File too large (max 25MB)' });
            return;
          case 'LIMIT_FILE_COUNT':
            res.status(400).json({ error: 'Too many files (max 10)' });
            return;
          case 'LIMIT_UNEXPECTED_FILE':
            res
              .status(400)
              .json({ error: `Unexpected field "${err.field}"; upload files under "files"` });
            return;
          case 'LIMIT_FIELD_KEY':
          case 'LIMIT_FIELD_VALUE':
          case 'LIMIT_FIELD_COUNT':
          case 'LIMIT_PART_COUNT':
            res.status(400).json({ error: 'Malformed form data' });
            return;
          default:
            // Row 7: any other MulterError is still client-caused.
            res.status(400).json({ error: 'Malformed form data' });
            return;
        }
      }

      // Row 5: our fileFilter rejection.
      if (err && err.code === 'UNSUPPORTED_FILE_TYPE') {
        const rawExt = typeof err.ext === 'string' ? err.ext : '';
        const ext = rawExt ? (rawExt.startsWith('.') ? rawExt : `.${rawExt}`) : '.';
        res.status(400).json({ error: `Unsupported file type: ${ext}` });
        return;
      }

      // Row 6: busboy's own plain Errors are not MulterError.
      const message = String((err && err.message) || '');
      if (
        /^(Multipart:|Unexpected end of form|Malformed part header)/i.test(message) ||
        (err && err.code === 'ERR_STREAM_PREMATURE_CLOSE')
      ) {
        res.status(400).json({ error: 'Malformed multipart request' });
        return;
      }

      // Row 8: anything else, emitted by the mapper itself.
      res.status(500).json({ error: 'Upload failed' });
      return;
    } catch {
      // Never let a throw escape to Express's HTML error page.
      if (!res.headersSent) {
        try {
          res.status(500).json({ error: 'Upload failed' });
        } catch {
          /* nothing left to do */
        }
      }
    }
  },
);

// ---- Folder sync ---------------------------------------------------------

router.post('/watch', async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid bearer token' });
      return;
    }

    const body = req.body as {
      path: string;
      name?: string;
      kind?: string;
      access_policy?: string;
      metadata?: Record<string, unknown>;
    };

    if (!body.path) {
      res.status(400).json({ error: 'Missing `path` in watch payload' });
      return;
    }

    const fileInfo = {
      name: body.name || path.basename(body.path),
      path: body.path,
      sizeBytes: fs.statSync(body.path).size,
      kind: detectKind(body.name || body.path),
      accessPolicy: (body.access_policy as AccessPolicy) || 'restricted',
      metadata: body.metadata || {},
    };

    const result = await ingestionService.ingestFile(fileInfo);
    res.json(result);
  } catch (err: any) {
    logger.error('[ingest] watch error', { err });
    res.status(400).json({ error: err.message || 'Watch failed' });
  }
});

export { router as ingestRouter };

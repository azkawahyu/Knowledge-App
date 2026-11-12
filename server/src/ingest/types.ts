// Ingestion pipeline types.
//
// Content-addressed, access-policy-aware document ingestion for the
// local-first knowledge assistant.

export type AccessPolicy = 'public' | 'trusted' | 'restricted';

export type DocKind =
  | 'txt'
  | 'md'
  | 'csv'
  | 'json'
  | 'html'
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'xlsx'
  | 'yaml'
  | 'yml'
  | 'xml'
  | 'log'
  | 'other';

export interface Parser {
  extensions: readonly string[];
  parse(filePath: string): Promise<ParseResult>;
}

export type ParseResult = {
  text: string;
  language: string;
  metadata: Record<string, unknown>;
};

export interface FileInfo {
  /** Optional client-provided name (used only if storage is empty). */
  name: string;
  /** Full path on disk of the file to ingest. */
  path: string;
  /** Size in bytes. */
  sizeBytes: number;
  /** Kind of document. */
  kind: DocKind;
  /** Access policy for the document. */
  accessPolicy: AccessPolicy;
  /**
   * Optional user-supplied metadata (JSON-serialisable). Merged into the
   * document `metadata` column on ingest.
   */
  metadata?: Record<string, unknown>;
}

export interface ParsedDoc {
  /** Raw text extracted from the file. */
  text: string;
  /** Original filename (for default document name). */
  filename: string;
  /** Detected language (2-letter ISO code) or 'unknown'. */
  language: string;
  /** Additional metadata. */
  metadata: Record<string, unknown>;
}

export interface Chunk {
  id: string;
  text: string;
  page_no: number | null;
  start_char: number | null;
  end_char: number | null;
}

export interface IngestionResult {
  /** Stable content-addressed identifier for the stored document. */
  documentId: string;
  /** SHA-256 of the file bytes (used for dedupe / content address). */
  contentHash: string;
  /** Human-readable document name. */
  name: string;
  /** Kind of document. */
  kind: DocKind;
  /** Access policy assigned to the document. */
  accessPolicy: AccessPolicy;
  /** Number of chunks created. */
  chunkCount: number;
  /** Chunk IDs. */
  chunkIds: string[];
  /** Parsed text length (characters). */
  textLength: number;
  /** SAM (saved at) timestamp. */
  savedAt: Date;
}

export interface IngestionError {
  message: string;
  code: string;
  /** Underlying cause if available. */
  cause?: unknown;
}

export interface IngestSettings {
  /**
   * Directory where raw files are stored (content-addressed).
   * Default: <server-root>/data/uploads
   */
  storageDir: string;
  /**
   * Directory where extracted text is stored (for audit).
   * Default: <server-root>/data/extracts
   */
  extractDir: string;
  /**
   * FTS language used for full-text search.
   * Default: 'english'.
   */
  ftsLanguage: string;
}

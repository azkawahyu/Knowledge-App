// Ingestion pipeline: content-addressed ingest + chunked retrieval units.
export { parseFile, detectKind } from './parsers';
export { createIngestionService, ingestionService } from './service';
export { sha256, sha256Hex } from './hash';
export { chunkDocument, createChunker } from './chunker';
export type {
  ParseResult,
  FileInfo,
  IngestionResult,
  IngestionError,
  Chunk,
  AccessPolicy,
  IngestSettings,
} from './types';

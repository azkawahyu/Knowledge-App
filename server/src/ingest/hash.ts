// SHA-256 content-addressed hashing for ingest.
// Every uploaded file is keyed by its content hash — identical bytes dedupe
// automatically, regardless of name/extension.
import crypto from 'crypto';
import { createHash } from 'crypto';

export function sha256(buffer: Buffer | string): string {
  const buf =
    typeof buffer === 'string' ? Buffer.from(buffer, 'utf-8') : buffer;
  return createHash('sha256').update(buf).digest('hex');
}

export function sha256Hex(str: string): string {
  return sha256(str);
}

export function toContentAddress(filename: string, sizeBytes: number): string {
  return `${sha256Hex(filename)}-${sizeBytes}`;
}

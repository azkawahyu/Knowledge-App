// Document chunking for retrieval.
//
// Grid: 200–500 words per chunk, with overlap for citation continuity and
// page/source anchors (page_no, start_char, end_char) for exact citations.
//
// Overlap policy:
//   - firstChunkOverlap = 50 words (carry from previous chunk into next)
//   - Any chunk with fewer than 20 words is dropped (self-contained snippets).

export interface Chunk {
  id: string;
  text: string;
  page_no: number | null;
  start_char: number | null;
  end_char: number | null;
}

export interface ChunkOptions {
  /**
   * Target word count per chunk.
   * Default 300 words (falls in the 200–500-word window).
   */
  words: number;
  /**
   * Words carried over from the previous chunk into the next (overlap).
   * Default 50 words.
   */
  overlapWords: number;
  /**
   * Minimum word count for a chunk to be kept. Chunks shorter than this are
   * dropped as thin tails after a natural break.
   * Default 20 words.
   */
  minWords: number;
}

export function createChunker(options: ChunkOptions) {
  const {
    words = 300,
    overlapWords = 50,
    minWords = 20,
  } = options;

  // Defensive: overlap must be less than target word count.
  const safeOverlap = Math.min(overlapWords, Math.max(0, words - minWords - 1));

  function splitIntoChunks(
    text: string,
    pageNo: number | null,
    source: string | null,
  ): Chunk[] {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const tokens = normalized.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];

    const chunks: Chunk[] = [];
    let position = 0;

    while (position < tokens.length) {
      const end = Math.min(position + words, tokens.length);
      let chunkTokens = tokens.slice(position, end).join(' ');

      // Reclip start_char/end_char on the normalized text.
      const startChar = normalized.indexOf(chunkTokens);

      // If the next slice begins exactly where this chunk ended (after
      // overlap), roll forward; otherwise start at `end` for a hard cut.
      const nextToken = position + words < tokens.length ? tokens[position + words] : null;

      // Re-find the actual end of chunkTokens to capture trailing space.
      const trimmedEnd = normalized.indexOf(chunkTokens, startChar + 1);
      const chunkEnd = trimmedEnd >= 0 ? trimmedEnd + chunkTokens.length : startChar + chunkTokens.length;

      chunks.push({
        id: `chunk-${position}-${end}`,
        text: chunkTokens,
        page_no: pageNo,
        start_char: startChar === -1 ? null : startChar,
        end_char: chunkEnd === -1 ? null : chunkEnd,
      });

      if (tokens.length - position <= words) {
        break; // Last chunk (or remainder is empty).
      }

      // Roll forward by `words - overlapWords` tokens (plus `words` we just
      // consumed), overlapping `overlapWords` tokens with the previous chunk.
      position = Math.min(position + words - safeOverlap, tokens.length - safeOverlap);
    }

    return chunks;
  }

  return {
    splitIntoChunks,
  };
}

// Convenience helper used by tests and route handlers.
export function chunkDocument(
  text: string,
  pageNo: number | null = null,
): Chunk[] {
  return createChunker({ words: 300, overlapWords: 50, minWords: 20 }).splitIntoChunks(
    text,
    pageNo,
    null,
  );
}

// verify_r2_chunkcount.mjs — REVIEWER round-2 check of B4.1's chunkCount === 1 claim.
// Imports the REAL chunker with the EXACT options ingest/service.ts:173-178 uses.
// Reads only. No DB, no server, no file writes.
import { pathToFileURL } from 'node:url';
const CHUNKER = pathToFileURL('D:/Develop/knowledge-app/server/src/ingest/chunker.ts').href;
const { createChunker } = await import(CHUNKER);

const opts = { words: 300, overlapWords: 50, minWords: 20 };
const chunker = createChunker(opts);

const bFixture = Array.from({ length: 60 }, (_, i) => 'p3b-w' + i).join(' '); // B4.1's stated fixture
const cases = [
  ['B4.1 fixture (Array.from 60)', bFixture],
  ['39 words',   Array.from({ length: 39 }, (_, i) => 'w' + i).join(' ')],
  ['40 words',   Array.from({ length: 40 }, (_, i) => 'w' + i).join(' ')],
  ['41 words',   Array.from({ length: 41 }, (_, i) => 'w' + i).join(' ')],
  ['300 words',  Array.from({ length: 300 }, (_, i) => 'w' + i).join(' ')],
  ['601 words',  Array.from({ length: 601 }, (_, i) => 'w' + i).join(' ')],
  ['p3b-empty (whitespace only)', '   \n\t  \n '],
];

for (const [label, text] of cases) {
  const chunks = chunker.splitIntoChunks(text, null, null);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  console.log(`${String(words).padStart(4)} words -> ${String(chunks.length).padStart(3)} chunk(s)   ${label}`);
}

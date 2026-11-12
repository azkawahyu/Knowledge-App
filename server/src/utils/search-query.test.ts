import { buildBroadSearchQuery } from './search-query';

function assertEqual(name: string, actual: string, expected: string): void {
  if (actual !== expected) {
    console.error(`FAIL ${name}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS ${name}`);
}

assertEqual(
  'Indonesian filler words are omitted while audio terms remain',
  buildBroadSearchQuery('jadi untuk audio adakah aturan tertentu?'),
  '"audio" OR "aturan" OR "tertentu"',
);
assertEqual('empty and stopword-only queries stay empty', buildBroadSearchQuery('yang dan untuk'), '');
assertEqual('repeated terms are deduplicated', buildBroadSearchQuery('audio audio aturan'), '"audio" OR "aturan"');

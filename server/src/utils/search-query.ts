const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'how', 'in', 'is',
  'it', 'of', 'on', 'or', 'the', 'to', 'was', 'what', 'when', 'where', 'which', 'who', 'why',
  'ada', 'adakah', 'agar', 'akan', 'aku', 'anda', 'apa', 'apakah', 'atau', 'bagaimana', 'bagi',
  'bahwa', 'belum', 'bisa', 'dalam', 'dan', 'dari', 'dengan', 'di', 'dia', 'dimana', 'dengan',
  'hal', 'ia', 'ini', 'itu', 'jadi', 'jika', 'juga', 'kami', 'kamu', 'karena', 'ke', 'kepada',
  'ketika', 'kita', 'kok', 'mana', 'masih', 'maupun', 'menjadi', 'mengapa', 'oleh', 'pada',
  'saat', 'saya', 'sebagai', 'secara', 'seperti', 'sudah', 'supaya', 'tahu', 'tak', 'tentang',
  'tersebut', 'tidak', 'untuk', 'ya', 'yang',
]);

/** Make a conservative OR query for fallback retrieval, excluding common filler words. */
export function buildBroadSearchQuery(input: string): string {
  const tokens = input.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms = [...new Set(tokens.filter((token) => !STOP_WORDS.has(token)))].slice(0, 12);
  return terms.map((token) => `"${token.replace(/"/g, '""')}"`).join(' OR ');
}

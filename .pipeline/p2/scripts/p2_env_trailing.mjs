// Diagnose the exact trailing characters of the DATABASE_URL value in server/.env
// (plan §A3.4's `&options=...` append produced db name "knowledge_app&options=...").
import fs from 'node:fs';

const line = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
const raw = line.slice('DATABASE_URL='.length);
const nonSpace = raw.replace(/\S/g, '');
console.log('value length          :', raw.length);
console.log('trailing non-space run:', JSON.stringify(nonSpace));
console.log('trailing char codes   :', JSON.stringify([...raw.slice(-3)].map((c) => c.charCodeAt(0))));
console.log('trimmed matches url   :', raw.trim() === raw ? 'value is already trimmed' : 'value had leading/trailing whitespace');
const u = new URL(raw.trim());
console.log('trimmed pathname(db)  :', u.pathname);
console.log('trimmed query keys    :', JSON.stringify([...u.searchParams.keys()]));

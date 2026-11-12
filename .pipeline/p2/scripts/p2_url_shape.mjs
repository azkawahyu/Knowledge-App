// Prints the *structure* of DATABASE_URL with all secrets redacted, to decide how to
// append libpq `options=-c search_path=p2test` correctly (plan §A3.4 assumes no existing
// query string; if one exists the plan's `&options=...` form swallows the query into the
// database name).
import fs from 'node:fs';

const line = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
if (!line) { console.error('no DATABASE_URL'); process.exit(1); }
const raw = line.slice('DATABASE_URL='.length);
const u = new URL(raw);
console.log('scheme        :', u.protocol);
console.log('host:port     :', u.hostname + ':' + (u.port || '(default)'));
console.log('pathname(db)  :', u.pathname);
console.log('username set  :', u.username ? 'yes(len=' + u.username.length + ')' : 'no');
console.log('password set  :', u.password ? 'yes(len=' + u.password.length + ')' : 'no');
console.log('query keys    :', JSON.stringify([...u.searchParams.keys()]));
console.log('query present :', raw.includes('?'));
console.log('has & already :', raw.includes('&'));

// jget-file.cjs — tiny jq replacement (no external deps).
// Usage: node jget-file.cjs <jsonFile|-> <dotted.path>
//   numeric segments index arrays; prints raw text for strings/numbers/booleans,
//   JSON for objects/arrays, <MISSING> for absent paths, <PARSE_ERROR:..> otherwise.
const fs = require('fs');
const file = process.argv[2];
const spec = process.argv[3] || '';
const raw = !file || file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  process.stdout.write('<PARSE_ERROR:' + e.message + '>');
  process.exit(0);
}
let cur = data;
for (const seg of String(spec).split('.')) {
  if (seg === '') continue;
  if (cur == null) { cur = '<MISSING>'; break; }
  if (Array.isArray(cur) && /^\d+$/.test(seg)) { cur = cur[Number(seg)]; continue; }
  if (typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, seg)) { cur = cur[seg]; continue; }
  cur = '<MISSING>';
  break;
}
if (typeof cur === 'string') process.stdout.write(cur);
else if (cur === undefined) process.stdout.write('<MISSING>');
else process.stdout.write(JSON.stringify(cur));
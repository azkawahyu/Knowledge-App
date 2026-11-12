// helper: jget <jsonpath-ish>  — small jq replacement for Windows bash.
// Usage:
//   node .pipeline/phase1/jget.mjs '<json string>' 'results.0.documentId'
//   echo '<json>' | node .pipeline/phase1/jget.mjs - 'results.0.documentId'
// Path syntax: dot-separated; numeric segments index arrays; prints JSON for
// objects/arrays, raw text for primitives, '<MISSING>' for absent paths.
const args = process.argv.slice(2);
const src = args[0];
const getPathAttr = args[1];

let raw;
if (src === '-') {
  raw = require('fs').readFileSync(0, 'utf8');
} else {
  raw = src;
}
function readStdinSync() {
  const fs = require('fs');
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

let data;
try { data = JSON.parse(raw); } catch (e) {
  process.stdout.write('<PARSE_ERROR:' + e.message + '>');
  process.exit(0);
}
let cur = data;
for (const seg of String(getPathAttr).split('.')) {
  if (seg === '') continue;
  if (cur == null) { cur = '<MISSING>'; break; }
  if (Array.isArray(cur) && /^\d+$/.test(seg)) { cur = cur[Number(seg)]; continue; }
  if (typeof cur === 'object' && seg in cur) { cur = cur[seg]; continue; }
  cur = '<MISSING>';
  break;
}
if (typeof cur === 'string') process.stdout.write(cur);
else if (cur === undefined) process.stdout.write('<MISSING>');
else process.stdout.write(JSON.stringify(cur));

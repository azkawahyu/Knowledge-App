// check.cjs — assertions for Phase 1 upload test bodies (no external deps).
// Usage: node check.cjs <mode> <bodyFile> [extra args]
const fs = require('fs');
const [mode, bodyFile, ...rest] = process.argv.slice(2);
const s = fs.readFileSync(bodyFile, 'utf8');
let fail = null;
const A = (cond, msg) => { if (!cond && !fail) fail = msg; };

function parse() {
  try { return JSON.parse(s); } catch (e) { return undefined; }
}
if (!s || s.trim() === '') {
  console.log('  FAIL[' + mode + ']: EMPTY BODY');
  process.exit(1);
}
const hasHtml = /<html/i.test(s);
const hasStack = /at [^\n]*:\d+:\d+/.test(s);

switch (mode) {
  case 'err': {
    const o = parse();
    A(o !== undefined, 'not JSON');
    A(o && typeof o.error === 'string' && o.error.trim() !== '', 'no non-empty string .error');
    A(!hasHtml, 'contains <html');
    A(!hasStack, 'contains a Node stack frame');
    if (!fail) console.log('  body OK (JSON, non-empty string .error, no <html>, no stack frame)');
    break;
  }
  case 'single': {
    const o = parse() || {};
    const r = Array.isArray(o.results) ? o.results[0] : null;
    const need = ['documentId', 'contentHash', 'chunkCount', 'chunkIds', 'name', 'kind', 'accessPolicy', 'textLength', 'savedAt'];
    const miss = need.filter((k) => !r || !(k in r));
    A(Array.isArray(o.results) && o.results.length === 1, 'results.length != 1 (' + (o.results && o.results.length) + ')');
    A(Array.isArray(o.errors) && o.errors.length === 0, 'errors not empty array');
    A(miss.length === 0, 'missing result fields: ' + miss.join(','));
    A(r && r.chunkCount >= 1, 'chunkCount < 1 (' + (r && r.chunkCount) + ')');
    A(r && r.kind === 'txt', 'kind != txt (' + (r && r.kind) + ')');
    if (!fail) console.log('  envelope OK (results.length=1, errors.length=0, all 9 result fields, chunkCount=' + r.chunkCount + ', kind=' + r.kind + ')');
    break;
  }
  case 'nolist': {
    const o = parse() || {};
    A(!('results' in o) && !('errors' in o), 'body still carries results/errors keys');
    A(typeof o.error === 'string' && o.error.trim() !== '', 'no string .error');
    A(!hasHtml, 'contains <html');
    if (!fail) console.log('  body shape OK ({error} only, no partial envelope)');
    break;
  }
  case 'mixed': {
    const [wantR, wantE, wantFile] = rest;
    const o = parse() || {};
    A(Array.isArray(o.results) && String(o.results.length) === String(wantR), 'results.length want=' + wantR + ' got=' + (o.results && o.results.length));
    A(Array.isArray(o.errors) && String(o.errors.length) === String(wantE), 'errors.length want=' + wantE + ' got=' + (o.errors && o.errors.length));
    if (wantFile) A(o.errors && o.errors[0] && o.errors[0].file === wantFile, 'errors[0].file want=' + wantFile + ' got=' + (o.errors && o.errors[0] && o.errors[0].file));
    if (wantFile) A(o.errors && o.errors[0] && typeof o.errors[0].error === 'string' && o.errors[0].error.trim() !== '', 'errors[0].error not a non-empty string');
    if (!fail) console.log('  mixed envelope OK (results=' + wantR + ', errors=' + wantE + (wantFile ? ', errors[0].file=' + wantFile : '') + ')');
    break;
  }
  case 'nohtml': {
    A(!hasHtml, 'body contains <html');
    const o = parse();
    if (!fail) console.log('  body is JSON (not HTML): ' + JSON.stringify(o).slice(0, 160));
    break;
  }
  case 'contains': {
    const needle = rest[0];
    A(s.includes(needle), 'body does not contain "' + needle + '" — body=' + s.slice(0, 240));
    if (!fail) console.log('  message contains "' + needle + '" OK');
    break;
  }
  case 'status401': {
    const o = parse();
    A(o !== undefined, 'not JSON');
    A(o && typeof o.error === 'string' && o.error.trim() !== '', 'no string .error');
    A(!hasHtml, 'contains <html');
    if (!fail) console.log('  body OK: ' + JSON.stringify(o));
    break;
  }
  default:
    console.log('  unknown mode ' + mode);
    process.exit(2);
}
if (fail) {
  console.log('  FAIL[' + mode + ']: ' + fail);
  console.log('  body was: ' + s.slice(0, 400).replace(/\s+/g, ' '));
  process.exit(1);
}
process.exit(0);
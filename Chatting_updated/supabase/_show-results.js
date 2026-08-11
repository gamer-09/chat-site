/* Prints a summary of a full-audit JSON output. Usage: node _show-results.js <path> */
const fs = require('fs');
const p = process.argv[2];
if (!p) { console.error('usage: node _show-results.js <audit.json>'); process.exit(1); }
const r = JSON.parse(fs.readFileSync(p, 'utf8'));
const fails = (r.results || []).filter(x => !x.ok);
console.log('TOTAL:', (r.results || []).length, '| PASS:', (r.results || []).length - fails.length, '| FAIL:', fails.length);
console.log('--- FAILED ---');
fails.forEach(f => console.log('X', f.step, '|', (f.note || '').slice(0, 140)));
console.log('--- CONSOLE ERRORS (' + (r.consoleErrors || []).length + ') ---');
(r.consoleErrors || []).forEach(e => console.log(e));

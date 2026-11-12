// Generates a bcrypt hash of the demo admin password using the app's own library
// (server/src/utils/hash.ts uses bcryptjs cost 10). Writes it to argv[2] only.
// The password is the demo pair already printed in the product UI; it is NOT printed here.
import bcrypt from 'bcryptjs';
import fs from 'node:fs';

const out = process.argv[2];
if (!out) { console.error('usage: node p2_gen_admin_hash.mjs <outfile>'); process.exit(1); }
const hash = bcrypt.hashSync('admin123', 10);
if (!bcrypt.compareSync('admin123', hash)) { console.error('self-check failed'); process.exit(1); }
fs.writeFileSync(out, hash);
console.log('bcrypt hash written, length=' + hash.length + ' selfcheck=ok');

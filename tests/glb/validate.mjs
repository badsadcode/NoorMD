// Validates every .glb in the folder given on the command line with the Khronos glTF validator.
// Fails on any error or warning; infos (such as unused objects) are listed but allowed.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import validator from 'gltf-validator';

const dir = process.argv[2];
const files = readdirSync(dir).filter(f => f.endsWith('.glb'));
if (files.length === 0) { console.error(`No .glb files in ${dir}`); process.exit(1); }
let failed = 0;
for (const f of files) {
  const report = await validator.validateBytes(new Uint8Array(readFileSync(join(dir, f))), { uri: f, maxIssues: 50 });
  const { numErrors, numWarnings, numInfos, messages } = report.issues;
  console.log(`${f}: ${numErrors} errors, ${numWarnings} warnings, ${numInfos} infos`);
  for (const m of messages) console.log(`  [${['error', 'warning', 'info', 'hint'][m.severity]}] ${m.code} ${m.pointer ?? ''} ${m.message}`);
  if (numErrors + numWarnings > 0) failed++;
}
process.exit(failed ? 1 : 0);

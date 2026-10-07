// Print determinism check — builds the same piece twice into two temporary
// output roots and compares the generated layout HTML (byte-exact) and the PNG
// previews (pixel byte-exact). PDFs embed creation timestamps, so their bytes
// are not compared; page boxes are verified separately by verify-print.mjs.
//
//   node scripts/print/verify-determinism.mjs [--piece business-card] [--variant neighbor]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { piece: 'business-card', variant: 'neighbor' };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--piece') options.piece = args[++index];
    if (args[index] === '--variant') options.variant = args[++index];
  }
  return options;
}

const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function build(outRoot, options) {
  const result = spawnSync(
    process.execPath,
    ['scripts/print/print-system.mjs', '--variant', options.variant, '--piece', options.piece, '--no-boards', '--out', outRoot],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(`build failed: ${result.stderr || result.stdout}`);
}

function collect(root, options) {
  const files = [];
  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  for (const sub of ['Sources', 'PNG-Previews']) walk(path.join(root, sub));
  return files
    .filter((file) => file.endsWith('.html') || file.endsWith('.png'))
    .map((file) => path.relative(root, file))
    .sort();
}

const options = parseArgs();
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sparkling-print-det-'));
const first = path.join(base, 'run-1');
const second = path.join(base, 'run-2');
build(first, options);
build(second, options);

const files = collect(first, options);
const failures = [];
for (const relative of files) {
  const a = hash(path.join(first, relative));
  const b = hash(path.join(second, relative));
  if (a !== b) failures.push(relative);
}

fs.rmSync(base, { recursive: true, force: true });
console.log(
  JSON.stringify(
    { variant: options.variant, piece: options.piece, comparedFiles: files.length, mismatches: failures, ok: failures.length === 0 },
    null,
    1,
  ),
);
process.exit(failures.length ? 1 : 0);

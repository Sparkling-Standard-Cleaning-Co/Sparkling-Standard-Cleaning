// Repository source-integrity gate.
//
// Protects against the observed Windows PowerShell corruption mode: files read
// with the system ANSI code page and rewritten as UTF-8 (producing U+FFFD and
// mojibake), accidental BOMs in the middle of a file, control characters,
// conflict markers and malformed JSON. Runs before every production build.
import fs from 'node:fs';
import path from 'node:path';

const runtimeRoots = ['src', 'functions', 'migrations', 'scripts', 'workers', '.github'];
const testRoots = ['tests'];
const rootFiles = [
  'package.json',
  'tsconfig.json',
  'astro.config.mjs',
  'wrangler.local.toml',
  'wrangler.toml.example',
];
const codeExtensions = new Set(['.ts', '.tsx', '.astro', '.mjs', '.js', '.css', '.json', '.yml', '.yaml', '.sql']);
const mojibakeMarkers = ['\uFFFD', '\u00e2\u20ac', '\u00c3', '\u00c2'];
const conflictPattern = /^(<<<<<<<|=======|>>>>>>>)(?:\s|$)/m;

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', '.wrangler', 'backup-out', 'gift-out', 'invoice-out', 'legal-out', 'canvass-out', 'indexnow-out'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, files);
    else if (codeExtensions.has(path.extname(entry.name).toLowerCase())) files.push(file);
  }
  return files;
}

const runtimeFiles = runtimeRoots.flatMap((root) => walk(root));
const testFiles = testRoots.flatMap((root) => walk(root));
const allFiles = [...runtimeFiles, ...testFiles, ...rootFiles.filter((file) => fs.existsSync(file))];
const runtimeSet = new Set(runtimeFiles.map((file) => path.resolve(file)));
const offenders = [];

for (const file of allFiles) {
  const bytes = fs.readFileSync(file);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    offenders.push(`${file}: invalid UTF-8 bytes`);
    continue;
  }
  if (text.indexOf('\uFEFF', 1) >= 0) offenders.push(`${file}: unexpected BOM inside the file`);
  if (conflictPattern.test(text)) offenders.push(`${file}: contains Git conflict markers`);
  const controls = [...text].filter((char) => {
    const code = char.codePointAt(0);
    return code !== undefined && code < 0x20 && char !== '\n' && char !== '\r' && char !== '\t';
  });
  if (controls.length > 0) offenders.push(`${file}: contains ${controls.length} unexpected control character(s)`);
  if (runtimeSet.has(path.resolve(file))) {
    if (text.includes('\uFFFD')) offenders.push(`${file}: contains U+FFFD replacement characters (encoding corruption)`);
    if (mojibakeMarkers.slice(1).some((marker) => text.includes(marker))) {
      offenders.push(`${file}: contains mojibake markers`);
    }
  }
  if (file.endsWith('.json')) {
    try {
      JSON.parse(text);
    } catch {
      offenders.push(`${file}: invalid JSON`);
    }
  }
}

if (offenders.length > 0) {
  console.error('Source integrity check failed:');
  for (const offender of offenders) console.error(`- ${offender}`);
  process.exit(1);
}
console.log('Source integrity check passed.');

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function walk(directory: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.git', 'dist', '.wrangler'].includes(entry.name)) walk(file, files);
    } else if (/\.(ts|tsx|astro|mjs|js|css)$/.test(entry.name)) {
      files.push(file);
    }
  }
  return files;
}

test('application source does not contain mojibake text sequences', () => {
  const offenders: string[] = [];
  for (const file of [...walk('src'), ...walk('functions')]) {
    const text = fs.readFileSync(file, 'utf8');
    const count = ['Ã', 'â€', '\uFFFD', 'Â'].reduce((total, marker) => total + text.split(marker).length - 1, 0);
    if (count > 0) offenders.push(`${file}: ${count}`);
  }
  assert.deepEqual(offenders, [], `Mojibake text found in application source:\n${offenders.join('\n')}`);
});

test('owner-facing admin source keeps corrected punctuation and symbols', () => {
  const admin = fs.readFileSync('src/scripts/admin.ts', 'utf8');
  assert.match(admin, /each branch’s local time/);
  assert.match(admin, /Loading benefit preview…/);
  assert.match(admin, /· Recurring/);
  assert.doesNotMatch(admin, /Ã|â€|\uFFFD|Â/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENT_VARIABLE_KEYS,
  resolveDocumentVariables,
} from '../src/lib/documents/service.ts';

test('dynamic legal document variables resolve only verified values and fail closed when missing', () => {
  const values: Record<string, string> = {};
  for (const key of DOCUMENT_VARIABLE_KEYS) values[key] = `value:${key}`;
  const source = DOCUMENT_VARIABLE_KEYS.map((key) => `{{${key}}}`).join(' | ');
  const resolved = resolveDocumentVariables(source, values);
  assert.equal(resolved.missing.length, 0);
  assert.equal(resolved.text.includes('{{'), false);

  const partial = resolveDocumentVariables('{{customer.legal_name}} {{price.summary}}', {
    'customer.legal_name': 'Synthetic Customer LLC',
  });
  assert.equal(partial.missing[0], 'price.summary');
  assert.match(partial.text, /\{\{\s*price\.summary\s*\}\}/);
});

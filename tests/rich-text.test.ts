import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  findInternalContentProblems,
  parseDocumentBlocks,
  prepareTemplateRevisionContent,
  renderDocumentHtml,
  serializeDocumentBlocks,
  stripInternalDraftNotices,
  unresolvedDocumentVariables,
} from '../src/lib/documents/rich-text.ts';

const legacy = `SPARKLING STANDARD CLEANING CO.
Residential Deep Cleaning Agreement
Standards That Sparkle.
Document LEG-4A9FC934  |  Version 2026-11-22.remediation.v1
OWNER REVIEW DRAFT — NOT EFFECTIVE UNTIL APPROVED

1. Parties and Incorporation
1.1 This Agreement is between Sparkling Standard LLC and {{customer.legal_name}}.
1.2 The Customer agrees to the approved scope.

2. Insurance
2.1 Sparkling Standard maintains commercial general liability insurance.`;

test('internal draft notices are detected and removed without touching clauses', () => {
  assert.deepEqual(findInternalContentProblems(legacy), [
    'owner review draft',
    'not effective until approved',
  ]);
  const stripped = stripInternalDraftNotices(legacy);
  assert.equal(stripped.removed.length, 1);
  assert.doesNotMatch(stripped.content, /OWNER REVIEW DRAFT|NOT EFFECTIVE/i);
  assert.match(stripped.content, /1\.1 This Agreement is between Sparkling Standard LLC/);
  assert.match(stripped.content, /2\.1 Sparkling Standard maintains commercial general liability insurance/);
});

test('a clean customer-facing revision removes the internal status line and updates version metadata', () => {
  const prepared = prepareTemplateRevisionContent(legacy, '2026-11-23.customer-release.v1');
  assert.doesNotMatch(prepared.content, /OWNER REVIEW DRAFT|not effective until approved|Document LEG-/i);
  assert.match(prepared.content, /Version 2026-11-23\.customer-release\.v1/);
  assert.match(prepared.content, /^# SPARKLING STANDARD CLEANING CO\./m);
  assert.match(prepared.content, /^## Residential Deep Cleaning Agreement/m);
  assert.match(prepared.content, /^## 1\. Parties and Incorporation/m);
  assert.match(prepared.content, /^## 2\. Insurance/m);
  assert.match(prepared.content, /1\.1 This Agreement is between Sparkling Standard LLC and \{\{customer\.legal_name\}\}/);
  assert.deepEqual(findInternalContentProblems(prepared.content), []);
});

test('customer-facing rendering hides Markdown markers and exposes headings, paragraphs and bullets', () => {
  const html = renderDocumentHtml(`# Title\n\n## Section\n\nA paragraph with **bold** text.\n\n- First\n- Second`);
  assert.match(html, /<h1 class="doc-title">Title<\/h1>/);
  assert.match(html, /<h2 class="doc-heading">Section<\/h2>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<ul><li>First<\/li><li>Second<\/li><\/ul>/);
  assert.doesNotMatch(html, /# Title|## Section|\*\*bold\*\*/);
});

test('legacy plain text parses into title, heading, metadata and paragraphs', () => {
  const blocks = parseDocumentBlocks(legacy);
  assert.equal(blocks[0]?.type, 'title');
  assert.equal(blocks[1]?.type, 'heading');
  assert.equal(blocks[3]?.type, 'metadata');
  assert.ok(blocks.some((block) => block.type === 'heading' && block.text === '1. Parties and Incorporation'));
  assert.ok(blocks.some((block) => block.type === 'paragraph' && block.text.startsWith('1.1 ')));
  const serialized = serializeDocumentBlocks(blocks);
  assert.match(serialized, /^# SPARKLING STANDARD CLEANING CO\./);
  assert.match(serialized, /^## 1\. Parties and Incorporation/m);
});

test('unresolved variables are reported separately from template review notices', () => {
  assert.deepEqual(unresolvedDocumentVariables('Hello {{customer.legal_name}} {{property.address}}'), [
    'customer.legal_name',
    'property.address',
  ]);
  assert.deepEqual(findInternalContentProblems('The customer may request a draft copy.'), []);
});

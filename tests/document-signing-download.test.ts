// Signing-download and E-SIGN disclosure guard.
// Verifies the executed copy is a combined request artifact, individual
// documents remain available before completion, and the signing page carries
// the paper-copy/withdrawal/hardware disclosures required by the addendum.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  executedCopyKey,
  resolveSigningDownload,
  safePdfFilename,
} from '../src/lib/documents/signing-download.ts';
import { createSigningRequest, normalizedService } from '../src/lib/documents/service.ts';
import { agreementScopeFor } from '../src/lib/documents/agreement-variables.ts';
import { legalPolicyConfig } from '../src/config/legal-policy.ts';

const requirements = [
  { templateId: 'doc_core', title: 'Core Cleaning Service Terms', r2Key: 'documents/templates/core.pdf' },
  { templateId: 'doc_text', title: 'Text Agreement', r2Key: '' },
];

test('the executed copy is available only after every required document is signed', () => {
  const incomplete = resolveSigningDownload('executed', 'signreq_123', requirements, false);
  assert.equal('error' in incomplete, true);
  assert.equal(incomplete.error, 'signing_incomplete');

  const ready = resolveSigningDownload('executed', 'signreq_123', requirements, true);
  if ('error' in ready) throw new Error(`unexpected ${ready.error}`);
  assert.equal(ready.kind, 'executed');
  assert.equal(ready.key, executedCopyKey('signreq_123'));
  assert.match(ready.filename, /^Executed_Agreement_signreq_123\.pdf$/);

  const versioned = resolveSigningDownload('executed', 'signreq_123', requirements, true, 'documents/executed/signreq_123-abc123.pdf');
  if ('error' in versioned) throw new Error(`unexpected ${versioned.error}`);
  assert.equal(versioned.key, 'documents/executed/signreq_123-abc123.pdf');
});

test('individual PDF templates remain downloadable and text-only documents fail closed', () => {
  const pdf = resolveSigningDownload('doc_core', 'signreq_123', requirements, false);
  if ('error' in pdf) throw new Error(`unexpected ${pdf.error}`);
  assert.equal(pdf.kind, 'template');
  assert.equal(pdf.key, 'documents/templates/core.pdf');
  assert.equal(pdf.filename, 'Core_Cleaning_Service_Terms.pdf');

  const text = resolveSigningDownload('doc_text', 'signreq_123', requirements, false);
  assert.deepEqual(text, { error: 'document_not_found' });

  const unknown = resolveSigningDownload('missing', 'signreq_123', requirements, false);
  assert.deepEqual(unknown, { error: 'document_not_found' });

  const invalid = resolveSigningDownload('', 'signreq_123', requirements, false);
  assert.deepEqual(invalid, { error: 'invalid_download' });
});

test('download filenames are bounded to safe PDF names', () => {
  assert.equal(safePdfFilename('../../etc/passwd'), 'passwd.pdf');
  assert.equal(safePdfFilename('A title: with / odd characters?'), 'odd_characters.pdf');
  assert.equal(safePdfFilename('Core Cleaning Service Terms'), 'Core_Cleaning_Service_Terms.pdf');
  assert.equal(safePdfFilename(''), 'document.pdf');
});

test('the signing page presents hardware, paper-copy, withdrawal and executed-copy paths', () => {
  const script = fs.readFileSync('src/scripts/document-sign.ts', 'utf8');
  assert.match(script, /Electronic records and signatures/);
  assert.match(script, /current web browser, internet access/);
  assert.match(script, /request a paper copy/i);
  assert.match(script, /withdraw consent to future electronic records/i);
  assert.match(script, /admin@sparkling-standard\.com/);
  assert.match(script, /executedDownloadUrl/);
  assert.match(script, /Download your executed agreement/);

  const endpoint = fs.readFileSync('functions/api/document-sign.ts', 'utf8');
  assert.match(endpoint, /resolveSigningDownload/);
  assert.match(endpoint, /download=executed/);
  assert.match(endpoint, /executedDownloadUrl/);
});

test('property-management service codes resolve to the property-management packet and scope', () => {
  assert.equal(normalizedService('property-management-cleaning'), 'property_management');
  assert.equal(normalizedService('real-estate-portfolio'), 'property_management');
  assert.match(agreementScopeFor('property-management-cleaning'), /property schedule/i);
  assert.doesNotMatch(agreementScopeFor('property-management-cleaning'), /full standard cleaning scope/i);
});

test('live signing request creation fails closed when the activation flag is disabled', async () => {
  const activation = legalPolicyConfig.activation as { electronicSigning: boolean };
  const previous = activation.electronicSigning;
  activation.electronicSigning = false;
  try {
    await assert.rejects(
      () => createSigningRequest({} as never, { subjectType: 'customer', serviceCode: 'residential-deep' }),
      /electronic_signing_not_activated/,
    );
  } finally {
    activation.electronicSigning = previous;
  }
});

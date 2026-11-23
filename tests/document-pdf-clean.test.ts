import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildExecutedAgreementPdf } from '../src/lib/documents/agreement-pdf.ts';

test('the executed PDF never prints internal review notices or Markdown markers', () => {
  const pdf = buildExecutedAgreementPdf({
    requestId: 'signreq_pdf_clean',
    bundleName: 'Residential Deep Cleaning Packet',
    bundleCode: 'customer.deep',
    bundleVersion: 1,
    bookingReference: 'SS-20261201-PDF',
    serviceCode: 'residential-deep',
    customerName: 'Jordan Example',
    propertyAddress: '100 Example Street, Pensacola, FL 32502',
    executedAt: '2026-11-23T00:00:00.000Z',
    signatures: [
      {
        title: 'Residential Deep Cleaning Agreement',
        version: '2026-11-23.customer-release.v1',
        templateId: 'LEG-4A9FC934',
        contentText: [
          '# SPARKLING STANDARD CLEANING CO.',
          '## Residential Deep Cleaning Agreement',
          'OWNER REVIEW DRAFT — NOT EFFECTIVE UNTIL APPROVED',
          'Version 2026-11-23.customer-release.v1',
          '## 1. Parties and Incorporation',
          '1.1 This Agreement is between Sparkling Standard LLC and the customer.',
          '## 2. Insurance',
          '2.1 Insurance clause preserved.',
        ].join('\n\n'),
        contentSha256: 'a'.repeat(64),
        signerName: 'Jordan Example',
        signerEmail: 'jordan@example.test',
        signedAt: '2026-11-23T00:00:00.000Z',
        typedSignature: 'Jordan Example',
        status: 'signed',
        consentVersion: '2026-11-01.esign-consent.v1',
        sourceKind: 'text',
      },
    ],
  });
  const text = new TextDecoder('latin1').decode(pdf);
  assert.doesNotMatch(text, /OWNER REVIEW DRAFT|NOT EFFECTIVE UNTIL APPROVED/i);
  assert.doesNotMatch(text, /## 1\. Parties|# SPARKLING/);
  assert.match(text, /1\. Parties and Incorporation/);
  assert.match(text, /1\.1 This Agreement is between Sparkling Standard LLC/);
  assert.match(text, /2\. Insurance/);
});

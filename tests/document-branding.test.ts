import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import { DOCUMENT_BRAND, renderBrandedDocumentHtml } from '../src/lib/documents/branding.ts';
import { renderDocumentHtml } from '../src/lib/documents/rich-text.ts';
import { buildExecutedAgreementPdf } from '../src/lib/documents/agreement-pdf.ts';

const content = `<div class="doc-rich"><h2>Residential Deep Cleaning Agreement</h2><p>1.1 The Customer agrees to the approved scope.</p><table><tbody><tr><td>Item</td><td>Price</td></tr></tbody></table><p data-doc-signature="customer"><strong>X - Sign here</strong><br />Customer signature: ________________</p></div>`;

test('branded HTML uses the approved logo, letterhead, typography and footer', () => {
  const html = renderBrandedDocumentHtml(content, {
    variant: 'signing',
    headerText: 'Customer copy',
    footerText: 'Executed copy',
  });
  assert.match(html, /class="branded-document branded-document--signing"/);
  assert.match(html, new RegExp(`src="${DOCUMENT_BRAND.logoUrl}"`));
  assert.match(html, /Sparkling Standard Cleaning Co\./);
  assert.match(html, /Standards That Sparkle\./);
  assert.match(html, /Customer copy/);
  assert.match(html, /Sparkling Standard LLC/);
  assert.match(html, /Executed copy/);
  assert.match(html, /<table>/);
  assert.match(html, /data-doc-signature="customer"/);
  assert.match(html, /1\.1 The Customer agrees to the approved scope\./);
});

test('branding does not alter the approved agreement wording', () => {
  const raw = renderDocumentHtml(content);
  const branded = renderBrandedDocumentHtml(content);
  const textOf = (value: string): string =>
    value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.match(textOf(branded), new RegExp(textOf(raw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('legacy Markdown tables render as tables and technical metadata stays hidden', () => {
  const legacy = [
    '# Residential Agreement',
    '',
    '**Document ID:** SS-TEST',
    '**Version:** 1.0',
    '**Status:** Draft',
    '',
    '| Item | Detail |',
    '| --- | --- |',
    '| Service address | 100 S Baylen St |',
    '| Property type | House |',
  ].join('\n');
  const html = renderBrandedDocumentHtml(legacy);
  assert.match(html, /<table class="doc-table">/);
  assert.match(html, /<th>Item<\/th>/);
  assert.match(html, /<td>100 S Baylen St<\/td>/);
  assert.doesNotMatch(html, /\| --- \||Document ID|Version:|Status:/);
});

test('the executed PDF embeds the approved logo and branded page furniture', () => {
  const pdf = buildExecutedAgreementPdf({
    requestId: 'signreq_brand',
    bundleName: 'Residential agreement',
    bundleCode: 'customer.residential',
    bundleVersion: 1,
    bookingReference: 'SS-20261203-BRAND',
    serviceCode: 'standard',
    customerName: 'Synthetic Customer',
    propertyAddress: '100 S Baylen St, Pensacola, FL 32502',
    executedAt: '2026-12-01T12:00:00.000Z',
    signatures: [
      {
        title: 'Residential Deep Cleaning Agreement',
        version: '1.1',
        templateId: 'tmpl_brand',
        contentText: '# Residential Deep Cleaning Agreement\n\n## 1. Parties\n\n1.1 The Customer agrees to the approved scope.',
        contentSha256: 'a'.repeat(64),
        signerName: 'Synthetic Customer',
        signerEmail: 'customer@example.test',
        signedAt: '2026-12-01T12:00:00.000Z',
        typedSignature: 'Synthetic Customer',
        status: 'signed',
        consentVersion: '2026-11-01.esign-consent.v1',
      },
    ],
  });
  const raw = Buffer.from(pdf).toString('latin1');
  assert.ok(raw.startsWith('%PDF-1.4'));
  assert.match(raw, /\/Subtype \/Image/);
  assert.match(raw, /\/Width 128/);
  assert.match(raw, /\/BrandLogo Do/);
  assert.match(raw, /Sparkling Standard Cleaning Co\./);
  assert.match(raw, /Standards That Sparkle\./);
  assert.match(raw, /Page __PAGENO__|Page 1 of 1/);
  assert.match(raw, /1\.1 The Customer agrees to the approved scope\./);
  const image = raw.match(/\/Subtype \/Image[\s\S]*?\/Length (\d+) >>\nstream\n([0-9a-f]+>)\nendstream/);
  assert.ok(image, 'embedded image stream exists');
  const inflated = zlib.inflateSync(Buffer.from(image[2].slice(0, -1), 'hex'));
  assert.equal(inflated.length, (128 * 3 + 1) * 128);
});

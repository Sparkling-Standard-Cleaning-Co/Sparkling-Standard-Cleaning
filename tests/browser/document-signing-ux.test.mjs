// Customer signing UX: mobile layout, one signer identity, interactive access
// choices, per-document acknowledgment and a single adopted signature.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4559;
const BASE = `http://localhost:${PORT}`;

let server;
let browser;

before(async () => {
  server = spawn(process.execPath, ['node_modules/astro/astro.js', 'preview', '--port', String(PORT)], {
    stdio: 'ignore',
    windowsHide: true,
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(BASE + '/', { signal: AbortSignal.timeout(1500) })).ok) {
        browser = await chromium.launch();
        return;
      }
    } catch {
      // not ready yet
    }
    await delay(500);
  }
  throw new Error('preview server did not become ready');
});

after(async () => {
  await browser?.close();
  server?.kill();
});

const payload = {
  ok: true,
  request: {
    id: 'signreq_ux',
    bundleCode: 'customer.deep',
    bundleName: 'Residential Deep / One-Time Packet',
    bundleVersion: 1,
    subjectType: 'customer',
    status: 'pending',
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  },
  context: {
    customerName: 'Jordan Example',
    customerEmail: 'jordan@example.test',
    propertyAddress: '100 Example Street, Pensacola, FL 32502',
    bookingReference: 'SS-20261201-UX',
    serviceCode: 'residential-deep',
    serviceDate: '2026-12-01',
    arrivalWindow: '8:00 AM – 10:00 AM Central',
    priceSummary: '$335.00',
    paymentTerms: 'Due before service.',
  },
  customerFields: {
    definitions: [
      {
        key: 'access_method',
        label: 'How will Sparkling Standard access the home?',
        type: 'radio',
        required: true,
        summaryLabel: 'Access method',
        options: [
          { value: 'customer_present', label: 'I will be present' },
          { value: 'lockbox', label: 'Customer-controlled lockbox' },
          { value: 'temporary_code', label: 'Temporary door or alarm code' },
        ],
      },
      {
        key: 'access_instructions',
        label: 'Entry, parking, gate, building, or alarm instructions',
        type: 'textarea',
        required: false,
        summaryLabel: 'Access and parking instructions',
        maxLength: 1500,
      },
      {
        key: 'pets_present',
        label: 'Pets will be at the property',
        type: 'checkbox',
        required: false,
        summaryLabel: 'Pets',
      },
    ],
    values: {},
  },
  documents: [
    {
      templateId: 'doc_access',
      title: 'Residential Access Authorization',
      version: '2026-11-22',
      contentSha256: 'a'.repeat(64),
      contentText: 'RESIDENTIAL ACCESS AUTHORIZATION\n\nThe customer approves the access method described in the signed schedule.',
      sourceKind: 'text',
      signerParty: 'customer',
      required: true,
      stage: 'before_payment',
      signed: false,
      downloadUrl: '',
    },
    {
      templateId: 'doc_deep',
      title: 'Residential Deep Cleaning Agreement',
      version: '2026-11-22',
      contentSha256: 'b'.repeat(64),
      contentText: 'RESIDENTIAL DEEP CLEANING AGREEMENT\n\nScope and terms for the requested deep cleaning.',
      sourceKind: 'text',
      signerParty: 'customer',
      required: true,
      stage: 'before_payment',
      signed: false,
      downloadUrl: '',
    },
  ],
  signedTemplateIds: [],
  consentVersion: 'test-consent',
};

test('a customer can complete one mobile signing ceremony without repeated names', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  let submitted = null;
  await page.route('**/api/document-sign?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await page.route('**/api/document-sign', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
      return;
    }
    submitted = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, status: 'signed', signedCount: 2, requiredCount: 2 }),
    });
  });
  try {
    await page.goto(BASE + '/document-sign/?token=ux-token', { waitUntil: 'load' });
    await page.getByText('Residential Deep / One-Time Packet').first().waitFor({ state: 'visible' });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 1, `no horizontal overflow at 390px (got ${overflow})`);
    await page.getByText('100 Example Street, Pensacola, FL 32502').waitFor({ state: 'visible' });
    assert.equal(await page.locator('input[name="signerName"]').count(), 1, 'one legal-name field only');

    await page.locator('input[name="detailsAcknowledged"]').check();
    await page.locator('[data-signing-primary]').click();
    await page.getByRole('heading', { name: 'Access and service instructions' }).waitFor({ state: 'visible' });
    await page.locator('input[name="access_method"][value="customer_present"]').check();
    await page.locator('textarea[name="access_instructions"]').fill('Park in the driveway.');
    await page.locator('[data-signing-primary]').click();

    await page.getByRole('button', { name: 'Read document' }).first().click();
    await page.locator('[data-document-dialog] .signing-doc-text').getByText(/RESIDENTIAL ACCESS AUTHORIZATION/).waitFor({ state: 'visible' });
    await page.locator('[data-document-dialog-close]').click();

    await page.locator('[data-signature-slot="doc_access"]').waitFor({ state: 'visible' });
    assert.match(await page.locator('[data-signature-slot="doc_access"]').textContent(), /X — Sign here/);
    await page.locator('[data-signature-slot="doc_access"]').click();
    await page.locator('[data-signature-dialog]').waitFor({ state: 'visible' });
    await page.locator('[data-modal-adopt]').click();
    await page.locator('[data-signature-slot="doc_access"].is-signed').waitFor({ state: 'visible' });

    await page.locator('[data-signature-slot="doc_deep"]').click();
    await page.locator('[data-signature-slot="doc_deep"].is-signed').waitFor({ state: 'visible' });
    await page.locator('input[name="consent"]').check();
    await page.locator('[data-signing-primary]').click();
    await page.waitForFunction(() => Boolean(document.querySelector('[data-document-sign]')));

    assert.ok(submitted, 'the signature request was submitted');
    assert.equal(submitted.customerFields.access_method, 'customer_present');
    assert.equal(submitted.customerFields.access_instructions, 'Park in the driveway.');
    assert.equal(submitted.signerName, 'Jordan Example');
    assert.equal(submitted.signerEmail, 'jordan@example.test');
    assert.equal(submitted.signatures.doc_access.value, 'Jordan Example');
    assert.equal(submitted.signatures.doc_deep.value, 'Jordan Example');
    assert.equal(submitted.signatures.doc_access.type, 'typed');
    assert.ok(submitted.signatures.doc_access.appliedAt);
    assert.ok(submitted.signatures.doc_deep.appliedAt);
  } finally {
    await context.close();
  }
});

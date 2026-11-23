// Admin visual document editor: revision creation, Word-style formatting,
// live preview, save, approval and publish. APIs are mocked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4581;
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
      // not ready
    }
    await delay(500);
  }
  throw new Error('preview server did not become ready');
});

after(async () => {
  await browser?.close();
  server?.kill();
});

test('the owner can revise an approved document in the visual editor and publish it', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const posts = [];
  page.on('dialog', (dialog) => dialog.accept());

  await page.route('**/api/admin/auth*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        configured: true,
        setupRequired: false,
        authenticated: true,
        actor: { id: 'admin_owner', name: 'Owner', role: 'owner', branchId: null, permissions: ['*'], mfaEnabled: false },
        csrf: 'csrf-test',
      }),
    });
  });
  await page.route('**/api/admin/overview*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, counts: {}, recentLeads: [] }) });
  });
  await page.route('**/api/admin/documents?**', async (route) => {
    const url = new URL(route.request().url());
    const view = url.searchParams.get('view');
    let body = { ok: true };
    if (view === 'templates') {
      body.templates = [{
        id: 'doc_1',
        title: 'Residential Deep Cleaning Agreement',
        category: 'residential',
        version: '2026-11-22.remediation.v1',
        version_label: 'Version 1.0',
        status: 'approved',
        source_kind: 'text',
        signer_party: 'customer',
      }];
    } else if (view === 'bundles') {
      body.bundles = [{
        id: 'bundle_1',
        code: 'customer.deep',
        name: 'Residential Deep Cleaning Packet',
        purpose: 'customer',
        packet_type: 'deep',
        document_count: 6,
        approved_document_count: 6,
        required_document_count: 6,
        status: 'active',
        is_system: 0,
      }];
    } else if (view === 'requests') {
      body.requests = [];
    } else if (view === 'reminder-settings') {
      body.settings = { enabled: false, firstHours: 24, secondHours: 72 };
    } else if (view === 'updates') {
      body.updates = [];
    } else if (view === 'template') {
      body.template = {
        id: 'doc_1',
        title: 'Residential Deep Cleaning Agreement',
        category: 'residential',
        version: '2026-11-22.remediation.v1',
        version_label: 'Version 1.0',
        status: 'approved',
        source_kind: 'text',
        signer_party: 'customer',
        requires_verification: 0,
        requires_countersignature: 0,
        legal_review_status: 'owner_approved',
        content_text: 'SPARKLING STANDARD CLEANING CO.\nResidential Deep Cleaning Agreement\nStandards That Sparkle.\n\n1. Parties and Incorporation\n1.1 Clause text.',
      };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/api/admin/documents', async (route) => {
    const body = route.request().postDataJSON();
    posts.push(body);
    if (body.action === 'create_revision') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          id: 'doc_rev_1',
          version: '2026-11-23.customer-release.v1',
          contentText: '<div class="doc-rich"><h2>Residential Deep Cleaning Agreement</h2><p>Version 1.1</p><h2>1. Parties and Incorporation</h2><p>1.1 Clause text.</p></div>',
          removed: [],
          sourceTemplateId: 'doc_1',
        }),
      });
      return;
    }
    if (body.action === 'publish_revision') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, previousTemplateId: 'doc_1', updatedPackets: 1, affectedCustomers: 0 }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  try {
    await page.goto(BASE + '/admin/', { waitUntil: 'load' });
    await page.locator('[data-admin-nav="documents"]').click();
    await page.locator('[data-document-tab="library"]').first().click();
    await page.getByRole('button', { name: /Edit & revise/i }).click();
    await page.locator('[data-document-editor]').waitFor({ state: 'visible' });
    assert.match(await page.inputValue('[data-document-editor-title]'), /Residential Deep Cleaning Agreement/);
    assert.match(await page.textContent('[data-document-editor-version-display]') ?? '', /Version 1\.0/);
    assert.doesNotMatch(await page.textContent('[data-document-editor-version-display]') ?? '', /remediation|customer-release/i);
    await page.locator('[data-document-editor-canvas]').waitFor({ state: 'visible' });
    assert.match(await page.locator('[data-document-editor-canvas]').innerHTML(), /Residential Deep Cleaning Agreement/);
    assert.ok((await page.locator('[data-editor-command="bold"]').count()) === 1);
    assert.ok((await page.locator('[data-editor-command="justifyCenter"]').count()) === 1);
    assert.ok((await page.locator('[data-editor-insert-table]').count()) === 1);
    assert.ok((await page.locator('[data-editor-page-break]').count()) === 1);

    const preview = page.frameLocator('[data-document-editor-preview]');
    await preview.getByText('Residential Deep Cleaning Agreement').first().waitFor({ state: 'visible' });

    await page.locator('[data-document-editor-canvas]').evaluate((element) => {
      element.innerHTML = '<h2>Residential Deep Cleaning Agreement</h2><p><strong>Bold clause</strong> and <em>italic clause</em> with <u>underlined text</u>.</p><p style="text-align:center;color:#8a4a52">A new explanatory paragraph.</p><table><tbody><tr><td>Item</td><td>Price</td></tr></tbody></table><div data-doc-page-break="true"></div><p>After the page break.</p>';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('[data-document-editor-header]').fill('Sparkling Standard LLC');
    await page.locator('[data-document-editor-footer]').fill('Confidential customer copy');
    await page.locator('[data-document-editor-save]').click();
    await page.waitForFunction(() => document.querySelector('[data-document-editor-status]')?.textContent?.includes('Draft revision saved'));
    const saved = posts.find((entry) => entry.action === 'update_draft_template');
    assert.ok(saved);
    assert.match(saved.contentText, /doc-rich/);
    assert.match(saved.contentText, /<strong>Bold clause<\/strong>/);
    assert.match(saved.contentText, /text-align:center/);
    assert.match(saved.contentText, /<table>/);
    assert.match(saved.contentText, /data-doc-page-break/);
    assert.match(saved.contentText, /Sparkling Standard LLC/);
    assert.match(saved.contentText, /Confidential customer copy/);
    assert.match(saved.contentText, /A new explanatory paragraph/);

    await page.locator('[data-document-editor-publish]').click();
    await page.waitForFunction(() => document.querySelector('[data-document-editor-status]')?.textContent?.includes('Approved and published'));
    const published = posts.find((entry) => entry.action === 'publish_revision');
    assert.deepEqual(published, { action: 'publish_revision', templateId: 'doc_rev_1' });
  } finally {
    await context.close();
  }
});

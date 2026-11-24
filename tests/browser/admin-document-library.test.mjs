// Document Library: normal operations show one current approved entry per
// document family; drafts and retired versions stay in their own workspaces.
// APIs are mocked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4598;
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

test('the owner sees current documents by default with drafts and history separated', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const families = [
    {
      familyKey: 'access-authorization',
      title: 'Residential Access Authorization',
      category: 'residential',
      approvedTemplateId: 'doc_access_current',
      approvedVersionLabel: 'Version 1.2',
      approvedSourceKind: 'text',
      approvedAt: '2026-11-23T12:00:00.000Z',
      legalReviewStatus: 'owner_approved',
      draftTemplateId: 'doc_access_draft',
      draftVersionLabel: 'Version 1.3',
      draftUpdatedAt: '2026-11-24T12:00:00.000Z',
      draftCount: 1,
      retiredCount: 2,
      versionCount: 4,
      packetCount: 1,
      activePacketCount: 1,
      packetNames: ['Residential Deep Cleaning Packet'],
      archivedAt: null,
      state: 'active',
    },
    {
      familyKey: 'legacy-notice',
      title: 'Legacy Photo Notice',
      category: 'general',
      approvedTemplateId: 'doc_legacy',
      approvedVersionLabel: 'Version 1.0',
      approvedSourceKind: 'text',
      approvedAt: '2026-11-20T12:00:00.000Z',
      legalReviewStatus: 'owner_approved',
      draftTemplateId: null,
      draftVersionLabel: null,
      draftUpdatedAt: null,
      draftCount: 0,
      retiredCount: 0,
      versionCount: 1,
      packetCount: 0,
      activePacketCount: 0,
      packetNames: [],
      archivedAt: '2026-11-24T09:00:00.000Z',
      state: 'archived',
    },
  ];
  const drafts = [{
    id: 'doc_access_draft',
    title: 'Residential Access Authorization',
    version: '2026-11-24.revision.3',
    version_label: 'Version 1.3',
    supersedes_template_id: 'doc_access_current',
    supersedes_version_label: 'Version 1.2',
    status: 'draft',
    legal_review_status: 'owner_approved',
    updated_at: '2026-11-24T12:00:00.000Z',
    created_at: '2026-11-24T12:00:00.000Z',
  }];

  await page.route('**/api/admin/auth*', (route) =>
    route.fulfill({
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
    }),
  );
  await page.route('**/api/admin/overview*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, counts: {}, alerts: [], recentLeads: [] }) }),
  );
  await page.route('**/api/admin/documents?**', (route) => {
    const url = new URL(route.request().url());
    const view = url.searchParams.get('view');
    let body = { ok: true };
    if (view === 'library') {
      body.library = { families, drafts, totals: { families: 2, approved: 2, drafts: 1, retired: 2, archivedFamilies: 1 } };
    } else if (view === 'bundles') {
      body.bundles = [];
    } else if (view === 'requests') {
      body.requests = [];
    } else if (view === 'reminder-settings') {
      body.settings = { enabled: false, firstHours: 24, secondHours: 72 };
    } else if (view === 'updates') {
      body.updates = [];
    } else if (view === 'family-history') {
      body.history = {
        familyKey: 'access-authorization',
        archivedAt: null,
        executedRequests: 2,
        templates: [
          {
            id: 'doc_access_current',
            title: 'Residential Access Authorization',
            version: '2026-11-23.customer-release.v1',
            version_label: 'Version 1.2',
            status: 'approved',
            created_at: '2026-11-23T10:00:00.000Z',
            approved_at: '2026-11-23T12:00:00.000Z',
            signature_count: 4,
            last_signed_at: '2026-11-24T10:00:00.000Z',
            packet_names: ['Residential Deep Cleaning Packet'],
          },
          {
            id: 'doc_access_retired',
            title: 'Residential Access Authorization',
            version: '2026-11-22.remediation.v1',
            version_label: 'Version 1.1',
            status: 'retired',
            created_at: '2026-11-22T10:00:00.000Z',
            approved_at: '2026-11-22T12:00:00.000Z',
            signature_count: 2,
            last_signed_at: '2026-11-22T14:00:00.000Z',
            packet_names: [],
          },
        ],
        audit: [
          { action: 'documents.template_approved', success: 1, created_at: '2026-11-23T12:00:00.000Z' },
        ],
      };
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  try {
    await page.goto(BASE + '/admin/', { waitUntil: 'load' });
    await page.locator('[data-admin-nav="documents"]').click();
    await page.locator('[data-document-tab="library"]').first().click();

    const activePanel = page.locator('[data-document-library-panel="active"]');
    await activePanel.getByText('Residential Access Authorization').first().waitFor({ state: 'visible' });
    const activeText = (await activePanel.textContent()) ?? '';
    assert.match(activeText, /Version 1\.2/);
    assert.match(activeText, /Version 1\.3 pending review/);
    assert.doesNotMatch(activeText, /Version 1\.0/, 'retired versions never appear in the normal library');
    assert.doesNotMatch(activeText, /Legacy Photo Notice/, 'archived families are hidden by default');

    const draftButton = activePanel.getByRole('button', { name: /Edit & revise/i });
    await draftButton.waitFor({ state: 'visible' });

    await page.locator('[data-document-library-tab="drafts"]').click();
    const draftsPanel = page.locator('[data-document-library-panel="drafts"]');
    await draftsPanel.getByText('Version 1.3').first().waitFor({ state: 'visible' });
    assert.match((await draftsPanel.textContent()) ?? '', /Review & publish/);

    await page.locator('[data-document-library-tab="archive"]').click();
    const archivePanel = page.locator('[data-document-library-panel="archive"]');
    await archivePanel.getByText('Legacy Photo Notice').waitFor({ state: 'visible' });
    assert.match((await archivePanel.textContent()) ?? '', /Restore family/);

    await archivePanel.getByRole('button', { name: 'Versions' }).first().click();
    const historyPanel = page.locator('[data-document-family-history]');
    await historyPanel.getByText('Residential Access Authorization — version history').waitFor({ state: 'visible' });
    const historyText = (await historyPanel.textContent()) ?? '';
    assert.match(historyText, /Version 1\.2/);
    assert.match(historyText, /Version 1\.1/);
    assert.match(historyText, /Restore as draft/);
    assert.match(historyText, /4/);
    assert.doesNotMatch(historyText, /customer-release|remediation/);
  } finally {
    await context.close();
  }
});

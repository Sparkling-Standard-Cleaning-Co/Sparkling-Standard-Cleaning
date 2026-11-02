// Admin Pricing & Estimator Control: real built admin page, mocked API.
// Verifies that the owner can open the tab, edit a value, save a draft and see
// the side-by-side simulator render — without touching a real database.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

import { pricingCatalog } from '../../src/lib/pricing/catalog.ts';
import { pricingSnapshotVersion, sourcePricingSnapshot } from '../../src/lib/pricing/snapshot.ts';
import { simulatePricing } from '../../src/lib/pricing/simulate.ts';

const PORT = 4421;
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
      const response = await fetch(BASE + '/', { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        browser = await chromium.launch();
        return;
      }
    } catch {
      // not ready yet
    }
    await delay(500);
  }
  throw new Error('preview server did not become ready on ' + BASE);
});

after(async () => {
  await browser?.close();
  server?.kill();
});

function versionPayload(overrides = {}) {
  const snapshot = overrides.snapshot ?? sourcePricingSnapshot();
  return {
    id: overrides.id ?? 'pricing_test_1',
    version: overrides.version ?? 1,
    status: overrides.status ?? 'published',
    fingerprint: pricingSnapshotVersion(snapshot),
    note: overrides.note ?? '',
    basedOnVersion: null,
    createdAt: new Date().toISOString(),
    createdBy: 'admin_test_owner',
    createdByEmail: 'owner@example.test',
    updatedAt: new Date().toISOString(),
    publishedAt: overrides.publishedAt ?? new Date().toISOString(),
    publishedBy: 'admin_test_owner',
    publishedByEmail: 'owner@example.test',
    snapshot,
  };
}

test('the owner can open Pricing & Estimator Control, edit, save and simulate', async () => {
  const source = sourcePricingSnapshot();
  let draft = null;
  const postActions = [];

  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  try {
    await page.route('**/api/admin/auth', (route) =>
      route.fulfill({
        json: {
          ok: true,
          configured: true,
          setupRequired: false,
          authenticated: true,
          actor: {
            id: 'admin_test_owner',
            email: 'owner@example.test',
            name: 'Hayli',
            role: 'owner',
            branchId: 'branch_pensacola',
            permissions: ['settings.write', 'lead.read', 'finance.read', 'admin.manage'],
            mfaEnabled: false,
          },
          csrf: 'test-csrf-token',
        },
      }),
    );
    await page.route('**/api/admin/overview', (route) =>
      route.fulfill({
        json: {
          ok: true,
          counts: { customers: 0, leads: 0, requests: 0, upcomingAppointments: 0, activeGifts: 0, failedLeadDeliveries: 0 },
          today: new Date().toISOString().slice(0, 10),
          recentLeads: [],
        },
      }),
    );
    await page.route('**/api/admin/pricing', async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        return route.fulfill({
          json: {
            ok: true,
            published: versionPayload(),
            draft,
            versions: [versionPayload()],
            baseline: {
              fingerprint: pricingSnapshotVersion(source),
              summary: { changedValues: 0, totalValues: pricingCatalog.length },
              snapshot: source,
            },
            catalog: pricingCatalog,
          },
        });
      }
      const body = request.postDataJSON();
      postActions.push(body.action);
      if (body.action === 'create_draft' || body.action === 'save_draft') {
        draft = versionPayload({
          id: 'pricing_test_draft',
          version: 2,
          status: 'draft',
          snapshot: body.snapshot,
          publishedAt: null,
        });
        return route.fulfill({ json: { ok: true, draft } });
      }
      if (body.action === 'simulate') {
        const comparison = simulatePricing(source, body.draftSnapshot ?? source, body.input);
        return route.fulfill({ json: { ok: true, comparison, publishedVersion: 1, draftVersion: 2 } });
      }
      return route.fulfill({ json: { ok: true } });
    });

    await page.goto(BASE + '/admin/', { waitUntil: 'load' });
    await page.locator('[data-admin-app]').waitFor({ state: 'visible' });
    await page.locator('[data-admin-nav="pricing"]').click();
    await page.locator('[data-pricing-path="owner.minimumJob"]').waitFor({ state: 'visible' });

    const minimum = page.locator('[data-pricing-path="owner.minimumJob"]');
    assert.equal(await minimum.inputValue(), '125');

    await minimum.fill('175');
    await page.locator('[data-pricing-field="owner.minimumJob"].pricing-field--changed').waitFor({ state: 'visible' });
    assert.match(await page.locator('[data-pricing-status]').innerText(), /Unsaved changes/);

    await page.locator('[data-pricing-action="save-draft"]').click();
    await page.waitForFunction(() =>
      (document.querySelector('[data-pricing-notice]')?.textContent ?? '').includes('Draft saved'),
    );
    assert.ok(postActions.includes('create_draft'));

    await page.locator('.pricing-sim-card').first().waitFor({ state: 'visible' });
    const prices = await page.locator('.pricing-sim-price').allInnerTexts();
    assert.equal(prices.length, 2);
    assert.match(prices[0], /\$/);
    assert.match(prices[1], /\$/);
    assert.ok(postActions.filter((action) => action === 'simulate').length >= 1);

    await page.locator('[data-sim="engine"]').selectOption('church');
    await page.locator('[data-sim-facility]').waitFor({ state: 'visible' });
    await page.locator('[data-sim="cleanableSqft"]').fill('4000');
    await page.waitForTimeout(900);
    assert.ok(postActions.filter((action) => action === 'simulate').length >= 2);
  } finally {
    await context.close();
  }
});

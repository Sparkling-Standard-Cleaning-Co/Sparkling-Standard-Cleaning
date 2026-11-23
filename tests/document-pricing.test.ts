import './helpers/enable-signing.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { enrollOwner } from '../src/lib/admin/operations.ts';
import {
  addBundleItem,
  approveTemplate,
  createBundle,
  createSigningRequest,
  createTemplate,
  getSigningRequestByToken,
  signSigningRequest,
} from '../src/lib/documents/service.ts';
import {
  createPricingSnapshot,
  formatPricingMoney,
  parsePricingSnapshot,
  pricingDocumentVariables,
  pricingSnapshotFromAdmin,
  pricingSnapshotFromFields,
  pricingSnapshotText,
} from '../src/lib/documents/pricing-snapshot.ts';
import { buildExecutedAgreementPdf } from '../src/lib/documents/agreement-pdf.ts';
import {
  htmlDocumentPlainText,
  normalizeRichDocumentHtml,
  renderDocumentHtml,
  sanitizeDocumentHtml,
} from '../src/lib/documents/rich-text.ts';
import { displayVersion, conventionalVersionLabel, familyVersionOrdinals } from '../src/lib/documents/version-labels.ts';
import { buildCheckoutPricingSnapshot } from '../functions/api/estimate-checkout.ts';

class SqlStatement implements D1PreparedStatement {
  private values: unknown[] = [];
  private readonly db: DatabaseSync;
  private readonly sql: string;
  constructor(db: DatabaseSync, sql: string) {
    this.db = db;
    this.sql = sql;
  }
  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this;
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...(this.values as never[])) as T | undefined) ?? null;
  }
  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return { success: true, results: this.db.prepare(this.sql).all(...(this.values as never[])) as T[] };
  }
  async run(): Promise<D1Result> {
    this.db.prepare(this.sql).run(...(this.values as never[]));
    return { success: true };
  }
}

class TestD1 implements D1Database {
  readonly raw = new DatabaseSync(':memory:');
  prepare(query: string): D1PreparedStatement {
    return new SqlStatement(this.raw, query);
  }
}

function migratedDb(): TestD1 {
  const db = new TestD1();
  db.raw.exec('PRAGMA foreign_keys = ON');
  for (const file of fs.readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
    db.raw.exec(fs.readFileSync(path.join('migrations', file), 'utf8'));
  }
  return db;
}

test('admin price entry becomes a persistent, structured snapshot', () => {
  const snapshot = pricingSnapshotFromAdmin(
    {
      'price.summary': '$335.00',
      'price.line_items': 'Cleaning service: $300.00\nTwo extra bathrooms: $35.00',
      'price.tax': 'No sales tax applies',
      'price.discount': 'FRIENDS15: $15.00',
      'property.address': '100 Example Street, Pensacola, FL 32502',
      'service.scope': 'Full deep cleaning scope.',
      'service.additions': 'Inside oven; inside refrigerator.',
      'service.date': '2026-12-01',
      'service.arrival_window': '8:00 AM to 10:00 AM',
    },
    { serviceCode: 'residential-deep', frequency: 'one_time', paymentTerms: 'Due before service.' },
  );
  assert.equal(snapshot.totalCents, 33500);
  assert.equal(snapshot.amountDueNowCents, 33500);
  assert.equal(snapshot.basePriceCents, 30000);
  assert.equal(snapshot.discountCents, 1500);
  assert.equal(snapshot.propertyAddress, '100 Example Street, Pensacola, FL 32502');
  assert.match(snapshot.serviceLabel, /Deep cleaning/i);
  const stored = JSON.parse(JSON.stringify(snapshot));
  assert.deepEqual(parsePricingSnapshot(JSON.stringify(stored)), snapshot);
  const variables = pricingDocumentVariables(snapshot);
  assert.match(variables['price.summary'], /\$335\.00/);
  assert.match(variables['price.line_items'], /Cleaning service/);
  assert.ok(pricingSnapshotText(snapshot).some((line) => line.includes('$335.00')));
});

test('a missing admin price is never invented', () => {
  const snapshot = pricingSnapshotFromAdmin({});
  assert.equal(snapshot.totalCents, null);
  assert.equal(snapshot.amountDueNowCents, null);
  assert.equal(snapshot.lines.length, 0);
});

test('stored booking fields produce the same price the customer saw', () => {
  const snapshot = pricingSnapshotFromFields({
    fields: {
      base_price: '360.19',
      travel_adjustment: '12.50',
      discount_amount: '15.00',
      discount_label: 'FRIENDS15',
      tax_amount: '0.00',
      total_due: '357.69',
      quoted_price: '357.69',
      service_address: '100 Example Street',
      address_city: 'Pensacola',
      address_state: 'FL',
      zip: '32502',
      preferred_date: '2026-12-01',
      preferred_time: '8:00 AM',
      service_type: 'standard',
      frequency: 'one_time',
      tax_note: 'Residential cleaning is not subject to sales tax.',
    },
    source: 'booking_record',
  });
  assert.equal(snapshot.totalCents, 35769);
  assert.equal(snapshot.taxCents, 0);
  assert.match(snapshot.propertyAddress, /Pensacola, FL, 32502/);
  assert.equal(formatPricingMoney(snapshot.totalCents), '$357.69');
});

test('checkout pricing snapshot is the exact server candidate amount', () => {
  const snapshot = buildCheckoutPricingSnapshot(
    { frequency: 'one_time', preferred_date: '2026-12-01', preferred_time: '8:00 AM' },
    {
      ok: true,
      amountCents: 33845,
      cleaningAmountCents: 33500,
      quotedCents: 33500,
      quotedTotalCents: 33845,
      reference: 'SS-20261201-TEST',
      serviceType: 'residential-deep',
      tax: { taxAmount: 345 } as never,
      verifiedState: 'FL',
      verifiedZip: '32502',
      automaticDiscountCents: 1500,
      automaticDiscountLabel: 'FRIENDS15',
      receipt: {
        service: 'Deep cleaning',
        serviceLocation: '100 Example Street, Pensacola, FL 32502',
        customerEmail: 'customer@example.test',
        lines: [
          { label: 'Cleaning service', amountCents: 35000, kind: 'charge' },
          { label: 'FRIENDS15', amountCents: -1500, kind: 'discount' },
          { label: 'Sales tax', amountCents: 345, kind: 'tax' },
        ],
        subtotalCents: 33500,
        taxCents: 345,
        taxRatePercent: 1,
        taxJurisdiction: 'Florida',
        totalCents: 33845,
      },
      priceChanged: false,
    },
  );
  assert.equal(snapshot.totalCents, 33845);
  assert.equal(snapshot.amountDueNowCents, 33845);
  assert.equal(snapshot.taxCents, 345);
  assert.equal(snapshot.discountCents, 1500);
  assert.ok(snapshot.lines.some((line) => line.kind === 'discount' && line.amountCents === -1500));
});

test('the signing request stores the price snapshot and the executed evidence repeats it', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner-pricing@example.test',
    name: 'Synthetic Owner',
    password: 'SyntheticOwner!2026',
  });
  const customerId = `cust_${crypto.randomUUID()}`;
  const propertyId = `prop_${crypto.randomUUID()}`;
  db.raw
    .prepare("INSERT INTO customers (id, primary_branch_id, first_name, last_name, status) VALUES (?, 'branch_pensacola', 'Pricing', 'Example', 'active')")
    .run(customerId);
  db.raw
    .prepare("INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value, is_primary) VALUES ('ct_pricing', ?, 'email', 'pricing@example.test', 'pricing@example.test', 1)")
    .run(customerId);
  db.raw
    .prepare("INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, status) VALUES (?, ?, 'branch_pensacola', 'Home', '100 Example Street', 'Pensacola', 'FL', '32502', 'active')")
    .run(propertyId, customerId);
  const template = await createTemplate(db, owner.id, {
    title: 'Priced Agreement',
    category: 'residential',
    version: '2026-11-23',
    contentText:
      'PRICED AGREEMENT\n\nCustomer: {{customer.legal_name}}\nPrice: {{price.summary}}\n{{price.line_items}}',
  });
  await approveTemplate(db, owner.id, template.id);
  const bundle = await createBundle(db, owner.id, {
    code: 'customer.deep',
    name: 'Priced Packet',
    serviceCategory: 'residential',
    subjectType: 'customer',
    purpose: 'customer',
    packetType: 'deep',
  });
  await addBundleItem(db, owner.id, {
    bundleId: bundle.id,
    templateId: template.id,
    sortOrder: 0,
    required: true,
    enforcementStage: 'before_payment',
  });
  const pricing = createPricingSnapshot({
    version: 1,
    currency: 'USD',
    source: 'admin_entry',
    serviceCode: 'residential-deep',
    serviceLabel: 'Deep cleaning',
    propertyAddress: '100 Example Street, Pensacola, FL 32502',
    serviceDate: '2026-12-01',
    arrivalWindow: '8:00 AM to 10:00 AM',
    basePriceCents: 33500,
    discountCents: 0,
    taxCents: 0,
    totalCents: 33500,
    amountDueNowCents: 33500,
    remainingBalanceCents: 0,
    paymentTerms: 'Due before service.',
    lines: [{ label: 'Cleaning service', amountCents: 33500, kind: 'charge' }],
  });
  const created = await createSigningRequest(
    db,
    {
      subjectType: 'customer',
      customerId,
      propertyId,
      serviceCode: 'residential-deep',
      frequency: 'one_time',
      bookingReference: 'SS-20261201-PRICE',
    },
    { createdByAdminUserId: owner.id, bundleId: bundle.id, pricingSnapshot: pricing },
  );
  assert.ok(created.token);
  const row = db.raw
    .prepare('SELECT pricing_snapshot_json, requirement_snapshot_json FROM signing_requests WHERE id = ?')
    .get(String(created.requestId)) as { pricing_snapshot_json: string; requirement_snapshot_json: string };
  const stored = parsePricingSnapshot(row.pricing_snapshot_json);
  assert.equal(stored?.totalCents, 33500);
  assert.match(row.requirement_snapshot_json, /\$335\.00/);
  const loaded = await getSigningRequestByToken(db, created.token!);
  assert.equal(parsePricingSnapshot((loaded?.request as Record<string, unknown>).pricing_snapshot_json)?.totalCents, 33500);

  const signed = await signSigningRequest(db, created.token!, {
    signerName: 'Pricing Example',
    signerEmail: 'pricing@example.test',
    consent: true,
    signatures: { [template.id]: { value: 'Pricing Example', type: 'typed' } },
    request: new Request('https://example.test/api/document-sign', {
      headers: { 'CF-Connecting-IP': '203.0.113.60', 'User-Agent': 'synthetic-pricing' },
    }),
  });
  assert.equal(signed.status, 'signed');
  const executed = db.raw
    .prepare('SELECT executed_copy_text FROM signing_requests WHERE id = ?')
    .get(String(created.requestId)) as { executed_copy_text: string };
  assert.match(executed.executed_copy_text, /PRICING AND PAYMENT/);
  assert.match(executed.executed_copy_text, /Total: \$335\.00/);
  assert.match(executed.executed_copy_text, /Cleaning service: \$335\.00/);
});

test('the executed PDF renders the signed price and rich formatting', () => {
  const rich = normalizeRichDocumentHtml(
    '<h2>Formatting Agreement</h2><p><strong>Bold clause</strong> and <em>italic clause</em> and <u>underlined clause</u>.</p><p style="text-align:center;color:#8a4a52">Centered colored sentence.</p><table><tbody><tr><td>Item</td><td>Price</td></tr></tbody></table><div data-doc-page-break="true"></div><p>After the page break.</p>',
  );
  const pdf = buildExecutedAgreementPdf({
    requestId: 'signreq_pricing_test',
    bundleName: 'Priced Packet',
    bundleCode: 'customer.deep',
    bundleVersion: 1,
    bookingReference: 'SS-20261201-PRICE',
    serviceCode: 'residential-deep',
    customerName: 'Pricing Example',
    propertyAddress: '100 Example Street, Pensacola, FL 32502',
    executedAt: '2026-12-01T14:00:00.000Z',
    pricing: {
      version: 1,
      currency: 'USD',
      source: 'admin_entry',
      capturedAt: '2026-12-01T13:00:00.000Z',
      serviceCode: 'residential-deep',
      serviceLabel: 'Deep cleaning',
      frequency: 'one_time',
      propertyAddress: '100 Example Street, Pensacola, FL 32502',
      serviceDate: '2026-12-01',
      arrivalWindow: '8:00 AM to 10:00 AM',
      scope: '',
      addOns: '',
      basePriceCents: 33500,
      travelCents: null,
      discountCents: 0,
      discountLabel: '',
      taxCents: 0,
      taxLabel: 'No sales tax applies',
      totalCents: 33500,
      amountDueNowCents: 33500,
      remainingBalanceCents: 0,
      paymentTerms: 'Due before service.',
      lines: [{ label: 'Cleaning service', amountCents: 33500, kind: 'charge' }],
      note: '',
    },
    signatures: [
      {
        title: 'Formatting Agreement',
        version: '2026-11-23',
        templateId: 'doc_rich',
        contentText: rich,
        contentSha256: 'a'.repeat(64),
        signerName: 'Pricing Example',
        signerEmail: 'pricing@example.test',
        signedAt: '2026-12-01T14:00:00.000Z',
        typedSignature: 'Pricing Example',
        status: 'signed',
        consentVersion: 'test',
        sourceKind: 'text',
      },
    ],
  });
  const raw = new TextDecoder('latin1').decode(pdf);
  assert.match(raw, /Pricing and Payment/);
  assert.match(raw, /\$335\.00/);
  assert.match(raw, /Formatting Agreement/);
  assert.match(raw, /\(Bold\)/);
  assert.match(raw, /\(clause\)/);
  assert.match(raw, /\/F2 9\.2 Tf/);
  assert.match(raw, /\/F5 9\.2 Tf/);
  assert.match(raw, /0\.541 0\.290 0\.322 rg/);
  assert.match(raw, /\(Item\)/);
  assert.match(raw, /\(Price\)/);
  assert.match(raw, /Kids \[9 0 R 11 0 R\]/);
  assert.match(raw, /\(After\)/);
  assert.match(raw, /\(break\.\)/);
});

test('rich HTML is sanitized but formatting and dynamic fields survive', () => {
  const raw =
    '<div class="doc-rich"><h2 onclick="alert(1)">Agreement</h2><p style="text-align:center;color:#8a4a52;background-image:url(javascript:alert(1))"><strong>Bold</strong> <em>italic</em> <u>underline</u> {{price.summary}}</p><script>alert(1)</script><a href="https://evil.test">link</a><table><tr><td colspan="2">Cell</td></tr></table></div>';
  const stored = normalizeRichDocumentHtml(raw);
  assert.match(stored, /<h2>Agreement<\/h2>/);
  assert.match(stored, /style="text-align:center;color:#8a4a52"/);
  assert.match(stored, /<strong>Bold<\/strong>/);
  assert.match(stored, /\{\{price.summary\}\}/);
  assert.doesNotMatch(stored, /onclick|javascript|background-image|<script|<a /i);
  const rendered = renderDocumentHtml(stored, 'doc-rendered');
  assert.match(rendered, /doc-rich-rendered/);
  assert.match(rendered, /<strong>Bold<\/strong>/);
  assert.doesNotMatch(rendered, /<script/i);
  assert.match(htmlDocumentPlainText(stored), /Agreement/);
  assert.equal(sanitizeDocumentHtml('<p>Hello</p>'), '<p>Hello</p>');
});

test('owner-facing version labels are conventional and stable', () => {
  assert.equal(conventionalVersionLabel(1), '1.0');
  assert.equal(conventionalVersionLabel(2), '1.1');
  assert.equal(conventionalVersionLabel(10), '1.9');
  assert.equal(conventionalVersionLabel(11), '2.0');
  assert.equal(displayVersion('2026-11-23.customer-release.v1', 2), 'Version 1.1');
  assert.equal(displayVersion('1.2'), 'Version 1.2');
  const ordinals = familyVersionOrdinals([
    { id: 'new', family_key: 'family', created_at: '2026-11-23' },
    { id: 'old', family_key: 'family', created_at: '2026-11-22' },
  ]);
  assert.equal(ordinals.get('old'), 1);
  assert.equal(ordinals.get('new'), 2);
});

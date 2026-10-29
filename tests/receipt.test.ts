import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildReceipt, type ReceiptData } from '../src/lib/payments/receipt.ts';

const base: ReceiptData = {
  receiptNumber: 'SSR-SS-20261029-ABC123',
  reference: 'SS-20261029-ABC123',
  paidAt: '2026-10-29T15:00:00.000Z',
  service: 'Residential Cleaning',
  serviceLocation: '100 S Baylen St, Pensacola, FL 32502',
  customerName: 'Synthetic Customer',
  customerEmail: 'customer@example.test',
  lines: [
    { label: 'Cleaning service — Residential Cleaning', amountCents: 20000, kind: 'charge' },
    { label: 'Inside oven', amountCents: 3500, kind: 'charge' },
    { label: 'SPARKLE100', amountCents: -10000, kind: 'discount' },
    { label: 'Travel adjustment', amountCents: 500, kind: 'travel' },
  ],
  subtotalCents: 14000,
  taxCents: 1050,
  taxRatePercent: 7.5,
  taxJurisdiction: 'Escambia County, FL',
  totalCents: 15050,
  paidCents: 15050,
  balanceCents: 0,
  paymentStatus: 'paid',
  stripeSessionId: 'cs_test_123',
};

test('the receipt is itemized, branded and shows tax and paid total', () => {
  const receipt = buildReceipt(base);
  assert.match(receipt.subject, /SS-20261029-ABC123/);
  assert.match(receipt.html, /Sparkling/);
  assert.match(receipt.html, /Inside oven/);
  assert.match(receipt.html, /SPARKLE100/);
  assert.match(receipt.html, /\$10\.50/);
  assert.match(receipt.html, /Escambia County/);
  assert.match(receipt.html, /\$150\.50/);
  assert.match(receipt.text, /Total: \$150\.50/);
  assert.match(receipt.text, /Paid: \$150\.50/);
});

test('the receipt escapes customer-supplied strings', () => {
  const receipt = buildReceipt({
    ...base,
    customerName: '<script>alert(1)</script>',
    serviceLocation: 'A & B "Home"',
  });
  assert.doesNotMatch(receipt.html, /<script>alert/);
  assert.match(receipt.html, /&lt;script&gt;/);
  assert.match(receipt.html, /A &amp; B &quot;Home&quot;/);
});

test('a partially paid or outstanding receipt shows the balance honestly', () => {
  const receipt = buildReceipt({
    ...base,
    paidCents: 5000,
    balanceCents: 10050,
    paymentStatus: 'partially_paid',
  });
  assert.match(receipt.html, /Outstanding balance/);
  assert.match(receipt.html, /\$100\.50/);
  assert.match(receipt.text, /Outstanding balance: \$100\.50/);
});

test('a no-tax receipt omits the tax row and keeps the total', () => {
  const receipt = buildReceipt({
    ...base,
    taxCents: 0,
    totalCents: 14000,
    paidCents: 14000,
    balanceCents: 0,
  });
  assert.doesNotMatch(receipt.text, /Sales tax/);
  assert.match(receipt.text, /Total: \$140\.00/);
});
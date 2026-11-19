import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAdminInvoice } from '../src/lib/invoicing/admin-invoice.ts';
import { buildInvoicePdf } from '../src/lib/invoicing/pdf.ts';
import { buildInvoiceEmail, sendInvoiceEmail } from '../src/lib/invoicing/invoice-email.ts';

function sampleInvoice(overrides: Record<string, unknown> = {}) {
  return {
    invoice: {
      id: 'invoice_1',
      customer_id: 'cust_1',
      number: 'INV-20261118-ABC123',
      status: 'partially_paid',
      issue_date: '2026-11-18',
      due_date: '2026-11-25',
      subtotal_cents: 6000,
      discount_cents: 500,
      tax_cents: 250,
      total_cents: 5750,
      amount_paid_cents: 1000,
      balance_cents: 4750,
      first_name: 'Test',
      last_name: 'Customer',
      company_name: '',
      customer_email: 'customer@example.test',
      customer_phone: '(850) 555-0100',
      line1: '1 Example Street',
      line2: '',
      city: 'Pensacola',
      state: 'FL',
      postal_code: '32502',
      notes: 'INTERNAL ONLY — never send this note to the customer',
      ...overrides,
    },
    lines: [
      { kind: 'service', description: 'Recurring cleaning', quantity: 1, unit_amount_cents: 5000, total_cents: 5000 },
      { kind: 'extra', description: 'Inside oven', quantity: 1, unit_amount_cents: 1000, total_cents: 1000 },
      { kind: 'discount', description: 'Discount', quantity: 1, unit_amount_cents: 500, total_cents: 500 },
      { kind: 'tax', description: 'Sales tax', quantity: 1, unit_amount_cents: 250, total_cents: 250 },
    ],
  };
}

test('stored invoice totals and customer fields become a customer document', () => {
  const document = buildAdminInvoice(sampleInvoice());
  assert.equal(document.totals.subtotal, 60);
  assert.equal(document.totals.discountAmount, 5);
  assert.equal(document.totals.taxAmount, 2.5);
  assert.equal(document.totals.totalDue, 57.5);
  assert.equal(document.totals.paymentsReceived, 10);
  assert.equal(document.totals.balanceDue, 47.5);
  assert.equal(document.data.invoiceNumber, 'INV-20261118-ABC123');
  assert.equal(document.data.billedTo.email, 'customer@example.test');
  assert.match(document.html, /Payments received/);
  assert.match(document.html, /Balance due/);
  assert.match(document.text, /BALANCE DUE: \$47\.50/);
});

test('an invoice with no tax never renders a zero tax row', () => {
  const source = sampleInvoice({ tax_cents: 0, total_cents: 5500, balance_cents: 4500 });
  source.lines = source.lines.filter((line) => line.kind !== 'tax');
  const document = buildAdminInvoice(source);
  assert.equal(document.totals.taxAmount, null);
  assert.doesNotMatch(document.html, /Sales tax/);
});

test('internal invoice notes never enter customer-facing output', () => {
  const document = buildAdminInvoice(sampleInvoice());
  assert.doesNotMatch(document.html, /INTERNAL ONLY/);
  assert.doesNotMatch(document.text, /INTERNAL ONLY/);
});

test('the generated PDF is a real PDF and contains the invoice identity', () => {
  const document = buildAdminInvoice(sampleInvoice());
  const pdf = buildInvoicePdf(document.data, document.totals);
  assert.equal(new TextDecoder().decode(pdf.subarray(0, 8)), '%PDF-1.4');
  const body = new TextDecoder().decode(pdf);
  assert.match(body, /INV-20261118-ABC123/);
  assert.match(body, /Sparkling Standard Cleaning Co\./);
  assert.match(body, /Balance due/);
});

test('a long invoice paginates instead of overflowing the page', () => {
  const source = sampleInvoice();
  source.lines = Array.from({ length: 60 }, (_, index) => ({
    kind: 'service',
    description: `Detailed cleaning task ${index + 1} with a longer description that wraps`,
    quantity: 1,
    unit_amount_cents: 100,
    total_cents: 100,
  }));
  source.invoice.subtotal_cents = 6000;
  source.invoice.discount_cents = 0;
  source.invoice.tax_cents = 0;
  source.invoice.total_cents = 6000;
  source.invoice.balance_cents = 6000;
  source.invoice.amount_paid_cents = 0;
  const document = buildAdminInvoice(source);
  const body = new TextDecoder().decode(buildInvoicePdf(document.data, document.totals));
  assert.match(body, /\/Count [2-9]/);
});

test('the invoice email carries the balance, payment link and no internal notes', () => {
  const document = buildAdminInvoice(
    sampleInvoice({ payment_url: 'https://checkout.stripe.com/c/pay/test-session' }),
  );
  const email = buildInvoiceEmail(document.data, document.totals);
  assert.match(email.subject, /INV-20261118-ABC123/);
  assert.match(email.subject, /\$47\.50/);
  assert.match(email.html, /Pay Invoice Securely/);
  assert.match(email.html, /Standards That Sparkle\./);
  assert.match(email.text, /Balance due: \$47\.50/);
  assert.match(email.text, /checkout\.stripe\.com/);
  assert.doesNotMatch(email.text, /INTERNAL ONLY/);
});

test('invoice email fails closed when Resend is not configured', async () => {
  const document = buildAdminInvoice(sampleInvoice());
  const outcome = await sendInvoiceEmail({
    to: 'customer@example.test',
    data: document.data,
    totals: document.totals,
    pdf: buildInvoicePdf(document.data, document.totals),
    env: {},
    idempotencyKey: 'test',
  });
  assert.equal(outcome.status, 'skipped_not_configured');
});

test('invoice email sends the PDF attachment through Resend', async () => {
  const document = buildAdminInvoice(sampleInvoice());
  const originalFetch = globalThis.fetch;
  let captured: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    captured = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    const outcome = await sendInvoiceEmail({
      to: 'customer@example.test',
      data: document.data,
      totals: document.totals,
      pdf: buildInvoicePdf(document.data, document.totals),
      env: { RESEND_API_KEY: 'test-key' },
      idempotencyKey: 'invoice-email-test',
    });
    assert.equal(outcome.status, 'sent');
    assert.deepEqual(captured.to, ['customer@example.test']);
    assert.match(String(captured.subject), /INV-20261118-ABC123/);
    const attachments = captured.attachments as Array<Record<string, string>>;
    assert.equal(attachments.length, 1);
    assert.match(attachments[0].filename, /\.pdf$/);
    assert.ok(attachments[0].content.length > 100);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

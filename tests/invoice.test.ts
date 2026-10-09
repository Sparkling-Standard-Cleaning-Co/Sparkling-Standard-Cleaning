// Commercial invoice builder tests — arithmetic, honesty placeholders, and
// the no-invented-details rule. Run with: npm test.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildInvoice,
  computeInvoiceTotals,
  formatInvoiceDate,
  formatMoney,
  hasOwnerPlaceholders,
  type InvoiceData,
} from '../src/lib/invoicing/invoice.ts';

const contact = {
  name: 'Sparkling Standard Cleaning Co.',
  phone: '(850) 426-8479',
  email: 'owner@sparkling-standard.com',
  website: 'sparkling-standard.com',
};

const base: InvoiceData = {
  invoiceNumber: 'SS-INV-2026-0001',
  issueDate: '2026-10-08',
  dueDate: '2026-10-22',
  billedTo: {
    company: 'Example Office Suites LLC',
    contact: 'Facilities Manager',
    email: 'billing@example.com',
    addressLines: ['1 Example Plaza', 'Pensacola, FL 32502'],
  },
  serviceLocation: '1 Example Plaza, Pensacola, FL 32502',
  poReference: 'PO-4471',
  lineItems: [
    { description: 'Commercial cleaning — October 2026 (twice weekly)', quantity: 1, unitPrice: 640 },
    { description: 'Deep clean — break room and restrooms', quantity: 2, unitPrice: 137.5 },
  ],
  notes: 'Service completed October 2026. Interior windows excluded by scope.',
  paymentTerms: 'Net 15 — payment due within 15 days of the issue date.',
  paymentMethods: ['Major credit and debit cards', 'ACH bank transfer'],
  contact,
};

test('line items, subtotal and total are computed to the cent', () => {
  const totals = computeInvoiceTotals(base);
  assert.equal(totals.subtotal, 915);
  assert.equal(totals.taxAmount, null);
  assert.equal(totals.totalDue, 915);
});

test('tax appears only when a label and a rate are supplied', () => {
  const withTax = computeInvoiceTotals({ ...base, taxLabel: 'Florida sales tax', taxRatePercent: 7.5 });
  assert.equal(withTax.taxAmount, 68.63, '7.5% of 915.00 rounded to cents');
  assert.equal(withTax.totalDue, 983.63);

  const labelOnly = computeInvoiceTotals({ ...base, taxLabel: 'Florida sales tax' });
  assert.equal(labelOnly.taxAmount, null, 'a label without a rate never invents tax');

  const rateOnly = computeInvoiceTotals({ ...base, taxRatePercent: 7.5 });
  assert.equal(rateOnly.taxAmount, null, 'a rate without a label never invents a tax line');
});

test('the invoice renders all required commercial fields', () => {
  const invoice = buildInvoice(base);
  for (const body of [invoice.html, invoice.text]) {
    assert.match(body, /SS-INV-2026-0001/);
    assert.match(body, /October 8, 2026/);
    assert.match(body, /October 22, 2026/);
    assert.match(body, /Example Office Suites LLC/);
    assert.match(body, /1 Example Plaza/);
    assert.match(body, /PO-4471/);
    assert.match(body, /Commercial cleaning — October 2026/);
    assert.match(body, /\$640\.00/);
    assert.match(body, /Subtotal/);
    assert.match(body, /TOTAL DUE: \$915\.00|Total due/);
    assert.match(body, /Net 15/);
    assert.match(body, /\(850\) 426-8479/);
    assert.match(body, /owner@sparkling-standard\.com/);
    assert.match(body, /Notes \/ scope|NOTES \/ SCOPE/);
  }
});

test('unset due date, payment terms and legal entity are explicit owner-completion placeholders', () => {
  const invoice = buildInvoice({
    ...base,
    dueDate: '',
    paymentTerms: '',
    contact: { ...contact, legalName: '' },
  });
  assert.match(invoice.html, /\[Due date — owner to complete\]/);
  assert.match(invoice.html, /\[Payment terms — owner to complete\]/);
  assert.match(invoice.html, /\[Legal entity — owner to complete\]/);
  assert.equal(hasOwnerPlaceholders(invoice), true);
});

test('a completed invoice reports no remaining placeholders', () => {
  const invoice = buildInvoice({ ...base, contact: { ...contact, legalName: 'Sparkling Standard Cleaning Co. LLC' } });
  assert.equal(hasOwnerPlaceholders(invoice), false);
  assert.match(invoice.html, /Legal entity: Sparkling Standard Cleaning Co\. LLC/);
});

test('no bank details, tax IDs or legal terms are ever invented', () => {
  const invoice = buildInvoice(base);
  const serialized = JSON.stringify(invoice);
  assert.doesNotMatch(serialized, /IBAN|SWIFT|routing number|account number|wire instructions/i);
  assert.doesNotMatch(serialized, /EIN|tax ID|registration number|VAT/i);
  assert.doesNotMatch(serialized, /late fee|interest at|penalty/i);
});

test('customer-supplied values are HTML-escaped in the document', () => {
  const invoice = buildInvoice({
    ...base,
    billedTo: { company: '<script>alert(1)</script>', contact: 'A "quoted" & <name>' },
  });
  assert.doesNotMatch(invoice.html, /<script>alert/);
  assert.match(invoice.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('money and date formatting are stable', () => {
  assert.equal(formatMoney(915), '$915.00');
  assert.equal(formatMoney(137.5), '$137.50');
  assert.equal(formatInvoiceDate('2026-10-08'), 'October 8, 2026');
  assert.equal(formatInvoiceDate('not-a-date'), 'not-a-date');
});

test('the plain-text version carries the same commercial facts', () => {
  const invoice = buildInvoice(base);
  assert.doesNotMatch(invoice.text, /<[a-z][^>]*>/i);
  assert.match(invoice.text, /BILLED TO/);
  assert.match(invoice.text, /LINE ITEMS/);
  assert.match(invoice.text, /PAYMENT TERMS/);
  assert.match(invoice.text, /TOTAL DUE: \$915\.00/);
});

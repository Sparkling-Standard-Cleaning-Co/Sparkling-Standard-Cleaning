import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EMAIL_ROUTING } from '../src/config/email-routing.ts';
import { DEFAULT_CUSTOMER_EMAIL_REPLY_TO } from '../src/lib/forms/customer-email.ts';
import { DEFAULT_OWNER_NOTIFICATION_EMAIL } from '../src/lib/forms/owner-email.ts';
import { DEFAULT_INVOICE_EMAIL_REPLY_TO } from '../src/lib/invoicing/invoice-email.ts';
import { DEFAULT_RECEIPT_EMAIL_REPLY_TO } from '../src/lib/forms/customer-receipt.ts';

test('department addresses are distinct and use the confirmed domain', () => {
  assert.equal(new Set([EMAIL_ROUTING.bookings, EMAIL_ROUTING.customerService, EMAIL_ROUTING.billing, EMAIL_ROUTING.hiring, EMAIL_ROUTING.admin, EMAIL_ROUTING.owner]).size, 6);
  assert.equal(EMAIL_ROUTING.bookings, 'booking@sparkling-standard.com');
  assert.equal(EMAIL_ROUTING.customerService, 'customer-service@sparkling-standard.com');
  assert.equal(EMAIL_ROUTING.billing, 'billing@sparkling-standard.com');
  assert.equal(EMAIL_ROUTING.hiring, 'hiring@sparkling-standard.com');
  assert.equal(EMAIL_ROUTING.admin, 'admin@sparkling-standard.com');
  assert.equal(EMAIL_ROUTING.owner, 'owner@sparkling-standard.com');
});

test('customer replies use customer service while owner alerts stay private', () => {
  assert.equal(DEFAULT_CUSTOMER_EMAIL_REPLY_TO, EMAIL_ROUTING.bookings);
  assert.equal(DEFAULT_OWNER_NOTIFICATION_EMAIL, EMAIL_ROUTING.owner);
  assert.equal(DEFAULT_INVOICE_EMAIL_REPLY_TO, EMAIL_ROUTING.billing);
  assert.equal(DEFAULT_RECEIPT_EMAIL_REPLY_TO, EMAIL_ROUTING.billing);
});

test('public business configuration uses the customer-service address', () => {
  const source = fs.readFileSync('src/config/business.ts', 'utf8');
  assert.match(source, /email: envFact\(import\.meta\.env\.PUBLIC_BUSINESS_EMAIL\) \?\? EMAIL_ROUTING\.customerService/);
  assert.match(source, /hiringEmail: EMAIL_ROUTING\.hiring/);
  assert.match(source, /ownerEmail: EMAIL_ROUTING\.owner/);
});

test('the careers page and footer expose the hiring address without an ATS', () => {
  const careers = fs.readFileSync('src/pages/careers.astro', 'utf8');
  const footer = fs.readFileSync('src/components/Footer.astro', 'utf8');
  assert.match(careers, /business\.hiringEmail/);
  assert.match(footer, /footer-hiring/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveServiceBranchStrict } from '../src/lib/branches/registry.ts';
import { calendarEnvForBranch, calendarIdForBranch } from '../src/lib/booking/google-calendar.ts';
import { reviewEligibility, type ReviewContext } from '../src/lib/reviews/service.ts';
import { buildInvoice } from '../src/lib/invoicing/invoice.ts';
import { buildInvoiceEmail } from '../src/lib/invoicing/invoice-email.ts';

const baseReview: ReviewContext = {
  branchId: 'branch_pensacola',
  branchName: 'Pensacola',
  customerId: 'cust_1',
  customerName: 'Test Customer',
  customerEmail: 'customer@example.com',
  appointmentId: 'appt_1',
  invoiceId: 'inv_1',
  appointmentStatus: 'completed',
  source: 'website',
  reviewUrl: 'https://g.page/r/example/review',
  enabled: true,
  delayHours: 24,
  maxPerCustomer: 1,
};

test('branch resolution uses the service ZIP and never defaults an unknown area to Pensacola', async () => {
  const pensacola = await resolveServiceBranchStrict(null, { zip: '32502' });
  assert.equal(pensacola.branch?.id, 'branch_pensacola');
  assert.equal(pensacola.reason, 'matched_zip');

  const tampa = await resolveServiceBranchStrict(null, { zip: '33602' });
  assert.equal(tampa.branch?.id, 'branch_tampa');
  assert.equal(tampa.reason, 'matched_zip');

  const springHill = await resolveServiceBranchStrict(null, { zip: '34609' });
  assert.equal(springHill.branch?.id, 'branch_tampa');

  const stPetersburg = await resolveServiceBranchStrict(null, { zip: '33701' });
  assert.equal(stPetersburg.branch?.id, 'branch_tampa');

  const orlando = await resolveServiceBranchStrict(null, { zip: '32801' });
  assert.equal(orlando.branch, null);
  assert.equal(orlando.reason, 'outside_service_area');

  const unknownState = await resolveServiceBranchStrict(null, { state: 'FL' });
  assert.equal(unknownState.branch, null);
  assert.equal(unknownState.reason, 'outside_service_area');
});

test('a requested branch cannot override an out-of-area address', async () => {
  const resolved = await resolveServiceBranchStrict(null, {
    requestedBranchId: 'branch_tampa',
    zip: '32502',
  });
  assert.equal(resolved.branch?.id, 'branch_pensacola');
});

test('Tampa calendar configuration never borrows the Pensacola calendar', () => {
  const env = {
    GOOGLE_CLIENT_ID: 'client',
    GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_REFRESH_TOKEN: 'refresh',
    GOOGLE_CALENDAR_ID: 'pensacola-legacy',
    GOOGLE_CALENDAR_ID_PENSACOLA: 'pensacola',
  };
  assert.equal(calendarIdForBranch(env, 'branch_pensacola'), 'pensacola');
  assert.equal(calendarIdForBranch(env, 'branch_tampa'), '');
  assert.equal(calendarEnvForBranch(env, 'branch_tampa'), null);
  assert.equal(calendarEnvForBranch(env, 'branch_pensacola')?.GOOGLE_CALENDAR_ID, 'pensacola');
});

test('review eligibility requires completion, consent-safe settings, and a real link', () => {
  assert.equal(reviewEligibility(baseReview).eligible, true);
  assert.equal(reviewEligibility({ ...baseReview, enabled: false }).reason, 'branch_review_requests_disabled');
  assert.equal(reviewEligibility({ ...baseReview, enabled: false }, { allowDisabled: true }).eligible, true);
  assert.equal(reviewEligibility({ ...baseReview, reviewUrl: '' }).reason, 'review_url_missing');
  assert.equal(reviewEligibility({ ...baseReview, appointmentStatus: 'confirmed' }).reason, 'service_not_completed');
  assert.equal(reviewEligibility({ ...baseReview, source: 'test' }).reason, 'test_record');
  assert.equal(reviewEligibility(baseReview, { existingCount: 1 }).reason, 'frequency_cap');
});

test('invoice review invitation is only rendered for an eligible completed service', () => {
  const data = {
    invoiceNumber: 'INV-1',
    issueDate: '2026-11-23',
    dueDate: '2026-11-23',
    billedTo: { company: 'Customer' },
    lineItems: [{ description: 'Cleaning', quantity: 1, unitPrice: 100 }],
    review: { url: 'https://g.page/r/example/review', eligible: true, branchName: 'Pensacola' },
    contact: {
      name: 'Sparkling Standard Cleaning Co.',
      phone: '(850) 426-8479',
      email: 'billing@sparkling-standard.com',
      website: 'sparkling-standard.com',
      legalName: 'Sparkling Standard LLC',
    },
  };
  const built = buildInvoice(data);
  assert.match(built.html, /Leave a Google review/);
  assert.match(built.text, /Leave a Google review|g\.page\/r\/example\/review/);
  const email = buildInvoiceEmail(built.data, built.totals);
  assert.match(email.html, /Leave a Google review/);
  assert.match(email.text, /g\.page\/r\/example\/review/);

  const withoutReview = buildInvoice({ ...data, review: { url: '', eligible: false } });
  assert.doesNotMatch(withoutReview.html, /Leave a Google review/);
});

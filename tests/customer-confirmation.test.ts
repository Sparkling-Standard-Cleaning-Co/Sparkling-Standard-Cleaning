// Customer confirmation email tests — branded, readable, and honest about the
// financial workflow boundary. Run with: npm test.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCustomerConfirmation } from '../src/lib/forms/customer-confirmation.ts';

const business = {
  name: 'Sparkling Standard',
  founder: 'Hayli',
  phone: '(850) 426-8479',
  email: 'owner@sparkling-standard.com',
  website: 'sparkling-standard.com',
};

const reservation: Record<string, string> = {
  request_type: 'reservation_request',
  service_type: 'standard',
  frequency: 'biweekly',
  square_feet: '1600',
  bedrooms: '3',
  full_baths: '2',
  service_address: '100 S Baylen St',
  address_city: 'Pensacola',
  address_state: 'FL',
  zip: '32502',
  preferred_date: '2026-12-15',
  arrival_preference: 'morning',
  quoted_price: '200',
  quoted_range: '$180–$220',
  quote_reference: 'SS-20261002-ABC123',
};

test('the confirmation says "request received" — never a confirmed booking', () => {
  const confirmation = buildCustomerConfirmation(reservation, business);
  assert.equal(confirmation.subject, 'We received your Sparkling Standard request');
  assert.match(confirmation.text, /WE RECEIVED YOUR REQUEST/);
  assert.match(confirmation.text, /THIS IS NOT A CONFIRMED APPOINTMENT\./);
  assert.match(confirmation.text, /Final scope, pricing and availability may require confirmation/i);
  assert.doesNotMatch(confirmation.text, /your appointment is confirmed|booking confirmed|you are booked/i);
});

test('the subject is fixed for every request kind and never implies a booking or a payment', () => {
  const kinds: Array<Record<string, string>> = [
    reservation,
    { name: 'Synthetic', phone: '8500000000', recipient_name: 'Someone Special', gift_value: '100' },
    { organization: 'Example Church', facility_type: 'church', name: 'Lead', phone: '8500000000' },
    { property_location: '12 Beach Rd', turnover_frequency: 'per_stay', name: 'Host', phone: '8500000000' },
    { request_type: 'contact', name: 'Synthetic', phone: '8500000000', message: 'Hello' },
  ];
  for (const fields of kinds) {
    const confirmation = buildCustomerConfirmation(fields, business);
    assert.equal(confirmation.subject, 'We received your Sparkling Standard request');
    assert.doesNotMatch(confirmation.subject, /booking confirmed|appointment confirmed|receipt|invoice|final quote/i);
  }
});

test('the confirmation is not a receipt or an invoice and says no payment was taken', () => {
  const confirmation = buildCustomerConfirmation(reservation, business);
  for (const body of [confirmation.text, confirmation.html, confirmation.introText]) {
    assert.doesNotMatch(body, /payment received|amount charged|total due|balance due|paid in full/i);
    assert.doesNotMatch(body, /invoice attached|your invoice/i);
  }
  assert.match(confirmation.text, /Please don't send payment until we've confirmed an amount/i);
  assert.match(confirmation.text, /it is not a booking, an invoice or a payment receipt/i);
});

test('the branded HTML is email-safe: inline styles, no scripts, no external images', () => {
  const confirmation = buildCustomerConfirmation(reservation, business);
  assert.match(confirmation.html, /^<!doctype html>/);
  assert.match(confirmation.html, /role="presentation"/);
  assert.match(confirmation.html, /style="/);
  assert.doesNotMatch(confirmation.html, /<script/i);
  assert.doesNotMatch(confirmation.html, /<img/i);
  assert.doesNotMatch(confirmation.html, /https?:\/\/(?!sparkling-standard\.com)/i);
  assert.match(confirmation.html, /Standards That Make Your Space Sparkle\./);
});

test('the summary and the provisional estimate appear in both HTML and plain text', () => {
  const confirmation = buildCustomerConfirmation(reservation, business);
  for (const body of [confirmation.html, confirmation.text]) {
    assert.match(body, /Residential cleaning/);
    assert.match(body, /Every two weeks/);
    assert.match(body, /Deep Cleaning \(required\)/);
    assert.match(body, /100 S Baylen St, Pensacola, FL 32502/);
    assert.match(body, /Tuesday, December 15, 2026/);
    assert.match(body, /provisional estimate range/i);
    assert.match(body, /\$180–\$220/);
    assert.match(body, /SS-20261002-ABC123/);
  }
});

test('customer-submitted values are HTML-escaped', () => {
  const confirmation = buildCustomerConfirmation(
    { ...reservation, service_address: '<script>alert(1)</script>', name: 'A "quoted" & <name>' },
    business,
  );
  assert.doesNotMatch(confirmation.html, /<script>alert/);
  assert.match(confirmation.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('a gift request states plainly that no payment has been taken', () => {
  const confirmation = buildCustomerConfirmation(
    { name: 'Synthetic', phone: '8500000000', recipient_name: 'Someone Special', gift_value: '100' },
    business,
  );
  assert.equal(confirmation.subject, 'We received your Sparkling Standard request');
  assert.match(confirmation.introText, /No payment has been taken by this request/i);
  assert.match(confirmation.text, /secure payment link/i);
});

test('a priced facility request follows up on its preliminary estimate, not a walkthrough', () => {
  const confirmation = buildCustomerConfirmation(
    {
      request_type: 'facility_estimate',
      estimate_status: 'estimated',
      organization: 'Example Office',
      facility_type: 'office',
      name: 'Facilities Lead',
      phone: '8500000000',
      quoted_price: '155',
    },
    business,
  );
  assert.equal(confirmation.subject, 'We received your Sparkling Standard request');
  assert.match(confirmation.introText, /facility estimate request/i);
  assert.match(confirmation.text, /preliminary/i);
  assert.doesNotMatch(confirmation.text, /arrange a walkthrough/i);
});

test('a facility scope-review request keeps scope-review language', () => {
  const confirmation = buildCustomerConfirmation(
    {
      request_type: 'facility_estimate',
      estimate_status: 'custom_confirmation_required',
      organization: 'Example Church',
      facility_type: 'church',
      name: 'Facilities Lead',
      phone: '8500000000',
    },
    business,
  );
  assert.match(confirmation.introText, /facility scope-review request/i);
  assert.match(confirmation.text, /written scope and quote/i);
});

test('a commercial request follows up with a walkthrough, not a booking claim', () => {
  const confirmation = buildCustomerConfirmation(
    { organization: 'Example Church', facility_type: 'church', name: 'Facilities Lead', phone: '8500000000' },
    business,
  );
  assert.equal(confirmation.subject, 'We received your Sparkling Standard request');
  assert.match(confirmation.text, /arrange a walkthrough/i);
  assert.match(confirmation.text, /written scope and quote to approve/i);
});

test('the confirmation carries the owner-approved contact block and signature', () => {
  const confirmation = buildCustomerConfirmation(reservation, business);
  for (const body of [confirmation.html, confirmation.text]) {
    assert.match(body, /\(850\) 426-8479/);
    assert.match(body, /owner@sparkling-standard\.com/);
    assert.match(body, /sparkling-standard\.com/);
    assert.match(body, /Hayli/);
  }
});

test('no private infrastructure or credential material appears anywhere', () => {
  const confirmation = buildCustomerConfirmation(reservation, business);
  const serialized = JSON.stringify(confirmation);
  assert.doesNotMatch(serialized, /TRAVEL_ORIGIN|ROUTES_API_KEY|MAPMAP_API_KEY|WEB3FORMS_ACCESS_KEY/);
  assert.doesNotMatch(serialized, /server_relay|authoritative|option-c/i);
});

test('the plain-text fallback mirrors the HTML content without markup', () => {
  const confirmation = buildCustomerConfirmation(reservation, business);
  assert.doesNotMatch(confirmation.text, /<[a-z][^>]*>/i);
  assert.match(confirmation.text, /WHAT HAPPENS NEXT/);
  assert.match(confirmation.text, /1\./);
  assert.match(confirmation.introText, /we received your request/i);
  assert.doesNotMatch(confirmation.introText, /</);
});

test('a Pay Now request explains the separate Stripe step without telling the customer not to pay', () => {
  const confirmation = buildCustomerConfirmation({ ...reservation, payment_choice: 'pay_now' }, business);
  for (const body of [confirmation.text, confirmation.html]) {
    assert.match(body, /secure payment step opens separately through Stripe/i);
    assert.match(body, /not a payment receipt/i);
    assert.doesNotMatch(body, /Please don't send payment until/i);
    assert.doesNotMatch(body, /payment received|amount charged|paid in full/i);
  }
});

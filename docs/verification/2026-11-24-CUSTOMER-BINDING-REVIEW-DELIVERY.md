# Customer binding, review delivery and text-encoding repair

**Date:** 2026-11-24
**Branch:** `production-safe`
**Production:** https://sparkling-standard.com

## P0 — Quick Estimate customer/property mixing

### Root cause

The Quick Estimate customer selector only changed the dropdown value. Its change
handler:

- derived the contact name and email by splitting the visible option text;
- filled the name/email only when the fields were already empty;
- never loaded the phone;
- never cleared the previous customer;
- fetched properties independently with no stale-response guard;
- did not repopulate saved house characteristics from the property.

Selecting Christina after entering or loading another customer therefore left the
previous contact name/email/phone in the form while replacing the property/address
with Christina's. The defect was presentation/state only.

### Production reconciliation (read-only)

Verified directly against production D1:

- Quick Estimates persisted: **0**, so no Quick Estimate was saved with mixed data.
- Job/property customer mismatches: **0**.
- Invoice/property customer mismatches: **0**.
- Invoice/job customer mismatches: **0**.
- Customer, property, contact and document-template records checked for mojibake
  sequences: **0** corrupt values.
- No production record was modified, backfilled or deleted.

### Fix

- One context request now loads the selected customer and only that customer's
  active properties.
- The form clears contact, address and house-characteristic fields before loading.
- Name, email and phone come from canonical customer/contact records, never the
  option label.
- A stale-response sequence guard prevents an older customer request from
  overwriting the current selection.
- The primary property is selected automatically; with multiple properties and no
  primary, the owner chooses explicitly.
- Saved property type, square footage, bedrooms, bathrooms, beds and pets populate
  the estimate. Selecting another property does the same.
- A customer with no saved property gets a clear instruction; nothing is silently
  reused.
- Quick Estimate rejects a property with no customer and rejects another
  customer's property server-side.
- The New Booking loader received the same stale-response guard, including
  agreement-link loading.

## P1 — Google review delivery

### Production evidence

For reference `HC-20261123-0F3495` / `INV-20261124-458FE2`:

- Invoice status: **paid**, $275.00 service + $25.00 optional tip.
- Stripe payment: **succeeded**, recorded from the verified webhook.
- Payment receipt: **provider accepted**, Resend message recorded.
- Invoice email: **provider accepted** earlier the same day.
- The invoice email source includes the branch review link only when the linked
  service is completed with an official branch URL; this job was completed before
  the invoice email.
- Review requests for this customer/job: **0**.
- Pensacola review automation: **disabled**, so the automatic queue hook correctly
  did nothing.
- No separate review/thank-you email was sent.

This is a configuration/activation outcome, not a lost or duplicated email.

### Fix

- Owner/manager review screen now has an explicit **Send Review Invitation** action
  for an eligible completed job with an email and official branch link.
- The owner sees an accurate confirmation with recipient, service, completion date,
  property and branch, and can open the real preview first.
- The action queues and sends one invitation even while automation is disabled.
  It never requires an internal appointment ID or a tip.
- Sending remains idempotent at the queue and provider levels.
- Delivery results are recorded in the review registry and communications delivery
  events. Provider acceptance is not described as inbox delivery.
- Added an optional scheduled worker that sends only due, recent queued invitations,
  rechecks the branch switch, and cannot flush an old backlog when automation is
  enabled later.
- Production automation remains disabled. No customer email was sent during
  verification.

## P1 — Customer-file text encoding

- Removed 240 corrupted punctuation sequences from the admin client: separators,
  em/en dashes, arrows, ellipses, minus signs and the remove glyph.
- Repaired the two remaining corrupted dashes in the manual-booking source.
- Confirmed production customer/property/contact text and document titles contain
  no mojibake.
- Original legal documents and signature evidence were not changed.
- Added an encoding regression test over `src/` and `functions/`.

## Verification

- Unit: **1,106 tests — 1,105 pass, 1 pre-existing skip, 0 fail**.
- Browser: **277/277 pass**, including three-customer switching, stale-response
  racing, Quick Estimate payload integrity, review send and phone-width layouts.
- `astro check`: 0 errors, 0 warnings.
- Build: 41 pages.
- Validation: 2,631 internal links across 41 pages; SEO, marketing/QR, GTM and
  checklist checks pass.
- Smoke: 21 pages.
- No real customer email, charge, photo deletion or production record mutation was
  performed by verification.

## Owner action

Open **Admin → Google Reviews → Completed cleanings**, find the completed Move-Out
Cleaning for `HC-20261123-0F3495`, use **Preview** if desired, then choose **Send
Review Invitation**. That is the controlled action that sends the separate
thank-you/review email with the Pensacola Google link.

Automated review sending remains off. The optional worker is not deployed. Enabling
it requires the owner to deploy the worker, set its secrets and enable the branch
switch after a controlled acceptance test.

# Initiative 6.9 verification evidence

**Status:** code complete for the deployable portions; booking and gift sales remain behind owner
activation gates.
**Production baseline at start:** Initiative 6.10, `07360b7`.
**Initiative 6.10 was preserved:** 12 Follow Us profiles, URLs, structured data and marketing docs.

## Pay Now

- Root cause: the final summary always advertised Pay Now, but the button was hidden when the quote
  had unverified travel/address precision. Manual/ZIP-only entry produced that state.
- Fix: the summary now renders truthful state-specific copy. A preliminary quote offers **Verify
  Address & Finalize Price**; after pin confirmation and live routing the final step returns with
  Pay Now and **Reserve This Cleaning (Pay Later)**.
- Regression test: `tests/browser/initiative-6.9-paynow.test.mjs` (desktop and mobile).
- Live screenshots: `live-preliminary-before-verify-desktop.png`,
  `live-address-confirmation-desktop.png`, `live-paynow-eligible-desktop.png` and mobile equivalents.

## Google Calendar booking

Implemented behind `bookingConfig.enabled:false`:

- Dedicated-calendar OAuth client and exact setup: `docs/operations/GOOGLE-CALENDAR-SETUP.md`.
- Central-time/DST helpers, travel-aware availability, existing-job and buffer handling,
  `GET /api/availability`.
- Durable R2 holds with per-day locks and overlap prevention; `POST /api/booking-hold`.
- Owner confirmation/release API and one calendar event write; no customer data in public slots.
- Booking picker appears only when availability reports `enabled:true`; selecting a slot creates an
  expiring hold and carries its server-validated id into the request.
- Tests: `tests/booking-availability.test.ts`, `tests/booking-calendar.test.ts`,
  `tests/booking-holds.test.ts`, `tests/browser/initiative-6.9-booking.test.mjs`.

Not live: no Google Calendar credentials or dedicated calendar were provided. No real availability
is shown; the existing preferred-date request path remains.

## Gift certificates

- Durable R2 certificate ledger, idempotent issuance by Stripe event, partial redemption, balance
  lookup and owner-only admin API.
- Branded automatic purchaser/recipient delivery through Resend with idempotency keys and retryable
  failure handling.
- Public balance lookup returns only status and value; redemption remains owner-mediated.
- Proposed (not active) denominations: $50, $100, $150, $200.
- Tests: `tests/gift-ledger.test.ts`, `tests/gift-delivery.test.ts`,
  `tests/gift-balance.test.ts`, `tests/gift-checkout.test.ts`.

Sales remain disabled. No real Stripe test-mode purchase, delivery or redemption was performed.

## Verification

- `npm run check`: 173 files, 0 errors.
- `npm test`: 572 tests, 571 passed, 1 pre-existing skip, 0 failed.
- `npm run test:browser`: 151 passed, 0 failed.
- Focused Pay Now/booking/gift browser tests pass with mocked providers.

## Remaining external gates

1. Google Cloud OAuth + dedicated **Sparkling Standard — Bookings** calendar and Cloudflare secrets.
2. Owner approval of gift denominations and activation.
3. Stripe test-mode credentials or an authorized test-mode environment for a complete card test.
4. Owner/attorney approval of any fees (none active).

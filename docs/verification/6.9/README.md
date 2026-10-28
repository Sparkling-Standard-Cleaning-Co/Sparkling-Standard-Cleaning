# Initiative 6.9 verification evidence

**Status:** deployed. Google Calendar booking is **active** with owner approval; gift sales remain disabled.
**Cloudflare Pages:** c84e974f-5e11-4ed3-9e4c-a723e29f58fd; GitHub alidate, rowser and Cloudflare checks passed. Live status: all five Google/owner secrets present, OAuth connected to **Sparkling Standard - Bookings**, timezone America/Chicago, event read okay.
Cloudflare checks passed.
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

Live with `bookingConfig.enabled:true`, `confirmationMode:"owner_approval"` and `autoConfirmAllowed:false`:

- Dedicated-calendar OAuth client and exact setup: `docs/operations/GOOGLE-CALENDAR-SETUP.md`.
- Central-time/DST helpers, travel-aware availability, existing-job and buffer handling,
  `GET /api/availability`.
- Durable R2 holds with per-day locks and overlap prevention; `POST /api/booking-hold`.
- Owner confirmation/release API and one calendar event write; no customer data in public slots.
- Booking picker appears only when availability reports `enabled:true`; selecting a slot creates an
  expiring hold and carries its server-validated id into the request.
- Tests: `tests/booking-availability.test.ts`, `tests/booking-calendar.test.ts`,
  `tests/booking-holds.test.ts`, `tests/browser/initiative-6.9-booking.test.mjs`.

Live verification: production availability returned real slots (9:00 AM–4:00 PM start times for a
120-minute job), a real hold was created, a second overlapping hold was rejected with 409, and the
desktop/mobile picker rendered live slots without overflow. The owner confirmation/deletion path is
covered by mocked integration tests. A live owner-confirmation and Google event creation test was
not possible because the owner secret token cannot be read by engineering; no test event was left in
the calendar. Submitted reservations now create durable pending owner-review requests that survive hold expiry; pending requests are non-guaranteed and do not block capacity. Confirmation revalidates the slot and checks for an existing Sparkling event before creating another.

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
- `npm test`: 573 tests, 572 passed, 1 pre-existing skip, 0 failed.
- `npm run test:browser`: 151 passed, 0 failed.
- Focused Pay Now/booking/gift browser tests pass with mocked providers.

## Remaining external gates

1. Owner must add real confirmed jobs (with full addresses) to the connected bookings calendar; it currently has zero events.
2. Owner must exercise one owner-confirmation/event-creation test with the private token, then delete the test event; the API is implemented but not live-tested.
3. Owner approval of gift denominations and activation.
4. Stripe test-mode credentials or an authorized test-mode environment for a complete card test.
5. Owner/attorney approval of any fees (none active).

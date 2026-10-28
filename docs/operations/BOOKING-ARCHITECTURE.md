# Booking & checkout architecture - roadmap (LIVE BOOKING NOT ACTIVE)

Owner directive: Smart Estimate System 2.0, Part 6. This documents how the
current Astro/Cloudflare architecture can grow into direct booking WITHOUT
rebuilding the estimator. **No appointments are auto-confirmed.** The current release offers an
optional Pay Now for exact estimate quotes, but it is not a booking or deposit system and does not
hold a calendar slot.

**Initiative 6.8 status (2026-10-27):** live availability is still **not connected**. The website
continues to collect a preferred date and arrival window as a request, not a confirmed slot. No
calendar credentials, owner job schedule or crew roster were provided, so no honest availability
could be calculated. The owner must choose a provider and supply the connection before the
availability endpoint, holds and booking confirmation can be activated. Do not display fabricated
slots in the meantime.

**Implemented in Initiative 6.9 (behind `bookingConfig.enabled:false`):**

- Google Calendar OAuth client (`src/lib/booking/google-calendar.ts`) with dedicated-calendar
  status, event retrieval and event creation.
- Central-time conversion and DST-safe slot generation (`src/lib/booking/time.ts`).
- Travel-aware availability with work hours, notice, advance window, existing jobs, preparation
  buffers and next/previous job travel (`src/lib/booking/availability.ts`, `service.ts`).
- `GET /api/availability` returns no slots until the calendar and store are connected; any
  geocode/route/calendar failure withholds slots.
- Durable R2 booking holds with a per-day conditional lock, overlap prevention and 20-minute expiry
  (`src/lib/booking/holds.ts`, `POST /api/booking-hold`). Holds are explicitly not confirmed
  appointments.
- Owner-only `GET/POST /api/booking-admin` lookup, release and confirmation; confirmation
  revalidates availability and writes one Google Calendar event.
- Customer booking picker appears only when `/api/availability` reports `enabled:true`; selecting a
  slot creates the hold and carries its server-validated id/slot into the lead request.
- The owner notification labels the hold status, slot and expiry; a forged/expired hold never
  becomes authoritative.

**Still required for live activation:** the dedicated calendar, OAuth refresh token, owner token and
owner-approved rules in `docs/operations/GOOGLE-CALENDAR-SETUP.md`; then enable
`bookingConfig.enabled` and test holds/confirmations against the real calendar. Until then no slots
render and the existing preferred-date request path remains.

## The state machine (never interchangeable)

```
ESTIMATE  ── the calculator's proposal (browser) + server recompute
   │
REQUEST SUBMITTED ── the lead/email today; nothing is booked
   │
OWNER APPROVED ── Hayli reviews scope, photos, travel; sets the real price
   │
APPOINTMENT RESERVED ── a held slot with a validity window (a temporary hold,
   │                      not a promise; expires silently)
APPOINTMENT CONFIRMED ── the customer accepts; the slot is theirs
   │
PAID / PARTIALLY PAID ── deposit or authorization captured through Stripe
```

Every state is a distinct, persisted record with an audit trail. The current
system implements exactly ESTIMATE → REQUEST SUBMITTED → (human) OWNER
APPROVED — everything below is future work.

## What the current architecture already provides

- **Estimate engine** — shared browser/server calculation with
  reconciliation, quote `configVersion`, SPARKLE100, floor-$5, minimum/margin
  safeguards, travel verification (`functions/api/lead.ts`).
- **Lead record + notification** — the flat field map is effectively a
  proto-booking record; the reservation ledger docs
  (`docs/operations/RESERVATION-TRACKING.md`) already track statuses.
- **Payment primitives** — Stripe Checkout + a
  signature-verified webhook serve exact estimate Pay Now
  (`functions/api/estimate-checkout.ts`, `functions/api/stripe-webhook.ts`); gift
  certificates remain dormant. A future deposit/hold flow must not reuse the instant full-payment
  path as if it held a slot.
- **Scheduling config** — `src/config/scheduling.ts` (60-day window,
  statuses) is the seed of an availability model.
- **Private storage** — the R2 photo pipeline (Part 2) demonstrates the
  server-binding pattern a future booking store would follow (KV or D1 for
  slot records).

## Recommended additions (in order, each behind its own config flag)

1. **Availability model** — owner-defined working windows in config/KV;
   travel-aware service windows (start time + route duration + job hours +
   buffer); a `GET /api/availability?date&zip` function that returns genuine
   open slots only. Conflict prevention is a uniqueness constraint on
   (date, slot) — D1 or KV with a conditional put.
2. **Temporary holds** — a signed, short-lived hold token issued by
   `/api/hold`; expires silently; one live hold per request reference.
3. **Deposit / authorization** — reuse the gift-checkout Stripe pattern for a
   configurable deposit (e.g. a fixed amount or a percentage the owner sets
   per service). Authorization-only (capture later) keeps cancellations
   clean.
4. **Customer confirmation + reminders** — the existing customer-email
   path (Resend) already sends request confirmations; it extends to booking
   confirmations and reminder schedules via a cron-triggered Pages Function.
5. **Owner dashboard** — start as a function-rendered protected page
   (owner token, same pattern as photo viewing) listing requests by state.
   Only grow it into a full app when the paper process actually hurts.
6. **Rescheduling/cancellation** — a state transition + notification pair;
   policy windows belong in config, not code.

## Non-negotiables carried forward

- A price is still the owner's to confirm; auto-booked prices must remain
  inside the approved model only, or the feature stays off.
- The $125 minimum, floor-$5 rounding, SPARKLE100 rules and the 35-mile
  travel assumption apply unchanged to any booking surface.
- Every money-touching path goes through server-authoritative state changes —
  the browser never marks anything paid or booked.
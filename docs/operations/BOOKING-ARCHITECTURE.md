# Booking & checkout architecture - live owner-approval availability

Owner directive: Smart Estimate System 2.0, Part 6. This documents how the
current Astro/Cloudflare architecture can grow into direct booking WITHOUT
rebuilding the estimator. **No appointments are auto-confirmed.** The current release offers an
optional Pay Now for exact estimate quotes, but it is not a booking or deposit system and does not
hold a calendar slot.

**Initiative 6.9 status (2026-10-28):** live booking is **connected and active** against the
dedicated **Sparkling Standard - Bookings** Google Calendar in `America/Chicago`. Production
availability and holds are real. Confirmation is owner-approval only (`autoConfirmAllowed:false`);
a hold is never advertised as confirmed. The calendar currently has no jobs, so real availability
reflects only the configured working window and travel from the origin until the owner adds jobs.

**Resource-aware scheduler (2026-10-28):** the model now schedules the two real cleaning resources
(`src/config/booking.ts` → `bookingResources`: Hayli and the family cleaner), not a single crew with
a raised concurrency setting. Each resource has its own timeline, travel origin and working window.
A normal job consumes one resource; the owner may confirm a joint job with both and a shorter
on-site duration. Holds store the assigned resource ids, overlapping holds are allowed only on
different resources, and legacy calendar events without resource metadata conservatively block
both. Owner actions include `confirm`, `cancel`, `decline`, `release`, `reassign` (resource ids) and
`reschedule` (date/start/end/duration/crew). Calendar events carry `sparkling_resources` in their
private extended properties; owner confirmation honors the customer's held assignment instead of
silently auto-selecting a different cleaner.

**Working window (owner direction):** first appointment starts are offered from 7:00 AM; the slot
grid is 15 minutes; later starts are calculated from duration and travel; normal completion is by
6:00 PM in `America/Chicago`. Public contact hours remain 7:00 AM–7:00 PM.

**Hold vs pending request lifecycle (2026-10-28):** a 20-minute hold protects only the checkout
window. When the customer submits the lead, the server creates a durable pending booking request
(`booking/requests/BR-<hold>.json`) linked to the hold, quote and slot. Pending requests are
**non-guaranteed** and do not block availability. After the hold expires the request remains for
owner review; confirmation revalidates the calendar/travel slot and fails closed if another customer
now holds or books it. Customer language states the slot may be released and an alternative may be
offered. Owner confirmation accepts a request or hold ID, detects an existing calendar event by its
Sparkling reference before creating another, and cancellation deletes the event and releases both
records.

**Admin safety:** `/api/booking-admin` rejects unknown actions instead of defaulting to confirmation.
Releasing or declining a confirmed booking with a Google event returns `confirmed_booking_requires_cancel`;
only `cancel` deletes the event. Confirmation is idempotent by request status and checks for an existing
Sparkling reference event before creating another.

**Implemented and active:**


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
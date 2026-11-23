# Branch Calendars and Google Review Requests

## Branch calendars

Each operating branch must use its own Google Calendar.

| Branch | Environment value | Time zone |
| --- | --- | --- |
| Pensacola | `GOOGLE_CALENDAR_ID_PENSACOLA` (fallback: legacy `GOOGLE_CALENDAR_ID`) | `America/Chicago` |
| Tampa Bay | `GOOGLE_CALENDAR_ID_TAMPA` | `America/New_York` |

Rules:

- A missing Tampa calendar is a configuration failure. It never falls back to Pensacola.
- The owner may save a branch-specific `calendar_id` in **Admin → Branches & Launch**.
- Availability, temporary holds, automatic confirmation and commitment use the branch
  calendar and branch timezone.
- Public Tampa booking stays disabled until the owner advances the branch lifecycle and
  verifies staffing, licensing, insurance, tax, capacity, pricing, payments and fulfillment.

## Google review requests

1. Set the branch's official HTTPS Google review link in **Admin → Branches & Launch**.
   Never invent or shorten a Google review URL.
2. Keep **Enable automated review requests** off until the owner approves the policy.
3. Set the delay (default 24 hours) and maximum requests per customer (default 1).
4. A request is eligible only when:
   - the appointment is `completed`;
   - the record is not a test/preview record;
   - the customer has an email;
   - the branch has an official review link and automation enabled;
   - the customer is below the frequency cap;
   - the same appointment has not already been queued.
5. **Admin → Google Reviews** lists queued, sent, suppressed, failed and cancelled requests.
   The owner can queue a request for a completed appointment, cancel one, or send a queued
   request explicitly. Sending requires the normal owner session/step-up.
6. Invoice, invoice email and invoice PDF show a review invitation only for a completed
   service with an official branch link. Tampa has no link and shows no invitation.

Compliance:

- No incentive, discount, gift or entry is offered for a review.
- No positive-only screening or satisfaction gate.
- The customer is never required to leave a review.
- Honest negative feedback is welcomed and routed back to customer service.
- Review automation is a convenience, not a condition of service.

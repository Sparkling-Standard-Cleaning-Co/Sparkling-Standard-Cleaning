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
4. Automated queueing requires:
   - the appointment is `completed`;
   - the record is not a test/preview record;
   - the customer has an email;
   - the branch has an official review link and automation enabled;
   - the customer is below the frequency cap;
   - the same appointment has not already been queued.
5. **Admin → Google Reviews** lists queued, sent, suppressed, failed and cancelled requests.
   The owner can send a review invitation for an eligible completed job, cancel one, or
   send a queued request explicitly. Owner-initiated sending requires an explicit
   confirmation and the normal owner session/step-up. It does not require automation to
   be enabled and never depends on a tip or review sentiment.
6. Invoice, invoice email and invoice PDF show a review invitation only for a completed
   service with an official branch link. Tampa has no link and shows no invitation.
7. The scheduled `workers/review-requests` worker is optional and not deployed by the
   website release. It sends only due, recent queued requests, rechecks the branch switch
   and records delivery outcomes. It cannot flush an old backlog when automation is
   enabled later.

## Delivery evidence

A provider acceptance is recorded as `sent`, not as inbox delivery. Delivery outcomes are
written to `review_requests` and `notification_delivery_events`. A queued or accepted email
is never described as received until the owner confirms the inbox.

## Compliance

- No incentive, discount, gift or entry is offered for a review.
- No positive-only screening or satisfaction gate.
- The customer is never required to leave a review.
- Honest negative feedback is welcomed and routed back to customer service.
- Review automation is a convenience, not a condition of service.

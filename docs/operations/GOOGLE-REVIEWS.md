# Google Reviews and Branch Review Requests

## Branch setup

Each operating branch uses its own Google Calendar and its own review link.

| Branch | Calendar environment value | Time zone |
| --- | --- | --- |
| Pensacola | `GOOGLE_CALENDAR_ID_PENSACOLA` (fallback: legacy `GOOGLE_CALENDAR_ID`) | `America/Chicago` |
| Tampa Bay | `GOOGLE_CALENDAR_ID_TAMPA` | `America/New_York` |

Rules:

- A missing Tampa calendar is a configuration failure. It never falls back to Pensacola.
- The owner may save a branch-specific `calendar_id` in **Admin -> Branches & Launch**.
- Availability, temporary holds, automatic confirmation and commitment use the branch
  calendar and branch timezone.
- Public Tampa booking stays disabled until the owner advances the branch lifecycle and
  verifies staffing, licensing, insurance, tax, capacity, pricing, payments and fulfillment.

## Review request procedure

1. Set the branch's official HTTPS Google review link in **Admin -> Branches & Launch**.
   Never invent or shorten a Google review URL.
2. Keep **Enable automated review requests** off until the owner approves the policy.
3. Set the delay (default 24 hours) and maximum requests per customer (default 1).
4. Review eligibility follows the customer, not the appointment. Before an automatic
   invitation, the server requires:
   - the appointment is `completed`;
   - the record is not a test/preview record;
   - the customer has an email;
   - the branch has an official review link and automation enabled;
   - the customer relationship is not `reviewed`, `do_not_ask`, `opted_out` or
     `unknown`;
   - the customer is below the frequency cap;
   - no invitation was accepted in the last 30 days;
   - the same appointment has not already been queued.
5. **Admin -> Google Reviews** lists completed cleanings with their customer review
   relationship and all queued, sent, failed, suppressed and cancelled requests.
   The owner can:
   - send a review invitation for an eligible completed job;
   - preview the exact wording;
   - send a queued request explicitly;
   - cancel a queued or failed request;
   - retry a failed delivery;
   - mark a customer as reviewed, unknown, eligible again, do-not-ask or opted out.
6. Owner-initiated sending works while automation is off. It still requires a completed,
   non-test service, an official review link, an email and a non-suppressed relationship.
   It requires explicit confirmation and normal owner step-up. It never depends on a tip
   or on review sentiment.
7. Invoice, invoice email and invoice PDF show a review invitation only for a completed
   service with an official branch link and only when the customer has never been
   invited and is not suppressed. Tampa has no link and shows no invitation.
8. The scheduled `workers/review-requests` worker is optional and not deployed by the
   website release. It sends only due, recent queued requests, rechecks the branch switch
   and customer suppression, and records delivery outcomes. It cannot flush an old
   backlog when automation is enabled later.

## Customer review relationship

`customer_review_state` stores one row per customer with:

- `never_invited`, `queued`, `sent`, `failed`, `unknown`, `reviewed`, `do_not_ask` or
  `opted_out`;
- accepted invitation count and last invitation time;
- the last request id;
- an owner-recorded reviewed timestamp and actor;
- an optional note.

Invitation accepted is not the same as review received. The system never claims Google
verified a review. Without a reliable Google identity mapping, the owner records
**Mark as reviewed** manually. Similar-name matching is prohibited.

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
- A customer who already reviewed, opted out or asked not to be contacted is not asked
  again automatically.

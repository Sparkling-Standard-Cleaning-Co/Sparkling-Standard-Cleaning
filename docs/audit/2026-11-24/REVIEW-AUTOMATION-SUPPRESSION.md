# Review automation and suppression specification - 2026-11-24

## 1. Principle

Review eligibility belongs to the customer relationship, not to an individual
appointment. A completed cleaning creates an opportunity to evaluate eligibility;
it never creates an automatic right to ask again.

Review automation remains **disabled by default** and is owner-gated per branch.
This release implements the suppression substrate but does not enable or send
production review email.

## 2. Customer review relationship

Table: `customer_review_state` (migration `0058`), one row per customer.

| Field | Purpose |
| --- | --- |
| `status` | `never_invited`, `queued`, `sent`, `failed`, `unknown`, `reviewed`, `do_not_ask`, `opted_out` |
| `invitation_count` | Number of accepted deliveries attributed to this customer |
| `last_invited_at` | Last accepted invitation timestamp |
| `last_request_id` | Most recent `review_requests` row |
| `marked_reviewed_at` | Owner-recorded review confirmation |
| `marked_by_admin_user_id` | Audit actor |
| `source` | `automation`, `owner` or `delivery` |
| `note` | Optional owner note |

Delivery history remains in `review_requests`, which is never rewritten. The
state row is the suppression authority; legacy customers without a state row fall
back to counting prior `sent` requests.

## 3. Status semantics

| Status | Automatic invitation | Owner action |
| --- | --- | --- |
| `never_invited` | Allowed when all other checks pass | Send manually |
| `queued` | One request is already queued | Send the queued request |
| `sent` | No; frequency cap and recent-invitation guard apply | Mark reviewed / do not ask / eligible |
| `failed` | Retry is explicit; no silent loop | Retry delivery or cancel |
| `unknown` | No | Mark reviewed / eligible / do not ask |
| `reviewed` | No | Remains suppressed unless marked eligible |
| `do_not_ask` | No | Remains suppressed unless cleared |
| `opted_out` | No | Remains suppressed unless cleared |

"Invitation sent" is not "review received". The owner records a review only with
**Mark as reviewed**. The UI never claims Google verified that review.

## 4. Automatic eligibility checks

A review request can be queued automatically only when all are true:

1. Branch review automation is enabled.
2. The appointment is `completed`.
3. The record is not a test/preview record.
4. The branch has an official HTTPS review URL.
5. The customer has an email.
6. The customer relationship is not `reviewed`, `do_not_ask`, `opted_out` or
   `unknown`.
7. The customer is below the branch frequency cap.
8. No invitation was accepted in the last 30 days.
9. The same appointment has no existing request.

Owner-initiated sending may run while automation is off, but it still requires a
completed, non-test service, a real review link, an email, and a non-suppressed
customer relationship. It requires explicit confirmation and step-up.

## 5. Timing and channels

- Postpaid job: eligibility is evaluated after the service is completed and paid
  according to the existing trigger path. The review request is never conditioned
  on a tip.
- Prepaid job: eligibility is evaluated after completion. An optional tip link is
  separate from the review decision.
- Existing reviewer: ordinary receipts and service thank-you messages remain
  allowed; repetitive review solicitations do not.
- Channel is email. SMS review invitations are not implemented.
- Scheduled delivery processes only due requests inside the recent window; turning
  automation on later cannot flush an old backlog.

## 6. Delivery evidence

- `review_requests.status` distinguishes `queued`, `sent`, `failed`, `suppressed`
  and `cancelled`.
- `notification_delivery_events` records provider acceptance or failure.
- Provider acceptance is recorded as `sent`, not as inbox delivery.
- Failed requests can be retried explicitly. Retry returns the row to `queued`;
  the owner then sends it.
- The worker rechecks the branch switch and customer suppression immediately
  before sending.

## 7. Invoice and PDF invitations

Invoice, invoice email and invoice PDF show a review invitation only when:

- the service is completed;
- the branch has an official review link;
- the customer is not suppressed; and
- the customer has never been invited (`invitation_count = 0`, state not
  `queued`/`sent`/`unknown`).

This prevents an invoice email from becoming a second solicitation.

## 8. Google identity reality

Google Business Profile does not provide a reliable, automatically authenticated
mapping from a customer record to a specific Google review in this
implementation. The system therefore does not match reviews by similar names and
does not claim verification. The owner uses:

- **Mark as reviewed**
- **Review status unknown**
- **Do not ask again**
- **Customer opted out**
- **Mark eligible again**

These are owner records and are audit-logged.

## 9. Activation controls

- Per-branch enable switch: `branches.review_requests_enabled` (currently `0` for
  Pensacola and Tampa).
- Delay hours and maximum requests per customer remain branch settings.
- Manual preview, manual send, cancel and retry are owner-controlled.
- Delivery history and failure reasons are visible in Admin -> Google Reviews.
- No historical backlog is generated when automation is enabled.
- Production activation still requires owner approval after a controlled test.

## 10. Production state at this release

- Pensacola review URL is configured; Tampa has none.
- Automation is off for both branches.
- One historical review request exists and is `sent`.
- The customer-level state table is new; no state rows existed before migration
  `0058`. The existing sent request continues to suppress a duplicate invitation
  through the legacy `sent` count fallback.
- No review email was sent during this milestone.
- The `workers/review-requests` worker is implemented and unit-tested but **not
  deployed**. It has no Cloudflare D1 binding or Resend secret configured and
  cannot send while branch automation is off. Activation requires owner approval,
  worker deployment/configuration, a controlled delivery test, and confirmation
  that no historical backlog is released.
- The production dashboard currently has no open review incident and no queued
  review requests.

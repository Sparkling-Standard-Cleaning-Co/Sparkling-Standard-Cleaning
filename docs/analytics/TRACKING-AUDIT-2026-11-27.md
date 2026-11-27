# Marketing and conversion tracking audit - 2026-11-27

Read-only audit. No GTM, GA4, payment-event, conversion or exclusion-filter change was made.

## 1. What the current implementation can measure

| Question | Current capability | Mechanism |
| --- | --- | --- |
| Genuine website visitors | Partly | Consent-gated GA4 page views; visitors who decline or leave before consent are not counted. Search Console is the better total-traffic check. |
| Traffic acquisition sources | Yes, after consent | Landing URL UTMs + GA4; six Bing organic sessions were reported. First/latest touch is also stored on lead records. |
| Estimate starts | Yes | `estimate_start` after the first estimator interaction. |
| Completed estimates | Yes | `estimate_complete` once per wizard; payload has `service_type` and `outcome`. |
| Residential inquiries | Yes | `cleaning_request_submit` after provider acknowledgment. |
| Commercial inquiries | Yes | `commercial_quote_submit` / `commercial_quote_start`. |
| Church / STR inquiries | Yes, receipt not fully proven | `church_request_submit`, `str_request_submit`; new church events still need DebugView/Realtime confirmation. |
| Reservation requests | Proxy only | `booking_request` fires when a preferred date is present; it is not a server-confirmed reservation. |
| Confirmed bookings | **No** | No site event is emitted when the booking/calendar record is confirmed. |
| Successful payments | **No** | Payment success is verified server-side, but no GA4 event is emitted. |
| Actual transaction revenue | **No** | No `purchase`/ecommerce event or value/currency/transaction_id is sent; GA4 `$0` revenue is expected. |
| Recurring customer acquisition | **No** | Submit payloads carry service type and journey, not frequency/plan type. |

## 2. Duplicate and refresh behavior

- Submit events fire only after the form provider acknowledges success, not on page load or button
  press. Refreshing the thank-you page does not re-fire them.
- The payment-success page does **not** emit a purchase event, so a checkout retry or confirmation
  refresh cannot duplicate revenue. It also means there is no revenue to duplicate.
- `estimate_complete` is guarded by an in-page flag and fires once per wizard instance; Start Over
  begins a new flow and may legitimately fire again.
- `recordConversion` queues a confirmed receipt once in sessionStorage when consent is still
  undecided; `consent-controller` removes it after replay, so it is not replayed repeatedly.
- **Gap:** the queued-receipt replay allowlist only includes `cleaning_request_submit`,
  `commercial_quote_submit` and `str_request_submit`. A visitor who submits before choosing
  analytics consent can lose `church_request_submit`, `booking_request` and promotion submit
  events. Events already fire normally when consent is granted first.
- `promotion_request_submit` and `booking_request` can accompany a residential submit; these are
  distinct funnel events, not duplicates. Only the three primary submit events are marked as key
  events.

## 3. Internal development and test separation

- No GA4 internal-traffic rule is confirmed in the repository. Owner/test sessions and Stripe
  test-mode checkout work can appear in the reported active-user/session figures.
- The site does not set a `traffic_type` parameter. The current 19 users / 115 sessions may
  therefore include internal development traffic, consistent with the owner's observation.
- GA4 internal-traffic definitions and data filters are owner-side settings and were not changed.

## 4. Recommendations requiring separate owner approval

1. Add an authoritative post-payment and post-confirmation event, ideally server-side
   (Measurement Protocol) after verified Stripe payment and booking confirmation, with an
   idempotency key (session ID / event ID) and value/currency. This is the only accurate way to
   measure confirmed bookings, successful payments, revenue and refunds. It must not be added to
   the client success page alone because refresh/retry duplication would be possible.
2. Add an allowlisted recurring-plan parameter (for example `frequency`/`plan_type`) to the
   relevant submit events and GTM/GA4 mapping if recurring acquisition is a reporting priority.
3. Extend the deferred-receipt allowlist to church, booking and promotion events if pre-consent
   submissions are material. This changes conversion tracking and needs approval.
4. In GA4, define internal traffic for owner/test devices and use DebugView or a separate test
   property for Stripe test-mode work. Verify the church/promotion event receipt in DebugView.
5. Treat Stripe and the financial ledger, not GA4, as the authoritative revenue source until a
   verified server-side revenue event exists.

## 5. Evidence

- `src/lib/analytics/events.ts` (fixed event taxonomy and allowlisted payloads)
- `src/lib/forms/submit.ts` (`recordConversion` queue behavior)
- `src/scripts/consent-controller.ts` (receipt replay allowlist)
- `src/scripts/estimate-wizard.ts` (`estimate_start`, `estimate_step`, `estimate_complete`,
  `cleaning_request_submit`, `booking_request`)
- `src/scripts/lead-forms.ts` / `facility-estimate.ts` (commercial, STR, church submits)
- `docs/analytics/GTM-CONTAINER-SETUP.md` and `docs/analytics/ANALYTICS-SETUP.md` (owner-reported
  GTM Version 5, key events, open receipt checks)

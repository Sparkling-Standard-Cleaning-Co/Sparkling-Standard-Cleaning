# Lead measurement model (documentation only)

Future operational tracking for the full loop. No CRM is being built at launch — this defines
the fields so spreadsheets (and a future tool) measure the same things the website already
captures.

## The loop

```
SOURCE → LEAD → ESTIMATE → REQUEST → CONFIRMED BOOKING → JOB → RECURRING CUSTOMER
       → REVENUE → REVIEW → REFERRAL
```

## Where each stage already lives

| Stage | Captured today by |
| --- | --- |
| Source | Attribution capture (`src/lib/attribution.ts`): UTMs, referrer, ad click ids → attached to every lead |
| Lead | Site forms + calls/texts (owner logs manually) |
| Estimate | Estimator output included in the request email (`estimate_low/high`, status, confidence) |
| Request | Submission confirmation + analytics event (`cleaning_request_submit`, `booking_request`) |
| Confirmed booking | Owner confirms personally (never automatic) — log manually |
| Job / revenue | Owner records (weekly scorecard) |
| Recurring | Owner records conversion |
| Review | `REVIEW-GROWTH-SYSTEM.md` |
| Referral | Referral tracking field + QR attribution (`referral_card_qr`) |

## Recommended lead/job fields

| Field | Notes |
| --- | --- |
| lead_date | ISO date |
| source / medium / campaign / content | From attribution (first + latest touch) |
| landing_page / referrer_origin | From attribution |
| zip | From the request |
| service_requested | standard / deep / move_in_out / str / commercial |
| one_time_or_recurring | From frequency answer |
| estimate_low / estimate_high / estimate_status | From the estimator output |
| final_quoted_amount | Owner sets after confirmation |
| booked_status | request / confirmed / declined / lost |
| actual_revenue | After completion |
| labor_hours (owner + helper) | For calibration |
| travel_miles | For travel-economics review |
| direct_labor_cost | Owner/helper compensation |
| supplies_cost | When meaningful |
| gross_margin | Revenue − direct costs |
| recurring_status | none / active / paused |
| lost_reason | price / availability / scope / other |
| referral_source | Who referred, if any |

## Rules

- **Analytics events and lead records are different systems.** Non-identifying events go to
  analytics (consent-gated); personal lead details live only in the owner's records.
- Never place lead details (names, addresses, notes) into analytics tools.
- Counts and aggregates can still be sensitive for a small business — keep revenue figures out
  of public screenshots and shared documents.
- Review the calibration file (`docs/operations/ESTIMATOR-CALIBRATION.md`) monthly using these
  fields; small samples lie, so don't make formula changes on one job.

# Lead measurement model (documentation only)

Future operational tracking for the full loop. No CRM is being built at launch — this defines
the fields so spreadsheets (and a future tool) measure the same things the website already
captures.

## The loop

```
SOURCE → LEAD → ESTIMATE → REQUEST → CONFIRMED BOOKING → JOB → RECURRING CUSTOMER
       → REVENUE → REVIEW → REFERRAL
```

## Reporting hierarchy (marketing → business outcome)

Every layer answers a different question and has exactly one data source. Never use a marketing
metric to claim a business result.

| # | Stage | What it measures | Authoritative data source |
| --- | --- | --- | --- |
| 1 | **Content views** | Whether content is seen (views, watch-through, saves/shares) | Each platform's own insights (Instagram, TikTok, YouTube, Facebook, GBP views) |
| 2 | **Profile engagement** | Whether attention becomes interest (profile visits, link taps, follower growth) | Platform insights + tracked-link click volumes |
| 3 | **Website visits** | Whether interest reaches the site, and from which campaign | GA4 (consenting visitors only) + UTM data on lead records; Search Console for organic discovery |
| 4 | **Inquiries** | Whether a real request was delivered | GA4 key events (`cleaning_request_submit`, `commercial_quote_submit`, `str_request_submit`; owner-confirmed operational) **and** the owner inbox, which is the authoritative delivery record |
| 5 | **Confirmed bookings** | Whether Hayli personally confirmed an appointment | Owner records / reservation ledger — never GA4 |
| 6 | **Completed jobs** | Work actually delivered and its revenue | Owner records / weekly scorecard |
| 7 | **Recurring customers** | New weekly/biweekly recurring business — the primary objective | Owner records / weekly scorecard |

A GA4 key event means “a request was delivered”, never “a booking”. Only the owner's records
confirm bookings, revenue and recurring status.

## Where each stage already lives

| Stage | Captured today by |
| --- | --- |
| Source | Attribution capture (`src/lib/attribution.ts`): first-touch and latest-touch UTMs, landing page, external referrer, ad click ids → attached to every lead. Internal navigation, refreshes and direct views never overwrite campaign context (repaired 2026-10-03) |
| Lead | Site forms + calls/texts (owner logs manually) |
| Estimate | Estimator output included in the request email (`estimate_low/high`, status, confidence) |
| Request | Submission confirmation + GA4 key event (`cleaning_request_submit` / `commercial_quote_submit` / `str_request_submit`; `booking_request` when a preferred date is included) — owner-confirmed receiving in GA4 |
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
- Lead records carry `first_utm_*` and `latest_utm_*` fields (plus `landing_page`,
  `referrer_origin` and ad click ids). Compare first-touch (what originally brought the customer
  in) with latest-touch (the most recent meaningful campaign) when judging channels; internal
  navigation and direct visits deliberately do not replace campaign context. Rules:
  `src/lib/attribution.ts`; email labels: `docs/operations/LEAD-NOTIFICATION-FORMAT.md`.
- Never place lead details (names, addresses, notes) into analytics tools.
- Counts and aggregates can still be sensitive for a small business — keep revenue figures out
  of public screenshots and shared documents.
- Review the calibration file (`docs/operations/ESTIMATOR-CALIBRATION.md`) monthly using these
  fields; small samples lie, so don't make formula changes on one job.

# Estimate engines — architecture and owner controls

> **2026-10-24 (Initiative 6.1) update:** commercial and church numerical
> pricing is ENABLED as nonbinding provisional estimates for Tier A/B
> (ISSA-based workloading, fixture-based restrooms, $60/hr, workload-hour
> tiers). Tier C — larger, specialty or high-fixture scopes — remains a
> personal scope review with no invented price. The owner kill switch is
> `commercialTierConfig.numericEstimatesEnabled`; when false, every facility
> request returns to a scope-review experience with no numbers in the UI,
> request, owner notification or server verification. The 10% church discount
> is applied to the numeric cleaning subtotal after the minimum. Method,
> sources and benchmarks: `COMMERCIAL-PRICING-RESEARCH.md`.

Initiative 6.0 restructured the customer estimate experience into **four
specialized engines unified by one system**. This is the authoritative guide to
how they work, which parts are production-enabled, and how the owner changes
them.

## 1. The four engines

| Engine | Entry | Customer | Pricing state |
| --- | --- | --- | --- |
| **Residential Cleaning** | `/estimate/` (hub + wizard) | Homes, apartments, condos, recurring/deep/move-in-out/supportive | **Live instant estimate** (owner-approved labour model) |
| **Commercial Cleaning** | `/estimate/commercial/` | Offices, retail, salons, gyms, small facilities | **Live provisional estimate** — Tier A single price, Tier B range, Tier C scope review |
| **Short-Term Rental Turnovers** | `/estimate/str/` | Airbnb/Vrbo hosts | **Live per-turnover estimate** (existing approved STR model) |
| **Church Cleaning** | `/estimate/church/` | Churches and faith facilities | **Live provisional estimate** with the owner-directed **10% church discount**; Tier C scope review |

The `/estimate/` hub displays the four cards. Service pages are contextual entry
points that bypass the hub. There is ONE submission pipeline
(`submitLead` → `/api/lead` → Web3Forms + Resend).

## 2. Shared components (never duplicate)

- Location finder: `src/scripts/address-finder.ts` (GPS, manual entry,
  autocomplete, map-pin confirmation, approximate ZIP fallback).
- Travel: `src/lib/travel/`, `src/config/travel.ts`, `/api/travel`; the private
  operating origin is server-only and never exposed.
- Validation and pricing: `src/lib/estimate/` (`validation.ts`, `calculate.ts`,
  `quote.ts`, `verify.ts`), with server recalc in `functions/api/lead.ts`.
- Contact, date window, Turnstile, honeypot, analytics consent, attribution,
  owner notification (`src/lib/forms/lead-notification.ts`) and customer email.
- Engine registry and parameters: `src/lib/estimate/engines.ts`.

## 3. Residential engine

- Services: standard (one-time or weekly/biweekly/monthly), deep, move-in/out.
  "House Cleaning" is not a bookable category.
- New recurring arrangements still require the **first-visit Deep Cleaning**
  (acknowledgement enforced in the browser and the server).
- Two-price recurring presentation: first visit + ongoing per-visit amount.
- **Supportive Home Cleaning** is an optional RESIDENTIAL pathway (step 3):
  senior / veteran / first-responder / practical support / other / prefer not to
  specify, plus an optional "what would help" and practical notes. It is never
  required, never asks for medical details, and **never changes the price by
  category**. Practical extra scope is priced transparently by the normal model.
- Contextual presets: `?service=recurring|deep|move|move-out|one-time|supportive`
  (allowlisted) and `?frequency=weekly|biweekly|monthly|one_time`.

## 4. Commercial engine

`src/lib/estimate/commercial.ts` implements a facility workload model:
setup + cleanable area + restroom fixtures + breakroom, adjusted by flooring,
condition, traffic and first-clean factors. It reuses the baseline constants in
`src/config/owner-pricing.ts` (`commercialPricing`) and the workload-hour tier
boundaries in `src/config/pricing.ts` (`tierAHours` / `tierBHours`). The legacy
square-foot thresholds in `src/config/commercial-tiers.ts` are reference only.

**Numeric commercial pricing is enabled for Tier A/B** as nonbinding
preliminary estimates. Tier C (larger, specialty, high-fixture or high-risk)
is a personal scope review with no invented figure. The owner kill switch
`commercialTierConfig.numericEstimatesEnabled` is enforced in both the browser
and the server: when false, no numeric price is shown, sent in the request, or
recorded in the owner notification, and the server returns a scope-review
verdict.

## 5. Short-term rental engine

`/estimate/str/` runs the turnover questionnaire (property, beds, baths,
square footage, linen/laundry preference, check-out/check-in windows, rental
portfolio size, turnover rhythm) through the existing approved STR labour
model. The old standalone turnover form was retired; there is one pathway.
Same-day constraints are recorded for personal confirmation — no automatic rush
fee and no invented availability.

## 6. Church engine and the 10% discount

- Church-specific intake: ministry name, contact role, cleanable area,
  sanctuary seating, restrooms, classrooms, nursery, kitchen/fellowship,
  weekly events, condition, frequency, service windows, access.
- **Owner-directed discount (2026-10-24): 10% off eligible church cleaning.**
  Terms implemented in `src/lib/estimate/church-discount.ts` and configured in
  `src/config/pricing.ts` (`churchDiscount`, terms version
  `2026-10-24.church10.v1`):
  - the normal cleaning subtotal is calculated first;
  - the discount applies to the cleaning subtotal **after** the minimum-job
    rule, so the benefit is never silently erased by the floor;
  - travel and third-party costs are excluded;
  - it never stacks with another promotion;
  - it applies only to church requests;
  - it is a service discount — **not** a charitable donation or tax-deductible
    tithe.
- With numeric pricing enabled for Tier A/B, the customer sees the 10% discount
  applied to the cleaning subtotal after the minimum, with the preliminary
  price and savings. Tier C shows the discount entitlement and the owner
  confirms it personally. The owner notification records
  `church_discount_percent=10` + the terms version; the server recomputes the
  discount when pricing is enabled. When the kill switch is off, no discount
  amount is calculated or sent.
- Optional **partnership interest** checkboxes (volunteering, community
  initiatives, congregation introduction, contact me, not at this time). None
  are preselected, none affect the quote or discount, and they are not
  marketing opt-ins.

## 7. Estimate hub and CTAs

| Source | Destination | CTA |
| --- | --- | --- |
| `/estimate/` hub | four engine cards | engine labels |
| Recurring page | `/estimate/?service=recurring` | Get My Cleaning Estimate |
| Deep page | `/estimate/?service=deep` | Get My Cleaning Estimate |
| Move-in/out page | `/estimate/?service=move-out` | Get My Moving Clean Estimate |
| Supportive page | `/estimate/?service=supportive&supportive=yes` | Get My Cleaning Estimate |
| STR page | `/estimate/str/` | Get a Turnover Estimate |
| Commercial page | `/estimate/commercial/` | Estimate My Facility Cleaning |
| Church page | `/estimate/church/` | Estimate Church Cleaning |

## 8. Server verification and security

- Priced residential/STR requests are recalculated server-side from structured
  fields; client price, discount, coordinates and travel claims are ignored.
- Facility requests are independently rebuilt in
  `src/lib/estimate/facility-verify.ts`: workload, cleaning price, church
  discount, configuration version and travel status are server-derived, and
  the owner notification records the verified values plus a match/mismatch
  verdict. The client price is never trusted.
- When `commercialTierConfig.numericEstimatesEnabled` is false, the server
  returns `pricing_disabled` with no price, no labour hours and no discount
  amount, and `functions/api/lead.ts` strips every client-supplied facility
  price field before the owner notification is built. The switch is enforced
  independently of browser state.
- Non-priced scope-review requests are accepted only through the same relay with
  Turnstile/honeypot/contact checks; they are explicitly labelled scope reviews.
- `travel_verified=true` only for a real provider route. Never trust client
  travel values.

## 9. Owner controls

- **Prices, labour model, travel, church discount, facility baseline**:
  `src/config/owner-pricing.ts` (typed state in `src/config/pricing.ts`).
- **Facility numeric pricing kill switch**:
  `src/config/commercial-tiers.ts` (`numericEstimatesEnabled`). FALSE returns
  every commercial/church request to a scope review with no numeric prices in
  the UI, request, owner notification or server verification. Enforced in
  `src/lib/estimate/commercial.ts` and `src/lib/estimate/facility-verify.ts`.
- **Facility rate and workload constants**:
  `src/config/owner-pricing.ts` (`commercialPricing`) with typed state in
  `src/config/pricing.ts`.
- **Engine definitions/CTAs**: `src/lib/estimate/engines.ts`.
- **Calibration**: `npm run commercial:calibration` (hypothetical scenarios;
  intended for internal financial review, never published to customers).
- **Quote preview**: `npm run estimate:quotes`.

## 10. Known pending owner decisions

1. Calibrate the provisional Tier A/B pricing against the first 10–15 real
   commercial/church jobs (estimated hours vs actual hours and expenses).
2. Confirm the treatment of unusual specialty work and third-party costs in the
   church discount (currently excluded from the discount base by design).
3. Review the provisional $60/hour and effective production rates after that
   calibration evidence exists.
4. GTM registration of the new `church_request_start` / `church_request_submit`
   events (the website emits them; the owner's container needs matching tags).

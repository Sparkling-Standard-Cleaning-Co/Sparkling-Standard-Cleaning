# Estimate engines — architecture and owner controls

> **2026-10-25 (Initiative 6.1) update:** commercial and church numerical
> pricing is now ENABLED as nonbinding provisional estimates for Tier A/B
> (ISSA-based workloading, fixture-based restrooms, $60/hr, calibration-aware
> tiers). Very large/specialty facilities still route to a custom scope review.
> The 10% church discount is applied to the numeric cleaning subtotal after the
> minimum. Method, sources and benchmarks: `COMMERCIAL-PRICING-RESEARCH.md`.
> Earlier "gated" statements below are historical context.

Initiative 6.0 restructured the customer estimate experience into **four
specialized engines unified by one system**. This is the authoritative guide to
how they work, which parts are production-enabled, and how the owner changes
them.

## 1. The four engines

| Engine | Entry | Customer | Pricing state |
| --- | --- | --- | --- |
| **Residential Cleaning** | `/estimate/` (hub + wizard) | Homes, apartments, condos, recurring/deep/move-in-out/supportive | **Live instant estimate** (owner-approved labour model) |
| **Commercial Cleaning** | `/estimate/commercial/` | Offices, retail, salons, gyms, small facilities | **Scope review** — workload calculated; dollar pricing **gated** |
| **Short-Term Rental Turnovers** | `/estimate/str/` | Airbnb/Vrbo hosts | **Live per-turnover estimate** (existing approved STR model) |
| **Church Cleaning** | `/estimate/church/` | Churches and faith facilities | **Scope review** with the owner-directed **10% church discount**; dollar pricing **gated** |

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
setup + cleanable area + restrooms + breakroom, adjusted by condition and
traffic. It reuses the owner-approved baseline constants in
`src/config/owner-pricing.ts` (`commercialWorkload`) and the tier resolver in
`src/config/commercial-tiers.ts`.

**Numeric commercial pricing is gated** (`numericEstimatesEnabled: false`).
Until the owner approves calibration, every request is a **scope review** with
exclusions and an honest "price confirmed personally" message — never an
invented figure.

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
- While facility dollar pricing is gated, the customer sees the benefit
  commitment and the owner notification records
  `church_discount_percent=10` + the terms version. The numeric calculation is
  already implemented and tested for the moment the calibration gate opens.
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
- The church discount and facility workload are **not accepted from the client**
  — the server notification records the entitlement; any future numeric church
  quote must recompute in the same module.
- Non-priced scope-review requests are accepted only through the same relay with
  Turnstile/honeypot/contact checks; they are explicitly labelled scope reviews.
- `travel_verified=true` only for a real provider route. Never trust client
  travel values.

## 9. Owner controls

- **Prices, labour model, travel, church discount, facility baseline**:
  `src/config/owner-pricing.ts` (typed state in `src/config/pricing.ts`).
- **Numeric facility pricing gate**: `src/config/commercial-tiers.ts`
  (`numericEstimatesEnabled`).
- **Engine definitions/CTAs**: `src/lib/estimate/engines.ts`.
- **Calibration**: `npm run commercial:calibration` (hypothetical scenarios;
  never publish results).
- **Quote preview**: `npm run estimate:quotes`.

## 10. Known pending owner decisions

1. Commercial/church numeric pricing approval after calibration against real
   jobs (10–15 scenarios).
2. Church discount treatment of unusual specialty work/third-party costs
   (currently excluded from the discount base by design).
3. Whether to expose numeric church estimates before full commercial
   calibration (currently gated together).
4. GTM registration of the new `church_request_start` / `church_request_submit`
   events (the website emits them; the owner's container needs matching tags).

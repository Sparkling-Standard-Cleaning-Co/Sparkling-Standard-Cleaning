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
>
> **2026-10-25 (Initiatives 6.2–6.4) update:** the residential estimator now lives at
> `/estimate/residential/`; `/estimate/` is a clean four-engine selection hub.
> Legacy residential/STR query links and campaign claims forward with their
> query intact. Commercial and church forms are four-step guided experiences
> with field-specific validation. The owner-editable `estimatorCalibration` factors,
> Community Support 10% eligibility discount, exact church-discount
> reconciliation, two-decimal currency and tax disclosure are documented in
> `ESTIMATE-CALCULATION-ORDER.md` and `TAX-TREATMENT.md`.
>
> **2026-10-27 (Initiative 6.8) update:** prices are no longer displayed while the customer answers
> preliminary questions. The browser still calculates internally, but the live price, add-on dollar
> amounts and "price so far" preview are hidden. On the final step the shared branded reveal plays
> once and resolves into the full estimate/request summary. Changing an answer invalidates the prior
> result and the next final visit recalculates/re-reveals. Facility numeric prices are likewise
> confined to step 4. The underlying pricing mathematics, bundles, discounts, minimums, travel and
> configuration versioning are unchanged.

**2026-10-28 (owner priority UX directive) update:** the residential and STR
wizard is now exactly **five steps** — **When & Where → Service & Home →
Condition & Frequency → Optional Extras → Your Estimate**. Step 1 presents a
premium appointment calendar before an always-visible manual address card. The
calendar uses a compact First Appointment (7:00–8:30 AM) / Afternoon Appointment
(12:30–2:30 PM) hour-and-minute picker in 15-minute increments instead of a large
list of time buttons. The customer may type the full address (or use the
location button); there is no
map/pin confirmation or separate address-verification page. Suggestions are
strictly limited to Florida and Alabama, exact/close resolution happens in the
background, and a ZIP fallback keeps an eligible request moving. The preferred
date/time is provisional until the real job duration is known; the final step
revalidates the slot against the two-resource scheduler, converts it to a
temporary hold, and offers real alternatives when needed.

**Owner corrections (2026-10-29):** photos are collected in **Condition &
Frequency** and are required before booking confirmation. The customer may
continue without them; Pay Now then offers **Upload Photos Now** or **Pay Now,
Confirm Later**. Payment with photos outstanding is recorded honestly and the
payment-status page does not claim the booking is confirmed. The former large
Community Support panel is now one small eligibility checkbox linked to
`/terms/#community-support`; the discount calculation is unchanged. The
residential time list is the compact First/Afternoon hour-and-minute picker.

Commercial/church continue to use their dedicated four-step facility request
forms; their addresses also resolve in the background without a customer
verification screen, and commercial start times are not restricted to the
residential 7:00–8:30 / 12:30–2:30 windows.

Initiative 6.0 restructured the customer estimate experience into **four
specialized engines unified by one system**. This is the authoritative guide to
how they work, which parts are production-enabled, and how the owner changes
them.

## 1. The four engines

| Engine | Entry | Customer | Pricing state |
| --- | --- | --- | --- |
| **Residential Cleaning** | `/estimate/residential/` (wizard) | Homes, apartments, condos, recurring/deep/move-in-out/supportive | **Live instant estimate** (owner-approved labour model) |
| **Commercial Cleaning** | `/estimate/commercial/` | Offices, retail, salons, gyms, small facilities | **Live provisional estimate** — Tier A single price, Tier B range, Tier C scope review |
| **Short-Term Rental Turnovers** | `/estimate/str/` | Airbnb/Vrbo hosts | **Live per-turnover estimate** (existing approved STR model) |
| **Church Cleaning** | `/estimate/church/` | Churches and faith facilities | **Live provisional estimate** with the owner-directed **10% church discount**; Tier C scope review |

The `/estimate/` hub is **selection only**; it displays the four cards and no wizard. Service
pages are contextual entry points that bypass the hub. The residential wizard is
`/estimate/residential/`; legacy `/estimate/?service=` and `?promo=` links forward there with the
query intact. There is ONE submission pipeline
(`submitLead` → `/api/lead` → Web3Forms + Resend).

## 2. Shared components (never duplicate)

- Location finder: `src/scripts/address-finder.ts` (GPS, manual entry,
  autocomplete, map-pin confirmation, approximate ZIP fallback).
- Travel: `src/lib/travel/`, `src/config/estimators/travel.ts`, `/api/travel`; the private
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
- **Community Support Cleaning** is an optional RESIDENTIAL pathway: the customer
  self-attests eligibility (65+, first responder, veteran, living with a
  disability, or another eligible community category; the checked category is
  recorded only as an eligibility reason). The owner-directed
  **10% Community Support discount** applies once, never stacks with another
  promotion, and is applied to the pre-tax residential service subtotal. It is
  never automatic: the customer must check the eligibility box. The pathway
  never asks for medical records, proof documents or sensitive details, and
  the discount does not reduce travel or third-party costs. See
  `ESTIMATE-CALCULATION-ORDER.md`.
- Contextual presets: `?service=recurring|deep|move|move-out|one-time|supportive`
  (allowlisted) and `?frequency=weekly|biweekly|monthly|one_time`.

## 4. Commercial engine

`src/lib/estimate/commercial.ts` implements a facility workload model:
setup + cleanable area + restroom fixtures + breakroom, adjusted by flooring,
condition, traffic and first-clean factors. It reuses the baseline constants in
`src/config/estimators/pricing-values.ts` (`commercialPricing`) and the workload-hour tier
boundaries in `src/config/pricing.ts` (`tierAHours` / `tierBHours`). The legacy
square-foot thresholds in `src/config/estimators/commercial.ts` are reference only.

**Numeric commercial pricing is enabled for Tier A/B** as nonbinding
preliminary estimates. Tier C (larger, specialty, high-fixture or high-risk)
is a personal scope review with no invented figure. The owner kill switch
`commercialTierConfig.numericEstimatesEnabled` is enforced in both the browser
and the server: when false, no numeric price is shown, sent in the request, or
recorded in the owner notification, and the server returns a scope-review
verdict.

**Facility customer experience (6.2):** `/estimate/commercial/` and
`/estimate/church/` use the same four-step guided form (`FacilityEstimateForm.astro`
+ `facility-estimate.ts`): Your facility → Cleaning needs → Schedule & access →
Contact. Each step validates its own fields, keeps a visible progress state,
supports Back/Continue, moves focus to the first invalid field and exposes an
accessible error summary. The address, travel, tax and engine calibration rules are
identical to residential; facility requests are never automatically booked.

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
  - the normal cleaning subtotal is calculated first, including the $125
    minimum and the facility $5 presentation step;
  - the discount applies to that rounded cleaning subtotal and is retained to
    the cent — it is **not** rounded upward again;
  - example: `$145.00 − $14.50 = $130.50`;
  - the engine calibration factor, when configured, is applied after the discount to
    the cleaning subtotal only;
  - travel and third-party costs are excluded;
  - it never stacks with another promotion;
  - it applies only to church requests;
  - it is a service discount — **not** a charitable donation or tax-deductible
    tithe.
- With numeric pricing enabled for Tier A/B, the customer sees the 10% discount
  applied to the rounded cleaning subtotal, with the preliminary price and
  the exact savings to the cent. Tier C shows the discount entitlement and the
  owner confirms it personally. The owner notification records
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
| `/estimate/` hub | four engine cards → Residential `/estimate/residential/` | engine labels |
| Recurring page | `/estimate/residential/?service=recurring` | Get My Cleaning Estimate |
| Deep page | `/estimate/residential/?service=deep` | Get My Cleaning Estimate |
| Move-in/out page | `/estimate/residential/?service=move-out` | Get My Moving Clean Estimate |
| Community Support page | `/estimate/residential/?service=supportive&supportive=yes` | Get My Cleaning Estimate |
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
- The server independently re-derives the Community Support eligibility discount
  and the engine calibration factor; a client-supplied discount, factor, tax amount
  or final total is never trusted.
- The verified final total and pre-discount cleaning subtotal must reconcile to
  the cent; the owner notification and customer receipt carry the same
  breakdown. A mismatch is a review action, not a silently accepted price.
- Tax is disclosed from the category policy in `TAX-TREATMENT.md`; no server
  or client path invents a numeric tax rate or amount.
- Pay Now uses the same server-recalculated quote and is available only when the exact amount is
  known. Residential/STR quotes are re-verified and re-routed; facility payments are Tier A only.
  See `ESTIMATE-PAYMENTS.md`. Custom/range quotes remain reservation-only.

## 9. Owner controls

- **Prices, labour model, travel, church discount, Community Support discount,
  engine calibration factor, facility baseline**: `src/config/estimators/pricing-values.ts`
  (typed state in `src/config/pricing.ts`). Values outside the supported
  `0.50–1.50` calibration range fail closed to `1.00`.
- **Facility numeric pricing kill switch**:
  `src/config/estimators/commercial.ts` (`numericEstimatesEnabled`). FALSE returns
  every commercial/church request to a scope review with no numeric prices in
  the UI, request, owner notification or server verification. Enforced in
  `src/lib/estimate/commercial.ts` and `src/lib/estimate/facility-verify.ts`.
- **Facility rate and workload constants**:
  `src/config/estimators/pricing-values.ts` (`commercialPricing`) with typed state in
  `src/config/pricing.ts`.
- **Engine definitions/CTAs**: `src/lib/estimate/engines.ts`.
- **Add-on bundles**: `pricing-values.ts` (`promotions.addonBundles`). The owner-approved
  Kitchen Refresh, Deep Detail and Recurring Care bundles apply only when every required extra is
  selected, use the same single-discount policy and never discount specialty work.
- **Pay Now switch**: `src/config/payments.ts`; live checkout also requires Cloudflare
  `STRIPE_SECRET_KEY` and a configured `STRIPE_WEBHOOK_SECRET`.
- **Calibration**: `npm run commercial:calibration` (hypothetical scenarios;
- **Calibration report**: `npm run calibration:report` regenerates `FACILITY-CALIBRATION.md` and the full-field CSV; 26 commercial + 20 church scenarios completed (`FACILITY-CALIBRATION.md`).
  intended for internal financial review, never published to customers).
- **Quote preview**: `npm run estimate:quotes`.
- **Calculation and tax rules**: `ESTIMATE-CALCULATION-ORDER.md` and
  `TAX-TREATMENT.md`.
- **Financial scenarios**: `npm run estimate:scenarios` (engine calibration factor,
  Community Support nonstacking, church exact cents, taxable vs exempt).

## 10. Known pending owner decisions

1. Monitor actual job hours against the completed initial calibration
   (`FACILITY-CALIBRATION.md`, 26 commercial + 20 church scenarios) as a quality
   check; the model is usable now and does not wait on historical jobs.
2. Confirm the treatment of unusual specialty work and third-party costs in the
   church discount (currently excluded from the discount base by design).
3. Review the $60/hour and production rates if a sustained pattern of actual-job
   variance emerges; do not change rates without owner approval.
4. Verify live receipt of the `church_request_start` / `church_request_submit`
   and promotion events in GTM Version 5 / GA4 DebugView. The owner reports the
   container published; the website-side generation is tested, but receipt of
   the new events is not yet fully proven.

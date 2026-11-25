# Tampa Bay launch state

## Current state

- Branch ID: `branch_tampa`.
- Lifecycle: `setup`.
- Public page: `/locations/tampa-bay/` (noindex, nofollow).
- Inquiry intake: enabled through the Tampa-specific inquiry form.
- Public estimates/booking/payment: disabled.
- Fulfillment: not verified.
- Google Business Profile: not created.

## Capability model

Capabilities are code-owned and server-authoritative in
`src/config/branches.ts`:

| Capability | Pensacola | Tampa Bay |
| --- | --- | --- |
| Marketing page | yes | yes |
| Inquiries | yes | yes |
| Commercial leads | yes | yes |
| Pricing configured | yes | no |
| Public estimates | yes | no |
| Scheduling | yes | no |
| Payments | yes | no |
| Fulfillment verified | yes | no |
| Google profile verified | yes | no |

The lead relay rejects transactional requests for a non-bookable branch and
rejects inquiries when a branch is not accepting them. A Tampa inquiry creates
a Tampa lead, customer/property context and owner notification; it creates no
booking request, appointment, payment or quote.

## Public page

The page is a premium regional introduction, not a developer status page. It
describes the intended residential, commercial, church, property-management,
STR and realtor services; captures a service address and inquiry category; and
clearly says the request is not a confirmed appointment.

## SEO launch stages

1. **Setup / current:** page visible with `noindex, nofollow`, no sitemap entry.
   Use it for direct conversations and referrals while capacity is unverified.
2. **Approved-to-launch:** page remains noindex until the owner approves actual
   service-area coverage, staffing and fulfillment. Add unique regional content
   and accurate availability wording.
3. **Live:** only after fulfillment, scheduling, pricing, tax and contact paths
   are verified. Remove noindex and add the page to the sitemap if it offers
   genuine regional value.
4. **GBP:** create a separate Tampa profile only after a real staffed operating
   presence and distinct service area are documented. Never use a virtual office
   or borrowed address.

## Owner/accountant gates

- Verify Hillsborough/Pinellas county and municipal business-tax requirements.
- Confirm commercial cleaning tax registration and county surtax handling.
- Confirm insurance coverage for Tampa Bay work and any client certificate needs.
- Approve Tampa labor, travel, parking/toll, minimum-job and overhead assumptions.
- Confirm actual staffing, equipment, transport and backup coverage.
- Approve customer agreements and local contact arrangements.
- Approve any Google Business Profile activation.

## Not claimed

No Tampa service date, price, address, local phone, GBP, staff count or
credential is invented by this page or the inquiry workflow.

## Pricing preparation

Tampa has its own immutable `pricing_versions.branch_id` space and may be
published internally before public launch without changing Pensacola. The first
Tampa draft should be created from the current Pensacola/source baseline in
Pricing & Estimator Control, reviewed, and published. Public `/api/pricing` still
refuses Tampa until the branch is bookable.

## Booking-activation blockers

A public booking toggle cannot be honestly enabled by this static site alone.
The remaining code-level blockers are:

- Tampa has no branch-specific public estimator route using Tampa travel origin.
- The server travel engine currently reads one global `TRAVEL_ORIGIN`.
- Public booking/scheduling/confirmation still assumes the Pensacola branch.
- Static Tampa SEO/indexing cannot be flipped at runtime without a deployment or edge-rendered page.

The owner/admin can prepare Tampa pricing, service territory, inquiry routing and
staffing now. Full booking activation requires a branch-aware estimator/travel
and scheduling implementation; a decorative ON switch would violate the
no-misleading-availability rule. This is reported as a genuine blocker, not
silently bypassed.

## Initialized Tampa price book

- Pricing version ID: `pricing_c34908dd-dcbc-42c7-8a2e-e007f6d1a4bb`.
- Branch: `branch_tampa`, version 1, status `published` (internal).
- Fingerprint: `2026-10-25.engine-calibration-supportive-tax.v1.49705bdc08ec90b4`.
- Initial values match the Pensacola/source baseline; Pensacola has no separate published version and remains on the same source baseline.
- Public `/api/pricing?branch=branch_tampa` still returns 404 because Tampa is not bookable.

## Approved regional coverage and travel policy - 2026-11-20

- Approved counties: **Pasco, Pinellas and Hillsborough, Florida**.
- Coverage registry: **132 ZCTAs** derived from the 2020 Census ZCTA-county relationship file for county FIPS 12101 (Pasco, 33), 12103 (Pinellas, 49) and 12057 (Hillsborough, 59); ZIPs crossing county lines are included.
- Default one-way travel limit: **20 miles**.
- The production branch row now carries the 132-ZIP registry and three counties.
- The exact operating origin is intentionally unset; no coordinates or starting address were invented.
- County membership is not the same as bookable driving-distance eligibility. Until a real origin is configured, Tampa public booking remains disabled.

## Operating origin and readiness closeout - 2026-11-20

- Migration `0042_branch_origins.sql` adds private origin coordinates, Google Place ID and a one-way travel limit per branch.
- The owner Branches & Launch form now supports a verified origin and readiness checklist.
- Tampa remains non-bookable. The static capability report still shows missing public estimator, scheduling, payments, pricing and fulfillment capabilities.
- No Tampa origin was invented; production origin values remain unset.

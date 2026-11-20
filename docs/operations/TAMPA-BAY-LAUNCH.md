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

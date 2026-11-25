# Admin Sales & Marketing Center — Planned Enhancement

**Status:** planning only. No marketing rebuild was started during the legal
approval and signing release.

The admin navigation now uses department groups: Overview, Operations, Sales &
Marketing, Finance, Documents & Compliance, and System & Security. Existing
marketing functions remain available under Sales & Marketing (Leads & Inquiries
and Promotions & Discounts).

## Reuse, do not replace

The Marketing Center must reuse the existing sources of truth:

- `src/config/marketing-links.ts` — UTM and QR registry.
- `docs/marketing/` — growth system, content engine, platform operating plan,
  scorecard and campaign playbooks.
- `src/lib/analytics/events.ts` — closed event taxonomy and allowlisted payloads.
- Existing lead pipeline, attribution records and booking/revenue data.
- Existing promotions and referral systems.

No replacement UTMs, duplicate campaign registry or parallel analytics system
may be created.

## Modules and release order

1. **Overview** — campaigns, leads, bookings, revenue attribution and open
   follow-ups from existing records.
2. **Campaign manager** — named campaigns linked to existing UTM registry
   entries; no free-text replacement of the registry.
3. **Saved UTM link builder** — selects an existing registered destination and
   campaign; writes only to the registry, then regenerates documented links/QRs.
4. **QR campaign generation** — reuses the existing QR generator and decode
   verification.
5. **Lead pipeline** — existing leads grouped by stage, source, campaign and
   service; no new lead store.
6. **GA4 conversions** — surfaces existing GTM/GA4 event configuration and
   receipt status; never injects a second Google tag.
7. **Booking and revenue attribution** — joins existing campaign/UTM records to
   existing bookings and invoices.
8. **Content and social planning** — links to the existing content calendar and
   platform operating plan rather than duplicating them.
9. **Promotions and referrals** — existing promotion inventory and eligibility
   rules; no new pricing authority.
10. **Performance reporting** — existing weekly scorecard and lead measurement
    model.

## Guardrails

- No analytics event before consent.
- No customer name, email, phone, address, ZIP, photo or form content in
  analytics payloads.
- No invented UTM values, campaign results, revenue or conversion claims.
- Marketing UI state is never authorization.
- No billable service or new dependency without owner approval.

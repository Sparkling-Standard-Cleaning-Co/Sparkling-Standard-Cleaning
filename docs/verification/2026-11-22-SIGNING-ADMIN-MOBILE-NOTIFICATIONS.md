# Signing, Admin Documents, Notifications and Mobile — Local Verification
**Date:** 2026-11-22
**Branch:** `release/2026-11-22-legal-signing-acceptance`
**Start HEAD:** `ac94bab`
**Production content baseline:** tree identical to `origin/production-safe` `3e48739`
**Deployment:** NOT deployed. No production migration, charge, refund, or customer message was performed.

## What changed

### 1. Operational notification routing
- Added owner-controlled event routing for booking requests, booking payments,
  payments, document signing requests, executed agreements and document
  revisions.
- Website booking/reservation leads now go to **Bookings** and, by default,
  **Owner**; contact messages go to **Customer Service** and **Owner**.
- Photo attachments are sent to every configured department recipient.
- Resend failure falls back to Web3Forms; successful department delivery keeps
  the lead successful.
- Each department delivery is recorded in `notification_delivery_events`.
- Existing stored Communications settings remain valid when new events are
  added, because missing event keys use their approved defaults.
- Manual booking confirmations/changes now notify Bookings.
- Paid estimates/gifts notify Bookings/Billing/Admin as configured.
- Executed agreements notify Admin and Owner with the private executed copy
  attached. Secure signing tokens are never included in internal notices.

### 2. Packet integrity
- Bundle resolution now requires at least one owner-approved template.
- Empty active packets are never routed, never shown as ready, and cannot be
  selected for sending (`packet_has_no_documents`).
- System starter packets (`packet.*`) are separated from service packets in
  the admin UI and cannot override a real `customer.*` / `employee.*` packet.
- Packet counts now include approved and required document counts.
- Compatibility fallback preserves operation before migrations 0038/0039.

### 3. Admin Documents & Agreements
- Rebuilt into seven subviews: Overview, Send for Signature, Signing Requests,
  Document Library, Packets, Versions & Updates, Settings.
- Overview shows awaiting signature, completed, expired, ready packets,
  packets needing documents, updated agreements and recent activity.
- Guided send flow searches customers by name/email/phone/company, loads the
  customer's properties and recent reference/date/price, auto-selects the
  service packet and never requires raw `cust_`, `prop_`, `team_` or packet IDs.
- Requests list is searchable and filterable, uses human-readable packet names
  and shows verification attention.
- Existing templates, packet builder, revision review and re-signing queue are
  reused; no duplicate document backend was introduced.

### 4. Customer signing ceremony
- Replaced the narrow signing page with a wide, mobile-first three-step flow:
  confirm details, access/instructions, review and sign.
- Customer, property, service, date, window, price and payment terms are loaded
  from the verified request.
- Service-specific access choices are required where applicable (`access_method`),
  with entry/parking instructions, contact, pets, restricted areas and other
  instructions.
- Customer enters their legal name once and adopts one typed or drawn signature
  for all selected documents. Each required document has its own affirmative
  acknowledgment; optional documents are never preselected.
- E-sign consent remains a separate unchecked choice.
- Customer fields are stored in `signing_requests.customer_fields_json`
  (migration `0052_signing_customer_fields.sql`), included in the executed text
  record and executed PDF under **Customer Instructions and Access Schedule**,
  and covered by the executed-copy hash.
- **Migration 0052 is not applied to production.** Signing still works without
  it because the write is guarded, but the customer schedule will not persist
  until the migration is applied.

### 5. Mobile
- New signing layout tested at 390 px with no horizontal overflow.
- Admin mobile navigation is now a compact horizontal scroller instead of a
  multi-row wall; form inputs, buttons, tables and document tabs have larger
  touch targets.
- Public-site browser suite still passes at its existing mobile checkpoints.

### 6. Master Folder
- Authoritative workspace confirmed:
  `C:\Users\thoma\Downloads\SPARKLING STANDARD - MASTER`.
- 66 residential routes / 4,241 addresses / 3,892 owner-occupied verified from
  `routes_summary.json`.
- 800 commercial prospects / 56 routes / 192 Priority A verified from
  `all_prospects.csv`, `priority_a.csv` and `route_index.csv`.
- Print-ready business-card kit copied unchanged from
  `C:\Users\thoma\Downloads\Door Knocking` into
  `02 BRANDING & DESIGN\Business Cards & Print Files`.
- `00 START HERE\START-HERE.html` rebuilt with direct route, print, legal,
  department, report and live-system links.
- `00 START HERE\Quick Access` contains working Windows shortcuts.
- `99_LEGACY_OBSOLETE_OLD` created as the single historical landing area with
  links only. No active file, agreement, backup or script dependency was moved
  or deleted.
- All 42 local links in the rebuilt Start Here resolve.

## Verification actually run

| Check | Result |
| --- | --- |
| `npm test` | **1,044 tests: 1,043 pass, 1 pre-existing skip, 0 fail** |
| `node --test "tests/browser/*.test.mjs"` | **253/253 pass** |
| `npm run check` | **0 errors, 0 warnings, 2 hints** |
| `npm run build` | **40 pages built** |
| `npm run validate` | **passed** (SEO, links, marketing registry/QR, GTM artifacts, checklist leak) |
| `npm run smoke` | **21 pages passed** |
| New signing UX browser test | **pass** at 390 px with one legal name and one adopted signature |
| Focused notification tests | **pass** (routing, delivery records, fallback) |
| Focused packet tests | **pass** (empty packet rejected, no ready state, no routing) |
| Start Here local links | **42/42 resolve** |

## Deliberately not done

- No production deployment.
- No production D1 migration (including `0052`).
- No live Stripe charge or refund.
- No live email sent to a customer or department inbox; the Communications
  Center owner test remains the controlled way to verify inbox receipt.
- No commercial/facility Pay Now activation. Facility instant payment remains
  disabled and returns `facility_payment_not_activated`.
- No commercial/church/STR/property-management/specialty packet activation.
- No automatic staff-assignment notification was added; the existing
  `staff_assignment` routing key is reserved for that work.
- No agreement-declined/expired notification was added; no decline endpoint
  exists.
- No Marketing Center implementation; the existing plan and UTM/QR systems were
  left intact.

## Known residual gaps

1. Apply migration `0052_signing_customer_fields.sql` in the authorized release
   window before relying on persisted customer access schedules in production.
2. Confirm real inbox receipt for Bookings, Admin, Owner and Customer Service
   using the owner-controlled test message.
3. Complete the facility/commercial acceptance run before enabling facility
   online payment or activating their packets.
4. Complete staff-assignment notification wiring if desired.
5. The full public mobile audit beyond the existing passing browser suite was
   not repeated page-by-page; signing and admin were the focus of this pass.

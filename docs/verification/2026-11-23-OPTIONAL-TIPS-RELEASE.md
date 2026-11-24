# Optional Invoice Tipping — Production Release 2026-11-23

**Commit:** `46994ea` on `production-safe`
**Cloudflare Pages deployment:** `9a36f399-e320-4034-900d-9910af3cc76e`
**Production database:** `sparkling-standard-operations` (`82af5623-e4a0-48c5-b5da-b3aea5e84105`) at 56 migrations

## Implemented

- Branded `/invoice-pay/` customer page with service balance, optional gratuity,
  final total and secure Stripe handoff.
- Initial selection is always **No tip**; suggestions $10/$15/$25 and a custom
  amount are optional. No tip has no extra confirmation and is clearly stated not
  to affect service, review or receipt.
- HMAC-signed, invoice-bound links (`invoice` and `tip` modes, 30-day default).
  `TIPS_LINK_SECRET` is configured in production; `STRIPE_WEBHOOK_SECRET` is a
  fallback only.
- Existing unpaid invoices work by emailing/regenerating the secure payment page
  link. No new invoice or immutable session needs to be created first.
- Stripe Checkout receives separate server-calculated line items for the service
  balance and gratuity, with `service_amount_cents`, `tip_cents` and
  `checkout_kind` metadata. The browser cannot set the service amount.
- Tip-only sessions (`invoice_tip`) require a fully paid invoice and completed
  appointment when an appointment is linked; they never include a service line.
- Webhook processing is idempotent by Checkout Session ID, settles only the
  service portion on the invoice, records the gratuity separately, and clears
  the session reference safely.
- Added `payments.service_cents`, `payments.tip_cents`,
  `payments.tip_refunded_cents`, refund split columns and the additive
  `tip_allocations` table.
- Equal allocation among actual timekeeping participants with deterministic cent
  remainder. Unrecorded participation remains visibly unallocated until finance
  confirms the participating cleaners.
- Admin invoice detail shows collected/allocated/unallocated/refunded gratuity,
  Stripe reference, participant allocations, and a confirmation form for
  unallocated tips. Paid invoices can generate a secure tip-only link.
- Invoice email explains the optional gratuity and defaults to $0.00.
  Receipts show the gratuity separately; review email support includes an
  optional tip link without conditioning or gating the review.
- Refunds recompute service and gratuity portions; a full refund reverses the
  gratuity allocation and restores only the service balance.
- `/invoice-pay/` is noindex and excluded from the sitemap and SEO validator's
  indexable set.

## Verification

- Unit: **1,093 tests (1,092 pass, 1 pre-existing skip)**.
- Browser: **270/270 pass**.
- `astro check`: **0 errors, 0 warnings** (10 pre-existing hints).
- Build: **41 pages**; validation: **2,631 internal links** across 41 pages; SEO,
  marketing/QR, GTM artifacts and checklist leak checks pass.
- Smoke: 21 pages.
- `tests/tips.test.ts` covers: token tampering/expiry, existing unpaid invoice,
  $275 service + $0 tip, $275 + $25 tip, custom cents, changing to zero,
  tip-only prepaid, service-charge protection on unpaid invoices, equal
  deterministic split, unallocated crew, full refund reversal, exact Stripe line
  items/metadata, public endpoint view and tampered token rejection.
- `tests/browser/invoice-tipping.test.mjs` covers default zero, suggestions,
  custom amount, returning to zero, final total, tip-only page, no-tip close and
  390px mobile layout.
- No automated test contacted live Resend or charged a card.

## Production migration

- Pre-migration D1 export:
  `C:\Users\thoma\AppData\Local\Temp\opencode\sparkling-pre-tips-20261123-183613.sql`
  (1,999,014 bytes, SHA-256
  `938187218B28C210B5B22A77EDA1D44BDC0C2EA0E094322C5B014DB8E7BD44E9`).
- Backup is outside the repository. Migration `0056_optional_tips.sql` applied
  remotely after the backup.
- Post-migration: **56 migrations**, `tip_allocations` table present, **0** tip
  rows, **1** existing payment backfilled to service revenue, **0** existing
  tips. `PRAGMA foreign_key_check` is verified in the release closeout.

## Live verification

- Production admin asset:
  `/_astro/index.astro_astro_type_script_index_0_lang.CvXkixHI.js` (matches the
  locally verified build).
- `/invoice-pay/?token=invalid` returns the noindex page with the safe invalid
  link message.
- Real production invoices (existing $5 diagnostic invoices) were queried
  read-only through signed links:
  - Open invoice: balance 500, `tipOnly=false`, default tip **0**, suggestions
    $10/$15/$25.
  - Paid invoice with `tip` mode: balance 0, `tipOnly=true`, default tip **0**,
    suggestions $10/$15/$25.
- `/api/estimate-checkout`: enabled, live mode, recurring scheduling true.
- `/api/booking-status`: ok, calendar connected.
- No live Stripe session, charge, refund, customer email or invoice mutation was
  created by verification. Francesca's invoice/customer was not touched.

## Operational note

The owner should regenerate the invoice email/payment page link for any invoice
issued before this release. The link now opens the optional-tip page; old Stripe
URLs that were already emailed remain valid at the original amount but do not
offer tipping.

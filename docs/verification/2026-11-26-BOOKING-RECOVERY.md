# Booking and Pay Now Recovery — 2026-11-26

## Release identity

- Production application baseline: `bbfd119` (application code `00b8376`).
- Recovery commit: `79929b4` on `main` and `production-safe`.
- Incident migration: `0068_booking_service_area_repair.sql`.
- Migration run: [45874286853](https://github.com/Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning/actions/runs/45874286853), applied before deployment.
- CI run: [45874423041](https://github.com/Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning/actions/runs/45874423041).
- Final backup run: [45875757206](https://github.com/Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning/actions/runs/45875757206).

## Root causes

1. **Pensacola ZIP 32534 was not serviceable.** It was absent from the public ZIP
   reference and from production `branches.service_area_json`. The public
   availability endpoint therefore returned
   `service_area_inquiry_required` with no calendar days.
2. **Server verification used a different geocoder authority than the customer.**
   For a Pace, FL 32571 address, the customer-confirmed Google pin and the
   server's Census/MapMap result differed by roughly 4.7 km. Server verification
   classified the pin as divergent and rejected the quote as `quote_not_verified`,
   surfaced to the browser as `quote_not_payable`. The travel route itself and the
   price were valid.
3. **The browser treated `quote_not_payable` as permanent,** so the customer could
   not retry after a recoverable verification disagreement.

The existing `5134 hamilton br` failure record and the production diagnostics in
run `45869377028` established causes 2 and 3. Live availability for 32534
established cause 1.

## Changes

- Added ZIP `32534` to `src/config/geography.ts`.
- Added migration `0068` to append `32534` to the Pensacola branch service area.
- Server verification now prefers a precise Google geocode when
  `GOOGLE_MAPS_SERVER_API_KEY` is configured, matching the address authority the
  customer selected, and falls back to MapMap/Census when it is unavailable.
- Browser payment failure handling now keeps `quote_not_payable` recoverable,
  shows a reason-specific explanation, preserves the saved request and permits a
  fresh secure-payment attempt.
- Added `scripts/check-source-integrity.mjs` to the build preflight. It rejects
  invalid UTF-8, mid-file BOMs, Git conflict markers, control characters,
  malformed JSON and runtime mojibake. Repaired three test files that contained
  accidental mid-file BOMs.
- Quick Estimates now display the initial Deep Cleaning and ongoing maintenance
  as separate calculations, show crew count and labor/site time, provide a
  crew-planning table and invalidate a saved quote when inputs change.
- Manual booking availability uses the quote's crew-derived on-site duration, so
  Quick Estimate planning and actual booking scheduling agree.

## Verification

- `npm run check`: 0 errors, 0 warnings.
- Unit suite: **1,169 tests, 1,168 pass, 1 pre-existing skip, 0 fail**.
- Browser suite: **289/289 pass**, including a new regression proving a
  `quote_not_verified` failure leaves Pay Now retryable.
- `npm run verify`: integrity gate passed, 41 pages built, 2,636 internal links
  resolve, SEO/marketing/QR/checklist checks passed.
- Production D1: **68 migrations**, **124 tables**, foreign-key check clean.
- Live `/api/availability-month` for ZIP 32534 now returns
  `enabled:true`, `branch:"branch_pensacola"` and live morning/afternoon slots.
- Live production serves the recovery browser behavior
  (`EstimateWizard...d2tgSEsR.js`) and the new Quick Estimate crew field.
- Complete encrypted backup: `sparkling-standard-backup-2026-11-26T18-26-06-complete.ssbk`,
  249 files, 10,981,220 bytes, SHA-256
  `44212718a01de2e6705ad7e858ed4f695fdccd954dbdb464ddf00ced1aa5b038`;
  R2 and OneDrive verified; isolated restore 123 tables / 68 migrations.

## Residual and owner action

- No live booking, payment, charge, refund, customer email nor test-mode Stripe
  transaction was created during this verification. The local environment has no
  Stripe test-mode secret or webhook secret, and production Stripe is live.
- A full test-mode Checkout acceptance run requires owner-provided test-mode
  credentials or explicit authorization to create and abandon a synthetic live
  Checkout Session.
- The configured Cloudflare API token returns HTTP 403 for Pages reads
  (workflow `45875649075`), so the Pages deployment ID cannot be retrieved. Live
  asset identity and rendered behavior were verified instead.
- Unfinished public-website refinements remain isolated on local branch
  `wip/public-website-refinements-2026-11-26` and were not deployed.

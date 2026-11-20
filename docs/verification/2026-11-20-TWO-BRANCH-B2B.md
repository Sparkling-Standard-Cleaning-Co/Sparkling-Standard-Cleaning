# Two-branch topology and B2B launchpad verification - 2026-11-20

## Scope

- Branch operating model for Pensacola (live) and Tampa Bay (setup/prelaunch).
- Branch-scoped immutable pricing versions.
- Owner branch view and branch setup/launch control.
- Public Pensacola branch page and noindex Tampa prelaunch page.
- Commercial/institutional campaign launchpad in the Windows master workspace.
- No new public price, booking, payment, GBP or legal approval was created.

## Production database

- Pre-migration encrypted D1 export created and verified:
  - `sparkling-standard-backup-2026-11-20T04-36-41.ssbk`
  - SHA-256 `5a382befc8a8fd8ddf55cc8ae3bd9b0de573b4ec290446584958617cd60407e2`
  - 1 file, database integrity `ok`, 79 tables.
  - Uploaded to private `sparkling-standard-backups` R2.
- Migration `0040_branch_topology.sql` applied to production D1.
- Verified:
  - Pensacola `lifecycle_status = live`, `public_slug = pensacola`.
  - Tampa Bay `lifecycle_status = setup`, `public_slug = tampa-bay`, status inactive.
  - `pricing_versions.branch_id` exists with per-branch published uniqueness.
  - `branch_config_versions` exists.
  - customer/appointment/invoice/payment counts remained 8 / 14 / 2 / 1.
  - `PRAGMA foreign_key_check` returned no rows.
- No production price version existed before or after; the source baseline remains
  active for Pensacola.

## Repository implementation

- `src/config/branches.ts`: canonical IDs, lifecycle, public/service modes.
- `src/lib/branches/registry.ts`: effective branch, bookability gate, server
  branch resolution.
- `src/lib/branches/settings.ts`: owner setup validation, immutable config
  versions, live-launch prerequisites.
- `functions/api/admin/branches.ts`: owner-only setup API.
- `src/lib/admin/branch-view.ts` + `operations.ts`: owner All/Pensacola/Tampa
  narrowing cookie; staff branch assignment remains authoritative.
- `src/lib/pricing/store.ts` + `server.ts`: per-branch pricing versions.
- `functions/api/pricing.ts`: public pricing only for a bookable branch; Tampa
  returns 404.
- `functions/api/admin/pricing.ts` + `src/scripts/pricing-admin.ts`: branch
  selector, per-branch draft/publish, Tampa publish lock.
- `functions/api/lead.ts` + `lead-persistence.ts`: server-resolved branch,
  branch-aware lead/customer/property/estimate persistence, Tampa
  transactional rejection.
- `src/lib/admin/manual-booking.ts`: uses the branch pricing snapshot.
- Public pages: `/locations/pensacola/` indexable; `/locations/tampa-bay/`
  noindex and excluded from the sitemap.
- Admin: Branches & Launch screen and header branch view.

## Tests

- `tests/branch-topology.test.ts`: 4 pass.
- `tests/pricing-control.test.ts`: 11 pass.
- `tests/admin.test.ts`: 40 pass.
- Full unit suite: **907 tests, 906 pass, 1 pre-existing skip, 0 fail**.
- Browser suite: **228 pass** (after the admin phone overflow repair).
- `astro check`: 0 errors, 0 warnings, 2 pre-existing hints.
- Build: 37 pages.
- `npm run validate`: pass (2331 internal links, SEO, QR, GTM, checklist).
- Public sitemap includes Pensacola and excludes Tampa Bay.

## B2B campaign output

- Master path:
  `C:\Users\thoma\Downloads\SPARKLING STANDARD - MASTER\09 BUSINESS & INSTITUTIONAL SALES`
- 14 modules, six print-ready Pensacola one-pagers, Tampa prelaunch interest
  page, scripts, checklists, pipeline, 30/60/90 plan and QR assets.
- Linked from the master `00 START HERE\START-HERE.html`.
- Generator: `scripts/b2b-campaign/generate.mjs`.
- No fake prospect, testimonial, certification, price or Tampa service claim.

## Remaining owner gates

- Deploy this code and verify the production branch API/UI.
- Review Tampa labor/travel/tax/licensing/insurance assumptions.
- Decide whether/when Tampa is eligible for a GBP.
- Supply R2 S3 credentials for application-object backup and scheduled backup.
- Obtain counsel/owner approval for legal templates.
- Perform an authenticated owner walkthrough of branch switching, Quick
  Estimate and packet signing.

## Production deployment

- Application code: `1d7c997`.
- Cloudflare Pages production deployment: `c6469de6-bf79-407c-a2a4-3f54c4051d35`.
- Migration `0040` was applied to production D1 after the verified pre-migration
  backup and before this deployment.
- Live checks: `/locations/pensacola/` returns 200 and is in the sitemap;
  `/locations/tampa-bay/` returns 200 with `noindex, nofollow` and is absent
  from the sitemap; unauthenticated `/api/admin/branches` returns 401;
  `/api/pricing?branch=branch_tampa` returns 404.
- CI `validate` and `browser` pass.

## Tampa Bay public inquiry addition

The same production release also replaces the Tampa technical prelaunch page with a premium regional page and a dedicated inquiry form. It captures residential, commercial, church/facility, property-management, STR and realtor interest plus the service address. The server persists the inquiry to `branch_tampa` and creates no booking, quote or payment. Tampa remains noindex and not publicly bookable. See `docs/operations/TAMPA-BAY-LAUNCH.md` and `docs/verification/2026-11-20-REVIEWS-FOOTER.md`.

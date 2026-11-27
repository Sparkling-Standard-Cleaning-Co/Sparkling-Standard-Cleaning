# 2026-11-27 Careers branch presentation and payment-cost review

Baseline: `eda4c49` on `production-safe`, `main` and `origin/main` (identical, clean tree).

## Scope delivered

### Careers: Pensacola-only now, two-branch presentation when Tampa is live

- The public `/careers/` page now presents Pensacola only while Tampa Bay is `setup`/inactive.
  The "Now recruiting" card says Sparkling Standard is recruiting in Pensacola and the
  surrounding communities. Tampa Bay, future-interest, inactive-branch and prelaunch language
  was removed from the public Pensacola view.
- A second presentation is built into the same static page for use when Tampa becomes publicly
  live: a combined Pensacola/Tampa Bay recruiting card, separate Pensacola and Tampa Bay pay
  groups, separate opportunity groups, and Tampa/Either branch options in the application form.
- Shared components avoid a duplicated page: `CareersRecruitingCard.astro`,
  `CareersPayRates.astro`, and `CareersOpportunityGroup.astro`. The page, form, data and API
  remain a single recruitment system.
- `functions/_middleware.ts` selects the presentation from the authoritative `branches` row on
  every production request via `tampaPubliclyEnabled()` and
  `applyCareersBranchVisibility()`. Activating or deactivating Tampa in Branches & Launch changes
  the live Careers presentation without a rebuild or redeployment; a missing database or failed
  query fails closed to Pensacola only.
- `functions/api/careers-application.ts` rejects a Tampa application with `branch_unavailable`
  while Tampa is not `live` + `active`. The check runs before duplicate detection, resume storage,
  database insertion or email delivery. Historical applications and administrative records are
  untouched.
- `functions/api/careers-options.ts` withholds Tampa pay rates, opportunities and the Tampa branch
  flag while Tampa is not public. When Tampa is live it returns both branches, and the page script
  refreshes each branch's pay and opportunity status from the existing admin controls.
- `/careers/` canonical URL, sitemap entry and existing SEO configuration are preserved. The
  two-branch title/description are applied by the same middleware only while Tampa is live.

### Payment processing cost recovery

- No surcharge, fee, price, checkout, gift-certificate, ledger or webhook behavior was changed.
- The required investigation and the owner-approval alternative are recorded in
  `docs/operations/PAYMENT-COST-RECOVERY.md`.
- Finding: the existing Stripe-hosted Checkout architecture cannot identify card funding
  (credit/debit/prepaid) before authorization, so it cannot safely apply a credit-card-only
  surcharge. Stripe's surcharge options are a public-preview PaymentIntent API or a private-preview
  Checkout automatic-surcharge feature that requires a third-party provider app. A compliant
  surcharge also needs Florida/Alabama legal review, 30-day Visa/Mastercard/acquirer notice,
  point-of-entry and checkout disclosures, a receipt line, cancellation after disclosure, refund
  handling and debit/prepaid exclusion.
- Recommended owner alternative: one advertised price that includes processing cost, preserving
  the full gift-certificate face value. Example at the published Stripe standard rate
  (2.9% + $0.30): a $100 certificate would sell for $103.30 and still redeem at $100.00.
  No advertised price was changed; owner approval is required first.

## Verification

- Focused unit suites:
  `node --import ./tests/helpers/no-live-email.mjs --test tests/careers.test.ts tests/public-visibility.test.ts`
  — **16 tests, 16 pass, 0 fail**.
- Full unit suite: `npm test` — **1,218 tests, 1,217 pass, 1 pre-existing skip, 0 fail**.
- Full browser suite: `npm run test:browser` — **293 tests, 293 pass, 0 fail**.
- `npm run check` — **0 errors**, 11 pre-existing hints.
- `npm run build` — **41 pages**, source-integrity and estimator configuration gates passed.
- `npm run validate` — 2,676 internal links across 41 pages, SEO checks passed (37 unique
  titles), marketing/QR registry in sync, no internal checklist leak.
- `npm run smoke` — 21 pages passed.
- Careers visual/DOM verification at 390 px and 1440 px, Pensacola-only and simulated Tampa-live
  presentations: no horizontal overflow; Pensacola-only shows 0 visible Tampa elements, 1 pay
  group and 5 opportunity cards; the two-branch state shows the combined card, 2 pay groups and
  10 opportunity cards.
- Server-gate tests: a Tampa application is rejected with `branch_unavailable` and stores no
  record while the branch is inactive, then succeeds and records `branch_tampa` after the
  synthetic branch row is set to `live` + `active`. Public options omit all Tampa data until that
  state.

## Backup and migration

- No new migration is required for this release. Production remains at 70 applied migrations.
- The pre-0070 complete backup documented as independently verified
  (`sparkling-standard-backup-2026-11-27T08-31-37-complete.ssbk`) remains recoverable evidence.
- The pre-0070 D1 export was re-verified locally into an in-memory SQLite database:
  `backup-out/d1-pre-0070-20261127.sql`, SHA-256
  `d776f33628933015b5d30545c866e143bf41609e96f8db35e7d0b29f875b636`, 69 migrations, 127 tables,
  0 foreign-key violations, 14 customers / 20 properties / 21 appointments / 3 invoices / 52
  leads / 13 signing requests.

## Security and boundaries

- Tampa remains in prelaunch; no branch lifecycle, price, payment, customer, application,
  communication or financial record was changed by verification.
- No live charge, refund, booking, customer email or career application was created.
- The payment path is unchanged; the new documentation explicitly prohibits activation until
  compliance, network notice and technical requirements are satisfied.

## Release identity

- Application commit: `4206a2836e0db40aff5d6c7b4ee422efa3251dcb`.
- `main` / `production-safe`: both at `4206a28` (identical); pushed after the verified local build.
- CI `validate`: main run `46042742975` success and production-safe run `46042730795` success.
  The first main browser run hit one unrelated flaky admin-usability assertion under parallel
  load; the identical production-safe run passed and the failed job was rerun to green.
- Production: Cloudflare Pages served the release; the live `/careers/` page returns 200 with the
  Pensacola-only copy, no visible Tampa content, one pay group, five opportunity cards and the
  correct title. The live `CareersForm` asset `BVsymzj0` contains the new `branch_unavailable`
  guard. Live `/api/careers-options` returns `branches.tampa:false` and Pensacola-only
  opportunities. Live visual checks at 390 px and 1440 px show no horizontal overflow.
- The Cloudflare deployment ID was not retrieved; live asset identity and response behavior were
  used instead. No migration was applied and no checkout/payment code changed.

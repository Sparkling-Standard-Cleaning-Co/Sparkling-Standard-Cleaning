# Post-dispatch production closeout - 2026-11-20

## Baseline

- Starting HEAD: `ce85e47` (documentation closeout); application code `9c4b49a`.
- Prior production deployment: `5162c0c2-6e3e-4c75-b02d-1b80b1e5398a`.
- Migrations `0001`-`0041` applied; `0042_branch_origins.sql` applied during this closeout.
- Untracked owner files preserved: `docs/research/` and
  `public/brand/Elegant Gold S Floral Emblem.png`.

## Implemented

### Dispatch readiness and configuration

- Dispatch readiness now reports exact blockers for every employee:
  inactive/not bookable, missing service or equipment qualifications, unknown transport,
  missing verified origin, missing workdays and missing employee onboarding documents.
- The employee profile panel shows a readable readiness checklist and missing document titles.
- Existing dispatch automation, owner approval, pause, concurrency and privacy controls are preserved.
- Production dispatch remains analysis-only, disabled and paused. `team_hayli` is not dispatch-ready
  because services, equipment, transport and a verified origin are not configured.

### Branch operating origins and readiness

- Additive migration `0042_branch_origins.sql` stores private branch origin coordinates/Place ID and
  one-way travel limits.
- The Branches & Launch owner form now includes a Google Places-enabled verified operating origin,
  travel limit and a readiness checklist.
- Readiness distinguishes missing origin/contact/service area from real code-level launch blockers
  (public estimator, scheduling, payments, pricing, fulfillment and GBP).
- A branch cannot be advanced to `live` without a verified origin and a travel limit.
- Existing reservations and branch configuration versions are preserved; no branch was activated.

### Homepage positioning and SEO

- Homepage title updated to
  `Residential & Commercial Cleaning Pensacola, FL | Sparkling Standard`.
- Meta description now names office cleaning alongside residential, recurring, deep, move-out, rental
  and church cleaning.
- Canonical URL remains `https://sparkling-standard.com/`; no keyword stuffing or fabricated claims.

### Backup and recovery findings

- Existing encrypted archives remain untouched; no key was rotated and no archive was recreated.
- Existing verified archives include D1, master workspace and 88 R2 application objects.
- The 2026-11-20 OneDrive copy exists locally with matching checksums, but cloud synchronization has
  not been independently verified from OneDrive.
- The encryption key remains DPAPI-protected on this Windows account; an independent password-manager
  copy has not been verified.
- The GitHub backup workflow exists on `production-safe` but is not listed as an active workflow on the
  repository default branch (`main`). Scheduled automatic backups are therefore not established.

### Documents findings

- Production currently has **0 document templates, 6 packet definitions, 0 packet items and
  0 signatures**.
- The six packets are empty and visibly unconfigured; no customer or employee is required to sign an
  unapproved draft.
- Dispatch onboarding enforcement therefore does not create a false document blocker today. The
  dispatch readiness API still reports an employee onboarding blocker if a real approved requirement
  is later activated.

## Tested

- `npm run check`: 0 errors, 0 warnings, 2 hints.
- Unit suite: 935 tests, 934 pass, 1 pre-existing skip.
- Browser suite: 232 pass.
- Build: 37 pages.
- Validation: pass.
- New unit coverage includes branch migration compatibility and dispatch readiness/privacy.
- No live charge, customer message, employee notification or production data deletion occurred.

## Deployed / production verified

Recorded after deployment:

- Final HEAD `6ea55d7`; Cloudflare Pages production deployment
  `5a8e151b-a7fd-4eec-8622-231a197ebe0b`.
- GitHub CI `validate` and `browser` passed; unit **935** (934 pass, 1 pre-existing skip), browser
  **232** pass.
- Live homepage title is `Residential & Commercial Cleaning Pensacola, FL | Sparkling Standard`;
  canonical remains `https://sparkling-standard.com/`.
- Authenticated owner branch API: Pensacola is live, readiness passes with a warning that its origin
  is not configured. Tampa is setup and blocked by missing public phone/public service, pricing,
  public estimator, scheduling, payments and fulfillment; its origin and GBP are also not configured.
- Authenticated dispatch dashboard: analysis-only, automatic assignment disabled, emergency pause on,
  0 unassigned jobs, 0 automatic decisions, 0 dispatch-ready employees. `team_hayli` onboarding is
  satisfied but service, equipment, transport and origin are missing.
- Production document data: 0 templates, 6 empty packet definitions, 0 packet items, 0 signatures.
- Branch origins remain blank; no origin was invented.

## Still incomplete / owner action

1. **Tampa:** configure and verify the real Tampa operating origin, travel limit, staffing and
   eligibility; complete the branch-aware estimator/travel/scheduling path before activation.
   Pensacola also needs its explicit branch origin recorded (the existing environment origin remains
   the current travel source).
2. **Documents:** create and owner-approve actual templates, add them to the six packets, and complete
   the tiered signing policy before enforcing onboarding agreements.
3. **Backups:** copy the DPAPI key into an independent password manager, verify OneDrive cloud
   retrieval, add least-privilege R2/GitHub secrets and activate the backup workflow on the default
   branch.
4. **Dispatch:** complete Hayli's real service, equipment, transport, availability and verified origin
   profile, then run read-only analysis and activate only after reviewing exceptions.
5. **Admin pagination:** dispatch collections are bounded, but full server-driven pagination for all
   long admin lists remains a separate follow-up.

# AGENTS.md â€” Sparkling Standard Digital Operating System

Authoritative operating instructions for every AI engineering agent (OpenCode and similar)
working in this repository. Read this file fully before changing anything, then read the specific
documentation it links for the system you are touching.

If reality and this file disagree, **reality wins**: verify against the repository, the deployed
site and the owner's current instructions, then correct the documentation in the same session.

## Authority hierarchy

When instructions conflict, resolve them in this order:

1. **The owner's current, explicit instructions and approved business requirements.**
2. **Verified facts** from the current codebase, production configuration and actual platform state.
3. **Current architectural documentation and operating procedures** (this file and `docs/`).
4. **Historical instructions**, reconciled and corrected when superseded.

Never let outdated documentation override verified current information. Never treat a focused
hotfix instruction as the company's permanent engineering philosophy.

## Engineering philosophy â€” solve the problem completely

Sparkling Standard is engineered to an exceptional professional standard. The objective is the
highest-quality finished product that competes and grows, not the smallest possible diff or the
fastest possible completion.

**Solve the underlying problem, deliver exceptional quality, and avoid unnecessary work.**

Expected professional behavior:

- Do not stop at a superficial fix when the underlying defect remains.
- Do not avoid a necessary refactor merely because it touches multiple files.
- Do not preserve a poor user experience just because it technically functions.
- Do not reject a valuable improvement solely because it falls outside the narrowest reading of a task.
- Do not repeatedly patch symptoms of the same architectural defect.
- Do not claim visual quality based only on passing automated tests.

When a root cause requires coordinated changes across components, shared configuration, server
functions, tests and documentation, make those changes. When an adjacent problem materially
undermines the requested outcome, address it within the owner's authorized scope. At the same time,
distinguish valuable work from scope creep: do not add complexity for its own sake, do not redesign
unrelated pages, and do not churn working systems without a concrete quality or business reason.

### Quality dimensions for every meaningful change

- **Design & presentation** â€” premium visual execution, typography, spacing, responsive layouts,
  consistent branding, polished interaction states, finished details.
- **Customer experience** â€” fewer questions, clicks, scrolls and confusing states; no dead ends;
  conversion is exceptionally straightforward.
- **Engineering** â€” cohesive architecture, maintainable modules, strict typing, appropriate
  abstraction, minimal duplication, reliable error handling, clear responsibilities.
- **Accessibility** â€” keyboard operation, visible focus, readable errors, screen-reader support,
  properly sized mobile controls, WCAG 2.2 AA expectations.
- **Performance** â€” fast loading, efficient JavaScript, lazy loading where appropriate, correctly
  sized media, protection from layout shifts.
- **Security & privacy** â€” credentials, customer data, private operating coordinates, pricing
  integrity and analytics consent are protected; server-enforced where it matters.
- **Commercial effectiveness** â€” generate legitimate inquiries, communicate trust, explain
  differentiation honestly, remove friction from conversion.
- **Operational maintainability** â€” the owner or a future developer can understand and safely
  change the system without reverse-engineering it.

Passing tests is a requirement, not proof of quality. UI changes need visual browser verification.

## Project identity and current verified status

- **2026-10-21 owner decision implementation:** 46 decisions applied; public brand **Sparkling Standard**, legal entity **Sparkling Standard LLC**, slogan **Standards That Sparkle.** See `docs/verification/VERIFICATION.md` and the Business HQ workbook.
- Marketing, estimate and lead-capture website for **Sparkling Standard** (legal entity:
  **Sparkling Standard LLC**), an owner-operated residential and commercial cleaning company based
  in Cantonment, serving Pensacola, surrounding communities within about an hour of driving time
  from the private operating origin, and select nearby areas into Alabama.
- Repo: `Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning`. **`main` is the production
  branch and the site is LIVE** at `https://sparkling-standard.com` (Cloudflare Pages connected to
  GitHub; deployment settings live in the Cloudflare dashboard, not in this repository).
- Local dev: http://localhost:4321. Build output: `dist/`.
- **Budget: ZERO additional spending.** Prefer free, low-cost, usage-based, low-lock-in choices.
  Never add billable services, paid APIs, databases, CMS platforms or extra dependencies without
  explicit owner authorization.
- **Operational as of October 2026:** production deployment pipeline; MapMap geocoding + routing
  with the private `TRAVEL_ORIGIN` configured in Cloudflare; Web3Forms lead delivery (owner-
  confirmed); Cloudflare Turnstile optional; **GA4 analytics owner-confirmed operational**
  (`GTM-KSQ26HMG` / `G-LG222LQRQ2`; owner reports GTM Version 5, earlier Version 3 receipt of all
  three inquiry key events verified; new church/promotion event receipt pending); SMS enabled (`business.flags.smsEnabled: true`, owner-verified); Stripe Pay Now live-mode readiness true with no live charge test performed; twelve active profiles rendering (Google Business Profile, Facebook, Nextdoor, Instagram, TikTok,
  YouTube, Pinterest, Rumble, Gab, Parler, Locals, X);
  owner-approved circular logo and regenerated favicon/PWA/social assets installed (2026-10-19).
- **Current release (2026-11-26 final development and operational acceptance):** application code
  `00b8376` on `main` and `production-safe`, migration `0067_financial_accuracy_and_commercial_scheduling.sql`
  applied before deployment (67 production migrations, 124 live tables including `_cf_KV`, 0
  foreign-key violations). Checkout now omits the three owner-requested explanatory paragraphs while
  preserving Terms/Privacy consent, gift and promotion calculations, photo requirements, Community
  Support, Pay Now/Pay Later and mobile sticky actions; the statutory cancellation disclosure remains
  in `/terms/#cancellation-rescheduling`. Payroll now uses a weighted-average regular rate for mixed
  rate workweeks, includes compensable travel, paid breaks and nondiscretionary pay, respects
  branch time-zone workweeks (Chicago/New York), handles partial pay periods and week-boundary
  splits, rejects overlapping periods, invalidates stale calculations, verifies a source fingerprint
  before approval and locks approved periods. Commercial contracts preserve the signed proposal
  snapshot; first invoices reconcile recurring service, one-time charges, nonrecurring add-ons,
  discounts and tax to the signed first-invoice total; subsequent invoices advance one anchored
  billing period at a time without skipping; invoice creation and contract linkage are atomic.
  Accepted contracts can now be previewed and converted into recurring plans, Job Files, calendar
  events and invoices from **Admin -> Commercial Accounts -> Service schedule**, with facility
  scope, access instructions, crew size and required qualifications preserved. Verified: unit
  **1,167** (1,166 pass, 1 pre-existing skip), browser **288/288**, `astro check` 0 errors, 41 pages,
  2,636 links, smoke 21 pages; CI `45767562445` and `45767410634` green. Production migration run
  `45767421379` (67 migrations, 124 tables, 0 foreign-key violations) and live admin asset
  `index.astro_astro_type_script_index_0_lang.Dlpffw2w.js` SHA-256
  `6a4be9fd8e553dcd0157a352fdfff30a02a2ae39733d875a6955c26fce3f177a` matched the commit build;
  unauthenticated admin/employee APIs returned 401 and the live checkout rendered the removals.
  Final complete backup run `45767758027`: archive
  `sparkling-standard-backup-2026-11-26T06-23-17-complete.ssbk`, 10,818,232 bytes, 227 files,
  SHA-256 `afea23530af781970412453f6991f78a2a5831251db7ec3983e033cd292f41e`, R2 and OneDrive
  verified, isolated restore 123 tables / 67 migrations. Cloudflare Pages deployment ID was not
  retrievable because the configured API token returns 403 for Pages reads; live asset identity was
  verified instead. No live customer email, charge, refund, booking, signature, payroll
  disbursement, review invitation or public Tampa activation occurred. Owner action remains: rotate
  the backup Worker GitHub token to a fine-grained Actions-only token. Evidence:
  `docs/verification/2026-11-26-FINAL-DEVELOPMENT-ACCEPTANCE.md` and
  `docs/operations/MASTER-ACCEPTANCE-CHECKLIST.md`.
- **Prior release (2026-11-26 commercial, employee, payroll, training and Tampa readiness):**
  application code `106696d` on `main` and `production-safe` (identical), Cloudflare Pages production
  deployment `aa3da477-d130-426d-9dad-883bdcf6affb`, verified live. Migrations `0064`-`0066` add
  commercial proposals/contracts/facility contacts/walkthroughs, employee onboarding/training/quality/
  performance/time-off/payroll and the failed-email retry queue (66 production migrations, 123 live
  tables including `_cf_KV`, 0 foreign-key violations). Admin now has **Commercial Accounts** (custom
  multi-location proposals, server-calculated totals/tax/discounts, revisions/expiration, approved
  agreement packet + electronic signing, accepted-proposal contracts, Net 15 period invoices, facility
  contacts and walkthroughs) and **Employees & Payroll** (profiles, emergency contacts, wage rates,
  handbook, onboarding, shifts, time off, training, quality inspections, performance notes, payroll
  calculation/overtime/approvals/CSV). The employee portal adds training self-completion, shifts,
  approved earnings and time-off requests. Communications adds an owner retry/discard queue for failed
  provider emails and manager/finance role scoping; Google review automation was re-verified with
  requests disabled and no backlog flush. Tampa readiness now includes a server-derived checklist
  (staffing, manager, calendar, timezone, services, review URL, origin, travel limit, GBP) that blocks
  live activation until complete. Verified: unit **1,158** (1,157 pass, 1 pre-existing skip), browser
  **287/287**, `astro check` 0 errors, 41 pages, 2,636 links; migrations applied before deployment;
  unauthenticated new APIs return 401. No live customer email, charge, refund, booking, signature,
  payroll disbursement or public Tampa activation occurred. Owner action remains: rotate the backup
  Worker GitHub token to a fine-grained Actions-only token. Evidence:
  `docs/verification/2026-11-25-OPERATIONS-EXPANSION.md`,
  `docs/verification/2026-11-25-P0-RESIDENTIAL-CHECKOUT-CORRECTIONS.md` and
  `docs/verification/2026-11-25-COMMUNICATIONS-EXPANSION.md`.
- **Prior release (2026-11-25 centralized backup control and branch consolidation):** application code
  3881a8f on production-safe and main (identical, zero divergence), Cloudflare Pages deployment
  9b6f5cd7 with the current secrets, verified live on 2026-11-25. Admin -> Data & Storage is now the
  owner's single backup control center: owner-only/CSRF/MFA-step-up actions start complete or database
  backups in the background, monitor actual status, list encrypted archives, download through short-lived
  signed links, independently verify R2 and OneDrive, run isolated restore tests, and configure the schedule
  and retention. GitHub remains the execution engine; the owner never needs to open GitHub, Cloudflare or
  OneDrive for routine work. Added migration 0062 (62 production migrations, 107 tables), a dedicated
  backup Worker, the GitHub callback workflows, separate complete/database retention streams, and the existing
  encryption key and OneDrive authorization were reused without exposing values. Verified live: a complete
  backup (10,788,325 bytes, 227 files, R2 and OneDrive verified, isolated restore 106 tables), an admin
  download with SSBA1 encryption header, and an admin restore test. Unit **1,125** (1,124 pass, 1 skip),
  browser **282/282**, check 0 errors, 41 pages, 2,631 links, smoke 21 pages; CI 45688412800 green. The
  initial complete archive was superseded by the pre-fix same-day retention rule; no business records were
  lost, the 2026-11-21 archive remains, and a fresh complete archive was created after the fix. Evidence:
  docs/verification/2026-11-25-CENTRALIZED-BACKUP-CONTROL.md and
  docs/verification/2026-11-25-backup-control/ .
- **Prior release (2026-11-25 urgent scheduling and HOLIDAY15 correction):** application code
  `a0b94c8` (feature commit `bf2b81c`, display alignment `a0b94c8`) on `production-safe`,
  Cloudflare Pages deployment `643d14b8-2b4b-457c-9221-e1cec3d158ba`, verified live on
  2026-11-25. The compact hour/minute selector is restored; 7:00 and 7:15 AM are first-job
  starts when free, not displaced by origin travel or auto-selection. The Android-level root
  cause was `earliestStart = workdayStart + originTravel` for the first job of the day; travel
  now applies only after a real previous appointment. Operating hours are 7:00 AM-7:00 PM;
  migration `0061` updated the bookable resource end time. HOLIDAY15 and Community Support are
  independently scoped: HOLIDAY15 reduces the first-visit Deep Cleaning, Community Support
  reduces future recurring maintenance, and they never compound on one service line. The
  recurring regular/discounted rates, checkout amount, signing snapshot and recurring-plan
  price are server-derived and preserved. Verified: unit **1,124** (1,123 pass, 1 pre-existing
  skip), browser **282/282**, `astro check` 0 errors, 41 pages, 2,631 links, smoke 21 pages; CI
  `45672275769` green. Live availability for 2026-11-30 returned **7:00 AM and 7:15 AM** first;
  a live recurring estimator showed HOLIDAY15 `-$50.25` on a `$284.75` first visit and
  Community Support at `$220.00` per weekly visit vs `$245.00` regular. No live booking, hold,
  charge, email, customer record or signed agreement was created. Evidence:
  `docs/verification/2026-11-25-SCHEDULING-HOLIDAY15-CORRECTION.md`.
- **Prior release (2026-11-25 P0 customer fixes):** application code `ae77ac4` on
  `production-safe`, Cloudflare Pages deployment
  `53b472e6-7819-4da2-942e-bc5a0e91cede`, verified live on 2026-11-25. Public booking now exposes
  explicit 15-minute starts only inside the owner-defined Morning 7:00-8:30 AM and Afternoon
  12:30-2:30 PM windows, with unavailable starts visibly disabled instead of auto-selected;
  `/api/availability` and `/api/booking-hold` enforce the windows server-side. New recurring
  residential arrangements show "Your First Cleaning" with the calculated first-visit Deep
  Cleaning price and following-visit rhythm; the optional Deep Cleaning reset appears only after a
  one-time residential choice and never for recurring service. The signing access step derives the
  booking contact server-side and offers Same as my booking contact (verified name and phone,
  nothing retyped) or a different day-of-service contact, which requires name and phone and never
  overwrites the customer profile. A returning recurring customer whose first Deep Cleaning is
  already complete still has no authenticated public-estimator identity; that exception remains an
  owner policy decision. Verified: unit **1,121** (1,120 pass, 1 pre-existing skip), browser
  **280/280**, `astro check` 0 errors, 41 pages, 2,631 links, smoke 21 pages; CI `45653891203` green.
  Live availability for 2026-11-30 returned only 7:30-8:30 AM and 12:30-2:30 PM starts; a synthetic
  9:00 AM hold was rejected with `slot_outside_public_window`. No migration, customer email, charge,
  booking, hold or real signing request was created or modified. Evidence:
  `docs/verification/2026-11-25-P0-CUSTOMER-FIXES.md`.
- **Prior release (2026-11-24/25 platform completion, change orders and backup correction):**
  application code `aaa4c83` on `production-safe`, Cloudflare Pages deployment
  `9cea2813-c777-4dd6-97ab-f8e62c2ea845`, verified live on 2026-11-25 (served admin asset
  `/_astro/index.astro_astro_type_script_index_0_lang.DLPf6bre.js`). Migrations `0059` and
  `0060` add one-primary-invoice enforcement and signed service change orders. The Customer
  File now has jobs, payments, communications and one chronological activity timeline; the Job
  File adds crew, primary/supplemental invoices, payments, photos, communications, change orders
  and timeline. Change orders use the approved Additional Service and Add-On Authorization
  template, preserve the original agreement/invoice, require owner approval, support electronic
  signature and create one explicit supplemental invoice. Signing requests can be revoked, default
  to active, and no longer crash when a packet is missing or renamed. The master workspace was
  reconciled: the stale unspaced Downloads tree is a dated legacy archive, two duplicate scheduled
  tasks are disabled, the start page/README are corrected, and a retained-path duplicate manifest
  exists; no files were deleted. Backup status was corrected: the local Windows daily and weekly
  encrypted backups are verified (latest weekly: 2,595 files, D1 60 migrations/104 tables,
  independent OneDrive download hash matched, isolated restore passed, heartbeat recorded and stale
  incident resolved); the GitHub workflow is now visible on `main` but remains blocked by zero
  repository secrets. Verified: unit **1,118** (1,117 pass, 1 pre-existing skip), browser
  **279/279**, `astro check` 0 errors, 41 pages, 2,631 links, smoke 21 pages; CI `45518441282`
  green; 60 production migrations and 0 foreign-key violations. No customer email, charge, review
  invitation, production record or branch was mutated. Evidence:
  `docs/verification/2026-11-24-PLATFORM-COMPLETION.md`, `docs/verification/2026-11-24-PLATFORM-CONSOLIDATION.md`
  and `docs/audit/2026-11-24/`.
- **Prior release (2026-11-24 platform audit, document library and customer review suppression):**
  application code `2a95955` on `production-safe`, Cloudflare Pages
  deployment `103a481a-b6aa-4162-b2f1-e1654c964c55`, verified live on 2026-11-24 (served admin
  asset `/_astro/index.astro_astro_type_script_index_0_lang.alIZjPxx.js`). Migration `0058` adds
  `document_family_state` and `customer_review_state`. The Document Library now shows one current
  approved version per family (27 current documents; 3 draft revisions and 28 retired versions are
  separated into drafts and History & archive), with guarded draft deletion, family archive/restore,
  active-packet protection and transactional revision publish. Review eligibility is customer-level:
  reviewed, do-not-ask, opted-out, unknown and recently invited customers are not solicited again;
  invoice/PDF invitations are suppressed accordingly and failed deliveries can be retried. The
  Customer File gains a review relationship card and quick actions for booking, completed service,
  estimate, invoice, agreement, email and call. Production integrity is clean (0 foreign-key
  violations, 0 orphans, 0 duplicate invoice numbers, 0 duplicate per-appointment invoices) and
  record counts are unchanged. Verified: unit **1,114** (1,113 pass, 1 pre-existing skip), browser
  **278/278**, `astro check` 0 errors, 41 pages, 2,631 links, smoke 21 pages; CI `45504337889`
  green. The Leads workspace now defaults to active records and excludes archived, lost and
  converted inquiries unless explicitly selected. No customer email, charge, review invitation or production record was mutated. The audit
  also found the scheduled backup workflow absent from the default branch; that was resolved in the
  next release, and the local scheduled backup was confirmed operational. Branch cutover and
  permanent duplicate deletion still await owner approval. Evidence:
  `docs/verification/2026-11-24-PLATFORM-CONSOLIDATION.md` and `docs/audit/2026-11-24/`.
- **Prior release (2026-11-24 customer binding, review delivery and admin releases B/C):**
  application code `0e6fbf9` on `production-safe`, Cloudflare Pages deployment
  `451229c5-a69d-42c6-acc5-be0783f231bb`, verified live on 2026-11-24 (served admin asset
  `/_astro/index.astro_astro_type_script_index_0_lang.TfTE3bRT.js`). Repairs Quick Estimate
  customer switching so one context request loads canonical name/email/phone, only that
  customer's properties and saved house characteristics, with stale-response guards and
  server-side ownership checks. Adds owner **Send Review Invitation** for eligible completed
  jobs even while automation is off, delivery-event recording and an optional non-deployed
  review delivery worker. Completes admin Releases B/C: photo inventory/per-photo deletion,
  per-record legal-hold protection, real retention subjects, honest backup state, structured
  communications editor with labeled fields and readable errors, and removal of 240 mojibake
  sequences from admin text. Production reconciliation found **0** persisted Quick Estimates
  and **0** customer/property/job/invoice mismatches; the reported invoice is paid with a
  sent receipt but has **0** review requests because Pensacola automation is off. Verified:
  unit **1,106** (1,105 pass, 1 pre-existing skip), browser **277/277**, `astro check` 0 errors,
  41 pages, 2,631 links, smoke 21 pages; CI `45332084055` green. No customer email, charge or
  production record was mutated by verification. Evidence:
  `docs/verification/2026-11-24-CUSTOMER-BINDING-REVIEW-DELIVERY.md` and
  `docs/verification/2026-11-24-ADMIN-RELEASES-B-C.md`.
- **Prior release (2026-11-24 admin operations Release A):** application code `e970ce0` on
  `production-safe`, Cloudflare Pages deployment `b98bf961-091b-4d50-88b6-4d34f092b120`, verified live
  on 2026-11-24 (served admin asset
  `/_astro/index.astro_astro_type_script_index_0_lang.BoOU30tH.js`). Repairs alert affected-record
  navigation (signing requests and invoices now open the correct detail), replaces the Google Reviews
  manual appointment-ID form with a searchable completed-cleaning selector/status list/email preview
  and owner-gated queue hooks, and adds lead detail, archive, restore, protected disposable deletion,
  selection and bulk management. Verified: unit **1,101** (1,100 pass, 1 pre-existing skip), browser
  **275/275**, `astro check` 0 errors, 41 pages, 2,631 links, smoke 21 pages; CI `45319043262` green.
  No production lead, review email, document or customer record was mutated by verification. Evidence:
  `docs/verification/2026-11-24-ADMIN-RELEASE-A.md`.
- **Prior release (2026-11-24 invoice email step-up removal):** application code `c696c50` on
  `production-safe`, Cloudflare Pages deployment `96fa5ca0-7be0-4ffe-86d8-f0c0c028768d`, verified live
  on 2026-11-24 (served admin asset
  `/_astro/index.astro_astro_type_script_index_0_lang.CdcMTGKU.js`). Removes only the unnecessary MFA
  step-up from routine invoice email sending while preserving session, CSRF, permission, audit and all
  high-risk step-up controls (payments, refunds, credits, invoice creation/mutation, payment links,
  billing portal, receipt resend). Replaces the native email-code prompt with the branded confirmation
  dialog showing customer, recipient, invoice number, amount and payment-link inclusion, with Cancel /
  Confirm & Send, in-flight duplicate protection, retained retry idempotency keys and accurate success/
  failure messages. Verified: unit **1,100** (1,099 pass, 1 pre-existing skip), browser **274/274**,
  `astro check` 0 errors, 41 pages, 2,631 links, smoke 21 pages; CI `45310443021` green. Live production
  UI shows the branded dialog with zero native prompts. No live customer email, invoice mutation or
  charge was performed. Evidence: `docs/verification/2026-11-24-INVOICE-SEND-STEPUP.md`.
- **Prior release (2026-11-24 completed-job invoice repair):** application code `eb4d7a5` on
  `production-safe`, Cloudflare Pages deployment `ec52ed7b-4f72-41d0-9cee-812485e5d5d9`, verified live
  on 2026-11-24 (served admin asset
  `/_astro/index.astro_astro_type_script_index_0_lang.BWs9qs_3.js`). Repairs the P0 completed-job
  workflow: adds a branch-scoped `GET /api/admin/bookings?view=job`, a real completed-job detail view,
  working Open/Customer/Docs/Invoice calendar actions for jobs without a booking request, direct
  creation/opening of the $275 invoice from the existing completed job, and safe reuse of an existing
  completed job instead of a duplicate dead-end. Completed jobs no longer show Move/Cancel. Invoice
  creation remains idempotent and Finance opens the created invoice immediately. Verified: unit
  **1,099** (1,098 pass, 1 pre-existing skip), browser **273/273**, `astro check` 0 errors, 41 pages,
  2,631 links, smoke 21 pages; CI `45306250368` green. The existing production job
  `HC-20261123-0F3495` had no invoice; verification did not create it or modify the job. Evidence:
  `docs/verification/2026-11-24-JOB-INVOICE-REPAIR.md`.
- **Prior release (2026-11-24 tipping and completed-service hotfix):** application code `ae6ac57` on
  `production-safe`, Cloudflare Pages deployment `ef5ec9e2-47ba-4a6c-bf53-16381216835f`, verified live
  on 2026-11-24 (served admin asset
  `/_astro/index.astro_astro_type_script_index_0_lang.DAZVnrlk.js`). Adds optional customer tipping on
  existing invoice payments and secure tip-only links for fully prepaid completed jobs, with default
  $0.00, server-calculated service/gratuity Stripe lines, separate service/tip ledger fields, equal
  deterministic allocation to actual timekeeping participants (unallocated until confirmed), admin
  allocation review, refund reversals and tip receipts. Separately adds admin custom agreed pricing,
  percentage/fixed customer discounts and a Record completed cleaning mode that records a historical
  Completed job with actual crew, no availability lookup, no Google Calendar event, no automatic
  signing packet, optional linking of executed evidence, and idempotent invoice creation at the agreed
  price. Invoice forms now load the canonical service catalog (including Move-Out/Move-In Cleaning) and
  support a service performed date; invoices/PDF/email/receipt/payment page retain the selected service
  and date. Migrations `0056_optional_tips.sql` and `0057_invoice_service_date.sql` applied; production
  is at **57** migrations with no foreign-key violations. Verified: unit **1,098** (1,097 pass, 1
  pre-existing skip), browser **272/272**, `astro check` 0 errors, 41 pages, 2,631 links, smoke 21
  pages; CI `45292489558` and `45299825684` green. Live invoice-payment links (existing invoices) return
  default tip $0.00 and correct tip-only behavior; no live charge, customer email, calendar event or
  destructive mutation was created. Evidence: `docs/verification/2026-11-23-OPTIONAL-TIPS-RELEASE.md`
  and `docs/verification/2026-11-23-HOTFIX-COMPLETED-SERVICE.md`.
- **Prior release (2026-11-23 operations and documents combined):** application code `038633e`
  (release `274a5f5` plus the calendar layout polish) on
  `production-safe`, deployed by the GitHub-connected Cloudflare Pages pipeline and verified live on
  2026-11-23 (served admin asset
  `/_astro/index.astro_astro_type_script_index_0_lang.BEl23KQm.js` matches the verified build;
  Cloudflare deployment ID was not retrievable because the installed CLI session belongs to an
  unrelated account). Adds the completed shared document-branding layer (branded editor frame,
  admin/customer renderer, embedded executed-PDF logo, footer/page numbers and legacy table
  rendering), fixes the production reservation-action defect (the real handler required a singular
  `requestId` before reaching bulk actions, so every bulk POST returned `request_required`; browser
  coverage had mocked the route), adds previewed eligibility and per-record outcomes, reversible
  customer deletion as archiving with active-obligation warnings, Morning/Afternoon seven-day
  calendar sections with `+N more`, branch-local CT/ET display, drag/drop proposals, occurrence-only
  and future-series recurring changes, calendar cancellation and appointment actions, multi-cleaner
  dispatch assignment, inline New Booking customer creation, combined save/send-agreements/invoice
  booking actions, signing-request and booking duplicate suppression, and booking-detail invoice,
  crew, branch and communication evidence. No migration was added or required; production remains
  at 55 migrations. Verified: unit **1,081** (1,080 pass, 1 pre-existing skip), browser **267/267**,
  `astro check` 0 errors, 40 pages, 2,569 links, smoke 21 pages. Pensacola availability returns live
  slots; Tampa remains non-bookable with a 404 page; review automation remains disabled and
  untouched. No production customer email, charge, calendar write or destructive customer mutation
  was performed. Evidence: `docs/verification/2026-11-23-OPERATIONS-DOCUMENTS-RELEASE.md` and
  `docs/verification/2026-11-23-DOCUMENT-BRANDING.md`.
- **Prior release (2026-11-23 verified signing, admin operations, branch calendars and reviews):**
  application code `1b6efba`, live Cloudflare Pages deployment
  `0566590a-f5a8-4d6f-abff-5a26c06783dd` on `production-safe`. Production D1 is at 55 migrations;
  `0051`-`0055` are applied (`0052` was already present and its tracking record was reconciled).
  Adds signing pricing snapshots and executed-document presentation cleanup, the admin operations
  redesign, branch-specific Pensacola/Tampa calendar routing and owner-gated Google review requests.
  `GOOGLE_CALENDAR_ID_TAMPA` is configured; Pensacola availability returns live slots; Tampa remains
  non-bookable; review automation is disabled and 0 review requests exist. Verified: unit 1,075
  (1,074 pass, 1 pre-existing skip), browser 260/260, `astro check` 0 errors, 40 pages, validation,
  smoke, production readiness, backup and migration checks. No live customer email, synthetic
  calendar write, charge or refund was created. Evidence:
  `docs/verification/2026-11-23-SIGNING-PRICING-EDITOR.md`,
  `docs/verification/2026-11-23-ADMIN-OPERATIONS-REDESIGN.md`,
  `docs/verification/2026-11-23-BRANCH-CALENDARS-REVIEWS.md`.
- **Prior release (2026-11-23 signing, document correction, presentation cleanup, mobile and notifications):**
  application code `4fe7a64`, live runtime deployment
  **`05a8e6c3-e9bd-45ae-ad33-42aa821cae6b`**. Migration `0052` is applied to production D1
  (`signing_requests.customer_fields_json`, default `'{}'`, supporting index); the existing 11
  customers, 13 properties and 1 pending signing request were preserved. Customer signing is a wide,
  mobile-first three-step ceremony with interactive access/instructions, one legal-name entry, one
  adopted typed/drawn signature, executed PDF evidence and portal retrieval. Admin Documents &
  Agreements is split into seven subviews with customer search, auto-populated service/property
  context, packet readiness, a visual block editor with live print-ready preview, version comparison
  and Approve & Publish. The 27 imported approved templates were corrected to
  `2026-11-23.customer-release.v1` / `2026-11-23.employee-release.v1`: the internal
  `OWNER REVIEW DRAFT â€” NOT EFFECTIVE UNTIL APPROVED` line was removed, every active packet now
  points to a clean approved version, and 0 approved templates contain the draft notice. The
  previous versions are retired but preserved. Customer/employee PDFs, executed copies, emails,
  signing pages and portal document lists no longer print request IDs, template IDs, version
  strings, SHA-256 hashes, consent-version codes or technical execution metadata; backend hashes,
  versions, signatures and audit evidence remain intact. A presentation-clean 27-Word/27-PDF
  library is at `FINAL-APPROVAL-PACKAGE-2026-11-22\10-APPROVED-LIBRARY-2026-11-23-PRESENTATION\`;
  earlier libraries are preserved. Operational notifications route through Communications settings;
  the Bookings address is **`booking@sparkling-standard.com`**. A production test to
  `booking@sparkling-standard.com` was accepted by Resend
  (`01a2067b-e5ef-725f-81ad-9ddc3f46ed53`). Unit **1,055** (1,054 pass, 1 pre-existing skip),
  browser **258/258**, production mobile checks at 320/390/430 show no horizontal overflow or JS
  errors. The live Move-In / Move-Out packet generated 19 clean pages, all checked at 390px with no
  technical metadata or duplicate headings. No live charge, refund, customer message,
  commercial/facility activation or Tampa activation.
- **Release (2026-11-23 signing price, signature boxes, visual editor):** branch
  `production-safe`; released in commit `1b6efba`, Cloudflare Pages deployment
  `0566590a-f5a8-4d6f-abff-5a26c06783dd`. Adds migration
  `0053_signing_pricing_snapshot.sql` (applied to production), a persistent server-authoritative
  pricing snapshot shown on the signing Details & price step, executed copies/PDFs and admin request
  detail; visible per-document **X â€” Sign here** boxes with an adopt-once signature pad, progress and
  next-signature navigation; direct post-signing transition to the payment page with signed-PDF
  download, email status and portal access; the `Ã‚â‚¬` mojibake repair; a Word-style WYSIWYG document
  editor with sanitized rich HTML and PDF rendering; simplified Create a Document / Upload approved
  PDF flows; conventional Version 1.0/1.1 labels; and a test-only Resend network guard. Tests never
  send live email. Evidence: `docs/verification/2026-11-23-SIGNING-PRICING-EDITOR.md`.
- **Release (2026-11-23 admin operations redesign):** branch `production-safe`; released in commit
  `1b6efba`, Cloudflare Pages deployment `0566590a-f5a8-4d6f-abff-5a26c06783dd`. Adds migration
  `0054_admin_operations.sql` (applied):
  human `EST-YYYY-NNNN` estimate numbers, test-request marking and durable `operational_alerts`.
  Replaces the seven-day table with an interactive calendar; adds upcoming-appointment filters that
  hide canceled occurrences by default; reservation bulk approve/archive/restore/deny/mark-test/delete
  with server safety checks and no automatic customer email; actionable alert detail/lifecycle with
  recheck, acknowledgement and resolution notes; active/archived/deleted customer views with restore
  and anonymized-record protection; compact searchable extras; 15-minute friendly time formatting;
  component-level campaign/Community Support allocation; recurring-plan cleanup; and a tabbed
  Dispatch & Team workspace with direct click-to-assign for dispatch-ready employees. Verified:
  unit 1,069 (1,068 pass, 1 pre-existing skip), browser 259/259, `astro check` 0 errors, 40 pages,
  validation and 21-page smoke. Zero live Resend sends. Production counts verified at 14 pending
  requests, 2 unsigned packets, 1 outstanding invoice, 0 active recurring failures (11 historical),
  3 failed checkout sessions plus 8 abandoned sessions. Evidence:
  `docs/verification/2026-11-23-ADMIN-OPERATIONS-REDESIGN.md`.
- **Release (2026-11-23 branch calendars and review requests):** branch `production-safe`; released
  in commit `1b6efba`, Cloudflare Pages deployment `0566590a-f5a8-4d6f-abff-5a26c06783dd`. Adds
  migration `0055_branch_calendars_reviews.sql` (applied): branch `calendar_id`, `calendar_name`,
  `review_url`, review delay/frequency settings and a private `review_requests` table. Branch
  resolution now uses the service ZIP (plus reverse-geocoded ZIP and a conservative coordinate
  fallback) and never silently defaults an unknown address to Pensacola; Tampa includes Spring
  Hill `34609`. Branch-specific Google Calendar env values are
  `GOOGLE_CALENDAR_ID_PENSACOLA` and `GOOGLE_CALENDAR_ID_TAMPA`; Tampa never borrows the
  Pensacola calendar. Availability, holds, auto-confirm and commitment use the branch calendar
  and timezone. Review requests are created only for verified completed appointments, require an
  official branch review URL, deduplicate, respect a frequency cap and remain disabled by
  default. Invoice/email/PDF review invitations appear only for completed services; Tampa has no
  review URL and shows none. Admin gains branch calendar/review settings and a Google Reviews
  queue. Verified: unit 1,075 (1,074 pass, 1 pre-existing skip), browser 260/260, `astro check`
  0 errors, 40 pages, validation and migration-0055 integrity. Production D1 is at 55 migrations;
  `GOOGLE_CALENDAR_ID_TAMPA` is configured; Pensacola availability returns live slots; Tampa
  remains non-bookable; both review flags remain disabled and 0 review requests exist. Zero live
  Resend sends, synthetic calendar writes, charges, refunds or customer messages. Evidence:
  `docs/verification/2026-11-23-BRANCH-CALENDARS-REVIEWS.md`.
- **Prior release (2026-11-23 booking address and release evidence):** application code `285c748`,
  merged at `96a5b8f`, runtime deployment `bdd48b01-6a43-46bc-a56c-54e1e4ef4120`. Corrected the
  Bookings address to `booking@sparkling-standard.com`, applied migration `0052`, and recorded the
  controlled release evidence.
- **Prior release (2026-11-22 Pensacola residential legal release):** `production-safe` at
  **`5c4ac41`**, live production deployment **`344ad883-c87a-4baf-b0f4-f34eef27988c`**. The 27
  owner-approved legal templates are imported into production D1 (27 approved, 0 draft, 10
  non-system packets, 83 items, 37 import audit records) and the four verified residential packets
  are active: `customer.deep`, `customer.residential`, `customer.recurring`,
  `customer.move_in_out`. Required customer documents are enforced at `before_payment`;
  booking-specific agreements are `per_booking = 1`. The checkout Terms/Privacy links now open an
  accessible in-page modal that preserves estimator state. **Admin â†’ Documents & Agreements â†’
  Document Updates** provides revision impact analysis, owner acknowledgement, notification and a
  re-signing queue that prefills the existing composer; no automated customer contact. Facility
  online payment is **disabled** in the browser and server until its own acceptance run; Tier A/B
  preliminary numbers and request/invoice paths remain. STR, commercial, church, property
  management, specialty and employee packets are imported **inactive**. Migration `0051` remains
  unapplied. Unit **1,036** (1,035 pass, 1 pre-existing skip), browser **252/252**, `astro check` 0
  errors, 40 pages, validate 2,563 links, smoke 21 pages. No release-created live charge, refund or
  customer message. One live owner-initiated recurring signing request exists and is pending; it
  was not touched. Evidence: `docs/verification/2026-11-22-RESIDENTIAL-LEGAL-RELEASE.md`.
- **Prior release (2026-11-22 isolated Preview end-to-end acceptance):** application code on
  `release/2026-11-22-legal-signing-acceptance` completed a full isolated Preview acceptance run.
  A Preview-only exact-host E2E gate (no global `*.pages.dev` bypass; production rejected; ordinary
  Preview API calls remain `503 preview_read_only`) opened only the disposable E2E host. The
  residential Deep Cleaning journey passed end to end: estimator, real geocode/route, verified
  $335.00 quote, temporary hold, approved `customer.deep` packet, six required e-signatures,
  executed-copy SHA-256, Stripe **test-mode** Checkout payment `pi_3UeirYArIaVXsguz0aWsOzmU`,
  verified webhook `evt_1UeirZArIaVXsguzsY94yibO`, automatic booking confirmation, appointment
  creation, and a Google Calendar event on a **dedicated test calendar** (production calendar never
  written). The Move-In / Move-Out journey also passed end to end at $255.00. The Admin Document
  Composer previewed, drafted, sent, signed and retained a `customer.move_in_out` request; nine
  customer packet previews resolved every variable. Three defects were fixed: the signing page did
  not forward the resume capability, Stripe Customer resolution used the wrong key in Preview, and
  the webhook had no test-mode secret override. Failure tests passed (missing signature, tampered
  price, repeated checkout idempotency, expired hold, expired signing link, cross-account document
  access, duplicate/tampered/missing webhook signatures, abandoned Checkout). Unit **1,029**
  (1,028 pass, 1 pre-existing skip), browser **249/249**, `astro check` 0 errors, 40 pages,
  validate 2,558 links, smoke 21 pages. After testing the E2E token, exact-host allowlist, test
  webhook and test calendar were removed/disabled and the Preview is read-only again. Production
  was not merged, migrated, deployed or charged; no customer message was sent. Owner decisions
  remain: authorize production template import/activation; set required customer documents to
  `before_payment` and decide per-booking document scope; run the remaining facility/specialty
  payment workflows. Evidence: `docs/verification/2026-11-22-E2E-PREVIEW-ACCEPTANCE.md`.
- **Prior release (2026-11-21 checkout recovery):** application code **`84379cb`** is
  live on `production-safe` (final Cloudflare Pages production deployment `edc50a01`; the
  checkout fix was verified on `3f6ded04`). Live Pay Now failed because
  `functions/api/estimate-checkout.ts` sent Stripe's unsupported
  `customer_update[email]` parameter (`parameter_unknown`). It was removed; Google
  routing now retries and falls back to MapMap before a straight-line estimate; and a
  failed checkout retains its generation so **Try Secure Payment Again** uses a fresh
  Stripe idempotency key. The owner-specified **the owner-approved Molino test address (redacted from public docs)**
  journey reached live Stripe Checkout; a simulated failure showed the retry state and
  the retry reached Checkout. No charge, refund, paid webhook event or duplicate booking
  occurred. Unit **974** (973 pass, 1 pre-existing skip), browser **240** pass,
  `astro check` 0 errors, 39 pages built, validation passed. Evidence:
  `docs/verification/2026-11-21-CHECKOUT-RECOVERY.md`.
- **Prior release (2026-11-20 bookings department and secure careers applications):** application code
  **`e7f18c6`** is live on `production-safe` (Cloudflare Pages production deployment
  `e5b8331e-380f-44bc-b3a7-c310b4d90c50`). Migration `0043` adds private career applications and
  resume metadata. `booking@sparkling-standard.com` is the sixth department address and is now the
  booking-confirmation reply-to; billing remains invoice/receipt reply-to. The careers page now has
  a secure application form for experienced and entry-level applicants, optional private PDF/DOCX
  resume storage, applicant acknowledgment, hiring notification, status lookup and an owner-only
  admin review/status workflow. Navigation is rate-limited; resumes are private and downloaded only
  through an authorized owner session. CI passed; unit **947** (946 pass, 1 pre-existing skip),
  browser **237** pass. Production has 0 applications and 43 migrations; Tampa stays 404. No live
  message, charge or deletion. Evidence: `docs/verification/2026-11-20-BOOKINGS-CAREERS.md`.
- **Prior release (2026-11-20 reviews and department email routing):** application code
  **`061e167`** is live on `production-safe` (Cloudflare Pages production deployment
  `46a8416a-5dd8-49dc-9748-6f65d03635b7`). The reviews carousel was rebuilt around readable excerpts,
  no internal scrolling, equal-height cards and an accessible full-review dialog; live cards are
  496 px at 1440 and photographs stay inside the card. Public contact now defaults to
  `customer-service@sparkling-standard.com`; invoices and receipts reply to
  `billing@sparkling-standard.com`; careers uses `hiring@sparkling-standard.com`; owner alerts
  remain private. DNS shows Google Workspace MX, Google DKIM and DMARC p=none. CI passed; unit
  **944** (943 pass, 1 pre-existing skip), browser **233** pass. No live message, charge or refund.
  Evidence: `docs/verification/2026-11-20-REVIEWS-EMAIL-ROUTING.md`,
  `docs/operations/EMAIL-ROUTING.md`.
- **Prior release (2026-11-20 document library and Tampa visibility gate):** application code
  **`397be7b`** is live on `production-safe` (Cloudflare Pages production deployment
  `144f1239-5fbc-44a9-b83b-c89d761b150e`). An owner-review Word library was generated from 183
  business documents; 176 contained the old gold-S logo and now use the approved Sparkling STANDARD
  wordmark in review copies. Originals are untouched. `OPEN-DOCUMENT-LIBRARY.html` is the entry
  point in `00 START HERE`; nothing is approved or uploaded. Production-host middleware now keeps
  Tampa OFF unless `branch_tampa.lifecycle_status = live` and `status = active`; the Tampa page
  returns 404/noindex and the service-area page removes the Tampa card. Live verification: Tampa page
  404, service-area single-region heading, no Tampa on homepage. CI passed; unit **940** (939 pass,
  1 pre-existing skip), browser **232** pass. No charge, message or deletion. Evidence:
  `docs/verification/2026-11-20-DOCUMENT-LIBRARY-AND-TAMPA-VISIBILITY.md`.
- **Prior release (2026-11-20 post-dispatch production closeout):** application code
  **`6ea55d7`** is live on `production-safe` (Cloudflare Pages production deployment
  `5a8e151b-a7fd-4eec-8622-231a197ebe0b`). Migration `0042` adds private branch operating origins
  and travel limits. Branches & Launch now has a Google Places-enabled origin field, owner-only
  readiness checklist and a live-advance gate. Dispatch readiness now reports each employee's exact
  blockers; `team_hayli` has onboarding clearance but still needs service, equipment, transport and
  origin configuration. Homepage metadata now carries equal residential/commercial Pensacola
  positioning. Production verification: Pensacola is live with an origin warning; Tampa is setup and
  blocked by missing public phone/service, pricing, public estimator, scheduling, payments and
  fulfillment; dispatch remains analysis-only, disabled, paused, with 0 unassigned jobs and 0
  dispatch-ready employees. CI `validate` and `browser` passed; unit **935** (934 pass, 1
  pre-existing skip), browser **232** pass. No charge, customer message or data deletion was
  performed. Evidence: `docs/verification/2026-11-20-POST-DISPATCH-CLOSEOUT.md`.
- **Prior release (2026-11-20 workforce intelligence and intelligent dispatch):** application code
  **`9c4b49a`** is live on `production-safe` (Cloudflare Pages production deployment
  `5162c0c2-6e3e-4c75-b02d-1b80b1e5398a`). Migration `0041` adds owner-controlled intelligent
  dispatch under **Admin -> Jobs & Team**: employee qualifications, equipment, independent/shared
  transport, private dispatch origins, time off, availability and weekly-hour rules; a deterministic
  feasibility/ranking engine; automatic assignment of eligible unassigned confirmed jobs; owner-only
  reassignment recommendations; coverage exceptions; decision/audit history; calendar-status retry;
  and employee lanes. Existing assignments and customer appointment times are never changed
  automatically. Production defaults are analysis-only and paused; `team_hayli` still needs a
  completed dispatch profile before candidates exist. CI `validate` and `browser` passed; unit
  **935** (934 pass, 1 pre-existing skip), browser **232** pass. Migration applied to production D1;
  live owner dashboard verified with 0 unassigned jobs and 0 dispatch-ready employees. No customer
  charge or message was performed. Evidence:
  `docs/verification/2026-11-20-WORKFORCE-DISPATCH.md`.
- **Prior release (2026-11-20 execution reliability and checkout repair):** application code
  **`cd612e7`** is live on `production-safe` (Cloudflare Pages production deployment
  `dc7419a3-5cb0-4158-ab51-6c008e8b0b0d`). It fixes the displayed-total promotion acceptance path
  that could reject a `HOLIDAY15` checkout (`quote_changed`), enables and reports recurring checkout
  readiness, records failed checkout reasons on the request, uses branch-local admin time (Pensacola
  Central; Tampa Eastern), renders recurring duration in hours/minutes, and bounds long admin tables.
  Review cards keep the approved 35rem/33rem heights with internal quote scrolling and no top
  clipping at 1440/1280/1024/390. Tampa coverage is registered as 132 Census ZCTAs for Pasco,
  Pinellas and Hillsborough with a 20-mile default one-way limit; Tampa pricing version 1 is internal
  at fingerprint `2026-10-25.engine-calibration-supportive-tax.v1.49705bdc08ec90b4`. CI `validate`
  and `browser` passed; unit **908** (907 pass, 1 pre-existing skip), browser **228** pass. No live
  charge, refund or customer message was performed. Evidence:
  `docs/verification/2026-11-20-EXECUTION-RELIABILITY-FIXES.md`.
- **Prior release (2026-11-20 data recovery, review design and backup closeout):** application code
  **`e011105`** is live on `production-safe` (Cloudflare Pages production deployment
  `df9fa304-c87c-4812-a5ad-47018356f999`). The pre-existing residential and commercial prospect
  systems were recovered intact: **4,241 addresses / 3,892 owner-occupied / 66 routes / 20
  neighborhoods**, and **800 commercial prospects / 16 sectors / 56 route groups / 192 Priority A**.
  Protected recovery copies and checksum manifests now live in the master workspace; the full
  master inventory indexes 1,932 files. The review carousel uses seven owner-approved reviews,
  consistent 35rem cards with a controlled overflow/read-full-review dialog, Dennis's two real
  couch photographs, Laura's real shower photograph and collapsed Laura paragraph spacing. Bob,
  Amanda and Elizabeth remain excluded. Follow Us is twelve transparent 44px marks; the footer
  service-area paragraph remains removed. Tampa pricing version 1 is internally published at the Pensacola/source parity fingerprint
  `2026-10-25.engine-calibration-supportive-tax.v1.49705bdc08ec90b4`; Pensacola remains
  unaffected. Pasco, Pinellas and Hillsborough are registered as the approved Tampa coverage area
  (132 Census ZCTAs) with a 20-mile default one-way limit. A real Tampa origin and branch-aware
  public estimator/travel/scheduling path are still required before booking activation. A new encrypted full backup covers D1, application R2
  (88 objects) and the master workspace; parts were uploaded to private R2, downloaded, rejoined
  and verified, and an independent OneDrive copy was created and checksum-verified locally.
  CI `validate` and `browser` pass; local suite **907 tests (906 pass, 1 pre-existing skip)** and
  **228 browser tests** pass. No live charge, refund, unsolicited customer email or legal
  execution was performed. Evidence: `docs/operations/PROSPECT-DATA-RECOVERY.md`,
  `docs/operations/OFFSITE-BACKUPS.md`, `docs/verification/2026-11-20-REVIEWS-FOOTER.md`.
- **Prior release (2026-11-20 master directive: reviews, photos, footer and Tampa inquiries):**
  application code `1d7c997` remains in production history (deployment
  `c6469de6-bf79-407c-a2a4-3f54c4051d35`). It corrected the owner-approved review set, restored
  Dennis/Laura photos, removed the summary and footer area paragraph, added the Tampa inquiry
  page/form and deployed the branch foundation. Evidence:
  `docs/verification/2026-11-20-REVIEWS-FOOTER.md`.
- **Prior release (2026-11-19 production activation and admin address autocomplete):** application
  code **`019fad6`** remains in production history (Cloudflare Pages deployment
  `f890914f-32fc-4691-9557-009214a9e380`). It applied migrations `0038`/`0039`, added Google
  Places admin address autocomplete, Quick Estimate PDF verification and encrypted D1/master
  backups. Evidence: `docs/verification/2026-11-19-PRODUCTION-ACTIVATION.md`.
- **Prior release (2026-11-19 invoice payment receipts):** application code **`85d5178`** remains in
  production history (Cloudflare Pages production deployment `c70d8b1d-2a1a-4b59-b9e6-b44f663d8351`).
  Migration `0037` adds idempotent invoice receipt delivery. The invoice-payment webhook sends one
  branded itemized receipt after verified payment, records Resend status and exposes an owner resend
  action. No live receipt was sent during verification. Evidence:
  `docs/verification/2026-11-19-INVOICE-RECEIPTS.md`.
- **Prior release (2026-11-19 invoice payment link):** application code **`e324f0b`** remains in production history
  (Cloudflare Pages production deployment `1c8ef822-9864-4cb7-b4ff-25711d3983bc`). Invoice billing gate
  is enabled in production. Admin can preview an invoice email, create/reuse the exact-balance Stripe
  Checkout Session and email the PDF plus secure payment link. Invoice branding uses the approved
  company name and slogan. No live link, charge or refund was created during verification. Evidence:
  `docs/verification/2026-11-19-INVOICE-PAYMENT-LINK.md`.
- **Prior release (2026-11-19 admin promotion selection):** application code **`4f70ea3`** remains in production history
  (Cloudflare Pages production deployment `485aa2f2-9218-4e8e-b3f0-d5ec07b26018`). New Booking now has a
  database-driven promotion selector; the chosen code is evaluated by the shared server rules and carried
  through the manual estimate and booking. Persistent FRIENDS15 remains account-level. Evidence:
  `docs/verification/2026-11-19-ADMIN-PROMOTION-SELECTION.md`.
- **Prior release (2026-11-19 invoice payment terms):** application code **`7e85818`** remains in production history
  (Cloudflare Pages production deployment `db47fe16-c166-4001-b6d2-72bbe9ee12fc`). Residential invoice
  defaults are due immediately; commercial/church defaults are Net 15; an explicit due date overrides.
  The admin invoice form now selects the service type. Evidence:
  `docs/verification/2026-11-19-INVOICE-TERMS.md`.
- **Prior release (2026-11-19 FRIENDS15 persistent benefit):** application code **`45dd3a2`** remains in production history
  (Cloudflare Pages production deployment `7317b104-14f4-4e49-9082-6f8e0bd1e94b`). Migration `0036` adds
  customer-level promotional entitlements with owner-only preview/apply/remove, recurring-plan price
  application and restoration, manual-quote eligibility and audit history. Existing one-time promotion
  behavior is preserved; no customer benefit was assigned during release. Evidence:
  `docs/verification/2026-11-19-FRIENDS15-PERSISTENT-BENEFIT.md`.
- **Prior release (2026-11-18 routing repair):** application code **`01a5601`** remains in production history
  (Cloudflare Pages production deployment `90cf1513-9a7a-4165-bed2-41c7ba69f7c8`). Saved properties
  with missing coordinates are geocoded instead of being treated as `(0,0)`; the public travel
  endpoint and server route resolver reject the missing-coordinate sentinel. The affected Milton
  property was repaired with an exact geocode and an audited reversible D1 change. Its verified
  route is 16.4 miles one way. Evidence: `docs/verification/2026-11-18-PROPERTY-ROUTING-INCIDENT.md`.
- **Prior release (2026-11-18 invoice documents):** application code **`e9ea0f0`** remains in
  production history (Cloudflare Pages production deployment
  `cc93b287-0c40-4239-b7ee-657627f5d812`). The admin invoice view generates a downloadable PDF and
  can email an open/partially paid/overdue invoice with the PDF attached through the existing
  Resend configuration. Internal invoice notes are excluded; customer email, itemized lines,
  discount, tax, payments received, balance, due date, legal entity and any secure Stripe payment
  link are included. No migration and no live customer email/charge was performed. Evidence:
  `docs/verification/2026-11-18-INVOICE-DOCUMENTS.md`.
- **Prior release (2026-11-18 checkout discounts):** application code **`3efa854`** remains in
  production history (Cloudflare Pages production deployment
  `d44b1ff1-5908-4303-b228-e119af83ffa0`). Migration `0035` is applied. Applied promo codes show a
  visible Remove action. A promotion explicitly marked May stack with Community Support (currently
  THANKS75) may coexist with the 10% Community Support discount; FRIENDS15 cannot stack and the
  better offer wins. The recurring persistent-benefit policy is implemented in the 2026-11-19 release above.
  Evidence: `docs/verification/2026-11-18-CHECKOUT-DISCOUNTS.md`.
- **Prior release (2026-11-17 address-first scheduling):** application code **`40d5a56`**
  remains represented in history (Cloudflare Pages production deployment
  `9ee042cb-5252-4d4a-b487-4fcc83237cdd`). Residential Step 1 now requires a confirmed service address
  before the appointment calendar unlocks; changing the address re-locks scheduling and clears the
  invalidated appointment. Date/time choices scroll to the next relevant control, and continuing
  lands on the next step heading. The final five-second reveal is unchanged. Evidence:
  `docs/verification/2026-11-17-ADDRESS-FIRST-SCHEDULING.md`.
- **Prior release (2026-11-11 founder age-reference removal):** application code **`509feb8`**
  is live (Cloudflare Pages production deployment `ec38df2e-f69c-4ad6-a331-6a2ee44b7e3e`).
  `main` and `production-safe` were synchronized at that release. All public references to Hayli's
  age, date of birth, youth or age-related marketing were removed from the About page, homepage
  founder band, founder configuration, SEO/OG metadata and rendered output. Hayli is presented only
  as founder and owner-operator. Internal marketing guidance was scrubbed to prevent
  re-publication. Evidence: `docs/verification/2026-11-11-AGE-REFERENCE-REMOVAL.md`.
- **Prior release (2026-11-11 estimator scroll and checkout UX):** application code **`4106d59`**
  remains represented in history (Cloudflare Pages production deployment
  `9ec1b492-0f02-401b-bc93-9af9e18d4151`). Address confirmation re-anchors to the availability
  question, every step transition targets its heading with a guarded settled pass, and the
  five-second final reveal is framed once per questionnaire. The final checkout has one
  **Apply Discounts & Gift Certificates** action, automatically keeps the better non-stackable
  offer, itemizes the saving/gift lines, updates the total and scrolls back to the breakdown.
  Gift value remains payment tender after promotion and tax; cleaning promotions cannot
  discount gifts and vice versa. THANKS75 remains active. Evidence:
  `docs/verification/2026-11-11-ESTIMATOR-SCROLL-CHECKOUT.md`.
- **Prior release (2026-11-11 estimator refinements):** application code **`99db643`** remains
  represented in history (Cloudflare Pages deployment `bef7159b-f0bf-4daf-b651-13c4852e7008`).
  Migration `0034` added promotion scope and is applied to production D1; the owner promotions
  table lists database, static, bundle and eligibility offers.
- **Prior release (2026-11-10 THANKS75 activation):** application code **`2265fa6`** was live
  (Cloudflare Pages deployment `894430e4-a6c1-46dd-aeb6-1377ab8efe17`; source `2265fa6`).
  Migrations 0032-0033 were applied; THANKS75 remains active with the approved $75 terms and
  separate booking/service deadlines. GitHub `validate` and `browser` passed on both `main` and
  `production-safe`.
  - It preserves the full production-safe feature set: dynamic booking/staffing, recurring
    scheduling and lifecycle, document management/signing, employee portal/timekeeping, CRM and
    property profiles, financial ledger/Stripe reconciliation, owner pricing control and all four
    estimator engines.
  - It fixes estimate/contact form delivery readiness at runtime (`/api/lead-readiness`) so the
    false "Request delivery is not connected on this preview build" warning no longer appears.
  - It recovers the previously unpushed live admin delta (recurring duration control and calendar
    sync labels) that existed only in Cloudflare deployments `15128fd`/`875492a`.
  - Migrations `0001`-`0031` are applied (31 migrations, 72 application tables). No schema change
    was required by this release. D1 was encrypted and restore-verified before release.
  - **Admin enhancements (2026-11-10):** owner Promotions & Discounts control center,
    public promo-code validation, checkout discount/redemption lifecycle, Thanksgiving
    THANKS75 draft and the Data & Storage dashboard with CSV exports and photo cleanup.
    Migration 0032 is applied (32 migrations, 74 application tables).
  - **Final audit (2026-11-10):** Google Calendar is connected and working after the Workspace
    billing restoration. Public checkout now links/reuses one durable Stripe Customer; executed
    agreements queue and email the owner with the executed copy; a daily R2 photo-retention Worker
    is deployed and production-verified. See `docs/verification/2026-11-10-FINAL-AUDIT.md`.
  - Owner-only: controlled Stripe live/test verification, approved legal templates, branch
    selector/backfill and Central Florida activation, optional recurring autopay terms. The Google
    secret is `plain_text` in Cloudflare but not public; rotate only if access is shared.
- **Prior release:** `7eab309` (deployment `71be4e9f-f1aa-432c-9681-fd5f8cb4e077`) delivered
  dynamic booking resources, recurring scheduling, document/e-signature management and the
  employee board. It remains represented in the current history.
- **Canonical owner master:** `C:\Users\thoma\Downloads\Sparkling-Standard-Master\`. The active
  repository checkout is `01_WEBSITE_REPOSITORY`; the original Documents copy is preserved as a
  read-only pre-consolidation snapshot until the owner approves cleanup. Start at
  `00_START_HERE\START_HERE.html`.
- **Owner local recovery state:** the owner sets her own password through the admin or employee
  Forgot Password flow. Production D1 has 31 migrations, 72 application tables plus Cloudflare
  internal metadata, 0 foreign-key violations and 0 outstanding reset tokens.
- **Prior Initiative 6.8:** live at `6e36c95` plus the HEIC test-stability fix `9fe8764` (Cloudflare Pages deployments `2a0d4f21-8eb8-49b0-b298-f086e3c7473b` and `4afab04f-9f97-47b5-bb2c-778aa7b6f745`; `validate`, `browser` and Cloudflare checks passed). It implements the three-page owner audit: prices stay hidden through every preliminary estimator step and are revealed at the final stage with a shared branded animation across all four engines; the owner-supplied **two-of-four** Competitive Pricing badge is installed; homepage service cards use one equal-height grid; KJV scripture is expanded through a shared component; and all transactional forms require an unchecked-by-default, server-verified terms acceptance with a private R2 record. The public Terms were expanded with Florida cancellation/gift research, condition/access, payment/refund, damage, safety, recurring, commercial/church, dispute and version rules. Gift certificates remain in **request mode** (sales disabled) because no owner-approved denominations/fulfillment activation were supplied; live calendar booking is **not connected**, so preferred dates remain requests and no fake availability is shown. No new cancellation/reassessment fee is active; owner and Florida counsel approval gates are documented in `docs/legal/TERMS-RESEARCH.md` and `docs/launch/OWNER-INPUT-REQUIRED.md`. No pricing mathematics changed.
- **Prior Initiative 6.7:** live at `f111014`; checkout readiness now checks key, webhook secret/endpoint, notifier, ledger and mode; verified-only quotes, explicit price-change acceptance, SHA-256 checkout idempotency with R2 session reuse, durable webhook event claims, retryable notifications, safe cancellation/status pages and no duplicate lead on payment retry. Production `/api/estimate-checkout` is live mode with all readiness checks true. No live card charge or Stripe test-mode transaction was performed.
- **Prior Initiative 6.6:** live at `0b907d4` (Cloudflare Pages deployment `26e3b9f8-7665-426f-8687-7f171588c865`); it completed the 13-page owner audit, approved homepage/Community Support/Deep Cleaning/Service Area copy, FL/AL state restriction, GPS loading, optional facility ZIP, centered facility intros, add-on bundles, and the original Pay Now/reservation path. Private legal records were organized in the master archive.
- **Prior Initiative 6.5:** live at `298c1df` (deployment `f9b4f61a-58d1-4ff3-8535-c375af8789fc`); automatic estimator configuration, validation gate, pricing fingerprint and four-engine impact report remain intact; all calibration factors remain `1.00`.
- **Prior Initiative 6.4:** live at `685031d` (deployment `f9dea1a0-5b55-4cd8-b09e-18efae73c68a`); the 18-county map, reading-glasses/red-white-blue icons, footer/navigation/copy corrections and four `1.00` calibration factors remain intact.
- **Prior release status:** the 2026-10-03 release was **deployed to production** â€” `origin/main` =
  `62a1a46` (the five-commit release `8b8dde4`/`03d6ba8`/`53a85aa`/`0f3c38c`/`5a4a024`, the
  documentation closeout `7a51efa`, the social integration `cdc4971`, the deployment-closeout
  `6ebc3fb` and the logo-only Follow Us redesign `62a1a46`), owner-authorized with live
  acceptance checks passed (see `docs/verification/VERIFICATION.md`). Any new local work â€”
  including later documentation follow-ups â€” stays unpublished until the owner authorizes another
  push.
- **Marketing phase (2026-10-03):** the business is transitioning from development into active
  marketing. **Immediate execution priorities: film Hayli's founder introduction, produce the
  first cleaning videos and acquire local recurring customers.** Two growth engines (audience
  growth vs. local customer acquisition), priority content platforms (Instagram, TikTok and YouTube live; Google Business Profile verified
  with its profile + review links captured; X active), the proposed "30 Days. 30 Details." content plan, the 30-day
  launch schedule and the owner account checklist are documented under `docs/marketing/`. The
  primary business objective is dependable weekly/biweekly residential customers. The owner's
  pending marketing actions live in `docs/launch/OWNER-INPUT-REQUIRED.md` (M2â€“M7; M1 â€” the
  software release â€” was deployed 2026-10-03).
- **Formal launch checklist still outstanding (owner sign-off):** insurance/
  bonding/licensing claims, genuine reviews, final cancellation percentages, and any profile
  URLs not yet supplied. The legal entity spelling is owner-confirmed and supported by the
  Florida Articles certificate in the private master archive. `business.launch.productionApproved` remains `false` as the formal
  checklist gate; it does NOT reflect deployment state (the site is live).
- Owner-confirmed facts: name, domain, phone `(850) 426-8479` (corrected 2026-10-02 â€” the
  earlier `(850) 246-8479` was a typo and must never be reintroduced), email
  `owner@sparkling-standard.com`, founder Hayli, Stripe, Cloudflare DNS.

### THE NO-FABRICATION RULE (non-negotiable)

**Never convert a `PENDING` fact into a public claim. Ever.**

Never invent or "fill in" company/legal names, phone, email, addresses, years in business,
customer/review counts, certifications, insurance, bonding, licenses, employee counts,
testimonials, commercial clients, guarantees, response times, exact pricing, social URLs or review
links. Unknown information must be centralized as `PENDING` in `src/config/business.ts` (or
`.env`), excluded from public claims, and blocked by validation gates before publication.

Never invent reviews, credentials, statistics, client testimonials or unsupported marketing claims.
Never publish unapproved promotional promises or activate binding pricing without authorization.

## Non-negotiable constraints

- **No additional expenditure** or activation of billable external services without explicit owner
  authorization.
- **No fabricated business claims** (see rule above).
- **No leaking** private operating coordinates, customer data, credentials, API keys, tokens or
  session data â€” into code, logs, tests, commits, docs, analytics, notifications or reports.
- **Sunshine Climate Solutions is a READ-ONLY architectural reference.** Never modify its
  repository; adapt patterns with applicable licenses/attribution preserved.
- **No destructive Git operations** (force push, history rewrite, reset, clean) and no undocumented
  production changes. Never push without explicit owner approval. Never touch Cloudflare settings
  or DNS without authorization.
- **Publication discipline:** provisional pricing and unapproved promotions stay internal behind
  their publication flags. Nothing customer-visible ships without the flag and the owner approval.

## Verified architecture

- **Astro 5, `output: 'static'`, strict TypeScript** (`astro/tsconfigs/strictest` + explicit `.ts`
  import extensions for Node-test compatibility). No client framework, no CSS framework, no CMS,
  no database.
- `trailingSlash: 'always'`; canonical domain from `PUBLIC_SITE_URL`; sitemap excludes 404,
  payment-success, thank-you and leave-review.
- **Single sources of truth** (never hard-code these facts elsewhere):
  - `src/config/business.ts` â€” every business fact, contact channel, socials, launch flags,
    publication flags.
  - `src/config/estimators/pricing-values.ts` â€” raw owner-editable pricing, labor model, add-ons,
    promotions, discounts and thresholds.
  - `src/config/pricing.ts` â€” typed approval/notes wrapper consumed by the estimator.
  - `src/config/estimators/input-definitions.ts` â€” customer input options and validation limits.
  - `src/config/estimators/commercial.ts` â€” commercial/church pricing switch and tier triggers.
  - `src/config/estimators/travel.ts` â€” shared client/server travel economics.
  - `src/config/geography.ts` â€” ZIPâ†’zone reference and zone policy (preliminary, not addresses).
  - `src/config/marketing-links.ts` â€” inbound UTM links and QR assets.
- **Content collections** (`src/content.config.ts`, Zod-validated): `services` (seven owning
  pages), `faqs`, `checklists` (`public | internal`; internal must never render publicly),
  `proof` (intentionally empty until genuine material exists), `reviews` (carries the three
  authentic owner-supplied Google reviews since 2026-10-24 â€” never fabricate more), `site` (page copy).
- Pages are thin wrappers. The estimator engine lives in `src/lib/estimate/`; travel logic in
  `src/lib/travel/`; address/location logic in `src/lib/location/`. Arithmetic never lives in pages.
- The estimate flow collects a **confirmed destination**: GPS "Use My Current Location" first, with
  an expandable manual address section (closed by default), MapMap suggestions through
  `/api/geocode`, a manual fallback, and a lazy-loaded MapLibre GL + OpenFreeMap pin confirmation.
  A confirmed pin is the only destination source â€” never let a ZIP centroid silently replace it.
  GPS/manual modes are isolated: the selected method is the only source of the submitted address.
  A suggestion the provider only knows at street level opens the same pin confirmation and records
  `pin_precision: 'street'` â€” the exact house number is never fabricated and travel stays preliminary.
- The **promotion engine** (`src/lib/estimate/promotions.ts`) is pure and shared by the browser
  estimator and server verification: at most ONE promotion per quote, owner-gated, term-gated,
  minimum-job floor enforced, specialty work excluded, customer-kind programs fail closed. Prepared
  static programs remain disabled until the owner approves written terms; THANKS75 is the active
  owner-approved database promotion (see below). Never enable or publish one without the owner's
  written terms, the `docs/launch/PROMOTION-PROPOSALS.md` review; the automatic effective-pricing
  version changes when the approved terms change.
- **Owner database promotions** (`src/lib/promotions/service.ts`, migrations 0032-0035) support
  cleaning and gift scopes. THANKS75 remains active with its approved terms. A cleaning promotion
  cannot discount a gift certificate; a gift promotion reduces only the purchase price and preserves
  the certificate face value. A promotion explicitly marked **May stack with Community Support**
  (currently THANKS75) may coexist with the 10% Community Support eligibility discount; FRIENDS15
  must not stack and the better eligible offer wins. Applied promo codes have a visible Remove
  action. The admin promotions table lists static, bundle and eligibility offers as read-only
  inventory. See `docs/verification/2026-11-11-ESTIMATOR-PROMOTIONS-REFINEMENTS.md`.
- Client-side JS is minimal, bundled by Astro from `src/scripts/` (no framework). The estimator
  computes in the browser so the instant estimate works on a fully static page. A browser price is
  a PROPOSAL: every priced reservation request is recalculated server-side
  (`src/lib/estimate/verify.ts` via `functions/api/lead.ts`); client price/coordinate/verdict
  fields are never trusted. A GPS destination without a resolvable ZIP is priced from its confirmed
  pin and stays **preliminary** â€” never represented as a server-verified street address.
- Serverless functions live in `functions/api/` (Cloudflare Pages Functions) for geocoding, travel
  lookup, the lead relay and server-verified Stripe estimate payments. **Secrets only ever live
  in the function environment** (Cloudflare).
- Styles: `src/styles/tokens.css` (design tokens), `global.css` (component styles), `fonts.css`
  (generated). Use tokens only â€” never raw colors, spacing or font sizes.
- Analytics: nothing loads before an explicit analytics consent choice; Umami/GTM/GA4 are gated by
  the same consent controller. Event names are a closed taxonomy
  (`src/lib/analytics/events.ts`) with allowlisted payload keys. Never send names, emails, phones,
  addresses, ZIPs, photos, form contents or anything you would not publish on a billboard.
  Attribution (UTMs, referrer, ad click ids) is captured for LEAD RECORDS only.
- Brand assets: browser/PWA icons and the social preview come from the owner-approved circular
  logo (2026-10-19) and are generated together by `node scripts/generate-logo-assets.mjs`
  (`public/favicon.ico`, `favicon.svg`, `favicon-16/32/48/64/96/128/256.png`,
  `public/brand/apple-touch-icon.png`, `icon-192/512.png`, `icon-maskable-512.png`,
  `og-default.png`, `logo-mark*.svg`). The historical
  `node scripts/generate-brand-images.mjs` command aliases the same generator. Do not overwrite
  the approved icons with older artwork.

## System map â€” where the source of truth lives

| System | Source of truth | Detailed docs |
| --- | --- | --- |
| Business facts, contact, socials, launch/publication flags | `src/config/business.ts`, `.env` | `docs/launch/OWNER-INPUT-REQUIRED.md` |
| Pricing, labor model, add-ons, owner-approved bundles, promotions, discounts, four engine calibration factors, Community Support discount | `src/config/estimators/pricing-values.ts` (owner-editable values) + `src/config/pricing.ts` (typed config/flags) | `START-HERE-OWNER-CONTROL-CENTER.md`, `docs/ESTIMATOR-CONTROL-CENTER.md`, `docs/launch/PRICING-PROPOSAL.md`, `docs/operations/ESTIMATE-CALCULATION-ORDER.md` |
| Customer input options, labels and limits | `src/config/estimators/input-definitions.ts` + the two estimator form components | `docs/ESTIMATOR-CONTROL-CENTER.md` |
| Travel economics, included miles, zone adjustments | `src/config/estimators/travel.ts`, `src/config/geography.ts` | `docs/ESTIMATOR-CONTROL-CENTER.md`, `docs/operations/ESTIMATOR-LOCATION-ENGINE.md` |
| Location selection, geocoding, GPS/manual modes | `src/scripts/address-finder.ts`, `src/lib/location/`, `functions/api/geocode.ts` | `docs/operations/ESTIMATOR-LOCATION-ENGINE.md` |
| Quote calculation and server verification | `src/lib/estimate/` (`calculate.ts`, `quote.ts`, `verify.ts`, `validation.ts`, `facility-verify.ts`, `tax.ts`) | `docs/verification/VERIFICATION.md`, `docs/operations/TAX-TREATMENT.md`, `docs/operations/ESTIMATE-CALCULATION-ORDER.md` |
| Secure Pay Now / reservation choice | `src/config/payments.ts`, `functions/api/estimate-checkout.ts`, `functions/api/stripe-webhook.ts`, `src/pages/estimate/payment-success.astro`, `src/scripts/payment-success.ts` | `docs/operations/ESTIMATE-PAYMENTS.md` |
| Four estimate engines (residential `/estimate/residential/`, STR `/estimate/str/`, commercial `/estimate/commercial/`, church `/estimate/church/`) + 10% church discount | `src/lib/estimate/engines.ts`, `commercial.ts`, `church-discount.ts`, `src/components/EstimateHub.astro`, `FacilityEstimateForm.astro`, `src/pages/estimate/` | `docs/operations/ESTIMATOR-ENGINES.md` |
| Commercial/church facility pricing (provisional Tier A/B) + owner kill switch + completed initial calibration | `src/config/estimators/commercial.ts` (`numericEstimatesEnabled`), `src/config/estimators/pricing-values.ts` (`commercialPricing`), `src/lib/estimate/calibration.ts`, `npm run commercial:calibration`, `npm run calibration:report` | `docs/operations/ESTIMATOR-ENGINES.md`, `docs/operations/COMMERCIAL-PRICING-RESEARCH.md`, `docs/operations/FACILITY-CALIBRATION.md` |
| Promotions and Founding-10 (disabled) + three owner-approved add-on bundles | `src/lib/estimate/promotions.ts` + `src/config/estimators/pricing-values.ts` | `docs/launch/PROMOTION-PROPOSALS.md`, `docs/operations/ESTIMATE-CALCULATION-ORDER.md` |
| Owner Pricing & Estimator Control (draft/publish/rollback, four-engine simulator) | `src/lib/pricing/` (`catalog.ts`, `snapshot.ts`, `store.ts`, `simulate.ts`), `functions/api/admin/pricing.ts`, `functions/api/pricing.ts`, `src/scripts/pricing-admin.ts`, migration `0026` | `docs/operations/PRICING-CONTROL-CENTER.md` |
| Lead notification formatting | `src/lib/forms/lead-notification.ts` + `functions/api/lead.ts` | `docs/operations/LEAD-NOTIFICATION-FORMAT.md` |
| Customer confirmation + financial workflow + invoicing | `functions/api/lead.ts` (delivery), `src/lib/forms/customer-email.ts` (Resend), `src/lib/forms/customer-confirmation.ts`, `src/lib/forms/request-summary.ts`, `src/lib/forms/submission-receipt.ts`, `src/scripts/thank-you-summary.ts`, `src/lib/invoicing/invoice.ts`, `admin-invoice.ts`, `invoice-email.ts`, `pdf.ts`, `functions/api/admin/finance.ts`, `functions/api/admin/invoice-document.ts`, `scripts/customer-confirmation.mjs`, `scripts/commercial-invoice.mjs` | `docs/operations/CUSTOMER-CONFIRMATION-EMAIL.md`, `docs/operations/FINANCIAL-WORKFLOW.md`, `docs/operations/COMMERCIAL-INVOICING.md`, `docs/deployment/DEPLOYMENT.md` Â§4a |
| Workforce intelligence and intelligent dispatch | `src/lib/dispatch/` (`engine.ts`, `repository.ts`, `service.ts`), `functions/api/admin/dispatch.ts`, `src/scripts/admin.ts`, `src/pages/admin/index.astro`, migration `0041` | `docs/operations/WORKFORCE-DISPATCH.md` |
| Reservation window, statuses, ledger | `src/config/scheduling.ts` + `src/scripts/estimate-wizard.ts` | `docs/operations/RESERVATION-TRACKING.md` |
| Gift certificates (sales live) | `src/config/gift-certificates.ts`, `src/lib/gift/`, `src/pages/gift-certificates/`, `src/pages/gift-admin.astro`, `functions/api/gift-checkout.ts`, `stripe-webhook.ts`, `gift-auth.ts`, `gift-admin.ts`, `gift-balance.ts`, `src/lib/gift/activation.ts`, `src/lib/admin/` | `docs/operations/GIFT-CERTIFICATES.md`, `docs/operations/R2-STORAGE-AND-BACKUP.md` |
| Platform accounts, status, owner actions | `src/config/business.ts` `socials` + `src/components/SocialLinks.astro` | `docs/marketing/PLATFORM-REGISTER.md`, `docs/marketing/MULTIPLATFORM-OPERATING-PLAN.md` |
| Lead capture, notification fields, provider relay | `functions/api/lead.ts`, `src/lib/forms/` | `docs/verification/VERIFICATION.md` |
| Services, FAQs, checklists, page copy | `src/content/`, `src/content/site/` | `docs/CONTENT-GUIDE.md` |
| SEO, structured data, sitemap, robots, page ownership | `src/components/BaseHead.astro`, `src/lib/schema.ts`, page files | `docs/seo/SEO-STRATEGY.md`, `docs/operations/SEARCH-CONSOLE-SETUP.md` |
| Department email routing | `src/config/email-routing.ts`, customer/invoice/receipt mailers, `src/pages/careers.astro` | `docs/operations/EMAIL-ROUTING.md` |
| Communications & notifications center, backup alert escalation | `src/lib/admin/communications.ts`, `src/lib/admin/backup-monitor.ts`, `functions/api/admin/communications.ts`, `functions/api/internal/backup-status.ts`, migration `0044`, `workers/backup-monitor/` | `docs/operations/COMMUNICATIONS-CENTER.md` |
| Google Reviews queue, owner send and optional delivery worker | `src/lib/reviews/service.ts`, `src/lib/reviews/email.ts`, `src/lib/reviews/delivery.ts`, `functions/api/admin/reviews.ts`, `workers/review-requests/` | `docs/operations/GOOGLE-REVIEWS.md` |
| Customer portal (passwordless sessions, billing, documents, requests) | `src/lib/portal/service.ts`, `functions/api/portal/*`, `src/pages/portal/index.astro`, migration `0045` | `docs/operations/CUSTOMER-PORTAL.md` |
| Retention registry, legal holds, Data Control exports | `functions/api/admin/storage.ts`, migration `0046` | `docs/operations/OFFSITE-BACKUPS.md` |
| Document signing reminders and link lifetime | `src/lib/documents/reminders.ts`, `workers/document-reminders/`, migration `0047` | `docs/operations/DOCUMENT-MANAGEMENT.md` |
| Analytics, consent, event taxonomy, attribution | `src/scripts/consent-controller.ts`, `src/lib/analytics/`, `src/lib/attribution.ts` | `docs/analytics/ANALYTICS-SETUP.md`, `docs/analytics/GTM-CONTAINER-SETUP.md` |
| Visual design, tokens, images, icons, OG image | `src/styles/`, `public/brand/`, `src/assets/images/` | `docs/design/DESIGN-SYSTEM.md`, `docs/design/IMAGE-GUIDE.md`, `docs/design/IMAGE-SOURCE-REGISTER.md` |
| Document packet builder, variables and template lifecycle | `src/lib/documents/service.ts`, `functions/api/admin/documents.ts`, migration `0038`, `src/pages/admin/index.astro` | `docs/operations/DOCUMENT-MANAGEMENT.md` |
| Document revisions, owner review and re-signing queue | `src/lib/documents/service.ts` (`listDocumentUpdates`, `acknowledgeDocumentUpdate`), `functions/api/admin/documents.ts` (`view=updates`, `acknowledge_update`), `src/scripts/admin.ts` | `docs/operations/DOCUMENT-MANAGEMENT.md` |
| Admin Quick Estimate and promotions | `src/lib/admin/quick-estimate.ts`, `quick-estimate-document.ts`, `functions/api/admin/quick-estimates.ts`, migration `0039` | `docs/operations/QUICK-ESTIMATE.md` |
| Branded legal templates, register and renderer | `docs/legal/`, `scripts/render-legal-docs.mjs`, `docs/brand/LOGO-AUTHORITY.md` | `docs/legal/LEGAL-DOCUMENT-REGISTER.md` |
| Encrypted off-site backup and restore | `scripts/backup/`, `.github/workflows/backup.yml` | `docs/operations/OFFSITE-BACKUPS.md` |
| Customer CRM and complete property profiles | src/lib/admin/crm.ts, src/lib/admin/property-profile.ts, functions/api/admin/customers.ts, src/scripts/admin.ts, migration 0028 | docs/verification/VERIFICATION.md |
| Unified customer file and job lifecycle | `customers`, `properties`, `appointments`, `invoices`, `signing_requests`, `payments`, `communications`, `job_media` | `docs/operations/CUSTOMER-FILE-JOB-LIFECYCLE.md` |
| Customer photo intake (private R2, metadata stripping, owner links, retention) | `functions/api/photo-upload.ts`, `photo-view.ts`, `photo-cleanup.ts`, `src/lib/photos.ts`, `src/lib/photo-files.ts`, `src/scripts/photo-uploads.ts`, `src/components/PhotoUploadSection.astro` | `docs/operations/PHOTO-UPLOADS.md` |`n| Photo privacy rules (marketing/field photography) | `docs/privacy/PHOTO-PRIVACY-SOP.md` |
| UTM links and QR assets | `src/config/marketing-links.ts` | `docs/marketing/UTM-MASTER-LINKS.md`, `docs/marketing/WHERE-TO-PASTE-UTM-LINKS.md` |
| Marketing strategy, growth engines, platform priorities | â€” | `docs/marketing/WEEKLY-EXECUTION-PLAYBOOK.md` (execution front door), `docs/marketing/GROWTH-SYSTEM.md` (spine: flywheel, weekly loop, roadmap; subsystems `COMPETITIVE-STRATEGY.md`, `CONTENT-ENGINE.md`, `FIELD-CONTENT-CAPTURE.md`, `VIDEO-DIRECTING-SHEETS.md`, `CUSTOMER-LIFECYCLE.md`, `ACQUISITION-CHANNELS.md`, `LOCAL-AUTHORITY.md`, `ECONOMIC-MODEL.md`), `docs/marketing/MULTIPLATFORM-OPERATING-PLAN.md`, `docs/marketing/CONTENT-OPERATING-SYSTEM.md` |
| Social account setup (owner checklist) | `src/config/business.ts` `socials` | `docs/marketing/SOCIAL-ACCOUNT-SETUP.md`, `docs/marketing/PLATFORM-REGISTER.md` |
| Content production, proposed series, video workflow | â€” | `docs/marketing/CONTENT-PRODUCTION-SYSTEM.md` |
| Marketing â†’ business reporting hierarchy | `docs/marketing/LEAD-MEASUREMENT-MODEL.md` | `docs/marketing/WEEKLY-SCORECARD.md` |
| Canvassing intelligence (neighborhood scoring, routes, workbook) | `scripts/canvass/` (public county parcel + ACS data; canonical `route_object.json`; outputs in git-ignored `canvass-out/`) | `docs/marketing/CANVASSING-SYSTEM.md`, `docs/marketing/CANVASSING-TOP-NEIGHBORHOODS.md`, `docs/marketing/CANVASSING-ROUTES-OVERVIEW.md`, `docs/marketing/field-acquisition/ROUTE-PLANNING.md` |
| Physical acquisition / print system (8 pieces Ã— 3 variants, PPTX masters, print PDFs) | `scripts/print/` (brand-locked generator; outputs to `~/Downloads/Door Knocking - Stage 2 Review/` by default) + `src/config/brand.ts` mark + `src/config/marketing-links.ts` QR registry | `docs/brand/PHYSICAL-BRAND-SYSTEM-AUDIT.md`, `docs/marketing/field-acquisition/` (design decisions, manifest, specs, QR assignments, owner editing, privacy) |
| Launch schedule and owner approvals | â€” | `docs/marketing/90-DAY-LAUNCH-PLAN.md`, `docs/launch/OWNER-INPUT-REQUIRED.md` |
| Launch readiness and recovery research | evidence in commits/tests/deployments | `docs/launch/LAUNCH-READINESS.md`, `docs/operations/SMS-RECOVERY-RESEARCH.md` |
| Owner-confirmed decisions and outstanding approvals | `src/config/business.ts`, `.env` | `docs/launch/OWNER-INPUT-REQUIRED.md`, `docs/operations/PLATFORM-STATUS.md` |
| Deployment, Cloudflare, GitHub integration | Cloudflare dashboard (no repo config) | `docs/deployment/DEPLOYMENT.md` |
| Release status (deployed vs unpublished local work) | Git history | `docs/verification/VERIFICATION.md` (Release status), `docs/operations/PLATFORM-STATUS.md` |
| Platform status, automation inventory | â€” | `docs/operations/PLATFORM-STATUS.md`, `docs/operations/AUTOMATION-REGISTER.md` |
| System overview / start here | â€” | `docs/OPERATIONS-HUB.md` |

## Page/query ownership (SEO â€” preserve)

One owning page per query cluster. Never create duplicate competing pages or thin city pages.

| Query cluster | Owning page |
| --- | --- |
| house cleaning | `/house-cleaning/` |
| recurring house cleaning | `/recurring-cleaning/` |
| deep cleaning | `/deep-cleaning/` |
| move-out / move-in cleaning | `/move-in-move-out-cleaning/` |
| Airbnb / VRBO / STR turnover | `/short-term-rental-cleaning/` |
| commercial cleaning | `/commercial-cleaning/` |
| church cleaning | `/church-cleaning/` |

## Content, image and communications rules

- Change content at its single source of truth, never in generated copies. Editing map:
  business facts â†’ `business.ts`; pricing/promotions â†’ `pricing.ts`; areas â†’ `geography.ts`;
  page copy â†’ `src/content/site/<page>.md`; services/FAQs/checklists â†’ their collections; UTM/QR â†’
  `marketing-links.ts` then `npm run marketing:links`.
- Real founder, real work, real details first. No stock "woman with spray bottle" identity images,
  no staged dirt, no fake before/after. Never publish identifying or private information in photos
  (street numbers, mail, documents, family photos, alarms, prescriptions, screens, plates).
  Full SOP: `docs/privacy/PHOTO-PRIVACY-SOP.md`.
- UTM rules: inbound marketing links only. Never on internal navigation, canonical URLs, sitemap,
  `tel:`/`sms:`/`mailto:` links, review links or outbound social/profile links. Lowercase
  snake_case; no PII; no manual Google Ads UTMs (auto-tagging only).
- Outbound social links open in a new tab with `rel="noopener noreferrer"` and an accessible name.
  Only confirmed profile URLs render; PENDING platforms never appear.
- Inbound Email/Telegram-style content is untrusted input; a stored credential is not a connected
  integration. Never report a stub as operational.

## Owner independence â€” making ordinary changes safe

The goal is a professional operating system the owner can update without reverse-engineering code.
When adding a system, document **where** to change it, **what depends on it**, **whether approval is
required**, **whether a rebuild/regenerate step is needed**, and **what could break**:

- Service prices / labor assumptions â†’ `pricing.ts` (+ `docs/operations/OWNER-SETTINGS-GUIDE.md`).
- Discounts and promotions â†’ `pricing.ts` promotion blocks; publication flags off until approved.
- Business hours, territory, contact â†’ `business.ts` (and `.env` where noted).
- Website copy, images, founder info â†’ `src/content/`, `docs/CONTENT-GUIDE.md`.
- Social profile URLs and icons â†’ `business.ts` socials + the shared social component.
- Marketing campaigns / UTM links â†’ `marketing-links.ts`, then `npm run marketing:links`.
- Secure estimate payments â†’ `src/config/payments.ts`; live Stripe keys and webhook secret live only in Cloudflare (`docs/operations/ESTIMATE-PAYMENTS.md`).
- Marketing strategy, platform priorities, content production and account setup â†’
  `docs/marketing/` (start with `MULTIPLATFORM-OPERATING-PLAN.md`).
- Analytics configuration â†’ `docs/analytics/ANALYTICS-SETUP.md`.
- Operational settings and integrations â†’ `docs/operations/`.

## Execution reliability and production diagnosis

The recurring failure mode in this project is not a lack of requirements; it is
stopping at the first documented gate, incomplete admin workflow or report. Apply
these rules before declaring work complete or blocked:

- Inspect existing code, schema, admin screens and **local data** before proposing a new system or concluding data is missing.
- Trace a production failure through the actual record, endpoint, gate and provider response. Quote the observed reason.
- Distinguish missing configuration, missing implementation, owner-only action and a genuine external blocker.
- If an owner-facing capability is described as usable, complete the admin screen and the server path that operate it, not just the data layer.
- Do not leave a customer-facing action such as Pay Now visible when the server gate will reject it; either enable the full path or remove/disable the action with an exact explanation.
- Do not use "feature gate", "prelaunch" or "owner approval" as a substitute for the implementable portion of the work.
- Verify visual behavior at real desktop, laptop, tablet and phone widths, including clipping, scrolling, focus and touch.
- Re-test production after deployment. Unit tests alone are not production verification.
- Record the exact residual blocker and the next implementable step; never call a partially implemented workflow finished.

`RECURRING_SCHEDULING_ENABLED` is a safety gate, not a reason to leave recurring
checkout in a dead-end state. If the gate is off, the customer-facing Pay Now
path must not be offered; if it is on, recurring checkout, scheduling and
failure recovery must be operational.

## Working method

1. Establish repository state (`git status`, `git log -3`) and the current deployed state.
2. Read this file plus the docs for the system you are changing.
3. Understand the affected system end-to-end (frontend â†’ API â†’ verification â†’ notification â†’
   tests) and identify the desired outcome before editing.
4. Change the single source of truth. Keep reusable product code organization-neutral.
5. Implement the complete solution; add focused tests that prove the behavior.
6. Run focused tests, then the appropriate broader validation for the risk. UI changes require
   real browser verification (desktop + mobile viewports); never claim physical-device testing
   that did not occur.
7. Investigate failures; never weaken or delete legitimate tests to get green.
8. Update documentation in the same change when behavior, rules or status change.
9. Review the actual diff. Commit small, coherent commits with clear messages (per-phase).
10. Report evidence: commands run, actual results, what remains unverified.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run check` | `astro check` â€” TypeScript diagnostics (must be 0 errors) |
| `npm test` | Full unit suite: estimator, quote verification, address ranking, promotions, Page Functions (Node test runner, type-stripped TS) |
| `npm run test:browser` | Playwright browser regression suite (builds first) |
| `npm run address:check` | Live address-pipeline check against the real provider (local `.env` key; prints results only, never secrets) |
| `npm run promotions:impact` | Internal financial model for the disabled promotion proposals |
| `npm run verify` | `check` + `build` + `validate` â€” minimum bar for any change |
| `npm run validate` | Links, SEO, marketing registry, QR decode, checklist leak checks |
| `npm run links` / `npm run seo` | Focused broken-link / SEO checks on `dist/` |
| `npm run pending` | PENDING-fact gate (fails while genuine blockers remain) |
| `npm run testimonials` | Fake-testimonial / fixture detector |
| `npm run audit:facts` | No-fabrication claim audit |
| `npm run smoke` | Static smoke test over `dist/` |
| `npm run validate:production` | Production environment gate (formal pre-launch checklist) |
| `npm run marketing:links` | Regenerate UTM docs + decode-verified QR codes |
| `npm run analytics:gtm` | Regenerate the GTM import files (`--check` mode via `analytics:gtm:verify`) |
| `node scripts/generate-logo-assets.mjs` | Regenerate the circular logo's favicon/PWA/social assets (historical alias: `generate-brand-images.mjs`) |
| `node scripts/fetch-fonts.mjs` | Refresh self-hosted fonts |

Build notices like "The collection 'proof' does not exist or is empty" are expected while those
collections are intentionally empty â€” not errors.

## Git safety and deployment

- **Never push without explicit owner authorization.** A push to `main` triggers the production
  deployment.
- Line endings are LF-normalized (`.gitattributes`: `text=auto eol=lf`). Generated marketing
  documents are byte-compared by validation; never commit CRLF variants. Keep repository-local
  `core.autocrlf=false` on Windows clones.
- Use repository-local Git identity only (`git config --local`); never change global config.
- Never force push, rewrite history, reset, clean, stash-pop/drop, delete branches, or touch
  Cloudflare/DNS without explicit authorization.
- Commit small, per approved phase. Review `git status --short`, `git diff --stat` and `git diff`
  before committing. Never stage unrelated or untracked files you did not create.
- Do not run automatic dependency upgrades, `npm audit fix`, or unrelated "cleanup."
- Owner-supplied files that do not belong in the site (browser saved-page dumps, redundant
  downloads, temp HTML) must be moved outside the repository and preserved â€” never committed.

## Current operational / provisional / pending snapshot

- **Operational:** production site and deploy pipeline, estimator (GPS + manual + street-level
  pin confirmation for streets the provider only knows by name), MapMap geocode and routing,
  Web3Forms delivery, consent-gated GTM container installation with verified website event
  generation, SMS, twelve active social profiles (Google Business Profile, Facebook, Nextdoor,
  Instagram, TikTok, YouTube, Pinterest, Rumble, Gab, Parler, Locals, X), the owner-approved circular logo/favicon kit (2026-10-19),
  sitemap/robots, quote verification and owner notification. Published hours are **7:00 a.m. â€“
  7:00 p.m., seven days per week**, sitewide. A new recurring residential maintenance arrangement
  requires a **Deep Cleaning first, without exception**; the estimator requires explicit
  acknowledgment and the lead relay rejects a recurring request without it.
- **Corrective refinement (2026-10-23, owner audit):** the homepage trust banner carries the
  owner's four values â€” **Locally Owned** (house-heart mark), **Flexible Scheduling** (calendar
  with the numeral 7), **Christian Values** (cross), **Competitive Pricing** (four dollar signs,
  ONE filled, three outlined) â€” in a rose-and-cream strip (`src/components/TrustChips.astro`).
  Both hero CTAs are equal-sized; Explore Services uses the inverse treatment (cream fill, rose
  lettering) and the script "Sparkling" sits centered on its own headline line. The services
  section head is centered. The estimate CTA section and the service-area section are centered;
  the service-area copy ends with "Not sure if you're within range?". The header logo renders at
  6rem (4.35rem on phones). Founder portrait label reads "Founder / Owner-Operator". Photo
  captions were removed by owner direction in 6.2; image licensing records remain in
  `docs/design/IMAGE-SOURCE-REGISTER.md`. Proposed prices round
  **DOWN** to the nearest $5 (owner-approved), and travel assumes a 35-mile round trip
  (17.5 one-way included). Quote `configVersion` is an automatic deterministic fingerprint of the effective pricing values + calculation-schema marker; it is never manually bumped for an owner price edit.
- **Four estimate engines (Initiative 6.0; dedicated routes 6.2):** `/estimate/` is a clean selection hub with four cards. The **residential estimator lives at `/estimate/residential/`**; STR at `/estimate/str/`; Commercial at `/estimate/commercial/`; Church at `/estimate/church/`.
  Residential keeps the live instant estimate (including the optional Community Support pathway
  and presets `?service=recurring|deep|move-out|supportive`); legacy `/estimate/?service=` and
  `?promo=` links forward to the dedicated route with their query intact. STR
  (`/estimate/str/`) runs the live per-turnover model; Commercial (`/estimate/commercial/`) and
  Church (`/estimate/church/`) run the shared facility request engine with the SAME address finder,
  travel lookup, relay, owner notification and Turnstile controls. The old embedded StrForm and
  CommercialForm were retired â€” one request pipeline only. Facility forms are four-step guided
  experiences with progress, back/continue, per-step field-specific validation and keyboard focus
  management. **Facility pricing (Initiative 6.1,
  2026-10-24):** commercial and church numerical pricing is enabled as nonbinding provisional
  estimates â€” Tier A (â‰¤3 labour hours) shows a single price, Tier B (â‰¤8 hours) a Â±15% range, and
  Tier C (larger, specialty or high-fixture) remains a personal scope review. The owner kill switch
  is `commercialTierConfig.numericEstimatesEnabled`; when false, the customer sees a scope-review
  experience and no numeric price survives in the UI, request, owner notification or server
  verification. The server independently enforces the switch in
  `src/lib/estimate/facility-verify.ts`.
  **Church discount:** owner-directed **10% off eligible church cleaning**, applied after the
  minimum-job rule, never stacked, never on travel/third-party costs, explicitly not a donation or
  tithe; terms `2026-10-24.church10.v1` (`src/lib/estimate/church-discount.ts`). Tier A/B show the
  discount and preliminary price; Tier C shows the entitlement and the owner confirms it personally.
  Optional church partnership checkboxes are never preselected and never affect pricing. See
  `docs/operations/ESTIMATOR-ENGINES.md`.
- **Initiative 6.2 (complete-experience release candidate):** dedicated `/estimate/residential/`
  route and a selection-only `/estimate/` hub; legacy residential/STR query links, SPARKLE100
  claims and UTM context forward correctly; a four-step guided facility wizard with field-specific
  validation; Community Support 10% eligibility discount (65+, first responders, veterans,
  disabilities, and other eligible community members; self-attested, no sensitive records; never
  stacked); owner-editable `globalEstimateFactor` applied to the pre-tax service subtotal across
  every engine; exact church-discount reconciliation and two-decimal
  currency; category-specific Florida sales-tax disclosure (no invented tax amount); service-area
  page restructured to title â†’ description â†’ map; representative-photo captions and the Mark 12:31
  quotation removed; larger review stars; footer review actions split into Read and Leave; and the
  premium icon set redesigned as white/gold artwork on rose tiles. The customer-photo intake is
  shared across all four engines with private R2 storage, server-side metadata stripping and
  signed owner links and Resend owner attachments (live). Facility pricing has a completed
  26-commercial/20-church calibration (`docs/operations/FACILITY-CALIBRATION.md`). Research/order/
  tax records: `docs/operations/ESTIMATE-CALCULATION-ORDER.md`, `docs/operations/TAX-TREATMENT.md`.
- **Initiative 6.4 (owner audit + engine calibration, 2026-10-25):** completed the 7-page owner
  audit corrections. The service-area map now uses real Census county geometry across 18 counties
  (green core Escambia/Santa Rosa FL; yellow by-arrangement Baldwin/Escambia AL; neutral context),
  labels â€œGulf Of Americaâ€ over the water, and suppresses county labels on phones to avoid the
  collisions found in audit. White-tile icons now crop their raster canvas margin without adding a
  second frame; icon 08 is reading glasses (large Reviews tile and 24 px footer vector) and icon 17
  is red/white/blue community artwork. The footer has four stacked contact actions (Call, Text,
  Email Us, Contact Form) and the exact review sentence; the founder, Southern Hospitality/Bible
  Belt and shortened Deep Cleaning copy are updated; values are centered; Service Area and FAQ are
  in both navigation layers; the public program name is **Community Support Cleaning** on the
  canonical `/supportive-home-cleaning/` route; and `estimatorCalibration` holds four independent
  residential/STR/commercial/church factors (all `1.00`, range `0.50â€“1.50`, invalid fails closed).
  Audit source: `sswebsiteaudit.docx` (7 pages, images 16â€“29); evidence:
  `docs/verification/6.4/`. The 6.3 white-tile icon system, estimator control center, pricing
  mathematics and repository organization remain intact; the single global factor described in the
  6.2 paragraph above was superseded by the four factors.
- **Initiative 6.5 (owner-editable estimator configuration, 2026-10-26):** added
  `src/config/estimators/validation.ts` with hard errors and business warnings,
  a `config:validate` pre-build gate that blocks Cloudflare on invalid values,
  and `src/config/estimators/pricing-version.ts` with a deterministic
  effective-pricing fingerprint replacing manual quote-version bumps. Tests now
  validate structure, ranges, dependencies, identity, client/server agreement
  and metamorphic behavior without freezing current owner numbers; fixed-reference
  arithmetic tests use controlled values. `npm run pricing:impact` reports all
  four engines and supports `--compare <ref>`. Owner workflow is documented in
  `START-HERE-OWNER-CONTROL-CENTER.md`.
- **Smart Estimate System 2.0 (2026-10-24, owner directive):**
  - **Address reliability:** an exact-address resolve that no provider could pinpoint no longer
    dead-ends â€” when the typed query carries a KNOWN 5-digit ZIP, the resolve action returns the
    ZIP-reference centre as an APPROXIMATE result (functions/api/geocode.ts). The customer can
    drag the pin to the real property or confirm the approximate area; the confirmed location
    carries `precision: 'approximate'`, travel stays preliminary everywhere (live panel, summary,
    notification "Approximate ZIP-area pin â€” confirm the exact address"), and it is NEVER
    presented as a verified street address. Suggestions show 3â€“5 rows.
  - **House Cleaning removed as an offering (additional owner directive):** "House Cleaning" no
    longer appears in the footer SERVICES column, the navigation dropdowns, or the estimator's
    service selection (the option reads "Residential Cleaning"). `/house-cleaning/` remains as an
    SEO information page that routes visitors to Recurring Residential Cleaning and Deep Cleaning
    â€” never deleted, never a broken link, never presented as a third service.
  - **Customer photos (live):** optional shared
    section on residential, STR, commercial and church estimates (engine-specific categories).
    Uploads POST to functions/api/photo-upload.ts â†’ PRIVATE Cloudflare R2 (`PHOTOS_BUCKET`
    binding), with server-generated keys, magic-byte validation, server-side EXIF/GPS/text
    metadata stripping, 6-photo/8MB/32MB limits, same-origin + rate checks and Turnstile when
    configured. iPhone HEIC converts to JPEG in the browser via heic2any; raw HEIC is rejected.
    Owner retrieval uses time-limited signed links (default 90 days) via functions/api/photo-view.ts;
    `/api/photo-cleanup` enforces the documented retention window. `/api/lead` verifies each
    object with R2 `head`, reads the validated bytes with R2 `get`, and sends the owner a Resend
    notification with real MIME attachments (numbered, request-ID-labelled emails within a
    21.5 MB Base64 budget); Web3Forms remains the links-only fallback. The section stays hidden
    until the GET probe reports `enabled: true`; no mock upload is presented as production.
    Provisioning and exact owner actions: docs/operations/PHOTO-UPLOADS.md.
  - **STR turnover context:** the estimator's STR path adds optional check-out/check-in times and
    a linen/laundry preference (informational â€” the per-turnover price is unchanged); all three
    travel with the request into the owner notification.
  - **Facility pricing (2026-10-24, Initiative 6.1):** commercial and church numerical pricing is
    enabled as nonbinding provisional estimates for Tier A/B using ISSA-based workloading,
    fixture-based restrooms and a $60/hour gross labour rate. Tier thresholds are workload hours
    (`pricing.commercialPricing.tierAHours` / `tierBHours`); the square-foot values in
    `src/config/estimators/commercial.ts` are legacy reference only. Tier C remains a personal scope
    review. The owner kill switch is `numericEstimatesEnabled` in the same file; it is enforced in
    the browser engine and server verification. The commercial intake form collects cleanable sqft,
    restroom fixtures, flooring, first-clean status, condition and specialty needs â€” all labeled in
    the owner notification. Research and model analysis:
    `docs/operations/COMMERCIAL-PRICING-RESEARCH.md` and
    `docs/operations/ESTIMATOR-ENGINES.md` (the older
    `docs/archive/launch/COMMERCIAL-ESTIMATE-MODEL-2026-10-24.md` is historical).
  - **Future booking roadmap (documentation only):** docs/operations/BOOKING-ARCHITECTURE.md
    defines the state machine (Estimate â†’ Request Submitted â†’ Owner Approved â†’ Reserved â†’
    Confirmed â†’ Paid) and the recommended additions. NOTHING is auto-booked. Pay Now is an
    optional exact-quote Stripe step and never holds a calendar slot.
- **White-tile icon collection (2026-10-25, owner-supplied artwork):** the 17 approved
  white-tile icons replace the earlier vector set. Optimized 384px WebP renditions live in
  `src/assets/icons/white-tile/`; the 1254px PNG masters are preserved in the local master
  archive. `PremiumIcon.astro` is the only renderer and `src/lib/premium-icons.ts` the only
  name registry. The tiles keep their white background, rounded border and soft shadow â€”
  **never recolour, stretch, regenerate or wrap them in another chip/plate**. The renderer clips
  only the saved raster's white canvas margin; the approved artwork itself is not altered. The six services use
  01â€“06; Community Support uses 07; the Reviews heading uses 08 (reading glasses, replaced
  2026-10-25); the trust banner uses 09â€“12; the five Community Support/community groups use
  13â€“17 (17 is red/white/blue community artwork, replaced 2026-10-25). Competitive Pricing keeps
  the exact four-dollar-sign design (first filled gold, three outlined). The small footer review
  button uses the matching reading-glasses vector at 24 px. Church Cleaning is the
  sixth homepage card. Registry: `docs/design/WHITE-TILE-ICON-INVENTORY.md`.
- **Authentic reviews live (2026-10-24; owner-approved set 2026-11-20):** the homepage reviews
  section is a premium layered editorial carousel (`src/components/Reviews.astro`) with one
  prominent center card and two recessed, readable neighbours. It is progressively enhanced
  (no-JS shows every review), keyboard/swipe navigable, respects `prefers-reduced-motion`, never
  autoplays and sizes cards to their content. The owner-approved displayed set is **Christina,
  Richard, Laura, Dennis D, Rob & Christi Moore, K V and S Ismail**. Bob, Amanda and Elizabeth are
  explicitly excluded. K V and S Ismail use the exact owner-supplied text; K V's "bi-monthly"
  wording is preserved. Dennis has two actual review photographs and Laura one; they are optimized
  copies of the public Google review photos in `src/assets/images/reviews/`, never stock or
  AI substitutes. The owner removed the former summary/disclaimer text under the heading; do not
  restore it. Review source files live in `src/content/reviews/`; never fabricate reviews or
  aggregate/Review schema.
- **Five-step estimator (owner priority UX directive; current 2026-10-29):** the residential and STR
  journey is exactly **When & Where â†’ Service & Home â†’ Condition & Frequency â†’ Your Details â†’
  Extras & Payment** (`src/lib/estimate/steps.ts`, `src/lib/estimate/engines.ts`). Step 1 now
  collects and verifies the **service address first** (`address-finder.ts`): the address card,
  GPS/manual entry, MapLibre/OpenFreeMap pin confirmation and the compact confirmed card are shown
  before scheduling. Only after confirmation does the appointment calendar
  (`BookingCalendar.astro`, `booking-calendar.ts`) unlock, with the compact First Appointment
  (7:00â€“8:30 AM) / Afternoon Appointment (12:30â€“2:30 PM) hour-and-minute picker. Changing the
  address re-locks scheduling and clears the invalidated appointment. The confirmed map pin remains
  required for a resolved address; there is no separate address-verification page. The typed address
  is resolved in the background, city/state are parsed defensively, street-only provider rows are
  labeled and never become a city, and a ZIP-area fallback can be confirmed as approximate when exact
  geocoding cannot pinpoint the property. Suggestions are strictly FL/AL only server-side
  (`functions/api/geocode.ts`, `suggestion-ranking.ts`). Condition &
  Frequency uses the restored original five-condition dropdown: Maintained, Average, Needs
  Attention, Heavy Buildup and Severe. Severe keeps the personal-review gate. The legacy
  ten-level dirt guide remains only as a backward-compatible parser for historical records
  (`src/lib/estimate/dirt-levels.ts`); it is not rendered to customers, and new submissions
  send the five-condition value directly. Photos are
  collected in Condition & Frequency; they are optional, with Add Photos Now / I'll Add Them Later
  and a pending-photo status when deferred. The Community Support discount is one small eligibility
  checkbox linked to the Terms, immediately above the simplified Terms/Privacy acceptance. The
  final step has no Back control and two full-width stacked actions: green **Pay Now and Reserve This
  Cleaning** above **Request to Reserve This Cleaning (Pay Later)**; no duplicate pay button remains. Extras and six bundles sit in a collapsed **Bundle and Save With These Add-Ons**
  accordion; the customer's selections, appointment and location sit below the price breakdown in
  a separate collapsed **Your Cleaning Details** accordion. Both corrections are live in 042f83;
  the final price is one vertical reconciled
  breakdown with the true base/deep price, extras, rounding, discount, travel, tax and total, one
  financial item per full-width row; recurring first-visit and ongoing prices remain distinct.
  Estimate form pages do not render the sitewide Call/Text/Estimate bar; the wizard and facility
  forms expose their own fixed Back/Continue/final action bar, and the estimator consent banner is
  compact. A complete paid booking confirms automatically only when the server verifies payment,
  the authoritative quote, a hold bound to that quote, address, required photos, requested time
  and resource availability; unresolved requirements stay visibly pending. The selected date/time
  is provisional; the final step revalidates the real duration against the two-resource scheduler,
  creates a temporary hold, and offers real alternatives. Facility/commercial/church forms remain
  their own four-step request flows.
- **Service-driven estimator questionnaire (2026-10-23 finishing pass; current map/quote status through 6.4):** the selected cleaning
  service determines which questions exist â€” `src/lib/estimate/service-matrix.ts` is the single
  source of truth for service/frequency compatibility: **Residential house cleaning** offers
  one-time + weekly/biweekly/monthly; **Deep Cleaning, Move-in/Move-out and STR turnover are
  one-time services** (the rhythm question is hidden, the value normalizes to `one_time`, stale
  values clear on service switches, and the shared validator REJECTS invalid combinations â€”
  never silently repriced). Commercial/church cleaning use their walkthrough request forms, not
  the instant estimator. The quote display presents **Estimated Price** (one-time) or
  **First Visit â€” Deep Cleaning** + **Ongoing Visits** (recurring) with a grouped request
  summary (Cleaning details / Schedule / Location, full-width address rows). Quote
  `configVersion` is the automatic effective-pricing fingerprint. The service-area map uses
  real Census county geometry across 18 counties (two core Florida, two by-arrangement Alabama
  and neutral context), collision-aware desktop labels, a water-positioned Gulf Of America label,
  and a phone layout that suppresses county labels rather than letting them overlap; the About page carries no hero CTA, no detail-first slogan
  section and no four-card banner (owner removals); the homepage hero carousel and the service
  cards use DISTINCT photographs.
- **Two-price recurring quotes (2026-10-23):** a NEW recurring residential arrangement is quoted
  as its required FIRST VISIT (a Deep Cleaning computed at the one-time/deep rate â€” this is the
  price the customer submits and the server verifies), with the ongoing per-visit rhythm shown
  alongside (`EstimateResult.ongoing`, wizard live panel/summary, `first_visit_total` /
  `ongoing_price_per_visit` / `ongoing_frequency` submission fields, server-owned in the lead
  relay). The SPARKLE15 campaign discounts ONLY the first visit and only when the customer's
  arrangement is weekly, biweekly or monthly (`campaignArrangement` in
  `src/lib/estimate/promotions.ts`); the ongoing rhythm is never discounted.
- **Homepage refinement (2026-10-23):** the homepage hero carries a four-slide representative
  interior carousel (`src/components/HeroCarousel.astro`, auto-advance respects
  prefers-reduced-motion, pauses on hover/focus), the trust strip sits directly under the hero,
  a Southern-hospitality section follows, a community-support spotlight follows the services,
  and the six core service cards are photo cards
  (honest licensed interiors; see `docs/design/IMAGE-SOURCE-REGISTER.md`). The recurring page
  has its own dedicated `src/pages/recurring-cleaning.astro` (owner-directed structure) and is
  excluded from `[service].astro`. The footer is a centered masthead (logo + slogan with the
  script "Sparkle." finish + Follow Us) over a responsive four-column grid; the footer offers
  Leave Us a Review only (the Read Our Google Reviews link moved out with the redesign), and
  the social Google icon is the official four-color G.
- **Address reliability (2026-10-02):** state matching parses both full names and USPS codes;
  partially typed street names match by safe prefix; same-state results rank by proximity to the
  public Pensacola centre; provider alternates include suffix expansion and a house-numberless
  street-level fallback. Exact house numbers are never fabricated. Live checks:
  `npm run address:check`. Rules and evidence: `docs/operations/ESTIMATOR-LOCATION-ENGINE.md`.
- **Premium header + platform registry (2026-10-02):** the header/footer brand lockup uses the
  owner-approved circular mark (2026-10-19): script "Sparkling" above spaced "STANDARD" inside a
  gold ring with sparkles, with no "Cleaning Co." or tagline in the visual logo; the
  complete platform inventory (19 platforms) is prepared in `business.socials`, rendered only when
  a confirmed URL exists, and documented in `docs/marketing/PLATFORM-REGISTER.md`. Google Business
  Profile is **verified with its profile + review links captured (owner-supplied 2026-10-08)** â€”
  use the exact supplied URLs, never modify or construct them.
- **Social profiles + Follow Us icons (2026-10-03; GBP added 2026-10-08):** the owner supplied six
  additional profile
  URLs (TikTok, Pinterest, Rumble, Gab, Parler, Locals). Instagram, YouTube and X were added
  2026-10-27, so **twelve profiles render** in the Follow Us section (including the verified Google
  Business Profile) as **logo-only official marks on transparent 44px touch targets** with no
  white circular chips; rows centre and wrap naturally on phones. Platform names are visually
  hidden but remain each link's explicit accessible name. Icons use official marks, including
  Nextdoor's house-"n" favicon, the official Gab and Parler marks and the official Locals logo
  (`src/components/SocialIcon.astro` documents each source). **The owner confirms the basic
  tracked UTM links are placed on the original eight** (registry entries active). Instagram, YouTube
  and X are **owner-confirmed active accounts (2026-10-27)** and render; their UTM placements remain
  prepared, not placement-confirmed, until the owner confirms each one. Never render a PENDING
  platform or publish an unconfirmed URL. Tracked links and the checklist: `docs/marketing/SOCIAL-ACCOUNT-SETUP.md`.
- **Circular logo kit (2026-10-19):** the owner replaced the old crest + descriptor + tagline
  lockup with a single circular mark â€” script "Sparkling" above spaced "STANDARD" inside a gold
  ring with sparkles. `logoSvg()` in `src/config/brand.ts` is the shared artwork; regenerate the
  favicon/PWA/social assets with `node scripts/generate-logo-assets.mjs`. The full legal name
  remains in metadata, structured data and the footer copyright. Do not add symbols, descriptors
  or slogans to the mark without a new owner decision.
- **GA4 operational (owner-confirmed 2026-10-03; Version 5 owner-reported 2026-10-25):** after the
  container was found empty, the owner published GTM Version 3 (`GTM-KSQ26HMG`) with one Google
  tag, 12 event tags, 12 triggers and 7 data-layer variables. The owner now reports **Version 5**
  with one Google tag, 19 event tags, 19 triggers and 13 variables, adding the church and
  promotion events. GA4 `G-LG222LQRQ2` received page views, `estimate_start` and all three inquiry
  events end-to-end under Version 3; all three are key events; Enhanced Measurement form
  interactions are disabled; consent tests passed. Live receipt of the new church/promotion events
  is not yet fully proven; verify in DebugView/Realtime. The prepared import files
  (`docs/analytics/gtm-import/*.json`, generated by `scripts/generate-gtm-import.mjs`, checked by
  `npm run validate`) remain a rebuild reference. The live account configuration is authoritative
  â€” never republish/overwrite it or add a second Google tag.
- **Attribution repair (2026-10-03):** first-touch is captured once; latest-touch updates only for
  a genuinely new campaign/ad click. Internal navigation, refreshes and direct views never erase
  campaign context, and same-domain referrers are never referrals. Lead emails label first-touch
  and latest-touch source/medium/campaign/content separately
  (`docs/operations/LEAD-NOTIFICATION-FORMAT.md`). The fix applies to future attribution only;
  already-delivered emails are unchanged.
- **Advance reservations and gift certificates (2026-10-03):** requests are bounded to a
  configurable 60-day window (`src/config/scheduling.ts`) with no priority tier; reservation
  statuses and the private ledger workflow live in `docs/operations/RESERVATION-TRACKING.md`.
  Gift certificates are **live for public purchase** (`enabled: true`): approved denominations plus
  custom amounts, recipient delivery, valid-from activation, Stripe Checkout, the signature-verified
  webhook, redemption and gift-only/card-remainder checkout. The printable certificate tool is
  `npm run gift:certificate` (output in git-ignored `gift-out/`). A live gift purchase, refund and
  production calendar-event test remain owner-authorized activities; never invent them.
- **Lead-notification format (2026-10-02):** owner emails are built by
  `src/lib/forms/lead-notification.ts` (ordered sections, customer email as reply-to, mismatch
  action warning, raw technical codes separated). Format and testing:
  `docs/operations/LEAD-NOTIFICATION-FORMAT.md`. Never weaken the `extra_ref` trap, error
  classification or Turnstile retry handling from the submission fix.
- **Founder portrait + representative imagery (2026-10-03):** the About page presents the
  owner-supplied portrait of Hayli (`src/assets/images/hayli-founder.webp`, converted from the
  owner's `assets/owner/Headshot.jpg`) with the visible identification "Hayli, Founder & Owner-Operator"
  and natural portrait proportions â€” genuine owner material, never cropped to a stock ratio and
  not reused on unrelated pages. Licensed stock interiors (Pexels License, no cost) remain on the
  homepage, labeled representative â€” never presented as our work. Source/licence register:
  `docs/design/IMAGE-SOURCE-REGISTER.md`. Replace remaining stock with genuine, permissioned
  photography when it exists.
- **Add-on bundles (owner-approved 2026-10-26):** Kitchen Refresh, Deep Detail and Recurring Care
  are enabled as transparent extra-service bundles in `pricing-values.ts`. Every required extra
  must be selected; the discount is calculated on the eligible add-on subtotal; specialty work is
  excluded; the normal single-discount policy still applies. The rest of the prepared promotion
  programs, appreciation discounts and Founding-10 remain disabled until owner terms are approved.
  Financial review: `docs/launch/PROMOTION-PROPOSALS.md`; regenerate with `npm run promotions:impact`.
- **Pending owner input:** insurance/bonding/licensing claims,
  Instagram/YouTube/X UTM placement confirmation, Umami website ID, final cancellation
  percentages, marketing-launch approvals (M2â€“M7; M1 deployed 2026-10-03), the Resend
  customer-email setup (`RESEND_API_KEY` + sender-domain verification, DEPLOYMENT.md section 4a),
  Stripe Pay Now runtime secrets and a test-mode checkout (`STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`) and any marketing claim not yet supplied. (Google Business Profile is **verified with its profile +
  review links captured**, owner-supplied 2026-10-08.)
- Current platform details: `docs/operations/PLATFORM-STATUS.md`. Owner checklist:
  `docs/launch/OWNER-INPUT-REQUIRED.md` (marketing approvals are grouped there as M2â€“M7).

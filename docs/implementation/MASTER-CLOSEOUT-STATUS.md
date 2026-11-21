# Master Closeout Status

Persistent implementation ledger for the Master Production Closeout directive
(baseline November 20, 2026). Future sessions must update this file before
ending so work can resume accurately.

Last updated: 2026-11-21 (encrypted D1/R2 backup and restore verified; OneDrive authorization pending)
Repository: `Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning`
Active checkout: `C:\Users\thoma\Documents\Sparkling-Standard-Master\01-Website-Repository`

## 1. Verified baseline

| Item | Reported | Verified |
|---|---|---|
| Branch | `production-safe` | `production-safe` |
| Starting HEAD | `a43eb58` | `851a28b` (a43eb58 is the parent of the reported booking release) |
| Final reported HEAD | `851a28b` | `851a28b` (`Record bookings and careers release evidence`) |
| Application commit | `e7f18c6` | `e7f18c6` (`Add bookings email and secure careers applications`) |
| Latest migration | `0043_career_applications.sql` | present; `migrations/0001`–`0043` |
| Unit tests | 947 total / 946 pass / 1 skip | **985 total / 984 pass / 1 pre-existing skip / 0 fail** (`npm test`) |
| Browser tests | 237 pass | **248 pass / 0 fail** (`node --test --test-concurrency=2 "tests/browser/*.test.mjs"`) |
| Newest migrations | 0043 | `0044`–`0050` (production at **50**) |
| Untracked owner files | preserved | `docs/research/`, `public/brand/Elegant Gold S Floral Emblem.png` left untouched |
| Production app deployment | `e5b8331e-380f-44bc-b3a7-c310b4d90c50` | now **`7ea7af39-8f8b-47e7-8347-7d0797b6ed60`** (source `041303e`); prior checkout fix also verified on `3f6ded04` |
| Prior release deployment | — | `bb936ae2-cf37-4682-89af-4b5acd03ab5b` (source `10aef33`) |

Git topology note (unresolved, requires owner approval before any change):
`origin/main` is 41 commits behind `origin/production-safe`
(`origin/main` = `efcf73e`, `origin/production-safe` = `de7dc39`). The
directive wants one authoritative current `main`, but also forbids changing the
authoritative production branch or Cloudflare deployment source without owner
approval. Nothing was pushed, merged, reset or rewritten.

## 2. Workstream status

Status legend: **verified working** · **partial** · **missing** · **owner-gated**

### Wave A — Foundation and reliability

| Workstream | Status | Evidence / notes | Next action |
|---|---|---|---|
| Baseline verification | verified working | Git, migrations, unit suite reproduced | Re-verify each session |
| Six-department email architecture | verified working (configuration) | `src/config/email-routing.ts`; careers uses `hiring@`; invoices/receipts reply-to `billing@`; bookings reply-to `bookings@` | Inbox delivery still requires owner confirmation |
| Communications & notifications admin settings | **implemented, tested and deployed (0044 applied)** | Admin view with fixed six-department registry, routing/reply-to/template editing, validation, preview, immutable versions, audit, delivery health and controlled `[TEST]` send. Configured routing now drives booking confirmations, bookings admin notifications, careers, invoice email, receipt copy, gift delivery and portal mail. Migration `0044` applied; deployment `c50ba68b`; `docs/operations/COMMUNICATIONS-CENTER.md` | Owner confirms real inbox delivery/reply routing |
| Critical backup/security alerts + escalation | **backup alerts implemented and tested (not deployed); security-alert event source still missing** | `src/lib/admin/backup-monitor.ts` + `functions/api/internal/backup-status.ts` + `workers/backup-monitor/`; failed/missing backup alerts admin+owner immediately, escalates owner after configured minutes, resolves with recovery notice; backup workflow reports when `OPS_ALERT_URL`/`OPS_ALERT_TOKEN` secrets exist | Deploy Worker + secrets; connect security-event source; owner confirms inbox delivery |
| Backup/recovery | partial | `scripts/backup/*` encrypt/verify/restore D1 + master workspace; R2 app objects require owner credentials; documented in `docs/operations/OFFSITE-BACKUPS.md` | Owner provides R2 S3 credentials; perform independent restore rehearsal |
| GitHub reconciliation | owner-gated | `main` 41 behind `production-safe`; no destructive action taken | Owner approves fast-forward/main reconciliation and branch protection |
| Security/observability baseline | partial | Admin MFA, sessions, audit, rate limiting exist; no external uptime/error monitor | Owner decision on free observability option |

### Wave B — Complete Pensacola operations

| Workstream | Status | Evidence / notes | Next action |
|---|---|---|---|
| Stripe invoice payment links, receipts, saved cards, off-session | verified working (existing) | `src/lib/admin/stripe-billing.ts`, `src/lib/invoicing/invoice-receipt.ts`; tests in `tests/admin.test.ts`, `tests/receipt.test.ts` | Live charge/refund remains owner-authorized |
| Customer self-service billing portal | **implemented in customer portal (staged)** | Portal opens a Stripe-hosted billing session when `PORTAL_BILLING_ENABLED=true`; reuses/creates one Stripe customer, branch scoped, audited, no charge/refund path. Admin-initiated portal button also exists | Configure Stripe portal settings; enable flag after owner review |
| Live Pay Now checkout | **repaired and production-verified** | Root cause `customer_update[email]` Stripe `parameter_unknown`. Removed; routing now retries/falls back; retry advances Stripe idempotency generation. the owner-approved Molino test address (redacted from public docs) reached live Stripe Checkout; simulated failure showed **Try Secure Payment Again** and retry reached Stripe. No charge/refund. Full evidence: `docs/verification/2026-11-21-CHECKOUT-RECOVERY.md` | None for initiation; Stripe Dashboard remains as previously configured |
| Unified customer portal | **implemented and tested (staged)** | Passwordless single-use 15-minute links, hashed 7-day sessions, CSRF, anti-enumeration, rate limits, bookings, recurring plans, invoices/payment links, signed documents, profile/properties, customer-service requests. Migration `0045`; `/portal/` page; `docs/operations/CUSTOMER-PORTAL.md` | Apply migration, deploy, confirm one real sign-in/inbox delivery |
| Data Control Center | **improved, still partial** | Branch-filtered counts and CSV/JSON exports, signing-evidence export, backup health/incident panel, retention policy registry and legal holds (migration `0046`), audited exports. Encrypted full recovery remains CLI/documented | Add controlled short-lived download storage, archive search and approved permanent-deletion workflow |
| Server-driven admin pagination | **improved, still partial** | Customers, leads, careers, invoices and audit history now page server-side with totals, ordering whitelist, page sizes 25/50/100 and UI pagers. Requests/jobs/employees/time/documents keep specialized/bounded views | Extend to remaining long lists only where a table is appropriate |
| Careers administration integration | verified working + pagination/search/branch filter | `functions/api/admin/careers.ts`, owner-only, private resume download, audit; branch filter and search added | Add onboarding packet link and applicant-to-employee approval flow |
| Administrative communications settings | implemented this session | See Wave A | Apply migration; verify in deployed admin |

### Wave C — Documents and onboarding

| Workstream | Status | Evidence / notes | Next action |
|---|---|---|---|
| Template lifecycle | partial | `document_templates.status` draft/approved/retired; `legal_review_status`; packet builder `0038` | Add explicit review→published→superseded workflow and owner publication gate |
| Packet automation | verified working (existing) | `resolveBundle`, `activeRequirements`, service/subject matching | Extend to careers onboarding packets |
| E-signature evidence | verified working + reminders implemented (staged) | signatures, verification, executed SHA-256, audit, download; signing link now expires after **7 days**; 24h/72h owner-configurable reminders, stop on completion/decline, no appointment cancellation; migration `0047` + hourly Worker | Apply migration/deploy Worker; confirm one reminder in a mailbox |
| Retention controls | **registry implemented (staged)** | Retention policy registry, legal holds, release flow and audit (migration `0046`); no deletion/anonymization is performed by the registry | Owner approves actual retention schedules; permanent deletion remains owner-gated |

### Wave D — Tampa internal readiness (public OFF)

| Workstream | Status | Evidence / notes | Next action |
|---|---|---|---|
| Tampa public visibility | verified OFF | `src/config/branches.ts` lifecycle `setup`; middleware gate requires `live` + `active`; recorded 404 verification | Do not change |
| Branch pricing/tax/travel parity | partial | Tampa pricing v1 internal / versioned; 132 ZCTAs; 20-mile default limit | Real Tampa origin + branch-aware public estimator before activation |
| Booking/payment/recurrence parity | partial | Branch IDs flow through records; public booking remains Pensacola-only | Complete branch-aware checkout and calendar isolation |
| Launch gates | partial | Readiness checklist and live-advance gate exist | Owner review; keep closed |

### Wave E — Dispatch readiness (phased, disabled)

| Workstream | Status | Evidence / notes | Next action |
|---|---|---|---|
| Dispatch engine | verified implemented, disabled | `src/lib/dispatch/*`, migration `0041`, owner dashboard; analysis-only default and operationally paused | Keep paused |
| Employee readiness data | partial | Qualifications/equipment/transport/origin/time-off/weekly rules exist | Complete `team_hayli` profile; verify dispatch readiness |
| Shadow phase (20 recommendations) | missing | No recorded shadow assessments | Owner authorizes shadow phase |
| Live approvals / automatic assignment | owner-gated | Requires explicit owner authorization per phase | Do not activate |

## 3. Owner-only blockers (action required)

1. **GitHub reconciliation authorization** — approve fast-forwarding `main` to
   `production-safe` (or state the intended authoritative branch). No action taken.
2. **Backup repository secrets** — add the documented Cloudflare/R2/encryption
   secrets to GitHub so `backup.yml` is no longer dormant; provide R2 S3 keys
   for application-object backups. Never paste secrets in chat.
3. **Resend/Workspace proof of inbox delivery** — verify the six department
   mailboxes receive and reply correctly with a controlled message.
4. **Tampa public launch** — remains OFF; authorize only after Wave D gates.
5. **Dispatch phase authorization** — shadow → owner-approved → automatic.
6. **Legal template publication** — approve specific templates/versions before
   any legally significant document is published.
7. **Stripe live actions** — customer portal configuration in the Stripe
   Dashboard (business name, support email, policies) and any live charge/refund.

## 4. Session log

### 2026-11-20 — session 1 (this session)

Verification performed:

- `npm test`: **962 tests, 961 pass, 1 pre-existing skip, 0 fail**.
- `npm run check`: **0 errors** (2 pre-existing hints only).
- `npm run build`: **38 pages built successfully**.
- `npm run validate`: internal links (2,401 across 38 pages), SEO, marketing
  registry/QR, GTM artifacts, checklist leak checks all pass.
- `npm run test:browser`: **238 pass / 0 fail** (including the new
  `tests/browser/admin-communications.test.mjs`).
- Focused `tests/communications.test.ts`: **15 pass**.

Implemented (not deployed, staged in the working tree):

- Communications & Notifications admin settings:
  - migration `0044_communications.sql` (version snapshots, delivery events,
    backup run heartbeats and operational incidents)
  - `src/lib/admin/communications.ts`: fixed department registry, routing,
    reply-to, templates, validation, preview, versioning, delivery health,
    controlled owner test delivery
  - `functions/api/admin/communications.ts`
  - admin view, navigation and client logic
  - careers hiring notification/reply-to now consume the configured routing
- Backup alert monitoring:
  - `src/lib/admin/backup-monitor.ts`: heartbeat evaluation, incident
    open/escalate/resolve, admin+owner alerts, delivery records
  - `functions/api/internal/backup-status.ts` (bearer token)
  - `workers/backup-monitor/` (15-minute cron, manual health endpoint)
  - `.github/workflows/backup.yml` reports success/failure when
    `OPS_ALERT_URL` and `OPS_ALERT_TOKEN` repository secrets exist
- Stripe customer billing-portal session for authorized owner/finance use
  (branch-scoped, audited, no charge path).
- Server pagination and UI pagers for customers, leads, career applications
  and invoices with accurate totals and stable ordering.

Committed locally as **`82e66d5`** (`Add communications center, backup alerts
and paging`) on `production-safe`. Not pushed and not deployed. No production
data, migrations, messages, charges, flags or Cloudflare settings were changed.

### Next executable steps

1. Owner reviews this ledger and the communications defaults.
2. Apply migration `0044` to production D1 (backward-compatible additive only).
3. Deploy the Pages build, then verify admin communications UI and delivery
   health in production.
4. Deploy `workers/backup-monitor` and add `OPS_ALERT_URL` /
   `OPS_ALERT_TOKEN` plus the existing dormant backup secrets.
5. Configure Stripe billing portal settings in the Stripe Dashboard and confirm
   `ADMIN_STRIPE_PORTAL_ENABLED=true` only after review.
6. Decide the GitHub branch reconciliation (owner approval required).
7. Continue customer portal identity design and remaining pagination lists.

### 2026-11-21 � session 2 (production release + portal + data/document controls)

Production release completed:

- Migration `0044` applied to production D1; `d1_migrations` records 44.
- Pre-migration D1 export: 312,119 bytes, SHA-256
  `EF847495C477C4FC604CF828678C582477F47A1D0B17B48C5461E02C0B36AFB6`.
- Independent in-memory restore verification: 43 migrations, 83 tables,
  0 foreign-key violations, 10 customers / 9 properties / 14 appointments /
  2 invoices preserved.
- `production-safe` pushed `851a28b..e65db71`; Cloudflare Pages production
  deployment **`c50ba68b-d634-4a1d-a98a-5a2b9dc02978`** for `e65db71`.
- Live smoke: home 200, careers 200, Tampa 404, admin 200 with new
  communications UI, admin API unauthorized 401, internal backup endpoint
  responds 503 (token not configured) on POST.

Implemented after that deployment (staged, not yet deployed):

- Customer portal (migration `0045`): passwordless single-use links, hashed
  sessions, CSRF, anti-enumeration, bookings, recurring plans, invoices/payment
  links, documents, profile/properties, service requests, Stripe billing portal
  session. `/portal/` page and footer link.
- Communications sender integration for booking confirmations, booking admin
  notifications, invoice email, receipt copy, gift delivery, careers and portal
  mail. Stripe remains the official receipt source; no duplicate receipt path.
- Data Control improvements: branch-filtered counts and CSV/JSON exports,
  signing-evidence export, backup health/incident panel, retention registry and
  legal holds (migration `0046`).
- Server pagination for audit history; customers/leads/careers/invoices already
  paged.
- Document reminders and secure storage (migration `0047`): 7-day signing links,
  24h/72h owner-configurable reminders, hourly Worker, no appointment
  cancellation.
- `scripts/backup/verify-d1-export.mjs` added and wired into the backup
  workflow; the production pre-migration export restored independently.

Current verification: unit **972 tests / 971 pass / 1 skip / 0 fail**;
`astro check` 0 errors; build 39 pages; `validate` passes. Browser suite must be
re-run after the portal page (see next session entry).

Next executable steps:

1. Re-run the full browser suite and record the final count.
2. Apply migrations `0045`, `0046`, `0047`; record them in `d1_migrations`.
3. Commit/push/deploy the second release; verify `/portal/`, admin retention and
   reminder settings in production.
4. Deploy `workers/backup-monitor` and `workers/document-reminders` with their
   secrets and D1 binding.
5. Owner confirms inbox delivery/replies and Stripe portal settings.
6. Continue archive search, short-lived download storage and approved
   permanent-deletion workflow.

### 2026-11-21 � second production release

- Migrations **0045, 0046, 0047** applied and recorded; production D1 now has
  **47 migrations** and the portal, retention and reminder tables exist.
- Pre-release export: 333,347 bytes, SHA-256
  `EC4C13AAAE2A3B852A40ED26F4F37C5A962378B720236A447C1B20FD200C77D2`,
  44 migrations, 87 tables, 0 foreign-key violations.
- Commit **`10aef33`** pushed to `production-safe`.
- Cloudflare Pages production deployment
  **`bb936ae2-cf37-4682-89af-4b5acd03ab5b`** (Active).
- Live smoke: `/portal/` 200 with noindex, portal auth GET 200, portal data and
  document endpoints 401 without a session, admin retention/reminder controls
  present, Tampa 404, home 200.
- No charge, refund, customer message, legal-template publication, Tampa launch
  or dispatch activation occurred.

### Remaining next steps (current)

1. Deploy `workers/backup-monitor` and `workers/document-reminders` with
   `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `OPS_ALERT_URL` / `OPS_ALERT_TOKEN`
   and `REMINDER_MONITOR_TOKEN`. Owner-provided secrets are required.
2. Owner confirms portal sign-in, reply routing and delivery in real mailboxes.
3. Configure Stripe billing-portal settings; then set
   `PORTAL_BILLING_ENABLED=true` only after review.
4. Complete short-lived download storage, archive search and the approved
   permanent-deletion workflow in Data Control.
5. Owner decides GitHub `main` reconciliation; no branch change has been made.
6. Tampa remains OFF; dispatch remains analysis-only and paused.

### 2026-11-21 � critical checkout repair

- Reported live Pay Now fallback reproduced with **the owner-approved Molino test address, Molino,
  FL 32577**.
- Runtime log proved Stripe returned `parameter_unknown` for
  `customer_update[email]`.
- Removed the invalid parameter; linked Stripe Customers retain their verified
  email and new customers use `customer_email`.
- Added Google route retry and MapMap fallback so a transient Google failure
  does not degrade a verified quote to `quote_not_verified`.
- Retained failed checkout generations so **Try Secure Payment Again** advances
  the Stripe idempotency key instead of receiving a cached failure.
- Production commits: `5ae8244`, `d079a0d`, `734e3ce`, `3e0f65e`, `84379cb`.
  Final production build `edc50a01`; checkout verification build `3f6ded04`.
- Live verification: normal Pay Now redirected to live Stripe Checkout; a
  simulated failure showed the retry state and the retry reached Stripe.
- No charge, refund or paid webhook event occurred. Synthetic test records were
  archived/released/expired and audited.
- Evidence: `docs/verification/2026-11-21-CHECKOUT-RECOVERY.md`.

### 2026-11-21 - owner UX, estimator and branch presentation improvements

- **Community Support:** removed the decorative circle behind the eligibility
  card; no card text or eligibility rule changed.
- **Scripture:** the homepage Proverbs 16:3 block now uses the compact variant
  with a slender gold rule and tightened spacing.
- **Reviews:** full review text now lives in a real internal scroll region.
  Each active slide resets to the top, a bottom fade signals overflow, the
  repeated "Read full review" controls and dialog were removed, and review
  photographs use `object-fit: contain` so the full image remains visible.
- **Footer:** mobile bottom clearance moved from `site-main` to the shared
  footer itself, including safe-area padding, so the final footer links remain
  tappable above the fixed Call/Text/Estimate bar on every page.
- **Estimator:** Step 2 now asks only "Is this a move-in or move-out cleaning?"
  with regular home cleaning selected by default and a visible radio indicator.
  The cleaning frequency moved to Step 3 in the order One-Time, Weekly,
  Biweekly (Every 2 Weeks), Monthly. Deep Cleaning is an optional Step 3
  checkbox that maps to the internal `deep` service and one-time pricing. The
  five condition tiers, pricing mathematics, service matrix, promotions,
  checkout, Stripe and payment verification are unchanged. The hidden STR
  selector remains isolated to `/estimate/str/`.
- **Service Area:** Tampa OFF renders one automatic Pensacola-only page with
  one map and no branch selector. When the persisted Tampa branch becomes
  `lifecycle_status = live` and `status = active`, the production middleware
  automatically unwraps the two-region template, adds the Florida overview,
  Pensacola and Tampa maps, switches the H1/lead and replaces the page metadata.
  No website edit or developer action is required at Tampa launch. Tampa
  remains OFF.
- **Verification:** `npm run check` 0 errors / 0 warnings; unit **976**
  (975 pass, 1 pre-existing skip); browser **245 pass / 0 fail**;
  `npm run validate` passed; 39 pages built. Visual checks covered 320, 375,
  390, 430, tablet and desktop widths, including the footer/CTA boundary and
  both single- and multi-branch Service Area presentations.
- **Release:** commit **`cd0ecf6`**, Cloudflare Pages production deployment
  **`7fe55dcc-65c2-4207-8545-80dc6438b50f`** (source `cd0ecf6`).
- **Production smoke:** home 200 with compact Scripture, contained review
  images, no repeated review links and mobile footer clearance; Service Area
  200 with **zero Tampa references**, one map, no branch selector and the
  Pensacola H1; Tampa page **404**; estimator 200 with the default regular
  choice, visible radio indicator, Step 3 deep reset and corrected frequency
  labels; `/api/estimate-checkout` readiness **enabled / live** with all six
  checks true; `/api/lead-readiness` ready with customer email and photo
  storage. No checkout session, charge or customer message was created.
- No production charge, refund, customer message, branch activation, dispatch
  activation or destructive data action was performed during implementation.

### 2026-11-21 - GitHub push synchronization and CI closeout

- Pushed the verified release fast-forward to `origin/production-safe` with no
  force, rebase, reset or `main` change. The push initially triggered Pages
  deployment `1b05aae3-a0e6-48b8-a065-0f23d0dcf7c1` from `dd1a970`.
- GitHub `validate` then exposed one stale smoke assertion: it expected the
  exact `class="site-footer"` string after the shared footer gained its
  mobile-bar modifier. Fixed the assertion in `88124eb`; `npm run smoke`
  passed, and GitHub run `44884371126` completed **successfully** (both
  validate and browser jobs).
- Cloudflare Pages application deployment `e781e915-69e4-41c5-a29a-1d09e3d36b74`
  is Active from `88124eb`. The push did not activate Tampa or dispatch.
- Live 390px production verification passed: compact Proverbs 16:3 separator;
  K V review scrolls from the top (334px overflow, overflow end state updates);
  Dennis D has two fully contained/loaded photographs; Gift Certificates clears
  the sticky action bar with 0px overlap; Service Area is Pensacola-only with
  one map and no Tampa text; estimator Step 2 defaults to regular cleaning and
  Step 3 shows the corrected frequency order and Deep Cleaning reset.
- Final local and remote `production-safe` both point to `88124eb` before this
  documentation-only closeout.
### 2026-11-21 - independent comprehensive platform audit

- Full read-only audit completed against `production-safe` @ `f0d98f8`
  and production deployment `1bf95d3d`. Reports:
  `docs/audits/PLATFORM-COMPREHENSIVE-AUDIT.md`,
  `docs/audits/PRIORITIZED-REMEDIATION-ROADMAP.md`,
  `docs/audits/ARCHITECTURE-EFFICIENCY-RECOMMENDATIONS.md`,
  `docs/audits/OWNER-EXECUTIVE-SUMMARY.md`.
- Verified: 47 migrations applied including `0044_communications.sql`; 0 FK
  violations; Tampa setup/inactive and publicly 404; dispatch analysis-only,
  paused and 0 decisions; one admin account with MFA not enabled.
- Critical findings: **0 completed public estimate checkouts**; most payment
  failures/cancellations are not persisted for admin action; dynamic-promotion
  tax recomputation trusts client state/ZIP; online/gift payment projections
  have NULL branch and D1 gift state does not follow R2 redemptions/refunds;
  reports show $0 outstanding/discounts; pending requests can duplicate
  invoices; Jobs/appointments can omit current work; owner branch view is
  largely cosmetic; legal holds are not enforced on deletion/cleanup; public
  repository contains a private owner-supplied address/coordinates.
- Recovery: `backup_runs` is 0, the backup workflow is inactive, backup-monitor
  and document-reminder Workers are not deployed, and the latest manual archive
  predates migrations 0044-0047. Recurring worker has 11 failures/4 completions
  and 0 incidents.
- Production has one successful **$5 live invoice payment** (branch Pensacola)
  while prior release narratives said no live charge occurred; owner must
  reconcile/authorize the record. No audit payment, refund, email or completed
  checkout was performed.
- No production changes, Tampa activation, dispatch activation or destructive
  action occurred. A temporary estimator hold from browser verification expired
  automatically; no booking request or payment was created.
- Recommended immediate work is the P0 sequence in the roadmap: complete and
  observe the payment path, fix tax jurisdiction, correct branch/gift financial
  attribution, close privacy/legal-hold and MFA gaps, and make backups current
  and restore-tested. Do not start Tampa/dispatch expansion yet.
### 2026-11-21 - afternoon Pay Now repair

- Root cause: the wizard treated only `alternatives` from final live scheduling as
  a Pay Now blocker. `preferred` / no-hold outcomes could continue to lead
  submission and checkout without a held slot. The provisional 120-minute
  availability preview also offers late-afternoon starts that cannot fit the
  actual job duration before the 6:00 PM workday, so those attempts surfaced as
  technical checkout failures or misleading "confirm with you" copy.
- Fixed `src/scripts/estimate-wizard.ts`: every non-held finalization outcome now
  blocks Pay Now, preserves Pay Later, explains the scheduling blocker, and
  starts no checkout. The finalization status is cached so a repeated click
  cannot bypass the block.
- Extended `functions/api/estimate-checkout.ts` to persist genuine checkout
  failures (hold, quote, Stripe customer/session/transport/state) in the
  booking request's `checkout_failure_*` fields, which the admin already shows.
- Added `tests/browser/paynow-arrival-windows.test.mjs`: eligible morning and
  afternoon windows both hold and initiate checkout; a late afternoon start
  that cannot fit the real duration is explained with no checkout attempt and
  no approval wording. Updated `docs/operations/BOOKING-ARCHITECTURE.md`.
- Verification: unit **976** (975 pass, 1 pre-existing skip), browser **247
  pass**, `astro check` 0 errors, build 39 pages, `validate` and `smoke` pass.
- Release commit **`a7bcfd5`**; production deployment
  **`94ebf4ed-9f98-40df-aea9-45dd4114619d`**.
- Production verification:
  - Morning 12/28: 7:30 AM held and reached **Stripe Checkout** (HTTP 200).
  - Afternoon 12/29: 12:30 PM held and reached **Stripe Checkout** (HTTP 200).
  - Late 1:15 PM scenario: no hold, no lead/checkout, explicit scheduling
    explanation, Pay Later remains available.
  - No charge, payment event or completed checkout occurred. Synthetic open
    sessions will expire normally.
### 2026-11-21 - stabilization batch and email-code MFA

- **Financial/reporting repairs:** invoice reporting now selects `balance_cents`
  and `discount_cents`; invoice generation is request-idempotent with migration
  `0048` and a unique partial index; appointment/job views use a current
  60-day operational window instead of unbounded oldest-first results; new
  online payment/gift projections attribute the Pensacola branch instead of
  NULL.
- **Tax authority:** dynamic-promotion tax now uses the server-verified
  destination state/ZIP from the verified quote, not client request fields.
- **Privacy/data protection:** customer deletion checks active legal holds
  across customer, booking, appointment and invoice subjects; portal messages/
  sessions/tokens, signed document text and agreement text are scrubbed.
  Photo cleanup refuses a real cleanup when any legal hold is active. Current
  public docs no longer contain the private test address/coordinates; Git
  history still contains historical references and requires owner approval for
  any rewrite.
- **Admin visibility:** overview raises checkout-failure/stale-session and
  owner-MFA-missing alerts. Checkout failures now persist safe failure codes
  and reasons in the request record.
- **Email-code MFA:** migration `0049` adds `mfa_method` and hashed email MFA
  challenges; pending authenticator secrets are invalidated. Email codes expire
  in five minutes, have five attempts, 60-second resend cooldown and rate
  limits, are never stored plainly/logged/in URLs/browser storage, and support
  recovery codes. Authenticator MFA remains available. Setup/disable controls
  are in Admin -> Settings. Production login enforcement is unchanged because
  the owner account is still `mfa_enabled = 0`.
- **Verification:** migration **49** applied; unit **978** (977 pass, 1
  pre-existing skip); browser **247 pass** at concurrency 2; check 0 errors;
  build 39 pages; validate and smoke pass. Production deployment
  **`d45b2eeb-d70c-4e45-a258-c8f67a22d9bf`** source **`b066554`**; public
  app/auth probes 200, invalid MFA resend 401, unauthenticated email setup 401.
- **Backups:** pre-0048 and pre-0049 D1 exports created in git-ignored
  `backup-out/` and independently verified in-memory (48/49 migrations, 0 FK
  violations). `backup_runs` remains empty and scheduled automation remains
  unproven; this is still an owner-credential/destination blocker.
- **Not completed / explicitly deferred:** general per-action MFA step-up;
  real declined/card-failure lifecycle proof; full payment-attempt incident
  UI/resume links; portal-request inbox; post-payment photo recovery;
  Communications Center wiring; automated backup monitor/Workers; branch-aware
  historical backfill. Tampa remains OFF and dispatch paused.
### 2026-11-21 - email MFA and security refinement

- Migration `0049_email_mfa.sql` applied; production has **49 migrations**.
  It adds `admin_users.mfa_method`, the private email MFA challenge table and
  clears any pending authenticator secret when MFA was not enabled.
- Email MFA is implemented alongside authenticator MFA: six-digit codes are
  hashed and bound to a random challenge token; five-minute expiry; five
  attempts; 60-second resend cooldown; IP/account rate limits; single-use
  recovery codes. Codes are delivered through Resend, never logged, placed in
  URLs or browser storage.
- Login accepts either TOTP or email challenges based on the stored method.
  Enrollment and disablement require the existing factor/password controls;
  email enrollment requires a fresh password confirmation.
- Admin setup UI exposes **Use email verification codes** alongside
  **Set up authenticator**. SMS was assessed but is not enabled; the provider
  budget, opt-in, STOP handling and A2P fees still require owner approval.
- Production security state verified after push: `mfa_enabled = 0`,
  `mfa_method = totp`, pending secret `none`, zero email challenges. Login
  enforcement is deliberately unchanged until the owner enrolls and verifies a
  successful login and recovery.
- Verification: unit **978** (977 pass, 1 skip); browser **247 pass** at
  concurrency 2; check 0 errors; build 39 pages; validate/smoke pass; GitHub
  validate/browser run `44938278485` successful.
- Application/security commit **`f7fa3c0`**; final production deployment
  **`b0e5a8e4-41a5-4efd-838e-23264b3ec838`** (source `f7fa3c0`), synchronized
  with `origin/production-safe`.
- Remaining: general per-action step-up, SMS activation, automated backups,
  real declined/canceled payment lifecycle proof, payment-attempt incident
  queue/resume, portal inbox, post-payment photo recovery and Communications
  Center wiring. Tampa remains OFF and dispatch paused.
### 2026-11-21 - MFA step-up for sensitive administrator actions

- Migration `0050_admin_step_up.sql` adds `admin_sessions.step_up_at`; production
  has **50 migrations**. A pre-migration D1 export was created at
  `backup-out/d1-pre-0050-20261121-1436.sql`.
- MFA-enabled accounts must complete a fresh second factor within **ten minutes**
  before: permanent customer deletion; business-record exports; storage/retention/
  legal-hold changes; administrator invitations, roles, status, resets and session
  revocation; invoice creation/payment/refund/credit/payment-link/email actions;
  and Stripe refunds.
- `step_up_start` and `step_up_verify` use the existing authenticator or email
  challenge tables. The admin client detects `mfa_step_up_required`, obtains a
  fresh code and retries the original action once. Login MFA establishes a fresh
  ten-minute step-up for the new session.
- The gate is server-enforced and fail-closed. It applies only when the account
  has `mfa_enabled = 1`; the production owner is still `mfa_enabled = 0` until she
  completes enrollment and login/recovery verification. Password re-authentication
  remains in place for Stripe refunds, gift redemption/void and saved-card charging.
- Verification: unit **980** (979 pass, 1 skip); browser **247 pass**; check 0
  errors; build 39 pages. The focused step-up tests prove stale sessions are
  rejected, the route refreshes the session, and a storage export is blocked then
  allowed after step-up.
- Commit **`de7dc39`**; production deployment
  **`fd0e2394-103d-4870-a8cb-45fdf0e62e6d`** (auto deployment from the push);
  direct deployment `cfe66c9e-0aca-40b5-af83-362fe2fdb85b` used for verification.
  GitHub run `44941936444` passed. Local/remote synchronized at `de7dc39`.
- Remaining: apply the same policy to booking/dispatch/document/pricing/
  communications writes where risk warrants; owner MFA enrollment/recovery proof;
  SMS provider approval; automated backups; real payment-lifecycle proof; portal
  inbox; post-payment photo recovery. Tampa remains OFF and dispatch paused.
### 2026-11-21 - owner MFA enrollment UI regression

- Root cause: the email-MFA login gate introduced a second `data-admin-mfa-status`
  attribute. `loadSettings()` used an unscoped `querySelector`, so the enrollment
  controls were written into the hidden login-gate status paragraph instead of
  the **Your security** container. The administrator table still reported
  `MFA: Not enabled`, making the missing controls look like a backend failure.
- Fix: the login gate now uses `data-admin-mfa-gate-status`; the settings query
  is scoped to `[data-admin-view="settings"] [data-admin-mfa-status]`. Email
  verification is now presented first as the recommended method, with the
  authenticator option second.
- Added a browser regression test that opens Settings with a controlled owner
  actor, asserts both enrollment controls exist in the visible settings scope,
  and exercises the email setup form after the password confirmation prompt.
- Added a controlled-account route test covering email enrollment, eight recovery
  codes, verified email login and recovery-code disablement without touching owner
  credentials.
- Production verification: a temporary controlled owner account was created,
  used to confirm both controls appear in the live Settings view, then removed.
  The production email challenge path delivered to Resend's controlled test
  address and rendered the email-code form. Owner account remains the sole admin,
  `mfa_enabled = 0`, `mfa_method = totp`, no pending secret; no owner session or
  credential was changed.
- Verification: unit **981** (980 pass, 1 skip); browser **248 pass**; check 0
  errors; build 39 pages. Commit **`041303e`**; active production deployment
  **`7ea7af39-8f8b-47e7-8347-7d0797b6ed60`**; GitHub run `44947264510` passed.
### 2026-11-21 - encrypted backup and disaster recovery workstream

- Actual encrypted recovery point created and verified:
  `sparkling-standard-backup-2026-11-21T21-10-15.ssbk`.
  802,275 archive bytes, 802,060 plaintext bytes, 2 files, SHA-256
  `393525b4953c89540e1472ba0053ca5ea8ee72b00872949e938c48c7d62ee866`.
- D1 export: 801,566 bytes, 50 migrations, 96 tables, 0 foreign-key violations.
  Encrypted archive verification reported SQLite integrity `ok`; isolated restore
  succeeded into a fresh temporary directory and the SQL restored in memory.
- R2 primary: archive, encrypted manifest and checksum uploaded to private
  `sparkling-standard-backups` under
  `sparkling-standard/backups/d1/sparkling-standard-backup-2026-11-21T21-10-15/`;
  the archive was downloaded again and its SHA-256, decryption and SQL integrity
  verified.
- Local encrypted archive copied to
  `C:\Users\thoma\Documents\Sparkling-Standard-Master\08-Backups\2026-11-21\`;
  no plaintext database export was copied there.
- OneDrive Graph support implemented with device-code public-client auth,
  `Files.ReadWrite.AppFolder`, DPAPI token cache, app-folder upload/download,
  quota and capacity reporting, retention and reauthorization handling. Unit
  tests cover token exchange, upload paths, chunking and retention safety.
- OneDrive authorization and independent retrieval are **not complete**: the
  owner must register the public client and provide its client ID through the
  secure auth flow. No OneDrive upload/retrieval has been claimed.
- Retention code supports 30 daily / 12 weekly / 12 monthly dry-run or apply,
  protects the newest, pre-migration and legal-hold bundles, and fails on
  capacity overflow. D1-only 54-copy capacity is about 43 MB; R2 object sizes
  still need measurement after the owner supplies the R2 backup token.
- Backup monitor Worker deployed as `sparkling-standard-backup-monitor` with a
  15-minute schedule and the production D1 binding. Its manual tick reported
  `status: missing` and opened incident `incident_4a6b8279...`; alert delivery is
  suppressed until the Worker receives `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
  and a known `BACKUP_MONITOR_TOKEN`. No live email was sent.
- GitHub workflow updated to require OneDrive, R2 round-trip verification,
  OneDrive round-trip verification/restore and retention. Scheduled execution
  remains blocked by the default-branch limitation; a separate
  `workers/backup-scheduler` is prepared to dispatch `backup.yml` on
  `production-safe` with an owner-created Actions:write token.
- Remaining owner actions: OneDrive app registration/client ID + device auth;
  R2 backup S3 credentials and R2 app-object API token; Worker Resend/monitor
  secrets; scheduler GitHub token. Do not declare backups complete until the
  OneDrive independent retrieval and an isolated full restoration actually pass.
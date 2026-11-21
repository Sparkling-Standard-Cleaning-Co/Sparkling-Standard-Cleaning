# Master Closeout Status

Persistent implementation ledger for the Master Production Closeout directive
(baseline November 20, 2026). Future sessions must update this file before
ending so work can resume accurately.

Last updated: 2026-11-21 (owner UX, estimator and branch presentation improvements)
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
| Unit tests | 947 total / 946 pass / 1 skip | **976 total / 975 pass / 1 pre-existing skip / 0 fail** (`npm test`) |
| Browser tests | 237 pass | **245 pass / 0 fail** (`npm run test:browser`) |
| Newest migrations | 0043 | `0044`–`0047` (production at **47**) |
| Untracked owner files | preserved | `docs/research/`, `public/brand/Elegant Gold S Floral Emblem.png` left untouched |
| Production app deployment | `e5b8331e-380f-44bc-b3a7-c310b4d90c50` | now **`edc50a01`** (source `84379cb`); checkout fix also verified on `3f6ded04` |
| Prior release deployment | — | `bb936ae2-cf37-4682-89af-4b5acd03ab5b` (source `10aef33`) |

Git topology note (unresolved, requires owner approval before any change):
`origin/main` is 41 commits behind `origin/production-safe`
(`origin/main` = `efcf73e`, `origin/production-safe` = `851a28b`). The
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
| Live Pay Now checkout | **repaired and production-verified** | Root cause `customer_update[email]` Stripe `parameter_unknown`. Removed; routing now retries/falls back; retry advances Stripe idempotency generation. 6360 Haupert Ln, Molino, FL 32577 reached live Stripe Checkout; simulated failure showed **Try Secure Payment Again** and retry reached Stripe. No charge/refund. Full evidence: `docs/verification/2026-11-21-CHECKOUT-RECOVERY.md` | None for initiation; Stripe Dashboard remains as previously configured |
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

- Reported live Pay Now fallback reproduced with **6360 Haupert Ln, Molino,
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
- No production charge, refund, customer message, branch activation, dispatch
  activation or destructive data action was performed during implementation.

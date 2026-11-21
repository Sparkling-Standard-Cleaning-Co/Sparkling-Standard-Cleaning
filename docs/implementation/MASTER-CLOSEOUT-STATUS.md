# Master Closeout Status

Persistent implementation ledger for the Master Production Closeout directive
(baseline November 20, 2026). Future sessions must update this file before
ending so work can resume accurately.

Last updated: 2026-11-20 (session 1, implementation pass complete)
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
| Unit tests | 947 total / 946 pass / 1 skip | initial baseline reproduced; after this session **962 total / 961 pass / 1 skip / 0 fail** (`npm test`) |
| Browser tests | 237 pass | full suite re-run after this session: **238 pass / 0 fail** (237 prior + 1 new communications UI test) |
| Untracked owner files | preserved | `docs/research/`, `public/brand/Elegant Gold S Floral Emblem.png` left untouched |
| Production app deployment | `e5b8331e-380f-44bc-b3a7-c310b4d90c50` | recorded in release docs; not directly queryable from this checkout |
| Docs deployment | `97e0ce54-9e87-4a29-8dbe-7d2a91c6c285` | recorded in release docs |

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
| Communications & notifications admin settings | **implemented and tested (not deployed)** | New `communications` admin view; fixed six-department registry; routing/reply-to/template editing; server validation; preview; immutable versions; audit; delivery-health panel; controlled `[TEST]` send; careers hiring flow now consumes configured routing; migration `0044`; `docs/operations/COMMUNICATIONS-CENTER.md` | Apply migration `0044`; owner reviews defaults; confirm real inbox delivery |
| Critical backup/security alerts + escalation | **backup alerts implemented and tested (not deployed); security-alert event source still missing** | `src/lib/admin/backup-monitor.ts` + `functions/api/internal/backup-status.ts` + `workers/backup-monitor/`; failed/missing backup alerts admin+owner immediately, escalates owner after configured minutes, resolves with recovery notice; backup workflow reports when `OPS_ALERT_URL`/`OPS_ALERT_TOKEN` secrets exist | Deploy Worker + secrets; connect security-event source; owner confirms inbox delivery |
| Backup/recovery | partial | `scripts/backup/*` encrypt/verify/restore D1 + master workspace; R2 app objects require owner credentials; documented in `docs/operations/OFFSITE-BACKUPS.md` | Owner provides R2 S3 credentials; perform independent restore rehearsal |
| GitHub reconciliation | owner-gated | `main` 41 behind `production-safe`; no destructive action taken | Owner approves fast-forward/main reconciliation and branch protection |
| Security/observability baseline | partial | Admin MFA, sessions, audit, rate limiting exist; no external uptime/error monitor | Owner decision on free observability option |

### Wave B — Complete Pensacola operations

| Workstream | Status | Evidence / notes | Next action |
|---|---|---|---|
| Stripe invoice payment links, receipts, saved cards, off-session | verified working (existing) | `src/lib/admin/stripe-billing.ts`, `src/lib/invoicing/invoice-receipt.ts`; tests in `tests/admin.test.ts`, `tests/receipt.test.ts` | Live charge/refund remains owner-authorized |
| Customer self-service billing portal | **partial (admin-initiated session implemented and tested; no customer portal yet)** | `createCustomerBillingPortalSession` in `src/lib/admin/stripe-billing.ts`; owner/finance authorization, branch scope, Stripe customer mapping, audit, no charge/refund calls. Finance view exposes a secure portal button. Customer-facing portal shell/identity does not exist | Build passwordless verified customer portal before exposing; configure Stripe portal settings in Dashboard |
| Unified customer portal | **missing** | No customer portal page, identity or session system exists | Design and implement verified email access, sessions, bookings/invoices/documents |
| Data Control Center | partial | `functions/api/admin/storage.ts` provides counts, sampled R2, CSV exports, retention cleanup, backup setting display; owner-only | Add branch filters, signed-document export, short-lived downloads, retention registry |
| Server-driven admin pagination | **partial → improved** | Customers, leads, career applications and invoices now return accurate totals, server-side search/filter/order, offset paging, stable tie-breakers and page sizes 25/50/100 (customers/leads/careers/invoices). UI pager added. Requests/jobs/employees/time/documents/audit still use their existing bounded lists | Extend the same pattern to remaining long lists |
| Careers administration integration | verified working + pagination/search/branch filter | `functions/api/admin/careers.ts`, owner-only, private resume download, audit; branch filter and search added | Add onboarding packet link and applicant-to-employee approval flow |
| Administrative communications settings | implemented this session | See Wave A | Apply migration; verify in deployed admin |

### Wave C — Documents and onboarding

| Workstream | Status | Evidence / notes | Next action |
|---|---|---|---|
| Template lifecycle | partial | `document_templates.status` draft/approved/retired; `legal_review_status`; packet builder `0038` | Add explicit review→published→superseded workflow and owner publication gate |
| Packet automation | verified working (existing) | `resolveBundle`, `activeRequirements`, service/subject matching | Extend to careers onboarding packets |
| E-signature evidence | verified working (existing) | signatures, verification, executed SHA-256, audit, download | Reminders at 24/72h and 7-day link expiry policy need verification/implementation |
| Retention controls | partial | Signed copies retained; no unified retention registry | Implement registry + legal holds |

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

Not deployed. No production data, migrations, messages, charges, flags or
Cloudflare settings were changed.

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

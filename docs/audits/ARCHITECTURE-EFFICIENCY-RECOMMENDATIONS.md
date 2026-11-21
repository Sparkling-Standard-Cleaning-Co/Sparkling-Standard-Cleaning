# Architecture & Efficiency Recommendations

**Audit date:** 2026-11-21  
**Baseline:** `production-safe` @ `f0d98f8`  
**Purpose:** explain what to retain, simplify, consolidate, automate, postpone and stop building.

---

## 1. Recommended architectural direction

**Keep the current stack.** Astro static pages, Cloudflare Pages Functions, one D1 database, private R2 and a small dependency surface are proportionate for a local service business. The estimator/quote-verification core is the strongest asset. Do not migrate frameworks, add a CMS, split databases or introduce a workflow engine to solve the current problems.

**Change the operating model around the stack:**

1. Prove the money path and make exceptions visible.
2. Consolidate policy into a few shared boundaries.
3. Operate with a small number of reliable workflows rather than many unused modules.
4. Add branch awareness only where financial/operational risk requires it.
5. Automate repeatable high-frequency tasks after they are observed manually.

The platform is not short of features. It is short of **proof, adoption and operational focus**.

---

## 2. Retain

| Asset | Why |
|---|---|
| Static-first Astro + small dependency set | Fast, cheap, SEO-friendly, low maintenance |
| Shared estimator/quote/verify model | Prevents browser/server pricing drift; strong security boundary |
| Pricing snapshots and owner pricing controls | Auditability and rollback |
| D1 migrations and schema discipline | Clear history; no current FK violations |
| Private R2 photos/documents/resumes + signed URLs | Correct privacy model |
| Stripe signature verification, idempotency, event claims | Strong payment engineering |
| Strict TypeScript and meaningful tests | High confidence in core logic |
| Security headers and server-side authorization | Better than typical small-business code |
| Existing admin breadth | Useful raw material for consolidation, not a reason to add more |

---

## 3. Simplify and consolidate

### 3.1 One branch-policy helper

Ten branch-scope implementations disagree. Replace them with one shared `scope(actor, column)`/`branchAllowed(actor, branchId)` policy used by every admin API and export. Decide explicitly:

- **Owner “All branches”** = owner-only aggregate.
- **Owner selected branch** = real server-side filter, or remove the selector.
- **Manager** = only assigned branch.
- **Finance/other roles** = explicit permission plus branch scope.

Remove hardcoded `branch_pensacola` from checkout, lead, commitment, gift, manual booking and timekeeping. Resolve branch from the authoritative service address/hold, and store it in payments, Stripe metadata and documents.

### 3.2 One booking-confirmation orchestrator

Paid, manual and admin confirmation currently have separate implementations. Keep the commitment service as the single orchestration boundary and call it from all paths, passing the actor/context. Shared invariants:

- verified quote and payment state
- document gate
- branch and resource availability
- employee onboarding/bookable/lead requirements
- calendar ownership and failure compensation
- recurring-plan creation
- customer/owner notification
- audit record

This reduces duplicate code and prevents policy drift.

### 3.3 One communications send gateway

The Communications Center should own:

- department resolution
- event routing
- template selection/rendering
- sender/reply-to
- idempotency key
- delivery record
- retry/failure classification

Replace the 13 direct Resend call sites with one helper plus explicit event keys. Add Resend delivery/bounce/complaint webhooks. If this is deferred, remove template/routing claims from the UI and docs and keep only the verified reply-to behavior.

### 3.4 One gift register

Remove the broken `/gift-admin/` link and legacy R2 admin identity from the owner experience. Keep one D1-authorized gift register. R2 may remain the authoritative ledger, but D1 must be an accurate projection with reconciliation and clear ownership.

### 3.5 One admin application, split by domain

`src/scripts/admin.ts` at 5,365 lines is a change-risk hotspot. Split it by domain without changing the server contract:

- bookings/requests
- customers/properties
- finance/invoices
- documents/signing
- dispatch/team
- settings/branches
- reports/audit

Add URL/hash state and a global search before adding more screens. Refresh/back should not reset to Overview.

### 3.6 One validation boundary

Standardize request validation for admin APIs and public forms. A lightweight shared schema/helper can cover string limits, IDs, enums and JSON body size without adding a dependency. Prioritize admin mutation routes and financial fields.

### 3.7 One exception queue

Do not build more dashboards until the owner has one place to act on:

- failed checkouts/payments
- unpaid/overdue invoices
- paid bookings awaiting photos/documents/confirmation
- unassigned/at-risk jobs
- failed recurring runs
- failed email deliveries
- reconciliation issues
- unsigned documents
- portal requests

Each item should open the record and offer the correct retry/resolve action.

---

## 4. Data and query improvements

| Recommendation | Reason | Priority |
|---|---|---|
| Branch-leading indexes on `payments`, `appointments`, `invoices` | Branch reporting will scan otherwise | P2 |
| Index `invoice_lines(invoice_id)`, `estimate_lines(estimate_id)`, `appointment_resources(team_member_id)` | Detail/availability queries | P2 |
| Unique/idempotent invoice per request/quote | Duplicate invoice prevention | P1 |
| Index/unique constraint on Stripe payment intent | History and duplicate defense | P2 |
| Atomic invoice payment projection or repair-on-retry | Avoid paid payment + open invoice state | P2 |
| D1 gift projection reconciliation | Dashboard/liability correctness | P0/P1 |
| Restrict middleware DB lookup to Tampa/service-area paths | Static assets should not require D1 | P2 |
| Cache/build both Service Area variants | Avoid 228 KB no-store rewrite on every request | P2 |
| Paginate/parallelize R2 gift listing; surface truncation | Current sequential 500-object cap | P2 |
| Stream or explicitly cap exports with row counts | Avoid silent incomplete exports | P2 |

---

## 5. Business automation opportunities

The goal is not “more software.” These are the few automations that could remove real owner labor or recover revenue.

| Opportunity | Problem solved | Benefit / manual work removed | Effort | Risk | Reuse |
|---|---|---|---|---|---|
| Payment attempt recovery queue | Failed/canceled payers disappear | Owner can call/retry high-intent customers; fewer lost bookings | M | Notification fatigue | Existing checkout/hold/request data |
| Automatic quote/request follow-up | Leads/requests sit pending | One follow-up at 24–48h; owner sees expiring quotes | M | Spam/consent | CRM, outbox/email, request statuses |
| Invoice reminder/overdue sequence | Owner manually chases balances | Fewer overdue invoices | M | Tone/legal | Invoice/payment tables, Resend |
| Post-job review request | Reviews are manual | More reviews without asking each customer | S–M | Timing/consent | Job completion, customer email |
| Portal request inbox | Requests only in email | Prevents missed reschedules/questions | M | Scope creep | Portal requests, customer 360 |
| Pre-job reminder + prep instructions | Reduces no-shows/questions | Fewer support messages | S–M | Delivery | Booking/notification data |
| Recurring schedule self-healing | 11 worker failures/no alerts | Detect/alert/retry rather than silent gap | M | Incorrect auto-changes | Recurring worker runs |
| Post-job checklist + photo/QC | Quality consistency | Standardized completion; evidence for re-cleans | M | Employee friction | Job checklists already exist |
| Re-clean/complaint workflow | Complaints are unstructured | Faster resolution and audit | M | Policy decisions | Requests/notes/jobs |
| Simple manual assignment board | Dispatch complexity exceeds staffing | One screen to assign today/this week with conflicts | S–M | Duplicate of jobs view | Jobs/team availability |
| Employee onboarding checklist | Manual onboarding | Repeatable onboarding and document collection | M | Legal/HR | Documents/team members |
| Branch-aware reporting | Current reports wrong/cosmetic | Trusted P&L and Tampa readiness | M | Requires branch data | Reporting tables |

**Do not automate yet:** auto-dispatch, dynamic pricing by branch, subscription autopay, mass marketing sequences, AI-generated customer replies. The prerequisites and demand are not proven.

---

## 6. Practical multi-branch architecture

Do not build a generalized multi-tenant platform. Support a small number of owned branches with explicit configuration.

Recommended minimum:

1. **Branch resolver** from the verified service address/ZIP (authoritative server-side).
2. **Branch ID on every commercial record**: customer, property, lead, quote, hold, request, appointment, payment, invoice, gift, document, communication.
3. **Branch-scoped policy**: `branchAllowed(actor, branchId)` and one query-scope helper.
4. **Branch configuration**: timezone, origin/travel limit, public phone/email, hours, pricing version, tax rules, calendar/resources.
5. **Branch-aware pricing/checkout**: pricing config, promotion eligibility, tax jurisdiction, Stripe metadata and receipts all use the resolved branch.
6. **Branch-aware calendar/timekeeping**: Eastern for Tampa, Central for Pensacola; no global default.
7. **Branch launch gate**: existing `lifecycle_status/status` plus readiness requirements; Tampa remains off.
8. **Migration discipline**: backfill branch IDs before enabling filters.

Avoid: separate databases per branch, duplicated app instances, a generic “tenant” abstraction, or nationwide service-area infrastructure.

---

## 7. Where prior decisions should be challenged

| Decision / pattern | Challenge | Recommendation |
|---|---|---|
| Extensive future features (portal, documents, dispatch, gifts, communications) delivered before current revenue proof | Breadth has outpaced usage | Freeze feature expansion; prove and operate the core |
| One giant admin console | Convenient initially, risky now | Split by domain; add URL state/search |
| Separate gift-admin auth/UI | Duplicate identity and audit | Retire; one register |
| Communications Center templates/routing without sender integration | Misleading control | Wire or narrow |
| Owner branch view without consistent filtering | False confidence | Implement or remove |
| Paid Google Maps fallback despite zero-spend policy | Silent cost exposure | Disable or explicitly budget/alert |
| Manual backup automation marked “operational” in release narratives | Not durable | Treat as incomplete until scheduled/restored |
| Hardcoded `branch_pensacola` and Central time | Tampa blocker | Remove before launch |
| 5,000-row CSV exports without truncation warning | Incomplete data decisions | Stream or explicit cap/notice |

---

## 8. What to stop or postpone

### Stop now

- Adding new admin modules/screens.
- Adding more document/gift/portal surface area before adoption.
- Treating staged tables or APIs as operational capability.
- Claiming “production-verified” for workflows that have no completed production record.
- Silent paid-provider fallbacks.

### Postpone

- Tampa public launch until branch financial/payment/timezone readiness passes.
- Auto-dispatch until manual dispatch is stable with real staff.
- Subscriptions/autopay until recurring demand and billing policy are proven.
- Broad marketing automation until lead follow-up and attribution are operating.
- AI/RAG or advanced integrations.

### Keep

- The public website, estimator, server verification, pricing controls, private media, Stripe security controls and test discipline.

---

## 9. Success definition for the next 90 days

The platform is materially healthier when:

1. A real/synthetic customer can complete booking and payment end-to-end, with failure recovery.
2. The owner can see and act on every failed payment attempt.
3. Reports, invoices and branch totals are trustworthy.
4. Backups run, alert and restore from a current archive.
5. MFA and legal-hold/privacy controls protect owner and customer data.
6. The owner uses the platform for daily jobs, not just the public website.
7. No new major module is added until those are true.

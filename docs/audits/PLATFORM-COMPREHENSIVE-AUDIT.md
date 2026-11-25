# Sparkling Standard Cleaning Co. — Comprehensive Platform Audit

**Audit date:** 2026-11-21  
**Auditor role:** independent architecture, engineering, security, QA and operations review  
**Repository:** `Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning` (public)  
**Branch audited:** `production-safe`  
**HEAD audited:** `f0d98f8` (`Record GitHub push synchronization`)  
**Production deployment:** `1bf95d3d-c25d-445f-b2f6-ad2e58bf1f30` (source `f0d98f8`)  
**Mode:** read-only code review, read-only production/D1 inspection, safe HTTP checks, local automated tests, and controlled browser verification

---

## 1. Executive verdict

Sparkling Standard is **not a prototype**. The public website is polished, the estimator/pricing core is unusually well engineered for a small business, server-side quote verification is real, and the admin/data model is extensive. The team has built a serious platform.

It is also **not yet a proven live booking-and-payment operation**:

- **No public estimate checkout has ever completed in production.** Production has 11 expired, 3 failed and 1 open checkout session and **zero completed** estimate sessions.
- Production has one successful **$5 live-mode invoice payment** tied to an invoice. This contradicts high-level statements that no live charge has occurred and must be reconciled with the owner.
- Most payment failures, card declines and Stripe cancellations are **invisible to the owner**; there is no durable payment-attempt queue or recovery link.
- Backups are **manual only**, the scheduled workflow is not active, `backup_runs` is empty, and the latest manual archive predates the current schema/state.
- Several staged systems are deployed but unused: **0 gifts, 0 careers applications, 0 portal sessions, 0 document templates/signatures, 0 communications settings versions and 0 delivery events**.
- The platform has **96 database relations, 62 API routes, 19 admin views and 976 unit tests** for a business with **11 customers, 31 leads, 32 booking requests and one payment** in production.

The engineering quality is high. The **operational adoption and proof of the revenue path are the weak points**.

---

## 2. Verified baseline

| Item | Verified state |
|---|---|
| Local/remote `production-safe` | `f0d98f8` |
| `origin/main` | `efcf73e`; **56 commits behind `production-safe`** |
| GitHub default branch | `main` |
| CI | Latest `validate` run successful; earlier run failed on a stale smoke assertion, fixed in `88124eb` |
| GitHub workflows active | `validate`, `photo-cleanup` |
| Cloudflare Pages | Production deployment `1bf95d3d` active from `f0d98f8` |
| D1 database | `sparkling-standard-operations`, 47 migrations applied, ~2.1 MB |
| Migration `0044_communications.sql` | **Applied**, not merely staged |
| Foreign-key check | 0 violations |
| Production branches | Pensacola `live/active`; Tampa `setup/inactive` |
| Tampa public page | 404; Service Area page contains no Tampa content |
| Production data | 11 customers, 31 leads, 32 booking requests, 15 appointments, 2 invoices, 1 payment, 2 recurring plans |
| Public estimate checkouts | 0 completed; 11 expired, 3 failed, 1 open |
| Live invoice payment | 1 succeeded, $5.00, branch `branch_pensacola` |
| Gifts / careers / portal | 0 gifts, 0 applications, 0 portal sessions/tokens |
| Documents / signing | 0 templates, 0 signing requests |
| Communications Center | 0 configuration versions, 0 delivery events |
| Backups | `backup_runs` = 0; latest manual D1 export is pre-0044 |
| Recurring worker | 4 completed, **11 failed**; 0 incidents recorded |
| Admin accounts | 1; **MFA not enabled in the database** |
| Dispatch | `analysis_only`, auto-assign off, paused; 0 decisions |

Production data is a mixture of operational/synthetic records from October–November 2026. Counts are not evidence of adoption.

### Audit side effects / limitations

- The production estimator UI check selected a date/time and may have created a short-lived booking hold. It expired automatically. No booking request, payment, customer email or checkout completion was created by this audit.
- Safe production calls were made to geocoding and travel for the owner-supplied Molino test address. They resolved through **Google** and produced a verified route.
- No live Stripe Checkout completion, charge, refund, email send, portal sign-in or document signature was executed.
- Admin screens were not live-logged-in; admin behavior is verified from source, tests and production aggregates.
- Stripe Dashboard subscriptions and live balance were not independently queried; Stripe evidence is limited to D1 and the public readiness endpoint.

---

## 3. Architecture assessment

### 3.1 What is genuinely strong

- **Static-first Astro site** with no frontend framework, no CMS and a small dependency surface. This is appropriate and should be retained.
- **Shared pricing/quote model** used by browser and server: `src/lib/estimate/calculate.ts`, `quote.ts`, `verify.ts`; checkout and lead routes recompute server-side.
- **Server-owned verification**: client price, coordinates and verdicts are not trusted; confirmed destinations and routes are re-resolved.
- **Strict TypeScript**: `astro/tsconfigs/strictest`; `astro check` reports 0 errors/0 warnings.
- **D1 migration discipline** through 47 migrations; 0 production FK violations; substantial indexes and constraints.
- **Stripe webhook and checkout controls**: signature verification, idempotency keys, durable checkout claims, duplicate-payment detection and retry generations.
- **Private R2 media** with signed links, magic-byte validation and metadata stripping for photos; private resumes and documents.
- **Meaningful unit tests**: 976 tests covering pricing, verification, checkout, webhooks, auth, booking, documents, portal, tax and dispatch.

### 3.2 Where complexity has outrun the business

| Area | Evidence | Assessment |
|---|---|---|
| Admin console | `src/scripts/admin.ts` is **5,365 lines** and renders 19 views from `src/pages/admin/index.astro` | One module is the entire operations app. High regression risk. |
| Checkout | `functions/api/estimate-checkout.ts` is **1,854 lines**; the POST handler alone spans hundreds of lines | Quote verification, Stripe, gifts, promotions, idempotency and notifications are tightly coupled. |
| Stripe webhook | `functions/api/stripe-webhook.ts` is **1,177 lines** | Invoice, estimate and gift fulfillment in one handler. |
| Documents | `src/lib/documents/service.ts` is **1,851 lines** | Template CRUD, signing, executed copies, reminders and email. |
| Manual booking | `src/lib/admin/manual-booking.ts` is **1,533 lines** | Availability, quoting, confirmation, calendar and invoicing. |
| Branch scoping | Reimplemented in at least ten modules/APIs with subtly different semantics | Security and reporting drift is already visible. |
| Auth families | D1 admin sessions, legacy R2 gift-admin sessions, portal sessions, owner bearer tokens, worker tokens | Multiple identity/audit paths for the same business. |
| Booking confirmation | Separate paths in scheduling, manual booking, commitment service and request API | Invariants can diverge between paid, admin and manual bookings. |
| Communications | 13 direct Resend call sites; templates/routing stored but not universally consumed | The owner console promises more control than the senders use. |
| Validation | 33 local text/sanitizer helpers, 58 local JSON helpers, no runtime schema boundary | Consistent validation depends on developer discipline. |

**Conclusion:** the core domain is coherent; the orchestration layer is over-concentrated. This is **not** a rewrite case. It is a consolidation and proof case.

### 3.3 Performance and infrastructure observations

- Cloudflare middleware performs a D1 query for the Tampa visibility decision **before checking the path**, so every production request, including static assets, can incur a D1 lookup (`functions/_middleware.ts:35-51`).
- The Service Area response is rewritten on every request and served `no-store`; it cannot be CDN-cached while the Tampa switch is in middleware.
- The admin bundle is large because it loads all views and the 5,365-line console even on the login gate.
- Missing growth indexes include branch-leading indexes for payments/appointments/invoices and line-item indexes for invoice/estimate detail.
- Gift inventory reads R2 objects sequentially and caps at 500/200 rows without truncation warnings (`functions/api/admin/gifts.ts`, `functions/api/gift-admin.ts`).
- Google Maps Platform is **actively used**: production geocoding and routing for the test address returned `provider=google`. The code prefers Google when `GOOGLE_MAPS_SERVER_API_KEY` exists (`src/lib/travel/server-routing.ts:82-100`; `functions/api/geocode.ts:269-359`). This conflicts with documentation claiming paid providers are disabled and with the zero-spend policy. No budget guard or quota alert was found.

---

## 4. Feature inventory and actual status

Legend: **Live-proven** = observed in production with real data; **implemented/tested** = code + automated tests but not end-to-end production proof; **partial**; **disabled**; **missing**; **unverified**.

| Capability | Status | Evidence / limits |
|---|---|---|
| Public website, navigation, mobile layout, SEO | **Live-proven** | Production 200; 39 pages; 2,498 internal links resolve; prior 390px mobile checks pass |
| Accessibility baseline | **Implemented/tested** | `npm test`/browser accessibility tests; no physical assistive-technology test |
| Residential estimator, five steps, condition tiers | **Live UI-proven; end-to-end payment not proven** | Production Step 2/3 verified at 390px; deep-cleaning checkbox, five conditions, frequency order |
| Move-in/move-out classification | **Implemented/tested** | One-time service; frequency hidden; server validation |
| Pricing and quote verification | **Implemented/tested** | Shared server model; tamper tests; no production completed checkout |
| Promotions and bundles | **Partial** | Active FRIENDS15 and HOLIDAY15; tax recomputation client-trust defect; THANKS75 disabled |
| Address/geocode/travel | **Live-proven** | Test address resolved by Google precisely; route verified; Google spend risk |
| Availability/holds | **Implemented/tested** | Calendar connected; 20-minute hold; Pay Now can be offered without a live hold in degraded states |
| Pay Later booking request | **Implemented/tested** | 32 requests, all unpaid; 27 released (mostly synthetic/test), 5 pending |
| Pay Now checkout initialization | **Live-proven to Stripe Checkout** | Prior defect fixed; current production readiness live |
| Pay Now completion / webhook booking | **Unverified** | 0 completed public estimate sessions; only one invoice-linked $5 payment |
| Payment failure/retry observability | **Partial / materially incomplete** | Quote and Stripe/transport failures mostly R2-only or absent; cancellations/declines not recorded in admin |
| Recurring service | **Implemented/tested; operationally fragile** | 2 production plans; recurring worker 11 failures, 4 completions; no alerts |
| Owner booking approval/confirmation | **Implemented/tested** | Admin request API and UI; no live owner session observed |
| Customer confirmation/owner notification | **Implemented; delivery unproven** | Resend/Web3Forms accepted; no inbox/delivery webhook evidence |
| Customer portal | **Implemented; unused** | 0 sessions/tokens; no admin inbox for portal requests; billing portal flag unverified |
| Document signing | **Implemented engine; operationally inactive** | 0 templates/signatures; terms remain proposed; branch download authorization gap |
| Gift certificates | **Code enabled; unused** | 0 certificates; D1 liability projection does not follow R2 redemption/refund; legacy duplicate admin surface |
| Careers applications | **Implemented; unused** | 0 applications; secure resume path implemented |
| Communications Center | **Deployed but not the real sender** | 0 config versions/events; templates/routing not universally used; six addresses configured |
| Admin dashboard, customers, leads, requests, finance | **Implemented; material defects** | Reports outstanding/discount always zero; duplicate invoice path; appointments/jobs oldest-row caps; branch view largely cosmetic |
| CRM/properties/notes | **Implemented; privacy gaps** | Delete/anonymize ignores legal holds; residual portal/signature/notification PII |
| Timekeeping/employee portal | **Implemented; insider control gap** | Managers can set `rateCents` in corrections; no branch scope on some actions |
| Dispatch | **Implemented; correctly paused** | 0 decisions; 1 team member; auto-assign off; manual-only future needed |
| Backups/recovery | **Manual only; not operational** | 0 `backup_runs`; workflow not active; latest archive pre-0044; no current restore proof |
| Monitoring/observability | **Weak** | 11 recurring failures, 0 incidents; no APM/alerting; payment/email failures not escalated |
| Tampa public launch | **Correctly OFF** | 404; Service Area has no Tampa; pricing 404; branch setup incomplete |
| Security baseline | **Good, with important gaps** | Strong sessions/webhooks/uploads; optional MFA, branch auth gaps, public private-address exposure |

---

## 5. Customer journey findings

### P0 — No evidence that a public estimate payment can complete end-to-end

Production has **zero completed estimate checkout sessions**. The previous “live Pay Now” verification reached Stripe Checkout but did not complete a payment/webhook/booking. The invalid `customer_update[email]` defect is fixed in source and tests, but payment success, webhook fulfillment, booking confirmation and receipt delivery remain unproven for the actual public flow.

**Impact:** the highest-intent revenue path is not proven. This is more important than any additional UI feature.

**Required:** an owner-authorized controlled test (test mode is ideal; a live minimum charge only with explicit approval), followed by verifying booking, calendar, notification, receipt and reconciliation.

### P0 — When payment does not proceed, the owner usually cannot see why

- Only `payment_not_ready` and recurring-gate failures are recorded on the booking request (`functions/api/estimate-checkout.ts` around 1198).
- Quote failures return without persistence; Stripe session/transport failures write only an R2 `checkout-failures` object with no admin reader.
- The Stripe webhook ignores every non-paid event (`functions/api/stripe-webhook.ts:552-554`); card declines and checkout cancellations create no D1 record.
- The admin request detail can only show failure fields if they were persisted; most failures are absent.
- There is no owner alert or queue for “customer tried to pay, no funds collected, action needed.”

**Impact:** lost revenue recovery and customer-service blindness. The customer may look identical to a Pay Later request.

### P1 — Canceled/failed checkout has no resume path

The cancel URL returns to a generic page and the estimator deliberately destroys state. A customer who cancels Stripe or has a card issue must re-enter all five steps and re-select the appointment. A short-lived signed resume token bound to the quote/hold/request is needed. This is a direct conversion loss.

### P1 — Paid bookings with outstanding photos dead-end

Checkout allows “I’ll Add Them Later,” marks photos outstanding, and the success page tells the customer to upload — but the success page has no upload control or tokenized link. The booking can remain `paid_awaiting_photos` until the owner chases the customer.

### P1 — Portal reschedule/support requests are not in the admin

`customer_portal_requests` is written and emailed, but there is no admin API/UI reader or status workflow. The portal form does not send the affected appointment ID even though the service can validate one. If the email fails or is missed, the request is invisible in the app.

### P1 — Returning customer Stripe email can be stale

Linked Stripe Customers are reused without updating email/name, so Stripe receipts may go to an old address after the customer changes their email. Do not restore the unsupported Checkout `customer_update[email]`; update the Customer through the Stripe API.

### P1 — Pay Now can be offered without a valid hold

Client payment eligibility checks quote/travel/address, not a live hold. If calendar finalization returns a non-held preferred state, the server rejects with `booking_hold_*` while the UI keeps a generic retry loop. Hide Pay Now unless a live hold/resume path exists, and offer “choose another time” on hold errors.

### P1 — Estimate payment refunds are not available in admin

Invoice-linked refunds have a protected admin action. Estimate payments do not, so the owner must use the Stripe Dashboard and rely on the refund webhook to reconcile afterward. Add an estimate-payment refund action with step-up, or make the dashboard fallback explicit in the paid-booking detail.

### P2 — Deep Cleaning discovery may have regressed

Deep Cleaning is now an optional checkbox reached in Step 3, not a primary Step 2 service choice. Deep-link campaigns still work, but a customer starting from the estimator may not discover deep cleaning. Validate this with real customers; if it hurts discovery, add a visible “Deep Cleaning” choice without reintroducing the old three-service selector.

### P2 — Payment success page does not poll webhook completion

It verifies the Stripe session once. A short polling/refresh state would reassure the customer while the webhook and booking projection finish.

---

## 6. Admin and operational findings

### P0 — Financial reports are wrong

`src/lib/admin/reporting.ts` selects invoice `status`, count and total only, then reads `balance_cents` and `discount_cents` from those rows. Those fields are not selected, so **Outstanding balances and Discounts always render $0**. This defeats collections oversight and discount monitoring.

### P0 — Gift D1 state does not follow the authoritative R2 ledger

R2 is authoritative for gift issue/redeem/void/refund. D1 `gift_certificates` is updated for issue/identity/delivery but **not** status/balance/transactions on redemption, void or refund. Dashboard, branch gift liability and CRM gift totals are therefore stale. There are 0 gifts today, but sales are enabled and terms are still marked proposed.

### P0 — Online payments are not branch-attributed

Estimate and gift payment projections insert `branch_id = NULL`; Stripe metadata has no branch ID; promotion evaluation hardcodes `branch_pensacola`; public checkout pricing is loaded without a branch. Today one branch masks this. It is a real financial allocation defect and a Tampa blocker.

### P0 — Tax jurisdiction is client-trusted on the dynamic-promotion path

Normal checkout tax uses the verified destination. When a dynamic promotion is applied, tax is recomputed from `fields.address_state` and `fields.zip` (`functions/api/estimate-checkout.ts:1278-1283`). A taxable commercial/church quote with an active promotion can be manipulated or accidentally misclassified. Recompute from the verified destination and fail closed on mismatch.

### P1 — Duplicate invoices are possible

`functions/api/admin/bookings.ts:151-172` reuses an invoice only when a booking already has an appointment. A pending request without an appointment creates a new invoice on every invoice action. Add a unique/request-bound idempotency key.

### P1 — Calendar/Jobs can silently show the oldest records

Admin requests return appointments with `ORDER BY start_at ASC LIMIT 200` and no date window; the Jobs list uses an unbounded date window and `LIMIT 300`. At growth, “Upcoming appointments” and Jobs can omit current work. Add a required time window and paging.

### P1 — Cancelling a job does not cancel the real booking

The Jobs status action updates only `appointments.status`; it does not delete the Google Calendar event, update the booking request or notify the customer. The Calendar & Requests cancellation path is the correct workflow. Remove raw cancellation from Jobs or route it through the full workflow.

### P1 — Owner “Branch view” is largely cosmetic

Most branch helpers bypass filtering for owners, and only pricing/dispatch meaningfully use the owner’s selected branch. Some finance/gift/document APIs also lack branch scope for non-owner roles. Decide whether this is a UI filter or security scope; implement it consistently or remove it before Tampa.

### P1 — Customer deletion ignores legal holds and leaves PII

`deleteCustomer` checks bookings/invoices/refunds/gifts but never `legal_holds`; it leaves portal request messages/sessions/tokens, signed document body text, notification recipients and R2 objects. The UI’s deletion/anonymization language overstates completeness. Photo cleanup also does not consult holds.

### P1 — Managers can alter pay rates in time corrections

The owner-only `set_rate` path is bypassed by `correct_interval`, which accepts a caller-supplied `rateCents` and arbitrary future/long intervals. Remove rate overrides from manager corrections and require owner approval for rate changes/future intervals.

### P1 — Portal requests have no admin queue

Confirmed missing workflow; see customer findings.

### P1 — Sensitive owner actions lack MFA enforcement/step-up

The single production admin has MFA disabled. Exports, customer delete/anonymization, role/branch changes, legal holds/retention, document approval, promotion activation and session revocation require only a normal session. Stripe refund/gift actions already require password step-up; extend the pattern and require MFA for owner/finance.

### P2 — Legacy gift-admin surface is broken/duplicated

The main admin Gift view links to `/gift-admin/`, whose legacy auth is retired (HTTP 410 when D1 exists). There are two gift registers and two audit trails. Consolidate on the D1 admin gift view.

### P2 — Admin navigation is not URL-addressable

Views are swapped without URL state; refresh/back returns to Overview, and deep links cannot open a customer/request/invoice. Add URL/hash state and a global search.

### P2 — Exception queues are fragmented

Failed payments, booking commitments, reconciliation issues, failed notifications, failed worker runs and failed leads are counts/pages in different places. Build one exception queue with retry/resolve/open-record actions.

---

## 7. Security and privacy summary

### Strong controls

- Server-enforced permissions with `requireActor`; cleaner role blocked from admin APIs.
- Hashed admin sessions, CSRF, HttpOnly/SameSite/Secure cookies, MFA challenge infrastructure, hashed reset tokens and anti-enumeration.
- Stripe HMAC verification with constant-time comparison and timestamp tolerance.
- Durable checkout/payment idempotency and duplicate-payment detection.
- Private R2 photos/resumes/documents; HMAC-signed photo links; magic-byte validation; metadata stripping.
- Parameterized SQL; no confirmed SQL injection, stored XSS, SSRF, path traversal or auth bypass in reviewed paths.
- Strong security headers (HSTS, frame denial, nosniff, CSP), though CSP permits inline scripts.

### Material gaps

1. **Public repository exposes private location/PII in tracked documentation** (exact owner-supplied address and coordinates). The repository is public. Redact current files and treat Git history as a privacy decision requiring owner approval.
2. **MFA optional; production admin has MFA disabled.** Add role-enforced MFA and step-up for sensitive actions.
3. **Branch authorization is uneven** (document download/verify, gifts, payment authorizations, manual invoice lookup, overview counts).
4. **Customer deletion/legal holds** and PII residuals.
5. **Manager payroll controls** allow rate overrides.
6. **CSV formula injection** in Data Control and timekeeping exports; exports truncate at 5,000 rows without clear warning.
7. **Public travel endpoint can leak private-origin distance** through mileage queries; durable rate limits are not account-wide.
8. **Photo upload accepts client-chosen `request_ref`**, enabling storage abuse/pollution.
9. **CSP `unsafe-inline`** on the same origin as admin APIs; no confirmed XSS, but defense-in-depth is weak.
10. **Admin session not bound to IP/UA**, fixed 8-hour TTL, PBKDF2 100k capped on Workers.
11. **Google Maps paid endpoints are enabled** despite zero-spend policy; no quota/budget guard found.
12. **Communications delivery is not proven**; Resend DKIM exists and Google MX is present, but no delivery/bounce webhook or inbox confirmation.

---

## 8. Data, backups, recovery and integrations

### D1

- 47 migrations applied; `0044_communications.sql` **is applied** (not staged).
- ~96 relations including `_cf_KV`, `sqlite_sequence`, `d1_migrations`; ~95 application tables.
- 0 foreign-key violations; duplicate checks found no duplicate normalized emails, quote references or Stripe payment intents.
- Data volume is small (~2.1 MB) and operational maturity is far below the schema surface.
- Some financial updates are multiple statements, not one transaction (e.g., invoice payment projection); a crash/retry can leave inconsistent invoices.
- `payments.stripe_payment_intent_id`, `booking_requests.quote_reference`, leads quote reference and `checkout_sessions.stripe_session_id` lack dedicated indexes.

### Backups

- Manual AES-256-GCM archives exist; checksums match; a D1 export has been restored in isolation (37 migrations/77 tables at that time).
- `backup_runs` = 0. The GitHub backup workflow is **not on the default branch and not active**. It backs up D1 only.
- The latest full manual archive predates migrations 0044–0047 and the current 95/96-table state.
- `backup-monitor` and `document-reminders` Workers are not deployed.
- Application R2 backup evidence exists from 2026-11-20, but no current post-migration restore rehearsal exists.
- Key is DPAPI-protected on the same machine; password-manager/off-site independence is still owner-dependent.
- The backup documentation itself states backups are not operational until the schedule, monitor and independent restore are completed.

### Stripe

- `customer_update[email]` is absent and covered by a regression test; the prior defect is fixed.
- One successful live invoice payment ($5) exists with a Stripe payment intent and paid invoice; branch is Pensacola.
- Public estimate payments: **0 completed**.
- Refunds/disputes/subscriptions: 0; no Stripe subscription/autopay code.
- Stripe Customer reuse does not update changed email/name.
- Webhook event subscriptions for failure/expiry events are not proven; readiness asserts only the main completed event.

### Email

- Six department addresses are defined in `src/config/email-routing.ts`.
- Google Workspace MX and Resend DKIM exist; DMARC `p=none`.
- Communications Center tables are empty; templates/routing are not the actual sender for most messages.
- Lead notifications use Web3Forms; Resend handles customer/invoice/gift/portal messages with hardcoded templates.
- No Resend delivery/bounce webhook; `sent` means provider acceptance, not inbox delivery.
- The company should verify all six mailboxes and reply routing with controlled messages.

### Workers / cron

- Photo-cleanup and recurring Workers are deployed.
- Recurring Worker: **11 failed / 4 completed**, 0 incidents, no alerting.
- Backup-monitor and document-reminders are absent from Cloudflare.
- No queue/retry system for email or background work.

---

## 9. Testing and CI assessment

- Unit tests: **976 total, 975 pass, 1 pre-existing skip**, ~19 seconds.
- Type check: **0 errors, 0 warnings, 2 hints**.
- Smoke: 21 pages pass.
- Full browser suite at the release candidate: **245 pass**; current HEAD is application-identical to that run (docs/smoke-script changes only).
- CI: latest `validate` success; historical failure was the stale footer smoke assertion, fixed.
- Tests are strongest around pricing, quotes, checkout, Stripe webhooks, auth, booking, documents and portal logic.
- Important gaps: no real Workers/D1/R2 integration tests, no live Stripe/Resend/Google Calendar/Turnstile test, no load tests, limited route coverage for owner exports/backup alerts, and admin tests only apply migrations through 0040.
- CI uses Node 24 while `.node-version` pins 22.16 and `package.json` says `>=20`; `node:sqlite` makes Node 20 unsuitable.

---

## 10. Ratings

| Dimension | Rating | Confidence | Why |
|---|---:|---|---|
| Website / customer experience | **8/10** | High | Premium design, clear service pages, mobile polish; some discovery and recovery friction |
| Booking and payments | **5/10** | Medium | Strong quote/payment engineering, but no completed public checkout and weak failure/recovery paths |
| Administrative functionality | **5/10** | High | Broad and useful, but financial report bug, duplicate invoice path, stale calendar/job windows, cosmetic branch view |
| Security | **6/10** | High | Strong baseline controls, but MFA optional, branch gaps, deletion/legal-hold gaps, public address exposure |
| Reliability | **5/10** | Medium | Static site stable; payment/email/worker failures poorly observed; backups not operational |
| Maintainability | **6/10** | High | Strict TS and tests; god modules, duplicated scopes and multiple auth/confirmation paths |
| Operational efficiency | **4/10** | High | Most workflows still manual; portal/communications/dispatch/document systems largely unused |
| Multi-branch readiness | **3/10** | High | Pensacola hardcoded in booking/payment/timekeeping; branch view inconsistent; Tampa correctly blocked |
| Overall production maturity | **5/10** | Medium | Live marketing site and substantial platform, but revenue path, recovery and operating adoption are not proven |

---

## 11. Direct answers to the owner’s questions

1. **How sophisticated is it relative to size?** Overbuilt. The platform is more sophisticated than the current volume warrants, though the core estimator and security work are valuable.
2. **How production-ready is it really?** The marketing site is production-ready; the booking/payment operation is not yet proven end-to-end.
3. **Five strongest capabilities:** public site/SEO, estimator and server quote verification, Stripe checkout engineering, privacy/security baseline, breadth of operational data model.
4. **Five weakest areas:** payment completion/failure recovery, backup/recovery, branch isolation/financial attribution, admin financial reporting, actual adoption of staged systems.
5. **Most likely future problems:** unobserved payment failures, stale gift/payment branch reports, silent calendar/job omissions, duplicate invoices, branch leakage/incorrect time zones, and unverified backup recovery.
6. **Where overcomplicated:** 96 tables/62 routes for current volume; 5,365-line admin script; multiple auth, gift and confirmation paths.
7. **Where underinvesting:** payment failure recovery, automated backups, operational alerting, customer self-service completion, owner workflow automation.
8. **Stop building now:** Tampa-specific features, advanced dispatch, subscriptions/autopay, additional portal/Documents/Gift surfaces, and new admin modules until the revenue and recovery foundation is proven.
9. **Prioritize immediately:** payment completion/failure visibility/resume, tax jurisdiction, backup/recovery, MFA/branch privacy, then reports/invoices/jobs/portal.
10. **Architectural direction 6–12 months:** keep static Astro + D1/R2; consolidate policy and orchestration, prove daily operation, add branch awareness economically, and automate a few high-value workflows instead of expanding surface area.
11. **What I would change as operator:** I would stop approving new features for 30 days and run the business through the platform; personally complete a test booking/payment, review every failure, establish backups and MFA, then simplify the admin around today’s jobs.
12. **Efficient cleaning company or software company?** Right now it risks becoming a software company around one cleaning company. The software is good enough; the next value comes from reliability, sales and operating discipline, not more modules.

---

## 12. Evidence boundaries

**Verified:** repository state, CI, deployment, branches, migrations, FK integrity, production counts/statuses, public endpoints, Tampa gate, dispatch pause, Google geocode/route behavior, backup configuration and manual artifacts, source-level authorization/payment findings.

**Not independently verified:** Stripe Dashboard event subscriptions/balance, actual inbox delivery/reply routing, admin live workflows, portal sign-in, Workers secret configuration, OneDrive cloud sync, full production D1 re-import/R2 restore, actual Google billing amounts, physical-device accessibility/performance.

Any remediation should begin with the P0 items in `PRIORITIZED-REMEDIATION-ROADMAP.md`, not with new feature work.

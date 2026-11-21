# Prioritized Remediation Roadmap

**Audit date:** 2026-11-21  
**Baseline:** `production-safe` @ `f0d98f8`, production deployment `1bf95d3d`  
**Rule:** this is a recommendation, not an authorization to deploy production changes. Financial, legal, branch and dispatch actions remain owner-gated.

Effort is an engineering estimate, not a promise: **S** ≤1 day, **M** 2–4 days, **L** 5–10 days, **XL** >10 days.

---

## Sequencing principles

1. Prove the revenue path before adding features.
2. Protect money and private data before expanding branches or automation.
3. Make failures visible before making more workflows automatic.
4. Consolidate existing systems before building adjacent ones.
5. Keep Tampa OFF and dispatch paused until their prerequisites are complete.

---

## P0 — Critical

### P0-1. Prove and observe the complete public booking/payment path

**Problem:** No public estimate checkout has completed in production. Payment failure/cancellation is largely invisible, and the owner cannot distinguish “pay later” from “tried to pay and failed.”

**Evidence:** Production `checkout_sessions` = 0 completed, 11 expired, 3 failed, 1 open. Stripe cancel/decline events are ignored; only two server failure reasons are persisted. `docs/audits/PLATFORM-COMPREHENSIVE-AUDIT.md` §5.

**Solution:**
- Create a durable `payment_attempts`/checkout-attempt record linked to quote, hold, booking request, amount, stage, error code, retry count, Stripe session/payment intent and funds-collected state.
- Record quote failures, Stripe session failures, transport failures, cancellations, `checkout.session.async_payment_failed`, `payment_intent.payment_failed` and expiry.
- Show the attempt in Calendar & Requests and send/queue an owner exception alert.
- Add a signed, short-lived resume/payment link to the canceled page and owner alert.
- Verify one controlled test-mode transaction first. A live minimum charge only with explicit owner approval; verify booking, calendar, owner notification, customer receipt and reconciliation.

**Benefit:** Recovers high-intent lost revenue and makes payment truth visible.

**Effort:** L. **Dependencies:** Stripe event subscriptions, schema migration, resume-token secret/design. **Risk:** High if live testing without owner approval; test mode reduces it.

**Verification:** A synthetic attempt reaches paid, webhook-created booking, owner notification and receipt; a forced failure shows reason, no funds, and a working retry; cancellation appears in admin.

### P0-2. Derive tax jurisdiction only from the verified destination

**Problem:** The dynamic-promotion path recomputes tax from client-supplied `address_state`/`zip` instead of the verified destination. This can misstate tax on taxable commercial/church jobs.

**Evidence:** `functions/api/estimate-checkout.ts:1278-1283`; the normal path uses verified travel fields at `:817-822`.

**Solution:** Reuse the verified destination/tax result from the candidate. Reject mismatches or missing jurisdiction; never fall back to request-body state/ZIP. Resolve promotion branch from the booking branch, not hardcoded Pensacola.

**Benefit:** Tax correctness and integrity.

**Effort:** S–M. **Dependencies:** Active promotions and facility quote tests. **Risk:** Existing dynamic promotions must be revalidated.

**Verification:** A quote with a mismatched client state/ZIP cannot get the lower tax result; a valid Florida facility quote still charges the correct tax.

### P0-3. Make gift and online-payment financial state correct and branch-attributed

**Problem:** Online/gift payment projections insert `branch_id = NULL`; D1 gift status/balance does not follow R2 redemption/void/refund. With branch filters, revenue and liabilities disappear or go stale.

**Evidence:** `src/lib/payments/d1-projection.ts` inserts `NULL` branch for Stripe and gift projections; `functions/api/admin/gifts.ts` and `functions/api/gift-admin.ts` update R2 only; reporting reads D1 gift balances/branch.

**Solution:** Add branch ID to every payment/gift projection and Stripe metadata. Mirror gift issue/redeem/void/refund into D1 status, balance and transactions (or make D1 a verified read model with reconciliation). Reconcile existing rows.

**Benefit:** Trustworthy P&L, branch reporting and gift liability.

**Effort:** M–L. **Dependencies:** Branch resolution rules; migration; R2 ledger contract. **Risk:** Don’t create a second authoritative gift ledger; D1 must remain a projection.

**Verification:** Gift purchase → partial redeem → refund updates dashboard liability and branch totals; online payment appears under Pensacola and survives branch filtering.

### P0-4. Close the legal/privacy gaps before further customer data use

**Problem:** Customer anonymization ignores legal holds and leaves portal messages, signed text, notification recipients and R2 objects. The public repository also contains a private owner-supplied address/coordinates.

**Evidence:** `src/lib/admin/crm.ts:651-706`; no `legal_holds` query; photo cleanup does not consult holds. Public tracked docs expose the address (references deliberately not reproduced here).

**Solution:**
- Block deletion/anonymization and photo cleanup when a legal hold applies.
- Define and implement a complete PII inventory and redaction/deletion workflow.
- Remove address/coordinate values from public docs; use synthetic examples. Treat Git history as a separate owner decision (history rewriting is destructive and not authorized here).
- Make deletion UI language match actual behavior.

**Benefit:** Privacy, legal-hold integrity and compliance.

**Effort:** M. **Dependencies:** Owner retention policy; legal review; R2 inventory. **Risk:** Irreversible deletion; require explicit owner approval.

**Verification:** Held customer cannot be deleted; non-held deletion removes/redacts all enumerated stores; public docs contain no private location values.

### P0-5. Make backup and recovery operational, current and monitored

**Problem:** `backup_runs` = 0; the scheduled workflow is not active; the latest manual archive predates migrations 0044–0047; backup monitor and document reminder Workers are not deployed. A backup is not proven until restored.

**Solution:** Put the backup workflow on the default branch, cover D1 + application R2 + master workspace, record every run in `backup_runs`, deploy the monitor/escalation Worker, make a current full archive, restore it in isolation, and verify key independence (password manager + separate off-site location). Do not restore over production.

**Benefit:** Data-loss recovery and owner confidence.

**Effort:** M–L. **Dependencies:** GitHub/R2 secrets, owner key custody, independent destination. **Risk:** Storage cost and secret handling.

**Verification:** A scheduled run appears in `backup_runs`; monitor alerts on a simulated miss; a current archive restores in isolation with expected table/object counts; key is available outside the machine.

---

## P1 — High priority

### P1-1. Enforce MFA and step-up for sensitive owner/finance actions

Production has one admin and `mfa_enabled = 0`. Exports, deletion, role/branch changes, legal holds, document approval and promotion activation require only a normal session. Stripe refunds/gifts already require a password.

**Solution:** Require MFA for owner/finance roles; add recent-password/TOTP step-up for exports, deletion, holds, role changes, branch launch, document approval, promotion activation and session revocation.

**Effort:** M. **Dependencies:** MFA enrolment policy and recovery procedure. **Verification:** A normal session cannot perform those actions; a stepped-up session can; audit records actor/action.

### P1-2. Finish branch authorization and remove hardcoded Pensacola

Ten branch-scope implementations disagree; owner branch view is mostly cosmetic; documents/gifts/payment authorizations/manual invoice lookup lack checks; booking/payment/timekeeping hardcode `branch_pensacola` and Central time.

**Solution:** One branch-policy helper, branch ID in quote/payment/metadata, branch-aware time zones, tests for cross-branch leakage. Decide whether owner branch view is a filter or a security scope.

**Effort:** L. **Dependencies:** P0-3. **Verification:** A Tampa test branch cannot see or mutate Pensacola records; Pensacola revenue stays correct; Tampa remains publicly off.

### P1-3. Fix admin financial and calendar correctness

- Reports show `$0` outstanding and discounts because `balance_cents`/`discount_cents` are not selected (`src/lib/admin/reporting.ts:48-103`).
- Pending requests can create duplicate invoices (`functions/api/admin/bookings.ts:151-172`).
- Upcoming appointments/Jobs return the oldest records with no date window (`functions/api/admin/requests.ts:358-366`; `src/lib/admin/scheduling.ts:63-84`).
- Cancelling from Jobs does not cancel the calendar event/request/customer notification (`src/lib/admin/scheduling.ts:764-779`).

**Solution:** Correct aggregates, add request-bound invoice idempotency, require today→+30/60-day windows with paging, route all cancellations through the full workflow.

**Effort:** M. **Verification:** Known fixtures render correct outstanding/discount; double-click invoice yields one; old records cannot hide future jobs; cancellation updates calendar/request/email.

### P1-4. Add a portal-request inbox and appointment linkage

Portal requests are written/emailed but have no admin UI/status workflow; the form omits appointment ID.

**Solution:** Add an admin queue with customer/appointment context, status, assignment and reply; send `appointmentId`; retry failed notification. Until then, correct copy that implies a managed workflow.

**Effort:** M. **Verification:** A portal reschedule appears in admin, links to the correct appointment, and status changes are audited.

### P1-5. Add post-payment photo recovery

A customer can pay, be told photos are required, and have no upload path on the success page.

**Solution:** Tokenized upload link bound to the request/photo reference on success/receipt, or collect at least one required photo before Pay Now; expose it in the portal.

**Effort:** M. **Verification:** A paid-with-photos-pending synthetic request can upload from the success link and move the booking to review.

### P1-6. Wire the Communications Center or narrow its promise

The center stores routing/templates, but most senders hardcode messages; delivery events are zero; no bounce/complaint webhook.

**Solution:** Use one send gateway with configured event routing/templates, record every send/failure, deduplicate invoice sends, add Resend webhook delivery states, verify all six mailboxes. If full wiring is deferred, remove unsupported claims from the UI/docs.

**Effort:** L. **Verification:** A test email to each department appears once in delivery records and in the inbox; a forced failure appears in the exception queue; invoice resend is deliberately deduplicated or explicitly allowed.

### P1-7. Reconcile the live $5 payment and release records

Production has one successful $5 live invoice payment. Prior high-level summaries say no live charge occurred.

**Solution:** Confirm with the owner whether this was an authorized test; record the decision; send/void any historical receipt as appropriate; correct release statements. Do not refund without approval.

**Effort:** S. **Verification:** Owner-signed note and consistent ledger/release record.

### P1-8. Make payment success/failure visible to operations

Add a single exception queue for checkout failures, failed payment events, failed commitments, failed worker runs, failed notifications, reconciliation issues and stale checkouts. Add retry/open actions.

**Effort:** M. **Dependencies:** P0-1. **Verification:** A forced failure generates one item with reason and next action; resolution clears it.

### P1-9. Correct customer/Stripe identity handling

Update linked Stripe Customer email/name through the Stripe API before checkout. Do not reintroduce `customer_update[email]`.

**Effort:** S. **Verification:** Returning customer with changed email gets receipts at the new address and checkout still starts.

### P1-10. Add real operational alerting

No APM; recurring worker has 11 failures and 0 incidents; payment/email/worker failures are not escalated.

**Solution:** Minimum free/low-cost alerts for failed/skipped backups, recurring failures, webhook failures, checkout failure spikes, stale open sessions and delivery failures. Use the existing incidents/monitor patterns.

**Effort:** M. **Verification:** Simulated failures produce one alert and one incident, with recovery notification.

### P1-11. Resolve the production-branch and repository topology

`main` is the GitHub default and is 56 commits behind `production-safe`; the backup workflow is not on the active default branch; deployment documentation still says `main` is production.

**Solution:** Owner decides whether production remains `production-safe` or is reconciled to `main`. Then make the active default branch, Cloudflare production source, GitHub workflows, README, AGENTS and deployment docs agree. Do not rewrite history or force-push.

**Effort:** S (decision/documentation) to M (branch reconciliation and deployment verification). **Verification:** One documented production branch; CI/backup workflows active where intended; a fresh clone can follow the guide safely.

---

## P2 — Operational improvements

| Item | Problem / solution | Effort | Verification |
|---|---|---|---|
| P2-1 Global search + URL-addressable admin | Every lookup starts by choosing a section; refresh loses context. Add Ctrl+K search and URL/hash state for view/record. | M | Support can open a record directly; back/refresh preserves view |
| P2-2 Consolidate gift surfaces | `/gift-admin/` is broken/duplicate; one D1 gift register + audit. | S–M | One working gift UI; no 410 link |
| P2-3 Split the admin console by domain | 5,365-line `admin.ts`; split by bookings/customers/finance/documents/dispatch/settings behind the current API. | L | No behavior regression; smaller initial load |
| P2-4 Consolidate booking confirmation policy | Scheduling/manual/commitment/request paths can diverge. Share one confirmation orchestrator. | L | Same gates/outcomes for paid, manual and admin |
| P2-5 Add indexes and transactional financial projections | Branch-leading payment/appointment/invoice indexes; line-item indexes; atomic invoice/payment update or repair-on-retry. | M | Query plans improve; forced retry cannot leave paid invoice unapplied |
| P2-6 Fix gift inventory and exports | Sequential R2 reads, truncation, CSV formula injection, 5,000-row cap. Paginate/parallelize, neutralize formulas, report truncation. | M | 500+ gifts load correctly; Excel formulas render as text; truncation visible |
| P2-7 Harden public cost/analytics endpoints | Origin-distance inference, in-memory/daily caps, unauthenticated photo refs. Add durable quotas, signed upload refs, fuzz/clamp mileage or require a confirmed address. | M | Distributed abuse limited; no raw origin reconstruction; storage abuse bounded |
| P2-8 Cache Tampa visibility and service-area output | D1 query on every request and `no-store` 228 KB page. Cache decision briefly; restrict DB lookup to relevant paths; build both variants or cache safely. | S–M | Assets no longer hit D1; service-area latency/cache behavior verified |
| P2-9 Observability and worker CI | Workers not typechecked/built; no structured request IDs. Add worker build/check to CI and minimal error correlation. | M | CI catches worker breakage; payment/webhook traces correlate |
| P2-10 Documentation cleanup | Main/production contradiction, stale counts, gift request-mode claims, test counts. Make one current release table and link it. | S | Docs match verified state |
| P2-11 Runtime/tooling alignment | Node 24 CI vs `.node-version` 22.16 vs `>=20`; Node 20 cannot run `node:sqlite`. | S | CI/local/docs agree; tests run on declared version |
| P2-12 Google Maps cost guard | Production uses Google Routes/Geocoding despite zero-spend docs. Disable paid providers or set budget/quota alerts with owner approval. | S | Provider choice and spend are explicit; no silent billable fallback |

---

## P3 — Future expansion (do not start yet)

| Item | Reason to wait |
|---|---|
| Tampa public launch | Requires P0-3 and P1-2; branch pricing/checkout/calendar/timezone/employee readiness |
| Advanced dispatch/auto-assignment | Current staffing is one incomplete employee; manual dispatch is enough |
| Stripe subscriptions/autopay | No customer demand proof; recurring is internal; requires billing/legal design |
| Customer self-service reschedule/cancel | First needs admin portal queue and policy; otherwise support risk |
| Additional CRM/marketing automation | Marketing attribution exists; ownership and follow-up process should be manual first |
| AI/RAG/advanced communications | Not justified by current volume; security/privacy risk |
| Multi-provider/queue infrastructure | Current Cloudflare stack is adequate; cost/complexity not justified |

---

## Suggested 30/60/90-day sequence

### First 30 days

1. P0-1 payment completion + failure ledger + resume.
2. P0-2 tax jurisdiction.
3. P0-4 privacy/holds/address redaction.
4. P0-5 backup/recovery proof.
5. P1-3 financial report/invoice/calendar bugs.
6. P1-1 MFA/step-up.
7. P1-7 $5 payment reconciliation.

### Days 31–60

1. P1-2 branch authorization and remove hardcoded Pensacola.
2. P1-4 portal inbox.
3. P1-5 post-payment photos.
4. P1-6 communications wiring/delivery monitoring.
5. P1-8 exception queue.
6. P2-3/P2-4 admin/confirmation consolidation.

### Days 61–90

1. P2 search/URL admin, gift consolidation, indexes/transactionality.
2. P2 hardening and documentation/tooling.
3. Re-evaluate Tampa only after P0-3/P1-2 pass.
4. Do not activate dispatch until a real employee profile and manual process are proven.

---

## Explicitly not recommended now

- A full rewrite or framework migration.
- Activating Tampa, auto-dispatch, autopay/subscriptions or broad AI features.
- Adding more admin modules or document/Gift surfaces before the existing ones are used and proven.
- Destructive Git history rewriting to remove the exposed address without owner approval.
- Restoring a backup over production.
- Running a live charge/refund without explicit owner authorization.

---

## Stabilization execution status — 2026-11-21

**Completed and deployed (application commit `b066554`):**
- Server-authoritative tax jurisdiction on the dynamic-promotion path.
- Correct outstanding/discount financial reporting.
- Idempotent booking-request invoice generation with migration `0048`.
- Current-window appointment/job retrieval.
- Legal-hold checks and expanded PII scrubbing on customer deletion.
- Legal-hold refusal for manual photo cleanup.
- Current-branch attribution for new online payment and gift projections.
- Durable checkout failure reason/code fields on booking requests.
- Overview alerts for failed/stale checkout sessions and missing owner MFA.
- Email-code MFA alongside authenticator MFA, with hashed single-use codes,
  5-minute expiry, 5 attempts, resend cooldown/rate limits, recovery codes and
  enrollment/disable controls. Pending authenticator secret invalidated by
  migration `0049`.
- Current pre/post-migration D1 exports verified in memory.

**Still open / owner- or credential-gated:**
- General per-action MFA step-up across every sensitive admin operation.
- Owner enrollment and successful login/recovery verification for email MFA.
- SMS provider decision, budget and abuse controls (not enabled).
- Automated nightly backups, deployed backup monitor/document reminders,
  independent OneDrive restore proof and `backup_runs` execution history.
- Real Stripe test-mode successful/declined/canceled lifecycle proof
  (public estimate checkout still has no completed transaction).
- Full payment-attempt incident queue/resume links.
- Customer portal request inbox and appointment association.
- Post-payment photo upload recovery.
- Communications Center sender/template wiring and delivery/bounce webhook.
- Historical branch/gift backfill, which must not be guessed or rewritten
  without evidence.
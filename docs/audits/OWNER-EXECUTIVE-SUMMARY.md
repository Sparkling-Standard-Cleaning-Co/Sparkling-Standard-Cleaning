# Owner Executive Summary — Platform Audit

**Date:** 2026-11-21  
**Scope:** the live website, booking/payment path, admin operations, security, backups, email, branch readiness and dispatch  
**Full detail:** `docs/audits/PLATFORM-COMPREHENSIVE-AUDIT.md`  
**Work plan:** `docs/audits/PRIORITIZED-REMEDIATION-ROADMAP.md`  
**Architecture/efficiency:** `docs/audits/ARCHITECTURE-EFFICIENCY-RECOMMENDATIONS.md`

---

## The short version

You have built a good website and a serious operations platform. The public site looks professional, the pricing engine is carefully protected, and the codebase has stronger security and testing than most small-service businesses.

But the business is not yet **proven** through the platform. The most important facts are:

- **No customer has completed a public estimate payment through the live website.** Production shows 11 expired Stripe sessions, 3 failed sessions, 1 open session and **0 completed**.
- There is one successful **$5 live invoice payment** in the production database. Previous summaries said no live charge occurred. You need to confirm whether that was an authorized test and make the records consistent.
- **Failed payments are mostly invisible.** If a customer tries to pay, their card is declined, or Stripe is canceled, you usually cannot see the attempt or a reason in the admin. That is lost revenue and lost follow-up.
- **Backups are not operational as a scheduled system.** `backup_runs` is empty, the scheduled workflow is not active, and the latest manual archive predates the current database changes.
- Many staged systems have **never been used**: zero gifts, zero career applications, zero customer-portal sessions, zero signed documents, zero communications settings and zero delivery events.
- The platform has **96 database tables and 62 API routes** for 11 customers, 31 leads and one payment. That is a software company’s level of complexity around a young cleaning operation.

---

## What genuinely works

1. **The public website** — clear, fast, mobile-friendly, strong branding, good service pages and SEO.
2. **The estimator** — the five-step experience, address/travel verification and server-side price recalculation are real assets.
3. **Pricing/payment security** — the server does not trust the browser’s price or location, and Stripe webhook/customer handling is carefully engineered.
4. **The data foundation** — migrations are disciplined, relationships are mostly consistent, and customer documents/photos are private.
5. **The admin breadth** — customers, requests, invoices, jobs, documents, gifts, dispatch and reports all exist, even though several need repair.

---

## What is not working well enough

### Money and bookings

- The live payment path has not completed end-to-end. Reaching Stripe Checkout is not the same as a paid booking.
- A customer who cancels or fails payment must start the entire questionnaire again.
- A customer who pays with photos outstanding is told to upload later, but the success page has no upload link.
- Staff cannot see most failed payment attempts, declines or Stripe errors.
- Estimate payments cannot be refunded in the admin.
- Refunds, subscriptions and autopay have never been exercised.

### Admin and reporting

- The financial report shows **$0 outstanding and $0 discounts** even when invoices have balances because the query does not select those values.
- Pending bookings can generate duplicate invoices.
- “Upcoming appointments” and Jobs can silently show the oldest 200–300 records instead of current work.
- Cancelling a job in Jobs & Team does not cancel the calendar event or update the customer booking.
- The owner “Branch view” is largely cosmetic; most screens still show all branches.
- Customer deletion ignores legal holds and leaves personal data in several places.
- Managers can alter pay rates through timekeeping corrections.

### Security and privacy

- The production admin account does **not have MFA enabled**, and sensitive export/delete/role/branch actions do not require a fresh password or code.
- The public repository contains a private owner-supplied address and coordinates in tracked documentation. This should be redacted, and Git history needs an owner decision.
- Some branch-sensitive document/gift/payment endpoints do not enforce branch scope.
- Customer deletion and photo cleanup are not legal-hold aware.

### Reliability and recovery

- Scheduled backups are not active; `backup_runs` is empty; backup-monitor and document-reminder Workers are not deployed.
- The recurring scheduler has **11 failed runs and 4 successful runs**, with **zero incidents** and no alerts.
- Email delivery cannot be proven from the application. “Sent” means Resend accepted the request, not that it reached an inbox.
- Google Maps routes/geocoding are being used in production despite the zero-additional-spend policy and documentation saying paid providers are disabled.

### Branch and future features

- Tampa is correctly OFF, but the booking/payment/timekeeping code still hardcodes Pensacola and Central time.
- The dispatch engine is thoughtfully constrained but unnecessary at current staffing; it is correctly paused.
- Gifts, documents, portal and careers are implemented but unused. Adding more features in this state would increase maintenance without increasing revenue.

---

## The most important risks, in business terms

| Risk | Consequence |
|---|---|
| Payment completion unproven | You may believe you can take online bookings when you cannot reliably do so |
| Payment failures hidden | High-intent customers are lost without follow-up |
| Financial reports wrong | You cannot trust outstanding balances or discounts |
| Backups not operating | A data loss event could be unrecoverable or outdated |
| MFA/step-up gaps | One stolen admin session can export or delete customer data |
| Private address in a public repo | Privacy exposure for you and the business |
| Branch scope inconsistencies | Tampa reporting/security will be wrong if launched without fixes |
| Unused staged systems | Time and money spent maintaining capabilities nobody uses |

---

## What I recommend you do next

### First 30 days — stabilize the business path

1. **Prove one complete booking/payment flow** in a controlled way. Prefer Stripe test mode; any live charge requires your explicit approval. Verify the booking, calendar, email, receipt and ledger.
2. **Create a payment-attempt record and recovery queue** so you can see who tried to pay, why it failed, whether money moved and what to do next.
3. **Fix tax jurisdiction** so promotions cannot use a client-supplied state/ZIP.
4. **Fix customer deletion/legal holds and remove the private address from current public docs.**
5. **Make backups scheduled, current and restore-tested**; deploy the backup monitor.
6. **Enable MFA and require step-up** for exports, deletion, role/branch changes, legal records, promotions and document approval.
7. **Fix the financial report, duplicate invoices, current appointment window and job cancellation.**
8. **Reconcile the $5 live payment** with your records.

### Days 31–60 — make the operation usable

- Add an admin inbox for portal requests and link reschedule requests to the real appointment.
- Give paid customers a tokenized photo-upload path.
- Wire the Communications Center to actual sends, or stop presenting it as a complete control center.
- Add one exception queue for failed payments, failed deliveries, failed workers, outstanding balances and unsigned documents.
- Implement real branch scoping and remove hardcoded Pensacola/time-zone assumptions.
- Split the admin console by domain and add URL state/global search.

### Days 61–90 — reduce labor, not add modules

- Add payment/request follow-up, invoice reminders and review requests only after the above is stable.
- Use a simple manual assignment board for today’s jobs; do not activate advanced dispatch.
- Fix gift/query/export performance and documentation.
- Reassess Tampa only after branch financial attribution and checkout are proven.
- Keep Tampa OFF and dispatch paused.

---

## What to stop building for now

- Tampa launch features.
- Advanced dispatch/auto-assignment.
- Subscriptions/autopay.
- More portal/document/gift surfaces.
- Additional admin modules.
- AI/RAG and speculative integrations.

The company does not need more software surface. It needs the existing software to be **provable, reliable, secure and actually used**.

---

## Ratings

| Area | Rating | Explanation |
|---|---:|---|
| Website/customer experience | **8/10** | Strong design, messaging and mobile experience; some recovery/discovery friction |
| Booking and payments | **5/10** | Excellent engineering foundations, but no completed public estimate payment and weak failure recovery |
| Administrative functionality | **5/10** | Broad capabilities with material reporting, invoicing, calendar and branch defects |
| Security | **6/10** | Strong baseline, weakened by optional MFA, branch gaps, privacy/deletion issues and public address exposure |
| Reliability | **5/10** | Stable site, but payment/email/worker failures are poorly observed and backups are not scheduled |
| Maintainability | **6/10** | Strict TypeScript and good tests, but god modules, duplicated policy and multiple auth/confirmation paths |
| Operational efficiency | **4/10** | Most day-to-day work is still manual; many staged systems are unused |
| Multi-branch readiness | **3/10** | Pensacola hardcoded; branch scope/reporting/timezone not ready |
| Overall production maturity | **5/10** | Live and promising, but not yet a proven booking-and-payment operation |

**Confidence:** high on the code, deployment, database, backup and branch findings. Medium on payment completion and email delivery because no real/synthetic completed transaction or inbox confirmation was performed in this audit. No financial or destructive action was taken.

---

## The one-sentence answer

**Sparkling Standard has a strong website and an overbuilt platform for its current volume; stop adding systems, prove the payment/booking path, make failures visible, secure and back up the data, and operate the business through the tools you already have.**

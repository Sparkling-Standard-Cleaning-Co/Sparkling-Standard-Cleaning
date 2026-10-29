# Launch readiness — evidence-backed status

**Last updated:** 2026-10-28. **Last production release:** `7bb91ff` (Cloudflare Pages deployment
`5529baa6-591b-4501-b40f-8d23f6f273b9`; GitHub run `40783479501` passed `validate` and `browser`,
and the Cloudflare check passed). **Local unreleased work:** five-step residential/STR estimator,
premium appointment calendar, automatic address resolution, strict FL/AL suggestions, two-resource
scheduler and service-location tax engine. Local verification: 647 unit tests (646 pass, 1 skip),
154 browser tests pass, `npm run check` 0 errors, `npm run verify` and `npm run smoke` pass.
This is the working checklist required by the launch directive. It distinguishes implementation from
deployment, activation and actual provider verification.

## Status vocabulary

- **Implemented** — working code exists.
- **Tested** — relevant automated/manual verification passed.
- **Deployed** — present in the production build.
- **Activated** — enabled for the intended production users.
- **Provider-verified** — the real external provider was exercised successfully.
- **Approval pending** — a specific owner/legal decision remains.
- **Not implemented** — no working path exists.

## Website and estimators

| Capability | Status | Evidence / limitation |
| --- | --- | --- |
| Public marketing site | Deployed, activated, production-verified | 29 pages build; live routes return 200; 2,055 internal links, SEO and QR validation pass. |
| Five-step residential/STR journey | Implemented, tested locally; **not deployed** | Exactly When & Where → Service & Home → Condition & Frequency → Optional Extras → Your Estimate. 154 browser tests pass, including 360/768/1440 layouts and no-overflow checks. Screenshot review completed; production verification pending deployment. |
| Premium appointment calendar | Implemented, tested locally; **not deployed** | Month calendar plus compact First/Afternoon hour-and-minute picker (15-minute increments); live availability, provisional selection, final-duration revalidation, temporary hold and real alternatives. Browser tests cover the hold path and compact picker. |
| Simplified address entry | Implemented, tested locally; **not deployed** | Manual fields always visible; background exact/close resolution; no map/pin confirmation; FL/AL-only suggestions; ZIP fallback. Street-level/approximate results stay preliminary. |
| Photo requirement and deferred confirmation | Implemented, tested locally; **not deployed** | Photos are collected in Condition & Frequency and required before booking confirmation. Pay Now without photos offers Upload Photos Now or Pay Now, Confirm Later; payment-success copy distinguishes pending photos from ordinary owner confirmation. |
| Community Support checkbox | Implemented, tested locally; **not deployed** | The large inspirational box and optional notes were replaced by one small eligibility checkbox linked to /terms/#community-support; discount calculation and self-attestation rules are unchanged. |
| Residential estimator | Implemented, tested, deployed, activated | Browser journey and server quote verification pass; prices reveal at the final step. Five-step redesign is in the unreleased local build. |
| Commercial estimator | Implemented, tested, deployed, activated | Tier A/B provisional numbers; Tier C scope review; owner kill switch enforced server-side. |
| STR estimator | Implemented, tested, deployed, activated | Per-turnover model; one-time semantics; optional turnover context. |
| Church estimator | Implemented, tested, deployed, activated | 10% eligible discount, reconciliation and Tier C review verified. |
| Address autocomplete / GPS / manual / pin | Implemented, tested, deployed, activated | MapMap/Census live routing previously production-verified; browser regression covers fallbacks. |
| Four-county eligibility | Implemented, tested, deployed | Escambia/Santa Rosa FL and Baldwin/Escambia AL policy layers; boundary cases route to review. |
| ZIP/microzone geographic pricing | **Approval pending** | Proposal/evidence required before any new dollar amounts activate. Current travel behavior remains. |
| Sales tax calculation | Implemented, tested, deployed in the next release | Service-location engine: FL residential/STR not taxable; FL commercial/church 6% + verified county surtax (Escambia 7.5%, Santa Rosa 7.0% for 2026); AL cleaning outside the sales-tax base. Unknown jurisdiction fails closed and withholds Pay Now. Rates require re-verification for 2027. |
| Customer photos | Deployed, activated | Private R2, metadata stripping, signed links, optional upload, owner attachments. |
| Photo retention execution | Deployed; **activation/verification pending** | Daily workflow exists but needs the `PHOTO_OWNER_TOKEN` repository secret; first run not observed. R2 lifecycle rule not yet confirmed. |

## Payments and financial records

| Capability | Status | Evidence / limitation |
| --- | --- | --- |
| Secure Stripe checkout | Implemented, tested, deployed | Live mode configured; verified-quote-only, idempotent session creation, signature-verified webhook. |
| Pay Now | Deployed, activated for verified exact quotes | **No live charge has been made.** |
| Reserve Without Payment | Implemented, tested, deployed, activated | Request remains non-guaranteed until owner confirmation. |
| Itemized customer receipts | **Not implemented** | Invoice generator exists for commercial use; customer receipt delivery is not complete. |
| Refund synchronization / reconciliation | Partial | Gift unused-certificate refund/void path exists; no live Stripe refund; general reconciliation not complete. |
| Tax accounting | Implemented, tested, deployed in the next release | Tax is stored with the checkout record and carried into the owner notification/customer summary. No live tax-inclusive charge has yet been run. |

## Gift certificates

| Capability | Status | Evidence / limitation |
| --- | --- | --- |
| Purchase UI and approved values | Deployed; **sales disabled** | `$50/$100/$150/$200`, custom `$25–$500`, terms acceptance and email validation. |
| Stripe issuance and immediate delivery | Implemented, tested, deployed | Idempotent by Stripe event; purchaser/recipient email with retry handling. No live purchase. |
| Future valid-from activation | Implemented, tested, deployed | Exact `12:00 AM America/Chicago`; DST and boundary tests pass; server-enforced on redemption. |
| Balance lookup | Deployed, activated | Public endpoint exposes value/status/activation only. |
| Administrator enrollment | **Verified by owner 2026-10-28** | Owner reports enrollment worked after the Workers PBKDF2 fix; `GET /api/gift-auth` now reports `configured:true`. |
| Administrator login / session security | Implemented, tested, deployed | PBKDF2 100k versioned hashes, hardened cookie, CSRF, step-up, distributed IP/account limits. |
| Backup-email recovery | Implemented, tested locally; **live recovery unverified** | Requires owner to verify the backup email and complete one recovery test. |
| SMS recovery | Research complete; **not implemented** | No provider purchased or activated; see `SMS-RECOVERY-RESEARCH.md`. |
| Gift redemption at cleaning checkout | **Not implemented** | Owner can record a redemption against a job; automatic checkout credit and remainder payment are missing. |
| Partial redemption / void / unused refund | Implemented, tested; live provider unverified | Ledger is ETag/CAS guarded; simultaneous-redemption test added. |
| Dispute/chargeback reconciliation | **Not implemented** | Manual handling only. |
| Liability dashboard | Implemented, tested, deployed | Inventory, search, totals, activation and redemption history. |

## Scheduling and operations

| Capability | Status | Evidence / limitation |
| --- | --- | --- |
| Temporary holds and owner approval | Implemented, tested, deployed, activated | 20-minute holds, durable pending requests, owner-token confirmation. |
| Booking-hold correctness | Fixed in `74fbf05` | Minute-boundary quote recalculation no longer clears a held time; regression test added. |
| Google Calendar integration | Deployed, owner-approval mode | Connected calendar / availability previously checked; calendar currently has no jobs. Real event creation still needs an owner-authorized test. |
| Two independent cleaners | Implemented, tested, deployed in the next release | Resource-aware availability, per-resource holds, concurrent independent jobs, joint jobs on owner confirmation, reassignment and rescheduling. Owner approval and the calendar remain the source of truth. |
| Customer history | **Not implemented** | No unified customer/job record across estimates, payments, gifts and agreements. |
| Agreement / e-sign workflow | **Not implemented / legal approval pending** | Draft materials are preserved untracked; no signing workflow is published or activated. |

## Infrastructure, security and reporting

| Capability | Status | Evidence / limitation |
| --- | --- | --- |
| Distributed admin rate limiting | Implemented, tested, deployed | Durable per-IP and account counters; setup, login, recovery and reset covered. |
| Financial page caching controls | Implemented, deployed | `public/_headers` sets no-store/noindex on admin, redemption and payment-result pages. |
| Photo retention | Deployed; execution pending activation | Daily workflow skips without the repository secret; R2 lifecycle option documented. |
| Independent backups | **Not implemented** | No separate backup destination, daily snapshot or restore test exists. |
| Backup restore test | **Not performed** | Required before claiming recoverability. |
| GA4 / GTM | Deployed, activated; partial verification | Consent-gated container; page views and core events previously received. New church/promotion event receipt still needs DebugView confirmation. |
| Search Console / GBP reporting | Owner-confirmed linked | Do not rebuild; verify reports when dashboard access is available. |

## Critical-path blockers

1. **Gift sales:** final gift-terms legal review, a live/test-mode Stripe purchase, valid-from
   redemption, refund and reconciliation exercise, and explicit activation authorization.
2. **Checkout redemption:** gift-code application at cleaning checkout is not built.
3. **Receipts:** itemized customer receipts and ledger reconciliation are incomplete.
4. **Backups:** no independent backup or successful restore.
5. **Photo retention:** scheduled execution not yet activated or observed.
6. **Email recovery:** implemented, but the live verified-email recovery path still needs an owner
   test.
7. **Agreements:** legal review and signing workflow not activated.
8. **Geographic pricing:** proposed ZIP/microzone amounts await owner approval; current behavior
   stays in force.
9. **Tax rate rollover:** the 2026 Florida table must be re-verified before 2027 charges; until then
   the engine fails closed for taxable services.

## Owner actions required now

- Add the `PHOTO_OWNER_TOKEN` repository secret (or configure the R2 `leads/` 30-day lifecycle rule)
  and confirm the first cleanup run.
- Verify the gift administrator backup email and complete one password-recovery test.
- Decide whether to approve a paid SMS provider; Twilio Verify is the recommended low-volume option.
- Provide a separate approval for any real Stripe charge/refund before it is executed.
- Approve or reject the ZIP/microzone pricing proposal when presented.
- Provide legal approval before publishing agreements or activating gift sales.

## Next safe engineering actions

1. Build gift redemption at checkout with durable reservation/commit semantics.
2. Add itemized receipt generation and Stripe ledger reconciliation.
3. Implement independent backups and run a restore test.
4. Complete customer/job history and the agreement signing workflow after legal review.
5. Re-verify the Florida county surtaxes for 2027 before the rate table expires.

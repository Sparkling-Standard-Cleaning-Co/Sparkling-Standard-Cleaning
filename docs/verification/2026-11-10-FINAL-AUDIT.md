# Final operational audit - 2026-11-10

This is the final closeout inventory for Sparkling Standard. It reconciles the
current code, the live Cloudflare deployment, production D1, the provider
connections and the automated tests. It does not repeat historical checklist
items that are already implemented and verified.

## 1. Executive operational status

**Can Sparkling Standard safely accept new residential cleaning customers in
Pensacola today? CONDITIONAL YES.**

The public site, all four estimate engines, lead delivery, D1 persistence,
booking holds, Google Calendar reads, Stripe live readiness, the admin, the
employee portal and the documents engine are operational. The conditions are
verification and owner actions, not known customer-blocking defects:

- no live Stripe card charge/webhook has been performed;
- the Google Calendar **write** lifecycle still needs one owner-authorized
  synthetic event;
- approved legal agreement templates and final wording are still owner/counsel
  work, so the signing system is implemented but not legally activated;
- one CI browser check was flaky and has been hardened in this closeout.

No pricing, published service area, customer record, appointment or financial
history was changed by this audit. No live charge, refund or legal agreement was
activated.

## 2. System-by-system status

| System | Status | Evidence |
| --- | --- | --- |
| Repository and deployment | Verified | Local `production-safe`, `main` and both remote tips synchronized; Cloudflare canonical deployment verified |
| Website pages and navigation | Verified | Build 35 pages; validate/smoke pass; live pages return 200 |
| Residential / STR / Commercial / Church estimators | Verified | 208 browser tests; live forms have no false delivery warning |
| Contact form and lead relay | Verified | `/api/lead-readiness` `ready:true`; production D1 5/5 leads `sent` |
| D1 persistence | Verified | 31 migrations, 72 application tables, 0 FK violations; encrypted backup restore PASS |
| Google Calendar read / availability | Verified | `/api/booking-status` connected, `eventReadOk:true`; availability returns real slots for multiple dates |
| Google Calendar write / recurring replenishment | Partially verified | Read and schedule calculations verified; last daily run failed only during the Workspace billing interruption; write lifecycle not live-tested |
| Stripe checkout readiness | Verified (configuration) | `/api/estimate-checkout` live, all readiness checks true; no live charge |
| Stripe Customer synchronization | Implemented and unit-tested | Checkout now creates/reuses one durable Stripe Customer linked to the D1 customer; webhook projects the same ID |
| Invoices, refunds, gifts | Implemented and tested | Unit/browser suites; no live money moved |
| Admin / CRM / properties / leads | Verified | Admin suites and browser workflows; branch assignment gaps documented below |
| Branch management | Partially implemented | Backend branch scoping exists; global owner branch selector and several legacy NULL assignments are missing |
| Documents and signatures | Implemented and tested | Upload, approval, bundles, signing, countersign, verification, executed copy; owner executed-document email added in this closeout |
| Employee portal / timekeeping | Verified | Employee browser and unit suites; live `/employee/` returns 200 |
| Automatic photo cleanup | Implemented and live-verified | New daily R2 Worker deployed; dry run scanned 22 objects, 0 eligible; real run deleted 0 |
| Security / authentication / MFA | Verified | Unit and browser suites; unauthenticated admin APIs reject; no secrets in client bundles |
| Backups | D1 verified; R2 object archive not available | Encrypted D1 backup/restore PASS; R2 buckets verified; object-level archive needs S3 credentials |

## 3. Work completed during this audit

- Added durable Stripe Customer resolution at public checkout, deterministic
  idempotency, legacy-linked-customer adoption and webhook D1 synchronization.
- Added idempotent executed-document owner email with a durable outbox, executed
  copy attachment and retry action.
- Added and deployed `sparkling-standard-photo-cleanup`, a daily R2 Worker that
  deletes only eligible `leads/` photos and sidecars; dry run and real run
  verified.
- Hardened the flaky estimate UX browser test that failed one CI run.
- No pricing, booking, customer, financial or legal data was changed.

## 4. Remaining pending inventory

Categories: **A** genuine technical defect, **B** unfinished implementation,
**C** configuration/integration, **D** owner-only, **E** optional improvement.

| ID | Cat | Item | Severity | Status and evidence | What remains / owner | Pensacola blocker? | Central Florida blocker? | Previously reported complete? | Closure verification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P01 | A | CI flake in `estimate-ux-corrections` address-map wait | Medium | Reproduced once on GitHub; passed locally and on the paired main run; test hardened | Final GitHub run must be green | No | No | No | `validate` and `browser` jobs green on the final SHA |
| P02 | C | GitHub photo-cleanup workflow skips (no `PHOTO_OWNER_TOKEN` repo secret) | Medium | Daily run logs "not configured; skipping" | New R2 Worker now performs cleanup without this secret; either add the secret or retire the redundant workflow | No | No | Photo retention was previously described as implemented | Scheduled Worker run observed; no eligible photo deleted unless older than 30 days |
| P03 | C | Google Calendar write lifecycle not live-tested | High | Reads/availability verified; no synthetic write performed | Owner runs `scripts/booking-live-test.mjs` with `BOOKING_OWNER_TOKEN` | No | No | Read access was verified; write remained outstanding | One created/verified/cancelled synthetic event |
| P04 | C | Last recurring Worker run failed during Workspace billing interruption | Medium | D1 run `2026-11-10` shows `calendar_auth_failed`; Calendar now connected | Observe the next daily run, or run the protected endpoint once after owner approval | No | No | Recurring engine was reported implemented | One completed `recurring_worker_runs` row after Calendar restoration |
| P05 | B | Global owner branch selector (`All Branches` / Pensacola / Tampa) | High for expansion | Backend scopes by `actor.branchId`; admin UI has no operating-branch selector and owner views all branches | Build selector + central scope override; no data activation | No | Yes | Branch scoping was described as supported | Browser test switches branch; manager scope test; new record inherits selected branch |
| P06 | B | Legacy records with no branch | Medium | Production: 2 customers, 1 property, 8 appointments, 1 recurring plan NULL branch | Decide and backfill to Pensacola (or another approved branch) with audit | No (owner sees all) | Yes | Not previously called out | Aggregate query returns 0 unassigned operational records |
| P07 | B | Public recurring automatic-payment consent | High for recurring convenience | No public consent checkbox/SetupIntent; admin saved-card authorization exists | Owner-approved terms + separate SetupIntent flow; keep automatic charging disabled until tested | No (pay-later works) | No | Not previously complete | Approved terms version, unchecked-by-default consent, setup/webhook tests, admin status |
| P08 | B | Safe Word document processing | Low | Upload accepts PDF only and validates PDF magic bytes | Define safe DOCX conversion/validation if required | No | No | Not previously complete | Upload/preview/version tests for approved formats |
| P09 | C | Live Stripe charge/webhook end-to-end test | High (financial confidence) | Live readiness true; no real charge/refund performed | Owner-authorized controlled live test | No | No | Repeatedly outstanding | One controlled charge, webhook, receipt, refund/void as approved |
| P10 | C | GA4 church/promotion event receipt | Low | Earlier key events verified; new events not confirmed in DebugView | Owner checks GA4 Realtime | No | No | Deployment complete; event receipt outstanding | DebugView/Realtime receipt |
| P11 | D | Approved legal agreement wording/templates | Critical for signing activation | Production `document_templates` count is 0; signing engine is live but no legal document is activated | Owner and Florida counsel approve wording, upload and approve templates | No for current operations | No | Catalog existed; no approved templates | Approved template + signing gate test with a synthetic approved template |
| P12 | D | Insurance/bonding/licensing claims and final launch checklist | High for claims | `business.launch.productionApproved` remains false; no fabricated claims | Owner supplies evidence and approves wording | No for service delivery | No | Outstanding | Claims audit passes with owner evidence |
| P13 | D | Tampa Bay / Central Florida activation | High for expansion | Branch exists but is `inactive`; no public service area, staffing or schedule | Approve service area, crew, calendar and pricing, then activate | No | Yes | Not previously complete | Branch active + staffing + calendar + live booking test |
| P14 | C | Full R2 object-level archive | Medium (recovery) | Buckets exist; no S3 credentials/object-list API in this environment | Configure encrypted R2 backup destination and restore test | No | No | Backup inventory previously noted this gap | Object manifest + restore test from encrypted archive |
| P15 | C | `GOOGLE_CLIENT_SECRET` stored as `plain_text` | Medium (security) | Visible to authorized Cloudflare project readers and the deployment-audit API; not present in public code or HTML | Decide based on access/log retention; rotate only if justified | No | No | Previously flagged as exposed; exposure limited to authorized access | Secret stored as encrypted secret; Calendar reauthorized if rotated |
| P16 | C | Google Workspace billing continuity | Medium | Calendar restored after owner payment (~$7); subscription monitoring not automated | Owner monitors billing; no credential change | No | No | Billing interruption was the likely cause of `auth_failed` | Calendar connected and billing active at next monthly check |
| P17 | E | Turnstile not configured | Low | Honeypot, rate limits and server validation active; Turnstile optional | Enable if spam volume warrants | No | No | Optional | Turnstile site/secret set and challenge tested |
| P18 | E | CI Node 20 deprecation warning | Low | GitHub warns actions targeting Node 20 | Update workflow actions when convenient | No | No | No | Workflow runs without the warning |

## 5. Owner action checklist

1. Authorize one controlled Stripe live charge/webhook/refund test (or a
   test-mode run) before treating payments as fully proven.
2. Run the one-command Google Calendar write test after operations settle.
3. Review/approve final legal agreement wording and supply approved templates.
4. Decide the branch-selector/backfill and Tampa activation plan.
5. Decide whether to enable optional recurring autopay after approved terms.
6. Keep Google Workspace billing active and monitor it.
7. Review the `GOOGLE_CLIENT_SECRET` storage decision; rotate only if access is
   shared or logs are retained beyond the authorized account.

## 6. Security and financial risks

- **No public credential exposure was found.** `GOOGLE_CLIENT_SECRET` is
  `plain_text` inside Cloudflare and was visible to an authorized account-level
  API call used for this audit. It is not in the repository, client bundle,
  HTML or public endpoint. Risk is limited to authorized account readers and
  retained audit logs.
- No live charge, refund, saved card, subscription or signature was created.
- D1 is backed up and restore-verified. R2 object-level archival remains a
  recovery gap, not a current customer-blocking defect.
- The photo cleanup Worker is deliberately narrow; only server-generated
  `leads/` photo keys and sidecars can match.

## 7. Production release status

The application-code release for this audit is recorded in
`docs/verification/VERIFICATION.md` and the final reconciliation report.
Cloudflare production, GitHub `main` and `production-safe`, and the local
checkout must remain on the same verified tip.

## 8. Recommended closure order

1. Confirm the final GitHub `validate`/`browser` runs are green.
2. Run one controlled Stripe live/test-mode transaction and verify the webhook,
   D1 payment, receipt and refund path.
3. Run the Google Calendar write test and observe the next recurring Worker run.
4. Complete legal templates and owner launch claims.
5. Implement the branch selector and backfill legacy NULL branches.
6. Approve recurring autopay terms, then implement and test the consent flow.
7. Activate Central Florida only after staffing, service area and scheduling
   approval.

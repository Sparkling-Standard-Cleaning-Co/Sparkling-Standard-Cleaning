# Isolated Preview End-to-End Acceptance — 2026-11-22

**Status:** the isolated Preview acceptance run completed. No production
deployment, production migration, live charge, customer email or production
calendar change was made. Production signing activation remains closed.

## Repository state

| Item | Value |
|---|---|
| Branch | `release/2026-11-22-legal-signing-acceptance` |
| Starting HEAD | `635efcf33f4c2b43e41848ed378c33c8427044a1` |
| Acceptance commit | `bac338781a8fd77786169994b0858e7e047db7a3` |
| `production-safe` baseline | `459383d5618a304f56390bb542de77e7a332aed6` |
| Pull request | #1, targeting `production-safe`; OPEN and MERGEABLE |
| CI | `validate` and `browser` pass on the acceptance commit |
| Production | unchanged; no merge or deployment |
| Live charges | none |

## The `preview_read_only` blocker — resolved

`functions/_middleware.ts` now permits one exact Preview host to execute
application APIs only when a Preview-only secret token is configured and the
caller proves possession of it. Ordinary Preview hosts and production are
unchanged.

Implementation:

- `src/lib/env/preview-e2e.ts` — exact-host allowlist, host-bound HMAC session,
  short-lived HttpOnly/Secure/SameSite=Lax cookie, constant-time comparison,
  origin check for cookie-authenticated mutations, and a narrowly scoped
  Stripe-webhook exemption that still requires Stripe signature verification.
- `functions/api/e2e/session.ts` — exchanges the token for the cookie; refuses
  every non-allowlisted host.
- `functions/_middleware.ts` — preserves the `preview_read_only` 503 for every
  ordinary Preview API and for unauthenticated requests, and never applies the
  exception on production hosts.
- `tests/preview-e2e.test.ts` — unit coverage for host matching, token
  binding/expiry/tampering, cookie authorization, webhook exemption and
  production isolation.
- `tests/browser/document-sign-resume.test.mjs` — regression coverage for the
  signing-page resume capability.
- `docs/operations/PREVIEW-E2E-GATE.md` — enable/disable procedure and security
  requirements for future authorized test windows.

### Live security matrix

| Request | Result |
|---|---|
| Preview API with no authorization | `503 {"error":"preview_read_only"}` |
| Preview API with a wrong token | `503 preview_read_only` |
| Exact E2E host with a valid token/cookie | `200` |
| Exact E2E host session exchange with a wrong token | `401 unauthorized` |
| Ordinary control Preview (`e2e-control-2026-11-22`) with the valid token | `503 preview_read_only` |
| Ordinary control Preview session exchange with the valid token | `503 preview_read_only` |
| Stripe webhook without a valid signature | `400 invalid_signature` |
| Production `/api/admin/documents` with the E2E token | `401 unauthorized` |
| Production `/api/estimate-checkout` POST with the E2E token | `400 invalid_request` (normal production validation, not a Preview gate) |
| Production homepage | `200`, unchanged |
| E2E Preview after cleanup, using the old token | `503 preview_read_only` |

## Isolated infrastructure used

| Resource | Identifier |
|---|---|
| D1 | `sparkling-standard-e2e-20261122155654` / `6dcb82d5-5de8-4dfa-9de9-7235d0b5ee3e` |
| R2 documents | `sparkling-standard-e2e-documents-20261122155654` |
| R2 photos | `sparkling-standard-e2e-photos-20261122155654` |
| R2 ledger | `sparkling-standard-e2e-ledger-20261122155654` |
| Preview alias | `https://e2e-2026-11-22.sparkling-standard-cleaning.pages.dev` |
| Test Stripe webhook | `we_1UeiM5ArIaVXsguzjNpdt6rw` (test mode; deleted after the run) |
| Dedicated test calendar | `Sparkling Standard E2E 2026-11-22` (created and deleted; production calendar never written) |

The final Preview deployment after cleanup is `9e0000fe`. The E2E Preview is
read-only again; the token, allowlist and test webhook secret were removed.

## Residential Deep Cleaning — complete journey

Executed through the live Preview website with a real browser, real Preview
Functions, disposable D1/R2, test-mode Stripe and the dedicated test calendar.

| Step | Observed evidence |
|---|---|
| Public site and estimator | Preview homepage `200`; residential estimator completed |
| Address and travel | Google geocode; live route 16.4 mi / 22 min; verified quote |
| Price | Base $336.05, rounded down $1.05, total **$335.00** |
| Documentation gate | Pay Now returned `409 documents_required` and redirected to the signing page |
| Packet | `customer.deep` — Residential Deep / One-Time Packet |
| Signatures | 6 required documents signed; typed signature, consent version and content hashes recorded |
| Executed text | `signreq_51684389-0591-4cdd-800a-170609a48cce`; SHA-256 `17caf7e14998d44ab016c119f221bee52850d582c854337b9e7528d57ed3956e` |
| Resume after signing | “Continue to secure payment” appeared and reopened the exact checkout intent |
| Stripe | Test-mode Checkout Session created; card `4242 4242 4242 4242` paid |
| Payment intent | `pi_3UeirYArIaVXsguz0aWsOzmU`; payment row `payment_5298fdd0-9095-4976-9180-19af83d4fe6a`; **$335.00**, status `succeeded` |
| Webhook | `evt_1UeirZArIaVXsguzsY94yibO`; durable event status `notified` |
| Booking | `2027-01-04__6996b62e-498a-4b72-8c6e-751a556197c4`; status `confirmed`, `paid_confirmed` |
| Appointment | `appt_35ddce3f-2a70-4aec-a867-ff09ebcdf8bc`; confirmed; 2027-01-04 |
| Calendar | event `vsjt6kvg539a1ogi96njfioii8` created on the **dedicated test calendar**; `calendar_links` status `synced` |
| Customer/property | `cust_8111fc4b-6ab2-42ce-9550-9e3d04a1de8e` / `prop_0cc84877-2293-47f8-a9ae-bde8041b4465` |
| Customer portal | passwordless session verified with a disposable-D1 test token; booking, signed documents and executed copy visible (email magic-link delivery was not read) |
| Portal executed download | `200`; `X-Executed-SHA256` matched the signing record; signer text present |
| Cross-account document request | `404 document_not_found` |
| Duplicate webhook | same event returned `200 duplicate:true` twice; appointment count stayed 1, payment count stayed 1 |
| Tampered/missing webhook signature | `400 invalid_signature` |

## Move-In / Move-Out — complete journey

| Step | Observed evidence |
|---|---|
| Service | `move_in_out` selected through the public estimator |
| Packet | `customer.move_in_out` — Move-In / Move-Out Packet |
| Signing | required documents signed; executed text SHA-256 `3553c6776a8335c2f890ae00f95480442b2edf8118883f770b93e75827f0443a` |
| Stripe | test-mode Checkout paid with the standard test card |
| Booking | `2027-01-18__691c2b7e-5343-49d5-a161-6e3884b16885`; `confirmed`, `paid_confirmed` |
| Amount | **$255.00** |
| Appointment | `appt_49aa6618-1b05-4aa2-a8fa-33926799795e`; confirmed; 2027-01-18 afternoon window |

## Admin Document Composer

| Step | Observed evidence |
|---|---|
| Admin login | owner account in disposable D1; session and CSRF returned |
| Packet preview | `customer.move_in_out`; 8 documents, 5 required, **0 unresolved variables** |
| Draft | request `signreq_7a958556-d376-4424-bbcd-db4a9e24a240` created without sending email |
| Send | resend returned `emailSent: true` to the authorized internal test inbox |
| Signing | customer signed through the secure link; bound signer email enforced |
| Status | admin request view `signed`; customer ID matched `cust_8111fc4b-6ab2-42ce-9550-9e3d04a1de8e` |
| Executed copy | admin download `200`; `X-Executed-SHA256` `6df2faaeb842cf2307148c1646b3aa81be84039e8c23a3210f7ddf2ac5bd1076`; signer text present |
| Customer history | request appears under the customer’s signing-request list |

The live PDF preview pane is the existing admin composer; its rendering and
iframe behavior are covered by the browser suite. The underlying server preview
was exercised for every packet below with no unresolved variables.

## Service packet matrix — live Preview previews

All required variables resolved; no packet preview errored.

| Packet | Documents | Required |
|---|---:|---:|
| Residential Deep | 9 | 6 |
| Residential fallback | 9 | 6 |
| Recurring Residential | 11 | 7 |
| Move-In / Move-Out | 8 | 5 |
| Short-Term Rental | 8 | 5 |
| Commercial | 7 | 4 |
| Church / Facility | 7 | 4 |
| Property Management / Real Estate | 9 | 5 |
| Specialty / Add-Ons | 5 | 5 |

## Recurring pricing

Live Preview final summary showed **First Visit $335** (the required Deep
Cleaning) and **$255 — Biweekly Thereafter** as separate amounts. No recurring
subscription or recurring charge was created.

## Failure, tampering and recovery

| Case | Result |
|---|---|
| Missing signatures at checkout | `409 documents_required` with a signing redirect |
| Tampered submitted price | `400 quote_not_payable`, reason `mismatch` |
| Correct checkout after signing | `200` with a Stripe Checkout URL |
| Repeated checkout | same Stripe session URL returned (idempotent) |
| Abandoned Checkout | test session expired; webhook marked the checkout record `failed` |
| Expired booking hold | `400 booking_hold_expired` |
| Expired signing link | `404 signing_link_invalid` |
| Invalid signing link | `404 signing_link_invalid` |
| Customer cross-account document access | `404 document_not_found` |
| Unauthorized Preview mutation | `503 preview_read_only` |
| Production E2E bypass | rejected; production used its normal validation/auth paths |

## Defects found and fixed

1. **Signing resume capability was not forwarded.** The signing page loaded
   `token` only, so the server could never offer “Continue to secure payment”
   after signing. `src/scripts/document-sign.ts` now forwards `token`, `return`
   and `resume`. Browser regression test added.
2. **Stripe Customer resolution used the wrong key in Preview.** Checkout used
   the test secret while durable Stripe Customer resolution still read
   `STRIPE_SECRET_KEY`, causing `resource_missing field=customer`. The resolver
   now uses the same production/test selection and fails closed. Regression
   tests added.
3. **Webhook secret selection had no test-mode override.** The webhook now
   prefers `STRIPE_TEST_WEBHOOK_SECRET` outside production and never reuses a
   test secret in production. Regression tests added.

## Verification results

| Check | Result |
|---|---|
| `astro check` | **0 errors**, 0 warnings, 2 pre-existing hints |
| Full unit suite | **1,029 tests — 1,028 pass, 1 pre-existing skip, 0 fail** |
| Full browser suite | **249/249 pass** (one address-autocomplete timing flake passed 5/5 in isolation and 249/249 on the full rerun) |
| Build | **40 pages** |
| `npm run validate` | 2,558 internal links, SEO, QR, GTM and checklist checks pass |
| `npm run smoke` | 21 pages pass |

## Cleanup performed

- Removed the Preview E2E token and exact-host allowlist.
- Deleted the temporary test-mode Stripe webhook endpoint.
- Removed the Preview test-webhook signing secret.
- Expired the remaining open test-mode Checkout Sessions.
- Deleted the dedicated test Google Calendar.
- Redeployed a clean, signing-disabled, read-only Preview artifact.
- Re-verified that the E2E Preview and the control Preview both return
  `503 preview_read_only` for API calls.
- The isolated D1/R2 resources remain in place with synthetic test records;
  they are not connected to production. The Preview `GOOGLE_CALENDAR_ID` now
  points at the deleted test calendar, not the production calendar.

## Residual gaps and owner decisions

1. **Production import and signing activation** were not performed. The owner
   must authorize the approved-template import and packet activation, set the
   required customer-document enforcement stage to `before_payment`, and run
   one controlled production signing test.
2. **Per-booking document scope.** The approved staging data currently marks
   packet items `per_booking = 0`. A signed request can therefore satisfy a
   later booking for the same customer. Before production activation, the owner
   should decide which booking-specific agreements and schedules must be
   `per_booking = 1` so each new service receives its own executed schedule.
3. **Facility and non-estimator packets.** Commercial, church, property
   management and specialty packets were previewed with zero unresolved
   variables; their full payment/invoice workflows were not run end to end.
   Facility requests remain request/invoice workflows by design.
4. **Email delivery.** The webhook event reached `notified`, and the admin
   resend returned `emailSent: true` to an internal owner test address. Inbox
   delivery was not independently observed.
5. **Production release** is still a separate owner-authorized action: merge,
   production migration/import, signing activation, live-mode acceptance, and
   rollback planning.

No production deployment, production migration, live charge, customer message
or production calendar change was performed.

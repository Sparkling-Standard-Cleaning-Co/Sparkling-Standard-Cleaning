# Final Signing, Mobile and Notification Verification - Continuation
**Date:** 2026-11-23
**Branch:** `release/2026-11-22-legal-signing-acceptance`
**Production:** not deployed, no production migration applied, no commercial/facility activation.

## 1. Controlled email delivery verification

The production Communications Center has no stored override (`admin_settings` contained no
`communications.config` row), so the approved default routing was active. The tested addresses were
the actual configured business inboxes:

| Department | Recipient | HTTP | Recorded status | Resend message ID |
| --- | --- | --- | --- | --- |
| Bookings | `bookings@sparkling-standard.com` | 200 | sent (provider accepted) | `01a2062d-95da-7b27-8548-22043b2ad378` |
| Admin | `admin@sparkling-standard.com` | 200 | sent (provider accepted) | `01a2062d-97ac-72e5-9c65-98364488685f` |
| Owner | `owner@sparkling-standard.com` | 200 | sent (provider accepted) | `01a2062d-998c-7af6-b0f0-4758e73ece82` |
| Customer Service | `customer-service@sparkling-standard.com` | 200 | sent (provider accepted) | `01a2062d-9b2e-797e-97cc-d807d9e6e9f0` |

- All four messages were sent through the production Worker using the production Resend secret and
  the real Communications Center test action.
- Each attempt created a `notification_delivery_events` record with an empty `error_code`.
- No provider failure or missing routing was observed.
- **Bounce/delivered status is not available to the application**: there is no Resend webhook
  ingestion endpoint. Provider acceptance is not proof of inbox arrival. Owner confirmation in each
  destination mailbox remains required.
- A temporary owner session was used only to invoke the existing production test action. It was
  deleted immediately after the tests.

## 2. Migration 0052 validation

Validated against an exported copy of production D1, not production itself.

Production export before migration:

| Table | Rows |
| --- | ---: |
| customers | 11 |
| properties | 13 |
| signing_requests | 1 |
| document_signatures | 0 |
| document_templates | 27 |
| document_bundles | 16 |
| document_bundle_items | 83 |
| admin_users | 1 |

After applying `0052_signing_customer_fields.sql` to the isolated copy:

- Every row count was unchanged.
- `signing_requests.customer_fields_json` was added with default `'{}'` and `NOT NULL`.
- The existing signing request, its status, booking reference, executed copy and executed SHA-256
  were unchanged.
- The index `idx_signing_requests_customer_fields` was created.
- `PRAGMA integrity_check` returned `ok`.
- `PRAGMA foreign_key_check` returned no violations.
- The existing request could store a customer access schedule.
- The migration contains only `ALTER TABLE ... ADD COLUMN` and a `CREATE INDEX`; no `DROP`,
  `DELETE`, `TRUNCATE` or destructive statement.
- `tests/migration-0052.test.ts` repeats the check in CI with synthetic customers and signing
  history.

Production still does **not** have migration 0052. Do not apply it without deployment authorization.

## 3. Expanded mobile QA

New tests and actual defects fixed:

| Area | Result |
| --- | --- |
| Admin document center at 320/390/430px | Pass after fixing an inline-form select overflow in the Packets view. |
| Customer portal dashboard at 390px | Pass after importing `admin.css` (the page used admin classes without their styles) and wrapping long executed SHA-256 values. |
| Estimator at 320-430px and mobile wizard | Existing suite passes. |
| Checkout / Pay Now at mobile width | Existing suite passes. |
| Customer portal sign-in at 390px | Pass. |
| Employee portal at 390px | Existing suite passes with no horizontal overflow. |
| Admin manual booking / operational pages at 390px | Existing suite passes. |

Full browser suite: **257/257 pass**.

## 4. Single-signature E2E

`tests/document-signing-e2e.test.ts` exercises the actual public signing API, D1 schema and portal
document handler:

- Creates two required approved documents in a customer deep-cleaning packet.
- Submits one legal name and one typed signature to both documents.
- Submits interactive access values: customer present, parking instructions, pets, restricted area.
- Verifies the fields are persisted on the signing request.
- Verifies both documents are signed.
- Verifies the executed text contains the customer instruction schedule, access method, pet
  declaration and signature method.
- Verifies the executed PDF is generated, begins with `%PDF-`, and contains the customer schedule.
- Verifies the executed PDF is stored in the private bucket.
- Creates a customer portal session and verifies the executed document appears in the portal
  snapshot.
- Downloads the executed copy through `/api/portal/document` and verifies the SHA-256 header,
  schedule text and portal audit record.

## 5. Communications center administration

`tests/browser/admin-communications.test.mjs` now verifies:

- Routing checkboxes render and critical alerts remain fixed.
- Owner is never offered as a public reply-to.
- Template preview works.
- Delivery health and recent delivery records render.
- Adding Owner to booking confirmations saves the expected routing payload and change note.
- The controlled test-send action posts the selected department and reports provider acceptance.

## 6. Verification summary

| Check | Result |
| --- | --- |
| `npm test` | **1,046 tests: 1,045 pass, 1 pre-existing skip** |
| Browser suite | **257/257 pass** |
| `npm run check` | **0 errors** |
| `npm run build` | **40 pages** |
| `npm run validate` | passed |
| `npm run smoke` | 21 pages |
| Production email tests | 4 provider-accepted, 0 failures |
| Migration production-copy validation | passed, no data loss |
| Production migration | **not applied** |
| Production deployment | **not performed** |

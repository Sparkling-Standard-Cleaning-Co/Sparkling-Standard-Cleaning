# 2026-11-23 — Signing, pricing, and document editor corrections

**Status:** deployed to production 2026-11-23 in release commit `1b6efba`; Cloudflare Pages deployment `0566590a-f5a8-4d6f-abff-5a26c06783dd`. Migration `0053` is applied.
**Branch:** `production-safe`
**Base:** `fa559ce`
**Production:** unchanged at the start of this work (`fa559ce`, live runtime
`05a8e6c3-e9bd-45ae-ad33-42aa821cae6b`).

This pass addressed the owner's signing, pricing, email-testing, and document
editing directives. No live Resend message, Stripe charge, refund, customer
message, signing request, or customer-account change was created.

## 1. Resend test isolation

- `tests/helpers/no-live-email.mjs` installs a test-only fetch guard that fails
  closed on `https://api.resend.com/` unless `ALLOW_LIVE_RESEND_TESTS=1` is set
  deliberately for an owner-authorized test.
- `npm test` now preloads the guard with `node --import`.
- Browser tests intercept every `api/lead`, `api/document-sign`, and
  `api/estimate-checkout` call; no browser test sends a real message.
- All email-delivery unit tests use synthetic keys and stubbed provider
  responses. No test run in this pass consumed live email credit.

## 2. First customer signing record

Read-only investigation of the first production signing request (customer name,
email, and address intentionally omitted from this documentation):

- The signed request is `signreq_705f8075-7208-45f4-a60e-6a3bb91ac056`
  (`customer.move_in_out`, created 2026-11-23 13:24:10 UTC, executed
  2026-11-23T14:23:07.683Z).
- Eight signature rows exist, all accepted as signed. The audit record shows
  `documents.signed` with `8/5` (eight documents signed, five required).
- The executed copy is stored at
  `documents/executed/signreq_705f8075-7208-45f4-a60e-6a3bb91ac056.pdf`
  (116,743 bytes verified in the production `sparkling-standard-documents`
  bucket). The executed copy text and SHA-256 are retained in D1.
- A second request `signreq_91a536e0-2143-41c5-b548-cdd9e0551715` was created 18
  seconds later and remains pending; it appears to be an accidental duplicate
  send. It was not altered.
- **No payment was authorized or completed:** there are no `payments`,
  `payment_authorizations`, booking requests, appointments, or `agreements`
  rows for this customer.
- **The price was not saved:** the request's `customer_fields_json` contains
  only access/instructions. Its requirement snapshot and executed copy contain
  no service price. The admin composer's Price summary was not persisted in the
  old flow.
- The customer could download the executed PDF from the signing page. The owner
  notification attached the executed `.txt` copy. No customer executed-copy
  email existed in the old flow; future executions now send one after the PDF is
  stored (provider acceptance is recorded honestly; no delivery receipt is
  inferred).
- No historical record was changed or resent.

## 3. Persistent pricing snapshot

- Migration `0053_signing_pricing_snapshot.sql` adds
  `signing_requests.pricing_snapshot_json TEXT NOT NULL DEFAULT '{}'` and a
  supporting index. It is additive and has not been applied to production.
- `src/lib/documents/pricing-snapshot.ts` defines the server-owned snapshot:
  service, property, schedule, scope, add-ons, line items, base, travel,
  discount, tax, total, amount due now, remaining balance, payment terms, and
  the capture source.
- Checkout creates the snapshot from the same verified candidate that is sent to
  Stripe, **after** price-change acceptance and document-gate evaluation.
- Admin “Send for signature” now persists the Price summary, line items, tax,
  discount, scope, date, arrival window, and property address even when the
  approved template does not reference a price variable.
- The signing page's first Details & price step shows the complete snapshot.
- The executed copy and executed PDF include the same pricing section.
- The admin signing-request detail shows the signed price and line items.
- Legacy requests without a snapshot fall back to the stored booking record at
  read time; no historical record is rewritten.
- A reusable pending request receives a refreshed snapshot only when nothing has
  been signed yet.

## 4. Signature ceremony

- Every unsigned document shows a visible **X — Sign here** box (optional
  documents show **X — Sign this optional document**).
- The first click opens a large signature dialog with typed and drawn methods,
  Clear, Cancel, and Adopt Signature. Drawing supports mouse, touch, and stylus.
- Later signature boxes apply the adopted signature only when clicked, one
  document at a time. Each application records an `appliedAt` timestamp in the
  signature evidence.
- The page auto-scrolls to the next required signature and shows “N of M
  signatures applied” progress.
- Changing the adopted signature clears the previously applied boxes and
  requires explicit re-signing.
- Legal-name entry, consent, full document review, immutable signatures, and the
  audit trail remain intact.

## 5. Checkout and payment transition

- The post-signing three-option screen is gone for checkout flows. A completed
  signing page redirects directly to `/estimate/payment-resume/` with the
  signing capability attached.
- The payment page shows the signed total and itemization, the signed-PDF
  download, accurate customer-email status, and customer-portal access before
  the single Stripe action.
- A legacy resume link without a signing capability keeps the existing
  server-verification behavior.
- The malformed `Â€` presentation was traced to mojibake in
  `functions/api/estimate-checkout.ts` and `src/scripts/facility-estimate.ts`.
  The affected strings were repaired to UTF-8 em dashes, en dashes, ellipses,
  curly quotes, minus signs, multiplication signs, and arrows. US-dollar
  formatting uses the shared two-decimal formatter.

## 6. Mini Word-style document editor

- The numbered text-block editor was replaced by a visual contenteditable
  canvas with:
  - Undo/redo, paragraph style (title/heading/normal), font family, font size,
    text colour, bold, italic, underline.
  - Left/center/right alignment, bulleted and numbered lists.
  - Basic tables, page breaks, dynamic-field insertion, signature-line
    placement, optional header/footer text.
  - Live preview, print/PDF, draft saving, compare, approve and publish.
- The page preview, signing reader, and executed PDF render the stored rich HTML
  subset (headings, paragraphs, lists, tables, alignment, colour, size, bold,
  italic, underline, page breaks). The executed PDF uses built-in Helvetica and
  Times fonts, so no new dependency or external renderer is required.
- Rich HTML is sanitized server-side with an allowlist; scripts, event handlers,
  links, images, iframes, forms, and external URLs are removed.
- Legacy Markdown templates remain readable and editable.

## 7. Document creation and version presentation

- “Create a Document” opens the visual editor; “Upload an Approved PDF” is the
  simple upload/metadata path. Family keys, versions, and technical identifiers
  are generated automatically.
- Admin version presentation uses **Version 1.0**, **Version 1.1**, and so on,
  derived from each document family's history. Internal versions and hashes
  remain unchanged for audit and signature evidence.
- Versions & Updates shows the previous/current friendly versions, signed
  customer counts, re-signing need, material versus formatting-only
  acknowledgement, and a plain-English change description entered by the owner.
- Technical identifiers, remediation/customer-release terms, SHA labels, and
  hashes were removed from owner-facing document presentation.

## 8. Verification completed

- `npm run check`: 0 errors.
- `npm run build`: 40 pages.
- Unit suite: **1,064 tests — 1,063 pass, 1 pre-existing skip, 0 fail**.
  Includes new `document-pricing`, `migration-0053`, rich-text sanitizer, rich
  PDF, version-label, and signature-evidence coverage.
- Browser suite: **258/258 pass**. Includes updated signing UX,
  resume/payment-transition, visual editor, document updates, and packet-builder
  coverage.
- `npm run validate`: 2,567 internal links across 40 pages resolve; SEO,
  marketing/QR, GTM artifacts, and checklist leak checks pass.
- `npm run smoke`: 21 pages pass.
- No live Resend email, Stripe charge/refund, customer message, or production
  data change was performed. No commit, push, migration, merge, or deployment
  was performed.

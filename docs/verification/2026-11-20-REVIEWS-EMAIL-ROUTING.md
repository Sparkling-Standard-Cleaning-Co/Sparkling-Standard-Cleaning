# Reviews carousel and department email routing - 2026-11-20

## Starting point

- Starting HEAD: `6655fb8`.
- Prior application code: `397be7b`.
- Tampa OFF visibility, document library, branch origins and homepage positioning were preserved.

## Reviews carousel

The previous fixed-height/internal-scroll treatment was removed.

- Each review card now shows a readable, server-generated excerpt of the authentic review text.
- Excerpts never create an internal scrollbar.
- All cards have a visible **Read full review** action.
- The full, unmodified review is stored separately and opened in the accessible dialog.
- Reviewer attribution and the existing genuine photographs remain.
- Cards share a consistent height; photographs are constrained inside the card.
- Neighbouring cards no longer sit under the featured card; there is a measured gap and no text overlap.
- Keyboard, swipe, dots, previous/next, reduced motion and no-JavaScript behavior remain.

Visual evidence:

- `docs/verification/2026-11-20-reviews/desktop-1440.png`
- `desktop-1280-long.png`
- `tablet-1024.png`
- `tablet-768.png`
- `mobile-390.png`
- `mobile-360.png`
- `desktop-photos.png`
- `mobile-390-full-review.png`

Checked at 1440, 1280, 1024, 768, 390 and 360 px. Long, short and photo reviews were exercised. No first-line clipping, internal scroller or photo overflow remained.

## Email routing

Approved department addresses:

| Purpose | Address |
| --- | --- |
| Public customer service | `customer-service@sparkling-standard.com` |
| Billing, invoices and receipts | `billing@sparkling-standard.com` |
| Hiring | `hiring@sparkling-standard.com` |
| Internal administration | `admin@sparkling-standard.com` |
| Owner, financial/security and critical alerts | `owner@sparkling-standard.com` |

Implemented:

- Central `src/config/email-routing.ts`.
- Public website email changed to customer service.
- Customer confirmation reply-to remains customer service.
- Invoice and receipt reply-to defaults changed to billing.
- Invoice PDF contact block uses billing.
- Gift certificate customer contact uses customer service.
- Owner notifications remain owner-only.
- Public careers page at `/careers/` and footer Careers link use the hiring address with an honest no-ATS workflow.
- Billing reply-to can be overridden with `RESEND_BILLING_REPLY_TO`.

DNS observed:

- Google Workspace MX.
- SPF includes `_spf.google.com`.
- Google DKIM selector present.
- DMARC `p=none` with aggregate reporting.
- A Resend DKIM selector was not found at the common selector.

Not verified from this environment:

- Mailbox existence, aliases or Google Group membership.
- Send-as permission for the new addresses.
- Resend domain verification.
- Stripe automatic receipt/email dashboard settings.
- A customer self-service billing portal.

## Stripe and billing safety

- No payment, invoice, promotion, recurring, refund or Stripe configuration was changed.
- The application already creates branded receipts and invoice emails; Stripe automatic receipts may duplicate them depending on dashboard settings. The owner must verify and disable the duplicate source intentionally.
- Payment-security and critical financial failures continue to use owner notifications.
- Immutable payment records and audit history were not modified.

## Tests

- Unit: 944 tests, 943 pass, 1 pre-existing skip.
- Browser: 233 pass.
- Build: 38 pages.
- Validation and fact audit: pass.
- No live charge, customer message, applicant message or data deletion.

## Deployment

Recorded after release:

- Application commit, Cloudflare Pages deployment ID and live email/reviews verification.

## Remaining work

- Google Workspace mailbox/send-as verification and internal test mail.
- Stripe dashboard receipt/email audit and customer portal decision.
- Tampa estimator/booking/payments/scheduling.
- Backup key independence, OneDrive cloud retrieval and default-branch backup automation.
- Data Control Center and full admin pagination.
- Owner-approved document templates and packet contents.
- Dispatch profile completion and activation.

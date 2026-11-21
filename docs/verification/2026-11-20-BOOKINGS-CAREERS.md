# Bookings department and secure careers applications - 2026-11-20

## Baseline

- Starting HEAD: `a43eb58`; application code `061e167`.
- Reviews carousel, customer-service/billing/hiring/admin/owner routing, careers page, Tampa OFF gate and document library were preserved.
- Migration `0043_career_applications.sql` applied to production D1: 4 commands.

## Department routing

Added `bookings@sparkling-standard.com` as the sixth departmental address.

| Purpose | Address |
| --- | --- |
| Booking request, confirmation, reminders, rescheduling, cancellations, recurring scheduling | `bookings@sparkling-standard.com` |
| Billing, invoices, receipts, payment/refund correspondence | `billing@sparkling-standard.com` |
| Public contact, general inquiries, complaints, re-cleans | `customer-service@sparkling-standard.com` |
| Careers, applications, resumes, interviews | `hiring@sparkling-standard.com` |
| Administrative/vendor/routine operations | `admin@sparkling-standard.com` |
| Owner, security and critical system alerts | `owner@sparkling-standard.com` |

Booking confirmation and scheduling email now reply to bookings. Customer-service and public contact remain separate. Invoice and receipt reply-to remain billing. Owner notifications remain owner-only.

## Careers application workflow

Implemented:

- Public `/careers/` application form supporting experienced and entry-level applicants.
- Name, email, phone, experience level, desired role, preferred branch, availability, transportation and driver-license questions.
- Optional private PDF/DOCX resume upload, maximum 5 MB.
- Server-side PDF/DOCX magic-byte validation and safe filenames.
- Private resume storage in `DOCUMENTS_BUCKET`, falling back to the private `PHOTOS_BUCKET` when necessary.
- Application record in D1 with applicant status.
- Applicant acknowledgment email.
- Hiring-team notification email with applicant details; resume remains in private storage.
- Public status lookup by application reference plus the email used.
- Owner-only admin Careers view with private applicant detail, resume download, status and notes.
- Rate limits for application submissions and status lookups.
- No ATS, invented hiring manager or Tampa active-hiring advertisement.

Statuses: `new`, `reviewing`, `interview`, `offer`, `declined`, `archived`.

Tampa is labeled **future interest only** in the form; it does not appear as an active Tampa hiring campaign.

## Email / DNS verification

Observed:

- Google Workspace MX.
- SPF: `v=spf1 include:_spf.google.com ~all`.
- Google DKIM selector present.
- DMARC `p=none` with aggregate reporting.
- Public pages expose customer-service; careers and footer link to hiring through Cloudflare email protection.

Not verified from this environment:

- Existence or send-as permission for `bookings@`, `billing@`, `customer-service@`, `hiring@` or `admin@`.
- Resend domain verification and delivery.
- Stripe automatic receipt/email settings.
- Customer self-service billing portal.

Stripe and application receipts may duplicate until the owner resolves the dashboard receipt setting. No Stripe configuration was changed.

## Tests

- Unit: 947 tests, 946 pass, 1 pre-existing skip.
- Browser: 237 pass.
- Build: 38 pages.
- Validation and fact audit: pass.
- No live customer email, applicant email, charge, refund, customer appointment change or data deletion.

## Deployment

Recorded after release:

- Application commit and Cloudflare Pages deployment ID.
- Live careers form presence and private admin route checks.

## Remaining

- Owner Google Workspace mailbox/send-as verification.
- Resend delivery and bounce handling.
- Stripe receipt/email deduplication and portal decision.
- Tampa full booking infrastructure.
- Backup key independence, OneDrive retrieval and backup automation.
- Document packet population and approved signing policy.
- Data Control Center, full pagination and dispatch activation.

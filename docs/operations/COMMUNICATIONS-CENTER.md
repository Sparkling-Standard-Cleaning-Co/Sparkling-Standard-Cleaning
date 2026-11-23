# Communications & Notifications Control Center

The owner controls operational notification routing, approved message wording
and permitted overrides in **Admin -> Communications & Notifications**.
Critical security and backup alerts are non-overridable: they always include
`admin@sparkling-standard.com` and `owner@sparkling-standard.com`.

## Approved department addresses

These are fixed architecture. The interface may not change them.

| Department | Address |
|---|---|
| Bookings | `bookings@sparkling-standard.com` |
| Customer Service | `customer-service@sparkling-standard.com` |
| Billing | `billing@sparkling-standard.com` |
| Hiring | `hiring@sparkling-standard.com` |
| Admin | `admin@sparkling-standard.com` |
| Owner | `owner@sparkling-standard.com` |

`owner@` is never offered as a public reply-to address.

## What the owner can change

- Which department receives each operational notice.
- The reply-to department for booking confirmations, invoices, receipts,
  careers and general customer service.
- Subject and body of approved notification templates using only the listed
  variables.
- Alert escalation minutes (5-1440) and failure threshold (1-100).

Every save:

1. Validates addresses, routing, critical-alert requirements, reply-to rules
   and template variables.
2. Stores the active configuration in `admin_settings`.
3. Writes an immutable snapshot to `communication_settings_versions`.
4. Writes an admin audit event.

Invalid stored configuration falls back to approved defaults and is reported in
the interface; it never silently sends to an unexpected address.

## Delivery honesty

The interface distinguishes:

- **Provider accepted** — Resend returned a successful API response.
- **Suppressed** — Resend is not configured; nothing was sent.
- **Failed** — the provider or network rejected the request.

None of these proves inbox delivery. The owner must confirm receipt in the
destination mailbox. `deliveryHealth()` also reports failed lead notifications,
booking notifications and payment receipts from their canonical tables.

## Controlled test message

The owner may send one clearly marked `[TEST]` email to one department. The
button requires explicit confirmation, sends no customer data, records a
delivery event and writes an audit record. Do not use it without access to the
destination mailbox.

## Connected senders

The configured routing/reply-to values are consumed by:

- **Website leads and reservation requests** (`functions/api/lead.ts`) — a
  booking/reservation uses `booking_request` (default: Bookings); a contact
  message uses `contact_inquiry` (default: Customer Service). Photo
  attachments are sent to every configured recipient; Web3Forms remains the
  fallback when Resend fails.
- **Booking confirmations, changes, declines and cancellations**
  (`functions/api/admin/requests.ts`) — `booking_confirmation` or
  `booking_change` (default: Bookings), while the customer receives the
  branded booking email.
- **Paid estimates and gift sales** (`functions/api/stripe-webhook.ts`) —
  `booking_paid`, `payment_received` or `payment_failed` (defaults: Bookings,
  Billing, Admin as applicable). Web3Forms remains a secondary owner channel.
- **Careers** acknowledgment and hiring notification (`functions/api/careers-application.ts`)
- **Invoice email** (`functions/api/admin/finance.ts`)
- **Payment receipt copy** (`src/lib/invoicing/invoice-receipt.ts`) — Stripe
  remains the official receipt source; the application copy is idempotent
- **Gift certificate delivery** (`functions/api/stripe-webhook.ts`)
- **Customer portal sign-in and customer-service requests**
  (`src/lib/portal/service.ts`)
- **Document signing request, executed agreement and revision review**
  (`functions/api/admin/documents.ts`,
  `src/lib/documents/notifications.ts`) — `document_signing_request` (default:
  Bookings and Admin), `document_executed` and `document_revision` (default:
  Admin and Owner). The secure signing token is not sent in an internal notice.

Critical security and backup alerts always include both Admin and Owner. Other
events route only to the departments the owner selected; a disabled department
is never silently replaced by the owner address. If no operational inbox is
enabled, the lead path falls back to the configured owner notification address
so a real customer inquiry is not lost.

## Operational delivery records

`sendOperationalNotification()` in `src/lib/admin/communications.ts` resolves the
enabled department addresses for an event, sends once per recipient with a
recipient-specific idempotency key, and records each outcome in
`notification_delivery_events`. The record is status evidence (provider
accepted, failed, or suppressed), not proof of inbox delivery.

## Relevant files


- `migrations/0044_communications.sql`
- `src/lib/admin/communications.ts`
- `functions/api/admin/communications.ts`
- `src/pages/admin/index.astro` and `src/scripts/admin.ts`
- `tests/communications.test.ts`

## Backup and security alerts

`src/lib/admin/backup-monitor.ts`, `functions/api/internal/backup-status.ts`
and `workers/backup-monitor/` evaluate backup heartbeats. A failed or missing
backup opens one critical incident, alerts admin and owner, and escalates an
unresolved incident to the owner after the configured interval. A later
successful run resolves the incident and sends a recovery notice.

The monitor proves notifications, not backup restorability. Independent restore
rehearsal remains mandatory (`docs/operations/OFFSITE-BACKUPS.md`).

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

## Relevant files

- `migrations/0044_communications.sql`
- `src/lib/admin/communications.ts`
- `functions/api/admin/communications.ts`
- `src/pages/admin/index.astro` and `src/scripts/admin.ts`
- `functions/api/careers-application.ts` (uses configured hiring routing)
- `tests/communications.test.ts`

## Backup and security alerts

`src/lib/admin/backup-monitor.ts`, `functions/api/internal/backup-status.ts`
and `workers/backup-monitor/` evaluate backup heartbeats. A failed or missing
backup opens one critical incident, alerts admin and owner, and escalates an
unresolved incident to the owner after the configured interval. A later
successful run resolves the incident and sends a recovery notice.

The monitor proves notifications, not backup restorability. Independent restore
rehearsal remains mandatory (`docs/operations/OFFSITE-BACKUPS.md`).

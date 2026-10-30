# Admin and customer-data foundation

**Status:** implemented and verified locally; **not provisioned or activated in production**.

**Scope:** Sparkling Standard Cleaning Co. only. Pensacola is the active branch; a future Tampa Bay
branch belongs to the same cleaning business. Multi-business, holding-company, unrelated-industry and
cross-company infrastructure is explicitly out of scope.

## Database

- `migrations/0001_operational_foundation.sql` defines 44 cleaning-company tables: branches,
  administrators, sessions/audit, customers, contacts, properties, leads, estimates, recurring plans,
  booking requests/holds, appointments, resources, calendar links, job checklists/media,
  invoices/payments/refunds/credits, saved payment methods/consents, gift certificates/transactions,
  agreements, communications, outbox events and reconciliation. All money is stored as integer cents.
- `0002` adds durable rate limits, lead idempotency and the Pensacola/Tampa branch and role seeds.
- `0003` adds session revocation and MFA fields.
- `0004` adds branch scope to booking requests and gift certificates.
- `0005` adds MFA challenges/recovery codes, administrator invitations/password resets, settings and
  durable lead-delivery attempt/error fields.
- `0006` seeds the service catalog and the canonical `lead.write` permission.
- `0007` removes customer-profile access from the cleaner role; cleaners receive job and booking
  access only.
- `wrangler.local.toml` is committed for local-only D1 work. It contains no production ID or secret.

## Implemented administration

### Authentication and accounts

- Owner-only first-run enrollment with a server-side setup code and constant-time comparison.
- PBKDF2-SHA-256 passwords, D1 sessions with hashed tokens, expiry, revocation, CSRF and durable
  IP/identity rate limits.
- TOTP MFA enrollment, challenge-based login, one-time recovery codes and MFA audit records. Secrets
  are server-side only and never returned after enrollment.
- Owner-issued, single-use administrator invitation links; invite acceptance creates the canonical
  `manager`, `finance` or `cleaner` role with optional branch scope.
- Owner-issued, single-use password-reset links that revoke all existing sessions when completed.
- Administrator enable/disable, session revocation, last-owner protection, audit history and
  permission-aware navigation.
- Server-side permissions remain authoritative. Hiding a UI control is never treated as security.

### Customers and leads

- Customer search, filters, profiles, multiple properties, notes, contact updates, estimate history,
  booking history and invoice history.
- Private customer notes are withheld from finance and cleaner roles; cleaners no longer receive
  customer CRM access.
- Lead inbox with status, search, payload inspection, delivery status/attempts, and retry of a failed
  owner notification through the existing Web3Forms path.
- When `DB` is bound, `/api/lead` now fails the submission before notification if durable persistence
  fails. Without `DB`, the existing notification path remains the fallback until production D1 is
  provisioned.
- Reservation submissions are mirrored into D1 booking requests/holds idempotently.

### Scheduling and operations

- Reservation confirmation/decline and appointment status visibility.
- D1 scheduling conflict checks and team-member overlap prevention.
- Recurring-plan creation/status/pricing with next-visit dates.
- Team-member records, job assignment and crew-size reconciliation.
- Job status tracking and a standard residential checklist with item completion/history.

### Finance

- Invoice creation with integer-cent lines, totals, balances and status.
- Manual cash/check/external payment recording with durable idempotency keys.
- Manual refund records and customer credits/credit applications data.
- Branch-scoped financial summary, balances and reporting.
- **Not enabled:** new live card charging, invoice payment links, saved-card enrollment, off-session
  charging or Stripe refund execution. Those require explicit owner authorization and live testing.

### Gifts, reports and settings

- Unified gift-certificate summary and certificate list read directly from the existing private R2
  gift ledger; existing `/gift-admin/` remains authoritative for redemption, refund and void.
- Reports for customers, leads, jobs, recurring plans, invoices, collected payments, payment mix,
  monthly revenue and gift activity.
- scripts/admin/reconcile-r2-ledgers.mjs converts exported R2 gift and booking-request JSON into
  reviewable, idempotent D1 SQL. It never connects to production and does not include payment-ledger
  or customer backfill.
- Administrative settings API, owner/administrator records, sessions and audit viewer.

## Security boundaries

- Every `/api/admin/*` endpoint derives the actor server-side and enforces permissions; branch scope
  is applied to customer, lead, booking, job, invoice, payment and gift reads.
- `/admin/*` and `/api/admin/*` are `no-store`, noindex and excluded from the sitemap.
- The admin page carries `noindex, nofollow`; validation checks the built page and headers.
- No production D1, R2 reconciliation cutover, customer backfill or live financial action has been
  performed.
- Existing R2 ledgers, Stripe, Google Calendar, booking, gift and customer confirmation systems remain
  in place and are not deleted or rewritten.

## Local development

```powershell
npx wrangler d1 migrations apply sparkling-standard-local --local --config wrangler.local.toml
npm run build
Copy-Item wrangler.local.toml wrangler.toml
npx wrangler pages dev dist --port 8790 --binding ADMIN_SETUP_CODE=<local-setup-code>
Remove-Item wrangler.toml
```

`wrangler pages dev` reads only `wrangler.toml`; remove the temporary copy afterward. Local state lives
in the git-ignored `.wrangler/` directory. Never commit `.wrangler/`, a runtime database or exported
customer data.

## Verified locally

- **13 focused admin tests** cover migrations, schema/FK integrity, enrollment, login, sessions,
  expiry, CSRF, MFA challenge/recovery, invitations, password reset, RBAC, branch isolation, customer
  CRUD, properties, notes, lead persistence, delivery retry, scheduling conflicts, crew assignment,
  checklists, invoice/payment/refund/credit reconciliation and payment idempotency.
- Full unit suite: **687 tests, 686 passed, 1 pre-existing print-output skip, 0 failed**.
- Browser regression: **171 passed, 0 failed**.
- `npm run check`: 0 diagnostics. Build, validation and smoke pass.
- Desktop and 390 px mobile admin screenshots verified; no page overflow and role-aware controls.
- Local D1 export restored **52 tables, 7 migrations and 2 synthetic administrators** into a clean
  SQLite database with no foreign-key violations.

## Not implemented / not activated

- TOTP encrypted-at-rest key management; secrets live in the private D1 database.
- Email delivery of invitation/reset links; the owner copies the one-time private link.
- Unified gift adjustments; the existing authorized gift register remains separate.
- Historical R2-to-D1 customer/lead/payment backfill and financial reconciliation of Stripe/R2
  checkouts. Gift and booking-request exports can already be converted with the safe SQL generator.
- Live invoice payment links, saved-card enrollment, off-session charging and Stripe refunds.
- Production D1 provisioning, `DB` binding, staging migration, customer backfill and cutover.
- Production Google Calendar synchronization for newly unified D1 confirmations; the existing
  `/api/booking-admin` flow remains authoritative.
- Operational settings screens beyond the owner/security/audit surface.
- Independent production backup/restore drill and Cloudflare Time Travel verification.

## Next safe steps

1. Extend the R2 converter to payment/customer reconciliation after exported ledger mapping is
   approved; keep production writes owner-gated.
2. Add production staging D1 only after owner approval; apply migrations and shadow-write before
   cutover.
3. Integrate D1 confirmations with the existing Google Calendar/resource engine before treating D1
   appointments as operationally authoritative.
4. Add owner-authorized Stripe invoice/payment-link and saved-card workflows with full consent and
   idempotency tests; do not enable live charging without approval.
5. Run independent production exports and a verified restore drill.

# Admin and customer-data foundation

**Status:** local D1 foundation and first secure admin slice implemented; **not provisioned or
activated in production**.

**Scope:** Sparkling Standard Cleaning Co. only. Pensacola is the active branch; a future Tampa Bay
branch belongs to the same cleaning business. Multi-business, holding-company, unrelated-industry and
cross-company infrastructure is explicitly out of scope.

## What exists

- `migrations/0001_operational_foundation.sql` defines 44 cleaning-company tables: branches,
  administrator roles/sessions/audit, customers, contacts, properties, leads, estimates, recurring
  plans, booking requests/holds, appointments, resources, calendar links, job checklists/media,
  invoices/payments/refunds/credits, saved payment-method references and consents, gift
  certificates/transactions, agreements, communications, outbox events and reconciliation. All money
  is stored as integer cents.
- `migrations/0002_admin_security_and_seeds.sql` adds durable login rate limits, lead idempotency,
  the two same-business branches and the owner/manager/finance/cleaner role vocabulary.
- `migrations/0003_admin_session_hardening.sql` adds session expiry/revocation metadata and the MFA
  flag. MFA enrollment and verification are **not implemented yet**.
- `migrations/0004_branch_scope.sql` adds branch scope to booking requests and gift certificates.
- `wrangler.local.toml` is committed for local-only D1 work. It contains no production ID and no
  secrets.
- `/admin/` is an internal, noindex page. It is not linked from public navigation and is excluded
  from the sitemap.
- `/api/admin/auth`, `/api/admin/overview`, `/api/admin/customers`, `/api/admin/leads` and
  `/api/admin/requests` provide the first protected admin slice. Every endpoint derives its actor
  server-side from a D1 session and enforces the canonical permission vocabulary.
- `src/lib/admin/lead-persistence.ts` is wired into `/api/lead` as a best-effort durable write after
  the existing Web3Forms/Resend delivery path. A D1 outage never blocks the customer request.

## Local development

```powershell
npx wrangler d1 migrations apply sparkling-standard-local --local --config wrangler.local.toml
npm run build
npx wrangler pages dev dist --port 8790 --binding ADMIN_SETUP_CODE=<local-setup-code>
```

`wrangler.local.toml` deliberately uses the placeholder UUID
`00000000-0000-0000-0000-000000000000`; keep it. Local state lives under the git-ignored
`.wrangler/` directory. Never commit `.wrangler/`, a runtime database or exported customer data.

A D1 export/restore cycle was verified locally:

```powershell
npx wrangler d1 export sparkling-standard-local --local --config wrangler.local.toml --output backup.sql
```

The export restored 47 tables, both branches and the local owner account into a clean SQLite
database. Production backups must use Cloudflare Time Travel plus independent exports before relying
on D1.

## Security controls implemented

- PBKDF2-SHA-256 password hashing with per-user salt and timing-safe comparison.
- D1-backed sessions with hashed tokens, expiry, revocation fields and CSPRNG CSRF tokens.
- CSRF required for state-changing requests.
- Owner-only first-run enrollment; enrollment fails closed once an owner exists.
- Durable rate limits for login/setup, enforced per IP and per identity.
- Constant-time setup-code comparison; first-run enrollment fails closed after one owner.
- Server-derived actor, role and branch scope; permissions fail closed.
- Route-level API protection independent of hidden UI.
- No public analytics, no customer data in logs and no credentials in the repository.
- Admin page carries `noindex, nofollow`; the SEO validator enforces it and the sitemap excludes it.
- `/admin/*` and `/api/admin/*` are `no-store`; the validator rejects malformed or missing header
  sections.
- Responsive shell verified at 390 px and 1440 px: compact three-column mobile navigation, visible
  sign-out, and tables that scroll inside their card instead of widening the page.

## Local verification

- Seven focused admin tests cover migrations, schema integrity, owner enrollment, login, sessions,
  expiry, CSRF, RBAC, branch isolation, lead persistence/idempotency, setup-code rejection and
  durable rate limiting.
- `npm run check` reports 0 diagnostics; the full unit and browser suites pass.
- A local D1 export restored 47 tables, both branches and the owner account into a clean SQLite
  database.

## Current admin capabilities

- Owner login/logout and honest database-unavailable state.
- KPI overview derived from D1.
- Customer search, contact/property and lead/estimate context.
- Booking-request queue with branch filtering.
- Audit log records for enrollment, login, logout and failed logins.
- Responsive desktop/mobile layout verified against the local Wrangler runtime.

## Not implemented / not activated

- MFA enrollment and second-factor verification.
- Invitations, password recovery and a session-revocation UI.
- Recurring plans, jobs/team/checklists, invoices/payments/refunds, reports, settings and audit
  viewer screens.
- Embedded gift-certificate administration; `/admin/` links to the existing `/gift-admin/` for now.
- Migration of the legacy gift-admin session/cookie to the unified admin session.
- Production D1 provisioning, `DB` binding, production migrations and any customer/lead backfill.
- Durable lead persistence tests against the real Pages Function runtime (the D1 module and
  idempotency behavior are unit-tested).
- Independent production backup/restore drill.

## Next safe steps

1. Add MFA/step-up, invitations, password recovery, session revocation and admin tests at the API
   boundary.
2. Rerun `npm run check`, `npm test`, `npm run test:browser`, `npm run verify` and `npm run smoke`.
3. Provision D1 only after owner approval (free tier first), then apply migrations to a staging
   database and add the production `DB` binding.
4. Shadow-write and reconcile leads, estimates, bookings, payments and gifts before cutover.
5. Configure independent exports and a verified restore test before relying on D1.
6. Never delete the existing R2 ledgers; keep the current delivery and checkout systems
   authoritative until reconciliation is complete.

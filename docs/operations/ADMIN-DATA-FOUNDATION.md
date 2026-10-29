# Admin and customer-data foundation

**Status:** schema foundation added; **not provisioned, activated, migrated or exposed**.

The unified `/admin` application is not implemented yet. This document records the safe foundation
that exists so the next milestone can proceed without guessing.

## What exists

- `migrations/0001_operational_foundation.sql` defines the relational entities for branches,
  administrator roles/sessions/audit, customers, contacts, properties, leads, estimates, recurring
  plans, booking requests/holds, appointments, resources, calendar links, job checklists/media,
  invoices/payments/refunds/credits, saved payment-method references and consents, gift
  certificates/transactions, agreements, communications, outbox events and reconciliation.
- `wrangler.toml.example` documents the optional `DB` D1 binding. Nothing is bound in production.
- The schema was executed against an in-memory SQLite database to verify syntax and foreign-key
  declarations. No production database exists.

## What does not exist

- No D1 database has been provisioned.
- No migration has been applied to production.
- No `/admin` pages or admin APIs exist.
- No customer/lead backfill has been performed.
- No saved-card enrollment, invoice administration and payment-link flow has been activated.
- The schema is not yet wired to checkout, booking, gift or lead writes.

## Next safe steps

1. Provision a D1 database only after owner approval (free tier first).
2. Apply the migration locally and in a staging database.
3. Add the `DB` binding in Cloudflare Pages.
4. Build the admin auth/role layer using the existing session primitives.
5. Add shadow writes for leads, estimates, bookings, payments and gifts; reconcile before cutover.
6. Never delete the existing R2 ledgers.
7. Configure independent exports and a verified restore test before relying on D1.

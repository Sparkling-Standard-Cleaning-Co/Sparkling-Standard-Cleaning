# Admin usability and record-management review

**Last reviewed:** 2026-11-19  
**Scope:** All admin sections in `/admin/`

## 1. Implemented improvements

### Overview

- Today's jobs, tomorrow's appointments, pending requests, unassigned jobs, open
  leads, unsigned agreements, outstanding invoices and failed communications are
  now the first dashboard facts.
- New alert entries link directly to unsigned agreements, outstanding invoices
  and unassigned jobs.
- Day boundaries are calculated in the business time zone (America/Chicago), not
  the server's UTC day.

### Customer profile

The unified customer workspace now shows:

- contact details and status;
- properties with editable facts and archive status;
- leads/requests, estimates, appointments and recurring plans;
- Quick Estimates with conversion references;
- invoices and balances;
- gift certificates received or purchased, with remaining balance;
- signing requests and packet names;
- payment authorizations, notes and discounts/benefits.

### Quick Estimate

- New navigation entry and full workflow. See `docs/operations/QUICK-ESTIMATE.md`.

### Documents and agreements

- Template lifecycle: edit draft, duplicate, approve, retire, restore, download,
  audit history.
- Packet lifecycle: create with purpose/type/instructions, duplicate, archive,
  restore, reorder, preview and send.
- Variable resolution preview with fail-closed sending.

### Financial reporting

The Reports section now separates:

- open quoted estimates (not revenue);
- invoiced work (not cash);
- collected payments;
- outstanding balances;
- discounts;
- refunds;
- net collected;
- recurring monthly value.

It never labels quoted or invoiced work as collected cash.

### Record management

- Customers: archive, restore and guarded permanent delete when no history blocks
  it (existing).
- Properties: edit and archive/active status in the customer workspace.
- Quick Estimates: draft/saved/converted/discarded states; discard never hard
  deletes.
- Templates: retire and restore; executed documents remain immutable.
- Packets: archive and restore; document history retained.
- Promotions: duplicate, activate/deactivate and edit (existing).
- Invoices and payments: financial records are never hard-deleted.

### Quick Estimate and workspace tests

- `tests/quick-estimate.test.ts`
- `tests/browser/admin-quick-estimate.test.mjs`
- `tests/acceptance.test.ts`

## 2. Remaining optional improvements (ranked by business impact)

1. **Invoice aging report** with 30/60/90-day buckets and a one-click reminder
   email. The data exists; the UI does not yet summarize aging.
2. **Bulk customer import** from CSV with duplicate detection. High impact only
   when migrating a large outside book of business.
3. **Calendar drag-and-drop rescheduling.** Current rescheduling is correct but
   form-based.
4. **Mobile field view for the owner** showing today's route, access notes,
   customer phone and job checklist in one screen.
5. **Global admin search** across customers, invoices, bookings and documents.
   Current search is per section.
6. **Saved report presets** (this month, last month, custom range) instead of
   fixed queries.
7. **Attachment preview inside the customer workspace** for signed documents and
   receipts, instead of separate download links.
8. **Configurable dashboard layout** if the owner wants a different priority
   order.

These are not required for the core business workflow and were not added in this
release to avoid unnecessary complexity.

## 3. Accessibility and responsive behavior

- Every new field has a visible label.
- Buttons are keyboard reachable and use existing focus styles.
- Status and error messages use `role="status"` or `role="alert"`.
- The Quick Estimate form uses the existing responsive admin grid and collapses
  to a single column on phones.
- Browser verification covers a desktop viewport. Physical-device testing was
  not performed in this release.

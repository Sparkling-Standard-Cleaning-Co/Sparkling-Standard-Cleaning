# Admin Quick Estimate

**Admin:** `/admin/` -> **Quick Estimate**  
**Last verified:** 2026-11-19  
**Migration:** `0039_quick_estimates.sql`

## 1. Purpose

Quick Estimate lets the owner price a phone or walk-in inquiry without creating
a customer, property, booking, hold, invoice, payment or calendar event first.

It uses the exact same server-side pricing path as a manual booking:
- published pricing configuration;
- residential, STR, commercial and church engines;
- travel economics and destination resolution;
- Community Support eligibility;
- database promotions and the FRIENDS15 account benefit;
- add-ons and bundles;
- tax and prior-service rules are **not** estimated here (tax is calculated at
  checkout from the confirmed service address).

No formula is duplicated. `priceEstimateInput()` in
`src/lib/admin/manual-booking.ts` is shared by Quick Estimate and manual booking.

## 2. What the owner can do

1. Enter a service address and ZIP (required for travel) or use a saved customer
   and property.
2. Select service, frequency, property facts, condition, pets, extras and
   facility facts where applicable.
3. Select an active database promotion. FRIENDS15 is applied automatically when
   the estimate is assigned to a customer with an active benefit.
4. Calculate the itemized price, including initial and ongoing recurring prices.
5. Save as a draft, save, download a branded PDF, or email the estimate only
   when explicitly requested.
6. Assign the estimate to an existing customer and property.
7. Check real availability and convert it to a pending booking. The server
   revalidates the entire price, promotion, travel and document gate before any
   booking record is created.
8. Discard a draft without hard-deleting it.

Saving preserves the exact pricing version, input snapshot and quote snapshot.
A later pricing change never rewrites a saved estimate.

## 3. Security and scope

- Requires an authenticated admin session with `booking.write` and CSRF.
- Non-owner users are limited to their branch. A cross-branch estimate, customer
  or conversion is refused.
- A Quick Estimate never creates a customer. Assigning uses an existing customer
  and property after a scope check.
- Emailing requires an explicit action and a valid customer email.
- The PDF and email are built from the stored server quote, never from
  browser-supplied totals.
- The UI never claims a booking is confirmed. A conversion creates a **pending**
  booking; confirmation still requires the normal document and availability
  checks.
- Gift certificates are **payment tender**, not a discount. The UI tells the
  owner to check the Gift Register rather than silently netting a gift against
  the quoted price.

## 4. Promotions

- The dropdown lists active, owner-editable database promotions.
- FRIENDS15 is account-level and is not a manual dropdown entry. It applies when
  the estimate has a customer with an active entitlement.
- Community Support is the self-attested eligibility checkbox.
- An ineligible or unknown promotion fails closed with an honest error.
- The saved promotion code is re-evaluated on conversion; a stale promotion
  cannot be carried into the booking.

## 5. Actions and files

| Action | Server behavior |
| --- | --- |
| Calculate | `priceEstimateInput` only; writes nothing |
| Save / Save draft | Upserts `quick_estimates`; audit recorded; no customer or booking created |
| Download PDF | Branded PDF from the stored or calculated quote |
| Email estimate | Resend only when configured and explicitly requested; audit recorded |
| Assign | Verifies customer/property scope; updates the draft |
| Convert | Recalculates, validates documents/availability, creates a pending booking, marks the estimate converted |
| Discard | Status `discarded`, timestamp, audit; record retained |

Key files:
- `src/lib/admin/quick-estimate.ts`
- `src/lib/admin/quick-estimate-document.ts`
- `functions/api/admin/quick-estimates.ts`
- `migrations/0039_quick_estimates.sql`
- `tests/quick-estimate.test.ts`
- `tests/browser/admin-quick-estimate.test.mjs`

## 6. Owner workflow

1. Open **Quick Estimate**.
2. Enter the caller's name, phone, email and service address.
3. Choose the service and facts. Add notes for anything unusual.
4. Calculate.
5. If the caller is an existing customer, select the customer and property and
   assign; this applies FRIENDS15 if active.
6. Save.
7. Use **Download PDF** or **Email estimate** only when the caller asked for it.
8. Use **Convert** when the caller is ready. Pick a date, check real times, and
   create the pending booking.
9. Complete the normal confirmation process after required documents are signed.

## 7. Verification

- Unit: authoritative price parity with a manual booking, FRIENDS15 application,
  unknown promotion fail-closed, save/list/assign/discard, branch isolation,
  stored pricing version, conversion revalidation and pending-booking creation.
- Browser: the owner can open the section, calculate, see the itemized price and
  save it in a real browser.
- End-to-end: `tests/acceptance.test.ts` runs inquiry -> packet signature ->
  quick estimate -> conversion -> confirmation -> invoice -> payment receipt ->
  reporting.

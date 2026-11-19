# FRIENDS15 Persistent Benefit — Implementation Evidence

## Release

- Application code: `45dd3a2`
- Cloudflare Pages production deployment: `7317b104-14f4-4e49-9082-6f8e0bd1e94b`
- Migration: `0036_customer_promotion_entitlements.sql`
- Production D1: 36 migrations (migration record inserted after additive schema application)

## Implemented

- Persistent `customer_promotion_entitlements` record with customer, branch, promotion, percentage,
  assignment/removal administrators, status, policy version, timestamps and unique
  `(customer_id, promotion_id)` protection.
- Immutable `customer_promotion_entitlement_events` history for assigned/reactivated/removed/applied.
- Owner-only preview API: shows active recurring plans, upcoming unpaid appointments and linked
  invoices before any change.
- Owner-only apply/remove API with confirmation token, audit log and CSRF.
- Applying FRIENDS15:
  - discounts active recurring plan prices from the stored `base_ongoing_price_cents`;
  - never duplicates the entitlement;
  - applies only safe open, unpaid, untaxed, non-discounted appointment-linked invoices;
  - leaves paid, void, partially paid, taxed or previously discounted invoices for manual review.
- Removing FRIENDS15 restores active recurring plan prices and leaves issued invoices untouched.
- Manual residential quote applies the active benefit to eligible cleaning (base + extras, not
  travel/tax), and never stacks it on an existing quote discount.
- New recurring plans automatically use the active benefit and preserve the normal base price for
  later removal.

## Owner UI

Customer detail now includes **Discounts & Benefits**:

- Active benefit and percentage.
- Preview FRIENDS15.
- Apply after preview.
- Remove with confirmation.
- Benefit history.
- Owner-only.

## Current production effect

- No FRIENDS15 entitlement has been assigned by this implementation.
- No customer benefit, recurring plan price, invoice or appointment was changed.
- Existing active plans remain at their current prices until the owner previews and applies the
  benefit to a customer.
- Existing unpaid appointments without an explicit price cannot be silently repriced; their active
  recurring plan is the priced object. Linked safe invoices are adjusted only with preview/apply.

## Verification

- Focused entitlement tests pass.
- Full unit suite: **873 tests — 872 pass, 1 pre-existing skip**.
- Browser suite: **221 pass**.
- `astro check`, build, validate and smoke pass.
- Unauthenticated entitlement API returns `401 unauthorized`.

## Deliberately not included in this stage

- Automatic public-estimator recognition of a returning customer’s account entitlement.
- Community Care account-level selection/alternative UI; nonstacking is enforced at quote level.
- Automatic rewriting of paid/partially paid/taxed invoices; these require manual revision or credit.
- Automatic application to already-issued invoices that are not appointment-linked.
- Admin promotion dropdown, invoice terms, Stripe link repair, branding redesign, document packet
  builder and admin-wide usability work; these remain later stages.

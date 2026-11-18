# Checkout discounts and promotion controls (2026-11-18)

## Release

- Application code: `3efa854`
- Final HEAD: `3efa854` (application and documentation closeout in the same commit)
- GitHub `validate`/browser passed on `main` and `production-safe` (runs `44411889662` and `44411885010`)
- Cloudflare production deployment: `d44b1ff1-5908-4303-b228-e119af83ffa0`
- Migration `0035_promotion_supportive_stacking.sql` applied to production D1.

## Implemented

### Remove an applied promo

- An applied promotion now shows a named panel with its code and authorized discount and a
  visible **Remove** action.
- Remove clears the code, restores the automatic quote discount (for example Community Support),
  recalculates the itemized total and does not touch the appointment, gift code or other answers.
- Replacing a code is the existing Apply action with a different code; the better valid offer rules
  continue to apply.
- No promotion redemption is created merely by applying or removing a code. Redemptions remain
  reserved only when a checkout is claimed.

### Community Support compatibility

Migration `0035` adds `supportive_stackable` to `promotions`. The owner controls it from the admin
promotions form.

- **THANKS75 + Community Support: allowed.** THANKS75 is explicitly marked compatible.
- **FRIENDS15 + Community Support: not allowed.** FRIENDS15 is explicitly marked incompatible; the
  better eligible offer wins.
- All other combinations retain the existing one-valid-offer behavior unless the owner explicitly
  marks a promotion compatible.
- The submitted promotion is evaluated on the pre-Community cleaning subtotal. When compatible, the
  Community discount and the promotion both reduce that eligible subtotal; tax is recalculated on
  the result; gift value remains payment tender after tax.
- Server checkout independently enforces the policy. Client-side state cannot create a stacking
  combination the server does not allow.

### FRIENDS15

FRIENDS15 is an active 15% cleaning promotion in the owner database
(`services: standard, deep`, minimum $200, non-combinable). It applies to the first cleaning quote
through the normal dynamic promotion path. Its database record does **not** define a recurring
duration, number of recurring visits, or recurring minimum term. Recurring-visit discounting is
therefore **pending owner approval**; no indefinite recurring discount was invented.

## Itemized display

The final estimate shows separate rows for:

- base cleaning;
- add-ons;
- rounding/calibration/travel where applicable;
- Community Support discount;
- compatible submitted promotion;
- sales tax;
- gift certificate tender;
- amount due.

The customer-facing order presents gift tender first and promotional reductions after it, while the
financial calculation remains promotion → tax → gift tender.

## Verification

- `npm run check`, build, validate and smoke passed.
- Unit suite: 857 tests, 856 passing, 1 pre-existing skip.
- Full browser suite: 220 passing.
- New checkout tests cover compatible Community + THANKS75 stacking, FRIENDS15 incompatibility,
  best-offer selection, gift ordering and metadata.
- New browser tests cover promo removal, Community + compatible promotion stacking, and
  FRIENDS15/Community best-offer behavior.
- No live charge, refund, redemption or real customer record was created.

## Owner approval still required

1. FRIENDS15 recurring duration/visit limit and whether it applies to every recurring visit in that
   window. Until supplied, recurring pricing is not discounted.
2. Confirm the intended Community + THANKS75 order and the exact margin scenario. Implemented order:
   both reduce the pre-Community eligible subtotal; THANKS75 remains $75; Community remains 10%.

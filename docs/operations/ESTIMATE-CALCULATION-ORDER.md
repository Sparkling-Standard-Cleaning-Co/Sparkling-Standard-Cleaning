# Estimate calculation order (Initiative 6.2)

One authoritative order is used by the browser estimate, the instant quote, the server
recalculation, the owner notification and the customer receipt.

## Residential and STR

1. **Scope and labor** — service, property size, rooms, condition, last clean, pets, extras and
   travel are validated and converted to labor hours by the shared estimator.
2. **Base service** — `max(minimumJob, labor value + extras)` is calculated.
3. **Base presentation rounding** — the service base is rounded DOWN to the owner-approved $5 step
   (`pricing.rounding.toNearest`). This is the displayed base before any discount.
4. **One discount only** — the promotion engine and the Supportive Home eligibility discount are
   evaluated together. The **largest effective discount wins**; ties favor Supportive Home, then
   the claimed campaign, then other programs. No stacking.
5. **Owner global factor** — `pricing.globalEstimateFactor` (default `1.00`, supported `0.50–1.50`)
   multiplies the discounted **service** subtotal. It never multiplies travel or tax.
6. **Travel** — the separately calculated travel adjustment is added. It is never discounted.
7. **Final amount** — rounded to cents. There is no upward round-up and no reapplied minimum after
   an explicit discount or owner factor; the benefit is preserved exactly.
8. **Tax** — presented separately as a disclosure (see `TAX-TREATMENT.md`). No tax amount is
   invented.
9. **Recurring** — a new recurring arrangement prices its required first Deep Cleaning under this
   order; the ongoing per-visit rhythm is computed by the same engine and shown separately.

## Commercial and church

1. Workload hours from the ISSA-based area + fixture model.
2. Cleaning subtotal = `max($125 minimum, labor hours × $60)` rounded UP to the next $5.
3. Church discount (10%) applies to that cleaning subtotal after the minimum. It is **not** rounded
   up again; the exact discounted subtotal is retained.
4. Owner global factor applies to the discounted cleaning subtotal.
5. Travel is added separately (never discounted by the church discount or factor).
6. Tier A shows one preliminary per-visit total; Tier B shows a ±15% range around the per-visit
   total; Tier C remains a personal scope review with no invented number.
7. Tax is presented separately as a disclosure.

## Diagnostics

If the owner global factor (less than 1) takes the service subtotal below the normal minimum, the
result carries a `GLOBAL_FACTOR_BELOW_FLOOR` review flag and trace entry. The factor is never
silently changed.

## Where to change values

- `src/config/owner-pricing.ts` — global factor, discount percentages, rates and minimums.
- `src/config/pricing.ts` — typed config and approval notes.
- Bump the relevant `configVersion` when a price-affecting value changes.
- Rebuild/deploy for the change to take effect. The server uses the same configuration, so a
  deployed build and its function endpoints stay aligned.

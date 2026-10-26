# Estimator configuration — owner-editable source

This directory is the front door to every estimator setting. Start with the
repository root [owner control center](../../../START-HERE-OWNER-CONTROL-CENTER.md)
and use [the full manual](../../../docs/ESTIMATOR-CONTROL-CENTER.md) when you need
the variable directory or worked examples.

| File | Owns | Edit when |
| --- | --- | --- |
| `pricing-values.ts` | Raw pricing numbers: labour rates, production rates, add-ons, discounts, minimums, rounding, travel economics, commercial/church workload values, promotion terms and the four independent `estimatorCalibration` factors. | The owner changes a business assumption. |
| `pricing-version.ts` | Automatic deterministic fingerprint of the effective pricing values + shared travel economics + calculation-schema marker. | Never for a normal price edit; it is computed. |
| `calculation-schema.ts` | Developer marker for calculation-algorithm changes. | A developer changes the estimator formula/order, never an owner value. |
| `validation.ts` | Hard validation and business warnings for owner values, dependencies, input limits and tier policy. | No edit for normal owner values. |
| `input-definitions.ts` | Customer-facing option labels/descriptions and numeric input limits for residential, STR, commercial and church forms. | An option, label or allowed range changes. |
| `travel.ts` | Shared fuel/wear/travel calculation assumptions and driving policy. | Vehicle economics or territory policy changes. |
| `commercial.ts` | Commercial/church tier kill switch, tier triggers and legacy square-foot reference thresholds. | Numeric facility pricing is enabled/disabled or a trigger changes. |
| `index.ts` | Re-export map only. | Never edit values here. |

The typed wrapper `../pricing.ts` attaches approval state and notes to the raw
pricing values. The calculator functions in `src/lib/estimate/` consume that
wrapper. Do not edit calculation functions to make a routine value change.

`estimatorCalibration` is four independent multipliers, one per engine. Each
defaults to `1.00`; the supported range is `0.50–1.50`; invalid values fail
closed to `1.00`. They apply to the eligible service subtotal only, after the
normal minimum/discount order and never to travel or tax. Changing one engine
must not change another.

An ordinary owner edit does **not** require a test-file edit or a manual quote
version bump. `npm run config:validate` (run automatically by `prebuild`)
checks the current values; tests derive expectations from the current
configuration; and `pricing-version.ts` updates the quote fingerprint
deterministically. Use `npm run pricing:impact` to preview representative
offers.

**Safety:** this repository is public. Never place API keys, passwords,
customer data or private operating coordinates in these files. Production
secrets stay in Cloudflare environment variables.

# Estimator configuration — owner-editable source

This directory is the front door to every estimator setting. Start with the
repository root [owner control center](../../../START-HERE-OWNER-CONTROL-CENTER.md)
and use [the full manual](../../../docs/ESTIMATOR-CONTROL-CENTER.md) when you need
the variable directory or worked examples.

| File | Owns | Edit when |
| --- | --- | --- |
| `pricing-values.ts` | Raw pricing numbers: labour rates, production rates, add-ons, discounts, minimums, rounding, travel economics, commercial/church workload values, promotion terms. | The owner changes a business assumption. |
| `input-definitions.ts` | Customer-facing option labels/descriptions and numeric input limits for residential, STR, commercial and church forms. | An option, label or allowed range changes. |
| `travel.ts` | Shared fuel/wear/travel calculation assumptions and driving policy. | Vehicle economics or territory policy changes. |
| `commercial.ts` | Commercial/church tier kill switch, tier triggers and legacy square-foot reference thresholds. | Numeric facility pricing is enabled/disabled or a trigger changes. |
| `index.ts` | Re-export map only. | Never edit values here. |

The typed wrapper `../pricing.ts` attaches approval state and notes to the raw
pricing values. The calculator functions in `src/lib/estimate/` consume that
wrapper. Do not edit calculation functions to make a routine value change.

**Safety:** this repository is public. Never place API keys, passwords,
customer data or private operating coordinates in these files. Production
secrets stay in Cloudflare environment variables.

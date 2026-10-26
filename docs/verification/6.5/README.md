# Initiative 6.5 — owner-editable estimator configuration

## Configuration audit

The old `tests/estimator-config-integrity.test.ts` froze current rates, labor
assumptions, minimum, settings, travel values and all four calibration factors.
That was a useful 6.3 transition guard, but it made legitimate owner edits
require test changes. It is now a **current-configuration validation suite**:
structure, required keys, finite/range checks, dependencies, approval gates,
automatic version and client/server agreement are checked without requiring any
particular rate or factor value.

Other owner-value assumptions removed from tests:

- `tests/pricing-adjustments.test.ts`: no longer requires four factors to equal
  `1.00`; factors are checked against the current configuration and at the
  supported boundaries. Added independent STR scaling.
- `tests/estimator.test.ts`: removed fixed 4.5–6.3 labor-hour and minimum-price
  assertions; now checks relative/structural behavior and current formulas.
- `tests/pricing-breakdown.test.ts`: rates, add-on charges and presentation
  steps derive from current configuration; fixed-price add-ons are supported.
- `tests/owner-pricing.test.ts`: dynamic rate/labor/add-on assertions.
- `tests/estimate-engines.test.ts`, `tests/facility-calibration.test.ts`,
  `tests/facility-verify.test.ts`, `tests/api-verification.test.ts`: current
  minimum, church percentage, rate and add-on values are derived rather than
  hard-coded.
- `tests/config.test.ts`: removed arbitrary “factor must stay 1.0” restrictions;
  remains structural and policy-focused.
- `tests/browser/journey.test.mjs` and
  `tests/browser/estimate-engines.test.mjs`: expected totals and add-on/copy
  values derive from the current configuration; selected commercial/church
  presentation is dynamic.
- `tests/browser/review-carousel.test.mjs`: unique preview port (4418 collision).

Mathematical protection remains through:

- `tests/pricing-reference.test.ts` — controlled fixture, fixed $235 / $258.50 /
  $199.75 outputs independent of current owner values.
- Exact recalculation and reconciliation checks.
- Client/server agreement tests.
- Tier A/B/C, discount, minimum, travel, tax and discount-stacking guards.
- Fixed policy gates for binding offers, promotions, publication and custom
  scope reviews.

New files:

- `src/config/estimators/validation.ts` — hard errors + business warnings.
- `src/config/estimators/pricing-version.ts` — deterministic fingerprint.
- `src/config/estimators/calculation-schema.ts` — developer algorithm marker.
- `scripts/validate-estimator-config.mjs` — build gate.
- `scripts/pricing-impact.mjs` — four-engine impact report and before/after.
- `tests/estimator-config-validation.test.ts`, `tests/pricing-version.test.ts`,
  `tests/pricing-reference.test.ts`.

## Owner workflow and automatic version

The owner edits only `src/config/estimators/pricing-values.ts`. A legitimate
numeric change does not require test edits or quote-version edits. GitHub
Actions validates the configuration, runs the unit/browser suites and prints a
pricing impact preview. Cloudflare Pages runs `npm run build`; the `prebuild`
hook runs `npm run config:validate` before Astro builds, so invalid pricing
cannot be published.

The version is
`2026-10-25.engine-calibration-supportive-tax.v1.<16-hex-fingerprint>`.
It is computed synchronously from effective owner values + shared travel
economics + the calculation-schema marker. Cosmetic labels, terms-version
labels and presentation copy are excluded. Current version:
`2026-10-25.engine-calibration-supportive-tax.v1.6df62617cd8e1616`.

## Edit simulations

Temporary values were applied only in the local worktree, tests were run, and
the original `pricing-values.ts` was restored each time. No temporary value was
committed or deployed.

| Simulation | Version | Representative result | Checks |
| --- | --- | --- | --- |
| Commercial factor `1.00 → 1.10` | `...74d2113ed0e351b7` | Small office +$12.50, medium office +$21.00; Residential/STR/Church $0 | `npm test` + full browser suite **136/136 passed** |
| Hourly rates `55 → 60` | `...11cf887857997eca` | Residential 3/2 +$20, deep +$30, STR +$15/$25; Commercial/Church $0 | `npm test` 522/521 pass; 1 pre-existing skip |
| STR base hours `1.2 → 1.3` | `...e9a99d945c890425` | STR +$5 each; all other engines $0 | `npm test` passed |
| Church factor `1.00 → 1.25` | `...e7e6fb60d6dffc57` | Small church +$34.88, medium +$61.88; all other engines $0 | `npm test` passed |
| Inside oven `0.6 → 0.65 h` | `...ffd6fe1c2e76a413` | Typical home + oven +$5; other rows $0 | `npm test` passed |
| Minimum `$125 → $135` | `...6ac08e8b56f81f87` | Minimum-case and small commercial +$10 | `npm test` passed |
| Church discount `10% → 12%` | `...d95c859d122b998c` | Small church −$3.10, medium −$5.50; other engines $0 | `npm test` passed |
| Commercial factor `1.75` (invalid) | rejected | n/a | `config:validate` exit 1; `npm run build` exit 1 before Astro build |

The invalid-value message was:

`ERROR estimatorCalibration.commercial: Commercial calibration factor must be between 0.50 and 1.50. Received 1.75.`

## Final baseline

All four factors are restored to `1.00`; rates, labor, minimum, add-ons,
discount and travel values are the pre-initiative production values. The final
effective version is
`2026-10-25.engine-calibration-supportive-tax.v1.6df62617cd8e1616`.

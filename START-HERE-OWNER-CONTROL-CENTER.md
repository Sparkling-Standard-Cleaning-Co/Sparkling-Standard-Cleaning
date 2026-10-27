# START HERE — OWNER CONTROL CENTER

This is the front door for editing Sparkling Standard without digging through
code. Everything below is ordinary text or numbers in the public GitHub
repository. **Never put passwords, API keys or customer data in any of these
files** — production secrets belong only in Cloudflare.

Full instructions: [Owner Operations Manual](docs/OWNER-OPERATIONS-MANUAL.md).

Estimator details: [Estimator Control Center](docs/ESTIMATOR-CONTROL-CENTER.md).

---

## HOW TO CHANGE ANY ESTIMATOR PRICE IN GITHUB

This is the routine owner workflow. You do **not** edit tests, calculation
code or a quote-version field for a legitimate numeric change.

1. Open [`src/config/estimators/pricing-values.ts`](src/config/estimators/pricing-values.ts)
   in GitHub.
2. Find the variable you want. The sections are numbered: hourly rates,
   minimum, calibration, discounts, commercial/church, labor hours, add-ons,
   promotions, range, rounding and travel.
3. Change **one** number. Keep the existing units (USD, hours, multiplier or
   percent).
4. Respect the limits shown in the comments and the Estimator Control Center:
   calibration factors must stay between `0.50` and `1.50`; percentages must
   stay between `0` and `100`; rates, hours and minimums must remain positive;
   range low must stay below `1` and range high above `1`; Tier B hours must be
   greater than Tier A hours.
5. Commit the change with a plain description, for example
   `Adjust commercial calibration to 1.10`.
6. GitHub Actions runs `config:validate`, TypeScript checks, unit tests, the
   build, pricing impact preview and browser/integration checks. A valid
   one-number change passes without editing any test file.
7. Cloudflare Pages deploys from `main`. Its build command runs the same
   `config:validate` gate **before** Astro builds, so an invalid value fails
   the deployment and the previous live release remains in place. GitHub
   validation is not the only guard.
8. Check **Actions** and **Cloudflare Pages → Deployments**. When both succeed,
   open the live estimator and spot-check a representative quote.

### The four calibration factors

In `pricing-values.ts`:

```ts
estimatorCalibration: {
  residential: 1.0,
  str: 1.0,
  commercial: 1.0,
  church: 1.0,
},
```

`1.00` leaves that engine unchanged; `0.90` reduces its eligible service
subtotal by 10%; `1.10` increases it by 10%. Each engine is independent.
Changing Commercial does not change Church, STR or Residential. `1.00` is the
current approved value, not a permanent value that tests require.

### Other routine settings

| What to change | Find in `pricing-values.ts` | Simple owner edit? |
| --- | --- | --- |
| Hourly and owner labour rates | `hourlyRates` | Yes; owner target must stay below the billing rates |
| Minimum job | `minimumJob` | Yes; keep positive |
| Base cleaning time | `baseLaborHours` | Yes; keep positive hours |
| Time per bath/bed/square foot | `laborUnits` | Yes; keep sensible positive values |
| Condition/frequency/last-clean multipliers | `conditionFactors`, `frequencyFactors`, `lastCleanFactors` | Yes; preserve the ordering rules shown in validation |
| Add-on price | an add-on's `laborHours` or `fixedPriceUsd` | Yes; specialty add-ons stay `customQuote` |
| Add-on bundles | `promotions.addonBundles` | Yes; keep every bundle transparent, all required extras selected, one discount only, and specialty items excluded |
| Online payment availability | `src/config/payments.ts` + Cloudflare `STRIPE_SECRET_KEY` | Owner-approved feature switch; live checkout requires the secret and webhook |
| Discount percentages | `supportiveHomeDiscount`, `churchDiscount` | Yes; current approval and non-stacking terms still apply |
| Commercial/church workload | `commercialPricing` | Yes; Tier B must exceed Tier A |
| Range and rounding | `range`, `rounding` | Yes; preserve range ordering and a positive step |
| Travel economics | `travel.ts` | Yes; shared by browser and server |

### Preview the impact before committing

```powershell
npm run pricing:impact
npm run pricing:impact -- --compare HEAD
```

The first command prints representative Residential, STR, Commercial and
Church outcomes. The second compares the working tree with the previous
committed configuration and shows before/after totals. The GitHub validation
log also displays the comparison on a push.

### If the change is wrong

Do not force-push or rewrite history. Use GitHub history to **Revert** the
commit (or commit the old value back), wait for validation and deployment, and
confirm the live estimate. The automatic version changes with the restored
configuration.

### What still needs engineering review

Adding a new calculation rule, a new service/frequency combination, a new
conditional input type, a new payment/booking behavior or a new business
policy is not a routine number edit. Activating a prepared promotion still
requires the owner-approved written terms, the publication flags and the
release review. The pricing test suite proves arithmetic, identity and
client/server agreement; it does not authorize new business policy.

---

## I want to change…

| I want to change… | Edit this file | Notes |
| --- | --- | --- |
| Prices, labour hours, minimum charge, discounts, engine calibration factors, add-ons, rounding, travel economics, commercial/church workload values, promotions | [`src/config/estimators/pricing-values.ts`](src/config/estimators/pricing-values.ts) | The single owner-editable pricing file. `estimatorCalibration` holds four independent factors (residential, STR, commercial, church), all 1.00 by default. Keep approval flags in `src/config/pricing.ts` honest. |
| Service names, dropdown choices, descriptions, form limits (square footage, bedrooms, fixtures) | [`src/config/estimators/input-definitions.ts`](src/config/estimators/input-definitions.ts) | Changing a value the calculator does not understand needs engineering review. |
| Mileage, fuel/wear assumptions and driving-time policy | [`src/config/estimators/travel.ts`](src/config/estimators/travel.ts) | Shared by the browser and the Cloudflare travel function. |
| Commercial/church numeric-price switch and tier triggers | [`src/config/estimators/commercial.ts`](src/config/estimators/commercial.ts) | The kill switch is enforced in the browser and on the server. |
| ZIP coverage zones and approved public area wording | [`src/config/geography.ts`](src/config/geography.ts) | ZIP centroids are preliminary references, not public addresses. |
| Booking lead time and the required first-visit Deep Cleaning rule | [`src/config/scheduling.ts`](src/config/scheduling.ts) | The server enforces the same settings. |
| Website page copy | [`src/content/site/`](src/content/site/) and [`src/content/services/`](src/content/services/) | Markdown content; the layout stays in components. |
| Business name, phone, email, hours, social links, launch flags | [`src/config/business.ts`](src/config/business.ts) and `.env` | Never invent a pending fact. |
| Icons and imagery | [`src/assets/icons/white-tile/`](src/assets/icons/white-tile/), [`src/assets/images/`](src/assets/images/) | Keep the approved white-tile backgrounds intact. |
| Reviews | [`src/content/reviews/`](src/content/reviews/) | Genuine reviews only; first names only. |
| Estimates after a change | `npm run pricing:impact` | Shows representative four-engine impact; add `-- --compare HEAD` for before/after. |
| Pay Now, reservation, Stripe configuration | [`docs/operations/ESTIMATE-PAYMENTS.md`](docs/operations/ESTIMATE-PAYMENTS.md) | Server-verified amount; custom/range quotes stay reservation-only. |

---

## The five-minute safe edit

1. Open the file in GitHub and choose **Edit**.
2. Change only the number or text you intend to change.
3. Use **Commit changes** with a plain description such as `Adjust recurring labour rate`.
4. Open **Actions** and wait for `validate` to pass.
5. Cloudflare Pages deploys `main`; open the live estimate and spot-check it.

If `validate` fails, open the failed step and read the message. Do not keep
pushing changes until the error is understood.

## Files that are not owner settings

- `src/lib/estimate/` — the calculation functions. Routine price changes do
  **not** require editing these.
- `src/config/pricing.ts` — typed approval wrapper. Only a developer should
  change approval states or explanatory notes.
- `functions/api/` — server endpoints. Treat as application code.
- Cloudflare dashboard — secrets and production environment only.

## Documentation map

| Document | Use it for |
| --- | --- |
| [Owner Operations Manual](docs/OWNER-OPERATIONS-MANUAL.md) | Everyday editing, publishing, backups and troubleshooting |
| [Estimator Control Center](docs/ESTIMATOR-CONTROL-CENTER.md) | Every estimator variable, worked examples and safety rules |
| [Estimator configuration README](src/config/estimators/README.md) | What each estimator config file owns |
| [Image source register](docs/design/IMAGE-SOURCE-REGISTER.md) | Photo provenance and licences |
| [White-tile icon inventory](docs/design/WHITE-TILE-ICON-INVENTORY.md) | All 17 icons and where they render |
| [Repository inventory](docs/REPOSITORY-INVENTORY.md) | What is active, archived or owner-local |
| [Deployment guide](docs/deployment/DEPLOYMENT.md) | Cloudflare/GitHub setup and secrets |
| [Operations hub](docs/OPERATIONS-HUB.md) | The wider system map |

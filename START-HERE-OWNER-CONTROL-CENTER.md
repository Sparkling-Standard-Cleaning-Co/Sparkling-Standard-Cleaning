# START HERE — OWNER CONTROL CENTER

This is the front door for editing Sparkling Standard without digging through
code. Everything below is ordinary text or numbers in the public GitHub
repository. **Never put passwords, API keys or customer data in any of these
files** — production secrets belong only in Cloudflare.

Full instructions: [Owner Operations Manual](docs/OWNER-OPERATIONS-MANUAL.md).

Estimator details: [Estimator Control Center](docs/ESTIMATOR-CONTROL-CENTER.md).

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
| Estimates after a change | `npm run estimate:quotes` | Shows representative before/after prices without sending email. |

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

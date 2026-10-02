# Owner Settings Guide — changing your prices safely

This guide is for the business owner. It explains where every price lives, how to change it from a
phone or computer using GitHub, and how to check the result before customers see it. No coding
knowledge is required beyond editing numbers in one file.

Everything on the website is calculated from **one settings file**:

> **`src/config/owner-pricing.ts`**
> Open it: https://github.com/Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning/blob/main/src/config/owner-pricing.ts
> Edit it directly: https://github.com/Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning/edit/main/src/config/owner-pricing.ts

**This repository is public.** Internal rates and assumptions are visible to anyone who looks. Never
put passwords, customer information or genuinely confidential business data in the file.

---

## 1. The two files and what each one does

| File | What it is | Who edits it |
| --- | --- | --- |
| `src/config/owner-pricing.ts` | The raw numbers: hourly rates, labor times, add-ons, rounding. One clearly grouped block per topic. | **You (the owner)** |
| `src/config/pricing.ts` | The same values wearing their "approval badge" — `provisional` (a starting point) or `approved` (owner-approved) — plus the notes explaining each one. | A developer; change only the approval state or a note |

You only ever need `owner-pricing.ts`. The website's calculator, the customer's instant price, the
server's independent re-check and the owner notification all read the same values through
`pricing.ts`, so there is nothing to keep in sync by hand.

---

## 2. Editing on GitHub (step by step)

1. Sign in to GitHub and open the **edit link** above (or open the file and tap the pencil icon).
2. Find the section you want (each has a numbered banner comment, e.g. `── 1. Hourly rates ──`).
3. Change **only the number** after the colon. Keep the commas and the structure exactly as they
   are — the file is machine-checked and a missing comma stops the website from building.
4. Scroll to the bottom and press **Commit changes…**
5. Write a short message, e.g. `Raise recurring rate to $45`, and commit to the `main` branch.
6. **Saving is not publishing.** The commit starts an automatic rebuild. The live site updates in
   roughly **2–4 minutes**. If the file has an error, the build fails and the live site simply keeps
   the previous prices — nothing breaks for customers, but your change does not go live. The next
   section shows how to check before that happens.

---

## 3. Check your change before you publish it

Run these on your computer from the project folder (a developer can set this up once):

| Command | What it tells you |
| --- | --- |
| `npm run estimate:quotes` | A table of representative homes (studio, 2BR, 3BR, deep clean, STR…) showing labor hours, the proposed price, the range and the rounded customer price — exactly what the current numbers produce. |
| `npm run estimate:discount-impact` | How any enabled discount affects the modelled contribution. |
| `npm test` | Runs the pricing and calculator tests. If a number breaks the model, it fails here. |
| `npm run check` | Catches typos and invalid values before the site rebuilds. |

Always run `npm run estimate:quotes` **before and after** a change and compare the rows. If a row
moved by more than you intended, adjust the number and run it again.

---

## 4. What each setting changes (plain English)

### 1. Hourly rates
- `recurring` — what one labor-hour earns on **recurring** maintenance cleans (weekly, biweekly,
  monthly standard). Raising it raises every recurring quote.
- `otherServices` — the rate for one-time, deep, move-in/move-out and STR work.
- `ownerLaborTarget` — the founder's pay floor per hour. It must stay **below both rates** or the
  tests fail; it is a safety rail, not customer-facing.

### 2. Minimum job
The smallest amount any visit can be priced at. A small job is quoted at this number even when the
labor math comes out lower.

### 3. Base labor-hours per service
The starting time for each service **before** size and rooms are added: `standard`, `deep`,
`move_in_out`, `str_turnover`.

### 4. Labor per property unit
- `sqftHoursPerThousand` — extra hours for each 1,000 sq ft (the biggest driver of larger-home
  prices).
- `fullBathHours` / `halfBathHours` — time per bathroom.
- `bedroomHours` / `bedroomsIncludedInBase` — time per bedroom **beyond** the first
  `bedroomsIncludedInBase`.
- `strBathHours`, `strBedHours`, `strSqftHoursPerThousand` — the separate STR turnover model.

### 5. Condition multipliers
Multiplies total labor by how the home is kept: maintained → severe. **Severe always goes to a
custom quote** rather than an instant price.

### 6. Last-clean multipliers
Multiplies labor by how long since the last professional clean. `not_sure` uses a conservative
middle value.

### 7. Frequency factors
The per-visit efficiency of recurring service (weekly is the best value, one-time is the baseline).
These are a labor-efficiency model, **not** a marketing discount.

### 8. Range and rounding
- `lowFactor` / `highFactor` — the range shown around the estimate.
- `roundToNearest` — estimates round **up** to the nearest multiple (default $5) so the site never
  shows false precision.

### 9. Add-ons
Each add-on normally charges `laborHours × the applicable rate`. To charge a **flat dollar price**
for one add-on instead, add a line to that add-on:

```ts
{ id: 'inside_oven', label: 'Inside oven', laborHours: 0.6, customQuote: false, category: 'kitchen', fixedPriceUsd: 35 },
```

- `laborHours` still counts toward the scheduled time (how long the visit takes).
- `fixedPriceUsd` replaces the **charge** everywhere: the price shown beside the checkbox, the
  total, the reservation quote and the server's re-check.
- Specialty items (`customQuote: true`) are never given an instant price — leave them alone.
- Remove the `fixedPriceUsd` line to return to labor-based pricing.

### 10. Promotions and discounts
The `promotions` section holds the proposals (multi-add-on incentive, response guarantee, loyalty /
appreciation discounts, founding offer). **Every proposal is disabled and its percent is `null`
until the owner approves exact terms in writing.** Enabling a proposal changes what customers are
promised — do not turn one on without the owner's explicit approval of the final numbers and
conditions.

---

## 5. Provisional vs approved vs disabled

Alphabetical next to each value in `src/config/pricing.ts` you will see one of:

- **`approved(...)`** — the owner approved this number. Do not change it without a new owner decision.
- **`provisional(...)`** — a working starting point that may still change. Expect it to be tuned.
- **`enabled: false`** — a proposed promotion that is **not published**. The website never shows it
  while it is false.

Public pages never print hourly rates or labor hours — only the proposed customer prices.

---

## 6. When the quote version must change

`pricing.instantQuote.configVersion` is the marker the server uses to prove a quote was built on the
current rules. **Any change that moves a customer price requires bumping it.** A typo fix, a comment,
or adding fixed-price support without changing a price does not. When in doubt, ask a developer
before changing it.

---

## 7. Rollback — undo a change safely

1. Open the repository's **Commits** page: https://github.com/Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning/commits/main
2. Find the commit with the pricing change you want to undo.
3. Easiest and safest: open the file again, put the previous number back, and commit that as a new
   change ("Revert recurring rate to $42"). This keeps a clear history and deploys in 2–4 minutes.
4. A developer can alternatively use **Revert** on the commit from the GitHub interface.
5. Never force-push, reset or delete history. If the site is broken, revert the commit — the live
   site stays on the last good build until the new one succeeds.

---

## 8. Quick reference — where to change common things

| I want to change… | Edit in `owner-pricing.ts` |
| --- | --- |
| Recurring cleaning price level | `hourlyRates.recurring` |
| One-time / deep price level | `hourlyRates.otherServices` |
| Smallest possible job | `minimumJob` |
| Big-home pricing | `laborUnits.sqftHoursPerThousand` |
| Bathroom / bedroom time | `laborUnits.fullBathHours`, `bedroomHours` |
| Deep-clean starting time | `baseLaborHours.deep` |
| Overdue-home surcharge | `conditionFactors`, `lastCleanFactors` |
| One add-on to a flat price | that add-on's `fixedPriceUsd` |
| Estimate range / rounding | `range`, `rounding` |
| A promotion | `promotions` — **owner approval required first** |

Related documents: `docs/launch/PRICING-PROPOSAL.md` (pricing rationale),
`docs/verification/VERIFICATION.md` (how quotes are verified), `AGENTS.md` (developer rules).

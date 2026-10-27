# Initiative 6.6 — owner audit and payment readiness

**Baseline:** `main` at `5d8cd44` (Initiative 6.5 documentation closeout), clean working tree.
**Audit source:** `sswebsiteaudit.docx` (13 pages, 2026-10-26), extracted into
`%TEMP%\opencode\ss66\docx\`.
**Status:** implemented and verified locally; deployment recorded in
`docs/verification/VERIFICATION.md` after the authorized push.

## Owner-directed changes

| Area | Result |
| --- | --- |
| Four-value banner | Descriptions removed; four approved titles/icons remain, centered in a four-column desktop strip and stacked on phones. |
| KJV verses | Moved out of the value cards: Galatians 5:13 in **Our Values**, Colossians 3:23 in the estimate band. |
| Our Values | Replaced Southern Hospitality/Bible Belt copy with the owner's exact two paragraphs; the entire heading and copy are centered. |
| Homepage CTA | Heading is now **Is your space ready to sparkle?** |
| Community Support cards | Seniors and Elderly, First responders, Military veterans, Those with Disabilities, Other eligible community members, with the approved descriptions. |
| Eligibility wording | The estimator and program copy use **Eligibility is subject to verification before cleaning.** |
| Deep Cleaning card | States it is available as a one-time cleaning and is required before new recurring residential service. |
| Move-in/out icon | Replaced with a moving box and directional in/out arrows; Competitive Pricing was deliberately not changed. |
| Address autocomplete | State selector is Florida/Alabama; Georgia is shown disabled as **Georgia — Coming Soon**. |
| GPS loading | Disabled busy state with spinner and **Finding Your Location**. |
| Address failure | Exact owner copy: “We couldn't find that address on the map. Please enter your ZIP code to continue, and we'll confirm the exact price and location during booking.” |
| Facility ZIP | Optional when the customer has a confirmed location; rule validation and submission both accept it. |
| Residential intro | Audited hero paragraph removed; steps and “Not a home?” link remain. |
| Estimate sidebar | Replaced with the owner-directed “No two homes are the same” explanation, Pay Now/reservation choice and the closing **Your home. Your estimate. Your schedule. Your choice.** |
| Pay Now | Server-verified Stripe Checkout is implemented for priced residential/STR and exact Tier A facility quotes. Custom/range/custom-review quotes stay reservation-only. Reservation without upfront payment remains. |
| Bundles | Kitchen Refresh, Deep Detail and Recurring Care enabled with 10% off eligible add-on subtotals and caps; all required extras must be selected; single-discount policy and specialty exclusion preserved. |
| Community Support | Removed the audited extra paragraph/link; policy remains and the exact verification disclaimer is shown. |
| Confirmation state | **Custom confirmation required** becomes **Confirmation Required**; raw 390-minute travel wording becomes **6 hours and 30 minutes**. |
| Travel/scheduling copy | Removed the duplicated custom-confirmation travel block and the “Later appointments get an arrival window” sentence. |
| Facility intros | Commercial and church eyebrow/headline/accent/lead/link fully centered above the form. |
| Deep Cleaning page | Removed the hero parenthetical and “Anyone who wants…” bullet; added **What a Deep Clean Is** with the owner explanation; hid the scope-exclusions/“Prefer to ask first?” section; kept the CTA buttons and removed the audited closing sentence. |
| Move-in/Move-out | Hid the same scope-exclusions section while keeping the service content. |
| Service Area | Removed the highlighted claims/paragraph; replaced “sometimes it works…” with **care and consideration**; kept the map legend and 18-county map. |
| Legal archive | Private master archive now has `05-Business-Operations/START-HERE.md` and a 10-folder `Legal/` structure. The Florida Articles (2026-10-21) and readable certificate are filed privately; the operating-agreement template is separated. No private filing was added to Git. |

## Verification (pre-deployment)

| Check | Command | Result |
| --- | --- | --- |
| TypeScript diagnostics | `npm run check` | 148 files; 0 errors, 0 warnings, 0 hints |
| Functions TypeScript | `npx tsc --noEmit` | 0 errors |
| Production build | `npm run build` | 27 pages built; automatic config validation passed |
| Unit suite | `npm test` | **531 tests: 530 passed, 1 pre-existing skip, 0 failed** |
| Browser suite | `npm run test:browser` | **146 passed, 0 failed** |
| Static validation | `npm run validate` | 1,855 internal links across 27 pages; SEO, homepage copy, marketing/QR, GTM and checklist checks passed |
| Smoke | `npm run smoke` | 21 required pages passed |
| PENDING / testimonials / facts | `npm run pending`, `npm run testimonials`, `npm run audit:facts` | all passed |
| Configuration | `npm run config:validate` | `2026-10-25.engine-calibration-supportive-tax.v1.d2374591a95ad4cc` |
| Pricing impact | `npm run pricing:impact` | four factors `1.00`; Kitchen Refresh saves $10.45 and Deep Detail saves $11.55 in representative scenarios; no base rate/formula/minimum/travel change |
| Visual evidence | this folder | desktop/mobile homepage, trust strip, Our Values, Deep Cleaning card/page/CTA, move-out icon/card, Service Area, commercial intro, payment success, Tier A Pay Now |

## Payment safety verification

- Server verifies every amount; the valid Tier A test asserts Stripe receives the server-calculated
  cents, not the browser value.
- A client-inflated facility quote is rejected before any Stripe call.
- Missing Stripe secret returns 503 and leaves the reservation path intact.
- Pay Now is hidden when the configuration probe reports disabled.
- Live card processing was **not** performed. Production Stripe keys and the webhook signing secret
  must be configured by the owner; see `docs/operations/ESTIMATE-PAYMENTS.md`.

## Known residuals

- Live Stripe checkout/webhook receipt is unverified until the owner supplies test/live secrets and
  a test-mode payment is completed.
- The master-folder legal archive is private and intentionally outside Git; this repository records
  only that it exists.
- Visual evidence is from the local production build, not a physical mobile device.

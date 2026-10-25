# Initiative 6.2 acceptance matrix

**Status:** release candidate, **not deployed**. Production remains Initiative 6.1 at `af46db4`.
**Branch:** `initiative-6.2-complete-experience-audit` (from `af46db4`).
**Evidence:** local production build, Playwright Chromium, unit/browser suites, and the screenshots
in `docs/verification/6.2/`. This document does not claim live-production verification.

Status vocabulary:

- **Verified** — implemented and covered by automated tests and/or direct visual capture.
- **Owner-reported** — configured externally by the owner; not independently proven here.
- **Pending owner** — requires an owner decision or external verification.
- **Not applicable** — deliberately absent.

## 1. Customer journey and routes

| # | Requested outcome | Correction shipped | Evidence | Status |
| --- | --- | --- | --- | --- |
| 1 | Dedicated residential estimator route; no duplicate wizard in the hub | `/estimate/residential/` owns the residential wizard; `/estimate/` is selection-only with four engine cards | `tests/browser/estimate-engines.test.mjs`, `tests/browser/journey.test.mjs`; `06-estimate-hub.jpg`, `07-residential-estimator.jpg` | Verified |
| 2 | Legacy residential/STR links and campaign claims keep working | `/estimate/?service=…`, `?promo=…`, `SPARKLE100` claims and UTM query context forward to `/estimate/residential/` with the query intact | Browser tests for legacy forwarding and attribution; manual browser check | Verified |
| 3 | No dead ends or stale query state | URL/search-param handling uses `URL`/`URLSearchParams`; stale service values normalize; invalid combinations are rejected by the shared validator, never silently repriced | `tests/browser/service-matrix.test.mjs`, `tests/browser/wizard.test.mjs` | Verified |
| 4 | One submission pipeline | All four engines use the same `/api/lead` relay, address finder, travel lookup, Turnstile, notification and customer receipt | `tests/api-verification.test.ts`, browser journey tests | Verified |
| 5 | No automatic booking or payment | No booking, checkout or charge path added; gift certificates remain request-only/disabled | Code audit; existing gift tests | Verified |

## 2. Residential estimator

| # | Requested outcome | Correction shipped | Evidence | Status |
| --- | --- | --- | --- | --- |
| 6 | Clear, premium guided experience | Existing residential wizard retained at the dedicated route; progress, live estimate and summary preserved | `07-residential-estimator.jpg`; browser wizard tests | Verified |
| 7 | Specific validation, not vague failures | Field-specific messages for service, property type, square footage, bedrooms, baths, frequency, last clean, pets, address, phone and email; first invalid field focused | `tests/browser/wizard.test.mjs` | Verified |
| 8 | Recurring first-visit rule preserved | New recurring arrangements require the first-visit Deep Cleaning acknowledgement; server rejects a recurring request without it | `tests/api-verification.test.ts`, `tests/browser/journey.test.mjs` | Verified |
| 9 | Two-price recurring presentation preserved | First visit and ongoing per-visit amount remain distinct; the ongoing amount is never discounted by the first-visit campaign | `tests/pricing-breakdown.test.ts`, browser journey tests | Verified |
| 10 | Supportive Home is optional and non-discriminatory | Eligibility is self-attested; no medical records or proof requested; not preselected; practical extras still priced transparently | `tests/pricing-adjustments.test.ts`; supportive page copy | Verified |
| 11 | Supportive Home 10% discount | One 10% eligibility discount, optional and never stacked; largest single discount wins; applied to the pre-tax service subtotal | `tests/pricing-adjustments.test.ts`, `tests/estimate-engines.test.ts`, `tests/request-summary.test.ts` | Verified |
| 12 | Accurate supported pricing on mobile/desktop | Responsive quote summary; full-width address rows; two-decimal currency; no horizontal overflow at 320/375/390/768/1440 | Layout audit; `12-home-mobile.jpg`; browser tests | Verified |

## 3. Commercial and church guided forms

| # | Requested outcome | Correction shipped | Evidence | Status |
| --- | --- | --- | --- | --- |
| 13 | Commercial/church forms are coherent, guided experiences | Four steps: facility/ministry → cleaning needs → schedule/access → contact; progress indicator; Back/Continue | `tests/browser/estimate-engines.test.mjs`; `08-commercial-tier-a.jpg` | Verified |
| 14 | Per-step validation and keyboard behavior | Each step validates its own fields; error summary is announced; focus moves to the first invalid field; submission is blocked until valid | `tests/browser/estimate-engines.test.mjs`; `09-field-validation.jpg` | Verified |
| 15 | No unexplained numeric presentation | Tier A single preliminary price, Tier B ±15% range, Tier C personal scope review; tax shown as a separate disclosure | `tests/facility-verify.test.ts`, browser tests; `08-commercial-tier-a.jpg` | Verified |
| 16 | Owner kill switch remains authoritative | `commercialTierConfig.numericEstimatesEnabled` false removes numeric prices, hours and discounts from UI, request, notification and server verdict | `tests/facility-verify.test.ts`; code review | Verified |
| 17 | Church discount is exact and reconcilable | 10% applies to the rounded cleaning subtotal; no upward re-round; `$145.00 − $14.50 = $130.50`; two-decimal display; Tier C shows the entitlement only | `tests/pricing-adjustments.test.ts`, `tests/facility-verify.test.ts`; `10-church-discount.jpg` | Verified |
| 18 | Church partnership checkboxes do not manipulate pricing | Optional checkboxes are not preselected, never affect price/discount and are not marketing opt-ins | `tests/browser/estimate-engines.test.mjs`; content review | Verified |

## 4. Pricing, discounts and tax

| # | Requested outcome | Correction shipped | Evidence | Status |
| --- | --- | --- | --- | --- |
| 19 | One owner-editable global factor | `globalEstimateFactor` in `src/config/owner-pricing.ts`, default `1.00`, supported `0.50–1.50`; invalid values fail closed to `1.00` | `tests/pricing-adjustments.test.ts`, `tests/owner-pricing.test.ts` | Verified |
| 20 | Global factor applies consistently | Applied to the pre-tax service subtotal after the single discount, never to travel or tax; shared by residential, STR, commercial and church | `tests/pricing-adjustments.test.ts`, `tests/facility-verify.test.ts`, `npm run estimate:scenarios` | Verified |
| 21 | Correct arithmetic order and no hidden round-up | Base/minimum → $5 base rounding → one discount → global factor → travel → cents; no reapplied minimum after discount/factor; factor-below-floor is flagged, not silently changed | `docs/operations/ESTIMATE-CALCULATION-ORDER.md`; unit/browser tests; scenario matrix | Verified |
| 22 | Tax is disclosed, not invented | Residential/STR host-billed: no sales tax; commercial: `+ applicable tax`; church: `+ applicable tax unless exempt` (DR-14); no numeric rate or amount fabricated | `src/lib/estimate/tax.ts`, `docs/operations/TAX-TREATMENT.md`, `tests/request-summary.test.ts`, browser tax tests | Verified |
| 23 | Two-decimal currency everywhere | Shared formatting for estimates, summaries, notifications and receipts; no `$14.5`-style values | `tests/browser/initiative-6.2-content.test.mjs`, `tests/request-summary.test.ts` | Verified |
| 24 | Server verification matches the browser | Server rebuilds the price, discount, factor, travel and final total; exact final/subtotal reconciliation; mismatches are review actions | `tests/facility-verify.test.ts`, `tests/estimate-engines.test.ts`, `tests/api-verification.test.ts` | Verified |

## 5. Page-level corrections

| # | Requested outcome | Correction shipped | Evidence | Status |
| --- | --- | --- | --- | --- |
| 25 | Service area page structure | Title → concise description → map; top ZIP CTA removed; “depending on distance” removed | `tests/browser/initiative-6.2-content.test.mjs`; `02-service-area-desktop.jpg`, `03-service-area-mobile.jpg` | Verified |
| 26 | Representative photo captions removed | Visible photo captions removed by owner direction; licensing records retained internally | Content/browser tests; homepage capture | Verified |
| 27 | Reviews premium and accurate | Larger 22px stars, stronger contrast, source label, first-name-only attributions; authentic Christina/Richard/Laura reviews only; no fabricated aggregate schema | `tests/browser/initiative-6.2-content.test.mjs`; `04-reviews.jpg` | Verified |
| 28 | Footer review actions | Exact owner copy; distinct **Read Our Reviews** (`/#reviews`, tracked) and **Leave Us a Review** (verified Google URL); Company nav no longer lists Reviews | `tests/browser/initiative-6.2-content.test.mjs`; `11-footer.jpg` | Verified |
| 29 | Values/verse cleanup | Mark 12:31 quotation and `, excerpt` references removed; approved quotations retained; Christian Values icon/copy intact | Content/browser tests; `01-home-desktop.jpg` | Verified |
| 30 | Premium icon redesign | Ten premium `v2-*` white/gold-on-rose tiles replace the old artwork; registry updated; no nested CSS chip/plate | `src/assets/icons/premium/`, `PremiumIcon.astro`; `05-premium-icons.jpg` | Verified |
| 31 | No promo popup blocking estimators | Promo popup suppressed on all estimator routes | `tests/browser/initiative-6.2-content.test.mjs`, `promo-popup.ts` | Verified |
| 32 | Mobile composition and overflow | Responsive grids/buttons/long labels corrected; zero overflow at 320/375/390/768/1440 | Layout audit; `12-home-mobile.jpg` | Verified |
| 33 | Accessibility | Visible focus, labelled fields, error summary, keyboard operation, mobile target sizes; no duplicate H1s | Accessibility browser tests; layout audit | Verified |

## 6. Data, privacy and operations

| # | Requested outcome | Correction shipped | Evidence | Status |
| --- | --- | --- | --- | --- |
| 34 | No sensitive data in analytics | Consent-gated analytics; no names, emails, phones, addresses, ZIPs, photos, notes or form content sent; only allowlisted event parameters | `tests/browser/analytics-events.test.mjs`, attribution tests | Verified |
| 35 | Attribution is preserved correctly | First-touch captured once; campaign context forwarded through the new route; same-domain referrers are not referrals; lead labels separated | `tests/browser/attribution.test.mjs`; browser journey tests | Verified |
| 36 | Owner notification and customer receipt agree | Discount, global factor, travel, tax disclosure and final total rendered consistently; server-owned fields | `tests/request-summary.test.ts`, `tests/api-verification.test.ts` | Verified |
| 37 | Tax guidance is sourced, not invented | Florida DOR references recorded; no fabricated rate; category-specific disclosure only | `docs/operations/TAX-TREATMENT.md` | Verified |
| 38 | GTM full event set documented | 19 event mappings incl. church and promotion events; import/verification docs updated | `docs/analytics/GTM-CONTAINER-SETUP.md`, `npm run analytics:gtm:verify` | Verified |
| 39 | GTM Version 5 | Owner reports Version 5 published (20 tags, 19 triggers, 13 variables); new-event receipt not fully proven | Owner report 2026-10-25; docs updated | Owner-reported / pending receipt verification |
| 40 | Photo intake is finished and safe to activate | Shared intake, metadata stripping, signed owner links and cleanup are implemented; the section remains hidden until the probe returns `enabled:true` and no mock upload is reported as production | Photo suites; `docs/operations/PHOTO-UPLOADS.md` | Implemented; production activation pending R2 |
| 41 | Owner independence | Owner settings guide, calculation order and tax doc identify where to change values, dependencies, approval needs and rebuild steps | `docs/operations/OWNER-SETTINGS-GUIDE.md`, `ESTIMATE-CALCULATION-ORDER.md`, `TAX-TREATMENT.md` | Verified |
| 42 | Deployment gate | Branch is local; production remains 6.1; no push/merge/deploy performed | `git status`, `git log`; this document | Verified local-only |

## 6b. Completion correction (2026-10-25 owner directive)

| # | Requested outcome | Implementation | Evidence | Status |
| --- | --- | --- | --- | --- |
| 43 | One shared photo intake for all four engines | `PhotoUploadSection.astro` + `photo-uploads.ts`; engine-specific categories and copy | `tests/browser/photo-upload.test.mjs`; `13-photo-upload-commercial.jpg`, `14-photo-upload-church.jpg`, `15-photo-upload-mobile.jpg` | Verified |
| 44 | Multiple photos, thumbnails, filenames, remove/replace, progress, persistence | Controller state outside the DOM; progress/status; remove and replace controls; Back/Continue test | Browser photo suite | Verified |
| 45 | iPhone HEIC/HEIF handling | Real CC0 HEIC fixture converted to JPEG in Chromium via `heic2any`; conversion failure gives explicit iPhone instructions; raw HEIC rejected server-side | `tests/photo-client.test.ts`, browser photo suite, `tests/photo-format.test.ts` | Verified |
| 46 | Private storage and server-side metadata stripping | Private R2 binding; magic-byte validation; JPEG APP1/APP13/COM, PNG text/EXIF and WebP EXIF/XMP removal; opaque server keys | `tests/photo-format.test.ts`, `tests/photo-intake.test.ts`; local R2 smoke | Verified (code/local R2) |
| 47 | Secure owner access and retention | HMAC-signed, time-limited links (90-day default); authenticated cleanup endpoint; no public object URLs | `tests/photo-intake.test.ts`, `docs/operations/PHOTO-UPLOADS.md` | Verified |
| 48 | Correct attachment association and honest notifications | `/api/lead` validates request prefix + R2 `head`/`get`; owner notification carries real MIME attachments through Resend; count/links are retained; customer summary uses server-verified count | `tests/photo-intake.test.ts`, `tests/owner-email.test.ts`, `tests/request-summary.test.ts` | Verified (provider acceptance pending real e2e) |
| 53 | Owner attachment email provider | Web3Forms free has no attachments; existing Resend account supports attachments on its free tier, so no new account/DNS/cost is needed. Web3Forms remains the links-only fallback | `docs/operations/PHOTO-UPLOADS.md`, `docs/deployment/DEPLOYMENT.md` | Verified decision; production key/inbox e2e pending |
| 54 | Handle 6 photos and 32 MB / Base64 / inbox limits without omission | 21.5 MB Base64 per email, numbered `[Photos n/N]` emails sharing the request ID, full summary + all links in every part; six 8 MB photos → up to 3 emails | `tests/owner-email.test.ts` | Verified |
| 55 | Retries, duplicate prevention and honest status | One retry on retryable provider/network errors, stable `Idempotency-Key`, `accepted`/`partial`/`failed`/`not_configured` statuses, Web3Forms fallback with failure note | `tests/owner-email.test.ts`, `tests/photo-intake.test.ts` | Verified |
| 49 | Turnstile and abuse controls | Optional Turnstile verification, per-IP throttle, same-origin, count/size/total limits | `tests/photo-intake.test.ts` | Verified |
| 50 | Commercial calibration | 26 scenarios covering sizes, types, fixtures, conditions, floors, schedules, travel and specialty; report + CSV | `npm run commercial:calibration`, `npm run calibration:report`; `FACILITY-CALIBRATION.md` | Verified |
| 51 | Church calibration | 20 scenarios; exact 10% discount to the cent, global factor, tax disclosure, Tier A/B/C, browser/server reconciliation | `tests/facility-calibration.test.ts`; `FACILITY-CALIBRATION.md` | Verified |
| 56 | Real R2 activation | Source/bindings/owner actions complete. No Cloudflare credentials in this environment; a local Pages/R2-compatible Miniflare upload and signed retrieval passed, but the real production bucket is **not provisioned** | `docs/operations/PHOTO-UPLOADS.md`; local smoke evidence | Pending external owner action |
| 57 | Production attachment e2e | A real production Resend send with a real inbox receipt was not possible: no `RESEND_API_KEY` is available locally and no deployment is authorized | This document; deployment checklist | Blocked on owner-run live test |
| 58 | Optional facility date bug found during acceptance | Step 3 required a preferred date despite the rule being optional; `optional: true` added and browser flow now advances without one | Browser photo suite (advances without a date) | Verified |

The photo feature is **implemented and tested**, but the production section remains hidden
until the private R2 binding and `PHOTO_OWNER_TOKEN` exist. This is the one genuine external
dependency, not a deferred implementation.

## 7. Verification commands and actual results

| Command | Result |
| --- | --- |
| `npm run check` | Passed — 0 errors, 0 warnings, 0 hints |
| `npm test` | **489 tests: 488 passed, 1 skipped, 0 failed** (the skip is the print-output test when no print build exists) |
| `npm run test:browser` | **124/124 passed** (including the new photo intake suite) |
| `npm run verify` | Passed: 0 diagnostics, 26 pages built, 1,670 internal links, SEO and GTM/QR checks |
| `npm run smoke` | Passed across 21 required pages |
| `npm run pending` | Passed: no PENDING placeholder facts across 30 built files |
| `npm run testimonials` | Passed: no fake testimonial or fixture markers |
| `npm run audit:facts` | No unsupported factual claims; 15 terms flagged for human context review |
| `npm run commercial:calibration` | Passed: **26 commercial + 20 church** hypothetical scenarios; exact church discount/reconciliation checks |
| `npm run calibration:report` | Generated `FACILITY-CALIBRATION.md` and full-field CSV |
| `npm run analytics:gtm:verify` | Passed: generated GTM import artifacts match |
| `npm run estimate:scenarios` | Ran successfully; representative residential, STR, commercial and church scenarios printed |
| Layout audit | 0 overflow, broken-image or duplicate-H1 issues across 22 routes × 320/375/390/768/1440 |
| `git diff --check` | Only CRLF normalization warnings on `src/scripts/facility-estimate.ts` and `tests/browser/service-matrix.test.mjs`; no whitespace errors |

These results are from the final local verification run on the release candidate, before commit.
The 6.2 visual evidence is from the same local production build, not live production.

## 8. Deliberately not claimed

- 6.2 is **not live**. The screenshots are from the local production build.
- GTM Version 5 is **owner-reported**, not independently verified; new church/promotion event
  receipt still needs GA4 DebugView/Realtime confirmation.
- Commercial/church pricing remains provisional in customer language, but the **initial research
  calibration is complete** (26 commercial + 20 church scenarios); actual jobs are a quality check,
  not a blocker.
- Customer photo intake code is complete, but the production R2 bucket/token are **not provisioned**;
  the section stays hidden until they are. A local R2-compatible smoke test passed.
- No booking, payment or automatic scheduling is active.
- No fabricated reviews, customers, certifications, prices, tax rates or response guarantees were
  added.

# Automation register

What actually runs by itself, what is manual, and how each failure is recovered. Nothing is
described as automated here without a trigger and a source in the repository. Update this
register when an automation is added or removed.

Last reviewed: **2026-10-08**.

## Automatic

| Automation | Trigger | Source | What it does | Failure behavior / recovery |
| --- | --- | --- | --- | --- |
| CI validation | Push to `main`, any pull request | `.github/workflows/validate.yml` | `npm ci` → `npm run check` → `npm test` → `npm run build` → `npm run validate` → `npm run smoke` → testimonial detector → no-fabrication audit | The run goes red; the work is not deploy-blocking by itself. Fix locally, rerun `npm run verify`, push again. |
| Cloudflare Pages deployment | Push to `main` | Cloudflare dashboard Git integration | Builds `npm run build`, publishes `dist/`, deploys `functions/` as Pages Functions | A failed build leaves the previous deployment serving. Check the build log, fix forward; dashboard rollback is available. Project is live at `https://sparkling-standard.com`. |
| Consent-gated analytics | Visitor allows analytics, then performs a tracked action | `src/components/BaseHead.astro`, consent controller, `src/lib/analytics/` | Loads the GTM container (`GTM-KSQ26HMG`) and Umami, emits fixed-name events into `window.dataLayer`; the container's GA4 event tags for `G-LG222LQRQ2` come from the prepared package (`docs/analytics/GTM-CONTAINER-SETUP.md`) | Nothing loads or is replayed before consent. If IDs are unset, the services and consent UI stay hidden. If the container has no tags yet, events are generated but GA4 receives nothing — see the setup guide. |
| Lead relay | Form submit | `functions/api/lead.ts` → Web3Forms | Validates, spam-checks and forwards the inquiry to the owner inbox | `503 not_configured` → client falls back to the direct public-key path; if that is also unconfigured, an honest error with call/email alternatives is shown. Provider rejection is never reported as success. |
| Customer confirmation email | Owner notification accepted | `functions/api/lead.ts` → `src/lib/forms/customer-email.ts` → Resend | Sends the branded "We received your Sparkling Standard request" email to the customer's submitted address | Inert until `RESEND_API_KEY` is set and the sending domain is verified (`docs/deployment/DEPLOYMENT.md` §4a). A failure is logged server-side without PII and never fails the lead; the on-page thank-you summary is always immediate. |
| Travel lookup | Estimator ZIP entry | `functions/api/travel.ts` | Returns route distance + Gulf Coast gasoline reference | Missing/failed providers fall back to straight-line distance (`straight_line_estimate`) or zone mode; the estimate never breaks because of travel data. |

## Manual (no automation exists)

| Work | How |
| --- | --- |
| Marketing UTM docs + QR generation | `npm run marketing:links` (docs are byte-compared by `npm run validate` — regenerate after registry changes) |
| Brand raster generation | `node scripts/generate-brand-images.mjs` after mark/name changes |
| Deployment secret packaging | `npm run deploy:secrets` → `npx wrangler pages secret bulk deploy/secrets.env` |
| IndexNow submissions | `node scripts/indexnow.mjs` after launch (no workflow configured; key required) |
| Estimator recalibration | `docs/operations/ESTIMATOR-CALIBRATION.md` — after the first ~10 jobs |
| Pricing approval / rate changes | `docs/launch/PRICING-PROPOSAL.md` + owner approval; `src/config/pricing.ts` |
| Content publishing, GBP posts, social posting | Manual owner work |
| Lead follow-up | Manual owner work; no CRM |
| Review requests / referrals | `docs/marketing/REVIEW-GROWTH-SYSTEM.md`, `docs/marketing/REFERRAL-PROGRAM.md` |
| Weekly scorecard | `docs/marketing/WEEKLY-SCORECARD.md` |
| Production launch approval | `business.launch.productionApproved` + removing `PUBLIC_PREVIEW_MODE` (`docs/deployment/DEPLOYMENT.md` §11) |

## Rules

- Never describe something as automatic unless its trigger and source are listed above.
- A stored credential is not a connected integration; status belongs in
  `docs/operations/PLATFORM-STATUS.md`.
- No automation may send PII to analytics; lead data flows only to the owner inbox.
- No automation may bypass the owner approval gate for production.

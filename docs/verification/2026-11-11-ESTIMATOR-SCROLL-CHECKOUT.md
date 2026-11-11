# Estimator scrolling and checkout UX repair (2026-11-11)

## Release

- Application code: `bad5d8f`
- Branch: `production-safe` (with `main` synchronized on the same commit)
- Cloudflare Pages production deployment: `02f613a7-3a51-48bf-8bbd-9d82d3fca581`
  (source `bad5d8f`).
- GitHub `validate` (including the browser job) passed on both `main` and
  `production-safe` (runs `43082861407` and `43082857488`).
- No migration and no database schema change.

## A. Scroll behavior

### First-page location confirmation

**Actual cause:** confirming a manual/GPS location hides the manual fields and GPS
panel, replaces them with the compact confirmed card, and can hide the map. That
large document-height change happened while the customer was scrolled to the
confirmation button. Chromium's scroll anchoring (and mobile browser viewport
changes) then repositioned the page below the next question. The previous test
only measured a small absolute scroll delta, so it did not catch the customer
landing below the availability section.

**Exact fix:** after a successful confirmation (when the wizard is not in the
special address-verification return flow), the wizard waits two animation frames
for the collapse to settle and re-anchors once to the availability section (the
next question), falling back to the confirmed card. The shared scroll helper
accounts for the sticky header with a larger safe offset. No fixed spacer or
device-specific timeout is used. The address and all answers are preserved.

**Next-page scrolling:** every successful step transition targets the new step
heading (not a decorative page top), dismisses the mobile keyboard, scrolls
immediately, and performs one layout-settled correction. A shared scroll-intent
counter prevents the correction from overriding a newer scroll, such as the
Deep Cleaning notice. Back, Reschedule and step-jump navigation use the same
controller. The initial page load is never moved.

**Final-step visual:** the existing five-second calculation reveal is preserved.
Entering Step 5 now targets the reveal stage, so the visual is framed below the
sticky header on mobile. When the reveal finishes, the estimate and appointment
content are already positioned. The reveal plays once per questionnaire visit;
returning to Step 5 (including after Reschedule) does not replay it. Reduced
motion shortens the reveal, and the final content remains readable.

### Browser evidence

- iPhone-sized `390×844` and small Android `360×800` viewports confirm the
  availability section is visible below the sticky header after address
  confirmation.
- Mobile, tablet and desktop step transitions keep the active step visible.
- The final reveal is visible in the viewport when it starts, completes without
  another scroll, and does not replay after leaving and returning.

## B. Promotions

- One shared **Apply Discounts & Gift Certificates** button now sits below both
  code fields. The separate promo-only Apply control was removed.
- A valid promo updates the entire acknowledgement immediately: the promotion
  line appears in the itemized estimate with a high-contrast saving treatment,
  the total changes, and the page scrolls to the updated summary.
- A valid but smaller code never replaces a better existing or already applied
  offer. The customer sees: “Your existing … offer saves you more, so we kept it
  applied.”
- Invalid codes keep the customer at the field with a specific message, do not
  change the total, and do not scroll to the totals.
- Removing a code and applying again removes only that reduction. Empty fields
  are not required to be full.
- Static campaign claims (SPARKLE15) and dynamic database promotions travel in
  separate server-owned inputs. This prevents typing another code from
  accidentally deleting the campaign discount during server verification.

## C. Gift certificates

- Gift and promo codes validate together. Either may be supplied alone.
- The itemized estimate presents the gift reduction first and the promotional
  reduction second, followed by the updated amount due.
- **Financial order:** the eligible promotion reduces the authorized cleaning
  subtotal, applicable tax is calculated on that result, and stored gift value
  is applied as payment tender against the payable amount. Gift value is never
  treated as promotional revenue reduction and never changes its own face value.
- `gift_apply_amount` remains bounded by the available balance and the amount
  due. The server reserves value only after checkout is claimed; Apply alone
  never redeems. Existing reservation, commit, expiry-release and duplicate
  protections remain unchanged.
- The customer receipt now distinguishes the gift tender, card amount and total
  paid. A fully gift-covered cleaning still completes without a card charge.

## D. Verification

- `npm run check`: 0 errors, 0 warnings, 1 pre-existing hint.
- `npm test`: 856 tests, 855 pass, 1 pre-existing skip.
- `npm run test:browser`: 214 tests, all pass.
- `npm run build`, `npm run validate`, `npm run smoke`: pass.
- New focused coverage: address-confirmation anchoring at two mobile sizes,
  all step transitions, final reveal framing/completion/no-replay, promo-only,
  invalid promo, best-of non-stackable offers, combined promo + gift, gift
  removal, checkout best-discount replacement, gift-before/after-promotion
  ordering, and receipt tender separation.
- No live charge, refund, gift redemption or customer record was created.

## E. Outstanding work (unchanged)

- Global admin branch selector and legacy NULL-branch backfill approval.
- Documents screen redesign/Word conversion.
- Complete one-click encrypted D1/R2 archive.
- Optional recurring autopay consent/SetupIntent flow.
- Owner-approved legal templates and live Stripe/Calendar write verification.

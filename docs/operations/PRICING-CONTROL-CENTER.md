# Pricing & Estimator Control Center

Owner-operated pricing administration for all four estimate engines. The
owner can inspect every supported pricing value, edit a draft, simulate the
effect with the real calculators, publish a validated version, review history
and restore an older version — without a code change or redeploy.

**Owner entry point:** `/admin/` → **Pricing & Estimator Control** (owner-level
`settings.write` permission).

## What is controlled

| Area | Examples |
| --- | --- |
| Labor rates and minimums | recurring/one-time labor-hour rates, owner target, minimum job |
| Residential and STR labor | base hours, square footage, baths, bedrooms, beds, condition, history, frequency |
| Extras | each non-specialty add-on's labor hours and optional fixed price |
| Bundles and discounts | the enabled add-on bundles, their discount fractions and caps; the three-extra bundle; Community Support and church discount values |
| Commercial and church | labor-hour rate, production rates, fixture/breakroom/setup minutes, first-clean factor, tier limits, Tier B spread |
| Presentation | estimate range factors and the final rounding step |
| Travel economics | included miles, MPG, wear per mile, fallback fuel price, driving-time boundary/review band, distance cap |

The catalog lives in `src/lib/pricing/catalog.ts`. It is an **allow-list**:
paths are resolved against a pricing snapshot, never executed. Unknown keys are
ignored; add-on ids, custom-quote flags, labels, campaign code/legacy terms and
other structural identity are restored from the source configuration.

**Not controlled here (by design):**

- Tax. Tax is calculated at checkout from the verified service address by the
  tax engine; it is not a promotional rate.
- Employee wages and pay classification. Those remain in the staff/payroll
  configuration and never change when customer prices change.
- Booking, invoice, payment and refund amounts already created. Historical
  quotes and financial records keep their original amounts and fingerprints.
- Campaign popup/terms copy. The SPARKLE campaign remains source- and
  terms-controlled until dynamic campaign presentation is implemented; it is
  deliberately not editable in this tab.
- Calculation structure (how hours, discounts, rounding and travel are
  composed). Only safe numeric parameters are exposed.

## Zero-regression baseline

Source-controlled pricing remains the default. Until the first version is
published, `GET /api/pricing` returns the source baseline
(`source: true`) and every calculator behaves exactly as before.

`tests/pricing-control.test.ts` contains golden-master assertions for all four
engines, including recurring first-visit/ongoing pricing, condition, extras,
travel, the minimum, church discount and facility tiers. A source snapshot
must reproduce those values and the existing `PRICING_CONFIG_VERSION`.

## Architecture

- **Snapshot** — `{ owner, travel }`, normalized and validated by
  `src/lib/pricing/snapshot.ts`.
- **D1** — `pricing_versions` (migration `0026_pricing_control.sql`). Drafts
  are editable; published versions are immutable; at most one row may be
  published (partial unique index).
- **Store** — `src/lib/pricing/store.ts`: create/save draft, publish,
  rollback, discard and history. Publishing archives the previous version and
  activates the new one in one D1 batch. Rollback appends a **new** version
  from an older snapshot; history is never rewritten.
- **Shared engines** — a published snapshot is rebuilt into the same typed
  pricing configuration (`buildPricingConfig`) and passed explicitly to the
  shared calculators. There is no second pricing algorithm.
- **Browser** — estimator pages call `loadPublishedPricingOnce()`, activate
  the published snapshot and re-run the current calculation. If the endpoint
  is unavailable the source baseline stays active.
- **Server** — `/api/lead`, `/api/estimate-checkout` and facility verification
  load a request-scoped configuration from the published row and pass it into
  the same engines. A request is never authorized by a client-supplied price
  or config version.
- **Simulator** — `src/lib/pricing/simulate.ts` runs the real residential/STR
  or facility engine for both published and draft snapshots. It creates no
  lead, hold, booking, payment, email, customer record or calendar event and
  does not mutate the active configuration.

## Concurrency and safety

- Draft saves use optimistic concurrency (`expectedUpdatedAt`); a stale tab
  receives `pricing_draft_conflict` rather than overwriting newer edits.
- Publishing re-validates the stored snapshot at the publication boundary.
- The single-published partial unique index protects against two concurrent
  publishes.
- Pricing APIs require an authenticated owner session, the `settings.write`
  permission and a CSRF token. Every mutation is written to `admin_audit`.
- A corrupt/unavailable published row falls back to the source baseline for
  public calculations; the quote's config fingerprint then differs and the
  server reports a preliminary/mismatch verdict instead of trusting a price.

## Owner workflow

1. Open **Pricing & Estimator Control**.
2. Click a value and read its unit, effect and example.
3. Watch the simulator compare **Published** and **Draft**.
4. **Save draft** — customer prices do not change.
5. **Publish draft** — new estimates use the new version immediately.
6. To undo, open **Version history** → **Restore** an earlier version. This
   creates a new published version; nothing is erased.

Discount percentages and enabled switches can change the estimate immediately.
Public Terms and marketing copy are separate documents; review them before
changing a published discount. Campaign popup copy remains a site release.

## Verification commands

```text
node --test tests/pricing-control.test.ts
node --test tests/browser/admin-pricing.test.mjs
npm test
npm run check
npm run build
npm run validate
npm run test:browser
```

## Deployment notes

- Migration `0026_pricing_control.sql` is additive (new table/indexes only).
- No pricing row is required for the site to operate; the source baseline is
  the safe default.
- The public endpoint is `/api/pricing`; it returns the active snapshot or the
  source fallback and is marked `no-store`.
- Never replace the whole Cloudflare deployment configuration to add a binding
  or secret. The pricing system uses the existing `DB` binding only.

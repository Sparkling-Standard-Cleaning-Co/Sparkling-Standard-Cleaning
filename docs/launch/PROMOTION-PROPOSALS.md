# Promotion proposals — owner decision package

**Status: ALL PROGRAMS DISABLED.** Nothing in this document is published or active. The
promotion engine (`src/lib/estimate/promotions.ts`) ships with every program `enabled: false`
and `value: null`; a program with no approved value can never apply. Enabling any program
requires explicit written owner approval of exact terms **and** a `pricing.instantQuote.configVersion`
bump so old quotes cannot be silently reused under new rules.

Regenerate the numbers any time with:

```bash
npm run promotions:impact      # proposed-program financial model (this document)
npm run estimate:discount-impact   # existing multi-add-on incentive model
```

## Safeguards enforced by the engine (not the UI)

- **One promotion per quote.** The engine evaluates every enabled program and applies only the
  single largest effective discount. No stacking with each other or with the existing
  multi-add-on incentive.
- **Owner-gated and term-gated.** `enabled: false` or `value: null` means never applied.
- **Minimum-job floor always wins.** A discount can never take a quote below $125.
- **Specialty work is excluded.** Custom-quote add-ons and travel are never part of a discount
  base; the base cleaning price is never discounted by a bundle.
- **Expiry enforced.** An expired or malformed date fails closed.
- **Customer-kind fail-closed.** The flow cannot yet prove “new” vs “established” customer, so
  programs requiring that proof cannot apply automatically. This is deliberate: no browser state
  or unverified lead count ever grants a discount.
- **Frontend = backend.** The same evaluator runs in the browser calculation and the server-side
  quote verification.

## Founding 10 — three prepared mechanisms (none chosen)

The program config supports exactly these mechanisms; the owner picks one. Capacity is
**owner-manual**: `capacity.enforcement: 'owner_manual'`, `awardedCount: null`. The website must
never claim “3 spots left” or any live availability. Every enrollment is reserved by the customer
and approved by the owner. A genuinely enforceable automated cap would need infrastructure the
business does not have at zero cost, so the truthful mechanism is approval-based.

Representative model: maintained 1600 sq ft 3/2 standard home, internal owner labor target
$35/labor-hour. “Contribution” means price minus the owner labor floor — it does **not** yet
subtract supplies, vehicle wear/gas beyond the embedded travel adjustment, insurance, software or
taxes (unknown per-job values, deliberately unmodeled).

### Mechanism 1 — one-time first-cleaning discount (modeled: 15%, cap $40)

| | Before | After |
| --- | --- | --- |
| Price (one-time standard) | $250.00 | $210.00 |
| Labor hours | 4.91 h | 4.91 h |
| Owner labor floor | $171.85 | $171.85 |
| Contribution above floor | $78.15 | $38.15 |
| 12-month revenue (1 visit) | $250.00 | $210.00 |

Strength: simple, understandable, immediate incentive to try the service. Weakness: the entire
concession comes out of first-visit contribution and pays only if the customer converts to
recurring. Best paired with a stated conversion expectation.

### Mechanism 2 — ongoing discount for qualifying recurring customers (modeled: 10%, cap $25, 6 months)

| | Before | After |
| --- | --- | --- |
| Per-visit price (biweekly) | $200.00 | $180.00 |
| Labor hours | 4.66 h | 4.66 h |
| Owner labor floor | $163.26 | $163.26 |
| Contribution above floor | $36.74 | $16.74 |
| 12-month revenue (26 visits) | $5,200.00 | $4,680.00 |

Strength: directly builds the recurring base (the primary business objective) and the discount is
time-boxed, so contribution recovers to full rate after six months. Weakness: the largest annual
concession of the three ($520 modeled), so it needs a retention assumption the business cannot
prove yet.

### Mechanism 3 — complimentary upgrade / add-on (modeled: oven interior, ~$30–35 value)

| | Before | After |
| --- | --- | --- |
| Price (one-time standard + oven) | $280.00 | $250.00 (add-on waived) |
| Labor hours | 5.51 h | 5.51 h |
| Owner labor floor | $192.85 | $192.85 |
| Contribution above floor | $87.15 | $57.15 |
| 12-month revenue (1 visit) | $280.00 | $250.00 |

Strength: showcases the detail standard (“the difference”) instead of leading with a price cut;
the customer receives genuine value. Weakness: it costs real scheduled labor (0.6 h here) with no
added revenue, and must exclude specialty/custom-quote work by design.

**Owner decision required:** choose one mechanism (or none) and supply the exact value, cap, expiry
and qualifying frequency list. Until then the mechanism stays `null`.

## Appreciation discounts (returning / loyal customers)

Prepared program: `appreciation-established-recurring` — percent or fixed, any eligible service and
frequency, applies to the visit total, internal cap, explicit expiry, non-stackable, and requires
a proven established recurring customer (fails closed today).

Modeled at 8% (cap $20) on the biweekly home: price $200.00 → $185.00, contribution above the
labor floor $36.74 → $21.74, 12-month revenue $5,200 → $4,810. The alternative prepared program
(`appreciation-referral-welcome`) is a fixed credit on a new customer's first visit; it also fails
closed until the first-customer question exists.

## Add-on bundles

Prepared bundles (all disabled, no values):

| Bundle | Requires | Proposed form |
| --- | --- | --- |
| `bundle-kitchen-refresh` | Inside refrigerator + inside oven | % off the eligible add-on subtotal, cap, expiry |
| `bundle-recurring-care` | Bed linen change + dishes | % off eligible add-ons, weekly/biweekly only |

Modeled kitchen bundle at 8% (cap $20): price $305.00 → $300.00 (eligible add-on subtotal $55,
discount $5, then the $5 round-up absorbs part of it). Bundles reward profitable add-on purchases
and, for the recurring-care bundle, reinforce retention. Because only **one** promotion applies,
a bundle never stacks with the existing multi-add-on incentive — the engine picks whichever gives
the customer the larger effective reduction.

## Remaining business decisions

1. Which Founding 10 mechanism (if any), with exact value, cap, frequency list and expiry.
2. Appreciation discount terms: who qualifies, how much, cap, expiry.
3. Bundle terms: which combos, percentage/fixed value, caps, expiry.
4. Whether any promotion should ever coexist with the proposed multi-add-on incentive (current
   engine: no — single promotion only).
5. How the owner will track Founding enrollments (owner-manual list) and what the customer-facing
   wording should say; **never** a live slot count until real tracking exists.
6. Supplies/overhead per-job figures if margin is to be modeled beyond the owner labor floor.
7. Approval of the required `configVersion` bump at activation time.

## Activation checklist (per program)

- [ ] Owner approves exact written terms (value, cap, eligibility, expiry).
- [ ] Terms recorded in `src/config/owner-pricing.ts`; `enabled: true` set in the same change.
- [ ] `pricing.instantQuote.configVersion` bumped.
- [ ] `npm run promotions:impact` reviewed; floors verified for representative homes.
- [ ] Customer-facing copy reviewed (no guarantees, no “limited slots” claims).
- [ ] `npm test`, `npm run verify` and the browser suite green before publication.

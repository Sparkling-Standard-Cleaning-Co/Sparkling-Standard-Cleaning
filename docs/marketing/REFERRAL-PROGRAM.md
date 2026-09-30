# Referral program (design only — no active offer)

No discount, credit or reward is promised to anyone until the owner approves exact terms.
This document defines the **architecture**, so activating the program later is a config and
copy change, not a redesign.

## Why referrals matter here

Recurring residential and STR work spreads neighbor-to-neighbor. A referral card handed to a
happy customer costs nothing and carries the strongest possible endorsement: the detail work a
neighbor can see.

## Status

| Item | Status |
| --- | --- |
| Referral card QR (`public/marketing/qr/referral-card.svg`) | Ready (attributed link) |
| Referral program terms | **NOT APPROVED — owner decision required** |
| Reward mechanics published anywhere | None (correct — do not invent) |

## Options for the owner to choose from (pick one, formalize it)

1. **Simple thank-you:** a fixed service credit for the referring customer after the referred
   job completes (e.g. a defined dollar amount off their next clean). Easy to explain.
2. **Both-sides:** smaller credit for the referrer and a first-clean credit for the new
   customer. Stronger conversion, slightly more admin.
3. **Recurring-focused:** referrer receives a credit only when the referred home books
   recurring service — incentivizes the highest-value behavior.

Whatever is chosen: define it in `src/config/pricing.ts` (or a dedicated referrals config),
state it plainly in the FAQ, and never advertise anything before that change lands.

## Operational rules (when active)

- Track referrals in the lead record (`referral_source` field) and in the weekly scorecard.
- A referral reward is granted **after the referred job is completed and paid**, not at booking.
- Never tie a referral reward to leaving a review, and never incentivize reviews.
- Referral cards are handed over personally (best) or left as a completion-card item —
  never left on doors in bulk unless the neighborhood campaign is explicitly approved.

## Placement

- Hand a card to every happy customer after service (permission is implied by handing them a
  card — but never attach it to a review request).
- QR resolves through the tracked referral link in `src/config/marketing-links.ts`
  (`referral_card_qr`), so attributed referrals land in the scorecard.

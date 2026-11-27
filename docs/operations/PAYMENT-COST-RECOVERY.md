# Payment processing cost recovery

**Status: investigation complete; not activated. No price, checkout, gift-certificate, or
payment behavior was changed by this review.**

Owner request: recover card-processing cost on gift certificate purchases and residential
checkout without reducing the gift certificate value and without an undisclosed or blanket card
surcharge.

## Current behavior (verified in source)

- Gift certificates are sold at face value (less any approved promotion). The checkout metadata
  stores the face value separately (`gift_value_usd`), and the verified webhook issues a
  certificate for the full face value. Processing cost is currently absorbed by Sparkling
  Standard.
- Residential checkout recalculates the exact quote server-side, applies promotions and gift
  credit, creates a Stripe-hosted Checkout Session for the remaining card amount, and reconciles
  the verified webhook, receipt, ledger, and booking records. Processing cost is currently
  absorbed by Sparkling Standard.
- No card surcharge, convenience fee, or processing-fee line exists in production.

## What the current law and network rules require

This is an engineering summary, not legal or tax advice. Florida/Alabama counsel and the
owner's tax adviser must confirm the final position before any customer charge changes.

### Florida

- Florida Statutes § 501.0117 still prints a prohibition on credit-card surcharges. In
  *Dana's Railroad Supply v. Attorney General*, 807 F.3d 1235 (11th Cir. 2015), the Eleventh
  Circuit held that prohibition unconstitutional; the Supreme Court denied certiorari in 2017.
  The statute has not been repealed. Secondary compliance summaries report that the Florida
  Attorney General's consumer guidance acknowledges the court decision, but the current
  enforcement position and any disclosure obligation should be confirmed by Florida counsel.
- Florida's 2026 food-service operations-charge rule (Fla. Stat. § 509.214) does not apply to a
  cleaning company, but it confirms the state's direction toward prominent advance disclosure of
  automatic charges.
- Debit and prepaid cards cannot be surcharged under the card-network rules, regardless of how
  the terminal or online form labels the transaction.

### Alabama

- No Alabama statute limiting merchant credit-card surcharges was identified. Card-network rules
  therefore control.
- Effective September 1, 2026, Alabama SB 221 / Act 2026-587 excludes a separately identified
  credit-card transaction fee from the sales and use tax base. The fee must be separate and
  identifiable on the receipt. This tax rule does **not** authorize surcharging debit or prepaid
  cards; the card-network prohibition still applies.

### Visa (U.S.)

- Credit cards only. Debit and prepaid cards can never be surcharged, including a debit card
  processed as "credit."
- The surcharge may not exceed the merchant's applicable merchant discount rate or 3%, whichever
  is lower.
- Written notice to the acquirer is required at least 30 calendar days before the surcharge is
  announced or first charged, whichever is earlier. The surcharge must be identified in the
  transaction data (Field 28) and enabled by the acquirer.
- Disclosure is required at the point of entry, at the point of sale/checkout before payment, and
  as a separate line on the receipt. The customer must be able to cancel or choose another
  payment method after seeing the surcharge.
- The surcharge must be applied consistently (brand-level or product-level, not both), and a full
  refund must return the surcharge; a partial refund must return a pro-rata share.

### Mastercard (U.S.)

- Credit cards only. Debit and prepaid cards cannot be surcharged.
- A brand-level surcharge may not exceed the merchant's average effective Mastercard credit
  merchant discount rate or 4%, whichever is lower. Product-level surcharges have a separate
  cost-based calculation.
- Advance notice to Mastercard and the acquirer is required (at least 30 days under the published
  merchant guidance). Competing-brand conditions and state law still apply.
- Clear disclosure is required at all customer touchpoints, and the surcharge must appear
  separately on the receipt.

### Practical cap

Stripe's published standard U.S. online card rate is **2.9% + $0.30** per successful domestic
transaction (checked November 2026). On a $100.00 card payment the cost is $3.20 (3.20%), but
Visa's absolute ceiling is 3%. A uniform 3% surcharge recovers at most $3.00 on a $100.00
payment and still leaves $0.20 of the standard cost with the business. The owner's actual
effective rate must be read from the Stripe Dashboard/account statement before any calculation
is frozen; international cards (+1.5%), manually entered cards (+0.5%), currency conversion
(+1%), and disputes ($15 each) are separate.

## Stripe capability finding

The existing architecture uses **Stripe-hosted Checkout Sessions** with a server-fixed line-item
amount. That flow does not expose the card's funding type (credit, debit, prepaid) before
authorization, so it cannot safely apply a credit-card-only surcharge.

Stripe's current surcharge options are:

1. **PaymentIntent surcharge API (public preview).** The server adds a surcharge to the
   PaymentIntent after the PaymentMethod is attached and card funding is known. This requires a
   preview API version, a different payment integration, new disclosure and cancellation steps,
   and server-side card-funding checks.
2. **Checkout automatic surcharge (private preview).** Stripe calculates the surcharge after the
   customer enters card details, but the feature is in private preview, requires a preview API
   version, and requires installing a third-party surcharge provider app (currently Yeeld or
   InterPayments) from the Stripe App Marketplace. Sparkling Standard would depend on that
   provider's calculation and onboarding.

Either option is a substantial payment-architecture change, not a configuration toggle. It would
also require 30-day acquirer/network notices, legal review, revised checkout disclosures,
receipt changes, refund logic, and a debit/prepaid exclusion test before production activation.
It is therefore **not implemented** and **not activated**.

## Alternative prepared for owner approval: one advertised price that includes processing cost

This is the simplest compliant alternative. It does not describe the charge as a card surcharge;
it changes the advertised price of the product or service so the business nets the intended
amount after processing. Every customer sees the same price, and no card-type detection is
required.

### Gift certificates

Keep the certificate's face value intact and set the purchase price to face value plus the
processing cost. Example at the published Stripe standard rate (2.9% + $0.30), using the exact
gross-up `purchase = (face value + $0.30) / 0.971`, rounded up to the cent:

| Face value | Customer pays | Processing cost | Net to Sparkling Standard |
| --- | --- | --- | --- |
| $50.00 | $51.81 | $1.80 | $50.01 |
| $100.00 | $103.30 | $3.30 | $100.00 |
| $150.00 | $154.79 | $4.79 | $150.00 |
| $200.00 | $206.29 | $6.28 | $200.01 |

The purchase summary must show both numbers, for example:

- Gift value: **$100.00**
- Card processing included in price: **$3.30**
- Total due: **$103.30**

The certificate balance, redemption, activation, issuance, promotions, ledger, and webhook
verification remain unchanged. The processing amount is revenue to the business and must not be
recorded as certificate liability. A promotion should be defined against the face value first,
then the processing gross-up applied to the resulting card charge; the owner must approve that
order of operations before implementation.

This alternative needs owner approval of the exact price schedule and the wording. It has not been
implemented and no advertised gift-certificate price has changed.

### Residential checkout

The equivalent alternative is to include processing cost in the advertised residential prices
(or in a single clearly disclosed service price) rather than adding a card-specific fee at
checkout. That is a pricing change affecting the estimator, published prices, recurring rates,
quotes, agreements, invoices, and receipts. It needs a separate owner decision and must not
retroactively alter existing agreements or recurring prices. It has not been implemented.

## Deferred option: card surcharge

If the owner later wants a true card surcharge instead of advertised-price incorporation, the
minimum prerequisites are:

1. Written Florida/Alabama legal review of the current enforcement position and the exact
   disclosure wording.
2. Owner approval of a rate that never exceeds the lower of the actual cost of acceptance and the
   network cap (Visa 3%, Mastercard 4%; a uniform 3% is the practical ceiling), with a plan for
   the unrecovered fixed-cost remainder.
3. Acquirer and card-network notification at least 30 days before launch, plus Field 28/network
   enablement.
4. A Stripe-supported surcharge integration (automatic surcharge provider in private preview, or
   a PaymentIntent/Elements redesign) that identifies card funding before authorization and
   excludes debit/prepaid.
5. Updated disclosures at the website entry point, checkout, and receipt; a cancel/choose-another-
   method step; refund and partial-refund handling; and accounting separate from service revenue
   and gift liability.
6. End-to-end acceptance in Stripe test mode before any live charge, including a debit-card test
   that confirms no surcharge.

## Required owner decisions

1. **Immediate:** keep the current absorb-the-cost behavior (no customer fee), or approve the
   advertised-price alternative for gift certificates and/or residential services.
2. If the advertised-price alternative is approved: approve the exact gift-certificate price
   schedule, the purchase-summary wording, and whether promotions apply before or after the
   processing gross-up.
3. If a true card surcharge is desired: authorize legal review, Stripe/provider onboarding, the
   30-day notices, and the payment-integration work as a separately scoped project.

## Sources checked (2026-11-27)

- Florida Senate, 2026 Florida Statutes § 501.0117 and § 509.214.
- *Dana's Railroad Supply v. Attorney General*, 807 F.3d 1235 (11th Cir. 2015), cert. denied 2017.
- Alabama SB 221 (2026), Act 2026-587; Alabama Department of Revenue guidance on separately
  identified credit-card transaction fees (effective 2026-09-01).
- Visa, U.S. Merchant Surcharge Q&A and Visa Core Rules surcharge requirements.
- Mastercard, U.S. merchant surcharge rules and maximum surcharge cap.
- Stripe, published U.S. pricing (2.9% + $0.30 domestic online cards) and Stripe surcharge
  documentation (PaymentIntent surcharge public preview; Checkout automatic surcharge private
  preview with third-party provider).

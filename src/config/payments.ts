// Direct online payment for an instant estimate.
//
// The owner authorized a secure Stripe-hosted Pay Now option on 2026-10-26.
// The public UI only enables it when the server reports a configured Stripe
// secret; no card data ever reaches this site. Every checkout amount is
// recalculated server-side from the same estimator configuration used to
// display the quote.

export const estimatePaymentConfig = {
  /** Owner-approved feature switch; the server also requires Stripe to be configured. */
  enabled: true,
  /** Used on the Stripe Checkout line item and the payment-success page. */
  productLabel: 'Sparkling Standard Cleaning',
  checkoutNote:
    'Secure payment is processed by Stripe. Complete paid bookings confirm automatically when the address, required photos, requested time and resource availability all verify. If a requirement is outstanding, the booking remains pending and we follow up.',
} as const;

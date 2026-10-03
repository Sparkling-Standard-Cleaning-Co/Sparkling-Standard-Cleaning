// Gift-certificate configuration — deliberately free of `import.meta.env` so
// both the browser and the Cloudflare Pages Functions can import it.
//
// SAFETY GATES (see the owner directive):
//  - `enabled` stays false until real payment confirmation, fulfillment and
//    recordkeeping work end to end AND the owner approves the public terms.
//  - `denominations` stays empty until the owner approves exact amounts; the
//    page never invents or displays an unapproved value.
//  - `allowCustomAmount` lets a customer request an amount; it is only a
//    request until the owner confirms it (no card is charged on this site).
//  - Certificate validity/redemption terms are owner decisions: Florida (and,
//    where relevant, Alabama) requirements must be reviewed before publication.

export const giftCertificateConfig = {
  /** Public sales gate. Keep false until the owner has approved everything. */
  enabled: false,

  /**
   * Owner-approved monetary denominations (USD). EMPTY = not approved yet.
   * The purchase UI only offers values listed here; a client-supplied amount
   * is never trusted when creating a checkout session.
   */
  denominations: [] as ReadonlyArray<number>,

  /** Allow a customer-requested amount (owner confirms before payment). */
  allowCustomAmount: true,
  customAmountMinUsd: 25,
  customAmountMaxUsd: 500,

  /**
   * Draft public terms — PROPOSED wording only. Not published as binding
   * terms until the owner approves; the page labels them as proposed.
   */
  termsStatus: 'proposed' as 'proposed' | 'approved',

  /**
   * What every certificate explains to the recipient. Deliberately avoids
   * promising that a value covers a whole cleaning.
   */
  coverageNote:
    'A gift certificate puts its value toward Sparkling Standard cleaning services. The recipient chooses the service and date; because every home is different, the certificate value is applied to the agreed price rather than promising a complete cleaning.',

  /** Redemption steps shown on the certificate and the public page. */
  redemptionSteps: [
    'Contact Sparkling Standard with the certificate code and the recipient’s service address.',
    'We confirm the service, scope and date, and apply the certificate value to the agreed price.',
    'Any remaining balance is handled directly with the recipient after the cleaning.',
  ] as const,

  /** Purchase/request form fields are fixed; amounts are validated server-side. */
  maxMessageLength: 300,
} as const;

export type GiftCertificateConfig = typeof giftCertificateConfig;

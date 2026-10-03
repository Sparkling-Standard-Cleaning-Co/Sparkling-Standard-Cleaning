// Gift-certificate fulfillment summary — pure and unit-testable. Turns a
// verified Stripe payment into the ordered owner notification that authorizes
// issuance of one certificate (and only one, for a given Stripe event).

import { certificateCode, formatGiftValue, redeemUrl } from './certificate.ts';

export interface GiftPurchase {
  /** Stripe event id — the idempotency key for issuance. */
  eventId: string;
  sessionId: string;
  valueUsd: number;
  recipientName: string;
  purchaserName: string;
  purchaserEmail: string;
  recipientEmail?: string;
  message?: string;
  deliveryDate?: string;
  paidAtIso: string;
  siteUrl?: string;
}

/** The certificate code is derived from the event id: a retried webhook can
 *  never mint a second code for the same payment. */
export function giftCertificateCodeFor(purchase: Pick<GiftPurchase, 'eventId'>): string {
  return certificateCode(purchase.eventId);
}

/** Ordered, human-readable fulfillment notification for the owner. */
export function buildGiftFulfillment(purchase: GiftPurchase): Record<string, string> {
  const code = giftCertificateCodeFor(purchase);
  const fields: Record<string, string> = {
    'PAID — Gift certificate fulfillment': 'Payment verified by the payment provider. Issue exactly one certificate for this event.',
    'Gift value': formatGiftValue(purchase.valueUsd),
    'Certificate code': code,
    Recipient: purchase.recipientName,
    Purchaser: purchase.purchaserName,
    'Purchaser email': purchase.purchaserEmail,
  };
  if (purchase.recipientEmail) fields['Recipient email'] = purchase.recipientEmail;
  if (purchase.message) fields['Gift message'] = purchase.message;
  if (purchase.deliveryDate) fields['Requested delivery date'] = purchase.deliveryDate;
  fields['Redemption URL'] = redeemUrl(code, purchase.siteUrl);
  fields['Stripe event id'] = purchase.eventId;
  fields['Stripe session id'] = purchase.sessionId;
  fields['Paid at'] = purchase.paidAtIso;
  fields['Next step'] =
    'Generate the printable certificate with scripts/gift-certificate.mjs using the code above, then deliver it manually. Do not issue a second certificate for the same Stripe event.';
  return fields;
}

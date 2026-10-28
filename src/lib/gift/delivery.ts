import { activationLabel } from './activation.ts';
import { certificateHtml, formatGiftValue, redeemUrl } from './certificate.ts';

export interface GiftEmailData {
  code: string;
  valueUsd: number;
  recipientName: string;
  purchaserName: string;
  message?: string;
  validFromDate: string;
  paidAtIso: string;
  siteUrl: string;
  recipient: 'purchaser' | 'recipient';
}

export interface GiftEmail {
  subject: string;
  html: string;
  text: string;
}

export function buildGiftCertificateEmail(data: GiftEmailData): GiftEmail {
  const value = formatGiftValue(data.valueUsd);
  const url = redeemUrl(data.code, data.siteUrl);
  const issuedOn = data.paidAtIso.slice(0, 10);
  const html = certificateHtml({
    code: data.code,
    value,
    recipientName: data.recipientName,
    purchaserName: data.purchaserName,
    ...(data.message ? { message: data.message } : {}),
    issuedOn,
    validFrom: data.validFromDate,
    redeemUrl: url,
    contact: {
      phone: '(850) 426-8479',
      email: 'owner@sparkling-standard.com',
      website: 'sparkling-standard.com',
    },
    redemptionSteps: [
      'Contact Sparkling Standard with this certificate code and the service address.',
      'We confirm the service, scope and date, and apply the certificate value to the agreed price.',
      'Any remaining balance is handled directly with the recipient after the cleaning.',
    ],
    terms:
      'This purchased certificate represents a prepaid value toward Sparkling Standard cleaning services. It does not expire and carries no post-sale service, dormancy, maintenance or cash-out fee. It is not redeemable for cash except where required by law. Applicable unclaimed-property rules may apply. The holder’s statutory rights are not limited by this certificate.',
  });
  const text = [
    'SPARKLING STANDARD',
    'GIFT CERTIFICATE',
    '',
    `Value: ${value} toward cleaning services`,
    `Recipient: ${data.recipientName}`,
    `From: ${data.purchaserName}`,
    `Code: ${data.code}`,
    activationLabel(data.validFromDate),
    `Redeem: ${url}`,
    ...(data.message ? ['', `Message: ${data.message}`] : []),
    '',
    'This certificate is a prepaid service value, not cash. It does not expire and carries no post-sale service fee.',
    'Contact Sparkling Standard with the code and service address to redeem.',
    'Phone or text: (850) 426-8479',
    'Email: owner@sparkling-standard.com',
  ].join('\n');
  return {
    subject:
      data.recipient === 'recipient'
        ? `A Sparkling Standard gift certificate for you — ${value}`
        : `Your Sparkling Standard gift certificate — ${value}`,
    html,
    text,
  };
}

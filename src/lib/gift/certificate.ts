// Gift-certificate logic — pure, dependency-free and shared by the public
// page, the Stripe webhook, the owner fulfillment script and the tests.
//
// Security rules:
//  - Codes are deterministic from a seed (a Stripe session id or a random
//    seed for manual issuance) so a retried notification cannot mint a second
//    code for the same purchase.
//  - The redeem URL carries ONLY the certificate code; no customer details.
//  - All interpolated text is HTML-escaped in the printable template.

/** Code alphabet without ambiguous characters (no I, L, O, 0, 1). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const GIFT_CODE_PREFIX = 'SSGC';
const CODE_PATTERN = /^SSGC-[A-Z2-9]{4}-[A-Z2-9]{4}$/;

/** Deterministic 32-bit FNV-1a hash (stable across runs and platforms). */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function codeGroup(value: string, salt: string): string {
  let hash = fnv1a(`${salt}:${value}`);
  let group = '';
  for (let index = 0; index < 4; index += 1) {
    group += CODE_ALPHABET[hash % CODE_ALPHABET.length];
    hash = Math.floor(hash / CODE_ALPHABET.length) ^ fnv1a(`${salt}:${value}:${index}`);
    hash >>>= 0;
  }
  return group;
}

/** `SSGC-XXXX-XXXX`, deterministic for a given seed. */
export function certificateCode(seed: string): string {
  const groupA = codeGroup(`${seed}|a`, 'ssgc-1');
  const groupB = codeGroup(`${seed}|b`, 'ssgc-2');
  return `${GIFT_CODE_PREFIX}-${groupA}-${groupB}`;
}

/** True when a string is shaped like a certificate code (never a lookup). */
export function isCertificateCode(value: string): boolean {
  return CODE_PATTERN.test(value.trim().toUpperCase());
}

/** Public redeem URL for a code. Carries no customer information. */
export function redeemUrl(code: string, siteUrl = 'https://sparkling-standard.com'): string {
  const base = siteUrl.replace(/\/+$/, '');
  return `${base}/gift-certificates/redeem/?ref=${encodeURIComponent(code.trim().toUpperCase())}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface CertificateData {
  code: string;
  /** Formatted value, e.g. "$100". */
  value: string;
  recipientName: string;
  purchaserName?: string;
  message?: string;
  issuedOn: string;
  redeemUrl: string;
  /** Optional QR data URI (the owner script embeds a real, decodable QR). */
  qrDataUri?: string;
  /** Optional prebuilt @font-face CSS (the script embeds the real fonts). */
  fontFaces?: string;
  /** Contact lines shown on the certificate. */
  contact?: { phone?: string; email?: string; website?: string };
  /** Redemption steps (owner-approved wording). */
  redemptionSteps?: readonly string[];
  /** Terms wording; only rendered when supplied. */
  terms?: string;
}

/**
 * Self-contained printable certificate (Letter). Rendered on the branded
 * cream/rose/champagne palette with the approved crest geometry.
 */
export function certificateHtml(data: CertificateData): string {
  const e = escapeHtml;
  const steps = (data.redemptionSteps ?? []).map((step) => `<li>${e(step)}</li>`).join('');
  const qr = data.qrDataUri
    ? `<img class="qr" src="${data.qrDataUri}" alt="QR code linking to the redemption instructions" width="120" height="120" />`
    : '';
  const contactParts = [
    data.contact?.phone ? `Call or text ${e(data.contact.phone)}` : '',
    data.contact?.email ? e(data.contact.email) : '',
    data.contact?.website ? e(data.contact.website) : '',
  ].filter(Boolean);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sparkling Standard Gift Certificate ${e(data.code)}</title>
<style>
${data.fontFaces ?? ''}
:root { --rose: #93475b; --rose-deep: #6f3444; --gold: #c6a369; --gold-soft: #e6d3ab; --cream: #fdfbf8; --ink: #302429; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; background: #f4efe9; color: var(--ink);
  font-family: Georgia, 'Times New Roman', serif; }
.certificate { position: relative; max-width: 8.5in; margin: 0 auto; background: var(--cream);
  border: 1px solid var(--gold-soft); box-shadow: 0 10px 30px rgba(48,36,41,.12);
  padding: 54px 60px 46px; min-height: 10in; display: flex; flex-direction: column; }
.certificate::before { content: ''; position: absolute; inset: 14px; border: 2px solid var(--gold);
  border-radius: 6px; pointer-events: none; }
.crest { width: 92px; height: 92px; margin: 0 auto 6px; display: block; }
.brand { text-align: center; margin-bottom: 26px; }
.brand .sparkling { font-family: 'Great Vibes', 'Parisienne', Georgia, serif; font-size: 44px;
  color: var(--rose); line-height: 1; display: block; }
.brand .standard { font-family: Georgia, serif; font-size: 15px; letter-spacing: .34em;
  text-transform: uppercase; color: var(--rose-deep); display: block; margin-top: 6px; }
.brand .descriptor { font-family: 'Nunito Sans', system-ui, sans-serif; font-size: 10px;
  letter-spacing: .26em; text-transform: uppercase; color: var(--gold); display: block; margin-top: 8px; }
h1 { text-align: center; font-size: 21px; letter-spacing: .28em; text-transform: uppercase;
  color: var(--ink); font-weight: 400; margin: 0 0 26px; }
.value { text-align: center; font-size: 54px; color: var(--rose); margin: 0 0 4px; }
.value-label { text-align: center; font-size: 11px; letter-spacing: .22em; text-transform: uppercase;
  color: var(--gold); margin: 0 0 30px; }
.fields { display: grid; grid-template-columns: 1fr 1fr; gap: 18px 32px; margin: 0 auto 26px; max-width: 5.6in; }
.field { border-bottom: 1px solid var(--gold-soft); padding-bottom: 8px; }
.field .label { font-family: 'Nunito Sans', system-ui, sans-serif; font-size: 9px;
  letter-spacing: .2em; text-transform: uppercase; color: var(--gold); display: block; margin-bottom: 4px; }
.field .value-text { font-size: 19px; color: var(--ink); }
.message { max-width: 5.6in; margin: 0 auto 26px; text-align: center; font-style: italic;
  font-size: 17px; color: var(--rose-deep); }
.message::before, .message::after { content: '"'; color: var(--gold); }
.redeem { max-width: 6in; margin: 0 auto; }
.redeem h2 { font-family: 'Nunito Sans', system-ui, sans-serif; font-size: 10px; letter-spacing: .22em;
  text-transform: uppercase; color: var(--gold); margin: 0 0 8px; }
.redeem ol { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.55; }
.code-row { display: flex; align-items: center; justify-content: space-between; gap: 20px;
  margin-top: 30px; padding-top: 22px; border-top: 1px solid var(--gold-soft); }
.code .label { font-family: 'Nunito Sans', system-ui, sans-serif; font-size: 9px; letter-spacing: .2em;
  text-transform: uppercase; color: var(--gold); display: block; margin-bottom: 4px; }
.code .code-value { font-family: 'Courier New', monospace; font-size: 20px; letter-spacing: .08em;
  color: var(--ink); }
.qr { display: block; }
.contact { margin-top: 18px; font-size: 12px; color: var(--ink); }
.terms { margin-top: 22px; font-size: 10.5px; line-height: 1.5; color: #6b5b52; }
.footer-note { margin-top: auto; padding-top: 26px; text-align: center; font-family: 'Nunito Sans', system-ui, sans-serif;
  font-size: 9px; letter-spacing: .18em; text-transform: uppercase; color: var(--gold); }
@media print { body { background: #fff; padding: 0; } .certificate { box-shadow: none; border: none; } }
</style>
</head>
<body>
  <section class="certificate">
    <span class="crest" aria-hidden="true">${crestSvg()}</span>
    <div class="brand">
      <span class="sparkling">Sparkling</span>
      <span class="standard">Standard</span>
      <span class="descriptor">Cleaning Co. · The Details Are Our Standard.</span>
    </div>
    <h1>Gift Certificate</h1>
    <p class="value">${e(data.value)}</p>
    <p class="value-label">Toward Sparkling Standard cleaning services</p>
    <div class="fields">
      <div class="field"><span class="label">Recipient</span><span class="value-text">${e(data.recipientName)}</span></div>
      <div class="field"><span class="label">From</span><span class="value-text">${e(data.purchaserName ?? 'A friend')}</span></div>
    </div>
    ${data.message ? `<p class="message">${e(data.message)}</p>` : ''}
    <div class="redeem">
      <h2>How to redeem</h2>
      <ol>${steps}</ol>
    </div>
    <div class="code-row">
      <div class="code">
        <span class="label">Certificate code</span>
        <span class="code-value">${e(data.code)}</span>
      </div>
      ${qr}
    </div>
    ${contactParts.length ? `<p class="contact">${contactParts.join(' · ')}</p>` : ''}
    ${data.terms ? `<p class="terms">${e(data.terms)}</p>` : ''}
    <p class="footer-note">Issued ${e(data.issuedOn)} · Sparkling Standard Cleaning Co.</p>
  </section>
</body>
</html>`;
}

/** Compact crest matching the approved geometry (self-contained colors). */
export function crestSvg(): string {
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" width="92" height="92" role="img" aria-label="Sparkling Standard crest">
  <defs><linearGradient id="gift-gold" x1="0" y1="0" x2="0.85" y2="1">
    <stop offset="0" stop-color="#e2c07c"/><stop offset="0.55" stop-color="#c6a369"/><stop offset="1" stop-color="#9d7736"/>
  </linearGradient></defs>
  <g fill="none" stroke="url(#gift-gold)">
    <circle cx="32" cy="32" r="26.5" stroke-width="1.5"/>
    <path d="M24.6 55.4c-6.1-2.5-11-7.4-13.4-13.6" stroke-width="3.4" stroke-linecap="round"/>
  </g>
  <g fill="url(#gift-gold)">
    <path d="M17.5 9.5 19 15l5.5 1.5L19 18l-1.5 5.5L16 18l-5.5-1.5L16 15z"/>
    <path d="M12.5 22.5 13.4 26l3.6.9-3.6.9-.9 3.6-.9-3.6-3.6-.9 3.6-.9z"/>
    <path d="M50.5 16.5 52 22l5.5 1.5L52 25l-1.5 5.5L49 25l-5.5-1.5L49 22z"/>
  </g>
  <text x="33.5" y="43.5" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-weight="600" font-size="34" fill="url(#gift-gold)">S</text>
  <g>
    <circle cx="47.2" cy="46.6" r="2.9" fill="#e8b3bf"/>
    <circle cx="51.9" cy="50.3" r="2.9" fill="#c97285"/>
    <circle cx="49.6" cy="55.8" r="2.9" fill="#e8b3bf"/>
    <circle cx="43.9" cy="55.6" r="2.9" fill="#c97285"/>
    <circle cx="41.7" cy="50.1" r="2.9" fill="#e8b3bf"/>
    <circle cx="46.9" cy="51.4" r="2.4" fill="#c6a369"/>
  </g>
</svg>`;
}

/** Format a USD amount for display (whole dollars keep no cents). */
export function formatGiftValue(amountUsd: number): string {
  const rounded = Math.round(amountUsd * 100) / 100;
  return Number.isInteger(rounded) ? `$${rounded}` : `$${rounded.toFixed(2)}`;
}

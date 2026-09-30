// Consent controller — installed on every page.
//
// The single authority for analytics loading on this site:
//  - GTM/GA4 and Umami load ONLY after an explicit analytics consent choice.
//  - Consent Mode v2 defaults are all-denied before any load.
//  - Advertising consent is never granted.
//  - Withdrawal stops further collection immediately.
//  - A confirmed form submission receipt is transmitted at most once, only
//    with permission, and never replayed from before permission.

import { business } from '../config/business';
import { analyticsConfigured, readConsent, writeConsent } from '../lib/analytics/consent';

const GTM_ID = business.analytics.gtm.containerId;
const UMAMI_ID = business.analytics.umami.websiteId;
const RECEIPT_KEY = 'pcc-lead-receipt';

type ReceiptEvent =
  | 'cleaning_request_submit'
  | 'commercial_quote_submit'
  | 'str_request_submit';

interface LeadReceipt {
  event: ReceiptEvent;
  service_type?: string;
  facility_type?: string;
}

const ALLOWED_RECEIPT_EVENTS: ReceiptEvent[] = [
  'cleaning_request_submit',
  'commercial_quote_submit',
  'str_request_submit',
];

let granted = false;
let gtmLoaded = false;
let umamiLoaded = false;

function ensureDataLayer(): unknown[] {
  window.dataLayer = window.dataLayer || [];
  return window.dataLayer;
}

function gtag(...args: unknown[]): void {
  ensureDataLayer().push(args);
}

function setConsentDefaults(): void {
  if (!GTM_ID) return;
  window.gtag = gtag;
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
  });
}

function loadGtm(): void {
  if (!GTM_ID || gtmLoaded) return;
  if (document.querySelector('script[src*="googletagmanager.com/gtm.js"]')) {
    gtmLoaded = true;
    return;
  }
  gtmLoaded = true;
  ensureDataLayer().push({ 'gtm.start': Date.now(), event: 'gtm.js' });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(GTM_ID)}`;
  document.head.appendChild(script);
}

function loadUmami(): void {
  if (!UMAMI_ID || umamiLoaded) return;
  if (document.querySelector('script[data-website-id]')) {
    umamiLoaded = true;
    return;
  }
  umamiLoaded = true;
  const script = document.createElement('script');
  script.async = true;
  script.defer = true;
  script.src = 'https://cloud.umami.is/script.js';
  script.setAttribute('data-website-id', UMAMI_ID);
  document.head.appendChild(script);
}

function firePendingReceipt(): void {
  try {
    const raw = window.sessionStorage.getItem(RECEIPT_KEY);
    if (!raw) return;
    if (readConsent()?.analytics === false) {
      window.sessionStorage.removeItem(RECEIPT_KEY);
      return;
    }
    if (!granted) return;
    window.sessionStorage.removeItem(RECEIPT_KEY);
    const parsed = JSON.parse(raw) as LeadReceipt | LeadReceipt[];
    const receipts = Array.isArray(parsed) ? parsed : [parsed];
    for (const receipt of receipts) {
      if (!receipt || !ALLOWED_RECEIPT_EVENTS.includes(receipt.event)) continue;
      ensureDataLayer().push({
        event: receipt.event,
        ...(receipt.service_type ? { service_type: receipt.service_type } : {}),
        ...(receipt.facility_type ? { facility_type: receipt.facility_type } : {}),
      });
    }
  } catch {
    // Fail closed: a corrupted receipt is dropped, never guessed at.
  }
}

function allow(): void {
  granted = true;
  writeConsent(true);
  document.querySelector('[data-consent-banner]')?.setAttribute('data-visible', 'false');
  if (GTM_ID) {
    window.gtag = gtag;
    gtag('consent', 'update', { analytics_storage: 'granted' });
  }
  loadGtm();
  loadUmami();
  firePendingReceipt();
}

function deny(): void {
  granted = false;
  writeConsent(false);
  document.querySelector('[data-consent-banner]')?.setAttribute('data-visible', 'false');
  if (GTM_ID) {
    window.gtag = gtag;
    // Consent Mode withdrawal: GA4 (configured inside the GTM container)
    // stops storing analytics data. No ga-disable flag is needed because
    // gtag.js is never loaded directly by this site.
    gtag('consent', 'update', { analytics_storage: 'denied' });
  }
  try {
    window.sessionStorage.removeItem(RECEIPT_KEY);
  } catch {
    // no-op
  }
}

window.pccConsent = {
  granted: () => granted,
  choice: () => readConsent()?.analytics ?? null,
  allow,
  deny,
};

function boot(): void {
  if (!analyticsConfigured()) {
    // Nothing configured: no banner, no requests, no storage.
    return;
  }
  setConsentDefaults();

  const banner = document.querySelector<HTMLElement>('[data-consent-banner]');
  const stored = readConsent();

  if (stored?.analytics === true) {
    allow();
    banner?.setAttribute('data-visible', 'false');
    return;
  }
  if (stored?.analytics === false) {
    deny();
    banner?.setAttribute('data-visible', 'false');
    return;
  }

  banner?.setAttribute('data-visible', 'true');
  banner?.querySelector('[data-consent="allow"]')?.addEventListener('click', allow);
  banner?.querySelector('[data-consent="deny"]')?.addEventListener('click', deny);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

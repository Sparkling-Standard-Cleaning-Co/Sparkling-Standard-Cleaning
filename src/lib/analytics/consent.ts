// Client-side analytics consent controller.
//
// Rules (see docs/privacy and ConsentBanner.astro):
//  - NOTHING loads until the visitor makes an explicit analytics choice:
//    no GTM container, no GA4 request, no Umami script, no cookies.
//  - Advertising consent is never granted by this site.
//  - Any storage error fails closed (denied).
//  - The choice can be withdrawn at any time; withdrawal stops collection.
//  - Consent Mode v2 defaults are set to denied before anything loads, and
//    the granted state is applied before GTM loads.

import { business } from '../../config/business';

export const CONSENT_KEY = business.analytics.consentStorageKey;

export interface StoredConsent {
  analytics: boolean;
  /** Advertising consent is always false on this site. */
  ads: false;
  v: 1;
}

export function readConsent(): StoredConsent | null {
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredConsent>;
    if (typeof parsed.analytics !== 'boolean') return null;
    return { analytics: parsed.analytics, ads: false, v: 1 };
  } catch {
    return null;
  }
}

export function writeConsent(analytics: boolean): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ analytics: !!analytics, ads: false, v: 1 }));
  } catch {
    // In-memory state still applies for this visit.
  }
}

export function analyticsConfigured(): boolean {
  return Boolean(business.analytics.umami.websiteId || business.analytics.gtm.containerId);
}

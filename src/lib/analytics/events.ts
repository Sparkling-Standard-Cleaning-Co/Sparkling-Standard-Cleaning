// Analytics event taxonomy — FIXED event names only (directive §52).
//
// Hard rules:
//  - Never send names, emails, phone numbers, street addresses, ZIP codes,
//    uploaded photos, form contents, or any other personal information.
//  - Event names are a closed union; payload keys are a closed allowlist.
//  - Events fire only after analytics consent is granted (both services).
//  - Umami is cookieless aggregate; GTM/GA4 follows Consent Mode v2.

export type AnalyticsEventName =
  | 'call_click'
  | 'text_click'
  | 'estimate_start'
  | 'estimate_step'
  | 'estimate_complete'
  | 'cleaning_request_submit'
  | 'commercial_quote_start'
  | 'commercial_quote_submit'
  | 'str_request_start'
  | 'str_request_submit'
  | 'booking_request'
  | 'review_link_click';

/** Allowlisted payloads — flat, non-identifying values only. */
export interface EventPayloads {
  call_click: { cta_slot?: string };
  text_click: { cta_slot?: string };
  estimate_start: { service_type?: string };
  estimate_step: { step: number; service_type?: string };
  estimate_complete: { service_type?: string; outcome: 'estimated' | 'custom_confirmation_required' | 'invalid' };
  cleaning_request_submit: { service_type?: string; journey: 'residential' };
  commercial_quote_start: Record<string, never>;
  commercial_quote_submit: { facility_type?: string };
  str_request_start: Record<string, never>;
  str_request_submit: Record<string, never>;
  booking_request: { service_type?: string };
  review_link_click: { platform?: string };
}

interface ConsentWindow extends Window {
  pccConsent?: {
    granted(): boolean;
    choice(): boolean | null;
    allow(): void;
    deny(): void;
  };
  dataLayer?: unknown[];
  umami?: { track(name: string, data?: Record<string, unknown>): void };
}

export function track<K extends AnalyticsEventName>(
  event: K,
  payload?: EventPayloads[K],
): void {
  if (typeof window === 'undefined') return;
  const w = window as ConsentWindow;
  const consent = w.pccConsent;
  if (!consent || !consent.granted()) return;

  if (Array.isArray(w.dataLayer)) {
    w.dataLayer.push({ event, ...(payload ?? {}) });
  }
  if (w.umami && typeof w.umami.track === 'function') {
    w.umami.track(event, payload as Record<string, unknown> | undefined);
  }
}

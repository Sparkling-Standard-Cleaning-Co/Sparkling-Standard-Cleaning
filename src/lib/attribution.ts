// Lead attribution — preserves inbound campaign context for LEAD RECORDS.
//
// Rules (directive §54):
//  - Lead records and analytics events serve different purposes. Attribution
//    data goes into the message the business receives, never into analytics.
//  - Only campaign metadata is stored: UTMs, landing path, referrer origin,
//    ad-network click ids. Never user-entered content.
//  - First-touch is preserved; latest-touch is kept when it differs.

export interface AttributionTouch {
  source?: string | undefined;
  medium?: string | undefined;
  campaign?: string | undefined;
  content?: string | undefined;
  /** Google Ads auto-tagging ids are preserved untouched (never stripped). */
  gclid?: string | undefined;
  gbraid?: string | undefined;
  wbraid?: string | undefined;
  landingPage: string;
  referrerOrigin?: string | undefined;
  at: string;
}

export interface AttributionContext {
  first: AttributionTouch | null;
  latest: AttributionTouch | null;
}

const FIRST_KEY = 'pcc-attribution-first';
const LATEST_KEY = 'pcc-attribution-latest';
const MAX_ID_LENGTH = 200;

function safeRead(key: string): AttributionTouch | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as AttributionTouch) : null;
  } catch {
    return null;
  }
}

function safeWrite(key: string, touch: AttributionTouch): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(touch));
  } catch {
    // Attribution is best-effort; never break the page over storage failure.
  }
}

function clip(value: string | null): string | undefined {
  if (!value) return undefined;
  return value.length > MAX_ID_LENGTH ? value.slice(0, MAX_ID_LENGTH) : value;
}

export function captureAttribution(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const touch: AttributionTouch = {
      source: clip(params.get('utm_source')),
      medium: clip(params.get('utm_medium')),
      campaign: clip(params.get('utm_campaign')),
      content: clip(params.get('utm_content')),
      gclid: clip(params.get('gclid')),
      gbraid: clip(params.get('gbraid')),
      wbraid: clip(params.get('wbraid')),
      landingPage: window.location.pathname,
      referrerOrigin: document.referrer ? new URL(document.referrer).origin : undefined,
      at: new Date().toISOString(),
    };

    if (!safeRead(FIRST_KEY)) {
      safeWrite(FIRST_KEY, touch);
    }
    safeWrite(LATEST_KEY, touch);
  } catch {
    // No attribution is better than a broken page.
  }
}

export function getAttribution(): AttributionContext {
  return { first: safeRead(FIRST_KEY), latest: safeRead(LATEST_KEY) };
}

/** Flattens attribution into form-field values (non-identifying metadata). */
export function attributionFields(): Record<string, string> {
  const { first, latest } = getAttribution();
  const fields: Record<string, string> = {};
  const pick = (prefix: string, touch: AttributionTouch | null) => {
    if (!touch) return;
    if (touch.source) fields[`${prefix}_utm_source`] = touch.source;
    if (touch.medium) fields[`${prefix}_utm_medium`] = touch.medium;
    if (touch.campaign) fields[`${prefix}_utm_campaign`] = touch.campaign;
    if (touch.content) fields[`${prefix}_utm_content`] = touch.content;
  };
  pick('first', first);
  pick('latest', latest);
  if (latest) {
    fields.landing_page = latest.landingPage;
    if (latest.referrerOrigin) fields.referrer_origin = latest.referrerOrigin;
    if (latest.gclid) fields.gclid = latest.gclid;
    if (latest.gbraid) fields.gbraid = latest.gbraid;
    if (latest.wbraid) fields.wbraid = latest.wbraid;
  }
  return fields;
}

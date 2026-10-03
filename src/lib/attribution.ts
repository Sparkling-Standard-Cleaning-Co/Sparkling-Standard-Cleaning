// Lead attribution — preserves inbound campaign context for LEAD RECORDS.
//
// Rules (directive §54):
//  - Lead records and analytics events serve different purposes. Attribution
//    data goes into the message the business receives, never into analytics.
//  - Only campaign metadata is stored: UTMs, landing path, referrer origin,
//    ad-network click ids. Never user-entered content.
//  - First-touch is captured once and never overwritten.
//  - Latest-touch is the most recent MEANINGFUL touch:
//      * a new campaign or ad click (different values) always updates it;
//      * internal navigation, refreshes and ordinary direct views NEVER erase
//        campaign context;
//      * an external referral is recorded only while no campaign touch exists,
//        and a same-domain referrer is never treated as a referral.

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

/** Values that identify a genuine campaign/ad touch. */
const CAMPAIGN_KEYS = ['source', 'medium', 'campaign', 'content', 'gclid', 'gbraid', 'wbraid'] as const;

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

/**
 * The external referrer origin, or undefined when there is no referrer, the
 * referrer is malformed, or it points back at this same site (internal
 * navigation is not a referral).
 */
function externalReferrerOrigin(referrer: string, currentOrigin: string): string | undefined {
  if (!referrer) return undefined;
  try {
    const origin = new URL(referrer).origin;
    if (!origin || origin === 'null' || origin === currentOrigin) return undefined;
    return origin;
  } catch {
    return undefined;
  }
}

function isCampaignTouch(touch: AttributionTouch): boolean {
  return CAMPAIGN_KEYS.some((key) => Boolean(touch[key]));
}

/** True when two touches carry the same campaign identifiers and landing page. */
function sameTouch(a: AttributionTouch, b: AttributionTouch): boolean {
  return (
    CAMPAIGN_KEYS.every((key) => (a[key] ?? '') === (b[key] ?? '')) &&
    a.landingPage === b.landingPage
  );
}

export function captureAttribution(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const currentOrigin = window.location.origin;
    const touch: AttributionTouch = {
      source: clip(params.get('utm_source')),
      medium: clip(params.get('utm_medium')),
      campaign: clip(params.get('utm_campaign')),
      content: clip(params.get('utm_content')),
      gclid: clip(params.get('gclid')),
      gbraid: clip(params.get('gbraid')),
      wbraid: clip(params.get('wbraid')),
      landingPage: window.location.pathname,
      referrerOrigin: externalReferrerOrigin(document.referrer, currentOrigin),
      at: new Date().toISOString(),
    };

    if (!safeRead(FIRST_KEY)) {
      safeWrite(FIRST_KEY, touch);
    }

    const latest = safeRead(LATEST_KEY);
    if (!latest) {
      safeWrite(LATEST_KEY, touch);
      return;
    }

    if (isCampaignTouch(touch)) {
      // A genuinely new campaign or ad click replaces the latest touch; a
      // refresh of the identical campaign link is left alone.
      if (!sameTouch(latest, touch)) safeWrite(LATEST_KEY, touch);
      return;
    }

    // Ordinary views never erase campaign context.
    if (isCampaignTouch(latest)) return;

    // While no campaign touch exists, a new external referral may refine the
    // latest touch. Same-origin/direct views never do.
    if (touch.referrerOrigin && touch.referrerOrigin !== latest.referrerOrigin) {
      safeWrite(LATEST_KEY, touch);
    }
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
  const meaningful = latest ?? first;
  if (meaningful) {
    fields.landing_page = meaningful.landingPage;
    if (meaningful.referrerOrigin) fields.referrer_origin = meaningful.referrerOrigin;
  }
  // Ad click ids are preserved even when a later campaign touch replaced the
  // latest record: prefer the latest touch, fall back to the first.
  const clickId = (key: 'gclid' | 'gbraid' | 'wbraid'): string | undefined => latest?.[key] ?? first?.[key];
  const gclid = clickId('gclid');
  if (gclid) fields.gclid = gclid;
  const gbraid = clickId('gbraid');
  if (gbraid) fields.gbraid = gbraid;
  const wbraid = clickId('wbraid');
  if (wbraid) fields.wbraid = wbraid;
  return fields;
}

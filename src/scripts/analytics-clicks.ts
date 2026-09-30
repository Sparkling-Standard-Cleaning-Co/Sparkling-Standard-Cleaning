// Click-event tracking — fixed names only, consent-gated, no PII.
// Covers tap-to-call, tap-to-text and review-link clicks site-wide.

import { track } from '../lib/analytics/events';

document.addEventListener(
  'click',
  (event) => {
    const target = event.target as Element | null;
    const link = target?.closest<HTMLAnchorElement>('a[href]');
    if (!link) return;

    const href = link.getAttribute('href') ?? '';
    const slot = link.dataset.cta;

    if (href.startsWith('tel:')) {
      track('call_click', slot ? { cta_slot: slot } : {});
      return;
    }
    if (href.startsWith('sms:')) {
      track('text_click', slot ? { cta_slot: slot } : {});
      return;
    }
    if (link.dataset.reviewLink) {
      track('review_link_click', { platform: link.dataset.reviewLink });
    }
  },
  { capture: true },
);
